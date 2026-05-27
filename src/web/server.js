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
      res.sendFile(join(DIST_DIR, 'index.html'));
    });
  } else {
    app.get('/', (req, res) =>
      res.type('html').send(
        '<h1>ReadyRoom</h1><p>Dashboard not built yet. Run <code>npm run build</code> (or <code>npm run dashboard</code> for dev).</p>'
      ));
  }

  app.use((err, req, res, next) => {
    console.error('Web error:', err);
    res.status(500).json({ error: 'server_error' });
  });

  app.listen(config.port, () => console.log(`ReadyRoom listening on port ${config.port}.`));
}
