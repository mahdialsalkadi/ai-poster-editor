/**
 * Build-time CSP for the editor shell. `connect-src 'self'` assumes the web app
 * and `/api` are served from the same origin, which the reverse proxy example
 * does. Split-origin deployments must add the API origin explicitly.
 *
 * Inline scripts are not allowed. Inline styles remain allowed because React
 * writes style attributes for layer geometry. `frame-ancestors` is delivered as
 * an HTTP header by the reverse proxy because browsers ignore it in a meta tag.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export function injectCsp(html: string): string {
  if (html.includes('http-equiv="Content-Security-Policy"')) return html;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`;
  return html.includes('<head>')
    ? html.replace('<head>', `<head>\n    ${meta}`)
    : `${meta}\n${html}`;
}
