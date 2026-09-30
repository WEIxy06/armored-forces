
/* ===== Module: core_util.js ===== */
/* ============================================================
   模块: core_util.js — core 通用工具(数学/RNG/几何合并/池/避障/弹道口径)
   (本模块通用部分,须先于 core.js 加载;加载顺序由 index.html MODULES 表决定)
   ============================================================ */
'use strict';

/* ===== 工具 ===== */
var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

/* 地面棋盘格三角剖分口径(物理/视觉唯一真源):
   scene.js 地面网格按 (ix+iz)&1 交替选用格内对角线;terrainH 必须用同一奇偶做格内三角插值。
   0=偶格(反对角线 qc–qb),1=奇格(主对角线 qa–qd);调用方只传非负格索引。 */
function groundCellParity(ix, iz) { return (ix + iz) & 1; }

/* 画质档字段读取器(爆炸特效专项 E1/E2 的唯一取值入口,见 docs/安卓端性能优化方案.md 附录 B)。
   为什么要这个函数而不是各处直接写 GFX.xxx:
     ① 加载顺序——audio.js / weapons.js 在 index.html 里排在 scene.js **之前**,
        它们的模块顶层读不到 GFX;但它们的函数是对局中才调用的,那时 GFX 早已就位。
        统一走惰性读取,就不必为"谁先加载"操心,也杜绝了"某处忘了取档位"的散落字面量。
     ② 无头/回归环境没有 GFX(sandbox 只注入被测符号),必须有兜底默认值。
   约定:dflt 一律填**高档(优化前)原值** ⇒ 取不到档位时行为与改动前逐参数一致。 */
function gfxFx(key, dflt) {
  if (typeof FXQ !== 'undefined' && FXQ && FXQ[key] !== undefined) return FXQ[key];   // 爆炸独立档优先:画质档不再影响爆炸质量
  if (typeof GFX !== 'undefined' && GFX && GFX[key] !== undefined) return GFX[key];
  return dflt;
}

/* ============================================================
   爆炸效果独立档(FXQ)——与画质档(GFX)完全解耦(2026-09-13 用户需求)。
   · 三档:high = 原画质"中"的爆炸质量;mid = 原画质"低"的爆炸质量(2026-09-13 由旧"低"改名,
     数值逐项相等);low = 新增救急档(见下)。
     high/mid 数值逐项抄自 scene.js GFX_PRESETS.mid/low 的 fx* 字段,两处必须一致,
     由 android/tools/verify_fx_perf.js 逐项钉死,改一处不改另一处立刻红。
   · 判定优先级:?fxq=high|mid|low 查询串 > localStorage.prefFxQuality > 迁移默认。
     迁移默认:已存画质偏好是 low 则默认 mid(保持旧低档体验=新中);旧存档 'low' 首次加载
     改写为 'mid'。其余:触屏(安卓)默认 low,桌面默认 high(★2026-09-13 安卓默认爆炸低)。
   · 重启生效:爆炸贴图在加载期一次烘焙(CB_BIG_TEX),池并发上限在模块加载期快照,
     与画质档同理,不做运行中热切换(热切要重建全部特效池+重传纹理,不值得)。
   · GFX 表里的 fx* 字段保留不动:① 无头/回归 sandbox 里 FXQ 不存在时仍是兜底;
     ② 桌面高画质原来的"完整爆炸质量"数值仍在表里留档(运行时不再到达,
     见 docs/安卓端性能优化方案.md 附录 B.11)。
   ============================================================ */
var FXQ_PRESETS = {
  high: { fxDistMax: 1.8, fxYieldMax: 1.4, fxGroundLight: false, fxSatHi: 5,  fxSatLo: 3, fxHardMax: 10,
          fxWreckSmoke: 48, fxSmokeR: 420, fxBigTex: 512, fxTrailAdapt: true, fxBurstMerge: 3, fxBurstDedup: true, fxSfxMerge: true },
  mid:  { fxDistMax: 1.5, fxYieldMax: 1.2, fxGroundLight: false, fxSatHi: 3,  fxSatLo: 2, fxHardMax: 6,
          fxWreckSmoke: 24, fxSmokeR: 300, fxBigTex: 512, fxTrailAdapt: true, fxBurstMerge: 2, fxBurstDedup: true, fxSfxMerge: true },
  low:  { fxDistMax: 1.2, fxYieldMax: 1.0, fxGroundLight: false, fxSatHi: 2,  fxSatLo: 1, fxHardMax: 4,
          fxWreckSmoke: 12, fxSmokeR: 220, fxBigTex: 256, fxTrailAdapt: true, fxBurstMerge: 1, fxBurstDedup: true, fxSfxMerge: true }
};
/* ★2026-09-13 改三档:旧"低"改名"中"(数值逐项相等),新增更低的"低"(救急档)。
   新低每项都比中更紧:距离放大 1.5→1.2(单卡面积 ×0.64)、当量上限 1.2→1.0(M142
   贴图不再放大)、并发 3/2→2/1、硬顶 6→4、残骸烟 24→12 柱/半径 300→220m、
   贴图 512²→256²(显存 6MB→1.5MB,火球边缘明显糊,救急档接受)、同帧殉爆 2→1。
   峰值混合层面积相对原高完整≈1.4%(高≈8%,中≈3%),中→低再降一半。
   旧存档语义迁移:已存 'low' == 新"中",首次加载时一次性改写为 'mid'(写失败则
   每次读时映射,见下),存量用户体验零变化;?fxq=low 从此指新低档。 */
var FXQ_PROFILE = (function () {
  var qs = (typeof window !== 'undefined' && window.location) ? (window.location.search || '') : '';
  var m = /[?&]fxq=(high|mid|low)\b/.exec(qs);
  if (m) return m[1];
  try {
    var s = localStorage.getItem('prefFxQuality');
    if (s === 'low') { try { localStorage.setItem('prefFxQuality', 'mid'); } catch (e2) {} return 'mid'; }
    if (FXQ_PRESETS[s]) return s;
    if (localStorage.getItem('prefGfxProfile') === 'low') return 'mid';   // 迁移默认:画质救急档用户保持旧低档体验(=新中)
  } catch (e) {}
  var touch = false;
  try { touch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window; } catch (e3) {}
  return touch ? 'low' : 'high';   // ★移动端适配恢复:安卓(触屏)默认爆炸低,桌面默认高
})();
var FXQ = FXQ_PRESETS[FXQ_PROFILE];

/* ============================================================
   模型质量独立档(MODQ)——从画质档(GFX)里分离出来(2026-09-13 用户需求)。
   管辖范围:两个 3D 模型预览器(整备机库展示 + 炮塔 HUD 迷你窗)的质量旋钮,
   即原画质三档里与"模型"有关的那几项;像素比/阴影/模板/后处理等其余画质内容不动,
   仍归画质档。
   三档取值 = 原画质三档的模型精度(逐项照搬,见下表;由 verify_android_fixes.js M 组钉死):
     高: 机库 MSAA 开 + 像素比≤2 + 阴影 2048²PCFSoft;炮塔小窗 MSAA 开 + 漫画后处理开
     中: 机库 MSAA 关 + 像素比≤1.5 + 阴影 1024²PCF;炮塔小窗 MSAA 关 + 后处理关
     低: 机库 MSAA 关 + 像素比≤1.0 + 阴影 1024²PCF;炮塔小窗 MSAA 关 + 后处理关
     (中/低在小窗侧本来就无差别——原版即如此,此处照搬不发明;差异只在机库像素比。
      详见 docs/安卓端性能优化方案.md 附录 B.12。)
   判定优先级:?modq=high|mid|low 查询串 > localStorage.prefModQuality > 迁移默认。
   迁移默认:已存画质偏好是 low 则默认 low(同 FXQ 的理由,保最弱机器);否则一律默认
   high(★2026-09-13 起安卓默认模型高,不再按设备区分)。
   重启生效:机库/PHUD 渲染器都是一次性创建的(创建期读档),与画质档同理不做热切换。
   GFX 表里的 hudAA/hudPost 原样保留:① sandbox 无 MODQ 时的兜底语义不变;
   ② 万一漏改某处消费方,行为回落到改动前而不是崩(改动前后对照见 M 组)。
   ============================================================ */
