import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

import { createApp, migrate } from './server.js';

const configuredConnectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!configuredConnectionString) throw new Error('Set TEST_DATABASE_URL or DATABASE_URL to run PostgreSQL API tests.');
const testDatabaseUrl = new URL(configuredConnectionString);
if (!process.env.TEST_DATABASE_URL) {
  testDatabaseUrl.hostname = testDatabaseUrl.hostname.replace('-pooler.', '.');
}
const connectionString = testDatabaseUrl.toString();
const suffix = randomUUID();
const schema = `docflow_test_${suffix.replaceAll('-','')}`;
const admin = new Pool({connectionString,max:1});
const pool = new Pool({ connectionString, max: 1 });
const email = `synthetic-${suffix}@example.test`;
const uploadDir = `.tmp-api-tests-${suffix}`;
const projectRoot = resolve(process.cwd(),'../..');
process.env.UPLOAD_DIR = uploadDir;
const app = createApp(pool);

beforeAll(async () => { await admin.query(`CREATE SCHEMA "${schema}"`); const client=await pool.connect(); await client.query(`SET search_path TO "${schema}"`); client.release(); await migrate(pool,schema); mkdirSync(resolve(projectRoot,uploadDir),{recursive:true}); });
afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); rmSync(resolve(projectRoot,uploadDir),{recursive:true,force:true}); });

