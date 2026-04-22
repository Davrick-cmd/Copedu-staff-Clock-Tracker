#Requires -Version 5.1
<#
.SYNOPSIS
  Import OrangeHRM leave entitlements into SQLite using py -3 (Windows-friendly).

.DESCRIPTION
  Use this when `python` is not on PATH. Edit -SqlPath or pass it as the first argument.

.EXAMPLE
  cd backend
  .\migrate-entitlements.ps1 -SqlPath "D:\exports\hr_leave.sql"
#>
param(
  [Parameter(Mandatory = $false)]
  [string] $SqlPath = "",

  [int] $SqliteYear = 2026,
  [int] $OrangeFromYear = 2025,
  [ValidateSet("latest", "sum")]
  [string] $EntitlementMerge = "latest",

  [switch] $ApplyReporting
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not $SqlPath) {
  if ($args.Count -ge 1) { $SqlPath = $args[0] }
}
if (-not $SqlPath -or -not (Test-Path -LiteralPath $SqlPath)) {
  Write-Host "Usage: .\migrate-entitlements.ps1 -SqlPath `"C:\path\to\hr_leave.sql`"" -ForegroundColor Yellow
  Write-Host "Or:    .\migrate-entitlements.ps1 `"C:\path\to\hr_leave.sql`"" -ForegroundColor Yellow
  exit 1
}

$venvPy = Join-Path $PSScriptRoot "venv\Scripts\python.exe"
if (Test-Path -LiteralPath $venvPy) {
  Write-Host "Using venv: $venvPy" -ForegroundColor DarkGray
  $extra = @()
  if ($ApplyReporting) { $extra += "--apply-reporting" }
  & $venvPy scripts/migrate_orangehrm_leave.py `
  --sql $SqlPath `
  --apply `
  --only-entitlements `
  --sqlite-year $SqliteYear `
  --ohrm-entitlement-from-year $OrangeFromYear `
  --entitlement-merge $EntitlementMerge `
  @extra
  exit $LASTEXITCODE
}

$py = Get-Command py -ErrorAction SilentlyContinue
if (-not $py) {
  Write-Host "Python not found. Do one of the following:" -ForegroundColor Red
  Write-Host "  1) Install Python from https://www.python.org/downloads/ (check 'Add python.exe to PATH'), then use: py -3 ..." -ForegroundColor Yellow
  Write-Host "  2) In backend: py -3 -m venv venv ; .\venv\Scripts\Activate.ps1 ; pip install -r requirements.txt" -ForegroundColor Yellow
  Write-Host "  3) Disable Windows Store alias for 'python' (Settings > Apps > App execution aliases)." -ForegroundColor Yellow
  exit 1
}

$extra2 = @()
if ($ApplyReporting) { $extra2 += "--apply-reporting" }
& py -3 scripts/migrate_orangehrm_leave.py `
  --sql $SqlPath `
  --apply `
  --only-entitlements `
  --sqlite-year $SqliteYear `
  --ohrm-entitlement-from-year $OrangeFromYear `
  --entitlement-merge $EntitlementMerge `
  @extra2
