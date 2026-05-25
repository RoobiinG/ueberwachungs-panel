import { createContext, useContext, useState, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('token'));

  if (token) axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

  const login = useCallback(async (username, password) => {
    const { data } = await axios.post('/api/auth/login', { username, password });
    setUser(data.user);
    setToken(data.token);
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    axios.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
    return data;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    delete axios.defaults.headers.common['Authorization'];
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
