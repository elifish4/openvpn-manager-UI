import { Server, Users, ChevronRight, Wifi, WifiOff } from 'lucide-react';
import type { Server as ServerType, ServerStatus } from '../api';
import { StatusBadge } from './StatusBadge';
import { Spinner } from './Spinner';

interface ServerCardProps {
  server: ServerType;
  status: ServerStatus | null;
  statusLoading: boolean;
  clientCount?: number;
  onClick: () => void;
}

export function ServerCard({ server, status, statusLoading, clientCount, onClick }: ServerCardProps) {
  return (
    <button
      onClick={onClick}
      className="group w-full text-left bg-gray-900/50 border border-gray-800 rounded-2xl p-6 hover:border-indigo-500/50 hover:bg-gray-900/80 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/5"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="p-3 bg-indigo-500/10 rounded-xl ring-1 ring-indigo-500/20">
          <Server className="text-indigo-400" size={24} />
        </div>
        <ChevronRight className="text-gray-600 group-hover:text-indigo-400 transition-colors mt-1" size={20} />
      </div>

      <h3 className="text-lg font-semibold text-white mb-1">{server.name}</h3>
      <p className="text-sm text-gray-400 font-mono mb-4">{server.host}</p>

      <div className="flex items-center gap-3 flex-wrap">
        {statusLoading ? (
          <Spinner />
        ) : status ? (
          <>
            <StatusBadge online={status.online} />
            {status.online && status.vpn_status && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-800 text-gray-300 ring-1 ring-gray-700">
                {status.vpn_status.includes('active') ? (
                  <Wifi size={12} className="text-emerald-400" />
                ) : (
                  <WifiOff size={12} className="text-amber-400" />
                )}
                VPN {status.vpn_status}
              </span>
            )}
          </>
        ) : null}
        {clientCount !== undefined && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-800 text-gray-300 ring-1 ring-gray-700">
            <Users size={12} />
            {clientCount} clients
          </span>
        )}
      </div>
    </button>
  );
}
