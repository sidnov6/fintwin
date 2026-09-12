/** No-passphrase access is an explicit, loopback-only host setting. */
export function localOpenEnabled(settings) {
  if (settings.FINTWIN_LOCAL_OPEN !== '1') return false;
  const host = settings.FINTWIN_HOST || '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) || settings.FINTWIN_PUBLIC_ORIGIN || settings.FINTWIN_ALLOWED_ORIGIN) {
    throw new Error('FINTWIN_LOCAL_OPEN requires a loopback bind with no public or cross-origin configuration.');
  }
  return true;
}
