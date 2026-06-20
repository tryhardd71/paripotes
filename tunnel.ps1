# Ouvre PariPotes sur Internet (lien public pour tes potes)
# Le lien change a chaque relance. Pour un lien permanent → Render.com (voir instructions en bas)

$port = 3847
$cloudflared = "cloudflared"

if (-not (Get-Command $cloudflared -ErrorAction SilentlyContinue)) {
    $wingetPath = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\cloudflared.exe"
    if (Test-Path $wingetPath) { $cloudflared = $wingetPath }
    else {
        Write-Host "Installe cloudflared : winget install Cloudflare.cloudflared" -ForegroundColor Red
        exit 1
    }
}

# Serveur local
try {
    Invoke-WebRequest "http://localhost:$port/api/status" -TimeoutSec 2 | Out-Null
} catch {
    Write-Host "Demarrage du serveur..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$PSScriptRoot'; node index.js" -WindowStyle Minimized
    Start-Sleep -Seconds 5
}

Write-Host ""
Write-Host "=== PariPotes en ligne ===" -ForegroundColor Green
Write-Host "Le lien public s'affiche dans quelques secondes..."
Write-Host "Garde cette fenetre ouverte. Envoie le lien https://... a tes potes."
Write-Host ""
Write-Host "Pour un lien PERMANENT (gratuit) : https://render.com" -ForegroundColor Yellow
Write-Host ""

& $cloudflared tunnel --url "http://localhost:$port"