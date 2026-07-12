# FixMyHome Hostinger Node.js Hosting Deployment

Use this path when the Hostinger SSH account is website/managed hosting access rather than a full VPS with `sudo`, Docker, and Nginx.

Known SSH details from hPanel:

```bash
ssh -p 65002 u853098024@76.13.72.203
```

## When to Use This

Use this deployment mode if SSH login shows:

- no `sudo`
- no `docker`
- no direct Nginx control
- Hostinger hPanel has pages such as **Deployments**, **Environment variables**, and **Runtime logs**

Use `deploy/hostinger-vps.md` instead if the server has Docker and sudo access.

## 1. Configure Environment Variables in hPanel

In Hostinger hPanel for `fixmyhome.pro`, open **Environment variables** and add:

```text
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://fixmyhome.pro
AUTH_URL=https://fixmyhome.pro
AUTH_TRUST_HOST=true
AUTH_SECRET=<generate with openssl rand -base64 33>
DATABASE_URL=mysql://<db_user>:<db_password>@<db_host>:3306/<db_name>
UPLOADTHING_SECRET=<uploadthing secret>
UPLOADTHING_APP_ID=<uploadthing app id>
ANTHROPIC_API_KEY=
```

For Hostinger-managed MySQL from the same hosting account, prefer `127.0.0.1` as the database host if Node.js cannot connect to the hPanel hostname or `localhost`. Node may resolve `localhost` to IPv6 `::1`, which Hostinger MySQL can reject even when the command-line MySQL client works.

If the database password contains reserved URL characters, encode them in `DATABASE_URL`; for example `@` becomes `%40`.

## 2. Connect GitHub Deployment

In hPanel for `fixmyhome.pro`, open **Deployments** and connect:

```text
Repository: seuth325/FixMyHome
Branch: main
```

Use these commands if Hostinger asks for install/build/start commands:

```bash
npm ci
npm run prisma:generate
npm run db:push
npm run build
npm run start
```

The app listens on the `PORT` value provided by Hostinger, falling back to `3000`.

## 3. If Deploying Through SSH Manually

After SSH login:

```bash
git clone https://github.com/seuth325/FixMyHome.git fixmyhome-app
cd fixmyhome-app
npm ci
npm run prisma:generate
npm run db:push
npm run build
npm run start
```

If the repository already exists:

```bash
cd fixmyhome-app
git pull --ff-only origin main
npm ci
npm run prisma:generate
npm run db:push
npm run build
npm run start
```

For a persistent production process, prefer the Hostinger hPanel app runtime/deployment settings instead of leaving `npm run start` in an SSH terminal.

When using Passenger on Hostinger managed hosting, copy `deploy/passenger-server.js` to `public_html/server.js`. It loads `.builds/config/.env`, lets that file override stale injected environment values, and starts the standalone Next.js server.

## 4. Verify

Open:

```text
https://fixmyhome.pro/api/health
```

Expected healthy response:

```json
{
  "ok": true,
  "service": "fixmyhome",
  "database": "ready"
}
```

If the response says the database is unavailable, re-check `DATABASE_URL` and run:

```bash
npm run db:push
```
