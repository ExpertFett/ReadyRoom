import { Router } from 'express';
import {
  createWing, getWings, getWing, updateWing, deleteWing,
  getWingIngestToken, regenerateWingIngestToken,
  createSquadron, getSquadrons, getSquadron, updateSquadron, deleteSquadron,
  createMember, getMember, getMembersByWing, getMembersBySquadron, updateMember, deleteMember,
  addAlias, getAliases, getAlias, deleteAlias, relinkSortiesForAlias,
  createQual, getQuals, getQual, deleteQual,
  setMemberQual, getMemberQuals, removeMemberQual,
  getRecentSorties, getMemberSorties, getUnmatchedAliases,
} from '../db/index.js';
import { getBaseUrl } from '../config.js';
import { requireAuth, requireAdmin, getActor } from './auth.js';

const cleanId = (v) => (v ? String(v).replace(/[^0-9]/g, '') || null : null);
const str = (v, max = 2000) => (v == null ? null : String(v).slice(0, max));

// Minimal CSV parser (quoted fields ok). Rows keyed by lowercased header.
function parseCsv(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const parseLine = (line) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = parseLine(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const row = {};
    headers.forEach((h, j) => { row[h] = vals[j] ?? ''; });
    return row;
  });
}

export function apiRouter() {
  const router = Router();

  // Identity + bootstrap state for the SPA.
  router.get('/me', (req, res) => {
    if (!req.session?.user) return res.status(401).json({ error: 'unauthorized' });
    const actor = getActor(req);
    res.json({
      user: actor.user,
      isAdmin: actor.isAdmin,
      role: actor.role,
      member: actor.member,
      setupNeeded: getWings().length === 0,
    });
  });

  router.use(requireAuth);

  // A member is editable by an admin, or by the user it belongs to (self-service).
  const canEditMember = (req, member) => {
    const actor = getActor(req);
    if (actor.isAdmin) return true;
    return member && actor.user && member.discord_user_id === actor.user.id;
  };

  // ----- wings -----
  router.get('/wings', (req, res) => {
    res.json(getWings().map((w) => ({ ...w, squadrons: getSquadrons(w.id).length })));
  });

  router.post('/wings', requireAdmin, (req, res) => {
    const name = str(req.body?.name, 120);
    if (!name) return res.status(400).json({ error: 'missing_name' });
    res.json(createWing({ name, tag: str(req.body?.tag, 32), description: str(req.body?.description, 2000) }));
  });

  router.get('/wings/:id', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    res.json({ ...wing, squadrons: getSquadrons(wing.id) });
  });

  router.put('/wings/:id', requireAdmin, (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const name = str(req.body?.name, 120) || wing.name;
    res.json(updateWing(wing.id, { name, tag: str(req.body?.tag, 32), description: str(req.body?.description, 2000) }));
  });

  router.delete('/wings/:id', requireAdmin, (req, res) => {
    res.json({ ok: deleteWing(Number(req.params.id)) > 0 });
  });

  // DCS ingest token for a wing (used by the sortie hook / VectorBot mirror).
  router.get('/wings/:id/ingest', requireAdmin, (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    res.json({ ingest_url: `${getBaseUrl()}/ingest/${getWingIngestToken(wing.id)}` });
  });
  router.post('/wings/:id/ingest/regen', requireAdmin, (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    res.json({ ingest_url: `${getBaseUrl()}/ingest/${regenerateWingIngestToken(wing.id)}` });
  });

  // ----- squadrons -----
  router.get('/squadrons', (req, res) => {
    const wingId = Number(req.query.wing_id);
    if (!wingId) return res.status(400).json({ error: 'missing_wing_id' });
    res.json(getSquadrons(wingId));
  });

  router.post('/squadrons', requireAdmin, (req, res) => {
    const b = req.body || {};
    const wingId = Number(b.wing_id);
    if (!wingId || !getWing(wingId)) return res.status(400).json({ error: 'bad_wing' });
    if (!str(b.name, 120)) return res.status(400).json({ error: 'missing_name' });
    res.json(createSquadron(wingId, {
      name: str(b.name, 120), tag: str(b.tag, 32), aircraft: str(b.aircraft, 120),
      description: str(b.description, 2000), sort_order: b.sort_order,
    }));
  });

  router.get('/squadrons/:id', (req, res) => {
    const sqn = getSquadron(Number(req.params.id));
    if (!sqn) return res.status(404).json({ error: 'not_found' });
    res.json({ ...sqn, members: getMembersBySquadron(sqn.id) });
  });

  router.put('/squadrons/:id', requireAdmin, (req, res) => {
    const sqn = getSquadron(Number(req.params.id));
    if (!sqn) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    res.json(updateSquadron(sqn.id, {
      name: str(b.name, 120) || sqn.name, tag: str(b.tag, 32), aircraft: str(b.aircraft, 120),
      description: str(b.description, 2000), sort_order: b.sort_order ?? sqn.sort_order,
    }));
  });

  router.delete('/squadrons/:id', requireAdmin, (req, res) => {
    res.json({ ok: deleteSquadron(Number(req.params.id)) > 0 });
  });

  router.post('/squadrons/:id/import-roster', requireAdmin, (req, res) => {
    const sqn = getSquadron(Number(req.params.id));
    if (!sqn) return res.status(404).json({ error: 'not_found' });
    const rows = parseCsv(req.body?.csv || '');
    if (!rows.length) return res.status(400).json({ error: 'empty_csv' });
    let imported = 0;
    for (const r of rows) {
      if (!r.callsign && !r.name) continue;
      createMember(sqn.wing_id, {
        squadron_id: sqn.id,
        discord_user_id: cleanId(r.discord_user_id || r.user_id),
        callsign: r.callsign || null, name: r.name || null,
        rank: r.rank || null, billet: r.billet || null,
        airframes: r.airframes || sqn.aircraft || null,
        notes: r.notes || null,
      });
      imported++;
    }
    res.json({ ok: true, imported, total: rows.length });
  });

  // ----- members -----
  router.get('/members', (req, res) => {
    const squadronId = Number(req.query.squadron_id);
    const wingId = Number(req.query.wing_id);
    if (squadronId) return res.json(getMembersBySquadron(squadronId));
    if (wingId) return res.json(getMembersByWing(wingId));
    res.status(400).json({ error: 'missing_filter' });
  });

  router.post('/members', requireAdmin, (req, res) => {
    const b = req.body || {};
    const wingId = Number(b.wing_id);
    if (!wingId || !getWing(wingId)) return res.status(400).json({ error: 'bad_wing' });
    try {
      res.json(createMember(wingId, {
        squadron_id: b.squadron_id ? Number(b.squadron_id) : null,
        discord_user_id: cleanId(b.discord_user_id),
        callsign: str(b.callsign, 60), name: str(b.name, 120), rank: str(b.rank, 60),
        billet: str(b.billet, 60), airframes: str(b.airframes, 200),
        status: b.status, app_role: b.app_role, notes: str(b.notes, 4000),
        joined_at: b.joined_at ? new Date(b.joined_at).getTime() : null,
      }));
    } catch (err) {
      res.status(400).json({ error: err.message === 'alias_taken' ? 'alias_taken' : 'create_failed' });
    }
  });

  router.get('/members/:id', (req, res) => {
    const member = getMember(Number(req.params.id));
    if (!member) return res.status(404).json({ error: 'not_found' });
    res.json({
      ...member,
      aliases: getAliases(member.id),
      quals: getMemberQuals(member.id),
      sorties: getMemberSorties(member.id, 50),
    });
  });

  router.put('/members/:id', (req, res) => {
    const member = getMember(Number(req.params.id));
    if (!member) return res.status(404).json({ error: 'not_found' });
    const actor = getActor(req);
    if (!canEditMember(req, member)) return res.status(403).json({ error: 'forbidden' });
    const b = req.body || {};
    // Non-admins may only edit a safe subset of their own profile.
    const patch = actor.isAdmin
      ? {
          squadron_id: b.squadron_id ? Number(b.squadron_id) : null,
          discord_user_id: cleanId(b.discord_user_id),
          callsign: str(b.callsign, 60), name: str(b.name, 120), rank: str(b.rank, 60),
          billet: str(b.billet, 60), airframes: str(b.airframes, 200),
          status: b.status, app_role: b.app_role, notes: str(b.notes, 4000),
          joined_at: b.joined_at ? new Date(b.joined_at).getTime() : member.joined_at,
        }
      : {
          ...member,
          callsign: str(b.callsign, 60) ?? member.callsign,
          name: str(b.name, 120) ?? member.name,
          airframes: str(b.airframes, 200) ?? member.airframes,
        };
    res.json(updateMember(member.id, patch));
  });

  router.delete('/members/:id', requireAdmin, (req, res) => {
    res.json({ ok: deleteMember(Number(req.params.id)) > 0 });
  });

  // ----- pilot aliases (identity bridge) -----
  router.post('/members/:id/aliases', (req, res) => {
    const member = getMember(Number(req.params.id));
    if (!member) return res.status(404).json({ error: 'not_found' });
    if (!canEditMember(req, member)) return res.status(403).json({ error: 'forbidden' });
    try {
      const alias = addAlias(member.id, req.body?.alias);
      const relinked = relinkSortiesForAlias(alias.alias, member.id);
      res.json({ ...alias, relinked });
    } catch (err) {
      const code = err.message === 'alias_taken' ? 409 : 400;
      res.status(code).json({ error: err.message || 'add_failed' });
    }
  });

  router.delete('/aliases/:aliasId', (req, res) => {
    const alias = getAlias(Number(req.params.aliasId));
    if (!alias) return res.status(404).json({ error: 'not_found' });
    const member = getMember(alias.member_id);
    if (!canEditMember(req, member)) return res.status(403).json({ error: 'forbidden' });
    res.json({ ok: deleteAlias(alias.id) > 0 });
  });

  // ----- qualifications -----
  router.get('/quals', (req, res) => {
    const wingId = Number(req.query.wing_id);
    if (!wingId) return res.status(400).json({ error: 'missing_wing_id' });
    res.json(getQuals(wingId));
  });

  router.post('/quals', requireAdmin, (req, res) => {
    const b = req.body || {};
    const wingId = Number(b.wing_id);
    if (!wingId || !getWing(wingId)) return res.status(400).json({ error: 'bad_wing' });
    if (!str(b.code, 30) || !str(b.name, 120)) return res.status(400).json({ error: 'missing_fields' });
    try {
      res.json(createQual(wingId, {
        code: str(b.code, 30), name: str(b.name, 120), category: str(b.category, 60),
        description: str(b.description, 2000), sort_order: b.sort_order,
      }));
    } catch (err) {
      res.status(400).json({ error: String(err.message).includes('UNIQUE') ? 'duplicate_code' : 'create_failed' });
    }
  });

  router.delete('/quals/:id', requireAdmin, (req, res) => {
    res.json({ ok: deleteQual(Number(req.params.id)) > 0 });
  });

  router.put('/members/:id/quals/:qualId', requireAdmin, (req, res) => {
    const member = getMember(Number(req.params.id));
    const qual = getQual(Number(req.params.qualId));
    if (!member || !qual) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    res.json(setMemberQual(member.id, qual.id, {
      status: b.status,
      awarded_at: b.awarded_at ? new Date(b.awarded_at).getTime() : Date.now(),
      expires_at: b.expires_at ? new Date(b.expires_at).getTime() : null,
      notes: str(b.notes, 500),
    }));
  });

  router.delete('/members/:id/quals/:qualId', requireAdmin, (req, res) => {
    res.json({ ok: removeMemberQual(Number(req.params.id), Number(req.params.qualId)) > 0 });
  });

  // ----- sortie activity -----
  router.get('/sorties', (req, res) => {
    const wingId = Number(req.query.wing_id);
    if (!wingId) return res.status(400).json({ error: 'missing_wing_id' });
    res.json(getRecentSorties(wingId, Math.min(200, Number(req.query.limit) || 50)));
  });

  // Aliases seen in sortie data that aren't mapped to any member yet (admin resolves these).
  router.get('/unmatched-aliases', requireAdmin, (req, res) => {
    const wingId = Number(req.query.wing_id);
    if (!wingId) return res.status(400).json({ error: 'missing_wing_id' });
    res.json(getUnmatchedAliases(wingId));
  });

  return router;
}
