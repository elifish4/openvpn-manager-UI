import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type Server, type ServerStatus, type VPNClient, type TrafficResponse, type ClientTraffic } from '../api';

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

export function useClients(serverId: number | null, pollInterval: number = 0) {
  const [clients, setClients] = useState<VPNClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialLoad = useRef(true);
  const fetchingRef = useRef(false);

  const fetchClients = useCallback(async (silent = false) => {
    if (serverId === null) return;
    if (silent && fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      if (!silent) setLoading(true);
      const data = await api.getClients(serverId);
      setClients(data);
      setError(null);
    } catch (e: any) {
      if (!silent) setError(e.message);
    } finally {
      fetchingRef.current = false;
      if (!silent) setLoading(false);
      initialLoad.current = false;
    }
  }, [serverId]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  useEffect(() => {
    if (!pollInterval || serverId === null) return;
    const id = setInterval(() => fetchClients(true), pollInterval);
    return () => clearInterval(id);
  }, [pollInterval, serverId, fetchClients]);

  return { clients, loading, error, refetch: fetchClients };
}

export function useTraffic(serverId: number | null, days: number) {
  const [data, setData] = useState<TrafficResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [trafficMap, setTrafficMap] = useState<Record<string, ClientTraffic>>({});

  const fetchTraffic = useCallback(async () => {
    if (serverId === null) return;
    try {
      setLoading(true);
      const res = await api.getTraffic(serverId, days);
      setData(res);
      const map: Record<string, ClientTraffic> = {};
      for (const c of res.clients) {
        map[c.client_name] = c;
      }
      setTrafficMap(map);
    } catch {
      // traffic data is best-effort
    } finally {
      setLoading(false);
    }
  }, [serverId, days]);

  useEffect(() => { fetchTraffic(); }, [fetchTraffic]);

  return { data, trafficMap, loading, refetch: fetchTraffic };
}
