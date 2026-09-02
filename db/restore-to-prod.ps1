# Restore db/optiontrap-dump.sql into a target Postgres (e.g. Railway prod).
# This REPLACES the target database contents (the dump uses --clean --if-exists).
#
# Usage:
#   $env:PROD_DATABASE_URL = "postgres://user:pass@host:port/dbname"
#   powershell -File db/restore-to-prod.ps1
#
# Runs psql inside the local Docker container so you don't need Postgres
# installed on your machine.

$ErrorActionPreference = 'Stop'
$container = 'optiontrap-postgres'
$dumpFile = Join-Path $PSScriptRoot 'optiontrap-dump.sql'

if (-not $env:PROD_DATABASE_URL) {
  Write-Error "Set PROD_DATABASE_URL first, e.g. `$env:PROD_DATABASE_URL='postgres://...'"
}
if (-not (Test-Path $dumpFile)) {
  Write-Error "Dump not found: $dumpFile. Run db/dump-local.ps1 first."
}

Write-Host "Restoring $dumpFile -> PROD ..."

# Pipe the dump file into psql running inside the container, connected to prod.
Get-Content $dumpFile -Raw | docker exec -i $container `
  psql "$($env:PROD_DATABASE_URL)" -v ON_ERROR_STOP=1

Write-Host "Restore complete."
