-- Flyover Phase 11 and Phase 12 backend expansion.
-- Existing coupon foundation migration remains unchanged.

-- CreateEnum
CREATE TYPE "CompensationModel" AS ENUM ('PERFORMANCE', 'FIXED_FEE', 'HYBRID');
CREATE TYPE "CouponRedemptionStatus" AS ENUM ('RESERVED', 'CONFIRMED', 'RELEASED');
CREATE TYPE "CreatorProfileStatus" AS ENUM ('ACTIVE', 'PAUSED');
CREATE TYPE "CreatorDeliverableStatus" AS ENUM ('SUBMITTED', 'IN_REVIEW', 'REVISION_REQUESTED', 'APPROVED', 'REJECTED');
CREATE TYPE "CreatorPaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');
CREATE TYPE "AffiliateProgramStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "ProgramMembershipStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');
CREATE TYPE "BusinessMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'ANALYST');
CREATE TYPE "IntegrationKind" AS ENUM ('PAYMENT', 'ECOMMERCE', 'TRACKING', 'CONVERSION_REPORTING');
CREATE TYPE "IntegrationProvider" AS ENUM ('GENERIC_HMAC', 'SHOPIFY', 'WOOCOMMERCE');
CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REVOKED');
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');
CREATE TYPE "AttributionSource" AS ENUM ('REFERRAL', 'COUPON', 'REFERRAL_AND_COUPON', 'ATTRIBUTION_WINDOW', 'TRACKING_API', 'WEBHOOK');
CREATE TYPE "AttributionTouchType" AS ENUM ('CONVERSION', 'PAGE_VIEW', 'CLICK', 'LANDING', 'PRODUCT_VIEW', 'ADD_TO_CART', 'CHECKOUT');
CREATE TYPE "CrmStage" AS ENUM ('DISCOVERED', 'CONTACTED', 'NEGOTIATING', 'PARTNER', 'INACTIVE');

-- AlterEnum
ALTER TYPE "CampaignAccess" ADD VALUE 'PRIVATE';

-- AlterTable
ALTER TABLE "Campaign"
  ADD COLUMN "compensationModel" "CompensationModel" NOT NULL DEFAULT 'PERFORMANCE',
  ADD COLUMN "fixedFeeAmount" DECIMAL(14,2),
  ADD COLUMN "requiredDeliverables" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "programId" TEXT,
  ALTER COLUMN "commissionType" DROP NOT NULL,
  ALTER COLUMN "commissionValue" DROP NOT NULL;

ALTER TABLE "Conversion"
  ADD COLUMN "integrationId" TEXT,
  ADD COLUMN "attributionSource" "AttributionSource" NOT NULL DEFAULT 'REFERRAL',
  ADD COLUMN "attributionEvidence" JSONB;

ALTER TABLE "CouponRedemption"
  ADD COLUMN "status" "CouponRedemptionStatus" NOT NULL DEFAULT 'RESERVED';

