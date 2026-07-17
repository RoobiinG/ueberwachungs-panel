# Implementation Plan - App-Remake (Jetpack Compose & S26 Ultra Optimierung)

Dieses Remake modernisiert das Überwachungs-Panel grundlegend. Die App wird von XML auf **Jetpack Compose (Material 3)** umgestellt und speziell für moderne High-End-Geräte wie das **Samsung Galaxy S26 Ultra** optimiert.

## Zielsetzung & S26 Ultra Optimierung
- **Edge-to-Edge Design**: Volle Ausnutzung des Displays (hinter der Status- und Navigationsleiste).
- **Material 3 & Dynamic Color**: Integration von Material You für eine moderne, native Optik.
- **Adaptive Layouts**: Optimale Darstellung auf hochauflösenden Displays.
- **Performance**: Flüssiges Scrollen (120Hz Support) durch Compose.
- **Stabilität**: Beseitigung der aktuellen Anzeige-Probleme durch sauberes State-Management.

## Geplante Funktionen
1.  **Moderner Login**: Flexibles Server-Management mit validierter URL-Eingabe.
2.  **Dashboard 2.0**:
    - Animierte Gauges (CPU, RAM, Disk).
    - Echtzeit-Status der Infrastruktur.
    - Interaktiver Aktivitäts-Feed (Alerts & Audit).
3.  **Server-Management**:
    - Detailansichten für alle Agents.
    - Steuerung von Systemd-Services und Docker-Containern.
4.  **Sicherheit**: Biometrisches Entsperren und PIN-Schutz.

## Vorgehensweise

### Phase 1: Vorbereitung & Versionierung
- [ ] `version.json` aktualisieren (Build-Nummer erhöhen).
- [ ] Compose-Abhängigkeiten in `build.gradle.kts` vervollständigen.
- [ ] `Theme.kt` für Material 3 und Dynamic Color erstellen.

### Phase 2: Core-Architektur
- [ ] `PanelRepository` als zentrale Datenquelle implementieren.
- [ ] `UiState`-Wrapper für alle API-Anfragen erstellen.

### Phase 3: UI-Umsetzung (Compose)
- [ ] **LoginScreen**: Modernes Interface mit Fehler-Feedback.
- [ ] **DashboardScreen**: Neuentwicklung der Gauges und Listen.
- [ ] **Navigation**: Implementierung der Compose Navigation (Bottom Bar).

### Phase 4: S26 Ultra Finishing
- [ ] Edge-to-Edge Konfiguration.
- [ ] Haptisches Feedback Integration.

## Verifizierungsplan
- Build der App und Test auf modernen Android-APIs (API 35/36).
- Prüfung der Daten-Synchronisation (Fix für die "Offline"-Anzeige).

## Commit & Push Strategie
Jeder größere Meilenstein wird einzeln committet, um die Historie sauber zu halten.
- Build-Version wird vor jedem Commit angepasst.
