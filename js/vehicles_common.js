
/* ===== Module: vehicles_common.js ===== */
/* ============================================================
   模块: vehicles_common.js — 载具建模通用工具(命中盒/可视件/履带环/棱柱/三角剖分)
   (本模块通用部分,须先于 vehicles.js 加载;加载顺序由 index.html MODULES 表决定)
   ============================================================ */
'use strict';
var hiddenMat = new THREE.MeshBasicMaterial();

/* Wrecks are real world occluders for FFA markers, not HUD layers.  Keep their
   depth state explicit because the merged and unmerged wreck paths share this mat. */
var wreckMat  = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 1, metalness: 0.1, emissive: 0x101010, emissiveIntensity: 0.28,
  depthTest: true, depthWrite: true });

function hitBox(parent, w, h, l, x, y, z, rx, ry, rz) {   // rx/ry/rz=可选斜面装甲倾角(部分命中盒已传倾角:EXTRA_HITS 薄弱板/转向件)
  var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), hiddenMat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
  m.visible = false;
  parent.add(m);
  return m;
}

/* 命中壳合并器(命中判定统一标准:每类外部部位=一个命中体):
   [{g 几何, x/y/z 可选位置烘焙}] → 单一 BufferGeometry。
   仅合并 position:射线命中面法线由三角形顶点即时计算(THREE.Raycaster),无需 normal/uv 属性;
   入参几何均为现调现建(prismGeo/BoxGeometry 等),translate 原地烘焙无共享污染。 */
function mergeHitGeos(list) {
  var total = 0, i, gs = [];
  for (i = 0; i < list.length; i++) {
    var g = list[i].g.index ? list[i].g.toNonIndexed() : list[i].g;
    if (list[i].x || list[i].y || list[i].z) g.translate(list[i].x || 0, list[i].y || 0, list[i].z || 0);
    gs.push(g.attributes.position.array); total += g.attributes.position.count;
  }
  var pos = new Float32Array(total * 3), off = 0;
  for (i = 0; i < gs.length; i++) { pos.set(gs[i], off); off += gs[i].length; }
  var out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return out;
}

/* ===== 视觉件合并流水线:整车(车体/炮塔/炮架)各自 1 个 Mesh + 玻璃灯组 1 个 unlit Mesh。
   几十处装饰细节全部烧进顶点缓冲 = 零新增 draw call;细节零 Math.random,不动战斗随机流。
   _skipVis(模板短路):该车型视觉模板已缓存时,视觉几何构建整体跳过——
   每次重生若仍完整构建 ~200 个几何再当场销毁(instBuildTemplate 兜底)即纯 GC 浪费;
   命中壳/EXTRA_HITS/_mkInstSrc 均不经此管线,零影响。 ===== */
var _skipVis = false;

/* ===== 扭杆悬挂·顶点标签(建模期烧录,shader 期消费)——全履带车型通用(59/99/89/M1/M60)=====
   [2026-09-05 属性打包] 原 aTrack/aTrackSide/aSuspA/aSuspB 四属性合并为单个 vec4 aVTag,
   与实例侧 aInstA 打包一起把 hull program 顶点属性数从 20 压回 14(MAX_VERTEX_ATTRIBS=16 硬上限,
   超限 → program 链接失败 → 该材质全部 draw 被丢弃 = 车体整体消失)。编码:
      aVTag.x = 模式: 0 静态 / 1..7 摆臂(仅绕铰点摆动,不自转) / 11..17 负重轮转子(摆动+绕轮心自转,站位=x-11)
                / 18 端轮/诱导轮/主动轮转子(仅自转,无悬挂行程) / -1 底行·跨段履带板 / -2 顶行履带板
                / 10 rolling tread ring / 20 segmented track pieces along the loop
      aVTag.yzw = 参数: 摆臂 (摆向fdir, 铰点z, 铰点y);转子 (摆向fdir×轮半径R, 铰点z, 铰点y);
                  端轮转子 (轮半径R, 轮心z, 轮心y);履带板 (基站位, 本站位权重, 下一站位权重);
                  顶行 (t,0,0);滚动件 (s0,0,0)
    自转角 θ=滚动米数/轮半径(与履带板同一滚动量,线速度天然一致);滚动米数走既有 suspRoll 通道,
    零新增 attribute/uniform/varyings。左右侧一律由顶点 position.x 符号判定(原 aTrackSide 冗余,悬挂分支本就这么做)。 */
var _suspTagA = null;
/* ===== 迷彩身份标记(建模期烧录,风化烘焙/迷彩 shader 共用)——根治颜色启发式:
    visPartPush 按件身份(引用比对当前载具的 cBODY/cACC)逐顶点写 aCamo(1=装甲迷彩件/0=其他),
    烘焙前判定故不受风化漂移影响;新增载具只要沿用 cBODY/cACC 承载装甲色即自动生效,换漆色零改动。
    灯/镜/履带/工具/徽标等非装甲件恒为 0。 */
var _CAMO_BODY_REF = null, _CAMO_ACC_REF = null;
var _CAMO_TEAM = 'red';   // 当前建模载具阵营(仅 visPartPush 打标消费;1=红方数码/2=蓝方NATO)
var _suspRow = 0;                                                                          // 当前建模车型在环路图集中的行号(0..4)
var SUSP_ROW = { t59: 0, t99: 1, td89: 2, m1: 3, m60: 4, pgz95: 5 };                                 // 图集行号(与 SUSP_ATLAS_KEYS 同序)
var SUSP_ATLAS_KEYS = ['t59', 't99', 'td89', 'm1', 'm60', 'pgz95'];
var _suspNW = 4;                                                                           // 当前车型末站位索引(n-1),烧进滚动件 aVTag.w 供 shader 插值用
function _suspSetRow(k) { _suspRow = SUSP_ROW[k] || 0; _suspNW = (SUSP_SPEC[k] ? SUSP_SPEC[k].n : 5) - 1; }
/* 模式 1..7(负重轮/摆臂):.z/.w 载「铰点 z / 铰点 y」——逐轮不同,shader 据此绕铰点旋转。
   与模式 20 的 .z/.w(车型行号 / 末站位)分支互斥,同分量复用不冲突。 */
