
/* ===== Module: comic.js ===== */
window.__FXTAG='2026-09-10 fx7';   // FX4:版本探针(F12控制台输入__FXTAG验证;与vehicles.BUILD_TAG同源)
/* ============================================================
   模块: comic.js — 漫画渲染(唯一渲染模式:卡通全屏后处理+全套手绘特效)
   (加载顺序由 index.html MODULES 表决定,勿单独调整)
   ============================================================ */
'use strict';
/* ============================================================
   漫画渲染(常开;消费端=main.js 渲染钩子单点接入,加载即初始化)
   风格参考 RX-78 卡通渲染机箱照:粗墨线描边 + 大色块分档 + 纸面笔痕。
   实现=场景渲进离屏 RT,全屏合成 pass 一次完成三件事(不改动任何载具/地面原有着色器,
   实例化流/残骸合批/软粒子/余烬等全部渲染路径零感知):
   ① 描边:色亮度 Sobel + 深度差分(对数深度缓冲下一阶差分天然随距离衰减,远景线细近景线粗);
     亮度差分取样自"描边源"RT(tEdge):主画面每帧先以无贴图材质渲一帧地面——碎花/草茎笔触/砾石点等
     贴图级彩点不进亮度描边(地面成线只来自光照/阴影/顶点色渐变与深度轮廓);预览/战术屏无地面,与主图同源;
   ② 填色:亮度 4 档分档(保留 38% 原渐变防死平)+ 饱和度微增(印刷色感);
   ③ 笔痕/静态绘制阴影:程序生成水平短笔触纹理平铺贴屏(静止不滚),
     中调/暗部最重;最深档叠斜排线(画在阴影里的"手绘排线")。
   性能:1 次离屏渲染 + 1 次全屏 pass。
   降级:无深度纹理支持时自动只用色边(WebGL1 无 WEBGL_depth_texture 的老机)。
   兼容点:开镜 DRS(applyScopePerf 改 pixelRatio/setSize)由逐帧轮询 drawingBufferSize 吸收;
   窗口缩放同路径;RT 按新尺寸重建(只在尺寸变化帧,成本一次 framebuffer 分配)。
   调试:URL ?comic=1 直接开启(无头截图/回归用)。
   ============================================================ */
var _comicRT = null, _comicRTW = 0, _comicRTH = 0;   // 仅一张主 RT(原生分辨率);描边源 = 其自身,无独立描边 RT
/* 合成 RT 降采样系数(B 优化):场景 pass+合成 pass 像素量 ×scale²(0.8→0.64);
   线宽/光晕/笔痕在着色器内按 uScale 补偿,屏幕观感尺寸不变;LinearFilter 上采样的轻微软化=印刷感。
   与 DRS 相乘叠加;调回 1.0 即关闭。 */
/* ★P0-②(移动端适配恢复):桌面恒 1.0 原生分辨率合成(新版口径不变);
   仅触屏设备按画质档驱动——高=1.0 / 中=0.75(像素量 ×0.56,触屏默认档)/ 低=0.66。
   漫画描边/平涂容忍软化,线宽经 uScale 补偿。 */
var COMIC_RT_SCALE = (typeof GFX_TOUCH !== 'undefined' && GFX_TOUCH && typeof GFX_PROFILE !== 'undefined')
  ? (GFX_PROFILE === 'low' ? 0.66 : (GFX_PROFILE === 'mid' ? 0.75 : 1.0))
  : 1.0;
var _comicScene = null, _comicCam = null, _comicMat = null, _comicBrush = null;
var _comicFailed = false;            // 初始化/渲染异常 → 永久回退直渲兜底(渲染层绝不影响游戏本体)
/* Match outline mode: depth silhouette by default; ?ink=0 selects the brightness-depth fallback. */
var VEH_INK_MODE = /[?&]ink=0(?:&|$)/.test(location.search) ? 0 : 1;
var _comicV2 = new THREE.Vector2();

/* ===== 程序生成"水平短笔触"纸面笔痕纹理(256² 灰度,屏幕空间平铺;离线一次) ----
   行带独立相位=设计依据:相位若仅随 y 缓摆,相邻行近同相,33px 周期条纹列向对齐,
   平铺后成全屏连贯的波浪形竖条纹(天空/平坦区最显);故按 4px 行带独立随机相位
   +横向断续包络成短笔触,纵向零连贯;次笔痕斜向项同带断相;纹理仅启动时生成一次,零逐帧成本。 ===== */
function _comicMakeBrush() {
  var cv = document.createElement('canvas'); cv.width = cv.height = 256;
  var g = cv.getContext('2d');
  var img = g.createImageData(256, 256);
  var rnd = mulberry32(0xC0B1C);                       // 独立种子(不占战斗 RNG 流,同 core.js 约定)
  var NB = 64, p1 = [], p2 = [], p3 = [], am = [];     // 64 行带(4px)×独立相位/幅度
  for (var b = 0; b < NB; b++) { p1.push(rnd() * 6.2832); p2.push(rnd() * 6.2832); p3.push(rnd() * 6.2832); am.push(0.75 + 0.5 * rnd()); }
  for (var y = 0; y < 256; y++) for (var x = 0; x < 256; x++) {
    var bi = (y >> 2) & 63, v = 0;
    v += am[bi] * Math.sin(x * 0.19 + p1[bi]) * (0.55 + 0.45 * Math.sin(x * 0.041 + p2[bi]));   // 主笔触:横向短波×断续包络,行带独立相位
    v += 0.35 * Math.sin(x * 0.05 + y * 0.083 + p3[bi]);                                        // 次笔痕:斜向碎段(带内连续/跨带断相)
    v += (rnd() - 0.5) * 0.9;                                  // 纸纹噪
    var s = 128 + v * 34;
    var i = (y * 256 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = s < 0 ? 0 : (s > 255 ? 255 : s);
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  var tx = new THREE.CanvasTexture(cv);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.minFilter = THREE.LinearFilter;                   // 不开 mipmap:平铺缝在强度 ±8% 纹理上不可见,省显存
  tx.magFilter = THREE.LinearFilter;
  return tx;
}

/* ===== 滤镜材质(全屏合成 shader)===== */
var _COMIC_FRAG = [
  /* ============================================================
     漫画滤镜(参考业界成熟卡通后处理:Roberts-Cross 边检 @ 固定 1 纹素核)
     ------------------------------------------------------------
     三条设计约束,改动前先读 —— 每一条都对应一类曾经出现过的画面缺陷:
       ① 原生分辨率合成(COMIC_RT_SCALE=1.0)。降采样再放大会通屏发虚;
          性能由 applyScopePerf 的 DRS 动态降采样兜底,不要靠调低 RT 倍率省性能。
       ② 边检偏移恒为 1 纹素(1.0/uRes),不得乘 uThick/uScale。
          偏移一旦大于 1 纹素,薄物两侧会各描一次 = 平行双线重影,
          且重影宽度随分辨率与炮镜倍率漂移。uThick 只许乘在边检"强度"上。
       ③ 亮度 + 深度双通道,深度走二阶差分(平面不变)+ 集中度闸门,
          否则掠射地面会被整片误描。
     描边源 = 主 RT 自身,不单独渲染一遍无贴图地面 —— 省一遍完整几何 pass。
     ============================================================ */
  'uniform sampler2D tDiffuse;',
  'uniform sampler2D tEdge;',                           // 描边源:主画面/预览/战术屏统一 = tDiffuse 同源
  'uniform sampler2D tDepth;',
  'uniform float uHasDepth;',
  'uniform vec2 uRes;',                                 // 离屏缓冲像素尺寸(原生分辨率)
  'uniform float uThick;',                              // 线强系数:只乘边检强度,不是采样半径(偏移恒 1 纹素)
  'uniform float uVehInkMode;',                         // P0: 0=旧亮度+深度描边 / 1=深度剪影(不描迷彩块); 无深度时自动回退亮度边
  'uniform float uScale;',                              // 恒 1.0;仅笔痕平铺仍引用
  'uniform sampler2D tBrush;',
  'uniform float uGlow;',
  'uniform float uThermal;',                            // 热成像开关量(1/0;灰度化在最终输出前)
  'uniform float uCrt;',                                // CRT 强度 0..1:仅桶形畸变(0=分支跳过);扫描线在 DOM #crtfx
  'uniform float uVehFx;',                              // 载具掩码总开关(0=关闭豁免)
  'uniform float uFxaa;',                               // FXAA 开关(0=直采)
  /* ---- ⑨ 战场调色(R25「明快卡通」→「战场卡通」)---- 全部静态 uniform, 仅初始化/滑块写入, 零逐帧成本 ---- */
  'uniform float uWGrade;',                             // 总强度 0..1。0 = 与现状逐像素等价(唯一回滚开关)
  'uniform vec3 uWLift;',                               // ASC CDL Lift  暗部(中性 0)→ 冷青
  'uniform vec3 uWGamma;',                              // ASC CDL Gamma 中间调(中性 0)
  'uniform vec3 uWGain;',                               // ASC CDL Gain  亮部(中性 1)→ 暖沙
  'uniform vec3 uWNear;',                               // 近景色偏移(暖)
  'uniform vec3 uWFar;',                                // 远景色偏移(冷)
  'uniform vec2 uWDepth;',                              // 远近分色的深度纹理阈值 x=近(0.34) y=远(0.92)
  'varying vec2 vUv;',
  'float lumOf(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }',
  'float dAt(vec2 uv) { return texture2D(tDepth, uv).r; }',
  'vec3 _comicFxaa(sampler2D tex, vec2 uv, vec2 px) {',
  '  vec3 mC = texture2D(tex, uv).rgb;',
  '  float lM = lumOf(mC);',
  '  float lNW = lumOf(texture2D(tex, uv + vec2(-px.x, -px.y)).rgb);',
  '  float lNE = lumOf(texture2D(tex, uv + vec2( px.x, -px.y)).rgb);',
  '  float lSW = lumOf(texture2D(tex, uv + vec2(-px.x,  px.y)).rgb);',
  '  float lSE = lumOf(texture2D(tex, uv + vec2( px.x,  px.y)).rgb);',
  '  float lMn = min(lM, min(min(lNW, lNE), min(lSW, lSE)));',
  '  float lMx = max(lM, max(max(lNW, lNE), max(lSW, lSE)));',
  '  if (lMx - lMn < max(0.0625, lMx * 0.125)) return mC;',
  '  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));',
  '  float dRd = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);',
  '  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + dRd), vec2(-8.0), vec2(8.0)) * px;',
  '  vec3 aA = 0.5 * (texture2D(tex, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tex, uv + dir * (2.0 / 3.0 - 0.5)).rgb);',
  '  vec3 bB = aA * 0.5 + 0.25 * (texture2D(tex, uv - dir * 0.5).rgb + texture2D(tex, uv + dir * 0.5).rgb);',
  '  float lB = lumOf(bB);',
  '  return (lB < lMn || lB > lMx) ? aA : bB;',
  '}',
  'void main() {',
  /* CRT 桶形畸变:采样 UV 的 ALU 变换(所有采样统一用 suv);向内收敛保证 suv∈[0,1],无出界拖影。 */
  '  vec2 suv = vUv;',
  '  if (uCrt > 0.001) { vec2 cc0 = vUv - 0.5; suv = 0.5 + cc0 * (1.0 - 0.10 * uCrt * dot(cc0, cc0)); }',
  '  vec4 raw = texture2D(tDiffuse, suv);',
  '  if (uFxaa > 0.5) raw.rgb = _comicFxaa(tDiffuse, suv, 1.0 / uRes);',
  '  vec3 c = raw.rgb;',
  '  float isGround = step(raw.a, 0.5);',   /* 1.0=地面(alpha=0,不做任何滤镜处理); 0.0=载具/树木/建筑/特效/天空(alpha=1,保留全套原版画风滤镜) */
  '  float isVeh = uVehFx * smoothstep(0.52, 0.60, raw.a) * (1.0 - smoothstep(0.68, 0.80, raw.a));',
  '  float lC = lumOf(c);',
  /* 近景漫画增强系数(对数深度 0.34≈16m 内全强,0.60≈155m 淡出):驱动线强/分档硬度。 */
  '  float dC = (uHasDepth > 0.5) ? dAt(suv) : 1.0;',
  '  float nearK = (uHasDepth > 0.5) ? (1.0 - smoothstep(0.34, 0.60, dC)) : 0.0;',
  /* ★核心:固定 1 纹素偏移(与分辨率/倍率解耦=零重影的根本) */
  '  vec2 o = 1.0 / uRes;',
  /* ① 亮度描边:Roberts cross(2×2 对角差)。四角采样,对角差取模——
        薄物只在真实剪影处出一条线,不再两侧各描一条。 */
  '  float lTL = lumOf(texture2D(tEdge, suv + vec2(-o.x,  o.y)).rgb);',
  '  float lTR = lumOf(texture2D(tEdge, suv + vec2( o.x,  o.y)).rgb);',
  '  float lBL = lumOf(texture2D(tEdge, suv + vec2(-o.x, -o.y)).rgb);',
  '  float lBR = lumOf(texture2D(tEdge, suv + vec2( o.x, -o.y)).rgb);',
  '  float lg1 = lTL - lBR, lg2 = lTR - lBL;',
  '  float lumMag = sqrt(lg1 * lg1 + lg2 * lg2);',
  '  float farFade = (uHasDepth > 0.5) ? (1.0 - smoothstep(0.92, 0.99, dC)) : 1.0;',
  '  float edgeL = smoothstep(0.11, 0.28, lumMag * (1.0 + 0.5 * nearK)) * farFade;',   // 阈值抬高:抑制地面碎花/草点误描(已无专用地面 pass)
  '  float edgeD = 0.0;',
  '  float skyM = 0.0;',
  /* ② 深度描边:Roberts cross @ 1 纹素;二阶差分(平面不变——斜坡/掠射地面恒 0)+ 集中度闸门。 */
  '  if (uHasDepth > 0.5) {',
  '    float dTL = dAt(suv + vec2(-o.x,  o.y)), dBR = dAt(suv + vec2( o.x, -o.y));',
  '    float dTR = dAt(suv + vec2( o.x,  o.y)), dBL = dAt(suv + vec2(-o.x, -o.y));',
  '    float dd = abs(dTL + dBR - 2.0 * dC) + abs(dTR + dBL - 2.0 * dC);',   // 二阶(曲率):真轮廓跳变出线,平滑面 0
  '    float dF = abs(dTL - dBR) + abs(dTR - dBL);',                          // 一阶(梯度)
  /* 集中度闸门 dd/dF:真跳变≈1 保留;掠射地面对数深度曲率摊多像素→dd≪dF→熄灭。远距淡出兜底。 */
  '    edgeD = smoothstep(0.0012, 0.0050, dd) * smoothstep(0.22, 0.50, dd / max(dF, 1e-5)) * (1.0 - smoothstep(0.92, 0.99, dC));',
  '    skyM = step(0.9999, min(min(dTL, dBR), min(dTR, dBL)));',              // 纯天区(发光体不写深度):亮度描边熄灭
  '  }',
  /* P0: uVehInkMode=1 且有深度 → 亮度边权重 0, 只留深度剪影(迷彩/风化台阶不再当墨线);
        无深度(战术屏 PHUD / 老机) → 仍走亮度边, 避免整车没轮廓。 */
  '  float lumaW = (uVehInkMode > 0.5 && uHasDepth > 0.5) ? 0.0 : 1.0;',
  '  float edge = (isGround > 0.5) ? 0.0 : (max(edgeD, edgeL * lumaW * (1.0 - skyM)) * clamp(uThick, 0.5, 2.0));',
  /* ② 填色:亮度 4 档分档(62% 分量,保留 38% 原渐变) + 饱和 1.22 印刷感。
        载具/模型享受原版 4 档分档与印刷感增强;地面完全跳过分档 */
  '  float band = floor(lC * 4.0 + 0.5) / 4.0;',
  '  float isSky = (uHasDepth > 0.5) ? step(0.9999, dC) : 0.0;',   /* R25 天空穹顶不写深度→dC≈远;天区跳过分档/暗部抬升/排线,保真平滑渐变(消除\两色块硬分割\) */
  '  float bMix = (0.62 + 0.24 * nearK) * smoothstep(0.125, 0.18, lC) * (1.0 - isSky) * (1.0 - isGround) * (1.0 - 0.85 * isVeh);',
  '  bMix *= mix(1.0, 0.40, smoothstep(0.50, 1.0, nearK));',   /* P2 近景分档×0.4 仍保留;载具再豁免 85% */
  '  float sc = mix(lC, band, bMix) / max(lC, 0.0001);',
  '  vec3 cb = c * clamp(sc, 0.0, 4.0);',
  '  cb = mix(vec3(lumOf(cb)), cb, mix(mix(1.22, 1.0, isGround), 1.06, isVeh));',
  '  cb += vec3(0.050, 0.046, 0.040) * (1.0 - smoothstep(0.06, 0.18, lC)) * (1.0 - isSky) * (1.0 - isGround) * (1.0 - 0.6 * isVeh);',
  /* ③ 笔痕:平铺静态,暗部略重;最深档再叠 45° 排线(画在暗部里的排线影)
        载具全免笔痕/排线(近车库车面);地面完全不叠 */
  '  float br = texture2D(tBrush, suv * uRes / (340.0 * uScale)).r;',   // ÷uScale:笔痕平铺保持屏幕 340px 周期
  '  cb *= 1.0 + (br - 0.5) * (0.05 + 0.08 * (1.0 - band)) * (1.0 - isSky) * (1.0 - isGround) * (1.0 - isVeh);',
  '  float hatch = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 7.0));',
  '  float hatchW = smoothstep(0.16, 0.02, band) * (0.35 + 0.65 * smoothstep(0.02, 0.07, lC)) * (1.0 - isSky) * (1.0 - isGround) * (1.0 - nearK) * (1.0 - isVeh);',
  '  cb *= mix(1.0, 0.86 + 0.14 * hatch, hatchW);',
  /* ④ 描边合成:88% 深墨(留 12% 底色,墨线不干黢) */
  '  vec3 ink = cb * 0.14;',
  '  vec3 outc = mix(cb, ink, clamp(edge * 0.88, 0.0, 0.88));',
  /* ⑤ 火焰选区发光(uGlow 调试开关;零新增 pass/RT/对象)
     单式掩码 (r−b)·(g−b)×亮度 会在正午高照度下被黄绿色地面穿透
     (暖黄绿 r<b 但 g、b 同低,差积仍为正),整块地面被叠加 9px 位移拷贝=满屏重影;
     早晚/清晨亮度低时不显著。新判据双通道:
       mFire=饱和橙系 (r>g>b 严格递减且差积大) —— 正午地面黄绿 r<g 天然出局;
       mCore=极亮暖白(亮度≥0.82 且 g 明确压 b) —— 只兜爆炸炽核/日盘,云/天够不着;
     半径 9→6px、增益 0.85→0.7:回波贴轮廓外沿,不再做跨画面平移。 */
  /* A 优化:轴向 4 采样均值→对角 2 采样(0.7071 半径补偿,晕圈屏幕半径仍 ≈6px);
     C 优化:uGlow=0 时整块(采样+掩码)由 uniform 分支跳过——uniform 分支全片元同路,近零成本。 */
  /* ⑥ 爆炸贴图本像素高亮掩码 —— 已从 uGlow 块移出:⑨ 战场调色的「强调色保护」需要 selfM。
     它只用已算好的 c / lC(4 条 ALU, 零纹理采样), 无条件计算成本可忽略;
     uGlow=0 时本就只多算这 3 行, 不改变任何输出。 */
  '  float sFire = smoothstep(0.05, 0.18, (c.r - c.g) * (c.g - c.b)) * smoothstep(0.40, 0.78, lC);',
  '  float sCore = smoothstep(0.75, 0.95, lC) * smoothstep(0.04, 0.18, c.g - c.b);',
  '  float selfM = max(sFire, sCore);',
  '  if (uGlow > 0.5) {',
  '    vec2 gOff = (6.0 * 0.7071 * uScale) / uRes;',
  '    vec3 g = (texture2D(tDiffuse, suv + gOff).rgb + texture2D(tDiffuse, suv - gOff).rgb) * 0.5;',
  '    float mFire = smoothstep(0.05, 0.18, (g.r - g.g) * (g.g - g.b)) * smoothstep(0.40, 0.78, lumOf(g));',
  '    float mCore = smoothstep(0.82, 1.0, lumOf(g)) * smoothstep(0.04, 0.18, g.g - g.b);',
  '    float fireM = max(mFire, mCore);',
  '    outc += g * fireM * 0.7;',                       // 邻域弥散晕(包在墨线外=手绘光晕)
  /* ⑥ 爆炸贴图本像素高亮(与⑤同双通道掩码,中心像素口径;分档压平的火焰顶回亮档) */
  '    outc = mix(outc, min(outc * 1.4 + vec3(0.10, 0.05, 0.0), 1.0), selfM * 0.55);',
  '  }',
  /* ⑦ 热成像灰度化:全帧亮度→灰阶(热度排行由场景端 thermalSync 材质族边沿写呈现;
        轻对比拉伸增强热区读感;墨线/笔痕保留=热像轮廓) */
  /* ============================================================
     ⑨ 战场调色 —— 把「明快卡通」拉向「战场卡通」(地面完全豁免,保持原始干净色阶)
     ============================================================ */
  '  if (uWGrade > 0.001 && uThermal < 0.5 && isGround < 0.5) {',
  '    float skyW = (uHasDepth > 0.5) ? smoothstep(0.985, 0.9999, dC) : 0.0;',
  '    float sG = uWGrade * (1.0 - skyW) * (1.0 - 0.85 * isVeh);',
  '    vec3 c1 = outc * (uWGain - uWLift) + uWLift;',
  '    c1 = pow(max(c1, vec3(0.0)), vec3(1.0) + uWGamma * sG);',
  '    outc = mix(outc, c1, sG);',
  '    float mx = max(outc.r, max(outc.g, outc.b));',
  '    float mn = min(outc.r, min(outc.g, outc.b));',
  '    float df = mx - mn, vv = mx;',
  '    float sat = mx > 1e-4 ? df / mx : 0.0;',
  '    float hue = 0.0;',
  '    if (df > 1e-4) {',
  '      if (mx == outc.r)      hue = mod((outc.g - outc.b) / df, 6.0);',
  '      else if (mx == outc.g) hue = (outc.b - outc.r) / df + 2.0;',
  '      else                   hue = (outc.r - outc.g) / df + 4.0;',
  '      hue *= 60.0; if (hue < 0.0) hue += 360.0;',
  '    }',
  /* 强调色保护窗 —— 边缘羽化, 不再是硬三元开关。
     原写法 (hue>8 && hue<52 && sat>0.30)?1:0 会在 hue=8°/52°、sat=0.30 处让
     降饱和系数瞬间 0↔1, 天色连续扫过边界时出现硬色带(清晨 6:00 实测 ΔLuma=0.0948)。
     羽化后窗内(8~52°、sat>0.36)仍是全保护 —— 这是「去硬边」, 不是「收紧窗」。 */
  '    float hLo = smoothstep(2.0, 8.0, hue);',
  '    float hHi = 1.0 - smoothstep(52.0, 58.0, hue);',
  '    float accentH = hLo * hHi * smoothstep(0.20, 0.36, sat);',
  '    float wG = sG * (1.0 - max(accentH, selfM)) * (1.0 - selfM * 0.85);',
  '    float sat2 = sat * (1.0 - 0.34 * wG) * (1.0 - 0.22 * wG * (1.0 - smoothstep(0.10, 0.55, vv)));',
  /* 色相锚点吸引 —— 三锚点最短弧位移的距离加权平均, 取代硬「最近邻」。
     原写法在锚点中点(26/88→57°、88/205→146.5°、205/26 跨 0→295.5°)瞬间切换目标锚点,
     色相跳变 18~62°。清晨天色连续扫过 57° 与 146.5° → 天空被切成数段硬色块。
     权重 = smoothstep(1 - |dh|/181): 连续、周期、天然处理 0/360 环绕;
     分母恒 > 0(最近锚点距离 ≤ 90.5° < 181°), 且 ±180° 处的残跳变被近零权重抑制到 < 0.6°。
     代价约 25 ALU, 无 atan/exp/pow。 */
  '    float dh0 = 26.0 - hue;   dh0 -= 360.0 * step(180.0, dh0);  dh0 += 360.0 * step(dh0, -180.0);',
  '    float dh1 = 88.0 - hue;   dh1 -= 360.0 * step(180.0, dh1);  dh1 += 360.0 * step(dh1, -180.0);',
  '    float dh2 = 205.0 - hue;  dh2 -= 360.0 * step(180.0, dh2);  dh2 += 360.0 * step(dh2, -180.0);',
  '    float a0 = 1.0 - clamp(abs(dh0) / 181.0, 0.0, 1.0); a0 = a0 * a0 * (3.0 - 2.0 * a0);',
  '    float a1 = 1.0 - clamp(abs(dh1) / 181.0, 0.0, 1.0); a1 = a1 * a1 * (3.0 - 2.0 * a1);',
  '    float a2 = 1.0 - clamp(abs(dh2) / 181.0, 0.0, 1.0); a2 = a2 * a2 * (3.0 - 2.0 * a2);',
  '    float dh = (dh0 * a0 + dh1 * a1 + dh2 * a2) / max(a0 + a1 + a2, 1e-4);',
  '    hue += dh * 0.30 * wG;',
  '    vec3 kk = mod(vec3(5.0, 3.0, 1.0) + hue / 60.0, 6.0);',
  '    vec3 rgbK = clamp(min(kk, 4.0 - kk), 0.0, 1.0);',
  '    outc = vv - sat2 * vv * rgbK;',
  '    float l3 = lumOf(outc);',
  '    float lo = clamp((l3 - 0.018) / 0.982, 0.0, 1.0);',
  '    float sc3 = lo + 0.26 * sG * (lo - 0.5) * (1.0 - abs(lo - 0.5) * 2.0) * 2.0;',
  '    outc *= clamp(sc3, 0.0, 1.6) / max(l3, 1e-4);',
  '    vec3 kn3 = vec3(0.72);',
  '    outc = min(outc, kn3) + (vec3(1.0) - kn3) * (vec3(1.0) - exp(-max(outc - kn3, vec3(0.0)) / 0.28));',
  '    float F4 = smoothstep(uWDepth.x, uWDepth.y, dC) * uHasDepth;',
  '    outc += mix(uWNear, uWFar, F4) * sG;',
  '    vec2 q5 = (suv - 0.5) * vec2(uRes.x / uRes.y, 1.0);',
  '    float vg5 = 1.0 - 0.34 * sG * pow(clamp(length(q5) * 1.05, 0.0, 1.0), 1.7);',
  '    outc *= vg5;',
  '    float bs = 1.0 + 0.42 * sG * selfM;',
  '    outc.r *= bs; outc.g *= bs * (1.0 - 0.10 * sG * selfM); outc.b *= bs * (1.0 - 0.32 * sG * selfM);',
  '    float g9 = fract(52.9829189 * fract(dot(gl_FragCoord.yx + vec2(17.0, 5.0), vec2(0.06711056, 0.00583715))));',
  '    outc += (g9 - 0.5) * 0.060 * sG * (1.0 - 0.55 * clamp(lumOf(outc), 0.0, 1.0));',
  '  }',
  '  if (uThermal > 0.5) { float tg = dot(outc, vec3(0.299, 0.587, 0.114)); outc = vec3(clamp((tg - 0.03) * 1.22, 0.0, 1.0)); }',
  /* ⑧ 8-bit 去带纹(debanding):非地面区域应用 */
  '  if (isGround < 0.5) {',
  '    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));',
  '    outc += (ign - 0.5) / 255.0;',
  '  }',
  '  gl_FragColor = vec4(outc, 1.0);' ,
  '}'
].join('\n');
var _COMIC_VERT = [
  'varying vec2 vUv;',
  'void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'   // 平面几何 2×2 直接当全屏三角板
].join('\n');

/* 懒初始化(首次开启时建;失败置 _comicFailed 永久回退) */
function _comicInit() {
  if (_comicScene || _comicFailed) return;
  try {
    _comicBrush = _comicMakeBrush();
    _comicMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tEdge: { value: null },                         // 描边源 RT(无贴图地面版场景;_comicEnsureRT/地面 pass 绑定)
        tDepth: { value: null },
        uHasDepth: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uThick: { value: 1.35 },                        // 描边厚度(px;风格锚点,调此改粗细)
        uVehInkMode: { value: VEH_INK_MODE },            // P0 默认 1=深度剪影(烟雾下也不走亮度边,迷彩不出线)
        tBrush: { value: _comicBrush },
        uGlow: { value: 1 },                            // 火焰发光开关量(1/0;0 时着色器整块跳过采样)
        uThermal: { value: 0 },                         // 热成像开关量(thermalSync 边沿写)
        uScale: { value: 1 },                           // RT 降采样系数(=COMIC_RT_SCALE,_comicEnsureRT 同步)
        uCrt: { value: 0 },                             // CRT 滤镜强度(设置滑块 0~100 → 0~1;默认 0=零成本)
        uVehFx: { value: 1 },                            // 载具滤镜豁免(写入端=vehMaskPatchMaterial)
        uFxaa: { value: 1 },                             // FXAA;0=直采回滚
        /* ---- ⑨ 战场调色:静态 uniform, 仅初始化/滑块写入, 零逐帧成本 ----
           uWGrade=0 → ⑨ 整块跳过 → 与补丁前逐像素等价(唯一回滚开关) */
        uWGrade: { value: 1 },                          // 总强度 0..1(设置滑块 0~100 → 0~1)
        uWLift:  { value: new THREE.Vector3(-0.030, -0.008,  0.061) },   // 暗部 → 冷青(A2 重标定)
        uWGamma: { value: new THREE.Vector3( 0.010,  0.004, -0.014) },   // 中间调
        uWGain:  { value: new THREE.Vector3( 1.080,  1.031,  0.932) },   // 亮部 → 暖沙/褐(A2 重标定)
        uWNear:  { value: new THREE.Vector3( 0.029,  0.011, -0.012) },   // 近景暖偏移(A2 重标定)
        uWFar:   { value: new THREE.Vector3( 0.000,  0.014,  0.072) },   // 远景冷偏移(A2 重标定: 只推冷, 不提亮)
        uWDepth: { value: new THREE.Vector2( 0.34,   0.92) }             // 远近分色深度阈值(非线性深度纹理口径)
      },
      vertexShader: _COMIC_VERT,
      fragmentShader: _COMIC_FRAG,
      depthTest: false, depthWrite: false
    });
    var quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), _comicMat);
    quad.frustumCulled = false;
    _comicScene = new THREE.Scene();
    _comicScene.add(quad);
    _comicCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  } catch (e) { _comicFailed = true; }
}

/* RT 尺寸跟随(DRS/窗口缩放);尺寸变化才重建 */
function _comicEnsureRT() {
  renderer.getDrawingBufferSize(_comicV2);
  var w = Math.max(2, (_comicV2.x * COMIC_RT_SCALE) | 0), h = Math.max(2, (_comicV2.y * COMIC_RT_SCALE) | 0);
  if (_comicRT && w === _comicRTW && h === _comicRTH) return;
  if (_comicRT) _comicRT.dispose();
  _comicRT = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  if (renderer.capabilities.isWebGL2 || renderer.extensions.get('WEBGL_depth_texture')) {
    _comicRT.depthTexture = new THREE.DepthTexture(w, h);
  }
  _comicRTW = w; _comicRTH = h;
  _comicMat.uniforms.tDiffuse.value = _comicRT.texture;
  _comicMat.uniforms.tEdge.value = _comicRT.texture;    // v2:描边源=主 RT(不再单独渲无贴图地面)
  _comicMat.uniforms.tDepth.value = _comicRT.depthTexture || null;
  _comicMat.uniforms.uHasDepth.value = _comicRT.depthTexture ? 1 : 0;
  _comicMat.uniforms.uRes.value.set(w, h);
  _comicMat.uniforms.uScale.value = COMIC_RT_SCALE;
  _rklDepthSync();                                       // 弹道线软深度测试引用/视口随 RT 重建同步(事件级)
}

function comicSetThermal(v) {                            // 热成像开关(combat.js thermalSync 边沿调;材质未建=空操作)
  if (_comicMat) _comicMat.uniforms.uThermal.value = v;
  if (_rklMat) _rklMat.uniforms.uThermal.value = v;      // 弹道线 overlay 同步(绕过主合成,需自带灰度=弹体尾焰档亮灰)
  _csmSetThermal(v);                                     // 行进烟族:地面档灰+MAX 混合(热者透出)
}
/* 主渲染入口(main.js 每帧调用):场景→RT→卡通合成;任何异常回退直渲兜底且不挡游戏 */
/* ============================================================
   漫画天线稳定线(远距细杆抗闪烁)
   机理:软鞭天线半径 6~12mm,几十米外宽度即远小于 1 纹素,光栅化覆盖逐帧跳变,
   描边加粗把"忽有忽无"放大成黑线闪烁(RT 降采样进一步提前阈值)。
   方案:全部活车天线并入 ONE LineSegments(GL 线恒定 1px 光栅化,任何距离不消失),
   随场景渲进 RT(深度测试正确遮挡,受雾,自然进入合成管线);原几何天线仍在,
   近距被自身像素覆盖,远距由本线稳定接管。仅漫画模式更新与显示:
   每帧 ≤176 车 × 2 点矩阵变换 + 1 draw call。
   ============================================================ */
var ANT_MAX = 400;                                      // 88×2 车 × 最多 2 根,双倍余量
var _antLine = null, _antPosA = null, _antV = null;
var _antSpecs = null;                                   // 型号 → [[x, yBottom, yTop, z], ...](炮塔局部系,竖直鞭)
function _antBuildSpecs() {                             // 懒建:与 createTank 内 vCyl 天线参数同源(改建模需同步此表)
  var m60Top = m60TurretTopY(0.52, -0.92), r89 = td89RoofY(-0.56, -1.00);
  _antSpecs = {
    t59:  [[-0.10, 0.4952, 1.4452, -0.62]],
    t99:  [[0.66, 0.604, 1.554, -1.59]],                  // 红方重型坦克:塔顶右尾竖鞭(与 turretParts99 天线 vCyl 同源,随杆下移-0.056同步)
    m60:  [[-0.52, m60Top + 0.05, m60Top + 1.20, -0.92], [0.52, m60Top + 0.05, m60Top + 1.20, -0.92]],
    m1a1: [[-0.82, 0.71, 1.81, -1.94], [0.82, 0.71, 1.81, -1.94]],
    td89: [[-0.56, r89 + 0.03, r89 + 1.03, -1.00]]      // arty 无天线
  };
}
var ANTW_MAX = 1024;                                    // 残骸天线段上限(双方兵力耗尽极限 ~400 残骸 × 均值 1.5 根)
var _antWLine = null, _antWPosA = null, _antWDirty = false;
function _antMakeLine(cap) {                            // 活车/残骸两条线共用的构造器
  var g = new THREE.BufferGeometry();
  var attr = new THREE.BufferAttribute(new Float32Array(cap * 6), 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', attr);
  var line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x24262a }));   // 同 cDARK 深灰
  line.frustumCulled = false;                           // 端点已是世界坐标,整体不参与视锥剔除
  line.matrixAutoUpdate = false;
  scene.add(line);
  return { line: line, attr: attr };
}
function _antWriteVehicle(t, a, n, cap) {               // 写入一辆车的天线端点,返回新的段计数
  var sp = t._antSpec || (t._antSpec = _antSpecs[dynModelKey(t)]);   // ★审查A7: 型号键终身缓存(原版每车每帧字符串拼接+6元素线性查表)
  if (!sp || !t.turret) return n;
  var mw = t.turret.matrixWorld;                        // 上一渲染帧矩阵(1 帧滞后,不可感;残骸=死亡姿态冻结/被推后随组刷新)
  for (var k = 0; k < sp.length && n < cap; k++) {
    var s2 = sp[k];
    _antV.set(s2[0], s2[1], s2[3]).applyMatrix4(mw);
    a[n * 6] = _antV.x; a[n * 6 + 1] = _antV.y; a[n * 6 + 2] = _antV.z;
    _antV.set(s2[0], s2[2], s2[3]).applyMatrix4(mw);
    a[n * 6 + 3] = _antV.x; a[n * 6 + 4] = _antV.y; a[n * 6 + 5] = _antV.z;
    n++;
  }
  return n;
}
function comicAntennaWreckDirty() { _antWDirty = true; }   // 事件钩子:新残骸(killTank)/残骸被推动(wckNoteMoved)
function _antWreckRebuild() {                           // 残骸静态线:仅事件后重建一次,平时零遍历零上传
  _antWDirty = false;
  if (!_antWLine) { var mkw = _antMakeLine(ANTW_MAX); _antWLine = mkw.line; _antWPosA = mkw.attr; }
  var a = _antWPosA.array, n = 0;
  for (var i = 0; i < wreckList.length && n < ANTW_MAX; i++) n = _antWriteVehicle(wreckList[i], a, n, ANTW_MAX);
  _antWLine.geometry.setDrawRange(0, n * 2);
  _antWPosA.updateRange.offset = 0; _antWPosA.updateRange.count = n * 6;
  _antWPosA.needsUpdate = n > 0;
  _antWLine.visible = n > 0;
}
function _comicAntennaSync() {
  if (!_antLine) {
    _antBuildSpecs();
    _antV = new THREE.Vector3();
    var mk = _antMakeLine(ANT_MAX);
    _antLine = mk.line; _antPosA = mk.attr;
  }
  _antLine.visible = true;
  var a = _antPosA.array, n = 0;
  for (var i = 0; i < tanks.length; i++) {
    var t = tanks[i];
    if (!t.alive) continue;                             // 残骸走 _antWreckRebuild 静态线(事件驱动)
    n = _antWriteVehicle(t, a, n, ANT_MAX);
  }
  _antLine.geometry.setDrawRange(0, n * 2);
  _antPosA.updateRange.offset = 0; _antPosA.updateRange.count = n * 6;   // 只上传实际段数字节
  _antPosA.needsUpdate = true;
  if (_antWDirty) _antWreckRebuild();
}

/* 每帧特效推进链(正常/降级两条渲染路径共用单源;新增特效系统只在此登记一次)——
   动画推进全部在场景渲染前完成,本帧即见新态;墙钟 dt 上限 0.08s 防后台切回大步跳变。 */
function _comicFxTick() {
  var nw = performance.now(), dt = _cbLastT ? Math.min(0.08, (nw - _cbLastT) / 1000) : 0.016;
  _cbLastT = nw;
  _comicFrameId++;                                     // ★E2-4:帧序号(链式殉爆同帧闸的唯一推进点)
  _cbTick(dt, nw / 1000);                              // 爆点动画+载具殉爆卡
  _comicMuzzleUpdate(dt);                              // 主炮漫画火光/炮口烟/高亮 halo
  _comicHitUpdate(dt);                                 // 炮弹命中三类型贴图
  _comicRocketLaunchUpdate(dt);                        // 发射架中央单团烟:扩散+反向漂移/ONE InstancedMesh
  _comicRocketTrailUpdate(dt);                         // 全航程火箭尾迹烟:ONE InstancedMesh
  _comicGroundDustUpdate(dt);                          // 地面扬尘卡(啃地/部署):ONE InstancedMesh
  _comicTrackDigUpdate(dt);                            // P3 履带刨土:ONE InstancedMesh
  _comicRocketLineTailUpdate(dt);                      // 尾端按对应弹体飞行速度向固定终点收缩
  _comicRocketLineFlush();                             // 合并上传0.09s解析更新及收尾脏区
  _comicMotionSmokeUpdate(dt);                         // 发动机烟/双履带尘/飘散片:固定世界尺寸 atlas
  if(typeof _hzSmokeUpdate==='function')_hzSmokeUpdate(dt);   // B1:地平线远景硝烟带(10实例·+1 draw call)
    _comicBurnSync(nw / 1000);                           // 持续燃烧实例
  _comicAntennaSync();                                 // 天线稳定线(降级直渲路径同样受益:深度/雾正确)
  _tacTick();                                          // 战术标识:门=_tacOn||指挥模式
  _iffArrowTick();                                     // 敌我箭头:屏内且无遮挡载具
  _cmdStarTick();                                      // 指挥星:被指挥/被借用者头顶星
}
function comicRender(sc, cam) {
  if (_comicFailed) {
    _comicFxTick();
    renderer.render(sc, cam); _comicRocketLineOverlay(cam); return;
  }
  try {
    _comicEnsureRT();
    _comicFxTick();
    /* The outline source is the main render target; Roberts thresholds suppress ground texture noise. */
    renderer.setRenderTarget(_comicRT);
    renderer.render(sc, cam);
    _comicMat.uniforms.tEdge.value = _comicRT.texture;   // 描边源=主画面本身(不再单独渲地面)
    /* renderer.info 每次 render 自动清零,合成 pass 会把主场景的 dc/tri 读数冲掉(fps 行变 "1 dc · 0k tri")——
       合成后把主场景账本写回(+1合成dc;有弹道线时再+1覆盖dc) */
    var ri = renderer.info.render, rc = ri.calls, rt2 = ri.triangles;
    renderer.setRenderTarget(null);
    renderer.render(_comicScene, _comicCam);
    var rklDraw = _comicRocketLineOverlay(cam) ? 1 : 0; // 后合成覆盖层:不进入Sobel漫画描边
    ri.calls = rc + 1 + rklDraw; ri.triangles = rt2 + 2;
  } catch (e) {
    _comicFailed = true;
    try { renderer.setRenderTarget(null); renderer.render(sc, cam); _comicRocketLineOverlay(cam); } catch (e2) { /* 放弃本帧 */ }
  }
}

/* ============================================================
   漫画特效:载具持续燃烧贴图(参考红/黄平面火焰图)
   ----------------------------------------------------------------
   持续火灾可能同时存在于大量载具上,因此火焰与黑烟各使用一只全局 InstancedMesh:
   · 火焰贴图烘焙红色外焰、黄色热芯;黑烟贴图烘焙连续S形炭烟和灰紫卷边;
   · 每车火焰1实例、黑烟最多2实例,全场固定2个draw call,不随车辆数增加;
   · CPU只遍历事件登记的燃烧表;灭火后保留1.55s烟尾,不创建粒子或灯光;
   · 每片绕世界 Y 轴面向相机,远距有限放大,保持多方位和战场远景可读;
   · world.js 燃烧路径只登记 comicBurnVehicle,不产生任何点粒子。
   ============================================================ */
var COMIC_BURN_MAX = 192, COMIC_BURN_SMOKE_MAX = COMIC_BURN_MAX * 2;
var _comicBurnTex = null, _comicBurnGeo = null, _comicBurnMat = null, _comicBurnMesh = null;
var _comicBurnSmokeTex=null,_comicBurnSmokeGeo=null,_comicBurnSmokeMat=null,_comicBurnSmokeMesh=null,_comicBurnSmokeA=null,_comicBurnSmokeUvA=null;
var _burnSmokeFrames=[[.02,.51,.46,.47],[.52,.51,.46,.47],[.02,.01,.46,.47],[.52,.01,.46,.47]];
var _comicBurnList = [];                             // 事件登记的燃烧车;灭火后保留到黑烟尾段结束
var _comicBurnM4 = new THREE.Matrix4(), _comicBurnQ = new THREE.Quaternion();
var _comicBurnPos = new THREE.Vector3();
var _comicBurnScale = new THREE.Vector3();

/* 漫画层画布贴图统一出口(燃烧/爆燃/云冠/飞屑共用)。
   入参 cv 须为 POT 画布:保留 mipmap,远距离缩小时黑轮廓不闪;
   各向异性上限 4,避免无意义采样成本。 */
function _comicCanvasTex(cv) {
  var tx = new THREE.CanvasTexture(cv);
  tx.minFilter = THREE.LinearMipmapLinearFilter;
  tx.magFilter = THREE.LinearFilter;
  tx.generateMipmaps = true;
  if (typeof renderer !== 'undefined' && renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy)
    tx.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return tx;
}

/* 独立绘制透明火焰,不读取参考图棋盘背景,也不复用爆炸/火箭贴图。 */
/* FX1 A2柔体烟共用画笔(shape 0圆/1柱/2展/3碎;r/g/b=烘焙基色,有tint系统烘浅灰由tint着色)。
   噪点擦除+顶光罩=柔边体积感;种子固定保证烘焙可复现。 */
function _fxA2(g,cx,cy,R,seed,r,gg,b,shape,soft){
  var rnd=mulberry32(seed),i,T=r+','+gg+','+b;
  var sx=shape===2?1.32:(shape===1?.74:1),sy=shape===1?1.32:(shape===2?.74:1);
  var BN=soft?21:15,SN=soft?9:(shape===0?0:6),BA=soft?.34:.52,BM=soft?.17:.26,SA=soft?.26:.40;   // FX3-FLAT:尘土展平(多珠低alpha)
  for(i=0;i<BN;i++){var px=cx+(rnd()-.5)*R*1.15*sx,py=cy+(rnd()-.5)*R*sy,rr=R*(.30+rnd()*.40);
    var gr=g.createRadialGradient(px,py,0,px,py,rr);
    gr.addColorStop(0,'rgba('+T+','+BA+')');gr.addColorStop(.65,'rgba('+T+','+BM+')');gr.addColorStop(1,'rgba('+T+',0)');
    g.fillStyle=gr;g.beginPath();g.arc(px,py,rr,0,TAU);g.fill();}
  for(i=0;i<SN;i++){var qx,qy;
    if(shape===1){qx=cx+(rnd()-.5)*R*.45;qy=cy+(rnd()-.5)*R*1.5;}else{qx=cx+(rnd()-.5)*R*1.9;qy=cy+(rnd()-.5)*R*.45;}
    if(shape===3){qx=cx+(rnd()-.5)*R*1.6;qy=cy+(rnd()-.5)*R*1.2;}
    var rr2=R*(.22+rnd()*.30),g2=g.createRadialGradient(qx,qy,0,qx,qy,rr2);
    g2.addColorStop(0,'rgba('+T+','+SA+')');g2.addColorStop(1,'rgba('+T+',0)');
    g.fillStyle=g2;g.beginPath();g.arc(qx,qy,rr2,0,TAU);g.fill();}
  g.save();g.globalCompositeOperation='destination-out';
  var ne=soft?8:(shape===3?16:11),er=soft?.05:.06,ex=soft?.08:.12;
  for(i=0;i<ne;i++){g.globalAlpha=soft?.16:.30;g.beginPath();g.arc(cx+(rnd()-.5)*R*1.5*sx,cy+(rnd()-.5)*R*1.3*sy,R*(er+rnd()*ex),0,TAU);g.fill();}
  g.save();g.translate(cx,cy);g.scale(sx,sy);g.translate(-cx,-cy);
  var em=g.createRadialGradient(cx,cy,R*.70,cx,cy,R*1.10);
  em.addColorStop(0,'rgba(0,0,0,0)');em.addColorStop(1,'rgba(0,0,0,'+(soft?0.92:0.55)+')');
  g.fillStyle=em;g.beginPath();g.arc(cx,cy,R*1.10,0,TAU);g.fill();g.restore();
  g.restore();g.globalAlpha=1;
  if(soft){var hw=g.createRadialGradient(cx,cy,0,cx,cy,R*.95);
  hw.addColorStop(0,'rgba('+T+',.20)');hw.addColorStop(1,'rgba('+T+',0)');
  g.fillStyle=hw;g.beginPath();g.arc(cx,cy,R*.95,0,TAU);g.fill();}
  if(!soft){var hl=g.createRadialGradient(cx-R*.3,cy-R*.35,0,cx-R*.3,cy-R*.35,R*.9);
  hl.addColorStop(0,'rgba(255,252,240,.14)');hl.addColorStop(1,'rgba(255,252,240,0)');
  g.fillStyle=hl;g.beginPath();g.arc(cx-R*.3,cy-R*.35,R*.9,0,TAU);g.fill();}
}

function _fxUvW(arr,count,frames,v){var f=frames[v|0]||frames[0],o=count*4;arr[o]=f[0];arr[o+1]=f[1];arr[o+2]=f[2];arr[o+3]=f[3];}
function _comicBurnMakeTex() {
  var cv = document.createElement('canvas'); cv.width = cv.height = 512;
  var g = cv.getContext('2d');
  g.clearRect(0, 0, 512, 512);
  g.lineJoin = 'round'; g.lineCap = 'round';

  /* 红色外焰:宽底、多处向内卷曲,中央主舌最高。 */
  g.beginPath();
  g.moveTo(35, 478);
  g.bezierCurveTo(18, 441, 35, 404, 65, 392);
  g.bezierCurveTo(34, 357, 43, 311, 82, 300);
  g.bezierCurveTo(65, 266, 82, 230, 116, 236);
  g.bezierCurveTo(105, 193, 134, 158, 166, 180);
  g.bezierCurveTo(151, 124, 190, 87, 223, 124);
  g.bezierCurveTo(207, 194, 246, 207, 259, 161);
  g.bezierCurveTo(271, 118, 250, 85, 283, 42);
  g.bezierCurveTo(286, 106, 337, 100, 335, 167);
  g.bezierCurveTo(366, 119, 408, 136, 396, 198);
  g.bezierCurveTo(435, 166, 470, 203, 447, 249);
  g.bezierCurveTo(493, 250, 504, 309, 465, 337);
  g.bezierCurveTo(493, 379, 466, 424, 432, 426);
  g.bezierCurveTo(450, 460, 417, 486, 382, 472);
  g.bezierCurveTo(346, 494, 305, 477, 279, 466);
  g.bezierCurveTo(243, 496, 197, 478, 172, 464);
  g.bezierCurveTo(130, 495, 89, 473, 73, 451);
  g.bezierCurveTo(63, 481, 47, 490, 35, 478);
  g.closePath();
  g.fillStyle = '#ef3e32'; g.fill();
  g.lineWidth = 11; g.strokeStyle = '#541910'; g.stroke();

  /* 黄色热芯:从车体表面铺开,形成三股向上的内焰。 */
  g.beginPath();
  g.moveTo(83, 465);
  g.bezierCurveTo(71, 429, 97, 408, 123, 417);
  g.bezierCurveTo(97, 371, 126, 337, 157, 357);
  g.bezierCurveTo(137, 299, 174, 270, 202, 311);
  g.bezierCurveTo(190, 239, 225, 208, 252, 259);
  g.bezierCurveTo(269, 224, 296, 236, 293, 288);
  g.bezierCurveTo(326, 245, 367, 267, 354, 326);
  g.bezierCurveTo(389, 301, 426, 331, 402, 376);
  g.bezierCurveTo(436, 397, 413, 451, 373, 447);
  g.bezierCurveTo(333, 479, 277, 459, 251, 447);
  g.bezierCurveTo(205, 485, 145, 457, 119, 449);
  g.bezierCurveTo(105, 470, 94, 477, 83, 465);
  g.closePath();
  g.fillStyle = '#ffe22b'; g.fill();
  g.lineWidth = 6; g.strokeStyle = '#f39a18'; g.stroke();

  /* 前景红色卷舌,把黄芯切成漫画参考中的交错负形。 */
  g.beginPath();
  g.moveTo(123, 464);
  g.bezierCurveTo(105, 423, 134, 397, 158, 411);
  g.bezierCurveTo(143, 372, 165, 344, 190, 364);
  g.bezierCurveTo(176, 414, 218, 421, 223, 382);
  g.bezierCurveTo(229, 337, 207, 317, 236, 280);
  g.bezierCurveTo(240, 334, 282, 341, 282, 390);
  g.bezierCurveTo(307, 361, 339, 382, 325, 421);
  g.bezierCurveTo(351, 438, 332, 469, 300, 466);
  g.bezierCurveTo(256, 489, 218, 459, 192, 451);
  g.bezierCurveTo(166, 478, 140, 478, 123, 464);
  g.closePath(); g.fillStyle = '#ef3e32'; g.fill();

  /* 黄芯高光和两枚脱离焰片。 */
  g.beginPath();
  g.moveTo(265, 303); g.bezierCurveTo(251, 274, 266, 249, 283, 235);
  g.bezierCurveTo(281, 271, 310, 276, 302, 312);
  g.bezierCurveTo(294, 335, 273, 329, 265, 303); g.closePath();
  g.fillStyle = '#fff04a'; g.fill();

  function detached(cx, cy, sc, flip) {
    g.save(); g.translate(cx, cy); g.scale(flip ? -sc : sc, sc);
    g.beginPath();
    g.moveTo(-18, 28); g.bezierCurveTo(-33, 2, -17, -19, 2, -31);
    g.bezierCurveTo(-5, -4, 28, 2, 18, 29);
    g.bezierCurveTo(8, 43, -8, 42, -18, 28); g.closePath();
    g.fillStyle = '#ef3e32'; g.fill(); g.lineWidth = 7 / sc; g.strokeStyle = '#541910'; g.stroke();
    g.beginPath(); g.moveTo(-7, 24); g.bezierCurveTo(-12, 8, 0, -3, 8, -12);
    g.bezierCurveTo(5, 8, 19, 15, 9, 28); g.bezierCurveTo(3, 35, -3, 33, -7, 24); g.closePath();
    g.fillStyle = '#ffc928'; g.fill(); g.restore();
  }
  detached(122, 102, 0.92, false);
  detached(400, 104, 0.72, true);
  detached(449, 185, 0.52, false);

  return _comicCanvasTex(cv);
}

/* 参考燃烧烟重绘:连续S形黑烟柱、炭黑主体、灰紫受光卷边;透明背景不使用原图棋盘。 */
/* ===== FX7 烟样式扩充:helper+painters(与 fx_art/smoke_paint.js 同源,勿手改) ===== */


function DP_speckOut(g, x, y, w, h, seed, n, rmax, alpha){
  var rnd = mulberry32(seed), i;
  g.save(); g.globalCompositeOperation = 'destination-out';
  for(i = 0; i < n; i++){ g.globalAlpha = alpha * (0.35 + rnd() * 0.65);
    g.beginPath(); g.arc(x + rnd() * w, y + rnd() * h, 1 + rnd() * rmax, 0, TAU); g.fill(); }
  g.restore(); g.globalAlpha = 1;
}

function DP_dots(g, x, y, w, h, seed, n, rmin, rmax, color, alpha){
  var rnd = mulberry32(seed), i;
  g.save(); g.fillStyle = color; g.globalAlpha = alpha;
  for(i = 0; i < n; i++){ g.beginPath(); g.arc(x + rnd() * w, y + rnd() * h, rmin + rnd() * (rmax - rmin), 0, TAU); g.fill(); }
  g.restore(); g.globalAlpha = 1;
}


function DP_clod(g, x, y, r, seed){
  var rr = mulberry32(seed), pts = [], n = 9, i;
  for(i = 0; i < n; i++){ var a = i / n * TAU, k = 1 + (rr() - .5) * .5; pts.push([x + Math.cos(a) * r * k, y + Math.sin(a) * r * k]); }
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for(i = 1; i < n; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath(); g.fillStyle = '#4a3826'; g.fill();
  g.strokeStyle = '#241b12'; g.lineWidth = Math.max(2, r * .11); g.stroke();
  g.beginPath(); g.ellipse(x - r * .2, y - r * .24, r * .4, r * .28, -.2, 0, TAU); g.fillStyle = '#6b543a'; g.fill();
}

var BURN_PROF={W:376,H:493,rows:[[22, 215.0, 228.0], [24, 213.0, 230.2], [30, 200.4, 237.0], [36, 65.6, 239.0], [42, 46.8, 238.6], [48, 35.0, 236.4], [54, 26.8, 237.0], [60, 21.6, 280.8], [66, 19.0, 281.8], [72, 17.2, 307.8], [78, 20.2, 312.2], [84, 26.4, 313.4], [90, 29.4, 313.2], [96, 36.4, 310.2], [102, 41.0, 316.8], [108, 42.8, 321.4], [114, 39.2, 322.0], [120, 62.6, 319.0], [126, 85.0, 309.0], [132, 76.2, 301.6], [138, 93.8, 286.0], [144, 103.6, 282.0], [150, 104.8, 316.8], [156, 146.4, 315.8], [162, 145.4, 308.2], [168, 148.2, 329.8], [174, 155.6, 340.2], [180, 159.2, 344.2], [186, 150.4, 353.4], [192, 155.4, 357.6], [198, 177.4, 335.0], [204, 135.0, 328.0], [210, 191.2, 325.4], [216, 210.6, 333.6], [222, 141.2, 337.0], [228, 191.4, 337.2], [234, 184.0, 333.2], [240, 175.2, 334.6], [246, 172.2, 336.2], [252, 171.6, 339.8], [258, 174.8, 365.8], [264, 182.4, 352.0], [270, 188.4, 356.8], [276, 165.0, 355.6], [282, 158.0, 352.0], [288, 151.4, 322.0], [294, 148.2, 299.0], [300, 142.6, 298.2], [306, 141.0, 327.4], [312, 143.6, 318.0], [318, 143.8, 319.8], [324, 141.8, 314.8], [330, 139.6, 318.8], [336, 144.0, 330.0], [342, 151.8, 344.8], [348, 158.0, 322.2], [354, 156.4, 313.8], [360, 156.0, 366.8], [366, 158.0, 352.7], [372, 149.2, 319.0], [378, 171.4, 287.3], [384, 178.3, 323.5], [390, 172.5, 318.1], [396, 172.0, 312.7], [402, 148.2, 307.3], [408, 125.2, 301.9], [414, 128.8, 296.5], [420, 128.3, 291.2], [426, 121.0, 285.8], [432, 103.6, 280.4], [438, 141.2, 275.0], [444, 146.4, 269.6], [450, 141.6, 264.2]],spine:[[28, 230], [34, 231], [40, 201], [46, 199], [52, 134], [58, 111], [64, 109], [70, 212], [76, 187], [82, 173], [88, 185], [94, 187], [100, 190], [106, 211], [112, 191], [118, 202], [124, 190], [130, 181], [136, 190], [142, 204], [148, 202], [154, 197], [160, 193], [166, 199], [172, 201], [178, 211], [184, 216], [190, 214], [196, 227], [202, 234], [208, 241], [214, 251], [220, 257], [226, 248], [232, 245], [238, 240], [244, 237], [250, 238], [256, 236], [262, 239], [268, 233], [274, 234], [280, 228], [286, 211], [292, 203], [298, 200], [304, 195], [310, 194], [316, 191], [322, 186], [328, 184], [334, 190], [340, 194], [346, 206], [352, 207], [358, 214], [364, 217], [370, 219], [376, 209], [382, 228], [388, 220], [394, 222], [400, 291]]};
/* ============================================================
   FX8-SMOKE 烟效重绘运行模块（v1）：发动机烟 / 行进烟 / 炮弹击中地面烟 / 地面尘 / 燃烧烟
   ------------------------------------------------------------
   · 轮廓先算后画：极坐标多谐波 + 羽流剖面 + 两端端帽；轮廓是数据，可审计、可复现
   · 烘焙零描边：实心剪影并集 → 软渐变 → 底部透明度衰减 → 整体高斯羽化
   · 通用尺寸抖动：_sfxJit() → SmokeFX.randSize()，每团烟只调用一次
   · 贴图尺寸与单元格固定为 256x256；燃烧烟保持 256x512，UV 帧不变
   ============================================================ */
/* ============================================================================
 * smoke-fx.js —— 烟效重绘 运行文件（v1，5 个烟族：发动机/行进/击中地面/地面尘/燃烧）
 * 从「烟效美术演示.html」抽取，与演示页烘焙出的贴图逐像素一致。
 * 蘑菇云待配色验收后并入 v2。
 *
 * 用法：
 *   SmokeFX.build();                       // 启动时烘焙一次，约 20 张离屏画布
 *   var t = SmokeFX.tex('dust', i);        // 取第 i 张行进烟贴图（canvas）
 *   var s = baseSize * SmokeFX.randSize(); // ★ 每团烟都必须乘一次 [0.85,1.15]
 *   g.drawImage(t, x - s / 2, y - s * t.height / t.width / 2, s, s * t.height / t.width);
 * ========================================================================== */
var SmokeFX = (function () {
'use strict';

var TAU = Math.PI * 2;
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1); return t * t * (3 - 2 * t); }
function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function smResample(p, N) {                       // 按弧长重采样，体检与采样密度解耦
  N = N || 128; var n = p.length, seg = []; var total = 0;
  for (var i = 0; i < n; i++) {
    var b = p[i], c = p[(i + 1) % n];
    var d = Math.hypot(c[0] - b[0], c[1] - b[1]); seg.push(d); total += d;
  }
  var step = total / N, out = []; var acc = 0, si = 0;
  for (var i = 0; i < N; i++) {
    var target = i * step;
    while (si < n - 1 && acc + seg[si] < target) { acc += seg[si]; si++; }
    var u = seg[si] > 1e-9 ? (target - acc) / seg[si] : 0;
    var a0 = p[si], a1 = p[(si + 1) % n];
    out.push([a0[0] + (a1[0] - a0[0]) * u, a0[1] + (a1[1] - a0[1]) * u]);
  }
  return out;
}

function smProfileW(prof, t) {
  var n = prof.length;
  if (t <= prof[0][0]) return prof[0][1];
  if (t >= prof[n - 1][0]) return prof[n - 1][1];
  var i = 0; while (i < n - 2 && prof[i + 1][0] < t) i++;
  var p0 = prof[Math.max(0, i - 1)], p1 = prof[i], p2 = prof[i + 1], p3 = prof[Math.min(n - 1, i + 2)];
  var u = (t - p1[0]) / (p2[0] - p1[0] || 1e-6);
  var mu = (p2[1] - p0[1]) / (p2[0] - p0[0] || 1e-6), nu = (p3[1] - p1[1]) / (p3[0] - p1[0] || 1e-6);
  var u2 = u * u, u3 = u2 * u;
  return (2 * p1[1] - 2 * p2[1] + mu + nu) * u3 + (-3 * p1[1] + 3 * p2[1] - 2 * mu - nu) * u2 + mu * u + p1[1];
}
/* 团块：极坐标半径 R(θ)=R·(1+Σ a_k cos(kθ+φ_k))，叠加 squash / taper / topBias
   要点：只用低阶谐波（k=2,3,5）且振幅逐级减半 —— 保证"不规整"的同时不会出现尖角 */
function smBlobPts(o) {
  var rnd = mulberry32(o.seed || 1), N = 128;
  var R = o.R, cx = o.cx, cy = o.cy, sq = o.squash == null ? 1 : o.squash;
  var Hr = o.harm || [[2, .10], [3, .05], [5, .022]];
  var ph = o.phases || (function () { var q = []; for (var z = 0; z < Hr.length; z++) q.push(rnd() * TAU); return q; })();
  var rot = o.rot || 0, taper = o.taper || 0, topBias = o.topBias || 0;
  var pts = [];
  for (var i = 0; i < N; i++) {
    var a = i / N * TAU, ca = Math.cos(a), sa = Math.sin(a);
    var s = 0; for (var k = 0; k < Hr.length; k++) s += Hr[k][1] * Math.cos(Hr[k][0] * a + ph[k]);
    var r = R * (1 + s);
    if (taper) r *= 1 - taper * Math.max(0, ca) * Math.abs(sa);      // +x 方向收成水滴尾
    if (topBias) r *= 1 + topBias * Math.max(0, -sa) * (1 - Math.abs(ca));
    var x = r * ca, y = r * sa * sq;
    pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return pts;
}
/* 柱体（燃烧烟 / 蘑菇云柄盖）：剖面 + 两端半椭圆端帽（胶囊式，保证 C1 连续） */
function smColumnPts(o) {
  var prof = o.prof, W = o.W, H = o.H, cx = o.cx, yBot = o.yBot, M = o.M || 46;
  var Hr = o.harm || [[2, .12], [3, .07], [4, .034]];
  var rnd = mulberry32(o.seed || 1);
  var phL = [], phR = [];
  for (var k = 0; k < Hr.length; k++) { phL.push(rnd() * TAU); phR.push(rnd() * TAU); }
  var g0 = o.gate0 == null ? 0.12 : o.gate0, g1 = o.gate1 == null ? 0.88 : o.gate1;
  function sideW(t, ph) {
    var w = smProfileW(prof, t) * W, s = 0;
    for (var k = 0; k < Hr.length; k++) s += Hr[k][1] * Math.cos(Hr[k][0] * Math.PI * t + ph[k]);
    var gate = smoothstep(0, g0, t) * (1 - smoothstep(g1, 1, t));  // 两端谐波归零，端帽接缝不出现折角
    return Math.max(2, w * (1 + s * gate));
  }
  var sh = o.shear || 0, pts = [];
  var rb = Math.max(2, smProfileW(prof, 0) * W), B = 10;
  for (var i = 0; i <= B; i++) {                       // 底帽：右 → 下 → 左
    var a = i / B * Math.PI;
    pts.push([cx + Math.cos(a) * rb, yBot + Math.sin(a) * rb * (o.botRound || .8)]);
  }
  for (var i = 0; i <= M; i++) { var t = i / M; pts.push([cx + sh * t - sideW(t, phL), yBot - t * H]); }
  var wL = sideW(1, phL), wR = sideW(1, phR);        // 顶帽：左 → 顶 → 右
  var wa = (wL + wR) / 2, ha = wa * (o.topRound == null ? .9 : o.topRound), yTop = yBot - H, K = 16;
  for (var i = 0; i <= K; i++) {
    var ta = Math.PI * (1 - i / K), ww = wR + (wL - wR) * (i / K);
    pts.push([cx + sh + Math.cos(ta) * ww, yTop - Math.sin(ta) * ha]);
  }
  for (var i = M; i >= 0; i--) { var t = i / M; pts.push([cx + sh * t + sideW(t, phR), yBot - t * H]); }
  return pts;
}

var SIZE_JITTER = [0.85, 1.15];
function smokeSizeMul() {
  var k = SIZE_JITTER[0] + Math.random() * (SIZE_JITTER[1] - SIZE_JITTER[0]);
  return k;
}

var PAL = {
  engine: { base: [198, 203, 209], light: [240, 244, 247], dark: [86, 92, 102], core: [148, 154, 163] },
  dust:   { base: [214, 192, 152], light: [242, 228, 200], dark: [112, 90, 62], core: [172, 146, 108] },
  hit:    { base: [190, 170, 136], light: [232, 216, 186], dark: [78, 66, 52], core: [120, 96, 70], ember: [198, 108, 54] },
  ground: { base: [208, 184, 144], light: [238, 222, 192], dark: [104, 84, 58], core: [164, 138, 102] },
  burn:   { base: [78, 72, 74], light: [152, 150, 158], dark: [22, 20, 26], warm: [148, 100, 60], top: [130, 130, 138] }
};

function T(dx, dy, r, key, a, at, R) { return { dx: dx, dy: dy, r: r, key: key, a: a, at: at, R: R }; }

var BURN_PROF = [[0, .28], [.06, .285], [.16, .34], [.32, .47], [.48, .62], [.64, .76], [.78, .86], [.90, .86], [.96, .80], [1, .76]];
var STEM_PROF = [[0, .34], [.10, .36], [.30, .46], [.55, .60], [.75, .70], [.88, .68], [.96, .62], [1, .58]];
var CAP_PROF  = [[0, .60], [.06, .62], [.18, .86], [.32, 1.00], [.48, 1.00], [.64, .90], [.80, .70], [.92, .46], [1, .40]];
var CAP2_PROF = [[0, .50], [.12, .84], [.28, .90], [.50, .82], [.70, .64], [.86, .42], [1, .28]];

var FAMILIES = {
  engine: { key: 'engine', cell: [256, 256], alpha: .62, feather: 7, draw: 96, variants: [
    { name: 'E0 SURGE', geom: { kind: 'blob', cx: 128, cy: 142, R: 86, squash: 1.02, harm: [[2, .095], [3, .05], [5, .022]], rot: -.12, topBias: .10, seed: 0x1001 },
      tone: [T(-.26, -.30, .60, 'light', .26), T(.22, .26, .62, 'dark', .22), T(.02, .10, .50, 'core', .16), T(-.42, .18, .30, 'light', .12), T(.34, -.30, .26, 'dark', .10)] },
    { name: 'E1 SWEEP', geom: { kind: 'blob', cx: 122, cy: 140, R: 76, squash: .64, harm: [[2, .11], [3, .05], [5, .02]], taper: .36, rot: .05, seed: 0x1002 },
      tone: [T(-.30, -.28, .58, 'light', .26), T(.10, .24, .60, 'dark', .22), T(-.05, .04, .44, 'core', .18), T(.30, .10, .28, 'dark', .12), T(-.46, .06, .26, 'light', .10)] },
    { name: 'E2 DOUBLE SURGE', geom: { kind: 'blob', cx: 128, cy: 142, R: 84, squash: 1.10, harm: [[2, .13], [3, .05], [5, .02]], phases: [Math.PI, 1.1, 2.3], rot: .04, topBias: .06, seed: 0x1003 },
      tone: [T(-.24, -.40, .46, 'light', .24), T(-.22, .34, .44, 'light', .18), T(.24, .02, .56, 'dark', .22), T(-.02, -.06, .40, 'core', .16), T(.36, -.40, .24, 'dark', .10)] }
  ] },
  dust: { key: 'dust', cell: [256, 256], alpha: .56, feather: 7, draw: 118, variants: [
    { name: 'D0 ROUND DUST', geom: { kind: 'blob', cx: 128, cy: 150, R: 86, squash: .92, harm: [[2, .10], [3, .055], [5, .024]], seed: 0x2001 },
      tone: [T(-.28, -.32, .58, 'light', .26), T(.24, .18, .60, 'dark', .24), T(.00, .04, .48, 'core', .18), T(.38, -.24, .26, 'dark', .12)], contact: .34 },
    { name: 'D1 WIDE SKIRT', geom: { kind: 'blob', cx: 128, cy: 156, R: 78, squash: .54, harm: [[2, .10], [3, .05], [5, .02]], taper: .18, seed: 0x2002 },
      tone: [T(-.16, -.34, .60, 'light', .26), T(.10, .22, .62, 'dark', .26), T(-.30, .12, .36, 'light', .14), T(.42, -.10, .28, 'dark', .12)], contact: .42 },
    { name: 'D2 RISING COLUMN', geom: { kind: 'blob', cx: 128, cy: 148, R: 70, squash: 1.42, harm: [[2, .09], [3, .05], [5, .022]], topBias: .22, seed: 0x2003 },
      tone: [T(-.26, -.36, .54, 'light', .26), T(.24, .10, .58, 'dark', .22), T(-.02, .18, .44, 'core', .18), T(.30, -.28, .26, 'dark', .12)], contact: .30 }
  ] },
  hit: { key: 'hit', cell: [256, 256], alpha: .60, feather: 6, draw: 128, variants: [
    { name: 'H0 BURST', geom: { kind: 'blob', cx: 128, cy: 140, R: 74, squash: .95, harm: [[2, .075], [3, .045], [6, .018], [7, .012]], seed: 0x3001 },
      tone: [T(-.24, -.28, .52, 'light', .26), T(.20, .22, .56, 'dark', .24), T(-.04, .02, .40, 'ember', .18), T(.34, -.30, .26, 'dark', .14), T(-.38, .22, .24, 'light', .12)], contact: .38 },
    { name: 'H1 ROLLING DOME', geom: { kind: 'blob', cx: 128, cy: 150, R: 74, squash: .58, harm: [[2, .10], [3, .05], [5, .02]], taper: .20, seed: 0x3002 },
      tone: [T(-.18, -.32, .58, 'light', .26), T(.12, .20, .60, 'dark', .24), T(-.34, .06, .34, 'light', .14), T(.40, -.14, .28, 'dark', .14)], contact: .44 },
    { name: 'H2 CHARGE COLUMN', geom: { kind: 'blob', cx: 128, cy: 146, R: 66, squash: 1.38, harm: [[2, .09], [3, .05], [5, .022]], topBias: .25, seed: 0x3003 },
      tone: [T(-.24, -.38, .52, 'light', .26), T(.22, .08, .56, 'dark', .22), T(-.02, .14, .40, 'ember', .16), T(.28, -.26, .24, 'dark', .12)], contact: .30 }
  ] },
  ground: { key: 'ground', cell: [256, 256], alpha: .54, feather: 7, draw: 116, variants: [
    { name: 'G0', geom: { kind: 'blob', cx: 128, cy: 128, R: 100, squash: .96, harm: [[2, .10], [3, .05], [5, .022]], seed: 0x4001 },
      tone: [T(-.28, -.30, .58, 'light', .24), T(.24, .20, .60, 'dark', .24), T(.00, .04, .46, 'core', .16)], contact: .40 },
    { name: 'G1', geom: { kind: 'blob', cx: 128, cy: 128, R: 98, squash: .72, harm: [[2, .10], [3, .055], [5, .024]], seed: 0x4002 },
      tone: [T(-.20, -.32, .58, 'light', .24), T(.16, .20, .60, 'dark', .24), T(-.36, .10, .32, 'light', .12)], contact: .44 },
    { name: 'G2', geom: { kind: 'blob', cx: 128, cy: 128, R: 96, squash: 1.18, harm: [[2, .09], [3, .05], [5, .022]], topBias: .14, seed: 0x4003 },
      tone: [T(-.26, -.34, .56, 'light', .24), T(.22, .12, .58, 'dark', .22), T(.02, .16, .42, 'core', .16)], contact: .34 },
    { name: 'G3', geom: { kind: 'blob', cx: 128, cy: 128, R: 100, squash: .88, harm: [[2, .115], [3, .05], [5, .02]], rot: .5, seed: 0x4004 },
      tone: [T(-.24, -.26, .58, 'light', .24), T(.26, .22, .58, 'dark', .24), T(-.40, .18, .28, 'light', .12)], contact: .40 }
  ] },
  burn: { key: 'burn', cell: [256, 512], alpha: .70, feather: 8, draw: 108, variants: (function () { var _a = []; for (var v = 0; v < 4; v++) _a.push({
      name: 'B' + v,
      geom: { kind: 'col', cx: 128, yBot: 452, H: 330, W: 116 + v * 4, prof: BURN_PROF, seed: 0x5001 + v,
              harm: [[2, .155], [3, .085], [4, .042]], topRound: 1.05, botRound: .88 },
      tone: [T(.10, .58, .70, 'warm', .34), T(.00, .82, .52, 'warm', .22),
             T(-.34, -.10, .62, 'light', .22), T(.34, .16, .60, 'dark', .30),
             T(-.10, -.62, .58, 'top', .26), T(.22, -.34, .40, 'top', .16), T(-.30, .34, .38, 'warm', .16)],
      fade: { y0: 400, y1: 500, a: .9 } }); return _a; })() }
};

function pathFromPts(pts) {                    // Catmull-Rom → 三次贝塞尔
  var P = new Path2D(), n = pts.length;
  P.moveTo(pts[0][0], pts[0][1]);
  for (var i = 0; i < n; i++) {
    var a = pts[i], b = pts[(i + 1) % n], c = pts[(i + 2) % n], e = pts[(i - 1 + n) % n];
    P.bezierCurveTo(a[0] + (b[0] - e[0]) / 6, a[1] + (b[1] - e[1]) / 6,
                    b[0] - (c[0] - a[0]) / 6, b[1] - (c[1] - a[1]) / 6, b[0], b[1]);
  }
  P.closePath(); return P;
}
function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rgb(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')'; }

/* 烘焙一张烟贴图：实心剪影 → 内部软渐变调子 → 整体羽化 */
function bakeSmokeTex(spec) {
  var w = spec.cell[0], h = spec.cell[1];
  var hard = makeCanvas(w, h), hc = hard.getContext('2d');
  var pal = spec.pal, base = pal.base || pal.capBody;
  hc.clearRect(0, 0, w, h);
  /* (a) 剪影并集：所有部件一次性 clip，实心填充 —— 没有描边、没有逐圈堆壳 */
  var uni = new Path2D();
  for (var pts of spec.parts) uni.addPath(pathFromPts(pts));
  hc.save(); hc.clip(uni);
  hc.fillStyle = rgb(base, 1); hc.fillRect(0, 0, w, h);
  /* (b) 内部调子：全部是软渐变团，圆心偏移 + 半径 <= 0.92R，边缘已衰减到 0，不会产生硬边 */
  for (var t of (spec.tone || [])) {
    var at = t.at || spec.center, R = t.R || spec.refR || 1;
    var x = at[0] + t.dx * R, y = at[1] + t.dy * R, r = t.r * R;
    var lim = R * 0.92, d = Math.hypot(x - at[0], y - at[1]);
    if (d + r > lim) { var s = (lim - d) / r; if (s <= .08) continue; r *= s; }
    if (r <= 1) continue;
    var col = pal[t.key] || base;
    var g = hc.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgb(col, 1)); g.addColorStop(.55, rgb(col, .5)); g.addColorStop(1, rgb(col, 0));
    hc.fillStyle = g; hc.beginPath(); hc.arc(x, y, r, 0, TAU); hc.fill();
  }
  /* (c) 接地压暗 / 底部渐隐 —— 同样是渐变不是线条 */
  if (spec.contact) {
    var c = spec.center, R = spec.refR;
    var y0 = c[1] + R * .10, y1 = c[1] + R * 1.05;
    var g = hc.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + spec.contact + ')');
    hc.fillStyle = g; hc.fillRect(0, y0, w, y1 - y0 + 1);
  }
  hc.restore();
  if (spec.fade) {
    hc.globalCompositeOperation = 'destination-out';
    var g = hc.createLinearGradient(0, spec.fade.y0, 0, spec.fade.y1);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + spec.fade.a + ')');
    hc.fillStyle = g; hc.fillRect(0, spec.fade.y0, w, spec.fade.y1 - spec.fade.y0);
    hc.globalCompositeOperation = 'source-over';
  }
  /* (d) 羽化：整体高斯模糊，边缘自然化开 */
  var out = makeCanvas(w, h), oc = out.getContext('2d');
  oc.filter = 'blur(' + spec.feather + 'px)';
  oc.drawImage(hard, 0, 0);
  oc.filter = 'none';
  return out;
}

/* ------------------------------- 纹理库 ------------------------------- */
var TEX = {};
var KINDS = ['engine', 'dust', 'hit', 'ground', 'burn'];
var DRAW_SIZE = { engine: 96, dust: 118, hit: 128, ground: 116, burn: 108 };

function build() {
  for (var n = 0; n < KINDS.length; n++) {
    var k = KINDS[n], F = FAMILIES[k];
    if (TEX[k] && TEX[k].length) continue;
    TEX[k] = [];
    for (var v = 0; v < F.variants.length; v++) {
      var gm = F.variants[v].geom;
      var pts = gm.kind === 'col' ? smColumnPts(gm) : smBlobPts(gm);
      var P = smResample(pts, 128);
      TEX[k].push(bakeSmokeTex({
        cell: F.cell, pal: PAL[F.key], parts: [P], tone: F.variants[v].tone,
        contact: F.variants[v].contact, fade: F.variants[v].fade,
        center: [gm.cx, gm.cy != null ? gm.cy : gm.yBot - gm.H * .5],
        refR: gm.R || gm.W, feather: F.feather
      }));
    }
  }
  return TEX;
}

/* 贴图可见底边（0=顶 1=底），把烟底压在地面上时用：
   drawY = groundY - (BOTTOM[kind] - 0.5) * 贴图高 */
var BOTTOM = { engine: 0.895, dust: 0.861, hit: 0.850, ground: 0.872, burn: 0.929 };

return {
  build: build,
  kinds: KINDS,
  drawSize: DRAW_SIZE,
  bottom: BOTTOM,
  sizeJitter: SIZE_JITTER,
  randSize: smokeSizeMul,               /* ★ 每团烟生成时调用一次 */
  tex: function (k, i) { var a = TEX[k] || (TEX[k] = []); return a[i % a.length]; },
  rand: function (k) { return this.tex(k, (Math.random() * 99999) | 0); },
  count: function (k) { return (TEX[k] || []).length; },
  cell: function (k) { return FAMILIES[k].cell; },
  bake: bakeSmokeTex,                   /* 需要自定义规格时用 */
  blobPts: smBlobPts, colPts: smColumnPts, resample: smResample,
  PAL: PAL, FAMILIES: FAMILIES, BURN_PROF: BURN_PROF
};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = SmokeFX;

var _sfxReady = false;
function _sfxTex(kind, i){ if(!_sfxReady){ try{ SmokeFX.build(); _sfxReady = true; }catch(e){ _sfxReady = false; } }
  return _sfxReady ? SmokeFX.tex(kind, i) : null; }
function _sfxJit(){ try{ return SmokeFX.randSize(); }catch(e){ return 1; } }   /* ★ 每一团烟都必须乘一次 */

function paintCSM_E(g, v){
  /* FX8-SMOKE: use the pre-baked engine-smoke frame. */
  var t = _sfxTex('engine', v); if(!t) return;
  g.drawImage(t, 0, 0, 256, 256);
}

function paintCSM_D(g, v){
  /* FX8-SMOKE dust frames: 1 retains the specified round-dust variant; UV frames stay fixed. */
  var t = _sfxTex('dust', v); if(!t) return;
  g.drawImage(t, 0, 0, 256, 256);
}

function paintCHS(g, v){
  /* FX8-SMOKE: use the pre-baked hit-smoke frame. */
  var t = _sfxTex('hit', v); if(!t) return;
  g.drawImage(t, 0, 0, 256, 256);
}

function paintCTD(g, v){
  var S = 0xE560 + v * 0x10, rnd = mulberry32(S + 9), i;
  if(v === 0){           // T0 土块飞溅
    _fxA2(g, 128, 190, 80, S, 168, 142, 104, 2, 1);
    _fxA2(g, 128, 140, 56, S + 1, 178, 152, 112, 0, 1);
    DP_clod(g, 110, 120, 34, S + 2); DP_clod(g, 168, 150, 26, S + 3);
    DP_clod(g, 76, 170, 22, S + 4); DP_clod(g, 190, 100, 18, S + 5);
    DP_dots(g, 40, 60, 176, 140, S + 6, 18, 2, 5, '#4a3826', .65);
  } else if(v === 1){    // T1 尘带（土块散布）
    _fxA2(g, 128, 162, 70, S, 168, 142, 104, 2, 1);
    _fxA2(g, 128, 192, 60, S + 1, 158, 132, 96, 2, 1);
    for(i = 0; i < 8; i++){ var xx = 28 + i * 26 + rnd() * 18;
      DP_clod(g, xx, 92 + rnd() * 58, 8 + rnd() * 9, S + 2 + i); }
    g.save(); g.strokeStyle = 'rgba(74,56,38,.4)'; g.lineWidth = 3; g.lineCap = 'round';
    for(i = 0; i < 4; i++){ var yy = 140 + i * 18;
      g.beginPath(); g.moveTo(24, yy); g.lineTo(120 + rnd() * 60, yy - 6); g.stroke(); }
    g.restore();
  } else {               // T2 旋扬
    _fxA2(g, 128, 170, 66, S, 168, 142, 104, 0, 1);
    _fxA2(g, 128, 130, 44, S + 1, 178, 152, 112, 0, 1);
    g.save(); g.strokeStyle = 'rgba(74,56,38,.55)'; g.lineCap = 'round';
    for(i = 0; i < 3; i++){ g.lineWidth = 5 - i;
      g.beginPath(); g.arc(128, 190, 44 + i * 26, Math.PI * (1.15 + i * .1), Math.PI * (1.85 - i * .06)); g.stroke(); }
    g.restore();
    DP_clod(g, 84, 118, 22, S + 2); DP_clod(g, 128, 88, 26, S + 3); DP_clod(g, 172, 118, 22, S + 4);
    DP_dots(g, 60, 60, 136, 130, S + 5, 16, 2, 5, '#4a3826', .6);
    DP_speckOut(g, 60, 100, 136, 110, S + 6, 16, 6, .5);
  }
}

function paintCB(g, v){
  var S = 0xE5C0 + v * 0x40, i;
  var L = [
    {capY:300, capDX:0,   capW:1.0,  colX:512, lean:0,   skirtW:1.0,  colW:1.0},
    {capY:262, capDX:-30, capW:1.18, colX:470, lean:-46, skirtW:1.14, colW:.85},
    {capY:336, capDX:36,  capW:.88,  colX:552, lean:52,  skirtW:.9,   colW:1.2}
  ][v];
  var cx = 512 + L.capDX;
  g.fillStyle = 'rgba(35,33,31,.85)';
  g.beginPath(); g.ellipse(520, 930, 250 * L.skirtW, 26, -.02, 0, TAU); g.fill();
  for(i = 0; i < 7; i++)
    _fxA2(g, 520 + (i - 3) * 73 * L.skirtW, 895, 95, S + 100 + i * 3, 120, 110, 96, 2, 0);
  for(i = 0; i < 7; i++)
    _fxA2(g, L.colX + ((i * 37) % 30) + L.lean * i / 7, 840 - i * 58, (92 - i * 5) * L.colW, S + 30 + i * 3, 140, 132, 120, 1, 0);
  var cap = [[-.78, .44], [-.42, .16], [-.08, -.04], [.26, -.02], [.6, .18], [.88, .42]];
  for(i = 0; i < cap.length; i++)
    _fxA2(g, cx + cap[i][0] * 380 * L.capW, L.capY + 12 + cap[i][1] * 250, 118 * L.capW, S + 50 + i * 3, 104, 97, 89, 0, 0);
  for(i = 0; i < cap.length; i++)
    _fxA2(g, cx + cap[i][0] * 380 * L.capW, L.capY + cap[i][1] * 250, (112 + (i % 3) * 12) * L.capW, S + 60 + i * 3,
      i % 2 ? 210 : 178, i % 2 ? 196 : 160, i % 2 ? 178 : 138, 0, 0);
  var fro = [[-.5, .3], [-.14, .05], [.24, .07], [.5, .36]];
  for(i = 0; i < fro.length; i++)
    _fxA2(g, cx + fro[i][0] * 380 * L.capW, L.capY + 30 + fro[i][1] * 250, 104, S + 80 + i * 3, 222, 216, 204, 0, 0);
  _fxA2(g, cx - 110, L.capY + 175, 88, S + 100, 88, 84, 78, 0, 0);
  _fxA2(g, cx + 60, L.capY + 182, 92, S + 101, 88, 84, 78, 0, 0);
  _fxA2(g, cx - 150, L.capY + 168, 60, S + 102, 84, 80, 74, 0, 0);
  _fxA2(g, cx - 20, L.capY + 195, 70, S + 103, 84, 80, 74, 0, 0);
  _fxA2(g, cx - 90, L.capY - 100, 70, S + 104, 240, 236, 222, 0, 0);
  _fxA2(g, cx + 50, L.capY - 105, 75, S + 105, 240, 236, 222, 0, 0);
  DP_speckOut(g, cx - 220 * L.capW, L.capY - 160, 440 * L.capW, 260, S + 110, 26, 11, .35);
  DP_dots(g, 200, 700, 624, 260, S + 111, 26, 3, 8, '#3a332c', .5);
}

function paintBurnCell(g, x0, y0, v){
  /* FX8-SMOKE: 预烘焙羽流贴图（上大下小、圆柱外形、内部零描边）；
     Smoke frames use the baked atlas; runtime only selects and draws the frame.
     贴图可见底边在 0.929 处，整体放大 1.1 倍并下移，让柱底贴到单元格底边（平面原点=底边）。 */
  var t = _sfxTex('burn', v); if(!t) return;
  g.save(); g.beginPath(); g.rect(x0, y0, 256, 512); g.clip();
  g.drawImage(t, x0 - 12.8, y0 - 21.6, 281.6, 563.2);
  g.restore();
}

function _comicBurnMakeSmokeTex(){var cv=document.createElement('canvas');cv.width=512;cv.height=1024;var g=cv.getContext('2d');g.clearRect(0,0,512,1024);g.lineJoin='round';g.lineCap='round';
  /* FX7-BURN:黑烟柱水墨重绘(参考图剪影雕刻,无火焰;帧位不变) */
  paintBurnCell(g,0,0,0);paintBurnCell(g,256,0,1);paintBurnCell(g,0,512,2);paintBurnCell(g,256,512,3);
  var t=new THREE.CanvasTexture(cv);t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=false;return t;}
function _comicBurnSmokeEnsure(){if(_comicBurnSmokeMesh||!scene)return;if(!_comicBurnSmokeTex)_comicBurnSmokeTex=_comicBurnMakeSmokeTex();_comicBurnSmokeA=new Float32Array(COMIC_BURN_SMOKE_MAX);_comicBurnSmokeUvA=new Float32Array(COMIC_BURN_SMOKE_MAX*4);_comicBurnSmokeGeo=new THREE.PlaneGeometry(1,1);_comicBurnSmokeGeo.translate(0,.5,0);_comicBurnSmokeGeo.setAttribute('iAlpha',new THREE.InstancedBufferAttribute(_comicBurnSmokeA,1).setUsage(THREE.DynamicDrawUsage));_comicBurnSmokeGeo.setAttribute('iUvRect',new THREE.InstancedBufferAttribute(_comicBurnSmokeUvA,4).setUsage(THREE.DynamicDrawUsage));var vs=['attribute vec4 iUvRect;attribute float iAlpha;varying vec2 vUv;varying float vA;','#include <common>','#include <logdepthbuf_pars_vertex>','void main(){vUv=iUvRect.xy+uv*iUvRect.zw;vA=iAlpha;vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;','#include <logdepthbuf_vertex>','}'].join('\n'),fs=['uniform sampler2D map;varying vec2 vUv;varying float vA;','#include <logdepthbuf_pars_fragment>','void main(){','#include <logdepthbuf_fragment>','vec4 t=texture2D(map,vUv);float a=t.a*vA;if(a<.014)discard;gl_FragColor=vec4(t.rgb,a);}'].join('\n');_comicBurnSmokeMat=new THREE.ShaderMaterial({uniforms:{map:{value:_comicBurnSmokeTex}},vertexShader:vs,fragmentShader:fs,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,blending:THREE.NormalBlending,toneMapped:false,fog:false});_comicBurnSmokeMesh=new THREE.InstancedMesh(_comicBurnSmokeGeo,_comicBurnSmokeMat,COMIC_BURN_SMOKE_MAX);_comicBurnSmokeMesh.count=0;_comicBurnSmokeMesh.visible=false;_comicBurnSmokeMesh.frustumCulled=false;_comicBurnSmokeMesh.renderOrder=6;_comicBurnSmokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(_comicBurnSmokeMesh);}
function _comicBurnSmokeWrite(index,x,y,z,w,h,alpha,v){if(index>=COMIC_BURN_SMOKE_MAX||alpha<=.004)return index;comicTextureFace(_comicBurnQ,x,y,z,COMIC_FACE_YAW);_comicBurnPos.set(x,y,z);_comicBurnScale.set(w,h,1);_comicBurnM4.compose(_comicBurnPos,_comicBurnQ,_comicBurnScale);_comicBurnSmokeMesh.setMatrixAt(index,_comicBurnM4);_comicBurnSmokeA[index]=alpha;_fxUvW(_comicBurnSmokeUvA,index,_burnSmokeFrames,v);return index+1;}
function _comicBurnEnsure() {
  if (_comicBurnMesh || typeof scene === 'undefined' || !scene) return;
  if (!_comicBurnTex) _comicBurnTex = _comicBurnMakeTex();
  _comicBurnGeo = new THREE.PlaneGeometry(1, 1);
  _comicBurnGeo.translate(0, 0.5, 0);                  // 实例原点=火焰底边,直接钉住车体
  _comicBurnMat = new THREE.MeshBasicMaterial({ map: _comicBurnTex, transparent: true, alphaTest: 0.045,
    depthWrite: false, side: THREE.DoubleSide, fog: true });
  _comicBurnMesh = new THREE.InstancedMesh(_comicBurnGeo, _comicBurnMat, COMIC_BURN_MAX);
  _comicBurnMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  _comicBurnMesh.count = 0;
  _comicBurnMesh.visible = false;
  _comicBurnMesh.frustumCulled = false;                // 动态实例没有单一可靠包围球;固定 1 DC 比误剔除更安全
  _comicBurnMesh.renderOrder = 7;
  scene.add(_comicBurnMesh);
  _comicBurnSmokeEnsure();
}

/* world.js 每辆起火车每帧调用;已登记则 O(1) 返回,不生成任何视觉对象。 */
function comicBurnVehicle(t) {
  if (!t || !t.alive || !t.fire) return;
  if (t._comicBurnRegistered) return;
  t._comicBurnRegistered = true;
  t._comicBurnPhase = ((t.group && t.group.id || _comicBurnList.length + 1) * 2.399963) % 6.2832;
  t._comicBurnScaleEpoch = -1; t._comicBurnFarK = 1; t._comicBurnRangeVisible = true;
  t._comicBurnSX = Infinity; t._comicBurnSY = Infinity; t._comicBurnSZ = Infinity;
  t._comicBurnSmokeTailStart = -1;
  _comicBurnList.push(t);
}

/* 在场景渲染前压紧活跃表并一次性写 InstancedMesh。 */
function _comicBurnSync(nowS) {
  try {
    if (_comicBurnList.length && !_comicBurnMesh) _comicBurnEnsure();
    if (_comicBurnList.length) _cbPrepareScaleContext(nowS, false);
    var write=0,shown=0,smokeOut=0,C=_cbScaleCtx;
    for(var read=0;read<_comicBurnList.length;read++){
      var t=_comicBurnList[read];if(!t||!t.group){if(t)t._comicBurnRegistered=false;continue;}
      var active=!!(t.alive&&t.fire),tailAge=0;
      if(active){t._comicBurnSmokeTailStart=-1;}
      else{if(t._comicBurnSmokeTailStart==null||t._comicBurnSmokeTailStart<0)t._comicBurnSmokeTailStart=nowS;tailAge=nowS-t._comicBurnSmokeTailStart;if(tailAge>=1.55){t._comicBurnRegistered=false;t._comicBurnSmokeTailStart=-1;continue;}}
      _comicBurnList[write++]=t;
      var p=t.group.position,sx=p.x,sy=p.y+1.7,sz=p.z,bx=sx-t._comicBurnSX,by=sy-t._comicBurnSY,bz=sz-t._comicBurnSZ,burnMoved=!C.scoped&&bx*bx+by*by+bz*bz>=16;
      if(t._comicBurnScaleEpoch!==C.epoch||burnMoved){var ex=sx-C.cx,ey=sy-C.cy,ez=sz-C.cz,d2=ex*ex+ey*ey+ez*ez,scopeNative=C.scoped;t._comicBurnFarK=scopeDistK(scopeNative,d2,110,.94,2.45);t._comicBurnRangeVisible=scopeFarVisible(scopeNative,d2);t._comicBurnScaleEpoch=C.epoch;t._comicBurnSX=sx;t._comicBurnSY=sy;t._comicBurnSZ=sz;}
      if(!t._comicBurnRangeVisible)continue;
      var farK=t._comicBurnFarK,phase=t._comicBurnPhase||0,kindK=t.kind==='arty'?.90:1;
      if(active&&shown<COMIC_BURN_MAX){var pulse=Math.sin(nowS*7.1+phase),pulse2=Math.sin(nowS*10.7+phase*1.73),w=5.5*kindK*farK*(.96+pulse*.035),h=6.4*kindK*farK*(.97+pulse2*.045),yaw=comicTextureFace(_comicBurnQ,p.x,p.y,p.z,COMIC_FACE_YAW),sway=Math.sin(nowS*5.3+phase)*.13*farK;_comicBurnPos.set(p.x+Math.cos(yaw)*sway,p.y+.48,p.z-Math.sin(yaw)*sway);_comicBurnScale.set(w,h,1);_comicBurnM4.compose(_comicBurnPos,_comicBurnQ,_comicBurnScale);_comicBurnMesh.setMatrixAt(shown++,_comicBurnM4);}
      if(!_comicBurnSmokeMesh)continue;
      if(active){var clock=(nowS+phase*.31)%2.6;if(clock<0)clock+=2.6;for(var si=0;si<2&&smokeOut<COMIC_BURN_SMOKE_MAX;si++){if(t._fxBVar===undefined){t._fxBVar=(Math.random()*4)|0;t._fxBSJit=_sfxJit();}var age=(clock+si*1.3)%2.6,E=comicSmokeExpand(age,2.6,.10,1.86,.68,.58,3.5,.46),ang=phase+si*2.17,dr=E.drift*.42,sbj=t._fxBSJit||1,sw=3.8*kindK*farK*E.scale*sbj,sh=7.2*kindK*farK*(1+.62*E.k)*sbj;smokeOut=_comicBurnSmokeWrite(smokeOut,p.x+Math.sin(ang)*dr,p.y+1.12+E.rise,p.z+Math.cos(ang)*dr,sw,sh,.72*E.alpha,(t._fxBVar+si)%4);}}
      else if(smokeOut<COMIC_BURN_SMOKE_MAX){var TE=comicSmokeExpand(.25+tailAge,1.8,.08,1.72,.70,.62,3.2,.46),ta=phase+1.1,td=TE.drift*.34;smokeOut=_comicBurnSmokeWrite(smokeOut,p.x+Math.sin(ta)*td,p.y+1.18+TE.rise,p.z+Math.cos(ta)*td,3.9*kindK*farK*TE.scale*(t._fxBSJit||1),7.4*kindK*farK*(1+.52*TE.k)*(t._fxBSJit||1),.78*TE.alpha,t._fxBVar|0);}
    }
    _comicBurnList.length=write;
    if(_comicBurnMesh){_comicBurnMesh.count=shown;_comicBurnMesh.visible=shown>0;if(shown)_comicBurnMesh.instanceMatrix.needsUpdate=true;}
    if(_comicBurnSmokeMesh){_comicBurnSmokeMesh.count=smokeOut;_comicBurnSmokeMesh.visible=smokeOut>0;if(smokeOut){var im=_comicBurnSmokeMesh.instanceMatrix;im.updateRange.offset=0;im.updateRange.count=smokeOut*16;im.needsUpdate=true;var aa=_comicBurnSmokeGeo.attributes.iAlpha,au=_comicBurnSmokeGeo.attributes.iUvRect;aa.updateRange.offset=0;aa.updateRange.count=smokeOut;au.updateRange.offset=0;au.updateRange.count=smokeOut*4;aa.needsUpdate=au.needsUpdate=true;}}
  }catch(e){if(_comicBurnMesh){_comicBurnMesh.count=0;_comicBurnMesh.visible=false;}if(_comicBurnSmokeMesh){_comicBurnSmokeMesh.count=0;_comicBurnSmokeMesh.visible=false;}}
}

/* ============================================================
   漫画特效:主炮开火火光 + 两阶段炮口烟 + 贴图式四周照明
   主炮不使用粒子飞溅/点光源,亮度由事件捕获的高亮贴图接管。
   侧焰/正闪/车体地面亮度贴图各一只 InstancedMesh;团烟与后续上飘细烟共用
   一张2格 atlas和一只 InstancedMesh。无粒子、泛光或材质反光。
   ============================================================ */
var CMZ_POOL=24,CMZ_SMOKE_CAP=CMZ_POOL*2,CMZ_ILLUM_CAP=CMZ_POOL*2,_cmzPool=null,_cmzRing=0,_cmzLive=0,_cmzZeroed=true,_cmzSideTex=null,_cmzFrontTex=null,_cmzSmokeTex=null,_cmzIllumTex=null;
var _cmzSideMesh=null,_cmzFrontMesh=null,_cmzSmokeMesh=null,_cmzIllumMesh=null,_cmzSideA=null,_cmzFrontA=null,_cmzSmokeA=null,_cmzIllumA=null,_cmzSmokeUvA=null;
var _cmzX=new THREE.Vector3(1,0,0),_cmzQ=new THREE.Quaternion(),_cmzRollQ=new THREE.Quaternion(),_cmzZ=new THREE.Vector3(0,0,1),_cmzDir=new THREE.Vector3();
var _cmzM1=new THREE.Matrix4(),_cmzM2=new THREE.Matrix4(),_cmzM3=new THREE.Matrix4(),_cmzM4=new THREE.Matrix4();
var _cmzPos=new THREE.Vector3(),_cmzScale=new THREE.Vector3(),_cmzAnchorP=new THREE.Vector3();
var _cmzSmokeFrames=[[.008,.508,.234,.484],[.258,.508,.234,.484],[.008,.008,.234,.484],[.258,.008,.234,.484],[.508,.508,.234,.484],[.758,.508,.234,.484],[.508,.008,.234,.484],[.758,.008,.234,.484]];   // FX1:0-3爆烟/4-7上飘烟
function _cmzTex(w,h,draw,mip){var cv=document.createElement('canvas');cv.width=w;cv.height=h;var g=cv.getContext('2d');g.clearRect(0,0,w,h);g.lineJoin='round';g.lineCap='round';draw(g,w,h);var t=new THREE.CanvasTexture(cv);t.minFilter=mip?THREE.LinearMipmapLinearFilter:THREE.LinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=!!mip;return t;}
function _cmzBuildTex(){
  _cmzSideTex=_cmzTex(512,256,function(g){g.beginPath();g.moveTo(10,130);g.bezierCurveTo(50,105,70,91,101,103);g.bezierCurveTo(111,67,154,54,181,79);g.bezierCurveTo(197,38,252,31,278,67);g.bezierCurveTo(313,37,365,54,369,94);g.bezierCurveTo(421,71,474,96,466,139);g.bezierCurveTo(500,163,474,206,430,190);g.bezierCurveTo(397,225,345,213,323,185);g.bezierCurveTo(280,222,223,202,211,174);g.bezierCurveTo(171,202,126,185,119,157);g.bezierCurveTo(74,168,42,151,10,130);g.closePath();g.fillStyle='rgba(255,109,13,.88)';g.fill();
    g.beginPath();g.moveTo(9,129);g.bezierCurveTo(63,114,89,91,125,111);g.bezierCurveTo(140,76,182,71,203,101);g.bezierCurveTo(230,61,280,67,296,104);g.bezierCurveTo(330,70,376,91,369,129);g.bezierCurveTo(408,118,434,148,414,174);g.bezierCurveTo(373,194,328,174,309,155);g.bezierCurveTo(267,185,219,167,202,145);g.bezierCurveTo(159,172,119,149,108,134);g.closePath();g.fillStyle='rgba(255,211,35,.98)';g.fill();var gr=g.createLinearGradient(0,0,240,0);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.35,'rgba(255,255,224,.98)');gr.addColorStop(1,'rgba(255,235,125,0)');g.fillStyle=gr;g.beginPath();g.moveTo(4,126);g.bezierCurveTo(76,109,138,112,242,130);g.bezierCurveTo(143,147,72,143,4,132);g.closePath();g.fill();},true);
  _cmzFrontTex=_cmzTex(256,256,function(g){var cx=128,cy=128;for(var i=0;i<18;i++){var a=i/18*TAU,r0=i%2?49:58,r1=i%3===0?122:92,w=.035;g.beginPath();g.moveTo(cx+Math.cos(a-w)*r0,cy+Math.sin(a-w)*r0);g.lineTo(cx+Math.cos(a)*r1,cy+Math.sin(a)*r1);g.lineTo(cx+Math.cos(a+w)*r0,cy+Math.sin(a+w)*r0);g.closePath();g.fillStyle=i%2?'rgba(255,103,15,.9)':'rgba(255,190,25,.95)';g.fill();}var r=g.createRadialGradient(cx,cy,0,cx,cy,75);r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.34,'rgba(255,255,215,1)');r.addColorStop(.68,'rgba(255,188,31,.92)');r.addColorStop(1,'rgba(255,80,8,0)');g.fillStyle=r;g.fillRect(45,45,166,166);},true);
  _cmzSmokeTex=_cmzTex(1024,512,function(g){
    /* FX1/FX2:左半爆烟A2 2x2/右半上飘烟A2 2x2 */
    function burst(x,y,sd,sh){_fxA2(g,x,y,100,sd,150,160,170,sh);_fxA2(g,x+20,y+24,56,sd+9,110,120,132,0);}
    burst(128,128,0xC2B0,0);burst(384,128,0xC2B1,2);burst(128,384,0xC2B2,1);burst(384,384,0xC2B3,3);
    /* Reserve the right half; small blast smoke uses left frames 0–3. */
  },false);
  _cmzIllumTex=_cmzTex(128,128,function(g){var r=g.createRadialGradient(64,64,0,64,64,63);r.addColorStop(0,'rgba(255,255,235,.88)');r.addColorStop(.24,'rgba(255,226,130,.50)');r.addColorStop(.62,'rgba(255,151,42,.17)');r.addColorStop(1,'rgba(255,108,20,0)');g.fillStyle=r;g.fillRect(0,0,128,128);},true);
}
var CMZ_VERT=['attribute float iAlpha;varying vec2 vUv;varying float vA;','#include <common>','#include <logdepthbuf_pars_vertex>','void main(){vUv=uv;vA=iAlpha;vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;','#include <logdepthbuf_vertex>','}'].join('\n');
var CMZ_FRAG=['uniform sampler2D map;uniform float uBoost;varying vec2 vUv;varying float vA;','#include <logdepthbuf_pars_fragment>','void main(){','#include <logdepthbuf_fragment>','vec4 t=texture2D(map,vUv);float a=t.a*vA;if(a<.012)discard;gl_FragColor=vec4(t.rgb*uBoost,a);}'].join('\n');
var CMZS_VERT=['attribute vec4 iUvRect;attribute float iAlpha;varying vec2 vUv;varying float vA;','#include <common>','#include <logdepthbuf_pars_vertex>','void main(){vUv=iUvRect.xy+uv*iUvRect.zw;vA=iAlpha;vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;','#include <logdepthbuf_vertex>','}'].join('\n');
function _cmzMakeMesh(geo,tex,blend,boost,order,cap,uvAtlas){var aa=new Float32Array(cap);geo.setAttribute('iAlpha',new THREE.InstancedBufferAttribute(aa,1).setUsage(THREE.DynamicDrawUsage));var uvA=null;if(uvAtlas){uvA=new Float32Array(cap*4);geo.setAttribute('iUvRect',new THREE.InstancedBufferAttribute(uvA,4).setUsage(THREE.DynamicDrawUsage));}var mat=new THREE.ShaderMaterial({uniforms:{map:{value:tex},uBoost:{value:boost}},vertexShader:uvAtlas?CMZS_VERT:CMZ_VERT,fragmentShader:CMZ_FRAG,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,blending:blend,toneMapped:false,fog:false});var mesh=new THREE.InstancedMesh(geo,mat,cap);mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;mesh.renderOrder=order;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(mesh);return {mesh:mesh,alpha:aa,uv:uvA};}
function _cmzEnsure(){if(_cmzPool||!scene)return;_cmzBuildTex();var p1=new THREE.PlaneGeometry(1,1),p2=new THREE.PlaneGeometry(1,1),m2=new THREE.Matrix4().makeRotationX(Math.PI*.5),cross2=mergeGeometries([{geo:p1,m4:new THREE.Matrix4()},{geo:p2,m4:m2}],false,false,false);p1.dispose();p2.dispose();
  var illumGeo=new THREE.PlaneGeometry(1,1);illumGeo.rotateX(-Math.PI*.5); // 单水平片;每次事件写车体和地面两个实例
  var A=_cmzMakeMesh(cross2,_cmzSideTex,THREE.AdditiveBlending,1.15,17,CMZ_POOL,false),B=_cmzMakeMesh(new THREE.PlaneGeometry(1,1),_cmzFrontTex,THREE.AdditiveBlending,1.25,18,CMZ_POOL,false),C=_cmzMakeMesh(new THREE.PlaneGeometry(1,1),_cmzSmokeTex,THREE.NormalBlending,1,15,CMZ_SMOKE_CAP,true),D=_cmzMakeMesh(illumGeo,_cmzIllumTex,THREE.AdditiveBlending,1.12,16,CMZ_ILLUM_CAP,false);
  _cmzSideMesh=A.mesh;_cmzSideA=A.alpha;_cmzFrontMesh=B.mesh;_cmzFrontA=B.alpha;_cmzSmokeMesh=C.mesh;_cmzSmokeA=C.alpha;_cmzSmokeUvA=C.uv;_cmzIllumMesh=D.mesh;_cmzIllumA=D.alpha;_cmzPool=[];
  for(var i=0;i<CMZ_POOL;i++)_cmzPool.push({on:false,age:0,life:1.82,len:7,rot:0,px:0,py:0,pz:0,dx:0,dy:0,dz:1,anchor:null,puffBorn:false,puffAge:0,puffDead:false,wx:0,wy:0,wz:0,bx:0,by:0,bz:0,gx:0,gy:0,gz:0,bodyQ:new THREE.Quaternion(),bVar:0,sVar:0});}
function comicMuzzleBurst(pos,dir,len,anchor,owner){if(!pos||!dir)return;_cmzEnsure();if(!_cmzPool)return;var it=null;for(var i=0;i<CMZ_POOL;i++){var q=_cmzPool[(_cmzRing+i)%CMZ_POOL];if(!q.on){it=q;_cmzRing=(_cmzRing+i+1)%CMZ_POOL;break;}}if(!it){it=_cmzPool[_cmzRing];_cmzRing=(_cmzRing+1)%CMZ_POOL;}if(!it.on)_cmzLive++;_cmzZeroed=false;
  it.on=true;it.age=0;it.life=1.82;it.len=(len||3.2)*2.15;it.rot=(Math.random()-.5)*.25;it.px=pos.x;it.py=pos.y;it.pz=pos.z;it.dx=dir.x;it.dy=dir.y;it.dz=dir.z;it.anchor=anchor||null;it.puffBorn=false;it.puffAge=0;it.bVar=(Math.random()*4)|0;it.sVar=(Math.random()*4)|0;it.own=owner||null;it.puffDead=false;for(var qi=0;qi<CMZ_POOL;qi++){var qq=_cmzPool[qi];if(it.own&&qq!==it&&qq.on&&qq.own===it.own)qq.puffDead=true;}
  if(owner&&owner.group){var gp=owner.group.position;it.bx=pos.x*.46+gp.x*.54;it.by=gp.y+1.34;it.bz=pos.z*.46+gp.z*.54;owner.group.getWorldQuaternion(it.bodyQ);}else{it.bx=pos.x-dir.x*1.5;it.by=pos.y-.9;it.bz=pos.z-dir.z*1.5;it.bodyQ.identity();}
  it.gx=pos.x;it.gz=pos.z;it.gy=(typeof terrainH==='function'?terrainH(pos.x,pos.z):pos.y-2)+.065;
}
function _cmzSet(mesh,alphaA,index,matrix,alpha){mesh.setMatrixAt(index,matrix);alphaA[index]=Math.max(0,alpha);}
function _cmzUpload(mesh,alphaA,count,uvA){mesh.count=count;mesh.visible=count>0;if(!count)return;var im=mesh.instanceMatrix;im.updateRange.offset=0;im.updateRange.count=count*16;im.needsUpdate=true;var a=mesh.geometry.attributes.iAlpha;a.updateRange.offset=0;a.updateRange.count=count;a.needsUpdate=true;if(uvA){var u=mesh.geometry.attributes.iUvRect;u.updateRange.offset=0;u.updateRange.count=count*4;u.needsUpdate=true;}}
function _cmzSmokeSet(index,frame,matrix,alpha){_cmzSet(_cmzSmokeMesh,_cmzSmokeA,index,matrix,alpha);var f=_cmzSmokeFrames[frame],o=index*4;_cmzSmokeUvA[o]=f[0];_cmzSmokeUvA[o+1]=f[1];_cmzSmokeUvA[o+2]=f[2];_cmzSmokeUvA[o+3]=f[3];}
function _comicMuzzleUpdate(dt){if(!_cmzPool)return;
  /* 休眠早退(触发器化):战场安静期(无在放炮口特效)零池扫描;_cmzLive→0 后先跑一帧清零收尾
     (实例 count 归零/网格隐藏),之后休眠直到下一次 comicMuzzleBurst 事件唤醒。 */
  if(!_cmzLive&&_cmzZeroed)return;
  var fireOut=0,smokeOut=0,illumOut=0,flashAny=false;for(var i=0;i<CMZ_POOL;i++){var it=_cmzPool[i];if(!it.on)continue;it.age+=dt;var k=it.age/it.life;if(k>=1){it.on=false;_cmzLive--;continue;}
    /* 后续小爆烟出生边沿只读取一次实时炮口世界位置;之后完全使用快照,不做逐帧炮口检测。 */
    if(!it.puffBorn&&!it.puffDead&&it.age>=.5){if(it.anchor&&it.anchor.getWorldPosition){it.anchor.getWorldPosition(_cmzAnchorP);it.wx=_cmzAnchorP.x;it.wy=_cmzAnchorP.y;it.wz=_cmzAnchorP.z;}else{it.wx=it.px;it.wy=it.py;it.wz=it.pz;}it.puffBorn=true;it.puffAge=0;}else if(it.puffBorn)it.puffAge+=dt;
    if(it.age<.16)flashAny=true;var flashK=Math.min(1,it.age/.12),flashFade=Math.max(0,1-it.age/.15),pop=.35+.75*(1-Math.pow(1-flashK,3));
    _cmzQ.setFromUnitVectors(_cmzX,_cmzDir.set(it.dx,it.dy,it.dz));_cmzPos.set(it.px+it.dx*it.len*.47,it.py+it.dy*it.len*.47,it.pz+it.dz*it.len*.47);_cmzScale.set(it.len*pop,it.len*.72*pop,1);_cmzM1.compose(_cmzPos,_cmzQ,_cmzScale);_cmzSet(_cmzSideMesh,_cmzSideA,fireOut,_cmzM1,flashFade);
    comicTextureFace(_cmzQ,it.px,it.py,it.pz,COMIC_FACE_CAMERA);_cmzRollQ.setFromAxisAngle(_cmzZ,it.rot);_cmzQ.multiply(_cmzRollQ);_cmzPos.set(it.px+it.dx*.08,it.py+it.dy*.08,it.pz+it.dz*.08);_cmzScale.set(5.4*pop,5.4*pop,1);_cmzM2.compose(_cmzPos,_cmzQ,_cmzScale);_cmzSet(_cmzFrontMesh,_cmzFrontA,fireOut,_cmzM2,flashFade);fireOut++;
    /* 亮度贴图只在开火事件快照处淡出:一个贴车体甲板,一个贴炮口下方地面。 */
    if(it.age<.18){var lf=1-it.age/.18;_cmzPos.set(it.bx,it.by,it.bz);_cmzScale.set(7.5,1,5.5);_cmzM4.compose(_cmzPos,it.bodyQ,_cmzScale);_cmzSet(_cmzIllumMesh,_cmzIllumA,illumOut++,_cmzM4,.30*lf);
      _cmzQ.identity();_cmzPos.set(it.gx,it.gy,it.gz);_cmzScale.set(12,1,12);_cmzM4.compose(_cmzPos,_cmzQ,_cmzScale);_cmzSet(_cmzIllumMesh,_cmzIllumA,illumOut++,_cmzM4,.22*lf);}
    if(it.age<1.02){var ME=comicSmokeExpand(Math.max(0,it.age-.045),.93,.12,3.34,.62,.72,1.1,0),sk=ME.k;comicTextureFace(_cmzQ,it.px,it.py,it.pz,COMIC_FACE_CAMERA);_cmzRollQ.setFromAxisAngle(_cmzZ,it.rot*.35);_cmzQ.multiply(_cmzRollQ);_cmzPos.set(it.px+it.dx*(.55+1.4*sk),it.py+it.dy*(.55+1.4*sk)+ME.rise,it.pz+it.dz*(.55+1.4*sk));var ss=2.4*ME.scale;_cmzScale.set(ss,ss,1);_cmzM3.compose(_cmzPos,_cmzQ,_cmzScale);_cmzSmokeSet(smokeOut++,it.bVar,_cmzM3,.72*ME.alpha);}
    if(it.puffBorn){var WE=comicSmokeExpand(it.puffAge,it.life-.5,.10,1.78,.75,.62,1.7,0),wk=WE.k;comicTextureFace(_cmzQ,it.wx,it.wy,it.wz,COMIC_FACE_CAMERA);var ps=1.2*WE.scale;_cmzPos.set(it.wx,it.wy+WE.rise,it.wz);_cmzScale.set(ps,ps,1);_cmzM3.compose(_cmzPos,_cmzQ,_cmzScale);_cmzSmokeSet(smokeOut++,it.sVar,_cmzM3,.62*WE.alpha);}}
  _cmzUpload(_cmzSideMesh,_cmzSideA,fireOut);_cmzUpload(_cmzFrontMesh,_cmzFrontA,fireOut);_cmzUpload(_cmzIllumMesh,_cmzIllumA,illumOut);_cmzUpload(_cmzSmokeMesh,_cmzSmokeA,smokeOut,_cmzSmokeUvA);
  _cmzSideMesh.visible=_cmzFrontMesh.visible=flashAny&&fireOut>0;_cmzIllumMesh.visible=illumOut>0;
  if(!_cmzLive)_cmzZeroed=true;}   // 清零收尾帧完成→休眠(下一次 comicMuzzleBurst 事件唤醒)

/* ============================================================
   漫画特效:炮弹命中三类型(事件触发,无目标轮询)
   · pen/over:暖白黄橙中空尖刺火星环;
   · stop:纯白短促闪光;
   · env:灰褐手绘炮弹烟云(地面/障碍等非载具目标)。
   火光与白闪共用一只 additive atlas InstancedMesh;烟云单独一只 normal-blend
   InstancedMesh。命中类型直接消费现有碰撞分支结果,不新增射线或逐帧目标检测。
   ============================================================ */
var CHI_CAP=64,CHI_RING=0,CHI_WHITE=1,_chiTex=null,_chiGeo=null,_chiMat=null,_chiMesh=null,_chiPool=[],_chiRing=0,_chiCount=0,_chiLive=0;
var _chiUvA=null,_chiAlphaA=null,_chiTintA=null,_chiM4=new THREE.Matrix4(),_chiQ=new THREE.Quaternion(),_chiRollQ=new THREE.Quaternion();
var _chiPos=new THREE.Vector3(),_chiScale=new THREE.Vector3(),_chiZ=new THREE.Vector3(0,0,1);
var _chiFrames=[[.010,.020,.480,.960],[.510,.020,.480,.960]];
function _chiMakeTex(){
  var cv=document.createElement('canvas');cv.width=512;cv.height=256;var g=cv.getContext('2d');g.clearRect(0,0,512,256);g.lineJoin='round';g.lineCap='round';
  function fireCell(){var rnd=mulberry32(0xC117F1),cx=128,cy=128,n=22,outer=[];   // 帧0命中火环格(与 whiteCell=帧1白闪格成对)
    for(var i=0;i<n;i++){var a=i/n*TAU,r=72*(.86+rnd()*.20);outer.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r]);}
    for(i=0;i<18;i++){var a2=i/18*TAU+(rnd()-.5)*.10,r0=62+rnd()*8,r1=88+rnd()*38,w=.025+rnd()*.030;
      g.beginPath();g.moveTo(cx+Math.cos(a2-w)*r0,cy+Math.sin(a2-w)*r0);g.lineTo(cx+Math.cos(a2)*r1,cy+Math.sin(a2)*r1);g.lineTo(cx+Math.cos(a2+w)*r0,cy+Math.sin(a2+w)*r0);g.closePath();g.fillStyle='#6b2108';g.fill();
      var r2=r0+3,r3=r1-5,w2=w*.48;g.beginPath();g.moveTo(cx+Math.cos(a2-w2)*r2,cy+Math.sin(a2-w2)*r2);g.lineTo(cx+Math.cos(a2)*r3,cy+Math.sin(a2)*r3);g.lineTo(cx+Math.cos(a2+w2)*r2,cy+Math.sin(a2+w2)*r2);g.closePath();g.fillStyle=i%3===0?'#fff3ad':(i%2?'#ff8b20':'#ffd52b');g.fill();}
    function disk(points,color){g.beginPath();g.moveTo(points[0][0],points[0][1]);for(var j=1;j<points.length;j++)g.lineTo(points[j][0],points[j][1]);g.closePath();g.fillStyle=color;g.fill();}
    function pts(rad,jit,seed){var rr=mulberry32(seed),p=[];for(var j=0;j<n;j++){var aa=j/n*TAU,r=rad*(1-jit+rr()*jit*2);p.push([cx+Math.cos(aa)*r,cy+Math.sin(aa)*r]);}return p;}
    disk(outer,'#7a2708');disk(pts(68,.07,0x11),'#ff6817');disk(pts(59,.065,0x22),'#ffd326');disk(pts(49,.055,0x33),'#fff3ae');
    g.globalCompositeOperation='destination-out';disk(pts(38,.09,0x44),'rgba(0,0,0,1)');g.globalCompositeOperation='source-over';g.strokeStyle='rgba(255,255,245,.98)';g.lineWidth=4;
    for(i=0;i<9;i++){var aa=i/9*TAU+.12;g.beginPath();g.moveTo(cx+Math.cos(aa)*43,cy+Math.sin(aa)*43);g.lineTo(cx+Math.cos(aa)*65,cy+Math.sin(aa)*65);g.stroke();}}
  function whiteCell(){var cx=128,cy=128,gr=g.createRadialGradient(cx,cy,0,cx,cy,94);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.28,'rgba(255,255,255,.98)');gr.addColorStop(.62,'rgba(255,250,226,.62)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(24,24,208,208);
    for(var i=0;i<14;i++){var a=i/14*TAU,r0=45,r1=i%3===0?108:82,w=.025+(i%2)*.012;g.beginPath();g.moveTo(cx+Math.cos(a-w)*r0,cy+Math.sin(a-w)*r0);g.lineTo(cx+Math.cos(a)*r1,cy+Math.sin(a)*r1);g.lineTo(cx+Math.cos(a+w)*r0,cy+Math.sin(a+w)*r0);g.closePath();g.fillStyle='rgba(255,255,255,.92)';g.fill();}
    g.beginPath();g.arc(cx,cy,46,0,TAU);g.fillStyle='rgba(255,255,255,1)';g.fill();}
  g.save();fireCell();g.restore();g.save();g.translate(256,0);whiteCell();g.restore();
  var tx=new THREE.CanvasTexture(cv);tx.minFilter=THREE.LinearFilter;tx.magFilter=THREE.LinearFilter;tx.generateMipmaps=false;return tx;
}
var CHI_VERT=[
  'attribute vec4 iUvRect;attribute float iAlpha;attribute vec3 iTint;varying vec2 vUv;varying float vA;varying vec3 vTint;',
  '#include <common>','#include <logdepthbuf_pars_vertex>',
  'void main(){vUv=iUvRect.xy+uv*iUvRect.zw;vA=iAlpha;vTint=iTint;vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;','#include <logdepthbuf_vertex>','}'
].join('\n');
var CHI_FRAG=[
  'uniform sampler2D map;varying vec2 vUv;varying float vA;varying vec3 vTint;','#include <logdepthbuf_pars_fragment>',
  'void main(){','#include <logdepthbuf_fragment>','vec4 t=texture2D(map,vUv);float a=t.a*vA;if(a<.015)discard;gl_FragColor=vec4(t.rgb*vTint*1.45,a);}'
].join('\n');
function _chiEnsure(){if(_chiMesh||!scene)return;_chiTex=_chiMakeTex();_chiGeo=new THREE.PlaneGeometry(1,1);_chiUvA=new Float32Array(CHI_CAP*4);_chiAlphaA=new Float32Array(CHI_CAP);_chiTintA=new Float32Array(CHI_CAP*3);
  _chiGeo.setAttribute('iUvRect',new THREE.InstancedBufferAttribute(_chiUvA,4).setUsage(THREE.DynamicDrawUsage));_chiGeo.setAttribute('iAlpha',new THREE.InstancedBufferAttribute(_chiAlphaA,1).setUsage(THREE.DynamicDrawUsage));_chiGeo.setAttribute('iTint',new THREE.InstancedBufferAttribute(_chiTintA,3).setUsage(THREE.DynamicDrawUsage));
  _chiMat=new THREE.ShaderMaterial({uniforms:{map:{value:_chiTex}},vertexShader:CHI_VERT,fragmentShader:CHI_FRAG,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false,fog:false});
  _chiMesh=new THREE.InstancedMesh(_chiGeo,_chiMat,CHI_CAP);_chiMesh.count=0;_chiMesh.visible=false;_chiMesh.frustumCulled=false;_chiMesh.renderOrder=15;_chiMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(_chiMesh);
  for(var i=0;i<CHI_CAP;i++)_chiPool.push({on:false,frame:0,age:0,life:.28,x:0,y:0,z:0,size:2.5,rot:0,r:1,g:1,b:1});}
function _chiSpawn(p,nWorld,type){_chiEnsure();if(!_chiMesh)return;var it=null;for(var i=0;i<CHI_CAP;i++){var q=_chiPool[(_chiRing+i)%CHI_CAP];if(!q.on){it=q;_chiRing=(_chiRing+i+1)%CHI_CAP;break;}}if(!it){it=_chiPool[_chiRing];_chiRing=(_chiRing+1)%CHI_CAP;}
  var wasOn=it.on,nx=nWorld&&isFinite(nWorld.x)?nWorld.x:0,ny=nWorld&&isFinite(nWorld.y)?nWorld.y:1,nz=nWorld&&isFinite(nWorld.z)?nWorld.z:0;it.x=p.x+nx*.055;it.y=p.y+ny*.055;it.z=p.z+nz*.055;it.age=0;it.rot=(Math.random()-.5)*.38;it.on=true;if(!wasOn)_chiLive++;
  if(type==='stop'){it.frame=CHI_WHITE;it.life=.17;it.size=2.75;it.r=1;it.g=1;it.b=1;}
  else{it.frame=CHI_RING;if(type==='over'){it.life=.34;it.size=3.15;it.r=1;it.g=.92;it.b=.72;}else{it.life=.26;it.size=2.65;it.r=1;it.g=1;it.b=.90;}}}

var CHS_CAP=48,_chsTex=null,_chsGeo=null,_chsMat=null,_chsMesh=null,_chsPool=[],_chsRing=0,_chsCount=0,_chsLive=0;
var _chsAlphaA=null,_chsTintA=null,_chsUvA=null;
function _chsMakeTex(){var cv=document.createElement('canvas');cv.width=cv.height=512;var g=cv.getContext('2d');g.clearRect(0,0,512,512);g.lineJoin='round';g.lineCap='round';
  /* FX7-CHS:命中环境烟2x2(格0-2新绘H0-2,格3=H0镜像备) */
  var i,_cell=[[0,0,0],[256,0,1],[0,256,2]];
  for(i=0;i<3;i++){g.save();g.translate(_cell[i][0],_cell[i][1]);paintCHS(g,_cell[i][2]);g.restore();}
  g.save();g.translate(512,256);g.scale(-1,1);paintCHS(g,0);g.restore();
  var tx=new THREE.CanvasTexture(cv);tx.minFilter=THREE.LinearMipmapLinearFilter;tx.magFilter=THREE.LinearFilter;tx.generateMipmaps=true;return tx;}
var _chsFrames=[[.018,.518,.464,.464],[.518,.518,.464,.464],[.018,.018,.464,.464],[.518,.018,.464,.464]];
var CHS_VERT=[
  'attribute vec4 iUvRect;attribute float iAlpha;attribute vec3 iTint;varying vec2 vUv;varying float vA;varying vec3 vTint;',
  '#include <common>','#include <logdepthbuf_pars_vertex>','void main(){vUv=iUvRect.xy+uv*iUvRect.zw;vA=iAlpha;vTint=iTint;vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;','#include <logdepthbuf_vertex>','}'
].join('\n');
var CHS_FRAG=[
  'uniform sampler2D map;varying vec2 vUv;varying float vA;varying vec3 vTint;','#include <logdepthbuf_pars_fragment>','void main(){','#include <logdepthbuf_fragment>','vec4 t=texture2D(map,vUv);float a=t.a*vA;if(a<.018)discard;gl_FragColor=vec4(t.rgb*vTint,a);}'
].join('\n');
function _chsEnsure(){if(_chsMesh||!scene)return;_chsTex=_chsMakeTex();_chsGeo=new THREE.PlaneGeometry(1,1);_chsAlphaA=new Float32Array(CHS_CAP);_chsTintA=new Float32Array(CHS_CAP*3);_chsUvA=new Float32Array(CHS_CAP*4);
  _chsGeo.setAttribute('iAlpha',new THREE.InstancedBufferAttribute(_chsAlphaA,1).setUsage(THREE.DynamicDrawUsage));_chsGeo.setAttribute('iUvRect',new THREE.InstancedBufferAttribute(_chsUvA,4).setUsage(THREE.DynamicDrawUsage));_chsGeo.setAttribute('iTint',new THREE.InstancedBufferAttribute(_chsTintA,3).setUsage(THREE.DynamicDrawUsage));
  _chsMat=new THREE.ShaderMaterial({uniforms:{map:{value:_chsTex}},vertexShader:CHS_VERT,fragmentShader:CHS_FRAG,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,blending:THREE.NormalBlending,toneMapped:false,fog:false});
  _chsMesh=new THREE.InstancedMesh(_chsGeo,_chsMat,CHS_CAP);_chsMesh.count=0;_chsMesh.visible=false;_chsMesh.frustumCulled=false;_chsMesh.renderOrder=14;_chsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(_chsMesh);
  for(var i=0;i<CHS_CAP;i++)_chsPool.push({on:false,age:0,life:.78,x:0,y:0,z:0,size:3,rot:0,r:1,g:1,b:1,var:0});}
function _chsSpawn(p,nWorld){_chsEnsure();if(!_chsMesh)return;var it=null;for(var i=0;i<CHS_CAP;i++){var q=_chsPool[(_chsRing+i)%CHS_CAP];if(!q.on){it=q;_chsRing=(_chsRing+i+1)%CHS_CAP;break;}}if(!it){it=_chsPool[_chsRing];_chsRing=(_chsRing+1)%CHS_CAP;}
  var wasOn=it.on,nx=nWorld&&isFinite(nWorld.x)?nWorld.x:0,ny=nWorld&&isFinite(nWorld.y)?nWorld.y:1,nz=nWorld&&isFinite(nWorld.z)?nWorld.z:0;it.x=p.x+nx*.04;it.y=p.y+ny*.04;it.z=p.z+nz*.04;it.age=0;it.life=.72+Math.random()*.18;it.size=(2.8+Math.random()*.55)*_sfxJit();it.rot=(Math.random()-.5)*.28;it.var=(Math.random()*3)|0;it.r=.92;it.g=.86;it.b=.76;it.on=true;if(!wasOn)_chsLive++;}
function comicHitSpark(p,nWorld,rayDir,type){if(!p)return;if(type==='env')_chsSpawn(p,nWorld);else _chiSpawn(p,nWorld,type);}
function _comicHitUpdate(dt){
  if(_chiMesh&&_chiLive>0){_chiCount=0;for(var i=0;i<CHI_CAP;i++){var it=_chiPool[i];if(!it.on)continue;it.age+=dt;var k=it.age/it.life;if(k>=1){it.on=false;_chiLive--;continue;}
      var pop,fade;if(it.frame===CHI_WHITE){pop=.55+Math.min(1,k/.28)*.75;fade=Math.pow(1-k,.58);}else{pop=k<.22?.34+k/.22*.86:1.20-(k-.22)*.22/.78;fade=k<.55?1:Math.pow((1-k)/.45,.72);}
      comicTextureFace(_chiQ,it.x,it.y,it.z,COMIC_FACE_CAMERA);_chiRollQ.setFromAxisAngle(_chiZ,it.rot+(it.frame===CHI_RING?k*.18:0));_chiQ.multiply(_chiRollQ);_chiPos.set(it.x,it.y,it.z);_chiScale.set(it.size*pop,it.size*pop,1);_chiM4.compose(_chiPos,_chiQ,_chiScale);_chiMesh.setMatrixAt(_chiCount,_chiM4);
      var fr=_chiFrames[it.frame],o4=_chiCount*4,o3=_chiCount*3;_chiUvA[o4]=fr[0];_chiUvA[o4+1]=fr[1];_chiUvA[o4+2]=fr[2];_chiUvA[o4+3]=fr[3];_chiAlphaA[_chiCount]=fade;_chiTintA[o3]=it.r;_chiTintA[o3+1]=it.g;_chiTintA[o3+2]=it.b;_chiCount++;}
    _chiMesh.count=_chiCount;_chiMesh.visible=_chiCount>0;if(_chiCount){var im=_chiMesh.instanceMatrix;im.updateRange.offset=0;im.updateRange.count=_chiCount*16;im.needsUpdate=true;var uv=_chiGeo.attributes.iUvRect,a=_chiGeo.attributes.iAlpha,c=_chiGeo.attributes.iTint;uv.updateRange.offset=0;uv.updateRange.count=_chiCount*4;a.updateRange.offset=0;a.updateRange.count=_chiCount;c.updateRange.offset=0;c.updateRange.count=_chiCount*3;uv.needsUpdate=a.needsUpdate=c.needsUpdate=true;}}
  if(_chsMesh&&_chsLive>0){_chsCount=0;for(var j=0;j<CHS_CAP;j++){var s=_chsPool[j];if(!s.on)continue;s.age+=dt;if(s.age>=s.life){s.on=false;_chsLive--;continue;}var HE=comicSmokeExpand(s.age,s.life,.10,1.94,.62,.72,.75,0),u=HE.k,grow=.72*HE.scale,al=HE.alpha;
      comicTextureFace(_chiQ,s.x,s.y,s.z,COMIC_FACE_CAMERA);_chiRollQ.setFromAxisAngle(_chiZ,s.rot);_chiQ.multiply(_chiRollQ);_chiPos.set(s.x,s.y+HE.rise,s.z);_chiScale.set(s.size*grow,s.size*grow,1);_chiM4.compose(_chiPos,_chiQ,_chiScale);_chsMesh.setMatrixAt(_chsCount,_chiM4);_chsAlphaA[_chsCount]=al;_fxUvW(_chsUvA,_chsCount,_chsFrames,s.var);var oo=_chsCount*3;_chsTintA[oo]=s.r;_chsTintA[oo+1]=s.g;_chsTintA[oo+2]=s.b;_chsCount++;}
    _chsMesh.count=_chsCount;_chsMesh.visible=_chsCount>0;if(_chsCount){var sm=_chsMesh.instanceMatrix;sm.updateRange.offset=0;sm.updateRange.count=_chsCount*16;sm.needsUpdate=true;var sa=_chsGeo.attributes.iAlpha,sc=_chsGeo.attributes.iTint,su=_chsGeo.attributes.iUvRect;sa.updateRange.offset=0;sa.updateRange.count=_chsCount;sc.updateRange.offset=0;sc.updateRange.count=_chsCount*3;su.updateRange.offset=0;su.updateRange.count=_chsCount*4;sa.needsUpdate=sc.needsUpdate=su.needsUpdate=true;}}
}

/* ============================================================
   漫画特效:发动机排烟、烟雾飘散与通用双履带行进扬尘
   ----------------------------------------------------------------
   · 零点粒子;每辆合格载具最多 2 张发动机烟 +
     3 批次×左右履带大尘团,共用 ONE InstancedMesh。
   · 贴图 3 格:发动机厚烟/发动机飘散/通用大扬尘。
   · 固定世界尺寸,不读取相机距离、炮镜倍率或 LOD 缩放。
   · 可见性不是逐车逐帧检测:炮镜切换触发立即刷新;相机累计移动 8m 触发;
     相机转向与移动目标由第三人称 120ms、炮镜 50ms 的低频扫描吸收。
   ============================================================ */
var CSM_MAX_VEH = 1024, CSM_PER_VEH = 8, CSM_CAP = CSM_MAX_VEH * CSM_PER_VEH; // 2发动机烟 + 最多3批×双履带尘
var CSM_ENGINE = 0, CSM_ENGINE_B = 1, CSM_ENGINE_C = 2, CSM_DUST = 3, CSM_DUST_B = 4, CSM_DUST_C = 5;   // FX7:3x2(上行发动机烟0-2/下行行进尘3-5)
var _csmTex = null, _csmGeo = null, _csmMat = null, _csmMesh = null;
var _csmVehicles = [], _csmVisible = [], _csmActive = 0, _csmClock = 0, _csmVisDirty = true;
var _csmUvA = null, _csmAlphaA = null, _csmTintA = null, _csmDebugFrame = new Uint8Array(CSM_CAP);
var _csmM4 = new THREE.Matrix4(), _csmQ = new THREE.Quaternion();
var _csmPos = new THREE.Vector3(), _csmScale = new THREE.Vector3();
var _csmSrc = new THREE.Vector3();
var _csmVisP = new THREE.Vector3();
var _csmFrames = [
  [0.012, 0.518, 0.309, 0.464], [0.345, 0.518, 0.309, 0.464], [0.679, 0.518, 0.309, 0.464],
  [0.012, 0.018, 0.309, 0.464], [0.345, 0.018, 0.309, 0.464], [0.679, 0.018, 0.309, 0.464]
];
var _csmVis = {ready:false,scoped:false,nextAt:0,cx:0,cy:0,cz:0};
var CSM_SCOPE_R = 22;                 // 炮镜全屏矩形门米级余量(m):车体 ~7m + 尾烟/履带尘外延 ~15m

function _csmMakeAtlas() {
  var cv=document.createElement('canvas');cv.width=768;cv.height=512;var g=cv.getContext('2d');g.clearRect(0,0,768,512);g.lineJoin='round';g.lineCap='round';
  /* FX7-CSM:3x2(上行发动机烟E0-2/下行行进尘D0-2;tint着色) */
  var i;
  for(i=0;i<3;i++){g.save();g.translate(i*256,0);paintCSM_E(g,i);g.restore();}
  for(i=0;i<3;i++){g.save();g.translate(i*256,256);paintCSM_D(g,i);g.restore();}
  var tx=new THREE.CanvasTexture(cv);tx.minFilter=THREE.LinearFilter;tx.magFilter=THREE.LinearFilter;tx.generateMipmaps=false;return tx;
}
var CSM_VERT=[
  'attribute vec4 iUvRect;attribute float iAlpha;attribute vec3 iTint;',
  'varying vec2 vUv;varying float vA;varying vec3 vTint;varying float vZ;',
  '#include <common>','#include <logdepthbuf_pars_vertex>',
  'void main(){vUv=iUvRect.xy+uv*iUvRect.zw;vA=iAlpha;vTint=iTint;vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.0);vZ=-mv.z;gl_Position=projectionMatrix*mv;','#include <logdepthbuf_vertex>','}'
].join('\n');
var CSM_FRAG=[
  'uniform sampler2D map;uniform vec2 uFog;uniform vec3 uFogCol;uniform float uTherm;uniform float uTG;uniform float uTGE;varying vec2 vUv;varying float vA;varying vec3 vTint;varying float vZ;',
  '#include <logdepthbuf_pars_fragment>','void main(){','#include <logdepthbuf_fragment>',
  /* 热像分支(uniform 分支,uCrt/uThermal 同口径):行进烟整族=地面档平灰(墨线/土色 tint 不参与热度),
     颜色预乘 α 供 MAX 混合(EXT_blend_minmax 忽略混合因子,预乘后软边保留)。 */
  'vec4 t=texture2D(map,vUv);float a=t.a*vA;if(a<.018)discard;float f=smoothstep(uFog.x,uFog.y,vZ);',
  'vec3 c=uTherm>0.5?mix(vec3(vUv.y>0.5?uTGE:uTG),uFogCol,f)*min(a*1.9,1.0):mix(t.rgb*vTint,uFogCol,f);',   // 双热度档:atlas 上行(vUv.y>0.5)=发动机排烟 uTGE,下行=履带尘 uTG;α饱和×1.9=厚核落档、薄边渐隐,上限钳死不越档
  'gl_FragColor=vec4(c,a);}'
].join('\n');
/* 热成像双热度档:履带尘=地面档(CSM_THERM_GRAY);发动机排烟(厚烟+飘散)=独立档(CSM_THERM_ENG),
   高于地面、低于活载具(柴油机排气高温,辐射面小于全车)。两档均为场景空间灰度,截图标定:
   地面=草肤实测终值 72;活载具 ~128~138;主合成分档 floor(lC·4+0.5)/4 在 lC=0.375 有台阶
   (输出 82→132 之间为不可达带,132+ 与活载具重叠),故排烟取 band1 顶=0.37(终值 ~82,
   稳居地面之上、载具之下,且留 0.005 边界余量防滤波越档)。
   MAX 混合=辐射口径"取较热者":尘≤地面 ⇒ 压地面处不可见;排烟>地面正常显影;
   凡比烟热的物体(活车/弹体/火光)一律原样透出。边沿写,零逐帧成本。 */
var CSM_THERM_GRAY = 0.274, CSM_THERM_ENG = 0.37, _csmThermV = 0;
function _csmSetThermal(v){
  _csmThermV = v; if(!_csmMat) return;
  _csmMat.uniforms.uTherm.value = v;
  if(v){ _csmMat.blending = THREE.CustomBlending; _csmMat.blendEquation = THREE.MaxEquation;
    _csmMat.blendSrc = THREE.OneFactor; _csmMat.blendDst = THREE.OneFactor;
    _csmMat.blendEquationAlpha = THREE.MaxEquation; _csmMat.blendSrcAlpha = THREE.OneFactor; _csmMat.blendDstAlpha = THREE.OneFactor; }
  else { _csmMat.blending = THREE.NormalBlending; _csmMat.blendEquationAlpha = null; _csmMat.blendSrcAlpha = null; _csmMat.blendDstAlpha = null; }
}
function _csmEnsure(){
  if(_csmMesh||!scene)return;_csmTex=_csmMakeAtlas();_csmGeo=new THREE.PlaneGeometry(1,1);
  _csmUvA=new Float32Array(CSM_CAP*4);_csmAlphaA=new Float32Array(CSM_CAP);_csmTintA=new Float32Array(CSM_CAP*3);
  _csmGeo.setAttribute('iUvRect',new THREE.InstancedBufferAttribute(_csmUvA,4).setUsage(THREE.DynamicDrawUsage));
  _csmGeo.setAttribute('iAlpha',new THREE.InstancedBufferAttribute(_csmAlphaA,1).setUsage(THREE.DynamicDrawUsage));
  _csmGeo.setAttribute('iTint',new THREE.InstancedBufferAttribute(_csmTintA,3).setUsage(THREE.DynamicDrawUsage));
  var fn=900,ff=4300,fc=new THREE.Color(0x8fa3b8);if(scene.fog){fn=scene.fog.near;ff=scene.fog.far;fc=scene.fog.color;}
  _csmMat=new THREE.ShaderMaterial({uniforms:{map:{value:_csmTex},uFog:{value:new THREE.Vector2(fn,ff)},uFogCol:{value:fc},uTherm:{value:0},uTG:{value:CSM_THERM_GRAY},uTGE:{value:CSM_THERM_ENG}},vertexShader:CSM_VERT,fragmentShader:CSM_FRAG,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide});
  _csmMesh=new THREE.InstancedMesh(_csmGeo,_csmMat,CSM_CAP);_csmMesh.count=0;_csmMesh.visible=false;_csmMesh.frustumCulled=false;_csmMesh.renderOrder=6;_csmMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(_csmMesh);
  if(_csmThermV)_csmSetThermal(_csmThermV);   // 建材晚于开镜时补落位(边沿事件,非逐帧)
}
function _csmMakeDustBatches(){var a=[];for(var i=0;i<3;i++)a.push({on:false,age:0,life:2.8,var:0,xL:0,yL:0,zL:0,xR:0,yR:0,zR:0,backX:0,backZ:-1,sideX:1,sideZ:0,v0:2,a:.5,sz:1,col:0xb5a67f});return a;}
function _csmEmitDustBatch(t,spd,sign,digK){
  var B=t._csmDustB[t._csmDustRing];t._csmDustRing=(t._csmDustRing+1)%3;B.on=true;B.age=0;B.life=2.8;B.var=(Math.random()*3)|0;
  var fwdX=Math.sin(t.yaw),fwdZ=Math.cos(t.yaw);B.backX=-fwdX*sign;B.backZ=-fwdZ*sign;B.sideX=Math.cos(t.yaw);B.sideZ=-Math.sin(t.yaw);
  var dg=digK||0;B.v0=1.5+Math.min(spd,12)*.10+dg*1.2;B.a=Math.min(.85,(.34+spd*.032)*(1+dg*.8));B.sz=(1+dg*.9)*_sfxJit();B.col=(typeof startMat!=='undefined'&&startMat==='soil')?0x9b7c58:0xb5a67f;
  var halfW=Math.min(1.38,t.radius*.44),rear=-sign*(t.kind==='arty'?2.35:2.05);
  _csmSrc.set(-halfW,.34,rear);t.group.localToWorld(_csmSrc);B.xL=_csmSrc.x;B.yL=_csmSrc.y;B.zL=_csmSrc.z;
  _csmSrc.set( halfW,.34,rear);t.group.localToWorld(_csmSrc);B.xR=_csmSrc.x;B.yR=_csmSrc.y;B.zR=_csmSrc.z;
}
function comicVehicleMotionSmoke(t,dt){
  if(!t||!t.alive)return;
  if(typeof beltUpdate==='function'&&!isHeliVehicle(t))beltUpdate(t,dt);   // 带速:全存活地面车每帧 spool(帧哨兵)
  if(!t._csmRegistered){t._csmRegistered=true;t._csmSeed=((t.group&&t.group.id||_csmVehicles.length+1)*.61803398875)%1;t._csmRenderSpeed=t.speed||0;t._csmSJit=_sfxJit();
    t._csmDustB=_csmMakeDustBatches();t._csmDustRing=0;t._csmDustEmitT=0;_csmVehicles.push(t);_csmVisDirty=true;}
  /* 直升机飞行不产生地面行进扬尘;地面车辆移动时触发批次 */
  var spd=Math.abs(t.speed||0);
  var digK=(!isHeliVehicle(t)&&typeof trackDigLevel==='function')?trackDigLevel(t):0;   // P3 刨土强度:打滑/空转/侧滑→尘更浓更快
  if(!isHeliVehicle(t)&&t._csmVisible&&(spd>1.1||digK>0.25)){t._csmDustEmitT-=dt*(1+2*digK);if(t._csmDustEmitT<=0){_csmEmitDustBatch(t,Math.max(spd,2.5*digK),Math.sign(t.speed||t._throttle||1),digK);t._csmDustEmitT=.90;}}
  else if((spd<=1.1&&digK<=0.25)||isHeliVehicle(t))t._csmDustEmitT=0;
}
function comicMotionSmokeInvalidate(){_csmVisDirty=true;}
function _csmRefreshVisible(nowS,force){
  if(!camera)return;var sc=typeof scoped!=='undefined'&&scoped;
  var V=_csmVis,dx=camera.position.x-V.cx,dy=camera.position.y-V.cy,dz=camera.position.z-V.cz;
  var move=dx*dx+dy*dy+dz*dz>=64,due=nowS>=V.nextAt,edge=!V.ready||sc!==V.scoped;
  if(!force&&!_csmVisDirty&&!move&&!due&&!edge)return; // 缓存命中:不取相机方向,更不遍历载具
  V.ready=true;V.scoped=sc;V.cx=camera.position.x;V.cy=camera.position.y;V.cz=camera.position.z;V.nextAt=nowS+(sc?.05:.12);_csmVisDirty=false;
  /* 炮镜可见性统一走 map.js scopeScreenVisible(全屏矩形口径),本地不再自算镜圈锥角 */
  _csmVisible.length=0;var write=0,pp=(typeof player!=='undefined'&&player&&player.group)?player.group.position:camera.position;
  camera.updateMatrixWorld();
  for(var i=0;i<_csmVehicles.length;i++){
    var t=_csmVehicles[i];if(!t||!t.alive||!t.group){if(t)t._csmRegistered=false;continue;}_csmVehicles[write++]=t;
    var p=t.group.position,x=p.x,y=p.y+1.5,z=p.z,px=x-pp.x,py=y-pp.y,pz=z-pp.z;
    var near600=px*px+py*py+pz*pz<=360000;
    /* 炮镜分支=通用全屏矩形门(map.js scopeScreenVisible;CSM_SCOPE_R 余量覆盖车体+尾烟外延):
       只有完全在屏幕画面外才不可见,镜框遮罩外的多渲染由遮罩裁剪。 */
    var inScope=sc&&(typeof scopeScreenVisible!=='function'||scopeScreenVisible(x,y,z,CSM_SCOPE_R));
    var inScreen=false;
    if(near600){_csmVisP.set(x,y,z).project(camera);inScreen=_csmVisP.z>=-1&&_csmVisP.z<=1&&Math.abs(_csmVisP.x)<=1.04&&Math.abs(_csmVisP.y)<=1.04;}
    var wasVisible=!!t._csmVisible;t._csmVisible=!!(inScope||(near600&&inScreen));
    if(t._csmVisible){if(!wasVisible)t._csmRenderSpeed=t.speed||0;_csmVisible.push(t);}
  }
  _csmVehicles.length=write;
}
/* 圆柱广告牌:只绕世界 Y 轴追随观察方向,绝不随相机俯仰/横滚而上下左右翻转。
   方向性通过水平镜像 UV 解决:贴图 +U(大烟头)始终落在车辆后方,尖端始终朝发动机。 */
function _csmWrite(frame,x,y,z,sx,sy,alpha,color,alignX,alignZ){
  var out=_csmActive;if(out>=CSM_CAP||alpha<=.005)return;
  var yaw=comicTextureFace(_csmQ,x,y,z,COMIC_FACE_YAW);
  _csmPos.set(x,y,z);_csmScale.set(sx,sy,1);_csmM4.compose(_csmPos,_csmQ,_csmScale);_csmMesh.setMatrixAt(out,_csmM4);
  var fr=_csmFrames[frame],o4=out*4,o3=out*3;
  var rearOnRight=alignX*Math.cos(yaw)-alignZ*Math.sin(yaw),flip=rearOnRight<0;
  _csmUvA[o4]=flip?fr[0]+fr[2]:fr[0];_csmUvA[o4+1]=fr[1];_csmUvA[o4+2]=flip?-fr[2]:fr[2];_csmUvA[o4+3]=fr[3];_csmAlphaA[out]=alpha;
  _csmTintA[o3]=((color>>16)&255)/255;_csmTintA[o3+1]=((color>>8)&255)/255;_csmTintA[o3+2]=(color&255)/255;_csmDebugFrame[out]=frame;_csmActive++;
}
/* ============================================================
   B1 地平线远景硝烟带(战场规模感:画面之外的战争)
   + B2 残骸长驻黑烟柱(战斗痕迹持久化)——战场感 Phase 2。
   合计 +1 draw call(B1 独立 ONE InstancedMesh;B2 并入现有 CSM)。
   · B1:10 实例钉在远景圆周(2km 图严格 half+1800;大图钳入雾幕内保证
     可见),复用 CSM 手绘 atlas(零新增纹理)与 CSM 着色器(雾+对数深度+
     热像双热度档同口径);每帧自同步 scene.fog(A1/黄昏/NVD/热像自动继承,
     从不抢写 scene.fog);漂移比云还慢;castShadow=false 不进阴影 pass。
   · B2:killTank 事件级注册(每残骸 2 卡:浓芯+飘散,源点=残骸中心上方,
     跟随坠机残骸实时位置);发射模型复用发动机烟双卡相位循环但放慢约
     8 倍(缕寿命 7~9.5s),极慢上升、风向定死/残骸、横向 leaning 拉长;
     包络随残骸年龄以 TAU=90s 由浓转薄,下限 FLOOR=0.16 长期驻留;
     上限 999 柱,超限最旧优先熄灭;烟柱细(5~8m 级)不挡战斗可读性。
   · 描边红线:两处均为 transparent+depthWrite:false 软边烟,低频形状
     lumMag 小,不走亮度对比,不触发误描边。
   · 回滚:HZSMOKE_AMT=0/WRSMOKE_AMT=0 → 与改动前逐像素一致。
   ============================================================ */
var HZSMOKE_N=10,HZSMOKE_AMT=1.0;
var _hzMesh=null,_hzMat=null,_hzUvA=null,_hzAlphaA=null,_hzTintA=null,_hzKey='',_hzClock=0,_hzThermV=-1;
var _hzItems=[];
var _hzM4=new THREE.Matrix4(),_hzQ=new THREE.Quaternion(),_hzP=new THREE.Vector3(),_hzS=new THREE.Vector3();
function _hzEnsure(){
  if(_hzMesh||!scene)return;
  if(typeof _csmEnsure==='function')_csmEnsure();
  if(typeof _csmTex==='undefined'||!_csmTex||typeof CSM_VERT==='undefined')return;
  _hzUvA=new Float32Array(HZSMOKE_N*4);_hzAlphaA=new Float32Array(HZSMOKE_N);_hzTintA=new Float32Array(HZSMOKE_N*3);
  var g=new THREE.PlaneGeometry(1,1);
  g.setAttribute('iUvRect',new THREE.InstancedBufferAttribute(_hzUvA,4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('iAlpha',new THREE.InstancedBufferAttribute(_hzAlphaA,1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('iTint',new THREE.InstancedBufferAttribute(_hzTintA,3).setUsage(THREE.DynamicDrawUsage));
  var fn=900,ff=6200,fc=new THREE.Color(0x8fa3b8);
  if(scene.fog){fn=scene.fog.near;ff=scene.fog.far;fc=scene.fog.color.clone();}
  _hzMat=new THREE.ShaderMaterial({uniforms:{map:{value:_csmTex},uFog:{value:new THREE.Vector2(fn,ff)},uFogCol:{value:fc},uTherm:{value:0},uTG:{value:CSM_THERM_GRAY},uTGE:{value:CSM_THERM_ENG}},vertexShader:CSM_VERT,fragmentShader:CSM_FRAG,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide});
  _hzMesh=new THREE.InstancedMesh(g,_hzMat,HZSMOKE_N);
  _hzMesh.count=0;_hzMesh.visible=false;_hzMesh.frustumCulled=false;_hzMesh.renderOrder=5;_hzMesh.castShadow=false;
  _hzMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(_hzMesh);
}
function _hzLayout(){
  _hzItems.length=0;
  var half=(typeof MAP!=='undefined'&&MAP&&MAP.half)?MAP.half:1000;
  var R=half+1800,capR=half*0.5+2600;   // 大图钳制:half+1800 会掉出雾远(6200)被雾吃光,钳入雾幕内保可见;2km/4km 图走 half+1800 原口径
  if(R>capR)R=capR;
  var rnd=mulberry32(0xB1015EED);
  for(var i=0;i<HZSMOKE_N;i++){
    var ang=i/HZSMOKE_N*Math.PI*2+(rnd()-0.5)*0.42;
    var x=Math.cos(ang)*R,z=Math.sin(ang)*R;
    var yb=(typeof hillProfile==='function')?hillProfile(x,z):0;
    var w=150+rnd()*110,h=95+rnd()*65;
    _hzItems.push({x:x,z:z,y:yb+h*0.5-10,w:w,h:h,a:0.30+rnd()*0.12,ph:rnd()*6.2832,sp:0.016+rnd()*0.010,tint:0.82+rnd()*0.30,cr:0x453e37});
  }
  _hzKey=half+'|'+((typeof MAP!=='undefined'&&MAP&&MAP.mat)?MAP.mat:'');
}
function _hzSmokeUpdate(dt){
  if(HZSMOKE_AMT<=0){if(_hzMesh){_hzMesh.count=0;_hzMesh.visible=false;}return;}
  if(typeof scene==='undefined'||!scene||typeof camera==='undefined'||!camera)return;
  _hzEnsure();if(!_hzMesh||!_hzMat)return;
  if(dt>0)_hzClock+=dt;
  var half=(typeof MAP!=='undefined'&&MAP&&MAP.half)?MAP.half:1000;
  var key=half+'|'+((typeof MAP!=='undefined'&&MAP&&MAP.mat)?MAP.mat:'');
  if(key!==_hzKey||!_hzItems.length)_hzLayout();
  var therm=(typeof _csmThermV!=='undefined')?_csmThermV:0;   // 热像档位与 CSM 同源(边沿切换,此处只跟随)
  if(therm!==_hzThermV){
    _hzThermV=therm;_hzMat.uniforms.uTherm.value=therm;
    if(therm>0.5){_hzMat.blending=THREE.CustomBlending;_hzMat.blendEquation=THREE.MaxEquation;_hzMat.blendSrc=THREE.OneFactor;_hzMat.blendDst=THREE.OneFactor;_hzMat.blendEquationAlpha=THREE.MaxEquation;_hzMat.blendSrcAlpha=THREE.OneFactor;_hzMat.blendDstAlpha=THREE.OneFactor;}
    else{_hzMat.blending=THREE.NormalBlending;_hzMat.blendEquationAlpha=null;_hzMat.blendSrcAlpha=null;_hzMat.blendDstAlpha=null;}
  }
  if(scene.fog){_hzMat.uniforms.uFog.value.set(scene.fog.near,scene.fog.far);_hzMat.uniforms.uFogCol.value.copy(scene.fog.color);}
  var n=0,fr=(typeof _csmFrames!=='undefined')?_csmFrames[CSM_ENGINE]:[0.018,0.518,0.464,0.464];
  for(var i=0;i<_hzItems.length&&i<HZSMOKE_N;i++){
    var it=_hzItems[i];
    var sway=Math.sin(_hzClock*it.sp*3.0+it.ph);
    var x=it.x+Math.sin(_hzClock*0.021+it.ph)*18;   // 极慢漂移(峰速约 0.4m/s,比云还慢,不抢注意力)
    var z=it.z+Math.cos(_hzClock*0.017+it.ph*1.7)*18;
    var a=it.a*(1+0.18*sway)*HZSMOKE_AMT;
    if(a<=0.005)continue;
    comicTextureFace(_hzQ,x,it.y+sway*3,z,COMIC_FACE_YAW);
    _hzP.set(x,it.y+sway*3,z);_hzS.set(it.w,it.h,1);_hzM4.compose(_hzP,_hzQ,_hzS);_hzMesh.setMatrixAt(n,_hzM4);
    var o4=n*4,o3=n*3;
    _hzUvA[o4]=fr[0];_hzUvA[o4+1]=fr[1];_hzUvA[o4+2]=fr[2];_hzUvA[o4+3]=fr[3];
    _hzAlphaA[n]=a;
    _hzTintA[o3]=((it.cr>>16)&255)/255*it.tint;_hzTintA[o3+1]=((it.cr>>8)&255)/255*it.tint;_hzTintA[o3+2]=(it.cr&255)/255*it.tint;
    n++;
  }
  _hzMesh.count=n;_hzMesh.visible=n>0;
  if(n){
    var im=_hzMesh.instanceMatrix;im.updateRange.offset=0;im.updateRange.count=n*16;im.needsUpdate=true;
    var u=_hzMesh.geometry.attributes.iUvRect,al=_hzMesh.geometry.attributes.iAlpha,c=_hzMesh.geometry.attributes.iTint;
    u.updateRange.offset=0;u.updateRange.count=n*4;al.updateRange.offset=0;al.updateRange.count=n;c.updateRange.offset=0;c.updateRange.count=n*3;
    u.needsUpdate=al.needsUpdate=c.needsUpdate=true;
  }
}
/* B2 残骸长驻黑烟柱:注册表 + CSM 并入写盘(零新增 draw call,见 E2 钩子)
   ★E1-8(附录 B §B.4):原实现有两个移动端致命点——
     ① 上限 999 柱、衰减下限 WRSMOKE_FLOOR=0.5 ⇒ 永不消失,随消耗战单调累积
        (兵力 200:200,后期数百具残骸 × 每具每帧 2 张世界尺寸卡);
     ② _wreckSmokeWrite **完全没有距离/视锥门** —— 活载具的烟走 _csmRefreshVisible 的
        「600m + 投影出屏」双门,残骸烟柱却绕过了它,无条件灌进 _csmMesh(frustumCulled=false)。
   这两点叠加 = 用户报告的「爆炸之后就一直卡、越打越卡」。现按档限量 + 加距离门。
   距离门用平方比较(零开方),且**不做投影测试**:投影要 camera.updateMatrixWorld + project,
   逐柱逐帧做反而把 GPU 问题搬成 CPU 问题;屏外实例的片元本来就被 GPU 裁掉,省的是混合填充。 */
var WRSMOKE_MAX=gfxFx('fxWreckSmoke',999),WRSMOKE_AMT=1.0,WRSMOKE_TAU=90,WRSMOKE_FLOOR=0.5;
var WRSMOKE_R2=(function(){var r=gfxFx('fxSmokeR',0);return r>0?r*r:Infinity;})();   // 可见半径平方(0/高档=不限)
var _wreckSmokeList=[];
function wreckSmokeRegister(t){
  if(!t||!t.group||!t.group.position)return;
  for(var i=0;i<_wreckSmokeList.length;i++)if(_wreckSmokeList[i].t===t)return;
  while(_wreckSmokeList.length>=WRSMOKE_MAX)_wreckSmokeList.shift();   // 上限按档(高 999/中 48/低 24),最旧优先熄灭
  var now=(typeof _csmClock!=='undefined')?_csmClock:0;
  _wreckSmokeList.push({t:t,born:now,seed:Math.random(),ph:Math.random(),sj:_sfxJit()});
}
function wreckSmokeUnregister(t){        // ★P2-⑨(移动端恢复):残骸生命周期回收时同步熄灭烟柱
  for(var i=_wreckSmokeList.length-1;i>=0;i--)if(_wreckSmokeList[i].t===t)_wreckSmokeList.splice(i,1);
}
function wreckSmokeClear(){_wreckSmokeList.length=0;}
function _wreckSmokeWrite(){
  if(WRSMOKE_AMT<=0||!_wreckSmokeList.length)return;
  var now=(typeof _csmClock!=='undefined')?_csmClock:0;
  var camP=(WRSMOKE_R2!==Infinity&&typeof camera!=='undefined'&&camera)?camera.position:null;
  for(var i=0;i<_wreckSmokeList.length;i++){
    var W=_wreckSmokeList[i],t=W.t;
    if(!t||!t.group||!t.group.position)continue;   // 引用失效即跳过(位置逐帧读 live,坠机残骸下落过程自动跟随)
    var px=t.group.position.x,py=t.group.position.y,pz=t.group.position.z;
    if(camP){var gdx=px-camP.x,gdz=pz-camP.z;if(gdx*gdx+gdz*gdz>WRSMOKE_R2)continue;}   // ★E1-8 距离门(确定性,无闪断)
    var age=now-W.born;if(age<0)age=0;
    var envA=WRSMOKE_FLOOR+(1-WRSMOKE_FLOOR)*Math.exp(-age/WRSMOKE_TAU);   // 浓黑→薄烟下限,此后长期驻留
    var wx=Math.sin(W.seed*6.2832),wz=Math.cos(W.seed*6.2832);   // 风向定死/残骸,同柱两卡同向 leaning
    for(var k=0;k<2;k++){
      var life=(k===0?7.0:9.5);   // 缕寿命 7~9.5s:发动机烟(约 1s)的 8 倍速慢放
      var cyc=(now*(k===0?0.143:0.105)+W.ph+k*0.5)%1;if(cyc<0)cyc+=1;
      var E=comicSmokeExpand(cyc*life,life,0.10,2.6,0.70,0.62,(k===0?13:16),0.55);
      var lean=2+10*E.k;   // 上升后被风吹散:横向偏移随高度增长,柱体倾斜
      var X=px+wx*lean+(k===1?wx*2.2:0),Z=pz+wz*lean+(k===1?wz*2.2:0);
      var sjw=W.sj||1,sx=(k===0?4.6:6.2)*E.scale*sjw,sy=((k===0?7.5:9.0)+9.5*E.k)*sjw;   // 细柱:宽 5~8m 级,高拉长
      var a=(k===0?0.50:0.30)*E.alpha*envA*WRSMOKE_AMT;
      _csmWrite(CSM_ENGINE+((((W.ph*3)|0)+k)%3),X,py+2.0+E.rise,Z,sx,sy,a,0x2e2a26,wx,wz);   // 发动机厚烟格=热像发动机档(uTGE)
    }
  }
}


function _comicMotionSmokeUpdate(dt){
  if(!_csmVehicles.length&&!_csmMesh&&(typeof _wreckSmokeList==='undefined'||!_wreckSmokeList.length))return;_csmEnsure();if(!_csmMesh||!camera)return;_csmClock+=dt;_csmRefreshVisible(_csmClock,false);
  /* 批次寿命独立于可见性推进:离开画面后不会冻结,重新进入时不会冒出陈旧尘团。 */
  for(var vi=0;vi<_csmVehicles.length;vi++){var bs=_csmVehicles[vi]._csmDustB;if(!bs)continue;for(var bi=0;bi<3;bi++)if(bs[bi].on){bs[bi].age+=dt;if(bs[bi].age>=bs[bi].life)bs[bi].on=false;}}
  _csmActive=0;
  for(var i=0;i<_csmVisible.length;i++){
    var t=_csmVisible[i],speed=t.speed||0,prev=t._csmRenderSpeed==null?speed:t._csmRenderSpeed,acc=dt>0?(speed-prev)/dt:0;t._csmRenderSpeed=speed;
    var spd=Math.abs(speed),sign=Math.sign(speed||1),fwdX=Math.sin(t.yaw),fwdZ=Math.cos(t.yaw),backX=-fwdX*sign,backZ=-fwdZ*sign;
    var isHeli=isHeliVehicle(t);
    var hurt=t.mods.engine.hp<t.mods.engine.max*.60,load=acc*sign>1.4;
    var engineOn=isHeli?((t._heliEngineState!=='cutoff'&&(t._heliPower||0)>0.05)||hurt||!!t.fire):(spd>.45||hurt||!!t.fire);
    if(engineOn){
      var col=hurt?0x332d28:(load?0x493e34:(spd>3?0x685f55:0x8b8379)),baseA=hurt?.90:(load?.82:(spd>3?.66:.48));
      if(typeof engineExhaustSourceLocal==='function')engineExhaustSourceLocal(t,_csmSrc,0,0);else _csmSrc.set(0,1.78,-2.55);t.group.localToWorld(_csmSrc);
      var seed=t._csmSeed||0,sjt=t._csmSJit||1;
      if(isHeli){
        /* 直升机发动机排气:位于机身上方发动机排气口,旋翼下洗流使烟雾迅速完成消散 */
        var k1=(_csmClock*2.2+seed)%1;
        var E1=comicSmokeExpand(k1,0.40,0.05,1.45,0.65,1.9,0.35,0);
        _csmWrite(CSM_ENGINE+(((seed*3)|0)%3),_csmSrc.x+backX*(0.12+0.65*E1.k),_csmSrc.y+0.12+E1.rise,_csmSrc.z+backZ*(0.12+0.65*E1.k),0.85*E1.scale*sjt,1.05*(1+1.1*E1.k)*sjt,baseA*0.50*E1.alpha,col,backX,backZ);
      }else{
        var k1=(_csmClock*.62+seed)%1,k2=(k1+.5)%1;
        var E1=comicSmokeExpand(k1,1,.08,2.75,.72,.62,1.8,0);_csmWrite(CSM_ENGINE+(((seed*3)|0)%3),_csmSrc.x+backX*(.25+1.5*E1.k),_csmSrc.y+.25+E1.rise,_csmSrc.z+backZ*(.25+1.5*E1.k),1.6*E1.scale*sjt,2.1*(1+1.48*E1.k)*sjt,baseA*E1.alpha,col,backX,backZ);
        var E2=comicSmokeExpand(k2,1,.08,2.52,.72,.68,1.45,0);_csmWrite(CSM_ENGINE+((((seed*3)|0)+1)%3),_csmSrc.x+backX*(.8+2.2*E2.k),_csmSrc.y+.65+E2.rise,_csmSrc.z+backZ*(.8+2.2*E2.k),2.1*E2.scale*sjt,1.8*(1+1.56*E2.k)*sjt,baseA*.58*E2.alpha,col,backX,backZ);
      }
    }
    /* 最多三批,每批严格左右各一团。位移采用指数阻力积分,离出生点越远瞬时速度越低。 */
    var batches=t._csmDustB;
    if(batches)for(var bj=0;bj<3;bj++){var B=batches[bj];if(!B.on)continue;
      var age=B.age,DE=comicSmokeExpand(age,B.life,.14,2,1,.42,.55,1.05),k=DE.k,travel=B.v0*DE.drift;
      var sideDrift=.38*(1-Math.exp(-1.35*age)),rise=.10+DE.rise;
      var sx=4.4*DE.scale*(B.sz||1),sy=4.2*DE.scale*(B.sz||1),alpha=B.a*DE.alpha;
      _csmWrite(CSM_DUST+B.var,B.xL+B.backX*travel-B.sideX*sideDrift,B.yL+rise,B.zL+B.backZ*travel-B.sideZ*sideDrift,sx,sy,alpha,B.col,B.backX,B.backZ);
      _csmWrite(CSM_DUST+((B.var+1)%3),B.xR+B.backX*travel+B.sideX*sideDrift,B.yR+rise,B.zR+B.backZ*travel+B.sideZ*sideDrift,sx,sy,alpha,B.col,B.backX,B.backZ);
    }
  }
  if(typeof _wreckSmokeWrite==='function')_wreckSmokeWrite();   // B2:残骸烟柱并入 CSM(零新增 draw call)
  var out=_csmActive;_csmMesh.count=out;_csmMesh.visible=out>0;
  if(out){var im=_csmMesh.instanceMatrix;im.updateRange.offset=0;im.updateRange.count=out*16;im.needsUpdate=true;
    var u=_csmGeo.attributes.iUvRect,a=_csmGeo.attributes.iAlpha,c=_csmGeo.attributes.iTint;u.updateRange.offset=0;u.updateRange.count=out*4;a.updateRange.offset=0;a.updateRange.count=out;c.updateRange.offset=0;c.updateRange.count=out*3;u.needsUpdate=a.needsUpdate=c.needsUpdate=true;}
  if(scene.fog){_csmMat.uniforms.uFog.value.set(scene.fog.near,scene.fog.far);_csmMat.uniforms.uFogCol.value.copy(scene.fog.color);}
}

/* ============================================================
   漫画火箭飞行尾迹:整张高亮排烟贴图片段池(ONE InstancedMesh)
   整张高亮排烟贴图片段池;固定世界尺寸,黑夜亦保持暖白高亮。
   ============================================================ */
var CRT_CAP=1200,_crtTex=null,_crtGeo=null,_crtMat=null,_crtMesh=null,_crtPool=[],_crtRing=0,_crtCount=0,_crtLive=0,_crtList=[],_crtUvA=null;   // _crtList=活跃槽紧凑表:更新只遍历活烟卡,不再每帧扫全部 1200 槽
var _crtAlphaA=null,_crtTintA=null,_crtM=new THREE.Matrix4(),_crtQ=new THREE.Quaternion(),_crtP=new THREE.Vector3(),_crtS=new THREE.Vector3();
var _crtRollQ=new THREE.Quaternion(),_crtZAx=new THREE.Vector3(0,0,1);   // 方案B:每卡滚转(面向相机四元数×Z轴滚转,烘进 instanceMatrix)
var _crtWt=0,_crtWindX=0,_crtWindZ=0;                                    // 方案B:慢变伪风场状态(滞留烟柱随风漂移)
function _crtMakeTrailTex(){var cv=document.createElement('canvas');cv.width=cv.height=512;var g=cv.getContext('2d');g.clearRect(0,0,512,512);g.lineJoin='round';g.lineCap='round';
  /* FX1:A2柔体2x2变体(tint着色故烘焙暖白) */
  _fxA2(g,128,128,100,0xC270,235,230,220,0);_fxA2(g,384,128,100,0xC271,235,230,220,1);
  _fxA2(g,128,384,100,0xC272,235,230,220,2);_fxA2(g,384,384,100,0xC273,235,230,220,3);
  var t=new THREE.CanvasTexture(cv);t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=false;return t;}
var _crtFrames=[[.018,.518,.464,.464],[.518,.518,.464,.464],[.018,.018,.464,.464],[.518,.018,.464,.464]];
function _crtEnsure(){if(_crtMesh||!scene)return;_crtTex=_crtMakeTrailTex();
  _crtGeo=new THREE.PlaneGeometry(1,1);_crtAlphaA=new Float32Array(CRT_CAP);_crtTintA=new Float32Array(CRT_CAP*3);_crtUvA=new Float32Array(CRT_CAP*4);_crtGeo.setAttribute('iAlpha',new THREE.InstancedBufferAttribute(_crtAlphaA,1).setUsage(THREE.DynamicDrawUsage));_crtGeo.setAttribute('iTint',new THREE.InstancedBufferAttribute(_crtTintA,3).setUsage(THREE.DynamicDrawUsage));_crtGeo.setAttribute('iUvRect',new THREE.InstancedBufferAttribute(_crtUvA,4).setUsage(THREE.DynamicDrawUsage));
  var vs=['attribute vec4 iUvRect;attribute float iAlpha;attribute vec3 iTint;varying vec2 vUv;varying float vA;varying vec3 vT;','#include <common>','#include <logdepthbuf_pars_vertex>','void main(){vUv=iUvRect.xy+uv*iUvRect.zw;vA=iAlpha;vT=iTint;vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;','#include <logdepthbuf_vertex>','}'].join('\n');
  var fs=['uniform sampler2D map;varying vec2 vUv;varying float vA;varying vec3 vT;','#include <logdepthbuf_pars_fragment>','void main(){','#include <logdepthbuf_fragment>','vec4 t=texture2D(map,vUv);float a=t.a*vA;if(a<.015)discard;gl_FragColor=vec4(t.rgb*vT*1.28,a);}'].join('\n');
  _crtMat=new THREE.ShaderMaterial({uniforms:{map:{value:_crtTex}},vertexShader:vs,fragmentShader:fs,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,blending:THREE.NormalBlending,toneMapped:false,fog:false});_crtMesh=new THREE.InstancedMesh(_crtGeo,_crtMat,CRT_CAP);_crtMesh.count=0;_crtMesh.visible=false;_crtMesh.frustumCulled=false;_crtMesh.renderOrder=8;_crtMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(_crtMesh);
  for(var i=0;i<CRT_CAP;i++)_crtPool.push({on:false,kind:0,age:0,life:1,x:0,y:0,z:0,vx:0,vy:0,vz:0,size:1,a:.5,r:1,g:1,b:1,var:0,rot:0,rv:0});}
/* ===== 方案B · 卷曲噪声湍流烟柱(trail_smoke_demo.html P2 移植;_rkl 发光尾迹线原样保留) =====
   物理依据:固体发动机白烟主体=Al₂O₃ 凝结核颗粒(DTIC ADA268719 / NASA NTRS 19770011266);
   烟柱久滞、随风切变漂移扭曲(FAA contrails)。双层结构:主烟体(curl 湍流+弱风) + 滞留烟霭(强风、大而淡、长寿命)。 */
function _crtPsi(x,z,t){return 2.2*Math.sin(x*.55+t*.9)*Math.cos(z*.47-t*.7)+1.2*Math.sin(x*1.15-t*1.3+1.7)*Math.cos(z*.95+t*1.1+.4);}
function _crtCurlX(x,z,t){var e=.8;return (_crtPsi(x,z+e,t)-_crtPsi(x,z-e,t))/(2*e);}
function _crtCurlZ(x,z,t){var e=.8;return -(_crtPsi(x+e,z,t)-_crtPsi(x-e,z,t))/(2*e);}
function _crtWindStep(dt){_crtWt+=dt;_crtWindX=1.6*Math.sin(_crtWt*.11)+.9*Math.sin(_crtWt*.037+2.1);_crtWindZ=1.4*Math.cos(_crtWt*.09+.8)+.8*Math.sin(_crtWt*.031+4.2);}
function comicRocketTrailSpawn(x,y,z,dir,burn){_crtEnsure();if(!_crtMesh)return;
  /* O(1)固定环覆盖 + 池压稀疏化:齐射风暴时优先降密度,不抢占老烟卡(容量 1200)。 */
  var press=_crtLive/CRT_CAP;if(press>.92)return;
  if(press>.55&&Math.random()<(press-.55)*2.0)return;
  var slot=_crtRing;_crtRing=(_crtRing+1)%CRT_CAP;var it=_crtPool[slot];if(!it.on){_crtLive++;_crtList.push(slot);}
  it.on=true;it.kind=0;it.age=0;it.life=burn?(2.5+Math.random()):(2.1+Math.random()*.9);
  it.x=x+(Math.random()-.5)*.5;it.y=y+(Math.random()-.5)*.5;it.z=z+(Math.random()-.5)*.5;
  var bk=burn?.55:.32;it.vx=-dir.x*bk+(Math.random()-.5)*.30;it.vy=(burn?.42:.26)+(Math.random()-.5)*.14;it.vz=-dir.z*bk+(Math.random()-.5)*.30;
  it.size=burn?(1.30+Math.random()*.36):(1.18+Math.random()*.38);it.a=burn?.62:.54;   /* 巡航段烟卡加大提亮:配合全程 60Hz 烟链的连续度 */
  if(burn){it.r=1;it.g=.95;it.b=.74;}else{it.r=.92;it.g=.90;it.b=.86;}
  it.var=(Math.random()*4)|0;it.rot=Math.random()*6.283;it.rv=(Math.random()-.5)*2.4;
  if(Math.random()<.14)_crtHazeSpawn(x,y,z);   /* 滞留烟霭层 ≈7Hz:大而淡长寿命,燃尽后仍随风漂移 */
}
function _crtHazeSpawn(x,y,z){
  if(_crtLive/CRT_CAP>.72)return;              /* 池压高时烟霭层先让位主烟体 */
  var slot=_crtRing;_crtRing=(_crtRing+1)%CRT_CAP;var it=_crtPool[slot];if(!it.on){_crtLive++;_crtList.push(slot);}
  it.on=true;it.kind=1;it.age=0;it.life=4.8+Math.random()*2.2;
  it.x=x+(Math.random()-.5)*1.4;it.y=y+(Math.random()-.5)*1.0;it.z=z+(Math.random()-.5)*1.4;
  it.vx=(Math.random()-.5)*.22;it.vy=.10+Math.random()*.10;it.vz=(Math.random()-.5)*.22;
  it.size=2.5+Math.random()*1.3;it.a=.16+Math.random()*.05;
  it.r=.78;it.g=.78;it.b=.82;it.var=(Math.random()*4)|0;it.rot=Math.random()*6.283;it.rv=(Math.random()-.5)*.5;
}
function _comicRocketTrailUpdate(dt){if(!_crtMesh||!_crtList.length)return;_crtWindStep(dt);_crtCount=0;
  for(var li=_crtList.length-1;li>=0;li--){var i=_crtList[li],it=_crtPool[i];it.age+=dt;
    if(it.age>=it.life){it.on=false;_crtLive--;_crtList[li]=_crtList[_crtList.length-1];_crtList.pop();continue;}
    var E,dr,u;
    if(it.kind===1){E=comicSmokeExpand(it.age,it.life,.10,4.6,.60,1.05,2.6,.55);   /* 烟霭:大扩张、高浮升、慢阻力、强风耦合 */
      it.vx+=(_crtWindX*1.15-it.vx)*dt*.30;it.vz+=(_crtWindZ*1.15-it.vz)*dt*.30;
    }else{E=comicSmokeExpand(it.age,it.life,.05,3.6,.62,.85,1.35,1.05);            /* 主烟体:curl 湍流速度场 + 弱风 */
      it.vx+=(_crtCurlX(it.x,it.z,_crtWt)*2.2-it.vx*.5)*dt*1.1;
      it.vz+=(_crtCurlZ(it.x,it.z,_crtWt)*2.2-it.vz*.5)*dt*1.1;
      it.vx+=(_crtWindX*.55-it.vx)*dt*.16;it.vz+=(_crtWindZ*.55-it.vz)*dt*.16;
    }
    u=E.k;it.x+=it.vx*dt;it.y+=it.vy*dt;it.z+=it.vz*dt;
    dr=Math.exp(-(it.kind===1?.55:1.05)*dt);it.vx*=dr;it.vy*=dr;it.vz*=dr;
    it.rot+=it.rv*dt;
    comicTextureFace(_crtQ,it.x,it.y,it.z,COMIC_FACE_CAMERA);_crtRollQ.setFromAxisAngle(_crtZAx,it.rot);_crtQ.multiply(_crtRollQ);
    _crtP.set(it.x,it.y+E.rise,it.z);var ss=it.size*E.scale;_crtS.set(ss,ss,1);_crtM.compose(_crtP,_crtQ,_crtS);
    _crtMesh.setMatrixAt(_crtCount,_crtM);_fxUvW(_crtUvA,_crtCount,_crtFrames,it.var);_crtAlphaA[_crtCount]=it.a*E.alpha;
    var o=_crtCount*3,mix=clamp((u-.16)/.55,0,1),gr=it.kind===1?.62:.58;            /* 色龄渐变:暖白→中性灰(烟柱冷却) */
    _crtTintA[o]=it.r+(gr-it.r)*mix;_crtTintA[o+1]=it.g+(gr-it.g)*mix;_crtTintA[o+2]=it.b+(gr+.04-it.b)*mix;
    _crtCount++;}
  _crtMesh.count=_crtCount;_crtMesh.visible=_crtCount>0;if(_crtCount){var im=_crtMesh.instanceMatrix;im.updateRange.offset=0;im.updateRange.count=_crtCount*16;im.needsUpdate=true;var a=_crtGeo.attributes.iAlpha,c=_crtGeo.attributes.iTint,u=_crtGeo.attributes.iUvRect;a.updateRange.offset=0;a.updateRange.count=_crtCount;c.updateRange.offset=0;c.updateRange.count=_crtCount*3;u.updateRange.offset=0;u.updateRange.count=_crtCount*4;a.needsUpdate=c.needsUpdate=u.needsUpdate=true;}}

/* ============================================================
   漫画特效:地面扬尘卡(炮弹啃地 / 载具部署尘土)
   单张土色团尘贴图 + ONE InstancedMesh 固定池;
   外抛泥环卡 + 中央尘柱卡,comicSmokeExpand 通用扩张曲线,零点粒子。
   贴图直接以泥土色作画(墨线轮廓+受光/阴影瓣),无需逐实例 tint 通道,
   复用 _crlCardGeo/_crlMaterial(iAlpha+对数深度)。
   ============================================================ */
var CGD_CAP=288,_cgdPool=[],_cgdRing=0,_cgdLive=0,_cgdTex=null,_cgdGeo=null,_cgdMat=null,_cgdMesh=null,_cgdAlpha=null,_cgdUvA=null;
var _cgdFrames=[[.018,.518,.464,.464],[.518,.518,.464,.464],[.018,.018,.464,.464],[.518,.018,.464,.464]];
var _cgdM=new THREE.Matrix4(),_cgdQ=new THREE.Quaternion(),_cgdP=new THREE.Vector3(),_cgdS=new THREE.Vector3();
function _cgdMakeTex(){var cv=document.createElement('canvas');cv.width=cv.height=512;var g=cv.getContext('2d');g.clearRect(0,0,512,512);g.lineJoin='round';g.lineCap='round';
  /* FX1:A2扬尘2x2变体(无tint,直接烘焙土色+暗瓣) */
  function cell(x,y,sd,sh){_fxA2(g,x,y,112,sd,199,173,125,sh,1);_fxA2(g,x+22,y+26,64,sd+9,140,118,84,0);}
  cell(128,128,0xCD60,0);cell(384,128,0xCD61,1);cell(128,384,0xCD62,2);cell(384,384,0xCD63,3);
  var t=new THREE.CanvasTexture(cv);t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=false;return t;}
function _cgdEnsure(){if(_cgdMesh||!scene)return;_cgdTex=_cgdMakeTex();_cgdAlpha=new Float32Array(CGD_CAP);_cgdUvA=new Float32Array(CGD_CAP*4);_cgdGeo=_crlCardGeo(_cgdAlpha,_cgdUvA);_cgdMat=_crlMaterial(_cgdTex,true);_cgdMesh=new THREE.InstancedMesh(_cgdGeo,_cgdMat,CGD_CAP);_cgdMesh.count=0;_cgdMesh.visible=false;_cgdMesh.frustumCulled=false;_cgdMesh.renderOrder=6;_cgdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(_cgdMesh);for(var i=0;i<CGD_CAP;i++)_cgdPool.push({on:false,age:0,life:1,x:0,y:0,z:0,vx:0,vz:0,rise:1,size:3,a:.5,var:0});}
function _cgdPut(x,y,z,vx,vz,rise,size,life,a){var it=_cgdPool[_cgdRing];_cgdRing=(_cgdRing+1)%CGD_CAP;if(!it.on)_cgdLive++;it.on=true;it.age=0;it.life=life;it.x=x;it.y=y;it.z=z;it.vx=vx;it.vz=vz;it.rise=rise;it.size=size;it.a=a;it.var=(Math.random()*4)|0;}
function comicGroundDust(x,y,z,big){_cgdEnsure();if(!_cgdMesh)return;
  if(typeof fxEventVisible==='function'&&!fxEventVisible(_cgdP.set(x,y,z)))return;   // 与命中事件同口径:600m/炮镜圈外不生成
  var n=big?7:4,i;
  for(i=0;i<n;i++){var ang=Math.random()*TAU,out=big?(2.5+Math.random()*3.5):(1.1+Math.random()*1.8);
    _cgdPut(x+Math.cos(ang)*.6,y+.4,z+Math.sin(ang)*.6,Math.cos(ang)*out,Math.sin(ang)*out,
      big?1.5:.95,big?(3.6+Math.random()*1.4):(2.2+Math.random()*.9),big?(1.45+Math.random()*.5):(.95+Math.random()*.4),big?.60:.48);}
  _cgdPut(x,y+.6,z,0,0,big?2.5:1.6,big?5.4:3.1,big?1.9:1.3,big?.68:.55);   // 中央浓尘柱
}
function _comicGroundDustUpdate(dt){if(!_cgdMesh||!_cgdLive)return;var n=0;
  for(var i=0;i<CGD_CAP;i++){var it=_cgdPool[i];if(!it.on)continue;it.age+=dt;if(it.age>=it.life){it.on=false;_cgdLive--;continue;}
    var E=comicSmokeExpand(it.age,it.life,.045,2.6,.62,.78,it.rise,1.2);
    it.x+=it.vx*dt;it.z+=it.vz*dt;var dr=Math.exp(-1.9*dt);it.vx*=dr;it.vz*=dr;   // 外抛减速定格,土是重的
    comicTextureFace(_cgdQ,it.x,it.y,it.z,COMIC_FACE_CAMERA);
    _cgdP.set(it.x,it.y+E.rise,it.z);_cgdS.set(it.size*E.scale,it.size*E.scale,1);
    _cgdM.compose(_cgdP,_cgdQ,_cgdS);_cgdMesh.setMatrixAt(n,_cgdM);_fxUvW(_cgdUvA,n,_cgdFrames,it.var);_cgdAlpha[n]=it.a*E.alpha;n++;}
  _cgdMesh.count=n;_cgdMesh.visible=n>0;
  if(n){var im=_cgdMesh.instanceMatrix;im.updateRange.offset=0;im.updateRange.count=n*16;im.needsUpdate=true;
    var a=_cgdGeo.attributes.iAlpha,u=_cgdGeo.attributes.iUvRect;a.updateRange.offset=0;a.updateRange.count=n;u.updateRange.offset=0;u.updateRange.count=n*4;a.needsUpdate=u.needsUpdate=true;}}

/* ============================================================
   P3 履带刨土(CTD):打滑/空转/侧滑时履带从接地边缘一圈向四周抛土块(旋转贴图,落地粘附)。
   128 槽 ONE InstancedMesh,弹道+落地粘附;发射由 world.js comicTrackDig(t,dt)
   逐车驱动(与行进尘同 visible 门/直升机豁免);决策纯函数 trackDigLevel 可无头单测。
   环形覆盖:全场刨土再多也不增 draw call、不增内存,只复用最旧槽。
   ============================================================ */
function trackDigLevel(t) {   // 刨土强度 0~1(纯函数:只读 _throttle/speed/_slip/_slideV/_beltK)
  if (!t) return 0;
  var thr = Math.abs(t._throttle || 0), spd = Math.abs(t.speed || 0), dig = 0;
  if (thr > 0.15 && spd < 2.5) dig = thr * (1 - spd / 2.5);   // 空转:油门大、车不动
  if (t._slip) { var s = 0.45 + 0.55 * thr; if (s > dig) dig = s; }   // SLIP 兜底
  var sv = Math.abs(t._slideV || 0);
  if (sv > 0.5) { var sk = sv / 3; if (sk > 1) sk = 1; if (sk > dig) dig = sk; }   // 侧滑抛土
  if (t._beltK !== undefined && t._beltK !== null) {   // belt-speed mismatch versus actual side speed κ; without belt input use the baseline branch
    var _kk = Math.abs(t._beltK);
    var _k0 = (typeof TRK_DIG_K0 === 'undefined') ? 0.25 : TRK_DIG_K0;
    var _k1 = (typeof TRK_DIG_K1 === 'undefined') ? 0.75 : TRK_DIG_K1;
    var _ds = (_kk - _k0) / (_k1 - _k0); if (_ds < 0) _ds = 0; else if (_ds > 1) _ds = 1;
    if (_ds > dig) dig = _ds;
  }
  return dig > 1 ? 1 : dig;
}
var CTD_CAP=128,_ctdPool=[],_ctdRing=0,_ctdLive=0,_ctdTex=null,_ctdGeo=null,_ctdMat=null,_ctdMesh=null,_ctdAlpha=null,_ctdUvA=null;
var _ctdM=new THREE.Matrix4(),_ctdQ=new THREE.Quaternion(),_ctdP=new THREE.Vector3(),_ctdS=new THREE.Vector3(),_ctdSrc=new THREE.Vector3();
var _ctdRollQ=new THREE.Quaternion(),_ctdZ=new THREE.Vector3(0,0,1),_ctdRimO=[0,0,0,0];
function _ctdMakeTex(){var cv=document.createElement('canvas');cv.width=cv.height=512;var g=cv.getContext('2d');g.clearRect(0,0,512,512);g.lineJoin='round';g.lineCap='round';
  /* FX7-CTD:履带刨土2x2(格0-2新绘T0-2,格3=T0镜像备) */
  var i,_cell=[[0,0,0],[256,0,1],[0,256,2]];
  for(i=0;i<3;i++){g.save();g.translate(_cell[i][0],_cell[i][1]);paintCTD(g,_cell[i][2]);g.restore();}
  g.save();g.translate(512,256);g.scale(-1,1);paintCTD(g,0);g.restore();
  var t=new THREE.CanvasTexture(cv);t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;if(THREE.sRGBEncoding)t.encoding=THREE.sRGBEncoding;return t;}
var _ctdFrames=[[.018,.518,.464,.464],[.518,.518,.464,.464],[.018,.018,.464,.464],[.518,.018,.464,.464]];
function _ctdEnsure(){if(_ctdMesh||typeof scene==='undefined'||!scene)return;_ctdAlpha=new Float32Array(CTD_CAP);_ctdUvA=new Float32Array(CTD_CAP*4);_ctdTex=_ctdMakeTex();_ctdGeo=_crlCardGeo(_ctdAlpha,_ctdUvA);_ctdMat=_crlMaterial(_ctdTex,true);_ctdMesh=new THREE.InstancedMesh(_ctdGeo,_ctdMat,CTD_CAP);_ctdMesh.count=0;_ctdMesh.visible=false;_ctdMesh.frustumCulled=false;_ctdMesh.renderOrder=6;_ctdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(_ctdMesh);for(var i=0;i<CTD_CAP;i++)_ctdPool.push({on:false,age:0,life:1,x:0,y:0,z:0,vx:0,vy:0,vz:0,size:.3,a:.85,rest:0,rot:0,vrot:0,var:0});}
function _ctdRim(t,sgn,thrS,out){   // 接地片周界采样→out=[lx,lz,nx,nz](局部坐标+外法向);无表回落旧车尾点
  var rim=null,sk=(typeof suspKeyOf==='function')?suspKeyOf(t.team,t.kind):null;
  if(t.kind==='arty'){
    var ax=(typeof ARTY_RIM_AXLES_OF!=='undefined')?(ARTY_RIM_AXLES_OF[t.team]||ARTY_RIM_AXLES_OF.red):[2.6,-0.3,-1.4],r0=Math.random(),ai;
    var wx2=(typeof ARTY_RIM_X_OF!=='undefined')?(ARTY_RIM_X_OF[t.team]||1.10):1.10;
    if(thrS>=0)ai=r0<0.5?2:(r0<0.8?1:0);else ai=r0<0.5?0:(r0<0.8?1:2);   // 前进后轴多刨,倒车镜像
    rim={x:wx2,z0:ax[ai]-0.5,z1:ax[ai]+0.5,hw:0.28};
  }else if(sk&&typeof TRK_RIM!=='undefined'&&TRK_RIM[sk])rim=TRK_RIM[sk];
  if(!rim){out[0]=sgn*Math.min(1.38,(t.radius||4)*0.44);out[1]=-thrS*1.2;out[2]=0;out[3]=-thrS;return out;}
  var cx=sgn*rim.x,w=rim.hw*2,d=rim.z1-rim.z0;
  var wRear=thrS>=0?0.30:0.20,wFront=thrS>=0?0.20:0.30,e=Math.random(),u;   // 倒车前后互换
  if(e<wRear){u=Math.random();out[0]=cx-rim.hw+u*w;out[1]=rim.z0;out[2]=0;out[3]=-1;return out;}
  e-=wRear;
  if(e<wFront){u=Math.random();out[0]=cx-rim.hw+u*w;out[1]=rim.z1;out[2]=0;out[3]=1;return out;}
  e-=wFront;
  if(e<0.25){u=Math.random();out[0]=cx+sgn*rim.hw;out[1]=rim.z0+u*d;out[2]=sgn;out[3]=0;return out;}
  u=Math.random();out[0]=cx-sgn*rim.hw;out[1]=rim.z0+u*d;out[2]=-sgn;out[3]=0;return out;
}
function _ctdThrow(t,dig){
  var it=_ctdPool[_ctdRing];_ctdRing=(_ctdRing+1)%CTD_CAP;if(!it.on)_ctdLive++;
  t._ctdSide=(t._ctdSide||0)^1;var sgn=t._ctdSide?1:-1;
  var thrS=(t._throttle||0)>=0?1:-1;
  if(t._beltKSide&&t._beltK!==undefined&&Math.abs(t._beltK)>0.5&&Math.random()<0.7)sgn=t._beltKSide;   // 打滑侧多刨
  var rm=_ctdRim(t,sgn,thrS,_ctdRimO);
  _ctdSrc.set(rm[0],0.12,rm[1]);t.group.localToWorld(_ctdSrc);
  it.on=true;it.age=0;it.rest=0;it.life=.7+Math.random()*.4;
  it.x=_ctdSrc.x;it.z=_ctdSrc.z;
  it.y=(typeof terrainH==='function'?terrainH(_ctdSrc.x,_ctdSrc.z):_ctdSrc.y)+.06;   // 落位 snap(坡地不内嵌)
  it.rot=Math.random()*TAU;it.vrot=(Math.random()-.5)*2.4;   // 旋转贴图:发射随机相位+慢速自旋(落地定格)
  var fx=Math.sin(t.yaw),fz=Math.cos(t.yaw),sv=t._slideV||0;
  var ospd=1.5+Math.random()*2*dig+dig*2;   // 外法向抛速
  var wnx=fz*rm[2]+fx*rm[3],wnz=-fx*rm[2]+fz*rm[3];   // 局部法向→世界(右轴*nx+前轴*nz)
  it.vx=wnx*ospd+fz*sv*.9+(Math.random()-.5)*1.6;
  it.vz=wnz*ospd+(-fx)*sv*.9+(Math.random()-.5)*1.6;
  it.vy=2+Math.random()*2.5*dig+dig*1.5;
  it.size=.22+Math.random()*.23+dig*.1;it.a=.85;it.var=(Math.random()*3)|0;
}
function comicTrackDig(t,dt){   // 世界逐车钩(world.js:行进尘邻行):刨土发射
  if(!t||!t.alive||isHeliVehicle(t))return;
  if(t._throttleLock){t._ctdAcc=0;return;}   // 齐射驻锄禁发
  if(typeof beltUpdate==='function')beltUpdate(t,dt);   // 带速新鲜度(帧哨兵,多调无害)
  if(!t._csmRegistered||!t._csmVisible)return;
  if(typeof trackDigLevel!=='function')return;
  var dig=trackDigLevel(t);
  if(dig<0.25){t._ctdAcc=0;return;}
  _ctdEnsure();if(!_ctdMesh)return;
  t._ctdAcc=(t._ctdAcc||0)+dig*26*dt;
  var n=0;
  while(t._ctdAcc>=1&&n<4){t._ctdAcc-=1;n++;_ctdThrow(t,dig);}
  if(n>=4)t._ctdAcc=0;   // 长帧截断,防追赶风暴
}
function _comicTrackDigUpdate(dt){if(!_ctdMesh||!_ctdLive)return;var n=0;
  for(var i=0;i<CTD_CAP;i++){var it=_ctdPool[i];if(!it.on)continue;it.age+=dt;if(it.age>=it.life){it.on=false;_ctdLive--;continue;}
    if(!it.rest){it.vy-=9.8*dt;it.rot+=it.vrot*dt;it.x+=it.vx*dt;it.y+=it.vy*dt;it.z+=it.vz*dt;
      var gy=terrainH(it.x,it.z)+.04;if(it.y<=gy){it.y=gy;it.rest=1;it.vx=it.vy=it.vz=0;it.vrot=0;}}
    var k=it.age/it.life;
    comicTextureFace(_ctdQ,it.x,it.y,it.z,COMIC_FACE_CAMERA);_ctdRollQ.setFromAxisAngle(_ctdZ,it.rot);_ctdQ.multiply(_ctdRollQ);
    _ctdP.set(it.x,it.y,it.z);_ctdS.set(it.size,it.size,1);
    _ctdM.compose(_ctdP,_ctdQ,_ctdS);_ctdMesh.setMatrixAt(n,_ctdM);_ctdAlpha[n]=it.a*(k<.55?1:1-(k-.55)/.45);_fxUvW(_ctdUvA,n,_ctdFrames,it.var);n++;}
  _ctdMesh.count=n;_ctdMesh.visible=n>0;
  if(n){var im=_ctdMesh.instanceMatrix;im.updateRange.offset=0;im.updateRange.count=n*16;im.needsUpdate=true;
    var a=_ctdGeo.attributes.iAlpha,u=_ctdGeo.attributes.iUvRect;a.updateRange.offset=0;a.updateRange.count=n;u.updateRange.offset=0;u.updateRange.count=n*4;a.needsUpdate=u.needsUpdate=true;}}
/* ============================================================
   火箭刚离轨专属喷射团烟:只保留一张烟贴图和一只固定容量 InstancedMesh。
   每次发射只在发射架根部中央写一张Y轴面向单卡;扩散同时沿发射方向反向漂移。
   原本实例化锥体尾焰不受影响;团烟无粒子、灯光、反光或泛光。
   ============================================================ */
var CRL_CAP=64,CRL_SMOKE_CAP=CRL_CAP,_crlPool=[],_crlRing=0,_crlLive=0,_crlSmokeTex=null,_crlSmokeGeo=null,_crlSmokeMat=null,_crlSmokeMesh=null,_crlSmokeUvA=null;
var _crlFrames=[[.018,.518,.464,.464],[.518,.518,.464,.464],[.018,.018,.464,.464],[.518,.018,.464,.464]];
var _crlSmokeAlpha=null,_crlM=new THREE.Matrix4(),_crlQ=new THREE.Quaternion(),_crlP=new THREE.Vector3(),_crlRoot=new THREE.Vector3(),_crlS=new THREE.Vector3(),_crlDir=new THREE.Vector3();
function _crlMakeJetSmokeTex(){var cv=document.createElement('canvas');cv.width=cv.height=1024;var g=cv.getContext('2d');g.clearRect(0,0,1024,1024);g.lineJoin='round';g.lineCap='round';
  /* FX1:A2发射烟2x2变体(无tint,直接烘焙暖灰+深瓣) */
  function cell(x,y,sd,sh){_fxA2(g,x,y,200,sd,200,190,170,sh);_fxA2(g,x+44,y+52,116,sd+9,150,140,128,0);}
  cell(256,256,0xC260,0);cell(768,256,0xC261,1);cell(256,768,0xC262,2);cell(768,768,0xC263,3);
  var t=new THREE.CanvasTexture(cv);t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=false;return t;}
function _crlCardGeo(alpha,uv){var p=new Float32Array([-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0]),quv=new Float32Array([0,0,1,0,1,1,0,1]),ix=new Uint16Array([0,2,1,0,3,2]),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));g.setAttribute('uv',new THREE.BufferAttribute(quv,2));g.setAttribute('iAlpha',new THREE.InstancedBufferAttribute(alpha,1).setUsage(THREE.DynamicDrawUsage));if(uv)g.setAttribute('iUvRect',new THREE.InstancedBufferAttribute(uv,4).setUsage(THREE.DynamicDrawUsage));g.setIndex(new THREE.BufferAttribute(ix,1));return g;}
function _crlMaterial(tex,useUv){var vs=[(useUv?'attribute vec4 iUvRect;attribute float iAlpha;':'attribute float iAlpha;')+'varying vec2 vUv;varying float vA;','#include <common>','#include <logdepthbuf_pars_vertex>','void main(){vUv='+(useUv?'iUvRect.xy+uv*iUvRect.zw':'uv')+';vA=iAlpha;vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;','#include <logdepthbuf_vertex>','}'].join('\n'),fs=['uniform sampler2D map;varying vec2 vUv;varying float vA;','#include <logdepthbuf_pars_fragment>','void main(){','#include <logdepthbuf_fragment>','vec4 t=texture2D(map,vUv);float a=t.a*vA;if(a<.018)discard;gl_FragColor=vec4(t.rgb,a);}'].join('\n');return new THREE.ShaderMaterial({uniforms:{map:{value:tex}},vertexShader:vs,fragmentShader:fs,transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,blending:THREE.NormalBlending,toneMapped:false,fog:false});}
function _crlEnsure(){if(_crlSmokeMesh||!scene)return;_crlSmokeTex=_crlMakeJetSmokeTex();_crlSmokeAlpha=new Float32Array(CRL_SMOKE_CAP);_crlSmokeUvA=new Float32Array(CRL_SMOKE_CAP*4);_crlSmokeGeo=_crlCardGeo(_crlSmokeAlpha,_crlSmokeUvA);_crlSmokeMat=_crlMaterial(_crlSmokeTex,true);_crlSmokeMesh=new THREE.InstancedMesh(_crlSmokeGeo,_crlSmokeMat,CRL_SMOKE_CAP);_crlSmokeMesh.count=0;_crlSmokeMesh.visible=false;_crlSmokeMesh.frustumCulled=false;_crlSmokeMesh.renderOrder=7;_crlSmokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(_crlSmokeMesh);for(var i=0;i<CRL_CAP;i++)_crlPool.push({on:false,age:0,x:0,y:0,z:0,dx:0,dz:1,var:0,sm:1});}
function comicLaunchSmokeSizeMul(dmg){if(!(dmg>0))return 1;return clamp((dmg-20)/20,.5,3);}
// FX6:发射烟通用尺寸:伤40=1x当前,伤60=2x(线性过两点,钳0.5~3)
function comicRocketLaunchBurst(t,dir,pos,dmg){_crlEnsure();if(!_crlSmokeMesh||!t)return;var it=_crlPool[_crlRing];_crlRing=(_crlRing+1)%CRL_CAP;if(!it.on)_crlLive++;if(pos){_crlRoot.copy(pos);}else if(t.gunPivot){t.gunPivot.getWorldPosition(_crlRoot);}else if(t.group){t.group.getWorldPosition(_crlRoot);}if(dir){_crlDir.set(dir.x,dir.y||0,dir.z);if(_crlDir.lengthSq()<1e-6)_crlDir.set(Math.sin(t.yaw||0),0,Math.cos(t.yaw||0));else _crlDir.normalize();}else{_crlDir.set(Math.sin(t.yaw||0),0,Math.cos(t.yaw||0));}it.on=true;it.age=0;it.x=_crlRoot.x;it.y=_crlRoot.y;it.z=_crlRoot.z;it.dx=_crlDir.x;it.dy=_crlDir.y||0;it.dz=_crlDir.z;it.var=(Math.random()*4)|0;it.sm=comicLaunchSmokeSizeMul(dmg);}
function _comicRocketLaunchUpdate(dt){if(!_crlSmokeMesh||!_crlLive)return;var sn=0;for(var i=0;i<CRL_CAP;i++){var it=_crlPool[i];if(!it.on)continue;it.age+=dt;if(it.age>=2.65){it.on=false;_crlLive--;continue;}var E=comicSmokeExpand(it.age,2.65,.055,2.0,.70,.60,2.2,.62),back=2.65*E.drift*(it.sm||1);_crlP.set(it.x-it.dx*back,it.y-(it.dy||0)*back+E.rise*.72,it.z-it.dz*back);comicTextureFace(_crlQ,_crlP.x,_crlP.y,_crlP.z,COMIC_FACE_YAW);var size=9.4*E.scale*(it.sm||1);_crlS.set(size,size,1);_crlM.compose(_crlP,_crlQ,_crlS);_crlSmokeMesh.setMatrixAt(sn,_crlM);_fxUvW(_crlSmokeUvA,sn,_crlFrames,it.var);_crlSmokeAlpha[sn]=.54*E.alpha;sn++;}
  _crlSmokeMesh.count=sn;_crlSmokeMesh.visible=sn>0;if(sn){var sm=_crlSmokeMesh.instanceMatrix;sm.updateRange.offset=0;sm.updateRange.count=sn*16;sm.needsUpdate=true;var sa=_crlSmokeGeo.attributes.iAlpha,su=_crlSmokeGeo.attributes.iUvRect;sa.updateRange.offset=0;sa.updateRange.count=sn;su.updateRange.offset=0;su.updateRange.count=sn*4;sa.needsUpdate=su.needsUpdate=true;}}

/* ============================================================
   全航程弹道尾迹线:解析弧固定槽 LineSegments(ONE draw call)
   每发弹体占40段、最长150m:火箭头端止于弹道顶点,主炮弹头端止于实际落点。
   尾端按各自弹体飞行速度向固定终点收缩;独立覆盖场景绕过Sobel黑边,无粒子/泛光。
   ============================================================ */
/* 槽位管理(高水位反绑架):空闲栈 LIFO 分配替代环形推进——释放即回收、活跃槽聚集低位,
   _rklHigh/drawRange 跟随真实并发数而非历史峰值(环形制打满一圈后 drawRange 永久 704×40×2=56320 顶点,
   GPU 每帧全量变换退化顶点);_rklEndList=收缩中槽位紧凑表,尾端收缩只遍历它,不再逐帧扫全部槽位。 */
var RKL_SLOTS=704,RKL_SEGS=40,RKL_CAP=RKL_SLOTS*RKL_SEGS,_rklMesh=null,_rklScene=null,_rklGeo=null,_rklMat=null,_rklPos=null,_rklCol=null,_rklOwners=[],_rklShrinkObj=[],_rklEnding=null,_rklShrinkSpeed=null,_rklCut=null,_rklEndToken={},_rklFree=[],_rklEndList=[],_rklLive=0,_rklHigh=0,_rklDirtyMin=RKL_CAP,_rklDirtyMax=0;
var _rklK={p0x:0,p0y:0,p0z:0,v0x:0,v0y:0,v0z:0,u:0};
function _rklEnsure(){if(_rklMesh||!scene)return;_rklPos=new Float32Array(RKL_CAP*6);_rklCol=new Float32Array(RKL_CAP*6);_rklEnding=new Uint8Array(RKL_SLOTS);_rklShrinkSpeed=new Float32Array(RKL_SLOTS);_rklCut=new Uint8Array(RKL_SLOTS);_rklGeo=new THREE.BufferGeometry();_rklGeo.setAttribute('position',new THREE.BufferAttribute(_rklPos,3).setUsage(THREE.DynamicDrawUsage));_rklGeo.setAttribute('color',new THREE.BufferAttribute(_rklCol,3).setUsage(THREE.DynamicDrawUsage));_rklGeo.setDrawRange(0,0);/* 弹道线软深度测试:overlay 在合成后直画默认帧缓冲(无场景深度,旧 depthTest:false=隔地形可见)。
     采样主管线现成的 _comicRT.depthTexture(对数深度),片元按 three logdepthbuf 同式
     log2(1+w)/log2(far+1) 算自身深度,场景更近则 discard——线的 overlay 地位(不进 Sobel/不受
     RT 降采样)不变;uniform 由 _rklDepthSync 事件级同步(RT 重建/线系统首建),overlay 零逐帧新增。 */
  _rklMat=new THREE.ShaderMaterial({uniforms:{tDepth:{value:null},uHasDepth:{value:0},uInvVP:{value:new THREE.Vector2(1,1)},uFC:{value:1},uThermal:{value:0}},
    vertexShader:['varying vec3 vC;varying float vW;',
      'void main(){vC=color;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;vW=gl_Position.w;}'].join('\n'),
    fragmentShader:['uniform sampler2D tDepth;uniform float uHasDepth;uniform vec2 uInvVP;uniform float uFC;uniform float uThermal;varying vec3 vC;varying float vW;',
      'void main(){',
      '  if(uHasDepth>0.5){',
      '    float sd=texture2D(tDepth,gl_FragCoord.xy*uInvVP).r;',
      '    float md=log2(1.0+vW)*uFC*0.5;',
      '    if(md>sd+0.0004)discard;',                    // 场景片元更近=线被地形/物体遮挡
      '  }',
      '  vec3 oc=mix(vC,vec3(0.85),uThermal);gl_FragColor=vec4(oc,0.98);}'].join('\n'),
    vertexColors:true,transparent:true,depthWrite:false,depthTest:false,blending:THREE.NormalBlending,toneMapped:false,fog:false});_rklMesh=new THREE.LineSegments(_rklGeo,_rklMat);_rklMesh.visible=false;_rklMesh.frustumCulled=false;_rklMesh.renderOrder=15;_rklScene=new THREE.Scene();_rklScene.add(_rklMesh);for(var i=0;i<RKL_SLOTS;i++){_rklOwners.push(null);_rklShrinkObj.push(null);_rklFree.push(RKL_SLOTS-1-i);}_rklDepthSync();}
function _rklDepthSync(){                                // 弹道线软深度测试 uniform 同步(事件级:RT 重建/线系统首建时调)
  if(!_rklMat)return;
  var U=_rklMat.uniforms;
  if(_comicRT&&_comicRT.depthTexture&&renderer&&camera){
    U.tDepth.value=_comicRT.depthTexture;U.uHasDepth.value=1;
    renderer.getDrawingBufferSize(_comicV2);U.uInvVP.value.set(1/Math.max(1,_comicV2.x),1/Math.max(1,_comicV2.y));
    U.uFC.value=2/(Math.log(camera.far+1)/Math.LN2);     // three logDepthBufFC 同式
  } else U.uHasDepth.value=0;                            // 无深度纹理(WebGL1 无扩展/降级直渲)=保持旧行为兜底
}
function _rklMark(slot){var a=slot*RKL_SEGS,b=a+RKL_SEGS;if(a<_rklDirtyMin)_rklDirtyMin=a;if(b>_rklDirtyMax)_rklDirtyMax=b;}
function _rklGetK(r){
  if(r&&r.arty&&r.rk)return r.rk;
  if(!r||r._lineU==null)return null;
  var K=_rklK;
  if ((r.isHeliRocket || r.isHeliMissile) && r.pos) {
    // 直升机弹尾迹走 _traj 真实航迹折线; K 仅供 comicRocketLineStart 初始坍缩定位(u=0 → p0=pos, 回推数学已无用)
    K.p0x = r.pos.x; K.p0y = r.pos.y; K.p0z = r.pos.z; K.u = 0; K.g = 0;
    return K;
  }
  K.p0x=r._lineP0x;K.p0y=r._lineP0y;K.p0z=r._lineP0z;
  K.v0x=r._lineV0x;K.v0y=r._lineV0y;K.v0z=r._lineV0z;
  K.u=r._lineU;
  K.g=CONF.gravity;
  return K;
}
function comicRocketLineStart(r){var K=_rklGetK(r);if(!K||r._comicLineDone)return;_rklEnsure();if(!_rklMesh)return;if(!_rklFree.length){r._comicLineDone=true;return;}var slot=_rklFree.pop();_rklLive++;_rklEnding[slot]=0;_rklShrinkSpeed[slot]=0;_rklShrinkObj[slot]=null;_rklCut[slot]=0;_rklOwners[slot]=r;if(slot+1>_rklHigh){_rklHigh=slot+1;_rklGeo.setDrawRange(0,_rklHigh*RKL_SEGS*2);}r._comicLineSlot=slot;r._comicLineDone=false;r._comicLineT=0;var off=slot*RKL_SEGS,x=K.p0x,y=K.p0y,z=K.p0z;for(var j=0;j<RKL_SEGS;j++){var o=(off+j)*6;_rklPos[o]=_rklPos[o+3]=x;_rklPos[o+1]=_rklPos[o+4]=y;_rklPos[o+2]=_rklPos[o+5]=z;_rklCol[o]=_rklCol[o+3]=1;_rklCol[o+1]=_rklCol[o+4]=.52;_rklCol[o+2]=_rklCol[o+5]=.12;}_rklMark(slot);_rklMesh.visible=true;}
function _rklArcLen(K,a,b){var n=6,du=(b-a)/n,u=a,px=K.p0x+K.v0x*u,py=K.p0y+K.v0y*u-.5*CONF.gravity*u*u,pz=K.p0z+K.v0z*u,sum=0;for(var i=1;i<=n;i++){u=a+du*i;var x=K.p0x+K.v0x*u,y=K.p0y+K.v0y*u-.5*CONF.gravity*u*u,z=K.p0z+K.v0z*u,dx=x-px,dy=y-py,dz=z-pz;sum+=Math.sqrt(dx*dx+dy*dy+dz*dz);px=x;py=y;pz=z;}return sum;}
function _rklBeginShrink(slot,r,speed){_rklOwners[slot]=_rklEndToken;if(!_rklEnding[slot])_rklEndList.push(slot);_rklEnding[slot]=1;_rklShrinkSpeed[slot]=Math.max(1,speed||1);_rklShrinkObj[slot]=r||null;_rklCut[slot]=0;if(r){r._comicLineSlot=-1;r._comicLineDone=true;}_rklMark(slot);}
/* ===== 直升机火箭/导弹: 真实航迹记录 + 全航程尾迹(替代解析切线回推) =====
   记录: 与尾迹计时器同拍(40Hz)登记弹体实际路径, 助推/比例导引/重力下坠的全部弯曲均入账;
   抽稀: 超上限时旧半区隔点保留→旧段间距倍增, 有界内存覆盖全航程(首点=发射点恒保留);
   渲染: 折线+当前弹位按弧长均匀重采样 40 段写入现有槽位, 槽位/收缩动画/软深度全部复用。 */
var RKL_TRAJ_MAX_PTS=256;                                  // 单弹航迹点上限(40Hz 满密度≈6.4s)
var _rklTBnd=new Float32Array((RKL_SEGS+1)*3);             // 41 边界点 scratch(模块级复用,零逐帧分配)
function _rklTrajRecord(r){
  var T=r._traj;if(!T){T=r._traj=[r.pos.x,r.pos.y,r.pos.z];}
  T.push(r.pos.x,r.pos.y,r.pos.z);
  while(T.length>RKL_TRAJ_MAX_PTS*3){                      // 指数抽稀: 旧半区隔点保留,新半区全保(原地压缩零分配)
    var nP=T.length/3,half=nP>>1,w=0,i,j;
    for(i=0;i<half;i+=2){T[w++]=T[i*3];T[w++]=T[i*3+1];T[w++]=T[i*3+2];}
    for(j=half;j<nP;j++){T[w++]=T[j*3];T[w++]=T[j*3+1];T[w++]=T[j*3+2];}
    T.length=w;
  }
}
function _rklWriteTrajLine(slot,r){                        // 真实航迹折线→40段弧长均匀重采样写入(头端=当前弹位)
  var T=r._traj,nP=T.length/3,off=slot*RKL_SEGS,B=_rklTBnd,i;
  var hx=r.pos.x,hy=r.pos.y,hz=r.pos.z;
  var L=0,ax=T[0],ay=T[1],az=T[2],bx,by,bz;                // 第一趟: 折线(航迹点+头端)总弧长, 顶点k=nP即当前弹位
  for(i=1;i<=nP;i++){bx=i<nP?T[i*3]:hx;by=i<nP?T[i*3+1]:hy;bz=i<nP?T[i*3+2]:hz;
    L+=Math.sqrt((bx-ax)*(bx-ax)+(by-ay)*(by-ay)+(bz-az)*(bz-az));ax=bx;ay=by;az=bz;}
  var seg=0;ax=T[0];ay=T[1];az=T[2];bx=T[3];by=T[4];bz=T[5];   // nP>=2 由调用分支保证
  var segAcc=0,segLen=Math.sqrt((bx-ax)*(bx-ax)+(by-ay)*(by-ay)+(bz-az)*(bz-az));
  var s0=L>150?L-150:0;                                    // 150m 滑动窗口: 尾端止于弹体后方150m(与主炮弹/火箭炮同口径), 保留真实弹道弯曲
  for(i=0;i<=RKL_SEGS;i++){                                // 第二趟: 双指针取 41 个等弧长边界点(尾=窗口尾,头=当前弹位)
    var s=s0+(L-s0)*i/RKL_SEGS;
    while(seg<nP-1&&segAcc+segLen<s){
      segAcc+=segLen;seg++;ax=T[seg*3];ay=T[seg*3+1];az=T[seg*3+2];
      bx=seg<nP-1?T[seg*3+3]:hx;by=seg<nP-1?T[seg*3+4]:hy;bz=seg<nP-1?T[seg*3+5]:hz;
      segLen=Math.sqrt((bx-ax)*(bx-ax)+(by-ay)*(by-ay)+(bz-az)*(bz-az));
    }
    var f=segLen>1e-9?Math.max(0,Math.min(1,(s-segAcc)/segLen)):0;
    B[i*3]=ax+(bx-ax)*f;B[i*3+1]=ay+(by-ay)*f;B[i*3+2]=az+(bz-az)*f;
  }
  for(i=0;i<RKL_SEGS;i++){                                 // 第三趟: 40 段端点/颜色写入槽位(颜色沿用解析路径渐变公式)
    var o=(off+i)*6,t=(i+1)/RKL_SEGS;
    _rklPos[o]=B[i*3];_rklPos[o+1]=B[i*3+1];_rklPos[o+2]=B[i*3+2];
    _rklPos[o+3]=B[i*3+3];_rklPos[o+4]=B[i*3+4];_rklPos[o+5]=B[i*3+5];
    _rklCol[o]=_rklCol[o+3]=1;_rklCol[o+1]=_rklCol[o+4]=.52+.46*t;_rklCol[o+2]=_rklCol[o+5]=.12+.72*t;}
}
function comicRocketLineUpdate(r){if(!r||r._comicLineDone)return;var K=_rklGetK(r);if(!K)return;var slot=r._comicLineSlot;if(slot==null||slot<0||_rklOwners[slot]!==r){comicRocketLineStart(r);slot=r._comicLineSlot;if(slot==null||slot<0)return;}
  /* 直升机火箭/导弹: 真实航迹折线全航程尾迹 —— 不走解析回推(切线直线根因); 点不足时保持坍缩不可见 */
  if(r.isHeliRocket||r.isHeliMissile){_rklTrajRecord(r);if(r._traj&&r._traj.length>=6){_rklWriteTrajLine(slot,r);_rklMark(slot);}return;}
  var gVal=K.g!=null?K.g:(r.arty?CONF.gravity:(r.isHeliRocket?CONF.gravity*0.35:(r.isHeliMissile?CONF.gravity*0.12:CONF.gravity)));var apexU=r.arty?Math.max(0,K.v0y/CONF.gravity):Infinity,atApex=r.arty&&K.u>=apexU,u=atApex?apexU:K.u,startU=r._rklStartU||0;if(u>0&&_rklArcLen(K,0,u)>150){var cand=startU+(u-(r._rklUPrev||0));if(cand>u)cand=u;if(_rklArcLen(K,cand,u)>150){cand+=(cand-startU)*.5;if(cand>u)cand=u;}startU=Math.max(0,cand);}else startU=0;r._rklStartU=startU;r._rklUPrev=u;var span=u-startU,off=slot*RKL_SEGS,inv=1/RKL_SEGS;for(var j=0;j<RKL_SEGS;j++){var ua=startU+span*j*inv,ub=startU+span*(j+1)*inv,o=(off+j)*6,t=(j+1)*inv,cr=1,cg=.52+.46*t,cb=.12+.72*t;_rklPos[o]=K.p0x+K.v0x*ua;_rklPos[o+1]=K.p0y+K.v0y*ua-.5*gVal*ua*ua;_rklPos[o+2]=K.p0z+K.v0z*ua;_rklPos[o+3]=K.p0x+K.v0x*ub;_rklPos[o+4]=K.p0y+K.v0y*ub-.5*gVal*ub*ub;_rklPos[o+5]=K.p0z+K.v0z*ub;_rklCol[o]=_rklCol[o+3]=cr;_rklCol[o+1]=_rklCol[o+4]=cg;_rklCol[o+2]=_rklCol[o+5]=cb;}if(!r.arty&&r.pos){var last=(off+RKL_SEGS-1)*6+3;_rklPos[last]=r.pos.x;_rklPos[last+1]=r.pos.y;_rklPos[last+2]=r.pos.z;}_rklMark(slot);if(atApex)_rklBeginShrink(slot,r,r.vel?r.vel.length():0);}
function comicRocketLineEnd(r){if(!r||r._comicLineDone)return;comicRocketLineUpdate(r);if(r._comicLineDone)return;var slot=r._comicLineSlot;if(slot==null||slot<0||_rklOwners[slot]!==r){r._comicLineSlot=-1;return;}var last=(slot*RKL_SEGS+RKL_SEGS-1)*6+3;if(r.pos){_rklPos[last]=r.pos.x;_rklPos[last+1]=r.pos.y;_rklPos[last+2]=r.pos.z;}_rklBeginShrink(slot,r,r.vel?r.vel.length():0);}
function _rklFinishEnding(slot){var off=slot*RKL_SEGS,head=(off+RKL_SEGS-1)*6+3,x=_rklPos[head],y=_rklPos[head+1],z=_rklPos[head+2];for(var j=0;j<RKL_SEGS;j++){var o=(off+j)*6;_rklPos[o]=_rklPos[o+3]=x;_rklPos[o+1]=_rklPos[o+4]=y;_rklPos[o+2]=_rklPos[o+5]=z;}_rklOwners[slot]=null;_rklEnding[slot]=0;_rklShrinkSpeed[slot]=0;_rklShrinkObj[slot]=null;_rklCut[slot]=0;_rklFree.push(slot);if(_rklLive>0)_rklLive--;if(slot===_rklHigh-1){while(_rklHigh>0&&!_rklOwners[_rklHigh-1])_rklHigh--;_rklGeo.setDrawRange(0,_rklHigh*RKL_SEGS*2);}_rklMark(slot);if(!_rklLive)_rklMesh.visible=false;}
function _comicRocketLineTailUpdate(dt){if(!_rklMesh||!_rklEndList.length)return;for(var ei=_rklEndList.length-1;ei>=0;ei--){var slot=_rklEndList[ei];var mover=_rklShrinkObj[slot];if(mover&&mover.vel)_rklShrinkSpeed[slot]=Math.max(1,mover.vel.length());var travel=_rklShrinkSpeed[slot]*dt,cut=_rklCut[slot],off=slot*RKL_SEGS;while(travel>0&&cut<RKL_SEGS){var o=(off+cut)*6,dx=_rklPos[o+3]-_rklPos[o],dy=_rklPos[o+4]-_rklPos[o+1],dz=_rklPos[o+5]-_rklPos[o+2],len=Math.sqrt(dx*dx+dy*dy+dz*dz);if(len<=travel+.00001){_rklPos[o]=_rklPos[o+3];_rklPos[o+1]=_rklPos[o+4];_rklPos[o+2]=_rklPos[o+5];travel-=len;cut++;}else{var f=travel/len;_rklPos[o]+=dx*f;_rklPos[o+1]+=dy*f;_rklPos[o+2]+=dz*f;travel=0;}}_rklCut[slot]=cut;if(cut>=RKL_SEGS){_rklFinishEnding(slot);_rklEndList[ei]=_rklEndList[_rklEndList.length-1];_rklEndList.pop();}else _rklMark(slot);}}
function _comicRocketLineFlush(){if(!_rklMesh||_rklDirtyMax<=_rklDirtyMin)return;var a=_rklDirtyMin,b=_rklDirtyMax,n=b-a,p=_rklGeo.attributes.position,c=_rklGeo.attributes.color;p.updateRange.offset=c.updateRange.offset=a*6;p.updateRange.count=c.updateRange.count=n*6;p.needsUpdate=c.needsUpdate=true;_rklDirtyMin=RKL_CAP;_rklDirtyMax=0;}
function _comicRocketLineOverlay(cam){if(!_rklScene||!_rklMesh||!_rklMesh.visible)return false;var ac=renderer.autoClear;renderer.autoClear=false;renderer.render(_rklScene,cam);renderer.autoClear=ac;return true;}

/* ============================================================
   漫画火箭弹爆炸:单张火光 + 单张蘑菇烟 + 高亮地面贴图
   旧花瓣球/放射芒/墨滴/炽核四贴图拼接实现已完全删除。
   ============================================================ */
var CB_POOL=28,_cbPool=null,_cbSerial=0;   // 28 槽=双门齐射交错稳态并发 25.5 全覆盖(2×16 发,0.11s 有效间隔,寿命 2.8s);_cbSerial=抢最旧判据
/* ★任务27⑥:饱和降级调速器——池按「双门齐射」设计,猎杀 AI 8 门同拍齐射时到达率 ~10/s×2.8s 寿命
   把 28 槽顶满(实测 cbPeak=28):槽位争抢=卡在同一集群反复闪现,三大张面×3.4 距离补偿=填充率卡。
   活跃卡 ≥HI 后续爆点降级(短寿命/小幅面/无地面高亮),≤LO 恢复;滞回防振荡。纯视觉,玩法零改动。 */
var CB_SAT_HI=gfxFx('fxSatHi',12),CB_SAT_LO=gfxFx('fxSatLo',8),_cbSat=false,_cbDegN=0,_cbLive=0,CB_HARD_MAX=gfxFx('fxHardMax',24);
/*   参数依据(dbg_burstline 实测):到达率峰值 ~10/s → 降级卡稳态并发 ≈ 率×1.2s 寿命 ≈ 12;
   HI=12 触发时存量满幅卡 ≤12 张(2.8s 内衰减),叠加降级稳态后瞬态 ≤~22 < 28 槽,
   槽位争抢(丢新保旧抢最旧)全程不触发;≥24 硬顶=极端双风暴时干脆不出卡(扬尘/弹坑/焦土/音效照常)。
   ★E1-3(附录 B):以上全部是**桌面档**标定。触屏端 GPU 填充率只有桌面的零头,同样的 12 张满幅卡
   =峰值 ~36 层近全屏 alpha 混合,必卡;故三档门限改从 GFX 取(中 5/3/10、低 3/2/6)。
   只收紧门限、不动 CB_POOL=28 —— 池容量牵动内存布局与抢槽语义(丢新保旧),不是并发闸。 */
var VB_POOL=8,_vbPool=null,_vbSerial=0;
/* ★E1-5/E2-1/E2-4(附录 B)档位快照:模块加载期取一次(GFX 在 scene.js 里已就位,见 index.html MODULES 序)。
   · _cbGroundLight=false ⇒ 不出 36m 地面加法高亮面(三层里最大的一层)
   · CB_BIG_TEX         ⇒ 爆炸贴图基准边长(1024→512:火光+3 变体烟 21MB→5.3MB,采样带宽 −75%)
   · VB_FRAME_MAX       ⇒ 同帧殉爆卡上限(0=不限;链式殉爆时后续降级为小口径爆点卡) */
var _cbGroundLight=gfxFx('fxGroundLight',true),CB_BIG_TEX=gfxFx('fxBigTex',1024),VB_FRAME_MAX=gfxFx('fxBurstMerge',0);
var _comicFrameId=0,_vbFrameId=-1,_vbFrameN=0;   // 帧序号仅由 _comicFxTick 推进(E2-4 同帧闸用)
var _cbPetalTex=null,_cbSplatTex=null,_cbSplatTexs=null,_cbCoreTex=null; // 新火光/烟/亮度贴图
var _cbFireGeo=null,_comicExplosionSmokeGeo=null,_cbLightGeo=null;
var _vbCanopyTex=null,_vbStemTex=null,_vbSkirtTex=null,_vbDebrisTex=null,_vbFlashTex=null;
var _vbCanopyGeo=null,_vbStemGeo=null,_vbSkirtGeo=null,_vbFlashGeo=null;
var _cbLastT=0;
var _cbCamR=new THREE.Vector3(),_cbCamU=new THREE.Vector3(),_cbCamF=new THREE.Vector3();
var _cbGroundN=new THREE.Vector3(0,1,0),_cbGroundUp=new THREE.Vector3(0,1,0);
/* 最新径向火光以1024画布(512,512)为视觉中心;地面高亮仍保留5.5cm深度偏移。 */
var CB_GROUND_EPS=.055;
/* 火箭火光/烟延迟由通用 COMIC_EXP_ROCKET 参数控制。 */
var _cbScaleCtx={ready:false,epoch:0,scoped:false,cx:0,cy:0,cz:0};
/* 与载具殉爆完全一致的印刷色板:墨黑轮廓、橙色外焰、纯黄主体、暖黄高光。 */
var COMIC_DET_INK='#1b100b',COMIC_DET_ORANGE='#f26a21',COMIC_DET_ORANGE_HI='#ff8d19',COMIC_DET_YELLOW='#ffc400',COMIC_DET_YELLOW_HI='#ffd72a',COMIC_DET_RUST='#d84b25';
/* ★E2-1(附录 B):爆炸贴图边长按画质档。绘制代码全部按 1024 基准的硬编码坐标写死,
   所以这里只换画布尺寸 + 一次 g.scale(S/1024) —— 下面几百行贝塞尔/花瓣/尖芒坐标**一个都不用改**,
   图案逐点等比缩小。火光 1 张 + 烟 3 变体 = 21MB → 5.3MB(含 mip),采样带宽 −75%。 */
function _cbTexCanvas(){
  var S=CB_BIG_TEX,cv=document.createElement('canvas');cv.width=cv.height=S;
  var g=cv.getContext('2d');g.clearRect(0,0,S,S);
  if(S!==1024)g.scale(S/1024,S/1024);
  g.lineJoin='round';g.lineCap='round';
  return {cv:cv,g:g};
}
function _cbMakeRocketFireTex(){
  var _c=_cbTexCanvas(),cv=_c.cv,g=_c.g,rnd=mulberry32(0xF17E2028);
  function poly(pts,fill,stroke,lw){g.beginPath();g.moveTo(pts[0][0],pts[0][1]);for(var i=1;i<pts.length;i++)g.lineTo(pts[i][0],pts[i][1]);g.closePath();g.fillStyle=fill;g.fill();if(stroke){g.strokeStyle=stroke;g.lineWidth=lw||10;g.stroke();}}
  /* 最新参考图的放射尖芒:以(512,512)为唯一中心,亮黄长芒配少量白色内芒。 */
  function spike(tx,ty,bx,by,w,fill){var dx=tx-bx,dy=ty-by,L=Math.sqrt(dx*dx+dy*dy)||1,px=-dy/L,py=dx/L;poly([[bx+px*w,by+py*w],[tx,ty],[bx-px*w,by-py*w],[bx-dx*.12,by-dy*.12]],fill,null,0);}
  var rays=[[512,36,512,407,43],[324,106,449,421,24],[185,191,420,438,31],[54,344,397,470,37],[21,515,393,513,35],[68,684,402,555,34],[148,824,431,590,38],[292,957,472,615,35],[500,1005,510,620,43],[653,927,552,610,34],[808,838,588,578,31],[979,670,625,548,38],[998,480,627,496,34],[923,320,607,456,29],[813,190,574,420,25]];
  for(var i=0;i<rays.length;i++){var r=rays[i];spike(r[0],r[1],r[2],r[3],r[4],i%4===0?'#ffe527':'#ffd20a');}
  var whiteRays=[[257,292,430,448,21],[151,438,405,493,25],[266,704,438,577,22],[397,859,485,614,19],[607,842,548,610,20],[828,685,596,557,21],[874,388,610,468,18],[683,241,557,420,18]];
  for(i=0;i<whiteRays.length;i++){r=whiteRays[i];spike(r[0],r[1],r[2],r[3],r[4],'#fff9dc');}
  /* 中央黄色爆轰星填满尖芒根部,避免卡片中心出现空洞。 */
  var star=[],sn=28;for(i=0;i<sn;i++){var a=i/sn*TAU,rr=i%2?132:(195+(i%4)*11);star.push([512+Math.cos(a)*rr,512+Math.sin(a)*rr]);}poly(star,'#ffd40c','#e95813',12);
  function petal(x,y,rx,ry,rot,fill,edge,hot){g.save();g.translate(x,y);g.rotate(rot);g.beginPath();g.moveTo(-rx*.92,ry*.10);g.bezierCurveTo(-rx*1.08,-ry*.25,-rx*.72,-ry*.67,-rx*.39,-ry*.52);g.bezierCurveTo(-rx*.23,-ry*.98,rx*.25,-ry*1.02,rx*.40,-ry*.56);g.bezierCurveTo(rx*.78,-ry*.72,rx*1.04,-ry*.25,rx*.87,ry*.08);g.bezierCurveTo(rx*1.02,ry*.40,rx*.62,ry*.77,rx*.30,ry*.58);g.bezierCurveTo(rx*.05,ry*.94,-rx*.42,ry*.86,-rx*.48,ry*.55);g.bezierCurveTo(-rx*.83,ry*.67,-rx*1.04,ry*.37,-rx*.92,ry*.10);g.closePath();g.fillStyle=fill;g.fill();g.strokeStyle=edge;g.lineWidth=12;g.stroke();if(hot){g.beginPath();g.moveTo(-rx*.48,-ry*.02);g.bezierCurveTo(-rx*.38,-ry*.47,rx*.04,-ry*.58,rx*.25,-ry*.31);g.bezierCurveTo(rx*.02,-ry*.20,-rx*.02,ry*.13,rx*.15,ry*.29);g.bezierCurveTo(-rx*.18,ry*.22,-rx*.46,ry*.18,-rx*.48,-ry*.02);g.closePath();g.fillStyle=hot;g.fill();}g.restore();}
  /* 红橙外层只形成靠近轮廓的花瓣,主体随后由金橙和黄色云瓣覆盖。 */
  var outer=[[512,350,108,92,0],[610,374,101,88,.45],[684,448,100,91,.88],[694,548,99,91,1.35],[635,632,103,89,1.86],[536,678,106,91,2.36],[433,663,105,90,2.83],[352,596,100,89,-2.93],[329,497,103,92,-2.50],[379,405,101,88,-1.98]];
  for(i=0;i<outer.length;i++){var o=outer[i],base=i%3===0?'#e94b16':'#ff6500';petal(o[0],o[1],o[2],o[3],o[4],base,'#c83b19',i%2?'#ff8a00':null);}
  /* 金橙中层覆盖大部分红瓣,形成参考图的同心爆炸云。 */
  var middle=[[512,407,91,78,0],[596,428,87,77,.55],[637,508,88,79,1.08],[598,589,91,78,1.88],[510,619,92,80,2.48],[425,584,89,77,2.91],[389,505,89,79,-2.78],[429,433,87,76,-1.95]];
  for(i=0;i<middle.length;i++){var m=middle[i];petal(m[0],m[1],m[2],m[3],m[4],i%2?'#ff9800':'#ffae00','#ed5a0d','#ffd31a');}
  /* 黄色核心云严格围绕画布中心,内含暖白四瓣闪核。 */
  petal(512,512,125,111,.05,'#ffd31a','#ff8c00','#ffe94a');
  petal(512,512,80,70,-.12,'#ffe12b','#ffb400','#fff06a');
  g.fillStyle='#fff9d8';for(i=0;i<5;i++){a=i/5*TAU-.42;g.beginPath();g.ellipse(512+Math.cos(a)*22,512+Math.sin(a)*19,24,17,a,0,TAU);g.fill();}
  g.beginPath();g.arc(512,512,18,0,TAU);g.fillStyle='#fffde9';g.fill();
  /* 参考图中的脱离小火团;全部远离主轮廓且不改变爆心。 */
  function miniCloud(x,y,s,rot){g.save();g.translate(x,y);g.rotate(rot);for(var j=0;j<4;j++){var aa=j/4*TAU+(j%2)*.16,rr=j===0?s*.34:s*.25;g.beginPath();g.arc(Math.cos(aa)*s*.24,Math.sin(aa)*s*.20,rr,0,TAU);g.fillStyle=j===0?'#ff9800':'#ff7a00';g.fill();}g.restore();}
  miniCloud(174,248,54,-.18);miniCloud(846,362,43,.28);miniCloud(846,726,88,.18);miniCloud(924,704,31,-.12);
  /* 极少数微小橙色碎焰。 */for(i=0;i<5;i++){var px=118+rnd()*800,py=205+rnd()*585;if(Math.abs(px-512)<240&&Math.abs(py-512)<230)continue;g.beginPath();g.arc(px,py,8+rnd()*7,0,TAU);g.fillStyle='#ff9500';g.fill();}
  var t=new THREE.CanvasTexture(cv);t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;if(THREE.sRGBEncoding)t.encoding=THREE.sRGBEncoding;return t;}
function _cbMakeRocketSmokeTex(v){
  var _c=_cbTexCanvas(),cv=_c.cv,g=_c.g;
  /* FX7-CB:3变体构图(v=0端正/1宽冠斜柱/2高穹粗柱) */
  paintCB(g,v||0);
  var t=new THREE.CanvasTexture(cv);t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;if(THREE.sRGBEncoding)t.encoding=THREE.sRGBEncoding;return t;}

function _cbMakeRocketLightTex(){var cv=document.createElement('canvas');cv.width=cv.height=128;var g=cv.getContext('2d'),r=g.createRadialGradient(64,64,0,64,64,63);r.addColorStop(0,'rgba(255,255,230,.95)');r.addColorStop(.25,'rgba(255,216,92,.62)');r.addColorStop(.65,'rgba(255,112,14,.20)');r.addColorStop(1,'rgba(255,75,5,0)');g.fillStyle=r;g.fillRect(0,0,128,128);var t=new THREE.CanvasTexture(cv);t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;return t;}
function _cbBuildEntry(slot){var grp=new THREE.Group(),face=new THREE.Group(),e={on:false,t:0,age:0,life:2.8,mirror:1,sMul:1,sizeJitter:_sfxJit(),yieldK:1,scaleEpoch:-1,rangeVisible:true,distRef:55,distMin:.95,distMax:gfxFx('fxDistMax',3.4),scalePointY:0,burstY:0};
  e.fireMat=new THREE.MeshBasicMaterial({map:_cbPetalTex,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,blending:THREE.NormalBlending,toneMapped:false,fog:false});
  e.smokeMat=new THREE.MeshBasicMaterial({map:_cbSplatTex,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,fog:true});
  e.lightMat=new THREE.MeshBasicMaterial({map:_cbCoreTex,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false,fog:false});
  e.fire=new THREE.Mesh(_cbFireGeo,e.fireMat);e.smoke=new THREE.Mesh(_comicExplosionSmokeGeo,e.smokeMat);e.light=new THREE.Mesh(_cbLightGeo,e.lightMat);e.light.renderOrder=9;e.fire.renderOrder=12+slot*.001;e.smoke.renderOrder=11+slot*.001;   // 槽级微差:跨爆点同类卡排序恒定(防深度贴近逐帧翻转闪烁),层间关系不变
  e.fire.position.y=0;
  face.add(e.fire);face.add(e.smoke);grp.add(face);grp.add(e.light);grp.visible=false;e.face=face;e.group=grp;scene.add(grp);return e;}
function _cbEnsurePool(){if(_cbPool)return;_cbPetalTex=_cbMakeRocketFireTex();if(!_cbSplatTex){_cbSplatTex=_cbMakeRocketSmokeTex(0);_cbSplatTexs=[_cbSplatTex,_cbMakeRocketSmokeTex(1),_cbMakeRocketSmokeTex(2)];}_cbCoreTex=_cbMakeRocketLightTex();
  /* 火光使用中心原点(面积扩大至4倍=平面尺寸28×28);爆炸烟贴图/几何同步放大至32×42。 */
  _cbFireGeo=new THREE.PlaneGeometry(28,28);
  if(!_comicExplosionSmokeGeo)_comicExplosionSmokeGeo=new THREE.PlaneGeometry(32,42);_cbLightGeo=new THREE.PlaneGeometry(1,1);_cbLightGeo.rotateX(-Math.PI*.5);
  _cbPool=[];for(var i=0;i<CB_POOL;i++)_cbPool.push(_cbBuildEntry(i));}

/* ============================================================
   载具殉爆/燃爆蘑菇云(完全重制,造型参考用户给定手绘图)
   ----------------------------------------------------------------
   载具火光资产完全独立(不复用火箭花球贴图),仅小型后续烟共享通用爆炸烟:
   ① 宽扁多瓣云冠:黄/橙大色块、黑色手绘外轮廓与内部翻卷线;
   ② 窄高爆燃柱:由地面直通云冠,中央黄色炽焰、两侧橙红撕裂火舌;
   ③ 贴地锈红冲击裙:低矮横向铺开并带尖刺/液滴,明确把爆心钉在残骸上;
   ④ 独立暖色碎块与短促星形闪核;没有火箭爆点的放射长芒;
   ⑤ 火光之后出现约火箭烟43%尺寸的小型蘑菇烟,并沿用统一爆炸时序。

   性能/远距/多角度沿用火箭效果的方法而非画法:
   · 5 张 CanvasTexture 仅首次载具爆炸烘焙;主几何全池共享,每槽只保留独立材质透明度;
   · 固定 8 槽池,忙时覆盖最老槽;无粒子、无灯光、无逐帧对象分配;含后续烟时单爆点峰值 6 draw call;
   · 云冠/火柱/地裙共用一个绕 Y 轴朝向相机的 face 组,任意方位都保持参考图剪影;
     云冠和地裙几何另含水平顶片,俯视也不会薄成一条线;
   · 70m 后作有限屏幕尺寸补偿、2km 硬裁剪;仅 18 个飞屑四边形逐帧改写(池内 TypedArray)。
   ============================================================ */

/* 云冠:不是圆形火球,而是横向展开的多瓣蘑菇伞盖。 */
function _vbMakeCanopyTex() {
  var cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
  var g = cv.getContext('2d');
  g.clearRect(0, 0, 512, 512);
  g.lineJoin = 'round'; g.lineCap = 'round';

  /* 外轮廓:宽扁云冠,下缘内收;底部留透明区,贴片中心仍可与柄柱重叠。 */
  g.beginPath();
  g.moveTo(42, 375);
  g.bezierCurveTo(15, 360, 17, 321, 43, 306);
  g.bezierCurveTo(22, 273, 41, 231, 79, 235);
  g.bezierCurveTo(66, 191, 96, 151, 139, 163);
  g.bezierCurveTo(143, 112, 191, 82, 230, 116);
  g.bezierCurveTo(256, 66, 329, 68, 353, 124);
  g.bezierCurveTo(393, 107, 433, 137, 428, 179);
  g.bezierCurveTo(473, 174, 500, 213, 483, 252);
  g.bezierCurveTo(516, 276, 500, 325, 461, 329);
  g.bezierCurveTo(464, 368, 420, 391, 390, 365);
  g.bezierCurveTo(365, 396, 323, 396, 301, 365);
  g.bezierCurveTo(274, 397, 230, 397, 207, 363);
  g.bezierCurveTo(180, 397, 137, 390, 126, 358);
  g.bezierCurveTo(101, 388, 61, 399, 42, 375);
  g.closePath();
  g.fillStyle = COMIC_DET_ORANGE; g.fill();
  g.lineWidth = 16; g.strokeStyle = COMIC_DET_INK; g.stroke();

  /* 主黄云团:整体连成一顶伞,不画成若干火箭火球贴片。 */
  g.beginPath();
  g.moveTo(76, 327);
  g.bezierCurveTo(52, 306, 65, 269, 94, 270);
  g.bezierCurveTo(86, 229, 117, 202, 151, 216);
  g.bezierCurveTo(143, 170, 184, 143, 219, 166);
  g.bezierCurveTo(232, 112, 298, 105, 326, 151);
  g.bezierCurveTo(367, 133, 401, 170, 391, 208);
  g.bezierCurveTo(434, 200, 463, 237, 446, 275);
  g.bezierCurveTo(468, 306, 439, 341, 405, 329);
  g.bezierCurveTo(384, 360, 343, 357, 327, 326);
  g.bezierCurveTo(301, 353, 261, 350, 246, 319);
  g.bezierCurveTo(222, 351, 180, 349, 163, 318);
  g.bezierCurveTo(137, 348, 96, 352, 76, 327);
  g.closePath();
  g.fillStyle = COMIC_DET_YELLOW; g.fill();
  g.lineWidth = 8; g.strokeStyle = COMIC_DET_INK; g.stroke();

  /* 翻卷阴影与内部瓣线:少量粗线保持远距可读,不用噪点堆细节。 */
  g.fillStyle = COMIC_DET_ORANGE_HI;
  g.beginPath(); g.ellipse(112, 309, 42, 34, -0.18, 0, 6.2832); g.fill();
  g.beginPath(); g.ellipse(400, 290, 47, 38, 0.18, 0, 6.2832); g.fill();
  g.beginPath(); g.ellipse(204, 327, 40, 27, 0, 0, 6.2832); g.fill();
  g.strokeStyle = COMIC_DET_INK; g.lineWidth = 7;
  g.beginPath(); g.moveTo(78, 286); g.bezierCurveTo(103, 245, 144, 248, 159, 280); g.stroke();
  g.beginPath(); g.moveTo(146, 214); g.bezierCurveTo(176, 184, 222, 196, 228, 239); g.stroke();
  g.beginPath(); g.moveTo(222, 167); g.bezierCurveTo(263, 147, 310, 169, 310, 216); g.stroke();
  g.beginPath(); g.moveTo(317, 202); g.bezierCurveTo(351, 179, 396, 203, 391, 246); g.stroke();
  g.beginPath(); g.moveTo(334, 310); g.bezierCurveTo(365, 276, 413, 279, 432, 310); g.stroke();

  /* 顶部暖黄受光块,呼应参考图中央大黄云。 */
  g.beginPath();
  g.moveTo(215, 186);
  g.bezierCurveTo(209, 145, 243, 116, 277, 132);
  g.bezierCurveTo(303, 107, 347, 128, 345, 166);
  g.bezierCurveTo(374, 179, 367, 219, 337, 226);
  g.bezierCurveTo(319, 250, 281, 244, 274, 218);
  g.bezierCurveTo(248, 233, 216, 216, 215, 186);
  g.closePath(); g.fillStyle = COMIC_DET_YELLOW_HI; g.fill();
  g.lineWidth = 6; g.strokeStyle = '#d45118'; g.stroke();

  return _comicCanvasTex(cv);
}

/* 爆燃柱:窄底、上端分叉并插入云冠;黄芯与橙红外焰各自成形。 */
function _vbMakeStemTex() {
  var cv = document.createElement('canvas'); cv.width = 256; cv.height = 512;
  var g = cv.getContext('2d');
  g.clearRect(0, 0, 256, 512);
  g.lineJoin = 'round'; g.lineCap = 'round';

  g.beginPath();
  g.moveTo(24, 500);
  g.lineTo(48, 433); g.lineTo(31, 355); g.lineTo(78, 382);
  g.lineTo(57, 259); g.lineTo(105, 303); g.lineTo(88, 151);
  g.lineTo(126, 230); g.lineTo(174, 115); g.lineTo(157, 280);
  g.lineTo(226, 209); g.lineTo(188, 366); g.lineTo(232, 343);
  g.lineTo(204, 438); g.lineTo(239, 500);
  g.closePath();
  g.fillStyle = COMIC_DET_ORANGE; g.fill();
  g.lineWidth = 13; g.strokeStyle = COMIC_DET_INK; g.stroke();

  g.beginPath();
  g.moveTo(73, 499);
  g.lineTo(96, 408); g.lineTo(78, 331); g.lineTo(116, 366);
  g.lineTo(128, 245); g.lineTo(145, 344); g.lineTo(184, 278);
  g.lineTo(162, 407); g.lineTo(190, 500);
  g.closePath();
  g.fillStyle = COMIC_DET_YELLOW; g.fill();
  g.lineWidth = 8; g.strokeStyle = COMIC_DET_INK; g.stroke();

  g.beginPath();
  g.moveTo(111, 487); g.lineTo(126, 400); g.lineTo(139, 476);
  g.lineTo(153, 499); g.lineTo(105, 499); g.closePath();
  g.fillStyle = '#ffe43b'; g.fill();
  return _comicCanvasTex(cv);
}

/* 贴地冲击裙:锈红低矮横向喷溅,与参考图底部轮廓一致。 */
function _vbMakeSkirtTex() {
  var cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  var g = cv.getContext('2d');
  g.clearRect(0, 0, 512, 256);
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath();
  g.moveTo(8, 224); g.lineTo(70, 220); g.lineTo(50, 201); g.lineTo(103, 205);
  g.lineTo(82, 160); g.lineTo(137, 190); g.lineTo(123, 121); g.lineTo(184, 176);
  g.lineTo(215, 137); g.lineTo(237, 183); g.lineTo(259, 151); g.lineTo(282, 188);
  g.lineTo(322, 131); g.lineTo(314, 188); g.lineTo(382, 149); g.lineTo(365, 201);
  g.lineTo(425, 182); g.lineTo(409, 211); g.lineTo(475, 201); g.lineTo(455, 221);
  g.lineTo(504, 224); g.closePath();
  g.fillStyle = COMIC_DET_RUST; g.fill();
  g.lineWidth = 13; g.strokeStyle = COMIC_DET_INK; g.stroke();
  g.beginPath(); g.moveTo(10, 224); g.lineTo(502, 224); g.lineWidth = 8; g.strokeStyle = COMIC_DET_INK; g.stroke();
  return _comicCanvasTex(cv);
}

/* 载具碎块:独立椭圆火屑,绝不复用火箭墨滴。 */
function _vbMakeDebrisTex() {
  var cv = document.createElement('canvas'); cv.width = cv.height = 64;
  var g = cv.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.save(); g.translate(32, 32); g.rotate(-0.55);
  g.beginPath(); g.ellipse(0, 0, 18, 8, 0, 0, 6.2832);
  g.fillStyle = '#ff9b16'; g.fill(); g.lineWidth = 5; g.strokeStyle = COMIC_DET_INK; g.stroke();
  g.beginPath(); g.ellipse(-5, -2, 7, 3, 0, 0, 6.2832); g.fillStyle = '#ffd42a'; g.fill();
  g.restore();
  g.beginPath(); g.arc(51, 15, 3.2, 0, 6.2832); g.fillStyle = '#241109'; g.fill();
  return _comicCanvasTex(cv);
}

/* 短促闪核:透明背景上的暖白星爆;只活 0.18s,不承担蘑菇云造型。 */
function _vbMakeFlashTex() {
  var cv = document.createElement('canvas'); cv.width = cv.height = 128;
  var g = cv.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  var rg = g.createRadialGradient(64, 64, 0, 64, 64, 61);
  rg.addColorStop(0, 'rgba(255,255,240,1)');
  rg.addColorStop(0.28, 'rgba(255,231,89,0.95)');
  rg.addColorStop(0.62, 'rgba(255,137,24,0.55)');
  rg.addColorStop(1, 'rgba(255,94,10,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  g.beginPath();
  for (var i = 0; i < 16; i++) {
    var a = -1.5708 + i * 3.1416 / 8, r = i % 2 ? 15 : (i % 4 ? 48 : 61);
    var x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath(); g.fillStyle = 'rgba(255,238,118,0.72)'; g.fill();
  g.globalCompositeOperation = 'source-over';
  return _comicCanvasTex(cv);
}

function _vbMergePlanes(jobs) {
  var geo = mergeGeometries(jobs, false, false, false);
  for (var i = 0; i < jobs.length; i++) jobs[i].geo.dispose();
  if (geo) geo.computeBoundingSphere();
  return geo;
}

/* 竖直正面 + 水平顶片:face 组负责水平朝向相机,顶片负责高机位。 */
function _vbBuildCanopyGeo() {
  var jobs = [];
  var gf = new THREE.PlaneGeometry(14.6, 7.4);
  jobs.push({ geo: gf, m4: new THREE.Matrix4().makeTranslation(0, 7.65, 0) });
  var gt = new THREE.PlaneGeometry(13.8, 9.2);
  var mt = new THREE.Matrix4(), qt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.5708, 0, 0));
  mt.compose(new THREE.Vector3(0, 9.15, 0), qt, new THREE.Vector3(1, 1, 1));
  jobs.push({ geo: gt, m4: mt });
  return _vbMergePlanes(jobs);
}
function _vbBuildStemGeo() {
  var g = new THREE.PlaneGeometry(6.4, 8.8);
  return _vbMergePlanes([{ geo: g, m4: new THREE.Matrix4().makeTranslation(0, 4.35, 0) }]);
}
function _vbBuildSkirtGeo() {
  var jobs = [];
  var gv = new THREE.PlaneGeometry(16.8, 3.4);
  jobs.push({ geo: gv, m4: new THREE.Matrix4().makeTranslation(0, 1.25, 0) });
  var gh = new THREE.PlaneGeometry(16.8, 11.0);
  var mh = new THREE.Matrix4(), qh = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.5708, 0, 0));
  mh.compose(new THREE.Vector3(0, 0.16, 0), qh, new THREE.Vector3(1, 1, 1));
  jobs.push({ geo: gh, m4: mh });
  return _vbMergePlanes(jobs);
}
function _vbBuildFlashGeo() {
  var g = new THREE.PlaneGeometry(1, 1); g.computeBoundingSphere(); return g;
}

/* 每槽必须有独立 position;其余数组很小,初始化一次后永久复用。 */
function _vbBuildDebrisGeo(n) {
  var pos = new Float32Array(n * 12), uv = new Float32Array(n * 8), col = new Float32Array(n * 12);
  var idx = new Uint16Array(n * 6);
  for (var i = 0; i < n; i++) {
    var vi = i * 4, uo = i * 8, co = i * 12, io = i * 6;
    uv[uo] = 0; uv[uo + 1] = 0; uv[uo + 2] = 1; uv[uo + 3] = 0;
    uv[uo + 4] = 1; uv[uo + 5] = 1; uv[uo + 6] = 0; uv[uo + 7] = 1;
    var hot = i % 4 !== 0;
    var r = hot ? 1.0 : 0.72, gg = hot ? 0.9 : 0.36, b = hot ? 0.48 : 0.2;
    for (var k = 0; k < 4; k++) { col[co + k * 3] = r; col[co + k * 3 + 1] = gg; col[co + k * 3 + 2] = b; }
    idx[io] = vi; idx[io + 1] = vi + 1; idx[io + 2] = vi + 2;
    idx[io + 3] = vi; idx[io + 4] = vi + 2; idx[io + 5] = vi + 3;
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

function _vbBuildEntry(seedI) {
  var grp = new THREE.Group(), face = new THREE.Group();
  var e = {
    on: false, age: 0, t: 0, life: 2.75, sMul: 1, sizeJitter: _sfxJit(), yieldK: 1,
    scaleEpoch: -1, rangeVisible: true, distRef: 70, distMin: 0.94, distMax: Math.min(3.1, gfxFx('fxDistMax', 3.1)), scalePointY: 1.5,
    phase: seedI * 1.73, spN: 18,
    spDir: new Float32Array(18 * 3), spVel: new Float32Array(18), spSize: new Float32Array(18)
  };
  e.canopyMat = new THREE.MeshBasicMaterial({ map: _vbCanopyTex, transparent: true, alphaTest: 0.055,
    depthWrite: false, side: THREE.DoubleSide, fog: true });
  e.smokeMat = new THREE.MeshBasicMaterial({ map: _cbSplatTex, transparent: true, opacity: 0,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: true });
  e.stemMat = new THREE.MeshBasicMaterial({ map: _vbStemTex, transparent: true, alphaTest: 0.055,
    depthWrite: false, side: THREE.DoubleSide, fog: true });
  e.skirtMat = new THREE.MeshBasicMaterial({ map: _vbSkirtTex, transparent: true, alphaTest: 0.055,
    depthWrite: false, side: THREE.DoubleSide, fog: true });
  e.debrisMat = new THREE.MeshBasicMaterial({ map: _vbDebrisTex, transparent: true, alphaTest: 0.06,
    depthWrite: false, side: THREE.DoubleSide, vertexColors: true, fog: true });
  e.flashMat = new THREE.MeshBasicMaterial({ map: _vbFlashTex, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });

  e.smoke = new THREE.Mesh(_comicExplosionSmokeGeo, e.smokeMat); e.smoke.renderOrder = 8; e.smoke.frustumCulled = false; e.smoke.visible = false;
  e.flash = new THREE.Mesh(_vbFlashGeo, e.flashMat); e.flash.renderOrder = 9; e.flash.frustumCulled = false;
  e.skirt = new THREE.Mesh(_vbSkirtGeo, e.skirtMat); e.skirt.renderOrder = 9; e.skirt.frustumCulled = false;
  e.stem = new THREE.Mesh(_vbStemGeo, e.stemMat); e.stem.renderOrder = 10; e.stem.frustumCulled = false;
  e.canopy = new THREE.Mesh(_vbCanopyGeo, e.canopyMat); e.canopy.renderOrder = 11; e.canopy.frustumCulled = false;
  e.debris = new THREE.Mesh(_vbBuildDebrisGeo(e.spN), e.debrisMat); e.debris.renderOrder = 12; e.debris.frustumCulled = false;
  e.flash.position.y = 3.7;
  face.add(e.smoke); face.add(e.flash); face.add(e.skirt); face.add(e.stem); face.add(e.canopy);
  grp.add(face); grp.add(e.debris);
  grp.visible = false;
  e.face = face; e.group = grp;
  scene.add(grp);
  return e;
}

/* 载具火光资源仍独立懒建;只共享通用爆炸烟贴图/几何与出现时序,不创建火箭池槽。 */
function _vbEnsurePool() {
  if (_vbPool) return;
  if (!_cbSplatTex) _cbSplatTex = _cbMakeRocketSmokeTex(0);
  if (!_comicExplosionSmokeGeo) _comicExplosionSmokeGeo = new THREE.PlaneGeometry(16,21);
  _vbCanopyTex = _vbMakeCanopyTex(); _vbStemTex = _vbMakeStemTex();
  _vbSkirtTex = _vbMakeSkirtTex(); _vbDebrisTex = _vbMakeDebrisTex(); _vbFlashTex = _vbMakeFlashTex();
  _vbCanopyGeo = _vbBuildCanopyGeo(); _vbStemGeo = _vbBuildStemGeo();
  _vbSkirtGeo = _vbBuildSkirtGeo(); _vbFlashGeo = _vbBuildFlashGeo();
  _vbPool = [];
  for (var i = 0; i < VB_POOL; i++) _vbPool.push(_vbBuildEntry(i));
}

/* 特效缩放上下文只在必要时刷新:
   ① 进/出炮镜边沿立即刷新;炮镜开启期间整张屏幕统一使用原生尺寸,不再计算圆形镜圈/FOV/视轴;
   ② 第三人称仅在相机累计移动≥4m时刷新距离档。 */
function _cbPrepareScaleContext(nowS, force) {
  if (!camera) return false;
  var C = _cbScaleCtx, sc = typeof scoped !== 'undefined' && scoped;
  var dx = camera.position.x - C.cx, dy = camera.position.y - C.cy, dz = camera.position.z - C.cz;
  var modeEdge = !C.ready || sc !== C.scoped;
  var moved = !sc && dx * dx + dy * dy + dz * dz >= 16;
  if (!force && !modeEdge && !moved) return false;
  camera.getWorldDirection(_cbCamF);
  C.ready = true; C.epoch++; C.scoped = sc;
  C.cx = camera.position.x; C.cy = camera.position.y; C.cz = camera.position.z;
  return true;
}
/* epoch未变化时不再计算距离;进/出炮镜时所有活跃槽同帧切换“全屏原生/第三人称补偿”。 */
function _cbRefreshActiveScale(e, force) {
  var C = _cbScaleCtx;
  if (!C.ready) _cbPrepareScaleContext(performance.now() / 1000, true);
  if (!force && e.scaleEpoch === C.epoch) return e.rangeVisible;
  var px = e.group.position.x, py = e.group.position.y + (e.scalePointY || 0), pz = e.group.position.z;
  var dx = px - C.cx, dy = py - C.cy, dz = pz - C.cz;
  var d2 = dx * dx + dy * dy + dz * dz;
  var scopeNative = C.scoped; // 炮镜原生尺寸/远距门=通用口径(comic_common scopeDistK/scopeFarVisible);GPU 视锥负责屏外剔除
  var distK = scopeDistK(scopeNative, d2, e.distRef, e.distMin, e.distMax) * e.sizeJitter;
  e.sMul = distK * (e.yieldK || 1) * (e.degK || 1);        // ★任务27⑥:降级卡幅面 0.62×(VB 蘑菇云无 degK,恒 1)
  e.scaleEpoch = C.epoch;
  e.rangeVisible = scopeFarVisible(scopeNative, d2);
  e.group.visible = e.rangeVisible;
  return e.rangeVisible;
}

/* 根节点承载地表烟/高亮并跟随当前高度场;火光通过scalePointY反向补偿,中心恒定在真实爆点。
   出生与弹坑合批事件才采样terrainH/terrainNormal,动画帧没有地形查询。 */
function _cbRefreshRocketGround(e) {
  var x=e.group.position.x,z=e.group.position.z,gy=e.burstY;
  if(typeof terrainH==='function'){var hy=terrainH(x,z);if(isFinite(hy))gy=hy;}
  e.group.position.y=gy;e.scalePointY=e.burstY-gy;
  _cbGroundN.set(0,1,0);
  if(typeof terrainNormal==='function'){
    terrainNormal(x,z,_cbGroundN);
    if(!isFinite(_cbGroundN.x)||!isFinite(_cbGroundN.y)||!isFinite(_cbGroundN.z)||_cbGroundN.y<.05)_cbGroundN.set(0,1,0);
  }
  /* 高亮贴图也沿同一坡面落地;沿法线抬高5.5cm避免与新弹坑深度闪烁。 */
  e.light.quaternion.setFromUnitVectors(_cbGroundUp,_cbGroundN);
  e.light.position.set(_cbGroundN.x*CB_GROUND_EPS,_cbGroundN.y*CB_GROUND_EPS,_cbGroundN.z*CB_GROUND_EPS);
}
/* flushCraters 完成一次真实地形破坏后调用。固定 CB_POOL 槽、仅事件触发;
   34m覆盖弹坑完整影响半径(14m×2.4),重叠弹坑会重锚烟/高亮并同步补偿火光中心。 */
function comicRocketBurstTerrainChanged(points) {
  if(!_cbPool||!points||points.length<2)return;
  for(var i=0;i<CB_POOL;i++){
    var e=_cbPool[i];if(!e.on)continue;
    var ex=e.group.position.x,ez=e.group.position.z;
    for(var j=0;j+1<points.length;j+=2){var dx=ex-points[j],dz=ez-points[j+1];if(dx*dx+dz*dz<=1156){_cbRefreshRocketGround(e);break;}}
  }
}

/* ===== 爆点入场(世界坐标; 接收 rSplash 爆炸波及半径,自动计算贴图尺寸) ===== */
function comicArtyBurst(bp, rSplash) {
  if (typeof scene === 'undefined' || !scene) return;
  /* 可见域:爆点不做距离静默(130~2000m 火箭交战域内炸点必须任何距离可读)。
     漫画读法=图标化:屏幕投影大小近似恒定才看得清——尺度随距离线性放大补偿
     (55m 处 1×,封顶 3.4× ≈ 2000m 处仍约 300m 距离观感),2000m 外不再放大;
     进入炮镜后整张屏幕统一保持原生 1×。 */
  _cbPrepareScaleContext(performance.now() / 1000, false);
  var C = _cbScaleCtx, dx0 = bp.x - C.cx, dy0 = bp.y - C.cy, dz0 = bp.z - C.cz;
  if (!scopeFarVisible(C.scoped, dx0 * dx0 + dy0 * dy0 + dz0 * dz0)) return;   // 2km 硬裁剪(镜内直通,通用口径)
  _cbEnsurePool();
  if (_cbLive >= CB_HARD_MAX) return;                      // ★任务27⑥:硬顶跳卡(爆点仍有扬尘/弹坑/焦土/音效,只是不添大卡)
  var e = poolIdleOldest(_cbPool, CB_POOL);               // core.js 通用池规约(空槽优先,全忙抢最旧)
  if (e.on && e.t < e.life * 0.6) return;                 // 丢新保旧:最旧者未播满 60%(烟仍浓)不许抢——中途硬切="突然消失"主根因,极端并发宁缺新爆
  e.on = true; e.t = 0; e.age = ++_cbSerial; e.scaleEpoch = -1; e.mirror = Math.random() < .5 ? -1 : 1;e.smokeMat.map=_cbSplatTexs[(Math.random()*3)|0];
  e.sizeJitter = _sfxJit();
  e.deg = _cbSat ? 1 : 0;                                   // ★任务27⑥:饱和降级(短寿命/小幅面/无地面高亮)
  e.degK = e.deg ? 0.62 : 1;
  e.life = e.deg ? 1.2 : 2.8;
  if (e.deg) _cbDegN++;
  var splashRadius = (rSplash != null && rSplash > 0) ? rSplash : 22.0;
  e.yieldK = Math.min(splashRadius / 22.0, gfxFx('fxYieldMax', 2.0));   // 贴图大小与爆炸半径自动线性关联 (22m=1.0x, 11m=0.5x);★E1-2:当量放大上限按档钳(BLUE_MLRS 44m 本来吃满 2.0)
  e.burstY = bp.y; e.group.position.copy(bp);
  _cbRefreshRocketGround(e);                              // 火光/高亮先钉当前地表;爆心高度另存给炮镜判定
  e.fire.visible = e.smoke.visible = true; e.light.visible = !e.deg && _cbGroundLight; _cbRefreshActiveScale(e); _cbAnim(e, 0);   // ★任务27⑥:降级卡省掉 36m 加法高亮面;★E1-5:触屏档整档关闭该面
}

/* ===== 载具蘑菇云入场(燃爆=1.5,殉爆=2.1) ===== */
function comicBurstFX(bp, scale) {
  if (typeof scene === 'undefined' || !scene) return;
  _cbPrepareScaleContext(performance.now() / 1000, false);
  var C = _cbScaleCtx, dx0 = bp.x - C.cx, dy0 = bp.y - C.cy, dz0 = bp.z - C.cz;
  if (!scopeFarVisible(C.scoped, dx0 * dx0 + dy0 * dy0 + dz0 * dz0)) return;   // 2km 硬裁剪(镜内直通,通用口径)
  /* ★E2-4(附录 B §B.5):链式殉爆同帧闸。一发大当量弹落进车群时,applySplash → 弹药架归零 →
     detonate → explosion → 本函数,可在**同一帧内**连续触发多次;每张殉爆卡是 6 个透明 Mesh
     (冠/柱/裙/闪/烟/碎块),8 槽池会被同帧刷满 = 瞬时 ~48 层近全屏混合。
     闸只挡"同帧第 N 张之后"的大卡,改出小口径爆点卡(3 层)保留爆炸可读性;
     伤害/击毁/音效/弹坑全在调用方,完全不受影响。高档 VB_FRAME_MAX=0 ⇒ 不限,行为与改动前一致。 */
  if (VB_FRAME_MAX > 0) {
    if (_vbFrameId !== _comicFrameId) { _vbFrameId = _comicFrameId; _vbFrameN = 0; }
    if (_vbFrameN >= VB_FRAME_MAX) {
      if (typeof comicArtyBurst === 'function') comicArtyBurst(bp, 16.0);   // 降级:小口径爆点卡(仍有火光+烟,层数减半)
      return;
    }
    _vbFrameN++;
  }
  try { _vbEnsurePool(); } catch (err) { return; }            // 纯视觉失败绝不打断伤害/声音主链
  var e = poolIdleOldest(_vbPool, VB_POOL) || _vbPool[0];
  e.on = true; e.age = ++_vbSerial; e.t = 0; e.scaleEpoch = -1;
  e.yieldK = Math.min(clamp((scale || 1.5) / 1.5, 0.9, 1.28), gfxFx('fxYieldMax', 2.0));   // 殉爆比燃爆宽/高约 28%,不再简单整贴图翻倍;★E1-2:再按档钳当量上限
  /* 炮镜视角整张屏幕使用爆炸当量原生尺寸(燃爆1×、殉爆1.28×),绝不叠加距离补偿;
     退出炮镜后继续采用有限图标化,保证第三人称远景可读。 */
  e.sizeJitter = _sfxJit();          // 镜内亦消费但不应用,保持视觉分支 RNG 调用数不变(_sfxJit 同样只消耗 1 个 Math.random(),幅度统一为 [0.85,1.15])
  e.phase = Math.random() * 6.2832;

  var rnd = mulberry32((Math.random() * 1e9) | 0);
  for (var i = 0; i < e.spN; i++) {
    var az = rnd() * 6.2832, up = 0.12 + rnd() * 0.78;
    var flat = Math.sqrt(Math.max(0.05, 1 - up * up));
    e.spDir[i * 3] = Math.sin(az) * flat;
    e.spDir[i * 3 + 1] = up;
    e.spDir[i * 3 + 2] = Math.cos(az) * flat;
    e.spVel[i] = 8.5 + rnd() * 12.5;
    e.spSize[i] = 0.18 + rnd() * 0.34;
  }

  /* combat.js 传入的是车体中心上方 1.4/1.8m;蘑菇云必须改锚地表,否则地裙会悬空。 */
  var gy = bp.y - 1.5;
  if (typeof terrainH === 'function') {
    var hy = terrainH(bp.x, bp.z);
    if (isFinite(hy)) gy = hy + 0.08;
  }
  e.group.position.set(bp.x, gy, bp.z);
  e.scalePointY = bp.y - gy;                           // 动态炮镜模式/距离判定仍使用原始车体爆心高度
  e.smoke.visible = false; e.smokeMat.opacity = 0;
  e.face.visible = e.flash.visible = e.skirt.visible = e.stem.visible = e.canopy.visible = e.debris.visible = true;
  _vbAnim(e, 0);                                           // 首帧即写正确尺度/朝向,池槽复用不闪旧状态
}

/* ===== 火箭爆点时间轴(载具由 _vbAnim 独立驱动) ===== */
function _cbAnim(e,dt){if(!e.on)return;e.t+=dt;var k=e.t/e.life;if(k>=1){e.on=false;e.group.visible=false;return;}if(e.scaleEpoch!==_cbScaleCtx.epoch)_cbRefreshActiveScale(e);if(!e.rangeVisible)return;
  comicTextureFace(e.face.quaternion,e.group.position.x,e.group.position.y,e.group.position.z,COMIC_FACE_YAW);
  var P=comicExplosionTimeline(e.t,COMIC_EXP_ROCKET),s=e.sMul,fu=P.fireK,fireScale=(.28+.82*(1-Math.pow(1-fu,3)))*s*1.2;
  var fireFade=P.fireAlpha;
  /* 画布中心、平面原点和真实爆点三者重合;地形/弹坑重锚只改变根节点,scalePointY会反向补偿。 */
  e.fire.scale.set(e.mirror*fireScale,fireScale,fireScale);e.fire.position.set(0,e.scalePointY,0);e.fire.rotation.z=0;e.fireMat.opacity=fireFade;e.fire.visible=fireFade>.005;
  var E=comicSmokeExpand(P.smokeAge,COMIC_EXP_ROCKET.smokeLife,.06,1.82,.62,.62,2.8,.72);e.smoke.scale.set(E.scale*s*1.15,E.scale*s*1.15,E.scale*s*1.15);e.smoke.position.y=(8.9+E.rise)*s*1.15;e.smokeMat.opacity=P.smokeOn?.92*E.alpha:0;e.smoke.visible=P.smokeOn;
  if(_cbGroundLight){var lf=Math.max(0,1-e.t/.38);e.light.scale.set(36*s,1,36*s);e.lightMat.opacity=.40*lf;}   // ★E1-5:关档时连尺度/透明度都不必算(该面恒不可见)
}
/* 载具专属时间轴:地裙先铺、火柱上冲、云冠随后横向翻开;不再套用火箭花球动画。 */
function _vbAnim(e, dt) {
  if (!e.on) return;
  e.t += dt;
  var t = e.t, tn = t / e.life;
  if (tn >= 1) { e.on = false; e.group.visible = false; return; }
  if (e.scaleEpoch !== _cbScaleCtx.epoch) _cbRefreshActiveScale(e); // cache miss 才调用
  if (!e.rangeVisible) return;

  /* 圆柱广告牌:只绕世界 Y,地面仍保持水平;任意水平观察角都见完整参考图剪影。 */
  comicTextureFace(e.face.quaternion,e.group.position.x,e.group.position.y,e.group.position.z,COMIC_FACE_YAW);

  var XP=comicExplosionTimeline(t,COMIC_EXP_VEHICLE),s = e.sMul;
  var su = XP.fireK, stemE = 1 - Math.pow(1 - su, 3);
  e.stem.scale.set(s * (0.58 + 0.42 * stemE), s * (0.055 + 0.945 * stemE), s);

  var cu = clamp((t - 0.055) / 0.40, 0, 1);
  var cm = cu - 1, capE = cu <= 0 ? 0.045 : 1 + 2.25 * cm * cm * cm + 1.25 * cm * cm; // easeOutBack
  var linger = clamp((t - 0.48) / 1.0, 0, 1);
  var wob = 1 + Math.sin(t * 7.5 + e.phase) * 0.018;
  e.canopy.scale.set(s * capE * (1 + 0.10 * linger) * wob,
                     s * capE * (1 - 0.045 * linger) / wob,
                     s * capE * (1 + 0.065 * linger));
  e.canopy.position.y = linger * 0.48 * s;                    // 成形后仅缓抬,底缘仍压住火柱

  var gu = clamp(t / 0.27, 0, 1), groundE = 1 - Math.pow(1 - gu, 3);
  e.skirt.scale.set(s * (0.12 + 0.88 * groundE), s * (0.36 + 0.64 * groundE), s * (0.18 + 0.82 * groundE));

  var fu = clamp(t / 0.18, 0, 1), fs = s * (5.0 + 7.0 * fu);
  e.flash.position.y = 3.5 * s;
  e.flash.scale.set(fs, fs, fs);
  e.flashMat.opacity = Math.pow(1 - fu, 2) * 0.92;
  if (fu >= 1 && e.flash.visible) e.flash.visible = false;

  var capFade = 1 - clamp((t - 1.18) / 0.72, 0, 1);
  var stemFade = 1 - clamp((t - 1.02) / 0.70, 0, 1);
  var skirtFade = 1 - clamp((t - 0.72) / 0.78, 0, 1);
  e.canopyMat.opacity = capFade * XP.fireAlpha;
  e.stemMat.opacity = stemFade * XP.fireAlpha;
  e.skirtMat.opacity = skirtFade * XP.fireAlpha;

  /* 小型载具爆炸烟延迟到火光成形后出现;与火箭烟共享贴图/几何和通用出现时序。 */
  var VE=comicSmokeExpand(XP.smokeAge,COMIC_EXP_VEHICLE.smokeLife,.07,1.58,.66,.66,1.75,.72),vss=.43*VE.scale*s;
  e.smoke.scale.set(vss,vss,vss);e.smoke.position.y=(4.15+VE.rise*.58)*s;e.smokeMat.opacity=XP.smokeOn?.78*VE.alpha:0;e.smoke.visible=XP.smokeOn;

  if (t < 1.48) {
    e.debris.visible = true;
    _vbWriteDebris(e, t);
    e.debrisMat.opacity = 1 - clamp((t - 0.86) / 0.62, 0, 1);
  } else if (e.debris.visible) e.debris.visible = false;
}

/* 动态广告牌若中心位于相机后方或距近裁剪面不足一个半对角,四边形会被 near plane 切成横贯屏幕的细条。
   两池都关闭原生包围球剔除,因此必须逐卡做前向深度守卫;不合格卡压成零面积点,不产生 draw-call 增量。 */
function _cbCardInFront(e, px, py, pz, size) {
  if (!camera || !isFinite(px) || !isFinite(py) || !isFinite(pz) || !isFinite(size)) return false;
  var wx = e.group.position.x + px - camera.position.x;
  var wy = e.group.position.y + py - camera.position.y;
  var wz = e.group.position.z + pz - camera.position.z;
  var depth = wx * _cbCamF.x + wy * _cbCamF.y + wz * _cbCamF.z;
  return depth > (camera.near || 0.1) + size * 1.45;
}
function _cbCollapseQuad(arr, o, px, py, pz) {
  for (var k = 0; k < 4; k++) {
    var q = o + k * 3; arr[q] = px; arr[q + 1] = py; arr[q + 2] = pz;
  }
}
/* 18 片飞屑写局部坐标;无 computeBoundingSphere 热分配。 */
function _vbWriteDebris(e, t) {
  var arr = e.debris.geometry.attributes.position.array;
  var pathK = Math.sqrt(e.sMul), baseY = 1.15 * e.sMul;
  for (var i = 0; i < e.spN; i++) {
    var size = e.spSize[i] * e.sMul * (1 + t * 0.34);
    var rx = _cbCamR.x * size, ry = _cbCamR.y * size, rz = _cbCamR.z * size;
    var ux = _cbCamU.x * size, uy = _cbCamU.y * size, uz = _cbCamU.z * size;
    var travel = e.spVel[i] * t / (1 + t * 1.35) * pathK;
    var px = e.spDir[i * 3] * travel;
    var py = Math.max(0.12, baseY + e.spDir[i * 3 + 1] * travel - 4.2 * t * t * pathK);
    var pz = e.spDir[i * 3 + 2] * travel;
    var o = i * 12;
    if (!_cbCardInFront(e, px, py, pz, size)) {
      _cbCollapseQuad(arr, o, px, py, pz);
      continue;
    }
    arr[o] = px - rx - ux;      arr[o + 1] = py - ry - uy;  arr[o + 2] = pz - rz - uz;
    arr[o + 3] = px + rx - ux;  arr[o + 4] = py + ry - uy;  arr[o + 5] = pz + rz - uz;
    arr[o + 6] = px + rx + ux;  arr[o + 7] = py + ry + uy;  arr[o + 8] = pz + rz + uz;
    arr[o + 9] = px - rx + ux;  arr[o + 10] = py - ry + uy; arr[o + 11] = pz - rz + uz;
  }
  e.debris.geometry.attributes.position.needsUpdate = true;
}

function _cbTick(dt, nowS) {
  if (!_cbPool && !_vbPool) return;
  var i, any = false;
  if (_cbPool) {                                             // ★任务27⑥:活跃卡普查(既有扫描改计数,零新增遍历)+饱和滞回
    var live = 0;
    for (i = 0; i < CB_POOL; i++) if (_cbPool[i].on) live++;
    _cbLive = live; any = live > 0;
    if (_cbSat) { if (live <= CB_SAT_LO) _cbSat = false; }
    else if (live >= CB_SAT_HI) _cbSat = true;
  }
  if (!any && _vbPool) for (i = 0; i < VB_POOL; i++) if (_vbPool[i].on) { any = true; break; }
  if (!any) return;
  var scaleForwardFresh = _cbPrepareScaleContext(nowS, false);
  if (camera) {                                              // 两池飞屑广告牌基底/前向每帧只求一次
    _cbCamR.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _cbCamU.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (!scaleForwardFresh) camera.getWorldDirection(_cbCamF); // context 刷新帧已计算,避免重复
  }
  if (_cbPool) for (i = 0; i < CB_POOL; i++) _cbAnim(_cbPool[i], dt);
  if (_vbPool) for (i = 0; i < VB_POOL; i++) _vbAnim(_vbPool[i], dt);
}

/* ============================================================
   战术标识(T 独立开关/指挥模式联动)——AI 载具头顶战术意图标,全场每车至多 1 个。
   图集:单行 13 列×96px,对局一次静态烘焙(无型号注册、无脏位,增援不影响);
   列=意图+队偏(0..3 友绿/4..7 敌红);V 恒 0。显示门=_tacOn||sqCmd.active。
   被指挥者(_detached)不显示战术标,改走 _cmdStarTick 星系。
   数据=ai.js cmdDecide 决策期一次写入的 g._intent 纯视觉字段(AI 行为零读取)。
   Mesh:PlaneGeometry(1,1)+iUV 实例属性一次 draw;alpha<0.5 丢弃,无深度测试。
   敌我箭头与战术标识保持独立绘制；本模块不为准星瞄准目标创建三维描边。 */
var TAC_CAP=400;                                    // 实例容量(每车≤1,全场 AI 上限)
var TAC_S=0.8;                                      // 战术标尺寸系数(×2.1 通用基)
var _tacOn=true,_tacMesh=null,_tacGeo=null,_tacUvA=null,_tacTex=null;
var _tacM4=new THREE.Matrix4(),_tacQ=new THREE.Quaternion(),_tacP=new THREE.Vector3(),_tacS=new THREE.Vector3(),_tacY=new THREE.Vector3(0,1,0);
function _tacBaseH(t){                               // 悬浮基准高(刚出机体不压车,按机型)
  if(t.kind==='ah64'||t.kind==='wz10')return 5.55;
  if(t.kind==='arty')return 4.35;
  return 3.35;
}
function _tacBakeAtlas(){                            // 图集烘焙(对局一次,静态):列0..3=友军4意图(绿)/列4..7=敌军同形(红)
  var C=96,cv=document.createElement('canvas');
  cv.width=C*13;cv.height=C;
  var g=cv.getContext('2d');
  var chev=function(x0,cy,up,fill){
    var d=up?1:-1;g.beginPath();
    g.moveTo(x0+C*0.13,cy+d*C*0.14);g.lineTo(x0+C*0.5,cy);g.lineTo(x0+C*0.87,cy+d*C*0.14);
    g.lineTo(x0+C*0.87,cy+d*C*0.30);g.lineTo(x0+C*0.5,cy+d*C*0.16);g.lineTo(x0+C*0.13,cy+d*C*0.30);g.closePath();
    g.lineWidth=C*0.07;g.strokeStyle='#141414';g.stroke();g.fillStyle=fill;g.fill();};
  var holdBox=function(x0,fill){                     // 坚守:墨板+暗芯+色方框
    g.fillStyle='#141414';g.fillRect(x0+C*0.12,C*0.20,C*0.76,C*0.56);
    g.fillStyle='#0a100a';g.fillRect(x0+C*0.19,C*0.27,C*0.62,C*0.42);
    g.strokeStyle=fill;g.lineWidth=C*0.07;g.strokeRect(x0+C*0.28,C*0.34,C*0.44,C*0.28);};
  var flankU=function(x0,fill){                      // 迂回:U 弯箭(黑描边+色芯)
    var uP=function(){g.beginPath();g.moveTo(x0+C*0.24,C*0.30);g.lineTo(x0+C*0.60,C*0.30);
      g.arc(x0+C*0.60,C*0.48,C*0.18,-Math.PI/2,Math.PI/2);g.lineTo(x0+C*0.38,C*0.66);};
    g.lineCap='round';g.lineJoin='round';
    uP();g.lineWidth=C*0.19;g.strokeStyle='#141414';g.stroke();
    uP();g.lineWidth=C*0.10;g.strokeStyle=fill;g.stroke();
    g.beginPath();g.moveTo(x0+C*0.40,C*0.52);g.lineTo(x0+C*0.40,C*0.80);g.lineTo(x0+C*0.16,C*0.66);g.closePath();
    g.lineWidth=C*0.06;g.strokeStyle='#141414';g.stroke();g.fillStyle=fill;g.fill();};
  var paintSet=function(c0,fill){                    // c0=列基(0 友/4 敌):0攻1撤2守3迂回
    chev(c0*C,C*0.22,true,fill);chev(c0*C,C*0.56,true,fill);
    chev((c0+1)*C,C*0.44,false,fill);chev((c0+1)*C,C*0.78,false,fill);
    holdBox((c0+2)*C,fill);
    flankU((c0+3)*C,fill);};
  paintSet(0,'#3cb44b');
  paintSet(4,'#ff2d20');
  if(_tacTex)_tacTex.dispose();
  _tacTex=new THREE.CanvasTexture(cv);_tacTex.minFilter=THREE.LinearFilter;_tacTex.magFilter=THREE.LinearFilter;
  if(_tacMesh)_tacMesh.material.uniforms.map.value=_tacTex;
}
function _tacEnsure(){
  if(_tacMesh||typeof scene==='undefined'||!scene)return;
  _tacGeo=new THREE.PlaneGeometry(1,1);
  _tacUvA=new Float32Array(TAC_CAP*2);
  _tacGeo.setAttribute('iUV',new THREE.InstancedBufferAttribute(_tacUvA,2).setUsage(THREE.DynamicDrawUsage));
  var vs='attribute vec2 iUV;uniform vec2 uCell;varying vec2 vUv;\n'+'#include <common>\n#include <logdepthbuf_pars_vertex>\n'+
    'void main(){vUv=(iUV+uv)*uCell;vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;\n#include <logdepthbuf_vertex>\n}';   // 修复:#include 必须位于行首,否则 three.js 不展开→着色器编译失败(战术标识不渲染)
  var fs='uniform sampler2D map;varying vec2 vUv;\n#include <logdepthbuf_pars_fragment>\n'+
    'void main(){\n#include <logdepthbuf_fragment>\nvec4 c=texture2D(map,vUv);if(c.a<0.5)discard;gl_FragColor=c;}';
  var mat=new THREE.ShaderMaterial({uniforms:{map:{value:null},uCell:{value:new THREE.Vector2(1/13,1)}},
    vertexShader:vs,fragmentShader:fs,transparent:true,depthTest:true,depthWrite:false});   // FX1:标识遮挡(地形/残骸),烟不写深度故不挡
  _tacMesh=new THREE.InstancedMesh(_tacGeo,mat,TAC_CAP);
  _tacMesh.count=0;_tacMesh.visible=false;_tacMesh.frustumCulled=false;_tacMesh.renderOrder=30;
  _tacMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(_tacMesh);
}
function tacShow(){                                  // 显示:ensure+烘焙一次+可见(门内调用)
  _tacEnsure();if(!_tacMesh)return;
  if(!_tacTex)_tacBakeAtlas();
  _tacMesh.visible=true;
}
function tacHideMesh(){                              // 隐藏:mesh 关+敌我箭头收走
  if(_tacMesh){_tacMesh.visible=false;_tacMesh.count=0;}
  if(typeof _iffArrowHide==='function')_iffArrowHide();
}
function tacToggle(){                                // T 键:战术标识独立开关(只开标识,不进指挥模式)
  _tacOn=!_tacOn;                                     // T 键=敌我标识开关;小队战术标识只随指挥模式
  if(!_tacOn&&!(typeof sqCmd!=='undefined'&&sqCmd.active)&&typeof _iffArrowHide==='function')_iffArrowHide();
  if(typeof aimHint==='function')aimHint(_tacOn?'敌我标识：开':'敌我标识：关');
}
function tacSyncToCmd(){                             // 与指挥模式同步:进模式则显示
  tacShow();
}
function tacForceOff(){                              // 退出指挥模式:战术标识一律隐藏;敌我箭头仍按 T 开关
  if(_tacMesh){_tacMesh.visible=false;_tacMesh.count=0;}
  if(!_tacOn&&typeof _iffArrowHide==='function')_iffArrowHide();
}
function tacBattleReset(){                           // 开局/换场:默认开启独立开关+显示(图集静态不清)
  _tacOn=true;
  tacShow();
}
function _tacTick(){                                 // 每帧(_comicFxTick 登记):门=仅指挥模式(小队战术标识只在指挥模式下显示;T 键只管敌我标识)
  var show=(typeof sqCmd!=='undefined'&&sqCmd.active);
  if(!show){
    if(_tacMesh&&_tacMesh.count)_tacMesh.count=0;
    return;
  }
  if(!_tacMesh)tacShow();                         // 场景晚于战斗 reset 建立时,首帧补建默认开启的标识池
  if(!_tacMesh||typeof aliveList==='undefined'||!camera){
    if(_tacMesh&&_tacMesh.count)_tacMesh.count=0;
    return;
  }
  if(!_tacMesh.visible)_tacMesh.visible=true;
  var sn=typeof scoped!=='undefined'&&scoped;
  var refTeam=(player&&player.team)||'red';        // 敌我参照:玩家所在方;观战时取当前观战目标所在方
  if(window.Spectator&&Spectator.active&&Spectator.active()&&Spectator.state&&Spectator.state.target)refTeam=Spectator.state.target.team||refTeam;
  var out=0;
  for(var i=0;i<aliveList.length&&out<TAC_CAP;i++){
    var t=aliveList[i];
    if(t===player||!t.alive||!t.group)continue;
    var g2=t._cmdG;
    if(!g2||g2._detached)continue;                  // 无组车无标;被指挥者走星系
    var p=t.group.position;
    var dx=camera.position.x-p.x,dz=camera.position.z-p.z;
    var dk=scopeDistK(sn,dx*dx+dz*dz,55,1,4.2);
    var sc=2.1*TAC_S*dk;
    _tacQ.setFromAxisAngle(_tacY,Math.atan2(dx,dz)); // 绕竖轴面向玩家
    // 置于敌我箭头(中心=基准高,尺寸 1.45·dk)正上方:箭头半高 + 标识半高 + 间隙,随距离缩放同步
    _tacP.set(p.x,p.y+_tacBaseH(t)+(0.725+1.05*TAC_S+0.12)*dk,p.z);_tacS.set(sc,sc,1);
    _tacM4.compose(_tacP,_tacQ,_tacS);_tacMesh.setMatrixAt(out,_tacM4);
    _tacUvA[out*2]=(g2._intent|0)+(t.team===refTeam?0:4);_tacUvA[out*2+1]=0;out++;   // 按敌我:与视角方同队=绿,否则=红
  }
  _tacMesh.count=out;
  _tacMesh.instanceMatrix.needsUpdate=true;
  _tacGeo.attributes.iUV.needsUpdate=true;
}
/* ===== 敌我箭头:所有可见、未被遮蔽的非玩家载具 =====
   与战术标识共用 _tacOn||指挥模式显示门,但不读取 AI 决策字段。
   绿=友军、红=敌军;静态障碍/地形遮挡时不写入箭头池。指挥星的载具由
   _iffArrowStarHidden 排除,退出指挥/A射B导后自动恢复。 */
var IFF_ARROW_CAP=1024,_iffArrowTex=null,_iffArrowGeo=null,_iffArrowGreen=null,_iffArrowRed=null;
var _iffArrowM4=new THREE.Matrix4(),_iffArrowQ=new THREE.Quaternion(),_iffArrowH=new THREE.Vector3(),_iffArrowS=new THREE.Vector3(),_iffArrowV=new THREE.Vector3(),_iffArrowY=new THREE.Vector3(0,1,0);
function _iffArrowTexture(){
  if(_iffArrowTex)return _iffArrowTex;
  var C=96,cv=document.createElement('canvas');cv.width=C;cv.height=C;
  var g=cv.getContext('2d');
  /* Inverted equilateral triangle: the downward point is the vehicle marker tip. */
  g.beginPath();g.moveTo(C*.14,C*.22);g.lineTo(C*.86,C*.22);g.lineTo(C*.50,C*.22+C*.72*.8660254);g.closePath();
  g.lineJoin='round';g.lineWidth=C*.075;g.strokeStyle='#141414';g.stroke();g.fillStyle='#ffffff';g.fill();
  _iffArrowTex=new THREE.CanvasTexture(cv);_iffArrowTex.minFilter=THREE.LinearFilter;_iffArrowTex.magFilter=THREE.LinearFilter;
  return _iffArrowTex;
}
function _iffArrowEnsure(){
  if(_iffArrowGreen||typeof scene==='undefined'||!scene)return;
  _iffArrowGeo=new THREE.PlaneGeometry(1,1);
  var mk=function(color){
    return new THREE.MeshBasicMaterial({map:_iffArrowTexture(),color:color,transparent:true,alphaTest:.08,depthTest:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
  };
  _iffArrowGreen=new THREE.InstancedMesh(_iffArrowGeo,mk(0x3cb44b),IFF_ARROW_CAP);
  _iffArrowRed=new THREE.InstancedMesh(_iffArrowGeo,mk(0xff2d20),IFF_ARROW_CAP);
  _iffArrowGreen.count=0;_iffArrowRed.count=0;
  _iffArrowGreen.visible=false;_iffArrowRed.visible=false;
  _iffArrowGreen.frustumCulled=false;_iffArrowRed.frustumCulled=false;
  _iffArrowGreen.renderOrder=31;_iffArrowRed.renderOrder=31;
  _iffArrowGreen.instanceMatrix.setUsage(THREE.DynamicDrawUsage);_iffArrowRed.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(_iffArrowGreen);scene.add(_iffArrowRed);
}
function _iffArrowHide(){
  if(_iffArrowGreen){_iffArrowGreen.count=0;_iffArrowGreen.visible=false;}
  if(_iffArrowRed){_iffArrowRed.count=0;_iffArrowRed.visible=false;}
}
function _iffArrowStarList(){
  if(typeof heliABG!=='undefined'&&heliABG.on&&typeof heliABGValidate==='function'&&heliABGValidate())return heliABG.wings;
  if(typeof sqCmd!=='undefined'&&sqCmd.active&&sqCmd.group)return sqCmd.group.members;
  return null;
}
function _iffArrowStarHidden(t,list){
  if(!list)return false;
  for(var i=0;i<list.length;i++)if(list[i]===t)return true;
  return false;
}
function _iffArrowLineClear(t){
  var cp=camera.position,h=_iffArrowH;
  var dx=h.x-cp.x,dy=h.y-cp.y,dz=h.z-cp.z,dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
  if(!(dist>.1))return true;
  var now=(typeof gameT==='number'&&isFinite(gameT))?gameT:0;
  if(t._iffArrowOccT!=null&&now>=t._iffArrowOccT&&now-t._iffArrowOccT<.12)return !t._iffArrowOcc;
  var occ=false,hits,hitD;
  if(typeof worldRaycast==='function'){
    hits=worldRaycast(cp.x,cp.y,cp.z,h.x,h.y,h.z,true);
    if(hits&&hits.length){
      hitD=hits[0].distance;
      if(hitD==null&&hits[0].point&&hits[0].point.distanceTo)hitD=hits[0].point.distanceTo(cp);
      if(hitD!=null&&hitD<dist-.7)occ=true;
    }
  }
  if(!occ&&typeof isRadarLineOccludedByTerrain==='function')occ=isRadarLineOccludedByTerrain(cp.x,cp.y,cp.z,h.x,h.y,h.z,dist);
  t._iffArrowOccT=now;t._iffArrowOcc=occ;
  return !occ;
}
function _iffArrowTick(){
  var show=_tacOn||(typeof sqCmd!=='undefined'&&sqCmd.active);
  if(!show){_iffArrowHide();return;}
  _iffArrowEnsure();
  if(!_iffArrowGreen||!_iffArrowRed||typeof aliveList==='undefined'||!camera){_iffArrowHide();return;}
  _iffArrowGreen.visible=true;_iffArrowRed.visible=true;
  var sn=typeof scoped!=='undefined'&&scoped,gn=0,rn=0,i,t,p,dx,dz,sc,friendly,starList=_iffArrowStarList();
  for(i=0;i<aliveList.length;i++){
    t=aliveList[i];
    if(!t||t===player||!t.alive||!t.group)continue;
    if(_iffArrowStarHidden(t,starList))continue;
    p=t.group.position;
    _iffArrowH.set(p.x,p.y+_tacBaseH(t),p.z);
    _iffArrowV.copy(_iffArrowH).project(camera);
    if(_iffArrowV.z<-1||_iffArrowV.z>1||Math.abs(_iffArrowV.x)>1.02||Math.abs(_iffArrowV.y)>1.02)continue;
    if(!_iffArrowLineClear(t))continue;
    dx=camera.position.x-p.x;dz=camera.position.z-p.z;
    sc=1.45*scopeDistK(sn,dx*dx+dz*dz,55,1,4.2);
    _iffArrowQ.setFromAxisAngle(_iffArrowY,Math.atan2(dx,dz));_iffArrowS.set(sc,sc,1);
    _iffArrowM4.compose(_iffArrowH,_iffArrowQ,_iffArrowS);
    friendly=!isFfaMode()&&player&&t.team===player.team;
    if(friendly){if(gn>=IFF_ARROW_CAP)continue;_iffArrowGreen.setMatrixAt(gn++,_iffArrowM4);}
    else{if(rn>=IFF_ARROW_CAP)continue;_iffArrowRed.setMatrixAt(rn++,_iffArrowM4);}
  }
  _iffArrowGreen.count=gn;_iffArrowRed.count=rn;
  _iffArrowGreen.instanceMatrix.needsUpdate=true;_iffArrowRed.instanceMatrix.needsUpdate=true;
}
/* ===== 指挥星:被指挥/被借用载具头顶五角星 =====
   星源=A射B导僚机(heliABG.wings,直升机座舱 Backspace)+地面指挥组员(sqCmd.group.members,地面 Backspace);
   两源分属不同座舱,天然互斥。贴图一次烘焙白芯+粗墨描边星;阵营色由材质 color 染(red 黄/余白)。
   逐帧:双源皆无=一次布尔早退(并跑一帧隐藏收尾)。 */
var _cmdStarTex=null,_cmdStarGeo=null,_cmdStarMeshes=[];
function _cmdStarTexture(){
  if(_cmdStarTex)return _cmdStarTex;
  var C=96,cv=document.createElement('canvas');
  cv.width=C;cv.height=C;
  var g=cv.getContext('2d');
  var cx=C/2,cy=C*0.52,R=C*0.30,r2=R*0.42,i2,a,rr;
  g.beginPath();
  for(i2=0;i2<10;i2++){a=-Math.PI/2+i2*Math.PI/5;rr=(i2&1)===0?R:r2;
    if(i2===0)g.moveTo(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr);else g.lineTo(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr);}
  g.closePath();g.lineWidth=C*0.07;g.strokeStyle='#141414';g.stroke();
  g.fillStyle='#ffffff';g.fill();                          // 白芯:由实例 color 染阵营色
  _cmdStarTex=new THREE.CanvasTexture(cv);
  _cmdStarTex.minFilter=THREE.LinearFilter;_cmdStarTex.magFilter=THREE.LinearFilter;
  return _cmdStarTex;
}
function _cmdStarTick(){                               // 每帧(_comicFxTick 登记)
  var i,m,list=null;
  if(typeof heliABG!=='undefined'&&heliABG.on&&typeof heliABGValidate==='function'&&heliABGValidate())list=heliABG.wings;
  if(!list&&typeof sqCmd!=='undefined'&&sqCmd.active&&sqCmd.group)list=sqCmd.group.members;
  if(!list||typeof camera==='undefined'||!camera||typeof scene==='undefined'||!scene){
    for(i=0;i<_cmdStarMeshes.length;i++)_cmdStarMeshes[i].visible=false;
    return;
  }
  if(!_cmdStarGeo)_cmdStarGeo=new THREE.PlaneGeometry(1,1);
  var sn=typeof scoped!=='undefined'&&scoped;
  var n=list.length;
  for(i=0;i<n;i++){
    var t=list[i];
    if(!t||!t.alive||!t.group){if(_cmdStarMeshes[i])_cmdStarMeshes[i].visible=false;continue;}
    if(i>=_cmdStarMeshes.length){
      m=new THREE.Mesh(_cmdStarGeo,new THREE.MeshBasicMaterial({
        map:_cmdStarTexture(),transparent:true,depthTest:false,depthWrite:false}));
      m.renderOrder=30;m.frustumCulled=false;
      scene.add(m);_cmdStarMeshes.push(m);
    }
    m=_cmdStarMeshes[i];
    var q=t.group.position;
    var dx=camera.position.x-q.x,dz=camera.position.z-q.z;
    var sc=2.6*scopeDistK(sn,dx*dx+dz*dz,55,1,4.2);        // 通用口径:炮镜原生/第三人称温和距离放大
    var heli=(t.kind==='ah64'||t.kind==='wz10');
    m.position.set(q.x,q.y+(heli?5.5:4.6),q.z);            // 僚机 5.5(现行不动)/地面组员 4.6
    m.rotation.set(0,Math.atan2(dx,dz),0);                 // 绕竖轴面向玩家
    m.scale.set(sc,sc,1);
    m.material.color.setHex(t.team==='red'?0xffd21f:0xffffff);
    m.visible=true;
  }
  for(;i<_cmdStarMeshes.length;i++)_cmdStarMeshes[i].visible=false;
}

/* 漫画渲染为唯一渲染模式:加载即初始化(失败时 comicRender 内部直渲兜底,不阻塞游戏) */
_comicInit();

/* ===== 游戏设置:CRT 滤镜强度滑块(0~100) ----
   双路驱动:uCrt 0~1(着色器桶形畸变,仅场景) + #crtfx 叠加层 opacity(扫描线/荫罩/暗角,全屏含 HUD/菜单)。
   叠加层为静态渐变层,逐帧仅 GPU 合成;强度 0 置 display:none,连合成也免掉——整链零逐帧成本。
   localStorage 持久化(返回主菜单=整页刷新,纯内存态会清零);滑块事件驱动,无逐帧读取。 ===== */
var _CRT_LS = 'prefCrtFilter';
(function bindCrtUI() {
  var inp = (typeof el !== 'undefined' && el.crtinput) || document.getElementById('crtinput');
  var val = (typeof el !== 'undefined' && el.crtval) || document.getElementById('crtval');
  var fx = document.getElementById('crtfx');
  if (!inp) return;
  function sync() {
    var v = Math.max(0, Math.min(100, +inp.value || 0));
    if (val) val.textContent = v + '%';
    if (_comicMat && _comicMat.uniforms.uCrt) _comicMat.uniforms.uCrt.value = v / 100;
    if (fx) { fx.style.opacity = v / 100; fx.style.display = v > 0 ? 'block' : 'none'; }
    try { localStorage.setItem(_CRT_LS, String(v)); } catch (e) { /* 无存储环境安静跳过 */ }
  }
  var init = 0;
  try { init = +localStorage.getItem(_CRT_LS) || 0; } catch (e) {}
  inp.value = init;
  inp.addEventListener('input', sync);
  sync();
})();

/* ===== 游戏设置:战场调色强度滑块(0~100) ----
   ⑨ 战场调色的唯一开关。0% → uWGrade=0 → 与补丁前逐像素等价(回滚);
   与 CRT 同口径:滑块事件驱动 + localStorage 持久化(prefWarGrade), 零逐帧读取。
   本轮按用户要求:不开 rim light / cel ramp, 强调色保护窗维持 8~52° 不收紧。 ===== */
var _WAR_LS = 'prefWarGrade';
(function bindWarUI() {
  var inp = (typeof el !== 'undefined' && el.warinput) || document.getElementById('warinput');
  var val = (typeof el !== 'undefined' && el.warval) || document.getElementById('warval');
  if (!inp) return;
  function sync() {
    var v = Math.max(0, Math.min(100, +inp.value || 0));
    if (val) val.textContent = v + '%';
    if (_comicMat && _comicMat.uniforms.uWGrade) _comicMat.uniforms.uWGrade.value = v / 100;
    try { localStorage.setItem(_WAR_LS, String(v)); } catch (e) { /* 无存储环境安静跳过 */ }
  }
  var init = 100;                                       // 默认满强度;读不到存储时保持 100
  try { var s = localStorage.getItem(_WAR_LS); if (s !== null && s !== '') init = Math.max(0, Math.min(100, +s || 0)); } catch (e) {}
  inp.value = init;
  inp.addEventListener('input', sync);
  sync();
})();


/* ============================================================
   ★对局拆场清空(flow.js clearBattleEntities 调用):
   上一局的长驻特效全部登记在模块级表里(黑烟柱/燃烧车+尾烟/火箭弹道线/
   发动机烟/扬尘/炮口烟),不随 tanks/wreckList 清空而消失。返回车库/再开局
   必须显式清空,否则这些「幽灵特效」会原样带到下一局。
   ============================================================ */
function comicBattleClear() {
  _cbSat = false;                                            // ★任务27⑥:拆场复位饱和态(下场首卡不冤枉降级)
  /* 残骸长驻黑烟柱(注册表引用旧残骸对象,位置逐帧读 live —— 不清则永久冒烟) */
  try { if (typeof wreckSmokeClear === 'function') wreckSmokeClear(); } catch (e1) {}
  /* 燃烧车 + 燃尽尾烟(条目引用旧坦克,alive/fire 状态由拆场方置死兜底) */
  try {
    if (typeof _comicBurnList !== 'undefined' && _comicBurnList) {
      for (var b = 0; b < _comicBurnList.length; b++) {
        var bt = _comicBurnList[b];
        if (bt) { bt._comicBurnRegistered = false; bt._comicBurnSmokeTailStart = -1; }
      }
      _comicBurnList.length = 0;
    }
    if (_comicBurnMesh) { _comicBurnMesh.count = 0; _comicBurnMesh.visible = false; }
    if (typeof _comicBurnSmokeMesh !== 'undefined' && _comicBurnSmokeMesh) { _comicBurnSmokeMesh.count = 0; _comicBurnSmokeMesh.visible = false; }
  } catch (e2) {}
  /* 发动机烟/履带扬尘(CSM:按车登记,引用旧坦克) */
  try {
    if (typeof _csmVehicles !== 'undefined' && _csmVehicles) _csmVehicles.length = 0;
    if (typeof _csmVisible !== 'undefined' && _csmVisible) _csmVisible.length = 0;
    if (_csmMesh) { _csmMesh.count = 0; _csmMesh.visible = false; }
    if (typeof _csmVisDirty !== 'undefined') _csmVisDirty = true;
  } catch (e3) {}
  /* 火箭弹道线(shell 被清空时线未「收尾」→ 会永久冻结在天上) */
  try {
    if (typeof _rklOwners !== 'undefined' && _rklOwners) {
      for (var r = 0; r < _rklOwners.length; r++) _rklOwners[r] = null;
      if (typeof _rklShrinkObj !== 'undefined' && _rklShrinkObj) for (var r2 = 0; r2 < _rklShrinkObj.length; r2++) _rklShrinkObj[r2] = null;
      if (typeof _rklEnding !== 'undefined' && _rklEnding) _rklEnding.fill(0);
      if (typeof _rklShrinkSpeed !== 'undefined' && _rklShrinkSpeed) _rklShrinkSpeed.fill(0);
      if (typeof _rklCut !== 'undefined' && _rklCut) _rklCut.fill(0);
      if (typeof _rklEndList !== 'undefined' && _rklEndList) _rklEndList.length = 0;
      if (typeof _rklFree !== 'undefined' && _rklFree) {
        _rklFree.length = 0;
        for (var rf = _rklOwners.length - 1; rf >= 0; rf--) _rklFree.push(rf);
      }
      if (typeof _rklLive !== 'undefined') _rklLive = 0;
      if (typeof _rklHigh !== 'undefined') _rklHigh = 0;
      if (typeof _rklDirtyMin !== 'undefined') _rklDirtyMin = RKL_CAP;
      if (typeof _rklDirtyMax !== 'undefined') _rklDirtyMax = 0;
      if (typeof _rklGeo !== 'undefined' && _rklGeo && _rklGeo.setDrawRange) _rklGeo.setDrawRange(0, 0);
    }
    if (_rklMesh) _rklMesh.visible = false;
  } catch (e4) {}
  /* 火箭尾烟卡池 */
  try {
    if (typeof _crtPool !== 'undefined' && _crtPool) for (var c = 0; c < _crtPool.length; c++) _crtPool[c].on = false;
    if (typeof _crtList !== 'undefined' && _crtList) _crtList.length = 0;
    if (typeof _crtLive !== 'undefined') _crtLive = 0;
    if (typeof _crtCount !== 'undefined') _crtCount = 0;
    if (_crtMesh) { _crtMesh.count = 0; _crtMesh.visible = false; }
  } catch (e5) {}
  /* 地面扬尘池 */
  try {
    if (typeof _cgdPool !== 'undefined' && _cgdPool) for (var d = 0; d < _cgdPool.length; d++) _cgdPool[d].on = false;
    if (typeof _cgdLive !== 'undefined') _cgdLive = 0;
    if (_cgdMesh) { _cgdMesh.count = 0; _cgdMesh.visible = false; }
  } catch (e6) {}
  /* P3 履带刨土池 */
  try {
    if (typeof _ctdPool !== 'undefined' && _ctdPool) for (var td = 0; td < _ctdPool.length; td++) _ctdPool[td].on = false;
    if (typeof _ctdLive !== 'undefined') _ctdLive = 0;
    if (typeof _ctdMesh !== 'undefined' && _ctdMesh) { _ctdMesh.count = 0; _ctdMesh.visible = false; }
  } catch (e6b) {}
  /* 炮口火光/炮口烟/甲板照明池 */
  try {
    if (typeof _cmzPool !== 'undefined' && _cmzPool) for (var m = 0; m < _cmzPool.length; m++) _cmzPool[m].on = false;
    if (typeof _cmzLive !== 'undefined') _cmzLive = 0;
    if (typeof _cmzZeroed !== 'undefined') _cmzZeroed = true;
    if (_cmzSideMesh) { _cmzSideMesh.count = 0; _cmzSideMesh.visible = false; }
    if (_cmzFrontMesh) { _cmzFrontMesh.count = 0; _cmzFrontMesh.visible = false; }
    if (_cmzSmokeMesh) { _cmzSmokeMesh.count = 0; _cmzSmokeMesh.visible = false; }
    if (_cmzIllumMesh) { _cmzIllumMesh.count = 0; _cmzIllumMesh.visible = false; }
  } catch (e7) {}
  /* 命中火光/烟云池(短命,但随拆场一并收干净) */
  try {
    if (typeof _chiPool !== 'undefined' && _chiPool) for (var h = 0; h < _chiPool.length; h++) _chiPool[h].on = false;
    if (typeof _chiLive !== 'undefined') _chiLive = 0;
    if (typeof _chsPool !== 'undefined' && _chsPool) for (var h2 = 0; h2 < _chsPool.length; h2++) _chsPool[h2].on = false;
    if (typeof _chsLive !== 'undefined') _chsLive = 0;
    if (_chiMesh) { _chiMesh.count = 0; _chiMesh.visible = false; }
    if (_chsMesh) { _chsMesh.count = 0; _chsMesh.visible = false; }
  } catch (e8) {}
  /* ★任务27⑧:爆点卡/殉爆卡/发射烟池拆场清零。三池平时按墙钟衰减(_comicFxTick 随 rAF 常跑),
     但后台标签页 rAF 冻结/极低帧率/快速重开时,旧局未播完的爆炸卡会带进新局——新局第一帧
     恢复推进=「开局凭空开出几朵爆炸」。拆场语义下无条件清零(卡为纯视觉,无 gameplay 引用)。 */
  try {
    if (_cbPool) for (var cb = 0; cb < CB_POOL; cb++) {
      var ce = _cbPool[cb];
      ce.on = false; ce.t = 0;
      if (ce.group) ce.group.visible = false;
    }
    _cbLive = 0;
    if (_vbPool) for (var vb = 0; vb < VB_POOL; vb++) {
      var ve = _vbPool[vb];
      ve.on = false; ve.t = 0;
      if (ve.group) ve.group.visible = false;
    }
  } catch (e9) {}
  try {
    if (typeof _crlPool !== 'undefined' && _crlPool) for (var cl = 0; cl < _crlPool.length; cl++) _crlPool[cl].on = false;
    if (typeof _crlLive !== 'undefined') _crlLive = 0;
    if (typeof _crlRing !== 'undefined') _crlRing = 0;
    if (typeof _crlSmokeMesh !== 'undefined' && _crlSmokeMesh) { _crlSmokeMesh.count = 0; _crlSmokeMesh.visible = false; }
  } catch (e10) {}
}
/* ===== ★任务27③:启动期预热(main.js 加载阶段调用一次)=====
   全部漫画特效池旧行为=「首次事件才惰性构建」:第一次爆炸建蘑菇云池(8 槽×6 材质+多张程序贴图)、
   第一次炮击爆点建 28 槽火球池(+5 张 512² 贴图)、枪口焰/扬尘/命中火花/硝烟/弹道线各自同理——
   构建=canvas 贴图绘制+几何+材质创建,且其着色器要到构建后首个渲染帧才同步编译(program link
   每个数十 ms),表现为「一播放爆炸特效就卡一下,单次爆炸也卡」。预热把全部构建搬进加载期
   (幂等:各 ensure 自带已建短路),着色器预编译由 main.js 的 renderer.compile 统一完成。 */
function comicPrewarm() {
  var fns = [_cmzEnsure, _chiEnsure, _chsEnsure, _csmEnsure, _hzEnsure, _crtEnsure, _cgdEnsure,
             _ctdEnsure, _crlEnsure, _rklEnsure, _comicBurnSmokeEnsure, _comicBurnEnsure,
             _cbEnsurePool, _vbEnsurePool];
  for (var i = 0; i < fns.length; i++) {
    try { if (typeof fns[i] === 'function') fns[i](); } catch (e) { /* 单项失败跳过(如无头环境无 canvas),不阻断启动 */ }
  }
}
window.comicPrewarm = comicPrewarm;
/* ★E1-6(附录 B §B.2):把全部漫画特效贴图交出去,供 main.js 在加载期逐张 renderer.initTexture()。
   为什么必须有这一步 —— 实测本工程内置 three 的 compile 实现:
     this.compile=function(t,e){ ... t.traverse(function(e){const n=e.material; if(n) ... Pt(n,t,e)}) }
   它只走 initMaterial/getProgram(链接着色器),**完全不碰纹理**;而同一份文件里有现成的
     initTexture=function(t){ J.setTexture2D(t,0), q.unbindTexture() }
   所以在 E1-6 之前,爆点/殉爆两池约 24MB 的 1024²/512² 画布贴图仍然是在
   「第一次爆炸被渲染的那一帧」才做 texImage2D + glGenerateMipmap ——
   Android WebView 下 canvas→texture 常走 CPU readback 慢路径,单帧数百 ms。
   这正是「哪怕只炸一次也要卡一下」的那一份,与并发数无关,任务27③ 的预热并没有覆盖到。
   返回值含 null(未建的懒池贴图)由调用方跳过;顺序无关。 */
function comicFxTextures() {
  var a = [_comicBrush, _comicBurnTex, _comicBurnSmokeTex,
           _cmzSideTex, _cmzFrontTex, _cmzSmokeTex, _cmzIllumTex,
           _chiTex, _chsTex, _csmTex, _crtTex, _cgdTex, _ctdTex, _crlSmokeTex,
           _cbPetalTex, _cbCoreTex,
           _vbCanopyTex, _vbStemTex, _vbSkirtTex, _vbDebrisTex, _vbFlashTex,
           _tacTex, _cmdStarTex];
  if (_cbSplatTexs) for (var i = 0; i < _cbSplatTexs.length; i++) a.push(_cbSplatTexs[i]);
  else if (_cbSplatTex) a.push(_cbSplatTex);
  return a;
}
window.comicFxTextures = comicFxTextures;
/* ★附录 B §B.7.1:爆炸专项探针。dcAudit 只数"可见网格个数",完全不反映卡的**面积**——
   而本专项的瓶颈恰恰是面积×层数,所以判定必须看活跃卡数与 avgRenderMs 的相关性。
   纯读取、零副作用,控制台随时 __FXLIVE();判定矩阵见文档 §B.7.3。 */
window.__FXLIVE = function () {
  return {
    cb: _cbLive, cbDeg: _cbDegN, cbSat: _cbSat,                      // 爆点卡:活跃/累计降级/是否饱和
    vb: (function () { var n = 0; if (_vbPool) for (var i = 0; i < VB_POOL; i++) if (_vbPool[i].on) n++; return n; })(),
    crt: _crtLive, cgd: _cgdLive, ctd: _ctdLive, crl: _crlLive,       // 尾迹/扬尘/刨土/发射烟
    csm: _csmActive, wsmoke: _wreckSmokeList.length, rkl: _rklLive,   // 行进烟总写入/残骸烟柱/弹道线
    gfx: (typeof GFX_PROFILE !== 'undefined') ? GFX_PROFILE : '?',
    fxq: (typeof FXQ_PROFILE !== 'undefined') ? FXQ_PROFILE : '?',   // 爆炸独立档(与画质解耦后以此为准)
    knobs: { distMax: gfxFx('fxDistMax', 3.4), yieldMax: gfxFx('fxYieldMax', 2.0), satHi: CB_SAT_HI,
             hardMax: CB_HARD_MAX, groundLight: _cbGroundLight, bigTex: CB_BIG_TEX,
             wreckMax: WRSMOKE_MAX, burstMerge: VB_FRAME_MAX }
  };
};
window.comicBattleClear = comicBattleClear;

/* ★★ 加载期预热的**唯一触发点**(修正长期失效的接线,见 main.js gamePrewarm 的注释)——
   comic.js 是 index.html MODULES 序里最后一个玩法模块,到这一行时:
     renderer/scene/camera(scene.js) √  fx 池(fx.js) √  漫画池与贴图清单(本文件,上方已全部定义) √
   所以这里是"全部依赖就位、且仍在首帧之前"的唯一正确位置。
   The prewarm call belongs here because this is the first point where all comic dependencies are loaded. */
if (typeof gamePrewarm === 'function') gamePrewarm();
