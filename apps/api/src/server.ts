import express, { type NextFunction, type Request, type Response } from 'express';
import { Pool, type PoolClient } from 'pg';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { config } from 'dotenv';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
config({ path: resolve(projectRoot, '.env'), quiet: true });
const migrationDirectory = resolve(projectRoot,'apps/api/src/migrations');
const migration = readdirSync(migrationDirectory).filter((name)=>name.endsWith('.sql')).sort().map((name)=>readFileSync(resolve(migrationDirectory,name),'utf8')).join('\n');
const MAX_UPLOAD = 2 * 1024 * 1024;
const STATUS_POLL_INTERVAL_MS = 1000;
const STATUS_HEARTBEAT_INTERVAL_MS = 15000;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl && process.env.NODE_ENV !== 'test') throw new Error('DATABASE_URL must be configured in the environment.');

export function createPool(connectionString = databaseUrl) {
  if (!connectionString) throw new Error('DATABASE_URL must be configured in the environment.');
  const pool=new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  pool.on('connect',(client)=>{client.query('SET search_path TO public').catch((error)=>console.error('PostgreSQL session setup failed:',error instanceof Error ? error.name : 'UnknownError'));});
  return pool;
}
export async function migrate(pool: Pool,schema='public') { if(schema!=='public'&&!/^docflow_test_[0-9a-f]+$/.test(schema))throw new Error('Invalid migration schema.'); const client=await pool.connect(); try { await client.query(`SET search_path TO "${schema}"`); await client.query(migration); } finally { client.release(); } }
function now() { return new Date(); }
function id() { return randomBytes(16).toString('hex'); }
function passwordHash(password: string, salt = randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
function passwordMatches(password: string, encoded: string) { const [salt, hash] = encoded.split(':'); if (!salt || !hash) return false; const expected = Buffer.from(hash, 'hex'); const actual = scryptSync(password, salt, 64); return actual.length === expected.length && timingSafeEqual(actual, expected); }
function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
type AuthRequest = Request & { userId?: string; role?: 'applicant' | 'reviewer' };
type AsyncHandler = (req: AuthRequest, res: Response, next: NextFunction) => Promise<unknown>;
function route(handler: AsyncHandler) { return (req: Request, res: Response, next: NextFunction) => handler(req as AuthRequest, res, next).catch(next); }
function authenticate(pool: Pool) { return route(async (req, res, next) => {
  const token = req.header('authorization')?.match(/^Bearer ([\w-]+)$/)?.[1];
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  const result = await pool.query<{user_id:string;role:'applicant'|'reviewer'}>('SELECT s.user_id,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [hashToken(token)]);
  if (!result.rowCount) return res.status(401).json({ error: 'Invalid or expired session.' });
  req.userId = result.rows[0].user_id; req.role = result.rows[0].role; return next();
}); }
function requireReviewer(req: Request, res: Response, next: NextFunction) {
  if ((req as AuthRequest).role !== 'reviewer') return res.status(403).json({ error: 'Reviewer access required.' });
  return next();
}
async function audit(client: PoolClient, actor: string | null, application: string, event: string, details: object, document?: string, job?: string) {
  await client.query('INSERT INTO audit_events(id,actor_id,application_id,document_id,job_id,event,details_json) VALUES($1,$2,$3,$4,$5,$6,$7)', [id(),actor,application,document ?? null,job ?? null,event,JSON.stringify(details)]);
}

export function createApp(pool = createPool()) {
  const app = express();
  const allowedOrigins=new Set((process.env.WEB_ORIGINS||'http://localhost:5173,http://127.0.0.1:5173').split(',').map((origin)=>origin.trim()).filter(Boolean));
  app.use((req,res,next)=>{
    const origin=req.header('origin');
    if(origin&&allowedOrigins.has(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.vary('Origin');}
    if(req.method==='OPTIONS'){
      if(!origin||!allowedOrigins.has(origin))return res.status(403).end();
      res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type');
      return res.status(204).end();
    }
    return next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'api' }));
  app.post('/auth/register', route(async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const password = req.body?.password;
    if (!name || name.length > 200) return res.status(400).json({ error: 'Provide a name (1–200 characters).' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 12 || password.length > 200) return res.status(400).json({ error: 'Provide a valid email and a password of 12–200 characters.' });
    try { const created = await pool.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4) RETURNING id,email,name', [id(),email,name,passwordHash(password)]); return res.status(201).json(created.rows[0]); }
    catch (error) { if ((error as {code?:string}).code === '23505') return res.status(409).json({ error: 'Account already exists.' }); throw error; }
  }));
  app.post('/auth/login', route(async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const found = await pool.query<{id:string;email:string;password_hash:string}>('SELECT id,email,password_hash FROM users WHERE email=$1', [email]);
    if (!found.rowCount || typeof req.body?.password !== 'string' || !passwordMatches(req.body.password,found.rows[0].password_hash)) return res.status(401).json({ error: 'Invalid email or password.' });
    const token = randomBytes(32).toString('base64url'); await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'24 hours\')', [hashToken(token),found.rows[0].id]); return res.json({ token, expires_in: 86400 });
  }));
  const auth = authenticate(pool);
  app.post('/applications', auth, route(async (req, res) => {
    const f=req.body; if (!f || typeof f!=='object' || typeof f.name!=='string' || typeof f.roll_number!=='string' || typeof f.dob!=='string' || !Number.isInteger(f.year) || f.name.length>200 || f.roll_number.length>100) return res.status(400).json({error:'Invalid application form.'});
    const applicationId=id(), client=await pool.connect(); try { await client.query('BEGIN'); await client.query('INSERT INTO applications(id,user_id,form_json) VALUES($1,$2,$3)',[applicationId,req.userId,JSON.stringify(f)]); await audit(client,req.userId!,applicationId,'application.created',{status:'draft'}); await client.query('COMMIT'); return res.status(201).json({id:applicationId,status:'draft'}); } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }));
  app.get('/applications', auth, route(async (req,res) => { const rows=await pool.query('SELECT id,status,created_at FROM applications WHERE user_id=$1 ORDER BY created_at DESC',[req.userId]); return res.json(rows.rows); }));
  app.get('/applications/:applicationId/status/events', auth, route(async (req,res) => {
    const applicationId=String(req.params.applicationId);
    const owner=await pool.query<{created_at:Date}>('SELECT created_at FROM applications WHERE id=$1 AND user_id=$2',[applicationId,req.userId]);
    if(!owner.rowCount)return res.status(404).json({error:'Application not found.'});

    res.status(200).set({
      'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-cache, no-transform',
      Connection:'keep-alive',
      'X-Accel-Buffering':'no',
    });
    res.flushHeaders();

    type StatusJob = {status:string;updated_at:Date|null};
    let closed=false;
    let lastEvent='';
    let lastHeartbeat=Date.now();
    let timer:ReturnType<typeof setTimeout>|undefined;
    res.on('close',()=>{closed=true;if(timer)clearTimeout(timer);});

    const poll=async ():Promise<void> => {
      if(closed)return;
      try {
        const result=await pool.query<StatusJob>(
          "SELECT a.status,MAX(j.updated_at) AS updated_at FROM applications a LEFT JOIN documents d ON d.application_id=a.id LEFT JOIN jobs j ON j.document_id=d.id WHERE a.id=$1 GROUP BY a.status",
          [applicationId],
        );
        if(closed)return;
        const job=result.rows[0];
        let status=job?.status ?? 'draft';
        if(!['draft','queued','processing','verified','needs_review','missing'].includes(status)) status='needs_review';
        let updatedAt=owner.rows[0].created_at;
        if(job) {
          updatedAt=job.updated_at ?? updatedAt;
        }
        const data=JSON.stringify({
          application_id:applicationId,
          status,
          updated_at:updatedAt.toISOString(),
        });
        if(data!==lastEvent) {
          res.write(`event: status\ndata: ${data}\n\n`);
          lastEvent=data;
          lastHeartbeat=Date.now();
        } else if(Date.now()-lastHeartbeat>=STATUS_HEARTBEAT_INTERVAL_MS) {
          res.write(': keep-alive\n\n');
          lastHeartbeat=Date.now();
        }
      } catch(error) {
          console.error('Status event stream failed:', error instanceof Error ? error.name : 'UnknownError');
        if(!res.destroyed)res.destroy();
        return;
      }
      if(!closed)timer=setTimeout(()=>{void poll();},STATUS_POLL_INTERVAL_MS);
    };
    await poll();
    return undefined;
  }));
  app.use('/applications/:applicationId/documents', express.raw({ type: ['application/pdf','image/png','image/jpeg'], limit: MAX_UPLOAD }));
  app.post('/applications/:applicationId/documents', auth, route(async (req,res) => {
    const applicationId=String(req.params.applicationId), owner=await pool.query('SELECT id FROM applications WHERE id=$1 AND user_id=$2',[applicationId,req.userId]); if (!owner.rowCount) return res.status(404).json({error:'Application not found.'});
    const contentType=req.header('content-type')?.toLowerCase().split(';')[0]; if (!['application/pdf','image/png','image/jpeg'].includes(contentType??'')) return res.status(415).json({error:'Only PDF, PNG, and JPEG uploads are supported.'});
    const documentType=req.header('x-document-type')?.trim().toLowerCase(); if (!documentType) return res.status(400).json({error:'Select an explicit document type before uploading.'}); if (!/^[a-z][a-z0-9_]{0,79}$/.test(documentType)) return res.status(400).json({error:'Document type must be a valid category identifier.'});
    const bytes=Buffer.isBuffer(req.body)?req.body:Buffer.alloc(0); if(!bytes.length)return res.status(400).json({error:'Empty upload.'}); if(contentType==='application/pdf'&&!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))return res.status(422).json({error:'Invalid PDF signature.'}); if(contentType==='image/png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return res.status(422).json({error:'Invalid PNG signature.'}); if(contentType==='image/jpeg'&&!bytes.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])))return res.status(422).json({error:'Invalid JPEG signature.'});
    const ext=contentType==='application/pdf'?'pdf':contentType==='image/jpeg'?'jpg':'png';
    const documentId=id(),jobId=id(),sha=createHash('sha256').update(bytes).digest('hex'),base=resolve(projectRoot,process.env.UPLOAD_DIR||'uploads'),file=resolve(base,`${documentId}.${ext}`); mkdirSync(base,{recursive:true}); writeFileSync(file,bytes,{flag:'wx'});
    const client=await pool.connect(); try { await client.query('BEGIN'); await client.query('INSERT INTO documents(id,application_id,filename,content_type,sha256,storage_path,document_type) VALUES($1,$2,$3,$4,$5,$6,$7)',[documentId,applicationId,`upload.${ext}`,contentType,sha,file,documentType]); await client.query("INSERT INTO jobs(id,document_id,status,available_at) VALUES($1,$2,'queued',now())",[jobId,documentId]); await client.query("UPDATE applications SET status='queued' WHERE id=$1",[applicationId]); await audit(client,req.userId!,applicationId,'document.uploaded',{content_type:contentType,document_type:documentType,sha256:sha},documentId,jobId); await audit(client,req.userId!,applicationId,'job.queued',{status:'queued'},documentId,jobId); await client.query('COMMIT'); return res.status(202).json({document_id:documentId,job_id:jobId,document_type:documentType,status:'queued'}); } catch(error) { await client.query('ROLLBACK'); unlinkSync(file); throw error; } finally { client.release(); }
  }));
  app.get('/applications/:applicationId', auth, route(async (req,res) => { const result=await pool.query('SELECT id,status,form_json,created_at FROM applications WHERE id=$1 AND user_id=$2',[req.params.applicationId,req.userId]); if(!result.rowCount)return res.status(404).json({error:'Application not found.'}); return res.json(result.rows[0]); }));
  app.get('/applications/:applicationId/result', auth, route(async (req, res) => {
    const applicationId = String(req.params.applicationId);
    const owner = await pool.query('SELECT id FROM applications WHERE id=$1 AND user_id=$2', [applicationId, req.userId]);
    if (!owner.rowCount) return res.status(404).json({ error: 'Application not found.' });

    const jobResult = await pool.query<{
      id: string;
      document_id: string;
      application_id: string;
      document_type: string;
      content_type: string;
      status: string;
      result_json: Record<string, unknown> | null;
      created_at: Date;
      updated_at: Date;
    }>(
      'SELECT j.id,d.id AS document_id,d.application_id,d.document_type,d.content_type,j.status,j.result_json,j.created_at,j.updated_at FROM jobs j JOIN documents d ON d.id=j.document_id WHERE d.application_id=$1 ORDER BY j.created_at DESC LIMIT 1',
      [applicationId]
    );

    if (!jobResult.rowCount) {
      return res.json({ status: 'draft' });
    }

    const job = jobResult.rows[0];
    if (job.status !== 'completed') {
      return res.json({
        application_id: job.application_id,
        document_id: job.document_id,
        document_type: job.document_type,
        metadata: { document_type: job.document_type, content_type: job.content_type, processing_state: job.status },
        status: job.status === 'failed' ? 'failed' : 'processing',
      });
    }

    const valRows = await pool.query<{
      field: string;
      expected: unknown;
      extracted: unknown;
      result: string;
      reason: string;
    }>(
      'SELECT field, expected, extracted, result, reason FROM validations WHERE job_id=$1 ORDER BY created_at ASC',
      [job.id]
    );

    let validations = valRows.rows;
    if (!validations.length && Array.isArray(job.result_json?.validations)) {
      validations = (job.result_json.validations as any[]).map((v) => ({
        field: v.field,
        expected: v.expected,
        extracted: v.extracted,
        result: v.result,
        reason: v.reason,
      }));
    }

    const passCount = validations.filter((v) => v.result === 'pass').length;
    const match_score = validations.length > 0 ? Math.round((passCount / validations.length) * 1000) / 10 : 0;
    const decision = (job.result_json?.decision as string) || 'needs_review';
    const timings = job.result_json?.timings ?? job.result_json?.timings_ms ?? null;

    const reasoning = job.result_json?.reasoning ?? null;
    const quality = job.result_json?.quality ?? null;
    const ocr_text = job.result_json?.ocr_text ?? null;
    const extracted_document = job.result_json?.extracted_document ?? null;

    return res.json({
      application_id: job.application_id,
      document_id: job.document_id,
      document_type: job.document_type,
      document_type_status: job.result_json?.document_type_status ?? (job.result_json?.typed_payload ? 'supported' : 'uncertain'),
      page_count: job.result_json?.page_count ?? null,
      evidence_refs: job.result_json?.evidence_refs ?? [],
      field_provenance: job.result_json?.field_provenance ?? {},
      typed_payload: job.result_json?.typed_payload ?? null,
      metadata: {
        document_type: job.document_type,
        content_type: job.content_type,
        processing_state: job.status,
        timestamps: { processed_at: job.updated_at },
      },
      status: 'completed',
      decision,
      match_score,
      validations,
      timings,
      reasoning,
      quality,
      ocr_text,
      extracted_document,
      created_at: job.created_at,
      updated_at: job.updated_at,
    });
  }));
  app.get('/applications/:applicationId/documents', auth, route(async (req, res) => {
    const applicationId = String(req.params.applicationId);
    const owner = await pool.query('SELECT id FROM applications WHERE id=$1 AND user_id=$2', [applicationId, req.userId]);
    if (!owner.rowCount) return res.status(404).json({ error: 'Application not found.' });

    const docs = await pool.query<{
      id: string; application_id: string; document_type: string; filename: string; content_type: string; created_at: Date;
      job_status: string | null; job_created_at: Date | null; job_updated_at: Date | null; result_json: Record<string, unknown> | null;
    }>(
      `SELECT d.id,d.application_id,d.document_type,d.filename,d.content_type,d.created_at,
              j.status AS job_status,j.created_at AS job_created_at,j.updated_at AS job_updated_at,j.result_json
       FROM documents d
       LEFT JOIN LATERAL (SELECT status,created_at,updated_at,result_json FROM jobs WHERE document_id=d.id ORDER BY created_at DESC LIMIT 1) j ON TRUE
       WHERE d.application_id=$1 ORDER BY d.created_at ASC`,
      [applicationId]
    );
    return res.json(docs.rows.map((document) => {
      const processingState = document.job_status ?? 'uploaded';
      const raw = document.result_json;
      const result = document.job_status === 'completed' && raw ? {
        processing_state: processingState,
        document_type_status: raw.document_type_status ?? (raw.typed_payload ? 'supported' : 'uncertain'),
        decision: raw.decision ?? 'needs_review',
        typed_payload: raw.typed_payload ?? null,
        validations: raw.validations ?? [],
        field_provenance: raw.field_provenance ?? {},
        extracted_document: raw.extracted_document ?? null,
        reasoning: raw.reasoning ?? null,
        ocr_text: raw.ocr_text ?? '',
        timings_ms: raw.timings_ms ?? {},
      } : null;
      return {
        application_id: document.application_id,
        document_id: document.id,
        metadata: {
          document_type: document.document_type,
          filename: document.filename,
          content_type: document.content_type,
          page_count: raw?.page_count ?? null,
          processing_state: processingState,
          timestamps: { uploaded_at: document.created_at, processed_at: document.job_updated_at },
        },
        evidence_refs: raw?.evidence_refs ?? [],
        result,
      };
    }));
  }));
  app.get('/applications/:applicationId/documents/:documentId/file', auth, route(async (req, res) => {
    const applicationId = String(req.params.applicationId);
    const documentId = String(req.params.documentId);

    const owner = await pool.query('SELECT id FROM applications WHERE id=$1 AND user_id=$2', [applicationId, req.userId]);
    if (!owner.rowCount) return res.status(404).json({ error: 'Application not found.' });

    const docRes = await pool.query<{ content_type: string; storage_path: string }>(
      'SELECT content_type, storage_path FROM documents WHERE id=$1 AND application_id=$2',
      [documentId, applicationId]
    );
    if (!docRes.rowCount) return res.status(404).json({ error: 'Document not found.' });

    const { content_type, storage_path } = docRes.rows[0];
    try {
      const fileBytes = readFileSync(storage_path);
      res.setHeader('Content-Type', content_type);
      return res.send(fileBytes);
    } catch {
      return res.status(404).json({ error: 'Document file not found.' });
    }
  }));
  app.get('/applications/:applicationId/audit', auth, route(async (req, res) => {
    const applicationId = String(req.params.applicationId);
    const owner = await pool.query('SELECT id FROM applications WHERE id=$1 AND user_id=$2', [applicationId, req.userId]);
    if (!owner.rowCount) return res.status(404).json({ error: 'Application not found.' });

    const events = await pool.query<{ id: string; event: string; details_json: unknown; created_at: Date; actor_id: string | null }>(
      'SELECT id, event, details_json, created_at, actor_id FROM audit_events WHERE application_id=$1 ORDER BY created_at ASC',
      [applicationId]
    );
    return res.json(events.rows);
  }));
  app.post('/applications/:applicationId/agent-runs', auth, route(async (req, res) => {
    const applicationId = String(req.params.applicationId);
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!question || question.length > 1000) return res.status(400).json({ error: 'Provide a question of 1-1000 characters.' });
    const owner = await pool.query('SELECT id FROM applications WHERE id=$1 AND user_id=$2', [applicationId, req.userId]);
    if (!owner.rowCount) return res.status(404).json({ error: 'Application not found.' });
    const documentRows = await pool.query<{
      id: string; document_type: string; status: string | null; result_json: Record<string, unknown> | null;
      validations: Array<{field:string;expected:unknown;extracted:unknown;result:string;reason:string}>;
    }>(`SELECT d.id,d.document_type,j.status,j.result_json,
       COALESCE(json_agg(json_build_object('field',v.field,'expected',v.expected,'extracted',v.extracted,'result',v.result,'reason',v.reason)) FILTER (WHERE v.id IS NOT NULL),'[]'::json) AS validations
       FROM documents d LEFT JOIN jobs j ON j.document_id=d.id
       LEFT JOIN validations v ON v.job_id=j.id
       WHERE d.application_id=$1 GROUP BY d.id,j.status,j.result_json ORDER BY d.created_at ASC`, [applicationId]);
    if (!documentRows.rowCount) return res.status(409).json({ error: 'Upload a document before running the assistant.' });
    if (documentRows.rowCount > 20) return res.status(409).json({ error: 'A case can contain at most 20 documents per assistant run.' });
    if (documentRows.rows.some((document) => document.status !== 'completed' || !document.result_json)) {
      return res.status(409).json({ error: 'Wait until every document has a completed processing result.' });
    }
    const internalToken = process.env.DOCFLOW_INTERNAL_TOKEN;
    const agentBaseUrl = process.env.AGENT_BASE_URL || 'http://127.0.0.1:4100';
    if (!internalToken) return res.status(503).json({ error: 'Internal processing service is not configured.' });
    let agentResult: any;
    try {
      const response = await fetch(`${agentBaseUrl.replace(/\/$/, '')}/internal/cases/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-docflow-internal-token': internalToken },
        body: JSON.stringify({
          application_id: applicationId,
          workflow: 'marksheet_review',
          question,
          documents: documentRows.rows.map((document) => ({
            document_id: document.id,
            document_type: document.document_type,
            processing_status: document.status,
            extracted_payload: (document.result_json?.typed_payload as Record<string, unknown>) || {},
            validations: document.validations,
          })),
        }),
        signal: AbortSignal.timeout(27_000),
      });
      if (!response.ok) return res.status(503).json({ error: `Processing assistant unavailable (HTTP ${response.status}).` });
      agentResult = await response.json();
    } catch (error) {
      const reason = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unavailable';
      return res.status(503).json({ error: `Processing assistant ${reason}.` });
    }
    const runId = id();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO verification_runs(id,application_id,requested_by,question,status,summary,reason,policy_answers_json)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [runId,applicationId,req.userId,question,agentResult.status,agentResult.summary,agentResult.reason ?? null,JSON.stringify(agentResult.policy_answers ?? [])]);
      for (const finding of agentResult.findings ?? []) {
        if (!documentRows.rows.some((document) => document.id === finding.document_id)) throw new Error('Agent returned an out-of-case finding.');
        await client.query(`INSERT INTO verification_findings(id,run_id,document_id,document_type,field,expected,extracted,result,reason)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id(),runId,finding.document_id,finding.document_type,finding.field,JSON.stringify(finding.expected),JSON.stringify(finding.extracted),finding.result,finding.reason]);
      }
      for (const [ordinal, trace] of (agentResult.trace ?? []).entries()) {
        const scopedDocumentId = documentRows.rows.some((document) => document.id === trace.document_id) ? trace.document_id : null;
        await client.query(`INSERT INTO verification_traces(id,run_id,ordinal,tool,document_id,outcome,duration_ms,error_code,source_refs)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id(),runId,ordinal,trace.tool,scopedDocumentId,trace.outcome,trace.duration_ms,trace.error_code ?? null,JSON.stringify(trace.source_refs ?? [])]);
      }
      await audit(client,req.userId!,applicationId,'case_agent.completed',{run_id:runId,status:agentResult.status,finding_count:(agentResult.findings ?? []).length});
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    return res.status(201).json({ id: runId, status: agentResult.status, summary: agentResult.summary });
  }));
  app.get('/reviewer/queue', auth, requireReviewer, route(async (_req, res) => {
    const queue = await pool.query<{ id: string; status: string; form_json: unknown; created_at: Date; user_id: string }>(
      "SELECT id, status, form_json, created_at, user_id FROM applications WHERE status IN ('needs_review', 'missing') ORDER BY created_at ASC"
    );
    return res.json(queue.rows);
  }));
  app.get('/reviewer/applications/:applicationId', auth, requireReviewer, route(async (req, res) => {
    const applicationId = String(req.params.applicationId);
    const appRes = await pool.query<{ id: string; status: string; form_json: unknown; created_at: Date; user_id: string }>(
      'SELECT id, status, form_json, created_at, user_id FROM applications WHERE id=$1',
      [applicationId]
    );
    if (!appRes.rowCount) return res.status(404).json({ error: 'Application not found.' });
    const application = appRes.rows[0];

    const docsRes = await pool.query<{
      id: string; application_id: string; document_type: string; filename: string; content_type: string; created_at: Date;
      job_status: string | null; job_updated_at: Date | null; result_json: Record<string, unknown> | null;
    }>(
      `SELECT d.id,d.application_id,d.document_type,d.filename,d.content_type,d.created_at,
              j.status AS job_status,j.updated_at AS job_updated_at,j.result_json
       FROM documents d
       LEFT JOIN LATERAL (SELECT status,updated_at,result_json FROM jobs WHERE document_id=d.id ORDER BY created_at DESC LIMIT 1) j ON TRUE
       WHERE d.application_id=$1 ORDER BY d.created_at ASC`,
      [applicationId]
    );
    const documentEnvelopes = docsRes.rows.map((document) => {
      const processingState = document.job_status ?? 'uploaded';
      const raw = document.result_json;
      const documentResult = document.job_status === 'completed' && raw ? {
        processing_state: processingState,
        document_type_status: raw.document_type_status ?? 'unsupported',
        decision: raw.decision ?? 'needs_review',
        typed_payload: raw.typed_payload ?? null,
        validations: raw.validations ?? [],
        field_provenance: raw.field_provenance ?? {},
        extracted_document: raw.extracted_document ?? null,
        reasoning: raw.reasoning ?? null,
        ocr_text: raw.ocr_text ?? '',
        timings_ms: raw.timings_ms ?? {},
      } : null;
      return {
        application_id: document.application_id,
        document_id: document.id,
        metadata: {
          document_type: document.document_type,
          filename: document.filename,
          content_type: document.content_type,
          page_count: raw?.page_count ?? null,
          processing_state: processingState,
          timestamps: { uploaded_at: document.created_at, processed_at: document.job_updated_at },
        },
        evidence_refs: raw?.evidence_refs ?? [],
        result: documentResult,
      };
    });

    const jobRes = await pool.query<{
      id: string;
      status: string;
      result_json: Record<string, unknown> | null;
      created_at: Date;
      updated_at: Date;
    }>(
      'SELECT j.id, j.status, j.result_json, j.created_at, j.updated_at FROM jobs j JOIN documents d ON d.id=j.document_id WHERE d.application_id=$1 ORDER BY j.created_at DESC LIMIT 1',
      [applicationId]
    );

    let result: any = null;
    let validations: any[] = [];
    if (jobRes.rowCount) {
      const job = jobRes.rows[0];
      const valRows = await pool.query<{
        field: string;
        expected: unknown;
        extracted: unknown;
        result: string;
        reason: string;
      }>(
        'SELECT field, expected, extracted, result, reason FROM validations WHERE job_id=$1 ORDER BY created_at ASC',
        [job.id]
      );
      validations = valRows.rows;
      if (!validations.length && Array.isArray(job.result_json?.validations)) {
        validations = (job.result_json.validations as any[]).map((v) => ({
          field: v.field,
          expected: v.expected,
          extracted: v.extracted,
          result: v.result,
          reason: v.reason,
        }));
      }

      if (job.status === 'completed') {
        const passCount = validations.filter((v) => v.result === 'pass').length;
        const match_score = validations.length > 0 ? Math.round((passCount / validations.length) * 1000) / 10 : 0;
        const decision = (job.result_json?.decision as string) || 'needs_review';
        const timings = job.result_json?.timings ?? job.result_json?.timings_ms ?? null;
        result = {
          status: 'completed',
          decision,
          match_score,
          validations,
          timings,
          created_at: job.created_at,
          updated_at: job.updated_at,
        };
      } else {
        result = { status: job.status === 'failed' ? 'failed' : 'processing' };
      }
    }

    const auditRes = await pool.query<{ id: string; event: string; details_json: unknown; created_at: Date; actor_id: string | null }>(
      'SELECT id, event, details_json, created_at, actor_id FROM audit_events WHERE application_id=$1 ORDER BY created_at ASC',
      [applicationId]
    );

    const reviewsRes = await pool.query<{ id: string; decision: string; note: string; created_at: Date; reviewer_id: string }>(
      'SELECT id, decision, note, created_at, reviewer_id FROM reviews WHERE application_id=$1 ORDER BY created_at ASC',
      [applicationId]
    );
    const runRows = await pool.query<{id:string;question:string;status:string;summary:string;reason:string|null;policy_answers_json:unknown;created_at:Date}>(
      'SELECT id,question,status,summary,reason,policy_answers_json,created_at FROM verification_runs WHERE application_id=$1 ORDER BY created_at DESC LIMIT 20',
      [applicationId],
    );
    const agentRuns = await Promise.all(runRows.rows.map(async (run) => {
      const [findings, traces] = await Promise.all([
        pool.query('SELECT document_id,document_type,field,expected,extracted,result,reason FROM verification_findings WHERE run_id=$1 ORDER BY created_at ASC',[run.id]),
        pool.query('SELECT ordinal,tool,document_id,outcome,duration_ms,error_code,source_refs FROM verification_traces WHERE run_id=$1 ORDER BY ordinal ASC',[run.id]),
      ]);
      return { ...run, findings: findings.rows, traces: traces.rows };
    }));

    return res.json({
      id: application.id,
      status: application.status,
      form_json: application.form_json,
      created_at: application.created_at,
      user_id: application.user_id,
      documents: documentEnvelopes,
      result,
      validations,
      audit: auditRes.rows,
      reviews: reviewsRes.rows,
      agent_runs: agentRuns,
    });
  }));
  app.post('/reviewer/applications/:applicationId/review', auth, requireReviewer, route(async (req, res) => {
    const applicationId = String(req.params.applicationId);
    const decision = req.body?.decision;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';

    if (!['verified', 'needs_review', 'missing'].includes(decision)) {
      return res.status(400).json({ error: 'Valid decision is required (verified, needs_review, or missing).' });
    }
    if (!note) {
      return res.status(400).json({ error: 'Review note is required and must not be empty.' });
    }

    const appRes = await pool.query('SELECT id FROM applications WHERE id=$1', [applicationId]);
    if (!appRes.rowCount) return res.status(404).json({ error: 'Application not found.' });

    const reviewId = id();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO reviews(id, application_id, reviewer_id, decision, note) VALUES($1, $2, $3, $4, $5)',
        [reviewId, applicationId, req.userId, decision, note]
      );
      await client.query('UPDATE applications SET status=$1 WHERE id=$2', [decision, applicationId]);
      await audit(client, req.userId!, applicationId, 'review.submitted', { decision, note, review_id: reviewId });
      await client.query('COMMIT');
      return res.status(200).json({ id: reviewId, status: decision });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }));
  app.use((error: unknown,_req: Request,res: Response,_next: NextFunction)=>{if((error as {type?:string})?.type==='entity.too.large')return res.status(413).json({error:'Upload exceeds 2 MB.'});console.error('API request failed:',error instanceof Error ? error.name : 'UnknownError');return res.status(500).json({error:'Internal server error.'});});
  return app;
}

const pool=createPool(); const app=createApp(pool),port=Number(process.env.PORT)||4000,host=process.env.HOST||'127.0.0.1';
if(process.env.NODE_ENV!=='test') migrate(pool).then(()=>app.listen(port,host,()=>console.log(`API server running at http://${host}:${port}`))).catch(error=>{console.error('API database startup failed:',error instanceof Error ? error.name : 'UnknownError');process.exitCode=1;});
export default app;
