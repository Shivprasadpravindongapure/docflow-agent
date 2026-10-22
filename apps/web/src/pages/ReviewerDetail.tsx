import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getReviewerAppDetail, startCaseAgentRun, submitReview, type ReviewerAppDetail } from '../api/client';

const resultColors: Record<string, string> = {
  pass: 'text-emerald-700 bg-emerald-50',
  mismatch: 'text-red-700 bg-red-50',
  missing: 'text-amber-700 bg-amber-50',
};

interface ReviewerDetailProps {
  token: string;
}

export default function ReviewerDetail({ token }: ReviewerDetailProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ReviewerAppDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [decision, setDecision] = useState<'verified' | 'needs_review' | 'missing'>('verified');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [agentQuestion, setAgentQuestion] = useState('Summarize the completed checks and any applicable policy evidence.');
  const [agentBusy, setAgentBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getReviewerAppDetail(token, id)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [id, token]);

  async function handleSubmitReview() {
    if (!id || !note.trim()) { setError('A review note is required.'); return; }
    setSubmitting(true);
    setError('');
    try {
      await submitReview(token, id, decision, note);
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit review');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAgentRun() {
    if (!id || !agentQuestion.trim()) return;
    setAgentBusy(true);
    setError('');
    try {
      await startCaseAgentRun(token, id, agentQuestion.trim());
      setDetail(await getReviewerAppDetail(token, id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assistant run failed');
    } finally {
      setAgentBusy(false);
    }
  }

  if (loading) return <p className="text-slate-500">Loading…</p>;
  if (error && !detail) return <p className="text-red-600">{error}</p>;
  if (!detail) return <p className="text-slate-500">Application not found.</p>;

  const form = detail.form_json as Record<string, string | number>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/reviewer" className="text-sm text-sky-700 hover:underline">← Review Queue</Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h1 className="text-xl font-bold text-slate-900">Review Application</h1>
        <p className="mt-1 font-mono text-sm text-slate-500">{id}</p>
        <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${
          detail.status === 'needs_review' ? 'bg-amber-100 text-amber-800' :
          detail.status === 'missing' ? 'bg-red-100 text-red-800' :
          detail.status === 'verified' ? 'bg-emerald-100 text-emerald-800' :
          'bg-slate-100 text-slate-700'
        }`}>
          {detail.status}
        </span>
      </div>

      {/* Application form data */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-bold text-slate-900">Application Form</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          {Object.entries(form).map(([key, val]) => (
            <div key={key}>
              <p className="text-xs text-slate-400 capitalize">{key.replace('_', ' ')}</p>
              <p className="font-medium text-slate-700">{String(val)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Validations */}
      {detail.documents.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Document-by-document results</h2>
          <div className="mt-4 space-y-4">
            {detail.documents.map((document) => {
              const result = document.result;
              const payload = result?.typed_payload;
              return (
                <article key={document.document_id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-800">{document.metadata.filename} · {document.metadata.document_type}</h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {document.metadata.processing_state} · {document.metadata.page_count ?? '—'} page(s) · {document.metadata.content_type}
                      </p>
                    </div>
                    {result?.decision && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">{result.decision.replace('_', ' ')}</span>}
                  </div>
                  {result && (result.document_type_status === 'unsupported' || result.document_type_status === 'uncertain') && (
                    <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      {result.reasoning?.summary ?? 'Type-specific checks were not run. Review the OCR/page evidence and classify this document.'}
                    </p>
                  )}
                  {payload && (
                    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                      {Object.entries(payload).filter(([key, value]) => !['document_type', 'schema_version', 'warnings'].includes(key) && value != null && value !== '').map(([key, value]) => (
                        <div key={key} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{key.replaceAll('_', ' ')}</dt>
                          <dd className="mt-1 break-words text-sm text-slate-800">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
                          {result?.field_provenance?.[key] && <dd className="mt-1 text-[10px] text-slate-400">Evidence: {result.field_provenance[key].join(', ') || 'No matching OCR text reference'}</dd>}
                        </div>
                      ))}
                    </dl>
                  )}
                  {result && (
                    <details className="mt-3 rounded-md border border-slate-200 bg-white p-3">
                      <summary className="cursor-pointer text-xs font-semibold text-sky-800">OCR and page evidence</summary>
                      <ul className="mt-2 flex flex-wrap gap-2">{document.evidence_refs.map((ref) => <li key={ref.reference_id} className="rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{ref.reference_id}</li>)}</ul>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-600">{result.ocr_text || 'No OCR text was available.'}</pre>
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {detail.documents.length <= 1 && detail.validations.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Field Validations</h2>
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
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
                {detail.validations.map((v, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3 font-medium capitalize">{v.field.replace('_', ' ')}</td>
                    <td className="px-4 py-3 text-slate-600">{v.expected ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{v.extracted ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${resultColors[v.result]}`}>
                        {v.result}
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

      <section className="rounded-xl border border-violet-200 bg-white p-6">
        <h2 className="text-lg font-bold text-slate-900">Case assistant</h2>
        <p className="mt-1 text-sm text-slate-600">The assistant organizes completed checks and policy evidence. It does not make the review decision.</p>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          Question
          <textarea value={agentQuestion} onChange={(e) => setAgentQuestion(e.target.value)} rows={2} maxLength={1000}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" />
        </label>
        <button onClick={() => void handleAgentRun()} disabled={agentBusy || !agentQuestion.trim()}
          className="mt-3 rounded-lg bg-violet-700 px-5 py-2.5 font-semibold text-white disabled:opacity-50">
          {agentBusy ? 'Running checks…' : 'Run case assistant'}
        </button>
        {detail.agent_runs.length === 0 ? <p className="mt-4 text-sm text-slate-500">No assistant runs yet. All documents must finish processing before a run.</p> : (
          <div className="mt-5 space-y-4">
            {detail.agent_runs.map((run) => (
              <article key={run.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-800">Assistant run · {run.status.replace('_', ' ')}</h3>
                  <time className="text-xs text-slate-400">{new Date(run.created_at).toLocaleString()}</time>
                </div>
                <p className="mt-1 text-sm text-slate-500">{run.question}</p>
                <p className="mt-3 text-sm text-slate-700">{run.summary}</p>
                {run.reason && <p className="mt-1 text-sm text-amber-700">Review reason: {run.reason}</p>}
                {run.policy_answers_json.length === 0 && <p className="mt-3 text-xs text-slate-500">No policy evidence was retrieved for this run.</p>}
                {run.policy_answers_json.map((answer, index) => (
                  <div key={`${run.id}-policy-${index}`} className="mt-3 rounded-md bg-violet-50 p-3 text-sm">
                    <p className="font-medium text-violet-900">Policy evidence · {answer.status}</p>
                    {answer.answer && <p className="mt-1 text-slate-700">{answer.answer}</p>}
                    {answer.citations.map((citation) => (
                      <blockquote key={citation.citation_id} className="mt-2 border-l-2 border-violet-300 pl-3 text-slate-600">
                        <p className="font-medium">{citation.title} · version {citation.version}{citation.section ? ` · ${citation.section}` : ''}</p>
                        <p className="mt-1">{citation.excerpt}</p>
                        <p className="mt-1 text-xs text-slate-400">Source {citation.source_id}</p>
                      </blockquote>
                    ))}
                  </div>
                ))}
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-slate-700">Tool timeline ({run.traces.length})</summary>
                  <ol className="mt-2 space-y-1 text-xs text-slate-600">
                    {run.traces.map((trace) => <li key={`${run.id}-${trace.ordinal}`}>{trace.tool} · {trace.outcome} · {trace.duration_ms} ms{trace.document_id ? ` · document ${trace.document_id.slice(0, 8)}` : ''}{trace.error_code ? ` · ${trace.error_code}` : ''}</li>)}
                  </ol>
                </details>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Previous reviews */}
      {detail.reviews.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Previous Reviews</h2>
          <div className="mt-3 space-y-3">
            {detail.reviews.map((r) => (
              <div key={r.id} className="rounded-lg border border-slate-100 p-4">
                <div className="flex justify-between">
                  <span className="text-sm font-semibold capitalize">{r.decision}</span>
                  <span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{r.note}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Review form */}
      {!submitted ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-6">
          <h2 className="text-lg font-bold text-slate-900">Submit Review</h2>
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-sm font-medium text-slate-700">Decision</p>
              <div className="mt-2 flex gap-3">
                {(['verified', 'needs_review', 'missing'] as const).map((d) => (
                  <label key={d} className={`cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium ${
                    decision === d ? 'border-sky-600 bg-white text-sky-800' : 'border-slate-300 text-slate-600'
                  }`}>
                    <input type="radio" name="decision" value={d} checked={decision === d}
                      onChange={() => setDecision(d)} className="sr-only" />
                    {d === 'verified' ? 'Verified' : d === 'needs_review' ? 'Needs Review' : 'Missing'}
                  </label>
                ))}
              </div>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              Review Note *
              <textarea required value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                placeholder="Explain your decision…"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-sky-600 focus:ring-2 focus:ring-sky-100 outline-none" />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              onClick={() => void handleSubmitReview()} disabled={submitting || !note.trim()}
              className="rounded-lg bg-sky-700 px-6 py-2.5 font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit Review'}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <p className="text-lg font-semibold text-emerald-800">Review submitted successfully</p>
          <button onClick={() => navigate('/reviewer')}
            className="mt-4 rounded-lg bg-emerald-700 px-5 py-2.5 font-semibold text-white hover:bg-emerald-800">
            Back to Queue
          </button>
        </div>
      )}

      {/* Audit */}
      {detail.audit.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">Audit Trail</h2>
          <div className="mt-3 space-y-2">
            {detail.audit.map((e) => (
              <div key={e.id} className="border-l-2 border-slate-200 pl-4 py-2">
                <p className="text-sm font-medium text-slate-700">{e.event}</p>
                <p className="text-xs text-slate-400">{new Date(e.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
