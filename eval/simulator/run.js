const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { setTimeout: sleep } = require('node:timers/promises');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULTS = {
  apiUrl: 'http://127.0.0.1:4000',
  count: 100,
  seed: 2027,
  ratePerSecond: 2,
  timeoutSeconds: 300,
  answerKeyPath: path.join(ROOT, 'eval', 'data', 'pdf_answer_key.csv'),
  documentsDirectory: path.join(ROOT, 'eval', 'data', 'pdfs'),
  outputPath: path.join(ROOT, 'eval', 'results', 'realtime.csv'),
};
const CSV_COLUMNS = [
  'dataset_id',
  'seed',
  'application_id',
  'document_id',
  'submit_at',
  'start_at',
  'finish_at',
  'status',
  'decision',
  'expected_decision',
  'answer_match',
  'observed_retry_count',
  'submit_ms',
  'processing_ms',
  'total_ms',
  'error',
];
const DECISIONS = new Set(['verified', 'needs_review', 'missing']);
const TERMINAL_STATUSES = new Set([...DECISIONS, 'failed']);
const VALIDATED_FIELDS = new Set([
  'name',
  'roll_number',
  'dob',
  'year',
  'total',
]);
const REQUIRED_COLUMNS = [
  'id',
  'planted_mismatch',
  'form_name',
  'form_roll_number',
  'form_dob',
  'form_year',
  'form_total',
];

function parseArguments(argv) {
  const options = {
    ...DEFAULTS,
    apiUrl: process.env.SIMULATOR_API_URL || DEFAULTS.apiUrl,
    help: false,
    overwrite: false,
  };
  const values = new Map([
    ['--api-url', 'apiUrl'],
    ['--count', 'count'],
    ['--seed', 'seed'],
    ['--rate-per-second', 'ratePerSecond'],
    ['--timeout-seconds', 'timeoutSeconds'],
    ['--answer-key', 'answerKeyPath'],
    ['--documents-dir', 'documentsDirectory'],
    ['--output', 'outputPath'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--overwrite') {
      options.overwrite = true;
      continue;
    }
    const key = values.get(argument);
    if (!key || index + 1 >= argv.length) {
      throw new Error(`Unknown or incomplete option: ${argument}`);
    }
    options[key] = argv[index += 1];
  }

  if (options.help) return options;

  for (const key of ['count', 'seed', 'ratePerSecond', 'timeoutSeconds']) {
    const value = Number(options[key]);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`--${key} must be an integer.`);
    }
    options[key] = value;
  }
  if (options.count < 1 || options.count > 1000) {
    throw new Error('--count must be between 1 and 1000.');
  }
  if (options.seed < 0 || options.seed > 2147483647) {
    throw new Error('--seed must be between 0 and 2147483647.');
  }
  if (options.ratePerSecond < 1 || options.ratePerSecond > 50) {
    throw new Error('--rate-per-second must be between 1 and 50.');
  }
  if (options.timeoutSeconds < 1 || options.timeoutSeconds > 3600) {
    throw new Error('--timeout-seconds must be between 1 and 3600.');
  }

  try {
    const apiUrl = new URL(options.apiUrl);
    if (!['http:', 'https:'].includes(apiUrl.protocol)) throw new Error();
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (apiUrl.protocol === 'http:' && !localHosts.has(apiUrl.hostname)) {
      throw new Error();
    }
    options.apiUrl = apiUrl.toString().replace(/\/+$/, '');
  } catch {
    throw new Error('--api-url must be absolute HTTP(S) and use HTTPS unless targeting localhost.');
  }

  for (const key of ['answerKeyPath', 'documentsDirectory', 'outputPath']) {
    options[key] = path.resolve(ROOT, options[key]);
  }
  return options;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(value);
      value = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error('Answer-key CSV contains an unclosed quoted field.');
  row.push(value);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  if (rows.length < 2) throw new Error('Answer-key CSV has no data rows.');

  const headers = rows[0];
  if (new Set(headers).size !== headers.length) {
    throw new Error('Answer-key CSV contains duplicate column names.');
  }
  return rows.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) {
      throw new Error(`Answer-key CSV row ${index + 2} has an invalid column count.`);
    }
    return Object.fromEntries(headers.map((header, column) => [header, cells[column]]));
  });
}

