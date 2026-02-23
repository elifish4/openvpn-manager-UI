import { useState, useMemo } from 'react';
import { UserPlus, Shield, ShieldOff, AlertTriangle, Mail, MessageSquare, Check } from 'lucide-react';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { api } from '../api';

interface CreateClientModalProps {
  open: boolean;
  onClose: () => void;
  serverId: number;
  serverName: string;
  envLabel: string;
  onCreated: () => void;
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

type CreateResult = { clientName: string; slackSent: boolean; slackError: string | null } | null;

export function CreateClientModal({ open, onClose, serverId, serverName, envLabel, onCreated }: CreateClientModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sendSlack, setSendSlack] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult>(null);

  const generatedName = useMemo(() => {
    const f = sanitize(firstName);
    const l = sanitize(lastName);
    if (!f || !l) return '';
    return `${f}_${l}_${envLabel}`;
  }, [firstName, lastName, envLabel]);

  const emailValid = email.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const namesValid = sanitize(firstName).length > 0 && sanitize(lastName).length > 0;
  const passwordMismatch = usePassword && password !== confirmPassword && confirmPassword.length > 0;
  const passwordTooShort = usePassword && password.length > 0 && password.length < 4;
  const isValid = namesValid && email.length > 0 && emailValid &&
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
    setResult(null);
  };

  const handleClose = () => {
    if (result) {
      resetForm();
      onCreated();
    }
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    try {
      setLoading(true);
      setError(null);
      const res = await api.createClient(
        serverId, firstName.trim(), lastName.trim(), email.trim(),
        usePassword, usePassword ? password : undefined, sendSlack,
      );
      setResult({
        clientName: res.client_name || generatedName,
        slackSent: res.slack_sent || false,
        slackError: res.slack_error || null,
      });
      onCreated();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <Modal open={open} onClose={handleClose} title="Client Created">
        <div className="space-y-4">
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/25 rounded-xl">
            <div className="flex items-center gap-2 mb-1">
              <Check size={18} className="text-emerald-400" />
              <span className="text-sm font-medium text-emerald-400">VPN client created successfully</span>
            </div>
            <p className="text-sm text-gray-300 ml-6">
              Username: <span className="font-mono text-white">{result.clientName}</span>
            </p>
          </div>

          {sendSlack && (
            <div className={`p-4 rounded-xl border ${
              result.slackSent
                ? 'bg-indigo-500/10 border-indigo-500/25'
                : 'bg-amber-500/10 border-amber-500/25'
            }`}>
              <div className="flex items-center gap-2 mb-1">
                <MessageSquare size={16} className={result.slackSent ? 'text-indigo-400' : 'text-amber-400'} />
                <span className={`text-sm font-medium ${result.slackSent ? 'text-indigo-400' : 'text-amber-400'}`}>
                  {result.slackSent ? 'OVPN file sent via Slack' : 'Slack delivery failed'}
                </span>
              </div>
              {!result.slackSent && result.slackError && (
                <p className="text-xs text-amber-400/80 ml-6">{result.slackError}</p>
              )}
            </div>
          )}

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
    <Modal open={open} onClose={handleClose} title="Add New Client">
      <form onSubmit={handleSubmit}>
        <p className="text-sm text-gray-400 mb-5">
          Create a new VPN client on <span className="text-indigo-400 font-medium">{serverName}</span>
        </p>

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

        {generatedName && (
          <div className="mb-4 p-3 bg-gray-800/60 border border-gray-700 rounded-xl">
            <p className="text-xs text-gray-400 mb-1">VPN username will be:</p>
            <p className="text-sm text-white font-mono font-medium">{generatedName}</p>
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

        {/* Slack toggle */}
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
            {loading ? 'Creating...' : 'Create Client'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
