/* ===== Module: ai_nav.js ===== */
/* 网格 A* 坡度寻路(P2,2026-09-09 大改):
   开局坡度网格 + 各向异性时间代价 + 令牌桶跨帧 + string-pull 平滑 + pure pursuit 跟随。
   设计见 slope_design/坡道越野与寻路技术方案.md §6.3。
   建场: flow.js(与 tacGridBuild 为邻)调 navGridBuild;消费: ai.js navSteer/navPump。
   加载顺序: index.html 中置于 ai.js 之后(运行时调用 navSegReach,无加载期依赖)。 */

var NAV_N = 0, NAV_CELL = 16, NAV_MIN = -1000;
var _navH = null, _navGX = null, _navGZ = null;   // 高度/梯度网格(Float32 N*N)
var _navBuiltFor = '';
var _navGroupLim = null;                          // {track:{tanMax,tanSide},wheel:{...}} 由 CONF.mob 派生,组内取最小

function navGroupOf(t) {   // 寻路分组:轮式与履带分开剪枝;直升机=null(不寻路)
  if (!t || t.kind === 'ah64' || t.kind === 'wz10') return null;
  return (t.kind === 'arty') ? 'wheel' : 'track';
}
function navGroupLim(group) {
  if (!_navGroupLim && typeof CONF !== 'undefined') {
    var g = { track: { tanMax: 9, tanSide: 9 }, wheel: { tanMax: 9, tanSide: 9 } };
    var tr = [CONF.red && CONF.red.mob, CONF.blue && CONF.blue.mob, CONF.td && CONF.td.mob,
              CONF.m1 && CONF.m1.mob, CONF.t99 && CONF.t99.mob];
    for (var i = 0; i < tr.length; i++) {
      var m = tr[i]; if (!m) continue;
      mobDerived(m);
      if (m._tanMax < g.track.tanMax) g.track.tanMax = m._tanMax;
      if (m._tanSide < g.track.tanSide) g.track.tanSide = m._tanSide;
    }
    var am = CONF.arty && CONF.arty.mob;
    if (am) { mobDerived(am); g.wheel.tanMax = am._tanMax; g.wheel.tanSide = am._tanSide; }
    if (g.track.tanMax > 8) { g.track.tanMax = 0.58; g.track.tanSide = 0.34; }   // CONF 缺数据兜底
    if (g.wheel.tanMax > 8) { g.wheel.tanMax = 0.38; g.wheel.tanSide = 0.30; }
    _navGroupLim = g;
  }
  return _navGroupLim ? _navGroupLim[group] : null;
}

function navGridBuild() {   // 建场一次:每格 h+gx+gz(中心差分);192²×5 探针 ≈ 10ms 级
  var side = (typeof MAP !== 'undefined' && MAP.side) || 2000;
  var N = Math.round(side / 16);
  if (N < 96) N = 96; else if (N > 192) N = 192;
  NAV_N = N; NAV_CELL = side / N; NAV_MIN = -side / 2;
  _navH = new Float32Array(N * N); _navGX = new Float32Array(N * N); _navGZ = new Float32Array(N * N);
  var s = NAV_CELL * 0.5;
  for (var gz = 0; gz < N; gz++) {
    var cz = NAV_MIN + (gz + 0.5) * NAV_CELL;
    for (var gx = 0; gx < N; gx++) {
      var cx = NAV_MIN + (gx + 0.5) * NAV_CELL, i = gz * N + gx;
      _navH[i] = terrainH(cx, cz);
      _navGX[i] = (terrainH(cx + s, cz) - terrainH(cx - s, cz)) / (2 * s);
      _navGZ[i] = (terrainH(cx, cz + s) - terrainH(cx, cz - s)) / (2 * s);
    }
  }
  _navBuiltFor = String((typeof MAP !== 'undefined' && MAP.seed) || '') + '/' + side + '/' + ((typeof MAP !== 'undefined' && MAP.rough) || 0);
  _navRegT = null; _navRegW = null;
  if (typeof Int32Array !== 'undefined') {   // P2：连通域标注（每组一次 flood fill）
    _navRegT = new Int32Array(N * N); _navRegW = new Int32Array(N * N);
    var limT = navGroupLim('track'), limW = navGroupLim('wheel');
    _navRegNT = _navFlood(_navRegT, limT ? limT.tanMax : 0.58);
    _navRegNW = _navFlood(_navRegW, limW ? limW.tanMax : 0.38);
  }
  _navReqQ.length = 0; _asActive = null; _navPen.clear(); _navPenN = 0;   // 换场:队列/进行中搜索/虚拟障碍作废
  _navGroupLim = null;
}

