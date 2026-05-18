@echo off
title Start StudyFlow All Servers

set ROOT=C:\Users\obaid\Downloads\studyflow\studyflow
set FRONTEND=%ROOT%\frontend
set PDF_RAG=%ROOT%\ai-service\pdf-rag-backend
set SUMMARY=%ROOT%\summary_service
set VENV=%ROOT%\.venv\Scripts\Activate.ps1

echo Closing old ports if they are busy...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=8000,8002,8010,5173; foreach ($p in $ports) { $lines = netstat -ano | Select-String (':' + $p); foreach ($line in $lines) { $parts = ($line.ToString() -split '\s+') | Where-Object { $_ }; $pidValue = $parts[-1]; if ($pidValue -match '^\d+$') { Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue } } }"

echo.
echo Starting StudyFlow servers...

start "Laravel Backend - 8000" powershell -NoExit -ExecutionPolicy Bypass -Command "cd '%ROOT%'; php artisan optimize:clear; php artisan serve --host=127.0.0.1 --port=8000"

start "React Frontend - 5173" powershell -NoExit -ExecutionPolicy Bypass -Command "cd '%FRONTEND%'; npm run dev"

start "Ollama - 11434" powershell -NoExit -ExecutionPolicy Bypass -Command "if (Test-NetConnection 127.0.0.1 -Port 11434 -InformationLevel Quiet) { Write-Host 'Ollama is already running on 11434.'; pause } else { ollama serve }"

start "PDF RAG Backend - Ask + Quiz - 8010" powershell -NoExit -ExecutionPolicy Bypass -Command "cd '%PDF_RAG%'; . '%VENV%'; $env:OLLAMA_HOST='http://127.0.0.1:11434'; $env:OLLAMA_MODEL='llama3.2:3b'; python -m uvicorn main:app --reload --host 127.0.0.1 --port 8010"

start "Summary Service - 8002" powershell -NoExit -ExecutionPolicy Bypass -Command "if (Test-Path '%SUMMARY%') { cd '%SUMMARY%'; . '%VENV%'; $env:OLLAMA_HOST='http://127.0.0.1:11434'; $env:OLLAMA_MODEL='llama3.2:3b'; uvicorn main:app --reload --host 127.0.0.1 --port 8002 } else { Write-Host 'summary_service folder not found, skipped.'; pause }"

echo.
echo All servers are starting...
echo.
echo React:        http://localhost:5173
echo Laravel:      http://127.0.0.1:8000
echo PDF RAG:      http://127.0.0.1:8010
echo Summary:      http://127.0.0.1:8002
echo Ollama:       http://127.0.0.1:11434
echo.
echo Do NOT close the PowerShell windows while working.
echo.

timeout /t 15 /nobreak
start "" "http://localhost:5173"

pause