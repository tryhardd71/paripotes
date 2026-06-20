# Lance PariPotes — configure l'email d'envoi une seule fois (invisible pour tes potes)
$envFile = Join-Path $PSScriptRoot ".env"

$reconfigure = $false
if (Test-Path $envFile) {
    Write-Host ""
    Write-Host "Une config email existe deja." -ForegroundColor Yellow
    $answer = Read-Host "Tu veux la reconfigurer ? (o/n)"
    if ($answer -eq "o" -or $answer -eq "O" -or $answer -eq "oui") {
        Remove-Item $envFile -Force
        $reconfigure = $true
    }
}

if (-not (Test-Path $envFile)) {
    Write-Host ""
    Write-Host "=== Premiere utilisation PariPotes ===" -ForegroundColor Green
    Write-Host "Tes potes n'auront rien a configurer." -ForegroundColor Gray
    Write-Host "Toi, une seule fois : l'email qui ENVOIE les codes.`n" -ForegroundColor Gray
    Write-Host "Option 1 (recommandee) : Gmail"
    Write-Host "  -> myaccount.google.com/apppasswords"
    Write-Host "  -> cree un mot de passe d'application`n"
    Write-Host "Option 2 : Brevo (gratuit, brevo.com → cle API)`n"

    $gmail = Read-Host "Email Gmail d'envoi (ex: ton@gmail.com)"
    $pass = Read-Host "Mot de passe d'application Gmail" -AsSecureString
    $passPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pass))
    # Gmail : 16 caracteres sans espaces ni tirets
    $passPlain = ($passPlain -replace '[\s\-]', '')

    $content = @"
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=$gmail
SMTP_PASS=$passPlain
SMTP_FROM=PariPotes <$gmail>
"@
    [System.IO.File]::WriteAllText($envFile, $content, [System.Text.UTF8Encoding]::new($false))

    Write-Host "`nConfig sauvegardee ! Tes potes pourront s'inscrire avec leur email.`n" -ForegroundColor Green
}

# Arrete l'ancien serveur pour charger la nouvelle config
Get-NetTCPConnection -LocalPort 3847 -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Set-Location $PSScriptRoot
Write-Host "Demarrage sur http://localhost:3847`n" -ForegroundColor Green
node index.js