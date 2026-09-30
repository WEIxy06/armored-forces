/* ===== Module: powerups.js ===== */
/*
   FFA-only random battlefield powerups.
   The module deliberately owns spawning, pickup, effect timers, HUD, minimap markers,
   AI pickup routing, kill drops, and the shared ten-second blink rule.  TDM never
   enters this module's active paths.
*/
'use strict';

var POWERUP_DURATION_SEC = 15;
var POWERUP_REPAIR_DELAY_SEC = 10;
var POWERUP_PICKUP_RADIUS = 5.5;
var POWERUP_MAP_ITEM_MARGIN = 0.88;
var POWERUP_SPEED_BONUS_MPS = 10 / 3.6;
var POWERUP_FIXED_PEN_BONUS_MM = 150;
var POWERUP_FIXED_ARMOR_BONUS_MM = 150;
var POWERUP_REPAIR_STRUCT_POINTS = 90;
/* The upright marker's lowest animated point is the outer ring radius plus the
   full bob amplitude.  Keep that point above the highest nearby terrain sample,
   not merely above terrainH at the item's center. */
var POWERUP_MARKER_RING_RADIUS = 1.56;
var POWERUP_MARKER_BOB_AMPLITUDE = 0.18;
var POWERUP_MARKER_CLEARANCE = 0.10;
var POWERUP_MARKER_SAMPLE_RADIUS = 1.70;
var POWERUP_MARKER_SAMPLE_OFFSETS = [
  [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, 0.7071], [-0.7071, -0.7071]
];

var POWERUP_KIND_ORDER = ['superPen', 'superArmor', 'superReload', 'rocketBoost', 'emergencyRepair'];
var POWERUP_DEFS = {
  superPen: {
    label: 'SUPER AP', short: 'AP', glyph: 'AP', color: '#ff4b3e', colorRGB: '255,75,62',
    description: '+150 MM PENETRATION'
  },
  superArmor: {
    label: 'SUPER ARMOR', short: 'ARM', glyph: 'AR', color: '#4fc3ff', colorRGB: '79,195,255',
    description: '+150 MM EFFECTIVE ARMOR'
  },
  superReload: {
    label: 'SUPER RELOAD', short: 'RLD', glyph: 'R', color: '#ffd447', colorRGB: '255,212,71',
    description: 'RELOAD SPEED ×2'
  },
  rocketBoost: {
    label: 'ROCKET BOOST', short: 'SPD', glyph: '10', color: '#9dffa8', colorRGB: '157,255,168',
    description: '+10 KM/H (GROUND ONLY)'
  },
  emergencyRepair: {
    label: 'EMERGENCY REPAIR', short: 'REP', glyph: '+', color: '#ffb020', colorRGB: '255,176,32',
    description: 'REPAIR IN 10S'
  }
};

/* Public for minimap.js and deterministic regression harnesses. */
var powerupItems = [];
var _powerupItemSeq = 0;
var _powerupLastZoneRevision = -1;
var _powerupSpawnSerial = 0;
var _powerupHudRoot = null;
var _powerupHudNodes = Object.create(null);
var _powerupHudSignature = '';
var _powerupHudTickT = -99;
var _powerupPickupT = -99;
var _powerupAuraScratch = (typeof THREE !== 'undefined') ? new THREE.Vector3() : null;
var _powerupAuraScreenT = -99;
var _powerupScreenPoint = (typeof THREE !== 'undefined') ? new THREE.Vector3() : null;
var _powerupFfaFallback = false;
/* Thermal imaging treats a dropped powerup like the ground: no additive glow and
   the same neutral heat color.  Keep this state here so markers/aura created
   while thermal is already active receive the same treatment immediately. */
var _powerupThermalOn = false;
var _powerupThermalGround = 0x9c9c9c;

function powerupsFfaEnabled() {
  if (typeof isFfaMode === 'function') return !!isFfaMode();
  return !!_powerupFfaFallback;
}
function powerupSetFfaFallback(v) { _powerupFfaFallback = !!v; }
function powerupNow() { return (typeof gameT === 'number' && isFinite(gameT)) ? gameT : 0; }
function powerupDef(kind) { return POWERUP_DEFS[kind] || POWERUP_DEFS.superPen; }
function powerupKindValid(kind) { return !!POWERUP_DEFS[kind]; }
function powerupStateMap(t) {
  if (!t) return null;
  if (!t._powerups) t._powerups = Object.create(null);
  return t._powerups;
}
function powerupState(t, kind) {
  var m = powerupStateMap(t);
  return m ? m[kind] : null;
}
function powerupActive(t, kind, now) {
  if (!t || !powerupKindValid(kind) || !powerupsFfaEnabled()) return false;
  var s = powerupState(t, kind);
  return !!(s && s.expiresAt > (now == null ? powerupNow() : now));
}

/* These four accessors are the only consumers used by the combat/physics modules. */
function powerupPenetrationBonus(t) {
  return powerupActive(t, 'superPen') ? POWERUP_FIXED_PEN_BONUS_MM : 0;
}
function powerupArmorBonus(t) {
  return powerupActive(t, 'superArmor') ? POWERUP_FIXED_ARMOR_BONUS_MM : 0;
}
function powerupReloadRate(t) {
  return powerupActive(t, 'superReload') ? 2 : 1;
}
function powerupSpeedBonusMps(t) {
  if (!powerupActive(t, 'rocketBoost')) return 0;
  if (typeof isHeliVehicle === 'function' && isHeliVehicle(t)) return 0;
  /* Keep a safe fallback for small no-Three test harnesses. */
  if (t && (t.kind === 'ah64' || t.kind === 'wz10')) return 0;
  return POWERUP_SPEED_BONUS_MPS;
}

/*
   Shared blink rule for every source and every kind.
   A map item changes expiresAt/blinkAt when the safe zone starts contracting; a kill
   drop is born with blinkAt=expiresAt-10.  Rendering never branches on source/kind.
*/
function powerupItemIsBlinking(item, now) {
  now = now == null ? powerupNow() : now;
  return !!(item && item.blinkAt != null && now >= item.blinkAt && now < item.expiresAt);
}
function powerupItemAlpha(item, now) {
  now = now == null ? powerupNow() : now;
  if (!item || now >= item.expiresAt) return 0;
  if (!powerupItemIsBlinking(item, now)) return 1;
  return (Math.floor((now - item.blinkAt) * 8) % 2 === 0) ? 1 : 0.18;
}

