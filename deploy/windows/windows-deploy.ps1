#Requires -Version 5.1
# =============================================================================
# windows-deploy.ps1 — IIC IT Helpdesk  Windows deployment script
# Compatible with Windows PowerShell 5.1 and PowerShell 7+
# =============================================================================
#
# USAGE
# ─────
#   # First deploy or re-deploy (repo root, as Administrator):
#   .\deploy\windows-deploy.ps1
#
#   # Backend-only re-deploy (skip frontend build):
#   .\deploy\windows-deploy.ps1 -SkipBuild
#
#   # Skip test run:
#   .\deploy\windows-deploy.ps1 -SkipTests
#
#   # Remove all four Windows Services (preserves data, .env, logs):
#   .\deploy\windows-deploy.ps1 -Uninstall
#
# PREREQUISITES
# ─────────────
#   • PowerShell run as Administrator
#   • Python 3.11+ on PATH (or in backend\venv already)
#   • Node.js 20+ on PATH
#   • pnpm on PATH  (npm install -g pnpm)
#   • Redis for Windows running  https://github.com/tporadowski/redis/releases
#   • NSSM 2.24+  https://nssm.cc/download — nssm.exe must be on PATH
#   • backend\.env populated (copy from backend\.env.example)
#
# REQUIRED ENV VARS IN backend\.env
# ──────────────────────────────────
#   DJANGO_SECRET_KEY   — long random string, NOT the dev default
#   DJANGO_DEBUG        — must be false in production
#   DJANGO_ALLOWED_HOSTS — include your server hostname
#   REDIS_URL           — e.g. redis://127.0.0.1:6379/0
# =============================================================================

[CmdletBinding()]
param(
    [switch]$Uninstall,   # Stop + remove all four services; preserves data
    [switch]$SkipBuild,   # Skip frontend pnpm install + build
    [switch]$SkipTests,   # Skip Django test suite
    [string]$AppDir = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
)

# ── Strict mode — catch undefined variables ───────────────────────────────────
Set-StrictMode -Version Latest
# NOTE: $ErrorActionPreference = "Stop" only applies to PowerShell cmdlets.
# Native executables (python, pip, pnpm, nssm, redis-cli) MUST be checked
# via $LASTEXITCODE after every call. See Invoke-Native helper below.
$ErrorActionPreference = 'Stop'

# ── Paths ─────────────────────────────────────────────────────────────────────
$BackendDir   = Join-Path $AppDir 'backend'
$FrontendDir  = Join-Path $AppDir 'frontend'
$VenvDir      = Join-Path $BackendDir 'venv'
$PythonExe    = Join-Path $VenvDir 'Scripts\python.exe'
$PipExe       = Join-Path $VenvDir 'Scripts\pip.exe'
$WaitressExe  = Join-Path $VenvDir 'Scripts\waitress-serve.exe'
$CeleryExe    = Join-Path $VenvDir 'Scripts\celery.exe'
$EnvFile      = Join-Path $BackendDir '.env'
$LogDir       = Join-Path $AppDir 'logs'
$NextBuildDir = Join-Path $FrontendDir '.next'

# ── Resolve Node.exe path (PS 5.1-compatible — no ?. operator) ───────────────
$_nodeCmd = Get-Command 'node.exe' -ErrorAction SilentlyContinue
$NodeExe  = if ($_nodeCmd) { $_nodeCmd.Source } else { 'node.exe' }

# Next.js on Windows cannot be launched via the Unix shell shim.
# We invoke Node.exe directly with the .js entry point from next/dist/bin.
# The path is resolved at runtime (after node_modules are installed).
$NextJsBin = Join-Path $FrontendDir 'node_modules\next\dist\bin\next'

# ── Service definitions ───────────────────────────────────────────────────────
# Arguments that contain spaces are quoted at the point they are passed to NSSM.
# Waitress and Celery executables live inside the venv Scripts\ dir.

