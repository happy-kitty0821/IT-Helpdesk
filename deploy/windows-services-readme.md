# Windows Deployment — IIC IT Helpdesk

## Architecture on Windows

```
Browser → Cloudflare edge → cloudflared → Next.js :3000 → Django :8000
                                                          ↓
                                                     waitress (WSGI)
                                                          ↓
                                                    Redis :6379
                                                          ↓
                                              Celery worker + beat
```

**Why waitress instead of gunicorn?**
Gunicorn does not support Windows. Waitress is the recommended production WSGI server for Django on Windows — it is pure Python, handles concurrent requests via threads, and works reliably as a Windows Service.

---

## Prerequisites

| Tool | Version | Where to get it |
|------|---------|-----------------|
| Python | 3.11+ | https://python.org |
| Node.js | 20+ | https://nodejs.org |
| pnpm | latest | `npm install -g pnpm` |
| Redis for Windows | 5.x+ | https://github.com/tporadowski/redis/releases |
| NSSM | 2.24+ | https://nssm.cc/download |

**NSSM setup:**
1. Download `nssm-2.24.zip`
2. Extract to `C:\tools\nssm\`
3. Add `C:\tools\nssm\win64\` to the system `PATH`
4. Verify: `nssm version`

---

## First Deploy

```powershell
# 1. Clone the repo
git clone https://github.com/your-org/iic-helpdesk.git C:\iic-helpdesk
Set-Location C:\iic-helpdesk

# 2. Copy and fill in environment variables
Copy-Item backend\.env.example backend\.env
notepad backend\.env

# 3. Run the deploy script (as Administrator)
.\deploy\windows-deploy.ps1
```

---

## Re-deploy after a git pull

```powershell
Set-Location C:\iic-helpdesk
git pull
.\deploy\windows-deploy.ps1
```

**Faster re-deploy if only backend changed** (skip frontend build):
```powershell
.\deploy\windows-deploy.ps1 -SkipBuild
```

**Skip tests** (not recommended for production):
```powershell
.\deploy\windows-deploy.ps1 -SkipTests
```

---

## Services registered

| Service name | Description | Port |
|---|---|---|
| `iic-helpdesk-backend` | Django via waitress | 8000 |
| `iic-helpdesk-celery-worker` | Celery task worker | — |
| `iic-helpdesk-celery-beat` | Celery beat scheduler | — |
| `iic-helpdesk-frontend` | Next.js production | 3000 |

All four services are set to **auto-start** and **restart on failure**.

---

## Common commands

```powershell
# View all service statuses
Get-Service iic-helpdesk-*

# Restart a single service
Restart-Service iic-helpdesk-backend

# View logs (NSSM writes stdout/stderr to files)
Get-Content logs\backend-stdout.log -Tail 50
Get-Content logs\celery-worker.log  -Tail 50
Get-Content logs\frontend-stdout.log -Tail 50

# Stop all services
Stop-Service iic-helpdesk-*

# Uninstall all services
.\deploy\windows-deploy.ps1 -Uninstall
```

---

## Environment variables

All backend services inherit variables from `backend\.env` automatically.
NSSM loads the file at service start via `AppEnvironmentExtra`.

Key variables to set in `backend\.env`:

```env
DJANGO_SECRET_KEY=<long-random-value>
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,yourdomain.com
DATABASE_URL=postgres://user:pass@localhost:5432/helpdesk_db
REDIS_URL=redis://127.0.0.1:6379/0
HELPDESK_URL=https://yourdomain.com
```

---

## Differences from the Linux/Jenkins deploy

| Aspect | Linux (Jenkinsfile) | Windows (windows-deploy.ps1) |
|---|---|---|
| WSGI server | gunicorn (gthread) | waitress (threaded) |
| Service manager | systemd | NSSM |
| Deploy trigger | Jenkins CI | Manual PowerShell |
| Log location | systemd journal | `logs\*.log` files |
| Static files | `/var/www/iic-app/backend/staticfiles/` | `backend\staticfiles\` |
| Media files | `/var/www/iic-app/backend/media/` | `backend\media\` |

---

## Troubleshooting

**Service won't start — check logs:**
```powershell
Get-Content logs\backend-stdout.log -Tail 100
Get-Content logs\backend-stderr.log -Tail 100
```

**Port already in use:**
```powershell
netstat -ano | findstr :8000
# Find the PID and kill it:
Stop-Process -Id <PID> -Force
```

**Django migration errors:**
```powershell
Set-Location backend
..\venv\Scripts\python.exe manage.py showmigrations
..\venv\Scripts\python.exe manage.py migrate --verbosity=2
```

**Celery can't connect to Redis:**
- Verify Redis is running: `redis-cli ping` (should return `PONG`)
- Check `REDIS_URL` in `backend\.env`
- Memurai (Redis-compatible for Windows) is a good alternative to the unofficial Redis port
