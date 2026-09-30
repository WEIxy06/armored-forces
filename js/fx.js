
/* ===== Module: fx.js ===== */
/* ============================================================
   模块: fx.js — 特效:烟雾/火光/排烟/扬尘/余烬/爆炸全家桶/闪光
   (加载顺序由 index.html MODULES 表决定,勿单独调整)
   ============================================================ */
'use strict';
/* ============================================================
   特效资产与场景装饰(点粒子系统已全部退役,特效均为贴图卡/实例网格):
   地面涂装 / 草地贴图 / 云 / 弹坑余烬 / 残骸火星卡 / 爆炸壳(经 comic.js)
   ============================================================ */
var groundMatSea = null;           // initScene 挂出地面材质(材质换肤用)
/* 地面顶点基色调色板:草地=草甸青绿 / 沃土=暗棕泥土 */
var GROUND_STYLES = {
  grass: { g: [0.40, 0.46, 0.30], d: [0.55, 0.52, 0.35], r: [0.48, 0.47, 0.43] },      // 湿草/干草/岩坡
  soil:  { g: [0.225, 0.180, 0.132], d: [0.325, 0.268, 0.190], r: [0.290, 0.255, 0.220] }, // 湿泥/干土/岩砾(深暗棕)
};
/* 重刷地面顶点基色(换风格时):高程/坡度渐变 + 逐顶点斑驳抖动;
   已有焦土按 scorchVtxQ 账本(顶点层已烘焦度)依同配方重放(永久承诺跨换肤依然成立);
   主流焦土由地面材质在片元里解析求值(像素层),换肤无需重放 */
function repaintGround(style) {
  if (!groundChunks.length) return;
  var st = GROUND_STYLES[style] || GROUND_STYLES.grass;
  // 分块换肤——斑驳哈希用全局索引(与旧单网格逐位同图案,块化零视觉差)
  for (var c = 0; c < groundChunks.length; c++) {
    var gc = groundChunks[c], pos = gc.pos, nrm = gc.nrm, colA = gc.col, twA = gc.tw, rockA = gc.rock;
    var cX = (c / CHUNK_N) | 0, cZ = c % CHUNK_N;
    for (var lz = 0; lz < CHUNK_VERTS; lz++) for (var lx = 0; lx < CHUNK_VERTS; lx++) {
      var li = lz * CHUNK_VERTS + lx;
      var gi = (cZ * CHUNK_CELLS + lz) * GRID_N + (cX * CHUNK_CELLS + lx);   // 全局索引(哈希基准不变)
      var h = pos.array[li * 3 + 1];
      var dry = terrainDry(h);
      /* G2-slopefix: dual bake, same as buildGroundMeshes (base steep=0 into color, rock steep=1 into aRock) */
      biomeColorAt(pos.array[li * 3], pos.array[li * 3 + 2], dry, 0, _bCol3, _bTW3);
      biomeColorAt(pos.array[li * 3], pos.array[li * 3 + 2], dry, 1, _bColR, null);
      var r = _bCol3[0], g2 = _bCol3[1], b = _bCol3[2];
      if (twA) { twA.array[li * 3] = _bTW3[0]; twA.array[li * 3 + 1] = _bTW3[1]; twA.array[li * 3 + 2] = _bTW3[2]; }
      // 全图(可活动+不可活动)土地统一为 GROUND_STYLES 渐变
      /* ★R1 顶点亮度抖动已于 R26 移除(原: 按全局顶点索引 gi 做黄金比哈希量化成 3 档,
         乘子 {0.92,1.00,1.08}(泥土 {0.87,1.00,1.13}), 直接乘进顶点色)。
         移除理由: 该抖动按顶点索引寻址, 图案 = frac(0.618*i + 0.660*j) 的对角向等距栅格,
         周期约 1.1 格, 与棋盘格交替对角线三角化拍频后在地面形成规则方块状明暗交替 ——
         正午峰峰 13/255、热像 9/255、夜间 0.7/255(与"正午最明显、热像也可见"完全吻合)。
         地面细粒层次改由 buildGrassTexture 的 Minecraft 风笔触提供(±10% @5.6cm/纹素,
         有 mipmap, 屏幕空间滤波, 不与网格拍频)。依据: 《地面方格纹-问题定位报告》§11。 */
      var m = 1;
      var i3 = li * 3, gi3 = gi * 3, qv = scorchVtxQ[gi] / 255, f2 = 0;
      groundBaseCol[gi3] = r * m; groundBaseCol[gi3 + 1] = g2 * m; groundBaseCol[gi3 + 2] = b * m;
      groundBaseRock[gi3] = _bColR[0] * m; groundBaseRock[gi3 + 1] = _bColR[1] * m; groundBaseRock[gi3 + 2] = _bColR[2] * m;
      if (qv > 0) {                                        // 焦土顶点:以新基色重放旧焦度(与像素层同配方)
        var u2 = 1 - qv; f2 = scorchMixAt(u2); scorchColInto(u2, _scTgt);
        colA.array[i3]     = r * m * (1 - f2) + _scTgt[0] * f2;
        colA.array[i3 + 1] = g2 * m * (1 - f2) + _scTgt[1] * f2;
        colA.array[i3 + 2] = b * m * (1 - f2) + _scTgt[2] * f2;
        if (rockA) { rockA.array[i3] = _bColR[0] * m * (1 - f2) + _scTgt[0] * f2; rockA.array[i3 + 1] = _bColR[1] * m * (1 - f2) + _scTgt[1] * f2; rockA.array[i3 + 2] = _bColR[2] * m * (1 - f2) + _scTgt[2] * f2; }
      } else {
        colA.array[i3] = r * m; colA.array[i3 + 1] = g2 * m; colA.array[i3 + 2] = b * m;
        if (rockA) { rockA.array[i3] = _bColR[0] * m; rockA.array[i3 + 1] = _bColR[1] * m; rockA.array[i3 + 2] = _bColR[2] * m; }
      }
    }
    colA.needsUpdate = true;
    if (twA) twA.needsUpdate = true;
    if (rockA) rockA.needsUpdate = true;
  }
}
/* 开局材质换肤:重刷顶点基色 + 重新生成对应碎花/泥土层的地面贴图并热替换 */
function swapGroundStyle(style) {
  repaintGround(style);
  if (typeof weatherSetDustCol === 'function') weatherSetDustCol(style);   // 载具积尘色 = 本地图干土色
  /* P1:地面细节贴图不再随"地图材质"整张替换 —— 三套地貌贴图由片元按顶点权重混合。
     此处只保证 map 槽有纹理(UV 载体)。 */
  var tex = buildBiomeTex(0);
  if (tex && groundMatSea && groundMatSea.map !== tex) {
    if (renderer.capabilities && renderer.capabilities.getMaxAnisotropy)
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    groundMatSea.map = tex; groundMatSea.needsUpdate = true;
  }
}

