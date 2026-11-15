# CalibrateIQ launcher for Windows PowerShell.
#   First time:  .\start.ps1 -Setup
#   Afterwards:  .\start.ps1
# If PowerShell blocks the script, run once:  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
param([switch]$Setup)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Find-Python {
  foreach ($c in @('python', 'py')) { if (Get-Command $c -ErrorAction SilentlyContinue) { return $c } }
  throw 'Python was not found. Install Python 3.10+ from python.org and tick "Add to PATH".'
}
function Need($cmd, $hint) { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd was not found. $hint" } }
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Run($exe, $argList) { & $exe @argList; if ($LASTEXITCODE -ne 0) { throw "Command failed: $exe $($argList -join ' ')" } }

$py = Find-Python
Need 'node' 'Install Node 20+ from nodejs.org, then reopen the terminal.'
Need 'npm'  'Install Node 20+ from nodejs.org, then reopen the terminal.'

if ($Setup) {
  Step 'AI service: installing packages, creating dataset, training model'
  Push-Location "$root\ai-service"
  Run $py @('-m', 'pip', 'install', '-r', 'requirements.txt')
  Run $py @('generate_dataset.py')
  Run $py @('train.py')
  Pop-Location

  Step 'Backend: installing packages'
  Push-Location "$root\backend"
  Run 'npm' @('install')
  if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env' }
  Pop-Location

  Step 'Frontend: installing packages and building'
  Push-Location "$root\frontend"
  Run 'npm' @('install')
  Run 'npm' @('run', 'build')
  Pop-Location
}

$envFile = "$root\backend\.env"
# Only the DATABASE_URL line matters (comments in the file may mention the placeholder text).
$dbLine = $null
if (Test-Path $envFile) { $dbLine = Select-String -Path $envFile -Pattern '^\s*DATABASE_URL\s*=' | Select-Object -First 1 }
if (-not $dbLine -or $dbLine.Line -match 'YOUR-PASSWORD|xxxxxxxxxxxx|your-region') {
  throw "Edit backend\.env and paste your Supabase connection string into the DATABASE_URL line, then run this script again (see SUPABASE_SETUP.md)."
}
Step 'Checking the database connection'
Push-Location "$root\backend"; Run 'npm' @('run', 'db:check'); Pop-Location

if (-not (Test-Path "$root\frontend\dist")) { throw 'The web app is not built yet. Run:  .\start.ps1 -Setup' }

Step 'Starting AI service (new window)'
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\ai-service'; $py app.py"
Start-Sleep -Seconds 3

Step 'Starting the app (new window)'
Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$root\backend'; node src/server.js"
Start-Sleep -Seconds 3

Write-Host "`nOpen http://localhost:4000   (admin@lab.test / Admin@123)" -ForegroundColor Green
Write-Host 'To stop: close the two new PowerShell windows.'
Start-Process 'http://localhost:4000'
