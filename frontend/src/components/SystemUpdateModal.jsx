import React, { useEffect, useRef, useState } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

// Führt das Paket-Update aus und zeigt die Ausgabe des Agenten live an.
//   `agentId` → einzelner Server (Server-Detailseite)
//   `targets` → Liste [{ id, name }] für den Sammel-Lauf von der PatchMon-Seite
// Die Server werden bewusst nacheinander abgearbeitet: parallel liefen die
// Log-Ströme ineinander und man sähe nicht mehr, welche Zeile zu wem gehört.
export default function SystemUpdateModal({ agentId, targets, onClose, onFinished }) {
  // Ziel-Liste einmalig festhalten. Ein neu erzeugtes `targets`-Array beim
  // Neu-Rendern der Elternkomponente darf den Lauf nicht verändern.
  const zieleRef = useRef(
    targets?.length ? targets : (agentId != null ? [{ id: agentId, name: null }] : [])
  );
  const ziele = zieleRef.current;
  const mehrere = ziele.length > 1;

  const [logs,   setLogs]   = useState('');
  const [status, setStatus] = useState('idle');  // idle · running · done · error
  const [aktiv,  setAktiv]  = useState(0);       // Index des gerade laufenden Servers
  const [fehler, setFehler] = useState([]);      // Server, bei denen es schiefging

  const logsEndRef = useRef(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (logsEndRef.current) logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const schreibe = (text) => setLogs(prev => prev + text);

  // Ein Server: Update anstoßen und den Antwort-Stream fortlaufend ausgeben.
  const updateServer = async (id) => {
    const response = await fetch(`/api/agents/${id}/packages/update`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    if (!response.ok) {
      // Antwort kann eine HTML-Fehlerseite des Reverse Proxys sein → nicht blind parsen.
      const text = await response.text();
      let errorMsg = null;
      try { errorMsg = JSON.parse(text).error; } catch { /* kein JSON — siehe unten */ }

      if (!errorMsg) {
        console.error('Non-JSON Error Response:', text);
        // 502/504 kommen vom Reverse Proxy, nicht vom Panel: Läuft das Panel auf dem
        // Server, der gerade aktualisiert wird, startet es durch das Update selbst neu.
        errorMsg = (response.status === 502 || response.status === 504)
          ? `Verbindung zum Panel unterbrochen (HTTP ${response.status}). `
            + 'Läuft das Panel auf dem aktualisierten Server, startet es durch das Update selbst neu — '
            + 'das Update läuft dort trotzdem zu Ende.'
          : `Serverfehler (HTTP ${response.status}): Die Antwort war kein JSON.`;
      }
      throw new Error(errorMsg);
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        schreibe(decoder.decode(value, { stream: true }));
      }
    } catch {
      // Abbruch mitten im Stream — dasselbe Muster wie oben, nur später.
      throw new Error(
        'Verbindung während des Updates abgerissen. Das Update läuft auf dem Zielserver weiter; '
        + 'das Ergebnis steht nach dem nächsten PatchMon-Check-in in der Übersicht.'
      );
    }
  };

  // Alle Ziele nacheinander. Ein Fehler stoppt den Durchlauf nicht — die
  // übrigen Server sollen trotzdem noch aktualisiert werden.
  const starteAlle = async () => {
    setStatus('running');
    const gescheitert = [];

    for (let i = 0; i < ziele.length; i++) {
      const z    = ziele[i];
      const name = z.name || `Server ${z.id}`;
      setAktiv(i);

      schreibe(mehrere
        ? `${i > 0 ? '\n\n' : ''}${'═'.repeat(58)}\n▶ ${name}   (${i + 1}/${ziele.length})\n${'═'.repeat(58)}\n`
        : 'Verbinde zum Agenten für System-Update...\n');

      try {
        await updateServer(z.id);
      } catch (err) {
        gescheitert.push(name);
        schreibe(`\n[FEHLER] ${err.message}\n`);
      }
    }

    if (mehrere) {
      schreibe(`\n${'═'.repeat(58)}\n` + (gescheitert.length
        ? `Fertig — ${ziele.length - gescheitert.length} von ${ziele.length} Servern aktualisiert. `
          + `Fehlgeschlagen: ${gescheitert.join(', ')}\n`
        : `Fertig — alle ${ziele.length} Server aktualisiert.\n`));
    }

    setFehler(gescheitert);
    setStatus(gescheitert.length ? 'error' : 'done');
    onFinished?.();
  };

  // Genau einmal pro geöffnetem Dialog starten, sonst liefe das Update bei
  // jedem Neu-Rendern der Elternkomponente erneut los.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (!ziele.length) {
      setLogs('Kein Server zum Aktualisieren ausgewählt.\n');
      setStatus('error');
      return;
    }
    starteAlle();
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const laeuft = status === 'running';
  const titel  = mehrere
    ? `📦 Paket-Update — ${Math.min(aktiv + 1, ziele.length)}/${ziele.length}`
      + (laeuft ? ` · ${ziele[aktiv]?.name || ''}` : '')
    : '📦 Paket-Update';

  return (
    <Modal
      open
      size="xl"
      title={titel}
      // Während des Laufs kein Schließen: der Vorgang lässt sich nicht abbrechen.
      onClose={laeuft ? () => {} : onClose}
      footer={
        <Button
          variant={laeuft ? 'ghost' : (fehler.length ? 'danger' : 'primary')}
          onClick={onClose}
          disabled={laeuft}
        >
          {laeuft ? 'Update läuft…' : 'Schließen'}
        </Button>
      }
    >
      <div className="bg-[#0c0c0c] text-[#00ff00] font-mono p-4 rounded-xl h-[60vh] overflow-y-auto whitespace-pre-wrap break-all text-sm border border-panel-border">
        {logs}
        {laeuft && <span className="animate-pulse">_</span>}
        <div ref={logsEndRef} />
      </div>
    </Modal>
  );
}
