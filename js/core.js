
/* ===== Module: core.js ===== */
/* ============================================================
   模块: core.js — 核心:工具函数/地形高度场/配置/全局状态
   (加载顺序由 index.html MODULES 表决定,勿单独调整)
   ============================================================ */
'use strict';
/* ============================================================
   装甲部队 —— 3D 第三人称坦克会战 · 模块化伤害判定
   模式: 50 兵力消耗战(默认值,可在遭遇战参数菜单调整;每方在场 54 辆:
         红方=RED-MBT-1×18+RED-MBT-2×18+RED-TD×10+RED-HELI×4+RED-MLRS×4,
         蓝方=BLUE-MBT-1×18+BLUE-MBT-2×28+BLUE-HELI×4+BLUE-MLRS×4;
         载具被摧毁后按平台延时从大本营重新部署,每次 -1 兵力;
         判负条件 = 兵力耗尽 且 场上无存活载具)
   玩家: 与 AI 完全同配置(无主角光环);阵亡后自选翼位(左/中/右)+ 任意平台重新部署,
         占用同阵营 1 点兵力;蓝方特殊槽为BLUE-MBT-2旋塔主战坦克,红方特殊槽为RED-TD旋转重炮战车
   机制:
   · 每辆坦克由 8 个独立模块构成(履带x2/发动机/炮塔/炮管/弹药架/油箱/车体)
   · 命中判定:射线逐模块求交,只计入射面(FrontSide)
   · 装甲:按命中部位取对应面厚度(正/侧/后/顶);各车型使用独立真面壳(M1首下与水平面75°),
     入射角由世界法线换算等效装甲 = 名义/cos(θ) ; θ>68° 强制跳弹
   · 击穿后穿深衰减,继续沿弹道损伤内部模块(弹药架→殉爆,油箱→起火…)
   · 起伏地形:高度场地貌,车体随坡面姿态贴地,上坡减速
   · 火灾/殉爆/断履带/方向机锁死,模块损伤均不可修复
   ============================================================ */

/* ===== 地形(高度场,种子贝塞尔连续地形 + 边缘坡环) ===== */
/* 地图生成规则:
   ① 边缘坡环:四缘最后 slopeW=150m 贝塞尔陡升(≈slopeH=26m)把战场锁在地图内——
      唯一不随种子/崎岖度变化的分量,坡宽/坡高与原草原边山一致;
   ② 中心地形(种子三层双三次贝塞尔场驱动;崎岖度决定"形态"而非仅缩放振幅):
      rough∈[-100,+100] → r=rough/100,正负两侧均乘 |r|,r=0 绝对平坦、跨 0 连续;
      · r>0 山地:宏观场折叠成脊线 ridge=1-|2M-1|(C∞ 场的 M=0.5 等值线折出连绵山脊网络,
        脊上 C0 折点=山脊线),ridge^1.7 锐峰缓谷,+100 峰高≈40m;细节场去均值 ±7m 随 r 同步增强;
      · r<0 盆地:径向盆形下沉(中心 -22m×|r|,归一化半径 0.35→1.0 平滑回升,盆壁在边缘坡环前归零)
        + 盆缘丘带(半径 0.55 外环×宏观场,≈9m×|r|,盆周高地感) + 盆内去均值细波(±3.5m×|r|)
        ——中央大面积低平、四周渐高;
      振幅自坡前 90m 起经 150m smoothstep 渐隐没入坡墙(坡上 60m 处归零),
      出生线/战线(坡前 50m)仍保有 ~81% 振幅,崎岖度全程可见;
   ③ 非对称:贝塞尔场/盆地以真实 (x,z) 采样,南北半场各自随机(中线镜像已取消,颜色层此前已去镜像);
      公平改由三层机制保障——玩法布局(HQ/出生线)继续镜像 + 构建期连通性验证(奇观重布) + 出生坡度门(见 wonder.js);
   ④ 战斗弹坑(dentGrid)为临时战斗疤痕,非天然地形,初始全 0。
   ⑤ 奇观层(wonder.js):种子布点的多奇观加性高度,粗格烘焙+上采样,与中心地形同门(rough=0 时无奇观);
   ⑥ HQ 夷平:18 座大本营圆心 50m 内烘焙为绝对平地,50~70m 平滑过渡(覆盖 40m 弹坑保护与 30m 重部署环)。 */