function _powerupRandomKind() {
  var n = Math.floor(Math.random() * POWERUP_KIND_ORDER.length);
  return POWERUP_KIND_ORDER[Math.max(0, Math.min(POWERUP_KIND_ORDER.length - 1, n))];
}
function _powerupTerrainY(x, z) {
  return typeof terrainH === 'function' ? terrainH(x, z) : 0;
}
function _powerupTerrainSupportY(x, z) {
  var highest = _powerupTerrainY(x, z);
  for (var i = 1; i < POWERUP_MARKER_SAMPLE_OFFSETS.length; i++) {
    var o = POWERUP_MARKER_SAMPLE_OFFSETS[i];
    highest = Math.max(highest, _powerupTerrainY(
      x + o[0] * POWERUP_MARKER_SAMPLE_RADIUS,
      z + o[1] * POWERUP_MARKER_SAMPLE_RADIUS
    ));
  }
  return highest;
}
function _powerupMarkerY(item, now) {
  now = now == null ? powerupNow() : now;
  if (!item) return 0;
  /* Re-sample periodically so an artillery crater or other terrain edit cannot
     move the drop through the ground after it has spawned. */
  if (item._supportY == null || item._supportSampleT == null || now - item._supportSampleT >= 0.25) {
    item._supportY = _powerupTerrainSupportY(item.x, item.z);
    item._supportSampleT = now;
  }
  return item._supportY + POWERUP_MARKER_RING_RADIUS + POWERUP_MARKER_BOB_AMPLITUDE +
    POWERUP_MARKER_CLEARANCE + Math.sin(now * 2.3 + item._phase) * POWERUP_MARKER_BOB_AMPLITUDE;
}
/* Small public bridge used by the preloaded AI module without coupling it to marker code. */
function _powerupTerrainHForAI(x, z) { return _powerupTerrainY(x, z); }
function _powerupCanPlace(x, z, minGap, ignoreTank) {
  if (typeof CONF !== 'undefined' && CONF && CONF.bounds != null) {
    if (Math.abs(x) > CONF.bounds - 8 || Math.abs(z) > CONF.bounds - 8) return false;
  }
  /* validDest is the authoritative static-world gate: it checks the registered
     obstacle grid, wreck grid, map bounds, and (when applicable) navigation
     reachability.  Do not bypass it for a crowded/random fallback. */
  if (typeof validDest === 'function' && !validDest(x, z, null, true)) return false;
  var gap = minGap == null ? 8 : Math.max(0, minGap), gap2 = gap * gap;
  if (ignoreTank && ignoreTank.group && ignoreTank.group.position) {
    var ip = ignoreTank.group.position, idz = z - ip.z, idx = x - ip.x;
    var ir = Math.max(0, +ignoreTank.radius || 0) + 3;
    if (idx * idx + idz * idz < ir * ir) return false;
  }
  if (typeof aliveList !== 'undefined' && aliveList) {
    for (var i = 0; i < aliveList.length; i++) {
      var t = aliveList[i];
      if (!t || !t.alive || !t.group || !t.group.position) continue;
      var p = t.group.position, dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz < gap2) return false;
    }
  }
  for (var j = 0; j < powerupItems.length; j++) {
    var it = powerupItems[j];
    if (!it || it._removed || it.expiresAt <= powerupNow()) continue;
    var ix = x - it.x, iz = z - it.z;
    if (ix * ix + iz * iz < gap2) return false;
  }
  return true;
}

function _powerupSetMaterialAlpha(root, alpha) {
  if (!root) return;
  root.traverse(function (o) {
    if (!o || !o.material) return;
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    for (var i = 0; i < mats.length; i++) {
      if (mats[i].userData && mats[i].userData.powerupBaseOpacity != null) {
        mats[i].opacity = mats[i].userData.powerupBaseOpacity * alpha;
      }
    }
  });
}
function _powerupThermalApplyMaterial(mat, active, groundHex) {
  if (!mat || !mat.color || !mat.userData || mat.userData.powerupBaseOpacity == null) return;
  var ud = mat.userData;
  if (ud.powerupThermalSavedColor == null) {
    ud.powerupThermalSavedColor = mat.color.getHex();
    ud.powerupThermalSavedBlending = mat.blending;
  }
  if (active) {
    mat.color.setHex(groundHex == null ? _powerupThermalGround : groundHex);
    /* Additive blending is the visual source of the glow.  Thermal markers are
       ordinary heat-colored geometry, not emissive/HUD graphics. */
    mat.blending = typeof THREE !== 'undefined' && THREE.NormalBlending != null ? THREE.NormalBlending : 1;
  } else {
    mat.color.setHex(ud.powerupThermalSavedColor);
    mat.blending = ud.powerupThermalSavedBlending;
  }
  mat.needsUpdate = true;
}
function _powerupThermalApplyTree(root, active, groundHex) {
  if (!root || !root.traverse) return;
  root.traverse(function (o) {
    if (!o || !o.material) return;
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    for (var i = 0; i < mats.length; i++) _powerupThermalApplyMaterial(mats[i], active, groundHex);
  });
}
/* Called by combat.js at the thermal edge.  It also covers active vehicle auras,
   so no powerup visual remains additive while the thermal view is enabled. */