-- CreateTable
CREATE TABLE "CreatorProfile" (
  "id" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "bio" TEXT,
  "niches" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "country" TEXT NOT NULL DEFAULT 'Nigeria',
  "city" TEXT,
  "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "portfolioUrl" TEXT,
  "mediaKitUrl" TEXT,
  "socialProfiles" JSONB,
  "audienceSize" INTEGER,
  "engagementRate" DECIMAL(7,4),
  "status" "CreatorProfileStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorDeliverable" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "assetUrl" TEXT NOT NULL,
  "contentType" TEXT,
  "status" "CreatorDeliverableStatus" NOT NULL DEFAULT 'SUBMITTED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "reviewNotes" TEXT,
  "reviewedById" TEXT,
  "dueAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorDeliverable_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreatorPayment" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "status" "CreatorPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "paymentReference" TEXT,
  "paymentProvider" TEXT,
  "adminNote" TEXT,
  "approvedById" TEXT,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AffiliateProgram" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "status" "AffiliateProgramStatus" NOT NULL DEFAULT 'DRAFT',
  "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
  "landingPageTitle" TEXT,
  "landingPageDescription" TEXT,
  "brandColor" TEXT,
  "customFields" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AffiliateProgram_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProgramMembership" (
  "id" TEXT NOT NULL,
  "programId" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "status" "ProgramMembershipStatus" NOT NULL DEFAULT 'PENDING',
  "source" TEXT NOT NULL DEFAULT 'REGISTRATION_PAGE',
  "answers" JSONB,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  CONSTRAINT "ProgramMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BusinessMember" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "BusinessMemberRole" NOT NULL DEFAULT 'ANALYST',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "invitedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalIntegration" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "campaignId" TEXT,
  "createdById" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "IntegrationKind" NOT NULL,
  "provider" "IntegrationProvider" NOT NULL DEFAULT 'GENERIC_HMAC',
  "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
  "publicKey" TEXT NOT NULL,
  "encryptedCredentials" TEXT,
  "config" JSONB,
  "allowedDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "lastEventAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalIntegration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntegrationApiKey" (
  "id" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntegrationApiKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "authMethod" TEXT NOT NULL DEFAULT 'WEBHOOK_HMAC',
  "payload" JSONB NOT NULL,
  "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
  "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversionVerification" (
  "id" TEXT NOT NULL,
  "conversionId" TEXT NOT NULL,
  "integrationId" TEXT,
  "webhookEventId" TEXT,
  "providerReference" TEXT,
  "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
  "evidence" JSONB,
  "failureReason" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversionVerification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttributionTouch" (
  "id" TEXT NOT NULL,
  "externalEventId" TEXT,
  "integrationId" TEXT,
  "campaignId" TEXT NOT NULL,
  "affiliateId" TEXT,
  "referralId" TEXT,
  "couponId" TEXT,
  "visitorHash" TEXT NOT NULL,
  "touchType" "AttributionTouchType" NOT NULL,
  "source" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "AttributionTouch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BusinessAffiliateRecord" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "affiliateId" TEXT NOT NULL,
  "stage" "CrmStage" NOT NULL DEFAULT 'DISCOVERED',
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes" TEXT,
  "lastContactAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessAffiliateRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
  "mutedTypes" "NotificationType"[] NOT NULL DEFAULT ARRAY[]::"NotificationType"[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_affiliateId_key" ON "CreatorProfile"("affiliateId");
CREATE INDEX "CreatorProfile_country_city_status_idx" ON "CreatorProfile"("country", "city", "status");
CREATE INDEX "CreatorProfile_audienceSize_idx" ON "CreatorProfile"("audienceSize");
CREATE INDEX "CreatorDeliverable_campaignId_affiliateId_idx" ON "CreatorDeliverable"("campaignId", "affiliateId");
CREATE INDEX "CreatorDeliverable_status_dueAt_idx" ON "CreatorDeliverable"("status", "dueAt");
CREATE UNIQUE INDEX "CreatorPayment_campaignId_affiliateId_key" ON "CreatorPayment"("campaignId", "affiliateId");
CREATE INDEX "CreatorPayment_status_createdAt_idx" ON "CreatorPayment"("status", "createdAt");
CREATE UNIQUE INDEX "AffiliateProgram_slug_key" ON "AffiliateProgram"("slug");
CREATE INDEX "AffiliateProgram_businessId_status_idx" ON "AffiliateProgram"("businessId", "status");
CREATE UNIQUE INDEX "ProgramMembership_programId_affiliateId_key" ON "ProgramMembership"("programId", "affiliateId");
CREATE INDEX "ProgramMembership_affiliateId_status_idx" ON "ProgramMembership"("affiliateId", "status");
CREATE UNIQUE INDEX "BusinessMember_businessId_userId_key" ON "BusinessMember"("businessId", "userId");
CREATE INDEX "BusinessMember_userId_isActive_idx" ON "BusinessMember"("userId", "isActive");
CREATE UNIQUE INDEX "ExternalIntegration_publicKey_key" ON "ExternalIntegration"("publicKey");
CREATE INDEX "ExternalIntegration_businessId_kind_status_idx" ON "ExternalIntegration"("businessId", "kind", "status");
CREATE INDEX "ExternalIntegration_campaignId_idx" ON "ExternalIntegration"("campaignId");
CREATE UNIQUE INDEX "IntegrationApiKey_keyHash_key" ON "IntegrationApiKey"("keyHash");
CREATE INDEX "IntegrationApiKey_integrationId_revokedAt_idx" ON "IntegrationApiKey"("integrationId", "revokedAt");
CREATE UNIQUE INDEX "WebhookEvent_integrationId_externalEventId_key" ON "WebhookEvent"("integrationId", "externalEventId");
CREATE INDEX "WebhookEvent_status_createdAt_idx" ON "WebhookEvent"("status", "createdAt");
CREATE UNIQUE INDEX "ConversionVerification_webhookEventId_key" ON "ConversionVerification"("webhookEventId");
CREATE INDEX "ConversionVerification_conversionId_status_idx" ON "ConversionVerification"("conversionId", "status");
CREATE UNIQUE INDEX "AttributionTouch_integrationId_externalEventId_key" ON "AttributionTouch"("integrationId", "externalEventId");
CREATE INDEX "AttributionTouch_campaignId_visitorHash_occurredAt_idx" ON "AttributionTouch"("campaignId", "visitorHash", "occurredAt");
CREATE INDEX "AttributionTouch_affiliateId_occurredAt_idx" ON "AttributionTouch"("affiliateId", "occurredAt");
CREATE UNIQUE INDEX "BusinessAffiliateRecord_businessId_affiliateId_key" ON "BusinessAffiliateRecord"("businessId", "affiliateId");
CREATE INDEX "BusinessAffiliateRecord_businessId_stage_idx" ON "BusinessAffiliateRecord"("businessId", "stage");
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");
CREATE INDEX "Campaign_programId_idx" ON "Campaign"("programId");
CREATE INDEX "Conversion_integrationId_idx" ON "Conversion"("integrationId");
CREATE INDEX "CouponRedemption_couponId_redeemedAt_status_idx" ON "CouponRedemption"("couponId", "redeemedAt", "status");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_programId_fkey" FOREIGN KEY ("programId") REFERENCES "AffiliateProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "ExternalIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreatorDeliverable" ADD CONSTRAINT "CreatorDeliverable_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreatorDeliverable" ADD CONSTRAINT "CreatorDeliverable_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreatorPayment" ADD CONSTRAINT "CreatorPayment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreatorPayment" ADD CONSTRAINT "CreatorPayment_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AffiliateProgram" ADD CONSTRAINT "AffiliateProgram_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgramMembership" ADD CONSTRAINT "ProgramMembership_programId_fkey" FOREIGN KEY ("programId") REFERENCES "AffiliateProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgramMembership" ADD CONSTRAINT "ProgramMembership_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalIntegration" ADD CONSTRAINT "ExternalIntegration_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalIntegration" ADD CONSTRAINT "ExternalIntegration_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IntegrationApiKey" ADD CONSTRAINT "IntegrationApiKey_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "ExternalIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "ExternalIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversionVerification" ADD CONSTRAINT "ConversionVerification_conversionId_fkey" FOREIGN KEY ("conversionId") REFERENCES "Conversion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversionVerification" ADD CONSTRAINT "ConversionVerification_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "ExternalIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversionVerification" ADD CONSTRAINT "ConversionVerification_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "WebhookEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AttributionTouch" ADD CONSTRAINT "AttributionTouch_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "ExternalIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AttributionTouch" ADD CONSTRAINT "AttributionTouch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttributionTouch" ADD CONSTRAINT "AttributionTouch_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BusinessAffiliateRecord" ADD CONSTRAINT "BusinessAffiliateRecord_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessAffiliateRecord" ADD CONSTRAINT "BusinessAffiliateRecord_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
