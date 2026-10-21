import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  getApplicationDetail, getVerificationResult, getDocuments, getAuditEvents,
  type ApplicationSummary, type VerificationResult, type DocumentInfo,
  type AuditEvent, type ExtractedDocument, type SubjectRow,
} from '../api/client';

// ── helpers ───────────────────────────────────────────────────────────────────

const TERMINAL = ['completed', 'verified', 'needs_review', 'missing', 'suspicious', 'failed'];

const VERDICT = {
  verified:     { bg: 'bg-emerald-50 border-emerald-300', icon: '✓', iconBg: 'bg-emerald-100 text-emerald-700', title: 'Verified',                         titleColor: 'text-emerald-800' },
  needs_review: { bg: 'bg-amber-50 border-amber-300',     icon: '⚠', iconBg: 'bg-amber-100 text-amber-700',    title: 'Needs Manual Review',                titleColor: 'text-amber-800'   },
  suspicious:   { bg: 'bg-red-50 border-red-300',         icon: '⛔', iconBg: 'bg-red-100 text-red-700',        title: 'Suspicious — Requires Close Review',  titleColor: 'text-red-800'     },
};

const VAL_STYLE: Record<string, string> = {
  pass:    'bg-emerald-50 text-emerald-700 border border-emerald-200',
  mismatch:'bg-red-50 text-red-700 border border-red-200',
  missing: 'bg-amber-50 text-amber-700 border border-amber-200',
};
const VAL_ICON: Record<string, string> = { pass: '✓', mismatch: '✗', missing: '—' };