var MAP = { len: 2000, wid: 2000, halfL: 1000, halfW: 1000, side: 2000, half: 1000, seed: '0', seedF: 0, rough: 0, mat: 'grass', slopeW: 150, slopeH: 26, cpStep: 250, wonders: [], hqFlat: null, wonderSalt: '' };
function hashSeed(str) {                 // 种子(任意文本)→ 32 位确定值(FNV-1a)
  var h = 0x811c9dc5;
  str = String(str == null ? '' : str);
  for (var si = 0; si < str.length; si++) {
    h ^= str.charCodeAt(si);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/* —— 三层 B 样条地形场(种子驱动;确定值,不占战斗 RNG 流)——
   控制点网格:每格点高度 = bcHash(确定性格点哈希);地形场 = 4×4 控制点块的
   均匀三次 B 样条(凸组合,跨格线 C2 连续,值域 0..1)。层偏移 o 使各层相位独立。
   控制点按层预计算成数组表(建场/换参数一次性,terrainBase 热路径纯查表)。
   注:地形基必须用 B 样条而非 Bernstein 贝塞尔——贝塞尔基的端点=控制点、块间不共享,
   每条格线 C0 断裂,随机出现 ~40m 跳变被查表抹成 70°+ 峭壁("杂乱地形"观感的一半根源);
   B 样条基跨格线 C2 连续,无此问题。 */
var _bcArr = [null, null, null], _bcOff = [0, 0, 0], _bcN = [0, 0, 0];   // 三层控制点表(±偏移/边长)
function bzCacheReset() {              // 按当前 MAP(cpStep/half/seedF)重建三层控制点表
  for (var o = 0; o < 3; o++) {
    var step = o === 0 ? MAP.cpStep : (o === 1 ? MAP.cpStep / 3 : MAP.cpStep / 6);
    var n = Math.ceil((MAP.half + 10) / step) + 2;    // 采样域 ±(half+10) + 2 格 margin(4×4 块边缘)
    _bcOff[o] = n; _bcN[o] = n * 2 + 1;
    var A = new Float32Array(_bcN[o] * _bcN[o]);
    for (var j = -n; j <= n; j++) for (var i = -n; i <= n; i++)
      A[(j + n) * _bcN[o] + (i + n)] = bcHash(i, j, o);
    _bcArr[o] = A;
  }
}
function bcHash(i, j, o) {               // 贝塞尔控制点高度哈希(o=层偏移;种子相位)
  var s = Math.sin(i * 12.9898 + j * 78.233 + o * 97.1 + MAP.seedF * 1e-9) * 43758.5453;
  return s - Math.floor(s);
}
function bc(i, j, o) {                   // 控制点查表(惰性建表)
  if (!_bcArr[o]) bzCacheReset();
  var n = _bcOff[o];
  return _bcArr[o][(j + n) * _bcN[o] + (i + n)];
}
function bz3(t, p0, p1, p2, p3) {        // 三次贝塞尔曲线值(t∈[0,1];单段曲线用:边缘坡环过渡)
  var u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}
function bs3(t, p0, p1, p2, p3) {        // 均匀三次 B 样条段值(t∈[0,1];跨段 C2 连续,网格场专用)
  var t2 = t * t, t3 = t2 * t;
  return ((1 - 3 * t + 3 * t2 - t3) * p0 + (4 - 6 * t2 + 3 * t3) * p1 + (1 + 3 * t + 3 * t2 - 3 * t3) * p2 + t3 * p3) / 6;
}
function bzField(x, z, step, o) {        // B 样条网格场(控制点间距 step;值域 0..1,跨格线 C2)
  var fx = x / step, fz = z / step;
  var ix = Math.floor(fx), iz = Math.floor(fz);
  var tx = fx - ix, tz = fz - iz;
  function c(i, j) { return bc(i, j, o); }
  var r0 = bs3(tx, c(ix - 1, iz - 1), c(ix, iz - 1), c(ix + 1, iz - 1), c(ix + 2, iz - 1));
  var r1 = bs3(tx, c(ix - 1, iz),     c(ix, iz),     c(ix + 1, iz),     c(ix + 2, iz));
  var r2 = bs3(tx, c(ix - 1, iz + 1), c(ix, iz + 1), c(ix + 1, iz + 1), c(ix + 2, iz + 1));
  var r3 = bs3(tx, c(ix - 1, iz + 2), c(ix, iz + 2), c(ix + 1, iz + 2), c(ix + 2, iz + 2));
  return bs3(tz, r0, r1, r2, r3);
}
/* P2: 各地貌独立连续高程生成算子 (M:宏观样条场0..1, Ms:拉伸场0..1, det:细节场, rr:崎岖度系数)
   0: grass (干草原) —— 宽波长平缓微波原野 (振幅 ±14m)
   1: soil  (沃土)   —— 缓坡微丘与浅洼 (振幅 ±26m)
   2: sand  (沙土)   —— 低伏平原与风蚀垄脊 (振幅 ±12m)
   3: gravel(砾石滩) —— 缓槽与浅冲沟 (-32m ~ +32m)
   4: scrub (灌木丘) —— 经典连绵圆顶丘陵 (-38m ~ +70m)
   5: rock  (断崖裸岩) —— 高耸分水岭山脊与尖峰 (-36m ~ +124m)
   6: heath (石楠高地) —— 隆起穹顶平顶高地 (+12m ~ +92m) */
var BIOME_HEIGHT_FUNCS = [
  // 0: grass (草原) —— 开阔平缓丘陵与微起伏宽谷
  function (M, Ms, det, rr) {
    return (Ms * 7.5 - 2.8 + det * 1.8) * rr;
  },
  // 1: soil (荒原/沃土) —— 剥蚀平原与平缓漫岗
  function (M, Ms, det, rr) {
    var roll = Math.sin(M * 6.28318) * 1.5;
    return (Ms * 4.5 - 1.5 + roll + det * 1.2) * rr;
  },
  // 2: sand (沙漠) —— 连续新月形风成沙丘链与开阔沙垄
  function (M, Ms, det, rr) {
    var dune = Math.abs(Math.sin((M * 2.8 + det * 0.45) * 3.14159));
    dune = dune * dune * (3.0 - 2.0 * dune);
    return (dune * 11.5 - 3.8 + det * 1.4) * rr;
  },
  // 3: gravel (砾石滩) —— 强烈下切的干涸冲沟、槽谷与侵蚀劣地
  function (M, Ms, det, rr) {
    var gully = 1.0 - Math.abs(Ms * 2.0 - 1.0);
    var vR = Math.pow(gully, 1.6) * 13.0;
    return (Ms * 6.0 - vR + det * 2.6) * rr;
  },
  // 4: scrub (灌木丘陵) —— 连绵波状起伏圆丘与起伏台坡
  function (M, Ms, det, rr) {
    var dome = Math.sin(M * 3.14159);
    return (dome * 9.5 - 2.2 + det * 2.0) * rr;
  },
  // 5: rock (断崖裸岩) —— 【P3 突变】Sigmoid 超陡绝壁与高落差断层山脊
  function (M, Ms, det, rr) {
    var sig = 1.0 / (1.0 + Math.exp(-18.0 * (M - 0.48)));
    var cliffH = sig * 16.5;
    var ridgeH = Math.pow(Ms, 2.2) * 10.0;
    return (cliffH + ridgeH - 5.5 + det * 2.2) * rr;
  },
  // 6: heath (石楠高地) —— 【P3 突变】多级台地阶地 (Terraced Plateaus)
  function (M, Ms, det, rr) {
    var rawH = Ms * 16.0, step = 4.2;
    var u = rawH / step, iU = Math.floor(u), fU = u - iU;
    var fStepped = fU * fU * (3.0 - 2.0 * fU);
    var terracedH = (iU + fStepped) * step;
    return (terracedH - 4.5 + det * 1.6) * rr;
  }
];

function terrainBase(x, z) {
  var az = Math.abs(z), ax = Math.abs(x);              // az/ax 仅供边缘坡环与 fade 包络(径向距离语义);场采样已去镜像,吃真实 z(方案 §3)
  var halfL = MAP.halfL || MAP.half, halfW = MAP.halfW || MAP.half;
  var slopeStartL = halfL - MAP.slopeW;
  var slopeStartW = halfW - MAP.slopeW;
  var uwL = (az - slopeStartL) / MAP.slopeW;
  var uwW = (ax - slopeStartW) / MAP.slopeW;
  var uw = Math.max(uwL, uwW);              // 边缘坡贝塞尔陡升(盆壁)
  var h = uw > 0 ? bz3(uw > 1 ? 1 : uw, 0, 0.1, 8, MAP.slopeH) : 0;
  if ((MAP.rough !== 0 || (typeof wLat !== 'undefined' && wLat)) && (uwL < 0.4 && uwW < 0.4)) {   // 中心块:基底仍 rough!==0 门内(rr=0 时 hc 天然归零),奇观 0 崎岖起(任务二)
    /* 中心地形(规则②):崎岖度决定形态——山地=脊线场,盆地=径向盆形;
       渐隐自坡前 90m 起 150m 宽,坡上 60m 处归零;出生线(坡前 50m)保留 ~81% 振幅 */
    var fade = clamp((Math.max(az - (slopeStartL - 90), ax - (slopeStartW - 90))) / 150, 0, 1);
    fade = fade * fade * (3 - 2 * fade);               // smoothstep 渐隐:中心地形平滑没入坡墙
    var rr = MAP.rough / 100;
    var M = bzField(x, z, MAP.cpStep, 0);              // 宏观场(主波长=边长/8;去镜像:真实 z 采样)
    var det = bzField(x, z, MAP.cpStep / 3, 1) * 0.66
            + bzField(x, z, MAP.cpStep / 6, 2) * 0.34 - 0.5;   // 细节场(去均值;两细节层内配 0.66/0.34)
    var Ms = clamp(0.5 + (M - 0.5) * 3.0, 0, 1);       // 对比拉伸:B 样条场分布集中 0.5±0.15,铺满 0..1 才有真谷真峰
    det = clamp(det * 2.4, -0.5, 0.5);
    var hc = 0;
    if (rr > 0) {                                      // P2: 多地貌空间加权混合连续高程
      biomeWeightsAt(x, z, _bwTmp);
      for (var k = 0; k < BIOME_N; k++) {
        var wk = _bwTmp[k];
        if (wk > 1e-5) hc += BIOME_HEIGHT_FUNCS[k](M, Ms, det, rr) * wk;
      }
    } else {                                           // 盆地:盆形下沉+缘丘+细波(rr<0,首项为负=下沉)
      var normX = ax / slopeStartW, normZ = z / slopeStartL;   // 去镜像:语义上吃真实 z(rn 取平方,数值与 |z| 版一致)
      var rn = Math.sqrt(normX * normX + normZ * normZ); if (rn > 1) rn = 1;
      var ub = clamp((rn - 0.35) / 0.65, 0, 1);        // 盆形:中心 1 → 边 0(smoothstep)
      var bowl = 1 - ub * ub * (3 - 2 * ub);
      var ur = clamp((rn - 0.55) / 0.45, 0, 1);        // 缘丘带:半径 0.55 外环渐入
      var rimK = ur * ur * (3 - 2 * ur);
      hc = rr * (22 * bowl - 9 * Ms * rimK - 7 * det);
    }
    h += hc * (1 - fade) * 4;   // (N1)崎岖度对中央地形的影响过弱:整体放大到 4× (rough±100 由 ±26m→约 ±104m)
    if (typeof wonderAt === 'function' && typeof wLat !== 'undefined' && wLat)   // 奇观层:独立缩放 wonderScale+同包络,高度绝对值(不 ×4)
      h += wonderAt(x, z) * (1 - fade) * (typeof wonderScale === 'function' ? wonderScale(MAP.rough) : (rr < 0 ? -rr : rr));
  }
  return h;
}
/* terrainBase 查找表(格点采样;低频大尺度分量,覆盖 ±(half+10)):
   格距 = max(弹坑网格格距, 贝塞尔最细层波长/4)——主/细节层波长 ≥ cpStep/6,
   物理与视觉网格同走此表,再用同一套三角权重做格内插值,逐点一致。
   惰性构建(首次 terrainH 调用时一次性);terrainH 每次省去贝塞尔/渐隐求值。
   建场路径(丘陵环坡度)直接调用解析式 terrainBase,不走表——一次性成本不值得缓存。 */
var tbLatN = 0, tbLatMin = -1010, tbLatStep = 4, tbLat = null;
var TB_MAXH = 1e9;   // ★审查A1: 全图基础地形上界(建表时一次 O(N²) 扫描; laserRange 天向短路用; 1e9=未建表保守不短路)
/* 方案4:地形最大高度包络(低分辨率上界网格,构图后地形确定 → 一次性预烘焙)。
   LOS 地形遮挡的粗筛:若射线在整段的最低点(直线段=较低端点)仍高于沿途包络上界,
   则必然无地形遮挡,可跳过 isRadarLineOccludedByTerrain 的最多 60 次 terrainH 精采样。
   包络格值 = 该粗格覆盖区域内 terrainBase 细采样的最大值,并做 3×3 膨胀(相邻格取大),
   保证任一点落格即覆盖其所在及邻接格的真实地形;查询沿段按 teVStep 步进取格上界的最大值。
   坑缘(dentGrid rimH ≤ ~1.1m)与格内插值起伏用 TERR_ENV_MARGIN 安全余量吸收——
   包络恒为真实地形高度的严格上界,故"判定放行"绝不漏检遮挡(只可能保守回落精采样)。 */
var teVN = 0, teVStep = 64, teVMin = -1010, teVLat = null;   // 包络网格(惰性随 tbLat 一并重建)
var TERR_ENV_MARGIN = 1.5;                                    // 上界安全余量(坑缘凸起 + 内插起伏)
function buildTerrainBaseTable() {
  if (!BQ.ready) biomeRebuild();                       // P2/P3:保证地貌分区场已就绪
  if (typeof wonderBuild === 'function') wonderBuild();   // 奇观:种子布点+粗格烘焙(Q1 同门废除:0 崎岖=平坦基底+奇观地标,2026-09-09)
  else { MAP.wonders = []; if (typeof wLat !== 'undefined') wLat = null; }   // 粗格不跨图残留(防旧表泄漏进新图)
  /* ★与视觉网格逐顶点对齐:步长=各自轴向格距,原点=−halfW/−halfL(=buildGroundMeshes 的顶点世界坐标),
     再配同一套三角权重,使 terrainH 与渲染网格在格内也是同一曲面。 */
  var nx = GRID_N, nz = GRID_N;
  tbLatStep = GRID_CELL;                               // 兼容旧读取(包络/诊断)
  tbLatMin = -MAP.halfW;
  tbLatN = nx;
  tbLat = new Float32Array(nz * nx);
  for (var iz = 0; iz < nz; iz++)
    for (var ix = 0; ix < nx; ix++)
      tbLat[iz * nx + ix] = terrainBase(-MAP.halfW + ix * GRID_CELL_X, -MAP.halfL + iz * GRID_CELL_Z);
  if (typeof hqFlattenApply === 'function') hqFlattenApply();   // HQ 50m 夷平后遍(基→奇观→夷平→包络,顺序即正义)
  TB_MAXH = -1e9;                                       // ★审查A1: 基础地形上界一次扫描(弹坑缘/内插起伏由 laserRange 侧加 TERR_ENV_MARGIN 裕量覆盖)
  for (var tmx = 0; tmx < tbLat.length; tmx++) if (tbLat[tmx] > TB_MAXH) TB_MAXH = tbLat[tmx];
  buildTerrainEnvelope();
}
/* 由已填充的 tbLat 细网格烘焙粗包络:每粗格取覆盖细采样最大值,再 3×3 膨胀。O(tbLatN²),仅换图一次。 */
function buildTerrainEnvelope() {
  teVMin = tbLatMin;
  teVStep = tbLatStep * 6;                            // ≈62m/粗格(细格的 6 倍)
  teVN = Math.ceil((tbLatN - 1) / 6) + 1;
  var raw = new Float32Array(teVN * teVN);
  for (var i = 0; i < raw.length; i++) raw[i] = -1e9;
  // 1. 每细采样点归入其粗格,取最大(相邻粗格重叠覆盖:每细点同时写入其前后粗格,消除跨格边界漏检)
  for (var fz = 0; fz < tbLatN; fz++) {
    var cz = (fz / 6) | 0;
    for (var fx = 0; fx < tbLatN; fx++) {
      var cx = (fx / 6) | 0;
      var h = tbLat[fz * tbLatN + fx];
      if (h > raw[cz * teVN + cx]) raw[cz * teVN + cx] = h;
    }
  }
  // 2. 3×3 膨胀:每粗格取自身及 8 邻域最大 → 覆盖任一点所在格及邻接格,配合步进≤teVStep 全覆盖
  teVLat = new Float32Array(teVN * teVN);
  for (var z = 0; z < teVN; z++)
    for (var x = 0; x < teVN; x++) {
      var m = -1e9;
      for (var dz = -1; dz <= 1; dz++) {
        var zz = z + dz; if (zz < 0 || zz >= teVN) continue;
        for (var dx = -1; dx <= 1; dx++) {
          var xx = x + dx; if (xx < 0 || xx >= teVN) continue;
          var v = raw[zz * teVN + xx]; if (v > m) m = v;
        }
      }
      teVLat[z * teVN + x] = m;
    }
}
/* 沿 XZ 线段取地形包络上界的最大值(按 teVStep 步进,粗格已 3×3 膨胀 → 步进覆盖无缝)。 */
function terrainEnvelopeMaxAlong(x0, z0, x1, z1) {
  if (!teVLat) return 1e9;                            // 未烘焙 → 返回极大值使调用方回落精采样
  var dx = x1 - x0, dz = z1 - z0;
  var seg = Math.sqrt(dx * dx + dz * dz);
  var n = Math.max(1, Math.ceil(seg / teVStep));
  var mx = -1e9;
  for (var i = 0; i <= n; i++) {
    var t = i / n;
    var px = x0 + dx * t, pz = z0 + dz * t;
    var ix = ((px - teVMin) / teVStep) | 0, iz = ((pz - teVMin) / teVStep) | 0;
    if (ix < 0) ix = 0; else if (ix > teVN - 1) ix = teVN - 1;
    if (iz < 0) iz = 0; else if (iz > teVN - 1) iz = teVN - 1;
    var v = teVLat[iz * teVN + ix]; if (v > mx) mx = v;
  }
  return mx;
}
/* 开局应用地图配置(菜单选择 → 世界参数):写 MAP、重算派生量(CONF.bounds/出生线/格距),
   清弹坑/焦土账本、置空查找表(惰性重建)。仅 setupMapWorld 开局调用一次。 */
function applyMapConfig(seed, rough, sideOrLen, mat, wid) {
  MAP.seed = String(seed == null ? '0' : seed);
  MAP.seedF = hashSeed(MAP.seed);
  MAP.rough = clamp(rough | 0, -100, 100);
  var lenVal = Math.max(100, Math.round(sideOrLen) || 2000);
  var widVal = Math.max(100, Math.round(wid != null ? wid : (typeof startMapWid !== 'undefined' ? startMapWid : sideOrLen)) || lenVal);
  MAP.len = lenVal;
  MAP.wid = widVal;
  MAP.halfL = lenVal / 2;
  MAP.halfW = widVal / 2;
  MAP.side = Math.max(lenVal, widVal);
  MAP.half = MAP.halfL;
  MAP.cpStep = MAP.side / 8;                          // 贝塞尔主波长随边长缩放
  MAP.mat = (mat === 'soil') ? 'soil' : 'grass';   // 保留字段:仅供旧调用点/扬尘色兜底,不再决定地貌
  biomeRebuild();                                   // P1:地貌分区场随 种子/边长 重建
  bzCacheReset();                                      // 重建贝塞尔控制点表(种子/边长已定)
  GRID_CELL = MAP.side / (GRID_N - 1);
  GRID_CELL_X = MAP.wid / (GRID_N - 1);
  GRID_CELL_Z = MAP.len / (GRID_N - 1);
  CONF.boundsX = MAP.halfW - 20;
  CONF.boundsZ = MAP.halfL - 20;
  CONF.bounds = Math.min(CONF.boundsX, CONF.boundsZ);                        // 活动界=地图边界内缩 20m
  CONF.redSpawnZ = MAP.halfL - 200;                   // 出生线=坡起点(half-150)再内 50m
  CONF.blueSpawnZ = -CONF.redSpawnZ;
  MAP.wonderSalt = '';
  MAP.hqFlat = (typeof hqLayoutCompute === 'function' && typeof hqParamsFromGlobals === 'function')
    ? hqLayoutCompute(hqParamsFromGlobals()) : null;   // HQ 布局前移:地形夷平与 spawnTeams 同源(方案 §5.1)
  dentGrid.fill(0);
  dentEpoch++;                                         // 换图=高度场整体重置,静止车缓存目标一并失效
  scorchGrid.fill(0);
  scorchVtxQ.fill(0);                                    // 顶点层焦土账本
  craterQueue.length = 0;                                // ★换图:待生效弹坑清空(上一局 0.3s 合批窗口内未冲压的弹坑不得带入新图)
  _cfPart = null;                                        // ★任务27⑤:半冲压坑的行级游标一并清空(旧图落点不得续冲进新图)
  scorchFieldBuild();                                    // 焦土像素层:按新边长重建瓦片/参数图并清空在册爆点
  tbLat = null;                                        // 触发 terrainH 惰性重建
  teVLat = null;                                        // 地形包络随基表一并惰性重建(换图=地形整体重置)
  return MAP.mat;
}
/* ★同源修复:基面采样必须与视觉网格走【同一套三角权重】——
   视觉顶点存格点高,GPU 在棋盘格交替三角面内插值;若物理另用双线性,
   两条路径在格子内部必然分叉(陡峭断裂带实测可达 ±0.6m,
   恰是"车陷入地面/地面自己起伏"的量级)。故这里改用与 buildGroundMeshes
   完全相同的奇偶规则与三角权重,tbLat 直接按 GRID_CELL 网格烘焙。 */
function terrainBaseCached(x, z) {
  var fx = (x + MAP.halfW) / GRID_CELL_X, fz = (z + MAP.halfL) / GRID_CELL_Z;
  var ix = Math.floor(fx), iz = Math.floor(fz);
  if (ix < 0) ix = 0; else if (ix > tbLatN - 2) ix = tbLatN - 2;
  if (iz < 0) iz = 0; else if (iz > tbLatN - 2) iz = tbLatN - 2;
  var tx = fx - ix, tz = fz - iz, i00 = iz * tbLatN + ix;
  var h00 = tbLat[i00], h10 = tbLat[i00 + 1], h01 = tbLat[i00 + tbLatN], h11 = tbLat[i00 + tbLatN + 1];
  if (groundCellParity(ix, iz) === 0) {
    if (tx + tz <= 1) return h00 * (1 - tx - tz) + h01 * tz + h10 * tx;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }
  if (tz <= tx) return h00 + (h10 - h00) * tx + (h11 - h10) * tz;
  return h00 + (h01 - h00) * tz + (h11 - h01) * tx;
}
/* ============================================================
   弹坑地形改造(火箭弹轰炸犁出的真实凹坑)
   —— dentGrid 高程增量网格(与地面顶点一一对应)是唯一真源:
      物理 terrainH 按视觉三角面采样它,视觉网格顶点/顶点色同步改写,
      坦克开进坑会下陷、弹道命中随坑缘起伏、视觉=物理。
   ============================================================ */
/* 地形顶点分辨率:481 → 721(格距由 边长/480 改成 边长/720)。
   格距直接决定「弹坑半径的网格分辨下限」能把坑压到多小 —— 提高分辨率是唯一能在
   不放大弹坑的前提下继续改善坑形的手段。代价:三角形 46.1 万 → 103.7 万(×2.25),
   顶点相关常驻内存 +约 23MB,开局建场时间约 ×2。改这一个常量即可,
   下面的 GRID_CELL / CHUNK_CELLS / CHUNK_VERTS 全部由它派生。 */
var GRID_N = 721, GRID_CELL = MAP.side / (GRID_N - 1), GRID_CELL_X = GRID_CELL, GRID_CELL_Z = GRID_CELL;      // 格距=边长/720(2km≈2.78m/格,12km≈16.7m/格);applyMapConfig 按边长重算
var dentGrid = new Float32Array(GRID_N * GRID_N);  // 每顶点累积高程增量(初始 0)
var dentEpoch = 0;                                 // 弹坑纪元:dentGrid 任何改写处 ++(alignTank 静止触发器判据:位置未动+纪元未变=贴地目标必然不变)
var scorchGrid = new Float32Array(GRID_N * GRID_N);// 每顶点焦土强度 q=1-r/RINF(0..1;植被判定/换肤重放的唯一真源)
var scorchVtxQ = new Uint8Array(GRID_N * GRID_N); // 顶点层已烘焦度(×255,只增不减;像素层的兜底与换肤重放账本)
var groundBaseCol = null;
var groundBaseRock = null;   /* G2-slopefix: pre-scorch rock color (global index, mirrors groundBaseCol) */                          // 地面基准色(全局索引,换肤/焦土重放用;cz 起视觉网格=groundChunks 分块)
/* 地面 8×8 分块——每块 61×61 顶点(边长÷8,2km=250×250m;边界顶点两侧复制,dentGrid 同源自动无缝);
   每块独立包围球 → three.js 原生视锥剔除生效(旧单张 2km 网格包围球恒在视锥内,46 万三角形每帧全渲);
   弹坑/夷平只写脏块,上传粒度=块(替代 cw updateRange:散布弹坑不再退化为宽区间)。 */
var CHUNK_N = 8, CHUNK_CELLS = (GRID_N - 1) / CHUNK_N, CHUNK_VERTS = CHUNK_CELLS + 1;   // 由 GRID_N 派生(721 → 90 / 91)
var groundChunks = [];                             // [{mesh, geo, pos, col, nrm}](chunkId = cx·8+cz)
var chunkDirty = new Uint8Array(CHUNK_N * CHUNK_N);
var AX_C0 = new Int8Array(GRID_N), AX_L0 = new Uint8Array(GRID_N), AX_C1 = new Int8Array(GRID_N);   // 全局行/列 → 所属块(边界双份)
(function () {
  for (var i = 0; i < GRID_N; i++) {
    var c = Math.min(CHUNK_N - 1, (i / CHUNK_CELLS) | 0);
    AX_C0[i] = c; AX_L0[i] = i - c * CHUNK_CELLS;
    AX_C1[i] = (i > 0 && i < CHUNK_CELLS * CHUNK_N && i % CHUNK_CELLS === 0) ? c - 1 : -1;   // 块边界列同属左块(局部 CHUNK_CELLS)
  }
})();
var craterQueue = [], craterFlushT = 0;          // 待生效弹坑(节流批量改写)
var nrmMark = new Int32Array(GRID_N * GRID_N), nrmMarkId = 0, nrmTouched = [];   // 增量法线脏标记(版本号去重)
var _crN = new THREE.Vector3();                  // 解析法线暂存
/* ===== 分块顶点写入助手(边界顶点自动双/四份同步 + 脏块标记)===== */
function gndAddY(gi, dy) {                       // 弹坑/夷平高度增量写入(全部块副本)
  var ix = gi % GRID_N, iz = (gi / GRID_N) | 0;
  var ax = AX_C0[ix], bx = AX_C1[ix], az = AX_C0[iz], bz = AX_C1[iz];
  var lx = AX_L0[ix], lz = AX_L0[iz];
  var A = groundChunks[ax * CHUNK_N + az].pos.array, li = lz * CHUNK_VERTS + lx;
  A[li * 3 + 1] += dy; chunkDirty[ax * CHUNK_N + az] = 1;
  if (bx >= 0) { A = groundChunks[bx * CHUNK_N + az].pos.array; li = lz * CHUNK_VERTS + CHUNK_CELLS; A[li * 3 + 1] += dy; chunkDirty[bx * CHUNK_N + az] = 1; }
  if (bz >= 0) { A = groundChunks[ax * CHUNK_N + bz].pos.array; li = CHUNK_CELLS * CHUNK_VERTS + lx; A[li * 3 + 1] += dy; chunkDirty[ax * CHUNK_N + bz] = 1; }
  if (bx >= 0 && bz >= 0) { A = groundChunks[bx * CHUNK_N + bz].pos.array; li = CHUNK_CELLS * CHUNK_VERTS + CHUNK_CELLS; A[li * 3 + 1] += dy; chunkDirty[bx * CHUNK_N + bz] = 1; }
}
function gndSetColor(gi, r, g, b, rr, gg, bb) {              // 焦土混色写入(全部块副本)
  var ix = gi % GRID_N, iz = (gi / GRID_N) | 0;
  var ax = AX_C0[ix], bx = AX_C1[ix], az = AX_C0[iz], bz = AX_C1[iz];
  var lx = AX_L0[ix], lz = AX_L0[iz];
  var A = groundChunks[ax * CHUNK_N + az].col.array, li = (lz * CHUNK_VERTS + lx) * 3;
  A[li] = r; A[li + 1] = g; A[li + 2] = b; chunkDirty[ax * CHUNK_N + az] = 1;
  if (rr !== undefined) { var RA0 = groundChunks[ax * CHUNK_N + az].rock.array; RA0[li] = rr; RA0[li + 1] = gg; RA0[li + 2] = bb; }
  if (bx >= 0) { A = groundChunks[bx * CHUNK_N + az].col.array; li = (lz * CHUNK_VERTS + CHUNK_CELLS) * 3; A[li] = r; A[li + 1] = g; A[li + 2] = b; chunkDirty[bx * CHUNK_N + az] = 1; if (rr !== undefined) { A = groundChunks[bx * CHUNK_N + az].rock.array; A[li] = rr; A[li + 1] = gg; A[li + 2] = bb; } }
  if (bz >= 0) { A = groundChunks[ax * CHUNK_N + bz].col.array; li = (CHUNK_CELLS * CHUNK_VERTS + lx) * 3; A[li] = r; A[li + 1] = g; A[li + 2] = b; chunkDirty[ax * CHUNK_N + bz] = 1; if (rr !== undefined) { A = groundChunks[ax * CHUNK_N + bz].rock.array; A[li] = rr; A[li + 1] = gg; A[li + 2] = bb; } }
  if (bx >= 0 && bz >= 0) { A = groundChunks[bx * CHUNK_N + bz].col.array; li = (CHUNK_CELLS * CHUNK_VERTS + CHUNK_CELLS) * 3; A[li] = r; A[li + 1] = g; A[li + 2] = b; chunkDirty[bx * CHUNK_N + bz] = 1; if (rr !== undefined) { A = groundChunks[bx * CHUNK_N + bz].rock.array; A[li] = rr; A[li + 1] = gg; A[li + 2] = bb; } }
}
function gndSetNormal(gi) {                      // 解析法线写入(全部块副本;_crN 须先由 terrainNormal 填好)
  var ix = gi % GRID_N, iz = (gi / GRID_N) | 0;
  var ax = AX_C0[ix], bx = AX_C1[ix], az = AX_C0[iz], bz = AX_C1[iz];
  var lx = AX_L0[ix], lz = AX_L0[iz];
  var A = groundChunks[ax * CHUNK_N + az].nrm.array, li = (lz * CHUNK_VERTS + lx) * 3;
  A[li] = _crN.x; A[li + 1] = _crN.y; A[li + 2] = _crN.z; chunkDirty[ax * CHUNK_N + az] = 1;
  if (bx >= 0) { A = groundChunks[bx * CHUNK_N + az].nrm.array; li = (lz * CHUNK_VERTS + CHUNK_CELLS) * 3; A[li] = _crN.x; A[li + 1] = _crN.y; A[li + 2] = _crN.z; chunkDirty[bx * CHUNK_N + az] = 1; }
  if (bz >= 0) { A = groundChunks[ax * CHUNK_N + bz].nrm.array; li = (CHUNK_CELLS * CHUNK_VERTS + lx) * 3; A[li] = _crN.x; A[li + 1] = _crN.y; A[li + 2] = _crN.z; chunkDirty[ax * CHUNK_N + bz] = 1; }
  if (bx >= 0 && bz >= 0) { A = groundChunks[bx * CHUNK_N + bz].nrm.array; li = (CHUNK_CELLS * CHUNK_VERTS + CHUNK_CELLS) * 3; A[li] = _crN.x; A[li + 1] = _crN.y; A[li + 2] = _crN.z; chunkDirty[bx * CHUNK_N + bz] = 1; }
}
/* 物理高度=基面格点高+弹坑格点增量,再按视觉网格的同一三角面插值。
   图内与 GPU 渲染面逐点一致;图外仍只计基面、不计弹坑,保持旧边界语义。 */
function terrainH(x, z) {
  if (!tbLat) buildTerrainBaseTable();        // 惰性构建(首次采样一次性;此后查表省贝塞尔/渐隐求值)
  var fx = (x + MAP.halfW) / GRID_CELL_X, fz = (z + MAP.halfL) / GRID_CELL_Z;
  var ix = Math.floor(fx), iz = Math.floor(fz);
  if (ix < 0 || iz < 0 || ix >= GRID_N - 1 || iz >= GRID_N - 1) return terrainBaseCached(x, z);
  var tx = fx - ix, tz = fz - iz, i00 = iz * GRID_N + ix;
  var h00 = tbLat[i00] + dentGrid[i00], h10 = tbLat[i00 + 1] + dentGrid[i00 + 1];
  var h01 = tbLat[i00 + GRID_N] + dentGrid[i00 + GRID_N], h11 = tbLat[i00 + GRID_N + 1] + dentGrid[i00 + GRID_N + 1];
  if (groundCellParity(ix, iz) === 0) {
    if (tx + tz <= 1) return h00 * (1 - tx - tz) + h01 * tz + h10 * tx;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }
  if (tz <= tx) return h00 + (h10 - h00) * tx + (h11 - h10) * tz;
  return h00 + (h01 - h00) * tz + (h11 - h01) * tx;
}
// 单个弹坑剖面:中心下凹(高斯) + 坑缘一圈上凸(环状高斯) + 焦土加权
function craterProfile(r, R, D, rimH) {
  var rc = r / (R * 0.68), rr = (r - R) / (R * 0.30);
  return -D * Math.exp(-rc * rc) + rimH * Math.exp(-rr * rr);
}
/* 弹坑半径 —— 与爆炸波及半径严格线性关联(22m→14m,11m→7m),并设「网格分辨下限」:
   顶点间距 GRID_CELL = 边长/720(6km 图 = 8.3m、12km 图 = 16.7m)接近或大于弹坑半径(14m)时,一发弹坑只
   压到 3×3 个顶点上,无论怎么改剖面曲线都是一座棱锥而不是圆坑。故给半径设下限
   CRATER_MIN_CELLS 格(默认 2.0):2km 图(2.78m/格)不触发;6km 图 14→16.7m;
   12km 图由 14m 抬到 33.3m(改为 721 顶点前的 481 格版本要抬到 50m)。
   ★深度 D / 坑缘 rimH 仍按爆炸当量表、不随 R 放大 —— 否则大图上会犁出能卡住坦克的深坑,
     放大后的坑是「宽浅碟形」,既圆又不影响通行。 */
var CRATER_MIN_CELLS = 2.0;
function craterRadiusOf(rSp) { return Math.max(rSp * (14.0 / 22.0), GRID_CELL * CRATER_MIN_CELLS); }
/* 径向超采样冲压:中心权 0.25 + 6 点环(环半径 0.5 格,60° 均布,权各 0.125)。
   等效于把剖面函数先与一个各向同性小核卷积再取样 —— 抽样结果只依赖到爆心的距离,
   与爆心落在格内的相位无关。旧式单点取样的毛病:同一发弹落点差半格,冲压出的
   坑形就从「圆」变成「歪棱」,连续几发还会各歪各的(用户看到的"粗糙多边形")。
   副产物:高频被平滑,等值线更接近同心圆。 */
var _CR6X = [1, 0.5, -0.5, -1, -0.5, 0.5], _CR6Z = [0, 0.8660254, 0.8660254, 0, -0.8660254, -0.8660254];
/* 预滤波必然带来幅度损失(坑变浅)—— 实测 12km 图只剩 84% 坑深,对理想场 RMS 从
   13.6% 涨到 16.8%。用一个只与 (R, D, rimH) 有关的常数增益把爆心峰值补回标称深度:
   既保住抗锯齿收益(角度起伏 25.3%→21.6%),又不丢幅度(RMS 13.8%)。 */
var craterStampGain = function (R, D, rimH) {          // 峰值补偿增益(每坑算一次)
  var g0 = craterProfile(0, R, D, rimH), gs = craterStamp(0, 0, R, D, rimH);
  if (Math.abs(gs) < 1e-6) return 1;
  return clamp(g0 / gs, 1, 1.8);
};
function craterStamp(dx, dz, R, D, rimH) {
  var v = craterProfile(Math.sqrt(dx * dx + dz * dz), R, D, rimH) * 0.25, k;
  var hr = GRID_CELL * 0.5;
  for (k = 0; k < 6; k++) {
    var px = dx + _CR6X[k] * hr, pz = dz + _CR6Z[k] * hr;
    v += craterProfile(Math.sqrt(px * px + pz * pz), R, D, rimH) * 0.125;
  }
  return v;
}
/* ============================================================
   焦土模型(顶点层 / 像素层 / 植被判定 三层共用同一配方)
   ★统一归一化坐标 u = r / RINF ∈ [0,1](0=爆心,1=焦土外缘):
       q  = 1 - u         —— scorchGrid 存储量(storage semantics: 1 = center, 0 = edge)
       f  = scorchF(u)    —— 焦土权重(0=原色,1=全焦),顶点混色与片元混色同式
       tg = scorchTg(u)   —— 色阶(0=炭黑心,1=烬褐边)
   ★换配方的原因(修「粗糙多边形边界」+「过渡带过窄」两条):
     旧 f = clamp(q^0.72 × 1.62, 0, 0.985) 是一条「顶端削平的幂曲线」—— 在 f 归零处
     斜率极大,等值线紧贴 RINF 圆环骤降(视觉上就是一圈硬边);而它又只在顶点上取值,
     顶点间距 GRID_CELL = 边长/720(12km 图 = 16.7m)接近甚至大于弹坑/焦土尺度,整个焦土
     只覆盖 3×3~15×15 个顶点 —— 于是「圆」只能退化成 3×3 方格的八边形轮廓。
     新式改用 smoothstep:两端一阶导为 0,过渡带宽度 ≈58% RINF(旧式 ≈50% 但内侧
     骤升),等值线在任意网格密度 / 任意观察距离下都是平滑同心圆。
   ============================================================ */
var SC_F_IN = 0.42, SC_F_OUT = 1.00;        // 焦土权重 smoothstep 区间(u):<0.42 恒定黑心,1.0 归零
var SC_T_IN = 0.19, SC_T_OUT = 1.00;        // 色阶 smoothstep 区间(u):炭黑心 → 烬褐边
var SC_CHAR = [0.022, 0.018, 0.014];        // 炭黑心(死黑,微暖)
var SC_ASH  = [0.255, 0.200, 0.148];        // 外缘烬褐
function _ss01(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function scorchF(u)     { return 1 - _ss01(SC_F_IN, SC_F_OUT, u); }   // 焦土权重 0..1
function scorchTg(u)    { return _ss01(SC_T_IN, SC_T_OUT, u); }       // 色阶 0..1
function scorchMixAt(u) { return scorchF(u) * 0.985; }                // 实际混色权重(留 1.5% 底色,免死板)
function scorchUForF(f) {                                             // smoothstep 反解:焦土权重 f → 归一化半径 u
  var c = clamp(1 - f, 0, 1);
  var t = 0.5 - Math.sin(Math.asin(1 - 2 * c) / 3);
  return SC_F_IN + (SC_F_OUT - SC_F_IN) * t;
}
var _scTgt = [0, 0, 0];
function scorchColInto(u, out) {            // 归一化半径 u 处的焦土色(零分配)
  var g = scorchTg(u);
  out[0] = SC_CHAR[0] + (SC_ASH[0] - SC_CHAR[0]) * g;
  out[1] = SC_CHAR[1] + (SC_ASH[1] - SC_CHAR[1]) * g;
  out[2] = SC_CHAR[2] + (SC_ASH[2] - SC_CHAR[2]) * g;
  return out;
}

/* ============================================================
   焦土像素层:世界瓦片索引的解析 splat(与地形顶点网格彻底解耦)
   —— 只要把焦土烘进顶点色,等值线就只能沿三角面的边走;顶点间距远大于焦土尺度时,
      再怎么调曲线也只能是多边形。故把「着色」搬到片元里按到爆心的真实距离解析求值:
      无论地图多大、网格多粗、镜头拉多近,焦土与过渡带恒为正圆且一阶连续。
   · 瓦片:SC_TILE 米一格,每瓦片 12 个爆点槽(三张 RGBA8 瓦片图各 4 槽)。
      片元只查自己所在的那一片 → 每像素固定 3 次槽位取样 + ≤12 次参数取样,
      开销与场上爆点总数无关(O(1)),不随战况增长。
   · 参数图:256×2 RGBA8(纯 8bit 编码,不依赖 float 纹理扩展,WebGL1 亦可用):
      texel(id,0) = [x 高8, x 低8, z 高8, z 低8]  (1m 精度,±32km)
      texel(id,1) = [RINF(1m 精度), 0, 0, 255]
   · 槽位上限 SC_MAX = 240(8bit 槽号 1..240,0=空)。触顶后新爆点不再登记像素层,
      自动退回顶点层(顶点层逐坑都烘,永不哑火)—— 容量是画质降级开关,不是功能开关。
   ============================================================ */
var SC_TILE = 64;                   // 世界瓦片边长(m) —— 5c: 原 128m;64m 后单瓦片承载爆点数降约 1.8×,
                                    // 配合槽位驱逐(见 _scSlotPut)基本消除焦土过渡带被瓦片边界直线割裂
var SC_MAX  = 240;                  // 像素层在册爆点上限
var SC_PARAM_N = 256;               // 参数图宽
var scTN = 64, scOrigin = 0;        // 瓦片图边长 / 瓦片(0,0) 最小角的世界坐标
var scSlotA = null, scSlotB = null, scSlotC = null, scSlotTA = null, scSlotTB = null, scSlotTC = null, scParamT = null;
var scParamData = null, scCount = 0;
var scUniform = null;               // 注入地面材质的 uniform 集合(与材质共享对象引用)
var scWarned = false;
var scTileWarned = false;          // 5c: 瓦片 12 槽全满、触发驱逐(仅告警一次)
function _scTex(arr, w, h) {                     // 8bit 数据图:最近邻 / 夹边 / 无 mip
  var t = new THREE.DataTexture(arr, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}
function scorchFieldBuild() {                    // 按当前 MAP.side 重建(applyMapConfig 调用一次)
  if (typeof THREE === 'undefined' || !THREE.DataTexture) return;
  if (scSlotTA) { scSlotTA.dispose(); scSlotTB.dispose(); scSlotTC.dispose(); scParamT.dispose(); }   // 换图:释放上一局的数据图
  var need = Math.ceil(MAP.side / SC_TILE) + 2;              // 覆盖全图 + 两侧各留一格
  var n = 64; while (n < need) n *= 2; if (n > 512) n = 512;
  scTN = n; scOrigin = -n * SC_TILE * 0.5;
  scSlotA = new Uint8Array(n * n * 4); scSlotB = new Uint8Array(n * n * 4); scSlotC = new Uint8Array(n * n * 4);
  scParamData = new Uint8Array(SC_PARAM_N * 2 * 4);
  scSlotTA = _scTex(scSlotA, n, n); scSlotTB = _scTex(scSlotB, n, n); scSlotTC = _scTex(scSlotC, n, n);
  scParamT = _scTex(scParamData, SC_PARAM_N, 2);
  scCount = 0; scWarned = false;
  if (scUniform) {
    scUniform.uScSlotA.value = scSlotTA; scUniform.uScSlotB.value = scSlotTB; scUniform.uScSlotC.value = scSlotTC;
    scUniform.uScParam.value = scParamT;
    scUniform.uScOrigin.value = scOrigin; scUniform.uScTexN.value = scTN; scUniform.uScTile.value = SC_TILE;
  }
}
/* 5c 槽位登记:优先填空槽;12 槽全满时驱逐「对本瓦片最不相关」的那一个, 而不是静默丢弃。
   原写法在三个内层 for 全部落空时什么都不做 —— 同一发爆点在部分瓦片登记成功、相邻瓦片缺失,
   焦土过渡带沿瓦片边界被切成直线(报告 §2.2 根因)。驱逐后新爆点必定在自己覆盖的每一片瓦片里
   可见, 代价是极端过载时某个距该瓦片最远、半径最小的旧焦土从这一片消失(远比直线割裂轻微)。 */
function _scSplatScore(sid, cx, cz) {            // 越大 = 对本瓦片越不相关(远 且 小)
  if (sid < 1) return -1e18;                     // 空槽不参与驱逐
  var b0 = (sid - 1) * 4, b1 = SC_PARAM_N * 4 + (sid - 1) * 4;
  var sx = scParamData[b0] * 256 + scParamData[b0 + 1] - 32768;
  var sz = scParamData[b0 + 2] * 256 + scParamData[b0 + 3] - 32768;
  var sr = Math.max(scParamData[b1], 1);
  var dx = sx - cx, dz = sz - cz;
  return Math.sqrt(dx * dx + dz * dz) / sr;
}
function _scSlotPut(o, sv, tx, tz) {              // o = 瓦片槽位字节偏移; 返回是否登记成功
  var i;
  for (i = 0; i < 4; i++) if (scSlotA[o + i] === 0) { scSlotA[o + i] = sv; return true; }
  for (i = 0; i < 4; i++) if (scSlotB[o + i] === 0) { scSlotB[o + i] = sv; return true; }
  for (i = 0; i < 4; i++) if (scSlotC[o + i] === 0) { scSlotC[o + i] = sv; return true; }
  var cx = scOrigin + (tx + 0.5) * SC_TILE, cz = scOrigin + (tz + 0.5) * SC_TILE;
  var worst = -1e18, wArr = scSlotA, wi = 0;
  var arrs = [scSlotA, scSlotB, scSlotC];
  for (var a = 0; a < 3; a++) for (i = 0; i < 4; i++) {
    var sc = _scSplatScore(arrs[a][o + i], cx, cz);
    if (sc > worst) { worst = sc; wArr = arrs[a]; wi = i; }   // 严格大于: 并列取靠前的槽
  }
  if (!scTileWarned) { scTileWarned = true; if (typeof console !== 'undefined') console.warn('[scorch] tile slots full, evicting least relevant splat'); }
  wArr[o + wi] = sv;
  return true;
}
function scorchSplatAdd(x, z, RINF) {            // 登记一个爆点到像素层
  if (!scSlotA || !scParamT) return;
  if (scCount >= SC_MAX) {
    if (!scWarned) { scWarned = true; if (typeof console !== 'undefined') console.warn('[scorch] pixel layer full(' + SC_MAX + '), falling back to vertex layer'); }
    return;
  }
  var id = scCount++, sv = id + 1, i;
  var px = clamp(Math.round(x + 32768), 0, 65535), pz = clamp(Math.round(z + 32768), 0, 65535);
  var ri = clamp(Math.round(RINF), 1, 255);
  var b0 = id * 4, b1 = SC_PARAM_N * 4 + id * 4;
  scParamData[b0] = (px >> 8) & 255; scParamData[b0 + 1] = px & 255;
  scParamData[b0 + 2] = (pz >> 8) & 255; scParamData[b0 + 3] = pz & 255;
  scParamData[b1] = ri; scParamData[b1 + 1] = 0; scParamData[b1 + 2] = 0; scParamData[b1 + 3] = 255;
  scParamT.needsUpdate = true;
  var t0x = Math.max(0, Math.floor((x - RINF - scOrigin) / SC_TILE)), t1x = Math.min(scTN - 1, Math.floor((x + RINF - scOrigin) / SC_TILE));
  var t0z = Math.max(0, Math.floor((z - RINF - scOrigin) / SC_TILE)), t1z = Math.min(scTN - 1, Math.floor((z + RINF - scOrigin) / SC_TILE));
  for (var tz = t0z; tz <= t1z; tz++) for (var tx = t0x; tx <= t1x; tx++) {
    _scSlotPut((tz * scTN + tx) * 4, sv, tx, tz);          // 5c: 槽位登记(满则驱逐, 不静默丢弃)
  }
  scSlotTA.needsUpdate = true; scSlotTB.needsUpdate = true; scSlotTC.needsUpdate = true;
}
/* 地面材质注入:片元里按世界坐标解析求值焦土(正圆 + 平滑过渡带)。
   顶点层照旧烘一份(半径内缩 2 格,保证它不会在解析圆之外留下多边形暗晕);
   两层是叠加而非二选一 —— 万一注入失效,顶点层仍是完整可用的兜底。 */
var SCORCH_VS_HEAD = 'varying vec3 vScW;';
var SCORCH_VS_BODY = 'vScW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;';
var SCORCH_FS_HEAD = [
  'varying vec3 vScW;',
  'uniform sampler2D uScSlotA;',
  'uniform sampler2D uScSlotB;',
  'uniform sampler2D uScSlotC;',
  'uniform sampler2D uScParam;',
  'uniform float uScOrigin;',
  'uniform float uScTexN;',
  'uniform float uScTile;',
  'uniform float uScFIn;',
  'uniform float uScFOut;',
  'uniform float uScTIn;',
  'uniform float uScTOut;',
  'uniform vec3 uScChar;',
  'uniform vec3 uScAsh;',
  '#define SC_HIT(IDX) { float _i = (IDX); if ( _i > 0.5 ) { \\',
  '  float _pu = ( _i - 0.5 ) / 256.0; \\',
  '  vec4 _p0 = texture2D( uScParam, vec2( _pu, 0.25 ) ); \\',
  '  vec4 _p1 = texture2D( uScParam, vec2( _pu, 0.75 ) ); \\',
  '  vec2 _c = vec2( _p0.x * 65280.0 + _p0.y * 255.0 - 32768.0, _p0.z * 65280.0 + _p0.w * 255.0 - 32768.0 ); \\',
  '  float _u = clamp( length( vScW.xz - _c ) / max( _p1.x * 255.0, 1.0 ), 0.0, 1.0 ); \\',
  '  float _ff = 1.0 - smoothstep( uScFIn, uScFOut, _u ); \\',
  '  if ( _ff > _f ) { _f = _ff; _tg = smoothstep( uScTIn, uScTOut, _u ); } } }'
].join('\n');
var SCORCH_FS_BODY = [
  'vec2 _tij = floor( ( vScW.xz - uScOrigin ) / uScTile );',
  '_tij = clamp( _tij, vec2( 0.0 ), vec2( uScTexN - 1.0 ) );',
  'vec2 _tuv = ( _tij + 0.5 ) / uScTexN;',
  'float _f = 0.0; float _tg = 0.0;',
  'vec4 _sA = texture2D( uScSlotA, _tuv ) * 255.0;',
  'vec4 _sB = texture2D( uScSlotB, _tuv ) * 255.0;',
  'vec4 _sC = texture2D( uScSlotC, _tuv ) * 255.0;',
  'SC_HIT( _sA.x ) SC_HIT( _sA.y ) SC_HIT( _sA.z ) SC_HIT( _sA.w )',
  'SC_HIT( _sB.x ) SC_HIT( _sB.y ) SC_HIT( _sB.z ) SC_HIT( _sB.w )',
  'SC_HIT( _sC.x ) SC_HIT( _sC.y ) SC_HIT( _sC.z ) SC_HIT( _sC.w )',
  'if ( _f > 0.0 ) {',
  '  diffuseColor.rgb = mix( diffuseColor.rgb, mix( uScChar, uScAsh, _tg ), _f * 0.985 );',
  '}',
  'diffuseColor.a = 0.0;'
].join('\n');
function scorchPatchMaterial(mat) {
  if (!mat || mat.__scorchPatched) return mat;
  mat.__scorchPatched = 1;
  scUniform = {
    uScSlotA: { value: scSlotTA }, uScSlotB: { value: scSlotTB }, uScSlotC: { value: scSlotTC },
    uScParam: { value: scParamT },
    uScOrigin: { value: scOrigin }, uScTexN: { value: scTN }, uScTile: { value: SC_TILE },
    uScFIn: { value: SC_F_IN }, uScFOut: { value: SC_F_OUT },
    uScTIn: { value: SC_T_IN }, uScTOut: { value: SC_T_OUT },
    uScChar: { value: new THREE.Vector3(SC_CHAR[0], SC_CHAR[1], SC_CHAR[2]) },
    uScAsh:  { value: new THREE.Vector3(SC_ASH[0], SC_ASH[1], SC_ASH[2]) }
  };
  mat.onBeforeCompile = function (shader) {
    shader.uniforms.uScSlotA = scUniform.uScSlotA;
    shader.uniforms.uScSlotB = scUniform.uScSlotB;
    shader.uniforms.uScSlotC = scUniform.uScSlotC;
    shader.uniforms.uScParam = scUniform.uScParam;
    shader.uniforms.uScOrigin = scUniform.uScOrigin;
    shader.uniforms.uScTexN = scUniform.uScTexN;
    shader.uniforms.uScTile = scUniform.uScTile;
    shader.uniforms.uScFIn = scUniform.uScFIn;
    shader.uniforms.uScFOut = scUniform.uScFOut;
    shader.uniforms.uScTIn = scUniform.uScTIn;
    shader.uniforms.uScTOut = scUniform.uScTOut;
    shader.uniforms.uScChar = scUniform.uScChar;
    shader.uniforms.uScAsh = scUniform.uScAsh;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + SCORCH_VS_HEAD)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SCORCH_VS_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SCORCH_FS_HEAD)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + SCORCH_FS_BODY);
  };
  mat.customProgramCacheKey = function () { return 'ground-scorch-v1'; };
  return mat;
}
/* 大本营区域地形保护因子: 严格限制在大本营区域内(半径 34m~40m 平滑过渡),
   保护重新部署区地面不被弹坑破坏(凹坑/凸起高度增量归零),避免重新部署的载具被地形卡死 */
var HQ_PROTECT_R_INNER = 34.0; // 核心保护半径 (完全免受地形破坏,覆盖 30m 重新部署环形点)
var HQ_PROTECT_R_OUTER = 40.0; // 外缘平滑过渡半径 (平滑过渡至自然弹坑)
/* 全部大本营的外缘包围盒(buildHQ 逐座扩张)。本函数被弹坑逐格与植被逐株高频调用,
   而 18 座大本营的保护区合计只占战场极小一片 —— 先用包围盒一次性排除绝大多数落点,
   再进逐座距离比较。盒外恒返回 1.0(全额地形破坏),与逐座比较结果等价。 */
var _hqBBminX = Infinity, _hqBBmaxX = -Infinity, _hqBBminZ = Infinity, _hqBBmaxZ = -Infinity;
function hqBoundsAdd(x, z) {
  var r = HQ_PROTECT_R_OUTER;
  if (x - r < _hqBBminX) _hqBBminX = x - r;
  if (x + r > _hqBBmaxX) _hqBBmaxX = x + r;
  if (z - r < _hqBBminZ) _hqBBminZ = z - r;
  if (z + r > _hqBBmaxZ) _hqBBmaxZ = z + r;
}

function getHQZoneDeformFactor(wx, wz) {
  if ((typeof isFfaMode === 'function' && isFfaMode()) || typeof hqList === 'undefined' || !hqList) return 1.0;
  if (wx < _hqBBminX || wx > _hqBBmaxX || wz < _hqBBminZ || wz > _hqBBmaxZ) return 1.0;   // 包围盒早退
  var minDistSq = Infinity;
var hqsRed = hqList.red, hqsBlue = hqList.blue;
if (hqsRed) {
for (var i = 0; i < hqsRed.length; i++) {
var hq = hqsRed[i];
      var dx = wx - hq.x, dz = wz - hq.z;
      var dSq = dx * dx + dz * dz;
      if (dSq < minDistSq) minDistSq = dSq;
    }
  }
if (hqsBlue) {
for (var j = 0; j < hqsBlue.length; j++) {
var hq2 = hqsBlue[j];
      var dx2 = wx - hq2.x, dz2 = wz - hq2.z;
      var dSq2 = dx2 * dx2 + dz2 * dz2;
      if (dSq2 < minDistSq) minDistSq = dSq2;
    }
  }
  var rInnerSq = HQ_PROTECT_R_INNER * HQ_PROTECT_R_INNER;
  var rOuterSq = HQ_PROTECT_R_OUTER * HQ_PROTECT_R_OUTER;
  if (minDistSq <= rInnerSq) return 0.0; // 大本营核心区域: 地形变形量完全归零
  if (minDistSq >= rOuterSq) return 1.0; // 大本营区域外: 正常全额地形破坏
  var d = Math.sqrt(minDistSq);
  var t = (d - HQ_PROTECT_R_INNER) / (HQ_PROTECT_R_OUTER - HQ_PROTECT_R_INNER);
  return t * t * (3.0 - 2.0 * t); // smoothstep 平滑过渡,杜绝几何撕裂与硬边缘
}

/* 爆炸对植被的清除范围必须与「可见焦土范围」同源,否则焦土过渡带里会立着完好的树/花草丛
   —— 旧式:倒树 0.62×rSplash、毁草 0.72×rSplash,而焦土外缘 RINF = 2.4R = 1.527×rSplash,
      外圈约 60% 的焦土环带上植被原样保留,焦土看着像"贴在地上的一张黑纸"。
   分两档,尺子就是焦土权重 f(与顶点层/像素层同一配方):
     · f ≥ SC_VEG_HARD(黑心 ~0.69 RINF 内)必杀 —— 焦土黑心里长着完好树冠最刺眼;
     · SC_VEG_SOFT < f < SC_VEG_HARD(过渡带)按 f 线性概率清除,边缘参差自然;
     · f ≤ SC_VEG_SOFT(焦土外缘之外)不杀。
   概率取逐格确定性哈希而非 Math.random,使「当场炸掉」与「区块卸载后按 _sprInScorch
   重建」逐株一致 —— 否则玩家走开再走回来,焦土上的植被会自己长回来。 */
var SC_VEG_HARD = 0.55, SC_VEG_SOFT = 0.05;      // 必杀 / 概率环的焦土权重门限
function scorchVegKillP(f) {                     // 焦土权重 f → 植被清除概率 0..1
  if (f >= SC_VEG_HARD) return 1;
  if (f <= SC_VEG_SOFT) return 0;
  return (f - SC_VEG_SOFT) / (SC_VEG_HARD - SC_VEG_SOFT);
}
function queueCrater(x, z, rSplash) {
  if (Math.abs(x) > MAP.halfW - GRID_CELL_X || Math.abs(z) > MAP.halfL - GRID_CELL_Z) return;   // 网格边界(按各自轴向)
  var rSp = rSplash != null ? rSplash : 22.0;
  craterQueue.push(x, z, rSp);
  var RINF = craterRadiusOf(rSp) * 2.4;                                    // 与 flushCraters 同一把尺子
  if (typeof scorchClearVegetation === 'function') scorchClearVegetation(x, z, RINF);   // 焦土区植被一律清除(树 + 花草丛)
}
/* ===== 地形形变后的贴地物重锚(6a 残骸 / 6b 树桩)=====
   dentGrid 是高度场唯一真源, 而它在 flushCraters 里改写(批处理窗口 0.3s)。
   任何「生成时烘一次 y」的贴地物在窗口之后脚下地面已经变了:
     残骸 —— killTank 不写 y, 沿用死亡前最后一帧 alignTank 的结果(冻结);
     树桩 —— 直接继承 tr.y(建树时的 terrainH, 冻结)。
   火箭弹 R=14m / D=1.6m, 爆心下沉 1.6m → 原地不动的残骸与树桩悬空。
   dentEpoch 已是「高度场已变」信号, 但只有 alignTank(活车)消费, 贴地物没有消费者。
   范式完全沿用既有 emberCrater(余烬):「爆心区抹除 + 波及区重锚固」两段式,
   只在 flushCraters 批次里事件驱动跑一次, 零每帧开销。
   残骸侧复用 wreckPushSide 的全套记账(区标脏/遮挡代理/格重注册/障碍复查/簇失效),
   与「残骸被推」走同一条已受预算管控的异步重建路径, 不新增系统。 ===== */
var REANCHOR_DEADBAND = 0.04;
var _reInf2 = [], _reHard2 = [], _reOut2 = [];   // 本批落点半径平方缓存(复用数组,零分配)                 // 位移死区(m):不足 4cm 不动作,免密集炮击反复重烘焙
function _stumpKillByScorch(st) {             // 树桩被焦土清除:同步清账本,防区块重载长回来
  if (st.sid == null || typeof _spriteDelta === 'undefined' || !_spriteDelta) return;
  var d = _spriteDelta.tree.get(st.sid);
  if (d) { d.stump = 0; d.gone = 1; }         // 树已倒(gone=1),清掉 stump 标记 → 重载不再落桩
  else _spriteDelta.tree.set(st.sid, { gone: 1, stump: 0 });
  if (typeof _stumpSids !== 'undefined' && _stumpSids) _stumpSids.delete(st.sid);
}
/* 6a 批前采样:对本批弹坑覆盖到的残骸记下「形变前的地面高」(零分配,记在残骸自身的 _wrkH0)。
   必须在 flushCraters 冲压之前调用 —— 冲压之后再采就已经晚了。
   flushCraters 整段同步执行,采样与重锚之间不存在残骸被推导致 x/z 变化的窗口。 */
function terrainChangedPreWrecks(q) {
  if (typeof wreckGrid === 'undefined' || !wreckGrid || !q || q.length < 3) return;
  var C = 20, qi, bx, bz, i;
  for (qi = 0; qi + 2 < q.length; qi += 3) {
    var cx = q[qi], cz = q[qi + 1];
    var RINF = craterRadiusOf(q[qi + 2] || 22.0) * 2.4;
    var r2 = RINF * RINF;
    for (bz = Math.floor((cz - RINF) / C); bz <= Math.floor((cz + RINF) / C); bz++)
      for (bx = Math.floor((cx - RINF) / C); bx <= Math.floor((cx + RINF) / C); bx++) {
        var arr = wreckGrid.get(bx * 4096 + bz);
        if (!arr) continue;
        for (i = 0; i < arr.length; i++) {
          var t = arr[i];
          if (!t || t.alive || !t.group || t._heliFalling) continue;   // 空中坠落中的直升机残骸有独立下落逻辑
          var p = t.group.position, dx = p.x - cx, dz = p.z - cz;
          if (dx * dx + dz * dz > r2) continue;
          t._wrkH0 = terrainH(p.x, p.z);
        }
      }
  }
}
function terrainChangedReanchor(points, rinf) {
  if (!points || points.length < 2) return;
  var nc = points.length >> 1, i, j, cx, cz, RINF;
  /* ① 残骸:20m 空间网格邻域查询(与 resolveCollisions 同一张表) */
  if (typeof wreckGrid !== 'undefined' && wreckGrid && typeof wreckList !== 'undefined' && wreckList.length) {
    for (j = 0; j < nc; j++) {
      cx = points[j * 2]; cz = points[j * 2 + 1];
      RINF = (rinf && rinf[j]) ? rinf[j] : 33.6;
      var r2 = RINF * RINF, C = 20;
      var bx0 = Math.floor((cx - RINF) / C), bx1 = Math.floor((cx + RINF) / C);
      var bz0 = Math.floor((cz - RINF) / C), bz1 = Math.floor((cz + RINF) / C);
      for (var bz = bz0; bz <= bz1; bz++) for (var bx = bx0; bx <= bx1; bx++) {
        var arr = wreckGrid.get(bx * 4096 + bz);
        if (!arr) continue;
        for (i = 0; i < arr.length; i++) {
          var t = arr[i];
          if (!t || t.alive || !t.group || t._heliFalling) continue;   // 空中坠落中的直升机残骸有独立下落逻辑
          var p = t.group.position, dx = p.x - cx, dz = p.z - cz;
          if (dx * dx + dz * dz > r2) continue;
          /* 地面位移增量法:批前 terrainChangedPreWrecks 已记下形变前的地面高 _wrkH0,
             这里 Δ = 形变后 − 形变前,原样加到残骸 y 上 —— 地面动多少、站上面的东西动多少。
             不依赖任何「离地偏移」历史状态,与 alignTank 多点支撑口径、半埋/叠堆全部相容。 */
          if (t._wrkH0 == null) continue;                              // 批前未采样(理论上不会发生):宁可不动,不猜
          var dy = terrainH(p.x, p.z) - t._wrkH0;
          t._wrkH0 = null;
          if (Math.abs(dy) < REANCHOR_DEADBAND) continue;
          p.y += dy; t.gDirty = true;
          if (typeof wreckPushSide === 'function') wreckPushSide(t);   // 复用「残骸被推」的全套记账
          else { if (typeof wckNoteMoved === 'function') wckNoteMoved(t); if (typeof wreckGridUpdate === 'function') wreckGridUpdate(t); }
        }
      }
    }
  }
  /* ② 树桩:全表单趟(≤1400,压实一次写完)——外循环走桩、内循环走本批落点,
        与 scorchClearVegetation 共用同一把 f 尺子与同一套逐格确定性哈希。 */
  if (typeof _stumps !== 'undefined' && _stumps && _stumps.length && typeof scorchUForF === 'function') {
    _reInf2.length = 0; _reHard2.length = 0; _reOut2.length = 0;
    for (j = 0; j < nc; j++) {
      var RR = (rinf && rinf[j]) ? rinf[j] : 33.6;
      var rh = scorchUForF(SC_VEG_HARD) * RR, ro = scorchUForF(SC_VEG_SOFT) * RR;
      _reInf2.push(RR * RR); _reHard2.push(rh * rh); _reOut2.push(ro * ro);
    }
    var w = 0;
    for (i = 0; i < _stumps.length; i++) {
      var st = _stumps[i], dead = false, touched = false;
      for (j = 0; j < nc; j++) {
        var ddx = st.x - points[j * 2], ddz = st.z - points[j * 2 + 1], d2 = ddx * ddx + ddz * ddz;
        if (d2 > _reInf2[j]) continue;                                    // 影响圈外
        touched = true;                                                   // 落在任一发的影响圈内
        if (d2 <= _reHard2[j]) { dead = true; break; }                    // 焦土黑心:抹除(树/草同一把尺子)
        if (d2 <= _reOut2[j] && st.sid != null &&
            _sidHash01(st.sid) < scorchVegKillP(scorchF(Math.sqrt(d2 / _reInf2[j])))) { dead = true; break; }   // 过渡带:同树同概率
      }
      if (dead) { _stumpKillByScorch(st); continue; }
      if (touched) st.y = terrainH(st.x, st.z);                           // 幸存:重锚到新地面(每桩只采样一次)
      _stumps[w++] = st;
    }
    if (w !== _stumps.length) {
      _stumps.length = w;
      if (typeof bsMarkDirty === 'function') bsMarkDirty('stump');        // 树桩阴影事件级重烘焙
    }
  }
}
/* ★任务27④:落弹批处理分帧预算——旧行为=0.3s 窗口把队列一次全冲:RED-MLRS 40 发齐射与多炮齐射/
   直升机火箭点射重叠时,单批实测 247~281ms 纯 JS(每坑 26²~50² 顶点×7 点超采样冲压+法线重算+
   最多 64 块脏块全量属性上传 5.4MB)=「火箭弹爆炸必卡一下像暂停」的根因。
   现:每批处理弹坑至 6ms 预算(至少 2 坑),余坑留队 0.3s 后续批消化;脏块上传每批 ≤2 块,
   余块保持脏标下批续传(空队列也会为续传运行)。弹坑为永久地貌,延后数帧~数秒出现无感知
   (爆点烟卡/焦土像素层当帧已盖住落点)。单坑成本(≤~10ms)为不可再分下限。 */
var CRATER_FLUSH_BUDGET_MS = 6;      // 每批冲压时间预算(ms)
var CRATER_FLUSH_MIN = 1;            // 每批至少处理坑数(保证队列必然排空;大坑单帧只此一发,小坑预算内续挖)
var CRATER_CHUNK_UP_MAX = 2;         // 每批脏块上传上限(块)
var _cfPart = null;            // ★任务27⑤:坑内行级游标状态(未冲完的大坑跨批续冲;换图/clearBattle 置 null)
var _cfPreQ = [];              // ★任务27⑤:preWrecks 采样参数复用数组(零分配)
function _crNowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
function flushCraters() {
  if (!groundChunks.length) return;
  var _cfDirty = false;                                      // 有欠传脏块时,即使队列为空也要运行(续传)
  for (var _cfD = 0; _cfD < chunkDirty.length; _cfD++) if (chunkDirty[_cfD]) { _cfDirty = true; break; }
  if (!craterQueue.length && !_cfDirty && !_cfPart) return;   // ★任务27⑤:半冲压坑待续时不得早退(其脏块可能已在前批传清)
  var flushed = [];                                          // 本批落点(大本营再锚固判定用)
  var flushedR = [];                                         // 6a/6b: 逐坑 RINF(贴地物重锚的半径真源)
  if (typeof terrainChangedPreWrecks === 'function') {       // 6a: 冲压前采样残骸脚下地面高(★任务27⑤:续冲坑一并纳入——采样本批将冲压的落点)
    _cfPreQ.length = 0;
    if (_cfPart) _cfPreQ.push(_cfPart.cx, _cfPart.cz, _cfPart.rSp);
    for (var _pq = 0; _pq < craterQueue.length; _pq++) _cfPreQ.push(craterQueue[_pq]);
    if (_cfPreQ.length) terrainChangedPreWrecks(_cfPreQ);
  }
  nrmMarkId++;                                               // cw T1:脏标记版本号推进(跨批复用标记数组零分配)
  var _cfT0 = _crNowMs(), _cfN = 0;
  /* ★任务27⑤ 坑内行级游标:每坑 = 一个 _cfPart 状态对象(开坑即建、完工置 null)。冲压内环每
     256 顶点查一次钟,预算耗尽保存 (iz,ix) 断点、下一批(0.3s 后)续冲 —— 连单个 BLUE-MLRS 大坑
     (44m 口径 ≈ 2500 顶点 ×7 点超采样 ≈ vm 23ms)也被切成有界片段,任何一次 flushCraters 调用都不再含不可分割的大坑。
     顺序不变性:冲压顺序 = 队列 FIFO × 行×列扫描,与分批方式无关 → 拆分后全部排干的
     dentGrid/scorchGrid/scorchVtxQ/顶点位置/顶点色/法线与不拆分【逐位一致】(dbg_rocket 场景 F 实证)。
     续冲批增量照常参与该批 flushed 再锚固(REANCHOR_DEADBAND 4cm 死区幂等,重复再锚收敛)、
     dentEpoch、法线重算与分块上传;像素层 splat 与余烬 emberCrater 在整坑完工时才登记(至多延后 3 批)。 */
  while (_cfPart || craterQueue.length) {
    if (_cfN >= CRATER_FLUSH_MIN && _crNowMs() - _cfT0 >= CRATER_FLUSH_BUDGET_MS) break;
    if (!_cfPart) {                                          // —— 开新坑:建状态对象(全部每坑常量一次算好)——
      var cxq = craterQueue.shift(), czq = craterQueue.shift(), rSp = craterQueue.shift() || 22.0;
      _cfPart = { cx: cxq, cz: czq, rSp: rSp,
        R: craterRadiusOf(rSp),                              // 弹坑半径(含网格分辨下限,见 craterRadiusOf)
        D: 1.6 * (rSp / 22.0),                               // 弹坑深度与爆炸半径线性关联
        rimH: 0.55 * (rSp / 22.0),                           // 坑缘凸起与爆炸半径线性关联
        RINF: 0, RVTX: 0, cgain: 0, ix0: 0, ix1: 0, iz0: 0, iz1: 0, iz: 0, ix: 0 };
      var PT = _cfPart;
      PT.RINF = PT.R * 2.4;                                  // 焦土影响范围
      /* 顶点层半径 RVTX:内缩 4 格(下限 0.45 RINF)。它只是像素层的兜底,必须被「压」在
         解析焦土已经烧到 ~99% 的黑心里 —— 正常渲染时它对画面的贡献恒小于 1%(实测:
         内缩 2 格时它会在 0.6~0.9 RINF 的过渡带上留下约 2.9% 的角度起伏,内缩 4 格后
         < 0.5%);而像素层一旦失效,画面上仍有一块(略小的)焦土,不会整坑消失。 */
      PT.RVTX = Math.max(PT.RINF - 4 * GRID_CELL, PT.RINF * 0.45);
      PT.cgain = craterStampGain(PT.R, PT.D, PT.rimH);       // 预滤波的峰值补偿(每坑一次)
      PT.ix0 = Math.max(0, Math.floor((PT.cx - PT.RINF + MAP.halfW) / GRID_CELL_X)); PT.ix1 = Math.min(GRID_N - 1, Math.ceil((PT.cx + PT.RINF + MAP.halfW) / GRID_CELL_X));   // ±halfW/halfL 偏移(与视觉网格同轴)
      PT.iz0 = Math.max(0, Math.floor((PT.cz - PT.RINF + MAP.halfL) / GRID_CELL_Z)); PT.iz1 = Math.min(GRID_N - 1, Math.ceil((PT.cz + PT.RINF + MAP.halfL) / GRID_CELL_Z));
      PT.iz = PT.iz0; PT.ix = PT.ix0;
    }
    var P = _cfPart;
    var cx = P.cx, cz = P.cz, R = P.R, D = P.D, rimH = P.rimH, RINF = P.RINF, RVTX = P.RVTX, cgain = P.cgain;
    var ix0 = P.ix0, ix1 = P.ix1, iz1 = P.iz1;
    flushed.push(cx, cz); flushedR.push(RINF);               // 本批落点(大本营再锚固判定用;续冲坑逐批重复入账,死区幂等)
    var iz = P.iz, ix = P.ix, _cfV = 0, _cfStop = false;     // 行级游标 + 本坑本批顶点计数(每 256 顶点查钟一次)
    while (iz <= iz1) {
      while (ix <= ix1) {
        var wx = -MAP.halfW + ix * GRID_CELL_X, wz = -MAP.halfL + iz * GRID_CELL_Z;
        var dx = wx - cx, dz = wz - cz;
        var r = Math.sqrt(dx * dx + dz * dz);
        if (r > RINF) { ix++; continue; }
        var idx = iz * GRID_N + ix;
        var hqFac = getHQZoneDeformFactor(wx, wz);
        /* ① 高程:径向超采样冲压(craterStamp) —— 抽样结果只依赖到爆心的距离,
              与爆心落在格内的相位无关;旧式单点取样会让同一发弹因落点相位不同而歪成不同的棱形。 */
        var dd = craterStamp(dx, dz, R, D, rimH) * cgain * hqFac;
        if (Math.abs(dd) > 1e-5) {
          dentGrid[idx] += dd;
          gndAddY(idx, dd);                                    // 视觉写入走分块助手(边界副本自动同步+脏块标记)
          if (nrmMark[idx] !== nrmMarkId) { nrmMark[idx] = nrmMarkId; nrmTouched.push(idx); }   // cw T1:本批触碰顶点去重入账
        }
        /* ② 焦土强度 q = 1 - r / RINF(max 累积:炸过一次永生焦土,只加不减、永不复原)。
              这是植被判定与换肤重放的唯一真源(像素层只是它的"高分辨率渲染")。 */
        var q = (1 - r / RINF) * hqFac;
        if (q > scorchGrid[idx]) scorchGrid[idx] = q;
        /* ③ 顶点层:与像素层同配方,但半径内缩 —— 它只作兜底(像素层失效时画面仍有焦土),
              绝不允许它把多边形轮廓画到解析圆之外。只增不覆写(scorchVtxQ 账本)。 */
        var qv = (1 - r / RVTX) * hqFac;
        if (qv > 0 && qv * 255 > scorchVtxQ[idx] + 0.5) {
          scorchVtxQ[idx] = Math.min(255, (qv * 255) | 0);
          var u = 1 - qv, f = scorchMixAt(u), i3 = idx * 3;
          scorchColInto(u, _scTgt);
          gndSetColor(idx,
            groundBaseCol[i3]     * (1 - f) + _scTgt[0] * f,
            groundBaseCol[i3 + 1] * (1 - f) + _scTgt[1] * f,
            groundBaseCol[i3 + 2] * (1 - f) + _scTgt[2] * f,
            groundBaseRock[i3]     * (1 - f) + _scTgt[0] * f,
            groundBaseRock[i3 + 1] * (1 - f) + _scTgt[1] * f,
            groundBaseRock[i3 + 2] * (1 - f) + _scTgt[2] * f);
        }
        if ((++_cfV & 255) === 0 && _crNowMs() - _cfT0 >= CRATER_FLUSH_BUDGET_MS) { _cfStop = true; break; }   // ★任务27⑤:预算断点(当前顶点已冲压)
        ix++;
      }
      if (_cfStop) break;
      iz++; ix = ix0;
    }
    _cfN++;
    if (_cfStop) {                                           // 保存行级断点:下一未冲顶点 = ix+1(越行界归一到下一行行首)
      P.iz = iz; P.ix = ix + 1;
      if (P.ix > ix1) { P.ix = ix0; P.iz = iz + 1; }
    } else {                                                 // —— 整坑冲压完成 ——
      _cfPart = null;
      /* ④ 像素层登记:焦土与过渡带从此在片元里按真实距离解析求值 —— 恒为正圆,与网格无关 */
      if (getHQZoneDeformFactor(cx, cz) > 0.15) scorchSplatAdd(cx, cz, RINF);
      emberCrater(cx, cz, R, RINF);       // 余烬单遍处理(da):翻土区抹除+波及区重锚固+坑内/坑缘/外环布点(ONE Mesh·1 draw call)
    }
  }
  dentEpoch++;                          // 高度场已变:静止车贴地目标缓存整体失效(alignTank 触发器判据)
  // —— 增量解析法线——网格严格贴合高度场(dentGrid 唯一真源),触碰顶点直接中心差分解析重算,
  // Geometry normals are computed only where the renderer needs them.
  for (var ni = 0; ni < nrmTouched.length; ni++) {
    var nI = nrmTouched[ni];
    terrainNormal(-MAP.halfW + (nI % GRID_N) * GRID_CELL_X, -MAP.halfL + ((nI / GRID_N) | 0) * GRID_CELL_Z, _crN);
    gndSetNormal(nI);                                        // 法线写入全部分块副本
  }
  nrmTouched.length = 0;
  /* 地形已完成变形后再事件通知漫画火箭爆点重锚;仅扫描固定12槽,
     替代每个爆点逐帧 terrainH/terrainNormal,弹坑合批之外零开销。 */
  if (typeof comicRocketBurstTerrainChanged === 'function') comicRocketBurstTerrainChanged(flushed);
  /* 6a/6b: 高度场改写完毕后, 贴地物(残骸 / 树桩)重锚到新地面 —— 与上面火箭爆点重锚同一范式,
     同一批里只跑一次; 死区 4cm, 位移不够不触发重烘焙。 */
  if (typeof terrainChangedReanchor === 'function') terrainChangedReanchor(flushed, flushedR);
  if (typeof bsDirtyByCraters === 'function') bsDirtyByCraters(flushed, flushedR);   /* G4-decal: re-anchor surviving blob shadows over dipped ground */
  // —— 脏块上传(替代 cw updateRange 区间上传)——每块 pos/col/nrm 各 ~54KB,
  //    弹坑批典型只脏 1~4 块;视锥外脏块上传照样发生但渲染被剔除 ——
  var _cfUp = 0;
  for (var cD = 0; cD < CHUNK_N * CHUNK_N; cD++) {
    if (!chunkDirty[cD]) continue;
    if (_cfUp >= CRATER_CHUNK_UP_MAX) break;                 // ★任务27④:上传预算——余块保持脏标,下批续传(防齐射期单帧 5MB+ 属性上传)
    _cfUp++;
    chunkDirty[cD] = 0;
    var gc = groundChunks[cD];
    gc.pos.needsUpdate = true; gc.col.needsUpdate = true; gc.nrm.needsUpdate = true; if (gc.rock) gc.rock.needsUpdate = true;
    if (gc.geo.computeBoundingSphere) gc.geo.computeBoundingSphere();   /* G2: refresh stale bounds after dents (prevents chunk pop) */
  }
  // 大本营 26m 内落坑:待命环重披布、旗杆重嵌入—— 通用约定:HQ 与土地永久零穿模
  var hqa = hqList.red.concat(hqList.blue);
  for (var hi = 0; hi < hqa.length; hi++) {
    var hq2 = hqa[hi];
    if (!hq2.redrape) continue;
    for (var fi2 = 0; fi2 < flushed.length; fi2 += 2) {
      var hdx = flushed[fi2] - hq2.x, hdz = flushed[fi2 + 1] - hq2.z;
      if (hdx * hdx + hdz * hdz < 26 * 26) { hq2.redrape(); break; }
    }
  }
}
function terrainNormal(x, z, out) {
  var e = 0.9;
  var hx = terrainH(x + e, z) - terrainH(x - e, z);
  var hz = terrainH(x, z + e) - terrainH(x, z - e);
  out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  return out;
}

/* ===== 配置 ===== */
var CONF = {
  // 玩家与 AI 用的就是 red 这套数值 —— 全民平等,凭技术吃饭
  red:   { struct: 300, pen: 446, penKd: 9.5e-5, dmg: 90, reload: 8.5, speed: 13.9, turn: 0.45, turretRate: 0.175,
            accel: 2.5, decel: 5, color: 0x4e6b38, shellSpeed: 1480,   // 50km/h=13.9m/s;炮塔 10°/s=0.175rad/s;结构统一 300
            mob: { mass: 36000, power: 387764, eta: 0.80, mu: 0.68, muLat: 0.42, crr: 0.095, vCrawl: 1.0 },   // 红方主战坦克:36t/520hp;tanθmax=μ−Crr=0.585≈58%
            // 59 式(用户标尺):首上/首下物理 97~100 取 100(首上 23.8° 斜板/鼻板 25.3°,等效由命中壳几何按 LOS 折算)/侧 80/顶 20/后 40 底 25(后底区间 20~60);weak=座圈裙前缝 45 不变
            hullArmor:   { front: 100, side: 80, rear: 40, top: 20, bottom: 25, weak: 45 },
            turretArmor: { front: 200, side: 140, rear: 42, top: 30, weak: 45 } },            // 铸造穹顶最厚处 200~203 取 200/侧 130~150 取 140/顶 30;后 42 未指定照旧;weak=弱点面板 45mm
  blue:  { struct: 300, pen: 446, penKd: 9.5e-5, dmg: 90, reload: 8.5, speed: 13.3, turn: 0.45, turretRate: 0.419,
            accel: 2.5, decel: 5, color: 0x8a7f4a, shellSpeed: 1480,   // 48km/h=13.3m/s;炮塔 24°/s=0.419rad/s
            mob: { mass: 48000, power: 559275, eta: 0.80, mu: 0.68, muLat: 0.34, crr: 0.10, vCrawl: 1.0 },   // BLUE_MBT_1:48t/750hp;横坡短板 sideMax≈30%
            hullArmor:   { front: 210, side: 55, rear: 40, top: 20, bottom: 25, weak: 45 },   // BLUE-MBT-1(物理厚度入账):首上物理210(游戏斜板~35°入射→等效≈256≈标尺258)/首下~45°→297区间/侧55/顶20/后底40/25
            turretArmor: { front: 165, side: 76, rear: 50, top: 30, weak: 45 } },              // 物理厚度:炮塔正面165(卵鼻0°=165,颊35°≈201,50°≈257≈标尺最厚254)/侧76/后50/顶30;等效=物理/cos入射角,通用算法无M60专属分支
  shellSpeedE: 1650, gravity: 9.8,   // 双方(含玩家)同用真实低伸弹道:现代动能弹级 1650m/s(提高到真实现代坦克水平≥1000m/s;3BM-42≈1650/M829≈1670/三期≈1700)+真实重力 —— 下坠 @100m≈1.8cm @300m≈16.2cm @600m≈64.8cm(较 1050 时代再平直 2.5×)
  /* 穿深随距离衰减(公式;59 式标尺重标——59 式主炮 @1000m 穿深 140mm):
     阻力 F=½ρv²ACd → dv/dR=−(ρACd/2m)·v → v(R)=v0·e^(−kR);
     德马尔公式同弹 w/d 恒定 → 穿深 P(R)=P0·e^(−kR),k=ρ·Cd·A/(2m)。
     全口径风帽穿甲弹 Cd=0.24,ρ=1.225mmHg,逐炮算:
       坦克(59 式档)→ k=9.5e-5;用户标尺重标:@2400m 击穿 150mm/65° 斜板
         → 游戏内 LOS 等效 150/cos65°=354.93 → P0=354.93/e^(−k·2400)=445.8≈446
         (曲线:P0=446 / @1000m 405.6 / @2000m 368.8 / @2400m 355.1——公式计算,非改衰减);
       歼击车 k=8.6e-5;RED-TD AP 弹初始穿深上调为当前值的1.4倍: 594×1.4=831.6≈832mm;
         BLUE-MBT-1 与 RED-MBT-1 同标尺(@2400m 穿 150/65°=等效354.93)→ P0=446;
         BLUE-MBT-2 @2000m 穿深 420~470 取中 445 → P0=445/e^(−k·2000)=513.9≈514(k=7.2e-5)。
     机制注:弹道飞行速度恒 1650(平直低伸铁律不动),衰减只作用于命中瞬间的穿深结算;
     距离=炮弹真实飞行里程(出膛累计),跳弹/穿透链继续按现行 ×0.35/×0.62 在衰减值上叠乘。 */
  fireDOT: 7,
  // 火箭炮载具:皮薄、机动一般、超远程曲射面杀伤;齐射时不能移动
  // 红方火箭炮 = RED-MLRS 122mm 轮式自行火箭炮(40 联装):射程 40km/伤害 60/装填 40s/齐射 40 发
  arty: { struct: 300, dmg: 60, reload: 40, salvo: 40, salvoGap: 0.22,   // reload=salvo×1s×伤害系数(dmg/60)=40s(rocketReloadTimeOf 大修口径);齐射 40 发
          rocketSpeed: 640, splashR: 22, minRange: 130, maxRange: 40000,   // 40km 超远曲射(高抛 50.4° 需≈632m/s);溅射半径 22m(splashRadiusFromDamage 锚点)
          pen: 1200,   // 火箭弹直击穿深(mm,战斗部化学能定型值):全场最硬板面(RED-MBT-2首上极限等效≈1058)必穿,与RED-MBT-2主炮1090同量级取上界
          speed: 7.5, turn: 0.35, turretRate: 1.0, accel: 1.4, decel: 3.8,   // 发射架伺服 1.0rad/s(与开镜瞄具转速一致)
          mob: { mass: 22000, power: 253538, eta: 0.80, mu: 0.50, muLat: 0.35, crr: 0.12, vCrawl: 1.0 } },   // 轮式卡车:22t/340hp(估);极限≈38%,越野弱一档
  // 蓝方火箭炮 = BLUE-MLRS 227mm 高机动火箭炮(6 联装):射程 40km/伤害 120/装填 12s/齐射 6 发
  artyE: { p: 0.22,   // reload=6×1s×(120/60)=12s(伤害系数=2,单发更重装填更快)
          rocketSpeed: 640, splashR: 44, minRange: 130, maxRange: 40000,   // 溅射半径 44m=120×22/60(splashRadiusFromDamage 同源自洽)
          pen: 1200,   // 战斗部化学能定型值,与 RED-MLRS 同级
          speed: 7.5, turn: 0.35, turretRate: 1.0, accel: 1.4, decel: 3.8,   // 发射架伺服 1.0rad/s(与开镜瞄具转速一致)
          mob: { mass: 22000, power: 253538, eta: 0.80, mu: 0.50, muLat: 0.35, crr: 0.12, vCrawl: 1.0 } },   // FMTV M1140 6×6:机动与 RED_MLRS 同级
  artyPerTeam: 4,
  // 防空载具(AA):红方=RED-AA 自行防空车(2×双联25mm机炮+4×导弹)/蓝方=BLUE-AA(8×导弹)。
  // 机炮性能=直升机机炮(RED-HELI 航炮口径:伤40/穿35/k4.5e-5/装填0.25s/初速920);
  // 导弹规格走 HELI_MSL_SPEC 路由(红=ty90/蓝=aim92),装填 40s=防空导弹 同口径;发射点=发射架导弹弹头建模中心。
  aa: { struct: 300, pen: 35, penKd: 4.5e-5, dmg: 40, reload: 0.125, shellSpeed: 920,   // RED-AA 双联25mm×2 = 直升机机炮同性能(任务25:射速×2,0.25s→0.125s/点射)
        speed: 12.0, turn: 0.55, turretRate: 1.047, accel: 2.0, decel: 4.5,             // 履带底盘 ~43km/h;炮塔伺服 60°/s(与直升机机炮塔同)
        mob: { mass: 22500, power: 320000, eta: 0.80, mu: 0.62, muLat: 0.40, crr: 0.10, vCrawl: 1.0 },   // 履带自行高炮 ~22.5t(估)
        hullArmor: { front: 20, side: 14, rear: 12, top: 10, bottom: 8, weak: 8 },
        turretArmor: { front: 18, side: 12, rear: 10, top: 8, weak: 8 } },
  aaE: { struct: 300, pen: 35, penKd: 4.5e-5, dmg: 40, reload: 0.25, shellSpeed: 920,   // BLUE-AA无机炮(机炮字段仅占位,武器分支永不消费)
        speed: 17.0, turn: 0.75, turretRate: 1.047, accel: 2.4, decel: 5.0,              // M1097A2 悍马 4×4 ~61km/h(游戏平衡口径,实车 89km/h)
        mob: { mass: 3900, power: 134000, eta: 0.80, mu: 0.55, muLat: 0.38, crr: 0.11, vCrawl: 1.0 },    // 战斗全重 3.90t/底特律V8 6.2L 135hp(公开数据)
        hullArmor: { front: 12, side: 8, rear: 6, top: 6, bottom: 5, weak: 5 },
        turretArmor: { front: 10, side: 8, rear: 6, top: 6, weak: 6 } },
  aaPerTeam: 3,
  // 红方RED-TD(用户标尺):全车装甲 30mm(未计倾角等效);单弹种(AP)——
  // AP:1700m/s;初始穿深=当前 594mm ×1.4≈832mm(k=8.6e-5);装填 6s。
  //   最大交火距离 400→700m(760m 视距内望远接敌)。炮塔转速 0.314rad/s(18°/s),无水平角限位。
  td: { struct: 300, pen: 832, penKd: 8.6e-5, dmg: 150, reload: 6.0, speed: 15.3, turn: 0.68, turretRate: 0.314,
        accel: 1.8, decel: 4.2, shellSpeed: 1700,   // 55km/h=15.3m/s;炮塔 18°/s=0.314rad/s
        mob: { mass: 31000, power: 387764, eta: 0.80, mu: 0.68, muLat: 0.42, crr: 0.09, vCrawl: 1.0 },   // 红方歼击车:31t/520hp(估);轻车 Crr 低
        hullArmor:   { front: 30, side: 30, rear: 30, top: 30, bottom: 30, weak: 30 },        // RED-TD:全车 30mm(用户标尺,未计倾角等效)
        turretArmor: { front: 30, side: 30, rear: 30, top: 30, weak: 30 } },
  // 蓝方 BLUE-MBT-2:独立主战坦克机动/装填/360°炮塔/复合装甲配置。
  // 数值按本游戏装甲尺度压缩,保留红方 89 式正面交战时可对抗性;并非把现实等效值原样塞入导致单边无敌。
  m1: { struct: 300, pen: 514, penKd: 7.2e-5, dmg: 130, reload: 7.0, speed: 19.4, turn: 0.52, turretRate: 0.698,
        accel: 2.4, decel: 5.5, shellSpeed: 1500,   // 70km/h=19.4m/s;炮塔 40°/s=0.698rad/s
        mob: { mass: 61000, power: 1118550, eta: 0.80, mu: 0.70, muLat: 0.44, crr: 0.095, vCrawl: 1.0 },   // BLUE_MBT_2:61t/1500hp;功率重量比碾压,爬坡快
        // BLUE-MBT-2(用户标尺):首上240(用户改值,原复合等效375;浅带面)/首下物理400(glacis 槽,75° 几何折算)/侧80~150取115/后底20~30取25
        hullArmor:   { front: 240, glacis: 400, side: 115, rear: 25, top: 35, bottom: 25, weak: 60 },
        turretArmor: { front: 850, side: 76, rear: 65, top: 40, weak: 60 } },                            // BLUE-MBT-2 炮塔前脸装甲提高至850/侧等效76/顶30~50取40
  tdPerTeam: 10,                                      // 编制槽默认数(红方=RED-TD×10;蓝方 BLUE-MBT-2 走 m1PerTeamE=28;VEHICLE_KINDS.def 消费,遭遇战菜单可调)
  /* 红方RED-MBT-2重型主战坦克(用户标尺):
     主炮 125mm:@1000m 击穿 1000mm(等效)→ P0=1000/e^(−k·1000),k=8.6e-5(长杆弹与RED-TD同衰减档)→ P0=1089.8≈1090;
       初速 1750/装填 7s;散布=RED-TD×1.2(MODEL_SPREAD.t99,ai.js);dmg=120mm 弹药档 150(RED-TD同档);
     装甲(等效→物理经三角函数入账,运行期 等效=物理/cos入射 还原):
       车体首上等效 793(板倾 23.8°,水平射线入射 66.2°)→ 物理=793·sin23.8°=320;
       车体首下等效 400(鼻板后倾 25.35°)→ 物理=400·cos25.35°=362;
       车体侧面前半 300/发动机段 150(垂直板物理=等效;armorOf 命中点 z 分区,界 -0.85)/后部 rear 50;
       炮塔正面物理厚度 700(双尖纺锤壳多朝向前楔,统一由真实世界法线按 d/cos(入射角)折算);
       炮塔侧面前半 200/后半 100(armorOf 命中点 z 分区,界 -0.45;炮塔=唯一真面壳)/后部 50;顶/底/weak 沿用 59 式口径;
     机动:75km/h=20.8m/s;炮塔 30°/s=0.524rad/s。 */
  t99: { struct: 300, pen: 1090, penKd: 8.6e-5, dmg: 150, reload: 7.0, speed: 20.8, turn: 0.55, turretRate: 0.524,
        accel: 2.8, decel: 5.5, shellSpeed: 1750,
        mob: { mass: 53000, power: 1118550, eta: 0.80, mu: 0.70, muLat: 0.44, crr: 0.09, vCrawl: 1.0 },   // 红方重型坦克:53t/1500hp;27.8hp/t 全场最强
        hullArmor:   { front: 320, glacis: 362, side: 150, sideF: 300, sideR: 150, rear: 50, top: 20, bottom: 25, weak: 45 },
        turretArmor: { front: 700, side: 100, sideF: 200, sideR: 100, rear: 50, top: 30, weak: 45 } },
  /* BLUE-HELI:按真实机型外形比例建模(串列座舱/颚炮/肩置发动机/四叶旋翼+桅顶雷达/短翼双挂点(外火箭巢/内侧二联装防空导弹)/后三点起落架)。
     轻装甲/航炮框架:M230 30mm 链炮射速每秒4发(0.25s)、穿深 35mm、炮塔转速 60°/s(1.0472rad/s),装甲同属纸甲档。 */
  ah64: { struct: 230, pen: 35, penKd: 5.0e-5, dmg: 50, reload: 0.125, speed: 69.44, turn: 0.86, turretRate: 1.0472,   // 任务25:机炮射速×2(0.25s→0.125s)
          accel: 3.4, decel: 6.0, shellSpeed: 1000,
          hullArmor: { front: 30, side: 20, rear: 16, top: 13, bottom: 12, weak: 11 },
          turretArmor: { front: 24, side: 17, rear: 13, top: 11, weak: 11 } },
  ah64PerTeam: 4,
  /* RED-HELI:按真实机型比例建模。识别特征包括光电球塔、串列阶梯座舱、肩置双发上斜排气管、
     五叶主旋翼、无桅顶雷达、短翼四联装空空导弹、高置深截面尾梁、右侧剪刀尾桨和三点式起落架。
     23mm 链式航炮:射速每秒4发(0.25s)、穿深 35mm、炮塔转速 60°/s(1.0472rad/s);轻装甲纸甲档(复合材料机体)。 */
  wz10: { struct: 240, pen: 35, penKd: 4.5e-5, dmg: 40, reload: 0.125, speed: 69.44, turn: 0.90, turretRate: 1.0472,   // 任务25:机炮射速×2(0.25s→0.125s)
          accel: 3.6, decel: 6.2, shellSpeed: 920,
          hullArmor: { front: 30, side: 20, rear: 15, top: 12, bottom: 11, weak: 10 },
          turretArmor: { front: 22, side: 16, rear: 12, top: 10, weak: 10 } },
  wz10PerTeam: 4,
  t99PerTeam: 27, t99PerTeamE: 0, tank59PerTeam: 9,   // 默认编制:红方 RED-MBT-1 9辆/RED-MBT-2 27辆,蓝方无 RED-MBT-2(菜单可改)
  m1PerTeamE: 28,                                     // 蓝方 td 槽(BLUE_MBT_2)专属默认数(红方 RED-TD 仍用 tdPerTeam;28=原10+新调18)
  // 大本营重新部署(消耗战):初始载具不占兵力;此后每辆被摧毁的载具按兵种延时在大本营 redeploy,
  // 每次 redeploy(无论兵种)消耗 1 点兵力,先把 50 点兵力耗光的一方战败
  hqPerTeam: 3,
  startPool: 50,
  bounds: 980,                                     // 可活动范围=地图边界内缩 20m(默认 2km 图初值;applyMapConfig 开局按所选边长重算)
  teamSize: 18, redSpawnZ: 800, blueSpawnZ: -800   // teamSize=蓝方 BLUE-MBT-1 默认数(红方 RED-MBT-1 走 tank59PerTeam;出生线=坡起点内 50m,默认 2km 图初值;applyMapConfig 开局重算)
};

/* ===== 坡度物理全局开关(2026-09-09 越野大改) ===== */
var SIM_K = 1.0;   // 0=旧街机手感(applyMotion 走逐位旧代码分支),1=全物理;0~1 之间=阻力/侧滑项线性混合(手感调试用,不必精确)
function mobDerived(mob) {   // 派生极限(惰性,每 mob 对象算一次):起步极限 tanθmax=μ−Crr(牵引=阻力的精确解)
  if (!mob) return null;
  if (mob._tanMax == null) {
    mob._tanMax = Math.max(0.05, mob.mu - mob.crr);
    mob._tanSide = Math.max(0.05, mob.muLat);
    mob._gradeMax = Math.atan(mob._tanMax);
  }
  return mob;
}

/* 载具型号注册表(单一登记源):遭遇战编制菜单/开局生成/命名/重部署/AI 建档统一遍历本表——
   新增型号只需在此登记一个条目,重部署/编制菜单/UI/AI 全链路零改动自动生效:
   { kind, def:CONF 默认数量键, names:双阵营名, 可选 sides 阵营白名单,
      respawnDelay:秒数或{red,blue}(重部署延时,缺省 6),
      spawnName:{red,blue}(重部署出厂名,缺省回退 names),
     aiAnchor:true=重部署后锚定原地不前压(曲射平台),
      modelKey:'键'或{red,blue}(AI 建档/MODEL_SPREAD 散布档键,缺省=kind 即自动独立建档),
      frontalArea:数值或{red,blue}(正面投影面积 m²,缺省 5),
      nv/th:布尔或{red,blue}(夜视仪/热成像,缺省=false) }
   启动时 validateVehicleRegistry(flow.js startGame 调用)校验完整性,缺失项告警并走安全兜底。 */
var VEHICLE_KINDS = [
  { kind: 'tank', def: 'teamSize', defs: { red: 'tank59PerTeam' }, names: { red: 'RED-MBT-1', blue: 'BLUE-MBT-1' },
    respawnDelay: 6, spawnName: { red: 'RED-MBT-1', blue: 'BLUE-MBT-1' },
    modelKey: { red: 't59', blue: 'm60' }, frontalArea: { red: 4.997, blue: 6.691 },
    nv: { red: true, blue: true }, th: false },
  { kind: '99',   def: 't99PerTeam', defs: { blue: 't99PerTeamE' }, names: { red: 'RED-MBT-2', blue: 'RED-MBT-2' }, sides: { red: true },
    respawnDelay: 6, spawnName: { red: 'RED-MBT-2', blue: 'RED-MBT-2' },
    modelKey: 't99', frontalArea: 5.297, nv: true, th: true },
  { kind: 'td',   def: 'tdPerTeam', defs: { blue: 'm1PerTeamE' }, names: { red: 'RED-TD', blue: 'BLUE-MBT-2' },
    respawnDelay: { red: 3, blue: 6 }, spawnName: { red: 'RED-TD', blue: 'BLUE-MBT-2' },
    modelKey: { red: 'td89', blue: 'm1a1' }, frontalArea: { red: 5.862, blue: 5.174 },
    nv: true, th: { red: false, blue: true } },
  { kind: 'ah64', def: 'ah64PerTeam', names: { red: 'BLUE-HELI', blue: 'BLUE-HELI' }, sides: { blue: true },
    respawnDelay: 12, spawnName: { red: 'BLUE-HELI', blue: 'BLUE-HELI' },
    modelKey: 'ah64', frontalArea: 3.40, nv: true, th: true },
  { kind: 'wz10', def: 'wz10PerTeam', names: { red: 'RED-HELI', blue: 'RED-HELI' }, sides: { red: true },
    respawnDelay: 12, spawnName: { red: 'RED-HELI', blue: 'RED-HELI' },
    modelKey: 'wz10', frontalArea: 3.20, nv: true, th: true },
  { kind: 'arty', def: 'artyPerTeam', names: { red: 'RED-MLRS', blue: 'BLUE-MLRS' },
    respawnDelay: 24, spawnName: { red: 'RED-MLRS', blue: 'BLUE-MLRS' }, aiAnchor: true,
    modelKey: 'arty', frontalArea: { red: 5.90, blue: 6.20 }, nv: true, th: false },
  { kind: 'aa', def: 'aaPerTeam', names: { red: 'RED-AA', blue: 'BLUE-AA' },
    respawnDelay: 12, spawnName: { red: 'RED-AA', blue: 'BLUE-AA' }, aiAnchor: true,
    modelKey: 'aa', frontalArea: { red: 5.20, blue: 4.10 }, nv: true, th: false }
];
function vehicleKindEntry(kind) {                // 注册表条目查询(未知型号返回 null)
  for (var vki = 0; vki < VEHICLE_KINDS.length; vki++)
    if (VEHICLE_KINDS[vki].kind === kind) return VEHICLE_KINDS[vki];
  return null;
}
function vehicleFlagOf(vk, key, team) {          // 条目标记解析(布尔或{red,blue};未登记=false)
  var v = vk ? vk[key] : null;
  if (v == null) return false;
  return typeof v === 'boolean' ? v : !!v[team];
}
function vehicleModelKey(team, kind) {           // 型号档案键(AI 建档/散布库/正面面积统一消费;未登记型号回退 kind 自身=自动独立建档)
  var vk = vehicleKindEntry(kind);
  var mk = vk && vk.modelKey;
  if (!mk) return kind;
  return typeof mk === 'string' ? mk : (mk[team] || mk.red || kind);
}
function vehicleFrontalArea(team, kind) {        // 正面投影面积(m²;未登记兜底 5=旧无目标哨位同值)
  var vk = vehicleKindEntry(kind);
  var fa = vk && vk.frontalArea;
  if (fa == null) return 5;
  return typeof fa === 'number' ? fa : (fa[team] != null ? fa[team] : (fa.red != null ? fa.red : 5));
}
function respawnDelayOf(kind, team) {            // 重部署延时秒数(条目未登记兜底 6=旧 CONF.respawnDelay 兜底同值)
  var vk = vehicleKindEntry(kind);
  var d = vk && vk.respawnDelay;
  if (d != null && typeof d !== 'number') d = d[team];
  return d > 0 ? d : 6;
}
function validateVehicleRegistry() {             // 启动自检:遍历注册表校验关联系统完整性(缺失告警+已兜底,不中断游戏)
  var warns = [], teams = ['red', 'blue'];
  for (var vi = 0; vi < VEHICLE_KINDS.length; vi++) {
    var vk = VEHICLE_KINDS[vi];
    for (var ti = 0; ti < 2; ti++) {
      var tm = teams[ti];
      if (vk.sides && !vk.sides[tm]) continue;
      if (!vk.names || !(vk.names[tm] || vk.names.red)) warns.push(vk.kind + '/' + tm + ': missing display name');
      if (!(vk.spawnName && (vk.spawnName[tm] || vk.spawnName.red))) warns.push(vk.kind + '/' + tm + ': missing spawnName (falls back to type name)');
      if (!(respawnDelayOf(vk.kind, tm) > 0)) warns.push(vk.kind + '/' + tm + ': illegal respawnDelay (falls back to 6s)');
      if (!(vehicleFrontalArea(tm, vk.kind) > 0)) warns.push(vk.kind + '/' + tm + ': illegal frontalArea (falls back to 5m2)');
      if (vk.nv == null) warns.push(vk.kind + '/' + tm + ': missing nv flag (treated as none)');
      if (vk.th == null) warns.push(vk.kind + '/' + tm + ': missing thermal flag (treated as none)');
      // 散布档不在此校验:spreadOf 内置 tank 档兜底(ai.js),RED-MBT-1/BLUE-MBT-1 共享 tank 档即官方设计,缺键非错误
    }
  }
  for (var wi = 0; wi < warns.length; wi++) console.warn('[VEH REG] ' + warns[wi]);
  return warns.length;
}
function vehicleKindAllowed(team, kind) {        // 型号阵营白名单(无 sides=双方可用;编制菜单/预览/兵种行/出生守卫共用)
  for (var vai = 0; vai < VEHICLE_KINDS.length; vai++)
    if (VEHICLE_KINDS[vai].kind === kind) return !VEHICLE_KINDS[vai].sides || !!VEHICLE_KINDS[vai].sides[team];
  return true;
}
/* ===== 夜战观瞄设备(已收编注册表 nv/th 字段;玩家/AI 同口径) ----
   夜间瞄准效率(白天=1,多因子取最大):热像 1.2 > 夜视 0.8 > 裸眼 0.5。 ===== */
function vehicleHasNV(kind, team) { return vehicleFlagOf(vehicleKindEntry(kind), 'nv', team); }     // 夜视仪(条目 nv)
function vehicleHasTH(kind, team) { return vehicleFlagOf(vehicleKindEntry(kind), 'th', team); }     // 热成像(条目 th)
function nightAimEffOf(kind, team) { return vehicleHasTH(kind, team) ? 1.2 : (vehicleHasNV(kind, team) ? 0.8 : 0.5); }
function vehicleDisplayName(t) {                 // 型号显示名(击杀信息等 UI 消费;kind+阵营 → VEHICLE_KINDS.names)
  for (var vni = 0; vni < VEHICLE_KINDS.length; vni++)
    if (VEHICLE_KINDS[vni].kind === t.kind) return VEHICLE_KINDS[vni].names[t.team] || VEHICLE_KINDS[vni].names.red;
  return '载具';
}
/* 载具正面投影面积(m²)= 车体+炮塔视觉几何并集包围盒(宽×高),建模几何实测——
   已收编注册表 frontalArea 字段,此处由条目启动重建原查表(消费方:ai.js 交火底线 _floorTab/combatFloorOf;
   新增型号随注册表条目自动入表,本对象无需再手工维护) */
var VEHICLE_FRONTAL_AREAS = {};
(function () {
  var faTeams = ['red', 'blue'];
  for (var fvi = 0; fvi < VEHICLE_KINDS.length; fvi++) {
    var fvk = VEHICLE_KINDS[fvi];
    for (var fti = 0; fti < 2; fti++) {
      var ftm = faTeams[fti];
      if (fvk.sides && !fvk.sides[ftm]) continue;
      VEHICLE_FRONTAL_AREAS[vehicleModelKey(ftm, fvk.kind)] = vehicleFrontalArea(ftm, fvk.kind);
    }
  }
})();   // 重建结果={t59:4.997,m60:6.691,t99:5.297,td89:5.862,m1a1:5.174,arty:7.837}(t99=估算口径:t59×1.06)
/* 遭遇战编制(红/蓝独立配置;默认=当前方案:50 兵力 / 在场 54:
   红方(RED-MBT-1/RED-MBT-2/RED-TD/RED-HELI/RED-MLRS),蓝方(BLUE-MBT-1/BLUE-MBT-2/BLUE-HELI/BLUE-MLRS)):
   pool=参战兵力;cap=最大在场载具数(AI 重部署门槛);roster[kind]=各型号数量(开局生成,含玩家占位) */
function defaultRoster(team) {                     // 默认编制(仅分配本阵营允许的载具型号,非本阵营载具严格为0)
  var r = {};
  for (var vi = 0; vi < VEHICLE_KINDS.length; vi++) {
    var vk = VEHICLE_KINDS[vi];
    if (!vehicleKindAllowed(team, vk.kind)) {
      r[vk.kind] = 0;
      continue;
    }
    var defKey = (vk.defs && team && vk.defs[team]) || vk.def;
    r[vk.kind] = CONF[defKey] != null ? CONF[defKey] : 0;
  }
  return r;
}
function defaultCap(team) {
  var n = 0, r = defaultRoster(team), vk;
  for (vk in r) n += r[vk];
  return n;
}
var BATTLE_SETUP = {
  red:   { pool: CONF.startPool, cap: defaultCap('red'), roster: defaultRoster('red') },
  blue:  { pool: CONF.startPool, cap: defaultCap('blue'), roster: defaultRoster('blue') }
};

/* ===== 游戏模式 =====
   团队死斗沿用原有红/蓝两队会战；个人死斗使用内部 red/blue 外观标签，
   但所有载具均视为互相敌对。模式选择只持久化玩家的默认模式，不联网。 */
var GAME_MODE_TEAM = 'tdm';
var GAME_MODE_FFA = 'ffa';
var GAME_MODE_STORAGE_KEY = 'armoredCorps.gameMode.v1';
var FFA_DEFAULT_MAP_SIZE = 3500;
var currentGameMode = GAME_MODE_TEAM;
// Team deathmatch control areas are enabled by default and can be changed in the custom battle panel.
var tdmControlZonesEnabled = true;
var FFA_DEFAULT_POWERUP_MULTIPLIER = 2;
var FFA_SETUP = { vehicleCount: 100, playerReserves: 3, heliEnabled: false, powerupMultiplier: FFA_DEFAULT_POWERUP_MULTIPLIER };
/* TO BATTLE remains a separate preset: its historical two-pickups-per-survivor
   density and roster defaults must not be overwritten by the saved custom menu. */
var FFA_QUICK_DEFAULTS = { vehicleCount: 100, playerReserves: 3, heliEnabled: false, powerupMultiplier: FFA_DEFAULT_POWERUP_MULTIPLIER };
var ffaQuickStart = false;  // TO BATTLE 快速入口的直升机禁用开关；自定义 DEPLOY 按 FFA_SETUP.heliEnabled
(function () {
  try {
    var saved = window.localStorage.getItem(GAME_MODE_STORAGE_KEY);
    if (saved === GAME_MODE_FFA || saved === GAME_MODE_TEAM) currentGameMode = saved;
  } catch (e) {}
})();
function isFfaMode() { return currentGameMode === GAME_MODE_FFA; }
function setGameMode(mode, persist) {
  currentGameMode = mode === GAME_MODE_FFA ? GAME_MODE_FFA : GAME_MODE_TEAM;
  // 模式切换时载入该模式的默认地图尺寸；自定义面板随后仍可继续修改它。
  if (typeof syncModeMapDefault === 'function') syncModeMapDefault(currentGameMode);
  if (persist !== false) {
    try { window.localStorage.setItem(GAME_MODE_STORAGE_KEY, currentGameMode); } catch (e) {}
  }
  // The quick TO BATTLE menu and the custom battle row share currentGameMode.
  // Refresh both immediately whenever the single source of truth changes.
  if (typeof refreshGameModeUI === 'function') refreshGameModeUI();
  return currentGameMode;
}
function areHostile(a, b) {
  if (!a || !b || a === b) return false;
  return isFfaMode() ? true : a.team !== b.team;
}
function areFriendly(a, b) {
  if (!a || !b || a === b) return false;
  return !isFfaMode() && a.team === b.team;
}
/* 目标扫描统一入口：个人死斗直接枚举全场活车，不依赖红/蓝外观标签。
   团队死斗继续使用原有敌方 roster，避免改变团队模式的扫描性能与语义。 */
function hostileRosterOf(t) {
  if (isFfaMode()) return (typeof aliveList !== 'undefined' && aliveList) ? aliveList : [];
  var other = t && t.team === 'red' ? 'blue' : 'red';
  return (typeof aiTeamRoster !== 'undefined' && aiTeamRoster[other]) ? aiTeamRoster[other] : [];
}
function friendlyRosterOf(t) {
  if (isFfaMode()) return [];
  var team = t && t.team ? t.team : 'red';
  return (typeof aiTeamRoster !== 'undefined' && aiTeamRoster[team]) ? aiTeamRoster[team] : [];
}

/* ===== 触屏端(安卓/移动)默认编制覆盖 =====
   ★2026-09-13:默认战场规模提到每阵营 40 台:直升机 2 / 火箭炮 2 / 防空车 1 台固定,
   剩余名额在其余载具型号之间平均分配(除不尽的余数按注册表顺序补给靠前的型号)。
   例:红方其余 tank/99/td 三型分 35 台 = 12+12+11;蓝方其余 tank/td 两型分 35 台 = 18+17。
   桌面端(精确指针)完全不受影响,仍用上面的 CONF 默认编制。
   注意:本段必须放在 VEHICLE_KINDS / vehicleKindAllowed / BATTLE_SETUP 之后。 */
var IS_TOUCH_SETUP = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;   // ★移动端适配恢复
/* ★P1-④(移动端恢复):触屏编制规模与模型质量档联动分级 low=20 / mid=28 / high=40;
   触屏设备默认 MODQ=mid → 每方 28 台;显式选高档恢复 40。桌面端不走本覆盖块。 */
var TOUCH_SETUP_CAP_BY_PROF = { low: 20, mid: 28, high: 40 };
var TOUCH_SETUP_CAP = (typeof MODQ_PROFILE !== 'undefined' && TOUCH_SETUP_CAP_BY_PROF[MODQ_PROFILE] != null)
  ? TOUCH_SETUP_CAP_BY_PROF[MODQ_PROFILE] : 40;            // 触屏端每阵营最大在场载具数
var TOUCH_SETUP_FIXED = { wz10: 2, ah64: 2, arty: 2, aa: 1 };   // 固定编成:直升机 2 / 火箭炮 2 / 防空车 1(型号不存在于该阵营时自动忽略;wz10 仅红方,ah64 仅蓝方,故每方直升机恰 2 台)
if (IS_TOUCH_SETUP) {
  (function () {
    var teams = ['red', 'blue'];
    for (var ti = 0; ti < teams.length; ti++) {
      var tm = teams[ti], S = BATTLE_SETUP[tm];
      // 1) 收集本阵营允许的型号(与编制菜单同一判定源)
      var allowed = [];
      for (var vi = 0; vi < VEHICLE_KINDS.length; vi++) {
        var kd = VEHICLE_KINDS[vi].kind;
        if (vehicleKindAllowed(tm, kd)) allowed.push(kd);
      }
      // 2) 先落固定编成,其余型号进"平均分配"队列
      var next = {}, fixed = 0, rest = [];
      for (var ai = 0; ai < allowed.length; ai++) {
        var k = allowed[ai];
        if (TOUCH_SETUP_FIXED[k] != null) { next[k] = TOUCH_SETUP_FIXED[k]; fixed += TOUCH_SETUP_FIXED[k]; }
        else { next[k] = 0; rest.push(k); }
      }
      // 3) 余下名额平均分配,余数补给靠前的型号;严格保证 sum(roster) === cap
      var left = Math.max(0, TOUCH_SETUP_CAP - fixed);
      if (rest.length > 0) {
        var each = Math.floor(left / rest.length), extra = left - each * rest.length;
        for (var oi = 0; oi < rest.length; oi++) next[rest[oi]] = each + (oi < extra ? 1 : 0);
      }
      // 4) 回写 roster(非本阵营型号一律 0,杜绝幽灵配额)并同步 cap
      var sum = 0;
      for (var wi = 0; wi < allowed.length; wi++) { S.roster[allowed[wi]] = next[allowed[wi]]; sum += next[allowed[wi]]; }
      S.cap = sum;
      S.rosterBase = null;                                 // 让 scaleRosterToCap 以新 roster 作基线
    }
  })();
}

/* “td”保留为编制/菜单槽键以兼容存档与重部署队列,但作战平台按阵营分流:
   红方td=RED-TD 360°旋转重炮炮塔;蓝方td=BLUE-MBT-2 旋转炮塔。isTD89Vehicle只负责RED-TD远狙/重炮特性。 */
function isM1Vehicle(t) { return !!t && t.kind === 'td' && t.team === 'blue'; }
function isTD89Vehicle(t) { return !!t && t.kind === 'td' && t.team === 'red'; }
function isHeliVehicle(t) { return !!t && (t.kind === 'ah64' || t.kind === 'wz10'); }
function isAAVehicle(t) { return !!t && t.kind === 'aa'; }   // 防空载具:红=RED-AA(雷达+机炮+导弹)/蓝=BLUE-AA(纯导弹,无雷达)

/* ===== 载具三大类标签系统(通用,便于扩展)=====
   三类:'ground'=地面载具(坦克 RED-MBT-1/BLUE-MBT-1/RED-MBT-2/BLUE-MBT-2 + 坦克歼击车 RED-TD)、'arty'=炮兵(火箭炮)、'air'=空中载具(直升机)。
   新增载具时,只需在 VEH_CLASS 里给其 kind 打上对应标签,计分/规则自动继承——无需再逐处 if kind===... 判定。
   指挥官 AI 伤害计分口径:仅 'ground' 计入(坦克+坦歼);'arty'(火箭炮)与 'air'(直升机)造成的伤害一律不计分。 */
var VEH_CLASS = {                                  // kind → 大类标签
  tank: 'ground', '99': 'ground', td: 'ground',   // RED-MBT-1/BLUE-MBT-1 · RED-MBT-2 · RED-TD/BLUE-MBT-2 —— 全部地面载具
  arty: 'arty',                                    // 火箭炮 —— 炮兵
  ah64: 'air', wz10: 'air'                         // BLUE-HELI / RED-HELI —— 空中载具
};
function vehicleClass(t) {                         // 取载具大类(未登记 kind 默认按地面载具兜底)
  var k = (t && typeof t === 'object') ? t.kind : t;
  return VEH_CLASS[k] || 'ground';
}
function vehicleScoresDamage(t) { return vehicleClass(t) === 'ground'; }  // 是否计入指挥官 AI 伤害分(仅地面载具)

/* ===== 直升机飞行力学参数表 =====
   物理常量入表; 接地几何(zFront/zRear/restPitch/groundOffset)与美术模型标定;
   rotorAeroC/driveTorqueMax/dragKH/dragKV 由标定循环自洽反解。 */
var HELI_PARAMS = {
  ah64: {
    zFront: 2.05,
    zRear: -6.27,
    restPitch: 0.1255,        // ~7.19 deg 三点停放仰角
    groundOffset: 0.435,
    mass: 8000.0,             // 最大起飞重量量级 kg
    rotorOmega0: 32.0,        // 标称 100% 主旋翼角速度 rad/s (~305 RPM / 101% Nr)
    tailOmega0: 55.0,         // 标称尾桨角速度 rad/s
    rotorInertia: 233.33,     // 旋翼系统转动惯量 kg·m²
    govP: 0.58,               // 额定悬停基准功率
    collHover: 0.58,          // 悬停总距 (58% 总距推重比 T/W = 1.0)
    collMax: 1.00,            // 满总距 (100% 满行程, 最大可用推重比约 1.72)
    collMin: 0.00,            // 平桨总距 (0% 平桨, 地面怠速待机/零升力)
    collAuto: 0.55,           // 自转下滑有效升力系数
    frictionTorque: 1950.0,   // 轴承与传动摩擦力矩 N·m
    maxPitch: 0.30,           // 最大俯仰角 rad
    maxRoll: 0.30,            // 最大横滚角 rad
    maxSpeedH: 69.44,         // 目标最大平飞速度 m/s(250 km/h)
    turnRate: 1.35,           // 最大偏航角速度 rad/s
    torqueYawK: 0.30, rotorDir: -1,   // 反扭矩 (逆时针旋翼)
    tailAuthK: 0.45           // 尾桨偏航操纵权限
  },
  wz10: {
    zFront: 1.78,
    zRear: -5.30,
    restPitch: 0.1098,        // ~6.29 deg 三点停放仰角
    groundOffset: 0.364,
    mass: 7000.0,
    rotorOmega0: 34.0,
    tailOmega0: 58.0,
    rotorInertia: 208.33,     // 旋翼系统转动惯量 kg·m²
    govP: 0.58,
    collHover: 0.58,          // 悬停总距 (58% 总距推重比 T/W = 1.0)
    collMax: 1.00,            // 满总距 (100% 满行程, 最大可用推重比约 1.72)
    collMin: 0.00,            // 平桨总距 (0% 平桨, 地面怠速待机/零升力)
    collAuto: 0.55,
    frictionTorque: 1850.0,
    maxPitch: 0.32,
    maxRoll: 0.30,
    maxSpeedH: 69.44,         // 250 km/h
    turnRate: 1.45,
    torqueYawK: 0.32, rotorDir: 1,    // 顺时针旋翼
    tailAuthK: 1.30
  }
};

/* 扭矩与阻力标定:
   1. rotorAeroC = frictionTorque/((2.2·govP-1)·w0²), driveTorqueMax = 3.5×rotorAeroC·w0²;
      满桨气动扭矩 (Q0+Q1)·Qmax = 0.90·Qmax + 摩擦 0.02·Qmax, 满油门(≈0.96·Qmax)恒速, 爬升允许轻微下垂
   2. dragKH = T_max×sin(0.21)/maxSpeedH² (0.21rad≈12° 假设俯仰角) */
(function heliCalibrate() {
  for (var hk in HELI_PARAMS) {
    var hp = HELI_PARAMS[hk], w0 = hp.rotorOmega0, w0sq = w0 * w0;
    hp.rotorAeroC = hp.frictionTorque / ((2.2 * hp.govP - 1) * w0sq);
    hp.driveTorqueMax = 3.5 * hp.rotorAeroC * w0sq;
    var tMax = (hp.collMax / hp.collHover) * hp.mass * 9.8;
    hp.dragKH = tMax * Math.sin(0.21) / (hp.maxSpeedH * hp.maxSpeedH);
    hp.dragKV = hp.dragKH * 2.2;
    hp.tailRatio = hp.tailOmega0 / w0;
  }
})();

/* 直升机姿态物理常量(与 updateHeli 力矩/阻尼/桨盘响应同源,AI SAS 伺服与物理层共用同一套) */
var HELI_TORQUE_P = 8.0;      // 俯仰力矩增益 (rad/s² per rad 桨盘倾角)
var HELI_TORQUE_R = 28.0;     // 横滚力矩增益 (rad/s² per rad 桨盘倾角)
var HELI_RATE_DAMP = 4.5;     // 俯仰/横滚角速度气动阻尼 (1/s)
var HELI_TILT_RESP = 2.9;     // 桨盘倾角一阶响应率 (1/s)
var HELI_CYCLIC_RAD = 10.0 * Math.PI / 180.0; // 桨盘周期变距执行上限 ±10° (AI SAS 以 15° 为预算归一化, 执行权限仍为本值)
var HELI_YAW_DAMP = 5.88;     // 偏航气动阻尼
/* AI 自动驾驶级联设计参数: */
var HELI_SAS_LAM = HELI_TILT_RESP * 0.5;
var HELI_SAS_KA = HELI_SAS_LAM / 3;
var HELI_TAU_G = 1.0 / HELI_SAS_KA;
var HELI_TAU_ALT = 3.0 * HELI_TAU_G;
var HELI_TAU_RAD = 6.0 * HELI_TAU_G;
var HELI_ACC_PER_COLL = 34.0;   // 单位总距产生的垂直加速度
/* 涡轴发动机起动与旋翼加速、雷达通电时序常数 */
var HELI_ENGINE_START_TIME = 1.0; // 发动机点火启动耗时 (1.0秒起动机拖动,期间旋翼不转,雷达不通电)
var HELI_GOV_RAMP_TIME = 30.0;     // 涡轴发动机与旋翼加速至100%额定转速所需时间 (幂函数升速: 可支撑总距上限5s达60%, 剩余25s达100%)
/* 旋翼升速拟真标定 (叶素理论 T∝Ω²; FAA-H-8083-21B 低转速/过度总距模型):
   目标转速曲线 wTgt(tRun)=min(1,(tRun/30)^κ), 前馈扭矩调度 aFF=曲线逆解析加速度 把实际转速压上幂函数;
   总距上限 cap=转速 (恒等刻度: 转速表读数=当前可支撑的总距上限), 超上限→"转速过低"报警 + 升力惩罚 + 真实转速下垂负反馈 */
var HELI_SPOOL_KAPPA = 0.2851;   // 升速幂指数 κ=ln(0.6)/ln(5/30): 转速5s=60%(即"足以支撑60%总距"), 剩余25s平缓到100%
var HELI_SPOOL_AMAX = 2.5;       // 起步段角加速度上限 (×Ω₀/s): 抹平 w→0 幂函数奇点, 5s/30s 锚点偏差<0.5%
var HELI_GOV_KP = 0.6;           // 转速调速器比例增益 (1/s): 超拉下垂恢复与带速恒 Nr 维持
var HELI_CAP_EPS = 0.03;         // 超额总距升力惩罚容差 (吸收满功率爬升的轻微转速下垂; 报警容差见 HELI_WARN_GRACE)
var HELI_AERO_Q0 = 0.02;         // 旋翼平桨气动扭矩份额 (悬停58%总距 ≈0.55·Qmax, 满油门可恒速)
var HELI_AERO_Q1 = 0.88;         // 旋翼满桨气动扭矩份额 (满总距 ≈0.90·Qmax < 满油门功率)
var HELI_FRIC_FRAC = 0.02;       // 传动摩擦扭矩份额 (×driveTorqueMax, 升速/带速/熄火共用)
var HELI_WARN_GRACE = 0.02;      // 低转速报警容差 (总距超上限报警阈值; 升力惩罚容差为 HELI_CAP_EPS)
var HELI_RADAR_WARMUP_TIME = 15.0; // 发动机工作后雷达通电预热所需时间 (15.0秒)
var HELI_RADAR_MAX_TRACKS = 8;     // 机载火控雷达最大跟踪目标数 (8个)
var HELI_RADAR_MAX_LOCKS = 4;      // 机载火控雷达最大同时锁定数 (4个)
var HELI_SAFE_TOUCH = 10.0;       // 安全接地速度 m/s(36 km/h,起落架缓冲行程吸收,此速度以下着陆完全无伤)
var HELI_DMG_SCALE = 12.0;
var HELI_DMG_PEAK = 340.0;
var HELI_COLL_VGATE = 3.0;    // 空中错身高度门 m(超过此高度差不参与地面 2D 推挤)
/* 最远作战距离=交火底线(本文件 maxCombatDist/combatFloorOf,按散布×目标正面面积解算)——
   AI 所有射程判断统一走交火底线(无静态常数档) */

/* 火箭炮阵营规格路由:红方(red)=RED-MLRS / 蓝方(blue)=BLUE-MLRS。
   参数可传载具对象或 team 字符串;未知/缺省回落红方规格。全项目读火箭炮规格一律走本函数。 */
function artyConfOf(t) {
  var team = (t && (t.team || (typeof t === 'string' ? t : null))) || 'red';
  return (team === 'blue' && typeof CONF !== 'undefined' && CONF.artyE) ? CONF.artyE : CONF.arty;
}
/* ===== 模块部位名称统一表 =====
   同类载具使用完全相同的部位文本:主战坦克类(RED-MBT-1/BLUE-MBT-1/BLUE-MBT-2)与歼击车类(RED-TD)
   本质相同,全部走 tank 表(RED-TD与坦克类统一);火箭炮:影响转动的模块=发射架下面的
   转盘(turret);发射架/发射舱=弹药架(ammo,火箭弹放在那里,损毁走殉爆链);定向管=gun。 */
var MOD_LABELS = {
  tank: { trackL: 'R TRACK', trackR: 'L TRACK', engine: 'ENGINE', ammo: 'AMMO RACK', fuel: 'FUEL', hull: 'HULL', turret: 'TURRET', gun: 'GUN' },
  arty: { trackL: 'R WHEELS', trackR: 'L WHEELS', engine: 'ENGINE', ammo: 'AMMO RACK', fuel: 'FUEL', hull: 'HULL', turret: 'TURNTABLE', gun: 'LAUNCH TUBES' },
  heli: { trackL: 'ROTOR', trackR: 'ROTOR', engine: 'ENGINE', ammo: 'FEED BIN', fuel: 'FUEL', hull: 'AIRFRAME', turret: 'GUN TURRET', gun: 'CANNON', tailRotor: 'TAIL ROTOR' },
  aa: { trackL: 'R DRIVE', trackR: 'L DRIVE', engine: 'ENGINE', ammo: 'MSL LAUNCHER', fuel: 'FUEL', hull: 'HULL', turret: 'TURRET', gun: 'AA GUN' }
};
function modLabel(kind, team, key) {
  var cat = kind === 'arty' ? 'arty' : (kind === 'aa' ? 'aa' : (isHeliVehicle({ kind: kind }) ? 'heli' : 'tank'));
  return (MOD_LABELS[cat] && MOD_LABELS[cat][key]) || key;
}

/* ===== 全局状态 ===== */
var scene, camera, renderer, clock, sunLight, hemiLight = null, sunDisc = null, moonDisc = null, timeHour = 8, sunOffset = null;   // timeHour=当前小时(0~24,连续时间模型)
var gameState = 'menu';
var freePlay = false;   // 胜利后"继续游戏"豁免标志——继续游玩期间不再判胜负(敌方已满足判负条件,不豁免会每帧重弹结算)
var gameT = 0, startT = 0;
var AI_START_DELAY = 1.5;                 // 每局开局 AI 反应延迟(团队/个人死斗均适用)
var UNIT_ALIVE = 1, UNIT_DYING = 2;
var tanks = [], shells = [], wreckList = [];
var airborneMissiles = [];                    // 在空导弹子列表(发射登记, removeShell 收割)——免 6 处全 shells 扫描/步
var airborneGuidedRockets = [];               // 在空【制导】火箭子列表(仅 guidance 弹登记, 无制导火箭不入)——供火力分配计数,口径同 airborneMissiles
var aliveList = [];            // 活车紧凑表(生成追加/阵亡摘除,顺序与 tanks 一致)——供全表扫描类热点免扫永久残骸
var wreckCount = 0;            // 残骸累计计数(killTank 时 +1,残骸永久不移除;替代每帧全表扫描计数)
var wreckGrid = new Map();     // 残骸空间网格(20m 格,与 collGrid 同构;事件驱动;avoidSteer/resolveCollisions 共用)
function wreckGridInsert(t) {  // 残骸入格,仅在死亡或跨格时登记。
  if (t._wreckGridRegistered) return;
  var k = Math.floor(t.group.position.x / 20) * 4096 + Math.floor(t.group.position.z / 20);   // 整数键(免字符串分配;|iz|<2048 无碰撞)
  t._wgKey = k;
  t._wreckGridRegistered = true;
  var a = wreckGrid.get(k); if (!a) { a = []; wreckGrid.set(k, a); } a.push(t);
}
function wreckGridUpdate(t) {  // 残骸被推动后重注册(跨格才动;保邻域查询与真实位置逐位一致)
  var k = Math.floor(t.group.position.x / 20) * 4096 + Math.floor(t.group.position.z / 20);
  if (k === t._wgKey) return;
  wclBump();                                // 残骸跨格=簇世界变动,缓存全失效
  var old = wreckGrid.get(t._wgKey);
  if (old) { var i = old.indexOf(t); if (i >= 0) old.splice(i, 1); }
  t._wgKey = k;
  var a = wreckGrid.get(k); if (!a) { a = []; wreckGrid.set(k, a); } a.push(t);
}
/* ===== 障碍物空间网格(20m 格,整数键,与 wreckGrid 同构)——
   当前无静态障碍注册源,obstacleGrid 恒空、obstacleMaxR 恒 0;
   obstaclesNear 查询路径保留(avoidSteer/玩家碰撞/AI 调用,空网格返回 0,零开销)。 ===== */
var obstacleGrid = new Map();
var obstacleMaxR = 0;                              // 障碍半径上界(无注册源,恒 0;网格查询范围用)
var _obsNear = [];
function obstaclesNear(x, z, range, out) {
  out.length = 0;
  var rc = Math.ceil(range / 20) + 1, cx = Math.floor(x / 20), cz = Math.floor(z / 20);
  for (var ix = cx - rc; ix <= cx + rc; ix++) for (var iz = cz - rc; iz <= cz + rc; iz++) {
    var arr = obstacleGrid.get(ix * 4096 + iz);
    if (!arr) continue;
    for (var j = 0; j < arr.length; j++) out.push(arr[j]);
  }
  return out.length;
}
/* ===== 残骸簇聚合(F3):range 内残骸按"边缘距 <6m"贪心并簇,返回簇数,
   结果在 _wclOut[0..返回值) = {sx,sz,n,ext}(质心和/成员数/包络半径)。
   堆叠残骸视为单一整体——统一避让/统一掩体评估,消除逐具向量互相打架
   与逐具候选的重复射线;avoidSteer/pickAIDest 共用。 ===== */
var _wclMem = [], _wclCid = [], _wclOut = [];
function wreckClustersNearCalc(x, z, range) {       // 纯计算(无副作用,结果由调用方拷贝)
  var wn = 0, cn = 0, i, j;
  var cx0 = Math.floor(x / 20), cz0 = Math.floor(z / 20), rc = Math.ceil(range / 20) + 1;
  for (var ix = cx0 - rc; ix <= cx0 + rc; ix++) for (var iz = cz0 - rc; iz <= cz0 + rc; iz++) {
    var warr = wreckGrid.get(ix * 4096 + iz);
    if (!warr) continue;
    for (i = 0; i < warr.length; i++) {
      var w = warr[i], wp = w.group.position;
      var dx = wp.x - x, dz = wp.z - z;
      if (dx * dx + dz * dz <= range * range) { _wclMem[wn] = w; wn++; }
    }
  }
  _wclMem.length = wn;
  _wclCid.length = wn;
  for (i = 0; i < wn; i++) {
    var wi = _wclMem[i], wip = wi.group.position, joined = -1;
    for (j = 0; j < cn; j++) {
      var c = _wclOut[j];
      var gx = wip.x - c.sx / c.n, gz = wip.z - c.sz / c.n;
      var gr = c.ext + wi.radius + 6;                    // 离簇边缘 6m 内 → 并入(堆叠=同簇)
      if (gx * gx + gz * gz < gr * gr) { joined = j; break; }
    }
    if (joined >= 0) {
      var c2 = _wclOut[joined];
      var gd = Math.sqrt(gx * gx + gz * gz);
      c2.sx += wip.x; c2.sz += wip.z; c2.n++;
      var eNew = gd + wi.radius;
      if (eNew > c2.ext) c2.ext = eNew;
      _wclCid[i] = joined;
    } else {
      var c3 = _wclOut[cn] || (_wclOut[cn] = { sx: 0, sz: 0, n: 0, ext: 0 });
      c3.sx = wip.x; c3.sz = wip.z; c3.n = 1; c3.ext = wi.radius;
      _wclCid[i] = cn;
      cn++;
    }
  }
  for (j = 0; j < cn; j++) _wclOut[j].ext = 0;
  for (i = 0; i < wn; i++) {                            // 按最终质心精修包络半径
    var c4 = _wclOut[_wclCid[i]], wp2 = _wclMem[i].group.position;
    var ddx = wp2.x - c4.sx / c4.n, ddz = wp2.z - c4.sz / c4.n;
    var ed = Math.sqrt(ddx * ddx + ddz * ddz) + _wclMem[i].radius;
    if (ed > c4.ext) c4.ext = ed;
  }
  return cn;
}
/* ===== 簇查询缓存化:avoidSteer(每车每帧)/掩体评估(0.4s/车)
   重复聚合同一邻域 → 20m 格×range 档缓存,TTL 1s + 残骸世界变动(死亡/被推/跨格)版本失效。
   消费端读 _wclOut 共享槽的契约不变:命中时把缓存簇拷回 _wclOut(簇对象仅 4 字段,拷贝成本可忽略)。 ===== */
var WCL_CACHE_ON = true;          // 性能开关:关闭每次现算
var _wclVer = 0, _wclCache = new Map();
var _wclBumpT = -1;               // 最近一次失效的帧时刻(gameT 每帧唯一,作帧号)
/* ★C1 帧级合并(rubber-banding 根治):玩家撞敌群/残骸堆时每对推挤各调一次 wclBump,
   全局簇缓存反复作废 → 邻近所有 AI 的避障查询同帧反复现算("作废→现算→又作废"乒乓)。
   同帧多次变动合并为一次失效:缓存最多陈旧 1 帧(~16ms),避障用途无感知,每帧至多一轮簇现算。 */
function wclBump() {              // 残骸世界变动时调用(killTank/wreckPushSide/wreckGridUpdate 跨格)
  if (gameT === _wclBumpT) return;
  _wclBumpT = gameT;
  _wclVer++;
}
/* ★整数键+条目槽位池化(多车场卡顿根治):旧包装层每次调用拼字符串键(命中也拼),
   未命中走 _wclSnap 深拷(new Array+n 簇对象+条目对象)——大战中 killTank/推残骸接连 wclBump 全表失效,
   每个避障/掩体查询都是未命中 = 快照分配风暴,GC 停顿经 dt 直通物理 = 玩家车 rubber-banding。
   现键改纯整数(range 实际取值仅每 kind 的 radius+14 常数与 75,round 后确定稳定),
   条目簇对象槽位复用(只增不减原地覆写),稳态零分配。对外契约(写 _wclOut[0..n)、返回 n)不变。 */
function _wclLoad(e) {                               // 条目槽拷回 _wclOut 共享槽(消费端代码零改动)
  for (var i = 0; i < e.n; i++) {
    var c = _wclOut[i] || (_wclOut[i] = { sx: 0, sz: 0, n: 0, ext: 0 }), s = e.cl[i];
    c.sx = s.sx; c.sz = s.sz; c.n = s.n; c.ext = s.ext;
  }
  return e.n;
}
function wreckClustersNear(x, z, range) {            // 包装层:缓存命中直接回拷;未命中现算+入缓
  if (!WCL_CACHE_ON) return wreckClustersNearCalc(x, z, range);
  var r1 = Math.round(range);                        // 量化到整米(实际取值为每 kind 确定常数,边界差 <0.5m)
  var ck = (Math.floor(x / 20) * 4096 + Math.floor(z / 20)) * 128 + r1;
  var e = _wclCache.get(ck);
  if (e && e.ver === _wclVer && gameT - e.t < 1.0) return _wclLoad(e);
  var n = wreckClustersNearCalc(x, z, r1);
  if (!e) {
    if (_wclCache.size > 512) _wclCache.clear();     // 上限防爆内存(查询点集中交战带,实际 <100 条目)
    e = { ver: _wclVer, t: gameT, n: n, cl: [] };
    _wclCache.set(ck, e);
  }
  e.ver = _wclVer; e.t = gameT; e.n = n;
  for (var i = 0; i < n; i++) {                      // calc 结果拷入条目槽(槽位复用,只增不减)
    var s = e.cl[i] || (e.cl[i] = { sx: 0, sz: 0, n: 0, ext: 0 }), c = _wclOut[i];
    s.sx = c.sx; s.sz = c.sz; s.n = c.n; s.ext = c.ext;
  }
  return n;                                          // calc 已写 _wclOut,消费端直接读
}
var targetsList = [];
var obstacles = [];
// 大本营与兵力消耗战
/* ===== 大本营编制:3 兵种 × 3 翼位 = 每方 9 座 =====
   兵种(type)= 坦克 / 炮兵 / 直升机,决定基地的纵深 z(由遭遇战参数三条距离滑杆配置);
   翼位(wing)= 左翼 / 中央 / 右翼,决定基地在战线上的横向 x(战线三等分均布)。
   两者正交:载具型号经 hqTypeOfKind() 定兵种 → 定 z,玩家/AI 再选翼位 → 定 x。
   注意:wing 是"该方自己面向战场时"的左右,故敌方 x 与我方镜像(见 spawnTeams)。 */
var HQ_WINGS = ['left', 'center', 'right'];
var HQ_WING_LABEL = ['LEFT BASE', 'CENTER BASE', 'RIGHT BASE'];
var HQ_WING_CENTER = 1;                                     // 中央翼索引(默认选中 / 解析兜底)
var HQ_WING_SPREAD = 220;                                   // 翼位横向偏移基准(m @2km 图,随地图边长等比缩放)
var hqList = { red: [], blue: [] };                       // [{type,wing,x,z,yaw,...}]

/* 按「兵种 + 翼位」解析大本营。兵种由载具型号推出,翼位由调用方给定(玩家选 / AI 随机)。
   逐级兜底:精确匹配 → 同兵种任意翼 → 首座,保证任何时候都能返回一个可部署点。 */
function hqFind(team, kind, wing) {
  var hqs = hqList[team];
  if (!hqs || !hqs.length) return null;
  var type = hqTypeOfKind(kind), w = clamp(wing | 0, 0, HQ_WINGS.length - 1), i;
  for (i = 0; i < hqs.length; i++) if (hqs[i].type === type && hqs[i].wing === w) return hqs[i];
  for (i = 0; i < hqs.length; i++) if (hqs[i].type === type) return hqs[i];   // 该兵种缺此翼:退同兵种
  return hqs[0];
}
function hqRandWing() { return Math.min(HQ_WINGS.length - 1, (Math.random() * HQ_WINGS.length) | 0); }
var teamPool = { red: 50, blue: 50 };                   // 团队死斗剩余兵力(redeploy 点数)
var respawnQueue = [];                                      // 团队死斗 AI 增援队列
var ffaState = { reserves: 0, playerEliminated: false, finalRank: 0, activeAtStart: 0 };
var player = null;
var kills = 0, damageDealt = 0, playerRespawns = 0;
var respawnT = 0;                  // 阵亡接管友车倒计时
var camShake = 0, camPK = 0;   // camPK 改开镜专属"炮镜被顶起"(应用处 ×scopeT);camShake 只剩挨打/爆炸来源
var mouseDown = false;
var touchJoyOn = false, touchJoyX = 0, touchJoyY = 0;     // 触屏摇杆矢量(flow.js 触控区段事件写入;playerUpdate 消费;x 右+/y 前+)
var killMsgOn = true;                                     // 击杀信息开关(默认开;设置页切换,flow.js 绑定/combat.js 消费)
var pointerLocked = false, lockAvailable = true;
var keys = {};
var scopeT = 0, scoped = false, scopeTick = 0;                     // 开镜状态
/* 火箭炮俯视火控:自由光标 NDC(−1..1,y 向上),mousemove/触屏写入,cameraUpdate 每帧反投影成地面装定点 */
var artTopNX = 0, artTopNY = 0;
/* 火箭炮俯视火控模式激活(Shift/双指开镜且座车为火箭炮):自由光标装定,指针锁定必须解除 */
function artyTopActive() { return !!(player && player.alive && player.kind === 'arty' && scopeMode); }
var scopeZoom = 1;                                        // 炮镜倍率(1.0 默认 ~ 5.0 最大;滚轮调节)
var scopeMode = false;                                             // 炮镜开关(Shift 点按切换,非长按)
var scopeInfo = { laser: Infinity, point: null, impDist: 0, tof: 0 };
var ownVisualsVisible = true;                                      // 开镜后隐藏自身车体
var _scopeResHi = false, _scopeResRatio = 1, _basePixelRatio = 1;    // 开镜动态分辨率缩放标记/当前档位/基准像素比
var DBG_ON = typeof window !== 'undefined' && window.__TANK_DEBUG;
function mkDbgRow() {
  return { fire: 0, pen: 0, bounce: 0, dead: 0, penDmg: 0, killCredit: 0, artyFire: 0, gates: {},
           face: { front: 0, side: 0, rear: 0, top: 0, weak: 0, dome: 0, hullshell: 0 },          // 被命中部位(含跳弹;weak=弱点面板;dome/hullshell=59 真面壳)
           facePen: { front: 0, side: 0, rear: 0, top: 0, weak: 0, dome: 0, hullshell: 0 } };     // 被击穿部位
}
function artyGate(t, g) { if (DBG_ON) { var G = dbgStats[t.team].gates; G[g] = (G[g] || 0) + 1; } }
function gunGate(t, g) { if (DBG_ON) { var G = dbgStats[t.team].gunGates || (dbgStats[t.team].gunGates = {}); G[g] = (G[g] || 0) + 1; } }   // 直瞄哑火审计:装填完毕为何没开火
var dbgPlayerBursts = [];                        // 玩家火箭弹爆点流水(__TANK_DEBUG)
var dbgArtyBursts = [];                          // 全部火箭弹爆点流水(含 owner 引用,AI 齐射弹量审计用)
var dbgStats = {
  red: mkDbgRow(), blue: mkDbgRow(), kills: {}   // kills: 击毁原因统计
};
// 依据命中面法线与车体朝向判断命中部位(调试统计用)
function dbgFace(t, nWorld) {
  if (Math.abs(nWorld.y) > 0.72) return 'top';
  var d = nWorld.x * Math.sin(t.yaw) + nWorld.z * Math.cos(t.yaw);   // 前向 = (sin_yaw, 0, cos_yaw)
  return d > 0.5 ? 'front' : (d < -0.5 ? 'rear' : 'side');
}
