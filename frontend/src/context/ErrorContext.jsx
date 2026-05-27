import { createContext, useContext, useState, useCallback } from 'react';

// ─── Konstanten ──────────────────────────────────────────────────────────────

const MAX_ERRORS   = 20;
const STORAGE_KEY  = 'panel_errors';

// ─── Storage-Helpers ─────────────────────────────────────────────────────────

function loadFromStorage() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveToStorage(errors) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(errors)); } catch {}
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ErrorCtx = createContext(null);

export function ErrorProvider({ children }) {
  const [errors, setErrors] = useState(loadFromStorage);

  /** Neuen Fehler hinzufügen */
  const addError = useCallback((source, message) => {
    setErrors(prev => {
      // Duplikat innerhalb der letzten 5s unterdrücken
      const last = prev[0];
      if (last && last.source === source && last.message === message &&
          Date.now() - new Date(last.time).getTime() < 5000) {
        return prev;
      }
      const entry = {
        id:      `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        source,
        message,
        time:    new Date().toISOString(),
      };
      const next = [entry, ...prev].slice(0, MAX_ERRORS);
      saveToStorage(next);
      return next;
    });
  }, []);

  /** Einzelnen Fehler entfernen */
  const dismissError = useCallback((id) => {
    setErrors(prev => {
      const next = prev.filter(e => e.id !== id);
      saveToStorage(next);
      return next;
    });
  }, []);

  /** Alle Fehler löschen */
  const clearErrors = useCallback(() => {
    setErrors([]);
    saveToStorage([]);
  }, []);

  return (
    <ErrorCtx.Provider value={{ errors, addError, dismissError, clearErrors }}>
      {children}
    </ErrorCtx.Provider>
  );
}

export function useErrors() {
  const ctx = useContext(ErrorCtx);
  if (!ctx) throw new Error('useErrors muss innerhalb von ErrorProvider verwendet werden');
  return ctx;
}
