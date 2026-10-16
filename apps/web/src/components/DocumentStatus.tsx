import { useEffect, useState } from 'react';

import { API_BASE_URL } from '../api/client';
import {
  consumeStatusEvents,
  type ApplicationStatus as StatusValue,
} from '../api/status';

const statusLabels: Record<StatusValue, string> = {
  draft: 'Draft',
  queued: 'Queued',
  processing: 'Processing',
  retry: 'Retrying',
  verified: 'Verified',
  needs_review: 'Needs review',
  missing: 'Missing information',
  failed: 'Processing failed',
};

interface DocumentStatusProps {
  applicationId: string;
  initialStatus: string;
  token: string;
}

function isStatus(value: string): value is StatusValue {
  return Object.hasOwn(statusLabels, value);
}

export default function DocumentStatus({
  applicationId,
  initialStatus,
  token,
}: DocumentStatusProps) {
  const [status, setStatus] = useState<StatusValue>(
    isStatus(initialStatus) ? initialStatus : 'draft',
  );
  const [connection, setConnection] = useState('Connecting');
  const [connectionError, setConnectionError] = useState('');

  useEffect(() => {
    let stopped = false;
    let controller: AbortController | undefined;
    let retryTimer: number | undefined;
    let retryDelay = 1000;

    const connect = async () => {
      if (stopped) return;
      controller = new AbortController();
      setConnection(retryDelay === 1000 ? 'Connecting' : 'Reconnecting');

      try {
        const response = await fetch(
          `${API_BASE_URL}/applications/${encodeURIComponent(applicationId)}/status/events`,
          {
            headers: {
              Accept: 'text/event-stream',
              Authorization: `Bearer ${token}`,
            },
            cache: 'no-store',
            signal: controller.signal,
          },
        );

        if (response.status === 401 || response.status === 403 || response.status === 404) {
          setConnection('Unavailable');
          setConnectionError('This application status is not available to this account.');
          return;
        }

        await consumeStatusEvents(response, (event) => {
          setConnection('Live');
          if (event.application_id !== applicationId) return;
          setStatus(event.status);
          setConnectionError('');
        });
        if (!stopped) setConnection('Reconnecting');
      } catch (error) {
        if (stopped || controller?.signal.aborted) return;
        setConnection('Reconnecting');
        setConnectionError(
          error instanceof Error ? error.message : 'The status connection was interrupted.',
        );
      }

      if (!stopped) {
        retryTimer = window.setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, 15000);
          void connect();
        }, retryDelay);
      }
    };

    void connect();
    return () => {
      stopped = true;
      controller?.abort();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [applicationId, token]);

  const terminal = status === 'verified' || status === 'needs_review' || status === 'missing' || status === 'failed';
  const statusColor =
    status === 'verified'
      ? 'bg-emerald-50 text-emerald-800'
      : status === 'failed'
        ? 'bg-red-50 text-red-800'
        : terminal
          ? 'bg-amber-50 text-amber-900'
          : 'bg-sky-50 text-sky-800';

  return (
    <section
      aria-label={`Application ${applicationId} status`}
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Application
          </p>
          <p className="mt-1 font-mono text-sm text-slate-700">{applicationId}</p>
        </div>
        <span
          aria-label={`Status: ${statusLabels[status]}`}
          className={`rounded-full px-3 py-1 text-sm font-semibold ${statusColor}`}
        >
          {statusLabels[status]}
        </span>
      </div>
      <div className="mt-4 flex items-center gap-2 text-sm text-slate-600">
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${connection === 'Live' ? 'bg-emerald-500' : 'bg-amber-500'}`}
        />
        <span>Live updates: {connection}</span>
      </div>
      {connectionError && (
        <p role="status" className="mt-2 text-sm text-amber-800">
          {connectionError}
        </p>
      )}
      {status === 'needs_review' && (
        <p className="mt-3 text-sm text-slate-600">
          A reviewer should check the flagged fields. Documents are never auto-rejected.
        </p>
      )}
    </section>
  );
}
