import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export interface AuthUser {
  email: string;
  name: string | null;
  picture: string | null;
  role: string;
  token: string;
}

export interface AuthConfig {
  google_client_id: string;
  allowed_domains: string[];
}

interface AuthContextType {
  user: AuthUser | null;
  config: AuthConfig | null;
  configLoading: boolean;
  configError: string | null;
  googleLogin: (credential: string) => Promise<void>;
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

  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/config')
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load auth config: HTTP ${res.status}`);
        return res.json();
      })
      .then((data: AuthConfig) => setConfig(data))
      .catch(err => setConfigError(err.message))
      .finally(() => setConfigLoading(false));
  }, []);

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
      if (!res.ok) {
        setUser(null);
      } else {
        // Pull fresh role/name/picture from the server so admin demotion takes effect on reload.
        res.json().then(fresh => {
          setUser(prev => prev ? { ...prev, role: fresh.role, name: fresh.name, picture: fresh.picture } : prev);
        }).catch(() => { /* keep cached */ });
      }
    }).catch(() => setUser(null));
  }, []);

  const googleLogin = async (credential: string) => {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || 'Sign-in failed');
    }
    const data = await res.json();
    const newUser: AuthUser = {
      email: data.email,
      name: data.name ?? null,
      picture: data.picture ?? null,
      role: data.role,
      token: data.token,
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(newUser));
    setUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        config,
        configLoading,
        configError,
        googleLogin,
        logout,
        isAdmin: user?.role === 'admin',
      }}
    >
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
