import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface AuthUser {
  username: string;
  role: string;
  token: string;
}

interface AuthContextType {
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = 'vpn_manager_auth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) {
      try { return JSON.parse(saved); } catch { return null; }
    }
    return null;
  });

  useEffect(() => {
    if (user) {
      localStorage.setItem(TOKEN_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${user.token}` },
    }).then(res => {
      if (!res.ok) setUser(null);
    }).catch(() => setUser(null));
  }, []);

  const login = async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || 'Login failed');
    }
    const data = await res.json();
    const newUser = { username: data.username, role: data.role, token: data.token };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(newUser));
    setUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function getAuthHeader(): Record<string, string> {
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved) {
    try {
      const { token } = JSON.parse(saved);
      return { Authorization: `Bearer ${token}` };
    } catch { /* empty */ }
  }
  return {};
}
