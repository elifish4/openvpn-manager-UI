import { useState, useEffect } from 'react';
import {
  Users, Trash2, ShieldCheck, Eye,
  AlertTriangle, ArrowLeft, RefreshCw, UserCircle2,
} from 'lucide-react';
import { api, type AppUser } from '../api';
import { useAuth } from '../auth';
import { Spinner } from './Spinner';
import { Modal } from './Modal';

interface AdminPanelProps {
  onBack: () => void;
}

export function AdminPanel({ onBack }: AdminPanelProps) {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<AppUser | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      setError('');
      const data = await api.getUsers();
      setUsers(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchUsers();
    setRefreshing(false);
  };

  const handleToggleRole = async (u: AppUser) => {
    if (u.email === currentUser?.email) return; // safety: backend also blocks this
    const nextRole = u.role === 'admin' ? 'viewer' : 'admin';
    setBusyEmail(u.email);
    setError('');
    try {
      const updated = await api.updateUserRole(u.email, nextRole);
      setUsers(prev => prev.map(x => x.email === u.email ? updated : x));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyEmail(null);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onBack}
          className="p-2 rounded-xl bg-gray-800/50 border border-gray-700 hover:border-gray-600 hover:bg-gray-800 text-gray-400 hover:text-white transition-all"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-white">User Management</h2>
          <p className="text-sm text-gray-400">
            Users appear here after their first Google sign-in. Promote viewers to admins as needed.
          </p>
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
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-lg">
              <Users size={18} className="text-indigo-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Total Users</p>
              <p className="text-lg font-semibold text-white">{users.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-lg">
              <ShieldCheck size={18} className="text-amber-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Admins</p>
              <p className="text-lg font-semibold text-white">{users.filter(u => u.role === 'admin').length}</p>
            </div>
          </div>
        </div>
        <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <Eye size={18} className="text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Viewers</p>
              <p className="text-lg font-semibold text-white">{users.filter(u => u.role === 'viewer').length}</p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner className="w-6 h-6" />
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <UserCircle2 size={40} className="mx-auto mb-3 text-gray-600" />
          <p className="text-sm">No users yet. They'll show up the moment someone signs in with Google.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-900/80 border-b border-gray-800">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">User</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Role</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Last Sign-in</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {users.map(u => {
                const isSelf = u.email === currentUser?.email;
                const isBusy = busyEmail === u.email;
                return (
                  <tr key={u.email} className="group hover:bg-gray-900/40 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        {u.picture ? (
                          <img
                            src={u.picture}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 rounded-full ring-1 ring-gray-700"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center ring-1 ring-gray-700">
                            <UserCircle2 size={20} className="text-gray-500" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-white truncate">{u.name || u.email}</span>
                            {isSelf && (
                              <span className="text-[10px] font-medium text-indigo-400 bg-indigo-500/15 px-1.5 py-0.5 rounded-full">you</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 truncate">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ${
                        u.role === 'admin'
                          ? 'bg-amber-500/15 text-amber-400 ring-amber-500/25'
                          : 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/25'
                      }`}>
                        {u.role === 'admin'
                          ? <><ShieldCheck size={12} /> Admin</>
                          : <><Eye size={12} /> Viewer</>}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-400">
                      {u.last_login ? new Date(u.last_login).toLocaleString() : <span className="text-gray-600">never</span>}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        {!isSelf && (
                          <>
                            <button
                              onClick={() => handleToggleRole(u)}
                              disabled={isBusy}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg ring-1 transition-all disabled:opacity-50 ${
                                u.role === 'admin'
                                  ? 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/25 hover:bg-emerald-500/20'
                                  : 'text-amber-300 bg-amber-500/10 ring-amber-500/25 hover:bg-amber-500/20'
                              }`}
                            >
                              {isBusy ? <Spinner /> : u.role === 'admin' ? <Eye size={13} /> : <ShieldCheck size={13} />}
                              {u.role === 'admin' ? 'Demote to viewer' : 'Promote to admin'}
                            </button>
                            <button
                              onClick={() => setConfirmDelete(u)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-300 bg-red-500/10 rounded-lg hover:bg-red-500/20 ring-1 ring-red-500/25 transition-all"
                            >
                              <Trash2 size={13} />
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <DeleteUserModal
        user={confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onDeleted={fetchUsers}
      />
    </div>
  );
}


function DeleteUserModal({ user, onClose, onDeleted }: { user: AppUser | null; onClose: () => void; onDeleted: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      await api.deleteUser(user.email);
      onClose();
      onDeleted();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={user !== null} onClose={onClose} title="Remove User">
      <div className="flex items-start gap-3 mb-5">
        <div className="p-2 bg-red-500/10 rounded-lg mt-0.5">
          <AlertTriangle className="text-red-400" size={20} />
        </div>
        <div>
          <p className="text-sm text-gray-300">
            Remove <span className="text-white font-medium">{user?.name || user?.email}</span>?
          </p>
          <p className="text-sm text-gray-500 mt-1">
            They will lose access immediately. If they sign in with Google again, they'll be re-created
            as a viewer.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-sm text-red-400">{error}</div>
      )}

      <div className="flex justify-end gap-3">
        <button
          onClick={onClose}
          disabled={loading}
          className="px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-white bg-gray-800 rounded-xl border border-gray-700 hover:border-gray-600 transition-all disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-xl transition-all disabled:opacity-50"
        >
          {loading ? <Spinner /> : <Trash2 size={16} />}
          {loading ? 'Removing...' : 'Remove User'}
        </button>
      </div>
    </Modal>
  );
}
