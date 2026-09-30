
/* ===== Module: fx_common.js ===== */
/* ============================================================
   模块: fx_common.js — fx 通用工具(画布纹理构建器)
   (本模块通用部分,须先于 fx.js 加载;加载顺序由 index.html MODULES 表决定)
   ============================================================ */
'use strict';
function makeCanvasTex(size, fn) {
  try {
    var _c = make2DCanvas(size); if (!_c) return null;
    var c = _c.cv, g = _c.g;
    fn(g, size);
    var tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    return tex;
  } catch (e) { return null; }
}

/* 软贴图生成器:径向棉絮团(烟/云共用)+ destination-in 外轮廓收口。
   云=横向压扁+纵向随机漂移的蓬松棉絮瓣。 */
function buildFluffTexture(size, o) {
  return makeCanvasTex(size, function (g, s) {
    g.clearRect(0, 0, s, s);
    var i;
    for (i = 0; i < o.n; i++) {
      var ang = Math.random() * Math.PI * 2, rr = Math.pow(Math.random(), o.rndPow);
      var x = s / 2 + Math.cos(ang) * rr * s * o.spreadX;
      var y = s / 2 + Math.sin(ang) * rr * s * o.spreadY - Math.random() * s * o.driftY;
      var r1 = s * (o.rMin + Math.random() * (o.rMax - o.rMin));
      var grd = g.createRadialGradient(x, y, 0, x, y, r1);
      var al = o.alMin + Math.random() * (o.alMax - o.alMin);
      grd.addColorStop(0, 'rgba(255,255,255,' + al.toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r1, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'destination-in';      // 外轮廓收口
    var m = g.createRadialGradient(s / 2, s / 2, s * o.maskIn, s / 2, s / 2, s * o.maskOut);
    m.addColorStop(0, 'rgba(255,255,255,1)');
    m.addColorStop(0.6, 'rgba(255,255,255,0.85)');
    m.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = m;
    g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
  });
}

var grassTexCache = {};

// 土地/远景共用同一纹理实例(远景贴图=土地贴图,完全一致)
function buildGrassTexture(style) {  // 地面细节贴图(作为 map 与顶点色相乘):草地=草甸笔触 / 沃土=暗棕泥土笔触
  style = style || 'grass';
  if (grassTexCache[style]) return grassTexCache[style];   // 同材质复用同一实例(杜绝多份随机纹理)
  var isSoil = (style === 'soil');
  var tex = makeCanvasTex(256, function (g, s) {
    // Minecraft 风方块地面。两个常量都由漫画后处理倒推,改动前先读:
    //   ① CELL=2(≈5.6cm/纹素):对齐 MC 顶面 16 纹素/方块的原生精度;
    //   ② 相邻格亮度差 ≤±10%:乘地面暗顶点色后屏幕亮度差 <0.11,正好压在
    //      Roberts 亮度边检阈值(_COMIC_FRAG edgeL 0.11)之下 —— 超过就会逐格描墨=满地墨网。
    var rnd = mulberry32(isSoil ? 0x50170a11 : 0x67a5510e);
    var CELL = 2, N = (s / CELL) | 0;                       // 128×128 格,每格 2px ≈ 世界 5.6cm/纹素(≈MC 精度)
    var base = isSoil ? [182, 160, 130] : [233, 237, 223];  // 近中性基底(实际颜色由地面顶点色相乘决定)
    function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
    function put(cx, cy, r, gg, b) { g.fillStyle = 'rgb(' + (r | 0) + ',' + (gg | 0) + ',' + (b | 0) + ')'; g.fillRect(cx * CELL, cy * CELL, CELL, CELL); }
    // 基底平涂(兜底)
    g.fillStyle = 'rgb(' + base[0] + ',' + base[1] + ',' + base[2] + ')';
    g.fillRect(0, 0, s, s);
    // —— 逐格值噪声(Minecraft 草皮/泥土顶面):5 档低对比亮度(相邻差 ≤±10% → 不触发漫画描边)+ 极轻冷暖偏移 ——
    for (var cy = 0; cy < N; cy++) for (var cx = 0; cx < N; cx++) {
      var v = rnd(), m;
      if (v < 0.16) m = 0.90;
      else if (v < 0.42) m = 0.95;
      else if (v < 0.72) m = 1.0;
      else if (v < 0.92) m = 1.05;
      else m = 1.09;
      var rr = base[0] * m, gc = base[1] * m, bb = base[2] * m, hr = rnd();
      if (!isSoil) {                              // 草皮:部分偏绿 / 部分偏干黄(幅度收窄,防高频色噪)
        if (hr < 0.32) { gc += 6; rr -= 4; }
        else if (hr < 0.48) { rr += 5; bb -= 6; }
      } else {                                    // 泥土:部分偏红棕 / 部分深腐殖(幅度收窄)
        if (hr < 0.30) { rr += 6; bb -= 4; }
        else if (hr < 0.46) { rr -= 6; gc -= 6; bb -= 5; }
      }
      put(cx, cy, clamp255(rr), clamp255(gc), clamp255(bb));
    }
    // —— 稀疏 2×2 小结块(泥块/草丛暗根,≈11cm):低对比(略深/略亮),小尺寸少数量 → 近无缝、不描边 ——
    var clumps = isSoil ? 70 : 55;
    for (var i = 0; i < clumps; i++) {
      var bx = (rnd() * (N - 1)) | 0, by = (rnd() * (N - 1)) | 0;
      var dark = rnd() < (isSoil ? 0.6 : 0.5);
      var cm = dark ? (isSoil ? 0.88 : 0.90) : (isSoil ? 1.08 : 1.07);
      var wr = clamp255(base[0] * cm), wg = clamp255(base[1] * cm), wb = clamp255(base[2] * cm);
      if (isSoil && dark && rnd() < 0.5) { wr = clamp255(wr + 6); wb = clamp255(wb - 4); }   // 红棕碎块
      put(bx, by, wr, wg, wb); put(bx + 1, by, wr, wg, wb);
      put(bx, by + 1, wr, wg, wb); put(bx + 1, by + 1, wr, wg, wb);
    }
  });
  if (tex) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;   // Minecraft 硬边像素质感(放大用最近邻);缩小仍走 mipmap 抗锯齿
    // 世界尺度 UV(~7.14m/瓦):地面与远景丘陵 UV 同刻度,repeat=1,跨尺寸/跨区块纹理密度恒定、无缝缝合
    tex.repeat.set(1, 1);
  }
  grassTexCache[style] = tex;        // 缓存共享
  return tex;
}


/* ============================================================
   P1 · 三套真正不同的地面细节贴图(植被/土质/岩质)
   ------------------------------------------------------------
   ★ 为何是"三张独立可平铺纹理"而不是图集:
     P0 实测证实图集必须在片元里 fract()+边缘收敛采样, 于是每个瓦片重复处都留下
     一条钳位缝, 屏幕上呈规则方格摩尔纹。图集无法配合 RepeatWrapping。
     三张独立纹理交给 GPU 原生环绕 → 零缝、mipmap 正常。
★ 硬约束(与原 buildGrassTexture 一致, 改动前先读):
    CELL=2(≈5.6cm/纹素);G2-deflicker 后相邻格亮度差 <= ±5%(原±10%) → 乘暗顶点色后屏幕亮度差 < 0.11,
    压在漫画描边 Roberts 阈值(_COMIC_FRAG edgeL 0.11)之下, 否则满地墨网。
   ============================================================ */
/* 岩质(kind=2) v4: fBm 石质(包裹晶格值噪声,三层频率拉开),替代逐格独立随机。
   无缝机理:每层总周期数取整数(8/16/28/72),晶格取模寻址 → RepeatWrapping 首尾恒等;
   演示 stone_material_demo.html 的 sin-hash 核非周期,此处不用(方案 §6.2-G1)。
   均值重归一到旧基底 [196,194,188](uAvg2 不变,窄带调色板安全,方案 §6.2-G2)。 */
function _stoneLat(P, seed) {
  var L = new Float32Array(P * P), rnd = mulberry32(seed >>> 0);
  for (var i = 0; i < P * P; i++) L[i] = rnd();
  return L;
}
function _stoneAt(L, P, x, y) {
  var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf);
  var x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
  var a = L[y0 * P + x0], b = L[y0 * P + x1], c = L[y1 * P + x0], d = L[y1 * P + x1];
  return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
}
function buildStoneDetail(g, s) {
  var N = 128, CELL = 2;                        // 与旧岩质同格(CELL=2,128² 格)
  var L8 = _stoneLat(8, 0x57a1e042), L28 = _stoneLat(28, 0xc04a11ce), L72 = _stoneLat(72, 0x9e3779b9);
  var cell = new Float32Array(N * N), sum = 0, cx, cy;
  for (cy = 0; cy < N; cy++) for (cx = 0; cx < N; cx++) {
    var u = cx / N, v = cy / N;
    var mid = _stoneAt(L8, 8, u * 8, v * 8) * 0.67 + _stoneAt(L8, 8, u * 16 + 3.3, v * 16 + 7.9) * 0.33;
    var fine = _stoneAt(L28, 28, u * 28, v * 28);
    var grain = _stoneAt(L72, 72, u * 72, v * 72);
    var m = 1 + 0.11 * (mid - 0.5) + 0.06 * (fine - 0.5) + 0.035 * (grain - 0.5);   // 演示 stoneShade 零均值版(幅度逐字)
    cell[cy * N + cx] = m; sum += m;
  }
  var rnd = mulberry32(0x2b91c07f);              // 石片结块(旧岩质质感特征保留:120 个,3×3 偶发,±4%)
  for (var i = 0; i < 120; i++) {
    var bxx = (rnd() * N) | 0, byy = (rnd() * N) | 0;
    var cm = (rnd() < 0.55) ? 0.96 : 1.04;
    var ext = (rnd() < 0.45) ? 2 : 1;
    for (var oy = 0; oy <= ext; oy++) for (var ox = 0; ox <= ext; ox++) {
      var ci = (((byy + oy) % N) * N + ((bxx + ox) % N));
      sum += cell[ci] * (cm - 1); cell[ci] *= cm;
    }
  }
  var mean = sum / (N * N), kR = 196 / mean, kG = 194 / mean, kB = 188 / mean;   // 均值重归一(只动直流,不动对比结构)
  var img = g.createImageData(s, s), px = img.data;
  for (var py = 0; py < s; py++) for (var pxx = 0; pxx < s; pxx++) {
    var cv = cell[(((py / CELL) | 0) * N) + ((pxx / CELL) | 0)], o = (py * s + pxx) * 4;
    px[o] = cv * kR > 255 ? 255 : cv * kR; px[o + 1] = cv * kG > 255 ? 255 : cv * kG;
    px[o + 2] = cv * kB > 255 ? 255 : cv * kB; px[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
var biomeTexCache = {};
function buildBiomeTex(kind) {                 // kind: 0=植被 1=土质 2=岩质(fBm 石质 v4)
  var ck = (kind === 2) ? '2|stone1' : String(kind);   // 岩质生成器已换代,缓存键版本隔离
  if (biomeTexCache[ck]) return biomeTexCache[ck];
  var tex;
  if (kind === 2) {
    tex = makeCanvasTex(256, function (g, s) { buildStoneDetail(g, s); });
  } else {
  tex = makeCanvasTex(256, function (g, s) {
    var rnd = mulberry32([0x67a5510e, 0x50170a11, 0x2b91c07f][kind]);
    var CELL = 2, N = (s / CELL) | 0;
    var base = [[233,237,223],[182,160,130],[196,194,188]][kind];   // 近中性基底(实际色由顶点色相乘)
    function c255(v){ return v<0?0:v>255?255:v; }
    function put(cx,cy,r,gg,b){ g.fillStyle='rgb('+(r|0)+','+(gg|0)+','+(b|0)+')'; g.fillRect(cx*CELL,cy*CELL,CELL,CELL); }
    g.fillStyle='rgb('+base[0]+','+base[1]+','+base[2]+')'; g.fillRect(0,0,s,s);
    for (var cy=0; cy<N; cy++) for (var cx=0; cx<N; cx++) {
      var v=rnd(), m;
      if (v<0.16) m=0.94; else if (v<0.42) m=0.97; else if (v<0.72) m=1.0;
      else if (v<0.92) m=1.03; else m=1.055;                       // +/-5% cap (G2-deflicker: halve HF energy)
      var rr=base[0]*m, gc=base[1]*m, bb=base[2]*m, hr=rnd();
      if (kind===0) {                    // 植被:草叶冷绿 / 干枯暖黄,细碎高频
        if (hr<0.32){ gc+=3; rr-=2; } else if (hr<0.48){ rr+=3; bb-=3; }
      } else if (kind===1) {             // 土质:红棕 / 深腐殖,颗粒略粗
        if (hr<0.30){ rr+=3; bb-=2; } else if (hr<0.46){ rr-=3; gc-=3; bb-=3; }
      } else {                           // 岩质:中性灰,冷暖极轻,靠碎石斑块出质感
        if (hr<0.28){ rr-=2; gc-=1; bb+=2; } else if (hr<0.44){ rr+=2; gc+=1; bb-=1; }
      }
      put(cx,cy,c255(rr),c255(gc),c255(bb));
    }
    /* 结块:植被=小簇暗根;土质=泥块;岩质=较大且更多的碎石片(尺寸/数量拉开质感差异) */
    var clumps = [55,70,120][kind], big = (kind===2);
    for (var i=0;i<clumps;i++){
      var bx=(rnd()*N)|0, by=(rnd()*N)|0;
      var dark = rnd() < [0.50,0.60,0.55][kind];
      var cm = dark ? [0.945,0.94,0.935][kind] : [1.035,1.04,1.05][kind];
      var wr=c255(base[0]*cm), wg=c255(base[1]*cm), wb=c255(base[2]*cm);
      if (kind===1 && dark && rnd()<0.5){ wr=c255(wr+3); wb=c255(wb-2); }
      var ext = (big && rnd()<0.45) ? 2 : 1;                        // 岩质偶发 3x3 石片
      for (var oy=0; oy<=ext; oy++) for (var ox=0; ox<=ext; ox++)
        put((bx+ox)%N, (by+oy)%N, wr, wg, wb);                      // 环绕写入 → 可平铺
    }
  });
  }  /* else: kinds 0/1 旧路径结束;kind=2 走 buildStoneDetail(上),以下纹理设置两路共用 */
  if (tex) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;                   // 原生环绕 = 无缝
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.repeat.set(1, 1);
    if (typeof renderer !== 'undefined' && renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy)
      tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());   /* G2-deflicker: 16x aniso tames grazing-angle mip shimmer */
    else
      tex.anisotropy = 8;
  }
  biomeTexCache[ck] = tex;
  return tex;
}
/* 把三通道质感权重打包成一个 vec3 顶点属性(连续量,可插值)。
   ★决不能传"贴图索引":索引是整数,顶点间无法插值,会让纹理沿三角形边硬切换成锯齿台阶
     (P0 实测现象)。权重可插值,片元里对三张图各采一次加权求和即可平滑过渡。 */
function _packTw(t0, t1, t2, n) {
  var a = new Float32Array(n * 3);
  for (var i = 0; i < n; i++) { a[i*3] = t0[i]; a[i*3+1] = t1[i]; a[i*3+2] = t2[i]; }
  return a;
}
/* 在地面材质上注入三图加权采样。与 scorchPatchMaterial 共存:
   两者都改 <color_fragment>,本函数必须在焦土之后注入(焦土先算基色,再乘细节贴图)。 */
function biomePatchMaterial(mat) {
  if (!mat || mat.__biomePatched) return mat;
  mat.__biomePatched = 1;
  var prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (shader) {
    if (prev) prev.call(this, shader);
    shader.uniforms.uBT0 = { value: buildBiomeTex(0) };
    shader.uniforms.uBT1 = { value: buildBiomeTex(1) };
    shader.uniforms.uBT2 = { value: buildBiomeTex(2) };
    /* G2-detailfade: micro detail fades to the textures' mip-average tint beyond [uDNear,uDFar]
       (exactly what far mips converge to, so the fade is seamless); macro variation stays. */
    shader.uniforms.uDNear = { value: 120.0 };
    shader.uniforms.uDFar = { value: 280.0 };
    shader.uniforms.uAvg0 = { value: new THREE.Vector3(233 / 255, 237 / 255, 223 / 255) };
    shader.uniforms.uAvg1 = { value: new THREE.Vector3(182 / 255, 160 / 255, 130 / 255) };
    shader.uniforms.uAvg2 = { value: new THREE.Vector3(196 / 255, 194 / 255, 188 / 255) };
    shader.vertexShader = 'attribute vec3 aTw;\nattribute vec3 aRock;\nvarying vec3 vTw;\nvarying vec3 vRock;\nvarying vec3 vMacW;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vTw = aTw;\n  vRock = aRock;\n  vMacW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = 'uniform sampler2D uBT0;\nuniform sampler2D uBT1;\nuniform sampler2D uBT2;\nvarying vec3 vTw;\nvarying vec3 vRock;\nvarying vec3 vMacW;\nuniform float uDNear;\nuniform float uDFar;\nuniform vec3 uAvg0;\nuniform vec3 uAvg1;\nuniform vec3 uAvg2;\n' +
      'float _mhash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }\n' +
      'float _mnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(_mhash(i), _mhash(i + vec2(1.0, 0.0)), f.x), mix(_mhash(i + vec2(0.0, 1.0)), _mhash(i + vec2(1.0, 1.0)), f.x), f.y); }\n' +
      shader.fragmentShader.replace('#include <map_fragment>',
        '  {\n' +
        '    float s = vTw.x + vTw.y + vTw.z;\n' +
        '    if (s > 0.0001) {\n' +
        '      vec3 w = vTw / s;\n' +
        '      vec3 t = texture2D(uBT0, vUv).rgb * w.x\n' +
        '             + texture2D(uBT1, vUv).rgb * w.y\n' +
        '             + texture2D(uBT2, vUv).rgb * w.z;\n' +
        '      vec3 avg = uAvg0 * w.x + uAvg1 * w.y + uAvg2 * w.z;\n' +
        '      float dd = length( vViewPosition );\n' +
        '      float df = 1.0 - smoothstep( uDNear, uDFar, dd );\n' +
        '      diffuseColor.rgb *= mix( avg, t, df );\n' +
        '    }\n' +
        '    float m1 = _mnoise( vMacW.xz * 0.02128 );\n' +
        '    float m2 = _mnoise( vMacW.xz * 0.07692 + 7.31 );\n' +
        '    diffuseColor.rgb *= 1.0 + ( m1 - 0.5 ) * 0.09 + ( m2 - 0.5 ) * 0.05;\n' +
        '    diffuseColor.a = 0.0;\n' +
        '  }\n');
    /* G2-slopefix: evaluate steep PER-FRAGMENT from the interpolated normal and blend
       base(vColor) -> rock(vRock). Vertex grids (2.8m..16.7m) cannot resolve the steep
       smoothstep, so baking it per-vertex aliases on every slope and shimmers while the
       camera moves. vColor holds the steep=0 base bake; vRock the steep=1 bake; the detail
       factor t is common to both, hence the ratio form. Runs BEFORE the scorch block
       (scorch was prepended to the same include earlier), so scorch darkens the true mix. */
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\n' +
      '  {\n' +
      '    vec3 _sN = normalize( vNormal );\n' +
      '    float _sU = clamp( ( 1.0 - _sN.y ) / 0.28, 0.0, 1.0 );\n' +
      '    float _sF = _sU * _sU * ( 3.0 - 2.0 * _sU );\n' +
      '    vec3 _sB = max( vColor, vec3( 0.03 ) );\n' +
      '    diffuseColor.rgb *= mix( vec3( 1.0 ), vRock / _sB, _sF );\n' +
      '  }\n');
  };
  var oldKey = mat.customProgramCacheKey;
  mat.customProgramCacheKey = function () { return (oldKey ? oldKey.call(this) : '') + '|biome-v4-stone'; };   // v4:岩质换 fBm 石质,shader 缓存失活
  return mat;
}

function buildCloudTexture() {       // 积云:横向棉絮团 + 外轮廓收口(Sprite 再横向压扁)
  return buildFluffTexture(256, { n: 64, rndPow: 0.55, spreadX: 0.30, spreadY: 0.14, driftY: 0.08, rMin: 0.06, rMax: 0.17, alMin: 0.10, alMax: 0.30, maskIn: 0.05, maskOut: 0.46 });
}