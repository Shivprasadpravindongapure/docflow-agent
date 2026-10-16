import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import DocumentStatus from './DocumentStatus';

let cancelStream: (() => void) | undefined;

afterEach(() => {
  cleanup();
  cancelStream?.();
  cancelStream = undefined;
  vi.unstubAllGlobals();
});

it('updates the displayed decision from status events without reconnecting', async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let cancelled = false;
      controller.enqueue(
        encoder.encode(
          'event: status\ndata: {"application_id":"synthetic-app","status":"queued","updated_at":"2026-10-16T08:30:00.000Z"}\n\n',
        ),
      );
      const timer = window.setTimeout(() => {
        if (cancelled) return;
        controller.enqueue(
          encoder.encode(
            'event: status\ndata: {"application_id":"synthetic-app","status":"needs_review","updated_at":"2026-10-16T08:31:00.000Z"}\n\n',
          ),
        );
      }, 25);
      cancelStream = () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    },
  });
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(stream, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);

  render(
    <DocumentStatus
      applicationId="synthetic-app"
      initialStatus="queued"
      token="synthetic-session-token"
    />,
  );

  expect(await screen.findByText('Needs review')).toBeVisible();
  expect(screen.getByText('Live updates: Live')).toBeVisible();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('does not apply events for a different application', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          'event: status\ndata: {"application_id":"another-app","status":"verified","updated_at":"2026-10-16T08:30:00.000Z"}\n\n',
        ),
      );
    },
    cancel() {},
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(stream, {
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      }),
    ),
  );

  render(
    <DocumentStatus
      applicationId="synthetic-app"
      initialStatus="queued"
      token="synthetic-session-token"
    />,
  );

  expect(await screen.findByText('Live updates: Live')).toBeVisible();
  expect(screen.getByText('Queued')).toBeVisible();
});
