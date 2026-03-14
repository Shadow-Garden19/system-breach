# Script pour créer le depot GitHub et pousser le code
# Utilisation : .\push-to-github.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Verifier que gh est connecte
$auth = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Tu n'es pas connecte a GitHub." -ForegroundColor Yellow
    Write-Host "Lance dans un terminal : gh auth login --web" -ForegroundColor Cyan
    Write-Host "Puis ouvre l'URL affichee et entre le code." -ForegroundColor Cyan
    exit 1
}

# Creer le depot et pousser
Write-Host "Creation du depot 'system-breach' sur GitHub et envoi du code..." -ForegroundColor Green
gh repo create system-breach --public --source=. --remote=origin --push --description "SYSTEM BREACH - Jeu 5x5 virus / multiplicateurs / cash out"

if ($LASTEXITCODE -eq 0) {
    $repoUrl = gh repo view --json url -q .url
    Write-Host "`nTermine ! Ton projet est en ligne :" -ForegroundColor Green
    Write-Host $repoUrl -ForegroundColor Cyan
} else {
    Write-Host "Erreur. Si le depot existe deja, ajoute le remote et pousse :" -ForegroundColor Yellow
    Write-Host "  git remote add origin https://github.com/TON_USERNAME/system-breach.git" -ForegroundColor Gray
    Write-Host "  git push -u origin main" -ForegroundColor Gray
    exit 1
}
