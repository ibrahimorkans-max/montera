# Monetra — Invoice. Track. Grow.

Mobile invoicing, client management, payment tracking and business finance. (The project folder keeps its original name, `millnexa`.)

```
apps/api         Node + Express + SQLite API (auth, tenant isolation, invoices, payments, receipts, ledger)
apps/mobile      Expo (React Native) app for Android, iOS and tablets
packages/shared  Decimal-safe money maths and types, used by both the API and the app
```

## Run it

```bash
cd apps/api
npm install
npm run seed     # optional demo data; the demo sign-in is in apps/api/src/seed.ts
npm start        # http://localhost:4000
```

```bash
cd apps/mobile
npm install
npm run web      # browser preview at http://localhost:8081
npx expo start   # scan the QR code with Expo Go on a phone
```

On a phone the app cannot reach `localhost`. Start it with your computer's LAN address:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.10:4000 npx expo start
```

Set `JWT_SECRET` (32+ random characters) before deploying the API. Without it a temporary secret is generated on each start.

## Checks

```bash
cd apps/api && npm test && npm run typecheck
cd apps/mobile && npx tsc --noEmit
```

## How money is handled

- Every amount is an integer number of minor units (paisa); quantities are thousandths, percentages are basis points. No floating point touches a financial value.
- The app shows a live total with the same `computeInvoice` function the server uses, and the server recalculates everything before saving.
- `Remaining balance = invoice total − allocations of payments that are not rejected`.
- A payment is never allocated beyond an invoice's balance. Any excess stays on the payment as client advance and can be applied to a later invoice.
- Invoice numbers are assigned per business when an invoice is finalized. Final invoices cannot be edited, only cancelled.
- Invoices and payments accept a device-generated `clientRequestId`; repeating a request returns the record already saved instead of creating a duplicate.

## Deploying

See [DEPLOY.md](DEPLOY.md). On an Ubuntu VPS: clone this repository, then `bash deploy/setup.sh monetra.zhtrader.com`.

## Built so far

- Invoicing: dashboard (four selectable styles per business), clients with credit limits, business profiles, services, 5-step invoice builder, four invoice templates, preview, drawn signature, PDF/PNG/JPG export, receipts, installments, client ledger and statements.
- Quotations (convert to invoice), recurring invoices, detailed reports with PDF and Excel export.
- Finance: cash, bank and wallet accounts, transfers, refunds, daily cashbook, profit & loss, cash flow, multi-currency with exchange rates, financial-year numbering, multi-invoice payment allocation.
- Offline-first: every screen works without internet from a local SQLite copy; changes sync when back online, with conflict handling.
- Security: roles and permissions, device sessions, audit log, PIN / fingerprint / password app lock.

## Next

AI features with a choice of providers (OpenRouter, OpenAI, Claude and others): scanning, voice invoices, assistant, forecasts and alerts.
