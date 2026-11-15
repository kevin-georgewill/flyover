import crypto from 'node:crypto';
import { Prisma, IntegrationProvider } from '@prisma/client';
import { env } from '../config';
import { HttpError } from '../errors';

export type NormalizedExternalConversion = {
  externalEventId: string;
  eventType: string;
  externalReference: string;
  amount: string;
  currency: string;
  campaignId?: string;
  referralCode?: string;
  couponCode?: string;
  customerReference?: string;
  occurredAt?: Date;
  raw: Prisma.InputJsonValue;
};

type ProviderCredentials = {
  webhookSecret?: string;
  apiSecret?: string;
};

function encryptionKey(): Buffer {
  const value = env.INTEGRATION_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new HttpError(503, 'Integration encryption is not configured');
  }
  return Buffer.from(value, 'hex');
}

export function encryptCredentials(credentials: ProviderCredentials): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(credentials), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptCredentials(value: string | null): ProviderCredentials {
  if (!value) return {};
  try {
    const [ivText, tagText, encryptedText] = value.split('.');
    if (!ivText || !tagText || !encryptedText) throw new Error('Malformed encrypted credentials');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(ivText, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const clear = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(clear) as ProviderCredentials;
  } catch {
    throw new HttpError(500, 'Unable to decrypt integration credentials');
  }
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function secureEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyWebhookSignature(
  provider: IntegrationProvider,
  rawBody: Buffer,
  secret: string,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest();
  if (provider === IntegrationProvider.SHOPIFY || provider === IntegrationProvider.WOOCOMMERCE) {
    const supplied = Buffer.from(signature, 'base64');
    return supplied.length === digest.length && crypto.timingSafeEqual(supplied, digest);
  }
  const supplied = Buffer.from(signature.replace(/^sha256=/i, ''), 'hex');
  return supplied.length === digest.length && crypto.timingSafeEqual(supplied, digest);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : undefined;
}

function findMeta(meta: unknown, key: string): string | undefined {
  if (!Array.isArray(meta)) return undefined;
  const item = meta.map(asObject).find((entry) => entry.key === key || entry.name === key);
  return item ? text(item.value) : undefined;
}

export function normalizeWebhook(
  provider: IntegrationProvider,
  payloadValue: unknown,
): NormalizedExternalConversion | null {
  const payload = asObject(payloadValue);
  if (provider === IntegrationProvider.GENERIC_HMAC) {
    const data = asObject(payload.data ?? payload);
    const eventType = text(payload.type ?? payload.event) ?? 'conversion';
    if (!['payment.succeeded', 'payment_success', 'order.paid', 'conversion', 'conversion.verified'].includes(eventType.toLowerCase())) return null;
    const externalEventId = text(payload.id ?? payload.eventId);
    const externalReference = text(data.externalReference ?? data.orderId ?? data.id);
    const amount = text(data.amount ?? data.total);
    if (!externalEventId || !externalReference || !amount) return null;
    return {
      externalEventId,
      eventType,
      externalReference,
      amount,
      currency: (text(data.currency) ?? 'NGN').toUpperCase(),
      campaignId: text(data.campaignId),
      referralCode: text(data.referralCode),
      couponCode: text(data.couponCode),
      customerReference: text(data.customerReference),
      occurredAt: data.convertedAt ? new Date(String(data.convertedAt)) : undefined,
      raw: {
        externalEventId, eventType, externalReference, amount,
        currency: (text(data.currency) ?? 'NGN').toUpperCase(),
        campaignId: text(data.campaignId) ?? null,
        referralCode: text(data.referralCode) ?? null,
        couponCode: text(data.couponCode) ?? null,
      } as Prisma.InputJsonValue,
    };
  }

  if (provider === IntegrationProvider.SHOPIFY) {
    const status = text(payload.financial_status) ?? '';
    if (status !== 'paid') return null;
    const discounts = Array.isArray(payload.discount_codes) ? payload.discount_codes : [];
    const firstDiscount = asObject(discounts[0]);
    const attributes = Array.isArray(payload.note_attributes) ? payload.note_attributes : [];
    const externalEventId = text(payload.id);
    const externalReference = text(payload.name ?? payload.order_number ?? payload.id);
    const amount = text(payload.total_price);
    if (!externalEventId || !externalReference || !amount) return null;
    return {
      externalEventId,
      eventType: 'orders/paid',
      externalReference,
      amount,
      currency: (text(payload.currency) ?? 'NGN').toUpperCase(),
      campaignId: findMeta(attributes, 'flyover_campaign_id'),
      referralCode: findMeta(attributes, 'flyover_referral_code'),
      couponCode: text(firstDiscount.code),
      customerReference: text(asObject(payload.customer).id),
      occurredAt: payload.processed_at ? new Date(String(payload.processed_at)) : undefined,
      raw: {
        externalEventId, eventType: 'orders/paid', externalReference, amount,
        currency: (text(payload.currency) ?? 'NGN').toUpperCase(),
        campaignId: findMeta(attributes, 'flyover_campaign_id') ?? null,
        referralCode: findMeta(attributes, 'flyover_referral_code') ?? null,
        couponCode: text(firstDiscount.code) ?? null,
      } as Prisma.InputJsonValue,
    };
  }

  const status = text(payload.status) ?? '';
  if (!['processing', 'completed'].includes(status)) return null;
  const coupons = Array.isArray(payload.coupon_lines) ? payload.coupon_lines : [];
  const externalEventId = text(payload.id);
  const externalReference = text(payload.number ?? payload.id);
  const amount = text(payload.total);
  if (!externalEventId || !externalReference || !amount) return null;
  return {
    externalEventId,
    eventType: 'order.paid',
    externalReference,
    amount,
    currency: (text(payload.currency) ?? 'NGN').toUpperCase(),
    campaignId: findMeta(payload.meta_data, 'flyover_campaign_id'),
    referralCode: findMeta(payload.meta_data, 'flyover_referral_code'),
    couponCode: text(asObject(coupons[0]).code),
    customerReference: text(asObject(payload.customer).id),
    occurredAt: payload.date_paid ? new Date(String(payload.date_paid)) : undefined,
    raw: {
      externalEventId, eventType: 'order.paid', externalReference, amount,
      currency: (text(payload.currency) ?? 'NGN').toUpperCase(),
      campaignId: findMeta(payload.meta_data, 'flyover_campaign_id') ?? null,
      referralCode: findMeta(payload.meta_data, 'flyover_referral_code') ?? null,
      couponCode: text(asObject(coupons[0]).code) ?? null,
    } as Prisma.InputJsonValue,
  };
}