// —— 天空云朵:不受雾影响的 Sprite 布告板,缓慢漂移、边界环绕(纯装饰,不影响战斗) ——
var clouds = [];
function initClouds() {
  var tex = buildCloudTexture();
  if (!tex) return;                  // 无头环境无 2D canvas → 跳过(仅浏览器可见)
  for (var i = 0; i < 18; i++) {
    var big = i < 8;                 // 少量大朵高云铺底 + 多朵小云
    var sx = big ? rand(210, 330) : rand(90, 180);
    var baseCol = Math.random() < 0.6 ? 0xffffff : 0xdfe6ee;
    var mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, fog: false,
      opacity: big ? rand(0.30, 0.45) : rand(0.45, 0.68),
      color: baseCol
    });
    var sp = new THREE.Sprite(mat);
    sp.scale.set(sx, sx * rand(0.30, 0.42), 1);
    sp.position.set(rand(-1000, 1000), rand(150, 235), rand(-1000, 1000));
    /* ★炮镜闪烁根治:炮镜视锥极窄(28°~5.6°),云 sprite(最大 330m 宽 ≈26° 角宽)的包围球
       在视锥边缘进出时整朵半透明云 pop 进/出 = 全屏色彩跳变(上下移动镜头=视锥边界扫过云群
       =逐朵 pop=闪烁;上抬=云/日从上缘整朵切入=变色)。关剔除后由 GPU 裁剪平滑进出边缘:
       视锥外 sprite 仅 4 顶点着色、零片元,18 朵常驻零实际成本(与 ember 同策略)。 */
    sp.frustumCulled = false;
    scene.add(sp);
    clouds.push({ sp: sp, baseCol: baseCol, vx: (big ? rand(1.2, 2.2) : rand(2.5, 4.5)) * (Math.random() < 0.85 ? 1 : -1) });
  }
}
function cloudsUpdate(dt) {
  if (typeof skyDomeTrack === 'function') skyDomeTrack();   // R25-T5 天空穹顶跟随相机(无视差)
  sunTrack();                                            // 太阳布告板逐帧钉在镜头前 1900m 的光照方位上
  moonTrack();                                           // 月亮逐帧钉位(太阳对跖点,随小时旋转)
  for (var i = 0; i < clouds.length; i++) {
    var c = clouds[i];
    c.sp.position.x += c.vx * dt;
    if (c.sp.position.x > 1050) c.sp.position.x = -1050;
    else if (c.sp.position.x < -1050) c.sp.position.x = 1050;
  }
}

// 单车排气源解析:红方歼击车从前装甲发动机隔栅喷出;直升机从机身上方双发排气口喷出;其余载具保留车尾排气口。
function engineExhaustSourceLocal(t,out,dx,dz) {
  if(!t) return out.set(dx||0, 1.78, -2.55);
  if(isTD89Vehicle(t)) return td89EngineGrillePoint(dx||0,dz||0,0.065,out);
  if(t.kind === 'aa' && t.team === 'red') return out.set(0.56+(dx||0), 1.505, 2.752+(dz||0));   // 任务25:RED_AA 前置发动机——排烟源=首上右侧格栅(格栅板心 x+0.56/y1.4469/z2.7369[含车体抬升0.3125]+沿斜面法向 0.968/0.253 外凸0.06;动力舱判定盒 x+0.30=右侧重合;修复前误用通用尾部 (0,1.78,-2.55))
  if(t.kind === 'wz10') return out.set(dx||0, 2.83, -0.65 + (dz||0));
  if(t.kind === 'ah64') return out.set(dx||0, 2.86, -0.55 + (dz||0));
  return out.set(dx||0,1.78,-2.55);
}

