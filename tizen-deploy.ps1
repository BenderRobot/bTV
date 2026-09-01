<#
.SYNOPSIS
    Build, signe, installe et lance l'app bTV sur une TV/emulateur Tizen,
    puis push automatiquement les modifications sur le repo GitHub.

.EXAMPLE
    .\tizen-deploy.ps1
    Effectue le deploiement complet puis demande le message de commit Git.

.EXAMPLE
    .\tizen-deploy.ps1 -TvIp 192.168.1.50
    Connecte la TV via sdb avant de builder, installer et pusher.
#>

[CmdletBinding()]
param(
    [string]$TizenHome = "C:\tizen-studio",
    [string]$ProjectPath,
    [string]$SigningProfile = "myiptv_cert",
    [string]$TvIp,
    [string]$TargetSerial,
    [switch]$SkipBuild,
    [switch]$SkipInstall,
    [switch]$SkipRun,
    [switch]$ListDevices
)

$ErrorActionPreference = "Stop"

if (-not $ProjectPath) {
    $ProjectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$tizenCli = Join-Path $TizenHome "tools\ide\bin\tizen.bat"
$sdb = Join-Path $TizenHome "tools\sdb.exe"

if (-not (Test-Path $tizenCli)) {
    throw "tizen.bat introuvable a '$tizenCli'. Verifie -TizenHome (ou l'installation de Tizen Studio)."
}
if (-not (Test-Path $sdb)) {
    throw "sdb.exe introuvable a '$sdb'. Verifie -TizenHome."
}
if (-not (Test-Path (Join-Path $ProjectPath "config.xml"))) {
    throw "config.xml introuvable dans '$ProjectPath'. Passe -ProjectPath si le script n'est pas a la racine du projet."
}

function Get-TizenAppId {
    $configPath = Join-Path $ProjectPath "config.xml"
    [xml]$xml = Get-Content $configPath
    $ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
    $ns.AddNamespace("tizen", "http://tizen.org/ns/widgets")
    $node = $xml.SelectSingleNode("//tizen:application", $ns)
    if (-not $node) {
        throw "Impossible de lire tizen:application/@id dans config.xml"
    }
    return $node.id
}

$stateFile = Join-Path $ProjectPath ".tizen-deploy-state.json"

function Get-SavedTvIp {
    if (-not (Test-Path $stateFile)) { return $null }
    try { return (Get-Content $stateFile -Raw | ConvertFrom-Json).lastTvIp } catch { return $null }
}

function Save-TvIp([string]$ip) {
    try { @{ lastTvIp = $ip } | ConvertTo-Json | Set-Content $stateFile -Encoding utf8 } catch {}
}

function Get-DevicesRaw { & $sdb devices }

function Get-ReadySerial {
    $lines = @(Get-DevicesRaw | Where-Object { $_ -match '^\S+\s+device(\s|$)' })
    if ($lines.Count -eq 0) { return $null }
    return ($lines[0] -split "\s+")[0]
}

function Get-OfflineSerial {
    $lines = @(Get-DevicesRaw | Where-Object { $_ -match '^\S+\s+offline(\s|$)' })
    if ($lines.Count -eq 0) { return $null }
    return ($lines[0] -split "\s+")[0]
}

function Auto-PushGit {
    Write-Host "`n=== Push Git Automatique (GitHub) ===" -ForegroundColor Cyan
    Push-Location $ProjectPath
    try {
        git --version | Out-Null
        
        $status = git status --porcelain
        if (-not $status) {
            Write-Host "Aucune modification a commiter sur Git." -ForegroundColor Yellow
            return
        }

        # Demande du message de commit avec fallback automatique horodate
        $timestamp = Get-Date -Format "dd/MM/yyyy HH:mm"
        $defaultMessage = "Auto-push bTV - $timestamp"
        
        Write-Host "Entre le message de commit (ou appuie sur Entree pour : '$defaultMessage') :" -ForegroundColor Yellow
        $userInput = Read-Host "Message"

        $commitMsg = if ([string]::IsNullOrWhiteSpace($userInput)) { $defaultMessage } else { $userInput }

        Write-Host "`nAjout des fichiers..." -ForegroundColor Cyan
        git add .

        Write-Host "Commit : '$commitMsg'..." -ForegroundColor Cyan
        git commit -m "$commitMsg"

        Write-Host "Push vers GitHub..." -ForegroundColor Cyan
        $currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
        $hasUpstream = git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $hasUpstream) {
            git push -u origin $currentBranch
        } else {
            git push
        }
        
        Write-Host "Push GitHub effectue avec succes !" -ForegroundColor Green
    }
    catch {
        Write-Host "Erreur lors du push Git : $_" -ForegroundColor Red
    }
    finally {
        Pop-Location
    }
}

