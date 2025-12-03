#!/bin/bash
# SHLF Monorepo - Digital Ocean Setup Script
# Run this on your Digital Ocean droplet

set -e

echo "=== SHLF Monorepo Setup ==="

# Install Node.js 20 (if not present)
if ! command -v node &> /dev/null; then
    echo "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install pnpm
if ! command -v pnpm &> /dev/null; then
    echo "Installing pnpm..."
    npm install -g pnpm
fi

# Install PM2
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
fi

# Install dependencies
echo "Installing dependencies..."
pnpm install

# Setup PM2 to start on boot
echo "Setting up PM2 startup..."
pm2 startup systemd -u $USER --hp $HOME

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Create .env files in each project folder"
echo "2. Run: pm2 start ecosystem.config.js"
echo "3. Run: pm2 save"
echo "4. Configure Nginx with deploy/nginx.conf"
echo "5. Setup SSL with: sudo certbot --nginx"
echo ""
