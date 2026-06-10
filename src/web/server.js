import express from 'express';
import session from 'express-session';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { config, isProd } from '../config.js';
import { SqliteSessionStore } from './sessionStore.js';
import { authRouter } from './auth.js';
import { apiRouter } from './api.js';
import { ingestRouter } from './ingest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', '..', 'dashboard', 'dist');

export function startWebServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  if (!process.env.SESSION_SECRET) {
    console.warn('SESSION_SECRET not set — using an insecure dev fallback. Set it in production.');
  }

  app.use(session({
    name: 'readyroom.sid',
    secret: config.sessionSecret,
    store: new SqliteSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }));

  app.use('/auth', authRouter);
  app.use('/api', apiRouter());
  app.use('/ingest', ingestRouter()); // public, token-authed sortie hook
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  if (existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      // API-ish paths that fell through their routers are real 404s — return
      // JSON, not the SPA shell. Without this, an unmatched GET /api/* came
      // back as index.html with HTTP 200 and the frontend "succeeded" on HTML.
      if (/^\/(api|auth|ingest)\//.test(req.path)) {
        return res.status(404).json({ error: 'not_found' });
      }
      res.sendFile(join(DIST_DIR, 'index.html'));
    });
  } else {
    app.get('/', (req, res) =>
      res.type('html').send(
        '<h1>ReadyRoom</h1><p>Dashboard not built yet. Run <code>npm run build</code> (or <code>npm run dashboard</code> for dev).</p>'
      ));
  }

  // Global error handler. Express middleware (body-parser, route handlers)
  // sets `err.status` / `err.statusCode` on the error object — honor those
  // before falling back to a generic 500. Without this, the file-upload
  // 25 MB limit was surfacing as 500 instead of the documented 413.
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('Web error:', err);
    // body-parser tags oversized requests with `err.type === 'entity.too.large'`.
    // Map known kinds to short error codes for the client; otherwise pass
    // err.message through so 4xx surfaces are actionable.
    const code =
      err.type === 'entity.too.large' ? 'too_large' :
      err.type === 'entity.parse.failed' ? 'bad_json' :
      err.code === 'ERR_INVALID_CONTENT_LENGTH' ? 'bad_content_length' :
      (status >= 500 ? 'server_error' : (err.message || 'request_failed'));
    res.status(status).json({ error: code });
  });

  app.listen(config.port, () => console.log(`ReadyRoom listening on port ${config.port}.`));
}