function powerupThermalSync(active, groundHex) {
  _powerupThermalOn = !!active;
  if (groundHex != null) _powerupThermalGround = groundHex;
  for (var i = 0; i < powerupItems.length; i++) {
    if (powerupItems[i] && powerupItems[i].group) _powerupThermalApplyTree(powerupItems[i].group, _powerupThermalOn, _powerupThermalGround);
  }
  if (typeof tanks !== 'undefined' && tanks) {
    for (var ti = 0; ti < tanks.length; ti++) {
      if (tanks[ti] && tanks[ti]._powerupAura) _powerupThermalApplyTree(tanks[ti]._powerupAura, _powerupThermalOn, _powerupThermalGround);
    }
  }
}
function _powerupHoloMaterial(def, opacity, line) {
  /* World-space FFA markers must participate in the scene depth buffer.  A prior
     HUD-style setting here made every ring/glyph draw through terrain and wrecks. */
  var opts = { color: def.color, transparent: true, opacity: opacity, side: THREE.DoubleSide,
    depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending };
  var mat = line ? new THREE.LineBasicMaterial(opts) : new THREE.MeshBasicMaterial(opts);
  mat.userData = { powerupBaseOpacity: opacity };
  if (_powerupThermalOn) _powerupThermalApplyMaterial(mat, true, _powerupThermalGround);
  return mat;
}
function _powerupLineGeometry(points, closed) {
  var a = [];
  for (var i = 0; i < points.length; i++) {
    a.push(points[i][0], points[i][1], points[i][2] || 0);
  }
  if (closed && points.length) a.push(points[0][0], points[0][1], points[0][2] || 0);
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
  return geo;
}
function _powerupLineLoop(points, mat, order) {
  var line = new THREE.Line(_powerupLineGeometry(points, true), mat);
  line.renderOrder = order || 70;
  line.frustumCulled = false;
  return line;
}
function _powerupLineSegments(points, mat, order) {
  var line = new THREE.LineSegments(_powerupLineGeometry(points, false), mat);
  line.renderOrder = order || 70;
  line.frustumCulled = false;
  return line;
}
function _powerupDashCircle(radius, z) {
  var pts = [], n = 32, step = Math.PI * 2 / n;
  for (var i = 0; i < n; i += 2) {
    var a0 = i * step, a1 = (i + 0.72) * step;
    pts.push([Math.cos(a0) * radius, Math.sin(a0) * radius, z || 0]);
    pts.push([Math.cos(a1) * radius, Math.sin(a1) * radius, z || 0]);
  }
  return pts;
}
function _powerupHoloGlyph(kind, def, g, spinNodes) {
  var mat = _powerupHoloMaterial(def, 0.95, true);
  var dim = _powerupHoloMaterial(def, 0.52, true);
  var shape, accents = [];
  if (kind === 'superPen') {
    /* Upright shell/round silhouette: nose, casing and two stabilizer fins. */
    shape = [[0, 0.70, 0], [0.22, 0.28, 0], [0.22, -0.30, 0], [0.42, -0.56, 0],
      [-0.42, -0.56, 0], [-0.22, -0.30, 0], [-0.22, 0.28, 0]];
    accents = [[0, 0.48, 0.01, 0, -0.43, 0.01], [-0.22, -0.30, 0.01, -0.50, -0.48, 0.01],
      [0.22, -0.30, 0.01, 0.50, -0.48, 0.01]];
  } else if (kind === 'superArmor') {
    /* Shield plate with a smaller inner chevron, matching the BIOS armor language. */
    shape = [[0, 0.68, 0], [0.48, 0.40, 0], [0.40, -0.28, 0], [0, -0.68, 0],
      [-0.40, -0.28, 0], [-0.48, 0.40, 0]];
    accents = [[-0.23, 0.05, 0.01, 0, -0.22, 0.01], [0, -0.22, 0.01, 0.25, 0.20, 0.01]];
  } else if (kind === 'superReload') {
    /* Loader module: round counter with a central indexed bar and side ticks. */
    shape = [[0, 0.56, 0], [0.40, 0.40, 0], [0.56, 0, 0], [0.40, -0.40, 0],
      [0, -0.56, 0], [-0.40, -0.40, 0], [-0.56, 0, 0], [-0.40, 0.40, 0]];
    accents = [[0, 0.34, 0.01, 0, -0.34, 0.01], [-0.17, -0.10, 0.01, 0.17, -0.10, 0.01],
      [-0.72, 0.28, 0.01, -0.58, 0.28, 0.01], [0.58, 0.28, 0.01, 0.72, 0.28, 0.01]];
  } else if (kind === 'rocketBoost') {
    /* Upward chevron and exhaust bars: speed/propulsion read at a glance. */
    shape = [[0, 0.70, 0], [0.48, 0.08, 0], [0.20, 0.08, 0], [0.20, -0.52, 0],
      [-0.20, -0.52, 0], [-0.20, 0.08, 0], [-0.48, 0.08, 0]];
    accents = [[-0.33, -0.68, 0.01, -0.08, -0.68, 0.01], [0.08, -0.68, 0.01, 0.33, -0.68, 0.01]];
  } else {
    /* Emergency repair: technical plus with four registration brackets. */
    shape = [[-0.16, 0.58, 0], [0.16, 0.58, 0], [0.16, 0.16, 0], [0.58, 0.16, 0],
      [0.58, -0.16, 0], [0.16, -0.16, 0], [0.16, -0.58, 0], [-0.16, -0.58, 0],
      [-0.16, -0.16, 0], [-0.58, -0.16, 0], [-0.58, 0.16, 0], [-0.16, 0.16, 0]];
    accents = [[-0.82, 0.58, 0.01, -0.58, 0.82, 0.01], [0.58, 0.82, 0.01, 0.82, 0.58, 0.01],
      [-0.82, -0.58, 0.01, -0.58, -0.82, 0.01], [0.58, -0.82, 0.01, 0.82, -0.58, 0.01]];
  }
  var main = _powerupLineLoop(shape, mat, 72);
  main.userData.powerupGlyph = true;
  g.add(main);
  if (accents.length) {
    var flat = [];
    for (var j = 0; j < accents.length; j++) flat.push([accents[j][0], accents[j][1], accents[j][2]], [accents[j][3], accents[j][4], accents[j][5]]);
    var accentLine = _powerupLineSegments(flat, dim, 73);
    accentLine.userData.powerupGlyphAccent = true;
    g.add(accentLine);
  }
  /* A slim inner scan ring rotates inside the fixed symbol. */
  var scan = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.018, 4, 32), _powerupHoloMaterial(def, 0.34, false));
  scan.userData.powerupSpinZ = true;
  scan.userData.powerupSpinSpeed = kind === 'superReload' ? -1.5 : 1.1;
  scan.renderOrder = 71;
  g.add(scan);
  spinNodes.push(scan);
}
function _powerupWorldMarker(item) {
  if (typeof THREE === 'undefined' || typeof scene === 'undefined' || !scene) return null;
  var def = powerupDef(item.kind), g = new THREE.Group();
  g.name = 'FFA_POWERUP_' + item.kind;
  /* Holographic UI panel: upright XY plane, horizontal billboard yaw, no solid volume. */
  g.userData = { powerupItem: item, powerupBillboard: true, powerupSpinNodes: [] };

  var backMat = new THREE.MeshBasicMaterial({ color: 0x071008, transparent: true, opacity: 0.18,
    side: THREE.DoubleSide, depthTest: true, depthWrite: false });
  backMat.userData = { powerupBaseOpacity: 0.18 };
  if (_powerupThermalOn) _powerupThermalApplyMaterial(backMat, true, _powerupThermalGround);
  var back = new THREE.Mesh(new THREE.CircleGeometry(1.08, 32), backMat);
  back.renderOrder = 68;
  back.userData.powerupBackplate = true;
  g.add(back);

  var ringMat = _powerupHoloMaterial(def, 0.82, false);
  var ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.065, 6, 48), ringMat);
  /* No X rotation: TorusGeometry's XY plane is the requested vertical ring. */
  ring.renderOrder = 70;
  ring.userData.powerupRing = true;
  g.add(ring);

  var echoMat = _powerupHoloMaterial(def, 0.30, false);
  var echo = new THREE.Mesh(new THREE.TorusGeometry(1.56, 0.022, 4, 36), echoMat);
  echo.renderOrder = 69;
  echo.userData.powerupSpinZ = true;
  echo.userData.powerupSpinSpeed = -0.75;
  g.add(echo);
  g.userData.powerupSpinNodes.push(echo);

  var dash = _powerupLineSegments(_powerupDashCircle(1.48, 0.015), _powerupHoloMaterial(def, 0.72, true), 71);
  dash.userData.powerupSpinZ = true;
  dash.userData.powerupSpinSpeed = 0.95;
  g.add(dash);
  g.userData.powerupSpinNodes.push(dash);

  _powerupHoloGlyph(item.kind, def, g, g.userData.powerupSpinNodes);
  g.position.set(item.x, _powerupMarkerY(item, powerupNow()), item.z);
  scene.add(g);
  return g;
}
function _powerupNewItem(kind, x, z, source, lifetime, blinkAt) {
  if (!powerupKindValid(kind)) kind = _powerupRandomKind();
  var now = powerupNow();
  var item = {
    id: 'pu_' + (++_powerupItemSeq), kind: kind, x: x, z: z,
    source: source || 'zone', bornAt: now,
    expiresAt: now + (lifetime == null ? POWERUP_DURATION_SEC : lifetime),
    blinkAt: blinkAt == null ? now + (lifetime == null ? POWERUP_DURATION_SEC : lifetime) - 10 : blinkAt,
    group: null, _removed: false, _phase: Math.random() * Math.PI * 2
  };
  item.group = _powerupWorldMarker(item);
  powerupItems.push(item);
  return item;
}
function _powerupRemoveItem(item) {
  if (!item || item._removed) return;
  item._removed = true;
  if (item.group && item.group.parent) item.group.parent.remove(item.group);
  if (item.group && item.group.traverse) {
    item.group.traverse(function (o) {
      if (!o || !o.material) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      for (var i = 0; i < mats.length; i++) if (mats[i] && mats[i].dispose) mats[i].dispose();
    });
  }
  var ix = powerupItems.indexOf(item);
  if (ix >= 0) powerupItems.splice(ix, 1);
}
function _powerupTryZonePoint(cx, cz, r) {
  /* Random first for normal play, then a bounded deterministic spiral.  Both paths
     use the same world-validity gate; the old fallback created an item without
     calling validDest and could put it inside an obstacle or a wreck. */
  var maxR = Math.max(0.5, r * POWERUP_MAP_ITEM_MARGIN), tries, rr, a, x, z;
  for (tries = 0; tries < 18; tries++) {
    rr = Math.sqrt(Math.random()) * maxR;
    a = Math.random() * Math.PI * 2;
    x = cx + Math.sin(a) * rr; z = cz + Math.cos(a) * rr;
    if (_powerupCanPlace(x, z, 10)) return { x: x, z: z };
  }
  for (var ring = 0; ring < 8; ring++) {
    rr = maxR * (ring + 0.5) / 8;
    var n = 16 + ring * 8, phase = (ring & 1) * Math.PI / n;
    for (var k = 0; k < n; k++) {
      a = phase + k * Math.PI * 2 / n;
      x = cx + Math.sin(a) * rr; z = cz + Math.cos(a) * rr;
      if (_powerupCanPlace(x, z, 10)) return { x: x, z: z };
    }
  }
  return null;
}
function powerupSpawnForZone(zone) {
  if (!powerupsFfaEnabled() || !zone) return [];
  var rev = zone._powerupGeneration != null && zone._powerupGeneration >= 0
    ? zone._powerupGeneration : (zone.revision != null ? zone.revision : (++_powerupSpawnSerial));
  if (rev === _powerupLastZoneRevision) return [];
  _powerupLastZoneRevision = rev;
  var cx = zone.cx || 0, cz = zone.cz || 0, radius = zone.radius != null ? zone.radius : (zone.r || 0);
  if (!(radius > 0)) return [];
  var aliveN = (typeof aliveList !== 'undefined' && aliveList) ? aliveList.length : 0;
  /* Custom FFA uses the saved slider; TO BATTLE deliberately keeps its historical
     two-pickups-per-survivor preset.  A missing/invalid custom value falls back to
     the compatibility rule rather than producing NaN, a negative count, or a wave
     with an accidental minimum. */
  var quick = typeof ffaQuickStart !== 'undefined' && !!ffaQuickStart;
  var cfg = quick
    ? (typeof FFA_QUICK_DEFAULTS !== 'undefined' ? FFA_QUICK_DEFAULTS : null)
    : (typeof FFA_SETUP !== 'undefined' ? FFA_SETUP : null);
  var fallbackMultiplier = quick ? 2 : 2;
  var multiplier = cfg && isFinite(+cfg.powerupMultiplier) ? +cfg.powerupMultiplier : fallbackMultiplier;
  multiplier = Math.max(0, Math.min(4, multiplier));
  var count = aliveN > 0 ? Math.max(0, Math.round(aliveN * multiplier)) : 0;
  var made = [];
  for (var i = 0; i < count; i++) {
    var pt = _powerupTryZonePoint(cx, cz, radius);
    /* A saturated zone gets fewer items rather than an item inside a solid.  There is
       intentionally no unchecked geometric fallback: every returned point has gone
       through the same terrain/world validity path. */
    if (!pt) break;
    /* Zone pickups persist until physical contraction starts; the common shrink hook
       then replaces this open-ended expiry with the ten-second blink expiry. */
    made.push(_powerupNewItem(_powerupRandomKind(), pt.x, pt.z, 'zone', Infinity, Infinity));
  }
  return made;
}
function powerupBeginZoneShrink(now) {
  if (!powerupsFfaEnabled()) return;
  now = now == null ? powerupNow() : now;
  /* This is the same shared blink schedule used by kill drops. */
  for (var i = powerupItems.length - 1; i >= 0; i--) {
    var item = powerupItems[i];
    if (!item || item.source !== 'zone') continue;
    if (item.expiresAt > now) {
      item.blinkAt = now;
      item.expiresAt = now + 10;
    }
  }
}
function _powerupFindKillPoint(t) {
  if (!t || !t.group || !t.group.position) return null;
  var p = t.group.position, rr, a, x, z;
  /* Prefer a point beside the new wreck, but progressively widen the search when
     the kill happened beside a wall, obstacle, or crowded wreck cluster. */
  for (var tries = 0; tries < 28; tries++) {
    rr = 3.5 + Math.random() * 5.5;
    a = Math.random() * Math.PI * 2;
    x = p.x + Math.sin(a) * rr; z = p.z + Math.cos(a) * rr;
    if (_powerupCanPlace(x, z, 2.5, t)) return { x: x, z: z };
  }
  for (var ring = 0; ring < 7; ring++) {
    rr = 3.5 + ring * 1.5;
    var n = 20 + ring * 4;
    for (var k = 0; k < n; k++) {
      a = k * Math.PI * 2 / n + (ring & 1) * Math.PI / n;
      x = p.x + Math.sin(a) * rr; z = p.z + Math.cos(a) * rr;
      if (_powerupCanPlace(x, z, 2.5, t)) return { x: x, z: z };
    }
  }
  return null;
}
function powerupDropAtKill(t) {
  if (!powerupsFfaEnabled() || !t || !t.group || !t.group.position) return null;
  var pt = _powerupFindKillPoint(t);
  /* Never materialize a kill drop at the unvalidated death position. */
  if (!pt) return null;
  return _powerupNewItem(_powerupRandomKind(), pt.x, pt.z, 'kill', POWERUP_DURATION_SEC, powerupNow() + 20);
}