function readFixtures(answerKeyPath, documentsDirectory) {
  const rows = parseCsv(fs.readFileSync(answerKeyPath, 'utf8'));
  for (const column of REQUIRED_COLUMNS) {
    if (!Object.hasOwn(rows[0], column)) {
      throw new Error(`Answer-key CSV is missing the "${column}" column.`);
    }
  }

  return rows.map((row) => {
    if (!/^DF-2027-\d{4}$/.test(row.id)) {
      throw new Error(`Answer-key row has an unsupported synthetic ID: ${row.id}`);
    }
    for (const column of ['form_name', 'form_roll_number', 'form_dob']) {
      if (!row[column]) throw new Error(`Answer-key row ${row.id} has an empty ${column}.`);
    }
    for (const column of ['form_year', 'form_total']) {
      if (!/^\d+$/.test(row[column])) {
        throw new Error(`Answer-key row ${row.id} has an invalid ${column}.`);
      }
    }
    const matches = ['.pdf', '.png']
      .map((extension) => path.join(documentsDirectory, `${row.id}${extension}`))
      .filter((documentPath) => fs.existsSync(documentPath));
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one PDF or PNG for synthetic row ${row.id} in ${documentsDirectory}.`,
      );
    }
    return {
      ...row,
      year: Number(row.form_year),
      total: Number(row.form_total),
      documentPath: matches[0],
    };
  });
}

function seededRandom(seed) {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function selectFixtures(fixtures, count, seed) {
  if (fixtures.length === 0) throw new Error('No synthetic answer-key rows were found.');
  const random = seededRandom(seed);
  const shuffled = [...fixtures];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return Array.from({ length: count }, (_, index) => shuffled[index % shuffled.length]);
}

function expectedDecision(fixture) {
  const mismatch = fixture.planted_mismatch;
  if (!mismatch) return 'verified';
  return VALIDATED_FIELDS.has(mismatch) ? 'needs_review' : 'not_evaluated';
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function serializeCsv(rows) {
  return [
    CSV_COLUMNS.join(','),
    ...rows.map((row) => CSV_COLUMNS.map((column) => csvCell(row[column])).join(',')),
  ].join('\n') + '\n';
}

function parseTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function elapsedMilliseconds(start, finish) {
  const startedAt = parseTimestamp(start);
  const finishedAt = parseTimestamp(finish);
  return startedAt === null || finishedAt === null
    ? ''
    : Math.max(0, finishedAt - startedAt);
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(percentileValue * sorted.length) - 1];
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function summarizeCsv(csvText) {
  const rows = parseCsv(csvText);
  const completed = rows.filter((row) => DECISIONS.has(row.status));
  const durations = completed
    .map((row) => Number(row.total_ms))
    .filter(Number.isFinite);
  const evaluated = rows.filter((row) => row.answer_match === 'true' || row.answer_match === 'false');
  const matches = evaluated.filter((row) => row.answer_match === 'true').length;
  const retries = rows.reduce((sum, row) => sum + (Number(row.observed_retry_count) || 0), 0);
  const failures = rows.filter((row) => !DECISIONS.has(row.status)).length;

  return {
    submitted: rows.length,
    completed: completed.length,
    completion_rate_percent: Number(((completed.length / rows.length) * 100).toFixed(2)),
    median_decision_ms: median(durations),
    p95_decision_ms: percentile(durations, 0.95),
    failures,
    observed_retries: retries,
    answer_match_evaluated: evaluated.length,
    answer_match_percent: evaluated.length
      ? Number(((matches / evaluated.length) * 100).toFixed(2))
      : null,
  };
}

async function requestJson(fetchImpl, url, { method = 'GET', token, body, contentType, documentType } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (contentType) headers['content-type'] = contentType;
  if (documentType) headers['x-document-type'] = documentType;
  if (body && contentType === 'application/json') body = JSON.stringify(body);
  const response = await fetchImpl(url, {
    method,
    headers,
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? `: ${payload.error}` : '';
    throw new Error(`${method} ${new URL(url).pathname} returned HTTP ${response.status}${message}`);
  }
  if (!payload || typeof payload !== 'object') {
    throw new Error(`${method} ${new URL(url).pathname} returned invalid JSON.`);
  }
  return payload;
}

function parseStatusEvent(block) {
  const lines = block.split(/\r?\n/);
  if (!lines.some((line) => line.trim() === 'event: status')) return null;
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (!data) throw new Error('Status stream emitted an empty event.');
  const event = JSON.parse(data);
  if (
    !event ||
    typeof event.status !== 'string' ||
    typeof event.updated_at !== 'string' ||
    parseTimestamp(event.updated_at) === null
  ) {
    throw new Error('Status stream emitted an invalid status event.');
  }
  return event;
}

async function waitForTerminalStatus(fetchImpl, url, token, timeoutSeconds, onStatus, cancellationSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const abortForCancellation = () => controller.abort();
  let reader;
  if (cancellationSignal?.aborted) controller.abort();
  else cancellationSignal?.addEventListener('abort', abortForCancellation, { once: true });
  try {
    const response = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'text/event-stream',
      },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Status stream returned HTTP ${response.status}.`);
    }
    if (!response.body) throw new Error('Status stream response had no body.');

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      buffer = buffer.replace(/\r\n/g, '\n');
      let delimiter = buffer.indexOf('\n\n');
      while (delimiter >= 0) {
        const block = buffer.slice(0, delimiter);
        buffer = buffer.slice(delimiter + 2);
        const event = parseStatusEvent(block);
        if (event) {
          onStatus(event);
          if (TERMINAL_STATUSES.has(event.status)) return event;
        }
        delimiter = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
    throw new Error('Status stream ended before a terminal status was received.');
  } catch (error) {
    if (cancellationSignal?.aborted) {
      const cancellationError = new Error('Status observation cancelled.');
      cancellationError.code = 'STATUS_CANCELLED';
      throw cancellationError;
    }
    if (controller.signal.aborted) {
      const timeoutError = new Error(`Timed out after ${timeoutSeconds} seconds waiting for status.`);
      timeoutError.code = 'STATUS_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    cancellationSignal?.removeEventListener('abort', abortForCancellation);
    if (reader) await reader.cancel().catch(() => {});
    controller.abort();
  }
}

function asRecord(fixture, seed) {
  return {
    dataset_id: fixture.id,
    seed,
    application_id: '',
    document_id: '',
    submit_at: '',
    start_at: '',
    finish_at: '',
    status: '',
    decision: '',
    expected_decision: expectedDecision(fixture),
    answer_match: 'not_evaluated',
    observed_retry_count: 0,
    submit_ms: '',
    processing_ms: '',
    total_ms: '',
    error: '',
  };
}

function documentContentType(documentPath) {
  const contentType = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
  }[path.extname(documentPath).toLowerCase()];
  if (!contentType) {
    throw new Error(`Unsupported synthetic document extension: ${path.extname(documentPath)}`);
  }
  return contentType;
}

