export type Decision = 'verified' | 'needs_review' | 'missing';
export type JobStatus = 'queued' | 'processing' | 'retry' | 'completed' | 'failed';
export interface UserRow { id: string; email: string; password_hash: string; created_at: Date }
export interface ApplicationRow { id: string; user_id: string; form_json: Record<string, unknown>; status: string; created_at: Date }
export interface DocumentRow { id: string; application_id: string; filename: string; content_type: 'application/pdf' | 'image/png'; sha256: string; storage_path: string; created_at: Date }
export interface JobRow { id: string; document_id: string; status: JobStatus; attempts: number; available_at: Date; locked_at: Date | null; error: string | null; result_json: Record<string, unknown> | null; created_at: Date; updated_at: Date }
export interface ValidationRow { id: string; job_id: string; field: string; expected: string | number | null; extracted: string | number | null; result: 'pass' | 'mismatch' | 'missing'; reason: string; created_at: Date }
export interface ReviewRow { id: string; application_id: string; reviewer_id: string; decision: Decision; note: string; created_at: Date }
export interface AuditEventRow { id: string; actor_id: string | null; application_id: string; document_id: string | null; job_id: string | null; event: string; details_json: Record<string, unknown>; created_at: Date }
