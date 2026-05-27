import { Download, Trash2, UserCheck, UserX, AlertTriangle, Globe, Split, ArrowRightLeft, Wifi, WifiOff, Clock, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Search, X, Unplug, Send, Check } from 'lucide-react';
import { useState, useMemo, useRef } from 'react';
import type { VPNClient, ClientTraffic } from '../api';
import { api } from '../api';
import { Spinner } from './Spinner';
import { Modal } from './Modal';

interface ClientTableProps {
  clients: VPNClient[];
  serverId: number;
  loading: boolean;
  onRevoked: () => void;
  onTunnelChanged: () => void;
  isAdmin?: boolean;
  trafficMap?: Record<string, ClientTraffic>;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

function formatLastSeen(lastSeen: string | null): string {
  if (!lastSeen) return '—';
  try {
    const d = new Date(lastSeen);
    if (isNaN(d.getTime())) return lastSeen;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  } catch {
    return lastSeen;
  }
}

function formatFullDate(raw: string | null): string {
  if (!raw) return '';
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleString(undefined, {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return raw;
  }
}

function Tooltip({ children, text }: { children: React.ReactNode; text: string }) {
  return (
    <span className="relative group/tip inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-200 whitespace-nowrap opacity-0 scale-95 group-hover/tip:opacity-100 group-hover/tip:scale-100 transition-all duration-150 shadow-xl z-50">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-gray-700" />
      </span>
    </span>
  );
}

type SortKey = 'client' | 'connection' | 'lastSeen' | 'tunnel' | 'traffic';
type SortDir = 'asc' | 'desc';

function parseDate(raw: string | null): number {
  if (!raw) return 0;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function compareClients(a: VPNClient, b: VPNClient, key: SortKey, dir: SortDir): number {
  let cmp = 0;
  switch (key) {
    case 'client':
      cmp = a.name.localeCompare(b.name);
      break;
    case 'connection':
      cmp = (a.connected === b.connected) ? 0 : a.connected ? -1 : 1;
      break;
    case 'lastSeen': {
      const aTime = a.connected ? parseDate(a.connected_since) || Infinity : parseDate(a.last_seen);
      const bTime = b.connected ? parseDate(b.connected_since) || Infinity : parseDate(b.last_seen);
      cmp = bTime - aTime;
      break;
    }
    case 'tunnel':
      cmp = a.tunnel_mode.localeCompare(b.tunnel_mode);
      break;
    case 'traffic':
      cmp = (a.bytes_received + a.bytes_sent) - (b.bytes_received + b.bytes_sent);
      break;
  }
  return dir === 'desc' ? -cmp : cmp;
}

function SortHeader({ label, sortKey, activeKey, dir, onSort }: {
  label: string; sortKey: SortKey; activeKey: SortKey | null; dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = activeKey === sortKey;
  return (
    <th
      className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-200 transition-colors"
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          dir === 'asc' ? <ChevronUp size={13} className="text-indigo-400" /> : <ChevronDown size={13} className="text-indigo-400" />
        ) : (
          <ChevronsUpDown size={13} className="opacity-30" />
        )}
      </span>
    </th>
  );
}

export function ClientTable({ clients, serverId, loading, onRevoked, onTunnelChanged, isAdmin = false, trafficMap = {} }: ClientTableProps) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [tunnelToggle, setTunnelToggle] = useState<{ name: string; current: 'full' | 'split' } | null>(null);
  const [togglingTunnel, setTogglingTunnel] = useState<string | null>(null);
  const [resendingSlack, setResendingSlack] = useState<string | null>(null);
  const [slackSent, setSlackSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState(0);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(0);
  };

  const needle = search.toLowerCase().trim();

  const matchesSearch = (c: VPNClient) => {
    if (!needle) return true;
    return c.name.toLowerCase().includes(needle) ||
      (c.email && c.email.toLowerCase().includes(needle)) ||
      (c.first_name && c.first_name.toLowerCase().includes(needle)) ||
      (c.last_name && c.last_name.toLowerCase().includes(needle));
  };

  const activeClients = useMemo(() => {
    let list = clients.filter(c => c.status === 'active');
    if (needle) list = list.filter(matchesSearch);
    if (!sortKey) return list;
    return [...list].sort((a, b) => compareClients(a, b, sortKey, sortDir));
  }, [clients, sortKey, sortDir, needle]);

  const revokedClients = useMemo(() => {
    let list = clients.filter(c => c.status === 'revoked');
    if (needle) list = list.filter(matchesSearch);
    return list;
  }, [clients, needle]);

  const allDisplayed = [...activeClients, ...revokedClients];
  const totalCount = allDisplayed.length;
  const isPaginated = pageSize > 0 && totalCount > pageSize;
  const totalPages = pageSize > 0 ? Math.ceil(totalCount / pageSize) : 1;
  const safePage = Math.min(page, Math.max(totalPages - 1, 0));
  const startIdx = pageSize > 0 ? safePage * pageSize : 0;
  const endIdx = pageSize > 0 ? Math.min(startIdx + pageSize, totalCount) : totalCount;
  const paginatedActive = pageSize > 0
    ? activeClients.slice(Math.max(startIdx, 0), Math.min(endIdx, activeClients.length))
    : activeClients;
  const revokedStart = Math.max(startIdx - activeClients.length, 0);
  const revokedEnd = Math.max(endIdx - activeClients.length, 0);
  const paginatedRevoked = pageSize > 0
    ? revokedClients.slice(revokedStart, revokedEnd)
    : revokedClients;

  const handleRevoke = async (name: string) => {
    try {
      setRevoking(name);
      setError(null);
      await api.revokeClient(serverId, name);
      setConfirmRevoke(null);
      onRevoked();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRevoking(null);
    }
  };

  const handleDisconnect = async (name: string) => {
    try {
      setDisconnecting(name);
      setError(null);
      await api.disconnectClient(serverId, name);
      onRevoked(); // triggers a refresh
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDisconnecting(null);
    }
  };

  const handleTunnelToggle = async () => {
    if (!tunnelToggle) return;
    const newMode = tunnelToggle.current === 'full' ? 'split' : 'full';
    try {
      setTogglingTunnel(tunnelToggle.name);
      setError(null);
      await api.setTunnelMode(serverId, tunnelToggle.name, newMode);
      setTunnelToggle(null);
      onTunnelChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTogglingTunnel(null);
    }
  };

  const handleDownload = (name: string) => {
    window.open(api.getDownloadUrl(serverId, name), '_blank');
  };

  const handleResendSlack = async (name: string) => {
    try {
      setResendingSlack(name);
      setError(null);
      await api.resendSlack(serverId, name);
      setSlackSent(name);
      setTimeout(() => setSlackSent(prev => prev === name ? null : prev), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setResendingSlack(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="w-6 h-6" />
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <UserCheck className="mx-auto mb-3 text-gray-600" size={40} />
        <p className="text-lg font-medium text-gray-400">No clients yet</p>
        <p className="text-sm mt-1">Create your first VPN client to get started</p>
      </div>
    );
  }

  return (
    <>
      <div className="relative mb-3">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
          placeholder="Search clients..."
          className="w-full pl-9 pr-9 py-2 text-sm bg-gray-900/60 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
        />
        {search && (
          <button
            onClick={() => { setSearch(''); searchRef.current?.focus(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X size={15} />
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-800">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-900/80 border-b border-gray-800">
              <SortHeader label="Client" sortKey="client" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortHeader label="Connection" sortKey="connection" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortHeader label="Last Seen" sortKey="lastSeen" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortHeader label="Tunnel" sortKey="tunnel" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <SortHeader label="Traffic" sortKey="traffic" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <th className="text-right px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {paginatedActive.map(client => (
              <tr key={client.name} className="group hover:bg-gray-900/40 transition-colors">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${client.connected ? 'bg-emerald-500/10' : 'bg-gray-700/50'}`}>
                      <UserCheck size={16} className={client.connected ? 'text-emerald-400' : 'text-gray-500'} />
                    </div>
                    <div>
                      <span className="font-medium text-white">{client.name}</span>
                      {(client.first_name || client.email) && (
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          {client.first_name && client.last_name
                            ? `${client.first_name} ${client.last_name}`
                            : ''}
                          {client.email && (
                            <span className="text-gray-600">
                              {client.first_name ? ' · ' : ''}{client.email}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4">
                  {client.connected ? (
                    <div>
                      {isAdmin ? (
                        <button
                          onClick={() => handleDisconnect(client.name)}
                          disabled={disconnecting === client.name}
                          className="group/conn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25 hover:bg-red-500/15 hover:text-red-400 hover:ring-red-500/25 transition-all cursor-pointer disabled:opacity-50"
                        >
                          {disconnecting === client.name ? (
                            <>
                              <Spinner className="!w-3 !h-3" />
                              Disconnecting…
                            </>
                          ) : (
                            <>
                              <Wifi size={11} className="group-hover/conn:hidden" />
                              <Unplug size={11} className="hidden group-hover/conn:block" />
                              <span className="group-hover/conn:hidden">Connected</span>
                              <span className="hidden group-hover/conn:inline">Disconnect</span>
                            </>
                          )}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25">
                          <Wifi size={11} />
                          Connected
                        </span>
                      )}
                      {client.real_address && (
                        <p className="text-[11px] text-gray-500 mt-1 font-mono">{client.real_address}</p>
                      )}
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-700/50 text-gray-500 ring-1 ring-gray-600">
                      <WifiOff size={11} />
                      Disconnected
                    </span>
                  )}
                </td>
                <td className="px-5 py-4">
                  {client.connected && client.connected_since ? (
                    <Tooltip text={formatFullDate(client.connected_since)}>
                      <div className="cursor-default">
                        <span className="text-xs text-emerald-400">Since</span>
                        <p className="text-xs text-gray-300 mt-0.5">{client.connected_since}</p>
                      </div>
                    </Tooltip>
                  ) : client.last_seen ? (
                    <div>
                      <Tooltip text={formatFullDate(client.last_seen)}>
                        <div className="flex items-center gap-1.5 cursor-default">
                          <Clock size={12} className="text-gray-500" />
                          <span className="text-xs text-gray-400">{formatLastSeen(client.last_seen)}</span>
                        </div>
                      </Tooltip>
                      {client.last_seen_ip && (
                        <p className="text-[11px] text-gray-500 mt-0.5 font-mono">{client.last_seen_ip}</p>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-600">Never</span>
                  )}
                </td>
                <td className="px-5 py-4">
                  {isAdmin ? (
                    <button
                      onClick={() => setTunnelToggle({ name: client.name, current: client.tunnel_mode })}
                      disabled={togglingTunnel === client.name}
                      className="group/tunnel relative cursor-pointer"
                    >
                      {togglingTunnel === client.name ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-700/50 text-gray-400 ring-1 ring-gray-600">
                          <Spinner className="!w-3 !h-3" />
                          Switching...
                        </span>
                      ) : client.tunnel_mode === 'full' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/25 hover:bg-violet-500/25 transition-all">
                          <Globe size={12} />
                          Full Tunnel
                          <ArrowRightLeft size={10} className="opacity-0 group-hover/tunnel:opacity-100 transition-opacity ml-0.5" />
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25 hover:bg-amber-500/25 transition-all">
                          <Split size={12} />
                          Split Tunnel
                          <ArrowRightLeft size={10} className="opacity-0 group-hover/tunnel:opacity-100 transition-opacity ml-0.5" />
                        </span>
                      )}
                    </button>
                  ) : client.tunnel_mode === 'full' ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/25">
                      <Globe size={12} />
                      Full Tunnel
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25">
                      <Split size={12} />
                      Split Tunnel
                    </span>
                  )}
                </td>
                <td className="px-5 py-4">
                  {(() => {
                    const hist = trafficMap[client.name];
                    const liveIn = client.connected ? client.bytes_received : 0;
                    const liveOut = client.connected ? client.bytes_sent : 0;
                    const histIn = hist?.bytes_in || 0;
                    const histOut = hist?.bytes_out || 0;
                    const totalIn = histIn + liveIn;
                    const totalOut = histOut + liveOut;
                    if (totalIn === 0 && totalOut === 0) {
                      return <span className="text-xs text-gray-600">—</span>;
                    }
                    return (
                      <div className="text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-emerald-400">↓</span>
                          <span className="text-gray-300">{formatBytes(totalIn)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-blue-400">↑</span>
                          <span className="text-gray-300">{formatBytes(totalOut)}</span>
                        </div>
                        {client.connected && liveIn > 0 && (
                          <p className="text-[10px] text-gray-600 mt-0.5">session: {formatBytes(liveIn)} / {formatBytes(liveOut)}</p>
                        )}
                      </div>
                    );
                  })()}
                </td>
                <td className="px-5 py-4 text-right">
                  <div className="flex items-center gap-2 justify-end opacity-60 group-hover:opacity-100 transition-opacity">
                    {client.has_ovpn && (
                      <button
                        onClick={() => handleDownload(client.name)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-300 bg-indigo-500/10 rounded-lg hover:bg-indigo-500/20 ring-1 ring-indigo-500/25 transition-all"
                      >
                        <Download size={13} />
                        .ovpn
                      </button>
                    )}
                    {isAdmin && client.has_ovpn && client.email && (
                      <button
                        onClick={() => handleResendSlack(client.name)}
                        disabled={resendingSlack === client.name || slackSent === client.name}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg ring-1 transition-all disabled:opacity-70 ${
                          slackSent === client.name
                            ? 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/25'
                            : 'text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 ring-sky-500/25'
                        }`}
                      >
                        {resendingSlack === client.name ? (
                          <><Spinner className="!w-3 !h-3" /> Sending…</>
                        ) : slackSent === client.name ? (
                          <><Check size={13} /> Sent</>
                        ) : (
                          <><Send size={13} /> Slack</>
                        )}
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => setConfirmRevoke(client.name)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-300 bg-red-500/10 rounded-lg hover:bg-red-500/20 ring-1 ring-red-500/25 transition-all"
                      >
                        <Trash2 size={13} />
                        Revoke
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {paginatedRevoked.map(client => (
              <tr key={client.name} className="opacity-50">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-700/50 rounded-lg">
                      <UserX size={16} className="text-gray-500" />
                    </div>
                    <span className="font-medium text-gray-400 line-through">{client.name}</span>
                  </div>
                </td>
                <td className="px-5 py-4">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-700/50 text-gray-500 ring-1 ring-gray-600">
                    Revoked
                  </span>
                </td>
                <td className="px-5 py-4">
                  <span className="text-xs text-gray-600">—</span>
                </td>
                <td className="px-5 py-4">
                  <span className="text-xs text-gray-600">—</span>
                </td>
                <td className="px-5 py-4">
                  <span className="text-xs text-gray-600">—</span>
                </td>
                <td className="px-5 py-4" />
              </tr>
            ))}
            {needle && activeClients.length === 0 && revokedClients.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center">
                  <Search size={24} className="mx-auto mb-2 text-gray-600" />
                  <p className="text-sm text-gray-500">No clients matching "<span className="text-gray-300">{search}</span>"</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalCount > 0 && (
        <div className="flex items-center justify-between mt-3 px-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Show</span>
            {[20, 50, 0].map(size => (
              <button
                key={size}
                onClick={() => { setPageSize(size); setPage(0); }}
                className={`px-2 py-0.5 text-xs font-medium rounded transition-all ${
                  pageSize === size
                    ? 'bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/30'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {size === 0 ? 'All' : size}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">
              {isPaginated
                ? `${startIdx + 1}–${endIdx} of ${totalCount}`
                : `${totalCount} client${totalCount !== 1 ? 's' : ''}`}
            </span>
            {isPaginated && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(p - 1, 0))}
                  disabled={safePage === 0}
                  className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(p + 1, totalPages - 1))}
                  disabled={safePage >= totalPages - 1}
                  className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <Modal
        open={confirmRevoke !== null}
        onClose={() => { setConfirmRevoke(null); setError(null); }}
        title="Revoke Client"
      >
        <div className="flex items-start gap-3 mb-5">
          <div className="p-2 bg-red-500/10 rounded-lg mt-0.5">
            <AlertTriangle className="text-red-400" size={20} />
          </div>
          <div>
            <p className="text-sm text-gray-300">
              Are you sure you want to revoke <span className="text-white font-medium">{confirmRevoke}</span>?
            </p>
            <p className="text-sm text-gray-500 mt-1">
              This will permanently remove their VPN access. This action cannot be undone.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={() => { setConfirmRevoke(null); setError(null); }}
            disabled={revoking !== null}
            className="px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-white bg-gray-800 rounded-xl border border-gray-700 hover:border-gray-600 transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => confirmRevoke && handleRevoke(confirmRevoke)}
            disabled={revoking !== null}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-xl transition-all disabled:opacity-50"
          >
            {revoking ? <Spinner /> : <Trash2 size={16} />}
            {revoking ? 'Revoking...' : 'Revoke Access'}
          </button>
        </div>
      </Modal>

      <Modal
        open={tunnelToggle !== null}
        onClose={() => { setTunnelToggle(null); setError(null); }}
        title="Change Tunnel Mode"
      >
        {tunnelToggle && (
          <>
            <div className="flex items-start gap-3 mb-5">
              <div className="p-2 bg-indigo-500/10 rounded-lg mt-0.5">
                <ArrowRightLeft className="text-indigo-400" size={20} />
              </div>
              <div>
                <p className="text-sm text-gray-300">
                  Switch <span className="text-white font-medium">{tunnelToggle.name}</span> from{' '}
                  {tunnelToggle.current === 'full' ? (
                    <>
                      <span className="text-violet-400 font-medium">Full Tunnel</span> to{' '}
                      <span className="text-amber-400 font-medium">Split Tunnel</span>
                    </>
                  ) : (
                    <>
                      <span className="text-amber-400 font-medium">Split Tunnel</span> to{' '}
                      <span className="text-violet-400 font-medium">Full Tunnel</span>
                    </>
                  )}
                  ?
                </p>
                <p className="text-sm text-gray-500 mt-2">
                  {tunnelToggle.current === 'full'
                    ? 'Split tunnel will only route specific network traffic through the VPN. The user will need to reconnect for changes to take effect.'
                    : 'Full tunnel will route ALL traffic through the VPN. The user will need to reconnect for changes to take effect.'}
                </p>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setTunnelToggle(null); setError(null); }}
                disabled={togglingTunnel !== null}
                className="px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-white bg-gray-800 rounded-xl border border-gray-700 hover:border-gray-600 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleTunnelToggle}
                disabled={togglingTunnel !== null}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all disabled:opacity-50"
              >
                {togglingTunnel ? <Spinner /> : <ArrowRightLeft size={16} />}
                {togglingTunnel ? 'Switching...' : `Switch to ${tunnelToggle.current === 'full' ? 'Split' : 'Full'} Tunnel`}
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