function navCellOf(x, z) {
  var gx = Math.floor((x - NAV_MIN) / NAV_CELL), gz = Math.floor((z - NAV_MIN) / NAV_CELL);
  if (gx < 0 || gz < 0 || gx >= NAV_N || gz >= NAV_N) return -1;
  return gz * NAV_N + gx;
}
/* D2 出生坡度门(奇观 Phase 1 刚需):候选落位点坡度必须 < 寻路极限×0.9——与 _asStart 目标可纳口径
   (tanMax²×0.81)逐字一致。|grad|<0.9·tanMax ⟹ 自该格出发的 8 条有向边都不超 tanMax ⟹
   出生格永不孤立。track(≈0.58)/wheel(≈0.38)取严者≈0.34@2km,恰与演示 HARD_CLIMB=0.55 量级衔接。 */
function navSlopeAt(x, z) {            // 世界坐标 → 该 nav 格梯度模(格心差分口径);nav 未建返回 0( fail-open)
  if (!_navGX) return 0;
  var i = navCellOf(x, z);
  if (i < 0) return 9;
  return Math.sqrt(_navGX[i] * _navGX[i] + _navGZ[i] * _navGZ[i]);
}
function spawnSlopeOK(x, z) {          // D2 门:落位点是否可站(两种机动分组取严)
  var lim = navGroupLim('track'), limW = navGroupLim('wheel');
  var t = lim ? lim.tanMax : 0.58;
  if (limW && limW.tanMax < t) t = limW.tanMax;
  if (!(t > 0)) t = 0.38;
  return navSlopeAt(x, z) < t * 0.9;
}
var _npOut = { x: 0, z: 0 };
function navCellXZ(i, out) {
  out = out || _npOut;
  out.x = NAV_MIN + ((i % NAV_N) + 0.5) * NAV_CELL;
  out.z = NAV_MIN + (((i / NAV_N) | 0) + 0.5) * NAV_CELL;
  return out;
}
var _navRegT = null, _navRegW = null, _navRegNT = 0, _navRegNW = 0;   // P2：连通域（建场 flood fill，供 O(1) 可达预查）
function _navFlood(reg, limTan) {   // 8 连通漫水；cell 口径 0.9025 与 F1 剪枝一致、无 sE/切角检查=superset 方向安全
  var N = NAV_N, lim2 = limTan * limTan * 0.9025, id = 0, s, u, d;
  for (s = 0; s < N * N; s++) reg[s] = -1;
  var stack = [];
  for (s = 0; s < N * N; s++) {
    if (reg[s] !== -1) continue;
    if (_navGX[s] * _navGX[s] + _navGZ[s] * _navGZ[s] >= lim2) { reg[s] = -2; continue; }
    id++;
    reg[s] = id; stack.push(s);
    while (stack.length > 0) {
      u = stack.pop();
      var ux = u % N, uz = (u / N) | 0;
      for (d = 0; d < 8; d++) {
        var vx = ux + _DX[d], vz = uz + _DZ[d];
        if (vx < 0 || vz < 0 || vx >= N || vz >= N) continue;
        var v = vz * N + vx;
        if (reg[v] !== -1) continue;
        if (_navGX[v] * _navGX[v] + _navGZ[v] * _navGZ[v] >= lim2) { reg[v] = -2; continue; }
        reg[v] = id; stack.push(v);
      }
    }
  }
  return id;
}
function navRegionOf(x, z, group) {   // P2：O(1) 可达预查；-1=界外/禁行/未建场
  if (!_navRegT || NAV_N <= 0) return -1;
  var i = navCellOf(x, z);
  if (i < 0) return -1;
  var r = (group === 'wheel') ? _navRegW[i] : _navRegT[i];
  return r > 0 ? r : -1;
}
function _navFail(t) { t._nav = null; t._navFailT = gameT; t._navFailN = (t._navFailN || 0) + 1; }   // P2：失败计数(退避用)

