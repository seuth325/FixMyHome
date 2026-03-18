# FixMyHome Web App

A server-rendered marketplace MVP for homeowners who need home services and local handymen who want qualified leads.

## What is working
- Email/password authentication
- Role-based signup for homeowner or handyman
- Homeowner profile editing
- Handyman trust profile editing with insurance and license verification submission
- Job posting with category, budget, location, preferred date window, and up to 5 photo uploads
- Storage abstraction for local filesystem or S3-compatible object storage
- Handyman feed of open and in-review jobs, including attached job photos
- Handyman feed filters for search, category, budget range, photo-only jobs, sort order, and true radius-based near-me matching
- Saved searches for handymen to reopen favorite lead views
- One bid per handyman per job, with updates before award and lead-credit enforcement for new bids
- Homeowner short-listing and accepting a bid
- Job lifecycle transitions: Open, In Review, Awarded, Completed
- Threaded messages per bid plus in-app notifications for bids, awards, messages, escrow, disputes, and admin trust actions
- Escrow-style payment flow: accepted jobs create escrow, homeowners fund it through provider-backed checkout, and release after completion
- Dispute center: either side can open a payment hold while escrow is funded
- Admin moderation queue for reports, dispute resolution, account suspension, assignment, audit history, and insurance/license reviews
- Admin billing support queue with related event groups, bulk actions, scoped personal/shared playbooks, favorites, usage analytics, stale cleanup, bulk cleanup actions, archive reasons, archive actor attribution, playbook cleanup history, paginated per-playbook activity detail pages with date filters, copyable handoff summaries with TXT and JSON exports, tracked internal support cases with detail pages, search/filter views, assignment queues with SLA aging, admin notifications for case changes, ownership, notes, editable internal comments, current-answer markers, evidence attachments with notes and archive/delete controls, downloadable TXT/JSON handoff packages, and activity logs, and managed custom billing playbooks
- Handyman monetization with Free, Plus, and Pro plans plus credit-pack purchases
- Recurring Stripe Billing support for handyman plans, including hosted checkout return handling and customer portal access
- Review submission after completion with rating rollup on handyman profiles
- Product mockup at `/mockup`
- Automated smoke test for the core marketplace journey
- Automated guard test for role protections and declined-bid behavior
- Automated filter test for handyman feed search and sorting
- GitHub Actions CI for schema setup, seeding, and automated checks

## Launch planning
- Go-live checklist: [GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md)
- Production deploy checklist for your live domain: [PRODUCTION_DEPLOY_FIXMYHOME_PRO.md](./PRODUCTION_DEPLOY_FIXMYHOME_PRO.md)
- Production env template for your live domain: [.env.production.fixmyhome.pro.example](./.env.production.fixmyhome.pro.example)
- Combined launch handoff: [LAUNCH_HANDOFF_FIXMYHOME_PRO.md](./LAUNCH_HANDOFF_FIXMYHOME_PRO.md)

## Local setup
1. Confirm PostgreSQL is running locally.
2. Copy `.env.example` to `.env` and update `DATABASE_URL` if needed.
3. Generate the Prisma client and sync the schema.
4. Seed demo data if you want sample accounts.

```powershell
cd ap
npm.cmd install
npm.cmd run prisma:generate
npm.cmd run db:push
npm.cmd run seed
```

## Run
```powershell
npm.cmd start
```