async function createApplication(fetchImpl, apiUrl, token, fixture, record) {
  documentContentType(fixture.documentPath);
  const applicationUrl = `${apiUrl}/applications`;
  const application = await requestJson(fetchImpl, applicationUrl, {
    method: 'POST',
    token,
    contentType: 'application/json',
    body: {
      name: fixture.form_name,
      roll_number: fixture.form_roll_number,
      dob: fixture.form_dob,
      year: fixture.year,
      total: fixture.total,
    },
  });
  if (typeof application.id !== 'string') {
    throw new Error('Application API response did not include an ID.');
  }
  record.application_id = application.id;
  return application.id;
}

async function uploadDocument(fetchImpl, apiUrl, token, applicationId, fixture, record) {
  const contentType = documentContentType(fixture.documentPath);
  const documentBytes = fs.readFileSync(fixture.documentPath);
  const uploadUrl = `${apiUrl}/applications/${encodeURIComponent(applicationId)}/documents`;
  const upload = await requestJson(fetchImpl, uploadUrl, {
    method: 'POST',
    token,
    contentType,
    documentType: 'marksheet',
    body: documentBytes,
  });
  if (typeof upload.document_id !== 'string') {
    throw new Error('Upload API response did not include a document ID.');
  }
  record.document_id = upload.document_id;
  const submittedAt = Date.now();
  record.submit_at = new Date(submittedAt).toISOString();
  record.submit_ms = Math.round(performance.now() - record._submissionStartedMonotonic);
  record._submittedMonotonic = performance.now();
}

function observeFixture(fetchImpl, apiUrl, token, applicationId, fixture, record, timeoutSeconds, cancellationSignal) {
  let firstProcessingAt = '';
  let observedRetries = 0;
  let resolveReady;
  let rejectReady;
  let readySettled = false;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const statusUrl = `${apiUrl}/applications/${encodeURIComponent(applicationId)}/status/events`;
  const task = (async () => {
    try {
      const finalEvent = await waitForTerminalStatus(
        fetchImpl,
        statusUrl,
        token,
        timeoutSeconds,
        (event) => {
          if (!readySettled) {
            readySettled = true;
            resolveReady();
          }
          if (event.status === 'processing' && !firstProcessingAt) {
            firstProcessingAt = event.updated_at;
          }
          if (event.status === 'retry') observedRetries += 1;
        },
        cancellationSignal,
      );
      record.start_at = firstProcessingAt;
      record.finish_at = finalEvent.updated_at;
      record.status = finalEvent.status;
      record.decision = DECISIONS.has(finalEvent.status) ? finalEvent.status : '';
      record.observed_retry_count = observedRetries;
      record.processing_ms = elapsedMilliseconds(record.start_at, record.finish_at);
      record.total_ms = Math.round(performance.now() - record._submittedMonotonic);
      if (record.expected_decision !== 'not_evaluated') {
        record.answer_match = String(record.decision === record.expected_decision);
      }
      if (finalEvent.status === 'failed') record.error = 'Processing job ended in failed status.';
    } catch (error) {
      if (!readySettled) {
        readySettled = true;
        rejectReady(error);
      }
      if (error.code === 'STATUS_CANCELLED') return;
      record.status = error.code === 'STATUS_TIMEOUT' ? 'timeout' : 'status_error';
      record.observed_retry_count = observedRetries;
      record.error = error.message;
    }
  })();
  return { ready, task };
}

