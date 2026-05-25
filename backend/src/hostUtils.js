const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Liest Festplatten-Info vom Host über nsenter (für Docker-Betrieb).
 * df läuft im Mount-Namespace des Host-Prozesses 1, nicht im Container.
 * Gibt null zurück wenn nsenter nicht verfügbar ist (Fallback auf si.fsSize()).
 */
async function getHostDisks() {
  try {
    const { stdout } = await execAsync(
      'nsenter --target 1 --mount -- df -B1 2>/dev/null',
      { timeout: 5000 }
    );
    const lines = stdout.trim().split('\n').slice(1); // Header überspringen
    const disks = lines
      .filter(l => /^\/dev\//.test(l))
      .map(l => {
        const p = l.trim().split(/\s+/);
        return {
          fs:          p[0],
          size:        parseInt(p[1]) || 0,
          used:        parseInt(p[2]) || 0,
          free:        parseInt(p[3]) || 0,
          usedPercent: parseFloat(p[4]) || 0,
          mount:       p[5] || '/',
        };
      })
      .filter(d => d.size > 0);

    // Pro Gerät nur den "Haupt-Mountpoint" behalten:
    // Bei Docker-Bind-Mounts zeigt dasselbe Gerät für /etc/hostname, /app/data, /
    // gleichzeitig auf — wir wollen nur den kürzesten (= root-nächsten) Pfad.
    const deduped = new Map();
    for (const d of disks) {
      const cur = deduped.get(d.fs);
      if (!cur || d.mount.length < cur.mount.length) {
        deduped.set(d.fs, d);
      }
    }

    const result = [...deduped.values()];
    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

module.exports = { getHostDisks };
