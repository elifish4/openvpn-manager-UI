import { useState, useEffect, type FormEvent } from 'react';
import {
  Users, UserPlus, Trash2, KeyRound, ShieldCheck, Eye,
  AlertTriangle, ArrowLeft, RefreshCw, Pencil,
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
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
          <p className="text-sm text-gray-400">Manage who can access the VPN Manager</p>
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
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all shadow-lg shadow-indigo-500/20"
          >
            <UserPlus size={16} />
            Add User
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
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-800">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-900/80 border-b border-gray-800">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">User</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Role</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Created</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {users.map(u => (
                <tr key={u.username} className="group hover:bg-gray-900/40 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${u.role === 'admin' ? 'bg-amber-500/10' : 'bg-emerald-500/10'}`}>
                        {u.role === 'admin' ? <ShieldCheck size={16} className="text-amber-400" /> : <Eye size={16} className="text-emerald-400" />}
                      </div>
                      <div>
                        <span className="font-medium text-white">{u.username}</span>
                        {u.username === currentUser?.username && (
                          <span className="ml-2 text-[10px] font-medium text-indigo-400 bg-indigo-500/15 px-1.5 py-0.5 rounded-full">you</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ${
                      u.role === 'admin'
                        ? 'bg-amber-500/15 text-amber-400 ring-amber-500/25'
                        : 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/25'
                    }`}>
                      {u.role === 'admin' ? 'Admin' : 'Viewer'}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-400">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center gap-2 justify-end opacity-60 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setEditUser(u)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-300 bg-indigo-500/10 rounded-lg hover:bg-indigo-500/20 ring-1 ring-indigo-500/25 transition-all"
                      >
                        <Pencil size={13} />
                        Edit
                      </button>
                      {u.username !== currentUser?.username && (
                        <button
                          onClick={() => setConfirmDelete(u.username)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-300 bg-red-500/10 rounded-lg hover:bg-red-500/20 ring-1 ring-red-500/25 transition-all"
                        >
                          <Trash2 size={13} />
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateUserModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={fetchUsers} />
      <EditUserModal user={editUser} onClose={() => setEditUser(null)} onUpdated={fetchUsers} />
      <DeleteUserModal username={confirmDelete} onClose={() => setConfirmDelete(null)} onDeleted={fetchUsers} />
    </div>
  );
}


function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('viewer');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api.createUser(username, password, role);
      setUsername('');
      setPassword('');
      setRole('viewer');
      onClose();
      onCreated();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create User">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-sm text-red-400">{error}</div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">Username</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
            className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 transition-all"
            placeholder="Enter username"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={4}
            className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 transition-all"
            placeholder="Enter password"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">Role</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setRole('viewer')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                role === 'viewer'
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                  : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600'
              }`}
            >
              <Eye size={16} />
              Viewer
            </button>
            <button
              type="button"
              onClick={() => setRole('admin')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                role === 'admin'
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                  : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600'
              }`}
            >
              <ShieldCheck size={16} />
              Admin
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-white bg-gray-800 rounded-xl border border-gray-700 hover:border-gray-600 transition-all"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all disabled:opacity-50"
          >
            {loading ? <Spinner /> : <UserPlus size={16} />}
            {loading ? 'Creating...' : 'Create User'}
          </button>
        </div>
      </form>
    </Modal>
  );
}


function EditUserModal({ user, onClose, onUpdated }: { user: AppUser | null; onClose: () => void; onUpdated: () => void }) {
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      setRole(user.role);
      setPassword('');
      setError('');
    }
  }, [user]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const data: { password?: string; role?: string } = {};
      if (password) data.password = password;
      if (role !== user.role) data.role = role;
      await api.updateUser(user.username, data);
      onClose();
      onUpdated();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={user !== null} onClose={onClose} title={`Edit User: ${user?.username || ''}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-sm text-red-400">{error}</div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">New Password (leave blank to keep)</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 bg-gray-800/50 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 transition-all"
            placeholder="Enter new password"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1.5">Role</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setRole('viewer')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                role === 'viewer'
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                  : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600'
              }`}
            >
              <Eye size={16} />
              Viewer
            </button>
            <button
              type="button"
              onClick={() => setRole('admin')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                role === 'admin'
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                  : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600'
              }`}
            >
              <ShieldCheck size={16} />
              Admin
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-white bg-gray-800 rounded-xl border border-gray-700 hover:border-gray-600 transition-all"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all disabled:opacity-50"
          >
            {loading ? <Spinner /> : <KeyRound size={16} />}
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}


function DeleteUserModal({ username, onClose, onDeleted }: { username: string | null; onClose: () => void; onDeleted: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    if (!username) return;
    setLoading(true);
    setError('');
    try {
      await api.deleteUser(username);
      onClose();
      onDeleted();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={username !== null} onClose={onClose} title="Delete User">
      <div className="flex items-start gap-3 mb-5">
        <div className="p-2 bg-red-500/10 rounded-lg mt-0.5">
          <AlertTriangle className="text-red-400" size={20} />
        </div>
        <div>
          <p className="text-sm text-gray-300">
            Are you sure you want to delete <span className="text-white font-medium">{username}</span>?
          </p>
          <p className="text-sm text-gray-500 mt-1">
            This user will no longer be able to access the VPN Manager.
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
          {loading ? 'Deleting...' : 'Delete User'}
        </button>
      </div>
    </Modal>
  );
}
