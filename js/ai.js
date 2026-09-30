
/* ===== Module: ai.js ===== */
/* ============================================================
   模块: ai.js — AI:坦克决策树/火箭炮 AI/威胁火控/避障
   (加载顺序由 index.html MODULES 表决定,勿单独调整)
   ============================================================ */
'use strict';
/* ============================================================
   AI(敌我通用:自主索敌 / 走位 / 提前量 / 避免误伤)
   ============================================================ */
/* ============================================================
   AI(敌我通用)
   战术纪律:
   · 模式化决策: charge(底线外冲锋:移动射击+前方掩体)/advance(推进压上)/hold(据守)/cover(掩体)
     + rush(劣势殊死一搏)/flankrun(迂回组战略包抄赶路);近战绕侧已剥离,侧击归属战略包抄组
   · 交战域内车体始终正面对敌;撤退用倒车而不是转身露尾
   · 掩体评估与开火闸同口径:障碍物/残骸/地形反斜面均挡视线(地形=高度场步进采样)
   · 残骸=可推可拆的活掩体:贴身顶开不急着绕;挡炮线的重伤残骸会被补炮清障
   · 反偷懒:行军零驻留 + 看门狗强制重选目的地 + 决策必有兜底落点
   · 注意力模型:警觉(眼观六路,能提前 3s 感知来袭火箭弹)↔
     专注(埋头瞄准/装填,感知不到火箭弹,直到在身边炸响才惊醒)
   · 局部战况姿态:半径 100m 双方战力差(威胁权重∝单发伤害)→ 优势激进压上 / 劣势保守或殊死一搏
   · 双重视野:车体正面扇面 + 炮塔/战斗室正面扇面各是一双眼睛;
     后方之敌不可见——挨了打(击穿/跳弹/溅射都算)或被撞上才开始警觉
   · 威胁评分火控:距离越近越危、敌炮口越指向我越危、我炮口到位路程越短越优先;
     思考节拍重评,明显更优才换目标(迟滞防抖);装填全程炮塔伺服不停
   · 迂回组战略包抄:weakSector 找战线突破口 → 突破 → oppHT 小组侧后突袭
   ============================================================ */

var aiScheduler = {
  postureBudget: 2,          // 实测需求 ~0.8 车/帧(postT 2.2~3.2s),预算 4 富余仅防峰值;2 削峰值邻域扫描
  targetBudget: 6,
  urgentTargetBudget: 2,
  reset: function () { this.postureBudget = 2; this.targetBudget = 6; this.urgentTargetBudget = 2; },
  allowPosture: function () {
    if (this.postureBudget <= 0) return false;
    this.postureBudget--;
    return true;
  },
  allowTarget: function (urgent) {
    if (this.targetBudget > 0) { this.targetBudget--; return true; }
    if (urgent && this.urgentTargetBudget > 0) { this.urgentTargetBudget--; return true; }
    return false;
  }
};

/* ===== AI 火控/视野常量(敌我同型同款):交战距离是"肯不肯开火"的胆子,不是弹弓射程 ===== */
var AI_VIS_TANK = 800, AI_VIS_M1 = 1200, AI_VIS_TD = 1500, AI_VIS_ARTY = 2000;   // 分平台视距(火箭炮2000)
/* LOS 断粮阈值 s:"应能交战"态(程内有目标)而 _exposed(察觉+射线复合缓存)持续为假超时 → 降级
   "够不着"落 charge 前推,恢复即清零。判定锚在决策层 pickAIDest(业界口径:攻击可行性是选位输入),
   不依赖火控闸门序——视距/装填/友线任何一道上游闸常闭都不影响本判定。
   阈值 15s=正常掩体周旋(装填 8.5s+探头)不误触,山体级持续遮挡必触。 */
var LOS_STARVE_T = 15;
function aiVisRange(t) {
  if (t._aiVisRange == null) t._aiVisRange = t.kind === 'arty' ? AI_VIS_ARTY : isTD89Vehicle(t) ? AI_VIS_TD : (isM1Vehicle(t) ? AI_VIS_M1 : AI_VIS_TANK);
  return t._aiVisRange;
}
/* ===== 交火底线(唯一"最远作战距离")——
   散布圆面积 π·(disp·D)² = 2×目标正面投影面积 → 距离 D。D 之内命中期望至少 2 发覆盖目标正面,
   超过即"够不着"级别。开火闸/模式分界/行军段/偷懒/换台咬住/侧道宽度全部消费本底线,
   随目标型号正面面积变化(打大目标可更远)。与 aiBaseDispersion 同源(同一弹道数据库,errBase 取代表值)。
   指挥官级 floorDist 与本底线同公式(组级对高威胁目标,战术推进用)——双层同源,非冲突。 ===== */
var FLOOR_ERRBASE = 0.11;        // 车组散布系数代表值(出生 rand(0.08,0.14) 中点),最远战斗距离按类计算用
var _floorCache = {};
/* ============================================================
   弹道数据库(全平台主炮散布半径缩短 1/3 → 当前 2/3; 连续两次再收紧:基础坦克/高阶坦克 主炮散布再缩短 1/3×2 → 累计 4/9,歼击车不参与):
   所有散布判定(开火散布/瞄准门/交火底线/HUD 散布环)统一调本库单一公式 spreadOf,
   杜绝散落固定值与双公式漂移;initBallisticsDB 开局调用一次(flow.js startGame),
   预计算交火底线缓存(全组合预热)与代表散布圈。火箭炮齐射物理散布 ARTY_SALVO_* 为弹体级,不入本库。
   ============================================================ */
var SPREAD_RADIUS_MUL = 2 / 3;      // 全平台主炮散布半径乘数:缩短 1/3
var SPREAD_TIGHT_MUL = 4 / 9;       // 基础坦克/高阶坦克 主炮散布连续两次再收紧 1/3(红方歼击车保持原档)→ 累计 (2/3)²
var AUTOCANNON_SPREAD_MUL = 0.25;   // 机炮散布半径乘数(用户定 2026-09-11 两轮减半:0.5→0.25,累计=原回落档 1/4;红方武装直升机/BLUE_HELI 机炮与 RED_AA 双联25mm(aa 路由至 wz10/ah64 档)同时生效)
var MODEL_SPREAD = {                // 型号散布公式参数库:disp = clamp(eb·(k+kd·d), lo, hi) · mul;arty=固定瞄准散布
  /* 机炮档(红方武装直升机/BLUE_HELI/RED_AA):此前 wz10/ah64 未入表 → 回落 tank 档;现显式收录并 ×AUTOCANNON_SPREAD_MUL=减半。
     坦克主炮/火箭炮各档不受影响。所有散布判定(开火/瞄准门/交火底线/HUD 散布环)统一走 spreadOf,一处改动全局生效。任务23 再减半→累计 1/4。 */
  wz10: { k: 0.02,   kd: 0.0006,     lo: 0,        hi: 1,       mul: 0.5  * SPREAD_RADIUS_MUL * SPREAD_TIGHT_MUL * AUTOCANNON_SPREAD_MUL },
  ah64: { k: 0.02,   kd: 0.0006,     lo: 0,        hi: 1,       mul: 0.5  * SPREAD_RADIUS_MUL * SPREAD_TIGHT_MUL * AUTOCANNON_SPREAD_MUL },
  tank: { k: 0.02,   kd: 0.0006,     lo: 0,        hi: 1,       mul: 0.5  * SPREAD_RADIUS_MUL * SPREAD_TIGHT_MUL },
  m1a1: { k: 0.004,  kd: 0.000025,   lo: 0.00075,  hi: 0.00175, mul: 0.66 * SPREAD_RADIUS_MUL }, // 蓝方 BLUE-MBT-2 主炮散布半径 = RED-MBT-2 (t99) 的 1.1 倍
  td89: { k: 0.004,  kd: 0.000025,   lo: 0.00075,  hi: 0.00175, mul: 0.5  * SPREAD_RADIUS_MUL },   // 红方歼击车保持原收紧档
  t99:  { k: 0.004,  kd: 0.000025,   lo: 0.00075,  hi: 0.00175, mul: 0.6  * SPREAD_RADIUS_MUL },   // 红方重型坦克=红方歼击车散布×1.2(mul 0.5→0.6,含钳位端同倍)
  arty: { fixed: 0.0015 * SPREAD_RADIUS_MUL * 0.2 }    // 火箭炮瞄准散布: 射程10KM按10KM:2KM比例缩减为1/5,使10KM处散布等于原2KM散布
};
function spreadOf(modelKey, errBase, d) {         // 统一散布公式(单一实现;errBase=车组系数)
  var S = MODEL_SPREAD[modelKey] || MODEL_SPREAD.tank;
  if (S.fixed != null) return S.fixed;
  return clamp(errBase * (S.k + S.kd * d), S.lo, S.hi) * S.mul;
}
var _MCD_KEYS = [], _MCD_IX = {}, _MCD_N = 0, _MCD_NO = 0;   // 模型序表:由载具注册表派生(新增型号自动入表,无需手工维护)
(function () {                                 // 加载时构建(core.js 先于本模块):遍历注册表条目×阵营收集唯一 modelKey
  var mTeams = ['red', 'blue'];
  for (var mvi = 0; mvi < VEHICLE_KINDS.length; mvi++) {
    var mvk = VEHICLE_KINDS[mvi];
    for (var mtj = 0; mtj < 2; mtj++) {
      var mtm = mTeams[mtj];
      if (mvk.sides && !mvk.sides[mtm]) continue;
      var mmk = vehicleModelKey(mtm, mvk.kind);
      if (_MCD_IX[mmk] == null) { _MCD_IX[mmk] = _MCD_KEYS.length; _MCD_KEYS.push(mmk); }
    }
  }
  _MCD_N = _MCD_KEYS.length;
  _MCD_NO = _MCD_N;                            // No-target slot follows the registered model slots.
})();
var _floorTab = [];               // [own 模型序][目标模型序,_MCD_NO=无目标兜底] → 交火底线数字表(initBallisticsDB 填充)
function initBallisticsDB() {                     // 开局调用一次(flow.js startGame):预计算散布圈 + 交火底线数字表
  var i, j;
  for (i = 0; i < _MCD_N; i++) {                   // 全模型 ×(全目标面积+无目标 5m²)一次算清(此后运行期零字符串零二分)
    _floorTab[i] = [];
    for (j = 0; j < _MCD_N; j++) _floorTab[i][j] = maxCombatDist(_MCD_KEYS[i], VEHICLE_FRONTAL_AREAS[_MCD_KEYS[j]]);
    _floorTab[i][_MCD_NO] = maxCombatDist(_MCD_KEYS[i], 5);   // Use the standard 5 m² no-target area.
  }
  var reps = { t59: 800, m60: 800, td89: 1500, m1a1: 1200, t99: 1000 };  // 各型号代表交战距离(仅散布公式预热用,无行为影响;未登记型号自动跳过)
  for (i = 0; i < _MCD_N; i++) if (reps[_MCD_KEYS[i]] != null) classDispAt(_MCD_KEYS[i], reps[_MCD_KEYS[i]]);   // 散布公式代表值预热(无消费端,仅保缓存热)
}
/* 与 aiBaseDispersion 同源(同一弹道数据库,errBase 取代表值)——最远战斗距离解算专用 */
function classDispAt(modelKey, d) {
  return spreadOf(modelKey, FLOOR_ERRBASE, d);
}
/* 最远战斗距离:散布圆面积 π·(disp·D)² = 2×目标正面投影面积的解 D(公式见上注);
   disp·D 对 D 单调递增 → 二分;全区间不足 → 收敛到搜索域 2400(超出 2km 地图,无实际约束)。 */
function maxCombatDist(modelKey, targetArea) {
  var ck = modelKey + '|' + targetArea.toFixed(3);
  if (_floorCache[ck] != null) return _floorCache[ck];
  var rStar = Math.sqrt(2 * targetArea / Math.PI);
  var lo = 0, hi = 2400;
  for (var i = 0; i < 40; i++) {
    var mid = (lo + hi) / 2;
    if (classDispAt(modelKey, mid) * mid < rStar) lo = mid; else hi = mid;
  }
  _floorCache[ck] = hi;
  return _floorCache[ck];
}
/* 本车对目标 o 的交火底线(打大目标可更远);目标缺失时按平均正面面积 5m² 兜底。
   ★零分配查表(多车场卡顿根治):经字符串键的通用缓存(toFixed+'|'拼接,缓存命中也拼)在本调用面
   不可行——开火闸每帧每交战车调用,100 车×60fps≈1.2万+ 短命串/秒,
   GC 停顿经 dt 直通物理=玩家车 rubber-banding。故 6×7 数字表预计算+每车模型序终身缓存。 */
function combatFloorOf(t, o) {
  var mi = t._mcdIx; if (mi == null) mi = t._mcdIx = (_MCD_IX[dynModelKey(t)] || 0);
  var ai = o && o.group ? (o._mcdIx != null ? o._mcdIx : (o._mcdIx = (_MCD_IX[dynModelKey(o)] || 0))) : _MCD_NO;   // _MCD_NO=无目标哨位(模型序 0~N-1)
  var row = _floorTab[mi];
  if (row) return row[ai];
  return maxCombatDist(dynModelKey(t), ai === _MCD_NO ? 5 : VEHICLE_FRONTAL_AREAS[_MCD_KEYS[ai]]);   // 表未建(初始化前)兜底,罕见路径
}
var AI_HULL_VIS = 1.05;         // 车体正面视野半角(≈120° 扇面):驾驶员/车长的正前方
var AI_GUN_VIS  = 0.62;         // 炮塔/战斗室正面视野半角(≈71°):炮手瞄具方向(歼击车=车体瞄向)
/* ===== AI 黑夜视野模糊(瞄准效率随目标距离衰减;双方 AI 同款,玩家肉眼不受影响)——
   三处同乘 nightAimMul(d)/夜视收缩:① fireShell 出膛散布(坦克/歼击车直瞄弹;火箭炮齐射物理散布不动=火力对等铁律);
   ② aimGateAI 动态瞄准门随散布等比放宽(瞄到"看得清"就该扣,空磨无用);③ isNoticed 夜视半径 ×vis。 ===== */
var NIGHT_BLUR = { free: 140, full: 420, kErr: 2.2, vis: 0.78 };   // ≤140m 无罚;420m 起散布×(1+2.2)=×3.2(衰减落在实战交火域:250~320m 已 ~1.9~2.5×,不藏在视距外);夜视野半径×0.78(=250m)
function nightAimMul(d) {
  if (!isNightOf(timeHour)) return 1;
  var q = clamp((d - NIGHT_BLUR.free) / (NIGHT_BLUR.full - NIGHT_BLUR.free), 0, 1);
  q = q * q * (3 - 2 * q);                      // smoothstep:近距平、远距加速衰减(微光下发散)
  return 1 + NIGHT_BLUR.kErr * q;
}
var aimAudit = [];                              // 火控审计环(验收用):AI 直瞄每发记 {tm,d,nm};cap 600
var AI_MEM_T    = 4.0;          // 目标记忆(s):出视野后凭记忆追瞄这么久,过后判定丢失接触
var AI_ALERT_T  = 12;           // 受击/碰撞警觉(s):后方之敌打了我就想溜?记仇这么久

/* ===== 火箭弹来袭预报:全图每 0.22s 解算一次所有在飞火箭弹的预测落点,
      各 AI 只在"警觉"状态下消费它(≈提前 3s 感知),开销与火箭弹数量成正比 ===== */
var rocketThreats = [];          // [{x,z,impactAt,o}] 预测落点/绝对命中时间(秒)/射手
/* 威胁落点空间桶:maybeEvadeRocket 若逐车线性扫全表,
   齐射高峰 alert 车 × 100+ 威胁/帧 → 40m 格桶 + 3×3 邻域查询(38m 感知半径 < 40m 格宽,必然覆盖)。
   桶成员与 rocketThreats 共享对象引用;剩余时间按 impactAt-gameT 即时计算,避免逐步写回。 */
var RT_GRID_ON = true;           // 性能开关:关闭回退线性扫
var RT_CELL = 40, rocketThreatGrid = new Map();
var _rtCand = [];                // 邻域查询候选 scratch(引用拷贝,零分配)
function _rtKey(x, z) { return Math.floor(x / RT_CELL) * 4096 + Math.floor(z / RT_CELL); }
var _rkScan = { p0x: 0, p0y: 0, p0z: 0, v0x: 0, v0y: 0, v0z: 0, u: 0, tF: 0, tof0: 1 };   // 预报外推复用暂存(零分配)
var recentBursts = [];           // [{x,z,t}] 最近 4s 内的火箭爆点(惊醒"专注"状态的 AI)
var burstGridT = new Float32Array(192 * 192);   // 12m 桶最近爆点时间位图(awarenessUpdate O(48)→O(9);时间自然过期零清理)
function burstGridMark(x, z, t) {               // 爆点入账(weapons.js artilleryBurst 调用)
  var k = (Math.floor(x / 12) + 96) * 192 + (Math.floor(z / 12) + 96);
  if (t > burstGridT[k]) burstGridT[k] = t;
}
function burstNear(x, z, t) {                   // 34m 邻域内是否有 4s 内爆点(12m 桶位图近似:3×3 桶覆盖 36m 方形,语义等价)
  var kx0 = Math.floor((x - 34) / 12), kx1 = Math.floor((x + 34) / 12);
  var kz0 = Math.floor((z - 34) / 12), kz1 = Math.floor((z + 34) / 12);
  for (var kx = kx0; kx <= kx1; kx++) for (var kz = kz0; kz <= kz1; kz++) {
    if (t - burstGridT[(kx + 96) * 192 + (kz + 96)] < 4) return true;
  }
  return false;
}
var evadeLog = [];               // [{tk,t}] 逐车躲避时刻账(独立模块变量:含活体引用,绝不可挂在 dbgStats 上——__TANK_DEBUG 探针 dbg.evadeLog 读取)
var rocketScanT = 0;
function rocketThreatScan(dt) {
  if (typeof PERF_BASE !== 'undefined') PERF_BASE.rocketScan++;
  rocketScanT -= dt;
  var i;
  // 非扫描步不再遍历/写入威胁表;消费者通过 impactAt - gameT 获取精确剩余时间。
  if (rocketScanT > 0) return;
  rocketScanT = 0.22;
  // 爆点只在预报刷新拍清理,避免每个 50Hz 模拟步对数组 splice。
  for (i = recentBursts.length - 1; i >= 0; i--) if (gameT - recentBursts[i].t > 4) recentBursts.splice(i, 1);
  rocketThreats.length = 0;
  if (RT_GRID_ON) rocketThreatGrid.clear();            // 桶随全表同周期重建
  for (var si = 0; si < shells.length; si++) {
    var s = shells[si];
    if (!s.arty) continue;
    // 与实弹/红点同一口径——ROCKET_PROF 速度剖面沿解析弧外推(0.045s 细步,355m/s→16m/步);
    // A rocket more than 6 seconds from impact is not an actionable threat.
    if (!s.rk) continue;
    _rkScan.u = s.rk.u; _rkScan.tF = s.rk.tF;
    _rkScan.p0x = s.rk.p0x; _rkScan.p0y = s.rk.p0y; _rkScan.p0z = s.rk.p0z;
    _rkScan.v0x = s.rk.v0x; _rkScan.v0y = s.rk.v0y; _rkScan.v0z = s.rk.v0z; _rkScan.tof0 = s.rk.tof0;
    var tt = 0, hit = false, px = 0, py = 0, pz = 0;
    // 两阶段积分(性能):粗步 0.09s 定位触地区间(多数火箭 <2s 落地提前终止),再自粗扫上一步
    // 以 0.045s 细步精确定位(至多 3 步覆盖粗步区间;u/tF 即解析弧全状态,回退零误差)——落点/tof 与解析解一致
    var lastU = _rkScan.u, lastTF = _rkScan.tF;
    // 触地余量 +0.05m 与弹道终止判定(stepShells/simRocketImpact)同源对齐
    for (var k = 0; k < 67; k++) {
      lastU = _rkScan.u; lastTF = _rkScan.tF;
      rocketUStep(_rkScan, 0.09); tt += 0.09;
      px = _rkScan.p0x + _rkScan.v0x * _rkScan.u;
      py = _rkScan.p0y + _rkScan.v0y * _rkScan.u - 0.5 * CONF.gravity * _rkScan.u * _rkScan.u;
      pz = _rkScan.p0z + _rkScan.v0z * _rkScan.u;
      if (_rkScan.v0y - CONF.gravity * _rkScan.u < 0 && py <= terrainH(px, pz) + 0.05) { hit = true; break; }
      if (tt >= 6) break;
    }
    if (hit) {
      _rkScan.u = lastU; _rkScan.tF = lastTF; tt -= 0.09;
      for (var fk = 0; fk < 3; fk++) {
        rocketUStep(_rkScan, 0.045); tt += 0.045;
        px = _rkScan.p0x + _rkScan.v0x * _rkScan.u;
        py = _rkScan.p0y + _rkScan.v0y * _rkScan.u - 0.5 * CONF.gravity * _rkScan.u * _rkScan.u;
        pz = _rkScan.p0z + _rkScan.v0z * _rkScan.u;
        if (_rkScan.v0y - CONF.gravity * _rkScan.u < 0 && py <= terrainH(px, pz) + 0.05) { hit = true; break; }
      }
    }
    if (!hit) continue;
    if (px < -CONF.bounds - 20 || px > CONF.bounds + 20 || pz < -CONF.bounds - 20 || pz > CONF.bounds + 20) continue;
    var th = { x: px, z: pz, impactAt: gameT + tt, o: s.owner, airstrike: !!s.airstrike };
    rocketThreats.push(th);
    if (RT_GRID_ON) {                                 // 落点入桶(共享引用,tof 流逝同源)
      var rk2 = _rtKey(px, pz);
      var ra = rocketThreatGrid.get(rk2); if (!ra) { ra = []; rocketThreatGrid.set(rk2, ra); }
      ra.push(th);
    }
  }
}
/* ===== 注意力模型:警觉↔专注(带迟滞,防止边界抖动) ===== */
function awarenessUpdate(t, dt) {
  var A = t.ai;
  A.awareTick -= dt;
  if (A.awareTick > 0) return;
  A.awareTick = 0.4;                                   // 0.4s 一次,与思考节拍错开
  var aw = A.aware || 0;
  var tgt = A.targetO, engaged = false;
  if (tgt && tgt.alive) {
    var ddx = tgt.group.position.x - t.group.position.x,
        ddz = tgt.group.position.z - t.group.position.z;
    engaged = ddx * ddx + ddz * ddz < 130 * 130;       // 交战域内盯着眼前的对手
  }
  if (engaged) aw -= 0.10;                             // 对炮/缠斗 → 注意力流向眼前工作
  else aw += 0.08;                                     // 行军/换位 → 眼观六路
  if (t.reload > 1.5 && engaged) aw -= 0.05;           // 埋头装填 → 更专注
  if (gameT - (t.lastHitT || -99) < 4) aw += 0.30;     // 刚挨揍 → 惊觉
  var p = t.group.position;
  if (burstNear(p.x, p.z, gameT)) aw = Math.max(aw + 0.75, 0.72);   // 身边炸响的火箭弹把任何人当场惊醒(一次就够;12m 桶位图 O(9) 替代全表线性扫)
  A.aware = clamp(aw, 0, 1);
  if (A.alert && A.aware < 0.42) A.alert = false;      // 迟滞:0.42 失守 / 0.58 复警觉
  else if (!A.alert && A.aware > 0.58) A.alert = true;
}
/* ===== 火箭弹躲避入口(主循环每帧调用:快车/坏车不动) ===== */
function maybeEvadeRocket(t, dt) {
  var A = t.ai;
  if (!A) return;
  awarenessUpdate(t, dt);
  if (isHeliVehicle(t)) return; // 直升机不使用地面避险点
  if (A.evadeT > 0) { A.evadeT -= dt; if (A.evadeT <= 0) A.destT = 0; return; }   // 逃生完毕立刻重新评估战场
  if (!rocketThreats.length) return;                  // 无预报落点直接早退
  if (t.salvoLeft > 0) return;                         // 火箭炮齐射锁死:物理上动不了
  if (t.mods.trackL.hp <= 0 || t.mods.trackR.hp <= 0 || t.mods.engine.hp <= 0 || t.mods.fuel.hp <= 0) return;   // 动不了只能听天由命(断油同例)
  var p = t.group.position;
  var list, i;                                        // 桶开→3×3 邻域候选;关→线性全表(开关回退)
  if (RT_GRID_ON) {
    _rtCand.length = 0;
    var ccx = Math.floor(p.x / RT_CELL), ccz = Math.floor(p.z / RT_CELL);
    for (var ix2 = ccx - 1; ix2 <= ccx + 1; ix2++) for (var iz2 = ccz - 1; iz2 <= ccz + 1; iz2++) {
      var cell2 = rocketThreatGrid.get(ix2 * 4096 + iz2);
      if (cell2) for (var c2 = 0; c2 < cell2.length; c2++) _rtCand.push(cell2[c2]);
    }
    list = _rtCand;
  } else list = rocketThreats;
  for (i = 0; i < list.length; i++) {
    var th = list[i];
    /* 普通炮击仍 obeys the attention model; airstrike is a global sky warning and
       must wake/evade a vehicle even while it is focused on its current target. */
    if (!A.alert && !th.airstrike) continue;
    var tof = th.impactAt - gameT;
    if (tof > 3.0 || tof < 0.05) continue;       // 感知窗:还有 ~3s 抵达(需求设定)
    var dx = p.x - th.x, dz = p.z - th.z;
    var d2 = dx * dx + dz * dz;
    if (d2 > 52 * 52) continue;                        // 落点离自己 52m 以外:不管
    var d = Math.sqrt(d2) || 0.01;
    var ang = Math.atan2(dx / d, dz / d) + rand(-0.5, 0.5);        // 背落落点 ±28° 抖动逃生
    var rr = rand(36, 52), B = CONF.bounds - 8;                    // 逃出溅射半径(22m)2 倍以上
    var ex = clamp(p.x + Math.sin(ang) * rr, -B, B),
        ez = clamp(p.z + Math.cos(ang) * rr, -B, B);
    if (!validDest(ex, ez, t)) {
      ex = clamp(p.x + Math.sin(ang) * rr * 0.5, -B, B);
      ez = clamp(p.z + Math.cos(ang) * rr * 0.5, -B, B);
    }
    A.evadeX = ex; A.evadeZ = ez;
    A.evadeT = rand(1.7, 2.6);
    A.idleW = 0;
    if (DBG_ON) {
      dbgStats.evasions = (dbgStats.evasions || 0) + 1;
      if (evadeLog.length >= 2000) evadeLog.shift();        // 逐车躲避时刻账(审计"专注必不提前躲")
      evadeLog.push({ tk: t, t: gameT });
    }
    break;
  }
}
/* ===== 局部战况评估:半径 100m 双方战力对比 → 姿态(-1 绝对劣势 .. +1 绝对优势) ===== */
function postureUpdate(t, dt) {
  if (typeof PERF_BASE !== 'undefined') PERF_BASE.posture++;
  var A = t.ai;
  A.postT = rand(2.2, 3.2);
  var p = t.group.position, F = 0.6, E = 0.6;          // 自己计入友方底数,防除零又稳态
  var nearby = collectAiNearby(p.x, p.z, 100, _aiGridScratch);
  for (var i = 0; i < nearby.length; i++) {
    var o = nearby[i];
    if (o === t) continue;
    var dx = o.group.position.x - p.x, dz = o.group.position.z - p.z;
    if (dx * dx + dz * dz > 10000) continue;           // 只需 100m 邻域
    // 威胁权重∝单发伤害(数据驱动,无型号分支:td89 150→1.67/M1 130→1.44/坦克 90→1);
    // 火箭炮近战威胁豁免 0.35(曲射对当前战局感知低)
    var w = (o.kind === 'arty' ? 0.35 : clamp(o.dmg / 90, 0.5, 2)) *
            (0.5 + 0.5 * (o.struct / o.structMax));    // 满血计 1,残血递减
    if (!isFfaMode() && o.team === t.team) F += w; else E += w;
  }
  var adv = (F - E) / (F + E);
  A.posture += (adv - A.posture) * 0.55;               // 平滑跟踪(一阶滞后),防瞬变
}
// 迂回分队三段航线:侧翼车道 → 中场边线 → 敌后舞台(hs=出生纵深符号,s=左右翼)
/* ===== 敌方集群统计(1.5s 缓存)——质心(ex,ez)+横向 RMS 展宽 sx,迂回航线动态解算用 ===== */
var _fCluster = {}, _fClusterT = -99;
function clusterOf(team) {
  if (gameT - _fClusterT > 1.5) { _fCluster = {}; _fClusterT = gameT; }
  if (_fCluster[team]) return _fCluster[team];
  var n = 0, ex = 0, ez = 0, i, t;
  for (i = 0; i < aliveList.length; i++) {
    t = aliveList[i];
    if (t.team !== team) continue;
    n++; ex += t.group.position.x; ez += t.group.position.z;
  }
  var c;
  if (n) {
    ex /= n; ez /= n;
    var v = 0;
    for (i = 0; i < aliveList.length; i++) {
      t = aliveList[i];
      if (t.team !== team) continue;
      var dx = t.group.position.x - ex;
      v += dx * dx;
    }
    c = { n: n, ex: ex, ez: ez, sx: clamp(Math.sqrt(v / n), 120, 600) };   // sx 下限 120 防单点集群贴脸航线
  } else {
    c = { n: 0, ex: 0, ez: 0, sx: 300 };                                  // 全场暂无活敌:向中场推进的兜底集群
  }
  _fCluster[team] = c;
  return c;
}
/* ===== 战线突破口评估(flank 战略包抄用;1.5s 缓存)——在敌方战线带(集群质心 ±横向 3 格/纵向 1 格)
   内扫描密度桶:敌少/我方少/残骸少 = 薄弱,输出突破口坐标。与 sparseZone(全图最稀疏,front 过密重定向)不同:
   本函数锚定敌方战线并寻找横向缺口；无缺口时返回 null，让 flank 使用安全回退路线。 ===== */
var _weakCache = { red: null, blue: null }, _weakCacheT = { red: -99, blue: -99 };
var WEAK_CACHE_T = 1.5;
function weakSector(team) {
  if (gameT - _weakCacheT[team] < WEAK_CACHE_T) return _weakCache[team];
  _weakCacheT[team] = gameT;
  _weakCache[team] = null;
  if (!_densN) return null;
  var foe = team === 'red' ? _densE : _densF;
  var mine = team === 'red' ? _densF : _densE;
  var c = clusterOf(team === 'red' ? 'blue' : 'red');
  if (c.n <= 0) return null;                                  // 战线已消失(终局/清场)
  var bz = densBucket(c.ex, c.ez), izC = (bz / _densN) | 0;
  var ix0 = Math.max(0, (bz % _densN) - 3), ix1 = Math.min(_densN - 1, (bz % _densN) + 3);   // 横向 ±3 格(600m)
  var iz0 = Math.max(0, izC - 1), iz1 = Math.min(_densN - 1, izC + 1);                        // 纵向 ±1 格(200m 防线带)
  var best = -1, bsc = 1e18;
  for (var ix = ix0; ix <= ix1; ix++) for (var iz = iz0; iz <= iz1; iz++) {
    var b = iz * _densN + ix;
    if (foe[b] > DENS_OPP_MAX) continue;                    // 敌重兵区不突破
    var sc = sectorScore(mine[b], foe[b], _densW ? _densW[b] : 0);   // 敌少/我方少/残骸少=薄弱(与 sparseZone 同评分)
    if (sc < bsc) { bsc = sc; best = b; }
  }
  if (best < 0) return null;
  _weakCache[team] = { x: -MAP.half + ((best % _densN) + 0.5) * DENS_CELL,
                       z: -MAP.half + (((best / _densN) | 0) + 0.5) * DENS_CELL };
  return _weakCache[team];
}
/* flank 攻击段锚点:敌方高威胁型号(oppHT,指挥官受伤账评出)存活车质心;无 → 集群质心兜底 */
function flankAttackAnchor(t, c) {
  var ht = t._cmdG && t._cmdG._c ? t._cmdG._c.blueHT : null;
  if (ht) {
    var n = 0, ax = 0, az = 0;
    var roster = hostileRosterOf(t);
    for (var i = 0; i < roster.length; i++) {
      var o = roster[i];
      if (!o.alive || dynModelKey(o) !== ht) continue;
      n++; ax += o.group.position.x; az += o.group.position.z;
    }
    if (n) return { x: ax / n, z: az / n };
  }
  return { x: c.ex, z: c.ez };
}
/* 迂回侧道密度择优:在「解析内道 → 同侧物理边界」带内均布 9 候选车道,
   逐候查找 200m 残骸密度桶+敌方活车桶,取 w×W_WRECK+foe×2 最小者——
   中线残骸堆积自动外推航线(利用地图全宽);平分取内道(少绕路)。
   密度桶未就绪(开局首秒)回退原解析式。O(9),航点推进/重选目的地时调用。 */
function laneXBest(t, c, s, rng) {
  var fallback = clamp(c.ex + s * clamp(c.sx + 0.5 * rng, c.sx + 150, 780), -780, 780);
  if (!_densN || !_densW) return fallback;
  var foeD = t.team === 'red' ? _densE : _densF;
  var inner = c.ex + s * (c.sx + 150);
  var outer = s * 780;
  var lo = clamp(Math.min(inner, outer), -780, 780), hi = clamp(Math.max(inner, outer), -780, 780);   // 端点钳边山界(inner 偏翼大展宽可越 780)
  var best = fallback, bsc = 1e18;
  for (var k = 0; k < 9; k++) {
    var x = lo + (hi - lo) * k / 8;
    var sc = _densW[densBucket(x, c.ez)] * W_WRECK + foeD[densBucket(x, c.ez)] * 2;
    if (sc < bsc) { bsc = sc; best = x; }
  }
  return best;
}
function flankWP(t, i, tgt) {
  /* 战略包抄:三段锚点——
     wp0 出发:本域外翼侧道(保留);
     wp1 突破:战线突破口 weakSector 横向 + 敌前沿向我方 200m(侧翼接近缺口,避正面交火区);
     wp2 攻击:敌方高威胁型号(oppHT)存活车质心侧后 250m(突袭高威胁小组);无 oppHT → 集群侧后。
     敌防线均匀时回退到集群同深度，再移动到侧后 220m。 */
  var A = t.ai;
  var c = clusterOf(t.team === 'red' ? 'blue' : 'red');
  var s = (t._cmdG && t._cmdG.side) || 1;      // 同组同侧(指挥官分边),全班走同一走廊
  var hs = homeSignOf(t);
  var rng = combatFloorOf(t, tgt);   // 本车对当前目标的交火底线(散布×目标正面面积解算)
  // 侧道宽度改锚作战距离(组级 floorDist 同公式)——组级命中率乘数:低命中率组侧道收窄(拉近距离)
  var cF = (t._cmdG && t._cmdG._c ? t._cmdG._c.floorDist : 0) * gAimMul(t);
  if (cF > 0) rng = Math.min(rng, Math.max(cF * 1.1, 150));
  var laneX = laneXBest(t, c, s, rng);   // 侧道(出发段横向锚;密度最低:残骸+敌活车打分)
  if (i <= 0) return { x: laneX, z: (A.homeZ || hs * 800) + (c.ez - (A.homeZ || hs * 800)) * 0.35 };   // 出发段:本域 35% 深度切入侧道
  var weak = weakSector(t.team === 'red' ? 'blue' : 'red');
  if (weak) {
    if (i === 1) return { x: clamp(weak.x + s * 150, -780, 780), z: clamp(c.ez + hs * 200, -CONF.bounds + 8, CONF.bounds - 8) };   // 突破段:薄弱带横向+敌前沿我方侧 200m
    var atk = flankAttackAnchor(t, c);                                                                    // 攻击段锚:oppHT 质心(无则集群质心)
    var tbF = tacBestNear(clamp(atk.x + s * 150, -780, 780), atk.z - hs * 250, atk.x, atk.z, t.team);    // 侧后 250m 锚吸附邻域高分格(包抄到位有射界)
    return { x: tbF.x, z: tbF.z };
  }
  if (i === 1) return { x: laneX, z: c.ez };                                            // Fallback: hold at the enemy cluster depth on the outer lane.
  var tbO = tacBestNear(clamp(c.ex + s * clamp(c.sx + 0.25 * rng, 120, 600), -780, 780), c.ez - hs * 220, c.ex, c.ez, t.team);
  return { x: tbO.x, z: tbO.z };                         // Fallback: close from the rear through the best nearby tactical cell.
}
// Return the intact wreck blocking the gun-to-target ray.
var _pkTop = [null, null, null], _pkTopD = [Infinity, Infinity, Infinity];
var _pkTopF = [null, null, null], _pkTopFD = [Infinity, Infinity, Infinity];   // 前半球堆(pickTarget 单趟双维护用)
function pickTarget(t) {
  if (typeof PERF_BASE !== 'undefined') PERF_BASE.targetPick++;
  var A = t.ai, p = t.group.position, i;
  var roster = hostileRosterOf(t);
  // One allocation-free scan maintains the nearest three all-around and front-sector targets.
  var nFront = 0, nAll = 0;
  _pkTopD[0] = _pkTopD[1] = _pkTopD[2] = Infinity;
  _pkTopFD[0] = _pkTopFD[1] = _pkTopFD[2] = Infinity;
  for (i = 0; i < roster.length; i++) {
    var o = roster[i];
    if (!areHostile(t, o)) continue;
    var dx = o.group.position.x - p.x, dz = o.group.position.z - p.z;
    nAll++;
    var d2 = dx * dx + dz * dz;
    // 优先采用前半球电台接触;但前方为空时必须保留全向“行军目标”,否则 targetO=null 会触发 aiUpdate 刹停并永久发呆。
    var isFront = Math.abs(normAng(Math.atan2(dx, dz) - t.yaw)) <= 1.45;
    if (isFront) {
      nFront++;
      for (var kf = 0; kf < 3; kf++) {                 // 前向三槽最小扫描:严格小于才移位,相等保持先入序(与稳定排序等价)
        if (d2 < _pkTopFD[kf]) {
          for (var mf = 2; mf > kf; mf--) { _pkTopFD[mf] = _pkTopFD[mf - 1]; _pkTopF[mf] = _pkTopF[mf - 1]; }
          _pkTopFD[kf] = d2; _pkTopF[kf] = o;
          break;
        }
      }
    }
    for (var k = 0; k < 3; k++) {                      // 全向三槽最小扫描(useFront=false 时的兜底堆)
      if (d2 < _pkTopD[k]) {
        for (var m = 2; m > k; m--) { _pkTopD[m] = _pkTopD[m - 1]; _pkTop[m] = _pkTop[m - 1]; }
        _pkTopD[k] = d2; _pkTop[k] = o;
        break;
      }
    }
  }
  if (!nAll) { A.targetO = null; return; } // 全场确实无活敌才允许停
  var useFront = nFront > 0;
  var topN = Math.min(3, useFront ? nFront : nAll);   // Select from at most the three nearest candidates.
  A.targetO = (useFront ? _pkTopF : _pkTop)[Math.floor(Math.random() * topN)];
  A.destT = 0;                                      // 新行军目标立即重算路线,不沿用原地 hold 点
  A.thinkT = 0;                                     // 即使目标在两个思考节拍之间阵亡,也在本帧生成新路线
}
/* ===== 受击警觉:打我者进入仇视名单(击穿经 applyModuleDamage;跳弹/未击穿经 resolveHit;溅射经破片) ===== */
function noteAttacked(t, att) {
  if (!t || !t.ai || !att || att === t || !att.team || (!isFfaMode() && att.team === t.team)) return;
  t.ai.alertFoe = att; t.ai.alertFoeT = gameT;
}
/* ===== 双重视野:车体正面扇面(驾驶员/车长)+ 炮塔/战斗室正面扇面(炮手瞄具)。
      后方之敌不可见;挨了打(≤AI_ALERT_T 内)或被撞上 → 无论方位立即警觉 ===== */
