import session from 'express-session';
import db from '../db/index.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid    TEXT PRIMARY KEY,
    sess   TEXT NOT NULL,
    expire INTEGER NOT NULL
  );
`);

const getStmt = db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?');
const upsertStmt = db.prepare(`
  INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
  ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire
`);
const delStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
const touchStmt = db.prepare('UPDATE sessions SET expire = ? WHERE sid = ?');
const sweepStmt = db.prepare('DELETE FROM sessions WHERE expire < ?');

const DEFAULT_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const expiryOf = (sess) =>
  sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + DEFAULT_TTL;

export class SqliteSessionStore extends session.Store {
  get(sid, cb) {
    try {
      const row = getStmt.get(sid);
      if (!row) return cb(null, null);
      if (row.expire < Date.now()) {
        delStmt.run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      upsertStmt.run(sid, JSON.stringify(sess), expiryOf(sess));
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  destroy(sid, cb) {
    try {
      delStmt.run(sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      touchStmt.run(expiryOf(sess), sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }
}

setInterval(() => {
  try {
    sweepStmt.run(Date.now());
  } catch {
    /* ignore */
  }
}, 60 * 60 * 1000).unref();

// --- admin session management ---
// We aggregate by the logged-in user and act on user IDs, never exposing raw
// session IDs (those are effectively bearer secrets) to any client.
const listActiveStmt = db.prepare('SELECT sid, sess, expire FROM sessions WHERE expire > ?');

function parseUser(sessJson) {
  try { return JSON.parse(sessJson)?.user || null; } catch { return null; }
}

// One row per logged-in user with an active session: { user, sessions, lastExpire }.
export function listActiveUsers() {
  const byUser = new Map();
  for (const r of listActiveStmt.all(Date.now())) {
    const u = parseUser(r.sess);
    if (!u?.id) continue;
    const cur = byUser.get(u.id) || { user: u, sessions: 0, lastExpire: 0 };
    cur.sessions += 1;
    cur.lastExpire = Math.max(cur.lastExpire, r.expire);
    byUser.set(u.id, cur);
  }
  return [...byUser.values()].sort((a, b) => b.lastExpire - a.lastExpire);
}

// Force-logout: delete every session belonging to a Discord user id. Returns count.
export function revokeUserSessions(userId) {
  let n = 0;
  for (const r of db.prepare('SELECT sid, sess FROM sessions').all()) {
    if (parseUser(r.sess)?.id === String(userId)) { delStmt.run(r.sid); n += 1; }
  }
  return n;
}
