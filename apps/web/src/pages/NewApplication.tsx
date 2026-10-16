import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createApplication, uploadDocument } from '../api/client';

const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const MAX_SIZE = 2 * 1024 * 1024;

interface NewApplicationProps {
  token: string;
}

export default function NewApplication({ token }: NewApplicationProps) {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    name: '', roll_number: '', dob: '', year: new Date().getFullYear(), board: '', total: 0,
  });
  const [docType, setDocType] = useState('marksheet');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'form' | 'upload' | 'done'>('form');
  const [applicationId, setApplicationId] = useState('');
  const [uploadProgress, setUploadProgress] = useState('');

  function update(field: string, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function validateFile(f: File): string | null {
    if (!ACCEPTED_TYPES.includes(f.type)) return 'Only PDF, PNG, and JPEG files are supported.';
    if (f.size > MAX_SIZE) return 'File must be smaller than 2 MB.';
    if (f.size === 0) return 'File is empty.';
    return null;
  }

  function handleFile(f: File) {
    const err = validateFile(f);
    if (err) { setError(err); return; }
    setFile(f);
    setError('');
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  async function handleSubmit() {
    setBusy(true);
    setError('');
    try {
      setUploadProgress('Creating application…');
      const app = await createApplication(token, {
        name: form.name,
        roll_number: form.roll_number,
        dob: form.dob,
        year: form.year,
        board: form.board || undefined,
        total: form.total || undefined,
      });
      setApplicationId(app.id);

      if (file) {
        setUploadProgress('Uploading document…');
        await uploadDocument(token, app.id, file);
      }

      setStep('done');
      setUploadProgress('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Submission failed.');
      setUploadProgress('');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'done') {
    return (
      <div className="mx-auto max-w-lg text-center">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <svg className="h-8 w-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-emerald-900">Application Submitted</h2>
          <p className="mt-2 text-sm text-emerald-700">
            Your document is being processed. You'll see results shortly.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={() => navigate(`/applications/${applicationId}`)}
              className="rounded-lg bg-emerald-700 px-5 py-2.5 font-semibold text-white hover:bg-emerald-800"
            >
              View Status
            </button>
            <button
              onClick={() => navigate('/dashboard')}
              className="rounded-lg border border-slate-300 px-5 py-2.5 font-semibold text-slate-700 hover:bg-slate-50"
            >
              Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">New Application</h1>
      <p className="mt-2 text-sm text-slate-600">
        Fill in the applicant details and upload the document for verification.
      </p>

      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Use synthetic data only. Do not enter real student information.
      </div>

      <form
        className="mt-6 space-y-6"
        onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
      >
        {/* Document Type */}
        <fieldset>
          <legend className="text-sm font-semibold text-slate-700">Document Type</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {['marksheet', 'academic_certificate', 'income_certificate'].map((t) => (
              <label
                key={t}
                className={`cursor-pointer rounded-lg border px-4 py-2 text-sm font-medium transition ${
                  docType === t
                    ? 'border-sky-600 bg-sky-50 text-sky-800'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                } ${t !== 'marksheet' ? 'opacity-50' : ''}`}
              >
                <input
                  type="radio" name="docType" value={t} checked={docType === t}
                  onChange={() => setDocType(t)} className="sr-only"
                  disabled={t !== 'marksheet'}
                />
                {t === 'marksheet' ? 'Marksheet' : t === 'academic_certificate' ? 'Academic Certificate' : 'Income Certificate'}
                {t !== 'marksheet' && <span className="ml-1 text-xs">(Coming soon)</span>}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Form fields */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            Student Name *
            <input required value={form.name} onChange={(e) => update('name', e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-sky-600 focus:ring-2 focus:ring-sky-100 outline-none" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Roll Number *
            <input required value={form.roll_number} onChange={(e) => update('roll_number', e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-sky-600 focus:ring-2 focus:ring-sky-100 outline-none" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Date of Birth *
            <input required type="date" value={form.dob} onChange={(e) => update('dob', e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-sky-600 focus:ring-2 focus:ring-sky-100 outline-none" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Exam Year *
            <input required type="number" min={1900} max={2100} value={form.year}
              onChange={(e) => update('year', Number(e.target.value))}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-sky-600 focus:ring-2 focus:ring-sky-100 outline-none" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Board / Institution
            <input value={form.board} onChange={(e) => update('board', e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-sky-600 focus:ring-2 focus:ring-sky-100 outline-none" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Total Marks
            <input type="number" min={0} max={500} value={form.total}
              onChange={(e) => update('total', Number(e.target.value))}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-sky-600 focus:ring-2 focus:ring-sky-100 outline-none" />
          </label>
        </div>

        {/* Upload area */}
        <div>
          <p className="text-sm font-semibold text-slate-700">Upload Document *</p>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            className={`mt-2 flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed p-8 transition ${
              dragOver ? 'border-sky-500 bg-sky-50' : 'border-slate-300 bg-white hover:border-sky-400'
            }`}
          >
            <svg className="mb-3 h-10 w-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            {file ? (
              <p className="text-sm font-medium text-slate-700">{file.name} ({(file.size / 1024).toFixed(0)} KB)</p>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-600">Drag & drop or click to browse</p>
                <p className="mt-1 text-xs text-slate-400">PDF, PNG, or JPEG — Max 2 MB</p>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {uploadProgress && <p className="text-sm text-sky-700">{uploadProgress}</p>}

        <div className="flex gap-3 pt-2">
          <button
            type="submit" disabled={busy || !file}
            className="rounded-lg bg-sky-700 px-6 py-2.5 font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Submitting…' : 'Submit Application'}
          </button>
          <button
            type="button" onClick={() => navigate('/dashboard')}
            className="rounded-lg border border-slate-300 px-6 py-2.5 font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