var MODQ_PRESETS = {
  high: { modAA: true,  modPost: true,  modPR: 2,   modShadow: 2048, modShadowSoft: true,
          modSunMap: 1024, modSunSoft: true },
  mid:  { modAA: false, modPost: false, modPR: 1.5, modShadow: 1024, modShadowSoft: false,
          modSunMap: 512,  modSunSoft: false },
  low:  { modAA: false, modPost: false, modPR: 1.0, modShadow: 1024, modShadowSoft: false,
          modSunMap: 512,  modSunSoft: false }
};
/* ★2026-09-13 追加:主场景太阳阴影(modSunMap/modSunSoft)也归模型质量档——
   对局内载具质感(自投影/接地)几乎全看这盏灯的阴影,而几何本就没有分档,
   "模型质量不管对局内载具"就只剩机库自嗨。原值:高 1024²PCFSoft / 中低 512²PCF,
   三档行为逐位不变;画质档保留像素比/模板。GFX 表的 shadowMapSize/shadowSoft
   原样保留作 sandbox 兜底与数值留档,运行时不再被读。 */
var MODQ_PROFILE = (function () {
  var qs = (typeof window !== 'undefined' && window.location) ? (window.location.search || '') : '';
  var m = /[?&]modq=(high|mid|low)\b/.exec(qs);
  if (m) return m[1];
  try {
    var s = localStorage.getItem('prefModQuality');
    if (MODQ_PRESETS[s]) return s;
    if (localStorage.getItem('prefGfxProfile') === 'low') return 'low';   // 迁移默认:画质救急档用户不被默认抬档
  } catch (e) {}
  /* ★移动端适配恢复(P0-①):触屏设备默认降回「中」——太阳阴影 1024²PCFSoft 是移动填充率头号消耗源;
     用户显式选择(?modq= / 设置页)仍完全尊重。桌面默认高,逐位不变。 */
  var _mqTouch = false;
  try { _mqTouch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window; } catch (e2) {}
  return _mqTouch ? 'mid' : 'high';
})();
var MODQ = MODQ_PRESETS[MODQ_PROFILE];
/* 模型质量取值器(gfxFx 同构:惰性读取,无头/sandbox 无 MODQ 时回落默认值=高档原值)。 */
function modQ(key, dflt) {
  if (typeof MODQ !== 'undefined' && MODQ && MODQ[key] !== undefined) return MODQ[key];
  return dflt;
}

/* 2D 画布创建的统一入口(全部程序化贴图共用)。
   一处收口三件事:无 DOM 环境(SSR / 无头自检)返回 null、getContext 不可用返回 null、尺寸设定。
   返回 { cv, g };调用方只需判一次 null。 */
function make2DCanvas(size) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  var cv = document.createElement('canvas');
  if (!cv || typeof cv.getContext !== 'function') return null;
  cv.width = cv.height = size;
  var g = cv.getContext('2d');
  return g ? { cv: cv, g: g } : null;
}

var rand  = function (a, b) { return a + Math.random() * (b - a); };

var TAU = Math.PI * 2;