function isNoticed(t, o, dist) {
  var A = t.ai;
  if (A.alertFoe === o && gameT - A.alertFoeT < AI_ALERT_T) return true;   // 受击警觉
  if (A.bumpFoe === o && gameT - A.bumpT < AI_ALERT_T) return true;        // 碰撞警觉
  if (dist > aiVisRange(t) * (isNightOf(timeHour) ? NIGHT_BLUR.vis : 1)) return false; // 视距=aiVisRange 档位(坦克 800/M1 1200/红方歼击车 1500/火箭炮 2000),黑夜同乘视距衰减
  var p = t.group.position, q = o.group.position;
  var b = Math.atan2(q.x - p.x, q.z - p.z);
  if (Math.abs(normAng(b - t.yaw)) < AI_HULL_VIS) return true;             // 车体正面看见
  if (Math.abs(normAng(b - (t.yaw + t.turretYaw))) < AI_GUN_VIS) return true;   // 炮口/瞄具方向看见
  return false;
}
/* ===== 感知缓存(16Hz):isNoticed 每帧调用与 _exposed 0.15s 调用重复计算同一组三角,
       缓存窗远低于思考节拍,开火/追踪反应无感;alertFoe/bumpFoe 事件路径不受影响(12s 量级) ===== */
var SEEN_CACHE_T = 0.06;
function isNoticedCached(t, o, dist) {
  var A = t.ai;
  if (A._seenO === o && A._seenT != null && gameT - A._seenT < SEEN_CACHE_T) return A._seenOK;
  var ok = isNoticed(t, o, dist);
  A._seenO = o; A._seenT = gameT; A._seenOK = ok;
  return ok;
}
/* ===== 动态瞄准门:瞄到"误差低于自身散布"就够,更细纯属装填完毕空等。
      散布公式与 fireShell 同源(弹道数据库 spreadOf),门取 ~1σ(±均匀分布×0.6)。 ===== */
function aiBaseDispersion(t, dist) {   // 玩家/AI 统一散布(调弹道数据库;分车型参数见 MODEL_SPREAD)
  if (t.kind === 'arty') return spreadOf('arty', 0, 0);              // 火箭炮瞄准散布(齐射物理散布 ARTY_SALVO_*=弹体属性亦不动)
  var eb = t.errBase != null ? t.errBase : (t.ai && t.ai.errBase != null ? t.ai.errBase : 1);   // 车组散布系数:玩家与 AI 同样在出生时 rand(0.08,0.14)
  if (t.kind === 'aa') return spreadOf(t.team === 'red' ? 'wz10' : 'ah64', eb, dist);   // 防空机炮=直升机机炮性能(散布同吃直升机档)
  /* Improved 105mm is the player's red MBT-1 gun only: use RED-MBT-2's radius formula ×2. */
  if (t.isPlayer && typeof vehicleTechInstalled === 'function' && vehicleTechInstalled(t, 'improved-105')) {
    return spreadOf('t99', eb, dist) * 2;
  }
  return spreadOf(dynModelKey(t), eb, dist);                         // 基础主战坦克→tank 档;89→td89;BLUE_MBT_2→m1a1
}
function aimGateAI(t, adist) {
  // 激光压制不是散布惩罚:AI 火控在脱离光束前完全暂停,不继续伺服或开火。
  if (t && t._laserSuppressed) return Infinity;
  // 统一瞄准门:误差低于自身散布×0.6 就够(钳 0.012~0.12);夜间随像管外微光模糊放宽。
  var base = aiBaseDispersion(t, adist) * (t.ai ? nightAimMul(adist) : 1);
  return clamp(base * 0.6, 0.012, 0.12);
}

/* ===== 威胁度评分:目标距离越近越危(wD)+ 目标炮口越指向我越危(wM)+ 我炮口到位路程越短越优先(wS) ===== */
function threatScore(t, o, dist) {
  var p = t.group.position, q = o.group.position;
  var wD = 1 - clamp(dist / aiVisRange(t), 0, 1);                                  // 距离因子按平台视距归一(红方歼击车远瞄)
  var off = Math.abs(normAng(Math.atan2(p.x - q.x, p.z - q.z) - (o.yaw + o.turretYaw)));   // 敌炮口相对"敌→我"的偏角
  var wM = off <= 1.45 ? Math.cos(off) : 0;                                         // 炮口因子(直指=1,垂直≈0,背向=0)
  var bMy = Math.atan2(q.x - p.x, q.z - p.z);                                       // 我→敌 方位
  var slew = Math.abs(normAng(normAng(bMy - t.yaw) - t.turretYaw));    // 炮塔还需转过的角度(直瞄路程)
  var wS = 1 - clamp(slew / Math.PI, 0, 1);                                         // 到位路程因子
  return wD * 1.0 + wM * 0.9 + wS * 0.55;
}
/* ===== 威胁火控选目标(思考节拍调用):视野扫描刷新记忆 → 评分 → 迟滞切换。
      全场无前向 contact 时，从最近的三个全向目标中选择。 ===== */
function pickThreat(t) {
  if (typeof PERF_BASE !== 'undefined') PERF_BASE.threatPick++;
  var A = t.ai, p = t.group.position, i, k;
  for (i = A.known.length - 1; i >= 0; i--) {          // 记忆维护:阵亡/塌毁/遗忘 → 除名
    var kn = A.known[i];
    if (!kn.o.alive || gameT - kn.t > AI_MEM_T) A.known.splice(i, 1);
  }
  /* 全表重扫 1s 周期(若每 think 0.3~0.5s 重扫:数百×数百三角函数/秒=aiCore 主体);
     周期内仅验证当前目标——换台驻留门 2.2s 决定更快重扫毫无收益;目标失效才提前重扫。 */
  if (A._fullScanT == null) A._fullScanT = gameT - rand(0, 1);   // 首扫相位随机化:开局/清场所有车同帧全扫 → 按 1s 窗摊开
  var cur0 = A.targetO;
  if (cur0 && cur0.alive && gameT - (A._fullScanT || -99) < 1.0) {
    var pdx = cur0.group.position.x - p.x, pdz = cur0.group.position.z - p.z;
    if (isNoticed(t, cur0, Math.sqrt(pdx * pdx + pdz * pdz)) || gameT - (A.tgtT || 0) < AI_MEM_T) return;
  }
  A._fullScanT = gameT;
  if (typeof PERF_BASE !== 'undefined') PERF_BASE.targetScan++;
  var best = null, bestS = -1, curS = -1;
  var _vr = aiVisRange(t) * (isNightOf(timeHour) ? NIGHT_BLUR.vis : 1), _vr2 = _vr * _vr;   // 视距平方早拒
  // 大视距(坦克800/BLUE_MBT_2 1200/TD89 1500m)相对 2km 地图几乎全覆盖,空间预筛失效;
  // 改直接用敌方 roster(与 aiGrid 同帧同源 0.25s 重建,陈旧度/成员逐位一致)——免 289~961 次 Map.get 大范围遍历 + 免双队候选/team 过滤;
  // alertFoe/bumpFoe 本就在 roster(活敌),由下方 d2 过滤的 o!==alertFoe/bumpFoe 豁免 + isNoticed 警觉 return true 兜住。
  var nearby = hostileRosterOf(t);
  for (i = 0; i < nearby.length; i++) {
    var o = nearby[i];
    if (!areHostile(t, o)) continue;
    var dx = o.group.position.x - p.x, dz = o.group.position.z - p.z;
    var d2 = dx * dx + dz * dz;
    if (d2 > _vr2 && o !== A.alertFoe && o !== A.bumpFoe) continue;   // 免 sqrt 早拒(警觉目标豁免,保 isNoticed 语义)
    var d = Math.sqrt(d2);
    if (!isNoticed(t, o, d)) continue;
    var rec = null;
    for (k = 0; k < A.known.length; k++) if (A.known[k].o === o) { rec = A.known[k]; break; }
    if (rec) rec.t = gameT; else if (A.known.length < 40) A.known.push({ o: o, t: gameT });
    var s = threatScore(t, o, d);
    // 迂回组:高威胁目标加成(压过 wD≤1+wM≤0.9+wS≤0.55 距离分,换台门限 1.35~1.6× 可被顶开)
    // ★直升机显式豁免:本条是指挥官系统唯一能改写直升机行为的通路(aiHeliUpdate 调用 pickThreat);
    //   直升机不归指挥官指挥,其选敌优先级只由空战威胁度+直升机负载均衡决定,不吃地面组的迂回加成。
    if (t._cmdG && !isHeliVehicle(t) && t._cmdG.role === 'flank' && t._cmdG._c.blueHT && dynModelKey(o) === t._cmdG._c.blueHT) {
      s += 2.0;
    }
    // 直升机多目标负载均衡去重:若目标已有 2 架及以上友军直升机在锁定/攻击,对多余直升机降权
    if (isHeliVehicle(t)) {
      var fHeli = isFfaMode() ? aliveList : friendlyRosterOf(t);
      var crowdHeli = 0;
      for (var fhi = 0; fhi < fHeli.length; fhi++) {
        if (areFriendly(t, fHeli[fhi]) && fHeli[fhi].alive && fHeli[fhi].ai && fHeli[fhi].ai.targetO === o) {
          crowdHeli++;
        }
      }
      if (crowdHeli >= 2) s *= 0.45;
    }
    if (A.alertFoe === o && gameT - A.alertFoeT < AI_ALERT_T) s += 1.5;   // 正在打我(≤12s 命中) → 威胁度飙升
    if (o === A.targetO) curS = s;
    if (s > bestS) { bestS = s; best = o; }
  }
  if (!best) {
    if (!A.targetO || !A.targetO.alive) pickTarget(t);   // With no usable contact, search all directions while fire control keeps its LOS gate.
    return;
  }
  var cur = A.targetO, curKnown = false;
  if (cur && cur.alive) {
    for (k = 0; k < A.known.length; k++) if (A.known[k].o === cur) { curKnown = true; break; }
  }
  if (!curKnown) {                                     // Stale or destroyed target: take the highest current threat.
    A.targetO = best; A.tgtT = gameT;
    return;
  }
  if (best !== cur) {
    // 反换台抖动(守火力不间断):当前目标"已咬住"= 炮口基本指向 + 在交战距离 + 仍被注意 → 绝不换台;
    // 否则也要明显更优(1.6×)且驻留满 2.2s 才换——换台后炮塔/车体要重转,转的那几秒就是哑火
    var cb = Math.atan2(cur.group.position.x - p.x, cur.group.position.z - p.z);
    var cslew = Math.abs(normAng(normAng(cb - t.yaw) - t.turretYaw));
    var cdq = Math.sqrt((cur.group.position.x - p.x)*(cur.group.position.x - p.x)+(cur.group.position.z - p.z)*(cur.group.position.z - p.z));
    var biting = cslew < 0.12 && cdq < combatFloorOf(t, cur);   // 已咬住=炮口基本指向+在交火底线内(不换台)
    // 已咬住的换台门限更高(1.35×)——常规小鬼换不走,但"正在打我"的偷袭者(评分+1.5)能顶开 换台反打
    if (gameT - A.tgtT > 2.2 && bestS > curS * (biting ? 1.35 : 1.6) + 0.08) {
      A.targetO = best; A.tgtT = gameT;
    }
  }
}
// 射线上是否有友军(防止排队枪毙自己人)
function hasFriendInLine(t, aimYaw, dist) {
  if (isFfaMode()) return false;
  var p = t.group.position;
  var roster = friendlyRosterOf(t);                     // 个人死斗无友军，团队死斗使用本队紧凑表
  for (var i = 0; i < roster.length; i++) {
    var o = roster[i];
    if (o === t || !o.alive) continue;                   // Grid-cache guard; aliveList remains the live authority.
    var dx = o.group.position.x - p.x, dz = o.group.position.z - p.z;
    var d2 = dx * dx + dz * dz;
    if (d2 > dist * dist || d2 <= 9) continue;           // 平方早拒(3m 内贴身不构成射线上友军)
    var d = Math.sqrt(d2);
    var off = Math.abs(normAng(Math.atan2(dx, dz) - aimYaw));
    if (off < Math.atan2(o.radius * 1.8, d)) return true;
  }
  return false;
}
/* ===== 高频逻辑治理缓存 ——
   ① friendInLine 0.2s 缓存:友军线变化缓(双方都在低速机动),装填就绪车每帧全表 sqrt+atan2 是热点;
   ② steerCached 10Hz 缓存:avoidSteer 每帧扫全障碍表+全残骸表(~600+ 迭代/车),避让场由静态障碍+
      缓移残骸构成,0.1s 陈旧度在碰撞系统兜底下零感知;输入方向突变(>25%)立即重评,不死等窗口。 ===== */
function friendInLineCached(t, aimYaw, dist) {
  var A = t.ai;
  if (A._frT != null && gameT - A._frT < 0.2) return A._frOK;
  var ok = hasFriendInLine(t, aimYaw, dist);
  A._frT = gameT; A._frOK = ok;
  return ok;
}
function steerCached(t, dx, dz) {
  var A = t.ai;
  if (A._stT != null && gameT - A._stT < 0.1) {
    var chg = Math.abs(A._stInX - dx) + Math.abs(A._stInZ - dz);
    if (chg < (Math.sqrt((dx)*(dx)+(dz)*(dz)) * 0.25 + 0.5)) return _steerOut.set(A._stDx, A._stDz);
  }
  var _t0 = (window._dbgPerfOn && window.__PERF) ? performance.now() : 0;   // aiCore 子段探针:避障 steer 耗时
  var r = avoidSteer(t, dx, dz);
  if (_t0) window.__PERF.steerT += performance.now() - _t0;
  A._stT = gameT; A._stInX = dx; A._stInZ = dz; A._stDx = r.x; A._stDz = r.z;
  return _steerOut.set(r.x, r.z);
}
var _steerOut = { x: 0, z: 0, set: function (x, z) { this.x = x; this.z = z; return this; } };

/* ===== 被友军挡射线 → 沿射线的垂线方向错车几米找射击窗(错车全程炮塔伺服不停,窗开即打);
      按 0.9s 周期执行左右交替小碎步,避免整目的地重掷造成长时间停火。 ===== */
function sideStepForShot(t, worldAim) {
  var A = t.ai;
  if (t._cmdG && t._cmdG._detached && sqCmd.active) return;   // 指挥接管成员不错车:目的地=玩家指令绝对(带内环点本就是射击位)
  if (A.mode === 'advance' || A.mode === 'flankrun' || A.mode === 'charge' || A.mode === 'control') return;   // 推进/冲锋/控制区行军段:不错车,保住推进速度底线
  if (!A.sideS) { A.sideS = Math.random() < 0.5 ? 1 : -1; A.sideT = gameT + 1.6; }
  else if (gameT > (A.sideT || 0)) { A.sideT = gameT + 1.6; A.sideS = -A.sideS; }   // 同侧堵满一拍才翻面(2.2→1.6s 更积极找窗)
  var px = Math.cos(worldAim), pz = -Math.sin(worldAim);       // 射向 (sin a, cos a) 的垂直向量
  A.destX = clamp(t.group.position.x + px * 12 * A.sideS, -CONF.bounds + 8, CONF.bounds - 8);
  A.destZ = clamp(t.group.position.z + pz * 12 * A.sideS, -CONF.bounds + 8, CONF.bounds - 8);
  A.destT = Math.max(A.destT, 0.6);                            // 错车点要活过下一拍思考,否则立刻被随机目的地覆盖
}

// 某点附近 16m 内的存活友军数(散开队形用)
function ownCrowding(t, x, z) {
  if (isFfaMode()) return 0;
  var n = 0;
  var nearby = collectAiNearby(x, z, 16, _crowdScratch);   // 空间邻域预筛(半径 16m < 100m 格,候选=全表同口径)
  for (var i = 0; i < nearby.length; i++) {
    var o = nearby[i];
    if (o === t || !o.alive || (isFfaMode() ? false : o.team !== t.team)) continue;   // 个人死斗无友军队形约束
    var dx = o.group.position.x - x, dz = o.group.position.z - z;
    if (dx * dx + dz * dz < 256) n++;
  }
  return n;
}
// 目的地合法性:界内、不压障碍物/残骸
function validDest(x, z, tOpt, skipRegion) {
  var B = CONF.bounds - 8;
  if (x < -B || x > B || z < -B || z > B) return false;
  // 障碍网格邻域查询(静态注册/事件驱动;范围=最大障碍半径+判定半径,候选集与全表逐位一致)
  var nObs = obstaclesNear(x, z, obstacleMaxR + 4, _obsNear);
  for (var oi = 0; oi < nObs; oi++) {
    var o = _obsNear[oi];
    if (Math.sqrt((x - o.x)*(x - o.x)+(z - o.z)*(z - o.z)) < o.r + 4) return false;
  }
  // 残骸查 wreckGrid 3×3 邻域(注册源=killTank,推动跨格由 wreckGridUpdate 重注册,
  // The neighborhood covers the full collision radius (radius + 3 ≈ 5.9 m).
  var cx = Math.floor(x / 20), cz = Math.floor(z / 20);
  for (var ix = cx - 1; ix <= cx + 1; ix++) for (var iz = cz - 1; iz <= cz + 1; iz++) {
    var warr = wreckGrid.get(ix * 4096 + iz);
    if (!warr) continue;
    for (var wi = 0; wi < warr.length; wi++) {
      var w = warr[wi];
      if (Math.sqrt((x - w.group.position.x)*(x - w.group.position.x)+(z - w.group.position.z)*(z - w.group.position.z)) < w.radius + 3) return false;
    }
  }
  // P1 slope gate: reject destinations above 85% of the vehicle limit.
  // P2 连通域预查:起终已证异域 ⇒ 不可选(任一端 -1 则 fail-open，留给 spiral/AI；flank 探索传 skipRegion=1 绕过)
  if (!skipRegion && tOpt && tOpt.group && tOpt.group.position && typeof SIM_K !== 'undefined' && SIM_K > 0 &&
      typeof navRegionOf === 'function' && typeof navGroupOf === 'function') {
    var rgG = navGroupOf(tOpt);
    if (rgG !== null) {
      var rA = navRegionOf(tOpt.group.position.x, tOpt.group.position.z, rgG);
      var rB = navRegionOf(x, z, rgG);
      if (rA > 0 && rB > 0 && rA !== rB) return false;
    }
  }
  if (tOpt && tOpt.mob && typeof SIM_K !== 'undefined' && SIM_K > 0) {
    slopeVecAt(x, z, _vdSlope);
    if (_vdSlope.tan > mobDerived(tOpt.mob)._tanMax * 0.85) return false;
  }
  return true;
}
var _vdSlope = { gx: 0, gz: 0, tan: 0 };   // validDest 坡度门 scratch
var _segSlope = { gx: 0, gz: 0, tan: 0 };   // navSegReach 航段抽查 scratch
/* 航段可达性(P1/P2 共用):起点→终点 8 等分实时坡度抽查,返回 0~1 可达比例(1=全通)。
   limTan>0 用指定极限(寻路组极限),否则用本车极限。 */
function navSegReach(t, fx, fz, tx, tz, limTan) {
  var lim = limTan > 0 ? limTan : mobDerived(mobOf(t))._tanMax;
  if (typeof navSegBlocked === 'function') return navSegBlocked(fx, fz, tx, tz, lim);   // P0: use the supercover validator; use a 25 m fallback when ai_nav is absent.
  var dxS = tx - fx, dzS = tz - fz;
  var nS = Math.ceil(Math.sqrt(dxS * dxS + dzS * dzS) / 25);   // 采样密度≈25m(8样本/400m 腿漏检窄山脊→V2 永不触发;soak 定案)
  if (nS < 8) nS = 8; else if (nS > 64) nS = 64;
  var lastOk = 0;
  for (var i = 1; i <= nS; i++) {
    var f = i / nS;
    slopeVecAt(fx + (tx - fx) * f, fz + (tz - fz) * f, _segSlope);
    if (_segSlope.tan > lim) return lastOk;
    lastOk = f;
  }
  return 1;
}
// 两点间视线是否被 地形反斜/障碍物/残骸 遮挡(losBlockedAt = 真掩体判定;地形采样与开火闸同口径自适应步数)
/* 静态射线阻挡判定核心(开火视线 hasLineOfSight / 掩体判定 同源): 地形先行短路 + staticOnly 射线 + 障碍/残骸 */
function losBlockedAt(ax, ay, az, bx, by, bz) {
  var i;
  var dTB = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay) + (bz - az) * (bz - az));
  if (terrainBlocksLine(ax, ay, az, bx, by, bz, dTB)) return true;
  var hits = worldRaycast(ax, ay, az, bx, by, bz, true);   // staticOnly:活车不遮挡掩体判定,跳过动态表
  for (i = 0; i < hits.length; i++) {
    var ud = hits[i].object.userData;
    if (ud.obstacle) return true;
    if (ud.tank && !ud.tank.alive) return true;
  }
  return false;
}

function friendProx(t, x, z, r) {
  if (isFfaMode()) return false;
  var nearby = collectAiNearby(x, z, r, _proxScratch);   // 空间邻域预筛(r≤12m 必落 3×3 格,候选=全表同口径)
  for (var fi = 0; fi < nearby.length; fi++) {
    var f = nearby[fi];
    if (f === t || !f.alive || f.team !== t.team) continue;   // aiGrid 0.25s 陈旧,活车守卫保与 aliveList 即时口径一致
    var ddx = f.group.position.x - x, ddz = f.group.position.z - z;
    if (ddx * ddx + ddz * ddz < r * r) return true;
  }
  return false;
}
/* 己方半场方向符号(走廊/护卫/火箭炮回防共用;homeZ 未设时按出生线+半场翻转兜底) */
function homeSignOf(t) {
  var A = t.ai;
  var hz = A.homeZ || (t.team === 'red' ? CONF.redSpawnZ : CONF.blueSpawnZ) * spawnFlip;
  return Math.sign(hz) || 1;
}

// —— 模式化目的地决策 ——
/* 环带目的地生成(charge/advance 共用):以 (cx,cz) 为环带中心,沿"中心→本车"方向 ±jitter 抖动,
   半径 r 处取点(validDest 校验;边界失败减半重试)。返回 {x,z} 或 null。 */
function ringDest(p, cx, cz, r, jitter, tOpt) {
  var a = Math.atan2(p.x - cx, p.z - cz) + rand(-jitter, jitter);
  var nx = cx + Math.sin(a) * r, nz = cz + Math.cos(a) * r;
  if (validDest(nx, nz, tOpt)) return { x: nx, z: nz };
  nx = cx + Math.sin(a) * r * 0.5; nz = cz + Math.cos(a) * r * 0.5;   // 减半重试(边界压缩)
  if (validDest(nx, nz, tOpt)) return { x: nx, z: nz };
  return null;
}
/* 前方判定(冲锋中 cover 专用):点 (x,z) 是否在本车→目标的"前扇区"(点积>0,±90° 内) */
function isFwdOf(px, pz, gx, gz, x, z) {
  return (x - px) * (gx - px) + (z - pz) * (gz - pz) > 0;
}
function pickAIDest(t, tgt, dist) {
  var A = t.ai, p = t.group.position, gp = tgt.group.position;
  var B = CONF.bounds - 10, nx, nz, i, tries;
  // 交火底线接通迂回通路——c.floorDist(散布圆=2×敌正面投影面积解算的最远战斗距离);
  // 底线外=charge 冲锋由单车交火底线接管(不设组级强制推进 floorFrac)
  var cF1 = ((t._cmdG && t._cmdG._c) ? t._cmdG._c.floorDist : 0) * gAimMul(t);   // No high-threat enemy means no range floor; poor groups engage earlier.
  var flankOn = !!(t._cmdG && t._cmdG.role === 'flank' && A.wpI >= 3);   // 迂回到位(航线走完,敌侧后)

  var hurt = t.struct < t.structMax * 0.45;
  var crit = t.fire || t.mods.trackL.hp <= 0 || t.mods.trackR.hp <= 0 ||
             t.mods.engine.hp <= 0 || t.mods.fuel.hp <= 0 || t.mods.turret.hp <= 0 || t.mods.gun.hp <= 0;   // 断油=重创(丧失机动)
  var underFire = (gameT - (t.lastHitT || -99)) < 4;            // 刚被揍 → 先保命

  // —— 指挥接管组(玩家指令绝对):follow=跟走玩家 / occupy=围旗行动环 ——
  //    带外直追(执行段按 charge 口径全速)+带内行动环随机点;多点尝试全败兜底直取锚。
  //    本分支恒 return:后方交战模式(charge/cover/hold/flank)对指挥成员永不生效;
  //    火控层(LOS 换位/错车/jink)对本分支产物只读不改写(见各处 _detached 门)。
  if (t._cmdG && t._cmdG._detached && sqCmd.active) {
    var anc = sqCmdAnchor(t);
    if (anc) {
      if (Math.sqrt((anc.x - p.x)*(anc.x - p.x)+(anc.z - p.z)*(anc.z - p.z)) > anc.chase) { sqCmdDest(t, anc, p); return; }   // 带外:直追锚点
      for (var sg = 0; sg < 6; sg++) {                     // 带内:行动环多点尝试(残骸/障碍密布战场,单点常撞车)
        var sAng = rand(0, Math.PI * 2), sR = rand(anc.rN, anc.rF);
        var sx2 = clamp(anc.x + Math.cos(sAng) * sR, -B, B), sz2 = clamp(anc.z + Math.sin(sAng) * sR, -B, B);
        if (validDest(sx2, sz2, t)) {
          A.mode = 'guard'; A.destX = sx2; A.destZ = sz2;
          A.destT = rand(0.6, 1.4);
          return;
        }
      }
      sqCmdDest(t, anc, p); return;                        // 全不可达兜底:直取锚点(不再落入通用追敌树)
    }
  }
  // —— 护卫小组(常规编组):紧贴被保护小组(己方高威胁型号),站其我方一侧 18~30m ——
  if (t._cmdG && t._cmdG.role === 'guard' && t._cmdG.protectGroup) {
    var pg = t._cmdG.protectGroup, pn = 0, pcx = 0, pcz = 0;
    for (var pi = 0; pi < pg.members.length; pi++) {
      var pm = pg.members[pi];
      if (!pm.alive) continue;
      pn++; pcx += pm.group.position.x; pcz += pm.group.position.z;
    }
    if (pn) {
      pcx /= pn; pcz /= pn;
      var hs2 = homeSignOf(t);
      for (var gt = 0; gt < 6; gt++) {                 // 多点尝试:残骸/障碍密布战场,单点常撞车
        var gdx = clamp(pcx + rand(-14, 14), -B, B);
        var gdz = clamp(pcz + hs2 * rand(18, 30), -B, B);
        if (validDest(gdx, gdz, t)) {
          A.mode = 'guard';
          A.destX = gdx; A.destZ = gdz;
          A.destT = rand(2, 3.5);
          return;
        }
      }
    }
    // 无存活被保护单位 / 候选点全不可达 → 落入通用模式决策(下个决策期会重新分派角色)
  }

  // —— 控制区目标:高优先级进攻任务(仅 TDM+Control Zones ON) ——
  //     空控制区/敌方控制区由 control-zones.js 排序;普通远距战术目标不再
  //     抢走任务。只在近距离贴脸、重创或刚受火时让位，保留必要的生存/交战门。
  //     detached sqCmd 成员在上方已经返回，玩家小队指令绝不被这里改写。
  var czTarget = typeof controlZoneAiTargetForTank === 'function' ? controlZoneAiTargetForTank(t) : null;
  var czRoleOK = !t._cmdG || t._cmdG.role !== 'flank' || A.wpI >= 3;
  var czContactSafe = !A._exposed || dist > 220;
  if (czTarget && czRoleOK && !crit && !underFire && dist > 120 && czContactSafe) {
    var czDest = typeof controlZoneAiPickDestination === 'function' ? controlZoneAiPickDestination(t, czTarget) : null;
    if (czDest) {
      A.mode = 'control';
      A.destX = czDest.x; A.destZ = czDest.z;
      return;
    }
  }

  // 所有载具统一走通用决策树(无型号专属站位;平台差异仅数值:射程/散布/视距)

  // —— 迂回分队:大纵深侧翼包抄(航线未满 + 无重创 + 未贴身缠斗 → 沿航线赶路) ——
  // 赶路门限=作战距离 90%(坦克≈216/BLUE_MBT_2≈315m 即停赶路转接敌,避免冲到 70m 贴脸)
  var engageD = Math.max(70, cF1 > 0 ? cF1 * 0.9 : 70);
  if (t._cmdG && t._cmdG.role === 'flank' && A.wpI < 3 && !crit && dist > engageD) {   // 迂回角色=指挥官分组
    var wp = flankWP(t, A.wpI, tgt);
    var wpd = Math.sqrt((wp.x - p.x)*(wp.x - p.x)+(wp.z - p.z)*(wp.z - p.z));
    if (wpd < 18 || !validDest(wp.x, wp.z, t)) A.wpI++;            // 抵达/不可达 → 跳下一段
    else {
      A.mode = 'flankrun';
      A.destX = wp.x; A.destZ = wp.z;
      return;
    }
  }

  // —— 局部战况姿态:优势(posture≈+1)→ 激进压上;劣势(≈-1)→ 保守据守或殊死一搏 ——
  var post = A.posture || 0;
  var agro = post > 0.28, losing = post < -0.28;
  if (t._cmdG && t._cmdG.role === 'flank' && A.wpI >= 3) agro = true;            // 迂回到位:从敌背侧开打,永久激进
  var covReloadP = agro ? 0.30 : (losing ? 0.78 : 0.6);         // 装填躲掩体概率
  var covFireP = agro ? 0.35 : (losing ? 0.82 : 0.65);          // 刚挨揍躲掩体概率
  var banzai = losing && !t.fire && dist < 150 && Math.random() < 0.24;   // 劣势殊死一搏

  var mode;
  // 模式分界按交火底线(combatFloorOf)归一化——
  //   底线外=charge 冲锋段(直取底线内侧 80~95%,移动中射击,掩体只找前方;远射劣势方快速逼近发挥肉搏优势),
  //   底线内=advance/hold 交战段;
  // Close-range circling is handled by the strategic flank route.
  var frT = combatFloorOf(t, tgt) * gAimMul(t);   // 本车对当前目标的交火底线×组级乘数(低命中率组 rangeMul=0.6 → 底线收近 40%,拉近距离攻击)
  /* 断粮判定(think 级):"应能交战"态(程内有目标)而 _exposed 持续为假超 LOS_STARVE_T → 降级
     "够不着"落 charge 前推;_exposed 恢复即清零(暴露节拍处另有即时复归)。全型号通用,零型号分支。 */
  if (A._exposed || dist >= frT) { A._expOkT = gameT; if (A._losStarve) A._losStarve = 0; }
  else if (A._expOkT == null) A._expOkT = gameT;
  else if (!A._losStarve && gameT - A._expOkT > LOS_STARVE_T) A._losStarve = 1;
  if (flankOn && cF1 > 0 && dist > cF1) mode = 'advance';   // 迂回到位:直取攻击位环带(见 flankOn 锚点)
  else if ((hurt && dist < 180) || (crit && dist < 170) ||
           (dist < 130 && t.reload > 1.2 && Math.random() < covReloadP) ||
           (underFire && Math.random() < covFireP)) mode = 'cover';  // 自保优先:重伤/装填/正挨打 → 找掩体(冲锋中被击→前方掩体)
  else if ((dist > frT || A._losStarve) && !crit) mode = 'charge';   // 底线外且未重创:冲锋(快速逼近);LOS 断粮降级=底线内被长期断射线,同样"够不着"前推打通
  else if (banzai) mode = 'rush';                           // 殊死一搏:直线压到贴脸距离换命
  else if (dist > 110) mode = Math.random() < (agro ? 0.66 : (losing ? 0.16 : 0.4)) ? 'advance' : 'hold';  // 射程内中距:优势压上/劣势据守
  else mode = 'hold';                                       // 近战域:据守(侧击由 flank 组战略包抄)
  if (mode === 'hold' && !A._exposed && dist > 110) mode = 'advance';   // 驻停闸:看不见/射线不通的位置不是阵位(Killzone 口径),不许静默据守
  A.mode = mode;

  if (mode === 'charge') {         // 冲锋:直取交火底线内侧 80~95%(一次到位,不逐段不绕掩体);走廊锚点横向错开防扎堆
    var lxCh = (t._cmdG && t._cmdG.role === 'front' && t._cmdG.laneX != null) ? t._cmdG.laneX : null;
    var chD = frT * rand(0.8, 0.95);          // 冲锋目标=底线 80~95% 处(不随距离收缩;到达即转入交战段)
    if (A._losStarve) chD = Math.min(chD, dist * rand(0.5, 0.7));   // 断粮前推:环带必须收进当前距离内侧,每次重规划拉近 30~50% 直至射线打通
    chD = Math.min(chD, aiVisRange(t) * 0.85);   // 冲锋环带并入感知:不冲向自己看不见的驻停距离(全型号同式,视距为型号数据参数)
    var destCh = ringDest(p, lxCh != null ? lxCh : gp.x, gp.z, chD, 0.35, t);
    if (destCh) { A.destX = destCh.x; A.destZ = destCh.z; return; }
  }
  if (mode === 'advance') {        // 推进:直取目标环带,略错开轴线(保持火力线;优势压得更近)
    // 走廊锚点(front 组):环带中心横向=组走廊 laneX,纵向=目标——组间横向错开,防扎堆
    var lxAdv = (t._cmdG && t._cmdG.role === 'front' && t._cmdG.laneX != null) ? t._cmdG.laneX : null;
    var advCx = gp.x, advCz = gp.z;
    if (flankOn) { var atkA = flankAttackAnchor(t, clusterOf(t.team === 'red' ? 'blue' : 'red')); advCx = atkA.x; advCz = atkA.z; }   // 迂回到位:环带中心锚敌方高威胁小组(组内统一目标,防分散)
    // 环带半径锚交火底线(0.45~0.8×本车对当前目标底线,优势更近)
    //   ——环带随交火底线缩放:坦克≈185~370m / M1≈265~530m / 红方歼击车≈1080~1920m,随目标正面面积变化;
    // 迂回组保留组级底线锚定(85~100%)
    var advR = (flankOn && cF1 > 0) ? cF1 * rand(0.85, 1.0)
             : frT * (agro ? rand(0.45, 0.65) : rand(0.55, 0.8));
    advR = Math.min(advR, aiVisRange(t) * 0.85);   // 驻停半径并入感知(EQS 距离+可见性联合约束口径):永不驻停在自己看不见的距离上;交火底线超视距的型号(数据参数)在此统一拦截
    /* 已在环带内:驻停闸(Killzone"有射击线的位置才是阵位")——_exposed(察觉+射线复合缓存)通过
       才许原地交战(防粘滞推进语义保留);否则 EQS 式阵位查询(tacFireCellNear 硬门+真射线精筛):
       命中=定向机动至阵位,无阵位=不驻停继续收环推进(级联下一级=断粮 charge)。
       注意:此处只能引用本函数局部量,误引外层局部名会抛 ReferenceError 并沿 forEach→step→animate 中断整个渲染帧 */
    if (dist <= advR) {
      if (A._exposed) { A.destX = p.x; A.destZ = p.z; return; }
      var fCell = tacFireCellNear(p.x, p.z, gp.x, gp.z, t.team);
      if (fCell) { A.destX = fCell.x; A.destZ = fCell.z; return; }
    }
    advR = Math.min(advR, dist * 0.85);                             // 防过冲:仅当环带>当前距离时收窄
    var destAdv = ringDest(p, lxAdv != null ? lxAdv : advCx, advCz, advR, 0.4, t);
    if (destAdv) {
      var gPo = t._cmdG;                                 // 阵地格偏置:front 组且非迂回,阵地格在 250m 内=40% 牵引(保住环带距离语义)
      if (!flankOn && gPo && gPo.role === 'front' && gPo._postX != null &&
          Math.sqrt((destAdv.x - gPo._postX)*(destAdv.x - gPo._postX)+(destAdv.z - gPo._postZ)*(destAdv.z - gPo._postZ)) < 250) {
        destAdv.x += (gPo._postX - destAdv.x) * 0.4;
        destAdv.z += (gPo._postZ - destAdv.z) * 0.4;
      }
      A.destX = destAdv.x; A.destZ = destAdv.z; return;
    }
  }
  if (mode === 'rush') {           // 殊死一搏:突破火力线直插贴脸环带(宁可换命也不慢性死亡)
    for (tries = 0; tries < 6; tries++) {
      var aR = Math.atan2(p.x - gp.x, p.z - gp.z) + rand(-0.55, 0.55);
      var rrR = rand(26, 42);
      nx = gp.x + Math.sin(aR) * rrR; nz = gp.z + Math.cos(aR) * rrR;
      if (validDest(nx, nz, t)) { A.destX = nx; A.destZ = nz; return; }
    }
  }
  if (mode === 'cover') {            // 找掩体:威胁视线的反盲点位(障碍/残骸后)
    var chFwd = dist > frT;          // 冲锋域触发的 cover:只找前方掩体(朝目标推进顺路遮蔽,不后退不横移)
    var best = null, bestScore = -1e9;
    for (i = 0; i < obstacles.length; i++) {
      var s = obstacles[i];
      var ds = Math.sqrt((s.x - p.x)*(s.x - p.x)+(s.z - p.z)*(s.z - p.z));
      if (ds > 75) continue;
      if (chFwd && !isFwdOf(p.x, p.z, gp.x, gp.z, s.x, s.z)) continue;   // 冲锋:只找目标前扇区掩体(不后退不横移)
      var aw = Math.atan2(s.x - gp.x, s.z - gp.z);
      var cx = clamp(s.x + Math.sin(aw) * (s.r + 3.5), -B, B),
          cz = clamp(s.z + Math.cos(aw) * (s.r + 3.5), -B, B);
      if (!validDest(cx, cz, t)) continue;
      var sc = 80 - ds + rand(0, 12);
      if (sc <= bestScore) continue;               // 严格剪枝:得分不可能超越当前最优,跳过 LOS 射线
      if (!losBlockedAt(gp.x, gp.y + 1.8, gp.z, cx, terrainH(cx, cz) + 1.2, cz)) continue;
      if (sc > bestScore) { bestScore = sc; best = { x: cx, z: cz }; }
    }
    var wcn = wreckClustersNear(p.x, p.z, 75);            // 残骸掩体按簇:堆叠残骸=单一掩体(原逐具候选→逐簇一次射线)
    for (var wci = 0; wci < wcn; wci++) {
      var wc = _wclOut[wci];
      var wx2 = wc.sx / wc.n, wz2 = wc.sz / wc.n;
      var dw = Math.sqrt((wx2 - p.x)*(wx2 - p.x)+(wz2 - p.z)*(wz2 - p.z));
      if (dw > 75) continue;
      if (chFwd && !isFwdOf(p.x, p.z, gp.x, gp.z, wx2, wz2)) continue;
      var aw2 = Math.atan2(wx2 - gp.x, wz2 - gp.z);
      var rx2 = clamp(wx2 + Math.sin(aw2) * (wc.ext + 3.2), -B, B),
          rz2 = clamp(wz2 + Math.cos(aw2) * (wc.ext + 3.2), -B, B);
      if (!validDest(rx2, rz2, t)) continue;
      var sc2 = 75 - dw + rand(0, 12);
      if (sc2 <= bestScore) continue;              // 严格剪枝:得分不可能超越当前最优,跳过 LOS 射线
      if (!losBlockedAt(gp.x, gp.y + 1.8, gp.z, rx2, terrainH(rx2, rz2) + 1.2, rz2)) continue;
      if (sc2 > bestScore) { bestScore = sc2; best = { x: rx2, z: rz2 }; }
    }
    if (!best) {
      if (chFwd) {                                   // 冲锋无前方掩体:不停车不后退,继续朝目标推进 30m
        var fwdA = Math.atan2(gp.x - p.x, gp.z - p.z);
        nx = clamp(p.x + Math.sin(fwdA) * 30, -B, B); nz = clamp(p.z + Math.cos(fwdA) * 30, -B, B);
        if (validDest(nx, nz, t)) best = { x: nx, z: nz };
      } else {                                       // 反斜面兜底:远离威胁退 20m
        var back = Math.atan2(p.x - gp.x, p.z - gp.z);
        nx = clamp(p.x + Math.sin(back) * 20, -B, B); nz = clamp(p.z + Math.cos(back) * 20, -B, B);
        if (validDest(nx, nz, t)) best = { x: nx, z: nz };
      }
    }
    if (best) { A.destX = best.x; A.destZ = best.z; return; }
  }
  // hold / 兜底:当前位置小范围机动(贴住阵线,少游荡,不扎堆)
  for (tries = 0; tries < 6; tries++) {
    var a2 = rand(0, TAU), r2 = rand(14, 30);
    nx = clamp(p.x + Math.sin(a2) * r2, -B, B);
    nz = clamp(p.z + Math.cos(a2) * r2, -B, B);
    if (ownCrowding(t, nx, nz) > 1 && !A.relax) continue;      // 看门狗解锁时豁免拥挤
    if (validDest(nx, nz, t)) { A.destX = nx; A.destZ = nz; return; }
  }
  // Final fallback: never retain a stale destination; advance 30–50 m toward the threat,
  // 只避开界外;途中障碍交由 avoidSteer 现场绕行,残骸直接顶开
  var ga = Math.atan2(gp.x - p.x, gp.z - p.z) + rand(-0.35, 0.35);
  var gr = rand(30, 50);
  A.destX = clamp(p.x + Math.sin(ga) * gr, -B, B);
  A.destZ = clamp(p.z + Math.cos(ga) * gr, -B, B);
}

