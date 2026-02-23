import { Loader2 } from 'lucide-react';

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`animate-spin-slow text-indigo-400 ${className}`} size={20} />;
}
