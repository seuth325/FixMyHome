# Marketplace Operations Agent

Phase 1 is a deterministic, read-only marketplace monitor. It detects operational risks and creates evidence-backed recommendations for administrator review. It cannot message users, change jobs, award work, suspend accounts, or spend money.

## Signals

- Open jobs with no bids
- Open jobs with fewer than three bids
- Stale open jobs
- Awarded jobs with no recent marketplace activity
- Completed jobs without reviews
- New handymen who have not submitted a bid
- Previously active handymen who have become inactive
- Locations with multiple no-bid jobs

## Schedule

The existing hourly GitHub Actions workflow runs `deploy/marketplace-operations-runner.mjs` over SSH. The application performs analysis only once per configured local day. Default: 7:00 AM America/New_York.

## Controls

Open `/admin/operations` to run the agent, pause scheduling, change thresholds, review evidence, acknowledge signals, and mark work resolved or dismissed.