import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, register } from '../api/client';

interface LoginProps {
  onLogin: (token: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function signIn(createAccount: boolean) {
    setBusy(true);
    setError('');
    try {
      if (createAccount) await register(email, password);
      const token = await login(email, password);
      onLogin(token);
      navigate('/dashboard');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to connect to the API.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sign in to DocFlow</h1>
        <p className="mt-2 text-sm text-slate-600">
          Use a synthetic test account. Do not enter real student information.
        </p>
        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); void signIn(false); }}>
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input
              autoComplete="email" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Password
            <input
              autoComplete="current-password" type="password" required value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
            />
          </label>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex flex-wrap gap-3 pt-1">
            <button
              type="submit" disabled={busy}
              className="rounded-lg bg-sky-700 px-5 py-2.5 font-semibold text-white hover:bg-sky-800 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? 'Please wait…' : 'Sign in'}
            </button>
            <button
              type="button" disabled={busy}
              onClick={() => void signIn(true)}
              className="rounded-lg border border-slate-300 px-5 py-2.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
            >
              Create account
            </button>
          </div>
          <p className="text-xs text-slate-500">Password must be at least 12 characters.</p>
        </form>
      </section>
    </div>
  );
}
