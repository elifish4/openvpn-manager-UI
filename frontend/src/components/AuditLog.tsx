import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, ScrollText, UserPlus, UserMinus, Download, ArrowRightLeft, LogIn, ChevronLeft, ChevronRight, Search, X, Filter } from 'lucide-react';
import type { AuditEntry } from '../api';
import { api } from '../api';
import { Spinner } from './Spinner';

const PAGE_SIZE = 50;

const ACTION_CONFIG: Record<string, { label: string; color: string; icon: typeof UserPlus }> = {
  create_client:      { label: 'Create Client',      color: 'text-emerald-400 bg-emerald-500/15 ring-emerald-500/25', icon: UserPlus },
  revoke_client:      { label: 'Revoke Client',       color: 'text-red-400 bg-red-500/15 ring-red-500/25',           icon: UserMinus },
  download_ovpn:      { label: 'Download OVPN',       color: 'text-indigo-400 bg-indigo-500/15 ring-indigo-500/25',   icon: Download },
  change_tunnel:      { label: 'Change Tunnel',       color: 'text-violet-400 bg-violet-500/15 ring-violet-500/25',   icon: ArrowRightLeft },
  login:              { label: 'Login',                color: 'text-sky-400 bg-sky-500/15 ring-sky-500/25',            icon: LogIn },
  create_admin_user:  { label: 'Create Admin User',   color: 'text-amber-400 bg-amber-500/15 ring-amber-500/25',      icon: UserPlus },
  update_admin_user:  { label: 'Update Admin User',   color: 'text-amber-400 bg-amber-500/15 ring-amber-500/25',      icon: ArrowRightLeft },
  delete_admin_user:  { label: 'Delete Admin User',   color: 'text-red-400 bg-red-500/15 ring-red-500/25',            icon: UserMinus },
};

const FILTER_OPTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'create_client', label: 'Create Client' },
  { value: 'revoke_client', label: 'Revoke Client' },
  { value: 'download_ovpn', label: 'Download OVPN' },
  { value: 'change_tunnel', label: 'Change Tunnel' },
  { value: 'login', label: 'Login' },
];

function ActionBadge({ action }: { action: string }) {
  const cfg = ACTION_CONFIG[action] || { label: action, color: 'text-gray-400 bg-gray-700/50 ring-gray-600', icon: ScrollText };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ${cfg.color}`}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatFullTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return iso;
  }
}

interface AuditLogProps {
  onBack: () => void;
}

export function AuditLog({ onBack }: AuditLogProps) {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getAuditLog(PAGE_SIZE, page * PAGE_SIZE, actionFilter || undefined);
      setLogs(res.logs);
      setTotal(res.total);
    } catch (e) {
      console.error('Failed to load audit log', e);
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const needle = searchTerm.toLowerCase().trim();
  const filtered = needle
    ? logs.filter(l =>
        l.username.toLowerCase().includes(needle) ||
        (l.client_name && l.client_name.toLowerCase().includes(needle)) ||
        (l.server_name && l.server_name.toLowerCase().includes(needle)) ||
        (l.details && l.details.toLowerCase().includes(needle))
      )
    : logs;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors mb-4">
          <ArrowLeft size={16} /> Back to Dashboard
        </button>
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 rounded-xl ring-1 ring-amber-500/20">
            <ScrollText className="text-amber-400" size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">System Log</h2>
            <p className="text-gray-400 text-sm mt-0.5">{total} total events</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search by user, client, server..."
            className="w-full pl-9 pr-9 py-2 text-sm bg-gray-900/60 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors">
              <X size={15} />
            </button>
          )}
        </div>
        <div className="relative">
          <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <select
            value={actionFilter}
            onChange={e => { setActionFilter(e.target.value); setPage(0); }}
            className="pl-8 pr-4 py-2 text-sm bg-gray-900/60 border border-gray-800 rounded-lg text-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 appearance-none cursor-pointer"
          >
            {FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-800">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-900/80 border-b border-gray-800">
              <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Time</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">User</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Action</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Server</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Client</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {loading ? (
              <tr><td colSpan={6} className="px-5 py-12 text-center"><Spinner className="w-5 h-5 mx-auto" /></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-gray-500">No log entries found</td></tr>
            ) : filtered.map(entry => (
              <tr key={entry.id} className="hover:bg-gray-900/40 transition-colors">
                <td className="px-5 py-3">
                  <span className="text-xs text-gray-400" title={formatFullTimestamp(entry.timestamp)}>
                    {formatTimestamp(entry.timestamp)}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <span className="text-sm text-white font-medium">{entry.username}</span>
                </td>
                <td className="px-5 py-3">
                  <ActionBadge action={entry.action} />
                </td>
                <td className="px-5 py-3">
                  <span className="text-xs text-gray-400">{entry.server_name || '—'}</span>
                </td>
                <td className="px-5 py-3">
                  <span className="text-sm text-gray-300">{entry.client_name || '—'}</span>
                </td>
                <td className="px-5 py-3">
                  <span className="text-xs text-gray-500">{entry.details || '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-gray-500">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
