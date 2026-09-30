/* ===== Module: vehicle-tech.js ===== */
/*
   玩家载具科技树。
   这份模块只保存「解锁」与「安装」状态；实际效果在载具创建/接管、观瞄、火控、弹道、装填、激光和地面物理的消费点重新应用。
   所有实际效果入口都用 isPlayer + team|kind 双重门，AI 载具不会读取玩家科技效果。
*/
(function (window) {
  'use strict';

  var STORAGE_KEY = 'armoredCorps.vehicleTech.v2';
  var LEGACY_STORAGE_KEY = 'armoredCorps.vehicleTech.v1';
  var TECH_EXP_UNLOCK_COST = 25;
  var TREE = {
    'red|tank': {
      key: 'red|tank', team: 'red', kind: 'tank', title: 'RED-MBT-1', subtitle: 'RED-MEDIUM TANK',
      nodes: [
        { id: 'fcs', label: 'FIRE CONTROL COMPUTER', short: 'FCS COMPUTER', effect: 'Computer fire control: 0.5s solution hold instead of manual table.' },
        { id: 'aux-loader', label: 'AUXILIARY LOADER', short: 'AUX LOADER', effect: 'Player reload time −0.5s.' },
        { id: 'non-skid-track', label: 'NON-SKID TRACK', short: 'NON-SKID TRACK', effect: 'Player ground rolling resistance coefficients ×0.70.' },
        { id: 'improved-105', label: 'IMPROVED 105MM GUN', short: 'IMPROVED 105MM', effect: 'Initial penetration 70% of RED-MBT-2 (currently 763mm), muzzle velocity 1600m/s, dispersion radius 2× RED-MBT-2.' },
        { id: 'improved-engine', label: 'IMPROVED ENGINE', short: 'IMPROVED ENGINE', effect: 'Player maximum speed +10 km/h.' },
        { id: 'improved-motor', label: 'IMPROVED TURRET MOTOR', short: 'TURRET MOTOR', effect: 'Player turret rotation speed set to 20 deg/s.' },
        { id: 'improved-optics', label: 'IMPROVED OPTICS', short: 'THERMAL OPTICS', effect: 'Unlocks the player RED-MBT-1 thermal imaging function.' },
        { id: 'gun-launched-missile', label: 'GUN-LAUNCHED MISSILE', short: 'GUN-LAUNCHED MISSILE', effect: 'Player-only EO/IR gun-launched missile: 60 damage, 500mm penetration, seeker-only guidance. Keys 1 and 2 select the next loading cycle; a round already loaded keeps its weapon.' }
      ]
    },
    'blue|tank': {
      key: 'blue|tank', team: 'blue', kind: 'tank', title: 'BLUE-MBT-1', subtitle: 'BLUE-MEDIUM TANK',
      nodes: [
        { id: 'fcs', label: 'FIRE CONTROL COMPUTER', short: 'FCS COMPUTER', effect: 'Computer fire control: 0.5s solution hold instead of manual table.' },
        { id: 'non-skid-track', label: 'NON-SKID TRACK', short: 'NON-SKID TRACK', effect: 'Player ground rolling resistance coefficients ×0.70.' },
        { id: 'improved-105', label: 'IMPROVED 105MM GUN', short: 'IMPROVED 105MM', effect: 'Initial penetration is 70% of BLUE-MBT-2 (359.8mm); because that is below the 446mm base, it is raised to 447mm. Muzzle velocity 1600m/s.' },
        { id: 'improved-ap', label: 'IMPROVED AP ROUND', short: 'IMPROVED AP', effect: 'Player BLUE-MBT-1 only: add 100mm to the initial penetration of AP rounds.' },
        { id: 'improved-engine', label: 'IMPROVED ENGINE', short: 'IMPROVED ENGINE', effect: 'Player maximum speed +10 km/h.' },
        { id: 'improved-motor', label: 'IMPROVED TURRET MOTOR', short: 'TURRET MOTOR', effect: 'Player turret rotation speed set to 20 deg/s.' },
        { id: 'improved-optics', label: 'IMPROVED OPTICS', short: 'THERMAL OPTICS', effect: 'Unlocks the player BLUE-MBT-1 thermal imaging function.' },
        { id: 'battlefield-repair', label: 'BATTLEFIELD REPAIR', short: 'BATTLE REPAIR', effect: 'After taking damage, stop for 5s to prepare repairs, then restore one damaged module at 5 HP/s. Lowest relative HP first; each module is capped at 50% of maximum HP. Moving or taking new damage resets the repair condition.' }
      ]
    },
    'blue|td': {
      key: 'blue|td', team: 'blue', kind: 'td', title: 'BLUE-MBT-2', subtitle: 'BLUE HEAVY MBT',
      nodes: [
        { id: 'depleted-uranium-armor', label: 'DEPLETED URANIUM ARMOR', short: 'DU ARMOR', effect: 'Player BLUE-MBT-2 only: add 100mm to the real equivalent armor of the upper and lower frontal hull. Turret, sides, rear, and AI BLUE-MBT-2 are unchanged.' },
        { id: 'burst-loading', label: 'BURST LOADING', short: 'BURST LOADING', effect: 'Player BLUE-MBT-2 only: permanent super reload (reload speed ×2). After each shot, fatigue can disable the effect for a random 10–20s; chance = (1 - turretHpPercent / 2) / 2, where turretHpPercent = current turret HP / turret max HP (0.25 full, 0.375 at 50%, 0.5 at 0%). Fatigue restores normal reload speed.' },
        { id: 'depleted-uranium-round', label: 'DEPLETED URANIUM ROUND', short: 'DU ROUND', effect: 'Player BLUE-MBT-2 only: add 100mm to the initial penetration of every AP round. This is ammunition penetration, not armor.' },
      ]
    },
    'red|td': {
      key: 'red|td', team: 'red', kind: 'td', title: 'RED-TD', subtitle: 'RED TANK DESTROYER',
      nodes: [
        { id: 'improved-optics', label: 'IMPROVED OPTICS', short: 'THERMAL OPTICS', effect: 'Unlocks the player RED-TD thermal imaging function.' },
        { id: 'high-explosive', label: 'HIGH-EXPLOSIVE ROUND', short: 'HIGH-EXPLOSIVE', effect: 'Adds weapon 2: 180 damage, rocket-code blast radius, 1400m/s muzzle velocity, and fixed 500mm penetration. Weapon 1 remains AP.' }
      ]
    },
    'red|99': {
      key: 'red|99', team: 'red', kind: '99', title: 'RED-MBT-2', subtitle: 'RED HEAVY MBT',
      nodes: [
        { id: 'improved-cooling', label: 'IMPROVED COOLING SYSTEM', short: 'LASER COOLING', effect: 'Halves the player laser suppression cooldown from 30s to 15s.' },
        { id: 'improved-power-pack', label: 'IMPROVED POWER PACK', short: 'POWER PACK', effect: 'Player maximum speed +10 km/h.' },
        { id: 'high-power-laser', label: 'HIGH-POWER LASER', short: 'HIGH-POWER LASER', effect: 'Reduces player laser emission to 2s; a vehicle hit by the beam cannot aim while it remains illuminated.' }
      ]
    },
    'red|wz10': {
      key: 'red|wz10', team: 'red', kind: 'wz10', title: 'RED-HELI', subtitle: 'RED ATTACK HELICOPTER',
      nodes: [
        { id: 'heavy-rocket-warhead', label: 'HEAVY ROCKET WARHEAD', short: 'ROCKET WARHEAD', effect: 'Player RED-HELI rocket damage increases from 40 to 60.' },
        { id: 'airburst-round', label: 'AIRBURST ROUND', short: 'AIRBURST', effect: 'Player RED-HELI guided rockets detonate 0.5m before a tracked enemy instead of waiting for a direct contact.' }
      ]
    },
    'blue|ah64': {
      key: 'blue|ah64', team: 'blue', kind: 'ah64', title: 'BLUE-HELI', subtitle: 'BLUE ATTACK HELICOPTER',
      nodes: [
        { id: 'heavy-rocket-warhead', label: 'HEAVY ROCKET WARHEAD', short: 'HEAVY WARHEAD', effect: 'Player BLUE-HELI rocket damage increases to 120 per rocket.' },
        { id: 'auto-cannon', label: 'AUTOMATIC CANNON', short: 'AUTO CANNON', effect: 'Automatically aims at and fires the cannon at the nearest unobscured enemy within 1000m.' },
        { id: 'depleted-uranium-round', label: 'DEPLETED URANIUM ROUND', short: 'DU ROUND', effect: 'Player BLUE-HELI cannon initial penetration increases by 50mm, from 35mm to 85mm.' }
      ]
    },
    'red|arty': {
      key: 'red|arty', team: 'red', kind: 'arty', title: 'RED-MLRS', subtitle: 'RED MULTIPLE LAUNCH ROCKET SYSTEM',
      nodes: [
        { id: 'improved-optics', label: 'IMPROVED OPTICS', short: 'THERMAL OPTICS', effect: 'Unlocks the player RED-MLRS thermal imaging function.' },
        { id: 'guided-warhead', label: 'GUIDED WARHEAD', short: 'GUIDED WARHEAD', effect: 'During the descending segment, player RED-MLRS rockets can home on hostile vehicles inside the fire-coverage circle; they retarget within the circle and otherwise keep normal bombardment.' }
      ]
    },
    'blue|arty': {
      key: 'blue|arty', team: 'blue', kind: 'arty', title: 'BLUE-MLRS', subtitle: 'BLUE MULTIPLE LAUNCH ROCKET SYSTEM',
      nodes: [
        { id: 'improved-optics', label: 'IMPROVED OPTICS', short: 'THERMAL OPTICS', effect: 'Unlocks the player BLUE-MLRS thermal imaging function.' },
        { id: 'guided-warhead', label: 'GUIDED WARHEAD', short: 'GUIDED WARHEAD', effect: 'During the descending segment, player BLUE-MLRS rockets can home on hostile vehicles inside the fire-coverage circle; they retarget within the circle and otherwise keep normal bombardment.' }
      ]
    },
    'red|aa': {
      key: 'red|aa', team: 'red', kind: 'aa', title: 'RED-AA', subtitle: 'RED AIR DEFENSE',
      nodes: [
        { id: 'improved-optics', label: 'IMPROVED OPTICS', short: 'THERMAL OPTICS', effect: 'Unlocks the player RED-AA thermal imaging function in the gun sight and normal view.' },
        { id: 'anti-tank-missile', label: 'ANTI-TANK MISSILE', short: 'ATGM 5KM', effect: 'Player-only selectable SAM / ATGM loadout: 180 damage, 800mm penetration, low-drag EO/IR ground guidance, effective range about 5km. AI RED-AA keeps the default SAM.' }
      ]
    },
    'blue|aa': {
      key: 'blue|aa', team: 'blue', kind: 'aa', title: 'BLUE-AA', subtitle: 'BLUE AIR DEFENSE',
      nodes: [
        { id: 'improved-optics', label: 'IMPROVED OPTICS', short: 'THERMAL OPTICS', effect: 'Unlocks the player BLUE-AA thermal imaging function in the gun sight and normal view.' },
        { id: 'anti-tank-missile', label: 'ANTI-TANK MISSILE', short: 'ATGM 5KM', effect: 'Player-only selectable SAM / ATGM loadout matching RED-AA: 180 damage, 800mm penetration, low-drag EO/IR ground guidance, effective range about 5km. AI BLUE-AA keeps the default SAM.' }
      ]
    }
  };
  var state = null;

  function blankState() {
    return { version: 2, experience: 0, unlocked: {}, installed: {}, updatedAt: 0 };
  }

  function supportedKey(team, kind) {
    var key = String(team || '').toLowerCase() + '|' + String(kind || '').toLowerCase();
    return TREE[key] ? key : null;
  }

  function makeFlags(key, value) {
    var out = {}, nodes = TREE[key] ? TREE[key].nodes : [];
    for (var i = 0; i < nodes.length; i++) out[nodes[i].id] = value === true;
    return out;
  }

  function copyBooleans(raw, fallback) {
    var out = {}, k;
    for (k in fallback) if (Object.prototype.hasOwnProperty.call(fallback, k)) out[k] = false;
    if (!raw || typeof raw !== 'object') return out;
    for (k in out) if (Object.prototype.hasOwnProperty.call(raw, k)) out[k] = raw[k] === true;
    return out;
  }

  function normalize(raw) {
    var out = blankState(), key;
    raw = raw && typeof raw === 'object' ? raw : {};
    for (key in TREE) {
      if (!Object.prototype.hasOwnProperty.call(TREE, key)) continue;
      var defaults = makeFlags(key, false);
      out.unlocked[key] = copyBooleans(raw.unlocked && raw.unlocked[key], defaults);
      out.installed[key] = copyBooleans(raw.installed && raw.installed[key], defaults);
      for (var ni = 0; ni < TREE[key].nodes.length; ni++) {
        var id = TREE[key].nodes[ni].id;
        if (!out.unlocked[key][id]) out.installed[key][id] = false;
      }
    }
    var xp = Number(raw.experience);
    out.experience = isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
    out.updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : 0;
    return out;
  }

  function save() {
    if (!state) return;
    state.updatedAt = Date.now();
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function notifyTechUiRefresh() {
    try {
      if (typeof window !== 'undefined' && typeof window.vehicleTechRefreshUI === 'function') window.vehicleTechRefreshUI();
    } catch (eRefresh) {}
  }

  function load() {
    if (state) return state;
    var raw = null;
    try {
      raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
      if (!raw) raw = JSON.parse(window.localStorage.getItem(LEGACY_STORAGE_KEY) || 'null');
    } catch (e) { raw = null; }
    state = normalize(raw);
    save();
    return state;
  }

  function isPlayerMbt1(t) {
    return !!t && t.isPlayer === true && (t.team === 'red' || t.team === 'blue') && t.kind === 'tank';
  }
  function isPlayerRedMbt1(t) {
    return !!t && t.isPlayer === true && t.team === 'red' && t.kind === 'tank';
  }
  function isPlayerBlueMbt1(t) {
    return !!t && t.isPlayer === true && t.team === 'blue' && t.kind === 'tank';
  }
  function isPlayerBlueMbt2(t) {
    return !!t && t.isPlayer === true && t.team === 'blue' && t.kind === 'td';
  }
  function isPlayerRedTd(t) {
    return !!t && t.isPlayer === true && t.team === 'red' && t.kind === 'td';
  }
  function isPlayerRedMbt2(t) {
    return !!t && t.isPlayer === true && t.team === 'red' && t.kind === '99';
  }
  function isPlayerRedHeli(t) {
    return !!t && t.isPlayer === true && t.team === 'red' && t.kind === 'wz10';
  }
  function isPlayerBlueHeli(t) {
    return !!t && t.isPlayer === true && t.team === 'blue' && t.kind === 'ah64';
  }
  function isPlayerRedMlrs(t) {
    return !!t && t.isPlayer === true && t.team === 'red' && t.kind === 'arty';
  }
  function isPlayerRedAa(t) {
    return !!t && t.isPlayer === true && t.team === 'red' && t.kind === 'aa';
  }
  function techKeyFor(t) {
    /* Preview vehicles are isolated from battle lists but must consume the same
       installed player state so the garage model and stat card reflect the real
       player loadout.  AI instances remain outside this gate. */
    if (!t || (t.isPlayer !== true && t._techPreview !== true)) return null;
    return supportedKey(t.team, t.kind);
  }

  function isInstalled(t, id) {
    var key = techKeyFor(t);
    if (!key) return false;
    var s = load();
    return !!(s.installed[key] && s.installed[key][id] === true && s.unlocked[key] && s.unlocked[key][id] === true);
  }
  function thermalImagingInstalled(t) { return isInstalled(t, 'improved-optics'); }
  function highExplosiveInstalled(t) { return isInstalled(t, 'high-explosive'); }
  function improvedCoolingInstalled(t) { return isInstalled(t, 'improved-cooling'); }
  function improvedApInstalled(t) { return isInstalled(t, 'improved-ap'); }
  function improvedPowerPackInstalled(t) { return isInstalled(t, 'improved-power-pack'); }
  function highPowerLaserInstalled(t) { return isInstalled(t, 'high-power-laser'); }
  function heavyRocketWarheadInstalled(t) { return isInstalled(t, 'heavy-rocket-warhead'); }
  function blueHeliHeavyRocketWarheadInstalled(t) {
    return isPlayerBlueHeli(t) && (isInstalled(t, 'heavy-rocket-warhead') || t._techBlueHeliHeavyRocketWarhead === true);
  }
  function blueHeliAutoCannonInstalled(t) {
    return isPlayerBlueHeli(t) && (isInstalled(t, 'auto-cannon') || t._techBlueHeliAutoCannon === true);
  }
  function blueHeliDepletedUraniumRoundInstalled(t) {
    return isPlayerBlueHeli(t) && (isInstalled(t, 'depleted-uranium-round') || t._techBlueHeliDepletedUraniumRound === true);
  }
  function airburstRocketInstalled(t) { return isInstalled(t, 'airburst-round'); }
  function guidedWarheadInstalled(t) { return isInstalled(t, 'guided-warhead'); }
  function redAaAtgmInstalled(t) { return isInstalled(t, 'anti-tank-missile'); }

  var BLUE_HELI_AUTO_CANNON_RANGE = 1000;
  var BLUE_HELI_AUTO_CANNON_SCAN_INTERVAL = 0.10;
  function blueHeliAutoCannonNormAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
  function blueHeliAutoCannonLineClear(t, target, dist) {
    if (!t || !target || !t.group || !target.group) return false;
    var a = t.group.position, b = target.group.position;
    var fromY = a.y + 1.2, toY = b.y + 1.2;
    if (typeof worldRaycast === 'function') {
      var hits = worldRaycast(a.x, fromY, a.z, b.x, toY, b.z, true);
      if (hits && hits.length > 0) return false;
    }
    if (typeof isRadarLineOccludedByTerrain === 'function') {
      if (isRadarLineOccludedByTerrain(a.x, fromY, a.z, b.x, toY, b.z, dist)) return false;
    }
    return true;
  }
  function blueHeliAutoCannonTarget(t, dt) {
    if (!blueHeliAutoCannonInstalled(t) || !t.alive || !t.group) {
      if (t) { t._techAutoCannonTarget = null; t._techAutoCannonScanT = 0; }
      return null;
    }
    var step = Number(dt);
    if (!isFinite(step) || step < 0) step = 0;
    t._techAutoCannonScanT = (Number(t._techAutoCannonScanT) || 0) - step;
    var current = t._techAutoCannonTarget;
    var cp = t.group.position;
    var currentValid = current && current.alive && current.group && current.team !== t.team;
    if (currentValid) {
      var cgp = current.group.position;
      var cdx = cgp.x - cp.x, cdy = (cgp.y + 1.2) - (cp.y + 1.2), cdz = cgp.z - cp.z;
      currentValid = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz) <= BLUE_HELI_AUTO_CANNON_RANGE;
    }
    if (t._techAutoCannonScanT > 0 && currentValid) return current;

    t._techAutoCannonScanT = BLUE_HELI_AUTO_CANNON_SCAN_INTERVAL;
    var roster = typeof hostileRosterOf === 'function' ? hostileRosterOf(t) : [];
    var best = null, bestD2 = Infinity;
    for (var i = 0; i < roster.length; i++) {
      var candidate = roster[i];
      if (!candidate || candidate === t || !candidate.alive || candidate.team === t.team || !candidate.group) continue;
      var p = candidate.group.position;
      var dx = p.x - cp.x, dy = (p.y + 1.2) - (cp.y + 1.2), dz = p.z - cp.z;
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > BLUE_HELI_AUTO_CANNON_RANGE * BLUE_HELI_AUTO_CANNON_RANGE || d2 >= bestD2) continue;
      var d = Math.sqrt(d2);
      if (!blueHeliAutoCannonLineClear(t, candidate, d)) continue;
      best = candidate;
      bestD2 = d2;
    }
    t._techAutoCannonTarget = best;
    return best;
  }
  function blueHeliAutoCannonTick(t, dt) {
    return blueHeliAutoCannonTarget(t, dt);
  }
  function blueHeliAutoCannonAim(t) {
    var target = blueHeliAutoCannonTarget(t, 0);
    if (!target || typeof THREE === 'undefined' || !THREE.Vector3 || !t.gunPivot || !t.group) return null;
    var origin = new THREE.Vector3();
    t.gunPivot.getWorldPosition(origin);
    var targetPos = target.group.position;
    var direction = new THREE.Vector3(targetPos.x - origin.x, targetPos.y + 1.2 - origin.y, targetPos.z - origin.z);
    var distance = direction.length();
    if (!(distance > 0) || distance > BLUE_HELI_AUTO_CANNON_RANGE) return null;
    var inv = new THREE.Quaternion();
    t.group.getWorldQuaternion(inv).invert();
    direction.applyQuaternion(inv);
    var horizontal = Math.sqrt(direction.x * direction.x + direction.z * direction.z) || 1;
    var rawYaw = Math.atan2(direction.x, direction.z);
    var rawPitch = Math.atan2(direction.y, horizontal);
    return {
      target: target,
      distance: distance,
      rawYaw: rawYaw,
      rawPitch: rawPitch,
      yaw: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rawYaw)),
      pitch: Math.max(-80 * Math.PI / 180, Math.min(0, rawPitch))
    };
  }
  function blueHeliAutoCannonFire(t, aim) {
    if (!blueHeliAutoCannonInstalled(t) || !aim || !aim.target || !aim.target.alive) return false;
    if (Math.abs(aim.rawYaw) > Math.PI / 2 + 1e-4) return false;
    if (Math.abs(blueHeliAutoCannonNormAngle(aim.yaw - (t.turretYaw || 0))) > 0.06 ||
        Math.abs(aim.pitch - (t.gunPitch || 0)) > 0.06) return false;
    if (!blueHeliAutoCannonLineClear(t, aim.target, aim.distance)) return false;
    if (typeof tryFire !== 'function') return false;
    t.lastAimD = aim.distance;
    var oldReload = t.reload;
    tryFire(t);
    return t.reload > oldReload;
  }
  function airburstRocketInstalled(t) { return isInstalled(t, 'airburst-round'); }
  function guidedWarheadInstalled(t) { return isInstalled(t, 'guided-warhead'); }
  function redAaAtgmInstalled(t) { return isInstalled(t, 'anti-tank-missile'); }
  function depletedUraniumArmorInstalled(t) { return isInstalled(t, 'depleted-uranium-armor'); }
  function burstLoadingInstalled(t) { return isInstalled(t, 'burst-loading'); }
  function depletedUraniumRoundInstalled(t) { return isInstalled(t, 'depleted-uranium-round'); }

  /* BLUE-MBT-2 burst loading is a player-tech effect, not a powerup.  Keep the
     fatigue state on the player instance so AI vehicles can never inherit it. */
  function turretHpFraction(t) {
    var m = t && t.mods && t.mods.turret, hp = m && Number(m.hp), max = m && Number(m.max);
    if (!(max > 0) || !isFinite(hp)) return 1;
    return Math.max(0, Math.min(1, hp / max));
  }
  function burstLoadingFatigueProbability(t) {
    if (!burstLoadingInstalled(t)) return 0;
    var turretHpPercent = turretHpFraction(t);
    return (1 - turretHpPercent / 2) / 2;
  }
  function burstLoadingFatigueRemaining(t) {
    if (!t || t.isPlayer !== true || !burstLoadingInstalled(t)) return 0;
    return Math.max(0, Number(t._techBurstFatigueT) || 0);
  }
  function burstLoadingHudShake(t) {
    if (!t || t.isPlayer !== true || !burstLoadingInstalled(t) || burstLoadingFatigueRemaining(t) > 0) return false;
    if (typeof document === 'undefined') return false;
    var root = document.getElementById('vehicle-tech-status-hud');
    if (!root || root.classList.contains('hidden')) return false;
    root.classList.remove('tech-status-shake');
    void root.offsetWidth;
    root.classList.add('tech-status-shake');
    return true;
  }
  function burstLoadingRate(t) {
    return burstLoadingInstalled(t) && burstLoadingFatigueRemaining(t) <= 0 ? 2 : 1;
  }
  function burstLoadingAfterFire(t) {
    if (!t || t.isPlayer !== true || !burstLoadingInstalled(t)) return false;
    var chance = burstLoadingFatigueProbability(t);
    if (chance <= 0 || Math.random() >= chance) {
      if (burstLoadingFatigueRemaining(t) <= 0) burstLoadingHudShake(t);
      return false;
    }
    t._techBurstFatigueT = 10 + Math.random() * 10;
    return true;
  }
  function burstLoadingTick(t, dt) {
    if (!t || t.isPlayer !== true || !burstLoadingInstalled(t)) {
      if (t && t._techBurstFatigueT != null && !burstLoadingInstalled(t)) t._techBurstFatigueT = 0;
      return 0;
    }
    var remain = Math.max(0, Number(t._techBurstFatigueT) || 0);
    if (remain > 0) remain = Math.max(0, remain - Math.max(0, Number(dt) || 0));
    t._techBurstFatigueT = remain;
    return remain;
  }
  function burstLoadingHudUpdate(t) {
    if (typeof document === 'undefined') return;
    var root = document.getElementById('vehicle-tech-status-hud');
    if (!root) return;
    if (!t || t.isPlayer !== true || !t.alive || !burstLoadingInstalled(t)) {
      root.classList.add('hidden');
      root.setAttribute('aria-hidden', 'true');
      return;
    }
    var tired = burstLoadingFatigueRemaining(t), icon = document.getElementById('vehicle-tech-status-icon');
    if (tired > 0) root.classList.remove('tech-status-shake');
    var label = document.getElementById('vehicle-tech-status-label');
    var time = document.getElementById('vehicle-tech-status-time');
    var note = document.getElementById('vehicle-tech-status-note');
    var color = tired > 0 ? '#ff8f6e' : '#ffd447';
    var frac = tired > 0 ? Math.max(0, Math.min(1, tired / 20)) : 1;
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    if (icon) {
      icon.style.setProperty('--pu-color', color);
      icon.style.background = 'conic-gradient(' + color + ' ' + (frac * 360).toFixed(1) + 'deg, rgba(20,25,20,.92) 0deg)';
    }
    if (label) label.textContent = tired > 0 ? 'FATIGUED' : 'BURST LOADING';
    if (time) time.textContent = tired > 0 ? tired.toFixed(1) + 's' : 'READY';
    if (note) note.textContent = tired > 0 ? 'NORMAL RELOAD // FATIGUED' : 'SUPER RELOAD ×2 // BURST LOADING';
  }
  function burstLoadingHudTick() {
    burstLoadingHudUpdate(typeof player !== 'undefined' ? player : null);
  }
  function redTdAimKind(t) {
    if (!t) return 1;
    return t._tdReloadKind === 2 ? 2 : 1;
  }
  function redTdWeaponSpeed(t) { return highExplosiveInstalled(t) && redTdAimKind(t) === 2 ? 1400 : (t && t.shellSpeed0 || 0); }
  function redTdWeaponPen(t) { return highExplosiveInstalled(t) && redTdAimKind(t) === 2 ? 500 : (t && t.pen || 0); }
  function redTdWeaponDamage(t) { return highExplosiveInstalled(t) && redTdAimKind(t) === 2 ? 180 : (t && t.dmg || 0); }
  function lwsEmitTime(t) { return highPowerLaserInstalled(t) ? 2.0 : 4.0; }
  function lwsCooldownTime(t) { return improvedCoolingInstalled(t) ? 15.0 : 30.0; }

  function treeFor(team, kind) {
    var key = supportedKey(team, kind);
    return key ? TREE[key] : null;
  }

  function stateFor(team, kind) {
    var key = supportedKey(team, kind), s = load();
    if (!key) return null;
    var out = { key: key, unlocked: {}, installed: {}, experience: s.experience }, nodes = TREE[key].nodes;
    for (var i = 0; i < nodes.length; i++) {
      var id = nodes[i].id;
      out.unlocked[id] = !!s.unlocked[key][id];
      out.installed[id] = !!s.installed[key][id];
    }
    return out;
  }

  function experience() {
    return load().experience;
  }

  function addExperience(amount) {
    var s = load(), n = Number(amount);
    if (!isFinite(n) || n <= 0) return s.experience;
    s.experience += Math.floor(n);
    save();
    notifyTechUiRefresh();
    return s.experience;
  }

  function unlockAndInstall(team, kind, id) {
    var key = supportedKey(team, kind), s = load(), found = false;
    if (!key) return { ok: false, reason: 'INVALID_TECH', experience: s.experience, required: TECH_EXP_UNLOCK_COST };
    for (var i = 0; i < TREE[key].nodes.length; i++) if (TREE[key].nodes[i].id === id) { found = true; break; }
    if (!found) return { ok: false, reason: 'INVALID_TECH', experience: s.experience, required: TECH_EXP_UNLOCK_COST };
    if (s.unlocked[key][id] === true) return { ok: false, reason: 'ALREADY_UNLOCKED', experience: s.experience, required: TECH_EXP_UNLOCK_COST };
    if (s.experience < TECH_EXP_UNLOCK_COST) return { ok: false, reason: 'INSUFFICIENT_EXPERIENCE', experience: s.experience, required: TECH_EXP_UNLOCK_COST };
    s.experience -= TECH_EXP_UNLOCK_COST;
    s.unlocked[key][id] = true;
    s.installed[key][id] = true;
    save();
    notifyTechUiRefresh();
    return { ok: true, unlocked: true, installed: true, experience: s.experience, cost: TECH_EXP_UNLOCK_COST };
  }

  function toggle(team, kind, id) {
    var key = supportedKey(team, kind), s = load(), i, found = false;
    if (!key || !s.unlocked[key] || s.unlocked[key][id] !== true) return { ok: false, installed: false, reason: 'LOCKED', experience: s.experience };
    for (i = 0; i < TREE[key].nodes.length; i++) if (TREE[key].nodes[i].id === id) { found = true; break; }
    if (!found) return { ok: false, installed: false, reason: 'INVALID_TECH', experience: s.experience };
    s.installed[key][id] = !s.installed[key][id];
    save();
    notifyTechUiRefresh();
    return { ok: true, installed: s.installed[key][id] === true, experience: s.experience };
  }

  var _matchXpSettled = false, _lastMatchXpReward = null;
  function beginMatch() {
    _matchXpSettled = false;
    _lastMatchXpReward = null;
    if (typeof window !== 'undefined') {
      window._vehicleTechLastXpReward = null;
      window._vehicleTechMatchEnded = false;
      window._vehicleTechMatchWin = false;
    }
  }
  function settleMatch(win, killCount) {
    if (_matchXpSettled && _lastMatchXpReward) return _lastMatchXpReward;
    var killsAwarded = Math.max(0, Math.floor(Number(killCount) || 0));
    var completion = 5, victory = win ? 5 : 0, killsXp = killsAwarded * 5;
    var total = completion + victory + killsXp;
    var after = addExperience(total);
    _lastMatchXpReward = { completion: completion, victory: victory, kills: killsXp, killCount: killsAwarded, total: total, experience: after };
    _matchXpSettled = true;
    if (typeof window !== 'undefined') window._vehicleTechLastXpReward = _lastMatchXpReward;
    notifyTechUiRefresh();
    return _lastMatchXpReward;
  }

  function redMbt2BasePen() {
    return (typeof CONF !== 'undefined' && CONF && CONF.t99 && CONF.t99.pen) || 1090;
  }
  function blueMbt2BasePen() {
    return (typeof CONF !== 'undefined' && CONF && CONF.m1 && CONF.m1.pen) || 514;
  }
  /* The upgrade is defined against the corresponding MBT-2's initial
     penetration.  A percentage result that would make the MBT-1 worse is
     lifted just above that vehicle's unmodified value so the node is always a
     real gun upgrade, never a downgrade or a no-op. */
  function mbt1ImprovedPen(team, basePen) {
    var base = Number(basePen);
    if (!(base >= 0) || !isFinite(base)) base = 446;
    var reference = team === 'blue' ? blueMbt2BasePen() : redMbt2BasePen();
    var seventy = reference * 0.70;
    return Math.round(seventy > base ? seventy : base + 1);
  }

  var BATTLE_REPAIR_MODULE_KEYS = ['gun', 'turret', 'engine', 'fuel', 'ammo', 'trackL', 'trackR', 'tailRotor'];
  var BATTLE_REPAIR_RATE = 5;
  var BATTLE_REPAIR_STOP_DELAY = 5;
  var BATTLE_REPAIR_CAP = 0.50;

  function battleRepairInstalled(t) {
    return !!t && t.isPlayer === true && t.team === 'blue' && t.kind === 'tank' && t._techBattlefieldRepair === true;
  }
  function battleRepairState(t) {
    if (!t._vehicleTechRepair) {
      var firstDamage = Number(t.lastDamageT);
      t._vehicleTechRepair = {
        stationaryT: 0,
        active: false,
        target: null,
        status: 'READY',
        countdown: 0,
        armed: false,
        lastDamageSeen: isFinite(firstDamage) ? firstDamage : -Infinity
      };
    }
    return t._vehicleTechRepair;
  }
  function battleRepairLastDamage(t) {
    var v = Number(t && t.lastDamageT);
    return isFinite(v) ? v : -Infinity;
  }
  function battleRepairPickTarget(t) {
    if (!t || !t.mods) return null;
    var best = null, bestFrac = Infinity;
    for (var i = 0; i < BATTLE_REPAIR_MODULE_KEYS.length; i++) {
      var key = BATTLE_REPAIR_MODULE_KEYS[i], mod = t.mods[key];
      if (!mod || mod.structural || !(Number(mod.max) > 0)) continue;
      var max = Number(mod.max), hp = Math.max(0, Number(mod.hp) || 0);
      var cap = max * BATTLE_REPAIR_CAP;
      if (hp >= cap - 1e-9) continue;
      var frac = hp / max;
      if (frac < bestFrac - 1e-12) {
        bestFrac = frac;
        best = { key: key, mod: mod, max: max, cap: cap };
      }
    }
    return best;
  }
  function battleRepairHudUpdate(t) {
    if (typeof document === 'undefined') return;
    var root = document.getElementById('battle-repair-hud');
    if (!root) return;
    if (!t || t.isPlayer !== true || !t.alive || !battleRepairInstalled(t)) {
      root.classList.add('hidden');
      root.setAttribute('aria-hidden', 'true');
      root.removeAttribute('data-state');
      return;
    }
    var st = t._vehicleTechRepair || { status: 'READY', countdown: 0, target: null, active: false };
    var state = st.active ? 'REPAIRING' : (st.status === 'PREPARING' ? 'PREPARING' : 'READY');
    var targetKey = st.target;
    var mod = targetKey && t.mods && t.mods[targetKey];
    var max = mod && Number(mod.max) > 0 ? Number(mod.max) : 1;
    var hp = mod ? Math.max(0, Number(mod.hp) || 0) : 0;
    var countdown = Math.max(0, Number(st.countdown) || 0);
    var progress = state === 'PREPARING'
      ? Math.max(0, Math.min(1, 1 - countdown / BATTLE_REPAIR_STOP_DELAY))
      : (state === 'REPAIRING' ? Math.max(0, Math.min(1, hp / (max * BATTLE_REPAIR_CAP))) : 1);
    var color = state === 'REPAIRING' ? '#9dffa8' : (state === 'PREPARING' ? '#ffd447' : '#9dffa8');
    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    root.setAttribute('data-state', state);
    root.style.setProperty('--pu-color', color);
    var icon = document.getElementById('battle-repair-icon');
    if (icon) {
      icon.style.setProperty('--pu-color', color);
      icon.style.setProperty('--pu-progress', String(progress));
      icon.style.background = 'conic-gradient(' + color + ' ' + (progress * 360).toFixed(1) + 'deg, rgba(20,25,20,.92) 0deg)';
    }
    var label = document.getElementById('battle-repair-label');
    if (label) label.textContent = state;
    var time = document.getElementById('battle-repair-time');
    if (time) time.textContent = state === 'PREPARING' ? countdown.toFixed(1) + 's' : (state === 'REPAIRING' ? BATTLE_REPAIR_RATE + ' HP/S' : 'READY');
    var note = document.getElementById('battle-repair-note');
    if (note) {
      if (state === 'REPAIRING') note.textContent = 'BATTLEFIELD REPAIR // ' + String(targetKey || 'MODULE').toUpperCase();
      else if (state === 'PREPARING') note.textContent = 'REPAIR PREP // STOPPED';
      else if (!battleRepairPickTarget(t)) note.textContent = 'NO REPAIRABLE MODULE';
      else if (Math.abs(Number(t.speed) || 0) > 0.05) note.textContent = 'STOP TO REPAIR';
      else note.textContent = 'AWAITING DAMAGE';
    }
    var detail = document.getElementById('battle-repair-detail');
    if (detail) detail.textContent = state === 'REPAIRING'
      ? Math.round(hp) + ' / ' + Math.round(max * BATTLE_REPAIR_CAP) + ' HP'
      : (state === 'PREPARING' ? 'REPAIR IN ' + countdown.toFixed(1) + 's' : 'SYSTEM READY');
  }
  function battleRepairReadyState(st) {
    st.active = false;
    st.target = null;
    st.status = 'READY';
    st.countdown = 0;
  }
  function battlefieldRepairTick(t, dt) {
    if (!t) return null;
    if (!battleRepairInstalled(t) || !t.alive) {
      /* Do not allocate repair state on AI or non-upgraded vehicles. */
      var inactive = t._vehicleTechRepair;
      if (inactive) battleRepairReadyState(inactive);
      if (typeof player !== 'undefined' && t === player) battleRepairHudUpdate(t);
      return null;
    }
    var st = battleRepairState(t);
    var lastDamage = battleRepairLastDamage(t);
    if (st.lastDamageSeen !== lastDamage) {
      /* Every new damage timestamp restarts the preparation countdown. */
      st.lastDamageSeen = lastDamage;
      st.stationaryT = 0;
      st.active = false;
      st.target = null;
      st.armed = isFinite(lastDamage);
      st.status = st.armed ? 'PREPARING' : 'READY';
      st.countdown = st.armed ? BATTLE_REPAIR_STOP_DELAY : 0;
    }
    if (!st.armed) {
      battleRepairReadyState(st);
      if (typeof player !== 'undefined' && t === player) battleRepairHudUpdate(t);
      return null;
    }
    var speed = Number(t.speed) || 0;
    if (Math.abs(speed) > 0.05) {
      /* Moving cancels the current preparation; a later stop starts a fresh
         five-second stationary preparation without changing the damage event. */
      st.stationaryT = 0;
      battleRepairReadyState(st);
      if (typeof player !== 'undefined' && t === player) battleRepairHudUpdate(t);
      return null;
    }
    if (!battleRepairPickTarget(t)) {
      /* A damage event that did not leave a repairable module is READY, not a
         countdown with an empty target. */
      battleRepairReadyState(st);
      st.armed = false;
      if (typeof player !== 'undefined' && t === player) battleRepairHudUpdate(t);
      return null;
    }
    st.stationaryT += Math.max(0, Number(dt) || 0);
    if (st.stationaryT < BATTLE_REPAIR_STOP_DELAY) {
      st.active = false;
      st.target = null;
      st.status = 'PREPARING';
      st.countdown = Math.max(0, BATTLE_REPAIR_STOP_DELAY - st.stationaryT);
      if (typeof player !== 'undefined' && t === player) battleRepairHudUpdate(t);
      return null;
    }
    var target = battleRepairPickTarget(t);
    if (!target) {
      battleRepairReadyState(st);
      st.armed = false;
      if (typeof player !== 'undefined' && t === player) battleRepairHudUpdate(t);
      return null;
    }
    st.active = true;
    st.status = 'REPAIRING';
    st.countdown = 0;
    st.target = target.key;
    target.mod.hp = Math.min(target.cap, Math.max(0, Number(target.mod.hp) || 0) + BATTLE_REPAIR_RATE * Math.max(0, Number(dt) || 0));
    /* Turret destruction normally arms the player's hull-aim fallback.  If
       battlefield repair brings that real module back above zero, release the
       fallback so the repaired turret is actually usable again. */
    if (target.key === 'turret' && target.mod.hp > 0 && t._hullAim) t._hullAim = false;
    if (typeof effSync === 'function') effSync(t);
    if (typeof player !== 'undefined' && t === player && typeof playerHudDamage === 'function') playerHudDamage(target.key);
    if (typeof player !== 'undefined' && t === player) battleRepairHudUpdate(t);
    return target.key;
  }
  function battlefieldRepairHudTick() {
    var p = typeof player !== 'undefined' ? player : null;
    battleRepairHudUpdate(p);
  }

  function cloneArmorDef(a) {
    var out = {}, k;
    a = a || {};
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k) && typeof a[k] === 'number') out[k] = a[k];
    return out;
  }

  function applyBlueMbt2ArmorTech(t, enabled) {
    if (!t || !t.mods || !t.mods.hull || !t.mods.hull.armor) return;
    if (!t._baseM1HullArmor) t._baseM1HullArmor = cloneArmorDef(t.mods.hull.armor);
    t.mods.hull.armor = cloneArmorDef(t._baseM1HullArmor);
    /* armorOf('m1hull') consumes this on the actual plate/penetration path.
       Keep it on the per-tank module, never on CONF.blue / CONF.m1 shared data. */
    t.mods.hull._duFrontBonus = enabled ? 100 : 0;
    t._techDepletedUranium = !!enabled;
  }

  function applyToTank(t) {
    if (!t) return t;
    if (t._basePen == null) t._basePen = t.pen;
    if (t._baseShellSpeed0 == null) t._baseShellSpeed0 = t.shellSpeed0;
    if (t._baseReloadTime == null) t._baseReloadTime = t.reloadTime;
    if (t._baseSpeed0 == null) t._baseSpeed0 = t.speed0;
    if (t._baseTurretRate0 == null) t._baseTurretRate0 = t.turretRate0;

    t.pen = t._basePen;
    t.shellSpeed0 = t._baseShellSpeed0;
    t.reloadTime = t._baseReloadTime;
    t.speed0 = t._baseSpeed0;
    t.turretRate0 = t._baseTurretRate0;
    if (typeof nightAimEffOf === 'function') t.nightEff = nightAimEffOf(t.kind, t.team);
    t._techInstalled = {};
    t._techGroundCrrMul = 1;
    t._techFcs = false;
    t._techAuxLoader = false;
    t._techImproved105 = false;
    t._techImprovedAp = false;
    t._techImprovedEngine = false;
    t._techImprovedMotor = false;
    t._techImprovedOptics = false;
    t._techGunLaunchedMissile = false;
    t._techBattlefieldRepair = false;
    t._vehicleTechRepair = null;
    t._techHighExplosive = false;
    t._techImprovedCooling = false;
    t._techImprovedPowerPack = false;
    t._techHighPowerLaser = false;
    t._techHeavyRocketWarhead = false;
    t._techBlueHeliHeavyRocketWarhead = false;
    t._techBlueHeliAutoCannon = false;
    t._techBlueHeliDepletedUraniumRound = false;
    t._techAirburstRound = false;
    t._techGuidedWarhead = false;
    t._techAaAtgm = false;
    t._techDepletedUranium = false;
    t._techBurstLoading = false;
    t._techDepletedUraniumRound = false;
    if (t._techBurstFatigueT == null) t._techBurstFatigueT = 0;

    var key = techKeyFor(t);
    if (key) {
      var s = load().installed[key] || {};
      t._techInstalled = {};
      var nodes = TREE[key].nodes;
      for (var ni = 0; ni < nodes.length; ni++) t._techInstalled[nodes[ni].id] = s[nodes[ni].id] === true;
      t._techImprovedOptics = !!t._techInstalled['improved-optics'];
      t._techHighExplosive = !!t._techInstalled['high-explosive'];
      t._techImprovedCooling = !!t._techInstalled['improved-cooling'];
      t._techImprovedPowerPack = !!t._techInstalled['improved-power-pack'];
      t._techHighPowerLaser = !!t._techInstalled['high-power-laser'];
      t._techHeavyRocketWarhead = !!t._techInstalled['heavy-rocket-warhead'];
      t._techBlueHeliHeavyRocketWarhead = !!t._techInstalled['heavy-rocket-warhead'];
      t._techBlueHeliAutoCannon = !!t._techInstalled['auto-cannon'];
      t._techBlueHeliDepletedUraniumRound = !!t._techInstalled['depleted-uranium-round'];
      t._techAirburstRound = !!t._techInstalled['airburst-round'];
      t._techGuidedWarhead = !!t._techInstalled['guided-warhead'];
      t._techAaAtgm = !!t._techInstalled['anti-tank-missile'];
      t._techDepletedUranium = !!t._techInstalled['depleted-uranium-armor'];
      t._techBurstLoading = !!t._techInstalled['burst-loading'];
      t._techDepletedUraniumRound = !!t._techInstalled['depleted-uranium-round'];
      if (!t._techBurstLoading) t._techBurstFatigueT = 0;
      // The optics node also updates the real cached night-aim consumer;
      // playerEquipSync separately gates the H-key thermal compositor.
      if (t._techImprovedOptics && t.isPlayer === true) t.nightEff = 1.2;

      if (key === 'red|tank' || key === 'blue|tank') {
        t._techGroundCrrMul = t._techInstalled['non-skid-track'] ? 0.70 : 1;
        t._techFcs = !!t._techInstalled.fcs;
        t._techAuxLoader = !!t._techInstalled['aux-loader'];
      t._techImproved105 = !!t._techInstalled['improved-105'];
      t._techImprovedAp = !!t._techInstalled['improved-ap'];
      t._techImprovedEngine = !!t._techInstalled['improved-engine'];
        t._techImprovedMotor = !!t._techInstalled['improved-motor'];
        t._techGunLaunchedMissile = !!t._techInstalled['gun-launched-missile'];
        t._techBattlefieldRepair = !!t._techInstalled['battlefield-repair'];
        if (t._techAuxLoader) t.reloadTime = Math.max(0.1, t._baseReloadTime - 0.5);
        if (t._techImprovedEngine) t.speed0 = t._baseSpeed0 + (10 / 3.6);
        if (t._techImprovedMotor) t.turretRate0 = 20 * Math.PI / 180;
        var tankPen = t._basePen;
        if (t._techImproved105) {
          tankPen = mbt1ImprovedPen(t.team, t._basePen);
          t.shellSpeed0 = 1600;
        }
        if (t._techImprovedAp) tankPen += 100;
        t.pen = tankPen;
      } else if (key === 'blue|ah64') {
        /* BLUE-HELI upgrades are player-only.  DU ammunition modifies the
           cannon's real initial penetration value; it is not an armor bonus. */
        t.pen = t._basePen + (t._techBlueHeliDepletedUraniumRound ? 50 : 0);
      } else if (key === 'red|99') {
        if (t._techImprovedPowerPack) t.speed0 = t._baseSpeed0 + (10 / 3.6);
      } else if (key === 'blue|td') {
        /* Only the player/garage preview gets here because techKeyFor excludes AI. */
        applyBlueMbt2ArmorTech(t, t._techDepletedUranium);
        /* DU rounds change the actual muzzle penetration value.  This is kept
           separate from _duFrontBonus so the upgrade cannot become an armor
           bonus by accident, and AI BLUE-MBT-2 never reaches this branch. */
        t.pen = t._basePen + (t._techDepletedUraniumRound ? 100 : 0);
      }
    }
    /* A player can toggle the DU node off after the first application. Restore the
       per-instance base armor even when a future caller invokes applyToTank with a
       stale/empty tech state; shared CONF armor is never mutated. */
    if (key !== 'blue|td' && t._baseM1HullArmor && t.mods && t.mods.hull) {
      applyBlueMbt2ArmorTech(t, false);
    }
    if (!t._techHighExplosive && t._tdWeapon === 2) {
      t._tdWeapon = 1;
      t._tdReloadKind = 1;
      if (t.reload > 0) t.reload = t.reloadTime;
    }
    /* The missile selector is player-instance state. A removed node cannot leave
       an already selected missile mode active on the local tank. */
    if (!t._techGunLaunchedMissile && t._mbtWeapon === 2) {
      t._mbtWeapon = 1;
      if (t.reload > 0) t.reload = t.reloadTime;
      t._mbtReloadKind = 1;
    }
    if (t.reload != null && t.reload > t.reloadTime) t.reload = t.reloadTime;
    return t;
  }

  function resistanceMultiplier(t) {
    return isInstalled(t, 'non-skid-track') ? 0.70 : 1;
  }

  function gunLaunchedMissileInstalled(t) {
    return isInstalled(t, 'gun-launched-missile');
  }

  function fireControlLabel(t) {
    if (!t) return 'FCS';
    if (isPlayerMbt1(t)) return isInstalled(t, 'fcs') ? 'FCS COMPUTER' : 'MANUAL TABLE';
    if (isPlayerBlueMbt2(t)) return 'FCS COMPUTER';
    return (t.kind === 'tank' ? 'MANUAL TABLE' : 'FCS COMPUTER');
  }

  function scopeBallisticText(t, distance) {
    if (!t || t.kind === 'arty' || (typeof isHeliVehicle === 'function' && isHeliVehicle(t))) return '';
    var d = Number(distance);
    if (!(d > 0) || !isFinite(d)) d = 100;
    var isHE = t.kind === 'td' && highExplosiveInstalled(t) && redTdAimKind(t) === 2;
    var mv = isHE ? 1400 : (typeof effectiveShellSpeed === 'function' ? effectiveShellSpeed(t) : (t.shellSpeed0 || 0));
    var pen = isHE ? 500 : (t.pen || 0);
    if (!isHE && t.penKd) pen *= Math.exp(-t.penKd * d);
    var disp = typeof aiBaseDispersion === 'function' ? aiBaseDispersion(t, d) * d : 0;
    var rel = t.reloadTime != null ? t.reloadTime.toFixed(1) : '--';
    var mode = isHE ? 'HE 180 DMG / BLAST ' + (typeof splashRadiusFromDamage === 'function' ? Math.round(splashRadiusFromDamage(180)) : 44) + 'm' : 'AP';
    return fireControlLabel(t) + ' // ' + mode + ' // MV ' + Math.round(mv) + ' // PEN ' + Math.round(pen) +
      ' // DISP ±' + disp.toFixed(1) + 'm // REL ' + rel + 's';
  }

  function hangarData(team, kind, data) {
    var out = {
      fire: data && data.fire,
      fireSub: data && data.fireSub,
      armor: data && data.armor,
      armorSub: data && data.armorSub,
      speed: data && data.speed,
      speedSub: data && data.speedSub
    };
    if ((team === 'red' || team === 'blue') && kind === 'tank') {
      var s = stateFor(team, kind), installed = s && s.installed;
      var sideConf = (typeof CONF !== 'undefined' && CONF && CONF[team]) ? CONF[team] : null;
      if (installed && installed['improved-105']) {
        out.fire = '105mm rifled gun';
        out.fireSub = 'PEN ' + mbt1ImprovedPen(team, sideConf && sideConf.pen != null ? sideConf.pen : 446) + 'mm - MV 1600m/s';
      }
      if (team === 'blue' && installed && installed['improved-ap']) {
        var apBasePen = installed['improved-105'] ? mbt1ImprovedPen(team, sideConf && sideConf.pen != null ? sideConf.pen : 446) : (sideConf && sideConf.pen != null ? sideConf.pen : 446);
        var apBaseMv = installed['improved-105'] ? 1600 : (sideConf && sideConf.shellSpeed != null ? sideConf.shellSpeed : 1480);
        out.fireSub = 'PEN ' + (apBasePen + 100) + 'mm - MV ' + apBaseMv + 'm/s - IMPROVED AP';
      }
      if (installed && installed.fcs) {
        var basePen = sideConf && sideConf.pen != null ? sideConf.pen : 446;
        var baseMv = sideConf && sideConf.shellSpeed != null ? sideConf.shellSpeed : 1480;
        out.fireSub = (out.fireSub || ('PEN ' + Math.round(basePen) + 'mm - MV ' + Math.round(baseMv) + 'm/s')) + ' - FCS COMPUTER';
      }
      if (installed && installed['improved-engine']) {
        var baseSpeedMps = sideConf && sideConf.speed != null ? sideConf.speed : 13.9;
        out.speed = Math.round(baseSpeedMps * 3.6 + 10) + ' km/h';
        out.speedSub = (out.speedSub || '520HP diesel') + ' - +10 KM/H ENGINE';
      }
      if (installed && installed['improved-motor']) {
        out.speedSub = (out.speedSub || '520HP diesel') + ' - TURRET 20 DEG/S';
      }
      if (installed && installed['improved-optics']) {
        out.fireSub = (out.fireSub || 'PEN 446mm - MV 1480m/s') + ' - THERMAL OPTICS';
      }
      if (team === 'blue' && installed && installed['battlefield-repair']) {
        out.speedSub = (out.speedSub || '750HP diesel') + ' - BATTLE REPAIR 5 HP/S';
      }
      if (team === 'red' && installed && installed['gun-launched-missile']) {
        out.fire = (out.fire || '100mm rifled gun') + ' + GUN-LAUNCHED MISSILE';
        out.fireSub = (out.fireSub || 'PEN 220mm - MV 1480m/s') + ' - 60 DMG / 500mm PEN / EO/IR SEEKER';
      }
    } else if (team === 'blue' && kind === 'td') {
      var m1State = stateFor(team, kind), m1Installed = m1State && m1State.installed;
      if (m1Installed && m1Installed['depleted-uranium-armor']) {
        out.armorSub = (out.armorSub || 'Frontal >850mm') + ' - DU GLACIS +100mm EFFECTIVE';
      }
      if (m1Installed && m1Installed['burst-loading']) {
        out.fireSub = (out.fireSub || 'PEN ' + blueMbt2BasePen() + 'mm - MV 1650m/s') + ' - BURST LOADING ×2';
      }
      if (m1Installed && m1Installed['depleted-uranium-round']) {
        out.fireSub = (out.fireSub || 'PEN ' + blueMbt2BasePen() + 'mm - MV 1650m/s') + ' - DU ROUND INITIAL PEN +' + 100 + 'mm (' + (blueMbt2BasePen() + 100) + 'mm)';
      }
    } else if (team === 'red' && kind === 'td') {
      var tdState = stateFor(team, kind), tdInstalled = tdState && tdState.installed;
      if (tdInstalled && tdInstalled['improved-optics']) out.fireSub = (out.fireSub || 'PEN 832mm - MV 1700m/s') + ' - THERMAL OPTICS';
      if (tdInstalled && tdInstalled['high-explosive']) {
        out.fire = (out.fire || '105mm rifled gun') + ' + HIGH-EXPLOSIVE';
        out.fireSub = (out.fireSub || 'AP') + ' - HE 180 DMG / MV 1400m/s / PEN 500mm / ROCKET BLAST';
      }
    } else if (team === 'red' && kind === '99') {
      var t9State = stateFor(team, kind), t9Installed = t9State && t9State.installed;
      if (t9Installed && t9Installed['improved-power-pack']) {
        var t9BaseSpeed = (typeof CONF !== 'undefined' && CONF && CONF.t99 && CONF.t99.speed != null) ? CONF.t99.speed : 16.7;
        out.speed = Math.round(t9BaseSpeed * 3.6 + 10) + ' km/h';
        out.speedSub = (out.speedSub || '850HP diesel') + ' - SPEED EFFECT +10 KM/H';
      }
      if (t9Installed && t9Installed['improved-cooling']) out.fireSub = (out.fireSub || '105mm smoothbore gun') + ' - LASER CD 15s';
      if (t9Installed && t9Installed['high-power-laser']) out.fire = (out.fire || '125mm smoothbore gun') + ' + HIGH-POWER LASER';
    } else if (team === 'red' && kind === 'wz10') {
      var rhState = stateFor(team, kind), rhInstalled = rhState && rhState.installed;
      if (rhInstalled && rhInstalled['heavy-rocket-warhead']) {
        out.fire = (out.fire || '70mm guided rocket') + ' - HEAVY WARHEAD';
        out.fireSub = (out.fireSub || 'PEN 800mm - MV 680m/s') + ' - 60 DMG';
      }
      if (rhInstalled && rhInstalled['airburst-round']) {
        out.fire = (out.fire || '70mm guided rocket') + ' + AIRBURST';
        out.fireSub = (out.fireSub || 'PEN 800mm - MV 680m/s') + ' - 0.5M PROXIMITY';
      }
    } else if (team === 'blue' && kind === 'ah64') {
      var bhState = stateFor(team, kind), bhInstalled = bhState && bhState.installed;
      if (bhInstalled && bhInstalled['heavy-rocket-warhead']) {
        out.fire = (out.fire || '70mm unguided rocket') + ' - HEAVY WARHEAD';
        out.fireSub = (out.fireSub || 'PEN 800mm - MV 748m/s') + ' - 120 DMG PER ROCKET';
      }
      if (bhInstalled && bhInstalled['auto-cannon']) {
        out.fire = (out.fire || '30mm chain gun') + ' - AUTO CANNON';
        out.fireSub = (out.fireSub || 'PEN 35mm - MV 1000m/s') + ' - AUTO AIM / FIRE WITHIN 1000M';
      }
      if (bhInstalled && bhInstalled['depleted-uranium-round']) {
        out.fire = out.fire || '30mm chain gun';
        out.fireSub = (out.fireSub || 'PEN 35mm - MV 1000m/s') + ' - DU ROUND INITIAL PEN +50MM';
      }
    } else if ((team === 'red' || team === 'blue') && kind === 'arty') {
      /* RED-MLRS and BLUE-MLRS expose the same two upgrades.  Keep the
         faction-specific launcher baseline only in the descriptive values. */
      var rmState = stateFor(team, kind), rmInstalled = rmState && rmState.installed;
      var mlrsBase = team === 'blue' ? '6 rockets - 120 DMG' : '40 rockets - 60 DMG';
      var mlrsLauncher = team === 'blue' ? '227mm MLRS' : '122mm MLRS';
      if (rmInstalled && rmInstalled['improved-optics']) out.fireSub = (out.fireSub || mlrsBase) + ' - THERMAL OPTICS';
      if (rmInstalled && rmInstalled['guided-warhead']) {
        out.fire = (out.fire || mlrsLauncher) + ' + GUIDED WARHEAD';
        out.fireSub = (out.fireSub || mlrsBase) + ' - COVERAGE HOMING';
      }
    } else if ((team === 'red' || team === 'blue') && kind === 'aa') {
      var aaState = stateFor(team, kind), aaInstalled = aaState && aaState.installed;
      var aaThermal = aaInstalled && aaInstalled['improved-optics'];
      var aaAtgm = aaInstalled && aaInstalled['anti-tank-missile'];
      if (aaThermal) out.fireSub = (out.fireSub || (team === 'red' ? 'AIR SEARCH RADAR' : 'SURFACE-TO-AIR MISSILES')) + ' - THERMAL OPTICS';
      if (aaAtgm) {
        out.fire = team === 'red' ? '4x SAM / 4x ATGM + TWIN 25MM AUTOCANNON' : '8x SAM / 8x ATGM';
        out.fireSub = 'SELECTABLE SAM OR ATGM - 180 DMG / 800mm PEN / EO/IR GROUND GUIDANCE / ~5KM' + (aaThermal ? ' - THERMAL OPTICS' : '');
      }
    }
    return out;
  }

  function hangarFireData(team, kind, data) {
    var out = hangarData(team, kind, data);
    return { fire: out.fire, fireSub: out.fireSub };
  }

  window.VehicleTech = {
    treeFor: treeFor,
    stateFor: stateFor,
    toggle: toggle,
    unlockAndInstall: unlockAndInstall,
    experience: experience,
    addExperience: addExperience,
    beginMatch: beginMatch,
    settleMatch: settleMatch,
    unlockCost: TECH_EXP_UNLOCK_COST,
    applyToTank: applyToTank,
    isPlayerMbt1: isPlayerMbt1,
    isPlayerRedMbt1: isPlayerRedMbt1,
    isPlayerBlueMbt1: isPlayerBlueMbt1,
    isPlayerBlueMbt2: isPlayerBlueMbt2,
    isPlayerRedTd: isPlayerRedTd,
    isPlayerRedMbt2: isPlayerRedMbt2,
    isPlayerRedHeli: isPlayerRedHeli,
    isPlayerBlueHeli: isPlayerBlueHeli,
    isPlayerRedMlrs: isPlayerRedMlrs,
    isPlayerRedAa: isPlayerRedAa,
    isInstalled: isInstalled,
    blueHeliHeavyRocketWarheadInstalled: blueHeliHeavyRocketWarheadInstalled,
    blueHeliAutoCannonInstalled: blueHeliAutoCannonInstalled,
    blueHeliDepletedUraniumRoundInstalled: blueHeliDepletedUraniumRoundInstalled,
    blueHeliAutoCannonTarget: blueHeliAutoCannonTarget,
    blueHeliAutoCannonTick: blueHeliAutoCannonTick,
    blueHeliAutoCannonAim: blueHeliAutoCannonAim,
    blueHeliAutoCannonFire: blueHeliAutoCannonFire,
    thermalImagingInstalled: thermalImagingInstalled,
    highExplosiveInstalled: highExplosiveInstalled,
    improvedApInstalled: improvedApInstalled,
    improvedCoolingInstalled: improvedCoolingInstalled,
    improvedPowerPackInstalled: improvedPowerPackInstalled,
    highPowerLaserInstalled: highPowerLaserInstalled,
    heavyRocketWarheadInstalled: heavyRocketWarheadInstalled,
    airburstRocketInstalled: airburstRocketInstalled,
    guidedWarheadInstalled: guidedWarheadInstalled,
    redAaAtgmInstalled: redAaAtgmInstalled,
    aaAtgmInstalled: redAaAtgmInstalled,
    depletedUraniumArmorInstalled: depletedUraniumArmorInstalled,
    burstLoadingInstalled: burstLoadingInstalled,
    depletedUraniumRoundInstalled: depletedUraniumRoundInstalled,
    burstLoadingFatigueProbability: burstLoadingFatigueProbability,
    burstLoadingFatigueRemaining: burstLoadingFatigueRemaining,
    burstLoadingRate: burstLoadingRate,
    burstLoadingAfterFire: burstLoadingAfterFire,
    burstLoadingHudShake: burstLoadingHudShake,
    burstLoadingTick: burstLoadingTick,
    lwsEmitTime: lwsEmitTime,
    lwsCooldownTime: lwsCooldownTime,
    redTdAimKind: redTdAimKind,
    redTdWeaponSpeed: redTdWeaponSpeed,
    redTdWeaponPen: redTdWeaponPen,
    redTdWeaponDamage: redTdWeaponDamage,
    resistanceMultiplier: resistanceMultiplier,
    gunLaunchedMissileInstalled: gunLaunchedMissileInstalled,
    fireControlLabel: fireControlLabel,
    scopeBallisticText: scopeBallisticText,
    hangarData: hangarData,
    hangarFireData: hangarFireData,
    redMbt2BasePen: redMbt2BasePen,
    blueMbt2BasePen: blueMbt2BasePen,
    mbt1ImprovedPen: mbt1ImprovedPen,
    battlefieldRepairInstalled: battleRepairInstalled,
    battlefieldRepairTick: battlefieldRepairTick,
    storageKey: STORAGE_KEY
  };
  window.vehicleTechInstalled = isInstalled;
  window.vehicleTechExperience = experience;
  window.vehicleTechAddExperience = addExperience;
  window.vehicleTechUnlockAndInstall = unlockAndInstall;
  window.vehicleTechBeginMatch = beginMatch;
  window.vehicleTechSettleMatch = settleMatch;
  window.vehicleTechUnlockCost = TECH_EXP_UNLOCK_COST;
  window.vehicleTechApplyToTank = applyToTank;
  window.vehicleTechBattlefieldRepairTick = battlefieldRepairTick;
  window.vehicleTechBattlefieldRepairHudTick = battlefieldRepairHudTick;
  window.vehicleTechResistanceMultiplier = resistanceMultiplier;
  window.vehicleTechGunLaunchedMissileInstalled = gunLaunchedMissileInstalled;
  window.vehicleTechThermalImagingInstalled = thermalImagingInstalled;
  window.vehicleTechHighExplosiveInstalled = highExplosiveInstalled;
  window.vehicleTechImprovedApInstalled = improvedApInstalled;
  window.vehicleTechImprovedCoolingInstalled = improvedCoolingInstalled;
  window.vehicleTechImprovedPowerPackInstalled = improvedPowerPackInstalled;
  window.vehicleTechHighPowerLaserInstalled = highPowerLaserInstalled;
  window.vehicleTechHeavyRocketWarheadInstalled = heavyRocketWarheadInstalled;
  window.vehicleTechBlueHeliHeavyRocketWarheadInstalled = blueHeliHeavyRocketWarheadInstalled;
  window.vehicleTechBlueHeliAutoCannonInstalled = blueHeliAutoCannonInstalled;
  window.vehicleTechBlueHeliDepletedUraniumRoundInstalled = blueHeliDepletedUraniumRoundInstalled;
  window.vehicleTechBlueHeliAutoCannonTarget = blueHeliAutoCannonTarget;
  window.vehicleTechBlueHeliAutoCannonTick = blueHeliAutoCannonTick;
  window.vehicleTechBlueHeliAutoCannonAim = blueHeliAutoCannonAim;
  window.vehicleTechBlueHeliAutoCannonFire = blueHeliAutoCannonFire;
  window.vehicleTechAirburstRocketInstalled = airburstRocketInstalled;
  window.vehicleTechGuidedWarheadInstalled = guidedWarheadInstalled;
  window.vehicleTechRedAaAtgmInstalled = redAaAtgmInstalled;
  window.vehicleTechAaAtgmInstalled = redAaAtgmInstalled;
  window.vehicleTechBurstLoadingInstalled = burstLoadingInstalled;
  window.vehicleTechDepletedUraniumRoundInstalled = depletedUraniumRoundInstalled;
  window.vehicleTechBurstLoadingFatigueProbability = burstLoadingFatigueProbability;
  window.vehicleTechBurstLoadingFatigueRemaining = burstLoadingFatigueRemaining;
  window.vehicleTechBurstLoadingRate = burstLoadingRate;
  window.vehicleTechBurstLoadingAfterFire = burstLoadingAfterFire;
  window.vehicleTechBurstLoadingHudShake = burstLoadingHudShake;
  window.vehicleTechBurstLoadingTick = burstLoadingTick;
  window.vehicleTechBurstLoadingHudTick = burstLoadingHudTick;
  window.vehicleTechLwsEmitTime = lwsEmitTime;
  window.vehicleTechLwsCooldownTime = lwsCooldownTime;
  window.vehicleTechRedTdAimKind = redTdAimKind;
  window.vehicleTechRedTdWeaponSpeed = redTdWeaponSpeed;
  window.vehicleTechRedTdWeaponPen = redTdWeaponPen;
  window.vehicleTechRedTdWeaponDamage = redTdWeaponDamage;
  window.vehicleTechFireControlLabel = fireControlLabel;
  window.vehicleTechScopeBallisticText = scopeBallisticText;
  window.vehicleTechHangarData = hangarData;
  window.vehicleTechHangarFireData = hangarFireData;
})(window);
