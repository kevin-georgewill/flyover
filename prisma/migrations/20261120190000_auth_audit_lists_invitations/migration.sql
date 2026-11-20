-- Preserve access for existing accounts; verification is required for registrations created after this migration.
UPDATE "User" SET "isEmailVerified" = TRUE WHERE "isEmailVerified" = FALSE;

CREATE TYPE "AuthTokenType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
CREATE TYPE "AffiliateInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

ALTER TABLE "AffiliateProfile" ADD COLUMN "invitedById" TEXT;

CREATE TABLE "AuthToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "AuthTokenType" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AffiliateInvitation" (
  "id" TEXT NOT NULL,
  "inviterAffiliateId" TEXT NOT NULL,
  "inviteeEmail" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" "AffiliateInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedByUserId" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AffiliateInvitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");
CREATE INDEX "AuthToken_userId_type_expiresAt_idx" ON "AuthToken"("userId", "type", "expiresAt");
CREATE UNIQUE INDEX "AffiliateInvitation_tokenHash_key" ON "AffiliateInvitation"("tokenHash");
CREATE INDEX "AffiliateInvitation_inviterAffiliateId_status_createdAt_idx" ON "AffiliateInvitation"("inviterAffiliateId", "status", "createdAt");
CREATE INDEX "AffiliateInvitation_inviteeEmail_status_idx" ON "AffiliateInvitation"("inviteeEmail", "status");
CREATE INDEX "AffiliateProfile_invitedById_idx" ON "AffiliateProfile"("invitedById");
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AffiliateInvitation" ADD CONSTRAINT "AffiliateInvitation_inviterAffiliateId_fkey" FOREIGN KEY ("inviterAffiliateId") REFERENCES "AffiliateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AffiliateInvitation" ADD CONSTRAINT "AffiliateInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AffiliateProfile" ADD CONSTRAINT "AffiliateProfile_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "AffiliateProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
