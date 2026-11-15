# Flyover Frontend Integration Guide

## Base URL
Local: `http://localhost:4000/api/v1`  
Frontend `.env.local`: `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1`

Do not expose backend secrets in frontend environment variables.

## Authentication
1. Register with `POST /auth/register` (role must be `AFFILIATE` or `BUSINESS`).
2. Login with `POST /auth/login`.
3. Keep `accessToken` in the authenticated API client and send `Authorization: Bearer <accessToken>`.
4. On expiry, call `POST /auth/refresh` with `{ "refreshToken": "..." }`.
5. Replace both tokens with the rotated tokens returned by the API.
6. Logout with `POST /auth/logout` and the current refresh token.

Production should use an HttpOnly Secure SameSite refresh cookie. Coordinate this change before launch.

## Role-based screens
- **AFFILIATE:** profile, marketplace, applications, referral links, wallet, withdrawals, affiliate analytics.
- **BUSINESS:** profile, verification, products, campaigns, campaign applications, conversions, business analytics.
- **ADMIN:** business verification, campaign moderation, user status, commission release, withdrawal management.

The frontend can hide unavailable navigation, but the backend is authoritative for permissions.

## Business workflow
1. Register as BUSINESS.
2. Update `PATCH /businesses/me`.
3. Submit `POST /businesses/verification`.
4. Wait for admin approval.
5. Create product using `POST /products`.
6. Create campaign using `POST /campaigns`.
7. Submit using `POST /campaigns/:id/submit`.
8. Review applications using `GET /businesses/campaigns/:id/applications`.
9. Review conversions using `GET /businesses/conversions`.
10. Approve/reject using `PATCH /businesses/conversions/:id/review`.

## Affiliate workflow
1. Register as AFFILIATE.
2. Complete `PATCH /affiliates/me`.
3. Browse `GET /marketplace/campaigns`.
4. Join/apply using `POST /campaigns/:id/apply`.
5. Retrieve referral links using `GET /affiliates/referrals`.
6. Share `/r/:code`.
7. View wallet using `GET /wallet`.
8. Request withdrawal using `POST /withdrawals`.

Open campaign join returns an application and referral. Approval-based campaigns initially return a pending application; referral is created when the business approves it. Invitation-only join is currently blocked; invitation issuing/acceptance is not implemented in this MVP.

## Admin workflow
Admin credentials are created using `npm run db:seed`.
- `GET /admin/businesses?status=PENDING`
- `PATCH /admin/businesses/:id/review`
- `GET /admin/campaigns?status=PENDING`
- `PATCH /admin/campaigns/:id/review`
- `GET /admin/users`
- `PATCH /admin/users/:id/status`
- `GET /admin/withdrawals`
- `PATCH /admin/withdrawals/:id/review`
- `POST /admin/commissions/:id/release`

## Response conventions
Success: `{ "success": true, "data": ... }`  
Error: `{ "success": false, "error": { "code": "...", "message": "..." } }`

## Important frontend rules
- Do not calculate commission values in the browser.
- Pending commissions are not withdrawable.
- Only show withdrawal actions against available wallet balance.
- Do not assume business verification is approved after form submission.
- Campaigns are discoverable only after admin approval.
- Treat monetary values as display values; do not use JS floating point for financial calculations.
- `GET /r/:code` is a redirect endpoint, not a JSON API call. Open it as a navigation URL.


## Swagger-first integration
Interactive documentation: `http://localhost:4000/docs`  
OpenAPI YAML: `http://localhost:4000/docs/openapi.yaml`

Use Swagger as the canonical contract for request bodies, enums, path/query parameters, authentication schemes and response envelopes. The backend developer updates `docs/openapi.yaml` in the same change as every route or schema change.

## Phase 11 workflows
### Coupons
1. Business issues an affiliate-specific coupon with `POST /campaigns/:id/coupons`.
2. Business and affiliate retrieve coupons from their respective list endpoints.
3. Business submits a conversion using `couponCode`, `referralCode`, or both.
4. Business approves/rejects the pending conversion.
5. Coupon redemption moves from RESERVED to CONFIRMED or RELEASED.

### Creators
1. Affiliate creates a creator profile using `PUT /creators/me`.
2. Business searches creators using `GET /creators`.
3. Business creates a campaign with `compensationModel` set to `FIXED_FEE` or `HYBRID`.
4. Affiliate joins/applies using the existing campaign participation flow.
5. Affiliate submits deliverables; business reviews them.
6. Once required deliverables are approved, creator payment status becomes APPROVED. Business records PROCESSING/PAID/FAILED manually.

## Phase 12 workflows
### Private programmes
1. Business creates a programme and registration-page fields.
2. Business activates the programme.
3. Prospective affiliates use the public programme page and registration endpoint, or existing affiliates apply.
4. Business approves membership.
5. Business creates a campaign with `access: PRIVATE` and the programme ID.
6. Only approved programme members can discover/join that campaign.

### Integrations
1. Configure `API_PUBLIC_URL` and `INTEGRATION_ENCRYPTION_KEY` on the backend.
2. Business admin creates an integration and supplies its provider webhook secret.
3. Business admin creates a one-time integration API key if external conversion reporting is required.
4. Configure the provider webhook to call `/api/v1/webhooks/:id` with its signing header.
5. For tracking, install the returned tracking snippet on the merchant website.
6. Monitor event status using the business integration events endpoint and retry failed verified webhooks.

Do not put provider secrets, integration API keys or the integration encryption key in frontend environment variables. The API key is returned once and should be held by the external server that reports conversions.

## Business team roles
- OWNER: business account owner.
- ADMIN: full business administration, team and integration configuration.
- MANAGER: operational write access for campaigns, programmes and CRM.
- ANALYST: read-only business access.

The frontend should hide actions that the current member role cannot perform, but backend authorization remains authoritative.


### Selecting a business context
Business users who own or belong to multiple businesses should send `X-Business-Id: <business-profile-id>` on business-scoped requests. The backend verifies that the caller owns or is an active member of the selected business and enforces the member role. If omitted, the owner's business is selected first, otherwise the user's first active membership is used.