/* .y = 摆向 fdir(+1 臂朝前 / −1 臂朝后)。★必须传给 shader:轮心绕铰点的旋转角是 −fdir·Δφ,
   而非 Δφ —— 臂朝后的轮子(59/89 首轮、99 前两轮)转向相反,否则 Δφ>0 会让它下沉,
   与 CPU 端「φ↑ = 压缩上行」的约定(pen 用 pivY−L·cos φ,与 fdir 无关)彻底反号。 */
function _suspWheelTag(st, pz, py, fd) { _suspTagA = [1 + st, fd || 1, pz, py]; }           // 摆臂:站位 0..6(左右由顶点 x 符号在 shader 判定),只摆动不自转
/* 负重轮转子(盘/毂/盖/轴/螺栓):摆动 + 绕轮心自转。R=轮盘半径(m):自转角 θ=滚动米数/R,
   半径随 tag 走故各车型/端轮天然正确, shader 侧零查表。 */
function _suspWheelSpinTag(st, pz, py, fd, R) { _suspTagA = [11 + st, (fd || 1) * R, pz, py]; }
/* 端轮转子(诱导轮/主动轮:无悬挂行程):只自转, (cz,cy)=轮心, R=轮盘半径 */
function _suspEndWheelTag(cz, cy, R) { _suspTagA = [18, R, cz, cy]; }
/* 轮毂螺栓圈(转子角向特征, 否则光滑盘自转不可见):6 颗 6 段小圆柱, 环半径 ringR, 贴外端面;
   必须在转子 tag 窗口内调用(随轮自转);sk=侧符, faceX=外端面 x(含符号) */
function wheelBoltRing(bP, sk, faceX, wy, wz, ringR, boltC) {
  for (var bi = 0; bi < 6; bi++) {
    var ba = bi * Math.PI / 3 + Math.PI / 6;
    vCyl(bP, 0.022, 0.022, 0.035, 6, boltC,
      sk * (faceX + 0.008), wy + Math.cos(ba) * ringR, wz + Math.sin(ba) * ringR, 0, 0, Math.PI / 2);
  }
}
/* 模式 20 = 沿环路滚动的履带件(板/铰链销/定位齿)。只需烧入该件的建模弧长 s0:
   件的建模位姿恰好 = 环路在 s0 处的位姿,故 shader 可用同一张查找纹理反解出件的本地坐标系。
   悬挂权重不在建模期固化 —— 板会滚到别的分段去,权重必须按「当前弧长 s'」在 shader 里实时重算。 */
function _suspRollTag(s0) { _suspTagA = [20, s0, _suspRow, _suspNW]; }                      // .z=车型行号(选图集行) .w=末站位索引
function _suspTagClear() { _suspTagA = null; }

function visPartPush(arr, col, geo, x, y, z, rx, ry, rz, side) {
  if (_skipVis) { if (geo && geo.dispose) geo.dispose(); return; }   // 短路:定制几何调用点兜底即弃
  if (!geo.attributes.uv) uvSetFlat(geo);                        // 画集平坦区兜底(tread 盒已先设好 UV,不覆盖)
  var _tag = null;
  if (side) _tag = [10, 0, 0, 0];                                // Rolling tread ring; side is selected from position.x.
  else if (_suspTagA) _tag = _suspTagA;                          // 悬挂/滚动标签:整件常量烧入(缺省 = 无属性 = 静态)
  if (_tag) {
    var _sn = geo.attributes.position.count, _sa = new Float32Array(_sn * 4);
    for (var _si = 0; _si < _sn; _si++) {
      _sa[_si * 4] = _tag[0]; _sa[_si * 4 + 1] = _tag[1];
      _sa[_si * 4 + 2] = _tag[2]; _sa[_si * 4 + 3] = _tag[3];
    }
    geo.setAttribute('aVTag', new THREE.BufferAttribute(_sa, 4));
  }
  if (_tag && geo.userData) geo.userData._wxDyn = _tag[0];   // 风化: 动态件模式号(10/20=履带环件→烘焙禁锈但保留脱漆, 见 weatherBakePart R 门)
  /* 迷彩身份:引用比对(装甲件恒传同一 cBODY/cACC 数组对象,拷贝/字面量一律判 0,防误标);1=红方数码/2=蓝方NATO */
  var _camoF = ((col === _CAMO_BODY_REF || col === _CAMO_ACC_REF) ? (_CAMO_TEAM === 'blue' ? 2.0 : 1.0) : 0.0);
  var _cn = geo.attributes.position.count, _cf = new Float32Array(_cn);
  for (var _ci = 0; _ci < _cn; _ci++) _cf[_ci] = _camoF;
  geo.setAttribute('aCamo', new THREE.BufferAttribute(_cf, 1));
  var m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
  m.setPosition(x, y, z);
  geo.applyMatrix4(m);
  arr.push({ g: geo, c: col, camo: _camoF });
}

/* 建模精细化:载具大画集(平坦区纯白×顶点色=原色不变;上方条带=履带板纹路,纹理盒独占) */
function uvSetFlat(geo) {                     // 全部顶点钉到画集平坦采样点(u 0.05 / v 0.40)
  var n = geo.attributes.position.count, uvf = new Float32Array(n * 2);
  for (var i = 0; i < n; i++) { uvf[i * 2] = 0.05; uvf[i * 2 + 1] = 0.40; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvf, 2));
}

function vBox(arr, w, h, l, col, x, y, z, rx, ry, rz) {
  if (_skipVis) return;
  var g = new THREE.BoxGeometry(w, h, l);
  g.userData = g.userData || {};
  g.userData._wxShape = ['box', w, h, l];   // vcpanel-7: 薄板/翼子板轻量级分类，保留建模原始尺寸避免旋转后 AABB 误判
  uvSetFlat(g);
  visPartPush(arr, col, g, x, y, z, rx, ry, rz);
}