/* ============================================================
   弹坑余烬(火箭弹坑缘的"未烧尽灰烬",贴地焦灰斑块):★最省性能路线★
   —— 不是粒子系统、不是精灵池:全场 ONE Mesh · ONE DrawCall · 普通混合(无跃动火苗/布告板)。
   · 视觉:贴地炭灰斑块(三层值噪声斑驳、边缘波浪不规则轮廓),斑内嵌零星暗红余点
     慢呼吸(0.7~1.3Hz,贴地不抬头)= 没烧尽的灰烬;无贴图全程序化,显存零增长;
   · 每枚燃烧点 4 顶点逐点 terrainH 取样出生(同地形凹坑/凸缘起伏)——出生后再有邻坑改写地形时,
     emberCrater 单遍内重锚固重新取样贴合(立制/da 并入单遍:根治\"余烬被后坑凸缘埋没/悬空消失\");
     顶点着色器零动画(不读 uT、不看相机),GPU 每帧只跑片元 3 核呼吸发光(加法混合叠亮);
   · 槽位只增不灭:初始 1536 枚;被新坑翻土覆盖的槽回收复用,不够用则 +768 步进扩容(旧烬一枚不死);
     硬顶 16384 枚(Uint16 索引极限);触顶不再整坑哑火——回收最老一枚活烬腾槽,新坑必有火星;
   · 仅弹坑生效帧(≤0.12s 节流)局部改写 2 个属性并 needsUpdate(≤2~3KB);
   · 每帧 CPU 唯一动作 = 写 uT 一个 uniform(加法混合免雾色同步),零逐顶点运算、零每帧分配;
   · 渲染硬约束=DoubleSide(贴地四边形索引序法线 -Y 朝下,FrontSide 会被整体背面剔除);
   · 纯视觉:不进任何战斗/伤害逻辑;唯一死法=爆心翻土区(新坑 R*0.75 内)抹除——相邻旧坑保留各自余烬,
     焦土外环(R*1.25~2.1)另布凉屑余点(根治\"许多弹坑/焦土没有火星\")。
   ============================================================ */
var EMBER_INIT = 1536, EMBER_GROW = 768, EMBER_HARD = 16384;  // 初始/扩容步长/物理硬顶(16384*4=65536 顶点=Uint16 索引极限;每坑≈15~20 点≈820~1090 坑,触顶后 FIFO 回收最老活烬)
var emberCap = 0;                     // 当前槽位容量(只增不减;扩容≠回收,旧余烬永不时间熄灭)
var emberMesh = null, emberMat = null;
var emberList = [];                   // 槽位账本 {x,y,z,t,on,kind}:仅覆盖抹除用,无任何时间/容量回收(JS 侧,不进 GPU)
var emberFree = [];                   // 空闲槽位栈
var emberBuckets = new Map();         // 12m 桶 → [槽号...](弹坑生效只查邻桶,替代全 16k 槽线性扫)
/* ★E1-7(附录 B §B.3):余烬缓冲增量上传。
   原实现在 emberCrater 末尾只置 needsUpdate 而未设 updateRange —— three r128 的 updateRange.count
   默认 -1 = **整个 buffer 重传**,所以那句"仅弹坑生效帧上传(≤2.3KB+3KB)"的注释与实现不符:
     槽位 1536(开局) → 每批 172KB;6144(中期) → 688KB;16384(硬顶) → 1.84MB。
   弹坑批次每 0.3s 一次(main.js),齐射期持续触发 ⇒ 稳态 0.6~6MB/s 的无效上传。
   现改为「记脏槽区间 + updateRange」,与本工程既有范式同构(弹道线 _rklMark/_comicRocketLineFlush、
   CSM/CGD 各池的 updateRange 写法)。区间制(min..max)而非逐槽列表:一次弹坑的槽位天然聚簇
   (emberSpot 连续取栈顶),区间几乎就是紧致集;实现简单且无分配。 */
