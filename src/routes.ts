import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { Prisma, Role, BusinessStatus, CampaignStatus, CampaignAccess, ApplicationStatus, ConversionStatus, CommissionStatus, LedgerType, WithdrawalStatus, NotificationType, BusinessMemberRole, CompensationModel, AttributionTouchType } from '@prisma/client';
import { prisma } from './prisma';
import { env } from './config';
import { requireAuth, roles, current } from './auth';
import { HttpError } from './errors';
import { phase11And12Router } from './modules/phase11-12.routes';
export const router = Router();
function businessMemberGuard(req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) {
  void (async () => {
    const userId = current(req).userId;
    const selectedBusinessId = req.get('x-business-id');
    const owned = selectedBusinessId
      ? await prisma.businessProfile.findFirst({ where: { id: selectedBusinessId, userId } })
      : await prisma.businessProfile.findUnique({ where: { userId } });
    if (owned) return next();
    const membership = await prisma.businessMember.findFirst({
      where: { userId, isActive: true, ...(selectedBusinessId ? { businessId: selectedBusinessId } : {}) },
      select: { role: true },
    });
    if (!membership) throw new HttpError(403, 'Business membership required for the selected business', 'FORBIDDEN');
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const rank: Record<BusinessMemberRole, number> = {
      OWNER: 4, ADMIN: 3, MANAGER: 2, ANALYST: 1,
    };
    const adminOnlyPaths = ['/businesses/members', '/businesses/integrations'];
    const requiresAdmin = adminOnlyPaths.some((path) => req.path.startsWith(path));
    const required = requiresAdmin ? 3 : 2;
    if (rank[membership.role as BusinessMemberRole] < required) throw new HttpError(403, 'Insufficient business permissions', 'FORBIDDEN');
    return next();
  })().catch(next);
}
const auth = requireAuth;
const affiliateOnly = [auth, roles(Role.AFFILIATE)] as const;
const businessOnly = [auth, roles(Role.BUSINESS), businessMemberGuard] as const;
const adminOnly = [auth, roles(Role.ADMIN)] as const;
const idSchema = z.object({ id: z.string().min(1) });
const tokenHash = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const newRefresh = () => crypto.randomBytes(48).toString('hex');
const accessToken = (u: { id: string; role: Role }) => jwt.sign({ sub: u.id, role: u.role, typ: 'access' }, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'] });
const asNum = (v: Prisma.Decimal | number | string) => Number(v);
async function getAffiliate(userId: string) { const p = await prisma.affiliateProfile.findUnique({ where: { userId } }); if (!p) throw new HttpError(404,'Affiliate profile not found'); return p; }
async function getBusiness(userId: string, businessId?: string) {
  const owned = businessId
    ? await prisma.businessProfile.findFirst({ where: { id: businessId, userId } })
    : await prisma.businessProfile.findUnique({ where: { userId } });
  if (owned) return owned;
  const membership = await prisma.businessMember.findFirst({ where: { userId, isActive: true, ...(businessId ? { businessId } : {}) }, include: { business: true } });
  if (!membership) throw new HttpError(404, 'Business profile not found');
  return membership.business;
}
async function notify(userId: string, type: NotificationType, title: string, message: string) {
  const preference = await prisma.notificationPreference.findUnique({ where: { userId } });
  if (preference && (!preference.inAppEnabled || preference.mutedTypes.includes(type))) return;
  await prisma.notification.create({ data: { userId, type, title, message } });
}
async function audit(actorId: string, action: string, entityType: string, entityId: string, metadata?: Prisma.InputJsonValue) { await prisma.auditLog.create({ data: { actorId, action, entityType, entityId, metadata } }); }
async function wallet(affiliateId: string) {
  const rows = await prisma.walletEntry.findMany({ where: { affiliateId } });
  const byCurrency: Record<string, { pending: number; available: number; withdrawn: number; reversed: number }> = {};
  for (const row of rows) {
    const bucket = byCurrency[row.currency] ?? (byCurrency[row.currency] = { pending: 0, available: 0, withdrawn: 0, reversed: 0 });
    const amount = asNum(row.amount);
    switch (row.type) {
      case LedgerType.PENDING_CREDIT: bucket.pending += amount; break;
      case LedgerType.PENDING_DEBIT: bucket.pending -= amount; break;
      case LedgerType.AVAILABLE_CREDIT: bucket.available += amount; break;
      case LedgerType.AVAILABLE_DEBIT: bucket.available -= amount; break;
      case LedgerType.WITHDRAWAL_RELEASED: bucket.available += amount; break;
      case LedgerType.WITHDRAWN: bucket.withdrawn += amount; break;
      case LedgerType.REVERSAL: bucket.reversed += amount; break;
    }
  }
  for (const bucket of Object.values(byCurrency)) {
    for (const key of Object.keys(bucket) as (keyof typeof bucket)[]) bucket[key] = Number(bucket[key].toFixed(2));
  }
  const ngn = byCurrency.NGN ?? { pending: 0, available: 0, withdrawn: 0, reversed: 0 };
  return { ...ngn, currency: 'NGN', byCurrency };
}

router.get('/health', async (_req,res) => { await prisma.$queryRaw`SELECT 1`; res.json({ success:true, data:{ status:'ok', database:'connected', timestamp:new Date().toISOString() } }); });

// Auth: public registration deliberately excludes ADMIN.
router.post('/auth/register', async (req,res) => {
  const b = z.object({ fullName:z.string().min(2).max(120), email:z.string().email().transform(x=>x.toLowerCase()), phone:z.string().optional(), password:z.string().min(10).max(128), role:z.enum(['AFFILIATE','BUSINESS']) }).parse(req.body);
  const passwordHash = await bcrypt.hash(b.password,12);
  const user = await prisma.user.create({ data:{ fullName:b.fullName,email:b.email,phone:b.phone,passwordHash,role:b.role,
    ...(b.role==='AFFILIATE' ? { affiliate:{ create:{} } } : { business:{ create:{ name:b.fullName } } }) },
    select:{ id:true,fullName:true,email:true,role:true,createdAt:true } });
  res.status(201).json({ success:true,data:{ user } });
});
router.post('/auth/login', async (req,res) => {
  const b = z.object({ email:z.string().email().transform(x=>x.toLowerCase()), password:z.string().min(1) }).parse(req.body);
  const u = await prisma.user.findUnique({ where:{ email:b.email } });
  if (!u || !u.isActive || !(await bcrypt.compare(b.password,u.passwordHash))) throw new HttpError(401,'Invalid email or password','INVALID_CREDENTIALS');
  const rt = newRefresh(); await prisma.refreshSession.create({ data:{ userId:u.id,tokenHash:tokenHash(rt),expiresAt:new Date(Date.now()+env.REFRESH_TOKEN_DAYS*86400000) } });
  res.json({ success:true,data:{ user:{id:u.id,fullName:u.fullName,email:u.email,role:u.role},accessToken:accessToken(u),refreshToken:rt,tokenType:'Bearer' } });
});
router.post('/auth/refresh', async (req,res) => {
  const { refreshToken:rt } = z.object({refreshToken:z.string().min(20)}).parse(req.body);
  const s = await prisma.refreshSession.findUnique({ where:{tokenHash:tokenHash(rt)},include:{user:true} });
  if (!s || s.revokedAt || s.expiresAt < new Date() || !s.user.isActive) throw new HttpError(401,'Refresh token invalid or expired');
  const next = newRefresh();
  await prisma.$transaction([prisma.refreshSession.update({where:{id:s.id},data:{revokedAt:new Date()}}),prisma.refreshSession.create({data:{userId:s.userId,tokenHash:tokenHash(next),expiresAt:new Date(Date.now()+env.REFRESH_TOKEN_DAYS*86400000)}})]);
  res.json({success:true,data:{accessToken:accessToken(s.user),refreshToken:next,tokenType:'Bearer'}});
});
router.post('/auth/logout',auth,async(req,res)=>{const {refreshToken:rt}=z.object({refreshToken:z.string()}).parse(req.body);await prisma.refreshSession.updateMany({where:{userId:current(req).userId,tokenHash:tokenHash(rt),revokedAt:null},data:{revokedAt:new Date()}});res.json({success:true,data:{message:'Logged out'}});});
router.get('/auth/me',auth,async(req,res)=>{const u=await prisma.user.findUnique({where:{id:current(req).userId},select:{id:true,fullName:true,email:true,phone:true,role:true,isActive:true,createdAt:true,affiliate:true,business:true,businessMemberships:{include:{business:true}}}});if(!u)throw new HttpError(404,'User not found');res.json({success:true,data:u});});

// Profiles and business verification.
router.patch('/affiliates/me',...affiliateOnly,async(req,res)=>{const b=z.object({bio:z.string().max(1000).optional(),website:z.string().url().optional().or(z.literal('')),socialLinks:z.record(z.string(),z.string()).optional(),promotionalChannels:z.array(z.string()).optional(),interests:z.array(z.string()).optional(),audienceSize:z.number().int().nonnegative().optional(),country:z.string().optional()}).parse(req.body);const p=await getAffiliate(current(req).userId);const data=await prisma.affiliateProfile.update({where:{id:p.id},data:b});res.json({success:true,data});});
router.patch('/businesses/me',...businessOnly,async(req,res)=>{const b=z.object({name:z.string().min(2).optional(),description:z.string().max(2000).optional(),website:z.string().url().optional().or(z.literal('')),country:z.string().optional(),registrationNumber:z.string().optional()}).parse(req.body);const p=await getBusiness(current(req).userId, req.get('x-business-id') ?? undefined);const data=await prisma.businessProfile.update({where:{id:p.id},data:b});res.json({success:true,data});});
router.post('/businesses/verification',...businessOnly,async(req,res)=>{const b=z.object({registrationNumber:z.string().min(2),verificationNotes:z.string().max(2000).optional()}).parse(req.body);const p=await getBusiness(current(req).userId, req.get('x-business-id') ?? undefined);if(p.status===BusinessStatus.APPROVED)throw new HttpError(409,'Business already approved');const data=await prisma.businessProfile.update({where:{id:p.id},data:{...b,status:BusinessStatus.PENDING,submittedAt:new Date(),reviewedAt:null}});res.json({success:true,data});});

// Products and campaigns.
router.post('/products',...businessOnly,async(req,res)=>{const b=z.object({name:z.string().min(2),description:z.string().optional(),price:z.number().positive().optional(),currency:z.string().length(3).default('NGN'),category:z.string().optional(),imageUrl:z.string().url().optional(),destinationUrl:z.string().url().optional()}).parse(req.body);const bp=await getBusiness(current(req).userId, req.get('x-business-id') ?? undefined);if(bp.status!==BusinessStatus.APPROVED)throw new HttpError(403,'Business must be approved');const data=await prisma.product.create({data:{...b,businessId:bp.id}});res.status(201).json({success:true,data});});
router.get('/products',...businessOnly,async(req,res)=>{const bp=await getBusiness(current(req).userId, req.get('x-business-id') ?? undefined);const data=await prisma.product.findMany({where:{businessId:bp.id},orderBy:{createdAt:'desc'}});res.json({success:true,data});});
router.post('/campaigns',...businessOnly,async(req,res)=>{
  const b = z.object({
    productId:z.string().optional(),
    programId:z.string().optional(),
    name:z.string().min(3),
    description:z.string().min(10),
    instructions:z.string().optional(),
    category:z.string().optional(),
    country:z.string().default('Nigeria'),
    action:z.enum(['CPS','CPL','CPR','CPA']).default('CPS'),
    compensationModel:z.nativeEnum(CompensationModel).default(CompensationModel.PERFORMANCE),
    commissionType:z.enum(['PERCENTAGE','FIXED']).optional(),
    commissionValue:z.number().positive().optional(),
    fixedFeeAmount:z.number().positive().optional(),
    requiredDeliverables:z.number().int().min(1).max(50).default(1),
    currency:z.string().length(3).transform(v=>v.toUpperCase()).default('NGN'),
    access:z.enum(['OPEN','APPROVAL','INVITATION','PRIVATE']).default('OPEN'),
    attributionModel:z.enum(['FIRST_CLICK','LAST_CLICK']).default('LAST_CLICK'),
    attributionDays:z.number().int().min(1).max(90).default(30),
    validationDays:z.number().int().min(0).max(180).default(14),
    startsAt:z.coerce.date().optional(),
    endsAt:z.coerce.date().optional(),
    destinationUrl:z.string().url().optional()
  }).superRefine((value, ctx) => {
    if (value.compensationModel !== CompensationModel.FIXED_FEE && (!value.commissionType || !value.commissionValue)) {
      ctx.addIssue({ code:'custom', path:['commissionType'], message:'Performance and hybrid campaigns require commissionType and commissionValue' });
    }
    if (value.compensationModel !== CompensationModel.PERFORMANCE && !value.fixedFeeAmount) {
      ctx.addIssue({ code:'custom', path:['fixedFeeAmount'], message:'Fixed-fee and hybrid campaigns require fixedFeeAmount' });
    }
    if (value.commissionType === 'PERCENTAGE' && (value.commissionValue ?? 0) > 100) {
      ctx.addIssue({ code:'custom', path:['commissionValue'], message:'Percentage commission cannot exceed 100' });
    }
    if (value.access === 'PRIVATE' && !value.programId) {
      ctx.addIssue({ code:'custom', path:['programId'], message:'Private campaigns must belong to an affiliate programme' });
    }
  }).parse(req.body);
  const bp=await getBusiness(current(req).userId, req.get('x-business-id') ?? undefined);
  if(bp.status!==BusinessStatus.APPROVED) throw new HttpError(403,'Business must be approved');
  if(b.productId&&!await prisma.product.findFirst({where:{id:b.productId,businessId:bp.id}})) throw new HttpError(404,'Product not found for this business');
  if(b.programId&&!await prisma.affiliateProgram.findFirst({where:{id:b.programId,businessId:bp.id,status:'ACTIVE'}})) throw new HttpError(404,'Active affiliate programme not found');
  const data=await prisma.campaign.create({data:{
    ...b,
    ...(b.compensationModel===CompensationModel.FIXED_FEE?{commissionType:null,commissionValue:null}:{}),
    ...(b.compensationModel===CompensationModel.PERFORMANCE?{fixedFeeAmount:null}:{}),
    businessId:bp.id,
    status:CampaignStatus.DRAFT
  }});
  res.status(201).json({success:true,data});
});
router.get('/campaigns/mine',...businessOnly,async(req,res)=>{const bp=await getBusiness(current(req).userId, req.get('x-business-id') ?? undefined);const data=await prisma.campaign.findMany({where:{businessId:bp.id},include:{product:true,_count:{select:{applications:true,referrals:true}}},orderBy:{createdAt:'desc'}});res.json({success:true,data});});
router.patch('/campaigns/:id',...businessOnly,async(req,res)=>{
  const {id}=idSchema.parse(req.params);
  const bp=await getBusiness(current(req).userId, req.get('x-business-id') ?? undefined);
  const c=await prisma.campaign.findFirst({where:{id,businessId:bp.id}});
  if(!c) throw new HttpError(404,'Campaign not found');
  if(c.status!==CampaignStatus.DRAFT && c.status!==CampaignStatus.REJECTED) throw new HttpError(409,'Only draft or rejected campaigns can be edited');
  const b=z.object({
    name:z.string().min(3).optional(),
    description:z.string().min(10).optional(),
    instructions:z.string().optional(),
    commissionType:z.enum(['PERCENTAGE','FIXED']).nullable().optional(),
    commissionValue:z.number().positive().nullable().optional(),
    compensationModel:z.nativeEnum(CompensationModel).optional(),
    fixedFeeAmount:z.number().positive().nullable().optional(),
    requiredDeliverables:z.number().int().min(1).max(50).optional(),
    programId:z.string().nullable().optional(),
    access:z.enum(['OPEN','APPROVAL','INVITATION','PRIVATE']).optional(),
    destinationUrl:z.string().url().optional()
  }).parse(req.body);
  const nextModel=b.compensationModel??c.compensationModel;
  const nextCommissionType=b.commissionType===undefined?c.commissionType:b.commissionType;
  const nextCommissionValue=b.commissionValue===undefined?c.commissionValue:b.commissionValue;
  const nextFixed=b.fixedFeeAmount===undefined?c.fixedFeeAmount:b.fixedFeeAmount;
  if(nextModel!==CompensationModel.FIXED_FEE && (!nextCommissionType||!nextCommissionValue)) throw new HttpError(400,'Performance and hybrid campaigns require commission terms');
  if(nextModel!==CompensationModel.PERFORMANCE && !nextFixed) throw new HttpError(400,'Fixed-fee and hybrid campaigns require fixedFeeAmount');
  const nextAccess=b.access??c.access;
  const nextProgram=b.programId===undefined?c.programId:b.programId;
  if(nextAccess===CampaignAccess.PRIVATE && !nextProgram) throw new HttpError(400,'Private campaigns must belong to an affiliate programme');
  if(nextProgram && !await prisma.affiliateProgram.findFirst({where:{id:nextProgram,businessId:bp.id,status:'ACTIVE'}})) throw new HttpError(404,'Active affiliate programme not found');
  const updateData: Prisma.CampaignUncheckedUpdateInput = {
    ...b,
    ...(nextModel === CompensationModel.FIXED_FEE ? { commissionType: null, commissionValue: null } : {}),
    ...(nextModel === CompensationModel.PERFORMANCE ? { fixedFeeAmount: null } : {}),
    status: CampaignStatus.DRAFT,
  };
  const data=await prisma.campaign.update({where:{id},data:updateData});
  res.json({success:true,data});
});
router.post('/campaigns/:id/submit',...businessOnly,async(req,res)=>{const {id}=idSchema.parse(req.params);const bp=await getBusiness(current(req).userId, req.get('x-business-id') ?? undefined);const c=await prisma.campaign.findFirst({where:{id,businessId:bp.id}});if(!c)throw new HttpError(404,'Campaign not found');if (
  c.status !== CampaignStatus.DRAFT &&
  c.status !== CampaignStatus.REJECTED
) {
  throw new HttpError(
    409,
    'Campaign cannot be submitted from current status'
  );
}const data=await prisma.campaign.update({where:{id},data:{status:CampaignStatus.PENDING,rejectionReason:null}});res.json({success:true,data});});
router.get('/marketplace/campaigns',auth,async(req,res)=>{const q=z.object({search:z.string().optional(),category:z.string().optional(),country:z.string().optional(),action:z.enum(['CPS','CPL','CPR','CPA']).optional(),page:z.coerce.number().int().positive().default(1),limit:z.coerce.number().int().min(1).max(50).default(20)}).parse(req.query);const where:Prisma.CampaignWhereInput={status:CampaignStatus.APPROVED,access:{not:CampaignAccess.PRIVATE},...(q.category?{category:{contains:q.category,mode:'insensitive'}}:{}),...(q.country?{country:q.country}:{}),...(q.action?{action:q.action}:{}),...(q.search?{OR:[{name:{contains:q.search,mode:'insensitive'}},{description:{contains:q.search,mode:'insensitive'}}]}:{})};const [data,total]=await Promise.all([prisma.campaign.findMany({where,include:{business:{select:{name:true,country:true}},product:true},skip:(q.page-1)*q.limit,take:q.limit,orderBy:{createdAt:'desc'}}),prisma.campaign.count({where})]);res.json({success:true,data,meta:{page:q.page,limit:q.limit,total,pages:Math.ceil(total/q.limit)}});});
router.get('/campaigns/:id',auth,async(req,res)=>{
  const {id}=idSchema.parse(req.params);
  const data=await prisma.campaign.findFirst({
    where:{id,status:CampaignStatus.APPROVED,OR:[{access:{not:CampaignAccess.PRIVATE}},{program:{is:{status:'ACTIVE',memberships:{some:{affiliate:{userId:current(req).userId},status:'APPROVED'}}}}}]},
    include:{business:{select:{name:true,description:true,country:true}},product:true,program:{select:{id:true,name:true,slug:true}}}
  });
  if(!data) throw new HttpError(404,'Campaign not found');
  res.json({success:true,data});
});
router.post('/campaigns/:id/apply',...affiliateOnly,async(req,res)=>{
  const {id}=idSchema.parse(req.params);
  const c=await prisma.campaign.findFirst({where:{id,status:CampaignStatus.APPROVED}});
  if(!c) throw new HttpError(404,'Campaign not found');
  if(c.access===CampaignAccess.INVITATION) throw new HttpError(403,'Campaign is invitation-only');
  const ap=await getAffiliate(current(req).userId);
  if(c.access===CampaignAccess.PRIVATE){
    if(!c.programId||!await prisma.programMembership.findFirst({where:{programId:c.programId,affiliateId:ap.id,status:'APPROVED',program:{is:{status:'ACTIVE'}}}})) {
      throw new HttpError(403,'Approved private programme membership required');
    }
  }
  const message=z.object({message:z.string().max(1000).optional()}).parse(req.body??{}).message;
  if(c.access===CampaignAccess.OPEN||c.access===CampaignAccess.PRIVATE){
    const result=await prisma.$transaction(async tx=>{
      const application=await tx.campaignApplication.upsert({
        where:{campaignId_affiliateId:{campaignId:id,affiliateId:ap.id}},
        update:{status:ApplicationStatus.APPROVED},
        create:{campaignId:id,affiliateId:ap.id,status:ApplicationStatus.APPROVED}
      });
      const referral=await tx.referral.upsert({
        where:{campaignId_affiliateId:{campaignId:id,affiliateId:ap.id}},
        update:{},
        create:{campaignId:id,affiliateId:ap.id,code:crypto.randomBytes(12).toString('base64url')}
      });
      if(c.compensationModel!==CompensationModel.PERFORMANCE&&c.fixedFeeAmount){
        await tx.creatorPayment.upsert({
          where:{campaignId_affiliateId:{campaignId:id,affiliateId:ap.id}},
          update:{},
          create:{campaignId:id,affiliateId:ap.id,amount:c.fixedFeeAmount,currency:c.currency}
        });
      }
      await tx.businessAffiliateRecord.upsert({
        where:{businessId_affiliateId:{businessId:c.businessId,affiliateId:ap.id}},
        update:{stage:'PARTNER'},
        create:{businessId:c.businessId,affiliateId:ap.id,stage:'PARTNER'}
      });
      return {application,referral};
    });
    return res.status(201).json({success:true,data:result});
  }
  const application=await prisma.campaignApplication.upsert({
    where:{campaignId_affiliateId:{campaignId:id,affiliateId:ap.id}},
    update:{status:ApplicationStatus.PENDING,message},
    create:{campaignId:id,affiliateId:ap.id,status:ApplicationStatus.PENDING,message}
  });
  res.status(201).json({success:true,data:application});
});
router.get('/businesses/campaigns/:id/applications',...businessOnly,async(req,res)=>{const {id}=idSchema.parse(req.params);const bp=await getBusiness(current(req).userId, req.get('x-business-id') ?? undefined);if(!await prisma.campaign.findFirst({where:{id,businessId:bp.id}}))throw new HttpError(404,'Campaign not found');const data=await prisma.campaignApplication.findMany({where:{campaignId:id},include:{affiliate:{include:{user:{select:{id:true,fullName:true,email:true}}}}}});res.json({success:true,data});});
router.patch('/businesses/applications/:id',...businessOnly,async(req,res)=>{const {id}=idSchema.parse(req.params);const b=z.object({status:z.enum(['APPROVED','REJECTED'])}).parse(req.body);const bp=await getBusiness(current(req).userId, req.get('x-business-id') ?? undefined);const a=await prisma.campaignApplication.findUnique({where:{id},include:{campaign:true}});if(!a||a.campaign.businessId!==bp.id)throw new HttpError(404,'Application not found');const data=await prisma.$transaction(async tx=>{const changed=await tx.campaignApplication.update({where:{id},data:{status:b.status,reviewedAt:new Date()}});if(b.status==='APPROVED') {
  await tx.referral.upsert({where:{campaignId_affiliateId:{campaignId:a.campaignId,affiliateId:a.affiliateId}},update:{},create:{campaignId:a.campaignId,affiliateId:a.affiliateId,code:crypto.randomBytes(12).toString('base64url')}});
  if(a.campaign.compensationModel!==CompensationModel.PERFORMANCE && a.campaign.fixedFeeAmount) {
    await tx.creatorPayment.upsert({
      where:{campaignId_affiliateId:{campaignId:a.campaignId,affiliateId:a.affiliateId}},
      update:{},
      create:{campaignId:a.campaignId,affiliateId:a.affiliateId,amount:a.campaign.fixedFeeAmount,currency:a.campaign.currency}
    });
  }
  await tx.businessAffiliateRecord.upsert({
    where:{businessId_affiliateId:{businessId:a.campaign.businessId,affiliateId:a.affiliateId}},
    update:{stage:'PARTNER'},
    create:{businessId:a.campaign.businessId,affiliateId:a.affiliateId,stage:'PARTNER'}
  });
}return changed;});res.json({success:true,data});});

// Referral redirect and click event.
router.get('/affiliates/referrals',...affiliateOnly,async(req,res)=>{const ap=await getAffiliate(current(req).userId);const data=await prisma.referral.findMany({where:{affiliateId:ap.id},include:{campaign:{select:{id:true,name:true,destinationUrl:true,status:true}},_count:{select:{clicks:true,conversions:true}}},orderBy:{createdAt:'desc'}});res.json({success:true,data});});
router.get('/r/:code',async(req,res)=>{
  const r=await prisma.referral.findUnique({where:{code:req.params.code},include:{campaign:true}});
  if(!r||r.campaign.status!==CampaignStatus.APPROVED) throw new HttpError(404,'Referral link not found or inactive');
  const ipHash=crypto.createHash('sha256').update((req.ip??'')+env.IP_HASH_SALT).digest('hex');
  await prisma.click.create({data:{referralId:r.id,source:typeof req.query.source==='string'?req.query.source:null,userAgent:req.get('user-agent'),ipHash}});
  const visitorId=typeof req.query.visitorId==='string'&&req.query.visitorId.length>=8?req.query.visitorId:crypto.randomUUID();
  const destination=new URL(r.campaign.destinationUrl??env.APP_BASE_URL);
  destination.searchParams.set('flyover_visitor',visitorId);
  destination.searchParams.set('flyover_ref',r.code);
  await prisma.attributionTouch.create({
    data:{
      campaignId:r.campaignId,affiliateId:r.affiliateId,referralId:r.id,
      visitorHash:crypto.createHash('sha256').update(`${visitorId}:${env.IP_HASH_SALT}`).digest('hex'),
      touchType:AttributionTouchType.CLICK,
      source:typeof req.query.source==='string'?req.query.source:null,
    }
  });
  res.redirect(302,destination.toString());
});


router.post('/campaigns/:id/coupons', ...businessOnly, async (req, res) => {
  const { id: campaignId } = idSchema.parse(req.params);

  const body = z.object({
    affiliateId: z.string().min(1),
    code: z.string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[a-zA-Z0-9_-]+$/)
      .transform(value => value.toUpperCase()),
    discountType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
    discountValue: z.number().positive(),
    maxRedemptions: z.number().int().positive().optional(),
    startsAt: z.coerce.date().optional(),
    expiresAt: z.coerce.date().optional(),
  }).parse(req.body);

  if (
    body.discountType === 'PERCENTAGE' &&
    body.discountValue > 100
  ) {
    throw new HttpError(400, 'Percentage discount cannot exceed 100');
  }

  if (
    body.startsAt &&
    body.expiresAt &&
    body.expiresAt <= body.startsAt
  ) {
    throw new HttpError(400, 'Expiry must be later than start date');
  }

  const business = await getBusiness(current(req).userId, req.get('x-business-id') ?? undefined);

  if (business.status !== BusinessStatus.APPROVED) {
    throw new HttpError(403, 'Business must be approved');
  }

  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      businessId: business.id,
      status: CampaignStatus.APPROVED,
    },
  });

  if (!campaign) {
    throw new HttpError(404, 'Approved campaign not found');
  }
  if (campaign.compensationModel === CompensationModel.FIXED_FEE) {
    throw new HttpError(409, 'Coupons require a performance or hybrid campaign');
  }

  const application = await prisma.campaignApplication.findUnique({
    where: {
      campaignId_affiliateId: {
        campaignId,
        affiliateId: body.affiliateId,
      },
    },
  });

  if (!application || application.status !== ApplicationStatus.APPROVED) {
    throw new HttpError(
      403,
      'Affiliate must be approved for this campaign'
    );
  }

  try {
    const coupon = await prisma.coupon.create({
      data: {
        ...body,
        campaignId,
        affiliateId: body.affiliateId,
      },
    });

    await audit(
      current(req).userId,
      'COUPON_CREATED',
      'Coupon',
      coupon.id,
      { campaignId, affiliateId: body.affiliateId }
    );
    const affiliateUser = await prisma.affiliateProfile.findUnique({ where: { id: body.affiliateId }, select: { userId: true } });
    if (affiliateUser) await notify(affiliateUser.userId, NotificationType.CAMPAIGN, 'New campaign coupon', `A coupon was issued to you for campaign ${campaign.name}.`);

    res.status(201).json({
      success: true,
      data: coupon,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new HttpError(409, 'Coupon code already exists');
    }

    throw error;
  }
});


