import { createContext, useContext, useState, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('token'));

  if (token) axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

  // Gemeinsame Methode zum Speichern nach Login (auch für Passkey-Login)
  const saveSession = useCallback((userData, tokenStr) => {
    setUser(userData);
    setToken(tokenStr);
    localStorage.setItem('token', tokenStr);
    localStorage.setItem('user', JSON.stringify(userData));
    axios.defaults.headers.common['Authorization'] = `Bearer ${tokenStr}`;
  }, []);

  const login = useCallback(async (username, password) => {
    const { data } = await axios.post('/api/auth/login', { username, password });
    saveSession(data.user, data.token);
    return data;
  }, [saveSession]);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    delete axios.defaults.headers.common['Authorization'];
  }, []);

  const role      = user?.role;
  const isAdmin   = role === 'admin';
  const isOperator = role === 'operator';
  const canWrite  = role === 'admin' || role === 'operator';

  return (
    <AuthContext.Provider value={{ user, token, login, logout, saveSession, isAdmin, isOperator, canWrite }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
