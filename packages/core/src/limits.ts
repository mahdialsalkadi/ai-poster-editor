/**
 * Central security and resource limits.
 *
 * These values are intentionally conservative. Every limit must be enforced by
 * the parser, validator, exporter, or API layer that owns the resource, and
 * must have a corresponding rejection/limit test.
 */
export const LIMITS = {
  document: {
    maxBytes: 200 * 1024,
    maxLayers: 200,
    maxArtboardSide: 5_000,
    minArtboardSide: 100,
    maxArtboardPixels: 25_000_000,
    maxLayerIdLength: 64,
    maxLayerNameLength: 120,
  },
  ai: {
    maxRequestBytes: 512 * 1024,
    maxOutputBytes: 128 * 1024,
    maxLayers: 60,
    maxOutputTokens: 16_000,
    timeoutMs: 60_000,
    retries: 1,
  },
  text: {
    maxCodepointsPerLayer: 10_000,
    maxInlineNodesPerLayer: 1_000,
    maxFontSize: 1_000,
    minFontSize: 1,
    maxLetterSpacing: 1_000,
    minLetterSpacing: -100,
  },
  style: {
    maxDeclarationsPerLayer: 64,
    maxBytes: 8 * 1024,
  },
  gradient: {
    minStops: 2,
    maxStops: 6,
  },
  svg: {
    maxDepth: 16,
    maxNodes: 2_000,
    maxPathLength: 20_000,
    maxAttrsPerNode: 32,
    maxViewBoxLength: 200,
  },
  assets: {
    maxPerDocument: 20,
    maxBytesPerAsset: 10 * 1024 * 1024,
    maxDimension: 8_000,
    maxPixelsPerAsset: 40_000_000,
    maxTotalPixels: 80_000_000,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] as const,
  },
  export: {
    timeoutMs: 15_000,
    maxRequestBytes: 40 * 1024 * 1024,
    maxResponseBytes: 40 * 1024 * 1024,
    maxOutputPixels: 40_000_000,
    maxAssets: 20,
    queueMax: 20,
    concurrency: 2,
  },
  history: {
    maxSteps: 100,
  },
  snapshots: {
    maxPerProject: 20,
  },
  rateLimit: {
    aiGeneratePerMinutePerIp: 5,
    aiGeneratePerHourPerSession: 20,
    aiEditPerMinutePerIp: 10,
    exportPerMinutePerIp: 10,
    uploadPerMinutePerIp: 20,
  },
} as const;

export type Limits = typeof LIMITS;
