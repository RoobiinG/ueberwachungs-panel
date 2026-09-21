// Docker-Seite — nutzt Dockhand API für alle Server (lokal + remote via Hawser)
// Container-Format ist jetzt einheitlich für alle Server:
// { id, name, image, state, status, cpu, memUsed, memLimit, netRx, netTx, stack, ports }

import { useEffect, useState, useRef, useCallback, lazy, Suspense } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ServerSelector } from '../components/ui/ServerSelector';
import { ActionMenu } from '../components/ui/ActionMenu';
import { RefreshCw, Play, Square, RotateCcw, Tag, Check, X, ScrollText, ChevronDown, ChevronUp, Zap, Shield, Terminal, Info, Search, CornerDownRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWSMessage } from '../context/WSContext';
// Erst laden, wenn tatsächlich ein Terminal geöffnet wird — xterm steckte bisher
// (über Docker.jsx → DockerCenter.jsx) in jedem Besuch von /docker, unabhängig davon,
// ob je ein Terminal geöffnet wurde. Größter Einzelposten im Bundle (~300 KB roh).
const TerminalModal = lazy(() =>
  import('../components/TerminalModal').then(m => ({ default: m.TerminalModal }))
);

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

const statusColor = (s) =>
  s === 'running'                          ? 'green' :
  s === 'exited' || s === 'stopped'        ? 'red'   : 'gray';

// Container aus dem Pelican Panel tragen die Server-UUID als Namen.
const UUID_MUSTER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fmtBytes = (b) => {
  if (b == null || b === 0) return '0 B';
  if (typeof b === 'string') return b;
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(Math.max(b, 1)) / Math.log(k)), sizes.length - 1);
  return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────

