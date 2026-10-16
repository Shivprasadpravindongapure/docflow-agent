import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getReviewQueue, type ReviewQueueItem } from '../api/client';

interface ReviewerQueueProps {
  token: string;
}

export default function ReviewerQueue({ token }: ReviewerQueueProps) {
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'needs_review' | 'missing'>('all');

  useEffect(() => {
    setLoading(true);
    getReviewQueue(token)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load queue'))
      .finally(() => setLoading(false));
  }, [token]);

  const filtered = filter === 'all' ? items : items.filter((i) => i.status === filter);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Review Queue</h1>
      <p className="mt-1 text-sm text-slate-600">Documents flagged for human review</p>

      <div className="mt-6 flex gap-2">
        {(['all', 'needs_review', 'missing'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              filter === f ? 'bg-sky-700 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f === 'all' ? 'All' : f === 'needs_review' ? 'Needs Review' : 'Missing'}
          </button>
        ))}
      </div>

      {loading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {!loading && filtered.length === 0 && (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-lg font-medium text-slate-600">No items in the queue</p>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {filtered.map((item) => (
          <Link
            key={item.id}
            to={`/reviewer/${item.id}`}
            className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-sky-300 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {(item.form_json as { name?: string }).name || 'Unknown'}
                </p>
                <p className="mt-1 font-mono text-xs text-slate-400">{item.id.slice(0, 12)}…</p>
                <p className="text-xs text-slate-400">{new Date(item.created_at).toLocaleString()}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                item.status === 'needs_review' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
              }`}>
                {item.status === 'needs_review' ? 'Needs Review' : 'Missing'}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
