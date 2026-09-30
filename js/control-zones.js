/* ===== Module: control-zones.js ===== */
/* ============================================================
   Team deathmatch control areas
   - delayed density-based deployment and live relocation
   - capture state, force-pool income, minimap/3D markers
   - player control-area repair and commander AI area weighting
   ============================================================ */
'use strict';

var CONTROL_ZONE_RADIUS = 90;
var CONTROL_ZONE_CAPTURE_TIME = 30;
var CONTROL_ZONE_INCOME_INTERVAL = 10;
var CONTROL_ZONE_RING_SEGMENTS = 128;
var CONTROL_ZONE_RING_SIDES = 8;
var CONTROL_ZONE_RING_TUBE = 0.28;
var CONTROL_ZONE_RING_CLEARANCE = 0.34;
var CONTROL_ZONE_START_DELAY = 30;
var CONTROL_ZONE_MOVE_INTERVAL = 60;
var CONTROL_ZONE_MIN_GAP = CONTROL_ZONE_RADIUS * 2 + 8;
var CONTROL_ZONE_DENSITY_RADIUS = 220;
var CONTROL_ZONE_DENSITY_SIGMA = 92;
var CONTROL_ZONE_WEAK_WEIGHT_MULTIPLIER = 1.5;
var CONTROL_ZONE_REPAIR_STOP_DELAY = 5;
var CONTROL_ZONE_REPAIR_RATE = 5;
var CONTROL_ZONE_AI_PRIORITY = { empty: 4, enemy: 3, open: 2, friendly: 1 };
var CONTROL_ZONE_RED = { r: 212, g: 58, b: 37 };
var CONTROL_ZONE_BLUE = { r: 31, g: 95, b: 214 };
var CONTROL_ZONE_WHITE = { r: 244, g: 244, b: 236 };
var CONTROL_ZONE_REPAIR_KEYS = ['gun', 'turret', 'engine', 'fuel', 'ammo', 'trackL', 'trackR', 'trans', 'crew', 'tailRotor'];
var controlZones = [];
var _controlZoneVisualsReady = false;
var _controlZoneRepairHudKey = '';
var _controlZoneMatchStartT = -1;
var _controlZoneNextSpawnT = Infinity;
var _controlZoneNextMoveT = Infinity;
var _controlZoneEpoch = 0;
var _controlZoneCaptureHudKey = '';

function controlZonesEnabled() {
  return !(typeof isFfaMode === 'function' && isFfaMode()) &&
    !(typeof tdmControlZonesEnabled !== 'undefined' && !tdmControlZonesEnabled);
}
function controlZonesActive() {
  return controlZones.length > 0 && controlZonesEnabled();
}
function controlZoneIsLandVehicle(t) {
  if (!t || !t.alive || t.kind === 'heli' || (typeof isHeliVehicle === 'function' && isHeliVehicle(t))) return false;
  return true;
}
function controlZoneContainsVehicle(zone, t) {
  if (!zone || !controlZoneIsLandVehicle(t) || !t.group || !t.group.position) return false;
  var dx = t.group.position.x - zone.x, dz = t.group.position.z - zone.cz;
  var bodyR = Math.max(0, Number(t.radius) || 0);
  var r = Math.max(0, CONTROL_ZONE_RADIUS - bodyR);
  return dx * dx + dz * dz <= r * r + 1e-6;
}
function controlZoneOtherTeam(team) { return team === 'red' ? 'blue' : 'red'; }
function controlZoneTeamColor(team) { return team === 'blue' ? CONTROL_ZONE_BLUE : CONTROL_ZONE_RED; }
function controlZoneClamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function controlZoneCaptureTeam(zone) {
  return zone && (zone.captureTeam || zone.owner) ? (zone.captureTeam || zone.owner) : null;
}
function controlZoneCaptureProgress(zone) {
  if (!zone || !controlZoneCaptureTeam(zone)) return 0;
  return zone.captureTeam ? controlZoneClamp01(zone.progress || 0) : 1;
}
function controlZoneColor(zone) {
  var from = CONTROL_ZONE_WHITE, to = CONTROL_ZONE_WHITE, p = controlZoneCaptureProgress(zone);
  var captureTeam = controlZoneCaptureTeam(zone);
  if (captureTeam) {
    to = controlZoneTeamColor(captureTeam);
    if (zone.captureFrom) from = controlZoneTeamColor(zone.captureFrom);
  }
  return {
    r: Math.round(from.r + (to.r - from.r) * p),
    g: Math.round(from.g + (to.g - from.g) * p),
    b: Math.round(from.b + (to.b - from.b) * p)
  };
}
function controlZoneColorKey(c) {
  /* Keep the number texture on the same integer RGB step as the ring, so both
     markers follow the live capture gradient without a visible color lag. */
  return c.r + ',' + c.g + ',' + c.b;
}
function controlZoneVisualKey(zone, color) {
  return controlZoneColorKey(color) + '|' + String(controlZoneCaptureTeam(zone) || 'none') + '|' +
    Math.round(controlZoneCaptureProgress(zone) * 256);
}
function controlZoneColorCss(c, a) {
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + (a == null ? 1 : a) + ')';
}
function controlZoneTerrainHeight(x, z) {
  /* terrainH is the shared terrain-table sampler: it includes the same tbLat /
     dentGrid surface used by the rendered ground and by vehicle physics. */
  if (typeof terrainH === 'function') {
    var h = terrainH(x, z);
    return isFinite(h) ? h : 0;
  }
  if (typeof terrainBaseCached === 'function' && typeof tbLat !== 'undefined' && tbLat) {
    var base = terrainBaseCached(x, z);
    return isFinite(base) ? base : 0;
  }
  return 0;
}

