import { Router, Request } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  Prisma, Role, BusinessStatus, CampaignStatus, CampaignAccess,
  ApplicationStatus, ConversionStatus, CommissionStatus, LedgerType,
  NotificationType, CompensationModel, CouponDiscountType,
  CouponRedemptionStatus, CreatorDeliverableStatus, CreatorPaymentStatus,
  AffiliateProgramStatus, ProgramMembershipStatus, BusinessMemberRole,
  IntegrationKind, IntegrationProvider, IntegrationStatus,
  WebhookEventStatus, VerificationStatus, AttributionSource,
  AttributionTouchType, CrmStage,
} from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { env } from '../config';
import { requireAuth, roles, current } from '../auth';
import { HttpError } from '../errors';
import {
  decryptCredentials, encryptCredentials, normalizeWebhook,
  sha256, verifyWebhookSignature,
} from '../services/integrations';

export const phase11And12Router = Router();
const auth = requireAuth;
const affiliateOnly = [auth, roles(Role.AFFILIATE)] as const;
const businessOnly = [auth, roles(Role.BUSINESS)] as const;
const adminOnly = [auth, roles(Role.ADMIN)] as const;
const idParams = z.object({ id: z.string().min(1) });

async function businessContext(userId: string, businessId?: string) {
  const owned = businessId
    ? await prisma.businessProfile.findFirst({ where: { id: businessId, userId } })
    : await prisma.businessProfile.findUnique({ where: { userId } });
  if (owned) return { business: owned, role: 'OWNER' };
  const membership = await prisma.businessMember.findFirst({
    where: { userId, isActive: true, ...(businessId ? { businessId } : {}) },
    include: { business: true },
  });
  if (!membership) throw new HttpError(404, 'Business membership not found');
  return { business: membership.business, role: membership.role };
}

async function requireBusiness(req: Request, permission: 'READ' | 'WRITE' | 'ADMIN' = 'READ') {
  const context = await businessContext(current(req).userId, req.get('x-business-id') ?? undefined);
  const rank: Record<string, number> = { ANALYST: 1, MANAGER: 2, ADMIN: 3, OWNER: 4 };
  const required = permission === 'READ' ? 1 : permission === 'WRITE' ? 2 : 3;
  if ((rank[context.role] ?? 0) < required) {
    throw new HttpError(403, `Business ${permission.toLowerCase()} permission required`, 'FORBIDDEN');
  }
  return context;
}

async function affiliateForUser(userId: string) {
  const affiliate = await prisma.affiliateProfile.findUnique({ where: { userId } });
  if (!affiliate) throw new HttpError(404, 'Affiliate profile not found');
  return affiliate;
}

async function audit(actorId: string, action: string, entityType: string, entityId: string, metadata?: Prisma.InputJsonValue) {
  await prisma.auditLog.create({ data: { actorId, action, entityType, entityId, metadata } });
}

async function notify(userId: string, type: NotificationType, title: string, message: string) {
  const preference = await prisma.notificationPreference.findUnique({ where: { userId } });
  if (preference && (!preference.inAppEnabled || preference.mutedTypes.includes(type))) return;
  await prisma.notification.create({ data: { userId, type, title, message } });
}

