import { timingSafeEqual } from 'node:crypto';

export function serviceAuthentication(token, { code = 'indexing_unavailable', message = 'Document processing is temporarily unavailable.' } = {}) {
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token || '')) {
      return res.status(503).json({ error: message, code });
    }
    const headers = req.rawHeaders.filter((_value, index) => index % 2 === 0).filter(name => name.toLowerCase() === 'authorization');
    const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/i.exec(req.get('authorization') || '');
    const provided = Buffer.from(match?.[1] || ''), expected = Buffer.from(token);
    if (headers.length !== 1 || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return res.set('WWW-Authenticate', 'Bearer').status(401).json({ error: 'Valid service credentials are required.', code: 'unauthorized' });
    }
    next();
  };
}