/* Control-area placement is deliberately independent from the combat RNG stream. */
function controlZoneLayoutRng(seed) {
  var s = (typeof hashSeed === 'function' ? hashSeed(seed) : 0x9e3779b9) >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function controlZoneLabelForIndex(index) {
  /* A-Z for the normal battlefield range; continue with AA, AB... only if a
     custom map needs more labels, while keeping every visible character uppercase. */
  var n = index + 1, out = '';
  while (n > 0) { n--; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); }
  return out;
}
function controlZoneRosterCount(team) {
  if (typeof BATTLE_SETUP === 'undefined' || !BATTLE_SETUP[team] || !BATTLE_SETUP[team].roster) return 0;
  var roster = BATTLE_SETUP[team].roster, n = 0;
  for (var key in roster) if (Object.prototype.hasOwnProperty.call(roster, key)) n += Math.max(0, Number(roster[key]) || 0);
  return n;
}
function controlZoneTeamSideSign(team) {
  /* Live centroids are authoritative during a running match; HQ layout is the
     setup fallback before spawnTeams has made teamCounts/aliveList usable. */
  if (typeof gameState !== 'undefined' && gameState === 'playing' && typeof aliveList !== 'undefined' && aliveList && aliveList.length) {
    var sum = 0, n = 0;
    for (var i = 0; i < aliveList.length; i++) {
      var t = aliveList[i];
      if (!t || !t.alive || t.team !== team || !controlZoneIsLandVehicle(t) || !t.group || !t.group.position) continue;
      sum += Number(t.group.position.z) || 0;
      n++;
    }
    if (n && Math.abs(sum) > 1e-6) return sum < 0 ? -1 : 1;
  }
  if (typeof MAP !== 'undefined' && MAP.hqFlat && MAP.hqFlat.baseZ && Math.abs(Number(MAP.hqFlat.baseZ.tank) || 0) > 1e-6) {
    var redSign = (Number(MAP.hqFlat.baseZ.tank) || 0) < 0 ? -1 : 1;
    return team === 'red' ? redSign : -redSign;
  }
  if (typeof spawnFlip === 'number' && spawnFlip !== 0) return team === 'red' ? (spawnFlip < 0 ? -1 : 1) : (spawnFlip < 0 ? 1 : -1);
  return team === 'red' ? 1 : -1;
}
function controlZoneForceSnapshot() {
  var teams = ['red', 'blue'], out = {}, playing = typeof gameState !== 'undefined' && gameState === 'playing';
  var liveReady = playing && typeof teamCounts !== 'undefined' && teamCounts && typeof teamPool !== 'undefined' && teamPool;
  for (var i = 0; i < teams.length; i++) {
    var team = teams[i], setup = typeof BATTLE_SETUP !== 'undefined' ? BATTLE_SETUP[team] : null;
    var active, remaining;
    if (!liveReady) {
      /* If deployment counters are not ready, use the configured roster and
         pool together instead of mixing stale live values with setup values. */
      active = controlZoneRosterCount(team);
      remaining = setup ? Number(setup.pool) : 0;
    } else {
      active = Number(teamCounts[team]);
      remaining = Number(teamPool[team]);
      if (!isFinite(active)) active = controlZoneRosterCount(team);
      if (!isFinite(remaining)) remaining = setup ? Number(setup.pool) : 0;
    }
    if (!isFinite(active)) active = 0;
    if (!isFinite(remaining)) remaining = 0;
    out[team] = {
      active: Math.max(0, active), remaining: Math.max(0, remaining),
      total: Math.max(0, active) + Math.max(0, remaining),
      side: controlZoneTeamSideSign(team)
    };
  }
  var red = out.red.total, blue = out.blue.total, weak = null, strong = null;
  if (red < blue) { weak = 'red'; strong = 'blue'; }
  else if (blue < red) { weak = 'blue'; strong = 'red'; }
  var weakTotal = weak ? out[weak].total : Math.min(red, blue);
  var strongTotal = strong ? out[strong].total : Math.max(red, blue);
  var ratio = strong ? strongTotal / Math.max(1, weakTotal) : 1;
  if (!isFinite(ratio) || ratio < 1) ratio = 1;
  return { red: out.red, blue: out.blue, weak: weak, strong: strong, ratio: ratio,
    weakWeight: strong ? ratio * CONTROL_ZONE_WEAK_WEIGHT_MULTIPLIER : 1, strongWeight: 1 };
}
function controlZoneForceSideWeight(z, force) {
  if (!force || !force.weak) return 1;
  var halfL = Math.max(1, Number(MAP && MAP.halfL) || (Number(MAP && MAP.len) || 0) * 0.5);
  var towardWeak = ((Number(z) || 0) / halfL) * (force[force.weak].side || (force.weak === 'red' ? 1 : -1));
  towardWeak = Math.max(-1, Math.min(1, towardWeak));
  var weakShare = 0.5 + towardWeak * 0.5;
  return force.strongWeight + (force.weakWeight - force.strongWeight) * weakShare;
}
function controlZoneCount() {
  /* Preserve the existing map-size rule for X: one area per 1000m of map width. */
  var width = Math.max(0, Number(MAP && MAP.wid) || 0);
  return Math.max(0, Math.floor(width / 1000));
}
function controlZoneMapBounds() {
  var halfW = Math.max(0, Number(MAP && MAP.halfW) || (Number(MAP && MAP.wid) || 0) * 0.5);
  var halfL = Math.max(0, Number(MAP && MAP.halfL) || (Number(MAP && MAP.len) || 0) * 0.5);
  var edge = CONTROL_ZONE_RADIUS + 4;
  return {
    minX: -Math.max(0, halfW - edge), maxX: Math.max(0, halfW - edge),
    minZ: -Math.max(0, halfL - edge), maxZ: Math.max(0, halfL - edge)
  };
}
function controlZoneClampPoint(x, z) {
  var b = controlZoneMapBounds();
  return {
    x: Math.max(b.minX, Math.min(b.maxX, Number(x) || 0)),
    z: Math.max(b.minZ, Math.min(b.maxZ, Number(z) || 0))
  };
}
function controlZoneDensityVehicles() {
  var out = [];
  if (typeof aliveList === 'undefined' || !aliveList) return out;
  for (var i = 0; i < aliveList.length; i++) {
    var t = aliveList[i];
    if (!controlZoneIsLandVehicle(t) || !t.group || !t.group.position) continue;
    var p = t.group.position;
    out.push({ team: t.team === 'blue' ? 'blue' : 'red', x: Number(p.x) || 0, z: Number(p.z) || 0 });
  }
  return out;
}
function controlZoneAddCandidate(out, x, z) {
  var p = controlZoneClampPoint(x, z);
  /* Candidate deduplication keeps the density pass bounded when many vehicles
     occupy the same spawn point or when a red/blue pair has the same midpoint. */
  for (var i = 0; i < out.length; i++) {
    var dx = out[i].x - p.x, dz = out[i].z - p.z;
    if (dx * dx + dz * dz < 16) return;
  }
  out.push(p);
}
function controlZoneDensityCandidates(vehicles) {
  var out = [], b = controlZoneMapBounds(), i, j;
  for (i = 0; i < vehicles.length; i++) controlZoneAddCandidate(out, vehicles[i].x, vehicles[i].z);
  /* Midpoints of nearby opposing vehicles make simultaneous red/blue presence
     an explicit high-value candidate instead of relying on a coarse grid hit. */
  var pairR = CONTROL_ZONE_DENSITY_RADIUS * 1.8, pairR2 = pairR * pairR;
  for (i = 0; i < vehicles.length; i++) for (j = i + 1; j < vehicles.length; j++) {
    if (vehicles[i].team === vehicles[j].team) continue;
    var pdx = vehicles[i].x - vehicles[j].x, pdz = vehicles[i].z - vehicles[j].z;
    if (pdx * pdx + pdz * pdz > pairR2) continue;
    controlZoneAddCandidate(out, (vehicles[i].x + vehicles[j].x) * 0.5, (vehicles[i].z + vehicles[j].z) * 0.5);
  }
  /* A map-wide grid removes the old middle-band restriction and finds a dense
     area even when units are spread between spawn points rather than centered
     exactly on a vehicle.  The grid is bounded for a predictable 30s update. */
  var spanX = Math.max(1, b.maxX - b.minX), spanZ = Math.max(1, b.maxZ - b.minZ);
  var nx = Math.max(8, Math.min(24, Math.ceil(spanX / 180)));
  var nz = Math.max(8, Math.min(24, Math.ceil(spanZ / 180)));
  var rng = controlZoneLayoutRng(String(MAP && MAP.seed || '0') + '|CONTROL-DENSITY');
  for (i = 0; i <= nx; i++) for (j = 0; j <= nz; j++) {
    var gx = b.minX + spanX * i / nx, gz = b.minZ + spanZ * j / nz;
    var jx = (rng() - 0.5) * spanX / nx * 0.22;
    var jz = (rng() - 0.5) * spanZ / nz * 0.22;
    controlZoneAddCandidate(out, gx + jx, gz + jz);
  }
  return out;
}
function controlZoneDensityParts(x, z, vehicles) {
  var red = 0, blue = 0, radius2 = CONTROL_ZONE_DENSITY_RADIUS * CONTROL_ZONE_DENSITY_RADIUS;
  var sigma2 = CONTROL_ZONE_DENSITY_SIGMA * CONTROL_ZONE_DENSITY_SIGMA * 2;
  for (var i = 0; i < vehicles.length; i++) {
    var dx = vehicles[i].x - x, dz = vehicles[i].z - z, d2 = dx * dx + dz * dz;
    if (d2 > radius2) continue;
    var w = Math.exp(-d2 / sigma2);
    if (vehicles[i].team === 'blue') blue += w; else red += w;
  }
  return { red: red, blue: blue, total: red + blue };
}
function controlZoneDensityScore(x, z, vehicles) {
  var parts = controlZoneDensityParts(x, z, vehicles), mixed = Math.min(parts.red, parts.blue);
  /* This remains a diagnostic/raw density score.  Initial and moving placement
     use the gap score below, so raw density no longer attracts zones by itself. */
  return parts.total + mixed * 4.0 + Math.sqrt(Math.max(0, parts.red * parts.blue)) * 1.5;
}
function controlZoneHighDensityAnchors(vehicles, candidates, team) {
  var scored = [], i, value;
  for (i = 0; i < candidates.length; i++) {
    var p = controlZoneDensityParts(candidates[i].x, candidates[i].z, vehicles);
    value = team === 'blue' ? p.blue : p.red;
    if (value > 0.02) scored.push({ x: candidates[i].x, z: candidates[i].z, value: value });
  }
  scored.sort(function (a, b) { return b.value - a.value; });
  var out = [], minSep2 = Math.pow(CONTROL_ZONE_DENSITY_RADIUS * 0.78, 2);
  for (i = 0; i < scored.length && out.length < 8; i++) {
    var ok = true;
    for (var j = 0; j < out.length; j++) {
      var dx = scored[i].x - out[j].x, dz = scored[i].z - out[j].z;
      if (dx * dx + dz * dz < minSep2) { ok = false; break; }
    }
    if (ok) out.push(scored[i]);
  }
  return out;
}
function controlZoneGapCandidates(vehicles) {
  var base = controlZoneDensityCandidates(vehicles), gaps = [], red = controlZoneHighDensityAnchors(vehicles, base, 'red');
  var blue = controlZoneHighDensityAnchors(vehicles, base, 'blue');
  var i, j;
  /* Retain the map-wide candidates as fallbacks, then add explicitly sampled
     points along every red/blue high-density corridor. */
  for (i = 0; i < base.length; i++) controlZoneAddCandidate(gaps, base[i].x, base[i].z);
  for (i = 0; i < red.length; i++) for (j = 0; j < blue.length; j++) {
    var dx = blue[j].x - red[i].x, dz = blue[j].z - red[i].z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < CONTROL_ZONE_MIN_GAP * 1.2) continue;
    var steps = Math.max(7, Math.min(15, Math.ceil(d / 150)));
    for (var k = 1; k < steps; k++) {
      var u = k / steps;
      /* Keep the samples away from the dense endpoints: the control area is a
         deliberate engagement gap, not a spawn-point objective. */
      if (u < 0.16 || u > 0.84) continue;
      controlZoneAddCandidate(gaps, red[i].x + dx * u, red[i].z + dz * u);
    }
  }
  return { candidates: gaps, red: red, blue: blue };
}
function controlZoneGapScore(x, z, vehicles, anchors, force) {
  var parts = controlZoneDensityParts(x, z, vehicles), best = 0;
  var corridorW = CONTROL_ZONE_DENSITY_RADIUS * 0.72;
  for (var i = 0; i < anchors.red.length; i++) for (var j = 0; j < anchors.blue.length; j++) {
    var r = anchors.red[i], b = anchors.blue[j], dx = b.x - r.x, dz = b.z - r.z;
    var d2 = dx * dx + dz * dz, d = Math.sqrt(d2);
    if (d < CONTROL_ZONE_MIN_GAP * 1.2) continue;
    var u = ((x - r.x) * dx + (z - r.z) * dz) / d2;
    if (u < 0.12 || u > 0.88) continue;
    var lineDist = Math.abs((x - r.x) * dz - (z - r.z) * dx) / d;
    var corridor = Math.exp(-(lineDist * lineDist) / (2 * corridorW * corridorW));
    var centerBias = Math.sin(Math.PI * u);
    var balance = 1 - Math.min(1, Math.abs(u - 0.5) * 1.8);
    var endpointStrength = Math.sqrt(r.value * b.value);
    /* Low local density is the key term.  Endpoint strength says that this
       empty space is genuinely between two high-density armies, not merely an
       arbitrary quiet corner of the map. */
    var gap = endpointStrength * corridor * (0.35 + 0.65 * centerBias) * (0.45 + 0.55 * balance) /
      (1 + parts.total * 1.85);
    if (gap > best) best = gap;
  }
  if (best > 0) return best * controlZoneForceSideWeight(z, force);
  /* If only one side has a usable cluster, keep the feature alive by preferring
     sparse map points rather than returning to the old dense-cluster behavior. */
  return (0.08 / (1 + parts.total * 1.85)) * controlZoneForceSideWeight(z, force);
}
function controlZonePointIsClear(x, z, blocked) {
  var gap2 = CONTROL_ZONE_MIN_GAP * CONTROL_ZONE_MIN_GAP;
  for (var i = 0; i < blocked.length; i++) {
    var q = blocked[i], dx = x - q.x, dz = z - q.z;
    if (dx * dx + dz * dz < gap2 - 1e-6) return false;
  }
  return true;
}
function controlZoneSelectPositions(count, vehicles, blocked, force) {
  var gapData = controlZoneGapCandidates(vehicles), candidates = gapData.candidates, scored = [];
  var rng = controlZoneLayoutRng(String(MAP && MAP.seed || '0') + '|CONTROL-GAP-PICK|' + _controlZoneEpoch);
  for (var i = 0; i < candidates.length; i++) {
    scored.push({ x: candidates[i].x, z: candidates[i].z,
      score: controlZoneGapScore(candidates[i].x, candidates[i].z, vehicles, gapData, force), tie: rng() });
  }
  scored.sort(function (a, b) { return b.score - a.score || b.tie - a.tie; });
  var chosen = [], occupied = blocked ? blocked.slice() : [];
  for (i = 0; i < scored.length && chosen.length < count; i++) {
    if (!controlZonePointIsClear(scored[i].x, scored[i].z, occupied)) continue;
    chosen.push({ x: scored[i].x, z: scored[i].z });
    occupied.push(chosen[chosen.length - 1]);
  }
  /* Very small/custom maps can exhaust the sampled grid.  Keep the no-overlap
     contract by using deterministic random points before accepting a final
     clamped fallback. */
  var fallbackRng = controlZoneLayoutRng(String(MAP && MAP.seed || '0') + '|CONTROL-FALLBACK|' + _controlZoneEpoch);
  var b = controlZoneMapBounds(), tries = 0;
  while (chosen.length < count && tries++ < count * 500) {
    var x = b.minX + fallbackRng() * Math.max(1, b.maxX - b.minX);
    var z = b.minZ + fallbackRng() * Math.max(1, b.maxZ - b.minZ);
    if (!controlZonePointIsClear(x, z, occupied)) continue;
    var point = { x: x, z: z }; chosen.push(point); occupied.push(point);
  }
  return chosen;
}
function controlZoneCreate(index, x, z) {
  return {
    id: controlZoneLabelForIndex(index), index: index,
    x: x, z: z, cz: z, radius: CONTROL_ZONE_RADIUS,
    owner: null, captureTeam: null, captureFrom: null, progress: 0,
    completedAt: -1, nextIncomeT: Infinity,
    redCount: 0, blueCount: 0, group: null, ring: null, ringProgress: null,
    label: null, _visualKey: '', _groundY: 0, _controlZoneEpoch: _controlZoneEpoch
  };
}
function controlZoneLayout() {
  var count = controlZoneCount(), vehicles = controlZoneDensityVehicles(), force = controlZoneForceSnapshot();
  var positions = controlZoneSelectPositions(count, vehicles, [], force), out = [];
  for (var i = 0; i < positions.length; i++) out.push(controlZoneCreate(i, positions[i].x, positions[i].z));
  return out;
}
function controlZonesNotifyAiLayoutChanged() {
  if (typeof aliveList === 'undefined' || !aliveList) return;
  for (var i = 0; i < aliveList.length; i++) {
    var t = aliveList[i];
    if (!t || !t.ai) continue;
    t.ai._controlZoneTargetId = null;
    t.ai._controlZoneTargetEpoch = -1;
    t.ai.destT = 0;
    if (t._cmdG && !t._cmdG._detached) t._cmdG._controlTarget = null;
  }
}
function controlZoneBestMovePosition(zone, vehicles, others, force) {
  var gapData = controlZoneGapCandidates(vehicles), candidates = gapData.candidates, best = { x: zone.x, z: zone.cz };
  controlZoneAddCandidate(candidates, zone.x, zone.cz);
  var bestScore = controlZoneGapScore(zone.x, zone.cz, vehicles, gapData, force), bestValue = bestScore;
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (!controlZonePointIsClear(c.x, c.z, others)) continue;
    var score = controlZoneGapScore(c.x, c.z, vehicles, gapData, force);
    var dx = c.x - zone.x, dz = c.z - zone.cz;
    /* A small travel penalty prevents equal-density oscillation while still
       allowing a materially denser region anywhere on the map to win. */
    var value = score - Math.sqrt(dx * dx + dz * dz) * 0.0015;
    if (value > bestValue + 0.05) { bestValue = value; bestScore = score; best = c; }
  }
  return { x: best.x, z: best.z, score: bestScore };
}
function controlZoneMoveVisual(zone) {
  if (!zone || !zone.group) return;
  var gy = controlZoneTerrainHeight(zone.x, zone.cz);
  zone._groundY = gy;
  zone.group.position.set(zone.x, gy, zone.cz);
  if (zone.ring) controlZoneRefreshRing(zone, gy);
  zone._visualKey = '';
  controlZoneVisualSync(zone, true);
}
function controlZonesGenerateInitial(now) {
  var count = controlZoneCount();
  if (count <= 0) return false;
  _controlZoneEpoch++;
  var vehicles = controlZoneDensityVehicles();
  var force = controlZoneForceSnapshot();
  var positions = controlZoneSelectPositions(count, vehicles, [], force), next = [];
  for (var i = 0; i < positions.length; i++) next.push(controlZoneCreate(i, positions[i].x, positions[i].z));
  controlZones = next;
  _controlZoneNextMoveT = now + CONTROL_ZONE_MOVE_INTERVAL;
  _controlZoneVisualsReady = false;
  if (typeof controlZonesBuildVisuals === 'function') controlZonesBuildVisuals();
  controlZonesNotifyAiLayoutChanged();
  if (typeof aimHint === 'function') aimHint('COMMANDER HAS PLANNED THE BATTLEFIELD FOCUS');
  return controlZones.length > 0;
}
function controlZonesMoveExisting() {
  if (!controlZones.length) return false;
  var vehicles = controlZoneDensityVehicles(), force = controlZoneForceSnapshot(), changed = false;
  for (var i = 0; i < controlZones.length; i++) {
    var zone = controlZones[i], others = [];
    for (var j = 0; j < controlZones.length; j++) if (j !== i) others.push(controlZones[j]);
    var next = controlZoneBestMovePosition(zone, vehicles, others, force);
    if (Math.abs(next.x - zone.x) > 1e-6 || Math.abs(next.z - zone.cz) > 1e-6) {
      zone.x = next.x; zone.z = next.z; zone.cz = next.z; zone._controlZoneEpoch = _controlZoneEpoch + 1;
      controlZoneMoveVisual(zone); changed = true;
    }
  }
  if (changed) {
    _controlZoneEpoch++;
    for (i = 0; i < controlZones.length; i++) controlZones[i]._controlZoneEpoch = _controlZoneEpoch;
    controlZonesNotifyAiLayoutChanged();
  }
  return changed;
}

