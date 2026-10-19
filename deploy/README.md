# Deployment — IIC IT Helpdesk

This folder contains all server deployment configuration. Choose the method that matches your infrastructure.

## Deployment options

| Method | Folder / File | Best for |
|--------|--------------|---------|
| **Linux (systemd)** | `linux/` | Production LXC/VM, bare-metal server |
| **Windows (NSSM)** | `windows/` | Windows Server, dev/test on Windows |
| **Docker** | `../docker-compose.yml` | Any platform, quick setup, isolated environments |

---

## Linux (systemd) — `deploy/linux/`

Four systemd service units for Gunicorn, Celery worker, Celery beat, and Next.js.

```bash
sudo cp deploy/linux/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now iic-helpdesk-backend iic-helpdesk-celery-worker \
                             iic-helpdesk-celery-beat iic-helpdesk-frontend
```

See **`linux/README.md`** for the full step-by-step install guide.

---

## Windows (NSSM) — `deploy/windows/`

A PowerShell script that installs four Windows Services via NSSM.

```powershell
# Run as Administrator
.\deploy\windows\windows-deploy.ps1
```

See **`windows/README.md`** for prerequisites, service management, and troubleshooting.

---

## Docker — `docker-compose.yml`

Six-container stack (PostgreSQL, Redis, backend, celery-worker, celery-beat, frontend).

```bash
cp backend/.env.example backend/.env   # fill in values
docker compose up --build
```

See the root **`README.md`** (§Quick start) for the first-run migration steps.

---

## Request flow (all deployment methods)

```
Internet → Cloudflare edge (TLS) → cloudflared tunnel
                                          ↓
                               Next.js :3000  (public-facing)
                                          ↓
                               Django/Gunicorn :8000  (internal)
                                     ↓           ↓
                               PostgreSQL      Redis :6379
                                                   ↓
                                       Celery worker + beat
```

## Cloudflare Tunnel config

```bash
sudo cp cloudflared-config.yml /etc/cloudflared/config.yml
# Edit: replace <YOUR_TUNNEL_ID> with your tunnel UUID
sudo systemctl restart cloudflared
```

The critical setting is `noChunkedEncoding: false` — this keeps chunked file
uploads streaming end-to-end without buffering at the tunnel edge.
