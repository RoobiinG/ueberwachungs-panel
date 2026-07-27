# 📜 Überwachungs-Panel — Update-Log & Release-Historie (CHANGELOG)

Alle Änderungen, neue Module, Bugfixes und das **Nachwirken (System-Auswirkungen & Kompatibilität)** werden hier fortlaufend protokolliert.

---

## [1.48.0] - 2026-07-27 (Build 250) — *Docker Auto-Update & Robust 2FA*

### ✨ Neue Funktionen & Features
- **Automatischer Panel-Updater für Docker-Container & Git (`POST /api/update/run`)**:
  - **Docker-Support**: Erkennt automatisch, wenn kein `.git`-Verzeichnis vorhanden ist (z. B. im Docker-Image `ghcr.io/roobiing/ueberwachungs-panel:latest`) und führt über `nsenter` auf dem Host automatisch `docker pull` und `docker compose up -d --force-recreate` bzw. `docker restart` aus.
  - **Git-Support**: Für Git-Installationen wird weiterhin `git pull` ausgeführt.
  - `git` und `curl` sind ab sofort im finalen Docker-Image vorinstalliert (`Dockerfile`).
  - Automatischer Server-Neustart (`process.exit(0)`) nach dem Pull für eine unterbrechungsfreie Aktualisierung.
- **Update-Log Modal (`UpdateLogModal.jsx`)**:
  - Nach einem automatischen Update lädt der Browser die Seite neu und zeigt ein interaktives Modal-Fenster mit dem Changelog und den System-Auswirkungen an.
- **GitHub-Token Erklärung & Anleitung (`Settings.jsx`)**:
  - Schritt-für-Schritt-Anleitung in der Karte *GitHub Update-Token*, wie ein Fine-Grained Personal Access Token auf GitHub mit `Contents` (Read-only) und `Metadata` (Read-only) für das private Repository erstellt wird.

### 🔒 Sicherheit & 2FA (Build 247 Integration)
- **Zwei-Faktor-Authentifizierung (2FA / MFA)** für alle Konten verfügbar:
  - **Authenticator-App (TOTP / RFC 6238)**: Zero-Dependency QR-Code-Generator (`qr.js`) liefert reines SVG, Verifikation offline via HMAC-SHA1 (`totp.js`).
  - **E-Mail-2FA**: Versendet einen temporären 6-stelligen Bestätigungscode per SMTP (10 Minuten gültig).
  - Zweistufiger Login-Prozess mit geschütztem Zwischen-JWT (`tempToken`).

### 🐛 Bugfixes & Optimierungen
- **E-Mail-2FA Bestätigungscode (`/api/auth/2fa/enable` & `/login/2fa`)**: Gültigkeitsdauer auf 20 Minuten erhöht, toleranter String/Trim-Vergleich, präzise Fehlermeldungen und Konsolen-Logging für generierte E-Mail-Codes.
- **Docker Auto-Updater Bugfix (`/bin/sh: git: not found`)**: Erkennung von Docker-Umgebungen ohne `.git`-Verzeichnis in `update.js` — führt stattdessen ein Docker Image Update per `nsenter` auf dem Host aus.
- **ReferenceError Behebung**: Fehler beim Löschen externer Token oder nach Einstellungs-Änderungen (`load is not defined` → Nutzung von `loadAdmin`) in `Settings.jsx` behoben.
- **IP-Kopierfunktion für Server**: Bei Hetzner Cloud API und MC-Host24 können IPs nun direkt mit visuellem Klick-Feedback (`✓ Kopiert`) kopiert werden.
- **Webhook-Konfiguration in Benachrichtigungen**: Schneller Absprung über „Webhooks als Einstellung“-Button in `Alerts.jsx`.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migration (SQLite)**:
  - Folgende Spalten wurden der Tabelle `users` automatisch beim Start hinzugefügt: `twofa_type` (TEXT), `twofa_secret` (TEXT), `twofa_code` (TEXT), `twofa_expires` (INTEGER).
  - *Admin-Aufwand*: **Keiner**. Alle Migrationen erfolgen verlustfrei und abwärtskompatibel beim Booten des Backends.
- **Agenten-Kompatibilität (`remote_agents`)**:
  - Build 248 ist vollständig abwärtskompatibel zu bestehenden v1.4x Agenten.
  - *Empfehlung*: Überprüfe im System-Tab gelegentlich den Status veralteter Agenten (`outdatedAgents`).
- **Server-Neustart & Sitzungen**:
  - Nach einem automatischen Update über den Button beendet das Panel seinen Prozess. Der Service (Docker / PM2 / systemd / Nodemon) startet die Instanz innerhalb von ~1,5 Sekunden neu.
  - *Aktive Benutzer-Sitzungen*: Bestehende JWT-Sitzungen bleiben erhalten und müssen nicht erneuert werden, es sei denn, ein Benutzer aktiviert 2FA.

---

## [1.47.0] - 2026-07-27 (Build 246) — *Modular & Smart Updates*

### ✨ Neue Funktionen
- **Aktive Module konfigurieren**: Modul-Toggles in `Settings.jsx` (`Docker`, `PatchMon`, `Hetzner`, `MC-Host24` etc.) zum benutzerdefinierten Ein-/Ausblenden in der Sidebar.
- **GitHub PAT Update-Check**: Hinterlegen eines privaten Tokens, um GitHub API Rate-Limits zu umgehen und private Repositories zu checken.
- **Webhooks Integration**: Übersichtliche Verwaltung für Discord- und Slack-Alerts.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Neue Tabelle/Spalten in `settings` für modulare Schalter (`module_docker`, `module_patchmon` usw.).
- Abwärtskompatibel: Wenn ein Schalter noch nicht konfiguriert wurde, ist das Modul standardmäßig aktiviert.