function decimalCommission(type: 'PERCENTAGE' | 'FIXED', value: Prisma.Decimal, gross: Prisma.Decimal) {
  return type === 'PERCENTAGE'
    ? gross.mul(value).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    : value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

async function createPerformanceCommission(
  tx: Prisma.TransactionClient,
  conversion: { id: string; campaignId: string; affiliateId: string; amount: Prisma.Decimal; currency: string },
  campaign: { compensationModel: CompensationModel; commissionType: 'PERCENTAGE' | 'FIXED' | null; commissionValue: Prisma.Decimal | null; validationDays: number },
) {
  if (campaign.compensationModel === CompensationModel.FIXED_FEE) return null;
  if (!campaign.commissionType || !campaign.commissionValue) {
    throw new HttpError(409, 'Campaign commission terms are incomplete');
  }
  const amount = decimalCommission(campaign.commissionType, campaign.commissionValue, conversion.amount);
  if (amount.lte(0)) throw new HttpError(400, 'Calculated commission must be positive');
  const commission = await tx.commission.create({
    data: {
      conversionId: conversion.id,
      campaignId: conversion.campaignId,
      affiliateId: conversion.affiliateId,
      grossAmount: conversion.amount,
      commissionAmount: amount,
      currency: conversion.currency,
      availableAt: new Date(Date.now() + campaign.validationDays * 86_400_000),
    },
  });
  await tx.walletEntry.create({
    data: {
      affiliateId: conversion.affiliateId,
      type: LedgerType.PENDING_CREDIT,
      amount,
      currency: conversion.currency,
      referenceType: 'COMMISSION',
      referenceId: commission.id,
      description: `Pending commission for conversion ${conversion.id}`,
    },
  });
  return commission;
}

async function resolveAttribution(
  tx: Prisma.TransactionClient | typeof prisma,
  input: { campaignId?: string; referralCode?: string; couponCode?: string; visitorHash?: string; businessId: string },
) {
  if (!input.referralCode && !input.couponCode && (!input.visitorHash || !input.campaignId)) {
    throw new HttpError(400, 'Provide referralCode, couponCode, or campaignId with visitorId');
  }
  let referral = input.referralCode
    ? await tx.referral.findUnique({
        where: { code: input.referralCode },
        include: { campaign: true, affiliate: { include: { user: true } } },
      })
    : null;
  let coupon = input.couponCode
    ? await tx.coupon.findUnique({
        where: { code: input.couponCode.toUpperCase() },
        include: { campaign: true, affiliate: { include: { user: true } } },
      })
    : null;

  if (input.referralCode && !referral) throw new HttpError(404, 'Referral code not found');
  if (input.couponCode && !coupon) throw new HttpError(404, 'Coupon code not found');

  let campaign = referral?.campaign ?? coupon?.campaign ?? null;
let affiliate = referral?.affiliate ?? coupon?.affiliate ?? null;
  if (!campaign && input.campaignId && input.visitorHash) {
    campaign = await tx.campaign.findFirst({
      where: { id: input.campaignId, businessId: input.businessId, status: CampaignStatus.APPROVED },
    });
    if (!campaign) throw new HttpError(404, 'Eligible approved campaign not found');
    const windowStart = new Date(Date.now() - campaign.attributionDays * 86_400_000);
    const touch = await tx.attributionTouch.findFirst({
      where: {
        campaignId: campaign.id,
        visitorHash: input.visitorHash,
        occurredAt: { gte: windowStart },
        affiliateId: { not: null },
      },
      orderBy: { occurredAt: campaign.attributionModel === 'FIRST_CLICK' ? 'asc' : 'desc' },
    });
    if (!touch?.affiliateId) throw new HttpError(404, 'No eligible attribution touch found in the campaign attribution window');
    affiliate = await tx.affiliateProfile.findUnique({ where: { id: touch.affiliateId }, include: { user: true } });
    if (touch.referralId) referral = await tx.referral.findUnique({ where: { id: touch.referralId }, include: { campaign: true, affiliate: { include: { user: true } } } });
    if (touch.couponId) coupon = await tx.coupon.findUnique({ where: { id: touch.couponId }, include: { campaign: true, affiliate: { include: { user: true } } } });
  }
  if (!campaign || !affiliate) throw new HttpError(404, 'Attribution source not found');
  if (campaign.businessId !== input.businessId || campaign.status !== CampaignStatus.APPROVED) {
    throw new HttpError(404, 'Eligible approved campaign not found');
  }
  if (input.campaignId && campaign.id !== input.campaignId) {
    throw new HttpError(400, 'Attribution source does not belong to the supplied campaign');
  }
  if (referral && (referral.campaignId !== campaign.id || referral.affiliateId !== affiliate.id)) {
    throw new HttpError(400, 'Referral attribution is inconsistent');
  }
  if (coupon && (coupon.campaignId !== campaign.id || coupon.affiliateId !== affiliate.id)) {
    throw new HttpError(400, 'Coupon attribution is inconsistent');
  }
  if (coupon) {
    const now = new Date();
    if (!coupon.isActive || (coupon.startsAt && coupon.startsAt > now) || (coupon.expiresAt && coupon.expiresAt <= now)) {
      throw new HttpError(409, 'Coupon is inactive or outside its validity window');
    }
  }
  return { campaign, affiliate, referral, coupon };
}

async function reserveCouponRedemption(
  tx: Prisma.TransactionClient,
  coupon: { id: string },
  conversionId: string,
  status: CouponRedemptionStatus,
) {
  await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "id" = ${coupon.id} FOR UPDATE`;
  const lockedCoupon = await tx.coupon.findUnique({ where: { id: coupon.id } });
  if (!lockedCoupon || !lockedCoupon.isActive) throw new HttpError(409, 'Coupon is inactive');
  const now = new Date();
  if ((lockedCoupon.startsAt && lockedCoupon.startsAt > now) || (lockedCoupon.expiresAt && lockedCoupon.expiresAt <= now)) {
    throw new HttpError(409, 'Coupon is outside its validity window');
  }
  const activeRedemptions = await tx.couponRedemption.count({
    where: {
      couponId: coupon.id,
      status: { in: [CouponRedemptionStatus.RESERVED, CouponRedemptionStatus.CONFIRMED] },
    },
  });
  if (lockedCoupon.maxRedemptions !== null && activeRedemptions >= lockedCoupon.maxRedemptions) {
    throw new HttpError(409, 'Coupon redemption limit has been reached');
  }
  await tx.couponRedemption.create({
    data: { couponId: coupon.id, conversionId, status },
  });
}

async function createManualConversion(input: {
  businessId: string;
  submittedById: string;
  referralCode?: string;
  couponCode?: string;
  visitorId?: string;
  campaignId?: string;
  externalReference: string;
  customerReference?: string;
  amount: number;
  currency: string;
  evidenceUrl?: string;
  convertedAt?: Date;
}) {
  return prisma.$transaction(async (tx) => {
    const attribution = await resolveAttribution(tx, {
      businessId: input.businessId,
      campaignId: input.campaignId,
      referralCode: input.referralCode,
      couponCode: input.couponCode,
      visitorHash: input.visitorId ? sha256(`${input.visitorId}:${env.IP_HASH_SALT}`) : undefined,
    });
    if (attribution.campaign.currency !== input.currency) {
      throw new HttpError(400, `Conversion currency must match campaign currency (${attribution.campaign.currency})`);
    }
    const conversion = await tx.conversion.create({
      data: {
        campaignId: attribution.campaign.id,
        affiliateId: attribution.affiliate.id,
        referralId: attribution.referral?.id,
        couponId: attribution.coupon?.id,
        attributionSource: attribution.referral && attribution.coupon
          ? AttributionSource.REFERRAL_AND_COUPON
          : attribution.coupon ? AttributionSource.COUPON
          : attribution.referral ? AttributionSource.REFERRAL : AttributionSource.ATTRIBUTION_WINDOW,
        attributionEvidence: {
          referralCode: input.referralCode ?? null,
          couponCode: input.couponCode?.toUpperCase() ?? null,
          visitorHash: input.visitorId ? sha256(`${input.visitorId}:${env.IP_HASH_SALT}`) : null,
        },
        externalReference: input.externalReference,
        customerReference: input.customerReference,
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency,
        evidenceUrl: input.evidenceUrl,
        convertedAt: input.convertedAt,
        submittedById: input.submittedById,
      },
    });
    if (attribution.coupon) {
      await reserveCouponRedemption(tx, attribution.coupon, conversion.id, CouponRedemptionStatus.RESERVED);
    }
    return { conversion, affiliateUserId: attribution.affiliate.userId };
  });
}

async function processVerifiedConversion(input: {
  integrationId: string;
  businessId: string;
  submittedById: string;
  campaignId?: string;
  referralCode?: string;
  couponCode?: string;
  externalReference: string;
  customerReference?: string;
  amount: string;
  currency: string;
  occurredAt?: Date;
  providerReference?: string;
  evidence: Prisma.InputJsonValue;
  webhookEventId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const attribution = await resolveAttribution(tx, {
      businessId: input.businessId,
      campaignId: input.campaignId,
      referralCode: input.referralCode,
      couponCode: input.couponCode,
    });
    if (attribution.campaign.currency !== input.currency) {
      throw new HttpError(400, `Conversion currency must match campaign currency (${attribution.campaign.currency})`);
    }
    const conversion = await tx.conversion.create({
      data: {
        campaignId: attribution.campaign.id,
        affiliateId: attribution.affiliate.id,
        referralId: attribution.referral?.id,
        couponId: attribution.coupon?.id,
        integrationId: input.integrationId,
        attributionSource: AttributionSource.WEBHOOK,
        attributionEvidence: input.evidence,
        externalReference: input.externalReference,
        customerReference: input.customerReference,
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency,
        status: ConversionStatus.APPROVED,
        submittedById: input.submittedById,
        reviewedAt: new Date(),
        convertedAt: input.occurredAt,
      },
    });
    if (attribution.coupon) {
      await reserveCouponRedemption(tx, attribution.coupon, conversion.id, CouponRedemptionStatus.CONFIRMED);
    }
    const commission = await createPerformanceCommission(tx, conversion, attribution.campaign);
    await tx.conversionVerification.create({
      data: {
        conversionId: conversion.id,
        integrationId: input.integrationId,
        webhookEventId: input.webhookEventId,
        providerReference: input.providerReference ?? input.externalReference,
        status: VerificationStatus.VERIFIED,
        evidence: input.evidence,
        verifiedAt: new Date(),
      },
    });
    await tx.externalIntegration.update({
      where: { id: input.integrationId },
      data: { lastEventAt: new Date() },
    });
    return {
      conversion,
      commission,
      affiliateUserId: attribution.affiliate.userId,
      campaignName: attribution.campaign.name,
    };
  });
}

function generateSecret(prefix: string) {
  return `${prefix}${crypto.randomBytes(32).toString('base64url')}`;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertNoPlaintextSecrets(value: unknown, path = 'config'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPlaintextSecrets(item, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/(secret|token|password|api.?key|credential|private.?key)/i.test(key)) {
      throw new HttpError(400, `Sensitive value "${path}.${key}" must not be stored in plaintext config`);
    }
    assertNoPlaintextSecrets(nested, `${path}.${key}`);
  }
}

// -------------------- Phase 11: coupon lifecycle --------------------

phase11And12Router.patch('/coupons/:id', ...businessOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = z.object({
    isActive: z.boolean().optional(),
    maxRedemptions: z.number().int().positive().nullable().optional(),
    startsAt: z.coerce.date().nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
  }).refine((value) => Object.keys(value).length > 0, 'Provide at least one field').parse(req.body);
  const { business } = await requireBusiness(req, 'WRITE');
  const coupon = await prisma.coupon.findFirst({
    where: { id, campaign: { businessId: business.id } },
    include: { _count: { select: { redemptions: true } } },
  });
  if (!coupon) throw new HttpError(404, 'Coupon not found');
  const effectiveStartsAt = body.startsAt === undefined ? coupon.startsAt : body.startsAt;
  const effectiveExpiresAt = body.expiresAt === undefined ? coupon.expiresAt : body.expiresAt;
  if (effectiveStartsAt && effectiveExpiresAt && effectiveExpiresAt <= effectiveStartsAt) {
    throw new HttpError(400, 'Expiry must be later than start date');
  }
  const data = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "id" = ${id} FOR UPDATE`;
    if (body.maxRedemptions !== undefined && body.maxRedemptions !== null) {
      const used = await tx.couponRedemption.count({
        where: { couponId: id, status: { in: [CouponRedemptionStatus.RESERVED, CouponRedemptionStatus.CONFIRMED] } },
      });
      if (body.maxRedemptions < used) throw new HttpError(409, 'Maximum redemptions cannot be lower than existing reservations');
    }
    return tx.coupon.update({ where: { id }, data: body });
  });
  await audit(current(req).userId, 'COUPON_UPDATED', 'Coupon', id, toJson(body));
  res.json({ success: true, data });
});

// -------------------- Phase 11: conversion lifecycle --------------------

phase11And12Router.post('/businesses/conversions', ...businessOnly, async (req, res) => {
  const body = z.object({
    referralCode: z.string().min(5).optional(),
    couponCode: z.string().min(3).optional(),
    visitorId: z.string().min(8).max(200).optional(),
    campaignId: z.string().optional(),
    externalReference: z.string().min(2).max(160),
    amount: z.number().positive(),
    currency: z.string().length(3).transform((v) => v.toUpperCase()).default('NGN'),
    customerReference: z.string().max(160).optional(),
    evidenceUrl: z.string().url().optional(),
    convertedAt: z.coerce.date().optional(),
  }).refine((v) => Boolean(v.referralCode || v.couponCode || (v.visitorId && v.campaignId)), {
    message: 'Provide referralCode, couponCode, or campaignId with visitorId',
  }).parse(req.body);
  const { business } = await requireBusiness(req, 'WRITE');
  try {
    const result = await createManualConversion({
      businessId: business.id,
      submittedById: current(req).userId,
      ...body,
    });
    await notify(result.affiliateUserId, NotificationType.CONVERSION, 'New conversion submitted', 'A business submitted a conversion for review.');
    res.status(201).json({ success: true, data: result.conversion });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'A conversion with this external reference already exists');
    }
    throw error;
  }
});

phase11And12Router.patch('/businesses/conversions/:id/review', ...businessOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = z.object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    rejectionReason: z.string().max(1000).optional(),
  }).parse(req.body);
  const { business } = await requireBusiness(req, 'WRITE');
  const existing = await prisma.conversion.findFirst({
    where: { id, campaign: { businessId: business.id } },
    include: { campaign: true, affiliate: { include: { user: true } }, couponRedemption: true },
  });
  if (!existing) throw new HttpError(404, 'Conversion not found');
  if (existing.status !== ConversionStatus.PENDING) throw new HttpError(409, 'Only pending conversions can be reviewed');
  if (body.decision === 'REJECTED' && !body.rejectionReason) throw new HttpError(400, 'Rejection reason is required');

  const result = await prisma.$transaction(async (tx) => {
    const changed = await tx.conversion.updateMany({
      where: { id, status: ConversionStatus.PENDING },
      data: {
        status: body.decision,
        rejectionReason: body.rejectionReason,
        reviewedAt: new Date(),
        reviewedById: current(req).userId,
      },
    });
    if (changed.count !== 1) throw new HttpError(409, 'Conversion was already reviewed');
    if (existing.couponRedemption) {
      await tx.couponRedemption.update({
        where: { conversionId: id },
        data: { status: body.decision === 'APPROVED' ? CouponRedemptionStatus.CONFIRMED : CouponRedemptionStatus.RELEASED },
      });
    }
    await tx.conversionVerification.updateMany({
      where: { conversionId: id, status: VerificationStatus.PENDING },
      data: {
        status: body.decision === 'APPROVED' ? VerificationStatus.VERIFIED : VerificationStatus.FAILED,
        verifiedAt: body.decision === 'APPROVED' ? new Date() : null,
        failureReason: body.decision === 'REJECTED' ? body.rejectionReason : null,
      },
    });
    let commission = null;
    if (body.decision === 'APPROVED') {
      commission = await createPerformanceCommission(tx, existing, existing.campaign);
    }
    return { commission };
  });
  await audit(current(req).userId, `CONVERSION_${body.decision}`, 'Conversion', id, { reason: body.rejectionReason ?? '' });
  await notify(existing.affiliate.userId, NotificationType.CONVERSION, `Conversion ${body.decision.toLowerCase()}`, `Your conversion was ${body.decision.toLowerCase()}.`);
  res.json({ success: true, data: { id, status: body.decision, commission: result.commission } });
});

