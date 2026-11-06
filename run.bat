@echo off
rem Chay AI Web Agency.
rem   run        -> server that, cong 8000 (can API key trong .env)
rem   run demo   -> che do demo, agent gia lap, cong 8001 (khong ton tien)
cd /d "%~dp0"
if /i "%1"=="demo" (
  set AGENCY_DEMO=1
  echo Che do demo: http://127.0.0.1:8001
  .venv\Scripts\python -m uvicorn backend.main:app --port 8001
) else (
  echo AI Web Agency: http://127.0.0.1:8000
  .venv\Scripts\python -m uvicorn backend.main:app --port 8000
)