async function runSimulator(options, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch;
  const fixtures = dependencies.fixtures
    ? selectFixtures(dependencies.fixtures, options.count, options.seed)
    : selectFixtures(readFixtures(options.answerKeyPath, options.documentsDirectory), options.count, options.seed);

  for (const fixture of fixtures) {
    if (!fs.existsSync(fixture.documentPath)) {
      throw new Error(`Synthetic document is missing: ${fixture.documentPath}`);
    }
  }
  if (fs.existsSync(options.outputPath) && !options.overwrite) {
    throw new Error(`Output already exists; choose another --output path or pass --overwrite: ${options.outputPath}`);
  }

  const email = dependencies.email || process.env.SIMULATOR_EMAIL;
  const password = dependencies.password || process.env.SIMULATOR_PASSWORD;
  if (!email || !password) {
    throw new Error('Set SIMULATOR_EMAIL and SIMULATOR_PASSWORD to a synthetic API account.');
  }

  const login = await requestJson(fetchImpl, `${options.apiUrl}/auth/login`, {
    method: 'POST',
    contentType: 'application/json',
    body: { email, password },
  });
  if (typeof login.token !== 'string' || !login.token) {
    throw new Error('Login response did not include an access token.');
  }

  const records = [];
  const watchers = [];
  const intervalMs = 1000 / options.ratePerSecond;
  let nextSubmissionAt = Date.now();
  for (const fixture of fixtures) {
    const waitMs = nextSubmissionAt - Date.now();
    if (waitMs > 0) await sleep(waitMs);

    const record = asRecord(fixture, options.seed);
    records.push(record);
    record._submissionStartedMonotonic = performance.now();
    let observationController;
    let observer;
    try {
      const applicationId = await createApplication(fetchImpl, options.apiUrl, login.token, fixture, record);
      observationController = new AbortController();
      observer = observeFixture(
        fetchImpl,
        options.apiUrl,
        login.token,
        applicationId,
        fixture,
        record,
        options.timeoutSeconds,
        observationController.signal,
      );
      await observer.ready;
      await uploadDocument(fetchImpl, options.apiUrl, login.token, applicationId, fixture, record);
      watchers.push(observer.task);
    } catch (error) {
      observationController?.abort();
      if (observer) await observer.task;
      record.status = 'submission_error';
      record.error = error.message;
    }
    nextSubmissionAt = Date.now() + intervalMs;
  }

  await Promise.all(watchers);
  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  const csv = serializeCsv(records);
  fs.writeFileSync(options.outputPath, csv, { flag: options.overwrite ? 'w' : 'wx' });

  const savedCsv = fs.readFileSync(options.outputPath, 'utf8');
  return {
    outputPath: options.outputPath,
    summary: summarizeCsv(savedCsv),
  };
}

function helpText() {
  return `Usage: node eval/simulator/run.js [options]

Runs the synthetic marksheet traffic simulator against a running DocFlow API.
Create a synthetic account first, then set SIMULATOR_EMAIL and SIMULATOR_PASSWORD.

Options:
  --api-url URL              API base URL (default: SIMULATOR_API_URL or ${DEFAULTS.apiUrl})
  --count N                  Number of submissions, 1-1000 (default: 100)
  --seed N                   Deterministic fixture selection seed (default: 2027)
  --rate-per-second N        Maximum new submissions per second, 1-50 (default: 2)
  --timeout-seconds N        Per-document status timeout (default: 300)
  --answer-key PATH          Synthetic document answer-key CSV
  --documents-dir PATH       Directory containing matching generated PDFs or PNGs
  --output PATH              Raw results CSV (default: eval/results/realtime.csv)
  --overwrite                Replace the explicitly selected output CSV
  --help                     Show this help

Generate fixtures before running:
  python eval/pdf/generate_pdfs.py --seed 2027

For PNG fixtures, use --answer-key eval/data/answer_key.csv --documents-dir eval/data/images.
Only the status fields covered by the deterministic marksheet validator are
included in answer-match metrics. Unsupported planted mismatches are marked
not_evaluated; no authenticity or accuracy claim is produced.
`;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const { outputPath, summary } = await runSimulator(options);
  process.stdout.write(`${JSON.stringify({ output: outputPath, ...summary }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Simulator failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  expectedDecision,
  parseArguments,
  parseCsv,
  readFixtures,
  runSimulator,
  selectFixtures,
  serializeCsv,
  summarizeCsv,
};
