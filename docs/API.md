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
