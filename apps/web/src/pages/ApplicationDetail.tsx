import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  getApplicationDetail, getVerificationResult, getDocuments, getAuditEvents,
  type ApplicationSummary, type VerificationResult, type DocumentInfo, type AuditEvent,
} from '../api/client';
import DocumentStatus from '../components/DocumentStatus';

const resultColors: Record<string, string> = {
  pass: 'text-emerald-700 bg-emerald-50',
  mismatch: 'text-red-700 bg-red-50',
  missing: 'text-amber-700 bg-amber-50',
};

const resultIcons: Record<string, string> = {
  pass: '✓',
  mismatch: '✗',
  missing: '—',
};

interface ApplicationDetailProps {
  token: string;
}

export default function ApplicationDetail({ token }: ApplicationDetailProps) {
  const { id } = useParams<{ id: string }>();
  const [app, setApp] = useState<ApplicationSummary | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      getApplicationDetail(token, id).then(setApp),
      getVerificationResult(token, id).then(setResult).catch(() => null),
      getDocuments(token, id).then(setDocs).catch(() => []),
      getAuditEvents(token, id).then(setAudit).catch(() => []),
    ])
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [id, token]);

  // Refresh result periodically while processing
  useEffect(() => {
    if (!id || !result || ['completed', 'verified', 'needs_review', 'missing'].includes(result.status)) return;
    const interval = setInterval(() => {
      getVerificationResult(token, id).then(setResult).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [id, token, result?.status]);

  if (loading) return <p className="text-slate-500">Loading…</p>;
  if (error) return <p className="text-red-600">{error}</p>;
  if (!id || !app) return <p className="text-slate-500">Application not found.</p>;

  const isTerminal = result && ['completed', 'verified', 'needs_review', 'missing'].includes(result.status);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/dashboard" className="text-sm text-sky-700 hover:underline">← Dashboard</Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h1 className="text-xl font-bold text-slate-900">Application Detail</h1>
        <p className="mt-1 font-mono text-sm text-slate-500">{id}</p>
      </div>

      {/* Live status */}
      <DocumentStatus applicationId={id} initialStatus={app.status} token={token} />

      {/* Verification Result */}
      {isTerminal && result?.validations && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Verification Result</h2>
            {result.match_score !== undefined && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-500">Match Score</span>
                <span className={`rounded-full px-4 py-1.5 text-lg font-bold ${
                  result.match_score >= 80 ? 'bg-emerald-100 text-emerald-800' :
                  result.match_score >= 50 ? 'bg-amber-100 text-amber-800' :
                  'bg-red-100 text-red-800'
                }`}>
                  {result.match_score}%
                </span>
              </div>
            )}
          </div>

          <div className={`mt-4 rounded-lg p-4 ${
            result.decision === 'verified' ? 'bg-emerald-50 border border-emerald-200' :
            result.decision === 'needs_review' ? 'bg-amber-50 border border-amber-200' :
            'bg-red-50 border border-red-200'
          }`}>
            <p className={`font-semibold ${
              result.decision === 'verified' ? 'text-emerald-800' :
              result.decision === 'needs_review' ? 'text-amber-800' :
              'text-red-800'
            }`}>
              {result.decision === 'verified' ? '✓ Verified' :
               result.decision === 'needs_review' ? '⚠ Needs Review' :
               '⬚ Missing Information'}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {result.decision === 'verified'
                ? 'All checked fields match the expected values.'
                : result.decision === 'needs_review'
                ? 'Some fields do not match. A reviewer should check the flagged fields. Documents are never auto-rejected.'
                : 'Required information could not be found in the document.'}
            </p>
          </div>

          {/* Score explanation */}
          {result.match_score !== undefined && (
            <p className="mt-3 text-xs text-slate-500">
              Match score represents the percentage of validated fields that match expected values.
              This is not an authenticity probability — it reflects extraction and comparison accuracy only.
            </p>
          )}

          {/* Field-by-field table */}
          <div className="mt-6 overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Field</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Expected</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Extracted</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Result</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.validations.map((v, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800 capitalize">{v.field.replace('_', ' ')}</td>
                    <td className="px-4 py-3 text-slate-600">{v.expected ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{v.extracted ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${resultColors[v.result] || ''}`}>
                        {resultIcons[v.result]} {v.result}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{v.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Documents */}
      {docs.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Documents</h2>
          <div className="mt-3 space-y-2">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg border border-slate-100 p-3">
                <div>
                  <p className="text-sm font-medium text-slate-700">{d.filename}</p>
                  <p className="text-xs text-slate-400">{d.content_type} — {new Date(d.created_at).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit trail */}
      {audit.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Audit Trail</h2>
          <div className="mt-3 space-y-2">
            {audit.map((e) => (
              <div key={e.id} className="flex items-start gap-3 border-l-2 border-slate-200 pl-4 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-700">{e.event}</p>
                  <p className="text-xs text-slate-400">{new Date(e.created_at).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
