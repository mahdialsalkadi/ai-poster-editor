import { DesignError } from '@poster/core';

export function exportTimeout(): DesignError {
  return new DesignError('EXPORT_FAILED', 'The export request timed out', 'export');
}

export function checkExportDeadline(signal: AbortSignal): void {
  if (signal.aborted) throw exportTimeout();
}

/** Stop waiting for a result without claiming that underlying native work stopped. */
export function waitForExport<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(exportTimeout());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(exportTimeout());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
