# Flyover Frontend — The Affiliate Growth Network

Responsive, installable PWA for Flyover (roadmap phases 1–10, Developer B). Built with **Next.js 15 (App Router) + TypeScript + Tailwind CSS + TanStack Query**, against the Flyover backend MVP API (`/api/v1`).

## Quick start

```bash
npm install
cp .env.example .env.local      # point NEXT_PUBLIC_API_BASE_URL at the backend
npm run dev                     # http://localhost:3000
```

The backend must allow the frontend origin: `CORS_ORIGINS=http://localhost:3000`.

### Demo mode (no backend needed)

```bash
NEXT_PUBLIC_USE_MOCKS=true npm run dev
```

This runs the full UI against an in-browser mock of the API, with the same routes, rules and error codes as `backend/src/routes.ts`. Demo data persists in localStorage and can be reset from **Settings → Reset demo data**.

| Role | Email | Password |
|------|-------|----------|
| Affiliate | affiliate@demo.ng | password1234 |
| Business (verified) | business@demo.ng | password1234 |
| Business (pending review) | chidi@demo.ng | password1234 |
| Admin | admin@demo.ng | password1234 |

Against the real backend, the admin account comes from the backend's `npm run db:seed` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`).

## Scripts

`npm run dev` · `npm run build` · `npm start` · `npm run typecheck`

## Brand / design tokens

The colours come from the Flyover roadmap document. They're defined in `tailwind.config.ts`.

| Token | Hex | Use |
|-------|-----|-----|
| `navy-700` | `#17324D` | Primary brand, headings, primary buttons, nav |
| `brick-500` | `#B13A3E` | Accent: commission figures, eyebrows, alerts |
| `mist` | `#F5F8FA` | Page background |
| `line` | `#D9E2EA` | Borders |
| `slate` | `#67798A` | Muted text |

## Project structure

```
src/
  app/
    (auth)/            login, register, forgot-password, verify-email
    (app)/             signed-in area (AppShell + RequireAuth)
      affiliate/       dashboard, onboarding, profile, links, conversions, wallet, analytics
      business/        dashboard, onboarding, profile, verification, products, campaigns(+new,[id]), conversions, analytics
      admin/           overview, businesses, campaigns, withdrawals, commissions, users, audit
      marketplace/     marketplace + campaign detail (shared, join/apply for affiliates)
      notifications/   notification centre
      settings/        account, security, PWA install
    help/ offline/ manifest.ts not-found.tsx
  components/
    ui/                Button, Input/Select/Textarea/ChipSelect/ChoiceCards, Modal/Drawer/ConfirmDialog,
                       DataTable (table on desktop, cards on mobile), StatusBadge, EmptyState, ErrorState,
                       Callout, ComingSoon, Toasts, Logo, CopyButton, Steps, ProgressBar
    layout/            AppShell (sidebar + mobile bottom nav), guards (RequireAuth, RoleGate)
    campaign/ profile/ wallet/ analytics/
  lib/
    types.ts           typed contracts mirroring prisma/schema.prisma
    api-client.ts      fetch wrapper: envelope unwrapping, Bearer auth, single-flight token refresh, ApiError
    endpoints.ts       one typed function per backend endpoint (screens never call fetch directly)
    status.ts          shared status vocabulary: label, tone and plain-English help for every status
    format.ts          money/date formatting (no float maths on money), amount parsing
    auth.tsx           session + current user context
    mock/              in-browser mock backend + demo seed
public/sw.js           service worker (app shell only; API/financial data is never cached)
docs/BACKEND_GAPS.md   endpoints the backend still needs, with the screens waiting on them
```

## Rules this frontend follows (from the backend integration guide)

- Commissions are **never calculated in the browser**. The builder's percentage example is labelled as illustrative, and all real amounts come from the server.
- Money arrives as decimal strings and is formatted without arithmetic. Withdrawal limits are compared in kobo (integers).
- Withdraw actions only appear against the **available** balance, and the NGN 5,000 minimum is enforced in the UI and by the server.
- Business verification is never assumed approved after submission; the UI waits for the admin decision.
- Only approved campaigns are shown in the marketplace. Referral links open `GET /r/:code` as a navigation URL.
- Navigation is hidden per role, but **the backend is authoritative**. Every 403 or 404 is handled as an error state.
- Admin "Mark as paid" only **records** an outside payment and a bank reference; nothing in the UI pretends to send money.
- Every consequential action has a confirmation step. Rejections require a reason.

## Acceptance run (verified against the real backend)

A Playwright run (`e2e/run.py`) drove the actual UI through the full MVP loop against the backend from the zip, on PostgreSQL 16:

signup → business onboarding and verification → admin approval → product → 4-step campaign builder → admin campaign approval → affiliate signup and onboarding → marketplace → join → referral link → 3 real `GET /r/:code` clicks (302) → business records and approves a conversion (commission ₦6,000 = 10% of ₦60,000, calculated by the server) → admin releases the commission → over-balance withdrawal blocked → ₦5,000 withdrawal → admin approves and marks it paid with a bank reference → ledger balances `{available: 1000, withdrawn: 5000, pending: 0, reversed: 0}` → role boundary check → mobile layout.

Result: **17/17 steps passed, 0 runtime errors.** A separate smoke test visited every page for every role on desktop and mobile in demo mode, with 0 errors.

## Before production

See `docs/BACKEND_GAPS.md`. The main items are the HttpOnly refresh cookie, password reset, admin commission list and an affiliate conversions/applications list. Also set real `NEXT_PUBLIC_*` values and serve over HTTPS; the PWA needs HTTPS to install.
