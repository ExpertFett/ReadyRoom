// Central config, read once from the environment.
const splitIds = (s) =>
  String(s || '')
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export const config = {
  port: Number(process.env.PORT) || 4700,
  dbPath: process.env.DB_PATH || './data/readyroom.db',
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',

  discord: {
    clientId: process.env.DISCORD_CLIENT_ID || null,
    clientSecret: process.env.DISCORD_CLIENT_SECRET || null,
  },

  // Discord user IDs that are always super-admins (bootstrap). Comma/space separated.
  rootAdminIds: new Set(splitIds(process.env.ROOT_ADMIN_IDS)),

  // Local-only login bypass so the app is usable before Discord OAuth is wired.
  allowDevLogin:
    process.env.ALLOW_DEV_LOGIN === '1' && process.env.NODE_ENV !== 'production',
};

export const isProd =
  process.env.NODE_ENV === 'production' ||
  (process.env.BASE_URL || '').startsWith('https');

export function getBaseUrl() {
  let base = (process.env.BASE_URL || `http://localhost:${config.port}`)
    .trim()
    .replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return base;
}

export const isDiscordConfigured = () =>
  Boolean(config.discord.clientId && config.discord.clientSecret);
