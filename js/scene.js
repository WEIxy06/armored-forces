
/* ===== Module: scene.js ===== */
/* ============================================================
   模块: scene.js — 场景搭建:Three.js 场景/相机/光照/地面网格
   (加载顺序由 index.html MODULES 表决定,勿单独调整)
   ============================================================ */
'use strict';
/* ============================================================
   画质档(GFX)——移动端性能优化的单一开关
   · high = 桌面默认:与优化前逐参数一致(零回归);
   · mid  = 触屏默认:针对手机 GPU 的填充率/带宽短板降配;
   · low  = 老机型救急档:再砍像素比(画面明显偏软,仅在 mid 仍卡时用)。
   三档参数表见 GFX_PRESETS。档位判定优先级:
     ?gfx=high|mid|low 查询串  >  localStorage.prefGfxProfile  >  设备默认
   —— 查询串最高便于桌面 A/B 对比与回归验证(改档需刷新页面生效,
      因为渲染器/阴影贴图都是启动期一次性分配的)。
   为什么只降触屏端:本作最贵的开销全是"全屏面积 × 每像素成本"(绘制像素比、软阴影、
   全屏离屏合成),而手机相对桌面最弱的一环正是填充率与显存带宽。
   · maxPixelRatio 2 → 1.5:渲染缓冲像素数 4× → 2.25×,链路上每一段等比下降(单项收益最大),
     等效于把开镜 DRS 那套"已被用户接受"的降采样推广到全程。
     ★★ 必须与下面 resize 分支同源取用 —— 只改一处的话,窗口尺寸一变就把像素比打回 2,前功尽弃。
   · 阴影贴图 1024 → 512、PCFSoft → PCF:深度 pass 带宽约 1/4,主 pass 每像素阴影采样数 9+ → 4。
     注意:不得改成"隔帧更新"—— 见下方旧注释,隔帧会造成移动载具影子频闪(已实测)。
   · stencil:false:本作不使用模板缓冲,显式关掉省一份缓冲与逐像素模板测试。
     (注意 three r128 渲染器参数名是 stencil;stencilBuffer 是 WebGLRenderTarget 的参数。)

   ★ fx* 字段(爆炸特效专项 E1/E2,见 docs/安卓端性能优化方案.md 附录 B)——
     与上面几项治的不是同一个病:上面治"全程恒定的全屏开销",fx* 治"爆炸事件的瞬时+长驻开销"。
     爆点卡为远距可读而按距离线性放大(scopeDistK),屏占比不随距离衰减 ⇒ 一次火箭弹爆炸 =
     3 层近全屏 alpha 混合(火光/烟/地面高亮),满幅并发 12 张时峰值 ~36 层,移动 GPU 填充率必死。
     · fxDistMax    距离放大上限。面积律:3.4→1.8 ⇒ 单卡面积 ×(1.8/3.4)²=0.28
     · fxYieldMax   当量放大上限(M142 44m 溅射本来会拿到 2.0)
     · fxGroundLight 36m 地面加法高亮面(三层里最大的一层,夜爆照明感来源)
     · fxSatHi/fxSatLo 满幅卡并发阈值(既有降级调速器的滞回门限,机制本就存在,这里只是收紧)
     · fxHardMax    硬顶:超过就不再出大卡(扬尘/弹坑/焦土/音效照常,玩法零影响)
     · fxWreckSmoke 残骸长驻烟柱上限(每具每帧 2 张世界尺寸卡,原 999 且无距离门)
     · fxSmokeR     残骸烟柱可见半径(m);活载具烟走 _csmRefreshVisible 的 600m 门,残骸烟原本绕过了它
     · fxBigTex     爆炸贴图基准边长:1024(高)/512(中低)。显存 24MB→6MB,采样带宽 −75%
     · fxTrailAdapt 齐射期尾迹自适应降频(在飞火箭多时拉大尾迹卡间距)
     · fxBurstMerge 同帧殉爆卡上限(链式殉爆时后续走小卡,防单帧层数爆炸)
     · fxBurstDedup 导弹爆炸去重:命中载具只出殉爆卡、命中地面只出爆点卡(原本两套全出=9 层透明)
     · fxSfxMerge   爆炸音效同点位合并(40m 格 65ms 窗口,压齐射期 Web Audio 节点数)
     高档全部保持"优化前"的原值 ⇒ 桌面端逐参数零回归。
    ★2026-09-13:下表 hudAA/hudPost(炮塔小窗与机库的模型质量开关)已移交模型质量档
     (core_util.js MODQ_PRESETS)独立控制,此处字段原样保留作 sandbox 兜底与数值留档,
     运行时不再被读取(消费方见 player.js _phudBuild / uifx-enhance.js 机库 init)。
   ============================================================ */
