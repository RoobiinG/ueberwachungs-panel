#!/bin/bash
set -e

# PANEL_SOURCE wird vom Panel-Backend beim Ausliefern injiziert.
# Fallback: GitHub (nur wenn direkt von GitHub heruntergeladen)
PANEL_SOURCE="${PANEL_SOURCE:-https://raw.githubusercontent.com/RoobiinG/ueberwachungs-panel/master}"
AGENT_PORT="${PANEL_AGENT_PORT:-7331}"
AGENT_TOKEN="${PANEL_AGENT_TOKEN:-$(openssl rand -hex 32 2>/dev/null || tr -dc 'a-f0-9' < /dev/urandom | head -c 64)}"
INSTALL_DIR="/opt/panel-agent"
SERVICE_FILE="/etc/systemd/system/panel-agent.service"

echo "=== Überwachungs-Panel Agent ==="

if [ "$(id -u)" -ne 0 ]; then
  echo "FEHLER: Bitte als root ausführen (sudo bash)" >&2; exit 1
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
    echo "FEHLER: Node.js manuell installieren: https://nodejs.org" >&2; exit 1
  fi
fi
echo "Node.js $(node -v) gefunden"

mkdir -p "$INSTALL_DIR"

# Agent-Script vom Panel laden (oder GitHub als Fallback)
if echo "$PANEL_SOURCE" | grep -qv 'githubusercontent'; then
  echo "Lade Agent-Script vom Panel (${PANEL_SOURCE})..."
  curl -sL "${PANEL_SOURCE}/api/agents/agent-script" -o "$INSTALL_DIR/panel-agent.js"
else
  echo "Lade Agent-Script von GitHub..."
  curl -sL "${PANEL_SOURCE}/agent/panel-agent.js" -o "$INSTALL_DIR/panel-agent.js"
fi

# Prüfen ob Download erfolgreich war
if ! head -1 "$INSTALL_DIR/panel-agent.js" | grep -q '^#'; then
  echo "FEHLER: Download fehlgeschlagen (kein gültiges Script erhalten)" >&2
  cat "$INSTALL_DIR/panel-agent.js" >&2
  exit 1
fi
chmod 755 "$INSTALL_DIR/panel-agent.js"

# TLS-Zertifikat erzeugen (falls noch keines vorhanden)
if [ ! -f "$INSTALL_DIR/cert.pem" ]; then
  echo "Erzeuge selbstsigniertes TLS-Zertifikat..."
  SERVER_IP=$(hostname -I | awk '{print $1}')
  openssl req -x509 -newkey rsa:4096 \
    -keyout "$INSTALL_DIR/key.pem" \
    -out    "$INSTALL_DIR/cert.pem" \
    -days 3650 -nodes \
    -subj "/CN=panel-agent" \
    -addext "subjectAltName=IP:${SERVER_IP},IP:127.0.0.1" \
    2>/dev/null
  chmod 600 "$INSTALL_DIR/key.pem"
  echo "TLS-Zertifikat erstellt (gültig 10 Jahre)"
fi

FINGERPRINT=$(openssl x509 -in "$INSTALL_DIR/cert.pem" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2)

# Env-Datei — bestehenden Token nicht überschreiben
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cat > "$INSTALL_DIR/.env" <<EOF
PANEL_AGENT_PORT=$AGENT_PORT
PANEL_AGENT_TOKEN=$AGENT_TOKEN
EOF
  chmod 600 "$INSTALL_DIR/.env"
else
  echo "Bestehende .env beibehalten"
  AGENT_TOKEN=$(grep PANEL_AGENT_TOKEN "$INSTALL_DIR/.env" | cut -d= -f2-)
  AGENT_PORT=$(grep PANEL_AGENT_PORT  "$INSTALL_DIR/.env" | cut -d= -f2-)
fi

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

# Firewall-Port öffnen (falls UFW aktiv)
if command -v ufw &>/dev/null && ufw status | grep -q "^Status: active"; then
  ufw allow "${AGENT_PORT}/tcp" >/dev/null 2>&1
  echo "UFW: Port ${AGENT_PORT}/tcp geöffnet"
fi

# Firewall-Port öffnen (falls firewalld aktiv, z.B. RHEL/CentOS)
if command -v firewall-cmd &>/dev/null && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-port="${AGENT_PORT}/tcp" >/dev/null 2>&1
  firewall-cmd --reload >/dev/null 2>&1
  echo "firewalld: Port ${AGENT_PORT}/tcp geöffnet"
fi

SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║         Agent erfolgreich installiert! (HTTPS)           ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Im Panel unter 'Server' hinzufügen:                     ║"
echo "║                                                          ║"
echo "║  URL:         https://${SERVER_IP}:${AGENT_PORT}"
echo "║  Token:       ${AGENT_TOKEN:0:48}"
echo "║  Fingerprint: ${FINGERPRINT}"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Status:  systemctl status panel-agent"
echo "Logs:    journalctl -u panel-agent -f"
echo ""
echo "WICHTIG: Falls eine Cloud-Firewall (Hetzner, AWS, etc.) aktiv ist,"
echo "         TCP-Port ${AGENT_PORT} in der Cloud-Konsole freigeben!"
echo "Lokal testen:  curl -k https://127.0.0.1:${AGENT_PORT}/ping"
