import { useState } from 'react';

import { listApplications, login, register, type ApplicationSummary } from './api/client';
import DocumentStatus from './components/DocumentStatus';

export default function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signIn(createAccount: boolean) {
    setBusy(true);
    setError('');
    try {
      if (createAccount) await register(email, password);
      const sessionToken = await login(email, password);
      const ownedApplications = await listApplications(sessionToken);
      setApplications(ownedApplications);
      setToken(sessionToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to connect to the API.');
    } finally {
      setBusy(false);
    }
  }

  async function refreshApplications() {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      setApplications(await listApplications(token));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load applications.');
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    setToken(null);
    setApplications([]);
    setPassword('');
    setError('');
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-800">
            DocFlow
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Submission status
          </h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            Follow processing updates as they happen. Decisions are rule-based; missing fields
            and mismatches are surfaced for review, never auto-rejected.
          </p>
        </header>

        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Development preview only. Use synthetic test accounts and documents; do not enter
          real student information.
        </div>

        {!token ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-xl font-semibold">Applicant sign-in</h2>
            <p className="mt-1 text-sm text-slate-600">
              Use an account created through the synthetic Phase 4 API flow.
            </p>
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void signIn(false);
              }}
            >
              <label className="block text-sm font-medium text-slate-700">
                Email
                <input
                  autoComplete="email"
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Password
                <input
                  autoComplete="current-password"
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-sky-700 focus:ring-2 focus:ring-sky-100"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  className="rounded-lg bg-sky-800 px-4 py-2.5 font-semibold text-white hover:bg-sky-900 disabled:cursor-wait disabled:opacity-60"
                  disabled={busy}
                  type="submit"
                >
                  {busy ? 'Please wait…' : 'Sign in'}
                </button>
                <button
                  className="rounded-lg border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                  disabled={busy}
                  onClick={() => void signIn(true)}
                  type="button"
                >
                  Create synthetic account
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Account creation is for local synthetic testing and requires a password of at
                least 12 characters.
              </p>
            </form>
          </section>
        ) : (
          <section aria-label="Your applications">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">Your applications</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Status cards reconnect automatically if the live stream is interrupted.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  disabled={busy}
                  onClick={() => void refreshApplications()}
                  type="button"
                >
                  Refresh list
                </button>
                <button
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={signOut}
                  type="button"
                >
                  Sign out
                </button>
              </div>
            </div>
            {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
            {applications.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
                No applications are linked to this account yet.
              </div>
            ) : (
              <div className="space-y-3">
                {applications.map((application) => (
                  <DocumentStatus
                    applicationId={application.id}
                    initialStatus={application.status}
                    key={application.id}
                    token={token}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        <footer className="mt-8 border-t border-slate-200 pt-4 text-xs text-slate-500">
          Live status uses Server-Sent Events. Submission and reviewer screens are planned for
          later phases.
        </footer>
      </div>
    </main>
  );
}
