# =============================================================================
# windows-deploy.ps1 — IIC IT Helpdesk  Windows deployment script
# =============================================================================
#
# WHAT THIS SCRIPT DOES
# ─────────────────────
# 1. Validates prerequisites (Python, Node, pnpm, Redis, NSSM)
# 2. Installs / upgrades backend Python dependencies (pip)
# 3. Runs Django system check + database migrations + collectstatic
# 4. Installs / upgrades frontend dependencies and builds Next.js
# 5. Registers four Windows Services via NSSM (if not already registered):
#      iic-helpdesk-backend        — waitress (Django WSGI server)
#      iic-helpdesk-celery-worker  — Celery task worker
#      iic-helpdesk-celery-beat    — Celery beat scheduler
#      iic-helpdesk-frontend       — Next.js production server
# 6. Restarts all four services in the correct order
# 7. Runs health checks (backend /health/ + frontend /)
#
# PREREQUISITES
# ─────────────
# • Run PowerShell as Administrator
# • Python 3.11+ installed and on PATH (or set $PythonExe below)
# • Node.js 20+ and pnpm installed
# • Redis for Windows running (Memurai, WSL2 Redis, or native port)
#   https://github.com/tporadowski/redis/releases
# • NSSM (Non-Sucking Service Manager) installed
#   https://nssm.cc/download  — place nssm.exe somewhere on PATH, e.g.
#   C:\tools\nssm\win64\nssm.exe and add that folder to the system PATH
# • waitress installed (added to requirements.txt automatically below)
# • A .env file present at $AppDir\backend\.env
#   Copy backend\.env.example → backend\.env and fill in your values
#
# USAGE
# ─────
# First deploy (from the repo root):
#   Set-Location "C:\iic-helpdesk"
#   .\deploy\windows-deploy.ps1
#
# Re-deploy after a git pull:
#   .\deploy\windows-deploy.ps1
#
# Uninstall all services (run as Administrator):
#   .\deploy\windows-deploy.ps1 -Uninstall
#
# =============================================================================

[CmdletBinding()]
param(
    [switch]$Uninstall,          # Remove all four services and exit
    [switch]$SkipBuild,          # Skip frontend build (faster re-deploy if only backend changed)
    [switch]$SkipTests,          # Skip Django test run
    [string]$AppDir = (Split-Path -Parent $PSScriptRoot)  # Repo root (one level above deploy\)
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Paths ─────────────────────────────────────────────────────────────────────

$BackendDir     = Join-Path $AppDir  "backend"
$FrontendDir    = Join-Path $AppDir  "frontend"
$VenvDir        = Join-Path $BackendDir "venv"
$PythonExe      = Join-Path $VenvDir "Scripts\python.exe"
$PipExe         = Join-Path $VenvDir "Scripts\pip.exe"
$WaitressExe    = Join-Path $VenvDir "Scripts\waitress-serve.exe"
$CeleryExe      = Join-Path $VenvDir "Scripts\celery.exe"
$EnvFile        = Join-Path $BackendDir ".env"
$LogDir         = Join-Path $AppDir  "logs"

# ── Service definitions ───────────────────────────────────────────────────────

$Services = @(
    @{
        Name        = "iic-helpdesk-backend"
        DisplayName = "IIC IT Helpdesk — Django Backend (waitress)"
        Description = "Django WSGI application served by waitress on 127.0.0.1:8000"
        Executable  = $WaitressExe
        Arguments   = "--host=127.0.0.1 --port=8000 --threads=8 Project.wsgi:application"
        WorkDir     = $BackendDir
        StdoutLog   = Join-Path $LogDir "backend-stdout.log"
        StderrLog   = Join-Path $LogDir "backend-stderr.log"
    },
    @{
        Name        = "iic-helpdesk-celery-worker"
        DisplayName = "IIC IT Helpdesk — Celery Worker"
        Description = "Celery task worker for background jobs (scans, emails, SLA checks)"
        Executable  = $CeleryExe
        Arguments   = "-A Project worker --loglevel=info --concurrency=2 --logfile=`"$(Join-Path $LogDir 'celery-worker.log')`""
        WorkDir     = $BackendDir
        StdoutLog   = Join-Path $LogDir "celery-worker-stdout.log"
        StderrLog   = Join-Path $LogDir "celery-worker-stderr.log"
    },
    @{
        Name        = "iic-helpdesk-celery-beat"
        DisplayName = "IIC IT Helpdesk — Celery Beat Scheduler"
        Description = "Celery beat: fires periodic tasks (SLA alerts, auto-close, outbox delivery)"
        Executable  = $CeleryExe
        Arguments   = "-A Project beat --loglevel=info --logfile=`"$(Join-Path $LogDir 'celery-beat.log')`""
        WorkDir     = $BackendDir
        StdoutLog   = Join-Path $LogDir "celery-beat-stdout.log"
        StderrLog   = Join-Path $LogDir "celery-beat-stderr.log"
    },
    @{
        Name        = "iic-helpdesk-frontend"
        DisplayName = "IIC IT Helpdesk — Next.js Frontend"
        Description = "Next.js production server on 127.0.0.1:3000"
        Executable  = (Get-Command "node.exe" -ErrorAction SilentlyContinue)?.Source ?? "node.exe"
        Arguments   = "node_modules\.bin\next start --hostname 127.0.0.1 --port 3000"
        WorkDir     = $FrontendDir
        StdoutLog   = Join-Path $LogDir "frontend-stdout.log"
        StderrLog   = Join-Path $LogDir "frontend-stderr.log"
    }
)

# ── Helpers ───────────────────────────────────────────────────────────────────

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "── $Message" -ForegroundColor Cyan
}

