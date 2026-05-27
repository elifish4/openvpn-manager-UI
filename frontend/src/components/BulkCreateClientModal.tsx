import { useState, useMemo, useEffect } from 'react';
import { UserPlus, Shield, ShieldOff, AlertTriangle, Mail, MessageSquare, Check, XCircle, Server } from 'lucide-react';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { api, type Server as ServerType, type BulkCreateResult } from '../api';

interface BulkCreateClientModalProps {
  open: boolean;
  onClose: () => void;
  servers: ServerType[];
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export function BulkCreateClientModal({ open, onClose, servers }: BulkCreateClientModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sendSlack, setSendSlack] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BulkCreateResult[] | null>(null);

  const [selectedServerIds, setSelectedServerIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (open) {
      setSelectedServerIds(new Set(servers.map(s => s.id)));
    }
  }, [open, servers]);

  const generatedNames = useMemo(() => {
    const f = sanitize(firstName);
    const l = sanitize(lastName);
    if (!f || !l) return [];
    return servers
      .filter(s => selectedServerIds.has(s.id))
      .map(s => ({ serverName: s.name, clientName: `${f}_${l}_${s.env_label}` }));
  }, [firstName, lastName, servers, selectedServerIds]);

  const emailValid = email.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const namesValid = sanitize(firstName).length > 0 && sanitize(lastName).length > 0;
  const passwordMismatch = usePassword && password !== confirmPassword && confirmPassword.length > 0;
  const passwordTooShort = usePassword && password.length > 0 && password.length < 4;
  const isValid = namesValid && email.length > 0 && emailValid &&
    selectedServerIds.size > 0 &&
    (!usePassword || (password.length >= 4 && password === confirmPassword));

  const resetForm = () => {
    setFirstName('');
    setLastName('');
    setEmail('');
    setUsePassword(false);
    setPassword('');
    setConfirmPassword('');
    setSendSlack(true);
    setError(null);
    setResults(null);
    setSelectedServerIds(new Set(servers.map(s => s.id)));
  };

  const handleClose = () => {
    if (results) {
      resetForm();
    }
    onClose();
  };

  const toggleServer = (id: number) => {
    setSelectedServerIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    try {
      setLoading(true);
      setError(null);
      const res = await api.bulkCreateClient(
        Array.from(selectedServerIds),
        firstName.trim(), lastName.trim(), email.trim(),
        usePassword, usePassword ? password : undefined, sendSlack,
      );
      setResults(res.results);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (results) {
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return (
      <Modal open={open} onClose={handleClose} title="Client Creation Results">
        <div className="space-y-3">
          <div className={`p-3 rounded-xl border ${
            failCount === 0
              ? 'bg-emerald-500/10 border-emerald-500/25'
              : successCount === 0
                ? 'bg-red-500/10 border-red-500/25'
                : 'bg-amber-500/10 border-amber-500/25'
          }`}>
            <p className={`text-sm font-medium ${
              failCount === 0 ? 'text-emerald-400' : successCount === 0 ? 'text-red-400' : 'text-amber-400'
            }`}>
              {failCount === 0
                ? `Created on all ${successCount} server${successCount > 1 ? 's' : ''}`
                : successCount === 0
                  ? `Failed on all ${failCount} server${failCount > 1 ? 's' : ''}`
                  : `${successCount} succeeded, ${failCount} failed`}
            </p>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {results.map((r) => (
              <div key={r.server_id} className="p-3 bg-gray-800/60 border border-gray-700 rounded-xl">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {r.success
                      ? <Check size={14} className="text-emerald-400 shrink-0" />
                      : <XCircle size={14} className="text-red-400 shrink-0" />}
                    <span className="text-sm font-medium text-white">{r.server_name}</span>
                  </div>
                  <span className="text-xs font-mono text-gray-400">{r.client_name}</span>
                </div>
                {r.error && (
                  <p className="text-xs text-red-400 ml-6">{r.error}</p>
                )}
                {r.success && sendSlack && (
                  <div className="flex items-center gap-1.5 ml-6 mt-1">
                    <MessageSquare size={12} className={r.slack_sent ? 'text-indigo-400' : 'text-amber-400'} />
                    <span className={`text-xs ${r.slack_sent ? 'text-indigo-400' : 'text-amber-400'}`}>
                      {r.slack_sent ? 'Slack sent' : r.slack_error || 'Slack failed'}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => { resetForm(); }}
              className="px-4 py-2.5 text-sm font-medium text-gray-300 bg-gray-800 rounded-xl border border-gray-700 hover:border-gray-600 hover:text-white transition-all"
            >
              Create Another
            </button>
            <button
              onClick={handleClose}
              className="px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all"
            >
              Done
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add Client to Multiple Servers">
      <form onSubmit={handleSubmit}>
        <p className="text-sm text-gray-400 mb-5">
          Create a VPN client across multiple servers at once
        </p>

        {/* Server selection */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">Servers</label>
          <div className="space-y-1.5 p-3 bg-gray-800/40 border border-gray-700 rounded-xl max-h-40 overflow-y-auto">
            {servers.map(s => (
              <label key={s.id} className="flex items-center gap-3 cursor-pointer group py-1">
                <input
                  type="checkbox"
                  checked={selectedServerIds.has(s.id)}
                  onChange={() => toggleServer(s.id)}
                  disabled={loading}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500/50 focus:ring-offset-0 cursor-pointer"
                />
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Server size={14} className={selectedServerIds.has(s.id) ? 'text-indigo-400' : 'text-gray-500'} />
                  <span className={`text-sm truncate ${selectedServerIds.has(s.id) ? 'text-white' : 'text-gray-400'}`}>
                    {s.name}
                  </span>
                  <span className="text-xs text-gray-500 font-mono">{s.env_label}</span>
                </div>
              </label>
            ))}
          </div>
          {selectedServerIds.size === 0 && (
            <p className="text-xs text-red-400 mt-1.5">Select at least one server.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">First Name</label>
            <input
              type="text"
              value={firstName}
              onChange={e => { setFirstName(e.target.value); setError(null); }}
              placeholder="John"
              disabled={loading}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all disabled:opacity-50"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Last Name</label>
            <input
              type="text"
              value={lastName}
              onChange={e => { setLastName(e.target.value); setError(null); }}
              placeholder="Doe"
              disabled={loading}
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all disabled:opacity-50"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
          <div className="relative">
            <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError(null); }}
              placeholder="john.doe@company.com"
              disabled={loading}
              className={`w-full pl-10 pr-4 py-2.5 bg-gray-800 border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 transition-all disabled:opacity-50 ${
                email.length > 0 && !emailValid
                  ? 'border-red-500/50 focus:ring-red-500/40'
                  : 'border-gray-700 focus:ring-indigo-500/50 focus:border-indigo-500'
              }`}
            />
          </div>
          {email.length > 0 && !emailValid && (
            <div className="flex items-start gap-1.5 mt-2">
              <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs text-red-400">Please enter a valid email address.</p>
            </div>
          )}
        </div>

        {generatedNames.length > 0 && (
          <div className="mb-4 p-3 bg-gray-800/60 border border-gray-700 rounded-xl">
            <p className="text-xs text-gray-400 mb-1.5">VPN username{generatedNames.length > 1 ? 's' : ''} will be:</p>
            <div className="space-y-1">
              {generatedNames.map(({ serverName: sn, clientName }) => (
                <div key={clientName} className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">{sn}</span>
                  <span className="text-sm text-white font-mono font-medium">{clientName}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-300 mb-3">Authentication</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setUsePassword(false)}
              disabled={loading}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                !usePassword
                  ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                  : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600'
              }`}
            >
              <ShieldOff size={16} />
              No Password
            </button>
            <button
              type="button"
              onClick={() => setUsePassword(true)}
              disabled={loading}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                usePassword
                  ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                  : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600'
              }`}
            >
              <Shield size={16} />
              With Password
            </button>
          </div>
        </div>

        {usePassword && (
          <div className="mb-5 space-y-3 animate-fade-in">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(null); }}
                placeholder="Enter password"
                disabled={loading}
                minLength={4}
                className={`w-full px-4 py-2.5 bg-gray-800 border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 transition-all disabled:opacity-50 ${
                  passwordTooShort
                    ? 'border-red-500/50 focus:ring-red-500/40'
                    : 'border-gray-700 focus:ring-indigo-500/50 focus:border-indigo-500'
                }`}
              />
              {passwordTooShort && (
                <p className="text-xs text-red-400 mt-1.5">Password must be at least 4 characters.</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => { setConfirmPassword(e.target.value); setError(null); }}
                placeholder="Confirm password"
                disabled={loading}
                className={`w-full px-4 py-2.5 bg-gray-800 border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 transition-all disabled:opacity-50 ${
                  passwordMismatch
                    ? 'border-red-500/50 focus:ring-red-500/40'
                    : 'border-gray-700 focus:ring-indigo-500/50 focus:border-indigo-500'
                }`}
              />
              {passwordMismatch && (
                <p className="text-xs text-red-400 mt-1.5">Passwords do not match.</p>
              )}
            </div>
          </div>
        )}

        <div className="mb-5">
          <label className="flex items-center gap-3 cursor-pointer group">
            <div
              onClick={() => !loading && setSendSlack(!sendSlack)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                sendSlack ? 'bg-indigo-600' : 'bg-gray-700'
              }`}
            >
              <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                sendSlack ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </div>
            <div className="flex items-center gap-2">
              <MessageSquare size={15} className={sendSlack ? 'text-indigo-400' : 'text-gray-500'} />
              <span className={`text-sm ${sendSlack ? 'text-gray-200' : 'text-gray-500'}`}>
                Send .ovpn via Slack
              </span>
            </div>
          </label>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-white bg-gray-800 rounded-xl border border-gray-700 hover:border-gray-600 transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !isValid}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all disabled:opacity-50 disabled:hover:bg-indigo-600"
          >
            {loading ? <Spinner /> : <UserPlus size={16} />}
            {loading
              ? `Creating on ${selectedServerIds.size} server${selectedServerIds.size > 1 ? 's' : ''}...`
              : `Create on ${selectedServerIds.size} server${selectedServerIds.size > 1 ? 's' : ''}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
