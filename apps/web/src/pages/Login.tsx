import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, register } from '../api/client';

interface LoginProps {
  onLogin: (token: string) => void;
}

type View = 'login' | 'register' | 'welcome';

export default function Login({ onLogin }: LoginProps) {
  const [view, setView] = useState<View>('login');
  const [welcomeName, setWelcomeName] = useState('');

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register fields
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const token = await login(loginEmail, loginPassword);
      onLogin(token);
      navigate('/dashboard');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to connect to the API.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (regPassword !== regConfirm) {
      setError('Passwords do not match.');
      return;
    }
    if (regPassword.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    setBusy(true);
    try {
      await register(regName, regEmail, regPassword);
      setWelcomeName(regName);
      setView('welcome');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to connect to the API.');
    } finally {
      setBusy(false);
    }
  }

  function goToLoginFromWelcome() {
    setLoginEmail(regEmail);
    setLoginPassword('');
    setRegName('');
    setRegEmail('');
    setRegPassword('');
    setRegConfirm('');
    setError('');
    setView('login');
  }

  // ---------- Welcome view ----------
  if (view === 'welcome') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <svg className="h-8 w-8 text-green-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Welcome, {welcomeName}!
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Your account has been created successfully. You can now sign in to access the portal.
          </p>
          <button
            onClick={goToLoginFromWelcome}
            className="mt-6 w-full rounded-lg bg-sky-700 px-5 py-2.5 font-semibold text-white hover:bg-sky-800"
          >
            Sign in now
          </button>
        </section>
      </div>
    );
  }

  // ---------- Create Account view ----------
  if (view === 'register') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create Account</h1>
          <p className="mt-2 text-sm text-slate-600">
            Use synthetic data only. Do not enter real student information.
          </p>
          <form className="mt-6 space-y-4" onSubmit={handleRegister}>
            <label className="block text-sm font-medium text-slate-700">
              Name
              <input
                autoComplete="name" type="text" required value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="Your full name"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Email
              <input
                autoComplete="email" type="email" required value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Password
              <input
                autoComplete="new-password" type="password" required value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                placeholder="At least 12 characters"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Confirm Password
              <input
                autoComplete="new-password" type="password" required value={regConfirm}
                onChange={(e) => setRegConfirm(e.target.value)}
                placeholder="Re-enter your password"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
              />
            </label>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <button
              type="submit" disabled={busy}
              className="w-full rounded-lg bg-sky-700 px-5 py-2.5 font-semibold text-white hover:bg-sky-800 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? 'Creating account…' : 'Create Account'}
            </button>
            <p className="text-center text-sm text-slate-600">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => { setError(''); setView('login'); }}
                className="font-semibold text-sky-700 hover:text-sky-800"
              >
                Sign in
              </button>
            </p>
          </form>
        </section>
      </div>
    );
  }

  // ---------- Login view (default) ----------
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sign in to DocFlow</h1>
        <p className="mt-2 text-sm text-slate-600">
          Use a synthetic test account. Do not enter real student information.
        </p>
        <form className="mt-6 space-y-4" onSubmit={handleLogin}>
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input
              autoComplete="email" type="email" required value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Password
            <input
              autoComplete="current-password" type="password" required value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="Enter your password"
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
            />
          </label>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button
            type="submit" disabled={busy}
            className="w-full rounded-lg bg-sky-700 px-5 py-2.5 font-semibold text-white hover:bg-sky-800 disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-center text-sm text-slate-600">
            Don't have an account?{' '}
            <button
              type="button"
              onClick={() => { setError(''); setView('register'); }}
              className="font-semibold text-sky-700 hover:text-sky-800"
            >
              Create Account
            </button>
          </p>
        </form>
      </section>
    </div>
  );
}
