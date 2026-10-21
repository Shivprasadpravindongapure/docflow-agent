export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:4000'
).replace(/\/$/, '');

export interface ApplicationSummary {
  id: string;
  status: string;
  created_at?: string;
  form_json?: Record<string, unknown>;
}

export interface ValidationFlag {
  field: string;
  expected: string | number | null;
  extracted: string | number | null;
  result: 'pass' | 'mismatch' | 'missing';
  reason: string;
}

export interface SubjectRow {
  subject: string;
  marks_obtained: number | null;
  max_marks: number | null;
  grade: string | null;
}

export interface ExtractedDocument {
  document_type: string | null;
  issuing_board: string | null;
  school_name: string | null;
  student_name: string | null;
  roll_number: string | null;
  seat_number: string | null;
  date_of_birth: string | null;
  mother_name: string | null;
  exam_year: string | null;
  exam_month: string | null;
  subjects: SubjectRow[];
  total_marks_obtained: number | null;
  total_max_marks: number | null;
  percentage: number | null;
  result_status: string | null;
  grade: string | null;
  division: string | null;
  internal_consistency_score: number;
  consistency_issues: string[];
  ai_generation_score: number;
  suspicion_signals: string[];
  authenticity_signals: string[];
  gemini_verdict: string;
  gemini_reasoning: string;
  extraction_method: string;
  warnings: string[];
}

export interface AgentReasoning {
  summary: string;
  why_decision: string;
  flags: string[];
  confidence_score: number;
}

export interface QualityFlags {
  is_blurry: boolean;
  is_too_dark: boolean;
  is_too_small: boolean;
  blur_score: number | null;
  mean_brightness: number | null;
}

export interface VerificationResult {
  status: string;
  decision?: string;
  match_score?: number;
  validations?: ValidationFlag[];
  reasoning?: AgentReasoning;
  quality?: QualityFlags;
  ocr_text?: string;
  extracted_document?: ExtractedDocument;
  created_at?: string;
  updated_at?: string;
}

export interface DocumentInfo {
  id: string;
  filename: string;
  content_type: string;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  event: string;
  details_json: Record<string, unknown>;
  created_at: string;
  actor_id: string | null;
}

export interface ReviewQueueItem {
  id: string;
  status: string;
  form_json: Record<string, unknown>;
  created_at: string;
  user_id: string;
}

export interface ReviewerAppDetail {
  id: string;
  status: string;
  form_json: Record<string, unknown>;
  created_at: string;
  documents: DocumentInfo[];
  result: VerificationResult | null;
  validations: ValidationFlag[];
  audit: AuditEvent[];
  reviews: Array<{ id: string; decision: string; note: string; created_at: string; reviewer_id: string }>;
}

interface ApiError {
  error?: string;
}

function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof value.error === 'string'
  );
}

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isApiError(body) && body.error) return body.error;
  } catch {}
  return `Request failed with status ${response.status}.`;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function register(name: string, email: string, password: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  if (!response.ok) throw new Error(await readError(response));
}

export async function login(email: string, password: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('token' in body) || typeof body.token !== 'string') {
    throw new Error('The API returned an invalid sign-in response.');
  }
  return body.token;
}

export async function listApplications(token: string): Promise<ApplicationSummary[]> {
  const response = await fetch(`${API_BASE_URL}/applications`, {
    headers: authHeaders(token),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function createApplication(
  token: string,
  form: { name: string; roll_number: string; dob: string; year: number; board?: string; total?: number }
): Promise<{ id: string; status: string }> {
  const response = await fetch(`${API_BASE_URL}/applications`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function uploadDocument(
  token: string,
  applicationId: string,
  file: File
): Promise<{ document_id: string; job_id: string; status: string }> {
  const response = await fetch(
    `${API_BASE_URL}/applications/${encodeURIComponent(applicationId)}/documents`,
    {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': file.type },
      body: file,
    }
  );
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function getApplicationDetail(token: string, id: string): Promise<ApplicationSummary> {
  const response = await fetch(`${API_BASE_URL}/applications/${encodeURIComponent(id)}`, {
    headers: authHeaders(token),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function getVerificationResult(token: string, applicationId: string): Promise<VerificationResult> {
  const response = await fetch(
    `${API_BASE_URL}/applications/${encodeURIComponent(applicationId)}/result`,
    { headers: authHeaders(token) }
  );
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function getDocuments(token: string, applicationId: string): Promise<DocumentInfo[]> {
  const response = await fetch(
    `${API_BASE_URL}/applications/${encodeURIComponent(applicationId)}/documents`,
    { headers: authHeaders(token) }
  );
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function getAuditEvents(token: string, applicationId: string): Promise<AuditEvent[]> {
  const response = await fetch(
    `${API_BASE_URL}/applications/${encodeURIComponent(applicationId)}/audit`,
    { headers: authHeaders(token) }
  );
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function getReviewQueue(token: string): Promise<ReviewQueueItem[]> {
  const response = await fetch(`${API_BASE_URL}/reviewer/queue`, {
    headers: authHeaders(token),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function getReviewerAppDetail(token: string, applicationId: string): Promise<ReviewerAppDetail> {
  const response = await fetch(
    `${API_BASE_URL}/reviewer/applications/${encodeURIComponent(applicationId)}`,
    { headers: authHeaders(token) }
  );
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function submitReview(
  token: string,
  applicationId: string,
  decision: 'verified' | 'needs_review' | 'missing',
  note: string
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/reviewer/applications/${encodeURIComponent(applicationId)}/review`,
    {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, note }),
    }
  );
  if (!response.ok) throw new Error(await readError(response));
}
