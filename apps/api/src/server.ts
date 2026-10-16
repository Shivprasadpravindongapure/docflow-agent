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
  pool.on('connect',(client)=>{client.query('SET search_path TO public').catch((error)=>console.error('PostgreSQL session setup failed:',error));});
  return pool;
}
export async function migrate(pool: Pool,schema='public') { if(schema!=='public'&&!/^docflow_test_[0-9a-f]+$/.test(schema))throw new Error('Invalid migration schema.'); const client=await pool.connect(); try { await client.query(`SET search_path TO "${schema}"`); await client.query(migration); } finally { client.release(); } }
function now() { return new Date(); }
function id() { return randomBytes(16).toString('hex'); }
function passwordHash(password: string, salt = randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
function passwordMatches(password: string, encoded: string) { const [salt, hash] = encoded.split(':'); if (!salt || !hash) return false; const expected = Buffer.from(hash, 'hex'); const actual = scryptSync(password, salt, 64); return actual.length === expected.length && timingSafeEqual(actual, expected); }
function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
type AuthRequest = Request & { userId?: string };
type AsyncHandler = (req: AuthRequest, res: Response, next: NextFunction) => Promise<unknown>;
function route(handler: AsyncHandler) { return (req: Request, res: Response, next: NextFunction) => handler(req as AuthRequest, res, next).catch(next); }
function authenticate(pool: Pool) { return route(async (req, res, next) => {
  const token = req.header('authorization')?.match(/^Bearer ([\w-]+)$/)?.[1];
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  const result = await pool.query<{user_id:string}>('SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at>now()', [hashToken(token)]);
  if (!result.rowCount) return res.status(401).json({ error: 'Invalid or expired session.' });
  req.userId = result.rows[0].user_id; return next();
}); }
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
    const password = req.body?.password;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 12 || password.length > 200) return res.status(400).json({ error: 'Provide a valid email and a password of 12–200 characters.' });
    try { const created = await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3) RETURNING id,email', [id(),email,passwordHash(password)]); return res.status(201).json(created.rows[0]); }
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

    type StatusJob = {status:'queued'|'processing'|'retry'|'completed'|'failed';decision:string|null;updated_at:Date};
    let closed=false;
    let lastEvent='';
    let lastHeartbeat=Date.now();
    let timer:ReturnType<typeof setTimeout>|undefined;
    res.on('close',()=>{closed=true;if(timer)clearTimeout(timer);});

    const poll=async ():Promise<void> => {
      if(closed)return;
      try {
        const result=await pool.query<StatusJob>(
          "SELECT j.status,j.result_json->>'decision' AS decision,j.updated_at FROM jobs j JOIN documents d ON d.id=j.document_id WHERE d.application_id=$1 ORDER BY j.created_at DESC LIMIT 1",
          [applicationId],
        );
        if(closed)return;
        const job=result.rows[0];
        let status='draft';
        let updatedAt=owner.rows[0].created_at;
        if(job) {
          updatedAt=job.updated_at;
          if(job.status==='completed') {
            if(job.decision==='verified'||job.decision==='needs_review'||job.decision==='missing') {
              status=job.decision;
            } else {
              throw new Error('Completed job has an unsupported decision state.');
            }
          } else {
            status=job.status;
          }
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
        console.error('Status event stream failed:',error);
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
    const bytes=Buffer.isBuffer(req.body)?req.body:Buffer.alloc(0); if(!bytes.length)return res.status(400).json({error:'Empty upload.'}); if(contentType==='application/pdf'&&!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))return res.status(422).json({error:'Invalid PDF signature.'}); if(contentType==='image/png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return res.status(422).json({error:'Invalid PNG signature.'}); if(contentType==='image/jpeg'&&!bytes.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])))return res.status(422).json({error:'Invalid JPEG signature.'});
    const ext=contentType==='application/pdf'?'pdf':contentType==='image/jpeg'?'jpg':'png';
    const documentId=id(),jobId=id(),sha=createHash('sha256').update(bytes).digest('hex'),base=resolve(projectRoot,process.env.UPLOAD_DIR||'uploads'),file=resolve(base,`${documentId}.${ext}`); mkdirSync(base,{recursive:true}); writeFileSync(file,bytes,{flag:'wx'});
    const client=await pool.connect(); try { await client.query('BEGIN'); await client.query('INSERT INTO documents(id,application_id,filename,content_type,sha256,storage_path) VALUES($1,$2,$3,$4,$5,$6)',[documentId,applicationId,`upload.${ext}`,contentType,sha,file]); await client.query("INSERT INTO jobs(id,document_id,status,available_at) VALUES($1,$2,'queued',now())",[jobId,documentId]); await client.query("UPDATE applications SET status='queued' WHERE id=$1",[applicationId]); await audit(client,req.userId!,applicationId,'document.uploaded',{content_type:contentType,sha256:sha},documentId,jobId); await audit(client,req.userId!,applicationId,'job.queued',{status:'queued'},documentId,jobId); await client.query('COMMIT'); return res.status(202).json({document_id:documentId,job_id:jobId,status:'queued'}); } catch(error) { await client.query('ROLLBACK'); unlinkSync(file); throw error; } finally { client.release(); }
  }));
  app.get('/applications/:applicationId', auth, route(async (req,res) => { const result=await pool.query('SELECT id,status,form_json,created_at FROM applications WHERE id=$1 AND user_id=$2',[req.params.applicationId,req.userId]); if(!result.rowCount)return res.status(404).json({error:'Application not found.'}); return res.json(result.rows[0]); }));
  app.get('/applications/:applicationId/result', auth, route(async (req, res) => {
    const applicationId = String(req.params.applicationId);
    const owner = await pool.query('SELECT id FROM applications WHERE id=$1 AND user_id=$2', [applicationId, req.userId]);
    if (!owner.rowCount) return res.status(404).json({ error: 'Application not found.' });

    const jobResult = await pool.query<{
      id: string;
      status: string;
      result_json: Record<string, unknown> | null;
      created_at: Date;
      updated_at: Date;
    }>(
      'SELECT j.id, j.status, j.result_json, j.created_at, j.updated_at FROM jobs j JOIN documents d ON d.id=j.document_id WHERE d.application_id=$1 ORDER BY j.created_at DESC LIMIT 1',
      [applicationId]
    );

    if (!jobResult.rowCount) {
      return res.json({ status: 'draft' });
    }

    const job = jobResult.rows[0];
    if (job.status !== 'completed') {
      return res.json({ status: job.status === 'failed' ? 'failed' : 'processing' });
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
    const decision = (job.result_json?.decision as string) || 'verified';
    const timings = job.result_json?.timings ?? job.result_json?.timings_ms ?? null;

    return res.json({
      status: 'completed',
      decision,
      match_score,
      validations,
      timings,
      created_at: job.created_at,
      updated_at: job.updated_at,
    });
  }));
  app.get('/applications/:applicationId/documents', auth, route(async (req, res) => {
    const applicationId = String(req.params.applicationId);
    const owner = await pool.query('SELECT id FROM applications WHERE id=$1 AND user_id=$2', [applicationId, req.userId]);
    if (!owner.rowCount) return res.status(404).json({ error: 'Application not found.' });

    const docs = await pool.query<{ id: string; filename: string; content_type: string; created_at: Date }>(
      'SELECT id, filename, content_type, created_at FROM documents WHERE application_id=$1 ORDER BY created_at ASC',
      [applicationId]
    );
    return res.json(docs.rows);
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
  app.get('/reviewer/queue', auth, route(async (_req, res) => {
    const queue = await pool.query<{ id: string; status: string; form_json: unknown; created_at: Date; user_id: string }>(
      "SELECT id, status, form_json, created_at, user_id FROM applications WHERE status IN ('needs_review', 'missing') ORDER BY created_at ASC"
    );
    return res.json(queue.rows);
  }));
  app.get('/reviewer/applications/:applicationId', auth, route(async (req, res) => {
    const applicationId = String(req.params.applicationId);
    const appRes = await pool.query<{ id: string; status: string; form_json: unknown; created_at: Date; user_id: string }>(
      'SELECT id, status, form_json, created_at, user_id FROM applications WHERE id=$1',
      [applicationId]
    );
    if (!appRes.rowCount) return res.status(404).json({ error: 'Application not found.' });
    const application = appRes.rows[0];

    const docsRes = await pool.query<{ id: string; filename: string; content_type: string; created_at: Date }>(
      'SELECT id, filename, content_type, created_at FROM documents WHERE application_id=$1 ORDER BY created_at ASC',
      [applicationId]
    );

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
        const decision = (job.result_json?.decision as string) || 'verified';
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

    return res.json({
      id: application.id,
      status: application.status,
      form_json: application.form_json,
      created_at: application.created_at,
      user_id: application.user_id,
      documents: docsRes.rows,
      result,
      validations,
      audit: auditRes.rows,
      reviews: reviewsRes.rows,
    });
  }));
  app.post('/reviewer/applications/:applicationId/review', auth, route(async (req, res) => {
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
  app.use((error: unknown,_req: Request,res: Response,_next: NextFunction)=>{if((error as {type?:string})?.type==='entity.too.large')return res.status(413).json({error:'Upload exceeds 2 MB.'});console.error('API request failed:',error);return res.status(500).json({error:'Internal server error.'});});
  return app;
}

const pool=createPool(); const app=createApp(pool),port=Number(process.env.PORT)||4000,host=process.env.HOST||'127.0.0.1';
if(process.env.NODE_ENV!=='test') migrate(pool).then(()=>app.listen(port,host,()=>console.log(`API server running at http://${host}:${port}`))).catch(error=>{console.error('API database startup failed:',error);process.exitCode=1;});
export default app;
