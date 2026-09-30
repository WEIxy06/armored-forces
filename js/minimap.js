/* ===== Module: minimap.js ===== */
/* ============================================================
   模块: minimap.js — 战场俯视小地图 + FFA 安全区
   · 小地图底图只绘制真实地形采样，不绘制常驻敌我点位。
   · 载具只有开火事件或死亡事件才进入点位账本；开火停止后自动隐去，死亡保留黄色 X。
   · FFA 安全区不改变 TDM；默认开局 30 秒后出现并按阶段收缩。
   ============================================================ */
'use strict';

var MINIMAP_SIZE = 256;
var MINIMAP_MAP_RES = 128;
var MINIMAP_UNIT_MARKER_RADIUS = 8;
var MINIMAP_CONTROL_ZONE_MARKER_RADIUS = MINIMAP_UNIT_MARKER_RADIUS * 1.2;
var MINIMAP_POSITIONS = ['tl', 'tr', 'bl'];
var MINIMAP_SIZES = ['small', 'medium', 'large'];
/* FFA zone pacing: PUBG-like staged warning / travel / contraction cadence. */
var FFA_ZONE_START_DELAY = 30;
var FFA_ZONE_WARNING_SEC = 15;
var FFA_ZONE_SHRINK_SEC = 28;
var FFA_ZONE_WAIT_SEC = 45;
var FFA_ZONE_RATIOS = [0.72, 0.68, 0.62, 0.56, 0.50, 0.45, 0.40];
var FFA_AIRSTRIKE_INTERVAL = 1.0;          // 有效轰炸阶段: 全场每秒三枚竖直火箭
var FFA_AIRSTRIKE_BOMBS_PER_TICK = 3;
var MINIMAP_DEATH_HIGHLIGHT_SEC = 3.0;     // 阵亡后黄色 X 的保留时长
var _minimapPrefs = { position: 'tl', size: 'small', lastVisibleSize: 'small' };
var _minimap = {
  canvas: null, ctx: null, panel: null, stateEl: null, scaleEl: null, msgEl: null,
  mapImage: null, mapKey: '', mapPaintT: -99, mapDentEpoch: -1,
  events: [],
  zone: {
    active: false, started: false, announcedAt: -99, nextShrinkT: Infinity,
    cx: 0, cz: 0, radius: 0, fromCx: 0, fromCz: 0, fromR: 0,
    toCx: 0, toCz: 0, toR: 0, shrinkStart: -99, shrinkEnd: -99,
    warningStart: -99, warningEnd: -99, phase: 0, completedShrinks: 0, revision: 0,
    _powerupShrinkRevision: -1, _powerupGeneration: -1, flashUntil: -99, lastOutside: false, pendingWarning: false, warnAfter: -99
  },
  airstrike: { revision: -1, active: false, nextT: Infinity, cursor: 0, targets: [] },
  msgUntil: -99, msgText: '',
  mapOrientation: 0, mapOrientationSet: false,
  lastTickT: -99
};

function _mmPrefValidPosition(v) { return MINIMAP_POSITIONS.indexOf(v) >= 0; }
function _mmPrefValidSize(v) { return v === 'small' || v === 'medium' || v === 'large' || v === 'off'; }
function _mmPrefRead() {
  try {
    var p = localStorage.getItem('prefMinimapPosition');
    var s = localStorage.getItem('prefMinimapSize');
    var last = localStorage.getItem('prefMinimapLastSize');
    if (_mmPrefValidPosition(p)) _minimapPrefs.position = p;
    if (_mmPrefValidSize(s)) _minimapPrefs.size = s;
    if (s !== 'off' && _mmPrefValidSize(s)) _minimapPrefs.lastVisibleSize = s;
    else if (MINIMAP_SIZES.indexOf(last) >= 0) _minimapPrefs.lastVisibleSize = last;
  } catch (e) {}
}
function _mmPrefSave() {
  try {
    localStorage.setItem('prefMinimapPosition', _minimapPrefs.position);
    localStorage.setItem('prefMinimapSize', _minimapPrefs.size);
    localStorage.setItem('prefMinimapLastSize', _minimapPrefs.lastVisibleSize);
  } catch (e) {}
}
function _mmPrefLabel(v) { return v === 'tr' ? 'TOP RIGHT' : (v === 'bl' ? 'BOTTOM LEFT' : 'TOP LEFT'); }
function _mmSizeLabel(v) { return v === 'small' ? 'SMALL' : (v === 'large' ? 'LARGE' : (v === 'off' ? 'OFF' : 'MEDIUM')); }
function _mmApplyPosition() {
  var M = _mmEls(), panel = M.panel, log = document.getElementById('log');
  if (panel) {
    for (var i = 0; i < MINIMAP_POSITIONS.length; i++) panel.classList.remove('minimap-pos-' + MINIMAP_POSITIONS[i]);
    panel.classList.add('minimap-pos-' + _minimapPrefs.position);
  }
  if (log) log.classList.toggle('minimap-log-top-left', _minimapPrefs.position === 'bl');
  var sel = document.getElementById('minimap-posinput'), val = document.getElementById('minimap-posval');
  if (sel) sel.value = _minimapPrefs.position;
  if (val) val.textContent = _mmPrefLabel(_minimapPrefs.position);
}
function _mmApplySize() {
  var M = _mmEls(), panel = M.panel;
  if (!panel) return;
  for (var i = 0; i < MINIMAP_SIZES.length; i++) panel.classList.remove('minimap-size-' + MINIMAP_SIZES[i]);
  panel.classList.remove('minimap-size-off');
  panel.classList.add('minimap-size-' + (_minimapPrefs.size === 'off' ? 'off' : _minimapPrefs.size));
  var sel = document.getElementById('minimap-sizeinput'), val = document.getElementById('minimap-sizeval');
  if (sel) sel.value = _minimapPrefs.size;
  if (val) val.textContent = _mmSizeLabel(_minimapPrefs.size);
}
function minimapSetSize(size) {
  if (!_mmPrefValidSize(size)) size = 'small';
  if (size !== 'off') _minimapPrefs.lastVisibleSize = size;
  _minimapPrefs.size = size;
  _mmApplySize();
  _mmPrefSave();
}
function minimapSetPosition(position) {
  if (!_mmPrefValidPosition(position)) position = 'tl';
  _minimapPrefs.position = position;
  _mmApplyPosition();
  _mmPrefSave();
}
function minimapCycleSize() {
  var next;
  // 固定循环：中 → 大 → 关 → 小 → 中；首次无存档默认小号，第一次按 M 进入中号。
  if (_minimapPrefs.size === 'small') next = 'medium';
  else if (_minimapPrefs.size === 'medium') next = 'large';
  else if (_minimapPrefs.size === 'large') next = 'off';
  else next = 'small';
  if (next !== 'off') _minimapPrefs.lastVisibleSize = next;
  _minimapPrefs.size = next;
  _mmApplySize();
  _mmPrefSave();
  return next;
}
function _mmBindPreferences() {
  _mmPrefRead();
  _mmApplyPosition();
  _mmApplySize();
  var sel = document.getElementById('minimap-posinput');
  if (sel) sel.addEventListener('change', function () { minimapSetPosition(sel.value); });
  var sizeSel = document.getElementById('minimap-sizeinput');
  if (sizeSel) sizeSel.addEventListener('change', function () { minimapSetSize(sizeSel.value); });
  /* ★移动端适配:触屏没有 M 键 —— 点按小地图在 小→中→大 之间循环(不含「关」,
     否则关掉后无处可点;关闭仍可在设置页选择)。flow.js TAP_UI_IDS 已放行本面板的合成 click。 */
  var _mmTouch = false;
  try { _mmTouch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window; } catch (eT) {}
  var panel = document.getElementById('minimap-panel');
  if (_mmTouch && panel) {
    panel.addEventListener('click', function (e) {
      if (typeof gameState !== 'undefined' && gameState !== 'playing') return;
      e.preventDefault(); e.stopPropagation();
      var cur = _minimapPrefs.size;
      var next = cur === 'small' ? 'medium' : (cur === 'medium' ? 'large' : 'small');
      if (typeof minimapSetSize === 'function') minimapSetSize(next);
      else { _minimapPrefs.size = next; _minimapPrefs.lastVisibleSize = next; _mmApplySize(); _mmPrefSave(); }
    });
  }
}

