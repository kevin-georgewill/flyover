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