var _embDMin = Infinity, _embDMax = -1;
function _embMark(s) { if (s < _embDMin) _embDMin = s; if (s > _embDMax) _embDMax = s; }
function emberFlush() {                        // 把本批脏槽区间一次上传(无脏=零开销早退)
  if (!emberMesh || _embDMax < _embDMin) return;
  var g = emberMesh.geometry.attributes, v0 = _embDMin * 4, nV = (_embDMax - _embDMin + 1) * 4;
  g.position.updateRange.offset = v0 * 3; g.position.updateRange.count = nV * 3;
  g.aData.updateRange.offset = v0 * 4; g.aData.updateRange.count = nV * 4;
  g.position.needsUpdate = true; g.aData.needsUpdate = true;
  _embDMin = Infinity; _embDMax = -1;
}
function _emberBucketKey(x, z) { return (Math.floor(x / 12) + 96) * 192 + (Math.floor(z / 12) + 96); }
function initEmberFx() {
  var geo = new THREE.BufferGeometry();
  emberCap = EMBER_INIT;
  var vN = emberCap * 4;
  var aPos = new Float32Array(vN * 3);       // 贴地四边形 4 角(出生时逐角 terrainH 取样;死槽全同点=零面积)
  var aCorner = new Float32Array(vN * 2);    // 静态角点(-0.5~0.5),初始化后永不改写
  var aData = new Float32Array(vN * 4);      // x=半径(0=死槽) y=随机种子 z=余温(0 凉屑~1 主堆) w=保留
  var idx = new Uint16Array(emberCap * 6);
  for (var s = 0; s < emberCap; s++) {
    var v = s * 4;
    aCorner[(v + 0) * 2] = -0.5; aCorner[(v + 0) * 2 + 1] = -0.5;
    aCorner[(v + 1) * 2] =  0.5; aCorner[(v + 1) * 2 + 1] = -0.5;
    aCorner[(v + 2) * 2] =  0.5; aCorner[(v + 2) * 2 + 1] =  0.5;
    aCorner[(v + 3) * 2] = -0.5; aCorner[(v + 3) * 2 + 1] =  0.5;
    idx[s * 6] = v; idx[s * 6 + 1] = v + 1; idx[s * 6 + 2] = v + 2;
    idx[s * 6 + 3] = v; idx[s * 6 + 4] = v + 2; idx[s * 6 + 5] = v + 3;
    emberList.push({ x: 0, y: 0, z: 0, t: 0, on: false, kind: 0 });
    emberFree.push(emberCap - 1 - s);        // 栈顶=槽0
  }
  geo.setAttribute('position', new THREE.BufferAttribute(aPos, 3));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(aCorner, 2));
  geo.setAttribute('aData', new THREE.BufferAttribute(aData, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  emberMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uFog: { value: new THREE.Vector2(900, 4300) } },   // uFog=初始基础雾距(运行时不跟随 scene.fog 更新;加法混合:远烬贡献按雾距渐隐,免雾色同步)
    vertexShader: [
      'attribute vec2 aCorner;',
      'attribute vec4 aData;',
      'varying vec2 vC;',
      'varying vec2 vInfo;',                    // x=随机种子 y=余温
      'varying float vZ;',
      '#include <common>',                           // logdepth 依赖(isPerspectiveMatrix/EPSILON)
      '#include <logdepthbuf_pars_vertex>',          // 对数深度(自定义 shader 必须手补)
      'void main() {',
      '  vC = aCorner; vInfo = vec2(aData.y, aData.z);',
      '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',   // 顶点=出生时就地取样,零动画(燃烧点贴地不跳舞)
      '  vZ = -mv.z;',
      '  gl_Position = projectionMatrix * mv;',
      '  #include <logdepthbuf_vertex>',
      '}'
    ].join('\n'),
    fragmentShader: [
      'varying vec2 vC;',
      'varying vec2 vInfo;',
      'varying float vZ;',
      'uniform float uT; uniform vec2 uFog;',
      '#include <logdepthbuf_pars_fragment>',        // 对数深度(depthTest 与对数缓冲同编码)
      'float hash1(float n) { return fract(sin(n) * 43758.5453); }',
      'void main() {',
      '  #include <logdepthbuf_fragment>',
      '  float seed = vInfo.x, hot = vInfo.y;',
      '  vec3 acc = vec3(0.0);',
      '  for (int i = 0; i < 3; i++) {',                                // 每块 3 枚零星燃烧点:1 主核偏块心 + 2 碎核散开(种子定位,可燃物混在尘土里)
      '    float fi = float(i);',
      '    float hx = hash1(seed * 61.7 + fi * 17.13);',
      '    float hy = hash1(seed * 43.3 + fi * 29.77);',
      '    float ht = hash1(seed * 97.1 + fi * 11.31);',
      '    vec2 kp = (vec2(hx, hy) - 0.5) * (i == 0 ? 0.18 : 0.52);',
      '    float kr = mix(0.09, 0.18, ht) * (i == 0 ? 1.35 : 1.0);',    // 核半径(块内单位,主核大):视觉直径≈0.07~0.60m 萤火点
      '    float k = max(0.0, 1.0 - length(vC - kp) / kr);',
      '    k = k * k * (3.0 - 2.0 * k);',                               // 软圆斑(内核亮→边缘柔灭)
      '    float ph = 0.5 + 0.5 * sin(uT * (0.5 + ht * 0.8) + seed * 43.0 + fi * 2.4);',   // 各核错相慢呼吸 0.5~1.3Hz
      '    float amp = (0.55 + 0.45 * ph) * (0.42 + 0.58 * hot);',      // 亮度下限≈0.23>0:微微发光、明暗呼吸,但永不熄灭
      '    vec3 kcol = mix(vec3(1.05, 0.10, 0.005), vec3(1.12, 0.42, 0.05), ht * 0.55 + ph * 0.45);',   // 深红→橙红
      '    kcol = mix(kcol, vec3(1.28, 0.80, 0.32), k * k * k * (0.30 + 0.55 * hot));',   // 核芯转暖黄(炽热)
      '    acc += kcol * (k * amp);',
      '  }',
      '  acc *= (1.0 - smoothstep(0.40, 0.50, length(vC))) * 1.30;',    // 圆裁防方角漏光 + 整体发光增益
      '  float fogK = 1.0 - smoothstep(uFog.x, uFog.y, vZ);',
      '  acc *= fogK;',                                                 // 加法混合:远烬贡献随场景雾距渐隐(免雾色 uniform)
      '  if (acc.r + acc.g + acc.b < 0.004) discard;',
      '  gl_FragColor = vec4(acc, 1.0);',                               // 加法混合(α=1):亮度直接加到焦黑地面上——发光点才亮得起来
      '}'
    ].join('\n'),
    // DoubleSide 硬约束:贴地四边形索引序的世界叉积法线 = -Y(朝下),仅 FrontSide 会被整体背面剔除(全隐形事故根因)
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, transparent: true, depthWrite: false, depthTest: true, fog: false
  });
  emberMesh = new THREE.Mesh(geo, emberMat);
  emberMesh.frustumCulled = false;             // 顶点数动态(封顶 32k):恒 1 draw call,剔除反而亏
  emberMesh.matrixAutoUpdate = false;          // 顶点即世界坐标,矩阵恒等冻结
  emberMesh.renderOrder = 2;                   // 透明件排在焦土/硝烟后,贴地不抢序
  scene.add(emberMesh);
}
function emberKill(s) {                        // 尺寸归零 + 顶点坍缩同点 → 全类型零面积(GPU 零片元),槽位回栈
  var L = emberList[s];
  if (!L.on) return;
  var bk = _emberBucketKey(L.x, L.z), barr = emberBuckets.get(bk);
  if (barr) {
    var bi = barr.indexOf(s);
    if (bi >= 0) barr.splice(bi, 1);
    if (!barr.length) emberBuckets.delete(bk);
  }
  L.on = false;
  var g = emberMesh.geometry.attributes, dA = g.aData.array, pA = g.position.array, v = s * 16;
  for (var i = 0; i < 4; i++) {
    dA[v + i * 4] = 0;
    var p3 = (s * 4 + i) * 3;
    pA[p3] = L.x; pA[p3 + 1] = L.y; pA[p3 + 2] = L.z;
  }
  _embMark(s);                                 // ★E1-7:槽位入脏区(上传由 emberFlush 合批)
  emberFree.push(s);
}
function emberOldest() {                     // 硬顶回收——找最老活槽(FIFO)抹除腾位,新坑必有火星
  var best = -1, bt = Infinity;
  for (var s = 0; s < emberList.length; s++) {
    var L = emberList[s];
    if (L.on && L.t < bt) { bt = L.t; best = s; }
  }
  if (best >= 0) emberKill(best);            // 抹除→槽位回栈(触顶静默弃坑会让新坑整片无火星,故必回收腾位)
  return best;
}
function emberSlotTake() {                     // 空闲槽(被覆盖灭掉的)优先;满槽自动扩容——绝不回收活槽
  if (emberFree.length) return emberFree.pop();
  if (emberCap >= EMBER_HARD) {
    if (emberOldest() < 0) return -1;        // 全场无活烬(理论不可达)才弃坑
    return emberFree.pop();
  }
  emberGrow();
  return emberFree.pop();
}
function emberGrow() {                         // 步进扩容:属性整体换新(旧槽数据原样拷入,视觉零闪断);仅扩容帧有一次全量上传
  var oldG = emberMesh.geometry, oA = oldG.attributes;
  var newCap = Math.min(emberCap + EMBER_GROW, EMBER_HARD);
  var vN = newCap * 4;
  var aPos = new Float32Array(vN * 3), aCorner = new Float32Array(vN * 2), aData = new Float32Array(vN * 4);
  var idx = new Uint16Array(newCap * 6);
  aPos.set(oA.position.array); aCorner.set(oA.aCorner.array); aData.set(oA.aData.array);   // 旧烬一块不动
  idx.set(oldG.index.array);
  for (var s2 = emberCap; s2 < newCap; s2++) {
    var v = s2 * 4;
    aCorner[(v + 0) * 2] = -0.5; aCorner[(v + 0) * 2 + 1] = -0.5;
    aCorner[(v + 1) * 2] =  0.5; aCorner[(v + 1) * 2 + 1] = -0.5;
    aCorner[(v + 2) * 2] =  0.5; aCorner[(v + 2) * 2 + 1] =  0.5;
    aCorner[(v + 3) * 2] = -0.5; aCorner[(v + 3) * 2 + 1] =  0.5;
    idx[s2 * 6] = v; idx[s2 * 6 + 1] = v + 1; idx[s2 * 6 + 2] = v + 2;
    idx[s2 * 6 + 3] = v; idx[s2 * 6 + 4] = v + 2; idx[s2 * 6 + 5] = v + 3;
    emberList.push({ x: 0, y: 0, z: 0, t: 0, on: false, kind: 0 });
    emberFree.push(newCap - 1 - (s2 - emberCap));   // 逆序压栈 → 弹栈从 emberCap 起升序
  }
  var g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.BufferAttribute(aPos, 3));
  g2.setAttribute('aCorner', new THREE.BufferAttribute(aCorner, 2));
  g2.setAttribute('aData', new THREE.BufferAttribute(aData, 4));
  g2.setIndex(new THREE.BufferAttribute(idx, 1));
  emberMesh.geometry = g2;
  if (oldG.dispose) oldG.dispose();            // 释放旧显存缓冲
  emberCap = newCap;
}
function emberSpot(x, z, radius, hot) {        // 一枚贴地燃烧块(内含 3 枚发光核):4 角逐点 terrainH 取样(+0.06 防 z-fight),此后再不动
  if (typeof getHQZoneDeformFactor === 'function' && getHQZoneDeformFactor(x, z) <= 0.1) return; // 大本营内禁止生成余烬发光点
  var s = emberSlotTake();
  if (s < 0) return;                              // 硬顶(理论不可达):本块不添,旧烬不死
  var L = emberList[s], gy = terrainH(x, z) + 0.06;
  L.on = true; L.x = x; L.y = gy; L.z = z; L.t = gameT; L.kind = hot;
  var bk = _emberBucketKey(x, z), barr = emberBuckets.get(bk);
  if (!barr) { barr = []; emberBuckets.set(bk, barr); }
  barr.push(s);                                    // 槽位登记入桶(弹坑邻桶查询用)
  var seed = Math.random(), v = s * 4;
  var g = emberMesh.geometry.attributes, pA = g.position.array, dA = g.aData.array;
  var cs = [-1, 1, 1, -1], cz = [-1, -1, 1, 1];     // 与静态 aCorner 角序一致
  for (var i = 0; i < 4; i++) {
    var wx = x + cs[i] * radius, wz = z + cz[i] * radius;
    var p3 = (v + i) * 3, d4 = (v + i) * 4;
    pA[p3] = wx; pA[p3 + 1] = terrainH(wx, wz) + 0.06; pA[p3 + 2] = wz;
    dA[d4] = radius; dA[d4 + 1] = seed; dA[d4 + 2] = hot; dA[d4 + 3] = 0;
  }
  _embMark(s);                                    // ★E1-7:新生槽入脏区
}
function emberCrater(cx, cz, R, rInf) {        // 弹坑生效回调(flushCraters 逐坑调用,R=7)
  if (!emberMesh) return;
  // 抹除+重锚固单遍化 + 12m 桶邻域查询(旧=全 16k 槽线性扫;桶域 ±2=24m > rInf 16.8m 全覆盖)
  var cov = R * 0.75 * R * 0.75, r2 = rInf * rInf;   // ①翻土区抹除(cf 口径);②波及区重锚固(cf 防埋/防架空)
  var g0 = emberMesh.geometry.attributes, pA0 = g0.position.array;
  var bx0 = Math.floor((cx - rInf) / 12), bx1 = Math.floor((cx + rInf) / 12);
  var bz0 = Math.floor((cz - rInf) / 12), bz1 = Math.floor((cz + rInf) / 12);
  for (var bz = bz0; bz <= bz1; bz++) for (var bx = bx0; bx <= bx1; bx++) {
    var barr = emberBuckets.get((bx + 96) * 192 + (bz + 96));
    if (!barr) continue;
    for (var bi = barr.length - 1; bi >= 0; bi--) {   // 反向遍历:emberKill 会从桶 splice,安全
      var i = barr[bi];
      var L0 = emberList[i];
      if (!L0.on) continue;
      var dx = L0.x - cx, dz = L0.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < cov) { emberKill(i); continue; }        // 爆心翻土区:抹除(相邻旧坑各自保留余烬,绝不自然熄灭)
      if (d2 < r2) {                                   // 本坑地形改写波及区:4 角重新 terrainH 取样贴合
        var v0 = i * 4;
        for (var c4 = 0; c4 < 4; c4++) {
          var p3 = (v0 + c4) * 3;
          pA0[p3 + 1] = terrainH(pA0[p3], pA0[p3 + 2]) + 0.06;
        }
        L0.y = terrainH(L0.x, L0.z) + 0.06;            // 池灯挂点同步
        _embMark(i);                                   // ★E1-7:重锚槽入脏区
      }
    }
  }
  var nH = 4 + (Math.random() * 3 | 0);        // ③坑内热块 4~6 枚(主发光体:未烧尽的可燃物混在焦土里,布 R*0.12~0.8 坑内)
  for (var k = 0; k < nH; k++) {
    var ang = Math.random() * TAU, rr = R * rand(0.12, 0.8);
    emberSpot(cx + Math.sin(ang) * rr, cz + Math.cos(ang) * rr, rand(0.35, 0.62), rand(0.72, 1.0));
  }
  var nE = 5 + (Math.random() * 5 | 0);        // ④爆点边缘余点 5~9 枚(环带 R*0.7~1.18,更小更凉,hot<0.6 永不点灯)
  for (var m = 0; m < nE; m++) {
    var a2 = Math.random() * TAU, r2e = R * rand(0.7, 1.18);
    emberSpot(cx + Math.sin(a2) * r2e, cz + Math.cos(a2) * r2e, rand(0.2, 0.32), rand(0.28, 0.58));
  }
  var nS = 3 + (Math.random() * 3 | 0);        // ⑤焦土外环凉屑 3~5 枚(环带 R*1.25~2.1——焦土晕到 2.4R,
  for (var q = 0; q < nS; q++) {               //   旧布点只到 1.18R,外圈大片焦土零火星;凉屑 hot≤0.30 永不点灯)
    var a3 = Math.random() * TAU, r3 = R * rand(1.25, 2.1);
    emberSpot(cx + Math.sin(a3) * r3, cz + Math.cos(a3) * r3, rand(0.16, 0.26), rand(0.12, 0.30));
  }
  emberFlush();                                // ★E1-7:仅上传本批脏槽区间(原为整 buffer 重传,见 emberFlush 注)
}

