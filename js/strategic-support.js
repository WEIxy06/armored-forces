/* ===== Module: strategic-support.js ===== */
/*
   TDM strategic support.
   A control zone starts paying one support point every two seconds from the
   moment its capture completes.  The system is deliberately isolated behind
   strategicSupportEnabled(): FFA and TDM matches with control zones disabled
   never create progress, warnings, strikes, or bonus vehicles.
*/
'use strict';

var STRATEGIC_SUPPORT_INTERVAL = 2;
var STRATEGIC_SUPPORT_WARNING_SEC = 3;
var STRATEGIC_SUPPORT_DURATION = 30;
var STRATEGIC_SUPPORT_TYPES = ['bombardment', 'transport', 'air', 'artillery', 'tank'];
var STRATEGIC_SUPPORT_LAND_KINDS = { tank: true, '99': true, td: true, aa: true, arty: true };
var STRATEGIC_SUPPORT_TANK_KINDS = { tank: true, '99': true, td: true };
var strategicSupportState = {
  progress: { red: 0, blue: 0 },
  pending: [],
  active: [],
  seq: 0,
  alertUntil: -99,
  alertText: '',
  alertTeam: null
};

function strategicSupportModeEnabled() {
  return typeof isFfaMode === 'function' && !isFfaMode() &&
    typeof controlZonesEnabled === 'function' && controlZonesEnabled();
}
function strategicSupportEnabled() {
  /* The control-zone toggle is not enough during the delayed opening window:
     support must remain dormant until the first live zone exists.  The
     active-function fallback keeps this module usable in isolated QA contexts
     that load it without control-zones.js. */
  return strategicSupportModeEnabled() &&
    (typeof controlZonesActive !== 'function' || controlZonesActive());
}
function strategicSupportTeamValid(team) { return team === 'red' || team === 'blue'; }
function strategicSupportNow() { return typeof gameT === 'number' && isFinite(gameT) ? gameT : 0; }
function strategicSupportPlayerTeam() {
  if (typeof player !== 'undefined' && player && strategicSupportTeamValid(player.team)) return player.team;
  if (typeof pSide === 'function' && strategicSupportTeamValid(pSide())) return pSide();
  return 'red';
}
function strategicSupportLabel(type) {
  if (type === 'bombardment') return 'STRATEGIC BOMBARDMENT';
  if (type === 'transport') return 'STRATEGIC TRANSPORT';
  if (type === 'air') return 'AIR SUPPORT';
  if (type === 'artillery') return 'ARTILLERY SUPPORT';
  return 'TANK SUPPORT';
}
function strategicSupportTypeGlyph(type) {
  if (type === 'bombardment') return 'BMB';
  if (type === 'transport') return 'TRN';
  if (type === 'air') return 'AIR';
  if (type === 'artillery') return 'ART';
  return 'TNK';
}
function strategicSupportPickType() {
  return STRATEGIC_SUPPORT_TYPES[Math.floor(Math.random() * STRATEGIC_SUPPORT_TYPES.length)];
}
function strategicSupportMaxInPlay() {
  var r = typeof BATTLE_SETUP !== 'undefined' && BATTLE_SETUP.red ? Number(BATTLE_SETUP.red.cap) || 0 : 0;
  var b = typeof BATTLE_SETUP !== 'undefined' && BATTLE_SETUP.blue ? Number(BATTLE_SETUP.blue.cap) || 0 : 0;
  return Math.max(0, r + b);
}
/* Vehicle counts are discrete.  Flooring follows the literal MAX/divisor rule;
   the requested minimums keep a small custom battle from receiving zero units. */
