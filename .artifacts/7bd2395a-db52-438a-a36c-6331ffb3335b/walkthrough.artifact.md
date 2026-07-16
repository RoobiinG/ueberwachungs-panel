# Walkthrough - APK Erstellung und Fehlerbehebung

Die APK-Datei für das Überwachungs-Panel wurde erfolgreich erstellt und im Zielordner gespeichert. Während des Prozesses wurden mehrere Build-Fehler identifiziert und behoben.

## Durchgeführte Änderungen

### Projektkonfiguration
- **Versionierung**: Die Build-Nummer in `version.json` wurde auf `235` erhöht.
- **SDK-Update**: `compileSdk` und `targetSdk` wurden in `app/build.gradle.kts` auf Version `36` angehoben, um Kompatibilität mit den neuesten AndroidX-Bibliotheken zu gewährleisten.
- **Toolchain**: Die Java-Toolchain wurde auf Version `21` umgestellt, um das im Android Studio integrierte JDK optimal zu nutzen.

### Build-Fixes
1. **JDK-Konflikt**: Der Build wurde so konfiguriert, dass er das Java 21 JDK von Android Studio verwendet, anstatt des veralteten System-Javas (Version 8).
2. **Umgebungsvariablen**: Ein Konflikt zwischen `ANDROID_PREFS_ROOT` und `ANDROID_USER_HOME` wurde gelöst, indem redundante Variablen vor dem Build entfernt wurden.
3. **Abhängigkeiten**: Die Versionen von AGP (Android Gradle Plugin) und Kotlin wurden synchronisiert, um Build-Fehler bei der AAR-Metadatenprüfung zu vermeiden.

## Ergebnisse

- **Build-Status**: `BUILD SUCCESSFUL`
- **Datei**: `Ueberwachungs-Panel-debug.apk`
- **Speicherort**: [Coding/Ueberwachungs-Panel-debug.apk](file:///C:/Users/Shadow/Nextcloud/Coding/Ueberwachungs-Panel-debug.apk)

Die Datei steht nun im übergeordneten `Coding` Ordner zur Verfügung.