/* ===== 全局闪光与战场环境热源 ===== */
var flash, flashDecay = 8;
function initFlash() { flash = new THREE.PointLight(0xffb060, 0, 40, 2); scene.add(flash); }

/* 战场环境热源动态追踪表 (供光电/红外制导导弹导引头物理仿真使用) */
var _battlefieldHeatSources = [];
function _addBattlefieldHeatSource(x, y, z, heat, life) {
  _battlefieldHeatSources.push({ x: x, y: y, z: z, heat: heat || 1500.0, life: life || 2.0 });
  if (_battlefieldHeatSources.length > 32) _battlefieldHeatSources.shift();
}
function _updateBattlefieldHeatSources(dt) {
  for (var i = _battlefieldHeatSources.length - 1; i >= 0; i--) {
    _battlefieldHeatSources[i].life -= dt;
    if (_battlefieldHeatSources[i].life <= 0) _battlefieldHeatSources.splice(i, 1);
  }
}

function doFlash(p, intensity, colorHex, decay, dist) {
  flash.position.copy(p); flash.intensity = intensity;
  flash.distance = dist || 40;                                // 火箭弹落地爆闪可临时拉大到 80m
  flash.color.setHex(colorHex || 0xffb060); flashDecay = decay || 8;
}

function explosion(p, scale, opts) {
  /* 载具殉爆(2.1)/燃爆(1.5)漫画蘑菇云:宽瓣云冠+窄高爆燃柱+贴地锈红冲击裙+载具碎块,
     由 comic.js 独立程序贴图/共享合并几何/固定池实现(opts 保留签名兼容,漫画爆点不消费)。
     ★E1-4(附录 B §B.1.3)opts.noCard:只要爆炸的"物理表现"(爆闪/震屏/热源/战况雾/音效),
     不要殉爆蘑菇云卡。用于导弹命中地面/障碍的路径 —— 那里已经出了一张爆点卡(comicArtyBurst),
     两套卡在空间上几乎完全重叠 = 单次爆炸 9 层透明,是"导弹爆炸尤其卡"的直接原因。 */
  if (!(opts && opts.noCard) && typeof comicBurstFX === 'function') comicBurstFX(p, scale);
  doFlash(p, 5 * scale, 0xff9a40, 5);
  _addBattlefieldHeatSource(p.x, p.y, p.z, 1800.0 * (scale || 1.0), 2.0);
  var d = player ? p.distanceTo(player.group.position) : 999;
  /* ★平方衰减:≤37m 保留 ~70% 力度,100m→0.068、200m→0.017(远处战场刷屏彻底消除)。 */
  var sv = clamp(26 / Math.max(6, d), 0, 0.7);
  camShake = Math.max(camShake, sv * sv * scale);
  if (!(opts && opts.noSfx)) sfxExplode(p, scale);                         // 烘焙高爆爆炸声,响度随爆炸规模分级(殉爆最响)
  if (typeof fogBattleNote === 'function') fogBattleNote(0.045 * clamp(scale || 1, 0.5, 3));   // A1: 爆炸抬升战况雾(极慢累积)
}
/* ============================================================
   载具变残骸飞溅火星:单张程序贴图 + 固定64槽 InstancedMesh
   击毁事件 O(1) 登记,活跃时才更新固定池;履带损坏摩擦火花共用本池(小尺寸卡)。
   ============================================================ */
