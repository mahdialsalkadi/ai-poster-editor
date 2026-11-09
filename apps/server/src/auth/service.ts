import {
  createHash,
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { DesignError } from '@poster/core';

export const SESSION_COOKIE = 'poster_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_EARLY_MS = 60_000;
const JWKS_TTL_MS = 10 * 60_000;
const JWKS_RETRY_MS = 30_000;

export type AuthMethod = 'supabase' | 'api-key' | 'public';

export type AuthPrincipal = {
  id: string;
  method: AuthMethod;
  email?: string;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  email?: string;
};

export type AuthResult = {
  principal: AuthPrincipal;
  renewed?: AuthSession;
};

export type SupabaseConfig = {
  url: string;
  anonKey: string;
  jwtSecret?: string;
  fetchImpl?: typeof fetch;
};

export type AuthServiceOptions = {
  apiAccessKey?: string;
  cookieSecret?: string;
  supabase?: SupabaseConfig;
  publicOrigin?: string;
  now?: () => number;
};

type JwtHeader = { alg?: unknown; kid?: unknown; typ?: unknown };
type JwtClaims = {
  sub?: unknown;
  email?: unknown;
  exp?: unknown;
  iss?: unknown;
  aud?: unknown;
  role?: unknown;
};

type Jwks = {
  fetchedAt: number;
  keys: Map<string, KeyObject>;
};

function unauthorized(message = 'Authentication is required'): DesignError {
  return new DesignError('UNAUTHORIZED', message, 'authorization');
}

function forbidden(message: string): DesignError {
  return new DesignError('FORBIDDEN', message, 'authorization');
}

function decodeSegment(segment: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw unauthorized('Malformed access token');
  const value = Buffer.from(segment, 'base64url');
  if (value.byteLength > 32 * 1024) throw unauthorized('Malformed access token');
  return value;
}

function parseJson(value: Buffer): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw unauthorized('Malformed access token');
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(left, 'utf8').digest();
  const b = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(a, b);
}