function _mmNow() { return (typeof gameT === 'number' && isFinite(gameT)) ? gameT : 0; }
function _mmPlayerArrowYaw() {
  if (typeof camAimY === 'number' && isFinite(camAimY)) return camAimY;
  if (typeof player !== 'undefined' && player && player._camYaw != null && isFinite(player._camYaw)) return player._camYaw;
  return (typeof player !== 'undefined' && player && isFinite(player.yaw)) ? player.yaw : 0;
}
function _mmApplyMapOrientation(ctx) {
  if (!_minimap.mapOrientationSet) return;
  var cx = MINIMAP_SIZE * 0.5, cy = MINIMAP_SIZE * 0.5;
  ctx.translate(cx, cy);
  ctx.rotate(_minimap.mapOrientation);
  ctx.translate(-cx, -cy);
}
function minimapAutoOrient() {
  if (_minimap.mapOrientationSet) return true;
  if (typeof player === 'undefined' || !player || !player.alive || !player.group) return false;
  /* Rotate the world once at match entry.  The same yaw drives the green
     player arrow, so the first rendered arrow is vertical: point up, tail down. */
  _minimap.mapOrientation = _mmPlayerArrowYaw();
  _minimap.mapOrientationSet = true;
  return true;
}
function _mmClamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function _mmRand(a, b) {
  if (typeof rand === 'function') return rand(a, b);
  return a + Math.random() * (b - a);
}
function _mmEls() {
  if (!_minimap.canvas && typeof document !== 'undefined') {
    _minimap.canvas = document.getElementById('minimap-cv');
    _minimap.panel = document.getElementById('minimap-panel');
    _minimap.stateEl = document.getElementById('minimap-zone-state');
    _minimap.scaleEl = document.getElementById('minimap-scale');
    _minimap.msgEl = document.getElementById('zone-msg');
    if (_minimap.canvas) {
      _minimap.canvas.width = MINIMAP_SIZE;
      _minimap.canvas.height = MINIMAP_SIZE;
      _minimap.ctx = _minimap.canvas.getContext('2d');
      if (_minimap.ctx) _minimap.ctx.imageSmoothingEnabled = true;
    }
  }
  return _minimap;
}
function _mmIdOf(t) { return t && t.id != null ? String(t.id) : ''; }
function _mmIsFriendly(t) {
  if (!t) return false;
  if (t === player) return true;
  if (typeof areFriendly === 'function' && player) return areFriendly(player, t);
  return !!player && !isFfaMode() && t.team === player.team;
}
function _mmFindRecord(t) {
  if (!t) return null;
  for (var i = 0; i < _minimap.events.length; i++) if (_minimap.events[i].tank === t) return _minimap.events[i];
  return null;
}
function _mmRecord(t) {
  var id = _mmIdOf(t), i;
  for (i = 0; i < _minimap.events.length; i++) if (_minimap.events[i].id === id || _minimap.events[i].tank === t) return _minimap.events[i];
  var p = t && t.group && t.group.position;
  var r = { id: id, tank: t, friendly: _mmIsFriendly(t), x: p ? p.x : 0, z: p ? p.z : 0,
            fireUntil: -99, fireStart: -99, dead: false, deathT: -99 };
  _minimap.events.push(r);
  return r;
}
function minimapNoteFire(t) {
  if (!t || !t.alive || !t.group) return;
  var r = _mmRecord(t), now = _mmNow(), p = t.group.position;
  r.tank = t; r.friendly = _mmIsFriendly(t); r.x = p.x; r.z = p.z;
  r.fireStart = now; r.fireUntil = Math.max(r.fireUntil, now + 0.46);
}
function minimapNoteDeath(t) {
  if (!t || !t.group) return;
  var r = _mmRecord(t), p = t.group.position, now = _mmNow();
  r.tank = t; r.friendly = _mmIsFriendly(t); r.x = p.x; r.z = p.z;
  r.dead = true; r.deathT = now; r.fireUntil = -99;
}
function _mmMessage(text, seconds) {
  var now = _mmNow();
  _minimap.msgText = text;
  _minimap.msgUntil = now + (seconds || 3);
  var e = _mmEls().msgEl;
  if (e) {
    e.textContent = text;
    e.classList.add('on');
    e.classList.toggle('danger', text === 'IN BOMBARDMENT ZONE');
  }
}
function _mmMessageTick(now) {
  var e = _minimap.msgEl;
  if (e && now >= _minimap.msgUntil) e.classList.remove('on');
}
function _mmZoneCenter(radius, ref, drift) {
  var halfW = (MAP.halfW != null ? MAP.halfW : (MAP.wid || 2000) / 2);
  var halfL = (MAP.halfL != null ? MAP.halfL : (MAP.len || 2000) / 2);
  var loX = -halfW + radius, hiX = halfW - radius;
  var loZ = -halfL + radius, hiZ = halfL - radius;
  if (ref && drift != null) {
    loX = Math.max(loX, ref.cx - drift); hiX = Math.min(hiX, ref.cx + drift);
    loZ = Math.max(loZ, ref.cz - drift); hiZ = Math.min(hiZ, ref.cz + drift);
  }
  if (loX > hiX) loX = hiX = 0;
  if (loZ > hiZ) loZ = hiZ = 0;
  var nx = _mmRand(loX, hiX), nz = _mmRand(loZ, hiZ);
  /* Keep every next circle fully inside the previous one, as in a PUBG-style shrink. */
  if (ref && drift != null) {
    var sx = nx - ref.cx, sz = nz - ref.cz, sd = Math.sqrt(sx * sx + sz * sz);
    if (sd > drift && sd > 0.001) { nx = ref.cx + sx * drift / sd; nz = ref.cz + sz * drift / sd; }
  }
  return { x: nx, z: nz };
}
function _mmZoneInit(now) {
  if (_minimap.zone.started || !isFfaMode() || gameState !== 'playing') return;
  if (now - startT < FFA_ZONE_START_DELAY) return;
  var shortEdge = Math.min(MAP.len || 2000, MAP.wid || 2000);
  // 半径取短边的一半并留约 1% 的几何余量，使正方形地图也能拥有随机圆心。
  var radius = Math.max(80, shortEdge * 0.49);
  var c = _mmZoneCenter(radius);
  var z = _minimap.zone;
  z.started = true; z.active = true;
  z.cx = c.x; z.cz = c.z; z.radius = radius;
  z.fromCx = c.x; z.fromCz = c.z; z.fromR = Math.max(MAP.wid || shortEdge, MAP.len || shortEdge) * 0.72;
  z.toCx = c.x; z.toCz = c.z; z.toR = radius;
  z.warningStart = now; z.warningEnd = now + FFA_ZONE_WARNING_SEC;
  z.shrinkStart = z.warningEnd; z.shrinkEnd = z.shrinkStart + FFA_ZONE_SHRINK_SEC;
  z.nextShrinkT = z.shrinkEnd + FFA_ZONE_WAIT_SEC;
  z.phase = 0; z.completedShrinks = 0; z.revision++; z._powerupGeneration = 0;
  z.announcedAt = now; z.flashUntil = z.warningEnd;
  z.lastOutside = false; z.pendingWarning = false; z.warnAfter = now;
  _mmMessage('SAFE ZONE ESTABLISHED', 2.4);
  /* One FFA pickup wave belongs to each newly established safe zone. */
  if (typeof powerupSpawnForZone === 'function') powerupSpawnForZone(z);
}
function _mmZoneGeometry(now, out) {
  var z = _minimap.zone;
  if (!z.active) return null;
  var g = out || { cx: 0, cz: 0, r: 0 }; g.cx = z.cx; g.cz = z.cz; g.r = z.radius;
  if (z.shrinkEnd > z.shrinkStart && now < z.shrinkEnd) {
    var q = _mmClamp((now - z.shrinkStart) / (z.shrinkEnd - z.shrinkStart), 0, 1);
    q = q * q * (3 - 2 * q);
    g.cx = z.fromCx + (z.toCx - z.fromCx) * q;
    g.cz = z.fromCz + (z.toCz - z.fromCz) * q;
    g.r = z.fromR + (z.toR - z.fromR) * q;
  }
  return g;
}
function _mmZoneUpdate(now) {
  if (!isFfaMode() || gameState !== 'playing') {
    _minimap.zone.active = false;
    _minimap.zone.lastOutside = false;
    return null;
  }
  _mmZoneInit(now);
  var z = _minimap.zone;
  if (!z.active) return null;
  /* Items start the shared ten-second blink exactly when physical contraction begins,
     not during the warning phase. */
  if (z.shrinkStart >= 0 && z.shrinkEnd > z.shrinkStart && now >= z.shrinkStart && z._powerupShrinkRevision !== z.revision) {
    z._powerupShrinkRevision = z.revision;
    if (typeof powerupBeginZoneShrink === 'function') powerupBeginZoneShrink(now);
  }
  if (z.shrinkEnd <= now && z.shrinkEnd > z.shrinkStart) {
    z.cx = z.toCx; z.cz = z.toCz; z.radius = z.toR;
    z.completedShrinks = (z.completedShrinks || 0) + 1;
    z._powerupGeneration = (z._powerupGeneration == null ? 0 : z._powerupGeneration) + 1;
    z.shrinkStart = z.shrinkEnd = -99;
    z.warningStart = z.warningEnd = -99;
    z.flashUntil = -99;
    /* The completed circle is the next generation's geometric placement area. */
    if (typeof powerupSpawnForZone === 'function') powerupSpawnForZone(z);
  }
  if (z.shrinkStart < 0 && now >= z.nextShrinkT && z.radius > Math.max(180, Math.min(MAP.len, MAP.wid) * 0.08)) {
    var ratio = FFA_ZONE_RATIOS[Math.min(z.phase, FFA_ZONE_RATIOS.length - 1)];
    var nextR = Math.max(180, z.radius * ratio);
    var ref = { cx: z.cx, cz: z.cz };
    var c = _mmZoneCenter(nextR, ref, Math.max(0, z.radius - nextR));
    z.fromCx = z.cx; z.fromCz = z.cz; z.fromR = z.radius;
    z.toCx = c.x; z.toCz = c.z; z.toR = nextR;
    z.warningStart = now; z.warningEnd = now + FFA_ZONE_WARNING_SEC;
    z.shrinkStart = z.warningEnd; z.shrinkEnd = z.shrinkStart + FFA_ZONE_SHRINK_SEC;
    z.nextShrinkT = z.shrinkEnd + FFA_ZONE_WAIT_SEC;
    z.phase++;
    z.revision++;
    z.flashUntil = z.warningEnd;
    z.warnAfter = now;
    _mmMessage('ZONE SHRINK WARNING', FFA_ZONE_WARNING_SEC);
  }
  var g = _mmZoneGeometry(now);
  if (player && player.alive && g) {
    var dx = player.group.position.x - g.cx, dz = player.group.position.z - g.cz;
    var outside = dx * dx + dz * dz > g.r * g.r;
    if (outside && !z.lastOutside) {
      if (now >= z.warnAfter) {
        _mmMessage('IN BOMBARDMENT ZONE', 3.6);
        if (typeof sfxZoneWarning === 'function') sfxZoneWarning();
      } else z.pendingWarning = true;
    }
    if (z.pendingWarning && outside && now >= z.warnAfter) {
      z.pendingWarning = false;
      _mmMessage('IN BOMBARDMENT ZONE', 3.6);
      if (typeof sfxZoneWarning === 'function') sfxZoneWarning();
    }
    z.lastOutside = outside;
    if (!outside) z.pendingWarning = false;
  } else z.lastOutside = false;
  return g;
}
/* Low-allocation public view consumed by FFA spawn logic and the AI zone-return policy. */
function ffaSafeZoneRevision() { return _minimap.zone.revision || 0; }
function ffaSafeZoneSnapshot(out) {
  out = out || {};
  var z = _minimap.zone, now = _mmNow();
  out.revision = z.revision || 0;
  out.active = !!(z.active && isFfaMode() && gameState === 'playing');
  out.warning = false; out.contracting = false;
  if (!out.active) {
    out.cx = 0; out.cz = 0; out.r = 0;
    out.targetCx = 0; out.targetCz = 0; out.targetR = 0;
    return out;
  }
  _mmZoneGeometry(now, out);
  out.warning = z.warningStart <= now && now < z.warningEnd;
  out.contracting = z.shrinkStart >= 0 && now >= z.shrinkStart && z.shrinkEnd > z.shrinkStart && now < z.shrinkEnd;
  out.targetCx = z.toCx; out.targetCz = z.toCz; out.targetR = z.toR;
  return out;
}
/* ===== FFA 空袭门控/调度 =====
   空袭不直接改血: 每发先作为普通 arty/rk 弹体进入 shells，落点、散布、穿深、爆炸
   和 rocketThreats 均走既有管线。这里仅负责安全区阶段门控、每秒三发和目标轮转。 */
