const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  expectedDecision,
  parseArguments,
  parseCsv,
  readFixtures,
  runSimulator,
  selectFixtures,
  serializeCsv,
} = require('./run.js');

test('selects a reproducible shuffled sequence and cycles when count exceeds fixture count', () => {
  const fixtures = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const first = selectFixtures(fixtures, 8, 2027);
  const second = selectFixtures(fixtures, 8, 2027);

  assert.deepEqual(first.map((fixture) => fixture.id), second.map((fixture) => fixture.id));
  assert.equal(new Set(first.slice(0, 3).map((fixture) => fixture.id)).size, 3);
  assert.deepEqual(first.slice(3).map((fixture) => fixture.id), first.slice(0, 5).map((fixture) => fixture.id));
});

test('only scores planted mismatches that the deterministic validator checks', () => {
  assert.equal(expectedDecision({ planted_mismatch: '' }), 'verified');
  assert.equal(expectedDecision({ planted_mismatch: 'total' }), 'needs_review');
  assert.equal(expectedDecision({ planted_mismatch: 'board' }), 'not_evaluated');
  assert.equal(expectedDecision({ planted_mismatch: 'result' }), 'not_evaluated');
});

test('parses and serializes quoted CSV values without losing commas or quotes', () => {
  const parsed = parseCsv('id,name\r\nDF-2027-0001,"Sample, ""Name"""\r\n');
  assert.equal(parsed[0].name, 'Sample, "Name"');
  const serialized = serializeCsv([{
    dataset_id: 'DF-2027-0001',
    error: 'Sample, "Name"',
  }]);
  assert.equal(parseCsv(serialized)[0].error, 'Sample, "Name"');
});

test('loads synthetic PDF or PNG paths from the corresponding answer-key rows', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'docflow-fixtures-'));
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const answerKeyPath = path.join(temporaryDirectory, 'answer_key.csv');
  const documentsDirectory = path.join(temporaryDirectory, 'images');
  fs.mkdirSync(documentsDirectory);
  fs.writeFileSync(answerKeyPath, [
    'id,planted_mismatch,form_name,form_roll_number,form_dob,form_year,form_total',
    'DF-2027-0001,,Synthetic Applicant,SYN27-0001,2005-01-01,2024,400',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(documentsDirectory, 'DF-2027-0001.png'), 'synthetic-png');

  const [fixture] = readFixtures(answerKeyPath, documentsDirectory);
  assert.equal(path.extname(fixture.documentPath), '.png');
  assert.equal(fixture.year, 2024);
  assert.equal(fixture.total, 400);
});

test('validates simulator CLI values and supports the required help command', () => {
  assert.equal(parseArguments(['--help']).help, true);
  assert.equal(parseArguments(['--count', '100', '--seed', '2027']).count, 100);
  assert.throws(() => parseArguments(['--rate-per-second', '0']), /between 1 and 50/);
});

test('uses the simulator API URL from the environment unless overridden', (t) => {
  const previous = process.env.SIMULATOR_API_URL;
  t.after(() => {
    if (previous === undefined) delete process.env.SIMULATOR_API_URL;
    else process.env.SIMULATOR_API_URL = previous;
  });
  process.env.SIMULATOR_API_URL = 'http://127.0.0.1:4555';

  assert.equal(parseArguments([]).apiUrl, 'http://127.0.0.1:4555');
  assert.equal(parseArguments(['--api-url', 'http://127.0.0.1:4666']).apiUrl, 'http://127.0.0.1:4666');
  assert.equal(parseArguments(['--api-url', 'https://api.example.test']).apiUrl, 'https://api.example.test');
  assert.throws(() => parseArguments(['--api-url', 'http://api.example.test']), /use HTTPS/);
});

for (const extension of ['.pdf', '.png']) {
  test(`submits a synthetic ${extension.slice(1).toUpperCase()}, observes status and writes CSV`, async (t) => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'docflow-simulator-'));
    t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
    const documentPath = path.join(temporaryDirectory, `DF-2027-0001${extension}`);
    const outputPath = path.join(temporaryDirectory, 'realtime.csv');
    fs.writeFileSync(documentPath, extension === '.pdf' ? '%PDF-synthetic' : 'synthetic-png');
    const fixture = {
      id: 'DF-2027-0001',
      planted_mismatch: '',
      form_name: 'Synthetic Applicant',
      form_roll_number: 'SYN27-0001',
      form_dob: '2005-01-01',
      year: 2024,
      total: 400,
      documentPath,
    };
    const statusAt = '2026-10-16T09:00:01.000Z';
    const requestPaths = [];
    const encoder = new TextEncoder();
    let requestCount = 0;
    let sendStatusTransitions;
    const fetchImpl = async (url, options) => {
      requestCount += 1;
      const pathname = new URL(url).pathname;
      requestPaths.push(pathname);
      if (pathname === '/auth/login') {
        assert.equal(options.headers.authorization, undefined);
        return Response.json({ token: 'test-token' });
      }
      assert.equal(options.headers.authorization, 'Bearer test-token');
      if (pathname === '/applications') {
        return Response.json({ id: 'application-1', status: 'draft' }, { status: 201 });
      }
      if (pathname === '/applications/application-1/documents') {
        assert.equal(options.headers['x-document-type'], 'marksheet');
        assert.equal(
          options.headers['content-type'],
          extension === '.pdf' ? 'application/pdf' : 'image/png',
        );
        assert.equal(options.body.toString(), extension === '.pdf' ? '%PDF-synthetic' : 'synthetic-png');
        sendStatusTransitions();
        return Response.json({ document_id: 'document-1', status: 'queued' }, { status: 202 });
      }
      if (pathname === '/applications/application-1/status/events') {
        return new Response(new ReadableStream({
          start(controller) {
            const event = { status: 'draft', updated_at: statusAt };
            controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify(event)}\n\n`));
            sendStatusTransitions = () => {
              controller.enqueue(encoder.encode([
                `event: status\ndata: ${JSON.stringify({ status: 'processing', updated_at: statusAt })}\n\n`,
                `event: status\ndata: ${JSON.stringify({ status: 'verified', updated_at: '2026-10-16T09:00:02.000Z' })}\n\n`,
              ].join('')));
              controller.close();
            };
          },
        }), {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      throw new Error(`Unexpected test request: ${pathname}`);
    };

    const result = await runSimulator({
      apiUrl: 'http://127.0.0.1:4000',
      count: 1,
      seed: 2027,
      ratePerSecond: 50,
      timeoutSeconds: 1,
      answerKeyPath: '',
      documentsDirectory: '',
      outputPath,
      overwrite: false,
    }, {
      fetchImpl,
      fixtures: [fixture],
      email: 'synthetic@example.test',
      password: 'synthetic-test-password',
    });

    assert.equal(requestCount, 4);
    assert.ok(
      requestPaths.indexOf('/applications/application-1/status/events') <
        requestPaths.indexOf('/applications/application-1/documents'),
    );
    assert.equal(result.summary.submitted, 1);
    assert.equal(result.summary.completed, 1);
    assert.equal(result.summary.answer_match_percent, 100);
    const [row] = parseCsv(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(row.application_id, 'application-1');
    assert.equal(row.document_id, 'document-1');
    assert.equal(row.status, 'verified');
    assert.equal(row.answer_match, 'true');
    assert.equal(row.observed_retry_count, '0');
  });
}