$Services = @(
    @{
        Name        = 'iic-helpdesk-backend'
        DisplayName = 'IIC IT Helpdesk - Django Backend (waitress)'
        Description = 'Django WSGI application served by waitress on 127.0.0.1:8000'
        Executable  = $WaitressExe
        Arguments   = '--host=127.0.0.1 --port=8000 --threads=8 Project.wsgi:application'
        WorkDir     = $BackendDir
        StdoutLog   = Join-Path $LogDir 'backend-stdout.log'
        StderrLog   = Join-Path $LogDir 'backend-stderr.log'
        NeedsEnv    = $true
    },
    @{
        Name        = 'iic-helpdesk-celery-worker'
        DisplayName = 'IIC IT Helpdesk - Celery Worker'
        Description = 'Celery task worker (scans, emails, SLA checks)'
        Executable  = $CeleryExe
        Arguments   = '-A Project worker --loglevel=info --concurrency=2'
        WorkDir     = $BackendDir
        StdoutLog   = Join-Path $LogDir 'celery-worker-stdout.log'
        StderrLog   = Join-Path $LogDir 'celery-worker-stderr.log'
        NeedsEnv    = $true
    },
    @{
        Name        = 'iic-helpdesk-celery-beat'
        DisplayName = 'IIC IT Helpdesk - Celery Beat Scheduler'
        Description = 'Celery beat: SLA alerts, auto-close, outbox delivery'
        Executable  = $CeleryExe
        Arguments   = '-A Project beat --loglevel=info'
        WorkDir     = $BackendDir
        StdoutLog   = Join-Path $LogDir 'celery-beat-stdout.log'
        StderrLog   = Join-Path $LogDir 'celery-beat-stderr.log'
        NeedsEnv    = $true
    },
    @{
        Name        = 'iic-helpdesk-frontend'
        DisplayName = 'IIC IT Helpdesk - Next.js Frontend'
        Description = 'Next.js production server on 127.0.0.1:3000'
        # Launch node.exe directly — the Unix shell shim does not work under SCM.
        Executable  = $NodeExe
        # next start args; $NextJsBin is resolved at registration time below.
        Arguments   = ''   # set dynamically in Register-NssmService
        WorkDir     = $FrontendDir
        StdoutLog   = Join-Path $LogDir 'frontend-stdout.log'
        StderrLog   = Join-Path $LogDir 'frontend-stderr.log'
        NeedsEnv    = $false
    }
)

# =============================================================================
# HELPERS
# =============================================================================

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "-- $Message" -ForegroundColor Cyan
}

function Write-OK([string]$Message) {
    Write-Host "   OK  $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
    Write-Host "   WARN $Message" -ForegroundColor Yellow
}

function Write-Fail([string]$Message) {
    Write-Host "   FAIL $Message" -ForegroundColor Red
}

# Invoke a native executable and abort if it exits non-zero.
# Usage: Invoke-Native "pip" "install","-r","requirements.txt"
function Invoke-Native {
    param(
        [string]$Exe,
        [string[]]$Arguments,
        [string]$ErrorMessage = "Command failed: $Exe $Arguments"
    )
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) {
        Write-Fail $ErrorMessage
        exit $LASTEXITCODE
    }
}

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p  = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Fail 'This script must be run as Administrator.'
        Write-Host '   Right-click PowerShell -> Run as administrator, then re-run.' -ForegroundColor Yellow
        exit 1
    }
}

# Read .env file and return a hashtable of KEY=VALUE pairs.
# Handles: bare values, quoted values ("val" or 'val'), inline comments.
# Does NOT print values to the console.
function Read-EnvFile([string]$Path) {
    $env = @{}
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        # Skip blanks and comment lines
        if ($line -eq '' -or $line -match '^#') { return }
        # Must match KEY=VALUE (KEY may not start with a digit)
        if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            $key = $Matches[1]
            $val = $Matches[2].Trim()
            # Strip surrounding quotes (single or double)
            if (($val -match '^"(.*)"$') -or ($val -match "^'(.*)'$")) {
                $val = $Matches[1]
            }
            # Strip inline comment (only when value is not quoted)
            # e.g.  KEY=value  # comment
            elseif ($val -match '^([^#]*)\s+#') {
                $val = $Matches[1].Trim()
            }
            $env[$key] = $val
        }
    }
    return $env
}