function mulberry32(seed) {              // 独立种子随机(由 map 模块上移,音频烘焙/地面贴图/战斗流亦用;不占战斗 RNG 流)
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normAng(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }

/* 地形换肤共用公式(地面分块/远景丘陵/换肤三处同口径,防配色漂移):
   干燥度:低处湿/高处干;坡度因子:陡坡→岩色 */
function terrainDry(h)   { return clamp((h + 4) / 10, 0, 1); }

function terrainSteep(nY) { return clamp((1 - nY) * 5, 0, 1); }

/* ============================================================
   P1 · 地貌分区权重场(颜色层) —— 由 biome-p0-debug.html 验证后移植
   ------------------------------------------------------------
   要点(全部经无头实测,勿凭直觉改):
   (1) 覆盖性下界 R >= cell*(1/sqrt(3)+jitter)。低于此值存在"无锚点覆盖"的空洞,
       归一化分母为 0 → 退化兜底 → 权重 0<->1 硬跳变(车辆过界瞬间变色)。已自动钳位。
   (2) 域扭曲波长必须远大于幅度, 否则坐标映射非单射(空间自我折叠), 权重梯度暴涨成"假硬边"。
       实测 波长10m/幅度36m → 梯度 1.77/m(0.6m 内 0→1)。现取 波长=胞元、幅度<=0.22*胞元。
   (3) 过渡带最窄处须 >= 4*GRID_CELL, 否则顶点网格采样不到平滑斜坡 → 退化成锯齿硬边。
       默认 胞元=side/10、jitter .12、R .72 在 2km 图上过渡带约 23m = 8.3x 格距。
   (4) 本层只驱动"颜色/贴图", 不参与 terrainH。P1 零物理风险。
   ============================================================ */
var BIOMES = [
  /* g=湿(低地)色 d=干(高地)色 r=陡坡岩色  tex: 0=植被质感 1=土质 2=岩质
     rock/veg = 属性空间坐标(锚点指派用)。草原/沃土在此降级为普通两项。 */
  /* ★调色板亮度必须挤在同一窄带内(实测湿态极差 0.094、干态 0.108)。
     依据:漫画描边阈值 edgeL = smoothstep(0.11, 0.28, lumMag)。任意两地貌亮度差若落进
     [0.11, 0.28) 就会沿地貌边界描出断续脏边并随视角闪烁。初版沃土过暗(L=0.186),
     与干草原/沙土等 7 对组合全部踩进危险带 —— 已整体压缩亮度、改用"色相"而非"明度"区分。
     区分度由色相承担:草原偏绿、沃土偏红棕、沙土偏黄、砾石/裸岩近中性灰、石楠偏灰绿。 */
  { id:'grass', name:'DRY GRASSLAND',   tex:0, rock:0.20, veg:0.85,
    g:[0.365,0.425,0.275],d:[0.500,0.480,0.320],r:[0.455,0.450,0.415] },
  { id:'soil',  name:'FERTILE SOIL',     tex:1, rock:0.25, veg:0.45,
    g:[0.360,0.300,0.225],d:[0.470,0.395,0.285],r:[0.400,0.360,0.320] },
  { id:'sand',  name:'SANDY GOBI', tex:1, rock:0.35, veg:0.12,
    g:[0.430,0.395,0.285],d:[0.560,0.510,0.370],r:[0.470,0.440,0.375] },
  { id:'gravel',name:'GRAVEL',   tex:2, rock:0.70, veg:0.18,
    g:[0.385,0.380,0.360],d:[0.495,0.487,0.458],r:[0.450,0.445,0.432] },
  { id:'scrub', name:'SCRUB HILLS', tex:0, rock:0.40, veg:0.62,
    g:[0.330,0.400,0.268],d:[0.462,0.463,0.325],r:[0.430,0.425,0.385] },
  { id:'rock',  name:'CLIFF ROCK', tex:2, rock:0.92, veg:0.08,
    g:[0.352,0.345,0.335],d:[0.450,0.440,0.425],r:[0.398,0.393,0.383] },
  { id:'heath', name:'HEATH HIGHLAND', tex:0, rock:0.55, veg:0.50,
    g:[0.330,0.365,0.318],d:[0.445,0.443,0.372],r:[0.418,0.414,0.398] }
];
var BIOME_N = BIOMES.length;
var BQ = { A:null, cell:0, R:0, R2:0, gx:0, gz:0, origin:0,
           warpAmp:0, warpFq:0, nWx:null, nWz:null, ready:false };
var BIOME_CELLS = 10, BIOME_JITTER = 0.12, BIOME_RR = 0.72, BIOME_WARP = 0.16;

function _bValNoise(seed) {              // 平滑值噪声(域扭曲用)
  var P = new Float32Array(256), rnd = mulberry32(seed);
  for (var i = 0; i < 256; i++) P[i] = rnd();
  function at(ix, iz) { return P[(((ix & 15) * 16) + (iz & 15)) & 255]; }
  return function (x, z) {
    var fx = Math.floor(x), fz = Math.floor(z), tx = x - fx, tz = z - fz;
    tx = tx * tx * (3 - 2 * tx); tz = tz * tz * (3 - 2 * tz);
    var a = at(fx, fz), b = at(fx + 1, fz), c = at(fx, fz + 1), d = at(fx + 1, fz + 1);
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  };
}
function biomeRebuild() {                // 抖动三角栅格锚点 + 属性空间最近邻指派
  var side = MAP.side, seedN = hashSeed(String(MAP.seed) + '|biome') >>> 0;
  var rnd = mulberry32(seedN);
  var cell = side / BIOME_CELLS;
  var rMin = cell * (1 / Math.sqrt(3) + BIOME_JITTER);
  var R = Math.max(cell * BIOME_RR, rMin);
  var margin = 2;
  var gx = Math.ceil(side / cell) + margin * 2;
  var gz = Math.ceil(side / (cell * 0.8660254)) + margin * 2;
  var origin = -side / 2 - margin * cell;
  /* 属性场:两张低频值噪声(硬度/植被)。
     ★不可用 sin*cos 乘积:两个 [-1,1] 的积强烈向 0 集中,rk/vg 几乎全落在 0.5 附近,
       最近邻指派的结果是"中心地貌垄断" —— 实测 7 种只出 3~4 种、单种占比达 68%。
     ★改用 秩归一化(rank-normalise):把两轴各自排序后线性映射到 [0,1],
       得到严格均匀的属性分布, 再做最近邻指派 → 7 种必定全部出现, 单种占比降到 20~29%。
       这是"配额"的无参数实现, 且完全确定性(同种子同结果)。 */
  var nR = _bValNoise(seedN ^ 0x1111), nV = _bValNoise(seedN ^ 0x2222);
  var F = 1 / (cell * 2.2);              // 特征尺度 ≈ 2 个胞元 → 同类地貌成片而非椒盐
  var pts = [];
  for (var jz = 0; jz < gz; jz++) for (var jx = 0; jx < gx; jx++) {
    var ox = (jz & 1) ? cell * 0.5 : 0;
    var px = origin + jx * cell + ox + (rnd() - 0.5) * 2 * BIOME_JITTER * cell;
    var pz = origin + jz * cell * 0.8660254 + (rnd() - 0.5) * 2 * BIOME_JITTER * cell;
    var q = pz;                          // ★场景v1:已取消南北镜像——锚点属性随真实坐标采样,南北生境(地貌/颜色带)各异
    pts.push({ x: px, z: pz, rk: nR(px * F, q * F), vg: nV(px * F + 31.7, q * F + 11.3), rkN: 0, vgN: 0, b: 0 });
  }
  var nP = pts.length, ii;
  var byR = pts.slice().sort(function (a, b2) { return a.rk - b2.rk; });
  for (ii = 0; ii < nP; ii++) byR[ii].rkN = ii / (nP - 1);
  var byV = pts.slice().sort(function (a, b2) { return a.vg - b2.vg; });
  for (ii = 0; ii < nP; ii++) byV[ii].vgN = ii / (nP - 1);
  var A = [];
  for (ii = 0; ii < nP; ii++) {
    var P0 = pts[ii], best = 0, bd = 1e9;
    for (var k = 0; k < BIOME_N; k++) {
      var dr = BIOMES[k].rock - P0.rkN, dv = BIOMES[k].veg - P0.vgN, dd = dr * dr + dv * dv;
      if (dd < bd) { bd = dd; best = k; }
    }
    A.push({ x: P0.x, z: P0.z, b: best });
  }
  BQ.A = A; BQ.cell = cell; BQ.R = R; BQ.R2 = R * R;
  BQ.gx = gx; BQ.gz = gz; BQ.origin = origin;
  BQ.warpAmp = cell * Math.min(BIOME_WARP, 0.22);
  BQ.warpFq = 1 / cell;
  BQ.nWx = _bValNoise(seedN ^ 0x9e37); BQ.nWz = _bValNoise(seedN ^ 0x85eb);
  BQ.ready = true;
}
var _bwTmp = new Float32Array(8);
function biomeWeightsAt(x, z, out) {     // 归一化稀疏卷积,恒有 sum(w)=1
  var k;
  for (k = 0; k < BIOME_N; k++) out[k] = 0;
  if (!BQ.ready) { out[0] = 1; return 1; }
  var wx = x, wz = z;
  if (BQ.warpAmp > 0) {                  // 两轴均用原始坐标取样(勿耦合)
    var f = BQ.warpFq;
    wx = x + (BQ.nWx(x * f + 2.5, z * f + 8.1) - 0.5) * 2 * BQ.warpAmp;
    wz = z + (BQ.nWz(x * f + 17.3, z * f + 41.7) - 0.5) * 2 * BQ.warpAmp;
  }
  var cell = BQ.cell, rowH = cell * 0.8660254;
  var jz0 = Math.floor((wz - BQ.origin - BQ.R) / rowH), jz1 = Math.ceil((wz - BQ.origin + BQ.R) / rowH);
  var tot = 0, n = 0, A = BQ.A, gx = BQ.gx;
  for (var jz = jz0; jz <= jz1; jz++) {
    if (jz < 0 || jz >= BQ.gz) continue;
    var ox = (jz & 1) ? cell * 0.5 : 0;
    var jx0 = Math.floor((wx - BQ.origin - ox - BQ.R) / cell), jx1 = Math.ceil((wx - BQ.origin - ox + BQ.R) / cell);
    for (var jx = jx0; jx <= jx1; jx++) {
      if (jx < 0 || jx >= gx) continue;
      var a = A[jz * gx + jx];
      var dx = a.x - wx, dz = a.z - wz, d2 = dx * dx + dz * dz;
      if (d2 >= BQ.R2) continue;
      var t = BQ.R2 - d2, w = t * t;
      out[a.b] += w; tot += w;
    }
  }
  if (tot <= 1e-20) {                    // 退化兜底(钳位后理论不可达)
    var bi = 0, bd = 1e9;
    for (var q2 = 0; q2 < A.length; q2++) {
      var ddx = A[q2].x - wx, ddz = A[q2].z - wz, dd2 = ddx * ddx + ddz * ddz;
      if (dd2 < bd) { bd = dd2; bi = A[q2].b; }
    }
    out[bi] = 1; return 1;
  }
  var inv = 1 / tot;
  for (k = 0; k < BIOME_N; k++) { out[k] *= inv; if (out[k] > 0.0008) n++; }
  return n;
}
/* 地貌加权基色(替代原 GROUND_STYLES 单调色板)。dry/steep 语义与原版完全一致。
   同时输出三类质感权重 tw[0..2](植被/土质/岩质),供贴图混合使用。 */
function biomeColorAt(x, z, dry, steep, outCol, outTW) {
  biomeWeightsAt(x, z, _bwTmp);        // ★场景v1:基色随真实坐标,南北色带各异(取消 |z| 镜像)
  var r = 0, g = 0, b = 0, t0 = 0, t1 = 0, t2 = 0;
  for (var k = 0; k < BIOME_N; k++) {
    var w = _bwTmp[k]; if (w < 1e-5) continue;
    var B = BIOMES[k];
    var cr = B.g[0] + (B.d[0] - B.g[0]) * dry,
        cg = B.g[1] + (B.d[1] - B.g[1]) * dry,
        cb = B.g[2] + (B.d[2] - B.g[2]) * dry;
    cr += (B.r[0] - cr) * steep; cg += (B.r[1] - cg) * steep; cb += (B.r[2] - cb) * steep;
    r += cr * w; g += cg * w; b += cb * w;
    if (B.tex === 0) t0 += w; else if (B.tex === 1) t1 += w; else t2 += w;
  }
  outCol[0] = r; outCol[1] = g; outCol[2] = b;
  if (outTW) { outTW[0] = t0; outTW[1] = t1; outTW[2] = t2; }
}
var _bCol3 = [0, 0, 0], _bTW3 = [0, 0, 0];
var _bColR = [0, 0, 0];   /* G2-slopefix: rock-color scratch (steep=1 bake for per-fragment steep) */


function scopeFov(scopeZoom, scopeT) { return 62 + (28 / scopeZoom - 62) * scopeT; }

// 炮镜开镜变焦(62°→28°;倍率档位只改这一处,相机/阴影/灵敏度同源)
/* N 网格按矩阵烘焙合并为单一 BufferGeometry(残骸个体/区合批 + 阴影模板共用内核,去重自 combat.bakeGeomList/vehicles._shMerge):
   jobs=[{geo,m4}],m4=几何→目标坐标系矩阵;withColor=true 时含 color(残骸全细节),false 仅 position/normal/uv;
   fillIndex=true 时无 index 几何顺序补索引(阴影模板);sharedFlag=true 打 _shared 标记(模板禁销毁,残骸产物不设)。 */
var _mgV = new THREE.Vector3(), _mgNM = new THREE.Matrix3();

// 模块 scratch(热路径零分配)
function mergeGeometries(jobs, withColor, fillIndex, sharedFlag) {
  var totalV = 0, totalI = 0, i;
  for (i = 0; i < jobs.length; i++) {
    totalV += jobs[i].geo.attributes.position.count;
    totalI += jobs[i].geo.index ? jobs[i].geo.index.count : (fillIndex ? jobs[i].geo.attributes.position.count : 0);
  }
  if (!totalV) return null;
  var pos = new Float32Array(totalV * 3), nrm = new Float32Array(totalV * 3),
      col = withColor ? new Float32Array(totalV * 3) : null, uvm = new Float32Array(totalV * 2);
  var idxA = totalV > 65535 ? new Uint32Array(totalI) : new Uint16Array(totalI);
  var vo = 0, io = 0;
  for (i = 0; i < jobs.length; i++) {
    var g = jobs[i].geo, m4 = jobs[i].m4, n = g.attributes.position.count;
    _mgNM.getNormalMatrix(m4);
    var pa = g.attributes.position.array, na = g.attributes.normal ? g.attributes.normal.array : null,
        ca = withColor && g.attributes.color ? g.attributes.color.array : null,
        ua = g.attributes.uv ? g.attributes.uv.array : null;
    for (var v = 0; v < n; v++) {
      _mgV.set(pa[v * 3], pa[v * 3 + 1], pa[v * 3 + 2]).applyMatrix4(m4);
      pos[(vo + v) * 3] = _mgV.x; pos[(vo + v) * 3 + 1] = _mgV.y; pos[(vo + v) * 3 + 2] = _mgV.z;
      if (na) {
        _mgV.set(na[v * 3], na[v * 3 + 1], na[v * 3 + 2]).applyMatrix3(_mgNM).normalize();
        nrm[(vo + v) * 3] = _mgV.x; nrm[(vo + v) * 3 + 1] = _mgV.y; nrm[(vo + v) * 3 + 2] = _mgV.z;
      }
      if (ca) { col[(vo + v) * 3] = ca[v * 3]; col[(vo + v) * 3 + 1] = ca[v * 3 + 1]; col[(vo + v) * 3 + 2] = ca[v * 3 + 2]; }
      if (ua) { uvm[(vo + v) * 2] = ua[v * 2]; uvm[(vo + v) * 2 + 1] = ua[v * 2 + 1]; }
    }
    if (g.index) {
      var ia = g.index.array;
      for (var k2 = 0; k2 < ia.length; k2++) idxA[io + k2] = ia[k2] + vo;
      io += ia.length;
    } else if (fillIndex) {
      for (var k3 = 0; k3 < n; k3++) idxA[io + k3] = vo + k3;
      io += n;
    }
    vo += n;
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (withColor) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvm, 2));
  geo.setIndex(new THREE.BufferAttribute(idxA, 1));
  if (sharedFlag) geo.userData._shared = true;   // 阴影模板禁销毁;残骸产物不设(区合批正常回收)
  return geo;
}