/* —— 请求队列 + 令牌桶(免主循环钩子,各车 aiUpdate 分摊)—— */
var _navReqQ = [];
var _navReqId = 0;
var _navTokens = 0, _navTokensT = -1;
var NAV_TOKEN_RATE = 150000, NAV_TOKEN_CAP = 8000, NAV_SLICE = 1500;   // 切片=单帧最坏 1.5ms(原生~1us/expansion),只改分摊节奏不改语义
var _asActive = null;
var _asHeap = null, _asHeapF = null, _asHeapN = 0;   // 模块级单活跃搜索 scratch
var _asG = null, _asGen = null, _asFrom = null, _asDone = null, _asId = 0;
var _DX = [1, 0, -1, 0, 1, 1, -1, -1], _DZ = [0, 1, 0, -1, 1, -1, -1, 1];   // 前 4 正交,后 4 对角

function navRequest(t, gx, gz) {
  if (_navReqQ.length > 60) _navReqQ.shift();
  _navReqId++;
  t._navReqId = _navReqId;
  _navReqQ.push({ t: t, id: _navReqId, gx: gx, gz: gz });
}
function navRequestPri(t, gx, gz) {
  if (_navReqQ.length > 60) _navReqQ.shift();
  _navReqId++;
  t._navReqId = _navReqId;
  _navReqQ.unshift({ t: t, id: _navReqId, gx: gx, gz: gz });
}
function navPump(now) {
  if (!_navH) return;
  if (_navTokensT < 0) _navTokensT = now;
  if (_navPenN > 0 && now - _navPenPurgeT > 5) {
    _navPenPurgeT = now;
    _navPen.forEach(function (exp, k) { if (exp <= now) _navPen.delete(k); });
    _navPenN = _navPen.size;
  }
  var dt = now - _navTokensT;
  if (dt < 0) dt = 0; else if (dt > 0.5) dt = 0.5;
  _navTokensT = now;
  _navTokens += dt * NAV_TOKEN_RATE;
  if (_navTokens > NAV_TOKEN_CAP) _navTokens = NAV_TOKEN_CAP;
  if (!_asActive) {
    while (_navReqQ.length > 0) {
      var r = _navReqQ.shift();
      if (!r.t || !r.t.alive || r.t._navReqId !== r.id) continue;   // 过期
      if (r.t._navGoalX !== r.gx || r.t._navGoalZ !== r.gz) continue;   // 目的地已变
      if (_asStart(r.t, r.gx, r.gz, r.id)) break;
    }
    if (!_asActive) return;
  }
  var slice = Math.floor(_navTokens);
  if (slice <= 0) return;
  if (slice > NAV_SLICE) slice = NAV_SLICE;
  var used = _asStep(_asActive, slice);
  _navTokens -= used;
  if (used < slice || _asActive.done) { _asFinish(_asActive); _asActive = null; }
}

