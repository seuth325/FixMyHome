# FixMyHome Web App

A server-rendered marketplace MVP for homeowners who need home services and local handymen who want qualified leads.

## What is working
- Email/password authentication
- Role-based signup for homeowner or handyman
- Homeowner profile editing
- Handyman trust profile editing
- Job posting with category, budget, location, and preferred date window
- Handyman feed of open and in-review jobs
- One bid per handyman per job, with updates before award
- Homeowner short-listing and accepting a bid
- Job lifecycle transitions: Open, In Review, Awarded, Completed
- Threaded messages per bid
- Review submission after completion with rating rollup on handyman profiles
- Product mockup at `/mockup`
- Automated smoke test for the core marketplace journey
- Automated guard test for role protections and declined-bid behavior
- GitHub Actions CI for schema setup, seeding, and automated checks

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

## Automated tests
Run these after seeding demo data:

```powershell
npm.cmd run test:smoke
npm.cmd run test:guards
npm.cmd run test:all
```

What they cover:
- `test:smoke`: logs in as both roles, creates a job, bids, messages, awards, completes, and reviews.
- `test:guards`: verifies a handyman cannot post a job, a homeowner cannot bid, and accepting one bid declines the other competing bids.
- `test:all`: runs both checks in sequence.

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
- `homeowner@example.com` / `password123`
- `alex@example.com` / `password123`
- `mia@example.com` / `password123`

## Current stack
- Express + EJS
- Prisma ORM
- PostgreSQL
- bcryptjs session auth

## Next logical milestones
- Add photo uploads for jobs
- Add search and richer job filters for handymen
- Add dispute management and payment milestones
- Add moderation/reporting workflows
- Add SMS/push notifications and license verification intake