function _powerupRepairOne(t) {
  if (!t) return null;
  var best = null, bestFrac = Infinity;
  /* Deterministic severity ordering: the lowest current HP/max fraction wins;
     the key order is only a stable tie-breaker, never a random selection. */
  var keys = ['gun', 'turret', 'engine', 'fuel', 'ammo', 'trackL', 'trackR', 'tailRotor'];
  if (t.mods) for (var k = 0; k < keys.length; k++) {
    var key = keys[k], mod = t.mods[key];
    if (!mod || mod.structural || !(mod.max > 0) || !(mod.hp < mod.max - 1e-6)) continue;
    var frac = mod.hp / mod.max;
    if (frac < bestFrac) { bestFrac = frac; best = key; }
  }

  /* Emergency repair is recovery, never an over-cap structure increase.  It also
     repairs the hull-only damage case, where no non-structural module is damaged. */
  var oldStruct = isFinite(+t.struct) ? +t.struct : 0;
  var maxStruct = isFinite(+t.structMax) && +t.structMax > 0 ? +t.structMax : Math.max(0, oldStruct);
  var restoredStruct = Math.min(maxStruct, Math.max(0, oldStruct) + POWERUP_REPAIR_STRUCT_POINTS);
  t.struct = restoredStruct;
  if (best) t.mods[best].hp = t.mods[best].max;
  if (typeof effSync === 'function') effSync(t);

  /* playerHudDamage reads the live module/structure values. Refresh both the
     selected module and the hull's structure-linked red level in the same tick. */
  if (typeof player !== 'undefined' && t === player && typeof playerHudDamage === 'function') {
    if (best) playerHudDamage(best);
    playerHudDamage('hull');
  }
  return best || (restoredStruct !== oldStruct ? 'hull' : null);
}
function _powerupExpireStates(t, now) {
  if (!t || !t._powerups) return;
  for (var k in t._powerups) {
    var s = t._powerups[k];
    if (!s) continue;
    if (s.repairDue != null && !s.repairDone && now >= s.repairDue) {
      s.repairDone = true;
      s.repairedKey = _powerupRepairOne(t);
    }
    if (s.expiresAt <= now) delete t._powerups[k];
  }
}
function powerupPickup(t, item) {
  if (!powerupsFfaEnabled() || !t || !t.alive || !item || item._removed || item.expiresAt <= powerupNow()) return false;
  var now = powerupNow(), map = powerupStateMap(t), old = map[item.kind];
  var s = old || { kind: item.kind, duration: POWERUP_DURATION_SEC };
  s.kind = item.kind;
  s.startedAt = now;
  s.expiresAt = now + POWERUP_DURATION_SEC;
  if (item.kind === 'emergencyRepair') {
    s.repairDue = now + POWERUP_REPAIR_DELAY_SEC;
    s.repairDone = false;
    s.repairedKey = null;
  } else {
    s.repairDue = null;
    s.repairDone = true;
    s.repairedKey = null;
  }
  map[item.kind] = s;
  _powerupRemoveItem(item);
  t._powerupHudDirty = true;
  t._powerupAuraDirty = true;
  return true;
}
function powerupPickupNearby() {
  if (!powerupsFfaEnabled() || !powerupItems.length) return;
  var now = powerupNow();
  for (var i = powerupItems.length - 1; i >= 0; i--) {
    var item = powerupItems[i];
    if (!item) continue;
    if (item.expiresAt <= now) { _powerupRemoveItem(item); continue; }
    var picked = false;
    /* Player gets the same physical pickup rule as AI and is checked first. */
    if (typeof player !== 'undefined' && player && player.alive && player.group && player.group.position) {
      var pp = player.group.position, pdx = pp.x - item.x, pdz = pp.z - item.z;
      var pdy = (pp.y - _powerupTerrainY(item.x, item.z));
      if (pdx * pdx + pdz * pdz <= POWERUP_PICKUP_RADIUS * POWERUP_PICKUP_RADIUS && Math.abs(pdy) < 8) picked = powerupPickup(player, item);
    }
    if (picked) continue;
    if (typeof aliveList === 'undefined' || !aliveList) continue;
    for (var j = 0; j < aliveList.length; j++) {
      var t = aliveList[j];
      if (!t || !t.alive || t.isPlayer || !t.group || !t.group.position) continue;
      var tp = t.group.position, dx = tp.x - item.x, dz = tp.z - item.z;
      var dy = tp.y - _powerupTerrainY(item.x, item.z);
      var collectR = (typeof isHeliVehicle === 'function' && isHeliVehicle(t)) ? 7.0 : POWERUP_PICKUP_RADIUS;
      var heliPickup = typeof isHeliVehicle === 'function' && isHeliVehicle(t);
      if (dx * dx + dz * dz <= collectR * collectR && Math.abs(dy) < (heliPickup ? 10 : 5)) {
        if (powerupPickup(t, item)) break;
      }
    }
  }
}

