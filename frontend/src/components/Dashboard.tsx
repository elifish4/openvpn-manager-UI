import { useState } from 'react';
import { Shield, AlertCircle, Users, LogOut, ScrollText } from 'lucide-react';
import type { Server as ServerType } from '../api';
import { useServers, useServerStatus, useClients } from '../hooks/useServers';
import { useAuth } from '../auth';
import { ServerCard } from './ServerCard';
import { ServerDetail } from './ServerDetail';
import { AdminPanel } from './AdminPanel';
import { AuditLog } from './AuditLog';
import { Spinner } from './Spinner';

function ServerCardWithData({ server, onClick }: { server: ServerType; onClick: () => void }) {
  const { status, loading: statusLoading } = useServerStatus(server.id);
  const { clients } = useClients(server.id);
  const activeCount = clients.filter(c => c.status === 'active').length;

  return (
    <ServerCard
      server={server}
      status={status}
      statusLoading={statusLoading}
      clientCount={activeCount}
      onClick={onClick}
    />
  );
}

export function Dashboard() {
  const { servers, loading, error } = useServers();
  const { user, logout, isAdmin } = useAuth();
  const [selectedServer, setSelectedServer] = useState<ServerType | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);

  if (showAuditLog && isAdmin) {
    return <AuditLog onBack={() => setShowAuditLog(false)} />;
  }

  if (showAdmin && isAdmin) {
    return <AdminPanel onBack={() => setShowAdmin(false)} />;
  }

  if (selectedServer) {
    return <ServerDetail server={selectedServer} onBack={() => setSelectedServer(null)} />;
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 rounded-xl ring-1 ring-indigo-500/20">
              <Shield className="text-indigo-400" size={28} />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white tracking-tight">OpenVPN Manager</h1>
              <p className="text-gray-400 text-sm mt-0.5">Manage your VPN servers and client configurations</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && (
              <>
                <button
                  onClick={() => setShowAuditLog(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-300 bg-gray-800/50 rounded-xl border border-gray-700 hover:border-gray-600 hover:text-white transition-all"
                >
                  <ScrollText size={16} />
                  System Log
                </button>
                <button
                  onClick={() => setShowAdmin(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-300 bg-gray-800/50 rounded-xl border border-gray-700 hover:border-gray-600 hover:text-white transition-all"
                >
                  <Users size={16} />
                  Admin
                </button>
              </>
            )}
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/30 rounded-xl border border-gray-800">
              <span className="text-sm text-gray-400">{user?.username}</span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                user?.role === 'admin'
                  ? 'text-amber-400 bg-amber-500/15'
                  : 'text-emerald-400 bg-emerald-500/15'
              }`}>
                {user?.role}
              </span>
            </div>
            <button
              onClick={logout}
              className="p-2.5 rounded-xl text-gray-400 hover:text-white bg-gray-800/50 border border-gray-700 hover:border-gray-600 transition-all"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Spinner className="w-8 h-8 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">Connecting to servers...</p>
          </div>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center py-24">
          <div className="text-center max-w-md">
            <AlertCircle className="mx-auto mb-3 text-red-400" size={40} />
            <p className="text-lg font-medium text-red-400 mb-2">Connection Error</p>
            <p className="text-sm text-gray-400">{error}</p>
            <p className="text-xs text-gray-500 mt-3">
              Make sure the backend API is running on port 8000
            </p>
          </div>
        </div>
      ) : servers.length === 0 ? (
        <div className="flex items-center justify-center py-24">
          <div className="text-center max-w-md">
            <Shield className="mx-auto mb-3 text-gray-600" size={40} />
            <p className="text-lg font-medium text-gray-400 mb-2">No Servers Configured</p>
            <p className="text-sm text-gray-500">
              Add your VPN server details in the <code className="text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded">backend/.env</code> file to get started.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {servers.map(server => (
            <ServerCardWithData
              key={server.id}
              server={server}
              onClick={() => setSelectedServer(server)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