// -------------------- Phase 11: creator profiles and fixed-fee work --------------------

phase11And12Router.get('/creators/me', ...affiliateOnly, async (req, res) => {
  const affiliate = await affiliateForUser(current(req).userId);
  const data = await prisma.creatorProfile.findUnique({ where: { affiliateId: affiliate.id } });
  res.json({ success: true, data });
});

phase11And12Router.put('/creators/me', ...affiliateOnly, async (req, res) => {
  const affiliate = await affiliateForUser(current(req).userId);
  const body = z.object({
    displayName: z.string().min(2).max(100),
    bio: z.string().max(2000).optional(),
    niches: z.array(z.string().min(1).max(60)).max(30).default([]),
    country: z.string().min(2).max(80).default('Nigeria'),
    city: z.string().max(100).optional(),
    languages: z.array(z.string().min(2).max(50)).max(20).default([]),
    portfolioUrl: z.string().url().optional(),
    mediaKitUrl: z.string().url().optional(),
    socialProfiles: z.record(z.string(), z.string().url()).optional(),
    audienceSize: z.number().int().nonnegative().optional(),
    engagementRate: z.number().min(0).max(100).optional(),
    status: z.enum(['ACTIVE', 'PAUSED']).default('ACTIVE'),
  }).parse(req.body);
  const data = await prisma.creatorProfile.upsert({
    where: { affiliateId: affiliate.id },
    create: { ...body, affiliateId: affiliate.id },
    update: body,
  });
  await audit(current(req).userId, 'CREATOR_PROFILE_UPDATED', 'CreatorProfile', data.id);
  res.json({ success: true, data });
});

phase11And12Router.get('/creators', ...businessOnly, async (req, res) => {
  await requireBusiness(req, 'READ');
  const query = z.object({
    niche: z.string().optional(),
    country: z.string().optional(),
    city: z.string().optional(),
    minAudience: z.coerce.number().int().nonnegative().optional(),
    maxAudience: z.coerce.number().int().nonnegative().optional(),
    minEngagement: z.coerce.number().min(0).max(100).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }).parse(req.query);
  const where: Prisma.CreatorProfileWhereInput = {
    status: 'ACTIVE',
    ...(query.niche ? { niches: { has: query.niche } } : {}),
    ...(query.country ? { country: { equals: query.country, mode: 'insensitive' } } : {}),
    ...(query.city ? { city: { equals: query.city, mode: 'insensitive' } } : {}),
    ...(query.minAudience !== undefined || query.maxAudience !== undefined
      ? { audienceSize: { ...(query.minAudience !== undefined ? { gte: query.minAudience } : {}), ...(query.maxAudience !== undefined ? { lte: query.maxAudience } : {}) } }
      : {}),
    ...(query.minEngagement !== undefined ? { engagementRate: { gte: query.minEngagement } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.creatorProfile.findMany({
      where,
      include: { affiliate: { include: { user: { select: { id: true, fullName: true } } } } },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: [{ audienceSize: 'desc' }, { updatedAt: 'desc' }],
    }),
    prisma.creatorProfile.count({ where }),
  ]);
  res.json({ success: true, data, meta: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } });
});

phase11And12Router.get('/creators/:id', auth, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const data = await prisma.creatorProfile.findFirst({
    where: { id, status: 'ACTIVE' },
    include: { affiliate: { include: { user: { select: { id: true, fullName: true } } } } },
  });
  if (!data) throw new HttpError(404, 'Creator not found');
  res.json({ success: true, data });
});

phase11And12Router.post('/creator-campaigns/:campaignId/deliverables', ...affiliateOnly, async (req, res) => {
  const { campaignId } = z.object({ campaignId: z.string().min(1) }).parse(req.params);
  const body = z.object({
    title: z.string().min(2).max(160),
    description: z.string().max(2000).optional(),
    assetUrl: z.string().url(),
    contentType: z.string().max(100).optional(),
  }).parse(req.body);
  const affiliate = await affiliateForUser(current(req).userId);
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, status: CampaignStatus.APPROVED, compensationModel: { in: [CompensationModel.FIXED_FEE, CompensationModel.HYBRID] } },
    include: { business: { select: { userId: true } } },
  });
  if (!campaign) throw new HttpError(404, 'Approved creator campaign not found');
  const application = await prisma.campaignApplication.findUnique({
    where: { campaignId_affiliateId: { campaignId, affiliateId: affiliate.id } },
  });
  if (!application || application.status !== ApplicationStatus.APPROVED) throw new HttpError(403, 'You must be approved for this creator campaign');
  const payment = await prisma.creatorPayment.findUnique({
    where: { campaignId_affiliateId: { campaignId, affiliateId: affiliate.id } },
  });
  if (!payment) {
    await prisma.creatorPayment.create({
      data: { campaignId, affiliateId: affiliate.id, amount: campaign.fixedFeeAmount ?? 0, currency: campaign.currency },
    });
  }
  const data = await prisma.creatorDeliverable.create({ data: { ...body, campaignId, affiliateId: affiliate.id } });
  await notify(campaign.business.userId, NotificationType.CAMPAIGN, 'New creator deliverable submitted', `A creator submitted a deliverable for ${campaign.name}.`);
  res.status(201).json({ success: true, data });
});

phase11And12Router.patch('/creator-campaigns/:campaignId/deliverables/:id', ...affiliateOnly, async (req, res) => {
  const { campaignId, id } = z.object({ campaignId: z.string().min(1), id: z.string().min(1) }).parse(req.params);
  const body = z.object({
    title: z.string().min(2).max(160).optional(),
    description: z.string().max(2000).optional(),
    assetUrl: z.string().url().optional(),
    contentType: z.string().max(100).optional(),
  }).refine((value) => Object.keys(value).length > 0).parse(req.body);
  const affiliate = await affiliateForUser(current(req).userId);
  const existing = await prisma.creatorDeliverable.findFirst({
    where: { id, campaignId, affiliateId: affiliate.id, status: CreatorDeliverableStatus.REVISION_REQUESTED },
  });
  if (!existing) throw new HttpError(404, 'Revision-requested deliverable not found');
  const data = await prisma.creatorDeliverable.update({
    where: { id },
    data: { ...body, status: CreatorDeliverableStatus.SUBMITTED, version: { increment: 1 }, submittedAt: new Date(), reviewedAt: null, reviewNotes: null },
  });
  res.json({ success: true, data });
});

phase11And12Router.get('/creator-campaigns/:campaignId/deliverables', ...affiliateOnly, async (req, res) => {
  const { campaignId } = z.object({ campaignId: z.string().min(1) }).parse(req.params);
  const affiliate = await affiliateForUser(current(req).userId);
  const data = await prisma.creatorDeliverable.findMany({
    where: { campaignId, affiliateId: affiliate.id },
    orderBy: { submittedAt: 'desc' },
  });
  res.json({ success: true, data });
});

phase11And12Router.get('/businesses/campaigns/:id/deliverables', ...businessOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { business } = await requireBusiness(req, 'READ');
  const campaign = await prisma.campaign.findFirst({ where: { id, businessId: business.id } });
  if (!campaign) throw new HttpError(404, 'Campaign not found');
  const data = await prisma.creatorDeliverable.findMany({
    where: { campaignId: id },
    include: { affiliate: { include: { user: { select: { id: true, fullName: true, email: true } } } } },
    orderBy: { submittedAt: 'asc' },
  });
  res.json({ success: true, data });
});