var GFX_TOUCH = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;   // ★移动端适配恢复
var GFX_PRESETS = {
  high: { maxPixelRatio: 2,   shadowMapSize: 1024, shadowSoft: true,  noStencil: false, hudAA: true,  hudPost: true,
          fxDistMax: 3.4, fxYieldMax: 2.0, fxGroundLight: true,  fxSatHi: 12, fxSatLo: 8, fxHardMax: 24,
          fxWreckSmoke: 999, fxSmokeR: 0,   fxBigTex: 1024, fxTrailAdapt: false, fxBurstMerge: 0, fxBurstDedup: false, fxSfxMerge: false, fxSpriteCap: 1.0 },
  mid:  { maxPixelRatio: 1.5, shadowMapSize: 512,  shadowSoft: false, noStencil: true,  hudAA: false, hudPost: false,
          fxDistMax: 1.8, fxYieldMax: 1.4, fxGroundLight: false, fxSatHi: 5,  fxSatLo: 3, fxHardMax: 10,
          fxWreckSmoke: 48,  fxSmokeR: 420, fxBigTex: 512,  fxTrailAdapt: true,  fxBurstMerge: 3, fxBurstDedup: true,  fxSfxMerge: true,  fxSpriteCap: 0.6 },
  low:  { maxPixelRatio: 1.0, shadowMapSize: 512,  shadowSoft: false, noStencil: true,  hudAA: false, hudPost: false,
          fxDistMax: 1.5, fxYieldMax: 1.2, fxGroundLight: false, fxSatHi: 3,  fxSatLo: 2, fxHardMax: 6,
          fxWreckSmoke: 24,  fxSmokeR: 300, fxBigTex: 512,  fxTrailAdapt: true,  fxBurstMerge: 2, fxBurstDedup: true,  fxSfxMerge: true,  fxSpriteCap: 0.4 }
};
var GFX_PROFILE = (function () {
  var m = /[?&]gfx=(high|mid|low)\b/.exec(window.location.search || '');
  if (m) return m[1];
  try { var s = localStorage.getItem('prefGfxProfile'); if (GFX_PRESETS[s]) return s; } catch (e) {}
  return GFX_TOUCH ? 'mid' : 'high';   // ★移动端适配恢复:触屏设备默认中档,桌面默认高
})();
var GFX = GFX_PRESETS[GFX_PROFILE];
/* ★移动端适配恢复(P0-①):触屏性能钳——仅当画质档为「设备默认」(未被 ?gfx= 或设置页显式选择)时生效:
   像素比上限 1.5→1.25(省 ~44% 像素量);显式选档用户完全不受钳制。 */
var GFX_TOUCH_CLAMP = false;
if (GFX_TOUCH) {
  GFX_TOUCH_CLAMP = (function () {
    if (/[?&]gfx=(high|mid|low)\b/.test(window.location.search || '')) return false;
    try { if (GFX_PRESETS[localStorage.getItem('prefGfxProfile')]) return false; } catch (e) {}
    return true;
  })();
  if (GFX_TOUCH_CLAMP) {
    var _gfxCopy = {}; for (var _gfxK in GFX) _gfxCopy[_gfxK] = GFX[_gfxK];
    _gfxCopy.maxPixelRatio = Math.min(_gfxCopy.maxPixelRatio, 1.25);
    GFX = _gfxCopy;
  }
}
function gfxMaxPr() { return Math.min(window.devicePixelRatio || 1, GFX.maxPixelRatio); }
/* ============================================================
   场景搭建
   ============================================================ */
