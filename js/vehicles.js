
var _tankUniqueSeq = 1;
/* ===== Module: vehicles.js ===== */
/* ============================================================
   模块: vehicles.js — 载具:坦克/歼击车/火箭炮视觉建模 + 模块命中壳(最大模块)
   (加载顺序由 index.html MODULES 表决定,勿单独调整)
   ============================================================ */
'use strict';
/* ============================================================
   坦克构建(视觉模型 + 模块碰撞盒)
   局部坐标: +Z 为车头方向, +Y 向上
   ============================================================ */

/* ===== 平滑环带履带(圆角环带;实心梯形截面棱柱硬折角不达标):截面=z-y 平面圆角矩形环(带厚 T),
   外壁沿周长贴履带板纹路(u=弧长/2P 绕卷,v 横跨带宽=板面),内壁/侧环面走画集平坦区;带厚间中空=
   负重轮/端轮自环带侧开口真实可见(侧视图读感);绕向逐面叉积自动校正(与 prismGeo 同法) ===== */
/* ===== 端轮抬高内收+斜边内收下行+连接杆收纳(低鼓外悬/斜边外撇/杆出包络均不成立):
   导向轮 (2.32,0.49)→(2.28,0.62)/主动轮 (-2.32,0.49)→(-2.30,0.60,低于导向轮 0.02=传动轮下沉);
   带中心线=filleted 四边形:双鼓包绕弧=以轮心为圆心的公切圆(顶边/斜边公切线解析:t=0.7166/0.6592,
   弧心实测 (2.2793,0.6197)/(-2.2989,0.5980)≈轮心 ±0.002),顶边 0.5° 微后倾随主动轮下沉,底边贴地斜足
   内收(底端 2.121/−2.132=轮1前缘 2.01/轮5后缘 −2.04 外 0.11/0.09);弧密 0.12 直段 0.25 ===== */
var TRACK_POLY = [   // 带中心线轮廓 (z,y):顶带 ≈0.95 微后倾/底 -0.1125(轮系下沉:底行随轮降0.1625;板厚0.05→外壁 ≈0.975/-0.1375,整车抬T59_LIFT贴地)
  [2.993, 0.956], // 前上角(绕导向轮 (2.28,0.62) 弧:R0.33=轮缘 0.28+内缩 0.05 全包鼓轮,顶边/前斜公切)
  [2.233, -0.1125],  // 前底角(斜足内收下行,底端切点 (2.121,-0.1125))
  [-2.244, -0.1125], // 后底角(底端切点 (-2.132,-0.1125))
  [-2.960, 0.904]];// 后上角(绕主动轮 (-2.30,0.60) 弧:R0.31=轮缘 0.26+0.05)
var TRACK_FILLET = [0.33, 0.24, 0.24, 0.31];   // 旧59带型圆角(现59视觉走trackLoop59物理环,此仅作trackRingGeo缺省回退保留)
var T59_LIFT = 0.1375;   // 59轮系下沉后的整车抬升量=履带板外底-0.1375→贴地(出生点/车库叠加,仅RED_MBT_1;车体相对几何全保留)
var T99_LIFT = 0.12, TD89_LIFT = 0.052, M1_LIFT = 0.056, M60_LIFT = 0.05;

/* ===== 扭杆悬挂·全履带车型规格表(2026-09-09)=============================
   五车型统一使用 59 式同款简化扭杆模型:摆臂长 L、静止摆角 φ0 全车通用,
   仅站位 z、轮心高、轮盘半径、履带中心 x、摆向逐车定制。
     armL  = √(0.193² + 0.307²) = 0.36263  (臂在铰点系的静止投影 dz=0.193 / dy=0.307)
     φ0    = atan2(0.193, 0.307) = 32.16°  (自铅垂线量起,φ↑ = 轮上行压缩)
     pivY  = 轮心 y + 0.307                (铰点高,保证 φ0 处轮心恰在建模位)
   fdir 摆向:-1 = 臂朝后(轮在铰点前) / +1 = 臂朝前(轮在铰点后)。
     59  第一对朝后,其余朝前          (真车:1 号轮平衡肘反向)
     89  第一对朝后,其余朝前          (与 59 同构)
     99  前两对朝后,后四对朝前
     M1  全部朝前
     M60 全部朝前
   suspKey(t) 由 team|kind 映射到本表;非履带车(arty/heli)返回 null = 无悬挂。 */
/* BLUE-MBT-2 narrows the entire running gear in X after the model is built. Keep
   the authored/model coordinate separate from the physics/world coordinate so
   suspension rays and dynamic tread paths land on the rendered road wheels. */
var M1_TRACK_X_SCALE = 0.84;
var SUSP_SPEC = {
  t59:  { n: 5, wz: [1.635, 0.735, -0.065, -0.865, -1.665],                 wy: 0.2875, rimR: 0.375, trkX: 1.24, hullX: 0.95,
          fdir: [-1, 1, 1, 1, 1],          lift: T59_LIFT,  loop: 'trackLoop59' },
  t99:  { n: 6, wz: [1.635, 0.875, 0.115, -0.645, -1.405, -2.165],          wy: 0.28,   rimR: 0.35,  trkX: 1.24, hullX: 0.95,
          fdir: [-1, -1, 1, 1, 1, 1],      lift: T99_LIFT,  loop: 'trackLoop99' },
  td89: { n: 6, wz: [1.70, 1.02, 0.34, -0.34, -1.02, -1.70],                wy: 0.333,  rimR: 0.335, trkX: 1.24, hullX: 0.95,
          fdir: [-1, 1, 1, 1, 1, 1],       lift: TD89_LIFT, loop: 'trackLoop89' },
  m1:   { n: 7, wz: [2.04, 1.36, 0.68, 0, -0.68, -1.36, -2.04],             wy: 0.299,  rimR: 0.305, trkX: 1.32, hullX: 1.05,
          fdir: [1, 1, 1, 1, 1, 1, 1],     lift: M1_LIFT,   loop: 'trackLoopM1' },
  m60:  { n: 6, wz: [1.527, 0.759, -0.009, -0.778, -1.546, -2.314],         wy: 0.30,   rimR: 0.30,  trkX: 1.19, hullX: 0.90,
          fdir: [1, 1, 1, 1, 1, 1],        lift: M60_LIFT,  loop: 'trackLoopM60' },
  pgz95:{ n: 6, wz: [1.95, 1.17, 0.39, -0.39, -1.17, -1.95],                wy: 0.40,   rimR: 0.35,  trkX: 1.42, hullX: 1.13,
          fdir: [-1, 1, 1, 1, 1, 1],       lift: 0,         loop: 'trackLoopPGZ' }   // RED_AA(demo 口径:轮距0.78/带底y0贴地/车体几何自带+0.40抬高)
};
SUSP_SPEC.m1.physicsTrkX = SUSP_SPEC.m1.trkX * M1_TRACK_X_SCALE;
var SUSP_ARM_L = Math.hypot(0.193, 0.307);      // 0.36263 摆臂长(全车型统一)
var SUSP_PHI0  = Math.atan2(0.193, 0.307);      // 0.5612rad=32.16° 静止摆角(全车型统一)
var SUSP_RC    = 0.425;                          // 轮心→履带外底距(轮辋 0.375 + 板厚 0.05;59 口径,他车按各自 rimR+0.05 覆写)
function suspKeyOf(team, kind) {                 // team|kind → 规格表键(非履带车返回 null)
  if (kind === 'tank')  return team === 'red' ? 't59' : 'm60';
  if (kind === '99')    return 't99';
  if (kind === 'td')    return team === 'red' ? 'td89' : 'm1';
  if (kind === 'aa')    return team === 'red' ? 'pgz95' : null;   // 红 RED_AA 履带扭杆悬挂;蓝BLUE_AA轮式(无悬挂,轮转子走 arty 同款通道)
  return null;                                   // arty/heli 无扭杆悬挂
}
/* 端轮几何 + 负重轮包络半径:★一律取自各车 trackLoopXX() 的实参(物理环路口径,含板半 0.025),
   不能用建模轮盘半径 —— 否则定长求解器与履带实际路径不同源,解出来的长度是另一条曲线的长度。 */
SUSP_SPEC.t59.envR  = 0.40;  SUSP_SPEC.t59.idlerZ  = 2.28;  SUSP_SPEC.t59.idlerY  = 0.62;  SUSP_SPEC.t59.idlerR  = 0.305;
SUSP_SPEC.t59.sprkZ  = -2.30;  SUSP_SPEC.t59.sprkY  = 0.60;  SUSP_SPEC.t59.sprkR  = 0.285;
SUSP_SPEC.t99.envR  = 0.375; SUSP_SPEC.t99.idlerZ  = 2.28;  SUSP_SPEC.t99.idlerY  = 0.62;  SUSP_SPEC.t99.idlerR  = 0.305;
SUSP_SPEC.t99.sprkZ  = -2.80;  SUSP_SPEC.t99.sprkY  = 0.60;  SUSP_SPEC.t99.sprkR  = 0.285;
SUSP_SPEC.td89.envR = 0.36;  SUSP_SPEC.td89.idlerZ = 2.26;  SUSP_SPEC.td89.idlerY = 0.65;  SUSP_SPEC.td89.idlerR = 0.225;
SUSP_SPEC.td89.sprkZ = -2.26;  SUSP_SPEC.td89.sprkY = 0.62;  SUSP_SPEC.td89.sprkR = 0.225;
SUSP_SPEC.m1.envR   = 0.33;  SUSP_SPEC.m1.idlerZ   = 2.533; SUSP_SPEC.m1.idlerY   = 0.628; SUSP_SPEC.m1.idlerR   = 0.275;
SUSP_SPEC.m1.sprkZ   = -2.48;  SUSP_SPEC.m1.sprkY   = 0.60;  SUSP_SPEC.m1.sprkR   = 0.295;
SUSP_SPEC.m60.envR  = 0.325; SUSP_SPEC.m60.idlerZ  = 1.937; SUSP_SPEC.m60.idlerY  = 0.903; SUSP_SPEC.m60.idlerR  = 0.305;
SUSP_SPEC.m60.sprkZ  = -2.627; SUSP_SPEC.m60.sprkY  = 0.90;  SUSP_SPEC.m60.sprkR  = 0.315;
SUSP_SPEC.pgz95.envR = 0.375; SUSP_SPEC.pgz95.idlerZ = 2.72;  SUSP_SPEC.pgz95.idlerY = 0.90; SUSP_SPEC.pgz95.idlerR = 0.325;
SUSP_SPEC.pgz95.sprkZ = -2.82; SUSP_SPEC.pgz95.sprkY = 0.90; SUSP_SPEC.pgz95.sprkR = 0.325;
/* [2026-09-11 履带拓扑修复] 求解器硬约定:_trkWheelCenters 按「诱导轮(张紧端,δ沿+z外推)→负重轮(z递减)→主动轮」
   拼轮心序列,全车型诱导轮都在前。此前 pgz95 写成后诱导轮 → 序列非单调 → 对局内近距求解器路径的履带包络/切线
   连接错乱(用户报"履带连接方式完全错误")。两端视觉轮盘同构(R0.30+板半0.025),前后角色对调零视觉差异。 */
for (var _sk in SUSP_SPEC) {                     // 派生量:铰点高 / 轮心→履带外底距(各车轮盘半径不同)
  var _sp = SUSP_SPEC[_sk];
  /* 履带接地半长:由首末负重轮站位推导(而非硬编码)。当前 alignTank 已改为按【逐轮位】
     采样求均值,不再需要此值;保留供诊断/测试脚本使用。 */
  _sp.grndHalfLen = (Math.max.apply(null, _sp.wz) - Math.min.apply(null, _sp.wz)) * 0.5 + _sp.rimR * 0.5;
  _sp.pivY = _sp.wy + 0.307;
  _sp.rc   = _sp.rimR + 0.05;
  _sp.sumZ2 = (function (o) { var q = 0; for (var i = 0; i < o.n; i++) q += o.wz[i] * o.wz[i]; return q * 2; })(_sp);
  _sp.sumX2 = 2 * _sp.n * (_sp.physicsTrkX || _sp.trkX) * (_sp.physicsTrkX || _sp.trkX);
}
/* ===== 履带/轮式接地片表(刨土 rim 发射用;由 SUSP_SPEC 派生,零硬编码) ==============
   每履带:左右 x=±trkX, z∈[末站位−0.12, 首站位+0.12];hw=板半宽 0.30(59 真车 580mm)。
   arty:分阵营 3 轴 patches(红 RED_MLRS 轴 z=2.60/−0.30/−1.40;蓝 BLUE_MLRS 轴 z=2.35/−1.55/−2.80,与建模 artyWheel 同源),每轴视为 mini 矩形片复用矩形采样。 */
var TRK_PLATE_HW = 0.30;
var TRK_RIM = {};
var ARTY_RIM_AXLES_OF = { red: [2.60, -0.30, -1.40], blue: [2.35, -1.55, -2.80] };
var ARTY_RIM_X_OF = { red: 1.10, blue: 1.04 };
(function () {
  for (var _rk in SUSP_SPEC) {
    var _rp = SUSP_SPEC[_rk], _z1 = -1e9, _z0 = 1e9;
    for (var _ri = 0; _ri < _rp.wz.length; _ri++) {
      if (_rp.wz[_ri] > _z1) _z1 = _rp.wz[_ri];
      if (_rp.wz[_ri] < _z0) _z0 = _rp.wz[_ri];
    }
    TRK_RIM[_rk] = { x: _rp.physicsTrkX || _rp.trkX, z0: _z0 - 0.12, z1: _z1 + 0.12, hw: TRK_PLATE_HW };
  }
})();
/* ===== 定长履带包络求解器(阶段 1,2026-09-09)==================================
   【要解决的问题】
   旧位移场 suspTrackDisp() 是「逐点函数」d=f(s):每块履带板独立查询自己弧长处的
   位移量,板与板之间没有任何约束。这在数学上无法表达「履带总长恒定」这一全局约束。
   实测(t59,静止环长 11.2799m):
     全轮压缩 25° → ΔL = −114.7mm(−1.02%)
     俯冲前压后伸 → ΔL = +568.3mm(+5.04%)   ← 真实钢制履带弹性极限仅 ±0.1%(11.3mm)
   现象即用户所述:「履带断裂成一块一块拉伸,上段完全无变化」。

   【本求解器的模型】
   把履带视为绕一组圆(负重轮 + 诱导轮 + 主动轮)张紧的【定长闭合皮带】:
     路径 = Σ(相邻轮外公切线段) + Σ(各轮包弧)
     约束 = 路径总长 ≡ L0(常数)
     自由度 = 诱导轮沿张紧方向的位移 δ
   每帧:轮心由悬挂给出 → 解包络 → 若 L≠L0 则二分调 δ → 得严格定长路径。
   这正是真车原理:履带长度固定,张紧轮吸收轮系变形带来的长度差。

   【为什么二分一定收敛】
   pathLen(δ) 对 δ 单调(诱导轮外推 ⇒ 包络变长),故二分无发散风险,不需要牛顿法的
   导数估计,也不会像迭代式约束求解那样出现抖动(Unigine 实测逐板刚体方案会抖)。

   【闭合环恒等式】Σ(各轮包弧转角) ≡ 2π —— 用作求解器自检(assert 级)。 ===== */
var TRK_SOLVE_ITER = 24;              // 二分迭代数(24 次 → δ 精度 ≈ 张紧行程/2^24,μm 级)
/* 诱导轮张紧行程半幅(m)。★这不只是"张紧器能调多少",它同时是【履带长度预算】的调节量:
   轮系交替起伏时,履带要绕过更多凸起 ⇒ 需要更长的路径。行程不够时求解器只能压低柔度 w
   (把底行拉直),后果是抬起的负重轮脱离履带面 —— 视觉上就是「轮子穿过履带板」
   (实测交替 ±18° 时轮离缝 59mm,而板厚仅 50mm,轮盘整个顶穿)。
   实测行程 120→300mm 后:交替 ±18° 离缝 59.2→17.8mm,w 全程保持满值 0.85,
   长度守恒不受影响(误差恒为 0.000mm)。300mm 对 11.3m 环长仅占 2.7%,
   物理上相当于把诱导轮调节范围放宽到真车水平(T-54 张紧器行程约 ±150mm 且带偏心座)。 */
var TRK_TENSION_RANGE = 0.30;         // 缺省值(未派生时回落);实际用 SP.tensRange(按环长比例)
var TRK_TENSION_K = 0.05;             // 张紧行程 / 环长 —— 轮数多、环长大的车需要更大预算(M1 7 轮实测需 5%)
var TRK_ELASTIC = 0.001;              // 履带弹性伸长率上限(真实钢制销接约 0.1%)
var TRK_PATH_CLEARANCE = 0.003;       // 履带内缘与轮缘的数值安全余量(3mm);高分辨率路径负责消除弦线穿轮
var TRK_PATH_MIN_STEP = 0.045;        // 动态环路重采样目标步长(小于板节距,降低圆弧弦切误差)

/* 两圆外公切线:返回下侧(low=true)或上侧切点对。
   与 trackLoopWheels 内 tang() 同式 —— 保持建模期/运行期同源。 */
var _tkT = { p1z: 0, p1y: 0, p2z: 0, p2y: 0, ok: false };   // 切线 scratch(零分配)
function _trkTangent2(c1, r1, c2, r2, low) {
  /* c1/c2 为轮对象 {z,y,r}。结果写入 _tkT(避免每帧数万次对象/数组分配)。 */
  var dz = c2.z - c1.z, dy = c2.y - c1.y, D = Math.hypot(dz, dy);
  if (D < 1e-9) { _tkT.ok = false; return _tkT; }
  var q = (r1 - r2) / D;
  if (q > 1) q = 1; else if (q < -1) q = -1;
  var be = Math.acos(q), uz = dz / D, uy = dy / D;
  var bm = 0, bp1z = 0, bp1y = 0, bp2z = 0, bp2y = 0, has = false;
  for (var sg = -1; sg <= 1; sg += 2) {
    var cb = Math.cos(sg * be), sb = Math.sin(sg * be);
    var nz = uz * cb - uy * sb, ny = uz * sb + uy * cb;
    var az = c1.z + nz * r1, ay = c1.y + ny * r1;
    var bz = c2.z + nz * r2, by = c2.y + ny * r2;
    var mid = ay + by;
    if (!has || (low ? mid < bm : mid > bm)) { bm = mid; bp1z = az; bp1y = ay; bp2z = bz; bp2y = by; has = true; }
  }
  _tkT.p1z = bp1z; _tkT.p1y = bp1y; _tkT.p2z = bp2z; _tkT.p2y = bp2y; _tkT.ok = has;
  return _tkT;
}
/* Diagnostic compatibility wrapper; runtime paths use _trkTangent2 directly. */
function _trkTangent(c1, r1, c2, r2, low) {
  var t = _trkTangent2(c1, r1, c2, r2, low);
  return t.ok ? { p1: [t.p1z, t.p1y], p2: [t.p2z, t.p2y] } : null;
}
/* 给定轮列(前→后有序)求包络。wheels[i] = {z,y,r}。
   拓扑固定(不每帧算凸包,与业界共识一致:真车履带本就跳过陷入包络内的轮):
     底行:首轮→…→末轮 依次下外公切
     后跨:末负重轮 → 主动轮(下公切)
     主动轮包弧 → 顶行(两端轮上公切) → 诱导轮包弧
     前跨:诱导轮 → 首负重轮(下公切)
   返回 {len, turn, nodes};nodes 为控制点序列(阶段 2 上传 GPU 用)。 */
var _tkSegZ1 = new Float64Array(24), _tkSegY1 = new Float64Array(24);   // 切线段 scratch(零分配)
var _tkSegZ2 = new Float64Array(24), _tkSegY2 = new Float64Array(24);
var _tkSegR  = new Float64Array(24);                                     // 该段终点轮半径(包弧用)
var _tkHull  = new Array(16);
var _tkRoad  = [];                                    // 底行等效轮列 scratch(含被跨轮的插值高度)
for (var _tkJ = 0; _tkJ < 16; _tkJ++) _tkRoad.push({ z: 0, y: 0, r: 0 });
/* 底行柔度:1 = 抬起的轮完全把履带顶起(全贴合) / 0 = 凸包基线(底行僵直)。
   ★这是【求解变量】而非常数:履带长度恒定,底行顶起越多总长越长。
   求解器按「先用张紧轮、张紧到底再压柔度」的优先级反解 w(见 trackSolve),
   物理含义 = 张力越大,抬起的轮越顶不动履带 —— 与真车一致。
   TRK_BOTTOM_W_MAX 为常态上限(张紧轮尚有余量时用它,保证底行充分贴合)。 */
/* 取 1.0 = 履带完全贴合每一个负重轮(不留柔度余量)。
   此前取 0.85 是为了让常态落在"张紧轮不动"的快路径上省算力,但它在轮系起伏时会留下
   固有间隙 —— 实测交替 ±18° 时抬起的轮离缝 17.8mm,而履带板厚仅 50mm,视觉上就是
   「负重轮与履带脱节/穿进板里」。改 1.0 后离缝降到 −0.3mm(完全贴合),
   且因张紧行程已放宽到 300mm,长度守恒不受影响(误差恒为 0.000mm)。 */
var TRK_BOTTOM_W_MAX = 1.0;
var TRK_BOTTOM_W = TRK_BOTTOM_W_MAX;
var _tkEnvOut = { len: 0, turn: 0, nSeg: 0 };
var _tkSolvedW = 1;
function _trkEnvelope2(W, nW) {
  var i, len = 0, turn = 0, ns = 0;
  var idler = W[0], sprk = W[nW + 1];
  /* ★下凸包剔除:被抬起、落在张紧履带包络【内侧】的负重轮不参与包络 —— 真实履带正是如此
     (负重轮可以离缝,履带在两侧邻轮间走直线跨过它)。不剔除则底行被迫相切每一个轮,
     单轮抬 25° 就凭空多出 239mm(实测)。Andrew 单调链(圆版)。 */
  var hn = 0, t;
  for (i = 1; i <= nW; i++) {
    var c = W[i];
    while (hn >= 2) {
      var a2 = _tkHull[hn - 2], b2 = _tkHull[hn - 1];
      t = _trkTangent2(a2, a2.r, c, c.r, true);
      if (!t.ok) break;
      var lz = t.p2z - t.p1z, ly = t.p2y - t.p1y, LL = Math.hypot(lz, ly);
      if (LL < 1e-9) break;
      /* cross>0 表示 b 圆心在切线【上方】;b 下缘高度 = cross − r,>0 即整圆离缝。 */
      var cross = ((b2.z - t.p1z) * ly - (b2.y - t.p1y) * lz) / LL;
      if (cross - b2.r < 1e-9) break;                        // 仍触带 → 保留
      hn--;                                                  // 离缝 → 退出基线(但仍会被下方插值顶起)
    }
    _tkHull[hn++] = c;
  }
  if (hn === 0) { _tkHull[hn++] = W[1]; }
  /* 【底行贴合修复】凸包只用来定【拓扑基线】,不再让被跨轮彻底消失。
     旧行为:被跨轮完全退出包络 ⇒ 底行在剩余最低轮间走直线。实测交替 ±12° 工况下
     底行 y 极差 = 0mm(轮心却起伏 ±80mm),即用户报告的「下段还是一段平面」。
     真实履带是【张紧柔性带】,抬起的轮会把带顶起形成局部凸起,而非被无视
     (War Thunder 在同一步骤出过逐字相同的 bug:"tracks curve incorrectly /
      displayed inside wheels on uneven surfaces")。
     新行为:被跨轮按柔度 TRK_BOTTOM_W 把【接触高度】从基线插值到轮下缘 ——
       w=0 → 旧凸包直线 / w=1 → 完全贴合每一个轮。
     只抬高接触点、不改绕行顺序,故长度增量是二阶小量。 */
  var rn = 0, hj = 0, q;
  for (i = 1; i <= nW; i++) {
    var cw = W[i], tgt = _tkRoad[rn];
    tgt.z = cw.z; tgt.r = cw.r;
    if (hj < hn && _tkHull[hj] === cw) { tgt.y = cw.y; hj++; rn++; continue; }   // 基线轮:原样
    /* 被跨轮:求基线在该 z 处的高度 → 与轮下缘插值 → 反推等效轮心 */
    var hA = null, hB = null;
    for (q = 0; q < hn - 1; q++) {
      if ((cw.z <= _tkHull[q].z && cw.z >= _tkHull[q + 1].z) ||
          (cw.z >= _tkHull[q].z && cw.z <= _tkHull[q + 1].z)) { hA = _tkHull[q]; hB = _tkHull[q + 1]; break; }
    }
    if (!hA) { tgt.y = cw.y; rn++; continue; }                                   // 落在基线两端外:原样
    var tb = _trkTangent2(hA, hA.r, hB, hB.r, true);
    if (!tb.ok) { tgt.y = cw.y; rn++; continue; }
    var fz = (cw.z - tb.p1z) / ((tb.p2z - tb.p1z) || 1e-9);
    var baseY = tb.p1y + (tb.p2y - tb.p1y) * fz;                                 // 基线在该 z 的高度
    var lowY = cw.y - cw.r;                                                      // 轮下缘(完全贴合位)
    tgt.y = (baseY + (lowY - baseY) * TRK_BOTTOM_W) + cw.r;                      // 等效轮心
    rn++;
  }
  /* 依次:前跨(诱导轮→首轮) / 底行(经全部负重轮) / 后跨(末轮→主动轮) / 顶行(主动轮→诱导轮) */
  t = _trkTangent2(idler, idler.r, _tkRoad[0], _tkRoad[0].r, true);
  if (!t.ok) return null;
  _tkSegZ1[ns] = t.p1z; _tkSegY1[ns] = t.p1y; _tkSegZ2[ns] = t.p2z; _tkSegY2[ns] = t.p2y; _tkSegR[ns] = _tkRoad[0].r; ns++;
  for (i = 0; i < rn - 1; i++) {
    t = _trkTangent2(_tkRoad[i], _tkRoad[i].r, _tkRoad[i + 1], _tkRoad[i + 1].r, true);
    if (!t.ok) return null;
    _tkSegZ1[ns] = t.p1z; _tkSegY1[ns] = t.p1y; _tkSegZ2[ns] = t.p2z; _tkSegY2[ns] = t.p2y; _tkSegR[ns] = _tkRoad[i + 1].r; ns++;
  }
  t = _trkTangent2(_tkRoad[rn - 1], _tkRoad[rn - 1].r, sprk, sprk.r, true);
  if (!t.ok) return null;
  _tkSegZ1[ns] = t.p1z; _tkSegY1[ns] = t.p1y; _tkSegZ2[ns] = t.p2z; _tkSegY2[ns] = t.p2y; _tkSegR[ns] = sprk.r; ns++;
  t = _trkTangent2(sprk, sprk.r, idler, idler.r, false);
  if (!t.ok) return null;
  _tkSegZ1[ns] = t.p1z; _tkSegY1[ns] = t.p1y; _tkSegZ2[ns] = t.p2z; _tkSegY2[ns] = t.p2y; _tkSegR[ns] = idler.r; ns++;
  /* ★包弧转角由【相邻两切线段的方向变化】求得,而不是「两切点极角之差再归一化」。
     后者对负重轮那种极小的包弧会误判成接近整圈(实测转角总和 3×2π、长度 16.05m 而非 11.28m)。
     切线方向连续 ⇒ 转角即方向增量,落在 (−π, π],闭合环上总和恒为 ±2π。 */
  var TAU = Math.PI * 2;
  for (i = 0; i < ns; i++) {
    var dz1 = _tkSegZ2[i] - _tkSegZ1[i], dy1 = _tkSegY2[i] - _tkSegY1[i];
    len += Math.hypot(dz1, dy1);
    var j = (i + 1) % ns;
    var d = Math.atan2(_tkSegY2[j] - _tkSegY1[j], _tkSegZ2[j] - _tkSegZ1[j]) - Math.atan2(dy1, dz1);
    while (d <= -Math.PI) d += TAU;
    while (d > Math.PI) d -= TAU;
    len += _tkSegR[i] * Math.abs(d);
    turn += d;
  }
  _tkEnvOut.len = len; _tkEnvOut.turn = Math.abs(turn); _tkEnvOut.nSeg = ns;
  return _tkEnvOut;
}
/* 兼容包装(测试/诊断用):返回含 nodes 数组的对象 */
function _trkEnvelope(W, nW) {
  var e = _trkEnvelope2(W, nW);
  if (!e) return null;
  var nodes = [];
  for (var i = 0; i < e.nSeg; i++) nodes.push(_tkSegZ1[i], _tkSegY1[i], _tkSegZ2[i], _tkSegY2[i]);
  return { len: e.len, turn: e.turn, nodes: nodes };
}
/* 由悬挂角求轮心(与 shader begin_vertex 严格同式:旋转角 = −fdir·Δφ) */
var _tkW = [];
for (var _tkI = 0; _tkI < 18; _tkI++) _tkW.push({ z: 0, y: 0, r: 0 });   // 轮心 scratch(零分配)
function _trkWheelCenters(SP, dphi, sd, delta) {
  var W = _tkW, i, k = 0;
  var idz = SP.idlerZ, idy = SP.idlerY;
  W[k].z = idz + (delta || 0); W[k].y = idy; W[k].r = SP.idlerR + TRK_PATH_CLEARANCE; k++;   // 诱导轮:沿 +z 张紧,外扩安全间隙
  for (i = 0; i < SP.n; i++) {
    var fd = SP.fdir[i], pz = SP.wz[i] + fd * 0.193, py = SP.pivY;
    var dz0 = SP.wz[i] - pz, dy0 = SP.wy - py;                // 静止臂向量(铰点→轮心)
    var a = -fd * (dphi[sd * SP.n + i] || 0);                 // ★旋转角 = −fdir·Δφ
    var ca = Math.cos(a), sa = Math.sin(a);
    W[k].z = pz + dz0 * ca - dy0 * sa; W[k].y = py + dz0 * sa + dy0 * ca; W[k].r = SP.envR + TRK_PATH_CLEARANCE; k++;
  }
  W[k].z = SP.sprkZ; W[k].y = SP.sprkY; W[k].r = SP.sprkR + TRK_PATH_CLEARANCE; k++;         // 主动轮(车体侧固定,外扩安全间隙)
  return W;
}
/* Check the actual wheel circles against every straight envelope span.  This is
   the guard that a pure length solve lacks: if shortening the lower-track
   flex lets an unloaded wheel protrude through the belt, the solver must keep
   the belt on the outside and accept a small elastic length error instead. */
function _trkPathWheelClearance(SP, W) {
  var minClear = Infinity, nSeg = _tkEnvOut.nSeg;
  for (var si = 0; si < nSeg; si++) {
    var z1 = _tkSegZ1[si], y1 = _tkSegY1[si], z2 = _tkSegZ2[si], y2 = _tkSegY2[si];
    var vz = z2 - z1, vy = y2 - y1, vv = vz * vz + vy * vy || 1;
    for (var wi = 0; wi < SP.n + 2; wi++) {
      var physR = wi === 0 ? SP.idlerR : (wi === SP.n + 1 ? SP.sprkR : SP.envR);
      var u = ((W[wi].z - z1) * vz + (W[wi].y - y1) * vy) / vv;
      if (u < 0) u = 0; else if (u > 1) u = 1;
      var qz = z1 + vz * u - W[wi].z, qy = y1 + vy * u - W[wi].y;
      var clear = Math.sqrt(qz * qz + qy * qy) - physR;
      if (clear < minClear) minClear = clear;
    }
  }
  return minClear;
}
/* 主入口:解一侧履带。返回 {delta, len, err, turn, nodes} */
/* 【两级吸收模型】履带总长恒定 L0 = 绷直包络长 + 顶行垂度吃掉的长度。
   轮系变形改变绷直包络长 Lt(δ),差额 (L0 − Lt) 由顶行垂度吸收:
     · 差额 ∈ [0, sagCap] → 张紧轮不动,只改垂度深浅   ← 常态(起伏、开火下压)
     · 差额 < 0(轮系张开,绷直长已超 L0)→ 垂度归零,张紧轮被迫让位(δ<0)
     · 差额 > sagCap(轮系收拢过多)→ 垂度到底,张紧轮外推吃掉余量(δ>0)
   这正是真车行为:诱导轮由弹簧张紧器支撑,平时不动,只在极端行程让位;
   日常长度盈亏由顶行垂度深浅吞吐 —— 即「上段下垂的履带被拉平以弥补下段」。
   sagCap = 静态垂度长度的 TRK_SAG_CAP_K 倍。系数 4.0 ⇒ 最大垂度 = 2×静态(t59 221mm/m1 242mm),
   符合松弛履带的真实读感;同时让常态工况全部落在「张紧轮不动」的快路径上(m1 命中率
   34/200 → 大幅提升),把 80 车开销从 1.72ms 压回预算内。 */
var TRK_SAG_CAP_K = 4.0;
function trackSolve(SP, dphi, sd, warmDelta, warmW) {
  var L0 = SP.loopL0;
  if (!L0) return null;
  function lenAt(d) {
    var e = _trkEnvelope2(_trkWheelCenters(SP, dphi, sd, d), SP.n);
    return e ? e.len : NaN;
  }
  /* ★垂度上限由【几何】决定,不能凭性能拍系数:59/89 等无托带轮的车,顶行直接搭在负重轮上,
     轮子上抬时可垂空间随之变小。若放任垂度按固定倍率增长,顶行会压进负重轮 —— 实测
     Δφ=20° 时顶行落到 y=0.684 而轮顶(含板厚)在 0.772,穿模 76mm(用户可见)。
     可垂空间 = 顶行端点高 − 最高轮顶 − 安全间隙;再换算成可吸收长度 π²h²/(4S)。 */
  var _topEndY = SP.sprkY + SP.sprkR;                 // 顶行端点(端轮上切点)近似高度
  var _hiWheel = -1e9;
  for (var _wq = 0; _wq < SP.n; _wq++) {
    var _fq = SP.fdir[_wq], _aq = -_fq * (dphi[sd * SP.n + _wq] || 0);
    var _cyq = SP.pivY + (-_fq * 0.193) * Math.sin(_aq) + (-0.307) * Math.cos(_aq);
    if (_cyq > _hiWheel) _hiWheel = _cyq;
  }
  var _room = _topEndY - (_hiWheel + SP.envR + 0.008);   // 8mm 安全间隙
  if (_room < 0.01) _room = 0.01;
  var _sagGeo = Math.PI * Math.PI * _room * _room / (4 * SP.topSpan);
  var sagCap = Math.min(SP.sagDL0 * TRK_SAG_CAP_K, _sagGeo);   // 取几何限与吞吐上限的较小者
  var Lt0 = lenAt(0);
  if (Lt0 === Lt0) {
    var slack0 = L0 - Lt0;
    if (slack0 >= 0 && slack0 <= sagCap) {            // ★常态:张紧轮不动,全由垂度吞吐
      return { delta: 0, len: Lt0, err: 0, turn: SP.turn0, dphi: dphi, sd: sd, w: TRK_BOTTOM_W,
               slack: slack0, sag: _trkSagOf(SP, slack0), taut: Lt0 };
    }
  }
  /* 越界:垂度到底或被拉平 → 张紧轮介入,求 δ 使差额回到可行区间的对应端点。
     ★暖启动优先用上一帧 δ;δ=0 处的长度已在上面算过(Lt0),割线首点直接复用,省一次包络重建。 */
  L0 = (Lt0 === Lt0 && (L0 - Lt0) < 0) ? SP.loopL0 : (SP.loopL0 - sagCap);
  if (Lt0 === Lt0 && (warmDelta == null || warmDelta === 0)) {
    var f00 = Lt0 - L0;
    if (Math.abs(f00) < 1e-7) {
      var e00 = _trkEnvelope2(_trkWheelCenters(SP, dphi, sd, 0), SP.n);
      var sl00 = SP.loopL0 - (e00 ? e00.len : Lt0);
      if (sl00 < 0) sl00 = 0; else if (sl00 > sagCap) sl00 = sagCap;
      return { delta: 0, len: Lt0, err: 0, turn: e00 ? e00.turn : SP.turn0, dphi: dphi, sd: sd, w: TRK_BOTTOM_W,
               slack: sl00, sag: _trkSagOf(SP, sl00), taut: Lt0 };
    }
  }
  /* 【暖启动 + 割线法】δ 与 L 近似线性(dL/dδ ≈ 常数,由几何决定),用上一帧 δ 作初值
     配合割线迭代,通常 2~3 次即收敛到 μm 级;仅当割线失效才回落二分。
     纯二分需 24 次 × 每次重建包络,实测 80 车 ~10ms,不可接受;割线把它压到 1/6 以下。 */
  var _tr = SP.tensRange || TRK_TENSION_RANGE;              // 逐车型张紧行程(按环长比例)
  var d, i2, f0, f1, d0, d1;
  d0 = (warmDelta != null && warmDelta === warmDelta) ? warmDelta : 0;
  if (d0 < -_tr) d0 = -_tr;
  else if (d0 > _tr) d0 = _tr;
  f0 = lenAt(d0) - L0;
  if (Math.abs(f0) < 1e-7) {
    d = d0;                                                   // 上一帧解仍然有效(静止车常见)→ 零迭代
  } else {
    d1 = d0 + (f0 > 0 ? -0.01 : 0.01);                        // 试探步(dL/dδ>0)
    if (d1 < -_tr) d1 = -_tr;
    else if (d1 > _tr) d1 = _tr;
    f1 = lenAt(d1) - L0;
    var okSec = false;
    for (i2 = 0; i2 < 8; i2++) {
      var den = f1 - f0;
      if (!(Math.abs(den) > 1e-12)) break;
      var dn = d1 - f1 * (d1 - d0) / den;                     // 割线
      if (!(dn === dn)) break;
      if (dn < -_tr) dn = -_tr;
      else if (dn > _tr) dn = _tr;
      var fn = lenAt(dn) - L0;
      d0 = d1; f0 = f1; d1 = dn; f1 = fn;
      if (Math.abs(fn) < 1e-7) { okSec = true; break; }
    }
    d = d1;
    if (!okSec) {                                             // 割线未收敛 → 二分兜底(保证鲁棒)
      var lo = -_tr, hi = _tr;
      var lLo = lenAt(lo), lHi = lenAt(hi);
      if (!(lLo <= L0 && L0 <= lHi)) {
        /* 目标长度落在张紧行程之外:钳到最近端点,余量由弹性伸长吸收(真实履带行为)。 */
        d = (L0 < lLo) ? lo : hi;
      } else {
        for (var it = 0; it < TRK_SOLVE_ITER; it++) {         // 单调 ⇒ 二分必收敛
          d = (lo + hi) * 0.5;
          if (lenAt(d) > L0) hi = d; else lo = d;
        }
        d = (lo + hi) * 0.5;
      }
    }
  }
  var env = _trkEnvelope2(_trkWheelCenters(SP, dphi, sd, d), SP.n);
  if (!env) return null;
  /* ★张紧轮走到行程尽头仍嫌长 → 说明底行顶起过多,压低柔度 w 把带拉平(张力升高的表现)。
     单调:w↓ ⇒ 底行趋于凸包直线 ⇒ 总长变短。18 次二分 → w 精度 4e-6,长度残差 <0.01mm
     (8 次仅 1/256,残差达 1.5mm 超判据)。此分支只在极端交替工况触发,非常态开销。 */
  if (env.len - L0 > 1e-4) {
    var wSave = TRK_BOTTOM_W, wIt, eW, wOkFast = false;
    /* 割线法:len(w) 近似线性,3~4 次即达 μm 级(纯二分需 18 次 × 重建包络,m1 实测 80 车 2.13ms 超预算)。
       端点 w=0 必然可解(退化为凸包基线,即修复前行为),故先取两端做割线,失败再二分兜底。 */
    /* ★w 暖启动:用上一帧解出的柔度作割线首点(连续帧间 w 变化很小),
       比每次从 w=0 起步少一次包络重建。m1 实测每帧 4.8 → 3.x 次。 */
    var wA = (warmW != null && warmW === warmW && warmW < wSave) ? warmW : 0, fA, fB, wN, fN;
    var wB = wSave;
    TRK_BOTTOM_W = wA;
    eW = _trkEnvelope2(_trkWheelCenters(SP, dphi, sd, d), SP.n);
    fA = (eW ? eW.len : L0) - L0;
    fB = env.len - L0;
    if (Math.abs(fA) < 1e-5) { TRK_BOTTOM_W = wA; env = eW; _tkSolvedW = wA; wOkFast = true; }
    var wOk = false;
    if (!wOkFast) for (wIt = 0; wIt < 6; wIt++) {
      var wDen = fB - fA;
      if (!(Math.abs(wDen) > 1e-12)) break;
      wN = wB - fB * (wB - wA) / wDen;
      if (!(wN === wN)) break;
      if (wN < 0) wN = 0; else if (wN > wSave) wN = wSave;
      TRK_BOTTOM_W = wN;
      eW = _trkEnvelope2(_trkWheelCenters(SP, dphi, sd, d), SP.n);
      fN = (eW ? eW.len : L0) - L0;
      wA = wB; fA = fB; wB = wN; fB = fN;
      if (Math.abs(fN) < 1e-5) { wOk = true; break; }
    }
    if (!wOk && !wOkFast) {                                 // 割线失效 → 二分兜底
      var wLo = 0, wHi = wSave, wMid;
      for (wIt = 0; wIt < 18; wIt++) {
        wMid = (wLo + wHi) * 0.5;
        TRK_BOTTOM_W = wMid;
        eW = _trkEnvelope2(_trkWheelCenters(SP, dphi, sd, d), SP.n);
        if (eW && eW.len > L0) wHi = wMid; else wLo = wMid;
      }
      wB = wLo;
    }
    if (!wOkFast) TRK_BOTTOM_W = wB;
    if (!wOkFast) env = _trkEnvelope2(_trkWheelCenters(SP, dphi, sd, d), SP.n);
    /* Never trade wheel clearance for exact belt length.  Under hard steering
       load the lower branch can otherwise be shortened until the unloaded
       inside wheel breaks through the belt floor.  Restore full wheel-following
       flex and let the small elastic allowance absorb the remaining length. */
    var _guardW = _trkWheelCenters(SP, dphi, sd, d);
    if (_trkPathWheelClearance(SP, _guardW) < TRK_PATH_CLEARANCE * 0.5) {
      TRK_BOTTOM_W = wSave;
      env = _trkEnvelope2(_trkWheelCenters(SP, dphi, sd, d), SP.n);
      _tkSolvedW = wSave;
    } else {
      _tkSolvedW = TRK_BOTTOM_W;
    }
    TRK_BOTTOM_W = wSave;                                   // 复位,不污染下一次调用
    if (!env) return null;
  } else _tkSolvedW = TRK_BOTTOM_W;
  var slack = SP.loopL0 - env.len;
  if (slack < 0) slack = 0; else if (slack > sagCap) slack = sagCap;
  return { delta: d, len: env.len, err: env.len - L0, turn: env.turn, dphi: dphi, sd: sd, w: _tkSolvedW,
           slack: slack, sag: _trkSagOf(SP, slack), taut: env.len };
}
/* ===== 把解出的包络采样成【弧长等距控制点】,供 GPU 重铺履带板 =====
   输出 out[k*4 .. k*4+3] = (z, y, cos θ, sin θ),k∈[0,TRK_PATH_N)
   θ = 该处切线方向(与建模期 rx = atan2(−dY, dZ) 同定义,便于板姿态直接套用)。
   顶行段(最后一段切线)按 sin² 下坠注入垂度 sag —— 这是「上段吸收长度」的可视化落点。
   ★弧长等距是关键:板按 s/L 均匀分布在路径上,板间距自然恒定 = 长度守恒的直接体现。 */
/* ===== 动态路径纹理(阶段 2)=================================================
   每帧把「求解出的定长路径」写进一张 DataTexture,shader 按弧长采样重铺履带板。
   布局:宽 TRK_PATH_N,高 = 槽位数 × 2(每车左右各一行)。
     行 = slot*2 + side,列 = 弧长参数 u∈[0,1),RGBA = (z, y, cos θ, sin θ)
   玩家车固定占 slot 0;AI 按 _hullInstIdx 占 slot 1..(TRK_DYN_SLOTS−1)。
   ★与静态图集(suspAtlasTexture)并存:未解算的车(100m 外/残骸)继续用静态图集,
     零成本;解算过的车走动态纹理。由 aVTag/实例属性上的 slot 号选择。 */
var TRK_DYN_SLOTS = 48;                               // 动态路径槽位(玩家 1 + 近距 AI 47;超出回落静态)
var _trkDynData = null, _trkDynTex = null, _trkDynDirty = false;
function trackDynTexture() {
  if (_trkDynTex) return _trkDynTex;
  _trkDynData = new Float32Array(TRK_PATH_N * TRK_DYN_SLOTS * 2 * 4);
  _trkDynTex = new THREE.DataTexture(_trkDynData, TRK_PATH_N, TRK_DYN_SLOTS * 2,
                                     THREE.RGBAFormat, THREE.FloatType);
  _trkDynTex.wrapS = THREE.RepeatWrapping;            // 环路首尾相接
  _trkDynTex.wrapT = THREE.ClampToEdgeWrapping;
  _trkDynTex.magFilter = THREE.NearestFilter;         // 手工插值(见 shader),规避浮点线性过滤扩展依赖
  _trkDynTex.minFilter = THREE.NearestFilter;
  _trkDynTex.generateMipmaps = false;
  _trkDynTex.needsUpdate = true;
  return _trkDynTex;
}
var TRK_DYN_LEN = new Float32Array(TRK_DYN_SLOTS * 2);   // 各行路径周长(shader 用 s/L 归一化)
/* 解一侧并写入动态纹理行。返回 true=成功占用该行 */
function trackSolveToSlot(SP, dphi, sd, slot, warm, warmW) {
  if (slot < 0 || slot >= TRK_DYN_SLOTS) return null;
  var sol = trackSolve(SP, dphi, sd, warm, warmW);
  if (!sol) return null;
  trackDynTexture();
  var row = slot * 2 + sd;
  var tot = trackBuildPath(SP, sol, _trkDynData, row * TRK_PATH_N * 4);
  TRK_DYN_LEN[row] = tot;
  _trkDynDirty = true;
  return sol;
}
function trackDynCommit() {                            // 每帧末统一上传(避免多次 needsUpdate)
  if (_trkDynDirty && _trkDynTex) { _trkDynTex.needsUpdate = true; _trkDynDirty = false; }
}
var TRK_PATH_N = 256;                                 // 每侧动态路径控制点数(4.4cm级,避免64点弦线切入轮缘)
var TRK_DENSE_MAX = 1024;                             // 稠密折线上限(原 256 会被打爆 → 静默丢点 → 路径残缺)
var _tkPathTmpZ = new Float64Array(TRK_DENSE_MAX), _tkPathTmpY = new Float64Array(TRK_DENSE_MAX);
function trackBuildPath(SP, sol, out, base) {
  /* ★必须先用【本解的 δ】重建一次包络:_tkEnvOut 与切线段数组都是全局 scratch,
     trackSolve 内部最后一次 lenAt() 探点、或另一侧履带的求解,都会把它们覆盖。
     曾因此让底行停在探点姿态而轮子已上移 —— 表现为履带穿进负重轮达 76mm。 */
  if (sol && sol.dphi) {
    var _wSave = TRK_BOTTOM_W;
    if (sol.w != null) TRK_BOTTOM_W = sol.w;                // 用本解的柔度重建,否则形状与长度不自洽
    _trkEnvelope2(_trkWheelCenters(SP, sol.dphi, sol.sd, sol.delta), SP.n);
    TRK_BOTTOM_W = _wSave;
  }
  var ns = _tkEnvOut.nSeg, i, k;
  if (!ns) return 0;
  /* ① 先把包络离散成稠密折线(切线段 + 包弧),顶行段叠加垂度 */
  var np = 0, TAU = Math.PI * 2;
  var topIdx = ns - 1;                                // 最后一段 = 顶行(主动轮→诱导轮)
  for (i = 0; i < ns; i++) {
    var z1 = _tkSegZ1[i], y1 = _tkSegY1[i], z2 = _tkSegZ2[i], y2 = _tkSegY2[i];
    var segLen = Math.hypot(z2 - z1, y2 - y1);
    var nSub = Math.max(2, Math.ceil(segLen / TRK_PATH_MIN_STEP));
    for (k = 0; k < nSub; k++) {
      var t = k / nSub;
      var pz = z1 + (z2 - z1) * t, py = y1 + (y2 - y1) * t;
      if (i === topIdx && sol.sag > 1e-5) {           // ★顶行垂度:富余长度在这里被"吃掉"
        var sn = Math.sin(Math.PI * t);
        py -= sol.sag * sn * sn;
      }
      if (np < TRK_DENSE_MAX) { _tkPathTmpZ[np] = pz; _tkPathTmpY[np] = py; np++; }
    }
    /* 包弧:该段终点轮上的圆弧(用方向增量求转角,与长度计算同源) */
    var j = (i + 1) % ns;
    var d0 = Math.atan2(y2 - y1, z2 - z1);
    var d1 = Math.atan2(_tkSegY2[j] - _tkSegY1[j], _tkSegZ2[j] - _tkSegZ1[j]);
    var dd = d1 - d0;
    while (dd <= -Math.PI) dd += TAU;
    while (dd > Math.PI) dd -= TAU;
    var r = _tkSegR[i];
    if (r > 1e-6 && Math.abs(dd) > 1e-4) {
      /* 弧心 = 切点沿法向偏移 r(法向由转向决定) */
      var sgn = dd > 0 ? 1 : -1;
      var nz = -Math.sin(d0) * sgn, ny = Math.cos(d0) * sgn;
      var cz = z2 + nz * r, cy = y2 + ny * r;
      var a0 = Math.atan2(y2 - cy, z2 - cz);
      var nA = Math.max(1, Math.ceil(Math.abs(dd) * r / 0.06));
      for (k = 1; k <= nA; k++) {
        var a = a0 + dd * k / nA;
        if (np < TRK_DENSE_MAX) { _tkPathTmpZ[np] = cz + r * Math.cos(a); _tkPathTmpY[np] = cy + r * Math.sin(a); np++; }
      }
    }
  }
  if (np < 3) return 0;
  /* ② 累计弧长 → 等距重采样为 TRK_PATH_N 个控制点 */
  var cum = _tkCum, tot = 0;
  cum[0] = 0;
  for (i = 1; i <= np; i++) {
    var q = i % np;
    tot += Math.hypot(_tkPathTmpZ[q] - _tkPathTmpZ[i - 1], _tkPathTmpY[q] - _tkPathTmpY[i - 1]);
    cum[i] = tot;
  }
  for (k = 0; k < TRK_PATH_N; k++) {
    var sTarget = tot * k / TRK_PATH_N;
    var lo = 0, hi = np;
    while (lo < hi - 1) { var mid = (lo + hi) >> 1; if (cum[mid] <= sTarget) lo = mid; else hi = mid; }
    var f = (sTarget - cum[lo]) / ((cum[lo + 1] - cum[lo]) || 1);
    var iA = lo % np, iB = (lo + 1) % np;
    var gz = _tkPathTmpZ[iA] + (_tkPathTmpZ[iB] - _tkPathTmpZ[iA]) * f;
    var gy = _tkPathTmpY[iA] + (_tkPathTmpY[iB] - _tkPathTmpY[iA]) * f;
    /* 切线:取相邻控制点差分(闭环) */
    var iC = (lo + 2) % np;
    var tz = _tkPathTmpZ[iC] - _tkPathTmpZ[iA], ty = _tkPathTmpY[iC] - _tkPathTmpY[iA];
    var tl = Math.hypot(tz, ty) || 1;
    var rx = Math.atan2(-ty / tl, tz / tl);           // 与建模期 rx = atan2(−dY, dZ) 同定义
    var o = base + k * 4;
    out[o] = gz; out[o + 1] = gy; out[o + 2] = Math.cos(rx); out[o + 3] = Math.sin(rx);
  }
  return tot;
}
var _tkCum = new Float64Array(TRK_DENSE_MAX + 2);
/* 由「富余长度」反解顶行垂度:ΔL = π²h²/(4S) ⇒ h = √(4S·ΔL)/π */
function _trkSagOf(SP, slack) {
  if (!(slack > 0)) return 0;
  return Math.sqrt(4 * SP.topSpan * slack) / Math.PI;
}

/* 基准长度 L0:★由求解器自身在 δ=0、全轮静止(Δφ=0)下算出,而非取建模环路 trackLoopXX 的
   折线周长 —— 两者口径不同(建模环路顶行是 sin² 悬链下坠,求解器顶行是绷直公切线)。
   用求解器自算保证「静止即零误差」,是单一真值源原则的落实。
   静止解出的 δ0 一并记下:它就是该车的静态张紧位置,真实垂度由 δ0 与 L0 的关系隐含表达。 */
(function _trkInitL0() {
  for (var k in SUSP_SPEC) {
    var SPk = SUSP_SPEC[k];
    var z0 = [];
    for (var i = 0; i < SPk.n * 2; i++) z0.push(0);
    var env = _trkEnvelope(_trkWheelCenters(SPk, z0, 0, 0), SPk.n);
    SPk.tautL = env ? env.len : 0;           // 全绷直(顶行为直切线)时的包络长
    SPk.turn0 = env ? env.turn : 0;
    /* ★真实履带长 = 绷直包络长 + 静态垂度多吃掉的那一段。
       顶行按 sin² 下坠(与 trackLoopXX 建模同式),弧长增量一阶近似 ΔL = π²h²/(4S)。
       这样静止时求解器路径与建模环路等长,板不会开局就被崩紧。 */
    var S = Math.abs(SPk.idlerZ - SPk.sprkZ);
    SPk.topSpan = S;
    SPk.sag0    = 0.11 * (S / 4.55);         // 各车按顶行跨度等比缩放 59 式的 0.11
    SPk.sagDL0  = Math.PI * Math.PI * SPk.sag0 * SPk.sag0 / (4 * S);
    SPk.loopL0  = SPk.tautL + SPk.sagDL0;    // 履带实际长度(恒定)
    /* 张紧行程按【环长比例】派生,而非固定常数:轮数越多、环越长的车,轮系起伏时
       路径增量越大,需要的长度预算也越大。实测 M1(7 轮 12.07m)在交替 ±18° 下
       需 ~600mm 才能让履带完全贴合,而 t59(5 轮 11.29m)只需 ~260mm。
       固定 300mm 会让 M1 残留 45.8mm 离缝(轮盘顶穿 50mm 厚的履带板)。 */
    SPk.tensRange = SPk.loopL0 * TRK_TENSION_K;
  }
})();
var BUILD_TAG = '2026-09-10 fx7';   // 运行时版本标记:F12控制台输入BUILD_TAG/T59_LIFT核对是否为最新文件
if (typeof console !== 'undefined' && console.log) console.log('[build]', BUILD_TAG);   // 99/89/M1轮系下沉(负重轮降一半径,底行随轮降)后贴地抬升=各自履带板外底→贴地(与T59_LIFT同口径)
/* ===== 59履带物理环路(自由悬链简化,59无托带轮)----
   底行:切五轮底的直线;前后跨接段:端负重轮→端轮的下外公切线(与端轮/端负重轮同时相切);
   包底弧：跨接段与底行在端轮死底点两侧汇合，履带包住端负重轮底部;
   端轮包弧:跨接触点→顶切点,绕外极点(前0°/后180°);
   顶行:端轮上公切线 + sin²下坠(端点零斜率,悬链近似,坠深0.11)。
   全环G1光滑(销位无折角),取代旧 TRACK_POLY 四折线环(包络/节距基本不变,带尖≈2.64)。 ===== */
/* 履带环路分段边界索引(8 段:底行/末轮包弧/后跨/后端轮弧/顶行/前端轮弧/前跨/首轮包弧)。
   由 trackLoop59 与 trackLoopWheels 在构环时写入,供悬挂 shader 按弧长实时重算权重。
   ★全局单例:环路函数为同步执行且建表时即刻消费,不存在跨车型串扰。 */
var _t59Seg = [0, 0, 0, 0, 0, 0, 0, 0];
function trackLoop59() {
  var W1 = [1.635, 0.2875], W5 = [-1.665, 0.2875], RW = 0.40;   // 端负重轮心/半径(含板半0.025)
  var ID = [2.28, 0.62], RID = 0.305, SP = [-2.30, 0.60], RSP = 0.285;
  var SAG = 0.11, STP = 0.2, ASTP = 0.1;
  var A = [W1[0], W1[1] - RW], B = [W5[0], W5[1] - RW];   // 底行两端=端轮死底点
  function tang(c1, r1, c2, r2, low) {   // 两圆外公切线(low取中点低者/高者):法线与心连线夹角acos((r1-r2)/D),两圆同侧偏置
    var dx = c2[0] - c1[0], dy = c2[1] - c1[1], D = Math.hypot(dx, dy), ux = dx / D, uy = dy / D;
    var be = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / D))), out = [];
    for (var s = -1; s <= 1; s += 2) {
      var cb = Math.cos(s * be), sb = Math.sin(s * be);
      var nx = ux * cb - uy * sb, ny = ux * sb + uy * cb;
      out.push({ p1: [c1[0] + nx * r1, c1[1] + ny * r1], p2: [c2[0] + nx * r2, c2[1] + ny * r2] });
    }
    out.sort(function (a, b) { return (a.p1[1] + a.p2[1]) - (b.p1[1] + b.p2[1]); });
    return low ? out[0] : out[1];
  }
  function arc(C, r, P0, P1, through, step, pts) {   // 经through极角的扫掠( robust 双向判定)
    var TAU = Math.PI * 2;
    function norm(a) { a %= TAU; if (a < 0) a += TAU; return a; }
    var a0 = norm(Math.atan2(P0[1] - C[1], P0[0] - C[0])), a1 = norm(Math.atan2(P1[1] - C[1], P1[0] - C[0])), th = norm(through);
    function has(x0, x1, t) { if (x1 < x0) x1 += TAU; if (t < x0) t += TAU; return t <= x1 + 1e-9; }
    var dir = has(a0, a1, th) ? 1 : -1, span = dir > 0 ? a1 - a0 : a0 - a1;
    span = ((span % TAU) + TAU) % TAU; if (span < 1e-9) span = TAU;
    var n = Math.max(2, Math.ceil(r * span / step));
    for (var k = (pts.length ? 1 : 0); k <= n; k++) { var a = a0 + dir * span * k / n; pts.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]); }
  }
  function straight(P, Q, step, pts) {
    var L = Math.hypot(Q[0] - P[0], Q[1] - P[1]), n = Math.max(1, Math.round(L / step));
    for (var k = (pts.length ? 1 : 0); k <= n; k++) pts.push([P[0] + (Q[0] - P[0]) * k / n, P[1] + (Q[1] - P[1]) * k / n]);
  }
  var fT = tang(W1, RW, ID, RID, true), rT = tang(W5, RW, SP, RSP, true), tT = tang(ID, RID, SP, RSP, false);
  var pts = [];
  straight(A, B, STP, pts);                              // 底行(切五轮底)
  _t59Seg[0] = pts.length - 1;                           // ★分段边界(供悬挂 shader 按弧长实时重算权重)
  arc(W5, RW, B, rT.p1, Math.PI * 1.4, ASTP, pts);        // 包W5底部(死底点→后跨切点,经后下方)
  _t59Seg[1] = pts.length - 1;
  straight(rT.p1, rT.p2, STP * 0.75, pts);               // 后跨段(与W5/主动轮同时相切)
  _t59Seg[2] = pts.length - 1;
  arc(SP, RSP, rT.p2, tT.p2, Math.PI, ASTP, pts);   // 主动轮包弧(经正后方)
  _t59Seg[3] = pts.length - 1;
  var P1 = tT.p2, P0 = tT.p1;                  // 悬链两端(上切点)
  var sL = Math.hypot(P0[0] - P1[0], P0[1] - P1[1]), sn = Math.max(8, Math.round(sL / 0.12)), k0 = pts.length ? 1 : 0;
  for (var s = k0; s <= sn; s++) { var t = s / sn;   // 顶行下坠(sin²,端点零斜率)
    pts.push([P1[0] + (P0[0] - P1[0]) * t, P1[1] + (P0[1] - P1[1]) * t - SAG * Math.pow(Math.sin(Math.PI * t), 2)]); }
  _t59Seg[4] = pts.length - 1;
  arc(ID, RID, P0, fT.p2, 0, ASTP, pts);       // 导向轮包弧(经正前方)
  _t59Seg[5] = pts.length - 1;
  straight(fT.p2, fT.p1, STP * 0.75, pts);         // 前跨段(导向轮下切点→W1切点,与W1/导向轮同时相切)
  _t59Seg[6] = pts.length - 1;
  arc(W1, RW, fT.p1, A, -Math.PI * 0.4, ASTP, pts);   // 包W1底部(前跨切点→死底点,经前下方,闭环)
  _t59Seg[7] = pts.length;                              // 末段边界=环路全长(建表时钳到 L)
  if (pts.length > 1 && Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) < 1e-6) pts.pop();
  return pts;
}
/* 通用履带物理环路(trackLoop59 同构:底行切轮底/端轮包底弧/跨段外公切/端轮包弧/顶行sin²下坠;顶坠=顶跨2.4%,59跨度下即0.11原值):
   W1/W5 首末负重轮心[z,y],RW 包络半径(含板半);F/R 前后端轮心+包络半径(59=前诱导/后主动,89=前主动/后诱导,构形对称通用) */
function trackLoopWheels(W1, W5, RW, F, RF, Rr, RR) {
  function tang(c1, r1, c2, r2, low) {   // 两圆外公切线(low取中点低者/高者)
    var dx = c2[0] - c1[0], dy = c2[1] - c1[1], D = Math.hypot(dx, dy), ux = dx / D, uy = dy / D;
    var be = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / D))), out = [];
    for (var s = -1; s <= 1; s += 2) {
      var cb = Math.cos(s * be), sb = Math.sin(s * be);
      var nx = ux * cb - uy * sb, ny = ux * sb + uy * cb;
      out.push({ p1: [c1[0] + nx * r1, c1[1] + ny * r1], p2: [c2[0] + nx * r2, c2[1] + ny * r2] });
    }
    out.sort(function (a, b) { return (a.p1[1] + a.p2[1]) - (b.p1[1] + b.p2[1]); });
    return low ? out[0] : out[1];
  }
  function arc(C, r, P0, P1, through, step, pts) {   // 经through极角的扫掠(robust 双向判定)
    var TAU = Math.PI * 2;
    function norm(a) { a %= TAU; if (a < 0) a += TAU; return a; }
    var a0 = norm(Math.atan2(P0[1] - C[1], P0[0] - C[0])), a1 = norm(Math.atan2(P1[1] - C[1], P1[0] - C[0])), th = norm(through);
    function has(x0, x1, t) { if (x1 < x0) x1 += TAU; if (t < x0) t += TAU; return t <= x1 + 1e-9; }
    var dir = has(a0, a1, th) ? 1 : -1, span = dir > 0 ? a1 - a0 : a0 - a1;
    span = ((span % TAU) + TAU) % TAU; if (span < 1e-9) span = TAU;
    var n = Math.max(2, Math.ceil(r * span / step));
    for (var k = (pts.length ? 1 : 0); k <= n; k++) { var a = a0 + dir * span * k / n; pts.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]); }
  }
  function straight(P, Q, step, pts) {
    var L = Math.hypot(Q[0] - P[0], Q[1] - P[1]), n = Math.max(1, Math.round(L / step));
    for (var k = (pts.length ? 1 : 0); k <= n; k++) pts.push([P[0] + (Q[0] - P[0]) * k / n, P[1] + (Q[1] - P[1]) * k / n]);
  }
  var fT = tang(W1, RW, F, RF, true), rT = tang(W5, RW, Rr, RR, true), tT = tang(F, RF, Rr, RR, false);
  var pts = [];
  var A = [W1[0], W1[1] - RW], B = [W5[0], W5[1] - RW];   // 底行两端=端轮死底点
  straight(A, B, 0.2, pts);                              // 底行(切全部负重轮底)
  _t59Seg[0] = pts.length - 1;                           // ★分段边界(与 trackLoop59 同口径,供悬挂 shader 用)
  arc(W5, RW, B, rT.p1, Math.PI * 1.4, 0.1, pts);        // 包末轮底部(经后下方)
  _t59Seg[1] = pts.length - 1;
  straight(rT.p1, rT.p2, 0.15, pts);                     // 后跨段(与末轮/后端轮同时相切)
  _t59Seg[2] = pts.length - 1;
  arc(Rr, RR, rT.p2, tT.p2, Math.PI, 0.1, pts);          // 后端轮包弧(经正后方)
  _t59Seg[3] = pts.length - 1;
  var P1 = tT.p2, P0 = tT.p1;                            // 悬链两端(上切点)
  var sL = Math.hypot(P0[0] - P1[0], P0[1] - P1[1]), SAG = 0.024 * sL, sn = Math.max(8, Math.round(sL / 0.12)), k0 = pts.length ? 1 : 0;
  for (var s = k0; s <= sn; s++) { var t = s / sn;   // 顶行下坠(sin²,端点零斜率)
    pts.push([P1[0] + (P0[0] - P1[0]) * t, P1[1] + (P0[1] - P1[1]) * t - SAG * Math.pow(Math.sin(Math.PI * t), 2)]); }
  _t59Seg[4] = pts.length - 1;
  arc(F, RF, P0, fT.p2, 0, 0.1, pts);                   // 前端轮包弧(经正前方)
  _t59Seg[5] = pts.length - 1;
  straight(fT.p2, fT.p1, 0.15, pts);                     // 前跨段(与前端轮/首轮同时相切)
  _t59Seg[6] = pts.length - 1;
  arc(W1, RW, fT.p1, A, -Math.PI * 0.4, 0.1, pts);       // 包首轮底部(经前下方,闭环)
  _t59Seg[7] = pts.length;                              // 末段边界=环路全长
  if (pts.length > 1 && Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) < 1e-6) pts.pop();
  return pts;
}
// 99/89/M1 物理环路封装(包络半径=轮盘半径+板半0.025;端轮心/半径沿用各车现值,底行与现环路底边同高,抬升不动):
function trackLoop99() { return trackLoopWheels([1.635, 0.28], [-2.165, 0.28], 0.375, [2.28, 0.62], 0.305, [-2.80, 0.60], 0.285); }
function trackLoop89() { return trackLoopWheels([1.70, 0.333], [-1.70, 0.333], 0.36, [2.26, 0.65], 0.225, [-2.26, 0.62], 0.225); }
function trackLoopM1() { return trackLoopWheels([2.04, 0.299], [-2.04, 0.299], 0.33, [2.533, 0.628], 0.275, [-2.48, 0.60], 0.295); }
function trackLoopM60() { return trackLoopWheels([1.527, 0.30], [-2.314, 0.30], 0.325, [1.937, 0.903], 0.305, [-2.627, 0.90], 0.315); }
function trackLoopPGZ() { return trackLoopWheels([1.95, 0.40], [-1.95, 0.40], 0.375, [2.72, 0.90], 0.325, [-2.82, 0.90], 0.325); }   // RED_AA:6负重轮(envR=0.35盘+0.025板半→带底y0贴地)/端轮(0.90,R0.30+0.025)   // 轮心/半径沿用现值(首轮1.527/末轮-2.314/诱导轮/主动轮),底行-0.025,整车抬M60_LIFT贴地
/* ===== 履带环路查找图集(2026-09-09)========================================
   五车型的履带都是「离散刚体板」(segTrackPlates 逐板 vBox),UV 平移那套滚动对它无效 ——
   板必须沿环路真实位移。做法:把每车环路按弧长等距重采样成一行,五行叠成一张浮点纹理:
     行 r = 车型(0 t59 / 1 t99 / 2 td89 / 3 m1 / 4 m60 / 5 pgz95),列 = 弧长参数 u∈[0,1)
     RGBA = (z, y, cos rx, sin rx)
   ★存 cos/sin 而非角度:rx 绕环一周有 ±π 跳变,线性滤波会插出错误中间角(板瞬间翻转);
     三角值连续,采样后归一化即可。
   ★行方向必须 NEAREST + 半像素对齐:相邻车型环路无关联,线性滤波会把两车环路混起来。
   每行的总长 L 与八段边界另存 uniform 数组(逐行 8 个,共 40 个 float)。 */
var T59_PATH_N = 512;                     // 每行采样点数(最长环 ~12m → 2.3cm/点,远细于板长 0.185)
var SUSP_ATLAS_ROWS = 6;   // 0..4=59/99/89/M1/M60, 5=RED_AA(2026-09-11)
var _suspAtlasTex = null;
var SUSP_ATLAS_LEN = [1, 1, 1, 1, 1, 1];                 // 逐行环路总长(m)
var SUSP_ATLAS_SEG = new Float32Array(SUSP_ATLAS_ROWS * 8);   // 逐行八段边界弧长
function suspAtlasTexture() {
  if (_suspAtlasTex) return _suspAtlasTex;
  var data = new Float32Array(T59_PATH_N * SUSP_ATLAS_ROWS * 4);
  for (var r = 0; r < SUSP_ATLAS_ROWS; r++) {
    var key = SUSP_ATLAS_KEYS[r], spec = SUSP_SPEC[key];
    var loop = (typeof window !== 'undefined' && window[spec.loop]) ? window[spec.loop]() : eval(spec.loop + '()');
    var M = loop.length, i, cum = [0];
    for (i = 1; i <= M; i++) cum.push(cum[i - 1] + Math.hypot(loop[i % M][0] - loop[i - 1][0], loop[i % M][1] - loop[i - 1][1]));
    var L = cum[M];
    SUSP_ATLAS_LEN[r] = L;
    for (i = 0; i < 8; i++) {                          // _t59Seg 由刚才的 loop 调用写入(同步执行,无串扰)
      var ci = _t59Seg[i];
      SUSP_ATLAS_SEG[r * 8 + i] = (ci >= 0 && ci < cum.length) ? cum[ci] : L;   // 末段索引可能越界一格 → 钳到 L
    }
    var at = function (sq) {
      sq = ((sq % L) + L) % L;
      var lo = 0, hi = M;
      while (lo < hi - 1) { var mm = (lo + hi) >> 1; if (cum[mm] <= sq) lo = mm; else hi = mm; }
      var A = loop[lo % M], B = loop[(lo + 1) % M], tt = (sq - cum[lo]) / ((cum[lo + 1] - cum[lo]) || 1);
      return [A[0] + (B[0] - A[0]) * tt, A[1] + (B[1] - A[1]) * tt];
    };
    for (i = 0; i < T59_PATH_N; i++) {
      var sA = L * i / T59_PATH_N;
      var p = at(sA), pf = at(sA + L * 0.002), pb = at(sA - L * 0.002);   // 中心差分求切线
      var rx = Math.atan2(-(pf[1] - pb[1]), (pf[0] - pb[0]));            // 与建模期 rx = atan2(-dY, dZ) 同定义
      var o4 = (r * T59_PATH_N + i) * 4;
      data[o4] = p[0]; data[o4 + 1] = p[1];
      data[o4 + 2] = Math.cos(rx); data[o4 + 3] = Math.sin(rx);
    }
  }
  var tex = new THREE.DataTexture(data, T59_PATH_N, SUSP_ATLAS_ROWS, THREE.RGBAFormat, THREE.FloatType);
  /* ★NEAREST + shader 内手工插值:浮点纹理的线性过滤要靠 OES_texture_float_linear,
     并非所有设备/WebGL2 默认可用;而且行向线性会把相邻车型的环路混在一起。
     手工两点插值既规避扩展依赖,又天然做到「列向插值、行向不插值」。 */
  tex.wrapS = THREE.RepeatWrapping;                    // 环路首尾相接
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _suspAtlasTex = tex;
  return tex;
}
// RED_TD/BLUE_MBT_2 专用圆角环带中心线:与各自端轮轴心、底边和车长匹配;共用RED_MBT_1的中空环带/板纹细化流水线。
var TD89_TRACK_POLY = [[2.72, 0.91], [2.16, -0.027], [-2.16, -0.027], [-2.71, 0.89]]; // 外壁端点≈±2.54,仍收在车体±2.55内
var TD89_TRACK_FILLET = [0.25, 0.16, 0.16, 0.25];
var M1_TRACK_POLY = [[3.19, 0.93], [2.43, -0.031], [-2.42, -0.031], [-3.14, 0.91]];
var M1_TRACK_FILLET = [0.30, 0.22, 0.22, 0.32];
/* ===== M60 专属履带轮廓(端轮下移 y1.00→0.90 + z 内收:诱导轮 (1.76,1.00)→(1.83,0.90) / 主动轮 (-1.92,1.00)→(-1.97,0.90);
   前上角 z+0.07/y-0.10、后上角 z-0.05/y-0.10 随端轮;底角 y 不变=0.05 仅 z 随动;fillet 半径不变=端轮半径不变 ===== */
var TRACK_POLY_M60 = [   // M60 专属带中心线轮廓(复用 genTrackLoop;后段随车体拉长:主动轮 -1.97→-2.627,后两点同步平移 Δ-0.657,端轮弧 R/切角不变)
  [2.543, 1.236], // 前上角(绕诱导轮 (1.83,0.90) 弧:R0.33)
  [1.783, 0.05],  // 前底角
  [-2.571, 0.05], // 后底角(随主动轮平移)
  [-3.287, 1.204] // 后上角(绕新主动轮 (-2.627,0.90) 弧:R0.31;凸出车尾竖面 -3.12 约 0.17,同原凸出比例)
];
var TRACK_FILLET_M60 = [0.33, 0.24, 0.24, 0.31];

/* ===== RED_TD360°旋转炮塔一体壳(自由回转;冠形顶)----
   真车正面不是横向拉通的标准方盒:炮口中间只留 0.64m 宽的平直区,左右前颊同时向侧后方
   各退 0.34m;它们又沿原 62° 正面后倾,因此是“正视、侧视都倾斜”的复合斜面。
   上部横环按正视参考做成中央高、两侧低的冠形轮廓:前顶/主顶/后顶边缘
   分别下降 0.12/0.13/0.09m,中央炮位仍保持原高度和 0.64m 宽度。
   下面用同一圈闭合表皮一次成型:正脸三面 + 顶/尾/底 + 左右侧盖共享同一轮廓,几何上零开口;
   不用多个 Box 拼炮塔,避免接缝、重叠面和漏风。视觉壳与 89 式命中壳共用此唯一函数。 ===== */
var TD89_CASE_W = 0.95;
var TD89_CASE_CENTER = 0.32;                       // 中央平直面半宽≈主炮根/喉板宽度
var TD89_CASE_RECESS = 0.34;                       // 两侧前颊向后斜切量(平面视图)
var TD89_GUN_PULL = 0.44;                          // 炮根铸座与整根身管共同前移:粗圆柱铸座露出脸外
var TD89_CASE_Y0 = -0.04, TD89_CASE_Y1 = 0.78;
var TD89_CASE_Z0 = 1.53, TD89_CASE_Z1 = 1.094;
var TD89_CASE_SIDE_DROP = [0.00, 0.12, 0.13, 0.09, 0.00]; // 五条纵向环:底边不动,上部两侧略矮
var TD89_REAR_TOP_Z = -2.50, TD89_REAR_TOP_Y = 1.08;
/* 89 车体下半部重构(用户参考图红线)——
   ① 首下装甲=两段等长折线:首段与水平 60°、次段 30°;
   ② 车尾长斜面下端接一段 30° 短斜面落底;
   ③ 车底 0.45→0.28,车体加厚。等长 L 由鼻点 0.59 至底 0.28 解出:0.31=L(sin60+sin30)。 */
var TD89_HULL_BOT_Y = 0.28;
var TD89_GLA_L = (0.59 - TD89_HULL_BOT_Y) / (Math.sin(Math.PI / 3) + Math.sin(Math.PI / 6));
var TD89_G1_Z = 2.55 - TD89_GLA_L * Math.cos(Math.PI / 3), TD89_G1_Y = 0.59 - TD89_GLA_L * Math.sin(Math.PI / 3);   // 60° 段末
var TD89_G2_Z = TD89_G1_Z - TD89_GLA_L * Math.cos(Math.PI / 6);                                                       // 30° 段末=底前角
var TD89_REAR_MID_Z = -2.44, TD89_REAR_MID_Y = 0.46;   // 尾长斜面下端=30° 短斜面上端
var TD89_REAR_BOTTOM_Z = TD89_REAR_MID_Z + (TD89_REAR_MID_Y - TD89_HULL_BOT_Y) / Math.tan(Math.PI / 6);               // 短斜落底
var TD89_REAR_BOTTOM_Y = TD89_HULL_BOT_Y;
var TD89_REAR_ANGLE = Math.atan2(TD89_REAR_TOP_Y - TD89_REAR_MID_Y, TD89_REAR_MID_Z - TD89_REAR_TOP_Z);   // 尾门所贴长斜面(~84.5°)
var TD89_HULL_PTS = [                                   // 单一闭合车体壳:鼻→上首→顶→尾长斜→尾短斜→底→首下双折
  [2.55, 0.59], [2.17, 0.85], [1.09, 1.08],
  [TD89_REAR_TOP_Z, TD89_REAR_TOP_Y], [TD89_REAR_MID_Z, TD89_REAR_MID_Y],
  [TD89_REAR_BOTTOM_Z, TD89_REAR_BOTTOM_Y], [TD89_G2_Z, TD89_HULL_BOT_Y], [TD89_G1_Z, TD89_G1_Y]
];
// 动力前置发动机隔栅:严格落在上首斜面[2.17,0.85]→[1.09,1.08],不是水平甲板贴片。
var TD89_ENGINE_GRILLE = { x:-0.38, z:1.58, w:0.78, l:0.68,
  angle:Math.atan2(TD89_HULL_PTS[2][1]-TD89_HULL_PTS[1][1],TD89_HULL_PTS[1][0]-TD89_HULL_PTS[2][0]) };   // 隔栅贴上首缓坡=[1]→[2](鼻尖35°坡是[0]→[1],勿混)
function td89EngineGlacisY(z) {
  var a=TD89_HULL_PTS[1],b=TD89_HULL_PTS[2];
  return a[1]+(a[0]-z)*(b[1]-a[1])/(a[0]-b[0]);
}
function td89EngineGrillePoint(dx,dz,outward,out) {      // 视觉格栅与排烟源共用同一解析斜面锚点
  dx=dx||0;dz=dz||0;outward=outward||0;out=out||{};
  var z=TD89_ENGINE_GRILLE.z+dz,a=TD89_ENGINE_GRILLE.angle;
  out.x=TD89_ENGINE_GRILLE.x+dx;out.y=td89EngineGlacisY(z)+Math.cos(a)*outward;out.z=z+Math.sin(a)*outward;
  return out;
}
function td89RearPoint(t, outward) {                    // 车尾门/铰链/尾灯共用尾长斜面解析锚点(插值段=长斜 MID→TOP)
  outward = outward || 0;
  return {
    y: TD89_REAR_MID_Y + (TD89_REAR_TOP_Y - TD89_REAR_MID_Y) * t - Math.cos(TD89_REAR_ANGLE) * outward,
    z: TD89_REAR_MID_Z + (TD89_REAR_TOP_Z - TD89_REAR_MID_Z) * t - Math.sin(TD89_REAR_ANGLE) * outward
  };
}
function td89CaseEdgeK(x) {
  return clamp((Math.abs(x) - TD89_CASE_CENTER) / (TD89_CASE_W - TD89_CASE_CENTER), 0, 1);
}
function td89RoofY(x, z) {                              // 冠形战斗室顶面解析高度;所有顶置附件只从此函数取锚点
  var k = td89CaseEdgeK(x);
  var y1 = TD89_CASE_Y1 - TD89_CASE_SIDE_DROP[1] * k;
  var z1 = td89CenterFrontZ(y1) - TD89_CASE_RECESS * k;
  var y2 = 0.92 - TD89_CASE_SIDE_DROP[2] * k, z2 = 0.30;
  var y3 = 0.80 - TD89_CASE_SIDE_DROP[3] * k, z3 = -1.14;
  if (z >= z2) {
    var tf = clamp((z - z2) / Math.max(0.001, z1 - z2), 0, 1);
    return y2 + (y1 - y2) * tf;
  }
  if (z >= z3) {
    var tt = clamp((z - z3) / (z2 - z3), 0, 1);
    return y3 + (y2 - y3) * tt;
  }
  var tr = clamp((z + 1.30) / 0.16, 0, 1);
  return -0.04 + (y3 + 0.04) * tr;
}
function td89CenterFrontZ(y) {
  var t = (y - TD89_CASE_Y0) / (TD89_CASE_Y1 - TD89_CASE_Y0);
  return TD89_CASE_Z0 + (TD89_CASE_Z1 - TD89_CASE_Z0) * t;
}
function td89FrontZ(x, y) {                         // 正脸/左右复合斜颊的解析面(中央附件贴面共用)
  var z = td89CenterFrontZ(y), ax = Math.abs(x);
  if (ax > TD89_CASE_CENTER)
    z -= TD89_CASE_RECESS * Math.min(1, (ax - TD89_CASE_CENTER) / (TD89_CASE_W - TD89_CASE_CENTER));
  return z;
}
function td89CasemateGeo() {
  var xs = [-TD89_CASE_W, -TD89_CASE_CENTER, 0, TD89_CASE_CENTER, TD89_CASE_W];   // 加中轴列,左右剖分对称
  // 每一行是一条横向折线;0→1 为正面,1→2 为前顶坡,2→3 为主顶板,3→4 为尾板,4→0 为底板。
  // 前两环的 z 按各点实际 y 重新求值,故外侧降低后仍严格落在同一 62° 复合正脸上。
  var rings = [
    [TD89_CASE_Y0, null],
    [TD89_CASE_Y1, null],
    [0.92, 0.30],
    [0.80, -1.14],
    [-0.04, -1.30]
  ];
  var V = [], pos = [], idx = [], i, j;
  var outerScale = [1.00, 0.91, 0.89, 0.94, 1.00]; // 顶缘内收、底缘较宽,形成RED_TD梯形战斗室
  for (i = 0; i < rings.length; i++) {
    V[i] = [];
    for (j = 0; j < xs.length; j++) {
      var edgeK = (Math.abs(xs[j]) - TD89_CASE_CENTER) / (TD89_CASE_W - TD89_CASE_CENTER); // 中央=0/外缘=1
      edgeK = Math.max(0, Math.min(1, edgeK));
      var xx = edgeK > 0 ? xs[j] * outerScale[i] : xs[j]; // 中央炮位宽度保持0.64m
      var yy = rings[i][0] - TD89_CASE_SIDE_DROP[i] * edgeK;
      var zz = i < 2 ? td89CenterFrontZ(yy) - TD89_CASE_RECESS * edgeK : rings[i][1];
      V[i][j] = [xx, yy, zz];
    }
  }
  var inside = [0, 0.40, 0.02];                       // 严格位于凸壳内部,用来自动校正所有三角面朝外
  function tri(a, b, c) { triOrientPush(pos, idx, inside, a, b, c); }
  function quad(a, b, c, d) { tri(a, b, c); tri(a, c, d); }
  // 环向五段表皮;每段横向四片,中央片就是唯一保留的主炮宽度平直正脸。
  for (i = 0; i < rings.length; i++) {
    var ni = (i + 1) % rings.length;
    for (j = 0; j < xs.length - 1; j++) {
      // quad 以外侧端点为首(剖分对角线=外端底→内端顶),左右镜像剖分一致
      if (Math.abs(xs[j]) < Math.abs(xs[j + 1])) quad(V[i][j + 1], V[i][j], V[ni][j], V[ni][j + 1]);
      else quad(V[i][j], V[i][j + 1], V[ni][j + 1], V[ni][j]);
    }
  }
  // 左右端盖闭合。所有边都与环向表皮逐点重合,炮塔主壳是单一封闭实体。
  for (i = 1; i < rings.length - 1; i++) {
    tri(V[0][0], V[i][0], V[i + 1][0]);
    tri(V[0][xs.length - 1], V[i + 1][xs.length - 1], V[i][xs.length - 1]);
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/* RED_TD炮盾共形主壳:包络三道帆布褶与前钢颈,不用方盒空气装甲。 */
function td89MantletGeo() {
  var P=[[-0.145,0.325],[-0.098,0.325],[-0.010,0.315],[0.030,0.315],[0.130,0.285],
         [0.170,0.285],[0.230,0.280],[0.300,0.250],[0.410,0.230]];
  var SEG=18,pos=[],idx=[],R=[],i,j;
  function V(x,y,z){var n=pos.length/3;pos.push(x,y,z);return n;}
  for (i = 0; i < P.length; i++) { R[i] = []; for (j = 0; j < SEG; j++) { var a = j / SEG * TAU; R[i].push(V(Math.cos(a) * P[i][1],Math.sin(a) * P[i][1],P[i][0])); } }
  for (i = 0; i < P.length - 1; i++) for (j = 0; j < SEG; j++) { var k = (j + 1) % SEG; idx.push(R[i][j],R[i][k],R[i + 1][k],R[i][j],R[i + 1][k],R[i + 1][j]); }
  var cb=V(0,0,P[0][0]),cf=V(0,0,P[P.length-1][0]);
  for (j = 0; j < SEG; j++) { var k2 = (j + 1) % SEG; idx.push(cb,R[0][k2],R[0][j],cf,R[P.length - 1][j],R[P.length - 1][k2]); }
  var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3));g.setIndex(idx);g.computeVertexNormals();return g;
}

/* ===== BLUE_MBT_2 重型主战坦克 一体式楔形炮塔(薄尾舱/高发动机舱)----
   BLUE_MBT_2 炮塔按俯视图做“窄炮盾前额→左右复合楔颊→宽尾舱”的
   十边形上下双环(含平台式降低的弹药尾舱),低环比顶环更向前/向外,因而正面同时具有水平与垂直双向倾角。
   20 片侧甲 + 顶/底盖在一个 BufferGeometry 内闭合;视觉壳与命中壳共用,绝无旧 TD 方盒残留。 ===== */
var M1_HULL_HALF_W = 1.05, M1_HULL_X_SCALE = M1_TRACK_X_SCALE; // 车体/走行系共用同一收窄比例,避免物理轮位与视觉轮位分离
var M1_LOWER_GLACIS_ANGLE = 75 * Math.PI / 180;      // 用户指定:首下与水平面精确夹角75°
var M1_LOWER_GLACIS_RISE = 0.54, M1_LOWER_GLACIS_NOSE_Z = 2.80;
var M1_LOWER_GLACIS_BOTTOM_Z = M1_LOWER_GLACIS_NOSE_Z - M1_LOWER_GLACIS_RISE / Math.tan(M1_LOWER_GLACIS_ANGLE);
var M1_LOWER_GLACIS_RX = -M1_LOWER_GLACIS_ANGLE;
var M1_TURRET_CENTER_Z = 0.00;                       // 炮塔座圈与旋转轴都回到车体纵向中心
var M1_HULL_PTS = [
  // 首下高度投影保持0.54m,但纵向投影收至0.1447m,表面长0.5590m,精确75°;首上仍为窄浅带。
  [M1_LOWER_GLACIS_BOTTOM_Z, 0.34], [M1_LOWER_GLACIS_NOSE_Z, 0.88], [2.10, 1.10],
  [-2.56, 1.10], [-2.75, 0.73], [-2.62, 0.34]
];
var M1_ENGINE_DECK_HALF_W = 1.02;                 // AGT-1500后机舱高于前乘员舱
var M1_ENGINE_DECK_PTS = [                         // 闭合梯形发动机舱盖:前坡抬升、后肩落回主壳
  [-1.50, 1.085], [-1.67, 1.25], [-2.45, 1.25], [-2.56, 1.085]
];
var M1_TUR_LO = [                                  // [x,z],十边下环;仅炮盾下前缘两点收回(1.42→1.18),颊甲/尾舱不动
  [-0.38, 1.18], [0.38, 1.18], [1.10, 0.75], [1.15, -1.26], [1.16, -1.39],
  [1.18, -2.20], [-1.18, -2.20], [-1.16, -1.39], [-1.15, -1.26], [-1.10, 0.75]
];
var M1_TUR_LO_Y = [-0.005,-0.005,-0.005,-0.005,0.145,0.145,0.145,0.145,-0.005,-0.005]; // 前段/颊埋甲板1.10下5mm接死;尾舱底埋发动机舱盖1.25下5mm,转扫不穿
var M1_TUR_HI = [                                  // 顶环不动(侧视红色上轮廓)
  [-0.34, 1.08], [0.34, 1.08], [1.00, 0.61], [1.055, -1.21], [1.065, -1.36],
  [1.10, -2.10], [-1.10, -2.10], [-1.065, -1.36], [-1.055, -1.21], [-1.00, 0.61]
];
function m1TurretGeo() {
  var pos = [], idx = [], hiY = 0.72, inside = [0, 0.41, -0.10];
  var n = M1_TUR_LO.length, i;
  /* 中环:侧面/尾按 LO–HI 插值共面,侧视颊甲红轮廓不变。
     仅正脸两点锁在原前装甲面 y0.25/z1.31(侧视蓝线上折)。上带=原斜面,下带=炮盾下斜切。 */
  var MD = [], MDY = [];
  for (i = 0; i < n; i++) {
    var y0 = M1_TUR_LO_Y[i];
    var t = (0.25 - y0) / (hiY - y0);
    if (t < 0) t = 0; if (t > 1) t = 1;
    MDY.push(y0 + t * (hiY - y0));
    MD.push([
      M1_TUR_LO[i][0] + (M1_TUR_HI[i][0] - M1_TUR_LO[i][0]) * t,
      M1_TUR_LO[i][1] + (M1_TUR_HI[i][1] - M1_TUR_LO[i][1]) * t
    ]);
  }
  MD[0] = [-0.36, 1.31]; MDY[0] = 0.25;
  MD[1] = [ 0.36, 1.31]; MDY[1] = 0.25;
  function P(r, i) {
    if (r === 2) return [MD[i][0], MDY[i], MD[i][1]];
    var a = r ? M1_TUR_HI[i] : M1_TUR_LO[i];
    return [a[0], r ? hiY : M1_TUR_LO_Y[i], a[1]];
  }
  function tri(a, b, c) { triOrientPush(pos, idx, inside, a, b, c); }
  function quad(a, b, c, d) { tri(a, b, c); tri(a, c, d); }
  function mid3(p, q) { return [(p[0] + q[0]) * 0.5, (p[1] + q[1]) * 0.5, (p[2] + q[2]) * 0.5]; }
  function midQuad(a, b, c, d) {
    var mB = mid3(a, b), mT = mid3(d, c);
    tri(a, mB, mT); tri(a, mT, d);
    tri(b, c, mT); tri(b, mT, mB);
  }
  function sideBand(rA, rB) {
    for (i = 0; i < n; i++) {
      var j = (i + 1) % n;
      if (Math.abs(M1_TUR_LO[i][0]) === Math.abs(M1_TUR_LO[j][0])) midQuad(P(rA, i), P(rA, j), P(rB, j), P(rB, i));
      else if (Math.abs(M1_TUR_LO[i][0]) < Math.abs(M1_TUR_LO[j][0])) quad(P(rA, j), P(rA, i), P(rB, i), P(rB, j));
      else quad(P(rA, i), P(rA, j), P(rB, j), P(rB, i));
    }
  }
  sideBand(0, 2);
  sideBand(2, 1);
  var cx = 0, cz = 0;
  for (i = 0; i < n; i++) { cx += M1_TUR_HI[i][0]; cz += M1_TUR_HI[i][1]; }
  var C = [cx / n, hiY, cz / n];
  for (i = 0; i < n; i++) { var j = (i + 1) % n; tri(C, P(1, i), P(1, j)); }
  var lowPair = [[0, 1], [9, 2], [8, 3], [7, 4], [6, 5]];
  for (i = 0; i < lowPair.length - 1; i++) {
    var la = lowPair[i], lb = lowPair[i + 1];
    midQuad(P(0, la[1]), P(0, la[0]), P(0, lb[0]), P(0, lb[1]));
  }
  /* 右脸保持上面原始建模不动。丢掉左半(质心x<0)三角,用右半三角作 x 镜像补左脸。 */
  (function mirrorRightFaceToLeft() {
    var newPos = [], newIdx = [], ti, a, b, c, ax, ay, az, bx, by, bz, cx, cy, cz, cent, n0;
    function addTri(x0, y0, z0, x1, y1, z1, x2, y2, z2) {
      n0 = newPos.length / 3;
      newPos.push(x0, y0, z0, x1, y1, z1, x2, y2, z2);
      newIdx.push(n0, n0 + 1, n0 + 2);
    }
    for (ti = 0; ti < idx.length; ti += 3) {
      a = idx[ti]; b = idx[ti + 1]; c = idx[ti + 2];
      ax = pos[a * 3]; ay = pos[a * 3 + 1]; az = pos[a * 3 + 2];
      bx = pos[b * 3]; by = pos[b * 3 + 1]; bz = pos[b * 3 + 2];
      cx = pos[c * 3]; cy = pos[c * 3 + 1]; cz = pos[c * 3 + 2];
      cent = (ax + bx + cx) / 3;
      if (cent >= -1e-6) addTri(ax, ay, az, bx, by, bz, cx, cy, cz);
      if (cent > 1e-6) addTri(-ax, ay, az, -cx, cy, cz, -bx, by, bz);
    }
    pos.length = 0; idx.length = 0;
    for (ti = 0; ti < newPos.length; ti++) pos.push(newPos[ti]);
    for (ti = 0; ti < newIdx.length; ti++) idx.push(newIdx[ti]);
  })();
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function m1MantletGeo() {
  var back = [[-0.30,-0.18],[0.30,-0.18],[0.30,0.10],[0.20,0.20],[-0.20,0.20],[-0.30,0.10]];
  var front = [[-0.27,-0.16],[0.27,-0.16],[0.27,0.09],[0.18,0.18],[-0.18,0.18],[-0.27,0.09]];
  var pos = [], idx = [], B = [], F = [], i;
  for (i = 0; i < back.length; i++) { B.push(pos.length / 3); pos.push(back[i][0], back[i][1], -0.05); }
  for (i = 0; i < front.length; i++) { F.push(pos.length / 3); pos.push(front[i][0], front[i][1], 0.35); }
  /* 跨中轴段(前缘底 0-1 / 顶缘 3-4)中轴剖分:左右三角镜像成对。 对称化。
     quad(a,b,c,d 绕序;a-b 与 d-c 为横边对)。 */
  function mantMidQuad(ai, bi, ci, di) {
    var ax = pos[ai*3], ay = pos[ai*3+1], az = pos[ai*3+2];
    var bx = pos[bi*3], by = pos[bi*3+1], bz = pos[bi*3+2];
    var cx = pos[ci*3], cy = pos[ci*3+1], cz = pos[ci*3+2];
    var dx = pos[di*3], dy = pos[di*3+1], dz = pos[di*3+2];
    var mB = pos.length / 3; pos.push((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);   // 底边中点(x=0)
    var mT = pos.length / 3; pos.push((dx + cx) / 2, (dy + cy) / 2, (dz + cz) / 2);   // 顶边中点(x=0)
    idx.push(ai, mB, mT, ai, mT, di);      // 左半
    idx.push(bi, ci, mT, bi, mT, mB);      // 右半
  }
  for (i = 0; i < back.length; i++) {
    var j = (i + 1) % back.length;
    if (i === 0 || i === 3) mantMidQuad(B[i], B[j], F[j], F[i]);              // 跨界段:中轴剖分
    else if (i >= 4) idx.push(B[i], B[j], F[i], B[j], F[j], F[i]);            // 左半段:外端顶→内端底对角线(与右半镜像一致,绕序 CCW 朝外)
    else idx.push(B[i], B[j], F[j], B[i], F[j], F[i]);
  }
  // 前后盖:质心扇形(闭合 6 三角,左右镜像成对;旧 F[0]/B[0] 放射不对称)。
  var cxf = 0, cyf = 0, cxb = 0, cyb = 0;
  for (i = 0; i < back.length; i++) { cxf += front[i][0]; cyf += front[i][1]; cxb += back[i][0]; cyb += back[i][1]; }
  var Cf = pos.length / 3; pos.push(cxf / back.length, cyf / back.length, 0.35);
  var Cb = pos.length / 3; pos.push(cxb / back.length, cyb / back.length, -0.05);
  for (i = 0; i < back.length; i++) {
    var k = (i + 1) % back.length;
    idx.push(Cf, F[i], F[k]);        // front 盖(保持原绕序)
    idx.push(Cb, B[k], B[i]);        // back 盖(绕序反向)
  }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/* ===== BLUE_MBT_1 双轮廓环铸造炮塔 ----
   新结构只用两条俯视轮廓环搭建主体:下环是完整外扩底缘,上环是等轴内缩顶缘;每一个纵向站位
   仅有“左下/右下/右上/左上”四个角,上下环之间为直母线,所以任意正截面都是标准梯形,绝无
   中腰鼓包或底部回收。两条环沿 Z 方向使用 31 个解析采样点,俯视左右边缘为连续圆弧式曲线。
   顶面、底面、左右斜面分别共享各自顶点以平滑纵向曲率,四条轮廓棱保持硬分界;主体仍是一个
   闭合网格,视觉与 m60turret 命中壳同源。 ===== */
var M60_TURRET_Y = 1.297;                       // 主壳最低 local-y0.018,世界底面1.315埋甲板1.32下0.005接死(蒙布下摆同步收10mm不碰底)
var M60_TUR_FRONT_Z = 1.30, M60_TUR_WIDEST_Z = 0.04, M60_TUR_REAR_Z = -1.70;   // 全长3.00(真实4.01m×0.814≈3.26,向车体4.54收敛取3.00)
/* M60 炮塔按参考图红线三视图数字化重建(u=0 前→1 尾;bw 半宽/lo 底高/hi 顶高,米):
   圆润卵形炮鼻 + 42% 处最宽(半宽1.145=超出车体半履带,参考图) + 侧肩缓收 + 平尾内卷;
   侧视顶线近水平(h≈0.86~0.87)、鼻/尾底收;截面梯形侧壁内收≈21°(tw=bw−0.35·(hi−lo))。
   最宽处取真实比例标定(×0.814),不随车体宽收敛。 */
var M60_TUR_TAB = [   // 宽度按"炮塔超出车体半履带"重标(最宽2.29m=半宽1.145);高度×1.10
  // lo/hi 平滑化为单调过渡
  [0.00, 0.202, 0.204, 0.361], [0.03, 0.260, 0.130, 0.418], [0.06, 0.381, 0.080, 0.508],
  [0.10, 0.542, 0.058, 0.585], [0.14, 0.684, 0.048, 0.644], [0.19, 0.814, 0.044, 0.713],
  [0.25, 0.928, 0.038, 0.793], [0.31, 1.028, 0.034, 0.873], [0.37, 1.121, 0.030, 0.868],
  [0.42, 1.145, 0.025, 0.863], [0.48, 1.118, 0.023, 0.858], [0.55, 1.082, 0.022, 0.858],
  [0.62, 1.051, 0.021, 0.858], [0.70, 1.017, 0.018, 0.869], [0.78, 0.978, 0.030, 0.869],
  [0.86, 0.940, 0.100, 0.869], [0.93, 0.903, 0.180, 0.869], [1.00, 0.889, 0.242, 0.506]
];
function m60TurretSection(z) {
  /* BUG 双保险:入参非有限数(rangeZ 丢失事故那类)时回退最宽站位,
     不再让 NaN 沿 bw/lo/hi 流进放样与附件坐标 → 几何从此不携带 NaN 顶点。
     注:m60TurretTopY 的 NaN 哨兵位(横向出界)是按设计的"不在顶面"信号,不受此影响。 */
  if (!isFinite(z)) z = M60_TUR_WIDEST_Z;
  var u = (M60_TUR_FRONT_Z - z) / (M60_TUR_FRONT_Z - M60_TUR_REAR_Z);
  u = clamp(u, 0, 1);
  var T = M60_TUR_TAB, i = 1;
  while (i < T.length - 1 && T[i][0] < u) i++;
  var a = T[i - 1], b = T[i], f = (u - a[0]) / ((b[0] - a[0]) || 1);
  // 线性插值(移除 smoothstep,消除曲率振荡)
  var bw = a[1] + (b[1] - a[1]) * f, lo = a[2] + (b[2] - a[2]) * f, hi = a[3] + (b[3] - a[3]) * f;
  return { z: z, bw: bw, tw: Math.max(bw * 0.45, bw - 0.35 * (hi - lo)), lo: lo, hi: hi };
}
var M60_TUR_STATIONS = (function () {
  // 低面优化:转角密站保留曲线,中部/尾部疏站形成斜面(16站)
  var out = [], i, z;
  // ① 前鼻转角(高曲率):z 1.30→0.80, 6站(移除冗余站1,间距均匀化0.10m)
  for (i = 0; i <= 5; i++) {
    z = M60_TUR_FRONT_Z + (0.80 - M60_TUR_FRONT_Z) * i / 5;
    out.push(m60TurretSection(z));
  }
  // ② 中部直面(低曲率):z 0.80→0.04, 3站
  for (i = 1; i <= 3; i++) {
    z = 0.80 + (M60_TUR_WIDEST_Z - 0.80) * i / 3;
    out.push(m60TurretSection(z));
  }
  // ③ 后肩转角(中曲率):z 0.04→-0.60, 5站
  for (i = 1; i <= 5; i++) {
    z = M60_TUR_WIDEST_Z + (-0.60 - M60_TUR_WIDEST_Z) * i / 5;
    out.push(m60TurretSection(z));
  }
  // ④ 尾部直面(低曲率):z -0.60→-1.70, 3站
  for (i = 1; i <= 3; i++) {
    z = -0.60 + (M60_TUR_REAR_Z - (-0.60)) * i / 3;
    out.push(m60TurretSection(z));
  }
  return out;
})();
var M60_GUN_Y = (function () {                  // 炮轴取卵鼻中段 z=0.90 截面上下中点
  var s = m60TurretSection(0.90); return (s.lo + s.hi) * 0.5;
})();
function m60TurretGeo() {
  var S = M60_TUR_STATIONS, pos = [], idx = [], inside = [0, 0.40, -0.08];
  function point(s, upper, right) {
    var w = upper ? s.tw : s.bw;
    return [right ? w : -w, upper ? s.hi : s.lo, s.z];
  }
  function vertex(q) { return pushVert(pos, q[0], q[1], q[2]); }
  function tri(a, b, c) { triOrientIdx(pos, idx, inside, a, b, c); }
  /* 带条:midAxis=true 时是跨中轴带(顶/底面),用中轴顶点剖分,左右三角镜像成对;
     否则单侧带(左右斜面)按"外端底→内端顶"对角线剖分,镜像段一致。 */
  function strip(getA, getB, midAxis) {
    var A=[], B=[], M=[], i;
    for (i=0; i<S.length; i++) {
      A.push(vertex(getA(S[i]))); B.push(vertex(getB(S[i])));
      if (midAxis) { var a=getA(S[i]), b=getB(S[i]); M.push(vertex([(a[0]+b[0])*0.5,(a[1]+b[1])*0.5,(a[2]+b[2])*0.5])); }
    }
    for (i=0; i<S.length-1; i++) {
      if (midAxis) {
        // 顶/底面保持原中轴剖分(固定对角线方向,避免tri函数缠绕修正产生空洞)
        tri(A[i],M[i],M[i+1]); tri(A[i],M[i+1],A[i+1]);   // A 侧半
        tri(B[i],B[i+1],M[i+1]); tri(B[i],M[i+1],M[i]);   // B 侧半
      } else {
        // 交替对角线方向消除侧面单向褶皱(防波浪面)
        if (i % 2 === 0) { tri(A[i],A[i+1],B[i+1]); tri(A[i],B[i+1],B[i]); }
        else              { tri(A[i],A[i+1],B[i]);   tri(A[i+1],B[i],B[i+1]); }
      }
    }
  }
  strip(function(s){return point(s,true,false);},  function(s){return point(s,true,true);}, true);    // 顶面(跨中轴):中轴剖分
  strip(function(s){return point(s,false,true);},  function(s){return point(s,false,false);}, true);  // 底面(跨中轴):中轴剖分
  strip(function(s){return point(s,false,false);}, function(s){return point(s,true,false);}, false);  // 左斜面:底左→顶左
  strip(function(s){return point(s,false,true);},  function(s){return point(s,true,true);}, false);   // 右斜面:底右→顶右(与左斜面剖分镜像一致)
  function cap(s) {
    var bl=vertex(point(s,false,false)), br=vertex(point(s,false,true));
    var tr=vertex(point(s,true,true)),   tl=vertex(point(s,true,false));
    var lo=point(s,false,false)[1], hi=point(s,true,true)[1], z=point(s,false,false)[2];
    var mb=vertex([0,lo,z]), mt=vertex([0,hi,z]);         // 底中/顶中:端盖中轴剖分(左右对称)
    tri(bl,mb,mt); tri(bl,mt,tl);                          // 左半
    tri(br,tr,mt); tri(br,mt,mb);                          // 右半
  }
  cap(S[0]); cap(S[S.length-1]);
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/* ===== BLUE_MBT_1炮塔真实附件与车长指挥塔命中壳(实照校正)----
   所有顶置件由新双轮廓环的解析顶面定位;侧装件由梯形直母线求交,避免沿用旧椭圆壳坐标而悬空。
   M19指挥塔改为低矮圆润铸件并保留八块环视玻璃;视觉/命中共用m60CupolaGeo。细杆、光学罩和方形储物篮不制造空气装甲。 ===== */
var M60_DETAIL = {
  commander: { x:0.40, z:-0.28 },                // 顶面恢复真实宽度(tw≈0.81)→附件回原位
  loader:    { x:-0.40, z:-0.38 },
  sight:     { x:-0.30, z:0.45 },
  vent:      { x:-0.44, z:-0.75 },
  /* rangeZ 为必填项:M17A1 测距侧耳全链(m60TurretSideX/m60RangefinderGeo/玻璃窗 vBox)以它为锚,
     缺失(undefined)会使合并模板携带 NaN 顶点=光栅化未定义行为(屏幕随机位置闪长条)。
     测距仪位于炮塔最宽区侧耳(0.04 最宽线附近→0.12,紧挨瞄准镜 0.45 后侧),按轮廓回嵌 */
  rangeZ:    0.12
};
function m60TurretTopY(x,z) {
  var s=m60TurretSection(z);
  return Math.abs(x)<=s.tw+1e-6 ? s.hi : NaN;
}
function m60TurretSideX(y,z) {
  var s=m60TurretSection(z), t=(y-s.lo)/(s.hi-s.lo || 1);
  t=Math.max(0,Math.min(1,t));
  return s.bw+(s.tw-s.bw)*t;
}
function m60TurretFrontSurfaceZ(x,y) {                         // 给炮盾缝边求新主壳真实前表面
  function inside(z) { var s = m60TurretSection(z); if (y < s.lo || y > s.hi) return false; var t = (y - s.lo) / (s.hi - s.lo || 1),w = s.bw + (s.tw - s.bw) * t; return Math.abs(x) <= w; }
  if (inside(M60_TUR_FRONT_Z)) return M60_TUR_FRONT_Z;
  var zo=M60_TUR_FRONT_Z,zi=M60_TUR_WIDEST_Z;
  if (!inside(zi)) return zi;
  for (var i = 0; i < 24; i++) { var zm = (zo + zi) / 2; if (inside(zm)) zi = zm; else zo = zm; }
  return zi;
}
function m60CupolaGeo() {
  // 实车M19为低矮圆润铸件而非锥台:七道圆滑环先微外鼓,再连续收束到顶盖。
  var P=[{y:-0.01,r:0.32},{y:0.035,r:0.33},{y:0.085,r:0.325},{y:0.14,r:0.305},
         {y:0.195,r:0.278},{y:0.245,r:0.235},{y:0.285,r:0.18}];
  var SEG=24,pos=[],idx=[],R=[],inside=[0,0.13,0],i,j;
  function vertex(x,y,z){ return pushVert(pos, x, y, z); }
  function tri(a,b,c){ triOrientIdx(pos, idx, inside, a, b, c); }
  for (i = 0; i < P.length; i++) { R[i] = []; for (j = 0; j < SEG; j++) { var a = j / SEG * TAU; R[i].push(vertex(Math.cos(a) * P[i].r,P[i].y,Math.sin(a) * P[i].r)); } }
  for (i = 0; i < P.length - 1; i++) for (j = 0; j < SEG; j++) { var k = (j + 1) % SEG; tri(R[i][j],R[i][k],R[i + 1][k]); tri(R[i][j],R[i + 1][k],R[i + 1][j]); }
  var cb=vertex(0,P[0].y,0),ct=vertex(0,P[P.length-1].y,0);
  for (j = 0; j < SEG; j++) { var k2 = (j + 1) % SEG; tri(cb,R[0][k2],R[0][j]); tri(ct,R[P.length - 1][j],R[P.length - 1][k2]); }
  var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3));g.setIndex(idx);g.computeVertexNormals();return g;
}
function m60RangefinderGeo(sign,sideX,y,z,roll,yaw) {
  // A1型光学测距仪侧耳:内端嵌甲、外端略收小,正视/侧视均为削角矩形而不是圆柱。
  // roll/yaw(绕耳中心):贴合斜侧壁,缺省 0 保持旧位形。
  var S=[[-0.065,-0.13],[0.065,-0.13],[0.090,-0.080],[0.090,0.080],[0.065,0.13],[-0.065,0.13],[-0.090,0.080],[-0.090,-0.080]]; // [dy,dz]
  var pos=[],idx=[],A=[],B=[],inside=[sign*(sideX+0.06),y,z],i;
  function vertex(x0,y0,z0){ return pushVert(pos, x0, y0, z0); }
  function tri(a,b,c){ triOrientIdx(pos, idx, inside, a, b, c); }
  for (i = 0; i < S.length; i++) A.push(vertex(sign * (sideX - 0.02),y + S[i][0],z + S[i][1]));
  for (i = 0; i < S.length; i++) B.push(vertex(sign * (sideX + 0.15),y + S[i][0] * 0.88,z + S[i][1] * 0.88));
  for (i = 0; i < S.length; i++) { var j = (i + 1) % S.length; tri(A[i],A[j],B[j]); tri(A[i],B[j],B[i]); }
  for (i = 1; i < S.length - 1; i++) { tri(A[0],A[i + 1],A[i]); tri(B[0],B[i],B[i + 1]); }
  if (roll || yaw) {   // 绕耳中心 (sign*sideX,y,z) 先滚转后偏航(RY·RZ,与 vBox 欧拉序一致),内端面转正贴壁
    var _rr = roll || 0, _yw = yaw || 0;
    var _cr = Math.cos(_rr), _sr = Math.sin(_rr), _cw = Math.cos(_yw), _sw = Math.sin(_yw);
    var _cx = sign * sideX;
    for (var _vi = 0; _vi < pos.length; _vi += 3) {
      var _dx = pos[_vi] - _cx, _dy = pos[_vi + 1] - y, _dz = pos[_vi + 2] - z;
      var _qx = _dx * _cr - _dy * _sr, _qy = _dx * _sr + _dy * _cr;
      pos[_vi] = _cx + _qx * _cw + _dz * _sw;
      pos[_vi + 1] = y + _qy;
      pos[_vi + 2] = z - _qx * _sw + _dz * _cw;
    }
  }
  var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3));g.setIndex(idx);g.computeVertexNormals();return g;
}

/* ===== BLUE_MBT_1 105mm火炮大型贴面帆布炮盾(按 M60-3 与实车近照)----
   新罩以后缘0.70m宽的圆角矩形缝边贴住炮塔前脸,
   上沿随铸造鼻部后退、下摆向后下方自然垂落,随后连续收束到钢制炮颈;因此不是圆盘,也不是轴对称橄榄球。
   外皮、后缘非共面环、前后环面与中央炮管通道仍是一件闭合命中壳;缝边、扣片和褶皱只进入视觉层。 ===== */
var M60_MANTLET_PROFILE = [
  // z为基准;zx=左右侧前伸,zt/zb=顶/底后退量。rt/rb分别控制上、下半高,塑出实车垂落下摆。
  {z:0.050,rx:0.340,rt:0.290,rb:0.240,cy:-0.005,n:4.6,attach:1},
  {z:0.110,rx:0.350,rt:0.300,rb:0.250,cy:-0.005,n:4.8,zx:0.140,zt:-0.070,zb:-0.200},
  {z:0.170,rx:0.340,rt:0.290,rb:0.272,cy:-0.008,n:4.6,zx:0.100,zt:-0.050,zb:-0.140},
  {z:0.230,rx:0.315,rt:0.270,rb:0.280,cy:-0.010,n:4.2,zx:0.060,zt:-0.030,zb:-0.090},
  {z:0.280,rx:0.285,rt:0.245,rb:0.265,cy:-0.008,n:3.8,zx:0.030,zt:-0.015,zb:-0.050},
  {z:0.320,rx:0.250,rt:0.215,rb:0.230,cy:-0.006,n:3.4,zx:0.015,zt:-0.008,zb:-0.025},
  {z:0.350,rx:0.215,rt:0.190,rb:0.200,cy:-0.004,n:3.0},
  {z:0.375,rx:0.185,rt:0.170,rb:0.175,cy:-0.002,n:2.6},
  {z:0.395,rx:0.164,rt:0.154,rb:0.158,cy: 0.000,n:2.3}
];
function m60MantletPoint(r,a,scale) {
  var ca=Math.cos(a),sa=Math.sin(a),sc=scale||1,ry=sa>=0?r.rt:r.rb;
  function sg(v){return v<0?-1:1;}
  var x=r.rx*sg(ca)*Math.pow(Math.abs(ca),2/r.n)*sc;
  var y=(r.cy||0)+ry*sg(sa)*Math.pow(Math.abs(sa),2/r.n)*sc;
  var z;
  if (r.attach) z = m60TurretFrontSurfaceZ(x,M60_GUN_Y + y) - 1.0 - 0.005; // 后缘逐点嵌入主壳5mm,非悬浮平环
  else {
    var az=Math.pow(Math.abs(sa),1.35);z=r.z+(r.zx||0)*Math.pow(Math.abs(ca),1.2);
    z+=(sa>=0?(r.zt||0):(r.zb||0))*az;
  }
  return new THREE.Vector3(x,y,z);
}
function m60MantletGeo() {
  var SEG=32,pos=[],idx=[],V=[],i,j;
  function addRing(r) { var out = []; for (var k = 0; k < SEG; k++) { var q = m60MantletPoint(r,k / SEG * TAU,1); out.push(pos.length / 3); pos.push(q.x,q.y,q.z); } return out; }
  function addCircle(rad,z) { var out = []; for (var k = 0; k < SEG; k++) { var a = k / SEG * TAU; out.push(pos.length / 3); pos.push(Math.cos(a) * rad,Math.sin(a) * rad,z); } return out; }
  function quad(a,b,c,d){idx.push(a,b,c,a,c,d);}
  for (i = 0; i < M60_MANTLET_PROFILE.length; i++) V.push(addRing(M60_MANTLET_PROFILE[i]));
  for (i = 0; i < V.length - 1; i++) for (j = 0; j < SEG; j++) { var j1 = (j + 1) % SEG; quad(V[i][j],V[i][j1],V[i + 1][j1],V[i + 1][j]); }
  var innerFront=addCircle(0.126,0.415),innerRear=addCircle(0.145,0.120);
  var outerFront=V[V.length-1],outerRear=V[0];
  for (j = 0; j < SEG; j++) {
    var n1=(j+1)%SEG;
    quad(outerFront[j],outerFront[n1],innerFront[n1],innerFront[j]);
    quad(innerFront[j],innerFront[n1],innerRear[n1],innerRear[j]);
    quad(outerRear[j],innerRear[j],innerRear[n1],outerRear[n1]);
  }
  var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3));g.setIndex(idx);g.computeVertexNormals();return g;
}
function m60MantletRingGeo(i,scale,rad) {             // 按非共面截面生成闭合缝边和横褶。
  var pts=[],r=M60_MANTLET_PROFILE[i];
  for (var k = 0; k < 32; k++) pts.push(m60MantletPoint(r,k / 32 * TAU,scale || 1));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts,true,'centripetal'),32,rad||0.008,4,true);
}
function m60MantletRibGeo(a) {                       // 后缘向炮颈汇聚的放射拉皱
  var pts = []; for (var i = 0; i < M60_MANTLET_PROFILE.length; i++) pts.push(m60MantletPoint(M60_MANTLET_PROFILE[i],a,1.012));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts,false,'centripetal'),16,0.0075,4,false);
}

/* domeCutForMantlet:只为竖槽开微孔——剔除 |x|<0.127, 0.040<y<0.431, z>0.60 的穹胞(面心判定,毛边恒被 0.09 深衬壁遮挡);
   炮翼贴合层/内壁壳由 mantletCastGeo 闭环,多层饼干:穹顶→贴体翼(吻面 0.0008)→鼓包→衬壁/内壁。法线/UV 原样继承。 */
/* 59 炮塔外装甲按参考图红线外轮廓重建(红线轮廓要求:前半不使用任何标准圆)——
   水平截面半径乘 F(θ),θ=与车首+z 夹角;F 表逐 15° 取自红线描迹(左右镜像平均,后端归一=1):
   鼻端外挑 1.13~1.15(炮盾座凸出)、前侧 45°~75° 收束 0.96~1.00、侧后=标准圆。
   视觉穹顶/内衬/命中壳/炮翼 zd() 共用同一函数图⇒所见即所打、炮翼贴面无缝。 */
var DOME59_FOOT = [1.13, 1.15, 1.08, 1.00, 0.97, 0.96, 0.97, 0.98, 0.99, 1.00, 1.00, 1.00, 1.00];
function dome59Foot(t) {
  var a = Math.abs(t) * 12 / Math.PI;                       // 0..12 = 0..180°
  a = Math.max(0, Math.min(11.999, a));
  var i = Math.floor(a), f = a - i;
  // 线性插值(移除 smoothstep)
  return DOME59_FOOT[i] + (DOME59_FOOT[i + 1] - DOME59_FOOT[i]) * f;
}
/* 对称化:SphereGeometry 纬线 quad 剖分左右镜像对称。分辨率 48×16。 */
function dome59SymmetrizeTris(g) {
  var idx = g.index.array, w = 48, h = 16, iy, ix, a, b, c, d, out = [];
  for (iy = 0; iy < h; iy++) for (ix = 0; ix < w; ix++) {
    // quad 四点: a=左上(ix,iy) b=右上(ix+1,iy) c=右下(ix+1,iy+1) d=左下(ix,iy+1);
    // 绕序保持 CCW 朝外(左半与 THREE 原索引同绕序,右半镜像段另一条对角线)
    a = ix + iy * (w + 1); b = a + 1; c = b + w + 1; d = a + w + 1;
    if (ix >= 12 && ix < 36) out.push(b, a, d, b, d, c);   // 右半(48段:ix12..35=φ90°..270°)
    else out.push(a, d, c, a, c, b);                        // 左半:原对角线
  }
  g.setIndex(out);
  return g;
}

function dome59Constrict(g) {
  var p = g.attributes.position.array, i, x, z, r, w;
  for (i = 0; i < p.length; i += 3) {
    x = p[i]; z = p[i + 2]; r = Math.hypot(x, z);
    if (r > 1e-6) {
      w = dome59Foot(Math.acos(Math.max(-1, Math.min(1, z / r))));
      p[i] = x * w; p[i + 2] = z * w;
    }
  }
  g.attributes.position.needsUpdate = true;
  dome59SymmetrizeTris(g);   // 剖分左右镜像一致(右半段换对角线)
  mergeCoincidentVerts(g);   // 合并接缝/极顶重复顶点,法线统一(左半接缝折痕消除)
  g.computeVertexNormals();
  return g;
}
function domeCutForMantlet(dome) {
  var p = dome.attributes.position.array, idx = dome.index.array, keep = [];
  for (var t = 0; t < idx.length; t += 3) {
    var cx = 0, cy = 0, cz = 0;
    for (var j = 0; j < 3; j++) { var vi = idx[t + j] * 3; cx += p[vi]; cy += p[vi + 1]; cz += p[vi + 2]; }
    cx /= 3; cy /= 3; cz /= 3;
    if (Math.abs(cx) < 0.127 && cy > 0.040 && cy < 0.431 && cz > 0.60) continue;
    keep.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  dome.setIndex(keep);
  return dome;
}
function dome59HitGeo() {
  var XS = [-0.295, -0.265, -0.235, -0.205, -0.175, -0.1475, -0.120, -0.09, -0.06, -0.03, 0, 0.03, 0.06, 0.09, 0.120, 0.1475, 0.175, 0.205, 0.235, 0.265, 0.295];
  var YS = [0.012, 0.029, 0.046, 0.07375, 0.1015, 0.12925, 0.157, 0.18475, 0.2125, 0.24025, 0.268, 0.29575, 0.3235, 0.35125, 0.379, 0.402, 0.425, 0.4475, 0.47, 0.4925, 0.515];
  var NX = XS.length, NY = YS.length;
  var NAZ_OPEN = 28;
  var NAZ_FRONT = NX - 1; // 20
  var NAZ_TOTAL = NAZ_OPEN + NAZ_FRONT; // 48

  var positions = [];
  var indices = [];

  function addVert(p) {
    var idx = positions.length / 3;
    positions.push(p[0], p[1], p[2]);
    return idx;
  }

  // 与美术建模完全共形: 与 visual dome (SphereGeometry(0.98,48,16).scale(1,0.64,1) + dome59Constrict) 严格 1:1 数学一致
  function evalVisualPoint(theta, phi) {
    var radius = 0.98;
    var xSph = -radius * Math.cos(phi) * Math.sin(theta);
    var ySph = radius * Math.cos(theta);
    var zSph = radius * Math.sin(phi) * Math.sin(theta);
    var y = ySph * 0.64;
    var rLat = Math.hypot(xSph, zSph);
    var x = 0, z = 0;
    if (rLat > 1e-6) {
      var ang = Math.acos(Math.max(-1, Math.min(1, zSph / rLat)));
      var w = dome59Foot(ang);
      x = xSph * w;
      z = zSph * w;
    }
    return [x, y, z];
  }

  function zd(x, y) {
    var q = 1 - (y * y) / 0.39343;
    if (q <= 0) return 0;
    var k = 0.98 * Math.sqrt(q), ax = Math.abs(x), lo = 0, hi = Math.PI / 2, i, t;
    for (i = 0; i < 25; i++) {
      t = (lo + hi) / 2;
      if (k * dome59Foot(t) * Math.sin(t) < ax) lo = t;
      else hi = t;
    }
    t = (lo + hi) / 2;
    return k * dome59Foot(t) * Math.cos(t);
  }

  function getPhiMantlet(y) {
    var cosTh = Math.max(-1, Math.min(1, y / 0.6272));
    var theta = Math.acos(cosTh);
    var lo = Math.PI / 2, hi = Math.PI, i, mid, p;
    for (i = 0; i < 30; i++) {
      mid = (lo + hi) / 2;
      p = evalVisualPoint(theta, mid);
      if (p[0] < 0.295) lo = mid;
      else hi = mid;
    }
    var phiR = (lo + hi) / 2;
    var phiL = Math.PI - phiR;
    return { theta: theta, phiL: phiL, phiR: phiR };
  }

  // 1. 中段穹体(y 在 YS 范围, 严格沿美术模型曲面展开, 开口边缘严格对齐 x = ±0.295 与 y ∈ [0.012, 0.515])
  var midGrid = [];
  for (var iy = 0; iy < NY; iy++) {
    var y = YS[iy];
    var mp = getPhiMantlet(y);
    var row = [];
    for (var ia = 0; ia <= NAZ_OPEN; ia++) {
      var frac = ia / NAZ_OPEN;
      var phi = mp.phiR + frac * (Math.PI * 2 + mp.phiL - mp.phiR);
      var pt = evalVisualPoint(mp.theta, phi);
      if (ia === 0) { pt[0] = 0.295; pt[2] = zd(0.295, y); }
      else if (ia === NAZ_OPEN) { pt[0] = -0.295; pt[2] = zd(-0.295, y); }
      row.push(addVert(pt));
    }
    midGrid.push(row);
  }

  for (var iy = 0; iy < NY - 1; iy++) {
    var r0 = midGrid[iy], r1 = midGrid[iy + 1];
    for (var ia = 0; ia < NAZ_OPEN; ia++) {
      var v00 = r0[ia], v01 = r0[ia + 1], v10 = r1[ia], v11 = r1[ia + 1];
      indices.push(v00, v01, v11, v00, v11, v10);
    }
  }

  // 2. 顶盖段(y: 0.515 -> 0.6272, 严格贴合美术穹顶顶部几何)
  var ringTop0 = [];
  for (var ix = 0; ix < NX - 1; ix++) {
    var x = XS[ix];
    ringTop0.push(addVert([x, 0.515, zd(x, 0.515)]));
  }
  for (var ia = 0; ia < NAZ_OPEN; ia++) {
    ringTop0.push(midGrid[NY - 1][ia]);
  }

  var mpTop = getPhiMantlet(0.515);
  var THETA_TOP_LEVELS = [mpTop.theta * 0.75, mpTop.theta * 0.50, mpTop.theta * 0.25];
  var prevRing = ringTop0;

  for (var iyt = 0; iyt < THETA_TOP_LEVELS.length; iyt++) {
    var th = THETA_TOP_LEVELS[iyt];
    var currRing = [];
    for (var i = 0; i < NAZ_TOTAL; i++) {
      var phi;
      if (i < NAZ_FRONT) {
        var frac = i / NAZ_FRONT;
        phi = mpTop.phiL + frac * (mpTop.phiR - mpTop.phiL);
      } else {
        var frac = (i - NAZ_FRONT) / NAZ_OPEN;
        phi = mpTop.phiR + frac * (Math.PI * 2 + mpTop.phiL - mpTop.phiR);
      }
      currRing.push(addVert(evalVisualPoint(th, phi)));
    }
    for (var i = 0; i < NAZ_TOTAL; i++) {
      var nextI = (i + 1) % NAZ_TOTAL;
      var v00 = prevRing[i], v01 = prevRing[nextI], v10 = currRing[i], v11 = currRing[nextI];
      indices.push(v00, v01, v11, v00, v11, v10);
    }
    prevRing = currRing;
  }

  var apexIdx = addVert(evalVisualPoint(0, 0));
  for (var i = 0; i < NAZ_TOTAL; i++) {
    var nextI = (i + 1) % NAZ_TOTAL;
    indices.push(prevRing[i], prevRing[nextI], apexIdx);
  }

  // 3. 底裙段(y: 0.012 -> -0.0394, 严格贴合美术炮塔底沿及座圈)
  var ringBot0 = [];
  for (var ix = 0; ix < NX - 1; ix++) {
    var x = XS[ix];
    ringBot0.push(addVert([x, 0.012, zd(x, 0.012)]));
  }
  for (var ia = 0; ia < NAZ_OPEN; ia++) {
    ringBot0.push(midGrid[0][ia]);
  }

  var mpBot = getPhiMantlet(0.012);
  var THETA_BOT_LEVELS = [Math.PI * 0.50, Math.PI * 0.52];
  var prevBotRing = ringBot0;

  for (var iyb = 0; iyb < THETA_BOT_LEVELS.length; iyb++) {
    var th = THETA_BOT_LEVELS[iyb];
    var currBotRing = [];
    for (var i = 0; i < NAZ_TOTAL; i++) {
      var phi;
      if (i < NAZ_FRONT) {
        var frac = i / NAZ_FRONT;
        phi = mpBot.phiL + frac * (mpBot.phiR - mpBot.phiL);
      } else {
        var frac = (i - NAZ_FRONT) / NAZ_OPEN;
        phi = mpBot.phiR + frac * (Math.PI * 2 + mpBot.phiL - mpBot.phiR);
      }
      currBotRing.push(addVert(evalVisualPoint(th, phi)));
    }
    for (var i = 0; i < NAZ_TOTAL; i++) {
      var nextI = (i + 1) % NAZ_TOTAL;
      var v00 = prevBotRing[i], v01 = prevBotRing[nextI], v10 = currBotRing[i], v11 = currBotRing[nextI];
      indices.push(v00, v10, v11, v00, v11, v01);
    }
    prevBotRing = currBotRing;
  }

  var botCenter = addVert([0.0, positions[prevBotRing[0] * 3 + 1], 0.0]);
  for (var i = 0; i < NAZ_TOTAL; i++) {
    var nextI = (i + 1) % NAZ_TOTAL;
    indices.push(prevBotRing[i], botCenter, prevBotRing[nextI]);
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
/* ===== 铸炮翼与穹顶一体铸造 builder(炮盾后移贴炮根、内曲面与装甲外曲面多层饼干式贴合;终版 v2) ----
   穹顶函数图 (x,y)→z_d=0.98·√(1−x²/0.9604−y²/0.39343):翼面=z_d+bump(鼓包→0 于缘口⇒与存活穹胞连续,多层饼干由内而末层),
   缘口外挑 0.035 裙舌下探 -0.030 塞入穹面切口线下(隐形缝合,无悬浮层⇒无刀影);竖槽 |x|<0.120, 0.046<y<0.425 通孔配深色衬壁;
   内壁壳 z_d-0.025 同域(翻面)封膛。枢轴 C=(0,0.23,0.60) 沿用(机制不动)。 ===== */
function mantletCastGeo() {
  var XS = [-0.295, -0.265, -0.235, -0.205, -0.175, -0.1475, -0.120, -0.09, -0.06, -0.03, 0, 0.03, 0.06, 0.09, 0.120, 0.1475, 0.175, 0.205, 0.235, 0.265, 0.295];
  var YS = [0.012, 0.029, 0.046, 0.07375, 0.1015, 0.12925, 0.157, 0.18475, 0.2125, 0.24025, 0.268, 0.29575, 0.3235, 0.35125, 0.379, 0.402, 0.425, 0.4475, 0.47, 0.4925, 0.515];
  var SX = 0.120, SY0 = 0.046, SY1 = 0.425, SKIN = 0.004, KISS = 0.0008, LD = 0.09;   // 槽半宽/槽底/槽顶/贴面/吻贴/衬壁深
  function zd(x, y) {   // 穹面改红线外轮廓函数图——k=该高度截面基准半径,二分解方位角 θ:k·F(θ)·sinθ=|x|,z=k·F(θ)·cosθ
    var q = 1 - (y * y) / 0.39343; if (q <= 0) return 0;
    var k = 0.98 * Math.sqrt(q), ax = Math.abs(x), lo = 0, hi = Math.PI / 2, i, t;
    for (i = 0; i < 22; i++) { t = (lo + hi) / 2; if (k * dome59Foot(t) * Math.sin(t) < ax) lo = t; else hi = t; }
    t = (lo + hi) / 2;
    return k * dome59Foot(t) * Math.cos(t);
  }
  function ss(t) { t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }
  function bump(x, y) {
    var fx = 1 - ss((Math.abs(x) - 0.17) / 0.13), fy = 1 - ss((Math.abs(y - 0.23) - 0.115) / 0.13);
    var rax = Math.hypot(x, y - 0.23);
    return 0.028 * fx * fy + 0.012 * (1 - ss((rax - 0.16) / 0.05));   // 鼓包渐开(柔柔铸造翼块,防悬浮刀影)+承口环(正视外环)
  }
  function face(x, y) { return zd(x, y) + SKIN + bump(x, y); }
  var posA = [], idxA = [], posB = [], idxB = [];
  function triA(p1, p2, p3) { var b = posA.length / 3; posA.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]); idxA.push(b, b + 1, b + 2); }
  function triB(p1, p2, p3) { var b = posB.length / 3; posB.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]); idxB.push(b, b + 1, b + 2); }
  var NX = XS.length, NY = YS.length, ix, iy, k;
  var gF = [];                                             // 仅保留翼面外表面(吻贴背面/内壁壳已被外装甲完全遮蔽, 删除)
  for (iy = 0; iy < NY; iy++) { gF[iy] = [];
    for (ix = 0; ix < NX; ix++) { gF[iy][ix] = posA.length / 3; posA.push(XS[ix], YS[iy], face(XS[ix], YS[iy])); } }
  function isSlotCell(ix2, iy2) { return Math.abs((XS[ix2] + XS[ix2 + 1]) / 2) < SX && (YS[iy2] + YS[iy2 + 1]) / 2 > SY0 && (YS[iy2] + YS[iy2 + 1]) / 2 < SY1; }
  for (ix = 0; ix < NX - 1; ix++) for (iy = 0; iy < NY - 1; iy++) {
    if (isSlotCell(ix, iy)) continue;
    idxA.push(gF[iy][ix], gF[iy][ix + 1], gF[iy + 1][ix + 1], gF[iy][ix], gF[iy + 1][ix + 1], gF[iy + 1][ix]);   // 翼面外表面(唯一可见面)
  }
  for (ix = 0; ix < NX - 1; ix++) for (iy = 0; iy < NY - 1; iy++) {   // 外缘圈壁(正面↔吻贴背面封边,平直刻面)
    if (isSlotCell(ix, iy)) continue;
    var xx0 = XS[ix], xx1 = XS[ix + 1], yy0 = YS[iy], yy1 = YS[iy + 1];
    var wF00 = [xx0, yy0, face(xx0, yy0)], wF10 = [xx1, yy0, face(xx1, yy0)], wF11 = [xx1, yy1, face(xx1, yy1)], wF01 = [xx0, yy1, face(xx0, yy1)];
    var wB00 = [xx0, yy0, zd(xx0, yy0) + KISS], wB10 = [xx1, yy0, zd(xx1, yy0) + KISS], wB11 = [xx1, yy1, zd(xx1, yy1) + KISS], wB01 = [xx0, yy1, zd(xx0, yy1) + KISS];
    if (iy === NY - 2) { triA(wF01, wF11, wB11); triA(wF01, wB11, wB01); }
    if (iy === 0)      { triA(wF00, wB00, wB10); triA(wF00, wB10, wF10); }
    if (ix === NX - 2) { triA(wF10, wB10, wB11); triA(wF10, wB11, wF11); }
    if (ix === 0)      { triA(wF00, wF01, wB01); triA(wF00, wB01, wB00); }
  }
  function lip(xa, ya, xb, yb, outward) {                             // 槽缘衬壁(向孔内,深色平直)
    var F0 = [xa, ya, face(xa, ya)], F1 = [xb, yb, face(xb, yb)], G0 = [xa, ya, face(xa, ya) - LD], G1 = [xb, yb, face(xb, yb) - LD];
    if (outward === 'px' || outward === 'ny') { triB(F0, G0, G1); triB(F0, G1, F1); }
    else { triB(F0, F1, G1); triB(F0, G1, G0); }
  }
  for (iy = 2; iy <= 15; iy++) { lip(-SX, YS[iy], -SX, YS[iy + 1], 'px'); lip(SX, YS[iy], SX, YS[iy + 1], 'nx'); }
  for (ix = 6; ix <= 13; ix++) { lip(XS[ix], SY0, XS[ix + 1], SY0, 'py'); lip(XS[ix], SY1, XS[ix + 1], SY1, 'ny'); }
  function fin(pos, idx) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  /* ===== 竖槽黑色装甲弧面封板(随炮塞件深藏槽内会被身管切成「绿色横条」,遮不住镂空;
     故用随塔固定弧面装甲板填补:与翼面同一函数图 face=zd+SKIN+bump、同一网格节点(槽胞域 ix[6,14]xiy[2,16])
     ⇒与存活翼面/槽缘唇壁逐点共线=零缝零 z-fight 域(翼面槽胞本剔);炮管俯仰直接穿模板面,封堵与姿态解耦。 ===== */
  var PLX0 = 6, PLX1 = 14, PLY0 = 2, PLY1 = 16;               // 封板节点域=竖槽胞域(|x|<=0.120 共 9 列,0.046<=y<=0.425 共 15 行)
  var posP = [], idxP = [], gp2 = [];
  for (iy = PLY0; iy <= PLY1; iy++) { gp2[iy - PLY0] = [];
    for (ix = PLX0; ix <= PLX1; ix++) { gp2[iy - PLY0][ix - PLX0] = posP.length / 3; posP.push(XS[ix], YS[iy], face(XS[ix], YS[iy])); } }
  for (ix = PLX0; ix < PLX1; ix++) for (iy = PLY0; iy < PLY1; iy++) {
    var aP = gp2[iy - PLY0][ix - PLX0], bP = gp2[iy - PLY0][ix + 1 - PLX0], cP = gp2[iy + 1 - PLY0][ix + 1 - PLX0], dP = gp2[iy + 1 - PLY0][ix - PLX0];
    idxP.push(aP, bP, cP, aP, cP, dP);                          // 与翼面同绕序(+z 外,共享网格点平滑法线)
  }
  return { skin: fin(posA, idxA), liner: fin(posB, idxB), plate: fin(posP, idxP) };
}
/* ============================================================
   载具风化(weathering)—— 三层, 全部绕开 UV
   uvSetFlat 把整车顶点钉死在画集平坦采样点(u 0.05 / v 0.40), 故法线贴图/AO/脏污图/chipping 图
   在本架构下物理上不可能工作。唯一现成且免费的通道是 mergeVisParts 已经在写的顶点色 color。
   分层顺序严格遵循军模方法论(色彩调制 → 渍洗 → 掉漆 → 锈 → 灰尘)。
   参考: 程序化风化三原理(曲率磨损 / 重力积尘 / 通道打包 + 分层顺序, strayspark);
        军模四阶段法(Tale of Painters)与「锈只在受热件、绝不在履带」「少即是多」(DakkaDakka)。
   ============================================================ */
var WEATHER_BAKE_AMT = 1.0;                 // 顶点烘焙层强度; 0 = 与改动前逐顶点等价(回滚开关)
var WEATHER_AMT      = 1.0;                 // 片元层强度; 0 = 与改动前逐像素等价(回滚开关)
/* ★varying 预算安全阀: 实测载具顶点着色器 = 基础 6 + vWOP + vWHit = 8, 正好是 GLSL ES 1.00 保证的
   MAX_VARYING_VECTORS 下限。移动端若再多一盏投影灯就会超出 → 链接失败 → 载具整体不渲染。
   置 WX_SCORCH = 0 可在编译期摘掉 vWHit(回落到 7), 保留积尘/压暗/灰尘色联动, 只丢局部焦痕。
   注意: 必须在首辆载具构建之前设置(它写进 material.defines, 改动后需重编译)。 */
var WX_SCORCH        = 1;
var _WX_STEEL = [0.2353, 0.2549, 0.2824];   // 掉漆露钢(与色板 cSTEEL 同色)
var _WX_RUST  = [0.290, 0.130, 0.062];      // 锈色(低明度暖褐) = 老锈极(暗红棕)
var _WX_RUST_NEW = [0.435, 0.205, 0.068];   // ★优化A: 新锈极(亮橙) — 实车锈龄两极: 新锈亮橙(数小时~数日), 老锈暗红棕(数月+)
/* ★优化H: 战损延迟锈的「半径+时刻」打包 —— aVehHit(实例)/uVehHit(玩家) 是仅有的战损 vec4 槽, 无空位另带命中时刻;
   w 打包 = 整数位半径(1/64m 量化, ≤127=1.98m) + 小数位时刻(0.5s 量化, ≤2047.5s 会话时钟)。
   该值对每实例/每 draw 恒为常量 → varying 插值恒等; float32 尾数 23 位 > 19 位打包位, 解码精确。
   会话时钟 = performance.now 相对值(写入端 _wxNowSec / 片元基准 uWxNow 同源, 与战损的运行时事件性不冲突确定性纪律)。 */
var _wxT0S = (typeof performance !== 'undefined' && performance.now) ? performance.now() * 0.001 : 0;
function _wxNowSec() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() * 0.001 - _wxT0S : 0;
}
function _wxPackHitW(r, tSec) {
  var R = Math.round(r * 64); if (R < 1) R = 1; if (R > 127) R = 127;
  var T = Math.floor(tSec * 2); if (T < 0) T = 0; if (T > 4095) T = 4095;
  return R + T / 4096;
}
function _wxHash01(a, b) {                  // 逐件确定性哈希(同型号同种子 → 每次构建逐位一致)
  var h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function _wxSS(e0, e1, x) { var t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }
/* ===== 风化邻接预分析(建模期一次性, 每模板一次)=====
   weatherBakePart 原本只看"件内"(自身包络+法线+颜色), 回答不了"件与件"的关系。
   本预分析回答(写入 p.g.userData, 随 hint 进烘焙; 残骸/模板管线只读 _wpCyl, 互不干扰):
   · R2 底边接平面: 垂直件 P 的底边落在另一件 Q 的平顶上(容差 4.5cm + XZ 交叠), 或触地(y0<0.12)
     → P._wxBase=1, 烘焙在底线做斑点锈+脱漆;
   · R4 悬空附件缝: 小件 P 侧贴大件 Q(P 交叠 Q + P 侧向探出 Q 立面 4.5cm 以上 + P 底边悬在 Q 立面跨度内
     + P 底离地 0.35m 以上 + P 底无承托件)→ 在 Q 上记缝 {y,ax,s,u0,u1}, 烘焙在缝下做流锈;
   · R3 命中标记: group 非发光件组即有命中判定 → _wxHitG(缺省 true; weapons/残骸等无名调用沿缺省)。
   · R1 大垂直面 / R3 箱角几何: 件内可判定(包络+法线分箱), 无需预分析, 直接在烘焙里算。
   开销: 每件一次顶点遍历 + O(P²) 包络对测, 模板级一次性, 逐帧零成本。
   确定性: 纯几何判定, 不引入随机源(随机只在烘焙里经 _wxHash01(partIdx,seed) 发生, 同型号逐位一致)。 */
/* ★优化E: 折角贴面物证 —— 件在折线 (ex,ez) 处必须有「角柱 + X 面近角 + Z 面近角」三组顶点
   (覆盖式, 与优化B 同方法论: 粗细分件的边列即角柱, 面在顶点之间; 斜面/圆件顶点到不了角柱, 自然出局)。 */
function _wxFoldWit(g, ex, ez) {
  var a = g.attributes, pp = a.position.array, nv = a.position.count;
  var col = 0, wx = 0, wz = 0;
  for (var v = 0; v < nv; v++) {
    var adx = pp[v * 3] - ex; if (adx < 0) adx = -adx;
    var adz = pp[v * 3 + 2] - ez; if (adz < 0) adz = -adz;
    if (adx <= 0.045 && adz <= 0.16) wx++;
    if (adz <= 0.045 && adx <= 0.16) wz++;
    if (adx <= 0.045 && adz <= 0.045) col++;
  }
  return col >= 2 && wx >= 2 && wz >= 2;
}
function _wxAdjacencyPass(parts, group) {
  var nP = parts.length, i, j, v;
  var hasHitG = (group !== 'hullGlow' && group !== 'turretGlow');
  /* R2 组承接门: 「触地」分支只在组本地 y=0 确有承接平面的组里成立——
     hull=整车原点贴地(地面), turret=座圈平面(塔底坐甲板)。
     gun/mantlet(耳轴平面)/mainRotor/tailRotor(桨毂平面)/无名调用(weapons 火箭弹体)
     的本地 y0<0.12 只是坐标系巧合, 并非接平面: 炮管底线/桨毂/火箭弹体不该长潮气锈线。 */
  var hasSeatG = (group === 'hull' || group === 'turret');
  var ST = new Array(nP);
  for (i = 0; i < nP; i++) {
    var ga = parts[i].g.attributes, pp = ga.position.array, nn = ga.normal.array, nv = ga.position.count;
    var x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (v = 0; v < nv; v++) {
      var X = pp[v * 3], Y = pp[v * 3 + 1], Z = pp[v * 3 + 2];
      if (X < x0) x0 = X; if (Y < y0) y0 = Y; if (Z < z0) z0 = Z;
      if (X > x1) x1 = X; if (Y > y1) y1 = Y; if (Z > z1) z1 = Z;
    }
    var upT = 0, vF = 0, bxF = 0;
    for (v = 0; v < nv; v++) {
      var nx = nn[v * 3], ny = nn[v * 3 + 1], nz = nn[v * 3 + 2], ay = ny < 0 ? -ny : ny;
      if (ay < 0.5) vF++;
      if (Math.max(nx < 0 ? -nx : nx, ay, nz < 0 ? -nz : nz) > 0.8) bxF++;
      if (ny > 0.72 && pp[v * 3 + 1] > y1 - 0.07) upT++;
    }
    ST[i] = { x0: x0, y0: y0, z0: z0, x1: x1, y1: y1, z1: z1, n: nv,
              up: upT / Math.max(nv, 1), vf: vF / Math.max(nv, 1), bf: bxF / Math.max(nv, 1) };
    var ud = parts[i].g.userData;
    if (!ud) { ud = {}; parts[i].g.userData = ud; }
    ud._wxHitG = hasHitG;
    ud._wxBase = 0; ud._wxSeams = null; ud._wxShade = null; ud._wxFolds = null;
  }
  /* ★优化B: 面级接触验证 —— 包络对过门不代表面真的在那。判定用「覆盖」而非「命中」:
     粗细分大墙/大甲板的顶点只存在于边角, 面在顶点之间 —— 合格顶点的分布范围罩住接触区即算面存在;
     空包络(圆柱 AABB 角/剥面件)、曲顶肩部悬浮件、缝下无立面的死缝仍被杀。
     (R2 落顶复核 + R4 缝复核, 探出阈 4.5→2.2cm 薄挂件纳入; 复核公式与烘焙落锈逻辑同构) */
  for (i = 0; i < nP; i++) {
    var A = ST[i], udi = parts[i].g.userData;
    if (hasSeatG && A.y0 < 0.12 && A.vf > 0.40 && (A.y1 - A.y0) > 0.22) udi._wxBase = 1;   // R2: 触地即接平面(仅限有承接平面的组, 见 hasSeatG)
    for (j = 0; j < nP; j++) {
      if (j === i) continue;
      var B = ST[j];
      /* R2: A(垂直件)底边落在 B(平顶件)顶面上 */
      if (!udi._wxBase && Math.abs(A.y0 - B.y1) < 0.045 && (B.up > 0.06 || B.bf > 0.55) &&
          A.vf > 0.40 && (A.y1 - A.y0) > 0.22) {
        var fA = Math.max((A.x1 - A.x0) * (A.z1 - A.z0), 1e-4);
        var oX = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        var oZ = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0);
        if (oX > 0 && oZ > 0 && (oX * oZ) > 0.12 * fA) {
          /* ★优化B: 顶面覆盖复核 —— B 的上向顶点(近顶面 ±10cm)的 XZ 分布须罩住交叠矩形
             (覆盖而非命中: 粗细分甲板顶点只在角上; 圆柱空包络角/曲顶肩部悬浮件仍被杀) */
          var gaT = parts[j].g.attributes, ppT = gaT.position.array, nnT = gaT.normal.array, nvT = gaT.position.count;
          var tc = 0, tx0 = 1e9, tx1 = -1e9, tz0 = 1e9, tz1 = -1e9;
          for (var tw = 0; tw < nvT; tw++) {
            if (nnT[tw * 3 + 1] < 0.6) continue;
            var tyv = ppT[tw * 3 + 1];
            if (tyv < B.y1 - 0.10 || tyv > B.y1 + 0.02) continue;
            var txv = ppT[tw * 3], tzv = ppT[tw * 3 + 2];
            if (txv < tx0) tx0 = txv; if (txv > tx1) tx1 = txv;
            if (tzv < tz0) tz0 = tzv; if (tzv > tz1) tz1 = tzv;
            tc++;
          }
          if (tc > 0 && tx0 <= Math.max(A.x0, B.x0) + 0.08 && tx1 >= Math.min(A.x1, B.x1) - 0.08 &&
              tz0 <= Math.max(A.z0, B.z0) + 0.08 && tz1 >= Math.min(A.z1, B.z1) - 0.08) udi._wxBase = 1;
        }
      }
      /* ★优化D: 凹腔遮蔽 —— B 底部高于 A 底部 5cm 以上且 XZ 投影交叠>4cm → A 交叠区内低于 B 底 3cm 的顶点吃暖暗渍
         (无 UV 下近似 Substance AO Dirt 生成器: 炮塔座圈/工具箱下/挡泥板下履带顶; 多盒指数饱和) */
      if (B.y0 > A.y0 + 0.05 && (B.x1 - B.x0) * (B.y1 - B.y0) * (B.z1 - B.z0) > 0.002) {
        var gX0 = Math.max(A.x0, B.x0), gX1 = Math.min(A.x1, B.x1);
        var gZ0 = Math.max(A.z0, B.z0), gZ1 = Math.min(A.z1, B.z1);
        if (gX1 - gX0 > 0.04 && gZ1 - gZ0 > 0.04) {
          if (!udi._wxShade) udi._wxShade = [];
          udi._wxShade.push({ x0: gX0, x1: gX1, z0: gZ0, z1: gZ1, yb: B.y0 });
        }
      }
      /* R4: A=附件 P 侧贴 B=受体 Q → 在 Q 上记缝 */
      var udj = parts[j].g.userData;
      if (udj._wxSeams && udj._wxSeams.length >= 4) continue;                 // 每受体至多 4 道缝
      var vA = (A.x1 - A.x0) * (A.y1 - A.y0) * (A.z1 - A.z0);
      var vB = (B.x1 - B.x0) * (B.y1 - B.y0) * (B.z1 - B.z0);
      if (vA >= vB || vB < 0.05) continue;                                    // P 须小于 Q, Q 须是像样的体
      var eA = Math.max(A.x1 - A.x0, A.y1 - A.y0, A.z1 - A.z0);
      if (eA < 0.12) continue;                                                // 螺栓级小件不记缝
      if (B.vf < 0.30 || (B.y1 - B.y0) < 0.40) continue;                      // Q 须有竖立面
      var qX = Math.min(A.x1, B.x1 + 0.025) - Math.max(A.x0, B.x0 - 0.025);   // 交叠(2.5cm 容差)
      var qY = Math.min(A.y1, B.y1 + 0.025) - Math.max(A.y0, B.y0 - 0.025);
      var qZ = Math.min(A.z1, B.z1 + 0.025) - Math.max(A.z0, B.z0 - 0.025);
      if (qX <= 0 || qY <= 0 || qZ <= 0) continue;
      if (!(A.y0 > B.y0 + 0.12 && A.y0 > 0.35 && A.y0 < B.y1 - 0.03)) continue;  // P 底悬在 Q 立面跨度内
      var bP = -1, bAx = -1, bS = 0;                                          // P 穿出 Q 哪块侧立面?取探出最大者
      if (A.x0 < B.x1 && A.x1 > B.x1 && (A.x1 - B.x1) > 0.022 && (A.x1 - B.x1) > bP) { bP = A.x1 - B.x1; bAx = 0; bS = 1; }
      if (A.x0 < B.x0 && A.x1 > B.x0 && (B.x0 - A.x0) > 0.022 && (B.x0 - A.x0) > bP) { bP = B.x0 - A.x0; bAx = 0; bS = -1; }
      if (A.z0 < B.z1 && A.z1 > B.z1 && (A.z1 - B.z1) > 0.022 && (A.z1 - B.z1) > bP) { bP = A.z1 - B.z1; bAx = 2; bS = 1; }
      if (A.z0 < B.z0 && A.z1 > B.z0 && (B.z0 - A.z0) > 0.022 && (B.z0 - A.z0) > bP) { bP = B.z0 - A.z0; bAx = 2; bS = -1; }
      if (bAx < 0) continue;
      var sup = false;                                                       // 承托检查: P 底下方 6cm 内有承托件 → 非悬空
      for (var k = 0; k < nP && !sup; k++) {
        if (k === i || k === j) continue;
        var C = ST[k];
        if (C.y1 > A.y0 - 0.06 && C.y1 < A.y0 + 0.025) {
          var sX = Math.min(A.x1, C.x1) - Math.max(A.x0, C.x0);
          var sZ = Math.min(A.z1, C.z1) - Math.max(A.z0, C.z0);
          var fP = Math.max((A.x1 - A.x0) * (A.z1 - A.z0), 1e-4);
          if (sX > 0 && sZ > 0 && (sX * sZ) > 0.25 * fP) sup = true;
        }
      }
      if (sup) continue;
      var u0, u1;
      if (bAx === 0) { u0 = Math.max(A.z0, B.z0); u1 = Math.min(A.z1, B.z1); }
      else { u0 = Math.max(A.x0, B.x0); u1 = Math.min(A.x1, B.x1); }
      if (u1 - u0 < 0.05) continue;
      /* ★优化B: 缝区覆盖复核(与烘焙落锈同构: 外向法线>0.35 × 外半空间 × 缝下 0.68m 带) ——
         Q 的合格立面顶点沿缝线方向的分布须罩住整条缝跨度(粗细分大墙面在顶点之间; 空包络/背面/缝下无立面恒被杀) */
      var _mx2 = (B.x0 + B.x1) * 0.5, _mz2 = (B.z0 + B.z1) * 0.5;
      var _dx2 = bAx === 0 ? bS : 0, _dz2 = bAx === 2 ? bS : 0;
      var gaF = parts[j].g.attributes, ppF = gaF.position.array, nnF = gaF.normal.array, nvF = gaF.position.count;
      var _fc = 0, _fu0 = 1e9, _fu1 = -1e9;
      for (var _fw = 0; _fw < nvF; _fw++) {
        if (nnF[_fw * 3] * _dx2 + nnF[_fw * 3 + 2] * _dz2 < 0.35) continue;
        var _fy = ppF[_fw * 3 + 1];
        if (_fy < A.y0 - 0.68 || _fy > A.y0 + 0.10) continue;
        var _fx = ppF[_fw * 3], _fz = ppF[_fw * 3 + 2];
        if (bAx === 0 ? (bS > 0 ? _fx <= _mx2 : _fx >= _mx2) : (bS > 0 ? _fz <= _mz2 : _fz >= _mz2)) continue;
        var _fu = bAx === 0 ? _fz : _fx;
        if (_fu < _fu0) _fu0 = _fu;
        if (_fu > _fu1) _fu1 = _fu;
        _fc++;
      }
      if (_fc < 1 || _fu0 > u0 + 0.08 || _fu1 < u1 - 0.08) continue;
      if (!udj._wxSeams) udj._wxSeams = [];
      udj._wxSeams.push({ y: A.y0, ax: bAx, s: bS, u0: u0, u1: u1 });
    }
  }
  /* ★优化E: 跨件构造折角 —— 两件包络在同一竖直角(±X 极值 × ±Z 极值)双双平齐 = 装配 90° 凸折线
     (首甲×侧甲交界 / 裙板 L 角 / 炮塔×防盾角)。单件 R3 只看单件包络角, 薄板件又被 _wxBoxC 薄板门排除,
     这类「两件合起来才存在」的折线检测不到 —— 军模依据: 真被磕的棱才是集中掉漆位(文档 §8-E)。
     判据: 双平面平齐(±2.5cm) + y 交叠 ≥15cm(叠放件交叠≈0 自然出局) + bf 门(轴对齐主导面占比, 杀圆件)
     + 两侧贴面物证(角柱/X 面/Z 面, 覆盖式)。折线 y 范围 = 两件 y 交叠; 每件至多 6 条(与遮蔽盒同纪律)。 */
  if (hasHitG) {
    for (i = 0; i < nP; i++) {
      var FA = ST[i], udi2 = parts[i].g.userData;
      if (FA.bf < 0.55) continue;
      if (Math.max(FA.x1 - FA.x0, FA.y1 - FA.y0, FA.z1 - FA.z0) < 0.15) continue;
      for (j = i + 1; j < nP; j++) {
        var FB = ST[j], udj2 = parts[j].g.userData;
        if (FB.bf < 0.55) continue;
        if (Math.max(FB.x1 - FB.x0, FB.y1 - FB.y0, FB.z1 - FB.z0) < 0.15) continue;
        var fy0 = Math.max(FA.y0, FB.y0), fy1 = Math.min(FA.y1, FB.y1);
        if (fy1 - fy0 < 0.15) continue;
        for (var sa = -1; sa <= 1; sa += 2) for (var sb = -1; sb <= 1; sb += 2) {
          var exA = sa > 0 ? FA.x1 : FA.x0, exB = sa > 0 ? FB.x1 : FB.x0;
          var ezA = sb > 0 ? FA.z1 : FA.z0, ezB = sb > 0 ? FB.z1 : FB.z0;
          if (Math.abs(exA - exB) > 0.025 || Math.abs(ezA - ezB) > 0.025) continue;
          var ex = (exA + exB) * 0.5, ez = (ezA + ezB) * 0.5;
          if (!_wxFoldWit(parts[i].g, ex, ez) || !_wxFoldWit(parts[j].g, ex, ez)) continue;
          if (udi2._wxFolds && udi2._wxFolds.length >= 6) continue;
          if (udj2._wxFolds && udj2._wxFolds.length >= 6) continue;
          if (!udi2._wxFolds) udi2._wxFolds = [];
          if (!udj2._wxFolds) udj2._wxFolds = [];
          udi2._wxFolds.push({ x: ex, z: ez, y0: fy0, y1: fy1 });
          udj2._wxFolds.push({ x: ex, z: ez, y0: fy0, y1: fy1 });
        }
      }
    }
  }
  /* ★优化D: 遮蔽盒限量 —— 按占地面积降序取前 6(JS 稳定排序=确定性) */
  for (i = 0; i < nP; i++) {
    var _shL2 = parts[i].g.userData._wxShade;
    if (_shL2 && _shL2.length > 6) {
      _shL2.sort(function (a, b) { return (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0); });
      _shL2.length = 6;
    }
  }
}
/* ===== ★VC板边脱漆 · EdgesGeometry 同源边集与板缘距离场(建模期一次性, 每模板一次) =====
   vcpanel-6 修复原则：所有灰白裸钢效果只允许拥有一套拓扑边定义；旧风化启发式不得参与。
   · 边源与车库 applyVehicleStyle / 对局 vehInkBuildTpl 同源：位置按 4 位小数焊接，建立无向边哈希，
     开口边保留；双面边仅在几何面法线点积 <= cos(22°) 时保留。共面三角剖分对角线不会入选。
   · Keep the authoritative 22° edge set; do not add heuristic edge filters;
     this keeps the wear band aligned with the night outline regardless of triangulation or screen derivatives.
   · 距离场仍只承担“把已确认边扩成 12cm 表面带”：组内多源 Dijkstra 提供顶点初值；粗大三角
     按约 0.11m 重心网格细分，并对新顶点计算到真实边段的欧氏距离，阻断高—高顶点插值形成的
     面内亮对角。它不能创建新边，只能扩宽 EdgesGeometry 已确认的边。
   · 带值编码 raw=B1−(B1−B0)·d/W，域 [0.03,0.10]，低于旧风化晕区阈值；片元只做恒宽、
     噪声和距离衰减，不再按视角/曲率增删边。WX_PANEL_AMT=0 可关闭整条新链路。 */
var WX_PANEL_AMT = 1.0;                    // 板边脱漆总强度(bake/检测侧门); 0 = 逐位回滚
var WX_PANEL_TAU = 22 * Math.PI / 180;     // 与暗夜/对局墨线 THREE.EdgesGeometry(...,22) 严格同阈值
var WX_PANEL_MINA = 0.0;                   // vcpanel-5: 禁止小面吸收；边集合必须与 EdgesGeometry 保持一致
var WX_PANEL_W = 0.12;                     // 板边带目标世界带宽(m; 片元 uPanel 窗口同源)
var _WX_PEEL_B0 = 0.03, _WX_PEEL_B1 = 0.10;   // 主装甲编码段
/* vcpanel-7：四档互斥编码。每个件的远端也保持在本档 B0，避免跨档插值穿过其他区间。
   weight 在片元明确解码，不再靠降低峰值间接猜强度；W 控制材质带宽，仍不是覆盖线。 */
var _WX_PANEL_CFG = {
  /* Performance budget: cap the per-panel tessellation before instancing.
     N>=3 已给粗三角提供真实面内采样点；片元 fwidth 再从插值斜率恢复世界带宽。 */
  armor:  { b0: 0.03, b1: 0.10, w: 0.120, weight: 1.00, maxN: 4 },
  detail: { b0: 0.14, b1: 0.21, w: 0.060, weight: 0.42, maxN: 3 },  // 武器、观瞄、网架、装饰、轮毂等
  track:  { b0: 0.25, b1: 0.32, w: 0.050, weight: 0.30, maxN: 2 },  // 履带板/环带/销/齿
  light:  { b0: 0.36, b1: 0.43, w: 0.065, weight: 0.38, maxN: 2 }   // 挡泥板、翼子板、薄板、旋翼
};
var _WX_PANEL_U = { value: WX_PANEL_AMT };     // 片元共享 uniform 引用(uPanelAmt, 运行时可调)

function _wxPanelPass(parts, group) {
  if (WX_PANEL_AMT <= 0) return null;
  if (group === 'hullGlow' || group === 'turretGlow') return;   // 发光件组(灯具)无漆面语义
  var seed = (typeof MAP !== 'undefined' && MAP && MAP.seedF) ? (MAP.seedF | 0) : 1;
  /* vcpanel-11 区域权重使用部件组统一包络，不能按每个小件自身 z 归一化，否则车尾小件会把自己的
     “前端”误当整车前脸。+Z=车头；组包络只在模板期遍历一次。 */
  var _gx0=1e9,_gy0=1e9,_gz0=1e9,_gx1=-1e9,_gy1=-1e9,_gz1=-1e9;
  for(var _gi=0;_gi<parts.length;_gi++){
    var _gg=parts[_gi]&&parts[_gi].g, _gp=_gg&&_gg.attributes.position;
    if(!_gp)continue; var _ga=_gp.array;
    for(var _gv=0;_gv<_gp.count;_gv++){
      var _xx=_ga[_gv*3],_yy=_ga[_gv*3+1],_zz=_ga[_gv*3+2];
      if(_xx<_gx0)_gx0=_xx;if(_xx>_gx1)_gx1=_xx;if(_yy<_gy0)_gy0=_yy;if(_yy>_gy1)_gy1=_yy;if(_zz<_gz0)_gz0=_zz;if(_zz>_gz1)_gz1=_zz;
    }
  }
  var _groupRegion={group:group,x0:_gx0,x1:_gx1,y0:_gy0,y1:_gy1,z0:_gz0,z1:_gz1};
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!p || !p.g || !p.g.attributes.position || !p.g.attributes.normal) continue;
    var pc = p.c, ud = p.g.userData || {};
    /* vcpanel-7 非金属用显式材质语义排除；亮度只保留为旧模型兜底，不能再把玻璃/帆布误当钢。 */
    if (pc._wxNonMetal || 0.299 * pc[0] + 0.587 * pc[1] + 0.114 * pc[2] <= 0.105) continue;
    var cfg = _WX_PANEL_CFG.armor, cls = 'armor';
    var dyn = ud._wxDyn, sh = ud._wxShape, thin = false;
    if (sh && sh[0] === 'box') {
      var da = [Math.abs(sh[1]), Math.abs(sh[2]), Math.abs(sh[3])].sort(function(a,b){return a-b;});
      thin = da[0] <= 0.09 && da[2] >= 0.45;   // hull 中翼子板/挡泥板/侧裙甲例外；小螺栓不误入
    }
    var fenderOrSkirt = false;
    var _partY0=1e9,_partY1=-1e9;
    if (group === 'hull' && thin) {
      var fp0=p.g.attributes.position.array, fx0=1e9, fx1=-1e9;
      for(var fv0=0;fv0<p.g.attributes.position.count;fv0++){var fxx=fp0[fv0*3],fyy=fp0[fv0*3+1];if(fxx<fx0)fx0=fxx;if(fxx>fx1)fx1=fxx;if(fyy<_partY0)_partY0=fyy;if(fyy>_partY1)_partY1=fyy;}
      fenderOrSkirt = Math.abs((fx0+fx1)*0.5) >= 0.82; // 仅车体两侧外置板；中央舱盖/薄装饰不冒充例外
    }
    var dynamicHit = !!ud._wpTread || dyn === 10 || dyn === 20 || (dyn >= 1 && dyn <= 18);
    var directHitGroup = group === 'gun' || group === 'mantlet' || group === 'mainRotor' || group === 'tailRotor';
    /* vcpanel-10 装饰零灰白门：aCamo 只证明使用装甲漆，不能证明该小件有命中壳。
       hull/turret 的小舱盖、工具、观瞄罩、储物、螺栓等即使误用 cACC，也必须排除。
       主结构按件包络至少 0.75m 且第二轴至少 0.18m；无命中装饰唯一例外为 hull 长薄翼子板/侧裙甲。
       动态轮/履带及 gun/mantlet/rotor 是已有直接命中组，继续保留。 */
    var structuralArmor = false;
    if (p.camo && !directHitGroup && !dynamicHit && !fenderOrSkirt) {
      var pp0 = p.g.attributes.position.array, nv0 = p.g.attributes.position.count;
      var x0=1e9,y0=1e9,z0=1e9,x1=-1e9,y1=-1e9,z1=-1e9;
      for (var dv0=0; dv0<nv0; dv0++) {
        var xx0=pp0[dv0*3], yy0=pp0[dv0*3+1], zz0=pp0[dv0*3+2];
        if(xx0<x0)x0=xx0;if(xx0>x1)x1=xx0;if(yy0<y0)y0=yy0;if(yy0>y1)y1=yy0;if(zz0<z0)z0=zz0;if(zz0>z1)z1=zz0;
      }
      var sd0=[x1-x0,y1-y0,z1-z0].sort(function(a,b){return a-b;});
      structuralArmor = sd0[2] >= 0.75 && sd0[1] >= 0.18;
    }
    if (!directHitGroup && !dynamicHit && !fenderOrSkirt && !structuralArmor) {
      ud._wxPanelExcluded = 'decor-no-hit';
      continue;                                      // 无命中判定装饰：灰白材质边严格为零
    }
    if (ud._wpTread || dyn === 10 || dyn === 20) { cfg = _WX_PANEL_CFG.track; cls = 'track'; }
    else if (group === 'mainRotor' || group === 'tailRotor') { cfg = _WX_PANEL_CFG.light; cls = 'light'; }
    else if (fenderOrSkirt) { cfg = _WX_PANEL_CFG.light; cls = 'light'; }
    else if (group === 'gun' || group === 'mantlet' || dynamicHit) { cfg = _WX_PANEL_CFG.detail; cls = 'detail'; }
    p._wxPanelCfg = cfg; p._wxPanelClass = cls;
    p._wxPanelRegion = { group:group, cls:cls, fenderOrSkirt:fenderOrSkirt, dynamicHit:dynamicHit,
      x0:_groupRegion.x0,x1:_groupRegion.x1,y0:_groupRegion.y0,y1:_groupRegion.y1,z0:_groupRegion.z0,z1:_groupRegion.z1,
      partY0:_partY0,partY1:_partY1 };
    var rr = _wxPanelPart(p, i, seed);
    if (rr) rr.cls = cls;
    out.push(rr);
  }
  return out;                                                   // 逐件白盒摘要(null=跳过/无效果)
}

/* 点到线段串(每段 6 元 [ax,ay,az,bx,by,bz])最近距离 —— 分裂质心的带值用 */
function _wxSegDist(px, py, pz, segs) {
  var best = Infinity;
  for (var i = 0; i < segs.length; i += 6) {
    var ax = segs[i], ay = segs[i + 1], az = segs[i + 2], bx = segs[i + 3], by = segs[i + 4], bz = segs[i + 5];
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var L2 = dx * dx + dy * dy + dz * dz, t = L2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / L2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var qx = ax + dx * t - px, qy = ay + dy * t - py, qz = az + dz * t - pz;
    var d2 = qx * qx + qy * qy + qz * qz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}
/* vcpanel-13：真实边段纵向权重。离最近边段两端越近越强，中点最低；端点保持1不改现有区域峰值。
   返回范围 0.22..1，smooth U 形避免中点出现尖锐明暗折线。 */
function _wxSegEndWeight(px, py, pz, segs) {
  var best=Infinity,bestT=0.5;
  for(var i=0;i<segs.length;i+=6){
    var ax=segs[i],ay=segs[i+1],az=segs[i+2],dx=segs[i+3]-ax,dy=segs[i+4]-ay,dz=segs[i+5]-az;
    var l2=dx*dx+dy*dy+dz*dz,t=l2>1e-12?((px-ax)*dx+(py-ay)*dy+(pz-az)*dz)/l2:0;
    if(t<0)t=0;else if(t>1)t=1;
    var qx=ax+dx*t-px,qy=ay+dy*t-py,qz=az+dz*t-pz,d2=qx*qx+qy*qy+qz*qz;
    if(d2<best){best=d2;bestT=t;}
  }
  var u=Math.abs(bestT*2-1); // 端点1，中点0
  var s=u*u*(3-2*u);
  return 0.22+0.78*s;
}

function _wxPanelEdge(eMap, MUL, a, b, f) {
  var k = a < b ? a * MUL + b : b * MUL + a;
  var e = eMap.get(k);
  if (!e) eMap.set(k, [a, b, f]);
  else e.push(f);                            // 同面每边只登记一次; 3+面=非流形(保守按内边并组)
}

function _wxPanelPart(p, partIdx, seed) {
  var g = p.g, PA = g.attributes.position.array, NA = g.attributes.normal.array;
  var _cfg = p._wxPanelCfg || _WX_PANEL_CFG.armor;
  var _pB0 = _cfg.b0, _pB1 = _cfg.b1, _pW = _cfg.w, _pReg = p._wxPanelRegion || null;
  /* vcpanel-11 位置权重：只调灰白材质距离场的峰值，不改变22°候选边集合。
     +Z为车头；front=炮塔前脸/车体首上首下，rearLow=车尾下斜面与底盘交线；
     翼子板/侧裙只保留下沿。track 原样，动态轮系也不受车体区域门影响。 */
  function _regSS(a,b,x){var t=(x-a)/(b-a);t=t<0?0:(t>1?1:t);return t*t*(3-2*t);}
  function _regW(x,y,z){
    if(!_pReg || _pReg.cls==='track' || _pReg.dynamicHit)return 1;
    if(_pReg.fenderOrSkirt){
      var ph=Math.max(_pReg.partY1-_pReg.partY0,1e-5), py=(y-_pReg.partY0)/ph;
      return 0.04+0.96*(1-_regSS(0.06,0.42,py)); // 下沿满权重，上部近零
    }
    var dz=Math.max(_pReg.z1-_pReg.z0,1e-5),dy=Math.max(_pReg.y1-_pReg.y0,1e-5);
    var zn=(z-_pReg.z0)/dz,yn=(y-_pReg.y0)/dy;
    if(_pReg.group==='turret'){
      var tf=_regSS(0.58,0.84,zn); return 0.06+0.94*tf; // 前脸集中，侧后仅极淡残留
    }
    if(_pReg.group==='hull' && _pReg.cls==='armor'){
      var hf=_regSS(0.57,0.82,zn);                       // 首上/首下
      var rear=1-_regSS(0.18,0.38,zn), low=1-_regSS(0.22,0.48,yn);
      var rearLow=rear*low*0.82;                         // 车尾仅下斜面—底盘交界足够权重
      return Math.max(hf,rearLow,0.05*(1-rear));
    }
    if(_pReg.group==='gun'||_pReg.group==='mantlet')return 0.32; // 非视觉主集中区继续淡化
    if(_pReg.group==='mainRotor'||_pReg.group==='tailRotor')return 0.24;
    return 0.18;
  }
  var n = g.attributes.position.count, i, v, t3;
  var IA = (g.index && g.index.array) ? g.index.array : null;
  var T = IA ? ((IA.length / 3) | 0) : ((n / 3) | 0);
  if (T < 1 || n < 3) return null;
  /* —— 1) 位置焊接: 0.49mm 量化键(远小于最小板缝 10mm, 远大于浮点尘埃; 统一平凡索引/硬法线复制/共享索引三种形态) —— */
  var weld = new Int32Array(n), wPos = [], wKey = new Map();
  for (v = 0; v < n; v++) {
    // 与 THREE.EdgesGeometry r128 的 4 位小数顶点哈希口径一致；字符串键避免大坐标数值拼接碰撞。
    var kx = Math.round(PA[v * 3] * 10000), ky = Math.round(PA[v * 3 + 1] * 10000), kz = Math.round(PA[v * 3 + 2] * 10000);
    var wk = kx + ',' + ky + ',' + kz;
    var w = wKey.get(wk);
    if (w === undefined) { w = wPos.length / 3; wKey.set(wk, w); wPos.push(PA[v * 3], PA[v * 3 + 1], PA[v * 3 + 2]); }
    weld[v] = w;
  }
  var M = wPos.length / 3, MUL = M + 2;
  if (M < 3) return null;
  /* —— 2) 面法线/面积/质心 + 边哈希(值=[a,b,面...]: 3 元=开口边 / 4 元=内边 / >4=非流形) —— */
  var fN = new Float32Array(T * 3), fA = new Float32Array(T), cA = new Float32Array(T * 3);
  var dead = new Uint8Array(T);                                 // 退化三角(零面积/焊后重合): 不建边不进组(穹顶极点环同位焊接等)
  var eMap = new Map();
  for (t3 = 0; t3 < T; t3++) {
    var q0 = IA ? IA[t3 * 3] : t3 * 3, q1 = IA ? IA[t3 * 3 + 1] : t3 * 3 + 1, q2 = IA ? IA[t3 * 3 + 2] : t3 * 3 + 2;
    var ax = PA[q1 * 3] - PA[q0 * 3], ay = PA[q1 * 3 + 1] - PA[q0 * 3 + 1], az = PA[q1 * 3 + 2] - PA[q0 * 3 + 2];
    var bx = PA[q2 * 3] - PA[q0 * 3], by = PA[q2 * 3 + 1] - PA[q0 * 3 + 1], bz = PA[q2 * 3 + 2] - PA[q0 * 3 + 2];
    var cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    var cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
    cA[t3 * 3] = (PA[q0 * 3] + PA[q1 * 3] + PA[q2 * 3]) / 3;
    cA[t3 * 3 + 1] = (PA[q0 * 3 + 1] + PA[q1 * 3 + 1] + PA[q2 * 3 + 1]) / 3;
    cA[t3 * 3 + 2] = (PA[q0 * 3 + 2] + PA[q1 * 3 + 2] + PA[q2 * 3 + 2]) / 3;
    fA[t3] = cl * 0.5;
    if (cl < 1e-9) { dead[t3] = 1; continue; }                   // 几何退化三角: 不建边不进组
    fN[t3 * 3] = cx / cl; fN[t3 * 3 + 1] = cy / cl; fN[t3 * 3 + 2] = cz / cl;
    var wa = weld[q0], wb = weld[q1], wc = weld[q2];
    if (wa === wb || wb === wc || wa === wc) { dead[t3] = 1; continue; }   // 拓扑退化(焊后重合): 不建边不进组
    _wxPanelEdge(eMap, MUL, wa, wb, t3); _wxPanelEdge(eMap, MUL, wb, wc, t3); _wxPanelEdge(eMap, MUL, wc, wa, t3);
  }
  /* —— 3) 与暗夜模式完全同源的 EdgesGeometry 边判定 ——
     暗夜车库 applyVehicleStyle 和对局 vehInkBuildTpl 均使用 THREE.EdgesGeometry(geometry, 22)。
     本路径只把同一条几何边扩成表面脱漆带：开口边保留；双面边仅当面法线夹角 >=22° 保留；
     小于阈值的共面三角剖分边只用于连通，不得成为脱漆源。不得再读顶点平滑法线、曲率或面组面积
     二次猜测，否则灰白边集合会与暗夜墨线分叉并重新引入平面内部对角线。 */
  var uf = new Int32Array(T);
  for (i = 0; i < T; i++) uf[i] = i;
  function _find(x) { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; }
  var thresholdDot = Math.cos(WX_PANEL_TAU);
  var bEdges = [];                                               // [a,b,+1,f0](开口) / [a,b,+1,f0,f1](EdgesGeometry 硬边)
  eMap.forEach(function (e) {
    var a = e[0], b = e[1], nf = e.length - 2;
    if (nf === 1) { bEdges.push([a, b, 1, e[2]]); return; }      // EdgesGeometry: 无第二邻面即轮廓边
    var f0 = e[2], f1 = e[3];
    var d = fN[f0 * 3] * fN[f1 * 3] + fN[f0 * 3 + 1] * fN[f1 * 3 + 1] + fN[f0 * 3 + 2] * fN[f1 * 3 + 2];
    if (d <= thresholdDot) {
      if (nf === 2) bEdges.push([a, b, 1, f0, f1]);              // 与 EdgesGeometry 的 face1·face2 <= cos(22°) 相同
      return;                                                    // 非流形边保守跳过，避免不确定的内部线
    }
    // 未达到 22°：与暗夜模式一样不画，并把两侧并为同一连续平面域供距离传播。
    var r0 = _find(f0);
    for (var k2 = 3; k2 < e.length; k2++) { var rk = _find(e[k2]); if (rk !== r0) uf[rk] = r0; }
  });
  /* —— 4) 组 id 压缩 + 面积 —— */
  var gOf = new Int32Array(T), gId = new Map(), G = 0, gArea = [], gTris = [];
  for (t3 = 0; t3 < T; t3++) {
    if (dead[t3]) { gOf[t3] = -1; continue; }
    var r = _find(t3), gid = gId.get(r);
    if (gid === undefined) { gid = G++; gId.set(r, gid); gArea.push(0); gTris.push(0); }
    gOf[t3] = gid; gArea[gid] += fA[t3]; gTris[gid]++;
  }
  if (G < 1) return null;
  /* —— 5) 不再执行小面组吸收 ——
     EdgesGeometry 不按面积、三角形数或“倒角链”改写边集合。The edge set is derived directly from the authoritative geometry; 
     暗夜线条不一致，也会让距离源绕过真实硬边。vcpanel-5 保留原始 22° 连通域。 */
  var lab = [];
  for (i = 0; i < G; i++) lab[i] = i;
  function _lab(x) { return x; }
  /* —— 6) 组结构: 顶点集/组内邻接(欧氏边权)/边界源(凸胜凹)/边界线段 —— */
  var gSet = new Map();                                          // root -> {verts:Set, nbr:Map(v→Map(w→L)), src:Map(v→cvx), segs:[]}
  function _grp(r) { var o = gSet.get(r); if (!o) { o = { verts: new Set(), nbr: new Map(), src: new Map(), segs: [] }; gSet.set(r, o); } return o; }
  function _gAddEdge(o, a, b) {
    var ex = wPos[b * 3] - wPos[a * 3], ey = wPos[b * 3 + 1] - wPos[a * 3 + 1], ez = wPos[b * 3 + 2] - wPos[a * 3 + 2];
    var L = Math.sqrt(ex * ex + ey * ey + ez * ez);
    var m1 = o.nbr.get(a); if (!m1) { m1 = new Map(); o.nbr.set(a, m1); } if (!m1.has(b)) m1.set(b, L);
    var m2 = o.nbr.get(b); if (!m2) { m2 = new Map(); o.nbr.set(b, m2); } if (!m2.has(a)) m2.set(a, L);
  }
  for (t3 = 0; t3 < T; t3++) {
    if (dead[t3]) continue;
    var o = _grp(gOf[t3]);
    var q0 = IA ? IA[t3 * 3] : t3 * 3, q1 = IA ? IA[t3 * 3 + 1] : t3 * 3 + 1, q2 = IA ? IA[t3 * 3 + 2] : t3 * 3 + 2;
    var wa = weld[q0], wb = weld[q1], wc = weld[q2];
    o.verts.add(wa); o.verts.add(wb); o.verts.add(wc);
    if (wa !== wb) _gAddEdge(o, wa, wb);
    if (wb !== wc) _gAddEdge(o, wb, wc);
    if (wc !== wa) _gAddEdge(o, wc, wa);
  }
  function _gSrc(o, v2, cvx) { var cur = o.src.get(v2); if (cur === undefined || (cur < 0 && cvx > 0)) o.src.set(v2, cvx); }
  var bndN = 0;                                                 // 有效边界边数(净化合并后仍成界的; 白盒摘要用)
  for (i = 0; i < bEdges.length; i++) {
    var be = bEdges[i], ba = be[0], bb = be[1], bcv = be[2];
    var sx = wPos[ba * 3], sy = wPos[ba * 3 + 1], sz = wPos[ba * 3 + 2], sxx = wPos[bb * 3], syy = wPos[bb * 3 + 1], szz = wPos[bb * 3 + 2];
    if (be.length === 4) {                                       // 开口边: 归属其唯一面所在的组
      var oO = _grp(gOf[be[3]]);
      _gSrc(oO, ba, bcv); _gSrc(oO, bb, bcv);
      oO.segs.push(sx, sy, sz, sxx, syy, szz); bndN++;
    } else {                                                     // 硬内边: 双侧组都成源/成边界(折线两侧板都亮)
      if (gOf[be[3]] === gOf[be[4]]) continue;                   // 净化合并后同组: 该硬边已被吸收, 不再是边界(倒角吸收关键)
      var oA = _grp(gOf[be[3]]), oB = _grp(gOf[be[4]]);
      _gSrc(oA, ba, bcv); _gSrc(oA, bb, bcv); _gSrc(oB, ba, bcv); _gSrc(oB, bb, bcv);
      oA.segs.push(sx, sy, sz, sxx, syy, szz); oB.segs.push(sx, sy, sz, sxx, syy, szz); bndN++;
    }
  }
  /* 所有确认边段的只读串：纵向端点权重必须基于同一22°边集，不能读取三角剖分内边。 */
  var _allPanelSegs=[];
  gSet.forEach(function(_so){if(_so.segs&&_so.segs.length)for(var _ss=0;_ss<_so.segs.length;_ss++)_allPanelSegs.push(_so.segs[_ss]);});
  /* —— 7) 组内多源 Dijkstra(源带凸凹号; 跨组取最近源) —— */
  var dBest = new Float32Array(M), sBest = new Int8Array(M);
  for (i = 0; i < M; i++) dBest[i] = Infinity;
  gSet.forEach(function (o) {
    if (o.src.size === 0) return;
    var open = new Map(), flg = new Map(), settled = new Set();
    o.src.forEach(function (cv, sv) {
      if (!open.has(sv)) { open.set(sv, 0); flg.set(sv, cv > 0 ? 1 : -1); }
    });
    while (open.size) {
      var bu = -1, bd = Infinity;
      open.forEach(function (dd, vv) { if (dd < bd) { bd = dd; bu = vv; } });   // 组内顶点数十~数百, 扫描取最小足够
      open.delete(bu);
      if (settled.has(bu)) continue;
      settled.add(bu);
      var bf = flg.get(bu) || 1;
      if (bd < dBest[bu]) { dBest[bu] = bd; sBest[bu] = bf; }
      var nb = o.nbr.get(bu);
      if (!nb) continue;
      nb.forEach(function (L, wv) {
        if (settled.has(wv)) return;
        var nd = bd + L, cur = open.get(wv);
        if (cur === undefined || nd < cur - 1e-9) { open.set(wv, nd); flg.set(wv, bf); }
      });
    }
  });
  /* —— 8) 饥饿分裂判定 + 密集重心网格(vcpanel-3 根治对角线残留) ——
     ★vcpanel-2 1→6 只做一层, 大面子三角仍 ~1m≫W=0.12, 子三角内重心插值仍虚构亮脊
     (例 B-M12-Cc 重心真距 0.22 应暗, 插值 0.068 判亮, 误差 0.063)。本版对种子三角做均匀重心网格,
     vcpanel-9 保留“新增点读取真实欧氏距离”的正确性，但撤销把整面铺到 0.11m 的灾难性预算：
     分类上限 armor/detail/track/light=4/3/2/2，单三角最多 16/9/4/4 个三角；N>=3 的装甲
     含真实面内采样，片元 fwidth 由插值斜率恢复约定世界带宽。面内不再全高，且不再出现 1→1024。
     新顶点真欧氏距取值; 外框中点真距≡0跨硬边无缝; t3 升序确定, AMT=0 回滚。 —— */
  var splits = [];
  var _bndSet = new Set();
  for (i = 0; i < bEdges.length; i++) { var _be0 = bEdges[i], _ba0 = _be0[0], _bb0 = _be0[1]; _bndSet.add(_ba0 < _bb0 ? _ba0 * MUL + _bb0 : _bb0 * MUL + _ba0); }
  var _markEdge = new Map();
  eMap.forEach(function (e) {
    if (e.length !== 4) return;
    var _ea = e[0], _eb = e[1], _f0 = e[2], _f1 = e[3];
    if (gOf[_f0] !== gOf[_f1]) return;
    if (gOf[_f0] < 0) return;
    if (dBest[_ea] > 1e-4 || dBest[_eb] > 1e-4) return;
    if (sBest[_ea] < 0 || sBest[_eb] < 0) return;
    var _k = _ea < _eb ? _ea * MUL + _eb : _eb * MUL + _ea;
    if (_bndSet.has(_k)) return;
    var _o = gSet.get(gOf[_f0]);
    if (!_o || !_o.segs.length) return;
    var _mx = (wPos[_ea * 3] + wPos[_eb * 3]) * 0.5, _my = (wPos[_ea * 3 + 1] + wPos[_eb * 3 + 1]) * 0.5, _mz = (wPos[_ea * 3 + 2] + wPos[_eb * 3 + 2]) * 0.5;
    var _md = _wxSegDist(_mx, _my, _mz, _o.segs);
    if (_md > 0.55 * _pW) _markEdge.set(_k, 1);
  });
  var _needSplit = new Uint8Array(T);
  for (t3 = 0; t3 < T; t3++) {
    if (dead[t3]) continue;
    var _q0 = IA ? IA[t3 * 3] : t3 * 3, _q1 = IA ? IA[t3 * 3 + 1] : t3 * 3 + 1, _q2 = IA ? IA[t3 * 3 + 2] : t3 * 3 + 2;
    var _wa = weld[_q0], _wb = weld[_q1], _wc = weld[_q2];
    var _starved = false;
    if (dBest[_wa] <= 1e-4 && dBest[_wb] <= 1e-4 && dBest[_wc] <= 1e-4) {
      var _oo = gSet.get(gOf[t3]);
      if (_oo && _oo.segs.length) {
        var _dc0 = _wxSegDist(cA[t3 * 3], cA[t3 * 3 + 1], cA[t3 * 3 + 2], _oo.segs);
        if (_dc0 > 0.55 * _pW) _starved = true;
      }
    }
    var _k0 = _wa < _wb ? _wa * MUL + _wb : _wb * MUL + _wa;
    var _k1 = _wb < _wc ? _wb * MUL + _wc : _wc * MUL + _wb;
    var _k2 = _wc < _wa ? _wc * MUL + _wa : _wa * MUL + _wc;
    if (_starved || _markEdge.has(_k0) || _markEdge.has(_k1) || _markEdge.has(_k2)) _needSplit[t3] = 1;
  }
  function _wxPanelRv(_d,_x,_y,_z) { var _r = _pB1 - (_pB1 - _pB0) * _d / _pW; if(_r<_pB0)_r=_pB0; return _pB0+(_r-_pB0)*_regW(_x,_y,_z)*_wxSegEndWeight(_x,_y,_z,_allPanelSegs); }
  var _newPos = [], _newNrm = [], _newPnl = [], _newTris = [];
  var idxSrc0 = IA || null;
  for (t3 = 0; t3 < T; t3++) {
    if (!_needSplit[t3]) continue;
    var _r0 = IA ? IA[t3 * 3] : t3 * 3, _r1 = IA ? IA[t3 * 3 + 1] : t3 * 3 + 1, _r2 = IA ? IA[t3 * 3 + 2] : t3 * 3 + 2;
    var _o2 = gSet.get(gOf[t3]);
    if (!_o2 || !_o2.segs.length) { _needSplit[t3] = 0; continue; }
    var _Ax = PA[_r0 * 3], _Ay = PA[_r0 * 3 + 1], _Az = PA[_r0 * 3 + 2];
    var _Bx = PA[_r1 * 3], _By = PA[_r1 * 3 + 1], _Bz = PA[_r1 * 3 + 2];
    var _Cx = PA[_r2 * 3], _Cy = PA[_r2 * 3 + 1], _Cz = PA[_r2 * 3 + 2];
    var _e01 = Math.sqrt((_Ax - _Bx) * (_Ax - _Bx) + (_Ay - _By) * (_Ay - _By) + (_Az - _Bz) * (_Az - _Bz));
    var _e12 = Math.sqrt((_Bx - _Cx) * (_Bx - _Cx) + (_By - _Cy) * (_By - _Cy) + (_Bz - _Cz) * (_Bz - _Cz));
    var _e20 = Math.sqrt((_Cx - _Ax) * (_Cx - _Ax) + (_Cy - _Ay) * (_Cy - _Ay) + (_Cz - _Az) * (_Cz - _Az));
    var _mL = _e01 > _e12 ? (_e01 > _e20 ? _e01 : _e20) : (_e12 > _e20 ? _e12 : _e20);
    var _NN = Math.ceil(_mL / 0.11);
    var _maxN = _cfg.maxN || 4;                    // vcpanel-9: 分类硬预算，禁止面积型 N² 爆炸
    if (_NN < 2) _NN = 2; else if (_NN > _maxN) _NN = _maxN;
    splits.push({ t: t3, N: _NN });
    var _Anx = NA[_r0 * 3], _Any = NA[_r0 * 3 + 1], _Anz = NA[_r0 * 3 + 2];
    var _Bnx = NA[_r1 * 3], _Bny = NA[_r1 * 3 + 1], _Bnz = NA[_r1 * 3 + 2];
    var _Cnx = NA[_r2 * 3], _Cny = NA[_r2 * 3 + 1], _Cnz = NA[_r2 * 3 + 2];
    var _grid = [];
    for (var _gu = 0; _gu <= _NN; _gu++) { var _row = new Array(_NN + 1).fill(-1); _grid.push(_row); }
    _grid[0][0] = _r0; _grid[_NN][0] = _r1; _grid[0][_NN] = _r2;
    for (var _uu = 0; _uu <= _NN; _uu++) {
      for (var _vv = 0; _vv <= _NN - _uu; _vv++) {
        if ((_uu === 0 && _vv === 0) || (_uu === _NN && _vv === 0) || (_uu === 0 && _vv === _NN)) continue;
        var _w0 = (_NN - _uu - _vv) / _NN, _w1 = _uu / _NN, _w2 = _vv / _NN;
        var _px = _w0 * _Ax + _w1 * _Bx + _w2 * _Cx, _py = _w0 * _Ay + _w1 * _By + _w2 * _Cy, _pz = _w0 * _Az + _w1 * _Bz + _w2 * _Cz;
        var _nx = _w0 * _Anx + _w1 * _Bnx + _w2 * _Cnx, _ny = _w0 * _Any + _w1 * _Bny + _w2 * _Cny, _nz = _w0 * _Anz + _w1 * _Bnz + _w2 * _Cnz;
        var _nl = Math.sqrt(_nx * _nx + _ny * _ny + _nz * _nz);
        if (_nl > 1e-9) { _nx /= _nl; _ny /= _nl; _nz /= _nl; }
        else { _nx = fN[t3 * 3]; _ny = fN[t3 * 3 + 1]; _nz = fN[t3 * 3 + 2]; }
        var _dd = _wxSegDist(_px, _py, _pz, _o2.segs);
        var _gidx = n + (_newPos.length / 3);
        _newPos.push(_px, _py, _pz); _newNrm.push(_nx, _ny, _nz); _newPnl.push(_wxPanelRv(_dd,_px,_py,_pz));
        _grid[_uu][_vv] = _gidx;
      }
    }
    for (var _ev = 0; _ev < _NN; _ev++) {
      for (var _eu = 0; _eu < _NN - _ev; _eu++) {
        _newTris.push(_grid[_eu][_ev], _grid[_eu + 1][_ev], _grid[_eu][_ev + 1]);
        if (_eu + _ev + 1 < _NN) _newTris.push(_grid[_eu + 1][_ev], _grid[_eu + 1][_ev + 1], _grid[_eu][_ev + 1]);
      }
    }
  }
  /* —— 9) 带值: 线性距离编码 raw = B1 − (B1−B0)·d/W, clamp ≥ 0.005(远端外插保持段内斜率, 片元 fwidth 折算恒定带宽) —— */
  var _newCount = _newPnl.length;
  var nNew = n + _newCount, panel = new Float32Array(nNew), hasAny = false;
  for (v = 0; v < n; v++) {
    var w0 = weld[v];
    if (dBest[w0] === Infinity) { panel[v] = _pB0; continue; }
    var rv = _pB1 - (_pB1 - _pB0) * dBest[w0] / _pW;
    if (rv < _pB0) rv = _pB0;
    panel[v] = _pB0 + (rv - _pB0) * _regW(PA[v*3],PA[v*3+1],PA[v*3+2]) * _wxSegEndWeight(PA[v*3],PA[v*3+1],PA[v*3+2],_allPanelSegs); // v13: 区域×沿线端高中低
  }
  function _wxPanelRv(_d,_x,_y,_z) { var _r = _pB1 - (_pB1 - _pB0) * _d / _pW; if(_r<_pB0)_r=_pB0; return _pB0+(_r-_pB0)*_regW(_x,_y,_z)*_wxSegEndWeight(_x,_y,_z,_allPanelSegs); }
  for (i = 0; i < _newCount; i++) panel[n + i] = _newPnl[i];
  for (v = 0; v < nNew; v++) if (panel[v] > _pB0 + 0.006) { hasAny = true; break; }
  if (!hasAny) return null;                                      // 全凹/无边界件: 不挂 hint(烘焙走旧路)
  /* —— 10) 挂载: 分裂件重建几何(浏览器 BufferGeometry / Node 纯对象), 否则直挂 userData ——
     ★vcpanel-3: 种子三角已展成重心网格(_newPos/_newNrm/_newPnl/_newTris), 直接拼入; 绕向与原一致。 —— */
  if (splits.length) {
    var keys = Object.keys(g.attributes), sN = splits.length, k2, c3;
    var _seedSet = new Set();
    for (i = 0; i < sN; i++) _seedSet.add(splits[i].t);
    var ng = (typeof THREE !== 'undefined' && THREE.BufferGeometry) ? new THREE.BufferGeometry() : { attributes: {} };
    for (k2 = 0; k2 < keys.length; k2++) {
      var key = keys[k2], at = g.attributes[key], arr = at.array, item = arr.length / n;
      if (item !== (item | 0)) continue;
      var na = new Float32Array(nNew * item);
      na.set(arr);
      if (key === 'position') { for (var _pp = 0; _pp < _newPos.length; _pp++) na[n * item + _pp] = _newPos[_pp]; }
      else if (key === 'normal' && item === 3) { for (var _nn2 = 0; _nn2 < _newNrm.length; _nn2++) na[n * item + _nn2] = _newNrm[_nn2]; }
      else {
        for (var _vk = 0; _vk < _newCount; _vk++) {
          for (c3 = 0; c3 < item; c3++) na[(n + _vk) * item + c3] = arr[c3];   // uv/aCamo/aVTag 等件内常量: 复首顶点
        }
      }
      if (ng.setAttribute) ng.setAttribute(key, new THREE.BufferAttribute(na, item));
      else ng.attributes[key] = { array: na, count: nNew };
    }
    var idxSrc = IA || (function () { var a = new Uint32Array(n); for (var z2 = 0; z2 < n; z2++) a[z2] = z2; return a; })();
    var nIdx = (T - sN) * 3 + _newTris.length;
    var nIdxArr = nNew > 65535 ? new Uint32Array(nIdx) : new Uint16Array(nIdx);
    var w3 = 0;
    for (t3 = 0; t3 < T; t3++) {
      if (_seedSet.has(t3)) continue;
      nIdxArr[w3++] = idxSrc[t3 * 3]; nIdxArr[w3++] = idxSrc[t3 * 3 + 1]; nIdxArr[w3++] = idxSrc[t3 * 3 + 2];
    }
    for (var _ti = 0; _ti < _newTris.length; _ti++) nIdxArr[w3++] = _newTris[_ti];
    if (ng.setIndex) ng.setIndex(new THREE.BufferAttribute(nIdxArr, 1));
    else ng.index = { array: nIdxArr };
    var nu = {}, udOld = g.userData;
    if (udOld) for (var uk in udOld) nu[uk] = udOld[uk];
    nu._wxPanel = panel;
    ng.userData = nu;
    p.g = ng;
  } else {
    if (!g.userData) g.userData = {};
    g.userData._wxPanel = panel;
  }
  return { G: gSet.size, bnd: bndN, splits: splits.length, n: nNew };   // 白盒摘要(wx-panel-test 断言用)
}

/* 逐件烘焙(建模期一次性): 把 pa(件本色)按顶点位置/法线写成带风化信息的顶点色;isArmor=1 时该件恒不锈(装甲漆面),与颜色无关 */
function weatherBakePart(pa, pos, nrm, col, vo, n, partIdx, seed, isArmor, camoArr, camoBase, hint) {
  var A = WEATHER_BAKE_AMT, v;
  if (A <= 0) {
    for (v = 0; v < n; v++) {
      col[(vo + v) * 3] = pa[0]; col[(vo + v) * 3 + 1] = pa[1]; col[(vo + v) * 3 + 2] = pa[2];
      if (camoArr) camoArr[vo + v] = camoBase || 0;
    }
    return;
  }
  var x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  var _bPX = 0, _bNX = 0, _bPY = 0, _bNY = 0, _bPZ = 0, _bNZ = 0, _bVert = 0, _bBox = 0;   // 真实化: 法线分箱(±X/±Y/±Z 主导面 + 竖直/轴向占比)
  for (v = 0; v < n; v++) {
    var X0 = pos[(vo + v) * 3], Y0 = pos[(vo + v) * 3 + 1], Z0 = pos[(vo + v) * 3 + 2];
    if (X0 < x0) x0 = X0; if (Y0 < y0) y0 = Y0; if (Z0 < z0) z0 = Z0;
    if (X0 > x1) x1 = X0; if (Y0 > y1) y1 = Y0; if (Z0 > z1) z1 = Z0;
    var _qnx = nrm[(vo + v) * 3], _qny = nrm[(vo + v) * 3 + 1], _qnz = nrm[(vo + v) * 3 + 2];
    var _qax = Math.abs(_qnx), _qay = Math.abs(_qny), _qaz = Math.abs(_qnz);
    if (_qay < 0.5) _bVert++;
    if (Math.max(_qax, _qay, _qaz) > 0.8) {
      _bBox++;
      if (_qax >= _qay && _qax >= _qaz) { if (_qnx > 0) _bPX++; else _bNX++; }
      else if (_qay >= _qaz) { if (_qny > 0) _bPY++; else _bNY++; }
      else { if (_qnz > 0) _bPZ++; else _bNZ++; }
    }
  }
  var _cMin = 1e9;   // 真实化 R3: 角点验形(最近顶点到包络 8 角点的距离; 多段圆柱壁面永不到角, 凭此与箱体区分)
  for (v = 0; v < n; v++) {
    var _cx = pos[(vo + v) * 3], _cy = pos[(vo + v) * 3 + 1], _cz = pos[(vo + v) * 3 + 2];
    var _ddx = Math.min(_cx - x0, x1 - _cx), _ddy = Math.min(_cy - y0, y1 - _cy), _ddz = Math.min(_cz - z0, z1 - _cz);
    var _dd = _ddx * _ddx + _ddy * _ddy + _ddz * _ddz;
    if (_dd < _cMin) _cMin = _dd;
  }
  _cMin = Math.sqrt(_cMin);
  var sx = Math.max(x1 - x0, 1e-3), sy = Math.max(y1 - y0, 1e-3), sz = Math.max(z1 - z0, 1e-3);
  var isCyl = !!(hint && hint._wpCyl);
  var h1 = _wxHash01(partIdx, seed), h2 = _wxHash01(partIdx * 7 + 11, seed ^ 0x5bd1e995), h3 = _wxHash01(partIdx * 13 + 29, seed ^ 0x9e3779b9);
  var _lum0 = 0.299 * pa[0] + 0.587 * pa[1] + 0.114 * pa[2];
  var panelM = 1 + Math.min(0.04, 0.016 / Math.max(_lum0, 0.06)) * (h1 - 0.5) * 2.0 * A;
  var steel = Math.max(0, 1 - (Math.abs(pa[0] - 0.2353) + Math.abs(pa[1] - 0.2549) + Math.abs(pa[2] - 0.2824)) / 0.35);
  var dark = Math.max(0, 1 - (Math.abs(pa[0] - 0.1412) + Math.abs(pa[1] - 0.1490) + Math.abs(pa[2] - 0.1647)) / 0.35);
  var metal = Math.max(steel, dark * 0.75);
  /* 真实化件级门(包络+法线分箱, 每件一次): R1 大垂直面 / R3 箱角件 / R2-R4 预分析标记透传 */
  var _vertFrac = _bVert / Math.max(n, 1), _boxFrac = _bBox / Math.max(n, 1);
  var _faceN = 0, _faceMin = Math.max(3, n * 0.03);
  if (_bPX > _faceMin) _faceN++;
  if (_bNX > _faceMin) _faceN++;
  if (_bPY > _faceMin) _faceN++;
  if (_bNY > _faceMin) _faceN++;
  if (_bPZ > _faceMin) _faceN++;
  if (_bNZ > _faceMin) _faceN++;
  var _eS0 = Math.min(sx, sy, sz), _eS2 = Math.max(sx, sy, sz), _eS1 = sx + sy + sz - _eS0 - _eS2;
  var _wxAreaX = ((_bPX + _bNX) > _faceMin) ? sy * sz : 0;   // X 向竖立面面积(须有对应主导面存在)
  var _wxAreaZ = ((_bPZ + _bNZ) > _faceMin) ? sy * sx : 0;   // Z 向竖立面面积(同上)
  var _wxBigV = (Math.max(_wxAreaX, _wxAreaZ) > 1.0 && sy > 0.45);   // R1: 大垂直面(炮塔侧/车体侧/裙甲; 轮盘炮管另行排除)
  var _wxHasHit = !(hint && hint._wxHitG === false);         // R3 命中门: 发光件组外恒真(无名调用沿缺省)
  var _wxBoxC = (!isCyl && _wxHasHit && _boxFrac > 0.68 && _faceN >= 4 && _eS0 > 0.22 * _eS1 && _eS2 > 0.35 && _cMin < 0.04 * _eS2 + 0.005);  // R3: 箱角件(多面+非薄板+够大+角点有顶点=真箱角)。★isCyl 显式排除: 角点验形阈值 0.04·eS2 随件长放大, 长炮管(16 段圆柱)角距≈0.15 会钻进 0.04×6+0.005=0.245 的门, 炮口/根部会冒出假箱角脱漆; 圆柱非箱, 一律不进(与 R1 同门)
  var _wxBase = !!(hint && hint._wxBase);                    // R2: 底边接平面(预分析)
  var _wxSeams = (hint && hint._wxSeams) || null;            // R4: 悬空附件缝(预分析)
  var _wxShadeL = (hint && hint._wxShade) || null;          // ★优化D: 凹腔遮蔽盒列表(预分析)
  var _wxFoldL = (hint && hint._wxFolds) || null;            // ★优化E: 跨件构造折角列表(预分析)
  var _wxPnl = (hint && hint._wxPanel) ? hint._wxPanel : null;   // ★VC板边: 装甲面检测距离场(_wxPanelPass 预分析; 无=该件走旧路)
  var _lumGate = _lum0 > 0.105;                              // 脱漆材质门: 橡胶(cRUBB 亮度 0.094)不露钢
  var _wxNoRust = !!(hint && (hint._wxDyn === 10 || hint._wxDyn === 20));   // 履带环件禁锈: 行走履带不生锈(军模纪律); 钢质履带板仍保留脱漆露亮金属
  for (v = 0; v < n; v++) {
    var X = pos[(vo + v) * 3], Y = pos[(vo + v) * 3 + 1], Z = pos[(vo + v) * 3 + 2];
    var nx = nrm[(vo + v) * 3], ny = nrm[(vo + v) * 3 + 1], nz = nrm[(vo + v) * 3 + 2];
    var hx = (X - x0) / sx, hy = (Y - y0) / sy, hz = (Z - z0) / sz;
    var an = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    var maxA = Math.max(an, ay, az), minA = Math.min(an, ay, az);
    var midA = an + ay + az - maxA - minA;
    /* —— 军模做旧 v11: 掉漆/剐蹭只发生在"边缘", 大面恒干净 ——
       方法论(可考据): ① Global Scale Modeller「二战 AFV 参考照里主要是划痕与磨损, 不是碎漆点,
       磨损要放在舱盖/炮盾沿/翼子板等高频接触处」; ② 少即是多(DakkaDakka)/现代装甲不许大面积掉漆,
       掉漆只放边边角角+海绵点法(zFrontier BLUE_MBT_1 例); ③ 锈=深棕打底+亮橙点睛(70/30), 哑光,
       只在潮气滞留处(铆钉/接缝/下缘), 雨水竖向拖出流锈(窄轨锈蚀指南/AK streaking grime)。
       实现分工: 本烘焙层(有法线+件内归一化坐标, 车型无关)负责"找边"+重力语义;
       片元层(仅 vCamoPos)只在边芯里点像素级海绵点, 不再按面积泼洒。
       边缘度 edge 同步打包进 camoArr 小数(整数部分阵营语义不动, 片元 fract 解包)。 */
    var crease = _wxSS(0.10, 0.34, midA) * _wxSS(1.0, 0.72, maxA);   // 两面夹角折痕(装甲折角/焊缝/舱盖环/翼根整流)
    var lipBand = _wxSS(0.12, 0.015, hy);                            // 件下缘窄带(只取最下 12% 高度: 裙甲/挡泥板下唇/围板底边)
    var xEnd = Math.max(_wxSS(0.07, 0.0, hx), _wxSS(0.93, 1.0, hx));
    var zEnd = Math.max(_wxSS(0.10, 0.0, hz), _wxSS(0.90, 1.0, hz));
    if (_wxPnl) { crease = 0; xEnd = 0; zEnd = 0; }   /* ★VC板边: 装甲件上几何找边启发式(crease 45°假环带/xEnd/zEnd 件内坐标窄带)让位给真几何检测 —— 折角语义由板边带接管, 端折/首甲折角/底盘缝随之归零; 重力语义(lipBand/sideSkirt)与叙事磨损(R1~R4/wheel)保留 */
    /* 盘形判据(提前到此处供 hullBelly 门用): 比例条件 + ★圆度验形(_cMin)——
       真圆盘(轮辋/舱盖/毂帽)的顶点永远到不了包络 3D 角(角点空), 方板(裙甲段/工具箱盖/
       履带板)四角有顶点(_cMin≈0)。旧判据只看比例, 0.08×1.0×0.9 方板会被误判成盘,
       端面四角吃满 rim-ring 磨损→假轮缘锈; 加圆度门后方板恒不是盘。 */
    var _eMin = Math.min(sx, sy, sz), _eMax = Math.max(sx, sy, sz);
    var _eMid = sx + sy + sz - _eMin - _eMax;
    var _isDisc = (_eMin < 0.30 && (_eMax - _eMid) <= 0.35 * _eMax && _eMax < 1.6 && _eMax > 0.08
                   && _cMin > 0.02 * _eMax + 0.004);
    var bellySeam = lipBand * _wxSS(0.30, -0.25, ny);                // 下缘-底盘交界折角(面朝下且贴下缘: 车首/车尾下装甲与底盘缝)
    var hullBelly = (isCyl || _isDisc) ? 0 : zEnd * bellySeam;       // 真实化: 圆柱/圆盘件(炮管/排气管/轮盘)无"底盘缝"语义, 禁入(否则炮管口/根部底线掉漆)
    var thinPlate = _wxSS(0.30, 0.10, sx / Math.max(sy + sz, 1e-3)); // 薄板件(裙甲/翼子板/工具箱盖: x 向最薄)
    var sideSkirt = lipBand * _wxSS(0.45, 0.85, an) * Math.max(xEnd, thinPlate);  // 裙甲与挡泥板下沿外唇
    if (_isDisc) sideSkirt = 0;   // ★vcpanel-4: 盘件(轮/毂/舱盖)只留rimRing, 裙板下唇与盘缘环在侧视底部交出V尖, 置零消V(薄板裙甲非盘不受影响)
    var endFold = zEnd * crease;                                     // 端面折角(车首装甲两折角/尾板折角)
    var glacisFold = endFold * (hz > 0.5 ? 1.0 : 0.4) * _wxSS(0.03, 0.30, hy) * _wxSS(0.92, 0.55, hy);
    /* 轮盘/舱盖盘通用磨损: 盘形件=最薄轴是盘轴、另两轴等大(负重轮辋唇/金属毂/舱盖沿/座圈都吃这一套;
       the roundness gate prevents long plates from being classified as wheels)。
       只磨盘缘环(半径 74%~86% × 盘侧壁), 不磨盘心: 橡胶盘心/舱盖顶恒干净。 */
    var wheel = 0;
    if (_isDisc) {   // 盘形判据(_eMin/_eMid/_eMax/_isDisc)已前移至 hullBelly 门, 此处直接用。
      // ★isCyl 不再直接放行: 旧条件「isCyl || _isDisc」让一切 vCyl 件(含炮管/排气管/火箭弹体这类长圆柱)
      //   无验形直入——长圆柱轴比>盘径, 盘轴启发式在 sx≈sy 平手时还会选错轴(浮点尘埃级 1e-8 即翻面),
      //   炮口/管端会冒出假「轮缘环磨损」(feature 0.95 → 大片掉漆+流锈)。轮/毂/舱盖都是矮胖盘
      //   (最薄轴≪盘径), 走 _isDisc 比例+圆度门即可全覆盖; 长圆柱一律无盘缘语义。
      var _r1, _r2, _nAx;
      if (sx <= sy && sx <= sz) {            // 盘轴 X(负重轮系): 盘面 YZ(旧代码误用 XZ 面=只磨轮上下两条, 已修正)
        _r1 = Y - (y0 + y1) * 0.5; _r2 = Z - (z0 + z1) * 0.5; _nAx = an;
      } else if (sy <= sx && sy <= sz) {     // 盘轴 Y(舱盖/座圈/舱门): 盘面 XZ
        _r1 = X - (x0 + x1) * 0.5; _r2 = Z - (z0 + z1) * 0.5; _nAx = ay;
      } else {                               // 盘轴 Z: 盘面 XY
        _r1 = X - (x0 + x1) * 0.5; _r2 = Y - (y0 + y1) * 0.5; _nAx = az;
      }
      var _rMax = Math.max(_eMid, _eMax) * 0.5;
      var _rimRing = _wxSS(0.74, 0.86, Math.hypot(_r1, _r2) / Math.max(_rMax, 1e-3));
      wheel = _rimRing * _wxSS(0.45, 0.80, 1 - _nAx);
      if (sy > 1.35) wheel *= 0.18;
    }
    var wingRoot = _wxSS(0.30, 0.44, hy) * _wxSS(0.70, 0.56, hy) * xEnd * crease * 0.55;  // 机翼/水平翼与机身连接(中段高度窄带)
    /* —— 真实化 R1: 大垂直面顶部流锈 ——
       雨水自顶边(防盾沿/顶甲檐)下淌: 稀疏竖列(约 22cm 宽软带, 随高度蛇行)× 自顶向下衰减; 只染竖立法向顶点。
       bake 写晕染 + 晕区 edge(0.30, 进 fragment 晕区不进芯区=只加微锈点/流锈柱, 不加脱漆点); 轮盘/炮管 excluded(另有 wheel 项)。 */
    var rustNew = 0, chipNew = 0, edgeNew = 0, rustAge = 0.30;   // ★优化A: rustAge=本顶点胜利锈源的锈龄(0=老锈红棕 ↔ 1=新锈亮橙)
    if (_wxBigV && !isCyl && !_isDisc && ay < 0.55) {
      var _tc = (an > az ? Math.floor(Z * 4.5 + (1 - hy) * 1.5) : Math.floor(X * 4.5 + (1 - hy) * 1.5)) + partIdx * 5;
      var _tch = _wxHash01(_tc, seed ^ 0x51ed);
      if (_tch > 0.855) {
        var _tlen = 0.25 + 0.40 * _wxHash01(_tc * 3 + 1, seed ^ 0x1b3d);   // 流长占面高 25%~65%
        var _tstr = _wxSS(1 - _tlen, 1 - _tlen + 0.18, hy);                 // 顶部最浓, 向下衰减
        var _tw = (_tch - 0.855) / 0.145;
        if (!_wxNoRust) { var _r1v = _tw * _tstr * 0.34 * A; if (_r1v > rustNew) { rustNew = _r1v; rustAge = 0.50; } }   // ★优化A: R1 顶檐雨锈=中龄
        var _r1f = _tw * _tstr;                   // ★优化C: R1 专属边带 0.395~0.42(段内位置=流强 _tw*_tstr);
        if (_r1f > 0.02) edgeNew = Math.max(edgeNew, 0.395 + 0.025 * _r1f);   // 带位<0.45 芯阈/>0.12 晕阈, 片元凭带位把流锈柱加密下沉到像素级(稀疏大面不再受细分度制约)
      }
    }
    /* —— 真实化 R2: 底边接平面 → 底线斑点锈 + 脱漆(潮气滞留 + 剐蹭线; 线芯推 edge 进 fragment 芯区) —— */
    if (_wxBase && ay < 0.60) {
      var _bl = _wxSS(0.085, 0.015, hy);                                   // 底线窄带(件高下 8%)
      if (_bl > 0.01) {
        var _sp = _wxHash01(Math.floor(X * 18 + partIdx) * 7 + Math.floor(Z * 18), seed ^ 0x2b7e);
        if (_sp > 0.90 && !_wxNoRust) { var _r2v = _bl * _wxSS(0.90, 0.985, _sp) * 0.55 * A; if (_r2v > rustNew) { rustNew = _r2v; rustAge = 0.22; } }   // ★优化A: R2 底线锈=慢湿老锈
        if (_lumGate) {
          var _bc = _wxHash01(Math.floor(X * 18) * 13 + Math.floor(Z * 18) * 5 + partIdx * 2, seed ^ 0x9e37);
          if (_bc > 0.955) chipNew = Math.max(chipNew, _bl * _wxSS(0.955, 0.995, _bc) * 0.75 * A);
        }
        edgeNew = Math.max(edgeNew, _bl * 0.72);
      } else if (hy < 0.22) {
        edgeNew = Math.max(edgeNew, _wxSS(0.22, 0.08, hy) * 0.30);          // 线上晕(微锈落位)
      }
    }
    /* —— 真实化 R3: 箱角(≥4 面 + 命中 + 90°构造验角)→ 角芯集中脱漆 + 角外零星锈 ——
       角 = 包络 8 角点: 轴对齐箱角二面角恒 90°, 满足 ≤90°; 非箱体件无法廉价验角, 保守跳过。
       bake 写钢芯 + 锈晕 + edge(角芯 0.80 进 fragment 芯区=海绵点加密, 角外晕区=微锈点)。 */
    if (_wxBoxC) {
      var _cdx = Math.min(X - x0, x1 - X), _cdy = Math.min(Y - y0, y1 - Y), _cdz = Math.min(Z - z0, z1 - Z);
      var _cd = Math.sqrt(_cdx * _cdx + _cdy * _cdy + _cdz * _cdz);
      if (_cd < 0.15) {
        var _ckC = _wxSS(0.15, 0.05, _cd);                                 // 角芯(9cm 内最浓)
        if (_lumGate) {
          var _ccC = _wxHash01((v * 7 + partIdx * 31) ^ Math.floor(_cd * 90), seed ^ 0x4d2c);
          if (_ccC > 0.45) chipNew = Math.max(chipNew, _ckC * _wxSS(0.45, 0.85, _ccC) * 0.85 * A);
        }
        edgeNew = Math.max(edgeNew, 0.30 + _ckC * 0.50);                   // 角芯 0.80(进 fragment 芯区)
      } else if (_cd < 0.30) {
        var _rh = _wxHash01((v * 11 + partIdx * 13) ^ Math.floor(_cd * 60), seed ^ 0x7f4a);
        if (_rh > 0.88 && !_wxNoRust) { var _r3v = _wxSS(0.88, 0.97, _rh) * 0.45 * A; if (_r3v > rustNew) { rustNew = _r3v; rustAge = 0.12; } }   // ★优化A: R3 角外零星锈=最老(干化红棕)
        edgeNew = Math.max(edgeNew, _wxSS(0.30, 0.15, _cd) * 0.30);
      }
    }
    /* —— ★优化E: 跨件构造折角 —— 两件平齐竖直角(90° 凸折线: 首甲×侧甲 / 裙板 L 角 / 塔×防盾),
       单件 R3 的包络角验形管不到(薄板件被非薄门排除); 折线语义与 R3 同: 角芯集中脱漆 + 角外零星老锈 —— */
    if (_wxFoldL) {
      for (var _fi = 0; _fi < _wxFoldL.length; _fi++) {
        var _fl = _wxFoldL[_fi];
        if (Y < _fl.y0 || Y > _fl.y1) continue;
        var _fd = Math.sqrt((X - _fl.x) * (X - _fl.x) + (Z - _fl.z) * (Z - _fl.z));
        if (_fd < 0.15) {
          var _ekC = _wxSS(0.15, 0.05, _fd);                                 // 折角芯(9cm 内最浓)
          if (_lumGate) {
            var _ecC = _wxHash01((v * 5 + partIdx * 41) ^ Math.floor(_fd * 90), seed ^ 0xe17a);
            if (_ecC > 0.42) chipNew = Math.max(chipNew, _ekC * _wxSS(0.42, 0.82, _ecC) * 0.80 * A);
          }
          edgeNew = Math.max(edgeNew, 0.30 + _ekC * 0.50);                   // 角芯 0.80(进 fragment 芯区)
        } else if (_fd < 0.30) {
          var _eh = _wxHash01((v * 3 + partIdx * 43) ^ Math.floor(_fd * 60), seed ^ 0xd3f1);
          if (_eh > 0.88 && !_wxNoRust) { var _er = _wxSS(0.88, 0.97, _eh) * 0.42 * A; if (_er > rustNew) { rustNew = _er; rustAge = 0.15; } }   // 角外零星锈=老锈(与 R3 同语义)
          edgeNew = Math.max(edgeNew, _wxSS(0.30, 0.15, _fd) * 0.30);
        }
      }
    }
    /* —— 真实化 R4: 悬空附件缝下流锈(缝 = 附件底边在受体竖面上的交线; 雨水沿缝下淌, 不入地) —— */
    if (_wxSeams && ay < 0.55 && Y > 0.03) {
      for (var _si = 0; _si < _wxSeams.length; _si++) {
        var _sm = _wxSeams[_si];
        var _onF = (_sm.ax === 0) ? ((_sm.s > 0 ? (nx > 0.35 && X > (x0 + x1) * 0.5) : (nx < -0.35 && X < (x0 + x1) * 0.5)))
                                  : ((_sm.s > 0 ? (nz > 0.35 && Z > (z0 + z1) * 0.5) : (nz < -0.35 && Z < (z0 + z1) * 0.5)));
        if (!_onF) continue;
        var _dy = _sm.y - Y;
        if (_dy <= 0 || _dy > 0.62) continue;
        var _tu = (_sm.ax === 0) ? Z : X;
        if (_tu < _sm.u0 - 0.06 || _tu > _sm.u1 + 0.06) continue;
        var _slen = 0.30 + 0.30 * _wxHash01(partIdx * 31 + _si * 7 + 3, seed ^ 0x6c07);
        if (_dy > _slen) continue;
        var _ch2 = _wxHash01(Math.floor(_tu * 20 + _dy * 6) + partIdx * 11 + _si * 101, seed ^ 0x3c6e);
        if (_ch2 > 0.45) {
          var _ds = Math.pow(1 - _dy / _slen, 1.5);
          if (!_wxNoRust) { var _r4v = _wxSS(0.45, 0.8, _ch2) * _ds * 0.52 * A; if (_r4v > rustNew) { rustNew = _r4v; rustAge = 0.88; } }   // ★优化A: R4 缝流锈=持续湿区新锈(亮橙)
          edgeNew = Math.max(edgeNew, _ds * 0.30);
        }
      }
    }
    /* vcpanel-6：旧 feature 不是拓扑边，而是包围盒比例/法线分量/高度带的混合。
       负重轮倒 V 正由 wheel(rimRing 顶点值)与三角插值产生；平面斜线则来自 sideSkirt、
       glacisFold、endFold、R2/R3 edgeNew 等启发式。它们不得再驱动任何灰白钢色或 edge 编码。
       锈色本身仍可由 rustNew/streak 顶点色保留，但“裸钢/灰白线”唯一由 _wxPanel 提供。 */
    if (!_lumGate) { rustNew = 0; edgeNew = 0; }
    var feature = 0;
    var chip = 0;
    /* 流锈(重力语义: 件本地 -Y≈车体 -Y; 炮塔绕 Y 旋转/身管小俯仰不改变重力方向)。
       锈只从特征线向下走: 稀疏窄列(旧 0.915≈8.5% 列全开) × 特征线存在门控 × 下方延展;
       随外壳走势轻微蛇行: 列相位按高度漂移(雨水贴壳下淌不是数学直线)。 */
    var ch = _wxHash01(Math.floor(X * 6 + 3 + (1 - hy) * 2.2) + partIdx * 3, seed ^ Math.floor(Z * 6 + 3));
    var streak = 0;
    if (ch > 0.945 && ny < 0.45 && !_wxNoRust) {   // 履带环件禁流锈(行走履带不生锈, 见 _wxNoRust)
      streak = (ch - 0.945) / 0.055 * _wxSS(0.10, 0.55, 1 - hy) * (1 - Math.max(0, ny)) * 0.40 * A
        * Math.min(1, feature * 3.0 + 0.12);
    }
    var wash = 0.08 * A * _wxSS(0.22, 0.0, hy) * Math.max(0, 0.35 - ny);
    var m = panelM * (1 + 0.05 * ny * A) * (1 - wash);
    var r = pa[0] * m, g = pa[1] * m, b = pa[2] * m;
    /* vcpanel-6：chipNew 的 R2/R3 包络角点命中不再混入裸钢色。
       真正的灰白脱漆在片元层由 _wxPanel 的低段编码单独绘制。 */
    var rw = streak, rwAge = 0.38;             // ★优化A: rwAge 随胜利源锈龄走(特征线流锈=中偏老)
    if (rustNew > rw) { rw = rustNew; rwAge = rustAge; }   // R1/R2/R3/R4 锈并入(取最强, 防叠黑; ★优化A: 一并带胜利源锈龄)
    if (!isArmor && !_wxNoRust && _lumGate) { var _mbR = metal * bellySeam * 0.28 * A * (0.4 + 0.6 * h3); if (_mbR > rw) { rw = _mbR; rwAge = 0.30; } }   // 履带环件禁底缘锈(同上) ★vcpanel-4: 加_lumGate, 胶底不锈
    if (rw > 0.012) {                            // ★优化A: 锈分期色 —— 老锈暗红棕 ↔ 新锈亮橙, 按源锈龄+逐顶点抖动(±0.11)插值
      var _raJ = rwAge + (_wxHash01(v * 19 + partIdx * 23, seed ^ 0x7ea9) - 0.5) * 0.22;
      if (_raJ < 0) _raJ = 0; else if (_raJ > 1) _raJ = 1;
      r += (_WX_RUST[0] + (_WX_RUST_NEW[0] - _WX_RUST[0]) * _raJ - r) * rw * 0.70;
      g += (_WX_RUST[1] + (_WX_RUST_NEW[1] - _WX_RUST[1]) * _raJ - g) * rw * 0.70;
      b += (_WX_RUST[2] + (_WX_RUST_NEW[2] - _WX_RUST[2]) * _raJ - b) * rw * 0.70;
    }
    /* ★优化D: 凹腔暗渍 —— 被上方件投影罩住(低于其底 3cm)的顶点吃暖暗渍, 仿 AO Dirt(多层遮蔽指数饱和; 军模工序: 尘土盖最上层) */
    if (_wxShadeL) {
      var _ns = 0;
      for (var _zi = 0; _zi < _wxShadeL.length; _zi++) {
        var _zb = _wxShadeL[_zi];
        if (X >= _zb.x0 && X <= _zb.x1 && Z >= _zb.z0 && Z <= _zb.z1 && Y < _zb.yb - 0.03) _ns++;
      }
      if (_ns > 0) {
        var _shG = (1 - Math.pow(0.38, _ns)) * 0.17 * A;   // 1 盒 0.105 / 2 盒 0.152 / ≥3 盒≈0.16 封顶(×A 回滚联动)
        r += (0.145 - r) * _shG; g += (0.125 - g) * _shG; b += (0.098 - b) * _shG;
      }
    }
    col[(vo + v) * 3] = r; col[(vo + v) * 3 + 1] = g; col[(vo + v) * 3 + 2] = b;
    /* vcpanel-6 单一灰白边通道：aCamo 小数只接收 EdgesGeometry 同源距离场。
       禁止 feature/chip/edgeNew 再以高段值触发 _edgeCore/_edgeHalo；这一步从根上切断负重轮倒 V、
       包围盒下唇线、斜面端带和角点连线。整数阵营语义保持不变。 */
    var edge = (_wxPnl && _wxPnl[v] > 0) ? _wxPnl[v] : 0;
    if (camoArr) camoArr[vo + v] = (camoBase || 0) + edge;
  }
}

/* ===== 片元层: 世界空间积尘 + 动态战损 =====
   两个 varying(共 2 个 vec4 槽位):
     vWOP  = vec4(件本地坐标 xyz, 积尘量 w)   —— 积尘在顶点算(件本地/世界法线逐顶点都精确, 盒面内线性插值即真值)
     vWHit = vec4(件本地命中点 xyz, 打包 w)  —— 局部焦痕+延迟锈在片元算(w=半径1/64m+命中时刻0.5s, ★优化H)
   玩家/AI 分支: 玩家车是个体 Mesh(共用材质, 逐 draw call 由 onBeforeRender 写 uniform);
                AI 是 InstancedMesh(逐实例走实例属性)。二者由 defines.VEH_PLAYER 区分。 */
var _WX_UNIFORMS = null;                    // 共享 uniform 表(所有载具材质共用同一组引用对象)
function _wxUniforms() {
  if (_WX_UNIFORMS) return _WX_UNIFORMS;
  _WX_UNIFORMS = {
    uWeatherAmt: { value: WEATHER_AMT },
    uDustCol: { value: new THREE.Vector3(0.42, 0.40, 0.31) },
    uWxRustEnv: { value: new THREE.Vector2(1.0, 0.0) },     /* ★优化F: 地图锈环境 [量×, 龄偏移](weatherSetDustCol 联动写入) */
    uVehDmg: { value: 0 }, uVehWear: { value: 1 }, uVehHit: { value: new THREE.Vector4(0, 0, 0, 0) },
    uWxNow: { value: 0 }                                    /* ★优化H: 会话时钟(战损延迟锈龄期基准, trackAnimUpdate 每帧写一次 float) */
  };
  return _WX_UNIFORMS;
}
var WX_VS_PARS = [
  'varying vec4 vWOP;',
  '#ifdef WX_SCORCH',
  'varying vec4 vWHit;',
  '#endif',
  '#ifdef VEH_PLAYER',
  '  uniform float uVehDmg;  uniform float uVehWear;  uniform vec4 uVehHit;',
  '#else',
  '#ifndef INSTA_DECL',
  '#define INSTA_DECL',
  '  attribute vec4 aInstA;',   /* .x/.y=履带左右偏移或滚动量(hull) .z=战损 .w=风化 —— 打包省 3 个属性槽 */
  '#endif',
  '  attribute vec4 aVehHit;',
  '#endif',
  'uniform float uWeatherAmt;'
].join('\n');
var WX_VS_BODY = [
  '{',
  '  vec3 _wn = objectNormal;',
  '  #ifdef USE_INSTANCING',
  '    _wn = mat3(instanceMatrix) * _wn;',                     /* 实例流: 世界朝向要过 instanceMatrix */
  '  #endif',
  '  vec3 _wN = normalize(mat3(modelMatrix) * _wn);',          /* 车体俯仰/横滚时仍然正确(重力积尘不跟着翻) */
  '  float _dUp   = smoothstep(0.55, 0.95, _wN.y);',           /* 顶盖薄尘,削弱弧面斑驳 */
  '  float _dLow  = 1.0 - smoothstep(0.12, 1.10, position.y);',/* 下缘扬尘(履带/裙板附近) */
  '  float _dRear = (1.0 - smoothstep(-2.0, 0.0, position.z)) * 0.22;', /* 车尾薄尘 */
  '  float _dSide = (1.0 - abs(_wN.y)) * (1.0 - smoothstep(0.35, 1.40, position.y)) * 0.18;', /* 侧下沿薄尘 */
  '  float _dust  = clamp(max(_dUp * 0.12, _dLow * 0.70) + _dRear + _dSide, 0.0, 1.0);',
  '  #ifdef VEH_PLAYER',
  '    float _dmg = uVehDmg; float _wear = uVehWear;',
  '  #else',
  '    float _dmg = aInstA.z; float _wear = aInstA.w - floor(aInstA.w * 0.25 + 0.0001) * 4.0;',  /* 与 hull 槽位打包兼容; 炮塔 wear<4 时恒等 */
  '  #endif',
  '  #ifdef WX_SCORCH',
  '    #ifdef VEH_PLAYER',
  '      vWHit = uVehHit;',
  '    #else',
  '      vWHit = aVehHit;',
  '    #endif',
  '  #endif',
  '  _dust = clamp(_dust * _wear + _dmg * 0.35, 0.0, 1.0) * uWeatherAmt;',
  '  vWOP = vec4(position, _dust);',
  '  #ifdef USE_COLOR',
  '    vColor.rgb *= 1.0 - _dmg * 0.14 * uWeatherAmt;',        /* 战损整体压暗: 逐件常量, 顶点算即精确 */
  '  #endif',
  '}'
].join('\n');
var WX_FS_PARS = [
  'varying vec4 vWOP;',
  '#ifdef WX_SCORCH',
  'varying vec4 vWHit;',
  '#endif',
  'uniform float uWeatherAmt;',
  'uniform vec3 uDustCol;',
  '#ifndef WX_UWXRUSTENV',                                     /* 守卫宏: 与迷彩补丁(CAMO_FS_PARS)互斥声明, 任意补丁组合都不重复 */
  '#define WX_UWXRUSTENV',
  'uniform vec2 uWxRustEnv;',                                  /* ★优化H/F: 地图锈环境(锈量×/锈龄偏移) */
  '#endif',
  'uniform float uWxNow;'                                      /* ★优化H: 会话时钟(命中龄期 = uWxNow - 打包时刻) */
].join('\n');
var WX_FS_BODY = [
  '{',
  '  diffuseColor.rgb = mix(diffuseColor.rgb, uDustCol, vWOP.w * 0.42);',   /* ⑥ 积尘盖在最上层 */
  '  #ifdef WX_SCORCH',
  '  if (vWHit.w > 0.001) {',                                              /* ⑧ 动态战损: 局部焦痕 + ★优化H 延迟锈, O(1) */
  '    float _hw = vWHit.w;',                                              /* ★优化H 打包: 整数位=焦痕半径(1/64m), 小数位=命中时刻(0.5s) */
  '    float _hr = floor(_hw) * 0.015625;',
  '    float _ht = fract(_hw) * 2048.0;',
  '    float _dd = length(vWOP.xyz - vWHit.xyz);',
  '    float _m  = 1.0 - smoothstep(_hr * 0.35, _hr, _dd);',
  '    float _core = 1.0 - smoothstep(0.0, _hr * 0.45, _dd);',
  '    vec3 _sc = mix(vec3(0.105, 0.090, 0.078), vec3(0.030, 0.028, 0.026), _core);',
  '    diffuseColor.rgb = mix(diffuseColor.rgb, _sc, _m * 0.72 * uWeatherAmt);',
  '    diffuseColor.rgb = mix(diffuseColor.rgb, uDustCol, _m * 0.18 * uWeatherAmt);',  /* 焦痕外圈挂灰 */
  '    float _age = max(0.0, uWxNow - _ht);',                              /* ★优化H: 命中后延迟生锈(裸钢暴露→闪锈, 实车语义) */
  '    if (_age > 4.0) {',
  '      float _on  = smoothstep(4.0, 9.0, _age);',                        /* 4~9s 起锈: 烟尘散尽, 漆面破损处开始氧化 */
  '      float _gro = 1.0 - exp(-(_age - 4.0) * 0.030);',                  /* 强度随时间饱和(~2min 到 95%) */
  '      float _el  = 1.0 + 0.9 * min(1.0, _age / 45.0);',                 /* 锈晕随龄期向下拉长(雨水拖锈, 与 R1/R4 同重力语义) */
  '      vec3 _dv = vWOP.xyz - vWHit.xyz;',
  '      float _dyr = _dv.y < 0.0 ? (-_dv.y / _el) : (-_dv.y * 1.6);',     /* 命中点下方拉长 / 上方压缩 */
  '      float _ddE = length(vec3(_dv.x, _dyr, _dv.z));',
  '      float _mE = 1.0 - smoothstep(_hr * 0.30, _hr * 1.12, _ddE);',
  '      float _rim = _mE * (1.0 - 0.55 * _core);',                       /* 锈在焦痕边圈最重(漆烧蚀露钢), 芯部积烟迟锈 */
  '      float _ra = _on * _gro * _rim * 0.86 * uWxRustEnv.x * uWeatherAmt;',
  '      float _rAg = clamp(0.85 - 0.55 * _gro + uWxRustEnv.y, 0.0, 1.0);', /* 初生闪锈亮橙 → 渐老红棕; 干旱图偏老(优化F 联动) */
  '      vec3 _rc2 = mix(vec3(0.230, 0.112, 0.055), vec3(0.435, 0.205, 0.068), _rAg);',
  '      diffuseColor.rgb = mix(diffuseColor.rgb, _rc2, clamp(_ra, 0.0, 0.88));',
  '    }',
  '  }',
  '  #endif',
  '}'
].join('\n');
/* 注入一个载具材质(可组合: 只 replace 各自的锚点, 不覆盖已有 onBeforeCompile) */
function weatherPatchMaterial(mat, isPlayer, tag) {
  if (!mat) return mat;
  var prev = mat.onBeforeCompile;
  if (isPlayer) { mat.defines = mat.defines || {}; mat.defines.VEH_PLAYER = 1; }
  if (typeof WX_SCORCH !== 'undefined' && WX_SCORCH) { mat.defines = mat.defines || {}; mat.defines.WX_SCORCH = 1; }
  mat.onBeforeCompile = function (shader) {
    if (prev) prev(shader);                                   // 履带纹路 patch 先跑(顺序不可颠倒)
    var U = _wxUniforms();
    shader.uniforms.uWeatherAmt = U.uWeatherAmt;
    shader.uniforms.uDustCol = U.uDustCol;
    shader.uniforms.uVehDmg = U.uVehDmg;
    shader.uniforms.uVehWear = U.uVehWear;
    shader.uniforms.uVehHit = U.uVehHit;
    shader.uniforms.uWxRustEnv = U.uWxRustEnv;                            /* ★优化H/F */
    shader.uniforms.uWxNow = U.uWxNow;
    mat.userData.wxU = U;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WX_VS_PARS)
      /* ★注入点必须是 <begin_vertex> 而不是 <color_vertex>: objectNormal 在 <beginnormal_vertex> 里才声明,
         而 meshphysical_vert 的顺序是 <color_vertex> → <beginnormal_vertex> → … → <begin_vertex>。
         注入早了会报 'objectNormal' : undeclared identifier → 顶点着色器编译失败 → 载具整体不渲染。 */
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WX_VS_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WX_FS_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + WX_FS_BODY);
  };
  /* ★缓存键必须带材质标签: 只回 'wxA' 会让 vehBodyMat 与 vehHullMat 命中同一份编译产物,
     履带 UV 偏移 shader 与车体 shader 互相顶掉(履带停止滚动 / 车体被套上履带分支)。 */
  mat.customProgramCacheKey = function () { return 'wxE2' + (isPlayer ? 'P' : 'A') + (tag || ''); };
  mat.needsUpdate = true;
  return mat;
}
/* ===== 程序化数码迷彩(仅迷彩,不含刻线/螺栓/排线) =====
   v2 根治版+阵营路由:门控不再猜颜色 —— 装甲身份由建模期 visPartPush 按件烧录为 aCamo 属性
   (0=非装甲/1=红方07数码/2=蓝方NATO三色),烘焙前判定故对风化漂移免疫;换漆色/新增载具只要沿用 cBODY/cACC+team 即自动生效。
   The camouflage hash and density sampler are shared by the garage and battlefield materials.
   刻意未移植: applyPhysicalArmorDetails(侧裙缝/螺栓)/getPureMangaHatching(排线)/Cel量化/三风格合成。
   注入方式: onBeforeCompile 链式(与 weatherPatchMaterial 同范式,prev 先跑),作用于共享载具材质
   vehBodyMat/vehHullMat/vehHullMatPlayer/vehBodyMatPlayer —— 战场车辆与机库预览车同吃一套,零新增 draw call。
   叠放顺序(片元): 本迷彩(@<color_fragment>) → 履带贴图(@<map_fragment>,three 原生在后) → 风化积尘/战损(weather,@<color_fragment>后追加,因链式后跑故盖在迷彩上层)。
   采样坐标为件本地米制(position),随车走不随世界飘。 */
var CAMO_MODE = 1;   // 0=原漆纯色(直通) / 1=PLA07通用 / 2=19荒漠 / 3=战术灰蓝;改值即时生效(走 uniform,无需重编译)
var _CAMO_UNIFORMS = null;
function _camoUniforms() {
  if (_CAMO_UNIFORMS) return _CAMO_UNIFORMS;
  _CAMO_UNIFORMS = { uCamoMode: { value: CAMO_MODE } };
  return _CAMO_UNIFORMS;
}
var CAMO_VS_PARS = [
  'attribute float aCamo;',
  'varying vec3 vCamoPos;',
  'varying float vCamoFlag;'
].join('\n');
var CAMO_VS_BODY = [
  'vCamoPos = position;',
  'vCamoFlag = aCamo;'
].join('\n');
var CAMO_FS_PARS = [
  'varying vec3 vCamoPos;',
  'varying float vCamoFlag;',
  '  uniform int uCamoMode;',
  '#ifndef WX_UWXRUSTENV',       /* 守卫宏: 与风化补丁(WX_FS_PARS)互斥声明, 任意补丁组合都不重复 */
  '#define WX_UWXRUSTENV',
  '  uniform vec2 uWxRustEnv;',   /* ★优化F: x=锈量倍率 y=锈龄偏移(地图环境, 共享 uniform 运行时可切) */
  '#endif',
  '  uniform float uPanelAmt;',   /* ★VC板边: 板缘脱漆强度(与 WX_PANEL_AMT 同源, 共享 uniform 运行时可调) */
  'float hash31(vec3 p) {',
  '  p = fract(p * vec3(123.34, 456.21, 789.92));',
  '  p += dot(p, p + 45.32);',
  '  return fract(p.x * p.y * p.z);',
  '}',
  'float hash21(vec2 p) {',
  '  p = fract(p * vec2(234.34, 435.345));',
  '  p += dot(p, p + 34.23);',
  '  return fract(p.x * p.y);',
  '}',
  'float camoNoise3D(vec3 p) {',
  '  vec3 ip = floor(p);',
  '  vec3 fp = fract(p);',
  '  vec3 u = fp * fp * (3.0 - 2.0 * fp);',
  '  float n000 = hash31(ip);',
  '  float n100 = hash31(ip + vec3(1.0, 0.0, 0.0));',
  '  float n010 = hash31(ip + vec3(0.0, 1.0, 0.0));',
  '  float n110 = hash31(ip + vec3(1.0, 1.0, 0.0));',
  '  float n001 = hash31(ip + vec3(0.0, 0.0, 1.0));',
  '  float n101 = hash31(ip + vec3(1.0, 0.0, 1.0));',
  '  float n011 = hash31(ip + vec3(0.0, 1.0, 1.0));',
  '  float n111 = hash31(ip + vec3(1.0, 1.0, 1.0));',
  '  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);',
  '}',
  'float camoFbm3D(vec3 p) {',
  '  float f = 0.50 * camoNoise3D(p);',
  '  p = p * 2.02 + vec3(17.1, 9.3, 5.7);',
  '  f += 0.30 * camoNoise3D(p);',
  '  p = p * 2.03 + vec3(11.3, 3.1, 8.2);',
  '  f += 0.20 * camoNoise3D(p);',
  '  return f;',
  '}',
  'vec3 getHighDensityDigitalCamo(vec3 mPos, vec3 origCol, int mode, float isArmor) {',
  '  if (isArmor < 0.5 || mode == 0) return origCol;',
  '  float pixelDensity = 28.0;',
  '  vec3 microGrid = floor(mPos * pixelDensity) / pixelDensity;',
  '  vec3 macroP = microGrid * 1.5;',
  '  vec3 warp = vec3(',
  '    sin(macroP.y * 1.6 + macroP.z * 1.1),',
  '    cos(macroP.z * 1.6 + macroP.x * 1.1),',
  '    sin(macroP.x * 1.6 + macroP.y * 1.1)',
  '  ) * 0.42;',
  '  vec3 pw = macroP + warp;',
  '  float n1 = hash31(floor(pw * 1.8));',
  '  float n2 = hash31(floor(pw * 3.6) + vec3(17.3, 31.7, 53.1));',
  '  float n3 = hash31(floor(pw * 7.2) + vec3(43.7, 89.2, 11.5));',
  '  float camoVal = n1 * 0.52 + n2 * 0.32 + n3 * 0.16;',
  '  vec3 c0, c1, c2, c3;',
  '  if (mode == 1) {',
  '    c0 = vec3(0.18, 0.24, 0.16);',
  '    c1 = vec3(0.30, 0.38, 0.24);',
  '    c2 = vec3(0.47, 0.42, 0.31);',
  '    c3 = vec3(0.16, 0.20, 0.14);',
  '  } else if (mode == 2) {',
  '    c0 = vec3(0.54, 0.46, 0.32);',
  '    c1 = vec3(0.71, 0.62, 0.47);',
  '    c2 = vec3(0.81, 0.77, 0.67);',
  '    c3 = vec3(0.36, 0.28, 0.20);',
  '  } else {',
  '    c0 = vec3(0.23, 0.29, 0.34);',
  '    c1 = vec3(0.39, 0.46, 0.53);',
  '    c2 = vec3(0.61, 0.69, 0.76);',
  '    c3 = vec3(0.20, 0.24, 0.28);',
  '  }',
  '  vec3 camoCol = c0;',
  '  if (camoVal > 0.67) camoCol = c3;',
  '  else if (camoVal > 0.47) camoCol = c2;',
  '  else if (camoVal > 0.26) camoCol = c1;',
  '  return camoCol;',
  '}',
  'float natoVNoise(vec3 p) {',
  '  vec3 ip = floor(p);',
  '  vec3 fp = fract(p);',
  '  vec3 u = fp * fp * (3.0 - 2.0 * fp);',
  '  float n000 = hash31(ip);',
  '  float n100 = hash31(ip + vec3(1.0, 0.0, 0.0));',
  '  float n010 = hash31(ip + vec3(0.0, 1.0, 0.0));',
  '  float n110 = hash31(ip + vec3(1.0, 1.0, 0.0));',
  '  float n001 = hash31(ip + vec3(0.0, 0.0, 1.0));',
  '  float n101 = hash31(ip + vec3(1.0, 0.0, 1.0));',
  '  float n011 = hash31(ip + vec3(0.0, 1.0, 1.0));',
  '  float n111 = hash31(ip + vec3(1.0, 1.0, 1.0));',
  '  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);',
  '}',
  'float natoFbm2(vec3 p) {',
  '  float f = 0.5 * natoVNoise(p);',
  '  p = p * 2.03 + vec3(19.1, 7.7, 5.3);',
  '  f += 0.25 * natoVNoise(p);',
  '  return f * 1.3333;',
  '}',
  'float natoFbm3(vec3 p) {',
  '  float f = 0.5 * natoVNoise(p);',
  '  p = p * 2.03 + vec3(19.1, 7.7, 5.3);',
  '  f += 0.25 * natoVNoise(p);',
  '  return f * 1.1429;',
  '}',
  'vec3 getNatoTricolorCamo(vec3 mPos, vec3 origCol, float flag) {',
  '  if (flag < 1.5) return origCol;',
  '  vec3 bp = mPos * 1.35;',
  '  float w1 = natoFbm2(bp + vec3(3.1, 7.7, 1.3));',
  '  float w2 = natoFbm2(bp * 1.3 + vec3(9.7, 2.9, 5.5));',
  '  vec3 pw = bp + vec3(w1 - 0.5, w2 - 0.5, (w1 + w2) * 0.5 - 0.5) * 2.2;',
  '  float A = natoFbm3(pw);',
  '  float B = natoFbm2(pw * 1.6 + vec3(9.2, 4.4, 6.1));',
  '  float g = natoVNoise(mPos * 8.0);',
  '  vec3 NATO_GREEN = vec3(0.365, 0.360, 0.240);',
  '  vec3 NATO_BROWN = vec3(0.335, 0.270, 0.175);',
  '  vec3 NATO_BLACK = vec3(0.185, 0.175, 0.140);',
  '  float brownM = smoothstep(0.46, 0.56, A);',
  '  vec3 nCamoCol = mix(NATO_GREEN, NATO_BROWN, brownM);',
  '  float blackM = smoothstep(0.56, 0.63, B);',
  '  nCamoCol = mix(nCamoCol, NATO_BLACK, blackM);',
  '  nCamoCol *= 1.0 + (w1 - 0.5) * 0.16;',
  '  nCamoCol *= 1.0 + (g - 0.5) * 0.10;',
  '  return nCamoCol;',
  '}'
].join('\n');
var CAMO_FS_BODY = [
  '{',
  '  vec3 _camoCol = diffuseColor.rgb;',
  '  float _cTeam = floor(vCamoFlag + 0.05);',
  '  vec3 _basePaint = diffuseColor.rgb;',
  '  if (_cTeam > 0.5 && uCamoMode != 0) {',
  '    _basePaint = (_cTeam > 1.5) ? getNatoTricolorCamo(vCamoPos, diffuseColor.rgb, _cTeam) : getHighDensityDigitalCamo(vCamoPos, diffuseColor.rgb, uCamoMode, 1.0);',
  '  }',
  '  /* 提取并应用顶点烘焙的光影与色差调制 (天光梯度、逐板调制、AO凹缝压暗) */',
  '  float _bLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));',
  '  float _refLum = (_cTeam > 1.5) ? 0.440 : ((_cTeam > 0.5) ? 0.340 : max(_bLum, 0.05));',
  '  float _mRatio = clamp(_bLum / max(_refLum, 0.05), 0.65, 1.35);',
  '  _basePaint *= _mRatio;',
  '  /* 天光与日照褪色/氧化 (上表面与车体顶部轻度发白褪色) */',
  '  float _sunBleach = clamp((vCamoPos.y - 0.35) * 0.26, 0.0, 0.30) * (0.65 + 0.35 * camoNoise3D(vCamoPos * 2.2));',
  '  _basePaint = mix(_basePaint, _basePaint * 1.15 + vec3(0.04, 0.045, 0.035), _sunBleach * 0.50);',
  '  /* vcpanel-7 四档材质内边带：主装甲 / 武器装饰 / 履带 / 轻薄板旋翼。 */',
  '  float _edgeRaw = fract(vCamoFlag + 0.05) - 0.05;',
  '  float _mArmor  = step(0.025, _edgeRaw) * step(_edgeRaw, 0.105);',
  '  float _mDetail = step(0.135, _edgeRaw) * step(_edgeRaw, 0.215);',
  '  float _mTrack  = step(0.245, _edgeRaw) * step(_edgeRaw, 0.325);',
  '  float _mLight  = step(0.355, _edgeRaw) * step(_edgeRaw, 0.435);',
  '  float _peM = max(max(_mArmor, _mDetail), max(_mTrack, _mLight));',
  '  float _peT0 = clamp(_mArmor  * ((_edgeRaw - 0.03) / 0.07)',
  '                    + _mDetail * ((_edgeRaw - 0.14) / 0.07)',
  '                    + _mTrack  * ((_edgeRaw - 0.25) / 0.07)',
  '                    + _mLight  * ((_edgeRaw - 0.36) / 0.07), 0.0, 1.0);',
  '  float _peWeight = _mArmor + _mDetail * 0.42 + _mTrack * 0.30 + _mLight * 0.38;',
  '  float _peWidth = _mArmor * 0.120 + _mDetail * 0.060 + _mTrack * 0.050 + _mLight * 0.065;',
  '  float _edgeWear = 0.0; float _edgeCore = 0.0; float _edgeHalo = 0.0; float _r1s = 0.0;',
  '  /* vcpanel-9: 两次平滑3D value-noise=每像素16次hash；改为边带内两级晶格hash。',
  '     面内/非灰白像素直接保持0.5，不再为最终乘零的结果支付噪声。 */',
  '  float _peN = 0.5;',
  '  if (_peT0 > 0.001) {',
  '    _peN = hash31(floor(vCamoPos * 9.0)) * 0.6 + hash31(floor(vCamoPos * 23.0) + vec3(13.7, 5.1, 9.3)) * 0.4;',
  '  }',
  '  float _peT = clamp(_peT0 + (_peN - 0.5) * (0.18 + 0.12 * _peWeight), 0.0, 1.0);',
  '  float _peDen = max(fwidth(vCamoPos.x), max(fwidth(vCamoPos.y), fwidth(vCamoPos.z)));',
  '  float _peSl = fwidth(_peT0) / max(_peDen, 1e-7);',
  '  float _peThr = clamp(1.0 - _peWidth * _peSl, 0.15, 0.92);',
  '  _peT = pow(smoothstep(_peThr, 1.0, _peT), 1.3);',
  /* 轻量化只改材质带宽/强度，不创建 LineSegments 覆盖描边。 */
  '  float _peK = mix(1.0, 0.35, smoothstep(20.0, 80.0, length(vViewPosition)));',
  '  /* 海绵掉漆点: 12/m 晶格(约 8cm 点距), 点径 5~15mm, 只在芯内成点 */',
  '  vec3 _ecell = floor(vCamoPos * 12.0);',
  '  float _chipM = _edgeCore * smoothstep(0.90, 0.96, hash31(_ecell + vec3(7.7, 3.1, 5.5)));',
  '  /* 点内分层: 氧化底漆环 + 钢芯(军模顺序: 先锈底后点金属, 钢只露中心约三分之一) */',
  '  float _steelIn = smoothstep(0.60, 0.80, hash31(_ecell + vec3(1.3, 9.1, 4.7)));',
  '  float _primerMask = _chipM;',
  '  float _steelMask = _chipM * _steelIn * 0.85;',
  '  /* 经典军模配色: 氧化防锈红底漆 + 哑光碳素暗钢 + 锈色; 折边干扫磨亮(石墨笔高点效应, 极淡) */',
  '  vec3 _PRIMER_COL = vec3(0.235, 0.105, 0.058);',
  '  vec3 _STEEL_COL  = vec3(0.125, 0.135, 0.145);',
  '  vec3 _weathered = _basePaint;',
  '  _weathered += vec3(0.030, 0.033, 0.035) * _edgeCore * (1.0 - _chipM);',
  '  _weathered = mix(_weathered, _PRIMER_COL, _primerMask * 0.9);',
  '  float _chipTone = hash31(_ecell + vec3(4.1, 8.3, 2.9));',      // ★优化A: 掉漆三档钢色(军模双色掉漆法: 暗钢70%/中钢20%/亮钢10%, 亮钢=刚磕开的裸金属)
  '  vec3 _steel3 = (_chipTone < 0.70) ? _STEEL_COL : ((_chipTone < 0.90) ? vec3(0.205, 0.215, 0.228) : vec3(0.340, 0.355, 0.372));',
  '  _weathered = mix(_weathered, _steel3, _steelMask * 0.9);',
  /* ★VC板边脱漆: 板缘灰白裸金属渐变(战场女武神式剥漆亮边, 凸棱/板缘才画, 检测期二面角保证);
     带内零星深底漆点=军模双色掉漆法(亮边上点深色, 与海绵点同晶格不同相位) */
  '  _weathered = mix(_weathered, mix(vec3(0.585, 0.592, 0.612), vec3(0.700, 0.706, 0.724), _peN), _peM * _peT * _peWeight * _peK * 0.85 * uPanelAmt);',
  '  float _peChip = _peM * _peWeight * smoothstep(0.55, 0.85, _peT) * smoothstep(0.93, 0.97, hash31(_ecell + vec3(2.2, 6.6, 1.1)));',
  '  _weathered = mix(_weathered, _PRIMER_COL, _peChip * 0.55 * uPanelAmt);',
  '  /* 晕区锈蚀: 微锈点(34/m, 晕内约 5%) + 竖向流锈柱(列宽约 2.8cm × 柱高约 12cm, 列相位随高度漂移=贴壳蛇行); 深棕打底, 哑光 */',
  '  float _pitM = _edgeHalo * smoothstep(0.93, 0.98, hash31(floor(vCamoPos * 34.0) + vec3(3.7, 8.9, 2.1)));',
  '  vec3 _dripCell = floor(vec3(vCamoPos.x * 36.0 + vCamoPos.y * 3.0, vCamoPos.y * 8.0, vCamoPos.z * 36.0 + vCamoPos.y * 3.0));',
  '  float _dripTh = 0.88 - 0.20 * _r1s;',                         // ★优化C: R1 带内流锈柱加密(阈值 0.88→0.68, 约 7%→18% 列)
  '  float _dripM = _edgeHalo * smoothstep(_dripTh, _dripTh + 0.06, hash31(_dripCell + vec3(5.2, 1.4, 7.9)));',
  '  /* ★优化A/F: 锈分期色(老锈暗红棕↔新锈亮橙: 逐柱哈希 + 低处沉积偏老 + R1 雨区偏新) × 地图锈环境(uWxRustEnv) */',
  '  float _rustAge = clamp(0.30 + 0.55 * hash31(_dripCell + vec3(9.4, 2.6, 6.1)) - 0.18 * clamp(vCamoPos.y * 0.55, 0.0, 1.0) + 0.28 * _r1s + uWxRustEnv.y, 0.0, 1.0);',
  '  vec3 _rustC = mix(vec3(0.230, 0.112, 0.055), vec3(0.435, 0.205, 0.068), _rustAge);',
  '  _pitM *= uWxRustEnv.x;',
  '  _dripM *= uWxRustEnv.x;',
  '  _weathered = mix(_weathered, _rustC, _pitM * 0.55);',
  '  _weathered = mix(_weathered, _rustC * 0.8, _dripM * (0.38 + 0.10 * _r1s));',
  '  /* 细长刮痕(树枝碎石与人员踩踏): 保留但减量, 且一半权重收贴边上 */',
  '  vec2 _scUv = vec2(vCamoPos.z * 2.0, vCamoPos.y * 65.0);',
  '  float _scHash = hash21(floor(_scUv));',
  '  float _scLine = smoothstep(0.86, 0.97, _scHash) * smoothstep(0.40, 0.0, abs(fract(_scUv.y) - 0.5)) * smoothstep(0.8, 1.5, abs(vCamoPos.x));',
  '  _scLine *= 0.35 + 0.65 * max(_edgeCore, _edgeHalo);',
  '  _weathered = mix(_weathered, _STEEL_COL, clamp(_scLine, 0.0, 1.0) * 0.35);',
  '  /* 雨痕与油污流挂: 减淡(旧 0.45 会把整面拖成竖条纹), 只压暗不发黑 */',
  '  vec2 _streakPos = vec2(vCamoPos.x * 20.0, vCamoPos.z * 20.0);',
  '  float _streakHash = hash21(floor(_streakPos));',
  '  float _streakActive = smoothstep(0.82, 0.96, _streakHash);',
  '  float _streakGrad = clamp(1.6 - vCamoPos.y, 0.0, 1.0) * (0.65 + 0.35 * sin(vCamoPos.y * 28.0 + _streakHash * 12.0));',
  '  _weathered = mix(_weathered, vec3(0.07, 0.055, 0.04), _streakActive * _streakGrad * 0.30);',
  '  /* 底盘与凹槽低位油泥渍洗: 减淡(旧 0.30 整圈发黑), 保留下缘气息 */',
  '  float _bottomGrime = smoothstep(0.60, 0.0, vCamoPos.y) * 0.22;',
  '  _weathered *= (1.0 - _bottomGrime);',
  '  _camoCol = _weathered;',
  '  diffuseColor.rgb = _camoCol;',
  '}'
].join('\n');
/* 注入一个载具材质(链式: prev 先跑,风化/履带逻辑不受影响;重复调用幂等) */
function camoPatchMaterial(mat) {
  if (!mat || (mat.userData && mat.userData.camoPatched)) return mat;
  var prev = mat.onBeforeCompile;
  var prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (shader) {
    if (prev) prev(shader);
    var U = _camoUniforms();
    shader.uniforms.uCamoMode = U.uCamoMode;
    shader.uniforms.uWxRustEnv = _wxUniforms().uWxRustEnv;   // ★优化F: 锈环境量(与积尘色同一联动范式)
    shader.uniforms.uPanelAmt = _WX_PANEL_U;                 // ★VC板边: 板缘脱漆强度(与 WX_PANEL_AMT 同源)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + CAMO_VS_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + CAMO_VS_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + CAMO_FS_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + CAMO_FS_BODY);
  };
  mat.customProgramCacheKey = function () {
    var k = '';
    if (prevKey) { try { k = prevKey.call(this) || ''; } catch (e) { k = ''; } }
    return k + '|camo16_wx_panel_perf'; // v16 ★vcpanel-9 几何预算+边带内廉价噪声, 强制重编译
    /* 载具 albedo 红线(P2 文档化, 与风化 weatherBake / 漫画 edgeL 下界同一纪律):
       相邻色块 Rec.601 ΔL = |0.299ΔR+0.587ΔG+0.114ΔB| 必须 ≤ 0.10
       (风化 nearK 等效阈 0.073, 漫画 smoothstep 下界 0.11)。
       用色相区分迷彩, 不用明度。新纹理/程序色写入 veh*Mat 前过此检查。 */
  };
  mat.userData.camoPatched = true;
  mat.needsUpdate = true;
  return mat;
}
/* 玩家车: 逐 draw call 由 onBeforeRender 写 uniform(玩家车部件是个体 Mesh, 一部件一次调用)。
   ★优化H(管线修复): three r128 渲染器只调用【对象级】object.onBeforeRender —— 材质级 mat.onBeforeRender
   从不被调用, 玩家的 uVehDmg/uVehWear/uVehHit 逐 draw 写入此前是死代码(玩家车从不出焦痕/战损压暗/个体脏污)。
   战损延迟锈(H)依赖该链路: 真正的钩子是 _wxPlayerDrawHook, 挂在玩家各部件网格对象上(见 spawn 的 _wxParts 登记);
   本函数保留材质级赋值作双保险(若未来 three 版本恢复材质级调用, 两条路径写同一组值, 幂等)。 */
var _wxPlayerDrawHook = function () {
  var t = this.userData ? this.userData.wxTank : null, U = _wxUniforms();
  if (!t) { U.uVehDmg.value = 0; U.uVehWear.value = 1; U.uVehHit.value.set(0, 0, 0, 0); return; }
  U.uVehDmg.value = t._wxDmg || 0;
  U.uVehWear.value = t._wxWear || 1;
  var h = t._wxHit && this.userData.wxPart ? t._wxHit[this.userData.wxPart] : null;
  if (h) U.uVehHit.value.set(h[0], h[1], h[2], h[3]); else U.uVehHit.value.set(0, 0, 0, 0);
};
function weatherPlayerOnRender(mat) {
  if (!mat) return mat;
  var U = _wxUniforms();
  mat.onBeforeRender = function (renderer, scene, camera, geometry, object) {
    var t = object && object.userData ? object.userData.wxTank : null;
    if (!t) { U.uVehDmg.value = 0; U.uVehWear.value = 1; U.uVehHit.value.set(0, 0, 0, 0); return; }
    U.uVehDmg.value = t._wxDmg || 0;
    U.uVehWear.value = t._wxWear || 1;
    var h = t._wxHit && object.userData.wxPart ? t._wxHit[object.userData.wxPart] : null;
    if (h) U.uVehHit.value.set(h[0], h[1], h[2], h[3]); else U.uVehHit.value.set(0, 0, 0, 0);
  };
  return mat;
}
/* ★优化F: 地图锈环境 —— 湿草甸锈足而偏新(持续氧化), 干土/荒漠锈少而偏老(缺水氧化慢; 实车: 无盐干旱环境基本不长锈)。
   挂共享 uniform(运行时可切, 与积尘色同范式); 量/龄不进烘焙 —— 实例模板按 team|kind 全局缓存, 换图后烘焙期参数会失真
   (烘焙图案侧已由 MAP.seedF 随图变化, 两层互补)。 */
var WX_RUST_ENV = { grass: [1.00, 0.08], soil: [0.62, -0.22] };
/* 灰尘色随地图材质联动: 车身上的灰 = 它碾过的那片土(GROUND_STYLES[style].d 干土色) */
function weatherSetDustCol(style) {
  var U = _wxUniforms();
  if (typeof GROUND_STYLES === 'undefined' || !U) return;
  var d = (GROUND_STYLES[style] || GROUND_STYLES.grass).d;
  U.uDustCol.value.set(d[0] * 1.06, d[1] * 1.04, d[2] * 1.00);   // 略提亮: 干土扬到车身上被天光照亮
  var _e = WX_RUST_ENV[style] || WX_RUST_ENV.grass;             // ★优化F: 锈量/锈龄随地图联动
  U.uWxRustEnv.value.set(_e[0], _e[1]);
}
/* ===== 动态战损: 事件驱动写入, 零每帧成本 =====
   不写纹理、不改几何、不重建顶点缓冲 —— 只在受击瞬间记一条「件本地坐标 + 强度」,
   片元里按解析距离求值(与本项目焦土像素层同一范式: 世界/件空间解析 splat, O(1))。 */
/* 实例属性上传: 仅在「战损数据版本」变化时跑一次, 平时零上传、零 CPU。
   第一次(或从桶里重排后版本变化)会把全车的 aInstA.zw(风化/战损)与 aVehHit 写齐。 */
var _wxUpList = null, _wxEpochUp = -1, _wxM4 = null, _wxV3 = null;
var _wxVisSigH = 0, _wxVisSigN = -1;   // R1:可见成员签名(hash/计数;verdict直接bump _wxEpoch)
function vehWeatherWriteInst(im, n, t, part) {
  if (typeof t._wxWear !== 'number' && typeof vehWeatherInitTank === 'function') vehWeatherInitTank(t);
  var a = im.geometry.attributes, aH = a.aVehHit, aI = a.aInstA;
  if (!aH || !aI) return;
  var h = t._wxHit ? t._wxHit[part] : null, o = n * 4;
  if (h) { aH.array[o] = h[0]; aH.array[o + 1] = h[1]; aH.array[o + 2] = h[2]; aH.array[o + 3] = h[3]; }
  else { aH.array[o] = 0; aH.array[o + 1] = 0; aH.array[o + 2] = 0; aH.array[o + 3] = 0; }
  aI.array[o + 2] = t._wxDmg || 0;      // 打包 .z=战损
  var _slW = (t._susp && t._susp.slot != null && t._susp.slot >= 0) ? (t._susp.slot + 1) : 0;
  aI.array[o + 3] = (t._wxWear || 1) + _slW * 4.0;     // .w=风化 + (slot+1)*4(hull 路径槽; 非 hull 的 slot 恒 0 → 即原 wear)
  if (!_wxUpList) _wxUpList = [];
  if (_wxUpList.indexOf(im) < 0) _wxUpList.push(im);
}
function vehWeatherInstCommit() {
  if (_wxEpochUp === _wxEpoch) return;
  if (_wxUpList) {
    for (var i = 0; i < _wxUpList.length; i++) {
      var a = _wxUpList[i].geometry.attributes;
      if (a.aVehHit) a.aVehHit.needsUpdate = true;
      if (a.aInstA) a.aInstA.needsUpdate = true;
    }
    _wxUpList.length = 0;
  }
  _wxEpochUp = _wxEpoch;
}
/* M1 战损模板清零:对局拆场时归零 INST_TPL 共享模板上的 aVehHit/aInstA.z(战损) + 玩家 uVehHit/uVehDmg
   (模板跨局/车库复用,不清=上局弹痕污染车库预览与下局同模板车;_wxEpoch 单调时钟不动,下次命中重写)。 */
function wxBattleClear() {
  try {
    if (typeof INST_TPL !== 'undefined' && INST_TPL) {
      for (var key in INST_TPL) {
        var tpl = INST_TPL[key]; if (!tpl) continue;
        for (var part in tpl) {
          var g = tpl[part];
          if (!g || !g.attributes) continue;
          var aH = g.attributes.aVehHit, aI = g.attributes.aInstA, i;
          if (aH && aH.array) { for (i = 0; i < aH.array.length; i++) aH.array[i] = 0; aH.needsUpdate = true; }
          if (aI && aI.array) { for (i = 2; i < aI.array.length; i += 4) aI.array[i] = 0; aI.needsUpdate = true; }
        }
      }
    }
  } catch (e1) {}
  try {
    if (typeof _wxUniforms === 'function') {
      var U = _wxUniforms();
      if (U.uVehHit) U.uVehHit.value.set(0, 0, 0, 0);
      if (U.uVehDmg) U.uVehDmg.value = 0;
    }
  } catch (e2) {}
}
var WX_PART_OF = { hull: 'hull', turret: 'turret', gun: 'gun', engine: 'hull', fuel: 'hull', ammo: 'turret',
                   trackL: 'hull', trackR: 'hull', tailRotor: 'tailRotor' };
var _wxEpoch = 0;                       // 战损数据版本号(实例属性只在版本变化时上传1次;R1:可见集变化亦bump,语义=需重传)
var _wxZero4 = null;
function vehWeatherHit(t, key, dmg, point) {
  if (!t || !(dmg > 0)) return;
  var sev = dmg / 150; sev = sev < 0.10 ? 0.10 : (sev > 1 ? 1 : sev);   // D2:除数150=弹种分层(40机炮0.27/90坦克炮0.6/150歼击1.0),首击不再恒封顶
  t._wxDmg = Math.min(1, (t._wxDmg || 0) + sev * 0.13);      // 累积污损(整体压暗+挂灰)
  _wxEpoch++;
  var part = WX_PART_OF[key] || 'hull';
  var mesh = t._wxParts ? t._wxParts[part] : null;
  if (!point || !mesh) return;
  if ((t._wxHitSev || 0) >= sev && t._wxHit && t._wxHit[part]) return;
  if (!t._wxHit) t._wxHit = {};
  if (!t._wxHitSev) t._wxHitSev = {};
  var _wxOld = (t._wxHitSev && t._wxHitSev[part]) || 0;   // D2:旧痕60s线性衰减让位(零新属性:强度/时刻从已打包w解码)
  if (_wxOld > 0 && t._wxHit && t._wxHit[part]) {
    var _wxW = t._wxHit[part][3] || 0;
    var _wxAge = _wxNowSec() - Math.round((_wxW - Math.floor(_wxW)) * 4096) / 2;
    if (_wxAge < 0) _wxAge = 0;
    var _wxEff = _wxOld * (1 - _wxAge / 60); if (_wxEff < 0) _wxEff = 0;
    if (_wxEff >= sev) return;
  } else if (_wxOld >= sev) return;
  t._wxHitSev[part] = sev;
  mesh.updateWorldMatrix(true, false);
  var p = point.clone ? point.clone() : new THREE.Vector3(point.x, point.y, point.z);
  mesh.worldToLocal(p);                                       // → 件本地坐标: 炮塔旋转/身管俯仰自动带着弹痕走
  t._wxHit[part] = [p.x, p.y, p.z, _wxPackHitW(0.30 + sev * 0.55, _wxNowSec())];   // w = ★优化H 打包: 整数位焦痕半径(1/64m) + 小数位命中时刻(0.5s), FS 解码做延迟锈
}
function vehWeatherInitTank(t) {                              // 出生时给一个稳定的个体风化强度
  if (t._wxWear != null) return;
  t._wxWear = 0.80 + (((t.id | 0) * 2654435761) >>> 0) / 4294967296 * 0.55;   // 0.80~1.35
  t._wxDmg = 0; t._wxHit = {}; t._wxHitSev = {};
}

/* ===== vcpanel-8 黑色建模描边源冻结 =====
   The 22° edge rule is stable; input topology is frozen before distance-field subdivision so T-junctions cannot create seams.
   原三角各自独立细分；相邻三角若细分级别不同，共享长边会变成 A-B 对 A-M/M-B 的 T 接缝。
   EdgesGeometry 将无法配对的短段视为开口边，于是共面/弧面三角边被画成黑线。
   Freeze the original position/index/aVTag topology before any panel-edge subdivision and
   一份 22° EdgesGeometry。最终材质几何仍可细分，但车库和对局黑线只读这份旧拓扑边集。 */
function _vehInkPrePanelEdges(parts, group) {
  if (['hull','turret','gun','mantlet','mainRotor','tailRotor'].indexOf(group) < 0) return null;
  var nv = 0, ni = 0, hasTag = false, i, p;
  for (i = 0; i < parts.length; i++) {
    p = parts[i]; if (!p || !p.g || !p.g.attributes.position || !p.g.index) continue;
    nv += p.g.attributes.position.count; ni += p.g.index.count;
    if (group === 'hull' && p.g.attributes.aVTag) hasTag = true;
  }
  if (nv < 3 || ni < 3) return null;
  var pos = new Float32Array(nv * 3), tag = hasTag ? new Float32Array(nv * 4) : null;
  var idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  var vo = 0, io = 0;
  for (i = 0; i < parts.length; i++) {
    p = parts[i]; if (!p || !p.g || !p.g.attributes.position || !p.g.index) continue;
    var n = p.g.attributes.position.count, ia = p.g.index.array;
    pos.set(p.g.attributes.position.array, vo * 3);
    if (tag && p.g.attributes.aVTag) tag.set(p.g.attributes.aVTag.array, vo * 4);
    for (var k = 0; k < ia.length; k++) idx[io + k] = ia[k] + vo;
    vo += n; io += ia.length;
  }
  /* 与旧 vehInkArmorOnlyGeo 一致：hull 黑线排除 shader 动态履带/轮/摆臂，避免 bind-pose 线笼。 */
  if (tag) {
    var kept = [], maxI = 0;
    for (i = 0; i < idx.length; i += 3) {
      var a = idx[i], b = idx[i+1], c = idx[i+2];
      if (Math.abs(tag[a*4]) < 0.5 && Math.abs(tag[b*4]) < 0.5 && Math.abs(tag[c*4]) < 0.5) {
        kept.push(a,b,c); if (a>maxI) maxI=a; if (b>maxI) maxI=b; if (c>maxI) maxI=c;
      }
    }
    if (kept.length < 3) return null;
    idx = maxI > 65535 ? new Uint32Array(kept) : new Uint16Array(kept);
  }
  var base = new THREE.BufferGeometry();
  base.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  base.setIndex(new THREE.BufferAttribute(idx, 1));
  var edges = new THREE.EdgesGeometry(base, 22);
  edges.userData = edges.userData || {}; edges.userData._shared = true; edges.userData._prePanel = true;
  base.dispose();
  return edges;
}

function mergeVisParts(parts, group, skipInk) {   // group=部件组名；skipInk 仅供不显示漫画线的残骸 LOD
  var total = 0, totalIdx = 0, i;
  var _prePanelInk = skipInk ? null : _vehInkPrePanelEdges(parts, group); // 必须早于 _wxPanelPass 的拓扑细分
  if (WEATHER_BAKE_AMT > 0 && typeof _wxAdjacencyPass === 'function')
    _wxAdjacencyPass(parts, group);   // 真实化预分析: 底边接平面/悬空附件缝/命中标记(每模板一次; A=0 时跳过=逐位回滚)
  if (WEATHER_BAKE_AMT > 0 && WX_PANEL_AMT > 0 && typeof _wxPanelPass === 'function')
    _wxPanelPass(parts, group);       // ★VC板边: 装甲面检测(质心分裂可增顶点 → 合并计数必须移到其后)
  for (i = 0; i < parts.length; i++) { total += parts[i].g.attributes.position.count; totalIdx += parts[i].g.index.count; }
  var pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), col = new Float32Array(total * 3),
      uvm = new Float32Array(total * 2);                                    // UV 一并合并(全部件在 visPartPush 已兜底)
  var hasTag = false;                                                       // 顶点标签 aVTag(履带滚动 + 扭杆悬挂,打包为单 vec4)
  for (i = 0; i < parts.length; i++) { if (parts[i].g.attributes.aVTag) { hasTag = true; break; } }
  var tagArr = hasTag ? new Float32Array(total * 4) : null;                 // 默认全 0 = 静态件
  var camoArr = new Float32Array(total);                                // 迷彩身份,默认全 0 = 非装甲;装甲段按件自带 camo 覆写(属性槽+1,hull 合计 16/16,见 aVTag 注释账)
  var idxA = total > 65535 ? new Uint32Array(totalIdx) : new Uint16Array(totalIdx);
  var vo = 0, io2 = 0, _wxPartIdx = 0;
  for (i = 0; i < parts.length; i++) {
    var p = parts[i], n = p.g.attributes.position.count;
    pos.set(p.g.attributes.position.array, vo * 3);
    nrm.set(p.g.attributes.normal.array, vo * 3);
    uvm.set(p.g.attributes.uv.array, vo * 2);
    /* 载具风化①: 逐件烘焙(色彩调制/渍洗/掉漆/锈) —— 建模期一次性, 逐帧零成本;
       WEATHER_BAKE_AMT=0 时逐顶点等价于原平涂。逐件哈希保证同型号每次构建逐位一致。
       isArmor 决定锈纪律:装甲件恒不锈(漆面),与颜色无关,新增漆色自动继承。 */
    if (typeof weatherBakePart === 'function')
      weatherBakePart(p.c, pos, nrm, col, vo, n, _wxPartIdx, (typeof MAP !== 'undefined' && MAP.seedF) ? (MAP.seedF | 0) : 1, p.camo ? 1 : 0, camoArr, p.camo || 0, p.g.userData);
    else {
      for (var v = 0; v < n; v++) { col[(vo + v) * 3] = p.c[0]; col[(vo + v) * 3 + 1] = p.c[1]; col[(vo + v) * 3 + 2] = p.c[2]; }
      if (camoArr) camoArr.fill(p.camo || 0, vo, vo + n);
    }
    _wxPartIdx++;
    if (tagArr && p.g.attributes.aVTag) tagArr.set(p.g.attributes.aVTag.array, vo * 4);   // 标签段覆写,其余段保持 0(静态装甲)                          // 装甲段按件常量写 1 红/2 蓝(逐顶点相同,未来载具按件身份自动分区)
    var ia = p.g.index.array;
    for (var k2 = 0; k2 < ia.length; k2++) idxA[io2 + k2] = ia[k2] + vo;
    vo += n; io2 += ia.length;
    if (p.g.dispose) p.g.dispose();
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvm, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aCamo', new THREE.BufferAttribute(camoArr, 1));   // 迷彩身份(建模期按件烧录,片元直接消费,不再猜颜色)
  if (tagArr) geo.setAttribute('aVTag', new THREE.BufferAttribute(tagArr, 4));   // 履带滚动 + 扭杆悬挂 打包标签
  geo.setIndex(new THREE.BufferAttribute(idxA, 1));
  geo.userData = geo.userData || {};
  if (_prePanelInk) geo.userData._vehInkPrePanel = _prePanelInk; // 黑线只读细分前旧拓扑；灰白材质仍读当前细分几何
  geo.computeBoundingSphere();                         // vehicle.js 新版:合并后显式计算包围球,避免炮塔剔除异常
  return geo;
}

// 远距 Z-fighting 配套修——贴面深度仲裁确定化(与 near 抬升组合拳):
//   甲体整体深度微推后(+1):履带触地/嵌甲板件对地面与贴面附件不再悬案;
//   发光件整体深度微提前(−1):潜望镜/镜片/灯罩(齐平嵌甲的 MeshBasic 件)恒赢贴面甲——
//   远距闪烁最显眼的来源正是这些散布全车的齐平小件逐帧换赢家。偏移量=深度最小步进级,近距无视觉位移。
var vehBodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.22,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
var vehGlowMat = new THREE.MeshBasicMaterial({ vertexColors: true,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });     // 观察窗/潜望镜/灯罩:unlit,昼夜都读得出
/* ===== 履带纹路偏移 shader 材质(hull 专用,不污染炮塔/炮管/炮盾共享的 vehBodyMat)——
   每顶点按 aVTag.x(10=履带环带)× position.x 符号(左右)选左右偏移量平移 vUv.x,使左右履带差速滚动;
   装甲/裙甲纹路不动。零 draw call 增量(hull InstancedMesh/玩家 mesh 已存在,仅换材质)。
   · vehHullMat       — InstancedMesh 用,左右偏移/滚动量来自实例属性 aInstA.xy(AI 近距车)
   · vehHullMatPlayer — 玩家车个体 Mesh 用,左右偏移来自 uniform uTrackOffL/uTrackOffR ===== */
function _makeHullMat(isPlayer) {
  var m = vehBodyMat.clone();
  if (isPlayer) { m.defines = m.defines || {}; m.defines.TRACK_PLAYER = 1; }
  m.onBeforeCompile = function(shader) {
    if (isPlayer) {
      shader.uniforms.uTrackOffL = { value: 0 }; shader.uniforms.uTrackOffR = { value: 0 };
      shader.uniforms.uT59RollL = { value: 0 }; shader.uniforms.uT59RollR = { value: 0 };
      shader.uniforms.uSuspA0 = { value: new THREE.Vector4() };
      shader.uniforms.uSuspA1 = { value: new THREE.Vector4() };
      shader.uniforms.uSuspA2 = { value: new THREE.Vector4() };
      shader.uniforms.uSuspA3 = { value: new THREE.Vector4() };
      m.userData.hullUniforms = shader.uniforms;
    }
    /* 履带环路查找图集(五车型共用一张;非履带车 hull 不带 aVTag=20 的件,分支进不去)。
       ★兜底:本材质被全部载具 hull 共用,建表若抛异常会连累整场车辆不渲染 —— 失败则填
       1×1 空表 + Len=1,滚动分支退化为「板静止」,悬挂/纹路/风化不受影响。 */
    var _pt = null, _plen = [1, 1, 1, 1, 1, 1], _pseg = new Float32Array(48);
    try {
      _pt = suspAtlasTexture();
      _plen = SUSP_ATLAS_LEN.slice();
      _pseg = SUSP_ATLAS_SEG.slice(0);
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[SUSP] track loop atlas build failed, falling back to static:', e);
      _pt = new THREE.DataTexture(new Float32Array([0, 0, 1, 0]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
      _pt.needsUpdate = true;
    }
    shader.uniforms.uTrkDyn    = { value: trackDynTexture() };            // 动态路径纹理(阶段 2)
    shader.uniforms.uTrkDynLen  = { value: TRK_DYN_LEN };
    shader.uniforms.uTrkDynTexel = { value: new THREE.Vector2(1 / TRK_PATH_N, 1 / (TRK_DYN_SLOTS * 2)) };
    if (isPlayer) shader.uniforms.uTrkSlot = { value: -1 };                // 玩家车槽位(−1=未解算,回落静态)
    shader.uniforms.uSuspPath = { value: _pt };
    shader.uniforms.uSuspLen  = { value: _plen };
    shader.uniforms.uSuspSeg  = { value: _pseg };
    shader.uniforms.uSuspTexel = { value: new THREE.Vector2(1 / T59_PATH_N, 1 / SUSP_ATLAS_ROWS) };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\n' +
        '#ifndef VTAG_DECL\n#define VTAG_DECL\nattribute vec4 aVTag;\n#endif\n' +
        'uniform sampler2D uTrkDyn;\n' +           /* ★动态定长路径 (z, y, cosθ, sinθ),每车每侧一行 */
        'uniform float uTrkDynLen[96];\n' +        /* 各行周长(TRK_DYN_SLOTS*2) */
        'uniform vec2 uTrkDynTexel;\n' +
        '#ifdef TRACK_PLAYER\n  uniform float uTrkSlot;\n#endif\n' +   /* AI 槽位打进 aInstA.w(省 1 个 attribute, hull 实例程序压回 16) */
        'uniform sampler2D uSuspPath;\n' +          /* 静态环路图集(回落用) */
        'uniform float uSuspLen[6];\n' +            /* 逐车型环路总长(m) */
        'uniform float uSuspSeg[48];\n' +           /* 逐车型八段边界弧长(6×8) */
        'uniform vec2 uSuspTexel;\n' +
        '#ifdef TRACK_PLAYER\n' +
        '  uniform float uTrackOffL;\n  uniform float uTrackOffR;\n' +
        '  uniform float uT59RollL;\n  uniform float uT59RollR;\n' +   /* 玩家:左右履带滚动量(m) */
        '  uniform vec4 uSuspA0;\n  uniform vec4 uSuspA1;\n  uniform vec4 uSuspA2;\n  uniform vec4 uSuspA3;\n' +
        '#else\n' +
        '#ifndef INSTA_DECL\n#define INSTA_DECL\n  attribute vec4 aInstA;\n#endif\n' +
        '  attribute vec4 aSusp0;\n  attribute vec4 aSusp1;\n  attribute vec4 aSusp2;\n  attribute vec4 aSusp3;\n' +
        '#endif\n' +
        /* —— 扭杆取值:站位 st(0..6) × 侧 sd(0 左/1 右) → 轮 Δφ。
             14 个槽位(左 7 + 右 7)铺在 4 个 vec4 中:idx = st + sd*7 —— */
        'float suspPhi(float st, float sd) {\n' +
        '  float ix = st + sd * 7.0;\n' +
        '#ifdef TRACK_PLAYER\n' +
        '  vec4 q0 = uSuspA0; vec4 q1 = uSuspA1; vec4 q2 = uSuspA2; vec4 q3 = uSuspA3;\n' +
        '#else\n' +
        '  vec4 q0 = aSusp0; vec4 q1 = aSusp1; vec4 q2 = aSusp2; vec4 q3 = aSusp3;\n' +
        '#endif\n' +
        '  if (ix < 0.5) return q0.x;\n  if (ix < 1.5) return q0.y;\n' +
        '  if (ix < 2.5) return q0.z;\n  if (ix < 3.5) return q0.w;\n' +
        '  if (ix < 4.5) return q1.x;\n  if (ix < 5.5) return q1.y;\n' +
        '  if (ix < 6.5) return q1.z;\n  if (ix < 7.5) return q1.w;\n' +
        '  if (ix < 8.5) return q2.x;\n  if (ix < 9.5) return q2.y;\n' +
        '  if (ix < 10.5) return q2.z;\n  if (ix < 11.5) return q2.w;\n' +
        '  if (ix < 12.5) return q3.x;\n  return q3.y;\n' +
        '}\n' +
        'float suspSag(float sd) {\n' +                     /* 顶行垂度收紧量(≥0,0=静止) */
        '#ifdef TRACK_PLAYER\n  return sd < 0.5 ? uSuspA3.z : uSuspA3.w;\n' +
        '#else\n  return sd < 0.5 ? aSusp3.z : aSusp3.w;\n#endif\n' +
        '}\n' +
        /* Per-side tread travel in metres; AI reuses aInstA.xy. */
        'float suspRoll(float sd) {\n' +
        '#ifdef TRACK_PLAYER\n  return sd < 0.5 ? uT59RollL : uT59RollR;\n' +
        '#else\n  return sd < 0.5 ? aInstA.x : aInstA.y;\n#endif\n' +
        '}\n' +
        /* 轮心位移 (dz,dy):静止臂向量绕铰点 Rx(fdir·Δφ) 旋转的位移量。
           fdir 由建模期决定,但 shader 侧只需知道「臂朝前/朝后」——
           它等价于 Δφ 的符号约定,已在 CPU 端统一为「φ↑ = 轮上行」,故此处 fd 恒 +1 口径。 */
        'vec2 suspWheelDisp(float st, float sd) {\n' +
        '  float dp = suspPhi(st, sd);\n' +
        '  float ca = cos(dp), sa = sin(dp);\n' +
        '  float y0 = -0.307, z0 = -0.193;\n' +
        '  return vec2(y0 * sa + z0 * ca - z0, y0 * ca - z0 * sa - y0);\n' +
        '}\n' +
        /* ===== 环路图集采样:手工两点插值(列向插值 / 行向严格不插值)=====
           ★必须用显式 LOD(顶点着色器无隐式导数),且函数名两代 API 不同:
             WebGL1 = texture2DLod / WebGL2 = textureLod。three r128 只在【片元】前缀里补了
             texture2DLodEXT 映射,顶点前缀没有 —— 直接写 texture2DLod 在 WebGL2 下是未声明
             标识符,会导致整个 hull 着色器编译失败(全部车体消失)。用 __VERSION__ 自行分流。 */
        '#if __VERSION__ >= 300\n' +
        '  #define SUSP_TEXLOD(t, uv) textureLod(t, uv, 0.0)\n' +
        '#else\n' +
        '  #define SUSP_TEXLOD(t, uv) texture2DLod(t, uv, 0.0)\n' +
        '#endif\n' +
        /* ★动态路径采样:row = slot*2+side。与静态同为手工两点插值(规避浮点线性过滤扩展)。 */
        'vec4 trkDynAt(float s, float row) {\n' +
        '  float L = uTrkDynLen[int(row + 0.5)];\n' +
        '  if (L < 1e-4) return vec4(0.0, 0.0, 1.0, 0.0);\n' +
        '  float u = fract(s / L) / uTrkDynTexel.x;\n' +
        '  float i0 = floor(u), fr = u - i0;\n' +
        '  float v = (row + 0.5) * uTrkDynTexel.y;\n' +
        '  vec4 a = SUSP_TEXLOD(uTrkDyn, vec2((i0 + 0.5) * uTrkDynTexel.x, v));\n' +
        '  vec4 b = SUSP_TEXLOD(uTrkDyn, vec2((i0 + 1.5) * uTrkDynTexel.x, v));\n' +
        '  vec4 p = mix(a, b, fr);\n' +
        '  float n = inversesqrt(max(p.z * p.z + p.w * p.w, 1e-8));\n' +
        '  p.zw *= n;\n' +
        '  return p;\n' +
        '}\n' +
        'float trkSlotOf() {\n' +
        '#ifdef TRACK_PLAYER\n  return uTrkSlot;\n#else\n  return floor(aInstA.w * 0.25 + 0.0001) - 1.0;\n#endif\n' +  /* 打包: aInstA.w = wear + (slot+1)*4 */
        '}\n' +
        'vec4 suspPathAt(float s, float row) {\n' +
        '  float L = uSuspLen[int(row + 0.5)];\n' +
        '  float u = fract(s / L) / uSuspTexel.x;\n' +          /* → 采样点坐标(单位:像素) */
        '  float i0 = floor(u), fr = u - i0;\n' +
        '  float v = (row + 0.5) * uSuspTexel.y;\n' +
        '  vec4 a = SUSP_TEXLOD(uSuspPath, vec2((i0 + 0.5) * uSuspTexel.x, v));\n' +
        '  vec4 b = SUSP_TEXLOD(uSuspPath, vec2((i0 + 1.5) * uSuspTexel.x, v));\n' +
        '  vec4 p = mix(a, b, fr);\n' +
        '  float n = inversesqrt(max(p.z * p.z + p.w * p.w, 1e-8));\n' +   /* 插值后三角值需归一化 */
        '  p.zw *= n;\n' +
        '  return p;\n' +
        '}\n' +
        /* 按「当前弧长」实时重算悬挂位移场 —— 板滚过不同分段,权重必须随之改变。
           分段边界与建模期同源(uSuspSeg 逐车型 8 个)。nW = 该车型末站位索引。 */
        'vec2 suspTrackDisp(float s, float sd, float row, float nW) {\n' +
        '  int b = int(row + 0.5) * 8;\n' +
        '  float L = uSuspLen[int(row + 0.5)];\n' +
        '  s = mod(mod(s, L) + L, L);\n' +
        '  vec2 d = vec2(0.0);\n' +
        '  float s0 = uSuspSeg[b], s1 = uSuspSeg[b+1], s2 = uSuspSeg[b+2], s3 = uSuspSeg[b+3];\n' +
        '  float s4 = uSuspSeg[b+4], s5 = uSuspSeg[b+5], s6 = uSuspSeg[b+6];\n' +
        '  if (s < s0) {\n' +                        /* 底行:按板心 z 在相邻两站位间插值 */
        '    float zc = suspPathAt(s, row).x;\n' +
        '    float fz = clamp((uSuspSeg[b] - s) / max(s0, 1e-5), 0.0, 1.0);\n' +
        '    float w = clamp(fz * nW, 0.0, nW);\n' +          /* 底行弧长 → 站位连续坐标(首轮 0 → 末轮 nW) */
        '    float i0 = floor(w); float fr = w - i0;\n' +
        '    d = mix(suspWheelDisp(i0, sd), suspWheelDisp(min(i0 + 1.0, nW), sd), fr);\n' +
        '  } else if (s < s1) { d = suspWheelDisp(nW, sd); }\n' +                                   /* 末轮包底弧 */
        '  else if (s < s2) { d = suspWheelDisp(nW, sd) * (1.0 - (s - s1) / max(s2 - s1, 1e-5)); }\n' +   /* 后跨段 */
        '  else if (s < s3) { d = vec2(0.0); }\n' +                                                 /* 后端轮包弧(车体侧) */
        '  else if (s < s4) {\n' +                                                                  /* 顶行:垂度收紧 */
        '    float tt = (s - s3) / max(s4 - s3, 1e-5);\n' +
        '    float sn = sin(3.14159265 * tt);\n' +
        '    d = vec2(0.0, suspSag(sd) * sn * sn);\n' +
        '  }\n' +
        '  else if (s < s5) { d = vec2(0.0); }\n' +                                                 /* 前端轮包弧(车体侧) */
        '  else if (s < s6) { d = suspWheelDisp(0.0, sd) * ((s - s5) / max(s6 - s5, 1e-5)); }\n' +   /* 前跨段 */
        '  else { d = suspWheelDisp(0.0, sd); }\n' +                                                /* 首轮包底弧 */
        '  return d;\n' +
        '}\n')
      /* Tread texture scroll: aVTag.x == 10; side follows position.x. */
      .replace('#include <uv_vertex>',
        '#include <uv_vertex>\n' +
        '#ifdef USE_UV\n' +
        'if (aVTag.x > 9.5 && aVTag.x < 10.5) {\n' +   /* x==10 环带专用;11..18 转子另有分支,禁串味 */
        '#ifdef TRACK_PLAYER\n  float _to = position.x < 0.0 ? uTrackOffL : uTrackOffR;\n' +
        '#else\n  float _to = position.x < 0.0 ? aInstA.x : aInstA.y;\n#endif\n' +
        '  vUv.x -= _to;\n' +
        '}\n' +
        '#endif')
      /* —— 负重轮/摆臂:法线随臂旋转;滚动履带件:法线随姿态增量旋转 —— */
      .replace('#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\n' +
        'if ((aVTag.x >= 0.5 && aVTag.x <= 7.5) || (aVTag.x >= 10.5 && aVTag.x <= 17.5)) {\n' +
        '  float _nst = (aVTag.x > 7.5) ? (aVTag.x - 11.0) : (aVTag.x - 1.0);\n' +   /* 1..7 摆臂站位=x-1;11..17 转子站位=x-11 */
        '  float _nsd = position.x > 0.0 ? 1.0 : 0.0;\n' +
        '  float _ndp = -((aVTag.y >= 0.0) ? 1.0 : -1.0) * suspPhi(_nst, _nsd);\n' +   /* 摆向符号(转子 y=±R 只取符号,半径另作自转除数) */
        '  if (abs(_ndp) > 1e-5) {\n' +
        '    float _nca = cos(_ndp), _nsa = sin(_ndp);\n' +
        '    objectNormal.yz = mat2(_nca, -_nsa, _nsa, _nca) * objectNormal.yz;\n' +
        '  }\n' +
        '} else if (aVTag.x > 19.5) {\n' +
        /* 滚动履带件:法线随姿态增量 R1·R0ᵀ 旋转。与位置段同源:
           已解算 → 动态定长路径;未解算 → 回落静态图集。 */
        '  float _rsd = position.x > 0.0 ? 1.0 : 0.0;\n' +
        '  float _row = aVTag.z;\n' +
        '  float _nslot = trkSlotOf();\n' +
        '  vec4 _q0 = suspPathAt(aVTag.y, _row);\n' +
        '  vec4 _q1;\n' +
        '  if (_nslot >= -0.5) {\n' +
        '    float _ndr = _nslot * 2.0 + _rsd;\n' +
        '    float _nL0 = uSuspLen[int(_row + 0.5)];\n' +
        '    float _nLd = uTrkDynLen[int(_ndr + 0.5)];\n' +
        '    float _nk = (_nL0 > 1e-4) ? (_nLd / _nL0) : 1.0;\n' +
        '    _q1 = trkDynAt(aVTag.y * _nk + suspRoll(_rsd), _ndr);\n' +
        '  } else {\n' +
        '    _q1 = suspPathAt(aVTag.y + suspRoll(_rsd), _row);\n' +
        '  }\n' +
        '  float _dc = _q1.z * _q0.z + _q1.w * _q0.w;\n' +      /* cos(rx1 − rx0) */
        '  float _ds = _q1.w * _q0.z - _q1.z * _q0.w;\n' +      /* sin(rx1 − rx0) */
        '  vec2 _n = objectNormal.zy;\n' +
        '  objectNormal.z = _dc * _n.x + _ds * _n.y;\n' +
        '  objectNormal.y = -_ds * _n.x + _dc * _n.y;\n' +
        '}\n' +
        /* —— 轮转子自转:法线随转角旋转(位置分支同源,同 θ) —— */
        'if ((aVTag.x >= 10.5 && aVTag.x <= 17.5) || (aVTag.x >= 17.5 && aVTag.x <= 18.5)) {\n' +
        '  float _spd = position.x > 0.0 ? 1.0 : 0.0;\n' +
        '  float _spR = abs(aVTag.y);\n' +
        '  float _spt = (_spR > 1e-4) ? mod(suspRoll(_spd), 6.2831853 * _spR) / _spR : 0.0;\n' +
        '  if (abs(_spt) > 1e-5) {\n' +
        '    float _spc = cos(_spt), _sps = sin(_spt);\n' +
        '    objectNormal.yz = mat2(_spc, _sps, -_sps, _spc) * objectNormal.yz;\n' +
        '  }\n' +
        '}\n')
      /* —— 位置变形:轮组绕铰点刚转 / 履带件沿环路滚动 + 悬挂位移场 —— */
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        'if ((aVTag.x >= 0.5 && aVTag.x <= 7.5) || (aVTag.x >= 10.5 && aVTag.x <= 17.5)) {\n' +      // 摆臂 + 转子:绕车体铰点刚性旋转(转子随后另做自转)
        '  float _wst = (aVTag.x > 7.5) ? (aVTag.x - 11.0) : (aVTag.x - 1.0);\n' +
        '  float _wsd = position.x > 0.0 ? 1.0 : 0.0;\n' +
        '  float _wdp = -((aVTag.y >= 0.0) ? 1.0 : -1.0) * suspPhi(_wst, _wsd);\n' +   /* ★旋转角 = −fdir·Δφ(臂朝后者反向;转子 y=±R 只取符号) */
        '  if (abs(_wdp) > 1e-5) {\n' +
        '    float _wpy = aVTag.w;\n' +                       // 铰点 y(建模期烧入,逐车型)
        '    float _wpz = aVTag.z;\n' +                       // 铰点 z(建模期烧入,逐轮)
        '    float _wca = cos(_wdp), _wsa = sin(_wdp);\n' +
        '    float _wcy = position.y - _wpy, _wcz = position.z - _wpz;\n' +
        '    transformed.y = _wpy + _wcy * _wca + _wcz * _wsa;\n' +
        '    transformed.z = _wpz - _wcy * _wsa + _wcz * _wca;\n' +
        '  }\n' +
        '} else if (aVTag.x > 19.5) {\n' +                   // ★履带件沿环路滚动(板/铰链销/定位齿)
        /* 【阶段 2 核心】旧做法「静止路径 + 逐点位移场」板间无约束,长度不守恒(俯冲 +568mm)。
           现改为在【定长求解路径】上重铺:
             ① 用建模弧长 s0 在建模基准路径采样 → 该件的建模基座,把顶点退回件本地系;
             ② s0 按弧长比例映射到当前定长路径 + 滚动量 → 新基座;
             ③ 按新基座重新摆放。板间距由路径弧长自然分配,长度守恒由求解器保证。
           顶行垂度已由求解器写入路径(富余长度的落点),故「上段拉平补下段」自动成立。 */
        '  float _rsd = position.x > 0.0 ? 1.0 : 0.0;\n' +
        '  float _row = aVTag.z;\n' +
        '  float _s0 = aVTag.y;\n' +
        '  float _slot = trkSlotOf();\n' +
        '  vec4 _p0 = suspPathAt(_s0, _row);\n' +
        '  vec4 _p1;\n' +
        '  if (_slot >= -0.5) {\n' +                        /* 已解算 → 动态定长路径 */
        '    float _dr = _slot * 2.0 + _rsd;\n' +
        '    float _L0 = uSuspLen[int(_row + 0.5)];\n' +
        '    float _Ld = uTrkDynLen[int(_dr + 0.5)];\n' +
        '    float _k = (_L0 > 1e-4) ? (_Ld / _L0) : 1.0;\n' +
        '    _p1 = trkDynAt(_s0 * _k + suspRoll(_rsd), _dr);\n' +
        '  } else {\n' +                                    /* 未解算(远距/残骸)→ 回落静态,零成本 */
        '    _p1 = suspPathAt(_s0 + suspRoll(_rsd), _row);\n' +
        '  }\n' +
        '  vec2 _loc = vec2(position.z - _p0.x, position.y - _p0.y);\n' +
        '  vec2 _rel = vec2( _p0.z * _loc.x - _p0.w * _loc.y,\n' +
        '                    _p0.w * _loc.x + _p0.z * _loc.y );\n' +
        '  vec2 _new = vec2( _p1.z * _rel.x + _p1.w * _rel.y,\n' +
        '                   -_p1.w * _rel.x + _p1.z * _rel.y );\n' +
        '  transformed.z = _p1.x + _new.x;\n' +
        '  transformed.y = _p1.y + _new.y;\n' +
        '} else if (aVTag.x < -1.5) {\n' +                   // top-row track plates
        '  float _tsd = position.x > 0.0 ? 1.0 : 0.0;\n' +
        '  transformed.y += suspSag(_tsd) * sin(3.14159265 * aVTag.y) * sin(3.14159265 * aVTag.y);\n' +
        '}\n' +
        /* —— 轮转子自转:绕轮轴(X 轴)刚性旋转 ——
           θ = 滚动米数 / 轮半径(与履带板同一滚动量,轮缘线速度=履带速度,天然无打滑);
           滚动米数走既有 suspRoll 通道(玩家 uniform / AI 实例属性,差速+断带冻结自动继承)。
           11..17(负重轮):轮心 = 铰点 + 摆动后的臂向量(先摆动 rock、再自转 spin,顺序不可颠倒);
           18(端轮/主动轮/诱导轮):(zw) 直接就是轮心,无摆动。
           停稳时 θ≡0(guard),像素级零漂移、零额外开销。 */
        'if ((aVTag.x >= 10.5 && aVTag.x <= 17.5) || (aVTag.x >= 17.5 && aVTag.x <= 18.5)) {\n' +
        '  float _wsd = position.x > 0.0 ? 1.0 : 0.0;\n' +
        '  float _wR = abs(aVTag.y);\n' +
        '  float _wth = (_wR > 1e-4) ? mod(suspRoll(_wsd), 6.2831853 * _wR) / _wR : 0.0;\n' +   /* θ=滚动米数/轮半径(与法线分支同式;差速+断带冻结由 suspRoll 通道继承) */
        '  if (abs(_wth) > 1e-5) {\n' +
        '    vec2 _wcc;\n' +
        '    if (aVTag.x < 17.5) {\n' +
        '      float _wfd = (aVTag.y >= 0.0) ? 1.0 : -1.0;\n' +
        '      float _wa = -_wfd * suspPhi(aVTag.x - 11.0, _wsd);\n' +
        '      float _wca = cos(_wa), _wsa = sin(_wa);\n' +
        '      vec2 _coff = vec2(-0.307, -_wfd * 0.193);\n' +   /* (dy,dz):铰点→轮心静止臂向量(全车型统一,见 SUSP_ARM_L) */
        '      _wcc = vec2(aVTag.w, aVTag.z) + vec2(_coff.x * _wca + _coff.y * _wsa, -_coff.x * _wsa + _coff.y * _wca);\n' +
        '    } else {\n' +
        '      _wcc = vec2(aVTag.w, aVTag.z);\n' +
        '    }\n' +
        '    float _wcta = cos(_wth), _wsta = sin(_wth);\n' +
        '    vec2 _wrel = vec2(transformed.y - _wcc.x, transformed.z - _wcc.y);\n' +
        '    transformed.y = _wcc.x + _wrel.x * _wcta - _wrel.y * _wsta;\n' +
        '    transformed.z = _wcc.y + _wrel.x * _wsta + _wrel.y * _wcta;\n' +
        '  }\n' +
        '}\n');
  };
  return m;
}
var vehHullMat = _makeHullMat(false);
var vehHullMatPlayer = _makeHullMat(true);
/* 载具风化②③: 世界空间积尘 + 动态战损。
   · vehBodyMat / vehHullMat      —— AI(InstancedMesh)走实例属性 aVehHit + aInstA.zw(战损/风化)
   · vehBodyMatPlayer             —— 玩家车个体 Mesh 走 uniform, 由 onBeforeRender 逐 draw call 写
   _makeHullMat 内部的履带 patch 由 weatherPatchMaterial 的 prev(shader) 先跑, 不会被覆盖(§4.2 冲突点)。 */
weatherPatchMaterial(vehBodyMat, false, 'B');
weatherPatchMaterial(vehHullMat, false, 'H');
weatherPatchMaterial(vehHullMatPlayer, true, 'H');
var vehBodyMatPlayer = weatherPlayerOnRender(weatherPatchMaterial(vehBodyMat.clone(), true, 'B'));
/* 玩家车体同样要挂 onBeforeRender: 否则它读到的是上一次炮塔/炮管写进共享 uniform 的 uVehHit。 */
weatherPlayerOnRender(vehHullMatPlayer);
/* 程序化数码迷彩(仅迷彩):挂在风化之后、全部克隆完成之后,四件逐一链式注入;vehGlowMat(灯/镜片)与机库环境 meshMat* 系不挂,保持原样。 */
camoPatchMaterial(vehBodyMat);
camoPatchMaterial(vehHullMat);
camoPatchMaterial(vehHullMatPlayer);
camoPatchMaterial(vehBodyMatPlayer);
/* 载具滤镜掩码:对局 alpha=0.62→comic isVeh 豁免分档/笔痕;车库 vehMaskSetMode(false) 写 1。
   亮度描边仍 lumaW=0,不靠 alpha,烟雾里迷彩也不会再出线。 */
var _VEH_MASK_U = { uVehMaskA: { value: 0.62 } };
function vehMaskSetMode(inBattle) { _VEH_MASK_U.uVehMaskA.value = inBattle ? 0.62 : 1.0; }
function vehMaskPatchMaterial(mat) {
  if (!mat || (mat.userData && mat.userData.vehMaskPatched)) return mat;
  var prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (shader) {
    if (prev) prev(shader);
    shader.uniforms.uVehMaskA = _VEH_MASK_U.uVehMaskA;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uVehMaskA;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a = uVehMaskA;');
  };
  mat.customProgramCacheKey = function () {
    var k = ''; if (prevKey) { try { k = prevKey.call(this) || ''; } catch (e) { k = ''; } }
    return k + '|vm3';   // v3:转子自转位置分支接真滚动量(θ=roll/R,替代 E4 实验字面量)+卡车轮 18 号转子,强制重编译
  };
  mat.userData.vehMaskPatched = true;
  mat.needsUpdate = true;
  return mat;
}
vehMaskPatchMaterial(vehBodyMat);
vehMaskPatchMaterial(vehHullMat);
vehMaskPatchMaterial(vehHullMatPlayer);
vehMaskPatchMaterial(vehBodyMatPlayer);
// 主车体视觉与装甲命中壳共用唯一截面常量,禁止同一外形维护两份坐标。
var T59_HULL_PTS=[[2.32,0.30],[2.50,0.68],[1.48,1.13],[-2.45,1.13],[-2.45,0.58],[-2.20,0.30]];
/* M60 车体七折截面(后半段 z<0 均匀拉长 4/3,名义尾 -2.34→-3.12;
   后部三段制(参考三视图):平顶面延伸到尾上缘 → 竖直尾面 → 底部向内折斜面;
   前部:前顶平面前边线 z1.67=驾驶员舱盖底座环(z1.42,r0.25)前切线,舱盖与车体边线相切;
   首上 (2.20,0.80)→(1.67,1.30) 与首下 (1.67,0.30)→(2.20,0.80) 同倾角(|dz|/dy=1.06,鼻楔对称);
   视觉/命中共用本常量,改动自动同步命中壳。 */
var M60_HULL_PTS=[[2.20,0.80],[1.67,1.30],[1.20,1.32],[-3.12,1.32],[-3.12,0.66],[-2.86,0.30],[1.67,0.30]];
/* ===== 火箭炮车型常量/几何助手(红 RED_MLRS / 蓝 BLUE_MLRS;自两份建模 demo 共形移植) =====
   RED_MLRS(phl11_model_demo v0.10): 万山 WS2400 底盘三轴布置,平头装甲驾驶室前伸 + 驾驶室后 40 管发射架;
   BLUE_MLRS(BLUE_MLRS_modeling_demo v0.16): FMTV M1140 6×6 底盘,装甲驾驶室放样体 + 后甲板转盘 + 单发射舱(6×227mm)。
   视觉/命中共用本常量,改动自动同步命中壳。 */
var PHL11_AXZ = [2.60, -0.30, -1.40];                  // RED_MLRS 三轴 z(v0.10: 后双轴前移,轴距 1.10)
var PHL11_CAB_PTS = [[3.55,1.02],[3.55,1.75],[3.42,2.62],[2.05,2.62],[2.05,1.02]];   // 驾驶室截面 (z,y),平头前伸
var BLUE_MLRS_AXZ = [2.35, -1.55, -2.80];                   // BLUE_MLRS 三轴 z
var BLUE_MLRS_CAB_SECS = [[0.95,0.95,2.77,1.45],[1.35,1.012,2.970,1.45],[1.48,1.032,3.02,1.370],[1.92,1.10,2.969,1.10],[1.995,1.074,2.96,1.10],[2.72,0.86,2.53,1.10]];   // 驾驶室放样 [y,半宽,前z,后z]:六边形截面随高度渐变(前切角/腰扩/顶收/尾切角)
/* --- 放样/薄板几何原语(与 prismGeo 同范式: 期望法线 + 绕向自动校正;凡绘制即实体) --- */
function _lgTri(pos, nrm, a, b, c, nx, ny, nz) {
  var ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2];
  var vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
  var wx = uy*vz-uz*vy, wy = uz*vx-ux*vz, wz = ux*vy-uy*vx;
  if (wx*nx + wy*ny + wz*nz < 0) { var t = b; b = c; c = t; }   // 绕向自动校正到期望法线一侧
  pos.push(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2]);
  nrm.push(nx,ny,nz, nx,ny,nz, nx,ny,nz);
}
function _lgFan(pos, nrm, poly, nx, ny, nz) {          // 凸多边形扇形盖
  for (var i = 1; i < poly.length - 1; i++) _lgTri(pos, nrm, poly[0], poly[i], poly[i+1], nx, ny, nz);
}
function loftYGeo(secs) {                              // 六边形 plan 截面沿高度放样实体(BLUE_MLRS 驾驶室;demo loftY)
  function poly(s) { var y = s[0], w = s[1], f = s[2], r = s[3];
    return [[-w,y,r],[w,y,r],[w,y,f-0.24],[w-0.24,y,f],[-(w-0.24),y,f],[-w,y,f-0.24]]; }
  var P = secs.map(poly), pos = [], nrm = [], i, j, k;
  _lgFan(pos, nrm, P[0], 0, -1, 0);
  _lgFan(pos, nrm, P[P.length-1], 0, 1, 0);
  for (k = 0; k < P.length-1; k++) {
    var ay = (secs[k][3] + secs[k][2]) / 2;
    for (i = 0; i < 6; i++) {
      j = (i+1) % 6;
      var p0 = P[k][i], p1 = P[k][j], p2 = P[k+1][j], p3 = P[k+1][i];
      var ux = p1[0]-p0[0], uy = p1[1]-p0[1], uz = p1[2]-p0[2];
      var vx = p3[0]-p0[0], vy = p3[1]-p0[1], vz = p3[2]-p0[2];
      var nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
      var L = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1; nx/=L; ny/=L; nz/=L;
      var mx = (p0[0]+p1[0]+p2[0]+p3[0])/4, mz = (p0[2]+p1[2]+p2[2]+p3[2])/4;
      if (mx*nx + (mz-ay)*nz < 0) { nx=-nx; ny=-ny; nz=-nz; }
      _lgTri(pos, nrm, p0, p1, p2, nx, ny, nz);
      _lgTri(pos, nrm, p0, p2, p3, nx, ny, nz);
    }
  }
  return finishGeo(pos, nrm, null);
}
function loftXZGeo(secs) {                             // plan(x,z) 截面沿 y 放样(BLUE_MLRS 保护箱;demo loftXZ;secs=[y,plan])
  var P = secs.map(function (s) { return s[1].map(function (q) { return [q[0], s[0], q[1]]; }); });
  var pos = [], nrm = [], i, j, k;
  _lgFan(pos, nrm, P[0], 0, -1, 0);
  _lgFan(pos, nrm, P[P.length-1], 0, 1, 0);
  for (k = 0; k < P.length-1; k++) {
    var csx = 0, csz = 0, nn = secs[k][1].length;
    for (i = 0; i < nn; i++) { csx += secs[k][1][i][0]; csz += secs[k][1][i][1]; }
    csx /= nn; csz /= nn;
    for (i = 0; i < nn; i++) {
      j = (i+1) % nn;
      var p0 = P[k][i], p1 = P[k][j], p2 = P[k+1][j], p3 = P[k+1][i];
      var ux = p1[0]-p0[0], uy = p1[1]-p0[1], uz = p1[2]-p0[2];
      var vx = p3[0]-p0[0], vy = p3[1]-p0[1], vz = p3[2]-p0[2];
      var nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
      var L = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1; nx/=L; ny/=L; nz/=L;
      var mx = (p0[0]+p1[0]+p2[0]+p3[0])/4, mz = (p0[2]+p1[2]+p2[2]+p3[2])/4;
      if ((mx-csx)*nx + (mz-csz)*nz < 0) { nx=-nx; ny=-ny; nz=-nz; }
      _lgTri(pos, nrm, p0, p1, p2, nx, ny, nz);
      _lgTri(pos, nrm, p0, p2, p3, nx, ny, nz);
    }
  }
  return finishGeo(pos, nrm, null);
}
function m142PodSidePoly(s8, zf) {                     // 保护箱 plan 多边形(s8=侧符;俯视前 1/8 收缩斜坡;demo Pside)
  var a = [[0.68,-0.75],[1.12,-0.75],[1.12,3.01],[0.74,zf],[0.68,zf]];
  if (s8 < 0) a = a.map(function (q) { return [-q[0], q[1]]; });
  return a;
}
function slabQGeo(q, tn, nHint) {                      // 任意空间四边形薄板:沿外法线向内挤出 tn(demo slabQ;nHint=外法线暗示,防左右侧翻转)
  var ax = q[1][0]-q[0][0], ay = q[1][1]-q[0][1], az = q[1][2]-q[0][2];
  var bx = q[3][0]-q[0][0], by = q[3][1]-q[0][1], bz = q[3][2]-q[0][2];
  var nx = ay*bz-az*by, ny = az*bx-ax*bz, nz = ax*by-ay*bx;
  var L = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1; nx/=L; ny/=L; nz/=L;
  if (nHint && nx*nHint[0] + ny*nHint[1] + nz*nHint[2] < 0) { nx=-nx; ny=-ny; nz=-nz; }
  var c = [0,0,0], i;
  for (i = 0; i < 4; i++) { c[0]+=q[i][0]; c[1]+=q[i][1]; c[2]+=q[i][2]; }
  c[0]/=4; c[1]/=4; c[2]/=4;
  var t = [-nx*tn, -ny*tn, -nz*tn];
  var p2 = [];
  for (i = 0; i < 4; i++) p2.push([q[i][0]+t[0], q[i][1]+t[1], q[i][2]+t[2]]);
  var pos = [], nrm = [];
  _lgFan(pos, nrm, q, nx, ny, nz);
  _lgFan(pos, nrm, p2, -nx, -ny, -nz);
  for (var e = 0; e < 4; e++) {
    var j = (e+1) % 4;
    var ex = q[j][0]-q[e][0], ey = q[j][1]-q[e][1], ez = q[j][2]-q[e][2];
    var snx = ey*t[2]-ez*t[1], sny = ez*t[0]-ex*t[2], snz = ex*t[1]-ey*t[0];
    var sL = Math.sqrt(snx*snx+sny*sny+snz*snz) || 1; snx/=sL; sny/=sL; snz/=sL;
    var mcx = (q[e][0]+q[j][0]+p2[j][0]+p2[e][0])/4 - c[0];
    var mcy = (q[e][1]+q[j][1]+p2[j][1]+p2[e][1])/4 - c[1];
    var mcz = (q[e][2]+q[j][2]+p2[j][2]+p2[e][2])/4 - c[2];
    if (snx*mcx + sny*mcy + snz*mcz < 0) { snx=-snx; sny=-sny; snz=-snz; }
    _lgTri(pos, nrm, q[e], q[j], p2[j], snx, sny, snz);
    _lgTri(pos, nrm, q[e], p2[j], p2[e], snx, sny, snz);
  }
  return finishGeo(pos, nrm, null);
}
function m142TrapWinGeo(side) {                        // 梯形门窗(demo trapWin: 底边 z1.92..2.46,顶边 z1.92..2.33 前缘后掠,随侧面收分)
  function xf(y) { return 1.074 - 0.2952 * (y - 1.995); }
  var yb = 2.08, yt = 2.50, o = 0.014;
  return slabQGeo([[side*(xf(yb)+o), yb, 1.92],[side*(xf(yt)+o), yt, 1.92],[side*(xf(yt)+o), yt, 2.33],[side*(xf(yb)+o), yb, 2.46]], 0.055, [side, 0, 0]);
}
/* ===== BLUE_MLRS 俯仰液压杆(双节伸缩×2)动态件 —— demo v0.4~v0.6 功能完整移植 =====
   缸体锚定回转框架前耳 TA(随 turret 旋转),活塞杆锚定发射舱耳座 PA(随 turret+俯仰);
   逐帧按三维瞄准矩阵(m4aim 等价: Z 轴=两铰点连线,X 轴=up×Z 锁水平)解算,
   任意方位×俯仰组合下两端精确铰接(demo matrices() 的 hydB/hydR 同式)。 */
var BLUE_MLRS_HYD_TA = [0, -0.01, 0.62];    // 下铰点(turret 局部,=回转框架前耳)
var BLUE_MLRS_HYD_PA = [0, -0.45, 1.75];    // 上铰点(gunPivot 局部,=液压缸上铰座)
var BLUE_MLRS_TURN_POS = [0, 1.35, -3.10];  // 转盘中心(车体局部)
var BLUE_MLRS_PIVOT_POS = [0, 0.40, 0];     // 俯仰铰点(turret 局部)
var m142HydMat = null, BLUE_MLRS_HYD_BARREL_GEO = null, BLUE_MLRS_HYD_ROD_GEO = null;
function _hydTri(P, N, C, a, b, c, col) {              // 几何法线三角(demo face()+box/cyl 同式:法线=(p1-p0)×(p2-p0))
  var ux=b[0]-a[0], uy=b[1]-a[1], uz=b[2]-a[2], vx=c[0]-a[0], vy=c[1]-a[1], vz=c[2]-a[2];
  var nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
  var L=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
  P.push(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2]);
  for (var k=0;k<3;k++){ N.push(nx/L,ny/L,nz/L); C.push(col[0],col[1],col[2]); }
}
function _hydTubeZ(P,N,C,col,cx,cy,z0,z1,r,seg){       // +Z 轴向圆柱带端盖(demo cylZ)
  var i,a0=[],a1=[];
  for(i=0;i<seg;i++){var t=i/seg*2*Math.PI;var px=cx+Math.cos(t)*r,py=cy+Math.sin(t)*r;a0.push([px,py,z0]);a1.push([px,py,z1]);}
  for(i=0;i<seg;i++){var j=(i+1)%seg;
    _hydTri(P,N,C,a0[i],a0[j],a1[j],col); _hydTri(P,N,C,a0[i],a1[j],a1[i],col);}
  for(i=1;i<seg-1;i++){ _hydTri(P,N,C,a0[0],a0[i+1],a0[i],col); _hydTri(P,N,C,a1[0],a1[i],a1[i+1],col); }
}
function _hydTubeX(P,N,C,col,cx,y,cz,x0,x1,r,seg){     // +X 轴向圆柱带端盖(demo cylX,横销用)
  var i,a0=[],a1=[];
  for(i=0;i<seg;i++){var t=i/seg*2*Math.PI;var py=y+Math.cos(t)*r,pz=cz+Math.sin(t)*r;a0.push([x0,py,pz]);a1.push([x1,py,pz]);}
  for(i=0;i<seg;i++){var j=(i+1)%seg;
    _hydTri(P,N,C,a0[i],a0[j],a1[j],col); _hydTri(P,N,C,a0[i],a1[j],a1[i],col);}
  for(i=1;i<seg-1;i++){ _hydTri(P,N,C,a0[0],a0[i+1],a0[i],col); _hydTri(P,N,C,a1[0],a1[i],a1[i+1],col); }
}
function _hydBox(P,N,C,col,cx,cy,cz,sx,sy,sz){         // 盒(demo box 面序同式)
  var x0=cx-sx/2,x1=cx+sx/2,y0=cy-sy/2,y1=cy+sy/2,z0=cz-sz/2,z1=cz+sz/2;
  var v=[[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],
         [[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]],
         [[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]],
         [[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]],
         [[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]],
         [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]]];
  for(var f=0;f<6;f++){var q=v[f];_hydTri(P,N,C,q[0],q[1],q[2],col);_hydTri(P,N,C,q[0],q[2],q[3],col);}
}
function _m142HydBuild(isRod){                         // demo buildHydB/buildHydR:缸体/活塞杆各含 旋转铰夹板×2+横销
  var P=[],N=[],C=[];
  var cBar=[0.42,0.37,0.27], cRod=[0.35,0.36,0.38], cSteel=[0.235,0.255,0.282];
  for (var s=-1;s<=1;s+=2){
    var x=s*0.55;
    if(!isRod){
      _hydTubeZ(P,N,C,cBar,x,0,0,1.0,0.055,10);             // 缸筒(下铰点起 +Z 1.0)
      _hydTubeZ(P,N,C,cSteel,x,0,-0.04,0.08,0.07,10);       // 缸底回转套
      _hydBox(P,N,C,cBar,x-0.078,0,0.10,0.03,0.11,0.18);    // 底部旋转铰夹板×2
      _hydBox(P,N,C,cBar,x+0.078,0,0.10,0.03,0.11,0.18);
      _hydTubeX(P,N,C,cSteel,x,0,0.02,x-0.11,x+0.11,0.04,8);// 横销
    } else {
      _hydTubeZ(P,N,C,cRod,x,0,0,1.0,0.032,8);              // 活塞杆(上铰点起指向缸体)
      _hydTubeZ(P,N,C,cSteel,x,0,-0.03,0.07,0.05,8);        // 杆顶铰座套
      _hydBox(P,N,C,cRod,x-0.078,0,0.10,0.03,0.11,0.18);    // 顶部旋转铰夹板×2
      _hydBox(P,N,C,cRod,x+0.078,0,0.10,0.03,0.11,0.18);
      _hydTubeX(P,N,C,cSteel,x,0,0.02,x-0.11,x+0.11,0.04,8);// 横销
    }
  }
  var g=new THREE.BufferGeometry(), pn=P.length/3, i;
  var idx=pn>65535?new Uint32Array(pn):new Uint16Array(pn);
  for(i=0;i<pn;i++) idx[i]=i;
  g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(P),3));
  g.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(N),3));
  g.setAttribute('color',new THREE.BufferAttribute(new Float32Array(C),3));
  g.setIndex(new THREE.BufferAttribute(idx,1));
  g.computeBoundingSphere();
  return g;
}
function m142HydEnsure(){
  if(!m142HydMat){
    m142HydMat=new THREE.MeshLambertMaterial({vertexColors:true});
    BLUE_MLRS_HYD_BARREL_GEO=_m142HydBuild(false);
    BLUE_MLRS_HYD_ROD_GEO=_m142HydBuild(true);
  }
}
var _hydV1,_hydV2,_hydV3,_hydV4,_hydM4;
function updateBLUE_MLRSHydraulics(t){                      // 每帧解算(instUpdateAll 调用;预览车出生时调用一次)
  var h=t._hydStruts; if(!h) return;
  if(!t.alive){ h.b.visible=false; h.r.visible=false; return; }
  h.b.visible=true; h.r.visible=true;
  if(!_hydV1){ _hydV1=new THREE.Vector3(); _hydV2=new THREE.Vector3(); _hydV3=new THREE.Vector3(); _hydV4=new THREE.Vector3(); _hydM4=new THREE.Matrix4(); }
  var cy=Math.cos(t.turretYaw||0), sy=Math.sin(t.turretYaw||0);
  var cp=Math.cos(t.gunPitch||0), sp=Math.sin(t.gunPitch||0);
  var paY=BLUE_MLRS_HYD_PA[1]*cp + BLUE_MLRS_HYD_PA[2]*sp;       // Rx(-gunPitch): 与 gunPivot.rotation.x=-gunPitch 同式
  var paZ=-BLUE_MLRS_HYD_PA[1]*sp + BLUE_MLRS_HYD_PA[2]*cp;
  var lx=BLUE_MLRS_HYD_PA[0]+BLUE_MLRS_PIVOT_POS[0], ly=paY+BLUE_MLRS_PIVOT_POS[1], lz=paZ+BLUE_MLRS_PIVOT_POS[2];
  var pwX=lx*cy+lz*sy+BLUE_MLRS_TURN_POS[0], pwY=ly+BLUE_MLRS_TURN_POS[1], pwZ=-lx*sy+lz*cy+BLUE_MLRS_TURN_POS[2];   // Ry(turretYaw)
  var ta=BLUE_MLRS_HYD_TA;
  var twX=ta[0]*cy+ta[2]*sy+BLUE_MLRS_TURN_POS[0], twY=ta[1]+BLUE_MLRS_TURN_POS[1], twZ=-ta[0]*sy+ta[2]*cy+BLUE_MLRS_TURN_POS[2];
  var dx=pwX-twX, dy=pwY-twY, dz=pwZ-twZ;
  var L=Math.sqrt(dx*dx+dy*dy+dz*dz)||1; dx/=L; dy/=L; dz/=L;
  var up=(Math.abs(dy)>0.995)?_hydV2.set(0,0,1):_hydV2.set(0,1,0);   // m4aim: Z=连线,X=up×Z 锁水平
  _hydV1.set(dx,dy,dz);
  _hydV3.crossVectors(up,_hydV1).normalize();
  _hydV4.crossVectors(_hydV1,_hydV3);
  _hydM4.makeBasis(_hydV3,_hydV4,_hydV1);
  h.b.quaternion.setFromRotationMatrix(_hydM4);
  h.b.position.set(twX,twY,twZ);
  _hydV1.set(-dx,-dy,-dz);                              // 活塞杆:反向基,锚上铰点
  _hydV3.crossVectors(up,_hydV1).normalize();
  _hydV4.crossVectors(_hydV1,_hydV3);
  _hydM4.makeBasis(_hydV3,_hydV4,_hydV1);
  h.r.quaternion.setFromRotationMatrix(_hydM4);
  h.r.position.set(pwX,pwY,pwZ);
}
/* ===== RED_MLRS 后液压驻锄专属动画(移动缓慢收起 / 停车自动缓慢放下)=====
   驻锄腿+驻锄垫刚体绕铰点 PHL11_SPADE_PIVOT 旋转(+X 轴正角=向后上方折起,收起角 1.35rad≈77°);
   驻锄液压缸拆两段(缸筒锚车架 A / 活塞杆锚锄腿 B'),逐帧三维瞄准解算(m4aim 同式),
   全行程 |AB'|∈[0.35,0.43] < 缸筒 0.28 + 活塞杆 0.20,两端永不脱接;
   速度阈值 0.15m/s:移动→收起,静止→放下;指数趋近速率 1.8/s(全行程约 3s,"缓慢")。 */
var PHL11_SPADE_PIVOT = [0.68, 0.98, -1.62];     // 铰点(|x|,左右对称;驻锄支座顶)
var PHL11_SPADE_TOPA  = [0.45, 0.95, -1.35];     // 液压缸顶锚点(车架侧,|x|)
var PHL11_SPADE_BOT0  = [0.705, 0.906, -1.582];  // 液压缸底锚点(锄腿侧,|x|;放下态=demo v0.10 缸轴末端)
var PHL11_SPADE_STOW  = 1.35;                    // 收起转角(rad)
var PHL11_SPADE_RATE  = 1.8;                     // 指数趋近速率(1/s)
/* Each RED-MLRS keeps its own spade timing so same-frame calls cannot share state.
   第 1 门吃掉真实帧 dt、第 2+ 门 now 几乎不变 → dt≈0 → k += (tgt-k)·dt·1.8 ≈ 0,
   驻锄动画冻结在出生态(放下)。时钟随 rig 私有(sp._lastT),各门独立积分。 */
function _spadeBoxRX(P, N, C, col, cx, cy, cz, sx, sy, sz, ang) {   // 绕 X 旋转盒(demo boxRX 同式;法线=逐三角几何法线)
  var ca = Math.cos(ang), sa = Math.sin(ang);
  function Pt(dx, dy, dz) { return [cx + dx, cy + dy * ca - dz * sa, cz + dy * sa + dz * ca]; }
  var c = [Pt(-sx/2,-sy/2,-sz/2), Pt(sx/2,-sy/2,-sz/2), Pt(sx/2,sy/2,-sz/2), Pt(-sx/2,sy/2,-sz/2),
           Pt(-sx/2,-sy/2,sz/2), Pt(sx/2,-sy/2,sz/2), Pt(sx/2,sy/2,sz/2), Pt(-sx/2,sy/2,sz/2)];
  var F = [[0,1,2,3],[5,4,7,6],[1,5,6,2],[4,0,3,7],[3,2,6,7],[4,5,1,0]];
  /* ★绕序反转(demo F 列表叉积法线朝内,demo 渲染器无背面剔除未暴露;游戏 FrontSide 下内绕=外面被剔=开放盒"三片面片"):
     每 quad 输出 (q0,q2,q1)/(q0,q3,q2) → 法线朝外,与 _hydBox 面序同向。 */
  for (var f = 0; f < 6; f++) { var q = F[f]; _hydTri(P,N,C,c[q[0]],c[q[2]],c[q[1]],col); _hydTri(P,N,C,c[q[0]],c[q[3]],c[q[2]],col); }
}
function _hydFinishC(P, N, C, aCam) {              // 带顶点色的有索引几何(独立 Mesh 用;与 _m142HydBuild 同范式)
  var g = new THREE.BufferGeometry(), pn = P.length / 3, i;
  var idx = pn > 65535 ? new Uint32Array(pn) : new Uint16Array(pn);
  for (i = 0; i < pn; i++) idx[i] = i;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  if (aCam) {                                      // 走 vehBodyMat 的件:uv 钉画集平坦区 + 逐顶点迷彩身份(1=红方数码迷彩装甲漆)
    uvSetFlat(g);
    g.setAttribute('aCamo', new THREE.BufferAttribute(new Float32Array(aCam), 1));
  }
  g.computeBoundingSphere();
  return g;
}
function phl11SpadeLegGeo(side, cols) {            // 锄腿+锄垫+铰销(车体系构建 → 平移到铰点局部)
  var P = [], N = [], C = [], M = [];
  function camoMark(v) { for (var q = M.length; q < P.length / 3; q++) M.push(v); }   // 腿=装甲漆(aCamo 1,吃数码迷彩)/垫、销=非装甲(0)
  var px = PHL11_SPADE_PIVOT[0] * side;
  _spadeBoxRX(P, N, C, cols.leg, px, 0.50, -1.80, 0.14, 0.95, 0.12, -2.62);   // 驻锄腿(倾置,demo v0.10 原位)
  camoMark(1);
  _hydBox(P, N, C, cols.pad, px, 0.10, -2.03, 0.34, 0.08, 0.44);              // 驻锄垫
  camoMark(0);
  _hydTubeX(P, N, C, cols.pad, px, PHL11_SPADE_PIVOT[1], PHL11_SPADE_PIVOT[2], px - 0.10, px + 0.10, 0.045, 8);   // 铰销
  camoMark(0);
  var g = _hydFinishC(P, N, C, M);
  g.translate(-px, -PHL11_SPADE_PIVOT[1], -PHL11_SPADE_PIVOT[2]);
  g.computeBoundingSphere();
  return g;
}
function phl11SpadeCylGeo(isRod, cols) {           // 缸筒/活塞杆(aim 局部:原点=自身锚点,+Z 指向对端锚点;
  var P = [], N = [], C = [];                      // BLUE_MLRS 动态液压杆同范式:回转套+铰夹板×2+横销+主缸/杆;全行程 |AB'|∈[0.348,0.421]:
  if (!isRod) {                                    //   杆端(0.30)恒深藏筒内、筒口螺母(0.375)恒藏入杆端套(r0.056>0.050),两端永不脱接/无端盖互穿)
    _hydTubeZ(P, N, C, cols.pad, 0, 0, -0.04, 0.06, 0.058, 8);        // 底部回转套(车架铰点 A)
    _hydBox(P, N, C, cols.bar, -0.075, 0, 0.115, 0.025, 0.095, 0.15); // 旋转铰夹板×2
    _hydBox(P, N, C, cols.bar,  0.075, 0, 0.115, 0.025, 0.095, 0.15);
    _hydTubeX(P, N, C, cols.pad, 0, 0, 0.045, -0.095, 0.095, 0.030, 8); // 横销
    _hydTubeZ(P, N, C, cols.bar, 0, 0, 0, 0.36, 0.040, 10);           // 缸筒
    _hydTubeZ(P, N, C, cols.pad, 0, 0, 0.31, 0.375, 0.050, 10);       // 筒口压紧螺母(杆由此穿出)
  } else {
    _hydTubeZ(P, N, C, cols.pad, 0, 0, -0.035, 0.055, 0.056, 8);      // 杆顶铰座套(锄腿铰点 B')
    _hydBox(P, N, C, cols.rod2, -0.075, 0, 0.115, 0.025, 0.095, 0.15); // 旋转铰夹板×2
    _hydBox(P, N, C, cols.rod2,  0.075, 0, 0.115, 0.025, 0.095, 0.15);
    _hydTubeX(P, N, C, cols.pad, 0, 0, 0.045, -0.095, 0.095, 0.030, 8); // 横销
    _hydTubeZ(P, N, C, cols.rod2, 0, 0, 0, 0.30, 0.026, 8);           // 活塞杆
  }
  return _hydFinishC(P, N, C, null);
}
var _spV1, _spV2, _spV3, _spV4, _spM4;
function _spadeAim(m, fx, fy, fz, tx, ty, tz) {    // 三维瞄准矩阵(m4aim 等价: Z=锚点连线,X 锁水平)
  var dx = tx - fx, dy = ty - fy, dz = tz - fz;
  var L = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1; dx /= L; dy /= L; dz /= L;
  if (!_spV1) { _spV1 = new THREE.Vector3(); _spV2 = new THREE.Vector3(); _spV3 = new THREE.Vector3(); _spV4 = new THREE.Vector3(); _spM4 = new THREE.Matrix4(); }
  var up = (Math.abs(dy) > 0.995) ? _spV2.set(0, 0, 1) : _spV2.set(0, 1, 0);
  _spV1.set(dx, dy, dz);
  _spV3.crossVectors(up, _spV1).normalize();
  _spV4.crossVectors(_spV1, _spV3);
  _spM4.makeBasis(_spV3, _spV4, _spV1);
  m.quaternion.setFromRotationMatrix(_spM4);
  m.position.set(fx, fy, fz);
}
function updatePHL11Spades(t) {                    // 每帧驱动(instUpdateAll 调用;预览车出生时调用一次=放下态)
  var sp = t._spadeRig; if (!sp) return;
  var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  var dt = sp._lastT ? Math.min(0.1, (now - sp._lastT) * 0.001) : 0.016;   // ★任务27⑦:rig 私有时钟(共享时钟见上注)
  sp._lastT = now;
  /* 非完全静止即收起:直线速度 ≥0.15m/s 或 车体偏航角速度 ≥0.08rad/s(原地/弧线转向同样算动;
     炮塔回转 turretYaw 不触发——真车驻锄放下时允许转塔。yaw 差经 atan2 归一 ±π 防跨圈跳变。 */
  var _syw = t.yaw || 0;
  var _dyaw = (sp._yawPrev == null) ? 0 : Math.abs(Math.atan2(Math.sin(_syw - sp._yawPrev), Math.cos(_syw - sp._yawPrev)));
  sp._yawPrev = _syw;
  var _moving = Math.abs(t.speed || 0) >= 0.15 || _dyaw >= 0.08 * Math.max(dt, 1e-3);
  var tgt = _moving ? 0 : 1;   // 静止=放下 / 移动或转向=收起
  sp.k += (tgt - sp.k) * Math.min(1, dt * PHL11_SPADE_RATE);
  if (Math.abs(tgt - sp.k) < 0.003) sp.k = tgt;
  var th = PHL11_SPADE_STOW * (1 - sp.k), ct = Math.cos(th), st = Math.sin(th);
  var oy = PHL11_SPADE_BOT0[1] - PHL11_SPADE_PIVOT[1], oz = PHL11_SPADE_BOT0[2] - PHL11_SPADE_PIVOT[2];
  for (var i = 0; i < sp.sides.length; i++) {
    var sd = sp.sides[i], sx = sd.side;
    sd.legG.rotation.x = th;                        // 锄腿刚体绕铰点
    var bx = PHL11_SPADE_BOT0[0] * sx;              // 底锚点随腿旋转(Rx 不改 x)
    var by = PHL11_SPADE_PIVOT[1] + oy * ct - oz * st;
    var bz = PHL11_SPADE_PIVOT[2] + oy * st + oz * ct;
    var ax = PHL11_SPADE_TOPA[0] * sx, ay = PHL11_SPADE_TOPA[1], az = PHL11_SPADE_TOPA[2];
    _spadeAim(sd.barrel, ax, ay, az, bx, by, bz);   // 缸筒:顶锚→底锚
    _spadeAim(sd.rod, bx, by, bz, ax, ay, az);      // 活塞杆:底锚→顶锚
  }
}
/* ===== RED_MLRS 火箭弹视觉消耗动画(用户口径:每射出一发,发射架上火箭弹按顺序少一个;装填完成全部刷回;
   参考直升机导弹消耗机制 fireHeliMissile→筒位 visible=false;40 发用 InstancedMesh.count 截断=整包 1 draw call)。
   发射顺序 = 自下而上逐层,每层左模块→右模块、模块内左→右;实例倒序挂载(实例 j = ORDER[N-1-j]),
   count=剩余数 时被剔掉的恰是已按顺序发射的前几发。每发离轨由 weapons.js fireShell 齐射分支扣 _rktLeft;
   装填完成(reload≤0 且无齐射)由 updatePHL11Rockets 整包恢复。 ===== */
var PHL11_RKT_ORDER = (function () {                     // 40 发发射顺序=自下而上逐层、每层左模块→右模块、模块内左→右
  var ord = [], gap = 0.21;                              // 项=[px, py, 管中心z, 弹头中心z](gunPivot 局部;弹头中心=该发发射位置)
  for (var r = 0; r < 4; r++)
    for (var pd = -1; pd <= 1; pd += 2)
      for (var c = 0; c < 5; c++)
        ord.push([pd * 0.55 + (c - 2) * gap, 0.55 + (r - 1.5) * gap, 0.65, 2.19]);
  return ord;
})();
var BLUE_MLRS_RKT_ORDER = (function () {                      // BLUE_MLRS 六发发射顺序=下排左→右、上排左→右;项=前管口圆心(弹头中心,gunPivot 局部)
  var ord = [];
  for (var rw = 0; rw < 2; rw++) for (var c = -1; c <= 1; c++)
    ord.push([c * 0.28, 0.10 + (rw - 0.5) * 0.38, 3.57]);
  return ord;
})();
function _hydTubeZT(P,N,C,col,cx,cy,z0,z1,r0,r1,seg){    // +Z 轴锥台圆柱带端盖(z0 半径 r0 → z1 半径 r1;_hydTubeZ 同范式同绕序)
  var i,a0=[],a1=[];
  for(i=0;i<seg;i++){var t=i/seg*2*Math.PI;
    a0.push([cx+Math.cos(t)*r0,cy+Math.sin(t)*r0,z0]);
    a1.push([cx+Math.cos(t)*r1,cy+Math.sin(t)*r1,z1]);}
  for(i=0;i<seg;i++){var j=(i+1)%seg;
    _hydTri(P,N,C,a0[i],a0[j],a1[j],col); _hydTri(P,N,C,a0[i],a1[j],a1[i],col);}
  for(i=1;i<seg-1;i++){ _hydTri(P,N,C,a0[0],a0[i+1],a0[i],col); _hydTri(P,N,C,a1[0],a1[i],a1[i+1],col); }
}
function phl11RocketGeo(cols) {                          // 单发"储运弹"整组:定向管身+固定环×2(迷彩)+尾箍/管口箍/弹头段/锥顶(深灰)
  var P = [], N = [], C = [], M = [];                    // 局部原点=管中心,+Z 前;整管逐发消失(模板已无逐管件)
  function mk(v) { for (var q = M.length; q < P.length / 3; q++) M.push(v); }
  var cA = (cols && cols.acc) || [0.24, 0.29, 0.19], cD = (cols && cols.dark) || [0.1412, 0.1490, 0.1647];
  _hydTubeZ(P, N, C, cA, 0, 0, -1.40, 1.40, 0.068, 8); mk(1);          // 定向管身(原模板 pz-0.10 位)
  _hydTubeZ(P, N, C, cA, 0, 0, -0.75, -0.65, 0.078, 8); mk(1);         // 固定环×2(原 pz-0.80/pz+0.60 位)
  _hydTubeZ(P, N, C, cA, 0, 0,  0.65,  0.75, 0.078, 8); mk(1);
  _hydTubeZ(P, N, C, cD, 0, 0, -1.35, -1.29, 0.074, 8); mk(0);         // 尾箍(原 pz-1.42 位)
  _hydTubeZ(P, N, C, cD, 0, 0,  1.40,  1.48, 0.074, 8); mk(0);         // 管口箍(原 pz+1.34 位)
  _hydTubeZ(P, N, C, cD, 0, 0,  1.42,  1.66, 0.050, 8); mk(0);         // 弹头段(原 pz+1.44 位)
  _hydTubeZT(P, N, C, cD, 0, 0, 1.59, 1.69, 0.025, 0.006, 8); mk(0);   // 锥顶(原 pz+1.54 位)
  return _hydFinishC(P, N, C, M);
}
function updatePHL11Rockets(t) {                         // 逐帧同步(instUpdateAll 驱动;预览车出生调用一次=满弹)
  var rk = t._rktPack; if (!rk) return;
  if (!t.alive) { rk.visible = false; return; }          // 残骸:整包隐藏
  rk.visible = true;
  var full = PHL11_RKT_ORDER.length;
  if (t._rktLeft == null) t._rktLeft = full;
  if ((t.reload || 0) <= 0 && (t.salvoLeft || 0) <= 0 && t._rktLeft < full) t._rktLeft = full;   // 装填完成→全部刷回
  var c = t._rktLeft | 0; if (c < 0) c = 0; if (c > full) c = full;
  if (rk.count !== c) rk.count = c;
}
/* RED_MBT_2主战坦克(红方第四类载具):前部外形沿用 59 式("<"缓首/23.8°首上/25.35°鼻板),
   车体后段拉长 0.75m 适配 6 对负重轮(尾垂直面 -2.45→-3.20);
   履带轮廓=59 式前段原样+后两点 z-0.5(端轮弧 R/切角不变,后弧心解析 (-2.800,0.599));
   炮塔=焊接楔形:前楔 50° 后倾(z-y 截面),俯视 V 形双颊为视觉件;命中壳=同截面棱柱+侧面分区板。
   视觉/命中共用本组常量。 */
var T99_HULL_PTS=[[2.32,0.30],[2.50,0.68],[1.48,1.13],[-3.20,1.13],[-3.20,0.58],[-2.95,0.30]];
var TRACK_POLY_99=[[2.993,0.956],[2.233,-0.095],[-2.744,-0.095],[-3.460,0.904]];
var TRACK_FILLET_99=[0.33,0.24,0.24,0.31];
/* RED_MBT_2炮塔五环骨架(用户红线轮廓/黑线转折点逐点录入,2026-09-07侧视四改+正视弧):
   侧视=前楔三斜面(上两段13°/29°+下前39°)+顶冠0.62(边0.60弧形)+后底斜面(底后段上抬);赤道y0.30恒定,加高后赤道略低于中线;
   俯视=箭形:前尖短横边 ±0.26 → 颊缘外扩至肩部最宽 ±1.08 → 经R(-0.70)直收锥至 ±0.80 → 尾横切。
   赤道环(y0.30)最宽,腰环MID(y0.48)=赤道-0.01/顶边(y0.60)前段=赤道-0.05弧形过渡、后段=赤道-0.02/屋面环(y0.645)=顶边半宽且z向冠内收35%(前后无垂直折面)/顶冠(y0.66)三段拱(拱高6cm)/底环前部=赤道重合(全程微微外凸,无凹槽);后段四边平行共面;底环y分站[0.05×4,0.17,0.18]后底斜;闭合壳视觉/命中共用。[2026-09-05 正面/\\][2026-09-06 后外凸][2026-09-07 侧视:加高+上双斜+下前角+后底斜][2026-09-07 正视弧顶][2026-09-07 顶弧前半][2026-09-07 拱加强][2026-09-07 前顶顺接]
   [2026-09-04 分段镜像修复/用户确认:中线y=0.30(赤道/炮轴高);左=-X右=+X(大门正对炮口视角);
    下半(y<0.30)左为基准右镜像左,上半(y>0.30)右为基准左镜像右;三环为单侧幅值录入,下半取该组为左基准、上半取该组为右基准分别镜像对侧] */
var T99_TUR_EQ  = [[0.26, 1.35], [1.04, 0.94], [1.08, 0.26], [0.939, -0.70], [0.80, -1.65], [0.80, -1.74]];   // 尾部延长;R(-0.70)为后底斜折点(与锥线共线,不改包络)
var T99_TUR_MID = [[0.23, 1.03], [1.03, 0.63], [1.07, 0.26], [0.929, -0.70], [0.79, -1.65], [0.79, -1.74]];   // [2026-09-07]腰环(y0.48)=赤道-0.01:前尖增15°/29°双斜折点(0.23,1.03),后边与赤道平行
var T99_TUR_TOP = [[0.17, 0.51], [0.99, 0.32], [1.03, 0.26], [0.919, -0.70], [0.78, -1.65], [0.78, -1.74]];   // [2026-09-05 正面/\\]前颊削<>;[2026-09-06 后段外凸=赤道-0.02];[2026-09-07]i2z0.26+R共线,顶边0.60冠0.62;[2026-09-07 正视弧:顶边前段i0/i1/i2内收3cm做弧形过渡,后段不动]
var T99_TUR_BOT = [[0.55, 1.04], [1.04, 0.55], [1.08, 0.26], [0.939, -0.70], [0.80, -1.65], [0.80, -1.74]];   // [2026-09-07]前尖z0.886→1.04下前角39°;后与赤道重合
var T99_TUR_ROOF = [[0.085, 0.16], [0.495, 0.03], [0.515, -0.01], [0.46, -0.63], [0.39, -1.25], [0.39, -1.31]];   // [2026-09-07]屋面环(y0.645)=顶边半宽,z向冠(-0.50)内收35%消前后垂直折面(前鼻7°/尾6°顺接,冠仍最高)
var T99_TUR_BOT_Y = [0.05, 0.05, 0.05, 0.05, 0.17, 0.18];   // [2026-09-07]底y分站:前平0.05避翼子板,后底斜上抬(尾0.18)
function _t99RingBase(baseHalf, y) {         // 分段镜像专用:以单侧幅值(x>0)为基准生成全环[右前→后 + 左后→前镜像],上下带各调一次保证带内对称
  var r = [], i;
  for (i = 0; i < baseHalf.length; i++) r.push([baseHalf[i][0], y, baseHalf[i][1]]);
  for (i = baseHalf.length - 1; i >= 0; i--) r.push([-baseHalf[i][0], y, baseHalf[i][1]]);
  return r;
}
function _t99RingY(baseHalf, yArr) {         // 底环分站高专用:单侧幅值+每站y[i]生成全环[右前→后 + 左后→前镜像],y随站镜像对称
  var r = [], i;
  for (i = 0; i < baseHalf.length; i++) r.push([baseHalf[i][0], yArr[i], baseHalf[i][1]]);
  for (i = baseHalf.length - 1; i >= 0; i--) r.push([-baseHalf[i][0], yArr[i], baseHalf[i][1]]);
  return r;
}
function _t99BuildShell(eqH, midH, topH, loopH, botH, botY, cz) {   // [2026-09-07]五环四带:下带(底→赤道)+中下带(赤道→腰)+中上带(腰→顶)+屋面带(顶边→屋面环)+顶盖(环→冠0.66)/底盖;法线按质心外向自校
  // [2026-09-05 真改剖分]旧壳顶点对称但拓扑不对称:侧带10 quad全用同向对角线、顶/底盖用R0单侧扇形→左右线框/明暗不一致。
  // 本次按用户口径真镜像:屋面带(0.60→0.645)/中上带(y0.48→0.60)/中下带(y0.30→0.48)右基准左镜像右,下带(底分站y→0.30)左基准右镜像左;横跨中垂面的前后横面用面心4分,顶盖扇心抬0.66三段拱、底盖形心扇形,保证三角集逐个有镜像。
  var eqUp = _t99RingBase(eqH, 0.30), eqLo = _t99RingBase(eqH, 0.30);   // 赤道即中线:上带用右基准环,下带用左基准环(同源数值保证中线闭合无裂缝)
  var md = _t99RingBase(midH, 0.48);                                    // 腰环(中上下带共用同源环,保证腰线闭合无裂缝)
  var tp = _t99RingBase(topH, 0.60), lp = _t99RingBase(loopH, 0.645), bt = _t99RingY(botH, botY);   // 顶边=0.60/屋面环0.645(右基准);底环=下半左基准右镜像左(分站高)
  var pos = [], n = eqUp.length, cx = 0, cy = 0.29, i, j;
  function tri(a, b, c) {
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz2 = ux * vy - uy * vx;
    var mx = (a[0] + b[0] + c[0]) / 3 - cx, my = (a[1] + b[1] + c[1]) / 3 - cy, mz = (a[2] + b[2] + c[2]) / 3 - cz;
    if (nx * mx + ny * my + nz2 * mz < 0) { var t = b; b = c; c = t; }
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  }
  function qCtr(a, b, c, d) { return [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4]; }
  function polyCtr(ring) { var x = 0, y = 0, z = 0, k; for (k = 0; k < ring.length; k++) { x += ring[k][0]; y += ring[k][1]; z += ring[k][2]; } return [x / ring.length, y / ring.length, z / ring.length]; }
  for (i = 0; i < n; i++) {   // 屋面带(顶边0.60→屋面环0.645):右基准,左镜像右(三段拱外段5.1°)
    j = (i + 1) % n;
    var rA = tp[i], rB = tp[j], rC = lp[j], rD = lp[i];
    var rxq = (rA[0] + rB[0] + rC[0] + rD[0]) / 4;
    if (Math.abs(rxq) < 1e-9) { var rm = qCtr(rA, rB, rC, rD); tri(rA, rB, rm); tri(rB, rC, rm); tri(rC, rD, rm); tri(rD, rA, rm); }
    else if (rxq > 0) { tri(rA, rB, rC); tri(rA, rC, rD); }
    else { tri(rA, rB, rD); tri(rB, rC, rD); }
  }
  for (i = 0; i < n; i++) {   // 中上带(y0.48→0.60):右基准,左镜像右(上斜面)
    j = (i + 1) % n;
    var mA = md[i], mB = md[j], mC = tp[j], mD = tp[i];
    var mxq = (mA[0] + mB[0] + mC[0] + mD[0]) / 4;
    if (Math.abs(mxq) < 1e-9) { var mm = qCtr(mA, mB, mC, mD); tri(mA, mB, mm); tri(mB, mC, mm); tri(mC, mD, mm); tri(mD, mA, mm); }
    else if (mxq > 0) { tri(mA, mB, mC); tri(mA, mC, mD); }
    else { tri(mA, mB, mD); tri(mB, mC, mD); }
  }
  for (i = 0; i < n; i++) {   // 中下带(y0.30→0.48):右基准,左镜像右(下斜面,与中上带共腰线)
    j = (i + 1) % n;
    var uA = eqUp[i], uB = eqUp[j], uC = md[j], uD = md[i];
    var uxq = (uA[0] + uB[0] + uC[0] + uD[0]) / 4;
    if (Math.abs(uxq) < 1e-9) { var um = qCtr(uA, uB, uC, uD); tri(uA, uB, um); tri(uB, uC, um); tri(uC, uD, um); tri(uD, uA, um); }
    else if (uxq > 0) { tri(uA, uB, uC); tri(uA, uC, uD); }
    else { tri(uA, uB, uD); tri(uB, uC, uD); }
  }
  for (i = 0; i < n; i++) {   // 下带(底分站y→0.30):左基准,右镜像左
    j = (i + 1) % n;
    var lA = eqLo[i], lB = eqLo[j], lC = bt[j], lD = bt[i];
    var lxq = (lA[0] + lB[0] + lC[0] + lD[0]) / 4;
    if (Math.abs(lxq) < 1e-9) { var lm = qCtr(lA, lB, lC, lD); tri(lA, lB, lm); tri(lB, lC, lm); tri(lC, lD, lm); tri(lD, lA, lm); }
    else if (lxq < 0) { tri(lA, lB, lC); tri(lA, lC, lD); }
    else { tri(lA, lB, lD); tri(lB, lC, lD); }
  }
  var tpC = polyCtr(lp), btC = polyCtr(bt);   // 顶冠0.66三段拱:扇心强制0.66(边0.60→环0.645→冠0.66,5.1°/1.7°);底盖形心扇形(形心x=0,天然镜像对称)
  tpC[1] = 0.66;   // [2026-09-07顶弧加强]冠抬至0.66(拱高6cm),正视三段折线拟合弧线;附件同步+0.04
  for (i = 0; i < n; i++) { j = (i + 1) % n; tri(tpC, lp[i], lp[j]); }
  for (i = 0; i < n; i++) { j = (i + 1) % n; tri(btC, bt[j], bt[i]); }
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  var pn = pos.length / 3, idx = pn > 65535 ? new Uint32Array(pn) : new Uint16Array(pn);
  for (i = 0; i < pn; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));         // 平凡索引:mergeVisParts 合并管线要求全部件有 index(trackRingGeo 同口径)
  g.computeVertexNormals();
  return g;
}
function t99TurretGeo() { return _t99BuildShell(T99_TUR_EQ, T99_TUR_MID, T99_TUR_TOP, T99_TUR_ROOF, T99_TUR_BOT, T99_TUR_BOT_Y, -0.2); }   // 视觉/命中同一全壳(统一标准:炮塔=一个命中体;侧甲前 200/后 100 由 armorOf 命中点 z 分区,切面 -0.45)
/* =====================================================================================
   防空载具(AA)建模桥 + demo 构建器移植 (TASK 18)
   蓝方 = 蓝方防空车 (BLUE_AA) (源: uploads/AN-TWQ1BLUE_AA-建模演示 (1).html, M1097A2 悍马底盘 8×防空导弹)
   红方 = 红方自行防空车 (RED_AA) (源: uploads/PGZ95_modeling_demo.html, 履带底盘 2×双联25mm + 4×防空导弹 + 搜索雷达)
   移植口径: demo 图元原样搬运(AaMB/AaMesh 桥), 面片按颜色分批 → finishGeo → visPartPush,
   绕向按 three.js FrontSide 校正(demo 渲染器无背面剔除), 迷彩身份走 cBODY/cACC 引用比对(aCamo 烧录)。
   ===================================================================================== */
var AA_D2R = Math.PI / 180;
function aaSub3(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
function aaCr3(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function aaN3(a){var l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l];}
function AaMesh(){this.p=[];this.n=[];this.c=[];this.idx=[];}
AaMesh.prototype.vtx=function(x,y,z,nx,ny,nz,col){this.p.push(x,y,z);this.n.push(nx,ny,nz);this.c.push(col[0],col[1],col[2]);return this.p.length/3-1;};
AaMesh.prototype.tri=function(a,b,c){this.idx.push(a,b,c);};
AaMesh.prototype.quad=function(a,b,c,d){this.idx.push(a,b,c,a,c,d);};
function aaFace(m,pts,nrm,col){var ids=[];for(var i=0;i<pts.length;i++)ids.push(m.vtx(pts[i][0],pts[i][1],pts[i][2],nrm[0],nrm[1],nrm[2],col));for(var i=1;i<ids.length-1;i++)m.tri(ids[0],ids[i],ids[i+1]);}
function aaBox(m,cx,cy,cz,sx,sy,sz,col){
  var x0=cx-sx/2,x1=cx+sx/2,y0=cy-sy/2,y1=cy+sy/2,z0=cz-sz/2,z1=cz+sz/2;
  aaFace(m,[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],[0,0,1],col);
  aaFace(m,[[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]],[0,0,-1],col);
  aaFace(m,[[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]],[1,0,0],col);
  aaFace(m,[[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]],[-1,0,0],col);
  aaFace(m,[[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]],[0,1,0],col);
  aaFace(m,[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]],[0,-1,0],col);
}
function aaPrismX(m,poly,x0,x1,col){   // poly: [[z,y],...] 沿X拉伸
  var n=poly.length;
  var A=0;for(var i=0;i<n;i++){var a=poly[i],b=poly[(i+1)%n];A+=a[0]*b[1]-b[0]*a[1];}
  var s=A>0?1:-1;
  /* Use independent side-face vertices so each face keeps a stable outward normal. */
  for(var i=0;i<n;i++){var i2=(i+1)%n;var dz=poly[i2][0]-poly[i][0],dy=poly[i2][1]-poly[i][1];var L=Math.hypot(dz,dy)||1;var ny=-dz/L*s,nz=dy/L*s;
    var a0=m.vtx(x0,poly[i][1],poly[i][0],0,ny,nz,col),b0=m.vtx(x0,poly[i2][1],poly[i2][0],0,ny,nz,col);
    var b1=m.vtx(x1,poly[i2][1],poly[i2][0],0,ny,nz,col),a1=m.vtx(x1,poly[i][1],poly[i][0],0,ny,nz,col);
    if(s*(x1-x0)>0)m.quad(a0,a1,b1,b0);else m.quad(a0,b0,b1,a1);}
  aaFace(m,poly.map(function(q){return [x0,q[1],q[0]];}),[-s,0,0],col);
  aaFace(m,poly.map(function(q){return [x1,q[1],q[0]];}).reverse(),[s,0,0],col);
}
function aaCylDir(m,ctr,dir,r,len,seg,col,r2){   // r2可选=另一端半径(锥台)
  var d=aaN3(dir),up=Math.abs(d[1])>0.9?[1,0,0]:[0,1,0],u=aaN3(aaCr3(d,up)),v=aaCr3(d,u);
  var rr2=(r2==null?r:r2),b=[ctr[0]-d[0]*len/2,ctr[1]-d[1]*len/2,ctr[2]-d[2]*len/2];
  var i0=[],i1=[];
  for(var i=0;i<seg;i++){var a=i/seg*2*Math.PI,ca=Math.cos(a),sa=Math.sin(a);
    var nx=u[0]*ca+v[0]*sa,ny=u[1]*ca+v[1]*sa,nz=u[2]*ca+v[2]*sa;
    i0.push(m.vtx(b[0]+nx*r*  0+ u[0]*ca*r+v[0]*sa*r - 0, b[1]+u[1]*ca*r+v[1]*sa*r, b[2]+u[2]*ca*r+v[2]*sa*r, nx,ny,nz,col));
    i1.push(m.vtx(b[0]+d[0]*len+u[0]*ca*rr2+v[0]*sa*rr2, b[1]+d[1]*len+u[1]*ca*rr2+v[1]*sa*rr2, b[2]+d[2]*len+u[2]*ca*rr2+v[2]*sa*rr2, nx,ny,nz,col));}
  for(var i=0;i<seg;i++){var i2=(i+1)%seg;m.quad(i0[i],i0[i2],i1[i2],i1[i]);}
  aaFace(m,i0.map(function(ix){return [m.p[ix*3],m.p[ix*3+1],m.p[ix*3+2]];}),[-d[0],-d[1],-d[2]],col);
  aaFace(m,i1.map(function(ix){return [m.p[ix*3],m.p[ix*3+1],m.p[ix*3+2]];}),[d[0],d[1],d[2]],col);
}
function aaCylX(m,cx,cy,cz,r,hw,seg,col){aaCylDir(m,[cx,cy,cz],[1,0,0],r,hw*2,seg,col);}
function aaCylZ(m,cx,cy,cz,r,hw,seg,col){aaCylDir(m,[cx,cy,cz],[0,0,1],r,hw*2,seg,col);}
function aaCylY(m,cx,cy,cz,r,hw,seg,col){aaCylDir(m,[cx,cy,cz],[0,1,0],r,hw*2,seg,col);}
function aaDish(m,ctr,dir,R,depth,seg,rings,col,colB){   // 抛物面回转体,轴向dir,口朝dir
  var d=aaN3(dir),up=Math.abs(d[1])>0.9?[1,0,0]:[0,1,0],u=aaN3(aaCr3(d,up)),v=aaCr3(d,u);
  var grid=[];
  for(var ri=0;ri<=rings;ri++){var rr=R*ri/rings,y=depth*(rr/R)*(rr/R);var ring=[];
    for(var i=0;i<seg;i++){var a=i/seg*2*Math.PI,ca=Math.cos(a),sa=Math.sin(a);
      var px=u[0]*ca*rr+v[0]*sa*rr,py=u[1]*ca*rr+v[1]*sa*rr,pz=u[2]*ca*rr+v[2]*sa*rr;
      var nx=u[0]*ca+v[0]*sa,ny=u[1]*ca+v[1]*sa,nz=u[2]*ca+v[2]*sa;
      var sl=1+4*depth*depth*rr*rr/(R*R*R*R);var nl=Math.hypot(nx,ny,nz);
      var nn=aaN3([nx- d[0]*2*depth*rr/(R*R), ny- d[1]*2*depth*rr/(R*R), nz- d[2]*2*depth*rr/(R*R)]);
      ring.push(m.vtx(ctr[0]+px+d[0]*y,ctr[1]+py+d[1]*y,ctr[2]+pz+d[2]*y, nn[0],nn[1],nn[2], col));}
    grid.push(ring);}
  for(var ri=0;ri<rings;ri++)for(var i=0;i<seg;i++){var i2=(i+1)%seg;m.quad(grid[ri][i],grid[ri][i2],grid[ri+1][i2],grid[ri+1][i]);}
  /* 背面壳(2026-09-11 面消失修复):demo 渲染器无背面剔除,单面碟看着是闭合的;游戏 FrontSide 下从背面看碟面整体消失。
     背面 = 同网格沿法线偏 0.012 + 法线取反 + 绕向反转 → 碟面成正规薄壳双面体(任意视角实体)。 */
  var bgrid=[];
  for(var br=0;br<=rings;br++){var brr=R*br/rings,byy=depth*(brr/R)*(brr/R);var bring=[];
    for(var bi=0;bi<seg;bi++){var ba=bi/seg*2*Math.PI,bca=Math.cos(ba),bsa=Math.sin(ba);
      var bpx=u[0]*bca*brr+v[0]*bsa*brr,bpy=u[1]*bca*brr+v[1]*bsa*brr,bpz=u[2]*bca*brr+v[2]*bsa*brr;
      var bnx=u[0]*bca+v[0]*bsa,bny=u[1]*bca+v[1]*bsa,bnz=u[2]*bca+v[2]*bsa;
      var bnn=aaN3([bnx-d[0]*2*depth*brr/(R*R), bny-d[1]*2*depth*brr/(R*R), bnz-d[2]*2*depth*brr/(R*R)]);
      bring.push(m.vtx(ctr[0]+bpx+d[0]*byy-bnn[0]*0.012, ctr[1]+bpy+d[1]*byy-bnn[1]*0.012, ctr[2]+bpz+d[2]*byy-bnn[2]*0.012, -bnn[0],-bnn[1],-bnn[2], col));}
    bgrid.push(bring);}
  for(var br2=0;br2<rings;br2++)for(var bj=0;bj<seg;bj++){var bj2=(bj+1)%seg;m.quad(bgrid[br2][bj2],bgrid[br2][bj],bgrid[br2+1][bj],bgrid[br2+1][bj2]);}
  aaCylDir(m,[ctr[0]+d[0]*0.02,ctr[1]+d[1]*0.02,ctr[2]+d[2]*0.02],[-d[0],-d[1],-d[2]],R*0.22,0.22,10,colB);   // 背毂
  aaCylDir(m,[ctr[0]+d[0]*0.10,ctr[1]+d[1]*0.10,ctr[2]+d[2]*0.10],[d[0],d[1],d[2]],0.02,depth*1.8,6,colB);    // 馈源杆
  aaCylDir(m,[ctr[0]+d[0]*(depth*1.9),ctr[1]+d[1]*(depth*1.9),ctr[2]+d[2]*(depth*1.9)],[d[0],d[1],d[2]],0.05,0.08,8,colB);
}
function aaBoxRX(m,cx,cy,cz,sx,sy,sz,ang,col){   // 绕X轴旋转的盒(v0.6:贴斜面格栅)
  var ca=Math.cos(ang),sa=Math.sin(ang);
  function P(dx,dy,dz){var y=dy*ca-dz*sa,z=dy*sa+dz*ca;return [cx+dx,cy+y,cz+z];}
  var c=[P(-sx/2,-sy/2,-sz/2),P(sx/2,-sy/2,-sz/2),P(sx/2,sy/2,-sz/2),P(-sx/2,sy/2,-sz/2),
         P(-sx/2,-sy/2,sz/2),P(sx/2,-sy/2,sz/2),P(sx/2,sy/2,sz/2),P(-sx/2,sy/2,sz/2)];
  /* [2026-09-11 绕向修复] 旧 F 表六面绕向全部朝内:法线又由绕向叉积派生 → 法线/绕向"自洽地一起朝内",
     aaFlushMesh 的 i0 法线绕向自校正与顶点法线审计双双失灵 → 发动机隔栅(底板/百叶/压框)整组被 FrontSide 剔除不显示。
     翻转每个面的顶点序后:几何绕向=外、派生法线=外,自洽且正确。 */
  var F=[[3,2,1,0],[6,7,4,5],[2,6,5,1],[7,3,0,4],[7,6,2,3],[0,1,5,4]];
  for(var f=0;f<6;f++){var q=F[f];var n=aaN3(aaCr3(aaSub3(c[q[1]],c[q[0]]),aaSub3(c[q[2]],c[q[0]])));aaFace(m,[c[q[0]],c[q[1]],c[q[2]],c[q[3]]],n,col);}
}
var AA95_GREEN=[0.325,0.375,0.205], AA95_GREEN2=[0.285,0.335,0.185], AA95_DARK=[0.13,0.145,0.125],
    AA95_STEEL=[0.16,0.17,0.17], AA95_TRACK=[0.115,0.115,0.11], AA95_WHEEL=[0.24,0.27,0.16],
    AA95_HUB=[0.10,0.10,0.10], AA95_DISH=[0.62,0.62,0.55], AA95_BOX=[0.30,0.34,0.19],
    AA95_MSL=[0.34,0.38,0.22], AA95_GLASS=[0.05,0.06,0.07], AA95_METAL=[0.35,0.36,0.38], AA95_RUB=[0.145,0.155,0.145];
var AA95_TUR=[0,1.5925,-0.55];   // 炮塔环心(世界) 环心=1.28+0.3125(2026-09-11 车体降 R/4 后)
/* ---- RED_AA demo 颜色 → 游戏调色板映射(建模期按值键分组, 创建期填当前车漆引用) ---- */
var AA95_COLMAP = {};
function aaSetPGZPalette(cB, cA, cS, cD, cR, cGlD) {
  AA95_COLMAP = {};
  AA95_COLMAP[AA95_GREEN.join(',')] = cB;    // 车体主漆(迷彩身份)
  AA95_COLMAP[AA95_GREEN2.join(',')] = cA;   // 弱化件漆(迷彩身份)
  AA95_COLMAP[AA95_BOX.join(',')] = cA;
  AA95_COLMAP[AA95_DARK.join(',')] = cD;
  AA95_COLMAP[AA95_STEEL.join(',')] = cS;
  AA95_COLMAP[AA95_TRACK.join(',')] = cR;
  AA95_COLMAP[AA95_WHEEL.join(',')] = cR;
  AA95_COLMAP[AA95_HUB.join(',')] = cD;
  AA95_COLMAP[AA95_DISH.join(',')] = cS;
  AA95_COLMAP[AA95_MSL.join(',')] = cD;
  AA95_COLMAP[AA95_GLASS.join(',')] = cGlD;
  AA95_COLMAP[AA95_METAL.join(',')] = cS;
  AA95_COLMAP[AA95_RUB.join(',')] = cR;
}
/* AaMesh(显式法线网格) → 按顶点色分批 → finishGeo → visPartPush;绕向以显式法线强制正面(demo 无背面剔除) */
function aaFlushMesh(destArr, m, colmap, off) {
  var ox = off ? off[0] : 0, oy = off ? off[1] : 0, oz = off ? off[2] : 0;
  var batches = {}, keys = [], i, j;
  for (i = 0; i < m.idx.length; i += 3) {
    var i0 = m.idx[i], i1 = m.idx[i + 1], i2 = m.idx[i + 2];
    var ck = m.c[i0 * 3] + ',' + m.c[i0 * 3 + 1] + ',' + m.c[i0 * 3 + 2];
    if (!batches[ck]) { batches[ck] = { P: [], N: [] }; keys.push(ck); }
    var B = batches[ck];
    var ex = m.p[i1*3]-m.p[i0*3], ey = m.p[i1*3+1]-m.p[i0*3+1], ez = m.p[i1*3+2]-m.p[i0*3+2];
    var fx = m.p[i2*3]-m.p[i0*3], fy = m.p[i2*3+1]-m.p[i0*3+1], fz = m.p[i2*3+2]-m.p[i0*3+2];
    var gx = ey*fz-ez*fy, gy = ez*fx-ex*fz, gz = ex*fy-ey*fx;
    var flip = (gx*m.n[i0*3] + gy*m.n[i0*3+1] + gz*m.n[i0*3+2]) < 0;
    var ord = flip ? [i0, i2, i1] : [i0, i1, i2];
    for (j = 0; j < 3; j++) {
      var vi = ord[j];
      B.P.push(m.p[vi*3]+ox, m.p[vi*3+1]+oy, m.p[vi*3+2]+oz);
      B.N.push(m.n[vi*3], m.n[vi*3+1], m.n[vi*3+2]);
    }
  }
  for (i = 0; i < keys.length; i++) {
    var B2 = batches[keys[i]];
    visPartPush(destArr, colmap[keys[i]] || AA95_GREEN, finishGeo(B2.P, B2.N, null), 0, 0, 0);
  }
}
/* RED_AA 导弹导轨支架(静态件;裸弹体=动态件挂 gunPivot, 见 createTank AA rig, 与直升机多联装同机制) */
function aa95BuildMSLRail() {
  var m = new AaMesh();
  for (var b = -1; b <= 1; b += 2) {
    var y = b * 0.115;
    aaBox(m, 0, y - 0.085, 0.15, 0.05, 0.05, 0.70, AA95_GREEN2);   // 发射导轨(弹体下方)
  }
  aaBox(m, 0, -0.17, 0.15, 0.06, 0.46, 0.10, AA95_GREEN2);          // 支架立梁(下接摇架顶,上托双轨)
  return m;
}
function aa95BuildHull(){
  var m=new AaMesh();
  aaPrismX(m,[[3.355,0.955],[2.11,1.28],[-2.55,1.28],[-3.355,0.88],[-3.355,0.41],[-2.85,0.28],[2.75,0.28]],-1.12,1.12,AA95_GREEN);   // v0.5:首上斜面×1.6(倾角≈15°)
  aaBox(m, 1.36,0.955,-0.05,0.48,0.06,6.30,AA95_GREEN2); aaBox(m,-1.36,0.955,-0.05,0.48,0.06,6.30,AA95_GREEN2);   // 翼子板
  aaBox(m, 1.36,1.13, 2.15,0.42,0.30,1.05,AA95_BOX);    aaBox(m,-1.36,1.13, 2.15,0.42,0.30,1.05,AA95_BOX);        // 翼子板储物箱
  aaBox(m, 1.36,1.10,-2.55,0.42,0.24,0.90,AA95_BOX);    aaBox(m,-1.36,1.10,-2.55,0.42,0.24,0.90,AA95_BOX);
  aaBox(m,0,1.305,0.90,0.52,0.06,0.56,AA95_GREEN2);                                                       // 驾驶舱盖(v0.6中置+再后移)
  for(var i=0;i<3;i++)aaBox(m,-0.17+i*0.17,1.35,1.15,0.10,0.05,0.10,AA95_DARK);                            // 潜望镜
  var gA=0.2558, gNy=0.968, gNz=0.253, gDy=-0.253, gDz=0.968, gMy=1.1175, gMz=2.7325;   // 首上斜面法向/沿向/中点
  for(var sdx=-1;sdx<=1;sdx+=2){   // v0.7 项目口径:底板+七道纵向百叶+四边压框,全部与斜甲共面
    var gx=sdx*0.56;
    aaBoxRX(m,gx,gMy+gNy*0.0175,gMz+gNz*0.0175,0.95,0.035,1.05,gA,AA95_DARK);                 // 格栅底板(v0.11:坐于斜甲表面,外凸0.035)
    for(var lv=-3;lv<=3;lv++)
      aaBoxRX(m,gx+lv*0.105,gMy+gNy*0.044,gMz+gNz*0.044,0.055,0.018,0.98,gA,AA95_STEEL);      // 纵向百叶×7(底板顶面外凸)
    for(var ez=-1;ez<=1;ez+=2)
      aaBoxRX(m,gx,gMy+gNy*0.045+gDy*ez*0.49,gMz+gNz*0.045+gDz*ez*0.49,0.95,0.020,0.035,gA,AA95_STEEL);  // 横压框×2
    for(var ex=-1;ex<=1;ex+=2)
      aaBoxRX(m,gx+ex*0.4575,gMy+gNy*0.045,gMz+gNz*0.045,0.035,0.020,1.05,gA,AA95_STEEL);     // 纵压框×2
  }
  aaCylZ(m, 1.30,0.60,3.02,0.085,0.06,10,AA95_GLASS); aaCylZ(m,-1.30,0.60,3.02,0.085,0.06,10,AA95_GLASS);       // 前灯(贴新下斜面)
  aaBox(m, 0.9,0.67,3.10,0.10,0.16,0.10,AA95_STEEL); aaBox(m,-0.9,0.67,3.10,0.10,0.16,0.10,AA95_STEEL);         // 牵引钩(贴新下斜面)
  return m;
}
  /* ===== RED_AA 行走件(2026-09-11 重做):并入全车型公共管线(用户要求按其他履带车规格重做+动态效果) =====
     负重轮×6 = twinWheelSet(分片橡胶半盘+盘间轴+外轮盘+轴盖+螺栓圈+摆臂扭杆,转子自转/摆臂摆动 tag);
     前主动轮/后诱导轮 = twinEndWheel(59 式同构端轮,转子 tag);履带 = segTrackPlates(分段履带板,节距 0.185,滚动 tag)。
     物理:SUSP_SPEC.pgz95 + suspUpdate 逐轮独立积分(扭杆弹簧+非对称阻尼+地面罚力),履带路径 = trackLoopPGZ() 等长映射;
     滚动:_trackDifferential 差速(red suspKey 通道)→ 轮转 θ=滚动米/R、履带板沿环按米数行走(与 59/99/89/M1/M60 完全同源)。
     尺寸(2026-09-11 用户#3 修订):轮心 z=1.95−0.78w、y0.40、盘 R0.35、带外底 y0 贴地;
     trkX=1.42(履带/负重轮/端轮整体外移 0.06)、hullX=1.13 → trkX−hullX=0.29=全车型摆臂标定口径,臂尖正落轮轴心;
     负重轮/悬挂相对车体上调 R/4=0.0875 由「车体抬高 0.40→0.3125」等效实现(轮系世界位不动,履带保持贴地)。 */
  function aa95BuildRunningGear(bP, C) {
    var SP = SUSP_SPEC.pgz95;
    for (var sk = -1; sk <= 1; sk += 2) {
      twinWheelSet(bP, sk, { n: SP.n, wz: SP.wz, wy: SP.wy, rimR: SP.rimR, trkX: SP.trkX, hullX: SP.hullX, fdir: SP.fdir, pivY: SP.pivY }, C);
      twinEndWheel(bP, sk, { R: 0.30, y: 0.90, z: 2.72, trkX: SP.trkX, hullX: SP.hullX }, C);    // 前主动轮(驱动链轮端)
      twinEndWheel(bP, sk, { R: 0.30, y: 0.90, z: -2.82, trkX: SP.trkX, hullX: SP.hullX }, C);   // 后诱导轮(张紧端)
    }
    segTrackPlates(bP, { trkX: SP.trkX, plateW: 0.44, loopFn: trackLoopPGZ }, { dark: C.dark, steel: C.steel });   // 分段履带板(双侧一次成)
  }

function aa95BuildTurret(){
  var m=new AaMesh();   // 局部坐标:原点在炮塔环心
  aaPrismX(m,[[0.95,0.02],[0.78,0.55],[0.55,0.80],[-1.15,0.80],[-1.38,0.42],[-1.38,0.02]],-0.80,0.80,AA95_GREEN);   // 塔体(前/后倾甲)
  aaBox(m,0,0.83,-0.35,1.30,0.06,1.50,AA95_GREEN2);                                    // 顶盖平台
  for(var ts=-1;ts<=1;ts+=2){   // v0.7 炮转轴(耳轴):轴承环+圆柱journal,替代旧方块
    aaCylX(m,ts*0.815,0.42,-0.20,0.13,0.015,12,AA95_STEEL);
    aaCylX(m,ts*0.86,0.42,-0.20,0.07,0.05,10,AA95_STEEL);
  }
  aaCylY(m,0.34,0.88,-0.55,0.26,0.03,12,AA95_GREEN2);                                  // 车长舱盖
  aaCylY(m, 0.62,1.60,-1.15,0.011,0.80,5,AA95_DARK); aaCylY(m,-0.62,1.60,-1.15,0.011,0.80,5,AA95_DARK);          // 鞭天线
  aaBox(m, 0.62,0.82,-1.15,0.08,0.06,0.08,AA95_DARK); aaBox(m,-0.62,0.82,-1.15,0.08,0.06,0.08,AA95_DARK);
  return m;
}
function aa95BuildEO(){
  var m=new AaMesh();
  aaBox(m,0,0.50,0.86,0.62,0.34,0.26,AA95_GREEN2);                                     // 光电箱(塔前)
  aaBox(m,0,0.52,1.00,0.46,0.16,0.03,AA95_GLASS);                                     // 电视/红外窗
  aaBox(m,0.20,0.36,1.00,0.10,0.08,0.03,AA95_GLASS);                                  // 激光窗
  return m;
}
function aa95BuildGuns(){   // 单侧双联装,局部原点=耳轴
  var m=new AaMesh();
  aaBox(m,0,0,0.775,0.30,0.52,0.95,AA95_GREEN2);                                     // 摇架(v0.9:竖排双联,加高收窄)
  aaBox(m,0,-0.02,0.055,0.26,0.62,0.72,AA95_BOX);                                     // 弹箱
  for(var b=-1;b<=1;b+=2){
    var y=b*0.135;                                                              // v0.9:横排改竖排(上下两管)
    aaCylZ(m,0,y,1.225,0.055,0.35,10,AA95_STEEL);                                   // 复进套
    aaCylZ(m,0,y,2.475,0.032,1.15,10,AA95_DARK);                                    // 炮身
    aaCylZ(m,0,y,3.555,0.062,0.12,10,AA95_DARK);                                    // 消焰器
  }
  return m;
}
function aa95BuildRadar(){  // 局部原点=桅杆铰点
  var m=new AaMesh();
  aaBox(m,0,0.78,0,0.20,1.56,0.16,AA95_GREEN2);                                      // 桅杆
  aaBox(m,0,0.10,0,0.30,0.24,0.30,AA95_GREEN2);                                      // 铰座
  aaDish(m,[0,1.58,0.10],[0,0,1],0.52,0.16,18,5,AA95_DISH,AA95_GREEN2);                 // 抛物面(口朝+Z=车前)
  aaBox(m,0,1.10,0.02,0.06,0.5,0.05,AA95_GREEN2);
  return m;
}
/* ---- BLUE_AA: MB 构建器 + 参数表(demo 原样) ---- */
function AaMB(){ this.V=[]; this.F=[]; }
AaMB.prototype.v=function(x,y,z){ this.V.push([x,y,z]); return this.V.length-1; };
AaMB.prototype.f=function(idx,c,g){ this.F.push({i:idx,c:c,g:g||'body'}); };
AaMB.prototype.merge=function(o,tf){
  var b=this.V.length,i;
  for(i=0;i<o.V.length;i++){ var p=o.V[i]; if(tf) p=tf(p); this.V.push(p); }
  for(i=0;i<o.F.length;i++){ var F=o.F[i], a=new Array(F.i.length);
    for(var j=0;j<F.i.length;j++) a[j]=F.i[j]+b;
    this.F.push({i:a,c:F.c,g:F.g}); }
};
/* 长方体：中心 (cx,cy,cz) */
AaMB.prototype.box=function(cx,cy,cz,w,h,d,c,g){
  var x0=cx-w/2,x1=cx+w/2,y0=cy-h/2,y1=cy+h/2,z0=cz-d/2,z1=cz+d/2,i=this.V.length;
  var V=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  for(var q=0;q<8;q++) this.v(V[q][0],V[q][1],V[q][2]);
  this.f([i+0,i+1,i+2,i+3],c,g); this.f([i+5,i+4,i+7,i+6],c,g);
  this.f([i+4,i+0,i+3,i+7],c,g); this.f([i+1,i+5,i+6,i+2],c,g);
  this.f([i+3,i+2,i+6,i+7],c,g); this.f([i+4,i+5,i+1,i+0],c,g);
};
/* 沿 X 轴旋转的长方体：中心 (cx,cy,cz)，尺寸 (w,h,d)，绕 X 轴旋转 ang (rad) */
AaMB.prototype.boxRotX=function(cx,cy,cz,w,h,d,ang,c,g){
  var x0=cx-w/2,x1=cx+w/2,yh=h/2,zd=d/2;
  var cosA=Math.cos(ang),sinA=Math.sin(ang);
  function rot(y,z){return [cy+y*cosA-z*sinA,cz+y*sinA+z*cosA];}
  var p0=rot(-yh,-zd),p1=rot(yh,-zd),p2=rot(yh,zd),p3=rot(-yh,zd);
  var i=this.V.length;
  this.v(x0,p0[0],p0[1]);this.v(x1,p0[0],p0[1]);this.v(x1,p1[0],p1[1]);this.v(x0,p1[0],p1[1]);
  this.v(x0,p3[0],p3[1]);this.v(x1,p3[0],p3[1]);this.v(x1,p2[0],p2[1]);this.v(x0,p2[0],p2[1]);
  this.f([i+0,i+1,i+2,i+3],c,g);this.f([i+5,i+4,i+7,i+6],c,g);
  this.f([i+4,i+0,i+3,i+7],c,g);this.f([i+1,i+5,i+6,i+2],c,g);
  this.f([i+3,i+2,i+6,i+7],c,g);this.f([i+4,i+5,i+1,i+0],c,g);
};
/* 楔形块（前后高度/宽度可不同，用于炮塔） */
AaMB.prototype.wedge=function(cx,cy,cz,w0,w1,h,d,c,g){ /* w0=后宽 w1=前宽 */
  var x0=cx-w0/2,x0b=cx-w1/2,x1=cx+w0/2,x1b=cx+w1/2,y0=cy-h/2,y1=cy+h/2,z0=cz-d/2,z1=cz+d/2,i=this.V.length;
  this.v(x0,y0,z0);this.v(x1,y0,z0);this.v(x1,y1,z0);this.v(x0,y1,z0);
  this.v(x0b,y0,z1);this.v(x1b,y0,z1);this.v(x1b,y1,z1);this.v(x0b,y1,z1);
  this.f([i+0,i+1,i+2,i+3],c,g); this.f([i+5,i+4,i+7,i+6],c,g);
  this.f([i+4,i+0,i+3,i+7],c,g); this.f([i+1,i+5,i+6,i+2],c,g);
  this.f([i+3,i+2,i+6,i+7],c,g); this.f([i+4,i+5,i+1,i+0],c,g);
};
/* 沿 X 轴的圆柱/圆锥（轮、轴、筒） */
AaMB.prototype.cylX=function(cx,cy,cz,r,len,seg,c,g,r2){
  r2=(r2==null)?r:r2; var n=this.V.length,i,a;
  for(i=0;i<seg;i++){a=i/seg*6.283185307;this.v(cx-len/2,cy+r*Math.sin(a),cz+r*Math.cos(a));}
  for(i=0;i<seg;i++){a=i/seg*6.283185307;this.v(cx+len/2,cy+r2*Math.sin(a),cz+r2*Math.cos(a));}
  for(i=0;i<seg;i++){var j=(i+1)%seg;this.f([n+i,n+j,n+seg+j,n+seg+i],c,g);}
  var A=this.v(cx-len/2,cy,cz),B=this.v(cx+len/2,cy,cz);
  for(i=0;i<seg;i++){var j=(i+1)%seg;this.f([A,n+j,n+i],c,g);this.f([B,n+seg+i,n+seg+j],c,g);}
};
/* 沿 Y 轴的圆柱（桅杆、烟幕筒、导弹） */
AaMB.prototype.cylY=function(cx,cy,cz,r,h,seg,c,g,r2){
  r2=(r2==null)?r:r2; var n=this.V.length,i,a;
  for(i=0;i<seg;i++){a=i/seg*6.283185307;this.v(cx+r*Math.sin(a),cy,cz+r*Math.cos(a));}
  for(i=0;i<seg;i++){a=i/seg*6.283185307;this.v(cx+r2*Math.sin(a),cy+h,cz+r2*Math.cos(a));}
  /* 注意：cylY 的侧面若按 cylX 的写法会朝外，与端盖相反，这里已在实测后反绕 */
  for(i=0;i<seg;i++){var j=(i+1)%seg;this.f([n+i,n+seg+i,n+seg+j,n+j],c,g);}
  var A=this.v(cx,cy,cz),B=this.v(cx,cy+h,cz);
  for(i=0;i<seg;i++){var j=(i+1)%seg;this.f([A,n+i,n+j],c,g);this.f([B,n+seg+j,n+seg+i],c,g);}
};
/* 沿 Z 轴的圆柱（炮管、发射箱） */
AaMB.prototype.cylZ=function(cx,cy,cz,r,len,seg,c,g,r2){
  r2=(r2==null)?r:r2; var n=this.V.length,i,a;
  for(i=0;i<seg;i++){a=i/seg*6.283185307;this.v(cx+r*Math.sin(a),cy+r*Math.cos(a),cz);}
  for(i=0;i<seg;i++){a=i/seg*6.283185307;this.v(cx+r2*Math.sin(a),cy+r2*Math.cos(a),cz+len);}
  for(i=0;i<seg;i++){var j=(i+1)%seg;this.f([n+i,n+j,n+seg+j,n+seg+i],c,g);}
  var A=this.v(cx,cy,cz),B=this.v(cx,cy,cz+len);
  for(i=0;i<seg;i++){var j=(i+1)%seg;this.f([A,n+j,n+i],c,g);this.f([B,n+seg+i,n+seg+j],c,g);}
};
/* 纵向放样：车体
   每站 8 点（下窄上宽，含履带上方裙板外张） */
AaMB.prototype.loft=function(st,c,g){
  var rings=[],s,k;
  for(s=0;s<st.length;s++){ var S=st[s],r=[];
    r.push(this.v( S.hb,S.yb,S.z)); r.push(this.v( S.hb,S.yf,S.z)); r.push(this.v( S.hf,S.yf,S.z)); r.push(this.v( S.hf,S.yt,S.z));
    r.push(this.v(-S.hf,S.yt,S.z)); r.push(this.v(-S.hf,S.yf,S.z)); r.push(this.v(-S.hb,S.yf,S.z)); r.push(this.v(-S.hb,S.yb,S.z));
    rings.push(r); }
  for(s=0;s<rings.length-1;s++){ var A=rings[s],B=rings[s+1];
    for(k=0;k<8;k++){var k2=(k+1)%8; this.f([A[k],A[k2],B[k2],B[k]],c,g);} }
  /* 端盖：断面是“下窄上宽”的凸台形。
     (1) 不能用单一扇三角化：断面在下台肩处是凹点，扇三角会在下角外侧溢出；
     (2) hb==hf 时前三点共线，法线退化为零，端盖会被误剔除。
     这里按上下两个矩形（下部 ±hb / 上部 ±hf）拆成两块。矩形是凸的，
     法线就等于真实朝向(+z)，所以要反绕一下才与侧板同向（侧板统一朝内），
     再交由 buildModel 末尾的统一反绕一次性变成朝外。 */
  var capq=function(r){ return [[r[0],r[1],r[6],r[7]],[r[2],r[3],r[4],r[5]]]; };
  var q1=capq(rings[0]), q2=capq(rings[rings.length-1]);
  for(k=0;k<2;k++){ this.f(q1[k].slice().reverse(),c,g); this.f(q2[k],c,g); }
};
/* 沿 X 挤出一条闭合回路（ZY 平面）：做履带 */
AaMB.prototype.loopX=function(loop,x0,x1,c,g){
  var n=loop.length,b=this.V.length,s,k;
  for(s=0;s<2;s++){ var x=(s?x1:x0); for(k=0;k<n;k++) this.v(x,loop[k][1],loop[k][0]); }
  for(k=0;k<n;k++){ var k2=(k+1)%n; this.f([b+k,b+k2,b+n+k2,b+n+k],c,g); }
};

/* ---- 变换工具：返回点变换函数 ---- */
function aaTTrans(dx,dy,dz){ return function(p){ return [p[0]+dx,p[1]+dy,p[2]+dz]; }; }
function aaTRotXc(a,cy,cz){ var c=Math.cos(a),s=Math.sin(a);   // 绕 X 轴(过 cy,cz)旋转：用于火炮俯仰
  return function(p){ var y=p[1]-cy,z=p[2]-cz; return [p[0], cy+y*c-z*s, cz+y*s+z*c]; }; }
function aaTSeq(){ var a=arguments; return function(p){ for(var i=0;i<a.length;i++) p=a[i](p); return p; }; }
var AAV_PDEF = {
  // ——— 公开数据（多源一致）———
  vehL:      4.95,   // 全长 m
  vehW:      2.18,   // 全宽 m（后视镜折起）
  vehH:      2.64,   // 全高 m（行军状态、发射箱 0°）
  wheelBase: 3.30,   // 轴距 m
  track:     1.82,   // 轮距 m
  tireR:     0.465,  // 轮胎自由半径 = 37 in × 25.4 / 2
  tireW:     0.315,  // 轮胎断面宽 = 12.4 in
  gcTread:   0.406,  // 最小离地间隙 16 in（差速器壳体处）
  tubeLen:   1.52,   // 防空导弹发射管长（弹体含助推器 1.52 m）
  // ——— 推定（无公开数据，需对照照片校正）———
  axleF:     1.70,   // 前轴纵向位置（轮距 3.30 → 后轴 -1.60）
  bodyBot:   0.55,   // 车体底缘高
  hoodTop:   1.12,   // 发动机罩顶高
  cabRoof:   1.78,   // 驾驶室顶高
  wsZ0:      1.02,   // 风挡下沿 z
  wsZ1:      0.62,   // 风挡上沿 z
  deckTop:   1.20,   // 后甲板高（炮塔座圈面）
  deckZ0:   -0.40,   // 后甲板前缘
  deckZ1:   -2.10,   // 后甲板后缘（之后收尾）
  turZ:     -1.15,   // 炮塔回旋中心 z
  turW:      1.10,   // 炮塔舱室宽
  turL:      1.45,   // 炮塔舱室长
  turBot:    1.40,   // 炮塔舱室底
  turRoof:   2.30,   // 炮塔舱室顶（其上是 IFF 天线，顶到 2.64）
  podX:      0.72,   // 发射箱横向中心
  podY:      2.00,   // 发射箱轴心高
  podLen:    1.70,   // 发射箱全长
  podSec:    0.34,   // 发射箱截面边长（2×2 四联）
  tubeR:     0.053   // 发射管外半径（弹径 70 mm）
};
var AAV_P = {}; for (var _avK in AAV_PDEF) AAV_P[_avK] = AAV_PDEF[_avK];
/* BLUE_AA配色 → 游戏调色板(创建期填当前车漆引用; body/tur=迷彩身份主漆, 附件=弱化漆) */
var AAV_C = {};
/* BLUE_AA车轮规格(2026-09-11:悍马 37×12.5in 单胎;与 _trackDifferential 轮周长取模/差速同源):
   R0.465 = demo P.tireR,轮心 x = ±track/2 = ±0.91,tw 0.315 = P.tireW(12.4in 断面宽)。 */
var AV_WHEEL_SPEC = { R: 0.465, wx: 0.91, tw: 0.315, rimR: 0.215, hubR: 0.12 };
var AV_WHEEL_CIRC = 2 * Math.PI * 0.465;   // 轮周长(滚动米数取模周期)
function aaSetAvengerPalette(cB, cA, cS, cD, cR, cGl, cGlD) {
  AAV_C.body = cB; AAV_C.bodyTop = cB; AAV_C.bodyLow = cA;
  AAV_C.glass = cGlD; AAV_C.grille = cD; AAV_C.lamp = cGl;
  AAV_C.tire = cR; AAV_C.hub = cS;
  AAV_C.tur = cB; AAV_C.turTop = cA;
  AAV_C.pod = cA; AAV_C.tube = cS; AAV_C.tubeTip = cD;
  AAV_C.sensor = cD; AAV_C.iff = cA; AAV_C.beam = cS;
}
/* AaMB(demo MB) → 统一反绕一次(demo buildModel 口径: 图元面朝内生成) → 按(组,色)分批 → finishGeo → visPartPush */
function aaFlushMB(destMap, M) {
  var i, j;
  for (i = 0; i < M.F.length; i++) M.F[i].i.reverse();
  var batches = {}, keys = [];
  for (i = 0; i < M.F.length; i++) {
    var F = M.F[i], dest = destMap[F.g];
    if (!dest) continue;
    var ck = F.g + '|' + F.c.join(',');
    if (!batches[ck]) { batches[ck] = { dest: dest, col: F.c, P: [], N: [] }; keys.push(ck); }
    var B = batches[ck], V = M.V, ix = F.i;
    for (j = 1; j < ix.length - 1; j++) {
      var a = V[ix[0]], b = V[ix[j]], c = V[ix[j + 1]];
      var ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
      var nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
      var L=Math.sqrt(nx*nx+ny*ny+nz*nz)||1; nx/=L;ny/=L;nz/=L;
      var t3=[a,b,c];
      for (var q=0;q<3;q++){ B.P.push(t3[q][0],t3[q][1],t3[q][2]); B.N.push(nx,ny,nz); }
    }
  }
  for (i = 0; i < keys.length; i++) {
    var B2 = batches[keys[i]];
    visPartPush(B2.dest, B2.col, finishGeo(B2.P, B2.N, null), 0, 0, 0);
  }
}
function avBuildBody(M,P){
  var HL=P.vehL/2, HW=P.vehW/2, i, s;

  /* —— 引擎罩段：车头 → 风挡下沿 (内凹轮拱扣除前轮部分，彻底杜绝车体轮子穿模) —— */
  M.loft([
    {z: HL,      yb:P.bodyBot+0.26, yf:P.hoodTop-0.10, yt:P.hoodTop-0.06, hb:0.84*HW, hf:0.90*HW},
    {z: 2.25,    yb:P.bodyBot+0.08, yf:P.hoodTop-0.04, yt:P.hoodTop-0.01, hb:0.97*HW, hf:0.99*HW},
    {z: 2.20,    yb:P.bodyBot,      yf:0.98,          yt:P.hoodTop,      hb:0.68,    hf:HW},
    {z: P.axleF, yb:P.bodyBot,      yf:0.98,          yt:P.hoodTop,      hb:0.68,    hf:HW},
    {z: 1.20,    yb:P.bodyBot,      yf:0.98,          yt:P.hoodTop,      hb:0.68,    hf:HW},
    {z: 1.15,    yb:P.bodyBot,      yf:P.hoodTop-0.04, yt:P.hoodTop,      hb:0.97*HW, hf:HW},
    {z: P.wsZ0,  yb:P.bodyBot,      yf:P.hoodTop-0.04, yt:P.hoodTop,      hb:0.97*HW, hf:HW}
  ], AAV_C.body, 'body');

  /* —— 车门/门槛段：引擎罩与后甲板之间、腰带线以下的车身下部。
     这一段原先漏建，导致车身中段 y<hoodTop 是个贯通的洞，
     从侧面能直接看穿车底，且引擎罩后端盖/甲板前端盖会从洞里露出来。
     z 向两端各外伸 2 cm 压进前后两段里，避免端盖共面闪烁。 */
  M.loft([
    {z: P.wsZ0+0.02,   yb:P.bodyBot, yf:P.hoodTop-0.05, yt:P.hoodTop+0.03, hb:0.97*HW, hf:0.995*HW},
    {z: P.deckZ0-0.02, yb:P.bodyBot, yf:P.hoodTop-0.05, yt:P.hoodTop+0.03, hb:0.97*HW, hf:0.995*HW}
  ], AAV_C.body, 'body');

  /* —— 驾驶室段：风挡（斜面）+ 侧窗 + 平顶 ——
     驾驶室必须是**连续实体**，三站放样从风挡下沿一直包到驾驶室后端；
     不能把 wsZ0…wsZ1 挖成窗洞（那样驾驶室就成了「方盒子 + 一块斜玻璃」的空架子）。
     原先玻璃只盖住窗框上半截，根因是这一站的上沿 yt 取了 hoodTop+0.06，
     斜面上表面比玻璃下沿高 6 cm，把玻璃下沿挡住了。
     现在把第一站压薄、令其上沿正好等于 hoodTop：
     放样出来的斜面上表面 = 风挡玻璃的中心面，玻璃再沿法线外移 2.5 cm 即完全可见。 */
  M.loft([
    {z: P.wsZ0,      yb:P.hoodTop-0.10, yf:P.hoodTop-0.06, yt:P.hoodTop,      hb:0.94*HW, hf:0.99*HW},
    {z: P.wsZ1,      yb:P.hoodTop,      yf:P.cabRoof-0.10, yt:P.cabRoof,      hb:0.94*HW, hf:0.99*HW},
    {z: P.deckZ0,    yb:P.hoodTop,      yf:P.cabRoof-0.10, yt:P.cabRoof,      hb:0.94*HW, hf:0.99*HW}
  ], AAV_C.body, 'body');
  /* 车顶板前伸 0.06 m，把 A 柱顶端压住，避免柱头露出车顶面前方 */
  M.box(0, P.cabRoof+0.03, (P.wsZ1+P.deckZ0)/2+0.02, 1.92, 0.06, (P.wsZ1-P.deckZ0)+0.06, AAV_C.bodyTop, 'body');

  /* —— 后甲板段：承炮塔 (内凹轮拱扣除后轮部分，彻底杜绝车体轮子穿模) —— */
  M.loft([
    {z: P.deckZ0,            yb:P.bodyBot,      yf:P.deckTop-0.06, yt:P.deckTop,      hb:0.97*HW, hf:HW},
    {z: -1.06,               yb:P.bodyBot,      yf:P.deckTop-0.06, yt:P.deckTop,      hb:0.97*HW, hf:HW},
    {z: -1.10,               yb:P.bodyBot,      yf:0.98,          yt:P.deckTop,      hb:0.68,    hf:HW},
    {z: P.axleF-P.wheelBase, yb:P.bodyBot,      yf:0.98,          yt:P.deckTop,      hb:0.68,    hf:HW},
    {z: -2.10,               yb:P.bodyBot,      yf:0.98,          yt:P.deckTop,      hb:0.68,    hf:HW},
    {z: -2.14,               yb:P.bodyBot,      yf:P.deckTop-0.06, yt:P.deckTop,      hb:0.97*HW, hf:HW},
    {z:-HL+0.22,             yb:P.bodyBot+0.06, yf:P.deckTop-0.07, yt:P.deckTop-0.02, hb:0.96*HW, hf:0.99*HW},
    {z:-HL,                  yb:P.bodyBot+0.24, yf:P.deckTop-0.10, yt:P.deckTop-0.06, hb:0.86*HW, hf:0.90*HW}
  ], AAV_C.body, 'body');

  /* The wheel-area guard is intentionally omitted from the fender silhouette. */

  /* —— 前格栅 / 大灯 / 保险杠 —— */
  /* 前端各件一律不越过 z=HL，否则全长会超出公开的 4.95 m */
  M.box(0, P.hoodTop-0.34, HL-0.030, 0.86, 0.30, 0.05, AAV_C.grille, 'body');
  for(i=0;i<5;i++) M.box(0, P.hoodTop-0.50+i*0.09, HL-0.035, 0.82, 0.05, 0.02, AAV_C.bodyLow, 'body');
  M.box(-0.72, P.hoodTop-0.30, HL-0.035, 0.20, 0.16, 0.06, AAV_C.lamp, 'body');
  M.box( 0.72, P.hoodTop-0.30, HL-0.035, 0.20, 0.16, 0.06, AAV_C.lamp, 'body');
  M.box(0, P.bodyBot+0.02, HL-0.050, 1.90, 0.14, 0.10, AAV_C.bodyLow, 'body');

  /* —— 风挡玻璃：一整块铺满窗框（下沿 hoodTop → 上沿 cabRoof），倾角随参数自动算 ——
        cy=+0.025：沿斜面法线外移 2.5 cm，整块玻璃浮在车身上表面之外，完全可见；
        cz=+0.025、长 L+0.05：下端沿斜面多伸 5 cm 埋进引擎罩、上端埋进车顶板，两端不露缝；
        宽 1.90 m：两端各压进 A 柱 3.5 cm。 */
  var dzz=P.wsZ0-P.wsZ1, dyy=P.cabRoof-P.hoodTop, L=Math.sqrt(dzz*dzz+dyy*dyy);
  var ang=Math.atan2(dyy,dzz);
  var g=new AaMB();
  g.box(0, 0.025, 0.025, 1.90, 0.035, L+0.05, AAV_C.glass, 'glass');

  /* —— 前风挡装饰性防护网 (参考 RED_MLRS 风窗防护网规范) —— */
  // 边框与双分割中柱
  g.box(0, 0.048, 0.025 + (L + 0.05) / 2 - 0.02, 1.76, 0.024, 0.03, AAV_C.bodyLow, 'body');
  g.box(0, 0.048, 0.025 - (L + 0.05) / 2 + 0.02, 1.76, 0.024, 0.03, AAV_C.bodyLow, 'body');
  g.box(-0.88, 0.048, 0.025, 0.03, 0.024, L + 0.05, AAV_C.bodyLow, 'body');
  g.box( 0.88, 0.048, 0.025, 0.03, 0.024, L + 0.05, AAV_C.bodyLow, 'body');
  g.box( 0.00, 0.048, 0.025, 0.03, 0.024, L + 0.05, AAV_C.bodyLow, 'body');
  // 前风挡防护网竖条×11
  for (var fgk = 0; fgk < 11; fgk++) {
    var fgx = -0.75 + fgk * 0.15;
    if (Math.abs(fgx) < 0.04) continue;
    g.box(fgx, 0.048, 0.025, 0.016, 0.016, L + 0.02, AAV_C.beam, 'body');
  }
  // 前风挡防护网横条×3
  for (var fgk2 = 0; fgk2 < 3; fgk2++) {
    var fgz = 0.025 + [-0.22, 0, 0.22][fgk2];
    g.box(0, 0.048, fgz, 1.72, 0.016, 0.016, AAV_C.beam, 'body');
  }

  M.merge(g, aaTSeq(aaTRotXc(ang,0,0),
                   aaTTrans(0,(P.hoodTop+P.cabRoof)/2,(P.wsZ0+P.wsZ1)/2)));
  /* —— A 柱：风挡两侧立柱，与玻璃同倾角、左右各一片，厚 0.11 → 比玻璃外凸 5 cm 形成窗框；
        外侧 1.075 m 与车身侧面(1.079)齐平，下端埋进引擎罩、上端被车顶板压住 —— */
  var ga=new AaMB();
  for(s=-1;s<=1;s+=2) ga.box(s*(HW-0.095), 0.04, 0.025, 0.16, 0.11, L+0.05, AAV_C.body, 'body');
  M.merge(ga, aaTSeq(aaTRotXc(ang,0,0),
                    aaTTrans(0,(P.hoodTop+P.cabRoof)/2,(P.wsZ0+P.wsZ1)/2)));

  /* —— 侧窗 / 窗框连接车体实体 / 侧窗装饰性防护网 (左右两侧，参考 RED_MLRS) / 后视镜 —— */
  var winX = 0.94 * HW;
  var winY = (P.hoodTop + P.cabRoof) / 2 + 0.04;
  var winZ = (P.wsZ1 + P.deckZ0) / 2;
  var winL = (P.wsZ1 - P.deckZ0) * 0.70;
  var winH = 0.38;
  for(s = -1; s <= 1; s += 2) {
    // 侧窗门框与B/C柱结构件：紧密嵌合车身实体，使车窗牢固连接车体
    M.box(s * (winX + 0.014), winY, winZ, 0.036, winH + 0.08, winL + 0.08, AAV_C.bodyLow, 'body');
    // 侧窗玻璃：嵌入窗框内部，杜绝悬空
    M.box(s * (winX + 0.020), winY, winZ, 0.024, winH, winL, AAV_C.glass, 'glass');

    // 侧窗防护网边框 (参考 RED_MLRS 侧窗防护网)
    M.box(s * (winX + 0.036), winY + winH / 2, winZ, 0.022, 0.025, winL, AAV_C.bodyLow, 'body');
    M.box(s * (winX + 0.036), winY - winH / 2, winZ, 0.022, 0.025, winL, AAV_C.bodyLow, 'body');
    M.box(s * (winX + 0.036), winY, winZ + winL / 2, 0.022, winH, 0.025, AAV_C.bodyLow, 'body');
    M.box(s * (winX + 0.036), winY, winZ - winL / 2, 0.022, winH, 0.025, AAV_C.bodyLow, 'body');

    // 侧窗防护网竖条×5 (参考 RED_MLRS 侧窗防护网)
    for (var swk1 = 0; swk1 < 5; swk1++) {
      var swz = (winZ - winL / 2 + 0.08) + swk1 * ((winL - 0.16) / 4);
      M.box(s * (winX + 0.036), winY, swz, 0.016, winH - 0.02, 0.016, AAV_C.beam, 'body');
    }
    // 侧窗防护网横条×3 (参考 RED_MLRS 侧窗防护网)
    for (var swk2 = 0; swk2 < 3; swk2++) {
      var swy = (winY - winH / 2 + 0.08) + swk2 * ((winH - 0.16) / 2);
      M.box(s * (winX + 0.036), swy, winZ, 0.016, 0.016, winL - 0.02, AAV_C.beam, 'body');
    }

    // 后视镜
    M.box(s * (HW - 0.04), P.hoodTop + 0.14, P.wsZ1 - 0.06, 0.08, 0.13, 0.05, AAV_C.bodyLow, 'body');
  }
}
function avBuildWheels(M,P){
  var i, x, z;
  var zs=[P.axleF, P.axleF-P.wheelBase];

  /* —— 轮轴：轮心 → 半轴 → 中央差速器壳 → 插进车底 ——
     悍马是独立悬挂 + 齿轮边减（portal hub），严格说半轴带万向节且不等长，
     这里简化成「水平半轴 + 中央差速器壳」。
     尺寸取法不是随手定的：官方给的 16 in（0.406 m）最小离地间隙，注明的
     测量点就是差速器壳体，所以令壳心 y=0.51、半径 0.104 → 壳底正好 0.406 m；
     壳顶 0.614 m 又高于车底 0.55 m，于是轴壳插进车身底部，
     轮子和底盘在几何上真正连成一体（而不是四个悬空的轮子）。
     半轴半径 0.05 → 底面 0.415 m，不会比差速器壳更低、也不破坏离地间隙。 */
  for(i=0;i<2;i++){
    z=zs[i];
    M.cylX(0, 0.51, z, 0.104, 0.30, 12, AAV_C.hub, 'wheel');          // 中央差速器壳
  }
  /* 纵向传动轴：分动箱 → 前/后差速器，贯通两轴之间（z −1.65…+1.70）。
     这一段正好落在两个轮子之间的空档里，轮胎挡不到，是车外唯一能直接看见
     「轮子—底盘」连接关系的地方；半轴本身与轮胎同心，从侧面必然被轮胎遮住。
     半径 0.055 → 底面 0.455 m，仍高于差速器壳的 0.406 m，不破坏离地间隙。 */
  M.cylZ(0, 0.51, zs[1], 0.055, P.wheelBase+0.05, 10, AAV_C.hub, 'wheel');
  for(i=0;i<2;i++) for(x=-1;x<=1;x+=2){
    z=zs[i];
    /* 轮胎/钢圈/轮毂已移出 MB → groupPartsBLUE_AA 用 artyWheel 建独立转子件(模式18 tag 随速自转;
       12 段仍保证 270° 顶点存在,轮胎最低点贴地口径不变;2026-09-11) */
    /* 半轴：差速器壳端(±0.15) → 轮心(±0.91)(静态) */
    M.cylX(x*0.53, P.tireR, z, 0.05, 0.76, 10, AAV_C.hub, 'wheel');
  }
}
function avBuildPod(M, P) {
  var s = P.podSec, L = P.podLen, r = P.tubeR, i, j, d = s * 0.23;
  // 导弹舱往后移动 0.60m，转轴位置保持不变，使转轴精准位于导弹舱中后部 (距舱尾 37.5%，完全符合实车安装比例)
  var podOffsetZ = -0.60;
  var boxCenterZ = L / 2 - 0.05 + podOffsetZ;
  var boxLen = L - 0.10;
  M.box(0, 0, boxCenterZ, s, s, boxLen, AAV_C.pod, 'pod');
  for (i = 0; i < 2; i++) for (j = 0; j < 2; j++) {
    var dx = (i ? d : -d), dy = (j ? d : -d);
    var tubeZ = 0.02 + podOffsetZ;
    M.cylZ(dx, dy, tubeZ, r, P.tubeLen, 8, AAV_C.tube, 'pod');                  // 发射管
    M.cylZ(dx, dy, tubeZ + P.tubeLen, r * 0.55, 0.13, 6, AAV_C.tubeTip, 'pod'); // 管口
  }
}
/* BLUE_AA炮塔(游戏版): 局部原点=座圈中心/甲板上表面; 去掉 demo 的发射箱合并与方位/俯仰烘焙
   (游戏中 turret/gunPivot 节点承担动态姿态; 发射箱单独建入 gunParts, 见下) */
function avBuildTurret(M, P) {
  var T = new AaMB(), side;
  var y0 = function (w) { return w - P.deckTop; };
  var turH = y0(P.turRoof) - y0(P.turBot);
  T.cylY(0, 0, 0, 0.52, y0(P.turBot), 14, AAV_C.tur, 'turret');                       // 座圈
  // 舱室显著向前收束：后宽 1.10m，前宽 0.62m (收束率约 44%，符合BLUE_AA实车梯形炮塔外形)
  T.wedge(0, (y0(P.turBot) + y0(P.turRoof)) / 2, 0, P.turW, P.turW * 0.56,
          turH, P.turL, AAV_C.tur, 'turret');
  // 舱顶同样向前收束契合舱室侧板 (后宽 1.02m，前宽 0.52m)
  T.wedge(0, y0(P.turRoof) + 0.03, -0.02, P.turW * 0.92, P.turW * 0.50,
          0.06, P.turL * 0.88, AAV_C.turTop, 'turret');
  // 观察前窗 (贴合收束的前脸)
  T.box(0, y0(P.turRoof) - 0.34, P.turL * 0.44, 0.46, 0.30, 0.05, AAV_C.glass, 'glass');
  // The turret sides use the clean armor silhouette.
  T.box(0, y0(P.turRoof) - 0.10, P.turL * 0.5 + 0.11, 0.44, 0.24, 0.24, AAV_C.sensor, 'sensor');      // FLIR 光电头
  T.cylZ(-0.13, y0(P.turRoof) - 0.10, P.turL * 0.5 + 0.24, 0.055, 0.04, 8, AAV_C.glass, 'sensor');
  T.cylZ( 0.13, y0(P.turRoof) - 0.10, P.turL * 0.5 + 0.24, 0.055, 0.04, 8, AAV_C.glass, 'sensor');
  T.cylZ( 0.00, y0(P.turRoof) - 0.20, P.turL * 0.5 + 0.24, 0.04, 0.04, 8, AAV_C.glass, 'sensor');
  T.box(0, y0(P.turRoof) + 0.17, -P.turL * 0.28, 0.38, 0.34, 0.05, AAV_C.iff, 'sensor');              // IFF 天线
  for (side = -1; side <= 1; side += 2) {                                                              // 两侧发射梁 (对齐转轴 z=-0.30)
    T.box(side * (P.turW * 0.42 + (P.podX - P.turW * 0.42) / 2), y0(P.podY) - 0.10, -0.30,
          (P.podX - P.turW * 0.42), 0.13, 0.32, AAV_C.beam, 'turret');
  }
  M.merge(T, null);
}
/* AA 发射点表(gunPivot 局部; 索引=side×每侧筒数+tubeIdx, 与 _heliMslTube 消耗序一致): 发射点=导弹弹头建模中心 */
var AA95_MSL_ORDER = [[-1.02, 0.435, 1.42], [-1.02, 0.665, 1.42], [1.02, 0.435, 1.42], [1.02, 0.665, 1.42]];   // 防空导弹: 耳轴±1.02/挂点 y0.55±0.115/弹头 z=0.42+1.005≈1.42
var AVENGER_MSL_ORDER = (function () {   // 管口弹头中心随导弹舱后移 0.60m 至 z=1.00 (管口 1.07), 管心 ±0.0782(2×2)
  var d = 0.34 * 0.23, o = [];
  for (var s = -1; s <= 1; s += 2) for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++)
    o.push([s * 0.72 + (i ? d : -d), (j ? d : -d), 1.00]);
  return o;
})();
var _aaAvNoseGeo = null;
function aaAvNoseGeo() {   // BLUE_AA管口弹头视觉件(防空导弹 贮藏在发射管内, 仅弹头帽露出管口; 发射即从管口消失)
  if (_aaAvNoseGeo) return _aaAvNoseGeo;
  var g = new THREE.CylinderGeometry(0.030, 0.050, 0.20, 8);
  g.rotateX(Math.PI / 2);
  _aaAvNoseGeo = g;
  return g;
}

function createTank(o) {
  var isP = !!o.isPlayer;
  var team = o.team || (isP ? 'red' : 'blue');
  var kind = o.kind || 'tank';                                   // 'td' 是阵营专属槽:红=RED_TD旋转重炮塔,蓝=BLUE_MBT_2主战坦克
  var m1Platform = kind === 'td' && team === 'blue';
  var C = team === 'red' ? CONF.red : CONF.blue;       // 玩家与 AI 同平台同数值,无主角光环
  if (kind === 'arty') {                                         // 火箭炮:皮薄、远程曲射、齐射锁定(红=RED_MLRS,蓝=BLUE_MLRS)
    var AC = team === 'blue' ? CONF.artyE : CONF.arty;
    C = { struct: AC.struct, pen: AC.pen, dmg: AC.dmg, reload: AC.reload, speed: AC.speed, shellSpeed: CONF.shellSpeedE,   // pen=火箭弹直击穿深(旧硬编码0=穿深管线一旦启用将一发不穿的隐患,改读规格)
          turn: AC.turn, turretRate: AC.turretRate, accel: AC.accel, decel: AC.decel, mob: AC.mob,
          color: team === 'red' ? CONF.red.color : CONF.blue.color,
          hullArmor:   { front: 24, side: 15, rear: 12, top: 10, bottom: 10 },
          turretArmor: { front: 16, side: 12, rear: 10, top: 8 } };
  } else if (kind === 'aa') {                                        // 防空载具:红 RED_AA(机炮=直升机机炮规格)/蓝 BLUE_AA(纯导弹,机炮字段占位)
    var AA = team === 'blue' ? CONF.aaE : CONF.aa;
    C = { struct: AA.struct, pen: AA.pen, penKd: AA.penKd, dmg: AA.dmg, reload: AA.reload, speed: AA.speed, shellSpeed: AA.shellSpeed,
          turn: AA.turn, turretRate: AA.turretRate, accel: AA.accel, decel: AA.decel, color: C.color, mob: AA.mob,
          hullArmor: AA.hullArmor, turretArmor: AA.turretArmor };
  } else if (kind === 'td' && team === 'red') {                  // 红方:RED_TD360°旋转重炮塔,仍保留专用远狙配置
    var TD = CONF.td;
    C = { struct: C.struct, pen: TD.pen, penKd: TD.penKd, dmg: TD.dmg, reload: TD.reload, speed: TD.speed, shellSpeed: TD.shellSpeed,
          turn: TD.turn, turretRate: TD.turretRate, accel: TD.accel, decel: TD.decel, color: C.color, mob: TD.mob,
          hullArmor: TD.hullArmor, turretArmor: TD.turretArmor };
    } else if (kind === 'ah64') {                                   // BLUE_HELId:独立轻装甲/链炮参数(参考图橄榄漆)
    var AH = CONF.ah64;
    C = { struct: AH.struct, pen: AH.pen, penKd: AH.penKd, dmg: AH.dmg, reload: AH.reload, speed: AH.speed, shellSpeed: AH.shellSpeed,
          turn: AH.turn, turretRate: AH.turretRate, accel: AH.accel, decel: AH.decel, color: 0x9a7f32,
          hullArmor: AH.hullArmor, turretArmor: AH.turretArmor };
  } else if (kind === 'wz10') {                                     // RED_HELI:独立轻装甲/23mm 航炮参数(参考图军绿漆)
    var WZ = CONF.wz10;
    C = { struct: WZ.struct, pen: WZ.pen, penKd: WZ.penKd, dmg: WZ.dmg, reload: WZ.reload, speed: WZ.speed, shellSpeed: WZ.shellSpeed,
          turn: WZ.turn, turretRate: WZ.turretRate, accel: WZ.accel, decel: WZ.decel, color: 0x4b5a43,
          hullArmor: WZ.hullArmor, turretArmor: WZ.turretArmor };
  } else if (kind === '99') {                                     // 红方RED_MBT_2:第四类载具(数值见 CONF.t99 口径注)
    var T9 = CONF.t99;
    C = { struct: T9.struct, pen: T9.pen, penKd: T9.penKd, dmg: T9.dmg, reload: T9.reload, speed: T9.speed, shellSpeed: T9.shellSpeed,
          turn: T9.turn, turretRate: T9.turretRate, accel: T9.accel, decel: T9.decel, color: C.color, mob: T9.mob,
          hullArmor: T9.hullArmor, turretArmor: T9.turretArmor };
  } else if (m1Platform) {                                        // 蓝方:BLUE_MBT_2 完整主战坦克配置
    var M1 = CONF.m1;
    C = { struct: M1.struct, pen: M1.pen, penKd: M1.penKd, dmg: M1.dmg, reload: M1.reload, speed: M1.speed, shellSpeed: M1.shellSpeed,
          turn: M1.turn, turretRate: M1.turretRate, accel: M1.accel, decel: M1.decel, color: C.color, mob: M1.mob,
          hullArmor: M1.hullArmor, turretArmor: M1.turretArmor };
  }
  var baseColor = C.color;                        // InstancedMesh 同型号共享几何——同队同色,几何按 team+kind 完全一致才可实例化
  var _cb = new THREE.Color(baseColor), _ca = new THREE.Color(baseColor).multiplyScalar(0.7);
  var cBODY  = [_cb.r, _cb.g, _cb.b];             // 车体漆(含单车颜色抖动)
  var cACC   = [_ca.r, _ca.g, _ca.b];             // 弱化件漆(0.7×车体)
  var cDARK  = [0.1412, 0.1490, 0.1647];          // 0x24262a 深灰件(原 darkMat)
  var cSTEEL = [0.2353, 0.2549, 0.2824];          // 0x3c4148 工具箱/保险杠/液压
  var cTRACK = [0.1216, 0.1333, 0.1490];          // 0x1f2226 备用履带板
  var cRUBB  = [0.0902, 0.0941, 0.1020];          // 0x17181a 备胎橡胶
  var gGLASS  = [0.2275, 0.3725, 0.4627];         // 0x3a5f76 驾驶窗玻璃
  var gGLASSD = [0.1098, 0.1647, 0.2118];         // 0x1c2a36 观察缝/深色玻璃
  var gPERI   = [0.1412, 0.2000, 0.2471];         // 0x24333f 潜望镜
  var gLENS   = [1.0, 0.9137, 0.6902];            // 0xffe9b0 大灯镜片
  var gTAIL   = [0.8510, 0.2941, 0.2353];         // 0xd94b3c 尾灯
  var cCANVAS = [0.1804, 0.1608, 0.1294];         // 0x2e2921 M60炮盾帆布罩
  var cCANVAS_HI = [0.225, 0.198, 0.154], cCANVAS_SH = [0.125, 0.110, 0.086]; // 布褶高光/深缝顶点色
  /* vcpanel-7 材质语义门：颜色亮度不能区分钢、玻璃和帆布，必须在建模源头显式标记。
     这些数组以引用传入 visPartPush，标记会随 p.c 保留到板缘预处理。 */
  cRUBB._wxNonMetal = 1;
  gGLASS._wxNonMetal = gGLASSD._wxNonMetal = gPERI._wxNonMetal = gLENS._wxNonMetal = gTAIL._wxNonMetal = 1;
  cCANVAS._wxNonMetal = cCANVAS_HI._wxNonMetal = cCANVAS_SH._wxNonMetal = 1;
  /* 迷彩身份基准:本车装甲漆引用+阵营(新增载具约定——装甲件必须传 cBODY/cACC 本体,勿拷贝/勿另建同值数组,否则判 0 无迷彩;team 决定 1 红数码/2 蓝NATO) */
  _CAMO_BODY_REF = cBODY; _CAMO_ACC_REF = cACC; _CAMO_TEAM = team;

  var group  = new THREE.Group();
  var turret = new THREE.Group();
  var gunPivot = new THREE.Group();
  if (kind === 'arty') {                                          // 红 RED_MLRS:转盘中心(0,1.30,-0.05),俯仰铰点(0,1.92,-0.60);蓝 BLUE_MLRS:转盘(0,1.35,-3.10),铰点(0,1.75,-3.10)
    if (team === 'blue') { turret.position.set(0, 1.35, -3.10); gunPivot.position.set(0, 0.40, 0); }
    else { turret.position.set(0, 1.30, -0.05); gunPivot.position.set(0, 0.62, -0.55); }
  }
  else if (kind === 'aa') {                                          // 防空:蓝BLUE_AA 座圈(0,1.20,-1.15)/发射箱俯仰轴(0,0.80,-0.30);红 RED_AA 塔环心(0,1.5925,-0.55)/耳轴(0,0.42,-0.20)
    if (team === 'blue') { turret.position.set(0, 1.20, -1.15); gunPivot.position.set(0, 0.80, -0.30); }
    else { turret.position.set(0, 1.5925, -0.55); gunPivot.position.set(0, 0.42, -0.20); }   // 环心随车体降 R/4(2026-09-11);耳轴=塔局部不变
  }
  else if (kind === 'ah64') { turret.position.set(0, 1.30, 4.05); gunPivot.position.set(0, -0.14, 0.37); }   // BLUE_HELI颚炮旋转中心=炮塔中心(0, 1.30, 4.05), 俯仰耳轴(0, 1.16, 4.42)
  else if (kind === 'wz10') { turret.position.set(0, 1.28, 4.70); gunPivot.position.set(0, -0.14, 0.00); }   // RED_HELI颚炮旋转中心=炮塔中心(0, 1.28, 4.70), 俯仰耳轴(0, 1.14, 4.70)
  else if (kind === 'td') {                                                                        // 阵营专属装甲槽
    if (team === 'red') { turret.position.set(0, 1.115, -1.25); gunPivot.position.set(0, 0.44, 0.85 + TD89_GUN_PULL); }   // 红方RED_TD:旋转轴位于后置炮塔中心,炮轴随塔360°回转;塔底-0.04落1.075埋甲板1.08下0.005接死(座圈裙已删,转扫无触碰)
    else { turret.position.set(0, 1.10, M1_TURRET_CENTER_Z); gunPivot.position.set(0, 0.44, 1.12); } // 蓝方 BLUE_MBT_2:座圈/旋转轴居中车体,炮轴世界 y1.54/z1.12
  }
  else if (kind === '99') { turret.position.set(0, 1.075, -0.35); gunPivot.position.set(0, 0.30, 0.60); var _lz = new THREE.Object3D(); _lz.position.set(0.55, 0.92, -0.72); turret.add(_lz); }   // RED_MBT_2:旋转中心=车体几何中心 z-0.35([2.50,-3.20] 中点),炮轴世界 y1.375; 07 压制器镜片(_lz 函数域提升,建后挂塔,载具对象构造后回填 tank._lwsLens,随镜箱下移-0.05同步);[2026-09-08 塔降0.065:底1.125埋甲板1.13下0.005接死,转扫翼顶余0.02]
  else { turret.position.set(0, team === 'red' ? 1.16 : M60_TURRET_Y, 0); gunPivot.position.set(0, team === 'red' ? 0.23 : M60_GUN_Y, team === 'red' ? 0.60 : 1.0); } // RED_MBT_1;M60 主壳直接落甲板(无垫圈),炮轴保持正面中心
  turret.add(gunPivot); group.add(turret); scene.add(group);

  /* ===== 视觉模型(装饰件按 车体/炮塔/炮架 合并,零新增 draw call)——
     主战坦克+ 坦克歼击车+ 火箭炮= 精细化实体版:一体化棱柱外壳 + 互嵌附件,
     零拼缝不漏风;命中盒/装甲数值全部不变(纯外观翻新) ===== */
  /* 59/BLUE_MBT_1 建模已内嵌本文件(hullParts59/hullPartsM60 等)。 */
  /* ===== BLUE_MBT_1 专属车体(质量对齐 59 式——分段式履带+两片式负重轮/端轮,轮心/半径不动,无独立悬挂件):
     方正焊接车体,首上/首下同倾角对称鼻楔 + 前顶平面止于舱盖切线 z1.67 + 平顶甲板通尾 + 竖直尾面 + 底部内折斜面(后半段拉长 4/3);
     无航向机枪(BLUE_MBT_1 区别于 M48);6 负重轮均布+后主动轮+前诱导轮+侧裙甲(无托带轮);
     贴合 hull 命中盒[1.9,1.1,4.7]@y0.95;坐标全冻结 ===== */
  function hullPartsM60(bP, gP) {
    segTrackPlates(bP, { trkX: 1.19, plateW: 0.55, loopFn: trackLoopM60 }, { dark: cDARK, steel: cSTEEL });   // 分段式履带(物理环路扣轮+顶行下坠,对标59);tr=±1 传 side 供左右差速→分段板无aTrack标志,静态板(59同例)
    vPrism(bP,cBODY,0.90,M60_HULL_PTS,0,0,0);                       // 九折M60车体;视觉/命中只认同一常量
    vBox(bP, 0.60, 0.05, 4.90, cACC, -1.20, 1.295, -0.35);       // 左翼子板(前缘 2.10 不动,后缘随车尾拉长至 -2.80)
    vBox(bP, 0.60, 0.05, 4.90, cACC,  1.20, 1.295, -0.35);       // 右翼子板
    // —— 挡泥板(59 式同款铰链六件式:铰销+铰耳+主板+裙板+压筋+卷边;锚翼板端 (1.225,1.295),x[0.925,1.525] 对齐翼板不穿履带,板尖 y1.1025>带顶 y1.00 不穿模) ——
    // —— 翼子板抬高 0.15(1.145→1.295)→挡泥板六件 y 全随动 +0.15(fenderSix yBase) ——
    for (var fsgn = -1; fsgn <= 1; fsgn += 2) for (var fsk = -1; fsk <= 1; fsk += 2)
      fenderSix(bP, fsgn, fsk, { pinF: 2.10, pinR: -2.80, yBase: 1.295 }, { steel: cSTEEL, dark: cDARK, acc: cACC });   // 后铰锚随新翼板后缘 -2.80
    for (var sk = -1; sk <= 1; sk += 2) {
      // 侧裙甲 RISE 多段钢板(6 段/侧,仿真实 BLUE_MBT_1 RISE 钢板裙甲)
      //   锚面(随走行系内移 0.05):内 1.485 离履带外壁 1.465=0.020;底 0.45 离地余 0.45 盖轮下半弧;
      //   铰链墩加高为裙-翼连接扣:底 1.20 触裙板顶/顶 1.29 嵌翼子板底 1.27 达 0.02(59 式"接死"口径);
      //   墩 x1.50 跨骑裙板上缘并探入翼板外缘投影(翼板外缘 1.50);后半段拉长随动:6 段中心均布跨 z[+2.08,-2.77]
      var skZ6 = [-2.395, -1.575, -0.755, 0.065, 0.885, 1.705];
      for (var s6 = 0; s6 < 6; s6++) {
        vBox(bP, 0.05, 0.75, 0.75, cACC, sk * 1.510, 0.825, skZ6[s6]);          // 裙板主体(y 中心 0.825,顶 1.20/底 0.45)
        vBox(bP, 0.025, 0.65, 0.04, cSTEEL, sk * 1.537, 0.825, skZ6[s6] - 0.21); // 加强筋×2/段(竖贴外面)
        vBox(bP, 0.025, 0.65, 0.04, cSTEEL, sk * 1.537, 0.825, skZ6[s6] + 0.21);
        vBox(bP, 0.06, 0.09, 0.04, cSTEEL, sk * 1.50, 1.245, skZ6[s6] - 0.28);  // 连接扣×2/段(下触裙顶 1.20/上嵌翼底 1.27)
        vBox(bP, 0.06, 0.09, 0.04, cSTEEL, sk * 1.50, 1.245, skZ6[s6] + 0.28);
      }

      /* 6 负重轮重排:首末轮与履带前/后转折斜边内壁相切(r0.30 圆心到内壁线距=半径解:
         前斜边过 (1.741,0.077) 方向 (0.5395,0.8419) → 首轮心 z=1.527;
         后斜边过 (-2.529,0.076) 方向 (-0.5273,0.8498) → 末轮心 z=-2.314),中间四轮均布(步距 0.768) */
      twinWheelSet(bP, sk, SUSP_SPEC.m60, { rub: cRUBB, steel: cSTEEL, dark: cDARK });   // 两片式负重轮+摆臂扭杆(规格表驱动,站位序与物理层严格一致)
      // —— 走行端:前诱导轮+后主动轮(半宽=外面对齐带外壁,无悬挂臂/轴管) ——
      twinEndWheel(bP, sk, { R: 0.28, y: 0.903, z: 1.937, trkX: 1.19, hullX: 0.90 }, { rub: cRUBB, steel: cSTEEL, dark: cDARK });   // 诱导轮(前)两片式(对标59;@前转角弧心,半径/位置不动)
      twinEndWheel(bP, sk, { R: 0.29, y: 0.90, z: -2.627, trkX: 1.19, hullX: 0.90 }, { rub: cRUBB, steel: cSTEEL, dark: cDARK });   // 主动轮(后)两片式(对标59;半径/位置不动)
    }
    // 前大灯:每对2灯紧贴并排(间距=直径)+立式朝前(rx=π/2轴线水平)+楔形底座贴glacis+金属条笼框(4边框+2前竖条)
    //   灯壳r0.06/h0.10立式,灯心y1.105(底y1.045贴底座顶);2灯x0.52/0.64相切;笼框x[0.43,0.73]y[1.035,1.175]包围
    for (var hl = -1; hl <= 1; hl += 2) {
      var hlC = hl * 0.58;                                                                                   // 对中心x
      vPrism(bP, cDARK, 0.16, [[2.13, 0.866], [2.13, 1.045], [2.03, 1.045], [2.03, 0.960]], hlC, 0, 0);      // 楔形底座贴glacis(底面 (2.13,0.866)→(2.03,0.960) 落新首上线 y=0.80+(2.20-z)·0.50/0.53,顶水平y1.045)
      vBox(bP, 0.26, 0.02, 0.12, cSTEEL, hlC, 1.175, 2.08);                                                 // 笼框上条
      vBox(bP, 0.26, 0.02, 0.12, cSTEEL, hlC, 1.035, 2.08);                                                 // 笼框下条
      vBox(bP, 0.02, 0.16, 0.12, cSTEEL, hl * 0.43, 1.105, 2.08);                                           // 笼框左条
      vBox(bP, 0.02, 0.16, 0.12, cSTEEL, hl * 0.73, 1.105, 2.08);                                           // 笼框右条
      for (var hlx = 0; hlx < 2; hlx++) {
        var hlX = hl * (0.52 + hlx * 0.12);                                                                  // 灯x:右0.52/0.64 左-0.52/-0.64(间距0.12=2×r0.06相切)
        vCyl(bP, 0.06, 0.06, 0.10, 12, cDARK, hlX, 1.105, 2.08, Math.PI / 2);                               // 灯壳(立式朝前,轴线水平沿z)
        vCyl(gP, 0.05, 0.05, 0.02, 12, gLENS, hlX, 1.105, 2.14, Math.PI / 2);                               // 镜片(灯壳前端外0.01)
        vBox(bP, 0.02, 0.16, 0.02, cSTEEL, hl * (0.55 + hlx * 0.06), 1.105, 2.15);                          // 前竖条(镜片前方保护条)
      }
    }
    vBox(bP, 0.09, 0.12, 0.14, cSTEEL, -0.5, 0.6, 1.95);            // 前牵引钩×2(首下随首上同倾角切削后随动:面 y0.60 处斜面 z1.988,凸出 0.03 同旧口径)
    vBox(bP, 0.09, 0.12, 0.14, cSTEEL,  0.5, 0.6, 1.95);
    // BLUE_MBT_1 无航向机枪(区别于 M48/59)
    vBox(bP, 0.09, 0.12, 0.14, cSTEEL, -0.5, 0.78, -3.19);          // 后牵引钩×2(贴竖直尾面 z-3.12 外 0.07,y 落竖面区间)
    vBox(bP, 0.09, 0.12, 0.14, cSTEEL,  0.5, 0.78, -3.19);
    /* ===== 后甲板布局重做(参考 M60 三视图,左右对称) ----
       中央凸起发动机舱盖平台(类 M1 高置舱盖)+两侧大梯形散热隔栅(前宽外贴车侧,内缘沿舱盖收窄)。 ===== */
    // 中央凸起舱盖平台:x[-0.62,0.62],z[-1.62,-3.04],顶 y1.42(高出甲板 0.10)
    vBox(bP, 1.24, 0.10, 1.42, cBODY, 0, 1.37, -2.33);                             // 平台主体
    vPrism(bP, cBODY, 0.62, [[-1.50, 1.32], [-1.62, 1.42], [-1.62, 1.32]], 0, 0, 0);   // 前缘小斜坡过渡(三角楔)
    vBox(bP, 0.92, 0.025, 0.82, cACC, 0, 1.432, -2.28);                            // 中央矩形检修盖板
    vBox(bP, 0.30, 0.02, 0.06, cSTEEL, 0, 1.455, -1.98);                           // 盖板前把手
    vBox(bP, 0.30, 0.02, 0.06, cSTEEL, 0, 1.455, -2.58);                           // 盖板后把手
    // 梯形散热隔栅×2(左右对称):俯视四边形薄片(prismGeo 截面(z,-x),rz=π/2,同旧法);
    //   外缘 x0.88 沿车侧 z[-1.15,-2.55],内缘 x0.66 沿舱盖 z[-1.66,-2.45];前缘斜线呼应座圈弧
    for (var sg = -1; sg <= 1; sg += 2) {
      visPartPush(bP, cDARK, prismGeo(0.02, [
        [-1.15, sg*-0.88], [-2.55, sg*-0.88], [-2.45, sg*-0.66], [-1.66, sg*-0.66]
      ]), 0, 1.335, 0, 0, 0, Math.PI / 2);                           // 梯形底片(厚0.04,顶 y1.355 高出甲板 0.035)
      for (var sl = 0; sl < 6; sl++)
        vBox(bP, 0.20, 0.015, 0.025, cSTEEL, sg * 0.77, 1.36, -1.72 - sl * 0.135);  // 百叶窗横条×6(z -1.72..-2.395)
    }
    vTreadBox(bP, 0.7, 0.34, 0.05, cTRACK, 0, 0.99, -3.155, 0, 0, 0, 'z');          // 车尾备用履带板(平贴新竖直尾面 z-3.12)
    // 炮塔主壳底埋入甲板 y1.32 下0.005接死(无垫圈,转扫翼顶呈座圈缝)。
    // 驾驶员舱盖精细化:圆角舱盖(vCyl圆盘)+边框底环+连接件铰销;底座环前切线 z1.67=车体前顶平面前边线(舱盖与边线相切)
    //   舱盖中心 z1.42(比旧 z1.40 后移 0.02 让出炮塔针尖 z1.15);ring r0.25 后缘 z1.17 距针尖 0.02 不穿模
    vCyl(bP, 0.25, 0.25, 0.03, 16, cDARK, 0, 1.335, 1.42);            // ①边框底座环(r0.25 比舱盖 r0.20 大 0.05,露出环形边框)
    vCyl(bP, 0.20, 0.20, 0.05, 16, cACC, 0, 1.355, 1.42);            // ②圆角舱盖(圆盘形,BLUE_MBT_1 圆形旋转舱盖特征)
    vCyl(bP, 0.025, 0.025, 0.08, 6, cSTEEL, -0.14, 1.385, 1.24, 0, 0, Math.PI / 2);  // ③连接件铰销×2(舱盖后缘,沿 Z 轴)
    vCyl(bP, 0.025, 0.025, 0.08, 6, cSTEEL,  0.14, 1.385, 1.24, 0, 0, Math.PI / 2);
    // M60 翼子板装饰工具组(美式标准组 7 件,参照 59 式布局:M60 翼板顶 y1.32 vs 59 y1.17 → y+0.15;
    //   z 适配 M60 短翼板[-2.10,2.10]:自救木 z-1.83→-1.50(59 跨到-2.405 超 M60 后缘);其余前段工具 z 不变)
    vBox(bP, 0.28, 0.16, 0.45, cSTEEL, 1.275, 1.38, 0.50);                    // 工具箱①(右前翼板,z[0.275,0.725],底嵌 0.02)
    vBox(bP, 0.28, 0.16, 0.30, cSTEEL, 1.275, 1.38, 1.095);                   // 工具箱②(右前翼板,z[0.945,1.245])
    // 尾部格栅:随车尾三段制重构,平贴竖直尾面(z-3.12,y[0.66,1.32])——底板+5 横条
    vBox(bP, 1.40, 0.62, 0.04, cDARK, 0, 0.99, -3.145);                               // 格栅底板(外面 -3.165)
    for (var gs = 0; gs < 5; gs++)
      vBox(bP, 1.40, 0.015, 0.02, cSTEEL, 0, 0.755 + gs * 0.118, -3.175);             // 横条×5(y 0.755..1.227,凸出底板 0.01)
  }
  /* ===== BLUE_MBT_1 真实炮塔附件:新梯形主壳保持不动,附件全部重新解析锚固。 ===== */
  function turretPartsM60(tP, gP) {
    var D=M60_DETAIL;
    visPartPush(tP,cBODY,m60TurretGeo(),0,0,0);                         // 244三角双轮廓环主壳保持原样

    // M19车长指挥塔:低筒座→收束铸造罩→顶盖;六块周视镜围绕真实罩面布置,不恢复高射机枪。
    var cmdRoof=m60TurretTopY(D.commander.x,D.commander.z);
    visPartPush(tP,cACC,m60CupolaGeo(),D.commander.x,cmdRoof,D.commander.z);
    var cmdSeam=new THREE.TorusGeometry(0.325,0.012,5,24);uvSetFlat(cmdSeam);
    visPartPush(tP,cDARK,cmdSeam,D.commander.x,cmdRoof+0.040,D.commander.z,Math.PI/2,0,0);
    var cmdLid=new THREE.CylinderGeometry(0.18,0.19,0.035,20);cmdLid.scale(1.12,1,0.90);uvSetFlat(cmdLid);
    visPartPush(tP,cACC,cmdLid,D.commander.x+0.015,cmdRoof+0.297,D.commander.z,0,0.08,0);
    vBox(tP,0.055,0.035,0.055,cDARK,D.commander.x-0.10,cmdRoof+0.300,D.commander.z-0.17);
    vBox(tP,0.055,0.035,0.055,cDARK,D.commander.x+0.10,cmdRoof+0.300,D.commander.z-0.17);
    vBox(tP,0.12,0.018,0.025,cDARK,D.commander.x,cmdRoof+0.326,D.commander.z+0.10);
    vBox(tP,0.020,0.035,0.025,cDARK,D.commander.x-0.045,cmdRoof+0.310,D.commander.z+0.10);
    vBox(tP,0.020,0.035,0.025,cDARK,D.commander.x+0.045,cmdRoof+0.310,D.commander.z+0.10);
    // M19实车为八块环视玻璃:每块先有装甲窗框,再嵌较小的深色玻璃,不再用六个小方点代替。
    for (var cp = 0; cp < 8; cp++) {
      var ca=cp/8*TAU,fr=0.314,gr=0.329;
      vBox(tP,0.135,0.082,0.032,cDARK,D.commander.x+Math.sin(ca)*fr,cmdRoof+0.132,D.commander.z+Math.cos(ca)*fr,0,ca,0);
      vBox(gP,0.105,0.052,0.014,gPERI,D.commander.x+Math.sin(ca)*gr,cmdRoof+0.132,D.commander.z+Math.cos(ca)*gr,0,ca,0);
    }

    // 装填手椭圆舱盖:底圈、错层盖板、双铰链与抓柄都嵌入新顶面。
    var loadRoof=m60TurretTopY(D.loader.x,D.loader.z);
    var loadBase=new THREE.CylinderGeometry(0.255,0.265,0.050,18);loadBase.scale(1.15,1,0.78);uvSetFlat(loadBase);
    visPartPush(tP,cDARK,loadBase,D.loader.x,loadRoof+0.015,D.loader.z);
    var loadLid=new THREE.CylinderGeometry(0.235,0.245,0.030,18);loadLid.scale(1.15,1,0.78);uvSetFlat(loadLid);
    visPartPush(tP,cACC,loadLid,D.loader.x,loadRoof+0.052,D.loader.z,0,-0.08,0);
    vBox(tP,0.055,0.040,0.060,cSTEEL,D.loader.x-0.12,loadRoof+0.060,D.loader.z-0.185);
    vBox(tP,0.055,0.040,0.060,cSTEEL,D.loader.x+0.12,loadRoof+0.060,D.loader.z-0.185);
    vBox(tP,0.13,0.018,0.026,cDARK,D.loader.x,loadRoof+0.078,D.loader.z+0.105);
    vBox(tP,0.022,0.040,0.026,cDARK,D.loader.x-0.055,loadRoof+0.060,D.loader.z+0.105);
    vBox(tP,0.022,0.040,0.026,cDARK,D.loader.x+0.055,loadRoof+0.060,D.loader.z+0.105);

    // 炮手瞄准镜罩、前向镜窗与两块顶置潜望镜。
    var sightRoof=m60TurretTopY(D.sight.x,D.sight.z);
    vBox(tP,0.20,0.13,0.20,cSTEEL,D.sight.x,sightRoof+0.055,D.sight.z,-0.08);
    vBox(tP,0.22,0.035,0.22,cACC,D.sight.x,sightRoof+0.122,D.sight.z,-0.08);
    vBox(gP,0.125,0.070,0.018,gGLASSD,D.sight.x,sightRoof+0.057,D.sight.z+0.109,-0.08);
    for (var pp = -1; pp <= 1; pp += 2) {
      var px60=pp*0.56,pz60=0.16,py60=m60TurretTopY(px60,pz60);   // 恢复原位
      vBox(tP,0.11,0.040,0.13,cDARK,px60,py60+0.010,pz60);
      vBox(gP,0.080,0.050,0.025,gPERI,px60,py60+0.025,pz60+0.066);
    }

    // 炮塔后部通风穹与双鞭状天线;天线座底面均嵌甲0.01m。
    var ventRoof=m60TurretTopY(D.vent.x,D.vent.z);
    vCyl(tP,0.145,0.155,0.050,16,cDARK,D.vent.x,ventRoof+0.015,D.vent.z);
    var ventDome=new THREE.SphereGeometry(0.135,12,5,0,TAU,0,Math.PI/2);ventDome.scale(1,0.55,1);uvSetFlat(ventDome);
    visPartPush(tP,cACC,ventDome,D.vent.x,ventRoof+0.030,D.vent.z);
    for (var ant = -1; ant <= 1; ant += 2) {
      var ax60=ant*0.52,az60=-0.92,ay60=m60TurretTopY(ax60,az60);   // 恢复原位
      vCyl(tP,0.024,0.030,0.080,8,cDARK,ax60,ay60+0.030,az60);
      vCyl(tP,0.007,0.009,1.15,5,cDARK,ax60,ay60+0.625,az60);
    }

    // 侧壁贴合:横向斜率恒定(tw=bw-0.35Δh 构造)→滚转角恒约 19.29°;纵向偏航按附着区前后站位实测。
    // 右侧(+x)返回 {roll,yaw},左侧取反后与 vBox 欧拉序(RY·RZ)一致;旋转均绕件自身中心,内表面嵌入量保持均匀。
    function m60SideTilt(y, z, dz) {
      var s0 = m60TurretSection(z), dh = (s0.hi - s0.lo) || 1;
      var roll = Math.atan(Math.max(0, (s0.bw - s0.tw) / dh));
      var yaw = Math.atan2(m60TurretSideX(y, z + dz) - m60TurretSideX(y, z - dz), 2 * dz);
      return { roll: roll, yaw: yaw };
    }
    function m60RotYZ(dx, dy, dz, r, w) {
      var cr = Math.cos(r), sr = Math.sin(r), cw = Math.cos(w), sw = Math.sin(w);
      var qx = dx * cr - dy * sr, qy = dx * sr + dy * cr;
      return [qx * cw + dz * sw, qy, -qx * sw + dz * cw];
    }
    // M17A1合像式测距仪侧耳:削角矩形铸造罩 + 横向长窗;耳体绕自身中心滚转/偏航,内端面均匀嵌入斜侧壁。
    var rfY=0.52,rfSide=m60TurretSideX(rfY,D.rangeZ);
    var rfT=m60SideTilt(rfY,D.rangeZ,0.13);
    for (var rf = -1; rf <= 1; rf += 2) {
      visPartPush(tP,cACC,m60RangefinderGeo(rf,rfSide,rfY,D.rangeZ,rf*rfT.roll,rf*rfT.yaw),0,0,0);
      var _rgo=m60RotYZ(rf*0.158,0,0,rf*rfT.roll,rf*rfT.yaw);   // 端窗随耳端刚体跟随
      vBox(gP,0.022,0.075,0.170,gGLASSD,rf*rfSide+_rgo[0],rfY+_rgo[1],D.rangeZ+_rgo[2],0,rf*rfT.yaw,rf*rfT.roll);
      var _rso=m60RotYZ(rf*0.125,0.082,0,rf*rfT.roll,rf*rfT.yaw);   // 顶压条随耳顶刚体跟随
      vBox(tP,0.060,0.025,0.220,cDARK,rf*rfSide+_rso[0],rfY+_rso[1],D.rangeZ+_rso[2],0,rf*rfT.yaw,rf*rfT.roll);
    }

    // 两侧薄型附件箱、锁扣与长抓杆:箱体/锁扣/杆座同滚转/偏航贴合斜侧壁,内表面均匀嵌入而非悬浮。
    var boxY=0.41,boxZ=-0.47,boxSide=m60TurretSideX(boxY,boxZ);
    var railY=0.58,railZ=-0.43,railSide=m60TurretSideX(railY,railZ);
    var boxT=m60SideTilt(boxY,boxZ,0.21), railT=m60SideTilt(railY,railZ,0.20);
    for (var sb = -1; sb <= 1; sb += 2) {
      vBox(tP,0.10,0.24,0.42,cSTEEL,sb*(boxSide+0.035),boxY,boxZ,0,sb*boxT.yaw,sb*boxT.roll);
      var _bcF=m60RotYZ(sb*0.057,0.035,0.105,sb*boxT.roll,sb*boxT.yaw);   // 前锁扣随箱面刚体跟随(相对箱中心)
      vBox(tP,0.025,0.055,0.070,cDARK,sb*(boxSide+0.035)+_bcF[0],boxY+_bcF[1],boxZ+_bcF[2],0,sb*boxT.yaw,sb*boxT.roll);
      var _bcR=m60RotYZ(sb*0.057,0.035,-0.105,sb*boxT.roll,sb*boxT.yaw);   // 后锁扣随箱面刚体跟随(相对箱中心)
      vBox(tP,0.025,0.055,0.070,cDARK,sb*(boxSide+0.035)+_bcR[0],boxY+_bcR[1],boxZ+_bcR[2],0,sb*boxT.yaw,sb*boxT.roll);
      vCyl(tP,0.014,0.014,0.40,6,cSTEEL,sb*(railSide+0.055),railY,railZ,Math.PI/2,0,-sb*railT.yaw);
      var _rmF=m60RotYZ(sb*-0.040,0,0.18,sb*railT.roll,sb*railT.yaw);   // 前杆座随抓杆刚体跟随(相对杆中心)
      vBox(tP,0.050,0.050,0.025,cSTEEL,sb*(railSide+0.055)+_rmF[0],railY+_rmF[1],railZ+_rmF[2],0,sb*railT.yaw,sb*railT.roll);
      var _rmR=m60RotYZ(sb*-0.040,0,-0.18,sb*railT.roll,sb*railT.yaw);   // 后杆座随抓杆刚体跟随(相对杆中心)
      vBox(tP,0.050,0.050,0.025,cSTEEL,sb*(railSide+0.055)+_rmR[0],railY+_rmR[1],railZ+_rmR[2],0,sb*railT.yaw,sb*railT.roll);
    }

    // M60 无高射机枪、烟幕弹发射器、炮盾红外灯(不建此三件)。
  }
  /* ===== 105mm火炮 105mm 线膛炮:偏心抽烟装置(105mm火炮 标志性特征,圆筒轴线偏离炮管轴线)+
     无炮口制退器(真实 M60 系列无此件);炮盾内座+身管+热护套+偏心抽烟装置+炮口端箍;坐标全冻结对齐 gun 命中盒[0.34,0.34,3.3] ===== */
  function gunPartsM60(uP, mP) {
    // 大型非共面帆布罩随俯仰、不随后坐;视觉与mantlet命中主壳同源。
    visPartPush(mP,cCANVAS,m60MantletGeo(),0,0,0);
    var seam60=m60MantletRingGeo(0,1.008,0.012);uvSetFlat(seam60);
    visPartPush(mP,cCANVAS_SH,seam60,0,0,0);                       // 炮塔前脸周缘缝边
    var foldIdx60=[1,2,4,6,7];
    for (var mf = 0; mf < foldIdx60.length; mf++) {
      var fg60=m60MantletRingGeo(foldIdx60[mf],1.010,mf===1?0.010:0.008);uvSetFlat(fg60);
      visPartPush(mP,mf&1?cCANVAS_SH:cCANVAS_HI,fg60,0,0,0);
    }
    for (var mrib60 = 0; mrib60 < 8; mrib60++) {
      var rg60=m60MantletRibGeo(Math.PI/8+mrib60*TAU/8);uvSetFlat(rg60);
      visPartPush(mP,mrib60&1?cCANVAS_SH:cCANVAS_HI,rg60,0,0,0);
    }
    // 周缘八只金属压扣按非共面后缘逐点落位。
    for (var mc60 = 0; mc60 < 8; mc60++) {
      var mq60=m60MantletPoint(M60_MANTLET_PROFILE[0],mc60*TAU/8,1.018);
      vCyl(mP,0.012,0.012,0.030,6,cSTEEL,mq60.x,mq60.y,mq60.z,Math.PI/2);
    }
    vCyl(mP,0.132,0.158,0.16,12,cSTEEL,0,0,0.455,Math.PI/2);       // 钢制炮颈压圈(12段,16→12)
    // 主炮左侧同轴机枪口:短钢套+暗色镗孔,属于炮盾细节但不建立独立空气装甲。
    vCyl(mP,0.035,0.045,0.10,12,cSTEEL,-0.220,0.025,0.340,Math.PI/2);
    vCyl(mP,0.022,0.022,0.050,10,cDARK,-0.220,0.025,0.395,Math.PI/2);

    // 105mm火炮 105mm:母管、两段热护套、抽烟装置、炮口端箍;坐标/膛口保持原机制桩。
    vCyl(uP, 0.09, 0.115, 2.9, 12, cDARK, 0, 0, 1.75, Math.PI / 2);
    vCyl(uP, 0.122, 0.122, 0.55, 10, cDARK, 0, 0, 0.60, Math.PI / 2);
    vCyl(uP, 0.122, 0.122, 0.55, 10, cDARK, 0, 0, 1.30, Math.PI / 2);
    vCyl(uP, 0.125, 0.125, 0.5, 10, cDARK, 0, 0, 2.15, Math.PI / 2);
    vCyl(uP, 0.095, 0.095, 0.10, 10, cDARK, 0, 0, 3.10, Math.PI / 2);
    // M60-2参考图没有炮盾红外灯(不建此件)。
  }
  /* ============ 蓝方 BLUE_MBT_2 重型主战坦克(薄尾舱下切/高发动机舱/斜切炮盾)============
     识别锚点:大面积大倾角首下 + 正视近乎不可见的窄浅首上、7 对负重轮、分段全长侧裙、宽尾发动机舱;炮塔为俯视十边形复合楔颊并带平台式薄尾舱,
     带尾舱泄压板/尾篮、车长塔与 M2、装填手舱盖、GPS 炮长主瞄、两侧贴合装甲的储物箱;120mm滑膛炮 120mm
     滑膛炮有热护套与抽烟装置、无炮口制退器;本车型不配置烟幕弹发射器。 */
  function hullPartsBLUE_MBT_2(bP, gP) {
    var m1BodyStart = bP.length, m1GlowStart = gP.length;
    // RED_MBT_1同级圆角中空环带,外移到车体侧甲之外留出2cm净空。
    segTrackPlates(bP, { trkX: 1.32, plateW: 0.50, loopFn: trackLoopM1 }, { dark: cDARK, steel: cSTEEL });   // 分段式履带(物理环路扣轮+顶行下坠,对标59;预缩放坐标,随末尾统一缩放)
    vPrism(bP, cBODY, M1_HULL_HALF_W, M1_HULL_PTS, 0, 0, 0);         // 一体式低矮楔形主车体
    vPrism(bP, cBODY, M1_ENGINE_DECK_HALF_W, M1_ENGINE_DECK_PTS, 0, 0, 0); // 高置AGT-1500发动机舱,前坡与主壳交叠闭合
    vBox(bP, 0.55, 0.055, 5.15, cACC, -1.325, 1.065, -0.02);         // 翼板下移0.04(x1.345→1.325,缩放后内缘0.882嵌车侧=接死)
    vBox(bP, 0.55, 0.055, 5.15, cACC,  1.325, 1.065, -0.02);

    for (var sk = -1; sk <= 1; sk += 2) {
      // 7 对负重轮:两片式(对标59;轮心上调0.8半径(现0.299),轴连车侧);预缩放系与履带同缩保持对齐。
      twinWheelSet(bP, sk, SUSP_SPEC.m1, { rub: cRUBB, steel: cSTEEL, dark: cDARK });   // 无托带轮;摆臂扭杆(规格表驱动)
      // 端轮:前诱导轮+后主动轮两片式(对标59;位置不动;齿圈内收避裙)。
      twinEndWheel(bP, sk, { R: 0.25, y: 0.628, z: 2.533, trkX: 1.32, hullX: 1.05, ringX: 1.52 }, { rub: cRUBB, steel: cSTEEL, dark: cDARK });
      twinEndWheel(bP, sk, { R: 0.27, y: 0.60, z: -2.48, trkX: 1.32, hullX: 1.05, ringX: 1.52 }, { rub: cRUBB, steel: cSTEEL, dark: cDARK });

      // 全长分段复合侧裙置于轮面外侧,遮住上半轮但不与中空环带相交。
      for (var sp = 0; sp < 8; sp++) {
        var sz = 2.24 - sp * 0.64;
        vBox(bP, 0.075, 0.488, 0.59, sp < 2 ? cBODY : cACC, sk * 1.61, 0.781, sz);   // 侧裙高减1/5(0.61→0.488,顶随翼降,底上收至0.537)
        vBox(bP, 0.086, 0.025, 0.52, cDARK, sk * 1.585, 1.029, sz);   // 裙顶连接扣条:下压裙板顶 1.025/上嵌翼板底 1.0375,内探翼板外缘 1.60 投影(裙-翼接死)
      }
    }

    // 车首:驾驶舱盖/潜望镜仍在窄首上;首下按75°解析面仅保留左右两盏车灯(灯座+灯镜),unused towing, service, and weld details are omitted.
    vBox(bP, 0.48, 0.045, 0.58, cACC, 0, 1.1175, 1.77);   // 驾驶舱盖平放:底1.095埋甲板1.10下0.005接死(后缘1.48离塔前1.42余0.04,前缘2.06离甲板边2.10余0.04)
    vBox(gP, 0.10, 0.055, 0.09, gPERI, -0.18, 1.1625, 2.01, -0.22);
    vBox(gP, 0.10, 0.055, 0.09, gPERI, 0.00, 1.1625, 2.04, -0.22);
    vBox(gP, 0.10, 0.055, 0.09, gPERI, 0.18, 1.1625, 2.01, -0.22);
    // [2026-09-08] M1车灯改落首上斜面:薄型灯座贴17°坡(底埋5mm)+双小圆镜+轻框(原首下大灯组嫌厚大)
    for (var hl = -1; hl <= 1; hl += 2) {
      var hlC = hl * 0.82;
      vBox(bP, 0.20, 0.05, 0.14, cDARK, hlC, 1.009, 2.456, 0.30);              // 薄灯座(底埋坡面5mm)
      vBox(bP, 0.22, 0.015, 0.03, cSTEEL, hlC, 1.016, 2.520, 0.30);            // 框前条(骑灯座面)
      vBox(bP, 0.22, 0.015, 0.03, cSTEEL, hlC, 1.051, 2.406, 0.30);             // 框后条
      vBox(bP, 0.015, 0.015, 0.15, cSTEEL, hlC + 0.10, 1.035, 2.464, 0.30);     // 框侧条×2
      vBox(bP, 0.015, 0.015, 0.15, cSTEEL, hlC - 0.10, 1.035, 2.464, 0.30);
      for (var hlx = 0; hlx < 2; hlx++) {
        var hlX = hlC + hlx * 0.10 - 0.05;
        vCyl(bP, 0.032, 0.032, 0.05, 10, cDARK, hlX, 1.059, 2.471, Math.PI / 2);   // 卧式灯壳朝前(底埋座面6mm)
        vCyl(gP, 0.026, 0.026, 0.012, 10, gLENS, hlX, 1.059, 2.499, Math.PI / 2);  // 镜片朝前(后端埋壳内3mm)
      }
    }

    // AGT-1500高置发动机舱:格栅随新舱顶抬高,后机舱质量顶1.25m明显高于前乘员舱1.10m。
    vBox(bP, 1.72, 0.045, 0.72, cDARK, 0, 1.255, -2.06);
    for (var eg = -4; eg <= 4; eg++)
      vBox(bP, 0.08, 0.035, 0.68, cSTEEL, eg * 0.18, 1.282, -2.06);
    vBox(bP, 1.62, 0.36, 0.06, cDARK, 0, 0.925, -2.675, 0.474);                // 尾部散热格栅贴上斜面(斜长0.405,底埋0.0075)
    for (var es = -4; es <= 4; es++)
      vBox(bP, 0.08, 0.34, 0.035, cSTEEL, es * 0.17, 0.946, -2.715, 0.474);   // 栅条贴栅面(背咬合0.002)
    vBox(bP, 0.10, 0.14, 0.16, cSTEEL, -0.48, 0.52, -2.68);
    vBox(bP, 0.10, 0.14, 0.16, cSTEEL,  0.48, 0.52, -2.68);
    vBox(gP, 0.10, 0.07, 0.03, gTAIL, -0.90, 1.032, -2.62, 0.474);   // 尾灯贴车尾上斜面(与散热格栅同倾角)
    vBox(gP, 0.10, 0.07, 0.03, gTAIL,  0.90, 1.032, -2.62, 0.474);
    // 整个车体/走行部沿X统一收窄,保持所有轮、裙板、灯具相对关系,不缩炮塔与火炮。
    for (var mb = m1BodyStart; mb < bP.length; mb++) bP[mb].g.scale(M1_HULL_X_SCALE, 1, 1);
    for (var mg = m1GlowStart; mg < gP.length; mg++) gP[mg].g.scale(M1_HULL_X_SCALE, 1, 1);
  }

  function turretPartsBLUE_MBT_2(tP, gP, mP) {
    visPartPush(tP, cBODY, m1TurretGeo(), 0, 0, 0);                   // 单一闭合十边复合楔塔,短阶面与水平薄尾舱并入主壳
    vBox(tP, 2.10, 0.53, 0.24, cACC, 0, 0.415, -2.16);               // 尾舱后壁y[0.15,0.68](随尾舱增厚下延,贴新底面)

    // 缩小炮盾:闭合六边罩正视切去左右上角;仅随俯仰、不随身管后坐。
    visPartPush(mP, cACC, m1MantletGeo(), 0, 0, 0);
    vBox(mP, 0.42, 0.22, 0.055, cDARK, 0, -0.005, 0.370);            // 内层炮颈面缩在斜切外轮廓内
    vCyl(mP, 0.125, 0.155, 0.30, 14, cSTEEL, 0, 0, 0.48, Math.PI / 2);

    // BLUE_MBT_2 加长尾舱顶部 3 块弹药舱泄压板,覆盖尾舱起点至后壁前缘。
    for (var bp = -1; bp <= 1; bp++) {
      vBox(tP, 0.48, 0.045, 1.30, cACC, bp * 0.52, 0.748, -1.35);
      vBox(tP, 0.40, 0.025, 0.04, cDARK, bp * 0.52, 0.776, -0.72);
      vBox(tP, 0.40, 0.025, 0.04, cDARK, bp * 0.52, 0.776, -1.98);
    }
    // [2026-09-08] 战斗舱横向焊缝条删除(悬空0.042,用户要求删)

    // 车长指挥塔(右)与装填手舱盖(左);BLUE_MBT_2 不添加 BLUE_MBT_2 的独立 CITV
    vCyl(tP, 0.27, 0.29, 0.16, 16, cACC, 0.43, 0.79, -0.22);
    vCyl(tP, 0.25, 0.25, 0.05, 16, cDARK, 0.43, 0.885, -0.22);
    vCyl(tP, 0.25, 0.25, 0.055, 14, cACC, -0.42, 0.755, -0.12);
    for (var pv = 0; pv < 4; pv++) {
      var pa = pv * Math.PI / 2;
      vBox(gP, 0.055, 0.05, 0.05, gPERI, 0.43 + Math.sin(pa) * 0.27, 0.82,
        -0.22 + Math.cos(pa) * 0.27);
    }

    // GPS 炮长主瞄:右前顶的大矩形装甲瞄具箱及深色镜窗
    vBox(tP, 0.28, 0.30, 0.34, cSTEEL, 0.52, 0.78, 0.56, -0.18);
    vBox(gP, 0.20, 0.14, 0.035, gGLASSD, 0.52, 0.80, 0.742, -0.18);   // 镜片后移贴盒前脸(后脸埋0.005)
    vBox(gP, 0.08, 0.06, 0.08, gPERI, -0.26, 0.75, 0.62);

    // 双侧储物箱，贴合楔形炮塔侧面。
    for (var sb = -1; sb <= 1; sb += 2) {
      vBox(tP, 0.075, 0.25, 0.62, cSTEEL, sb * 1.105, 0.39, -0.56, 0, 0, sb * 0.15);   // 塔侧灰色储物箱:绕Z轴贴合两侧复合装甲斜率(左右镜像)
    }

    // [2026-09-08] 尾部铁网篮重做(三面包围杆格网仿99布局+89杆件:底网/尾网/两侧网,前端埋尾墙,铁网cSTEEL细杆)
    for (var mbx = -2; mbx <= 2; mbx++)
      vBox(tP, 0.025, 0.025, 0.48, cSTEEL, mbx * 0.51, 0.30, -2.40);   // 底网纵杆×5(前端埋尾墙)
    for (var mbz = 0; mbz < 4; mbz++)
      vBox(tP, 2.07, 0.025, 0.025, cSTEEL, 0, 0.30, -2.62 + mbz * 0.14); // 底网横杆×4
    for (var mtx = -2; mtx <= 2; mtx++)
      vBox(tP, 0.025, 0.44, 0.025, cSTEEL, mtx * 0.51, 0.51, -2.64);   // 尾网立柱×5
    for (var mty = 0; mty < 3; mty++)
      vBox(tP, 2.07, 0.025, 0.025, cSTEEL, 0, 0.30 + mty * 0.21, -2.64); // 尾网横杆×3
    for (var msgn = -1; msgn <= 1; msgn += 2) {
      vBox(tP, 0.025, 0.025, 0.48, cSTEEL, msgn * 1.02, 0.72, -2.40);   // 侧网上沿×2
      for (var msz = 0; msz < 3; msz++)
        vBox(tP, 0.025, 0.44, 0.025, cSTEEL, msgn * 1.02, 0.51, -2.58 + msz * 0.18); // 侧网立柱×3/侧
    }

    // 车长 M2HB .50(BLUE_MBT_2 顶部附件,不参与主炮命中盒;装填手 M240Deleted:左舱盖机枪悬空无支架,删除)
    vCyl(tP, 0.035, 0.045, 0.10, 8, cDARK, 0.43, 0.95, -0.18);
    vBox(tP, 0.14, 0.13, 0.36, cDARK, 0.43, 1.03, 0.00);
    vCyl(tP, 0.018, 0.018, 0.74, 8, cDARK, 0.43, 1.04, 0.52, Math.PI / 2);
    vBox(tP, 0.16, 0.22, 0.10, cSTEEL, 0.58, 0.98, -0.04);            // M2 弹箱

    vCyl(tP, 0.012, 0.012, 1.10, 5, cDARK, -0.82, 1.26, -1.94);       // 双鞭天线移到弹药尾舱后部
    vCyl(tP, 0.012, 0.012, 1.10, 5, cDARK,  0.82, 1.26, -1.94);

  }

  function gunPartsBLUE_MBT_2(uP) {
    vCyl(uP, 0.090, 0.112, 4.62, 12, cDARK, 0, 0, 2.51, Math.PI / 2); // 120mm滑膛炮 120mm 母管,根端咬入炮盾套筒
    vCyl(uP, 0.128, 0.128, 1.50, 12, cDARK, 0, 0, 1.18, Math.PI / 2); // 热护套后段
    vCyl(uP, 0.122, 0.122, 1.10, 12, cDARK, 0, 0, 2.47, Math.PI / 2); // 热护套前段
    vCyl(uP, 0.165, 0.175, 0.62, 12, cDARK, 0, 0, 2.72, Math.PI / 2); // 偏大的抽烟装置
    vCyl(uP, 0.140, 0.140, 0.055, 12, cSTEEL, 0, 0, 0.46, Math.PI / 2);
    vCyl(uP, 0.140, 0.140, 0.055, 12, cSTEEL, 0, 0, 1.93, Math.PI / 2);
    vCyl(uP, 0.050, 0.050, 0.025, 8, cTRACK, 0, 0, 4.805, Math.PI / 2); // 暗膛口;120mm滑膛炮 无制退器
  }
  /* ============ RED_TD 120mm自行反坦克炮(可见尾门/每侧前3烟幕弹)============
     新锚点:顶窄底宽且中高侧低的冠形战斗室、中央大直径多褶帆布防盾、每侧前部单排3管烟幕弹、连续侧篮、双联前灯与车长高射机枪;
     延续此前复合斜颊与中空履带,外形拟真优先。 ============
     比例重定标(三张参考图重测绘):RED_TD2.jpg 车库实片 7.70mm/px 垂直实标——负重轮径 0.67(r0.335)/轮心 0.43/翼子板线 1.15/履带顶程 1.02/
       主动轮心 0.65/战斗室前缘 1.86·拱点 2.00(偏后)·尾角 1.88/炮轴 1.91/抽烟装置在出炮口段 ~72%(误置 58% 已矫正);
       RED_TD3.png 侧视线稿横向定形——全长基线上:低长双坡鼻头(35° 尖坡+缓坡长鼻=89 标志)/驾驶甲板段=全长 13.8%/
       战斗室长 55.6% 且高长比≈1:3 低扁长楔、脸倾大角度/拱顶偏后/尾墙 10.8° 前俯/尾篮越车尾/6 对负重轮 3-4 号大隙。
     比例标尺(三张参考图重测绘):整车长/高≈2.7(短比呈高短玩具感)/战斗室低扁长楔防箱感/甲板压低配大轮径。
     布局:战斗室后置 turret.group (0,1.08,-1.25),炮轴高度保持世界 y1.52;炮根/身管沿 +Z 外拉 0.44m,
       枢轴世界 z +0.04,muzzle 局部 5.65,膛口世界 z 5.69(前移标尺)。 */
  function hullParts89(bP, gP) {
    // RED_MBT_1同级圆角中空环带(外壁逐板纹理、内壁/侧环面完整),横向外移无车体穿模。
    segTrackPlates(bP, { trkX: 1.24, plateW: 0.55, loopFn: trackLoop89 }, { dark: cDARK, steel: cSTEEL });   // 分段式履带(物理环路扣轮+顶行下坠,对标59)
    /* ===== 一体化车体真壳:低长双坡首 + 低甲板 + 与水平面80°、向下朝车首内收的单块尾板。 ===== */
    vPrism(bP, cBODY, 0.95, TD89_HULL_PTS, 0, 0, 0);
    // 可见乘员尾门:深色门缝底座+凸起内门+粗压框强化轮廓。
    var rd89 = td89RearPoint(0.48, 0.018);
    vBox(bP, 0.82, 0.045, 0.50, cDARK, 0, rd89.y, rd89.z, TD89_REAR_ANGLE);       // 深色门缝底座
    var rdInset = td89RearPoint(0.48, 0.040);
    vBox(bP, 0.74, 0.025, 0.42, cACC, 0, rdInset.y, rdInset.z, TD89_REAR_ANGLE);  // 装甲门内板
    var rdTop = td89RearPoint(0.82, 0.054), rdBot = td89RearPoint(0.14, 0.054);
    vBox(bP, 0.82, 0.018, 0.040, cSTEEL, 0, rdTop.y, rdTop.z, TD89_REAR_ANGLE);
    vBox(bP, 0.82, 0.018, 0.040, cSTEEL, 0, rdBot.y, rdBot.z, TD89_REAR_ANGLE);
    vBox(bP, 0.040, 0.018, 0.46, cSTEEL, -0.39, rd89.y, rd89.z, TD89_REAR_ANGLE);
    vBox(bP, 0.040, 0.018, 0.46, cSTEEL,  0.39, rd89.y, rd89.z, TD89_REAR_ANGLE);
    var rdH1 = td89RearPoint(0.32, 0.060), rdH2 = td89RearPoint(0.65, 0.060);
    vBox(bP, 0.11, 0.035, 0.065, cSTEEL, -0.34, rdH1.y, rdH1.z, TD89_REAR_ANGLE);
    vBox(bP, 0.11, 0.035, 0.065, cSTEEL, -0.34, rdH2.y, rdH2.z, TD89_REAR_ANGLE);
    var rdLock = td89RearPoint(0.48, 0.063);
    vBox(bP, 0.22, 0.030, 0.040, cSTEEL, 0.17, rdLock.y, rdLock.z, TD89_REAR_ANGLE);
    for (var rdb = -1; rdb <= 1; rdb += 2) {
      var rdBolt = td89RearPoint(rdb < 0 ? 0.24 : 0.72, 0.064);
      vBox(bP, 0.035, 0.022, 0.035, cSTEEL, -0.20, rdBolt.y, rdBolt.z, TD89_REAR_ANGLE);
      vBox(bP, 0.035, 0.022, 0.035, cSTEEL,  0.20, rdBolt.y, rdBolt.z, TD89_REAR_ANGLE);
    }
    var rdLamp = td89RearPoint(0.72, 0.013);
    vBox(gP, 0.12, 0.035, 0.09, gTAIL, -0.70, rdLamp.y, rdLamp.z, TD89_REAR_ANGLE);
    vBox(gP, 0.12, 0.035, 0.09, gTAIL,  0.70, rdLamp.y, rdLamp.z, TD89_REAR_ANGLE);
    vBox(bP, 0.60, 0.05, 4.52, cACC, -1.255, 1.04, 0.00);                  // 翼子板顶1.065略低于甲板1.08:内缘0.955离车侧0.005/外缘1.555盖履带,长4.52两端正对端轮心±2.26
    vBox(bP, 0.60, 0.05, 4.52, cACC,  1.255, 1.04, 0.00);
    // 前后挡泥板:RED_MBT_1六件铰链装配(铰销埋翼端/主板裙板压筋卷边,旧斜板不恢复);销位翼端内收0.035,基准高随翼(yBase=1.04),铰链耳不装(89无耳);倾角避让履带,最小净空0.05+。
    for (var fsgn89 = -1; fsgn89 <= 1; fsgn89 += 2) for (var fsk89 = -1; fsk89 <= 1; fsk89 += 2)
      fenderSix(bP, fsgn89, fsk89, { pinF: 2.225, pinR: -2.225, yBase: 1.04, x0: fsk89 * 0.03, ears: false }, { steel: cSTEEL, dark: cDARK, acc: cACC });
    vBox(bP, 0.16, 0.15, 1.50, cACC, -1.32, 1.135, 0.20);                    // 储物箱截短:底1.06埋翼顶0.005,穿模段删除(随翼下移)
    vBox(bP, 0.16, 0.15, 0.90, cACC, 1.32, 1.135, -0.60);                     // 储物箱截短:同左(随翼下移)
    for (var bl = 0; bl < 5; bl++)
      vBox(bP, 0.025, 0.055, 0.035, cSTEEL, -1.415, 1.085, -0.36 + bl * 0.28); // 左长箱闭锁×5(随翼下移)
    for (var br = 0; br < 3; br++)
      vBox(bP, 0.025, 0.055, 0.035, cSTEEL, 1.415, 1.085, -0.86 + br * 0.30);  // 右箱闭锁×3(随翼下移)
    for (var sk = -1; sk <= 1; sk += 2) {
      // 6 对负重轮:两片式(对标59;轮心上调0.8半径(现0.333),轴连车侧)。
      twinWheelSet(bP, sk, SUSP_SPEC.td89, { rub: cRUBB, steel: cSTEEL, dark: cDARK });   // 摆臂扭杆(首轮朝后,规格表驱动)
      // 托带轮×3删除(顶行自由下坠,对标59无托带轮)。

      // 前主动轮、后诱导轮:两片式(对标59;位置不动)。
      twinEndWheel(bP, sk, { R: 0.20, y: 0.65, z: 2.26, trkX: 1.24, hullX: 0.95 }, { rub: cRUBB, steel: cSTEEL, dark: cDARK });
      twinEndWheel(bP, sk, { R: 0.20, y: 0.62, z: -2.26, trkX: 1.24, hullX: 0.95 }, { rub: cRUBB, steel: cSTEEL, dark: cDARK });
    }
    // 双联车灯严格回到左右翼子板中心线:x=±1.255,灯箱底仅嵌翼面0.015m。
    for (var hsg = -1; hsg <= 1; hsg += 2) {
      var lampX89 = hsg * 1.255, lampY89 = 1.15;   // 灯组随翼下移(灯箱底仍嵌翼面0.015)
      vBox(bP, 0.40, 0.20, 0.15, cDARK, lampX89, lampY89, 1.90);
      for (var hk = -1; hk <= 1; hk += 2) {
        var hx89 = lampX89 + hk * 0.09;
        vCyl(gP, 0.058, 0.058, 0.022, 12, gLENS, hx89, lampY89, 1.986, Math.PI / 2);
        vCyl(bP, 0.069, 0.069, 0.018, 12, cSTEEL, hx89, lampY89, 1.972, Math.PI / 2);
      }
      // 前挡泥板压筋随挡泥板一并删除。
    }
    /* 前牵引钩重贴 60° 首下段(旧竖鼻板已不存在):y0.50 处斜面 z=2.55−(0.09)/tan60°≈2.498,盒体随斜面倾 60° */
    vBox(bP, 0.09, 0.12, 0.14, cSTEEL, -0.50, 0.50, 2.50, Math.PI / 3);       // 前牵引钩×2
    vBox(bP, 0.09, 0.12, 0.14, cSTEEL,  0.50, 0.50, 2.50, Math.PI / 3);
    /* ===== 驾驶员(前右)+动力前置:甲板件全部平嵌 1.08 低甲板(1.44 高甲板=高短感主源,故取 1.08) ===== */
    vBox(bP, 0.50, 0.04, 0.60, cACC, 0.45, 1.078, 0.70);                    // 驾驶员舱盖
    vBox(gP, 0.09, 0.06, 0.12, gPERI, 0.63, 1.088, 0.99);                   // 驾驶潜望镜×3(朝前)
    vBox(gP, 0.09, 0.06, 0.12, gPERI, 0.45, 1.088, 0.99);
    vBox(gP, 0.09, 0.06, 0.12, gPERI, 0.27, 1.088, 0.99);
    // 发动机隔栅迁到前方上首斜甲:底板、七道纵向百叶和四边压框全部与真实斜面共面。
    var EG89=TD89_ENGINE_GRILLE,eg89=td89EngineGrillePoint(0,0,0.018);
    vBox(bP,EG89.w,0.035,EG89.l,cDARK,eg89.x,eg89.y,eg89.z,EG89.angle);
    for (var lv = -3; lv <= 3; lv++) {
      var es89=td89EngineGrillePoint(lv*0.105,0,0.040);
      vBox(bP,0.055,0.018,0.60,cSTEEL,es89.x,es89.y,es89.z,EG89.angle);
    }
    for (var ezs = -1; ezs <= 1; ezs += 2) {
      var ef89=td89EngineGrillePoint(0,ezs*0.315,0.045);
      vBox(bP,0.82,0.020,0.035,cSTEEL,ef89.x,ef89.y,ef89.z,EG89.angle);
    }
    for (var exs = -1; exs <= 1; exs += 2) {
      var er89=td89EngineGrillePoint(exs*0.39,0,0.045);
      vBox(bP,0.035,0.020,0.68,cSTEEL,er89.x,er89.y,er89.z,EG89.angle);
    }
    vCyl(bP, 0.06, 0.06, 0.03, 8, cDARK, -0.72, 1.095, 1.02);                 // 加油盖(随隔栅左移)
    // [2026-09-08] 首尖备用履带板删除(用户要求删RED_TD车体贴附履带板;全车唯一一块)
    // [2026-09-08] 炮管行军固定架及卡扣删除(用户要求删中间短T形条)
  }
  /* ===== 89 式后置战斗室(复合斜颊版):长 2.83×高 0.96 的低扁长楔;侧视正脸后倾 62°,
       平面视图再把左右前颊各向后斜切 0.34m,仅保留中央 0.64m 主炮宽度平直面。主壳由 td89CasemateGeo
       一次闭合成型,不以多个盒子拼装,正脸/斜颊/顶/侧/尾/底连续且不漏风。 ===== */
  function turretParts89(tP, gP, mP) {
    visPartPush(tP, cBODY, td89CasemateGeo(), 0, 0, 0);             // 单一封闭旋转炮塔主壳(视觉与命中共形)
    // [2026-09-08] 炮塔座圈裙删除(与甲板共面闪烁根源的遮羞件;塔降埋甲板5mm后不再需要,检视视角下即那块压着的方形板)
    /* ===== 炮根总成:喉板仍封在脸后;粗铸座、套环与 gunPivot/整根炮管统一沿 +Z 外拉 TD89_GUN_PULL,
         保持同轴相对位置不变。铸座跨过中央平直面并露出约 0.27m,不再完全埋进炮塔。 ===== */
    vBox(tP, 0.60, 0.68, 0.04, cDARK, 0, 0.44, 1.243, -0.488);                 // 炮位喉板(y0.10~0.78 封脸穿口摆带,深色凹膛)
    // 参考线框:炮根为大直径多褶帆布防盾,不是单薄双圆柱;整体随俯仰但不随后坐。
    visPartPush(mP,cCANVAS,td89MantletGeo(),0,0,0);                           // 与命中壳共用的闭合帆布/钢颈包络
    vCyl(mP, 0.325, 0.325, 0.045, 14, cDARK, 0, 0, -0.12, Math.PI / 2);        // 三道折褶压环(14段)
    vCyl(mP, 0.315, 0.315, 0.040, 14, cDARK, 0, 0, 0.01, Math.PI / 2);
    vCyl(mP, 0.285, 0.285, 0.040, 14, cDARK, 0, 0, 0.16, Math.PI / 2);
    vCyl(mP, 0.19, 0.23, 0.22, 12, cACC, 0, 0, 0.34, Math.PI / 2);             // 前铸钢套环接身管(12段)
    /* ===== 顶置附件全量解析锚固(不用固定 Y 坐标)。 ===== */
    var cmdRoof89 = td89RoofY(0.40, 0.02), cmdY89 = cmdRoof89 + 0.020;
    vCyl(tP, 0.24, 0.26, 0.15, 14, cACC, 0.40, cmdY89, 0.02);                 // 指挥塔底嵌顶面0.01
    vCyl(tP, 0.23, 0.23, 0.045, 14, cDARK, 0.40, cmdY89 + 0.0875, 0.02);     // 舱盖咬合指挥塔上缘
    var cmdPerY89 = cmdY89 + 0.035;
    vBox(gP, 0.05, 0.04, 0.05, gPERI, 0.40, cmdPerY89, 0.26);
    vBox(gP, 0.05, 0.04, 0.05, gPERI, 0.40, cmdPerY89, -0.22);
    vBox(gP, 0.05, 0.04, 0.05, gPERI, 0.63, cmdPerY89, 0.02);
    vBox(gP, 0.05, 0.04, 0.05, gPERI, 0.17, cmdPerY89, 0.02);

    var gsRoof89 = td89RoofY(0.36, 0.86), gsY89 = gsRoof89 + 0.010;   // 炮长瞄具簇下沉0.020贴冠顶(盒+镜刚性跟随)
    vBox(tP, 0.16, 0.09, 0.18, cDARK, 0.36, gsY89, 0.86);                    // 炮长瞄具底嵌前顶0.015
    vBox(gP, 0.10, 0.05, 0.03, gGLASSD, 0.36, gsY89 + 0.005, 0.965);
    var loadRoof89 = td89RoofY(-0.42, 0.02);
    vCyl(tP, 0.23, 0.23, 0.045, 12, cACC, -0.42, loadRoof89 + 0.0125, 0.02);  // 装填手盖底嵌冠顶0.01
    var periRoof89 = td89RoofY(-0.40, 0.72);
    vBox(gP, 0.07, 0.045, 0.09, gPERI, -0.40, periRoof89 - 0.0025, 0.72);    // 顶潜望镜消除浮空(下沉0.015)

    var antRoof89 = td89RoofY(-0.56, -1.00);
    vCyl(tP, 0.020, 0.026, 0.05, 6, cDARK, -0.56, antRoof89 + 0.015, -1.00);
    vCyl(tP, 0.007, 0.007, 1.00, 4, cDARK, -0.56, antRoof89 + 0.530, -1.00);

    // 最新参考所需车长高射机枪:旋架、盾、机匣、枪管和弹箱整体随局部冠顶下移,逐件保持互嵌。
    var mgRoof89 = td89RoofY(-0.42, -0.10);
    vBox(tP, 0.12, 0.03, 0.12, cSTEEL, -0.42, mgRoof89 + 0.005, -0.10);   // 机枪小基座:薄板贴冠顶弧面,上咬旋架/下嵌顶面0.01
    vCyl(tP, 0.035, 0.040, 0.09, 8, cDARK, -0.42, mgRoof89 + 0.035, -0.10);
    vBox(tP, 0.34, 0.25, 0.025, cACC, -0.42, mgRoof89 + 0.130, -0.20);    // 防盾下移0.05,底缘距顶0.005消除浮空
    vBox(tP, 0.13, 0.12, 0.34, cDARK, -0.42, mgRoof89 + 0.100, 0.00);     // 机匣下移0.05,后段咬合旋架
    vCyl(tP, 0.014, 0.014, 0.68, 8, cDARK, -0.42, mgRoof89 + 0.110, 0.50, Math.PI / 2); // 枪管下移0.05,后咬机匣0.01
    vBox(tP, 0.15, 0.20, 0.11, cSTEEL, -0.29, mgRoof89 + 0.070, -0.02);   // 弹箱下移0.05并靠拢机匣,侧嵌机匣0.01/底嵌顶面0.03

    var indRoof89 = td89RoofY(0.48, 0.45), indY89 = indRoof89 + 0.015;   // 独立瞄具下沉0.015(盒+镜刚性跟随)
    vBox(tP, 0.10, 0.08, 0.12, cSTEEL, 0.48, indY89, 0.45);                  // 右前独立瞄具底嵌顶面0.01
    vBox(gP, 0.07, 0.06, 0.035, gPERI, 0.48, indY89 + 0.010, 0.525);
    // [2026-09-08 弧面贴合底座]顶置件按td89RoofY冠顶高度就位后,各加小底座(半埋入冠面消角隙,取小值)
    vCyl(tP, 0.26, 0.30, 0.016, 14, cDARK, 0.40, cmdRoof89 - 0.058, 0.02);    // 指挥塔座圈
    vBox(tP, 0.20, 0.026, 0.22, cDARK, 0.36, gsRoof89 - 0.043, 0.86);        // 炮长镜座盒
    vCyl(tP, 0.23, 0.26, 0.055, 12, cDARK, -0.42, loadRoof89 - 0.0325, 0.02); // 装填手盖围圈
    vBox(tP, 0.11, 0.021, 0.13, cDARK, -0.40, periRoof89 - 0.0255, 0.72);    // 顶潜望镜座
    vCyl(tP, 0.026, 0.056, 0.014, 8, cDARK, -0.56, antRoof89 - 0.012, -1.00); // 天线座盘
    vBox(tP, 0.14, 0.021, 0.16, cDARK, 0.48, indRoof89 - 0.0305, 0.45);      // 独立瞄具座
    for (var sg = -1; sg <= 1; sg += 2) {
      /* 每侧只保留前方3管,基座相应缩短;整体下移0.06消除浮空,内侧贴壁条适配斜颊。 */
      vBox(tP, 0.040, 0.10, 0.40, cDARK, sg * 0.895, 0.44, 0.67);   // 烟幕弹小基座:内嵌侧甲/外咬发射基座,贴斜颊弧面
      vBox(tP, 0.060, 0.20, 0.48, cDARK, sg * 0.925, 0.47, 0.67);      // 前三管短基座,内侧咬合侧甲
      for (var sm89 = 0; sm89 < 3; sm89++) {
        var smZ89 = 0.82 - sm89 * 0.15;
        vCyl(tP, 0.041, 0.046, 0.30, 8, cSTEEL, sg * 0.985, 0.51, smZ89,
          0.30, 0, -sg * 0.42);                                      // 轴线向外、向上并微朝前
      }
      /* 连续式侧储物篮:网面(4纵杆+5立柱)外移立于托梁外侧面上,前后端网墙把网面锚回冠形侧壁,托梁纵贯承柱。
         [2026-09重构2]网面外移接托梁外侧/删4横脚铆钉与侧吊耳短横条/补前后端网墙;端杆内端埋壁,杆柱梁端环环相焊。 */
      for (var rail89 = 0; rail89 < 4; rail89++)
        vBox(tP, 0.026, 0.026, 1.44, cSTEEL, sg * 1.023, 0.26 + rail89 * 0.11, -0.34);   // 纵杆整体下移0.06,两端收进前后角柱内(旧伸出0.027)
      for (var post89 = 0; post89 < 5; post89++)
        vBox(tP, 0.026, 0.37, 0.026, cSTEEL, sg * 1.020, 0.405, 0.38 - post89 * 0.36);   // 立柱整体下移0.06,顶收进顶杆内(旧高出0.037)
      for (var endY89 = 0; endY89 < 3; endY89++) {
        vBox(tP, 0.20, 0.026, 0.026, cSTEEL, sg * 0.93, 0.315 + endY89 * 0.11, 0.38);    // 前端网墙下移0.06(内端埋壁/外端交柱杆)
        vBox(tP, 0.16, 0.026, 0.026, cSTEEL, sg * 0.95, 0.315 + endY89 * 0.11, -1.06);   // 后端网墙下移0.06(后壁外扩,杆短一截)
      }
      vBox(tP, 0.10, 0.035, 1.46, cDARK, sg * 0.970, 0.23, -0.34);              // 篮底托梁下移0.06(网面立其外侧面,纵贯承柱)
      for (var hk89 = 0; hk89 < 3; hk89++)
        vBox(tP, 0.10, 0.040, 0.040, cSTEEL, sg * 0.925, 0.23, -0.90 + hk89 * 0.56); // 托梁小吊耳×3:内嵌侧壁/外咬托梁,消除篮体浮空
    }
    // Keep the two side mesh baskets and leave the turret rear wall exposed.
  }
  /* ===== 89 式 120mm 长身管滑膛炮:热护套两段 + 抽烟装置【72% 处】+ 炮口裸段收锥,无炮口制退器;
       整个 gunPivot 随炮根外拉 0.44m,局部结构/身管长度保持不变,膛口世界位变为 (0,1.56,5.69,随炮塔下移0.01)。 ===== */
  function gunParts89(uP) {
    vCyl(uP, 0.16, 0.23, 0.50, 16, cCANVAS, 0, 0, 0.56, Math.PI / 2);        // 帆布防尘罩前段紧贴炮根(z0.31~0.81)
    vCyl(uP, 0.105, 0.115, 4.51, 12, cDARK, 0, 0, 2.255, Math.PI / 2);       // 身管母管(z0~4.51,后嵌炮尾铸座)
    vCyl(uP, 0.140, 0.140, 1.58, 12, cDARK, 0, 0, 2.46, Math.PI / 2);        // 热护套前段(z1.67~3.25)
    vCyl(uP, 0.136, 0.136, 1.26, 12, cDARK, 0, 0, 3.88, Math.PI / 2);        // 热护套中段(z3.25~4.51)
    vCyl(uP, 0.150, 0.150, 0.05, 12, cDARK, 0, 0, 1.67, Math.PI / 2);        // 护套卡箍×3
    vCyl(uP, 0.150, 0.150, 0.05, 12, cDARK, 0, 0, 2.46, Math.PI / 2);
    vCyl(uP, 0.148, 0.148, 0.05, 12, cDARK, 0, 0, 3.25, Math.PI / 2);
    vCyl(uP, 0.165, 0.168, 0.72, 12, cDARK, 0, 0, 4.15, Math.PI / 2);        // 抽烟装置(z3.79~4.51=出炮口段 72% 程)
    vCyl(uP, 0.088, 0.104, 1.14, 12, cDARK, 0, 0, 5.08, Math.PI / 2);        // 炮口裸段(向前收锥,尖径 0.176)
    vCyl(uP, 0.05, 0.05, 0.02, 8, cTRACK, 0, 0, 5.645, Math.PI / 2);         // 膛口暗膛盘(面嵌管口)
  }
  /* ============ 59 式精修·细节回挂版(建模精细化+添加细节+修形) ============
     走行几何(带底 0.00/净空 0.30/前后轮包覆/x[0.965,1.515]/23.8° 首上)零改动;本轮回挂 27 件细节+2 修形,
     全部先过锚面解析(穹面方程 (x²+z²)/0.9604+y²/0.3934=1 / 首上法向 rx 0.4153 / 翼顶 1.155 切嵌),
     法向嵌入 ≥0.02 绝悬浮·绝环缝(上轮平底盖环缝 0.05、抓手悬空 0.06 皆缺此复核);零新 Mesh、零 draw call、零 Math.random。
     炮塔系:车长/装填手双舱盖(倾斜座圈+盖,法向 euler 见件注)+通风穹球(钉平 UV)+车长周视潜望镜×2(玻璃)
            +高射机枪(旋架/机匣/枪管竖直叠嵌)+天线座+软鞭(尖 2.605=敌 3.42×0.761);
     炮系:炮盾帆布罩环(跨球面出线 z-0.088,埋后露前 0.094);
     车体系:圆油桶×2+箍带×4(凸桶面 0.013)、自救木+捆带×2(弦吻角隙≤0.001)、排气管+消音段(隙 0.015)、
            工具箱×2、前挡泥小翼×2(修形,后段嵌翼板腹)、散热格栅(顶离甲板 0.023)+加油盖、
            首上大灯×2(碗+玻璃透镜,凸 0.015,法向贴首上)。
     高度口径:质量顶 1.80(bin≥16 直方图)/穹顶尖 1.787 不变;天线/高机枪管=细件尖(2.605/2.089),不入质量顶。 ---- */
  /* ============ 59 式(T-54A)我方专属形象——走行系口径(全部经坐标解析复核;命中盒/装甲/muzzle 局部不动) ============
     ① 贴地净空:带底 y0.00 精确贴地,车底平面 0.30 → 净空 0.30(真车 0.425m/缩尺 1.31≈0.32);
        全轮系随带底口径(大轮 0.42/0.36、小轮 0.525,主动轮同层);
     ② 车尾包主动轮:甲板后端 z-2.45(越主动轮后缘 -2.411),
        垂直面高 0.55((-2.45,0.58)),主动轮顶 0.795 全数收入车体侧影;
     ③ 车尾下斜边向下内收:(-2.45,0.58)→(-2.20,0.30)(dz 0.25,41.8°),侧影底边收于轮系内侧;
     ④ 履带不嵌车体:履带 x[0.965,1.515](中心 1.24),内缘离车侧 0.015;轮系/翼子板同轴
        (翼子板宽 0.52,外沿 1.535 盖履带侧 1.515 出檐 0.02,内缘 1.015 贴座圈裙);
     ⑤ 前部车体包诱导轮:"<"首鼻尖折点 (2.50,0.68) 越诱导轮前缘(顶 0.795/前缘 2.411)0.089,
        首上 (1.48,1.13)→(2.50,0.68) 23.8° 长坡在轮心 z2.141 处 y0.838 盖顶 0.043;甲板平面段 0.50=舱盖径标尺。
     轮系布局(五轮 z=1.50-i·0.75、端抬 0.06、小轮骑斜边)与炮轴 y0.23、座圈/穹顶/舱盖/潜望镜口径照旧;
     轮件错层:辋面=履带侧-0.0125(1.5025)/毂面=+0.015(1.53)/盖面 1.545,可交面层距 ≥0.0125。 ---- */
  function hullParts59(bP, gP) {                       // —— 车体:倒梯形履带(贴地)/"<"缓首棱柱(包诱导轮)/翼子板/轮系/舱盖/座圈 ——
    // 分段式履带(简化):沿59物理环路 trackLoop59(底切五轮/跨段外切/顶行sin²下坠)按节距0.185断板,
    // Add hinge pins and center guide teeth to each segmented track plate.
    for (var tr59 = -1; tr59 <= 1; tr59 += 2) {
      var loop59 = trackLoop59(), LM59 = loop59.length, i59;
      var cum59 = [0];
      for (i59 = 1; i59 <= LM59; i59++) cum59.push(cum59[i59 - 1] + Math.hypot(loop59[i59 % LM59][0] - loop59[i59 - 1][0], loop59[i59 % LM59][1] - loop59[i59 - 1][1]));
      var len59 = cum59[LM59], n59 = Math.round(len59 / 0.185), st59 = len59 / n59;
      var ccx59 = 0, ccy59 = 0;
      for (i59 = 0; i59 < LM59; i59++) { ccx59 += loop59[i59][0]; ccy59 += loop59[i59][1]; }
      ccx59 /= LM59; ccy59 /= LM59;
      function at59(s) {
        s = ((s % len59) + len59) % len59;
        var lo = 0, hi = LM59;
        while (lo < hi - 1) { var m59 = (lo + hi) >> 1; if (cum59[m59] <= s) lo = m59; else hi = m59; }
        var A59 = loop59[lo % LM59], B59 = loop59[(lo + 1) % LM59], t59 = (s - cum59[lo]) / ((cum59[lo + 1] - cum59[lo]) || 1);
        return [A59[0] + (B59[0] - A59[0]) * t59, A59[1] + (B59[1] - A59[1]) * t59];
      }
      for (i59 = 0; i59 < n59; i59++) {
        var pA59 = at59(i59 * st59), pB59 = at59((i59 + 1) * st59), pC59 = at59((i59 + 0.5) * st59);
        var dZ59 = pB59[0] - pA59[0], dY59 = pB59[1] - pA59[1], dl59 = Math.hypot(dZ59, dY59) || 1;
        var rx59 = Math.atan2(-dY59, dZ59);
        _suspRollTag((i59 + 0.5) * st59);                                                 // ★滚动标签(板心弧长)
        vBox(bP, 0.55, 0.05, 0.175, cDARK, tr59 * 1.24, pC59[1], pC59[0], rx59, 0, 0);   // 履带板(节距0.185留0.01缝,厚0.05)
        _suspRollTag(i59 * st59);                                                         // 铰链销在节缝
        vCyl(bP, 0.03, 0.03, 0.50, 8, cSTEEL, tr59 * 1.24, pA59[1], pA59[0], 0, 0, Math.PI / 2);   // 铰链销(节缝处,径向微凸0.005)
        var tz59 = dZ59 / dl59, ty59 = dY59 / dl59, qz59 = -ty59, qy59 = tz59;   // 内法线=切线垂向取朝环心者(质心判向,直道精确)
        if (qz59 * (ccx59 - pC59[0]) + qy59 * (ccy59 - pC59[1]) < 0) { qz59 = -qz59; qy59 = -qy59; }
        _suspRollTag((i59 + 0.5) * st59);
        vBox(bP, 0.10, 0.08, 0.06, cDARK, tr59 * 1.24, pC59[1] + qy59 * 0.065, pC59[0] + qz59 * 0.065, rx59, 0, 0);   // 定位齿(每板一块,内侧;端轮已开齿槽故弧区不断齿)
        _suspTagClear();
      }
    }
    // 履带(端轮抬高内收+连接杆收纳;低鼓外悬/斜边外撇/杆出包络均不成立):filleted 四边形中心线
    //   (TRACK_POLY:双鼓包绕弧=轮心公切圆 R0.33/0.31(全包鼓轮)/顶边微后倾随主动轮下沉 0.02/斜边内收下行到底足
    //   切点 ±2.12≈轮1前/轮5后缘外/底边贴地,圆角 0.24~0.33 全 fillet 零折角);
    // Segmented plates follow the same centerline; the tread UV uses arc length / 0.185m.
    // 贴履带板纹路;带底 y0.00 贴地/带顶 ≈1.00/x[0.965,1.515] 照旧,带尖 2.66/−2.66(翼板收口 2.47/−2.42,尖区改由挡泥板组覆)
    vPrism(bP,cBODY,0.95,T59_HULL_PTS,0,0,0);          // 车体视觉/命中共享唯一六折截面;底平面0.30;
                                                       // "<"鼻尖 (2.50,0.68);导向轮抬 0.62/顶 0.90 前缘 2.56(微出车头=真车读感),首上 23.8° 长坡照旧;
                                                       //   全平甲板 1.13 后延至 -2.45 包主动轮+尾垂直面 0.55+下斜边内收 41.8°
    vBox(bP, 0.60, 0.05, 4.90, cACC, -1.252, 1.055, 0.025);  // 左翼子板(两端收口:5.42→4.90,z[-2.42,2.47]——削前越首 0.24/后越尾 0.29 悬挑,前端面离首面 2.50 达 0.03/后端面离尾面 -2.45 达 0.03 绝同向近距共面;
    vBox(bP, 0.60, 0.05, 4.90, cACC,  1.252, 1.055, 0.025);  // 右 内缘 0.952 贴车侧 0.95(留0.002绝穿模)/外沿 1.552 盖履带侧 1.515 出檐 0.037/底 1.030([2026-09]翼外移0.04下调0.04;[2026-09-08]翼内收0.013接车身,挂件裙板随动)
    for (var sk = -1; sk <= 1; sk += 2) {
      // 1 2345 布局(三视图:轮1 离 2345 稍远/后四互贴,五轮均摊不符实车。缝:1-2=0.15(占径 20%)/2-5=0.05 互贴)
      // —— 摆臂式悬挂(前后倾,59专用):1号轮向后摆/余轮向前摆,臂长0.369≈轮径;上铰座贴壁(不穿入),臂下端埋内盘 ——
      for (var w59 = 0; w59 < 5; w59++) {
        var wz59 = [1.635, 0.735, -0.065, -0.865, -1.665][w59];
        var fdir59 = (w59 === 0) ? -1 : 1;   // 摆向:首轮后摆/余轮前摆
        var zb59 = wz59 + fdir59 * 0.193;
        vBox(bP, 0.06, 0.10, 0.10, cSTEEL, sk * 0.98, 0.5945, zb59);   // 摆臂上铰座(车体侧固定件,不随摆臂转)
        _suspWheelSpinTag(w59, zb59, 0.5945, fdir59, 0.375);               // ★转子 tag(摆动+自转,R=轮盘半径):盘/轴/毂/盖/螺栓
        vCyl(bP, 0.375, 0.375, 0.14, 14, cRUBB, sk * 1.10, 0.2875, wz59, 0, 0, Math.PI / 2);   // 内半盘(齿槽[1.17,1.31]容齿[1.19,1.29])
        vCyl(bP, 0.375, 0.375, 0.14, 14, cRUBB, sk * 1.38, 0.2875, wz59, 0, 0, Math.PI / 2);   // 外半盘
        vCyl(bP, 0.07, 0.07, 0.18, 8, cSTEEL, sk * 1.24, 0.2875, wz59, 0, 0, Math.PI / 2);    // 盘间转轴(连内外盘,走齿槽中,两端各埋盘0.02)
        // —— 两半式盘组(双盘+中缝走齿,wy0.2875盘底与板内面相切;轮毂轴盖削薄) ——
        vCyl(bP, 0.25, 0.25, 0.05, 12, cSTEEL, sk * 1.465, 0.2875, wz59, 0, 0, Math.PI / 2);  // 轮毂(削薄0.17→0.05,咬外盘0.01/凸出0.04)
        vCyl(bP, 0.11, 0.11, 0.04, 8, cDARK, sk * 1.50, 0.2875, wz59, 0, 0, Math.PI / 2);     // 轴盖(削薄0.06→0.04,咬轮毂0.01/凸出0.02)
        wheelBoltRing(bP, sk, 1.49, 0.2875, wz59, 0.17, cDARK);   // 毂面螺栓圈×6(转子角向特征)
        _suspTagClear();
        _suspWheelTag(w59, zb59, 0.5945, fdir59);                      // ★摆臂 tag(只摆动):摆臂
        vCyl(bP, 0.045, 0.045, 0.369, 8, cSTEEL, sk * 1.015, 0.441, wz59 + fdir59 * 0.0965, fdir59 * 0.5616, 0, sk * 0.1907);   // 摆臂(轮心→铰座,前后倾)
        _suspTagClear();
      }
      // —— 端轮抬高内收:导向轮心 (0.49,2.32)→(0.62,2.28,抬 0.13/收 0.04)、主动轮心 (0.49,-2.32)→(0.60,-2.30,抬 0.11/收 0.02 且低于导向轮 0.02=传动轮下沉);连接杆全收纳:杆底≥车底 0.30 区/前后下斜板线上方、z∈(-2.45,2.50) 包络内 ——
      // —— 端轮两半式(与负重轮同齿槽[1.17,1.31],弧区定位齿由此通过;轮心高/弧包络不动) ——
      _suspEndWheelTag(2.28, 0.62, 0.28);   // 诱导轮转子 tag(只自转):盘/轴/毂(轮轴静态不进 tag)
      vCyl(bP, 0.28, 0.28, 0.14, 16, cRUBB, sk * 1.10, 0.62, 2.28, 0, 0, Math.PI / 2);  // 诱导轮内半盘:@前鼓公切弧心 (2.28,0.62)
      vCyl(bP, 0.28, 0.28, 0.14, 16, cRUBB, sk * 1.38, 0.62, 2.28, 0, 0, Math.PI / 2);  // 诱导轮外半盘
      vCyl(bP, 0.07, 0.07, 0.18, 8, cSTEEL, sk * 1.24, 0.62, 2.28, 0, 0, Math.PI / 2);  // 盘间转轴(连内外盘,走齿槽中)
      vCyl(bP, 0.17, 0.17, 0.08, 12, cSTEEL, sk * 1.46, 0.62, 2.28, 0, 0, Math.PI / 2); // 毂(削薄0.17→0.08,咬外盘0.03/凸出0.05)
      wheelBoltRing(bP, sk, 1.50, 0.62, 2.28, 0.115, cDARK);
      _suspTagClear();
      vCyl(bP, 0.09, 0.09, 0.15, 8, cSTEEL, sk * 1.025, 0.62, 2.28, 0, 0, Math.PI / 2);  // 诱导轮轴(连轮盘与车身,内端贴壁x0.95不穿入)
      _suspEndWheelTag(-2.30, 0.60, 0.26);   // 主动轮转子 tag(只自转)
      vCyl(bP, 0.26, 0.26, 0.14, 16, cRUBB, sk * 1.10, 0.60, -2.30, 0, 0, Math.PI / 2); // 主动轮内半盘:@后鼓公切弧心 (-2.30,0.60,低于导向轮 0.02 落实"传动轮往下")
      vCyl(bP, 0.26, 0.26, 0.14, 16, cRUBB, sk * 1.38, 0.60, -2.30, 0, 0, Math.PI / 2); // 主动轮外半盘
      vCyl(bP, 0.07, 0.07, 0.18, 8, cSTEEL, sk * 1.24, 0.60, -2.30, 0, 0, Math.PI / 2); // 盘间转轴(连内外盘,走齿槽中)
      vCyl(bP, 0.17, 0.17, 0.08, 12, cSTEEL, sk * 1.46, 0.60, -2.30, 0, 0, Math.PI / 2);// 毂(削薄0.17→0.08,咬外盘0.03/凸出0.05)
      wheelBoltRing(bP, sk, 1.50, 0.60, -2.30, 0.115, cDARK);
      _suspTagClear();
      vCyl(bP, 0.09, 0.09, 0.15, 8, cSTEEL, sk * 1.025, 0.60, -2.30, 0, 0, Math.PI / 2); // 主动轮轴(连轮盘与车身,内端贴壁x0.95不穿入)
    }
    vCyl(bP, 0.24, 0.25, 0.045, 12, cACC, -0.45, 1.142, 1.23);   // 驾驶舱盖(12段)
    // 舱盖前观察镜(车体平面与斜面折角处 z1.48/y1.13,舱盖前缘)
    vBox(bP, 0.20, 0.06, 0.04, cDARK, -0.45, 1.16, 1.50);    // 观察镜框(立式朝前,底y1.13贴甲板/顶y1.19)
    vBox(gP, 0.16, 0.04, 0.02, gGLASS, -0.45, 1.16, 1.52);   // 观察镜片(镜框前方0.02)
    vBox(gP, 0.07, 0.04, 0.05, gPERI, -0.62, 1.145, 0.97);       // 潜望镜×2(玻璃,舱盖前缘甲板 0.97:底嵌甲板 0.005;前移 0.07 下舱盖盘缘 0.015,绝顶面 0.0105 共面条)
    vBox(gP, 0.07, 0.04, 0.05, gPERI, -0.28, 1.145, 0.97);
    // —— 细节回挂(每件先过锚面解析:翼顶 1.155 切嵌/首上法向 23.8°(rx 0.4153);数值=解析复核,详见 build-log) ——
    // 左翼子板工具:2 方形油箱首尾相接 + 工具箱
    //   两箱间隔 0.10(z-1.675→-1.575);端盖凸缘 cSTEEL 0.28×0.24×0.03 贴两端
    // 油箱=扁平缺角方形+×筋(visPartPush+prismGeo+rz=π/2 使五边形截面=水平俯瞰)
    visPartPush(bP, cDARK, prismGeo(0.075, [[-0.275,-0.13],[0.275,-0.13],[0.275,0.08],[0.225,0.13],[-0.275,0.13]]), -1.37, 1.150, -1.95, 0, 0, Math.PI / 2);  // 油箱①(后)扁平缺角方形(高0.15/缺前角0.05×0.05)
    visPartPush(bP, cDARK, prismGeo(0.075, [[-0.275,-0.13],[0.275,-0.13],[0.275,0.08],[0.225,0.13],[-0.275,0.13]]), -1.37, 1.150, -1.30, 0, 0, Math.PI / 2);  // 油箱②(前)扁平缺角方形
    vBox(bP, 0.30, 0.16, 0.42, cSTEEL, -1.315, 1.165, 1.10);                    // 工具箱主体(前区,底嵌0.005,z[0.89,1.31])
    vBox(bP, 0.32, 0.02, 0.44, cDARK, -1.315, 1.253, 1.10);                     // 工具箱盖凸台
    vBox(bP, 0.04, 0.03, 0.06, cDARK, -1.315, 1.268, 1.10);                     // 工具箱锁扣
    vCyl(bP, 0.035, 0.035, 1.25, 8, cDARK, -1.17, 1.110, -1.575, Math.PI / 2); // 排气管(8段)
    vCyl(bP, 0.05, 0.05, 0.55, 8, cDARK, -1.17, 1.110, -2.02, Math.PI / 2);    // 消音段(8段)
    vBox(bP, 0.28, 0.16, 0.45, cSTEEL, 1.315, 1.140, 0.50);                     // 工具箱①(右前翼板,随降,z[0.275,0.725],底嵌 0.02)
    vBox(bP, 0.28, 0.16, 0.30, cSTEEL, 1.315, 1.140, 1.095);                    // 工具箱②(z[0.945,1.245],让开挡泥小翼)
    // 前后挡泥板×4:采用铰链六件式,限制外端越界和翼板悬挑穿模。
    //   锚面解析:铰销 (1.095,前2.435/后-2.385) 埋翼板端内 0.035;铰耳×2 上 1.0875 嵌翼板底 0.0175/下 1.0125 包销;主板 S0~0.16 宽 0.54+裙板 S0.16~0.34 宽 0.58 阶梯外扩;
    //   坡角 0.60(tan 0.6841):板尖 (0.953,前 2.716/后 -2.666) 覆鼓形带尖 ±2.661 出檐 0.055/0.005(垂空,真车覆鼓读感);板底→带面净距:前 @z2.661 = 0.975-0.65 = 0.325 / 后 0.29(≥0.02 硬闸);
    //   压筋×2 跨板缝(底嵌板面 0.002,法向层距 0.019≥0.0125 零共面)+下缘卷边 rx0.95(嵌入裙板尖下侧=卷唇)。——
    for (var fsgn = -1; fsgn <= 1; fsgn += 2) for (var fsk = -1; fsk <= 1; fsk += 2)
      fenderSix(bP, fsgn, fsk, { pinF: 2.435, pinR: -2.385, yBase: 1.055, x0: fsk * 0.027, ears: false }, { steel: cSTEEL, dark: cDARK, acc: cACC });   // 59:翼组外移/下调(内收0.013随翼,铰链耳删除)
    // —— 细节:首下牵引钩 ——
    vBox(bP, 0.09, 0.10, 0.12, cSTEEL, -0.55, 0.5628, 2.4113, -1.1297);         // 首下牵引钩×2(法向贴鼻板 rx-1.1297,嵌 0.03 露 0.03;真车 T-54 首下双钩)
    vBox(bP, 0.09, 0.10, 0.12, cSTEEL,  0.55, 0.5628, 2.4113, -1.1297);
    // 后部上平面"田"字四隔栅(单一大隔栅→2×2 排列,前:后宽=3:2)
    //   x 两列等宽(各0.52,间隔0.06):左 x[-0.55,-0.03]/右 x[0.03,0.55]
    //   z 两行 前:后=3:2(前0.306/后0.204,行间间隔0.04):前 z[-1.931,-1.625]/后 z[-2.175,-1.971]
    for (var gx = -1; gx <= 1; gx += 2) {                  // 左右两列(中心 ±0.29)
      var gxC = gx * 0.29;
      // 田字隔栅长×1.2+金属框架(z向0.286→0.343/0.184→0.221,框架cSTEEL比隔栅大0.02/边)
      vBox(bP, 0.53, 0.022, 0.383, cSTEEL, gxC, 1.139, -1.778);                 // 前格金属框架(外框)
      vBox(bP, 0.49, 0.02, 0.343, cDARK, gxC, 1.142, -1.778);                    // 前格底板(1.2倍长)
      for (var gf = 0; gf < 3; gf++)
        vBox(bP, 0.45, 0.015, 0.05, cSTEEL, gxC, 1.158, -1.900 + gf * 0.122, 0, 0, 0);  // 前格条纹×3(间距0.122)
      vBox(bP, 0.53, 0.022, 0.281, cSTEEL, gxC, 1.139, -2.101);                 // 后格金属框架
      vBox(bP, 0.49, 0.02, 0.221, cDARK, gxC, 1.142, -2.101);                    // 后格底板(1.2倍长)
      for (var gb = 0; gb < 2; gb++)
        vBox(bP, 0.45, 0.015, 0.05, cSTEEL, gxC, 1.158, -2.161 + gb * 0.12, 0, 0, 0);   // 后格条纹×2(间距0.12)
    }
    vCyl(bP, 0.07, 0.07, 0.024, 8, cDARK, 0.62, 1.137, -2.32);                 // 加油盖(8段)
    // —— 首上灯组(真 59=前装甲右侧并排立姿双灯+方形外框,灯轴水平朝正前;碗灯平放斜面/灯轴朝天不符实车) ——
    // 立姿楔形灯座×2(vPrism 截面:前面垂直立起 z=2.255,背缘贴首上 23.8° 坡埋 0.06~0.088(底 0.06/顶 0.088 由共斜度 -2.445 推得),灯口全在坡外);
    //   截面折点 (z,y):前沿 [2.255,0.955]→[2.255,0.80] 垂直,底 [2.168,0.80] 埋坡 0.06,背缘 [1.789,0.955] 共斜埋 0.088
    vPrism(bP, cDARK, 0.095, [[2.255, 0.960], [2.255, 0.7975], [2.1655, 0.7975], [1.789, 0.960]], 0.40, 0, 0); // 右前灯座①(灯口垂直面 z2.255,y[0.7975,0.960];首上右侧两灯位;顶/底离框外棱全 ≥0.0125)
    vPrism(bP, cDARK, 0.095, [[2.255, 0.960], [2.255, 0.7975], [2.1655, 0.7975], [1.789, 0.960]], 0.62, 0, 0); // 右前灯座②(两灯座内缘缝 0.03>0.0125)
    // —— 新增装饰(真 59 特征件;全锚面解析+嵌入/跨嵌,零同向共面) ——
    vBox(bP, 0.09, 0.10, 0.12, cSTEEL, -0.55, 0.75, -2.475);               // 车尾牵引钩×2(前端 -2.415 埋入尾板 0.035,后帽 -2.535 凸板 0.085;真车首尾各双钩)
    vBox(bP, 0.09, 0.10, 0.12, cSTEEL,  0.55, 0.75, -2.475);
    // 尾检修工具箱:中心 y 0.69(箱 y[0.58,0.80],底 0.58 贴尾板竖直面底缘;
    //   顶 0.80 离隔栅底 0.81 留 0.01 间隙;x 让左牵引钩 0.035)
    vBox(bP, 0.42, 0.22, 0.10, cSTEEL, -0.26, 0.69, -2.48);                // 尾检修工具箱(前缘 -2.43 埋尾板 0.02;x 让左牵引钩 0.035)
    // 尾部发动机隔栅:关于 x=0 轴对称全横条 x[-0.62,0.62](总宽 1.24);条纹×4 长 1.20(边距 0.02);
    //   y 中心 0.93/条纹间距 0.056;离牵引钩顶 0.80 留 0.01/工具箱顶 0.80 留 0.01/加油盖底 1.137 留 0.087 零干涉
    vBox(bP, 1.24, 0.24, 0.02, cDARK, 0, 0.93, -2.46);                     // 尾竖直面条栅底板(对称横条 x[-0.62,0.62])
    for (var vgs = 0; vgs < 4; vgs++)
      vBox(bP, 1.20, 0.035, 0.015, cSTEEL, 0, 0.93 + (vgs - 1.5) * 0.056, -2.465);  // 条纹×4(凸出底板0.005)
    vTreadBox(bP, 0.30, 0.035, 0.55, cTRACK, -0.35, 0.85763, 2.09104, 0.4153, 0, 0, 'y');  // 首上左备用履带板①(faces='y' 纹路朝外;沿 n(0,0.91492,0.40364) 下沉 0.0321,板底埋首上 0.020/板顶凸甲面 0.015)
    vTreadBox(bP, 0.30, 0.035, 0.55, cTRACK, -0.70, 0.85763, 2.09104, 0.4153, 0, 0, 'y');  // ②同(板底埋 0.020,同下沉)
    for (var sp5 = 0; sp5 < 2; sp5++) {                 // 备用板立体细节(真 59 履带板=3 横筋+2 中央诱导齿;局部坐标经与板同 Rx(0.4153) 预算世界值):
      var sx5 = sp5 === 0 ? -0.35 : -0.70;              //   筋底嵌板面 0.008/齿嵌 0.004(跨嵌),顶凸板面 0.0135/0.0175≥0.0125(同向平行零共面),零 Math.random 零 draw call
      vBox(bP, 0.30, 0.0215, 0.03, cTRACK, sx5, 0.94715, 1.93816, 0.4153, 0, 0);   // 横筋(板局部 dz-0.176;随板下沉,嵌板 0.008 照旧)
      vBox(bP, 0.30, 0.0215, 0.03, cTRACK, sx5, 0.87616, 2.09921, 0.4153, 0, 0);   // 横筋(板中)
      vBox(bP, 0.30, 0.0215, 0.03, cTRACK, sx5, 0.80517, 2.26025, 0.4153, 0, 0);   // 横筋(dz+0.176)
      vBox(bP, 0.05, 0.0215, 0.05, cTRACK, sx5, 0.91531, 2.02030, 0.4153, 0, 0);   // 中央诱导齿(dz-0.088;嵌板 0.004 照旧)
      vBox(bP, 0.05, 0.0215, 0.05, cTRACK, sx5, 0.84432, 2.18134, 0.4153, 0, 0);   // 中央诱导齿(dz+0.088)
    }
    // 翼板外边条×2(底 1.064 埋翼顶 0.016;4.70→4.56:z[-2.28,2.28] 让新铰位前 0.155/后 0.105;外棱面 1.578 离翼缘外棱面 1.565 达 0.013≥0.0125,内棱面 1.554 跨嵌翼缘)
    vBox(bP, 0.024, 0.045, 4.56, cACC, -1.566, 1.0865, 0);
    vBox(bP, 0.024, 0.045, 4.56, cACC,  1.566, 1.0865, 0);
    // 每灯叠层(全部由背面封死或留级 ≥0.0125/跨嵌,零同向共面):胶垫[2.252,2.267] 背埋座面 0.003 / 方框四棱[2.264,2.289] / 镜片沉框口 0.014;
    vBox(bP, 0.165, 0.020, 0.036, cSTEEL, 0.40, 0.935, 2.271);             // 方形外框×2(四棱合口 z[2.253,2.289]:背端埋灯座面 0.002;上下横棱 0.165 长盖过侧棱端,侧棱 y 收 [0.830,0.925] 与横棱端面零投影交叠)
    vBox(bP, 0.165, 0.020, 0.036, cSTEEL, 0.40, 0.820, 2.271);
    vBox(bP, 0.020, 0.075, 0.036, cSTEEL, 0.3285, 0.8775, 2.271);
    vBox(bP, 0.020, 0.075, 0.036, cSTEEL, 0.4715, 0.8775, 2.271);
    vBox(bP, 0.165, 0.020, 0.036, cSTEEL, 0.62, 0.935, 2.271);
    vBox(bP, 0.165, 0.020, 0.036, cSTEEL, 0.62, 0.820, 2.271);
    vBox(bP, 0.020, 0.075, 0.036, cSTEEL, 0.5485, 0.8775, 2.271);
    vBox(bP, 0.020, 0.075, 0.036, cSTEEL, 0.6915, 0.8775, 2.271);
    // 镜片×2(玻璃):x±0.0685 离侧框面 0.0134/端面 0.0175+、y[0.8235,0.9315] 离横框外棱/侧框端 ≥0.0135、z[2.266,2.275] 被 0.013/沉 0.014——四向同向平行距全 ≥0.0125,棱边仍跨嵌框体=灯口朝正前水平发光
    vBox(gP, 0.137, 0.108, 0.009, gLENS, 0.40, 0.8775, 2.2705);
    vBox(gP, 0.137, 0.108, 0.009, gLENS, 0.62, 0.8775, 2.2705);
  }
  /* ===== 59 炮塔:纯半球铸造穹顶(椭球 0.98×0.6272)+ 座圈裙环;球面 (x²+z²)/0.98² + y²/0.6272² = 1 ===== */
  function turretParts59(tP, gP) {
    var dome = new THREE.SphereGeometry(0.98, 48, 16, 0, TAU, 0, Math.PI * 0.52);   // 48×16 (方案B,肉眼不可辨)
    dome.scale(1, 0.64, 1); uvSetFlat(dome);
    dome = dome59Constrict(dome);                                                      // 前端收束(先变形再开炮翼槽)
    dome = domeCutForMantlet(dome);                                                      // 炮翼域穹胞切除(炮翼裙舌带塞缝,一体铸造零悬浮层)
    visPartPush(tP, cBODY, dome, 0, 0, 0);
    // —— 穹顶内衬壳不建(外穹顶+黑色弧面封板+炮盾完全遮蔽,永不露表面,省 ~9600 三角面)
    // —— 穹顶细节(锚面=穹面方程 (x²+z²)/0.9604 + y²/0.3934 = 1,法线 n 逐件解析;嵌入≥0.02 绝上轮平底盖环缝/抓手悬空) ——
    // —— 舱盖(双盖位于炮塔中部且留间隔;前半并列 z0.21/x±0.28 过近不符实车):
    //    重锚穹面 (x²+z²)/0.9604+y²/0.39343=1 中部点 S=(±0.42,0.56668,0.0)、n=(±0.29052,0.95687,0),纯 rz 欧拉 ∓0.29478;
    //    间隔:盖心 x±0.42(旧 ±0.28)→座圈外沿间净空 0.31,z0.0 居穹顶正中(前让炮盾/后让通风穹 0.42>0.385 平面距)
    vCyl(tP, 0.255, 0.265, 0.08, 14, cDARK, -0.41404, 0.54707, 0.0, 0, 0, 0.29478);             // 车长舱盖座圈(左中):C=S-n·0.0205,底沿埋穹面 0.030
    vCyl(tP, 0.20, 0.21, 0.035, 14, cACC, -0.42712, 0.59013, 0.0, 0, 0, 0.29478);               // 车长盖:C=S+n·0.0245,底埋座圈 0.013
    vCyl(tP, 0.235, 0.245, 0.07, 14, cDARK, 0.41404, 0.54707, 0.0, 0, 0, -0.29478);             // 装填手舱盖座圈(右中):与左盖严格镜像(x→-x)
    vCyl(tP, 0.19, 0.20, 0.03, 14, cACC, 0.42712, 0.59013, 0.0, 0, 0, -0.29478);                // 装填手盖:同镜像(盖顶局部 y≈0.60687)
    var vent = new THREE.SphereGeometry(0.12, 12, 8); vent.scale(1, 0.55, 1); uvSetFlat(vent); // 通风穹(后中,球体手动钉平 UV 防画集条纹)
    visPartPush(tP, cDARK, vent, 0.09829, 0.51313, -0.49145, -0.3661, 0, 0);                       // S(0.10,0.5355,-0.50)、n(0.0713,0.9319,-0.3564):埋 0.024,顶凸 0.042(挪后避让车长座圈:平面距 0.416>0.385)
    vBox(gP, 0.055, 0.065, 0.045, gPERI, -0.42620, 0.51693, 0.42620, 0.33229, 0, 0.21680);    // 车长周视潜望镜×2(随左盖居中期:盖正前 0.42 穹面,S(-0.42,0.49895,0.42)/n(-0.30994,0.89864,0.30994),底埋 0.02)
    vBox(gP, 0.055, 0.065, 0.045, gPERI, -0.20279, 0.57709, 0.40558, 0.28586, 0, 0.18650);    //   其二 S(-0.20,0.55808,0.40)/n(-0.13949,0.95014,0.27897) 同法
    // —— 高射机枪随装填手(右)盖居中整体右移(随盖新位竖直叠嵌照旧;真 59 DShK 在右盖) ——
    vCyl(tP, 0.03, 0.034, 0.05, 10, cDARK, 0.43220, 0.61187, 0.0);                            // 高射机枪旋架:底埋盖顶 0.02(装填手盖顶局部 y≈0.60687)
    vBox(tP, 0.05, 0.06, 0.26, cDARK, 0.43220, 0.65487, 0.0);                                 // 高机机匣:底嵌旋架 0.012
    vCyl(tP, 0.011, 0.011, 0.24, 6, cDARK, 0.43220, 0.79444, -0.06893, -0.42);                // 高机枪管(后上 24°;尖≈塔系 (0.432,0.909,-0.070))
    vBox(tP, 0.07, 0.06, 0.14, cDARK, 0.47720, 0.63807, 0.03);                                // 高机弹箱(右置:壁嵌机匣 0.015;顶差 0.0168 照旧=绝 0.0022 共面对策)
    vBox(tP, 0.12, 0.020, 0.04, cDARK, -0.43322, 0.61022, 0.10, 0, 0, 0.29478);               // 车长盖把手(随盖:C=盖C+n·0.021+t̂(前)·0.10,底嵌 0.004/顶离盖顶 0.016≥0.0125)
    vBox(tP, 0.12, 0.020, 0.04, cDARK, 0.43322, 0.61022, 0.10, 0, 0, -0.29478);               // 装填手盖把手(镜像)
    vCyl(tP, 0.018, 0.022, 0.06, 8, cDARK, -0.10075, 0.49009, -0.62464, -0.4859, 0, 0.0748);  // 天线座:S(-0.10,0.4813,-0.62)、n(-0.0748,0.8786,-0.4637),埋 0.02
    vCyl(tP, 0.006, 0.006, 0.95, 4, cDARK, -0.10, 0.9702, -0.62);                             // 软鞭天线(竖直):尖=世界 2.605=敌 3.42×0.761
    // —— 炮塔装饰升级:塔尾工具箱组+塔侧横抓杆×2(锚面=穹面方程逐件解析;穹面 (x²+z²)/0.9604+y²/0.39343=1) ——
    // 塔尾工具箱:z[-0.83,-0.61]/x±0.24/y[0.13,0.35];底全域嵌球(后底角@z-0.83 壳限 |x|<0.48 口径内,γ<1 解析)/后上棱凸壳 ≤0.03=贴坡厚箱读感(悬臂凸出合法非悬空)
    vBox(tP, 0.48, 0.22, 0.22, cACC, 0, 0.24, -0.72);
    vBox(tP, 0.44, 0.036, 0.18, cACC, 0, 0.350, -0.72);                                // 箱盖微凸台:y[0.332,0.368] 底嵌箱 0.018/顶凸箱顶 0.018≥0.0125(同色错层可读盖缝)
    vBox(tP, 0.05, 0.05, 0.03, cSTEEL, -0.15, 0.30, -0.846);                           // 箱锁扣×2(后向动手侧):z[-0.861,-0.831] 前嵌箱后缘 0.001+(错 EXACT 共面)/不外悬空
    vBox(tP, 0.05, 0.05, 0.03, cSTEEL,  0.15, 0.30, -0.846);
    for (var gq6 = -1; gq6 <= 1; gq6 += 2) {
      vCyl(tP, 0.016, 0.016, 0.20, 6, cSTEEL, gq6 * 0.70, 0.30, -0.40, Math.PI / 2);       // 塔侧横抓杆×2:z[-0.50,-0.30](壳限解析:@(0.30,-0.50) 壳 x0.6998>0.70 杆不外悬/@-0.30 壳 x0.8064)
      vCyl(tP, 0.020, 0.020, 0.04, 6, cSTEEL, gq6 * 0.676, 0.30, -0.32, 0, 0, Math.PI / 2); // 抓杆脚×2/杆:x[0.656,0.696] rzπ/2 沿 x——脚根 0.656 埋壳@(0.30,-0.32) 0.143/@(0.30,-0.48) 0.058
      vCyl(tP, 0.020, 0.020, 0.04, 6, cSTEEL, gq6 * 0.676, 0.30, -0.48, 0, 0, Math.PI / 2);
    }
    /* 炮盾=裸露曲面铸造弧盾,无帆布罩(四视图正视/侧视炮盾区均裸露) */
  }
  /* ===== 59 主炮(真实布局):炮轴塔系 y0.23=穹顶下 1/3;锥台套筒穿球 0.46m + 细身管 + 抽烟装置 + 端箍 ===== */
  /* ===== 炮盾。
     制作铁律:严格按提示词(侧视=不完整扇形/圆环、正视=方形)与四视图参考图,动手前像素级拆解。
     像素拆解实测(uploads/image.png 网格标尺+墨水剖线):正视板体 W30×H32px≈方形(整车宽 3.27m/160px≈20.4mm/px 校准,
     侧负重轮行/炮口行佐证 20~25mm/px 带);镗孔同心三环 外环 R9.5px(Ø0.38)/中环 R6px/镗口暗环 R3.5px;板心左偏 -16px
     竖槽=炮手瞄具窗(与镗孔同高水平);侧视=炮根矩形套筒 8×15px + 斜入穹顶扇形楔块;正视板右下斜切角。
     结构:主盾=与耳轴全同轴的曲面弧盾(侧=环扇切面带/正=方形面),拆分不变:uP=身管总成(独立后坐滑过镗口) /
     mP=炮盾总成(仅随炮枢俯仰,绝不后坐) ===== */
  function gunParts59(uP) {   /* 耳轴沉穹顶 z0.60,以下各件局部 z 全 +0.40 ⇒ 世界位逐分毫照旧(muzzle 世界 (0,1.53,4.15)=1.39+T59_LIFT 冻结=真机制冻结按世界系) */
    vCyl(uP, 0.115, 0.115, 1.04, 12, cDARK, 0, 0, -0.10, Math.PI / 2);   // 炮根套筒后延接炮尾——z[-0.62,0.42]=世界 -0.02~1.02(前缘尖出翼面 0.02,后端没入塔腔接炮尾;扫掠闸 MS2 锁定)
    vCyl(uP, 0.075, 0.088, 3.30, 12, cDARK, 0, 0, 2.05, Math.PI / 2);    // 细长身管后咬套筒 0.02——z[0.40,3.70](口径照旧)
    vCyl(uP, 0.105, 0.105, 0.50, 10, cDARK, 0, 0, 2.70, Math.PI / 2);    // 抽烟装置:管长 2/3 处
    vCyl(uP, 0.095, 0.095, 0.18, 10, cDARK, 0, 0, 3.59, Math.PI / 2);    // 炮口端箍:含 muzzle 局部 3.55(世界 4.15 恒等)
    vCyl(uP, 0.101, 0.101, 0.03, 12, cSTEEL, 0, 0, 1.85, Math.PI / 2);   // 身管工艺箍×2
    vCyl(uP, 0.101, 0.101, 0.03, 12, cSTEEL, 0, 0, 2.25, Math.PI / 2);
  }
  function mantletParts59(tP, tG) {   /* 炮盾总成(用户铁令:炮盾整体后移到主炮根部、内曲面与装甲外曲面贴合、多层饼干):
     静态铸造炮翼并入塔件,mantletSkinGeo 生成——
     背面全幅吻贴穹顶外曲面(缝 0.0008=多层饼干贴合),正面鼓包+承口环(铸造翼块读感),竖槽=炮管扫掠通孔(深色衬壁),
     炮管俯仰/后坐全姿态对实体带净距≥0.002(离线闸 MS2),塔体零缺口/零搭桥件/零扣合断面;机制:muzzle 世界位/命中盒/俯仰域全冻结。 */
    var mw = mantletCastGeo();
    visPartPush(tP, cBODY, mw.skin, 0, 0, 0);                                       // 贴体炮翼本体(穹顶色)
    visPartPush(tP, cDARK, mw.liner, 0, 0, 0);                                      // 竖槽内衬(深钢色=铸造镗口)
    visPartPush(tP, cDARK, mw.plate, 0, 0, 0);                                      // 竖槽黑色装甲弧面封板(删绿色横条改「与炮塔曲面同弧度黑色装甲」填补镂空;随塔固定,炮管根部俯仰穿模板面放行)
    vCyl(tP, 0.018, 0.018, 0.02, 6, cSTEEL, 0.17, 0.325, 0.86177, Math.PI / 2);     // 翼面铆钉×4(半埋鼓包面,z=面−0.008)
    vCyl(tP, 0.018, 0.018, 0.02, 6, cSTEEL, -0.17, 0.325, 0.86177, Math.PI / 2);
    vCyl(tP, 0.018, 0.018, 0.02, 6, cSTEEL, 0.17, 0.135, 0.98281, Math.PI / 2);
    vCyl(tP, 0.018, 0.018, 0.02, 6, cSTEEL, -0.17, 0.135, 0.98281, Math.PI / 2);
    vBox(tP, 0.10, 0.115, 0.04, cDARK, -0.2375, 0.235, 0.90616);                    // 炮手瞄具窗框(四视图正视左槽照旧;背嵌翼面 0.004)
    vBox(tG, 0.082, 0.095, 0.012, gPERI, -0.2375, 0.235, 0.90916);                  //   窗镜(凹框面 0.011)
  }
  /* ===== 火箭炮卡车底盘(实体版):一体棱柱驾驶室(斜风挡)+一体棱柱发动机罩+嵌入式货斗;
     附件一律互嵌(嵌入≥0.02),无悬浮件;命中盒不变 ===== */
  /* ===== 红方 红方 122mm 火箭炮 (RED_MLRS) 40 管火箭炮车体(自 phl11_model_demo v0.10 buildChas 共形移植)=====
     万山 WS2400 系三轴底盘:平头装甲驾驶室前伸(z2.05~3.55)+仪器舱+底盘甲板(z-1.30~0.85);
     驾驶室后直接落转盘基座( cab-发射架间隙最小化),发射架后车架/平板已删(v0.10);
     后液压驻锄×2 + 钢板弹簧桥壳×3 + 风窗/侧窗防护网。坐标:+Z 前 / +Y 上。 ===== */
  function groupPartsPHL11(bP, gP) {
    var AXZ = PHL11_AXZ;
    vBox(bP, 0.14, 0.24, 5.35, cACC,  0.42, 0.90, 0.625);                    // 车架纵梁×2(v0.10 缩短:尾 -2.05)
    vBox(bP, 0.14, 0.24, 5.35, cACC, -0.42, 0.90, 0.625);
    for (var i = 0; i < 3; i++) vBox(bP, 0.98, 0.16, 0.14, cACC, 0, 0.90, AXZ[i]);   // 横梁×3(轴距位)
    vPrism(bP, cBODY, 1.16, PHL11_CAB_PTS, 0, 0, 0);                         // 装甲驾驶室(平头,共形闭壳)
    vBox(gP, 1.70, 0.03, 0.55, gGLASS, 0, 2.30, 3.468, 1.4226);              // 前风窗(贴前倾面)
    vBox(gP, 0.03, 0.42, 0.75, gGLASS,  1.165, 2.25, 2.95);                  // 侧窗×2
    vBox(gP, 0.03, 0.42, 0.75, gGLASS, -1.165, 2.25, 2.95);
    vBox(bP, 1.70, 0.045, 0.06, cACC, 0, 2.547, 3.431, 1.4226);              // 风窗框 上/下
    vBox(bP, 1.70, 0.045, 0.06, cACC, 0, 2.053, 3.505, 1.4226);
    vBox(bP, 0.06, 0.045, 0.55, cACC,  0.82, 2.30, 3.468, 1.4226);           // 风窗框 左/右
    vBox(bP, 0.06, 0.045, 0.55, cACC, -0.82, 2.30, 3.468, 1.4226);
    for (var gk = 0; gk < 11; gk++)                                          // 风窗防护网竖条×11
      vBox(bP, 0.02, 0.02, 0.52, cSTEEL, -0.75 + gk * 0.15, 2.303, 3.488, 1.4226);
    for (var gk2 = 0; gk2 < 3; gk2++) {                                      // 风窗防护网横条×3(随风窗倾角错层)
      var go = [-0.15, 0, 0.15][gk2];
      vBox(bP, 1.66, 0.02, 0.02, cSTEEL, 0, 2.303 + go * 0.989, 3.488 - go * 0.148, 1.4226);
    }
    for (var s4 = -1; s4 <= 1; s4 += 2) {                                    // 侧窗框+防护网(左右)
      vBox(bP, 0.045, 0.05, 0.75, cACC, s4 * 1.165, 2.46, 2.95);
      vBox(bP, 0.045, 0.05, 0.75, cACC, s4 * 1.165, 2.04, 2.95);
      vBox(bP, 0.045, 0.42, 0.05, cACC, s4 * 1.165, 2.25, 3.32);
      vBox(bP, 0.045, 0.42, 0.05, cACC, s4 * 1.165, 2.25, 2.58);
      for (var gk3 = 0; gk3 < 5; gk3++) vBox(bP, 0.02, 0.40, 0.02, cSTEEL, s4 * 1.180, 2.25, 2.65 + gk3 * 0.15);
      for (var gk4 = 0; gk4 < 3; gk4++) vBox(bP, 0.02, 0.02, 0.71, cSTEEL, s4 * 1.180, 2.11 + gk4 * 0.14, 2.95);
    }
    vBox(bP, 1.60, 0.55, 0.03, cDARK, 0, 1.38, 3.545);                       // 前脸散热格栅底板(包络不变 1.60×0.55×0.06,z3.53..3.59)
    for (var gri = 0; gri < 5; gri++)                                        // 横条×5(cSTEEL 凸出底板,RED_MBT_2尾格栅/BLUE_MLRS 格栅组同范式同配色)
      vBox(bP, 1.52, 0.05, 0.03, cSTEEL, 0, 1.170 + gri * 0.105, 3.575);
    vCyl(gP, 0.09, 0.09, 0.10, 10, gLENS,  0.95, 1.15, 3.58, Math.PI / 2);   // 前灯×2
    vCyl(gP, 0.09, 0.09, 0.10, 10, gLENS, -0.95, 1.15, 3.58, Math.PI / 2);
    vBox(bP, 1.80, 0.50, 0.12, cACC, 0, 0.85, 3.50);                         // 前脸下围板(连车架-保险杠)
    vBox(bP, 2.30, 0.28, 0.18, cACC, 0, 0.93, 3.64);                         // 前保险杠(顶面 1.07=轮顶齐平)
    vBox(bP, 0.44, 0.06, 1.30, cACC,  1.02, 1.13, 2.60);                     // 前轮挡泥板×2(外缘=胎面 1.25 内)
    vBox(bP, 0.44, 0.06, 1.30, cACC, -1.02, 1.13, 2.60);
    vBox(bP, 1.70, 0.08, 1.10, cACC, 0, 2.66, 2.75);                         // 顶盖
    vCyl(bP, 0.26, 0.26, 0.06, 10, cACC, 0.45, 2.72, 2.55);                  // 顶舱盖
    vCyl(bP, 0.012, 0.012, 1.10, 5, cDARK, -0.75, 3.25, 2.35);               // 鞭天线
    vBox(bP, 1.90, 0.60, 0.75, cACC, 0, 1.35, 1.225);                        // 仪器舱(v0.8 压缩让位发射架)
    vBox(bP, 1.90, 0.08, 2.15, cACC, 0, 1.06, -0.225);                       // 底盘甲板(z -1.30~0.85)
    vBox(bP, 0.40, 0.40, 1.00, cSTEEL,  0.75, 0.80, 0.90);                   // 车架侧油箱×2(fuel 模块实体)
    vBox(bP, 0.40, 0.40, 1.00, cSTEEL, -0.75, 0.80, 0.90);
    for (var s = -1; s <= 1; s += 2)                                         // 后液压驻锄支座(固定铰座;腿/垫/液压缸=专属动画 rig,见 phl11Spade* + updatePHL11Spades)
      vBox(bP, 0.30, 0.30, 0.50, cACC, s * 0.60, 0.90, -1.60);               // 驻锄支座(落新梁尾)
    for (var a = 0; a < 3; a++) {                                            // 车轮×6 + 桥壳/钢板弹簧
      for (var s2 = -1; s2 <= 1; s2 += 2) {
        artyWheel(bP, s2, AXZ[a], { rub: cRUBB, steel: cSTEEL, dark: cDARK }, ARTY_WHEEL_SPEC.red);
        vCyl(bP, 0.13, 0.13, 1.10, 8, cACC, s2 * 0.55, 0.535, AXZ[a], 0, 0, Math.PI / 2);   // 桥壳/减速器
        vBox(bP, 0.12, 0.16, 1.15, cSTEEL, s2 * 0.55, 0.72, AXZ[a]);                        // 钢板弹簧(桥壳→纵梁)
        vBox(bP, 0.06, 0.22, 0.08, cSTEEL, s2 * 0.55, 0.72, AXZ[a] + 0.62);                 // 弹簧吊耳(前/后)
        vBox(bP, 0.06, 0.22, 0.08, cSTEEL, s2 * 0.55, 0.72, AXZ[a] - 0.62);
      }
      vCyl(bP, 0.18, 0.18, 0.40, 10, cACC, 0, 0.535, AXZ[a], 0, 0, Math.PI / 2);            // 桥中央减速鼓包
    }
    for (var s3 = -1; s3 <= 1; s3 += 2) {                                    // 车门把手/后视镜/牵引钩
      vBox(bP, 0.02, 0.05, 0.18, cDARK, s3 * 1.17, 1.62, 2.72);
      vBox(bP, 0.04, 0.30, 0.16, cDARK, s3 * 1.20, 2.30, 3.32);
      vBox(bP, 0.12, 0.03, 0.03, cSTEEL, s3 * 1.17, 2.36, 3.42);
      vBox(bP, 0.08, 0.10, 0.10, cSTEEL, s3 * 0.80, 0.93, 3.76);
    }
    vCyl(bP, 0.85, 0.85, 0.16, 16, cACC, 0, 1.10, -0.05);                    // 转盘基座(固定,甲板直后)
  }
  /* ===== 蓝方 BLUE_MLRS BLUE_MLRS车体(自 BLUE_MLRS_modeling_demo v0.16 buildChas 共形移植)=====
     FMTV M1140 6×6:装甲驾驶室=loftY 六边形截面放样实心体(前切角/腰扩/顶收/尾切角),
     双片前风窗+中柱/梯形门窗/格栅组/大灯组/保险杠绞盘;后甲板(z1.10~-2.94)落转盘基座;
     车架侧油箱×2/备胎/后防钻杠。坐标:+Z 前 / +Y 上。 ===== */
  function groupPartsBLUE_MLRS(bP, gP) {
    var AXZ = BLUE_MLRS_AXZ;
    vBox(bP, 0.13, 0.22, 6.20, cACC,  0.40, 0.95, -0.45);                    // 车架纵梁×2(尾端 -3.55)
    vBox(bP, 0.13, 0.22, 6.20, cACC, -0.40, 0.95, -0.45);
    for (var i = 0; i < 3; i++) vBox(bP, 0.92, 0.15, 0.13, cACC, 0, 0.95, AXZ[i]);   // 横梁×3
    visPartPush(bP, cBODY, loftYGeo(BLUE_MLRS_CAB_SECS), 0, 0, 0);                // 驾驶室整体放样体(v0.9 单一无缝实心)
    vBox(bP, 1.29, 0.035, 0.53, cACC, 0, 2.30, 2.779, 1.0342);               // 风窗框(v0.11 缩至 0.95 倍)
    vBox(gP, 0.51, 0.03, 0.475, gGLASS,  0.38, 2.30, 2.782, 1.0342);         // 前风窗 右/左片(蓝宝石层压玻璃)
    vBox(gP, 0.51, 0.03, 0.475, gGLASS, -0.38, 2.30, 2.782, 1.0342);
    vBox(bP, 0.115, 0.045, 0.51, cBODY, 0, 2.30, 2.782, 1.0342);             // 风窗中柱
    vBox(bP, 0.03, 0.02, 0.42, cDARK,  0.42, 2.10, 2.925, 1.0342);           // 雨刷×2(贴风窗面下段)
    vBox(bP, 0.03, 0.02, 0.42, cDARK, -0.42, 2.10, 2.925, 1.0342);
    for (var mk = 1; mk < 4; mk++) vBox(gP, 0.16, 0.035, 0.06, gLENS, -0.64 + mk * 0.32, 2.735, 2.44);   // 顶前标志灯×3(中部)
    vBox(gP, 0.16, 0.035, 0.02, gLENS, -0.64, 2.735, 2.42);                  // 左/右端标志灯(削悬空角两段)
    vBox(gP, 0.12, 0.035, 0.04, gLENS, -0.62, 2.735, 2.45);
    vBox(gP, 0.16, 0.035, 0.02, gLENS,  0.64, 2.735, 2.42);
    vBox(gP, 0.12, 0.035, 0.04, gLENS,  0.62, 2.735, 2.45);
    visPartPush(gP, gGLASS, m142TrapWinGeo(-1), 0, 0, 0);                    // 车门梯形窗×2(随侧面收分)
    visPartPush(gP, gGLASS, m142TrapWinGeo(1), 0, 0, 0);
    vBox(bP, 1.00, 0.05, 0.38, cDARK, 0, 1.62, 3.010, 1.4555);               // 中央格栅(贴放样鼓面)
    for (var gi = 0; gi < 4; gi++)                                           // 格栅横筋×4(沿鼓面)
      vBox(bP, 0.92, 0.025, 0.05, cSTEEL, 0, 1.48 + gi * 0.075, [3.020, 3.011, 3.002, 2.994][gi] + 0.02, 1.4555);
    vBox(bP, 0.90, 0.035, 0.22, cDARK, 0, 1.14, 2.880, 2.0344);              // 下格栅(贴下前斜面)
    vCyl(bP, 0.09, 0.09, 0.06, 10, cACC, 0.62, 1.80, 2.995, Math.PI / 2);    // 前脸圆盖
    for (var s6 = -1; s6 <= 1; s6 += 2) {                                    // 大灯组(舱面板+透镜+琥珀条,贴下前斜面)
      vBox(bP, 0.44, 0.05, 0.36, cACC,  s6 * 0.53, 1.189, 2.916, 2.0344);
      vBox(gP, 0.36, 0.03, 0.30, gGLASS, s6 * 0.53, 1.171, 2.952, 2.0344);
      vBox(gP, 0.36, 0.025, 0.07, gLENS, s6 * 0.53, 1.302, 3.014, 2.0344);
    }
    vCyl(gP, 0.05, 0.05, 0.10, 10, gLENS,  0.52, 0.90, 2.91, Math.PI / 2);   // 雾灯×2(贴保险杠前面)
    vCyl(gP, 0.05, 0.05, 0.10, 10, gLENS, -0.52, 0.90, 2.91, Math.PI / 2);
    vBox(bP, 1.90, 0.26, 0.16, cACC, 0, 0.92, 2.83);                         // 前保险杠(上后缘嵌下前斜面,宽 1.90 避轮胎)
    vBox(bP, 0.07, 0.14, 0.06, cSTEEL,  0.45, 0.92, 2.92);                   // 拖车钩×2
    vBox(bP, 0.07, 0.14, 0.06, cSTEEL, -0.45, 0.92, 2.92);
    vCyl(bP, 0.11, 0.11, 0.60, 10, cSTEEL, 0, 0.80, 2.84, 0, 0, Math.PI / 2);// 绞盘滚筒
    vBox(bP, 0.40, 0.06, 1.26, cACC,  1.00, 1.16, 2.35);                     // 前轮挡泥板×2(外缘=车宽界 1.20)
    vBox(bP, 0.40, 0.06, 1.26, cACC, -1.00, 1.16, 2.35);
    vCyl(bP, 0.26, 0.26, 0.06, 10, cACC, 0.45, 2.76, 2.05);                  // 顶舱盖(避让顶前标志灯)
    vCyl(bP, 0.012, 0.012, 0.48, 5, cDARK, -0.80, 2.84, 1.95);               // 鞭天线×2(落座顶面)
    vCyl(bP, 0.012, 0.012, 0.40, 5, cDARK, -0.62, 2.82, 1.80);
    vCyl(bP, 0.27, 0.27, 1.10, 10, cSTEEL,  0.78, 0.85, 0.35, Math.PI / 2);  // 车架侧油箱×2(纵置,fuel 模块实体)
    vCyl(bP, 0.27, 0.27, 1.10, 10, cSTEEL, -0.78, 0.85, 0.35, Math.PI / 2);
    vBox(bP, 2.20, 0.15, 3.79, cACC, 0, 1.175, -1.045);                      // 后甲板/发射平台(加厚 0.15 容旋转架侧梁)
    for (var a = 0; a < 3; a++) {                                            // 车轮×6 + 桥壳/钢板弹簧
      for (var s2 = -1; s2 <= 1; s2 += 2) {
        artyWheel(bP, s2, AXZ[a], { rub: cRUBB, steel: cSTEEL, dark: cDARK }, ARTY_WHEEL_SPEC.blue);
        vCyl(bP, 0.13, 0.13, 1.04, 8, cACC, s2 * 0.52, 0.59, AXZ[a], 0, 0, Math.PI / 2);    // 桥壳
        vBox(bP, 0.12, 0.16, 1.10, cSTEEL, s2 * 0.52, 0.76, AXZ[a]);                        // 钢板弹簧(桥→纵梁)
      }
      vCyl(bP, 0.18, 0.18, 0.40, 10, cACC, 0, 0.59, AXZ[a], 0, 0, Math.PI / 2);             // 桥中央鼓包
    }
    vCyl(bP, 0.55, 0.55, 0.38, 14, cRUBB, 0, 0.72, -2.35);                   // 备胎(甲板下平置)
    vBox(bP, 2.00, 0.10, 0.12, cACC, 0, 0.55, -3.56);                        // 后防钻杠
    vBox(bP, 0.08, 0.64, 0.08, cACC,  0.40, 0.75, -3.50);                    // 防钻杠吊臂×2(内移嵌纵梁尾段)
    vBox(bP, 0.08, 0.64, 0.08, cACC, -0.40, 0.75, -3.50);
    vCyl(bP, 0.60, 0.60, 0.16, 16, cACC, 0, 1.30, -3.10);                    // 转盘基座(固定,缩径不超车尾)
  }
  /* ===== RED_MBT_2车体(参考图三视复原):59 系倒梯形履带+加长底盘;
     锯齿下缘深裙板(齿谷 0.52/板底 0.74,轮下半露出)+前橡胶挡泥帘;
     首上=V 形溅水板+满幅反应装甲砖阵(中央 2 排×5)+首上角车灯组×2(对称);舱盖居中;
     翼子板工具箱右3左2;机舱纵栅×2;尾部纵置油桶×2;左侧排气 ===== */
  function hullParts99(bP, gP) {
    segTrackPlates(bP, { trkX: 1.24, plateW: 0.55, loopFn: trackLoop99 }, { dark: cDARK, steel: cSTEEL });   // 分段式履带(物理环路扣轮+顶行下坠,对标59)
    vPrism(bP, cBODY, 0.95, T99_HULL_PTS, 0, 0, 0);
    vBox(bP, 0.60, 0.05, 5.60, cACC, -1.248, 1.08, -0.35);          // 翼子板×2(z[-3.15,2.45];内缘0.948埋车侧0.002接死/底1.055接裙顶,外沿1.548盖履带)
    vBox(bP, 0.60, 0.05, 5.60, cACC,  1.248, 1.08, -0.35);
    for (var fsgn = -1; fsgn <= 1; fsgn += 2) for (var fsk = -1; fsk <= 1; fsk += 2)
      fenderSix(bP, fsgn, fsk, { pinF: 2.40, pinR: -3.10, yBase: 1.08, x0: fsk * 0.023, ears: false }, { steel: cSTEEL, dark: cDARK, acc: cACC });   // 翼随板降0.065/内缘埋车侧跟进;铰链耳(翼板-泥板接头黑方块×2/处)删除
    var gapZ = [2.00, 1.255, 0.495, -0.265, -1.025, -1.785, -2.55];   // 裙板齿位=轮间隙中心(含端轮间隙)
    for (var sk = -1; sk <= 1; sk += 2) {
      twinWheelSet(bP, sk, SUSP_SPEC.t99, { rub: cRUBB, steel: cSTEEL, dark: cDARK });   // 两片式负重轮+摆臂扭杆(前两对朝后,规格表驱动)
      twinEndWheel(bP, sk, { R: 0.28, y: 0.62, z: 2.28, trkX: 1.24, hullX: 0.95 }, { rub: cRUBB, steel: cSTEEL, dark: cDARK });   // 诱导轮两片式(对标59;@前转角弧心,位置不动)
      twinEndWheel(bP, sk, { R: 0.26, y: 0.60, z: -2.80, trkX: 1.24, hullX: 0.95 }, { rub: cRUBB, steel: cSTEEL, dark: cDARK });   // 主动轮两片式(对标59;@后转角弧心,位置不动)
      // 深裙板(y[0.65,1.055],随翼下调只缩短/裙底不动)+锯齿下缘×7(齿尖 0.52,置轮间隙=轮系下半露出,参考图口径)+挂点块
      vBox(bP, 0.04, 0.365, 5.45, cACC, sk * 1.53, 0.8725, -0.30);
      for (var st = 0; st < 7; st++) {
        vPrism(bP, cACC, 0.02, [[gapZ[st] - 0.34, 0.70], [gapZ[st] + 0.34, 0.70], [gapZ[st], 0.41]], sk * 1.53, 0, 0);
        if (st > 0) vBox(bP, 0.025, 0.09, 0.14, cDARK, sk * 1.552, 0.75, gapZ[st]);   // 挂点块×6(首格不设=裙前部无黑块)
      }
      vBox(gP, 0.12, 0.10, 0.03, gTAIL, sk * 0.80, 0.90, -3.215);     // 尾灯×2
      vBox(bP, 0.09, 0.12, 0.14, cSTEEL, sk * 0.50, 0.48, 2.40);      // 前牵引钩×2
      vBox(bP, 0.09, 0.12, 0.14, cSTEEL, sk * 0.50, 0.75, -3.26);     // 后牵引钩×2
      // —— 首上灯组(仿59结构:立姿楔形灯座+方形外框+沉入式镜片,灯轴水平朝正前;旧3件斜躺灯轴朝天且顶条两端悬空) ——
      // 99首上中央被ERA占据,单灯/侧置于ERA外缘0.74与车侧0.95之间:灯座半宽0.095→0.08(槽内两隙各0.025);
      // 灯座截面与59同源(59鼻点与99首上同线同坡23.8°):前面垂直 z=2.255,背缘贴坡埋0.06~0.088;框背埋座面0.002/镜片沉框口0.014
      vPrism(bP, cDARK, 0.08, [[2.255, 0.960], [2.255, 0.7975], [2.1655, 0.7975], [1.789, 0.960]], sk * 0.845, 0, 0);
      vBox(bP, 0.135, 0.020, 0.036, cSTEEL, sk * 0.845, 0.935, 2.271);             // 方框上横棱
      vBox(bP, 0.135, 0.020, 0.036, cSTEEL, sk * 0.845, 0.820, 2.271);             // 方框下横棱
      vBox(bP, 0.020, 0.075, 0.036, cSTEEL, sk * 0.845 - 0.0565, 0.8775, 2.271);   // 方框侧棱×2(镜片边埋入0.007跨嵌)
      vBox(bP, 0.020, 0.075, 0.036, cSTEEL, sk * 0.845 + 0.0565, 0.8775, 2.271);
      vBox(gP, 0.107, 0.108, 0.009, gLENS, sk * 0.845, 0.8775, 2.2705);            // 镜片(玻璃,朝正前)
    }
    // 驾驶员舱盖居中+潜望镜×2
    vCyl(bP, 0.24, 0.25, 0.045, 12, cACC, 0, 1.152, 1.20);
    vBox(gP, 0.07, 0.04, 0.05, gPERI, -0.17, 1.145, 0.94);
    vBox(gP, 0.07, 0.04, 0.05, gPERI,  0.17, 1.145, 0.94);
    // V 形溅水板(尖端朝前;两肢贴首上斜面,俯视各后掠 0.4123;旧值后掠0.38+中心高0.879使肢水平、尖端浮空0.078/尾埋0.04,现按肢向俯仰进斜面、底埋0.01)
    vBox(bP, 0.80, 0.045, 0.06, cSTEEL, -0.36, 0.846, 2.149, 0.4153, -0.4123, 0);
    vBox(bP, 0.80, 0.045, 0.06, cSTEEL,  0.36, 0.846, 2.149, 0.4153, 0.4123, 0);
    // 首上中央反应装甲砖阵 2 排×5(贴斜面底埋0.01;旧抬高0.06致底面浮空0.03;首上线 y=0.68+0.45t/z=2.50-1.02t,t=0.62/0.82)
    for (var ec = -2; ec <= 2; ec++) {
      vBox(bP, 0.28, 0.06, 0.34, cACC, ec * 0.30, 0.977, 1.876, 0.4153);
      vBox(bP, 0.28, 0.06, 0.34, cACC, ec * 0.30, 1.067, 1.672, 0.4153);
    }
    // 翼子板工具箱(参考图俯视:右 3 左 2)
    vBox(bP, 0.26, 0.14, 0.55, cACC, 1.28, 1.175, 0.90);
    vBox(bP, 0.26, 0.14, 0.55, cACC, 1.28, 1.175, 0.20);
    vBox(bP, 0.26, 0.14, 0.55, cACC, 1.28, 1.175, -0.60);
    vBox(bP, 0.26, 0.14, 0.55, cACC, -1.28, 1.175, 0.55);
    vBox(bP, 0.26, 0.14, 0.55, cACC, -1.28, 1.175, -0.35);
    // 发动机舱纵向格栅×2(基板+纵筋×7)+左排气口
    for (var gs = -1; gs <= 1; gs += 2) {
      vBox(bP, 0.72, 0.015, 1.15, cDARK, gs * 0.42, 1.138, -2.30);
      for (var gr = -3; gr <= 3; gr++)
        vBox(bP, 0.018, 0.015, 1.10, cSTEEL, gs * 0.42 + gr * 0.10, 1.148, -2.30);
    }
    vBox(bP, 0.16, 0.10, 0.62, cDARK, -1.045, 1.15, -1.75);   // 左排气口落翼顶:底1.10埋翼顶1.105下0.005接死
  }
  /* ===== RED_MBT_2炮塔(用户红线轮廓复原):主壳=t99TurretGeo 双尖纺锤壳(视觉/命中同源);
     颊面留光面(参考图口径,无贴砖);顶面:炮长镜箱(左前)/车长指挥塔+高架 12.7(右)/装填手舱盖(左后)/
     周视仪(中右)/激光压制×2/横风传感杆(左尾)+天线(右尾);侧壁烟幕弹沿收锥壁逐管贴面;
     尾部储物筐挂尾横切面外+通气筒;前尖=炮口伸出位(炮盾护罩块) ===== */
  function turretParts99(tP, tG) {
    visPartPush(tP, cBODY, t99TurretGeo(), 0, 0, 0);
    // 炮盾护罩块(与命中判定同位:gunPivot 局部 z0.42=炮塔系 1.02;宽 0.28=左右与炮管根部 r0.14 相切)
    vBox(tP, 0.28, 0.34, 0.30, cCANVAS, 0, 0.30, 1.02);
    // [2026-09-04 分段镜像修复]对称件显式分段镜像:中线y=0.30,上半(y>0.30)右基准左镜像右,下半(y<0.30)左基准右镜像左;
    // 烟幕弹(y0.34)/侧板(y0.33)/顶杆(y0.475)均在上半→右基准;功能不对称顶面件(炮长镜箱左/指挥塔右/装填手盖左/激光压制右/周视仪中右/横风杆左/天线右)按用户确认保留不动
    for (var sm = 0; sm < 5; sm++) {
      // 5 管烟幕弹:沿尾向收锥侧壁逐管贴面(壁线 x=1.08-0.28·(0.26-z)/1.91,管心外移 0.02)
      var smz = -0.34 - sm * 0.15;
      var smxR = 1.08 - 0.28 * (0.26 - smz) / 1.91 + 0.02;   // 右基准壁线(收锥跨度 1.72→1.91)
      var smxL = smxR;                                        // 左镜像右
      vCyl(tP, 0.035, 0.035, 0.24, 6, cDARK, +smxR, 0.34, smz, 0.35, 0, -0.55);
      vCyl(tP, 0.035, 0.035, 0.24, 6, cDARK, -smxL, 0.34, smz, 0.35, 0, +0.55);
    }
    // [2026-09-06 储物篮加宽]旧侧板±0.80埋进赤道壁(前端z-0.95处壁已外扩至0.903);外移至±0.95(内面0.925,余隙0.022)并前端后收至-1.05(避末管烟幕弹后缘-1.01,余隙0.04)
    vBox(tP, 0.05, 0.26, 0.90, cACC, +0.95, 0.33, -1.50);     // 通长侧板·右基准(侧挂栏+储物篮侧壁合一:z[-1.95,-1.05],尾端接篮尾板)
    vBox(tP, 0.05, 0.26, 0.90, cACC, -0.95, 0.33, -1.50);     // 通长侧板·左镜像右
    vBox(tP, 0.03, 0.03, 0.90, cSTEEL, +0.95, 0.475, -1.50);  // 通长顶杆·右基准(骑侧板上缘)
    vBox(tP, 0.03, 0.03, 0.90, cSTEEL, -0.95, 0.475, -1.50);  // 通长顶杆·左镜像右
    // [2026-09-07 篮-塔连接]侧板外移后与收锥壁留0.037空隙;每侧前端加横向短接板 bridging:内端x0.83埋入壁面(锚固)外端x0.97搭入侧板,z[-1.15,-1.05]与侧板前端平齐不碰末管烟幕弹
    vBox(tP, 0.14, 0.20, 0.10, cACC, +0.90, 0.33, -1.10);  // 前端短接板·右基准(垂直炮塔主轴)
    vBox(tP, 0.14, 0.20, 0.10, cACC, -0.90, 0.33, -1.10);  // 前端短接板·左镜像右
    // 以下功能不对称顶面件按用户确认(主壳+对称件)保留不动,不参与分段镜像:炮长镜箱左/指挥塔+高射右/装填手盖左/激光压制右/周视仪中右/横风杆左/天线右
    vBox(tP, 0.36, 0.17, 0.44, cDARK, -0.42, 0.703, 0.20);            // 炮长镜箱(左前顶,底0.618落楔形座上)
    vBox(tG, 0.26, 0.08, 0.02, gPERI, -0.42, 0.713, 0.43);
    vCyl(tP, 0.24, 0.26, 0.10, 12, cACC, 0.42, 0.687, -0.35);         // 车长指挥塔(右,底0.637出台座)
    vCyl(tP, 0.20, 0.20, 0.04, 12, cACC, 0.42, 0.757, -0.35);         // 小顶盖居舱盖中心
    vCyl(tP, 0.035, 0.035, 0.30, 6, cSTEEL, 0.42, 0.785, 0.05);       // 高架 12.7:立柱底接柱座(舱盖前方)
    vBox(tP, 0.10, 0.12, 0.60, cDARK, 0.42, 0.975, 0.20);
    vCyl(tP, 0.02, 0.02, 0.75, 6, cDARK, 0.42, 0.975, 0.85, Math.PI / 2);
    vBox(tP, 0.12, 0.10, 0.18, cDARK, 0.28, 0.935, 0.12);
    vCyl(tP, 0.20, 0.21, 0.05, 12, cACC, -0.42, 0.662, -0.35);       // 装填手舱盖(左,与指挥塔并列同 z,出台座)
    // 立式激光压制器(天线同侧+X, 舱盖后一点): 底座+立杆+镜箱(镜片朝前), 镜心=发射原点标记
    vBox(tP, 0.10, 0.05, 0.12, cDARK, 0.55, 0.65, -0.78);
    vCyl(tP, 0.02, 0.02, 0.32, 6, cSTEEL, 0.55, 0.83, -0.78);
    vBox(tP, 0.08, 0.10, 0.10, cDARK, 0.55, 1.02, -0.78);
    vBox(tG, 0.05, 0.06, 0.015, gPERI, 0.55, 1.02, -0.725);
    vCyl(tP, 0.09, 0.10, 0.26, 10, cDARK, 0.16, 0.774, -0.66);        // 车长周视仪(中右,出台座)
    vBox(tP, 0.16, 0.15, 0.20, cDARK, 0.16, 0.974, -0.66);
    vBox(tG, 0.12, 0.08, 0.02, gPERI, 0.16, 0.984, -0.55);
    vBox(tP, 0.14, 0.10, 0.12, cDARK,  0.62, 0.659, -1.44);           // [修复]激光压制尾顶角·右基准(随尾延后移,出台座)
    vBox(tP, 0.14, 0.10, 0.12, cDARK, -0.62, 0.659, -1.44);           // [修复]激光压制尾顶角·左镜像右(出台座)
    vCyl(tP, 0.015, 0.015, 0.55, 4, cDARK, -0.50, 0.885, -1.55);      // 横风传感杆(左尾,细立杆,出盘座)
    vCyl(tP, 0.012, 0.012, 0.95, 4, cDARK, 0.66, 1.079, -1.59);      // 天线(右尾;comic _antSpecs.t99 同源,出盘座)
    // [2026-09-08 弧面贴合底座]顶面件按raycast屋面高下移就位后,各加小底座(半埋入拱面消悬空,取小值,不抢外形)
    vPrism(tP, cDARK, 0.20, [[0.46, 0.623], [0.46, 0.578], [-0.06, 0.615], [-0.06, 0.623]], -0.42, 0, 0);   // 炮长镜盒楔形座(跟4.5°前倾坡面,前低后高)
    vCyl(tP, 0.26, 0.29, 0.05, 12, cDARK, 0.42, 0.617, -0.35);      // 车长镜塔台座·右
    vCyl(tP, 0.06, 0.075, 0.03, 10, cDARK, 0.42, 0.625, 0.05);      // 高射机枪柱座
    vCyl(tP, 0.21, 0.24, 0.045, 12, cDARK, -0.42, 0.62, -0.35);     // 装填手舱口座·左
    vBox(tP, 0.14, 0.035, 0.16, cDARK, 0.55, 0.613, -0.78);         // 激光压制座·右
    vCyl(tP, 0.10, 0.13, 0.03, 10, cDARK, 0.16, 0.634, -0.66);      // 周视仪座(中右)
    vBox(tP, 0.18, 0.04, 0.16, cDARK,  0.62, 0.594, -1.44);        // 尾顶角座·右
    vBox(tP, 0.18, 0.04, 0.16, cDARK, -0.62, 0.594, -1.44);        // 尾顶角座·左
    vCyl(tP, 0.035, 0.05, 0.03, 8, cDARK, -0.50, 0.60, -1.55);      // 横风杆座·左尾
    vCyl(tP, 0.032, 0.047, 0.03, 8, cDARK, 0.66, 0.594, -1.59);     // 天线座·右尾
    // 尾部储物篮(居中x=0跨中线,空筐;[2026-09-06 加宽]篮宽随侧板±0.95适配:底板半宽=侧板内面0.925,尾板/尾杆半宽=侧板外面0.975;尾板 -1.93 与侧板尾端 -1.95 平齐;居中件免左右镜像)
    vBox(tP, 1.85, 0.035, 0.40, cSTEEL, 0, 0.22, -1.72);
    vBox(tP, 1.95, 0.26, 0.04, cACC, 0, 0.33, -1.93);
    vBox(tP, 1.95, 0.03, 0.03, cSTEEL, 0, 0.475, -1.93);
  }
  function gunParts99(uP) {                                          // 125mm 滑膛炮:防尘罩根套/身管/抽烟装置(偏前)/热护套/炮口基准器(轴线沿 z:rx=π/2)
    vCyl(uP, 0.14, 0.12, 0.66, 12, cCANVAS, 0, 0, 0.72, Math.PI / 2);
    vCyl(uP, 0.105, 0.105, 1.10, 12, cDARK, 0, 0, 1.40, Math.PI / 2);
    vCyl(uP, 0.15, 0.15, 0.66, 12, cDARK, 0, 0, 2.28, Math.PI / 2);
    vCyl(uP, 0.12, 0.12, 0.80, 12, cDARK, 0, 0, 3.01, Math.PI / 2);   // 热护套段(全管统一黑灰)
    vCyl(uP, 0.098, 0.098, 0.36, 12, cDARK, 0, 0, 3.59, Math.PI / 2);
    vCyl(uP, 0.11, 0.11, 0.12, 10, cSTEEL, 0, 0, 3.76, Math.PI / 2);
  }
  /* ===== 红方 RED_MLRS 发射转盘(turret=影响旋转的模块;demo buildTurn 共形)=====
     回转环+回转座+俯仰支臂板×2+俯仰轴+平衡机座;局部原点=转盘中心(世界 y1.30,z-0.05)。 */
  function turretPartsPHL11(tP) {
    vCyl(tP, 0.78, 0.78, 0.20, 16, cSTEEL, 0, -0.02, 0);                    // 回转环
    vBox(tP, 1.10, 0.36, 1.30, cACC, 0, 0.24, 0);                           // 回转座
    vBox(tP, 0.10, 0.75, 1.10, cACC,  0.62, 0.45, -0.35);                   // 俯仰支臂板×2
    vBox(tP, 0.10, 0.75, 1.10, cACC, -0.62, 0.45, -0.35);
    vCyl(tP, 0.09, 0.09, 1.32, 10, cSTEEL, 0, 0.62, -0.55, 0, 0, Math.PI / 2);   // 俯仰轴(铰点,横贯支臂)
    vBox(tP, 0.90, 0.30, 0.50, cACC, 0, 0.30, 0.55);                        // 平衡机/液缸座
  }
  /* ===== 红方 RED_MLRS 40 管发射架(ammo=弹药架模块本体;gun=定向管束内芯;demo buildPack 共形)=====
     2×20 管模块(4 层×5 列,gap 0.21)+桁架角梁/端中框+中央隔梁+箱底托板+铰点侧臂+俯仰齿弧;
     局部原点=俯仰铰点,管束中心=(0,0.55,0.75),管长 2.80。 */
  function gunPartsPHL11(uP) {
    var py0 = 0.55, pz = 0.75, gap = 0.21;
    for (var pd = -1; pd <= 1; pd += 2) {                                   // 2×20 管模块(4层×5列)
      var px0 = pd * 0.55;
      /* 逐管整组(定向管身/尾箍/管口箍/固定环×2/弹头段/锥顶)已全部从模板剥离 → 逐车 40 发
         "储运弹"InstancedMesh:每发消耗时整管消失(修复:原先只弹头消失、弹体残留);
         模板仅保留发射架结构件(桁架角梁/端中框/中央隔梁/箱底托板/铰点侧臂/俯仰齿弧)。
         见 phl11RocketGeo / PHL11_RKT_ORDER / updatePHL11Rockets。 */
      for (var cx = -1; cx <= 1; cx += 2) for (var cy = -1; cy <= 1; cy += 2)
        vBox(uP, 0.06, 0.06, 3.10, cACC, px0 + cx * 0.49, py0 + cy * 0.42, pz);    // 桁架角梁×4
      for (var st = 0; st < 3; st++) {                                              // 端/中框×3 站
        var zz = pz + (st - 1) * 1.30;
        vBox(uP, 1.04, 0.05, 0.05, cACC, px0, py0 + 0.42, zz);
        vBox(uP, 1.04, 0.05, 0.05, cACC, px0, py0 - 0.42, zz);
        vBox(uP, 0.05, 0.89, 0.05, cACC, px0 + 0.49, py0, zz);
        vBox(uP, 0.05, 0.89, 0.05, cACC, px0 - 0.49, py0, zz);
      }
    }
    vBox(uP, 0.10, 0.94, 3.10, cACC, 0, py0, pz);                            // 中央隔梁(两模块间)
    vBox(uP, 2.14, 0.06, 3.10, cACC, 0, py0 - 0.50, pz);                     // 箱底托板
    vBox(uP, 0.08, 0.62, 1.30, cACC,  0.66, 0.16, 0.35);                     // 铰点侧臂×2(接俯仰轴)
    vBox(uP, 0.08, 0.62, 1.30, cACC, -0.66, 0.16, 0.35);
    vCyl(uP, 0.07, 0.07, 1.40, 10, cSTEEL, 0, 0, 0, 0, 0, Math.PI / 2);      // 铰点轴套
    // 已按要求彻底删除 RED_MLRS 炮塔尾部两个竖立的挡板及上面的四串小方片
  }
  /* ===== 蓝方 BLUE_MLRS 发射转盘(turret=影响旋转的模块;demo buildTurn 共形)=====
     回转环+回转座+俯仰支臂板×2+俯仰轴+回转框架侧梁(v0.6 紧凑化)+缸底铰座前耳;
     局部原点=转盘中心(世界 y1.35,z-3.10)。 */
  function turretPartsBLUE_MLRS(tP) {
    vCyl(tP, 0.58, 0.58, 0.20, 16, cSTEEL, 0, -0.02, 0);                    // 回转环
    vBox(tP, 1.20, 0.34, 1.10, cACC, 0, 0.22, 0);                           // 回转座
    vBox(tP, 0.10, 0.72, 0.90, cACC,  0.60, 0.42, -0.10);                   // 俯仰支臂板×2
    vBox(tP, 0.10, 0.72, 0.90, cACC, -0.60, 0.42, -0.10);
    vCyl(tP, 0.09, 0.09, 1.32, 10, cSTEEL, 0, 0.40, 0, 0, 0, Math.PI / 2);  // 俯仰轴(铰点)
    vBox(tP, 0.12, 0.16, 0.80, cACC,  0.55, -0.09, 0.15);                   // 回转框架侧梁×2(不切甲板)
    vBox(tP, 0.12, 0.16, 0.80, cACC, -0.55, -0.09, 0.15);
    vBox(tP, 0.12, 0.20, 0.22, cACC,  0.55, -0.01, 0.62);                   // 缸底铰座前耳×2(随转盘旋转,液压缸下锚点)
    vBox(tP, 0.12, 0.20, 0.22, cACC, -0.55, -0.01, 0.62);
  }
  /* ===== 蓝方 BLUE_MLRS 发射舱(ammo=弹药架模块本体;gun=六联定向管内芯;demo buildPod v0.16 共形)=====
     M270 通用发射箱(1.00×0.80×4.10)+顶/侧加强箍+箱口端板+前后 6 管口圆孔(227mm)+摇架纵梁/横梁+
     液压缸上铰座×2+侧保护箱×2(loftXZ 放样,前 1/8 俯视收缩斜坡,随舱旋转/俯仰)+前框架上半横梁(细,前伸近车头不触碰)。 */
  function gunPartsBLUE_MLRS(uP) {
    vBox(uP, 1.00, 0.80, 4.10, cACC, 0, 0.10, 1.50);                        // 发射箱体(M270 通用)
    for (var r = 0; r < 3; r++) vBox(uP, 0.94, 0.06, 0.16, cACC, 0, 0.51, 0.40 + r * 1.05);   // 顶面加强箍×3
    for (var s = -1; s <= 1; s += 2) for (var q = 0; q < 3; q++)
      vBox(uP, 0.05, 0.66, 0.16, cACC, s * 0.505, 0.10, 0.40 + q * 1.05);   // 侧向加强箍×6
    vBox(uP, 1.02, 0.82, 0.06, cACC, 0, 0.10, 3.55);                        // 箱口端板
    for (var c = -1; c <= 1; c++) for (var rw = 0; rw < 2; rw++)
      vCyl(uP, 0.115, 0.115, 0.10, 10, cDARK, c * 0.28, 0.10 + (rw - 0.5) * 0.38, 3.57, Math.PI / 2);   // 前 6 管口(3列×2层)
    for (var c2 = -1; c2 <= 1; c2++) for (var rw2 = 0; rw2 < 2; rw2++)
      vCyl(uP, 0.115, 0.115, 0.08, 10, cDARK, c2 * 0.28, 0.10 + (rw2 - 0.5) * 0.38, -0.56, Math.PI / 2); // 尾部 6 管口(头尾均见圆孔)
    vBox(uP, 0.12, 0.14, 3.60, cACC,  0.40, -0.36, 1.50);                   // 摇架纵梁×2
    vBox(uP, 0.12, 0.14, 3.60, cACC, -0.40, -0.36, 1.50);
    vBox(uP, 0.92, 0.14, 0.20, cACC, 0, -0.36, 0.05);                       // 摇架横梁(前)
    vBox(uP, 0.10, 0.40, 0.44, cACC,  0.56, -0.10, 0);                      // 铰点侧块×2
    vBox(uP, 0.10, 0.40, 0.44, cACC, -0.56, -0.10, 0);
    vBox(uP, 0.10, 0.12, 0.16, cSTEEL,  0.55, -0.45, 1.75);                 // 液压缸上铰座×2(活塞杆锚点 PA)
    vBox(uP, 0.10, 0.12, 0.16, cSTEEL, -0.55, -0.45, 1.75);
    for (var s8 = -1; s8 <= 1; s8 += 2) {                                   // 侧保护箱×2(随发射舱旋转/俯仰)
      visPartPush(uP, cACC, loftXZGeo([[-0.34, m142PodSidePoly(s8, 3.55)], [0.62, m142PodSidePoly(s8, 3.55)]]), 0, 0, 0);
      vBox(uP, 0.20, 0.60, 1.20, cACC, s8 * 0.59, 0.10, 1.60);              // 侧箱-箱身连接肋(嵌合无悬空)
      vBox(uP, 0.02, 0.34, 1.10, cACC, s8 * 1.125, 0.24, 1.30);             // 侧箱外凹板
    }
    vBox(uP, 1.00, 0.16, 0.16, cACC, 0, 0.58, 3.97);                        // 前框架上半横梁(v0.16:细梁,舱同宽,前伸近车头不触碰)
    vBox(uP, 0.08, 0.16, 0.65, cACC,  0.44, 0.48, 3.72);                    // 横梁-发射舱连接件×2(嵌舱顶/口板)
    vBox(uP, 0.08, 0.16, 0.65, cACC, -0.44, 0.48, 3.72);
  }
  /* ===== 防空载具分阵营组装 (TASK 18): 蓝=BLUE_AA / 红=RED_AA (demo 构建器经 AaMB/AaMesh 桥接) ===== */
  function groupPartsAvenger(bP, gG) {
    aaSetAvengerPalette(cBODY, cACC, cSTEEL, cDARK, cRUBB, gGLASS, gGLASSD);
    var M = new AaMB();
    avBuildBody(M, AAV_P);
    avBuildWheels(M, AAV_P);
    aaFlushMB({ body: bP, wheel: bP, glass: gG }, M);
    /* 车轮转子件 ×4(2026-09-11):artyWheel = 火箭炮卡车同款构成(轮胎+钢圈+轮毂+螺栓圈+胎面花纹块×12),
       模式18 转子 tag → 随速自转(_trackDifferential blue|aa 通道,断轮冻结自动继承)。 */
    for (var wsk = -1; wsk <= 1; wsk += 2) {
      artyWheel(bP, wsk, AAV_P.axleF, { rub: cRUBB, steel: cSTEEL, dark: cDARK }, AV_WHEEL_SPEC);                       // 前轴
      artyWheel(bP, wsk, AAV_P.axleF - AAV_P.wheelBase, { rub: cRUBB, steel: cSTEEL, dark: cDARK }, AV_WHEEL_SPEC);     // 后轴
    }
  }
  function turretPartsAvenger(tP, tG) {
    aaSetAvengerPalette(cBODY, cACC, cSTEEL, cDARK, cRUBB, gGLASS, gGLASSD);
    var M = new AaMB();
    avBuildTurret(M, AAV_P);
    aaFlushMB({ turret: tP, sensor: tP, glass: tG }, M);
  }
  function gunPartsAvenger(uP) {   // 2× 四联 防空导弹 发射箱(局部原点=俯仰轴, 随 gunPivot 俯仰; demo buildPod 原样)
    aaSetAvengerPalette(cBODY, cACC, cSTEEL, cDARK, cRUBB, gGLASS, gGLASSD);
    for (var sd = -1; sd <= 1; sd += 2) {
      var M = new AaMB(), g = new AaMB();
      avBuildPod(g, AAV_P);
      M.merge(g, aaTTrans(sd * AAV_P.podX, 0, 0));
      aaFlushMB({ pod: uP }, M);
    }
  }
  function groupPartsPGZ95(bP, gG) {
    aaSetPGZPalette(cBODY, cACC, cSTEEL, cDARK, cRUBB, gGLASSD);
    aaFlushMesh(bP, aa95BuildHull(), AA95_COLMAP, [0, 0.3125, 0]);   // [2026-09-11] 车体抬高 0.40−0.0875:≡负重轮/悬挂相对车体上调 1/4 轮半径(R0.35/4),带外底仍 y=0 贴地(用户#3)
    aa95BuildRunningGear(bP, { rub: cRUBB, steel: cSTEEL, dark: cDARK });   // 行走件=全车型公共管线(2026-09-11:分段履带板+摆臂扭杆+转子tag,滚动/悬挂动画)
  }
  function turretPartsPGZ95(tP, tG) {
    aaSetPGZPalette(cBODY, cACC, cSTEEL, cDARK, cRUBB, gGLASSD);
    aaFlushMesh(tP, aa95BuildTurret(), AA95_COLMAP, null);         // 塔体/顶盖/耳轴/舱盖/鞭天线
    aaFlushMesh(tP, aa95BuildEO(), AA95_COLMAP, null);             // 光电跟踪头(塔前)
    aaFlushMesh(tP, aa95BuildRadar(), AA95_COLMAP, [0, 0.86, -1.12]);   // 搜索雷达桅杆(常展开态; 搜索方向由光标/炮塔控制)
  }
  function gunPartsPGZ95(uP) {
    aaSetPGZPalette(cBODY, cACC, cSTEEL, cDARK, cRUBB, gGLASSD);
    for (var sd = -1; sd <= 1; sd += 2) {
      aaFlushMesh(uP, aa95BuildGuns(), AA95_COLMAP, [sd * 1.02, 0, 0]);          // 双联机炮(局部原点=耳轴; gunPivot 已落耳轴位姿)
      aaFlushMesh(uP, aa95BuildMSLRail(), AA95_COLMAP, [sd * 1.02, 0.55, 0.42]); // 导弹导轨支架(裸弹体=动态件)
    }
  }
  // 直升机通用圆角硬表面辅助(供现存直升机模型使用)。
  function heliRoundedBoxGeo(w,h,l,r){
    r=Math.min(r||.04,w*.22,h*.22,l*.22);var sh=new THREE.Shape(),x=-w/2,y=-h/2;
    sh.moveTo(x+r,y);sh.lineTo(x+w-r,y);sh.quadraticCurveTo(x+w,y,x+w,y+r);sh.lineTo(x+w,y+h-r);
    sh.quadraticCurveTo(x+w,y+h,x+w-r,y+h);sh.lineTo(x+r,y+h);sh.quadraticCurveTo(x,y+h,x,y+h-r);
    sh.lineTo(x,y+r);sh.quadraticCurveTo(x,y,x+r,y);
    var g=new THREE.ExtrudeGeometry(sh,{depth:l,steps:1,bevelEnabled:true,bevelSegments:2,bevelSize:r*.42,bevelThickness:r*.42,curveSegments:3});
    g.translate(0,0,-l/2);if(!g.index){var ni=g.attributes.position.count,ia=ni>65535?new Uint32Array(ni):new Uint16Array(ni);for(var ii=0;ii<ni;ii++)ia[ii]=ii;g.setIndex(new THREE.BufferAttribute(ia,1));}g.computeVertexNormals();return g;
  }
  function heliRBox(arr,w,h,l,col,x,y,z,r,rx,ry,rz){if(_skipVis)return;visPartPush(arr,col,heliRoundedBoxGeo(w,h,l,r),x,y,z,rx,ry,rz);}
  /* ===== Helicopter geometry helpers ===== */
  /**
   * 从一组闭合截面生成带首尾端盖的放样几何。
   * 截面按 +Z 到 -Z 排列;每个截面从 +Z 方向观察必须为逆时针。
   * @param {Array<Array<number[]>>} sections 截面顶点,格式为 [x, y, z]。
   * @returns {THREE.BufferGeometry}
   */
  function heliClosedLoft(sections) {
    var ringCount = sections.length;
    var segmentCount = ringCount ? sections[0].length : 0;
    if (ringCount < 2 || segmentCount < 3) throw new Error('heliClosedLoft: invalid section count');

    var debugGeometry = typeof window !== 'undefined' && !!window.__TANK_DEBUG;
    var positions = [];
    var indices = [];
    var i, j;

    for (i = 0; i < ringCount; i++) {
      var section = sections[i];
      if (section.length !== segmentCount) throw new Error('heliClosedLoft: inconsistent section size');

      if (debugGeometry) {
        var signedArea = 0;
        for (j = 0; j < segmentCount; j++) {
          var next = section[(j + 1) % segmentCount];
          var point = section[j];
          if (!isFinite(point[0]) || !isFinite(point[1]) || !isFinite(point[2])) {
            throw new Error('heliClosedLoft: non-finite vertex');
          }
          signedArea += point[0] * next[1] - next[0] * point[1];
        }
        if (signedArea <= 0) throw new Error('heliClosedLoft: section winding must be CCW');
        if (i > 0 && section[0][2] >= sections[i - 1][0][2]) {
          throw new Error('heliClosedLoft: sections must run from +Z to -Z');
        }
      }

      for (j = 0; j < segmentCount; j++) {
        positions.push(section[j][0], section[j][1], section[j][2]);
      }
    }

    for (i = 0; i < ringCount - 1; i++) {
      for (j = 0; j < segmentCount; j++) {
        var k = (j + 1) % segmentCount;
        var a0 = i * segmentCount + j;
        var a1 = i * segmentCount + k;
        var b0 = (i + 1) * segmentCount + j;
        var b1 = (i + 1) * segmentCount + k;
        indices.push(a0, b0, b1, a0, b1, a1);
      }
    }

    for (j = 1; j < segmentCount - 1; j++) {
      indices.push(0, j, j + 1);
      var tailOffset = (ringCount - 1) * segmentCount;
      indices.push(tailOffset, tailOffset + j + 1, tailOffset + j);
    }

    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  // 椭圆截面放样:下半部横向内收,形成直升机机腹。
  function ahLoft(rings, segments) {
    segments = segments || 8;
    var sections = [];
    for (var i = 0; i < rings.length; i++) {
      var ring = rings[i];
      var section = [];
      for (var j = 0; j < segments; j++) {
        var angle = j * Math.PI * 2 / segments;
        var lowerScale = Math.sin(angle) < 0 ? 0.80 : 1;
        section.push([
          Math.cos(angle) * ring[2] * lowerScale,
          ring[1] + Math.sin(angle) * ring[3],
          ring[0]
        ]);
      }
      sections.push(section);
    }
    return heliClosedLoft(sections);
  }

  // RED_HELI 八点菱形截面放样;字段为 [z, centerY, halfWidth, halfHeight, topWidth, chineWidth, bellyWidth]。
  function wzBodyLoft(rings) {
    var sections = [];
    for (var i = 0; i < rings.length; i++) {
      var ring = rings[i];
      var z = ring[0], centerY = ring[1], halfWidth = ring[2], halfHeight = ring[3];
      var topWidth = ring[4], chineWidth = ring[5], bellyWidth = ring[6];
      sections.push([
        [ topWidth,   centerY + halfHeight,        z],
        [-topWidth,   centerY + halfHeight,        z],
        [-halfWidth,  centerY + halfHeight * 0.10, z],
        [-chineWidth, centerY - halfHeight * 0.52, z],
        [-bellyWidth, centerY - halfHeight,        z],
        [ bellyWidth, centerY - halfHeight,        z],
        [ chineWidth, centerY - halfHeight * 0.52, z],
        [ halfWidth,  centerY + halfHeight * 0.10, z]
      ]);
    }
    return heliClosedLoft(sections);
  }
  // RED_HELI 发动机短舱椭圆截面放样:纵向先扩张后收束,形成前后连续圆滑的纺锤轮廓。
  function wzEngineLoft(rings, segments) {
    segments = segments || 12;
    var sections = [];
    for (var i = 0; i < rings.length; i++) {
      var ring = rings[i], section = [];
      for (var j = 0; j < segments; j++) {
        var angle = j * Math.PI * 2 / segments;
        section.push([
          Math.cos(angle) * ring[2],
          ring[1] + Math.sin(angle) * ring[3],
          ring[0]
        ]);
      }
      sections.push(section);
    }
    return heliClosedLoft(sections);
  }

  // RED_HELI 座舱变宽截面闭壳:前下角按机鼻上缘内收,其余座舱侧壁保持原宽。
  function wzCockpitShell(points) {
    var pos = [], idx = [], cy = 0, cz = 0, cw = 0, i;
    for (i = 0; i < points.length; i++) { cz += points[i][0]; cy += points[i][1]; cw += points[i][2]; }
    cz /= points.length; cy /= points.length; cw /= points.length;
    var inside = [0, cy, cz];
    function sidePoint(p, side) { return [side * p[2], p[1], p[0]]; }
    for (i = 0; i < points.length; i++) {
      var j = (i + 1) % points.length;
      var a = sidePoint(points[i], -1), b = sidePoint(points[i], 1);
      var c = sidePoint(points[j], 1), d = sidePoint(points[j], -1);
      triOrientPush(pos, idx, inside, a, b, c);
      triOrientPush(pos, idx, inside, a, c, d);
    }
    var rightCenter = [cw, cy, cz], leftCenter = [-cw, cy, cz];
    for (i = 0; i < points.length; i++) {
      var k = (i + 1) % points.length;
      triOrientPush(pos, idx, inside, rightCenter, sidePoint(points[i], 1), sidePoint(points[k], 1));
      triOrientPush(pos, idx, inside, leftCenter, sidePoint(points[k], -1), sidePoint(points[i], -1));
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // 发动机中央承力舱专用硬表面:每个截面严格为“左右垂直墙+水平顶板”,各面独立顶点保持平直法线。
  // ring=[z, bottomY, topY, halfWidth];纵向仅改变高度/宽度,不产生椭圆或圆润横截面。
  function ahDeck(rings){var pos=[],idx=[];function tri(a,b,c){var o=pos.length/3;pos.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);idx.push(o,o+1,o+2);}function quad(a,b,c,d){tri(a,b,c);tri(a,c,d);}for(var i=0;i<rings.length-1;i++){var A=rings[i],B=rings[i+1],a0=[-A[3],A[1],A[0]],a1=[ A[3],A[1],A[0]],a2=[ A[3],A[2],A[0]],a3=[-A[3],A[2],A[0]],b0=[-B[3],B[1],B[0]],b1=[ B[3],B[1],B[0]],b2=[ B[3],B[2],B[0]],b3=[-B[3],B[2],B[0]];quad(a3,a2,b2,b3);quad(a0,b0,b1,a1);quad(a3,b3,b0,a0);quad(a1,b1,b2,a2);}var F=rings[0],L=rings[rings.length-1];quad([-F[3],F[1],F[0]],[F[3],F[1],F[0]],[F[3],F[2],F[0]],[-F[3],F[2],F[0]]);quad([-L[3],L[1],L[0]],[-L[3],L[2],L[0]],[L[3],L[2],L[0]],[L[3],L[1],L[0]]);var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3));g.setIndex(idx);g.computeVertexNormals();return g;}
  function ahSlab(poly,y0,y1){
    var area=0;for(var q=0;q<poly.length;q++){var q2=(q+1)%poly.length;area+=poly[q][0]*poly[q2][1]-poly[q][1]*poly[q2][0];}if(area>0)poly=poly.slice().reverse();
    var n=poly.length,pos=[],idx=[],i,j;for(i=0;i<n;i++)pos.push(poly[i][0],y0,poly[i][1]);for(i=0;i<n;i++)pos.push(poly[i][0],y1,poly[i][1]);
    for(i=1;i<n-1;i++){idx.push(0,i+1,i,n,n+i,n+i+1);}for(i=0;i<n;i++){j=(i+1)%n;idx.push(i,n+j,n+i,i,j,n+j);}
    var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3));g.setIndex(idx);g.computeVertexNormals();return g;
  }
  function ahEll(rx,ry,rz,seg){/* 低边数球体:保持装甲化多边形轮廓,同时兼容全部 Three r128 构建路径。 */var n=seg||8,g=new THREE.SphereGeometry(1,n,Math.max(5,n-3));g.scale(rx,ry,rz);g.computeVertexNormals();return g;}
  // 在任意两个端点间生成支柱,避免手填欧拉角造成端点与机体/轮轴断开。
  function ahLink(arr,r1,r2,seg,col,a,b){if(_skipVis)return;var d=new THREE.Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]),len=d.length(),mid=new THREE.Vector3((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2),q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()),g=new THREE.CylinderGeometry(r1,r2,len,seg||8),m=new THREE.Matrix4().compose(mid,q,new THREE.Vector3(1,1,1));g.applyMatrix4(m);visPartPush(arr,col,g,0,0,0);}
  /* ===== BLUE_HELId(参考图严谨比例化程序建模)----
     侧视参考图逐项复刻:尖削光电机鼻(PNVS/TADS 双窗)、颚下 M230 炮塔、串列阶梯双座平直装甲玻璃舱、
     肩置双发短舱(前进气口带唇口/分流片、后外侧暗排气管)、高置旋翼桅+桅顶"长弓"雷达罩、四叶主旋翼、
     后掠短翼双挂点(内火箭巢/外四联导弹架)、细长尾梁+大后掠垂尾/腹鳍/平尾、左侧四叶尾桨、
     后三点固定起落架(外八主支柱宽轮距+尾轮)。坐标:+Z 机头,-Z 尾部,X 横向,Y 向上;
     机身全长约 12.4、主旋翼直径约 14.3、全高(雷达罩顶)约 5.1。 ===== */
  function hullPartsAH64(bP, gP, rP, trP) {
    function ahBlade(){return ahSlab([[-.26,.32],[.26,.32],[.22,6.10],[.05,7.12],[-.19,7.02],[-.30,6.05]],-.028,.028);}  // 变弦渐缩桨尖
    // 主机身放样:机鼻紧接座舱前部(缩短机首长度一半至真实比例)+深腹/座舱肩线/发动机舱收尾。
    visPartPush(bP,cBODY,ahLoft([
      [4.50,1.68,.30,.31],[4.38,1.70,.43,.41],[4.15,1.75,.52,.51],[3.72,1.82,.59,.58],
      [2.88,1.87,.66,.64],[1.82,1.91,.73,.72],[.52,1.93,.76,.77],[-.82,1.92,.70,.76],
      [-1.88,1.88,.55,.60],[-2.74,1.84,.37,.38]
    ],6),0,0,0);
    // 细长尾梁独立放样:由机身尾部连续缩至尾桨轴。
    visPartPush(bP,cACC,ahLoft([[-2.40,1.86,.34,.30],[-3.60,1.92,.26,.24],[-4.90,2.00,.20,.19],[-6.00,2.10,.15,.15],[-6.70,2.16,.11,.12]],8),0,0,0);
    // 移除冗余扁圆球结构，尾梁与机身直接由放样平滑闭合
    // 连续式串列驾驶舱:BLUE_HELI 的前、后座共用一体式舱罩和连续侧梁,前部与机鼻紧密衔接。
    vPrism(bP,cBODY,.42,[[3.92,2.00],[3.30,2.78],[2.50,2.95],[1.60,3.12],[.72,3.30],[.12,3.30],[.12,2.10]],0,0,0);
    heliRBox(bP,.055,.64,.085,cBODY,0,2.82,1.94,.018);             // 一体舱罩中部窄框
    // BLUE_HELI标志性平直装甲玻璃:风挡/顶玻璃按连续舱罩斜面解析贴合。
    vBox(gP,.62,.016,.86,gGLASS,0,2.385,3.604,-2.243);           // 前风挡
    vBox(gP,.60,.016,.66,gGLASS,0,2.860,2.898,-2.933);           // 前舱顶玻璃
    vBox(gP,.66,.016,.85,gGLASS,0,2.605,1.788,-1.926);           // 后风挡
    vBox(gP,.62,.016,.70,gGLASS,0,3.205,1.158,-2.941);           // 后舱顶玻璃
    // 侧窗按外框真实折线贴合
    var AH_FRONT_SIDE_WIN=[[3.68,2.14],[3.22,2.68],[2.44,2.83],[2.34,2.73],[2.34,2.20]];
    var AH_REAR_SIDE_WIN=[[2.22,2.24],[2.22,2.84],[1.54,3.02],[.70,3.18],[.34,3.18],[.34,2.27]];
    vPrism(gP,gGLASSD,.012,AH_FRONT_SIDE_WIN,-.431,0,0);
    vPrism(gP,gGLASSD,.012,AH_FRONT_SIDE_WIN, .431,0,0);
    vPrism(gP,gGLASSD,.012,AH_REAR_SIDE_WIN,-.431,0,0);
    vPrism(gP,gGLASSD,.012,AH_REAR_SIDE_WIN, .431,0,0);
    // 紧贴机首的 PNVS/TADS:位于机鼻正前端与座舱前风挡紧密相接。
    vCyl(bP,.185,.185,.10,14,cSTEEL,0,1.95,4.45,Math.PI/2);     // 上转台底座
    visPartPush(bP,cDARK,ahEll(.205,.155,.155,14),0,1.99,4.52);
    vBox(gP,.245,.075,.018,gPERI,0,2.00,4.68);
    vCyl(bP,.18,.18,.075,14,cSTEEL,0,1.63,4.52,Math.PI/2);      // 下转台底座
    visPartPush(bP,cDARK,ahEll(.205,.175,.155,14),0,1.61,4.60);
    vBox(gP,.23,.11,.018,gGLASSD,0,1.61,4.76);
    vCyl(bP,.015,.015,.85,6,cSTEEL,.40,1.98,4.36,Math.PI/2);
    // 机首两侧大尺寸设备舱(EFAB):前端位于驾驶舱前风挡前沿(z=3.70),向后一直延伸至水平短翼下方(z=0.0)。
    for(var eb=-1;eb<=1;eb+=2){
      heliRBox(bP,.36,.52,3.70,cACC,eb*.58,1.62,1.85,.045,0,0); // 航电设备大颊舱(M6:去除偏航ry,使视觉模型与命中盒gCheekL/R的无旋转位置对齐)
      vBox(bP,.016,.38,3.40,cBODY,eb*.76,1.63,1.85,0,0,0);     // 侧面主维护盖板
      vBox(bP,.010,.32,.030,cDARK,eb*.77,1.63,2.80,0,0,0);     // 维护分区缝
      vBox(bP,.010,.32,.030,cDARK,eb*.77,1.63,0.90,0,0,0);
      vBox(bP,.065,.16,.025,cDARK,eb*.74,1.68,3.55,0,0,0);     // 前端航电冷却进气口
      vBox(bP,.065,.14,.025,cDARK,eb*.74,1.52,0.35,0,0,0);     // 后端散热排气格栅
    }
    // 肩置发动机短舱(参考图1 红框"805"段=方形圆角硬表面,非弧面):
    // 圆角矩形舱体+大平面侧维护盖板+平直前进气面(四边唇口/分流片)+后外侧暗排气口。
    for(var es=-1;es<=1;es+=2){
      // 发动机舱向内收至机体肩部,扩大横向壳宽使内侧实际压入机身;倒角收小以匹配全机六边形硬表面风格。
      var ex=es*.90;
      heliRBox(bP,.92,.80,2.35,cACC,ex,2.86,-.20,.045);                     // 主舱体:内缘±.44,和机体±.70充分相交
      heliRBox(bP,.92,.30,1.30,cACC,ex,2.62,-.20,.025);                     // 下肩内缘与主舱同为±.44,和中央承力舱侧墙齐平相接
      vBox(bP,.025,.56,1.70,cBODY,es*1.37,2.90,-.15);                     // 维护盖板贴合新的舱体外侧面
      vBox(bP,.012,.50,.03,cDARK,es*1.386,2.90,.30);                      // 盖板纵向维护缝×2
      vBox(bP,.012,.50,.03,cDARK,es*1.386,2.90,-.60);
      vCyl(bP,.05,.05,.03,8,cSTEEL,es*1.386,3.06,.62,0,0,Math.PI/2);      // 盖板锁扣圆座
      // 平直前进气面:暗腔+四边唇口+中央分流片(正视参考图2 方形进气口)
      vBox(bP,.42,.46,.04,cDARK,ex,2.92,.985);
      heliRBox(bP,.52,.07,.12,cBODY,ex,3.175,1.00,.02);heliRBox(bP,.52,.07,.12,cBODY,ex,2.665,1.00,.02);
      heliRBox(bP,.07,.52,.12,cBODY,ex-.245,2.92,1.00,.02);heliRBox(bP,.07,.52,.12,cBODY,ex+.245,2.92,1.00,.02);
      vBox(bP,.03,.42,.10,cSTEEL,ex,2.92,1.00);                           // 中央分流片
      // 发动机尾部与短舱壳体齐平,避免排气部件悬空。
      // 排气以短舱背面的暗色矩形槽表达,且完全贴在壳体表面。
      vBox(bP,.17,.16,.018,cDARK,ex,2.76,-1.385,0,0,0);              // 排气槽与新发动机舱中心严格对齐
    }
    // 中央承力舱与机背/尾梁传动轴整流脊背:硬表面垂直侧墙+水平平整顶板,
    // 前段位于左右发动机短舱之间托住旋翼桅,后部在与机身贴合的同时不断延伸和收束,
    // 贯穿整条细长尾梁,并在机尾末端与长条形机尾上的垂尾前缘垂直结构相接。
    visPartPush(bP,cACC,ahDeck([
      [.38,2.70,3.24,.34],    // 前插接段:埋入驾驶舱后部实体壳
      [.14,2.62,3.24,.40],    // 前鞍:顶部保持水平,底部压入主机身
      [-.18,2.58,3.30,.44],   // 前承力墙:左右面与发动机内侧面齐平
      [-.55,2.56,3.34,.44],   // 主减速器平台:宽 .88,顶板完整托住旋翼桅
      [-.92,2.54,3.24,.43],   // 后承力墙
      [-1.34,2.45,3.02,.36],  // 发动机后部开始向下收束
      [-1.76,2.30,2.76,.28],  // 向机身背部收束延伸
      [-2.20,2.15,2.58,.24],  // 机身向尾梁过渡段,平缓过渡
      [-2.60,2.05,2.50,.20],  // 尾梁根部脊背
      [-3.60,2.00,2.48,.16],  // 细长尾梁中前段传动轴整流脊背
      [-4.90,2.05,2.46,.12],  // 尾梁中后段脊背
      [-6.00,2.12,2.44,.08],  // 尾梁后段脊背
      [-6.32,2.16,2.44,.06]   // 机身末端,平滑连接垂尾前缘
    ]),0,0,0);
    // 旋翼桅/桨毂/四叶主旋翼/桅顶"长弓"雷达罩(参考图1 桅顶圆罩逐项复刻)。
    vCyl(bP,.15,.18,.60,12,cSTEEL,0,3.42,-.35);
    vCyl(bP,.11,.11,.50,10,cDARK,0,3.86,-.35);
    vCyl(bP,.40,.45,.16,16,cDARK,0,4.07,-.35);
    // 主旋翼独立旋转组(rP):四片不等弦桨叶与变距连杆(挂在 mainRotorGroup,中心对齐[0, 4.17, -0.35])。
    var rTarget = (rP && rP.push) ? rP : bP;
    var rOffY = (rP && rP.push) ? 0 : 4.17, rOffZ = (rP && rP.push) ? 0 : -0.35;
    for(var rb=0;rb<4;rb++){
      var ra=rb*Math.PI/2+Math.PI/4;
      visPartPush(rTarget,cDARK,ahBlade(),0,rOffY,rOffZ,0,ra,0);
      vCyl(rTarget,.035,.035,.62,7,cSTEEL,Math.sin(ra)*.38,rOffY-0.02,rOffZ+Math.cos(ra)*.38,0,ra,Math.PI/2);
    }
    vCyl(bP,.09,.09,.36,8,cSTEEL,0,4.30,-.35);
    visPartPush(bP,cDARK,ahEll(.62,.40,.62,16),0,4.66,-.35);
    // 后掠短翼:梯形平面、根厚尖窄、微下反;根部椭圆整流肩覆盖翼身交线。
    visPartPush(bP,cBODY,ahSlab([[.50,.85],[2.62,.40],[2.46,-.44],[.52,-.06]],1.94,2.10),0,0,0,0,0,-.05);
    visPartPush(bP,cBODY,ahSlab([[-.50,.85],[-2.62,.40],[-2.46,-.44],[-.52,-.06]],1.94,2.10),0,0,0,0,0,.05);
    // (M5)删除机身↔短翼结合处的整流球(两侧):与翼根板、机身重叠造成穿模,去除后由翼根 ahSlab 直接过渡。
    for(var ws=-1;ws<=1;ws+=2){
      // 外侧挂点: M261 火箭发射巢(7管)——贴合短翼下表面(y=1.828),消除悬空与翼面穿模
      heliRBox(bP, 0.14, 0.04, 0.60, cSTEEL, ws*2.28, 1.815, 0.12, 0.015, 0, 0, ws*-0.05);  // 翼下挂架转接座
      heliRBox(bP, 0.10, 0.18, 0.50, cSTEEL, ws*2.28, 1.705, 0.12, 0.02);                    // 主悬臂挂架(无缝承接巢体)
      vBox(bP, 0.16, 0.03, 0.05, cDARK, ws*2.28, 1.66, 0.28);                                 // 前防摆支架
      vBox(bP, 0.16, 0.03, 0.05, cDARK, ws*2.28, 1.66, -0.04);                                // 后防摆支架
      vCyl(bP, .25, .25, 1.95, 14, cDARK, ws*2.28, 1.47, .10, Math.PI / 2);                    // 火箭巢筒身
      vCyl(bP, .26, .26, .10, 14, cSTEEL, ws*2.28, 1.47, 1.05, Math.PI / 2);                   // 巢口加强环
      for(var ph=0;ph<7;ph++){var pa=ph*Math.PI*2/7;vCyl(gP,.022,.022,.03,5,gGLASSD,ws*2.28+Math.cos(pa)*.13,1.47+Math.sin(pa)*.13,1.10,Math.PI/2);}
      // 内侧挂点: 防空导弹 四联装发射架(ATAS / M299 挂架架构)——全新高精真实建模:
      // 翼下贴合底座(y=1.85紧贴下翼面1.866) + 流线型前倾主挂臂(y=1.71向下延伸至1.57) + 挂架下转接盖板(y=1.58彻底消除断开断层) + 导弹主盖板/承力梁(y=1.54) + 2×2 四联装发射滑轨 + 筒口加强环/尾部排气罩 + 航电控制盒 + 重型紧固夹具
      heliRBox(bP, 0.14, 0.04, 0.65, cSTEEL, ws*1.52, 1.85, 0.15, 0.015, 0, 0, ws*-0.05);   // 翼下贴合座(紧贴下翼面)
      heliRBox(bP, 0.09, 0.24, 0.56, cBODY, ws*1.52, 1.71, 0.16, 0.02, -0.05, 0, 0);        // 流线型主挂架臂(自1.83连续延伸至1.57)
      heliRBox(bP, 0.18, 0.06, 0.62, cSTEEL, ws*1.52, 1.58, 0.16, 0.015);                     // 挂架下适配过渡板(消除与盖板断开问题)
      vBox(bP, 0.18, 0.035, 0.05, cDARK, ws*1.52, 1.61, 0.32);                                // 前防摆支臂
      vBox(bP, 0.18, 0.035, 0.05, cDARK, ws*1.52, 1.61, 0.00);                                // 后防摆支臂
      heliRBox(bP, 0.24, 0.05, 1.20, cSTEEL, ws*1.52, 1.54, 0.18, 0.015);                     // 导弹上盖板与承力横梁(包覆四筒顶部并紧接过渡板)
      heliRBox(bP, 0.24, 0.20, 0.36, cACC, ws*1.52, 1.44, -0.42, 0.02);                       // 后端航电与发射控制箱
      vBox(bP, 0.06, 0.06, 1.15, cSTEEL, ws*1.52, 1.44, 0.18);                                // 四联装中央承力立筋
      vCyl(bP, 0.014, 0.014, 0.38, 6, cDARK, ws*(1.52-0.06), 1.52, 0.05, Math.PI / 2);         // 电气线缆导管
      for (var ts = 0; ts < 4; ts++) {
        var tsx = ws * (1.52 + ((ts % 2) * 0.12 - 0.06));
        var tsy = 1.44 + (Math.floor(ts / 2) * 0.12 - 0.06);
        vCyl(bP, .048, .048, 1.30, 12, cDARK, tsx, tsy, .20, Math.PI / 2);                   // 2×2 四联装发射滑轨筒
        vCyl(bP, .055, .055, .04, 12, cSTEEL, tsx, tsy, .84, Math.PI / 2);                   // 筒口加强环
        vCyl(bP, .052, .052, .04, 12, cSTEEL, tsx, tsy, -.44, Math.PI / 2);                  // 后端排气防护环
      }
      vBox(bP, .28, .28, .04, cSTEEL, ws*1.52, 1.44, -.15);                                   // 后紧固箍带
      vBox(bP, .28, .28, .04, cSTEEL, ws*1.52, 1.44, .52);                                    // 前紧固箍带
      // 翼尖随短翼自然收尖,侧面不设置悬空灯座。
    }
     // 尾部垂尾:前缘从尾梁背部传动轴整流罩末端(z=-6.32, y=2.44)向上延伸至顶端(z=-6.78, y=4.02)
     vPrism(bP,cBODY,.05,[[-6.32,2.44],[-6.78,4.02],[-7.14,3.95],[-6.98,2.00]],0,0,0);
     // 垂尾后下缘(z=-6.98,y=2.00)伸出尾梁末端(z≈-6.70)后留有三角空隙;用一段斜坡把尾梁延伸过去堵上缝隙。
     vPrism(bP,cBODY,.11,[[-6.32,2.44],[-6.98,2.00],[-6.70,1.98],[-6.32,2.05]],0,0,0); // 尾梁末端向垂尾根后缘的补角斜坡
    visPartPush(bP,cBODY,ahSlab([[-.10,-5.52],[-1.42,-5.32],[-1.30,-5.94],[-.10,-6.02]],2.22,2.30),0,0,0);
    visPartPush(bP,cBODY,ahSlab([[.10,-5.52],[1.42,-5.32],[1.30,-5.94],[.10,-6.02]],2.22,2.30),0,0,0);
    visPartPush(bP,cBODY,ahEll(.28,.09,.42,12),0,2.26,-5.72);
    // 左侧四叶尾桨:基座轴在 bP,旋转桨板与毂帽在 trP(挂在 tailRotorGroup,中心对齐[-0.24, 3.25, -6.78])。
    vCyl(bP,.16,.16,.30,12,cDARK,-.14,3.25,-6.78,0,0,Math.PI/2);
    var trTarget = (trP && trP.push) ? trP : bP;
    var trOffX = (trP && trP.push) ? 0 : -0.24, trOffY = (trP && trP.push) ? 0 : 3.25, trOffZ = (trP && trP.push) ? 0 : -6.78;
    vBox(trTarget,.05,.09,1.50,cDARK,trOffX,trOffY,trOffZ,.45,0,0);
    vBox(trTarget,.05,.09,1.50,cDARK,trOffX,trOffY,trOffZ,.45+Math.PI/2,0,0);
    vCyl(trTarget,.05,.05,.07,10,cSTEEL,trOffX,trOffY,trOffZ,0,0,Math.PI/2);
    // 前起落架重做:上端深入机体,下端落到轮轴;在侧视方向由前向后倾约0.30m,不再竖直下垂或与机体断开。
    for(var lg=-1;lg<=1;lg+=2){
      var gearTop=[lg*.52,1.42,2.35],gearAxle=[lg*.82,.49,2.05];
      visPartPush(bP,cACC,ahEll(.15,.13,.19,8),gearTop[0],gearTop[1],gearTop[2]);
      ahLink(bP,.045,.055,8,cSTEEL,gearTop,gearAxle);
      vCyl(bP,.31,.31,.15,12,cRUBB,gearAxle[0],gearAxle[1],gearAxle[2],0,0,Math.PI/2);
      vCyl(bP,.12,.12,.17,8,cSTEEL,gearAxle[0],gearAxle[1],gearAxle[2],0,0,Math.PI/2);
    }
    // 后起落架按三视图重做:尾梁下方枢轴 + 左右双叉臂 + 横向轮轴 + 单尾轮。
    // 轮轴高度与前主轮接地线一致,叉臂端点全部落在真实轮轴上。
    visPartPush(bP,cACC,ahEll(.18,.14,.22,10),0,1.94,-6.06);            // 尾梁下方枢轴整流座
    // 叉臂严格缩短为上一版的 1/3:1.71→0.57;保留原倾角和上端枢轴,轮轴随下端同步上移。
    vCyl(bP,.045,.055,.57,8,cSTEEL,-.11,1.675,-6.165,.377,0,0);      // 左叉臂
    vCyl(bP,.045,.055,.57,8,cSTEEL, .11,1.675,-6.165,.377,0,0);      // 右叉臂
    vCyl(bP,.050,.050,.34,10,cSTEEL,0,1.41,-6.27,0,0,Math.PI/2);     // 横向轮轴
    vCyl(bP,.18,.18,.18,14,cRUBB,0,1.41,-6.27,0,0,Math.PI/2);        // 单尾轮
    vCyl(bP,.070,.070,.20,10,cSTEEL,0,1.41,-6.27,0,0,Math.PI/2);     // 轮毂
    // 机体后部下方无装饰基座与斜杆(避免悬空件);仅保留贴在发动机肩部的告警接收器。
    for(var rw=-1;rw<=1;rw+=2){vBox(bP,.10,.08,.12,cACC,rw*.62,2.98,.80);vCyl(bP,.03,.016,.20,6,cDARK,rw*.64,3.08,.80,0,0,rw*.45);}
  }
  function turretPartsAH64(tP,tG){
    // 颚下炮塔整流罩与下颚护板,以炮塔旋转中心(0, 1.30, 4.05)为基准建模回转。
    heliRBox(tP,.56,.30,.62,cDARK,0,.02,0,.08);
    heliRBox(tP,.40,.14,.50,cACC,0,-.16,.07,.05,-.10);
  }
  function gunPartsAH64(uP){
    // M230 30mm 链炮整体回到机体中心线:炮尾、供弹座、炮管和制退器均以 x=0 对齐膛口基准。
    heliRBox(uP,.25,.19,.48,cSTEEL,0,0,.16,.04);
    heliRBox(uP,.12,.12,.30,cDARK,0,-.04,.08,.03);
    vCyl(uP,.052,.046,1.34,12,cDARK,0,-.02,.89,Math.PI/2);
    vCyl(uP,.073,.061,.18,10,cSTEEL,0,-.02,1.51,Math.PI/2);
  }
  /* ===== RED_HELI geometry =====
     坐标系:+Z 为机头,-Z 为机尾,+X 为右,+Y 为上;与 BLUE_HELI 使用同一游戏尺度。
     名义外形:机身长约 12.35,主旋翼直径约 12.7,桨毂顶高约 4.2。
     主体由菱形机身、高置深截面尾梁、串列座舱、肩置发动机短舱和下反短翼组成。 */
  function hullPartsWZ10(bP, gP, rP, trP) {
    var cRED=[0.62,0.09,0.08];
    var wzBodyRings=[
      [ 5.15,1.68,.25,.27,.15,.18,.08], [ 4.75,1.70,.42,.38,.30,.33,.13],
      [ 4.15,1.74,.60,.50,.50,.48,.17], [ 3.35,1.80,.72,.60,.56,.58,.20],
      [ 2.35,1.84,.88,.66,.60,.70,.24], [ 1.15,1.88,1.04,.69,.62,.78,.28],
      [  .05,1.90,1.08,.68,.62,.80,.30], [-1.15,1.86,.96,.60,.58,.72,.27],
      [-2.05,1.80,.72,.46,.50,.54,.21], [-2.48,1.88,.55,.38,.42,.42,.17],
      [-3.30,1.94,.40,.29,.32,.31,.12], [-4.40,2.03,.27,.20,.22,.21,.08],
      [-5.50,2.13,.15,.11,.12,.11,.05], [-6.65,2.23,.06,.02,.05,.045,.02]
    ];
    // RED_HELI 桨叶:矩形直叶等弦+叶尖小后掠收尖(区别于BLUE_HELI变弦渐缩桨尖),半径 6.35=旋翼直径 12.7 之半。
    function wzBlade(){return ahSlab([[-.20,.32],[.20,.32],[.20,5.85],[.11,6.32],[-.13,6.35],[-.20,5.85]],-.026,.026);}
    // 红五角星识别徽标:逐顶点采样菱形机身侧壁,薄壳随纵向收放与上下折面共同弯曲。
    function wzBodyRingAt(z){
      for(var i=0;i<wzBodyRings.length-1;i++){var a=wzBodyRings[i],b=wzBodyRings[i+1];if(a[0]>=z&&z>=b[0]){
        var t=(a[0]-z)/(a[0]-b[0]),r=[];for(var k=0;k<a.length;k++)r.push(a[k]+(b[k]-a[k])*t);return r;}}
      return wzBodyRings[z>wzBodyRings[0][0]?0:wzBodyRings.length-1];
    }
    function wzBodySkinX(y,z){
      var r=wzBodyRingAt(z),cy=r[1],hh=r[3],top=r[4],shoulder=r[2],chine=r[5],belly=r[6];
      var yt=cy+hh,ys=cy+hh*.10,yc=cy-hh*.52,yb=cy-hh;
      if(y>=ys)return top+(shoulder-top)*clamp((yt-y)/(yt-ys),0,1);
      if(y>=yc)return shoulder+(chine-shoulder)*clamp((ys-y)/(ys-yc),0,1);
      return chine+(belly-chine)*clamp((yc-y)/(yc-yb),0,1);
    }
    function wzStar(side){
      var R=.13,r=.054,cy=1.78,cz=1.05,pos=[],idx=[],contour=[],i,N=4,inside=[0,cy,cz];
      function skinPoint(y,z){return [side*(wzBodySkinX(y,z)+.018),y,z];}
      for(i=0;i<10;i++){var ang=i*Math.PI/5,rad=(i%2)?r:R;contour.push([cy+Math.cos(ang)*rad,cz+Math.sin(ang)*rad]);}
      function rowPoint(a,b,row,col){
        if(row===0)return skinPoint(cy,cz);
        var t=row/N,q=col/row,ey=a[0]+(b[0]-a[0])*q,ez=a[1]+(b[1]-a[1])*q;
        return skinPoint(cy+(ey-cy)*t,cz+(ez-cz)*t);
      }
      for(i=0;i<10;i++){var a=contour[i],b=contour[(i+1)%10];
        for(var row=0;row<N;row++)for(var col=0;col<=row;col++){
          var p0=rowPoint(a,b,row,col),p1=rowPoint(a,b,row+1,col),p2=rowPoint(a,b,row+1,col+1);
          triOrientPush(pos,idx,inside,p0,p1,p2);
          if(col<row)triOrientPush(pos,idx,inside,p0,p2,rowPoint(a,b,row,col+1));
        }
      }
      var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3));g.setIndex(idx);g.computeVertexNormals();return g;
    }
    /* 菱形主机身:平窄顶肩连接座舱,外张上棱形成机身肩部,下棱向尖腹连续收束。 */
    visPartPush(bP,cBODY,wzBodyLoft(wzBodyRings),0,0,0);
    /* 高置深截面尾梁:上缘连接发动机和中央传动舱,下缘近水平并向垂尾逐步收窄。 */
    visPartPush(bP,cACC,ahDeck([
      [-1.55,2.12,2.78,.34],
      [-2.20,2.16,2.75,.32],
      [-3.30,2.20,2.71,.29],
      [-4.55,2.22,2.68,.22],
      [-5.65,2.23,2.65,.15],
      [-6.70,2.25,2.62,.10]
    ]),0,0,0);
    // 尾梁与中央承力舱在 z=-1.85～-1.55 范围内穿接,以直折面保持连续外轮廓。
    // 串列阶梯座舱:前低后高一体式舱罩(RED_HELI 阶梯差小于BLUE_HELI,顶线前缓后高),折线与参考图侧视逐点对应。
    visPartPush(bP,cBODY,wzCockpitShell([
      [4.28,1.99,.48], [3.60,2.70,.50], [2.30,2.82,.50], [2.00,3.02,.50],
      [ .80,3.06,.50],  [ .10,3.04,.50], [-.20,2.35,.50], [4.10,2.05,.50]
    ]),0,0,0); // 前下角与机鼻上缘齐平衔接,楔形部分平滑过渡消除突出锐角破皮;鼻尖下角内收到[4.28,1.99,.48]埋入机鼻蒙皮(原角侧向超出0.061已删)
    // 平直装甲玻璃:风挡/顶玻璃按舱罩斜面解析贴合(rx=atan2(-Δy,Δz) 沿折线定向),阶梯处为结构框。
    vBox(gP,.44,.016,.82,gGLASS,0,2.345,3.94,-2.335);           // 前风挡(大倾角,RED_HELI 风挡更斜;随鼻尖下角内收跟随新斜面)
    vBox(gP,.54,.016,1.22,gGLASS,0,2.76,2.95,.09);             // 前舱顶玻璃
    heliRBox(bP,.50,.055,.34,cBODY,0,2.92,2.15,.02,-2.554);    // 前后舱阶梯结构框(一体舱罩分界)
    vBox(gP,.52,.016,1.12,gGLASS,0,3.04,1.40,.03);             // 后舱顶玻璃
    vBox(gP,.55,.016,.68,gGLASS,0,2.70,-.05,1.98);             // 后风挡(后舱向后下斜切)
    // 侧窗贴舱罩侧表面:前舱五边形+后舱五边形(精确贴合座舱壁,修剪下缘削减穿模部分)。
    var WZ_FRONT_WIN=[[3.48,2.35],[3.38,2.64],[2.36,2.76],[2.20,2.68],[2.20,2.40]];
    var WZ_REAR_WIN=[[2.00,2.48],[2.00,2.95],[.85,2.99],[.25,2.96],[.25,2.50]];
    vPrism(gP,gGLASSD,.006,WZ_FRONT_WIN,-.505,0,0);
    vPrism(gP,gGLASSD,.006,WZ_FRONT_WIN, .505,0,0);
    vPrism(gP,gGLASSD,.006,WZ_REAR_WIN,-.505,0,0);
    vPrism(gP,gGLASSD,.006,WZ_REAR_WIN, .505,0,0);
    // 机鼻单一大光电球塔(RED_HELI 标志:独立旋转光电/红外搜索瞄准+激光照射球,区别于BLUE_HELI双转台)。
    vCyl(bP,.15,.17,.10,12,cSTEEL,0,1.80,5.02,Math.PI/2);      // 球塔基座
    visPartPush(bP,cDARK,ahEll(.27,.27,.27,14),0,1.60,5.32);   // 光电球本体
    vCyl(bP,.08,.10,.14,10,cSTEEL,0,1.82,5.10);                // 球塔顶部连接颈
    vBox(gP,.16,.10,.016,gGLASSD,0,1.63,5.585);                // 正面观察窗
    vBox(gP,.014,.09,.13,gGLASSD,-.262,1.63,5.32);             // 侧窗×2
    vBox(gP,.014,.09,.13,gGLASSD, .262,1.63,5.32);
    vBox(gP,.10,.07,.014,gPERI,0,1.44,5.42);                   // 下颚激光照射器窗
    // 动力组件统一下移,使中央连接舱底面与机体肩部连续贴合;发动机和主旋翼保持原相对位置。
    var wzPowerY=-.09;
    var wzEngineRings=[
      [ 1.04,2.93,.18,.20], [ .86,2.94,.27,.26], [ .52,2.95,.34,.32], [ -.05,2.95,.38,.35],
      [ -.60,2.93,.37,.34], [-1.05,2.87,.30,.29], [-1.38,2.78,.20,.21], [-1.62,2.68,.07,.10]
    ];
    function wzEngineRingAt(z){
      for(var i=0;i<wzEngineRings.length-1;i++){var a=wzEngineRings[i],b=wzEngineRings[i+1];if(a[0]>=z&&z>=b[0]){var t=(a[0]-z)/(a[0]-b[0]);return [z,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t,a[3]+(b[3]-a[3])*t];}}
      return wzEngineRings[z>wzEngineRings[0][0]?0:wzEngineRings.length-1];
    }
    // 外侧维护面片按椭圆截面逐点贴合,不以平盒破坏纺锤轮廓。
    function wzEnginePatch(side,zFront,zRear,vLow,vHigh,zSteps,vSteps,offset){
      var pos=[],idx=[],inside=[0,2.9,(zFront+zRear)/2];
      function point(z,v){var r=wzEngineRingAt(z),arc=Math.sqrt(Math.max(0,1-v*v));return [side*.875+side*(r[2]*arc+offset),r[1]+r[3]*v,z];}
      for(var iz=0;iz<zSteps;iz++)for(var iv=0;iv<vSteps;iv++){
        var za=zFront+(zRear-zFront)*iz/zSteps,zb=zFront+(zRear-zFront)*(iz+1)/zSteps;
        var va=vLow+(vHigh-vLow)*iv/vSteps,vb=vLow+(vHigh-vLow)*(iv+1)/vSteps;
        var p00=point(za,va),p01=point(za,vb),p10=point(zb,va),p11=point(zb,vb);
        triOrientPush(pos,idx,inside,p00,p10,p11);triOrientPush(pos,idx,inside,p00,p11,p01);
      }
      var g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3));g.setIndex(idx);g.computeVertexNormals();return g;
    }
    // 肩置双发短舱:十二边椭圆截面沿纵向先扩张后收束。
    for(var es=-1;es<=1;es+=2){
      var ex=es*.875;   // [2026-09-08]双发外移0.215:内壁0.516脱开座舱玻璃0.511余0.005,补片/唇口/挂件刚性跟随,承力舱侧墙同步外扩包住
      visPartPush(bP,cACC,wzEngineLoft(wzEngineRings,12),ex,wzPowerY,0);
      // 小圆形进气端嵌入纺锤前端。
      vCyl(bP,.16,.16,.05,12,cDARK,ex,2.93+wzPowerY,1.045,Math.PI/2);
      vCyl(bP,.185,.185,.03,12,cSTEEL,ex,2.93+wzPowerY,1.072,Math.PI/2);
      vBox(bP,.03,.26,.08,cSTEEL,ex,2.93+wzPowerY,1.072);
      // 曲面维护盖、两道分区缝和前检查盖均沿当前纺锤截面弯曲。
      visPartPush(bP,cBODY,wzEnginePatch(es,.56,-.92,-.46,.42,8,4,.010),0,wzPowerY,0);
      visPartPush(bP,cDARK,wzEnginePatch(es,.24,.205,-.34,.30,1,3,.016),0,wzPowerY,0);
      visPartPush(bP,cDARK,wzEnginePatch(es,-.43,-.465,-.34,.30,1,3,.016),0,wzPowerY,0);
      visPartPush(bP,cSTEEL,wzEnginePatch(es,.70,.53,-.12,.20,2,2,.017),0,wzPowerY,0);
      // 发动机舱肩部雷达告警接收器。
      vBox(bP,.09,.07,.11,cACC,es*1.195,3.10+wzPowerY,.45);
      vCyl(bP,.025,.015,.18,6,cDARK,es*1.215,3.18+wzPowerY,.45,0,0,es*.45);
    }
    // 中央承力舱硬表面:两侧垂直墙+水平顶板,前段下沉埋入座舱后机背,主平台托住旋翼桅。
    visPartPush(bP,cACC,ahDeck([
      [.60,2.48,3.20,.587],    // 前鞍加宽包住外移短舱内壁(随双发外移0.215同步)
      [.12,2.56,3.26,.542],
      [-.24,2.60,3.31,.523],   // 顶部/侧墙外扩包住短舱(内埋0.03)
      [-.58,2.60,3.32,.540],   // 主减速器平台(侧墙外扩包住短舱,随双发外移同步)
      [-.98,2.56,3.24,.594],
      [-1.42,2.48,3.04,.36],
      [-1.85,2.38,2.82,.28]   // 后收束段与新尾梁重叠连接
    ]),0,wzPowerY,0);
    // 旋翼桅+桨毂+五叶主旋翼(RED_HELI 无桅顶雷达:桨毂以上直接是顶帽,全高显著低于BLUE_HELI长弓构型)。
    vCyl(bP,.13,.16,.50,12,cSTEEL,0,3.50+wzPowerY,-.30);
    vCyl(bP,.09,.09,.40,10,cDARK,0,3.90+wzPowerY,-.30);
    vCyl(bP,.34,.38,.14,16,cDARK,0,3.92+wzPowerY,-.30);
    // 主旋翼独立旋转组(rP):五叶主旋翼全周均布(5×72°)+变距连杆+桨毂顶帽(挂在 mainRotorGroup,中心对齐[0, 4.00+wzPowerY, -0.30])。
    var rTargetW = (rP && rP.push) ? rP : bP;
    var rOffYW = (rP && rP.push) ? 0 : 4.00+wzPowerY, rOffZW = (rP && rP.push) ? 0 : -0.30;
    for(var rb=0;rb<5;rb++){
      var ra=rb*Math.PI*2/5+Math.PI/10;
      visPartPush(rTargetW,cDARK,wzBlade(),0,rOffYW,rOffZW,0,ra,0);
      vCyl(rTargetW,.030,.030,.55,7,cSTEEL,Math.sin(ra)*.32,rOffYW-0.02,rOffZW+Math.cos(ra)*.32,0,ra,Math.PI/2);
    }
    vCyl(rTargetW,.07,.07,.26,8,cSTEEL,0,rOffYW+0.07,rOffZW);
    // 下反短翼:小后掠梯形平面(翼身融合),根部椭圆整流肩覆盖翼身交线;下反角大于BLUE_HELI。
    visPartPush(bP,cBODY,ahSlab([[.55,.60],[2.05,-.05],[2.05,-.70],[.55,-1.15]],1.98,2.14),0,0,0,0,0,-.14);
    visPartPush(bP,cBODY,ahSlab([[-.55,.60],[-2.05,-.05],[-2.05,-.70],[-.55,-1.15]],1.98,2.14),0,0,0,0,0,.14);
    // (M3)删除翼-机身连接处翼面上方的整流球(两侧):与短翼根、机身蒙皮重叠造成穿模与色移,去除后由 ahSlab 翼根板直接过渡。
    for(var ws=-1;ws<=1;ws+=2){
      // 内侧挂点: 90式火箭发射巢(7管)——严密连接下翼面(y=1.809),彻底消除断开与悬空
      heliRBox(bP, 0.14, 0.04, 0.60, cSTEEL, ws*1.35, 1.795, -.25, 0.015, 0, 0, ws*-0.14); // 翼下转接承力座(紧密贴合下反下翼面)
      heliRBox(bP, 0.09, 0.18, 0.50, cSTEEL, ws*1.35, 1.685, -.25, 0.02);                   // 主挂架垂直悬臂(自1.775连续落至1.595,与巢顶1.655无缝交接)
      vBox(bP, 0.15, 0.035, 0.05, cDARK, ws*1.35, 1.63, -.05);                               // 前防摆支架
      vBox(bP, 0.15, 0.035, 0.05, cDARK, ws*1.35, 1.63, -.45);                               // 后防摆支架
      vCyl(bP, .235, .235, 1.85, 14, cDARK, ws*1.35, 1.42, -.22, Math.PI / 2);               // 火箭巢筒身
      vCyl(bP, .245, .245, .09, 14, cSTEEL, ws*1.35, 1.42, .72, Math.PI / 2);                // 巢口加强环
      for(var ph=0;ph<7;ph++){var pa=ph*Math.PI*2/7;vCyl(gP,.020,.020,.03,5,gGLASSD,ws*1.35+Math.cos(pa)*.13,1.42+Math.sin(pa)*.13,.77,Math.PI/2);}
      // 外侧挂点: 空空导弹 四联装发射架——全新高精真实结构建模(RED_HELI/直-19空空导弹专用四联架):
      // 翼下贴合转接底座(y=1.695严密连接下反下翼面1.711,消除断开且无上表面穿模) + 流线型悬臂挂架(y=1.585连接底座与顶梁) + 发射架顶梁(y=1.50) + 2×2矩阵发射筒 + 加强前口环/排气尾环 + 纵向承力中轴梁 + 前后双重型加固箍带 + 后端电气控制舱
      heliRBox(bP, 0.12, 0.04, 0.62, cSTEEL, ws*2.05, 1.695, -.25, 0.015, 0, 0, ws*-0.14);  // 翼下安装座(紧贴下翼面,消除断开)
      heliRBox(bP, 0.08, 0.18, 0.52, cBODY, ws*2.05, 1.585, -.25, 0.02);                     // 流线型主挂架臂(自1.675下探至1.495)
      vBox(bP, 0.14, 0.035, 0.05, cDARK, ws*2.05, 1.53, -.05);                                // 前防摆支臂
      vBox(bP, 0.14, 0.035, 0.05, cDARK, ws*2.05, 1.53, -.45);                                // 后防摆支臂
      heliRBox(bP, 0.10, 0.05, 0.85, cSTEEL, ws*2.05, 1.50, -.20, 0.01);                     // 挂架顶连接梁(无缝承接主挂臂与发射筒体)
      vBox(bP, 0.07, 0.07, 1.34, cSTEEL, ws*2.05, 1.46, -.20);                               // 四联装承力中轴梁
      heliRBox(bP, 0.24, 0.24, 0.22, cDARK, ws*2.05, 1.46, -.92, 0.02);                       // 后端电气与发射控制箱
      vCyl(bP, 0.012, 0.012, 0.50, 6, cDARK, ws*(2.05-0.05), 1.52, -.15, Math.PI / 2);       // 电气导管
      for (var tq = 0; tq < 4; tq++) {
        var tqx = ws * (2.05 + ((tq % 2) * 0.12 - 0.06)), tqy = 1.46 + (Math.floor(tq / 2) * 0.12 - 0.06);
        // 删除包住白色弹体的深灰"发射筒"外壳(与弹体端盖共面导致拉远 z-fighting 灰↔白闪烁);改为裸挂白色导弹,仅保留前后加强环作滑轨夹箍。
        vCyl(bP, .062, .062, .04, 12, cSTEEL, tqx, tqy, .50, Math.PI / 2);                   // 前夹箍环
        vCyl(bP, .058, .058, .04, 12, cSTEEL, tqx, tqy, -.90, Math.PI / 2);                  // 后夹箍环
      }
      vBox(bP, .28, .28, .04, cSTEEL, ws*2.05, 1.46, .18);                                   // 前重型固定箍带
      vBox(bP, .28, .28, .04, cSTEEL, ws*2.05, 1.46, -.58);                                  // 后重型固定箍带
    }
    // 大后掠方顶垂尾、平尾和腹鳍:垂尾根部跨接尾梁上下缘,平尾安装于尾梁末端两侧。
    vPrism(bP,cBODY,.05,[[-5.58,2.64],[-6.35,3.55],[-7.10,3.88],[-7.20,3.86],[-6.95,2.32]],0,0,0); // 垂尾前根落在新尾梁上缘,后根落在下缘
    visPartPush(bP,cBODY,ahSlab([[-.12,-6.05],[-.88,-6.35],[-.78,-6.95],[-.12,-6.90]],2.30,2.38),0,0,0);
    visPartPush(bP,cBODY,ahSlab([[.12,-6.05],[.88,-6.35],[.78,-6.95],[.12,-6.90]],2.30,2.38),0,0,0);
    visPartPush(bP,cBODY,ahEll(.20,.08,.38,12),0,2.30,-6.55);            // 尾梁末端整流
    // 细长下垂尾:位于上垂尾正下方,根部穿入尾梁末端;与后起落架完全分离。
    vPrism(bP,cBODY,.045,[[-5.72,2.22],[-6.08,1.68],[-6.34,1.56],[-6.58,1.66],[-6.76,2.24]],0,0,0); // 下垂尾高度削减一半
    // 左侧十字交叉四叶尾桨(与BLUE_HELI同式:双叶杆以转轴为中心定心交叉,毂帽缩至1/4):基座轴在 bP,旋转桨板与毂帽在 trP(挂在 tailRotorGroup,中心对齐[-0.26, 3.02, -6.85])。
    vCyl(bP,.14,.14,.28,12,cDARK,-.15,3.02,-6.85,0,0,Math.PI/2);
    var trTargetW = (trP && trP.push) ? trP : bP;
    var trOffXW = (trP && trP.push) ? 0 : -0.26, trOffYW = (trP && trP.push) ? 0 : 3.02, trOffZW = (trP && trP.push) ? 0 : -6.85;
    vBox(trTargetW,.05,.10,1.42,cDARK,trOffXW,trOffYW,trOffZW,.42,0,0);
    vBox(trTargetW,.05,.10,1.42,cDARK,trOffXW,trOffYW,trOffZW,.42+Math.PI/2,0,0);
    vCyl(trTargetW,.05,.05,.065,10,cSTEEL,trOffXW,trOffYW,trOffZW,0,0,Math.PI/2);
    // 前主起落架:上端深埋机身侧面,支柱斜向外下+前撑杆;主轮大直径(参考图),接地基准与全队列一致。
    for(var lg=-1;lg<=1;lg+=2){
      // (M4)前主起落架:删除顶端整流球(原深埋机身内的连接点),主支柱起点上移到腹部蒙皮出壳处
      //      (解析 wzBodySkinX 得斜杆在 t≈0.16 穿出蒙皮:x≈0.62,y≈1.42,z≈1.88),不再有埋入机身内的杆段。
      var wzTop=[lg*.62,1.42,1.88],wzAxle=[lg*.98,.47,1.78];
      ahLink(bP,.045,.055,8,cSTEEL,wzTop,wzAxle);                        // 主支柱(自蒙皮表面起)
      ahLink(bP,.035,.045,8,cSTEEL,[lg*.58,1.55,2.30],[lg*.92,.52,1.98]); // 前阻力撑杆
      vCyl(bP,.30,.30,.17,12,cRUBB,wzAxle[0],wzAxle[1],wzAxle[2],0,0,Math.PI/2);
      vCyl(bP,.115,.115,.19,8,cSTEEL,wzAxle[0],wzAxle[1],wzAxle[2],0,0,Math.PI/2);
    }
    // 后起落架保持缩短后的长度与全部前后坐标,只整体上移并重新接入机体;暂不约束接地线。
    var wzRearGearLift=.78;
    visPartPush(bP,cACC,ahEll(.16,.13,.20,10),0,1.14+wzRearGearLift,-5.215);
    ahLink(bP,.035,.045,8,cSTEEL,[-.065,1.1275+wzRearGearLift,-5.215],[-.04,.355+wzRearGearLift,-5.28]);
    ahLink(bP,.035,.045,8,cSTEEL,[ .065,1.1275+wzRearGearLift,-5.215],[ .04,.355+wzRearGearLift,-5.28]);
    vCyl(bP,.045,.045,.30,10,cSTEEL,0,.325+wzRearGearLift,-5.30,0,0,Math.PI/2);
    vCyl(bP,.155,.155,.15,14,cRUBB,0,.325+wzRearGearLift,-5.30,0,0,Math.PI/2);
    vCyl(bP,.060,.060,.17,10,cSTEEL,0,.325+wzRearGearLift,-5.30,0,0,Math.PI/2);
    // 红五角星贴合机身两侧曲面;翼根水平翼圆盘不再承载任何图案。
    for(var mk=-1;mk<=1;mk+=2)visPartPush(bP,cRED,wzStar(mk),0,0,0);
  }
  function turretPartsWZ10(tP,tG){
    // 颚下机炮塔整流罩与下颚护板,以炮塔旋转中心(0, 1.28, 4.70)为基准建模回转。
    heliRBox(tP,.46,.26,.55,cDARK,0,0,0,.07);
    heliRBox(tP,.34,.12,.42,cACC,0,-.16,.08,.04,-.10);
  }
  function gunPartsWZ10(uP){
    // 23mm 链式航炮:炮管细于 M230,制退器小,炮口略超机鼻(参考图比例)。
    heliRBox(uP,.22,.17,.42,cSTEEL,0,0,.12,.04);
    heliRBox(uP,.11,.11,.26,cDARK,0,-.04,.05,.03);
    vCyl(uP,.044,.040,.85,12,cDARK,0,-.02,.60,Math.PI/2);
    vCyl(uP,.060,.052,.13,10,cSTEEL,0,-.02,1.06,Math.PI/2);
  }
/* ===== 按兵种组装:灯组/观察窗拼成独立 unlit Mesh,其余全并入结构 Mesh ===== */
  var gP = [], tP = [], uP = [], mP = [], gG = [], tG = [], rP = [], trP = [];
  var muzzle;
  _skipVis = !!INST_TPL[team + '|' + kind];            // 模板短路:视觉模板已缓存 → 构建器跳过全部视觉几何(命中壳照常)
  if (kind === 'arty') {
    if (team === 'blue') { groupPartsBLUE_MLRS(gP, gG); turretPartsBLUE_MLRS(tP); gunPartsBLUE_MLRS(uP); }
    else { groupPartsPHL11(gP, gG); turretPartsPHL11(tP); gunPartsPHL11(uP); }
  } else if (kind === 'aa') {
    if (team === 'blue') { groupPartsAvenger(gP, gG); turretPartsAvenger(tP, tG); gunPartsAvenger(uP); }
    else { _suspSetRow('pgz95'); groupPartsPGZ95(gP, gG); turretPartsPGZ95(tP, tG); gunPartsPGZ95(uP); }
  } else if (kind === 'ah64') {
    hullPartsAH64(gP,gG,rP,trP); turretPartsAH64(tP,tG); gunPartsAH64(uP);
  } else if (kind === 'wz10') {
    hullPartsWZ10(gP,gG,rP,trP); turretPartsWZ10(tP,tG); gunPartsWZ10(uP);
  } else if (kind === 'td' && team === 'red') {                       // 红方歼击车=89 式
    _suspSetRow('td89');
    hullParts89(gP, gG); turretParts89(tP, tG, mP); gunParts89(uP);
  } else if (m1Platform) {                                             // BLUE_MBT_2 车体/旋塔/主炮全新分支
    _suspSetRow('m1');
    hullPartsBLUE_MBT_2(gP, gG); turretPartsBLUE_MBT_2(tP, tG, mP); gunPartsBLUE_MBT_2(uP);
  } else if (kind === '99') {                                          // 红方RED_MBT_2(炮盾并入塔件,mP 恒空)
    _suspSetRow('t99');
    hullParts99(gP, gG); turretParts99(tP, tG); gunParts99(uP);
  } else if (team === 'red') {                                    // 我方坦克=59 式(T-54A)形象
    _suspSetRow('t59');
    hullParts59(gP, gG); turretParts59(tP, tG); gunParts59(uP); mantletParts59(tP, tG);   // 炮盾=静态贴体铸造炮翼并入塔件(mP 恒空=无炮盾动件)
  } else {                                                          // 蓝方主战坦克:BLUE_MBT_1 完整建模
    _suspSetRow('m60');
    hullPartsM60(gP, gG); turretPartsM60(tP, tG); gunPartsM60(uP, mP);
  }
  _suspSetRow('t59'); _suspTagClear();                              // 建完复位,防跨车型串味
  _CAMO_BODY_REF = null; _CAMO_ACC_REF = null; _CAMO_TEAM = 'red';      // 迷彩身份基准复位(同上;合并管线读件自带 camo,不依赖此引用)
  /* InstancedMesh——几何按 team|kind 建一次缓存共享;个体视觉网格仍建(残骸合并 mergeWreckMeshes 要用),
     但标 _instSrc 并置 visible=false,由实例流渲染。mergeVisParts 只首次调用(建模板),此后复用模板几何建 Mesh。 */
  var mainRotorGroup = null, tailRotorGroup = null;
  if (kind === 'ah64') {
    mainRotorGroup = new THREE.Object3D();
    mainRotorGroup.position.set(0, 4.17, -0.35);
    group.add(mainRotorGroup);
    tailRotorGroup = new THREE.Object3D();
    tailRotorGroup.position.set(-0.24, 3.25, -6.78);
    group.add(tailRotorGroup);
  } else if (kind === 'wz10') {
    var wzPwrY = -0.09;
    mainRotorGroup = new THREE.Object3D();
    mainRotorGroup.position.set(0, 4.00 + wzPwrY, -0.30);
    group.add(mainRotorGroup);
    tailRotorGroup = new THREE.Object3D();
    tailRotorGroup.position.set(-0.26, 3.02, -6.85);
    group.add(tailRotorGroup);
  }

  var _tpl = instBuildTemplate(team, kind, { hull: gP, hullGlow: gG, turret: tP, turretGlow: tG, gun: uP, mantlet: mP, mainRotor: rP, tailRotor: trP });
  _skipVis = false;                                    // 短路窗口闭合:以下命中壳/个体网格注册照常
  var turMeshRef = _mkInstSrc(turret, _tpl.turret, isP ? vehBodyMatPlayer : vehBodyMat, !isP);   // P0-2:玩家件走 uniform 链(孤儿材质挂载)
  var turGlowRef = _tpl.turretGlow ? _mkInstSrc(turret, _tpl.turretGlow, vehGlowMat, !isP) : null;
  var gunMeshRef = _mkInstSrc(gunPivot, _tpl.gun, isP ? vehBodyMatPlayer : vehBodyMat, !isP);          // 身管(后坐滑移由实例矩阵承载;P0-2 同上)
  var manMeshRef = _tpl.mantlet ? _mkInstSrc(gunPivot, _tpl.mantlet, isP ? vehBodyMatPlayer : vehBodyMat, !isP) : null;   // P0-2 同上
  var mainRotorMeshRef = (mainRotorGroup && _tpl.mainRotor) ? _mkInstSrc(mainRotorGroup, _tpl.mainRotor, isP ? vehBodyMatPlayer : vehBodyMat, !isP) : null;   // P0-2 同上
  var tailRotorMeshRef = (tailRotorGroup && _tpl.tailRotor) ? _mkInstSrc(tailRotorGroup, _tpl.tailRotor, isP ? vehBodyMatPlayer : vehBodyMat, !isP) : null;   // P0-2 同上
  var _hullMeshRef = _mkInstSrc(group, _tpl.hull, isP ? vehHullMatPlayer : vehBodyMat, !isP);
  var _hullGlowRef = _tpl.hullGlow ? _mkInstSrc(group, _tpl.hullGlow, vehGlowMat, !isP) : null;
  if (_tpl.hull) instEnsureMesh(team, kind, 'hull', _tpl.hull, vehHullMat);
  if (_tpl.hullGlow) instEnsureMesh(team, kind, 'hullGlow', _tpl.hullGlow, vehGlowMat);
  if (_tpl.turret) instEnsureMesh(team, kind, 'turret', _tpl.turret, vehBodyMat);
  if (_tpl.turretGlow) instEnsureMesh(team, kind, 'turretGlow', _tpl.turretGlow, vehGlowMat);
  if (_tpl.gun) instEnsureMesh(team, kind, 'gun', _tpl.gun, vehBodyMat);
  if (_tpl.mantlet) instEnsureMesh(team, kind, 'mantlet', _tpl.mantlet, vehBodyMat);
  if (_tpl.mainRotor) instEnsureMesh(team, kind, 'mainRotor', _tpl.mainRotor, vehBodyMat);
  if (_tpl.tailRotor) instEnsureMesh(team, kind, 'tailRotor', _tpl.tailRotor, vehBodyMat);
  // 炮塔/身管免疫包围球剔除(实例化后 InstancedMesh frustumCulled=false,此保险保留无害)
  turMeshRef.frustumCulled = false; if (turGlowRef) turGlowRef.frustumCulled = false; gunMeshRef.frustumCulled = false;
  if (manMeshRef) manMeshRef.frustumCulled = false;
  if (kind === 'arty') { var mA = new THREE.Object3D(); mA.position.set(0, team === 'blue' ? 0.10 : 0.55, team === 'blue' ? 3.64 : 2.42); gunPivot.add(mA); muzzle = mA; }   // 蓝 BLUE_MLRS 舱口(6 管中心)/红 RED_MLRS 管束口
  else if (kind === 'ah64') { var mH = new THREE.Object3D(); mH.position.set(0,-0.02,1.52); gunPivot.add(mH); muzzle=mH; }   // M230 膛口
  else if (kind === 'wz10') { var mW = new THREE.Object3D(); mW.position.set(0,-0.02,1.13); gunPivot.add(mW); muzzle=mW; }   // 23mm 膛口
  else if (kind === 'td') { var mT = new THREE.Object3D(); mT.position.set(0, 0, team === 'red' ? 5.65 : 4.82); gunPivot.add(mT); muzzle = mT; }   // 红RED_TD膛口车系z5.69;蓝BLUE_MBT_2座圈前移居中后膛口车系z5.94,均走真实muzzle链
   // 59 局部 3.55 补偿耳轴后沉 0.40⇒膛口世界位 (1.53,4.15)=历代1.39+T59_LIFT 与历代逐分毫相同(弹道/曳光/烟焰全挂 getWorldPosition,零感)
  else if (kind === 'aa') { var mAA = new THREE.Object3D(); mAA.position.set(0, 0, team === 'red' ? 3.60 : 0.95); gunPivot.add(mAA); muzzle = mAA; }   // RED_AA 双联机炮炮口(fireAAGun 在 ±1.02 耳轴间切换)/BLUE_AA无机炮(占位,永不消费)
  else { muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, kind === '99' ? 3.85 : (team === 'red' ? 3.55 : 3.15)); gunPivot.add(muzzle); }

  /* ===== 直升机精准多边形命中壳生成器 (RED_HELI & BLUE_HELId) =====
     用与美术建模外形严格贴合的简化多边形几何(机身放样/座舱棱柱/尾梁/垂尾/平尾/短翼/双发短舱/颚下炮塔/起落架轮)
     命中壳与美术外形贴合,无空气装甲与未覆盖死角。 */
  var AH64_BODY_RINGS = [
    [4.50,1.68,.30,.31],[4.38,1.70,.43,.41],[4.15,1.75,.52,.51],[3.72,1.82,.59,.58],
    [2.88,1.87,.66,.64],[1.82,1.91,.73,.72],[.52,1.93,.76,.77],[-.82,1.92,.70,.76],
    [-1.88,1.88,.55,.60],[-2.74,1.84,.37,.38]
  ];
  var AH64_TAIL_RINGS = [
    [-2.40,1.86,.34,.30],[-3.60,1.92,.26,.24],[-4.90,2.00,.20,.19],[-6.00,2.10,.15,.15],[-6.70,2.16,.11,.12]
  ];
  var WZ10_BODY_RINGS = [
    [ 5.15,1.68,.25,.27,.15,.18,.08], [ 4.75,1.70,.42,.38,.30,.33,.13],
    [ 4.15,1.74,.60,.50,.50,.48,.17], [ 3.35,1.80,.72,.60,.56,.58,.20],
    [ 2.35,1.84,.88,.66,.60,.70,.24], [ 1.15,1.88,1.04,.69,.62,.78,.28],
    [  .05,1.90,1.08,.68,.62,.80,.30], [-1.15,1.86,.96,.60,.58,.72,.27],
    [-2.05,1.80,.72,.46,.50,.54,.21], [-2.48,1.88,.55,.38,.42,.42,.17],
    [-3.30,1.94,.40,.29,.32,.31,.12], [-4.40,2.03,.27,.20,.22,.21,.08],
    [-5.50,2.13,.15,.11,.12,.11,.05], [-6.65,2.23,.06,.02,.05,.045,.02]
  ];
  var WZ10_ENGINE_RINGS = [
    [ 1.04,2.93,.18,.20], [ .86,2.94,.27,.26], [ .52,2.95,.34,.32], [ -.05,2.95,.38,.35],
    [ -.60,2.93,.37,.34], [-1.05,2.87,.30,.29], [-1.38,2.78,.20,.21], [-1.62,2.68,.07,.10]
  ];

  function wz10HullHitGeo() {
    var wzPowerY = -0.09;
    var gFuselage = wzBodyLoft(WZ10_BODY_RINGS);
    var gTailDeck = ahDeck([
      [-1.55, 2.12, 2.78, .34],
      [-2.20, 2.16, 2.75, .32],
      [-3.30, 2.20, 2.71, .29],
      [-4.55, 2.22, 2.68, .22],
      [-5.65, 2.23, 2.65, .15],
      [-6.70, 2.25, 2.62, .10]
    ]);
    var gCockpit = wzCockpitShell([
      [4.45, 2.02, .50], [3.60, 2.70, .50], [2.30, 2.82, .50], [2.00, 3.02, .50],
      [.80, 3.06, .50],   [.10, 3.04, .50], [-.20, 2.35, .50], [4.10, 2.05, .50]
    ]);
    var gBall = ahEll(0.27, 0.27, 0.27, 8);
    var gMast = new THREE.CylinderGeometry(0.18, 0.18, 0.65, 8);
    var gVFin = prismGeo(0.05, [[-5.58, 2.64], [-6.35, 3.55], [-7.10, 3.88], [-7.20, 3.86], [-6.95, 2.32]]);
    var gSubFin = prismGeo(0.045, [[-5.72, 2.22], [-6.08, 1.68], [-6.34, 1.56], [-6.58, 1.66], [-6.76, 2.24]]); // 下垂尾碰撞壳高度削减一半
    var gHStabL = ahSlab([[-.12, -6.05], [-.88, -6.35], [-.78, -6.95], [-.12, -6.90]], 2.30, 2.38);
    var gHStabR = ahSlab([[.12, -6.05], [.88, -6.35], [.78, -6.95], [.12, -6.90]], 2.30, 2.38);
    var gWingL = ahSlab([[-.55, .60], [-2.05, -.05], [-2.05, -.70], [-.55, -1.15]], 1.98, 2.14);
    gWingL.applyMatrix4(new THREE.Matrix4().makeRotationZ(0.14));
    var gWingR = ahSlab([[.55, .60], [2.05, -.05], [2.05, -.70], [.55, -1.15]], 1.98, 2.14);
    gWingR.applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.14));
    var gTailWheel = new THREE.CylinderGeometry(0.16, 0.16, 0.16, 8); gTailWheel.rotateZ(Math.PI / 2);

    return mergeHitGeos([
      { g: gFuselage }, { g: gTailDeck }, { g: gCockpit },
      { g: gBall, y: 1.60, z: 5.32 },
      { g: gMast, y: 3.70 + wzPowerY, z: -0.30 },
      { g: gVFin }, { g: gSubFin }, { g: gHStabL }, { g: gHStabR },
      { g: gWingL }, { g: gWingR }
    ]);
  }

  function wz10AmmoHitGeo() {
    var gBay = new THREE.BoxGeometry(0.80, 0.46, 1.10);                                       // 机身航炮主供弹舱
    var gRkL = new THREE.CylinderGeometry(0.24, 0.24, 1.85, 8); gRkL.rotateX(Math.PI / 2);    // 左内侧 90式火箭巢
    var gRkR = new THREE.CylinderGeometry(0.24, 0.24, 1.85, 8); gRkR.rotateX(Math.PI / 2);    // 右内侧 90式火箭巢
    var gMsL = new THREE.BoxGeometry(0.32, 0.32, 1.46);                                      // 左外侧 空空导弹 四联装导弹发射架包络盒
    var gMsR = new THREE.BoxGeometry(0.32, 0.32, 1.46);                                      // 右外侧 空空导弹 四联装导弹发射架包络盒
    return mergeHitGeos([
      { g: gBay, y: 1.60, z: 0.55 },
      { g: gRkL, x: -1.35, y: 1.42, z: -0.22 },
      { g: gRkR, x:  1.35, y: 1.42, z: -0.22 },
      { g: gMsL, x: -2.05, y: 1.46, z: -0.20 },
      { g: gMsR, x:  2.05, y: 1.46, z: -0.20 }
    ]);
  }

  function wz10EngineHitGeo() {
    var wzPowerY = -0.09;
    var gEngL = wzEngineLoft(WZ10_ENGINE_RINGS, 8);
    var gEngR = wzEngineLoft(WZ10_ENGINE_RINGS, 8);
    var gDeck = ahDeck([
      [.60, 2.48, 3.20, .587],
      [.12, 2.56, 3.26, .542],
      [-.24, 2.60, 3.31, .523],
      [-.58, 2.60, 3.32, .540],
      [-.98, 2.56, 3.24, .594],
      [-1.42, 2.48, 3.04, .36],
      [-1.85, 2.38, 2.82, .28]
    ]);
    return mergeHitGeos([
      { g: gEngL, x: -0.875, y: wzPowerY },
      { g: gEngR, x:  0.875, y: wzPowerY },
      { g: gDeck, y: wzPowerY }
    ]);
  }

  function wz10TurretHitGeo() {
    var gUpper = heliRoundedBoxGeo(0.46, 0.26, 0.55, 0.07);
    var gLower = heliRoundedBoxGeo(0.34, 0.12, 0.42, 0.04);
    return mergeHitGeos([
      { g: gUpper, y: 0.00, z: 0.00 },
      { g: gLower, y: -0.16, z: 0.08 }
    ]);
  }

  function ah64HullHitGeo() {
    var gFuselage = ahLoft(AH64_BODY_RINGS, 8);
    var gTailBoom = ahLoft(AH64_TAIL_RINGS, 8);
    var gShoulder = ahEll(0.42, 0.36, 0.66, 8);
    var gCockpit = prismGeo(0.42, [[3.92, 2.00], [3.30, 2.78], [2.50, 2.95], [1.60, 3.12], [.72, 3.30], [.12, 3.30], [.12, 2.10]]);
    var gPnvs = ahEll(0.205, 0.155, 0.155, 8);
    var gTads = ahEll(0.205, 0.175, 0.155, 8);
    var gCheekL = heliRoundedBoxGeo(0.36, 0.52, 3.70, 0.045);
    var gCheekR = heliRoundedBoxGeo(0.36, 0.52, 3.70, 0.045);
    var gMast = new THREE.CylinderGeometry(0.16, 0.18, 0.75, 8);
    var gRadar = ahEll(0.62, 0.40, 0.62, 10);
    var gTailDeck = ahDeck([
      [-1.76, 2.30, 2.76, .28],
      [-2.20, 2.15, 2.58, .24],
      [-2.60, 2.05, 2.50, .20],
      [-3.60, 2.00, 2.48, .16],
      [-4.90, 2.05, 2.46, .12],
      [-6.00, 2.12, 2.44, .08],
      [-6.32, 2.16, 2.44, .06]
    ]);
    var gVFin = prismGeo(0.05, [[-6.32, 2.44], [-6.78, 4.02], [-7.14, 3.95], [-6.98, 2.00]]);
    var gHStabL = ahSlab([[-.10, -5.52], [-1.42, -5.32], [-1.30, -5.94], [-.10, -6.02]], 2.22, 2.30);
    var gHStabR = ahSlab([[.10, -5.52], [1.42, -5.32], [1.30, -5.94], [.10, -6.02]], 2.22, 2.30);
    var gWingL = ahSlab([[-.50, .85], [-2.62, .40], [-2.46, -.44], [-.52, -.06]], 1.94, 2.10);
    gWingL.applyMatrix4(new THREE.Matrix4().makeRotationZ(0.05));
    var gWingR = ahSlab([[.50, .85], [2.62, .40], [2.46, -.44], [.52, -.06]], 1.94, 2.10);
    gWingR.applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.05));
    // 尾梁末端向垂尾根后缘的补角斜坡(与视觉一致，纳入机身命中判定)
    var gTailRamp = prismGeo(0.11, [[-6.32, 2.44], [-6.98, 2.00], [-6.70, 1.98], [-6.32, 2.05]]);

    return mergeHitGeos([
      { g: gFuselage }, { g: gTailBoom }, { g: gTailDeck },
      { g: gShoulder, y: 1.82, z: -2.32 },
      { g: gCockpit },
      { g: gPnvs, y: 1.99, z: 4.52 },
      { g: gTads, y: 1.61, z: 4.60 },
      { g: gCheekL, x: -0.58, y: 1.62, z: 1.85 },
      { g: gCheekR, x:  0.58, y: 1.62, z: 1.85 },
      { g: gMast, y: 3.86, z: -0.35 },
      { g: gRadar, y: 4.66, z: -0.35 },
      { g: gVFin }, { g: gTailRamp }, { g: gHStabL }, { g: gHStabR },
      { g: gWingL }, { g: gWingR }
    ]);
  }

  function ah64AmmoHitGeo() {
    var gBay = new THREE.BoxGeometry(0.95, 0.50, 1.20);                                       // 机身 M230 链炮主供弹舱
    var gRkL = new THREE.CylinderGeometry(0.25, 0.25, 1.95, 8); gRkL.rotateX(Math.PI / 2);    // 左外侧 M261 火箭发射巢
    var gRkR = new THREE.CylinderGeometry(0.25, 0.25, 1.95, 8); gRkR.rotateX(Math.PI / 2);    // 右外侧 M261 火箭发射巢
    var gMsL = new THREE.BoxGeometry(0.30, 0.30, 1.36);                                      // 左内侧 防空导弹 四联装刺针发射架包络盒
    var gMsR = new THREE.BoxGeometry(0.30, 0.30, 1.36);                                      // 右内侧 防空导弹 四联装刺针发射架包络盒
    return mergeHitGeos([
      { g: gBay, y: 1.62, z: 0.45 },
      { g: gRkL, x: -2.28, y: 1.47, z: 0.10 },
      { g: gRkR, x:  2.28, y: 1.47, z: 0.10 },
      { g: gMsL, x: -1.52, y: 1.44, z: 0.20 },
      { g: gMsR, x:  1.52, y: 1.44, z: 0.20 }
    ]);
  }

  function ah64EngineHitGeo() {
    var gEngL = heliRoundedBoxGeo(0.92, 0.80, 2.35, 0.045);
    var gEngR = heliRoundedBoxGeo(0.92, 0.80, 2.35, 0.045);
    var gShL = heliRoundedBoxGeo(0.92, 0.30, 1.30, 0.025);
    var gShR = heliRoundedBoxGeo(0.92, 0.30, 1.30, 0.025);
    var gDeck = ahDeck([
      [.38, 2.70, 3.24, .34],
      [.14, 2.62, 3.24, .40],
      [-.18, 2.58, 3.30, .44],
      [-.55, 2.56, 3.34, .44],
      [-.92, 2.54, 3.24, .43],
      [-1.34, 2.45, 3.02, .36],
      [-1.76, 2.30, 2.76, .28]
    ]);
    return mergeHitGeos([
      { g: gEngL, x: -0.90, y: 2.86, z: -0.20 },
      { g: gEngR, x:  0.90, y: 2.86, z: -0.20 },
      { g: gShL,  x: -0.90, y: 2.62, z: -0.20 },
      { g: gShR,  x:  0.90, y: 2.62, z: -0.20 },
      { g: gDeck }
    ]);
  }

  function ah64TurretHitGeo() {
    var gUpper = heliRoundedBoxGeo(0.56, 0.30, 0.62, 0.08);
    var gLower = heliRoundedBoxGeo(0.40, 0.14, 0.50, 0.05);
    return mergeHitGeos([
      { g: gUpper, y: 0.02, z: 0.00 },
      { g: gLower, y: -0.16, z: 0.07 }
    ]);
  }

  function wzRotorBladesHitGeo() {
    var blades = [];
    for (var b = 0; b < 5; b++) {
      var ang = b * Math.PI * 2 / 5 + Math.PI / 10;
      var gB = new THREE.BoxGeometry(0.44, 0.12, 6.10);
      gB.translate(0, 0, 3.20);
      gB.applyMatrix4(new THREE.Matrix4().makeRotationY(ang));
      blades.push({ g: gB });
    }
    return mergeHitGeos(blades);
  }
  function ahRotorBladesHitGeo() {
    var blades = [];
    for (var b = 0; b < 4; b++) {
      var ang = b * Math.PI / 2;
      var gB = new THREE.BoxGeometry(0.48, 0.12, 7.00);
      gB.translate(0, 0, 3.65);
      gB.applyMatrix4(new THREE.Matrix4().makeRotationY(ang));
      blades.push({ g: gB });
    }
    return mergeHitGeos(blades);
  }
  /* ===== 模块碰撞盒 ===== */
  var tA = o.turretArmor || C.turretArmor;
  var defs = kind === 'aa' ? (team === 'blue' ? [
    /* ===== 蓝方 蓝方防空车 (BLUE_AA)模块表(命中检测=与实际建模轮廓一致的简化共形壳;全长4.95×全宽2.18×全高2.64m)=====
       turret=PMS 炮塔舱;ammo=2×四联 防空导弹 发射箱(弹药架,击毁殉爆);gun=FLIR 光电头;走行=前后轮共形带。 */
    ['trackL', modLabel(kind, team, 'trackL'), 70, { all: 8 }, [0.34, 0.93, 3.50], [-0.91, 0.465, 0.05], group],  // 任务26:真命中壳=前后轮胎共形圆柱+翼子板(专用分支,静态默认姿态,不随车轮旋转),本行尺寸仅占位
    ['trackR', modLabel(kind, team, 'trackR'), 70, { all: 8 }, [0.34, 0.93, 3.50], [ 0.91, 0.465, 0.05], group],
    ['engine', modLabel(kind, team, 'engine'), 90, { all: 8 }, [1.50, 0.46, 1.10], [0, 0.88, 1.60], group],       // 前置发动机罩(底特律 V8 6.2L);任务26:顶 1.11 齐引擎罩顶,完整收入车体棱柱内
    ['ammo',   modLabel(kind, team, 'ammo'),   70, { all: 8 }, [1.85, 0.55, 1.80], [0, 0, 0.70], gunPivot],       // 2×四联发射箱(随回转/俯仰;导弹在箱内,击毁殉爆);任务25:真命中壳=defs 专用分支两侧贴身双箱,本行尺寸仅占位
    ['fuel',   modLabel(kind, team, 'fuel'),   60, { all: 6 }, [0.90, 0.32, 0.50], [0, 0.725, -0.90], group],     // 底盘后部油箱(95L);任务26:底 0.565 不再穿出车底 0.55
    ['hull',   modLabel(kind, team, 'hull'),   0, C.hullArmor, [2.00, 1.15, 4.70], [0, 1.05, 0], group],          // 悍马车体主壳;任务26:真命中壳=共形组合壳(下身/驾驶室双棱柱+鼻尖/保险杠/顶板/甲板抬升/尾坡/杂物箱,专用分支),本行尺寸仅占位
    ['turret', modLabel(kind, team, 'turret'), 80, tA, [1.10, 0.95, 1.50], [0, 0.62, 0], turret],                 // PMS 炮塔舱(座圈至舱顶);任务26:真命中壳=前窄后宽楔形阶梯+座圈+舱顶+发射梁(专用分支),本行尺寸仅占位
    ['gun',    modLabel(kind, team, 'gun'),    65, { all: 8 }, [0.46, 0.26, 0.26], [0, 0.98, 0.84], turret]       // FLIR 光电头(AN/VLR-1);任务26:this module box is active; launcher hit detection belongs to the dedicated ammo shell
  ] : [
    /* ===== 红方 RED_AA 模块表(命中检测=与实际建模轮廓一致的简化共形壳)=====
       turret=炮塔(含雷达桅杆/光电头);ammo=4×防空导弹+导轨支架(随炮俯仰,击毁殉爆);gun=双联机炮×2+摇架/身管。 */
    ['trackL', modLabel(kind, team, 'trackL'), 70, { all: 10 }, [0.44, 1.225, 6.19], [-1.42, 0.6125, -0.05], group], // 任务27:真命中壳=trackRingGeo(trackLoopPGZ())环带@x±1.42(与59/99/89/M1/M60同款,与视觉分段板同物理环路;静态默认环),本行尺寸仅占位
    ['trackR', modLabel(kind, team, 'trackR'), 70, { all: 10 }, [0.44, 1.225, 6.19], [ 1.42, 0.6125, -0.05], group],
    ['engine', modLabel(kind, team, 'engine'), 90, { all: 10 }, [1.15, 0.60, 1.10], [0.30, 1.0625, 2.35], group],   // 前置动力舱(首上格栅斜面后;2026-09-11 随车体降 R/4)
    ['ammo',   modLabel(kind, team, 'ammo'),   70, { all: 8 }, [2.70, 0.65, 1.70], [0, 0.55, 0.55], gunPivot],    // 4×防空导弹+导轨(随炮俯仰;导弹在架上,击毁殉爆);任务25:真命中壳=两侧贴身双箱+塔下圆盘(专用分支+addExactHit),本行尺寸仅占位
    ['fuel',   modLabel(kind, team, 'fuel'),   60, { all: 8 }, [0.84, 0.45, 0.90], [-0.70, 0.9125, 0.80], group],   // 左侧车体油箱(随车体降 R/4);任务26:x 收窄至 -1.12..-0.28 不再穿出车体侧墙
    ['hull',   modLabel(kind, team, 'hull'),   0, C.hullArmor, [2.40, 1.05, 6.50], [0, 1.0625, 0], group],          // 车体(节点抬高 0.3125);任务26:真命中壳=与视觉 aa95BuildHull 同参数棱柱+翼子板/储物箱/驾驶舱盖(专用分支),本行尺寸仅占位
    ['turret', modLabel(kind, team, 'turret'), 80, tA, [1.62, 0.85, 2.35], [0, 0.42, -0.20], turret],             // 炮塔塔体;任务26:真命中壳=同截面棱柱+顶盖/车长舱盖/光电头/雷达桅杆天线盘(专用分支),本行尺寸仅占位
    ['gun',    modLabel(kind, team, 'gun'),    70, { all: 8 }, [2.30, 0.85, 3.95], [0, 0.02, 1.85], gunPivot]     // 双联机炮×2+摇架/身管(随塔回转/俯仰);任务26:真命中壳=视觉身管合并网格 gunMeshRef(通用分支,与 aa95BuildGuns 逐件同形),本行尺寸仅占位
  ]) : kind === 'ah64' ? [
    // 蓝方BLUE_HELI:主螺旋桨(30mm等效装甲,挂在 mainRotorGroup)、肩置双发、机身弹药/油箱、颚炮塔/链炮、尾桨。
    ['trackL', modLabel(kind, team, 'trackL'), 80, { all: 30 }, [14.6, 0.16, 14.6], [0, 0, 0], mainRotorGroup || group],
    ['trackR', modLabel(kind, team, 'trackR'), 80, { all: 30 }, [0.1, 0.1, 0.1], [0, -100, 0], group],
    ['engine', modLabel(kind, team, 'engine'), 100, { all: 14 }, [2.00,0.85,2.40], [0,2.86,-0.20], group],
    ['ammo', modLabel(kind, team, 'ammo'), 65, { all: 10 }, [0.95,0.50,1.20], [0,1.62,0.45], group],
    ['fuel', modLabel(kind, team, 'fuel'), 70, { all: 10 }, [1.05,0.55,1.40], [0,1.70,-0.80], group],
    ['hull', modLabel(kind, team, 'hull'), 0, C.hullArmor, [1.55,2.60,7.60], [0,2.10,0.70], group],
    ['turret', modLabel(kind, team, 'turret'), 75, tA, [0.56,0.30,0.62], [0,0,0], turret],
    ['gun', modLabel(kind, team, 'gun'), 65, { all: 12 }, [0.24,0.24,1.40], [0,-0.02,0.70], gunPivot],
    ['tailRotor', modLabel(kind, team, 'tailRotor'), 40, { all: 8 }, [0.55,1.30,0.30], [-0.24,3.25,-6.78], group]
  ] : kind === 'wz10' ? [
    // 红方RED_HELI:主螺旋桨(30mm等效装甲,挂在 mainRotorGroup)、肩置双发、机身弹药/油箱、颚炮塔/航炮、剪刀尾桨。
    ['trackL', modLabel(kind, team, 'trackL'), 80, { all: 30 }, [12.7, 0.16, 12.7], [0, 0, 0], mainRotorGroup || group],
    ['trackR', modLabel(kind, team, 'trackR'), 80, { all: 30 }, [0.1, 0.1, 0.1], [0, -100, 0], group],
    ['engine', modLabel(kind, team, 'engine'), 100, { all: 14 }, [2.35,0.85,2.30], [0,2.83,-0.35], group],
    ['ammo', modLabel(kind, team, 'ammo'), 65, { all: 10 }, [0.80,0.46,1.10], [0,1.60,0.55], group],
    ['fuel', modLabel(kind, team, 'fuel'), 70, { all: 10 }, [0.95,0.52,1.30], [0,1.68,-0.75], group],
    ['hull', modLabel(kind, team, 'hull'), 0, C.hullArmor, [2.20,2.40,7.20], [0,2.05,1.35], group],
    ['turret', modLabel(kind, team, 'turret'), 75, tA, [0.46,0.26,0.55], [0,0,0], turret],
    ['gun', modLabel(kind, team, 'gun'), 65, { all: 12 }, [0.22,0.22,1.20], [0,-0.02,0.60], gunPivot],
    ['tailRotor', modLabel(kind, team, 'tailRotor'), 40, { all: 8 }, [0.52,1.25,0.30], [-0.26,3.02,-6.85], group]
  ] : kind === 'arty' ? (team === 'blue' ? [
    /* ===== 蓝方 BLUE_MLRS BLUE_MLRS模块表(命中检测=与实际建模轮廓一致的简化共形壳)=====
       turret=转盘(影响旋转的模块);ammo=发射舱(弹药架,火箭弹在舱内,击毁殉爆);
       gun=六联定向管(舱内芯,仅穿透链可达);弹药架使用独立的共形命中壳。 */
    ['trackL', modLabel(kind, team, 'trackL'), 70, { all: 10 }, [0.32,1.18,1.18], [-1.04,0.59,0], group], // 实际为三只共形圆轮命中壳(R0.59)
    ['trackR', modLabel(kind, team, 'trackR'), 70, { all: 10 }, [0.32,1.18,1.18], [ 1.04,0.59,0], group],
    ['engine', modLabel(kind, team, 'engine'), 90, { all: 10 }, [1.50,0.55,0.95], [0,1.25,1.95], group], // 驾驶室内(前置动力,穿透链可达)
    ['ammo', modLabel(kind, team, 'ammo'), 70, { all: 8 }, [1.08,0.87,4.24], [0,0.11,1.51], gunPivot], // 贴合发射箱简易几何(箱体1.00×0.80×4.10+加强箍/端板/管口 包络 x±0.53/y-0.31..0.54/z-0.60..3.62);保护箱/摇架/横梁不计入;随旋转/俯仰
    ['fuel', modLabel(kind, team, 'fuel'),   60, { all: 8 }, [0.54,0.54,1.10], [0.78,0.85,0.35], group], // 车架侧油箱(实际命中壳=左右两只纵置圆筒合并,双侧判定)
    ['hull', modLabel(kind, team, 'hull'),   0, C.hullArmor, [1.90,1.50,1.80], [0,1.60,2.00], group], // 驾驶室放样体为主壳,甲板/车架/保险杠逐件并入
    ['turret', modLabel(kind, team, 'turret'), 80, tA, [1.34,0.98,1.50], [0,0.31,0.05], turret], // 转盘(回转环+回转座+支臂+侧梁+铰耳)
    ['gun', modLabel(kind, team, 'gun'), 70, { all: 8 }, [0.90,0.70,4.00], [0,0.10,1.50], gunPivot] // 六联定向管(舱内芯)
  ] : [
    /* ===== 红方 RED_MLRS 模块表(命中检测=与实际建模轮廓一致的简化共形壳)=====
       turret=转盘(影响旋转的模块);ammo=发射架 40 管包(弹药架,火箭弹在管内,击毁殉爆);
       gun=定向管束(包内芯,仅穿透链可达);弹药架使用独立的共形命中壳。 */
    ['trackL', modLabel(kind, team, 'trackL'), 70, { all: 10 }, [0.30,1.07,1.07], [-1.10,0.535,0], group], // 实际为三只共形圆轮命中壳(R0.535)
    ['trackR', modLabel(kind, team, 'trackR'), 70, { all: 10 }, [0.30,1.07,1.07], [ 1.10,0.535,0], group],
    ['engine', modLabel(kind, team, 'engine'), 90, { all: 10 }, [1.50,0.50,0.90], [0,1.30,2.55], group], // 驾驶室内(平头前置动力,穿透链可达)
    ['ammo', modLabel(kind, team, 'ammo'), 70, { all: 8 }, [2.20,1.25,3.30], [0,0.45,0.75], gunPivot], // 发射架外壳(随旋转/俯仰)
    ['fuel', modLabel(kind, team, 'fuel'),   60, { all: 8 }, [0.40,0.40,1.00], [0.75,0.80,0.90], group], // 车架侧油箱(实际命中壳=左右两只合并,双侧判定)
    ['hull', modLabel(kind, team, 'hull'),   0, C.hullArmor, [1.90,1.40,1.80], [0,1.55,1.80], group], // 驾驶室棱柱为主壳,仪器舱/甲板/车架纵梁逐件并入
    ['turret', modLabel(kind, team, 'turret'), 80, tA, [1.36,1.06,1.76], [0,0.31,-0.10], turret], // 转盘(回转环+回转座+支臂+平衡机座)
    ['gun', modLabel(kind, team, 'gun'), 70, { all: 8 }, [1.90,0.90,2.90], [0,0.55,0.75], gunPivot] // 40 定向管(管束内芯)
  ]) : kind === 'td' && team === 'red' ? [       // 89 式红方歼击车(比例重做随美术):命中盒尺寸/位随新几何,装甲面/HP/弱点 45 数值照旧
    ['trackL', modLabel(kind, team, 'trackL'), 90, { all: 25 }, [0.55, 0.95, 5.10], [-1.24, 0.52, 0], group],   // 中空环带真包络,内缘离车侧0.015
    ['trackR', modLabel(kind, team, 'trackR'), 90, { all: 25 }, [0.55, 0.95, 5.10], [ 1.24, 0.52, 0], group],
    ['engine', modLabel(kind, team, 'engine'), 120, { all: 20 }, [1.30, 0.42, 0.76], [0, 0.67, 1.47], group], // 上首发动机隔栅正下方;八角全收进前车体
    ['fuel', modLabel(kind, team, 'fuel'),   70, { all: 12 }, [1.10, 0.40, 0.72], [0, 0.67, 0.05], group],  // 车体纵横中心,位于发动机与后置弹药之间
    ['ammo', modLabel(kind, team, 'ammo'), 80, { all: 12 }, [0.90, 0.54, 0.68], [0, 0.35, -0.65], turret],// 炮塔尾舱内,随自由旋转炮塔同步回转
    ['hull', modLabel(kind, team, 'hull'),   0,  C.hullArmor, [1.9, 0.80, 5.1], [0, 0.68, 0], group],        // 内芯盒随加厚车体(±2.55×0.28~1.08);真面命中壳=TD89_HULL_PTS 棱柱同步重构
    ['turret', modLabel(kind, team, 'turret'), 110, tA, [1.9, 1.02, 2.9], [0, 0.47, -0.20], turret],         // 后置低扁旋转炮塔:世界初始位 z[-2.895,-0.095]×y[1.09,2.11]
  ['gun', modLabel(kind, team, 'gun'),   100, { all: 35 }, [0.36, 0.36, 5.8], [0, 0, 2.9], gunPivot]
  ] : m1Platform ? [                          // 蓝方 BLUE_MBT_2:模块位置与新车体/旋转炮塔共形
    ['trackL', modLabel(kind, team, 'trackL'), 100, { all: 30 }, [0.42, 1.00, 5.72], [-1.11, 0.50, 0], group], // 车宽按三视图收窄后包络
    ['trackR', modLabel(kind, team, 'trackR'), 100, { all: 30 }, [0.42, 1.00, 5.72], [ 1.11, 0.50, 0], group],
    ['engine', modLabel(kind, team, 'engine'), 140, { all: 28 }, [1.65,0.60,1.00], [0,0.78,-2.00], group], // 完整位于高置发动机舱盖下方主壳内
    ['ammo', modLabel(kind, team, 'ammo'), 100, { all: 18 }, [1.90, 0.36, 1.42], [0, 0.47, -1.34], turret],
    ['fuel', modLabel(kind, team, 'fuel'),   90, { all: 20 }, [1.55, 0.55, 0.78], [0, 0.72, 0.72], group],
    ['hull', modLabel(kind, team, 'hull'),   0, C.hullArmor, [2.10, 0.80, 5.55], [0, 0.72, 0], group],
    ['turret', modLabel(kind, team, 'turret'), 130, tA, [2.20, 0.72, 2.92], [0, 0.37, -0.10], turret],
    ['gun', modLabel(kind, team, 'gun'), 110, { all: 42 }, [0.36, 0.36, 4.90], [0, 0, 2.45], gunPivot]
  ] : kind === '99' ? [                       // 红方RED_MBT_2:加长车体/圆盘弹药架(炮塔下方,特化壳见 defs 循环)
    ['trackL', modLabel(kind, team, 'trackL'), 90, { all: 25 }, [0.55, 1.00, 6.00], [-1.24, 0.50, -0.25], group], // 履带环带真包络(TRACK_POLY_99)
    ['trackR', modLabel(kind, team, 'trackR'), 90, { all: 25 }, [0.55, 1.00, 6.00], [ 1.24, 0.50, -0.25], group],
    ['engine', modLabel(kind, team, 'engine'), 130, { all: 20 }, [1.50, 0.58, 1.30], [0, 0.73, -2.35], group],   // 尾段机舱(侧面 sideR=150 分区板同段)
    ['ammo', modLabel(kind, team, 'ammo'), 90, { all: 15 }, [2.00, 0.20, 2.00], [0, 0.65, -0.35], group],        // 厚圆盘弹药架 r0.98×0.20(高度减半,缩减上半,底面 0.55 不动),炮塔正下方(随塔心 z-0.35)
    ['fuel', modLabel(kind, team, 'fuel'),   70, { all: 12 }, [0.76, 0.60, 0.70], [-0.45, 0.70, 1.00], group],
    ['hull', modLabel(kind, team, 'hull'),   0,  C.hullArmor, [1.2, 0.50, 1.2], [0, 0.72, 0], group],            // 内芯锚点盒(棱柱壳=T99_HULL_PTS 真面,见下方专项块)
    ['turret', modLabel(kind, team, 'turret'), 120, tA, [1.2, 0.30, 1.4], [0, 0.30, -0.20], turret],             // 内芯锚点盒(真面壳=t99TurretGeo 双尖纺锤壳)
    ['gun', modLabel(kind, team, 'gun'),   100, { all: 35 }, [0.34, 0.34, 3.80], [0, 0, 1.90], gunPivot]
  ] : team === 'red' ? [                     // 59 式(命中判定与美术建模严格对齐;数值=棱柱/走行解析,HP/装甲/muzzle 照旧)
    ['trackL', modLabel(kind, team, 'trackL'), 90, { all: 25 }, [0.55, 1.12, 5.46], [-1.24, 0.42, 0], group], // 履带实体 x[0.965,1.515]/局y[-0.14,0.98]/鼓尖 ≈±2.71 全覆盖(随底行下沉加高,整车抬T59_LIFT后贴地)
    ['trackR', modLabel(kind, team, 'trackR'), 90, { all: 25 }, [0.55, 1.12, 5.46], [ 1.24, 0.42, 0], group],
    ['engine', modLabel(kind, team, 'engine'), 120, { all: 20 }, [1.45,0.58,1.15], [0,0.73,-1.70], group], // 后机舱内收,底面不再贴/穿车底
    ['ammo', modLabel(kind, team, 'ammo'), 80, { all: 12 }, [0.8,0.75,0.8], [0.45,0.72,0.45], group],
    ['fuel', modLabel(kind, team, 'fuel'),   70, { all: 12 }, [0.76,0.62,0.72], [-0.45,0.70,1.20], group],
    ['hull', modLabel(kind, team, 'hull'),   0,  C.hullArmor, [1.2, 0.50, 1.2], [0, 0.72, 0], group],        // RED_MBT_1车体真面命中壳由下方 T59_HULL_PTS 棱柱注册
    ['turret', modLabel(kind, team, 'turret'),   110, tA, [1.2, 0.30, 1.2], [0, 0.10, 0], turret],               // RED_MBT_1炮塔真面命中壳由下方 domeHM 专属注册
    ['gun', modLabel(kind, team, 'gun'),   100, { all: 35 }, [0.34, 0.34, 3.3], [0, 0, 1.65], gunPivot]
  ] : [                                     // vehicle.js BLUE_MBT_1:命中盒与新版环带/棱柱壳一致
    ['trackL', modLabel(kind, team, 'trackL'), 90, { all: 25 }, [0.55, 1.30, 4.60], [-1.24, 0.65, -0.05], group],
    ['trackR', modLabel(kind, team, 'trackR'), 90, { all: 25 }, [0.55, 1.30, 4.60], [ 1.24, 0.65, -0.05], group],
    ['engine', modLabel(kind, team, 'engine'), 120, { all: 20 }, [1.45,0.62,1.93], [0,0.85,-1.80], group], // 后机舱随车尾拉长(z[-0.84,-2.77]),完整收在平顶甲板以下
    ['ammo', modLabel(kind, team, 'ammo'), 80, { all: 12 }, [0.78,0.68,0.78], [0.45,0.90,0.45], group],
    ['fuel', modLabel(kind, team, 'fuel'),   70, { all: 12 }, [0.78,0.68,0.78], [-0.45,0.90,1.25], group],
    ['hull', modLabel(kind, team, 'hull'),   0, C.hullArmor, [1.0, 0.50, 1.0], [0, 0.80, 0], group],
    ['turret', modLabel(kind, team, 'turret'), 110, tA, [1.0, 0.30, 1.0], [0, 0.42, 0], turret],
    ['gun', modLabel(kind, team, 'gun'), 100, { all: 35 }, [0.34, 0.34, 3.3], [0, 0, 1.65], gunPivot]
  ];
  var mods = {}, modMeshes = [];
  defs.forEach(function (d) {
    var mesh;
    if (d[0] === 'trackL' && (kind === 'ah64' || kind === 'wz10')) {
      var rDiskGeo = kind === 'wz10' ? new THREE.CylinderGeometry(6.35, 6.35, 0.16, 16) : new THREE.CylinderGeometry(7.30, 7.30, 0.16, 16);
      var rBladesGeo = kind === 'wz10' ? wzRotorBladesHitGeo() : ahRotorBladesHitGeo();
      mesh = new THREE.Mesh(rDiskGeo, hiddenMat);
      mesh._rotorDiskGeo = rDiskGeo;
      mesh._rotorBladesGeo = rBladesGeo;
      mesh.userData._rotorDiskGeo = rDiskGeo;
      mesh.userData._rotorBladesGeo = rBladesGeo;
      mesh._spinning = true; // 初始为旋转态圆片命中体
      mesh.visible = false;
      d[6].add(mesh);
    } else if (d[0] === 'tailRotor' && (kind === 'ah64' || kind === 'wz10')) {
      // 垂尾螺旋桨:参考主桨的圆片判定设计,采用与尾桨旋转平面精确共形的简化圆盘命中体
      var trRadius = kind === 'wz10' ? 0.75 : 0.80;
      var trDiskGeo = new THREE.CylinderGeometry(trRadius, trRadius, 0.12, 16);
      trDiskGeo.rotateZ(Math.PI / 2); // 沿横向X轴定向,与旋转面(Y-Z平面)完全吻合
      mesh = new THREE.Mesh(trDiskGeo, hiddenMat);
      mesh.visible = false;
      mesh.position.set(d[5][0], d[5][1], d[5][2]);
      d[6].add(mesh);
    } else if (d[0] === 'trackR' && (kind === 'ah64' || kind === 'wz10')) {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), hiddenMat);
      mesh.visible = false;
      mesh.position.set(0, -100, 0);
      d[6].add(mesh);
    } else if ((d[0] === 'trackL' || d[0] === 'trackR') && kind === 'arty') {
      var awSide=d[0]==='trackL'?-1:1;
      var awAx=(team==='blue')?BLUE_MLRS_AXZ:PHL11_AXZ;                             // 分阵营轴位(与建模同源)
      var awR=(team==='blue')?0.59:0.535, awW=(team==='blue')?0.32:0.30, awX=(team==='blue')?1.04:1.10;
      var awOne=function(){var g=new THREE.CylinderGeometry(awR,awR,awW,12);g.rotateZ(Math.PI/2);return g;};
      var awGeo=mergeHitGeos([{g:awOne(),z:awAx[0]},{g:awOne(),z:awAx[1]},{g:awOne(),z:awAx[2]}]);   // 每侧轮组=一整个命中体(三轮合并)
      mesh=new THREE.Mesh(awGeo,hiddenMat);mesh.visible=false;mesh.position.set(awSide*awX,awR,0);d[6].add(mesh);
    } else if ((d[0] === 'trackL' || d[0] === 'trackR') && kind !== 'arty' && !(kind === 'aa' && team === 'blue')) {   // 任务26/27:BLUE_AA(轮式)走专用轮壳,其余履带车(含 RED_AA)一律环带壳
      var trSide=d[0]==='trackL'?-1:1,trGeo,trX;
      if (m1Platform) { trGeo = trackRingGeo(0.25,0.10,M1_TRACK_POLY,M1_TRACK_FILLET,undefined,trackLoopM1()); trGeo.scale(M1_HULL_X_SCALE,1,1); trX = trSide * 1.32 * M1_HULL_X_SCALE; }
      else if (kind === 'td' && team === 'red') { trGeo = trackRingGeo(0.275,0.10,TD89_TRACK_POLY,TD89_TRACK_FILLET,undefined,trackLoop89()); trX = trSide * 1.24; }
      else if (kind === '99') { trGeo = trackRingGeo(0.275,0.10,TRACK_POLY_99,TRACK_FILLET_99,undefined,trackLoop99()); trX = trSide * 1.24; }   // RED_MBT_2加长环带真包络(物理环路与视觉同源)
      else if (kind === 'aa') { trGeo = trackRingGeo(0.22,0.10,TRACK_POLY,TRACK_FILLET,undefined,trackLoopPGZ()); trX = trSide * 1.42; }   // 任务27:RED_AA 环带壳=trackLoopPGZ 物理环路同源(板宽0.44→halfW0.22,带厚T0.10 全车型口径,trkX1.42 随任务20外移);静态默认环,不随悬挂动画
      else if (team === 'red') { trGeo = trackRingGeo(0.275,0.10,TRACK_POLY,TRACK_FILLET,undefined,trackLoop59()); trX = trSide * 1.24; }   // RED_MBT_1:物理环路与视觉分段板同源(旧四折线环仅作回退);带尖±2.64/下沉底行/下坠顶行与自然状态一致
      else{trGeo=trackRingGeo(0.275,0.10,TRACK_POLY_M60,TRACK_FILLET_M60,undefined,trackLoopM60());trX=trSide*1.19;}   // M60 命中壳随视觉内移(视觉=物理同源)
      mesh=new THREE.Mesh(trGeo,hiddenMat);mesh.visible=false;mesh.position.x=trX;d[6].add(mesh);
    } else if (d[0] === 'gun' && kind !== 'arty' && !(kind === 'aa' && team === 'blue')) {
      mesh = gunMeshRef;   // 命中壳=视觉身管合并网格(与gunPartsXX逐部件同形,消除炮管空气装甲环;后坐/俯仰/显隐自动同步)
      /* 任务26 例外:BLUE_AA gun 行=FLIR 光电头盒(defs 行尺寸),其发射箱视觉网格已由 ammo 专用壳覆盖,
         若在此吞掉 gunMeshRef 会让光电头判定退化成整个发射箱轮廓(与模块语义不符)。 */

    } else if (kind === 'wz10' && d[0] === 'hull') {
      mesh = new THREE.Mesh(wz10HullHitGeo(), hiddenMat);           // RED_HELI 机身/座舱/尾梁/短翼/垂尾真面多边形命中壳
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'wz10' && d[0] === 'engine') {
      mesh = new THREE.Mesh(wz10EngineHitGeo(), hiddenMat);         // RED_HELI 肩置双发短舱+中央传动舱多边形命中壳
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'wz10' && d[0] === 'turret') {
      mesh = new THREE.Mesh(wz10TurretHitGeo(), hiddenMat);         // RED_HELI 颚下炮塔整流罩+下颚护板
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'wz10' && d[0] === 'ammo') {
      mesh = new THREE.Mesh(wz10AmmoHitGeo(), hiddenMat);           // RED_HELI 机身供弹舱+翼下导弹/火箭巢专用弹药命中壳
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'ah64' && d[0] === 'hull') {
      mesh = new THREE.Mesh(ah64HullHitGeo(), hiddenMat);           // BLUE_HELId 机身/座舱/尾梁/短翼/垂尾/雷达真面多边形命中壳
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'ah64' && d[0] === 'engine') {
      mesh = new THREE.Mesh(ah64EngineHitGeo(), hiddenMat);         // BLUE_HELId 肩置双发短舱+中央传动舱多边形命中壳
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'ah64' && d[0] === 'turret') {
      mesh = new THREE.Mesh(ah64TurretHitGeo(), hiddenMat);         // BLUE_HELId 颚下炮塔整流罩+下颚护板
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'ah64' && d[0] === 'ammo') {
      mesh = new THREE.Mesh(ah64AmmoHitGeo(), hiddenMat);           // BLUE_HELId 机身供弹舱+翼下导弹/火箭巢专用弹药命中壳
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'arty' && d[0] === 'hull') {
      mesh = new THREE.Mesh(mergeHitGeos(team === 'blue' ? [       // BLUE_MLRS 车体=一整个命中体(驾驶室放样+甲板+车架纵梁+保险杠+防钻杠+转盘基座合并,与视觉轮廓共形)
        { g: loftYGeo(BLUE_MLRS_CAB_SECS) },
        { g: new THREE.BoxGeometry(2.20, 0.15, 3.79), y: 1.175, z: -1.045 },
        { g: new THREE.BoxGeometry(0.13, 0.22, 6.20), x: -0.40, y: 0.95, z: -0.45 },
        { g: new THREE.BoxGeometry(0.13, 0.22, 6.20), x: 0.40, y: 0.95, z: -0.45 },
        { g: new THREE.BoxGeometry(1.90, 0.26, 0.16), y: 0.92, z: 2.83 },
        { g: new THREE.BoxGeometry(2.00, 0.10, 0.12), y: 0.55, z: -3.56 },
        { g: new THREE.CylinderGeometry(0.60, 0.60, 0.16, 16), y: 1.30, z: -3.10 }] : [   // RED_MLRS 车体=一整个命中体(驾驶室棱柱+仪器舱+甲板+车架纵梁+顶盖+保险杠+转盘基座合并)
        { g: prismGeo(1.16, PHL11_CAB_PTS) },
        { g: new THREE.BoxGeometry(1.90, 0.60, 0.75), y: 1.35, z: 1.225 },
        { g: new THREE.BoxGeometry(1.90, 0.08, 2.15), y: 1.06, z: -0.225 },
        { g: new THREE.BoxGeometry(0.14, 0.24, 5.35), x: -0.42, y: 0.90, z: 0.625 },
        { g: new THREE.BoxGeometry(0.14, 0.24, 5.35), x: 0.42, y: 0.90, z: 0.625 },
        { g: new THREE.BoxGeometry(1.70, 0.08, 1.10), y: 2.66, z: 2.75 },
        { g: new THREE.BoxGeometry(2.30, 0.28, 0.18), y: 0.93, z: 3.64 },
        { g: new THREE.CylinderGeometry(0.85, 0.85, 0.16, 16), y: 1.10, z: -0.05 }]), hiddenMat);
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'arty' && d[0] === 'turret') {
      mesh = new THREE.Mesh(mergeHitGeos(team === 'blue' ? [       // BLUE_MLRS 转盘=一整个命中体(回转环+回转座+支臂+侧梁+铰耳合并)
        { g: new THREE.BoxGeometry(1.20, 0.34, 1.10), y: 0.22 },
        { g: new THREE.BoxGeometry(0.10, 0.72, 0.90), x: -0.60, y: 0.42, z: -0.10 },
        { g: new THREE.BoxGeometry(0.10, 0.72, 0.90), x: 0.60, y: 0.42, z: -0.10 },
        { g: new THREE.CylinderGeometry(0.58, 0.58, 0.20, 16), y: -0.02 },
        { g: new THREE.BoxGeometry(0.12, 0.16, 0.80), x: -0.55, y: -0.09, z: 0.15 },
        { g: new THREE.BoxGeometry(0.12, 0.16, 0.80), x: 0.55, y: -0.09, z: 0.15 }] : [   // RED_MLRS 转盘=一整个命中体(回转环+回转座+支臂+平衡机座合并)
        { g: new THREE.BoxGeometry(1.10, 0.36, 1.30), y: 0.24 },
        { g: new THREE.BoxGeometry(0.10, 0.75, 1.10), x: -0.62, y: 0.45, z: -0.35 },
        { g: new THREE.BoxGeometry(0.10, 0.75, 1.10), x: 0.62, y: 0.45, z: -0.35 },
        { g: new THREE.CylinderGeometry(0.78, 0.78, 0.20, 16), y: -0.02 },
        { g: new THREE.BoxGeometry(0.90, 0.30, 0.50), y: 0.30, z: 0.55 }]), hiddenMat);
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'arty' && d[0] === 'fuel') {
      mesh = new THREE.Mesh(mergeHitGeos(team === 'blue' ? (function () {   // BLUE_MLRS: 车架侧油箱左右两只(纵置圆筒 r0.27×1.10,双侧均有模块判定)
          var f1 = new THREE.CylinderGeometry(0.27, 0.27, 1.10, 10); f1.rotateX(Math.PI / 2);
          var f2 = new THREE.CylinderGeometry(0.27, 0.27, 1.10, 10); f2.rotateX(Math.PI / 2);
          return [{ g: f1, x: -0.78, y: 0.85, z: 0.35 }, { g: f2, x: 0.78, y: 0.85, z: 0.35 }];
        })() : [                                                            // RED_MLRS: 车架侧油箱左右两只(箱形 0.40×0.40×1.00)
        { g: new THREE.BoxGeometry(0.40, 0.40, 1.00), x: -0.75, y: 0.80, z: 0.90 },
        { g: new THREE.BoxGeometry(0.40, 0.40, 1.00), x: 0.75, y: 0.80, z: 0.90 }]), hiddenMat);
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'aa' && team === 'red' && d[0] === 'hull') {
      /* 任务26(用户指令):RED_AA 车体共形命中壳=与视觉 aa95BuildHull 同参数棱柱(截面[z,y]+0.3125 车体抬升)
         + 翼子板/储物箱/驾驶舱盖逐件合并。旧 2.40×1.05×6.50 大盒:首上斜面上方约 0.6m 空气装甲、
         两侧翼子板/储物箱不含、前后各短 0.1m、底边低 0.055。 */
      mesh = new THREE.Mesh(mergeHitGeos([
        { g: prismGeo(1.12, [[3.355,1.2675],[2.11,1.5925],[-2.55,1.5925],[-3.355,1.1925],[-3.355,0.7225],[-2.85,0.5925],[2.75,0.5925]]) },
        { g: new THREE.BoxGeometry(0.48,0.06,6.30), x:-1.36, y:1.2675, z:-0.05 },   // 翼子板×2(x1.12..1.60)
        { g: new THREE.BoxGeometry(0.48,0.06,6.30), x: 1.36, y:1.2675, z:-0.05 },
        { g: new THREE.BoxGeometry(0.42,0.30,1.05), x:-1.36, y:1.4425, z:2.15 },    // 翼子板储物箱前×2
        { g: new THREE.BoxGeometry(0.42,0.30,1.05), x: 1.36, y:1.4425, z:2.15 },
        { g: new THREE.BoxGeometry(0.42,0.24,0.90), x:-1.36, y:1.4125, z:-2.55 },   // 翼子板储物箱后×2
        { g: new THREE.BoxGeometry(0.42,0.24,0.90), x: 1.36, y:1.4125, z:-2.55 },
        { g: new THREE.BoxGeometry(0.52,0.06,0.56), x:0, y:1.6175, z:0.90 }]), hiddenMat);   // 驾驶舱盖(凸甲板 0.055)
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'aa' && team === 'red' && d[0] === 'turret') {
      /* 任务26:RED_AA 炮塔共形命中壳=与视觉 aa95BuildTurret 同截面棱柱(底延到 y0 封座圈缝)
         + 顶盖平台/车长舱盖/光电跟踪头 + 雷达桅杆与抛物面(常展开态,属炮塔模块;鞭天线细杆不设判定)。
         旧 1.62×0.85×2.35 大盒:前脸上部前方 0.43m 空气、雷达(y1.92~2.96)完全无判定。 */
      var _aa26Dish = new THREE.CylinderGeometry(0.52,0.52,0.18,18); _aa26Dish.rotateX(Math.PI/2);   // 碟面轴沿 Z(口朝车前)
      mesh = new THREE.Mesh(mergeHitGeos([
        { g: prismGeo(0.80, [[0.95,0],[0.78,0.55],[0.55,0.80],[-1.15,0.80],[-1.38,0.42],[-1.38,0]]) },
        { g: new THREE.BoxGeometry(1.30,0.06,1.50), x:0, y:0.83, z:-0.35 },            // 顶盖平台
        { g: new THREE.CylinderGeometry(0.26,0.26,0.03,12), x:0.34, y:0.88, z:-0.55 }, // 车长舱盖
        { g: new THREE.BoxGeometry(0.62,0.34,0.26), x:0, y:0.50, z:0.86 },             // 光电跟踪头(塔前)
        { g: new THREE.BoxGeometry(0.20,1.56,0.16), x:0, y:1.64, z:-1.12 },            // 雷达桅杆
        { g: _aa26Dish, x:0, y:2.44, z:-1.02 }]), hiddenMat);                          // 抛物面天线(r0.52)
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'aa' && team === 'blue' && (d[0] === 'trackL' || d[0] === 'trackR')) {
      /* BLUE_AA走行=前后轮胎各自共形圆柱(R0.465×断面宽0.315,轮心 x±0.91/轴距 z+1.70/-1.60)。
         已按要求彻底删除上方横条(翼子板)，纯净圆柱车轮命中判定，不再包含上方横条。 */
      var _aa26sd = d[0] === 'trackL' ? -1 : 1, _aa26W = [], _aa26Zs = [1.70, -1.60];
      for (var _aa26i = 0; _aa26i < 2; _aa26i++) {
        var _aa26Tire = new THREE.CylinderGeometry(0.465,0.465,0.315,12); _aa26Tire.rotateZ(Math.PI/2);   // 轮轴沿 X
        _aa26W.push({ g:_aa26Tire, x:_aa26sd*0.91, y:0.465, z:_aa26Zs[_aa26i] });
      }
      mesh = new THREE.Mesh(mergeHitGeos(_aa26W), hiddenMat);
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'aa' && team === 'blue' && d[0] === 'hull') {
      /* BLUE_AA车体共形命中壳:下身中央车体(扣除轮拱)+侧门槛+上部甲板+驾驶室+鼻尖/保险杠/车顶/后甲板/尾坡/杂物箱 */
      mesh = new THREE.Mesh(mergeHitGeos([
        { g: prismGeo(0.68, [[2.215,0.63],[1.70,0.55],[-2.255,0.55],[-2.255,0.98],[2.215,0.98]]) },  // 下身中央底盘(轮舱内缩)
        { g: new THREE.BoxGeometry(2.14, 0.43, 1.42), x: 0, y: 0.765, z: 0.31 },                       // 轴间车门/门槛段
        { g: prismGeo(1.07, [[2.215,0.98],[2.215,1.11],[-2.255,1.12],[-2.255,0.98]]) },              // 上身腰线/甲板外檐
        { g: prismGeo(1.07, [[1.02,1.12],[0.62,1.78],[-0.40,1.78],[-0.40,1.12]]) },                 // 驾驶室(风挡斜面实体)
        { g: new THREE.BoxGeometry(1.86,0.27,0.26), x:0, y:0.945, z:2.345 },    // 引擎鼻尖(格栅/大灯区)
        { g: new THREE.BoxGeometry(1.90,0.14,0.10), x:0, y:0.57, z:2.425 },     // 前保险杠
        { g: new THREE.BoxGeometry(1.92,0.06,1.08), x:0, y:1.81, z:0.13 },      // 车顶板(1.78..1.84)
        { g: new THREE.BoxGeometry(2.114,0.08,1.855), x:0, y:1.16, z:-1.3275 }, // 后甲板抬升(顶=座圈面1.20)
        { g: new THREE.BoxGeometry(1.96,0.39,0.22), x:0, y:0.985, z:-2.365 }]), hiddenMat); // 车尾上翘段
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'aa' && team === 'blue' && d[0] === 'turret') {
      /* 任务26:BLUE_AA PMS 炮塔共形命中壳(avBuildTurret 口径):舱室=前窄(0.946)后宽(1.10)楔形,
         4 段 Z 向阶梯盒逼近(每段台阶≤2cm)+ 座圈圆柱(r0.52,甲板1.20→舱底1.40)+ 舱顶 + 两侧发射梁。
         IFF 天线为薄板不设判定;FLIR 光电头=gun 模块独立判定(defs 行已共形,不动)。 */
      mesh = new THREE.Mesh(mergeHitGeos([
        { g: new THREE.BoxGeometry(1.081,0.90,0.3625), x:0, y:0.65, z:-0.54375 },
        { g: new THREE.BoxGeometry(1.042,0.90,0.3625), x:0, y:0.65, z:-0.18125 },
        { g: new THREE.BoxGeometry(1.004,0.90,0.3625), x:0, y:0.65, z: 0.18125 },
        { g: new THREE.BoxGeometry(0.965,0.90,0.3625), x:0, y:0.65, z: 0.54375 },
        { g: new THREE.CylinderGeometry(0.52,0.52,0.20,14), x:0, y:0.10, z:0 },        // 座圈
        { g: new THREE.BoxGeometry(0.968,0.06,1.247), x:0, y:1.13, z:-0.04 },          // 舱顶
        { g: new THREE.BoxGeometry(0.17,0.13,0.28), x:-0.635, y:0.66, z:-0.18 },       // 发射梁×2
        { g: new THREE.BoxGeometry(0.17,0.13,0.28), x: 0.635, y:0.66, z:-0.18 }]), hiddenMat);
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'aa' && d[0] === 'ammo') {
      /* Air-defense ammunition uses conformal per-launcher hit shells; the space between launchers is empty. */
      mesh = new THREE.Mesh(mergeHitGeos(team === 'red' ? [
        { g: new THREE.BoxGeometry(0.34, 0.52, 1.94), x: -1.02, y: 0.55, z: 0.655 },
        { g: new THREE.BoxGeometry(0.34, 0.52, 1.94), x:  1.02, y: 0.55, z: 0.655 }] : [
        { g: new THREE.BoxGeometry(0.40, 0.40, 1.92), x: -0.72, y: 0, z: 0.17 },
        { g: new THREE.BoxGeometry(0.40, 0.40, 1.92), x:  0.72, y: 0, z: 0.17 }]), hiddenMat);
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === '99' && d[0] === 'ammo') {
      var adGeo = new THREE.CylinderGeometry(0.98, 0.98, 0.20, 16);   // 厚圆盘弹药架(用户口径:直径 1.96 略低于炮塔宽 2.04;高 0.20=缩减上半至一半;盘轴竖直)
      mesh = new THREE.Mesh(adGeo, hiddenMat); mesh.visible = false;
      mesh.position.set(d[5][0], d[5][1], d[5][2]); d[6].add(mesh);
    } else if (kind === '99' && d[0] === 'hull') {
      mesh = new THREE.Mesh(prismGeo(0.95, T99_HULL_PTS), hiddenMat); // RED_MBT_2车体真面壳(视觉/命中同折点)
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === '99' && d[0] === 'turret') {
      mesh = new THREE.Mesh(t99TurretGeo(), hiddenMat);               // RED_MBT_2炮塔真面壳(唯一命中体;侧甲分区由 armorOf 命中点承载)
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'td' && team === 'red' && d[0] === 'hull') {
      mesh = new THREE.Mesh(prismGeo(0.95, TD89_HULL_PTS), hiddenMat); // RED_TD80°内收尾板与视觉车体共用真面壳
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'td' && team === 'red' && d[0] === 'turret') {
      // 89 式视觉主壳与命中壳严格共形:斜切掉的两个方盒前角不再残留“空气装甲”。
      mesh = new THREE.Mesh(td89CasemateGeo(), hiddenMat);
      mesh.visible = false;
      d[6].add(mesh);
    } else if (m1Platform && d[0] === 'hull') {
      mesh = new THREE.Mesh(mergeHitGeos([                            // BLUE_MBT_2 车体=一整个命中体(低楔主壳+高置发动机舱盖壳合并)
        { g: prismGeo(M1_HULL_HALF_W * M1_HULL_X_SCALE, M1_HULL_PTS) },
        { g: prismGeo(M1_ENGINE_DECK_HALF_W * M1_HULL_X_SCALE, M1_ENGINE_DECK_PTS) }]), hiddenMat);
      mesh.visible = false; d[6].add(mesh);
    } else if (m1Platform && d[0] === 'turret') {
      mesh = new THREE.Mesh(m1TurretGeo(), hiddenMat);                       // BLUE_MBT_2 十边平台式薄尾舱复合楔塔真面命中壳
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'tank' && team !== 'red' && d[0] === 'turret') {
      // M60 炮塔=一整个命中体(双轮廓环主壳+M19 指挥塔壳合并,位置烘焙)
      var cupY60 = m60TurretTopY(M60_DETAIL.commander.x, M60_DETAIL.commander.z);
      mesh = new THREE.Mesh(mergeHitGeos([{ g: m60TurretGeo() },
        { g: m60CupolaGeo(), x: M60_DETAIL.commander.x, y: cupY60, z: M60_DETAIL.commander.z }]), hiddenMat);
      mesh.visible = false; d[6].add(mesh);
    } else if (kind === 'tank' && team === 'red' && (d[0] === 'turret' || d[0] === 'hull')) {
      // RED_MBT_1:车体与炮塔命中体在下方专属注册真实六折截面和切除重叠的穹顶壳，避免在此处产生重复内芯碰撞体
      mesh = new THREE.Mesh(new THREE.BufferGeometry(), hiddenMat);
      mesh.visible = false;
    } else {
      mesh = hitBox(d[6], d[4][0], d[4][1], d[4][2], d[5][0], d[5][1], d[5][2]);
    }
    var mod = { key: d[0], label: d[1], max: d[2], hp: d[2], armor: d[3], mesh: mesh,
                structural: d[2] === 0 };
    if (!mesh.userData) mesh.userData = {};
    mesh.userData.tank = null;
    mesh.userData.key = d[0];
    mesh.userData.mod = mod;
    if (kind === 'arty' && d[0] === 'hull') mesh.userData.face = 'hullshell';
    if (kind === 'td' && team === 'red' && d[0] === 'hull') mesh.userData.face = 'hullshell';
    if (m1Platform && d[0] === 'hull') mesh.userData.face = 'm1hull';
    if (m1Platform && d[0] === 'turret') mesh.userData.face = 'm1turret';
    if (kind === '99' && d[0] === 'hull') mesh.userData.face = 't99hull';       // 首上/首下双前甲分槽(armorOf 't99hull')
    if (kind === '99' && d[0] === 'turret') mesh.userData.face = 't99turret';   // armorOf 't99turret':前楔物理厚度+统一世界入射角+侧甲命中点 z 分区
    // M60 炮塔命中壳不再挂专属 face,走通用法线分区(物理厚度+入射角算法)
    mods[d[0]] = mod;
    targetsList.push(mesh);
    modMeshes.push(mesh);
  });
  function addExactHit(parent,geo,key,face,x,y,z,rx,ry,rz){
    var hm=new THREE.Mesh(geo,hiddenMat);hm.visible=false;hm.position.set(x||0,y||0,z||0);hm.rotation.set(rx||0,ry||0,rz||0);parent.add(hm);
    hm.userData = { tank:null,key:key,mod:mods[key] }; if (face) hm.userData.face = face; targetsList.push(hm); modMeshes.push(hm); return hm;
  }
  if (kind === '99') {
    /* 命中判定统一标准:车体/炮塔各一个真面壳,侧甲位置分区(车体 300/150 界 z-0.85·炮塔 200/100 界 z-0.45)
       由 armorOf 命中点参数承载,无任何附加面片/分段壳 */
    addExactHit(gunPivot, new THREE.BoxGeometry(0.28, 0.34, 0.30), 'turret', 'mantlet', 0, 0, 0.42);   // 炮盾=唯一独立外部件(与视觉块同位同尺寸)
  }
  if (kind === 'aa' && team === 'red' && mods.ammo) {
    /* 任务25(用户设定):RED_AA 炮塔正下方圆盘形弹药架(类似 99 式布局)——r0.72×厚0.20,
       盘顶齐甲板/塔座圈底面(y=1.5925),盘心随塔环 z=-0.55;位于车体主壳内=穿透链可达(与 99 式圆盘同语义)。 */
    addExactHit(group, new THREE.CylinderGeometry(0.72, 0.72, 0.20, 16), 'ammo', null, 0, 1.4925, -0.55);
  }
  // 火箭炮各部位命中体=defs 分支 mergeHitGeos 合并件(统一标准:一部位一命中体)。
  /* ===== 弱点面板(接近真实的装甲分布):主盒/主数值分毫不动,只叠加独立小区域薄板命中盒。
     判定链:正面飞来先撞面板盒(比主盒面外凸 0.01~0.02)→ armorOf 按显式面 'weak'=45mm 结算 →
     _skip 链保证主盒同模块不再叠加(首甲链不叠甲,与既有穿透链同一语义)。
     真实依据:T-34 系驾驶观察缝/舱盖区 ≈45mm、座圈竖直段/接缝带 30~60mm 取 45mm;
     顶部 24/38、车后 32/42、歼击车战斗室侧后 8/6,本就是现成的薄弱区,不再另设;
     火箭炮全身 10~24mm 纸箱,弱点无意义,不设。 ===== */
  var EXTRA_HITS = [];
  if (kind === 'tank' && team === 'red') {
    /* RED_MBT_1只保留与建模严格对应的炮塔主体和车体棱柱命中体，不设多余独立薄片 */
  } else if (kind === 'td' && team === 'red') {
    // 以下为 89 式专属弱点。
    EXTRA_HITS.push(['hull', group, 0.5, 0.02, 0.62, 0.42, 1.095, 0.62, 0, 0, 0, 'weak']);   // 89 式驾驶员区(低甲板 y1.08 右半,舱盖/潜望镜位,凸甲板 0.015)
    EXTRA_HITS.push(['turret', turret, TD89_CASE_CENTER * 2, 0.12, 0.02, 0, 0.03, td89FrontZ(0, 0.03) + 0.012, -0.488, 0, 0, 'weak']); // 接缝弱带只留在主炮宽度中央平直面
    // RED_TD炮盾=与视觉同源的 td89MantletGeo 闭合壳(EXTRA 循环后注册)。
  } else if (m1Platform) {
    /* 任务26(用户指令):删除 BLUE_MBT_2 车体顶面驾驶员舱盖的独立命中判定——舱盖顶板仅凸出前顶甲板(y1.10)
       5mm,属于车体主壳的一部分(m1hull 棱柱已覆盖该区域),不再单独叠加 'weak' 薄弱板。 */
  }
  // RED_MBT_1炮盾=贴体命中板;M60炮盾=与蒙布同形的闭合真面壳。
  // 下方直接注册mantletCastGeo的可见铸造翼与封板。
  for (var ehi = 0; ehi < EXTRA_HITS.length; ehi++) {
    var eH = EXTRA_HITS[ehi], eMod = mods[eH[0]];
    if (!eMod) continue;
    var eMesh = hitBox(eH[1], eH[2], eH[3], eH[4], eH[5], eH[6], eH[7], eH[8], eH[9], eH[10]);
    eMesh.userData = { tank: null, key: eH[0], mod: eMod, face: eH[11] };
    targetsList.push(eMesh);
    modMeshes.push(eMesh);
  }
  if (kind === 'tank' && team === 'red' && mods.turret) {
    var mh59 = mantletCastGeo();                          // 炮盾=一整个命中体(铸造翼皮+封板合并壳)
    var mm59 = new THREE.Mesh(mergeHitGeos([{ g: mh59.skin }, { g: mh59.plate }]), hiddenMat);
    mm59.visible = false; turret.add(mm59);
    mm59.userData = { tank: null, key: 'turret', mod: mods.turret, face: 'mantlet' };
    targetsList.push(mm59); modMeshes.push(mm59);
  }
  if (kind==='td'&&team==='red'&&mods.turret) {
    var td89MantHM=new THREE.Mesh(td89MantletGeo(),hiddenMat);
    td89MantHM.visible=false;gunPivot.add(td89MantHM);
    td89MantHM.userData={tank:null,key:'turret',mod:mods.turret,face:'mantlet'};
    targetsList.push(td89MantHM);modMeshes.push(td89MantHM);
  }
  if (m1Platform && mods.turret && mods.hull) {
    var m1MantletHM = new THREE.Mesh(m1MantletGeo(), hiddenMat);
    m1MantletHM.visible = false; gunPivot.add(m1MantletHM);
    m1MantletHM.userData = { tank: null, key: 'turret', mod: mods.turret, face: 'mantlet' };
    targetsList.push(m1MantletHM); modMeshes.push(m1MantletHM);
  }
  if (kind === 'tank' && team !== 'red' && mods.turret) {
    var m60MantletHM = new THREE.Mesh(m60MantletGeo(), hiddenMat);   // 视觉/命中共享同一闭合蒙布壳,中央炮孔不留空气装甲
    m60MantletHM.visible = false;
    gunPivot.add(m60MantletHM);                                    // 随俯仰、不随后坐,与视觉mP一致
    m60MantletHM.userData = { tank: null, key: 'turret', mod: mods.turret, face: 'mantlet' };
    targetsList.push(m60MantletHM); modMeshes.push(m60MantletHM);

    // 炮塔命中体=主壳+M19 指挥塔合并件(defs);细杆/光学罩/储物篮不生成空气装甲。
  }
  /* ===== 59 式穹顶判定壳=与美术同参数真椭球(半球 0.98×0.6272),无座圈裙环壳;
     [2026-09]删除垫片命中体ringHM(正圆柱 r1.005/1.015×h0.10):视觉侧底沿直接落甲板,此处无裙环建模,留之即空气装甲(M60同口径:无垫圈);
      射线直接命中真实穹面 → 法线=穹面真法线 → 倾斜装甲对穹顶全周真实生效(等效装甲随入射角自然增长,
      近切线区自然跳弹);armorOf force='dome' 按命中方位分扇区给前/侧/后数值。 ===== */
  if (kind === 'tank' && team === 'red' && mods.turret) {
    var hullHG=prismGeo(0.95,T59_HULL_PTS);             // RED_MBT_1视觉/命中同一六折截面
    var hullHM = new THREE.Mesh(hullHG, hiddenMat);
    hullHM.visible = false;
    group.add(hullHM);
    hullHM.userData = { tank: null, key: 'hull', mod: mods.hull, face: 'hullshell' };
    targetsList.push(hullHM); modMeshes.push(hullHM);
    var domeHG = dome59HitGeo();   // RED_MBT_1炮塔真面命中壳:规整参数化网格,与炮盾 mantletCastGeo 边缘0误差无缝衔接
    var domeHM = new THREE.Mesh(domeHG, hiddenMat);
    domeHM.visible = false;
    turret.add(domeHM);
    domeHM.userData = { tank: null, key: 'turret', mod: mods.turret, face: 'dome' };
    targetsList.push(domeHM); modMeshes.push(domeHM);
  }

  /* ===== M60命中壳:车体继续与hullPartsM60九折棱柱共形;炮塔模块直接采用双轮廓环主壳。
     圆润 M19 指挥塔另用与视觉同源的 m60CupolaGeo 闭合壳,细杆/光学罩/矩形储物篮不制造空气装甲;
     无旧内置炮塔方盒、无重复第二层炮塔壳。 ===== */
  if (kind === 'tank' && team !== 'red' && mods.hull) {
    var hullHG_M60=prismGeo(0.90,M60_HULL_PTS);         // M60视觉/命中同一九折截面
    var hullHM_M60 = new THREE.Mesh(hullHG_M60, hiddenMat);
    hullHM_M60.visible = false;
    group.add(hullHM_M60);
    hullHM_M60.userData = { tank: null, key: 'hull', mod: mods.hull, face: 'hullshell' };
    targetsList.push(hullHM_M60); modMeshes.push(hullHM_M60);

    // 炮塔主命中壳=mods.turret.mesh(单层,无重复外壳)。
    // M60 无垫圈:不注册独立座圈/垫圈命中对象。
  }

  var tank = {
    id: o.id || ('veh_' + (++_tankUniqueSeq)),
    isPlayer: isP, team: team, kind: kind,
    _strategicSupport: !!o.strategicSupport,
    _strategicSupportSource: o.strategicSupportSource || '',
    model: kind === '99' ? 't99' : (kind === 'ah64' ? 'ah64' : (kind === 'wz10' ? 'wz10' : undefined)),                         // 新载具独立建档键(dynModelKey 首查 t.model)
    name: o.name || (isP ? 'YOU' : (kind === 'arty' ? (team === 'red' ? 'RED-MLRS' : 'BLUE-MLRS') : (kind === 'aa' ? (team === 'red' ? 'RED-AA' : 'BLUE-AA') : (kind === 'wz10' ? 'RED-HELI' : (kind === 'ah64' ? 'BLUE-HELI' : (kind === 'td' ? (team === 'red' ? 'RED-TD' : 'BLUE-MBT-2') : (kind === '99' ? 'RED-MBT-2' : (team === 'red' ? 'RED-MBT-1' : 'BLUE-MBT-1')))))))),
    platform: m1Platform ? 'm1a1' : (kind === 'td' ? 'td89' : kind),
    group: group, turret: turret, gunPivot: gunPivot, muzzle: muzzle,
    mainRotorGroup: mainRotorGroup, tailRotorGroup: tailRotorGroup,
    mainRotorMesh: mainRotorMeshRef, tailRotorMesh: tailRotorMeshRef,
    gunMesh: gunMeshRef, mantletMesh: manMeshRef, muzzZ0: muzzle.position.z, recT: -1, recoilZ: 0,
    recAx: 1, recLat: 0,                                              // 开火当帧锁定的后坐力分解(cosθ/sinθ)   // 后坐:身管网格/膛口基准/动画时钟;炮盾网格不随后坐
    mats: [vehBodyMat, vehGlowMat], modMeshes: modMeshes,
    yaw: o.yaw || 0, turretYaw: 0, gunPitch: (kind === 'arty' || kind === 'aa') ? 0.35 : 0, // 火箭炮/防空默认 20° 行军仰角;第三人称可继续抬至 1.05rad(AA 至 70°)
    speed: 0, _throttle: 0, _throttleLock: 0, _driveThrottle: 0, _steerRate: 0, _motionVx: 0, _motionVz: 0, _motionAx: 0, _motionAz: 0, _suspLoad: null, _slideV: 0, _slip: 0, _slipT: 0, _slipOkT: 0, _nav: null, _fAvail: 0,   // 坡度物理状态(油门由 AI/玩家写,speed 由 slopeArbitrate 裁决)
    radius: kind === 'aa' ? (team === 'blue' ? 1.7 : 2.0) : (kind === 'arty' ? (team === 'blue' ? 3.6 : 3.2) : (kind === 'ah64' ? 3.40 : (kind === 'wz10' ? 3.35 : (m1Platform ? 2.90 : (kind === 'td' ? 2.60 : (kind === '99' ? 2.55 : 2.45)))))), blockedT: 0,
    structMax: o.struct || C.struct, struct: o.struct || C.struct,
    mods: mods, fire: null,
    reload: 0, reloadTime: (kind === 'arty' && typeof rocketReloadTimeOf === 'function') ? rocketReloadTimeOf({ kind: 'arty', team: team }) : C.reload,             // 火箭炮=1s/发×伤害系数(dmg/60)×齐射发数(红40s/蓝12s);其余 CONF.reload
    pen: o.pen || C.pen, penKd: C.penKd || 0, dmg: C.dmg,   // penKd=穿深存速衰减系数(1/m,见 CONF 注记)
    shellSpeed0: C.shellSpeed || CONF.shellSpeedE,           // 分阵营炮口初速
    speed0: C.speed, turn0: C.turn, turretRate0: C.turretRate, mob: C.mob || null,   // mob=坡度物理机动档案(直升机分支无,读时兜底)
    errBase: rand(0.08, 0.14),                               // 车组散布系数全体发放(玩家与 AI 同分布)——统一散布公式按载具取用,玩家不再特殊化
    nightEff: nightAimEffOf(kind, team),                     // 夜战瞄准效率(设备表出生缓存:热像1.2/夜视0.8/裸眼0.5;ai 伺服夜间消费)
    _ffaSpawnInvulUntil: 0,                                 // 个人死斗玩家出生保护截止时间(仅玩家部署时写入)
    alive: true, unitState: UNIT_ALIVE, velX: 0, velZ: 0,
    accel0: C.accel || 2.5, decel0: C.decel || 5,
    lastHitBy: null, lastDamageT: -Infinity,
    salvoLeft: 0, salvoT: 0,                                 // 火箭炮齐射状态
    _salvoLockYaw: null, _salvoLockPitch: null, _salvoLockV: null, // 玩家齐射首发快照(AI 留空,对象形状稳定)
    _heliWeapon: 3, _heliRocketLeft: 14,                           // 直升机/防空多武器状态 (3:导弹, 2:火箭/防空反坦克导弹, 1:机炮)
    _aaWeapon: 1, _aaReloadKind: 1,                                // 玩家 AA:下一次装填选择 (1:SAM, 2:ATGM);当前发射架内/装填中的种类独立保存
    _mbtWeapon: 1, _mbtReloadKind: 1,                              // 玩家 MBT-1: _mbtWeapon=下一次装填选择, _mbtReloadKind=当前膛内/装填中的武器 (1:主炮, 2:炮射导弹)
    _tdWeapon: 1, _tdReloadKind: 1,                                // 玩家 RED-TD: 1=AP, 2=HE; loaded kind is independent of next selection
    _heliMslRounds: null, _heliMslTube: null,          // 多联装挂架弹药状态(按挂架侧独立计算装填,见 updateHeliWeapons)
    _heliRocketReloadT: 0,
    _heliDecoyLeft: 20, _heliDecoyReloadT: 0, _heliDecoyCooldown: 0,
    _heliDecoyThreat: null, _heliDecoyThreatT: -Infinity,
    _heliMissileReloadTL: 0, _heliMissileReloadTR: 0,              // 左右翼导弹独立 40s 装填计时
    _heliRocketCooldown: 0, _heliMissileCooldown: 0,
    _heliMissileNextSide: 0, _heliMissileTarget: null,
    _powerups: null, _powerupAura: null, _powerupAuraSig: '', _powerupAuraDirty: false,
    _techPreview: o.name === 'PREVIEW',
    ai: isP ? null : {
      thinkT: rand(0, 0.5), destT: 0, destX: 0, destZ: 0,
      acc: o.kind === 'arty' ? 0.012 : 0.05, lead: rand(0.94, 1.06),   // 神枪手:飞行时间提前量近乎全量(前 rand(0.5,1) 系统性欠提前)
      errBase: rand(0.08, 0.14),                                     // 兼容旧引用:散布已全体改吃 tank.errBase(玩家/AI 统一)
      targetO: null, targetT: 0,
      known: [], tgtT: -99,                              // 视野记忆:[{o,t}] 注意到的敌人/上次换目标时刻
      alertFoe: null, alertFoeT: -99,                    // 受击警觉:打过我的人(击穿/跳弹/溅射都算)
      bumpFoe: null, bumpT: -99,                         // 碰撞警觉:撞过我的人
      anchorX: o.x || 0, homeZ: o.z || 0, clusterT: 0,       // 火箭炮:驻锄锚点/己方纵深/集群搜索冷却
      cluster: null, reposT: 0,                              // 火箭炮:当前集群目标/转移冷却
      aware: 0.8, alert: true, awareTick: rand(0, 0.4),      // 注意力:警觉(能感知来袭火箭弹)↔专注(埋头眼前工作)
      evadeT: 0, evadeX: 0, evadeZ: 0,                       // 火箭弹逃生状态(逃生点+剩余时间)
      posture: 0, postT: rand(0.5, 2.5),                     // 局部优劣势(-1 劣势..+1 优势)→ 激进/保守/殊死一搏
      wpI: 0,   // 迂回航线段位(真实战术角色在指挥官分组 _cmdG.role,此处仅初始航段)
      idleW: 0, relax: 0, noOpponentT: 0,                  // 反偷懒看门狗 + 全向行军索敌兜底
      _powerupTarget: null, _powerupScanT: 0              // FFA 道具最近目标缓存(≤200m,低频扫描)
    }
  };
  /* 玩家专属科技在载具实体创建完成后一次性写入；AI 创建时由 applyToTank 还原并保持基础字段。 */
  if (typeof vehicleTechApplyToTank === 'function') vehicleTechApplyToTank(tank);
  effSync(tank);                                   // 效率族事件缓存初始化(满血=全 1;此后仅受击/火烧事件重算)
  /* 迂回角色唯一来源=指挥官 60s 决策分组 */
  group.position.set(o.x || 0, terrainH(o.x || 0, o.z || 0) + ((kind === 'tank' && team === 'red') ? T59_LIFT : (kind === '99' ? T99_LIFT : ((kind === 'td' && team === 'red') ? TD89_LIFT : ((kind === 'td' && team === 'blue') ? M1_LIFT : ((kind === 'tank' && team === 'blue') ? M60_LIFT : 0))))), o.z || 0);   // 59叠加T59_LIFT(轮系下沉后贴地);99/89/M1同理各叠自家抬升
  group.rotation.y = tank.yaw;
  turret.rotation.y = tank.turretYaw;
  gunPivot.rotation.x = -tank.gunPitch;                  // 首帧/载具预览立即显示火箭炮默认仰角,不等主循环补写
  tank._mmNew = true;            // 新生车矩阵标记:生成发生在 step 对齐段之后,实例流需首轮补一次 updateMatrixWorld
  for (var mmi = 0; mmi < modMeshes.length; mmi++) modMeshes[mmi].userData.tank = tank;   // 内核+附加斜板全部回填所属坦克
  tank._instSrcs = [_hullMeshRef, _hullGlowRef, turMeshRef, turGlowRef, gunMeshRef, manMeshRef, mainRotorMeshRef, tailRotorMeshRef];   // 实例桶满兜底显隐用个体网格引用表
  if (o.name !== 'PREVIEW') vehInkAttach(tank, _tpl, isP);              // P1: 预览留给车库 EdgesGeometry, 对局挂折边墨线
  if (isP && _hullMeshRef) tank._hullMat = _hullMeshRef.material;     // 玩家车 hull 材质引用(供 trackAnimUpdate 更新 uTrackOffL/uTrackOffR uniform)
  if (kind === '99') tank._lwsLens = _lz;   // 压制器镜片标记回填(var _lz 函数域提升,仅 '99' 分支已建)
  /* 多联装挂架——每筒位一个独立弹体网格(发射即隐藏该筒,装填完成整侧复现)。
     RED_HELI: 空空导弹 四联装(2×2, 筒距0.11), 外侧挂点 |x|=2.05, 弹体中心 y=1.52 z=-0.20;
     BLUE_HELI: 防空导弹 二联装(横排, 筒距0.10), 内侧挂点 |x|=1.52(与火箭巢交换,巢移外侧), y=1.44 z=0.22。
     筒序与 heliMissileTubeLocal 完全同序,筒心 x 按侧镜像。 */
  if (kind === 'wz10' || kind === 'ah64') {
    var mslGeo = kind === 'wz10' ? ty90MissileGeo : aim92MissileGeo;
    var mslTubes = HELI_MSL_SPEC[kind === 'wz10' ? 'ty90' : 'aim92'].tubes;
    var mslCz = kind === 'wz10' ? -0.20 : 0.22;
    for (var sd = 0; sd < 2; sd++) {
      var mslMeshes = [];
      for (var tj = 0; tj < mslTubes; tj++) {
        var mm = new THREE.Mesh(mslGeo, heliMissileMat);
        var mloc = heliMissileTubeLocal({ kind: kind, group: group }, sd, tj);
        mm.position.set(mloc[0], mloc[1], mslCz);
        mm.userData.visual = true;
        mm.castShadow = false; mm.receiveShadow = true;
        group.add(mm);
        mslMeshes.push(mm);
      }
      if (sd === 0) tank._heliMslMeshesL = mslMeshes; else tank._heliMslMeshesR = mslMeshes;
    }
  }
  /* ===== BLUE_MLRS 动态液压杆(俯仰缸×2,demo v0.4~v0.6 功能完整移植)=====
     缸体/活塞杆两件 Mesh 挂 group 下(userData.visual 随残骸换材质);
     每帧 instUpdateAll→updateBLUE_MLRSHydraulics 按 turretYaw/gunPitch 解算三维铰接对齐;
     预览车(车库)不进 aliveList,出生时解算一次保持静态行军姿态。 */
  if (kind === 'arty' && team === 'blue') {
    m142HydEnsure();
    var hydB = new THREE.Mesh(BLUE_MLRS_HYD_BARREL_GEO, m142HydMat);
    var hydR = new THREE.Mesh(BLUE_MLRS_HYD_ROD_GEO, m142HydMat);
    hydB.userData.visual = true; hydR.userData.visual = true;
    hydB.frustumCulled = false; hydR.frustumCulled = false;
    group.add(hydB); group.add(hydR);
    tank._hydStruts = { b: hydB, r: hydR };
    updateBLUE_MLRSHydraulics(tank);
    var _mzM = new THREE.Object3D(); gunPivot.add(_mzM);             // BLUE_MLRS 逐发发射位置标记(六前管口圆心,fireShell 按 shotIdx 取用)
    tank._rktMuzzle = { obj: _mzM, pos: BLUE_MLRS_RKT_ORDER };
  }
  /* ===== RED_MLRS 后液压驻锄动画 rig(停车自动放下 / 移动收起)=====
     锄腿+垫刚体挂铰点 Group,液压缸两段 Mesh 逐帧瞄准解算(updatePHL11Spades,instUpdateAll 驱动);
     预览车不进 aliveList,出生即解算一次=放下态(与 demo v0.10 驻锄姿态一致)。 */
  if (kind === 'arty' && team === 'red') {
    m142HydEnsure();                                       // 液压缸金属材质与 BLUE_MLRS 动态液压杆共用(外观已获认可)
    var _sp11LegMat = isP ? vehBodyMatPlayer : vehBodyMat; // 锄腿/垫走车体同材质:aCamo 已烧录 → 数码迷彩+风化(修复纯绿无迷彩)
    var _sp11Cols = { leg: cACC, pad: cSTEEL, bar: [0.33, 0.38, 0.23], rod2: [0.35, 0.36, 0.38] };
    var _sp11Sides = [];
    for (var _sp11s = -1; _sp11s <= 1; _sp11s += 2) {
      var _sp11LegG = new THREE.Group();
      _sp11LegG.position.set(PHL11_SPADE_PIVOT[0] * _sp11s, PHL11_SPADE_PIVOT[1], PHL11_SPADE_PIVOT[2]);
      var _sp11LegM = new THREE.Mesh(phl11SpadeLegGeo(_sp11s, _sp11Cols), _sp11LegMat);
      _sp11LegM.userData.visual = true; _sp11LegM.frustumCulled = false;
      _sp11LegG.add(_sp11LegM); group.add(_sp11LegG);
      var _sp11BarM = new THREE.Mesh(phl11SpadeCylGeo(false, _sp11Cols), m142HydMat);
      var _sp11RodM = new THREE.Mesh(phl11SpadeCylGeo(true, _sp11Cols), m142HydMat);
      _sp11BarM.userData.visual = true; _sp11RodM.userData.visual = true;
      _sp11BarM.frustumCulled = false; _sp11RodM.frustumCulled = false;
      group.add(_sp11BarM); group.add(_sp11RodM);
      _sp11Sides.push({ side: _sp11s, legG: _sp11LegG, barrel: _sp11BarM, rod: _sp11RodM });
    }
    tank._spadeRig = { k: 1, sides: _sp11Sides };   // 出生静止=放下(k=1,与 demo 姿态一致)
    updatePHL11Spades(tank);
    /* RED_MLRS 火箭弹消耗包:40 发"储运弹"InstancedMesh 挂 gunPivot(随旋转/俯仰);实例倒序挂载,
       count 截断=按发射顺序整管消失;弹头中心表兼作逐发发射位置(与消耗同序同索引:发射谁,谁就被消耗) */
    var _rkIm = new THREE.InstancedMesh(phl11RocketGeo({ acc: cACC, dark: cDARK }), isP ? vehBodyMatPlayer : vehBodyMat, PHL11_RKT_ORDER.length);
    var _rkM4 = new THREE.Matrix4();
    for (var _rkj = 0; _rkj < PHL11_RKT_ORDER.length; _rkj++) {
      var _rkP = PHL11_RKT_ORDER[PHL11_RKT_ORDER.length - 1 - _rkj];
      _rkIm.setMatrixAt(_rkj, _rkM4.makeTranslation(_rkP[0], _rkP[1], _rkP[2]));
    }
    _rkIm.instanceMatrix.needsUpdate = true;
    _rkIm.frustumCulled = false; _rkIm.userData.visual = true;
    _rkIm.userData.skipEdges = true;
    gunPivot.add(_rkIm);
    tank._rktPack = _rkIm; tank._rktLeft = PHL11_RKT_ORDER.length;
    updatePHL11Rockets(tank);
    var _rkMz = new THREE.Object3D(); gunPivot.add(_rkMz);           // 逐发发射位置标记(fireShell 移到当前发弹头建模中心)
    tank._rktMuzzle = { obj: _rkMz, pos: PHL11_RKT_ORDER.map(function (e) { return [e[0], e[1], e[3]]; }) };
  }

  /* ===== 防空载具 rig (TASK 18):每筒位一个独立弹体/管口帽网格(发射即隐藏该筒,装填完成整侧复现——
     与直升机多联装 _heliMslMeshesL/R 同机制,updateHeliWeapons 复现/triggerAAFire+fireAAMissile 消耗);
     _aaMslMuzzle=逐筒发射点标记(fireAAMissile 取用;发射点=导弹弹头建模中心,用户设定);
     RED_AA 车载搜索雷达常电(范围=直升机火控雷达;搜索方向=玩家光标/AI 炮塔指向);BLUE_AA无雷达。 ===== */
  if (kind === 'aa') {
    var _aaPer = team === 'red' ? 2 : 4;                                // 每侧筒数:RED_AA 左右炮组各2枚(共4)/BLUE_AA 左右发射箱各4管(共8)
    var _aaOrder = team === 'red' ? AA95_MSL_ORDER : AVENGER_MSL_ORDER; // 发射点表(gunPivot 局部;索引=side×每侧筒数+tubeIdx)
    var _aaMzO = new THREE.Object3D(); gunPivot.add(_aaMzO);
    tank._aaMslMuzzle = { obj: _aaMzO, pos: _aaOrder, perSide: _aaPer };
    tank._aaGunDX = 1.02;                                                // RED_AA 左右双联炮耳轴横移(fireAAGun 出膛点切换)
    var _aaMslGeo = team === 'red' ? ty90MissileGeo : aaAvNoseGeo();    // 防空导弹≡空空导弹 弹体/BLUE_AA=管口弹头帽(防空导弹 藏于管内)
    for (var _asd = 0; _asd < 2; _asd++) {
      var _aaMeshes = [];
      for (var _atj = 0; _atj < _aaPer; _atj++) {
        var _asl = _aaOrder[_asd * _aaPer + _atj];
        var _amm = new THREE.Mesh(_aaMslGeo, heliMissileMat);
        _amm.position.set(_asl[0], _asl[1], _asl[2] - (team === 'red' ? 0.765 : 0.10));   // 弹体自弹头建模中心向后延伸
        _amm.userData.visual = true;
        _amm.castShadow = false; _amm.receiveShadow = true;
        gunPivot.add(_amm);
        _aaMeshes.push(_amm);
      }
      if (_asd === 0) tank._heliMslMeshesL = _aaMeshes; else tank._heliMslMeshesR = _aaMeshes;
    }
    tank._radarEyeH = team === 'red' ? 4.0325 : 1.2;                   // LOS 测量原点高度: RED_AA=桅顶雷达盘心(1.5925+0.86+1.58,2026-09-11 随车体降 R/4); BLUE_AA无雷达(占位)
    if (team === 'red') {                                               // RED_AA 雷达航迹表初始化(updateHeliRadar 消费);任务23:部署冷启动——通电预热 15s(=直升机雷达启动时长)后就绪即开,此后不关;击毁/重新部署重新冷启动
      tank._heliRadarActive = false;
      tank._heliRadarWarmup = 0;
      tank._heliRadarTracks = [];
      tank._heliRadarDesignateSeq = 0;
      tank._heliRadarManualInhibit = false;
      tank._heliMissileTarget = null;
    }
  }

  instShadowRegister(tank);              // 命中壳阴影代理——首车烘焙模板,全部车注册阴影实例桶
  tanks.push(tank);
  /* 载具风化⑧: 登记各部件网格(受击点 → 件本地坐标) + 出生时定个体风化强度(每车脏得不一样) */
  if (typeof vehWeatherInitTank === 'function') vehWeatherInitTank(tank);
  tank._wxParts = { hull: _hullMeshRef, turret: turMeshRef, gun: gunMeshRef, mantlet: manMeshRef,
                    mainRotor: (typeof mainRotorMeshRef !== 'undefined' ? mainRotorMeshRef : null),
                    tailRotor: (typeof tailRotorMeshRef !== 'undefined' ? tailRotorMeshRef : null) };
  for (var _wkk in tank._wxParts) if (tank._wxParts[_wkk]) {
    tank._wxParts[_wkk].userData.wxTank = tank; tank._wxParts[_wkk].userData.wxPart = _wkk;
    if (tank.isPlayer && typeof _wxPlayerDrawHook === 'function') tank._wxParts[_wkk].onBeforeRender = _wxPlayerDrawHook;   /* ★优化H: 玩家部件逐 draw 写战损 uniform(对象级钩子, r128 真链路) */
  }
  aliveList.push(tank);                  // 活车紧凑表同步入列(阵亡时 killTank 摘除)
  teamCounts[tank.team]++;               // 全部在场活车计数(包含战略支援)
  if (!tank._strategicSupport) teamRegularCounts[tank.team]++; // 最大在场编制不计战略支援
  cmdAssign(tank);                       // 新车(含增援)入组——最近不满员小组,没有则新建
  if (isHeliVehicle(tank)) {
    var hprm = HELI_PARAMS[kind] || HELI_PARAMS.wz10;
    var hpx = tank.group.position.x, hpz = tank.group.position.z;
    var hfx = Math.sin(tank.yaw), hfz = Math.cos(tank.yaw);
    var hxF = hpx + hfx * hprm.zFront, hzF = hpz + hfz * hprm.zFront;
    var hxR = hpx + hfx * hprm.zRear, hzR = hpz + hfz * hprm.zRear;
    var hhF = terrainH(hxF, hzF), hhR = terrainH(hxR, hzR);
    var hdz = hprm.zFront - hprm.zRear;
    var hgSlope = Math.atan2(hhF - hhR, hdz);
    var hContact = (hhF * (-hprm.zRear) + hhR * hprm.zFront) / hdz;
    // 左右双点定初始横滚(与 updateHeli/alignHeli 同口径,避免生成瞬间姿态跳变)
    var hrx = hfz, hrz = -hfx;
    var hgRoll = Math.atan2(terrainH(hpx - hrx, hpz - hrz) - terrainH(hpx + hrx, hpz + hrz), 2.0);
    tank.group.position.y = hContact - hprm.groundOffset;
    tank._heliAlt = 0;
    // 开局发动机熄火(滚轮向上=点火启动; AI 0.8s 后自动启动)
    tank._heliEngineState = 'cutoff';
    tank._heliStartPhaseT = 0;
    tank._heliCollCap = 0;
    tank._heliRadarWarmup = 0;
    tank._heliRadarActive = false;
    tank._heliRadarTracks = [];
    tank._heliRadarDesignateSeq = 0;
    tank._heliRadarManualInhibit = false;
    tank._heliMissileTarget = null;
    tank._heliThrottle = 0;
    tank._heliPower = 0;
    tank._heliRotorRPM = 0;
    tank._heliTailRotorRPM = 0;
    tank._heliCollective = 0.0;
    tank._heliGear = 'cutoff';
    tank._heliVx = 0; tank._heliVy = 0; tank._heliVz = 0;
    tank._heliPitch = hprm.restPitch + hgSlope;
    tank._heliRoll = hgRoll;
    tank._heliPitchRate = 0; tank._heliRollRate = 0; tank._heliYawRate = 0;
    tank._heliRotorAngle = 0;
    tank._heliTailRotorAngle = 0;
    tank._heliRotorHitMesh = (mods.trackL && mods.trackL.mesh) ? mods.trackL.mesh : null;
    tank.group.rotation.order = 'YXZ';
    tank.group.rotation.y = tank.yaw;
    tank.group.rotation.x = -tank._heliPitch;
    tank.group.rotation.z = hgRoll;
  }
  for (var mmi2 = 0; mmi2 < tank.modMeshes.length; mmi2++) addTarget(tank.modMeshes[mmi2]);   // 增量纳入命中宽相位(替代 rebuildTargets 的 scene.traverse)
  return tank;
}
function addTarget(m) { targetsList.push(m); }     // 增量添加命中候选(createTank 创建时调用;替代 rebuildTargets 的全表 traverse)
/* 载具预览专用创建(隔离战斗系统):复用 createTank 建模,创建后从战斗表逆向摘除——
   不参与 战斗表/活车表/在场计数/指挥官分组/命中宽相位;仅保留视觉组供预览场景渲染 */
function createPreviewVehicle(kind, team) {
  var t = createTank({ kind: kind, team: team, x: 0, z: 0, yaw: 0, isPlayer: false, name: 'PREVIEW' });
  var ix = tanks.indexOf(t); if (ix >= 0) tanks.splice(ix, 1);
  var ia = aliveList.indexOf(t); if (ia >= 0) aliveList.splice(ia, 1);
  teamCounts[t.team]--;
  if (!t._strategicSupport) teamRegularCounts[t.team]--;
  if (t._cmdG) cmdLeave(t);
  for (var mi = 0; mi < t.modMeshes.length; mi++) {
    var ti = targetsList.indexOf(t.modMeshes[mi]);
    if (ti >= 0) targetsList.splice(ti, 1);
  }
  /* 个体网格还原可见(与接管同机理):createTank 视觉件是 _instSrc 隐藏源(实例流代显);
     预览车不在 aliveList → 实例流不渲染它,必须还原个体网格否则=隐形车(画布空白根因) */
  if (t._instSrcs) for (var si = 0; si < t._instSrcs.length; si++) {
    var sm = t._instSrcs[si];
    if (sm) { sm.userData._instSrc = false; sm.visible = true; }
  }
  t._instOut = false;
  if (isHeliVehicle(t)) {
    var hprm = HELI_PARAMS[kind] || HELI_PARAMS.wz10;
    t.group.rotation.order = 'YXZ';
    t.group.rotation.y = Math.PI;
    t.group.rotation.x = -hprm.restPitch;
    t.group.rotation.z = 0;
    t.group.position.set(0, -hprm.groundOffset, 0);
  }
  return t;
}
function clearTargets() { targetsList.length = 0; } // 清空命中候选(仅调试 clearAI / 再战清场用;正常游戏页面刷新即清空)
function rebuildTargets() {
  // 增量模式:createTank 时已逐个 addTarget;此处仅强制重注册活车命中网格(挡弹宽相位)
  // 调用方(增援/部署/调试)仍调本函数,语义不变——日常网格由 hitGridDynamicTick 逐帧增量维护
  rebuildHitGrid();
}

/* ===== 命中检测宽相位:18m 网格,128+ 车辆时避免全表射线(性能关键) ===== */
/* 静态/动态分桶:残骸+障碍物位置永久固定 → hitGridStatic(事件驱动,一次注册);
   活车移动 → hitGridDynamic(逐车换格增量:每帧 4 次格界比对/车,
   仅覆盖格范围变化才重注册,死亡即时移除——替代旧每 0.3s 全量重建,网格新鲜度 0.3s→1 帧)。
   查询端合并两表,候选集合与单表完全一致。 */
var HG_CELL = 18, hitGridStatic = new Map(), hitGridDynamic = new Map(), _candStamp = { v: 0 };
// 静态遮挡物(障碍/残骸)变动版本;AI LOS 用它做缓存失效触发。
var hitGridStaticVersion = 1;
function _hgPush(grid, x, z, r, entry) {
  var x0 = Math.floor((x - r) / HG_CELL), x1 = Math.floor((x + r) / HG_CELL);
  var z0 = Math.floor((z - r) / HG_CELL), z1 = Math.floor((z + r) / HG_CELL);
  for (var ix = x0; ix <= x1; ix++) for (var iz = z0; iz <= z1; iz++) {
    var k = ix * 4096 + iz, arr = grid.get(k);   // 整数键(免字符串分配;与 collectCands/wreckGrid 同编码)
    if (!arr) { arr = []; grid.set(k, arr); }
    arr.push(entry);
  }
}
/* 活车动态网格增量维护(触发器):换格检测用覆盖格范围四值(与 _hgPush 同口径,含半径外扩——
   范围任一界变即重注册,保证查询端候选集与旧全量重建完全一致,且新鲜度提升到 1 帧) */
var _hgExt = [0, 0, 0, 0];   // 复用 scratch(热路径,零分配)
function _hgExtents(x, z, r, e) {
  e[0] = Math.floor((x - r) / HG_CELL); e[1] = Math.floor((x + r) / HG_CELL);
  e[2] = Math.floor((z - r) / HG_CELL); e[3] = Math.floor((z + r) / HG_CELL);
}
function hitGridDynamicReg(t) {              // 全量注册(首帧/换格/强制重建):8 模块入覆盖格,记录格范围
  var p = t.group.position, r = t.radius + 1.6;
  _hgExtents(p.x, p.z, r, _hgExt);
  t._hgX0 = _hgExt[0]; t._hgX1 = _hgExt[1]; t._hgZ0 = _hgExt[2]; t._hgZ1 = _hgExt[3];
  for (var j = 0; j < t.modMeshes.length; j++) _hgPush(hitGridDynamic, p.x, p.z, r, t.modMeshes[j]);
}
function hitGridDynamicRemove(t) {           // 从旧覆盖格剔除本车全部命中壳(阵亡/换格)
  if (t._hgX0 == null) return;               // 未注册过:免动
  for (var ix = t._hgX0; ix <= t._hgX1; ix++) for (var iz = t._hgZ0; iz <= t._hgZ1; iz++) {
    var k = ix * 4096 + iz, arr = hitGridDynamic.get(k);
    if (!arr) continue;
    for (var a = arr.length - 1; a >= 0; a--) if (t.modMeshes.indexOf(arr[a]) >= 0) arr.splice(a, 1);
    if (!arr.length) hitGridDynamic.delete(k);
  }
  t._hgX0 = null;
}
function hitGridDynamicTick() {              // 每帧:逐车换格检测(未换格零操作;新车/被接管自动入格)
  var i, t, p, r;
  for (i = 0; i < aliveList.length; i++) {
    t = aliveList[i];
    p = t.group.position; r = t.radius + 1.6;
    _hgExtents(p.x, p.z, r, _hgExt);
    if (t._hgX0 === _hgExt[0] && t._hgX1 === _hgExt[1] && t._hgZ0 === _hgExt[2] && t._hgZ1 === _hgExt[3]) continue;
    hitGridDynamicRemove(t);
    hitGridDynamicReg(t);
  }
}
function hitGridStaticInsert(t) {   // 残骸静态注册,仅执行一次。1B:优先 1 个遮挡代理,回退 8 命中壳
  if (t._staticHitRegistered) return;
  t._staticHitRegistered = true;
  hitGridStaticVersion++;
  var p = t.group.position, r = t.radius + 1.6;
  t._sHgX0 = Math.floor((p.x - r) / HG_CELL); t._sHgX1 = Math.floor((p.x + r) / HG_CELL);   // 静态覆盖格范围(代理下线精确剔除用)
  t._sHgZ0 = Math.floor((p.z - r) / HG_CELL); t._sHgZ1 = Math.floor((p.z + r) / HG_CELL);
  if (typeof OCC_PROXY_ON !== 'undefined' && OCC_PROXY_ON && t._occMesh) {
    t._occMesh.userData._circ = { x: p.x, z: p.z, r: r + 0.5 };   // 1B②:2D 包围圆(圆预筛用)
    _hgPush(hitGridStatic, p.x, p.z, r, t._occMesh);              // 1 代理替代 8 壳(候选 ÷8)
    return;
  }
  var c = { x: p.x, z: p.z, r: r + 0.5 };                         // 8 壳共享同一圆对象(注册幂等)
  for (var j = 0; j < t.modMeshes.length; j++) {
    t.modMeshes[j].userData._circ = c;
    _hgPush(hitGridStatic, p.x, p.z, r, t.modMeshes[j]);
  }
}
function hitGridStaticRemoveTankMesh(t, mesh) {   // 从记录的静态覆盖格剔除指定 mesh(1B 代理下线用;仿动态表剔除模式)
  if (t._sHgX0 == null) return;
  hitGridStaticVersion++;
  for (var ix = t._sHgX0; ix <= t._sHgX1; ix++) for (var iz = t._sHgZ0; iz <= t._sHgZ1; iz++) {
    var k = ix * 4096 + iz, arr = hitGridStatic.get(k);
    if (!arr) continue;
    for (var a = arr.length - 1; a >= 0; a--) if (arr[a] === mesh) arr.splice(a, 1);
    if (!arr.length) hitGridStatic.delete(k);
  }
}
function rebuildHitGrid() {            // 强制全量重注册(场景重建/调试清场后;日常由 hitGridDynamicTick 增量维护)
  hitGridDynamic.clear();
  for (var i = 0; i < aliveList.length; i++) { var t = aliveList[i]; t._hgX0 = null; hitGridDynamicReg(t); }
}
// 收集线段(世界 xz)附近 1 圈邻格内的候选命中网格;out 复用(合并静态+动态两表)
// staticOnly:LOS/掩体布尔判定专用——活车从不遮挡视线(ai.js 过滤语义),跳过动态表省掉整段三角形白测
var _candList = [];
var OCC_CIRCLE_ON = true;         // 性能开关(1B②):静态候选 2D 射线-圆预筛(关闭回退全候选)
function collectCands(ax, az, bx, bz, out, staticOnly) {
  out.length = 0; _candStamp.v++;
  var dx = bx - ax, dz = bz - az, L = Math.sqrt(dx * dx + dz * dz);
  var segDx = dx, segDz = dz, segL2 = dx * dx + dz * dz || 1;   // 1B②:线段参数一次算好(点-线段 2D 距离测试用)
  var circOn = OCC_CIRCLE_ON;
  var steps = Math.max(1, Math.ceil(L / (HG_CELL * 0.75)));
  for (var s = 0; s <= steps; s++) {
    var cx = Math.floor((ax + dx * s / steps) / HG_CELL), cz = Math.floor((az + dz * s / steps) / HG_CELL);
    for (var ix = cx - 1; ix <= cx + 1; ix++) for (var iz = cz - 1; iz <= cz + 1; iz++) {
      var key = ix * 4096 + iz;
      var arr = hitGridStatic.get(key);               // 静态表(残骸+障碍物)
      if (arr) for (var j = 0; j < arr.length; j++) {
        var m = arr[j];
        if (circOn) {                                 // 2D 射线-圆预筛:圆不切线段→几何必不切线段,连 _stamp 都省
          var c = m.userData._circ;                   //   (注册半径本就是宽相位包络,圆 r 再 +0.5 只宽不严;无圆=异常防御不筛)
          if (c) {
            var t2 = ((c.x - ax) * segDx + (c.z - az) * segDz) / segL2;
            if (t2 < 0) t2 = 0; else if (t2 > 1) t2 = 1;
            var qx = c.x - (ax + segDx * t2), qz = c.z - (az + segDz * t2);
            if (qx * qx + qz * qz > c.r * c.r) continue;
          }
        }
        if (m.userData._stamp === _candStamp.v) continue;
        m.userData._stamp = _candStamp.v;
        out.push(m);
      }
      if (staticOnly) continue;                       // LOS 路径:活车不遮挡,动态表整段跳过
      arr = hitGridDynamic.get(key);                  // 动态表(活车)
      if (arr) for (var j2 = 0; j2 < arr.length; j2++) {
        var m2 = arr[j2];
        if (m2.userData._stamp === _candStamp.v) continue;
        m2.userData._stamp = _candStamp.v;
        out.push(m2);
      }
    }
  }
  if (typeof PERF_BASE !== 'undefined') PERF_BASE.losCands = (PERF_BASE.losCands || 0) + out.length;   // 诊断计数:每条射线宽相位候选数累计(LOS/弹道/测距共用,量化静态遮挡代理收益)
}
var _losHitOut = [];                  // 静态早退路径输出 scratch(单元素复用,消费端只做存在性循环)
function worldRaycast(ax, ay, az, bx, by, bz, staticOnly) {   // 宽相位包装的线段射线
  _v1.set(ax, ay, az); _v2.set(bx - ax, by - ay, bz - az);
  var d = _v2.length(); _v2.normalize();
  losRay.set(_v1, _v2); losRay.far = d;
  if (!staticOnly) return losIntersect(ax, az, bx, bz, losRay);
  /* 静态-only 早退路径(AI LOS/掩体专用):语义只需"存在静态遮挡",无需全候选求交+排序。
     沿途步进(collectCands 由 a→b)使候选天然近→远 → 首个阻挡命中即返回,远处候选全部免测。
     与全候选路径等价:全候选中活车命中被消费端过滤(从不阻挡),剔除后布尔同值;
     静态表全为阻挡物,保留 ud 过滤仅为防御性(万一注册非阻挡 mesh)。 */
  collectCands(ax, az, bx, bz, _candList, true);
  _losHitOut.length = 0;
  for (var i = 0; i < _candList.length; i++) {
    var h = losRay.intersectObject(_candList[i], false);
    if (h.length) {
      var ud = h[0].object.userData;
      if (ud.obstacle || (ud.tank && !ud.tank.alive)) { _losHitOut.push(h[0]); break; }
    }
  }
  return _losHitOut;
}

/* ============================================================
   InstancedMesh 载具实例化(全量,用户选 drop_jitter 同队同色)——
   同 (team,kind) 共享几何,每部件一个 InstancedMesh,每帧按存活载具重排实例矩阵。
   命中壳(hidden 网格)不动;LOD(>100m)/残骸合并(cz/dc/dg)的载具走各自独立网格,不进实例流。
   目标:存活载具 ~1200dc → ~4型号×4部件≈16dc。
   ============================================================ */
var INST_CAP = 80;                    // 每 (team,kind,part) 实例容量(默认编制 64 坦克留余量;编制菜单可调大——桶满时 instUpdateAll 自动降级个体网格,兜底不丢车)
var INST_TPL = {};                    // 模板几何缓存 key=team|kind → {hull,hullGlow,turret,turretGlow,gun,mantlet}
var INST_MESH = {};                   // InstancedMesh 注册表 key=team|kind|part → InstancedMesh
/* 复用 scratch(热路径,避免每帧 GC;模块私有) */
var _instM4 = new THREE.Matrix4();

/* 模板几何建造:首次某 (team,kind) 时调用,合并各部件几何并缓存。颜色已去抖,几何同型号完全一致 */
/* ============================================================
   残骸低模模板(减面方案 L1+L2;全距离统一,无 LOD 切换)
   L1 小杂件过滤:炭黑均色残骸上,铰链/把手/潜望镜/压筋/条纹类小凸起不可辨——
      判定=零件本体包围盒 最大边<0.30m 或 次大边<0.06m(薄细件),另细圆柱 r<0.035(轴销/几何天线,天线另有稳定线);
      剪影件(车体/炮塔/炮管/履带/轮/裙板/翼板)天然通过判定,轮廓零变化。
   L2 曲面降段:轮系等 ≥12 段圆柱半段重建(下限 8 段)/履带环粗采样(decim=3,直边 0.75m/弧步 0.36m);
      59 穹顶经特殊加工链(对称化/收束/切口),重建风险大于收益,保留原样。
   产物:WRECK_GEO_LOD(高模共享几何→残骸低模共享几何;发光件→null 不进残骸),
   消费端=combat.js mergeWreckMeshes 单点换表;活车/预览/命中/阴影路径零涉及;表空=行为回退现状。 */
var WRECK_GEO_LOD = new Map();
var WRECK_LOD_CFG = { cylMinSeg: 8, treadDecim: 3, dropMaxDim: 0.30, dropMidDim: 0.06, dropCylR: 0.035 };
function _wreckPartKeep(p) {
  var g = p.g, ud = g.userData || {};
  if (ud._wpCyl && Math.max(ud._wpCyl[0], ud._wpCyl[1]) < WRECK_LOD_CFG.dropCylR) return false;
  if (!g.boundingBox) g.computeBoundingBox();
  var bb = g.boundingBox, dx = bb.max.x - bb.min.x, dy = bb.max.y - bb.min.y, dz = bb.max.z - bb.min.z;
  var mn = Math.min(dx, dy, dz), mx = Math.max(dx, dy, dz), md = dx + dy + dz - mn - mx;
  if (mx < WRECK_LOD_CFG.dropMaxDim) return false;
  if (md < WRECK_LOD_CFG.dropMidDim) return false;
  return true;
}
function _wreckPartGeo(p) {                       // L2:曲面低模重建(重放原变换);无参数记录=原几何直用
  var ud = p.g.userData || {}, low = null, m;
  if (ud._wpCyl) {
    var q = ud._wpCyl;
    low = new THREE.CylinderGeometry(q[0], q[1], q[2], Math.max(WRECK_LOD_CFG.cylMinSeg, q[3] >> 1));
    uvSetFlat(low);
    m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(q[7], q[8], q[9])); m.setPosition(q[4], q[5], q[6]);
    low.applyMatrix4(m);
  } else if (ud._wpTread) {
    var t = ud._wpTread;
    low = trackRingGeo(t[0], t[1], t[2], t[3], WRECK_LOD_CFG.treadDecim);
    m = new THREE.Matrix4(); m.setPosition(t[4], t[5], t[6]);
    low.applyMatrix4(m);
  }
  if (low && ud._wpScale) low.scale(ud._wpScale[0], ud._wpScale[1], ud._wpScale[2]);
  return low ? { g: low, c: p.c, camo: p.camo || 0, _tmp: true } : p;   // vcpanel-7: LOD 重建保留材质分类身份
}
function _wreckBuildTpl(partGeos, tpl) {
  for (var pk in tpl) {
    if (!tpl[pk] || !tpl[pk].isBufferGeometry) continue;
    if (pk === 'hullGlow' || pk === 'turretGlow') { WRECK_GEO_LOD.set(tpl[pk], null); continue; }   // 发光镜片不进残骸
    var src = partGeos[pk] || [], keep = [], i;
    for (i = 0; i < src.length; i++) if (_wreckPartKeep(src[i])) keep.push(_wreckPartGeo(src[i]));
    if (!keep.length) { WRECK_GEO_LOD.set(tpl[pk], null); continue; }
    var low = mergeVisParts(keep, pk, true); // 残骸不挂漫画线；跳过预细分边集，避免无用缓存
    low.userData = low.userData || {}; low.userData._shared = true;
    for (i = 0; i < keep.length; i++) if (keep[i]._tmp) keep[i].g.dispose();
    WRECK_GEO_LOD.set(tpl[pk], low);
    if (typeof DBG_ON !== 'undefined' && DBG_ON) console.log('[WRECK-LOD]', pk, (tpl[pk].index.count / 3 | 0) + '→' + (low.index.count / 3 | 0) + ' tri,', src.length + '→' + keep.length + ' parts');
  }
}
/* ============================================================
   P1 对局几何折边墨线(对齐车库 applyVehicleStyle / EdgesGeometry 22°)
   P1fix 2026-09-06:
   · 折边缓存 VEH_INK_GEO[team|kind], 禁止写进 INST_TPL(for-in 会被当成部件几何,
     InstancedMesh 更新中断 → AI count=0 车体消失);
   · hull 只抽 aVTag.x≈0 的静止装甲三角(履带/负重轮/摆臂是 shader 变形, bind-pose
     折边会在运动后留下线框笼);
   · Line depthWrite=false, 避免静止棱挡住变形后的履带。
   挂点/LOD/预览 skip 同 P1。
   ============================================================ */
var VEH_INK_ANGLE = 22;
var VEH_INK_LOD_R2 = 80 * 80;
var VEH_INK_LOD_MAX = 16;
var VEH_INK_PARTS = ['hull', 'turret', 'gun', 'mantlet', 'mainRotor', 'tailRotor'];
var VEH_INK_GEO = {};                              // key=team|kind → {hull,turret,...} EdgesGeometry, 不进 INST_TPL
var vehInkMat = new THREE.LineBasicMaterial({
  color: 0x141610, fog: true, depthTest: true, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
});
var _vehInkNear = [];
/* hull 动态件(aVTag.x≠0)剔除后的索引几何, 与 tpl.hull 共享 position, 仅供 EdgesGeometry 读一次 */
function vehInkArmorOnlyGeo(src) {
  var tag = src.attributes.aVTag, idx = src.index, pos = src.attributes.position;
  if (!tag || !idx || !pos) return src;
  var ta = tag.array, ia = idx.array, n = idx.count, kept = [], maxI = 0, i, i0, i1, i2;
  for (i = 0; i < n; i += 3) {
    i0 = ia[i]; i1 = ia[i + 1]; i2 = ia[i + 2];
    if (Math.abs(ta[i0 * 4]) < 0.5 && Math.abs(ta[i1 * 4]) < 0.5 && Math.abs(ta[i2 * 4]) < 0.5) {
      kept.push(i0, i1, i2);
      if (i0 > maxI) maxI = i0; if (i1 > maxI) maxI = i1; if (i2 > maxI) maxI = i2;
    }
  }
  if (kept.length < 3) return null;
  var g = new THREE.BufferGeometry();
  g.setAttribute('position', pos);                 // 共享, dispose 前必须 deleteAttribute
  g.setIndex(new THREE.BufferAttribute(maxI > 65535 ? new Uint32Array(kept) : new Uint16Array(kept), 1));
  return g;
}
function vehInkBuildTpl(team, kind, tpl) {
  var key = team + '|' + kind, bag, i, pk, src, tmp, eg;
  if (tpl && tpl._ink) delete tpl._ink;            // Remove the transient ink key before iterating the template.
  if (VEH_INK_GEO[key]) return VEH_INK_GEO[key];
  if (!tpl) return null;
  bag = {};
  for (i = 0; i < VEH_INK_PARTS.length; i++) {
    pk = VEH_INK_PARTS[i];
    src = tpl[pk];
    if (!src || !src.isBufferGeometry) continue;
    /* vcpanel-8：优先复用 mergeVisParts 在灰白距离场细分前冻结的旧拓扑 22° 边集。
       禁止再对细分后 geometry 做 EdgesGeometry，否则不配对的 T 接缝会被误判成开口黑线。 */
    if (src.userData && src.userData._vehInkPrePanel) {
      bag[pk] = src.userData._vehInkPrePanel;
      continue;
    }
    tmp = null;
    if (pk === 'hull' && src.attributes.aVTag) {
      tmp = vehInkArmorOnlyGeo(src);
      if (!tmp) continue;
      src = tmp;
    }
    eg = new THREE.EdgesGeometry(src, VEH_INK_ANGLE);
    eg.userData = eg.userData || {};
    eg.userData._shared = true;
    bag[pk] = eg;
    if (tmp && tmp !== tpl[pk]) { tmp.deleteAttribute('position'); tmp.dispose(); }
  }
  VEH_INK_GEO[key] = bag;
  return bag;
}
function vehInkParentOf(t, pk) {
  if (pk === 'hull') return t.group;
  if (pk === 'turret') return t.turret;
  if (pk === 'gun' || pk === 'mantlet') return t.gunPivot;
  if (pk === 'mainRotor') return t.mainRotorGroup;
  if (pk === 'tailRotor') return t.tailRotorGroup;
  return null;
}
function vehInkAttach(t, tpl, isP) {
  var bag = t ? VEH_INK_GEO[t.team + '|' + t.kind] : null;
  if (!bag && tpl && typeof vehInkBuildTpl === 'function') bag = vehInkBuildTpl(t.team, t.kind, tpl);
  if (!t || !bag || t._vehInk) return;
  var lines = [], pk, geo, par, ls;
  for (var i = 0; i < VEH_INK_PARTS.length; i++) {
    pk = VEH_INK_PARTS[i];
    geo = bag[pk];
    par = vehInkParentOf(t, pk);
    if (!geo || !par) continue;
    ls = new THREE.LineSegments(geo, vehInkMat);
    ls.userData.isVehInk = true;
    ls.userData.vehInkRecoil = (pk === 'gun');
    ls.userData.visual = !!isP;                    // 仅玩家:开镜 setTankVisuals 同步隐身
    ls.castShadow = false;
    ls.receiveShadow = false;
    ls.visible = !!isP;                            // AI 默认关, LOD 打开近车
    ls.renderOrder = 2;
    par.add(ls);
    lines.push(ls);
  }
  t._vehInk = lines;
}
function vehInkMarkPlayer(t, isP) {
  var a = t && t._vehInk, i;
  if (!a) return;
  for (i = 0; i < a.length; i++) {
    a[i].userData.visual = !!isP;
    if (isP) a[i].visible = true;
  }
}
function vehInkRemove(t) {
  var a = t && t._vehInk, i;
  if (!a) return;
  for (i = 0; i < a.length; i++) {
    if (a[i].parent) a[i].parent.remove(a[i]);
  }
  t._vehInk = null;
}
function vehInkSyncRecoil(t) {
  var a = t._vehInk, z, i;
  if (!a || !t.gunMesh) return;
  z = t.gunMesh.position.z;
  for (i = 0; i < a.length; i++) if (a[i].userData.vehInkRecoil) a[i].position.z = z;
}
function vehInkLodTick() {
  if (!camera) return;
  var cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  var i, j, t, p, dx, dy, dz, d2, a, on, lim;
  _vehInkNear.length = 0;
  for (i = 0; i < aliveList.length; i++) {
    t = aliveList[i];
    a = t._vehInk;
    if (!a || !a.length) continue;
    if (t.isPlayer) { vehInkSyncRecoil(t); continue; }   // 玩家可见性交给 setTankVisuals
    if (!t.alive) {
      if (a[0].visible) for (j = 0; j < a.length; j++) a[j].visible = false;
      continue;
    }
    p = t.group.position;
    dx = p.x - cx; dy = p.y - cy; dz = p.z - cz;
    d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > VEH_INK_LOD_R2) {
      if (a[0].visible) for (j = 0; j < a.length; j++) a[j].visible = false;
    } else {
      t._inkD2 = d2;
      _vehInkNear.push(t);
    }
  }
  if (_vehInkNear.length > VEH_INK_LOD_MAX)
    _vehInkNear.sort(function (x, y) { return x._inkD2 - y._inkD2; });
  lim = Math.min(_vehInkNear.length, VEH_INK_LOD_MAX);
  for (i = 0; i < _vehInkNear.length; i++) {
    t = _vehInkNear[i];
    a = t._vehInk;
    on = i < lim;
    if (a[0].visible !== on) for (j = 0; j < a.length; j++) a[j].visible = on;
    if (on) vehInkSyncRecoil(t);
  }
}

function instBuildTemplate(team, kind, partGeos) {
  var key = team + '|' + kind;
  if (INST_TPL[key]) {
    vehInkBuildTpl(team, kind, INST_TPL[key]);     // P1fix: 折边进 VEH_INK_GEO, 不写 tpl._ink
    for (var pk2 in partGeos) {                    // 模板已建:本次新造零件几何就地销毁(首辆车已烘焙进共享模板),杜绝增援车几何泄漏
      var arr2 = partGeos[pk2];
      if (!arr2) continue;
      for (var i2 = 0; i2 < arr2.length; i2++) if (arr2[i2].g && arr2[i2].g.dispose) arr2[i2].g.dispose();
    }
    return INST_TPL[key];
  }
  var tpl = {};
  for (var pk in partGeos) {
    if (partGeos[pk] && partGeos[pk].length) tpl[pk] = mergeVisParts(partGeos[pk], pk);   // mergeVisParts 返回合并几何(含包围球)
  }
  _wreckBuildTpl(partGeos, tpl);                   // 残骸低模模板(每型号一次;必须在零件几何仍在手时构建)
  vehInkBuildTpl(team, kind, tpl);                 // P1fix: 22° 折边进 VEH_INK_GEO
  INST_TPL[key] = tpl;
  return tpl;
}

/* 为某部件创建 InstancedMesh(若尚未创建) */
function instEnsureMesh(team, kind, part, geo, mat) {
  var key = _instPartKey(team + '|' + kind, part);   // 缓存版键函数(与 instUpdateAll 共用 _tplPartKeys)
  if (INST_MESH[key]) return INST_MESH[key];
  var im = new THREE.InstancedMesh(geo, mat, INST_CAP);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.frustumCulled = false;                        // 实例分布全场,逐实例剔除由 count 控制,整体剔除反而误杀
  im.count = 0;
  im.castShadow = false;                           // 装饰视觉流不投影——阴影只由命中壳代理流(instShadow)投射
  im.receiveShadow = true;
  im.userData.instPart = part;                     // DC 归因审计桶名用
  /* [2026-09-05 属性打包] aInstA(vec4) = (履带左偏移/滚动量, 右同, 战损, 风化) —— 原
     aTrackOffL/R + aVehDmg/aVehWear 四个单浮点属性合一,省 3 个属性槽。
     hull program 属性预算(AI InstancedMesh):
     pos/normal/uv/color + aCamo + aVTag + aInstA + aVehHit + aSusp0..3 + instanceMatrix×4
     = 16 = MAX_VERTEX_ATTRIBS。aTrkSlot 已打进 aInstA.w, 禁止再加 attribute。 */
  if (part !== 'hullGlow' && part !== 'turretGlow') {
    var _ia = new Float32Array(INST_CAP * 4);
    for (var _wi2 = 0; _wi2 < INST_CAP; _wi2++) _ia[_wi2 * 4 + 3] = 1.0;   // 风化缺省 1.0
    im.geometry.setAttribute('aInstA', new THREE.InstancedBufferAttribute(_ia, 4));
    im.geometry.attributes.aInstA.setUsage(THREE.DynamicDrawUsage);
    var _wh = new Float32Array(INST_CAP * 4);
    im.geometry.setAttribute('aVehHit', new THREE.InstancedBufferAttribute(_wh, 4));
    im.geometry.attributes.aVehHit.setUsage(THREE.DynamicDrawUsage);
    im.userData.wxPart = part;
  }
  if (part === 'hull' && geo.attributes.aVTag) {   // 扭杆悬挂 per-instance 变形量(14 轮槽 + 左右垂度); 路径槽位打进 aInstA.w
    var _s0 = new Float32Array(INST_CAP * 4), _s1 = new Float32Array(INST_CAP * 4),
        _s2 = new Float32Array(INST_CAP * 4), _s3 = new Float32Array(INST_CAP * 4);
    im.geometry.setAttribute('aSusp0', new THREE.InstancedBufferAttribute(_s0, 4));
    im.geometry.setAttribute('aSusp1', new THREE.InstancedBufferAttribute(_s1, 4));
    im.geometry.setAttribute('aSusp2', new THREE.InstancedBufferAttribute(_s2, 4));
    im.geometry.setAttribute('aSusp3', new THREE.InstancedBufferAttribute(_s3, 4));
    im.geometry.attributes.aSusp0.setUsage(THREE.DynamicDrawUsage);
    im.geometry.attributes.aSusp1.setUsage(THREE.DynamicDrawUsage);
    im.geometry.attributes.aSusp2.setUsage(THREE.DynamicDrawUsage);
    im.geometry.attributes.aSusp3.setUsage(THREE.DynamicDrawUsage);
  }
  scene.add(im);
  INST_MESH[key] = im;
  return im;
}

/* 个体视觉网格(残骸合并 mergeWreckMeshes 用):复用模板共享几何。
   hidden=true(AI 车):标 _instSrc 置 visible=false,由实例流渲染;
   hidden=false(玩家车):常规可见网格(玩家车不进实例流,开镜自隐/setTankVisuals 等显隐链原样工作)。
   几何标 _shared:mergeWreckMeshes 合并时不 dispose 共享几何(否则毁掉其它同型号车的模板)。 */
function _mkInstSrc(parent, geo, mat, hidden) {
  if (!geo) return null;
  geo.userData = geo.userData || {};
  geo.userData._shared = true;
  var m = new THREE.Mesh(geo, mat);
  m.userData.visual = true;
  if (hidden) { m.userData._instSrc = true; m.visible = false; }
  m.castShadow = !hidden;                         // AI源网格(hidden)不投影——阴影=命中壳代理流;玩家车开个体网格自投影
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/* ===== 矩阵获取(先 updateMatrixWorld 再读,调用方保证每车一次):
   车体=group.matrixWorld;炮塔=turret.matrixWorld;炮管=gunPivot.matrixWorld×后坐z偏移(gunMesh.position.z=−后坐量);炮盾=gunPivot(随后坐前的俯仰架)。 ===== */
var _instTr = new THREE.Matrix4();
function _instMatFor(part, t, m4) {
  if (part === 'hull' || part === 'hullGlow') m4.copy(t.group.matrixWorld);
  else if (part === 'turret' || part === 'turretGlow') m4.copy(t.turret.matrixWorld);
  else if (part === 'gun') {
    m4.copy(t.gunPivot.matrixWorld);
    if (t.gunMesh) { _instTr.makeTranslation(0, 0, t.gunMesh.position.z); m4.multiply(_instTr); }
  } else if (part === 'mainRotor' && t.mainRotorGroup) {
    m4.copy(t.mainRotorGroup.matrixWorld);
  } else if (part === 'tailRotor' && t.tailRotorGroup) {
    m4.copy(t.tailRotorGroup.matrixWorld);
  } else m4.copy(t.gunPivot.matrixWorld);          // mantlet 随俯仰不随后坐
}

/* 兜底显隐:实例桶满时被挤出的车临时走个体网格(可见),回桶后重新隐藏 */
function _instSrcsShow(t, v) {
  if (!t._instSrcs) return;
  for (var si = 0; si < t._instSrcs.length; si++) if (t._instSrcs[si]) t._instSrcs[si].visible = v;
}

/* ===== 每帧实例矩阵更新(视觉流+阴影代理流双轨):
   阶段1:新生车补一次 updateMatrixWorld(生成在 step 对齐段之后;其余活车 coll 段已对齐,不重算);
   阶段2:视觉流+阴影代理流单遍合流(三期)——每部件矩阵只算一次,双轨同写;
   玩家车/hull 桶满车不走视觉流,按阴影模板表迭代(阴影恒在)。
   计数表/键串全部复用缓存:帧内零对象分配、零字符串拼接(键首次出现时烘焙一次)。 ===== */
var _instCounts = {}, _instShCounts = {}, _instKeys = [], _instShKeys = [];
var _instPrevKeys = [], _instShPrevKeys = [];   // ★审查A5: 上帧写入桶名单(收尾只需扫 本帧∪上帧, 替代全表 for-in)
/* vcpanel-9：InstancedMesh 整体必须 frustumCulled=false，但此前因此把镜头后/屏外全场 AI 也写入
   高模视觉桶。改为入桶前逐车宽松包围球剔除；阴影代理与 AI/命中逻辑保持原路径。 */
var _instVisFrustum = new THREE.Frustum(), _instVisPV = new THREE.Matrix4();
var _instVisSphere = new THREE.Sphere(new THREE.Vector3(), 6.0), _instVisCullActive = false;
function _instVisualInFrustum(t) {
  if (!_instVisCullActive || !t || !t.group) return true;
  var e = t.group.matrixWorld.elements;
  _instVisSphere.center.set(e[12], e[13], e[14]);
  _instVisSphere.radius = (t.kind === 'heli') ? 10.0 : 6.0; // 宽松覆盖旋翼/炮管，避免画面边缘闪现
  return _instVisFrustum.intersectsSphere(_instVisSphere);
}
var _tplPartKeys = {};
function _instPartKey(tk, part) {
  var m = _tplPartKeys[tk];
  if (!m) m = _tplPartKeys[tk] = {};
  var k = m[part];
  if (!k) { k = tk + '|' + part; m[part] = k; }
  return k;
}
function _instFinalize(map, counts, keys, prevKeys) {   // ★审查A5: 模块级(原为每帧重建的嵌套闭包)
  var i, k, im, c;
  for (i = 0; i < keys.length; i++) {                  // 本帧有写入的桶: count 回写 + 矩阵标脏
    im = map[keys[i]]; if (!im) continue;
    c = counts[keys[i]] || 0;
    im.count = c;
    if (c > 0) im.instanceMatrix.needsUpdate = true;   // count=0 时无需上传(draw range 0, 缓冲内容不可见)
  }
  for (i = 0; i < prevKeys.length; i++) {              // 上帧有写、本帧无写的桶: 只清 count
    k = prevKeys[i]; if (counts[k]) continue;          // (本帧也写的已在上面处理)
    im = map[k]; if (im && im.count !== 0) im.count = 0;
  }
  prevKeys.length = 0;
  for (i = 0; i < keys.length; i++) prevKeys.push(keys[i]);   // 滚动移交: 本帧 keys → 下帧 prevKeys
}
function instUpdateAll() {
  var i, key, t, tk, tpl, im, shim, n, sn, pk, shpk, visOK, parts;
  _instVisCullActive = false;
  if (typeof camera !== 'undefined' && camera && camera.projectionMatrix && camera.matrixWorldInverse) {
    camera.updateMatrixWorld(true);                 // 同帧瞄准相机；Camera 会同步 matrixWorldInverse
    _instVisPV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _instVisFrustum.setFromProjectionMatrix(_instVisPV);
    _instVisCullActive = true;
  }
  var _wxUp = (typeof _wxEpoch !== 'undefined') && (_wxEpoch !== _wxEpochUp);   // 载具风化⑧: 战损数据本帧是否有变化
  var _wxSigH = 0, _wxSigN = 0;   // P0-1:本帧可见签名累加器
  for (i = 0; i < _instKeys.length; i++) _instCounts[_instKeys[i]] = 0;
  _instKeys.length = 0;
  for (i = 0; i < _instShKeys.length; i++) _instShCounts[_instShKeys[i]] = 0;
  _instShKeys.length = 0;
  for (i = 0; i < aliveList.length; i++) {
    t = aliveList[i];
    if (t._hydStruts) updateBLUE_MLRSHydraulics(t);          // BLUE_MLRS 动态液压杆:逐帧铰接解算(demo matrices() 等价)
    if (t._spadeRig) updatePHL11Spades(t);              // RED_MLRS 驻锄:停车放下/移动收起(逐帧铰接+液压缸瞄准解算)
    if (t._rktPack) updatePHL11Rockets(t);              // RED_MLRS 火箭弹:每发离轨少一个/装填完成整包刷回(count 截断)
    if (t._mmNew) { t.group.updateMatrixWorld(true); t._mmNew = false; }   // 仅新生车首轮补矩阵
  }
  for (i = 0; i < aliveList.length; i++) {
    t = aliveList[i];
    tk = t._tkKey || (t._tkKey = t.team + '|' + t.kind);   // 车型键随车缓存(终身一次拼接)
    tpl = INST_TPL[tk];
    visOK = !t.isPlayer && !!tpl && _instVisualInFrustum(t); // vcpanel-9: 屏外 AI 不进入膨胀视觉桶
    if (visOK && (_instCounts[_instPartKey(tk, 'hull')] || 0) >= INST_CAP) {   // hull 桶满=该车整体降级个体网格(兜底不丢车)
      if (!t._instOut) { t._instOut = true; _instSrcsShow(t, true); }
      t._hullInstIdx = undefined;                   // 同清 hull 实例索引,防止履带偏移写入过期槽位
      visOK = false;
    } else if (visOK && t._instOut) { t._instOut = false; _instSrcsShow(t, false); }
    if (visOK) { _wxSigN++; _wxSigH = ((_wxSigH * 31 + (i + 1) * 7 + ((t.group ? t.group.id : 0) & 0xffff)) | 0); }   // R1:可见成员签名(序相关:下标+group.id;t.id全仓无赋值恒零,改用three group.id)
    parts = visOK ? tpl : INST_SH_TPL[tk];          // 视觉流外(玩家/桶满)只走阴影模板表
    if (!parts) continue;
    for (key in parts) {
      if (!parts[key] || !parts[key].isBufferGeometry) continue;   // P1fix: 跳过 _ink 等非几何脏键, 防 InstancedMesh 中断 → AI count=0
      _instMatFor(key, t, _instM4);                 // 每部件矩阵一次,双轨同写(阴影部件=视觉部件子集)
      if (visOK) {
        pk = _instPartKey(tk, key);
        im = INST_MESH[pk];
        if (im) {
          n = _instCounts[pk] || 0;
          if (n < INST_CAP) {
            im.setMatrixAt(n, _instM4);
            if (key === 'hull') t._hullInstIdx = n;     // 记录 hull 实例索引(供 trackAnimUpdate 写 aInstA.xy;instUpdateAll 先于它跑=当帧新鲜)
            if (_wxUp && typeof vehWeatherWriteInst === 'function') vehWeatherWriteInst(im, n, t, key);   // 载具风化⑧: 战损实例属性(R1:恢复纯epoch门;可见变化已并入epoch)
            if (n === 0) _instKeys.push(pk);
            _instCounts[pk] = n + 1;
          }
        }
      }
      shpk = _instPartKey(tk, 'sh' + key);
      shim = INST_SH_MESH[shpk];
      if (shim) {
        sn = _instShCounts[shpk] || 0;
        if (sn < INST_CAP) {
          shim.setMatrixAt(sn, _instM4);
          if (sn === 0) _instShKeys.push(shpk);
          _instShCounts[shpk] = sn + 1;
        }
      }
    }
  }
  if (_wxUp && typeof vehWeatherInstCommit === 'function') vehWeatherInstCommit();   // 载具风化⑧: 本帧有战损变化 → 上传一次
  if (_wxSigN !== _wxVisSigN || _wxSigH !== _wxVisSigH) { _wxEpoch++; _wxVisSigN = _wxSigN; _wxVisSigH = _wxSigH; }   // R1:可见集变化→bump epoch,下帧重写+上传(静止零开销;修P0-1 commit早退吞force)
  /* 实例流收尾:视觉/阴影双流同形——★审查A5: 由"全表 for-in + 无条件 needsUpdate"(含空桶,
     空桶标脏=每帧全量矩阵缓冲 GPU 重传)收敛为"本帧∪上帧写入桶": 本帧有写的桶回写 count 并标脏;
     上帧有写、本帧无写的桶仅 count 清零(0=draw range 收缩, 不触发上传); 更早的桶 count 已为 0。 */
  _instFinalize(INST_MESH, _instCounts, _instKeys, _instPrevKeys);
  if (_trackLastWrites.length) {                                // ★审查A5: 存在门——无履带/悬挂写入的帧(全静止/远距)零扫描零标脏(原版每帧全表 for-in + 无条件 needsUpdate=整缓冲重传)
    for (key in INST_MESH) {
      im = INST_MESH[key];
      var _aI = im.geometry.attributes.aInstA;
      if (_aI && im.userData.instPart === 'hull') {             // 只清上一帧活跃写入的槽(其余槽本就不写=0)
        var _hitW = false, _ia = _aI.array;                     // ★审查A5: 命中门——本桶无待清写入则不触碰缓冲
        var _sA0 = im.geometry.attributes.aSusp0, _sA1 = im.geometry.attributes.aSusp1,
            _sA2 = im.geometry.attributes.aSusp2, _sA3 = im.geometry.attributes.aSusp3;
        for (var _wi = 0; _wi < _trackLastWrites.length; _wi++) {
          if (_trackLastWrites[_wi][0] === im) {
            var _o4 = _trackLastWrites[_wi][1] * 4;
            _ia[_o4] = 0; _ia[_o4 + 1] = 0;                     // .xy 归零(.zw 战损/风化由风化流独立维护,不可清)
            if (_sA0) {
              for (var _c = 0; _c < 4; _c++) {
                _sA0.array[_o4 + _c] = 0; _sA1.array[_o4 + _c] = 0;
                _sA2.array[_o4 + _c] = 0; _sA3.array[_o4 + _c] = 0;
              }
            }
            _hitW = true;
          }
        }
        if (_hitW) {
          _aI.needsUpdate = true;
          if (_sA0) { _sA0.needsUpdate = true; _sA1.needsUpdate = true; _sA2.needsUpdate = true; _sA3.needsUpdate = true; }
        }
      }
    }
  }
  _instFinalize(INST_SH_MESH, _instShCounts, _instShKeys, _instShPrevKeys);
}

/* ============================================================
   履带纹路滚动动态效果——左右独立差速 + 履带毁伤停止。
   · 玩家车:左右偏移 → uTrackOffL/uTrackOffR uniform(vehHullMatPlayer)
   · AI 近距车:左右偏移/滚动量 → aInstA.xy 实例属性(vehHullMat InstancedMesh)
   · LOD 候选才动:常规=100m 内且画面内,炮镜=画面内不限距;其余/残骸静止
     (instUpdateAll 已将非候选 aInstA.xy 与 aSusp0..3 归零)
   差速:转向时内侧履带减速、外侧加速(原地转向一侧正一侧负);turnRate 由 yaw 帧增量推导。
   HP 门控:某侧 mods.trackL/R.hp<=0 → 该侧偏移冻结(断履不滚);hp>0 才累积。
   候选名单每 0.5 秒刷新。 ---- */
var TRACK_ANIM_RADIUS = 100;              // 动态效果生效距离(m;常规分支须同时满足视锥门)
var WHEEL_ANIM_RADIUS = 500;              // ★任务27⑦:轮式车(RED_MLRS/BLUE_MLRS/BLUE_AA)轮转独立 LOD——
                                          //   100m 门按履带扭杆解算成本设计;轮式车每帧仅带速差分+aInstA 写入(几十次浮点),
                                          //   而猎杀模式炮战/机动多在 300-900m,原门下大直径卡车轮在可见距离上永不转。
                                          //   500m+视锥门:交战距离内轮转可见,屏外/超远仍冻结(开销上界=屏内轮式车数×O(1))。
/* —— 常规视角视锥门(履带/轮转 LOD 用)——
   自 camera 实时投影矩阵提取视锥,gameT 门控每帧至多刷新一次(与 map.js 精灵视锥同构但独立:
   trackAnimUpdate 跑在精灵更新之前,复用对方拿的是上一帧相机;独立一份零时序依赖)。
   开镜时 camera 本身就是炮镜相机(窄 FOV),同一视锥即炮镜视锥(炮镜分支另有 scopeScreenVisible 矩形门,此处只服务常规分支)。 */
var _trkFrustum = new THREE.Frustum(), _trkFrMat = new THREE.Matrix4(), _trkSph = new THREE.Sphere();
var _trkFrameT = -1;
function _trkFrustumUpdate() {                          // 每帧至多刷新一次(gameT 门)
  if (typeof camera === 'undefined' || !camera) return;
  var _tick = (typeof gameT !== 'undefined') ? gameT : 0;
  if (_trkFrameT === _tick) return;
  _trkFrameT = _tick;
  camera.updateMatrixWorld();
  _trkFrMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _trkFrustum.setFromProjectionMatrix(_trkFrMat);
}
function _trkInView(x, y, z, r) {                       // 包围球在当前画面内?(r=米级余量,覆盖车体半长)
  _trkSph.center.set(x, y, z); _trkSph.radius = r || 0;
  return _trkFrustum.intersectsSphere(_trkSph);
}
var _trackLastWrites = [];                // 上一帧履带偏移写入的 (InstancedMesh, 实例槽) 对(instUpdateAll 按它清零,替代全 80 槽循环)
/* 入账去重:悬挂与履带滚动对同一 (im, slot) 各写一次,重复入账会让清零循环开销翻倍(清零幂等)。 */
function _trackAccWrite(im, ix) {
  for (var i = 0; i < _trackLastWrites.length; i++)
    if (_trackLastWrites[i][0] === im && _trackLastWrites[i][1] === ix) return;
  _trackLastWrites.push([im, ix]);
}
var TRACK_HALF_W = {                     // 左右行走件中心距/2(m,差速公式用;履带车=履带中心 x,卡车=轮心 x)
  'red|tank': 1.24, 'blue|tank': 1.19,
  'red|99': 1.24, 'blue|99': 1.24,
  'red|td': 1.24, 'blue|td': 1.32 * M1_TRACK_X_SCALE,
  'red|arty': 1.10, 'blue|arty': 1.04,  // RED_MLRS 轮心 x=±1.10 / BLUE_MLRS 轮心 x=±1.04(与建模 artyWheel 同源)
  'red|aa': 1.42, 'blue|aa': 0.91      // RED_AA 履带中心 x=±1.42(2026-09-11 外移) / BLUE_AA轮心 x=±0.91(与建模同源)
};
var _trackAnimList = [];                  // 近距动态候选名单(0.5s 刷新)
var _trackAnimT = -99;                                 // 炮镜透明圆半径(vmin;与 .scope-vig CSS 对齐)
var _trackScoped = false;                           // 相机→载具 向量
/* ===== 扭杆悬挂物理(全履带车型:59/99/89/M1/M60)==============================
   每轮「扭杆弹簧 + 非对称阻尼 + 地面罚力」独立积分(War Thunder 类降阶路线);
   车体姿态仍由 alignTank 刚体贴地承担,悬挂只做轮系相对车体的动态;
   几何变形全在 GPU 顶点着色器(见 _makeHullMat),CPU 每车每帧仅产出 n+2 个标量。
   · 摆角区间 [0, π/2] = 摆臂完全竖直 ↔ 完全水平;φ0=32.16° 为自然状态(平地静止位);
   · 阻尼:压缩 ζ=0.30 / 回弹 ζ=0.60(非对称液压减振器);
     ★φ<φ0 的自由下摆区阻尼为 0 —— 减振器只覆盖承载行程,卸载/腾空的轮自由下垂;
   · 地面接触阻尼 T59S_CG:罚刚度折算到扭转后是扭杆的 14 倍,不补接触阻尼会把轮弹到限位;
   · 后坐载荷:按 recAx=cosθ/recLat=sinθ 把炮口反冲力矩注入各轮(俯仰按 z、横滚按 ±x 分配),
     与 alignTank 车体纵摇同源同拍;RCK 扣除 alignTank 已表达的份额,避免同一份力算两遍。
   输出:玩家→uSuspA0..3 uniform;近距 AI→aSusp0..3 实例属性(100m 外由 instUpdateAll 归零)。 */
var T59S_INER = 37;                                       // 轮+臂对铰点转动惯量 kg·m²
var T59S_KB   = 7800;                                     // 扭杆扭转刚度 N·m/rad(垂向轮刚度≈209kN/m)
var T59S_CD_C = 2 * 0.30 * Math.sqrt(T59S_KB * T59S_INER);   // 压缩行程阻尼 ≈322
var T59S_CD_R = 2 * 0.60 * Math.sqrt(T59S_KB * T59S_INER);   // 回弹行程阻尼 ≈645
var T59S_OMBL = 0.35;                                     // 压缩/回弹过渡带半宽(rad/s),消除 ω≈0 硬切换颤振
var T59S_PHDB = 0.05;                                     // 自由下摆区阻尼淡出带宽(rad≈2.9°)
var T59S_KG   = 3.0e6;                                    // 地面罚刚度 N/m
var T59S_MW   = 260;                                      // 每轮簧下质量 kg
var T59S_CG   = 2 * 0.5 * Math.sqrt(T59S_KG * Math.pow(SUSP_ARM_L * Math.sin(SUSP_PHI0), 2) * T59S_INER);   // 接触阻尼
var T59S_PHREF = SUSP_PHI0 + T59S_MW * 9.81 * SUSP_ARM_L * Math.sin(SUSP_PHI0) / T59S_KB;   // 扭杆自由角(预扭托一轮自重)
var T59S_PHIMIN = 0, T59S_PHIMAX = Math.PI / 2;
var T59S_RCH  = 1.05;                                     // 炮膛轴线相对铰点高度 m
var T59S_RCF0 = 135000;                                   // 后坐力真实峰值 N
var T59S_RCK  = 0.82;                                     // 残差系数(扣除 alignTank 已表达的 ≈18%)
var T59S_RCF  = T59S_RCF0 * T59S_RCK;
var T59S_SAG0 = 0.11;                                     // 静态顶行垂度
var _t59M4 = new THREE.Matrix4(), _t59V3a = new THREE.Vector3(), _t59V3b = new THREE.Vector3();
var _t59rcT = new Float32Array(14);                       // 逐轮后坐附加扭矩(scratch)
var _t59DriveT = new Float32Array(14);                   // 加减速/转向引起的逐轮载荷转移扭矩(scratch)
var _t59Out = new Float32Array(16);                       // 14 轮 Δφ + 左右垂度(4×vec4)
var SUSP_DRIVE_G = 9.81;
var SUSP_DRIVE_ACCEL_LIMIT = 12.0;                       // 约 1.22g 的视觉/载荷安全上限
var SUSP_DRIVE_LOAD_TAU = 0.085;                         // 液压载荷建立/释放时间常数
var SUSP_DRIVE_PITCH_PER_G = 0.055;                      // 约 3.2° 车体俯仰 / g
var SUSP_DRIVE_ROLL_PER_G = 0.070;                       // 约 4.0° 车体横滚 / g
function suspDriveLoad(t, dt) {
  var S = t._suspLoad;
  if (!S) S = t._suspLoad = { long: 0, lat: 0, pitch: 0, roll: 0, longAccel: 0, latAccel: 0, motionT: -Infinity };
  var nowT = typeof gameT === 'number' && isFinite(gameT) ? gameT : null;
  if (nowT != null && S.motionT === nowT) return S;
  var fx = Math.sin(t.yaw || 0), fz = Math.cos(t.yaw || 0);
  var rx = fz, rz = -fx;
  var ax = Number(t._motionAx), az = Number(t._motionAz);
  if (!isFinite(ax)) ax = 0;
  if (!isFinite(az)) az = 0;
  var aLong = ax * fx + az * fz;
  var vx = Number(t._motionVx), vz = Number(t._motionVz);
  if (!isFinite(vx)) vx = (t.speed || 0) * fx;
  if (!isFinite(vz)) vz = (t.speed || 0) * fz;
  var vLong = vx * fx + vz * fz;
  /* Local lateral acceleration includes both measured velocity change and the
     centripetal term v·yawRate.  This is the same force direction used by the
     slope/tire solver, so steering load cannot remain disconnected from the
     suspension solver. */
  var aLat = ax * rx + az * rz + vLong * (Number(t._yawRate) || 0);
  aLong = Math.max(-SUSP_DRIVE_ACCEL_LIMIT, Math.min(SUSP_DRIVE_ACCEL_LIMIT, aLong));
  aLat = Math.max(-SUSP_DRIVE_ACCEL_LIMIT, Math.min(SUSP_DRIVE_ACCEL_LIMIT, aLat));
  var step = Math.max(0, Math.min(0.08, Number(dt) || 0));
  var k = step > 0 ? 1 - Math.exp(-step / SUSP_DRIVE_LOAD_TAU) : 0;
  S.long += (aLong - S.long) * k;
  S.lat += (aLat - S.lat) * k;
  S.longAccel = aLong; S.latAccel = aLat;
  S.pitch = (S.long / SUSP_DRIVE_G) * SUSP_DRIVE_PITCH_PER_G;
  S.motionT = nowT;
  /* Positive local lateral acceleration is toward +X (right); outside-right
     wheels load up, so the body roll sign is negative in the vehicle frame. */
  S.roll = -(S.lat / SUSP_DRIVE_G) * SUSP_DRIVE_ROLL_PER_G;
  return S;
}
function _t59RecoilEnv(recT) {                            // 与 alignTank 的 rkEnv 同式(同源同拍)
  if (recT == null || recT < 0) return 0;
  var u = recT > 1.4 ? 1.4 : recT;
  return (recT < 0.085 ? recT / 0.085 : Math.exp(-(recT - 0.085) / 0.55)) * Math.sin(u / 1.4 * Math.PI);
}

/* ===== 动态路径槽位分配 =====
   玩家固定占 slot 0;AI 抢占 1..TRK_DYN_SLOTS−1。抢不到 → slot=−1 → shader 回落静态路径
   (远距/超编车视觉差异不可见,零成本)。车辆离开候选名单/阵亡时由 _trkSlotRelease 归还。 */
var _trkSlotOwner = new Array(TRK_DYN_SLOTS);
function _trkSlotAcquire(t) {
  if (t.isPlayer) { _trkSlotOwner[0] = t; return 0; }
  for (var i = 1; i < TRK_DYN_SLOTS; i++) {
    var o = _trkSlotOwner[i];
    if (!o || !o.alive || o === t) { _trkSlotOwner[i] = t; return i; }
  }
  return -1;                                          // 槽位用尽 → 回落静态
}
function _trkSlotRelease(t) {
  if (!t || !t._susp || t._susp.slot == null || t._susp.slot < 0) return;
  var i = t._susp.slot;
  if (_trkSlotOwner[i] === t) _trkSlotOwner[i] = null;
  t._susp.slot = -1;
}
function suspUpdate(t, dt) {
  /* Every ground vehicle feeds its measured acceleration and yaw rate into the
     shared suspension-load state.  Tracked vehicles additionally integrate
     per-wheel torsion bars; wheeled platforms still receive body pitch/roll. */
  var driveLoad = suspDriveLoad(t, dt);
  var key = suspKeyOf(t.team, t.kind);
  if (!key) return;                                       // 轮式/直升机无扭杆,保留车体载荷姿态
  var SP = SUSP_SPEC[key], N = SP.n, TOT = N * 2;
  var trackHalfWidth = SP.physicsTrkX || SP.trkX;
  if (dt > 0.05) dt = 0.05;                               // 滞后帧钳制
  var S = t._susp;
  if (!S || S.n !== N) {
    S = t._susp = { n: N, phi: new Float32Array(TOT), om: new Float32Array(TOT), gy: new Float32Array(TOT), at: -99 };
    for (var q = 0; q < TOT; q++) S.phi[q] = SUSP_PHI0;
  }
  var stale = (gameT - S.at) > 0.75;                      // 离开候选名单后回归:准静态重锚,零跳变
  S.at = gameT;
  /* 地面采样(每帧 2N 点):履带中心 x=±trkX / 站位 z 处世界采样,逆变换回车体局部
     (自动含 alignTank 俯仰横滚 + 后坐纵摇 → 开炮即见悬挂起伏) */
  var mw = t.group.matrixWorld;
  _t59M4.copy(mw).invert();
  var i, st;
  for (i = 0; i < TOT; i++) {
    st = i % N;
    _t59V3a.set(i < N ? -trackHalfWidth : trackHalfWidth, 0, SP.wz[st]).applyMatrix4(mw);
    _t59V3b.set(_t59V3a.x, terrainH(_t59V3a.x, _t59V3a.z), _t59V3a.z).applyMatrix4(_t59M4);
    S.gy[i] = _t59V3b.y;
    if (stale) {
      var cq = (SP.pivY - SP.rc - S.gy[i]) / SUSP_ARM_L;
      S.phi[i] = Math.max(T59S_PHIMIN, Math.min(T59S_PHIMAX, Math.acos(Math.max(-1, Math.min(1, cq)))));
      S.om[i] = 0;
    }
  }
  /* 后坐载荷 → 逐轮附加扭矩(每帧算一次,子步内视为常量)。
     符号:载荷转移 = 受载轮「更用力撑住地面」= φ 减小(φ↑ 是抬离地面);
     取反会让轮把自己收离地面 → 罚力消失 → 抵抗刚度塌陷 15 倍 → 摆角失控。 */
  var _rcE = (t.recT != null && t.recT >= 0 && t.alive) ? _t59RecoilEnv(t.recT) : 0;
  if (_rcE > 1e-4) {
    var _F = T59S_RCF * _rcE;
    var _Mp = _F * (t.recAx == null ? 1 : t.recAx) * T59S_RCH;
    var _Mr = _F * (t.recLat == null ? 0 : t.recLat) * T59S_RCH;
    for (i = 0; i < TOT; i++) {
      st = i % N;
      var fz = _Mp * SP.wz[st] / SP.sumZ2;                       // 后轮(z<0)→负=撑地
      var fx = -_Mr * (i < N ? -trackHalfWidth : trackHalfWidth) / SP.sumX2;   // 朝右开火→右侧撑地
      var fsum = fz + fx;
      if (fsum > 0) fsum *= 0.25;                                // 卸载侧钳制(防抬离地面进低刚度区)
      _t59rcT[i] = fsum * SUSP_ARM_L * Math.sin(S.phi[i]);
    }
  } else for (i = 0; i < TOT; i++) _t59rcT[i] = 0;
  /* Longitudinal acceleration/braking and lateral cornering now enter the same
     wheel torque integrator as ground contact.  A forward acceleration unloads
     the front (positive z) wheels and loads the rear; positive yaw-rate at
     forward speed loads the outside (+x) track.  The moment balance uses the
     actual mob mass and wheel geometry, rather than a visual-only pitch hack. */
  var _driveLoad = driveLoad;
  var _mass = t.mob && Number(t.mob.mass) > 0 ? Number(t.mob.mass) : 40000;
  var _cgH = Number(t._suspCgH) > 0 ? Number(t._suspCgH) : 1.20;
  _cgH = Math.max(0.65, Math.min(2.0, _cgH));
  for (i = 0; i < TOT; i++) {
    st = i % N;
    var _wheelX = i < N ? -trackHalfWidth : trackHalfWidth;
    var _longTransfer = -_mass * _driveLoad.long * _cgH * SP.wz[st] / Math.max(1e-6, SP.sumZ2);
    var _latTransfer = _mass * _driveLoad.lat * _cgH * _wheelX / Math.max(1e-6, SP.sumX2);
    _t59DriveT[i] = (_longTransfer + _latTransfer) * SUSP_ARM_L * Math.sin(S.phi[i]);
  }
  /* 子步积分(h≤1/120s) */
  var nSub = Math.min(6, Math.max(1, Math.ceil(dt * 120))), hh = dt / nSub, ss;
  for (ss = 0; ss < nSub; ss++) {
    for (i = 0; i < TOT; i++) {
      var ph = S.phi[i], sp = Math.sin(ph);
      var pen = S.gy[i] - (SP.pivY - SUSP_ARM_L * Math.cos(ph) - SP.rc);
      var omg = S.om[i], cD;
      if (omg >= T59S_OMBL) cD = T59S_CD_C;
      else if (omg <= -T59S_OMBL) cD = T59S_CD_R;
      else { var _u = (omg + T59S_OMBL) / (2 * T59S_OMBL); cD = T59S_CD_R + (T59S_CD_C - T59S_CD_R) * _u; }
      if (ph < SUSP_PHI0) { var _fd = (ph - (SUSP_PHI0 - T59S_PHDB)) / T59S_PHDB; cD *= _fd > 0 ? _fd : 0; }   // 自由下摆区无阻尼
      var tq = -T59S_KB * (ph - T59S_PHREF) - cD * omg - T59S_MW * 9.81 * SUSP_ARM_L * sp + _t59rcT[i] + _t59DriveT[i];
      if (pen > 0) {
        if (pen > 0.25) pen = 0.25;
        tq += pen * T59S_KG * SUSP_ARM_L * sp;
        if (omg > 0) tq -= T59S_CG * omg;                        // 接触阻尼只在压缩方向(单边接触不能有拉力)
      }
      var om2 = omg + tq / T59S_INER * hh;
      S.om[i] = om2 > 30 ? 30 : (om2 < -30 ? -30 : om2);
      var p3 = ph + S.om[i] * hh;
      if (p3 < T59S_PHIMIN) { p3 = T59S_PHIMIN; if (S.om[i] < 0) S.om[i] = 0; }
      else if (p3 > T59S_PHIMAX) { p3 = T59S_PHIMAX; if (S.om[i] > 0) S.om[i] = 0; }
      S.phi[i] = p3;
    }
  }
  /* 输出:14 槽 Δφ(左 0..6 / 右 7..13,不足补 0)+ 左右顶行垂度收紧量 */
  var out = _t59Out;
  for (i = 0; i < 14; i++) out[i] = 0;
  for (i = 0; i < N; i++)  out[i] = S.phi[i] - SUSP_PHI0;               // 左侧 → 槽 0..N-1
  for (i = 0; i < N; i++)  out[7 + i] = S.phi[N + i] - SUSP_PHI0;       // 右侧 → 槽 7..7+N-1
  /* 【阶段 2】顶行垂度不再用唯象拟合(旧式 acc/N*0.12,与底行伸长无守恒关系),
     改由定长求解器解出:富余长度 → 垂度。同时把定长路径写入动态纹理供 GPU 重铺。 */
  if (S.slot === undefined) S.slot = -1;
  if (S.slot < 0) S.slot = _trkSlotAcquire(t);
  if (S.slot >= 0) {
    if (!S.warm) S.warm = [0, 0];
    /* ★求解器吃的是【Δφ 增量】(相对静止角 φ0),不是绝对角 φ。
       out[0..13] 正是各轮 Δφ,直接复用;传 S.phi 会让每个轮心多转 32°,
       导致绷直长恒偏小、垂度永远顶到上限、张紧轮常年偏移(实机实测 δ=53mm)。 */
    if (!S.dph) S.dph = new Float32Array(14);
    for (var sd2 = 0; sd2 < 2; sd2++) {
      for (var w2 = 0; w2 < N; w2++) S.dph[sd2 * N + w2] = S.phi[sd2 * N + w2] - SUSP_PHI0;
    }
    if (!S.warmW) S.warmW = [null, null];
    for (var sd4 = 0; sd4 < 2; sd4++) {
      var sol = trackSolveToSlot(SP, S.dph, sd4, S.slot, S.warm[sd4], S.warmW[sd4]);
      if (sol) { S.warm[sd4] = sol.delta; S.warmW[sd4] = sol.w; out[14 + sd4] = sol.sag; }
    }
  } else {
    for (var sd3 = 0; sd3 < 2; sd3++) out[14 + sd3] = 0;                 // 无槽位 → 回落静态路径
  }
  if (t.isPlayer && t._hullMat && t._hullMat.userData.hullUniforms) {
    var U = t._hullMat.userData.hullUniforms;
    if (U.uSuspA0) {
      U.uSuspA0.value.set(out[0], out[1], out[2], out[3]);
      U.uSuspA1.value.set(out[4], out[5], out[6], out[7]);
      U.uSuspA2.value.set(out[8], out[9], out[10], out[11]);
      U.uSuspA3.value.set(out[12], out[13], out[14], out[15]);
      if (U.uTrkSlot) U.uTrkSlot.value = (S.slot != null ? S.slot : -1);   // 玩家路径槽位

    }
  } else if (t._hullInstIdx !== undefined) {
    var him = INST_MESH[_instPartKey(t._tkKey || (t._tkKey = t.team + '|' + t.kind), 'hull')];
    if (him && him.geometry.attributes.aSusp0) {
      var ix = t._hullInstIdx, o4 = ix * 4;
      var A0 = him.geometry.attributes.aSusp0.array, A1 = him.geometry.attributes.aSusp1.array,
          A2 = him.geometry.attributes.aSusp2.array, A3 = him.geometry.attributes.aSusp3.array;
      A0[o4] = out[0]; A0[o4 + 1] = out[1]; A0[o4 + 2] = out[2]; A0[o4 + 3] = out[3];
      A1[o4] = out[4]; A1[o4 + 1] = out[5]; A1[o4 + 2] = out[6]; A1[o4 + 3] = out[7];
      A2[o4] = out[8]; A2[o4 + 1] = out[9]; A2[o4 + 2] = out[10]; A2[o4 + 3] = out[11];
      A3[o4] = out[12]; A3[o4 + 1] = out[13]; A3[o4 + 2] = out[14]; A3[o4 + 3] = out[15];
      him.geometry.attributes.aSusp0.needsUpdate = true;
      him.geometry.attributes.aSusp1.needsUpdate = true;
      him.geometry.attributes.aSusp2.needsUpdate = true;
      him.geometry.attributes.aSusp3.needsUpdate = true;
      var _aI2 = him.geometry.attributes.aInstA;
      if (_aI2) {
        var _sl = (S.slot != null && S.slot >= 0) ? (S.slot + 1) : 0;
        _aI2.array[ix * 4 + 3] = (t._wxWear || 1) + _sl * 4.0;   // wear + (slot+1)*4
        _aI2.needsUpdate = true;
      }
      _trackAccWrite(him, ix);
    }
  }
}

/* ===== 履带指令带速(纯视觉状态,不反写物理) =====================================
   有行动指令(|thr|>0.05 或 |yawCmd|>0.02 且有动力)→带速 spool 趋近指令带速;
   无指令/死引擎/断油/锁止→带速跟随实际侧速;断带侧目标 0(抱死拖行,κ 照算)。
   输出 t._beltL/R(带速 m/s)+t._beltK(取大侧 signed κ)+t._beltKSide(±1)。帧哨兵防一日两更。 */
var TRK_BELT_ON = 1;
var TRK_SPOOL_TAU = 0.28;
var TRK_DIG_K0 = 0.25, TRK_DIG_K1 = 0.75, TRK_DIG_VREF = 2.0;
function beltKappa(belt, side) {
  var d = Math.abs(belt) > Math.abs(side) ? Math.abs(belt) : Math.abs(side);
  if (d < TRK_DIG_VREF) d = TRK_DIG_VREF;
  return (belt - side) / d;
}
function beltUpdate(t, dt, halfW) {
  if (!t) return;
  var _gt = (typeof gameT === 'undefined') ? -1 : gameT;
  if (_gt >= 0 && t._beltT === _gt) return;
  t._beltT = _gt;
  if (typeof isHeliVehicle === 'function' && isHeliVehicle(t)) return;
  var hw = halfW || (TRACK_HALF_W[t.team + '|' + t.kind] || 1.24);
  var thr = t._throttle || 0;
  var hasTurnCmd = !(t._turnCmd === undefined || t._turnCmd === null);
  var yawCmd = hasTurnCmd ? t._turnCmd : (t._yawRate || 0);
  if (t._throttleLock) { thr = 0; yawCmd = 0; }
  var cmdActive = Math.abs(thr) > 0.05 || (hasTurnCmd && Math.abs(t._turnCmd) > 0.02);   // 回落值不自激活:无指令=跟随实际(旧行为)
  var powered = true, hasMods = !!t.mods;
  if (hasMods) {
    if (typeof engineEff === 'function' && engineEff(t) < 0.05) powered = false;
    if (typeof fueled === 'function' && !fueled(t)) powered = false;
  }
  var useCmd = TRK_BELT_ON && cmdActive && powered;
  var v0 = t.speed0 || 10, sm = (hasMods && typeof speedMult === 'function') ? speedMult(t) : 1;
  var vDem = useCmd ? thr * v0 * sm : 0;
  var yrA = t._yawRate || 0, spd = t.speed || 0;
  var vSideL = spd + yrA * hw, vSideR = spd - yrA * hw;
  var tgtL = useCmd ? vDem + yawCmd * hw : vSideL;
  var tgtR = useCmd ? vDem - yawCmd * hw : vSideR;
  if (hasMods) {
    if (t.mods.trackL.hp <= 0) tgtL = 0;
    if (t.mods.trackR.hp <= 0) tgtR = 0;
  }
  if (t._beltL === undefined) t._beltL = vSideL;
  if (t._beltR === undefined) t._beltR = vSideR;
  var k = dt > 0 ? Math.min(1, dt / TRK_SPOOL_TAU) : 0;
  t._beltL += (tgtL - t._beltL) * k;
  t._beltR += (tgtR - t._beltR) * k;
  var kL = beltKappa(t._beltL, vSideL), kR = beltKappa(t._beltR, vSideR);
  if (Math.abs(kR) > Math.abs(kL)) { t._beltK = kR; t._beltKSide = 1; }
  else { t._beltK = kL; t._beltKSide = -1; }
}
// 统一处理玩家/AI 的差速 + HP 门控;玩家写 uTrackOffL/uTrackOffR uniform,AI 仅算 _trackOffL/_trackOffR(由调用方写实例属性)
function _trackDifferential(t, dt) {
  var tk = t.team + '|' + t.kind;
  var halfW = TRACK_HALF_W[tk] || 1.24;
  // 指令带速:有行动指令→履带按指令转(爬坡卡死照样飞转);TRK_BELT_ON=0 回旧 t.speed 口径
  var vL, vR;
  if (typeof TRK_BELT_ON !== 'undefined' && !TRK_BELT_ON) {
    // —— 旧路(回滚用):转向角速度从 yaw 增量推导(±π 归一化 + stale 钳制防重入候选名单时跳变) ——
    var prev = t._trackPrevYaw !== undefined ? t._trackPrevYaw : t.yaw;
    var dy = t.yaw - prev;
    if (dy > Math.PI) dy -= 2 * Math.PI; else if (dy < -Math.PI) dy += 2 * Math.PI;
    if (Math.abs(dy) > 0.3) dy = 0;                      // stale(重入动画集)→ 本帧无转向
    t._trackPrevYaw = t.yaw;
    var turnRate = dt > 0 ? dy / dt : 0;
    // 差速:trackL(-X 侧)= speed + turnRate*halfW;trackR(+X 侧)= speed - turnRate*halfW
    vL = t.speed + turnRate * halfW;
    vR = t.speed - turnRate * halfW;
  } else {
    if (typeof beltUpdate === 'function') beltUpdate(t, dt, halfW);   // 带速 spool(帧哨兵,视觉链一日一更)
    vL = t._beltL || 0; vR = t._beltR || 0;   // trackL(-X 侧)/trackR(+X 侧)均吃指令带速
  }
  // HP 门控:该侧履带 hp<=0 → 冻结(不累积),保留最后偏移
  if (t.mods.trackL.hp > 0) t._trackOffL = (t._trackOffL || 0) + vL * dt / TREAD_PERIOD;
  if (t.mods.trackR.hp > 0) t._trackOffR = (t._trackOffR || 0) + vR * dt / TREAD_PERIOD;
  /* 分段履带板滚动量按「米」累计(板沿环路真实前进),与上面的 UV 偏移是两套量纲。
     同一套差速 vL/vR 与 HP 门控;取模防长时间行驶后浮点精度流失(环路周期性,无视觉跳变)。 */
  var _sk2 = suspKeyOf(t.team, t.kind);
  if (_sk2) {
    var _L59 = SUSP_ATLAS_LEN[SUSP_ROW[_sk2]] || 1;
    if (t.mods.trackL.hp > 0) t._t59RollL = (((t._t59RollL || 0) + vL * dt) % _L59 + _L59) % _L59;
    if (t.mods.trackR.hp > 0) t._t59RollR = (((t._t59RollR || 0) + vR * dt) % _L59 + _L59) % _L59;
  } else if (t.kind === 'arty' || (t.kind === 'aa' && t.team === 'blue')) {
    /* 卡车轮转子(模式 18)滚动量:同差速 vL/vR 与断轮冻结,按轮周长取模(自转角 θ=roll/R,整周取模零视觉跳变,保 float 精度)。
       蓝方BLUE_AA(悍马 4×4)同走本通道:轮周长 2πR0.465(AV_WHEEL_SPEC 同源)。 */
    var _LC = (t.kind === 'aa') ? AV_WHEEL_CIRC
      : ((typeof ARTY_WHEEL_CIRC_OF !== 'undefined' && ARTY_WHEEL_CIRC_OF[t.team]) ? ARTY_WHEEL_CIRC_OF[t.team] : 3.3616);   // 分阵营轮周长(RED_MLRS R0.535/BLUE_MLRS R0.590)
    if (t.mods.trackL.hp > 0) t._t59RollL = (((t._t59RollL || 0) + vL * dt) % _LC + _LC) % _LC;
    if (t.mods.trackR.hp > 0) t._t59RollR = (((t._t59RollR || 0) + vR * dt) % _LC + _LC) % _LC;
  }
  // 玩家车写 uniform(AI 由调用方写实例属性)
  if (t.isPlayer && t._hullMat && t._hullMat.userData.hullUniforms) {
    var _hu = t._hullMat.userData.hullUniforms;
    if (_hu.uTrackOffL) { _hu.uTrackOffL.value = t._trackOffL || 0; _hu.uTrackOffR.value = t._trackOffR || 0; }
    if (_hu.uT59RollL) { _hu.uT59RollL.value = t._t59RollL || 0; _hu.uT59RollR.value = t._t59RollR || 0; }
  }
}
function trackAnimUpdate(dt) {
  _wxUniforms().uWxNow.value = _wxNowSec();   // ★优化H: 会话时钟(战损延迟锈龄期基准; 每帧一次 float 写, 非重烘焙)
  if (!player || !player.alive) return;
  // 玩家车:差速 + HP 门控 → uTrackOffL/uTrackOffR + uT59RollL/uT59RollR(开镜时车体已隐藏,无害;非履带车 suspUpdate 内部自跳过)
  _trackDifferential(player, dt);
  suspUpdate(player, dt);                               // 扭杆悬挂(玩家;非履带车内部自跳过)
  // scoped 状态切换 → 立即刷新候选名单(避免 0.5s 滞后用错名单)
  if (scoped !== _trackScoped) { _trackScoped = scoped; _trackAnimT = -99; }
  // 0.5s 刷新候选名单
  if (gameT - _trackAnimT > 0.5) {
    _trackAnimT = gameT;
    _trackAnimList.length = 0;
    if (scoped) {
      // 炮镜模式:整个屏幕画面内的 AI 车无视距离加入(通用全屏矩形门 map.js scopeScreenVisible;
      // 4m 余量覆盖车体半长,压画面边缘的车履带照常滚动),完全在画面外才不加入(静止)
      for (var i = 0; i < aliveList.length; i++) {
        var t = aliveList[i];
        if (t.isPlayer) continue;
        var tp = t.group.position;
        if (typeof scopeScreenVisible !== 'function' || scopeScreenVisible(tp.x, tp.y + 1.0, tp.z, 4)) _trackAnimList.push(t);
      }
    } else {
      // 常规模式:玩家周围 100m 内、且处于屏幕画面内的 AI 车(距离门 + 视锥门,缺一不可;
      // 4m 余量覆盖车体半长,压画面边缘的车照常滚动;画面外/100m 外 → 非候选 → 静止)
      _trkFrustumUpdate();
      var pp = player.group.position;
      for (var i2 = 0; i2 < aliveList.length; i2++) {
        var t2 = aliveList[i2];
        if (t2.isPlayer) continue;
        var tp2 = t2.group.position;
        var _rw2 = (t2.kind === 'arty' || (t2.kind === 'aa' && t2.team === 'blue')) ? WHEEL_ANIM_RADIUS : TRACK_ANIM_RADIUS;   // ★任务27⑦:轮式 500m/履带 100m
        if (tp2.distanceTo(pp) < _rw2 && _trkInView(tp2.x, tp2.y + 1.0, tp2.z, 4)) _trackAnimList.push(t2);
      }
    }
  }
  // AI 候选车:差速 + HP 门控 + 扭杆悬挂 → aInstA.xy / aSusp0..3(非候选车由 instUpdateAll 归零=静止)
  _trackLastWrites.length = 0;                            // 重建本帧活跃写入账(instUpdateAll 下一帧按它清零)
  for (var j = 0; j < _trackAnimList.length; j++) {
    var ti = _trackAnimList[j];
    if (!ti.alive || ti._hullInstIdx === undefined) continue;
    var tk = ti.team + '|' + ti.kind;
    _trackDifferential(ti, dt);                         // 计算 ti._trackOffL/R 与 _t59RollL/R
    suspUpdate(ti, dt);                                 // 扭杆悬挂(近距 AI;内部自写 aSusp0..3)
    var him = INST_MESH[tk + '|hull'];
    if (him && him.geometry.attributes.aInstA) {
      var _o4t = ti._hullInstIdx * 4;
      /* .xy has model-specific meaning: tread travel for tracked vehicles and UV offset for other vehicles. */
      var _isSeg = !!suspKeyOf(ti.team, ti.kind) || ti.kind === 'arty' || (ti.kind === 'aa' && ti.team === 'blue');
      him.geometry.attributes.aInstA.array[_o4t]     = (_isSeg ? ti._t59RollL : ti._trackOffL) || 0;
      him.geometry.attributes.aInstA.array[_o4t + 1] = (_isSeg ? ti._t59RollR : ti._trackOffR) || 0;
      _trackAccWrite(him, ti._hullInstIdx);              // 活跃写入入账(去重)
      him.geometry.attributes.aInstA.needsUpdate = true;
    }
  }
}

/* ============================================================
   命中壳阴影代理(阴影只对命中判定外形投影,不考虑装饰物)——
   首个 (team,kind) 车建造时把全部命中壳按父级分组(group/turret/gunPivot)烘焙成三块共享几何;
   阴影 pass 只渲染这些粗壳 InstancedMesh(投影外形=判定外形),装饰视觉流 castShadow 全关。
   代理网格主通道材质 colorWrite/depthWrite 全关=零视觉贡献,阴影 pass 由深度材质覆写正常投影。
   ============================================================ */
var INST_SH_TPL = {};                    // key=team|kind → {hull,turret,gun} 命中壳烘焙几何
var INST_SH_MESH = {};                   // key=team|kind|sh+part → InstancedMesh(castShadow)
var shadowProxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
shadowProxyMat.fog = false;              // 主通道零输出:不写色不写深,不遮挡不参与雾

/* 阴影模板烘焙统一走 core.mergeGeometries(只 position+index+顺序补索引+_shared 标记) */
/* 首个 (team,kind) 车:命中壳按父级分组烘焙模板;后续同型号直接复用 */
function instShadowBuildTemplate(t) {
  var key = t.team + '|' + t.kind;
  if (INST_SH_TPL[key]) return INST_SH_TPL[key];
  var lists = { hull: [], turret: [], gun: [] }, i, m;
  for (i = 0; i < t.modMeshes.length; i++) {
    m = t.modMeshes[i];
    if (!m || !m.geometry || !m.geometry.attributes.position) continue;
    m.updateMatrix();                    // 本地位姿定格进烘焙矩阵
    if (m.parent === t.group) lists.hull.push(m);
    else if (m.parent === t.turret) lists.turret.push(m);
    else if (m.parent === t.gunPivot) lists.gun.push(m);
  }
  var tpl = {};
  for (var bk in lists) if (lists[bk].length) {
    var jobs = [];
    for (var ji = 0; ji < lists[bk].length; ji++) {
      var _m4 = lists[bk][ji].matrix.clone();
      if (bk === 'hull') {
        _m4.elements[13] += 0.04; // 履带与车体底面阴影代理向上微抬 4cm,根除碰撞盒贴地共面穿模产生的锯齿伪影
      }
      jobs.push({ geo: lists[bk][ji].geometry, m4: _m4 });
    }
    tpl[bk] = mergeGeometries(jobs, false, true, true);   // 阴影深度 pass 只要 position+index;模板禁销毁
  }
  INST_SH_TPL[key] = tpl;
  return tpl;
}

function instEnsureShadowMesh(team, kind, part, geo) {
  var key = team + '|' + kind + '|sh' + part;
  if (INST_SH_MESH[key]) return INST_SH_MESH[key];
  var im = new THREE.InstancedMesh(geo, shadowProxyMat, INST_CAP);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.frustumCulled = false;
  im.count = 0;
  im.castShadow = true; im.receiveShadow = false;   // 唯一职责:进阴影深度 pass
  im.userData.instPart = 'shadow-' + part;
  scene.add(im);
  INST_SH_MESH[key] = im;
  return im;
}

/* createTank 尾部调用:烘焙(首车)+注册阴影实例桶 */
function instShadowRegister(t) {
  var tpl = instShadowBuildTemplate(t);
  for (var pk in tpl) if (tpl[pk] && tpl[pk].isBufferGeometry) instEnsureShadowMesh(t.team, t.kind, pk, tpl[pk]);
}
