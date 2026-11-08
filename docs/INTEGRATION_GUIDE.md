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
