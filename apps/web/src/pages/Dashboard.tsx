import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listApplications, type ApplicationSummary } from '../api/client';

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  queued: 'bg-sky-100 text-sky-800',
  processing: 'bg-sky-100 text-sky-800',
  retry: 'bg-amber-100 text-amber-800',
  verified: 'bg-emerald-100 text-emerald-800',
  needs_review: 'bg-amber-100 text-amber-800',
  missing: 'bg-red-100 text-red-800',
  failed: 'bg-red-100 text-red-800',
};

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  queued: 'Queued',
  processing: 'Processing',
  retry: 'Retrying',
  verified: 'Verified',
  needs_review: 'Needs Review',
  missing: 'Missing Info',
  failed: 'Failed',
};

interface DashboardProps {
  token: string;
}

export default function Dashboard({ token }: DashboardProps) {
  const [apps, setApps] = useState<ApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    listApplications(token)
      .then(setApps)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load applications'))
      .finally(() => setLoading(false));
  }, [token]);

  const counts = apps.reduce(
    (acc, app) => {
      acc[app.status] = (acc[app.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">Your document verification submissions</p>
        </div>
        <Link
          to="/applications/new"
          className="rounded-lg bg-sky-700 px-5 py-2.5 font-semibold text-white hover:bg-sky-800"
        >
          + New Application
        </Link>
      </div>

      {/* Stats cards */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-500">Total</p>
          <p className="text-2xl font-bold text-slate-900">{apps.length}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm text-emerald-700">Verified</p>
          <p className="text-2xl font-bold text-emerald-800">{counts.verified || 0}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-700">Needs Review</p>
          <p className="text-2xl font-bold text-amber-800">{(counts.needs_review || 0) + (counts.missing || 0)}</p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <p className="text-sm text-sky-700">Processing</p>
          <p className="text-2xl font-bold text-sky-800">
            {(counts.queued || 0) + (counts.processing || 0) + (counts.retry || 0)}
          </p>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading applications…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && apps.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-lg font-medium text-slate-600">No applications yet</p>
          <p className="mt-2 text-sm text-slate-500">Create your first application to get started.</p>
          <Link
            to="/applications/new"
            className="mt-4 inline-block rounded-lg bg-sky-700 px-5 py-2.5 font-semibold text-white hover:bg-sky-800"
          >
            + New Application
          </Link>
        </div>
      )}

      {apps.length > 0 && (
        <div className="space-y-3">
          {apps.map((app) => (
            <Link
              key={app.id}
              to={`/applications/${app.id}`}
              className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-sky-300 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-sm text-slate-500">{app.id.slice(0, 12)}…</p>
                  {app.created_at && (
                    <p className="mt-1 text-xs text-slate-400">
                      {new Date(app.created_at).toLocaleString()}
                    </p>
                  )}
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    statusColors[app.status] || 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {statusLabels[app.status] || app.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
