import { Router } from 'express';
import crypto from 'node:crypto';
import { config, isDiscordConfigured } from '../config.js';
import { buildAuthUrl, exchangeCode, fetchDiscordUser } from './oauth.js';
import { getMemberByDiscord } from '../db/index.js';

export const authRouter = Router();

authRouter.get('/login', (req, res) => {
  if (!isDiscordConfigured()) {
    return res
      .status(500)
      .send('Discord OAuth not configured: set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET.');
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  res.redirect(buildAuthUrl(state));
});

authRouter.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== req.session.oauthState) {
    return res.redirect('/?error=invalid_state');
  }
  delete req.session.oauthState;
  try {
    const token = await exchangeCode(String(code));
    const user = await fetchDiscordUser(token.access_token);
    req.session.user = {
      id: user.id,
      username: user.global_name || user.username,
      avatar: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : null,
    };
    res.redirect('/');
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.redirect('/?error=oauth_failed');
  }
});

// Local-only login bypass so the app is usable before Discord OAuth is wired.
authRouter.get('/dev-login', (req, res) => {
  if (!config.allowDevLogin) return res.status(404).send('Not found');
  // Numeric snowflake-style ID so it round-trips like a real Discord ID (can be linked to a member).
  req.session.user = { id: '100000000000000000', username: 'Dev Admin', avatar: null, dev: true };
  res.redirect('/');
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// --- authorization helpers ---

// A dev-login user, or a user whose Discord ID is in ROOT_ADMIN_IDS, is a super-admin.
export function isRoot(req) {
  const u = req.session?.user;
  if (!u) return false;
  if (u.dev && config.allowDevLogin) return true;
  return config.rootAdminIds.has(u.id);
}

// The actor for this request: session user, their matched member record, and effective role.
export function getActor(req) {
  const user = req.session?.user || null;
  const root = isRoot(req);
  // Map any logged-in user (incl. the local dev user) to their roster member by Discord ID.
  const member = user ? getMemberByDiscord(user.id) : null;
  const role = root ? 'admin' : member?.app_role || 'guest';
  return { user, root, member, role, isAdmin: root || role === 'admin' };
}

export function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ error: 'unauthorized' });
}

export function requireAdmin(req, res, next) {
  if (getActor(req).isAdmin) return next();
  res.status(403).json({ error: 'forbidden' });
}