/* 通用对象池取件:优先空闲槽,全忙覆盖最旧(comic.js 漫画特效各池共用;槽位协议 it.on/it.age) */
function poolIdleOldest(pool, n) {
  var best = -1, bestAge = 1e9;
  for (var i = 0; i < n; i++) {
    var it = pool[i];
    if (!it.on) return it;
    if (it.age < bestAge) { bestAge = it.age; best = i; }
  }
  return pool[best];
}

// 线性加减速(二战坦克沉重的动力响应)
function approachSpeed(cur, target, accel, decel, dt) {
  if (cur === target) return cur;
  var sameDir = (cur === 0 || (target > 0) === (cur > 0));
  var rate = (Math.abs(target) > Math.abs(cur) && sameDir) ? accel : decel;
  var d = rate * dt;
  return cur < target ? Math.min(target, cur + d) : Math.max(target, cur - d);
}

/* Ground-vehicle input inertia.  The old command path was rate-limited only at
   the final yaw/speed step, so a digital key reversal could still feel like a
   direction switch.  These small, bounded filters add engine spool and steering
   inertia without changing the vehicle's top speed or maximum turn rate. */
var GROUND_THROTTLE_TAU_UP = 0.18;
var GROUND_THROTTLE_TAU_DOWN = 0.28;
var GROUND_STEER_TAU_HEAVY = 0.22;
var GROUND_STEER_TAU_LIGHT = 0.15;
var GROUND_STEER_RELEASE_TAU = 0.13;
function groundThrottleInertia(t, raw, dt) {
  raw = clamp(Number(raw) || 0, -1, 1);
  var cur = t && t._driveThrottle != null ? t._driveThrottle : 0;
  var rising = Math.abs(raw) > Math.abs(cur) && (cur === 0 || (raw > 0) === (cur > 0));
  var tau = rising ? GROUND_THROTTLE_TAU_UP : GROUND_THROTTLE_TAU_DOWN;
  var step = 1 / Math.max(0.001, tau);
  var out = approachSpeed(cur, raw, step, step, Math.max(0, dt || 0));
  if (cur * raw < 0 && cur * out < 0) out = 0;   // reverse input must pass through neutral
  if (Math.abs(out) < 0.0005 && Math.abs(raw) < 0.0005) out = 0;
  if (t) t._driveThrottle = out;
  return out;
}
function groundYawInertia(t, desiredRate, maxRate, dt) {
  maxRate = Math.max(0.001, Math.abs(maxRate) || 0.001);
  desiredRate = clamp(Number(desiredRate) || 0, -maxRate, maxRate);
  var cur = t && t._steerRate != null ? t._steerRate : 0;
  var light = t && (t.kind === 'arty' || (t.kind === 'aa' && t.team === 'blue'));
  var tauUp = light ? GROUND_STEER_TAU_LIGHT : GROUND_STEER_TAU_HEAVY;
  var accel = maxRate / Math.max(0.001, tauUp);
  var release = maxRate / Math.max(0.001, GROUND_STEER_RELEASE_TAU);
  var rate = approachSpeed(cur, desiredRate, accel, release, Math.max(0, dt || 0));
  if (cur * desiredRate < 0 && cur * rate < 0) rate = 0;   // track reversal brakes to neutral first
  rate = clamp(rate, -maxRate, maxRate);
  if (t) {
    t._steerRate = rate;
    t.yaw = normAng(t.yaw + rate * Math.max(0, dt || 0));
    t._turnCmd = rate;
  }
  return rate;
}

