# Dump the local Docker Postgres database to a single file (schema + data).
# Produces db/optiontrap-dump.sql which can be restored into any Postgres.
#
# Usage:  powershell -File db/dump-local.ps1

$ErrorActionPreference = 'Stop'
$container = 'optiontrap-postgres'
$outFile = Join-Path $PSScriptRoot 'optiontrap-dump.sql'

Write-Host "Dumping $container -> $outFile ..."

# --clean --if-exists: drops existing objects first so restore fully replaces prod.
# --no-owner --no-privileges: portable across different DB users (Railway user differs).
docker exec -i $container pg_dump `
  -U optiontrap -d optiontrap `
  --clean --if-exists --no-owner --no-privileges `
  | Out-File -FilePath $outFile -Encoding utf8

$size = (Get-Item $outFile).Length
Write-Host "Done. Wrote $size bytes to $outFile"