# Parse REDIS_URL and validate connectivity using redis-cli with the
# correct host/port/auth, without printing the password to the console.
function Test-RedisConnectivity([string]$RedisUrl) {
    # Default values -- use $redisHost to avoid conflict with PowerShell's
    # built-in read-only $Host automatic variable.
    $redisHost = '127.0.0.1'
    $redisPort = '6379'
    $redisPass = ''
    $redisDb   = '0'

    # Parse redis://[:password@]host[:port][/db]
    if ($RedisUrl -match '^redis://(:[^@]+@)?([^:/]+)(:(\d+))?(/(\d+))?') {
        if ($Matches[1]) { $redisPass = $Matches[1].TrimStart(':').TrimEnd('@') }
        $redisHost = $Matches[2]
        if ($Matches[4]) { $redisPort = $Matches[4] }
        if ($Matches[6]) { $redisDb   = $Matches[6] }
    }

    $redisCli = Get-Command 'redis-cli' -ErrorAction SilentlyContinue
    if (-not $redisCli) {
        Write-Warn 'redis-cli not found on PATH — skipping Redis connectivity test.'
        Write-Warn 'Verify Redis is running manually before starting services.'
        return $true
    }

    # Build args — do NOT include password in plain text if avoidable.
    # redis-cli supports REDISCLI_AUTH env var to avoid shell history exposure.
    $env:REDISCLI_AUTH = $redisPass
    try {
        $result = & redis-cli -h $redisHost -p $redisPort -n $redisDb PING 2>&1
        if ($result -match 'PONG') {
            return $true
        }
        Write-Fail "Redis at ${redisHost}:${redisPort}/db${redisDb} did not return PONG (got: $result)"
        return $false
    } finally {
        # Clear password from environment
        Remove-Item Env:REDISCLI_AUTH -ErrorAction SilentlyContinue
    }
}

# Validate security-sensitive Django settings without printing values.
function Assert-ProductionSettings([hashtable]$EnvVars) {
    $issues = @()

    $secretKey = $EnvVars['DJANGO_SECRET_KEY']
    if (-not $secretKey -or $secretKey -eq 'django-insecure-local-development-only' -or
        $secretKey -match 'insecure') {
        $issues += 'DJANGO_SECRET_KEY appears to be the dev default. Set a real random key.'
    }

    $debug = $EnvVars['DJANGO_DEBUG']
    if ($debug -and $debug.ToLower() -eq 'true') {
        $issues += 'DJANGO_DEBUG=true is set. This MUST be false in production.'
    }

    $hosts = $EnvVars['DJANGO_ALLOWED_HOSTS']
    if (-not $hosts -or $hosts -match '^\*$') {
        $issues += 'DJANGO_ALLOWED_HOSTS is missing or set to wildcard (*). Set explicit hostnames.'
    }

    if ($issues.Count -gt 0) {
        Write-Host ''
        Write-Host '   SECURITY WARNINGS:' -ForegroundColor Yellow
        foreach ($issue in $issues) {
            Write-Host "   ! $issue" -ForegroundColor Yellow
        }
        Write-Host ''
    }
}

# Stop a service if it is running. Waits for it to stop.
function Stop-ServiceSafe([string]$Name) {
    $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if (-not $svc) { return }
    if ($svc.Status -ne 'Stopped') {
        Write-Host "   Stopping $Name..." -ForegroundColor DarkGray
        Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
        # Wait up to 15 seconds for the service to stop
        $waited = 0
        while ($waited -lt 15) {
            Start-Sleep -Seconds 1
            $waited++
            $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
            if (-not $svc -or $svc.Status -eq 'Stopped') { break }
        }
        $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
        if ($svc -and $svc.Status -ne 'Stopped') {
            Write-Warn "$Name did not stop cleanly after 15s (status: $($svc.Status))"
        }
    }
}

