import { useState, useEffect } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Sparkles, GitCommit, Clock, User, ArrowRight } from 'lucide-react';

export const UpdateLogModal = () => {
  const [updateData, setUpdateData] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('panel_update_result');
      if (raw) {
        const data = JSON.parse(raw);
        // Nur anzeigen, wenn das Update in den letzten 15 Minuten war
        if (data && data.timestamp && Date.now() - data.timestamp < 15 * 60 * 1000) {
          localStorage.removeItem('panel_update_result');
          setUpdateData(data);
        } else {
          localStorage.removeItem('panel_update_result');
        }
      }
    } catch (err) {
      console.warn('Update-Log verarbeiten fehlgeschlagen:', err);
    }
  }, []);

  if (!updateData) return null;

  return (
    <Modal
      open={true}
      onClose={() => setUpdateData(null)}
      title={
        <span className="flex items-center gap-2 text-panel-accent">
          <Sparkles size={16} className="text-yellow-400" />
          Panel erfolgreich aktualisiert!
        </span>
      }
      footer={
        <Button onClick={() => setUpdateData(null)}>
          Verstanden & Schließen
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Versions-Vergleich Badge */}
        <div className="flex items-center justify-between bg-panel-surface border border-panel-border rounded-lg p-3 text-xs">
          <div>
            <span className="text-panel-muted block text-[11px]">Vorherige Version</span>
            <span className="font-semibold text-panel-text">{updateData.oldVersion || 'Unbekannt'}</span>
          </div>
          <ArrowRight size={16} className="text-panel-muted/50" />
          <div className="text-right">
            <span className="text-panel-muted block text-[11px]">Aktuelle Version</span>
            <span className="font-semibold text-emerald-400">{updateData.newVersion || 'Unbekannt'}</span>
          </div>
        </div>

        <p className="text-xs text-panel-muted leading-relaxed">
          Das Überwachungs-Panel wurde automatisch vom privaten GitHub-Repository auf den neuesten Stand gebracht und neu gestartet. Hier ist der <strong>Update Log (letzte Änderungen)</strong>:
        </p>

        {/* Scrollbare Commit-Liste */}
        <div className="max-h-64 overflow-y-auto space-y-2 pr-1 border border-panel-border/60 rounded-lg p-2.5 bg-panel-surface/50">
          {Array.isArray(updateData.log) && updateData.log.length > 0 ? (
            updateData.log.map((item, idx) => (
              <div key={idx} className="border-b border-panel-border/40 last:border-0 pb-2 last:pb-0 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <GitCommit size={13} className="text-panel-accent flex-shrink-0" />
                    <span className="font-mono font-bold text-panel-accent text-[11px] flex-shrink-0">
                      {item.hash}
                    </span>
                    <span className="text-panel-text font-medium truncate">
                      {item.subject}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-panel-muted pl-5">
                  {item.author && (
                    <span className="flex items-center gap-1">
                      <User size={10} /> {item.author}
                    </span>
                  )}
                  {item.time && (
                    <span className="flex items-center gap-1">
                      <Clock size={10} /> {item.time}
                    </span>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-4 text-xs text-panel-muted">
              Kein detailliertes Commit-Log verfügbar.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
