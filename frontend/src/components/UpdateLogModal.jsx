import { useState, useEffect } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Sparkles, GitCommit, Clock, User, ArrowRight, FileText, ExternalLink } from 'lucide-react';

export const UpdateLogModal = () => {
  const [updateData, setUpdateData] = useState(null);
  const [activeTab, setActiveTab] = useState('changelog'); // 'changelog' | 'commits'

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
        <div className="flex items-center justify-between w-full">
          <a
            href="https://github.com/RoobiinG/ueberwachungs-panel/blob/master/CHANGELOG.md"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-panel-muted hover:text-panel-accent flex items-center gap-1 transition-colors"
          >
            <ExternalLink size={13} /> Vollständiger Log auf GitHub
          </a>
          <Button onClick={() => setUpdateData(null)}>
            Verstanden & Schließen
          </Button>
        </div>
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

        {/* Tab-Navigation: Changelog (Nachwirken) vs. Git-Commits */}
        <div className="flex border-b border-panel-border text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('changelog')}
            className={`flex items-center gap-1.5 py-2 px-3 font-medium border-b-2 transition-colors ${
              activeTab === 'changelog'
                ? 'border-panel-accent text-panel-accent'
                : 'border-transparent text-panel-muted hover:text-panel-text'
            }`}
          >
            <FileText size={13} />
            Update-Log & Nachwirken
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('commits')}
            className={`flex items-center gap-1.5 py-2 px-3 font-medium border-b-2 transition-colors ${
              activeTab === 'commits'
                ? 'border-panel-accent text-panel-accent'
                : 'border-transparent text-panel-muted hover:text-panel-text'
            }`}
          >
            <GitCommit size={13} />
            Git-Commits ({Array.isArray(updateData.log) ? updateData.log.length : 0})
          </button>
        </div>

        {/* Tab 1: Changelog & Nachwirkung */}
        {activeTab === 'changelog' && (
          <div className="max-h-64 overflow-y-auto space-y-2 pr-1 text-xs text-panel-text leading-relaxed">
            {updateData.changelogEntry ? (
              <pre className="whitespace-pre-wrap font-sans text-xs bg-panel-surface/50 border border-panel-border/60 rounded-lg p-3">
                {updateData.changelogEntry}
              </pre>
            ) : (
              <div className="bg-panel-surface/50 border border-panel-border/60 rounded-lg p-3 space-y-2">
                <p className="font-semibold text-panel-accent">✨ Neue Funktionen & Nachwirkung:</p>
                <ul className="list-disc list-inside space-y-1 text-panel-muted">
                  <li><strong>Automatisches Panel-Update</strong> via GitHub-Token im privaten Repository mit direktem Neustart.</li>
                  <li><strong>Zwei-Faktor-Authentifizierung (2FA)</strong> über Authenticator-App (TOTP/QR-Code) und per E-Mail in Einstellungen.</li>
                  <li><strong>Nachwirken / System-Auswirkungen:</strong> Datenbank wurde beim Neustart automatisch erweitert (2FA-Spalten). Bestehende Agenten laufen reibungslos weiter.</li>
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Scrollbare Commit-Liste */}
        {activeTab === 'commits' && (
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
        )}
      </div>
    </Modal>
  );
};