phase11And12Router.patch('/businesses/deliverables/:id/review', ...businessOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = z.object({
    decision: z.enum(['IN_REVIEW', 'APPROVED', 'REVISION_REQUESTED', 'REJECTED']),
    reviewNotes: z.string().max(2000).optional(),
  }).parse(req.body);
  const { business } = await requireBusiness(req, 'WRITE');
  const deliverable = await prisma.creatorDeliverable.findFirst({
    where: { id, campaign: { businessId: business.id } },
    include: { affiliate: { include: { user: true } }, campaign: true },
  });
  if (!deliverable) throw new HttpError(404, 'Deliverable not found');
  const allowed: Record<string, string[]> = {
    SUBMITTED: ['IN_REVIEW', 'APPROVED', 'REVISION_REQUESTED', 'REJECTED'],
    IN_REVIEW: ['APPROVED', 'REVISION_REQUESTED', 'REJECTED'],
    REVISION_REQUESTED: ['IN_REVIEW', 'APPROVED', 'REJECTED'],
  };
  if (!allowed[deliverable.status]?.includes(body.decision)) throw new HttpError(409, 'Invalid deliverable status transition');
  const data = await prisma.$transaction(async (tx) => {
    const updated = await tx.creatorDeliverable.update({
      where: { id },
      data: {
        status: body.decision,
        reviewNotes: body.reviewNotes,
        reviewedById: current(req).userId,
        reviewedAt: body.decision === 'IN_REVIEW' ? null : new Date(),
      },
    });
    if (body.decision === 'APPROVED') {
      const approvedCount = await tx.creatorDeliverable.count({
        where: { campaignId: deliverable.campaignId, affiliateId: deliverable.affiliateId, status: CreatorDeliverableStatus.APPROVED },
      });
      if (approvedCount >= deliverable.campaign.requiredDeliverables) {
        await tx.creatorPayment.updateMany({
          where: { campaignId: deliverable.campaignId, affiliateId: deliverable.affiliateId, status: CreatorPaymentStatus.PENDING },
          data: { status: CreatorPaymentStatus.APPROVED, approvedById: current(req).userId },
        });
      }
    }
    return updated;
  });
  await notify(deliverable.affiliate.userId, NotificationType.CAMPAIGN, `Deliverable ${body.decision.toLowerCase()}`, body.reviewNotes ?? `Your deliverable was marked ${body.decision.toLowerCase()}.`);
  res.json({ success: true, data });
});