/* ============================================================
   火箭炮 AI:尽可能远离战场,驻锄后曲射敌集群;齐射全程锁定移动
   弹道:固定高射角(0.88rad ≈ 50°)变速求解 —— 高抛"火雨"覆盖
   ============================================================ */
/* ===== 真实火箭速度剖面(03i;挂在同一高抛解析弧上的"时间放大器") ----
   口径:离轨低速 → 固体发动机 0.9s 助推加速到二战火箭炮真实极速(M-13:355m/s / Wgr.41:342m/s),
   熄火后恒速惯性段(过顶按 dipK 微收=真弹道减速观感)。几何 100% 不变:
   位置仍是原重力解析弧 P(u)=P0+V0·u−½g·u²·ŷ；初速、射角、落点和红点均由 rocketSolve 决定,
   超程封顶/近距低伸自卫弧/齐射角散布一律原样),本剖面只决定"沿弧走多快":
   du/dt = v(t)/|V(u)| —— 任何单调剖面都严格落在同一弹道曲线上(红点=首发落点铁律不受影响),
   受之影响的全链路(实弹步进/红点仿真/AI 来袭预报)共用 rocketUStep 同一函数。 ===== */
var ROCKET_PROF = { vExit: 44, vMax: 355, tBurn: 0.9, dipK: 0.25 };
function rocketPhaseSpeed(tFly, uFrac) {
  if (tFly < ROCKET_PROF.tBurn) {                      // 助推段:离轨 44 → 355 m/s 平滑加速(smoothstep)
    var k = clamp(tFly / ROCKET_PROF.tBurn, 0, 1);
    return ROCKET_PROF.vExit + (ROCKET_PROF.vMax - ROCKET_PROF.vExit) * k * k * (3 - 2 * k);
  }
  var dip = 1 - ROCKET_PROF.dipK * Math.sin(Math.PI * clamp(uFrac || 0, 0, 1));   // 惯性段:过顶减速观感
  return ROCKET_PROF.vMax * dip;
}
// 解析弧单步推进:rk={p0x/y/z,v0x/y/z,u,tF,tof0} 就地更新,返回本步使用的剖面速度
function rocketUStep(rk, dt) {
  var spd = rocketPhaseSpeed(rk.tF, rk.u / rk.tof0);
  var vyU = rk.v0y - CONF.gravity * rk.u;
  var vu = Math.sqrt(rk.v0x * rk.v0x + rk.v0z * rk.v0z + vyU * vyU) || 1;
  rk.tF += dt;
  rk.u += dt * spd / vu;
  return spd;
}
var ARTY_THETA = 0.88;
/* ===== 齐射物理散布(散布全部来自物理扰动,不做落点级魔法修正):
      发射架一旦伺服到位齐射,机械上就是死的;弹着散布全部来自每发火箭离轨瞬间的
      初速向量扰动——推力线偏心/阵风/出厂初速公差。角散布 方位±4°/纵向±5.7° 均匀、初速 ±2.4% 三角,
      在典型交战距离上面散布 ≈ ±(22+22)m(且随距离自然缩放,更真实)。 ===== */
/* 方位/纵向分开标定(真实火箭炮射程散布恒大于方向散布):
   方位 ±4° 管内全距离弹着幅约为 ±44m；纵向 ±5.7° 用于低伸自卫弹道(R<130)
   对射程极敏感 → 近距齐射也保持面杀伤形态;初速 ±2.4% 三角=推力公差→纵距散布。 */
var ARTY_SALVO_AZ  = 0.007;       // 齐射角散布按 10KM:2KM 比例缩减为 1/5 (原 0.035)
var ARTY_SALVO_EL  = 0.010;       // 原 0.05
var ARTY_SALVO_VJIT = 0.0012;     // 原 0.006
// 固定射角·带高差的精确弹道解:命中 水平距离R(m) / 高差H(m,炮口高于目标为正) 所需初速
// 由 0 = H + R·tanθ − g·R²/(2v²cos²θ) 解出 → v² = g·R²/(R·sin2θ + 2·H·cos²θ)
function rocketVExact(R, H, theta) {
  if (R < 1) R = 1;
  var c = Math.cos(theta);
  var den = R * Math.sin(2 * theta) + 2 * H * c * c;
  if (den <= 0.5) return Infinity;              // 该射角下物理不可达(目标超出这道弧线)
  return Math.sqrt(CONF.gravity * R * R / den);
}
// 玩家/AI 共用的弹道解:50° 高抛"火雨"优先(带高差精确变速);
// 过近(最小初速都嫌快)或物理不可达时自动切 ~10° 低伸自卫弹道。
// reach=false 表示连最大初速都够不到装定点(红点会显示真实落点,落点比装定近)
function rocketSolve(R, H) {   // vmax 660 余量(高抛 50.4° @40000m 需≈632m/s;含高差 uphill 余量)
  var v = rocketVExact(R, H, ARTY_THETA);
  if (isFinite(v) && v >= 34 && v <= 660) return { theta: ARTY_THETA, v: v, vmax: 660, reach: true };
  var v2 = rocketVExact(R, H, 0.18);                               // 低伸弹道(~10°)
  if (isFinite(v2) && v2 <= 660) return { theta: 0.18, v: clamp(v2, 34, 660), vmax: 660, reach: true };
  return { theta: ARTY_THETA, v: 660, vmax: 660, reach: false };   // 超程:硬按最大初速打
}
var NE_CACHE_T = 0.2;                              // 最近敌缓存窗(火箭炮移动慢,最近敌变化缓;缓存对象阵亡即时失效重算,与 aiGrid 0.25s 重建同量级)
function nearestOpponentOf(t) {
  var A = t.ai;
  var ce = A._ne;
  if (ce && ce.o && ce.o.alive && gameT - ce.t < NE_CACHE_T) return ce;
  var best = null, bd = Infinity, p = t.group.position;
  var roster = hostileRosterOf(t);
  for (var i = 0; i < roster.length; i++) {
    var o = roster[i];
    if (!o.alive || !areHostile(t, o)) continue;  // 个人死斗中 roster 是全场兼容视图，必须排除自己/非敌
    var dx = o.group.position.x - p.x, dz = o.group.position.z - p.z;
    var d2 = dx * dx + dz * dz;
    if (d2 < bd) { bd = d2; best = o; }
  }
  A._ne = { o: best, d: best ? Math.sqrt(bd) : Infinity, t: gameT };
  return A._ne;
}
// 选 32m 内最密集的敌群质心(火箭炮面杀伤目标)
var _artyClusterScratch = [];
var _artyClusterCache = { red: null, blue: null }, _artyClusterCacheT = { red: -99, blue: -99 };
var ARTY_CLUSTER_CACHE_T = 2.5;                  // 按阵营缓存:结果只依赖敌方位置,同阵营 8 门共享同一次聚类(与 A.clusterT 同量级;counter-fire 覆盖写独立新对象,不污染缓存)
function pickArtyCluster(t) {
  if (typeof PERF_BASE !== 'undefined') PERF_BASE.artyCluster++;
  var otherTeam = t.team === 'red' ? 'blue' : 'red';
  if (!isFfaMode() && _artyClusterCache[otherTeam] && gameT - _artyClusterCacheT[otherTeam] < ARTY_CLUSTER_CACHE_T) return _artyClusterCache[otherTeam];
  var roster = hostileRosterOf(t);
  var best = null, bestCount = 0;
  for (var i = 0; i < roster.length; i++) {
    var center = roster[i];
    if (!areHostile(t, center)) continue;
    var cp = center.group.position;
    var nearby = collectAiNearby(cp.x, cp.z, 32, _artyClusterScratch);
    var count = 0, sx = 0, sz = 0;
    for (var j = 0; j < nearby.length; j++) {
      var o = nearby[j];
      if (!areHostile(t, o)) continue;
      var p2 = o.group.position;
      var dx = p2.x - cp.x, dz = p2.z - cp.z;
      if (dx * dx + dz * dz < 1024) {
        count++; sx += p2.x; sz += p2.z;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      best = { x: sx / count, z: sz / count, count: count };
    }
  }
  if (best) best.y = terrainH(best.x, best.z) + 1.2;
  _artyClusterCache[otherTeam] = best;           // 同阵营共享同一敌群聚类(best.y 对同 x/z 幂等)
  _artyClusterCacheT[otherTeam] = gameT;
  return best;
}
/* ★任务27⑧:跨局 AI 缓存清扫(flow.js clearBattleEntities 调用)。gameT 在菜单/读盘期冻结(step 门控),
   gameT-TTL 缓存因此能跨局存活(实测新局开局缓存年龄 2.1s < 2.5s TTL → 命中):
   · _artyClusterCache:新局火箭炮第 1 帧即按「上一局终战敌群质心」齐射——若上局终战在地图中部,
     新局 t≈0.4s 发射、3~6s 后弹着 = 出生点视野外无人区成片爆炸(用户所见「开局来源不明火箭弹爆炸」);
   · _weakCache/_fCluster: cached front-line data used by the current flank solver;
   · _pkTop*: single-pass target slots are cleared between decisions. */
function aiBattleClear() {
  // 清空空间网格与两份兼容 roster，避免新局第一帧沿用上一局的火箭炮目标表。
  if (typeof aiGrid !== 'undefined' && aiGrid && aiGrid.clear) aiGrid.clear();
  aiGridT = -99;
  if (typeof aiTeamRoster !== 'undefined' && aiTeamRoster) {
    aiTeamRoster.red.length = 0; aiTeamRoster.blue.length = 0;
  }
  _artyClusterCache.red = null; _artyClusterCache.blue = null;
  _artyClusterCacheT.red = -99; _artyClusterCacheT.blue = -99;
  _weakCache.red = null; _weakCache.blue = null;
  _weakCacheT.red = -99; _weakCacheT.blue = -99;
  _fCluster = {}; _fClusterT = -99;
  for (var i = 0; i < 3; i++) { _pkTop[i] = null; _pkTopD[i] = Infinity; _pkTopF[i] = null; _pkTopFD[i] = Infinity; }
}
function nearestFriendOf(t, x, z) {                        // 最近友军位置(落点推移用)
  if (isFfaMode()) return null;
  var best = null, bd = 1e18;
  var roster = friendlyRosterOf(t);
  for (var i = 0; i < roster.length; i++) {
    var o = roster[i];
    if (o === t || !o.alive) continue;                   // Grid-cache guard; aliveList remains the live authority.
    var dx = o.group.position.x - x, dz = o.group.position.z - z;
    var d2 = dx * dx + dz * dz;
    if (d2 < bd) { bd = d2; best = o.group.position; }
  }
  return best;
}
/* ===== 防空载具独立 AI (TASK 18) =====
   用户设定:不在指挥官 AI 的指挥范围内;任务22 改为 HUNT/GROUND 双模式:有直升机情报→主动拦截猎杀(aaIntelUpdate 情报层),
   无敌方直升机存活→防空导弹切换为对地火力,可攻击坦克/歼击车/火箭炮/敌防空车;
   火控仍为世界反馈伺服/思考节拍开火门。红 RED_AA:车载雷达航迹表+双联机炮近距压制;
   蓝 BLUE_AA:无雷达,导弹发射后由光电导引头自主寻的。 */
function aaGroundTargetKind(o) {
  if (!o || !o.group || isHeliVehicle(o)) return false;
  // ground domain 明确覆盖常规坦克、歼击车、两种 MBT、火箭炮和敌方防空车。
  return o.kind === 'tank' || o.kind === 'td' || o.kind === '99' || o.kind === 'arty' || o.kind === 'aa';
}
function aaHostileHeliAlive(t, roster) {
  for (var i = 0; i < roster.length; i++) {
    var o = roster[i];
    if (o && o.alive && o.group && areHostile(t, o) && isHeliVehicle(o)) return true;
  }
  return false;
}
function aaPickGroundTarget(t, roster, spec, ax, az) {
  var tp = t.group.position, range = spec.range;
  var best = null, bestScore = -1e9;
  for (var i = 0; i < roster.length; i++) {
    var o = roster[i];
    if (!o || !o.alive || !areHostile(t, o) || !aaGroundTargetKind(o)) continue;
    var op = o.group.position;
    var dx = op.x - tp.x, dy = op.y - (tp.y + 1.8), dz = op.z - tp.z;
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > range || d < 80) continue;
    if (!losClearCached(t, o, d)) continue;
    var align = (dx / d) * ax + (dz / d) * az;
    // 火箭炮是优先级略高的软目标，但距离和当前发射架对准度仍是主要因素。
    var roleBonus = o.kind === 'arty' ? 180 : (o.kind === 'aa' ? 80 : 0);
    var score = align * 250 - d + roleBonus;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  return best;
}
function aaPickTarget(t) {
  var tp = t.group.position;
  var spec = HELI_MSL_SPEC[heliMslTypeOf(t)];
  var range = spec.range;                                // 搜索/交战半径=导弹规格射程(红 ty90 6km/蓝 aim92 8km)
  var roster = hostileRosterOf(t);
  var best = null, bestScore = -1e9;
  var ax = 0, az = 1;                                    // 发射架当前轴向(优先接轴目标,减少大角度回转时间)
  if (t.gunPivot && t.gunPivot.getWorldDirection) { t.gunPivot.getWorldDirection(_gaDir); ax = _gaDir.x; az = _gaDir.z; }

  // 只要仍有敌方直升机存活，就保持防空车原有“先空后地”纪律；
  // 只有敌方直升机全部阵亡，才进入地面目标搜索，避免对空弹被提前浪费。
  if (!aaHostileHeliAlive(t, roster)) return aaPickGroundTarget(t, roster, spec, ax, az);

  for (var i = 0; i < roster.length; i++) {
    var o = roster[i];
    if (!o || !o.alive || !areHostile(t, o) || !isHeliVehicle(o) || !o.group) continue;
    var op = o.group.position;
    var dx = op.x - tp.x, dy = op.y - (tp.y + 1.8), dz = op.z - tp.z;
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > range || d < 80) continue;                   // 导引头最小捕获距离 80m(近界内导引头来不及截获)
    if (!losClearCached(t, o, d)) continue;              // 视野内地形遮挡剔除
    var align = (dx / d) * ax + (dz / d) * az;           // 与发射架轴向对齐度 [-1,1]
    var score = align * 400 - d;                         // 对齐优先,近者次之
    if (score > bestScore) { bestScore = score; best = o; }
  }
  return best;
}
/* ===== 任务22: 防空车主动猎杀 —— 阵营直升机情报层 + HUNT/GROUND 双模式移动 =====
   用户四项决策:①猎杀半径=全图自由;②蓝方防空车 GROUND=伴随最近友军集群;
   ③探测忠实不对称:红 PGZ 车载雷达(公开资料 CLC-1 ~11km 搜索,实现=地形遮蔽判定,三车数据链共享航迹),
     蓝蓝方防空车无雷达=每车 3km 光学 LOS + 敌直升机武器开火闪光暴露补盲(4s 有效,机炮/火箭/导弹三个发射口全挂钩);
   ④PGZ GROUND 机炮只打软目标(aa/arty/直升机 或贴脸≤150m),对主战坦克省弹不暴露。
   模式滞回:有航迹→HUNT(即时);航迹全过期且(敌直全灭 或 12s 无新情报)→GROUND。 */
var AA_INTEL_SCAN_T = 0.6;      // 情报刷新节拍(与 aaPickTarget 目标扫描同拍)
var AA_RADAR_R = 11000;         // PGZ 雷达搜索半径(地形遮蔽判定;数据链=全阵营共享)
var AA_OPTICAL_R = 3000;        // 蓝方防空车光学搜索半径(需 LOS)
var AA_FLASH_T = 4.0;           // 直升机开火闪光有效期(位置级情报,无速度信息)
var AA_INTEL_FRESH_T = 3.0;     // 航迹新鲜期:期内才做速度外推(直升机机动剧烈,陈迹不外推)
var AA_INTEL_STALE_T = 6.0;     // 航迹有效期:超期→写墓地(最后已知位置)后删除
var AA_MODE_GROUND_T = 12.0;    // HUNT→GROUND 滞回:无任何情报的时长
var aaIntel = {
  red:  { tracks: [], mode: 'ground', lastSeen: -99, scanT: -99, graveX: 0, graveZ: 0, graveT: -99 },
  blue: { tracks: [], mode: 'ground', lastSeen: -99, scanT: -99, graveX: 0, graveZ: 0, graveT: -99 }
};
var _aaFlash = { red: [], blue: [] };   // 记在"防守方"数组:敌直升机开火→记入其对立阵营
function aaNoteFlash(h) {                 // 直升机三个武器发射口挂钩(fireShell/fireHeliRocket/fireHeliMissile)
  if (!h || !h.alive || !h.group || typeof isHeliVehicle !== 'function' || !isHeliVehicle(h)) return;
  var list = _aaFlash[h.team === 'red' ? 'blue' : 'red'], p = h.group.position;
  list.push({ x: p.x, y: p.y, z: p.z, t: gameT });
  if (list.length > 8) list.shift();
}
function aaIntelReset() {                 // 换局清零(spawnTeams 调用):陈旧航迹不跨局
  for (var k in aaIntel) { var IN = aaIntel[k]; IN.tracks.length = 0; IN.mode = 'ground'; IN.lastSeen = -99; IN.scanT = -99; IN.graveT = -99; }
  _aaFlash.red.length = 0; _aaFlash.blue.length = 0;
}
function aaIntelUpsert(IN, o, x, y, z, vx, vz) {
  for (var i = 0; i < IN.tracks.length; i++) {
    if (IN.tracks[i].o === o) { var tr = IN.tracks[i]; tr.x = x; tr.y = y; tr.z = z; tr.vx = vx; tr.vz = vz; tr.t = gameT; return; }
  }
  if (IN.tracks.length < 12) IN.tracks.push({ o: o, x: x, y: y, z: z, vx: vx, vz: vz, t: gameT });
}
function aaIntelUpdate(team) {
  var IN = aaIntel[team];
  if (!IN || gameT - IN.scanT < AA_INTEL_SCAN_T) return;
  IN.scanT = gameT;
  var i, j, o, p;
  var sensors = null;                                   // 传感器=本阵营全部存活防空车(情报即阵营共享=数据链)
  for (i = 0; i < aliveList.length; i++) {
    o = aliveList[i];
    if (!o || !o.alive || (!isFfaMode() && o.team !== team) || o.kind !== 'aa') continue;
    if (team === 'red' && !o._heliRadarActive) continue;   // 任务23:PGZ 雷达未开机(部署后 15s 启动序列中)= 不贡献情报
    (sensors || (sensors = [])).push(o);
  }
  if (!sensors) IN.tracks.length = 0;                   // 防空全灭:情报网下线(滞回照常走 → GROUND)
  else for (i = 0; i < aliveList.length; i++) {
    o = aliveList[i];
    if (!o || !o.alive || (!isFfaMode() && o.team === team) || !isHeliVehicle(o)) continue;
    p = o.group.position;
    var got = false;
    for (j = 0; j < sensors.length; j++) {
      var sp = sensors[j].group.position;
      var dx = p.x - sp.x, dy = p.y - (sp.y + 2.2), dz = p.z - sp.z;
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (team === 'red') {                            // 红:PGZ 雷达 11km,地形遮蔽判定(机载高度上遮蔽罕见)
        if (d <= AA_RADAR_R && !terrainBlocksLine(sp.x, sp.y + 2.2, sp.z, p.x, p.y, p.z, d)) { got = true; break; }
      } else if (d <= AA_OPTICAL_R && losClearCached(sensors[j], o, d)) { got = true; break; }   // 蓝:光学 3km+LOS
    }
    if (got) aaIntelUpsert(IN, o, p.x, p.y, p.z, o._heliVx || 0, o._heliVz || 0);
  }
  if (team === 'blue') {                               // 蓝队闪光补盲:位置级情报(不覆盖实航迹的速度信息)
    var fl = _aaFlash.blue;
    for (i = fl.length - 1; i >= 0; i--) {
      if (gameT - fl[i].t > AA_FLASH_T) { fl.splice(i, 1); continue; }
      var f = fl[i], covered = false;
      for (j = 0; j < IN.tracks.length; j++) {
        var tt = IN.tracks[j];
        var fx = tt.x - f.x, fz = tt.z - f.z;
        if (fx * fx + fz * fz < 1440000) { covered = true; break; }
      }
      if (!covered && f.t > IN.graveT) { IN.graveX = f.x; IN.graveZ = f.z; IN.graveT = f.t; IN.mode = 'hunt'; if (f.t > IN.lastSeen) IN.lastSeen = f.t; }
    }
  }
  for (i = IN.tracks.length - 1; i >= 0; i--) {         // 航迹老化:超期/死亡→写墓地后删除
    var tr2 = IN.tracks[i];
    if (!tr2.o || !tr2.o.alive || gameT - tr2.t > AA_INTEL_STALE_T) {
      if (tr2.t > IN.graveT) { IN.graveX = tr2.x; IN.graveZ = tr2.z; IN.graveT = tr2.t; }
      IN.tracks.splice(i, 1);
    }
  }
  if (IN.tracks.length) { IN.lastSeen = gameT; IN.mode = 'hunt'; }   // 有航迹=HUNT 即时
  else if (IN.mode === 'hunt') {
    var heliAlive = false;
    for (i = 0; i < aliveList.length; i++) { o = aliveList[i]; if (o && o.alive && (isFfaMode() || o.team !== team) && isHeliVehicle(o)) { heliAlive = true; break; } }
    if (!heliAlive || gameT - IN.lastSeen >= AA_MODE_GROUND_T) IN.mode = 'ground';
  }
}
function aaIntelBest(IN, tp) {                          // 优先航迹:新鲜且近者先
  var best = null, bk = 1e18;
  for (var i = 0; i < IN.tracks.length; i++) {
    var tr = IN.tracks[i];
    var dx = tr.x - tp.x, dz = tr.z - tp.z;
    var k = (gameT - tr.t) * 500 + Math.sqrt(dx * dx + dz * dz);
    if (k < bk) { bk = k; best = tr; }
  }
  return best;
}
function aaHuntDest(t, IN, spec, B, dt) {   // HUNT 移动决策(1s 节拍):CLOSE 压近拦截/AMBUSH 抢占攻击位/REPOSITION 侧向拉视线/SEARCH 墓地漫游
  var A = t.ai, tp = t.group.position;
  A.huntT = (A.huntT || 0) - dt;
  if (A.huntT > 0) return true;
  A.huntT = 1.0;
  var best = aaIntelBest(IN, tp);
  if (best) {
    var age = gameT - best.t;
    var leadT = age < AA_INTEL_FRESH_T ? Math.min(age, 2.0) : 0;    // 新鲜航迹才外推
    var px = best.x + (best.vx || 0) * leadT, pz = best.z + (best.vz || 0) * leadT;
    var dx = px - tp.x, dz = pz - tp.z, d = Math.sqrt(dx * dx + dz * dz) || 1;
    if (d > spec.range * 0.8) {
      var victim = nearestFriendOf(t, px, pz);                      // 直升机正袭扰友军集群(≤3km)→抢占直-受害者连线中段(侧射位)
      if (victim && (victim.x - px) * (victim.x - px) + (victim.z - pz) * (victim.z - pz) < 9000000) {
        A.mode = 'ambush';
        A.destX = clamp((px + victim.x) * 0.5, -B, B); A.destZ = clamp((pz + victim.z) * 0.5, -B, B);
      } else {
        A.mode = 'close';                                           // 射程外→压近至拦截点(全图自由,决策①)
        A.destX = clamp(px, -B, B); A.destZ = clamp(pz, -B, B);
      }
      return true;
    }
    if (best.o && best.o.alive && !losClearCached(t, best.o, d)) {
      if (gameT >= (A.jinkT || 0)) { A.jinkSide = -(A.jinkSide || 1); A.jinkT = gameT + 3.5; }
      var ux = dx / d, uz = dz / d;
      A.mode = 'reposition';                                        // 射程内但视线被挡→侧向绕行拉射窗(交替向防振荡)
      A.destX = clamp(tp.x - uz * A.jinkSide * 110 + ux * 25, -B, B);
      A.destZ = clamp(tp.z + ux * A.jinkSide * 110 + uz * 25, -B, B);
      return true;
    }
    A.mode = 'engage'; A.destX = tp.x; A.destZ = tp.z;              // 射程内+LOS 通:驻停等火控接靶(同拍)
    return true;
  }
  if (IN.graveT > 0 && gameT - IN.graveT < AA_MODE_GROUND_T) {      // SEARCH:墓地(最后已知位置/闪光点)
    A.mode = 'search';
    var gx = IN.graveX - tp.x, gz = IN.graveZ - tp.z;
    if (gx * gx + gz * gz > 900) { A.destX = clamp(IN.graveX, -B, B); A.destZ = clamp(IN.graveZ, -B, B); return true; }
    if (A.destT <= 0) {                                             // 已到墓地:150m 半径环漫游
      A.destT = rand(2.5, 4.0);
      var wa = rand(0, Math.PI * 2);
      A.destX = clamp(IN.graveX + Math.cos(wa) * 150, -B, B);
      A.destZ = clamp(IN.graveZ + Math.sin(wa) * 150, -B, B);
    }
    return true;
  }
  return false;                                                     // 零情报→调用方回锚点 hold
}
function aaEscortDest(t, B) {                   // 决策②:蓝方防空车 GROUND 伴随最近友军地面集群(3s 节拍;110m 间距防叠堆,缓慢环绕)
  var A = t.ai, tp = t.group.position;
  if (A.destT > 0) return;
  A.destT = 3.0;
  var roster = friendlyRosterOf(t), i, o, p;
  var nf = null, nd = 1e18;
  for (i = 0; i < roster.length; i++) {
    o = roster[i];
    if (!o || !o.alive || o === t || isHeliVehicle(o)) continue;
    p = o.group.position;
    var dx = p.x - tp.x, dz = p.z - tp.z, d2 = dx * dx + dz * dz;
    if (d2 < nd) { nd = d2; nf = p; }
  }
  if (!nf) { A.mode = 'hold'; A.destX = A.anchorX; A.destZ = clamp(A.homeZ, -B, B); return; }   // 友军全灭:回锚点
  var cx = nf.x, cz = nf.z, n = 1;                                // 集群质心=最近友军 150m 邻域均值
  for (i = 0; i < roster.length; i++) {
    o = roster[i];
    if (!o || !o.alive || o === t || isHeliVehicle(o)) continue;
    p = o.group.position;
    var ex = p.x - nf.x, ez = p.z - nf.z;
    if (ex * ex + ez * ez < 22500) { cx += p.x; cz += p.z; n++; }
  }
  cx /= n; cz /= n;
  if (A.ringA == null) A.ringA = rand(0, Math.PI * 2);
  A.ringA += 0.12;
  var hx = tp.x - cx, hz = tp.z - cz, hd = Math.sqrt(hx * hx + hz * hz) || 1;
  A.mode = 'escort';
  if (hd > 260) { A.destX = clamp(cx + hx / hd * 140, -B, B); A.destZ = clamp(cz + hz / hd * 140, -B, B); }        // 掉队→追及
  else { A.destX = clamp(cx + Math.cos(A.ringA) * 110, -B, B); A.destZ = clamp(cz + Math.sin(A.ringA) * 110, -B, B); }  // 到位→保持间距环绕
}
function aaRadarSweep(t, dt, wide) {            // PGZ 搜索扫掠(雷达锥轴=炮塔向,与 updateHeliRadar 同口径):无目视目标时正弦慢扫
  if (t.team !== 'red') return;
  var A = t.ai;
  if (!wide && A.traceO && gameT - (A.traceT || 0) < 1.0) return; // GROUND 空闲扫掠:交战中不抢炮塔
  A._swP = (A._swP || 0) + dt * (wide ? 0.45 : 0.3);
  t.turretYaw = t.yaw + Math.sin(A._swP) * (wide ? 2.2 : 1.6);
  if (t.turret) t.turret.rotation.y = t.turretYaw;
}
function aaSoftGateOK(t, tgt, dist) {           // 决策④:PGZ GROUND 25mm 只打软目标(对主战坦克主甲多为跳弹,省弹不暴露)
  if (!t || t.kind !== 'aa' || !tgt) return true;
  var k = tgt.kind;
  if (k === 'aa' || k === 'arty' || isHeliVehicle(tgt)) return true;
  return dist <= 150;                           // 贴脸威胁自卫豁免
}
function aaDriveTo(t, dt) {                     // aaUpdate/护航共用移动执行(与 artyUpdate 完全同链路:寻路操舵→车体伺服→油门→物理积分)
  var A = t.ai, tp = t.group.position;
  var ddx = A.destX - tp.x, ddz = A.destZ - tp.z, destDist = Math.sqrt(ddx * ddx + ddz * ddz);
  var arrived = destDist < 10;
  var sdxA = ddx, sdzA = ddz;
  if (!arrived && typeof navSteer === 'function') { var _nwA = navSteer(t, A.destX, A.destZ, tp); if (_nwA) { sdxA = _nwA.x - tp.x; sdzA = _nwA.z - tp.z; } }
  var drvA = steerCached(t, sdxA, sdzA);
  var wantYaw = Math.atan2(drvA.x, drvA.z);
  var diff = normAng(wantYaw - t.yaw);
  var tm = turnMult(t) * slopeTurnMul(t), sm = speedMult(t);
  var dClamp = clamp(diff, -t.turn0 * tm * dt, t.turn0 * tm * dt);
  groundYawInertia(t, dt > 0 ? dClamp / dt : 0, t.turn0 * tm, dt);
  var ma = Math.abs(normAng(wantYaw - t.yaw));
  var evd = A.evadeT > 0;
  var th = arrived ? 0 : (ma < 1.45 ? clamp(1 - ma / 1.7, evd ? 0.6 : 0.25, 1) : (ma > 1.75 ? (evd ? -0.8 : -0.5) : (evd ? 0.5 : 0.2)));
  t._throttle = th; t._throttleLock = 0;
  if (typeof SIM_K === 'undefined' || SIM_K <= 0) t.speed = approachSpeed(t.speed, th * t.speed0 * sm, t.accel0 * engineEff(t), t.decel0 * Math.max(engineEff(t), 0.3), dt);
  applyMotion(t, dt);
}
function aaUpdate(t, dt) {
  var A = t.ai, tp = t.group.position;
  var B = CONF.bounds - 14;
  var spec = HELI_MSL_SPEC[heliMslTypeOf(t)];
  A.destT -= dt;
  aaIntelUpdate(t.team);            // 阵营直升机情报层(内部 0.6s 节流;harness 直调 aaUpdate 时不依赖派发层)

  // 武器/雷达计时(与玩家同套 updateHeliWeapons:RED_AA 雷达航迹表+两侧导弹装填钟;蓝方防空车无雷达空转)
  updateHeliWeapons(t, dt);

  // —— 目标扫描:优先攻击视野内的直升机(0.6s 重扫;目标阵亡立即重扫) ——
  A.aaTgtT = (A.aaTgtT || 0) - dt;
  if (A.aaTgtT <= 0 || !A.aaTgt || !A.aaTgt.alive) { A.aaTgtT = 0.6; A.aaTgt = aaPickTarget(t); }
  var tgt = A.aaTgt;

  // —— 移动决策(任务22 双模式):HUNT=情报驱动主动拦截猎杀;无敌方直升机后导弹对地 ——
  var IN = aaIntel[t.team];
  var ne = nearestOpponentOf(t), dE = ne.d;
  if (tgt) {
    A.mode = 'engage';                                           // 空中或地面目标已进入导弹火控:驻停交战
    A.destX = tp.x; A.destZ = tp.z;
  } else if (IN.mode === 'ground' && t.team === 'blue') {
    aaEscortDest(t, B);                                          // 无目标时蓝方才回到伴随友军集群
  } else if (ne.o && dE < 150) {
    A.mode = 'flee';                                             // 无空目标且地面敌贴脸:脱离(保持任务18 纪律)
    var away = Math.atan2(tp.x - ne.o.group.position.x, tp.z - ne.o.group.position.z);
    A.destX = clamp(tp.x + Math.sin(away) * 80, -B, B);
    A.destZ = clamp(tp.z + Math.cos(away) * 80, -B, B);
  } else if (!aaHuntDest(t, IN, spec, B, dt)) {
    A.mode = 'hold';                                             // HUNT 零情报(滞回尾巴):回锚点待机,雷达扫掠搜目标
    if (A.destT <= 0) { A.destT = 3.0; A.destX = A.anchorX; A.destZ = clamp(A.homeZ, -B, B); }
  }
  // 火箭弹逃生优先于阵地纪律(逃生点由 maybeEvadeRocket 装定,main.js 全局驱动)
  if (A.evadeT > 0) { A.mode = 'flee'; A.destX = A.evadeX; A.destZ = A.evadeZ; }
  /* AA movement can follow a pickup while its independent target/aim/fire logic
     continues below.  A threat escape remains higher priority. */
  if (A.evadeT <= 0 && A._powerupDrive && A._powerupTarget &&
      !A._powerupTarget._removed && A._powerupTarget.expiresAt > gameT) {
    A.destX = A._powerupTarget.x;
    A.destZ = A._powerupTarget.z;
    A.destT = Math.max(A.destT || 0, 0.35);
  }

  aaDriveTo(t, dt);                                              // 移动执行(共用链路)
  if (t._laserSuppressed) return;                               // 激光照射期间只暂停 AA 炮塔/火控,移动与威胁规避仍继续

  if (!tgt) {                                                    // 无空中目标:发射架回正行军仰角 + PGZ 雷达扫掠搜目标(锥轴=炮塔)
    t.gunPitch += (0.35 - t.gunPitch) * Math.min(1, dt);
    aaRadarSweep(t, dt, true);
    if (t.turret) t.turret.rotation.y = t.turretYaw;
    if (t.gunPivot) t.gunPivot.rotation.x = -t.gunPitch;
    return;
  }

  // —— 提前量:按导弹飞行时间的匀速前置(直升机三轴惯性速度 _heliVx/Vy/Vz;神枪手系数 A.lead 与全体 AI 同源) ——
  var tpos = tgt.group.position;
  var dx = tpos.x - tp.x, dy = tpos.y - (tp.y + 1.8), dz = tpos.z - tp.z;
  var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  var tFly = d / spec.vMax;
  var leadK = A.lead != null ? A.lead : 1;
  var ax = tpos.x + (tgt._heliVx || 0) * tFly * leadK;
  var ay = tpos.y + (tgt._heliVy || 0) * tFly * leadK;
  var az = tpos.z + (tgt._heliVz || 0) * tFly * leadK;
  var dxd = ax - tp.x, dyd = ay - (tp.y + 1.8), dzd = az - tp.z;
  var dHor = Math.sqrt(dxd * dxd + dzd * dzd) || 1;
  var wantAz = Math.atan2(dxd, dzd);
  var wantEl = Math.atan2(dyd, dHor);
  // 世界反馈伺服(与 artyUpdate 同式:按实测发射架方向收敛,车体朝向/坡地姿态不带偏轴线)
  t.gunPivot.getWorldDirection(_gaDir);
  var bAz = Math.atan2(_gaDir.x, _gaDir.z);
  var bEl = Math.asin(clamp(_gaDir.y, -1, 1));
  var tdiff = normAng(wantAz - bAz);
  var pdiff = normAng(wantEl - bEl);
  var tr = t.turretRate0 * turretMult(t);
  t.turretYaw += clamp(tdiff, -tr * dt, tr * dt);
  var _aaPLo = t.team === 'red' ? -5 * Math.PI / 180 : -0.1745, _aaPHi = t.team === 'red' ? 90 * Math.PI / 180 : 1.2217;   // 任务25:RED_AA 机炮射界 -5°~+90°(可对天顶)/蓝方防空车 -10°~+70°
  t.gunPitch = clamp(t.gunPitch + clamp(pdiff, -1.0 * dt, 1.0 * dt), _aaPLo, _aaPHi);
  if (t.turret) t.turret.rotation.y = t.turretYaw;
  if (t.gunPivot) t.gunPivot.rotation.x = -t.gunPitch;

  var aimOK = Math.abs(tdiff) < 0.08 && Math.abs(pdiff) < 0.08;
  // —— 机炮开火(任务25:脱离思考节拍,每步检查;射速只受装填门 0.125s 限制=玩家同源×2 射速) ——
  // RED_AA 双联机炮:近距(<1400m)跟踪压制(每把性能=直升机机炮;fireShell 标准装填/散布管线)
  if (aimOK && t.team === 'red' && d < 1400 && t.reload <= 0 && t.mods.gun && t.mods.gun.hp > 0) fireAAGun(t);
  // —— 导弹开火触发(思考节拍节流+任务24 齐射纪律;弹药/装填门全部收在 triggerAAFire 内,与玩家完全同源) ——
  if (A.thinkT > 0) return;
  A.thinkT = rand(0.25, 0.45);
  if (!aimOK || d > spec.range) return;
  if (t.mods.ammo && t.mods.ammo.hp > 0) triggerAAFire(t);          // 导弹(左右发射架交替;PGZ 吃雷达锁定,蓝方防空车弹自搜索)
}