// —— 障碍绕行转向:行进方向前方的固定障碍产生"法向推离 + 切向绕行"的合力,
//    AI 会贴着障碍边缘绕过去,而不是一直顶着它 ——
var _av = { x: 0, z: 0 };
var _slA = { gx: 0, gz: 0, tan: 0 }, _slB = { gx: 0, gz: 0, tan: 0 }, _slC = { gx: 0, gz: 0, tan: 0 };   // 坡斥力前瞻三扇区 scratch

// avoidSteer 复用 scratch(零分配;调方立即消费 .x/.z,无重入——steerCached/artyUpdate 均调用后随即读取)
function avoidSteer(t, dx, dz) {
  var p = t.group.position, L = Math.sqrt(dx * dx + dz * dz);
  if (L < 1e-4) { _av.x = dx; _av.z = dz; return _av; }
  var ux = dx / L, uz = dz / L;
  var rx = ux, rz = uz, changed = false;
  // 障碍网格邻域查询(静态注册/事件驱动;范围=最大障碍半径+reach 上界,候选集与全表逐位一致)
  var nObs = obstaclesNear(p.x, p.z, obstacleMaxR + t.radius + 10.5, _obsNear);
  for (var oi = 0; oi < nObs; oi++) {
    var o = _obsNear[oi];
    var ox = o.x - p.x, oz = o.z - p.z;
    var rr = o.r + t.radius + 1.5;
    var reach = rr + 9;
    var d2 = ox * ox + oz * oz;
    if (d2 > reach * reach) continue;
    var d = Math.sqrt(d2) || 0.01;
    if ((ox * ux + oz * uz) / d < 0.2) continue;            // 只避让行进方向前方的障碍
    ox /= d; oz /= d;
    var w = clamp(1 - (d - rr) / 9, 0.25, 1.5);
    rx -= ox * w * 0.55; rz -= oz * w * 0.55;               // 法向推离(越近推得越狠)
    var t1x = -uz, t1z = ux;                                // 单位切向(垂直行进方向)
    var sg = (ox * t1x + oz * t1z) > 0 ? -1 : 1;            // 绕向远离障碍的一侧
    rx += t1x * sg * w; rz += t1z * sg * w;                 // 切向绕行分量
    changed = true;
  }
  // —— 完整残骸:几乎不当障碍(可推的掩体)—— 只有贴脸 ±41° 窄锥内才极轻避让,
  //    其余一律允许贴身顶开(碰撞系统会把它推着走),绝不拿它当岩石那种死墙 ——
  //    簇化:堆叠残骸按簇(边缘距<6m)聚成单一虚拟体响应——逐具避让的切向分量
  //    符号互相打架导致贴堆抖动,整体化后一堆残骸=一次稳定的"法向推离+切向绕行"。
  var wcn = wreckClustersNear(p.x, p.z, t.radius + 14);
  for (var wci = 0; wci < wcn; wci++) {
    var wc = _wclOut[wci];
    var wx = wc.sx / wc.n - p.x, wz = wc.sz / wc.n - p.z;
    var rrW = wc.ext + t.radius + 0.5, reachW = rrW + 3;
    var d2W = wx * wx + wz * wz;
    if (d2W > reachW * reachW) continue;
    var dW = Math.sqrt(d2W) || 0.01;
    if ((wx * ux + wz * uz) / dW < 0.75) continue;          // 只在行进贴脸窄锥(±41°)内才稍微让一让
    var wW = clamp(1 - (dW - rrW) / 3, 0.1, 0.6);
    wx /= dW; wz /= dW;
    rx -= wx * wW * 0.22; rz -= wz * wW * 0.22;
    var t2x = -uz, t2z = ux;
    var sg2 = (wx * t2x + wz * t2z) > 0 ? -1 : 1;
    rx += t2x * sg2 * wW * 0.35; rz += t2z * sg2 * wW * 0.35;
    changed = true;
  }
  // —— P1 坡度斥力:前瞻三扇区,陡坡=软墙(与残骸斥力同构;10Hz 节流由 steerCached 承担)——
  if (typeof SIM_K !== 'undefined' && SIM_K > 0 && t.mob) {
    var slSpec = mobDerived(t.mob);
    var vAh = Math.abs(t.speed || 0) * 2;
    if (vAh < 15) vAh = 15; else if (vAh > 60) vAh = 60;
    var cA = 0.8660254, sA = 0.5;   // cos/sin 30°
    slopeVecAt(p.x + ux * vAh, p.z + uz * vAh, _slA);
    slopeVecAt(p.x + (ux * cA - uz * sA) * vAh, p.z + (ux * sA + uz * cA) * vAh, _slB);
    slopeVecAt(p.x + (ux * cA + uz * sA) * vAh, p.z + (-ux * sA + uz * cA) * vAh, _slC);
    var limA = slSpec._tanMax * 0.95;   // P3:与规划剪枝(0.95 格口径)对齐；旧 0.75 与规划打架(M5)
    var corrW = 1;
    if (t._nav && t._nav.n > 1) {   // P3 路径走廊:距当前腿<10m→坡斥力减半(规划说能走的地方跟随不擅自说不)
      var cn = t._nav, cj = cn.i - 1;
      if (cj < 0) cj = 0; else if (cj > cn.n - 2) cj = cn.n - 2;
      var cax = cn.xs[cj], caz = cn.zs[cj], cbx = cn.xs[cj + 1], cbz = cn.zs[cj + 1];
      var cdx = cbx - cax, cdz = cbz - caz, cl2 = cdx * cdx + cdz * cdz;
      if (cl2 > 1e-6) {
        var ctt = ((p.x - cax) * cdx + (p.z - caz) * cdz) / cl2;
        if (ctt < 0) ctt = 0; else if (ctt > 1) ctt = 1;
        var cex = cax + cdx * ctt - p.x, cez = caz + cdz * ctt - p.z;
        if (cex * cex + cez * cez < 100) corrW = 0.5;
      }
    }
    if (_slA.tan > limA) {
      var wA = clamp((_slA.tan - limA) / Math.max(0.05, slSpec._tanMax - limA), 0, 1.5) * corrW;
      var glA = Math.sqrt(_slA.gx * _slA.gx + _slA.gz * _slA.gz) || 1;
      rx -= (_slA.gx / glA) * wA * 0.8; rz -= (_slA.gz / glA) * wA * 0.8;   // 法向:沿下坡向推离
      var sgA = (_slB.tan <= _slC.tan) ? 1 : -1;   // 切向:往缓侧绕(+t1=B 侧)
      rx += (-uz) * sgA * wA; rz += (ux) * sgA * wA;
      changed = true;
    } else if (_slB.tan > slSpec._tanMax || _slC.tan > slSpec._tanMax) {
      var sgB = (_slB.tan > _slC.tan) ? -1 : 1;   // 单侧是墙:轻推离该侧
      rx += (-uz) * sgB * 0.5 * corrW; rz += (ux) * sgB * 0.5 * corrW;
      changed = true;
    }
  }
  if (!changed) { _av.x = ux; _av.z = uz; return _av; }
  var l2 = Math.sqrt(rx * rx + rz * rz) || 1;
  _av.x = rx / l2; _av.z = rz / l2;
  return _av;
}

