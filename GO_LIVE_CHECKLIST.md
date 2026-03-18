# FixMyHome Go-Live Checklist

This checklist is the shortest path from the current MVP to a launch-ready beta.

## Status Legend
- `Ready`: built and in good shape for beta
- `Needs work`: implemented, but needs production hardening
- `Blocker`: should be completed before public launch

## Product Core
- `Ready` Multi-role marketplace flow
  - homeowner signup/login
  - handyman signup/login
  - admin dashboard
  - job posting
  - bidding
  - shortlist/award
  - messaging
  - completion
  - reviews
- `Ready` Homeowner job management
  - edit/delete before bids
  - photo uploads
  - AI job-post helper
- `Ready` Handyman lead management
  - filters
  - saved searches
  - AI bid helper
  - billing and lead credits
- `Ready` Admin ops
  - moderation
  - disputes
  - verification
  - support cases
  - account maintenance
  - analytics filters/charts

## Authentication And Security
- `Needs work` Password reset flow
  - SMTP-ready flow exists
  - production mail delivery still needs to be configured
- `Ready` Database-backed sessions
- `Ready` CSRF protection
- `Needs work` Production cookie hardening
  - set secure cookie env values in production
  - confirm proxy / HTTPS settings on the live host
- `Needs work` Auth accessibility polish
  - focus management
  - `aria-invalid`
  - `aria-describedby`

## Payments And Billing
- `Ready` Escrow and recurring billing flows exist
- `Needs work` Stripe production configuration
  - live keys
  - live webhook endpoint
  - success/cancel URL review
  - event monitoring
- `Blocker` End-to-end production payment validation
  - verify real customer, subscription, escrow, refund, dispute paths in live mode
- `Needs work` Finance/admin reporting
  - payout/export visibility
  - subscription event audit visibility

## Notifications And Communication
- `Ready` In-app notifications
- `Needs work` Email delivery
  - password reset is SMTP-ready
  - marketplace notifications still need outbound email/SMS/push delivery if desired
- `Needs work` Notification preference strategy
  - decide what sends in-app only vs email vs SMS

## Storage And File Handling
- `Ready` Local and S3-compatible storage abstraction
- `Needs work` S3 production configuration
  - bucket policy
  - public vs private file strategy
- `Needs work` Sensitive document handling
  - admin support-case evidence now uses protected app routes
  - S3-backed sensitive files should still move to signed/private access before broad public launch
- `Needs work` Upload operations
  - cleanup policy
  - retention policy

## Infrastructure And Operations
- `Ready` Automated test suite and CI
- `Blocker` Production environment setup
  - managed Postgres
  - environment secrets
  - deployment target
  - backups
- `Blocker` Error monitoring
  - configure `SENTRY_DSN`
  - install `@sentry/node` in the production build
  - verify one captured production-side error
- `Ready` Structured request logging
- `Ready` Health check endpoints
- `Needs work` Error monitoring and uptime monitoring
- `Ready` Baseline rate limiting
  - login
  - signup
  - job posting
  - bidding
  - admin-heavy POST actions
- `Needs work` Rate limiting tuning
  - calibrate thresholds from beta usage
  - consider persistent/shared storage if multiple app instances are used

## Legal And Compliance
- `Ready` Terms of Service page
- `Ready` Privacy Policy page
- `Ready` Dispute/refund policy
- `Needs work` Verification data handling review
  - insurance/license information retention and visibility

## QA And UX Polish
- `Needs work` Final responsive QA
  - homeowner dashboard
  - handyman dashboard
  - admin dashboard
  - detail pages
- `Needs work` Final dark-mode/light-mode sweep
- `Needs work` Accessibility pass
  - keyboard navigation
  - focus styles
  - labels and semantics
- `Needs work` Copy cleanup and launch messaging

## Launch Modes

## Private Beta
Recommended minimum:
- production deploy
- production database
- secure sessions
- CSRF protection
- Stripe live config if payments are on
- SMTP for password reset
- legal pages
- monitoring

## Public Launch
Recommended minimum:
- everything in Private Beta
- private/signed document handling
- broader rate limiting
- full production payment QA
- backup/restore tested
- incident response / ops checklist

## Fastest Path To Launch
1. Harden auth and sessions
2. Configure production database, storage, and secrets
3. Finish Stripe live setup and password-reset email
4. Add monitoring/logging/health checks
5. Add legal pages
6. Run launch QA on all three roles

## Recommended Next Sprint
1. SMTP/live email configuration
2. Stripe live configuration and webhook validation
3. S3 production storage review
4. Error monitoring / uptime monitoring
5. Final launch QA on the live domain

## Launch Decision
- `Close to beta-ready`
- `Not yet ready for broad public launch without production hardening`
