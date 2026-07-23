# Support Agent Cron

Phase 1 processes stored `ContactSubmission` records into draft-only support cases. It never sends replies.

## Environment

Add these production environment variables in Hostinger hPanel:

```text
OPENAI_API_KEY=<existing project key>
OPENAI_SUPPORT_MODEL=gpt-5-mini
CRON_SECRET=<long random value>
```

Keep `CRON_SECRET` and `OPENAI_API_KEY` out of source control and logs.

## Hourly trigger

Configure Hostinger Cron Jobs to call the endpoint once per hour. The application checks the enabled switch, configured time zone, and two run hours before processing, so an hourly trigger produces at most two scheduled runs per local day.

```bash
curl --fail --silent --show-error \
  --header "Authorization: Bearer $CRON_SECRET" \
  https://fixmyhome.pro/api/cron/support-agent
```

If the Hostinger cron form cannot expand environment variables, store the secret in Hostinger's protected cron configuration rather than in this repository.

## Admin controls

Open `/admin/support` to:

- Pause or enable scheduled processing
- Change the time zone and two run hours
- Change the batch size
- Run the agent immediately
- Review cases, drafts, escalations, errors, and token usage

Direct email mailbox synchronization is not part of Phase 1. Website contact forms are already persisted in the database and are the initial ingestion source.
