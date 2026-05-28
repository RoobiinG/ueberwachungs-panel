import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useWS, useWSMessage } from '../context/WSContext';
import { useErrors } from '../context/ErrorContext';
import SftpBrowser from '../components/SftpBrowser';
import {
  Terminal as TerminalIcon, Plus, Trash2, Key, Unplug,
  Copy, CheckCircle, Upload, Pencil, FolderOpen, FileKey,
} from 'lucide-react';

const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent transition-colors';

// ─── SSH-Status-Indikator ────────────────────────────────────────────────────

const STATUS_COLOR = {
  disconnected: 'bg-panel-muted',
  connecting:   'bg-panel-yellow animate-pulse',
  connected:    'bg-panel-green',
  error:        'bg-panel-red',
};

// ─── Hauptkomponente ─────────────────────────────────────────────────────────

export default function SSH() {
  const { sendMessage } = useWS();
  const { addError }    = useErrors();

  // Daten
  const [hosts, setHosts]   = useState([]);
  const [keys,  setKeys]    = useState([]);

  // Verbindungsstatus
  const [sshStatus, setSshStatus]   = useState('disconnected');
  const [sshError,  setSshError]    = useState('');
  const [activeHost, setActiveHost] = useState(null);
  const activeHostRef = useRef(null);

  // Aktiver Tab
  const [activeTab, setActiveTab] = useState('terminal');

  // Modal-Flags
  const [showAddHost,    setShowAddHost]    = useState(false);
  const [editingHost,    setEditingHost]    = useState(null);
  const [showGenKey,     setShowGenKey]     = useState(false);
  const [showImportKey,  setShowImportKey]  = useState(false);

  // Formulare
  const [hostForm,    setHostForm]    = useState({ label: '', hostname: '', port: 22, username: '', ssh_key_id: '' });
  const [keyLabel,    setKeyLabel]    = useState('');
  const [importForm,  setImportForm]  = useState({ label: '', privateKey: '' });
  const [formError,   setFormError]   = useState('');

  // Generierter Public Key
  const [generatedPub,   setGeneratedPub]   = useState(null);
  const [copied,          setCopied]         = useState(false);
  const [showPubKeyModal, setShowPubKeyModal] = useState(null); // { label, public_key }
  const [pubKeyCopied,    setPubKeyCopied]   = useState(false);

  // Key-Datei-Upload
  const keyFileRef  = useRef(null);
  const [keyFileDrag, setKeyFileDrag] = useState(false);

  // xterm Refs
  const termDivRef = useRef(null);   // DOM-Element
  const xtermRef   = useRef(null);   // Terminal-Instanz
  const fitRef     = useRef(null);   // FitAddon-Instanz
  const roRef      = useRef(null);   // ResizeObserver

  // ── Daten laden ─────────────────────────────────────────────────────────

  const loadData = async () => {
    try {
      const [h, k] = await Promise.all([
        axios.get('/api/ssh/hosts'),
        axios.get('/api/ssh/keys'),
      ]);
      setHosts(h.data);
      setKeys(k.data);
    } catch {}
  };

  useEffect(() => { loadData(); }, []);

  // ── xterm initialisieren ─────────────────────────────────────────────────

  useEffect(() => {
    if (!termDivRef.current) return;
    let terminal, fitAddon, observer;

    const init = async () => {
      try {
        const { Terminal }   = await import('xterm');
        const { FitAddon }   = await import('@xterm/addon-fit');
        await import('xterm/css/xterm.css');

        terminal = new Terminal({
          theme: {
            background:          '#0d1117',
            foreground:          '#c9d1d9',
            cursor:              '#58a6ff',
            cursorAccent:        '#0d1117',
            selectionBackground: '#388bfd33',
            black:        '#0d1117', brightBlack:   '#30363d',
            red:          '#ff7b72', brightRed:     '#ffa198',
            green:        '#3fb950', brightGreen:   '#56d364',
            yellow:       '#d29922', brightYellow:  '#e3b341',
            blue:         '#58a6ff', brightBlue:    '#79c0ff',
            magenta:      '#bc8cff', brightMagenta: '#d2a8ff',
            cyan:         '#39c5cf', brightCyan:    '#56d4e4',
            white:        '#b1bac4', brightWhite:   '#ffffff',
          },
          fontFamily:    '"JetBrains Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
          fontSize:      13,
          lineHeight:    1.2,
          cursorBlink:   true,
          cursorStyle:   'bar',
          scrollback:    5000,
          allowProposedApi: true,
        });

        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(termDivRef.current);
        fitAddon.fit();

        xtermRef.current = terminal;
        fitRef.current   = fitAddon;

        // Tastatureingabe → WS
        terminal.onData((data) => sendMessage({ type: 'ssh_input', data }));

        // ResizeObserver → FitAddon → WS
        observer = new ResizeObserver(() => {
          fitRef.current?.fit();
          const { cols, rows } = xtermRef.current;
          sendMessage({ type: 'ssh_resize', cols, rows });
        });
        observer.observe(termDivRef.current);
        roRef.current = observer;

        terminal.writeln('\x1b[90m╔══════════════════════════════════════╗\x1b[0m');
        terminal.writeln('\x1b[90m║\x1b[0m  \x1b[36mSSH Web-Terminal\x1b[0m                  \x1b[90m║\x1b[0m');
        terminal.writeln('\x1b[90m║\x1b[0m  Host in der Seitenleiste auswählen  \x1b[90m║\x1b[0m');
        terminal.writeln('\x1b[90m╚══════════════════════════════════════╝\x1b[0m');
        terminal.writeln('');
      } catch (err) {
        console.error('xterm init failed:', err);
      }
    };

    init();

    return () => {
      // SSH-Sitzung sauber beenden wenn Seite verlassen wird
      sendMessage({ type: 'ssh_disconnect' });
      observer?.disconnect();
      terminal?.dispose();
      xtermRef.current = null;
      fitRef.current   = null;
      roRef.current    = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WS-Nachrichten empfangen ─────────────────────────────────────────────

  useWSMessage('ssh_connected', () => {
    setSshStatus('connected');
    setSshError('');
  });

  useWSMessage('ssh_output', (msg) => {
    if (!xtermRef.current) return;
    try {
      // Base64-kodierte Rohdaten → Uint8Array (korrekte UTF-8-Darstellung)
      const bin   = atob(msg.data);
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      xtermRef.current.write(bytes);
    } catch {
      xtermRef.current.write(msg.data);
    }
  });

  useWSMessage('ssh_error', (msg) => {
    setSshStatus('error');
    setSshError(msg.message);
    xtermRef.current?.write(`\r\n\x1b[31m[Fehler: ${msg.message}]\x1b[0m\r\n`);
    activeHostRef.current = null;
    setActiveHost(null);
    // Fehler global ins Panel-Log eintragen
    addError('SSH', msg.message);
  });

  useWSMessage('ssh_closed', () => {
    setSshStatus('disconnected');
    xtermRef.current?.write('\r\n\x1b[33m[Verbindung getrennt]\x1b[0m\r\n');
    activeHostRef.current = null;
    setActiveHost(null);
  });

  // ── SSH-Verbinden / Trennen ──────────────────────────────────────────────

  const connectHost = (host) => {
    // Vorherigen Zustand prüfen BEVOR der Ref überschrieben wird
    const alreadyConnected = activeHostRef.current?.id === host.id && sshStatus === 'connected';

    activeHostRef.current = host;
    setActiveHost(host);

    // SFTP-Tab: nur Host setzen, kein SSH-Terminal starten
    if (activeTab === 'sftp') return;

    if (alreadyConnected) {
      xtermRef.current?.focus();
      return;
    }
    if (sshStatus === 'connected') sendMessage({ type: 'ssh_disconnect' });

    setSshStatus('connecting');
    setSshError('');

    xtermRef.current?.write(
      `\r\n\x1b[36m[Verbinde mit \x1b[1m${host.username}@${host.hostname}:${host.port || 22}\x1b[22m …]\x1b[0m\r\n`
    );
    xtermRef.current?.focus();

    sendMessage({ type: 'ssh_connect', hostId: host.id });
  };

  const disconnect = () => {
    sendMessage({ type: 'ssh_disconnect' });
    setSshStatus('disconnected');
    activeHostRef.current = null;
    setActiveHost(null);
  };

  // Wenn Terminal-Tab wieder aktiv: xterm neu skalieren
  useEffect(() => {
    if (activeTab !== 'terminal') return;
    const t = setTimeout(() => {
      fitRef.current?.fit();
      if (xtermRef.current) {
        const { cols, rows } = xtermRef.current;
        sendMessage({ type: 'ssh_resize', cols, rows });
      }
    }, 30);
    return () => clearTimeout(t);
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Host-Formular ────────────────────────────────────────────────────────

  const openAddHost = () => {
    setEditingHost(null);
    setHostForm({ label: '', hostname: '', port: 22, username: '', ssh_key_id: '' });
    setFormError('');
    setShowAddHost(true);
  };

  const openEditHost = (host, e) => {
    e.stopPropagation();
    setEditingHost(host);
    setHostForm({
      label:      host.label,
      hostname:   host.hostname,
      port:       host.port || 22,
      username:   host.username,
      ssh_key_id: host.ssh_key_id ?? '',
    });
    setFormError('');
    setShowAddHost(true);
  };

  const saveHost = async () => {
    setFormError('');
    const port = Number(hostForm.port);
    if (!hostForm.label.trim() || !hostForm.hostname.trim() || !hostForm.username.trim())
      return setFormError('Label, Hostname und Benutzername sind Pflichtfelder');
    if (!port || port < 1 || port > 65535)
      return setFormError('Port muss zwischen 1 und 65535 liegen');

    try {
      const payload = {
        ...hostForm,
        port,
        ssh_key_id: hostForm.ssh_key_id ? Number(hostForm.ssh_key_id) : null,
      };
      if (editingHost) {
        await axios.put(`/api/ssh/hosts/${editingHost.id}`, payload);
      } else {
        await axios.post('/api/ssh/hosts', payload);
      }
      setShowAddHost(false);
      setEditingHost(null);
      loadData();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Fehler beim Speichern');
    }
  };

  const deleteHost = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Host löschen?')) return;
    try {
      await axios.delete(`/api/ssh/hosts/${id}`);
      if (activeHostRef.current?.id === id) disconnect();
      loadData();
    } catch {}
  };

  // ── Key-Formular ─────────────────────────────────────────────────────────

  const generateKey = async () => {
    setFormError('');
    try {
      const { data } = await axios.post('/api/ssh/keys/generate', {
        label: keyLabel.trim() || 'Neuer Key',
      });
      setGeneratedPub(data.public_key);
      loadData();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Fehler bei der Key-Generierung');
    }
  };

  const importKey = async () => {
    setFormError('');
    if (!importForm.privateKey.trim()) return setFormError('Private Key fehlt');
    try {
      await axios.post('/api/ssh/keys/import', {
        label:      importForm.label.trim() || 'Importierter Key',
        privateKey: importForm.privateKey.trim(),
      });
      setShowImportKey(false);
      setImportForm({ label: '', privateKey: '' });
      loadData();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Fehler beim Import');
    }
  };

  const readKeyFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result.trim();
      setImportForm(f => ({
        ...f,
        privateKey: content,
        // Label aus Dateiname ableiten wenn noch leer (ohne Erweiterung)
        label: f.label.trim() ? f.label : file.name.replace(/\.(pem|ppk|key|txt)$/i, ''),
      }));
    };
    reader.readAsText(file);
  };

  const deleteKey = async (id) => {
    if (!confirm('SSH-Key löschen? Hosts die diesen Key verwenden können danach keine Verbindung mehr aufbauen.')) return;
    try { await axios.delete(`/api/ssh/keys/${id}`); loadData(); } catch {}
  };

  const copyPubKey = () => {
    navigator.clipboard.writeText(generatedPub ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // ── Statuszeile ──────────────────────────────────────────────────────────

  const statusLabel = {
    disconnected: 'Nicht verbunden',
    connecting:   `Verbinde mit ${activeHost?.username}@${activeHost?.hostname}:${activeHost?.port || 22} …`,
    connected:    `${activeHost?.username}@${activeHost?.hostname}:${activeHost?.port || 22}`,
    error:        `Fehler: ${sshError}`,
  }[sshStatus];

  const statusTextCls = {
    disconnected: 'text-panel-muted',
    connecting:   'text-panel-yellow',
    connected:    'text-panel-green',
    error:        'text-panel-red',
  }[sshStatus];

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex gap-3" style={{ height: 'calc(100vh - 76px)' }}>

      {/* ── Seitenleiste ── */}
      <div className="w-64 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">

        {/* Hosts */}
        <Card title="SSH Hosts" className="flex-shrink-0">
          <div className="space-y-0.5 -mx-1 mb-2">
            {hosts.length === 0 && (
              <p className="text-xs text-panel-muted py-2 text-center">Noch keine Hosts</p>
            )}
            {hosts.map(host => (
              <div
                key={host.id}
                onClick={() => connectHost(host)}
                className={`flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer group transition-colors select-none ${
                  activeHost?.id === host.id
                    ? 'bg-panel-accent/10 border border-panel-accent/30'
                    : 'hover:bg-panel-surface border border-transparent'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  activeHost?.id === host.id ? STATUS_COLOR[sshStatus] : 'bg-panel-muted'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-panel-text truncate">{host.label}</p>
                  <p className="text-xs text-panel-muted font-mono truncate">
                    {host.username}@{host.hostname}:{host.port || 22}
                  </p>
                </div>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => openEditHost(host, e)}
                    className="p-1 text-panel-muted hover:text-panel-text rounded transition-colors"
                    title="Bearbeiten"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={(e) => deleteHost(host.id, e)}
                    className="p-1 text-panel-muted hover:text-panel-red rounded transition-colors"
                    title="Löschen"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Button size="sm" className="w-full" onClick={openAddHost}>
            <Plus size={13} className="mr-1" />Host hinzufügen
          </Button>
        </Card>

        {/* SSH Keys */}
        <Card title="SSH Keys" className="flex-shrink-0">
          <div className="space-y-0.5 -mx-1 mb-2">
            {keys.length === 0 && (
              <p className="text-xs text-panel-muted py-2 text-center">Noch keine Keys</p>
            )}
            {keys.map(key => (
              <div key={key.id} className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-panel-surface group">
                <Key size={12} className="text-panel-muted flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-panel-text truncate">{key.label}</p>
                  {key.public_key && (
                    <p className="text-xs text-panel-muted font-mono truncate">
                      {key.public_key.startsWith('ppk:') ? key.public_key : key.public_key.split(' ')[0] + ' ···'}
                    </p>
                  )}
                </div>
                <button
                  onClick={async () => {
                    // Public Key laden (on-the-fly extrahieren falls PPK-Platzhalter)
                    try {
                      const { data } = await axios.get(`/api/ssh/keys/${key.id}/public`);
                      setShowPubKeyModal({ label: key.label, public_key: data.public_key });
                      setPubKeyCopied(false);
                      // Lokalen State aktualisieren
                      setKeys(ks => ks.map(k => k.id === key.id ? { ...k, public_key: data.public_key } : k));
                    } catch (e) {
                      alert(e.response?.data?.error || 'Fehler beim Laden des Public Keys');
                    }
                  }}
                  className="p-1 text-panel-muted hover:text-panel-accent rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Public Key anzeigen"
                >
                  <Copy size={11} />
                </button>
                <button
                  onClick={() => deleteKey(key.id)}
                  className="p-1 text-panel-muted hover:text-panel-red rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Löschen"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <Button size="sm" className="w-full" onClick={() => { setKeyLabel(''); setGeneratedPub(null); setFormError(''); setShowGenKey(true); }}>
              <Key size={13} className="mr-1" />Neuen Key generieren
            </Button>
            <Button size="sm" variant="ghost" className="w-full" onClick={() => { setImportForm({ label: '', privateKey: '' }); setFormError(''); setShowImportKey(true); }}>
              <Upload size={13} className="mr-1" />Key importieren
            </Button>
          </div>
        </Card>
      </div>

      {/* ── Haupt-Panel (Terminal + SFTP) ── */}
      <div className="flex-1 flex flex-col min-w-0 rounded-lg border border-panel-border overflow-hidden bg-panel-card">

        {/* ── Tab-Leiste ── */}
        <div className="flex items-center bg-panel-surface border-b border-panel-border flex-shrink-0">
          {/* Tabs */}
          <button
            onClick={() => setActiveTab('terminal')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs border-r border-panel-border transition-colors ${
              activeTab === 'terminal'
                ? 'bg-[#0d1117] text-panel-text'
                : 'text-panel-muted hover:text-panel-text hover:bg-panel-surface/80'
            }`}
          >
            <TerminalIcon size={13} />
            Terminal
          </button>
          <button
            onClick={() => setActiveTab('sftp')}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs border-r border-panel-border transition-colors ${
              activeTab === 'sftp'
                ? 'bg-panel-card text-panel-text'
                : 'text-panel-muted hover:text-panel-text hover:bg-panel-surface/80'
            }`}
          >
            <FolderOpen size={13} />
            SFTP
          </button>

          <div className="flex-1" />

          {/* Rechte Seite: Status / Info */}
          {activeTab === 'terminal' && (
            <div className="flex items-center gap-2 pr-2">
              <span className={`text-xs ${statusTextCls}`}>{statusLabel}</span>
              {sshStatus === 'connected' && (
                <Button size="sm" variant="ghost" onClick={disconnect}>
                  <Unplug size={13} className="mr-1" />Trennen
                </Button>
              )}
            </div>
          )}
          {activeTab === 'sftp' && activeHost && (
            <span className="text-xs text-panel-muted pr-3 font-mono">
              {activeHost.username}@{activeHost.hostname}:{activeHost.port || 22}
            </span>
          )}
        </div>

        {/* xterm Container — immer im DOM, nur versteckt wenn SFTP aktiv */}
        <div
          ref={termDivRef}
          className="flex-1 overflow-hidden p-1"
          style={{ minHeight: 0, display: activeTab === 'terminal' ? undefined : 'none', background: '#0d1117' }}
        />

        {/* SFTP Browser */}
        {activeTab === 'sftp' && <SftpBrowser host={activeHost} />}
      </div>

      {/* ════ Modal: Host hinzufügen / bearbeiten ════ */}
      <Modal
        open={showAddHost}
        onClose={() => { setShowAddHost(false); setEditingHost(null); }}
        title={editingHost ? 'Host bearbeiten' : 'SSH Host hinzufügen'}
        footer={<>
          <Button variant="ghost" size="sm" onClick={() => { setShowAddHost(false); setEditingHost(null); }}>
            Abbrechen
          </Button>
          <Button size="sm" onClick={saveHost}
            disabled={!hostForm.label || !hostForm.hostname || !hostForm.username}>
            Speichern
          </Button>
        </>}
      >
        <div className="space-y-3">
          {formError && <p className="text-xs text-panel-red">{formError}</p>}
          {[
            ['Label',           'label',    'text',   'z.B. Prod-Server'],
            ['Hostname / IP',   'hostname', 'text',   '192.168.1.10'],
            ['Benutzername',    'username', 'text',   'root'],
          ].map(([label, key, type, ph]) => (
            <div key={key}>
              <label className="block text-xs text-panel-muted mb-1">{label}</label>
              <input
                type={type}
                value={hostForm[key]}
                onChange={e => setHostForm(f => ({ ...f, [key]: e.target.value }))}
                placeholder={ph}
                className={inputCls}
              />
            </div>
          ))}
          {/* Port – eigenes Feld, da numerisch */}
          <div>
            <label className="block text-xs text-panel-muted mb-1">SSH Port</label>
            <input
              type="number"
              min={1}
              max={65535}
              value={hostForm.port}
              onChange={e => setHostForm(f => ({ ...f, port: e.target.value }))}
              placeholder="22"
              className={inputCls}
            />
            <p className="text-xs text-panel-muted mt-1">Standard: 22 — jeder Server kann einen anderen Port haben</p>
          </div>
          <div>
            <label className="block text-xs text-panel-muted mb-1">SSH Key</label>
            <select
              value={hostForm.ssh_key_id}
              onChange={e => setHostForm(f => ({ ...f, ssh_key_id: e.target.value }))}
              className={inputCls}
            >
              <option value="">— Key auswählen —</option>
              {keys.map(k => (
                <option key={k.id} value={k.id}>{k.label}</option>
              ))}
            </select>
            {keys.length === 0 && (
              <p className="text-xs text-panel-muted mt-1">Zuerst einen SSH-Key anlegen</p>
            )}
          </div>
        </div>
      </Modal>

      {/* ════ Modal: Key generieren ════ */}
      <Modal
        open={showGenKey}
        onClose={() => { setShowGenKey(false); setGeneratedPub(null); }}
        title="SSH Key generieren (Ed25519)"
        footer={!generatedPub ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowGenKey(false)}>Abbrechen</Button>
            <Button size="sm" onClick={generateKey}>Generieren</Button>
          </>
        ) : (
          <Button size="sm" onClick={() => { setShowGenKey(false); setGeneratedPub(null); }}>
            Schließen
          </Button>
        )}
      >
        {!generatedPub ? (
          <div className="space-y-3">
            {formError && <p className="text-xs text-panel-red">{formError}</p>}
            <div>
              <label className="block text-xs text-panel-muted mb-1">Label</label>
              <input
                value={keyLabel}
                onChange={e => setKeyLabel(e.target.value)}
                placeholder="z.B. Mein Laptop"
                className={inputCls}
              />
            </div>
            <p className="text-xs text-panel-muted">
              Ed25519-Keypair wird serverseitig generiert. Der Private Key wird
              AES-256-GCM-verschlüsselt gespeichert und verlässt den Server nie.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-panel-green flex items-center gap-1">
              <CheckCircle size={13} /> Key erfolgreich generiert
            </p>
            <div>
              <label className="block text-xs text-panel-muted mb-1">
                Public Key — in <code className="text-panel-text text-xs">~/.ssh/authorized_keys</code> des Ziel-Servers eintragen:
              </label>
              <div className="relative">
                <textarea
                  readOnly
                  value={generatedPub}
                  rows={4}
                  className={`${inputCls} font-mono text-xs resize-none pr-8`}
                />
                <button
                  onClick={copyPubKey}
                  className="absolute top-2 right-2 text-panel-muted hover:text-panel-text transition-colors"
                  title="Kopieren"
                >
                  {copied
                    ? <CheckCircle size={13} className="text-panel-green" />
                    : <Copy size={13} />}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ════ Modal: Key importieren ════ */}
      <Modal
        open={showImportKey}
        onClose={() => { setShowImportKey(false); setKeyFileDrag(false); }}
        title="SSH Key importieren"
        footer={<>
          <Button variant="ghost" size="sm" onClick={() => setShowImportKey(false)}>Abbrechen</Button>
          <Button size="sm" onClick={importKey} disabled={!importForm.privateKey.trim()}>
            Importieren
          </Button>
        </>}
      >
        <div className="space-y-3">
          {formError && <p className="text-xs text-panel-red">{formError}</p>}

          {/* Label */}
          <div>
            <label className="block text-xs text-panel-muted mb-1">Label</label>
            <input
              value={importForm.label}
              onChange={e => setImportForm(f => ({ ...f, label: e.target.value }))}
              placeholder="z.B. Mailserver Key"
              className={inputCls}
            />
          </div>

          {/* Drop-Zone */}
          <div
            onClick={() => keyFileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setKeyFileDrag(true); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setKeyFileDrag(false); }}
            onDrop={e => {
              e.preventDefault();
              setKeyFileDrag(false);
              readKeyFile(e.dataTransfer.files[0]);
            }}
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 cursor-pointer transition-colors select-none ${
              keyFileDrag
                ? 'border-panel-accent bg-panel-accent/10 text-panel-accent'
                : 'border-panel-border hover:border-panel-accent/50 hover:bg-panel-surface/50 text-panel-muted'
            }`}
          >
            <FileKey size={22} className={keyFileDrag ? 'text-panel-accent' : 'text-panel-muted/50'} />
            <p className="text-xs text-center">
              {keyFileDrag
                ? 'Datei loslassen…'
                : <><span className="text-panel-text font-medium">Datei auswählen</span> oder hierher ziehen</>
              }
            </p>
            <p className="text-[10px] opacity-60">.ppk · .pem · .key · alle Textdateien</p>
          </div>
          <input
            ref={keyFileRef}
            type="file"
            accept=".ppk,.pem,.key,.txt,text/*"
            className="hidden"
            onChange={e => { readKeyFile(e.target.files[0]); e.target.value = ''; }}
          />

          {/* Textarea — zum manuellen Einfügen / Korrigieren */}
          <div>
            <label className="block text-xs text-panel-muted mb-1">
              oder direkt einfügen
              {importForm.privateKey && (
                <button
                  onClick={() => setImportForm(f => ({ ...f, privateKey: '' }))}
                  className="ml-2 text-panel-red hover:opacity-80 transition-opacity"
                  title="Leeren"
                >
                  ×
                </button>
              )}
            </label>
            <textarea
              value={importForm.privateKey}
              onChange={e => setImportForm(f => ({ ...f, privateKey: e.target.value }))}
              rows={5}
              spellCheck={false}
              placeholder={`PuTTY PPK:\nPuTTY-User-Key-File-2: ssh-rsa\n...\n\nOpenSSH PEM:\n-----BEGIN OPENSSH PRIVATE KEY-----\n...`}
              className={`${inputCls} font-mono text-xs resize-none`}
            />
          </div>

          <p className="text-xs text-panel-muted">
            Unterstützt: OpenSSH PEM und PuTTY PPK (v2 &amp; v3, ohne Passwort).
            Wird AES-256-GCM-verschlüsselt gespeichert.
          </p>
        </div>
      </Modal>

      {/* ════ Modal: Public Key anzeigen ════ */}
      <Modal
        open={!!showPubKeyModal}
        onClose={() => setShowPubKeyModal(null)}
        title={`Public Key — ${showPubKeyModal?.label ?? ''}`}
        footer={
          <Button size="sm" onClick={() => {
            navigator.clipboard.writeText(showPubKeyModal?.public_key ?? '');
            setPubKeyCopied(true);
            setTimeout(() => setPubKeyCopied(false), 2500);
          }}>
            {pubKeyCopied ? <><CheckCircle size={13} className="mr-1 text-panel-green" />Kopiert!</> : <><Copy size={13} className="mr-1" />Kopieren</>}
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-panel-muted">
            Diesen Public Key in <code className="text-panel-text">~/.ssh/authorized_keys</code> auf dem Ziel-Server eintragen:
          </p>
          <textarea
            readOnly
            value={showPubKeyModal?.public_key ?? ''}
            rows={4}
            className={`${inputCls} font-mono text-xs resize-none`}
          />
          <p className="text-xs text-panel-muted">
            Auf dem Server ausführen:{' '}
            <code className="text-panel-text text-xs">echo "KEY" &gt;&gt; ~/.ssh/authorized_keys</code>
          </p>
        </div>
      </Modal>
    </div>
  );
}