# Register or update a single NSSM service.
# All NSSM exit codes are checked. Paths with spaces are quoted for NSSM.
function Register-NssmService([hashtable]$Svc, [hashtable]$EnvVars) {
    $name = $Svc.Name

    # Resolve Next.js arguments at registration time
    $arguments = $Svc.Arguments
    if ($name -eq 'iic-helpdesk-frontend') {
        # Quote path in case $FrontendDir contains spaces
        $arguments = "`"$NextJsBin`" start --hostname 127.0.0.1 --port 3000"
    }

    $existing = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "   $name exists — updating configuration..." -ForegroundColor DarkGray
        # Application and arguments
        & nssm set $name Application    $Svc.Executable | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Fail "NSSM: failed to set Application for $name"; exit 1 }
        & nssm set $name AppParameters  $arguments      | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Fail "NSSM: failed to set AppParameters for $name"; exit 1 }
        & nssm set $name AppDirectory   $Svc.WorkDir    | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Fail "NSSM: failed to set AppDirectory for $name"; exit 1 }
    } else {
        Write-Host "   Registering new service: $name..." -ForegroundColor DarkGray
        & nssm install $name $Svc.Executable $arguments | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Fail "NSSM: failed to install $name"; exit 1 }
        & nssm set $name AppDirectory $Svc.WorkDir | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Fail "NSSM: failed to set AppDirectory for $name"; exit 1 }
    }

    # Display metadata
    & nssm set $name DisplayName $Svc.DisplayName | Out-Null
    & nssm set $name Description $Svc.Description | Out-Null

    # Startup type: automatic
    & nssm set $name Start SERVICE_AUTO_START | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Fail "NSSM: failed to set Start for $name"; exit 1 }

    # Log files
    & nssm set $name AppStdout $Svc.StdoutLog | Out-Null
    & nssm set $name AppStderr $Svc.StderrLog | Out-Null
    & nssm set $name AppStdoutCreationDisposition OPEN_ALWAYS | Out-Null
    & nssm set $name AppStderrCreationDisposition OPEN_ALWAYS | Out-Null

    # Log rotation: daily or at 10 MB
    & nssm set $name AppRotateFiles   1        | Out-Null
    & nssm set $name AppRotateSeconds 86400    | Out-Null
    & nssm set $name AppRotateBytes   10485760 | Out-Null

    # Restart on failure: wait 5 s, then restart. Max 3 restarts per 60 s window
    # to prevent aggressive loops on persistent startup failures.
    & nssm set $name AppRestartDelay  5000  | Out-Null
    & nssm set $name AppThrottle      60000 | Out-Null  # reset restart count every 60 s

    # Inject .env variables for backend/Celery services only.
    # Frontend inherits system PATH via Node; no app secrets needed.
    if ($Svc.NeedsEnv -and $EnvVars.Count -gt 0) {
        # Build KEY=VALUE lines — NSSM AppEnvironmentExtra uses newline-separated pairs.
        # Do NOT log the values.
        $lines = @()
        foreach ($kv in $EnvVars.GetEnumerator()) {
            # Quote value if it contains spaces (NSSM preserves this correctly)
            $v = $kv.Value
            if ($v -match '\s') { $v = "`"$v`"" }
            $lines += "$($kv.Key)=$v"
        }
        $envBlock = $lines -join "`n"
        # Use Set-ItemProperty via registry to avoid command-line length limits
        # and ensure the block is set atomically.
        $regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$name\Parameters"
        if (Test-Path $regPath) {
            Set-ItemProperty -Path $regPath -Name 'AppEnvironmentExtra' -Value $envBlock -ErrorAction SilentlyContinue
        }
        # Fall back to nssm set if registry key doesn't exist yet
        & nssm set $name AppEnvironmentExtra $envBlock | Out-Null
        # Not fatal if this fails on first run; the registry approach above handles it.
    }

    Write-OK "$name configured"
}

# =============================================================================
# UNINSTALL
# =============================================================================

if ($Uninstall) {
    Assert-Admin
    Write-Host ''
    Write-Host 'Uninstalling IIC IT Helpdesk Windows services...' -ForegroundColor Yellow
    Write-Host 'NOTE: application data, .env, logs, and dependencies are preserved.' -ForegroundColor DarkGray
    foreach ($svc in $Services) {
        $name = $svc.Name
        $existing = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($existing) {
            Stop-ServiceSafe $name
            & nssm remove $name confirm | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-OK "Removed: $name"
            } else {
                Write-Warn "NSSM returned non-zero removing $name -- it may already be gone."
            }
        } else {
            Write-Host "   $name not installed -- skipping" -ForegroundColor DarkGray
        }
    }
    Write-Host ''
    Write-Host 'All services removed.' -ForegroundColor Green
    exit 0
}

