<#
.SYNOPSIS
    Prepara o ambiente de desenvolvimento local do Logos em um unico comando.

.DESCRIPTION
    Verifica os pre-requisitos, cria o ambiente virtual do backend, instala as
    dependencias dos dois lados e gera os arquivos .env a partir dos exemplos.
    E idempotente: rodar de novo nao quebra nada nem sobrescreve o seu .env.

.PARAMETER SkipBackend
    Nao mexe no ambiente Python.

.PARAMETER SkipFrontend
    Nao instala as dependencias do frontend.

.PARAMETER SkipDatabase
    Nao sobe o container do PostgreSQL. O backend/.env passa a apontar para
    SQLite, para o projeto rodar sem container nenhum.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\setup-local.ps1
    powershell -ExecutionPolicy Bypass -File .\scripts\setup-local.ps1 -SkipDatabase

.NOTES
    Salvo em UTF-8 COM BOM para leitura correta no Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
    [switch]$SkipBackend,
    [switch]$SkipFrontend,
    [switch]$SkipDatabase
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot

function Escrever-Passo {
    param([string]$Mensagem)
    Write-Host "`n==> $Mensagem" -ForegroundColor Cyan
}

function Escrever-Ok {
    param([string]$Mensagem)
    Write-Host "    [ok] $Mensagem" -ForegroundColor Green
}

function Escrever-Aviso {
    param([string]$Mensagem)
    Write-Host "    [!] $Mensagem" -ForegroundColor Yellow
}

function Testar-Comando {
    param([string]$Nome)
    return [bool](Get-Command $Nome -ErrorAction SilentlyContinue)
}

# --------------------------------------------------------------------------- #
# 1. Pre-requisitos
# --------------------------------------------------------------------------- #
Escrever-Passo 'Verificando pre-requisitos'

if (-not (Testar-Comando 'python')) {
    throw 'Python nao encontrado no PATH. Instale o Python 3.12 ou superior.'
}
$versaoPython = (& python --version 2>&1) -replace 'Python ', ''
Escrever-Ok "Python $versaoPython"

if (-not $SkipFrontend) {
    if (-not (Testar-Comando 'node')) { throw 'Node.js nao encontrado. Instale o Node 20 ou superior.' }
    if (-not (Testar-Comando 'pnpm')) { throw 'pnpm nao encontrado. Instale com: npm install -g pnpm' }
    Escrever-Ok "Node $(& node --version)"
    Escrever-Ok "pnpm $(& pnpm --version)"
}

# --------------------------------------------------------------------------- #
# 2. Backend
# --------------------------------------------------------------------------- #
if (-not $SkipBackend) {
    Escrever-Passo 'Preparando o backend'

    $pastaBackend = Join-Path $raiz 'backend'
    if (-not (Test-Path $pastaBackend)) {
        throw "Pasta nao encontrada: $pastaBackend"
    }

    $venv = Join-Path $pastaBackend '.venv'
    $pythonVenv = Join-Path $venv 'Scripts\python.exe'

    if (Test-Path $pythonVenv) {
        Escrever-Ok 'Ambiente virtual ja existe'
    }
    else {
        Write-Host '    Criando o ambiente virtual...'
        & python -m venv $venv
        Escrever-Ok 'Ambiente virtual criado'
    }

    Write-Host '    Instalando as dependencias (pode levar um minuto)...'
    & $pythonVenv -m pip install --upgrade pip --quiet
    Push-Location $pastaBackend
    try {
        & $pythonVenv -m pip install -e '.[dev]' --quiet
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar as dependencias do backend.' }
    }
    finally {
        Pop-Location
    }
    Escrever-Ok 'Dependencias do backend instaladas'

    $envExemplo = Join-Path $pastaBackend '.env.example'
    $envReal = Join-Path $pastaBackend '.env'
    if ((Test-Path $envExemplo) -and -not (Test-Path $envReal)) {
        Copy-Item $envExemplo $envReal
        Escrever-Ok 'backend/.env criado a partir do exemplo'
    }
    elseif (Test-Path $envReal) {
        Escrever-Ok 'backend/.env ja existe (preservado)'
    }
}