function artyUpdate(t, dt) {
  var A = t.ai, tp = t.group.position;
  var B = CONF.bounds - 14;
  var homeSign = homeSignOf(t);   // arty.homeZ 带半场符号(生成/部署时落位),未设时按出生线兜底
  var AC = artyConfOf(t);   // 阵营规格路由:红 RED_MLRS(40发/60伤) 蓝 BLUE_MLRS(6发/120伤),射程均 40km
  A.destT -= dt;

  // —— 齐射进行中:车辆锁定不动,停稳后按间隔射出 ——
  if (t.salvoLeft > 0) {
    t._throttle = 0; t._throttleLock = 1; t._turnCmd = 0;   // 齐射驻锄(物理分支:无驱动+不溜坡)
    if (typeof SIM_K === 'undefined' || SIM_K <= 0) t.speed = approachSpeed(t.speed, 0, 0, t.decel0, dt);
    applyMotion(t, dt);
    t.salvoT -= dt;
    if (t.salvoT <= 0 && Math.abs(t.speed) < 0.8 && t.mods.gun.hp > 0) {
      t.salvoT = AC.salvoGap;
      t.salvoLeft--;
      // 齐射全程发射架纹丝不动(物理:机械发射架没有逐发重瞄这回事);
      // 面散布来自非重叠覆盖弹道分配 + 每发火箭离轨时的初速向量/初速扰动(fireShell 的 disp 通道)
      fireShell(t, true);
      if (t.salvoLeft <= 0) {
        t.reload = t.reloadTime;   // 齐射完毕转入长装填
        t._salvoAimX = null;
        t._salvoAimZ = null;
      }
    }
    return;
  }

  var ne = nearestOpponentOf(t), dE = ne.d;

  // —— 目标集群(每 2.5s 重选全场最密集敌群) ——
  A.clusterT -= dt;
  if (A.clusterT <= 0) { A.clusterT = 2.5; A.cluster = pickArtyCluster(t); }
  var cl = A.cluster;
  var dCl = cl ? Math.sqrt((cl.x - tp.x)*(cl.x - tp.x)+(cl.z - tp.z)*(cl.z - tp.z)) : Infinity;

  // —— 敌近 150m:装填中(或发射架被毁)→ 丢下射击念头全力逃跑;装填完成 → 立刻就地停车反击 ——
  var danger = ne.o && dE < 150;
  if (danger) {
    if (t.reload > 0 || t.mods.gun.hp <= 0) {
      A.mode = 'flee';
      var away = Math.atan2(tp.x - ne.o.group.position.x, tp.z - ne.o.group.position.z);
      var fx = clamp(tp.x + Math.sin(away) * 80, -B, B);
      var fz = clamp(tp.z + Math.cos(away) * 80 + homeSign * 40, -B, B);
      if (validDest(fx, fz, t)) { A.destX = fx; A.destZ = fz; }
    } else {
      A.mode = 'counter';                            // 自卫反击:就地刹车,发射架指向最近威胁
      A.cluster = { x: ne.o.group.position.x, z: ne.o.group.position.z,
                    y: ne.o.group.position.y + 1.0, count: 1 };   // 齐射落点围绕威胁坦克
      A.clusterT = 2.5;                              // 反击期间不让全局集群搜索覆盖目标
      A.destX = tp.x; A.destZ = tp.z;                // Clear the stale destination immediately and hold position.
    }
  } else if (cl && dCl > AC.maxRange - 15) {
    // 最密集敌群还在射程外 → 压到"射程边界以内"(距敌群 maxRange-40)
    A.mode = 'push';
    if (gameT >= A.reposT) {
      var ux = (cl.x - tp.x) / dCl, uz = (cl.z - tp.z) / dCl;
      var px2 = clamp(tp.x + ux * (dCl - (AC.maxRange - 40)), -B, B);
      var pz2 = clamp(tp.z + uz * (dCl - (AC.maxRange - 40)), -B, B);
      if (validDest(px2, pz2, t)) { A.destX = px2; A.destZ = pz2; A.reposT = gameT + 3.5; }
    }
  } else if (cl && dCl < AC.minRange + 15) {
    // 敌群顶到最小射程内(但尚未贴身)→ 沿轴线后撤出缓冲区
    A.mode = 'back';
    if (gameT >= A.reposT) {
      var bx = (tp.x - cl.x) / dCl, bz = (tp.z - cl.z) / dCl;
      var bx2 = clamp(tp.x + bx * (AC.minRange + 40 - dCl), -B, B);
      var bz2 = clamp(tp.z + bz * (AC.minRange + 40 - dCl), -B, B);
      if (validDest(bx2, bz2, t)) { A.destX = bx2; A.destZ = bz2; A.reposT = gameT + 3.5; }
    }
  } else {
    A.mode = 'fire';                                   // 安全 + 敌群已在射程边界以内 → 驻锄优先射击
    A.destX = tp.x; A.destZ = tp.z;                    // 关键:就地驻锄!清掉 push 遗留的过时目的地
  }
  // 火箭弹逃生优先于一切阵地纪律(齐射锁死除外:物理动不了;逃生点由 maybeEvadeRocket 装定)
  if (A.evadeT > 0) { A.mode = 'flee'; A.destX = A.evadeX; A.destZ = A.evadeZ; }
  /* Artillery keeps its own cluster fire solution as the combat priority.  Only
     when there is no current enemy cluster and no danger does the empty-mission
     movement executor use the pickup destination; it never sacrifices a ready
     counter-shot merely to collect a bonus. */
  if (!danger && !cl && A.evadeT <= 0 && A._powerupDrive && A._powerupTarget &&
      !A._powerupTarget._removed && A._powerupTarget.expiresAt > gameT) {
    A.destX = A._powerupTarget.x;
    A.destZ = A._powerupTarget.z;
    A.destT = Math.max(A.destT || 0, 0.35);
  }

  var ddx = A.destX - tp.x, ddz = A.destZ - tp.z, destDist = Math.sqrt((ddx)*(ddx)+(ddz)*(ddz));
  var arrived = destDist < 10;
  var sdxA = ddx, sdzA = ddz;   // P2 寻路航点(逃生/到站自动直行)
  if (!arrived && typeof navSteer === 'function') { var _nwA = navSteer(t, A.destX, A.destZ, tp); if (_nwA) { sdxA = _nwA.x - tp.x; sdzA = _nwA.z - tp.z; } }

  // 移动(到界/停稳是开火前提;齐射期间上面已锁死)
  var drvA = steerCached(t, sdxA, sdzA);                 // 2C:10Hz 缓存避障(输入突变>25% 立即重评);火箭炮转向慢,陈旧度零感知;下方 wantYaw/ma 两处消费间无重入,共享 _steerOut 安全
  var wantYaw = Math.atan2(drvA.x, drvA.z);
  var diff = normAng(wantYaw - t.yaw);
  var tm = turnMult(t) * slopeTurnMul(t), sm = speedMult(t);
  var _aiYawStep = clamp(diff, -t.turn0 * tm * dt, t.turn0 * tm * dt);
  groundYawInertia(t, dt > 0 ? _aiYawStep / dt : 0, t.turn0 * tm, dt);
  var ma = Math.abs(normAng(Math.atan2(drvA.x, drvA.z) - t.yaw));
  var evd = A.evadeT > 0;                              // 火箭弹逃生:全油门
  var th = arrived ? 0 : (ma < 1.45 ? clamp(1 - ma / 1.7, evd ? 0.6 : 0.25, 1) : (ma > 1.75 ? (evd ? -0.8 : -0.5) : (evd ? 0.5 : 0.2)));
  t._throttle = th; t._throttleLock = 0;
  if (typeof SIM_K === 'undefined' || SIM_K <= 0) t.speed = approachSpeed(t.speed, th * t.speed0 * sm, t.accel0 * engineEff(t), t.decel0 * Math.max(engineEff(t), 0.3), dt);   // 加/减速 ∝ 发动机效率(30% 刹车地板)
  applyMotion(t, dt);
  if (t._laserSuppressed) return;                              // 激光照射期间暂停发射架瞄准/开火,移动和规避仍继续

  if (danger) {
    // 装填中:不射,发射架回正专心逃命(上面已设好逃跑目的地)
    if (t.reload > 0 || t.mods.gun.hp <= 0) {
      artyGate(t, 'danger');
      t.gunPitch += (0.35 - t.gunPitch) * Math.min(1, dt);
      return;
    }
    // —— 停车反击:每帧伺服最近威胁,停稳即刻开火(近距低伸弹道,不过思考节拍) ——
    var te = ne.o.group.position;
    var dxe = te.x - tp.x, dze = te.z - tp.z;
    var dHe = Math.sqrt((dxe)*(dxe)+(dze)*(dze));
    var wantAzE = Math.atan2(dxe, dze);                         // 世界方位
    // 世界反馈伺服:按实测炮管方向收敛 —— 车体朝向/坡地姿态不再带偏弹道
    t.gunPivot.getWorldDirection(_gaDir);
    var bAzE = Math.atan2(_gaDir.x, _gaDir.z);
    var bElE = Math.asin(clamp(_gaDir.y, -1, 1));
    var tdiffE = normAng(wantAzE - bAzE);
    var trE = t.turretRate0 * turretMult(t);
    t.turretYaw += clamp(tdiffE, -trE * dt, trE * dt);
    var solE = rocketSolve(dHe, (tp.y + 2.4) - (te.y + 1.0));   // 纯火箭炮高差精确解
    t.rocketV = solE.v;
    var pdiffE = solE.theta - bElE;
    t.gunPitch = clamp(t.gunPitch + clamp(pdiffE, -0.45 * dt, 0.45 * dt), -0.1, 1.02);
    if (!arrived || Math.abs(t.speed) > 1.0) { artyGate(t, 'braking'); return; }   // 刹车中
    if (friendProx(t, te.x, te.z, 22)) { artyGate(t, 'friend'); return; }     // 同一误伤保险
    if (Math.abs(tdiffE) < 0.03 && Math.abs(pdiffE) < 0.025) {                     // 瞄准到位 → 立即开火
      t.salvoLeft = AC.salvo; t.salvoT = 0.05 + Math.random() * 1.2;   // 纯火箭炮齐射(★任务27⑥:近距反制小幅错峰,自卫响应仍快)
      t._salvoAimX = te.x; t._salvoAimZ = te.z;
      artyGate(t, 'COUNTER');
    } else {
      artyGate(t, 'aiming');
    }
    return;
  }
  if (!cl) {                                           // 无目标则发射架回正
    t.gunPitch += (0.35 - t.gunPitch) * Math.min(1, dt);
    return;
  }
  // 友军保险(防死锁)——落点离友军<22m 时沿"远离最近友军"方向推移45m(至多两次),
  //   绝不原地干坐;推移后仍冲突才放弃本拍。
  var aimX = cl.x, aimZ = cl.z, aimY = cl.y;
  for (var foI = 0; foI < 2 && friendProx(t, aimX, aimZ, 22); foI++) {
    var fo = nearestFriendOf(t, aimX, aimZ);
    if (!fo) break;
    var fox = aimX - fo.x, foz = aimZ - fo.z, fol = Math.sqrt((fox)*(fox)+(foz)*(foz)) || 1;
    aimX += fox / fol * 45; aimZ += foz / fol * 45; aimY = terrainH(aimX, aimZ) + 1.2;
  }
  // —— 发射架/炮塔伺服:每帧跟随(推移后的)落点方位/弹道(跟踪移动目标的关键,绝不能压在思考节拍里) ——
  var dxd = aimX - tp.x, dzd = aimZ - tp.z;
  var dHor = Math.sqrt((dxd)*(dxd)+(dzd)*(dzd));
  var wantAz = Math.atan2(dxd, dzd);                         // 世界方位
  // 世界反馈伺服:按实测炮管方向收敛(必须用世界方位;若误当炮塔本地角,落点会绕车体旋转 hull-yaw 角)
  t.gunPivot.getWorldDirection(_gaDir);
  var bAzC = Math.atan2(_gaDir.x, _gaDir.z);
  var bElC = Math.asin(clamp(_gaDir.y, -1, 1));
  var tdiff = normAng(wantAz - bAzC);
  var tr = t.turretRate0 * turretMult(t);
  t.turretYaw += clamp(tdiff, -tr * dt, tr * dt);
  var solC = rocketSolve(dHor, (tp.y + 2.4) - aimY);         // 解算用推移后落点高差
  t.rocketV = solC.v;
  var pdiff = solC.theta - bElC;
  t.gunPitch = clamp(t.gunPitch + clamp(pdiff, -0.45 * dt, 0.45 * dt), -0.1, 1.02);

  // —— 开火触发判定(思考节拍节流;所有门双方完全一致) ——
  if (A.thinkT > 0) return;
  A.thinkT = rand(0.35, 0.55);
  A.acc = aiBaseDispersion(t, 0);   // 火箭炮 AI 与玩家同源统一散布

  if (!arrived || Math.abs(t.speed) > 1.0 || t.reload > 0 || t.mods.gun.hp <= 0) {
    artyGate(t, !arrived ? 'moving' : (t.reload > 0 ? 'reload' : (Math.abs(t.speed) > 1.0 ? 'speed' : 'gun'))); return;
  }
  if (dHor < AC.minRange || dHor > AC.maxRange) { artyGate(t, 'range'); return; }
  if (friendProx(t, aimX, aimZ, 22)) { artyGate(t, 'friend'); return; }   // 双方同一保险(已推移仍冲突才放弃)
  // 瞄准到位 → 开火(火箭=齐射)
  if (Math.abs(tdiff) < 0.03 && Math.abs(pdiff) < 0.025) {
    /* ★任务27⑥ 齐射去同步:同阵营 4 门共享同一聚类缓存(2.5s),开战即同拍齐射——
       8 门×40/6 发同时泼向同一集群=爆点卡到达率 ~10/s 顶满 28 槽池(反复闪现)+填充率(卡)。
       起点随机错峰 0~3s:瞬时到达率减半,总火力/散布/弹道/装填全不变(仅发射时刻平移)。 */
    t.salvoLeft = AC.salvo; t.salvoT = 0.05 + Math.random() * 3.0;   // 纯火箭炮齐射(错峰)
    t._salvoAimX = aimX; t._salvoAimZ = aimZ;
    artyGate(t, 'SALVO');
  } else {
    artyGate(t, 'aiming');
  }
}

/* ===== 偷懒审计(DBG 专用):"该赶路却原地杵着"的连续时长 ——
   偷懒定义:存活 AI 坦克/歼击车,发动机与双履带完好、未在齐射锁死、
   目标(≈最近敌)距离 > 交战距离+10m(交火底线:坦克≈410~460/M1≈590~660/89式 2400 封顶),
   车速却 |v|<0.45 持续不动。 ===== */
var dbgShirk = { worstEver: 0, campWorstEver: 0 };
function shirkTrack(t, dt) {
  var A = t.ai;
  if (!A || !t.alive || t.kind === 'arty') return;   // 火箭炮走独立 AI,正常参与审计
  var fr = combatFloorOf(t, A.targetO);   // 交战距离内装填/对射/找射界都是战术动作,不算偷懒
  var idle = Math.abs(t.speed) < 0.45 &&
             t.mods.engine.hp > 0 && t.mods.fuel.hp > 0 && t.mods.trackL.hp > 0 && t.mods.trackR.hp > 0 && !t.fire &&   // 断油趴窝不算偷懒
             (gameT - (t.lastHitT || -99)) > 5 &&                       // 刚挨揍在避险不算偷懒
             A.targetO && A.targetO.alive &&
             Math.sqrt((A.targetO.group.position.x - t.group.position.x)*(A.targetO.group.position.x - t.group.position.x)+(A.targetO.group.position.z - t.group.position.z)*(A.targetO.group.position.z - t.group.position.z)) > fr + 10;
  if (idle) t._shirkC = (t._shirkC || 0) + dt; else t._shirkC = 0;
  if (t._shirkC > dbgShirk.worstEver) dbgShirk.worstEver = t._shirkC;
  // —— 扎营审计(交战相):距敌 ≤155m(在交战域)却全程原地不动 ——
  //    掩体躲藏(reload>0 或刚挨揍 5s 内)属合理避险;装填完毕 + 安全期还干坐 = 扎营对峙
  var A2 = t.ai, camp = false;
  if (A2 && t.alive && t.kind !== 'arty' &&
      t.mods.engine.hp > 0 && t.mods.fuel.hp > 0 && t.mods.trackL.hp > 0 && t.mods.trackR.hp > 0 &&
      Math.abs(t.speed) < 0.45 && t.reload <= 0.6 &&
      (gameT - (t.lastHitT || -99)) > 5 &&
      A2.targetO && A2.targetO.alive) {
    var cd = Math.sqrt((A2.targetO.group.position.x - t.group.position.x)*(A2.targetO.group.position.x - t.group.position.x)+(A2.targetO.group.position.z - t.group.position.z)*(A2.targetO.group.position.z - t.group.position.z));
    camp = cd <= 155;
  }
  if (camp) t._campC = (t._campC || 0) + dt; else t._campC = 0;
  if ((t._campC || 0) > dbgShirk.campWorstEver) dbgShirk.campWorstEver = t._campC;
}

/* ===== AI 直升机三层解耦自动驾驶与战术火控 (全计算值驱动, 无场景决策常数) =====
   层1 战术需求 (aiHeliUpdate): 武器包线/交火底线/命中率/地形前瞻/导弹运动学 → 期望速度/高度/指向;
       多武器独立火控 (远距导弹/中近距火箭齐射/近距机炮伺服) 与来袭导弹规避并行, 无模式硬切换。
   层2 制导反解 (heliGuidanceSolve): 速度误差→机体加速度→atan(a/g_eff) 姿态反解 (协调转弯涌现);
       高度误差→制动限幅垂直速度→总距 (倾斜配平+过载反解)。
   层3 SAS 伺服 (heliAttitudeSAS): 姿态环→角速度环→桨盘倾角, 极点配置增益, 受损权限自动降级。
   治理器 (evaluateHeliRecoveryEnv): 1.6s 回正前瞻 → 机动烈度 env∈[0,1] 收紧包线, 余量枯竭全力改出。 */

/* 治理器: 1.6s 回正能力前瞻 —— 评估"立即全力改平+满总距爬升"的净空与姿态裕度,
   输出连续机动烈度 env∈[0,1] (1=可全力机动, 0=完全丧失余量),连续量替代布尔门限避免姿态硬切;
   模拟输入为改平杆而非回放当前指令, 姿态超限按等效净空损失折算。 */
function evaluateHeliRecoveryEnv(t) {
  var prm = HELI_PARAMS[t.kind] || HELI_PARAMS.wz10;
  var p = t.group.position;
  var px = p.x, py = p.y, pz = p.z;
  var vx = t._heliVx || 0, vy = t._heliVy || 0, vz = t._heliVz || 0;
  var pitch = t._heliPitch || 0, roll = t._heliRoll || 0, yaw = t.yaw || 0;
  var pitchRate = t._heliPitchRate || 0, rollRate = t._heliRollRate || 0;
  var sTiltP = t._heliRotorTiltPitch || 0, sTiltR = t._heliRotorTiltRoll || 0;

  var dtOuter = 0.20;
  var steps = 8;                      // 8 * 0.2s = 1.6s 前瞻时域
  var subN = 4;                       // 每外步 4 个 0.05s 子步(姿态环带宽 13.5/s 下显式积分稳定)
  var dtSub = dtOuter / subN;
  var minMargin = 999;
  var gWeight = prm.mass * 9.8;
  var invMassEff = 2.0 / prm.mass;   // 真实化: 真实质量×0.5 折中(原1/6火箭惯性)

  var _g = heliSASGains(t, prm);                                   // 与实时伺服同一组增益(见 heliSASGains)
  var rpmFrac = _g.rpmFrac;                                        // 推力模拟用(thrustSim ∝ rpmFrac²)
  var maxCyclic = HELI_SAS_MAX_CYCLIC;
  var kP = _g.kP, kR = _g.kR, c = _g.c, lam = _g.lam, kA = _g.kA;
  var omMaxP = _g.omMaxP, omMaxR = _g.omMaxR;
  var tiltLag = 1.0 - Math.exp(-HELI_TILT_RESP * dtSub);

  // 姿态超限等效净空折算率: 超限 1rad 时配平失效,持续下滑加速度 ≈ 9.8×6×(1−cos1rad) ≈ 27m/s²,
  // 乘典型改平时间 0.75s ≈ 20m/rad(由物理推导,非拍定值)
  var attPenaltyPerRad = 20.0;

  var cosY = Math.cos(yaw), sinY = Math.sin(yaw); // 循环不变量外提
  for (var k = 1; k <= steps; k++) {
    for (var sk = 0; sk < subN; sk++) {
      // —— SAS 改平闭环模拟(姿态指令=0,与 heliAttitudeSAS 同控制律:
      //    物理对象 ω̇=−k·tilt−c·ω,极点配置 ⇒ tilt=(λ·ω−(c+λ)·ω_des)/k) ——
      if (kP > 0.05) {
        var rateDesP = clamp(-pitch * kA, -omMaxP, omMaxP);
        var tiltCmdP = clamp((lam * pitchRate - (c + lam) * rateDesP) / kP, -maxCyclic, maxCyclic);
        sTiltP += (tiltCmdP - sTiltP) * tiltLag;
        pitchRate += (-sTiltP * kP - pitchRate * c) * dtSub;
        pitch += pitchRate * dtSub;
      } else {
        pitchRate *= Math.max(0, 1 - c * dtSub);
        pitch += pitchRate * dtSub;
      }
      if (kR > 0.05) {
        var rateDesR = clamp(-roll * kA, -omMaxR, omMaxR);
        var tiltCmdR = clamp((lam * rollRate - (c + lam) * rateDesR) / kR, -maxCyclic, maxCyclic);
        sTiltR += (tiltCmdR - sTiltR) * tiltLag;
        rollRate += (-sTiltR * kR - rollRate * c) * dtSub;
        roll += rollRate * dtSub;
      } else {
        rollRate *= Math.max(0, 1 - c * dtSub);
        roll += rollRate * dtSub;
      }

      // —— 垂直/水平通道: 满总距爬升 + 当前姿态倾角下的实际推力矢量 ——
      var thrustSim = gWeight * (prm.collMax / prm.collHover) * rpmFrac * rpmFrac;
      var cosP = Math.cos(pitch), cosR = Math.cos(roll);
      var sinP = Math.sin(pitch), sinR = Math.sin(roll);

      var tWorldY = thrustSim * cosP * cosR;
      var tWorldFwd = thrustSim * sinP;
      var tWorldX = tWorldFwd * sinY - thrustSim * sinR * cosY;
      var tWorldZ = tWorldFwd * cosY + thrustSim * sinR * sinY;

      var dragX = -prm.dragKH * vx * Math.abs(vx);
      var dragZ = -prm.dragKH * vz * Math.abs(vz);
      var dragY = -prm.dragKV * vy * Math.abs(vy);

      vx += (tWorldX + dragX) * invMassEff * dtSub;
      vz += (tWorldZ + dragZ) * invMassEff * dtSub;
      vy += (tWorldY + dragY - gWeight) * invMassEff * dtSub;

      px += vx * dtSub;
      pz += vz * dtSub;
      py += vy * dtSub;
    }

    var groundH = terrainH(px, pz);
    var clearance = py - groundH;
    var tLevel = (Math.abs(pitch) / 1.8) + (Math.abs(pitchRate) / 6.0) + 0.15;
    var maxClimbAcc = Math.max(1.0, (gWeight * (prm.collMax / prm.collHover) - gWeight) * invMassEff);
    var sinkLoss = (vy < 0 ? (-vy * tLevel + (vy * vy) / (2 * maxClimbAcc)) : 0);

    // 姿态超限裕度: 超出物理包线的俯仰/横滚弧度按等效净空损失折算
    var attExcess = Math.max(0, Math.abs(pitch) - prm.maxPitch) + Math.max(0, Math.abs(roll) - prm.maxRoll);

    var margin = clearance - sinkLoss - attExcess * attPenaltyPerRad;
    if (margin < minMargin) minMargin = margin;
  }

  // env 归一基准: 恢复所需位移预算(由当前下沉率与满总距爬升过载计算),净空越充裕 env 越接近 1
  var tLook = dtOuter * steps;
  var aUpMax = Math.max(1.0, (gWeight * (prm.collMax / prm.collHover) - gWeight) * invMassEff);
  var marginRef = Math.abs(t._heliVy || 0) * tLook + 0.5 * aUpMax * tLook * tLook;
  return clamp(minMargin / marginRef, 0, 1);
}

/* 计算 AI 对目标的导弹命中率 (根据距离衰减、目标三维回避机动与横向速度引起的能量损失) */
function calcHeliMissileHitRate(shooter, tgt, dist) {
  var hitRate = 75.0;

  // 0. 导弹能量项: 预计到达速度 vArr = vMax·e^(−dragK·dist) (dv/dx = −dragK·v 闭式解) ——
  //    射程边缘动能耗尽, 机动能力 ∝ (vArr/vMax)², 命中率随能量衰减 (远界打机动目标基本无效)
  var mSpec = HELI_MSL_SPEC[heliMslTypeOf(shooter)] || { vMax: 680, dragK: 0.00035 };
  var vArr = mSpec.vMax * Math.exp(-mSpec.dragK * dist);
  hitRate -= clamp((1 - vArr / mSpec.vMax) * 45.0, 0, 45.0);

  // 1. 距离衰减:有效攻击区 400m~1500m 保持高命中率,1500m~2500m 随距离衰减
  if (dist < 400) {
    hitRate += 10.0;
  } else if (dist <= 1200) {
    hitRate += (1200 - dist) * 0.01;
  } else if (dist <= 2500) {
    hitRate -= (dist - 1200) * 0.035;
  } else {
    hitRate -= 50.0;
  }

  // 2. 目标横向机动速度与规避空间 (Transverse / Cross Velocity)
  // 目标横向速度越大,导弹按比例导引所需攻角和诱导阻力越大,能量损失剧烈
  var tp = tgt.group.position;
  var sp = shooter.group.position;
  var losX = (tp.x - sp.x) / (dist || 1);
  var losY = (tp.y - sp.y) / (dist || 1);
  var losZ = (tp.z - sp.z) / (dist || 1);

  var tvx = tgt._heliVx || tgt.vx || 0;
  var tvy = tgt._heliVy || tgt.vy || 0;
  var tvz = tgt._heliVz || tgt.vz || 0;

  var vRadial = tvx * losX + tvy * losY + tvz * losZ;
  var vCrossX = tvx - vRadial * losX;
  var vCrossY = tvy - vRadial * losY;
  var vCrossZ = tvz - vRadial * losZ;
  var crossSpd = Math.sqrt(vCrossX * vCrossX + vCrossY * vCrossY + vCrossZ * vCrossZ);

  hitRate -= clamp(crossSpd * 1.6, 0, 35);

  // 3. 目标类型与三维机动能力 (直升机具备大过载急转机动回避空间,地面车辆回避空间小)
  if (isHeliVehicle(tgt)) {
    var tgtRoll = Math.abs(tgt._heliRoll || 0);
    var tgtRate = Math.abs(tgt._heliRollRate || 0) + Math.abs(tgt._heliPitchRate || 0);
    if (tgtRoll > 0.25 || tgtRate > 0.4) {
      hitRate -= 15.0; // 剧烈机动大幅消耗导弹拦截能量
    }
    var tgtGroundH = terrainH(tp.x, tp.z);
    var tgtAlt = tp.y - tgtGroundH;
    if (tgtAlt < 12.0) {
      hitRate -= 10.0; // 贴地飞行利用地形隐蔽
    }
  } else {
    hitRate += 12.0; // 地面装甲车辆机动受限
  }

  // 4. 射手自身指向对准度
  var sFwd = _v1;
  shooter.group.getWorldDirection(sFwd);
  var aimDot = sFwd.x * losX + sFwd.y * losY + sFwd.z * losZ;
  if (aimDot < 0.90) {
    hitRate -= (0.90 - aimDot) * 100.0;
  }

  return Math.round(clamp(hitRate, 5, 95));
}

/* 来袭导弹规避 (10Hz 节流): 扫描以本机为目标的在途导弹(与 MAWS 告警同判据),
   按近炸引信半径/自身垂直过载/导弹转弯率反解规避需求 ——
   终末段: 垂直破近炸(净空足则俯冲否则急爬) + 水平 beam(横向速度 = ω_msl×R, 破坏比例导引 LOS 率);
   预防段: 贴地隐蔽 + 垂直于弹目视线周期变向; 经制导层平滑注入 vDes/altDes, 规避期间火控照常。 */
function heliThreatEvade(t, prm, vMaxNow) {
  /* ★P1-⑤(移动端恢复,仅触屏):距玩家 1.5km 之外的直升机来袭规避扫描 10Hz→5Hz;近场/桌面逐位不变。 */
  var _evThr = 0.10;
  if (typeof GFX_TOUCH !== 'undefined' && GFX_TOUCH && player && player.alive && player.group && t.group) {
    var _ehdx = t.group.position.x - player.group.position.x, _ehdz = t.group.position.z - player.group.position.z;
    if (_ehdx * _ehdx + _ehdz * _ehdz > 2250000) _evThr = 0.20;
  }
  if (t._evT != null && gameT - t._evT <= _evThr) return;
  t._evT = gameT;
  var p = t.group.position;
  var evPx = p.x, evPz = p.z;

  // 1. 统一威胁扫描(取拦截时间最近者): 直升机导弹 + 制导火箭 + 火箭炮/直升机火箭/常规坦克炮弹,
  //    并叠加曲射火箭落点预报(rocketThreats)。★四类弹种缺一不可:只扫 airborneMissiles
  //    会对火箭炮弹、直升机火箭弹、制导火箭弹、坦克炮弹全部失感 → 一切来袭都不躲。
  var bestTti = 99, bestR = 0, best = null;
  function evConsider(s) {
    if (!s || !s.pos || !s.vel || !s.owner || !areHostile(t, s.owner)) return;
    if (s.target && s.target !== t) return;                 // 指定打别的目标 → 非本机威胁
    var rx = s.pos.x - evPx, ry = s.pos.y - p.y, rz = s.pos.z - evPz;
    var R2 = rx * rx + ry * ry + rz * rz;
    if (R2 > 2560000) return;                               // >1600m 远端剪枝
    var v2 = s.vel.x * s.vel.x + s.vel.y * s.vel.y + s.vel.z * s.vel.z;
    if (v2 < 2025) return;                                  // 速度 <45m/s 不足为惧
    var R = Math.sqrt(R2); if (R < 1) R = 1;
    var closing = -(rx * s.vel.x + ry * s.vel.y + rz * s.vel.z) / R;
    var tti = closing > 0.3 ? R / closing : 99;
    if (tti < bestTti) { bestTti = tti; bestR = R; best = s; }
  }
  for (var si = 0; si < airborneMissiles.length; si++) evConsider(airborneMissiles[si]);
  for (var gi = 0; gi < airborneGuidedRockets.length; gi++) evConsider(airborneGuidedRockets[gi]);
  for (var sj = 0; sj < shells.length; sj++) {
    var sh = shells[sj];
    if (sh && sh.isHeliMissile) continue;                   // 已在导弹表, 避免重复
    evConsider(sh);                                         // 直升机火箭弹/火箭炮火箭弹/常规坦克炮弹统一入扫
  }
  // 曲射火箭落点预报(rocketThreats 为全局落点/绝对命中时间; 落点贴近本机才触发)
  if (typeof rocketThreats !== 'undefined' && rocketThreats.length) {
    for (var rt = 0; rt < rocketThreats.length; rt++) {
      var th = rocketThreats[rt];
      if (!th || !th.o || !areHostile(t, th.o)) continue;
      var dxl = th.x - evPx, dzl = th.z - evPz;
      var dl = Math.sqrt(dxl * dxl + dzl * dzl);
      if (dl > 150) continue;                               // 落点离我 >150m 不躲
      var ttiT = th.impactAt - gameT;
      if (ttiT > 0 && ttiT < bestTti) {
        bestTti = ttiT; bestR = dl;
        best = { pos: { x: th.x, y: 0, z: th.z }, vel: { x: 0, y: 0, z: 0 }, missileType: null, _landing: true, airstrike: !!th.airstrike };
      }
    }
  }
  /* AI helicopter countermeasure doctrine: deploy one four-flare salvo when
     an incoming missile enters the 1 km lure envelope and the rack is ready.
     One threat object is latched so a single missile cannot drain the magazine
     during the 10 Hz threat scan; triggerHeliDecoy owns the reload/cooldown gates. */
  if (best && best.isHeliMissile && bestR > 40.0 && bestR <= HELI_DECOY_LURE_RANGE &&
      !t.isPlayer && typeof isHeliVehicle === 'function' && isHeliVehicle(t) &&
      typeof triggerHeliDecoy === 'function' &&
      (t._heliDecoyThreat !== best || gameT - (t._heliDecoyThreatT || -Infinity) > 5.0)) {
    if (triggerHeliDecoy(t)) {
      t._heliDecoyThreat = best;
      t._heliDecoyThreatT = gameT;
    }
  }
  t._evadeTti = bestTti;
  if (!best) {
    t._evadeTerm = false; t._evadeVX = 0; t._evadeVZ = 0; t._evadeAlt = 0;
    // 无弹在途但被敌地面火力瞄准解算 → beam weave(横切其视线周期变向, 破坏提前量装定与瞄准门收敛);
    // 例外: 自己已进入对同一瞄准者的火箭末段射窗时保持航迹稳定(攻击/生存权衡, 与 DCS "武器释放前稳定段"同则)
    var myTgtE = t.ai && t.ai.targetO;
    var inOwnSolution = (t._heliWeapon === 2) && myTgtE && myTgtE.alive && t._aimedBy === myTgtE && (t._distToTgt || 9999) <= 430;
    if (!inOwnSolution && t._aimedByT != null && gameT - t._aimedByT < 1.2) {
      var aLx = p.x - t._aimedByX, aLz = p.z - t._aimedByZ;
      var aLl = Math.sqrt(aLx * aLx + aLz * aLz) || 1;
      var aFlip = ((Math.floor(gameT / 1.6) + (t._heliSlot || 0)) % 2 === 0) ? 1 : -1;
      var aMag = 0.5 * vMaxNow;
      t._evadeVX = (-aLz / aLl) * aFlip * aMag;
      t._evadeVZ = ( aLx / aLl) * aFlip * aMag;
    }
    return;
  }

  // 2. 威胁库: 导弹转弯率能力(与 stepShells 导引头同源口径);自身垂直可用过载(与物理同源)
  var omM = best.missileType ? ((best.missileType === 'ty90') ? 2.8 : 2.4) : 2.2;   // 非导弹(火箭/炮弹)取通用估计
  var aEv = (prm.collMax - prm.collHover) * HELI_ACC_PER_COLL;
  var fuseR = 8.0;                                                // 近炸引信半径(stepShells 同源)
  var tEv = Math.sqrt(2.0 * (2.0 * fuseR) / aEv);                 // 完成破近炸位移(2×引信半径)所需时间
  var ttiTrig = tEv + 1.0 / HELI_SAS_LAM + 1.0 / HELI_TILT_RESP;  // + 操纵链延迟(角速度环+桨盘响应倒数)

  var curAlt = Math.max(0, p.y - (t._curGroundH != null ? t._curGroundH : terrainH(p.x, p.z)));

  if (bestTti < ttiTrig) {
    // 终末段: 垂直破近炸 —— 垂直通道在本物理下权限最强(满总距/零总距对称过载)
    var disp = 0.5 * aEv * bestTti * bestTti;
    t._evadeTerm = true;
    t._evadeAlt = ((curAlt - disp) > 15.0) ? -disp : disp;   // 净空内可完成则俯冲,否则急爬
    // 横向脱离: 方向 = 垂直威胁方位(导弹用速度方向 / 曲射落点用落点方位),顺势取与当前速度同侧
    var dgx, dgz;
    if (best._landing || (best.vel && (best.vel.x * best.vel.x + best.vel.z * best.vel.z) < 1)) {
      dgx = evPx - best.pos.x; dgz = evPz - best.pos.z;
    } else {
      dgx = best.vel.x; dgz = best.vel.z;
    }
    var dgl = Math.sqrt(dgx * dgx + dgz * dgz);
    if (dgl > 0.001) {
      var bx = -dgz / dgl, bz = dgx / dgl;
      var side = ((t._heliVx || 0) * bx + (t._heliVz || 0) * bz) >= 0 ? 1 : -1;
      var vEvMag = Math.min(best._landing ? 34.0 : omM * bestR, prm.maxSpeedH);
      t._evadeVX = bx * side * vEvMag;
      t._evadeVZ = bz * side * vEvMag;
    }
  } else {
    // 预防段: 水平做垂直于弹目视线的周期变向(slot 奇偶每 2s 换向,破坏瞄准解算)
    t._evadeTerm = false;
    t._evadeAlt = 0;
    var lx = best.pos.x - evPx, lz = best.pos.z - evPz;
    var ll = Math.sqrt(lx * lx + lz * lz) || 1;
    var flip = ((Math.floor(gameT / 2.0) + (t._heliSlot || 0)) % 2 === 0) ? 1 : -1;
    var vEvMag2 = 0.45 * vMaxNow;                             // 增强预防段横向变向破坏瞄准解算
    t._evadeVX = (-lz / ll) * flip * vEvMag2;
    t._evadeVZ = ( lx / ll) * flip * vEvMag2;
  }
}

