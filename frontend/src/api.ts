import { getAuthHeader } from './auth';

const BASE = '/api';

export interface Server {
  id: number;
  name: string;
  host: string;
  env_label: string;
}

export interface ServerStatus {
  online: boolean;
  uptime?: string;
  vpn_status?: string;
  private_ip?: string;
  error?: string;
}

export interface VPNClient {
  name: string;
  status: 'active' | 'revoked';
  has_ovpn: boolean;
  tunnel_mode: 'full' | 'split';
  connected: boolean;
  connected_since: string | null;
  real_address: string | null;
  last_seen: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface AppUser {
  username: string;
  role: string;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  timestamp: string;
  username: string;
  action: string;
  server_name: string | null;
  client_name: string | null;
  details: string | null;
}

export interface AuditLogResponse {
  logs: AuditEntry[];
  total: number;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const auth = getAuthHeader();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...auth,
      ...options?.headers,
    },
  });
  if (res.status === 401) {
    localStorage.removeItem('vpn_manager_auth');
    window.location.reload();
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  getServers: () => request<Server[]>('/servers'),

  getServerStatus: (id: number) => request<ServerStatus>(`/servers/${id}/status`),

  getClients: (serverId: number) => request<VPNClient[]>(`/servers/${serverId}/clients`),

  createClient: (serverId: number, firstName: string, lastName: string, email: string, usePassword: boolean = false, password?: string, sendSlack: boolean = true) =>
    request<{ success: boolean; message: string; client_name?: string; slack_sent?: boolean; slack_error?: string | null }>(`/servers/${serverId}/clients`, {
      method: 'POST',
      body: JSON.stringify({ first_name: firstName, last_name: lastName, email, use_password: usePassword, password, send_slack: sendSlack }),
    }),

  revokeClient: (serverId: number, clientName: string) =>
    request<{ success: boolean; message: string }>(`/servers/${serverId}/clients/${clientName}`, {
      method: 'DELETE',
    }),

  setTunnelMode: (serverId: number, clientName: string, tunnelMode: 'full' | 'split') =>
    request<{ success: boolean; message: string }>(`/servers/${serverId}/clients/${clientName}/tunnel`, {
      method: 'PATCH',
      body: JSON.stringify({ tunnel_mode: tunnelMode }),
    }),

  getDownloadUrl: (serverId: number, clientName: string) => {
    const auth = getAuthHeader();
    const token = auth.Authorization?.replace('Bearer ', '') || '';
    return `${BASE}/servers/${serverId}/clients/${clientName}/download?token=${token}`;
  },

  // Admin: User Management
  getUsers: () => request<AppUser[]>('/admin/users'),

  createUser: (username: string, password: string, role: string) =>
    request<AppUser>('/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username, password, role }),
    }),

  updateUser: (username: string, data: { password?: string; role?: string }) =>
    request<AppUser>(`/admin/users/${username}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteUser: (username: string) =>
    request<{ message: string }>(`/admin/users/${username}`, {
      method: 'DELETE',
    }),

  // Admin: Audit Log
  getAuditLog: (limit = 100, offset = 0, action?: string) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (action) params.set('action', action);
    return request<AuditLogResponse>(`/admin/audit-log?${params}`);
  },
};