function controlZoneTerrainRingGeometry(zone, groundY) {
  if (!zone || typeof THREE === 'undefined' || !THREE.BufferGeometry || !THREE.BufferAttribute) return null;
  var segments = CONTROL_ZONE_RING_SEGMENTS, sides = CONTROL_ZONE_RING_SIDES;
  var tube = CONTROL_ZONE_RING_TUBE, clearance = CONTROL_ZONE_RING_CLEARANCE;
  var samples = new Array(segments), positions = new Float32Array(segments * sides * 3);
  var i, j;
  for (i = 0; i < segments; i++) {
    var a = i / segments * Math.PI * 2;
    var sx = Math.cos(a) * CONTROL_ZONE_RADIUS;
    var sz = Math.sin(a) * CONTROL_ZONE_RADIUS;
    samples[i] = {
      x: sx,
      y: controlZoneTerrainHeight(zone.x + sx, zone.cz + sz) - groundY + clearance,
      z: sz
    };
  }
  for (i = 0; i < segments; i++) {
    var prev = samples[(i + segments - 1) % segments], cur = samples[i], next = samples[(i + 1) % segments];
    var tx = next.x - prev.x, ty = next.y - prev.y, tz = next.z - prev.z;
    var tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    var a0 = i / segments * Math.PI * 2;
    var rx = Math.cos(a0), rz = Math.sin(a0);
    /* radial × terrain-normal frame: the second axis stays above the shared
       ground surface even when the capture boundary crosses a slope. */
    var nx = ty * rz, ny = tz * rx - tx * rz, nz = -ty * rx;
    var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    for (j = 0; j < sides; j++) {
      var phi = j / sides * Math.PI * 2;
      var cp = Math.cos(phi) * tube, sp = Math.sin(phi) * tube;
      var vi = (i * sides + j) * 3;
      positions[vi] = cur.x + rx * cp + nx * sp;
      positions[vi + 1] = cur.y + ny * sp;
      positions[vi + 2] = cur.z + rz * cp + nz * sp;
    }
  }
  var indices = new Uint16Array(segments * sides * 6), ip = 0;
  for (i = 0; i < segments; i++) {
    var ni = (i + 1) % segments;
    for (j = 0; j < sides; j++) {
      var nj = (j + 1) % sides;
      var a1 = i * sides + j, b1 = ni * sides + j, c1 = ni * sides + nj, d1 = i * sides + nj;
      indices[ip++] = a1; indices[ip++] = b1; indices[ip++] = d1;
      indices[ip++] = b1; indices[ip++] = c1; indices[ip++] = d1;
    }
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  if (geo.computeVertexNormals) geo.computeVertexNormals();
  if (geo.computeBoundingSphere) geo.computeBoundingSphere();
  geo.userData = geo.userData || {};
  geo.userData.controlZoneTerrainRing = true;
  geo.userData.controlZoneRingSegments = segments;
  geo.userData.controlZoneRingIndexCount = indices.length;
  return geo;
}
function controlZoneRefreshRing(zone, groundY) {
  if (!zone || !zone.ring) return;
  var nextGeo = controlZoneTerrainRingGeometry(zone, groundY);
  var nextProgressGeo = zone.ringProgress ? controlZoneTerrainRingGeometry(zone, groundY) : null;
  if (!nextGeo || (zone.ringProgress && !nextProgressGeo)) return;
  var oldGeo = zone.ring.geometry;
  var oldProgressGeo = zone.ringProgress && zone.ringProgress.geometry;
  zone.ring.geometry = nextGeo;
  if (zone.ringProgress) zone.ringProgress.geometry = nextProgressGeo;
  if (oldGeo && oldGeo.dispose) oldGeo.dispose();
  if (oldProgressGeo && oldProgressGeo !== oldGeo && oldProgressGeo.dispose) oldProgressGeo.dispose();
  zone._ringEpoch = typeof dentEpoch === 'number' ? dentEpoch : -1;
}
function controlZoneDisposeVisual(zone) {
  if (!zone || !zone.group) return;
  if (typeof scene !== 'undefined' && scene) scene.remove(zone.group);
  zone.group.traverse(function (obj) {
    if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
    if (obj.material) {
      if (obj.material.map && obj.material.map.dispose) obj.material.map.dispose();
      if (obj.material.dispose) obj.material.dispose();
    }
  });
  zone.group = null; zone.ring = null; zone.ringProgress = null; zone.label = null;
}
function controlZoneLabelTexture(zone, color) {
  if (typeof document === 'undefined') return null;
  var c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  var g = c.getContext('2d');
  var captureTeam = controlZoneCaptureTeam(zone);
  var captureProgress = controlZoneCaptureProgress(zone);
  var fillColor = captureTeam ? controlZoneTeamColor(captureTeam) : CONTROL_ZONE_WHITE;
  var markerColor = captureTeam && captureProgress >= 1 - 1e-9 ? fillColor : CONTROL_ZONE_WHITE;
  var fillCss = controlZoneColorCss(fillColor, 0.82);
  g.clearRect(0, 0, 128, 128);
  g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2);
  g.fillStyle = 'rgba(7,11,8,.88)'; g.fill();
  if (captureProgress > 0 && captureTeam) {
    /* The floating badge is a liquid fill: the faction color rises from the
       bottom while the unfilled upper portion stays dark. */
    var bottom = 118, level = bottom - 108 * captureProgress;
    g.save();
    g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.clip();
    g.fillStyle = fillCss;
    g.fillRect(9, level, 110, bottom - level + 2);
    g.strokeStyle = controlZoneColorCss(fillColor, 0.96); g.lineWidth = 2;
    g.beginPath();
    g.moveTo(10, level);
    g.quadraticCurveTo(28, level - 1.5, 46, level);
    g.quadraticCurveTo(64, level + 1.5, 82, level);
    g.quadraticCurveTo(100, level - 1.5, 118, level);
    g.stroke();
    g.restore();
  }
  g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2);
  g.strokeStyle = '#101610'; g.lineWidth = 10; g.stroke();
  /* Before completion, keep the frame, upper background, and number neutral;
     only the clipped lower liquid fill carries the faction color. */
  g.strokeStyle = controlZoneColorCss(markerColor, .98); g.lineWidth = 5; g.stroke();
  g.fillStyle = 'rgba(244,244,236,.10)'; g.fill();
  g.font = 'bold 62px Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.strokeStyle = 'rgba(4,8,4,.96)'; g.lineWidth = 9;
  g.strokeText(zone.id, 64, 67);
  g.fillStyle = controlZoneColorCss(markerColor, 1);
  g.fillText(zone.id, 64, 67);
  return new THREE.CanvasTexture(c);
}
function controlZoneVisualSync(zone, force) {
  if (!zone || !zone.group || !zone.ring || !zone.label) return;
  var color = controlZoneColor(zone), key = controlZoneVisualKey(zone, color);
  var captureTeam = controlZoneCaptureTeam(zone), captureProgress = controlZoneCaptureProgress(zone);
  zone.ring.material.color.setRGB(CONTROL_ZONE_WHITE.r / 255, CONTROL_ZONE_WHITE.g / 255, CONTROL_ZONE_WHITE.b / 255);
  zone.ring.material.opacity = 0.72;
  if (zone.ringProgress) {
    var factionColor = captureTeam ? controlZoneTeamColor(captureTeam) : CONTROL_ZONE_WHITE;
    zone.ringProgress.material.color.setRGB(factionColor.r / 255, factionColor.g / 255, factionColor.b / 255);
    zone.ringProgress.material.opacity = captureProgress > 0 ? 0.96 : 0;
    var ringGeo = zone.ringProgress.geometry;
    var ringSegments = ringGeo && ringGeo.userData ? ringGeo.userData.controlZoneRingSegments : CONTROL_ZONE_RING_SEGMENTS;
    var ringIndexCount = ringGeo && ringGeo.userData ? ringGeo.userData.controlZoneRingIndexCount : ringSegments * CONTROL_ZONE_RING_SIDES * 6;
    var segmentCount = Math.floor(ringSegments * captureProgress);
    if (ringGeo && ringGeo.setDrawRange) ringGeo.setDrawRange(0, Math.min(ringIndexCount, segmentCount * CONTROL_ZONE_RING_SIDES * 6));
  }
  if (force || zone._visualKey !== key) {
    var oldMap = zone.label.material.map;
    var tex = controlZoneLabelTexture(zone, color);
    if (tex) {
      zone.label.material.map = tex;
      zone.label.material.needsUpdate = true;
      if (oldMap && oldMap.dispose) oldMap.dispose();
    }
    zone._visualKey = key;
  }
}
function controlZonesBuildVisuals() {
  if (!controlZonesActive() || typeof THREE === 'undefined' || typeof scene === 'undefined' || !scene) return;
  for (var i = 0; i < controlZones.length; i++) {
    var z = controlZones[i];
    controlZoneDisposeVisual(z);
    var root = new THREE.Group();
    var groundY = controlZoneTerrainHeight(z.x, z.cz);
    var ringMat = new THREE.MeshBasicMaterial({ color: 0xf4f4ec, transparent: true, opacity: 0.72, depthTest: true, depthWrite: false, side: THREE.DoubleSide });
    var ringGeo = controlZoneTerrainRingGeometry(z, groundY);
    var ring = new THREE.Mesh(ringGeo, ringMat);
    ring.frustumCulled = false;
    root.add(ring);
    var ringProgressMat = new THREE.MeshBasicMaterial({ color: 0xf4f4ec, transparent: true, opacity: 0.96, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    var ringProgress = new THREE.Mesh(controlZoneTerrainRingGeometry(z, groundY), ringProgressMat);
    ringProgress.frustumCulled = false;
    ringProgress.renderOrder = 2;
    root.add(ringProgress);
    var tex = controlZoneLabelTexture(z, CONTROL_ZONE_WHITE);
    var labelMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false, opacity: 0.96, sizeAttenuation: true });
    var label = new THREE.Sprite(labelMat);
    label.scale.set(10.5, 10.5, 1);
    label.position.y = 11.0;
    root.add(label);
    root.position.set(z.x, groundY, z.cz);
    root.frustumCulled = false;
    scene.add(root);
    z.group = root; z.ring = ring; z.ringProgress = ringProgress; z.label = label; z._groundY = groundY; z._visualKey = '';
    z._ringEpoch = typeof dentEpoch === 'number' ? dentEpoch : -1;
    controlZoneVisualSync(z, true);
  }
  _controlZoneVisualsReady = true;
}