function powerupNearestForAI(t, now, dt) {
  if (!powerupsFfaEnabled() || !t || !t.alive || !t.group || !t.group.position) return null;
  var A = t.ai || (t.ai = {});
  now = now == null ? powerupNow() : now;
  A._powerupScanT = (A._powerupScanT == null ? 0 : A._powerupScanT - (dt == null ? 0.05 : Math.max(0, dt)));
  if (A._powerupScanT > 0 && A._powerupTarget && A._powerupTarget.expiresAt > now && !A._powerupTarget._removed) return A._powerupTarget;
  A._powerupScanT = 0.35;
  var p = t.group.position, best = null, bestD2 = 200 * 200;
  for (var i = 0; i < powerupItems.length; i++) {
    var item = powerupItems[i];
    if (!item || item._removed || item.expiresAt <= now) continue;
    var dx = item.x - p.x, dz = item.z - p.z, d2 = dx * dx + dz * dz;
    if (d2 <= bestD2) { bestD2 = d2; best = item; }
  }
  A._powerupTarget = best;
  return best;
}
function powerupAIPlan(t, dt) {
  return powerupNearestForAI(t, powerupNow(), dt);
}
function powerupAIDrive(t, dt) {
  if (!powerupsFfaEnabled() || !t || !t.ai || !t.alive || (typeof isHeliVehicle === 'function' && isHeliVehicle(t))) return false;
  var A = t.ai, item = powerupNearestForAI(t, powerupNow(), dt);
  if (!item || A._ffaZoneUrgent) {
    A._powerupDrive = false;
    return false;
  }
  var p = t.group.position, dx = item.x - p.x, dz = item.z - p.z;
  var dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > 215) {
    A._powerupTarget = null;
    A._powerupDrive = false;
    return false;
  }
  /* Pickup routing is only a movement destination.  Do not set a special AI mode,
     do not rotate/drive/applyMotion here, and do not return control to the caller:
     the normal target scan, turret servo, fire gate, and evade logic must run in the
     same frame.  The generic ground executor below will steer to this destination;
     powerupPickupNearby() still performs the physical pickup at the normal radius. */
  A._powerupDrive = true;
  A._powerupRouteX = item.x;
  A._powerupRouteZ = item.z;
  A.destX = item.x;
  A.destZ = item.z;
  A.destT = Math.max(A.destT || 0, 0.35);
  return true;
}
/* No-target fallback used by aiUpdate only after its normal threat scan found no
   opponent. It keeps the item route alive without inventing a combat mode; as soon
   as a target is acquired, the normal combat executor takes over again. When an
   incoming round is active, the same executor is temporarily redirected to the
   evade point, so an empty target list cannot make pickup routing suppress escape. */