function strategicSupportScaledCount(divisor, minimum) {
  return Math.max(minimum, Math.floor(strategicSupportMaxInPlay() / divisor));
}
function strategicSupportProgressSnapshot(out) {
  out = out || {};
  out.red = Math.max(0, Math.min(100, strategicSupportState.progress.red || 0));
  out.blue = Math.max(0, Math.min(100, strategicSupportState.progress.blue || 0));
  return out;
}
function strategicSupportShowAlert(event) {
  var own = event.team === strategicSupportPlayerTeam();
  var text = (own ? 'OUR ' : 'ENEMY ') + event.label + ' READY';
  strategicSupportState.alertText = text;
  strategicSupportState.alertTeam = event.team;
  strategicSupportState.alertUntil = event.activateAt;
  if (typeof document === 'undefined') return;
  var root = document.getElementById('strategic-support-alert');
  if (!root) return;
  root.textContent = text;
  root.classList.remove('hidden');
  root.classList.add('on');
  root.classList.toggle('friendly', own);
  root.classList.toggle('hostile', !own);
  root.setAttribute('aria-hidden', 'false');
  root.setAttribute('data-side', own ? 'friendly' : 'hostile');
}
function strategicSupportHideAlert() {
  if (typeof document === 'undefined') return;
  var root = document.getElementById('strategic-support-alert');
  if (!root) return;
  root.classList.remove('on');
  root.classList.add('hidden');
  root.setAttribute('aria-hidden', 'true');
}
function strategicSupportQueue(team) {
  if (!strategicSupportEnabled() || !strategicSupportTeamValid(team)) return null;
  var now = strategicSupportNow();
  var type = strategicSupportPickType();
  var event = {
    id: ++strategicSupportState.seq,
    team: team,
    type: type,
    label: strategicSupportLabel(type),
    glyph: strategicSupportTypeGlyph(type),
    announcedAt: now,
    activateAt: now + STRATEGIC_SUPPORT_WARNING_SEC,
    activatedAt: -1,
    active: false,
    until: 0,
    nextRoundAt: Infinity,
    round: 0,
    rounds: 0,
    cx: 0,
    cz: 0,
    radius: 0,
    amount: 0,
    nextExtraAt: Infinity,
    airstrikeOwner: null
  };
  strategicSupportState.pending.push(event);
  strategicSupportShowAlert(event);
  return event;
}
function strategicSupportAddProgress(team, amount) {
  if (!strategicSupportEnabled() || !strategicSupportTeamValid(team)) return;
  var p = Math.max(0, Number(strategicSupportState.progress[team]) || 0) + Math.max(0, Number(amount) || 0);
  while (p >= 100) {
    p -= 100;
    strategicSupportQueue(team);
  }
  strategicSupportState.progress[team] = Math.min(99.999, p);
}
function strategicSupportZoneIncome() {
  if (typeof controlZones === 'undefined' || !controlZones) return;
  var now = strategicSupportNow();
  for (var i = 0; i < controlZones.length; i++) {
    var zone = controlZones[i], owner = zone && zone.owner;
    if (!zone || !strategicSupportTeamValid(owner)) {
      if (zone) {
        zone._strategicSupportOwner = null;
        zone._strategicSupportFallbackOwner = null;
        zone._strategicSupportFallbackAt = -1;
        zone._strategicSupportCompletedAt = -1;
        zone._strategicSupportNextT = Infinity;
      }
      continue;
    }

    /* Capture completion is team-owned state, not player-owned state.  Keep
       the owner in the accounting key so a blue capture starts its own clock
       even when the previous red capture used the same frame/time value.  The
       fallback also accepts older/custom zone objects that expose owner and
       nextIncomeT but no completedAt field. */
    var completedAt = Number(zone.completedAt);
    if (!(completedAt >= 0)) {
      var legacyNext = Number(zone.nextIncomeT);
      if (legacyNext >= 0 && isFinite(legacyNext)) completedAt = legacyNext - STRATEGIC_SUPPORT_INTERVAL;
      else {
        /* Keep the compatibility fallback stable across ticks; using the live
           now value directly would keep restarting the two-second timer. */
        if (zone._strategicSupportFallbackOwner !== owner || !(Number(zone._strategicSupportFallbackAt) >= 0)) {
          zone._strategicSupportFallbackOwner = owner;
          zone._strategicSupportFallbackAt = now;
        }
        completedAt = zone._strategicSupportFallbackAt;
      }
    } else {
      zone._strategicSupportFallbackOwner = owner;
      zone._strategicSupportFallbackAt = completedAt;
    }
    if (zone._strategicSupportOwner !== owner || zone._strategicSupportCompletedAt !== completedAt) {
      zone._strategicSupportOwner = owner;
      zone._strategicSupportCompletedAt = completedAt;
      zone._strategicSupportNextT = completedAt + STRATEGIC_SUPPORT_INTERVAL;
    }
    if (!(zone._strategicSupportNextT > -Infinity)) zone._strategicSupportNextT = now + STRATEGIC_SUPPORT_INTERVAL;
    if (now < zone._strategicSupportNextT) continue;
    var n = Math.floor((now - zone._strategicSupportNextT) / STRATEGIC_SUPPORT_INTERVAL) + 1;
    /* strategicSupportAddProgress writes exactly the owner bucket; it never
       consults pSide(), so red and blue progress remain independent. */
    strategicSupportAddProgress(owner, n);
    zone._strategicSupportNextT += n * STRATEGIC_SUPPORT_INTERVAL;
  }
}
function strategicSupportMapCenterClamp(x, z, radius) {
  var halfW = Math.max(0, Number(MAP && MAP.halfW) || (Number(MAP && MAP.wid) || 2000) * 0.5);
  var halfL = Math.max(0, Number(MAP && MAP.halfL) || (Number(MAP && MAP.len) || 2000) * 0.5);
  return {
    x: clamp(Number(x) || 0, -Math.max(0, halfW - radius), Math.max(0, halfW - radius)),
    z: clamp(Number(z) || 0, -Math.max(0, halfL - radius), Math.max(0, halfL - radius))
  };
}
function strategicSupportEnemyLandVehicles(team) {
  var out = [];
  if (typeof aliveList === 'undefined' || !aliveList) return out;
  for (var i = 0; i < aliveList.length; i++) {
    var t = aliveList[i];
    if (!t || !t.alive || t.team === team || !STRATEGIC_SUPPORT_LAND_KINDS[t.kind] || !t.group || !t.group.position) continue;
    out.push(t);
  }
  return out;
}
function strategicSupportPickBombardmentArea(team, radius) {
  var enemies = strategicSupportEnemyLandVehicles(team);
  var candidates = [], i, p, a, r, c;
  for (i = 0; i < enemies.length; i++) {
    p = enemies[i].group.position;
    candidates.push(strategicSupportMapCenterClamp(p.x, p.z, radius));
    /* A small random displacement makes equal-density clusters non-deterministic
       while the final selection still maximizes the number of enemy vehicles. */
    a = Math.random() * Math.PI * 2;
    r = Math.random() * radius * 0.65;
    candidates.push(strategicSupportMapCenterClamp(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, radius));
  }
  var halfW = Math.max(0, Number(MAP && MAP.halfW) || (Number(MAP && MAP.wid) || 2000) * 0.5);
  var halfL = Math.max(0, Number(MAP && MAP.halfL) || (Number(MAP && MAP.len) || 2000) * 0.5);
  for (i = 0; i < 12; i++) candidates.push(strategicSupportMapCenterClamp((Math.random() * 2 - 1) * halfW, (Math.random() * 2 - 1) * halfL, radius));
  if (!candidates.length) candidates.push(strategicSupportMapCenterClamp(0, 0, radius));
  var bestScore = -1, best = [], radius2 = radius * radius;
  for (i = 0; i < candidates.length; i++) {
    c = candidates[i];
    var score = 0;
    for (var j = 0; j < enemies.length; j++) {
      p = enemies[j].group.position;
      var dx = p.x - c.x, dz = p.z - c.z;
      if (dx * dx + dz * dz <= radius2) score++;
    }
    if (score > bestScore) { bestScore = score; best.length = 0; best.push(c); }
    else if (score === bestScore) best.push(c);
  }
  return best[Math.floor(Math.random() * best.length)] || candidates[0];
}
function strategicSupportAreaContains(event, t) {
  if (!event || !t || !t.group || !t.group.position) return false;
  var dx = t.group.position.x - event.cx, dz = t.group.position.z - event.cz;
  return dx * dx + dz * dz <= event.radius * event.radius + 1e-6;
}
/* Shared by weapons.js for direct and splash damage from strategic airstrikes. */
function strategicSupportAirstrikeTargetAllowed(t, owner) {
  var event = owner && owner._strategicSupportEvent;
  if (!event || event.type !== 'bombardment') return false;
  return !!(t && t.alive && t.team !== event.team && STRATEGIC_SUPPORT_LAND_KINDS[t.kind] && strategicSupportAreaContains(event, t));
}
function strategicSupportBombardmentRound(event) {
  if (!event || event.type !== 'bombardment' || typeof fireAirstrikeBomb !== 'function') return;
  var candidates = strategicSupportEnemyLandVehicles(event.team).filter(function (t) { return strategicSupportAreaContains(event, t); });
  for (var i = candidates.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1)), swap = candidates[i]; candidates[i] = candidates[j]; candidates[j] = swap;
  }
  var take = candidates.length ? Math.max(1, Math.ceil(candidates.length / 2)) : 0;
  if (!take) return;
  if (!event.airstrikeOwner) event.airstrikeOwner = {
    id: 'strategic-airstrike-' + event.id,
    team: event.team,
    kind: 'airstrike',
    source: 'strategic-airstrike',
    isAirstrike: true,
    isPlayer: false,
    alive: true,
    _strategicSupportEvent: event
  };
  for (i = 0; i < take; i++) fireAirstrikeBomb(candidates[i], i, event.airstrikeOwner);
}
function strategicSupportRandomKind(team, mode) {
  var choices = [], S = typeof BATTLE_SETUP !== 'undefined' ? BATTLE_SETUP[team] : null;
  if (typeof VEHICLE_KINDS !== 'undefined' && VEHICLE_KINDS) {
    for (var i = 0; i < VEHICLE_KINDS.length; i++) {
      var vk = VEHICLE_KINDS[i], kind = vk.kind;
      if (!vehicleKindAllowed(team, kind)) continue;
      if (mode === 'tank' && !STRATEGIC_SUPPORT_TANK_KINDS[kind]) continue;
      var weight = S && S.roster ? Math.max(0, Number(S.roster[kind]) || 0) : 1;
      if (weight <= 0) weight = 1;
      choices.push({ kind: kind, weight: weight });
    }
  }
  if (!choices.length) return mode === 'tank' ? 'tank' : 'arty';
  var total = 0;
  for (var c = 0; c < choices.length; c++) total += choices[c].weight;
  var pick = Math.random() * total;
  for (c = 0; c < choices.length; c++) {
    pick -= choices[c].weight;
    if (pick < 0) return choices[c].kind;
  }
  return choices[choices.length - 1].kind;
}
function strategicSupportDeployVehicle(team, kind, source) {
  if (!strategicSupportTeamValid(team) || typeof hqFind !== 'function' || typeof createTank !== 'function') return null;
  if (typeof vehicleKindAllowed === 'function' && !vehicleKindAllowed(team, kind)) return null;
  var hq = hqFind(team, kind, typeof hqRandWing === 'function' ? hqRandWing() : 1);
  if (!hq) return null;
  var spot = typeof findSpawnSpot === 'function' ? findSpawnSpot(hq.x, hq.z) : { x: hq.x, z: hq.z };
  var vk = typeof vehicleKindEntry === 'function' ? vehicleKindEntry(kind) : null;
  var name = vk && vk.spawnName ? (vk.spawnName[team] || vk.spawnName.red) : null;
  var nt = createTank({ kind: kind, team: team, x: spot.x, z: spot.z, yaw: hq.yaw + (typeof rand === 'function' ? rand(-0.15, 0.15) : (Math.random() - 0.5) * 0.3),
    name: name || (typeof vehicleKindName === 'function' ? vehicleKindName(team, kind) : 'SUPPORT VEHICLE'),
    strategicSupport: true, strategicSupportSource: source || 'strategic-support' });
  if (!nt) return null;
  nt.reload = 0;
  if (vk && vk.aiAnchor && nt.ai) {
    nt.ai.anchorX = spot.x; nt.ai.homeZ = spot.z; nt.ai.destX = spot.x; nt.ai.destZ = spot.z;
  }
  if (typeof rebuildTargets === 'function') rebuildTargets();
  if (typeof comicGroundDust === 'function' && nt.group && nt.group.position) {
    comicGroundDust(nt.group.position.x, nt.group.position.y + 1.2, nt.group.position.z, false);
  }
  return nt;
}
function strategicSupportActivate(event) {
  if (!event || !strategicSupportEnabled()) return;
  var now = strategicSupportNow();
  event.active = true;
  event.activatedAt = now;
  if (event.type === 'bombardment') {
    event.until = now + STRATEGIC_SUPPORT_DURATION;
    event.radius = Math.min(Number(MAP && MAP.len) || 2000, Number(MAP && MAP.wid) || 2000) / 10;
    event.radius = Math.max(1, event.radius);
    var center = strategicSupportPickBombardmentArea(event.team, event.radius);
    event.cx = center.x; event.cz = center.z;
    event.rounds = strategicSupportScaledCount(10, 3);
    event.round = 0; event.nextRoundAt = now;
    strategicSupportState.active.push(event);
    return;
  }
  if (event.type === 'transport') {
    event.until = now + STRATEGIC_SUPPORT_DURATION;
    event.amount = strategicSupportScaledCount(4, 10);
    if (typeof teamPool !== 'undefined') teamPool[event.team] = (teamPool[event.team] || 0) + event.amount;
    event.nextExtraAt = now + 4;
    /* A transport call affects already queued AI redeploys as well as future losses. */
    if (typeof respawnQueue !== 'undefined' && respawnQueue) {
      for (var qi = 0; qi < respawnQueue.length; qi++) {
        var rq = respawnQueue[qi];
        if (rq && rq.team === event.team && rq.due > now) rq.due = now + (rq.due - now) * 0.5;
      }
    }
    strategicSupportState.active.push(event);
    return;
  }
  var count = event.type === 'air' ? strategicSupportScaledCount(10, 3) :
    (event.type === 'artillery' ? strategicSupportScaledCount(10, 3) : strategicSupportScaledCount(5, 10));
  event.amount = count;
  var kind = event.type === 'air' ? (event.team === 'red' ? 'wz10' : 'ah64') :
    (event.type === 'artillery' ? 'arty' : null);
  if (event.type === 'tank') {
    for (var ti = 0; ti < count; ti++) strategicSupportDeployVehicle(event.team, strategicSupportRandomKind(event.team, 'tank'), event.type);
  } else {
    for (var vi = 0; vi < count; vi++) strategicSupportDeployVehicle(event.team, kind, event.type);
  }
  /* AIR / ARTILLERY / TANK are instant support: they have no countdown card. */
  event.active = false;
  event.until = now;
}
function strategicSupportTransportTick(event, now) {
  if (!event || event.type !== 'transport' || now >= event.until || typeof teamPool === 'undefined') return;
  if (!(event.nextExtraAt < Infinity)) return;
  while (now + 1e-6 >= event.nextExtraAt && event.nextExtraAt < event.until) {
    if (teamPool[event.team] <= 0) { event.nextExtraAt = Infinity; break; }
    teamPool[event.team]--;
    var kind = strategicSupportRandomKind(event.team, 'transport');
    strategicSupportDeployVehicle(event.team, kind, 'transport');
    event.nextExtraAt += 4;
  }
}
function strategicSupportBombardmentTick(event, now) {
  if (!event || event.type !== 'bombardment' || now >= event.until) return;
  while (event.round < event.rounds && now + 1e-6 >= event.nextRoundAt) {
    strategicSupportBombardmentRound(event);
    event.round++;
    event.nextRoundAt = event.round < event.rounds
      ? event.activatedAt + STRATEGIC_SUPPORT_DURATION * event.round / event.rounds : Infinity;
  }
}
function strategicSupportProcessPending(now) {
  for (var i = strategicSupportState.pending.length - 1; i >= 0; i--) {
    var event = strategicSupportState.pending[i];
    if (now < event.activateAt) continue;
    strategicSupportState.pending.splice(i, 1);
    strategicSupportActivate(event);
  }
}
function strategicSupportPruneActive(now) {
  for (var i = strategicSupportState.active.length - 1; i >= 0; i--) {
    var event = strategicSupportState.active[i];
    if (!event || now >= event.until) strategicSupportState.active.splice(i, 1);
  }
}
function strategicSupportTimerLabel(event) {
  var own = event.team === strategicSupportPlayerTeam();
  return (own ? 'OUR ' : 'ENEMY ') + event.label;
}
function strategicSupportHudUpdate(now) {
  if (typeof document === 'undefined') return;
  var root = document.getElementById('strategic-support-hud');
  var timers = document.getElementById('strategic-support-timers');
  var enabled = strategicSupportEnabled() && typeof gameState !== 'undefined' && gameState === 'playing';
  if (!enabled) {
    if (root) { root.classList.add('hidden'); root.setAttribute('aria-hidden', 'true'); }
    if (timers) { timers.classList.add('hidden'); timers.setAttribute('aria-hidden', 'true'); }
    strategicSupportHideAlert();
    return;
  }
  if (root) {
    root.classList.remove('hidden'); root.setAttribute('aria-hidden', 'false');
    var own = strategicSupportPlayerTeam(), foe = own === 'red' ? 'blue' : 'red';
    var ownPct = Math.max(0, Math.min(100, strategicSupportState.progress[own] || 0));
    var foePct = Math.max(0, Math.min(100, strategicSupportState.progress[foe] || 0));
    var ownFill = document.getElementById('strategic-support-our-fill');
    var foeFill = document.getElementById('strategic-support-enemy-fill');
    var ownVal = document.getElementById('strategic-support-our-value');
    var foeVal = document.getElementById('strategic-support-enemy-value');
    if (ownFill) ownFill.style.width = (ownPct * 0.5).toFixed(2) + '%';
    if (foeFill) foeFill.style.width = (foePct * 0.5).toFixed(2) + '%';
    if (ownVal) ownVal.textContent = 'OUR ' + Math.floor(ownPct) + '%';
    if (foeVal) foeVal.textContent = 'ENEMY ' + Math.floor(foePct) + '%';
  }
  if (timers) {
    timers.innerHTML = '';
    var timerCount = 0;
    for (var i = 0; i < strategicSupportState.active.length; i++) {
      var event = strategicSupportState.active[i];
      if (!event || event.until <= now || (event.type !== 'bombardment' && event.type !== 'transport')) continue;
      var card = document.createElement('div');
      card.className = 'strategic-support-timer ' + (event.team === strategicSupportPlayerTeam() ? 'friendly' : 'hostile');
      var title = document.createElement('span'); title.textContent = strategicSupportTimerLabel(event);
      var time = document.createElement('b'); time.textContent = Math.ceil(Math.max(0, event.until - now)) + 's';
      card.appendChild(title); card.appendChild(time); timers.appendChild(card); timerCount++;
    }
    timers.classList.toggle('hidden', timerCount === 0);
    timers.setAttribute('aria-hidden', timerCount === 0 ? 'true' : 'false');
  }
  if (strategicSupportState.alertUntil > 0 && now >= strategicSupportState.alertUntil) {
    strategicSupportState.alertUntil = -99;
    strategicSupportHideAlert();
  }
}
function strategicSupportTick() {
  if ((typeof gameState !== 'undefined' && gameState !== 'playing') || !strategicSupportModeEnabled()) {
    strategicSupportReset();
    return;
  }
  /* A temporary empty-zone window, such as the first 30 seconds or a layout
     handoff, must not erase either team's already-earned progress. */
  if (typeof controlZonesActive === 'function' && !controlZonesActive()) {
    strategicSupportSuspend();
    return;
  }
  var now = strategicSupportNow();
  strategicSupportZoneIncome();
  strategicSupportProcessPending(now);
  for (var i = 0; i < strategicSupportState.active.length; i++) {
    var event = strategicSupportState.active[i];
    if (event.type === 'bombardment') strategicSupportBombardmentTick(event, now);
    else if (event.type === 'transport') strategicSupportTransportTick(event, now);
  }
  strategicSupportPruneActive(now);
  strategicSupportHudUpdate(now);
}
function strategicSupportGetActiveBombardments() {
  return strategicSupportState.active;
}
function strategicSupportActiveBombardmentCount() {
  var n = 0, now = strategicSupportNow();
  for (var i = 0; i < strategicSupportState.active.length; i++) {
    var e = strategicSupportState.active[i];
    if (e && e.type === 'bombardment' && e.until > now) n++;
  }
  return n;
}
function strategicSupportTransportActive(team) {
  if (!strategicSupportTeamValid(team)) return false;
  var now = strategicSupportNow();
  for (var i = 0; i < strategicSupportState.active.length; i++) {
    var event = strategicSupportState.active[i];
    if (event && event.type === 'transport' && event.team === team && event.until > now) return true;
  }
  return false;
}
function strategicSupportSuspend(dropEvents) {
  /* Hide the support UI without touching either team's earned progress.  A
     transient no-zone window preserves queued/active calls; a hard reset passes
     true and discards them as part of a new/disabled match. */
  if (dropEvents) {
    strategicSupportState.pending.length = 0;
    strategicSupportState.active.length = 0;
  }
  strategicSupportState.alertUntil = -99;
  strategicSupportState.alertText = '';
  strategicSupportState.alertTeam = null;
  strategicSupportHideAlert();
  if (typeof document !== 'undefined') {
    var root = document.getElementById('strategic-support-hud');
    var timers = document.getElementById('strategic-support-timers');
    if (root) { root.classList.add('hidden'); root.setAttribute('aria-hidden', 'true'); }
    if (timers) { timers.classList.add('hidden'); timers.setAttribute('aria-hidden', 'true'); timers.innerHTML = ''; }
  }
}
function strategicSupportReset() {
  /* Hard reset is reserved for a new match, FFA, or the control-zone toggle
     being disabled.  A side's support use never calls this function. */
  strategicSupportState.progress.red = 0;
  strategicSupportState.progress.blue = 0;
  strategicSupportSuspend(true);
  /* Clear per-zone clocks as well as the two team buckets.  This prevents a
     disabled/FFA match or a new match from inheriting an old owner's timer. */
  if (typeof controlZones !== 'undefined' && controlZones) {
    for (var ri = 0; ri < controlZones.length; ri++) {
      var rz = controlZones[ri];
      if (!rz) continue;
      rz._strategicSupportOwner = null;
      rz._strategicSupportFallbackOwner = null;
      rz._strategicSupportFallbackAt = -1;
      rz._strategicSupportCompletedAt = -1;
      rz._strategicSupportNextT = Infinity;
    }
  }
}