/* ===== 坡度越野物理内核(2026-09-09 大改;P0) =====
   slopePhys: 纯函数(只吃参数+Math,零全局/零分配),node 可单测。
   约定: sLong=车头向坡度 tan(前高为正),sLat=车体右侧坡度 tan(右高为正),
         v=纵向速度(前正后负),thr=油门(-0.6~1)。
   spec 须经 mobOf/mobDerived 归一(含 _tanMax/_tanSide)。
   输出 out(调用方复用): vCapF/vCapR 前倒极速;fAvailF/fAvailR 前倒可用比力;
     fResF/fResR 前倒阻力比力;slideAcc 侧滑加速度(≥0);slideDir 滑向(+1=右,-1=左,车体系);
     turnMul 转向系数;rho 纵向附着占用率;onSlope 在坡标志。 */
var SLOPE_G = 9.8;
var MOB_DEFAULT = { mass: 40000, power: 400000, eta: 0.8, mu: 0.65, muLat: 0.4, crr: 0.1, vCrawl: 1.0 };   // 未登记兜底(MR1:eta 0.7→0.8 机械传动口径)
function mobOf(t) {
  var m = (t && t.mob) || MOB_DEFAULT;
  if (m === MOB_DEFAULT && t && t.kind !== 'ah64' && t.kind !== 'wz10' && !t._mobWarned) {
    t._mobWarned = 1;
    if (typeof console !== 'undefined' && console.warn) console.warn('[mob] ground vehicle missing mob data, using 40t default:', t.kind, t.team);
  }
  if (m._tanMax == null) {
    m._tanMax = Math.max(0.05, m.mu - m.crr);
    m._tanSide = Math.max(0.05, m.muLat);
  }
  return m;
}
/* —— 路面分档滚动阻力（Part A 阻力重设计 MR1）——
   文献锚点：草地 0.060~0.110 / 履带田间 0.07~0.12 / 干砂壤 0.10 / 泥泞 0.17。
   口径划分：CONF.mob.crr 保留为“松土基值”——剪枝与各类门限（validDest/avoidSteer/
   navGroupLim/navSegReach 默认极限）沿用基值 _tanMax（保守方向：规划比物理严）；
   只有 slopePhys 物理链（经 mobEffOf）与 A* 边代价走本表（与物理同口径，缩小 M3 失配）。 */