var WSP_CAP=64,_wspPool=[],_wspRing=0,_wspLive=0,_wspTex=null,_wspGeo=null,_wspMat=null,_wspMesh=null,_wspA=null;
var _wspM=new THREE.Matrix4(),_wspQ=new THREE.Quaternion(),_wspRoll=new THREE.Quaternion(),_wspP=new THREE.Vector3(),_wspS=new THREE.Vector3(),_wspZ=new THREE.Vector3(0,0,1);
function _wspMakeTex(){var cv=document.createElement('canvas');cv.width=cv.height=512;var g=cv.getContext('2d'),rnd=mulberry32(0x5A9A2026),cx=256,cy=256;g.clearRect(0,0,512,512);g.lineJoin='round';g.lineCap='round';
  /* 中央黄白爆点。 */var star=[];for(var i=0;i<20;i++){var a=i/20*TAU,r=i%2?34:(i%4===0?82:58);star.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r]);}g.beginPath();g.moveTo(star[0][0],star[0][1]);for(i=1;i<star.length;i++)g.lineTo(star[i][0],star[i][1]);g.closePath();g.fillStyle='#ffe12b';g.fill();g.strokeStyle='#e4421d';g.lineWidth=9;g.stroke();g.beginPath();g.arc(cx,cy,25,0,TAU);g.fillStyle='#fff8b8';g.fill();
  /* 红橙飞溅条全部烘焙进贴图,不创建任何粒子。 */for(i=0;i<22;i++){a=i/22*TAU+(rnd()-.5)*.11;var d=90+rnd()*130,L=18+rnd()*62,w=4+rnd()*8,x=cx+Math.cos(a)*d,y=cy+Math.sin(a)*d;g.save();g.translate(x,y);g.rotate(a);g.beginPath();g.moveTo(-L*.55,0);g.lineTo(L*.45,-w);g.lineTo(L*.56,0);g.lineTo(L*.42,w);g.closePath();g.fillStyle=i%4===0?'#ffd21f':'#ef3d22';g.fill();if(i%3===0){g.beginPath();g.moveTo(-L*.38,0);g.lineTo(L*.18,-w*.32);g.lineTo(L*.28,0);g.lineTo(L*.15,w*.32);g.closePath();g.fillStyle='#ff9d17';g.fill();}g.restore();}
  for(i=0;i<7;i++){a=rnd()*TAU;var dd=80+rnd()*160;g.beginPath();g.arc(cx+Math.cos(a)*dd,cy+Math.sin(a)*dd,3+rnd()*5,0,TAU);g.fillStyle='#e93b24';g.fill();}
  var t=new THREE.CanvasTexture(cv);t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;if(THREE.sRGBEncoding)t.encoding=THREE.sRGBEncoding;return t;}
