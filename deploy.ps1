# Deploiement Imposteur Mots sur Render (1 clic)
$git = "C:\Program Files\Git\bin\git.exe"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "Imposteur Mots -> Render" -ForegroundColor Cyan
Write-Host ""

& $git push origin main:imposteur-mots 2>$null

$url = "https://dashboard.render.com/web/new?repo=https://github.com/tryhardd71/paripotes&branch=imposteur-mots"
Write-Host "Ouvre Render pour creer le service..." -ForegroundColor Green
Start-Process $url

Write-Host ""
Write-Host "Sur Render, verifie :" -ForegroundColor Yellow
Write-Host "  - Branch : imposteur-mots"
Write-Host "  - Build  : npm install"
Write-Host "  - Start  : npm start"
Write-Host "  - Plan   : Free"
Write-Host ""
Write-Host "Clique Create Web Service -> lien final :" -ForegroundColor Green
Write-Host "  https://imposteur-mots.onrender.com"
Write-Host ""