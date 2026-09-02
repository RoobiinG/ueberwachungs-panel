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

  if (token) axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

  // Beim Start: frische Daten + Permissions vom Server holen
  useEffect(() => {
    if (!token) return;
    axios.get('/api/auth/me').then(r => {
      const u = {
        id: r.data.id,
        username: r.data.username,
        role: r.data.role,
        roleLabel: r.data.roleLabel,
        email: r.data.email,
        created_at: r.data.created_at,
        last_login: r.data.last_login,
        last_login_ip: r.data.last_login_ip,
        last_login_from: r.data.last_login_from,
      };
      setUser(u);
      setPermissions(r.data.permissions || []);
      localStorage.setItem('user', JSON.stringify(u));
      localStorage.setItem('permissions', JSON.stringify(r.data.permissions || []));
    }).catch(() => {
      // Token abgelaufen / ungültig → ausloggen
      logout();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const saveSession = useCallback((userData, tokenStr, perms = []) => {
    const u = {
      id: userData.id,
      username: userData.username,
      role: userData.role,
      roleLabel: userData.roleLabel,
      email: userData.email,
      created_at: userData.created_at,
      last_login: userData.last_login,
      last_login_ip: userData.last_login_ip,
      last_login_from: userData.last_login_from,
    };
    setUser(u);
    setToken(tokenStr);
    setPermissions(perms);
    localStorage.setItem('token', tokenStr);
    localStorage.setItem('user', JSON.stringify(u));
    localStorage.setItem('permissions', JSON.stringify(perms));
    axios.defaults.headers.common['Authorization'] = `Bearer ${tokenStr}`;
  }, []);

  const login = useCallback(async (username, password) => {
    const { data } = await axios.post('/api/auth/login', { username, password });
    if (data.require2FA) {
      return data;
    }
    saveSession(data.user, data.token, data.permissions || []);
    return data;
  }, [saveSession]);

  const verify2FA = useCallback(async (tempToken, code) => {
    const { data } = await axios.post('/api/auth/2fa/verify', { tempToken, code });
    saveSession(data.user, data.token, data.permissions || []);
    return data;
  }, [saveSession]);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setPermissions([]);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('permissions');
    localStorage.removeItem('hideLocal'); // Auch den alten Key entfernen
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
      login, verify2FA, logout, saveSession,
      isAdmin, isOperator, canWrite,
      hasPermission,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
