# FixMyHome Launch Handoff

This is the fastest practical handoff for launching FixMyHome on `fixmyhome.pro`.

Use this file together with:
- [GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md)
- [PRODUCTION_DEPLOY_FIXMYHOME_PRO.md](./PRODUCTION_DEPLOY_FIXMYHOME_PRO.md)
- [.env.production.fixmyhome.pro.example](./.env.production.fixmyhome.pro.example)

## 1. Current readiness

The application itself is in a strong state for deployment prep:
- core marketplace flows are built
- admin tooling is built
- launch hardening is in place
- full automated suite passed locally via `npm.cmd run test:all`

What remains is mostly production setup:
- infrastructure and secrets
- domain and HTTPS
- SMTP
- Stripe live configuration
- S3/object storage live configuration
- monitoring activation
- final live-domain QA

## 2. Required credentials and accounts

Before deployment, gather these values:

### App and database
- production host or platform access
- production Postgres connection string
- long random `SESSION_SECRET`

### Domain
- DNS access for `fixmyhome.pro`
- optional DNS access for `www.fixmyhome.pro`

### Email
- SMTP host
- SMTP port
- SMTP username for `support@fixmyhome.pro`
- SMTP password or app password

### Payments
- Stripe live secret key
- Stripe live webhook secret
- Stripe live monthly price IDs:
  - Plus
  - Pro

### Storage
- S3-compatible endpoint
- S3 bucket name
- S3 access key
- S3 secret key
- optional CDN/public base URL

### Monitoring
- Sentry DSN

## 3. Production env checklist

Create the production env from:
- [.env.production.fixmyhome.pro.example](./.env.production.fixmyhome.pro.example)

Confirm these values:

```env
APP_BASE_URL=https://fixmyhome.pro
SUPPORT_EMAIL=support@fixmyhome.pro
SMTP_FROM=support@fixmyhome.pro
NODE_ENV=production
SESSION_COOKIE_SECURE=true
TRUST_PROXY=1
PAYMENT_PROVIDER=stripe
STORAGE_DRIVER=s3
```

Still needs real secrets filled in:
- `DATABASE_URL`
- `SESSION_SECRET`
- `SMTP_*`
- `STRIPE_*`
- `S3_*`
- `SENTRY_DSN`

## 4. Deployment order

### Phase 1: Infrastructure
1. Create the production database.
2. Set production env vars on the host.
3. Deploy the app.
4. Run:

```powershell
npm.cmd run prisma:generate
npm.cmd run db:push
```

5. Verify:
   - `/health`
   - `/healthz`

### Phase 2: Domain and HTTPS
1. Point `fixmyhome.pro` to the host.
2. Enable HTTPS.
3. Confirm `APP_BASE_URL=https://fixmyhome.pro`.
4. Verify secure cookies work behind the proxy.

### Phase 3: Email
1. Configure SMTP for `support@fixmyhome.pro`.
2. Submit forgot-password.
3. Confirm the reset email arrives.
4. Confirm the reset link opens the live domain.

### Phase 4: Payments
1. Switch Stripe values to live.
2. Configure webhook:
   - `https://fixmyhome.pro/webhooks/payments`
3. Verify:
   - plan checkout
   - credit-pack purchase
   - escrow funding
   - webhook delivery
   - checkout return page

### Phase 5: Storage
1. Configure S3/object storage.
2. Upload a homeowner job photo.
3. Open a support-case attachment as admin.
4. Confirm protected attachment routes still work.

### Phase 6: Monitoring
1. Enable Sentry DSN.
2. Install `@sentry/node` in the production build if not already included.
3. Trigger one controlled server-side error.
4. Confirm it reaches monitoring with a request ID.

## 5. Post-deploy QA

### Homeowner
- sign up
- log in
- forgot password
- post a job
- use AI job assistant
- upload photos
- edit/delete before bids
- receive bids
- compare bids
- shortlist
- award
- fund escrow
- complete job
- leave review

### Handyman
- sign up
- log in
- browse open jobs
- use AI quote helper
- submit bid
- send message
- view billing and credits
- upgrade plan or buy credits

### Admin
- log in
- open analytics dashboard
- use category and status filters
- open job detail
- review verification queue
- open billing support queue
- open support cases
- suspend/delete checks on users

## 6. Go / no-go rules

### Go if all are true
- production app boots cleanly
- `/health` and `/healthz` return healthy
- forgot-password email works
- one Stripe live flow works
- one S3 upload works
- one Sentry event is captured
- homeowner, handyman, and admin QA passes

### No-go if any are true
- password reset does not send
- Stripe webhooks fail
- uploads fail
- secure cookies break login on live domain
- health endpoint fails
- server errors are not observable

## 7. Recommended immediate next move

Do these first:
1. fill the production env
2. deploy with database connectivity
3. verify `/health`
4. configure SMTP

That gets the app into a live-ready posture fastest.
