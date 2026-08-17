// Docker-Seite — nutzt Dockhand API für alle Server (lokal + remote via Hawser)
// Container-Format ist jetzt einheitlich für alle Server:
// { id, name, image, state, status, cpu, memUsed, memLimit, netRx, netTx, stack, ports }

import { useEffect, useState, useRef, useCallback } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ServerSelector } from '../components/ui/ServerSelector';
import { RefreshCw, Play, Square, RotateCcw, Tag, Check, X, ScrollText, ChevronDown, ChevronUp, Zap, Shield, Terminal, Info } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWSMessage } from '../context/WSContext';
import { TerminalModal } from '../components/TerminalModal';

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

const statusColor = (s) =>
  s === 'running'                          ? 'green' :
  s === 'exited' || s === 'stopped'        ? 'red'   : 'gray';

const fmtBytes = (b) => {
  if (b == null || b === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(Math.max(b, 1)) / Math.log(k)), sizes.length - 1);
  return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

// ─── Haupt-Komponente ─────────────────────────────────────────────────────────

export default function Docker() {
  const { canWrite, hideLocal, hasPermission, isAdmin } = useAuth();
  const canLabel = isAdmin || hasPermission('docker.label');
  const canLogs  = isAdmin || hasPermission('docker.logs');

  const [selectedServer, setSelectedServer] = useState(null); // null = lokal
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

  // Logs
  const [logsOpen,    setLogsOpen]    = useState({});   // { containerId: bool }
  const [logsContent, setLogsContent] = useState({});   // { containerId: string }
  const [logsLoading, setLogsLoading] = useState({});   // { containerId: bool }
  const logsEndRef = useRef({});

  // Firewall-Port-Vorschlag nach Container-Start
  const [portSuggestion, setPortSuggestion] = useState(null); // { containerId, containerName, ports }
  const [portAdding, setPortAdding]         = useState(false);
  const [portAdded,  setPortAdded]          = useState([]);   // Liste bereits hinzugefügter Ports
  const [terminalState, setTerminalState]   = useState(null); // { agentId, containerId, containerName }

  // WS: Docker-Port-Vorschlag empfangen
  useWSMessage('docker_ports', (msg) => {
    setPortAdded([]);
    setPortSuggestion(msg.payload);
  });

  // ── Container laden ────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const url = selectedServer
        ? `/api/agents/${selectedServer}/docker/containers`
        : '/api/docker/containers';
      const { data } = await axios.get(url);
      setContainers(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Docker nicht erreichbar');
    }
    setLoading(false);
  }, [selectedServer]);

  const loadLabels = useCallback(async () => {
    const srv = selectedServer ? String(selectedServer) : 'local';
    try {
      const { data } = await axios.get(`/api/docker/labels?server=${encodeURIComponent(srv)}`);
      setLabels(data);
    } catch {}
  }, [selectedServer]);

  useEffect(() => {
    if (hideLocal && selectedServer === null) return;
    setContainers([]);
    setStatsMap({});
    setEditingLabel(null);
    load();
    loadLabels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer, hideLocal]);

  // ── Live-Stats Polling (alle 8 s für laufende Container) ──────────────────

  const pollStats = useCallback(async (clist) => {
    const running = clist.filter(c => c.state === 'running');
    if (!running.length) return;

    const results = await Promise.allSettled(
      running.map(c => {
        const url = selectedServer
          ? `/api/agents/${selectedServer}/docker/containers/${c.id}/stats`
          : `/api/docker/containers/${c.id}/stats`;
        return axios.get(url).then(r => ({ id: c.id, stats: r.data }));
      })
    );

    const newMap = {};
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const { id, stats } = r.value;
        newMap[id] = {
          cpu:        stats.cpuPercent  ?? stats.cpu        ?? null,
          memUsed:    stats.memUsage    ?? stats.memUsed    ?? null,
          memLimit:   stats.memLimit                        ?? null,
          netRx:      stats.netRx                          ?? null,
          netTx:      stats.netTx                          ?? null,
        };
      }
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
    const server = selectedServer ? String(selectedServer) : 'local';
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
    setLogsLoading(p => ({ ...p, [cid]: true }));
    try {
      const url = selectedServer
        ? `/api/agents/${selectedServer}/docker/containers/${cid}/logs?tail=${tail}`
        : `/api/docker/containers/${cid}/logs?tail=${tail}`;
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
  // Die Konsole läuft ausschließlich nativ über den Panel-Agent — im Panel selbst,
  // ohne Umweg über Dockhand und ohne neuen Browser-Tab. Für den lokalen Panel-Server
  // gibt es deshalb keine Konsole; dort steht kein Agent zur Verfügung.
  const openTerminal = (c) => {
    if (!selectedServer) return;
    setTerminalState({ agentId: selectedServer, containerId: c.id, containerName: c.name });
  };

  // ── Aktionen (Start/Stop/Restart) ─────────────────────────────────────────

  const act = async (cid, action) => {
    setBusy(b => ({ ...b, [cid]: action }));
    try {
      const url = selectedServer
        ? `/api/agents/${selectedServer}/docker/containers/${cid}/${action}`
        : `/api/docker/containers/${cid}/${action}`;
      await axios.post(url);
      await load();
    } catch {}
    setBusy(b => ({ ...b, [cid]: null }));
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <ServerSelector selected={selectedServer} onChange={setSelectedServer} />
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw size={14} className="mr-1" />Aktualisieren
        </Button>
      </div>

      {/* Der lokale Panel-Server wird immer über Dockhand bedient — auch im Nativ-Modus.
          Eine Konsole gibt es dort nicht, weil sie zwingend einen Panel-Agent braucht. */}
      {!selectedServer && (
        <p className="text-[11px] text-panel-muted flex items-center gap-1.5">
          <Info size={11} className="flex-shrink-0" />
          Container des lokalen Panel-Servers laufen über Dockhand Pro — die Einstellung
          „Docker Verwaltung" gilt nur für Remote-Server. Die Konsole ist hier nicht
          verfügbar: Sie läuft ausschließlich nativ über einen Panel-Agent.
        </p>
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
              return (
                <div key={c.id} className="flex flex-col">
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
                        <button onClick={() => saveLabel(c.id)}
                          className="p-0.5 text-panel-green hover:text-panel-green/80"><Check size={13} /></button>
                        <button onClick={() => setEditingLabel(null)}
                          className="p-0.5 text-panel-muted hover:text-panel-red"><X size={13} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge color={statusColor(c.state)}>{c.state}</Badge>
                        {labels[c.id]?.nickname
                          ? <span className="text-sm text-panel-text font-medium truncate">{labels[c.id].nickname}</span>
                          : <span className="text-sm text-panel-text font-medium truncate">{c.name}</span>
                        }
                        {labels[c.id]?.nickname && (
                          <span className="text-xs text-panel-muted truncate">({c.name})</span>
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

                  {/* Aktionen */}
                  <div className="flex items-center gap-1">
                    {canWrite && (
                      <>
                        {!isRun
                          ? <Button size="sm" variant="success" onClick={() => act(c.id, 'start')}   disabled={!!busy[c.id]} title="Starten"><Play size={12} /></Button>
                          : <Button size="sm" variant="danger"  onClick={() => act(c.id, 'stop')}    disabled={!!busy[c.id]} title="Stoppen"><Square size={12} /></Button>
                        }
                        <Button size="sm" variant="ghost"   onClick={() => act(c.id, 'restart')} disabled={!!busy[c.id]} title="Neustarten"><RotateCcw size={12} /></Button>
                        {isRun && (
                          <button
                            onClick={() => { if (confirm(`Container "${c.name}" sofort beenden (SIGKILL)?`)) act(c.id, 'kill'); }}
                            disabled={!!busy[c.id]}
                            title="Kill (SIGKILL) — sofortiges Beenden ohne Cleanup"
                            className="p-1 rounded text-panel-orange hover:bg-panel-orange/15 disabled:opacity-40 transition-colors"
                          >
                            <Zap size={12} />
                          </button>
                        )}
                      </>
                    )}
                    {/* Terminal-Button — nur mit docker.control (canWrite) und nur für
                        Remote-Server: Die Konsole läuft ausschließlich über den Panel-Agent. */}
                    {canWrite && isRun && (
                      <button
                        onClick={() => openTerminal(c)}
                        disabled={!selectedServer}
                        title={selectedServer
                          ? 'Konsole öffnen (nativ über den Panel-Agent)'
                          : 'Konsole nur für Server mit Panel-Agent verfügbar'}
                        className="p-1.5 rounded transition-colors text-panel-muted hover:text-panel-text hover:bg-panel-card disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-panel-muted disabled:cursor-not-allowed"
                      >
                        <Terminal size={13} />
                      </button>
                    )}
                    {/* Logs-Button — nur mit docker.logs Recht */}
                    {canLogs && (
                      <button
                        onClick={() => toggleLogs(c.id)}
                        title="Container-Logs"
                        className={`p-1.5 rounded transition-colors ${isLogsOpen ? 'text-panel-accent bg-panel-accent/10' : 'text-panel-muted hover:text-panel-text hover:bg-panel-card'}`}
                      >
                        <ScrollText size={13} />
                      </button>
                    )}
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
                            className="text-[10px] px-1.5 py-0.5 rounded text-panel-muted hover:text-panel-text hover:bg-panel-card transition-colors">
                            {n}Z
                          </button>
                        ))}
                        <button onClick={() => toggleLogs(c.id)} className="text-panel-muted hover:text-panel-text ml-1">
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
        <TerminalModal
          agentId={terminalState.agentId}
          containerId={terminalState.containerId}
          containerName={terminalState.containerName}
          onClose={() => setTerminalState(null)}
        />
      )}
    </div>
  );
}
