@echo off
rem Abre o PokeGrid sem depender do VBS. O VBS antigo continua disponivel para atalhos existentes.
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  where npm >nul 2>nul || (
    echo O Node.js nao esta instalado. Baixe a versao LTS em https://nodejs.org
    pause
    exit /b
  )
  if not exist "node_modules\electron\package.json" (
    echo Primeira vez: instalando o necessario. Aguarde...
    call npm install --no-audit --no-fund
  )
  echo Baixando o Electron, cerca de 100 MB. Nao feche esta janela...
  node -e "require('electron')"
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo A instalacao nao terminou. Confira a internet e abra este arquivo de novo.
  pause
  exit /b
)
start "" "node_modules\electron\dist\electron.exe" .
