import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/app.js';
import {
  assertProductionAuth,
  AuthService,
  createAuthFromEnv,
  SESSION_COOKIE,
} from '../src/auth/service.js';

const SUPABASE_URL = 'https://project.supabase.co';
const JWT_SECRET = 'test-jwt-secret-with-enough-entropy';
const COOKIE_SECRET = 'test-cookie-secret-with-at-least-32-chars';

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function jwt(claims: Record<string, unknown>, secret = JWT_SECRET): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify(claims));
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function accessToken(expSeconds: number, sub = '8f3c2a10-0000-4000-8000-000000000001'): string {
  return jwt({
    sub,
    email: 'poster@example.com',
    aud: 'authenticated',
    iss: `${SUPABASE_URL}/auth/v1`,
    exp: expSeconds,
  });
}

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') throw new Error('No set-cookie header');
  return value.split(';')[0]!;
}

describe('access control', () => {
  it('refuses production startup without access control and allows an explicit public API', () => {
    expect(() => assertProductionAuth({ NODE_ENV: 'production' })).toThrow(/Refusing to start/);
    expect(() =>
      assertProductionAuth({ NODE_ENV: 'production', ALLOW_PUBLIC_API: 'true' }),
    ).not.toThrow();
    expect(() =>
      assertProductionAuth({
        NODE_ENV: 'production',
        API_ACCESS_KEY: 'secret',
        PUBLIC_ORIGIN: 'https://editor.example',
      }),
    ).not.toThrow();
    expect(() =>
      assertProductionAuth({ NODE_ENV: 'production', API_ACCESS_KEY: 'secret' }),
    ).toThrow(/PUBLIC_ORIGIN/);
    expect(() => assertProductionAuth({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('rejects incomplete Supabase configuration', () => {
    expect(() => createAuthFromEnv({ SUPABASE_URL })).toThrow(/SUPABASE_ANON_KEY/);
    expect(() => createAuthFromEnv({ SUPABASE_URL, SUPABASE_ANON_KEY: 'anon' })).toThrow(
      /AUTH_COOKIE_SECRET/,
    );
    expect(() =>
      createAuthFromEnv({
        SUPABASE_URL,
        SUPABASE_ANON_KEY: 'anon',
        AUTH_COOKIE_SECRET: 'short',
      }),
    ).toThrow(/32 characters/);
  });

  describe('API key', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = await buildServer({
        logger: false,
        auth: createAuthFromEnv({ API_ACCESS_KEY: 'correct-horse-battery-staple' }),
        publicOrigin: 'https://editor.example',
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('rejects protected routes without a key', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/export/limits' });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHORIZED');
      expect(response.json().error.requestId).toBeTruthy();
    });

    it('rejects a wrong key and accepts the configured key', async () => {
      const denied = await app.inject({
        method: 'GET',
        url: '/api/export/limits',
        headers: { 'x-api-key': 'wrong-key' },
      });
      expect(denied.statusCode).toBe(401);

      const allowed = await app.inject({
        method: 'GET',
        url: '/api/export/limits',
        headers: { 'x-api-key': 'correct-horse-battery-staple' },
      });
      expect(allowed.statusCode).toBe(200);
    });

    it('keeps health public', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(200);
    });

    it('rate limits design routes by principal and address', async () => {
      const limited = await buildServer({
        logger: false,
        auth: createAuthFromEnv({ API_ACCESS_KEY: 'k' }),
        rateLimits: { designPerMinute: 1 },
      });
      try {
        const first = await limited.inject({
          method: 'POST',
          url: '/api/design/validate',
          headers: { 'x-api-key': 'k' },
          payload: {
            designHtml: '<div class="artboard" data-width="100px" data-height="100px"></div>',
          },
        });
        expect(first.statusCode).toBe(200);
        const second = await limited.inject({
          method: 'POST',
          url: '/api/design/validate',
          headers: { 'x-api-key': 'k' },
          payload: {
            designHtml: '<div class="artboard" data-width="100px" data-height="100px"></div>',
          },
        });
        expect(second.statusCode).toBe(429);
        expect(second.json().error.code).toBe('RATE_LIMITED');
      } finally {
        await limited.close();
      }
    });
  });

  describe('Supabase sessions', () => {
    const now = 1_800_000_000_000;
    let service: AuthService;
    let app: FastifyInstance;

    beforeAll(async () => {
      const fetchImpl = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('grant_type=password')) {
          return new Response(
            JSON.stringify({
              access_token: accessToken(Math.floor(now / 1000) + 3_600, 'user-1'),
              refresh_token: 'refresh-token-1',
              expires_in: 3_600,
              user: { id: 'user-1', email: 'poster@example.com' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.includes('grant_type=refresh_token')) {
          return new Response(
            JSON.stringify({
              access_token: accessToken(Math.floor(now / 1000) + 7_200, 'user-1'),
              refresh_token: 'refresh-token-2',
              expires_in: 7_200,
              user: { id: 'user-1', email: 'poster@example.com' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 404 });
      }) as typeof fetch;

      service = new AuthService({
        supabase: { url: SUPABASE_URL, anonKey: 'anon-key', jwtSecret: JWT_SECRET, fetchImpl },
        cookieSecret: COOKIE_SECRET,
        publicOrigin: 'https://editor.example',
        now: () => now,
      });
      app = await buildServer({
        logger: false,
        auth: service,
        publicOrigin: 'https://editor.example',
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('signs in, sets an HttpOnly cookie and resolves the current user', async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'poster@example.com', password: 'correct' },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json().data.user).toEqual({
        id: 'user-1',
        email: 'poster@example.com',
        method: 'supabase',
      });
      const setCookie = String(login.headers['set-cookie']);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');

      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: cookieOf(login), origin: 'https://editor.example' },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json().data.user.id).toBe('user-1');
    });

    it('refreshes an expiring session and rotates the cookie', async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'poster@example.com', password: 'correct' },
      });
      const shortLived = service.readCookie(cookieOf(login));
      expect(shortLived).not.toBeNull();
      // The login response has a one-hour token, so force the cookie near expiry.
      const forced = service.sessionCookie({ ...shortLived!, expiresAt: now + 5_000 });
      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: forced, origin: 'https://editor.example' },
      });
      expect(me.statusCode).toBe(200);
      expect(String(me.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=`);
      expect(service.readCookie(cookieOf(me))?.refreshToken).toBe('refresh-token-2');
    });

    it('rejects tampered cookies, wrong signatures and cross-origin session writes', async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'poster@example.com', password: 'correct' },
      });
      const cookie = cookieOf(login);
      const separator = cookie.indexOf('=');
      const payload = cookie.slice(separator + 1);
      const tampered =
        cookie.slice(0, separator + 1) +
        payload.slice(0, 12) +
        (payload[12] === 'a' ? 'b' : 'a') +
        payload.slice(13);
      const badCookie = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: tampered },
      });
      expect(badCookie.statusCode).toBe(401);

      const crossOrigin = await app.inject({
        method: 'POST',
        url: '/api/design/validate',
        headers: { cookie, origin: 'https://evil.example' },
        payload: {
          designHtml: '<div class="artboard" data-width="100px" data-height="100px"></div>',
        },
      });
      expect(crossOrigin.statusCode).toBe(403);
      expect(crossOrigin.json().error.code).toBe('FORBIDDEN');
    });

    it('rejects an invalid provider login without leaking details', async () => {
      const bad = new AuthService({
        supabase: {
          url: SUPABASE_URL,
          anonKey: 'anon-key',
          jwtSecret: JWT_SECRET,
          fetchImpl: (async () =>
            new Response(JSON.stringify({ error: 'invalid_grant' }), {
              status: 400,
              headers: { 'content-type': 'application/json' },
            })) as typeof fetch,
        },
        cookieSecret: COOKIE_SECRET,
        now: () => now,
      });
      const appWithBadLogin = await buildServer({
        logger: false,
        auth: bad,
        publicOrigin: 'https://editor.example',
      });
      try {
        const response = await appWithBadLogin.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'poster@example.com', password: 'wrong' },
        });
        expect(response.statusCode).toBe(401);
        expect(JSON.stringify(response.json())).not.toContain('invalid_grant');
      } finally {
        await appWithBadLogin.close();
      }
    });

    it('clears the session cookie on logout', async () => {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'poster@example.com', password: 'correct' },
      });
      const logout = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie: cookieOf(login), origin: 'https://editor.example' },
      });
      expect(logout.statusCode).toBe(200);
      expect(String(logout.headers['set-cookie'])).toContain('Max-Age=0');
    });
  });
});
