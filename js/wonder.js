
/* ===== Module: wonder.js ===== */
/* ============================================================
   模块: wonder.js — 奇观地形:多奇观注册表/种子布点/粗格烘焙/HQ 布局/HQ 夷平/连通性验证
   (加载顺序: core.js 之后(scene.js 之前);运行时依赖 ai_nav.js 的 navGridBuild/_asStart/_asStep,
    仅验证器调用,无加载期依赖。设计见 wonder_design/奇观地形与石质材质集成技术方案.md)
   ============================================================ */
'use strict';
/* 总述:奇观 = 烘焙进 tbLat 的加性高度层。wonderBuild() 在 buildTerrainBaseTable 开头执行,
   种子布点 → 粗网格(wLat,步长=GRID_CELL×4)求值;terrainBase() 内 wonderAt() 双线性上采样,
   与中心地形同包络((1-fade))、独立缩放 wonderScale(0 崎岖 0.30 起,与基底解耦)。HQ 夷平是烘焙后遍。全部建场期完成,
   运行时零开销。粗格求值 + 包围盒早退:浏览器建场增量约 +0.4s(§8)。 */

/* —— §1 包裹晶格值噪声(奇观 fbm/ridged 专用)——
   自包含小晶格(C1 smoothstep 插值,无格线断裂),不碰地形 B 样条三层缓存(_bcArr 结构不动,
   回归面最小)。确定性:晶格由种子流填充;求值期只读。
   注:方案 §4.5.1 原定"改吃 bzField 系",实施改为独立晶格(见文档末实施修订 R1)。 */
