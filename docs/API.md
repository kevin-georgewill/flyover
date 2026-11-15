# Flyover API Reference — MVP

Base path: `/api/v1`  
Protected routes use `Authorization: Bearer <accessToken>`.

## Response format
Success: `{ "success": true, "data": ... }`  
Error: `{ "success": false, "error": { "code": "...", "message": "..." } }`. Validation errors can include `details`.

## Health
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/health` | Public | API and database health |

## Authentication
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/auth/register` | Public | Register affiliate/business |
| POST | `/auth/login` | Public | Login and issue tokens |
| POST | `/auth/refresh` | Refresh token | Rotate refresh token |
| POST | `/auth/logout` | Authenticated | Revoke refresh token |
| GET | `/auth/me` | Authenticated | Current user and profile |

Register payload: `{ "fullName":"Ada Example", "email":"ada@example.com", "phone":"+2348000000000", "password":"long-password-here", "role":"AFFILIATE" }`. Role is `AFFILIATE` or `BUSINESS`; admin registration is disabled.

Login payload: `{ "email":"ada@example.com", "password":"long-password-here" }`.

## Profiles and verification
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| PATCH | `/affiliates/me` | AFFILIATE | Update affiliate profile |
| PATCH | `/businesses/me` | BUSINESS | Update business profile |
| POST | `/businesses/verification` | BUSINESS | Submit verification |

## Products
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/products` | Approved BUSINESS | Create product/service |
| GET | `/products` | BUSINESS | List own products |

## Campaigns and marketplace
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/campaigns` | Approved BUSINESS | Create draft |
| GET | `/campaigns/mine` | BUSINESS | List own campaigns |
| PATCH | `/campaigns/:id` | BUSINESS | Edit draft/rejected campaign |
| POST | `/campaigns/:id/submit` | BUSINESS | Submit for moderation |
| GET | `/marketplace/campaigns` | Authenticated | Search approved campaigns |
| GET | `/campaigns/:id` | Authenticated | Approved campaign details |
| POST | `/campaigns/:id/apply` | AFFILIATE | Join/apply |
| GET | `/businesses/campaigns/:id/applications` | BUSINESS | List applications for own campaign |
| PATCH | `/businesses/applications/:id` | BUSINESS | Approve/reject application |

Campaign example:
```json
{
  "name":"Promote SmartTech",
  "description":"Earn commission on qualifying sales.",
  "action":"CPS",
  "commissionType":"PERCENTAGE",
  "commissionValue":10,
  "currency":"NGN",
  "access":"OPEN",
  "attributionModel":"LAST_CLICK",
  "attributionDays":30,
  "validationDays":14,
  "destinationUrl":"https://merchant.example/product"
}
```
Enums: action `CPS|CPL|CPR|CPA`; commission type `PERCENTAGE|FIXED`; access `OPEN|APPROVAL|INVITATION`; attribution `FIRST_CLICK|LAST_CLICK`.

## Referrals and conversions
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/affiliates/referrals` | AFFILIATE | List own links and counts |
| GET | `/r/:code` | Public | Record click and redirect |
| POST | `/businesses/conversions` | BUSINESS | Submit manual conversion |
| GET | `/businesses/conversions` | BUSINESS | List own conversions |
| PATCH | `/businesses/conversions/:id/review` | BUSINESS | Approve/reject pending conversion |

Conversion submission: `{ "referralCode":"code-from-affiliate", "externalReference":"ORDER-1001", "amount":50000, "currency":"NGN" }`.

Conversion review: `{ "decision":"APPROVED" }` or `{ "decision":"REJECTED", "rejectionReason":"Refunded" }`.

## Wallet and withdrawals
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/wallet` | AFFILIATE | Wallet balances and ledger |
| POST | `/withdrawals` | AFFILIATE | Request withdrawal |
| GET | `/withdrawals` | AFFILIATE | List own withdrawals |
| GET | `/admin/withdrawals` | ADMIN | List requests |
| PATCH | `/admin/withdrawals/:id/review` | ADMIN | Update payment status |
| POST | `/admin/commissions/:id/release` | ADMIN | Release matured commission |

