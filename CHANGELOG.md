# 📜 Überwachungs-Panel — Update-Log & Release-Historie (CHANGELOG)

Alle Änderungen, neue Module, Bugfixes und das **Nachwirken (System-Auswirkungen & Kompatibilität)** werden hier fortlaufend protokolliert.

---

## [1.48.0] - 2026-07-27 (Build 251) — *Full Changelog History & Docker Auto-Update*

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

---

## [1.46.0] - 2026-07-20 (Build 240) — *MC-Host24 & Storage Box Metriken*

### ✨ Neue Funktionen
- **MC-Host24 Server-Details**: Exakte Anzeige der VServer-Laufzeit (`mchost_runtime`), Server-Spezifikationen und direkter API-Status im Server-Detail-Modal.
- **Multi-Bedingungen in Benachrichtigungen**: Alerts unterstützen ab sofort mehrere UND/ODER-Verknüpfungen für komplexe Schwellenwerte inkl. Cooldown-Konfiguration.
- **Hetzner Storage Box Alarme**: Automatische Warnungen bei Überschreitung der Quota von Storage Boxes.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `VALID_METRICS` im Backend um `mchost_runtime` und Storage-Box-Metriken erweitert.
- Keine Anpassungen an bestehenden Alert-Rules erforderlich.

---

## [1.45.0] - 2026-07-16 (Build 230) — *Server-Backup & Automatisierte Agent-Migration*

### ✨ Neue Funktionen
- **Automatisierte Agent-Migration & Backups**: Neues System zur Sicherung und Migration von Server-Konfigurationen und verbundenen Remote-Agenten.
- **Auto-Update der Agenten bei Migration**: Automatische Aktualisierung verbundener Agenten auf die passende API-Version während der System-Migration.
- **Entfernung des alten Android-Clients**: Reduktion des Repositories auf reines Web-/PWA-Monitoring für minimale Wartungsanfälligkeit.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Verbesserte Synchronisierung der SystemStats-Funktionen ohne `TypeError` bei unterbrochenen Verbindungen.

---

## [1.44.0] - 2026-07-12 (Build 123) — *Mobile-Version & Responsive Dockhand UI*

### ✨ Neue Funktionen
- **Mobile-App Interface**: Automatische Erkennung von Smartphones mit Touch-optimierter Bottom-Tab-Bar und Drawer für schnelle Bedienung unterwegs.
- **Dockhand-Stack-Verwaltung**: Volle Unterstützung für Docker Compose Stacks (Pull, Re-Deploy, Logs und Lifecycle-Steuerung direkt im Panel).
- **Granulare Docker-Berechtigungen**: Einzelrechte für Images, Volumes, Netzwerke und Stacks (`docker.images`, `docker.stacks` usw.).

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Neues Rechte-Schema für Docker-Ressourcen; bestehende Admin-Rollen erben alle Docker-Rechte automatisch.

---

## [1.43.0] - 2026-07-12 (Build 122) — *Dockhand (Docker-Stacks, Images, Volumes & Netzwerke)*

### ✨ Neue Funktionen
- **Dockhand-Engine**: Vollwertiges Docker-Management-System (Ersatz für einfache Portainer-Anwendungsfälle).
- **Ressourcen nach Server filterbar**: Schnelles Umschalten zwischen dem lokalen Server und entfernten Docker-Hosts.
- **Live-Container-Stats**: Überwachung von CPU-, RAM- und Netzwerk-Verbrauch pro Container in Echtzeit.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Geringerer Overhead durch Wegfall des alten, rein lesenden Docker-Moduls zugunsten der Dockhand-API.

---

## [1.42.0] - 2026-07-12 (Build 121) — *Hetzner Storage Boxes Integration*

### ✨ Neue Funktionen
- **Hetzner Storage Boxes**: Nahtlose Anzeige von Speicherplatz, Quota und Zugangsdaten direkt über den Hetzner-API-Token.
- **Dashboard-Widget**: Eigene Storage-Box-Kachel im frei anordnbaren Dashboard.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Nutzt den bereits in den Einstellungen hinterlegten Hetzner Cloud API-Token, kein separater Key nötig.

---

## [1.41.0] - 2026-07-09 (Build 118) — *Freies Dashboard-Grid & Mini-Verlaufscharts*

### ✨ Neue Funktionen
- **Frei konfigurierbares Dashboard**: Drag & Drop Grid (`react-grid-layout`) für individuelle Anordnung und Größenänderung der Widgets.
- **15-Minuten Mini-Charts**: Dynamische Sparkline-Verlaufsgraphen für CPU, RAM, Disk und Netzwerk direkt auf den Server-Karten.
- **KPI-Leiste & Aktivitäts-Feed**: Schnellübersicht der gesamten Server-Gesundheit auf einen Blick.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Das individuelle Dashboard-Layout jedes Nutzers wird im Browser-LocalStorage bzw. im Benutzerprofil gespeichert.

---

## [1.35.0] - 2026-07-06 (Build 107) — *PatchMon-Integration (Linux System-Updates)*

