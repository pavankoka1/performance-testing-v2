/**
 * Single Content-Security-Policy for Express and Electron session injection.
 * No unsafe-eval (Electron security audit + https://www.electronjs.org/docs/latest/tutorial/security)
 */
const CONTENT_SECURITY_POLICY_PARTS = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* wss://127.0.0.1:* wss://localhost:*",
  "media-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

const CONTENT_SECURITY_POLICY = CONTENT_SECURITY_POLICY_PARTS.join("; ");
const META_CONTENT_SECURITY_POLICY = CONTENT_SECURITY_POLICY_PARTS
  .filter((directive) => !directive.startsWith("frame-ancestors "))
  .join("; ");

module.exports = {
  CONTENT_SECURITY_POLICY,
  META_CONTENT_SECURITY_POLICY,
};