function _wspEnsure(){if(_wspMesh||!scene)return;_wspTex=_wspMakeTex();_wspA=new Float32Array(WSP_CAP);_wspGeo=new THREE.PlaneGeometry(1,1);_wspGeo.setAttribute('iAlpha',new THREE.InstancedBufferAttribute(_wspA,1).setUsage(THREE.DynamicDrawUsage));var vs=['attribute float iAlpha;varying vec2 vUv;varying float vA;','#include <common>','#include <logdepthbuf_pars_vertex>','void main(){vUv=uv;vA=iAlpha;vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;','#include <logdepthbuf_vertex>','}'].join('\n'),fs=['uniform sampler2D map;varying vec2 vUv;varying float vA;','#include <logdepthbuf_pars_fragment>','void main(){','#include <logdepthbuf_fragment>','vec4 t=texture2D(map,vUv);float a=t.a*vA;if(a<.014)discard;gl_FragColor=vec4(t.rgb,a);}'].join('\n');_wspMat=new THREE.ShaderMaterial({uniforms:{map:{value:_wspTex}},vertexShader:vs,fragmentShader:fs,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,blending:THREE.NormalBlending,toneMapped:false,fog:false});_wspMesh=new THREE.InstancedMesh(_wspGeo,_wspMat,WSP_CAP);_wspMesh.count=0;_wspMesh.visible=false;_wspMesh.frustumCulled=false;_wspMesh.renderOrder=19;_wspMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(_wspMesh);for(var i=0;i<WSP_CAP;i++)_wspPool.push({on:false,age:0,life:.72,x:0,y:0,z:0,size:6,rot:0});}
function wreckSparkCard(p,size){if(!p)return;_wspEnsure();if(!_wspMesh)return;var it=_wspPool[_wspRing];_wspRing=(_wspRing+1)%WSP_CAP;if(!it.on)_wspLive++;it.on=true;it.age=0;it.life=size?.5:.68;it.x=p.x;it.y=p.y;it.z=p.z;it.size=size||(5.8+Math.random()*1.2);it.rot=(Math.random()-.5)*.35;}   // size=可选小尺寸(履带摩擦火花),缺省=残骸飞溅大卡
function _wreckSparkUpdate(dt){if(!_wspMesh||!_wspLive)return;var out=0;for(var i=0;i<WSP_CAP;i++){var it=_wspPool[i];if(!it.on)continue;it.age+=dt;if(it.age>=it.life){it.on=false;_wspLive--;continue;}var k=it.age/it.life,pop=.30+.92*(1-Math.pow(1-Math.min(1,k/.28),3)),alpha=k<.48?1:Math.pow((1-k)/.52,.72);if(camera)_wspQ.copy(camera.quaternion);else _wspQ.identity();_wspRoll.setFromAxisAngle(_wspZ,it.rot);_wspQ.multiply(_wspRoll);_wspP.set(it.x,it.y,it.z);_wspS.set(it.size*pop,it.size*pop,1);_wspM.compose(_wspP,_wspQ,_wspS);_wspMesh.setMatrixAt(out,_wspM);_wspA[out]=alpha;out++;}_wspMesh.count=out;_wspMesh.visible=out>0;if(out){var im=_wspMesh.instanceMatrix;im.updateRange.offset=0;im.updateRange.count=out*16;im.needsUpdate=true;var aa=_wspGeo.attributes.iAlpha;aa.updateRange.offset=0;aa.updateRange.count=out;aa.needsUpdate=true;}}

