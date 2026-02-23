import { useState } from 'react';
import {
  ArrowLeft, RefreshCw, UserPlus, Server, Globe, Clock, Shield,
} from 'lucide-react';
import type { Server as ServerType } from '../api';
import { useServerStatus, useClients } from '../hooks/useServers';
import { useAuth } from '../auth';
import { StatusBadge } from './StatusBadge';
import { Spinner } from './Spinner';
import { ClientTable } from './ClientTable';
import { CreateClientModal } from './CreateClientModal';

interface ServerDetailProps {
  server: ServerType;
  onBack: () => void;
}

export function ServerDetail({ server, onBack }: ServerDetailProps) {
  const { isAdmin } = useAuth();
  const { status, loading: statusLoading, refetch: refetchStatus } = useServerStatus(server.id);
  const { clients, loading: clientsLoading, refetch: refetchClients } = useClients(server.id);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchStatus(), refetchClients()]);
    setRefreshing(false);
  };

  const activeClients = clients.filter(c => c.status === 'active');
  const activeCount = activeClients.length;
  const connectedCount = activeClients.filter(c => c.connected).length;
  const revokedCount = clients.filter(c => c.status === 'revoked').length;
  const fullTunnelCount = activeClients.filter(c => c.tunnel_mode === 'full').length;
  const splitTunnelCount = activeClients.filter(c => c.tunnel_mode === 'split').length;

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onBack}
          className="p-2 rounded-xl bg-gray-800/50 border border-gray-700 hover:border-gray-600 hover:bg-gray-800 text-gray-400 hover:text-white transition-all"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-white">{server.name}</h2>
          <p className="text-sm text-gray-400 font-mono">{server.host}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-300 bg-gray-800/50 rounded-xl border border-gray-700 hover:border-gray-600 hover:text-white transition-all disabled:opacity-50"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all shadow-lg shadow-indigo-500/20"
            >
              <UserPlus size={16} />
              Add Client
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-lg">
              <Server size={18} className="text-indigo-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Status</p>
              {statusLoading ? <Spinner /> : status && <StatusBadge online={status.online} />}
            </div>
          </div>
        </div>
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <Shield size={18} className="text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">VPN Service</p>
              <p className="text-sm font-medium text-white mt-0.5">
                {statusLoading ? '...' : status?.vpn_status || 'N/A'}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Globe size={18} className="text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Private IP</p>
              <p className="text-sm font-medium text-white font-mono mt-0.5">
                {statusLoading ? '...' : status?.private_ip || 'N/A'}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-lg">
              <Clock size={18} className="text-amber-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Uptime</p>
              <p className="text-sm font-medium text-white mt-0.5 truncate max-w-[180px]" title={status?.uptime}>
                {statusLoading ? '...' : status?.uptime || 'N/A'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Client List */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-white">VPN Clients</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {activeCount} active{connectedCount > 0 && ` · ${connectedCount} online`}{revokedCount > 0 && ` · ${revokedCount} revoked`}
              {activeCount > 0 && ` · ${fullTunnelCount} full / ${splitTunnelCount} split`}
            </p>
          </div>
        </div>
        <ClientTable
          clients={clients}
          serverId={server.id}
          loading={clientsLoading}
          onRevoked={refetchClients}
          onTunnelChanged={refetchClients}
          isAdmin={isAdmin}
        />
      </div>

      <CreateClientModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        serverId={server.id}
        serverName={server.name}
        envLabel={server.env_label}
        onCreated={refetchClients}
      />
    </div>
  );
}
