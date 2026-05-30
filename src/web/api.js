import { Router, raw } from 'express';
import {
  createWing, getWings, getWing, updateWing, deleteWing,
  getWingIngestToken, regenerateWingIngestToken, setWingOpsBot,
  createSquadron, getSquadrons, getSquadron, updateSquadron, deleteSquadron,
  createMember, getMember, getMembersByWing, getMembersBySquadron, updateMember, deleteMember,
  addAlias, getAliases, getAlias, deleteAlias, relinkSortiesForAlias,
  createQual, getQuals, getQual, deleteQual,
  setMemberQual, getMemberQuals, removeMemberQual,
  getRecentSorties, getMemberSorties, getUnmatchedAliases,
} from '../db/index.js';
import {
  createCampaign, getCampaigns, getCampaign, updateCampaign, deleteCampaign,
  createMission, listMissions, getMissionFull, updateMission, deleteMission, cloneMission,
  addFlight, getFlight, updateFlight, deleteFlight,
  signUp, getSignup, removeSignup,
  setMissionAccess,
  addResource, deleteResource,
  getDashboard,
} from '../db/missions.js';
import {
  setSquadronKind, setQualTier,
  getSquadronRoster, getSquadronReadiness,
  attachMember, detachMember, getDetachmentRoster,
} from '../db/roster.js';
import {
  createActivity, getActivities, getActivity, updateActivity, deleteActivity,
  signOffActivity, removeSignoff,
  getMemberActivitiesForQual, getMemberQualProgress,
  setQualCadence, getWingCurrency, getTrainingBoard,
} from '../db/quals.js';
import {
  createEvent, getEvent, updateEvent, deleteEvent, getEventsInRange,
  markAttendance, clearAttendance, getEventAttendance, getEventRoster,
  createLOA, getLOA, setLOAStatus, deleteLOA, getUpcomingLOAs, getMemberLOAs,
  getAttendanceMetrics, getPilotPerformance, setEventDiscord,
} from '../db/events.js';
import { publishEvent as opsbotPublishEvent } from '../services/opsbotBridge.js';
import { getBaseUrl } from '../config.js';
import { requireAuth, requireAdmin, getActor } from './auth.js';
import { parseMizSlots, flightsFromSlots } from '../services/mizParser.js';

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

  // Wing-level Ops Bot publish settings (Discord embed bridge — Epic 5b).
  router.put('/wings/:id/ops-bot', requireAdmin, (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    res.json(setWingOpsBot(wing.id, {
      ops_bot_url: str(req.body?.ops_bot_url, 500),
      ops_bot_token: str(req.body?.ops_bot_token, 200),
    }));
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
    const created = createSquadron(wingId, {
      name: str(b.name, 120), tag: str(b.tag, 32), aircraft: str(b.aircraft, 120),
      description: str(b.description, 2000), sort_order: b.sort_order,
    });
    if (b.kind === 'detachment') setSquadronKind(created.id, 'detachment');
    res.json(getSquadron(created.id));
  });

  router.get('/squadrons/:id', (req, res) => {
    const sqn = getSquadron(Number(req.params.id));
    if (!sqn) return res.status(404).json({ error: 'not_found' });
    res.json({
      ...sqn,
      members: getMembersBySquadron(sqn.id),    // flat list (kept for compatibility)
      roster: getSquadronRoster(sqn.id),        // grouped by subdivision, with derived tier
      readiness: getSquadronReadiness(sqn.id),  // tier counts
      det_roster: sqn.kind === 'detachment' ? getDetachmentRoster(sqn.id) : null,
    });
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
        modex: r.modex || null, subdivision: r.subdivision || 'main',
        notes: r.notes || null,
      });
      imported++;
    }
    res.json({ ok: true, imported, total: rows.length });
  });

  // ----- detachment cross-attachments -----
  router.post('/squadrons/:id/attach', requireAdmin, (req, res) => {
    const sqn = getSquadron(Number(req.params.id));
    if (!sqn) return res.status(404).json({ error: 'not_found' });
    const memberId = Number(req.body?.member_id);
    if (!memberId || !getMember(memberId)) return res.status(400).json({ error: 'bad_member' });
    attachMember(sqn.id, memberId, req.body?.attach_type, str(req.body?.note, 200));
    res.json({ ok: true });
  });
  router.delete('/squadrons/:id/attach/:memberId', requireAdmin, (req, res) => {
    res.json({ ok: detachMember(Number(req.params.id), Number(req.params.memberId)) > 0 });
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
        modex: str(b.modex, 12), subdivision: b.subdivision,
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
      quals: getMemberQuals(member.id).map((q) => ({ ...q, progress: getMemberQualProgress(member.id, q.qual_id) })),
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
          modex: str(b.modex, 12), subdivision: b.subdivision,
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
      const qual = createQual(wingId, {
        code: str(b.code, 30), name: str(b.name, 120), category: str(b.category, 60),
        description: str(b.description, 2000), sort_order: b.sort_order,
      });
      if (b.is_tier) {
        setQualTier(qual.id, {
          is_tier: true,
          tier_order: Number(b.tier_order) || 0,
          tier_label: str(b.tier_label, 20) || qual.code,
        });
      }
      if (b.currency_days || b.completion_days) {
        setQualCadence(qual.id, {
          currency_days: Number(b.currency_days) || null,
          completion_days: Number(b.completion_days) || null,
        });
      }
      res.json({
        ...qual,
        is_tier: b.is_tier ? 1 : 0,
        tier_order: Number(b.tier_order) || 0,
        tier_label: b.is_tier ? (str(b.tier_label, 20) || qual.code) : null,
        currency_days: Number(b.currency_days) || null,
        completion_days: Number(b.completion_days) || null,
      });
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

  // ===== Epic 2: qualification activities + sign-offs + currency =====
  router.get('/quals/:id/activities', (req, res) => {
    const qual = getQual(Number(req.params.id));
    if (!qual) return res.status(404).json({ error: 'not_found' });
    res.json(getActivities(qual.id));
  });
  router.post('/quals/:id/activities', requireAdmin, (req, res) => {
    const qual = getQual(Number(req.params.id));
    if (!qual) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    if (!str(b.name, 200)) return res.status(400).json({ error: 'missing_name' });
    res.json(createActivity(qual.id, {
      name: str(b.name, 200), group_name: str(b.group_name, 80),
      description: str(b.description, 2000),
      is_currency: !!b.is_currency, sort_order: b.sort_order,
    }));
  });
  router.put('/activities/:id', requireAdmin, (req, res) => {
    const a = getActivity(Number(req.params.id));
    if (!a) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    res.json(updateActivity(a.id, {
      name: str(b.name, 200) || a.name, group_name: str(b.group_name, 80),
      description: str(b.description, 2000),
      is_currency: !!b.is_currency, sort_order: b.sort_order ?? a.sort_order,
    }));
  });
  router.delete('/activities/:id', requireAdmin, (req, res) => {
    res.json({ ok: deleteActivity(Number(req.params.id)) > 0 });
  });

  // sign-offs (admin/instructor): one per (member, activity)
  router.post('/members/:id/signoffs/:activityId', requireAdmin, (req, res) => {
    const m = getMember(Number(req.params.id));
    const a = getActivity(Number(req.params.activityId));
    if (!m || !a) return res.status(404).json({ error: 'not_found' });
    signOffActivity(m.id, a.id, {
      status: req.body?.status, signerId: getActor(req).member?.id,
      notes: str(req.body?.notes, 500),
    });
    res.json({ ok: true });
  });
  router.delete('/members/:id/signoffs/:activityId', requireAdmin, (req, res) => {
    res.json({ ok: removeSignoff(Number(req.params.id), Number(req.params.activityId)) > 0 });
  });

  // per-member per-qual activity list (powers the member detail expansion)
  router.get('/members/:id/quals/:qualId/activities', (req, res) => {
    const m = getMember(Number(req.params.id));
    const q = getQual(Number(req.params.qualId));
    if (!m || !q) return res.status(404).json({ error: 'not_found' });
    res.json(getMemberActivitiesForQual(m.id, q.id));
  });

  // training-board matrix: pilots × activities for one qual
  router.get('/quals/:id/board', (req, res) => {
    const board = getTrainingBoard(Number(req.params.id), { squadronId: Number(req.query.squadron_id) || null });
    if (!board) return res.status(404).json({ error: 'not_found' });
    res.json(board);
  });

  // currency status across a wing (for the currency panel)
  router.get('/wings/:id/currency', (req, res) => {
    const w = getWing(Number(req.params.id));
    if (!w) return res.status(404).json({ error: 'not_found' });
    res.json(getWingCurrency(w.id));
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

  // =====================================================================
  // Missions / ops (Phase A) — the bot<->editor bridge object
  // =====================================================================
  const ms = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  };

  // ----- campaigns -----
  router.get('/campaigns', (req, res) => {
    const wingId = Number(req.query.wing_id);
    if (!wingId) return res.status(400).json({ error: 'missing_wing_id' });
    res.json(getCampaigns(wingId));
  });
  router.post('/campaigns', requireAdmin, (req, res) => {
    const b = req.body || {};
    const wingId = Number(b.wing_id);
    if (!wingId || !getWing(wingId)) return res.status(400).json({ error: 'bad_wing' });
    if (!str(b.name, 160)) return res.status(400).json({ error: 'missing_name' });
    res.json(createCampaign(wingId, { name: str(b.name, 160), description: str(b.description, 4000), status: b.status, start_at: ms(b.start_at), end_at: ms(b.end_at) }));
  });
  router.put('/campaigns/:id', requireAdmin, (req, res) => {
    const c = getCampaign(Number(req.params.id));
    if (!c) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    res.json(updateCampaign(c.id, { name: str(b.name, 160) || c.name, description: str(b.description, 4000), status: b.status, start_at: ms(b.start_at), end_at: ms(b.end_at) }));
  });
  router.delete('/campaigns/:id', requireAdmin, (req, res) => res.json({ ok: deleteCampaign(Number(req.params.id)) > 0 }));

  // ----- missions -----
  router.get('/missions', (req, res) => {
    const wingId = Number(req.query.wing_id);
    if (!wingId) return res.status(400).json({ error: 'missing_wing_id' });
    res.json(listMissions(wingId, {
      status: req.query.status, type: req.query.type,
      campaign_id: req.query.campaign_id, aircraft: req.query.aircraft, search: req.query.search,
    }));
  });
  router.post('/missions', requireAdmin, (req, res) => {
    const b = req.body || {};
    const wingId = Number(b.wing_id);
    if (!wingId || !getWing(wingId)) return res.status(400).json({ error: 'bad_wing' });
    if (!str(b.name, 160)) return res.status(400).json({ error: 'missing_name' });
    res.json(createMission(wingId, {
      type: b.type, campaign_id: b.campaign_id, name: str(b.name, 160),
      primary_aircraft: str(b.primary_aircraft, 120), status: b.status,
      start_at: ms(b.start_at), duration_min: Number(b.duration_min) || null,
      description: str(b.description, 8000), miz_ref: str(b.miz_ref, 500),
    }, getActor(req).user?.id || null));
  });
  router.get('/missions/:id', (req, res) => {
    const m = getMissionFull(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'not_found' });
    res.json(m);
  });
  router.put('/missions/:id', requireAdmin, (req, res) => {
    const m = getMissionFull(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    res.json(updateMission(m.id, {
      type: b.type ?? m.type, campaign_id: b.campaign_id ?? m.campaign_id, name: str(b.name, 160) || m.name,
      primary_aircraft: str(b.primary_aircraft, 120), status: b.status ?? m.status,
      start_at: ms(b.start_at), duration_min: Number(b.duration_min) || null,
      description: str(b.description, 8000), miz_ref: str(b.miz_ref, 500),
    }));
  });
  router.delete('/missions/:id', requireAdmin, (req, res) => res.json({ ok: deleteMission(Number(req.params.id)) > 0 }));
  router.post('/missions/:id/clone', requireAdmin, (req, res) => {
    const m = getMissionFull(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    res.json(cloneMission(m.id, { wingId: m.wing_id, type: b.type || 'standalone', name: str(b.name, 160) }, getActor(req).user?.id || null));
  });

  // ----- flights -----
  router.post('/missions/:id/flights', requireAdmin, (req, res) => {
    const m = getMissionFull(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'not_found' });
    res.json(addFlight(m.id, req.body || {}));
  });
  router.put('/flights/:id', requireAdmin, (req, res) => {
    const f = getFlight(Number(req.params.id));
    if (!f) return res.status(404).json({ error: 'not_found' });
    res.json(updateFlight(f.id, req.body || {}));
  });
  router.delete('/flights/:id', requireAdmin, (req, res) => res.json({ ok: deleteFlight(Number(req.params.id)) > 0 }));

  // Import flights from a .miz upload (raw binary). Pass ?replace=1 to wipe existing flights first.
  router.post('/missions/:id/import-miz', requireAdmin, raw({ type: '*/*', limit: '20mb' }), (req, res) => {
    const mission = getMissionFull(Number(req.params.id));
    if (!mission) return res.status(404).json({ error: 'not_found' });
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty_body' });
    let slots;
    try {
      slots = parseMizSlots(req.body);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'parse_failed' });
    }
    const flights = flightsFromSlots(slots);
    const replace = req.query.replace === '1';
    if (replace) for (const f of mission.flights) deleteFlight(f.id);
    let order = replace ? 0 : (mission.flights.length || 0);
    const created = flights.map((f) => addFlight(mission.id, {
      sort_order: order++,
      callsign: f.callsign,
      aircraft: f.aircraft,
      role: null,
      slots: f.slots,
      squadron_id: null,
      notes: f.country ? `from .miz · ${f.side}/${f.country}` : 'from .miz',
    }));
    res.json({
      ok: true,
      parsed_slots: slots.length,
      flights_created: created.length,
      mission: getMissionFull(mission.id),
    });
  });

  // ----- squadron access & resources -----
  router.post('/missions/:id/access', requireAdmin, (req, res) => {
    const m = getMissionFull(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'not_found' });
    res.json(setMissionAccess(m.id, req.body?.access || []));
  });
  router.post('/missions/:id/resources', requireAdmin, (req, res) => {
    const m = getMissionFull(Number(req.params.id));
    if (!m) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    res.json(addResource(m.id, { kind: b.kind, label: str(b.label, 200), url: str(b.url, 1000) }));
  });
  router.delete('/resources/:id', requireAdmin, (req, res) => res.json({ ok: deleteResource(Number(req.params.id)) > 0 }));

  // ----- signups (self-service, or admin signing on behalf) -----
  router.post('/flights/:id/signup', (req, res) => {
    const flight = getFlight(Number(req.params.id));
    if (!flight) return res.status(404).json({ error: 'not_found' });
    const actor = getActor(req);
    let memberId = Number(req.body?.member_id) || null;
    if (memberId && !actor.isAdmin) return res.status(403).json({ error: 'forbidden' });
    if (!memberId) memberId = actor.member?.id || null;
    if (!memberId) return res.status(400).json({ error: 'no_member' });
    try {
      res.json(signUp(flight.id, memberId, req.body?.status));
    } catch (err) {
      const code = ['flight_full', 'already_signed'].includes(err.message) ? 409 : 400;
      res.status(code).json({ error: err.message || 'signup_failed' });
    }
  });
  router.delete('/signups/:id', (req, res) => {
    const s = getSignup(Number(req.params.id));
    if (!s) return res.status(404).json({ error: 'not_found' });
    const actor = getActor(req);
    if (!actor.isAdmin && s.member_id !== actor.member?.id) return res.status(403).json({ error: 'forbidden' });
    res.json({ ok: removeSignup(s.id) > 0 });
  });

  // ----- dashboard -----
  router.get('/dashboard', (req, res) => {
    const wingId = Number(req.query.wing_id);
    if (!wingId) return res.status(400).json({ error: 'missing_wing_id' });
    res.json(getDashboard(wingId, getActor(req).member?.id || null));
  });

  // =====================================================================
  // Epic 3: events / attendance / LOA / metrics
  // (reuses the `ms` date helper declared in the missions block above)
  // =====================================================================

  // ----- events / calendar -----
  router.get('/wings/:id/events', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const from = ms(req.query.from);
    const to = ms(req.query.to);
    if (from == null || to == null) return res.status(400).json({ error: 'missing_range' });
    res.json(getEventsInRange(wing.id, from, to, { squadronId: Number(req.query.squadron_id) || null }));
  });

  router.post('/events', requireAdmin, (req, res) => {
    const b = req.body || {};
    const wingId = Number(b.wing_id);
    if (!wingId || !getWing(wingId)) return res.status(400).json({ error: 'bad_wing' });
    if (!str(b.title, 200)) return res.status(400).json({ error: 'missing_title' });
    const start = ms(b.start_at);
    if (!start) return res.status(400).json({ error: 'missing_start_at' });
    const event = createEvent(wingId, {
      squadron_id: b.squadron_id ? Number(b.squadron_id) : null,
      title: str(b.title, 200), description: str(b.description, 8000),
      kind: b.kind, start_at: start, end_at: ms(b.end_at),
      multi_squadron: !!b.multi_squadron, track_attendance: b.track_attendance !== false,
    }, getActor(req).user?.id || null);

    // Fire-and-forget: drop a Discord embed via Ops Bot if the wing is wired up.
    const wing = getWing(wingId);
    if (wing.ops_bot_url && wing.ops_bot_token) {
      opsbotPublishEvent(wing, {
        title: event.title,
        description: event.description,
        kind: event.kind,
        start_at: event.start_at,
        url: `${getBaseUrl()}/events/${event.id}`,
      }).then((r) => { if (r) setEventDiscord(event.id, r.channel_id, r.message_id); });
    }

    res.json(event);
  });

  router.get('/events/:id', (req, res) => {
    const e = getEvent(Number(req.params.id));
    if (!e) return res.status(404).json({ error: 'not_found' });
    res.json({ ...e, roster: getEventRoster(e.id), attendance: getEventAttendance(e.id) });
  });

  router.put('/events/:id', requireAdmin, (req, res) => {
    const e = getEvent(Number(req.params.id));
    if (!e) return res.status(404).json({ error: 'not_found' });
    const b = req.body || {};
    res.json(updateEvent(e.id, {
      squadron_id: b.squadron_id ?? e.squadron_id,
      title: str(b.title, 200) || e.title, description: str(b.description, 8000),
      kind: b.kind ?? e.kind, start_at: ms(b.start_at) ?? e.start_at, end_at: ms(b.end_at),
      multi_squadron: !!b.multi_squadron, track_attendance: b.track_attendance !== false,
    }));
  });

  router.delete('/events/:id', requireAdmin, (req, res) => {
    res.json({ ok: deleteEvent(Number(req.params.id)) > 0 });
  });

  // ----- attendance -----
  router.post('/events/:id/attendance', requireAdmin, (req, res) => {
    const e = getEvent(Number(req.params.id));
    if (!e) return res.status(404).json({ error: 'not_found' });
    const memberId = Number(req.body?.member_id);
    if (!memberId) return res.status(400).json({ error: 'missing_member_id' });
    try {
      markAttendance(e.id, memberId, req.body?.status, {
        recordedBy: getActor(req).user?.id, notes: str(req.body?.notes, 500),
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message || 'mark_failed' });
    }
  });
  router.delete('/events/:id/attendance/:memberId', requireAdmin, (req, res) => {
    res.json({ ok: clearAttendance(Number(req.params.id), Number(req.params.memberId)) > 0 });
  });

  // ----- LOA -----
  router.get('/wings/:id/loas', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    res.json(getUpcomingLOAs(wing.id));
  });
  router.post('/members/:id/loas', (req, res) => {
    const member = getMember(Number(req.params.id));
    if (!member) return res.status(404).json({ error: 'not_found' });
    const actor = getActor(req);
    if (!actor.isAdmin && actor.member?.id !== member.id) return res.status(403).json({ error: 'forbidden' });
    const b = req.body || {};
    try {
      res.json(createLOA(member.id, {
        start_at: ms(b.start_at), end_at: ms(b.end_at), reason: str(b.reason, 500),
      }));
    } catch (err) {
      res.status(400).json({ error: err.message || 'bad_request' });
    }
  });
  router.put('/loas/:id', requireAdmin, (req, res) => {
    const loa = getLOA(Number(req.params.id));
    if (!loa) return res.status(404).json({ error: 'not_found' });
    try {
      res.json(setLOAStatus(loa.id, req.body?.status, getActor(req).user?.id));
    } catch (err) {
      res.status(400).json({ error: err.message || 'bad_request' });
    }
  });
  router.delete('/loas/:id', (req, res) => {
    const loa = getLOA(Number(req.params.id));
    if (!loa) return res.status(404).json({ error: 'not_found' });
    const actor = getActor(req);
    if (!actor.isAdmin && actor.member?.id !== loa.member_id) return res.status(403).json({ error: 'forbidden' });
    res.json({ ok: deleteLOA(loa.id) > 0 });
  });
  router.get('/members/:id/loas', (req, res) => {
    const member = getMember(Number(req.params.id));
    if (!member) return res.status(404).json({ error: 'not_found' });
    res.json(getMemberLOAs(member.id));
  });

  // ----- metrics -----
  router.get('/wings/:id/attendance-metrics', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const from = ms(req.query.from);
    const to = ms(req.query.to);
    if (from == null || to == null) return res.status(400).json({ error: 'missing_range' });
    res.json(getAttendanceMetrics(wing.id, from, to));
  });
  router.get('/wings/:id/pilot-performance', (req, res) => {
    const wing = getWing(Number(req.params.id));
    if (!wing) return res.status(404).json({ error: 'not_found' });
    const from = ms(req.query.from);
    const to = ms(req.query.to);
    if (from == null || to == null) return res.status(400).json({ error: 'missing_range' });
    res.json(getPilotPerformance(wing.id, from, to));
  });

  return router;
}
