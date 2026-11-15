# Flyover Backend — Foundation MVP + Phase 11/12 APIs

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
- Coupon creation, coupon attribution, redemption reservations and reconciliation.
- First/last-click attribution-window touches and browser tracking SDK.
- Automatic conversion verification through signed generic HMAC, Shopify and WooCommerce webhook adapters.
- Creator profiles/discovery, fixed-fee and hybrid campaigns, deliverables and creator payment status.
- Private affiliate programmes with custom registration pages and membership approval.
- Business team roles, external integration/API key management, webhook event audit/retry, affiliate CRM and advanced analytics.
- Scheduled, idempotent commission release worker and multi-currency wallet balance breakdown.

## Remaining production integrations and boundaries
- Email/SMS delivery, password reset and verification-document upload.
- Automated bank payouts and international payout provider integrations. Withdrawal and creator-payment endpoints record manual payment outcomes only.
- Email notification delivery; notification preferences and in-app notifications are implemented.
- Affiliate team commissions, advanced fraud scoring and full dispute/reversal workflows.
- AI marketing assistant and automated campaign recommendations remain deferred until reliable usage data exists, as required by the roadmap.
- Provider-specific webhook setup still requires each merchant's provider account, webhook secret, public API URL and acceptance tests.

## Requirements
- Node.js 20+
- npm
- Docker Desktop (recommended for local PostgreSQL)

## Setup
1. Copy `.env.example` to `.env` and set strong local secrets. Never commit `.env`.
2. Start PostgreSQL: `docker compose up -d`
3. Install: `npm install`
4. Generate Prisma client: `npm run db:generate`
5. Create migration: `npm run db:migrate -- --name init` (for an empty local database; existing deployments use `npm run db:deploy`)
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

## Swagger / frontend handoff
Interactive Swagger UI: `http://localhost:4000/docs`  
OpenAPI contract: `http://localhost:4000/docs/openapi.yaml`

The frontend developer should use Swagger UI and `docs/openapi.yaml` as the API contract. Start with `docs/INTEGRATION_GUIDE.md`, then `docs/API.md`. Backend changes to routes, request shapes, response shapes, enums or permissions must be reflected in the docs in the same pull request.
