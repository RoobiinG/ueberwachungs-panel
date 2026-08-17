// ─── ActionMenu ───────────────────────────────────────────────────────────────
// Aufklappmenü für seltener gebrauchte Aktionen einer Listenzeile. Die häufigen
// Aktionen (Start, Stopp, Neustart …) stehen weiterhin als beschriftete Knöpfe
// daneben — hier landet alles, was die Zeile sonst überfüllen würde.
//
// Jeder Eintrag hat Symbol *und* Text, damit nirgends geraten werden muss, was
// ein Knopf tut.
//
// Das Menü hängt bewusst per Portal am <body> und wird fest positioniert:
// Die Karten (`Card`) haben `overflow-hidden`, ein absolut positioniertes Menü
// würde darin abgeschnitten.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { buttonClasses } from './Button';

export const ActionMenu = ({
  items = [],
  label = 'Mehr',
  size = 'sm',
  variant = 'ghost',
  disabled = false,
  title = 'Weitere Aktionen',
  className = '',
}) => {
  const [open, setOpen]   = useState(false);
  const [pos,  setPos]    = useState({ top: 0, left: 0, width: 0 });
  const triggerRef        = useRef(null);
  const menuRef           = useRef(null);

  const visible = items.filter(i => i && !i.hidden);

  // Position erst nach dem Rendern bestimmen, damit die tatsächliche Menühöhe
  // bekannt ist und nach oben ausgewichen werden kann, wenn unten kein Platz ist.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect     = triggerRef.current.getBoundingClientRect();
    const menuH    = menuRef.current?.offsetHeight ?? 0;
    const menuW    = menuRef.current?.offsetWidth  ?? 180;
    const spaceBel = window.innerHeight - rect.bottom;

    const top  = (spaceBel < menuH + 12 && rect.top > menuH + 12)
      ? rect.top - menuH - 4
      : rect.bottom + 4;

    // Rechtsbündig zum Auslöser, aber nie über den Fensterrand hinaus.
    const left = Math.min(
      Math.max(8, rect.right - menuW),
      Math.max(8, window.innerWidth - menuW - 8)
    );

    setPos({ top, left, width: menuW });
  }, [open, visible.length]);

  // Klick daneben, Escape, Scrollen und Größenänderung schließen das Menü.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e) => {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey    = (e) => { if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    const onScroll = () => setOpen(false);

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  if (!visible.length) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={buttonClasses(variant, size, className)}
      >
        <MoreHorizontal size={13} />
        {label}
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-[60] min-w-[11rem] bg-panel-card border border-panel-border rounded-md shadow-2xl py-1 overflow-hidden"
        >
          {visible.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onClick={() => { setOpen(false); item.onClick?.(); }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed
                ${item.danger
                  ? 'text-panel-red hover:bg-panel-red/10 disabled:hover:bg-transparent'
                  : 'text-panel-text hover:bg-panel-surface disabled:hover:bg-transparent'}`}
            >
              {item.icon && <item.icon size={13} className="flex-shrink-0" />}
              <span className="flex-1">{item.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
};
