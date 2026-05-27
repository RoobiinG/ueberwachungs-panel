import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import {
  Folder, File, ArrowUp, RefreshCw, Upload,
  FolderPlus, Trash2, Pencil, Download,
  ChevronRight, Home, AlertCircle,
} from 'lucide-react';

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

const joinPath = (base, name) => base === '/' ? `/${name}` : `${base}/${name}`;

const parentPath = (p) => {
  if (!p || p === '/') return '/';
  const parts = p.split('/').filter(Boolean);
  parts.pop();
  return parts.length === 0 ? '/' : '/' + parts.join('/');
};

const fmtSize = (bytes) => {
  if (bytes === 0) return '0 B';
  if (!bytes) return '—';
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1_048_576)  return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
};

const fmtDate = (ms) => {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
};

// ─── SftpBrowser ──────────────────────────────────────────────────────────────

export default function SftpBrowser({ host }) {
  const [path,       setPath]       = useState(null);     // null = noch nicht geladen
  const [entries,    setEntries]    = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [uploading,  setUploading]  = useState(false);
  const [dragOver,   setDragOver]   = useState(false);

  // Inline-Rename: Name des gerade umzubenennenden Eintrags
  const [renamingName,  setRenamingName]  = useState(null);
  const [renameValue,   setRenameValue]   = useState('');

  // Neuer Ordner
  const [mkdirMode,  setMkdirMode]  = useState(false);
  const [mkdirValue, setMkdirValue] = useState('');

  const fileInputRef = useRef(null);

  // ── Verzeichnis laden ──────────────────────────────────────────────────────

  const load = async (dir, silent = false) => {
    if (!host) return;
    if (!silent) { setLoading(true); setError(''); }
    try {
      const { data } = await axios.get('/api/sftp/ls', {
        params: { hostId: host.id, path: dir },
      });
      setPath(data.path);
      setEntries(data.entries);
    } catch (err) {
      if (!silent) setError(err.response?.data?.error || 'Verzeichnis konnte nicht geladen werden');
    }
    if (!silent) setLoading(false);
  };

  // Wenn Host wechselt → Heimverzeichnis laden ('.' → wird vom Server aufgelöst)
  useEffect(() => {
    if (!host) { setPath(null); setEntries([]); return; }
    setPath(null);
    setEntries([]);
    setMkdirMode(false);
    setRenamingName(null);
    load('.');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host?.id]);

  // ── Navigation ─────────────────────────────────────────────────────────────

  const navigate = (entry) => {
    if (entry.type !== 'd') return;
    setMkdirMode(false);
    setRenamingName(null);
    load(joinPath(path, entry.name));
  };

  const goTo = (p) => {
    setMkdirMode(false);
    setRenamingName(null);
    load(p);
  };

  // ── Download ───────────────────────────────────────────────────────────────

  const download = async (entry) => {
    setError('');
    try {
      const { data } = await axios.get('/api/sftp/download', {
        params:       { hostId: host.id, path: joinPath(path, entry.name) },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(data);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = entry.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      // Fix #8: Bei responseType:'blob' ist err.response.data ein Blob, kein Objekt
      let msg = 'Download fehlgeschlagen';
      try {
        if (err.response?.data instanceof Blob) {
          const text = await err.response.data.text();
          msg = JSON.parse(text).error || msg;
        } else {
          msg = err.response?.data?.error || err.message || msg;
        }
      } catch {}
      setError(msg);
    }
  };

  // ── Upload ─────────────────────────────────────────────────────────────────

  const uploadFiles = async (files) => {
    if (!files.length || !path) return;
    setUploading(true);
    setError('');
    for (const file of files) {
      try {
        await axios.post('/api/sftp/upload', file, {
          params:  { hostId: host.id, path: joinPath(path, file.name) },
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
      } catch (err) {
        setError(`Upload von "${file.name}" fehlgeschlagen: ${err.response?.data?.error || err.message}`);
        break;
      }
    }
    setUploading(false);
    load(path, true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Drag & Drop ────────────────────────────────────────────────────────────

  const handleDragOver  = (e) => { e.preventDefault(); if (!dragOver) setDragOver(true); };
  // Fix #10: dragLeave nur auslösen wenn der Cursor wirklich das Element verlässt
  //          (nicht bei Kind-Elementen, die sonst fälschlich leave auslösen)
  const handleDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) uploadFiles(files);
  };

  // ── Neuer Ordner ───────────────────────────────────────────────────────────

  const commitMkdir = async () => {
    const name = mkdirValue.trim();
    if (!name) { setMkdirMode(false); return; }
    // Fix #9: Pfad-Traversal und Slash im Namen verhindern
    if (name === '.' || name === '..' || name.includes('/')) {
      setError('Ungültiger Ordnername (kein ".", ".." oder "/" erlaubt)');
      return;
    }
    setError('');
    try {
      await axios.post('/api/sftp/mkdir', { hostId: host.id, path: joinPath(path, name) });
      setMkdirMode(false);
      setMkdirValue('');
      load(path, true);
    } catch (err) {
      setError(err.response?.data?.error || 'Ordner konnte nicht erstellt werden');
    }
  };

  // ── Löschen ────────────────────────────────────────────────────────────────

  const deleteEntry = async (entry) => {
    if (!confirm(`"${entry.name}" löschen?`)) return;
    setError('');
    try {
      await axios.delete('/api/sftp', {
        data: { hostId: host.id, path: joinPath(path, entry.name), type: entry.type },
      });
      load(path, true);
    } catch (err) {
      setError(err.response?.data?.error || 'Löschen fehlgeschlagen');
    }
  };

  // ── Umbenennen ─────────────────────────────────────────────────────────────

  const startRename = (entry) => {
    setRenamingName(entry.name);
    setRenameValue(entry.name);
    setMkdirMode(false);
  };

  const commitRename = async (entry) => {
    const newName = renameValue.trim();
    setRenamingName(null);
    if (!newName || newName === entry.name) return;
    // Fix #9: Pfad-Traversal und Slash im Namen verhindern
    if (newName === '.' || newName === '..' || newName.includes('/')) {
      setError('Ungültiger Name (kein ".", ".." oder "/" erlaubt)');
      return;
    }
    setError('');
    try {
      await axios.post('/api/sftp/rename', {
        hostId:  host.id,
        oldPath: joinPath(path, entry.name),
        newPath: joinPath(path, newName),
      });
      load(path, true);
    } catch (err) {
      setError(err.response?.data?.error || 'Umbenennen fehlgeschlagen');
    }
  };

  // ── Breadcrumb ─────────────────────────────────────────────────────────────

  const pathParts = path && path !== '/' ? path.split('/').filter(Boolean) : [];

  // ── Kein Host ausgewählt ───────────────────────────────────────────────────

  if (!host) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-panel-muted">
        <Folder size={32} className="opacity-30" />
        <p className="text-sm">Kein Host ausgewählt</p>
        <p className="text-xs opacity-60">Host in der Seitenleiste auswählen</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className={`flex-1 flex flex-col min-h-0 overflow-hidden transition-colors ${dragOver ? 'bg-panel-accent/5' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-panel-border flex-shrink-0 bg-panel-surface">

        {/* Breadcrumb */}
        <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-hidden text-xs font-mono">
          <button
            onClick={() => path && goTo('/')}
            className="flex-shrink-0 p-1 rounded text-panel-muted hover:text-panel-text transition-colors"
            title="Stammverzeichnis"
          >
            <Home size={12} />
          </button>
          {pathParts.map((part, i) => {
            const target = '/' + pathParts.slice(0, i + 1).join('/');
            return (
              <span key={i} className="flex items-center gap-0.5 flex-shrink-0 min-w-0">
                <ChevronRight size={11} className="text-panel-muted/40 flex-shrink-0" />
                <button
                  onClick={() => goTo(target)}
                  className="max-w-[120px] truncate text-panel-muted hover:text-panel-text transition-colors"
                  title={target}
                >
                  {part}
                </button>
              </span>
            );
          })}
          {path === null && <span className="text-panel-muted animate-pulse ml-1">Lade…</span>}
        </div>

        {/* Aktions-Buttons */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => path && goTo(parentPath(path))}
            disabled={!path || path === '/'}
            className="p-1.5 rounded text-panel-muted hover:text-panel-text hover:bg-panel-card disabled:opacity-30 transition-colors"
            title="Übergeordneter Ordner"
          >
            <ArrowUp size={13} />
          </button>
          <button
            onClick={() => path && load(path)}
            disabled={!path}
            className="p-1.5 rounded text-panel-muted hover:text-panel-text hover:bg-panel-card disabled:opacity-30 transition-colors"
            title="Aktualisieren"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={() => { setMkdirMode(true); setMkdirValue(''); setRenamingName(null); }}
            disabled={!path}
            className="p-1.5 rounded text-panel-muted hover:text-panel-text hover:bg-panel-card disabled:opacity-30 transition-colors"
            title="Neuer Ordner"
          >
            <FolderPlus size={13} />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!path || uploading}
            className="p-1.5 rounded text-panel-muted hover:text-panel-text hover:bg-panel-card disabled:opacity-30 transition-colors"
            title="Dateien hochladen"
          >
            <Upload size={13} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={e => uploadFiles(Array.from(e.target.files))}
          />
        </div>
      </div>

      {/* ── Fehlermeldung ───────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-panel-red/10 border-b border-panel-red/30 text-panel-red text-xs flex-shrink-0">
          <AlertCircle size={12} className="flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="underline opacity-70 hover:opacity-100">×</button>
        </div>
      )}

      {/* ── Upload-Hinweis ───────────────────────────────────────────────── */}
      {(uploading || dragOver) && (
        <div className="px-3 py-2 bg-panel-accent/10 border-b border-panel-accent/30 text-panel-accent text-xs flex-shrink-0 animate-pulse">
          {dragOver ? 'Dateien hierher ziehen zum Hochladen…' : 'Upload läuft…'}
        </div>
      )}

      {/* ── Dateiliste ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-panel-muted text-sm gap-2">
            <RefreshCw size={14} className="animate-spin" />
            Lade Verzeichnis…
          </div>
        ) : (
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col />
              <col className="w-24" />
              <col className="w-36" />
              <col className="w-24" />
            </colgroup>
            <thead className="border-b border-panel-border text-xs text-panel-muted sticky top-0 bg-panel-card z-10">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-right font-medium">Größe</th>
                <th className="px-3 py-2 text-right font-medium">Geändert</th>
                <th className="px-3 py-2 text-right font-medium">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-panel-border/40">

              {/* Neuer-Ordner-Zeile */}
              {mkdirMode && (
                <tr className="bg-panel-accent/5">
                  <td colSpan={4} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Folder size={14} className="text-panel-accent flex-shrink-0" />
                      <input
                        autoFocus
                        value={mkdirValue}
                        onChange={e => setMkdirValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter')  commitMkdir();
                          if (e.key === 'Escape') { setMkdirMode(false); setMkdirValue(''); }
                        }}
                        placeholder="Ordnername"
                        className="flex-1 bg-transparent text-sm text-panel-text outline-none border-b border-panel-accent font-mono"
                      />
                      <button onClick={commitMkdir} className="text-xs text-panel-accent hover:text-panel-text transition-colors">
                        ✓
                      </button>
                      <button onClick={() => { setMkdirMode(false); setMkdirValue(''); }} className="text-xs text-panel-muted hover:text-panel-text transition-colors">
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {/* Leer-Hinweis */}
              {entries.length === 0 && !mkdirMode && (
                <tr>
                  <td colSpan={4} className="px-3 py-12 text-center text-panel-muted text-xs">
                    Leeres Verzeichnis
                  </td>
                </tr>
              )}

              {/* Einträge */}
              {entries.map(entry => (
                <tr
                  key={entry.name}
                  className={`group transition-colors ${
                    entry.type === 'd'
                      ? 'hover:bg-panel-surface/60 cursor-pointer'
                      : 'hover:bg-panel-surface/40'
                  }`}
                  onDoubleClick={() => entry.type === 'd' && navigate(entry)}
                >
                  {/* Name */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {entry.type === 'd'
                        ? <Folder size={14} className="text-panel-accent flex-shrink-0" />
                        : <File   size={14} className="text-panel-muted/60 flex-shrink-0" />
                      }
                      {renamingName === entry.name ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter')  commitRename(entry);
                            if (e.key === 'Escape') setRenamingName(null);
                          }}
                          onBlur={() => commitRename(entry)}
                          className="flex-1 bg-transparent text-sm text-panel-text outline-none border-b border-panel-accent font-mono"
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="text-panel-text truncate text-sm font-mono"
                          onClick={() => entry.type === 'd' && navigate(entry)}
                        >
                          {entry.name}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Größe */}
                  <td className="px-3 py-2 text-right text-xs text-panel-muted font-mono whitespace-nowrap">
                    {entry.type === 'd' ? '—' : fmtSize(entry.size)}
                  </td>

                  {/* Datum */}
                  <td className="px-3 py-2 text-right text-xs text-panel-muted whitespace-nowrap">
                    {fmtDate(entry.modified)}
                  </td>

                  {/* Aktionen */}
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {entry.type === 'f' && (
                        <button
                          onClick={() => download(entry)}
                          className="p-1 rounded text-panel-muted hover:text-panel-accent transition-colors"
                          title="Herunterladen"
                        >
                          <Download size={12} />
                        </button>
                      )}
                      <button
                        onClick={() => startRename(entry)}
                        className="p-1 rounded text-panel-muted hover:text-panel-text transition-colors"
                        title="Umbenennen"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => deleteEntry(entry)}
                        className="p-1 rounded text-panel-muted hover:text-panel-red transition-colors"
                        title="Löschen"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