# =============================================================================
# DEPLOY
# =============================================================================

Assert-Admin

Write-Host ''
Write-Host '================================================================' -ForegroundColor Blue
Write-Host '   IIC IT Helpdesk -- Windows Deployment' -ForegroundColor Blue
Write-Host '================================================================' -ForegroundColor Blue
Write-Host "  App directory : $AppDir"
Write-Host "  Backend       : $BackendDir"
Write-Host "  Frontend      : $FrontendDir"
Write-Host "  Log dir       : $LogDir"
Write-Host ''

# ── Step 0: Read .env (needed for Redis validation + security checks) ─────────
Write-Step 'Reading configuration'
if (-not (Test-Path $EnvFile)) {
    Write-Fail ".env not found at $EnvFile"
    Write-Host '   Copy backend\.env.example to backend\.env and fill in your values.' -ForegroundColor Yellow
    exit 1
}
$EnvVars = Read-EnvFile $EnvFile
Write-OK '.env parsed'

# Validate required keys without printing values
$requiredKeys = @('DJANGO_SECRET_KEY', 'DJANGO_DEBUG', 'DJANGO_ALLOWED_HOSTS', 'REDIS_URL')
foreach ($key in $requiredKeys) {
    if (-not $EnvVars.ContainsKey($key) -or $EnvVars[$key] -eq '') {
        Write-Fail "Required env var '$key' is missing or blank in $EnvFile"
        exit 1
    }
}
Write-OK 'Required env vars present'

# Warn about insecure production settings (non-fatal — allows local dev use)
Assert-ProductionSettings $EnvVars

# ── Step 1: Prerequisites ─────────────────────────────────────────────────────
Write-Step 'Checking prerequisites'

# NSSM
if (-not (Get-Command 'nssm' -ErrorAction SilentlyContinue)) {
    Write-Fail 'nssm not found on PATH.'
    Write-Host '   Download from https://nssm.cc/download, extract, add to PATH.' -ForegroundColor Yellow
    exit 1
}
Write-OK 'nssm found'

# Node.js version >= 20
if (-not (Get-Command 'node' -ErrorAction SilentlyContinue)) {
    Write-Fail 'node not found on PATH. Install from https://nodejs.org/'
    exit 1
}
$nodeVer = (& node --version 2>&1).TrimStart('v')
$nodeMaj = [int]($nodeVer -split '\.')[0]
if ($nodeMaj -lt 20) {
    Write-Fail "Node.js 20+ required (found v$nodeVer). Upgrade from https://nodejs.org/"
    exit 1
}
Write-OK "node v$nodeVer"

# pnpm
if (-not (Get-Command 'pnpm' -ErrorAction SilentlyContinue)) {
    Write-Fail 'pnpm not found. Run: npm install -g pnpm'
    exit 1
}
Write-OK 'pnpm found'

