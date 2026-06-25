@echo off
chcp 65001 >nul 2>&1
title 抓耳挠腮剧本制作 - Web 启动器

echo.
echo  ╔══════════════════════════════════════╗
echo  ║   🎭 抓耳挠腮剧本制作 - Web 版 🎭   ║
echo  ╚══════════════════════════════════════╝
echo.

cd /d "%~dp0"

echo  🚀 启动 API 后端 + Vite 前端 (同一窗口)...
echo.
echo  🌐 浏览器打开: http://localhost:5174
echo  📡 API 后端: http://localhost:9000/api
echo  🛑 按 Ctrl+C 停止所有服务
echo.

npx concurrently --names "API,VITE" --prefix-colors "cyan,green" "node server.mjs" "npx vite --port 5174"
