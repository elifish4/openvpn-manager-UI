import { useState, useEffect, useCallback } from 'react';
import { api, type Server, type ServerStatus, type VPNClient } from '../api';

export function useServers() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchServers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getServers();
      setServers(data);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchServers(); }, [fetchServers]);

  return { servers, loading, error, refetch: fetchServers };
}

export function useServerStatus(serverId: number | null) {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (serverId === null) return;
    try {
      setLoading(true);
      const data = await api.getServerStatus(serverId);
      setStatus(data);
    } catch {
      setStatus({ online: false, error: 'Failed to connect' });
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  return { status, loading, refetch: fetchStatus };
}

export function useClients(serverId: number | null) {
  const [clients, setClients] = useState<VPNClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchClients = useCallback(async () => {
    if (serverId === null) return;
    try {
      setLoading(true);
      const data = await api.getClients(serverId);
      setClients(data);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  return { clients, loading, error, refetch: fetchClients };
}
