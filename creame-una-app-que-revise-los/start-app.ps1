$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverFile = Join-Path $scriptDir "server.js"
$candidateNodes = @(
  "C:\Users\danie\AppData\Local\OpenAI\Codex\bin\node.exe",
  "C:\Users\danie\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\OpenAI\Codex\bin\node.exe",
  "C:\Program Files\WindowsApps\OpenAI.Codex_26.422.3464.0_x64__2p2nqsd0c76g0\app\resources\node.exe"
)

function Get-NodeCommand {
  $command = Get-Command node -ErrorAction SilentlyContinue

  if ($command) {
    return $command.Source
  }

  foreach ($candidate in $candidateNodes) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $whereResult = where.exe node 2>$null | Select-Object -First 1

  if ($whereResult -and (Test-Path $whereResult)) {
    return $whereResult
  }

  throw "No encuentro Node.js. Prueba con una ruta completa a node.exe o instala Node.js."
}

$nodeCommand = Get-NodeCommand

Write-Host ""
Write-Host "Arrancando la app con:" $nodeCommand
Write-Host "URL esperada: http://127.0.0.1:4173"
Write-Host ""

& $nodeCommand $serverFile