function controlZonesPrepare() {
  controlZonesReset();
  _controlZoneMatchStartT = -1;
  _controlZoneNextSpawnT = Infinity;
  _controlZoneNextMoveT = Infinity;
  if (!controlZonesEnabled()) return;
  /* The map is left untouched here.  Areas are selected from live land-unit
     density after the match has been running for CONTROL_ZONE_START_DELAY. */
  _controlZoneVisualsReady = false;
}
function controlZonesReset() {
  for (var i = 0; i < controlZones.length; i++) controlZoneDisposeVisual(controlZones[i]);
  controlZones.length = 0;
  _controlZoneVisualsReady = false;
  _controlZoneRepairHudKey = '';
  _controlZoneCaptureHudKey = '';
  _controlZoneMatchStartT = -1;
  _controlZoneNextSpawnT = Infinity;
  _controlZoneNextMoveT = Infinity;
  _controlZoneEpoch++;
  if (typeof player !== 'undefined' && player) controlZoneRepairReset(player);
  if (typeof strategicSupportReset === 'function') strategicSupportReset();
  controlZoneRepairHudUpdate(null);
  controlZoneCaptureHudUpdate(null);
}
function controlZoneAtVehicle(t) {
  if (!controlZonesActive() || !controlZoneIsLandVehicle(t)) return null;
  for (var i = 0; i < controlZones.length; i++) if (controlZoneContainsVehicle(controlZones[i], t)) return controlZones[i];
  return null;
}
function controlZoneCounts(zone) {
  var red = 0, blue = 0;
  if (typeof aliveList === 'undefined' || !aliveList) return { red: 0, blue: 0 };
  for (var i = 0; i < aliveList.length; i++) {
    var t = aliveList[i];
    if (!controlZoneContainsVehicle(zone, t)) continue;
    if (t.team === 'red') red++;
    else if (t.team === 'blue') blue++;
  }
  return { red: red, blue: blue };
}
function controlZoneCaptureEfficiency(n) {
  var sum = 0, term = 1;
  for (var i = 0; i < n; i++) { sum += term; term *= 0.5; }
  return sum;
}
function controlZoneStartCapture(zone, team) {
  if (zone.captureTeam === team) return;
  zone.captureTeam = team;
  zone.captureFrom = zone.owner || null;
  zone.progress = zone.owner === team ? 1 : 0;
}
function controlZoneComplete(zone, team) {
  zone.owner = team;
  zone.captureTeam = team;
  zone.captureFrom = team;
  zone.progress = 1;
  zone.completedAt = gameT;
  zone.nextIncomeT = gameT + CONTROL_ZONE_INCOME_INTERVAL;
}
function controlZoneIncomeTick(zone) {
  if (!zone.owner || !isFinite(zone.nextIncomeT) || typeof teamPool === 'undefined') return;
  if (gameT < zone.nextIncomeT) return;
  var n = Math.floor((gameT - zone.nextIncomeT) / CONTROL_ZONE_INCOME_INTERVAL) + 1;
  var foe = controlZoneOtherTeam(zone.owner);
  teamPool[zone.owner] += n;
  teamPool[foe] = Math.max(0, teamPool[foe] - n);
  zone.nextIncomeT += n * CONTROL_ZONE_INCOME_INTERVAL;
}
function controlZoneUpdate(zone, dt) {
  var c = controlZoneCounts(zone);
  zone.redCount = c.red; zone.blueCount = c.blue;
  var solo = c.red > 0 && c.blue === 0 ? 'red' : (c.blue > 0 && c.red === 0 ? 'blue' : null);
  if (solo) {
    if (zone.owner === solo) {
      zone.captureTeam = solo; zone.captureFrom = solo; zone.progress = 1;
    } else {
      controlZoneStartCapture(zone, solo);
      zone.progress += Math.max(0, dt) * controlZoneCaptureEfficiency(solo === 'red' ? c.red : c.blue) / CONTROL_ZONE_CAPTURE_TIME;
      if (zone.progress >= 1 - 1e-9) controlZoneComplete(zone, solo);
    }
  }
  /* No occupants pauses progress. Two teams present also pauses progress. */
  controlZoneIncomeTick(zone);
  if (zone.group) {
    var gy = controlZoneTerrainHeight(zone.x, zone.cz);
    if (isFinite(gy)) {
      zone._groundY = gy;
      zone.group.position.y = gy;
      var currentEpoch = typeof dentEpoch === 'number' ? dentEpoch : -1;
      if (zone.ring && zone._ringEpoch !== currentEpoch) controlZoneRefreshRing(zone, gy);
    }
    controlZoneVisualSync(zone, false);
  }
}