# --------------------------------------------------------------------------- #
# 3. Frontend
# --------------------------------------------------------------------------- #
if (-not $SkipFrontend) {
    Escrever-Passo 'Preparando o frontend'

    $pastaFrontend = Join-Path $raiz 'frontend'
    if (-not (Test-Path $pastaFrontend)) {
        throw "Pasta nao encontrada: $pastaFrontend"
    }

    $envExemplo = Join-Path $pastaFrontend '.env.example'
    $envReal = Join-Path $pastaFrontend '.env'
    if ((Test-Path $envExemplo) -and -not (Test-Path $envReal)) {
        Copy-Item $envExemplo $envReal
        Escrever-Ok 'frontend/.env criado a partir do exemplo'
    }
    elseif (Test-Path $envReal) {
        Escrever-Ok 'frontend/.env ja existe (preservado)'
    }

    Push-Location $raiz
    try {
        Write-Host '    Instalando as dependencias do workspace (pode levar um minuto)...'
        & pnpm install
        if ($LASTEXITCODE -ne 0) { throw 'Falha no pnpm install.' }
    }
    finally {
        Pop-Location
    }
    Escrever-Ok 'Dependencias do frontend instaladas'
}

# --------------------------------------------------------------------------- #
# 4. Banco de dados
#
# Padrao: PostgreSQL 16 em container, pelo compose.yaml da raiz. E a mesma
# fonte que `pnpm db:up` usa — nada de `podman run` solto, que criava um
# container com outro nome e em outra porta e divergia da documentacao.
# --------------------------------------------------------------------------- #
$envBackend = Join-Path $raiz 'backend\.env'

if ($SkipDatabase) {
    Escrever-Passo 'Banco de dados: SQLite (sem container)'

    if (Test-Path $envBackend) {
        $conteudo = Get-Content $envBackend -Raw
        $conteudo = $conteudo -replace '(?m)^DATABASE_URL=.*$', 'DATABASE_URL=sqlite:///./logos.db'
        [System.IO.File]::WriteAllText($envBackend, $conteudo, (New-Object System.Text.UTF8Encoding($false)))
        Escrever-Ok 'backend/.env apontando para SQLite'
    }
    else {
        Escrever-Aviso 'backend/.env ainda nao existe; rode a etapa do backend primeiro.'
    }
}
else {
    Escrever-Passo 'Banco de dados: PostgreSQL 16 em container'

    if (-not (Testar-Comando 'podman')) {
        Escrever-Aviso 'Podman nao encontrado. Rode de novo com -SkipDatabase para usar SQLite.'
    }
    else {
        $maquinas = (& podman machine list --format '{{.Name}}' 2>&1) -join ''
        if ([string]::IsNullOrWhiteSpace($maquinas)) {
            Write-Host '    Inicializando a maquina virtual do Podman...'
            & podman machine init
        }

        $emExecucao = (& podman machine list --format '{{.Running}}' 2>&1) -join ''
        if ($emExecucao -notmatch 'true') {
            Write-Host '    Iniciando a maquina virtual do Podman (pode levar um minuto)...'
            & podman machine start
        }

        Push-Location $raiz
        try {
            & podman compose up -d db
            if ($LASTEXITCODE -ne 0) {
                throw 'Falha ao subir o container do banco (podman compose up -d db).'
            }
        }
        finally {
            Pop-Location
        }

        Write-Host '    Aguardando o banco ficar saudavel...'
        $saudavel = $false
        for ($i = 1; $i -le 20; $i++) {
            $status = (& podman inspect logos-db --format '{{.State.Health.Status}}' 2>&1) -join ''
            if ($status -match 'healthy') { $saudavel = $true; break }
            Start-Sleep -Seconds 3
        }

        if ($saudavel) {
            Escrever-Ok 'PostgreSQL pronto em localhost:5433 (container logos-db)'
        }
        else {
            Escrever-Aviso 'O banco nao ficou saudavel a tempo. Investigue com: podman compose logs db'
        }
    }
}

# --------------------------------------------------------------------------- #
# 5. Resumo
# --------------------------------------------------------------------------- #
Escrever-Passo 'Ambiente pronto'
Write-Host ''
Write-Host '    Subir o banco:    pnpm db:up' -ForegroundColor White
Write-Host '    Popular o banco:  pnpm seed' -ForegroundColor White
Write-Host '    Subir tudo:       pnpm dev' -ForegroundColor White
Write-Host '    Rodar a suite:    pnpm verify' -ForegroundColor White
Write-Host ''
Write-Host '    API:   http://localhost:8000' -ForegroundColor DarkGray
Write-Host '    Docs:  http://localhost:8000/docs' -ForegroundColor DarkGray
Write-Host '    Web:   http://localhost:5173' -ForegroundColor DarkGray
Write-Host '    Banco: localhost:5433 (container logos-db)' -ForegroundColor DarkGray
Write-Host ''