/* 制导反解层: 期望速度矢量/期望高度 → 姿态角指令 + 总距指令 (全部物理反解,无场景常数):
   水平: 速度误差/τ → 机体加速度 → atan(a/g_eff) 姿态反解(协调压坡度转弯自动涌现);
   垂直: 高度误差 → 制动曲线限幅的期望垂直速度 → 加速度 → 总距(倾斜配平+过载反解);
   g_eff 含垂直加速度需求: 硬爬升时姿态角自动收缩(与旋翼推力预算物理一致)。 */
function heliGuidanceSolve(t, prm, vDesX, vDesZ, altDes, env) {
  var p = t.group.position;
  var vx = t._heliVx || 0, vy = t._heliVy || 0, vz = t._heliVz || 0;
  var yaw = t.yaw || 0;
  var curGroundH = t._curGroundH != null ? t._curGroundH : terrainH(p.x, p.z);
  var curAlt = Math.max(0, p.y - curGroundH);

  // —— 垂直通道: 高度误差 → 期望垂直速度(安全接地限幅) → 垂直加速度 ——
  var aVmax = (prm.collMax - prm.collHover) * HELI_ACC_PER_COLL;
  var altErr = altDes - curAlt;
  var vyCap = Math.sqrt(2.0 * aVmax * HELI_SAFE_TOUCH);   // 可在安全接地距离内刹停的垂直速度
  var vyDes = clamp(altErr / HELI_TAU_ALT, -vyCap, vyCap);
  var aVert = clamp((vyDes - vy) * (2.0 / HELI_TAU_ALT), -aVmax, aVmax);

  // —— 水平通道: 速度误差 → 机体加速度 → 姿态反解 ——
  var eVx = vDesX - vx, eVz = vDesZ - vz;
  var sinY = Math.sin(yaw), cosY = Math.cos(yaw);
  var aFwd = (eVx * sinY + eVz * cosY) / HELI_TAU_G;
  var aLat = (eVx * cosY - eVz * sinY) / HELI_TAU_G;
  var gEff = 9.8 + aVert;

  var pitchCmd = clamp(-Math.atan2(aFwd, gEff), -prm.maxPitch * env, prm.maxPitch * env);
  var rollCmd  = clamp(-Math.atan2(aLat, gEff),  -prm.maxRoll  * env, prm.maxRoll  * env);

  // —— 总距: 倾斜配平 + 垂直加速度反解(1:1 物理映射), 按当前旋翼升力效率(转速²)折算,
  //       并钳制到当前转速能支撑的上限 (cap=转速, 与 updateHeli 物理层同口径) ——
  var tiltCos = Math.max(0.40, Math.cos(t._heliPitch || 0) * Math.cos(t._heliRoll || 0));
  var rpmFracG = clamp(heliRotorFrac(t, prm), 0, 1);
  var capG = heliCollCap(rpmFracG);
  var collCmd = clamp(prm.collHover / tiltCos + aVert / (HELI_ACC_PER_COLL * Math.max(0.15, rpmFracG * rpmFracG)), 0.15, Math.min(prm.collMax, capG));

  _heliGuideOut.pitchCmd = pitchCmd; _heliGuideOut.rollCmd = rollCmd; _heliGuideOut.collCmd = collCmd;
  return _heliGuideOut;
}
/* SAS 增益单一真源:级联极点配置的全部增益都只是"旋翼转速权限 cyclicAuth"的函数。
   heliAttitudeSAS(实时伺服)与 heliCrashPredict(前瞻改出模拟)必须用同一组增益,
   否则预测出的改平能力与飞机实际改平能力不符,撞地告警会系统性偏早或偏晚。
   出参对象复用,调用方同步消费,零分配。 */
var HELI_SAS_MAX_CYCLIC = 15.0 * Math.PI / 180.0;      // 桨盘周期变距行程上限 (rad)
var _heliSASGains = { rpmFrac: 0, kP: 0, kR: 0, c: 0, lam: 0, kA: 0, omMaxP: 0, omMaxR: 0 };
function heliSASGains(t, prm) {
  var rpmFrac = heliRotorFrac(t, prm);
  var cyclicAuth = clamp(rpmFrac, 0, 1);                 // 旋翼转速 → 操纵权限 (停转=0)
  var g = _heliSASGains;
  g.rpmFrac = rpmFrac;                                   // 反扭矩/推力解算另需生转速比(可 >1),不截断
  g.kP = HELI_TORQUE_P * cyclicAuth;
  g.kR = HELI_TORQUE_R * cyclicAuth;
  g.c = HELI_RATE_DAMP;
  g.lam = HELI_SAS_LAM;
  g.kA = HELI_SAS_KA;
  g.omMaxP = 0.85 * g.kP * HELI_SAS_MAX_CYCLIC / g.c;    // 角速度指令限幅 (留 15% 行程余量)
  g.omMaxR = 0.85 * g.kR * HELI_SAS_MAX_CYCLIC / g.c;
  return g;
}

var _heliGuideOut = { pitchCmd: 0, rollCmd: 0, collCmd: 0 };   // 出参复用(调用方同步消费, 零分配)

/* SAS 姿态伺服层: 姿态角指令 → 周期变距/尾桨操纵量。级联结构(姿态环→角速度环→桨盘倾角),
   增益全部由物理力矩参数极点配置反解,随机体状态自适应:
   旋翼转速下降时操纵权限自动补偿(k∝cyclicAuth),旋翼停转输出归零,尾桨损毁偏航输出归零。
   所有武器分支统一经本层输出 —— 根治导弹/火箭模式横滚通道开环漂移导致的侧翻坠机。 */
function heliAttitudeSAS(t, prm, pitchCmd, rollCmd, yawRateCmd) {
  var _g = heliSASGains(t, prm);                                   // 与前瞻改出模拟同一组增益(见 heliSASGains)
  var rpmFrac = _g.rpmFrac;                                        // 主旋翼反扭矩前馈用(torqueYaw ∝ rpmFrac²)
  var maxCyc = HELI_SAS_MAX_CYCLIC;
  var kP = _g.kP, kR = _g.kR, c = _g.c, lam = _g.lam, kA = _g.kA;

  // 俯仰通道: 姿态环(角速度指令) → 角速度环(桨盘倾角指令)。
  // 物理对象 ω̇ = −k·tilt − c·ω(updateHeli 力矩负号),极点配置 ω̇=(c+λ)(ω_des−ω)
  // ⇒ tilt = (λ·ω − (c+λ)·ω_des)/k
  var omMaxP = _g.omMaxP;
  var rateDesP = clamp(kA * (pitchCmd - (t._heliPitch || 0)), -omMaxP, omMaxP);
  var tiltCmdP = kP > 0.05 ? (lam * (t._heliPitchRate || 0) - (c + lam) * rateDesP) / kP : 0;
  var fwdIn = clamp(tiltCmdP / maxCyc, -1, 1);

  // 横滚通道
  var omMaxR = _g.omMaxR;
  var rateDesR = clamp(kA * (rollCmd - (t._heliRoll || 0)), -omMaxR, omMaxR);
  var tiltCmdR = kR > 0.05 ? (lam * (t._heliRollRate || 0) - (c + lam) * rateDesR) / kR : 0;
  var latIn = clamp(tiltCmdR / maxCyc, -1, 1);

  // 偏航通道: 期望偏航角速度 → 尾桨操纵量(按尾桨推力稳态关系反解,主旋翼反扭矩前馈补偿)。
  // 机头指向与速度矢量解耦(速度矢量制导下侧滑由制导层吸收),偏航率上限=尾桨权限的 85%
  var tailDead = !!(t.mods.tailRotor && t.mods.tailRotor.hp <= 0);
  var tailFrac = tailDead ? 0 : clamp((t._heliTailRotorRPM || 0) / prm.tailOmega0, 0, 1.15);
  var turnIn = 0;
  if (tailFrac > 0.05) {
    var torqueYaw = -prm.torqueYawK * rpmFrac * rpmFrac * ((t._heliCollective || 0) || 0.1);
    var yawAccDes = kA * (yawRateCmd - (t._heliYawRate || 0));
    var turnRaw = (yawAccDes - torqueYaw * (1 - tailFrac) + (t._heliYawRate || 0) * HELI_YAW_DAMP) / (tailFrac * prm.tailAuthK * 6.0);
    turnIn = clamp(turnRaw, -1, 1);
  }

  _heliSasOut.fwdIn = fwdIn; _heliSasOut.latIn = latIn; _heliSasOut.turnIn = turnIn;
  return _heliSasOut;
}
var _heliSasOut = { fwdIn: 0, latIn: 0, turnIn: 0 };   // 出参复用(调用方同步消费, 零分配)

function aiHeliUpdate(t, dt) {
  var A = t.ai;
  if (!A) return;
  updateHeliWeapons(t, dt); // 同步驱动 AI 直升机装填时钟、独立导弹计时与武器冷却

  // 1. 目标锁定滞后与防频繁切换:如果当前已有有效活体目标,且目标在 2.5s 视界记忆窗内,维持当前目标,不盲目全场重扫
  var tgt = A.targetO;
  if (!tgt || !tgt.alive) {
    if (t._ptT == null || gameT - t._ptT > 0.5) { t._ptT = gameT; pickTarget(t); }   // 无目标期 0.5s 节流(全表扫;目标阵亡即时重选逻辑保留)
    tgt = A.targetO;
  } else if (A.thinkT <= 0) {
    A.thinkT = rand(1.2, 2.0); // 1.2s~2.0s 稳定思考节拍,避免频繁打断与目标跳跃
    if (gameT - (A.tgtT || 0) > 2.5) {
      pickThreat(t);
      tgt = A.targetO;
    }
  }

  // 编队槽位与独立战术偏置 (Slot ID)
  if (t._heliSlot == null) {
    var myTeamRoster = isFfaMode() ? aliveList : friendlyRosterOf(t);
    var myIdx = myTeamRoster.indexOf(t);
    t._heliSlot = myIdx >= 0 ? myIdx : (Math.floor(Math.random() * 6));
  }
  var slot = t._heliSlot;
  var slotAltOffset = (slot % 4) * 18.0; // 4 层高度梯次分布 (0m, 18m, 36m, 54m)
  var slotYawOffset = ((slot % 3) - 1) * (28.0 * Math.PI / 180.0); // 3 向扇面展开 (-28°, 0°, +28°)

  var prm = HELI_PARAMS[t.kind] || HELI_PARAMS.wz10;
  var p = t.group.position;

  // 性能优化:地形高度 20Hz 节流采样
  if (t._groundHT == null || gameT - t._groundHT > 0.05) {
    t._groundHT = gameT;
    t._curGroundH = terrainH(p.x, p.z);
  }
  var curGroundH = t._curGroundH != null ? t._curGroundH : terrainH(p.x, p.z);
  var curAlt = Math.max(0, p.y - curGroundH);

  var vx = t._heliVx || 0, vy = t._heliVy || 0, vz = t._heliVz || 0;
  var curYaw = t.yaw || 0;
  var vHoriz = Math.sqrt(vx * vx + vz * vz);

  // 2. 治理器: 回正能力评估先行(仅依赖机体状态,与当前指令解耦) → 连续机动烈度系数 env
  //    10Hz 节流 + 危险态(低高度/急降)逐帧重评;env 连续收紧姿态包线与速度预算,无指令跳变
  var needRmCheck = (t._rmT == null || gameT - t._rmT > 0.05);   // 统一 20Hz 上限(env 为平滑包络, 50Hz 重模拟无增益)
  if (needRmCheck) {
    t._rmT = gameT;
    t._rmEnv = evaluateHeliRecoveryEnv(t);
  }
  var env = t._rmEnv != null ? t._rmEnv : 1.0;

  // 3. 战术状态机: 武器分流 + 武器模式高度基线(参与后续多源高度合成)
  var altWeaponBase;
  var wantWeapon = 1;
  var distToTgt = 9999;
  var dx = 0, dz = 0, yawToTgt = 0, yawDiff = 0;

  var mslAvail = (t._heliMissileReloadTL <= 0 || t._heliMissileReloadTR <= 0) && (!t.mods.ammo || t.mods.ammo.hp > 0);   // 弹药架损毁=导弹能力永久丧失
  var rkAvail = (t._heliRocketLeft != null ? t._heliRocketLeft : rocketPodCountOf(t)) > 0;
  // 武器弹道包线(由下方 3Hz 解算刷新;首帧/无目标期用缓存或缺省)——交战距离/高度一律由此派生,无固定档位
  var rkMinE = t._rkMin != null ? t._rkMin : 90.0;
  var rkMaxE = t._rkMax != null ? t._rkMax : 420.0;   // 解算不可达=0(不选火箭, 触发下方爬升获程)
  var gunMaxE = t._gunMax != null ? t._gunMax : 320.0;

  if (tgt && tgt.alive) {
    var tp = tgt.group.position;
    dx = tp.x - p.x; dz = tp.z - p.z;
    distToTgt = Math.sqrt(dx * dx + dz * dz);
    yawToTgt = Math.atan2(dx, dz);
    yawDiff = normAng(yawToTgt - curYaw);

    // 3a. Weapon envelope solution (throttled to about 3 Hz; derived from simulation, spread, and threat limits):
    //   rkMin  火箭最小安全距离 = 4×溅射半径(近炸自伤安全);
    //   rkMax  火箭最大有效距离 = 弹道可达性(simulateHeliRocketImpact 沿目标视线仿真落点:
    //          制导型容差 4×溅射=PN 修正能力, 无制导容差 0.75×溅射) ∩ 精度上限
    //          (无制导 1σ 物理散布 ARTY_SALVO_EL×d ≤ 0.75×溅射; 制导型=规格射程);
    //          高度越高落点越远 → "占领高度增射程"由弹道自然涌现, 不可达(rkMax=0)时下方爬升获程环接管;
    //   gunMax 机炮最大有效距离 = combatFloorOf(本机,目标) —— 与坦克交火底线同源的散布解算(同一弹道数据库)
    if (t._wepT == null || gameT - t._wepT > 0.34) {
      t._wepT = gameT;
      var rkSpecE = HELI_RKT_SPEC[t.kind] || HELI_RKT_SPEC.ah64;
      var rkGuidedE = rkSpecE.guidance === 'datalink';
      // 精度上限: 无制导 1σ 物理散布(ARTY_SALVO_EL×d)不超过 0.75×溅射半径; 制导型 PN 修正散布, 取规格射程
      var rkMaxDisp = rkGuidedE ? rkSpecE.range : (0.75 * (rkSpecE.splashR || 22)) / ARTY_SALVO_EL;
      var reachOK;
      if (isHeliVehicle(tgt)) {
        // 对空目标: 弹道无地面截获问题, 规格射程∩散布上限内即可
        reachOK = distToTgt <= Math.min(rkSpecE.range, rkMaxDisp);
      } else {
        // 对地目标: 沿目标视线方向的弹道可达性仿真(与发射同一 simulateHeliRocketImpact 口径)
        var podE = heliRocketPodOrigin(t, 0);
        var edx = tp.x - podE.x, edy = (tp.y + 0.5) - podE.y, edz = tp.z - podE.z;
        var edl = Math.max(1.0, Math.sqrt(edx * edx + edy * edy + edz * edz));
        var impE = simulateHeliRocketImpact(podE,
          { x: vx + edx / edl * rkSpecE.v0, y: vy + edy / edl * rkSpecE.v0, z: vz + edz / edl * rkSpecE.v0 },
          CONF.gravity * (rkGuidedE ? 1.0 : 0.35), rkSpecE.dragK);
        var missE = impE ? Math.sqrt((impE.point.x - tp.x) * (impE.point.x - tp.x) + (impE.point.z - tp.z) * (impE.point.z - tp.z)) : Infinity;
        reachOK = missE <= (rkGuidedE ? 4.0 : 0.75) * (rkSpecE.splashR || 22);
      }
      t._rkMin = (rkSpecE.splashR || 22) * 4.0;
      t._rkMax = reachOK ? Math.min(rkSpecE.range, rkMaxDisp) : 0;   // 0=当前高度弹道不可达(触发爬升获程)
      t._gunMax = combatFloorOf(t, tgt);
      rkMinE = t._rkMin; gunMaxE = t._gunMax;
      rkMaxE = t._rkMax;
    }

    // AI 直升机武器战术状态分流 (导弹耗尽时自动切入火箭 standoff,不进行无效长时雷达空转)
    if (distToTgt >= 350 && distToTgt <= (HELI_MSL_SPEC[heliMslTypeOf(t)] || { range: 6000 }).range && mslAvail) {   // P适配: 模式门收口到导弹包络
      wantWeapon = 3; // 远程雷达导弹攻击 (350m ~ 30,000m)
      // Raise the long-range attack altitude; the current cap is 400 m.
      altWeaponBase = clamp(100.0 + Math.min(distToTgt, 5000) * 0.065 + slotAltOffset, 62.0, 400.0);
    } else if (rkAvail && distToTgt >= rkMinE && distToTgt <= rkMaxE) {
      wantWeapon = 2; // 火箭 standoff 攻击 (包线由上方弹道解算给定)
      // 对地面目标: 占位不得低于敌装甲仰角包线(AI 坦克仰角上限 0.20rad / 89 歼 0.24rad → 安全线=距离×tan0.24+8m,
      // 与 aiCore 火炮伺服 pitchCapAI 同口径); 封顶=可瞄准几何(俯角 ≤ maxPitch×0.85)且 ≤400m(与导弹模式同顶)
      altWeaponBase = (!isHeliVehicle(tgt))
        ? clamp(Math.max(48.0 + (slot % 3) * 12.0, distToTgt * 0.245 + 8.0), 48.0, Math.min(Math.max(64.0, distToTgt * Math.tan(prm.maxPitch * 0.85)), 400.0))
        : 48.0 + (slot % 3) * 12.0;
    } else {
      wantWeapon = 1; // 机炮扫射 / 接敌机动 (火箭可用时驻火箭 standoff 等待包线开启, 见 dOpt)
      // 颚下机炮俯角权限 80° 无瞄准约束, 对地面目标同样抬出仰角包线(同式安全线, 封顶 400m)
      altWeaponBase = (!isHeliVehicle(tgt))
        ? clamp(Math.max(42.0 + (slot % 3) * 10.0, distToTgt * 0.245 + 8.0), 42.0, Math.min(Math.max(64.0, distToTgt * Math.tan(prm.maxPitch * 0.85)), 400.0))
        : 42.0 + (slot % 3) * 10.0;
    }
  } else {
    // 巡逻/静默: 保持一个适中巡航高度, 不再长时间贴地巡航被先手
    altWeaponBase = 110.0 + slotAltOffset;
  }

  // P2-1: 模式切换事件触发:切出导弹模式时清空锁定能量与目标,防止换弹后秒锁
  if ((t._heliWeapon || 3) === 3 && wantWeapon !== 3) {
    t._aiLockEnergy = 0;
    t._aiIsLocked = false;
    t._heliMissileTarget = null;
    t._aiLockTgt = null;
  }
  t._heliWeapon = wantWeapon;

  // 4. 最优攻击带与速度预算 (由威胁包线/武器弹道包线/命中率模型计算,非固定档位)
  var dOpt, dMin;
  // 火箭 standoff 驻位(两分支共用): 敌交火底线外 60% 余量(其主炮物理打不到,与导弹模式同哲学)
  // Clamp to the current rocket envelope; use its middle band for air targets.
  var rkStandoff = (tgt && !isHeliVehicle(tgt))
    ? clamp(combatFloorOf(tgt, t) * 1.6, Math.max(rkMinE * 1.5, gunMaxE * 1.1), Math.max(rkMinE * 2.0, rkMaxE * 0.85))
    : clamp(rkMaxE * 0.5, rkMinE * 1.5, Math.max(rkMinE * 2.0, rkMaxE * 0.85));
  if (wantWeapon === 3) {
    dMin = 350.0;              // 导弹最小有效射程(锁定包线下限)
    // 对直升机目标: calcHeliMissileHitRate 峰值带 [400,1200] 的上段 75% 处;
    // 对地面目标: 敌方交火底线外 55% 安全余量(敌方打不到、命中率高位的计算式站位)
    dOpt = (tgt && isHeliVehicle(tgt)) ? (400.0 + (1200.0 - 400.0) * 0.75)
                                       : Math.max(420.0, Math.min(1500.0, combatFloorOf(tgt, t) * 1.6));
  } else if (wantWeapon === 2) {
    dMin = rkMinE;             // 火箭包线下限 = 4×溅射半径(弹道解算)
    dOpt = rkStandoff;
  } else {
    dMin = gunMaxE * 0.3;      // 机炮包线下限随散布解算
    // 机炮使用权重(参考业界: 机炮是反软目标/自卫武器, 反坦克是导弹/火箭的活):
    //   对软目标(直升机/火箭炮)常规使用; 对坦克/歼击车(硬目标)仅在
    //   ①火箭最小安全距离内自卫(火箭近炸打不了) ②每目标一次 15% 概率扫射决策
    //   ③弹药架损毁(导弹/火箭永久失效, 机炮成唯一武器) 时使用——
    //   其余情况驻 standoff 等 20s 火箭装填, 不低空突进拼刺刀(坦克仰角锥内悬停=送死)
    var gunSoftTgt = !!(tgt && tgt.alive) && (isHeliVehicle(tgt) || tgt.kind === 'arty');
    if (tgt && t._gunStrafeTgt !== tgt) {
      t._gunStrafeTgt = tgt;
      t._gunStrafeOK = Math.random() < 0.15;   // 每目标一次扫射决策(15% 概率)
    }
    var gunOnlyLeft = !!(t.mods.ammo && t.mods.ammo.hp <= 0);
    var gunAllowed = gunSoftTgt || gunOnlyLeft || distToTgt <= rkMinE * 1.2 || !!t._gunStrafeOK;
    // 火箭可用→驻火箭 standoff 等待包线开启(爬升获程/接近入包线);
    // 火箭耗尽但机炮受限→继续驻 standoff 等装填; 仅机炮放行时才压到机炮包线 75% 处
    dOpt = rkAvail ? rkStandoff : (gunAllowed ? gunMaxE * 0.75 : rkStandoff);
  }
  dOpt /= clamp(env, 0.5, 1.0);                       // 治理器连续降级: 余量不足时放大攻击带(远离威胁)
  var aDecAvail = 9.8 * Math.tan(prm.maxPitch * env); // 包线内可用水平减速度(随 env 收紧)
  var vMaxNow = Math.min(prm.maxSpeedH, Math.sqrt(2.0 * aDecAvail * Math.max(0.0, distToTgt - dMin)));

  // 4.5 被敌地面火力瞄准感知 (4Hz 节流): 敌车已选我为目标且我在其交火域内(=其火控正在解算我)
  //     → 规避层 beam weave 破坏其提前量装定/瞄准门收敛, 高度层同步爬出其仰角锥。
  //     (业界对应: RWR/激光告警后的威胁反应机动; 本游戏无 RWR 装备建模, 以"敌 targetO===我"为被瞄准判据)
  if (t._aimScanT == null || gameT - t._aimScanT > 0.25) {
    t._aimScanT = gameT;
    var foeRoster = hostileRosterOf(t);
    var abBest = null, abD2 = Infinity;
    for (var abi = 0; abi < foeRoster.length; abi++) {
      var fo = foeRoster[abi];
      if (!fo || !fo.alive || isHeliVehicle(fo) || !fo.ai || fo.ai.targetO !== t) continue;
      var fdx = p.x - fo.group.position.x, fdz = p.z - fo.group.position.z;
      var fd2 = fdx * fdx + fdz * fdz;
      if (fd2 < abD2) { abD2 = fd2; abBest = fo; }
    }
    if (abBest) {
      var abFloor = combatFloorOf(abBest, t) * 1.05;   // 其对我的交火底线(散布×正面面积解算, 与开火 range 门同口径)
      if (abD2 < abFloor * abFloor) {
        t._aimedBy = abBest;
        t._aimedByX = abBest.group.position.x; t._aimedByZ = abBest.group.position.z;
        t._aimedByT = gameT;
      }
    }
  }
  t._distToTgt = distToTgt;

  // 5. 来袭导弹规避 (10Hz 节流,运动学解算;输出经制导层平滑注入,不做模式硬切换)
  heliThreatEvade(t, prm, vMaxNow);

  // 6. 武器火控状态机: 锁定能量/发射判定/机炮伺服(与飞行操纵解耦,只输出机头指向需求)
  var noseYawDes = curYaw;
  if (tgt && tgt.alive) {
    if (!t._laserSuppressed && wantWeapon === 3) {
      // P2-1: 目标变更事件触发:更换索敌目标时重新开始锁定积分
      if (t._aiLockTgt !== tgt) {
        t._aiLockTgt = tgt;
        t._aiLockEnergy = 0;
        t._aiIsLocked = false;
      }

      // 导弹战术: 扇面多角度包夹展开 (展开 ±28° 夹角交叉照射),机头对准目标进行动态雷达相干锁定与智能能量决策发射
      noseYawDes = normAng(yawToTgt + slotYawOffset * clamp(distToTgt / 1200.0, 0.2, 1.0));

      // AI 雷达系统:使用与玩家完全相同的 60° 视场与地杂波积分 (10Hz 节流地貌采样,航电与雷达通电就绪联锁)
      if (!isHeliRadarReady(t)) {
        t._aiLockEnergy = 0;
        t._aiIsLocked = false;
        t._heliMissileTarget = null;
      } else if (Math.abs(yawDiff) < 30 * Math.PI / 180 && distToTgt <= 10000) {
        if (t._aiLockSampleT == null || gameT - t._aiLockSampleT > 0.10) {
          t._aiLockSampleT = gameT;
          var dTerr = calcTerrain3DProximity(tp.x, tp.y, tp.z);
          t._aiLockReqT = calcRadarLockTime(distToTgt, dTerr);
        }
        var tReq = t._aiLockReqT || 1.0;
        t._aiLockEnergy = Math.min(1.0, (t._aiLockEnergy || 0) + (dt / Math.max(0.05, tReq)));
      } else {
        t._aiLockEnergy = Math.max(0.0, (t._aiLockEnergy || 0) - (dt / 1.5));
      }

      if ((t._aiLockEnergy || 0) >= 1.0) {
        if (!t._aiIsLocked) {
          t._aiIsLocked = true;
          t._aiMissileDecisionT = rand(0.8, 1.4); // 锁定达成时,保证 0.8s~1.4s 锁定跟踪窗口,让"敌锁定"语音充分播报并给玩家预警反应时间
        }
        t._heliMissileTarget = tgt;

        // 锁定维持中,每隔一段时间对单个直升机AI进行一次低频发射判定
        t._aiMissileDecisionT -= dt;

        if (t._aiMissileDecisionT <= 0) {
          t._aiMissileDecisionT = rand(0.6, 0.9);

          // 计算命中率 (0-95%); 15: 超出弹型最大射程(空空导弹 6km/防空导弹 8km)绝不发射
          var hitRate = (distToTgt <= HELI_MSL_SPEC[heliMslTypeOf(t)].range) ? calcHeliMissileHitRate(t, tgt, distToTgt) : -1;
          // 生成 0-99 的随机数
          var roll = Math.floor(Math.random() * 100);

          // 随机数 < 命中率 -> 发射!否则保留锁定并等待更优发射窗口
          if (roll < hitRate) {
            triggerHeliFire(t);
            t._aiLockEnergy = 0;
            t._aiIsLocked = false;
            t._aiMissileDecisionT = 1.0;
          }
        }
      } else {
        t._aiIsLocked = false;
      }
    } else if (!t._laserSuppressed && wantWeapon === 2) {
      // 火箭弹战术: 固定式火箭巢 → 机身长轴即炮口, 需偏航对向 + 俯冲压低同时满足
      noseYawDes = normAng(yawToTgt + (slotYawOffset * 0.5));

      // 视线俯角反解期望俯仰 (_heliPitch 正=抬头, 故直接取 asin(dy/dist));
      // 火箭动能段马赫 2 级速度掠过包线距离仅秒级、重力下坠米级, 直瞄视线即可命中(制导型另有 PN 修正)
      var rkFrom = heliRocketPodOrigin(t, 0);
      var rkTgtP = tgt.group.position;
      var rkTx = rkTgtP.x - rkFrom.x, rkTy = (rkTgtP.y + 0.5) - rkFrom.y, rkTz = rkTgtP.z - rkFrom.z;
      var rkD3 = Math.max(1.0, Math.sqrt(rkTx * rkTx + rkTy * rkTy + rkTz * rkTz));
      t._aiRktPitchDes = clamp(Math.asin(clamp(rkTy / rkD3, -1, 1)), -prm.maxPitch, prm.maxPitch);
      t._aiRktAimT = gameT;

      // 发射门: 偏航 <40° 且机身长轴与目标视线夹角进入溅射半径张角
      // (张角=atan(splashR/dist) 自标定: 420m→3.0°, 200m→6.3°;
      //  俯仰指令受 maxPitch 钳制, 故不能以指令误差为准 —— 必须校验长轴真实指向, 几何不成立时自动不开火)
      var rkAxis = heliBodyAxisDir(t, _v1);
      var rkAimDot = (rkAxis.x * rkTx + rkAxis.y * rkTy + rkAxis.z * rkTz) / rkD3;
      var rkTol = clamp(Math.atan2((HELI_RKT_SPEC[t.kind] || HELI_RKT_SPEC.ah64).splashR || 22, rkD3), 1.5 * Math.PI / 180, 8 * Math.PI / 180);
      // 射界门(与坦克火控同管线 losClearCached): 地形/残骸挡弹道禁射 —— 低空隔坡乱射=火箭提前撞地
      t._rkLosBlocked = !losClearCached(t, tgt, distToTgt);
      if (Math.abs(yawDiff) < 40 * Math.PI / 180 && Math.acos(clamp(rkAimDot, -1, 1)) < rkTol &&
          distToTgt >= rkMinE && distToTgt <= rkMaxE && !t._rkLosBlocked && t._heliRocketCooldown <= 0) {
        var rkSpec = HELI_RKT_SPEC[t.kind] || HELI_RKT_SPEC.ah64;
        var rkFireOK = true;
        if (rkSpec.guidance === 'datalink') {
          // 制导分配一致性: 离架弹将转火"分配目标"——若分配目标在长轴张角之外,
          // 弹会朝离轴方向急转(680m/s 最小转弯半径≈4.7km)越过目标直接扎地 → 禁射等收敛
          var allocT = (typeof allocateGuidedFireTarget === 'function') ? allocateGuidedFireTarget(t, rkSpec) : tgt;
          if (allocT && allocT !== tgt && allocT.group) {
            var acp = allocT.group.position;
            var acx = acp.x - rkFrom.x, acy = (acp.y + 0.5) - rkFrom.y, acz = acp.z - rkFrom.z;
            var acd = Math.max(1.0, Math.sqrt(acx * acx + acy * acy + acz * acz));
            if (Math.acos(clamp((rkAxis.x * acx + rkAxis.y * acy + rkAxis.z * acz) / acd, -1, 1)) > rkTol) rkFireOK = false;
          }
        } else {
          // 无制导火箭 CCIP 门(5Hz 节流仿真): 真实弹道预测落点偏离目标 > 溅射半径 → 禁射
          // (低高度/地形起伏时直瞄张角门不足以保证落点; 与 HUD 落点预测同一 simulateHeliRocketImpact 口径)
          if (t._rkSimT == null || gameT - t._rkSimT > 0.2) {
            t._rkSimT = gameT;
            var imp = simulateHeliRocketImpact(rkFrom,
              { x: vx + rkAxis.x * rkSpec.v0, y: vy + rkAxis.y * rkSpec.v0, z: vz + rkAxis.z * rkSpec.v0 },
              CONF.gravity * 0.35, rkSpec.dragK);   // 70mm火箭弹 0.35g, 与 HUD rkGHud 同口径
            t._rkSimOK = !!(imp && Math.sqrt((imp.point.x - rkTgtP.x) * (imp.point.x - rkTgtP.x) +
              (imp.point.z - rkTgtP.z) * (imp.point.z - rkTgtP.z)) <= (rkSpec.splashR || 22));
          }
          rkFireOK = !!t._rkSimOK;
        }
        if (rkFireOK) triggerHeliFire(t);
      }
    } else {
      // 机炮战术: 机头指向目标,环绕盘旋由速度矢量制导完成(顺/逆时针由 slot 奇偶的 orbitSign 实现)
      noseYawDes = yawToTgt;
    }

    // 4. 颚下机炮独立多轴伺服瞄准 (机身飞行与机炮瞄准解耦,下压80°连续精准追瞄)
    if (t._laserSuppressed) {
      /* Beam suppression freezes the existing turret/gun state and fire decision;
         the flight guidance below continues to provide movement and evasion. */
    } else {
    var dyAim = (tp.y + 0.8) - (p.y + 1.2);
    var aimDist = Math.sqrt(distToTgt * distToTgt + dyAim * dyAim);
    var aimPitch = Math.asin(clamp(dyAim / (aimDist || 1), -1, 1));
    var desiredTurretYaw = clamp(yawDiff, -90 * Math.PI / 180, 90 * Math.PI / 180);   // 机炮射界=前方180°
    var desiredGunPitch = clamp(aimPitch, -80 * Math.PI / 180, 0.0);

    t.turretYaw = approachSpeed(t.turretYaw || 0, desiredTurretYaw, 1.5, 1.5, dt);
    t.gunPitch = approachSpeed(t.gunPitch || 0, desiredGunPitch, 1.5, 1.5, dt);

    if (wantWeapon === 1 && gunAllowed && Math.abs(yawDiff) < Math.PI / 2 && Math.abs(normAng(desiredTurretYaw - t.turretYaw)) < 0.15 && distToTgt <= gunMaxE * 0.95 && t.reload <= 0) {
      tryFire(t);   // 目标须在机炮前方180°射界内; 开火距离=本机散布解算包线(combatFloorOf 同源); 机炮权重见 dOpt 段(软目标/自卫/15% 扫射决策)
    }
    }
  } else if (!t._laserSuppressed) {
    // 巡逻: 发射架回中,机头跟随巡航航向(航向解算见下方战术需求层)
    t.turretYaw = approachSpeed(t.turretYaw || 0, 0, 1.0, 1.0, dt);
    t.gunPitch = approachSpeed(t.gunPitch || 0, 0, 1.0, 1.0, dt);
  }

  // 5. 三维 Boids 空域防撞与机间排斥力场 (15Hz 节流采样计算,平滑注入物理动力学)
  if (t._sepTick == null || gameT - t._sepTick > 0.066) {
    t._sepTick = gameT;
    var ownHeliRoster = isFfaMode() ? aliveList : friendlyRosterOf(t);
    var sepX = 0, sepZ = 0, sepY = 0;
    for (var fhi = 0; fhi < ownHeliRoster.length; fhi++) {
      var fh = ownHeliRoster[fhi];
      if (fh === t || !fh.alive || !isHeliVehicle(fh)) continue;
      var fhp = fh.group.position;
      var fdx = p.x - fhp.x, fdy = p.y - fhp.y, fdz = p.z - fhp.z;
      var fdist2 = fdx * fdx + fdy * fdy + fdz * fdz;
      if (fdist2 < 7225 && fdist2 > 0.01) { // 85m 排斥距离
        var fdist = Math.sqrt(fdist2);
        var repForce = (85.0 - fdist) / 85.0; // 0..1
        sepX += (fdx / fdist) * repForce;
        sepZ += (fdz / fdist) * repForce;
        sepY += (fdy / fdist) * repForce;
      }
    }
    t._sepX = sepX; t._sepZ = sepZ; t._sepY = sepY;
  }

  // 7. 战术需求层: 期望速度矢量/高度 (全部计算值——速度由攻击带几何+制动曲线解算,高度由地形前瞻+威胁+武器基线合成)
  var vDesX, vDesZ;
  if (tgt && tgt.alive) {
    // 径向速度 = 距离误差连续律(无悬停呆立段): 接近方向受制动曲线限制(到带前平滑减速),
    // 后撤方向放开全速(目标逼近时全速脱离);切向吃满剩余速度预算 → 驻位环形盘旋
    var dErr = distToTgt - dOpt;
    var vRad = clamp(dErr / HELI_TAU_RAD, -prm.maxSpeedH, vMaxNow);
    var ux = dx / (distToTgt || 1), uz = dz / (distToTgt || 1);
    var vTanMag = Math.sqrt(Math.max(0, vMaxNow * vMaxNow - vRad * vRad));
    var orbitSign = (slot % 2 === 0) ? 1 : -1;
    vDesX = ux * vRad + (-uz) * vTanMag * orbitSign;
    vDesZ = uz * vRad + ( ux) * vTanMag * orbitSign;
  } else {
    // 巡逻: 朝战场中心 + 缓变蜿蜒(沿用原巡航摇摆节律);边界越近向心权重越大(由越界深度计算),
    // 巡逻速度由边界制动曲线限制(接近边界自动减速,消除贴墙滑行)
    var bLim = CONF.bounds - 5;
    var distEdge = bLim - Math.max(Math.abs(p.x), Math.abs(p.z));
    var vPat = Math.min(prm.maxSpeedH * 0.55, Math.sqrt(2.0 * aDecAvail * Math.max(0.0, distEdge)));
    var toCL = Math.sqrt(p.x * p.x + p.z * p.z) || 1;
    var wCenter = clamp(1.0 - distEdge / (bLim * 0.4), 0.0, 1.0);
    var wvX = Math.cos(gameT * 0.25 + slot), wvZ = Math.sin(gameT * 0.25 + slot);
    var dirX = (-p.x / toCL) * wCenter + wvX * (1.0 - wCenter);
    var dirZ = (-p.z / toCL) * wCenter + wvZ * (1.0 - wCenter);
    var dirL = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
    vDesX = dirX / dirL * vPat;
    vDesZ = dirZ / dirL * vPat;
  }
  /* Helicopters keep their normal combat target, but temporarily bend the flight
     vector toward a nearby pickup and descend to pickup altitude. Zone return wins. */
  var puHeli = (!A._ffaZoneUrgent && A._powerupTarget && !A._powerupTarget._removed && A._powerupTarget.expiresAt > gameT) ? A._powerupTarget : null;
  if (puHeli) {
    var pux = puHeli.x - p.x, puz = puHeli.z - p.z, pud = Math.sqrt(pux * pux + puz * puz);
    if (pud > 7 && pud <= 215) {
      var puSpeed = Math.min(prm.maxSpeedH, Math.max(10, pud * 1.6));
      vDesX = pux / Math.max(1, pud) * puSpeed;
      vDesZ = puz / Math.max(1, pud) * puSpeed;
      noseYawDes = Math.atan2(pux, puz);
      t._powerupAltGoal = _powerupTerrainHForAI(puHeli.x, puHeli.z) + 5.0;
    } else if (pud <= 7) {
      t._powerupAltGoal = _powerupTerrainHForAI(puHeli.x, puHeli.z) + 5.0;
    }
  } else t._powerupAltGoal = null;
  if (A._ffaZoneUrgent) {
    var zdx = A._ffaZoneX - p.x, zdz = A._ffaZoneZ - p.z;
    var zd = Math.sqrt(zdx * zdx + zdz * zdz) || 1;
    var zSp = Math.min(prm.maxSpeedH, Math.max(12.0, vMaxNow));
    vDesX = zdx / zd * zSp; vDesZ = zdz / zd * zSp;
    noseYawDes = Math.atan2(zdx, zdz);
  }

  // 边界处理(通用): 外圈 25% 带内将需求速度的"指向边界"分量按越界深度衰减(保留切向分量)——
  // 既不贴墙满杆硬推,也不与环绕/接敌速度对消造成停滞;向内运动不受阻
  var bLimG = CONF.bounds - 5;
  var edgeWX = (bLimG * 0.9 - Math.abs(p.x)) / (bLimG * 0.15);
  var edgeWZ = (bLimG * 0.9 - Math.abs(p.z)) / (bLimG * 0.15);
  if (edgeWX < 1.0 && vDesX * (p.x > 0 ? 1 : -1) > 0) vDesX *= 1.0 - clamp(edgeWX, 0, 1);
  if (edgeWZ < 1.0 && vDesZ * (p.z > 0 ? 1 : -1) > 0) vDesZ *= 1.0 - clamp(edgeWZ, 0, 1);

  // Boids 排斥 → 需求层速度偏置(量纲=排斥距离/分离时间;经制导反解平滑,不再直通操纵量,消除姿态环跳变激励)
  var curSepX = t._sepX || 0, curSepZ = t._sepZ || 0, curSepY = t._sepY || 0;
  vDesX += curSepX * (85.0 / 1.5);
  vDesZ += curSepZ * (85.0 / 1.5);

  // 来袭导弹规避需求叠加(终末段 beam 机动/预防段周期变向)
  vDesX += (t._evadeVX || 0);
  vDesZ += (t._evadeVZ || 0);

  // 高度需求合成: 地形前瞻底线(10Hz 节流) ⊕ 武器模式基线 ⊕ 威胁贴地隐蔽/规避垂直位移 ⊕ 垂直分离
  if (t._ffT == null || gameT - t._ffT > 0.10) {
    t._ffT = gameT;
    var laL = Math.sqrt(vDesX * vDesX + vDesZ * vDesZ);
    var laX, laZ;
    if (laL > 0.1) { laX = vDesX / laL; laZ = vDesZ / laL; } else { laX = Math.sin(curYaw); laZ = Math.cos(curYaw); }
    var L = Math.max(60.0, vHoriz * 2.5);   // 前瞻距离 = 2.5s 行程(由当前速度计算)
    var c30 = Math.cos(Math.PI / 6), s30 = Math.sin(Math.PI / 6);
    var hA = terrainH(p.x + laX * L, p.z + laZ * L);
    var hB = terrainH(p.x + (laX * c30 - laZ * s30) * L, p.z + (laX * s30 + laZ * c30) * L);
    var hC = terrainH(p.x + (laX * c30 + laZ * s30) * L, p.z + (-laX * s30 + laZ * c30) * L);
    t._ffTerrH = Math.max(hA, Math.max(hB, hC));
  }
  var threatActive = (t._evadeTti != null && t._evadeTti < 99);
  // 净空基线: 被瞄准/弹在途走贴地隐蔽带(alt<12m 命中率减益模型),常规随速度放大(转弯半径需求)
  var clearanceBase = threatActive ? 10.0 : 28.0 + vHoriz * 0.45;
  var ffTerrH = t._ffTerrH != null ? t._ffTerrH : curGroundH;
  var altDes;
  if (t._evadeTerm) {
    altDes = ffTerrH + clearanceBase + (t._evadeAlt || 0);   // 终末规避: 地形底线 + 破近炸垂直位移
  } else if (threatActive && distToTgt < 1200) {
    altDes = ffTerrH + clearanceBase;                        // 近距威胁: 贴地隐蔽优先(命中率减益)
  } else {
    altDes = Math.max(ffTerrH + clearanceBase, altWeaponBase); // 常规/远距威胁: 抢占高度
  }
  // 被地面火力瞄准且仍在其仰角锥内 → 爬出锥外(与武器基线安全线同式: 0.245=tan(0.24rad) 敌仰角上限);
  // 弹在途时让位贴地隐蔽带(近炸破片规避优先于防炮瞄)
  if (!threatActive && t._aimedByT != null && gameT - t._aimedByT < 1.2) {
    var abDx = p.x - t._aimedByX, abDz = p.z - t._aimedByZ;
    var abDist = Math.sqrt(abDx * abDx + abDz * abDz);
    altDes = Math.max(altDes, Math.min(curGroundH + abDist * 0.245 + 8.0, curGroundH + 200.0));
  }
  // 火箭射界被地形遮挡 或 当前高度弹道不可达(rkMax=0) → 渐进爬升开窗/获程
  // (pop-up attack / climb-to-envelope: 8m/s 压升上限 +60m, 包线开启后 20m/s 释放, 高度包线随爬升自行重算)
  if ((wantWeapon === 2 || (rkAvail && t._rkMax === 0 && !isHeliVehicle(tgt))) && tgt && tgt.alive) {
    t._rkClimbBias = clamp((t._rkClimbBias || 0) + ((t._rkLosBlocked || t._rkMax === 0) ? 8.0 : -20.0) * dt, 0, 60.0);
    altDes += t._rkClimbBias;
  } else t._rkClimbBias = 0;
  altDes += curSepY * (85.0 / 3.0);                          // 垂直分离偏置(时间常数放宽一档)
  altDes = Math.max(altDes, curGroundH + 5.0);               // 绝对地板
  if (!A._ffaZoneUrgent && t._powerupAltGoal != null) altDes = Math.max(curGroundH + 4.5, t._powerupAltGoal);

  // 8. 制导反解 + 治理器紧急改出 + SAS 姿态伺服
  if (env < 0.3) {
    // 机动余量枯竭: 全力后拉减速爬升(仍经 SAS 平滑输出,无指令跳变)
    var fx = Math.sin(curYaw), fz = Math.cos(curYaw);
    vDesX = -fx * vMaxNow;
    vDesZ = -fz * vMaxNow;
  }
  var guide = heliGuidanceSolve(t, prm, vDesX, vDesZ, altDes, env);
  var pitchCmd = guide.pitchCmd, rollCmd = guide.rollCmd, collCmd = guide.collCmd;
  // 虚拟飞行员高度误差积分补偿 (限幅±0.20)
  var altErr = altDes - ((t._ffTerrH != null ? t._ffTerrH : 0) + (t._heliAlt || 0));
  t._aiCollTrim = clamp((t._aiCollTrim || 0) + altErr * 0.06 * dt, -0.20, 0.20);
  // 总距物理上限: 当前旋翼转速能支撑的 cap=转速 (升速期 AI 安静等待, 不自我拖垮转速)
  var capAI = heliCollCap(clamp(heliRotorFrac(t, prm), 0, 1));
  collCmd = clamp(collCmd + t._aiCollTrim, 0.10, Math.min(prm.collMax, capAI));
  // 火箭攻击航段: 固定式火箭巢无独立俯仰权限, 由机身俯仰承担瞄准 (0.25s 内的新鲜指令才生效;
  // 换武器/换目标后自动失效, 俯仰交回常规速度制导)。仍经下方 SAS 伺服平滑输出, 不直写姿态。
  if (t._aiRktPitchDes != null && t._aiRktAimT != null && gameT - t._aiRktAimT < 0.25) {
    pitchCmd = t._aiRktPitchDes;
  }
  if (env < 0.3) {
    pitchCmd = prm.maxPitch;   // 全力抬头
    rollCmd = 0;               // 改平
    collCmd = Math.min(prm.collMax, capAI);     // 桨距拉满 (仍受当前转速上限物理约束)
  }

  // 机头指向 → 期望偏航角速度(偏航率上限 = 尾桨权限的 85%,与俯仰/横滚通道同口径)
  var omegaYawMax = 0.85 * prm.turnRate;
  var yawRateCmd = clamp(HELI_SAS_KA * normAng(noseYawDes - curYaw), -omegaYawMax, omegaYawMax);

  var sas = heliAttitudeSAS(t, prm, pitchCmd, rollCmd, yawRateCmd);

  // 9. 驱动直升机真实物理积分(总距 1:1 直通,updateHeli AI 分支仅从总距反解油门)
  t._heliCollective = collCmd;
  updateHeli(t, dt, sas.fwdIn, sas.latIn, sas.turnIn, true);
}