Withdrawal payload: `{ "amount":10000, "bankName":"Example Bank", "accountName":"Ada Example", "accountNumber":"0123456789" }`. MVP minimum is NGN 5,000 and must be confirmed by product owner.

Admin payment outcome example: `{ "decision":"PAID", "paymentReference":"BANK-REF-123", "adminNote":"Paid manually" }`. This records a payment made outside Flyover; it does not initiate a bank transfer.

## Administration
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/admin/businesses` | ADMIN | List businesses; optional status filter |
| PATCH | `/admin/businesses/:id/review` | ADMIN | Approve/reject business |
| GET | `/admin/campaigns` | ADMIN | List campaigns; optional status filter |
| PATCH | `/admin/campaigns/:id/review` | ADMIN | Approve/reject/suspend campaign |
| GET | `/admin/users` | ADMIN | List users |
| PATCH | `/admin/users/:id/status` | ADMIN | Activate/suspend user |

## Notifications and analytics
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/notifications` | Authenticated | List own notifications |
| PATCH | `/notifications/:id/read` | Authenticated | Mark own notification read |
| GET | `/analytics/affiliate` | AFFILIATE | Affiliate metrics |
| GET | `/analytics/business` | BUSINESS | Business metrics |

## Important implementation limitations
- No email/SMS delivery, password reset or verification-document upload.
- No automatic payment payout or automatic conversion verification.
- Attribution is referral-code based; the full multi-click attribution window/cookie policy is not implemented yet.
- Invitation-only campaign invite workflow is not implemented.
- Commission release is admin-triggered, not scheduled.
- Commission reversal and complete dispute workflows are not implemented.
- Analytics are basic aggregates.


---

# Phase 11 — Automation, coupons and creator campaigns

## Coupon management
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/campaigns/:id/coupons` | BUSINESS | Issue an affiliate-specific coupon |
| GET | `/campaigns/:id/coupons` | BUSINESS | List campaign coupons and redemption counts |
| GET | `/affiliates/coupons` | AFFILIATE | List coupons assigned to the affiliate |
| PATCH | `/coupons/:id` | BUSINESS | Activate/deactivate, adjust expiry or redemption cap |

Coupon creation example:
```json
{
  "affiliateId": "affiliate-profile-id",
  "code": "SAVE10",
  "discountType": "PERCENTAGE",
  "discountValue": 10,
  "maxRedemptions": 100,
  "expiresAt": "2027-01-31T23:59:59.000Z"
}
```

Coupon codes are stored uppercase and globally unique. Coupon attribution is tied to a campaign and affiliate. Redemption reservations are made transactionally when a manual conversion is submitted; approval confirms the redemption and rejection releases it. A coupon's discount is not deducted by Flyover from the conversion amount: the merchant checkout must apply the discount.

## Attribution and conversion verification
`POST /businesses/conversions` accepts one of:
- `referralCode`
- `couponCode`
- both, when they resolve to the same campaign and affiliate
- `campaignId` plus `visitorId`, to resolve first-click or last-click attribution within the campaign's configured attribution window

Example coupon conversion:
```json
{
  "couponCode": "SAVE10",
  "externalReference": "ORDER-2001",
  "amount": 45000,
  "currency": "NGN"
}
```

The conversion is pending until the business reviews it. A trusted signed provider webhook can create an automatically verified conversion and trigger the performance commission workflow.

## Creator profiles and campaigns
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/creators/me` | AFFILIATE | Get own creator profile |
| PUT | `/creators/me` | AFFILIATE | Create/update creator profile |
| GET | `/creators` | BUSINESS | Discover creators |
| GET | `/creators/:id` | Authenticated | View creator profile |
| POST | `/creator-campaigns/:campaignId/deliverables` | AFFILIATE | Submit deliverable |
| PATCH | `/creator-campaigns/:campaignId/deliverables/:id` | AFFILIATE | Resubmit after revision request |
| GET | `/creator-campaigns/:campaignId/deliverables` | AFFILIATE | List own deliverables |
| GET | `/businesses/campaigns/:id/deliverables` | BUSINESS | Review campaign deliverables |
| PATCH | `/businesses/deliverables/:id/review` | BUSINESS | Approve, reject, request revision |
| GET | `/businesses/campaigns/:id/creator-payments` | BUSINESS | List fixed-fee payments |
| GET | `/affiliates/creator-payments` | AFFILIATE | View own creator payment status |
| PATCH | `/businesses/creator-payments/:id` | BUSINESS ADMIN | Update payment status |