/* 残骸形成火星:killTank对所有死亡类型统一触发一次整张贴图;不再按粒子数量/LOD发射。 */
function wreckSparks(p) {
  wreckSparkCard(p); // 单张飞溅火星贴图卡
}


/* ============================================================
   ★对局拆场清空(flow.js clearBattleEntities 调用):
   余烬(ember)「永不时间熄灭」,只被新弹坑覆盖或在硬顶 FIFO 回收——
   换图后 scorchGrid/dentGrid 已重置,旧余烬会悬在新草地上发光,必须显式抹除;
   残骸火星贴图卡(_wsp)同样随拆场清零。
   ============================================================ */
function fxBattleClear() {
  /* 余烬:先收集全部活槽,再逐个 emberKill(杀槽会回写 GPU 顶点/回栈/清桶) */
  try {
    if (typeof emberList !== 'undefined' && emberList && emberList.length) {
      var act = [];
      for (var i = 0; i < emberList.length; i++) if (emberList[i] && emberList[i].on) act.push(i);
      for (var a = 0; a < act.length; a++) { try { emberKill(act[a]); } catch (ek) {} }
      emberFlush();                              // ★E1-7:拆场抹除也要落盘(否则脏区留到下一局首个弹坑才传)
    }
    if (typeof emberBuckets !== 'undefined' && emberBuckets) emberBuckets.clear();
  } catch (e1) {}
  /* 残骸/履带火星贴图卡 */
  try {
    if (typeof _wspPool !== 'undefined' && _wspPool) for (var w = 0; w < _wspPool.length; w++) _wspPool[w].on = false;
    if (typeof _wspLive !== 'undefined') _wspLive = 0;
    if (_wspMesh) { _wspMesh.count = 0; _wspMesh.visible = false; }
  } catch (e2) {}
  /* ★任务27⑧:战场热源表 + 全局闪光。两者衰减都在 step 门内(_updateBattlefieldHeatSources 随
     stepShells;flash.intensity 随 main.step)——退局即冻结,残值带进新局:红外导引头开局追
     上一局幽灵热源、开局无来源屏幕闪光。拆场清零。 */
  try { _battlefieldHeatSources.length = 0; } catch (e3) {}
  try { if (flash) flash.intensity = 0; } catch (e4) {}
}
/* ★任务27③:启动期预热——残骸飞溅火星卡池(512² 程序贴图+ShaderMaterial+64 槽 InstancedMesh)
   原为首次击毁爆炸才惰性构建(首爆卡顿来源之一),搬到加载期;着色器预编译见 main.js renderer.compile。 */
function fxPrewarm() {
  try { if (typeof _wspEnsure === 'function') _wspEnsure(); } catch (e) { /* 无头环境无 document 跳过 */ }
}
/* ★E1-6(附录 B):fx 侧贴图清单(残骸/履带飞溅火星卡),与 comicFxTextures 一并在加载期上传。 */
function fxTextures() { return [_wspTex]; }
window.fxTextures = fxTextures;
window.fxPrewarm = fxPrewarm;
window.fxBattleClear = fxBattleClear;
