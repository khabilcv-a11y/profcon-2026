@echo off
cd /d "%~dp0"
git add -A
git commit -m "Update PROFCON app" || echo Nothing new to commit
git push
pause
