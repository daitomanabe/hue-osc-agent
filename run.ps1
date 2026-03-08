# Hue OSC Agent - Setup & Launch (Windows/PowerShell)

Write-Host "=================================================="
Write-Host "  Hue OSC Agent - Setup & Launch"
Write-Host "=================================================="
Write-Host ""

# 1. Check Node.js
Write-Host "📋 Checking Node.js..."
try {
    $nodeVersion = node -v
    Write-Host "✓ Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Node.js not found. Please install Node.js 18+" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 2. Install dependencies
Write-Host "📦 Installing dependencies..."
if (-not (Test-Path "node_modules")) {
    npm install --silent
    Write-Host "✓ Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "✓ Dependencies already installed" -ForegroundColor Green
}
Write-Host ""

# 3. Build TypeScript
Write-Host "🔨 Building TypeScript..."
npm run build --silent
Write-Host "✓ Build complete" -ForegroundColor Green
Write-Host ""

# 4. Check/create CONFIG.yaml
Write-Host "⚙️  Configuration setup..."
if (-not (Test-Path "CONFIG.yaml")) {
    Write-Host "⚠ CONFIG.yaml not found, creating from example..." -ForegroundColor Yellow
    Copy-Item CONFIG.example.yaml CONFIG.yaml
    Write-Host "ℹ Edit CONFIG.yaml with your bridge IP and area ID" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Required settings:"
    Write-Host "    bridge.ip: <Your Hue Bridge IP>"
    Write-Host "    bridge.entertainment_area_id: <area-id>"
    Write-Host ""

    $response = Read-Host "Press Enter to edit CONFIG.yaml now (or type 'skip' to skip)"
    if ($response -ne "skip") {
        notepad CONFIG.yaml
    }
} else {
    Write-Host "✓ CONFIG.yaml found" -ForegroundColor Green
}
Write-Host ""

# 5. Check HUE_APP_KEY
Write-Host "🔐 Authentication setup..."
if ([string]::IsNullOrEmpty($env:HUE_APP_KEY)) {
    Write-Host "⚠ HUE_APP_KEY environment variable not set" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To obtain an app key:"
    Write-Host "  1. Press the Link button on your Hue Bridge"
    Write-Host "  2. Run within 30 seconds (PowerShell):"
    Write-Host ""
    Write-Host '    $bridge_ip = "<BRIDGE_IP>"' -ForegroundColor Cyan
    Write-Host '    $body = @{devicetype = "hue-osc-agent"} | ConvertTo-Json' -ForegroundColor Cyan
    Write-Host '    curl.exe -X POST "https://$bridge_ip/api" -d $body -k' -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Then set the environment variable:"
    Write-Host "    `$env:HUE_APP_KEY = '<your-app-key>'" -ForegroundColor Cyan
    Write-Host ""

    $appKey = Read-Host "Enter HUE_APP_KEY"
    if ([string]::IsNullOrEmpty($appKey)) {
        Write-Host "✗ HUE_APP_KEY is required" -ForegroundColor Red
        exit 1
    }
    $env:HUE_APP_KEY = $appKey
} else {
    Write-Host "✓ HUE_APP_KEY set" -ForegroundColor Green
}
Write-Host ""

# 6. Show launch options
Write-Host "🚀 Launch Options:"
Write-Host ""
Write-Host "  Standard (recommended):"
Write-Host "    npm start" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Offline testing with simulator:"
Write-Host "    `$env:SIMULATE_OSC = '1'; npm start" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Replay recorded session:"
Write-Host "    `$env:REPLAY_OSC = 'sessions/my-session.json'; npm start" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Debug logging:"
Write-Host "    `$env:LOG_LEVEL = 'debug'; npm start" -ForegroundColor Cyan
Write-Host ""
Write-Host "=================================================="
Write-Host "  Starting Hue OSC Agent..."
Write-Host "=================================================="
Write-Host ""

# 7. Launch
npm start
