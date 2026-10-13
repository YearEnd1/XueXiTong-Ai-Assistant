@echo off
rem 一键本地测试：启动静态服务器，并用 host 映射让扩展把本页当作学习通答题页
cd /d %~dp0
start "" cmd /c "node serve.js & pause"
set EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
if not exist "%EDGE%" set EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe
start "" "%EDGE%" --user-data-dir="%TEMP%\edge-cq-test" --host-resolver-rules="MAP mooc1.chaoxing.com 127.0.0.1" http://mooc1.chaoxing.com:8000/mock-chaoxing.html