Campaign compensation models:
- `PERFORMANCE`: commission terms required.
- `FIXED_FEE`: fixedFeeAmount required; no performance commission is created.
- `HYBRID`: both fixed fee and performance commission terms required.

For fixed-fee/hybrid campaigns, the business sets `requiredDeliverables`. Creator payment becomes APPROVED only after that number of deliverables has been approved. Marking a creator payment PAID records a manual payment outcome; it does not transfer funds.

# Phase 12 — Business infrastructure and ecosystem

## Private affiliate programmes and registration pages
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/businesses/programs` | BUSINESS | Create a private programme |
| GET | `/businesses/programs` | BUSINESS | List programmes |
| PATCH | `/businesses/programs/:id` | BUSINESS | Update page branding, fields or status |
| GET | `/programs/:slug` | Public | Fetch public registration page |
| POST | `/programs/:slug/register` | Public | Create affiliate account and programme application |
| POST | `/programs/:slug/apply` | AFFILIATE | Apply with an existing account |
| GET | `/programs/:slug/campaigns` | AFFILIATE | List private campaigns after programme approval |
| GET | `/businesses/programs/:id/members` | BUSINESS | List applicants/members |
| PATCH | `/businesses/program-memberships/:id` | BUSINESS | Approve/reject/suspend membership |

Campaigns can use `access: "PRIVATE"` and must reference an active `programId`. Private campaigns are excluded from the general marketplace and are visible only to approved programme members.

Custom registration fields support `TEXT`, `URL` and `NUMBER`. Public registration creates an AFFILIATE user and stores answers on the programme membership.

## Business teams and permissions
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/businesses/members` | BUSINESS | List team members |
| POST | `/businesses/members` | BUSINESS OWNER/ADMIN | Add an existing BUSINESS user |
| PATCH | `/businesses/members/:id` | BUSINESS OWNER/ADMIN | Change role or deactivate |

Roles:
- `OWNER`: original business owner.
- `ADMIN`: manage business settings, members and integrations.
- `MANAGER`: manage day-to-day campaigns, programme and CRM workflows.
- `ANALYST`: read-only access.

The member endpoint adds an existing BUSINESS account by email. It does not send an invitation email.