/* FFA safe-zone return policy: revision-driven with a low-frequency fallback check. */
function ffaZoneAIPlan(t, dt) {
  var A = t && t.ai;
  if (!A || !isFfaMode() || typeof ffaSafeZoneSnapshot !== 'function') {
    if (A) A._ffaZoneUrgent = false;
    return false;
  }
  var rev = typeof ffaSafeZoneRevision === 'function' ? ffaSafeZoneRevision() : -1;
  A._ffaZoneCheckT = (A._ffaZoneCheckT == null ? 0 : A._ffaZoneCheckT - dt);
  if (A._ffaZoneCheckT > 0 && A._ffaZoneRevision === rev) return !!A._ffaZoneUrgent;
  A._ffaZoneCheckT = 0.35;
  var info = A._ffaZoneInfo || (A._ffaZoneInfo = {});
  ffaSafeZoneSnapshot(info);
  A._ffaZoneRevision = info.revision;
  if (!info.active || !t.group || !t.group.position) {
    A._ffaZoneUrgent = false;
    return false;
  }
  var p = t.group.position, margin = Math.max(12, (t.radius || 2) + 10);
  var dx = p.x - info.cx, dz = p.z - info.cz;
  var currentR = Math.max(1, info.r - margin);
  var outside = dx * dx + dz * dz > currentR * currentR;
  var tdx = p.x - info.targetCx, tdz = p.z - info.targetCz;
  var targetR = Math.max(1, info.targetR - margin);
  var futureOutside = (info.warning || info.contracting) && (tdx * tdx + tdz * tdz > targetR * targetR);
  if (!outside && !futureOutside) {
    if (A._ffaZoneUrgent) A.destT = 0;
    A._ffaZoneUrgent = false;
    return false;
  }
  var gcx = futureOutside ? info.targetCx : info.cx;
  var gcz = futureOutside ? info.targetCz : info.cz;
  var gr = futureOutside ? targetR : currentR;
  var gdX = p.x - gcx, gdZ = p.z - gcz, gd = Math.sqrt(gdX * gdX + gdZ * gdZ);
  var goalR = Math.max(16, gr - rand(18, 42));
  if (gd < 0.001) { var ga = rand(0, Math.PI * 2); gdX = Math.sin(ga); gdZ = Math.cos(ga); gd = 1; }
  A._ffaZoneX = clamp(gcx + gdX / gd * goalR, -CONF.bounds + 8, CONF.bounds - 8);
  A._ffaZoneZ = clamp(gcz + gdZ / gd * goalR, -CONF.bounds + 8, CONF.bounds - 8);
  A._ffaZoneUrgent = true;
  A.destX = A._ffaZoneX; A.destZ = A._ffaZoneZ; A.destT = 999;
  A.mode = 'zone-return';
  return true;
}
function ffaZoneDriveGround(t, dt) {
  var A = t.ai;
  if (!A || !A._ffaZoneUrgent) return false;
  var p = t.group.position, dx = A._ffaZoneX - p.x, dz = A._ffaZoneZ - p.z;
  var dist = Math.sqrt(dx * dx + dz * dz), sx = dx, sz = dz;
  if (dist >= 8 && typeof navSteer === 'function') {
    var nw = navSteer(t, A._ffaZoneX, A._ffaZoneZ, p);
    if (nw) { sx = nw.x - p.x; sz = nw.z - p.z; }
  }
  var zoneLen = Math.sqrt(sx * sx + sz * sz);
  /* Do not replace the safe-zone route with a rocket escape point. During an airstrike
     evade, keep the zone vector as the main component and add a lateral jink whose side
     is selected from the existing evade point. This prevents the two orders deadlocking. */
  var evadingRocket = A.evadeT > 0;
  if (evadingRocket) {
    var ex = A.evadeX - p.x, ez = A.evadeZ - p.z, evadeLen = Math.sqrt(ex * ex + ez * ez);
    if (zoneLen > 0.001 && evadeLen > 0.001) {
      var znx = sx / zoneLen, znz = sz / zoneLen;
      var side = znx * (ez / evadeLen) - znz * (ex / evadeLen);
      if (Math.abs(side) < 0.08) side = (Math.floor(gameT * 2.0) + (t._heliSlot || 0)) % 2 ? 1 : -1;
      else side = side > 0 ? 1 : -1;
      var latX = -znz * side, latZ = znx * side;
      sx = znx * 0.82 + latX * 0.70;
      sz = znz * 0.82 + latZ * 0.70;
    } else if (evadeLen > 0.001) { sx = ex; sz = ez; }
  }
  var drv = steerCached(t, sx, sz), wantYaw = Math.atan2(drv.x, drv.z);
  var turn = turnMult(t) * slopeTurnMul(t), dYaw = normAng(wantYaw - t.yaw);
  var yawStep = clamp(dYaw, -t.turn0 * turn * dt, t.turn0 * turn * dt);
  groundYawInertia(t, dt > 0 ? yawStep / dt : 0, t.turn0 * turn, dt);
  var mis = Math.abs(normAng(wantYaw - t.yaw));
  var throttle = (dist < 8 && !evadingRocket) ? 0 : (mis < 1.45 ? clamp(1 - mis / 1.7, evadingRocket ? 0.55 : 0.35, 1) : (mis > 1.75 ? (evadingRocket ? -0.65 : -0.45) : (evadingRocket ? 0.38 : 0.22)));
  t._throttle = throttle; t._throttleLock = 0;
  if (typeof SIM_K === 'undefined' || SIM_K <= 0) t.speed = approachSpeed(t.speed, throttle * t.speed0 * speedMult(t), t.accel0 * engineEff(t), t.decel0 * Math.max(engineEff(t), 0.3), dt);
  applyMotion(t, dt);
  return true;
}
function aiUpdate(t, dt) {
  if (gameState === 'playing' && gameT - startT < AI_START_DELAY) return;
  if (isFfaMode() && t._cmdG) { cmdLeave(t); }
  if (typeof navPump === 'function') navPump(gameT);   // P2 寻路令牌桶(全局队列,各车分摊;无请求时立即返回)
  var A = t.ai;
  var ffaZoneUrgent = ffaZoneAIPlan(t, dt);
  if (ffaZoneUrgent) A._powerupDrive = false;          // stale pickup intent cannot survive a zone-return order
  /* Pickup routing is subordinate to the FFA return vector, so it cannot deadlock
     the zone/airstrike safety order. The selector is throttled to 0.35s and capped
     at the nearest 200 m item by powerups.js. */
  if (typeof powerupAIPlan === 'function') powerupAIPlan(t, dt);
  A.thinkT -= dt;
  if (isHeliVehicle(t)) { aiHeliUpdate(t, dt); return; }   // 直升机使用独立三维空战物理逻辑。
  if (ffaZoneUrgent && ffaZoneDriveGround(t, dt)) return;
  /* A powerup route is subordinate movement intent, never a replacement for the
     combat update.  powerupAIDrive only writes A.destX/Z; target selection, evade,
     turret servo, and the reload/fire gate continue below in this same frame. */
  var powerupDriving = !ffaZoneUrgent && typeof powerupAIDrive === 'function' && powerupAIDrive(t, dt);
  if (t.kind === 'arty') { artyUpdate(t, dt); return; }   // 火箭炮使用独立火控逻辑。
  if (t.kind === 'aa') {                                  // 防空载具双模式(任务22):HUNT=独立防空猎杀;GROUND 红=通用地面算法/蓝=护航伴随
    aaIntelUpdate(t.team);
    if (aaIntel[t.team].mode === 'hunt' || t.team === 'blue') { aaUpdate(t, dt); return; }
    updateHeliWeapons(t, dt);                             // 红方 GROUND:导弹装填钟+雷达航迹表(情报源)不能停
    aaRadarSweep(t, dt, false);                           // 未交战时炮塔慢扫,保持直升机发现机会(雷达锥轴=炮塔向)
    // → 落入下方通用地面算法(推进/掩体/开火纪律全继承;开火闸带 aaSoftGateOK 只打软目标)
  }
  var didThink = false;
  /* A pickup route must never postpone a ready weapon's target scan. If this AI
     has no live combat target when the loader completes, request an immediate
     normal threat pass; the ordinary aim/LOS/fire gates still decide whether a
     shot is safe and possible. */
  if (powerupDriving && t.reload <= 0 && (!A.targetO || !A.targetO.alive)) A.thinkT = 0;
  var _tThk = (window._dbgPerfOn && window.__PERF) ? performance.now() : 0;   // aiCore 子段探针:think 节拍耗时
  if (A.thinkT <= 0) {
    var urgent = !A.targetO || !A.targetO.alive ||
      (A.alertFoe && gameT - A.alertFoeT < AI_ALERT_T) ||
      (A.bumpFoe && gameT - A.bumpT < AI_ALERT_T) ||
      (t._cmdG && t._cmdG._detached);   // 接管成员:跟随重锚节拍不被调度器饿死(射击状态也要持续拉近,≤4 辆成本可忽略)
    if (aiScheduler.allowTarget(urgent)) {
      pickThreat(t);
      didThink = true;
    }
  }
  if (_tThk) __PERF.aiThink2 += performance.now() - _tThk;
  var tgt = A.targetO;
  var tp = t.group.position;
  // 无有效目标时以 0.6s 节流重取全向导航目标,避免前半球无目标时停车;
  // 该目标仅用于行军,炮塔瞄准仍受下方感知和射线门控。
  if (!tgt || !tgt.alive) {
    A.targetO = null;
    if (A.noOpponentT == null) A.noOpponentT = rand(0, 0.6);   // 全盲期 pickTarget 首值相位错峰(防同帧集中全表扫);目标阵亡→0 保持立即重取
    A.noOpponentT = (A.noOpponentT || 0) - dt;
    if (A.noOpponentT <= 0) { pickTarget(t); A.noOpponentT = 0.6; }
    tgt = A.targetO;
  } else A.noOpponentT = 0;
  if (!tgt) {                                           // 只有全场确实没有活敌(等待重部署/终局)才停车
    var anc0 = (t._cmdG && t._cmdG._detached && sqCmd.active) ? sqCmdAnchor(t) : null;
    if (anc0) {
      /* 指挥模式:无敌情同样按指令机动(与交战路径同源 sqCmdAnchor)——
         带外直追 / 带内行动环漫游(0.6~1.4s 一拍);本路径自带迷你执行器
         (车头朝行进方向+油门随转角,无交战不走暴露纪律),不再落入下方停车段。 */
      var a0d = Math.sqrt((anc0.x - tp.x)*(anc0.x - tp.x)+(anc0.z - tp.z)*(anc0.z - tp.z));
      if (a0d > anc0.chase) sqCmdDest(t, anc0, tp);
      else {
        A.mode = 'guard';
        A.destT -= dt;
        if (A.destT <= 0) {
          var wAng = rand(0, Math.PI * 2), wR = rand(anc0.rN, anc0.rF);
          A.destX = clamp(anc0.x + Math.cos(wAng) * wR, -CONF.bounds + 10, CONF.bounds - 10);
          A.destZ = clamp(anc0.z + Math.sin(wAng) * wR, -CONF.bounds + 10, CONF.bounds - 10);
          A.destT = rand(0.6, 1.4);
        }
      }
      var ddx0 = A.destX - tp.x, ddz0 = A.destZ - tp.z, dd0 = Math.sqrt((ddx0)*(ddx0)+(ddz0)*(ddz0));
      if (dd0 > 8) {
        var sdx0 = ddx0, sdz0 = ddz0;   // P2 寻路航点
        if (typeof navSteer === 'function') { var _nw0 = navSteer(t, A.destX, A.destZ, tp); if (_nw0) { sdx0 = _nw0.x - tp.x; sdz0 = _nw0.z - tp.z; } }
        var drv0 = steerCached(t, sdx0, sdz0);
        var wy0 = Math.atan2(drv0.x, drv0.z);
        var _maxTurn0 = t.turn0 * turnMult(t) * slopeTurnMul(t);
        var diff0 = clamp(normAng(wy0 - t.yaw), -_maxTurn0 * dt, _maxTurn0 * dt);
        diff0 = groundYawInertia(t, dt > 0 ? diff0 / dt : 0, _maxTurn0, dt) * dt;
        t.turretYaw -= diff0;
        var ma0 = Math.abs(normAng(wy0 - t.yaw));
        var th0 = ma0 < 1.45 ? clamp(1 - ma0 / 1.7, 0.25, 1) : (ma0 > 1.75 ? -0.55 : 0.22);
        t._throttle = th0; t._throttleLock = 0;
        if (typeof SIM_K === 'undefined' || SIM_K <= 0) t.speed = approachSpeed(t.speed, th0 * t.speed0 * speedMult(t), t.accel0 * engineEff(t), t.decel0 * Math.max(engineEff(t), 0.3), dt);
      } else { t._throttle = 0; t._throttleLock = 0; t._turnCmd = 0; if (typeof SIM_K === 'undefined' || SIM_K <= 0) t.speed = approachSpeed(t.speed, 0, t.accel0, t.decel0, dt); }   // 环点到达:驻停(下拍再选点)
      applyMotion(t, dt);
      return;
    }
    /* With no visible opponent, an active commander-selected control area is
       the first meaningful destination.  This intentionally outranks an
       optional pickup or ordinary idle route so AI continues to attack and
       occupy zones instead of waiting for combat contact. */
    var czIdle = typeof controlZoneAiTargetForTank === 'function' ? controlZoneAiTargetForTank(t) : null;
    if (czIdle && typeof controlZoneAiMove === 'function' && controlZoneAiMove(t, czIdle, dt)) return;
    /* No live opponent and no valid zone target: preserve the optional pickup
       route, still below safe-zone and incoming-fire evasion gates. */
    if (!ffaZoneUrgent && typeof powerupAIIdleDrive === 'function' && powerupAIIdleDrive(t, dt)) return;
    A.mode = 'noopponent';
    t._throttle = 0; t._throttleLock = 0; t._turnCmd = 0;
    if (typeof SIM_K === 'undefined' || SIM_K <= 0) t.speed = approachSpeed(t.speed, 0, t.accel0, t.decel0, dt);
    applyMotion(t, dt);
    return;
  }

  var gp = tgt.group.position;
  var dx = gp.x - tp.x, dz = gp.z - tp.z;
  var dist = Math.sqrt((dx)*(dx)+(dz)*(dz));
  var evading = A.evadeT > 0;                          // 火箭弹逃生中:目的地=逃生点,全速脱离

  // 装填就绪/有所恢复 → 立刻从掩体再出击(优势方更沉不住气:装到一半就探头)
  var popR = (A.posture || 0) > 0.28 ? 1.4 : 0.6;
  if (A.mode === 'cover' && t.reload <= popR && t.struct > t.structMax * 0.3) A.destT = 0;

  var _tThk2 = (window._dbgPerfOn && window.__PERF) ? performance.now() : 0;   // aiCore 子段探针:think 目的地重算
  if (didThink && A.thinkT <= 0) {
    /* ★P1-⑤(移动端恢复,仅触屏):距玩家 1.5km 之外、未接敌未挨揍的 AI 决策节拍降到 ~1Hz;
       交战域(<500m)与警觉目标维持原频;桌面逐位不变。 */
    var _farGate = false;
    if (typeof GFX_TOUCH !== 'undefined' && GFX_TOUCH && player && player.alive && player.group) {
      var _fgdx = tp.x - player.group.position.x, _fgdz = tp.z - player.group.position.z;
      _farGate = _fgdx * _fgdx + _fgdz * _fgdz > 2250000 &&
                 !(tgt && dist < 500) &&
                 gameT - (t.lastHitT || -99) > 4 &&
                 !(A.alertFoe && gameT - (A.alertFoeT || -99) < AI_ALERT_T);
    }
    A.thinkT = _farGate ? rand(0.95, 1.2) : ((tgt && dist < 500) ? rand(0.3, 0.5) : rand(0.6, 0.9));   // 相关性分频(RTS relevance tiering)
    A.destT -= 0.4;
    A.acc = aiBaseDispersion(t, dist);                // 与 fireShell 同源散布(分平台数值)
    // 反偷懒看门狗:行军段(敌>型号射程)有腿有车却持续 ≈0 速 → 强制重选目的地(豁免拥挤约束一次);
    // 连续卡死(>4s,重选也救不动)→ 侧向猛让 18m 的"楔入解锁",左右交替(正面顶牛/顶障碍的死结只有横移能解)
    var frT2 = combatFloorOf(t, tgt);                      // 行军段=交火底线外(与模式决策同口径)
    var noGo = Math.abs(t.speed) < 0.45 && !t.fire &&
               t.mods.engine.hp > 0 && t.mods.fuel.hp > 0 && t.mods.trackL.hp > 0 && t.mods.trackR.hp > 0;   // 断油豁免看门狗
    if (slopeStuck(t)) A.idleW = Math.max(A.idleW, 2.6);   // P1 坡卡死:不等 4s,本拍直接重选
    if (dist > frT2 && noGo) A.idleW += 0.45; else A.idleW = Math.max(0, A.idleW - 1);
      if (A.destT <= 0 || t.blockedT > 1.5 || A.idleW > 2.5) {
        A.relax = A.idleW > 2.5 ? 1 : 0;                 // 一次性解锁令牌:本次选点豁免"散开"拥挤检查
        t.blockedT = 0;
        if (A.idleW > 4 && !(t._cmdG && t._cmdG._detached && sqCmd.active)) {   // 指挥成员不走 jink:指令目的地即解锁目标(换位改写=违令)
          A.jinkSide = -(A.jinkSide || 1);
          var jAng = Math.atan2(dx, dz) + A.jinkSide * Math.PI / 2;
          A.destX = clamp(tp.x + Math.sin(jAng) * 18, -CONF.bounds + 8, CONF.bounds - 8);
          A.destZ = clamp(tp.z + Math.cos(jAng) * 18, -CONF.bounds + 8, CONF.bounds - 8);
          A.destT = rand(2, 3.5);
        } else {
          A.destT = rand(5, 8);
          pickAIDest(t, tgt, dist);
          // P1 航段抽查:起点→目的地 8 等分坡度,遇禁行段重选(≤3次)→取最远可达点
          if (typeof SIM_K !== 'undefined' && SIM_K > 0) {
            var _reach = navSegReach(t, tp.x, tp.z, A.destX, A.destZ, 0), _tries = 0;
            while (_reach < 1 && _tries < 3) {
              _tries++;
              pickAIDest(t, tgt, dist);
              _reach = navSegReach(t, tp.x, tp.z, A.destX, A.destZ, 0);
            }
            if (_reach < 1) {
              var _rf = Math.max(0, _reach - 0.05);
              A.destX = tp.x + (A.destX - tp.x) * _rf;
              A.destZ = tp.z + (A.destZ - tp.z) * _rf;
              A.destT = Math.min(A.destT, 3);
              // P2.3:截断点记忆——同墙 30m 内连续 3 次→±60° 侧向绕行偏置(交替)，终结墙根"到站-重选"打转
              var tdx = A.destX - (A._truncX == null ? 1e9 : A._truncX), tdz = A.destZ - (A._truncZ == null ? 1e9 : A._truncZ);
              if (tdx * tdx + tdz * tdz < 900) A._truncN = (A._truncN || 0) + 1; else A._truncN = 1;
              A._truncX = A.destX; A._truncZ = A.destZ;
              if (A._truncN >= 3) {
                A._truncSide = -(A._truncSide || 1);
                var tBase = Math.atan2(A.destX - tp.x, A.destZ - tp.z) + A._truncSide * Math.PI / 3;
                var tRng = Math.sqrt((A.destX - tp.x) * (A.destX - tp.x) + (A.destZ - tp.z) * (A.destZ - tp.z)) || 100;
                var tFx = tp.x + Math.sin(tBase) * tRng, tFz = tp.z + Math.cos(tBase) * tRng;
                if (validDest(tFx, tFz, t, true)) { A.destX = tFx; A.destZ = tFz; }
                A._truncN = 0;
              }
            }
          }
        }
        A.idleW = 0;
        A.relax = 0;
      }
    if (A.evadeT > 0) { A.destX = A.evadeX; A.destZ = A.evadeZ; }   // 逃生点压倒战术目的地
  }
  /* pickAIDest/side-step logic may replace the generic destination during a think
     tick. Re-apply the pickup route after that decision, while leaving A.mode and
     the combat target untouched. Evasion and safe-zone return remain higher priority. */
  if (!ffaZoneUrgent && !A.evadeT && A.mode !== 'control' && (powerupDriving || A._powerupDrive)) {
    var puRoute = A._powerupTarget;
    if (puRoute && !puRoute._removed && puRoute.expiresAt > gameT) {
      A._powerupDrive = true;
      A.destX = puRoute.x;
      A.destZ = puRoute.z;
      A.destT = Math.max(A.destT || 0, 0.35);
    } else A._powerupDrive = false;
  }
  if (_tThk2) __PERF.aiThink2 += performance.now() - _tThk2;

  var ddx = A.destX - tp.x, ddz = A.destZ - tp.z;
  if (evading) { ddx = A.evadeX - tp.x; ddz = A.evadeZ - tp.z; }
  var destDist = Math.sqrt((ddx)*(ddx)+(ddz)*(ddz));
  // P2 寻路:转向目标换为 pursuit 航点(到达判定仍用原始 dest;逃生/8m 内直行)
  var sdx = ddx, sdz = ddz;
  if (!evading && destDist >= 8 && typeof navSteer === 'function') {
    var _nw = navSteer(t, A.destX, A.destZ, tp);
    if (_nw) { sdx = _nw.x - tp.x; sdz = _nw.z - tp.z; }
  }
  /* 指挥追锚(玩家指令绝对):接管成员距目的地 ≥8m=行军态——车头朝行进方向+油门全额
     (charge 同口径;暴露面敌纪律让路,带内驻停/环内漫游不受影响;躲弹逃生走 evade 分支)。 */
  var sqGo = !evading && A.mode === 'guard' && t._cmdG && t._cmdG._detached &&
             sqCmd.active && destDist >= 8;
  // 抵达掩体/阵点/部署点后小幅蠕动,保持"露头-射击-缩回"节奏;
  // ★行军段(敌>型号射程)零驻留:到站即换下一段,不许原地打卡(反偷懒核心)
  if (destDist < 8) {
    var isTrunc = A._truncX != null && (A.destX - A._truncX) * (A.destX - A._truncX) + (A.destZ - A._truncZ) * (A.destZ - A._truncZ) < 100;
    if (dist > frT2) A.destT = isTrunc ? Math.min(A.destT, 1.5) : 0;   // P3.3:截断点到达给 1.5s 冷静期(防高频打转)
    else if (A.mode === 'cover' || A.mode === 'hold') A.destT = Math.min(A.destT, rand(1.5, 3.5));
  }

  var drv = steerCached(t, sdx, sdz);                   // 行驶方向:前方有障碍则绕行(10Hz 缓存;每帧双全表扫描是热点)
  // —— 车体朝向纪律:交战域内正面对敌;行军/突进/迂回/逃命让车头朝行进方向 ——
  // 输出段(hold/cover)让车头咬向目标;
  // 行军段(charge/advance)车头跟行进方向赶路,不为远程目标磨洋工(反偷懒行军速度优先);
  // 暴露纪律——处在敌人瞄准线内(察觉+LOS+<1500m,0.15s 缓存)绝不露尾:
  //   车头恒对敌,拉开距离靠倒车(油门段 ma>1.75 自动倒档);未暴露才允许转身赶路。
  if (A._expT == null) A._expT = 0.15 * (aiPhase(t) || 0.5);   // 暴露检查首值相位错峰(与 LOS 同相位,防开战同帧集中射线)
  A._expT = (A._expT || 0) - dt;
  if (A._expT <= 0) {
    // 装填期 LOS 降频(0.5s):装填 2~6s 打不了,暴露射线纯浪费——开火闸只在 reload<=0 查 LOS;
    // 装填完毕自动恢复 0.15s 高频("装完探头"延迟 ≤0.5s,战术无感)
    A._expT = t.reload > 0.3 ? 0.5 : 0.15;
    A._exposed = !!(tgt && tgt.alive && dist < 1500 &&
                    isNoticedCached(t, tgt, dist) && losClearCached(t, tgt, dist));   // 与开火闸共用 LOS 缓存
    if (A._exposed) { A._expOkT = gameT; if (A._losStarve) A._losStarve = 0; }        // 有效交战时间戳(断粮判定基准)+降级即时复归(0.15/0.5s 节拍一次比较)
  }
  var _tMove = (window._dbgPerfOn && window.__PERF) ? performance.now() : 0;   // aiCore 子段探针:运动段(yaw/throttle/applyMotion)
  var inCombat = A._exposed && A.mode !== 'charge' && !sqGo;   // 指挥追锚=行军态不咬敌(全速赶锚,炮塔独立瞄准射击)
  var turDead = turretMult(t) <= 0.001;   // 炮塔卡死(0%):只能用车体转向瞄准
  var wantYaw = evading ? Math.atan2(drv.x, drv.z)
    : (inCombat ? Math.atan2(gp.x - tp.x, gp.z - tp.z) - (turDead ? t.turretYaw : 0)   // 炮塔卡死:车头补偿固定炮塔偏角,让炮管指向目标(车体瞄准)
      : (destDist < 8 ? t.yaw : Math.atan2(drv.x, drv.z))); // 已在目的地(dest≈自身)时保持当前车头朝向——原 atan2(0,0)=0° 病态会让车原地掉头车尾朝敌(89实测根因之一)
  var diff = normAng(wantYaw - t.yaw);
  var tm = turnMult(t) * slopeTurnMul(t), sm = speedMult(t);
  var yawD = clamp(diff, -t.turn0 * tm * dt, t.turn0 * tm * dt);
  var yawRateApplied = groundYawInertia(t, dt > 0 ? yawD / dt : 0, t.turn0 * tm, dt);
  yawD = yawRateApplied * dt;
  if (!turDead && !t._laserSuppressed) t.turretYaw -= yawD;   // 正常行进时车长手轮反向补偿;激光照射时暂停炮塔局部瞄准状态
                                       // 炮塔卡死:禁用补偿——车体转向直接带动固定炮管(车体瞄准)
                                       // (无补偿行:车体转速 0.45 > 炮塔 0.32,行进转向时瞄准永远追赶不上=装填好也哑火)

  // —— 油门:正向行驶正向去,目标在背后则倒车(保持正面对敌);逃生给全油门 ——
  var ma = Math.abs(normAng(Math.atan2(drv.x, drv.z) - t.yaw));
  var th;
  if (destDist < 8) th = 0;
  else if (ma < 1.45) th = clamp(1 - ma / 1.7, evading ? 0.6 : 0.25, 1);   // 前向行驶
  else if (ma > 1.75) th = evading ? -0.85 : -0.55;                        // 倒车保正面(逃命倒车更狠)
  else th = evading ? 0.5 : 0.22;                                          // 侧向:低速调整同时车体转正
  var targetSp = th * t.speed0 * sm;
  t._throttle = th; t._throttleLock = 0;   // 物理分支:speed 由 applyMotion→slopeArbitrate 裁决,此处只写油门
  if (typeof SIM_K === 'undefined' || SIM_K <= 0) t.speed = approachSpeed(t.speed, targetSp, t.accel0 * engineEff(t), t.decel0 * Math.max(engineEff(t), 0.3), dt);             // 同上(玩家=AI 同机理)
  applyMotion(t, dt);
  if (_tMove) __PERF.aiMove += performance.now() - _tMove;
  if (t._laserSuppressed) return;                              // 激光照射期间暂停真实 AI 炮塔伺服/火控;移动与索敌路线不停止

  // —— 炮塔瞄准(提前量 + 误差 + 地形高差弹道修正) ——
  // 残骸永久物理化(不可摧毁)
  // 察觉追踪:只有亲眼看见(视野锥/受击/碰撞)或 4s 内刚看见的目标才动炮塔;
  // 纯电台目标只引导机动,不引导火控(偷袭者在你身后时,炮塔不会自己转过去)
  var seen = isNoticedCached(t, tgt, dist);   // 16Hz 感知缓存(开火/追踪反应无感)
  var seenLos = seen && losClearCached(t, tgt, dist);   // 遮挡治理:炮塔只追直视目标(复用开火闸 8Hz LOS 缓存,零新增热点)
  if (seenLos) { A.traceO = tgt; A.traceT = gameT; }
  else if (!(A.traceO === tgt && gameT - (A.traceT || -99) < 0.5)) {   // 0.5s 宽限:瞬时遮挡防抖;超过即停追(不再隔着地形/残骸死死瞄准)
    t.gunPitch += (0.12 - t.gunPitch) * Math.min(1, dt * 0.6);      // 未交战:炮管缓回收行军俯角
    return;
  }
  var aimTgt = tgt;
  var _tAim = (window._dbgPerfOn && window.__PERF) ? performance.now() : 0;   // aiCore 子段探针:瞄准伺服+火控闸耗时
  var ap = aimTgt.group.position;
  var adist = dist;
  t.ai.lastAimD = adist;                       // 目标距离入账,fireShell 黑夜视野模糊按它衰减瞄准效率
  var shellSpd = effectiveShellSpeed(t);   // 提前量/弹道解与 fireShell 同因子;炮管毁时 0.3 下限防 tof=Inf→提前量 NaN
  var tof = adist / shellSpd;
  var aimX, aimZ;
  aimX = gp.x + tgt.velX * tof * A.lead - tp.x; aimZ = gp.z + tgt.velZ * tof * A.lead - tp.z;
  var worldAim = Math.atan2(aimX, aimZ);
  // —— 主动瞄弱点:按目标朝我的暴露面选瞄准区(正脸→首下/座圈;侧面→侧甲弹药架区;屁股→尾甲机舱区) ——
  var aimY = 1.2;
  if (tgt) {
    var asp = Math.abs(normAng(Math.atan2(tp.x - gp.x, tp.z - gp.z) - tgt.yaw));   // 目标哪面朝我:≈0 正脸 / 中段 侧面 / >2.3 屁股
    aimY = asp < 0.85 ? 0.72 : (asp > 2.3 ? 1.02 : 0.86);
  }
  var dy = (ap.y + aimY) - (tp.y + 2.0) + 0.5 * CONF.gravity * tof * tof;

  // —— 世界反馈伺服(与火箭炮同一机理):按实测炮管世界方向收敛,
  //    车体纵倾/横滚/履带有击伤造成的姿态偏差被全部吸收——坡地瞄谁打谁。
  // World-space barrel feedback absorbs vehicle pitch and roll on slopes.
  // The former ground-space pitch shortcut produced a measurable slope error. The live solver uses the barrel direction.
  var wantEl = Math.atan2(dy, adist);
  t.gunPivot.getWorldDirection(_gaDir);
  var bAzF = Math.atan2(_gaDir.x, _gaDir.z);
  var bElF = Math.asin(clamp(_gaDir.y, -1, 1));

  var adiff = normAng(worldAim - bAzF);                         // 门改用世界方位残差
  /* 夜战瞄准效率:夜间伺服速度×设备档(热像1.2/夜视0.8/裸眼0.5,出生缓存 nightEff);
     nightCombatOn=applyTimeOfDay 边沿全局量——本行只读两个缓存,无逐帧检测;白天恒 1;玩家伺服不走本路径不受影响。 */
  var nEff = nightCombatOn ? t.nightEff : 1;
  var tr = t.turretRate0 * turretMult(t) * nEff;
  t.turretYaw += clamp(adiff, -tr * dt, tr * dt);
  if (isHeliVehicle(t)) t.turretYaw = clamp(t.turretYaw, -Math.PI / 2, Math.PI / 2);   // 直升机机炮射界=前方180°
  var rpkTK = recPitchK(t);                                     // 后坐炮口上抬:目标装定叠 kick,伺服装回
  var isHeliAI = isHeliVehicle(t);
  var _aiAA = (typeof isAAVehicle === 'function' && isAAVehicle(t) && t.team === 'red');   // 任务25:RED_AA GROUND 模式机炮同吃 -5°~+90° 射界(贴脸自卫可对天)
  var pitchMinAI = isHeliAI ? -80 * Math.PI / 180 : (_aiAA ? -5 * Math.PI / 180 : -0.12);
  var pitchCapAI = isHeliAI ? 0.0 : (_aiAA ? 90 * Math.PI / 180 : (isTD89Vehicle(t) ? 0.24 : 0.20));   // AI 炮仰角上限(坦克0.20/89歼0.24rad/PGZ 90°)
  t.gunPitch = clamp(t.gunPitch + clamp(wantEl + rpkTK - bElF, -(isHeliAI ? 2.0 : 0.5) * nEff * dt, (isHeliAI ? 2.0 : 0.5) * nEff * dt), pitchMinAI, pitchCapAI + rpkTK);
  if (!isFinite(t.turretYaw)) t.turretYaw = 0;               // NaN 双保险(炮塔矩阵 NaN=炮塔不渲染="只有车体没炮塔")
  if (!isFinite(t.gunPitch)) t.gunPitch = isHeliAI ? 0.0 : 0.2;

  // —— 开火:装填完毕 + 目标已警觉 + 射界畅通 三者齐备绝不哑火(gunGate 逐因记账) ——
  // isNoticed 复用上方 seen(避免同参重复决策);友军线 0.2s 缓存(免每帧全表 sqrt+atan2)
  if (t.reload <= 0 && t.mods.gun.hp > 0 && seen && aaSoftGateOK(t, tgt, adist)) {   // 任务22 决策④:防空车 GROUND 只打软目标/贴脸
    if (A.mode === 'charge') { /* 冲锋:移动中射击,豁免 range 门——任意距离开火压制(暴露推进换近战优势) */ }
    else if (adist >= combatFloorOf(t, tgt)) gunGate(t, 'range');   // 交战段:交火底线外散布圆盖不住目标正面,不打
    // 冲锋:瞄准门放宽至固定 17°(命中率让位于压制;冲锋车不驻留等瞄);交战段走散布同源门
    else if (A.mode === 'charge' ? Math.abs(adiff) >= 0.30 : Math.abs(adiff) >= aimGateAI(t, adist)) gunGate(t, 'aim');
    else if (friendInLineCached(t, worldAim, adist)) { gunGate(t, 'friend'); sideStepForShot(t, worldAim); }
    else if (losClearCached(t, tgt, dist)) {      // 8Hz 缓存(每帧全宽射线是中间期 CPU 头号热点)
      tryFire(t);
    } else {
      gunGate(t, 'los');
      /* 指挥接管成员不换位不错车:目的地=玩家指令(跟锚/围旗)绝对,移动中等待射窗
         (玩家允许机动中瞄准射击,不要求追射界);常规 AI 走 F2 风暴抑制+火力格换位。 */
      var sqHold = t._cmdG && t._cmdG._detached && sqCmd.active;
      if (sqHold) { /* 保持指令目的地,零改写 */ }
      /* F2 射界遮挡风暴抑制(常规 AI):残骸=永久物理掩体(不可摧毁),原地不动时每 0.3~0.5s 一拍
         全量重选目的地纯属随机数打转(重规划风暴);仅当距上次 los 重选已位移 ≥12m
         或间隔 ≥3s 才允许再重选,其余时刻走侧向碎步找射窗(与友军挡线同机制)。 */
      else if (A._losRpT == null || gameT - A._losRpT >= 3 ||
          Math.sqrt((tp.x - (A._losRpX || 0))*(tp.x - (A._losRpX || 0))+(tp.z - (A._losRpZ || 0))*(tp.z - (A._losRpZ || 0))) >= 12) {
        A._losRpT = gameT; A._losRpX = tp.x; A._losRpZ = tp.z;
        var tbL = tacFireCellNear(tp.x, tp.z, tgt.group.position.x, tgt.group.position.z, t.team);
        if (tbL) { A.destX = tbL.x; A.destZ = tbL.z; A.destT = rand(2.5, 4); }   // 换位直投:9×9 窗内"朝目标扇区真通视"(硬门+真射线精筛)最优格
        else A.destT = 0;            // 窗内无通视格(深盲区)/网格未建:常规重选,断粮降级接管大步前推
      } else sideStepForShot(t, worldAim);
    }
  }
  if (_tAim) window.__PERF.aimT += performance.now() - _tAim;   // aiCore 子段探针累计
}
var losRay = new THREE.Raycaster();
var _losFrom = new THREE.Vector3(), _losDir = new THREE.Vector3();   // hasLineOfSight 零分配复用
/* 地形遮挡步进采样(开火闸/掩体评估共用口径):直线上按 max(9m, d/26) 步距查高度场,
   线高低于地表+0.4m 容差即被地形遮挡。直射弹平直近似(1650m/s 600m 内下坠<1.8m,
   目标点 +1.2m 高已含容差);地形主波长 250m,9~25m 步距漏检峰宽 <1m。火箭炮高抛不经本闸。 */