function vCyl(arr, r1, r2, h, seg, col, x, y, z, rx, ry, rz) {
  if (_skipVis) return;
  var g = new THREE.CylinderGeometry(r1, r2, h, seg);
  uvSetFlat(g);
  if (seg >= 8) g.userData = { _wpCyl: [r1, r2, h, seg, x, y, z, rx || 0, ry || 0, rz || 0] };   // 残骸低模重建参数(半段重放同变换) ★vcpanel-4: 12→8, 10/8段轮毂/钢圈亦判圆柱(光滑闭环按柱面处理, 消36°/45°分面伪棱; 6段螺栓面积极小由MINA并入, 标记无害)
  visPartPush(arr, col, g, x, y, z, rx, ry, rz);
}

/* 负重轮三件套装配(辋/毂/轴盖)——基础坦克/高阶坦克A1/89 四型号共用(去重自四处克隆);
   无独立悬挂件;辋厚=履带半宽,外面与带外壁对齐(留 0.005 防与带侧墙共面闪缝):
   o: { n 轮数, wz 轮心z数组, wy 轮心高, rimR 辋半径,
        trkX/trkW 履带中心x/全宽(辋厚=trkW/2 面心=trkX+trkW/4-0.005,外面=带外壁-0.005),
        hubR/hubSeg/hubX 金属轮毂, capR/capSeg/capX 中心轮轴端盖 }
   C: 颜色闭包注入(createTank 局部 cRUBB/cSTEEL/cDARK,helper 为顶层函数取不到) */

/* 挡泥板六件铰链装配(铰销/铰耳×2/主板/裙板/压筋×2/下缘卷边)——基础主战坦克 共用(去重自两处克隆);
   o: { pinF/pinR 前后铰销z, yBase 基准高(59=1.145;M60 翼子板抬高 0.15→1.295,六件 y 全随动) }
   C: 颜色闭包注入(createTank 局部 cSTEEL/cDARK/cACC) */
function fenderSix(bP, fsgn, fsk, o, C) {
  var fPin = fsgn > 0 ? o.pinF : o.pinR, fRx = fsgn * 0.60, x0 = o.x0 || 0;   // x0=整组横移(59外移,不传即0他车不动);ears=false删铰链耳(59)
  vCyl(bP, 0.014, 0.014, 0.56, 8, C.steel, fsk * 1.225 + x0, o.yBase, fPin, 0, 0, Math.PI / 2);          // 铰链轴销(埋翼板端内)
  if (o.ears !== false) {
    vBox(bP, 0.05, 0.075, 0.055, C.dark, fsk * 0.99 + x0, o.yBase - 0.045, fPin);                          // 铰链耳×2(上嵌翼板底/下包销)
    vBox(bP, 0.05, 0.075, 0.055, C.dark, fsk * 1.46 + x0, o.yBase - 0.045, fPin);
  }
  vBox(bP, 0.54, 0.030, 0.16, C.acc, fsk * 1.225 + x0, o.yBase - 0.0452, fPin + fsgn * 0.0660, fRx);     // 主板(背端埋翼板底=铰接)
  vBox(bP, 0.58, 0.030, 0.18, C.acc, fsk * 1.225 + x0, o.yBase - 0.1412, fPin + fsgn * 0.2063, fRx);     // 裙板(宽出 0.04=阶梯)
  vBox(bP, 0.032, 0.012, 0.24, C.acc, fsk * 1.11 + x0, o.yBase - 0.0859, fPin + fsgn * 0.1379, fRx);     // 压筋×2(跨板缝)
  vBox(bP, 0.032, 0.012, 0.24, C.acc, fsk * 1.34 + x0, o.yBase - 0.0859, fPin + fsgn * 0.1379, fRx);
  vBox(bP, 0.58, 0.016, 0.055, C.acc, fsk * 1.225 + x0, o.yBase - 0.1925, fPin + fsgn * 0.2788, fsgn * 0.95); // 下缘卷边(更陡=卷唇读感)
}

/* ===== 履带板纹路尺:板距 0.185m,一贴两板;uvt 条带 y0~128/512 → v 1→0.75 ===== */
var TREAD_PITCH = 0.185;

var TREAD_PERIOD = TREAD_PITCH * 2;

// 履带纹路周期(trackRingGeo P2 = TREAD_PITCH*2 = 0.37m/纹路;偏移=speed*dt/TREAD_PERIOD)
function buildVehicleTexture() {              // 512²:平坦区纯白 + 履带板纹路条带(u 行进向绕卷无缝)
  try {
    var _c = make2DCanvas(512); if (!_c) return null;
    var cv = _c.cv, g = _c.g;
    g.fillStyle = 'rgb(255,255,255)'; g.fillRect(0, 0, 512, 512);      // 平坦区(×顶点色=原色)
    g.fillStyle = 'rgb(240,240,240)'; g.fillRect(0, 0, 512, 128);      // 板面基体(亮=乘色后可压暗)
    g.fillStyle = 'rgb(176,176,176)'; g.fillRect(0, 30, 512, 5); g.fillRect(0, 93, 512, 5);   // 两条纵向筋影(沿行进向拉通,板板对齐)
    g.fillStyle = 'rgb(216,216,216)'; g.fillRect(0, 0, 512, 10); g.fillRect(0, 118, 512, 10); // 板缘楔边明暗
    for (var k = 0; k < 2; k++) {                                       // 中央诱导齿×2(板体中筋:凸齿+根影)
      var cx = k * 256 + 128;
      g.fillStyle = 'rgb(226,226,226)';
      g.beginPath(); g.moveTo(cx - 27, 78); g.lineTo(cx - 20, 50); g.lineTo(cx + 20, 50); g.lineTo(cx + 27, 78); g.closePath(); g.fill();
      g.strokeStyle = 'rgb(148,148,148)'; g.lineWidth = 3; g.stroke();
      g.fillStyle = 'rgb(118,118,118)'; g.fillRect(cx - 12, 82, 24, 8);
    }
    for (k = 0; k < 3; k++) {                                           // 横向板缝×3(板界居中,绕卷无缝)
      g.fillStyle = 'rgb(98,98,98)'; g.fillRect(k * 256 - 13, 0, 26, 128);
      g.fillStyle = 'rgb(68,68,68)'; g.fillRect(k * 256 - 6, 0, 12, 128);
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;   // u=行进向可绕卷;v 防渗边
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
    return tex;
  } catch (e) { return null; }
}

/* ===== UV 映射(BoxGeometry 面序:+X(0..3) −X(4..7) +Y(8..11) −Y(12..15) +Z(16..19) −Z(20..23)) ===== */
function uvTreadFaces(geo, w, h, l, faces) {
  var P2 = TREAD_PITCH * 2;
  var pos = geo.attributes.position.array, uvt = new Float32Array(24 * 2);
  for (var v = 0; v < 24; v++) {
    var x = pos[v * 3] + w / 2, y = pos[v * 3 + 1] + h / 2, z = pos[v * 3 + 2] + l / 2;
    var f = (v / 4) | 0, tex = false, u = 0, vv = 0;
    if ((f === 0 || f === 1) && faces.indexOf('x') >= 0) { tex = true; u = z / P2; vv = y / h; }   // ±X 侧面(履带侧/挂板)
    else if ((f === 2 || f === 3) && faces.indexOf('y') >= 0) { tex = true; u = z / P2; vv = x / w; }  // ±Y 顶/底面(履带接地)
    else if ((f === 4 || f === 5) && faces.indexOf('z') >= 0) { tex = true; u = x / P2; vv = y / h; }  // ±Z 端面(首上/车尾挂板)
    if (tex) { uvt[v * 2] = u; uvt[v * 2 + 1] = 1 - vv * 0.25; }
    else { uvt[v * 2] = 0.05; uvt[v * 2 + 1] = 0.40; }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvt, 2));
}