phase11And12Router.get('/businesses/campaigns/:id/creator-payments', ...businessOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { business } = await requireBusiness(req, 'READ');
  if (!await prisma.campaign.findFirst({ where: { id, businessId: business.id } })) throw new HttpError(404, 'Campaign not found');
  const data = await prisma.creatorPayment.findMany({
    where: { campaignId: id },
    include: { affiliate: { include: { user: { select: { fullName: true, email: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
});

phase11And12Router.get('/affiliates/creator-payments', ...affiliateOnly, async (req, res) => {
  const affiliate = await affiliateForUser(current(req).userId);
  const data = await prisma.creatorPayment.findMany({
    where: { affiliateId: affiliate.id },
    include: { campaign: { select: { id: true, name: true, business: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
});

phase11And12Router.patch('/businesses/creator-payments/:id', ...businessOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = z.object({
    decision: z.enum(['PROCESSING', 'PAID', 'FAILED']),
    paymentReference: z.string().max(160).optional(),
    paymentProvider: z.string().max(80).optional(),
    adminNote: z.string().max(1000).optional(),
  }).parse(req.body);
  const { business } = await requireBusiness(req, 'ADMIN');
  const payment = await prisma.creatorPayment.findFirst({
    where: { id, campaign: { businessId: business.id } },
    include: { affiliate: { include: { user: true } } },
  });
  if (!payment) throw new HttpError(404, 'Creator payment not found');
  const transitions: Record<string, string[]> = {
    APPROVED: ['PROCESSING', 'PAID', 'FAILED'],
    PROCESSING: ['PAID', 'FAILED'],
    FAILED: ['PROCESSING'],
  };
  if (!transitions[payment.status]?.includes(body.decision)) throw new HttpError(409, 'Invalid creator payment transition');
  const data = await prisma.creatorPayment.update({
    where: { id },
    data: {
      status: body.decision,
      paymentReference: body.paymentReference,
      paymentProvider: body.paymentProvider,
      adminNote: body.adminNote,
      paidAt: body.decision === 'PAID' ? new Date() : null,
    },
  });
  await audit(current(req).userId, `CREATOR_PAYMENT_${body.decision}`, 'CreatorPayment', id);
  await notify(payment.affiliate.userId, NotificationType.COMMISSION, `Creator payment ${body.decision.toLowerCase()}`, body.adminNote ?? `Your creator payment is ${body.decision.toLowerCase()}.`);
  res.json({ success: true, data });
});

// -------------------- Phase 12: private affiliate programmes --------------------

phase11And12Router.post('/businesses/programs', ...businessOnly, async (req, res) => {
  const body = z.object({
    name: z.string().min(3).max(120),
    slug: z.string().min(3).max(70).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    description: z.string().max(3000).optional(),
    requiresApproval: z.boolean().default(true),
    landingPageTitle: z.string().max(160).optional(),
    landingPageDescription: z.string().max(2000).optional(),
    brandColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    customFields: z.array(z.object({
      key: z.string().min(1).max(40),
      label: z.string().min(1).max(100),
      required: z.boolean().default(false),
      type: z.enum(['TEXT', 'URL', 'NUMBER']).default('TEXT'),
    })).max(20).default([]),
  }).parse(req.body);
  const { business } = await requireBusiness(req, 'WRITE');
  if (business.status !== BusinessStatus.APPROVED) throw new HttpError(403, 'Business must be approved');
  const data = await prisma.affiliateProgram.create({
    data: { ...body, businessId: business.id, status: AffiliateProgramStatus.DRAFT },
  });
  await audit(current(req).userId, 'AFFILIATE_PROGRAM_CREATED', 'AffiliateProgram', data.id);
  res.status(201).json({ success: true, data });
});

phase11And12Router.get('/businesses/programs', ...businessOnly, async (req, res) => {
  const { business } = await requireBusiness(req, 'READ');
  const data = await prisma.affiliateProgram.findMany({
    where: { businessId: business.id },
    include: { _count: { select: { memberships: true, campaigns: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
});

phase11And12Router.patch('/businesses/programs/:id', ...businessOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = z.object({
    name: z.string().min(3).max(120).optional(),
    description: z.string().max(3000).optional(),
    status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']).optional(),
    requiresApproval: z.boolean().optional(),
    landingPageTitle: z.string().max(160).optional(),
    landingPageDescription: z.string().max(2000).optional(),
    brandColor: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
    customFields: z.array(z.object({
      key: z.string().min(1).max(40),
      label: z.string().min(1).max(100),
      required: z.boolean().default(false),
      type: z.enum(['TEXT', 'URL', 'NUMBER']).default('TEXT'),
    })).max(20).optional(),
  }).parse(req.body);
  const { business } = await requireBusiness(req, 'WRITE');
  const existing = await prisma.affiliateProgram.findFirst({ where: { id, businessId: business.id } });
  if (!existing) throw new HttpError(404, 'Affiliate programme not found');
  if (body.status === AffiliateProgramStatus.ACTIVE && business.status !== BusinessStatus.APPROVED) {
    throw new HttpError(403, 'Business must be approved before activating an affiliate programme');
  }
  const data = await prisma.affiliateProgram.update({ where: { id }, data: body });
  await audit(current(req).userId, 'AFFILIATE_PROGRAM_UPDATED', 'AffiliateProgram', id, toJson(body));
  res.json({ success: true, data });
});

phase11And12Router.get('/programs/:slug', async (req, res) => {
  const { slug } = z.object({ slug: z.string().min(1) }).parse(req.params);
  const data = await prisma.affiliateProgram.findFirst({
    where: { slug, status: AffiliateProgramStatus.ACTIVE },
    select: {
      id: true, name: true, slug: true, description: true, requiresApproval: true,
      landingPageTitle: true, landingPageDescription: true, brandColor: true, customFields: true,
      business: { select: { name: true, country: true, website: true } },
    },
  });
  if (!data) throw new HttpError(404, 'Affiliate programme not found');
  res.json({ success: true, data });
});

phase11And12Router.post('/programs/:slug/register', async (req, res) => {
  const { slug } = z.object({ slug: z.string().min(1) }).parse(req.params);
  const body = z.object({
    fullName: z.string().min(2).max(120),
    email: z.string().email().transform((value) => value.toLowerCase()),
    phone: z.string().max(40).optional(),
    password: z.string().min(10).max(128),
    answers: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  }).parse(req.body);
  const program = await prisma.affiliateProgram.findFirst({
    where: { slug, status: AffiliateProgramStatus.ACTIVE },
    include: { business: { select: { userId: true } } },
  });
  if (!program) throw new HttpError(404, 'Affiliate programme not found');
  const fields = z.array(z.object({
    key: z.string(), label: z.string(), required: z.boolean().optional(),
    type: z.enum(['TEXT', 'URL', 'NUMBER']).optional(),
  })).safeParse(program.customFields ?? []);
  if (!fields.success) throw new HttpError(500, 'Programme registration fields are misconfigured');
  {
    for (const field of fields.data) {
      const value = body.answers[field.key];
      if (field.required && (value === undefined || value === '')) {
        throw new HttpError(400, `Required registration field missing: ${field.label}`);
      }
      if (value !== undefined && field.type === 'URL' && (typeof value !== 'string' || !z.string().url().safeParse(value).success)) {
        throw new HttpError(400, `Invalid URL for registration field: ${field.label}`);
      }
      if (value !== undefined && field.type === 'NUMBER' && typeof value !== 'number') {
        throw new HttpError(400, `Numeric value required for registration field: ${field.label}`);
      }
      if (value !== undefined && (field.type === 'TEXT' || !field.type) && typeof value !== 'string') {
        throw new HttpError(400, `Text value required for registration field: ${field.label}`);
      }
    }
  }
  const passwordHash = await bcrypt.hash(body.password, 12);
  const status = program.requiresApproval ? ProgramMembershipStatus.PENDING : ProgramMembershipStatus.APPROVED;
  try {
    const user = await prisma.user.create({
      data: {
        fullName: body.fullName,
        email: body.email,
        phone: body.phone,
        passwordHash,
        role: Role.AFFILIATE,
        affiliate: {
          create: {
            programMemberships: {
              create: {
                programId: program.id,
                status,
                source: 'CUSTOM_REGISTRATION',
                answers: toJson(body.answers),
              },
            },
          },
        },
      },
      select: { id: true, fullName: true, email: true, role: true, createdAt: true },
    });
    await notify(program.business.userId, NotificationType.APPLICATION, 'New affiliate programme registration', `${body.fullName} registered for ${program.name}.`);
    res.status(201).json({ success: true, data: { user, membershipStatus: status } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'An account with this email already exists');
    }
    throw error;
  }
});

phase11And12Router.get('/programs/:slug/campaigns', ...affiliateOnly, async (req, res) => {
  const { slug } = z.object({ slug: z.string().min(1) }).parse(req.params);
  const affiliate = await affiliateForUser(current(req).userId);
  const program = await prisma.affiliateProgram.findFirst({
    where: { slug, status: AffiliateProgramStatus.ACTIVE },
  });
  if (!program) throw new HttpError(404, 'Affiliate programme not found');
  const membership = await prisma.programMembership.findUnique({
    where: { programId_affiliateId: { programId: program.id, affiliateId: affiliate.id } },
  });
  if (!membership || membership.status !== ProgramMembershipStatus.APPROVED) {
    throw new HttpError(403, 'Approved programme membership required');
  }
  const data = await prisma.campaign.findMany({
    where: { programId: program.id, status: CampaignStatus.APPROVED },
    include: { business: { select: { name: true, country: true } }, product: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
});

phase11And12Router.post('/programs/:slug/apply', ...affiliateOnly, async (req, res) => {
  const { slug } = z.object({ slug: z.string().min(1) }).parse(req.params);
  const body = z.object({ answers: z.record(z.string(), z.union([z.string(), z.number()])).optional() }).parse(req.body ?? {});
  const affiliate = await affiliateForUser(current(req).userId);
  const program = await prisma.affiliateProgram.findFirst({
    where: { slug, status: AffiliateProgramStatus.ACTIVE },
    include: { business: { select: { userId: true } } },
  });
  if (!program) throw new HttpError(404, 'Affiliate programme not found');
  const status = program.requiresApproval ? ProgramMembershipStatus.PENDING : ProgramMembershipStatus.APPROVED;
  const data = await prisma.programMembership.upsert({
    where: { programId_affiliateId: { programId: program.id, affiliateId: affiliate.id } },
    create: { programId: program.id, affiliateId: affiliate.id, status, source: 'REGISTRATION_PAGE', answers: toJson(body.answers ?? {}) },
    update: { status, source: 'REGISTRATION_PAGE', answers: toJson(body.answers ?? {}), appliedAt: new Date() },
  });
  await audit(current(req).userId, 'PROGRAM_APPLICATION_SUBMITTED', 'ProgramMembership', data.id, toJson(body.answers ?? {}));
  await notify(program.business.userId, NotificationType.APPLICATION, 'New affiliate programme application', 'An affiliate applied to your programme.');
  res.status(201).json({ success: true, data });
});

phase11And12Router.get('/businesses/programs/:id/members', ...businessOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { business } = await requireBusiness(req, 'READ');
  if (!await prisma.affiliateProgram.findFirst({ where: { id, businessId: business.id } })) throw new HttpError(404, 'Affiliate programme not found');
  const data = await prisma.programMembership.findMany({
    where: { programId: id },
    include: { affiliate: { include: { user: { select: { id: true, fullName: true, email: true } } } } },
    orderBy: { appliedAt: 'desc' },
  });
  res.json({ success: true, data });
});

phase11And12Router.patch('/businesses/program-memberships/:id', ...businessOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = z.object({ decision: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']) }).parse(req.body);
  const { business } = await requireBusiness(req, 'WRITE');
  const membership = await prisma.programMembership.findFirst({
    where: { id, program: { businessId: business.id } },
    include: { affiliate: { include: { user: true } } },
  });
  if (!membership) throw new HttpError(404, 'Programme membership not found');
  const data = await prisma.programMembership.update({
    where: { id },
    data: { status: body.decision, reviewedAt: new Date(), reviewedById: current(req).userId },
  });
  await audit(current(req).userId, `PROGRAM_MEMBERSHIP_${body.decision}`, 'ProgramMembership', id);
  await notify(membership.affiliate.userId, NotificationType.APPLICATION, `Programme application ${body.decision.toLowerCase()}`, `Your affiliate programme application was ${body.decision.toLowerCase()}.`);
  res.json({ success: true, data });
});

// -------------------- Phase 12: business team and enterprise permissions --------------------

phase11And12Router.get('/businesses/members', ...businessOnly, async (req, res) => {
  const { business } = await requireBusiness(req, 'READ');
  const [owner, members] = await Promise.all([
    prisma.user.findUnique({
      where: { id: business.userId },
      select: { id: true, fullName: true, email: true, isActive: true },
    }),
    prisma.businessMember.findMany({
      where: { businessId: business.id },
      include: { user: { select: { id: true, fullName: true, email: true, isActive: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const data = [
    ...(owner ? [{ id: null, role: 'OWNER', isActive: true, user: owner, isOwner: true }] : []),
    ...members.map((member: any) => ({ ...member, isOwner: false })),
  ];
  res.json({ success: true, data });
});

phase11And12Router.post('/businesses/members', ...businessOnly, async (req, res) => {
  const body = z.object({
    email: z.string().email().transform((value) => value.toLowerCase()),
    role: z.enum(['ADMIN', 'MANAGER', 'ANALYST']),
  }).parse(req.body);
  const { business, role } = await requireBusiness(req, 'ADMIN');
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || user.role !== Role.BUSINESS || !user.isActive) throw new HttpError(404, 'Active business user not found');
  if (user.id === business.userId) throw new HttpError(409, 'Business owner is already a member');
  const data = await prisma.businessMember.upsert({
    where: { businessId_userId: { businessId: business.id, userId: user.id } },
    create: { businessId: business.id, userId: user.id, role: body.role, invitedById: current(req).userId },
    update: { role: body.role, isActive: true, invitedById: current(req).userId },
  });
  await audit(current(req).userId, 'BUSINESS_MEMBER_ADDED', 'BusinessMember', data.id, { role: body.role });
  res.status(201).json({ success: true, data });
});

phase11And12Router.patch('/businesses/members/:id', ...businessOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = z.object({
    role: z.enum(['ADMIN', 'MANAGER', 'ANALYST']).optional(),
    isActive: z.boolean().optional(),
  }).refine((v) => Object.keys(v).length > 0).parse(req.body);
  const { business } = await requireBusiness(req, 'ADMIN');
  const member = await prisma.businessMember.findFirst({ where: { id, businessId: business.id } });
  if (!member) throw new HttpError(404, 'Business member not found');
  const data = await prisma.businessMember.update({ where: { id }, data: body });
  await audit(current(req).userId, 'BUSINESS_MEMBER_UPDATED', 'BusinessMember', id, toJson(body));
  res.json({ success: true, data });
});

// -------------------- Phase 12: integrations, API reporting and webhooks --------------------

phase11And12Router.post('/businesses/integrations', ...businessOnly, async (req, res) => {
  const body = z.object({
    name: z.string().min(2).max(120),
    kind: z.enum(['PAYMENT', 'ECOMMERCE', 'TRACKING', 'CONVERSION_REPORTING']),
    provider: z.enum(['GENERIC_HMAC', 'SHOPIFY', 'WOOCOMMERCE']).default('GENERIC_HMAC'),
    campaignId: z.string().optional(),
    webhookSecret: z.string().min(16).optional(),
    allowedDomains: z.array(z.string().min(3).max(255).regex(/^[a-z0-9.-]+$/i, 'Use hostnames only, without protocol or path')).max(30).default([]),
    config: z.record(z.string(), z.unknown()).optional(),
  }).parse(req.body);
  const { business } = await requireBusiness(req, 'ADMIN');
  if (business.status !== BusinessStatus.APPROVED) throw new HttpError(403, 'Business must be approved');
  if (body.config) assertNoPlaintextSecrets(body.config);
  if (body.kind !== IntegrationKind.TRACKING && !body.webhookSecret) {
    throw new HttpError(400, 'webhookSecret is required for payment, ecommerce and conversion-reporting integrations');
  }
  if (body.kind === IntegrationKind.TRACKING && !body.campaignId) {
    throw new HttpError(400, 'Tracking integrations must be assigned to a campaign');
  }
  if (body.campaignId && !await prisma.campaign.findFirst({ where: { id: body.campaignId, businessId: business.id, status: CampaignStatus.APPROVED } })) {
    throw new HttpError(404, 'Approved campaign not found for this business');
  }
  const credentials = body.webhookSecret ? encryptCredentials({ webhookSecret: body.webhookSecret }) : null;
  const publicKey = generateSecret('flw_pub_');
  const data = await prisma.externalIntegration.create({
    data: {
      businessId: business.id,
      campaignId: body.campaignId,
      createdById: current(req).userId,
      name: body.name,
      kind: body.kind,
      provider: body.provider,
      publicKey,
      encryptedCredentials: credentials,
      allowedDomains: body.allowedDomains,
      config: body.config ? toJson(body.config) : undefined,
    },
  });
  await audit(current(req).userId, 'INTEGRATION_CREATED', 'ExternalIntegration', data.id, { provider: data.provider, kind: data.kind });
  res.status(201).json({
    success: true,
    data: {
      id: data.id, name: data.name, kind: data.kind, provider: data.provider,
      status: data.status, publicKey: data.publicKey,
      webhookUrl: `${env.API_PUBLIC_URL}/webhooks/${data.id}`,
      trackingEndpoint: `${env.API_PUBLIC_URL}/api/v1/tracking/${data.publicKey}/events`,
      trackingSnippet: data.kind === IntegrationKind.TRACKING
        ? `<script async src="${env.API_PUBLIC_URL}/api/v1/tracking.js" data-key="${data.publicKey}" data-endpoint="${env.API_PUBLIC_URL}/api/v1"></script>`
        : undefined,
    },
  });
});

phase11And12Router.get('/businesses/integrations', ...businessOnly, async (req, res) => {
  const { business } = await requireBusiness(req, 'READ');
  const data = await prisma.externalIntegration.findMany({
    where: { businessId: business.id },
    select: {
      id: true, name: true, kind: true, provider: true, status: true, publicKey: true,
      campaignId: true, allowedDomains: true, lastEventAt: true, createdAt: true,
      _count: { select: { webhookEvents: true, apiKeys: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
});

phase11And12Router.patch('/businesses/integrations/:id/status', ...businessOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'REVOKED']) }).parse(req.body);
  const { business } = await requireBusiness(req, 'ADMIN');
  const integration = await prisma.externalIntegration.findFirst({ where: { id, businessId: business.id } });
  if (!integration) throw new HttpError(404, 'Integration not found');
  const allowed: Record<string, string[]> = {
    ACTIVE: ['PAUSED', 'REVOKED'],
    PAUSED: ['ACTIVE', 'REVOKED'],
  };
  if (!allowed[integration.status]?.includes(body.status)) throw new HttpError(409, 'Invalid integration status transition');
  const data = await prisma.externalIntegration.update({ where: { id }, data: { status: body.status } });
  await audit(current(req).userId, `INTEGRATION_${body.status}`, 'ExternalIntegration', id);
  res.json({ success: true, data: { id: data.id, status: data.status } });
});

phase11And12Router.post('/businesses/integrations/:id/api-keys', ...businessOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = z.object({
    name: z.string().min(2).max(100),
    scopes: z.array(z.enum(['conversions:write'])).min(1).default(['conversions:write']),
    expiresAt: z.coerce.date().optional(),
  }).parse(req.body);
  const { business } = await requireBusiness(req, 'ADMIN');
  const integration = await prisma.externalIntegration.findFirst({ where: { id, businessId: business.id, status: IntegrationStatus.ACTIVE } });
  if (!integration) throw new HttpError(404, 'Active integration not found');
  const secret = generateSecret('flw_live_');
  const data = await prisma.integrationApiKey.create({
    data: {
      integrationId: id, name: body.name, keyPrefix: secret.slice(0, 14),
      keyHash: sha256(secret), scopes: body.scopes, expiresAt: body.expiresAt,
    },
  });
  await audit(current(req).userId, 'INTEGRATION_API_KEY_CREATED', 'IntegrationApiKey', data.id, { integrationId: id, scopes: body.scopes });
  res.status(201).json({ success: true, data: { id: data.id, name: data.name, key: secret, keyPrefix: data.keyPrefix, scopes: data.scopes, expiresAt: data.expiresAt } });
});

phase11And12Router.patch('/businesses/integrations/:id/credentials', ...businessOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = z.object({ webhookSecret: z.string().min(16) }).parse(req.body);
  const { business } = await requireBusiness(req, 'ADMIN');
  const integration = await prisma.externalIntegration.findFirst({ where: { id, businessId: business.id } });
  if (!integration) throw new HttpError(404, 'Integration not found');
  const encryptedCredentials = encryptCredentials({ webhookSecret: body.webhookSecret });
  await prisma.externalIntegration.update({ where: { id }, data: { encryptedCredentials } });
  await audit(current(req).userId, 'INTEGRATION_SECRET_ROTATED', 'ExternalIntegration', id);
  res.json({ success: true, data: { id, credentialsUpdated: true } });
});

phase11And12Router.get('/businesses/integrations/:id/api-keys', ...businessOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { business } = await requireBusiness(req, 'ADMIN');
  if (!await prisma.externalIntegration.findFirst({ where: { id, businessId: business.id } })) throw new HttpError(404, 'Integration not found');
  const data = await prisma.integrationApiKey.findMany({
    where: { integrationId: id },
    select: { id: true, name: true, keyPrefix: true, scopes: true, expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
});

phase11And12Router.delete('/businesses/integrations/:id/api-keys/:keyId', ...businessOnly, async (req, res) => {
  const { id, keyId } = z.object({ id: z.string().min(1), keyId: z.string().min(1) }).parse(req.params);
  const { business } = await requireBusiness(req, 'ADMIN');
  const key = await prisma.integrationApiKey.findFirst({
    where: { id: keyId, integrationId: id, integration: { businessId: business.id } },
  });
  if (!key) throw new HttpError(404, 'Integration API key not found');
  const data = await prisma.integrationApiKey.update({
    where: { id: keyId },
    data: { revokedAt: key.revokedAt ?? new Date() },
    select: { id: true, revokedAt: true },
  });
  await audit(current(req).userId, 'INTEGRATION_API_KEY_REVOKED', 'IntegrationApiKey', keyId);
  res.json({ success: true, data });
});

phase11And12Router.get('/businesses/integrations/:id/events', ...businessOnly, async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { business } = await requireBusiness(req, 'READ');
  const integration = await prisma.externalIntegration.findFirst({ where: { id, businessId: business.id } });
  if (!integration) throw new HttpError(404, 'Integration not found');
  const data = await prisma.webhookEvent.findMany({
    where: { integrationId: id },
    select: { id: true, externalEventId: true, eventType: true, authMethod: true, signatureVerified: true, status: true, attempts: true, lastError: true, processedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ success: true, data });
});

async function integrationApiKey(req: Request, integrationId: string, requiredScope: string) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Integration API key required');
  const key = await prisma.integrationApiKey.findFirst({
    where: { integrationId, keyHash: sha256(token), revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    include: { integration: true },
  });
  if (!key || key.integration.status !== IntegrationStatus.ACTIVE) throw new HttpError(401, 'Invalid or expired integration API key');
  if (!key.scopes.includes(requiredScope)) throw new HttpError(403, 'Integration API key lacks required scope');
  await prisma.integrationApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return key.integration;
}

phase11And12Router.post('/integrations/:id/conversions', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const integration = await integrationApiKey(req, id, 'conversions:write');
  if (integration.kind !== IntegrationKind.CONVERSION_REPORTING && integration.kind !== IntegrationKind.PAYMENT) {
    throw new HttpError(403, 'Integration is not enabled for conversion reporting');
  }
  const body = z.object({
    eventId: z.string().min(2).max(160),
    campaignId: z.string().optional(),
    referralCode: z.string().min(5).optional(),
    couponCode: z.string().min(3).optional(),
    externalReference: z.string().min(2).max(160),
    customerReference: z.string().max(160).optional(),
    amount: z.number().positive(),
    currency: z.string().length(3).transform((v) => v.toUpperCase()).default('NGN'),
    convertedAt: z.coerce.date().optional(),
  }).refine((v) => Boolean(v.referralCode || v.couponCode), 'Provide referralCode or couponCode').parse(req.body);

  let event = await prisma.webhookEvent.findUnique({
    where: { integrationId_externalEventId: { integrationId: id, externalEventId: body.eventId } },
  });
  const safeReportPayload = toJson({
    externalReference: body.externalReference,
    campaignId: body.campaignId ?? integration.campaignId ?? null,
    referralCode: body.referralCode ?? null,
    couponCode: body.couponCode ?? null,
    amount: body.amount,
    currency: body.currency,
  });
  if (event && stableStringify(event.payload) !== stableStringify(safeReportPayload)) {
    throw new HttpError(409, 'eventId has already been used with a different payload');
  }
  if (event?.status === WebhookEventStatus.PROCESSED) {
    res.status(200).json({ success: true, data: { duplicate: true } });
    return;
  }
  if (event?.status === WebhookEventStatus.PROCESSING && Date.now() - event.updatedAt.getTime() < 120_000) {
    res.status(202).json({ success: true, data: { accepted: true, processing: true } });
    return;
  }
  if (event) {
    event = await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: WebhookEventStatus.PROCESSING, attempts: { increment: 1 }, lastError: null },
    });
  } else {
    try {
      event = await prisma.webhookEvent.create({
        data: {
          integrationId: id,
          externalEventId: body.eventId,
          eventType: 'external.conversion.reported',
          authMethod: 'API_KEY',
          payload: safeReportPayload,
          signatureVerified: false,
          status: WebhookEventStatus.PROCESSING,
          attempts: 1,
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      res.status(200).json({ success: true, data: { duplicate: true } });
      return;
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const attribution = await resolveAttribution(tx, {
        businessId: integration.businessId,
        campaignId: body.campaignId ?? integration.campaignId ?? undefined,
        referralCode: body.referralCode,
        couponCode: body.couponCode,
      });
      if (attribution.campaign.currency !== body.currency) throw new HttpError(400, 'Currency must match campaign currency');
      const conversion = await tx.conversion.create({
        data: {
          campaignId: attribution.campaign.id,
          affiliateId: attribution.affiliate.id,
          referralId: attribution.referral?.id,
          couponId: attribution.coupon?.id,
          integrationId: integration.id,
          attributionSource: AttributionSource.TRACKING_API,
          externalReference: body.externalReference,
          customerReference: body.customerReference,
          amount: new Prisma.Decimal(body.amount),
          currency: body.currency,
          convertedAt: body.convertedAt,
          submittedById: integration.createdById,
        },
      });
      if (attribution.coupon) await reserveCouponRedemption(tx, attribution.coupon, conversion.id, CouponRedemptionStatus.RESERVED);
      await tx.conversionVerification.create({
        data: {
          conversionId: conversion.id,
          integrationId: integration.id,
          webhookEventId: event!.id,
          providerReference: body.eventId,
          status: VerificationStatus.PENDING,
          evidence: toJson({
            eventId: body.eventId,
            externalReference: body.externalReference,
            campaignId: body.campaignId ?? integration.campaignId ?? null,
            referralCode: body.referralCode ?? null,
            couponCode: body.couponCode ?? null,
            amount: body.amount,
            currency: body.currency,
            convertedAt: body.convertedAt?.toISOString() ?? null,
          }),
        },
      });
      await tx.webhookEvent.update({
        where: { id: event!.id },
        data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date(), lastError: null },
      });
      return { conversion, affiliateUserId: attribution.affiliate.userId };
    });
    await notify(result.affiliateUserId, NotificationType.CONVERSION, 'Conversion reported', 'An integration reported a conversion for review.');
    res.status(201).json({ success: true, data: result.conversion });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date(), lastError: null } });
      res.status(200).json({ success: true, data: { duplicate: true } });
      return;
    }
    const message = error instanceof Error ? error.message : 'External conversion processing failed';
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: WebhookEventStatus.FAILED, lastError: message.slice(0, 1000) } });
    throw error;
  }
});

phase11And12Router.post('/webhooks/:id', async (req, res) => {
  const { id } = idParams.parse(req.params);
  const integration = await prisma.externalIntegration.findUnique({ where: { id } });
  if (!integration || integration.status !== IntegrationStatus.ACTIVE) throw new HttpError(404, 'Active integration not found');
  if (integration.kind === IntegrationKind.TRACKING) throw new HttpError(403, 'Tracking integrations do not accept payment webhooks');
  if (!integration.encryptedCredentials) throw new HttpError(409, 'Webhook signing secret is not configured');
  const credentials = decryptCredentials(integration.encryptedCredentials);
  if (!credentials.webhookSecret) throw new HttpError(409, 'Webhook signing secret is not configured');
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) throw new HttpError(400, 'Raw request body is required for signature verification');
  const signature = req.get('x-flyover-signature')
    ?? req.get('x-shopify-hmac-sha256')
    ?? req.get('x-wc-webhook-signature');
  if (!verifyWebhookSignature(integration.provider, rawBody, credentials.webhookSecret, signature)) {
    throw new HttpError(401, 'Invalid webhook signature', 'INVALID_SIGNATURE');
  }
  const payload = req.body as unknown;
  const normalized = normalizeWebhook(integration.provider, payload);
  const eventObj = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const eventId = normalized?.externalEventId ?? String(eventObj.id ?? req.get('x-webhook-id') ?? '');
  if (!eventId) throw new HttpError(400, 'Webhook event ID is required');

  let event = await prisma.webhookEvent.findUnique({
    where: { integrationId_externalEventId: { integrationId: id, externalEventId: eventId } },
  });
  const safeWebhookPayload = normalized?.raw ?? toJson({ eventId, eventType: String(eventObj.type ?? 'unmapped') });
  if (event && stableStringify(event.payload) !== stableStringify(safeWebhookPayload)) {
    throw new HttpError(409, 'Webhook event ID has already been used with a different payload');
  }
if (
    event &&
    (event.status === WebhookEventStatus.PROCESSED ||
      event.status === WebhookEventStatus.IGNORED)
  ) {
    res.status(200).json({ success: true, data: { duplicate: true } });
    return;
  }
  if (event && event.status === WebhookEventStatus.PROCESSING && Date.now() - event.updatedAt.getTime() < 120_000) {
    res.status(202).json({ success: true, data: { accepted: true, processing: true } });
    return;
  }
  if (event) {
    event = await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: WebhookEventStatus.RECEIVED,
        lastError: null,
        payload: safeWebhookPayload,
      },
    });
  } else {
    try {
      event = await prisma.webhookEvent.create({
        data: {
          integrationId: id,
          externalEventId: eventId,
          eventType: normalized?.eventType ?? String(eventObj.type ?? 'unmapped'),
          payload: safeWebhookPayload,
          signatureVerified: true,
          status: WebhookEventStatus.RECEIVED,
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      event = await prisma.webhookEvent.findUniqueOrThrow({
        where: { integrationId_externalEventId: { integrationId: id, externalEventId: eventId } },
      });
      if (
        event.status === WebhookEventStatus.PROCESSED ||
        event.status === WebhookEventStatus.IGNORED
      ) {
        res.status(200).json({ success: true, data: { duplicate: true } });
        return;
      }
      if (event.status === WebhookEventStatus.PROCESSING) {
        res.status(202).json({ success: true, data: { accepted: true, processing: true } });
        return;
      }
    }
  }

  if (!normalized) {
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: WebhookEventStatus.IGNORED, processedAt: new Date() } });
    res.status(202).json({ success: true, data: { accepted: true, ignored: true } });
    return;
  }
  try {
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: WebhookEventStatus.PROCESSING, attempts: { increment: 1 } } });
    const result = await processVerifiedConversion({
      integrationId: id,
      businessId: integration.businessId,
      submittedById: integration.createdById,
      campaignId: normalized.campaignId ?? integration.campaignId ?? undefined,
      referralCode: normalized.referralCode,
      couponCode: normalized.couponCode,
      externalReference: normalized.externalReference,
      customerReference: normalized.customerReference,
      amount: normalized.amount,
      currency: normalized.currency,
      occurredAt: normalized.occurredAt,
      providerReference: normalized.externalEventId,
      evidence: normalized.raw,
      webhookEventId: event.id,
    });
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date() } });
    await notify(result.affiliateUserId, NotificationType.CONVERSION, 'Conversion automatically verified', `A conversion for ${result.campaignName} was verified by an integration.`);
    res.status(200).json({ success: true, data: { accepted: true, conversionId: result.conversion.id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed';
    await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: WebhookEventStatus.FAILED, lastError: message.slice(0, 1000) } });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date(), lastError: null } });
      res.status(200).json({ success: true, data: { duplicate: true } });
      return;
    }
    throw error;
  }
});