function Write-OK([string]$Message) {
    Write-Host "   ✓ $Message" -ForegroundColor Green
}

function Write-Fail([string]$Message) {
    Write-Host "   ✗ $Message" -ForegroundColor Red
}

function Assert-Admin {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Fail "This script must be run as Administrator."
        Write-Host "   Right-click PowerShell → 'Run as administrator', then re-run." -ForegroundColor Yellow
        exit 1
    }
}

function Assert-Command([string]$Name, [string]$InstallHint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Fail "$Name not found on PATH."
        Write-Host "   $InstallHint" -ForegroundColor Yellow
        exit 1
    }
    Write-OK "$Name found"
}

function Invoke-Step([string]$Label, [scriptblock]$Action) {
    Write-Step $Label
    try {
        & $Action
    } catch {
        Write-Fail $_.Exception.Message
        exit 1
    }
}

function Stop-ServiceSafe([string]$Name) {
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq "Running") {
        Write-Host "   Stopping $Name..." -ForegroundColor DarkGray
        Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
}

function Register-NssmService([hashtable]$Svc) {
    $name = $Svc.Name
    $existing = Get-Service -Name $name -ErrorAction SilentlyContinue

    if ($existing) {
        Write-Host "   $name already registered — updating..." -ForegroundColor DarkGray
        Stop-ServiceSafe $name
        & nssm set $name Application      $Svc.Executable    | Out-Null
        & nssm set $name AppParameters    $Svc.Arguments     | Out-Null
        & nssm set $name AppDirectory     $Svc.WorkDir       | Out-Null
    } else {
        Write-Host "   Registering $name..." -ForegroundColor DarkGray
        & nssm install $name $Svc.Executable $Svc.Arguments  | Out-Null
        & nssm set     $name AppDirectory    $Svc.WorkDir     | Out-Null
    }

    # Common service settings
    & nssm set $name DisplayName          $Svc.DisplayName   | Out-Null
    & nssm set $name Description          $Svc.Description   | Out-Null
    & nssm set $name Start                SERVICE_AUTO_START  | Out-Null
    & nssm set $name AppStdout            $Svc.StdoutLog      | Out-Null
    & nssm set $name AppStderr            $Svc.StderrLog      | Out-Null
    & nssm set $name AppStdoutCreationDisposition OPEN_ALWAYS | Out-Null
    & nssm set $name AppStderrCreationDisposition OPEN_ALWAYS | Out-Null
    & nssm set $name AppRotateFiles       1                   | Out-Null
    & nssm set $name AppRotateSeconds     86400               | Out-Null   # rotate daily
    & nssm set $name AppRotateBytes       10485760            | Out-Null   # rotate at 10 MB
    & nssm set $name AppRestartDelay      5000                | Out-Null   # 5 s between restarts

    # Load .env file as environment variables for backend services
    if ($name -like "iic-helpdesk-backend" -or $name -like "iic-helpdesk-celery*") {
        if (Test-Path $EnvFile) {
            # Read .env and build a semicolon-separated KEY=VALUE string for NSSM
            $envVars = Get-Content $EnvFile |
                Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*=' -and $_ -notmatch '^\s*#' } |
                ForEach-Object { $_.Trim() }
            if ($envVars.Count -gt 0) {
                $envString = $envVars -join "`n"
                & nssm set $name AppEnvironmentExtra $envString | Out-Null
            }
        }
    }

    Write-OK "$name registered"
}

