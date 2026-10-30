$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $studioRoot
if (!(Test-Path -LiteralPath '.venv/Scripts/python.exe')) { throw '请按 README 创建 Python 环境并安装依赖。' }
if (!(Test-Path -LiteralPath 'frontend/dist/index.html')) { throw '请先执行 npm --prefix frontend ci 和 npm --prefix frontend run build。' }
if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw '请安装 Node.js 22.19 或更新版本。' }
if (!(Test-Path -LiteralPath 'agent-runtime/node_modules/@earendil-works/pi-agent-core')) { throw '请先执行 npm --prefix agent-runtime ci。' }
& '.venv/Scripts/python.exe' -m uvicorn app:app --app-dir backend --host 127.0.0.1 --port 19001