function initScene() {
  if (typeof window._setBootProgress === 'function') window._setBootProgress(45, 'COMPILING SHADERS & PROCEDURAL TERRAIN...');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fa3b8);
  // 雾与远平面动态调整:默认口径适配 2~4km 地图(hills 到 half+2200;4km 图对角角点 ≈5660m,加雾缓 6200)
  scene.fog = new THREE.Fog(0x8fa3b8, 900, 6200);

  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 60000); // 远平面扩展至 60km 配合 30km 雷达与大地图   // 对数深度缓冲:远平面放宽到 6.5km,覆盖 4km 对角(4000√2+2200≈7.8km 仍吃雾),根除丘陵远切

  var _rp = { powerPreference: 'high-performance', logarithmicDepthBuffer: true };
  if (GFX.noStencil) _rp.stencil = false;      // 低档才显式传;高档保持 three 默认,确保桌面端行为逐字节不变
  renderer = new THREE.WebGLRenderer(_rp);   // 对数深度缓冲——根治远距 Z-fighting:
  //   线性深度量化步长 ∝ z²/near(500m 处 4~10cm > 建模间隙=远距闪烁根因,near 被炮塔内构钳制无法再抬);
  //   对数深度量化步长 ≈ z·ln(far/near)/2^24 ≈ 距离×9e-7(500m≈0.5mm,1500m≈1.4mm),全距离恒定相对精度。
  //   代价:两个自定义 ShaderMaterial(粒子/余烬)需手动补 logdepthbuf include(fx.js 已补);内置材质全自动。
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(gfxMaxPr());                // ★ 画质档像素比上限(与 resize 分支同源,勿写死 2)
  _basePixelRatio = renderer.getPixelRatio();        // 记录基准像素比(开镜 DRS 恢复用)
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = modQ('modSunSoft', true) ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;   // 模型质量档:非高=PCF(每像素采样 9+ → 4)
  // 恢复每帧阴影更新——dd 的隔帧(30Hz)更新使移动载具影子每两帧在新鲜/滞后间交替=严重频闪(用户实测);
  //   性能靠贴图尺寸+视锥+残骸不投影;不节流(隔帧是频闪源)。抗抖由 cameraUpdate 纹素对齐。
  //   低档的省法=512 贴图 + PCF(降单帧成本),绝不是隔帧(隔帧在任何档位都是禁区)。
  document.body.appendChild(renderer.domElement);

  hemiLight = new THREE.HemisphereLight(0xcfe4ff, 0x54603f, 0.68); // 降低20%光照亮度 (0.85 -> 0.68)
  scene.add(hemiLight);
  sunLight = new THREE.DirectionalLight(0xfff2d8, 0.92); // 降低20%光照亮度 (1.15 -> 0.92)
  sunLight.position.set(110, 58, 75);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(modQ('modSunMap', 1024), modQ('modSunMap', 1024));   // 软阴影;阴影 pass 量级按模型质量档(高=1024 / 中低=512)
  sunLight.shadow.camera.near = 1.0;                 // 收紧近平面(默认 0.5),提高 24-bit 深度缓冲区有效精度
  sunLight.shadow.camera.left = -70; sunLight.shadow.camera.right = 70;   // 初值与合并版一致;每帧 updateSunShadow 以 shR 覆盖,±45 不生效已撤
  sunLight.shadow.camera.top = 70; sunLight.shadow.camera.bottom = -70;
  sunLight.shadow.camera.far = 400;
  sunLight.shadow.bias = 0.00005;                     // 消除坡面自遮挡穿透(非负微偏置)
  sunLight.shadow.normalBias = 0.12;                 // ★斜坡自适应法线偏置(12cm,彻底吸收 45° 坡面纹素落差)
  sunLight.shadow.camera.updateProjectionMatrix();
  scene.add(sunLight);
  scene.add(sunLight.target);
  /* 冷色补光 0x7ea0c0 强度 0.20,无阴影(战场已有半球光,降低20%亮度)。 */
  var vehFillLight = new THREE.DirectionalLight(0x7ea0c0, 0.20);
  vehFillLight.position.set(-15, 12, -12);
  scene.add(vehFillLight); scene.add(vehFillLight.target);
  buildSkyDome();                                       // R25-T5 渐变天空穹顶(替换纯色背景;天顶↔地平线渐变+地平线辉光,随时刻调色)
  buildSunDisc();                                       // 天空挂真实比例太阳(0.53° 硬核 + 微晕)
  buildMoonDisc();                                      // 挂真实比例月亮(0.518° 月盘·月海斑驳;太阳对跖点,地平线上即可见)

  // —— 起伏地面(高度场 + 顶点色)—— 8×8 分块建造(每块 61×61 顶点/边长÷8,2km=250×250m,
  //    每块独立包围球 → 原生视锥剔除 ——
  buildGroundMeshes();

  clock = new THREE.Clock();
  addEventListener('resize', function () {
    // 浏览器缩放(即使滚轮路径已拦截,仍可能经 Ctrl+加/减号/菜单触发)会改 devicePixelRatio:
    // 不同步像素比=渲染缓冲停留在旧分辨率(整体发虚)。开镜 DRS 生效中按当前档位换算,避免覆盖 DRS。
    // ★ pr 必须取自 gfxMaxPr()(画质档上限),不能写死 2 —— 否则任何一次 resize(含转屏)
    //   都会把低档的 1.5 悄悄改回 2,优化静默失效。
    var pr = gfxMaxPr();
    if (Math.abs(pr - _basePixelRatio) > 0.001) {
      _basePixelRatio = pr;
      if (typeof drsApply === 'function') drsApply();      // ★P2-⑧(移动端恢复):统一落笔(基准×全局DRS×开镜档)
      else renderer.setPixelRatio(_scopeResHi ? Math.max(0.35, pr * _scopeResRatio) : pr);
    }
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

/* ===== 地面 8×8 分块重建 ===== */
/* 地面 8×8 分块(每块 61×61 顶点/边长÷8(2km=250×250m),边界顶点两侧复制,dentGrid 同源自动无缝);
   先销毁旧 groundChunks 再重建 —— initScene 按默认 MAP 建菜单背景地面;
   setupMapWorld 开局按所选参数(种子/崎岖度/边长)重建。 */
function buildGroundMeshes() {
  if (typeof window._setBootProgress === 'function') window._setBootProgress(70, 'PARSING VEHICLE BLUEPRINTS & TEXTURES...');
  if (!BQ.ready) biomeRebuild();     // P1:菜单背景地面先于 applyMapConfig 建出,此处兜底建场
  for (var dgi = 0; dgi < groundChunks.length; dgi++) {
    scene.remove(groundChunks[dgi].mesh);
    groundChunks[dgi].geo.dispose();
  }
  groundChunks.length = 0;
  var i, lx, lz;
  var groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1,
    depthTest: true, depthWrite: true });   // real terrain must write depth before world markers
  if (!scSlotTA) scorchFieldBuild();                      // 焦土像素层(菜单背景地面也要有;幂等)
  scorchPatchMaterial(groundMat);                          // 注入:焦土改在片元里解析求值 → 正圆,与网格无关
  biomePatchMaterial(groundMat);                           // P1:三套地貌细节贴图按顶点权重混合(替代单张 map)
  groundMatSea = groundMat;                            // 挂出:开局按地图材质换碎花贴图
  groundBaseCol = new Float32Array(GRID_N * GRID_N * 3);
  groundBaseRock = new Float32Array(GRID_N * GRID_N * 3);   // 焦土混合前的原始顶点色(全局索引,换肤/焦土重放用)
  var _nI2 = new THREE.Vector3();
  var st = GROUND_STYLES.grass, cG = st.g, cD = st.d, cR = st.r;   // 草地图例与换肤同源(防两面夹生)
  var halfW = MAP.halfW || MAP.half, halfL = MAP.halfL || MAP.half;
  var cellX = GRID_CELL_X, cellZ = GRID_CELL_Z;   // 单一真源:与 core.js 的索引↔世界映射同轴
  for (var cX = 0; cX < CHUNK_N; cX++) for (var cZ = 0; cZ < CHUNK_N; cZ++) {
    var V = CHUNK_VERTS, vTot = V * V;
    var cTw0 = new Float32Array(vTot), cTw1 = new Float32Array(vTot), cTw2 = new Float32Array(vTot);
    var cPos = new Float32Array(vTot * 3), cNrm = new Float32Array(vTot * 3), cCol = new Float32Array(vTot * 3), cUv = new Float32Array(vTot * 2), cRck = new Float32Array(vTot * 3);
    for (lz = 0; lz < V; lz++) for (lx = 0; lx < V; lx++) {
      var gix = cX * CHUNK_CELLS + lx, giz = cZ * CHUNK_CELLS + lz;
      var wx = -halfW + gix * cellX, wz = -halfL + giz * cellZ;
      var li = lz * V + lx, gi = giz * GRID_N + gix;
      var hgt = terrainH(wx, wz);
      cPos[li * 3] = wx; cPos[li * 3 + 1] = hgt; cPos[li * 3 + 2] = wz;
      terrainNormal(wx, wz, _nI2);                     // 解析法线(与弹坑增量法线同源,零光照跳变)
      cNrm[li * 3] = _nI2.x; cNrm[li * 3 + 1] = _nI2.y; cNrm[li * 3 + 2] = _nI2.z;
      cUv[li * 2] = wx / (1000 / 140); cUv[li * 2 + 1] = wz / (1000 / 140);   // 世界尺度 UV ~7.14m/簇,与远景丘陵同相位(跨尺寸纹理密度恒定)
      var dry = terrainDry(hgt);
      /* G2-slopefix: bake BASE with steep=0; rock with steep=1 into aRock. Final steep is
         evaluated per-fragment from the interpolated normal (see biomePatchMaterial): vertex-grid
         undersampling of the steep curve no longer aliases on slopes. */
      biomeColorAt(wx, wz, dry, 0, _bCol3, _bTW3);
      biomeColorAt(wx, wz, dry, 1, _bColR, null);
      var r0 = _bCol3[0], g0 = _bCol3[1], b0 = _bCol3[2];
      cTw0[li] = _bTW3[0]; cTw1[li] = _bTW3[1]; cTw2[li] = _bTW3[2];
      cCol[li * 3] = r0; cCol[li * 3 + 1] = g0; cCol[li * 3 + 2] = b0;
      cRck[li * 3] = _bColR[0]; cRck[li * 3 + 1] = _bColR[1]; cRck[li * 3 + 2] = _bColR[2];
      groundBaseCol[gi * 3] = r0; groundBaseCol[gi * 3 + 1] = g0; groundBaseCol[gi * 3 + 2] = b0;
      groundBaseRock[gi * 3] = _bColR[0]; groundBaseRock[gi * 3 + 1] = _bColR[1]; groundBaseRock[gi * 3 + 2] = _bColR[2];
    }
    /* 三角化:棋盘格交替对角线 —— 旧式全图同向对角线,把线性插值的各向异性全部压在同一个
       方向上(沿对角线方向的等值线被系统性拉直),弹坑/焦土的等值线因此被拉成菱形/方形而非圆;
       交替后插值误差四重对称,等值线回归圆形;顶点数与绘制开销零增加。 */
    var cIdx = new Uint16Array(CHUNK_CELLS * CHUNK_CELLS * 6), ip = 0;
    for (lz = 0; lz < CHUNK_CELLS; lz++) for (lx = 0; lx < CHUNK_CELLS; lx++) {
      var qa = lz * V + lx, qb = qa + 1, qc = qa + V, qd = qc + 1;
      if (groundCellParity(cX * CHUNK_CELLS + lx, cZ * CHUNK_CELLS + lz) === 0) {   // 偶格:反对角线(qc–qb),绕向使法线 +Y(朝上)
        cIdx[ip++] = qa; cIdx[ip++] = qc; cIdx[ip++] = qb;
        cIdx[ip++] = qc; cIdx[ip++] = qd; cIdx[ip++] = qb;
      } else {                              // 奇格:主对角线(qa–qd)
        cIdx[ip++] = qa; cIdx[ip++] = qd; cIdx[ip++] = qb;
        cIdx[ip++] = qa; cIdx[ip++] = qc; cIdx[ip++] = qd;
      }
    }
    var cGeo = new THREE.BufferGeometry();
    cGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
    cGeo.setAttribute('normal', new THREE.BufferAttribute(cNrm, 3));
    cGeo.setAttribute('color', new THREE.BufferAttribute(cCol, 3));
    cGeo.setAttribute('aRock', new THREE.BufferAttribute(cRck, 3));
    cGeo.setAttribute('aTw', new THREE.BufferAttribute(_packTw(cTw0, cTw1, cTw2, vTot), 3));
    cGeo.setAttribute('uv', new THREE.BufferAttribute(cUv, 2));
    cGeo.setIndex(new THREE.BufferAttribute(cIdx, 1));
    var cMesh = new THREE.Mesh(cGeo, groundMat);
    cMesh.receiveShadow = true;                        // frustumCulled 默认 true:包围球出视锥即剔除(G1 核心收益)
    scene.add(cMesh);
    groundChunks.push({ mesh: cMesh, geo: cGeo, pos: cGeo.attributes.position, col: cGeo.attributes.color, nrm: cGeo.attributes.normal, tw: cGeo.attributes.aTw, rock: cGeo.attributes.aRock });
  }
  /* P1:map 仍需挂一张纹理,否则 three 不会生成 vUv/<map_fragment> 插槽;
     实际显示的细节由 biomePatchMaterial 的三图加权采样覆盖(见其 fragment 替换)。 */
  var grassTex = buildBiomeTex(0);
  if (grassTex) {
    if (renderer.capabilities && renderer.capabilities.getMaxAnisotropy)
      grassTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    groundMat.map = grassTex;
  }
  var vehTex = buildVehicleTexture();     // 载具大画集(平坦区×顶点色=原色;履带板纹路条带)
  if (vehTex) {
    if (renderer.capabilities && renderer.capabilities.getMaxAnisotropy)
      vehTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    vehBodyMat.map = vehTex;
    vehBodyMat.needsUpdate = true;
    vehHullMat.map = vehTex;           // hull 材质继承同一画集(aVTag.x=10 的履带顶点按 aInstA.xy·uTrackOffL/uTrackOffR 差速偏移纹路)
    vehHullMat.needsUpdate = true;
    vehHullMatPlayer.map = vehTex;
    vehHullMatPlayer.needsUpdate = true;
    if (typeof vehBodyMatPlayer !== 'undefined') { vehBodyMatPlayer.map = vehTex; vehBodyMatPlayer.needsUpdate = true; }   // P0-2 companion:玩家炮塔系同挂画集
  }
}
/* 开局建场入口:应用地图参数 → 显式建高度表 → 重建地面 →
   换肤(顶点色+贴图)→ 重建远景丘陵环。地形=种子+崎岖度+边长;材质纯视觉。 */