# ── Uninstall mode ────────────────────────────────────────────────────────────

if ($Uninstall) {
    Assert-Admin
    Write-Host ""
    Write-Host "Uninstalling IIC IT Helpdesk Windows services..." -ForegroundColor Yellow
    foreach ($svc in $Services) {
        $name = $svc.Name
        $existing = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($existing) {
            Stop-ServiceSafe $name
            & nssm remove $name confirm | Out-Null
            Write-OK "Removed: $name"
        } else {
            Write-Host "   $name not installed — skipping" -ForegroundColor DarkGray
        }
    }
    Write-Host ""
    Write-Host "All services removed." -ForegroundColor Green
    exit 0
}

# ─────────────────────────────────────────────────────────────────────────────
# DEPLOY
# ─────────────────────────────────────────────────────────────────────────────

Assert-Admin

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "║         IIC IT Helpdesk — Windows Deployment                ║" -ForegroundColor Blue
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Blue
Write-Host "  App directory : $AppDir"
Write-Host "  Backend       : $BackendDir"
Write-Host "  Frontend      : $FrontendDir"

# ── 0. Prerequisites ──────────────────────────────────────────────────────────

Invoke-Step "Checking prerequisites" {
    Assert-Command "nssm"  "Download from https://nssm.cc/download and add to PATH"
    Assert-Command "node"  "Download from https://nodejs.org/"
    Assert-Command "pnpm"  "Run: npm install -g pnpm"

    # Check Redis
    try {
        $ping = & redis-cli ping 2>&1
        if ($ping -match "PONG") {
            Write-OK "Redis is running"
        } else {
            Write-Fail "Redis ping returned: $ping"
            Write-Host "   Install Redis for Windows: https://github.com/tporadowski/redis/releases" -ForegroundColor Yellow
            exit 1
        }
    } catch {
        Write-Fail "redis-cli not found or Redis not running."
        Write-Host "   Install Redis for Windows: https://github.com/tporadowski/redis/releases" -ForegroundColor Yellow
        exit 1
    }

    # Check .env file
    if (-not (Test-Path $EnvFile)) {
        Write-Fail ".env file not found at $EnvFile"
        Write-Host "   Copy backend\.env.example to backend\.env and fill in your values." -ForegroundColor Yellow
        exit 1
    }
    Write-OK ".env file found"

    # Check venv
    if (-not (Test-Path $PythonExe)) {
        Write-Host "   Virtual environment not found — creating..." -ForegroundColor DarkGray
        $sysPython = (Get-Command "python" -ErrorAction Stop).Source
        & $sysPython -m venv $VenvDir
        Write-OK "Virtual environment created"
    } else {
        Write-OK "Virtual environment found"
    }

    # Create log directory
    if (-not (Test-Path $LogDir)) {
        New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
        Write-OK "Log directory created: $LogDir"
    } else {
        Write-OK "Log directory: $LogDir"
    }
}

# ── 1. Backend dependencies ───────────────────────────────────────────────────

Invoke-Step "Installing backend Python dependencies" {
    & $PipExe install --upgrade pip --quiet
    & $PipExe install -r (Join-Path $BackendDir "requirements.txt")
    # Ensure waitress is installed (Windows WSGI server — replaces gunicorn)
    & $PipExe install "waitress==3.0.2"
    Write-OK "Backend dependencies installed"
}

# ── 2. Django validation ──────────────────────────────────────────────────────

Invoke-Step "Running Django system check" {
    Push-Location $BackendDir
    try {
        & $PythonExe manage.py check
        Write-OK "Django system check passed"
    } finally {
        Pop-Location
    }
}

# ── 3. Django tests ───────────────────────────────────────────────────────────

if (-not $SkipTests) {
    Invoke-Step "Running Django tests" {
        Push-Location $BackendDir
        try {
            & $PythonExe manage.py test --verbosity=1
            Write-OK "Django tests passed"
        } finally {
            Pop-Location
        }
    }
}

# ── 4. Database migration ─────────────────────────────────────────────────────

Invoke-Step "Running database migrations" {
    Push-Location $BackendDir
    try {
        & $PythonExe manage.py migrate --noinput
        Write-OK "Migrations applied"
    } finally {
        Pop-Location
    }
}

# ── 5. Collect static files ───────────────────────────────────────────────────

Invoke-Step "Collecting static files" {
    Push-Location $BackendDir
    try {
        & $PythonExe manage.py collectstatic --noinput
        Write-OK "Static files collected"
    } finally {
        Pop-Location
    }
}

