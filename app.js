// Vercel entry (zero-configuration Express: an `app.js` that imports Express and exports the app).
// It opens no listener. Every request goes to the lazily initialized provider, which builds the real
// application on first use and shares that setup between requests. Static files in projects/frontend/ are served
// by Vercel's CDN, so their security headers come from vercel.json. NOT deployed or tested on Vercel yet.
import express from 'express';
import provider from './projects/server/infra/provider.js';

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => { Promise.resolve(provider(req, res)).catch(next); });
// Only start-up failures reach here (the real app handles its own errors). The log line names settings, never values.
app.use((error, req, res, next) => {
  process.stderr.write(`Request failed: ${String(error?.message ?? 'startup failed')}\n`);
  if (res.headersSent) return next(error);
  return res.status(500).json({ schema_version: 1, error: { code: 'internal_error', message: 'internal_error' } });
});
export default app;
