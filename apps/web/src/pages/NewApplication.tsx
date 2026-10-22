import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createApplication, uploadDocument } from '../api/client';

const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const MAX_SIZE = 2 * 1024 * 1024;

const DOC_TYPES = [
  { value: 'marksheet', label: 'Marksheet', supported: true },
  { value: 'birth_certificate', label: 'Birth Certificate', supported: false },
  { value: 'identity_card', label: 'Identity Card', supported: false },
  { value: 'caste_certificate', label: 'Caste / Category Certificate', supported: false },
  { value: 'ews_certificate', label: 'EWS Certificate', supported: false },
  { value: 'fee_receipt', label: 'Fee Receipt', supported: false },
  { value: 'nationality_certificate', label: 'Nationality Certificate', supported: false },
  { value: 'domicile_certificate', label: 'Domicile Certificate', supported: false },
  { value: 'income_certificate', label: 'Income Certificate', supported: false },
  { value: 'unknown', label: 'Unknown / Needs classification', supported: false },
];

interface SelectedFile {
  file: File;
  docType: string;
  id: number;
}

interface NewApplicationProps {
  token: string;
}

let nextFileId = 1;

export default function NewApplication({ token }: NewApplicationProps) {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [currentDocType, setCurrentDocType] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState('');
  const [step, setStep] = useState<'upload' | 'done'>('upload');
  const [applicationId, setApplicationId] = useState('');

  function validateFile(f: File): string | null {
    if (!ACCEPTED_TYPES.includes(f.type)) return `"${f.name}" — Only PDF, PNG, and JPEG files are supported.`;
    if (f.size > MAX_SIZE) return `"${f.name}" — File must be smaller than 2 MB.`;
    if (f.size === 0) return `"${f.name}" — File is empty.`;
    return null;
  }

  function addFiles(newFiles: FileList | File[]) {
    const errs: string[] = [];
    const valid: SelectedFile[] = [];
    for (const f of Array.from(newFiles)) {
      const err = validateFile(f);
      if (err) {
        errs.push(err);
      } else {
        valid.push({ file: f, docType: currentDocType, id: nextFileId++ });
      }
    }
    if (valid.length) {
      setFiles((prev) => [...prev, ...valid]);
    }
    setError(errs.length ? errs.join('\n') : '');
  }

  function removeFile(id: number) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function updateDocType(id: number, newType: string) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, docType: newType } : f)));
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }, [currentDocType]);

  async function handleSubmit() {
    if (!files.length) {
      setError('Please add at least one document.');
      return;
    }
    if (files.some((selected) => !selected.docType)) {
      setError('Choose a document type for every file. Use Unknown / Needs classification if you are unsure.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Auto-create a minimal application record
      setUploadProgress('Creating submission…');
      const app = await createApplication(token, {
        name: 'Document Upload',
        roll_number: 'N/A',
        dob: '2000-01-01',
        year: new Date().getFullYear(),
      });
      setApplicationId(app.id);

      // Upload each file
      for (let i = 0; i < files.length; i++) {
        setUploadProgress(`Uploading document ${i + 1} of ${files.length}…`);
        await uploadDocument(token, app.id, files[i].file, files[i].docType);
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

  // ---------- Success view ----------
  if (step === 'done') {
    return (
      <div className="mx-auto max-w-lg text-center">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <svg className="h-8 w-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-emerald-900">Documents Submitted</h2>
          <p className="mt-2 text-sm text-emerald-700">
            {files.length} document{files.length > 1 ? 's' : ''} uploaded successfully. Processing will begin shortly.
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

  // ---------- Upload view ----------
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Upload Documents</h1>
      <p className="mt-2 text-sm text-slate-600">
        Select the document type, add your files, and submit.
      </p>

      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Use synthetic data only. Do not upload real student documents.
      </div>

      <div className="mt-6 space-y-6">
        {/* Document Type selector */}
        <div>
          <label className="block text-sm font-semibold text-slate-700">
            Document Type
            <select
              value={currentDocType}
              onChange={(e) => setCurrentDocType(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
            >
              <option value="">Select a type…</option>
              {DOC_TYPES.map((dt) => <option key={dt.value} value={dt.value}>{dt.label}{dt.supported ? ' · supported' : ' · review only'}</option>)}
            </select>
          </label>
          <p className="mt-1 text-xs text-slate-500">
            Choose the type before adding files. You can change it per file below.
          </p>
        </div>

        {/* Drop zone */}
        <div>
          <p className="text-sm font-semibold text-slate-700">Add Files</p>
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
            <p className="text-sm font-medium text-slate-600">Drag & drop or click to browse</p>
            <p className="mt-1 text-xs text-slate-400">PDF, PNG, or JPEG — Max 2 MB per file — Multiple files allowed</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg"
            multiple
            onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-2">
              Selected Files ({files.length})
            </p>
            <div className="space-y-2">
              {files.map((sf) => (
                <div
                  key={sf.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3"
                >
                  {/* File icon */}
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-sky-50">
                    {sf.file.type === 'application/pdf' ? (
                      <svg className="h-5 w-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg className="h-5 w-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>

                  {/* File info */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700">{sf.file.name}</p>
                    <p className="text-xs text-slate-400">{(sf.file.size / 1024).toFixed(0)} KB</p>
                  </div>

                  {/* Doc type per file */}
                  <select
                    value={sf.docType}
                    onChange={(e) => updateDocType(sf.id, e.target.value)}
                    className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 outline-none focus:border-sky-500"
                  >
                    <option value="">Select a type…</option>
                    {DOC_TYPES.map((dt) => <option key={dt.value} value={dt.value}>{dt.label}{dt.supported ? ' · supported' : ' · review only'}</option>)}
                  </select>

                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={() => removeFile(sf.id)}
                    className="flex-shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                    title="Remove file"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p role="alert" className="whitespace-pre-line text-sm text-red-600">{error}</p>}
        {uploadProgress && <p className="text-sm text-sky-700">{uploadProgress}</p>}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={busy || !files.length}
            className="rounded-lg bg-sky-700 px-6 py-2.5 font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Submitting…' : `Submit ${files.length ? `(${files.length} file${files.length > 1 ? 's' : ''})` : ''}`}
          </button>
          <button
            type="button" onClick={() => navigate('/dashboard')}
            className="rounded-lg border border-slate-300 px-6 py-2.5 font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
