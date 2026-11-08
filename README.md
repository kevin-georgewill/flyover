# Flyover Backend — Foundation MVP

Node.js + Express + TypeScript + PostgreSQL + Prisma backend for the Flyover Affiliate Growth Network.

> **Important:** This is an implementation baseline for development and integration, not a production-certified financial platform. Review `docs/PRODUCTION_CHECKLIST.md` and close its items before handling real users' money.

## Included
- Affiliate/business registration, login, refresh-token rotation, logout and current-user endpoint.
- Role-based authorization for AFFILIATE, BUSINESS and ADMIN.
- Affiliate and business profile updates; business verification submission and admin review.
- Business product/service creation.
- Campaign creation, editing, submission, moderation and marketplace discovery.
- Open campaign joining and approval-based applications.
- Unique referral links and click recording/redirect.
- Business-submitted manual conversions and approval/rejection.
- Commission creation on approved conversion, pending/available ledger entries and admin release after validation.
- Wallet history, withdrawal requests and admin-recorded payout outcomes.
- Notifications, audit records and basic affiliate/business analytics.

## Not included yet
Email verification delivery, password reset, document uploads, automated payment payouts, automated conversion webhooks, coupon attribution, creator fixed-fee workflows, external tracking SDK, private affiliate programmes, affiliate team commissions, advanced fraud detection, full dispute workflow and scheduled commission release worker.

## Requirements
- Node.js 20+
- npm
- Docker Desktop (recommended for local PostgreSQL)

## Setup
1. Copy `.env.example` to `.env` and set strong local secrets. Never commit `.env`.
2. Start PostgreSQL: `docker compose up -d`
3. Install: `npm install`
4. Generate Prisma client: `npm run db:generate`
5. Create migration: `npm run db:migrate -- --name init`
6. Seed admin: `npm run db:seed`
7. Start server: `npm run dev`

API: `http://localhost:4000/api/v1`  
Health: `GET http://localhost:4000/api/v1/health`

## Commands
`npm run typecheck` · `npm test` · `npm run build` · `npm run db:studio`

## Authentication
Public registration permits only `AFFILIATE` and `BUSINESS`. Admin users are created through the seed script. Login returns a short-lived access JWT and a random refresh token. Refresh tokens are stored hashed and rotated on refresh. Send access tokens using `Authorization: Bearer <token>`.

The JSON refresh-token response is a local integration convenience. Before production, prefer Secure, HttpOnly, SameSite cookies and implement email verification/password reset.

## API conventions
All routes are under `/api/v1`. Success: `{ "success": true, "data": ... }`. Errors: `{ "success": false, "error": { "code": "...", "message": "..." } }`. Validation errors return HTTP 400 with details.

Money is persisted using PostgreSQL Decimal columns. Avoid frontend floating-point arithmetic for financial decisions. The current MVP minimum withdrawal is NGN 5,000; confirm this product rule before launch.

## Frontend handoff
Start with `docs/INTEGRATION_GUIDE.md`, then `docs/API.md` and `docs/openapi.yaml`. Backend changes to routes, request shapes, response shapes, enums or permissions must be reflected in the docs in the same pull request.