# ── 6. Bootstrap admin user ───────────────────────────────────────────────────

Invoke-Step "Bootstrapping admin user (if not yet created)" {
    Push-Location $BackendDir
    try {
        & $PythonExe manage.py bootstrap_admin
        Write-OK "Admin bootstrap complete"
    } finally {
        Pop-Location
    }
}

# ── 7. Frontend build ─────────────────────────────────────────────────────────

if (-not $SkipBuild) {
    Invoke-Step "Installing frontend dependencies" {
        Push-Location $FrontendDir
        try {
            & pnpm install --frozen-lockfile
            Write-OK "Frontend dependencies installed"
        } finally {
            Pop-Location
        }
    }

    Invoke-Step "Building Next.js frontend" {
        Push-Location $FrontendDir
        try {
            & pnpm build
            Write-OK "Frontend build completed"
        } finally {
            Pop-Location
        }
    }
} else {
    Write-Host ""
    Write-Host "── Frontend build skipped (-SkipBuild)" -ForegroundColor DarkGray
}

# ── 8. Stop existing services before re-registering ──────────────────────────

Invoke-Step "Stopping existing services" {
    foreach ($svc in $Services) {
        Stop-ServiceSafe $svc.Name
    }
    Write-OK "All services stopped"
}

# ── 9. Register / update Windows services via NSSM ───────────────────────────

Invoke-Step "Registering Windows services via NSSM" {
    foreach ($svc in $Services) {
        Register-NssmService $svc
    }
}

# ── 10. Start services in dependency order ────────────────────────────────────

Invoke-Step "Starting services" {
    # Backend must start first (migrations already done above)
    $startOrder = @(
        "iic-helpdesk-backend",
        "iic-helpdesk-celery-worker",
        "iic-helpdesk-celery-beat",
        "iic-helpdesk-frontend"
    )

    foreach ($name in $startOrder) {
        Write-Host "   Starting $name..." -ForegroundColor DarkGray
        Start-Service -Name $name
        Start-Sleep -Seconds 2
        $svc = Get-Service -Name $name
        if ($svc.Status -eq "Running") {
            Write-OK "$name is running"
        } else {
            Write-Fail "$name failed to start. Check: $LogDir"
            exit 1
        }
    }
}

# ── 11. Health checks ─────────────────────────────────────────────────────────

Invoke-Step "Running health checks" {
    # Backend
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/v1/health/" `
            -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
            Write-OK "Backend health check passed (HTTP 200)"
        } else {
            Write-Fail "Backend returned HTTP $($resp.StatusCode)"
            exit 1
        }
    } catch {
        Write-Fail "Backend health check failed: $($_.Exception.Message)"
        exit 1
    }

    # Redis
    try {
        $ping = & redis-cli ping 2>&1
        if ($ping -match "PONG") {
            Write-OK "Redis health check passed"
        } else {
            Write-Fail "Redis health check failed: $ping"
        }
    } catch {
        Write-Fail "Redis health check failed: $($_.Exception.Message)"
    }

    # Frontend (retry up to 10 times — Next.js takes a few seconds to warm up)
    $frontendOk = $false
    for ($i = 1; $i -le 10; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:3000/" `
                -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            if ($resp.StatusCode -lt 500) {
                Write-OK "Frontend health check passed (HTTP $($resp.StatusCode))"
                $frontendOk = $true
                break
            }
        } catch { }
        Write-Host "   Frontend not ready yet. Attempt $i/10..." -ForegroundColor DarkGray
        Start-Sleep -Seconds 3
    }
    if (-not $frontendOk) {
        Write-Fail "Frontend health check failed after 10 attempts."
        exit 1
    }
}

# ── Done ──────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║   IIC IT Helpdesk deployment completed successfully!        ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Services registered and running:" -ForegroundColor White
foreach ($svc in $Services) {
    Write-Host "    • $($svc.Name)" -ForegroundColor White
}
Write-Host ""
Write-Host "  Log files: $LogDir" -ForegroundColor White
Write-Host "  Backend  : http://127.0.0.1:8000" -ForegroundColor White
Write-Host "  Frontend : http://127.0.0.1:3000" -ForegroundColor White
Write-Host ""
Write-Host "  To view service status:" -ForegroundColor DarkGray
Write-Host "    Get-Service iic-helpdesk-*" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  To uninstall all services:" -ForegroundColor DarkGray
Write-Host "    .\deploy\windows-deploy.ps1 -Uninstall" -ForegroundColor DarkGray
Write-Host ""