function setupMapWorld(seed, rough, side, mat, wid) {
  applyMapConfig(seed, rough, side, mat, wid);
  buildTerrainBaseTable();               // 菜单期 tbLat 可能已按旧参数惰性构建:开局显式重建
  if (typeof navGridBuild === 'function') navGridBuild();   // 奇观连通性验证需 nav 网格(spawnTeams 内幂等重建,约 10ms)
  if (typeof wonderEnsureConnected === 'function') wonderEnsureConnected();   // 验证失败→确定性重布奇观(≤3 次);恒在建地面网格之前
  /* TDM control areas are armed here but remain absent until 30 seconds into
     the match; their later density-based placement never edits the terrain. */
  if (typeof controlZonesPrepare === 'function') controlZonesPrepare();
  buildGroundMeshes();
  if (typeof controlZonesBuildVisuals === 'function') controlZonesBuildVisuals();
  swapGroundStyle(MAP.mat);
  buildHillRing(MAP.mat);
  if (typeof _sprStreamReset === 'function') _sprStreamReset();   // R22-T1:清空上一局流式区块与状态账本(新种子)
  buildTrees();                          // 漫画纸板树:建 mesh + 注册阴影(表由 _sprStream 随足迹流式填充)
  buildGrass();                          // 漫画纸板花草丛:建 mesh(表由 _sprStream 流式填充;仅爆炸可摧毁,玩家可抖动)
  _stumpDispose();                       // 开局清空上一局遗留树桩
  if (typeof initBattlefieldAtmosphere === 'function') initBattlefieldAtmosphere();
}