describe('PostgreSQL API and synthetic upload flow', () => {
  it('serves health and runs registration, login, application, upload, and durable job enqueue', async () => {
    const health = await request(app).get('/health');
    expect(health.body).toEqual({status:'ok',service:'api'});
    const password='synthetic-passphrase-2027';
    const registered=await request(app).post('/auth/register').send({email,password});
    expect(registered.status).toBe(201);
    const login=await request(app).post('/auth/login').send({email,password});
    expect(login.status).toBe(200);
    const authorization=`Bearer ${login.body.token}`;
    const created=await request(app).post('/applications').set('Authorization',authorization).send({name:'Asha Example',roll_number:'SYN-2027-001',dob:'2008-01-02',year:2025,board:'Synthetic Board',total:450});
    expect(created.status).toBe(201);
    const upload=await request(app).post(`/applications/${created.body.id}/documents`).set('Authorization',authorization).set('Content-Type','image/png').send(Buffer.from([137,80,78,71,13,10,26,10,1,2,3]));
    expect(upload.status, JSON.stringify(upload.body)).toBe(202);
    const stored=await pool.query('SELECT j.status,d.content_type FROM jobs j JOIN documents d ON d.id=j.document_id WHERE j.id=$1',[upload.body.job_id]);
    expect(stored.rows).toEqual([{status:'queued',content_type:'image/png'}]);
    const audit=await pool.query('SELECT event FROM audit_events WHERE application_id=$1 ORDER BY created_at',[created.body.id]);
    expect(audit.rows.map((row)=>row.event)).toEqual(['application.created','document.uploaded','job.queued']);
    expect((await request(app).get(`/applications/${created.body.id}`).set('Authorization','Bearer invalid')).status).toBe(401);
  });

  it('rejects weak registration and unauthenticated application creation', async () => {
    expect((await request(app).post('/auth/register').send({email,password:'short'})).status).toBe(400);
    expect((await request(app).post('/applications').send({})).status).toBe(401);
  });

  it('allows browser preflight from the local Vite origin only', async () => {
    const allowed=await request(app).options('/applications').set('Origin','http://localhost:5173').set('Access-Control-Request-Method','POST');
    expect(allowed.status).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect((await request(app).options('/applications').set('Origin','https://untrusted.example').set('Access-Control-Request-Method','POST')).status).toBe(403);
  });

  it('streams only the owning applicant status changes and stops polling on disconnect', async () => {
    const statusEmail = `status-${suffix}@example.test`;
    const password = 'synthetic-status-passphrase-2027';
    await request(app).post('/auth/register').send({ email: statusEmail, password }).expect(201);
    const login = await request(app).post('/auth/login').send({ email: statusEmail, password }).expect(200);
    const authorization = `Bearer ${login.body.token}`;
    const created = await request(app)
      .post('/applications')
      .set('Authorization', authorization)
      .send({
        name: 'Synthetic Applicant',
        roll_number: 'SYN-STATUS-001',
        dob: '2008-01-02',
        year: 2025,
        board: 'Synthetic Board',
        total: 450,
      })
      .expect(201);
    const upload = await request(app)
      .post(`/applications/${created.body.id}/documents`)
      .set('Authorization', authorization)
      .set('Content-Type', 'image/png')
      .send(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]))
      .expect(202);

    await request(app)
      .get(`/applications/${created.body.id}/status/events`)
      .expect(401);
    const otherEmail = `other-${suffix}@example.test`;
    await request(app).post('/auth/register').send({ email: otherEmail, password }).expect(201);
    const otherLogin = await request(app).post('/auth/login').send({ email: otherEmail, password });
    await request(app)
      .get(`/applications/${created.body.id}/status/events`)
      .set('Authorization', `Bearer ${otherLogin.body.token}`)
      .expect(404);

    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Unable to start API test server.');
    const controller = new AbortController();
    const querySpy = vi.spyOn(pool, 'query');
    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/applications/${created.body.id}/status/events`,
        { headers: { Authorization: authorization }, signal: controller.signal },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(response.headers.get('cache-control')).toContain('no-cache');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Status event response has no stream reader.');
      const decoder = new TextDecoder();
      let buffered = '';
      const nextStatus = async () => {
        while (true) {
          const frameEnd = buffered.indexOf('\n\n');
          if (frameEnd !== -1) {
            const frame = buffered.slice(0, frameEnd);
            buffered = buffered.slice(frameEnd + 2);
            const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
            if (dataLine) return JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
          }
          const chunk = await reader.read();
          if (chunk.done) throw new Error('Status event stream closed before the expected update.');
          buffered += decoder.decode(chunk.value, { stream: true });
        }
      };
      const queued = await nextStatus();
      expect(queued).toEqual({
        application_id: created.body.id,
        status: 'queued',
        updated_at: expect.any(String),
      });
      expect(Object.keys(queued).sort()).toEqual(['application_id', 'status', 'updated_at']);

      await pool.query(
        "UPDATE jobs SET status='processing',updated_at=now() WHERE id=$1",
        [upload.body.job_id],
      );
      expect((await nextStatus()).status).toBe('processing');

      await pool.query(
        "UPDATE jobs SET status='completed',result_json=$1,updated_at=now() WHERE id=$2",
        [JSON.stringify({ decision: 'verified', document_text: 'must not be sent' }), upload.body.job_id],
      );
      const verified = await nextStatus();
      expect(verified.status).toBe('verified');
      expect(JSON.stringify(verified)).not.toContain('must not be sent');
      expect(JSON.stringify(verified)).not.toContain(login.body.token);

      await reader.cancel();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const pollCount = () =>
        querySpy.mock.calls.filter(
          ([query]) => typeof query === 'string' && query.includes('SELECT j.status'),
        ).length;
      const afterDisconnect = pollCount();
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(pollCount()).toBe(afterDisconnect);
    } finally {
      querySpy.mockRestore();
      controller.abort();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('handles JPEG upload, results, documents, audit, reviewer queue, and review submission', async () => {
    const userEmail = `phase-a-${suffix}@example.test`;
    const reviewerEmail = `reviewer-${suffix}@example.test`;
    const otherEmail = `unauth-${suffix}@example.test`;
    const password = 'synthetic-passphrase-2027';

    await request(app).post('/auth/register').send({ email: userEmail, password }).expect(201);
    await request(app).post('/auth/register').send({ email: reviewerEmail, password }).expect(201);
    await request(app).post('/auth/register').send({ email: otherEmail, password }).expect(201);

    const userLogin = await request(app).post('/auth/login').send({ email: userEmail, password }).expect(200);
    const userAuth = `Bearer ${userLogin.body.token}`;

    const reviewerLogin = await request(app).post('/auth/login').send({ email: reviewerEmail, password }).expect(200);
    const reviewerAuth = `Bearer ${reviewerLogin.body.token}`;

    const otherLogin = await request(app).post('/auth/login').send({ email: otherEmail, password }).expect(200);
    const otherAuth = `Bearer ${otherLogin.body.token}`;

    // 1. Create application and check draft result
    const created = await request(app)
      .post('/applications')
      .set('Authorization', userAuth)
      .send({ name: 'Sneha Patel', roll_number: 'SYN-JPEG-001', dob: '2008-03-15', year: 2025, board: 'Synthetic Board', total: 460 })
      .expect(201);
    const appId = created.body.id;

    const draftResult = await request(app)
      .get(`/applications/${appId}/result`)
      .set('Authorization', userAuth)
      .expect(200);
    expect(draftResult.body).toEqual({ status: 'draft' });

    // 2. Reject invalid JPEG signature
    await request(app)
      .post(`/applications/${appId}/documents`)
      .set('Authorization', userAuth)
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.from([0x00, 0x11, 0x22, 0x33]))
      .expect(422);

    // 3. Accept valid JPEG upload
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const uploadRes = await request(app)
      .post(`/applications/${appId}/documents`)
      .set('Authorization', userAuth)
      .set('Content-Type', 'image/jpeg')
      .send(jpegBytes)
      .expect(202);
    const docId = uploadRes.body.document_id;
    const jobId = uploadRes.body.job_id;

    // Check document stored with image/jpeg
    const docRow = await pool.query('SELECT content_type, filename FROM documents WHERE id=$1', [docId]);
    expect(docRow.rows[0]).toEqual({ content_type: 'image/jpeg', filename: 'upload.jpg' });

    // 4. GET /applications/:applicationId/documents/:documentId/file
    const fileRes = await request(app)
      .get(`/applications/${appId}/documents/${docId}/file`)
      .set('Authorization', userAuth)
      .expect(200);
    expect(fileRes.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.from(fileRes.body).equals(jpegBytes)).toBe(true);

    // Unauthorized file access is rejected
    await request(app)
      .get(`/applications/${appId}/documents/${docId}/file`)
      .set('Authorization', otherAuth)
      .expect(404);

    // 5. GET /applications/:applicationId/documents
    const docsRes = await request(app)
      .get(`/applications/${appId}/documents`)
      .set('Authorization', userAuth)
      .expect(200);
    expect(docsRes.body).toHaveLength(1);
    expect(docsRes.body[0]).toMatchObject({ id: docId, filename: 'upload.jpg', content_type: 'image/jpeg' });

    await request(app)
      .get(`/applications/${appId}/documents`)
      .set('Authorization', otherAuth)
      .expect(404);

    // 6. GET /applications/:applicationId/audit
    const auditRes = await request(app)
      .get(`/applications/${appId}/audit`)
      .set('Authorization', userAuth)
      .expect(200);
    expect(auditRes.body.length).toBeGreaterThanOrEqual(3);
    expect(auditRes.body.map((e: { event: string }) => e.event)).toContain('document.uploaded');

    await request(app)
      .get(`/applications/${appId}/audit`)
      .set('Authorization', otherAuth)
      .expect(404);

    // 7. GET /applications/:applicationId/result during processing
    const procResult = await request(app)
      .get(`/applications/${appId}/result`)
      .set('Authorization', userAuth)
      .expect(200);
    expect(procResult.body).toEqual({ status: 'processing' });

    // Simulate worker completing job with validations: 2 pass, 1 mismatch = 66.7% match score
    await pool.query(
      "UPDATE jobs SET status='completed',result_json=$1,updated_at=now() WHERE id=$2",
      [
        JSON.stringify({
          decision: 'needs_review',
          timings_ms: { ocr: 120, validation: 10, total: 130 },
        }),
        jobId,
      ]
    );
    await pool.query("UPDATE applications SET status='needs_review' WHERE id=$1", [appId]);
    await pool.query(
      "INSERT INTO validations(id,job_id,field,expected,extracted,result,reason) VALUES " +
        "('v1',$1,'name','\"Sneha Patel\"','\"Sneha Patel\"','pass','Matched exactly'), " +
        "('v2',$1,'roll_number','\"SYN-JPEG-001\"','\"SYN-JPEG-001\"','pass','Matched exactly'), " +
        "('v3',$1,'dob','\"2008-03-15\"','\"2008-03-16\"','mismatch','DOB does not match')",
      [jobId]
    );

    // GET result when completed
    const completedResult = await request(app)
      .get(`/applications/${appId}/result`)
      .set('Authorization', userAuth)
      .expect(200);
    expect(completedResult.body.status).toBe('completed');
    expect(completedResult.body.decision).toBe('needs_review');
    expect(completedResult.body.match_score).toBe(66.7);
    expect(completedResult.body.validations).toHaveLength(3);
    expect(completedResult.body.timings).toEqual({ ocr: 120, validation: 10, total: 130 });
    expect(completedResult.body.created_at).toBeDefined();

    // Other user cannot access result
    await request(app)
      .get(`/applications/${appId}/result`)
      .set('Authorization', otherAuth)
      .expect(404);

    // 8. GET /reviewer/queue
    const queueRes = await request(app)
      .get('/reviewer/queue')
      .set('Authorization', reviewerAuth)
      .expect(200);
    expect(queueRes.body.some((item: { id: string }) => item.id === appId)).toBe(true);
    const queueItem = queueRes.body.find((item: { id: string }) => item.id === appId);
    expect(queueItem.status).toBe('needs_review');

    // 9. GET /reviewer/applications/:applicationId
    const reviewerDetail = await request(app)
      .get(`/reviewer/applications/${appId}`)
      .set('Authorization', reviewerAuth)
      .expect(200);
    expect(reviewerDetail.body.id).toBe(appId);
    expect(reviewerDetail.body.status).toBe('needs_review');
    expect(reviewerDetail.body.documents).toHaveLength(1);
    expect(reviewerDetail.body.validations).toHaveLength(3);
    expect(reviewerDetail.body.result.match_score).toBe(66.7);
    expect(reviewerDetail.body.reviews).toHaveLength(0);

    // 10. POST /reviewer/applications/:applicationId/review
    // Rejects empty note
    await request(app)
      .post(`/reviewer/applications/${appId}/review`)
      .set('Authorization', reviewerAuth)
      .send({ decision: 'verified', note: '' })
      .expect(400);

    // Rejects invalid decision
    await request(app)
      .post(`/reviewer/applications/${appId}/review`)
      .set('Authorization', reviewerAuth)
      .send({ decision: 'invalid_decision', note: 'Checked manually' })
      .expect(400);

    // Submits valid review
    const reviewSubmit = await request(app)
      .post(`/reviewer/applications/${appId}/review`)
      .set('Authorization', reviewerAuth)
      .send({ decision: 'verified', note: 'Mark sheet DOB was confirmed with secondary ID' })
      .expect(200);
    expect(reviewSubmit.body.status).toBe('verified');
    expect(reviewSubmit.body.id).toBeDefined();

    // Verify application status updated to 'verified'
    const updatedApp = await pool.query('SELECT status FROM applications WHERE id=$1', [appId]);
    expect(updatedApp.rows[0].status).toBe('verified');

    // Verify review record
    const storedReview = await pool.query('SELECT decision, note, reviewer_id FROM reviews WHERE application_id=$1', [appId]);
    expect(storedReview.rows[0]).toEqual({
      decision: 'verified',
      note: 'Mark sheet DOB was confirmed with secondary ID',
      reviewer_id: reviewerLogin.body.user_id || expect.any(String),
    });

    // Verify audit event 'review.submitted'
    const reviewAudit = await pool.query("SELECT event, details_json FROM audit_events WHERE application_id=$1 AND event='review.submitted'", [appId]);
    expect(reviewAudit.rowCount).toBe(1);
    expect(reviewAudit.rows[0].details_json.decision).toBe('verified');

    // Queue now no longer contains this verified app
    const updatedQueue = await request(app)
      .get('/reviewer/queue')
      .set('Authorization', reviewerAuth)
      .expect(200);
    expect(updatedQueue.body.some((item: { id: string }) => item.id === appId)).toBe(false);

    // Reviewer detail now includes the new review
    const reviewerDetailAfter = await request(app)
      .get(`/reviewer/applications/${appId}`)
      .set('Authorization', reviewerAuth)
      .expect(200);
    expect(reviewerDetailAfter.body.status).toBe('verified');
    expect(reviewerDetailAfter.body.reviews).toHaveLength(1);
  });
});
