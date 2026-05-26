import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });
  const [token, setToken]           = useState(() => localStorage.getItem('token'));
  const [permissions, setPermissions] = useState(() => {
    try { return JSON.parse(localStorage.getItem('permissions')) || []; } catch { return []; }
  });
  const [hideLocal, setHideLocal] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hideLocal')) || false; } catch { return false; }
  });

  if (token) axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

  // Beim Start: frische Daten + Permissions vom Server holen
  useEffect(() => {
    if (!token) return;
    axios.get('/api/auth/me').then(r => {
      const u = { id: r.data.id, username: r.data.username, role: r.data.role, roleLabel: r.data.roleLabel };
      const hl = !!r.data.hideLocal;
      setUser(u);
      setPermissions(r.data.permissions || []);
      setHideLocal(hl);
      localStorage.setItem('user', JSON.stringify(u));
      localStorage.setItem('permissions', JSON.stringify(r.data.permissions || []));
      localStorage.setItem('hideLocal', JSON.stringify(hl));
    }).catch(() => {
      // Token abgelaufen / ungültig → ausloggen
      logout();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const saveSession = useCallback((userData, tokenStr, perms = [], hl = false) => {
    const u = { id: userData.id, username: userData.username, role: userData.role, roleLabel: userData.roleLabel };
    setUser(u);
    setToken(tokenStr);
    setPermissions(perms);
    setHideLocal(hl);
    localStorage.setItem('token', tokenStr);
    localStorage.setItem('user', JSON.stringify(u));
    localStorage.setItem('permissions', JSON.stringify(perms));
    localStorage.setItem('hideLocal', JSON.stringify(hl));
    axios.defaults.headers.common['Authorization'] = `Bearer ${tokenStr}`;
  }, []);

  const login = useCallback(async (username, password) => {
    const { data } = await axios.post('/api/auth/login', { username, password });
    saveSession(data.user, data.token, data.permissions || [], !!data.hideLocal);
    return data;
  }, [saveSession]);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setPermissions([]);
    setHideLocal(false);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('permissions');
    localStorage.removeItem('hideLocal');
    delete axios.defaults.headers.common['Authorization'];
  }, []);

  /** Gibt true zurück wenn der Nutzer die angegebene Berechtigung hat */
  const hasPermission = useCallback((key) => permissions.includes(key), [permissions]);

  const role       = user?.role;
  const isAdmin    = role === 'admin';
  const isOperator = role === 'operator';
  const canWrite   = isAdmin || isOperator || hasPermission('docker.control') || hasPermission('services.control');

  return (
    <AuthContext.Provider value={{
      user, token, permissions,
      login, logout, saveSession,
      isAdmin, isOperator, canWrite,
      hasPermission, hideLocal,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