var CRR_TABLE = {
  firm:  { track: 0.055, wheel: 0.045 },   // 压实平地（rough<25）
  grass: { track: 0.070, wheel: 0.060 },   // 草地默认
  loose: { track: 0.100, wheel: 0.110 }    // 松土（mat=soil 或 rough≥70）；沙泥档远期预留
};
function crrGround(wheeled, x, z) {   // x/z 预留（未来按位置查泥泞/弹坑），现阶段只看 MAP 全局
  var band = 'grass';
  if (typeof MAP !== 'undefined') {
    if ((MAP.rough || 0) >= 70 || MAP.mat === 'soil') band = 'loose';
    else if ((MAP.rough || 0) < 25) band = 'firm';
  }
  var row = CRR_TABLE[band] || CRR_TABLE.grass;
  return wheeled ? row.wheel : row.track;
}
var _mobEff = { mass: 0, power: 0, eta: 0.8, mu: 0, muLat: 0, crr: 0, vCrawl: 1, _tanMax: 0, _tanSide: 0 };
function mobEffOf(t) {   // 物理链有效档案：CONF 基值 + 路面分档 crr（scratch，不污染共享 CONF；_tanMax 同步重算）
  var m = mobOf(t);
  _mobEff.mass = m.mass; _mobEff.power = m.power; _mobEff.eta = m.eta;
  _mobEff.mu = m.mu; _mobEff.muLat = m.muLat; _mobEff.vCrawl = m.vCrawl || 1;
  var px = 0, pz = 0;
  if (t && t.group && t.group.position) { px = t.group.position.x; pz = t.group.position.z; }
  _mobEff.crr = crrGround(t ? t.kind === 'arty' : false, px, pz);
  /* RED-MBT-1 Non-Skid Track is a player-only loadout effect. AI always keeps the base ground coefficient. */
  if (t && t.isPlayer) {
    var _techCrrMul = t._techGroundCrrMul != null ? t._techGroundCrrMul : 1;
    if (typeof vehicleTechResistanceMultiplier === 'function') _techCrrMul = vehicleTechResistanceMultiplier(t);
    _mobEff.crr *= _techCrrMul;
  }
  _mobEff._tanMax = Math.max(0.05, _mobEff.mu - _mobEff.crr);
  _mobEff._tanSide = Math.max(0.05, _mobEff.muLat);
  return _mobEff;
}
function slopePhys(spec, sLong, sLat, v, thr, v0, pMul, muMul, yawRate, simK, out) {
  var g = SLOPE_G, k = simK == null ? 1 : simK;
  var mu = spec.mu * muMul, muLat = spec.muLat * muMul, crr = spec.crr;
  var tMax = spec._tanMax || Math.max(0.05, spec.mu - spec.crr);
  var tSide = spec._tanSide || Math.max(0.05, spec.muLat);
  // 前/倒向阻力比力 fRes=g(sinθ+Crr·cosθ);倒向=坡度取反(车不动,运动方向反)
  var cosT = 1 / Math.sqrt(1 + sLong * sLong), sinT = sLong * cosT;
  var fResF = g * (sinT + crr * cosT) * k, fResR = g * (-sinT + crr * cosT) * k;
  out.fResF = fResF; out.fResR = fResR;
  var fTrac = mu * g * cosT;                          // 牵引上限(附着,不随 simK 缩)
  var vAbs = Math.abs(v);
  if (vAbs < spec.vCrawl) vAbs = spec.vCrawl;          // 蠕行速度=最低挡,防除零
  var fPow = (spec.power * pMul * spec.eta) / (spec.mass * vAbs);
  var fDrv = fTrac < fPow ? fTrac : fPow;
  out.fAvailF = fDrv - fResF;
  out.fAvailR = fDrv - fResR;
  // 爬坡极速:功率=阻力 的解;denom≤0(顺坡助力)时不限制(由 v0 钳,不奖励超速)
  var denomF = sinT + crr * cosT, denomR = -sinT + crr * cosT;
  var pW = spec.power * pMul * spec.eta, mg = spec.mass * g;
  out.vCapF = denomF > 1e-6 ? Math.min(v0, pW / (mg * denomF)) : v0;
  if (!(out.vCapF >= 0)) out.vCapF = 0;
  out.vCapR = denomR > 1e-6 ? Math.min(v0 * 0.6, pW / (mg * denomR)) : v0 * 0.6;
  if (!(out.vCapR >= 0)) out.vCapR = 0;
  // 横向:需求=横坡分力+转向离心(车体右轴为正),阈值=附着椭圆缩减后的 μ_lat
  var cosP = 1 / Math.sqrt(1 + sLat * sLat), sinP = sLat * cosP;
  var rho = fTrac > 1e-6 ? Math.abs(fResF) / fTrac + Math.abs(thr) * 0.25 : 0.95;   // 纵向附着占用≈阻力占比+油门占比(近似)
  if (rho > 0.95) rho = 0.95;
  out.rho = rho;
  var latAvail = muLat * g * cosT * cosP * Math.sqrt(Math.max(0, 1 - rho * rho));
  out.latDemR = -(g * sinP + v * (yawRate || 0)) * k;
  var over = Math.abs(out.latDemR) - latAvail;
  out.slideAcc = over > 0 ? over : 0;
  out.slideDir = out.latDemR >= 0 ? 1 : -1;
  // 转向:坡越陡越不听使唤
  var slopeFrac = Math.abs(sLong) / tMax;
  var latFrac = Math.abs(sLat) / tSide;
  if (latFrac > slopeFrac) slopeFrac = latFrac;
  out.turnMul = 1 - 0.5 * Math.min(1, slopeFrac * k);
  out.onSlope = (Math.abs(sLong) > 0.03 || Math.abs(sLat) > 0.03) ? 1 : 0;
  return out;
}
// 车体系纵/横弦坡度(±2.6m/±1.3m 基线,与 alignTank 同口径;5 次查表约 0.3µs,每车每帧一次)
var _gpOut = { sLong: 0, sLat: 0 };
function gradeProbe(t, out) {
  var p = t.group.position, fx = Math.sin(t.yaw), fz = Math.cos(t.yaw);
  var hf = terrainH(p.x + fx * 2.6, p.z + fz * 2.6), hb = terrainH(p.x - fx * 2.6, p.z - fz * 2.6);
  var hr = terrainH(p.x + fz * 1.3, p.z - fx * 1.3), hl = terrainH(p.x - fz * 1.3, p.z + fx * 1.3);
  out = out || _gpOut;
  out.sLong = (hf - hb) / 5.2; out.sLat = (hr - hl) / 2.6;
  return out;
}
// 世界系坡度向量(±2m 十字;AI 目的地门/航段抽查/坡斥力用)
var _svOut = { gx: 0, gz: 0, tan: 0 };
function slopeVecAt(x, z, out) {
  var e = 2.0;
  var gx = (terrainH(x + e, z) - terrainH(x - e, z)) / (2 * e);
  var gz = (terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e);
  out = out || _svOut;
  out.gx = gx; out.gz = gz; out.tan = Math.sqrt(gx * gx + gz * gz);
  return out;
}
function trackGripMult(t) {   // 履带附着系数(与 _calcMobilityMult 断带口径同构,数值独立)
  if (!t || !t.mods) return 1;
  var m = t.mods, l = !m.trackL || m.trackL.hp > 0, r = !m.trackR || m.trackR.hp > 0;
  if (l && r) return 1;
  if (!l && !r) return 0.35;
  return 0.7;
}
function slopeTurnMul(t) {   // 转向坡度系数(读上一帧裁决缓存,1 帧滞后零感知;首帧/街机=1)
  return t._slopeTurnMul != null ? t._slopeTurnMul : 1;
}
function slopeStuck(t) {   // P1 坡卡死:有油门无速度+无可用比力(非顶牛)+非断油/SIM_K 门
  if (typeof SIM_K === 'undefined' || SIM_K <= 0 || !t) return 0;
  // MR2.1:超速滑移（带速冲坡，动量滤波意图内行为）≠卡死——卡死须 ~无运动；自旋/倒滑 v≈0 不受影响
  if ((t._slipT || 0) > 1.0 && Math.abs(t.speed || 0) < 1.0) return 1;
  var thr = t._throttle || 0;
  if (Math.abs(thr) < 0.1 || Math.abs(t.speed) > 0.45) return 0;
  if ((t._fAvail || 0) > 0.1) return 0;
  if (typeof engineEff === 'function' && engineEff(t) < 0.05) return 0;
  if (typeof fueled === 'function' && !fueled(t)) return 0;
  return 1;
}
/* 坡度裁决(applyMotion 内调用;玩家/AI 同源,单一实现)。
   读 t._throttle/t._throttleLock(调用方写),写 t.speed/t._slideV/t._slip/t._fAvail/t._slopeTurnMul。 */
