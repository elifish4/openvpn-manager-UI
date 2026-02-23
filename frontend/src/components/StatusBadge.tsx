interface StatusBadgeProps {
  online: boolean;
  label?: string;
}

export function StatusBadge({ online, label }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
      online
        ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25'
        : 'bg-red-500/15 text-red-400 ring-1 ring-red-500/25'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-400 animate-pulse-dot' : 'bg-red-400'}`} />
      {label || (online ? 'Online' : 'Offline')}
    </span>
  );
}