function controlZoneCaptureRemainingSeconds(zone, team) {
  if (!zone || !team || zone.owner === team) return 0;
  var remaining = 1 - controlZoneClamp01(zone.progress || 0);
  if (remaining <= 1e-9) return 0;
  var count = team === 'red' ? Number(zone.redCount) || 0 : Number(zone.blueCount) || 0;
  var efficiency = controlZoneCaptureEfficiency(count);
  if (count <= 0 || efficiency <= 0) return Infinity;
  return remaining * CONTROL_ZONE_CAPTURE_TIME / efficiency;
}
function controlZoneCaptureHudHide() {
  if (typeof document === 'undefined') return;
  var root = document.getElementById('control-zone-capture-hud');
  if (!root) return;
  root.classList.add('hidden'); root.setAttribute('aria-hidden', 'true'); root.removeAttribute('data-state');
  _controlZoneCaptureHudKey = '';
}
function controlZoneCaptureHudUpdate(t) {
  if (typeof document === 'undefined') return;
  var root = document.getElementById('control-zone-capture-hud');
  if (!root) return;
  if (!t || t !== player || t.isPlayer !== true || !t.alive || !controlZonesActive() || !controlZoneIsLandVehicle(t)) {
    controlZoneCaptureHudHide();
    return;
  }
  var zone = controlZoneAtVehicle(t);
  if (!zone || zone.owner === t.team) {
    controlZoneCaptureHudHide();
    return;
  }
  var ownCount = t.team === 'red' ? zone.redCount : zone.blueCount;
  if (!(ownCount > 0) || controlZoneClamp01(zone.progress || 0) >= 1 - 1e-9) {
    controlZoneCaptureHudHide();
    return;
  }
  var foeCount = t.team === 'red' ? zone.blueCount : zone.redCount;
  var contested = foeCount > 0;
  var eta = controlZoneCaptureRemainingSeconds(zone, t.team);
  var color = controlZoneTeamColor(t.team);
  var cssColor = 'rgb(' + color.r + ',' + color.g + ',' + color.b + ')';
  root.classList.remove('hidden'); root.setAttribute('aria-hidden', 'false');
  root.setAttribute('data-state', contested ? 'CONTESTED' : 'CAPTURING');
  root.style.setProperty('--pu-color', cssColor);
  var slot = root.querySelector('.control-zone-capture-slot');
  if (slot) slot.style.setProperty('--pu-color', contested ? '#ffd447' : cssColor);
  var icon = document.getElementById('control-zone-capture-icon');
  if (icon) {
    icon.style.setProperty('--pu-color', cssColor);
    icon.style.setProperty('--pu-progress', String(controlZoneClamp01(zone.progress || 0)));
    icon.style.background = 'conic-gradient(' + cssColor + ' ' + (controlZoneClamp01(zone.progress || 0) * 360).toFixed(1) + 'deg, rgba(20,25,20,.92) 0deg)';
  }
  var label = document.getElementById('control-zone-capture-label');
  if (label) label.textContent = 'CAPTURING';
  var time = document.getElementById('control-zone-capture-time');
  if (time) time.textContent = isFinite(eta) ? Math.max(0, eta).toFixed(1) + 's' : 'PAUSED';
  var note = document.getElementById('control-zone-capture-note');
  if (note) note.textContent = 'CONTROL ZONE // ' + String(zone.id) + (contested ? ' // CONTESTED' : ' // ' + ownCount + (ownCount === 1 ? ' VEHICLE' : ' VEHICLES'));
  var detail = document.getElementById('control-zone-capture-detail');
  if (detail) detail.textContent = contested
    ? 'CAPTURE PAUSED // ' + (isFinite(eta) ? Math.max(0, eta).toFixed(1) + 's REMAINING' : 'WAITING')
    : 'ETA // ' + (isFinite(eta) ? Math.max(0, eta).toFixed(1) + 's' : 'PAUSED');
}