## External integrations, webhooks and conversion reporting
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/businesses/integrations` | BUSINESS ADMIN | Create integration |
| GET | `/businesses/integrations` | BUSINESS | List integrations |
| PATCH | `/businesses/integrations/:id/status` | BUSINESS ADMIN | Activate/pause/revoke |
| PATCH | `/businesses/integrations/:id/credentials` | BUSINESS ADMIN | Rotate webhook secret |
| POST | `/businesses/integrations/:id/api-keys` | BUSINESS ADMIN | Create integration API key |
| GET | `/businesses/integrations/:id/api-keys` | BUSINESS ADMIN | List API key metadata |
| DELETE | `/businesses/integrations/:id/api-keys/:keyId` | BUSINESS ADMIN | Revoke API key |
| GET | `/businesses/integrations/:id/events` | BUSINESS | View integration events |
| POST | `/integrations/:id/conversions` | Integration API key | Report conversion for manual review |
| POST | `/webhooks/:id` | Public URL + provider signature | Receive signed provider event |
| POST | `/businesses/integrations/:id/events/:eventRecordId/retry` | BUSINESS ADMIN | Retry a failed verified webhook |

Supported webhook signature adapters:
- `GENERIC_HMAC`: `x-flyover-signature`, hex HMAC-SHA256.
- `SHOPIFY`: `x-shopify-hmac-sha256`, base64 HMAC-SHA256.
- `WOOCOMMERCE`: `x-wc-webhook-signature`, base64 HMAC-SHA256.

Webhook payloads are normalized to Flyover conversion events. Only paid/success events are accepted for automatic verification. Duplicate provider event IDs and duplicate campaign/externalReference conversions are idempotently handled. API-key conversion reports remain pending business review; API keys do not auto-approve conversions.

Integration API keys are returned once. Store them securely and send them as `Authorization: Bearer <integration-api-key>`. Keys are stored as hashes and can be revoked.

Required environment configuration:
```env
API_PUBLIC_URL=https://api.your-domain.example
INTEGRATION_ENCRYPTION_KEY=<64-character-hex-key>
```
Generate the encryption key with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
The encryption key must be backed up securely. Losing it makes encrypted provider secrets unrecoverable. Never expose it to the frontend.

## Tracking SDK and attribution touches
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/tracking.js` | Public | Serve browser tracking SDK |
| POST | `/tracking/:publicKey/events` | Public key + allowed origin | Record page, click, product and checkout touches |

Create a `TRACKING` integration assigned to an approved campaign. The response includes a snippet:
```html
<script async
  src="https://api.your-domain.example/api/v1/tracking.js"
  data-key="flw_pub_..."
  data-endpoint="https://api.your-domain.example/api/v1">
</script>
```
The SDK records a pseudonymous visitor ID and tracking event IDs. Conversion attribution uses the campaign's `FIRST_CLICK` or `LAST_CLICK` model and `attributionDays`. Tracking touches are attribution evidence, not proof of payment. Use signed provider webhooks or the business review process to verify sales.

## CRM, notifications and analytics
| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/businesses/crm/affiliates` | BUSINESS | Search affiliate CRM |
| PUT | `/businesses/crm/affiliates/:affiliateId` | BUSINESS | Upsert notes, tags and relationship stage |
| GET | `/notifications/preferences` | Authenticated | Read notification preferences |
| PATCH | `/notifications/preferences` | Authenticated | Update in-app/email preference flags and muted event types |
| GET | `/analytics/business/campaigns` | BUSINESS | Campaign performance breakdown |
| GET | `/analytics/business/affiliates` | BUSINESS | Affiliate performance breakdown |

Email preference is stored, but email delivery is not enabled until an email provider and delivery worker are configured. In-app notifications are applied according to saved preferences.

## Integration and financial boundaries
- External integration credentials are encrypted with AES-256-GCM; the encryption key is supplied through the backend environment.
- Provider webhooks must pass signature verification before processing.
- Webhook event IDs and external conversion references are idempotency boundaries.
- Coupon redemption limits are checked while holding a database row lock.
- Commission releases run through a retry-safe background worker and can also be triggered by an admin.
- Wallet balances are returned by currency. Withdrawal requests remain NGN-only in this release.
- Creator payments and withdrawals record manual payment outcomes; no bank transfer is initiated by these endpoints.
- Shopify and WooCommerce webhook payload adapters are included, but each merchant must configure the provider webhook URL, secret, and event delivery in their provider dashboard.
- International payout provider integrations require provider selection, credentials, compliance review and acceptance tests before enabling real transfers.


Business users with access to multiple businesses may send `X-Business-Id: <business-profile-id>` on business-scoped requests to select the tenant context. Access and role are verified server-side.
