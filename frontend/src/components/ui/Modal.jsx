import { X } from 'lucide-react';
import { useEffect } from 'react';

// Breiten-Stufen. `lg` bleibt die Voreinstellung, damit sich für alle bestehenden
// Dialoge nichts ändert; `wide` und `full` sind für die Container-Konsole dazugekommen.
const BREITEN = {
  lg:   'max-w-lg',
  wide: 'max-w-6xl',
  full: 'max-w-none w-[98vw]',
};

export const Modal = ({ open, onClose, title, children, footer, zIndex = 'z-50', size = 'lg', headerExtra = null }) => {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={`fixed inset-0 ${zIndex} flex items-center justify-center`}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-panel-card border border-panel-border rounded-lg shadow-2xl w-full ${BREITEN[size] ?? BREITEN.lg} mx-4`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-panel-border gap-3">
          <h2 className="text-sm font-semibold text-panel-text truncate">{title}</h2>
          <div className="flex items-center gap-1 flex-shrink-0">
            {headerExtra}
            <button onClick={onClose} title="Schließen" className="text-panel-muted hover:text-panel-text transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="p-4">{children}</div>
        {footer && (
          <div className="px-4 py-3 border-t border-panel-border flex justify-end gap-2">{footer}</div>
        )}
      </div>
    </div>
  );
};
