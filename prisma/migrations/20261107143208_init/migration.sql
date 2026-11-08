-- CreateEnum
CREATE TYPE "Role" AS ENUM ('AFFILIATE', 'BUSINESS', 'ADMIN');

-- CreateEnum
CREATE TYPE "BusinessStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ENDED');

-- CreateEnum
CREATE TYPE "CampaignAccess" AS ENUM ('OPEN', 'APPROVAL', 'INVITATION');

-- CreateEnum
CREATE TYPE "CampaignAction" AS ENUM ('CPS', 'CPL', 'CPR', 'CPA');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "AttributionModel" AS ENUM ('FIRST_CLICK', 'LAST_CLICK');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'INVITED');

-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVERSED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'AVAILABLE', 'REVERSED');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('PENDING_CREDIT', 'PENDING_DEBIT', 'AVAILABLE_CREDIT', 'AVAILABLE_DEBIT', 'WITHDRAWAL_RESERVED', 'WITHDRAWAL_RELEASED', 'WITHDRAWN', 'REVERSAL');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PROCESSING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('GENERAL', 'BUSINESS_VERIFICATION', 'CAMPAIGN', 'APPLICATION', 'CONVERSION', 'COMMISSION', 'WITHDRAWAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffiliateProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bio" TEXT,
    "website" TEXT,
    "socialLinks" JSONB,
    "promotionalChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audienceSize" INTEGER,
    "country" TEXT NOT NULL DEFAULT 'Nigeria',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AffiliateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "website" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Nigeria',
    "registrationNumber" TEXT,
    "verificationNotes" TEXT,
    "status" "BusinessStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "category" TEXT,
    "imageUrl" TEXT,
    "destinationUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "instructions" TEXT,
    "category" TEXT,
    "country" TEXT NOT NULL DEFAULT 'Nigeria',
    "action" "CampaignAction" NOT NULL DEFAULT 'CPS',
    "commissionType" "CommissionType" NOT NULL,
    "commissionValue" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "access" "CampaignAccess" NOT NULL DEFAULT 'OPEN',
    "attributionModel" "AttributionModel" NOT NULL DEFAULT 'LAST_CLICK',
    "attributionDays" INTEGER NOT NULL DEFAULT 30,
    "validationDays" INTEGER NOT NULL DEFAULT 14,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "destinationUrl" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectionReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignApplication" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Click" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    "userAgent" TEXT,
    "ipHash" TEXT,

    CONSTRAINT "Click_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversion" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "customerReference" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "ConversionStatus" NOT NULL DEFAULT 'PENDING',
    "submittedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "rejectionReason" TEXT,
    "evidenceUrl" TEXT,
    "convertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "conversionId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "commissionAmount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletEntry" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "bankName" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "adminNote" TEXT,
    "paymentReference" TEXT,
    "reviewedById" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'GENERAL',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_idx" ON "RefreshSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateProfile_userId_key" ON "AffiliateProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessProfile_userId_key" ON "BusinessProfile"("userId");

-- CreateIndex
CREATE INDEX "Product_businessId_idx" ON "Product"("businessId");

-- CreateIndex
CREATE INDEX "Campaign_status_category_country_idx" ON "Campaign"("status", "category", "country");

-- CreateIndex
CREATE INDEX "Campaign_businessId_idx" ON "Campaign"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignApplication_campaignId_affiliateId_key" ON "CampaignApplication"("campaignId", "affiliateId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_code_key" ON "Referral"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_campaignId_affiliateId_key" ON "Referral"("campaignId", "affiliateId");

-- CreateIndex
CREATE INDEX "Click_referralId_clickedAt_idx" ON "Click"("referralId", "clickedAt");

-- CreateIndex
CREATE INDEX "Conversion_affiliateId_status_idx" ON "Conversion"("affiliateId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Conversion_campaignId_externalReference_key" ON "Conversion"("campaignId", "externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "Commission_conversionId_key" ON "Commission"("conversionId");

-- CreateIndex
CREATE INDEX "Commission_affiliateId_status_idx" ON "Commission"("affiliateId", "status");

-- CreateIndex
CREATE INDEX "WalletEntry_affiliateId_createdAt_idx" ON "WalletEntry"("affiliateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletEntry_type_referenceType_referenceId_key" ON "WalletEntry"("type", "referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "Withdrawal_affiliateId_status_idx" ON "Withdrawal"("affiliateId", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliateProfile" ADD CONSTRAINT "AffiliateProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignApplication" ADD CONSTRAINT "CampaignApplication_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignApplication" ADD CONSTRAINT "CampaignApplication_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Click" ADD CONSTRAINT "Click_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_conversionId_fkey" FOREIGN KEY ("conversionId") REFERENCES "Conversion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
