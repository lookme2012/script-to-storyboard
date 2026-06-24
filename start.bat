@echo off
chcp 65001 >nul 2>&1
title 抓耳挠腮剧本制作 - 启动器

echo.
echo  ╔══════════════════════════════════════╗
echo  ║   🎭 抓耳挠腮剧本制作 - 启动器 🎭   ║
echo  ╚══════════════════════════════════════╝
echo.

cd /d "%~dp0"

echo [1/2] 启动 Vite 前端服务器...
start "Vite Dev Server" cmd /k "npx vite --port 5173"

echo [2/2] 等待 Vite 就绪 (5秒)...
timeout /t 5 /nobreak >nul

echo [3/2] 启动 Electron 主进程...
set VITE_DEV_SERVER_URL=http://localhost:5173
npx electron .

echo.
echo 应用已退出。
pause
