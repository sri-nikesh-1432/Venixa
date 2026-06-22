@echo off
cd /d "%~dp0"
echo Starting Venixa backend on http://127.0.0.1:8000
python -m uvicorn app:app --reload --host 127.0.0.1 --port 8000
