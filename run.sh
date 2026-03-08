#!/bin/bash

set -e

echo "=================================================="
echo "  Hue OSC Agent - Setup & Launch"
echo "=================================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Check Node.js
echo "📋 Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js not found. Please install Node.js 18+${NC}"
    exit 1
fi
NODE_VERSION=$(node -v)
echo -e "${GREEN}✓ Node.js ${NODE_VERSION}${NC}"
echo ""

# 2. Install dependencies
echo "📦 Installing dependencies..."
if [ ! -d "node_modules" ]; then
    npm install --silent
    echo -e "${GREEN}✓ Dependencies installed${NC}"
else
    echo -e "${GREEN}✓ Dependencies already installed${NC}"
fi
echo ""

# 3. Build TypeScript
echo "🔨 Building TypeScript..."
npm run build --silent
echo -e "${GREEN}✓ Build complete${NC}"
echo ""

# 4. Check/create CONFIG.yaml
echo "⚙️  Configuration setup..."
if [ ! -f "CONFIG.yaml" ]; then
    echo -e "${YELLOW}⚠ CONFIG.yaml not found, creating from example...${NC}"
    cp CONFIG.example.yaml CONFIG.yaml
    echo -e "${YELLOW}ℹ Edit CONFIG.yaml with your bridge IP and area ID${NC}"
    echo ""
    echo "  Required settings:"
    echo "    bridge.ip: <Your Hue Bridge IP>"
    echo "    bridge.entertainment_area_id: <area-id>"
    echo ""
    read -p "Press Enter to edit CONFIG.yaml now (or Ctrl+C to skip)..."

    # Try to open in default editor
    if [ -n "$EDITOR" ]; then
        $EDITOR CONFIG.yaml
    elif command -v nano &> /dev/null; then
        nano CONFIG.yaml
    elif command -v vim &> /dev/null; then
        vim CONFIG.yaml
    else
        echo -e "${YELLOW}ℹ Please edit CONFIG.yaml manually${NC}"
    fi
else
    echo -e "${GREEN}✓ CONFIG.yaml found${NC}"
fi
echo ""

# 5. Check HUE_APP_KEY
echo "🔐 Authentication setup..."
if [ -z "$HUE_APP_KEY" ]; then
    echo -e "${YELLOW}⚠ HUE_APP_KEY environment variable not set${NC}"
    echo ""
    echo "To obtain an app key:"
    echo "  1. Press the Link button on your Hue Bridge"
    echo "  2. Run within 30 seconds:"
    echo ""
    echo "    curl -X POST https://<BRIDGE_IP>/api \\\\
  -d '{\"devicetype\": \"hue-osc-agent\"}' \\\\
  -k --insecure"
    echo ""
    echo "Then export the returned 'username' as HUE_APP_KEY:"
    echo "    export HUE_APP_KEY=<your-app-key>"
    echo ""
    read -p "Enter HUE_APP_KEY (or press Ctrl+C to exit): " APP_KEY
    if [ -z "$APP_KEY" ]; then
        echo -e "${RED}✗ HUE_APP_KEY is required${NC}"
        exit 1
    fi
    export HUE_APP_KEY="$APP_KEY"
else
    echo -e "${GREEN}✓ HUE_APP_KEY set${NC}"
fi
echo ""

# 6. Show launch options
echo "🚀 Launch Options:"
echo ""
echo "  Standard (recommended):"
echo "    npm start"
echo ""
echo "  Offline testing with simulator:"
echo "    SIMULATE_OSC=1 npm start"
echo ""
echo "  Replay recorded session:"
echo "    REPLAY_OSC=sessions/my-session.json npm start"
echo ""
echo "  Debug logging:"
echo "    LOG_LEVEL=debug npm start"
echo ""
echo "=================================================="
echo "  Starting Hue OSC Agent..."
echo "=================================================="
echo ""

# 7. Launch
npm start