function terrainBlocksLine(ax, ay, az, bx, by, bz, d) {
  var steps = Math.max(3, Math.min(26, Math.ceil(d / 9)));
  for (var i = 1; i < steps; i++) {
    var f = i / steps;
    if (ay + (by - ay) * f < terrainH(ax + (bx - ax) * f, az + (bz - az) * f) + 0.4) return true;
  }
  return false;
}
function hasLineOfSight(t, tgt, dist) {
  if (typeof PERF_BASE !== 'undefined') PERF_BASE.los++;
  var _t0 = (window._dbgPerfOn && window.__PERF) ? performance.now() : 0;   // aiCore 子段探针:LOS 射线耗时
  // 视线被 障碍物 或 残骸 阻挡则无法开火(活坦克不视为遮挡,允许掠过/误伤); 判据与掩体判定 losBlockedAt 同源
  t.muzzle.getWorldPosition(_losFrom);
  var to = tgt.group.position;
  _losDir.set(to.x - _losFrom.x, to.y + 1.2 - _losFrom.y, to.z - _losFrom.z);
  var d = _losDir.length(); _losDir.normalize();
  var dd = Math.min(d, dist);
  var blocked = losBlockedAt(_losFrom.x, _losFrom.y, _losFrom.z,
                             _losFrom.x + _losDir.x * dd, _losFrom.y + _losDir.y * dd, _losFrom.z + _losDir.z * dd);
  if (_t0) window.__PERF.losT += performance.now() - _t0;
  return !blocked;
}
/* ===== LOS 8Hz 缓存(中间期 CPU 头号热点治理)——
   装填就绪的交战车每帧一次全宽相位射线是热点(残骸累积后单帧百余条=20+ms)。
   遮挡物=静态障碍+缓增残骸,0.13s 陈旧度对开火决策零感知(装填 2~6s 量纲)。
   同一目标窗口内复用;换目标/过窗即重评。AI 专属,玩家不受影响(数值对等不破)。 ===== */
var LOS_CACHE_T = 0.13;
var _aiPhaseSeq = 0;
function aiPhase(t) {   // 每车一次性稳定相位(0..1):暴露检查按车错峰,防同帧集中射线(分配序确定,与随机种子无关)
  var A = t.ai;
  if (A._phase == null) A._phase = ((Math.abs(Math.sin((_aiPhaseSeq++) * 12.9898) * 43758.5453)) % 1) || 0.5;
  return A._phase;
}
function losClearCached(t, tgt, dist) {
  var A = t.ai;
  /* TTL 与失效触发并用:目标切换、任一端跨命中网格、残骸/障碍网格变更都会立即复查;
     其余情况按距离分档复用结果。这样不会为静止战线重复地形步进和 Three.js 射线。 */
  var tp=t.group.position, op=tgt.group.position;
  var ownCell=Math.floor(tp.x/HG_CELL)*4096+Math.floor(tp.z/HG_CELL);
  var tgtCell=Math.floor(op.x/HG_CELL)*4096+Math.floor(op.z/HG_CELL);
  var losTTL = dist > 600 ? 0.3 : (dist > 250 ? 0.22 : LOS_CACHE_T);
  if (A._losO === tgt && gameT < A._losDue && A._losStaticV === hitGridStaticVersion &&
A._losOwnCell === ownCell && A._losTgtCell === tgtCell) return A._losOK;
  var ok = hasLineOfSight(t, tgt, dist);
  A._losO = tgt; A._losDue = gameT + losTTL; A._losOK = ok;
  return ok;
}

/* ===== 组级距离箱记录(指挥官系统)——每组按 100m 距离箱记录 dOut(打出)/dIn(承受),
   gScore(组级决策得分:高命中率组只计受伤/其余伤害+受伤同计,→迂回/护卫配额)与高威胁评比(指挥官级 dmgBySrc 受伤账 / dmgDealt 造伤账)读本记录。
   组级命中率账(g.shots/g.hits):消费端=cmdAimScan(拉近距离决策)+gScore(双态计分),见 CMD_AIM_*。 ===== */
var DYN_BIN = 100, DYN_NB = 21;
function dynModelKey(t) {
  if (!t) return 'unk';
  if (t.model) return t.model;                       // 新载具设 t.model 即自动独立建档(通用)
  return vehicleModelKey(t.team, t.kind);            // Derive the model key from the registry; unknown kinds keep their own bucket.
}
function dynBinOf(d) { return Math.min(DYN_NB - 1, Math.max(0, Math.floor(d / DYN_BIN))); }
/* 指挥官记账内核(造伤/击杀共用):actor=输出方(攻方/击杀方),recip=输入方(受伤方/死亡方),amt=伤害量。
   Tier A 裁剪:仅保留消费端在读的活账户——
   ga.dOut/gv.dIn → gScore(迂回/护卫配额);gv._c.dmgBySrc → oppHT;ga._c.dmgDealt → ownHT;
   ga._c.secAcc/gv._c.secAcc → 断崖紧急决策。 */
function dynNoteCore(actor, recip, amt, dist) {
  var b = dynBinOf(dist);
  var ga = (actor._cmdG && !actor._cmdG._detached) ? actor._cmdG : null;   // 接管组不计分(脱离指挥官账面)
  var gv = (recip._cmdG && !recip._cmdG._detached) ? recip._cmdG : null;   // 接管组受损也不计入指挥官损失
  if (ga) ga.dOut[b] += amt;
  if (gv) gv.dIn[b] += amt;
  if (gv) {
    gv._c.dmgBySrc = gv._c.dmgBySrc || {};
    var akv = dynModelKey(actor);
    gv._c.dmgBySrc[akv] = (gv._c.dmgBySrc[akv] || 0) + amt;   // 指挥官级受伤分源账(高威胁评比主账,不随组重建/阵亡丢失)
  }
  if (ga) {
    ga._c.dmgDealt = (ga._c.dmgDealt || 0) + amt;              // 指挥官级造伤账(护卫对象评比主账)
    ga._c.secAcc += amt;
  }
  if (gv) gv._c.secAcc -= amt;
}
function dynNoteDmg(attacker, victim, dmg) {
  if (!attacker || attacker === victim || !attacker.group || !victim.group) return;
  /* 计分口径:仅"地面载具"(坦克 基础主战坦克/99/BLUE_MBT_2 + 坦歼 红方歼击车)造成的伤害计入指挥官系统——
     炮兵(火箭炮)与空中载具(直升机)造成的伤害一律不计分(组级箱 g.dOut/g.dIn、
     指挥官级 dmgBySrc/dmgDealt/secAcc 全部跳过);攻方不记功,受击方也不产生伤害扣分。
     判据统一走 vehicleScoresDamage(载具三大类标签系统),新增载具打标签即自动继承。 */
  if (!vehicleScoresDamage(attacker)) return;
  var dd = Math.sqrt((attacker.group.position.x - victim.group.position.x)*(attacker.group.position.x - victim.group.position.x)+(attacker.group.position.z - victim.group.position.z)*(attacker.group.position.z - victim.group.position.z));
  dynNoteCore(attacker, victim, dmg, dd);
}
function dynNoteDeath(dead, killer, rem) {   // 阵亡=受到"死前剩余结构"伤害;击杀=造成同等伤害
  if (!dead || !dead.group || !killer || !killer.group || !vehicleScoresDamage(killer)) return;   // 非地面载具(火箭炮/直升机)击杀豁免:战果/损失/净分全不计(同 dynNoteDmg)
  var dd = Math.sqrt((dead.group.position.x - killer.group.position.x)*(dead.group.position.x - killer.group.position.x)+(dead.group.position.z - killer.group.position.z)*(dead.group.position.z - killer.group.position.z));
  dynNoteCore(killer, dead, Math.max(0, rem || 0), dd);   // 阵亡剩余结构同记(与 dIn 口径一致)
}
/* ============================================================
   指挥官-士兵双层系统——
   士兵层=既有 aiUpdate(单车);指挥官层=每 team×型号 一名(arty 不设,曲射无作战距离推拉语义),掌:
   分组(4车组/就近原则/实时读同型号在场数,无定值花名册)、补员/注销、
   60s 周期决策(开局首决)+ 3min 后断崖紧急决策、组级分值箱(正面/迂回分账)、
   高威胁评比(受伤/造伤账→敌方高威胁/护卫对象)、交火底线(最前方敌人+散布解算最远战斗距离)、
   组级命中率决策(命中敌方活车即计;命中率 <50% 组缩最大作战距离 ×0.6,回升 ≥50% 自动解除)、
   迂回/护卫配额比例调节(下限 1/10、<10 组解锁 0;上限 1/2 扣除护卫后)。
   ============================================================ */
/* ============================================================
   战术射界网格(影响图谱系:建场一次评分,决策期查询,零逐帧)
   · 网格 TAC_N×TAC_N(2km→24×24=83m 格),每格自格心+2.2m 炮位高向 8 方位×2 距离带
     (300/700m)做地形步进视线(终点=带端地表+1.5m),得扇区通视率;
   · 格分[扇区] = 0.60×扇区通视率 + 0.25×相对高程(5×5 邻域,±12m 归一) + 0.15×全向通视率;
   · 边缘坡环区(格心出 |坐标|>slopeStart-40)整格置 0=不可选阵地;
   · 敌密度叠加场 _tacDens[观察方]:cmdDecide 入口触发重建(2s 门去重,零逐帧),
     敌方活车向 700m 内格 splat,权=距离带(近带≤300m 1.0/远带 0.7)×建场通视率 _tacOpen
     (山背后敌人不抬分="射界内"三条件闭合);读取端 eff=静态分+0.5×min(1,密度/4),
     未建表密度项=0(行为退化为纯静态分兜底);
   · 消费(全部决策/思考节拍):走廊加权/组阵地格/迂回锚吸附;LOS 换位走 tacFireCellNear
     (9×9 窗通视硬门,详见该函数注);LOS 断粮降级触发器见开火闸 los 分支;
   · 弹坑不改宏观地形,静态分整场免重算;tacGridBuild 开局一次性调用(约 20ms)。
   ============================================================ */
var TAC_N = 24, TAC_SECT = 8;
var _tacScore = null, _tacCell = 0, _tacHalf = 0;
var _tacOpen = null;                                     // 建场扇区通视率(密度可见性门,建场后只读)
var _tacDens = { red: null, blue: null };              // 敌密度叠加场[观察方](决策期重建)
var _tacDensT = { red: -1e9, blue: -1e9 };             // 各观察方最后重建时刻(触发器门)
var TAC_DENS_W = 0.5, TAC_DENS_REF = 4, TAC_DENS_GAP = 2, TAC_DENS_R = 700;   // 增益上限/饱和车数/重建最小间隔 s/射界半径(=网格远带)
function tacGridBuild() {
  _tacCell = MAP.side / TAC_N; _tacHalf = MAP.half;
  var N = TAC_N, S = TAC_SECT, edge = MAP.half - MAP.slopeW - 40;
  _tacScore = new Float32Array(N * N * S);
  _tacOpen = new Float32Array(N * N * S);
  _tacDens.red = _tacDens.blue = null;                 // 换场失效:密度表随战场重置(首决前=纯静态分)
  _tacDensT.red = _tacDensT.blue = -1e9;
  var hArr = new Float32Array(N * N), open = _tacOpen, openAll = new Float32Array(N * N);
  var bands = [300, 700], STEPS = 24, gx, gz, i2, sct;
  for (gz = 0; gz < N; gz++) for (gx = 0; gx < N; gx++) {
    var cx = -_tacHalf + (gx + 0.5) * _tacCell, cz = -_tacHalf + (gz + 0.5) * _tacCell;
    var h0 = terrainH(cx, cz); hArr[gz * N + gx] = h0;   // terrainH=查表路径(解析式 22 万调用实测 2.3s,查表 ~15ms;开局无弹坑与 terrainBase 同值)
    var eyeY = h0 + 2.2, oSum = 0;
    for (sct = 0; sct < S; sct++) {
      var ang = sct * Math.PI / 4, dx = Math.sin(ang), dz = Math.cos(ang), vis = 0;
      for (var b = 0; b < 2; b++) {
        var R = bands[b], ex = cx + dx * R, ez = cz + dz * R;
        if (Math.abs(ex) > _tacHalf || Math.abs(ez) > _tacHalf) { vis++; continue; }   // 出图带=不惩罚
        var eY = terrainH(ex, ez) + 1.5, blocked = false;
        for (var st = 1; st < STEPS; st++) {
          var f = st / STEPS;
          if (eyeY + (eY - eyeY) * f < terrainH(cx + dx * R * f, cz + dz * R * f) + 0.4) { blocked = true; break; }
        }
        if (!blocked) vis++;
      }
      open[(gz * N + gx) * S + sct] = vis / 2;
      oSum += vis / 2;
    }
    openAll[gz * N + gx] = oSum / S;
  }
  for (gz = 0; gz < N; gz++) for (gx = 0; gx < N; gx++) {
    var cx2 = -_tacHalf + (gx + 0.5) * _tacCell, cz2 = -_tacHalf + (gz + 0.5) * _tacCell;
    if (Math.abs(cx2) > edge || Math.abs(cz2) > edge) { for (sct = 0; sct < S; sct++) _tacScore[(gz * N + gx) * S + sct] = 0; continue; }
    var mSum = 0, mN = 0;                                // 相对高程:5×5 邻域均
    for (var jz = Math.max(0, gz - 2); jz <= Math.min(N - 1, gz + 2); jz++)
      for (var jx = Math.max(0, gx - 2); jx <= Math.min(N - 1, gx + 2); jx++) { mSum += hArr[jz * N + jx]; mN++; }
    var relN = clamp((hArr[gz * N + gx] - mSum / mN) / 12, -1, 1) * 0.5 + 0.5;
    for (sct = 0; sct < S; sct++)
      _tacScore[(gz * N + gx) * S + sct] = 0.60 * open[(gz * N + gx) * S + sct] + 0.25 * relN + 0.15 * openAll[gz * N + gx];
  }
}
function tacSector(dx, dz) {                             // 方位→扇区(与建网格 ang=sct·π/4,dx=sin,dz=cos 同口径)
  var s2 = Math.round(Math.atan2(dx, dz) / (Math.PI / 4));
  return (s2 + 8) & 7;
}
/* 敌密度叠加场重建——触发点=cmdDecide 入口(60s 例行+断崖立即决策),2s 门去重(同帧多指挥官只建一次);
   敌方活车(≤88)各向 700m 半径内格(≤17×17)splat:扇区=格心看向敌车方位,
   权=距离带×该格该扇区建场通视率(_tacOpen 门:地形挡住的敌人不计入=只算真射界内)。 */
function tacDensRebuild(team) {
  if (!_tacScore || gameT - _tacDensT[team] < TAC_DENS_GAP) return;
  _tacDensT[team] = gameT;
  var D = _tacDens[team] || (_tacDens[team] = new Float32Array(TAC_N * TAC_N * TAC_SECT));
  D.fill(0);
  var N = TAC_N, S = TAC_SECT, R2 = TAC_DENS_R * TAC_DENS_R, NEAR2 = 300 * 300;
  var rc = Math.ceil(TAC_DENS_R / _tacCell);
  for (var i = 0; i < aliveList.length; i++) {
    var u = aliveList[i];
    if (!u.alive || u.team === team) continue;
    var ex = u.group.position.x, ez = u.group.position.z;
    var egx = Math.floor((ex + _tacHalf) / _tacCell), egz = Math.floor((ez + _tacHalf) / _tacCell);
    var x1 = Math.min(N - 1, egx + rc), z1 = Math.min(N - 1, egz + rc);
    for (var gz = Math.max(0, egz - rc); gz <= z1; gz++) for (var gx = Math.max(0, egx - rc); gx <= x1; gx++) {
      var dx = ex - (-_tacHalf + (gx + 0.5) * _tacCell), dz = ez - (-_tacHalf + (gz + 0.5) * _tacCell);
      var d2 = dx * dx + dz * dz;
      if (d2 > R2) continue;
      var sct = tacSector(dx, dz);
      var o = _tacOpen[(gz * N + gx) * S + sct];
      if (o > 0) D[(gz * N + gx) * S + sct] += (d2 < NEAR2 ? 1.0 : 0.7) * o;
    }
  }
}
function tacDensGain(team, idx) {                        // 密度增益项 0..TAC_DENS_W(未建表/无观察方=0=纯静态分)
  var D = team ? _tacDens[team] : null;
  if (!D) return 0;
  var d = D[idx] / TAC_DENS_REF;
  return TAC_DENS_W * (d > 1 ? 1 : d);
}
function tacScoreAt(x, z, sct, team) {                   // 单点扇区分=静态地形分+敌密度增益(网格未建=中性 0.5)
  if (!_tacScore) return 0.5;
  var gx = clamp(Math.floor((x + _tacHalf) / _tacCell), 0, TAC_N - 1);
  var gz = clamp(Math.floor((z + _tacHalf) / _tacCell), 0, TAC_N - 1);
  var idx = (gz * TAC_N + gx) * TAC_SECT + sct;
  return _tacScore[idx] + tacDensGain(team, idx);
}
function tacBestNear(x, z, tx, tz, team) {               // 3×3 邻域内朝(tx,tz)扇区综合分(静态+密度)最高格心;未建网格=原点直返
  if (!_tacScore) return { x: x, z: z, sc: 0 };
  var N = TAC_N, gx = clamp(Math.floor((x + _tacHalf) / _tacCell), 0, N - 1), gz = clamp(Math.floor((z + _tacHalf) / _tacCell), 0, N - 1);
  var bx = x, bz = z, bs = -1;
  for (var dz2 = -1; dz2 <= 1; dz2++) for (var dx2 = -1; dx2 <= 1; dx2++) {
    var cg = gx + dx2, rg = gz + dz2;
    if (cg < 0 || cg >= N || rg < 0 || rg >= N) continue;
    var ccx = -_tacHalf + (cg + 0.5) * _tacCell, ccz = -_tacHalf + (rg + 0.5) * _tacCell;
    var idx2 = (rg * N + cg) * TAC_SECT + tacSector(tx - ccx, tz - ccz);
    var sc = _tacScore[idx2] + tacDensGain(team, idx2);
    if (sc > bs) { bs = sc; bx = ccx; bz = ccz; }
  }
  return { x: bx, z: bz, sc: bs };
}
/* LOS 受挫换位/驻停被拒阵位查询:9×9 窗(±4 格≈±332m)内"朝目标扇区建场通视率>0"(硬门)
   的 top-2 候选,再以真射线 terrainBlocksLine 精筛(EQS trace-test 对应物:_tacOpen 为两带
   步进近似,格心→目标补一次实测,误报走次优,双败=null 调用方级联)。
   与 tacBestNear 的区别:①窗半径 4 倍(3×3=±83m 逃不出数百米山体阴影);②通视硬门取代
   hard LOS gating replaces score-only nudging; exclude the current cell so every retry moves at least one cell;
   挪一格);④候选到目标距离不得比当前远超过半格(不许显著拉远射距)。
   事件级调用(los 重选 ≥3s/驻停被拒 think 节拍),80 格窗+≤2 射线零逐帧。 */
function tacFireCellNear(x, z, tx, tz, team) {
  if (!_tacScore || !_tacOpen) return null;
  var N = TAC_N, gx = clamp(Math.floor((x + _tacHalf) / _tacCell), 0, N - 1), gz = clamp(Math.floor((z + _tacHalf) / _tacCell), 0, N - 1);
  var dxT0 = tx - x, dzT0 = tz - z;
  var dMax = Math.sqrt(dxT0 * dxT0 + dzT0 * dzT0) + _tacCell * 0.5;
  var b1x = 0, b1z = 0, s1 = -1, b2x = 0, b2z = 0, s2 = -1;
  for (var dz2 = -4; dz2 <= 4; dz2++) for (var dx2 = -4; dx2 <= 4; dx2++) {
    if (dx2 === 0 && dz2 === 0) continue;
    var cg = gx + dx2, rg = gz + dz2;
    if (cg < 0 || cg >= N || rg < 0 || rg >= N) continue;
    var ccx = -_tacHalf + (cg + 0.5) * _tacCell, ccz = -_tacHalf + (rg + 0.5) * _tacCell;
    var dxT = tx - ccx, dzT = tz - ccz;
    if (Math.sqrt(dxT * dxT + dzT * dzT) > dMax) continue;
    var idx = (rg * N + cg) * TAC_SECT + tacSector(dxT, dzT);
    if (_tacOpen[idx] <= 0 || _tacScore[idx] <= 0) continue;   // 硬门:朝目标扇区必须通视;边缘坡环格(分 0)剔除
    var sc = _tacScore[idx] + tacDensGain(team, idx)
           - 0.05 * Math.max(Math.abs(dx2), Math.abs(dz2));    // 切比雪夫距离罚:同质量近格优先
    if (sc > s1) { s2 = s1; b2x = b1x; b2z = b1z; s1 = sc; b1x = ccx; b1z = ccz; }
    else if (sc > s2) { s2 = sc; b2x = ccx; b2z = ccz; }
  }
  var tyE = terrainH(tx, tz) + 1.5;                            // 目标端高与建场口径一致(带端地表+1.5m)
  if (s1 >= 0 && !terrainBlocksLine(b1x, terrainH(b1x, b1z) + 2.2, b1z, tx, tyE, tz, Math.sqrt((tx - b1x)*(tx - b1x)+(tz - b1z)*(tz - b1z))))
    return { x: b1x, z: b1z, sc: s1 };
  if (s2 >= 0 && !terrainBlocksLine(b2x, terrainH(b2x, b2z) + 2.2, b2z, tx, tyE, tz, Math.sqrt((tx - b2x)*(tx - b2x)+(tz - b2z)*(tz - b2z))))
    return { x: b2x, z: b2z, sc: s2 };
  return null;
}

var CMD_INTERVAL = 60;        // 决策间隔通用变量(默认 60s)
var CMD_GROUP_SIZE = 4;       // 小组规模
var CMD_EMERG_UNLOCK = 180;   // 紧急决策解锁(开局 3 分钟)
var CMD_CLIFF = 250;          // 断崖阈值:近 8s 每秒净分跌破前 30s 基线量。
                              // 校准按近距互射战场:贴脸战损率 ~5-10×(交火底线把战线压进 200m 级),
                              // 低阈值会被战损波动常态触发(撤退窗口常开→底线形同虚设)。
                              // 250 = 近距单回合重创(≈2-3 辆正面车被打穿)仍不足触发,仅真正崩盘断崖触发。
var CMD_AIM_HR = 0.5;         // 组级命中率门槛:命中率低于此值的小组被命令拉近距离攻击(缩最大作战距离)
var CMD_AIM_MIN_SHOTS = 4;    // 最少射击样本(不足视为无数据,决策不受影响)
var CMD_AIM_RANGE_MUL = 0.6;  // 低命中率小组最大作战距离乘数(缩小 40%;命中率回升 ≥50% 后新决策自动解除)
var CMD_AIM_CLOSE = 60;       // 重划前后同簇质心就近继承半径(m)
/* 区域密度重定向(方案C:预防=决策期等距走廊 + 兜底=1Hz 密度扫描)——密度区=200m 固定粒度(与边长无关;2km→10×10,4km→20×20,1km→5×5);
   本队某区密度 ≥ DENS_MAX 时,区内 front 组走廊重定向到最稀疏安全区
   (敌军 ≤ DENS_OPP_MAX 才去);重定向 30s 冷却防振荡。
   只改组走廊横向(laneX),纵深仍由交火底线/最前方敌人决定。 */
var DENS_CELL = 200, DENS_MAX = 8, DENS_OPP_MAX = 6, DENS_COOLDOWN = 30;
var W_WRECK = 0.5;              // 残骸密度权重(与活车 mine×4/foe×2 同尺度,桶=200m 格内残骸数;调参暴露)
var _densN = 0, _densF = null, _densE = null, _densT = -9;   // 友/敌密度桶(Int32Array,惰性按边长建)
var _densW = null;              // 残骸密度桶(同建同扫;残骸半静态,1Hz 刷新语义等价"决策前一瞬间")
var commanders = {};          // key=team|型号
function cmdKeyOf(t) { return t.team + '|' + dynModelKey(t); }
function cmdGet(key) {
  var c = commanders[key];
  if (!c) c = commanders[key] = { key: key, groups: [], flankN: 0, nextSeq: 1, decisions: 0,
    nextT: 0,                                  // 开局首个 tick 即触发首次决策
    oppHT: null, ownHT: null, floorDist: 0, guardN: 0,
    dmgBySrc: {}, dmgDealt: 0,               // 指挥官级账(组对象随重建/阵亡注销会丢账,高威胁评比改吃本账)
    ring: new Float64Array(60), ringI: 0, ringN: 0, secAcc: 0 };
  return c;
}
/* 实时读同型号存活载具(无定值花名册——未来自定义数量天然兼容)
   ★直升机不入名册:指挥官-士兵双层系统是"地面装甲班/排"的二维走廊体系(分组/角色/车道 laneX/阵地格/
     交火底线),其全部产物都只在 aiUpdate 的地面分支消费;而直升机走 aiHeliUpdate 独立三维空战逻辑
     (aiUpdate 第 2 行即早退),把直升机编进指挥官小组只能产生"组有了、指令无人消费"的半连接状态,
     并让 pickThreat 的 flank 加成反向改写直升机选敌优先级。故在此从源头剔除。 */