export default function Docker() {
  const { canWrite, hasPermission, isAdmin } = useAuth();
  const canLabel = isAdmin || hasPermission('docker.label');
  const canLogs  = isAdmin || hasPermission('docker.logs');

  const [selectedServer, setSelectedServer] = useState(null);
  const [containers, setContainers]         = useState([]);
  const [loading, setLoading]               = useState(true);
  const [busy, setBusy]                     = useState({});
  const [error, setError]                   = useState('');

  // Live-Stats: { containerId: { cpu, memUsed, memLimit, netRx, netTx } }
  const [statsMap, setStatsMap]   = useState({});
  const statsIntervalRef          = useRef(null);

  // Labels (Spitznamen / Tags)
  const [labels,       setLabels]       = useState({});
  const [editingLabel, setEditingLabel] = useState(null);
  const [labelDraft,   setLabelDraft]   = useState({ nickname: '', tag: '' });

  // Klarnamen aus dem Pelican Panel, Zuordnung über die Server-UUID
  const [pelicanNamen, setPelicanNamen] = useState({});

  // Logs
  const [logsOpen,    setLogsOpen]    = useState({});   // { containerId: bool }
  const [logsContent, setLogsContent] = useState({});   // { containerId: string }
  const [logsLoading, setLogsLoading] = useState({});   // { containerId: bool }
  const logsEndRef = useRef({});

  // Firewall-Port-Vorschlag nach Container-Start
  const [portSuggestion, setPortSuggestion] = useState(null); // { containerId, containerName, ports }
  const [portAdding, setPortAdding]         = useState(false);
  const [portAdded,  setPortAdded]          = useState([]);   // Liste bereits hinzugefügter Ports
  const [terminalState, setTerminalState]   = useState(null); // { server, containerId, containerName }

  // ── Serverübergreifende Suche ──────────────────────────────────────────────
  // Welche Server durchsucht werden, entscheidet das Backend anhand der Rolle.
  // Hier wird nichts nachgefiltert — was ankommt, darf der Benutzer auch sehen.
  const [suche, setSuche]             = useState('');
  const [suchErgebnis, setSuchErgebnis] = useState(null);
  const [sucheLaeuft, setSucheLaeuft] = useState(false);
  const [suchFehler, setSuchFehler]   = useState('');
  const [hervorheben, setHervorheben] = useState(null); // Container-ID nach dem Sprung

  // WS: Docker-Port-Vorschlag empfangen
  useWSMessage('docker_ports', (msg) => {
    setPortAdded([]);
    setPortSuggestion(msg.payload);
  });

  // ── Container laden ────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!selectedServer) return;
    setLoading(true);
    setError('');
    try {
      const url = `/api/agents/${selectedServer}/docker/containers`;
      const { data } = await axios.get(url);
      setContainers(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Docker nicht erreichbar');
    }
    setLoading(false);
  }, [selectedServer]);

  const loadLabels = useCallback(async () => {
    if (!selectedServer) return;
    const srv = String(selectedServer);
    try {
      const { data } = await axios.get(`/api/docker/labels?server=${encodeURIComponent(srv)}`);
      setLabels(data);
    } catch {}
  }, [selectedServer]);

  // Container aus dem Pelican Panel heißen wie ihre Server-UUID. Die Zuordnung zum
  // Klarnamen kommt vom Panel (dort zwischengespeichert) und wird nur zur Anzeige
  // verwendet — umbenannt wird nichts.
  const loadPelican = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/pelican/servers');
      setPelicanNamen(data || {});
    } catch { setPelicanNamen({}); }
  }, []);

  useEffect(() => {
    if (!selectedServer) return;
    setContainers([]);
    setStatsMap({});
    setEditingLabel(null);
    load();
    loadLabels();
    loadPelican();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer]);

  // Kann dieser Agent überhaupt eine Konsole anbieten? Fehlen ihm `ws`/`node-pty`, soll der
  // Menüeintrag den Grund nennen, statt in einen Verbindungsfehler zu laufen.
  // `bereit === undefined` = Agent älter als 2.6.2 und meldet es nicht → wie bisher versuchen.
  const [terminalInfo, setTerminalInfo] = useState({});
  useEffect(() => {
    setTerminalInfo({});
    if (!selectedServer) return;
    axios.get(`/api/agents/${selectedServer}/ping`)
      .then(r => setTerminalInfo({ bereit: r.data?.terminal, setup: r.data?.terminalSetup }))
      .catch(() => {});
  }, [selectedServer]);

  const terminalFehlt   = terminalInfo.bereit === false;
  const terminalRichtet = terminalFehlt && terminalInfo.setup === 'laeuft';

  // Welcher Name steht groß in der Zeile? Reihenfolge: selbst vergebener Spitzname,
  // dann der Klarname aus dem Pelican Panel, sonst der Container-Name selbst. Der
  // technische Name bleibt in jedem Fall klein daneben sichtbar.
  const anzeigeName = (c) => {
    const eigen = labels[c.id]?.nickname;
    if (eigen) return { gross: eigen, klein: c.name, ausPelican: false };

    if (UUID_MUSTER.test(c.name || '')) {
      const treffer = pelicanNamen[c.name.toLowerCase()] || pelicanNamen[c.name.slice(0, 8).toLowerCase()];
      if (treffer) return { gross: treffer, klein: c.name.slice(0, 8) + '…', ausPelican: true };
    }
    return { gross: c.name, klein: null, ausPelican: false };
  };

  // ── Live-Stats Polling (alle 8 s für laufende Container) ──────────────────

  // Auslastung aller Container in *einer* Anfrage. Früher lief hier eine Anfrage je
  // Container: Weil die Docker-Engine für die CPU-Prozente zwei Messpunkte abwarten muss,
  // dauert jede davon ein bis zwei Sekunden, und der Browser lässt nur eine Handvoll
  // gleichzeitig zu — bei zehn Containern zog sich das über zehn Sekunden und begann alle
  // acht Sekunden von vorn. Das Bündeln übernimmt jetzt der Server.
  const pollStats = useCallback(async (clist) => {
    if (!selectedServer) return;
    const running = clist.filter(c => c.state === 'running');
    if (!running.length) return;

    const url = `/api/agents/${selectedServer}/docker/stats`;

    let daten;
    try {
      const { data } = await axios.get(url);
      daten = data || {};
    } catch {
      return;   // Zwischenstand behalten statt die Anzeige zu leeren
    }

    const newMap = {};
    for (const [id, stats] of Object.entries(daten)) {
      if (!stats) continue;
      newMap[id] = {
        cpu:        stats.cpuPercent  ?? stats.cpu        ?? null,
        memUsed:    stats.memUsage    ?? stats.memUsed    ?? null,
        memLimit:   stats.memLimit                        ?? null,
        netRx:      stats.netRx                          ?? null,
        netTx:      stats.netTx                          ?? null,
      };
    }
    setStatsMap(newMap);
  }, [selectedServer]);

  // Polling starten sobald Container geladen sind
  useEffect(() => {
    if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    if (containers.length === 0) return;
    pollStats(containers); // sofort
    statsIntervalRef.current = setInterval(() => pollStats(containers), 8000);
    return () => clearInterval(statsIntervalRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containers]);

  // ── Labels ─────────────────────────────────────────────────────────────────

  const openLabelEdit = (cid, currentNickname, currentTag) => {
    setEditingLabel(cid);
    setLabelDraft({ nickname: currentNickname || '', tag: currentTag || '' });
  };

  const saveLabel = async (cid) => {
    if (!selectedServer) return;
    const server = String(selectedServer);
    try {
      await axios.put('/api/docker/labels', {
        server,
        containerId: cid,
        nickname:    labelDraft.nickname,
        tag:         labelDraft.tag,
      });
      await loadLabels();
      setEditingLabel(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Label konnte nicht gespeichert werden');
      setEditingLabel(null);
    }
  };

  // ── Logs ───────────────────────────────────────────────────────────────────
  const toggleLogs = async (cid) => {
    const isOpen = logsOpen[cid];
    setLogsOpen(p => ({ ...p, [cid]: !isOpen }));
    if (!isOpen) fetchLogs(cid);
  };

  const fetchLogs = async (cid, tail = 200) => {
    if (!selectedServer) return;
    setLogsLoading(p => ({ ...p, [cid]: true }));
    try {
      const url = `/api/agents/${selectedServer}/docker/containers/${cid}/logs?tail=${tail}`;
      const { data } = await axios.get(url);
      // Logs können als Array oder String kommen
      const text = Array.isArray(data) ? data.join('\n') : (typeof data === 'string' ? data : JSON.stringify(data));
      setLogsContent(p => ({ ...p, [cid]: text }));
      // Ans Ende scrollen
      setTimeout(() => logsEndRef.current[cid]?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (err) {
      setLogsContent(p => ({ ...p, [cid]: `Fehler: ${err.response?.data?.error || err.message}` }));
    }
    setLogsLoading(p => ({ ...p, [cid]: false }));
  };

  // ── Konsole (Terminal) ────────────────────────────────────────
  // Immer im Panel selbst, ohne Umweg über Dockhand und ohne neuen Browser-Tab.
  // Remote-Server laufen über ihren Panel-Agent, Container auf dem Panel-Server
  // selbst direkt über dessen Docker-Installation.
  const openTerminal = (c) => {
    if (!selectedServer) return;
    setTerminalState({ server: selectedServer, containerId: c.id, containerName: c.name });
  };

  // ── Aktionen (Start/Stop/Restart) ─────────────────────────────────────────

  const act = async (cid, action) => {
    if (!selectedServer) return;
    setBusy(b => ({ ...b, [cid]: action }));
    try {
      const url = `/api/agents/${selectedServer}/docker/containers/${cid}/${action}`;
      await axios.post(url);
      await load();
    } catch {}
    setBusy(b => ({ ...b, [cid]: null }));
  };

  // ── Serverübergreifende Suche ──────────────────────────────────────────────

  const suchbegriff = suche.trim();

  useEffect(() => {
    if (suchbegriff.length < 2) {
      setSuchErgebnis(null);
      setSuchFehler('');
      setSucheLaeuft(false);
      return;
    }
    // Entprellen, damit nicht jeder Tastendruck alle Server abfragt.
    setSucheLaeuft(true);
    const abbruch = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const { data } = await axios.get(`/api/docker/search?q=${encodeURIComponent(suchbegriff)}`, { signal: abbruch.signal });
        setSuchErgebnis(data);
        setSuchFehler('');
      } catch (err) {
        if (axios.isCancel(err) || err.name === 'CanceledError') return;
        setSuchErgebnis(null);
        setSuchFehler(err.response?.data?.error || 'Suche fehlgeschlagen');
      }
      setSucheLaeuft(false);
    }, 350);
    return () => { clearTimeout(timer); abbruch.abort(); };
  }, [suchbegriff]);

  // Sprung vom Treffer zum Container: Server wechseln, Suche schließen und die Zeile
  // kurz hervorheben — sonst sucht man sie in einer langen Liste erneut.
  const zumTreffer = (t) => {
    setSelectedServer(t.serverId);
    setSuche('');
    setHervorheben(t.id);
    setTimeout(() => setHervorheben(null), 4000);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <ServerSelector selected={selectedServer} onChange={setSelectedServer} />
        <div className="flex items-center gap-2 flex-1 justify-end min-w-[220px]">
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-panel-muted pointer-events-none" />
            <input
              type="text"
              value={suche}
              onChange={e => setSuche(e.target.value)}
              placeholder="Auf allen Servern suchen…"
              title="Sucht Name, Spitzname, Image, Stack und Kennung über alle Server, die du sehen darfst"
              className="w-full bg-panel-surface border border-panel-border rounded-md pl-7 pr-7 py-1.5 text-xs text-panel-text placeholder:text-panel-muted focus:outline-none focus:border-panel-accent transition-colors"
            />
            {suche && (
              <button
                onClick={() => setSuche('')}
                title="Suche zurücksetzen"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-panel-muted hover:text-panel-text"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw size={14} className="mr-1" />Aktualisieren
          </Button>
        </div>
      </div>

      {/* ── Suchergebnisse über alle Server ───────────────────────────────── */}
      {suchbegriff.length >= 2 && (
        <Card title={
          sucheLaeuft
            ? 'Suche läuft…'
            : `Suchergebnisse (${suchErgebnis?.treffer.length ?? 0})`
        }>
          {suchFehler ? (
            <div className="text-panel-red text-sm py-2">{suchFehler}</div>
          ) : sucheLaeuft && !suchErgebnis ? (
            <div className="text-panel-muted text-sm py-4 text-center">Durchsuche alle Server…</div>
          ) : !suchErgebnis?.treffer.length ? (
            <div className="text-panel-muted text-sm py-4 text-center">
              Keine Übereinstimmung für „{suchbegriff}" — {suchErgebnis?.durchsucht ?? 0} Container durchsucht.
            </div>
          ) : (
            <>
              <div className="text-[11px] text-panel-muted mb-2">
                {suchErgebnis.durchsucht} Container auf {suchErgebnis.quellen.length} Server
                {suchErgebnis.quellen.length === 1 ? '' : 'n'} durchsucht.
              </div>
              <div className="divide-y divide-panel-border -mx-4 -mb-4">
                {suchErgebnis.treffer.map(t => (
                  <button
                    key={`${t.serverId}:${t.id}`}
                    onClick={() => zumTreffer(t)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-panel-surface transition-colors"
                  >
                    <Badge color={statusColor(t.state)}>{t.state}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-panel-text truncate">
                        {t.spitzname || t.pelicanName || t.name}
                        {(t.spitzname || t.pelicanName) && (
                          <span className="text-panel-muted font-mono text-[11px] ml-1.5">{t.name}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-panel-muted truncate">
                        {t.image}{t.stack ? ` · Stack ${t.stack}` : ''} · gefunden in: {t.gefundenIn.join(', ')}
                      </div>
                    </div>
                    <Badge color="gray">{t.serverName}</Badge>
                    <CornerDownRight size={13} className="text-panel-muted flex-shrink-0" />
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Server, die gerade nicht antworten, offen benennen — sonst wirkt ein
              unvollständiges Ergebnis wie ein vollständiges. */}
          {suchErgebnis?.quellen.some(q => !q.ok) && (
            <div className="mt-3 text-[11px] text-panel-orange flex items-start gap-1.5">
              <Info size={11} className="flex-shrink-0 mt-0.5" />
              <span>
                Nicht durchsucht: {suchErgebnis.quellen.filter(q => !q.ok).map(q => `${q.name} (${q.fehler})`).join(' · ')}
              </span>
            </div>
          )}
        </Card>
      )}



      {error && (
        <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <Card title={`Docker Container (${containers.length})`}>
        {loading ? (
          <div className="text-panel-muted text-sm py-4 text-center">Lade…</div>
        ) : containers.length === 0 ? (
          <div className="text-panel-muted text-sm py-4 text-center">Keine Container gefunden</div>
        ) : (
          <div className="divide-y divide-panel-border -mx-4 -mb-4">
            {containers.map(c => {
              const isRun   = c.state === 'running';
              const live    = statsMap[c.id];
              const cpuPct  = live?.cpu      ?? c.cpu      ?? null;
              const memUsed = live?.memUsed  ?? c.memUsed  ?? null;
              const netRx   = live?.netRx    ?? c.netRx    ?? null;
              const netTx   = live?.netTx    ?? c.netTx    ?? null;

              const isLogsOpen = !!logsOpen[c.id];
              const anz = anzeigeName(c);
              return (
                <div
                  key={c.id}
                  className={`flex flex-col transition-colors ${
                    hervorheben === c.id ? 'bg-panel-accent/10 ring-1 ring-panel-accent/40 rounded-md' : ''
                  }`}
                >
                  {/* ── Container-Zeile (Name + Aktionen) ─────────────── */}
                  <div className="flex flex-col px-4 py-3 gap-2">
                  {/* Name & Status */}
                  <div className="min-w-0">
                    {editingLabel === c.id && canLabel ? (
                      <div className="flex items-center gap-1 flex-wrap">
                        <input
                          autoFocus
                          value={labelDraft.nickname}
                          onChange={e => setLabelDraft(d => ({ ...d, nickname: e.target.value }))}
                          placeholder="Spitzname…"
                          className="bg-panel-surface border border-panel-accent rounded px-2 py-0.5 text-xs text-panel-text focus:outline-none w-28"
                          onKeyDown={e => { if (e.key === 'Enter') saveLabel(c.id); if (e.key === 'Escape') setEditingLabel(null); }}
                        />
                        <input
                          value={labelDraft.tag}
                          onChange={e => setLabelDraft(d => ({ ...d, tag: e.target.value }))}
                          placeholder="Tag…"
                          className="bg-panel-surface border border-panel-border rounded px-2 py-0.5 text-xs text-panel-text focus:outline-none w-20"
                          onKeyDown={e => { if (e.key === 'Enter') saveLabel(c.id); if (e.key === 'Escape') setEditingLabel(null); }}
                        />
                        <Button size="sm" variant="success" onClick={() => saveLabel(c.id)}>
                          <Check size={12} />Speichern
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingLabel(null)}>
                          <X size={12} />Abbrechen
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge color={statusColor(c.state)}>{c.state}</Badge>
                        <span className="text-sm text-panel-text font-medium truncate">{anz.gross}</span>
                        {anz.ausPelican && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-panel-purple/15 text-panel-purple border border-panel-purple/30"
                            title={`Name aus dem Pelican Panel · Container: ${c.name}`}>
                            pelican
                          </span>
                        )}
                        {anz.klein && (
                          <span className="text-xs text-panel-muted truncate font-mono" title={c.name}>{anz.klein}</span>
                        )}
                        {labels[c.id]?.tag && (
                          <span className="px-1.5 py-0.5 bg-panel-accent/20 text-panel-accent text-[10px] rounded font-mono">
                            {labels[c.id].tag}
                          </span>
                        )}
                        {c.stack && !labels[c.id]?.tag && (
                          <span className="text-xs text-panel-muted bg-panel-surface px-1.5 py-0.5 rounded">{c.stack}</span>
                        )}
                        {canLabel && (
                          <button onClick={() => openLabelEdit(c.id, labels[c.id]?.nickname, labels[c.id]?.tag)}
                            className="p-0.5 text-panel-muted hover:text-panel-text opacity-40 hover:opacity-100 transition-opacity"
                            title="Spitzname / Tag bearbeiten">
                            <Tag size={11} />
                          </button>
                        )}
                      </div>
                    )}

                    <div className="text-xs text-panel-muted mt-0.5 truncate">{c.image}</div>

                    {/* Live-Stats mit Monitoring-Bars */}
                    {isRun && (cpuPct != null || memUsed != null) && (
                      <div className="mt-1.5 space-y-1">
                        {/* CPU-Bar */}
                        {cpuPct != null && (() => {
                          const pct = Math.min(100, Math.max(0, Number(cpuPct)));
                          const barCol = pct > 80 ? 'bg-panel-red' : pct > 50 ? 'bg-panel-orange' : 'bg-blue-500';
                          return (
                            <div>
                              <div className="flex justify-between text-[10px] text-panel-muted mb-0.5">
                                <span>CPU</span>
                                <span className="font-mono text-blue-400">{pct.toFixed(1)}%</span>
                              </div>
                              <div className="h-1 bg-panel-border rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all duration-700 ${barCol}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })()}
                        {/* RAM-Bar */}
                        {memUsed != null && (() => {
                          const liveMemLimit = live?.memLimit ?? c.memLimit ?? null;
                          const memPct = liveMemLimit ? Math.min(100, (memUsed / liveMemLimit) * 100) : null;
                          const barCol = memPct != null
                            ? (memPct > 85 ? 'bg-panel-red' : memPct > 60 ? 'bg-panel-orange' : 'bg-green-500')
                            : 'bg-green-500';
                          return (
                            <div>
                              <div className="flex justify-between text-[10px] text-panel-muted mb-0.5">
                                <span>RAM</span>
                                <span className="font-mono text-green-400">
                                  {fmtBytes(memUsed)}{liveMemLimit ? ` / ${fmtBytes(liveMemLimit)}` : ''}
                                </span>
                              </div>
                              {memPct != null && (
                                <div className="h-1 bg-panel-border rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full transition-all duration-700 ${barCol}`} style={{ width: `${memPct}%` }} />
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        {/* Netzwerk + Ports */}
                        <div className="flex items-center gap-3 text-[10px] text-panel-muted flex-wrap">
                          {(netRx != null || netTx != null) && (netRx > 0 || netTx > 0) && (
                            <span className="font-mono">↑{fmtBytes(netTx)}/s ↓{fmtBytes(netRx)}/s</span>
                          )}
                          {c.ports?.length > 0 && (
                            <span className="text-panel-muted/60">{c.ports.slice(0, 3).join(' · ')}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Aktionen — die häufigen beschriftet, der Rest benannt im Menü */}
                  <div className="flex items-center gap-1 flex-wrap">
                    {canWrite && (
                      !isRun
                        ? <Button size="sm" variant="success" onClick={() => act(c.id, 'start')} disabled={!!busy[c.id]}>
                            <Play size={12} />{busy[c.id] === 'start' ? 'Startet…' : 'Start'}
                          </Button>
                        : <Button size="sm" variant="danger" onClick={() => act(c.id, 'stop')} disabled={!!busy[c.id]}>
                            <Square size={12} />{busy[c.id] === 'stop' ? 'Stoppt…' : 'Stopp'}
                          </Button>
                    )}
                    {canWrite && (
                      <Button size="sm" variant="ghost" onClick={() => act(c.id, 'restart')} disabled={!!busy[c.id]}>
                        <RotateCcw size={12} />{busy[c.id] === 'restart' ? 'Startet neu…' : 'Neustart'}
                      </Button>
                    )}
                    {canLogs && (
                      <Button size="sm" variant="ghost" onClick={() => toggleLogs(c.id)}
                        className={isLogsOpen ? 'text-panel-accent border-panel-accent/40' : ''}>
                        <ScrollText size={12} />{isLogsOpen ? 'Logs ausblenden' : 'Logs'}
                      </Button>
                    )}
                    <ActionMenu
                      disabled={!!busy[c.id]}
                      items={[
                        // Remote-Server über ihren Agent, der Panel-Server selbst direkt
                        // über seine Docker-Installation. Fehlen einem Agenten die nötigen
                        // Module, nennt der Eintrag den Grund statt in einen Fehler zu laufen.
                        canWrite && isRun && {
                          icon: Terminal,
                          label: terminalRichtet ? 'Konsole wird eingerichtet…'
                               : terminalFehlt    ? 'Konsole nicht verfügbar'
                               : 'Konsole öffnen',
                          onClick: () => openTerminal(c),
                          disabled: terminalFehlt,
                          title: terminalRichtet
                            ? 'Die Module ws und node-pty werden gerade auf diesem Server installiert. Das dauert einige Minuten; danach steht die Konsole bereit.'
                            : terminalFehlt
                              ? 'Auf diesem Server fehlen dem Agenten die Module ws und node-pty. Das Panel rüstet sie beim nächsten Start selbst nach — oder von Hand: cd /opt/panel-agent && npm install --save ws node-pty && systemctl restart panel-agent'
                              : 'Terminal im Panel, über den Panel-Agent',
                        },
                        canLabel && {
                          icon: Tag,
                          label: 'Spitzname / Tag bearbeiten',
                          onClick: () => openLabelEdit(c.id, labels[c.id]?.nickname, labels[c.id]?.tag),
                        },
                        canWrite && isRun && {
                          icon: Zap,
                          label: 'Kill (SIGKILL)',
                          danger: true,
                          title: 'Sofortiges Beenden ohne Cleanup',
                          onClick: () => { if (confirm(`Container "${c.name}" sofort beenden (SIGKILL)?`)) act(c.id, 'kill'); },
                        },
                      ]}
                    />
                  </div>
                </div>

                {/* ── Log-Panel ──────────────────────────────────────────── */}
                {isLogsOpen && (
                  <div className="bg-panel-bg border-t border-panel-border/50">
                    {/* Log-Header */}
                    <div className="flex items-center justify-between px-4 py-1.5 bg-panel-surface/60 border-b border-panel-border/30">
                      <div className="flex items-center gap-2">
                        <ScrollText size={11} className="text-panel-muted" />
                        <span className="text-[11px] font-medium text-panel-muted">{c.name} — Logs</span>
                        {logsLoading[c.id] && (
                          <span className="text-[10px] text-panel-muted animate-pulse">Lade…</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {[50, 200, 500].map(n => (
                          <button key={n} onClick={() => fetchLogs(c.id, n)}
                            title={`Die letzten ${n} Zeilen laden`}
                            className="text-[10px] px-1.5 py-0.5 rounded text-panel-muted hover:text-panel-text hover:bg-panel-card transition-colors">
                            {n} Zeilen
                          </button>
                        ))}
                        <button onClick={() => toggleLogs(c.id)} title="Logs zuklappen"
                          className="text-panel-muted hover:text-panel-text ml-1">
                          <ChevronUp size={12} />
                        </button>
                      </div>
                    </div>
                    {/* Log-Inhalt */}
                    <pre className="text-[10px] font-mono text-panel-text/80 leading-relaxed p-3 max-h-64 overflow-y-auto whitespace-pre-wrap break-all">
                      {logsContent[c.id] || (logsLoading[c.id] ? 'Lade Logs…' : 'Keine Logs verfügbar')}
                      <div ref={el => logsEndRef.current[c.id] = el} />
                    </pre>
                  </div>
                )}
              </div>
            );
            })}
          </div>
        )}
      </Card>

      {/* ── Firewall-Port-Vorschlag nach Container-Start ───────────────────────── */}
      {portSuggestion && (
        <div className="fixed bottom-6 right-6 z-50 w-80 bg-panel-surface border border-panel-accent/40 rounded-xl shadow-2xl p-4 space-y-3 animate-in slide-in-from-right-5 duration-300">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Shield size={16} className="text-panel-accent flex-shrink-0" />
              <p className="text-sm font-semibold text-panel-text">Firewall-Ports öffnen?</p>
            </div>
            <button onClick={() => setPortSuggestion(null)}
              className="text-panel-muted hover:text-panel-text transition-colors flex-shrink-0">
              <X size={14} />
            </button>
          </div>

          <p className="text-xs text-panel-muted">
            <span className="text-panel-text font-medium">{portSuggestion.containerName}</span> wurde gestartet
            und exponiert folgende Ports:
          </p>

          <div className="space-y-1">
            {portSuggestion.ports.map((p, i) => {
              const portProto = `${p.hostPort || p.containerPort}/${p.proto || 'tcp'}`;
              const added = portAdded.includes(portProto);
              return (
                <div key={i} className="flex items-center justify-between bg-panel-bg rounded px-2.5 py-1.5">
                  <span className="text-xs font-mono text-panel-text">{portProto}</span>
                  {added
                    ? <span className="text-xs text-panel-green flex items-center gap-1"><Check size={11} />Freigegeben</span>
                    : <button
                        disabled={portAdding}
                        onClick={async () => {
                          setPortAdding(true);
                          try {
                            await axios.post('/api/firewall/allow', {
                              port: p.hostPort || p.containerPort,
                              proto: p.proto || 'tcp',
                            });
                            setPortAdded(prev => [...prev, portProto]);
                          } catch {}
                          setPortAdding(false);
                        }}
                        className="text-xs text-panel-accent hover:text-blue-300 transition-colors disabled:opacity-50">
                        Freigeben
                      </button>
                  }
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setPortSuggestion(null)}
              className="text-xs text-panel-muted hover:text-panel-text transition-colors px-2 py-1 rounded hover:bg-panel-card">
              Ignorieren
            </button>
          </div>
        </div>
      )}

      {terminalState && (
        <Suspense fallback={null}>
          <TerminalModal
            server={terminalState.server}
            containerId={terminalState.containerId}
            containerName={terminalState.containerName}
            onClose={() => setTerminalState(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