function controlZoneRepairState(t) {
  if (!t._controlZoneRepair) t._controlZoneRepair = {
    zoneId: null, stationaryT: 0, active: false, target: null, status: 'READY', countdown: 0
  };
  return t._controlZoneRepair;
}
function controlZoneRepairReset(t) {
  if (!t) return;
  var st = t._controlZoneRepair;
  if (!st) return;
  st.zoneId = null; st.stationaryT = 0; st.active = false; st.target = null; st.status = 'READY'; st.countdown = 0;
}
function controlZoneRepairPickTarget(t) {
  if (!t || !t.mods) return null;
  var best = null, bestFrac = Infinity, bestDamage = -Infinity;
  for (var i = 0; i < CONTROL_ZONE_REPAIR_KEYS.length; i++) {
    var key = CONTROL_ZONE_REPAIR_KEYS[i], mod = t.mods[key];
    if (!mod || mod.structural || !(Number(mod.max) > 0)) continue;
    var max = Number(mod.max), hp = Math.max(0, Number(mod.hp) || 0), damage = max - hp;
    if (hp >= max - 1e-9) continue;
    var frac = hp / max;
    if (frac < bestFrac - 1e-12 || (Math.abs(frac - bestFrac) < 1e-12 && damage > bestDamage)) {
      bestFrac = frac; bestDamage = damage;
      best = { key: key, mod: mod, max: max, cap: max };
    }
  }
  return best;
}
function controlZoneRepairTick(t, dt) {
  if (!t || t !== player || t.isPlayer !== true || !t.alive || !controlZonesActive() || !controlZoneIsLandVehicle(t)) {
    if (t) controlZoneRepairReset(t);
    return;
  }
  var zone = controlZoneAtVehicle(t), st = controlZoneRepairState(t);
  var stopped = Math.abs(Number(t.speed) || 0) <= 0.05;
  if (!zone || zone.owner !== t.team || !stopped) {
    controlZoneRepairReset(t);
    return;
  }
  if (st.zoneId !== zone.id) {
    st.zoneId = zone.id; st.stationaryT = 0; st.active = false; st.target = null;
  }
  var stepDt = Math.max(0, Number(dt) || 0), previousStationaryT = st.stationaryT;
  st.stationaryT += stepDt;
  if (st.stationaryT < CONTROL_ZONE_REPAIR_STOP_DELAY) {
    st.active = false; st.target = null; st.status = 'PREPARING';
    st.countdown = Math.max(0, CONTROL_ZONE_REPAIR_STOP_DELAY - st.stationaryT);
    return;
  }
  /* If this step crosses the five-second gate, only the post-gate fraction
     repairs; the preparation portion must not become free HP. */
  var repairDt = previousStationaryT < CONTROL_ZONE_REPAIR_STOP_DELAY
    ? Math.max(0, st.stationaryT - CONTROL_ZONE_REPAIR_STOP_DELAY) : stepDt;
  var target = controlZoneRepairPickTarget(t);
  if (!target) {
    st.active = false; st.target = null; st.status = 'READY'; st.countdown = 0;
    return;
  }
  st.active = true; st.status = 'REPAIRING'; st.countdown = 0; st.target = target.key;
  target.mod.hp = Math.min(target.max, Math.max(0, Number(target.mod.hp) || 0) + CONTROL_ZONE_REPAIR_RATE * repairDt);
  if (typeof effSync === 'function') effSync(t);
  if (typeof playerHudDamage === 'function') playerHudDamage(target.key);
}
function controlZoneRepairHudUpdate(t) {
  if (typeof document === 'undefined') return;
  var root = document.getElementById('control-zone-repair-hud');
  if (!root) return;
  if (!t || t !== player || t.isPlayer !== true || !t.alive || !controlZonesActive() || !controlZoneIsLandVehicle(t)) {
    root.classList.add('hidden'); root.setAttribute('aria-hidden', 'true'); root.removeAttribute('data-state');
    _controlZoneRepairHudKey = '';
    return;
  }
  var repairZone = controlZoneAtVehicle(t);
  if (!repairZone || repairZone.owner !== t.team) {
    root.classList.add('hidden'); root.setAttribute('aria-hidden', 'true'); root.removeAttribute('data-state');
    _controlZoneRepairHudKey = '';
    return;
  }
  var st = t._controlZoneRepair;
  if (!st || !st.zoneId) {
    root.classList.add('hidden'); root.setAttribute('aria-hidden', 'true'); root.removeAttribute('data-state');
    _controlZoneRepairHudKey = '';
    return;
  }
  var state = st.active ? 'REPAIRING' : (st.status === 'PREPARING' ? 'PREPARING' : 'READY');
  var mod = st.target && t.mods && t.mods[st.target];
  var max = mod && Number(mod.max) > 0 ? Number(mod.max) : 1;
  var hp = mod ? Math.max(0, Number(mod.hp) || 0) : 0;
  var progress = state === 'PREPARING'
    ? Math.max(0, Math.min(1, 1 - st.countdown / CONTROL_ZONE_REPAIR_STOP_DELAY))
    : (state === 'REPAIRING' ? Math.max(0, Math.min(1, hp / max)) : 1);
  var color = state === 'PREPARING' ? '#ffd447' : '#9dffa8';
  root.classList.remove('hidden'); root.setAttribute('aria-hidden', 'false'); root.setAttribute('data-state', state);
  root.style.setProperty('--pu-color', color);
  var icon = document.getElementById('control-zone-repair-icon');
  if (icon) {
    icon.style.setProperty('--pu-color', color);
    icon.style.setProperty('--pu-progress', String(progress));
    icon.style.background = 'conic-gradient(' + color + ' ' + (progress * 360).toFixed(1) + 'deg, rgba(20,25,20,.92) 0deg)';
  }
  var label = document.getElementById('control-zone-repair-label');
  if (label) label.textContent = state;
  var time = document.getElementById('control-zone-repair-time');
  if (time) time.textContent = state === 'PREPARING' ? st.countdown.toFixed(1) + 's' : (state === 'REPAIRING' ? CONTROL_ZONE_REPAIR_RATE + ' HP/S' : 'FULL');
  var note = document.getElementById('control-zone-repair-note');
  if (note) note.textContent = state === 'REPAIRING' ? 'CONTROL ZONE // ' + String(st.zoneId) + ' // ' + String(st.target || 'MODULE').toUpperCase() :
    (state === 'PREPARING' ? 'CONTROL ZONE // STOPPED' : 'CONTROL ZONE // READY');
  var detail = document.getElementById('control-zone-repair-detail');
  if (detail) detail.textContent = state === 'REPAIRING' ? Math.round(hp) + ' / ' + Math.round(max) + ' HP' :
    (state === 'PREPARING' ? 'REPAIR IN ' + st.countdown.toFixed(1) + 's' : 'ALL MODULES READY');
}
function controlZoneRepairHudTick() { controlZoneRepairHudUpdate(typeof player !== 'undefined' ? player : null); }

