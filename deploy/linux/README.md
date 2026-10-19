# Linux Server Deployment — IIC IT Helpdesk

## Architecture

```
Internet → Cloudflare edge → cloudflared → Next.js :3000 → Django :8000
                                                           ↓
                                                      Gunicorn gthread
                                                           ↓
                                                   PostgreSQL / SQLite
                                                           ↓
                                                      Redis :6379
                                                           ↓
                                             Celery worker + beat
```

## Prerequisites

| Package | Version | Notes |
|---------|---------|-------|
| Python | 3.11+ | `apt install python3.11 python3.11-venv` |
| Node.js | 20+ | Install via NodeSource or nvm |
| pnpm | latest | `npm install -g pnpm` |
| Redis | 7.x | `apt install redis-server` |
| PostgreSQL | 14+ | Recommended for production |
| cloudflared | latest | Cloudflare Tunnel daemon |

## First deploy

```bash
# 1. Create application user
sudo useradd --system --shell /bin/false --home /var/www/iic-app iicapp

# 2. Clone repo
sudo mkdir -p /var/www/iic-app
sudo git clone https://github.com/happy-kitty0821/IT-Helpdesk.git /var/www/iic-app
sudo chown -R iicapp:iicapp /var/www/iic-app

# 3. Backend setup
cd /var/www/iic-app/backend
sudo -u iicapp python3.11 -m venv venv
sudo -u iicapp venv/bin/pip install -r requirements.txt
sudo -u iicapp cp .env.example .env
sudo nano .env   # fill in DJANGO_SECRET_KEY, DJANGO_DEBUG=false, DATABASE_URL, etc.

sudo -u iicapp venv/bin/python manage.py migrate
sudo -u iicapp venv/bin/python manage.py collectstatic --noinput
sudo -u iicapp venv/bin/python manage.py bootstrap_admin --password "SecurePassword123!"
sudo -u iicapp venv/bin/python manage.py seed_rate_limits

# 4. Frontend setup
cd /var/www/iic-app/frontend
sudo -u iicapp pnpm install --frozen-lockfile
sudo -u iicapp pnpm build

# 5. Install systemd service units
sudo cp /var/www/iic-app/deploy/linux/*.service /etc/systemd/system/
sudo systemctl daemon-reload

# 6. Enable and start all services
sudo systemctl enable --now iic-helpdesk-backend
sudo systemctl enable --now iic-helpdesk-celery-worker
sudo systemctl enable --now iic-helpdesk-celery-beat
sudo systemctl enable --now iic-helpdesk-frontend
```

## Service management

```bash
# Status
sudo systemctl status iic-helpdesk-backend
sudo systemctl status iic-helpdesk-celery-worker
sudo systemctl status iic-helpdesk-celery-beat
sudo systemctl status iic-helpdesk-frontend

# Restart all
sudo systemctl restart iic-helpdesk-backend iic-helpdesk-celery-worker \
                       iic-helpdesk-celery-beat iic-helpdesk-frontend

# Logs (live tail)
sudo journalctl -u iic-helpdesk-backend -f
sudo journalctl -u iic-helpdesk-celery-worker -f
sudo journalctl -u iic-helpdesk-celery-beat -f
sudo journalctl -u iic-helpdesk-frontend -f
```

## Re-deploy after git pull

```bash
cd /var/www/iic-app
sudo -u iicapp git pull

# Backend
sudo -u iicapp venv/bin/pip install -r backend/requirements.txt
sudo -u iicapp bash -c "cd backend && venv/bin/python manage.py migrate"
sudo -u iicapp bash -c "cd backend && venv/bin/python manage.py collectstatic --noinput"
sudo systemctl restart iic-helpdesk-backend iic-helpdesk-celery-worker iic-helpdesk-celery-beat

# Frontend
sudo -u iicapp bash -c "cd frontend && pnpm install --frozen-lockfile && pnpm build"
sudo systemctl restart iic-helpdesk-frontend
```

## Cloudflare Tunnel

```bash
sudo cp /var/www/iic-app/cloudflared-config.yml /etc/cloudflared/config.yml
sudo nano /etc/cloudflared/config.yml   # add tunnel ID + credentials-file path
sudo systemctl enable --now cloudflared
```

## Service file changes made from original

| Issue | Fix |
|-------|-----|
| Celery service filenames had typo (`helpdesl`) | Renamed to `iic-helpdesk-celery-*.service` |
| `celery-beat.service` had `WantedBy=multi-user.targe` | Fixed missing `t` |
| Frontend used bare `pnpm start` without binding address | Added `--hostname 127.0.0.1 --port 3000` |
| Frontend missing `DJANGO_INTERNAL_URL` env | Added `Environment=DJANGO_INTERNAL_URL=http://127.0.0.1:8000` |
| All services missing `KillSignal` + `TimeoutStopSec` | Added graceful shutdown config |
| All services missing `SyslogIdentifier` | Added for clean journal filtering |
| All services missing `StartLimitIntervalSec`/`Burst` | Added to prevent restart loops |