function cookieHeader(value: string, secure: boolean, maxAgeSeconds: number): string {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export class AuthService {
  private readonly apiAccessKey: string | undefined;
  private readonly cookieKey: Buffer | undefined;
  private readonly supabase: SupabaseConfig | undefined;
  private readonly publicOrigin: string | undefined;
  private readonly now: () => number;
  private jwks: Jwks | null = null;
  private lastJwksFailure = 0;

  constructor(options: AuthServiceOptions) {
    this.apiAccessKey = options.apiAccessKey?.trim() || undefined;
    this.cookieKey = options.cookieSecret
      ? createHash('sha256').update(options.cookieSecret, 'utf8').digest()
      : undefined;
    this.supabase = options.supabase;
    this.publicOrigin = options.publicOrigin?.replace(/\/$/, '');
    this.now = options.now ?? Date.now;

    if (this.supabase && !this.cookieKey) {
      throw new Error('AUTH_COOKIE_SECRET is required when Supabase Auth is configured');
    }
  }

  get enabled(): boolean {
    return Boolean(this.apiAccessKey || this.supabase);
  }

  get supabaseEnabled(): boolean {
    return Boolean(this.supabase);
  }

  async authenticate(request: FastifyRequest): Promise<AuthResult> {
    const apiKey = request.headers['x-api-key'];
    if (typeof apiKey === 'string' && this.apiAccessKey) {
      if (!constantTimeEqual(apiKey, this.apiAccessKey)) {
        throw unauthorized('Invalid API access key');
      }
      return { principal: { id: 'api-key', method: 'api-key' } };
    }

    const authorization = request.headers.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
      const token = authorization.slice('Bearer '.length).trim();
      if (!token) throw unauthorized('Missing bearer token');
      const claims = await this.verifyAccessToken(token);
      return { principal: this.principalFromClaims(claims) };
    }

    const cookie = this.readCookie(request.headers.cookie);
    if (cookie) {
      this.assertOrigin(request);
      const claims = await this.verifyAccessToken(cookie.accessToken);
      const session =
        cookie.expiresAt - this.now() <= REFRESH_EARLY_MS
          ? await this.refresh(cookie.refreshToken)
          : undefined;
      if (session) {
        const refreshed = await this.verifyAccessToken(session.accessToken);
        return { principal: this.principalFromClaims(refreshed), renewed: session };
      }
      return { principal: this.principalFromClaims(claims) };
    }

    throw unauthorized();
  }

  async login(email: string, password: string): Promise<AuthSession> {
    if (!this.supabase) {
      throw new DesignError(
        'UNSUPPORTED_FEATURE',
        'Sign-in is not configured on this server: set SUPABASE_URL, SUPABASE_ANON_KEY and AUTH_COOKIE_SECRET',
        'auth',
      );
    }
    const response = await this.supabaseRequest(
      '/auth/v1/token?grant_type=password',
      { email, password },
      undefined,
    );
    if (!response.ok) {
      // Do not echo the provider body: it can distinguish unknown accounts.
      throw unauthorized('Invalid email or password');
    }
    return this.sessionFromResponse(await response.json());
  }

  async logout(accessToken: string | undefined): Promise<void> {
    if (!this.supabase || !accessToken) return;
    try {
      await this.supabaseRequest('/auth/v1/logout', {}, accessToken);
    } catch {
      // Local logout must still clear the cookie when the provider is unreachable.
    }
  }

  sessionCookie(session: AuthSession): string {
    if (!this.cookieKey) throw new Error('Session cookies are not configured');
    const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
    const mac = createHmac('sha256', this.cookieKey).update(payload).digest('base64url');
    const secure = process.env.NODE_ENV === 'production';
    return cookieHeader(`${payload}.${mac}`, secure, Math.floor(SESSION_MAX_AGE_MS / 1000));
  }

  clearCookie(): string {
    const secure = process.env.NODE_ENV === 'production';
    return cookieHeader('', secure, 0);
  }

  readCookie(header: string | undefined): AuthSession | null {
    if (!header || !this.cookieKey) return null;
    for (const part of header.split(';')) {
      const separator = part.indexOf('=');
      if (separator < 0) continue;
      if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
      const value = part.slice(separator + 1).trim();
      if (value.length > 8 * 1024) return null;
      const dot = value.lastIndexOf('.');
      if (dot <= 0) return null;
      const payload = value.slice(0, dot);
      const provided = Buffer.from(value.slice(dot + 1), 'base64url');
      const expected = createHmac('sha256', this.cookieKey).update(payload).digest();
      if (provided.byteLength !== expected.byteLength || !timingSafeEqual(provided, expected)) {
        return null;
      }
      try {
        const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (typeof parsed !== 'object' || parsed === null) return null;
        const session = parsed as Partial<AuthSession>;
        if (
          typeof session.accessToken !== 'string' ||
          typeof session.refreshToken !== 'string' ||
          typeof session.expiresAt !== 'number' ||
          typeof session.userId !== 'string' ||
          !Number.isFinite(session.expiresAt)
        ) {
          return null;
        }
        return {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          expiresAt: session.expiresAt,
          userId: session.userId,
          ...(typeof session.email === 'string' ? { email: session.email } : {}),
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  private assertOrigin(request: FastifyRequest): void {
    if (!this.publicOrigin) return;
    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    const origin = request.headers.origin;
    if (origin && origin.replace(/\/$/, '') !== this.publicOrigin) {
      throw forbidden('Cross-origin session request rejected');
    }
  }

  private principalFromClaims(claims: JwtClaims): AuthPrincipal {
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
      throw unauthorized('Access token has no subject');
    }
    return {
      id: claims.sub,
      method: 'supabase',
      ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
    };
  }

  private async verifyAccessToken(token: string): Promise<JwtClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw unauthorized('Malformed access token');
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = parseJson(decodeSegment(encodedHeader)) as JwtHeader;
    const claims = parseJson(decodeSegment(encodedPayload)) as JwtClaims;
    const signature = decodeSegment(encodedSignature);
    const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8');

    if (header.alg === 'HS256') {
      const secret = this.supabase?.jwtSecret;
      if (!secret) throw unauthorized('HS256 tokens are not configured');
      const expected = createHmac('sha256', secret).update(signingInput).digest();
      if (expected.byteLength !== signature.byteLength || !timingSafeEqual(expected, signature)) {
        throw unauthorized('Invalid access token signature');
      }
    } else if (header.alg === 'RS256' || header.alg === 'ES256') {
      const kid = typeof header.kid === 'string' ? header.kid : undefined;
      if (!kid) throw unauthorized('Access token has no key id');
      const key = await this.keyFor(kid);
      const options =
        header.alg === 'ES256' ? ({ key, dsaEncoding: 'ieee-p1363' } as const) : ({ key } as const);
      if (!verifySignature('sha256', signingInput, options, signature)) {
        throw unauthorized('Invalid access token signature');
      }
    } else {
      throw unauthorized('Unsupported access token algorithm');
    }

    const now = this.now();
    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
      throw unauthorized('Access token has no expiry');
    }
    if (claims.exp * 1000 <= now) throw unauthorized('Access token has expired');

    if (this.supabase) {
      const expectedIssuer = `${this.supabase.url.replace(/\/$/, '')}/auth/v1`;
      if (typeof claims.iss === 'string' && claims.iss !== expectedIssuer) {
        throw unauthorized('Access token has the wrong issuer');
      }
      const audience = claims.aud;
      const audiences = Array.isArray(audience) ? audience : [audience];
      if (!audiences.includes('authenticated')) {
        throw unauthorized('Access token has the wrong audience');
      }
    }
    return claims;
  }

  private async keyFor(kid: string): Promise<KeyObject> {
    const now = this.now();
    let jwks = this.jwks;
    const stale = !jwks || now - jwks.fetchedAt > JWKS_TTL_MS || !jwks.keys.has(kid);
    if (stale && now - this.lastJwksFailure > JWKS_RETRY_MS) {
      try {
        jwks = await this.fetchJwks();
        this.jwks = jwks;
      } catch (cause) {
        this.lastJwksFailure = now;
        throw new DesignError(
          'UNAUTHORIZED',
          'Access token verification is unavailable',
          'authorization',
          { reason: cause instanceof Error ? cause.message : 'unknown' },
        );
      }
    }
    const key = this.jwks?.keys.get(kid);
    if (!key) throw unauthorized('Unknown access token key');
    return key;
  }

  private async fetchJwks(): Promise<Jwks> {
    if (!this.supabase) throw new Error('Supabase is not configured');
    const response = await (this.supabase.fetchImpl ?? fetch)(
      `${this.supabase.url.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`,
      { headers: { accept: 'application/json' } },
    );
    if (!response.ok) throw new Error(`JWKS request failed with HTTP ${response.status}`);
    const body = (await response.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys)) throw new Error('JWKS response has no keys');
    const keys = new Map<string, KeyObject>();
    for (const value of body.keys) {
      if (typeof value !== 'object' || value === null) continue;
      const jwk = value as Record<string, unknown>;
      if (typeof jwk.kid !== 'string' || typeof jwk.kty !== 'string') continue;
      try {
        keys.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
      } catch {
        // Skip malformed keys; the requested kid will fail closed.
      }
    }
    return { fetchedAt: this.now(), keys };
  }

  private async refresh(refreshToken: string): Promise<AuthSession> {
    if (!this.supabase) throw unauthorized('Session has expired');
    const response = await this.supabaseRequest(
      '/auth/v1/token?grant_type=refresh_token',
      { refresh_token: refreshToken },
      undefined,
    );
    if (!response.ok) throw unauthorized('Session has expired; sign in again');
    return this.sessionFromResponse(await response.json());
  }

  private sessionFromResponse(body: unknown): AuthSession {
    if (typeof body !== 'object' || body === null) throw unauthorized('Invalid sign-in response');
    const value = body as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
      user?: { id?: unknown; email?: unknown };
    };
    if (
      typeof value.access_token !== 'string' ||
      typeof value.refresh_token !== 'string' ||
      typeof value.expires_in !== 'number' ||
      typeof value.user?.id !== 'string'
    ) {
      throw unauthorized('Invalid sign-in response');
    }
    return {
      accessToken: value.access_token,
      refreshToken: value.refresh_token,
      expiresAt: this.now() + value.expires_in * 1000,
      userId: value.user.id,
      ...(typeof value.user.email === 'string' ? { email: value.user.email } : {}),
    };
  }

  private supabaseRequest(
    path: string,
    body: Record<string, unknown>,
    accessToken: string | undefined,
  ): Promise<Response> {
    if (!this.supabase) throw new Error('Supabase is not configured');
    const headers: Record<string, string> = {
      apikey: this.supabase.anonKey,
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (accessToken) headers.authorization = `Bearer ${accessToken}`;
    return (this.supabase.fetchImpl ?? fetch)(`${this.supabase.url.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }
}

/**
 * Reads auth configuration. Returns `null` for an explicitly public server.
 * Throws when a configuration is internally incomplete.
 */
export function createAuthFromEnv(env: NodeJS.ProcessEnv): AuthService | null {
  const apiAccessKey = env.API_ACCESS_KEY?.trim() || undefined;
  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/$/, '') || undefined;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY?.trim() || undefined;
  const jwtSecret = env.SUPABASE_JWT_SECRET?.trim() || undefined;

  if (!apiAccessKey && !supabaseUrl) return null;
  if (supabaseUrl && !supabaseAnonKey) {
    throw new Error('SUPABASE_ANON_KEY is required when SUPABASE_URL is set');
  }
  if (supabaseUrl && !env.AUTH_COOKIE_SECRET) {
    throw new Error('AUTH_COOKIE_SECRET is required when Supabase Auth is configured');
  }
  if (env.AUTH_COOKIE_SECRET && env.AUTH_COOKIE_SECRET.length < 32) {
    throw new Error('AUTH_COOKIE_SECRET must be at least 32 characters');
  }

  return new AuthService({
    ...(apiAccessKey ? { apiAccessKey } : {}),
    ...(supabaseUrl && supabaseAnonKey
      ? {
          supabase: {
            url: supabaseUrl,
            anonKey: supabaseAnonKey,
            ...(jwtSecret ? { jwtSecret } : {}),
          },
        }
      : {}),
    ...(env.AUTH_COOKIE_SECRET ? { cookieSecret: env.AUTH_COOKIE_SECRET } : {}),
    ...(env.PUBLIC_ORIGIN ? { publicOrigin: env.PUBLIC_ORIGIN } : {}),
  });
}

/** Production must either configure access control or opt out explicitly. */
export function assertProductionAuth(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'production' || env.ALLOW_PUBLIC_API === 'true') return;
  if (!env.API_ACCESS_KEY?.trim() && !env.SUPABASE_URL?.trim()) {
    throw new Error(
      'Refusing to start in production without API_ACCESS_KEY or Supabase Auth. Set ALLOW_PUBLIC_API=true to run an intentionally public API.',
    );
  }
  if (!env.PUBLIC_ORIGIN?.trim()) {
    throw new Error('PUBLIC_ORIGIN is required in production when access control is enabled');
  }
}
