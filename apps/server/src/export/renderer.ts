import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ExportOptions } from '@poster/contracts';
import { DesignError, LIMITS, type DesignDoc, type ErrorCode } from '@poster/core';
import { serializeForExport, type ExportAssets } from './serialize.js';
import type { BrowserRenderJob, RenderedExport } from './renderer-core.js';
import type { RemoteRenderJob } from './worker-protocol.js';

const ERROR_CODES = new Set<ErrorCode>([
  'SECURITY_VIOLATION',
  'INVALID_DOC',
  'LIMIT_EXCEEDED',
  'UNSUPPORTED_FEATURE',
  'DUPLICATE_ID',
  'ASSET_UNRESOLVED',
  'EXPORT_FAILED',
  'AI_INVALID_OUTPUT',
  'SPEND_CAP_EXCEEDED',
  'RATE_LIMITED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INTERNAL_ERROR',
]);

/** Only non-secret values needed by Node/Playwright are forwarded to the worker. */
const WORKER_ENV_KEYS = ['HOME', 'TMPDIR', 'TMP', 'TEMP', 'PLAYWRIGHT_BROWSERS_PATH'] as const;

export function workerEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of WORKER_ENV_KEYS) {
    const value = source[key];
    if (value) environment[key] = value;
  }
  return environment;
}

type Pending = {
  resolve: (result: RenderedExport) => void;
  reject: (cause: DesignError) => void;
  timer: NodeJS.Timeout;
};

type WorkerReply =
  | {
      type: 'result';
      id: number;
      result: { bytes: Buffer | Uint8Array; width: number; height: number; contentType: string };
    }
  | {
      type: 'error';
      id: number;
      error: { code: unknown; message: unknown; path?: unknown };
    };

export type ExportWorkerOptions = {
  timeoutMs?: number;
  /** Test seam: override the worker module and its Node arguments. */
  entry?: string;
  args?: string[];
  execArgv?: string[];
  sandbox?: boolean;
  heapMb?: number;
};

function resolveEntry(heapMb: number): { path: string; execArgv: string[] } {
  const heap = `--max-old-space-size=${heapMb}`;
  const compiled = fileURLToPath(new URL('./worker-entry.js', import.meta.url));
  if (existsSync(compiled)) return { path: compiled, execArgv: [heap] };
  return {
    path: fileURLToPath(new URL('./worker-entry.ts', import.meta.url)),
    execArgv: [heap, '--import', 'tsx'],
  };
}

function isReply(value: unknown): value is WorkerReply {
  if (typeof value !== 'object' || value === null) return false;
  const reply = value as Partial<WorkerReply>;
  return (reply.type === 'result' || reply.type === 'error') && typeof reply.id === 'number';
}

/**
 * A single long-lived renderer process. Jobs are serialized, each one has a
 * total deadline, and a timeout/crash kills the whole process group so Chromium
 * children cannot survive. The next job starts a fresh worker.
 */
export class ExportWorker {
  private child: ChildProcess | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly timeoutMs: number;
  private readonly entry: { path: string; args: string[]; execArgv: string[] };
  private readonly sandbox: boolean;
  private readonly heapMb: number;

  constructor(options: ExportWorkerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? LIMITS.export.timeoutMs;
    this.heapMb = options.heapMb ?? LIMITS.export.workerHeapMb;
    this.entry = options.entry
      ? {
          path: options.entry,
          args: options.args ?? [],
          execArgv: options.execArgv ?? [`--max-old-space-size=${this.heapMb}`],
        }
      : { ...resolveEntry(this.heapMb), args: [] };
    this.sandbox = options.sandbox ?? process.env.EXPORT_CHROMIUM_SANDBOX !== 'false';
  }

