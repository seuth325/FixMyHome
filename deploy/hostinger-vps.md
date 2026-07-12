# FixMyHome Hostinger VPS Deployment

Target:

- Domain: `fixmyhome.pro`
- GitHub repository: `seuth325/FixMyHome`
- Runtime: Docker Compose, Next.js standalone server, MySQL
- Reverse proxy: Nginx on the VPS

## 1. Prepare GitHub

Create the GitHub repository as `seuth325/FixMyHome`.

From this project folder, set the remote after the repo exists:

```bash
git remote set-url origin https://github.com/seuth325/FixMyHome.git
git push -u origin main
```

If the repository is private, make sure the VPS can pull it. The cleanest path is to add a deploy key to the GitHub repo and install the matching private key on the VPS.

## 2. Prepare the VPS

Install base packages:

```bash
sudo apt update
sudo apt install -y git nginx certbot python3-certbot-nginx ca-certificates curl
```

Install Docker Engine using Docker's official instructions for your Ubuntu/Debian version, then enable it:

```bash
sudo systemctl enable docker
sudo systemctl start docker
```

Add your SSH user to the Docker group, then log out and back in:

```bash
sudo usermod -aG docker $USER
```

## 3. Clone the App

```bash
sudo mkdir -p /opt/fixmyhome
sudo chown -R $USER:$USER /opt/fixmyhome
git clone https://github.com/seuth325/FixMyHome.git /opt/fixmyhome
cd /opt/fixmyhome
```

Create the production env file:

```bash
cp deploy/production.env.example .env
nano .env
```

For the containerized MySQL setup, keep `DATABASE_URL` pointed at `db`:

```text
DATABASE_URL="mysql://fixmyhome:YOUR_PASSWORD@db:3306/fixmyhome"
```

For a Hostinger-managed MySQL database, use the host, database, user, and password from hPanel instead.

Generate `AUTH_SECRET`:

```bash
openssl rand -base64 33
```

## 4. Start the App

```bash
docker compose up -d --build db
docker compose run --rm migrate
docker compose up -d --build app
docker compose ps
```

Check the health endpoint:

```bash
curl http://127.0.0.1:3000/api/health
```

## 5. Configure Nginx

```bash
sudo cp deploy/nginx/fixmyhome.conf /etc/nginx/sites-available/fixmyhome
sudo ln -s /etc/nginx/sites-available/fixmyhome /etc/nginx/sites-enabled/fixmyhome
sudo nginx -t
sudo systemctl reload nginx
```

Issue the TLS certificate:

```bash
sudo certbot --nginx -d fixmyhome.pro -d www.fixmyhome.pro
```

## 6. GitHub Actions Deployment

The workflow in `.github/workflows/deploy-hostinger.yml` deploys after pushes to `main`.

Add these repository secrets in GitHub:

- `HOSTINGER_SSH_HOST`: VPS IP or hostname
- `HOSTINGER_SSH_USER`: SSH user
- `HOSTINGER_SSH_KEY`: private SSH key that can log into the VPS
- `HOSTINGER_SSH_PORT`: usually `22`
- `HOSTINGER_DEPLOY_PATH`: usually `/opt/fixmyhome`

The VPS must already have Docker, Nginx, the repository clone, and `.env` configured before the first Actions deploy.

## 7. Manual Redeploy

When you want to deploy manually on the VPS:

```bash
cd /opt/fixmyhome
git pull --ff-only origin main
docker compose build app migrate
docker compose run --rm migrate
docker compose up -d app
docker compose ps
curl http://127.0.0.1:3000/api/health
```