router.get('/campaigns/:id/coupons', ...businessOnly, async (req, res) => {
  const { id } = idSchema.parse(req.params);
  const business = await getBusiness(current(req).userId, req.get('x-business-id') ?? undefined);

  const campaign = await prisma.campaign.findFirst({
    where: {
      id,
      businessId: business.id,
    },
  });

  if (!campaign) {
    throw new HttpError(404, 'Campaign not found');
  }

  const data = await prisma.coupon.findMany({
    where: { campaignId: id },
    include: {
      affiliate: {
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      },
      _count: {
        select: { redemptions: { where: { status: { in: ['RESERVED', 'CONFIRMED'] } } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data });
});


router.get('/affiliates/coupons', ...affiliateOnly, async (req, res) => {
  const affiliate = await getAffiliate(current(req).userId);

  const data = await prisma.coupon.findMany({
    where: {
      affiliateId: affiliate.id,
    },
    include: {
      campaign: {
        select: {
          id: true,
          name: true,
          currency: true,
          status: true,
          business: {
            select: { name: true },
          },
        },
      },
      _count: {
        select: { redemptions: { where: { status: { in: ['RESERVED', 'CONFIRMED'] } } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data });
});


router.get('/businesses/conversions',...businessOnly,async(req,res)=>{const bp=await getBusiness(current(req).userId, req.get('x-business-id') ?? undefined);const status=z.enum(['PENDING','APPROVED','REJECTED','REVERSED','DISPUTED']).optional().parse(req.query.status);const data=await prisma.conversion.findMany({where:{campaign:{businessId:bp.id},...(status?{status}:{})},include:{campaign:true,affiliate:{include:{user:{select:{fullName:true,email:true}}}},commission:true,coupon:true,referral:true,verifications:true},orderBy:{createdAt:'desc'}});res.json({success:true,data});});

// Admin moderation and audit.
router.get('/admin/businesses',...adminOnly,async(req,res)=>{const status=z.enum(['PENDING','APPROVED','REJECTED','SUSPENDED']).optional().parse(req.query.status);const data=await prisma.businessProfile.findMany({where:status?{status}:{},include:{user:{select:{fullName:true,email:true}}},orderBy:{createdAt:'desc'}});res.json({success:true,data});});
router.patch('/admin/businesses/:id/review',...adminOnly,async(req,res)=>{const {id}=idSchema.parse(req.params);const b=z.object({decision:z.enum(['APPROVED','REJECTED']),notes:z.string().max(1000).optional()}).parse(req.body);const p=await prisma.businessProfile.findUnique({where:{id}});if(!p)throw new HttpError(404,'Business not found');const data=await prisma.businessProfile.update({where:{id},data:{status:b.decision,verificationNotes:b.notes,reviewedAt:new Date(),reviewedById:current(req).userId}});await audit(current(req).userId,`BUSINESS_${b.decision}`,'BusinessProfile',id,{notes:b.notes ?? ''});await notify(p.userId,NotificationType.BUSINESS_VERIFICATION,`Business ${b.decision.toLowerCase()}`,b.notes??`Business ${b.decision.toLowerCase()}`);res.json({success:true,data});});
router.get('/admin/campaigns',...adminOnly,async(req,res)=>{const status=z.enum(['DRAFT','PENDING','APPROVED','REJECTED','SUSPENDED','ENDED']).optional().parse(req.query.status);const data=await prisma.campaign.findMany({where:status?{status}:{},include:{business:{select:{name:true}},product:true},orderBy:{createdAt:'desc'}});res.json({success:true,data});});
router.patch('/admin/campaigns/:id/review',...adminOnly,async(req,res)=>{const {id}=idSchema.parse(req.params);const b=z.object({decision:z.enum(['APPROVED','REJECTED','SUSPENDED']),reason:z.string().max(1000).optional()}).parse(req.body);const c=await prisma.campaign.findUnique({where:{id}});if(!c)throw new HttpError(404,'Campaign not found');const data=await prisma.campaign.update({where:{id},data:{status:b.decision,rejectionReason:b.reason,approvedAt:b.decision==='APPROVED'?new Date():null}});await audit(current(req).userId,`CAMPAIGN_${b.decision}`,'Campaign',id,{reason:b.reason ?? ''});const business=await prisma.businessProfile.findUniqueOrThrow({where:{id:c.businessId}});await notify(business.userId,NotificationType.CAMPAIGN,`Campaign ${b.decision.toLowerCase()}`,b.reason??`Campaign ${b.decision.toLowerCase()}`);res.json({success:true,data});});
router.get('/admin/users',...adminOnly,async(_req,res)=>{const data=await prisma.user.findMany({select:{id:true,fullName:true,email:true,role:true,isActive:true,createdAt:true},orderBy:{createdAt:'desc'}});res.json({success:true,data});});
router.patch('/admin/users/:id/status',...adminOnly,async(req,res)=>{const {id}=idSchema.parse(req.params);const b=z.object({isActive:z.boolean()}).parse(req.body);const data=await prisma.user.update({where:{id},data:{isActive:b.isActive},select:{id:true,fullName:true,email:true,role:true,isActive:true}});await audit(current(req).userId,b.isActive?'USER_ACTIVATED':'USER_SUSPENDED','User',id);res.json({success:true,data});});

// Commission release: admin-triggered in MVP; scheduled worker is a production follow-up.
router.post('/admin/commissions/:id/release',...adminOnly,async(req,res)=>{
  const {id}=idSchema.parse(req.params);
  const c=await prisma.commission.findUnique({where:{id}});
  if(!c) throw new HttpError(404,'Commission not found');
  if(c.status!==CommissionStatus.PENDING) throw new HttpError(409,'Commission is not pending');
  if(c.availableAt>new Date()) throw new HttpError(409,'Validation period has not ended');
  const data=await prisma.$transaction(async tx=>{
    const claimed=await tx.commission.updateMany({where:{id,status:CommissionStatus.PENDING,availableAt:{lte:new Date()}},data:{status:CommissionStatus.AVAILABLE}});
    if(claimed.count!==1) throw new HttpError(409,'Commission has already been released');
    await tx.walletEntry.createMany({data:[
      {affiliateId:c.affiliateId,type:LedgerType.PENDING_DEBIT,amount:c.commissionAmount,currency:c.currency,referenceType:'COMMISSION_RELEASE',referenceId:c.id,description:'Pending commission released'},
      {affiliateId:c.affiliateId,type:LedgerType.AVAILABLE_CREDIT,amount:c.commissionAmount,currency:c.currency,referenceType:'COMMISSION_RELEASE',referenceId:c.id,description:'Commission available for withdrawal'}
    ],skipDuplicates:true});
    return tx.commission.findUniqueOrThrow({where:{id}});
  });
  await audit(current(req).userId,'COMMISSION_RELEASED','Commission',id);
  res.json({success:true,data});
});

// Wallet and withdrawals. Ledger is authoritative; never directly edit a balance field.
router.get('/wallet',...affiliateOnly,async(req,res)=>{const ap=await getAffiliate(current(req).userId);const [balances,transactions]=await Promise.all([wallet(ap.id),prisma.walletEntry.findMany({where:{affiliateId:ap.id},orderBy:{createdAt:'desc'},take:100})]);res.json({success:true,data:{balances,transactions}});});

router.post('/withdrawals', ...affiliateOnly, async (req, res) => {
  const b = z.object({
    amount: z.number().positive(),
    bankName: z.string().min(2),
    accountName: z.string().min(2),
    accountNumber: z.string().min(8).max(20)
  }).parse(req.body);

  const ap = await getAffiliate(current(req).userId);
  const min = 5000;

  const result = await prisma.$transaction(async (tx) => {
    // Lock this affiliate's profile row.
    // Concurrent withdrawal requests for this affiliate must wait.
    await tx.$queryRaw`
      SELECT "id"
      FROM "AffiliateProfile"
      WHERE "id" = ${ap.id}
      FOR UPDATE
    `;

    // Withdrawals are currently denominated in NGN.
    const entries = await tx.walletEntry.findMany({
      where: {
        affiliateId: ap.id,
        currency: 'NGN'
      }
    });

    let available = 0;

    for (const e of entries) {
      const n = asNum(e.amount);

      if (
        e.type === LedgerType.AVAILABLE_CREDIT ||
        e.type === LedgerType.WITHDRAWAL_RELEASED
      ) {
        available += n;
      }

      if (e.type === LedgerType.AVAILABLE_DEBIT) {
        available -= n;
      }
    }

    if (b.amount < min) {
      throw new HttpError(400, `Minimum withdrawal is NGN ${min}`);
    }

    if (b.amount > available) {
      throw new HttpError(400, 'Insufficient available balance');
    }

    const w = await tx.withdrawal.create({
      data: {
        affiliateId: ap.id,
        amount: b.amount,
        bankName: b.bankName,
        accountName: b.accountName,
        accountNumber: b.accountNumber,
        currency: 'NGN'
      }
    });

    await tx.walletEntry.create({
      data: {
        affiliateId: ap.id,
        type: LedgerType.AVAILABLE_DEBIT,
        amount: b.amount,
        currency: 'NGN',
        referenceType: 'WITHDRAWAL',
        referenceId: w.id,
        description: 'Withdrawal request deducted from available balance'
      }
    });

    return w;
  });

  res.status(201).json({
    success: true,
    data: result
  });
});
router.get('/withdrawals',...affiliateOnly,async(req,res)=>{const ap=await getAffiliate(current(req).userId);const data=await prisma.withdrawal.findMany({where:{affiliateId:ap.id},orderBy:{createdAt:'desc'}});res.json({success:true,data});});
router.get('/admin/withdrawals',...adminOnly,async(req,res)=>{const status=z.enum(['PENDING','APPROVED','REJECTED','PROCESSING','PAID','FAILED']).optional().parse(req.query.status);const data=await prisma.withdrawal.findMany({where:status?{status}:{},include:{affiliate:{include:{user:{select:{fullName:true,email:true}}}}},orderBy:{createdAt:'asc'}});res.json({success:true,data});});
router.patch('/admin/withdrawals/:id/review',...adminOnly,async(req,res)=>{
  const {id}=idSchema.parse(req.params);
  const b=z.object({decision:z.enum(['APPROVED','REJECTED','PROCESSING','PAID','FAILED']),adminNote:z.string().max(1000).optional(),paymentReference:z.string().optional()}).parse(req.body);
  const w=await prisma.withdrawal.findUnique({where:{id}});
  if(!w) throw new HttpError(404,'Withdrawal not found');
  const transitions:Record<string,string[]>={PENDING:['APPROVED','REJECTED'],APPROVED:['PROCESSING','PAID','FAILED'],PROCESSING:['PAID','FAILED']};
  if(!transitions[w.status]?.includes(b.decision)) throw new HttpError(409,'Invalid withdrawal status transition');
  if(b.decision==='PAID'&&!b.paymentReference) throw new HttpError(400,'Payment reference is required when marking a withdrawal paid');
  const data=await prisma.$transaction(async tx=>{
    const changed=await tx.withdrawal.updateMany({
      where:{id,status:w.status},
      data:{status:b.decision,adminNote:b.adminNote,paymentReference:b.paymentReference,reviewedById:current(req).userId,processedAt:b.decision==='PAID'?new Date():undefined}
    });
    if(changed.count!==1) throw new HttpError(409,'Withdrawal was updated by another request');
    if(b.decision==='PAID') await tx.walletEntry.create({data:{affiliateId:w.affiliateId,type:LedgerType.WITHDRAWN,amount:w.amount,currency:w.currency,referenceType:'WITHDRAWAL',referenceId:id,description:'Withdrawal marked paid by administrator'}});
    if(['REJECTED','FAILED'].includes(b.decision)) await tx.walletEntry.create({data:{affiliateId:w.affiliateId,type:LedgerType.WITHDRAWAL_RELEASED,amount:w.amount,currency:w.currency,referenceType:'WITHDRAWAL',referenceId:id,description:'Withdrawal amount returned to available balance'}});
    return tx.withdrawal.findUniqueOrThrow({where:{id}});
  });
  await audit(current(req).userId,`WITHDRAWAL_${b.decision}`,'Withdrawal',id,{paymentReference:b.paymentReference??''});
  res.json({success:true,data});
});

// Notifications and basic analytics.
router.get('/notifications',auth,async(req,res)=>{const data=await prisma.notification.findMany({where:{userId:current(req).userId},orderBy:{createdAt:'desc'},take:100});res.json({success:true,data});});
router.patch('/notifications/:id/read',auth,async(req,res)=>{const {id}=idSchema.parse(req.params);const result=await prisma.notification.updateMany({where:{id,userId:current(req).userId,readAt:null},data:{readAt:new Date()}});res.json({success:true,data:{updated:result.count===1}});});
router.get('/analytics/affiliate',...affiliateOnly,async(req,res)=>{
  const ap=await getAffiliate(current(req).userId);
  const [clicks,referrals,conversions,commission,walletData]=await Promise.all([
    prisma.click.count({where:{referral:{affiliateId:ap.id}}}),
    prisma.referral.count({where:{affiliateId:ap.id}}),
    prisma.conversion.groupBy({by:['status'],where:{affiliateId:ap.id},_count:{_all:true}}),
    prisma.commission.groupBy({by:['currency'],where:{affiliateId:ap.id},_sum:{commissionAmount:true}}),
    wallet(ap.id)
  ]);
  const totalCommissionByCurrency=Object.fromEntries(commission.map((row: any)=>[row.currency,asNum(row._sum.commissionAmount??0)]));
  res.json({success:true,data:{
    totalClicks:clicks,
    referralLinks:referrals,
    conversionsByStatus:conversions,
    totalCommission:totalCommissionByCurrency.NGN??0,
    totalCommissionByCurrency,
    wallet:walletData
  }});
});
router.get('/analytics/business',...businessOnly,async(req,res)=>{
  const bp=await getBusiness(current(req).userId, req.get('x-business-id') ?? undefined);
  const [campaigns,clicks,conversions,approvedValue]=await Promise.all([
    prisma.campaign.count({where:{businessId:bp.id}}),
    prisma.click.count({where:{referral:{campaign:{businessId:bp.id}}}}),
    prisma.conversion.count({where:{campaign:{businessId:bp.id}}}),
    prisma.conversion.groupBy({by:['currency'],where:{campaign:{businessId:bp.id},status:ConversionStatus.APPROVED},_sum:{amount:true}})
  ]);
  const approvedConversionValueByCurrency=Object.fromEntries(approvedValue.map((row: any)=>[row.currency,asNum(row._sum.amount??0)]));
  res.json({success:true,data:{
    campaigns,clicks,conversions,
    approvedConversionValue:approvedConversionValueByCurrency.NGN??0,
    approvedConversionValueByCurrency
  }});
});

// Phase 11 and 12 backend modules. Keep all endpoints under the same /api/v1 prefix.
router.use(phase11And12Router);