# Python venv (create if missing)
if (-not (Test-Path $PythonExe)) {
    Write-Host '   Virtual environment not found -- creating...' -ForegroundColor DarkGray
    $sysPy = Get-Command 'python' -ErrorAction SilentlyContinue
    if (-not $sysPy) {
        Write-Fail 'python not found on PATH. Install Python 3.11+ from https://python.org/'
        exit 1
    }
    # Check Python version >= 3.11
    $pyVer = (& python --version 2>&1) -replace 'Python ',''
    $pyMaj, $pyMin = ($pyVer -split '\.')[0..1]
    if ([int]$pyMaj -lt 3 -or ([int]$pyMaj -eq 3 -and [int]$pyMin -lt 11)) {
        Write-Fail "Python 3.11+ required (found $pyVer)"
        exit 1
    }
    Invoke-Native 'python' @('-m', 'venv', $VenvDir) `
        -ErrorMessage "Failed to create virtual environment at $VenvDir"
    Write-OK "Virtual environment created (Python $pyVer)"
} else {
    $pyVer = (& $PythonExe --version 2>&1) -replace 'Python ',''
    Write-OK "Virtual environment found (Python $pyVer)"
}

# Redis connectivity — use REDIS_URL from .env
$redisUrl = $EnvVars['REDIS_URL']
Write-Host '   Testing Redis connectivity...' -ForegroundColor DarkGray
if (-not (Test-RedisConnectivity $redisUrl)) {
    Write-Fail "Cannot connect to Redis at $redisUrl"
    Write-Host '   Install or start Redis. See: https://github.com/tporadowski/redis/releases' -ForegroundColor Yellow
    exit 1
}
Write-OK 'Redis is reachable'

# Log directory
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    Write-OK "Log directory created: $LogDir"
} else {
    Write-OK "Log directory: $LogDir"
}

# ── Step 2: Backend Python dependencies ───────────────────────────────────────
Write-Step 'Installing backend Python dependencies'
Invoke-Native $PipExe @('install', '--upgrade', 'pip', '--quiet') `
    -ErrorMessage 'pip self-upgrade failed'
Invoke-Native $PipExe @('install', '-r', (Join-Path $BackendDir 'requirements.txt')) `
    -ErrorMessage 'pip install -r requirements.txt failed'
Write-OK 'Backend dependencies installed'

# ── Step 3: Django system check ───────────────────────────────────────────────
Write-Step 'Running Django system check'
Push-Location $BackendDir
try {
    Invoke-Native $PythonExe @('manage.py', 'check') `
        -ErrorMessage 'Django system check failed'
    Write-OK 'Django system check passed'
} finally { Pop-Location }

# ── Step 4: Django tests ──────────────────────────────────────────────────────
if (-not $SkipTests) {
    Write-Step 'Running Django tests'
    Push-Location $BackendDir
    try {
        Invoke-Native $PythonExe @('manage.py', 'test', '--verbosity=1') `
            -ErrorMessage 'Django tests failed'
        Write-OK 'Django tests passed'
    } finally { Pop-Location }
} else {
    Write-Host ''
    Write-Host '   Django tests skipped (-SkipTests)' -ForegroundColor DarkGray
}

# ── Step 5: Frontend build ────────────────────────────────────────────────────
if (-not $SkipBuild) {
    Write-Step 'Installing frontend dependencies'
    Push-Location $FrontendDir
    try {
        if (-not (Test-Path (Join-Path $FrontendDir 'pnpm-lock.yaml'))) {
            Write-Fail 'pnpm-lock.yaml not found. Run pnpm install in the frontend directory first.'
            exit 1
        }
        Invoke-Native 'pnpm' @('install', '--frozen-lockfile') `
            -ErrorMessage 'pnpm install failed'
        Write-OK 'Frontend dependencies installed'
    } finally { Pop-Location }

    Write-Step 'Building Next.js frontend'
    Push-Location $FrontendDir
    try {
        Invoke-Native 'pnpm' @('build') `
            -ErrorMessage 'Next.js build failed'
        Write-OK 'Frontend build completed'
    } finally { Pop-Location }
} else {
    Write-Host ''
    Write-Host '   Frontend build skipped (-SkipBuild)' -ForegroundColor DarkGray
    # Safety check: warn if there is no existing production build
    if (-not (Test-Path $NextBuildDir)) {
        Write-Warn ".next directory not found at $NextBuildDir"
        Write-Warn 'The frontend service will fail to start without a production build.'
        Write-Warn 'Run without -SkipBuild to build the frontend first.'
    }
}

# ── Step 6: Stop existing services (before migration — avoids DB conflicts) ───
Write-Step 'Stopping existing services'
foreach ($svc in $Services) { Stop-ServiceSafe $svc.Name }
Write-OK 'Existing services stopped'

# ── Step 7: Database migrations ───────────────────────────────────────────────
Write-Step 'Running database migrations'
Push-Location $BackendDir
try {
    Invoke-Native $PythonExe @('manage.py', 'migrate', '--noinput') `
        -ErrorMessage 'Database migration failed'
    Write-OK 'Migrations applied'
} finally { Pop-Location }

# ── Step 8: Collect static files ──────────────────────────────────────────────
Write-Step 'Collecting static files'
Push-Location $BackendDir
try {
    Invoke-Native $PythonExe @('manage.py', 'collectstatic', '--noinput') `
        -ErrorMessage 'collectstatic failed'
    Write-OK 'Static files collected'
} finally { Pop-Location }

# ── Step 9: Bootstrap admin (only if INITIAL_ADMIN_PASSWORD is in .env) ───────
Write-Step 'Bootstrapping admin user'
if ($EnvVars.ContainsKey('INITIAL_ADMIN_PASSWORD') -and $EnvVars['INITIAL_ADMIN_PASSWORD'] -ne '') {
    Push-Location $BackendDir
    try {
        # Pass password via env var — never as a command-line argument that would
        # appear in process listings or logs.
        $env:INITIAL_ADMIN_PASSWORD = $EnvVars['INITIAL_ADMIN_PASSWORD']
        Invoke-Native $PythonExe @('manage.py', 'bootstrap_admin') `
            -ErrorMessage 'bootstrap_admin failed'
        Write-OK 'Admin bootstrap complete'
    } finally {
        Remove-Item Env:INITIAL_ADMIN_PASSWORD -ErrorAction SilentlyContinue
        Pop-Location
    }
} else {
    Write-Host '   INITIAL_ADMIN_PASSWORD not set in .env -- skipping bootstrap.' -ForegroundColor DarkGray
    Write-Host '   Add INITIAL_ADMIN_PASSWORD=<value> to .env to bootstrap the admin account.' -ForegroundColor DarkGray
}

