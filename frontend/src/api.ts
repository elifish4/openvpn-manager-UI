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
  bytes_received: number;
  bytes_sent: number;
  last_seen: string | null;
  last_seen_ip: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface ClientTraffic {
  client_name: string;
  bytes_in: number;
  bytes_out: number;
}

export interface TrafficResponse {
  clients: ClientTraffic[];
  totals: { bytes_in: number; bytes_out: number };
  days: number;
}

export interface AppUser {
  email: string;
  name: string | null;
  picture: string | null;
  role: string;
  created_at: string;
  last_login: string | null;
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

export interface BulkCreateResult {
  server_id: number;
  server_name: string;
  client_name: string;
  success: boolean;
  error: string | null;
  slack_sent: boolean;
  slack_error: string | null;
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

  bulkCreateClient: (serverIds: number[], firstName: string, lastName: string, email: string, usePassword: boolean = false, password?: string, sendSlack: boolean = true) =>
    request<{ results: BulkCreateResult[] }>('/clients/bulk', {
      method: 'POST',
      body: JSON.stringify({ server_ids: serverIds, first_name: firstName, last_name: lastName, email, use_password: usePassword, password, send_slack: sendSlack }),
    }),

  disconnectClient: (serverId: number, clientName: string) =>
    request<{ success: boolean; message: string }>(`/servers/${serverId}/clients/${clientName}/disconnect`, {
      method: 'POST',
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

  resendSlack: (serverId: number, clientName: string) =>
    request<{ sent: boolean }>(`/servers/${serverId}/clients/${clientName}/resend-slack`, {
      method: 'POST',
    }),

  getDownloadUrl: (serverId: number, clientName: string) => {
    const auth = getAuthHeader();
    const token = auth.Authorization?.replace('Bearer ', '') || '';
    return `${BASE}/servers/${serverId}/clients/${clientName}/download?token=${token}`;
  },

  // Admin: User Management
  getUsers: () => request<AppUser[]>('/admin/users'),

  updateUserRole: (email: string, role: string) =>
    request<AppUser>(`/admin/users/${encodeURIComponent(email)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  deleteUser: (email: string) =>
    request<{ message: string }>(`/admin/users/${encodeURIComponent(email)}`, {
      method: 'DELETE',
    }),

  // Traffic
  getTraffic: (serverId: number, days: number = 30) =>
    request<TrafficResponse>(`/servers/${serverId}/traffic?days=${days}`),

  // Admin: Audit Log
  getAuditLog: (limit = 100, offset = 0, action?: string) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (action) params.set('action', action);
    return request<AuditLogResponse>(`/admin/audit-log?${params}`);
  },
};