### ✨ Neue Funktionen
- **PatchMon System-Update-Monitor**: Automatische Erkennung ausstehender Linux-Paket-Updates (APT/YUM/DNF/Pacman) sowie notwendiger Systemneustarts (`needs_reboot`).
- **Server-Zuordnung**: Verbindung zwischen PatchMon-Clients und den im Panel hinterlegten Servern.
- **PatchMon-Benachrichtigungen**: Eigener Alert-Typ bei kritischer Anzahl ausstehender Sicherheitsupdates.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Verwendet das v2 PatchMon-Schema (`friendly_name`, `total_packages`, `needs_reboot`).

---

## [1.33.0] - 2026-06-12 (Build 102) — *Monitoring Performance & Remote Live-Stats*

### ✨ Neue Funktionen
- **3s/5s Remote-Live-Polling**: Schnelles Polling für externe Agenten via `metricsCache` ohne unnötige DB-Last.
- **6h-Query-Optimierung**: Schnelleres Laden von Langzeitdiagrammen und Schutz vor gleichzeitigen Doppel-Abfragen (`inflight-Guards`).
- **Chunk-Mismatch Reload**: Automatische Erneuerung des Browser-Caches nach Deployments.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- SQLite WAL-Pragmas (`journal_mode=WAL`, `cache_size=-32000`, `mmap_size=256MB`) sorgen für maximale Geschwindigkeit bei parallelen Lese-/Schreibzugriffen.

---

## [1.32.0] - 2026-06-12 (Build 100) — *Firewall-Redesign (UFW/iptables/nftables/firewalld)*

### ✨ Neue Funktionen
- **Multi-Firewall Unterstützung**: Einheitliches Interface für UFW, iptables, nftables und firewalld auf lokalen und entfernten Servern.
- **Regel-Suche & Paginierung**: Übersichtliches Suchen und Blättern in großen Firewall-Regelwerken.
- **Kippschalter-Steuerung**: Direktes Aktivieren/Deaktivieren von Firewall-Tools per Schalter im Panel.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Befehle werden auf dem Host über `nsenter` isoliert und sicher ausgeführt.

---

## [1.30.0] - 2026-06-03 (Build 85) — *Passkeys (WebAuthn) & SMTP Passwort-Reset*

### ✨ Neue Funktionen
- **Passkeys (FIDO2 / WebAuthn)**: Passwortloser, biometrischer Login via TouchID, FaceID, Windows Hello oder YubiKey.
- **SMTP-Passwort-Reset**: Sicheres Zurücksetzen von Passwörtern über zeitlich begrenzte Reset-Links per E-Mail.
- **SSH-Terminal**: Web-basiertes Terminal für direkten Serverzugriff per Browser (später zugunsten von Dockhand optimiert).

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Tabelle `users` unterstützt Passkeys abwärtskompatibel ohne Zwang für bestehende Konten.

---

## [1.22.0] - 2026-05-26 (Build 60) — *Granulares Rechte-System & GeoIP Audit-Log*

### ✨ Neue Funktionen
- **Granulares Rollen- & Berechtigungssystem**: Feingranulare Steuerung, welche Nutzer Server anlegen, Firewall steuern oder Docker verwalten dürfen (`requirePermission`).
- **Audit-Log mit GeoIP**: Vollständige Protokollierung aller administrativen Aktionen im Panel inkl. IP-Herkunftsland.
- **Uptime Kuma v1/v2 Integration**: Status-Badge und WebSocket/REST-Anbindung an Uptime Kuma Instanzen.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Einführung von `requireRole` und `requirePermission` im gesamten Backend.

---

## [1.15.0] - 2026-05-26 (Build 40) — *Alert-Engine & Uptime Kuma Integration*

### ✨ Neue Funktionen
- **Alert-Engine & Benachrichtigungen**: In-App-Alerts und externe Benachrichtigungen bei CPU-, RAM- oder Festplatten-Engpässen.
- **Grafana-ähnlicher Zoom**: Interaktives Drag-to-Select zum Reinzoomen in Monitoring-Diagramme.
- **SFTP-Datei-Browser**: Initialer Dateibrowser für Server.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Hintergrund-Worker überwacht Metriken im 10s-Intervall.

---

## [1.10.0] - 2026-05-25 (Build 25) — *CheckMK-artiger Remote-Server Agent*

### ✨ Neue Funktionen
- **Remote-Agent Architektur**: Leichtgewichtiger Agent für entfernte Linux-Server (Debian, Ubuntu, AlmaLinux, Alpine).
- **TLS & Fingerprint-Pinning**: Verschlüsselte Übertragung und Absicherung durch einzigartige Server-Fingerprints.
- **Langzeit-Monitoring**: 30-Tage-Historie mit 5-Minuten-Aggregationsstufen.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Tabelle `remote_agents` zur Verwaltung aller angebundenen Hosts erstellt.

---

## [1.0.0] - 2026-05-25 (Build 1) — *Initiales Release & Grundgerüst*

### ✨ Neue Funktionen
- **Projekt-Start & Grundgerüst**: Initiales Release des Überwachungs-Panels.
- **Hetzner Cloud API**: Anbindung von Hetzner Cloud Servern inkl. Power-Cycle und Backup-Status.
- **MC-Host24 API Integration**: Anbindung von VServern und Account-Daten bei MC-Host24.
- **Docker- & System-Infos**: Erste Live-Anzeigen zu CPU, RAM und lokalen Containern.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Start der SQLite-Datenbank (`data.db`) mit WAL-Modus für ausfallsicheren Betrieb.
