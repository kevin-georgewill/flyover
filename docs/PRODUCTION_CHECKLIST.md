# Production Readiness Checklist

Do not handle real customer funds until the following are reviewed and completed.

## Security
- [ ] Implement email verification and password reset with expiring, single-use tokens.
- [ ] Move refresh tokens to Secure, HttpOnly, SameSite cookies where appropriate.
- [ ] Revoke refresh sessions on password changes and account suspension.
- [ ] Add tighter rate limits to registration, login, refresh and referral redirect.
- [ ] Configure exact production CORS origins and secrets management.
- [ ] Review privacy notice, retention and applicable Nigeria Data Protection requirements.

## Attribution and conversions
- [ ] Define and implement attribution-window persistence, repeat-click, direct traffic and coupon precedence.
- [ ] Add bot filtering and referral abuse detection.
- [ ] Define conversion evidence, business review deadlines, disputes and escalation.
- [ ] Add idempotency/concurrency protection for conversion approval and commission creation.

## Financial integrity
- [ ] Use Decimal/integer minor-unit arithmetic end-to-end; current commission helper uses JS number and must be replaced before production.
- [ ] Add database concurrency controls and idempotency keys for withdrawal reservations.
- [ ] Implement immutable reversal/adjustment workflows and reconciliation reports.
- [ ] Add scheduled commission release worker with retry safety.
- [ ] Review withdrawal state transitions and prevent invalid/repeated terminal transitions.
- [ ] Confirm minimum withdrawal, commission and validation policies.
- [ ] Integrate a compliant payout provider before offering automated payouts.
- [ ] Independently review financial workflows and test race conditions.

## Operations
- [ ] Configure production database, backups and restore drills.
- [ ] Add monitoring, alerting, error reporting and structured production logs.
- [ ] Add CI for typecheck, tests, Prisma validation, migrations and build.
- [ ] Add staging environment, deployment and rollback process.
- [ ] Load test referral redirects and marketplace queries.
- [ ] Add end-to-end tests for the entire MVP transaction loop.

## Known MVP gaps
- No email/SMS delivery, password reset or document uploads.
- No automated payouts, automatic conversion integrations or coupon tracking.
- No full invitation-only campaign workflow.
- No full dispute or commission reversal workflow.
- Commission release is admin-triggered, not scheduled.
- Wallet/withdrawal concurrency and commission arithmetic need further hardening.
- Analytics are basic counts/aggregates, not a full reporting suite.


## Phase 11/12 integration readiness
- [ ] Generate and securely back up a unique `INTEGRATION_ENCRYPTION_KEY` for each environment.
- [ ] Configure `API_PUBLIC_URL` with HTTPS and the correct externally reachable API origin.
- [ ] Configure and test provider webhook signatures for each merchant account; verify retries and duplicate event behavior.
- [ ] Review provider payload mappings for the exact Shopify/WooCommerce versions and enabled event types used by each merchant.
- [ ] Configure integration API key expiry, scope and rotation policies; store plaintext keys only in the external server's secret manager.
- [ ] Define privacy/retention policy for visitor hashes, tracking events, webhook evidence and CRM notes.
- [ ] Validate custom programme registration fields and abuse/rate limits before public programme pages are promoted.
- [ ] Review business member invitations and role assignments; add email invitation delivery before enabling self-service invites.
- [ ] Confirm creator deliverable asset URLs point to approved storage with access controls; direct upload/storage provider is not included.
- [ ] Select and integrate a compliant payout provider before marking any automated or international payout capability as available.
- [ ] Configure an email provider and delivery worker before enabling email notification delivery.
- [ ] Run end-to-end tests for coupon redemption race conditions, webhook retries, API-key idempotency, first/last-click attribution, fixed-fee payment transitions and private-program permissions.
