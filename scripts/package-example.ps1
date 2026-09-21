$ErrorActionPreference = 'Stop'
$orbitRoot = Split-Path -Parent $PSScriptRoot
$orbitBuild = Join-Path $orbitRoot ('.data\packages\' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $orbitBuild -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $orbitRoot 'examples\star-garden\index.html'),(Join-Path $orbitRoot 'examples\star-garden\game.css'),(Join-Path $orbitRoot 'examples\star-garden\game.js'),(Join-Path $orbitRoot 'examples\star-garden\orbit.json'),(Join-Path $orbitRoot 'public\orbit-sdk.js') -Destination $orbitBuild
$orbitZip = Join-Path $orbitBuild 'star-garden.zip'
Compress-Archive -Path (Join-Path $orbitBuild '*.html'),(Join-Path $orbitBuild '*.css'),(Join-Path $orbitBuild '*.js'),(Join-Path $orbitBuild '*.json') -DestinationPath $orbitZip
Write-Output $orbitZip