const STATUS_PILL: Record<string, string> = {
  verified:     'bg-emerald-100 text-emerald-800',
  suspicious:   'bg-red-100 text-red-800',
  needs_review: 'bg-amber-100 text-amber-800',
  missing:      'bg-orange-100 text-orange-800',
  failed:       'bg-red-100 text-red-700',
  processing:   'bg-sky-100 text-sky-800',
  queued:       'bg-sky-100 text-sky-800',
  retry:        'bg-sky-100 text-sky-800',
};

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="py-2">
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${value ? 'text-slate-800' : 'text-slate-300 italic'}`}>
        {value ?? 'Not found'}
      </p>
    </div>
  );
}

// ── Extracted Document Card ───────────────────────────────────────────────────

function ExtractedDocumentCard({ doc }: { doc: ExtractedDocument }) {
  const [showSubjects, setShowSubjects] = useState(false);

  const hasMarks = doc.subjects && doc.subjects.length > 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="border-b border-slate-100 bg-slate-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📋</span>
          <div>
            <h2 className="text-base font-bold text-slate-900">Extracted Document Fields</h2>
            <p className="text-xs text-slate-400">
              Extracted by Gemini Vision · method: {doc.extraction_method}
            </p>
          </div>
        </div>
        {/* AI generation score badge */}
        <div className="text-center">
          <p className={`text-lg font-black ${
            doc.ai_generation_score >= 0.5 ? 'text-red-600' :
            doc.ai_generation_score >= 0.3 ? 'text-amber-600' : 'text-emerald-600'
          }`}>
            {Math.round(doc.ai_generation_score * 100)}%
          </p>
          <p className="text-[10px] text-slate-400 leading-tight">AI-gen<br/>likelihood</p>
        </div>
      </div>

      <div className="px-6 py-4">
        {/* Document identity */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3 border-b border-slate-100 pb-4 mb-4">
          <Field label="Document Type" value={doc.document_type} />
          <Field label="Issuing Board" value={doc.issuing_board} />
          <Field label="School / Institution" value={doc.school_name} />
        </div>

        {/* Student info */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3 border-b border-slate-100 pb-4 mb-4">
          <Field label="Student Name" value={doc.student_name} />
          <Field label="Roll / Seat Number" value={doc.roll_number || doc.seat_number} />
          <Field label="Date of Birth" value={doc.date_of_birth} />
          {doc.mother_name && <Field label="Mother's Name" value={doc.mother_name} />}
        </div>

        {/* Exam info */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-4 border-b border-slate-100 pb-4 mb-4">
          <Field label="Exam Year" value={doc.exam_year} />
          <Field label="Month" value={doc.exam_month} />
          <Field label="Result" value={doc.result_status} />
          <Field label="Grade / Division" value={[doc.grade, doc.division].filter(Boolean).join(' — ') || null} />
        </div>

        {/* Marks summary */}
        <div className="grid grid-cols-3 gap-4 border-b border-slate-100 pb-4 mb-4">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-center">
            <p className="text-2xl font-black text-slate-800">{doc.total_marks_obtained ?? '—'}</p>
            <p className="text-xs text-slate-400">Marks Obtained</p>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-center">
            <p className="text-2xl font-black text-slate-800">{doc.total_max_marks ?? '—'}</p>
            <p className="text-xs text-slate-400">Maximum Marks</p>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-center">
            <p className={`text-2xl font-black ${
              (doc.percentage ?? 0) >= 75 ? 'text-emerald-700' :
              (doc.percentage ?? 0) >= 50 ? 'text-amber-700' : 'text-red-700'
            }`}>
              {doc.percentage != null ? `${doc.percentage.toFixed(1)}%` : '—'}
            </p>
            <p className="text-xs text-slate-400">Percentage</p>
          </div>
        </div>

        {/* Subjects table (collapsible) */}
        {hasMarks && (
          <div className="mb-4">
            <button
              onClick={() => setShowSubjects(v => !v)}
              className="flex items-center gap-2 text-sm font-semibold text-sky-700 hover:text-sky-800"
            >
              <span>{showSubjects ? '▾' : '▸'}</span>
              {showSubjects ? 'Hide' : 'Show'} Subject-wise Marks ({doc.subjects.length} subjects)
            </button>
            {showSubjects && (
              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-600">Subject</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600">Obtained</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-slate-600">Max</th>
                      <th className="px-4 py-2 text-center text-xs font-semibold text-slate-600">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {doc.subjects.map((s: SubjectRow, i: number) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-medium text-slate-700">{s.subject}</td>
                        <td className="px-4 py-2 text-right font-mono text-slate-700">{s.marks_obtained ?? '—'}</td>
                        <td className="px-4 py-2 text-right font-mono text-slate-400">{s.max_marks ?? '—'}</td>
                        <td className="px-4 py-2 text-center font-semibold text-slate-600">{s.grade ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Authenticity / Suspicion signals */}
        {(doc.authenticity_signals?.length > 0 || doc.suspicion_signals?.length > 0) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {doc.authenticity_signals?.length > 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-semibold text-emerald-700 mb-1.5">✓ Authenticity Signals</p>
                <ul className="space-y-1">
                  {doc.authenticity_signals.map((s, i) => (
                    <li key={i} className="text-xs text-emerald-700">• {s}</li>
                  ))}
                </ul>
              </div>
            )}
            {doc.suspicion_signals?.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-semibold text-red-700 mb-1.5">⚠ Suspicion Signals</p>
                <ul className="space-y-1">
                  {doc.suspicion_signals.map((s, i) => (
                    <li key={i} className="text-xs text-red-700">• {s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Warnings */}
        {doc.warnings?.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-700 mb-1">⚠ Extraction Warnings</p>
            {doc.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-700">• {w}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pipeline Card ─────────────────────────────────────────────────────────────

const STAGES = [
  { key: 'quality',    label: 'Quality Check',        icon: '🔍', desc: 'Blur, brightness, dimensions' },
  { key: 'ocr',       label: 'Text Extraction',        icon: '📄', desc: 'pdfplumber / selectable text' },
  { key: 'extraction',label: 'Gemini Vision Analysis', icon: '🤖', desc: 'Fields, marks, AI-gen detection' },
  { key: 'validation',label: 'Internal Validation',    icon: '✅', desc: 'Consistency cross-checks' },
  { key: 'reasoning', label: 'Agent Reasoning',        icon: '💡', desc: 'Final verdict + explanation' },
];

function PipelineCard({ result, processing }: { result: VerificationResult | null; processing: boolean }) {
  const timings: Record<string, number> = (result as any)?.timings ?? {};
  const done = !processing && result?.status === 'completed';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex items-center gap-3 mb-5">
        <span className="text-xl">⚙️</span>
        <div>
          <h2 className="text-base font-bold text-slate-900">Agent Processing Pipeline</h2>
          <p className="text-xs text-slate-400">DocFlow AI · Gemini 2.5 Flash Vision</p>
        </div>
        {processing && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
            <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" /> Processing…
          </span>
        )}
        {done && (
          <span className="ml-auto text-xs text-slate-400">
            Total: {timings.total?.toFixed(0) ?? '?'} ms
          </span>
        )}
      </div>
      <div className="space-y-2">
        {STAGES.map((stage) => {
          const ms = timings[stage.key];
          return (
            <div key={stage.key} className={`flex items-center gap-4 rounded-lg border px-4 py-3 ${
              done ? 'border-emerald-200 bg-emerald-50' :
              processing ? 'border-sky-100 bg-sky-50' : 'border-slate-100 bg-slate-50'
            }`}>
              <span className="text-lg w-7">{stage.icon}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${done ? 'text-emerald-800' : 'text-slate-600'}`}>
                  {stage.label}
                </p>
                <p className="text-xs text-slate-400">{stage.desc}</p>
              </div>
              {done ? (
                <div className="text-right">
                  <span className="text-emerald-600 font-bold text-sm">✓</span>
                  {ms !== undefined && (
                    <p className="text-[10px] text-slate-400">{ms.toFixed(0)}ms</p>
                  )}
                </div>
              ) : processing ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
              ) : (
                <span className="text-slate-300">○</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Verdict Card ──────────────────────────────────────────────────────────────

function VerdictCard({ result }: { result: VerificationResult }) {
  const decision = (result.decision ?? 'needs_review') as keyof typeof VERDICT;
  const cfg = VERDICT[decision] ?? VERDICT.needs_review;
  const r = result.reasoning;
  const doc = result.extracted_document;

  return (
    <div className={`rounded-xl border-2 p-6 ${cfg.bg}`}>
      <div className="flex items-start gap-4">
        <div className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full text-2xl font-bold ${cfg.iconBg}`}>
          {cfg.icon}
        </div>
        <div className="flex-1">
          <h2 className={`text-xl font-bold ${cfg.titleColor}`}>Agent Verdict: {cfg.title}</h2>
          {r && <p className="mt-1 text-sm text-slate-600 leading-relaxed">{r.summary}</p>}
        </div>
        {result.match_score !== undefined && (
          <div className="text-center flex-shrink-0">
            <p className={`text-3xl font-black ${cfg.titleColor}`}>{result.match_score}%</p>
            <p className="text-xs text-slate-400">match</p>
          </div>
        )}
      </div>

      {/* Confidence bar */}
      {r?.confidence_score != null && (
        <div className="mt-4">
          <div className="flex justify-between mb-1 text-xs text-slate-500">
            <span>Agent Confidence</span>
            <span className="font-bold">{(r.confidence_score * 100).toFixed(0)}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-white/60">
            <div className={`h-2.5 rounded-full ${
              r.confidence_score >= 0.7 ? 'bg-emerald-500' :
              r.confidence_score >= 0.4 ? 'bg-amber-500' : 'bg-red-500'
            }`} style={{ width: `${r.confidence_score * 100}%` }} />
          </div>
        </div>
      )}

      {/* Gemini explanation */}
      {r?.why_decision && (
        <div className="mt-4 rounded-lg bg-white/60 border border-white/80 p-4">
          <p className="text-xs font-semibold text-slate-500 mb-1">🤖 AGENT EXPLANATION</p>
          <p className="text-sm text-slate-700 leading-relaxed">{r.why_decision}</p>
        </div>
      )}

      {/* Score bars side by side */}
      {doc && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-white/60 p-3">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-500">Internal Consistency</span>
              <span className="font-bold text-slate-700">{(doc.internal_consistency_score * 100).toFixed(0)}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200">
              <div className={`h-2 rounded-full ${doc.internal_consistency_score >= 0.7 ? 'bg-emerald-500' : doc.internal_consistency_score >= 0.4 ? 'bg-amber-500' : 'bg-red-500'}`}
                style={{ width: `${doc.internal_consistency_score * 100}%` }} />
            </div>
          </div>
          <div className="rounded-lg bg-white/60 p-3">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-500">AI-Generation Risk</span>
              <span className="font-bold text-slate-700">{(doc.ai_generation_score * 100).toFixed(0)}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200">
              <div className={`h-2 rounded-full ${doc.ai_generation_score >= 0.5 ? 'bg-red-500' : doc.ai_generation_score >= 0.3 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${doc.ai_generation_score * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Evidence flags */}
      {r?.flags && r.flags.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-slate-500 mb-2">EVIDENCE & FINDINGS</p>
          <ul className="space-y-1.5">
            {r.flags.map((flag, i) => (
              <li key={i} className="text-xs text-slate-700 bg-white/50 rounded px-3 py-2 leading-relaxed">
                {flag}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-[10px] text-slate-400">
        Result produced by DocFlow AI Agent (Gemini Vision + deterministic rules). Not an authenticity certificate.
        A human reviewer makes the final admission decision. Documents are never auto-rejected.
      </p>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ApplicationDetail({ token }: { token: string }) {
  const { id } = useParams<{ id: string }>();
  const [app, setApp]     = useState<ApplicationSummary | null>(null);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [docs, setDocs]   = useState<DocumentInfo[]>([]);
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
    ]).catch(e => setError(e instanceof Error ? e.message : 'Failed to load')).finally(() => setLoading(false));
  }, [id, token]);

  // Poll every 3 s while processing
  useEffect(() => {
    if (!id || !result || TERMINAL.includes(result.status)) return;
    const iv = setInterval(() => getVerificationResult(token, id).then(setResult).catch(() => {}), 3000);
    return () => clearInterval(iv);
  }, [id, token, result?.status]);

  if (loading) return <p className="text-slate-500">Loading…</p>;
  if (error)   return <p className="text-red-600">{error}</p>;
  if (!id || !app) return <p className="text-slate-500">Application not found.</p>;

  const appStatus  = app.status ?? 'queued';
  const isTerminal = result ? TERMINAL.includes(result.status) : false;
  const isProcessing = !isTerminal;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link to="/dashboard" className="text-sm text-sky-700 hover:underline">← Dashboard</Link>

      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Document Verification</h1>
            <p className="mt-0.5 font-mono text-xs text-slate-400">{id}</p>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold flex-shrink-0 ${STATUS_PILL[appStatus] ?? 'bg-slate-100 text-slate-700'}`}>
            {isProcessing && <span className="h-2 w-2 animate-pulse rounded-full bg-current" />}
            {appStatus.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </span>
        </div>
        {docs.length > 0 && (
          <p className="mt-2 text-xs text-slate-400">{docs.length} document{docs.length > 1 ? 's' : ''} submitted</p>
        )}
      </div>

      {/* Pipeline stages */}
      <PipelineCard result={result} processing={isProcessing} />

      {/* Extracted fields — shown as soon as we have extraction data */}
      {isTerminal && result?.extracted_document && (
        <ExtractedDocumentCard doc={result.extracted_document} />
      )}

      {/* Verdict */}
      {isTerminal && result && result.decision && (
        <VerdictCard result={result} />
      )}

      {/* Internal validation table */}
      {isTerminal && result?.validations && result.validations.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-slate-900 mb-4">Internal Consistency Checks</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Check</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Expected</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Found in Doc</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Result</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-slate-600">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.validations.map((v, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-700 capitalize">{v.field.replace('_', ' ')}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs font-mono">{String(v.expected ?? '—')}</td>
                    <td className="px-4 py-2.5 text-slate-700 text-xs font-mono">{String(v.extracted ?? '—')}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${VAL_STYLE[v.result] ?? ''}`}>
                        {VAL_ICON[v.result]} {v.result}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-400 max-w-xs">{v.reason}</td>
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
          <h2 className="text-base font-bold text-slate-900 mb-3">Uploaded Documents</h2>
          {docs.map(d => (
            <div key={d.id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
              <span className="text-xl">{d.content_type === 'application/pdf' ? '📄' : '🖼️'}</span>
              <div>
                <p className="text-sm font-semibold text-slate-700">{d.filename}</p>
                <p className="text-xs text-slate-400">{d.content_type} · {new Date(d.created_at).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Audit trail */}
      {audit.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-slate-900 mb-3">Audit Trail</h2>
          <ol className="relative border-l border-slate-200 space-y-4 ml-3">
            {audit.map(e => (
              <li key={e.id} className="ml-4">
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-slate-400" />
                <p className="text-sm font-semibold text-slate-700">{e.event.replace(/\./g, ' › ')}</p>
                <p className="text-xs text-slate-400">{new Date(e.created_at).toLocaleString()}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
