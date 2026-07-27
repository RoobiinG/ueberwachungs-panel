# 📜 Überwachungs-Panel — Update-Log & Release-Historie (CHANGELOG)

Alle Änderungen, neue Module, Bugfixes und das **Nachwirken (System-Auswirkungen & Kompatibilität)** werden hier fortlaufend protokolliert.

---

## [1.48.8] - 2026-07-27 (Build 256) — *Progress Pride Sidebar Flag (Deaktivierbar)*

### ✨ Neue Funktionen & Features
- **Progress Pride Flag Badge in der Seitenleiste (`Sidebar.jsx`)**:
  - Unten in der Seitenleiste (direkt rechts neben dem Benutzernamen im Footer-Bereich) wird ab sofort ein elegantes Progress Pride Flag Symbol (`🏳️‍🌈`) mit 11-farbigem Gradient-Hintergrund angezeigt.
  - Im eingeklappten Zustand der Sidebar erscheint das Symbol kompakt im Footer.
- **Benutzer-Einstellung zum Deaktivieren (`Settings.jsx`)**:
  - Unter **Einstellungen** wurde die neue Kategorie **Darstellung & Design** hinzugefügt.
  - Dort kann das Pride Flag Symbol in der Seitenleiste über einen Schalter ("Pride Flag in der Sidebar anzeigen") jederzeit von jedem Nutzer einzeln aktiviert oder deaktiviert werden.
  - Die Änderung wirkt **sofort live** in der Seitenleiste ohne Neuladen der Seite (`localStorage` + `pride_flag_change` Event).

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.48.8` (Build 256)** erhöht.
- Keine Backend-Datenbankmigrationen erforderlich, da die Anzeigepräferenz individuell pro Browser im `localStorage` hinterlegt wird (`show_pride_flag`).

---

## [1.48.7] - 2026-07-27 (Build 255) — *Remove Top Accent Bar*

### 🎨 Design & Layout Anpassungen
- **Horizontale Regenbogen-Akzentlinie entfernt (`Layout.jsx` & `Sidebar.jsx`)**:
  - Die horizontale Linie am oberen Bildschirmrand und im Sidebar-Header wurde auf Nutzer-Feedback wieder entfernt, damit das gewohnte, saubere Dark-Mode-Layout nicht durch einen farbigen Querbalken gestört wird.
  - Das SVG-Favicon für den Browser-Tab (`favicon.svg`) bleibt unverändert erhalten.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.48.7` (Build 255)** erhöht.

---

## [1.48.6] - 2026-07-27 (Build 254) — *Docker Background Updater (No HTTP 504 Timeout)*

### 🐛 Bugfixes & Optimierungen
- **HTTP 504 Gateway Timeout beim Docker-Update (`POST /api/update/run`) behoben**:
  - Wenn ein Docker-Container ohne `.git`-Verzeichnis aktualisiert wird (`isDockerUpdate = true`), wartet die API nicht mehr synchron auf den potenziell langen `docker pull` Befehl (der bei Reverse-Proxies wie Nginx nach 60 Sekunden zu HTTP 504 führt).
  - Der Endpunkt antwortet ab sofort in < 10ms mit `HTTP 200 OK` und startet das Ziehen des Images sowie das Neuladen des Containers (`docker pull ... && docker compose up -d`) asynchron im Hintergrund über den Host-Namespace (`nsenter`).

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` auf **`1.48.6` (Build 254)** erhöht.
- Das Web-UI erhält beim Klick auf den Update-Button sofortige Bestätigung ohne Timeout.

---

## [1.48.5] - 2026-07-27 (Build 253) — *New Rainbow Flag (Progress Pride)*

### ✨ Neue Funktionen & Features
- **New Rainbow Flag (Progress Pride) Akzentleiste**: 11-farbiger Regenbogen-Gradient am oberen Fensterrand (`Layout.jsx`) und an der Oberkante des Sidebar-Headers (`Sidebar.jsx`).
- **Custom SVG Favicon (`favicon.svg`)**: Reines Vektorgrafik-Favicon für den Browser-Tab (`index.html`) mit der New Rainbow Flag (Progress Pride) Linie und dem Panel-Emblem statt generischer Browser-Standardicons.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.48.5` (Build 253)** erhöht.
- Das neue SVG-Favicon wird im Browser automatisch als Tab-Icon gerendert.

---

## [1.48.4] - 2026-07-27 (Build 252) — *Retroactive Versioning & Version Sync Rule*