function _asH(i, g, v0) {   // octile 启发(时间单位);可采纳 ⟸ vEff≤v0 恒成立(下坡不加速)
  var dx = Math.abs((i % NAV_N) - (g % NAV_N)), dz = Math.abs(((i / NAV_N) | 0) - ((g / NAV_N) | 0));
  var d = (dx > dz ? dx - dz + dz * 1.41421356 : dz - dx + dx * 1.41421356) * NAV_CELL;
  return d / v0;
}
function _asPush(i, f) {
  var n = _asHeapN++;
  _asHeap[n] = i; _asHeapF[n] = f;
  while (n > 0) {
    var p = (n - 1) >> 1;
    if (_asHeapF[p] <= _asHeapF[n]) break;
    var ti = _asHeap[p]; _asHeap[p] = _asHeap[n]; _asHeap[n] = ti;
    var tf = _asHeapF[p]; _asHeapF[p] = _asHeapF[n]; _asHeapF[n] = tf;
    n = p;
  }
}
function _asPop() {
  var top = _asHeap[0], last = --_asHeapN;
  _asHeap[0] = _asHeap[last]; _asHeapF[0] = _asHeapF[last];
  var n = 0;
  for (;;) {
    var l = n * 2 + 1, r = l + 1, m = n;
    if (l < _asHeapN && _asHeapF[l] < _asHeapF[m]) m = l;
    if (r < _asHeapN && _asHeapF[r] < _asHeapF[m]) m = r;
    if (m === n) break;
    var ti = _asHeap[m]; _asHeap[m] = _asHeap[n]; _asHeap[n] = ti;
    var tf = _asHeapF[m]; _asHeapF[m] = _asHeapF[n]; _asHeapF[n] = tf;
    n = m;
  }
  return top;
}
function _navSpiralFree(g, lim) {   // 终点落禁行格 → 5 格螺旋找最近可走格
  var N = NAV_N, gx0 = g % N, gz0 = (g / N) | 0, lim2 = lim.tanMax * lim.tanMax * 0.81;
  for (var r = 1; r <= 5; r++) {
    for (var dz = -r; dz <= r; dz++) for (var dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      var gx = gx0 + dx, gz = gz0 + dz;
      if (gx < 0 || gz < 0 || gx >= N || gz >= N) continue;
      var i = gz * N + gx;
      if (_navGX[i] * _navGX[i] + _navGZ[i] * _navGZ[i] < lim2) return i;
    }
  }
  return -1;
}
function _asStart(t, gx, gz, reqId) {
  var p = t.group.position;
  var s = navCellOf(p.x, p.z), g = navCellOf(gx, gz);
  var group = navGroupOf(t), lim = group ? navGroupLim(group) : null;
  if (s < 0 || g < 0 || !lim) { _navFail(t); return false; }
  if (_navGX[g] * _navGX[g] + _navGZ[g] * _navGZ[g] >= lim.tanMax * lim.tanMax * 0.81) {
    g = _navSpiralFree(g, lim);
    if (g < 0) { _navFail(t); return false; }
  }
  if (_navRegT && s !== g) {   // P2：连通域预查——异域零展开失败（M1 DoS 计量归零；superset 方向只拒绝已证不可达）
    var rs = (group === 'wheel' ? _navRegW[s] : _navRegT[s]);
    var rg = (group === 'wheel' ? _navRegW[g] : _navRegT[g]);
    if (rs > 0 && rg > 0 && rs !== rg) { _navFail(t); return false; }
  }
  if (s === g) { t._nav = null; return false; }   // 同格:直行兜底(V1 斥力+看门狗接管)
  var NN = NAV_N * NAV_N;
  if (!_asG || _asG.length !== NN) {
    _asG = new Float32Array(NN); _asGen = new Int32Array(NN);
    _asFrom = new Int32Array(NN); _asDone = new Int32Array(NN);
    _asHeap = new Int32Array(NN * 8 + 8); _asHeapF = new Float32Array(NN * 8 + 8);   // push 上界=8NN(每格至多被 8 邻各推一次);原 NN 溢出静默丢弃→堆序崩坏→全漫水
  }
  _asId++;
  var mob = mobOf(t), v0 = t.speed0 || 10;
  _asActive = { t: t, reqId: reqId, goal: g, v0: v0, m: mob.mass, pEta: mob.power * mob.eta,
                crr: (typeof crrGround === 'function') ? crrGround(group === 'wheel', 0, 0) : mob.crr,   // MR1：与物理同源分档（现阶段 MAP 全局档，逐边一致；位置化后改逐边查）
                tanMax: lim.tanMax, tanSide: lim.tanSide, group: group, team: t.team || 'red',
                penBase: _navPenBase(t.team || 'red', group), done: false, found: false, abort: false };
  _asHeapN = 0;
  _asG[s] = 0; _asGen[s] = _asId; _asFrom[s] = -1;
  _asPush(s, _asH(s, g, v0));
  return true;
}
function _navEdgeCost(u, v, d, A) {   // 有向边代价=时间;超极限剪枝(-1)
  var diag = d >= 4;
  var dist = diag ? NAV_CELL * 1.41421356 : NAV_CELL;
  var lim2 = A.tanMax * A.tanMax * 0.9025;   // P0'+F1：端点格梯度剪枝——与验证器网格口径一致，防"规划放行/复查否决"重规划循环(0.95² 与平滑门/复查同极限)；等高线蹭坡腿一并剪掉(物理侧坡最恨这种)
  if (_navGX[u] * _navGX[u] + _navGZ[u] * _navGZ[u] > lim2) return -1;
  if (_navGX[v] * _navGX[v] + _navGZ[v] * _navGZ[v] > lim2) return -1;
  var sE = (_navH[v] - _navH[u]) / dist;
  if (sE > A.tanMax || sE < -A.tanMax * 1.3) return -1;
  var nl = diag ? 1.41421356 : 1;
  var ex = _DX[d] / nl, ez = _DZ[d] / nl;
  var gxM = (_navGX[u] + _navGX[v]) * 0.5, gzM = (_navGZ[u] + _navGZ[v]) * 0.5;
  var latE = Math.abs(gxM * (-ez) + gzM * ex);
  if (latE > A.tanSide) return -1;
  var penF = 1;
  if (_navPenN > 0) {
    var pe1 = _navPen.get(A.penBase + u), pe2 = _navPen.get(A.penBase + v);
    if ((pe1 !== undefined && pe1 > gameT) || (pe2 !== undefined && pe2 > gameT)) penF = 8;
  }
  var cosE = 1 / Math.sqrt(1 + sE * sE), denom = sE * cosE + A.crr * cosE;
  var vEff = A.v0;
  if (denom > 1e-4) {
    var vc = A.pEta / (A.m * 9.8 * denom);
    if (vc < vEff) vEff = vc;
  }
  if (vEff < 0.8) vEff = 0.8;
  return (dist / vEff) * (1 + 0.3 * latE / A.tanSide) * penF;
}
function _asStep(A, slice) {
  var N = NAV_N, used = 0, t = A.t;
  if (!t.alive || t._navReqId !== A.reqId) { A.done = true; A.abort = true; return used; }
  while (used < slice && _asHeapN > 0) {
    used++;
    var u = _asPop();
    if (_asDone[u] === _asId) continue;   // 堆陈旧条目
    _asDone[u] = _asId;
    if (u === A.goal) { A.done = true; A.found = true; return used; }
    var ux = u % N, uz = (u / N) | 0, gu = _asG[u];
    for (var d = 0; d < 8; d++) {
      var vx = ux + _DX[d], vz = uz + _DZ[d];
      if (vx < 0 || vz < 0 || vx >= N || vz >= N) continue;
      var v = vz * N + vx;
      if (d >= 4) {   // 斜向防切角:两正交邻居都可走
        var o1 = uz * N + vx, o2 = vz * N + ux;
        if (_navGX[o1] * _navGX[o1] + _navGZ[o1] * _navGZ[o1] >= A.tanMax * A.tanMax * 0.9025) continue;
        if (_navGX[o2] * _navGX[o2] + _navGZ[o2] * _navGZ[o2] >= A.tanMax * A.tanMax * 0.9025) continue;
      }
      var step = _navEdgeCost(u, v, d, A);
      if (step < 0) continue;
      var ng = gu + step;
      if (_asGen[v] !== _asId || ng < _asG[v]) {
        _asGen[v] = _asId; _asG[v] = ng; _asFrom[v] = u;
        _asPush(v, ng + _asH(v, A.goal, A.v0));
      }
    }
  }
  if (_asHeapN <= 0) { A.done = true; A.found = false; }
  return used;
}
var _smScr = { gx: 0, gz: 0, tan: 0 };
function navSegBlocked(ax, az, bx, bz, lim) {   // P0 真验证器：supercover 网格遍历 + ≤4m 加密采样；返回可达比例 [0,1](1=全通)
  var dx = bx - ax, dz = bz - az;
  var len = Math.sqrt(dx * dx + dz * dz);
  if (len < 1e-6) return 1;
  var lim2 = lim * lim, fBlock = 1;
  if (_navGX && NAV_N > 0) {   // (1) supercover 网格遍历(Amanatides & Woo)：格梯度口径，与 A* 同源，规划-验证一致
    var cs = NAV_CELL;
    var gx = Math.floor((ax - NAV_MIN) / cs), gz = Math.floor((az - NAV_MIN) / cs);
    var gx1 = Math.floor((bx - NAV_MIN) / cs), gz1 = Math.floor((bz - NAV_MIN) / cs);
    var stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    var tMaxX = dx !== 0 ? ((stepX > 0 ? (gx + 1) * cs + NAV_MIN - ax : ax - (gx * cs + NAV_MIN)) / Math.abs(dx)) : 1e9;
    var tMaxZ = dz !== 0 ? ((stepZ > 0 ? (gz + 1) * cs + NAV_MIN - az : az - (gz * cs + NAV_MIN)) / Math.abs(dz)) : 1e9;
    var tDeltaX = dx !== 0 ? cs / Math.abs(dx) : 1e9;
    var tDeltaZ = dz !== 0 ? cs / Math.abs(dz) : 1e9;
    var tt = 0, guard = NAV_N * 4 + 8;
    for (;;) {
      if (gx >= 0 && gz >= 0 && gx < NAV_N && gz < NAV_N) {
        var ci = gz * NAV_N + gx;
        if (_navGX[ci] * _navGX[ci] + _navGZ[ci] * _navGZ[ci] > lim2) { fBlock = tt; break; }
      }
      if (gx === gx1 && gz === gz1) break;
      if (tMaxX < tMaxZ) { tt = tMaxX; tMaxX += tDeltaX; gx += stepX; }
      else { tt = tMaxZ; tMaxZ += tDeltaZ; gz += stepZ; }
      if (tt > 1 || guard-- <= 0) break;
    }
  }
  var n = Math.ceil(len / 4);   // (2) ≤4m 加密实时采样(含弹坑；与物理探针同尺度；只查到网格阻断点之前)
  if (n < 1) n = 1; else if (n > 512) n = 512;
  var end = Math.floor(fBlock * n);
  for (var k = 1; k <= end; k++) {
    var f = k / n;
    slopeVecAt(ax + dx * f, az + dz * f, _smScr);
    if (_smScr.tan > lim) return f;
  }
  return fBlock;
}
function _navCutFree(ax, az, bx, bz, lim) {   // P0：经真验证器（旧 6 点抽查漏检 15~24%，见技术方案 §B2）
  return navSegBlocked(ax, az, bx, bz, lim) >= 1;
}
function _navSmooth(xs, zs, A) {   // string-pull:贪心最远可直达(前瞻窗 24 格有界)
  var n = xs.length, ox = [xs[0]], oz = [zs[0]], a = 0;
  var lim = A.tanMax * 0.95;
  while (a < n - 1) {
    var best = a + 1, jEnd = Math.min(n - 1, a + 24);
    for (var j = a + 2; j <= jEnd; j++) {
      if (_navCutFree(xs[a], zs[a], xs[j], zs[j], lim)) best = j;
    }
    ox.push(xs[best]); oz.push(zs[best]);
    a = best;
  }
  return { xs: ox, zs: oz };
}
function _asFinish(A) {
  var t = A.t;
  if (A.abort || !A.found || !t.alive || t._navReqId !== A.reqId) {
    if (!A.abort && t._navReqId === A.reqId) { _navFail(t); }
    return;
  }
  var path = [], i = A.goal, guard = NAV_N * NAV_N + 8;
  while (i >= 0 && guard-- > 0) { path.push(i); i = _asFrom[i]; }
  if (guard <= 0 || path.length < 2) { _navFail(t); return; }
  path.reverse();
  var xs = [], zs = [];
  for (var k = 0; k < path.length; k++) { navCellXZ(path[k], _npOut); xs.push(_npOut.x); zs.push(_npOut.z); }
  var sm = _navSmooth(xs, zs, A);
  t._nav = { xs: sm.xs, zs: sm.zs, n: sm.xs.length, i: 0, reT: 0 }; t._navFailN = 0;
}