function wLatNew(P, seed) {
  var L = new Float32Array(P * P), rnd = mulberry32(seed >>> 0);
  for (var i = 0; i < P * P; i++) L[i] = rnd();
  return L;
}
function wNoiseAt(L, P, x, z) {        // 包裹寻址:世界坐标可正可负,晶格无限周期延拓
  var xi = Math.floor(x), zi = Math.floor(z);
  var xf = x - xi, zf = z - zi;
  xf = xf * xf * (3 - 2 * xf); zf = zf * zf * (3 - 2 * zf);
  var x0 = ((xi % P) + P) % P, z0 = ((zi % P) + P) % P;
  var x1 = (x0 + 1) % P, z1 = (z0 + 1) % P;
  var a = L[z0 * P + x0], b = L[z0 * P + x1], c = L[z1 * P + x0], d = L[z1 * P + x1];
  return (a + (b - a) * xf) * (1 - zf) + (c + (d - c) * xf) * zf;
}
function wFbm(L, P, x, z, oct) {
  var a = 0.5, f = 1, s = 0, n = 0;
  for (var i = 0; i < oct; i++) { s += a * wNoiseAt(L, P, x * f, z * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
function wRidged(L, P, x, z, oct) {    // 脊棱多重分形(0..1):奇观嶙峋感来源
  var a = 0.55, f = 1, s = 0, n = 0;
  for (var i = 0; i < oct; i++) {
    var v = 1 - Math.abs(2 * wNoiseAt(L, P, x * f, z * f) - 1); v *= v;
    s += a * v; n += a; a *= 0.5; f *= 2.13;
  }
  return s / n;
}
var _wLatA = null, _wLatB = null, _wLatC = null, _wLatP = 64;   // 当前构建的晶格(求值期只读)

/* —— §2 类型注册表:每类 = 参数构造 + 求值 + 包围半径(烘焙早退用)——
   水平量纲按 k=side/2000 缩放(演示按 2km 调参);高度绝对值(玩法:坡度是绝对量)。 */
var WONDER_TYPES = {
  heroPeak: { make: wHeroParams, eval: wHeroEval, bound: wHeroBound },
  ridge: { make: wRidgeParams, eval: wRidgeEval, bound: wRidgeBound },
  caldera: { make: wCalderaParams, eval: wCalderaEval, bound: wCalderaBound },
  pillar: { make: wPillarParams, eval: wPillarEval, bound: wPillarBound }
  /* 四形式全注册(2026-09-09 任务二;caldera/pillar 公式见方案 §4.6) */
};
function wHeroParams(rnd, k, cx, cz) {
  return { type: 'heroPeak', x: cx, z: cz,
    peakH: ((130 + rnd() * 90) + (40 + rnd() * 45)) * 0.9,   // 153~275m(演示原值)
    sigB: 170 * k, sigS: 62 * k,                              // 双高斯 σ(底座/峰顶)
    ph1: rnd() * 40, ph2: rnd() * 40 };                       // 嶙峋相位(破除跨峰重复)
}
function wHeroEval(W, x, z, k) {
  var dx = x - W.x, dz = z - W.z, d2 = dx * dx + dz * dz;
  var env = 0.62 * Math.exp(-d2 / (2 * W.sigB * W.sigB)) + 0.38 * Math.exp(-d2 / (2 * W.sigS * W.sigS));
  if (env <= 0.004) return 0;                                 // 早退:包围半径 ≈3.2σb
  var detail = 0.72 + 0.56 * wRidged(_wLatC, _wLatP, x * 0.02 / k + W.ph1 + 3.1, z * 0.02 / k + W.ph2 + 7.7, 3);
  return W.peakH * env * detail;
}
function wHeroBound(W) { return 3.2 * W.sigB; }
function wRidgeParams(rnd, k, cx, cz) {
  var rot = rnd() * Math.PI;                                  // 走向(0..π,轴向无向)
  return { type: 'ridge', x: cx, z: cz, rot: rot,
    cA: Math.cos(rot), sA: Math.sin(rot), axLen: 0.42 * MAP.side,
    ph1: rnd() * 40, ph2: rnd() * 40, ph3: rnd() * 40, ph4: rnd() * 40, ph5: rnd() * 40 };
}
function wRidgeEval(W, x, z, k) {
  var dx = x - W.x, dz = z - W.z;
  var s = dx * W.cA + dz * W.sA;                              // 轴向
  if (s < -W.axLen || s > W.axLen) return 0;
  var t = -dx * W.sA + dz * W.cA;                             // 横向
  var P = _wLatP;
  var rl = (wFbm(_wLatA, P, s * 0.0016 / k + W.ph1 + 3.7, W.ph1 * 0.13, 3) - 0.5) * 620 * k
         + (wFbm(_wLatA, P, s * 0.0042 / k + W.ph2 + 11.2, 7.7, 2) - 0.5) * 260 * k;   // 脊线游走 ±440k
  var crestN = wFbm(_wLatB, P, s * 0.0021 / k + W.ph3 + 4.9, 2.2, 3);
  var wideN = wFbm(_wLatB, P, s * 0.0013 / k + W.ph4 + 8.8, 5.5, 2);
  var u = (t - rl) / ((95 + wideN * 150) * k);
  if (u > 3.2 || u < -3.2) return 0;                          // 早退:贡献 < e^-13.8
  var crag = 0.55 + 0.9 * wRidged(_wLatC, P, x * 0.012 / k + W.ph5, z * 0.012 / k, 3);
  return (34 + crestN * 78) * Math.exp(-u * u * 1.35) * crag;
}
function wRidgeBound(W, k) { return { ax: W.axLen, tr: (3.2 * 245 + 440) * k }; }   // 横向含脊线游走
function wCalderaParams(rnd, k, cx, cz) {   // 破火山口:环形缘丘+中心沉降+缺口(方案 §4.6)
  return { type: 'caldera', x: cx, z: cz,
    rimR: (120 + rnd() * 80) * k, rimW: (25 + rnd() * 15) * k, rimH: 40 + rnd() * 40,
    bowlD: 20 + rnd() * 30, gapA: rnd() * Math.PI * 2 };
}
function wCalderaEval(W, x, z, k) {
  var dx = x - W.x, dz = z - W.z, d = Math.sqrt(dx * dx + dz * dz);
  var u = (d - W.rimR) / W.rimW, rim = 0;
  if (u < 3.2 && u > -3.2) {
    rim = Math.exp(-u * u) * W.rimH;
    var ang = Math.atan2(dz, dx);
    var da = Math.abs(((ang - W.gapA + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (da < 0.4363) rim *= 0.25;   // 缺口 ±25°:rim×0.25 留出入口
  }
  var bowl = 0;
  if (d < W.rimR) { var t = d / W.rimR, s = t * t * (3 - 2 * t); bowl = -W.bowlD * (1 - s); }
  if (rim === 0 && bowl === 0) return 0;
  var detail = 0.8 + 0.4 * wRidged(_wLatC, _wLatP, x * 0.015 / k + W.gapA, z * 0.015 / k, 2);
  return rim * detail + bowl;
}
function wCalderaBound(W) { return W.rimR + 3.2 * W.rimW; }
function wPillarParams(rnd, k, cx, cz) {   // 孤柱:窄陡锥+基座裙(方案 §4.6)
  return { type: 'pillar', x: cx, z: cz,
    topH: 60 + rnd() * 60, sigB: (30 + rnd() * 20) * k, sigT: (10 + rnd() * 8) * k,
    skirtH: 8 + rnd() * 10, skirtS: (80 + rnd() * 40) * k, ph1: rnd() * 40, ph2: rnd() * 40 };
}
function wPillarEval(W, x, z, k) {
  var dx = x - W.x, dz = z - W.z, d2 = dx * dx + dz * dz;
  var env = 0.55 * Math.exp(-d2 / (2 * W.sigB * W.sigB)) + 0.45 * Math.exp(-d2 / (2 * W.sigT * W.sigT));
  if (env <= 0.004 && d2 > 9 * W.skirtS * W.skirtS) return 0;
  var detail = 0.75 + 0.5 * wRidged(_wLatC, _wLatP, x * 0.03 / k + W.ph1, z * 0.03 / k + W.ph2, 2);
  var skirt = W.skirtH * Math.exp(-d2 / (2 * W.skirtS * W.skirtS));
  return W.topH * env * detail + skirt;
}
function wPillarBound(W) { return 3.2 * W.skirtS; }

/* —— §3 布点 + 粗格烘焙 —— */
var wLat = null, wLatN = 0, wLatStep = 0, wLatOX = 0, wLatOZ = 0;   // 粗格原点=(-halfW,-halfL)
function wonderCounts(side) {          // Q2 拍板:保守封顶 3 峰+2 脊;2km 基准 2 峰+1 脊(总数口径沿用,类型洗牌见 wonderBuild)
  var a = (side / 2000) * (side / 2000);
  var nP = Math.round(2 * a); if (nP < 1) nP = 1; else if (nP > 3) nP = 3;
  var nR = Math.round(1 * a); if (nR < 0) nR = 0; else if (nR > 2) nR = 2;
  return { peak: nP, ridge: nR };
}
function wonderScale(r) {   // 奇观独立缩放(与基底解耦):0 崎岖=0.30 丘陵级地标,≥75 满幅;负崎岖对称
  var a = Math.abs(r || 0) / 75; if (a > 1) a = 1;
  var s = a * a * (3 - 2 * a);
  return 0.30 + 0.70 * s;
}
function wonderBuild() {
  var seed = String(MAP.seed), salt = MAP.wonderSalt || '';
  var rnd = mulberry32(hashSeed(seed + '|wonder' + salt));    // 独立种子流,不打战斗 RNG
  var side = MAP.side, k = side / 2000;
  _wLatA = wLatNew(_wLatP, hashSeed(seed + '|wlatA' + salt));
  _wLatB = wLatNew(_wLatP, hashSeed(seed + '|wlatB' + salt));
  _wLatC = wLatNew(_wLatP, hashSeed(seed + '|wlatC' + salt));
  var saveLat = wLat; wLat = null;       // 布点期 terrainBase() 不见奇观(基底坡度预检用纯基底)
  var counts = wonderCounts(side), list = [];
  var nT = counts.peak + counts.ridge;   // 总数口径沿用 Q2(2km=3,6km=5),类型按种子洗牌(任务二)
  var nRot = nT >= 5 ? 2 : 1;
  var nP = Math.max(1, nT - nRot - 1), nR = Math.min(counts.ridge, Math.max(0, nT - nP - nRot));
  nRot = nT - nP - nR;
  var range = side / 2 - 250;            // 候选域:距四缘 ≥250m(fade 包络 240m 外+10m)
  if (range < 60) range = 60;            // 极小图兜底(仍在图内;包络会压住越界部分)
  function tryPlace(type) {
    for (var a = 0; a < 40; a++) {       // 拒绝采样,有界 40 次,确定性
      var cx = (rnd() * 2 - 1) * range, cz = (rnd() * 2 - 1) * range;
      var ok = true, i;
      var hqs = (MAP.hqFlat && MAP.hqFlat.list) || [];
      for (i = 0; i < hqs.length && ok; i++) {                 // a) 距 HQ ≥150m
        var hdx = cx - hqs[i].x, hdz = cz - hqs[i].z;
        if (hdx * hdx + hdz * hdz < 150 * 150) ok = false;
      }
      for (i = 0; i < list.length && ok; i++) {                // c) 圆心距 > 0.30×side
        var mdx = cx - list[i].x, mdz = cz - list[i].z, ms = side * 0.30;
        if (mdx * mdx + mdz * mdz < ms * ms) ok = false;
      }
      if (ok) {                                               // d) 基底坡度预检(奇观不骑断崖)
        var e = 8, hx1 = terrainBase(cx + e, cz), hx0 = terrainBase(cx - e, cz);
        var hz1 = terrainBase(cx, cz + e), hz0 = terrainBase(cx, cz - e);
        var gx = (hx1 - hx0) / (2 * e), gz = (hz1 - hz0) / (2 * e);
        if (gx * gx + gz * gz > 0.81) ok = false;
      }
      if (ok) { list.push(WONDER_TYPES[type].make(rnd, k, cx, cz)); return; }
    }
    /* 40 次全灭:接受最后一次候选(只保 b 图内),验证器仲裁连通性(§5)。HQ 间距在小图上
       可能不足 300m 而频繁拒收——此时仍布点,夷平后遍(§4)保证营盘平地。 */
    var fx = (rnd() * 2 - 1) * range, fz = (rnd() * 2 - 1) * range;
    list.push(WONDER_TYPES[type].make(rnd, k, fx, fz));
  }
  var i;
  for (i = 0; i < nP; i++) tryPlace('heroPeak');
  for (i = 0; i < nR; i++) tryPlace('ridge');
  var rotFirst = rnd() < 0.5 ? 'caldera' : 'pillar';   // 轮换位:种子定首型,交替
  for (i = 0; i < nRot; i++) tryPlace(i % 2 === 0 ? rotFirst : (rotFirst === 'caldera' ? 'pillar' : 'caldera'));
  MAP.wonders = list;
  /* 粗格烘焙:每座只遍历包围盒(盒外早退),累加 eval */
  wLatStep = GRID_CELL * 4;
  wLatOX = -MAP.halfW; wLatOZ = -MAP.halfL;
  wLatN = Math.ceil((GRID_N - 1) / 4) + 1;
  var NL = new Float32Array(wLatN * wLatN);
  for (var wi = 0; wi < list.length; wi++) {
    var W = list[wi], T = WONDER_TYPES[W.type];
    var x0, x1, z0, z1;
    if (W.type === 'ridge') {
      var bb = T.bound(W, k);                                 // 旋转矩形的保守 AABB
      var ex = Math.abs(W.cA) * bb.ax + Math.abs(W.sA) * bb.tr;
      var ez = Math.abs(W.sA) * bb.ax + Math.abs(W.cA) * bb.tr;
      x0 = W.x - ex; x1 = W.x + ex; z0 = W.z - ez; z1 = W.z + ez;
    } else {                                                  // heroPeak/caldera/pillar:径向包围
      var br = T.bound(W);
      x0 = W.x - br; x1 = W.x + br; z0 = W.z - br; z1 = W.z + br;
    }
    var jx0 = Math.max(0, Math.floor((x0 - wLatOX) / wLatStep)), jx1 = Math.min(wLatN - 1, Math.ceil((x1 - wLatOX) / wLatStep));
    var jz0 = Math.max(0, Math.floor((z0 - wLatOZ) / wLatStep)), jz1 = Math.min(wLatN - 1, Math.ceil((z1 - wLatOZ) / wLatStep));
    for (var jz = jz0; jz <= jz1; jz++) for (var jx = jx0; jx <= jx1; jx++) {
      var v = T.eval(W, wLatOX + jx * wLatStep, wLatOZ + jz * wLatStep, k);
      if (v !== 0) NL[jz * wLatN + jx] += v;
    }
  }
  wLat = NL;
  if (saveLat !== null && saveLat !== undefined && wLat === NL) { /* 新表已装配,旧表丢弃 */ }
}
function wonderAt(x, z) {              // 双线性上采样(~0.1µs/点);wLat 未建时恒 0
  if (!wLat) return 0;
  var fx = (x - wLatOX) / wLatStep, fz = (z - wLatOZ) / wLatStep;
  var ix = Math.floor(fx), iz = Math.floor(fz);
  if (ix < 0 || iz < 0 || ix >= wLatN - 1 || iz >= wLatN - 1) return 0;
  var tx = fx - ix, tz = fz - iz, i00 = iz * wLatN + ix;
  var h00 = wLat[i00], h10 = wLat[i00 + 1], h01 = wLat[i00 + wLatN], h11 = wLat[i00 + wLatN + 1];
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
}

/* —— §4 HQ 布局(纯函数,地形/落位同源)+ HQ 夷平(烘焙后遍)—— */
function hqParamsFromGlobals() {       // 参数采集单点:applyMapConfig 与 spawnTeams 兜底共用
  var ss = (typeof startSide !== 'undefined') ? startSide : 'red';
  var sbd = (typeof startBaseDist !== 'undefined') ? startBaseDist : { tank: 500, arty: 1500, heli: 3000 };
  var flip = ((typeof window !== 'undefined' && window.__TEAM_FLIP) ? -1 : 1) * (ss === 'blue' ? -1 : 1);
  return { halfL: MAP.halfL, halfW: MAP.halfW, boundsX: CONF.boundsX, boundsZ: CONF.boundsZ,
    kW: (MAP.wid || MAP.side) / 2000, startBaseDist: sbd, flip: flip };
}
function hqLayoutCompute(P) {          // 与原 spawnTeams 落位数学一致(+heli 坡墙上限,方案 §5.2-6)
  function baseZOf(dist) {
    var d = clamp(Math.round(+dist || 0), 0, P.halfL);
    var cap = P.halfL - 210;           // HQ 纵深不进坡墙(坡起点 half-150 前 60m);旧 min(d,boundsZ-15) 在大图上把 heli 送上坡墙
    if (cap < 0) cap = 0;
    var lim = P.boundsZ - 15; if (cap < lim) lim = cap;
    return Math.min(d, lim);
  }
  var bT = baseZOf(P.startBaseDist.tank), bA = baseZOf(P.startBaseDist.arty), bH = baseZOf(P.startBaseDist.heli);
  var baseZ = { tank: bT * P.flip, arty: bA * P.flip, heli: bH * P.flip };
  var aYaw = P.flip > 0 ? Math.PI : 0, eYaw = P.flip > 0 ? 0 : Math.PI;
  var maxSpread = Math.min(HQ_WING_SPREAD * P.kW, (P.boundsX - 40) / 1.1);
  var list = [];
  [['tank', bT], ['arty', bA], ['heli', bH]].forEach(function (b) {
    for (var w = 0; w < 3; w++) {
      var wx = [-maxSpread, 0, maxSpread][w] * P.flip;
      list.push({ team: 'red', type: b[0], wing: w, x: wx, z: b[1] * P.flip, yaw: aYaw, h: 0 });
      list.push({ team: 'blue', type: b[0], wing: w, x: -wx, z: -b[1] * P.flip, yaw: eYaw, h: 0 });
    }
  });
  return { list: list, baseZ: baseZ };
}
function hqFlattenApply() {           // 18 圆盘:r≤50 绝对平,50~70 smoothstep 过渡,每 HQ 只遍历子矩形
  var hqs = (MAP.hqFlat && MAP.hqFlat.list) || [];
  if (!hqs.length || !tbLat) return;
  var nx = GRID_N;
  for (var hi = 0; hi < hqs.length; hi++) {
    var hx = hqs[hi].x, hz = hqs[hi].z;
    var h0 = terrainBaseCached(hx, hz);      // 圆心(基+奇观)采样:与周围落差最小
    hqs[hi].h = h0;
    var ix0 = Math.max(0, Math.ceil((hx - 70 + MAP.halfW) / GRID_CELL_X)), ix1 = Math.min(nx - 1, Math.floor((hx + 70 + MAP.halfW) / GRID_CELL_X));
    var iz0 = Math.max(0, Math.ceil((hz - 70 + MAP.halfL) / GRID_CELL_Z)), iz1 = Math.min(nx - 1, Math.floor((hz + 70 + MAP.halfL) / GRID_CELL_Z));
    for (var iz = iz0; iz <= iz1; iz++) for (var ix = ix0; ix <= ix1; ix++) {
      var wx = -MAP.halfW + ix * GRID_CELL_X, wz = -MAP.halfL + iz * GRID_CELL_Z;
      var dx = wx - hx, dz = wz - hz, d = Math.sqrt(dx * dx + dz * dz);
      var gi = iz * nx + ix;
      if (d <= 50) tbLat[gi] = h0;
      else if (d < 70) {
        var t = (d - 50) / 20, s = t * t * (3 - 2 * t);
        tbLat[gi] = h0 + (tbLat[gi] - h0) * s;
      }
    }
  }
}

/* —— §5 连通性验证(复用寻路 A*,非洪水填充)+ 确定性重布 —— */
function wonderValidate() {          // 5×5 出生线点对 A*,≥15/25 可达;nav 未建/无奇观时恒 true
  if (!MAP.wonders || !MAP.wonders.length || !_navH || typeof _asStart !== 'function') return true;
  var sx = CONF.boundsX - 60, szA = CONF.redSpawnZ, szE = CONF.blueSpawnZ;
  if (!(sx > 0)) return true;
  var mob = (typeof CONF !== 'undefined' && CONF.red && CONF.red.mob) || null;
  var spd = (typeof CONF !== 'undefined' && CONF.red && CONF.red.speed) || 10;
  if (!mob) return true;
  var pass = 0, total = 0;
  for (var i = 0; i < 5; i++) for (var j = 0; j < 5; j++) {
    var x0 = -sx + (2 * sx * i) / 4, x1 = -sx + (2 * sx * j) / 4;
    var t = { kind: 'tank', team: 'red', mob: mob, group: { position: { x: x0, y: 0, z: szA } },
      yaw: 0, speed: 5, speed0: spd, radius: 4, alive: true, ai: {}, _navReqId: 1, _nav: null };
    total++;
    if (!_asStart(t, x1, szE, 1)) continue;
    var guard = 0;
    while (!_asActive.done && guard++ < 200) _asStep(_asActive, 1000000);
    if (_asActive.done && _asActive.found) pass++;
    _asActive = null;                // 验证桩不走 _asFinish(不写 t._nav 路径),直接丢弃搜索态
  }
  MAP._wonderPass = pass;            // 诊断用(日志可见,不硬断言阈值之外的任何事)
  return pass >= 15;
}
function wonderEnsureConnected() {   // setupMapWorld 调用:失败→确定性重布(≤3 次)→仍失败接受首版,永不阻塞开局
  if (typeof navGridBuild !== 'function') return;   // 0 崎岖不再空转(奇观从 0 起)
  var salts = ['', '#r1', '#r2', '#r3'];
  for (var a = 0; a < salts.length; a++) {
    MAP.wonderSalt = salts[a];
    if (a > 0) { buildTerrainBaseTable(); navGridBuild(); }
    if (wonderValidate()) { MAP._wonderSalt = salts[a]; return; }
  }
  MAP.wonderSalt = '';               // 3 次全败(概率 ~1e-6 级):接受首版参数分布,告警
  buildTerrainBaseTable(); navGridBuild();
  MAP._wonderSalt = '';
  if (typeof console !== 'undefined' && console.warn) console.warn('[wonder] connectivity retry exhausted, accepted first layout. pass=' + MAP._wonderPass);
}