// Retry a previously signature-verified webhook after a transient processing failure.
phase11And12Router.post('/businesses/integrations/:id/events/:eventRecordId/retry', ...businessOnly, async (req, res) => {
  const { id, eventRecordId } = z.object({ id: z.string().min(1), eventRecordId: z.string().min(1) }).parse(req.params);
  const { business } = await requireBusiness(req, 'ADMIN');
  const integration = await prisma.externalIntegration.findFirst({ where: { id, businessId: business.id, status: IntegrationStatus.ACTIVE } });
  if (!integration) throw new HttpError(404, 'Active integration not found');
  const event = await prisma.webhookEvent.findFirst({ where: { id: eventRecordId, integrationId: id, signatureVerified: true, authMethod: 'WEBHOOK_HMAC' } });
  if (!event) throw new HttpError(404, 'Verified webhook event not found');
  if (event.status !== WebhookEventStatus.FAILED) throw new HttpError(409, 'Only failed webhook events can be retried');
  const payload = event.payload as Record<string, unknown>;
  let result: Awaited<ReturnType<typeof processVerifiedConversion>>;
  try {
    result = await processVerifiedConversion({
      integrationId: id,
      businessId: business.id,
      submittedById: integration.createdById,
      campaignId: typeof payload.campaignId === 'string' ? payload.campaignId : integration.campaignId ?? undefined,
      referralCode: typeof payload.referralCode === 'string' ? payload.referralCode : undefined,
      couponCode: typeof payload.couponCode === 'string' ? payload.couponCode : undefined,
      externalReference: String(payload.externalReference ?? ''),
      customerReference: typeof payload.customerReference === 'string' ? payload.customerReference : undefined,
      amount: String(payload.amount ?? ''),
      currency: String(payload.currency ?? 'NGN'),
      providerReference: event.externalEventId,
      evidence: event.payload as Prisma.InputJsonValue,
      webhookEventId: event.id,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date(), lastError: null } });
      res.status(200).json({ success: true, data: { duplicate: true } });
      return;
    }
    throw error;
  }
  await prisma.webhookEvent.update({ where: { id: event.id }, data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date(), attempts: { increment: 1 }, lastError: null } });
  await notify(result.affiliateUserId, NotificationType.CONVERSION, 'Conversion automatically verified', `A conversion for ${result.campaignName} was verified by an integration.`);
  res.json({ success: true, data: { conversionId: result.conversion.id } });
});

