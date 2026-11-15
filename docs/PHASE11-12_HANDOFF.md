# Flyover Backend — Phase 11/12 Handoff

## Scope

This delivery is backend-only. The frontend team should consume the Express API through Swagger UI and the OpenAPI contract.

- Swagger UI: `/docs`
- OpenAPI YAML: `/docs/openapi.yaml`
- API base path: `/api/v1`

Every Express route in the current backend is represented in `docs/openapi.yaml` (88 operations at the time of this handoff).

## Phase 11 capabilities

- Affiliate-specific coupons, code normalization, active windows and redemption caps.
- Transactional coupon redemption reservations with RESERVED/CONFIRMED/RELEASED states.
- Conversion attribution by referral, coupon, both, or first/last-click visitor window.
- Automatic conversion verification through signed Generic HMAC, Shopify and WooCommerce webhooks.
- Webhook event idempotency, sanitized event evidence, status tracking and retry.
- Creator profiles and creator discovery filters.
- PERFORMANCE, FIXED_FEE and HYBRID campaign compensation models.
- Creator deliverable submission, revision, review and fixed-fee payment status.
- Notification preferences and automated in-app workflow notifications.
- Scheduled, concurrency-safe commission release and multi-currency wallet balance breakdown.

## Phase 12 capabilities

- Private affiliate programmes with branded public registration pages and configurable fields.
- Programme application and membership approval.
- Private campaign visibility restricted to approved programme members.
- Business teams with OWNER, ADMIN, MANAGER and ANALYST roles.
- Multi-business selection through the `X-Business-Id` request header.
- External integration records, encrypted webhook secrets, one-time API keys and key revocation.
- External conversion reporting API for trusted server-to-server callers.
- Tracking SDK, domain allowlist and pseudonymous visitor attribution.
- Business affiliate CRM records and campaign/affiliate analytics.

## Environment configuration

Keep the existing `.env` file local. This package intentionally does not include `.env`.

Required for external integrations:
```env
API_PUBLIC_URL=https://api.example.com
INTEGRATION_ENCRYPTION_KEY=<64 hexadecimal characters>
```

Generate a unique encryption key:
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`INTEGRATION_ENCRYPTION_KEY` protects integration webhook credentials using AES-256-GCM. Back it up in a secret manager. If lost, encrypted credentials cannot be decrypted.

`API_PUBLIC_URL` is the externally reachable API origin without `/api/v1`; Flyover appends that path when returning webhook and tracking URLs.

The commission worker can be configured with:
```env
COMMISSION_RELEASE_INTERVAL_MS=60000
COMMISSION_RELEASE_BATCH_SIZE=100
```

## Database migration

The coupon foundation migration `20261115085435_phase11_coupon_foundation` is already part of the uploaded project snapshot and was reported as applied to Neon.

This delivery adds:
`20261115102000_phase11_12_backend_expansion`

The new migration:
- makes campaign commission terms nullable for fixed-fee-only campaigns while preserving existing values;
- adds compensation model and fixed-fee campaign fields;
- adds creator, programme, business team, integration, verification, tracking, CRM and notification preference tables;
- adds conversion attribution metadata and coupon redemption lifecycle status;
- adds the PRIVATE campaign access enum value.

Do not reset the database. Apply the pending migration with `npx prisma migrate dev` after validating the schema and regenerating Prisma Client.

## Local validation sequence (Windows PowerShell)

From the backend project root:

```powershell
npx prisma validate
npx prisma generate
npm run typecheck
npm run build
npm test
npx prisma migrate dev
```

If Prisma proposes resetting the database, stop. Do not approve a reset.

After migration:
1. Restart the backend.
2. Open `/docs`.
3. Authenticate as a business, affiliate and admin test account.
4. Test the coupon, creator, programme, integration and CRM flows using Swagger.
5. Configure a provider test webhook and verify duplicate delivery/retry behavior before production.

## Important operational boundaries

- API-key conversion reports remain PENDING for business review. Only signed provider webhooks on configured integrations can automatically approve a conversion.
- Shopify and WooCommerce webhook signature and payload adapters are included. Merchants must still configure their own webhook delivery URL, event types and signing secret.
- The tracking SDK records attribution touches; a client-side touch is not proof of payment.
- Creator payment and affiliate withdrawal endpoints record manual payment status. They do not initiate bank transfers.
- Wallet balances are currency-separated, but withdrawal requests remain NGN-only.
- Notification preferences and in-app notifications are implemented. Email delivery requires an email provider and delivery worker.
- Creator deliverables store HTTPS asset URLs; direct file storage/upload infrastructure is not included.
- Business team membership adds existing BUSINESS accounts; email invitations are not sent.
- International payouts require a selected provider, credentials, compliance review and end-to-end acceptance tests.
- Affiliate team commissions, advanced fraud scoring, full dispute/reversal workflows and AI recommendations remain outside this delivery.

## Security reminder

The original uploaded archive contained `.env`. This handoff archive excludes it, but rotate the Neon database password and JWT signing secret from that file before production use. Never commit or upload `.env`, integration encryption keys, webhook secrets or integration API keys.
