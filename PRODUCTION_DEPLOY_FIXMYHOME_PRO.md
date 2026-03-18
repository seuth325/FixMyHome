# FixMyHome Production Deploy Checklist

This is the exact cutover checklist for launching FixMyHome on `fixmyhome.pro` using `support@fixmyhome.pro`.

## 1. Domain and DNS
- Point `fixmyhome.pro` to your web host or reverse proxy.
- Add `www.fixmyhome.pro` if you want a redirect or alias.
- Confirm HTTPS is active before opening the site publicly.

## 2. Production environment variables
Set these in the production host:

```env
NODE_ENV=production
PORT=3000

APP_BASE_URL=https://fixmyhome.pro
SUPPORT_EMAIL=support@fixmyhome.pro
SENTRY_DSN=
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=fixmyhome-web
SENTRY_TRACES_SAMPLE_RATE=0.1

SESSION_SECRET=replace-with-a-long-random-secret
SESSION_COOKIE_NAME=fixmyhome.sid
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_MAX_AGE_MS=604800000
TRUST_PROXY=1

DATABASE_URL=postgresql://...

STORAGE_DRIVER=s3
S3_ENDPOINT=
S3_REGION=us-east-1
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_PUBLIC_BASE_URL=
S3_UPLOAD_PREFIX=job-photos
S3_FORCE_PATH_STYLE=true

PAYMENT_PROVIDER=stripe
PAYMENT_WEBHOOK_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PLUS_MONTHLY=
STRIPE_PRICE_PRO_MONTHLY=

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=support@fixmyhome.pro
SMTP_PASS=
SMTP_FROM=support@fixmyhome.pro
```

## 3. Database
- Create the production Postgres database.
- Run:

```powershell
npm.cmd run prisma:generate
npm.cmd run db:push
```

- Seed only if you want demo or starter data in production. Usually skip seeding for the live environment.

## 4. Email setup
- Configure SMTP for `support@fixmyhome.pro`.
- Verify password reset emails arrive from that address.
- Confirm reset links open `https://fixmyhome.pro/reset-password/...`.

## 5. Payments
- Switch `PAYMENT_PROVIDER` to `stripe`.
- Add live Stripe keys and webhook secret.
- Configure the Stripe webhook endpoint to:
  - `https://fixmyhome.pro/webhooks/payments`
- Verify:
  - plan upgrade checkout
  - credit-pack purchase
  - escrow funding
  - checkout return page
  - webhook delivery

## 6. File storage
- Use S3-compatible storage in production unless you intentionally want local disk storage.
- Confirm uploaded job photos and support attachments are reachable through the configured public base URL or storage path.
- Admin support-case evidence is now linked through protected app routes.
- If you use S3 for sensitive files, plan a follow-up move to private bucket access or presigned URLs before broader public launch.

## 7. Monitoring and health
- Confirm:
  - `https://fixmyhome.pro/health`
  - `https://fixmyhome.pro/healthz`
- Capture server logs somewhere persistent.
- Watch for `X-Request-Id` in error troubleshooting.
- Add uptime monitoring on `/health`.
- Install and enable `@sentry/node` before setting `SENTRY_DSN`.
- Verify one captured server-side exception after deployment.

## 7.1 Rate limiting
- Baseline rate limiting is already built in for login, signup, job posting, bid submission, and admin POST actions.
- During beta, watch logs and user feedback to tune thresholds if legitimate users are being throttled.

## 8. Legal and support
- Review and finalize:
  - `/terms`
  - `/privacy`
  - `/refund-policy`
- Confirm footer links appear correctly on login, signup, dashboard, admin, and mockup pages.
- Confirm support contact points to `support@fixmyhome.pro`.

## 9. Final QA
- Homeowner:
  - signup
  - login
  - forgot password
  - post job
  - AI assist
  - edit/delete before bids
  - compare bids
  - award
  - fund escrow
  - complete and review
- Handyman:
  - signup
  - login
  - browse open jobs
  - AI quote assist
  - submit bid
  - billing / credits
  - message homeowner
- Admin:
  - login
  - review analytics
  - open job detail
  - moderation and verification
  - support cases
  - account suspend/delete checks

## 10. Launch recommendation
Recommended order:
1. Deploy app with production env vars
2. Verify `/health`
3. Verify SMTP reset email
4. Verify one live Stripe workflow
5. Run full QA by role
6. Open the site publicly