Open [http://localhost:3000](http://localhost:3000).

## Production branding
For your live deployment, set:
- `APP_BASE_URL=https://fixmyhome.pro`
- `SUPPORT_EMAIL=support@fixmyhome.pro`
- `SMTP_FROM=support@fixmyhome.pro`

The app uses these values for password reset links, support contact links, and legal/footer branding.

## Ops and health
- Health checks:
  - [http://localhost:3000/health](http://localhost:3000/health)
  - [http://localhost:3000/healthz](http://localhost:3000/healthz)
- Request logging:
  - the server now logs one structured JSON line per completed request
  - each response includes an `X-Request-Id` header for easier troubleshooting
  - API/server failures include the request id in the error response when available
- Error monitoring:
  - optional Sentry wiring is now built in
  - set `SENTRY_DSN` to enable it
  - add `@sentry/node` in production before enabling the DSN
  - optional tuning: `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`

## Security and session hardening
- Sessions now use a database-backed store instead of in-memory storage.
- CSRF protection is enabled for state-changing requests by default.
- Lightweight rate limiting now protects:
  - login
  - signup
  - homeowner job posting
  - handyman bid submission
  - admin POST actions
- Production deployments should set:
  - `SESSION_SECRET`
  - `SESSION_COOKIE_NAME`
  - `SESSION_COOKIE_SECURE=true`
  - `SESSION_COOKIE_MAX_AGE_MS`
  - `TRUST_PROXY`
- Test scripts disable CSRF automatically so local automation stays stable.

## Photo storage
Default mode uses local storage:
- `STORAGE_DRIVER=local`
- files are written to `public/uploads`

S3-compatible mode is supported too:
- `STORAGE_DRIVER=s3`
- required: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- optional: `S3_REGION`, `S3_PUBLIC_BASE_URL`, `S3_UPLOAD_PREFIX`, `S3_FORCE_PATH_STYLE`

Notes:
- Homeowners can attach up to 5 images per job.
- The upload limit is 5MB per file.
- If `S3_PUBLIC_BASE_URL` is omitted, the app falls back to building a path-style URL from `S3_ENDPOINT` and `S3_BUCKET`.
- Support-case evidence attachments are now routed through an authenticated admin download path, and new local support attachments are stored outside `public`.

## Handyman filters
The handyman dashboard supports server-backed filtering for:
- text search across title, description, and location
- category
- minimum and maximum budget
- photo-only jobs
- near-me filtering based on stored geocoded coordinates and handyman service radius
- newest, budget low-to-high, and budget high-to-low sorting

Saved searches let handymen keep and reopen favorite filter combinations directly from the dashboard.

## Automated tests
Run these after seeding demo data. `test:all` now reseeds automatically first:

```powershell
npm.cmd run test:smoke
npm.cmd run test:guards
npm.cmd run test:filters
npm.cmd run test:geolocation
npm.cmd run test:monetization
npm.cmd run test:notifications
npm.cmd run test:webhooks
npm.cmd run test:checkout-config
npm.cmd run test:saved-searches
npm.cmd run test:payments
npm.cmd run test:disputes
npm.cmd run test:verification
npm.cmd run test:admin
npm.cmd run test:all
```

What they cover:
- `test:smoke`: logs in as both roles, creates a job with a real image upload, bids, messages, awards, funds escrow, completes, releases payment, and reviews.
- `test:guards`: verifies a handyman cannot post a job, a homeowner cannot bid, and accepting one bid declines the other competing bids.
- `test:filters`: verifies handyman search, category filters, budget filters, and sorting preserve the expected job set.
- `test:geolocation`: verifies jobs store coordinates, near-me uses service-radius distance checks, and tightening the radius removes farther jobs.
- `test:monetization`: verifies lead credits are consumed on first bid, zero-credit handymen are blocked, credit purchases restore access, and Pro bidding stays unlimited.
- `test:notifications`: verifies in-app notifications are created for bids, awards, messages, escrow funding, disputes, and read state updates.
- `test:webhooks`: verifies Stripe-style signed webhook delivery completes plan purchases and escrow funding, refreshes monthly credits on `invoice.paid`, and keeps subscription lifecycle state idempotent across updates, payment failures, and cancellations.
- `test:checkout-config`: verifies `/billing/plan` uses saved Stripe Price IDs for subscriptions while one-time credit packs stay on inline payment pricing.
- `test:saved-searches`: verifies near-me location matching plus saved-search create and delete flows.
- `test:payments`: verifies completion is blocked before escrow funding and reviews are blocked until payment release.
- `test:disputes`: verifies disputes hold payment, block release/completion, and can resolve to a homeowner refund.
- `test:verification`: verifies handymen can submit insurance and license details, admins can review them, and trust statuses update with notes.
- `test:admin`: verifies reports and disputes can be assigned, admins can suspend users, disputes can be resolved centrally, custom billing playbooks can be created, scoped as personal or shared, marked as favorites, tracked with usage analytics, archived/restored individually or in bulk with cleanup reasons and actor attribution, tracked through a cleanup history timeline, paginated per-playbook detail view with date filters, exported as copyable handoff summaries in TXT and JSON formats, converted into tracked support cases with detail pages, search/filter views, assignment queues with SLA aging, admin notifications for case changes, ownership, notes, editable internal comments, current-answer markers, evidence attachments with notes and archive/delete controls, downloadable TXT/JSON handoff packages, and activity logs, edited, deleted, and reused from related billing groups, and audit logs are recorded.
- `test:all`: reseeds and runs all checks in sequence, with verification coverage before admin suspension coverage.

## Location matching
Jobs and user profiles now store geocoded coordinates when the app recognizes a ZIP or city/state pair. Near-me filtering uses actual distance from the handyman's saved location and service radius, with text-based fallback only when coordinates are missing.

## Provider-backed billing
Plan upgrades, lead-credit purchases, and escrow funding now create checkout sessions and complete through provider-backed webhooks. `PAYMENT_PROVIDER=mockpay` keeps local development instant, while Stripe mode uses hosted Checkout sessions, recurring monthly plan subscriptions, customer portal redirects, optional saved Stripe Price IDs (`STRIPE_PRICE_PLUS_MONTHLY`, `STRIPE_PRICE_PRO_MONTHLY`), and real webhook signature verification when `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are configured. Portal-driven subscription changes now sync local plan and quantity state from Stripe price ids too.

## Notifications
The app now includes an in-app notification center for homeowners, handymen, and admins. It tracks new bids, award outcomes, new messages, funded escrow, disputes, verification reviews, and account status changes, with mark-read support built into the dashboard and admin area.

## Monetization
Handymen now have a Free, Plus, or Pro plan on their profile. New bids consume lead credits unless the handyman is on Pro, and the dashboard includes plan switching, recurring Stripe-backed subscriptions for paid plans, customer portal access, credit-pack purchases, and recent credit activity.

## Trust and verification
Handymen can now submit insurance and license details from the dashboard for admin review. Admins can approve or reject each submission with notes, and those statuses appear in the bid comparison experience for homeowners.

## CI
GitHub Actions workflow: [.github/workflows/ci.yml](.github/workflows/ci.yml)

It runs on pushes to `main` and `master`, plus pull requests, and will:
- start PostgreSQL 16
- install dependencies with `npm ci`
- generate the Prisma client
- push the schema
- seed demo data
- run `npm run test:all`

## Demo accounts
After `npm run seed`:
- `admin@example.com` / `password123`
- `homeowner@example.com` / `password123`
- `alex@example.com` / `password123`
- `mia@example.com` / `password123`

## Current stack
- Express + EJS
- Prisma ORM
- PostgreSQL
- bcryptjs session auth
- Multer for uploads
- AWS SDK S3 client for object storage

## Next logical milestones
- Add presigned/private object access or signed upload flows
- Add a larger offline geocoder or API-backed geocoding for broader national coverage
- Add email, SMS, or push delivery on top of the in-app notification event stream
- Add stricter document handling for verification evidence




- Admin ops now includes bulk support-case assignment and status updates from the filtered queue.