function ffaAirstrikeDamageAllowedAt(x, zc) {
  if (!isFfaMode() || gameState !== 'playing') return false;
  var now = _mmNow(), g = _mmZoneUpdate(now), z = _minimap.zone;
  /* completedShrinks=0 表示第一圈刚建立；只有某次缩圈结束后才启用轰炸。 */
  if (!g || !z.active || (z.completedShrinks || 0) <= 0) return false;
  if (z.warningStart <= now && now < z.warningEnd) return false;
  if (z.shrinkStart >= 0 && z.shrinkEnd > z.shrinkStart && now >= z.shrinkStart && now < z.shrinkEnd) return false;
  var dx = x - g.cx, dz = zc - g.cz;
  return dx * dx + dz * dz > g.r * g.r;
}
function ffaAirstrikeTargetAllowed(t) {
  if (!t || !t.alive || !t.group || !t.group.position) return false;
  return ffaAirstrikeDamageAllowedAt(t.group.position.x, t.group.position.z);
}
function _mmAirstrikeCollectTargets(g, out) {
  out.length = 0;
  if (!g || typeof aliveList === 'undefined' || !aliveList) return out;
  for (var i = 0; i < aliveList.length; i++) {
    var t = aliveList[i];
    if (!t || !t.alive || !t.group || !t.group.position) continue;
    var p = t.group.position, dx = p.x - g.cx, dz = p.z - g.cz;
    if (dx * dx + dz * dz > g.r * g.r) out.push(t);
  }
  return out;
}
function ffaAirstrikeUpdate(dt) {
  var now = _mmNow(), a = _minimap.airstrike;
  if (!isFfaMode() || gameState !== 'playing') {
    a.active = false; a.nextT = Infinity; a.cursor = 0; a.revision = -1; a.targets.length = 0;
    return;
  }
  /* step() runs before the canvas render; update the zone here too so damage and schedule
     cannot lag one render frame behind the actual shrink completion. */
  var g = _mmZoneUpdate(now), z = _minimap.zone;
  if (!g || !z.active) { a.active = false; a.nextT = Infinity; a.targets.length = 0; return; }
  if (a.revision !== z.revision) {
    a.revision = z.revision; a.active = false; a.nextT = Infinity; a.cursor = 0;
  }
  var warning = z.warningStart <= now && now < z.warningEnd;
  var contracting = z.shrinkStart >= 0 && z.shrinkEnd > z.shrinkStart && now >= z.shrinkStart && now < z.shrinkEnd;
  /* Warning and contraction are deliberately dry phases. Existing rockets remain physical,
     but ffaAirstrikeDamageAllowedAt suppresses their direct/splash damage in these phases. */
  if ((z.completedShrinks || 0) <= 0 || warning || contracting) {
    a.active = false; a.nextT = Infinity; a.targets.length = 0;
    return;
  }
  if (!a.active) { a.active = true; a.nextT = now; }
  if (now + 1e-6 < a.nextT) return;
  var targets = _mmAirstrikeCollectTargets(g, a.targets);
  if (targets.length && typeof fireFfaAirstrikeBomb === 'function') {
    for (var shot = 0; shot < FFA_AIRSTRIKE_BOMBS_PER_TICK; shot++) {
      var target = targets[a.cursor % targets.length];
      a.cursor = (a.cursor + 1) % Math.max(1, targets.length);
      fireFfaAirstrikeBomb(target, shot);
    }
  }
  a.nextT = now + FFA_AIRSTRIKE_INTERVAL;
}
function ffaSafeZoneSpawnInfo(out) {
  out = out || {};
  var z = _minimap.zone, now = _mmNow();
  if (isFfaMode() && gameState === 'playing') { _mmZoneUpdate(now); z = _minimap.zone; }
  if (z.active && isFfaMode() && gameState === 'playing') {
    _mmZoneGeometry(now, out);
    if (z.toR > 0 && ((z.warningStart <= now && now < z.warningEnd) || (z.shrinkStart >= 0 && z.shrinkEnd > z.shrinkStart && now < z.shrinkEnd))) {
      out.cx = z.toCx; out.cz = z.toCz; out.r = z.toR;
    }
    out.active = true;
    return out;
  }
  /* Before the first circle is announced, use the central portion guaranteed to fit
     inside the first PUBG-style circle regardless of its later random center. */
  var shortEdge = Math.min(MAP.len || 2000, MAP.wid || 2000);
  out.active = false; out.cx = 0; out.cz = 0; out.r = Math.max(80, shortEdge * 0.49 - 50);
  return out;
}
function _mmMapRect() {
  var len = Math.max(100, MAP.len || 2000), wid = Math.max(100, MAP.wid || 2000);
  var avail = MINIMAP_SIZE - 22, scale = Math.min(avail / wid, avail / len);
  var w = wid * scale, h = len * scale;
  return { x: (MINIMAP_SIZE - w) * 0.5, y: (MINIMAP_SIZE - h) * 0.5, w: w, h: h, scale: scale };
}
function _mmWorldToPx(x, z, rect, out) {
  var halfW = MAP.halfW != null ? MAP.halfW : (MAP.wid || 2000) / 2;
  var halfL = MAP.halfL != null ? MAP.halfL : (MAP.len || 2000) / 2;
  out.x = rect.x + _mmClamp((x + halfW) / (halfW * 2), 0, 1) * rect.w;
  out.y = rect.y + _mmClamp((halfL - z) / (halfL * 2), 0, 1) * rect.h;
  return out;
}
function _mmPaintMap(rect) {
  var c = document.createElement('canvas');
  var rw = Math.max(48, Math.round(rect.w * 0.58)), rh = Math.max(48, Math.round(rect.h * 0.58));
  c.width = rw; c.height = rh;
  var x = c.getContext('2d'), img = x.createImageData(rw, rh), a = img.data;
  var halfW = MAP.halfW != null ? MAP.halfW : (MAP.wid || 2000) / 2;
  var halfL = MAP.halfL != null ? MAP.halfL : (MAP.len || 2000) / 2;
  var st = (typeof GROUND_STYLES !== 'undefined' && GROUND_STYLES[MAP.mat]) ? GROUND_STYLES[MAP.mat] : { g: [.28, .36, .23], d: [.48, .45, .29], r: [.42, .40, .35] };
  var sx = (MAP.wid || 2000) / rw, sz = (MAP.len || 2000) / rh;
  for (var py = 0; py < rh; py++) {
    var wz = halfL - (py + 0.5) * sz;
    for (var px = 0; px < rw; px++) {
      var wx = -halfW + (px + 0.5) * sx;
      var h = typeof terrainH === 'function' ? terrainH(wx, wz) : 0;
      var hL = typeof terrainH === 'function' ? terrainH(wx - sx, wz) : h;
      var hR = typeof terrainH === 'function' ? terrainH(wx + sx, wz) : h;
      var hU = typeof terrainH === 'function' ? terrainH(wx, wz + sz) : h;
      var hD = typeof terrainH === 'function' ? terrainH(wx, wz - sz) : h;
      var dry = typeof terrainDry === 'function' ? terrainDry(h) : _mmClamp((h + 4) / 10, 0, 1);
      var slope = _mmClamp(Math.sqrt((hR - hL) * (hR - hL) + (hU - hD) * (hU - hD)) / 8, 0, 1);
      var rock = _mmClamp((slope - 0.28) * 1.6, 0, 1);
      var n = Math.sin(wx * 0.021 + wz * 0.017 + (MAP.seedF || 0) * 0.00001) * 0.055;
      var light = _mmClamp(0.88 + (hR - hL) * 0.018 + (hU - hD) * 0.014, 0.62, 1.15);
      var rr = (st.g[0] + (st.d[0] - st.g[0]) * dry) * (1 - rock) + st.r[0] * rock;
      var gg = (st.g[1] + (st.d[1] - st.g[1]) * dry) * (1 - rock) + st.r[1] * rock;
      var bb = (st.g[2] + (st.d[2] - st.g[2]) * dry) * (1 - rock) + st.r[2] * rock;
      var gi = (Math.round((wz + halfL) / (MAP.len || 2000) * (GRID_N - 1)) * GRID_N + Math.round((wx + halfW) / (MAP.wid || 2000) * (GRID_N - 1)));
      var scorch = (typeof scorchGrid !== 'undefined' && scorchGrid[gi] != null) ? scorchGrid[gi] : 0;
      rr = rr * (1 - scorch * 0.58) + 0.12 * scorch;
      gg = gg * (1 - scorch * 0.62) + 0.08 * scorch;
      bb = bb * (1 - scorch * 0.66) + 0.04 * scorch;
      var o = (py * rw + px) * 4;
      a[o] = _mmClamp(Math.round((rr + n) * light * 255), 0, 255);
      a[o + 1] = _mmClamp(Math.round((gg + n) * light * 255), 0, 255);
      a[o + 2] = _mmClamp(Math.round((bb + n) * light * 255), 0, 255);
      a[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}
function _mmDrawZone(ctx, rect, g, now) {
  if (!g) return;
  var z = _minimap.zone, flashing = now >= z.warningStart && now < z.warningEnd;
  var p = { x: 0, y: 0 };
  _mmWorldToPx(g.cx, g.cz, rect, p);
  var radiusPx = g.r * rect.scale;
  ctx.save();
  // 裁剪到真实地图矩形：收束动画的外部圆环绝不画出地图边界。
  ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
  var pulse = flashing ? (0.30 + 0.70 * (0.5 + 0.5 * Math.sin(now * 13))) : 0.95;
  var ring = z.lastOutside ? [255, 75, 75] : [69, 255, 136];
  // 预警期保留当前安全圈，同时用闪烁的第二道环标出即将收缩到的目标圈，避免边界跳变。
  ctx.setLineDash([7, 5]);
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(15,12,5,' + (Math.max(0.62, pulse) * 0.85).toFixed(3) + ')';
  ctx.beginPath(); ctx.arc(p.x, p.y, radiusPx + 2, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = 'rgba(' + ring[0] + ',' + ring[1] + ',' + ring[2] + ',' + Math.max(0.62, pulse).toFixed(3) + ')';
  ctx.beginPath(); ctx.arc(p.x, p.y, radiusPx, 0, Math.PI * 2); ctx.stroke();
  if (flashing && z.toR > 0) {
    var target = { x: 0, y: 0 };
    _mmWorldToPx(z.toCx, z.toCz, rect, target);
    var targetR = z.toR * rect.scale;
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(' + ring[0] + ',' + ring[1] + ',' + ring[2] + ',' + pulse.toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(target.x, target.y, targetR, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}
function _mmDrawStrategicBombardments(ctx, rect, now) {
  if (typeof strategicSupportGetActiveBombardments !== 'function') return;
  var active = strategicSupportGetActiveBombardments();
  if (!active || !active.length) return;
  var p = { x: 0, y: 0 };
  ctx.save();
  ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
  for (var i = 0; i < active.length; i++) {
    var b = active[i];
    if (!b || b.type !== 'bombardment' || !(b.until > now) || !(b.radius > 0)) continue;
    _mmWorldToPx(b.cx, b.cz, rect, p);
    var radiusPx = b.radius * rect.scale;
    var pulse = 0.76 + 0.24 * (0.5 + 0.5 * Math.sin(now * 9 + b.id));
    /* Reuse the safe-zone ring language: dark under-stroke, dashed tactical line,
       and a clean red perimeter.  This is intentionally outline-only on the map. */
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(15,12,5,.90)';
    ctx.beginPath(); ctx.arc(p.x, p.y, radiusPx + 2, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(255,75,75,' + pulse.toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(p.x, p.y, radiusPx, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,75,75,' + Math.min(1, pulse + 0.12).toFixed(3) + ')';
    ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('B', p.x, p.y);
  }
  ctx.restore();
}
function _mmDrawControlZones(ctx, rect) {
  if (typeof controlZonesActive !== 'function' || !controlZonesActive() || typeof controlZones === 'undefined') return;
  var p = { x: 0, y: 0 };
  ctx.save();
  ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
  for (var i = 0; i < controlZones.length; i++) {
    var z = controlZones[i];
    _mmWorldToPx(z.x, z.cz, rect, p);
    var c = typeof controlZoneColor === 'function' ? controlZoneColor(z) : { r: 244, g: 244, b: 236 };
    var captureTeam = typeof controlZoneCaptureTeam === 'function' ? controlZoneCaptureTeam(z) : (z.captureTeam || z.owner || null);
    var progress = typeof controlZoneCaptureProgress === 'function' ? controlZoneCaptureProgress(z) :
      (captureTeam ? (z.captureTeam ? _mmClamp(z.progress || 0, 0, 1) : 1) : 0);
    var faction = captureTeam && typeof controlZoneTeamColor === 'function' ? controlZoneTeamColor(captureTeam) : { r: 244, g: 244, b: 236 };
    var r = MINIMAP_CONTROL_ZONE_MARKER_RADIUS;
    var start = -Math.PI / 2, end = start + Math.PI * 2 * progress;

    /* Control-zone markers are deliberately 1.2 times the live unit marker
       radius and use a circular progress fill, not a tiny world-scale dot. */
    ctx.fillStyle = 'rgba(7,11,8,.92)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(244,244,236,.70)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    if (captureTeam && progress > 0) {
      ctx.fillStyle = 'rgba(' + faction.r + ',' + faction.g + ',' + faction.b + ',.92)';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, r, start, end); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(' + faction.r + ',' + faction.g + ',' + faction.b + ',.98)'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(p.x, p.y, r - 0.8, start, end); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(12,16,12,.96)'; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',.98)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(p.x, p.y, r - 1.2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#071008'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(244,244,236,.95)';
    ctx.strokeText(z.id, p.x, p.y + 0.5);
    ctx.fillStyle = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',1)';
    ctx.fillText(z.id, p.x, p.y + 0.5);
  }
  ctx.restore();
}
function _mmDrawToken(ctx, x, y, rec, now) {
  var dead = rec.dead, fire = !dead && rec.fireUntil > now;
  // 玩家由常驻绿色箭头表示；自己的开火只让箭头脉冲，不再叠加第二个点位。
  if (!dead && rec.tank === player) return;
  if (!dead && !fire) return;
  var col = rec.friendly ? '#45ff88' : '#ff4b4b';
  ctx.save();
  ctx.translate(x, y);
  if (dead) {
    var deadAge = Math.max(0, now - rec.deathT);
    var pulse = deadAge < 0.75;
    if (pulse) {
      var q = _mmClamp(deadAge / 0.75, 0, 1);
      ctx.globalAlpha = 1 - q * 0.55;
      ctx.strokeStyle = '#ffd93b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 7 + q * 7, 0, Math.PI * 2); ctx.stroke();
    }
    if (deadAge < MINIMAP_DEATH_HIGHLIGHT_SEC) {
      /* Fresh wrecks remain clear yellow for a short, useful read window. */
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#141414'; ctx.lineWidth = 5; ctx.lineCap = 'square';
      ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(6, 6); ctx.moveTo(6, -6); ctx.lineTo(-6, 6); ctx.stroke();
      ctx.strokeStyle = '#ffd93b'; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(6, 6); ctx.moveTo(6, -6); ctx.lineTo(-6, 6); ctx.stroke();
    } else {
      /* Old wrecks are deliberately quiet and blinking. The caller draws every dead
         record before zone/live markers, so this is the minimap's lowest marker layer. */
      var greyBlink = (Math.floor((deadAge - MINIMAP_DEATH_HIGHLIGHT_SEC) * 2.6) % 2) === 0;
      ctx.globalAlpha = greyBlink ? 0.34 : 0.10;
      ctx.strokeStyle = '#22282a'; ctx.lineWidth = 4.5; ctx.lineCap = 'square';
      ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(6, 6); ctx.moveTo(6, -6); ctx.lineTo(-6, 6); ctx.stroke();
      ctx.strokeStyle = '#7d878a'; ctx.lineWidth = 2.1;
      ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(6, 6); ctx.moveTo(6, -6); ctx.lineTo(-6, 6); ctx.stroke();
    }
  } else {
    var blink = Math.floor((now - rec.fireStart) * 7) % 2 === 0;
    ctx.globalAlpha = blink ? 1 : 0.22;
    ctx.strokeStyle = '#141414'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, MINIMAP_UNIT_MARKER_RADIUS, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffd93b'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, MINIMAP_UNIT_MARKER_RADIUS + (blink ? 2 : 0), 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#141414'; ctx.fillRect(-6, -6, 12, 12);
    ctx.fillStyle = col; ctx.fillRect(-4, -4, 8, 8);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = '#141414'; ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(rec.friendly ? 'F' : 'E', 0, 0.5);
  }
  ctx.restore();
}
function _mmDrawArtyImpact(ctx, rect, now) {
  /* scopeInfo.point is the same first-rocket impact point consumed by fireShell.
     The outer ring uses the real salvo pattern plus the real blast radius, never the
     cursor's raw designation point. */
  if (!player || !player.alive || player.kind !== 'arty' || scopeT <= 0.5 ||
      typeof scopeInfo === 'undefined' || !scopeInfo.point) return;
  var q = scopeInfo.point;
  if (!isFinite(q.x) || !isFinite(q.z)) return;
  var spec = typeof artyConfOf === 'function' ? artyConfOf(player) : null;
  var damage = spec && spec.dmg != null ? spec.dmg : 60;
  var splash = typeof splashRadiusFromDamage === 'function' ? splashRadiusFromDamage(damage) : (spec && spec.splashR != null ? spec.splashR : 22);
  var coverage = typeof artyCoverageRadius === 'function' ? artyCoverageRadius(player) : splash;
  var p = { x: 0, y: 0 };
  _mmWorldToPx(q.x, q.z, rect, p);
  var outerPx = Math.max(4, coverage * rect.scale), splashPx = Math.max(2.5, splash * rect.scale);
  ctx.save();
  ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
  var pulse = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(now * 8));
  /* Outer yellow ring = full physical salvo coverage; inner red ring = one actual blast. */
  ctx.setLineDash([8, 5]);
  ctx.strokeStyle = 'rgba(20,15,4,.94)'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(p.x, p.y, outerPx + 1, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,210,55,' + pulse.toFixed(3) + ')'; ctx.lineWidth = 2.1;
  ctx.beginPath(); ctx.arc(p.x, p.y, outerPx, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = 'rgba(255,66,74,' + pulse.toFixed(3) + ')'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.arc(p.x, p.y, splashPx, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  /* Small red rocket glyph at the exact simulated center. */
  ctx.translate(p.x, p.y);
  ctx.fillStyle = '#141414'; ctx.strokeStyle = '#141414'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(3.2, 2.5); ctx.lineTo(0, 7); ctx.lineTo(-3.2, 2.5); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ff4650'; ctx.strokeStyle = '#ffb0b4'; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(2.0, 2.0); ctx.lineTo(0, 5); ctx.lineTo(-2.0, 2.0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#ff4650'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(-4.5, 3); ctx.lineTo(-7, 6); ctx.moveTo(4.5, 3); ctx.lineTo(7, 6); ctx.stroke();
  ctx.restore();
}
function _mmDrawPlayerArrow(ctx, rect, now) {
  if (!player || !player.alive || !player.group) return;
  var p = { x: 0, y: 0 }, pos = player.group.position;
  _mmWorldToPx(pos.x, pos.z, rect, p);
  var fireRec = _mmFindRecord(player), firing = fireRec && fireRec.fireUntil > now;
  ctx.save();
  ctx.translate(p.x, p.y);
  /* The arrow follows the live camera/aim azimuth, not the vehicle body yaw. */
  var viewYaw = _mmPlayerArrowYaw();
  /* camAimY increases when the view turns left, while Canvas positive angles
     rotate clockwise because its Y axis points down; negate the world yaw so
     the arrow turns in the same direction as the player's view. */
  ctx.rotate(-viewYaw);
  var pulse = firing ? (0.72 + 0.28 * (0.5 + 0.5 * Math.sin(now * 18))) : 1;
  ctx.globalAlpha = pulse;
  ctx.fillStyle = '#141414';
  ctx.strokeStyle = '#141414'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 5); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#45ff88'; ctx.strokeStyle = '#45ff88'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#d8ffe5'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(0, 4); ctx.stroke();
  ctx.restore();
}
function _mmDraw(now, zone) {
  var M = _mmEls(), ctx = M.ctx;
  if (!ctx) return;
  var rect = _mmMapRect();
  ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
  ctx.fillStyle = '#071008'; ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
  /* The terrain, range rings, control markers, events, and the player arrow share
     one fixed match-entry rotation.  This rotates the map once instead of chasing
     the camera every frame, while making the first green arrow point straight up. */
  ctx.save();
  _mmApplyMapOrientation(ctx);
  if (M.mapImage) ctx.drawImage(M.mapImage, rect.x, rect.y, rect.w, rect.h);
  ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
  ctx.strokeStyle = 'rgba(157,255,168,.16)'; ctx.lineWidth = 1;
  for (var i = 1; i < 4; i++) {
    var gx = rect.x + rect.w * i / 4, gy = rect.y + rect.h * i / 4;
    ctx.beginPath(); ctx.moveTo(gx, rect.y); ctx.lineTo(gx, rect.y + rect.h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rect.x, gy); ctx.lineTo(rect.x + rect.w, gy); ctx.stroke();
  }
  ctx.restore();
  var p = { x: 0, y: 0 };
  /* Lowest layer: dead X marks are rendered first, before the zone and every live/event
     marker. This also lets the artillery impact ring cover old gray wreck markers. */
  for (var jd = 0; jd < M.events.length; jd++) {
    var deadRec = M.events[jd];
    if (!deadRec.dead) continue;
    _mmWorldToPx(deadRec.x, deadRec.z, rect, p);
    _mmDrawToken(ctx, p.x, p.y, deadRec, now);
  }
  if (zone) _mmDrawZone(ctx, rect, zone, now);
  _mmDrawStrategicBombardments(ctx, rect, now);
  _mmDrawControlZones(ctx, rect);
  /* Powerup icons sit above the zone/dead-wreck layers and below the live event layer. */
  if (typeof powerupDrawMinimap === 'function') powerupDrawMinimap(ctx, rect, now);
  _mmDrawArtyImpact(ctx, rect, now);
  for (var j = 0; j < M.events.length; j++) {
    var rec = M.events[j];
    if (rec.dead) continue;
    if (rec.tank && rec.tank.alive && rec.tank.group) { rec.x = rec.tank.group.position.x; rec.z = rec.tank.group.position.z; }
    _mmWorldToPx(rec.x, rec.z, rect, p);
    _mmDrawToken(ctx, p.x, p.y, rec, now);
  }
  ctx.fillStyle = '#c8ffc0'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText('N', MINIMAP_SIZE / 2, 3);
  /* Always render last inside the same orientation: at match entry the arrow
     points up and its tail remains down, then it reacts only to later aim changes. */
  _mmDrawPlayerArrow(ctx, rect, now);
  ctx.restore();
  ctx.strokeStyle = '#141414'; ctx.lineWidth = 3; ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = 'rgba(157,255,168,.8)'; ctx.lineWidth = 1; ctx.strokeRect(rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4);
}
function minimapTick(dt) {
  var M = _mmEls(), now = _mmNow();
  if (!M.ctx || gameState !== 'playing') { _mmMessageTick(now); return; }
  minimapAutoOrient();
  var rect = _mmMapRect();
  var mapKey = String(MAP.seed || '') + ':' + MAP.len + ':' + MAP.wid + ':' + MAP.rough + ':' + MAP.mat;
  if (mapKey !== M.mapKey || M.mapDentEpoch !== (typeof dentEpoch !== 'undefined' ? dentEpoch : 0) || now - M.mapPaintT > 1.0) {
    M.mapImage = _mmPaintMap(rect); M.mapKey = mapKey; M.mapDentEpoch = typeof dentEpoch !== 'undefined' ? dentEpoch : 0; M.mapPaintT = now;
  }
  var zone = _mmZoneUpdate(now);
  _mmDraw(now, zone);
  if (M.stateEl) {
    if (!isFfaMode()) {
      var _tdmZoneStatus = typeof controlZonesMinimapStatus === 'function' ? controlZonesMinimapStatus() : 'ZONE: N/A';
      var _tdmBombardments = typeof strategicSupportActiveBombardmentCount === 'function' ? strategicSupportActiveBombardmentCount() : 0;
      M.stateEl.textContent = _tdmZoneStatus + (_tdmBombardments ? ' // BOMBARDMENT' : '');
    } else if (!zone) M.stateEl.textContent = 'ZONE: STANDBY ' + Math.max(0, Math.ceil(FFA_ZONE_START_DELAY - (now - startT))) + 's';
    else if (M.zone.warningStart <= now && now < M.zone.warningEnd) M.stateEl.textContent = 'ZONE SHRINK WARNING';
    else if (M.zone.lastOutside) M.stateEl.textContent = 'BOMBARDMENT ZONE';
    else M.stateEl.textContent = 'SAFE ZONE ACTIVE';
  }
  if (M.panel) M.panel.classList.toggle('zone-danger', !!(zone && M.zone.lastOutside));
  if (M.scaleEl && MAP.len && MAP.wid) M.scaleEl.textContent = Math.round(Math.min(MAP.len, MAP.wid)) + 'm GRID';
  _mmMessageTick(now);
  M.lastTickT = now;
}
function minimapReset() {
  _minimap.events.length = 0;
  _minimap.mapImage = null; _minimap.mapKey = ''; _minimap.mapPaintT = -99; _minimap.mapDentEpoch = -1;
  _minimap.mapOrientation = 0; _minimap.mapOrientationSet = false;
  _minimap.zone = { active: false, started: false, announcedAt: -99, nextShrinkT: Infinity,
    cx: 0, cz: 0, radius: 0, fromCx: 0, fromCz: 0, fromR: 0, toCx: 0, toCz: 0, toR: 0,
    shrinkStart: -99, shrinkEnd: -99, warningStart: -99, warningEnd: -99, phase: 0, completedShrinks: 0, revision: 0,
    _powerupShrinkRevision: -1, _powerupGeneration: -1, flashUntil: -99, lastOutside: false, pendingWarning: false, warnAfter: -99 };
  _minimap.airstrike = { revision: -1, active: false, nextT: Infinity, cursor: 0, targets: [] };
  _minimap.msgUntil = -99; _minimap.msgText = '';
  if (typeof powerupReset === 'function') powerupReset();
  var M = _mmEls();
  if (M.msgEl) M.msgEl.classList.remove('on');
  if (M.panel) M.panel.classList.remove('zone-danger');
}

_mmBindPreferences();