/* —— P1 停滞→虚拟障碍→强制重搜闭环 ——
   进度看门狗(快窗 3s@0.4m/s + 慢窗 8s@1.0m/s)→ 停滞格+前进下一格代价×8(TTL 25s,单层,按 team+group 分键)→
   失效+跳直航强制 A*(惩罚只在 A* 代价生效)。键=数值(penBase+cell)，零 GC。 */
var _navPen = new Map(), _navPenN = 0, _navPenPurgeT = -10;
function _navPenBase(team, group) { return ((((team === 'blue') ? 1 : 0) * 2 + ((group === 'wheel') ? 1 : 0))) * 40000; }
function _navOnStall(t, refX, refZ) {
  var group = navGroupOf(t);
  if (group === null) return;
  var base = _navPenBase(t.team || 'red', group), tp = t.group.position, exp = gameT + 25;
  var here = navCellOf(tp.x, tp.z);
  if (here >= 0) _navPen.set(base + here, exp);
  var dx = refX - tp.x, dz = refZ - tp.z, L = Math.sqrt(dx * dx + dz * dz);
  if (L > 1e-3) {
    var nx = navCellOf(tp.x + dx / L * NAV_CELL, tp.z + dz / L * NAV_CELL);
    if (nx >= 0 && nx !== here) _navPen.set(base + nx, exp);
  }
  _navPenN = _navPen.size;
  t._navGoalX = undefined; t._nav = null; t._navDirect = 0; t._navNoDir = 1;
}
function _navPenalizeSeg(ax, az, bx, bz, team, group) {   // F3：复查失败腿→沿途格惩罚×8(TTL 25s，单层，上限 32 格)
  var base = _navPenBase(team || 'red', group), exp = gameT + 25, n = 0;
  var dx = bx - ax, dz = bz - az, len = Math.sqrt(dx * dx + dz * dz), steps = Math.ceil(len / NAV_CELL);
  if (steps < 1) steps = 1; else if (steps > 32) steps = 32;
  for (var k = 0; k <= steps; k++) {
    var ci = navCellOf(ax + dx * k / steps, az + dz * k / steps);
    if (ci >= 0) { _navPen.set(base + ci, exp); n++; }
  }
  if (n > 0) _navPenN = _navPen.size;
}
function _navStallSample(t, refX, refZ, ti) {   // P1 进度看门狗(修订)：快窗 3s@0.4m/s(真卡死，penalty 先行)+慢窗 8s@1.0m/s(蠕行陷阱/极限环)；意图门：无油门/驻锄不采样
  if (t._throttleLock || Math.abs(t._throttle || 0) < 0.15) return;
  var now = gameT, tp = t.group.position;
  var dx = refX - tp.x, dz = refZ - tp.z;
  var d = Math.sqrt(dx * dx + dz * dz);
  if (t._navStT == null) { t._navStT = now; t._navStD = d; t._navStTi = ti; t._navStF = 0; t._navStS = 0; return; }
  if (now - t._navStT < 0.5) return;
  t._navStT = now;
  if (ti !== t._navStTi) { t._navStTi = ti; t._navStD = d; t._navStF = 0; t._navStS = 0; return; }   // 航点推进=硬进展
  var step = t._navStD - d;
  t._navStD = d;
  if (step > 0.2) t._navStF = 0; else t._navStF += 0.5;   // 快窗：<0.4m/s
  if (step > 0.5) t._navStS = 0; else t._navStS += 0.5;   // 慢窗：<1.0m/s
  if ((t._navStF >= 3 || t._navStS >= 8) && now - (t._navStallReT || -99) > 6) {   // 6s 冷却
    t._navStallReT = now; t._navStF = 0; t._navStS = 0;
    _navOnStall(t, refX, refZ);
  }
}
/* —— 跟随 API:navSteer 返回当前 pursuit 航点 {x,z},null=直行(调用方用原始 dest)—— */
var _nwOut = { x: 0, z: 0 };
function navSteer(t, destX, destZ, tp) {
  if (typeof SIM_K === 'undefined' || SIM_K <= 0 || !_navH) return null;
  var group = navGroupOf(t);
  if (group === null) return null;
  var A = t.ai;
  if (!A || A.evadeT > 0) { t._nav = null; t._navStT = null; t._navOffT0 = null; return null; }   // 逃生走 V1 直行(反应优先)
  if (t._navGoalX !== destX || t._navGoalZ !== destZ) {
    t._navGoalX = destX; t._navGoalZ = destZ;
    t._nav = null; t._navDirect = 0; t._navFailT = 0; t._navReT = 0;
    t._navStT = null; t._navOffT0 = null;
    if (t._navLastGX !== destX || t._navLastGZ !== destZ) { t._navLastGX = destX; t._navLastGZ = destZ; t._navReFailN = 0; t._navReBackT = 0; t._navFailN = 0; }   // F2+P2：真新目标清退避(同目标重规划保留)
    if (t._navNoDir) { t._navNoDir = 0; navRequestPri(t, destX, destZ); return null; }
    if (navSegReach(t, tp.x, tp.z, destX, destZ, navGroupLim(group).tanMax) >= 1) {
      t._navDirect = 1; return null;   // fast path:直段可走,连请求都不发
    }
    navRequest(t, destX, destZ);
    return null;   // 规划中:本帧先朝原始方向走
  }
  if (t._navDirect) {
    if (gameT - (t._navReT || 0) > 1.0 && gameT > (t._navReBackT || 0)) {   // 直航复查 1Hz+F2 退避门
      t._navReT = gameT;
      if (!_navCutFree(tp.x, tp.z, destX, destZ, navGroupLim(group).tanMax * 0.95)) {
        t._navGoalX = undefined;
        _navPenalizeSeg(tp.x, tp.z, destX, destZ, t.team, group);   // F3：失败腿教给规划器
        t._navReFailN = (t._navReFailN || 0) + 1;   // F2：连续失败退避 1/2/4/8s(病态限流)
        t._navReBackT = gameT + Math.min(8, Math.pow(2, t._navReFailN - 1));
      } else t._navReFailN = 0;
    }
    var gdx = destX - tp.x, gdz = destZ - tp.z;
    if (gdx * gdx + gdz * gdz > 400) _navStallSample(t, destX, destZ, -1);
    return null;
  }
  var nv = t._nav;
  if (!nv) {
    if ((t._navFailT || 0) > 0 && gameT - t._navFailT > Math.min(8, 2 * Math.pow(2, (t._navFailN || 1) - 1))) { t._navFailT = 0; navRequest(t, destX, destZ); }   // P2：失败退避 2/4/8s
    return null;
  }
  if (gameT - (nv.reT || 0) > 1.0 && gameT > (t._navReBackT || 0)) {   // 航点复查 1Hz+F2 退避门(前方 2 段)
    nv.reT = gameT;
    var lim = navGroupLim(group).tanMax * 0.95, ok = true;
    for (var c = nv.i; c < Math.min(nv.i + 2, nv.n - 1); c++) {
      if (!_navCutFree(nv.xs[c], nv.zs[c], nv.xs[c + 1], nv.zs[c + 1], lim)) {
        _navPenalizeSeg(nv.xs[c], nv.zs[c], nv.xs[c + 1], nv.zs[c + 1], t.team, group);   // F3
        ok = false; break;
      }
    }
    if (!ok) {
      t._navGoalX = undefined; t._nav = null;
      t._navReFailN = (t._navReFailN || 0) + 1;   // F2：连续失败退避 1/2/4/8s
      t._navReBackT = gameT + Math.min(8, Math.pow(2, t._navReFailN - 1));
      return null;
    }
    t._navReFailN = 0;
  }
  var L = Math.abs(t.speed) * 1.5;   // pure pursuit 前瞻
  if (L < 8) L = 8;
  while (nv.i < nv.n) {
    var wdx = nv.xs[nv.i] - tp.x, wdz = nv.zs[nv.i] - tp.z;
    if (wdx * wdx + wdz * wdz > 36) break;
    nv.i++;
  }
  if (nv.i >= nv.n) { t._nav = null; t._navStT = null; t._navOffT0 = null; return null; }
  var ti = nv.i, L2 = L * L;
  while (ti < nv.n - 1) {
    var pdx = nv.xs[ti] - tp.x, pdz = nv.zs[ti] - tp.z;
    if (pdx * pdx + pdz * pdz > L2) break;
    ti++;
  }
  var sbx = nv.xs[ti], sbz = nv.zs[ti], offD2 = 1e18;   // P3.2 偏航检测:距前方路径>12m→2s 容限→snapback→4s 失效
  for (var oi = nv.i; oi < nv.n - 1; oi++) {
    var oax = nv.xs[oi], oaz = nv.zs[oi], obx = nv.xs[oi + 1], obz = nv.zs[oi + 1];
    var odx = obx - oax, odz = obz - oaz, ol2 = odx * odx + odz * odz;
    if (ol2 < 1e-6) continue;
    var ott = ((tp.x - oax) * odx + (tp.z - oaz) * odz) / ol2;
    if (ott < 0) ott = 0; else if (ott > 1) ott = 1;
    var oex = oax + odx * ott - tp.x, oez = oaz + odz * ott - tp.z;
    var od2 = oex * oex + oez * oez;
    if (od2 < offD2) { offD2 = od2; sbx = oax + odx * ott; sbz = oaz + odz * ott; }
  }
  var offT = 0;
  if (offD2 > 144) {
    if (t._navOffT0 == null) t._navOffT0 = gameT;
    offT = gameT - t._navOffT0;
    if (offT > 4) { t._navGoalX = undefined; t._nav = null; t._navOffT0 = null; return null; }
  } else t._navOffT0 = null;
  if (offT > 2) { _nwOut.x = sbx; _nwOut.z = sbz; return _nwOut; }   // snapback(跳过采样器，免双重恢复打架)
  _nwOut.x = nv.xs[ti]; _nwOut.z = nv.zs[ti];
  var qdx = destX - tp.x, qdz = destZ - tp.z;
  if (qdx * qdx + qdz * qdz > 400) _navStallSample(t, _nwOut.x, _nwOut.z, ti);
  return _nwOut;
}
