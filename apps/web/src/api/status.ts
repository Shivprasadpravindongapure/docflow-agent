export const APPLICATION_STATUSES = [
  'draft',
  'queued',
  'processing',
  'retry',
  'verified',
  'needs_review',
  'missing',
  'failed',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export interface StatusEvent {
  application_id: string;
  status: ApplicationStatus;
  updated_at: string;
}

function isStatusEvent(value: unknown): value is StatusEvent {
  if (typeof value !== 'object' || value === null) return false;
  if (!('application_id' in value) || typeof value.application_id !== 'string') return false;
  if (!('status' in value) || typeof value.status !== 'string') return false;
  if (!APPLICATION_STATUSES.some((status) => status === value.status)) return false;
  if (!('updated_at' in value) || typeof value.updated_at !== 'string') return false;
  return Number.isFinite(Date.parse(value.updated_at));
}

export async function consumeStatusEvents(
  response: Response,
  onStatus: (event: StatusEvent) => void,
): Promise<void> {
  if (!response.ok) throw new Error(`Status stream failed with status ${response.status}.`);
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error('The API did not return an event stream.');
  }
  if (!response.body) throw new Error('The API status stream has no response body.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    let frameEnd = buffer.indexOf('\n\n');
    while (frameEnd !== -1) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      const eventName = frame
        .split('\n')
        .find((line) => line.startsWith('event:'))
        ?.slice('event:'.length)
        .trim();
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trimStart())
        .join('\n');

      if (eventName === 'status') {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch (error) {
          throw new Error('The API returned invalid status event JSON.', { cause: error });
        }
        if (!isStatusEvent(parsed)) throw new Error('The API returned an invalid status event.');
        onStatus(parsed);
      }
      frameEnd = buffer.indexOf('\n\n');
    }
  }
}