function controlZonesTick(dt) {
  var playing = typeof gameState === 'undefined' || gameState === 'playing';
  if (!playing) {
    if (controlZones.length || _controlZoneMatchStartT >= 0) controlZonesReset();
    if (typeof player !== 'undefined') controlZoneRepairReset(player);
    controlZoneRepairHudUpdate(null);
    controlZoneCaptureHudUpdate(null);
    return;
  }
  if (!controlZonesEnabled()) {
    if (controlZones.length || _controlZoneMatchStartT >= 0) controlZonesReset();
    controlZoneRepairHudUpdate(null);
    controlZoneCaptureHudUpdate(null);
    return;
  }
  if (_controlZoneMatchStartT < 0) {
    _controlZoneMatchStartT = typeof startT === 'number' && isFinite(startT)
      ? startT : (typeof gameT === 'number' && isFinite(gameT) ? gameT : 0);
    _controlZoneNextSpawnT = _controlZoneMatchStartT + CONTROL_ZONE_START_DELAY;
  }
  var now = typeof gameT === 'number' && isFinite(gameT) ? gameT : 0;
  if (!controlZones.length && now + 1e-9 >= _controlZoneNextSpawnT) {
    controlZonesGenerateInitial(now);
  }
  /* No support or capture accounting exists before the delayed first spawn. */
  if (!controlZones.length) {
    controlZoneRepairHudUpdate(null);
    controlZoneCaptureHudUpdate(null);
    return;
  }
  while (now + 1e-9 >= _controlZoneNextMoveT) {
    if (controlZonesMoveExisting() && typeof aimHint === 'function') aimHint('COMMANDER HAS REPLANNED THE BATTLEFIELD FOCUS');
    _controlZoneNextMoveT += CONTROL_ZONE_MOVE_INTERVAL;
  }
  for (var i = 0; i < controlZones.length; i++) controlZoneUpdate(controlZones[i], dt);
  if (typeof strategicSupportTick === 'function') strategicSupportTick(dt);
  controlZoneRepairTick(typeof player !== 'undefined' ? player : null, dt);
  controlZoneRepairHudUpdate(typeof player !== 'undefined' ? player : null);
  controlZoneCaptureHudUpdate(typeof player !== 'undefined' ? player : null);
}