# --- Detection / reconnexion de la TV ---
Write-Host "Verification de la connexion a la TV..." -ForegroundColor Cyan

if ($TvIp) {
    Write-Host "Connexion a $TvIp..." -ForegroundColor Cyan
    & $sdb connect $TvIp | Out-Null
    Start-Sleep -Seconds 2
}

$readySerial = Get-ReadySerial
if ($readySerial -and $readySerial.Length -lt 4) {
    Start-Sleep -Seconds 1
    $readySerial = Get-ReadySerial
}

if (-not $readySerial) {
    $offline = Get-OfflineSerial
    if ($offline) {
        Write-Host "Appareil '$offline' hors-ligne, tentative de reconnexion..." -ForegroundColor Yellow
        & $sdb disconnect $offline | Out-Null
        Start-Sleep -Seconds 1
        & $sdb connect $offline | Out-Null
        Start-Sleep -Seconds 2
        $readySerial = Get-ReadySerial
    }
}

if (-not $readySerial -and -not $TvIp) {
    $savedIp = Get-SavedTvIp
    if ($savedIp) {
        Write-Host "Aucun appareil connecte, nouvelle tentative avec la derniere IP connue ($savedIp)..." -ForegroundColor Yellow
        & $sdb connect $savedIp | Out-Null
        Start-Sleep -Seconds 2
        $readySerial = Get-ReadySerial
    }
}

Write-Host "Appareils connectes :" -ForegroundColor Cyan
Get-DevicesRaw | ForEach-Object { Write-Host "  $_" }

if ($readySerial -match '^(\d{1,3}(\.\d{1,3}){3}):\d+$') {
    Save-TvIp $Matches[1]
} elseif ($TvIp) {
    Save-TvIp $TvIp
}

if ($ListDevices) {
    return
}

if (-not $readySerial -and -not $TargetSerial) {
    throw "Aucune TV Tizen prete (etat 'device') detectee. Verifie que la TV est allumee, en mode developpeur, sur le meme reseau, puis relance avec -TvIp <ip>."
}

if (-not $TargetSerial) {
    $TargetSerial = $readySerial
    if ($TargetSerial.Length -lt 4) {
        throw "Serial detecte suspect ('$TargetSerial'). Verifie manuellement avec '$sdb devices' et repasse avec -TargetSerial <serial>."
    }
    Write-Host "Cible auto-selectionnee : $TargetSerial" -ForegroundColor Yellow
}

$buildResultPath = Join-Path $ProjectPath ".buildResult"

if (-not $SkipBuild) {
    Write-Host "`n=== Build web ===" -ForegroundColor Cyan
    & $tizenCli build-web -- "$ProjectPath"
    if ($LASTEXITCODE -ne 0) { throw "Echec du build-web (code $LASTEXITCODE)" }

    Write-Host "`n=== Packaging + signature (profil '$SigningProfile') ===" -ForegroundColor Cyan
    & $tizenCli package -t wgt -s $SigningProfile -- "$buildResultPath"
    if ($LASTEXITCODE -ne 0) { throw "Echec du packaging/signature (code $LASTEXITCODE)" }
}

$wgtFile = Get-ChildItem -Path $buildResultPath -Filter "*.wgt" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $wgtFile) {
    throw "Aucun fichier .wgt trouve dans '$buildResultPath'."
}
Write-Host "Package genere : $($wgtFile.FullName)" -ForegroundColor Green

if (-not $SkipInstall) {
    Write-Host "`n=== Installation sur $TargetSerial ===" -ForegroundColor Cyan
    & $tizenCli install -n "$($wgtFile.FullName)" -s $TargetSerial
    if ($LASTEXITCODE -ne 0) { throw "Echec de l'installation (code $LASTEXITCODE)" }
}

if (-not $SkipRun) {
    $appId = Get-TizenAppId
    Write-Host "`n=== Lancement de $appId sur $TargetSerial ===" -ForegroundColor Cyan
    & $tizenCli run -p $appId -s $TargetSerial
    if ($LASTEXITCODE -ne 0) { throw "Echec du lancement (code $LASTEXITCODE)" }
}

# --- Étape finale : Push Git systématique ---
Auto-PushGit

Write-Host "`nTermine." -ForegroundColor Green