# ── Step 10: Register / update Windows services ───────────────────────────────
Write-Step 'Registering Windows services via NSSM'
# Verify the Next.js bin exists before registering the frontend service
if (-not (Test-Path "$NextJsBin")) {
    if ($SkipBuild) {
        Write-Warn "Next.js bin not found at $NextJsBin"
        Write-Warn 'Frontend service may fail to start. Run without -SkipBuild to rebuild.'
    } else {
        Write-Fail "Next.js bin not found at $NextJsBin after build. Check the build output."
        exit 1
    }
}

foreach ($svc in $Services) {
    Register-NssmService $svc $EnvVars
}

# ── Step 11: Start services in dependency order ───────────────────────────────
Write-Step 'Starting services'
$startOrder = @(
    'iic-helpdesk-backend',
    'iic-helpdesk-celery-worker',
    'iic-helpdesk-celery-beat',
    'iic-helpdesk-frontend'
)

foreach ($name in $startOrder) {
    Write-Host "   Starting $name..." -ForegroundColor DarkGray
    try {
        Start-Service -Name $name -ErrorAction Stop
    } catch {
        Write-Fail "Start-Service $name failed: $($_.Exception.Message)"
        Write-Host "   Check log files in: $LogDir" -ForegroundColor Yellow
        exit 1
    }

    # Wait up to 10 s for the service to reach Running status
    $elapsed = 0
    $running = $false
    while ($elapsed -lt 10) {
        Start-Sleep -Seconds 1
        $elapsed++
        $s = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($s -and $s.Status -eq 'Running') { $running = $true; break }
    }
    if ($running) {
        Write-OK "$name is running"
    } else {
        $s = Get-Service -Name $name -ErrorAction SilentlyContinue
        $st = if ($s) { $s.Status } else { 'NotFound' }
        Write-Fail "$name did not reach Running state within 10s (status: $st)"
        Write-Host "   Check log files in: $LogDir" -ForegroundColor Yellow
        exit 1
    }
}

# ── Step 12: Health checks ────────────────────────────────────────────────────
Write-Step 'Running health checks'

