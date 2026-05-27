import { useState } from 'react';
import { Shield, AlertCircle } from 'lucide-react';
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { useAuth } from '../auth';
import { Spinner } from './Spinner';

export function LoginPage() {
  const { googleLogin, config, configLoading, configError } = useAuth();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSuccess = async (credential: string | undefined) => {
    if (!credential) {
      setError('Google did not return a credential');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await googleLogin(credential);
    } catch (err: any) {
      setError(err.message || 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-indigo-500/10 rounded-2xl ring-1 ring-indigo-500/20 mb-4">
            <Shield className="text-indigo-400" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-white">OpenVPN Manager</h1>
          <p className="text-gray-500 text-sm mt-1">Sign in with your Google account</p>
        </div>

        <div className="bg-gray-900/50 border border-gray-800 rounded-2xl p-6 space-y-5">
          {(error || configError) && (
            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-sm text-red-400">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error || configError}</span>
            </div>
          )}

          {configLoading ? (
            <div className="flex items-center justify-center py-6">
              <Spinner />
            </div>
          ) : !config?.google_client_id ? (
            <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/25 rounded-xl text-sm text-amber-300">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>
                Google SSO is not configured. Set <code className="font-mono">GOOGLE_CLIENT_ID</code> on the backend
                (or <code className="font-mono">googleClientId</code> in your Helm values) and reload.
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              {loading ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm py-3">
                  <Spinner /> Signing in...
                </div>
              ) : (
                <GoogleOAuthProvider clientId={config.google_client_id}>
                  <GoogleLogin
                    onSuccess={(resp) => handleSuccess(resp.credential)}
                    onError={() => setError('Google sign-in failed')}
                    theme="filled_black"
                    shape="pill"
                    size="large"
                    text="signin_with"
                  />
                </GoogleOAuthProvider>
              )}

              {config.allowed_domains.length > 0 && (
                <p className="text-xs text-gray-500 text-center pt-2">
                  Restricted to: {config.allowed_domains.map(d => `@${d}`).join(', ')}
                </p>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          New users start as <span className="text-emerald-400">read-only</span>.
          An admin can promote you on the Admin page.
        </p>
      </div>
    </div>
  );
}