function cmdRoster(key) {
  var out = [], i, t;
  for (i = 0; i < aliveList.length; i++) {
    t = aliveList[i];
    if (t.isPlayer || t.kind === 'arty') continue;
    if (isHeliVehicle(t)) continue;   // 直升机不归指挥官指挥(三维空战自主决策)
    if (typeof isAAVehicle === 'function' && isAAVehicle(t)) continue;   // 防空载具不归指挥官指挥(独立防空 AI,火箭炮同构,用户设定)
    if (t.team + '|' + dynModelKey(t) === key) out.push(t);
  }
  return out;
}
function cmdNewGroup(c, members) {
  var g = { id: c.nextSeq++, _c: c, members: members, role: 'front', side: 1,
            laneX: null, densT: 0, _controlTarget: null,       // 组走廊横坐标 + 控制区目标(独立于 sqCmd 玩家小队旗状态)
            dOut: new Float64Array(DYN_NB), dIn: new Float64Array(DYN_NB),   // gScore 只读 dOut/dIn(组级不维护其它统计量)
            rangeMul: 1, shots: 0, hits: 0 };   // 组级命中率账(射击/命中,见 cmdAimScan)与决策乘数(低命中率组缩最大作战距离)
  for (var i = 0; i < members.length; i++) {
    members[i]._cmdG = g;
    if (members[i].ai) members[i].ai.wpI = 0;   // Reset the route segment after regrouping; flank groups restart at wp0.
  }
  return g;
}
/* 就近贪心分组:种子+迭代并入最近未分组车,满 4 成组,余数不足 4 单独成不满员组 */
function cmdSplit(c) {
  var un = cmdRoster(c.key), i, j;
  /* Clear stale helicopter and AA group links before rebuilding the roster. */
  for (i = 0; i < c.groups.length; i++) {
    var gmH = c.groups[i].members;
    for (j = 0; j < gmH.length; j++) if (isHeliVehicle(gmH[j]) || (typeof isAAVehicle === 'function' && isAAVehicle(gmH[j]))) gmH[j]._cmdG = null;
  }
  for (i = un.length - 1; i >= 0; i--) if (un[i]._cmdG && un[i]._cmdG._detached) un.splice(i, 1);   // 玩家接管中成员不参与重分组(防决策期夺组)
  for (i = 0; i < un.length; i++) un[i]._cmdG = null;
  c.groups.length = 0;
  while (un.length) {
    var mem = [un.shift()], cx, cz;
    while (mem.length < CMD_GROUP_SIZE && un.length) {
      cx = 0; cz = 0;
      for (i = 0; i < mem.length; i++) { cx += mem[i].group.position.x; cz += mem[i].group.position.z; }
      cx /= mem.length; cz /= mem.length;
      var bi = 0, bd = 1e18;
      for (j = 0; j < un.length; j++) {
        var dx = un[j].group.position.x - cx, dz = un[j].group.position.z - cz, d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; bi = j; }
      }
      mem.push(un.splice(bi, 1)[0]);
    }
    c.groups.push(cmdNewGroup(c, mem));        // Reset score bins with each new formation.
  }
}
/* 补员:编入最近的不满员小组;没有则新建一组 */
function cmdAssign(t) {
  /* FFA bypasses commander grouping; this entry remains the common spawn hook. */
  if (isFfaMode()) { if (t && t._cmdG) cmdLeave(t); return; }
  /* 直升机不入指挥官编组:生成/补员/退出指挥后重新编入三条路径统一在此拦截;
     已挂组者即时脱组(cmdLeave 同步注销空组),保证 t._cmdG 对直升机恒为 null。 */
  if (t.isPlayer || t.kind === 'arty' || !t.ai || isHeliVehicle(t) || (typeof isAAVehicle === 'function' && isAAVehicle(t))) { if (t._cmdG) cmdLeave(t); return; }
  if (sqCmd.active && sqCmd.group && t.team === sqCmd.team && sqCmd.group.members.length < CMD_GROUP_SIZE) {
    sqCmd.group.members.push(t); t._cmdG = sqCmd.group; return;   // 指挥模式补员:直入玩家接管组(满编后走常规编组)
  }
  var c = cmdGet(cmdKeyOf(t));
  var p = t.group.position, best = null, bd = 1e18, i, j, g;
  for (i = 0; i < c.groups.length; i++) {
    g = c.groups[i];
    if (!g.members.length || g.members.length >= CMD_GROUP_SIZE) continue;
    var cx = 0, cz = 0;
    for (j = 0; j < g.members.length; j++) { cx += g.members[j].group.position.x; cz += g.members[j].group.position.z; }
    cx /= g.members.length; cz /= g.members.length;
    var d2 = (p.x - cx) * (p.x - cx) + (p.z - cz) * (p.z - cz);
    if (d2 < bd) { bd = d2; best = g; }
  }
  if (best) { best.members.push(t); t._cmdG = best; }
  else c.groups.push(cmdNewGroup(c, [t]));
}
/* 死亡/被接管:离组;空组注销 */
function cmdLeave(t) {
  var g = t._cmdG;
  if (!g) return;
  t._cmdG = null;
  var ix = g.members.indexOf(t);
  if (ix >= 0) g.members.splice(ix, 1);
  if (!g.members.length) { var i2 = g._c.groups.indexOf(g); if (i2 >= 0) g._c.groups.splice(i2, 1); }
}
/* ===== 小队指挥系统(全事件驱动,零新增每帧轮询) ----
   玩家长按(Backspace/#tsqb 1s)接管距自己最近的己方指挥小组:
   · 组脱离指挥部(c.groups 移除)=不受指挥官决策/评分/重分组影响,指挥官损失账不计(dynNoteCore 守卫);
   · 分数清零(dOut/dIn/shots/hits/rangeMul);
   · 被指挥者头顶五角星、无战术标(红方黄/蓝方白,见 comic.js _cmdStarTick);
   · 跟随玩家=复用护卫机制(role='guard'+protectGroup 包裹玩家,pickAIDest 护卫分支白吃);
   · 补员不断:cmdAssign 顶部钩子,战损补充直入接管组(满编 CMD_GROUP_SIZE 后回归常规编组);
   · 再长按退出:成员逐个 cmdAssign 重新编入(重新部署算法);玩家阵亡/小队全灭自动退出。 ===== */
/* ===== 指挥模式小队指令(占领/跟随)与占领点旗帜 ----
   order:'follow'=默认跟随玩家(护卫机制原样);'occupy'=小队驶向 sqCmd.ox/oz 占领点并驻停(交战行为
   fire control remains independent; movement anchors switch to the flag. 指令变更=纯事件(Z/X 键/触控键),AI 消费全部挂在既有
   think/destT 节拍内,零逐帧;旗帜=惰性一次建 THREE 静态件(墨描边三角旗+细杆),显隐/落位仅事件级,
   换场(sqCmdReset)/退出(sqCmdExit)/改跟随即收旗。 ===== */
/* ===== 指挥指令锚点解析(单一真源:交战路径 pickAIDest 与无敌情路径共用) ----
   follow:锚=玩家,带外 >45m 直追(回拉 25m),带内 24~44m 全向环;
   occupy:锚=占领点(小旗),带外 >50m 直追(回拉 40m=停在带内沿),带内 20~50m 行动环,距旗 <18m 外推至 26m。
   返回 null=指令数据缺失(玩家亡/未接管)。chase=带外判定半径,pull=直追回拉量。 ===== */
function sqCmdAnchor(t) {
  if (!sqCmd.active || !t._cmdG || !t._cmdG._detached) return null;
  if (sqCmd.order === 'occupy') {
    var fdx = sqCmd.ox - t.group.position.x, fdz = sqCmd.oz - t.group.position.z, fd = Math.sqrt((fdx)*(fdx)+(fdz)*(fdz));
    if (fd < 18)                                        // 距旗过近:外推出带(行动环 20~50m)
      return { x: sqCmd.ox - fdx / (fd || 1) * 26, z: sqCmd.oz - fdz / (fd || 1) * 26, chase: 0, pull: 0, rN: 20, rF: 50 };
    return { x: sqCmd.ox, z: sqCmd.oz, chase: 50, pull: 40, rN: 20, rF: 50 };
  }
  if (!player || !player.alive) return null;
  return { x: player.group.position.x, z: player.group.position.z, chase: 45, pull: 25, rN: 24, rF: 44 };
}
/* 指挥直追目的地:锚点回拉 pull(停在带内沿附近);0.3s 一拍=持续逼近(火控层不得改写) */
function sqCmdDest(t, anc, tp) {
  var A = t.ai, dx = anc.x - tp.x, dz = anc.z - tp.z, d = Math.sqrt((dx)*(dx)+(dz)*(dz)) || 1;
  A.mode = 'guard';
  A.destX = clamp(anc.x - dx / d * anc.pull, -CONF.bounds + 10, CONF.bounds - 10);
  A.destZ = clamp(anc.z - dz / d * anc.pull, -CONF.bounds + 10, CONF.bounds - 10);
  A.destT = 0.3;
}
var sqCmd = { active: false, group: null, team: null, order: 'follow', ox: 0, oz: 0 };
var SQ_FLAG_RED = 0xd43a25, SQ_FLAG_BLUE = 0x1f5fd6;   // 占领旗色:红方(red)红/蓝方(blue)蓝(与 winfo 兵力色同源)
function SQ_FLAG_COLOR(team) { return team === 'blue' ? SQ_FLAG_BLUE : SQ_FLAG_RED; }
var _sqFlagMat = null, _sqFlagEdge = null, _sqFlagMesh = null, _sqPoleMesh = null, _sqFlagGroup = null;
function sqCmdFlagSync() {                          // 事件级:占领旗显隐/落位(红方红旗/蓝方蓝旗)
  var show = sqCmd.active && sqCmd.order === 'occupy';
  if (show) {
    if (!_sqFlagGroup) {                            // 一次建:三明治三角旗(中央墨衬 z=0+前后队色面 z=±0.03)+细杆,全静态件
      /* 墨衬与彩面分平面(z 相差 0.03):共面双三角会深度冲突,黑色外衬逐像素盖掉彩色面=整旗全黑;
         分层后任一侧视角都看到彩面+四周墨边描线(漫画读感),对数深度下 3cm 间隔远距无冲突。 */
      _sqFlagGroup = new THREE.Group();
      _sqFlagMat = new THREE.MeshBasicMaterial({ color: 0xd43a25, side: THREE.DoubleSide });
      _sqFlagEdge = new THREE.MeshBasicMaterial({ color: 0x141414, side: THREE.DoubleSide });
      var s = 1.09;                                 // 墨衬放大约 0.15m=墨描边读感(旗尖/旗脚同步外扩)
      var big = new THREE.BufferGeometry();
      big.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.02, 3.19, 0, 1.78, 2.66, 0, -0.02, 2.66, 0]), 3));
      big.setIndex([0, 1, 2]);
      _sqFlagGroup.add(new THREE.Mesh(big, _sqFlagEdge));
      var fz = 0.03, tri;
      tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 3.1, fz, 1.55, 2.75, fz, 0, 2.75, fz]), 3));
      tri.setIndex([0, 1, 2]);
      _sqFlagGroup.add(new THREE.Mesh(tri, _sqFlagMat));
      tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 3.1, -fz, 1.55, 2.75, -fz, 0, 2.75, -fz]), 3));
      tri.setIndex([0, 1, 2]);
      _sqFlagMesh = new THREE.Mesh(tri, _sqFlagMat);
      _sqFlagGroup.add(_sqFlagMesh);
      _sqPoleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6), _sqFlagEdge);
      _sqPoleMesh.position.y = 1.6;
      _sqFlagGroup.add(_sqPoleMesh);
      if (typeof scene !== 'undefined' && scene) scene.add(_sqFlagGroup);
    }
    _sqFlagMat.color.setHex(SQ_FLAG_COLOR(sqCmd.team));   // 红方(red)红旗/蓝方(blue)蓝旗
    _sqFlagGroup.position.set(sqCmd.ox, typeof terrainH === 'function' ? terrainH(sqCmd.ox, sqCmd.oz) : 0, sqCmd.oz);
    _sqFlagGroup.visible = true;
  } else if (_sqFlagGroup) _sqFlagGroup.visible = false;
}
/* 占领旗面向相机(每帧一次 atan2;隐藏态单布尔早退——三角旗平面朝 ±Z,不随视角旋转则侧视只剩薄片=黑线) */
function sqFlagTick() {
  if (_sqFlagGroup && _sqFlagGroup.visible && typeof camera !== 'undefined' && camera)
    _sqFlagGroup.rotation.y = Math.atan2(camera.position.x - _sqFlagGroup.position.x, camera.position.z - _sqFlagGroup.position.z);
}
function sqCmdOrderSet(kind, x, z) {                // 指令入口(Q/E 键与触控键共用):follow=撤销占领点收旗;occupy=落点占领
  if (!sqCmd.active) return false;
  if (kind === 'occupy') {
    sqCmd.order = 'occupy';
    sqCmd.ox = clamp(x, -CONF.bounds + 10, CONF.bounds - 10);
    sqCmd.oz = clamp(z, -CONF.bounds + 10, CONF.bounds - 10);
    if (typeof addLog === 'function') addLog('<b>小队：夺取</b>', 'good');
  } else {
    sqCmd.order = 'follow';
    if (typeof addLog === 'function') addLog('<b>小队：跟随</b>', 'good');
  }
  sqCmdFlagSync();
  if (typeof window !== 'undefined' && window._touchUISync) window._touchUISync();   // 触控指令键点亮态即时随动
  return true;
}
function sqCmdPick() {                                   // 距玩家最近己方指挥组(存活质心距离;进入时一次性 O(组×4))
  if (!player || !player.alive) return null;
  var pre = player.team + '|', best = null, bd = 1e18, key, c, i, j, g, n, cx, cz, pp = player.group.position;
  for (key in commanders) {
    if (key.lastIndexOf(pre, 0) !== 0) continue;
    c = commanders[key];
    for (i = 0; i < c.groups.length; i++) {
      g = c.groups[i]; n = 0; cx = 0; cz = 0;
      for (j = 0; j < g.members.length; j++) {
        var m = g.members[j];
        if (!m.alive) continue;
        n++; cx += m.group.position.x; cz += m.group.position.z;
      }
      if (!n) continue;
      cx /= n; cz /= n;
      var d2 = (cx - pp.x) * (cx - pp.x) + (cz - pp.z) * (cz - pp.z);
      if (d2 < bd) { bd = d2; best = g; }
    }
  }
  return best;
}
function sqCmdEnter() {
  if (isFfaMode() || sqCmd.active || !player || !player.alive || gameState !== 'playing') return;
  var g = sqCmdPick();
  if (!g) { if (typeof addLog === 'function') addLog('无可用小队', 'warn'); return; }
  var ix = g._c.groups.indexOf(g);
  if (ix >= 0) g._c.groups.splice(ix, 1);               // 离开指挥部:决策/评分/重分组不再触及
  g.dOut.fill(0); g.dIn.fill(0);                        // 分数清零
  g.shots = 0; g.hits = 0; g.rangeMul = 1;
  g.role = 'guard'; g.protectGroup = { members: [player] };   // 跟随玩家(复用护卫跟随,决策期节奏非帧级)
  g._detached = true;
  sqCmd.active = true; sqCmd.group = g; sqCmd.team = player.team;
  sqCmd.order = 'follow'; sqCmdFlagSync();            // 新指挥会话指令复位为跟随(无占领点)
  if (typeof tacSyncToCmd === 'function') tacSyncToCmd();   // 进入指挥模式→战术标识同步开
  if (typeof window !== 'undefined' && window._touchUISync) window._touchUISync();   // 触控指令键(占领/跟随)即时出现
  if (typeof addLog === 'function') addLog('<b>小队指挥</b>', 'good');
}
function sqCmdExit() {
  if (!sqCmd.active) return;
  var g = sqCmd.group, mem = g.members.slice(), i;
  sqCmd.active = false; sqCmd.group = null; sqCmd.team = null;
  sqCmd.order = 'follow'; sqCmdFlagSync();            // 退出收旗(跟随态无旗帜)
  if (typeof tacForceOff === 'function') tacForceOff();    // 退出指挥模式→战术标识按T开关决定去留(死亡/手动/覆没同)
  if (typeof window !== 'undefined' && window._touchUISync) window._touchUISync();   // 触控指令键即时消失
  g._detached = false; g.protectGroup = null;
  for (i = 0; i < mem.length; i++) mem[i]._cmdG = null;   // 脱离接管组(组不在 c.groups,空组注销路径天然安全)
  for (i = 0; i < mem.length; i++) cmdAssign(mem[i]);     // 重新编入:最近不满员小组/新建(重新部署算法)
  if (typeof addLog === 'function') addLog('<b>已返回本车</b>', 'good');
}
function sqCmdToggle() { if (sqCmd.active) sqCmdExit(); else sqCmdEnter(); }
function sqCmdReset() {
  sqCmd.active = false; sqCmd.group = null; sqCmd.team = null; sqCmd.order = 'follow'; sqCmdFlagSync();
  if (typeof tacBattleReset === 'function') tacBattleReset();    // 开局重置/换场战术标识复位
}
function sqCmdNotifyDeath(t) {                           // 死亡事件钩子(combat.js 击毁路径调用):玩家亡/接管组全灭→自动退出
  if (!sqCmd.active) return;
  if (t.isPlayer) { sqCmdExit(); return; }
  if (sqCmd.group && !sqCmd.group.members.length) sqCmdExit();
}
/* 组级命中率分类:样本 ≥ CMD_AIM_MIN_SHOTS 且命中率 < CMD_AIM_HR = 低命中率组(进攻命令+双分计分) */
function cmdAimPoor(g) {
  return g.shots >= CMD_AIM_MIN_SHOTS && g.hits / g.shots < CMD_AIM_HR;
}
/* 组级决策得分——迂回/护卫配额评分:
   高命中率组(样本≥4 且命中率≥50%):只计受伤得分(-ΣdIn),决策不考虑伤害输出(保守降低损失);
   其余(低命中率组 / 样本不足):伤害+受伤同计(ΣdOut-ΣdIn),进攻净贡献(低命中率组以积极进攻弥补)。 */
function gScore(g) {
  var dOut = 0, dIn = 0;
  for (var b = 0; b < DYN_NB; b++) { dOut += g.dOut[b]; dIn += g.dIn[b]; }
  if (g.shots >= CMD_AIM_MIN_SHOTS && g.hits / g.shots >= CMD_AIM_HR) return -dIn;
  return dOut - dIn;
}
/* Evaluate cached group accuracy before regrouping and shorten range for poor groups.
   命中敌方活车即计(击穿/未击穿、有无伤害同分;火箭炮/玩家无组不计,记账见 weapons.js fireShell/stepShells);
   命中率 < CMD_AIM_HR 且样本 ≥ CMD_AIM_MIN_SHOTS 的组列入拉近距离名单(质心坐标);
   cmdAimApply 在重划后按质心就近(CMD_AIM_CLOSE)把缩小乘数 CMD_AIM_RANGE_MUL 授给继承组;
   命中率回升 ≥50% 的组下次决策自然豁免(新决策不吃命中率,无持久惩罚)。 */
function gAimMul(t) { var g = t._cmdG; return (g && g.rangeMul) || 1; }   // 组级命中率决策乘数(低命中率组缩最大作战距离;无组/无乘数=1)
function cmdAimScan(c) {
  var out = [], i, g, j;
  for (i = 0; i < c.groups.length; i++) {
    g = c.groups[i];
    if (!cmdAimPoor(g) || !g.members.length) continue;
    var cx = 0, cz = 0;
    for (j = 0; j < g.members.length; j++) { cx += g.members[j].group.position.x; cz += g.members[j].group.position.z; }
    out.push({ x: cx / g.members.length, z: cz / g.members.length });
  }
  return out;
}
function cmdAimApply(c, poor) {
  if (!poor || !poor.length) return;
  var i, j, g, cx, cz, m;
  for (i = 0; i < c.groups.length; i++) {
    g = c.groups[i];
    if (!g.members.length) continue;
    cx = 0; cz = 0;
    for (j = 0; j < g.members.length; j++) { cx += g.members[j].group.position.x; cz += g.members[j].group.position.z; }
    cx /= g.members.length; cz /= g.members.length;
    for (m = 0; m < poor.length; m++) {
      if (Math.sqrt((cx - poor[m].x)*(cx - poor[m].x)+(cz - poor[m].z)*(cz - poor[m].z)) < CMD_AIM_CLOSE) { g.rangeMul = CMD_AIM_RANGE_MUL; break; }
    }
  }
}
/* 决策期威胁缓存:敌方高威胁 / 己方高威胁(护卫对象) / 最前方敌人坐标 / 本型号交火底线。
   每指挥官每次 cmdDecide 计算一次;消耗端(士兵层)只读缓存。
   最前方敌人 = 敌方正面小组平均坐标中最靠我方者(投影符号 = 己方 home 方向符号,
   与 flankWP 的 hs 同构;max 取最靠我方 = 最接近己方大本营者)。 */
function cmdThreatUpdate(c) {
  var team = c.key.split('|')[0], ownModel = c.key.split('|')[1];
  var key, i, g, mk;
  /* 1) 敌方高威胁:全队(己方各指挥官)按攻击方型号累计受伤量(指挥官级账,不随组重建/阵亡丢失)
          ÷ 该型号此刻存活数,最大者 */
  var dmgBy = {};
  for (key in commanders) {
    if (key.indexOf(team + '|') !== 0) continue;
    var cc = commanders[key];
    if (!cc.dmgBySrc) continue;
    for (mk in cc.dmgBySrc) dmgBy[mk] = (dmgBy[mk] || 0) + cc.dmgBySrc[mk];
  }
  c.blueHT = null;
  var best = 0;
  for (mk in dmgBy) {
    var aliveN = 0, u;
    for (i = 0; i < aliveList.length; i++) { u = aliveList[i]; if (u.alive && dynModelKey(u) === mk) aliveN++; }  // 存活按型号全图数(键已含阵营语义)
    if (aliveN <= 0) continue;
    var sc = dmgBy[mk] / aliveN;
    if (sc > best) { best = sc; c.blueHT = mk; }
  }
  /* 2) 己方高威胁(护卫保护对象):己方各型号"总造伤(指挥官级账)÷ 此刻存活数"最大者 */
  c.ownHT = null;
  var dmgOutBy = {}, best2 = 0;
  for (key in commanders) {
    if (key.indexOf(team + '|') !== 0) continue;
    var m3 = key.split('|')[1], cc3 = commanders[key];
    dmgOutBy[m3] = (dmgOutBy[m3] || 0) + (cc3.dmgDealt || 0);
  }
  for (mk in dmgOutBy) {
    var aliveN2 = 0, u2;
    for (i = 0; i < aliveList.length; i++) { u2 = aliveList[i]; if (u2.alive && dynModelKey(u2) === mk) aliveN2++; }
    if (aliveN2 <= 0) continue;
    var sc2 = dmgOutBy[mk] / aliveN2;
    if (sc2 > best2) { best2 = sc2; c.ownHT = mk; }
  }
  /* 3) 交火底线:本型号最远战斗距离(散布圆=2×高威胁目标正面投影面积);无高威胁 → 0=不约束 */
  c.floorDist = 0;
  if (c.blueHT && VEHICLE_FRONTAL_AREAS[c.blueHT]) c.floorDist = maxCombatDist(ownModel, VEHICLE_FRONTAL_AREAS[c.blueHT]);
}
/* Decision: aggregate scores, update threats, regroup, assign flank/guard roles, and reset timers.
      ④外翼派迂回(同组同侧)+就近派护卫 ⑤计时复位 */
function cmdDecide(c) {
  var i, g;
  var fn = 0, fS = 0, kn = 0, kS = 0, gn = 0, gS = 0;
  for (i = 0; i < c.groups.length; i++) {
    g = c.groups[i];
    // High-accuracy groups optimize incoming damage; others optimize net damage.
    if (g.role === 'flank') { kn++; kS += gScore(g); }
    else if (g.role === 'guard') { gn++; gS += gScore(g); }
    else { fn++; fS += gScore(g); }
  }
  var Sf = kn ? kS / kn : 0, Sn = fn ? fS / fn : 0, Sg = gn ? gS / gn : 0;
  cmdThreatUpdate(c);                                       // 高威胁/交火底线(决策期一次)
  var nOld = c.groups.length;
  /* —— 护卫配额:护卫小组分数 Sg 与己方高威胁型号整体分数 H 加权(通用分配算法内联) —— */
  var wantG = 0, H = 0;
  if (c.ownHT) {
    var cHT = commanders[c.key.split('|')[0] + '|' + c.ownHT];
    if (cHT && cHT.groups.length) {
      var hSum = 0;
      for (i = 0; i < cHT.groups.length; i++) hSum += gScore(cHT.groups[i]);   // 护卫对象型号分(同吃 gScore 双态计分)
      H = hSum / cHT.groups.length;
    }
    wantG = Math.round(nOld * clamp(0.10 + 0.12 * clamp(Sg / 40, -1, 1) + 0.18 * clamp(H / 40, -1, 1), 0, 0.30));
  }
  /* —— 迂回配额(原公式,上限扣除护卫) —— */
  var want;
  if (c.decisions === 0) want = Math.round(nOld * 0.2);                     // First decision: start with 20% flank allocation.
  else want = Math.round(Math.max(kn, 1) * (1 + (Sf - Sn) / Math.max(Math.abs(Sn), 20)));
  var minF = nOld >= 10 ? Math.ceil(nOld / 10) : 0;                          // 下限 1/10;<10 组解锁 0
  var maxF = Math.max(minF, Math.floor((nOld - wantG) / 2));                 // 上限 1/2 扣除护卫
  want = clamp(want, minF, maxF);
  var aimPoor = cmdAimScan(c);      // Evaluate accuracy before regrouping; poor groups receive a closer range.
  cmdSplit(c);
  cmdAimApply(c, aimPoor);          // ②重划后按质心继承授予 rangeMul(回升 ≥50% 的组自动豁免,新决策不受命中率影响)
  var team = c.key.split('|')[0];
  var foe = clusterOf(team === 'red' ? 'blue' : 'red');
  tacDensRebuild(team);            // 敌密度叠加场重建(2s 门去重;走廊/阵地格/后续思考节拍消费)
  var order = c.groups.slice().sort(function (a, b2) {
    return Math.abs(b2.members[0].group.position.x - foe.ex) - Math.abs(a.members[0].group.position.x - foe.ex);
  });
  /* 预防性走廊分配(方案C主机制):front 组按序号等距铺满横向 ±650(±25m 抖动),
     组与组横向错开接敌——从源头杜绝全体正面组压向同一目标点的中线扎堆。
     外翼组先选做 flank(order 降序),余下 front 组再分走廊。 */
  var nF = 0, fi = 0;
  for (i = 0; i < order.length; i++) if (order[i].role !== 'flank') nF++;
  for (i = 0; i < order.length; i++) {
    g = order[i];
    if (i < want) {
      g.role = 'flank';
      var gx = g.members[0].group.position.x - foe.ex;
      g.side = Math.abs(gx) > 50 ? (gx > 0 ? 1 : -1) : ((i % 2) * 2 - 1);    // 外翼顺势分边,中线交替
    } else {
      g.role = 'front';
      /* 战术加权走廊:等距槽中心±0.3 槽宽内三候选,按中场/前压半场两采样点朝敌扇区分取优;
         保留 ±25m 抖动(防走廊完全确定化) */
      var lx0 = -650 + (fi + 0.5) / nF * 1300, sw3 = (1300 / nF) * 0.3, bLx = lx0, bLs = -1;
      for (var lc = -1; lc <= 1; lc++) {
        var cand = lx0 + lc * sw3;
        var zA = 0, zB = foe.ez * 0.5;
        var scL = tacScoreAt(cand, zA, tacSector(foe.ex - cand, foe.ez - zA), team)
                + tacScoreAt(cand, zB, tacSector(foe.ex - cand, foe.ez - zB), team);
        if (scL > bLs) { bLs = scL; bLx = cand; }
      }
      g.laneX = clamp(bLx + rand(-25, 25), -780, 780);
      fi++;
    }
  }
  /* —— 控制区区域权重:空控制区 > 敌方控制区 > 非控制区空地 > 己方控制区。
     This is a commander destination input only; it never reads or writes sqCmd's player squad flag. */
  if (typeof controlZoneAiChooseTarget === 'function') {
    for (i = 0; i < c.groups.length; i++) {
      g = c.groups[i];
      g._controlTarget = null;
      if ((g.role !== 'front' && g.role !== 'flank') || !g.members.length) continue;
      var gcx = 0, gcz = 0;
      for (var gmi = 0; gmi < g.members.length; gmi++) { gcx += g.members[gmi].group.position.x; gcz += g.members[gmi].group.position.z; }
      gcx /= g.members.length; gcz /= g.members.length;
      g._controlTarget = controlZoneAiChooseTarget(team, gcx, gcz);
    }
  }
  /* —— 护卫指派:余下组中离己方高威胁小组质心最近者,绑定被保护小组 —— */
  if (wantG > 0 && c.ownHT) {
    var cHT2 = commanders[team + '|' + c.ownHT];
    if (cHT2 && cHT2.groups.length) {
      var htc = [], hg, hcx, hcz, hi;
      for (i = 0; i < cHT2.groups.length; i++) {
        hg = cHT2.groups[i];
        if (!hg.members.length) continue;
        hcx = 0; hcz = 0;
        for (hi = 0; hi < hg.members.length; hi++) { hcx += hg.members[hi].group.position.x; hcz += hg.members[hi].group.position.z; }
        htc.push({ g: hg, x: hcx / hg.members.length, z: hcz / hg.members.length });
      }
      if (htc.length) {
        var rest = [];
        for (i = want; i < order.length; i++) rest.push(order[i]);
        rest.sort(function (a, b2) {
          var da = 1e18, db2 = 1e18, ia;
          for (ia = 0; ia < htc.length; ia++) {
            var dxa = a.members[0].group.position.x - htc[ia].x, dza = a.members[0].group.position.z - htc[ia].z;
            da = Math.min(da, dxa * dxa + dza * dza);
            var dxb = b2.members[0].group.position.x - htc[ia].x, dzb = b2.members[0].group.position.z - htc[ia].z;
            db2 = Math.min(db2, dxb * dxb + dzb * dzb);
          }
          return da - db2;
        });
        for (i = 0; i < rest.length && i < wantG; i++) {
          g = rest[i];
          if (g.rangeMul < 1) continue;                 // 低命中率组=进攻命令,不承担护卫(防守)任务
          g.role = 'guard';
          var bd = 1e18, bgh = htc[0].g;
          for (var ib = 0; ib < htc.length; ib++) {
            var dxc = g.members[0].group.position.x - htc[ib].x, dzc = g.members[0].group.position.z - htc[ib].z;
            var d2c = dxc * dxc + dzc * dzc;
            if (d2c < bd) { bd = d2c; bgh = htc[ib].g; }
          }
          g.protectGroup = bgh;
          g.side = 1;
        }
      }
    }
  }
  /* —— 组阵地格:front 组质心→敌方向交火底线距离处,3×3 邻域朝敌最高分格(决策期一次;
     士兵层 advance 目的地向阵地格保守偏置,见 advance 分支) —— */
  for (i = 0; i < c.groups.length; i++) {
    g = c.groups[i];
    if (g.role !== 'front' || !g.members.length) { g._postX = null; continue; }
    var gpcX = 0, gpcZ = 0, gm2;
    for (gm2 = 0; gm2 < g.members.length; gm2++) { gpcX += g.members[gm2].group.position.x; gpcZ += g.members[gm2].group.position.z; }
    gpcX /= g.members.length; gpcZ /= g.members.length;
    var pdD = clamp(c.floorDist || 450, 250, 700);
    var pdx = foe.ex - gpcX, pdz = foe.ez - gpcZ, pdl = Math.sqrt((pdx)*(pdx)+(pdz)*(pdz)) || 1;
    var adv2 = Math.max(0, pdl - pdD);
    var tbP = tacBestNear(gpcX + pdx / pdl * adv2, gpcZ + pdz / pdl * adv2, foe.ex, foe.ez, team);
    g._postX = tbP.x; g._postZ = tbP.z;
  }
  /* —— 战术标识意图(comic.js 战术标消费;纯视觉字段,决策期一次写入,AI 行为零读取) ——
     意图 g._intent:0进攻(front)/1撤退(front 且组均结构<40%,决策期快照)/2保持(guard 驻守)/3迂回(flank)。 */
  for (i = 0; i < c.groups.length; i++) {
    g = c.groups[i];
    var stS = 0, stM = g.members.length, mi2;
    for (mi2 = 0; mi2 < stM; mi2++) stS += g.members[mi2].struct / Math.max(1, g.members[mi2].structMax);
    g._intent = g.role === 'flank' ? 3 : g.role === 'guard' ? 2 : (stM && stS / stM < 0.4) ? 1 : 0;
  }
  c.decisions++;
  c.nextT = gameT + CMD_INTERVAL;
}
/* 区域密度桶(200m 固定粒度):惰性按边长建表;1Hz 共享扫描(6 指挥官共用一次,复用 aliveList) */
function densBucket(x, z) {
  var ix = Math.floor((x + MAP.half) / DENS_CELL), iz = Math.floor((z + MAP.half) / DENS_CELL);
  if (ix < 0) ix = 0; else if (ix >= _densN) ix = _densN - 1;
  if (iz < 0) iz = 0; else if (iz >= _densN) iz = _densN - 1;
  return iz * _densN + ix;
}
function densityScan() {
  if (gameT - _densT < 1) return; _densT = gameT;        // 1s 节流(与 cmdTick 同频,双保险)
  var n = Math.ceil(MAP.side / DENS_CELL);
  if (n !== _densN) { _densN = n; _densF = new Int32Array(n * n); _densE = new Int32Array(n * n); _densW = new Int32Array(n * n); }
  _densF.fill(0); _densE.fill(0); _densW.fill(0);
  var i;
  for (i = 0; i < aliveList.length; i++) {
    var t = aliveList[i];
    if (t.isPlayer) continue;                            // 玩家自由度不约束 AI 走廊
    if (isHeliVehicle(t)) continue;                      // 直升机不占地面通行密度(空中盘旋不阻塞地面走廊,也不该被误判为"此处自己人多")
    var b = densBucket(t.group.position.x, t.group.position.z);
    if (t.team === 'red') _densF[b]++; else _densE[b]++;
  }
  for (i = 0; i < wreckList.length; i++)                 // 残骸密度(指挥官决策/迂回车道共用;~360 迭代,零感知)
    _densW[densBucket(wreckList[i].group.position.x, wreckList[i].group.position.z)]++;
}
/* 区域稀疏度评分(weakSector/sparseZone 共用):自己人×4 优先避让,敌军×2,残骸×W_WRECK;
   分数越低=越稀疏/越薄弱(敌重兵区由调用方另行过滤)。 */
function sectorScore(mineN, foeN, wreckN) {
  return foeN * 2 + mineN * 4 + (wreckN || 0) * W_WRECK;
}
/* 该队视角最稀疏安全区:自己人少优先(×4),敌军不多(×2),敌重兵区(>DENS_OPP_MAX)不去。
   返回桶中心坐标;消费端只取横向 x 作走廊(纵深仍由交火底线决定)。
   (与 weakSector 分工:sparseZone=全图最稀疏点[front 过密重定向],weakSector=敌方战线带内突破口[flank 战略包抄]) */
function sparseZone(team) {
  if (!_densN) return null;
  var mine = team === 'red' ? _densF : _densE, foe = team === 'red' ? _densE : _densF;
  var best = -1, bsc = 1e18;
  for (var b = 0; b < _densN * _densN; b++) {
    if (foe[b] > DENS_OPP_MAX) continue;               // 敌重兵区不去
    var sc = sectorScore(mine[b], foe[b], _densW ? _densW[b] : 0);
    if (sc < bsc) { bsc = sc; best = b; }
  }
  if (best < 0) return null;
  return { x: -MAP.half + ((best % _densN) + 0.5) * DENS_CELL,
           z: -MAP.half + (((best / _densN) | 0) + 0.5) * DENS_CELL };
}
/* 1Hz tick:成员维护+每秒净分采样+断崖紧急决策+周期决策 */
function cmdTick() {
  /* 个人死斗不运行指挥官的编组、密度评估、角色分配和决策账本。 */
  if (isFfaMode()) return;
  densityScan();                                        // 密度桶共享扫描(1Hz 节流)
  var key, c, i, j, g, m;
  for (key in commanders) {
    c = commanders[key];
    for (i = c.groups.length - 1; i >= 0; i--) {                 // 注销空组(死亡离组主走 cmdLeave,此处兜底)
      g = c.groups[i];
      for (j = g.members.length - 1; j >= 0; j--) {
        m = g.members[j];
        if (!m.alive || m.isPlayer) g.members.splice(j, 1);
      }
      if (!g.members.length) c.groups.splice(i, 1);
    }
    c.ring[c.ringI] = c.secAcc; c.secAcc = 0;                    // 每秒净分入环
    c.ringI = (c.ringI + 1) % 60; c.ringN = Math.min(60, c.ringN + 1);
    if (gameT >= c.nextT) { cmdDecide(c); continue; }     // 决策日已重分走廊,跳过密度重定向
    if (gameT > CMD_EMERG_UNLOCK && c.ringN >= 40) {             // 紧急决策:近 8s 均值跌破前 30s 基线 CMD_CLIFF
      var s8 = 0, s30 = 0, k2;
      for (k2 = 1; k2 <= 8; k2++) s8 += c.ring[(c.ringI - k2 + 60) % 60];
      for (k2 = 9; k2 <= 38; k2++) s30 += c.ring[(c.ringI - k2 + 60) % 60];
      if (s8 / 8 < s30 / 30 - CMD_CLIFF) cmdDecide(c);     // 立即决策(断崖)+重新计 60s
    }
    /* 区域密度重定向(方案C兜底):本队过密区(≥DENS_MAX)的 front 组走廊 →
       最稀疏安全区横向;30s 冷却防振荡。只改 laneX,不改角色/纵深。 */
    var teamD = c.key.split('|')[0], mineD = teamD === 'red' ? _densF : _densE;
    for (i = 0; i < c.groups.length; i++) {
      g = c.groups[i];
      if (g.role !== 'front' || !g.members.length || gameT - g.densT < DENS_COOLDOWN) continue;
      var gm = g.members[0].group.position;
      if (mineD[densBucket(gm.x, gm.z)] >= DENS_MAX) {
        var sp = sparseZone(teamD);
        if (sp) { g.laneX = clamp(sp.x, -780, 780); g.densT = gameT; }
      }
    }
  }
}

/* ===== 02r 后坐炮口上抬(玩家/AI 同机理):开火后炮管被后坐力矩掀起,稳定器/伺服装回原瞄准线 ——
   复用 recT 时钟:0.05s 快起到峰(坦克 2.29°/歼击车 2.75°),τ0.9s 回落 ~2s 归零,
   叠加稳定器小摆(3.1Hz 衰减)= 准星"晃后复位"的来源;挂上抬在瞄准伺服目标,不碰弹道解算与开火当帧(kick(0)=0)。 ===== */
function recPitchK(t) {
  if (!t || t.recT == null || t.recT < 0 || t.kind === 'arty') return 0;
  var isHeli = isHeliVehicle(t) || t.kind === 'aa';   // AA 机炮上抬=直升机小摆档(蓝方防空车不开炮,无副作用)
  var maxT = isHeli ? 0.15 : 2.0;
  var u = t.recT; if (u > maxT) return 0;
  if (isHeli) {
    var baseH = u < 0.015 ? u / 0.015 : Math.exp(-(u - 0.015) / 0.04);
    var fadeH = u > 0.10 ? (0.15 - u) / 0.05 : 1;
    return 0.004 * baseH * fadeH;
  }
  var base = u < 0.05 ? u / 0.05 : Math.exp(-(u - 0.05) / 0.9);
  var fade = u > 1.6 ? (2.0 - u) / 0.4 : 1;              // 软着陆:末 0.4s 线性补零,回收 recT 终态处零阶跃
  var K = isTD89Vehicle(t) ? 0.048 : 0.040;
  return K * base * fade * (1 + 0.18 * Math.sin(19.5 * u) * Math.exp(-u / 0.35));
}