# Backend: GET /api/v1/health/ must return HTTP 200 with {"status":"ok"}
$backendOk = $false
for ($i = 1; $i -le 5; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/v1/health/' `
            -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
            Write-OK "Backend health check passed (HTTP 200)"
            $backendOk = $true
            break
        }
    } catch {
        # Non-200 or connection refused
    }
    Write-Host "   Backend not ready. Attempt $i/5..." -ForegroundColor DarkGray
    Start-Sleep -Seconds 3
}
if (-not $backendOk) {
    Write-Fail 'Backend health check failed after 5 attempts.'
    Write-Host "   Tail the log: Get-Content `"$LogDir\backend-stderr.log`" -Tail 30" -ForegroundColor Yellow
    exit 1
}

# Redis: re-check after services are running
# Test-RedisConnectivity handles auth internally via REDISCLI_AUTH env var.
if (Test-RedisConnectivity $redisUrl) {
    Write-OK 'Redis health check passed'
} else {
    Write-Warn 'Redis health check failed — Celery tasks will not run.'
}
Remove-Item Env:REDISCLI_AUTH -ErrorAction SilentlyContinue

# Celery worker: ping via celery inspect (requires broker to be reachable)
Write-Host '   Checking Celery worker readiness...' -ForegroundColor DarkGray
Push-Location $BackendDir
try {
    $celeryPing = & $CeleryExe -A Project inspect ping --timeout=8 2>&1
    if ($LASTEXITCODE -eq 0 -and ($celeryPing -match 'pong' -or $celeryPing -match 'OK')) {
        Write-OK 'Celery worker responded to ping'
    } else {
        Write-Warn 'Celery worker ping did not return a response within 8s.'
        Write-Warn 'This may be normal during first start. Check celery-worker-stdout.log'
    }
} catch {
    Write-Warn "Celery inspect ping failed: $($_.Exception.Message)"
} finally { Pop-Location }

# Frontend: GET / must return a non-5xx response
$frontendOk = $false
for ($i = 1; $i -le 12; $i++) {
    try {
        $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/' `
            -UseBasicParsing -TimeoutSec 6 -ErrorAction Stop
        if ($resp.StatusCode -lt 500) {
            Write-OK "Frontend health check passed (HTTP $($resp.StatusCode))"
            $frontendOk = $true
            break
        }
    } catch { }
    Write-Host "   Frontend not ready. Attempt $i/12..." -ForegroundColor DarkGray
    Start-Sleep -Seconds 4
}
if (-not $frontendOk) {
    Write-Fail 'Frontend health check failed after 12 attempts (~48 s).'
    Write-Host "   Tail the log: Get-Content `"$LogDir\frontend-stderr.log`" -Tail 30" -ForegroundColor Yellow
    exit 1
}

# =============================================================================
# DONE
# =============================================================================

Write-Host ''
Write-Host '================================================================' -ForegroundColor Green
Write-Host '   IIC IT Helpdesk deployment completed successfully!' -ForegroundColor Green
Write-Host '================================================================' -ForegroundColor Green
Write-Host ''
Write-Host '  Services running:'
foreach ($svc in $Services) { Write-Host "    * $($svc.Name)" }
Write-Host ''
Write-Host "  Log files : $LogDir"
Write-Host '  Backend   : http://127.0.0.1:8000'
Write-Host '  Frontend  : http://127.0.0.1:3000'
Write-Host ''
Write-Host '  Useful commands:'
Write-Host '    Get-Service iic-helpdesk-*                        # service status'
Write-Host "    Get-Content `"$LogDir\backend-stderr.log`" -Tail 50  # backend errors"
Write-Host "    Get-Content `"$LogDir\frontend-stderr.log`" -Tail 50 # frontend errors"
Write-Host '    .\deploy\windows-deploy.ps1 -Uninstall            # remove services'
Write-Host ''

# =============================================================================
# RECOVERY PROCEDURE (printed when deployment fails mid-way)
# =============================================================================
# If deployment fails:
#
# 1. Read the error message and the relevant log file shown above.
#
# 2. Fix the root cause (missing env var, failed migration, port conflict, etc.)
#
# 3. Re-run the script — it is idempotent:
#       .\deploy\windows-deploy.ps1
#
# 4. If a migration failed and the DB is in an inconsistent state:
#       cd backend
#       venv\Scripts\python.exe manage.py showmigrations
#       # Identify the last successful migration and roll back if needed:
#       venv\Scripts\python.exe manage.py migrate helpdesk <last_good_migration>
#
# 5. If a service refuses to start after several attempts:
#       nssm edit iic-helpdesk-backend   # opens NSSM GUI for the service
#       Get-Content logs\backend-stderr.log -Tail 100
#
# 6. To fully reset services without touching data:
#       .\deploy\windows-deploy.ps1 -Uninstall
#       .\deploy\windows-deploy.ps1
# =============================================================================
