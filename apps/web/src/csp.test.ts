import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, injectCsp } from './csp.js';

describe('web content security policy', () => {
  it('allows no inline scripts and no external connections', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(CONTENT_SECURITY_POLICY).toContain("img-src 'self' data: blob:");
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("base-uri 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toContain('connect-src *');
  });

  it('injects the policy once into the built app shell', () => {
    const html = '<!doctype html><html><head><title>Poster</title></head><body></body></html>';
    const injected = injectCsp(html);
    expect(injected).toContain('http-equiv="Content-Security-Policy"');
    expect(injected).toContain(CONTENT_SECURITY_POLICY);
    expect(injectCsp(injected)).toBe(injected);
  });
});