function powerupAIIdleDrive(t, dt) {
  if (!t || !t.ai || !t.alive || t.ai._ffaZoneUrgent) return false;
  var A = t.ai, evading = A.evadeT > 0, item = A._powerupTarget;
  if (!evading && (!A._powerupDrive || !item || item._removed || item.expiresAt <= powerupNow())) {
    A._powerupDrive = false;
    return false;
  }
  var p = t.group.position;
  var tx = evading ? A.evadeX : item.x, tz = evading ? A.evadeZ : item.z;
  var dx = tx - p.x, dz = tz - p.z;
  var dist = Math.sqrt(dx * dx + dz * dz);
  if (!evading && dist > 215) { A._powerupDrive = false; return false; }
  if (evading) A.mode = 'flee';
  A.destX = tx; A.destZ = tz; A.destT = Math.max(A.destT || 0, 0.35);
  if (dist < 6) {
    t._throttle = 0; t._throttleLock = 0; t._turnCmd = 0;
    if (typeof SIM_K === 'undefined' || SIM_K <= 0) t.speed = approachSpeed(t.speed, 0, t.accel0, t.decel0, dt);
    applyMotion(t, dt);
    return true;
  }
  var sx = dx, sz = dz;
  if (typeof navSteer === 'function' && dist >= 8) {
    var nw = navSteer(t, tx, tz, p);
    if (nw) { sx = nw.x - p.x; sz = nw.z - p.z; }
  }
  var drv = typeof steerCached === 'function' ? steerCached(t, sx, sz) : { x: sx, z: sz };
  var wantYaw = Math.atan2(drv.x, drv.z), dYaw = normAng(wantYaw - t.yaw);
  var tm = (typeof turnMult === 'function' ? turnMult(t) : 1) * (typeof slopeTurnMul === 'function' ? slopeTurnMul(t) : 1);
  var yawStep = clamp(dYaw, -t.turn0 * tm * dt, t.turn0 * tm * dt);
  t.yaw += yawStep; t._turnCmd = dt > 0 ? yawStep / dt : 0;
  var throttle = Math.abs(dYaw) < 1.45 ? Math.max(0.35, Math.min(1, 1 - Math.abs(dYaw) / 1.8)) : (dYaw > 0 ? -0.35 : 0.35);
  t._throttle = evading ? Math.max(0.6, throttle) : throttle;
  t._throttleLock = 0;
  if (typeof SIM_K === 'undefined' || SIM_K <= 0) {
    var sm = typeof speedMult === 'function' ? speedMult(t) : 1;
    var puEng = typeof engineEff === 'function' ? engineEff(t) : 1;
    t.speed = approachSpeed(t.speed, t._throttle * t.speed0 * sm, t.accel0 * puEng, t.decel0 * Math.max(puEng, 0.3), dt);
  }
  applyMotion(t, dt);
  return true;
}

