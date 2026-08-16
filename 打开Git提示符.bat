@echo off
chcp 65001 >nul
cd /d "D:\haowanyouxi\Canton\CPTOND-2025\Guangzhou"
set "PATH=C:\Users\Ranger\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git\cmd;%PATH%"
echo.
echo 已打开项目目录，git 命令可以直接使用。
echo 试试：git status    git log --oneline
echo.
cmd /k