### ✨ Neue Funktionen & Features
- **Verpflichtende SemVer-Synchronisation (`AGENTS.md`)**: Bei jeder Erhöhung der Build-Nummer muss ab sofort auch die SemVer-Versionsnummer (`version.json`) zwingend erhöht werden (Patch-Release bei Fixes/Chores, Minor-Release bei neuen Features).
- **Rückwirkende Versionierung**: Alle neueren Builds im `CHANGELOG.md` und in `version.json` wurden rückwirkend getrennt versioniert (`1.48.0` für Build 248 bis `1.48.4` für Build 252).

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` auf `1.48.4` (Build 252) aktualisiert.

---

## [1.48.3] - 2026-07-27 (Build 251) — *Full Changelog History v1.0.0 – v1.48.0*

### ✨ Neue Funktionen & Features
- **Vollständiges Release-Log**: Gesamte Projektgeschichte seit Mai 2026 (`v1.0.0` / Build 1) inklusive aller Meilensteine in `CHANGELOG.md` übernommen.
- **Regel zur ständigen Changelog-Pflege (`AGENTS.md`)**: In `.agents/AGENTS.md` verankert, dass `CHANGELOG.md` vor jedem Commit und Push dokumentiert werden muss.

---

## [1.48.2] - 2026-07-27 (Build 250) — *Docker Auto-Update per Host nsenter & Robuste E-Mail-2FA*

### 🐛 Bugfixes & Optimierungen
- **Docker Auto-Updater (`POST /api/update/run`)**: Erkennt Docker-Umgebungen ohne `.git`-Verzeichnis in `update.js` — führt stattdessen ein Docker Image Update (`docker pull ghcr.io/roobiing/ueberwachungs-panel:latest` und Container-Restart) per `nsenter` auf dem Host aus.
- **E-Mail-2FA Bestätigungscode (`/api/auth/2fa/enable` & `/login/2fa`)**: Gültigkeitsdauer auf 20 Minuten erhöht, toleranter String/Trim-Vergleich, präzise Fehlermeldungen und Konsolen-Logging für generierte E-Mail-Codes.

---

## [1.48.1] - 2026-07-27 (Build 249) — *GitHub Update-Log & System Impact Analysis*

### ✨ Neue Funktionen & Features
- **Update-Log Modal (`UpdateLogModal.jsx`)**: Tab-Ansicht zwischen Changelog und Git-Commits sowie direkter Link auf GitHub.
- **Bugfix (`Sidebar.jsx`)**: Syntaxfehler (Zeile 148) bei der Rendering-Bedingung behoben.

---

## [1.48.0] - 2026-07-27 (Build 248) — *Automatischer Panel-Updater & 2FA Security*

### ✨ Neue Funktionen & Features
- **Automatischer Panel-Updater (`POST /api/update/run`)**: Direktes Auslösen von `git pull` aus dem Panel heraus.
- **GitHub-Token Erklärung & Anleitung (`Settings.jsx`)**: Schritt-für-Schritt-Anleitung für Fine-Grained PATs mit Read-only Berechtigungen.
- **Zwei-Faktor-Authentifizierung (2FA / MFA)** (Build 247 Integration):
  - **Authenticator-App (TOTP / RFC 6238)** via offline SVG QR-Code (`qr.js`).
  - **E-Mail-2FA**: Temporärer 6-stelliger Bestätigungscode per SMTP.
  - Zweistufiger Login-Prozess mit geschütztem Zwischen-JWT (`tempToken`).

### 🐛 Bugfixes & Optimierungen
- **ReferenceError Behebung**: Fehler beim Löschen externer Token oder nach Einstellungs-Änderungen (`load is not defined` → Nutzung von `loadAdmin`) in `Settings.jsx` behoben.
- **IP-Kopierfunktion für Server**: Bei Hetzner Cloud API und MC-Host24 können IPs nun direkt mit visuellem Klick-Feedback (`✓ Kopiert`) kopiert werden.
- **Webhook-Konfiguration in Benachrichtigungen**: Schneller Absprung über „Webhooks als Einstellung“-Button in `Alerts.jsx`.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migration (SQLite)**: Spalten `twofa_type`, `twofa_secret`, `twofa_code`, `twofa_expires` in Tabelle `users` ergänzt.
- **Agenten-Kompatibilität (`remote_agents`)**: Vollständig abwärtskompatibel zu bestehenden v1.4x Agenten.
- **Server-Neustart & Sitzungen**: Automatischer Prozess-Neustart (~1,5 Sekunden) nach Update. Bestehende JWT-Sitzungen bleiben erhalten.

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