  render(job: BrowserRenderJob): Promise<RenderedExport> {
    const run = (): Promise<RenderedExport> => this.runOnce(job);
    const result = this.tail.then(run, run);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private runOnce(job: BrowserRenderJob): Promise<RenderedExport> {
    if (this.closed) {
      return Promise.reject(
        new DesignError('EXPORT_FAILED', 'The export worker is closed', 'export'),
      );
    }
    const child = this.ensureChild();
    const id = this.nextId;
    this.nextId += 1;

    return new Promise<RenderedExport>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.killChild();
        reject(new DesignError('EXPORT_FAILED', 'The export worker timed out', 'export'));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        child.send({ type: 'render', id, job });
      } catch (cause) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.killChild();
        reject(
          new DesignError('EXPORT_FAILED', 'The export worker could not be reached', 'export', {
            reason: cause instanceof Error ? cause.message : 'unknown',
          }),
        );
      }
    });
  }

  private ensureChild(): ChildProcess {
    if (this.child) return this.child;
    const child = fork(this.entry.path, this.entry.args, {
      env: workerEnvironment(),
      execArgv: this.entry.execArgv,
      detached: process.platform !== 'win32',
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    this.child = child;
    child.on('message', (message: unknown) => this.handleMessage(message));
    child.on('exit', () => this.handleExit());
    child.on('error', () => this.handleExit());
    // Drain stderr so a noisy child cannot block on a full pipe.
    child.stderr?.resume();
    return child;
  }

  private handleMessage(message: unknown): void {
    if (!isReply(message)) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);

    if (message.type === 'result') {
      const { bytes, width, height, contentType } = message.result;
      if (
        (bytes instanceof Uint8Array || Buffer.isBuffer(bytes)) &&
        typeof width === 'number' &&
        typeof height === 'number' &&
        typeof contentType === 'string'
      ) {
        pending.resolve({ bytes: Buffer.from(bytes), width, height, contentType });
        return;
      }
      pending.reject(
        new DesignError('EXPORT_FAILED', 'The export worker returned an invalid result', 'export'),
      );
      return;
    }

    const code =
      typeof message.error.code === 'string' && ERROR_CODES.has(message.error.code as ErrorCode)
        ? (message.error.code as ErrorCode)
        : 'EXPORT_FAILED';
    const text =
      typeof message.error.message === 'string'
        ? message.error.message
        : 'The export worker failed';
    const path = typeof message.error.path === 'string' ? message.error.path : 'export';
    pending.reject(new DesignError(code, text, path));
  }

  private handleExit(): void {
    this.child = null;
    const error = new DesignError(
      'EXPORT_FAILED',
      'The export worker exited unexpectedly',
      'export',
    );
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private killChild(): void {
    const child = this.child;
    this.child = null;
    if (!child?.pid) return;
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const error = new DesignError('EXPORT_FAILED', 'The export worker is closed', 'export');
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.killChild();
    await this.tail.catch(() => undefined);
  }
}

let shared: ExportWorker | null = null;

function worker(): ExportWorker {
  shared ??= new ExportWorker();
  return shared;
}

function remoteCode(value: unknown): ErrorCode {
  return typeof value === 'string' && ERROR_CODES.has(value as ErrorCode)
    ? (value as ErrorCode)
    : 'EXPORT_FAILED';
}

/**
 * Sends a job to the HTTP worker container. This path exists for deployments
 * where the renderer must be a separate, no-egress container.
 */
export async function renderRemote(
  job: RemoteRenderJob,
  url: string,
  options: { token?: string; timeoutMs?: number } = {},
): Promise<RenderedExport> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? LIMITS.export.timeoutMs);
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/render`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/octet-stream',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: JSON.stringify(job),
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const error =
        typeof payload === 'object' && payload !== null && 'error' in payload
          ? (payload as { error?: { code?: unknown; message?: unknown; path?: unknown } }).error
          : undefined;
      throw new DesignError(
        remoteCode(error?.code),
        typeof error?.message === 'string' ? error.message : 'The export worker failed',
        typeof error?.path === 'string' ? error.path : 'export',
      );
    }
    const width = Number(response.headers.get('x-export-width'));
    const height = Number(response.headers.get('x-export-height'));
    const contentType = response.headers.get('content-type');
    if (!Number.isInteger(width) || !Number.isInteger(height) || !contentType) {
      throw new DesignError(
        'EXPORT_FAILED',
        'The export worker returned an invalid result',
        'export',
      );
    }
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      width,
      height,
      contentType,
    };
  } catch (cause) {
    if (cause instanceof DesignError) throw cause;
    throw new DesignError(
      'EXPORT_FAILED',
      controller.signal.aborted
        ? 'The export worker timed out'
        : 'The export worker could not be reached',
      'export',
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends the serialized document to the renderer process. HTML exports are pure
 * serialization and never start a browser.
 */
export async function renderDesign(input: {
  doc: DesignDoc;
  assets: ExportAssets;
  options: ExportOptions;
}): Promise<RenderedExport> {
  const { doc, assets, options } = input;
  const html = serializeForExport(doc, assets);

  if (options.format === 'html') {
    return {
      bytes: Buffer.from(html, 'utf8'),
      width: doc.width,
      height: doc.height,
      contentType: 'text/html; charset=utf-8',
    };
  }

  const job: RemoteRenderJob = {
    html,
    width: doc.width,
    height: doc.height,
    format: options.format,
    scale: options.scale,
    quality: options.quality,
  };
  const remote = process.env.EXPORT_WORKER_URL?.trim();
  if (remote) {
    const token = process.env.EXPORT_WORKER_TOKEN?.trim() || undefined;
    return renderRemote(job, remote, {
      timeoutMs: LIMITS.export.timeoutMs,
      ...(token ? { token } : {}),
    });
  }
  return worker().render({
    ...job,
    sandbox: process.env.EXPORT_CHROMIUM_SANDBOX !== 'false',
  });
}

export async function closeExportBrowser(): Promise<void> {
  const current = shared;
  shared = null;
  await current?.close();
}
