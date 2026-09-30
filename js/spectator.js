/* ============================================================
   观战模式(自定义战斗 · 观战模式 启用/关闭)
   参考业界成熟观战系统(CS2 / Valorant / 战争雷霆回放 / PUBG 观战):
   - 玩家席交给 AI(不操作任何载具,对局兵力/编制不变)
   - 两大模式:跟随(锁定某载具) / 自由视角(自由飞行相机)
   - 跟随视角三档:追随(可环绕) / 车长 / 战术俯视
   - 左键/右键切换下一个/上一个目标;目标被毁 → 击杀回放式自动切到击杀者
   - Tab 载具列表点选跟随;自由视角下 F 键跟随屏幕中心所指载具
   - 观战 HUD:模式、目标名称/阵营/耐久、操作提示;H 键隐藏界面(录屏用)
   - 移动端:单指拖动旋转,双指捏合缩放/前进,屏幕按钮切换
   本模块只接管相机与输入;模拟/AI/结算逻辑保持原状。
   ============================================================ */
var spectateEnabled = false;   // 自定义战斗菜单选项(持久化在 battleSettings)
var SPECTATE_MATCH = false;    // 本局是否为观战局(开局时由 DEPLOY 按钮写入)

(function () {
  'use strict';

  /* ---------- 菜单选项 ---------- */
  function spectateRow() { return document.getElementById('spectaterow'); }
  window.refreshSpectateUI = function () {
    var row = spectateRow();
    if (!row) return;
    var bs = row.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('sel', (bs[i].getAttribute('data-spectate') === 'on') === !!spectateEnabled);
  };
  function bindSpectateUI() {
    var row = spectateRow();
    if (!row || row.__specBound) return;
    row.__specBound = true;
    var defs = [['on', '启用'], ['off', '关闭']];
    // 样式与“控制区”行保持一致:复用 ensureOptionButtons 同款按钮 class
    var tpl = document.querySelector('#stylerow button');
    defs.forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = tpl ? tpl.className.replace(/\bsel\b/g, '').trim() : 'optbtn';
      b.setAttribute('data-spectate', d[0]);
      b.textContent = d[1];
      b.addEventListener('click', function () {
        spectateEnabled = d[0] === 'on';
        window.refreshSpectateUI();
        if (typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
      });
      row.appendChild(b);
    });
    window.refreshSpectateUI();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindSpectateUI);
  else bindSpectateUI();
  setTimeout(function () { bindSpectateUI(); window.refreshSpectateUI(); }, 0);

  /* ---------- 状态 ---------- */
  var MODE_FOLLOW = 'follow', MODE_FREE = 'free';
  var VIEWS = ['chase', 'cmdr', 'top'];
  var VIEW_NAMES = { chase: '追随视角', cmdr: '车长视角', top: '战术俯视' };
  var S = {
    mode: MODE_FOLLOW, view: 'chase', target: null,
    orbYaw: 0, orbPitch: 0.32, dist: 0, topH: 160,
    fx: 0, fy: 60, fz: 0, fYaw: 0, fPitch: -0.3, fSpeed: 1,
    killT: -1, killer: null, deadTarget: null,
    uiHidden: false, listOpen: false, lastInputT: 0,
    keys: {}, drag: false, lastX: 0, lastY: 0, inited: false,
    camPos: null, camTgt: null, touch: false
  };
  var TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.matchMedia && matchMedia('(pointer:coarse)').matches);
  S.touch = TOUCH;

  function active() { return SPECTATE_MATCH && typeof gameState !== 'undefined' && gameState === 'playing'; }
  function inMatch() { return SPECTATE_MATCH && typeof gameState !== 'undefined' && (gameState === 'playing' || gameState === 'paused'); }
  function now() { return performance.now() / 1000; }
  function alive(t) { return !!t && t.alive && t.group; }
  function isHeli(t) { return typeof isHeliVehicle === 'function' && isHeliVehicle(t); }
  function nameOf(t) { try { return typeof vehicleDisplayName === 'function' ? vehicleDisplayName(t) : (t.kind || '载具'); } catch (e) { return '载具'; } }
  function teamName(t) { return t.team === 'red' ? '红方' : '蓝方'; }
  function defaultDist(t) { return isHeli(t) ? 24 : 11; }
  function list() {
    var out = [];
    if (typeof aliveList === 'undefined') return out;
    for (var i = 0; i < aliveList.length; i++) if (alive(aliveList[i])) out.push(aliveList[i]);
    out.sort(function (a, b) { return a.team === b.team ? 0 : (a.team === 'red' ? -1 : 1); });
    return out;
  }
  function setTarget(t, keepView) {
    if (!alive(t)) return;
    S.target = t; S.deadTarget = null; S.killT = -1; S.killer = null;
    S.dist = defaultDist(t);
    S.orbYaw = 0; S.orbPitch = isHeli(t) ? 0.28 : 0.32;
    if (!keepView && S.view === 'cmdr' && isHeli(t)) S.view = 'chase';
    S.mode = MODE_FOLLOW;
    hudDirty = true;
  }
  function cycle(dir) {
    var L = list(); if (!L.length) return;
    var i = L.indexOf(S.target);
    i = i < 0 ? 0 : (i + dir + L.length) % L.length;
    setTarget(L[i], true);
  }
  function nearestTo(x, z, exclude) {
    var L = list(), best = null, bd = Infinity;
    for (var i = 0; i < L.length; i++) {
      if (L[i] === exclude) continue;
      var p = L[i].group.position, d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bd) { bd = d; best = L[i]; }
    }
    return best;
  }
  function lookedAt() {   // 自由视角:屏幕中心所指(夹角最小,距离加权)
    var L = list(), best = null, bs = Infinity;
    var fx = Math.sin(S.fYaw) * Math.cos(S.fPitch), fy = Math.sin(S.fPitch), fz = Math.cos(S.fYaw) * Math.cos(S.fPitch);
    for (var i = 0; i < L.length; i++) {
      var p = L[i].group.position, dx = p.x - camera.position.x, dy = p.y + 1.5 - camera.position.y, dz = p.z - camera.position.z;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      var cos = (dx * fx + dy * fy + dz * fz) / d;
      if (cos < 0.9) continue;
      var score = (1 - cos) * 40 + d / 3000;
      if (score < bs) { bs = score; best = L[i]; }
    }
    return best;
  }
  function toFree() {
    S.mode = MODE_FREE;
    S.fx = camera.position.x; S.fy = camera.position.y; S.fz = camera.position.z;
    var d = new THREE.Vector3(); camera.getWorldDirection(d);
    S.fYaw = Math.atan2(d.x, d.z); S.fPitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
    hudDirty = true;
  }
  function toFollow() {
    var t = (S.mode === MODE_FREE) ? (lookedAt() || nearestTo(camera.position.x, camera.position.z)) : null;
    if (!t) t = alive(S.target) ? S.target : nearestTo(camera.position.x, camera.position.z);
    if (t) setTarget(t, true);
  }
  function toggleMode() { if (S.mode === MODE_FREE) toFollow(); else toFree(); }
  function cycleView() {
    var i = VIEWS.indexOf(S.view);
    S.view = VIEWS[(i + 1) % VIEWS.length];
    if (S.view === 'cmdr' && isHeli(S.target)) S.view = 'top';
    if (S.mode === MODE_FREE) toFollow();
    hudDirty = true;
  }

  /* ---------- 开局初始化 ---------- */
  function initMatch() {
    S.inited = true; S.mode = MODE_FOLLOW; S.view = 'chase'; S.listOpen = false; S.killT = -1;
    S.camPos = new THREE.Vector3(); S.camTgt = new THREE.Vector3();
    var t = (typeof player !== 'undefined' && alive(player)) ? player : list()[0];
    if (t) setTarget(t);
    if (t) { S.camPos.set(t.group.position.x, t.group.position.y + 8, t.group.position.z - 12); camera.position.copy(S.camPos); }
    buildHud();
    document.body.classList.add('spectating');
    if (TOUCH) document.body.classList.add('spec-touch');
    hudDirty = true;
    toast(TOUCH ? '观战模式:拖动旋转 · 双指缩放 · 点「载具列表」切换目标/模式/视角' : '观战模式:左键/右键切换目标 · 空格 自由视角 · C 切换视角 · Tab 载具列表');
  }
  function endMatch() {
    S.inited = false;
    document.body.classList.remove('spectating', 'spec-touch', 'spec-ui-hidden', 'spec-free', 'spec-list-open'); S.listOpen = false; joyV.x = 0; joyV.y = 0;
    if (listEl) listEl.classList.add('hidden');
  }

  /* ---------- 相机 ---------- */
  var _v = null, _d = null;
  var K_FREE_BASE = 45;
  function terrainAt(x, z) { try { return terrainH(x, z); } catch (e) { return 0; } }
  function clampBounds(p, m) {
    var bX = (CONF.boundsX != null ? CONF.boundsX : CONF.bounds) + m, bZ = (CONF.boundsZ != null ? CONF.boundsZ : CONF.bounds) + m;
    p.x = Math.max(-bX, Math.min(bX, p.x)); p.z = Math.max(-bZ, Math.min(bZ, p.z));
  }
  function setFov(f) { if (Math.abs(camera.fov - f) > 0.05) { camera.fov = f; camera.updateProjectionMatrix(); } }

  function freeStep(dt) {
    var k = S.keys, sp = K_FREE_BASE * S.fSpeed * ((k.ShiftLeft || k.ShiftRight) ? 4 : 1);
    var f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    var r = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    var u = (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0);
    f += touchMove.f + joyV.y; r += touchMove.r + joyV.x;
    var cy = Math.cos(S.fYaw), sy = Math.sin(S.fYaw), cp = Math.cos(S.fPitch), spch = Math.sin(S.fPitch);
    S.fx += (sy * cp * f - cy * r) * sp * dt;
    S.fz += (cy * cp * f + sy * r) * sp * dt;
    S.fy += (spch * f + u) * sp * dt;
    touchMove.f = 0; touchMove.r = 0;
    var p = { x: S.fx, z: S.fz }; clampBounds(p, 300); S.fx = p.x; S.fz = p.z;
    var g = terrainAt(S.fx, S.fz) + 1.5; if (S.fy < g) S.fy = g;
    if (S.fy > 3000) S.fy = 3000;
    camera.position.set(S.fx, S.fy, S.fz);
    camera.up.set(0, 1, 0);
    _v.set(S.fx + sy * cp, S.fy + spch, S.fz + cy * cp);
    camera.lookAt(_v);
    setFov(62);
    shadowAt(S.fx + sy * 60, S.fz + cy * 60, 110);
  }

  function followStep(dt) {
    var t = S.target;
    if (!t || !t.group) { var n = list()[0]; if (n) setTarget(n); else return; t = S.target; }
    var p = t.group.position;
    var smooth = 1 - Math.pow(0.0008, dt);
    if (S.view === 'cmdr' && alive(t) && t.gunPivot) {
      t.gunPivot.getWorldPosition(_v);
      t.gunPivot.getWorldDirection(_d);
      var px = _v.x - _d.x * 1.2, py = _v.y + 1.1, pz = _v.z - _d.z * 1.2;
      camera.position.set(px, py, pz);
      camera.up.set(0, 1, 0);
      var yawL = Math.atan2(_d.x, _d.z) + S.orbYaw, pit = Math.asin(Math.max(-1, Math.min(1, _d.y))) - S.orbPitch * 0 + (S.cmdPitch || 0);
      _v.set(px + Math.sin(yawL) * Math.cos(pit) * 50, py + Math.sin(pit) * 50, pz + Math.cos(yawL) * Math.cos(pit) * 50);
      camera.lookAt(_v);
      setFov(45);
      shadowAt(p.x + _d.x * 60, p.z + _d.z * 60, 120);
      return;
    }
    if (S.view === 'top') {
      var h = S.topH;
      S.camPos.set(p.x, p.y + h, p.z + h * 0.18);
      camera.position.lerp(S.camPos, smooth);
      camera.up.set(0, 0, -1);
      S.camTgt.set(p.x, p.y, p.z);
      camera.lookAt(S.camTgt);
      setFov(55);
      shadowAt(p.x, p.z, Math.min(400, Math.max(90, h * 0.8)));
      return;
    }
    // 追随:默认在目标车体后方,鼠标可环绕;松手 3 秒后缓慢回正(业界“智能追随”)
    var baseYaw = t.yaw || 0;
    if (now() - S.lastInputT > 3) S.orbYaw *= Math.max(0, 1 - dt * 0.8);
    var yaw = baseYaw + S.orbYaw, pitch = Math.max(-0.2, Math.min(1.35, S.orbPitch));
    var tY = isHeli(t) ? 2.5 : 2.0;
    var cp = Math.cos(pitch);
    S.camPos.set(p.x - Math.sin(yaw) * cp * S.dist, p.y + tY + Math.sin(pitch) * S.dist, p.z - Math.cos(yaw) * cp * S.dist);
    var g = terrainAt(S.camPos.x, S.camPos.z) + 0.8; if (S.camPos.y < g) S.camPos.y = g;
    camera.position.lerp(S.camPos, smooth);
    camera.up.set(0, 1, 0);
    S.camTgt.set(p.x + Math.sin(yaw) * 6, p.y + tY, p.z + Math.cos(yaw) * 6);
    camera.lookAt(S.camTgt);
    setFov(62);
    shadowAt(p.x, p.z, 80 + S.dist);
  }

  /* 阴影视锥跟随观战焦点(原 cameraUpdate 以玩家为中心,观战时改为焦点) */
  var _shR = 0;
  function shadowAt(x, z, r) {
    if (typeof sunLight === 'undefined' || !sunLight || !sunOffset) return;
    r = Math.ceil(Math.min(500, Math.max(60, r)) / 20) * 20;
    var y = terrainAt(x, z);
    var sc = sunLight.shadow.camera;
    if (sc.right !== r) { sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.far = 400 + r * 2; sc.updateProjectionMatrix(); }
    var tex = (2 * r) / sunLight.shadow.mapSize.x;
    x = Math.round(x / tex) * tex; z = Math.round(z / tex) * tex;
    sunLight.position.set(x + sunOffset.x * 150, y + sunOffset.y * 150, z + sunOffset.z * 150);
    sunLight.target.position.set(x, y, z);
    sunLight.target.updateMatrixWorld();
  }

  function killWatch() {
    var t = S.target;
    if (S.mode !== MODE_FOLLOW || !t) return;
    if (!t.alive && S.killT < 0) {
      S.killT = now();
      var k = t.lastHitBy;
      S.killer = (k && k.group && k.alive) ? k : null;
      S.deadTarget = t;
      toast(nameOf(t) + '(' + teamName(t) + ')已被摧毁' + (S.killer ? ' · 击毁者:' + nameOf(S.killer) + '(' + teamName(S.killer) + ')' : ''));
    }
    if (S.killT >= 0 && now() - S.killT > 2.5) {
      var nx = alive(S.killer) ? S.killer : nearestTo(t.group.position.x, t.group.position.z, t);
      if (nx) setTarget(nx, true); else S.killT = now();
    }
  }

  var _origCameraUpdate = typeof cameraUpdate === 'function' ? cameraUpdate : null;
  var _lastCamT = 0;
  cameraUpdate = function (dt) {
    if (!active()) { if (_origCameraUpdate) return _origCameraUpdate(dt); return; }
    if (!S.inited) initMatch();
    if (!_v) { _v = new THREE.Vector3(); _d = new THREE.Vector3(); }
    dt = Math.min(0.1, Math.max(0, dt || 0.016));
    killWatch();
    if (S.mode === MODE_FREE) freeStep(dt); else followStep(dt);
    if (typeof camShake !== 'undefined') camShake = 0;
  };
  window.cameraUpdate = cameraUpdate;

  /* ---------- HUD ---------- */
  /* 光标素材:与 uifx-enhance.js 主界面同一 CUR_ARROW 箭头 */
  var SPEC_CUR_SVG = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' width='32' height='32'>" +
    "<polygon points='2,1 2,27 9,21 16,30 20,28 13,19 22,19' fill='#f4f0db' stroke='#101010' stroke-width='2.2' stroke-linejoin='miter'/>" +
    "<polygon points='5,6 5,21 9,17 14,25 16,24 11,16 17,16' fill='#15181c'/></svg>";
  var SPEC_CURSOR = 'url("data:image/svg+xml,' + encodeURIComponent(SPEC_CUR_SVG) + '") 2 1, auto';
  var hudEl = null, listEl = null, toastEl = null, touchEl = null, hudDirty = true;
  var CSS = '' +
    'body.spectating #vehicle-tech-status-hud,body.spectating #battle-repair-hud,body.spectating #control-zone-repair-hud,' +
    'body.spectating #aimdot,body.spectating #helipitchinfo,body.spectating #helimissileinfol,body.spectating #helimissileinfor,' +
    'body.spectating #aimhint,body.spectating #rwr-warning,body.spectating #maws-edge-flash,body.spectating #maws-hud-layer,' +
    'body.spectating #lwr-hud-layer,body.spectating #boundwarn,body.spectating #abandonring,body.spectating #sqarrows,' +
    'body.spectating #ch,body.spectating #ringbk,body.spectating #ring,body.spectating #lwsring,body.spectating #chRkL,body.spectating #chRkR,' +
    'body.spectating #hitm,body.spectating #lockhint,body.spectating #heliweaponbar,body.spectating #heliradarlock,body.spectating #heliradarboxes,' +
    'body.spectating #heliradarmfd,body.spectating #nvd,body.spectating #scope,body.spectating #scopedial,body.spectating #scoperet,' +
    'body.spectating #rangeinfo,body.spectating #artyring,body.spectating #artyringtxt,body.spectating #impact,body.spectating #impactRkL,' +
    'body.spectating #impactRkR,body.spectating #mods,body.spectating #phud3d,body.spectating #flash,body.spectating #respawnov,body.spectating #possessov,' +
    'body.spectating #tsense,body.spectating #tjoy,body.spectating #theliu,body.spectating #thelid,body.spectating #tth,body.spectating #tnv,' +
    'body.spectating #tsqb,body.spectating #tcap,body.spectating #tfol,body.spectating #tfire,body.spectating #tscope,body.spectating #tlas,body.spectating #tcustomov,body.spectating #tquit,' +
    'body.spectating #powerup-hud{display:none!important}' +
    '#spec-hud{position:fixed;left:50%;top:54px;transform:translateX(-50%);z-index:60;pointer-events:none;display:none;' +
      'font:13px/1.35 "Microsoft YaHei","PingFang SC",sans-serif;color:#dfffd8;text-align:center}' +
    'body.spectating #spec-hud{display:block}' +
    'body.spec-ui-hidden #spec-hud,body.spec-ui-hidden #spec-list,body.spec-ui-hidden #spec-bar{display:none!important}' +
    '#spec-hud .sp-box{display:inline-block;min-width:260px;background:rgba(14,20,14,.82);border:1px solid rgba(157,255,168,.45);' +
      'border-radius:4px;padding:6px 14px 7px;box-shadow:0 2px 10px rgba(0,0,0,.45)}' +
    '#spec-hud .sp-tag{display:inline-block;background:#9dffa8;color:#10200f;font-weight:bold;padding:0 6px;border-radius:2px;margin-right:6px;letter-spacing:1px}' +
    '#spec-hud .sp-mode{color:#b9d9b3}' +
    '#spec-hud .sp-name{font-size:17px;font-weight:bold;margin-top:3px}' +
    '#spec-hud .sp-name.red{color:#ff7a66}#spec-hud .sp-name.blue{color:#6fb6ff}' +
    '#spec-hud .sp-hp{height:5px;background:rgba(255,255,255,.12);margin:4px auto 0;width:220px;border-radius:3px;overflow:hidden}' +
    '#spec-hud .sp-hp i{display:block;height:100%;background:#9dffa8;width:100%;transition:width .2s}' +
    '#spec-hud .sp-hint{margin-top:6px;font-size:11.5px;color:#a9c8a3;text-shadow:0 1px 2px #000}' +
    'body.spec-touch #spec-hud .sp-hint{display:none}' +
    '#spec-toast{position:fixed;left:50%;top:150px;transform:translateX(-50%);z-index:61;pointer-events:none;background:rgba(14,20,14,.85);' +
      'color:#fff2b0;font:13px "Microsoft YaHei",sans-serif;padding:5px 12px;border-radius:4px;opacity:0;transition:opacity .3s;max-width:80vw}' +
    '#spec-list{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:70;width:min(720px,94vw);max-height:78vh;' +
      'background:rgba(12,18,12,.94);border:1px solid rgba(157,255,168,.5);border-radius:6px;padding:10px 12px;color:#dfffd8;' +
      'font:13px "Microsoft YaHei",sans-serif;display:flex;flex-direction:column}' +
    '#spec-list.hidden{display:none}' +
    '#spec-list .sl-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:bold;font-size:15px}' +
    '#spec-list .sl-cols{display:flex;gap:10px;overflow:auto;min-height:0}' +
    '#spec-list .sl-col{flex:1;min-width:0}' +
    '#spec-list .sl-col h4{margin:0 0 5px;font-size:13px}#spec-list .sl-col.red h4{color:#ff7a66}#spec-list .sl-col.blue h4{color:#6fb6ff}' +
    '#spec-list button{display:flex;justify-content:space-between;width:100%;margin:0 0 3px;padding:4px 8px;background:rgba(255,255,255,.05);' +
      'border:1px solid rgba(255,255,255,.08);color:#dfffd8;font:12.5px "Microsoft YaHei",sans-serif;cursor:pointer;border-radius:3px;text-align:left}' +
    '#spec-list button:hover{background:rgba(157,255,168,.18)}#spec-list button.cur{border-color:#9dffa8;background:rgba(157,255,168,.22)}' +
    '#spec-list .sl-close{width:auto;display:inline-block;margin:0}' +
    '#spec-bar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:62;display:none;gap:8px}' +
    'body.spectating #spec-bar{display:flex}' +
    '#spec-bar button{min-width:64px;height:40px;padding:0 10px;background:rgba(14,20,14,.82);border:1px solid rgba(157,255,168,.5);color:#dfffd8;' +
      'font:13px "Microsoft YaHei",sans-serif;border-radius:4px;touch-action:manipulation;cursor:pointer}' +
    '#spec-bar button:active{background:rgba(157,255,168,.3)}' +
    'body.spectating:not(.spec-touch) #spec-bar{bottom:10px;opacity:.85}' +
    '#spec-touch{position:fixed;inset:0;z-index:5;display:none;touch-action:none}' +
    '#spec-bar kbd,#spec-list kbd{display:inline-block;min-width:16px;margin-right:6px;padding:0 4px;border:1px solid rgba(157,255,168,.6);border-radius:3px;' +
      'font:bold 11px/16px monospace;color:#9dffa8;background:rgba(0,0,0,.35)}' +
    'body.spec-touch #spec-bar button:not([data-act="4"]){display:none}' +
    '#spec-list .sl-ctl{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}' +
    '#spec-list .sl-ctl button{width:auto;flex:1;justify-content:center;min-width:90px;padding:6px 8px}' +
    '#spec-joy{position:fixed;left:26px;bottom:26px;width:130px;height:130px;border-radius:50%;z-index:63;display:none;touch-action:none;' +
      'background:rgba(14,20,14,.45);border:2px solid rgba(157,255,168,.45)}' +
    '#spec-joy i{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;background:rgba(157,255,168,.55);' +
      'border:2px solid rgba(220,255,220,.8);pointer-events:none}' +
    'body.spectating.spec-touch.spec-free:not(.spec-list-open) #spec-joy{display:block}' +
    'body.spec-ui-hidden #spec-joy{display:none!important}' +
    'body.spec-list-open canvas,body.spec-list-open #spec-list,body.spec-list-open #spec-list *,#spec-bar button{cursor:' + SPEC_CURSOR + ' !important}' +
    'body.spec-touch.spectating #spec-touch{display:block}' +
    '@media (max-height:500px){#spec-hud{top:40px}#spec-hud .sp-box{min-width:200px;padding:4px 10px}#spec-hud .sp-name{font-size:15px}#spec-bar button{height:34px;min-width:54px;font-size:12px}}';

  var BAR_ACTIONS = [function () { cycle(-1); }, toggleMode, cycleView, toggleList, function () { cycle(1); }];
  var BAR_LABELS = ['◀ 上一个', null, '切换视角', '载具列表', '下一个 ▶'];
  var modeBtns = [], joyEl = null;
  function modeLabel() { return S.mode === MODE_FREE ? '自由' : '跟随'; }
  function makeCtlButtons(parent, withKeys, skipList) {
    BAR_ACTIONS.forEach(function (fn, i) {
      if (skipList && i === 3) return;
      var b = document.createElement('button'); b.type = 'button';
      b.setAttribute('data-act', String(i + 1));
      b.innerHTML = (withKeys ? '<kbd>' + (i + 1) + '</kbd>' : '') + '<span></span>';
      b.lastChild.textContent = BAR_LABELS[i] || modeLabel();
      if (i === 1) modeBtns.push(b.lastChild);
      b.addEventListener('click', function (e) { e.stopPropagation(); S.lastInputT = now(); fn(); });
      parent.appendChild(b);
    });
  }
  function buildHud() {
    if (hudEl) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    hudEl = document.createElement('div'); hudEl.id = 'spec-hud';
    hudEl.innerHTML = '<div class="sp-box"><div><span class="sp-tag">观战</span><span class="sp-mode"></span></div>' +
      '<div class="sp-name"></div><div class="sp-hp"><i></i></div></div>' +
      '<div class="sp-hint">左键/右键 切换目标 · 空格/V 跟随/自由 · C 切换视角 · Tab 载具列表(显示光标) · 1~5 底部按钮 · 滚轮 距离/速度 · H 隐藏界面</div>';
    document.body.appendChild(hudEl);
    toastEl = document.createElement('div'); toastEl.id = 'spec-toast'; document.body.appendChild(toastEl);
    listEl = document.createElement('div'); listEl.id = 'spec-list'; listEl.className = 'hidden'; document.body.appendChild(listEl);
    var bar = document.createElement('div'); bar.id = 'spec-bar';
    makeCtlButtons(bar, true);
    document.body.appendChild(bar);
    joyEl = document.createElement('div'); joyEl.id = 'spec-joy'; joyEl.innerHTML = '<i></i>';
    document.body.appendChild(joyEl); bindJoy(joyEl);
    touchEl = document.createElement('div'); touchEl.id = 'spec-touch'; document.body.appendChild(touchEl);
    bindTouch(touchEl);
  }
  var toastT = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.style.opacity = '1';
    if (toastT) clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.style.opacity = '0'; }, 3500);
  }
  function hudTick() {
    if (!hudEl) return;
    var ml = modeLabel();
    for (var mi = 0; mi < modeBtns.length; mi++) if (!modeBtns[mi].isConnected) { modeBtns.splice(mi, 1); mi--; } else if (modeBtns[mi].textContent !== ml) modeBtns[mi].textContent = ml;
    document.body.classList.toggle('spec-free', S.mode === MODE_FREE);
    var t = S.target;
    var modeTxt = S.mode === MODE_FREE ? '自由视角' + (S.fSpeed !== 1 ? ' · 速度×' + S.fSpeed.toFixed(1) : '') : '跟随 · ' + VIEW_NAMES[S.view];
    var mEl = hudEl.querySelector('.sp-mode'); if (mEl.textContent !== modeTxt) mEl.textContent = modeTxt;
    var nEl = hudEl.querySelector('.sp-name'), hp = hudEl.querySelector('.sp-hp');
    if (S.mode === MODE_FOLLOW && t) {
      var txt = nameOf(t) + ' · ' + teamName(t) + (t.alive ? '' : ' · 已被摧毁');
      if (nEl.textContent !== txt) nEl.textContent = txt;
      nEl.className = 'sp-name ' + (t.team === 'red' ? 'red' : 'blue');
      var f = t.alive && t.structMax ? Math.max(0, Math.min(1, t.struct / t.structMax)) : 0;
      hp.style.display = ''; hp.firstChild.style.width = (f * 100).toFixed(0) + '%';
      hp.firstChild.style.background = f > 0.5 ? '#9dffa8' : (f > 0.25 ? '#ffd35a' : '#ff6a4d');
    } else {
      var n = list().length;
      var t2 = '在场载具 ' + n + ' 台';
      if (nEl.textContent !== t2) nEl.textContent = t2;
      nEl.className = 'sp-name'; hp.style.display = 'none';
    }
  }

  /* ---------- 载具列表 ---------- */
  var listT = 0;
  function toggleList() {
    S.listOpen = !S.listOpen;
    if (!listEl) return;
    listEl.classList.toggle('hidden', !S.listOpen);
    document.body.classList.toggle('spec-list-open', S.listOpen);
    if (!S.listOpen && !TOUCH && !document.pointerLockElement && typeof attemptLock === 'function') { try { attemptLock(); } catch (eL) {} }
    if (S.listOpen) {
      renderList();
      if (typeof document.exitPointerLock === 'function' && document.pointerLockElement) { window._pointerPauseArmed = false; document.exitPointerLock(); }
    }
  }
  function renderList() {
    if (!listEl || !S.listOpen) return;
    var L = list(), cols = { red: [], blue: [] };
    for (var i = 0; i < L.length; i++) (cols[L[i].team] || cols.blue).push(L[i]);
    listEl.innerHTML = '';
    var head = document.createElement('div'); head.className = 'sl-head';
    head.innerHTML = '<span>载具列表(点击跟随)</span>';
    var cb = document.createElement('button'); cb.className = 'sl-close'; cb.type = 'button'; cb.textContent = '关闭';
    cb.addEventListener('click', toggleList); head.appendChild(cb); listEl.appendChild(head);
    var ctl = document.createElement('div'); ctl.className = 'sl-ctl';
    makeCtlButtons(ctl, !TOUCH, true);
    listEl.appendChild(ctl);
    var wrap = document.createElement('div'); wrap.className = 'sl-cols';
    ['red', 'blue'].forEach(function (tm) {
      var col = document.createElement('div'); col.className = 'sl-col ' + tm;
      col.innerHTML = '<h4>' + (tm === 'red' ? '红方' : '蓝方') + ' · ' + cols[tm].length + ' 台</h4>';
      cols[tm].slice(0, 120).forEach(function (t) {
        var b = document.createElement('button'); b.type = 'button';
        if (t === S.target && S.mode === MODE_FOLLOW) b.className = 'cur';
        var hpP = t.structMax ? Math.round(100 * Math.max(0, t.struct) / t.structMax) : 100;
        b.innerHTML = '<span></span><span>' + hpP + '%</span>';
        b.firstChild.textContent = nameOf(t) + (t === player ? '(原玩家席)' : '');
        b.addEventListener('click', function () { setTarget(t, true); toggleList(); });
        col.appendChild(b);
      });
      wrap.appendChild(col);
    });
    listEl.appendChild(wrap);
  }

  /* ---------- 输入(捕获阶段拦截,游戏原有载具操作在观战局内全部失效) ---------- */
  var BLOCK = /^(Key[WASDQECVFHRGBJNLKXZ]|Space|Tab|Shift(Left|Right)|Control(Left|Right)|Arrow\w+|Backspace|Digit\d|Numpad\d)$/;
  function uiTarget(e) {
    var t = e.target;
    return !!(t && t.closest && t.closest('button,input,select,textarea,#spec-list,#spec-bar,#pauseov,#endov,#tmenu,.menuview'));
  }
  window.addEventListener('keydown', function (e) {
    if (!active() || uiTarget(e)) return;
    if (!BLOCK.test(e.code)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    S.keys[e.code] = true;
    if (e.repeat) return;
    S.lastInputT = now();
    switch (e.code) {
      case 'Space': case 'KeyV': toggleMode(); break;
      case 'KeyC': cycleView(); break;
      case 'Tab': toggleList(); break;
      case 'Escape': if (S.listOpen) toggleList(); break;
      case 'KeyH': S.uiHidden = !S.uiHidden; document.body.classList.toggle('spec-ui-hidden', S.uiHidden); break;
      case 'KeyF': if (S.mode === MODE_FREE) { var lt = lookedAt(); if (lt) setTarget(lt, true); } break;
      case 'KeyR': if (S.mode === MODE_FOLLOW) { S.orbYaw = 0; S.orbPitch = 0.32; if (S.target) S.dist = defaultDist(S.target); S.cmdPitch = 0; } break;
      case 'ArrowRight': case 'KeyD': case 'KeyE': if (S.mode === MODE_FOLLOW) cycle(1); break;
      case 'ArrowLeft': case 'KeyA': case 'KeyQ': if (S.mode === MODE_FOLLOW) cycle(-1); break;
    }
    var dg = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
    if (dg && BAR_ACTIONS[+dg[1] - 1]) BAR_ACTIONS[+dg[1] - 1]();
  }, true);
  window.addEventListener('keyup', function (e) { S.keys[e.code] = false; }, true);
  window.addEventListener('blur', function () { S.keys = {}; S.drag = false; });

  function rotate(dx, dy) {
    S.lastInputT = now();
    var sens = 0.0028;
    if (S.mode === MODE_FREE) {
      S.fYaw -= dx * sens; S.fPitch = Math.max(-1.5, Math.min(1.5, S.fPitch - dy * sens));
    } else if (S.view === 'cmdr') {
      S.orbYaw -= dx * sens; S.cmdPitch = Math.max(-0.8, Math.min(0.8, (S.cmdPitch || 0) - dy * sens));
    } else if (S.view === 'chase') {
      S.orbYaw -= dx * sens; S.orbPitch = Math.max(-0.2, Math.min(1.35, S.orbPitch + dy * sens));
    }
  }
  window.addEventListener('mousedown', function (e) {
    if (!active() || uiTarget(e)) return;
    if (typeof isGhostMouse === 'function' && isGhostMouse(e)) { e.stopImmediatePropagation(); return; }
    e.preventDefault(); e.stopImmediatePropagation();
    if (S.listOpen) return;   // 列表打开期间:光标自由点选,不锁定不切换
    S.drag = true; S.lastX = e.clientX; S.lastY = e.clientY; S._moved = 0;
    if (!document.pointerLockElement) {
      if (typeof attemptLock === 'function') { try { attemptLock(); } catch (e2) {} }
      S._clickNoSwitch = true;   // 首次点击只收回光标
      return;
    }
    S._clickNoSwitch = false;
    if (S.mode === MODE_FOLLOW) cycle(e.button === 2 ? -1 : 1);
    else if (e.button === 0) { var lt = lookedAt(); if (lt) setTarget(lt, true); }
  }, true);
  window.addEventListener('mouseup', function (e) {
    if (!active()) return;
    S.drag = false;
  }, true);
  window.addEventListener('mousemove', function (e) {
    if (!active()) return;
    if (document.pointerLockElement) { rotate(e.movementX || 0, e.movementY || 0); e.stopImmediatePropagation(); }
    else if (S.drag) { rotate(e.clientX - S.lastX, e.clientY - S.lastY); S.lastX = e.clientX; S.lastY = e.clientY; e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('wheel', function (e) {
    if (!active() || uiTarget(e)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    zoom(e.deltaY > 0 ? 1 : -1);
  }, { capture: true, passive: false });
  function zoom(dir) {
    S.lastInputT = now();
    if (S.mode === MODE_FREE) { S.fSpeed = Math.max(0.2, Math.min(8, S.fSpeed * (dir > 0 ? 0.8 : 1.25))); }
    else if (S.view === 'top') S.topH = Math.max(40, Math.min(1500, S.topH * (dir > 0 ? 1.15 : 0.87)));
    else if (S.view === 'chase') S.dist = Math.max(4, Math.min(120, S.dist * (dir > 0 ? 1.12 : 0.89)));
  }

  /* ---------- 触控 ---------- */
  var touchMove = { f: 0, r: 0 }, joyV = { x: 0, y: 0 };
  function bindJoy(el) {
    var id = null, cx = 0, cy = 0, R = 50, knob = el.firstChild;
    function set(x, y) {
      var dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1, k = Math.min(1, R / d);
      dx *= k; dy *= k;
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      joyV.x = dx / R; joyV.y = -dy / R;
    }
    el.addEventListener('touchstart', function (e) {
      e.preventDefault(); e.stopPropagation();
      var t = e.changedTouches[0], r = el.getBoundingClientRect();
      id = t.identifier; cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width * 0.36; set(t.clientX, t.clientY);
    }, { passive: false });
    el.addEventListener('touchmove', function (e) {
      e.preventDefault(); e.stopPropagation();
      for (var i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].identifier === id) set(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
    }, { passive: false });
    function end(e) {
      for (var i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].identifier === id) {
        id = null; joyV.x = 0; joyV.y = 0; knob.style.transform = '';
      }
    }
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  }
  function bindTouch(el) {
    var pts = {}, lastPinch = 0, lastMid = null;
    function arr() { var a = []; for (var k in pts) a.push(pts[k]); return a; }
    el.addEventListener('touchstart', function (e) {
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) { var t = e.changedTouches[i]; pts[t.identifier] = { x: t.clientX, y: t.clientY }; }
      var a = arr(); lastPinch = a.length >= 2 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0;
      lastMid = a.length >= 2 ? { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 } : null;
    }, { passive: false });
    el.addEventListener('touchmove', function (e) {
      e.preventDefault();
      if (!active()) return;
      var a0 = arr();
      if (a0.length === 1 && e.touches.length === 1) {
        var t = e.touches[0], p = pts[t.identifier];
        if (p) { rotate((t.clientX - p.x) * 1.4, (t.clientY - p.y) * 1.4); p.x = t.clientX; p.y = t.clientY; }
        return;
      }
      for (var i = 0; i < e.touches.length; i++) { var tt = e.touches[i]; if (pts[tt.identifier]) { pts[tt.identifier].x = tt.clientX; pts[tt.identifier].y = tt.clientY; } }
      var a = arr();
      if (a.length >= 2) {
        var d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), mid = { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 };
        var dd = d - lastPinch;
        if (S.mode === MODE_FREE) {
          touchMove.f += dd * 0.6;
          if (lastMid) { touchMove.r -= (mid.x - lastMid.x) * 0.5; S.fy -= (mid.y - lastMid.y) * 0.4 * S.fSpeed; }
        } else if (Math.abs(dd) > 2) {
          var k = dd > 0 ? 0.97 : 1.03;
          if (S.view === 'top') S.topH = Math.max(40, Math.min(1500, S.topH * k));
          else S.dist = Math.max(4, Math.min(120, S.dist * k));
        }
        lastPinch = d; lastMid = mid;
      }
    }, { passive: false });
    function end(e) {
      for (var i = 0; i < e.changedTouches.length; i++) delete pts[e.changedTouches[i].identifier];
      var a = arr(); lastPinch = a.length >= 2 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0; lastMid = null;
    }
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
  }

  /* ---------- 帧循环:开局/结束检测、HUD 刷新 ---------- */
  var hudT = 0;
  function loop() {
    requestAnimationFrame(loop);
    if (inMatch()) {
      if (!S.inited && active()) initMatch();
      if (S.inited) {
        var n = performance.now();
        if (n - hudT > 120) { hudT = n; hudTick(); }
        if (S.listOpen && n - listT > 1000) { listT = n; renderList(); }
      }
    } else if (S.inited) endMatch();
  }
  requestAnimationFrame(loop);

  window.Spectator = { state: S, cycle: cycle, toggleMode: toggleMode, cycleView: cycleView, setTarget: setTarget, active: active };
})();