function controlZonesMinimapStatus() {
  if (!controlZonesActive()) return 'ZONE: N/A';
  var red = 0, blue = 0, neutral = 0;
  for (var i = 0; i < controlZones.length; i++) {
    if (controlZones[i].owner === 'red') red++;
    else if (controlZones[i].owner === 'blue') blue++;
    else neutral++;
  }
  return 'CONTROL ' + red + ':' + blue + ' // OPEN ' + neutral;
}

/* Commander target weighting: empty control area > enemy area > open ground > friendly area.
   Open ground remains the existing commander/tactical destination when no higher-ranked area exists. */
function controlZoneAiPriority(zone, team) {
  if (!zone) return CONTROL_ZONE_AI_PRIORITY.open;
  if (!zone.owner) return CONTROL_ZONE_AI_PRIORITY.empty;
  if (zone.owner !== team) return CONTROL_ZONE_AI_PRIORITY.enemy;
  return CONTROL_ZONE_AI_PRIORITY.friendly;
}
function controlZoneAiChooseTarget(team, x, z) {
  if (!controlZonesActive() || !team) return null;
  var best = null, bestRank = CONTROL_ZONE_AI_PRIORITY.open, bestD = 1e18;
  for (var i = 0; i < controlZones.length; i++) {
    var zone = controlZones[i], rank = controlZoneAiPriority(zone, team);
    if (rank < CONTROL_ZONE_AI_PRIORITY.enemy) continue;       // Keep friendly areas below the existing open-ground behavior.
    var dx = zone.x - x, dz = zone.cz - z, d2 = dx * dx + dz * dz;
    if (rank > bestRank || (rank === bestRank && d2 < bestD)) { best = zone; bestRank = rank; bestD = d2; }
  }
  return best;
}
function controlZoneAiTargetForTank(t) {
  /* Control-area routing is a TDM commander feature only.  In particular, do
     not consume a stale group target after the toggle is switched OFF, and do
     not compete with the player's detached sqCmd order. */
  if (!t || !t.ai || !controlZonesActive() || !controlZoneIsLandVehicle(t) || (typeof isFfaMode === 'function' && isFfaMode())) return null;
  if (t._cmdG && t._cmdG._detached && typeof sqCmd !== 'undefined' && sqCmd.active) return null;
  var planned = t._cmdG && t._cmdG._controlTarget;
  if (planned && controlZones.indexOf(planned) >= 0 && controlZoneAiPriority(planned, t.team) >= CONTROL_ZONE_AI_PRIORITY.enemy) return planned;
  var p = t.group && t.group.position;
  return p ? controlZoneAiChooseTarget(t.team, p.x, p.z) : null;
}
function controlZoneAiPickDestination(t, zone) {
  if (!t || !zone) return null;
  var A = t.ai, p = t.group.position;
  var zoneEpoch = zone._controlZoneEpoch != null ? zone._controlZoneEpoch : _controlZoneEpoch;
  var same = A._controlZoneTargetId === zone.id && A._controlZoneTargetEpoch === zoneEpoch;
  var d0 = Math.sqrt((A.destX - p.x) * (A.destX - p.x) + (A.destZ - p.z) * (A.destZ - p.z));
  if (same && d0 > 8) return { x: A.destX, z: A.destZ };
  if (same && d0 <= 8) return { x: p.x, z: p.z };
  var limit = Math.max(5, CONTROL_ZONE_RADIUS - (Number(t.radius) || 2.5) - 2);
  for (var i = 0; i < 8; i++) {
    var a = (i === 0 ? 0 : Math.random() * Math.PI * 2);
    var r = i === 0 ? Math.min(12, limit) : Math.random() * limit;
    var safe = controlZoneClampPoint(zone.x + Math.sin(a) * r, zone.cz + Math.cos(a) * r);
    var x = safe.x, z = safe.z;
    if (typeof validDest !== 'function' || validDest(x, z, t)) {
      A._controlZoneTargetId = zone.id; A._controlZoneTargetEpoch = zoneEpoch; A.destT = 2.5;
      return { x: x, z: z };
    }
  }
  A._controlZoneTargetId = zone.id; A._controlZoneTargetEpoch = zoneEpoch; A.destT = 1.0;
  return { x: zone.x, z: zone.cz };
}
function controlZoneAiMove(t, zone, dt) {
  if (!t || !zone || !t.ai || !t.group || !controlZoneIsLandVehicle(t)) return false;
  if (t._cmdG && t._cmdG._detached && typeof sqCmd !== 'undefined' && sqCmd.active) return false;
  var A = t.ai, p = t.group.position, dest = controlZoneAiPickDestination(t, zone);
  if (!dest) return false;
  A.mode = 'control'; A.destX = dest.x; A.destZ = dest.z;
  var dx = dest.x - p.x, dz = dest.z - p.z, d = Math.sqrt(dx * dx + dz * dz);
  if (d > 8) {
    var sx = dx, sz = dz;
    if (typeof navSteer === 'function') {
      var nav = navSteer(t, dest.x, dest.z, p);
      if (nav) { sx = nav.x - p.x; sz = nav.z - p.z; }
    }
    var drv = typeof steerCached === 'function' ? steerCached(t, sx, sz) : { x: sx, z: sz };
    var wy = Math.atan2(drv.x, drv.z);
    var maxTurn = t.turn0 * (typeof turnMult === 'function' ? turnMult(t) : 1) * (typeof slopeTurnMul === 'function' ? slopeTurnMul(t) : 1);
    var diff = clamp(normAng(wy - t.yaw), -maxTurn * dt, maxTurn * dt);
    if (typeof groundYawInertia === 'function') diff = groundYawInertia(t, dt > 0 ? diff / dt : 0, maxTurn, dt) * dt;
    t.turretYaw -= diff;
    var angle = Math.abs(normAng(wy - t.yaw));
    t._throttle = angle < 1.45 ? clamp(1 - angle / 1.7, 0.25, 1) : (angle > 1.75 ? -0.55 : 0.22);
    t._throttleLock = 0;
    if (typeof SIM_K === 'undefined' || SIM_K <= 0) t.speed = approachSpeed(t.speed, t._throttle * t.speed0 * (typeof speedMult === 'function' ? speedMult(t) : 1), t.accel0 * (typeof engineEff === 'function' ? engineEff(t) : 1), t.decel0, dt);
  } else {
    t._throttle = 0; t._throttleLock = 0; t._turnCmd = 0;
    if (typeof SIM_K === 'undefined' || SIM_K <= 0) t.speed = approachSpeed(t.speed, 0, t.accel0, t.decel0, dt);
  }
  applyMotion(t, dt);
  return true;
}
