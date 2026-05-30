/**
 * Parse a .miz buffer into the list of flyable Client/Player slots.
 * Ported from ExpertFett/VectorBot's src/features/mizParser.js — same owner,
 * same approach: unzip the .miz, evaluate the mission Lua with fengari,
 * walk the coalitions/countries/categories/groups/units, and collect anything
 * with skill = "Client" or "Player".
 *
 * Returns an array of:
 *   { side, country, category, group, unit, type, onboard }
 */
import { unzipSync } from 'fflate';
import fengari from 'fengari';

const { lua, lauxlib, lualib, to_luastring } = fengari;

const EXTRACT = `
local out = {}
local function esc(s) s = tostring(s); s = s:gsub('\\\\','\\\\\\\\'):gsub('"','\\\\"'):gsub('[\\r\\n]',' '); return s end
local function add(side, country, cat, gname, u)
  out[#out+1] = string.format('{"side":"%s","country":"%s","category":"%s","group":"%s","type":"%s","unit":"%s","onboard":"%s"}',
    esc(side), esc(country), esc(cat), esc(gname), esc(u.type or ''), esc(u.name or ''), esc(u.onboard_num or ''))
end
if mission and mission.coalition then
  for side, sideData in pairs(mission.coalition) do
    if type(sideData)=='table' and sideData.country then
      for _, ctry in pairs(sideData.country) do
        local cname = ctry.name or ''
        for _, cat in ipairs({'plane','helicopter','ship','vehicle'}) do
          if ctry[cat] and ctry[cat].group then
            for _, grp in pairs(ctry[cat].group) do
              if grp.units then
                for _, u in pairs(grp.units) do
                  if u.skill == 'Client' or u.skill == 'Player' then add(side, cname, cat, grp.name or '', u) end
                end
              end
            end
          end
        end
      end
    end
  end
end
return '[' .. table.concat(out, ',') .. ']'
`;

export function parseMizSlots(buffer) {
  let files;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error('not_a_valid_miz');
  }
  if (!files.mission) throw new Error('no_mission_entry');
  const missionText = Buffer.from(files.mission).toString('utf8');

  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  try {
    if (lauxlib.luaL_dostring(L, to_luastring(missionText)) !== lua.LUA_OK) {
      throw new Error('mission_parse_failed');
    }
    if (lauxlib.luaL_dostring(L, to_luastring(EXTRACT)) !== lua.LUA_OK) {
      throw new Error('extract_failed');
    }
    return JSON.parse(lua.lua_tojsstring(L, -1));
  } finally {
    lua.lua_close(L);
  }
}

/**
 * Reduce the raw per-unit slot list to one entry per DCS group (a flight).
 * In DCS a group with N flyable Client units = N seats in one flight.
 * Returns:
 *   [{ callsign, aircraft, slots, side, country, sample_onboard }]
 */
export function flightsFromSlots(slots) {
  const byGroup = new Map();
  for (const s of slots) {
    const key = `${s.side}|${s.country}|${s.group}`;
    if (!byGroup.has(key)) {
      byGroup.set(key, {
        callsign: s.group,
        aircraft: s.type,
        slots: 0,
        side: s.side,
        country: s.country,
        sample_onboard: s.onboard || null,
      });
    }
    byGroup.get(key).slots += 1;
  }
  return [...byGroup.values()].sort((a, b) => a.callsign.localeCompare(b.callsign));
}