function _powerupActiveKeys(t, now) {
  var out = [];
  if (!t || !t._powerups) return out;
  for (var i = 0; i < POWERUP_KIND_ORDER.length; i++) {
    var k = POWERUP_KIND_ORDER[i];
    if (powerupActive(t, k, now)) out.push(k);
  }
  return out;
}
function powerupClearAura(t) {
  if (!t || !t._powerupAura) return;
  if (t._powerupAura.parent) t._powerupAura.parent.remove(t._powerupAura);
  t._powerupAura.traverse(function (o) {
    if (!o || !o.material) return;
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    for (var i = 0; i < mats.length; i++) if (mats[i] && mats[i].dispose) mats[i].dispose();
  });
  t._powerupAura = null; t._powerupAuraSig = '';
}
function _powerupBuildAura(t, keys) {
  if (typeof THREE === 'undefined' || !t || !t.group) return;
  var sig = keys.join('|');
  if (!keys.length) { powerupClearAura(t); return; }
  if (t._powerupAura && t._powerupAuraSig === sig) return;
  powerupClearAura(t);
  var aura = new THREE.Group();
  aura.name = 'POWERUP_AURA';
  aura.position.y = 1.25;
  aura.userData = { powerupAura: true };
  for (var i = 0; i < keys.length; i++) {
    var def = powerupDef(keys[i]), orbit = new THREE.Group();
    orbit.rotation.y = (i / Math.max(1, keys.length)) * Math.PI * 2;
    orbit.userData = { powerupAuraOrbit: true, spin: 0.9 + i * 0.12 };
    /* The aura is a world-space vehicle effect, not a HUD overlay: terrain and vehicle depth must occlude it. */
    var mat = _powerupHoloMaterial(def, 0.42, false);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(2.35 + i * 0.32, 0.055, 6, 28), mat);
    ring.rotation.x = Math.PI / 2;
    ring.renderOrder = 71;
    orbit.add(ring);
    var badge = new THREE.Mesh(new THREE.OctahedronGeometry(0.22 + i * 0.015, 0), mat);
    badge.position.set(2.35 + i * 0.32, 0, 0);
    badge.renderOrder = 72;
    orbit.add(badge);
    aura.add(orbit);
  }
  t.group.add(aura);
  t._powerupAura = aura; t._powerupAuraSig = sig;
}
function _powerupAuraTick(t, dt, now) {
  if (!t) return;
  if (!powerupsFfaEnabled() || !t.alive) { powerupClearAura(t); return; }
  var keys = _powerupActiveKeys(t, now);
  _powerupBuildAura(t, keys);
  if (!t._powerupAura) return;
  for (var i = 0; i < t._powerupAura.children.length; i++) {
    var orbit = t._powerupAura.children[i];
    orbit.rotation.y += dt * (orbit.userData && orbit.userData.spin ? orbit.userData.spin : 1);
  }
  /* Screen-space culling is throttled per vehicle; off-screen AI keeps the state but not the effect. */
  if (t._powerupAuraCullT == null || now - t._powerupAuraCullT > 0.10) {
    t._powerupAuraCullT = now;
    var onScreen = true;
    if (typeof camera !== 'undefined' && camera && _powerupScreenPoint && t.group && t.group.position) {
      _powerupScreenPoint.set(t.group.position.x, t.group.position.y + 1.5, t.group.position.z).project(camera);
      onScreen = _powerupScreenPoint.z >= -1 && _powerupScreenPoint.z <= 1 && Math.abs(_powerupScreenPoint.x) <= 1.12 && Math.abs(_powerupScreenPoint.y) <= 1.12;
    }
    t._powerupAura.visible = onScreen;
  }
}

function _powerupHudEnsure() {
  if (typeof document === 'undefined') return null;
  if (_powerupHudRoot && _powerupHudRoot.parentNode) return _powerupHudRoot;
  _powerupHudRoot = document.getElementById('powerup-hud');
  if (!_powerupHudRoot) return null;
  return _powerupHudRoot;
}
function _powerupHudBuild(keys) {
  var root = _powerupHudEnsure();
  if (!root) return;
  while (root.firstChild) root.removeChild(root.firstChild);
  _powerupHudNodes = Object.create(null);
  for (var i = 0; i < keys.length; i++) {
    var kind = keys[i], def = powerupDef(kind), slot = document.createElement('div');
    slot.className = 'powerup-slot powerup-' + kind;
    slot.setAttribute('data-kind', kind);
    var icon = document.createElement('div'); icon.className = 'powerup-slot-icon';
    icon.style.setProperty('--pu-color', def.color);
    var glyph = document.createElement('span'); glyph.className = 'powerup-slot-glyph'; glyph.textContent = def.glyph;
    icon.appendChild(glyph);
    var label = document.createElement('div'); label.className = 'powerup-slot-label'; label.textContent = def.label;
    var time = document.createElement('div'); time.className = 'powerup-slot-time';
    var note = document.createElement('div'); note.className = 'powerup-slot-note';
    slot.appendChild(icon); slot.appendChild(label); slot.appendChild(time); slot.appendChild(note);
    root.appendChild(slot);
    _powerupHudNodes[kind] = { slot: slot, icon: icon, time: time, note: note, color: def.color };
  }
  _powerupHudSignature = keys.join('|');
}
function powerupHUDUpdate(now) {
  var root = _powerupHudEnsure();
  if (!root) return;
  if (!powerupsFfaEnabled() || typeof player === 'undefined' || !player || !player.alive) {
    root.classList.add('hidden');
    return;
  }
  var keys = _powerupActiveKeys(player, now == null ? powerupNow() : now);
  if (!keys.length) { root.classList.add('hidden'); return; }
  if (_powerupHudSignature !== keys.join('|')) _powerupHudBuild(keys);
  root.classList.remove('hidden');
  var n = now == null ? powerupNow() : now;
  for (var i = 0; i < keys.length; i++) {
    var kind = keys[i], s = powerupState(player, kind), node = _powerupHudNodes[kind];
    if (!s || !node) continue;
    var remain = Math.max(0, s.expiresAt - n), frac = Math.max(0, Math.min(1, remain / POWERUP_DURATION_SEC));
    node.icon.style.background = 'conic-gradient(' + node.color + ' ' + (frac * 360).toFixed(1) + 'deg, rgba(20,25,20,.92) 0deg)';
    node.icon.style.setProperty('--pu-progress', frac.toFixed(4));
    node.time.textContent = remain.toFixed(1) + 's';
    if (kind === 'emergencyRepair' && !s.repairDone) node.note.textContent = 'REPAIR IN ' + Math.max(0, s.repairDue - n).toFixed(1) + 's';
    else if (kind === 'emergencyRepair' && s.repairedKey) node.note.textContent = 'RESTORED ' + String(s.repairedKey).toUpperCase();
    else node.note.textContent = powerupDef(kind).description;
  }
}