var _slOut = { vCapF: 0, vCapR: 0, fAvailF: 0, fAvailR: 0, fResF: 0, fResR: 0, slideAcc: 0, slideDir: 1, latDemR: 0, turnMul: 1, rho: 0, onSlope: 0 };
function slopeArbitrate(t, dt) {
  var spec = mobEffOf(t);   // MR1：路面分档 crr（CONF 基值仅留作剪枝/门限保守口径）
  gradeProbe(t, _gpOut);
  var sLongRaw = _gpOut.sLong, sLatRaw = _gpOut.sLat;
  if (t._sLongF == null) { t._sLongF = sLongRaw; t._sLatF = sLatRaw; }
  var kSlopeF = 1 - Math.exp(-dt / 0.1);
  t._sLongF += (sLongRaw - t._sLongF) * kSlopeF;
  t._sLatF += (sLatRaw - t._sLatF) * kSlopeF;
  var sLong = t._sLongF, sLat = t._sLatF;
  var locked = !!t._throttleLock;   // 齐射驻锄:无驱动+驻锄不溜坡
  var rawThr = locked ? 0 : (t._throttle || 0);
  var thr = groundThrottleInertia(t, rawThr, dt);
  if (locked) { thr = 0; t._driveThrottle = 0; }
  var eff = (typeof engineEff === 'function') ? engineEff(t) : 1;
  var v = t.speed, v0 = t.speed0 || 10;
  var vBoost = typeof powerupSpeedBonusMps === 'function' ? powerupSpeedBonusMps(t) : 0;
  slopePhys(spec, sLong, sLat, v, thr, v0, eff, trackGripMult(t), t._yawRate || 0, (typeof SIM_K === 'undefined') ? 1 : SIM_K, _slOut);
  var sm = (typeof speedMult === 'function') ? speedMult(t) : 1;
  // MR2 动量滤波：vCap 上升（阻力骤降，如过坡顶）快跟随 τ≈0.3s，下跌（上坡）慢跟随 τ≈1.6s（动能带车冲短坡）；
  // bypass 条件=附着判据（fTrac−fRes<0，蠕行速度都爬不动的真陡坡），不用 fAvail@当前速度——后者在 v>>vCap 时恒<0，
  // 会把每次带速进坡都判成 bypass（实测教训）。首帧直接同步，无启动滞后。
  var vcF = _slOut.vCapF, vcR = _slOut.vCapR;
  if (t._vcapFF == null) { t._vcapFF = vcF; t._vcapFR = vcR; }
  var cosT0 = 1 / Math.sqrt(1 + sLong * sLong);
  var fTrac0 = spec.mu * trackGripMult(t) * SLOPE_G * cosT0;   // 与 slopePhys 内 fTrac 同口径
  var kUpF = 1 - Math.exp(-dt / 0.3), kDnF = (fTrac0 - _slOut.fResF < 0) ? 1 : 1 - Math.exp(-dt / 1.6);
  t._vcapFF += (vcF - t._vcapFF) * (vcF >= t._vcapFF ? kUpF : kDnF);
  var kUpR = 1 - Math.exp(-dt / 0.3), kDnR = (fTrac0 - _slOut.fResR < 0) ? 1 : 1 - Math.exp(-dt / 1.6);
  t._vcapFR += (vcR - t._vcapFR) * (vcR >= t._vcapFR ? kUpR : kDnR);
  var target = thr >= 0 ? Math.min(thr * v0 * sm, t._vcapFF + vBoost) : Math.max(thr * v0 * sm, -(t._vcapFR + vBoost));
  if (locked) target = 0;
  var a0 = (t.accel0 || 2.5) * eff * (1 - 0.55 * Math.min(Math.abs(v) / Math.max(v0, 0.01), 1));   // MR2 扭矩曲线：低速有劲、高速乏力（调速器 droop 一阶近似）
  var d0 = (t.decel0 || 5) * Math.max(eff, 0.3);
  if (locked) {
    v = approachSpeed(v, 0, 0, 8, dt);
  } else if (Math.abs(v) < 0.08 && Math.abs(thr) < 0.02 && Math.abs(target) < 0.05) {
    // 静止无油门:驻车保持 vs 溜坡(刹车按住 |g·sinθ|≤d0,按不住顺坡溜+刹车拖 60%)
    var cosT0 = 1 / Math.sqrt(1 + sLong * sLong), gS = -SLOPE_G * sLong * cosT0;
    if (Math.abs(gS) <= d0) v = 0;
    else v += (gS - (gS > 0 ? d0 * 0.6 : -d0 * 0.6)) * dt;
  } else if (Math.abs(thr) < 0.02 && Math.abs(target) < 0.05) {
    // 滑行(无油门有速度):发动机制动 35% + 坡度阻力(上坡急停,下坡溜车加速)
    var fResV = v >= 0 ? _slOut.fResF : -_slOut.fResR;
    var aCoast = -(v >= 0 ? 1 : -1) * d0 * 0.35 - fResV;
    v += aCoast * dt;
    if (v > 0 && aCoast < 0 && v < 0.05) v = 0;   // 防滑行过零震荡(只在减速向零时钳)
    if (v < 0 && aCoast > 0 && v > -0.05) v = 0;
  } else {
    // 驱动:P 伺服趋近 target,驱动 authority 受 fAvail(牵引/功率)钳制
    var aWant = (target - v) * 4;
    if (aWant > a0) aWant = a0; else if (aWant < -d0) aWant = -d0;
    if (aWant > 0) {
      if (target > 0) {
        // 前进油门:若坡度阻力大于驱动力(fAvailF <= 0),当车速已归零则停驻,绝不反向倒车!
        if (v <= 0 && _slOut.fAvailF <= 0) {
          aWant = 0;
          v = 0;
        } else if (aWant > _slOut.fAvailF) {
          aWant = _slOut.fAvailF;
        }
      } else if (aWant > _slOut.fAvailF) {
        aWant = _slOut.fAvailF;
      }
    } else if (aWant < 0) {
      if (target < 0) {
        if (v >= 0 && _slOut.fAvailR <= 0) {
          aWant = 0;
          v = 0;
        } else if (-aWant > _slOut.fAvailR) {
          aWant = -_slOut.fAvailR;
        }
      }
    }
    // 逆向滑动对抗(爬坡冲量用尽倒滑/挂倒挡前冲时踩油门):全力拉回,杜绝持续逆向
    if (v < -0.05 && (target > 0 || thr > 0.05)) {
      var aRecov = Math.max(d0 * 0.8, 2.5);
      aWant = aRecov;
    } else if (v > 0.05 && (target < 0 || thr < -0.05)) {
      var aRecovR = Math.max(d0 * 0.8, 2.5);
      aWant = -aRecovR;
    }
    v += aWant * dt;
    // 关键安全门:前进油门(target > 0 或 thr > 0)驱动下,绝不允许速度跨零跌入倒车!
    if ((target > 0 || thr > 0.05) && v < 0) v = 0;
    if ((target < 0 || thr < -0.05) && v > 0) v = 0;
    if (v > 6 && target <= 0.1) v = 6; else if (v < -6 && target >= -0.1) v = -6;
  }
  var vLimit = v0 + vBoost;
  if (v > vLimit) v = vLimit; else if (v < -vLimit * 0.6) v = -vLimit * 0.6;   // 下坡溜车带刹:纵速不超平路极速(含火箭推进固定 +10 km/h)
  if (!isFinite(v)) v = 0;
  t.speed = v;
  // 横向漂移(车体右轴 signed 速度):超附着加速,附着内指数回零;驻锄强阻尼
  var sv = t._slideV || 0;
  if (locked) sv = approachSpeed(sv, 0, 8, 8, dt);
  else if (_slOut.slideAcc > 0) {
    sv += _slOut.slideDir * _slOut.slideAcc * dt;
    if (sv > 6) sv = 6; else if (sv < -6) sv = -6;
  } else sv = approachSpeed(sv, 0, 6, 6, dt);
  t._slideV = sv;
  // SLIP 状态机:进 0.3s 防抖,出 0.5s 防抖
  var wantSlip = 0;
  if (!locked) {
    if (Math.abs(thr) > 0.05 && Math.abs(v) < 0.5 &&
        ((thr > 0 && _slOut.fAvailF < -0.2) || (thr < 0 && _slOut.fAvailR < -0.2))) wantSlip = 1;
    if (_slOut.slideAcc > 0.3 && Math.abs(sv) > 0.3) wantSlip = 1;
    var vCapNow = v >= 0 ? _slOut.vCapF : _slOut.vCapR;
    if (Math.abs(v) > vCapNow + 1.5) wantSlip = 1;   // 失速:超极速=刹不住的溜坡
  }
  if (wantSlip) { t._slipT = (t._slipT || 0) + dt; t._slipOkT = 0; }
  else { t._slipOkT = (t._slipOkT || 0) + dt; if (t._slipOkT > 0.5) t._slipT = 0; }
  t._slip = (t._slipT || 0) > 0.3 ? 1 : 0;
  t._fAvail = thr < 0 ? _slOut.fAvailR : _slOut.fAvailF;
  t._slopeTurnMul = _slOut.turnMul * (t._slip ? 0.6 : 1);
}

/* ===== 共享工具:重复逻辑归一(玩家/AI/弹道链路同口径) ===== */
function tickReload(t, dt) {
  if (typeof vehicleTechBurstLoadingTick === 'function') vehicleTechBurstLoadingTick(t, dt);
  t.reload = Math.max(0, t.reload - dt * reloadDamageMult(t));   // 装填速率:人工=炮塔血量方案/自动装弹机=弹药架血量方案(reloadDamageMult 分流;转速另走 turretMult)
}

function effectiveShellSpeed(t) {                  // 实际出膛初速(炮管血量因子 0.3 下限;fireShell/AI tof/装定同口径)
  return (t.shellSpeed0 || CONF.shellSpeedE) * Math.max(0.3, barrelEff(t));
}

function shellTof0(dirY, v) {                      // 抛物线到时(纵速/重力;弹道仿真与发射同公式)
  return Math.max(0.1, 2 * dirY * v / CONF.gravity);
}

function losIntersect(ax, az, bx, bz, ray) {       // LOS 宽相位候选+求交核心(ray 由调用方配置 origin/dir/far)
  collectCands(ax, az, bx, bz, _candList);
  return ray.intersectObjects(_candList, false);
}