/* ===== 履带板纹路盒:faces='xy'(履带长跑段:侧/顶/底面)|'z'(首上/车尾挂板)|'x'(侧挂板) ===== */
function vTreadBox(arr, w, h, l, col, x, y, z, rx, ry, rz, faces) {
  if (_skipVis) return;
  var g = new THREE.BoxGeometry(w, h, l);
  uvTreadFaces(g, w, h, l, faces);
  visPartPush(arr, col, g, x, y, z, rx, ry, rz);
}

// 同原值(端轮半径不变:R_fillet = R_轮缘 + 0.05 内缩全包鼓轮)
function genTrackLoop(pts, R, decim) {                                   // filleted 多边形中心线采样;decim=采样步倍率(缺省1=原密度,残骸低模传>1)
  var n2 = pts.length, i, k, area = 0, cx = 0, cy = 0;
  for (i = 0; i < n2; i++) { var a0 = pts[i], b0 = pts[(i + 1) % n2]; area += a0[0] * b0[1] - b0[0] * a0[1]; cx += a0[0]; cy += a0[1]; }
  cx /= n2; cy /= n2;
  var A = [], B = [], O = [], PHI = [];
  for (i = 0; i < n2; i++) {
    var pr = pts[(i + n2 - 1) % n2], cu = pts[i], nx = pts[(i + 1) % n2];
    var ux = cu[0] - pr[0], uy = cu[1] - pr[1], ul = Math.hypot(ux, uy); ux /= ul; uy /= ul;
    var vx = nx[0] - cu[0], vy = nx[1] - cu[1], vl = Math.hypot(vx, vy); vx /= vl; vy /= vl;
    var co = Math.max(-1, Math.min(1, ux * vx + uy * vy)), tt = R[i] / Math.tan((Math.PI - Math.acos(co)) / 2);
    var Ax = cu[0] - ux * tt, Ay = cu[1] - uy * tt, Bx = cu[0] + vx * tt, By = cu[1] + vy * tt;
    var n1x = -uy, n1y = ux;                                                     // 入边法线
    if (n1x * (cx - Ax) + n1y * (cy - Ay) < 0) { n1x = -n1x; n1y = -n1y; }       // 取指向质心(内侧)者
    var Ox = Ax + n1x * R[i], Oy = Ay + n1y * R[i];
    var ax = Ax - Ox, ay = Ay - Oy, bx = Bx - Ox, by = By - Oy;
    A.push([Ax, Ay]); B.push([Bx, By]); O.push([Ox, Oy]);
    PHI.push(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
  }
  var out = [];
  function pushP(x, y) { var L = out.length; if (!L || Math.hypot(x - out[L - 1][0], y - out[L - 1][1]) > 1e-9) out.push([x, y]); }
  for (i = 0; i < n2; i++) {
    var j = (i + 1) % n2, Bx2 = B[i], Ax2 = A[j];
    var _dm = decim || 1;
    var el = Math.hypot(Ax2[0] - Bx2[0], Ax2[1] - Bx2[1]), st = Math.max(1, Math.round(el / (0.25 * _dm)));
    for (k = 0; k < st; k++) pushP(Bx2[0] + (Ax2[0] - Bx2[0]) * k / st, Bx2[1] + (Ax2[1] - Bx2[1]) * k / st);
    var oi = O[j], phi = PHI[j], rj = R[j], ms = Math.max(4, Math.round(Math.abs(phi) * rj / (0.12 * _dm)));
    var v0x = A[j][0] - oi[0], v0y = A[j][1] - oi[1];
    for (k = 0; k <= ms; k++) {
      var th = phi * k / ms, cth = Math.cos(th), sth = Math.sin(th);
      pushP(oi[0] + v0x * cth - v0y * sth, oi[1] + v0x * sth + v0y * cth);
    }
  }
  if (out.length > 1 && Math.hypot(out[out.length - 1][0] - out[0][0], out[out.length - 1][1] - out[0][1]) < 1e-6) out.pop();  // 闭合点重复弹掉
  return out;
}

function trackRingGeo(halfW, T, poly, fillet, decim, loopPts) {   // decim>1=残骸低模粗采样;loopPts=物理环路点列(99/89/M1与视觉同源,替代poly/fillet)
  var ctr = loopPts || genTrackLoop(poly || TRACK_POLY, fillet || TRACK_FILLET, decim), M = ctr.length, i, cx = 0, cy = 0;
  for (i = 0; i < M; i++) { cx += ctr[i][0]; cy += ctr[i][1]; } cx /= M; cy /= M;
  var EN = [];                                                                   // 逐边外法线(背离质心)
  for (i = 0; i < M; i++) {
    var p0 = ctr[i], p1 = ctr[(i + 1) % M];
    var ez = p1[0] - p0[0], ey = p1[1] - p0[1], L = Math.hypot(ez, ey) || 1;
    var nx2 = ey / L, ny2 = -ez / L;
    if (nx2 * ((p0[0] + p1[0]) / 2 - cx) + ny2 * ((p0[1] + p1[1]) / 2 - cy) < 0) { nx2 = -nx2; ny2 = -ny2; }
    EN.push([nx2, ny2]);
  }
  var out = [], inn = [];                                                        // 外/内壁=中心线沿点法线(邻边均值)±T/2
  for (i = 0; i < M; i++) {
    var e0 = EN[(i + M - 1) % M], e1 = EN[i], mx = e0[0] + e1[0], my = e0[1] + e1[1], ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
    out.push([ctr[i][0] + mx * T / 2, ctr[i][1] + my * T / 2]);
    inn.push([ctr[i][0] - mx * T / 2, ctr[i][1] - my * T / 2]);
  }
  var pos = [], nrm = [], uvs = [], s = [0], P2 = TREAD_PITCH * 2, FLAT = [0.05, 0.40];
  for (i = 0; i < M; i++) { var pp = out[i], qq = out[(i + 1) % M]; s.push(s[i] + Math.hypot(qq[0] - pp[0], qq[1] - pp[1])); }
  function tri(a, b, c, nx, ny, nz, ua, ub, uc) {
    var ex = b[0] - a[0], ey = b[1] - a[1], ez2 = b[2] - a[2], fx = c[0] - a[0], fy = c[1] - a[1], fz = c[2] - a[2];
    var wx = ey * fz - ez2 * fy, wy = ez2 * fx - ex * fz, wz = ex * fy - ey * fx;
    if (wx * nx + wy * ny + wz * nz < 0) { var t = b; b = c; c = t; var t2 = ub; ub = uc; uc = t2; }
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    uvs.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }
  for (i = 0; i < M; i++) {
    var j = (i + 1) % M, q0 = out[i], q1 = out[j], w0 = inn[i], w1 = inn[j], en = EN[i];
    var u0 = s[i] / P2, u1 = s[j] / P2, ny3 = en[1], nz3 = en[0];
    tri([-halfW, q0[1], q0[0]], [halfW, q0[1], q0[0]], [halfW, q1[1], q1[0]], 0, ny3, nz3, [u0, 1.0], [u0, 0.75], [u1, 0.75]); // 外壁:履带板纹路
    tri([-halfW, q0[1], q0[0]], [halfW, q1[1], q1[0]], [-halfW, q1[1], q1[0]], 0, ny3, nz3, [u0, 1.0], [u1, 0.75], [u1, 1.0]);
    tri([-halfW, w0[1], w0[0]], [halfW, w1[1], w1[0]], [halfW, w0[1], w0[0]], 0, -ny3, -nz3, FLAT, FLAT, FLAT);              // 内壁(法线朝环心)
    tri([-halfW, w0[1], w0[0]], [-halfW, w1[1], w1[0]], [halfW, w1[1], w1[0]], 0, -ny3, -nz3, FLAT, FLAT, FLAT);
    tri([halfW, q0[1], q0[0]], [halfW, q1[1], q1[0]], [halfW, w1[1], w1[0]], 1, 0, 0, FLAT, FLAT, FLAT);                     // 外侧环面(履带侧墙)
    tri([halfW, q0[1], q0[0]], [halfW, w1[1], w1[0]], [halfW, w0[1], w0[0]], 1, 0, 0, FLAT, FLAT, FLAT);
    tri([-halfW, q0[1], q0[0]], [-halfW, w0[1], w0[0]], [-halfW, w1[1], w1[0]], -1, 0, 0, FLAT, FLAT, FLAT);                 // 内侧环面
    tri([-halfW, q0[1], q0[0]], [-halfW, w1[1], w1[0]], [-halfW, q1[1], q1[0]], -1, 0, 0, FLAT, FLAT, FLAT);
  }
  return finishGeo(pos, nrm, uvs);
}

/* 非索引复用几何的统一收尾:pos / nrm(可选 uvs)平铺数组 → BufferGeometry。
   顶点各面独立(硬边,读得出焊接折线),故索引就是 0..n-1 顺序表;
   顶点数过 65535 自动升 Uint32 索引。uvs 传 null 表示该几何不需要贴图坐标。 */
function finishGeo(pos, nrm, uvs) {
  var g = new THREE.BufferGeometry(), pn = pos.length / 3, i;
  var idx = pn > 65535 ? new Uint32Array(pn) : new Uint16Array(pn);
  for (i = 0; i < pn; i++) idx[i] = i;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  if (uvs) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}


/* 分段式履带板流水线(对标红方主战坦克 9895-9920:节距0.185铺板+节缝铰链销+内侧定位齿;环路走 genTrackLoop 中心线):
   o: { trkX 履带中心x, plateW 板宽, poly, fillet, loopFn(物理环路点列函数,优先生效) } C: { dark, steel } —— 99/89/M1 共用(59系自建 loop59,走位逻辑同源) */
function segTrackPlates(bP, o, C) {
  for (var tr = -1; tr <= 1; tr += 2) {
    var loop = o.loopFn ? o.loopFn() : genTrackLoop(o.poly, o.fillet), LM = loop.length, i;
    var cum = [0];
    for (i = 1; i <= LM; i++) cum.push(cum[i - 1] + Math.hypot(loop[i % LM][0] - loop[i - 1][0], loop[i % LM][1] - loop[i - 1][1]));
    var len = cum[LM], n = Math.max(8, Math.round(len / TREAD_PITCH)), st = len / n;
    var ccx = 0, ccy = 0;
    for (i = 0; i < LM; i++) { ccx += loop[i][0]; ccy += loop[i][1]; }
    ccx /= LM; ccy /= LM;
    function at(s) {
      s = ((s % len) + len) % len;
      var lo = 0, hi = LM;
      while (lo < hi - 1) { var m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
      var A = loop[lo % LM], B = loop[(lo + 1) % LM], t = (s - cum[lo]) / ((cum[lo + 1] - cum[lo]) || 1);
      return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
    }
    for (i = 0; i < n; i++) {
      var pA = at(i * st), pB = at((i + 1) * st), pC = at((i + 0.5) * st);
      var dZ = pB[0] - pA[0], dY = pB[1] - pA[1], dl = Math.hypot(dZ, dY) || 1;
      var rx = Math.atan2(-dY, dZ);
      /* [2026-09-09 履带滚动] 板/销/齿三件各烧自身建模弧长(模式 20):
         板与齿定位在板心 (i+0.5)·st,铰链销在节缝 i·st。悬挂权重由 shader 按滚动后弧长实时重算。 */
      _suspRollTag((i + 0.5) * st);
      vBox(bP, o.plateW, 0.05, 0.175, C.dark, tr * o.trkX, pC[1], pC[0], rx, 0, 0);   // 履带板(节距0.185留0.01缝,厚0.05)
      _suspRollTag(i * st);
      vCyl(bP, 0.03, 0.03, o.plateW - 0.05, 8, C.steel, tr * o.trkX, pA[1], pA[0], 0, 0, Math.PI / 2);   // 铰链销(节缝处)
      var tz = dZ / dl, ty = dY / dl, qz = -ty, qy = tz;   // 内法线=切线垂向取朝环心者(质心判向)
      if (qz * (ccx - pC[0]) + qy * (ccy - pC[1]) < 0) { qz = -qz; qy = -qy; }
      _suspRollTag((i + 0.5) * st);
      vBox(bP, 0.10, 0.08, 0.06, C.dark, tr * o.trkX, pC[1] + qy * 0.065, pC[0] + qz * 0.065, rx, 0, 0);   // 定位齿(内侧,走双盘中缝)
      _suspTagClear();
    }
  }
}

/* 两片式负重轮组(对标红方主战坦克 9940-9945:内外橡胶半盘+盘间轴+外轮盘+轴盖;轮轴水平连车侧,替红方主战坦克摆臂):
   o: { n, wz[], wy, rimR, trkX, hullX(车侧x,轴内端贴壁) } C: { rub, steel, dark } —— 99/89/M1 共用 */
function twinWheelSet(bP, sk, o, C) {
  /* [2026-09-09 扭杆悬挂] 轮轴改为「摆臂式」:上铰座贴车壁 + 摆臂斜连轮心(对标 59 式 hullParts59)。
     o.fdir[w] 定摆向(-1 臂朝后 / +1 臂朝前),o.pivY 为铰点高(= 轮心 y + 0.307)。
     整组(内外半盘/盘间轴/外轮盘/轴盖/摆臂)统一烧 aVTag 站位标签,由 shader 绕铰点整体旋转。
     未传 fdir 时退化为原「水平轴连车侧」外观(兼容无悬挂车型)。 */
  var hasSusp = !!o.fdir;
  for (var w = 0; w < o.n; w++) {
    var wz = o.wz[w], wy = o.wy, R = o.rimR, tx = o.trkX;
    /* 转子(盘/轴/毂/盖/螺栓):摆动 + 自转, R=轮盘半径;摆臂:只摆动(单列 tag, 与转子分离) */
    if (hasSusp) _suspWheelSpinTag(w, wz + o.fdir[w] * 0.193, o.pivY, o.fdir[w], R);
    vCyl(bP, R, R, 0.14, 14, C.rub, sk * (tx - 0.14), wy, wz, 0, 0, Math.PI / 2);   // 内半盘
    vCyl(bP, R, R, 0.14, 14, C.rub, sk * (tx + 0.14), wy, wz, 0, 0, Math.PI / 2);   // 外半盘
    vCyl(bP, 0.07, 0.07, 0.18, 8, C.steel, sk * tx, wy, wz, 0, 0, Math.PI / 2);     // 盘间轴(走齿槽,两端各埋盘0.02)
    vCyl(bP, R * 0.667, R * 0.667, 0.05, 12, C.steel, sk * (tx + 0.225), wy, wz, 0, 0, Math.PI / 2);   // 外轮盘(咬外盘0.01/凸出0.04)
    vCyl(bP, R * 0.293, R * 0.293, 0.04, 8, C.dark, sk * (tx + 0.26), wy, wz, 0, 0, Math.PI / 2);      // 轴盖
    wheelBoltRing(bP, sk, tx + 0.25, wy, wz, R * 0.41, C.dark);   // 毂面螺栓圈×6(转子角向特征)
    if (hasSusp) {
      _suspTagClear();
      _suspWheelTag(w, wz + o.fdir[w] * 0.193, o.pivY, o.fdir[w]);   // 摆臂 tag(只摆动)
      var fd = o.fdir[w], zb = wz + fd * 0.193;                                  // 铰点 z(轮心 ± 臂水平投影)
      vCyl(bP, 0.045, 0.045, SUSP_ARM_L, 8, C.steel, sk * (o.hullX + 0.065), wy + 0.1535, wz + fd * 0.0965,
           fd * 0.5616, 0, sk * 0.1907);                                         // 摆臂(轮心→铰座,前后倾;与 59 同姿态式)
      _suspTagClear();
      vBox(bP, 0.06, 0.10, 0.10, C.steel, sk * (o.hullX + 0.03), o.pivY, zb);    // 摆臂上铰座(车体侧固定件,不随摆臂转)
    } else {
      _suspTagClear();   // 无悬挂车型:转子 tag 未开(上无 tag),此清零是空操作,防串味
      var ax1 = tx - 0.14;   // 轮轴:车侧 hullX→内盘心(无悬挂时的水平轴)
      vCyl(bP, 0.09, 0.09, ax1 - o.hullX, 8, C.steel, sk * ((o.hullX + ax1) / 2), wy, wz, 0, 0, Math.PI / 2);
    }
  }
  _suspTagClear();
}

/* 两片式端轮(对标红方主战坦克 9949-9958:内外半盘+轮轴+盘间轴+齿圈;轮心位置沿用各车现值):
   o: { R, y, z, trkX, hullX, ringX(齿圈心x,缺省trkX+0.22) } —— 99/89/M1 共用 */
/* All end wheels share the proportional 59-style construction; wheel centers and radii remain unchanged. */
var END_HUB_K = 0.63;                      // 毂/轮径比(59 式两端轮均值:诱导 61% / 主动 65%)
function twinEndWheel(bP, sk, o, C) {
  var tx = o.trkX, hubX = (o.ringX != null ? o.ringX : tx + 0.22);
  var hubR = o.R * END_HUB_K;                                                            // 毂(削薄→0.08,咬外盘0.03/凸出0.05)
  _suspEndWheelTag(o.z, o.y, o.R);   // 端轮转子 tag(只自转,无悬挂行程;轮轴静态不进 tag)
  vCyl(bP, o.R, o.R, 0.14, 16, C.rub, sk * (tx - 0.14), o.y, o.z, 0, 0, Math.PI / 2);   // 内半盘(齿槽容定位齿)
  vCyl(bP, o.R, o.R, 0.14, 16, C.rub, sk * (tx + 0.14), o.y, o.z, 0, 0, Math.PI / 2);   // 外半盘
  vCyl(bP, 0.07, 0.07, 0.18, 8, C.steel, sk * tx, o.y, o.z, 0, 0, Math.PI / 2);         // 盘间转轴(连内外盘,走齿槽中)
  vCyl(bP, hubR, hubR, 0.08, 12, C.steel, sk * hubX, o.y, o.z, 0, 0, Math.PI / 2);
  wheelBoltRing(bP, sk, hubX + 0.04, o.y, o.z, hubR * 0.62, C.dark);   // 毂面螺栓圈×6
  _suspTagClear();
  var ax1 = tx - 0.14;                                                                   // 轮轴(内端贴壁 hullX 不穿入)
  vCyl(bP, 0.09, 0.09, ax1 - o.hullX, 8, C.steel, sk * ((o.hullX + ax1) / 2), o.y, o.z, 0, 0, Math.PI / 2);
}

/* ===== 火箭炮 6×6 卡车轮(轮转子自转)=====
   单轮构成(分阵营规格 ARTY_WHEEL_SPEC):红 RED_MLRS 轮胎 r0.535/w0.30(轮心 x±1.10);蓝 BLUE_MLRS 轮胎 r0.59/w0.32(轮心 x±1.04);钢圈/轮毂随比例。
   复用端轮转子 tag(模式 18:只自转,无悬挂行程;卡车无外露轮轴,整轮进 tag)。
   自转角 θ=滚动米数/R,走既有 suspRoll 通道(差速+断轮冻结自动继承;滚动米数由 _trackDifferential 按轮周长取模累计)。
   角向特征(光滑圆柱自转不可见,必须配):外端面螺栓圈×6(落钢圈面上)+胎面花纹块×12(绕周均布,凸出胎面 0.01,前后视角亦可读滚动)。
   sk=侧符(±1);C={ rub 胎色, steel 圈/毂色, dark 螺栓色 }(颜色闭包注入,与 twinWheelSet 同范式)。 */
var ARTY_WHEEL_SPEC = {                        // 分阵营车轮规格(与建模/轮组命中壳/滚动取模同源)
  red:  { R: 0.535, wx: 1.10, tw: 0.30, rimR: 0.31, hubR: 0.165 },   // RED_MLRS: 万山 WS2400 大直径单胎(外胎面=±1.25)
  blue: { R: 0.590, wx: 1.04, tw: 0.32, rimR: 0.34, hubR: 0.182 }    // BLUE_MLRS: FMTV M1140 泄气保用胎(外胎面=±1.20)
};
var ARTY_WHEEL_CIRC_OF = { red: 2 * Math.PI * 0.535, blue: 2 * Math.PI * 0.590 };   // 轮周长(滚动米数取模周期;整周取模=零视觉跳变)
function artyWheel(bP, sk, wz, C, o) {
  var S = o || ARTY_WHEEL_SPEC.red, R = S.R, wx = S.wx, wy = R, tw = S.tw;   // 轮心 y=R(接地);缺省规格=红方(向后兼容)
  _suspEndWheelTag(wz, wy, R);   // 卡车轮转子 tag(只自转)
  vCyl(bP, R, R, tw, 12, C.rub, sk * wx, wy, wz, 0, 0, Math.PI / 2);                    // 轮胎
  vCyl(bP, S.rimR, S.rimR, tw + 0.01, 10, C.steel, sk * wx, wy, wz, 0, 0, Math.PI / 2); // 钢圈(侧缘出露 5mm)
  vCyl(bP, S.hubR, S.hubR, tw + 0.02, 8, C.steel, sk * wx, wy, wz, 0, 0, Math.PI / 2);  // 轮毂
  wheelBoltRing(bP, sk, wx + tw / 2, wy, wz, S.rimR * 0.667, C.dark);                   // 螺栓圈×6(落钢圈外端面,转子角向特征)
  for (var li = 0; li < 12; li++) {                                                     // 胎面花纹块×12(绕周均布;径向 0.05/凸出胎面 0.01)
    var la = li * Math.PI / 6;
    vBox(bP, tw + 0.02, 0.05, 0.14, C.rub, sk * wx, wy + Math.cos(la) * (R - 0.015), wz + Math.sin(la) * (R - 0.015), la, 0, 0);
  }
  _suspTagClear();
}

/* ===== 一体化棱柱外壳(坦克精细化):(z,y) 凸多边形沿 X 拉伸成型 ——
   斜首/平顶/斜尾一次成型,无拼缝、无悬浮件("不漏风");逐面用叉积自动校正绕向,
   保证外侧朝向永不被背面剔除(凡绘制即实体)。法线逐面平直,读得出焊接折线。 ===== */
function prismGeo(halfW, pts) {
  var n = pts.length, i, pos = [], nrm = [];
  var cz = 0, cy = 0;
  for (i = 0; i < n; i++) { cz += pts[i][0]; cy += pts[i][1]; }
  cz /= n; cy /= n;
  function tri(a, b, c, nx, ny, nz) {
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
    if (wx * nx + wy * ny + wz * nz < 0) { var t = b; b = c; c = t; }   // 绕向自动校正到期望法线一侧
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  }
  for (i = 0; i < n; i++) {                                            // 侧墙:每边一个四边形(2 三角)
    var p = pts[i], q = pts[(i + 1) % n];
    var ez = q[0] - p[0], ey = q[1] - p[1], L = Math.hypot(ez, ey);
    var ny2 = ez / L, nz2 = -ey / L;                                   // 候选外法线(由截面边方向导出)
    var my2 = (p[1] + q[1]) / 2 - cy, mz2 = (p[0] + q[0]) / 2 - cz;
    if (ny2 * my2 + nz2 * mz2 < 0) { ny2 = -ny2; nz2 = -nz2; }         // 指向多边形质心反侧=外侧
    var A = [-halfW, p[1], p[0]], B = [halfW, p[1], p[0]];
    var C = [halfW, q[1], q[0]], D = [-halfW, q[1], q[0]];
    tri(A, B, C, 0, ny2, nz2); tri(A, C, D, 0, ny2, nz2);
  }
  for (i = 1; i < n - 1; i++) {                                        // 两端盖:凸多边形扇形三角化
    tri([halfW, pts[0][1], pts[0][0]], [halfW, pts[i + 1][1], pts[i + 1][0]], [halfW, pts[i][1], pts[i][0]], 1, 0, 0);
    tri([-halfW, pts[0][1], pts[0][0]], [-halfW, pts[i][1], pts[i][0]], [-halfW, pts[i + 1][1], pts[i + 1][0]], -1, 0, 0);
  }
  return finishGeo(pos, nrm, null);
}

function vPrism(arr, col, halfW, pts, x, y, z) { if (_skipVis) return; visPartPush(arr, col, prismGeo(halfW, pts), x, y, z); }

/* ===== 共享三角剖分工具(闭壳自动定向) ----
   以壳内部点 inside 为基准:叉积法线背向内部点则交换 b/c,保证所有三角面朝外。
   各闭壳几何构建函数(td89Casemate/m1Turret/m60Turret/m60Cupola/m60Rangefinder)
   以本地一行 tri/vertex/xyz 委托接入,闭包只保留 pos/idx/inside。 ===== */
// 追加顶点,返回序号
function pushVert(pos, x, y, z) { var n = pos.length / 3; pos.push(x, y, z); return n; }

// 按序号取 [x,y,z]
function vertAt(pos, n) { return [pos[n * 3], pos[n * 3 + 1], pos[n * 3 + 2]]; }

// 坐标式:a/b/c 为 [x,y,z],顶点直接追加进 pos(非索引复用)
function triOrientPush(pos, idx, inside, a, b, c) {
  var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  var fx = (a[0] + b[0] + c[0]) / 3 - inside[0],
      fy = (a[1] + b[1] + c[1]) / 3 - inside[1],
      fz = (a[2] + b[2] + c[2]) / 3 - inside[2];
  if (nx * fx + ny * fy + nz * fz < 0) { var q = b; b = c; c = q; }
  var n0 = pos.length / 3;
  pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  idx.push(n0, n0 + 1, n0 + 2);
}

/* 索引式:a/b/c 为 pos 中既有顶点序号,只追加索引 */
function triOrientIdx(pos, idx, inside, a, b, c) {
  var A = vertAt(pos, a), B = vertAt(pos, b), C = vertAt(pos, c);
  var ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
  var vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
  var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  var fx = (A[0] + B[0] + C[0]) / 3 - inside[0],
      fy = (A[1] + B[1] + C[1]) / 3 - inside[1],
      fz = (A[2] + B[2] + C[2]) / 3 - inside[2];
  if (nx * fx + ny * fy + nz * fz < 0) { var q = b; b = c; c = q; }
  idx.push(a, b, c);
}

/* 合并同位置重复顶点(SphereGeometry 接缝 φ=0/2π 与北极:同位置多 id、法线各异 → 光照折痕)。
   重写索引到代表顶点,删除孤立顶点,UV 同步(壳体 UV 均为钉平,无缝合语义)。 */
function mergeCoincidentVerts(g) {
  var pos = g.attributes.position.array, idx = g.index.array;
  var n = pos.length / 3, map = {}, remap = new Array(n), keep = [], i, t, k;
  for (i = 0; i < n; i++) {
    var x = Math.abs(pos[i * 3]) < 1e-6 ? 0 : pos[i * 3];
    var y = Math.abs(pos[i * 3 + 1]) < 1e-6 ? 0 : pos[i * 3 + 1];
    var z = Math.abs(pos[i * 3 + 2]) < 1e-6 ? 0 : pos[i * 3 + 2];
    k = x.toFixed(5) + ',' + y.toFixed(5) + ',' + z.toFixed(5);
    if (map[k] === undefined) { map[k] = i; keep.push(i); }
    remap[i] = map[k];
  }
  if (keep.length === n) return g;
  var newId = new Array(n);
  for (i = 0; i < keep.length; i++) newId[keep[i]] = i;
  var out = new Array(idx.length);
  for (t = 0; t < idx.length; t++) out[t] = newId[remap[idx[t]]];
  var posArr = new Float32Array(keep.length * 3);
  for (t = 0; t < keep.length; t++) { posArr[t * 3] = pos[keep[t] * 3]; posArr[t * 3 + 1] = pos[keep[t] * 3 + 1]; posArr[t * 3 + 2] = pos[keep[t] * 3 + 2]; }
  g.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  if (g.attributes.uv) {
    var uv = g.attributes.uv.array, uvArr = new Float32Array(keep.length * 2);
    for (t = 0; t < keep.length; t++) { uvArr[t * 2] = uv[keep[t] * 2]; uvArr[t * 2 + 1] = uv[keep[t] * 2 + 1]; }
    g.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  }
  g.setIndex(out);
  return g;
}

