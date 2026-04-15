<#
Purpose: Stops the local fast-start CDNgine dependency stack.
Governing docs:
- deploy/local-platform/README.md
- docs/environment-and-deployment.md
External references:
- https://docs.docker.com/reference/cli/docker/compose/
Tests:
- powershell -NoProfile -Command "[System.Management.Automation.Language.Parser]::ParseFile('deploy\\local-platform\\stop.ps1',[ref]$null,[ref]$null) | Out-Null"
#>
[CmdletBinding()]
param()

$envFile = Join-Path $PSScriptRoot ".env"
$composeFile = Join-Path $PSScriptRoot "compose.fast-start.yaml"

if (Test-Path $envFile) {
    docker compose --env-file $envFile -f $composeFile down --remove-orphans
} else {
    docker compose -f $composeFile down --remove-orphans
}