// -------------------- Phase 12: tracking SDK endpoint --------------------

phase11And12Router.get('/tracking.js', (_req, res) => {
  res.type('application/javascript').send(`(function(){if(window.FlyoverTrack)return;var s=document.currentScript;if(!s)return;var key=s.dataset.key;if(!key)return;var endpoint=s.dataset.endpoint||'';var params=new URLSearchParams(location.search);var visitor=localStorage.getItem('flyover_visitor')||params.get('flyover_visitor')||(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random());localStorage.setItem('flyover_visitor',visitor);var referral=params.get('flyover_ref');window.FlyoverTrack={track:function(type,data){return fetch(endpoint+'/tracking/'+encodeURIComponent(key)+'/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({eventId:(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random()),eventType:type,visitorId:visitor,referralCode:referral||undefined,pageUrl:location.href,referrer:document.referrer},data||{})),keepalive:true}).catch(function(){return null;});}};window.FlyoverTrack.track('PAGE_VIEW');})();`);
});

phase11And12Router.post('/tracking/:publicKey/events', async (req, res) => {
  const { publicKey } = z.object({ publicKey: z.string().min(10) }).parse(req.params);
  const body = z.object({
    eventId: z.string().min(8).max(160),
    eventType: z.enum(['PAGE_VIEW', 'CLICK', 'LANDING', 'PRODUCT_VIEW', 'ADD_TO_CART', 'CHECKOUT']),
    visitorId: z.string().min(8).max(200),
    referralCode: z.string().optional(),
    couponCode: z.string().optional(),
    source: z.string().max(120).optional(),
    pageUrl: z.string().url().optional(),
    referrer: z.string().max(2000).optional(),
  }).parse(req.body);
  const integration = await prisma.externalIntegration.findUnique({ where: { publicKey } });
  if (!integration || integration.status !== IntegrationStatus.ACTIVE || integration.kind !== IntegrationKind.TRACKING) {
    throw new HttpError(404, 'Tracking integration not found');
  }
  const origin = req.get('origin');
  if (origin && integration.allowedDomains.length > 0) {
    const hostname = new URL(origin).hostname.toLowerCase();
    const allowed = integration.allowedDomains.some((domain: string) => domain.toLowerCase() === hostname);
    if (!allowed) throw new HttpError(403, 'Origin is not allowed for this tracking integration');
  }
  const campaignId = integration.campaignId;
  if (!campaignId) throw new HttpError(409, 'Tracking integration is not assigned to a campaign');
  const attribution = await resolveAttribution(prisma, {
    businessId: integration.businessId,
    campaignId,
    referralCode: body.referralCode,
    couponCode: body.couponCode,
  }).catch((error) => {
    if (!body.referralCode && !body.couponCode) return null;
    throw error;
  });
  const visitorHash = sha256(`${body.visitorId}:${env.IP_HASH_SALT}`);
  try {
    const data = await prisma.attributionTouch.create({
      data: {
        integrationId: integration.id,
        externalEventId: body.eventId,
        campaignId,
        affiliateId: attribution?.affiliate.id,
        referralId: attribution?.referral?.id,
        couponId: attribution?.coupon?.id,
        visitorHash,
        touchType: body.eventType as AttributionTouchType,
        source: body.source,
        metadata: toJson({ pageUrl: body.pageUrl, referrer: body.referrer }),
      },
    });
    res.status(202).json({ success: true, data: { accepted: true, eventId: data.id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(200).json({ success: true, data: { duplicate: true } });
      return;
    }
    throw error;
  }
});

// Notification preferences. Email delivery remains disabled until an email provider is configured.
phase11And12Router.get('/notifications/preferences', auth, async (req, res) => {
  const userId = current(req).userId;
  const data = await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  res.json({ success: true, data });
});

phase11And12Router.patch('/notifications/preferences', auth, async (req, res) => {
  const userId = current(req).userId;
  const body = z.object({
    inAppEnabled: z.boolean().optional(),
    emailEnabled: z.boolean().optional(),
    mutedTypes: z.array(z.nativeEnum(NotificationType)).max(20).optional(),
  }).refine((value) => Object.keys(value).length > 0).parse(req.body);
  const data = await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...body },
    update: body,
  });
  res.json({ success: true, data });
});

