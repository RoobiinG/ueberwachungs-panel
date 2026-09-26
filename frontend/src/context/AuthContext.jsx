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
  const [modules, setModules] = useState({});

  if (token) axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

  const loadModules = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/settings/modules');
      setModules(data);
    } catch {}
  }, []);

  // Beim Start: frische Daten + Permissions vom Server holen
  useEffect(() => {
    if (!token) return;
    axios.get('/api/auth/me').then(r => {
      const u = {
        id: r.data.id,
        username: r.data.username,
        role: r.data.role,
        roleLabel: r.data.roleLabel,
        isAdmin: !!r.data.isAdmin,
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
      loadModules(); // Module laden, wenn Auth erfolgreich
    }).catch(() => {
      // Token abgelaufen / ungültig → ausloggen
      logout();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, loadModules]);

  const saveSession = useCallback((userData, tokenStr, perms = []) => {
    const u = {
      id: userData.id,
      username: userData.username,
      role: userData.role,
      roleLabel: userData.roleLabel,
      isAdmin: !!userData.isAdmin,
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
    delete axios.defaults.headers.common['Authorization'];
  }, []);

  /**
   * true, wenn der Nutzer die Berechtigung hat. Ein Array bedeutet „eines davon genügt" —
   * dieselbe Logik wie requirePermission([...]) im Backend. Das Ausblenden hier ist nur
   * Bedienhilfe; geschützt wird jede Aktion im Backend.
   */
  const hasPermission = useCallback(
    (keys) => Array.isArray(keys) ? keys.some(k => permissions.includes(k)) : permissions.includes(keys),
    [permissions]
  );
  /** true, wenn der Nutzer alle angegebenen Berechtigungen hat */
  const hasAll = useCallback((keys) => keys.every(k => permissions.includes(k)), [permissions]);

  const role       = user?.role;
  // Admin ist eine Eigenschaft der Rolle (is_admin), nicht der Name „admin". Der Fallback
  // gilt nur für eine noch zwischengespeicherte Sitzung, bis /api/auth/me geantwortet hat.
  const isAdmin    = user?.isAdmin ?? role === 'admin';
  const isOperator = role === 'operator';
  const canWrite   = isAdmin || isOperator || hasPermission('docker.control') || hasPermission('services.control');

  return (
    <AuthContext.Provider value={{
      user, token, permissions, modules, loadModules,
      login, verify2FA, logout, saveSession,
      isAdmin, isOperator, canWrite,
      hasPermission, hasAll,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
