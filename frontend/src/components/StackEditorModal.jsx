import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { X, Save, Play, Check } from 'lucide-react';
import axios from 'axios';
import { Button } from './ui/Button';

export function StackEditorModal({ serverId, stackId, stackName, onClose, onDeploy }) {
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`/api/agents/${serverId}/docker/stacks/${encodeURIComponent(stackId)}/file`);
      setContent(data.content || '');
      setOriginal(data.content || '');
    } catch (err) {
      setError(err.response?.data?.error || 'Datei konnte nicht geladen werden');
    }
    setLoading(false);
  };

  const save = async (deploy = false) => {
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      await axios.put(`/api/agents/${serverId}/docker/stacks/${encodeURIComponent(stackId)}/file`, {
        content
      });
      setOriginal(content);
      if (deploy) {
        onDeploy();
        onClose();
      } else {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Fehler beim Speichern');
    }
    setSaving(false);
  };

  const hasChanges = content !== original;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-panel-bg w-full max-w-5xl h-[85vh] flex flex-col rounded-xl shadow-2xl border border-panel-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border bg-panel-surface">
          <div className="flex flex-col">
            <h3 className="text-sm font-semibold text-panel-text flex items-center gap-2">
              Stack-Editor: {stackName || stackId}
              {hasChanges && <span className="text-[10px] bg-panel-orange/20 text-panel-orange px-1.5 py-0.5 rounded uppercase">Ungespeichert</span>}
            </h3>
            <span className="text-[11px] text-panel-muted font-mono">{stackId}</span>
          </div>
          <button onClick={onClose} className="p-1 text-panel-muted hover:text-panel-text transition-colors rounded-lg hover:bg-panel-card">
            <X size={18} />
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 min-h-0 relative bg-[#1e1e1e]">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center text-panel-muted text-sm">
              Lade Datei...
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <div className="bg-panel-red/10 border border-panel-red/20 text-panel-red text-sm rounded p-4 max-w-md">
                {error}
              </div>
            </div>
          ) : (
             <Editor
              height="100%"
              defaultLanguage="yaml"
              theme="vs-dark"
              value={content}
              onChange={val => setContent(val || '')}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                tabSize: 2,
                insertSpaces: true
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-panel-border bg-panel-surface">
          <div className="text-sm">
            {success && <span className="text-panel-green flex items-center gap-1"><Check size={14} /> Gespeichert</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
            <Button
              variant="outline"
              disabled={loading || saving || !hasChanges}
              onClick={() => save(false)}
            >
              <Save size={14} className="mr-1.5" /> Speichern
            </Button>
            <Button
              variant="success"
              disabled={loading || saving}
              onClick={() => save(true)}
            >
              <Play size={14} className="mr-1.5" /> Speichern & Live-Deploy
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