// -------------------- Phase 12: affiliate CRM and advanced analytics --------------------

phase11And12Router.get('/businesses/crm/affiliates', ...businessOnly, async (req, res) => {
  const query = z.object({
    stage: z.nativeEnum(CrmStage).optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }).parse(req.query);
  const { business } = await requireBusiness(req, 'READ');
  const where: Prisma.BusinessAffiliateRecordWhereInput = {
    businessId: business.id,
    ...(query.stage ? { stage: query.stage } : {}),
    ...(query.search ? { affiliate: { is: { user: { is: { OR: [{ fullName: { contains: query.search, mode: 'insensitive' } }, { email: { contains: query.search, mode: 'insensitive' } }] } } } } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.businessAffiliateRecord.findMany({
      where,
      include: { affiliate: { include: { user: { select: { id: true, fullName: true, email: true } }, creatorProfile: true } } },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.businessAffiliateRecord.count({ where }),
  ]);
  res.json({ success: true, data, meta: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } });
});

phase11And12Router.put('/businesses/crm/affiliates/:affiliateId', ...businessOnly, async (req, res) => {
  const { affiliateId } = z.object({ affiliateId: z.string().min(1) }).parse(req.params);
  const body = z.object({
    stage: z.nativeEnum(CrmStage).default(CrmStage.DISCOVERED),
    tags: z.array(z.string().min(1).max(40)).max(30).default([]),
    notes: z.string().max(5000).optional(),
    lastContactAt: z.coerce.date().optional(),
  }).parse(req.body);
  const { business } = await requireBusiness(req, 'WRITE');
  if (!await prisma.affiliateProfile.findUnique({ where: { id: affiliateId } })) throw new HttpError(404, 'Affiliate not found');
  const data = await prisma.businessAffiliateRecord.upsert({
    where: { businessId_affiliateId: { businessId: business.id, affiliateId } },
    create: { businessId: business.id, affiliateId, ...body },
    update: body,
  });
  await audit(current(req).userId, 'AFFILIATE_CRM_UPDATED', 'BusinessAffiliateRecord', data.id);
  res.json({ success: true, data });
});

phase11And12Router.get('/analytics/business/campaigns', ...businessOnly, async (req, res) => {
  const query = z.object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }).parse(req.query);
  if (query.from && query.to && query.to <= query.from) throw new HttpError(400, 'to must be later than from');
  const { business } = await requireBusiness(req, 'READ');
  const dateFilter = query.from || query.to ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {};
  const campaigns = await prisma.campaign.findMany({
    where: { businessId: business.id },
    include: {
      _count: { select: { referrals: true, conversions: true, applications: true } },
      conversions: { where: dateFilter, select: { amount: true, status: true, attributionSource: true, integrationId: true } },
      commissions: { select: { commissionAmount: true, status: true, currency: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  const data = campaigns.map((campaign: any) => ({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    compensationModel: campaign.compensationModel,
    referrals: campaign._count.referrals,
    applications: campaign._count.applications,
    conversions: campaign.conversions.length,
    approvedConversions: campaign.conversions.filter((conversion: any) => conversion.status === ConversionStatus.APPROVED).length,
    couponAttributedConversions: campaign.conversions.filter((conversion: any) => ['COUPON', 'REFERRAL_AND_COUPON'].includes(conversion.attributionSource)).length,
    automaticallyVerifiedConversions: campaign.conversions.filter((conversion: any) => conversion.integrationId !== null).length,
    conversionValue: campaign.conversions.filter((conversion: any) => conversion.status === ConversionStatus.APPROVED).reduce((sum: number, conversion: any) => sum + Number(conversion.amount), 0),
    commissionCost: campaign.commissions.reduce((sum: number, commission: any) => sum + Number(commission.commissionAmount), 0),
  }));
  res.json({ success: true, data });
});

phase11And12Router.get('/analytics/business/affiliates', ...businessOnly, async (req, res) => {
  const { business } = await requireBusiness(req, 'READ');
  const rows = await prisma.campaignApplication.findMany({
    where: { campaign: { businessId: business.id }, status: ApplicationStatus.APPROVED },
    include: {
      affiliate: { include: { user: { select: { id: true, fullName: true, email: true } } } },
      campaign: { select: { id: true, name: true } },
    },
  });
  const grouped = new Map<string, { affiliate: unknown; campaigns: Set<string>; conversions: number; approvedValueByCurrency: Record<string, number> }>();
  for (const row of rows) {
    const currentRow = grouped.get(row.affiliateId) ?? { affiliate: row.affiliate.user, campaigns: new Set<string>(), conversions: 0, approvedValueByCurrency: {} };
    currentRow.campaigns.add(row.campaignId);
    grouped.set(row.affiliateId, currentRow);
  }
  const conversions = await prisma.conversion.findMany({
    where: { campaign: { businessId: business.id } },
    select: { affiliateId: true, status: true, amount: true, currency: true },
  });
  for (const conversion of conversions) {
    const item = grouped.get(conversion.affiliateId);
    if (item) {
      item.conversions += 1;
      if (conversion.status === ConversionStatus.APPROVED) {
        item.approvedValueByCurrency[conversion.currency] = (item.approvedValueByCurrency[conversion.currency] ?? 0) + Number(conversion.amount);
      }
    }
  }
  res.json({
    success: true,
    data: [...grouped.entries()].map(([affiliateId, item]) => ({
      affiliateId, affiliate: item.affiliate, campaignCount: item.campaigns.size,
      conversions: item.conversions,
      approvedConversionValue: Number((item.approvedValueByCurrency.NGN ?? 0).toFixed(2)),
      approvedConversionValueByCurrency: Object.fromEntries(Object.entries(item.approvedValueByCurrency).map(([currency, amount]) => [currency, Number(amount.toFixed(2))])),
    })),
  });
});
