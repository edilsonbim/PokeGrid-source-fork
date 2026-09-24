@echo off
setlocal EnableExtensions

if /i "%~1"=="--executar-temp" goto :atualizar

rem Executa uma copia temporaria para o proprio ATUALIZAR.bat poder ser substituido.
rem O ponto remove a barra final, evitando que ela prenda a aspas ao chamar a copia.
for %%I in ("%~dp0.") do set "PG_ALVO=%%~fI"
set "PG_RUNNER=%TEMP%\pokegrid-leo-atualizar-%RANDOM%-%RANDOM%.bat"
copy /y "%~f0" "%PG_RUNNER%" >nul
if errorlevel 1 (
  echo Nao foi possivel preparar o atualizador.
  pause
  exit /b 1
)
call "%PG_RUNNER%" --executar-temp "%PG_ALVO%"
set "PG_RESULTADO=%ERRORLEVEL%"
del /q "%PG_RUNNER%" >nul 2>nul
exit /b %PG_RESULTADO%

:atualizar
title Atualizar PokeGrid Leo
for %%I in ("%~2\.") do set "PG_ALVO=%%~fI"
cd /d "%PG_ALVO%"

echo ========================================
echo       ATUALIZADOR POKEGRID LEO
echo ========================================
echo.
echo Baixando a versao mais recente do seu GitHub...

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERRO: O PowerShell do Windows nao foi encontrado.
  goto :erro
)

set "PG_ZIP=%TEMP%\pokegrid-leo-%RANDOM%-%RANDOM%.zip"
set "PG_TMP=%TEMP%\pokegrid-leo-%RANDOM%-%RANDOM%"
set "PG_FONTE_TXT=%TEMP%\pokegrid-leo-fonte-%RANDOM%-%RANDOM%.txt"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';" ^
  "Invoke-WebRequest -UseBasicParsing 'https://github.com/edilsonbim/PokeGrid-custom/archive/refs/heads/main.zip' -OutFile $env:PG_ZIP;" ^
  "Expand-Archive -LiteralPath $env:PG_ZIP -DestinationPath $env:PG_TMP -Force;" ^
  "$src=(Get-ChildItem -LiteralPath $env:PG_TMP -Directory | Select-Object -First 1).FullName;" ^
  "if(-not $src){throw 'Conteudo da atualizacao nao encontrado'};" ^
  "Set-Content -LiteralPath $env:PG_FONTE_TXT -Value $src -Encoding ASCII"
if errorlevel 1 goto :erro

set /p "PG_FONTE="<"%PG_FONTE_TXT%"
if not defined PG_FONTE goto :erro
if not exist "%PG_FONTE%\package.json" goto :erro

echo.
echo Substituindo os arquivos pela versao do GitHub...
rem .git, node_modules, dados gerados e arquivos locais sao preservados.
rem O atualizador interno do app e o caminho recomendado por oferecer backup e rollback.
robocopy "%PG_FONTE%" "%PG_ALVO%" /E /COPY:DAT /R:2 /W:1 /XD ".git" "node_modules" ".tmp" "outputs" /NFL /NDL /NJH /NJS /NP
if errorlevel 8 goto :erro

echo.
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo AVISO: Node.js nao foi encontrado. Os arquivos foram atualizados,
  echo mas as dependencias existentes foram mantidas.
  goto :limpar_sucesso
)

echo Atualizando as dependencias...
call npm.cmd install
if errorlevel 1 goto :erro

:limpar_sucesso
if exist "%PG_TMP%" rmdir /s /q "%PG_TMP%"
if exist "%PG_ZIP%" del /q "%PG_ZIP%"
if exist "%PG_FONTE_TXT%" del /q "%PG_FONTE_TXT%"
echo.
echo ========================================
echo   ATUALIZACAO CONCLUIDA COM SUCESSO!
echo ========================================
echo Voce ja pode abrir o PokeGrid.
pause
exit /b 0

:erro
if defined PG_TMP if exist "%PG_TMP%" rmdir /s /q "%PG_TMP%"
if defined PG_ZIP if exist "%PG_ZIP%" del /q "%PG_ZIP%"
if defined PG_FONTE_TXT if exist "%PG_FONTE_TXT%" del /q "%PG_FONTE_TXT%"
echo.
echo ========================================
echo        A ATUALIZACAO FALHOU
echo ========================================
echo Confira sua internet e tente novamente.
pause
exit /b 1
