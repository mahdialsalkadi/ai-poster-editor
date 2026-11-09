import type { FastifyInstance } from 'fastify';
import { EXPORT_LIMITS, exportRequestSchema, type ExportRequest } from '@poster/contracts';
import { LIMITS, canonicalizeDoc, DesignError } from '@poster/core';
import type { ExportService } from '../export/service.js';
import { requestIdOf } from '../errors.js';

const EXTENSIONS = { png: 'png', jpeg: 'jpg', pdf: 'pdf', html: 'html' } as const;

type MultipartFailure = { code?: unknown; statusCode?: unknown };

function isMultipartLimit(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false;
  const { code, statusCode } = cause as MultipartFailure;
  if (typeof code === 'string' && code.startsWith('FST_')) return true;
  return statusCode === 413;
}

function assetName(fieldname: string): string {
  return fieldname.startsWith('asset:') ? fieldname.slice('asset:'.length) : fieldname;
}

/**
 * `POST /api/export` takes multipart fields `options` and `doc` plus one binary
 * part per referenced asset (`asset:<id>`). See docs/contract.md §12.1.
 */
export function exportRoutes(options: { service: ExportService }) {
  return async (app: FastifyInstance): Promise<void> => {
    const { service } = options;

    app.post('/export', async (request, reply) => {
      if (!request.isMultipart()) {
        throw new DesignError('INVALID_DOC', 'Export requires multipart/form-data', 'body');
      }

      const fields = new Map<string, unknown>();
      const uploaded = new Map<string, Buffer>();
      let totalBytes = 0;
      let body: ExportRequest | null = null;

      // The document is validated before any asset byte is decoded: both text
      // fields are sent before the binary parts, and `parseFields` runs as soon
      // as they are both present.
      // A part sent as `application/json` arrives already decoded; a plain text
      // part arrives as a string and is parsed here.
      const decodeField = (name: 'options' | 'doc'): unknown => {
        const value = fields.get(name);
        if (value === undefined) {
          throw new DesignError(
            'INVALID_DOC',
            'Export requires the options and doc fields',
            'body',
          );
        }
        if (typeof value !== 'string') return value;
        try {
          return JSON.parse(value);
        } catch {
          throw new DesignError('INVALID_DOC', 'The options and doc fields must be JSON', 'body');
        }
      };

      const parseFields = (): ExportRequest => {
        if (body) return body;
        const parsed: unknown = { options: decodeField('options'), doc: decodeField('doc') };
        const parsedRequest = exportRequestSchema.parse(parsed);
        canonicalizeDoc(parsedRequest.doc);
        body = parsedRequest;
        return parsedRequest;
      };

      try {
        for await (const part of request.parts()) {
          if (part.type === 'field') {
            if (part.fieldname !== 'options' && part.fieldname !== 'doc') continue;
            if (fields.has(part.fieldname)) {
              throw new DesignError(
                'INVALID_DOC',
                `The ${part.fieldname} field was sent twice`,
                part.fieldname,
              );
            }
            fields.set(part.fieldname, part.value);
            if (fields.has('options') && fields.has('doc')) parseFields();
            continue;
          }

          // A malformed document must fail before asset bytes are copied.
          parseFields();

          const id = assetName(part.fieldname);
          if (uploaded.has(id)) {
            throw new DesignError('DUPLICATE_ID', `Asset ${id} was uploaded twice`, `assets.${id}`);
          }
          if (uploaded.size >= LIMITS.export.maxAssets) {
            throw new DesignError(
              'LIMIT_EXCEEDED',
              `At most ${LIMITS.export.maxAssets} assets can be exported`,
              'assets',
            );
          }
          const buffer = await part.toBuffer();
          totalBytes += buffer.byteLength;
          if (totalBytes > LIMITS.export.maxRequestBytes) {
            throw new DesignError(
              'LIMIT_EXCEEDED',
              'The export request exceeds the request size limit',
              'assets',
            );
          }
          uploaded.set(id, buffer);
        }
      } catch (cause) {
        if (cause instanceof DesignError) throw cause;
        if (isMultipartLimit(cause)) {
          throw new DesignError(
            'LIMIT_EXCEEDED',
            'The export request exceeds a multipart limit',
            'assets',
          );
        }
        throw cause;
      }

      const parsedRequest = parseFields();
      const result = await service.export(parsedRequest, uploaded);

      return reply
        .header('content-type', result.contentType)
        .header('content-length', String(result.bytes.byteLength))
        .header('content-disposition', `attachment; filename="poster.${EXTENSIONS[result.format]}"`)
        .header('cache-control', 'no-store')
        .header('x-export-id', result.id)
        .header('x-export-width', String(result.width))
        .header('x-export-height', String(result.height))
        .header('x-export-duration-ms', String(result.durationMs))
        .header('x-export-cache', result.cacheHit ? 'hit' : 'miss')
        .header('x-request-id', requestIdOf(request))
        .send(result.bytes);
    });

    app.get('/export/limits', async (request) => ({
      data: EXPORT_LIMITS,
      requestId: requestIdOf(request),
    }));
  };
}
