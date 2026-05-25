#!/bin/bash
set -e

REPO="https://raw.githubusercontent.com/RoobiinG/ueberwachungs-panel/master"
AGENT_PORT="${PANEL_AGENT_PORT:-7331}"
AGENT_TOKEN="${PANEL_AGENT_TOKEN:-$(openssl rand -hex 32 2>/dev/null || tr -dc 'a-f0-9' < /dev/urandom | head -c 64)}"
INSTALL_DIR="/opt/panel-agent"
SERVICE_FILE="/etc/systemd/system/panel-agent.service"

echo "=== Überwachungs-Panel Agent ==="

# Root-Check
if [ "$(id -u)" -ne 0 ]; then
  echo "FEHLER: Bitte als root ausführen (sudo bash)" >&2
  exit 1
fi

# Node.js prüfen / installieren
if ! command -v node &>/dev/null; then
  echo "Node.js nicht gefunden — installiere Node.js 20..."
  if command -v apt &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
  elif command -v dnf &>/dev/null; then
    dnf module install -y nodejs:20
  elif command -v yum &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum install -y nodejs
  else
    echo "FEHLER: Node.js manuell installieren: https://nodejs.org" >&2
    exit 1
  fi
fi

echo "Node.js $(node -v) gefunden"

# Agent herunterladen
mkdir -p "$INSTALL_DIR"
curl -sL "$REPO/agent/panel-agent.js" -o "$INSTALL_DIR/panel-agent.js"
chmod 755 "$INSTALL_DIR/panel-agent.js"

# Env-Datei — bestehenden Token nicht überschreiben
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cat > "$INSTALL_DIR/.env" <<EOF
PANEL_AGENT_PORT=$AGENT_PORT
PANEL_AGENT_TOKEN=$AGENT_TOKEN
EOF
  chmod 600 "$INSTALL_DIR/.env"
else
  echo "Bestehende .env beibehalten (Token unverändert)"
  AGENT_TOKEN=$(grep PANEL_AGENT_TOKEN "$INSTALL_DIR/.env" | cut -d= -f2)
  AGENT_PORT=$(grep PANEL_AGENT_PORT "$INSTALL_DIR/.env" | cut -d= -f2)
fi

# Systemd-Service
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Überwachungs-Panel Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$(command -v node) $INSTALL_DIR/panel-agent.js
Restart=always
RestartSec=5
User=root
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now panel-agent

echo ""
echo "✓ Agent erfolgreich installiert!"
echo ""
echo "Im Panel unter 'Server' hinzufügen:"
echo "  Name:  $(hostname)"
echo "  URL:   http://$(hostname -I | awk '{print $1}'):$AGENT_PORT"
echo "  Token: $AGENT_TOKEN"
echo ""
echo "Status prüfen: systemctl status panel-agent"
echo "Logs anzeigen: journalctl -u panel-agent -f"
