<#
Purpose: Starts the local fast-start CDNgine dependency stack with one command.
Governing docs:
- README.md
- deploy/local-platform/README.md
- docs/environment-and-deployment.md
External references:
- https://docs.docker.com/reference/cli/docker/compose/
Tests:
- powershell -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('deploy\\local-platform\\start.ps1',[ref]$null,[ref]$null) | Out-Null"
#>
[CmdletBinding()]
param(
    [switch]$Fresh
)

$envFile = Join-Path $PSScriptRoot ".env"
$exampleFile = Join-Path $PSScriptRoot ".env.example"
$composeFile = Join-Path $PSScriptRoot "compose.fast-start.yaml"

if (-not (Test-Path $envFile)) {
    Copy-Item $exampleFile $envFile
    Write-Host "Created $envFile from .env.example"
}

if ($Fresh) {
    docker compose --env-file $envFile -f $composeFile down --remove-orphans
}

docker compose --env-file $envFile -f $composeFile up -d