function powerupDrawMinimap(ctx, rect, now) {
  if (!ctx || !rect || !powerupsFfaEnabled()) return;
  now = now == null ? powerupNow() : now;
  ctx.save();
  ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
  for (var i = 0; i < powerupItems.length; i++) {
    var item = powerupItems[i], alpha = powerupItemAlpha(item, now);
    if (!item || alpha <= 0) continue;
    var p = { x: 0, y: 0 };
    if (typeof _mmWorldToPx === 'function') _mmWorldToPx(item.x, item.z, rect, p);
    else { p.x = rect.x + rect.w * 0.5; p.y = rect.y + rect.h * 0.5; }
    var def = powerupDef(item.kind), r = 6.5;
    ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#111611'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, r + 1.5, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = def.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#121713'; ctx.fillRect(-5, -5, 10, 10);
    ctx.strokeStyle = def.color; ctx.lineWidth = 1.2;
    if (item.kind === 'emergencyRepair') {
      ctx.beginPath(); ctx.moveTo(-3.5, 0); ctx.lineTo(3.5, 0); ctx.moveTo(0, -3.5); ctx.lineTo(0, 3.5); ctx.stroke();
    } else if (item.kind === 'rocketBoost') {
      ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(3, 2); ctx.lineTo(0, 1); ctx.lineTo(-3, 2); ctx.closePath(); ctx.stroke();
    } else {
      ctx.fillStyle = def.color; ctx.font = 'bold ' + (item.kind === 'superArmor' ? '5px' : '6px') + ' monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(def.glyph, 0, 0.5);
    }
    ctx.restore();
  }
  ctx.restore();
}

function powerupReset() {
  for (var i = powerupItems.length - 1; i >= 0; i--) _powerupRemoveItem(powerupItems[i]);
  powerupItems.length = 0;
  _powerupLastZoneRevision = -1;
  _powerupSpawnSerial = 0;
  _powerupPickupT = -99;
  _powerupHudTickT = -99;
  _powerupAuraScratchTick = -99;
  _powerupHudSignature = '';
  _powerupHudNodes = Object.create(null);
  var root = _powerupHudEnsure();
  if (root) { root.classList.add('hidden'); while (root.firstChild) root.removeChild(root.firstChild); }
  if (typeof tanks !== 'undefined' && tanks) {
    for (var j = 0; j < tanks.length; j++) {
      var t = tanks[j];
      if (t) { t._powerups = null; powerupClearAura(t); }
    }
  }
}

function powerupTick(dt) {
  var now = powerupNow();
  if (!powerupsFfaEnabled()) {
    if (_powerupHudRoot) _powerupHudRoot.classList.add('hidden');
    if (typeof tanks !== 'undefined' && tanks) for (var ti = 0; ti < tanks.length; ti++) if (tanks[ti]) powerupClearAura(tanks[ti]);
    return;
  }
  for (var i = powerupItems.length - 1; i >= 0; i--) {
    var item = powerupItems[i];
    if (!item || item.expiresAt <= now) { _powerupRemoveItem(item); continue; }
    if (item.group) {
      item.group.position.y = _powerupMarkerY(item, now);
      /* Keep the projection vertical and face it toward the viewer like a tactical HUD card. */
      if (typeof camera !== 'undefined' && camera && item.group.userData && item.group.userData.powerupBillboard) {
        item.group.rotation.set(0, Math.atan2(camera.position.x - item.x, camera.position.z - item.z), 0);
      }
      var spinNodes = item.group.userData && item.group.userData.powerupSpinNodes;
      if (spinNodes) for (var sn = 0; sn < spinNodes.length; sn++) {
        var spinNode = spinNodes[sn];
        spinNode.rotation.z += dt * (spinNode.userData && spinNode.userData.powerupSpinSpeed ? spinNode.userData.powerupSpinSpeed : 1);
      }
      _powerupSetMaterialAlpha(item.group, powerupItemAlpha(item, now));
      item.group.visible = powerupItemAlpha(item, now) > 0;
    }
  }
  if (now - _powerupPickupT >= 0.08) {
    _powerupPickupT = now;
    powerupPickupNearby();
  }
  if (typeof aliveList !== 'undefined' && aliveList) {
    for (var j = 0; j < aliveList.length; j++) {
      var t = aliveList[j];
      if (!t) continue;
      _powerupExpireStates(t, now);
      _powerupAuraTick(t, dt, now);
    }
  }
  /* Remove aura/state from dead vehicles without adding a full dead-list hot loop. */
  if (typeof tanks !== 'undefined' && tanks && now - _powerupAuraScratchTick > 0.5) {
    _powerupAuraScratchTick = now;
    for (var d = 0; d < tanks.length; d++) if (tanks[d] && !tanks[d].alive) powerupClearAura(tanks[d]);
  }
  if (now - _powerupHudTickT >= 0.08) {
    _powerupHudTickT = now;
    powerupHUDUpdate(now);
  }
}
var _powerupAuraScratchTick = -99;

/* Public test/debug hooks; they do not change normal gameplay semantics. */
if (typeof window !== 'undefined') {
  window.Powerups = {
    defs: POWERUP_DEFS,
    items: powerupItems,
    pickup: powerupPickup,
    spawnForZone: powerupSpawnForZone,
    dropAtKill: powerupDropAtKill,
    beginZoneShrink: powerupBeginZoneShrink,
    itemIsBlinking: powerupItemIsBlinking,
    itemAlpha: powerupItemAlpha,
    active: powerupActive,
    penBonus: powerupPenetrationBonus,
    armorBonus: powerupArmorBonus,
    reloadRate: powerupReloadRate,
    speedBonusMps: powerupSpeedBonusMps,
    reset: powerupReset
  };
}
