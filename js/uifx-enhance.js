(function () {
'use strict';
if (window.__uifxInstalled) return;
window.__uifxInstalled = true;

/* ---------- ① 鼠标指针与通用视效样式 ---------- */
var CUR_ARROW =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' width='32' height='32'>" +
  "<polygon points='2,1 2,27 9,21 16,30 20,28 13,19 22,19' fill='#f4f0db' stroke='#101010' stroke-width='2.2' stroke-linejoin='miter'/>" +
  "<polygon points='5,6 5,21 9,17 14,25 16,24 11,16 17,16' fill='#15181c'/>" +
  "</svg>";
function curl(svg, x, y, fb) {
  return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") ' + x + ' ' + y + ', ' + fb;
}

var css = '' +
  'html,body{cursor:' + curl(CUR_ARROW, 2, 1, 'auto') + ';}' +
  /* cursor 是继承属性，但子元素的 cursor:auto/grab/none 会截断继承。主界面空白大量命中
     #hangar-canvas(cursor:grab)，所以只写 html,body 不能覆盖全界面。主界面命中树、画布及
     所有交互控件均直接指定同一箭头；对局 renderer canvas 的 cursor:none 不受影响。 */
  /* Pointer visuals use the shared CUR_ARROW asset. */
  '#startov,#startov *{cursor:' + curl(CUR_ARROW, 2, 1, 'auto') + ' !important;}' +
  '#hangar-canvas,#hangar-canvas:active{cursor:' + curl(CUR_ARROW, 2, 1, 'auto') + ' !important;}' +
  'button,.bigbtn,.optbtn,a,select,label,input,input[type=range],input[type=checkbox],#startov button,#startov a,#startov select,#startov label,#startov input{cursor:' + curl(CUR_ARROW, 2, 1, 'auto') + ' !important;}' +
  '.bigbtn:disabled,.optbtn:disabled,.optbtn.dim,#startov .bigbtn:disabled,#startov .optbtn:disabled,#startov .optbtn.dim{cursor:' + curl(CUR_ARROW, 2, 1, 'not-allowed') + ' !important;}' +
  
  '#uifx-layer{position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:99999;overflow:hidden;}' +
  '.uifx{position:absolute;transform-origin:50% 50%;will-change:transform,opacity;}' +
  '.uifx svg{display:block;width:100%;height:100%;}' +
  '@keyframes uifxHole{' +
    '0%{transform:translate(-50%,-50%) rotate(var(--r)) scale(2.2);opacity:0}' +
    '10%{transform:translate(-50%,-50%) rotate(var(--r)) scale(.9);opacity:1}' +
    '18%{transform:translate(-50%,-50%) rotate(var(--r)) scale(1.07)}' +
    '26%{transform:translate(-50%,-50%) rotate(var(--r)) scale(1)}' +
    '72%{opacity:1}' +
    '100%{transform:translate(-50%,-50%) rotate(var(--r)) scale(1);opacity:0}}' +
  '@keyframes uifxSpark{' +
    '0%{transform:translate(-50%,-50%) scale(.35) rotate(0deg);opacity:1}' +
    '70%{opacity:.85}' +
    '100%{transform:translate(-50%,-50%) scale(1.55) rotate(18deg);opacity:0}}' +
  '@keyframes uifxTap{' +
    '0%{transform:translate(-50%,-50%) scale(.4);opacity:1}' +
    '100%{transform:translate(-50%,-50%) scale(1.28);opacity:0}}' +

  /* ===== 经典复古 Windows / CRT 视效动画 ===== */
  '.win-contracting{' +
    'animation:winMinimize .22s cubic-bezier(.2,.8,.3,1) forwards !important;' +
    'pointer-events:none !important;}' +
  '@keyframes winMinimize{' +
    '0%{transform:scale(1,1);opacity:1;}' +
    '50%{transform:scale(.65,.12);opacity:.9;}' +
    '100%{transform:scale(.04,.005);opacity:0;}}' +
  '.win-expanding{' +
    'animation:winExpand .24s cubic-bezier(.18,.9,.25,1) forwards !important;}' +
  '@keyframes winExpand{' +
    '0%{transform:scale(.05,.008);opacity:0;}' +
    '65%{transform:scale(1.02,1.02);opacity:1;}' +
    '100%{transform:scale(1,1);opacity:1;}}' +
  '.crt-powering-off{' +
    'animation:crtPowerOff .26s cubic-bezier(.2,.8,.25,1) forwards !important;}' +
  '@keyframes crtPowerOff{' +
    '0%{transform:scale(1,1);filter:brightness(1) contrast(1);opacity:1;}' +
    '35%{transform:scale(1,.006);filter:brightness(4) contrast(2.5);opacity:1;}' +
    '70%{transform:scale(.006,.006);filter:brightness(6) contrast(3);opacity:1;}' +
    '100%{transform:scale(0,0);opacity:0;}}' +

  /* ===== 常驻四角定位框 (转场/黑屏期间始终保持显示) ===== */
  '.tactical-screen-corners{' +
    'position:fixed;inset:12px;pointer-events:none;z-index:99999999;}' +
  '.tactical-screen-corners .tc-c{' +
    'position:absolute;width:18px;height:18px;border:1.5px solid #6f9a63;box-shadow:0 0 8px rgba(157,255,168,.4);}' +
  '.tactical-screen-corners .tc-tl{top:0;left:0;border-right:none;border-bottom:none;}' +
  '.tactical-screen-corners .tc-tr{top:0;right:0;border-left:none;border-bottom:none;}' +
  '.tactical-screen-corners .tc-bl{bottom:0;left:0;border-right:none;border-top:none;}' +
  '.tactical-screen-corners .tc-br{bottom:0;right:0;border-left:none;border-top:none;}';

var st = document.createElement('style');
st.id = 'uifx-style';
st.textContent = css;
document.head.appendChild(st);

/* ---------- ② 漫画硬边 SVG 特效 ---------- */
var HOLE_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>" +
  "<polygon points='32,1 38,19 51,6 43,22 63,25 44,31 58,47 40,39 35,63 30,42 13,56 24,37 1,33 22,28 7,11 27,22' fill='#15181c'/>" +
  "<polygon points='32,9 39,21 50,16 43,28 55,33 41,37 46,51 33,41 25,54 26,38 11,42 22,30 14,17 28,24' fill='#a9b2bb' stroke='#101010' stroke-width='2'/>" +
  "<polygon points='31,17 40,24 45,33 38,42 27,43 20,34 23,24' fill='#4a5157' stroke='#101010' stroke-width='2'/>" +
  "<ellipse cx='32' cy='32' rx='8.5' ry='7.5' fill='#000'/>" +
  "<polyline points='24,23 29,20' stroke='#f6f3e6' stroke-width='2.2'/>" +
  "</svg>";
var SPARK_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>" +
  "<polygon points='32,4 36,24 52,12 40,28 60,32 40,36 50,52 36,40 32,60 28,40 14,52 24,36 4,32 24,28 12,12 28,24' " +
  "fill='#ffd93b' stroke='#101010' stroke-width='2.5' stroke-linejoin='miter'/>" +
  "<circle cx='32' cy='32' r='6' fill='#fff5c0'/>" +
  "</svg>";
var TAP_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>" +
  "<circle cx='32' cy='32' r='11' fill='none' stroke='#141414' stroke-width='4'/>" +
  "<circle cx='32' cy='32' r='11' fill='none' stroke='#ffd93b' stroke-width='1.8'/>" +
  "<g stroke='#141414' stroke-width='4' stroke-linecap='square'><path d='M32 6v9M32 49v9M6 32h9M49 32h9'/></g>" +
  "<g stroke='#ffd93b' stroke-width='1.8'><path d='M32 6v9M32 49v9M6 32h9M49 32h9'/></g>" +
  "</svg>";

var layer = document.createElement('div');
layer.id = 'uifx-layer';
document.body.appendChild(layer);

function spawn(svg, x, y, size, anim, dur, rot, parent) {
  var d = document.createElement('div');
  d.className = 'uifx';
  d.style.left = x + 'px';
  d.style.top = y + 'px';
  d.style.width = size + 'px';
  d.style.height = size + 'px';
  if (rot != null) d.style.setProperty('--r', rot + 'deg');
  d.style.animation = anim + ' ' + dur + 'ms cubic-bezier(.2,.7,.3,1) forwards';
  d.innerHTML = svg;
  (parent || layer).appendChild(d);
  setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, dur + 80);
}
function spawnBulletHole(x, y) {
  spawn(SPARK_SVG, x, y, 62, 'uifxSpark', 260);
  spawn(HOLE_SVG, x, y, 44 + Math.random() * 10, 'uifxHole', 1050, (Math.random() * 360) | 0);
}
function spawnBlankTap(x, y) { spawn(TAP_SVG, x, y, 46, 'uifxTap', 340); }
window.spawnBulletHole = spawnBulletHole;
window.spawnBlankTap = spawnBlankTap;

/* ---------- ③ 音效系统 ---------- */
function uiVol() {
  var v = window.prefVolume;
  return (typeof v === 'number' && isFinite(v)) ? v : 0.55;
}
function gameAC() {
  if (typeof initAudio === 'function') { try { initAudio(); } catch (e) {} }
  return (typeof AC !== 'undefined' && AC) ? AC : null;
}
var _uiCueA = {};
function playCue(key) {
  if (typeof RELOAD_CUES === 'undefined' || !RELOAD_CUES[key]) return;
  if (_uiCueA[key]) { try { _uiCueA[key].pause(); } catch (e) {} }
  var a = new Audio(RELOAD_CUES[key]);
  a.volume = Math.min(1.0, uiVol() * 1.4);
  _uiCueA[key] = a;
  a.onended = function () { if (_uiCueA[key] === a) _uiCueA[key] = null; };
  var p = a.play(); if (p && p.catch) p.catch(function () {});
}
var SND = {
  reload: { gap: 150, fn: function () { playCue('cannon_main'); } },
  fire: { gap: 120, fn: function () {
    if (!gameAC()) return;
    if (typeof playShot === 'function' && typeof cannonBuf !== 'undefined' && cannonBuf)
      playShot(cannonBuf, 1.8, 0);
  } },
  gear: { gap: 90, fn: function () { playCue('heli_rocket'); } }
};
var lastPlay = {};
function playUISound(kind) {
  var s = SND[kind];
  if (!s) return;
  var now = (window.performance && performance.now) ? performance.now() : Date.now();
  if (lastPlay[kind] && now - lastPlay[kind] < s.gap) return;
  lastPlay[kind] = now;
  try { s.fn(); } catch (e) {}
}
window.playUISound = playUISound;

function dNz(ac, out, t, dur, type, f0, f1, Q, peak, atk) {
  if (typeof noiseBuf === 'undefined' || !noiseBuf) return;
  var s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  var f = ac.createBiquadFilter(); f.type = type; f.Q.value = Q || 1;
  f.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  var g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + (atk || 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(out);
  s.start(t); s.stop(t + dur + 0.03);
}
function dTn(ac, out, t, dur, type, f0, f1, peak, atk) {
  var o = ac.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  var g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + (atk || 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + dur + 0.03);
}

function sfxTacticalBeep(count) {
  var ac = gameAC(); if (!ac || ac.state !== 'running') return;
  var t0 = ac.currentTime + 0.01;
  var bus = cineOut(ac, 0.7);
  count = count || 1;
  if (count === 2) {
    dTn(ac, bus, t0, 0.045, 'sine', 960, 960, 0.35, 0.003);
    dTn(ac, bus, t0 + 0.075, 0.055, 'sine', 1440, 1440, 0.38, 0.003);
  } else {
    dTn(ac, bus, t0, 0.075, 'sine', 1760, 1760, 0.45, 0.003);
    dTn(ac, bus, t0, 0.04, 'triangle', 3520, 3520, 0.15, 0.002);
  }
}
window.sfxTacticalBeep = sfxTacticalBeep;

/* ---------- ④ 屏幕碎裂与濒死视效资源 ---------- */
/* Ink-shard death effect: stepped edges, fragments, and hard borders. */
var SHATTER_SVG = '<svg class="uifx-shatter-svg" viewBox="0 0 1920 1080" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
  '<g transform="translate(6,-5)" stroke="rgba(252,249,240,.5)" stroke-width="2" fill="none">' +
    '<path d="M1020,520 L840,410 L650,330 L420,240 L180,150 L0,90"/>' +
    '<path d="M1020,520 L910,380 L800,210 L690,70 L640,0"/>' +
    '<path d="M1020,520 L1080,360 L1150,190 L1220,60 L1260,0"/>' +
    '<path d="M1020,520 L1230,430 L1460,340 L1710,230 L1920,160"/>' +
    '<path d="M1020,520 L1280,560 L1540,610 L1760,670 L1920,710"/>' +
    '<path d="M1020,520 L1210,690 L1380,850 L1510,990 L1580,1080"/>' +
    '<path d="M1020,520 L1040,710 L1060,890 L1070,1080"/>' +
    '<path d="M1020,520 L890,680 L760,840 L630,980 L560,1080"/>' +
    '<path d="M1020,520 L790,580 L540,630 L290,700 L0,760"/>' +
    '<path d="M1020,520 L810,490 L560,470 L310,430 L0,410"/>' +
      '</g>' +
  '<g stroke="#141414" fill="none" stroke-linecap="butt" stroke-linejoin="miter">' +
    '<g stroke-width="5">' +
    '<path d="M1020,520 L840,410 L650,330 L420,240 L180,150 L0,90"/>' +
    '<path d="M1020,520 L910,380 L800,210 L690,70 L640,0"/>' +
    '<path d="M1020,520 L1080,360 L1150,190 L1220,60 L1260,0"/>' +
    '<path d="M1020,520 L1230,430 L1460,340 L1710,230 L1920,160"/>' +
    '<path d="M1020,520 L1280,560 L1540,610 L1760,670 L1920,710"/>' +
    '<path d="M1020,520 L1210,690 L1380,850 L1510,990 L1580,1080"/>' +
    '<path d="M1020,520 L1040,710 L1060,890 L1070,1080"/>' +
    '<path d="M1020,520 L890,680 L760,840 L630,980 L560,1080"/>' +
    '<path d="M1020,520 L790,580 L540,630 L290,700 L0,760"/>' +
    '<path d="M1020,520 L810,490 L560,470 L310,430 L0,410"/>' +
        '</g>' +
    '<g stroke-width="12">' +
    '<path d="M1020,520 L840,410 L650,330"/>' +
    '<path d="M1020,520 L910,380 L800,210"/>' +
    '<path d="M1020,520 L1080,360 L1150,190"/>' +
    '<path d="M1020,520 L1230,430 L1460,340"/>' +
    '<path d="M1020,520 L1280,560 L1540,610"/>' +
    '<path d="M1020,520 L1210,690 L1380,850"/>' +
    '<path d="M1020,520 L1040,710 L1060,890"/>' +
    '<path d="M1020,520 L890,680 L760,840"/>' +
    '<path d="M1020,520 L790,580 L540,630"/>' +
    '<path d="M1020,520 L810,490 L560,470"/>' +
        '</g>' +
    '<g stroke-width="20">' +
    '<path d="M1020,520 L840,410"/>' +
    '<path d="M1020,520 L910,380"/>' +
    '<path d="M1020,520 L1080,360"/>' +
    '<path d="M1020,520 L1230,430"/>' +
    '<path d="M1020,520 L1280,560"/>' +
    '<path d="M1020,520 L1210,690"/>' +
    '<path d="M1020,520 L1040,710"/>' +
    '<path d="M1020,520 L890,680"/>' +
    '<path d="M1020,520 L790,580"/>' +
    '<path d="M1020,520 L810,490"/>' +
        '</g>' +
  '</g>' +
  '<g fill="rgba(252,249,240,.35)" stroke="#141414" stroke-width="3">' +
    '<polygon points="880,420 950,380 930,460"/>' +
    '<polygon points="1120,400 1190,430 1130,470"/>' +
    '<polygon points="900,620 960,660 880,660"/>' +
    '<polygon points="1130,600 1200,640 1120,650"/>' +
    '<polygon points="1010,350 1060,350 1035,410"/>' +
  '</g>' +
  '<polygon points="1020,448 1026,486 1047,453 1038,491 1070,469 1048,501 1086,492 1053,513 1092,520 1053,526 1086,547 1048,538 1070,570 1038,548 1047,586 1026,553 1020,592 1013,553 992,586 1001,548 969,570 991,538 953,547 986,526 948,520 986,513 953,492 991,501 969,469 1001,491 992,453 1013,486" fill="#fcf9f0" stroke="#141414" stroke-width="8" stroke-linejoin="miter"/>' +
  '<circle cx="1020" cy="520" r="18" fill="#141414"/>' +
'</svg>';

/* ---------- ⑤ 阵亡与战术终端 CSS 样式 ---------- */
var rspCss = '' +
  '#uifx-death{position:fixed;left:0;top:0;right:0;bottom:0;z-index:99940;pointer-events:none;display:none;}' +
  '#uifx-death.on{display:block;}' +
  
  /* 屏幕碎裂层 (在眼皮下方，眼皮闭合会遮盖碎玻璃) */
  '#uifx-death .uifx-shatter{position:absolute;inset:0;pointer-events:none;z-index:1;opacity:0;transition:opacity .08s ease-out;}' +
  '#uifx-death .uifx-shatter svg{width:100%;height:100%;display:block;}' +

  /* 血层 z8(盖眼睑):随心跳收拢(50%上限),睑闭合后褪去再弹窗 */
  '#uifx-death .uifx-blood-vg{' +
    'position:absolute;inset:0;pointer-events:none;z-index:8;opacity:0;--blood-depth:0%;' +
    'background:radial-gradient(ellipse at 50% 50%,transparent calc(98% - var(--blood-depth)),rgba(195,18,12,.46) calc(100% - var(--blood-depth)*.7),rgba(145,5,5,.94) 100%);' +
    'filter:blur(8px);will-change:background,opacity,transform;' +
    'will-change:opacity;}' +   /* Pulse timing is owned by startDeathAnim. */

  /* 视野虚化层: 动态中心跟随开眼中心 */
  '#uifx-death .uifx-blur{position:absolute;inset:0;z-index:3;opacity:0;' +
    'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);will-change:mask-image,-webkit-mask-image,opacity;}' +
  '#uifx-death .uifx-vg{position:absolute;inset:0;z-index:4;opacity:0;' +
    'background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 16%,rgba(0,0,0,.5) 56%,rgba(0,0,0,.94) 100%);will-change:background,opacity;}' +
  '#uifx-death .uifx-vg.beat{animation:uifxHbVg .84s ease-in-out infinite;}' +
  '@keyframes uifxHbVg{0%,100%{opacity:.48}14%{opacity:.95}30%{opacity:.52}42%{opacity:.8}60%{opacity:.45}}' +
  
  /* 眼睑剪影 (z-index:5，覆盖在屏幕碎裂与血红边框之上) */
  '.uifx-lid{position:absolute;left:-30%;width:160%;pointer-events:none;will-change:transform;overflow:visible;z-index:5;}' +
  '.uifx-lid svg{width:100%;height:100%;display:block;}' +
  '#uifx-lid-t{top:0;height:72%;filter:blur(6px);transform:translateY(-118%);}' +
  '#uifx-lid-b{bottom:0;height:30%;filter:blur(6px);transform:translateY(118%);}' +
  '#uifx-death .uifx-blk{position:absolute;inset:0;z-index:9;background:#000;opacity:0;transition:opacity .5s;}' +

  'canvas.uifx-dying{animation:uifxDieVis 2.55s ease-in forwards;}' +
  '@keyframes uifxDieVis{' +
    '0%{filter:blur(0) saturate(1) brightness(1);transform:perspective(900px) rotateX(0) translateY(0) scale(1)}' +
    '30%{filter:blur(1.4px) saturate(.7) brightness(.86)}' +
    '65%{filter:blur(3.6px) saturate(.34) brightness(.58);transform:perspective(900px) rotateX(14deg) translateY(10%) scale(1.08)}' +
    '100%{filter:blur(7px) saturate(.1) brightness(.3);transform:perspective(900px) rotateX(24deg) translateY(17%) scale(1.16)}}' +

  /* ===== 战术 BIOS 部署/接管终端弹窗样式 ===== */
  '#respawnov.overlay,#possessov.overlay,#endov.overlay{' +
    'background:rgba(4,7,4,.88) !important;' +
    'background-image:linear-gradient(rgba(120,180,110,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(120,180,110,.05) 1px,transparent 1px) !important;' +
    'background-size:28px 28px !important;z-index:99950 !important;display:flex;align-items:center;justify-content:center;}' +
  '#respawnov.hidden,#possessov.hidden,#endov.hidden{display:none !important;}' +
  
  '.tactical-bios-window{' +
    'position:relative;width:min(680px,94vw);max-height:min(90vh,760px);background:#0e160a !important;' +
    'border:1px solid #3d4a2e !important;box-shadow:0 0 0 1px #070b06, 0 0 48px rgba(157,255,168,.12), 8px 8px 0 #050805 !important;' +
    'color:#9dffa8;font-family:VT323,"Courier New",monospace !important;overflow:hidden !important;display:flex;flex-direction:column;}' +
  
  '.tbios-boot-screen{' +
    'padding:26px 30px;background:#060c05;min-height:160px;display:flex;flex-direction:column;justify-content:center;' +
    'font-size:20px;line-height:1.7;letter-spacing:.1em;}' +
  '.tbios-boot-line{' +
    'display:flex;align-items:center;gap:12px;opacity:0;transform:translateY(6px);' +
    'animation:tbiosLineIn .18s cubic-bezier(.2,.8,.25,1) forwards;}' +
  '@keyframes tbiosLineIn{to{opacity:1;transform:translateY(0);}}' +
  '.tb-tag{color:#6f9a63;font-weight:700;}' +
  '.tb-tag.tb-hi{color:#9dffa8;text-shadow:0 0 8px rgba(157,255,168,.6);}' +
  '.tb-ok{color:#9dffa8;font-weight:700;margin-left:auto;}' +
  
  '.tbios-panel-content{' +
    'padding:16px 22px 14px !important;display:flex;flex-direction:column;gap:14px;overflow-y:auto;}' +
  '.tbios-sec{' +
    'border:1px solid #26331c;background:#060c05;padding:12px 14px;box-shadow:inset 0 0 18px rgba(0,0,0,.75);}' +
  '.tbios-sec-title{' +
    'font-size:15px;letter-spacing:.12em;color:#6f9a63;font-weight:700;margin-bottom:8px;' +
    'border-bottom:1px dashed #3d4a2e;padding-bottom:4px;}' +
  '.tbios-slot-hq,.tbios-slot-kind{' +
    'display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-start;}' +
  
  '.tbios-foot{' +
    'display:flex;justify-content:center;padding:12px 16px;background:#0a1208;border-top:1px solid #3d4a2e;}' +
  '.tbios-foot .bigbtn{' +
    'width:auto !important;min-width:240px !important;height:44px !important;font-size:18px !important;' +
    'letter-spacing:.2em !important;background:#101a0b !important;color:#c8ffc0 !important;' +
    'border:1.5px solid #4a5a34 !important;box-shadow:0 0 16px rgba(157,255,168,.2) !important;transition:all .15s ease-out;}' +
  '.tbios-foot .bigbtn:hover:not(:disabled){' +
    'background:#9dffa8 !important;color:#061006 !important;border-color:#c8ffc0 !important;' +
    'box-shadow:0 0 24px rgba(157,255,168,.5) !important;transform:scale(1.02);}' +
  
  /* ===== 战报结算终端样式 ===== */
  '.tbios-end-grid{' +
    'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:8px 0;}' +
  '.tbios-end-card{' +
    'border:1px solid #26331c;background:#060c05;padding:10px 14px;box-shadow:inset 0 0 14px rgba(0,0,0,.7);}' +
  '.tbios-end-head{font-size:14px;color:#6f9a63;font-weight:700;border-bottom:1px dashed #3d4a2e;padding-bottom:4px;margin-bottom:6px;}' +
  '.tbios-end-val{font-size:16px;color:#c8ffc0;margin:3px 0;}' +
  '.tbios-end-val strong{color:#9dffa8;font-size:18px;margin-right:4px;}' +
  '.tbios-xp-reward{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:6px 10px;margin:10px 0 2px;padding:8px 10px;border:1px solid #75662b;background:linear-gradient(90deg,rgba(54,43,12,.52),rgba(16,25,9,.9));color:#ffd85a;box-shadow:inset 0 0 12px rgba(255,216,90,.08);}' +
  '.tbios-xp-star{display:grid;place-items:center;width:28px;height:28px;border:1px solid #ffd85a;border-radius:50%;font-size:17px;color:#fff1a5;text-shadow:0 0 8px rgba(255,216,90,.8);}' +
  '.tbios-xp-label{font-size:14px;letter-spacing:.12em;color:#fff1a5;}' +
  '.tbios-xp-reward strong{font-size:21px;color:#ffd85a;text-shadow:0 0 8px rgba(255,216,90,.45);}' +
  '.tbios-xp-reward > span:last-child{grid-column:2 / -1;font-size:11px;color:#d6c477;letter-spacing:.08em;}';

var rspSt = document.createElement('style');
rspSt.id = 'uifx-rsp-style';
rspSt.textContent = rspCss;
document.head.appendChild(rspSt);

/* ---------- ⑥ 战术 DOM 节点初始化 ---------- */
var RSP = { phase: 'idle', blackAt: 0, canvas: null, pendingHide: null, mgSave: null };
var deathOv = null, deathShatter = null, deathBloodVg = null, lidT = null, lidB = null, deathBlur = null, deathVg = null, deathBlk = null;
var lidTPath = null, lidBPath = null, lidF = 0, lidRaf = 0;
var respModal = null, possModal = null, endModal = null;
var END = { bail: 0, lost: 0, kill: 0, capt: 0 };

function ensureTacticalCornerOverlay() {
  var elCorner = document.getElementById('tactical-screen-corners');
  if (elCorner) return elCorner;
  elCorner = document.createElement('div');
  elCorner.id = 'tactical-screen-corners';
  elCorner.className = 'tactical-screen-corners';
  elCorner.innerHTML = '<span class="tc-c tc-tl"></span><span class="tc-c tc-tr"></span><span class="tc-c tc-bl"></span><span class="tc-c tc-br"></span>';
  document.body.appendChild(elCorner);
  return elCorner;
}

function ensureDeathDom() {
  if (deathOv) return;
  deathOv = document.createElement('div'); deathOv.id = 'uifx-death';
  
  deathShatter = document.createElement('div');
  deathShatter.className = 'uifx-shatter';
  deathShatter.innerHTML = SHATTER_SVG;
  
  deathBloodVg = document.createElement('div');
  deathBloodVg.className = 'uifx-blood-vg';
  
  deathBlur = document.createElement('div'); deathBlur.className = 'uifx-blur';
  deathVg = document.createElement('div'); deathVg.className = 'uifx-vg';
  deathBlk = document.createElement('div'); deathBlk.className = 'uifx-blk';
  
  lidT = document.createElement('div'); lidT.id = 'uifx-lid-t'; lidT.className = 'uifx-lid';
  lidB = document.createElement('div'); lidB.id = 'uifx-lid-b'; lidB.className = 'uifx-lid';
  
  lidT.innerHTML = "<svg viewBox='0 0 1000 100' preserveAspectRatio='none'><path fill='#000' d='M0 0 H1000 V100 H0 Z'/></svg>";
  lidB.innerHTML = "<svg viewBox='0 0 1000 100' preserveAspectRatio='none'><path fill='#000' d='M0 100 H1000 V0 H0 Z'/></svg>";
  lidTPath = lidT.querySelector('path');
  lidBPath = lidB.querySelector('path');
  
  deathOv.appendChild(deathShatter);
  deathOv.appendChild(deathBloodVg);
  deathOv.appendChild(deathBlur);
  deathOv.appendChild(deathVg);
  deathOv.appendChild(lidT);
  deathOv.appendChild(lidB);
  deathOv.appendChild(deathBlk);
  
  document.body.appendChild(deathOv);
  ensureTacticalCornerOverlay();
}

function gameCanvas() {
  if (RSP.canvas && RSP.canvas.isConnected) return RSP.canvas;
  var cs = document.getElementsByTagName('canvas');
  for (var i = 0; i < cs.length; i++)
    if (cs[i].id !== 'hangar-canvas') { RSP.canvas = cs[i]; return cs[i]; }
  return null;
}

/* ---------- ⑦ 眼睑动画与开眼控制 ---------- */
function lidEase(u, ease) {
  var m = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)/.exec(ease || '');
  var x1 = 0.2, y1 = 0.75, x2 = 0.3, y2 = 1;
  if (m) { x1 = +m[1]; y1 = +m[2]; x2 = +m[3]; y2 = +m[4]; }
  function bez(t, a, b) { var s = 1 - t; return 3 * s * s * t * a + 3 * s * t * t * b + t * t * t; }
  var lo = 0, hi = 1, mid = u;
  for (var i = 0; i < 14; i++) {
    mid = (lo + hi) / 2;
    if (bez(mid, x1, x2) < u) lo = mid; else hi = mid;
  }
  return bez(mid, y1, y2);
}

function applyLid(f) {
  f = Math.max(0, Math.min(1, f));
  lidF = f;
  if (!lidT) return;
  lidT.style.transition = lidB.style.transition = 'none';
  lidT.style.transform = 'translateY(' + (f * 118 - 118) + '%)';
  var ss = 0;   // Close the lower lid under the upper arc; preserve the readable center.
  if (f > 0.85) { var sb = (f - 0.85) / 0.15; ss = sb * sb * (3 - 2 * sb); }
  var b = Math.pow(f, 1.75) * 0.4 + ss * 0.6;
  lidB.style.transform = 'translateY(' + (118 - b * 118) + '%)';
  var arc = 22 - f * 18;   // Keep a small arc opening so the center remains visible.
  if (lidTPath) lidTPath.setAttribute('d', 'M0 0 H1000 V100 Q500 ' + (100 - arc).toFixed(1) + ' 0 100 Z');
  if (lidBPath) lidBPath.setAttribute('d', 'M0 100 H1000 V0 Q500 ' + arc.toFixed(1) + ' 0 0 Z');

  var topEdge = Math.max(0, Math.min(72, 72 * (1 + (f * 1.18 - 1.18))));
  var botEdge = 100 - Math.max(0, Math.min(30, 30 * (1 - (1.18 - b * 1.18))));
  var cy = (topEdge + botEdge) * 0.5;
  var hGap = Math.max(6, botEdge - topEdge);

  var rY = Math.max(10, hGap * 0.85);
  var rX = Math.max(26, 45 + hGap * 0.4);
  var gradPos = '50% ' + cy.toFixed(1) + '%';
  var gradRadii = rX.toFixed(1) + '% ' + rY.toFixed(1) + '%';

  if (deathVg) {
    deathVg.style.background = 'radial-gradient(' + gradRadii + ' at ' + gradPos + ', rgba(0,0,0,0) 18%, rgba(0,0,0,0.52) 60%, rgba(0,0,0,0.96) 100%)';
  }
  if (deathBlur) {
    var maskStr = 'radial-gradient(' + gradRadii + ' at ' + gradPos + ', rgba(0,0,0,0) 10%, rgba(0,0,0,0.65) 48%, rgba(0,0,0,1) 92%)';
    deathBlur.style.webkitMaskImage = deathBlur.style.maskImage = maskStr;
  }
  var cv = gameCanvas();
  if (cv && RSP.phase === 'dying') {
    cv.style.transformOrigin = '50% ' + cy.toFixed(1) + '%';
  }
}

/* ---------- ⑦.1 阵亡与复苏动画定时器总线 (防状态冲突与竞态穿透) ---------- */
var _deathTimers = [];
function clearDeathTimers() {
  for (var i = 0; i < _deathTimers.length; i++) {
    clearTimeout(_deathTimers[i]);
  }
  _deathTimers.length = 0;
  if (lidRaf) {
    cancelAnimationFrame(lidRaf);
    lidRaf = 0;
  }
}
window.clearDeathTimers = clearDeathTimers;

function deathTimeout(fn, ms) {
  var tid = setTimeout(function () {
    var idx = _deathTimers.indexOf(tid);
    if (idx >= 0) _deathTimers.splice(idx, 1);
    fn();
  }, ms);
  _deathTimers.push(tid);
  return tid;
}

function lidSet(f, ms, ease) {
  if (!lidT) ensureDeathDom();
  var to = Math.max(0, Math.min(1, f));
  var dur = ms || 0;
  if (lidRaf) { cancelAnimationFrame(lidRaf); lidRaf = 0; }
  if (dur < 12) { applyLid(to); return; }
  var from = lidF;
  var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
  function tick(now) {
    var u = Math.min(1, (now - t0) / dur);
    applyLid(from + (to - from) * lidEase(u, ease));
    if (u < 1) lidRaf = requestAnimationFrame(tick);
    else { applyLid(to); lidRaf = 0; }
  }
  lidRaf = requestAnimationFrame(tick);
}

function cineOut(ac, peak) {
  var g = ac.createGain();
  g.gain.value = peak * uiVol();
  g.connect(ac.destination);
  return g;
}

function worldDuck(frac, sec) {
  if (typeof AC === 'undefined' || !AC || typeof masterGain === 'undefined' || !masterGain) return;
  var t = AC.currentTime;
  if (RSP.mgSave == null) RSP.mgSave = masterGain.gain.value;
  masterGain.gain.cancelScheduledValues(t);
  masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), t);
  masterGain.gain.linearRampToValueAtTime(Math.max(0.0001, RSP.mgSave * frac), t + (sec || 0.8));
}

function worldUnduck(sec) {
  if (typeof AC === 'undefined' || !AC || typeof masterGain === 'undefined' || !masterGain) return;
  var t = AC.currentTime;
  var v = (typeof prefVolume === 'number' && isFinite(prefVolume)) ? prefVolume
        : (RSP.mgSave != null ? RSP.mgSave : 0.55);
  masterGain.gain.cancelScheduledValues(t);
  masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), t);
  masterGain.gain.linearRampToValueAtTime(Math.max(0.0001, v), t + (sec || 0.9));
  RSP.mgSave = null;
}

function sfxHeartbeats() {
  var ac = gameAC(); if (!ac || ac.state !== 'running') return;
  var t0 = ac.currentTime + 0.05;
  var bus = cineOut(ac, 2.0);
  var seq = [[0.00, 1.00], [0.52, 0.70], [1.10, 1.00], [1.68, 0.70], [2.32, 1.00]];
  for (var i = 0; i < seq.length; i++) {
    var t = t0 + seq[i][0], g = 1.50 * seq[i][1];
    var beat = ac.createGain();
    beat.connect(bus);
    if (i === seq.length - 1) {
      beat.gain.setValueAtTime(g, t);
      beat.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
    } else {
      beat.gain.value = g;
    }
    dTn(ac, beat, t, 0.16, 'sine', 110, 55, 0.36, 0.004);
    dTn(ac, beat, t, 0.10, 'triangle', 220, 90, 0.30, 0.003);
    dNz(ac, beat, t, 0.07, 'lowpass', 400, 160, 1, 0.20, 0.003);
    dTn(ac, beat, t + 0.17, 0.13, 'sine', 95, 48, 0.30, 0.004);
    dTn(ac, beat, t + 0.17, 0.09, 'triangle', 190, 80, 0.24, 0.003);
  }
}

function sfxTinnitus() {
  var ac = gameAC(); if (!ac || ac.state !== 'running') return;
  var t0 = ac.currentTime + 0.08, out = cineOut(ac, 2.0);
  var env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(1, t0 + 0.55);
  env.gain.setValueAtTime(1, t0 + 1.85);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.15);
  env.connect(out);
  dTn(ac, env, t0, 3.15, 'sine', 4120, 3980, 0.364, 0.35);
  dTn(ac, env, t0, 3.15, 'sine', 4310, 4180, 0.286, 0.35);
  dNz(ac, env, t0, 3.05, 'bandpass', 3600, 3000, 6, 0.208, 0.35);
  dTn(ac, env, t0, 2.7, 'sine', 82, 48, 0.338, 0.4);
}

function sfxBreath() {
  var ac = gameAC(); if (!ac || ac.state !== 'running') return;
  var t0 = ac.currentTime + 0.02, out = cineOut(ac, 0.95);
  dNz(ac, out, t0, 1.05, 'bandpass', 420, 1150, 0.8, 0.26, 0.5);
  dNz(ac, out, t0, 1.05, 'lowpass', 260, 0, 0.7, 0.10, 0.55);
  dNz(ac, out, t0 + 1.18, 0.6, 'bandpass', 900, 420, 0.8, 0.12, 0.1);
}
window.sfxBreath = sfxBreath;

/* ---------- ⑧ 阵亡全流程 (碎裂 + 心跳血框 + 眨眼闭合) ---------- */
function startDeathAnim(cause) {
  if (RSP.phase === 'dying') return;
  // ★ 核心修复:若玩家刚点下重新部署(处于 wake 或 deploying 阶段)时被击杀,
  // 必须立即中止并清空之前未完成的睁眼定时器与补丁,防止旧定时器把眼皮重新拉开(Bug 1)或在黑屏后擦除黑幕(Bug 2)
  clearDeathTimers();
  ensureDeathDom();
  ensureTacticalCornerOverlay();
  if (respModal) respModal.classList.remove('win-contracting', 'win-expanding');
  if (possModal) possModal.classList.remove('win-contracting', 'win-expanding');
  if (el && el.respawnov) el.respawnov.classList.add('hidden');
  if (el && el.possessov) el.possessov.classList.add('hidden');
  RSP.pendingHide = null;
  RSP.phase = 'dying';
  RSP.blackAt = Date.now() + 3350;   // 黑场3260/收尾3340(血褪后弹窗,等闭眼+血褪)
  
  deathOv.classList.add('on');
  deathBlk.style.opacity = '0';
  if (deathBlur) deathBlur.style.opacity = '1';
  deathVg.style.opacity = '1';
  deathVg.style.animationDuration = '';
  deathVg.classList.add('beat');
  
  var cv = gameCanvas();
  if (cv) {
    cv.style.transition = '';
    cv.style.filter = '';
    cv.classList.add('uifx-dying');
  }
  worldDuck(0.06, 1.7);
  sfxHeartbeats();
  sfxTinnitus();
  var beatP = 840, bloodBeating = true;   // 心跳血脉:血层与暗角beat同周期收拢(暗下去=压向屏幕)
  var bloodBeat = function () {
    if (!bloodBeating || !deathBloodVg || RSP.phase !== 'dying') return;
    deathBloodVg.style.transform = 'scale(1.03)';
    deathTimeout(function () { if (deathBloodVg && RSP.phase === 'dying') deathBloodVg.style.transform = 'scale(1)'; }, 140);
    deathTimeout(bloodBeat, beatP);
  };
  bloodBeat();

  var isKilled = (cause !== 'ABANDONED');
  if (isKilled) {
    if (deathShatter) deathShatter.style.opacity = '1';
    if (deathBloodVg) {
      deathBloodVg.style.transition = '';
      deathBloodVg.style.opacity = '1';
      deathBloodVg.style.transform = 'scale(1)';
      deathBloodVg.style.setProperty('--blood-depth', '8%');
      deathTimeout(function () { if (deathBloodVg && RSP.phase === 'dying') deathBloodVg.style.setProperty('--blood-depth', '18%'); }, 520);
      deathTimeout(function () { if (deathBloodVg && RSP.phase === 'dying') deathBloodVg.style.setProperty('--blood-depth', '28%'); }, 1100);
      deathTimeout(function () { if (deathBloodVg && RSP.phase === 'dying') deathBloodVg.style.setProperty('--blood-depth', '38%'); }, 1680);
      deathTimeout(function () { if (deathBloodVg && RSP.phase === 'dying') deathBloodVg.style.setProperty('--blood-depth', '50%'); }, 2320);
    }
  }

  lidSet(0.12, 160);
  deathTimeout(function () { if (RSP.phase === 'dying') lidSet(0.92, 70); }, 140);
  deathTimeout(function () { if (RSP.phase === 'dying') lidSet(0.16, 160); }, 230);
  deathTimeout(function () { if (RSP.phase === 'dying') lidSet(0.96, 80); }, 560);
  deathTimeout(function () { if (RSP.phase === 'dying') lidSet(0.34, 200); }, 670);
  deathTimeout(function () { if (RSP.phase === 'dying') lidSet(1.00, 90); }, 1080);
  deathTimeout(function () { if (RSP.phase === 'dying') lidSet(0.52, 240); }, 1210);
  deathTimeout(function () { if (RSP.phase === 'dying') lidSet(1.00, 110); }, 1680);
  deathTimeout(function () { if (RSP.phase === 'dying') lidSet(0.70, 280); }, 1840);
  deathTimeout(function () { if (RSP.phase === 'dying') lidSet(1, 720, 'cubic-bezier(.45,0,.8,.35)'); }, 2260);
  
  deathTimeout(function () { if (deathVg && RSP.phase === 'dying') deathVg.style.animationDuration = '1.2s'; beatP = 1200; }, 900);
  deathTimeout(function () { if (deathVg && RSP.phase === 'dying') deathVg.style.animationDuration = '1.6s'; beatP = 1600; }, 1700);
  deathTimeout(function () { if (deathVg && RSP.phase === 'dying') deathVg.classList.remove('beat'); bloodBeating = false; }, 2500);

  deathTimeout(function () {
    if (RSP.phase !== 'dying') return;
    if (deathBloodVg) {
      deathBloodVg.style.transition = 'opacity .22s ease-out, transform .22s ease-out';
      deathBloodVg.style.opacity = '0';
      deathBloodVg.style.transform = 'scale(1.15)';
    }
    if (deathShatter) deathShatter.style.opacity = '0';
  }, 3000);   // 睑闭合(2980)后血褪

  deathTimeout(function () {
    if (RSP.phase !== 'dying') return;
    deathBlk.style.opacity = '1';
  }, 3260);
  deathTimeout(function () {
    if (RSP.phase !== 'dying') return;
    if (cv) cv.classList.remove('uifx-dying');
    RSP.phase = 'black';
  }, 3340);
}

/* ---------- ⑨ 战术 BIOS 部署/接管模态窗构建 ---------- */
function buildTacticalBiosWindow(ov, isPossess) {
  var win = document.createElement('div');
  win.className = 'tactical-bios-window bios-term win-expanding';
  win.innerHTML =
    '<div class="bios-scan"></div>' +
    '<div class="bios-corners"><span class="tl"></span><span class="tr"></span><span class="bl"></span><span class="br"></span></div>' +
    '<div class="bios-haz"></div>' +
    
    '<div class="mm-modal-head bios-head">' +
      '<div class="bios-title tb-win-title">TACTICAL PANEL</div>' +
      '<div class="bios-hud">' +
        '<div class="bios-batt"><span>PWR</span><div class="bios-batt-track"><i class="bios-batt-fill"></i></div><b class="bios-batt-pct">100%</b></div>' +
        '<div class="bios-sig"><span>LINK</span><div class="bios-siggrid"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><span class="bios-sig-db">-8dB</span></div>' +
        '<div class="bios-clock tb-clock">00:00:00</div>' +
      '</div>' +
    '</div>' +

    '<div class="tbios-boot-screen">' +
      '<div class="tbios-boot-lines"></div>' +
    '</div>' +

    '<div class="mm-modal-body bios-body tbios-panel-content" style="display:none;">' +
      (isPossess ? '' :
        '<div class="tbios-sec tbios-sec-hq">' +
          '<div class="tbios-sec-title">STAGING BASE</div>' +
          '<div class="tbios-slot-hq"></div>' +
        '</div>') +
      '<div class="tbios-sec tbios-sec-kind">' +
        '<div class="tbios-sec-title">' + (isPossess ? 'TAKE OVER' : 'VEH TYPE') + '</div>' +
        '<div class="tbios-slot-kind"></div>' +
      '</div>' +
    '</div>' +

    '<div class="mm-modal-foot bios-foot tbios-foot" style="display:none;">' +
      '<div class="tbios-slot-action"></div>' +
    '</div>' +

    '<div class="bios-status"><span>CH-04 <b class="ok">SYNC</b></span><span>RADAR <b class="ok">LIVE</b></span><span>AUTH <b class="ok">GRANTED</b></span></div>' +
    '<div class="bios-haz"></div>';
  
  ov.innerHTML = '';
  ov.appendChild(win);
  return win;
}

function ensureTacticalUI() {
  if (typeof el === 'undefined' || !el) return;
  if (!respModal && el.respawnov && el.rhqrow && el.rkindrow && el.rconfirm) {
    respModal = buildTacticalBiosWindow(el.respawnov, false);
    respModal.querySelector('.tbios-slot-hq').appendChild(el.rhqrow);
    respModal.querySelector('.tbios-slot-kind').appendChild(el.rkindrow);
    respModal.querySelector('.tbios-slot-action').appendChild(el.rconfirm);
  }
  if (!possModal && el.possessov && el.posskindrow) {
    possModal = buildTacticalBiosWindow(el.possessov, true);
    possModal.querySelector('.tbios-slot-kind').appendChild(el.posskindrow);
  }
}

function runBiosBootAnimation(win, onReady) {
  var bootScreen = win.querySelector('.tbios-boot-screen');
  var bootLines = win.querySelector('.tbios-boot-lines');
  var panelContent = win.querySelector('.tbios-panel-content');
  var foot = win.querySelector('.tbios-foot');
  
  bootScreen.style.display = 'flex';
  panelContent.style.display = 'none';
  if (foot) foot.style.display = 'none';
  bootLines.innerHTML = '';

  win.classList.remove('win-contracting');
  win.classList.remove('win-expanding');
  void win.offsetWidth;
  win.classList.add('win-expanding');

  if (typeof sfxUiDi === 'function') sfxUiDi(2); else if (typeof sfxTacticalBeep === 'function') sfxTacticalBeep(2);

  var lines = [
    '<div class="tbios-boot-line" style="animation-delay:0ms"><span class="tb-tag">[BOOT]</span> BOOTING... <span class="tb-ok">[OK]</span></div>',
    '<div class="tbios-boot-line" style="animation-delay:180ms"><span class="tb-tag">[AUTH]</span> REQUESTING AUTH... <span class="tb-ok">[GRANTED]</span></div>',
    '<div class="tbios-boot-line" style="animation-delay:380ms"><span class="tb-tag">[LINK]</span> SYNCING DATALINK... <span class="tb-ok">[ONLINE]</span></div>',
    '<div class="tbios-boot-line" style="animation-delay:580ms"><span class="tb-tag tb-hi">[READY]</span> WELCOME TO THE TACTICAL PANEL! <span class="loader-cursor blink">_</span></div>'
  ];

  lines.forEach(function (lHtml) {
    var div = document.createElement('div');
    div.innerHTML = lHtml;
    bootLines.appendChild(div.firstChild);
  });

  deathTimeout(function () {
    if (typeof sfxUiDi === 'function') sfxUiDi(1); else if (typeof sfxTacticalBeep === 'function') sfxTacticalBeep(1);
  }, 580);

  deathTimeout(function () {
    bootScreen.style.display = 'none';
    panelContent.style.display = 'flex';
    if (foot) foot.style.display = 'flex';
    if (onReady) onReady();
  }, 840);
}

function rspAbort() {
  clearDeathTimers();
  RSP.pendingHide = null;
  worldUnduck(0.45);
  if (!deathOv) { RSP.phase = 'idle'; return; }
  deathBlk.style.opacity = '0';
  if (deathBlur) deathBlur.style.opacity = '0';
  deathVg.style.opacity = '0';
  deathVg.classList.remove('beat');
  lidSet(0, 400);
  var cv = gameCanvas();
  if (cv) { cv.classList.remove('uifx-dying'); cv.style.transition = ''; cv.style.filter = ''; cv.style.animation = ''; }
  RSP.phase = 'idle';
  deathTimeout(function () { if (RSP.phase === 'idle') deathOv.classList.remove('on'); }, 460);
}

function waitUntilDeathBlack(cb) {
  if (typeof cb !== 'function') return;
  if (RSP.phase === 'black') { cb(); return; }
  if (RSP.phase !== 'dying') startDeathAnim('KIA');
  var started = Date.now();
  function poll() {
    var due = (RSP.blackAt || 0) + 120;
    if (RSP.phase === 'black' || Date.now() >= due || Date.now() - started > 4000) {
      RSP.phase = 'black';
      if (deathBlk) deathBlk.style.opacity = '1';
      if (typeof lidSet === 'function') lidSet(1, 0);
      cb();
      return;
    }
    requestAnimationFrame(poll);
  }
  poll();
}

/* ---------- ⑩ 包装游戏原生显隐 ---------- */
if (typeof window.showRespawnUI === 'function') {
  var _sruo = window.showRespawnUI;
  window.showRespawnUI = function () {
    ensureTacticalUI();
    if (!respModal) { waitUntilDeathBlack(_sruo); return; }
    waitUntilDeathBlack(function () {
      _sruo();
      runBiosBootAnimation(respModal, function () {
        RSP.phase = 'form';
      });
    });
  };
}

if (typeof window.showPossessOv === 'function') {
  var _spoo = window.showPossessOv;
  window.showPossessOv = function () {
    ensureTacticalUI();
    if (!possModal) { waitUntilDeathBlack(_spoo); return; }
    waitUntilDeathBlack(function () {
      _spoo();
      runBiosBootAnimation(possModal, function () {
        RSP.phase = 'form';
      });
    });
  };
}

if (typeof window.hideRespawnUI === 'function') {
  var _hruo = window.hideRespawnUI;
  window.hideRespawnUI = function () {
    if (RSP.phase === 'deploying') { RSP.pendingHide = _hruo; return; }
    var wasForm = RSP.phase === 'form';
    if (wasForm && typeof sfxUiDi === 'function') sfxUiDi(2);
    _hruo();
    if (wasForm) rspAbort();
  };
}

if (typeof window.hidePossessOv === 'function') {
  var _hpoo = window.hidePossessOv;
  window.hidePossessOv = function () {
    if (RSP.phase === 'deploying') { RSP.pendingHide = _hpoo; return; }
    var wasForm2 = RSP.phase === 'form';
    if (wasForm2 && typeof sfxUiDi === 'function') sfxUiDi(2);
    _hpoo();
    if (wasForm2) rspAbort();
  };
}

document.addEventListener('click', function (e) {
  if (RSP.phase !== 'form') return;
  var b = btnOf(e.target);
  if (!b || b.disabled) return;
  var isResp = el && el.rconfirm && b === el.rconfirm;
  var isPoss = el && el.posskindrow && el.posskindrow.contains && el.posskindrow.contains(b);
  if (!isResp && !isPoss) return;
  
  RSP.phase = 'deploying';
  var win = isResp ? respModal : possModal;
  
  if (win) {
    win.classList.remove('win-expanding');
    win.classList.add('win-contracting');
  }

  deathTimeout(function () {
    if (RSP.phase !== 'deploying') return;
    var ok = (typeof player !== 'undefined') && player && player.alive;
    if (!ok && isResp) {
      RSP.phase = 'form';
      if (win) win.classList.remove('win-contracting');
      var h0 = RSP.pendingHide; RSP.pendingHide = null;
      if (h0) h0();
      return;
    }
    
    var h = RSP.pendingHide; RSP.pendingHide = null;
    if (h) h();
    if (win) win.classList.remove('win-contracting');
    wakeSeq();
  }, 220);
}, true);

function wakeSeq() {
  clearDeathTimers();
  RSP.phase = 'wake';
  deathTimeout(function () {
    if (RSP.phase === 'wake') sfxBreath();
  }, 160);
  deathTimeout(function () {
    if (RSP.phase !== 'wake') return;
    worldUnduck(1.35);
    var cv = gameCanvas();
    if (cv) {
      cv.style.animation = 'none';
      cv.style.transition = 'none';
      cv.style.filter = 'blur(6px) brightness(.7) saturate(.5)';
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        if (RSP.phase === 'wake') {
          cv.style.transition = 'filter 1.15s ease-out';
          cv.style.filter = '';
        }
      }); });
    }
    deathBlk.style.opacity = '0';
    if (deathBlur) deathBlur.style.opacity = '0';
    deathVg.style.opacity = '0';
    deathVg.classList.remove('beat');
    lidSet(0, 980, 'cubic-bezier(.65,0,.22,1)');
  }, 720);
  deathTimeout(function () {
    if (RSP.phase !== 'wake') return;
    deathOv.classList.remove('on');
    var cv = gameCanvas(); if (cv) { cv.style.transition = ''; cv.style.animation = ''; }
    RSP.phase = 'idle';
  }, 2150);
}

/* ---------- ⑪ 车库到对局转场 (Hangar -> Battle) ---------- */
function transitionHangarToBattle(onComplete) {
  var startsub = document.getElementById('startsub');
  var hangarBox = document.getElementById('mm-cover');
  var startov = document.getElementById('startov');
  
  if (startsub && !startsub.classList.contains('hidden')) {
    startsub.classList.add('win-contracting');
  }

  setTimeout(function () {
    ensureTacticalCornerOverlay();
    ensureDeathDom();
    deathOv.classList.add('on');
    deathBlk.style.opacity = '1';
    lidSet(1, 0);
    
    if (hangarBox) hangarBox.classList.add('crt-powering-off');

    setTimeout(function () {
      try { _sg(); } catch (err) { console.error(err); }
      
      if (startsub) {
        startsub.classList.remove('win-contracting');
        startsub.classList.add('hidden');
      }
      if (startov) startov.classList.add('hidden');
      if (hangarBox) hangarBox.classList.remove('crt-powering-off');

      var cv = gameCanvas();
      if (cv) {
        cv.style.filter = 'blur(8px) brightness(.7)';
      }

      setTimeout(function () {
        sfxBreath();
      }, 160);

      setTimeout(function () {
        worldUnduck(1.2);
        deathBlk.style.opacity = '0';
        if (cv) {
          cv.style.transition = 'filter 1.15s ease-out';
          cv.style.filter = '';
        }
        lidSet(0, 950, 'cubic-bezier(.65,0,.22,1)');
        setTimeout(function () {
          deathOv.classList.remove('on');
          if (cv) { cv.style.transition = ''; }
          if (onComplete) onComplete();
        }, 1100);
      }, 700);
    }, 280);
  }, 200);
}

/* ---------- ⑫ 对局退回主菜单转场 (Battle -> Hangar) ---------- */
function transitionBattleToHangar(onComplete) {
  // Last-resort settlement for an end-screen transition that is interrupted
  // before the wrapped gameOver callback reaches its original body.
  try {
    if ((gameState === 'over' || window._vehicleTechMatchEnded === true) && window.vehicleTechSettleMatch) {
      window.vehicleTechSettleMatch(!!window._vehicleTechMatchWin, typeof kills === 'number' ? kills : 0);
    }
  } catch (eVehicleXpExit) {}
  worldUnduck(0.8);   // §6:局内死亡压制(master 6%)可能残留到结算后,回车库先恢复(否则菜单音效哑 ~19dB 到下次进局)
  var pausePanel = document.querySelector('#pauseov .bios-pause-panel') || document.getElementById('pauseov');
  var endPanel = document.querySelector('#endov .tactical-bios-window') || document.getElementById('endov');
  var activePanel = (el && el.pauseov && !el.pauseov.classList.contains('hidden')) ? pausePanel : endPanel;

  if (activePanel) {
    activePanel.classList.add('win-contracting');
  }

  setTimeout(function () {
    var cv = gameCanvas();
    if (cv) cv.classList.add('crt-powering-off');
    ensureTacticalCornerOverlay();

    setTimeout(function () {
      if (cv) cv.classList.remove('crt-powering-off');
      if (typeof window.showBootLoading === 'function') {
        window.showBootLoading('INITIALIZING HANGAR // PREPARING VEHICLES...', function () {
          if (activePanel) activePanel.classList.remove('win-contracting');
          if (el && el.pauseov) el.pauseov.classList.add('hidden');
          if (el && el.endov) el.endov.classList.add('hidden');
          if (el && el.hud) el.hud.classList.add('hidden');
          if (el && el.respawnov) el.respawnov.classList.add('hidden');
          if (el && el.possessov) el.possessov.classList.add('hidden');
          try { if (typeof resetBattleViewModes === 'function') resetBattleViewModes(); } catch (eRVM) {}   // M2:退局观瞄复位(热像共享材质还原,防车库灰车)
          if (typeof window.clearBattleEntities === 'function') window.clearBattleEntities();
          var startov = document.getElementById('startov');
          if (startov) startov.classList.remove('hidden');
          var boot = document.getElementById('game-boot-loader');
          if (boot) {
            boot.classList.add('hidden-loader');
            boot.style.display = 'none';
            boot.style.pointerEvents = 'none';
          }
          if (typeof deathOv !== 'undefined' && deathOv) {
            deathOv.classList.remove('on');
            if (deathBlk) deathBlk.style.opacity = '0';
          }
          if (typeof RSP !== 'undefined') RSP.phase = 'idle';
          try { document.exitPointerLock && document.exitPointerLock(); } catch (e0) {}
          gameState = 'menu';
          curView = 'mainmenu';
          if (_smv) _smv('mainmenu');
          mmSync('mainmenu');
          if (typeof refreshGameModeUI === 'function') refreshGameModeUI();
          if (typeof window.vehicleTechRefreshUI === 'function') window.vehicleTechRefreshUI();
          if (typeof Hangar3D !== 'undefined') {
            try { if (Hangar3D.pause) Hangar3D.pause(); } catch (e1) {}
            try { if (Hangar3D.resume) Hangar3D.resume(); } catch (e2) {}
          }
          if (typeof playMenuBgm === 'function') playMenuBgm();
          if (onComplete) onComplete();
        });
      } else {
        location.reload();
      }
    }, 240);
  }, 200);
}

/* ---------- ⑬ 全局接线与菜单事件 ---------- */
var curView = 'mainmenu';
var _smv = (typeof window.showMenuView === 'function') ? window.showMenuView : null;
function mmSync(name) {
  var ov = document.getElementById('startov');
  if (ov) {
    ov.classList.toggle('mm-on-main', name === 'mainmenu');
    if (name === 'mainmenu') ov.classList.remove('mm-previewing');
  }
  if (name === 'mainmenu') {
    if (typeof Hangar3D !== 'undefined' && Hangar3D.resume) {
      setTimeout(function () { Hangar3D.resume(); }, 50);
    }
  } else {
    if (typeof Hangar3D !== 'undefined' && Hangar3D.pause) {
      Hangar3D.pause();
    }
  }
  var t = document.getElementById('mm-panel-title');
  var e = document.getElementById('mm-panel-en');
  var map = {
    mainmenu: ['HANGAR', 'HANGAR // VEHICLE INSPECTION'],
    startsub: ['SKIRMISH', 'SKIRMISH // BATTLE PARAMETERS'],
    settingssub: ['SETTINGS', 'SETTINGS // AUDIO & CONTROLS']
  };
  var m = map[name] || map.mainmenu;
  if (t) t.textContent = m[0];
  if (e) e.textContent = m[1];
}

if (_smv) {
  window.showMenuView = function (name) {
    if (name === curView) { _smv(name); mmSync(name); return; }
    curView = name;
    _smv(name); mmSync(name);
  };
}

if (typeof window.startGame === 'function') {
  var _sg = window.startGame;
  window.startGame = function () {
    transitionHangarToBattle();
  };
}

function inBattleUI() {
  var hud = document.getElementById('hud');
  if (hud && !hud.classList.contains('hidden')) return true;
  var p = document.getElementById('pauseov');
  if (p && !p.classList.contains('hidden')) return true;
  var e = document.getElementById('endov');
  if (e && !e.classList.contains('hidden')) return true;
  if (typeof gameState === 'string' && gameState === 'playing') return true;
  return false;
}

function closePreviewQuiet() {
  var ov = document.getElementById('startov');
  if (ov) ov.classList.remove('mm-previewing');
  try {
    if (typeof pvOpen !== 'undefined') pvOpen = false;
    if (typeof bindPreviewInput === 'function') bindPreviewInput(false);
  } catch (err) {}
}

window.uifxReturnToMenu = function () {
  if (inBattleUI()) { transitionBattleToHangar(); return; }
  closePreviewQuiet();
  curView = 'mainmenu';
  if (_smv) _smv('mainmenu');
  mmSync('mainmenu');
  if (typeof refreshGameModeUI === 'function') refreshGameModeUI();
  if (typeof playMenuBgm === 'function') playMenuBgm();
};

function btnOf(n) {
  while (n && n !== document && n.nodeType === 1) {
    if (n.tagName === 'BUTTON') return n;
    n = n.parentNode;
  }
  return null;
}
function isCombatBtn(b) {
  if (!b.classList || !b.classList.contains('bigbtn')) return false;
  var t = (b.textContent || '').replace(/\s+/g, '');
  return t === 'MAIN MENU' || t === 'TO BATTLE' || t === 'START GAME' || t === 'DEPLOY' || t === 'HANGER' || t === 'Hanger' ||
         b.id === 'startbtn' || (b.id && b.id.indexOf('menubtn-') === 0);
}

document.addEventListener('mouseover', function (e) {
  var n = e.target;
  if (!n || !n.closest) return;
  var b = btnOf(n);
  if (b && b.disabled) return;
  if (b && e.relatedTarget && b.contains(e.relatedTarget)) return;
  if (!b && e.relatedTarget && n.contains && n.contains(e.relatedTarget)) return;
  if (b && isCombatBtn(b)) playUISound('reload');
  
  var host = b || n;
  var inStart = !!host.closest('#startsub');
  var inPause = !!host.closest('#pauseov');
  var inSet = !!host.closest('#settingssub');
  var inRsp = !!host.closest('#respawnov, #possessov, #endov');
  var tag = (n.tagName || '').toUpperCase();
  
  if (inRsp && b && typeof sfxUiDi === 'function') sfxUiDi(1);
  else if (inStart && (b || tag === 'INPUT') && typeof sfxUiDi === 'function') sfxUiDi(1);
  else if (inPause && b && typeof sfxUiDi === 'function') sfxUiDi(1);
  else if (inSet && (b || tag === 'BUTTON' || tag === 'INPUT') && typeof sfxUiDi === 'function') sfxUiDi(1);
}, true);
document.addEventListener('pointerenter', function (e) {
  var n = e.target;
  if (!n || n.nodeType !== 1 || !n.closest) return;
  var b = n.closest('button, .optbtn, .bigbtn');
  if (!b || b.disabled) return;
  if (!b.closest('#pauseov, #respawnov, #possessov, #endov')) return;
  if (typeof sfxUiDi === 'function') sfxUiDi(1);
}, true);

document.addEventListener('click', function (e) {
  var hangarBtn = e.target && e.target.closest && e.target.closest('#menubtn-battle, #menubtn-settings, #menubtn-achievements');
  if (hangarBtn && typeof sfxUiDi === 'function') sfxUiDi(2);
  var b = btnOf(e.target);
  if (b && !b.disabled) {
    var inStart = !!(b.closest && b.closest('#startsub'));
    var inPause = !!(b.closest && b.closest('#pauseov'));
    var inSet = !!(b.closest && b.closest('#settingssub'));
    var inRsp = !!(b.closest && b.closest('#respawnov, #possessov, #endov'));
    
    if (inRsp) {
      if (typeof sfxUiDi === 'function') sfxUiDi(2);
    } else if ((inStart && b.classList.contains('mm-modal-back-btn')) || inPause ||
               (inSet && b.classList.contains('mm-modal-back-btn'))) {
      if (typeof sfxUiDi === 'function') sfxUiDi(2);
    } else if ((inStart || inSet) && b.classList.contains('optbtn')) {
      if (typeof sfxUiDi === 'function') sfxUiDi(1);
    } else if (isCombatBtn(b)) {
      playUISound('fire');
      var x = e.clientX, y = e.clientY;
      if ((!x && !y) || e.detail === 0) {
        var rc = b.getBoundingClientRect();
        x = rc.left + rc.width * (0.3 + Math.random() * 0.4);
        y = rc.top + rc.height * (0.3 + Math.random() * 0.4);
      }
      spawnBulletHole(x, y);
    } else {
      playUISound('gear');
    }
  } else {
    var n = e.target;
    if (n && n.closest && n.closest('#settingssub .mm-modal-close') && typeof sfxUiDi === 'function') sfxUiDi(2);
    else if (!document.pointerLockElement) spawnBlankTap(e.clientX, e.clientY);
  }
}, true);

document.addEventListener('pointerdown', function () { gameAC(); }, { capture: true, passive: true });
document.addEventListener('keydown', function () { gameAC(); }, true);
/* ★移动端适配:iOS 仅 touchend/pointerup 才算用户激活 —— 战斗中触控层会 preventDefault 吞掉 click,
   这里补挂两者,确保触屏端 AudioContext 能被唤醒。 */
document.addEventListener('touchend', function () { gameAC(); }, { capture: true, passive: true });
document.addEventListener('pointerup', function () { gameAC(); }, { capture: true, passive: true });

/* ---------- ⑭ 终局战报系统 ---------- */
function resetEndStats() { END.bail = END.lost = END.kill = END.capt = 0; }
function noteKill(t, cause) {
  if (!t || !t.alive || (typeof UNIT_ALIVE !== 'undefined' && t.unitState !== UNIT_ALIVE)) return;
  var ab = cause === 'ABANDONED';
  var mine = false;
  try { mine = !isFfaMode() && t.team === (typeof pSide === 'function' ? pSide() : startSide); } catch (e) { mine = t.team === 'red'; }
  if (mine) { if (ab) END.bail++; else END.lost++; }
  else { if (ab) END.capt++; else END.kill++; }
}

function buildEndDebrief(ov) {
  var win = document.createElement('div');
  win.className = 'tactical-bios-window bios-term win-expanding';
  win.innerHTML =
    '<div class="bios-scan"></div>' +
    '<div class="bios-corners"><span class="tl"></span><span class="tr"></span><span class="bl"></span><span class="br"></span></div>' +
    '<div class="bios-haz"></div>' +
    
    '<div class="mm-modal-head bios-head">' +
      '<div class="bios-title tb-end-title">TACTICAL PANEL</div>' +
      '<div class="bios-hud">' +
        '<div class="bios-batt"><span>PWR</span><div class="bios-batt-track"><i class="bios-batt-fill"></i></div><b class="bios-batt-pct">82%</b></div>' +
        '<div class="bios-sig"><span>LINK</span><div class="bios-siggrid"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><span class="bios-sig-db">-14dB</span></div>' +
        '<div class="bios-clock tb-end-clock">00:00:00</div>' +
      '</div>' +
    '</div>' +

    '<div class="mm-modal-body bios-body tbios-panel-content">' +
      '<div class="tbios-sec">' +
        '<div class="tbios-sec-title" id="tbios-end-headline" style="font-size:18px;color:#c8ffc0;text-align:center;">BATTLE OVER</div>' +
        '<div class="tbios-end-grid">' +
          '<div class="tbios-end-card">' +
            '<div class="tbios-end-head" id="tbios-end-own-head">FRIENDLY LOSSES</div>' +
            '<div class="tbios-end-val"><strong id="tbios-end-lost">0</strong> CREWS LOST</div>' +
            '<div class="tbios-end-val"><strong id="tbios-end-bail">0</strong> CREWS BAILED</div>' +
          '</div>' +
          '<div class="tbios-end-card">' +
            '<div class="tbios-end-head" id="tbios-end-foe-head">ENEMY TALLY</div>' +
            '<div class="tbios-end-val"><strong id="tbios-end-kill">0</strong> FOE VEH KILLED</div>' +
            '<div class="tbios-end-val"><strong id="tbios-end-capt">0</strong> FOE VEH CAPTURED</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="tbios-xp-reward" id="tbios-end-xp" aria-live="polite">' +
        '<span class="tbios-xp-star">★</span><span class="tbios-xp-label">EXPERIENCE EARNED</span><strong id="tbios-end-xp-total">+0 XP</strong>' +
        '<span id="tbios-end-xp-breakdown">COMPLETION +5 // VICTORY +0 // KILLS +0</span>' +
      '</div>' +
    '</div>' +

    '<div class="mm-modal-foot bios-foot tbios-foot" style="gap:12px;">' +
      '<div class="tbios-end-actions" style="display:flex;gap:12px;justify-content:center;align-items:center;width:100%;flex-wrap:wrap;"></div>' +
    '</div>' +

    '<div class="bios-status"><span>CH-04 <b class="ok">SYNC</b></span><span>REPORT <b class="ok">ARCHIVED</b></span><span>AUTH <b class="ok">FORWARD</b></span></div>' +
    '<div class="bios-haz"></div>';
  
  ov.innerHTML = '';
  ov.appendChild(win);
  return win;
}

function ensureEndUI() {
  if (typeof el === 'undefined' || !el || !el.endov) return;
  if (!endModal) {
    endModal = buildEndDebrief(el.endov);
  }
  var act = endModal.querySelector('.tbios-end-actions');
  if (act) {
    if (el.continuebtn && !act.contains(el.continuebtn)) act.appendChild(el.continuebtn);
    if (el.airSupportBtn && !act.contains(el.airSupportBtn)) act.appendChild(el.airSupportBtn);
    if (el.restartbtn && !act.contains(el.restartbtn)) act.appendChild(el.restartbtn);
  }
}

function fillEndExperience() {
  if (!endModal) return;
  var reward = (typeof window !== 'undefined' && window._vehicleTechLastXpReward) || null;
  var total = reward ? reward.total : 0;
  var completion = reward ? reward.completion : 5;
  var victory = reward ? reward.victory : 0;
  var killsXp = reward ? reward.kills : 0;
  var totalEl = endModal.querySelector('#tbios-end-xp-total');
  var breakdownEl = endModal.querySelector('#tbios-end-xp-breakdown');
  if (totalEl) totalEl.textContent = '+' + total + ' XP';
  if (breakdownEl) breakdownEl.textContent = 'COMPLETION +' + completion + ' // VICTORY +' + victory + ' // KILLS +' + killsXp;
}

function fillEndReport(win) {
  if (!endModal) return;
  ensureEndUI();
  fillEndExperience();
  if (el.continuebtn) el.continuebtn.classList.toggle('hidden', !win);
  if (el.airSupportBtn) el.airSupportBtn.classList.toggle('hidden', isFfaMode() || !!win);
  var myName, foeName;
  if (isFfaMode()) {
    myName = 'PERSONAL RESULT'; foeName = 'FREE-FOR-ALL STATUS';
    var fOwn = endModal.querySelector('#tbios-end-own-head');
    var fFoe = endModal.querySelector('#tbios-end-foe-head');
    var fTitle = endModal.querySelector('#tbios-end-headline');
    if (fOwn) fOwn.textContent = 'PERSONAL RESULT';
    if (fFoe) fFoe.textContent = 'SURVIVOR BOARD';
    if (fTitle) {
      fTitle.textContent = win ? '[*] VICTORY! LAST SURVIVOR [*]' : 'DEFEAT! ELIMINATED';
      fTitle.style.color = win ? '#9dffa8' : '#ff5d55';
    }
    var fLost = endModal.querySelector('#tbios-end-lost');
    var fBail = endModal.querySelector('#tbios-end-bail');
    var fKill = endModal.querySelector('#tbios-end-kill');
    var fCapt = endModal.querySelector('#tbios-end-capt');
    if (fLost) fLost.textContent = kills;
    if (fBail) fBail.textContent = typeof ffaPlayerRank === 'function' ? ffaPlayerRank() : (win ? 1 : 0);
    if (fKill) fKill.textContent = ffaState.reserves;
    if (fCapt) fCapt.textContent = ffaAliveCount();
    var fLostRow = fLost && fLost.parentNode;
    var fBailRow = fBail && fBail.parentNode;
    var fKillRow = fKill && fKill.parentNode;
    var fCaptRow = fCapt && fCapt.parentNode;
    if (fLostRow) fLostRow.lastChild.textContent = ' PLAYER KILLS';
    if (fBailRow) fBailRow.lastChild.textContent = ' FINAL RANK';
    if (fKillRow) fKillRow.lastChild.textContent = ' RESERVE VEHICLES';
    if (fCaptRow) fCaptRow.lastChild.textContent = ' SURVIVORS LEFT';
    return;
  }
  try {
    var ps = (typeof pSide === 'function') ? pSide() : startSide;
    myName = (ps === 'red') ? 'RED' : 'BLUE';
  } catch (e) { myName = 'RED'; }
  foeName = (myName === 'RED') ? 'BLUE' : 'RED';
  var ownHead = endModal.querySelector('#tbios-end-own-head');
  if (ownHead) ownHead.textContent = myName + ' LOSSES';
  var foeHead = endModal.querySelector('#tbios-end-foe-head');
  if (foeHead) foeHead.textContent = foeName + ' TALLY';
  var t = endModal.querySelector('#tbios-end-headline');
  if (t) {
    t.textContent = win ? '[*] VICTORY! OBJECTIVE TAKEN! [*]' : 'DEFEAT! ' + foeName + ' TOOK THE OBJECTIVE!';
    t.style.color = win ? '#9dffa8' : '#ff5d55';
  }
  var elLost = endModal.querySelector('#tbios-end-lost');
  var elBail = endModal.querySelector('#tbios-end-bail');
  var elKill = endModal.querySelector('#tbios-end-kill');
  var elCapt = endModal.querySelector('#tbios-end-capt');
  if (elLost) elLost.textContent = END.lost;
  if (elBail) elBail.textContent = END.bail;
  if (elKill) elKill.textContent = END.kill;
  if (elCapt) elCapt.textContent = END.capt;
}

function endContinue() {
  if (RSP.phase !== 'endform' || !endModal) return;
  if (typeof sfxUiDi === 'function') sfxUiDi(2);
  RSP.phase = 'endleave';
  endModal.classList.remove('win-expanding');
  endModal.classList.add('win-contracting');
  setTimeout(function () {
    if (el && el.endov) el.endov.classList.add('hidden');
    endModal.classList.remove('win-contracting');
    try {
      freePlay = true;
      gameState = 'playing';
      if (player && player.alive) { if (typeof attemptLock === 'function') attemptLock(); }
      else respawnT = 1.6;
      if (typeof updateLockHint === 'function') updateLockHint();
    } catch (err) {}
    wakeSeq();
  }, 220);
}

function endAirSupport() {
  if (typeof sfxUiDi === 'function') sfxUiDi(2);

  function executeAirSupport() {
    var mySide = (typeof pSide === 'function') ? pSide() : (startSide || 'red');
    if (typeof teamPool !== 'undefined') {
      teamPool[mySide] = (teamPool[mySide] || 0) + 50;
    }
    if (el.poolr && el.poolb && typeof updatePoolBar === 'function') updatePoolBar();
    if (typeof logMsg === 'function') logMsg('★ AIR REINFORCEMENTS ARRIVED: +50 FORCES!', 'sys');

    RSP.phase = 'endleave';
    if (endModal) {
      endModal.classList.remove('win-expanding');
      endModal.classList.add('win-contracting');
    }
    setTimeout(function () {
      if (el && el.endov) el.endov.classList.add('hidden');
      if (endModal) endModal.classList.remove('win-contracting');
      try {
        freePlay = true;
        gameState = 'playing';
        if (window.CrazyGamesAdapter) window.CrazyGamesAdapter.gameplayStart();
        if (player && !player.alive && typeof redeployPlayer === 'function') {
          redeployPlayer();
        } else if (player && player.alive) {
          if (typeof attemptLock === 'function') attemptLock();
        } else {
          respawnT = 1.6;
        }
        if (typeof updateLockHint === 'function') updateLockHint();
        if (typeof window._touchUISync === 'function') window._touchUISync();
        worldUnduck(0.4);
      } catch (err) {}
      wakeSeq();
    }, 220);
  }

  executeAirSupport();
}
window.endAirSupport = endAirSupport;

if (typeof window.killTank === 'function') {
  var _kt = window.killTank;
  window.killTank = function (t, cause) {
    noteKill(t, cause);
    return _kt.apply(this, arguments);
  };
}

if (typeof window.spawnTeams === 'function') {
  var _spt = window.spawnTeams;
  window.spawnTeams = function () {
    resetEndStats();
    return _spt.apply(this, arguments);
  };
}

if (typeof window.gameOver === 'function') {
  var _gov = window.gameOver;
  window.gameOver = function (win, cause) {
    // Settle XP before the delayed death/terminal animation.  The animation can be
    // interrupted by HANGER or RESUME, so waiting only for flow.js' delayed body
    // leaves the reward uncommitted when the player exits immediately.
    try {
      if (window.vehicleTechSettleMatch) window.vehicleTechSettleMatch(!!win, typeof kills === 'number' ? kills : 0);
      window._vehicleTechMatchEnded = true;
      window._vehicleTechMatchWin = !!win;
    } catch (eVehicleXpUi) {}
    // 结算动画/战报 DOM 即使降级，成就暂存也必须先完成一次性提交；flow.js 原函数内还有幂等兜底。
    try {
      if (window.Achievements && typeof window.Achievements.commitMatch === 'function') window.Achievements.commitMatch();
    } catch (eAchReport) {}
    if (RSP.phase === 'endblink' || RSP.phase === 'endpending' || RSP.phase === 'endform' || RSP.phase === 'endleave') return;   // 防重入:原 gameOver 延迟 880ms 执行,battleCheck 在窗口内会二次触发(此前表现为弹窗后眼皮回放一次)
    ensureEndUI();
    var go = function () {
      RSP.phase = 'endpending';
      _gov(win, cause);
      fillEndReport(win);
      if (endModal) {
        endModal.classList.remove('win-contracting');
        endModal.classList.remove('win-expanding');
        void endModal.offsetWidth;
        endModal.classList.add('win-expanding');
        if (typeof sfxUiDi === 'function') sfxUiDi(2); else if (typeof sfxTacticalBeep === 'function') sfxTacticalBeep(2);
      }
      RSP.phase = 'endform';
    };
    if (RSP.phase === 'black') { go(); return; }
    if (RSP.phase === 'dying') {
      setTimeout(go, Math.max(0, (RSP.blackAt || 0) - Date.now()) + 200);
      return;
    }
    ensureDeathDom();
    RSP.phase = 'endblink';
    deathOv.classList.add('on');
    deathBlk.style.opacity = '0';
    if (deathBlur) deathBlur.style.opacity = '.5';
    deathVg.style.opacity = '.5';
    lidSet(0, 0);
    worldDuck(0.12, 0.55);
    setTimeout(function () { lidSet(1, 80); }, 30);
    setTimeout(function () { lidSet(0.16, 170); }, 140);
    setTimeout(function () { lidSet(1, 380, 'cubic-bezier(.45,0,.8,.35)'); }, 360);
    setTimeout(function () { deathBlk.style.opacity = '1'; }, 720);
    setTimeout(function () { RSP.phase = 'black'; go(); }, 880);
  };
}

document.addEventListener('click', function (e) {
  var b = btnOf(e.target);
  if (!b || b.disabled) return;
  if (el && el.continuebtn && (b === el.continuebtn || el.continuebtn.contains(b))) {
    e.stopImmediatePropagation();
    e.preventDefault();
    endContinue();
  } else if ((b && b.id === 'airsupportbtn') || (el && el.airSupportBtn && (b === el.airSupportBtn || el.airSupportBtn.contains(b)))) {
    e.stopImmediatePropagation();
    e.preventDefault();
    endAirSupport();
  }
}, true);

/* ---------- ⑮ 玩家阵亡入口拦截 ---------- */
if (typeof window.playerDied === 'function') {
  var _pdo = window.playerDied;
  window.playerDied = function (cause) {
    startDeathAnim(cause);
    _pdo(cause);
  };
}

function bindResetAllDataUI() {
  var openBtn = document.getElementById('reset-all-btn');
  var dialog = document.getElementById('reset-all-confirm');
  var yes = document.getElementById('reset-all-yes');
  var no = document.getElementById('reset-all-no');
  if (!openBtn || !dialog || !yes || !no) return;
  function closeDialog() {
    dialog.classList.add('hidden');
    dialog.setAttribute('aria-hidden', 'true');
  }
  openBtn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dialog.classList.remove('hidden');
    dialog.setAttribute('aria-hidden', 'false');
  });
  no.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    closeDialog();
  });
  yes.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (window.localStorage) window.localStorage.clear();
    } catch (err) {}
    // Reload so every in-memory archive, upgrade cache, and preference is reset
    // together with the localStorage data.
    try {
      if (window.location && typeof window.location.reload === 'function') window.location.reload();
    } catch (errReload) {}
  });
  dialog.addEventListener('click', function (e) {
    if (e.target === dialog) closeDialog();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !dialog.classList.contains('hidden')) closeDialog();
  });
}
bindResetAllDataUI();
mmSync(curView || 'mainmenu');
function mmTick() {
  var c = document.getElementById('mm-clock');
  if (!c) return;
  var d = new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  c.textContent = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
mmTick();
setInterval(mmTick, 1000);

/* ==================== Tactical garage and armor/module inspection ==================== */
var Hangar3D = (function () {
  var canvas, renderer, scene, camera;
  var envGroup, curTankObj = null;
  var curTeam = 'red', curKind = '99';

  // The garage uses one fixed tactical presentation.

  // 检视模式 (Module X-Ray 模块透视视角)
  var inspectMode = false;
  var modShells = [];

  var running = false;
  var animId = null;

  // 相机轨道控制参数
  var yaw = 0.65, pitch = 0.28, dist = 11.5;
  var targetCenter = new THREE.Vector3(0, 1.05, 0);
  var isDragging = false, dragMoved = false;
  var downX = 0, downY = 0, lastMouseX = 0, lastMouseY = 0;
  var autoRotate = true;
  var lastUserInteractTime = 0;

  // 装甲与模块高亮与射线拾取
  var hlMesh = null, hlSrc = null;
  var hoistTrolleyGroup = null;
  var hoistX = 1.2, hoistXTo = 1.2, hoistLastT = 0;   // 陆地 1.2 / 直升机 4.8, render 里滑动
  var _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
  var _normMat = new THREE.Matrix3();

  // 场景光源与聚光灯组 (亮度统一降低 15%)
  var lightsGroup = null, dirLight = null;

  // 内部模块与装甲数据字典
  var PV_FACE_NAMES = {
    front: 'FRONTAL ARMOR', rear: 'REAR ARMOR', side_l: 'LEFT ARMOR', side_r: 'RIGHT ARMOR',
    side: 'SIDE ARMOR', top: 'ROOF ARMOR', bottom: 'BELLY ARMOR', roof: 'ROOF ARMOR', belly: 'BELLY ARMOR',
    mantle: 'MANTLET', mantlet: 'MANTLET', turret_side: 'TURRET SIDE',
    turret_rear: 'TURRET REAR', turret_roof: 'TURRET ROOF', dome: 'CAST DOME',
    hullshell: 'UPPER GLACIS', m1hull: 'HULL COMPOSITE', m1turret: 'TURRET WEDGE',
    t99hull: 'HULL COMPOSITE', t99turret: 'TURRET ERA', ring: 'TURRET RING',
    trackL: 'R TRACK / DRIVE', trackR: 'L TRACK / DRIVE',
    rotor: 'MAIN ROTOR', tailRotor: 'TAIL ROTOR', gun: 'GUN / FCS'
  };

  // 全载具统一高科技战术全息内构色板 (Unified Holographic X-Ray Palette)
  var PV_MOD_COLORS = {
    engine: 0xf59e0b, // 动力系统 / 涡轴发动机 / 柴油机: 琥珀金 (Cyber Amber)
    fuel:   0xef4444, // 主副燃油箱 / 自封油箱: 炽红 (Fuel Crimson)
    ammo:   0xd946ef, // 弹药架 / 备弹舱 / 航炮供弹: 战术品红 (HE Magenta)
    trans:  0x06b6d4, // 传动系统 / 旋翼减速器: 电光青 (Electric Cyan)
    crew:   0x10b981, // 乘员室 / 座舱火控: 翡翠绿 (Tactical Green)
    gun:    0x94a3b8, // 武器火控 / 主炮身管: 钛白银 (Titanium Silver)
    trackL: 0x84cc16, // 行动机构(-X 侧=物理右侧,盒名沿用): 战术青绿 (Tactical Lime)
    trackR: 0x84cc16, // 行动机构(+X 侧=物理左侧,盒名沿用): 战术青绿
    turret: 0x3b82f6  // 炮塔回转机构: 钴蓝 (Cobalt Blue)
  };

  var PV_INTERNAL = ['engine', 'fuel', 'ammo', 'trans', 'crew'];

  function pvFaceOf(ln, force) {
    if (force && PV_FACE_NAMES[force]) return PV_FACE_NAMES[force];
    var ax = Math.abs(ln.x), ay = Math.abs(ln.y), az = Math.abs(ln.z);
    if (ay >= ax && ay >= az) return ln.y > 0 ? 'ROOF ARMOR' : 'BELLY ARMOR';
    if (az >= ax) return ln.z > 0 ? 'FRONTAL ARMOR' : 'REAR ARMOR';
    return (ln.x > 0 ? 'RIGHT ARMOR' : 'LEFT ARMOR');
  }

  // 载具全套规格与情报字典
  var VEH_DATA = {
    red: {
      tank: {
        name: 'RED-MBT-1', sub: 'RED-MEDIUM TANK',
        fire: '100mm rifled gun', fireSub: 'PEN 220mm - MV 1480m/s',
        armor: 'RHA steel', armorSub: 'Glacis 100mm / Turret 200mm',
        speed: '50 km/h', speedSub: '520HP diesel',
        hp: '1800 HP', hpSub: 'Readiness 100%'
      },
      '99': {
        name: 'RED-MBT-2', sub: 'RED-HEAVY MBT',
        fire: '125mm smoothbore gun', fireSub: 'PEN 680mm - Autoloader',
        armor: 'Heavy composite + ERA', armorSub: 'Frontal >1000mm',
        speed: '70 km/h', speedSub: '1500HP turbo diesel',
        hp: '3200 HP', hpSub: 'Readiness 100%'
      },
      td: {
        name: 'RED-TD', sub: 'RED-TANK DESTROYER',
        fire: '120mm smoothbore gun', fireSub: 'PEN 832mm - MV 1700m/s - Semi-auto loader',
        armor: 'High-hardness RHA', armorSub: 'Hull 50mm / Turret 80mm',
        speed: '55 km/h', speedSub: '520HP supercharged diesel',
        hp: '1600 HP', hpSub: 'Readiness 100%'
      },
      wz10: {
        name: 'RED-HELI', sub: 'RED-ATTACK HELI',
        fire: '70mm rockets + Missiles', fireSub: '70mm guided rockets / Air-to-air missiles',
        armor: 'Armored plate + self-seal tank', armorSub: 'Cockpit vs 12.7mm AP',
        speed: '280 km/h', speedSub: 'Twin turboshaft',
        hp: '1500 HP', hpSub: 'Readiness 100%'
      },
      arty: {
        name: 'RED-MLRS', sub: 'RED-ROCKET ARTILLERY',
        fire: '40x 122mm rocket salvo', fireSub: '122mm multiple rocket launcher',
        armor: 'Light frag cab', armorSub: 'High-mobility chassis',
        speed: '80 km/h', speedSub: 'Turbo diesel off-road chassis',
        hp: '1300 HP', hpSub: 'Readiness 100%'
      },
      aa: {
        name: 'RED-AA', sub: 'RED-AIR DEFENSE',
        fire: '4x SAM missiles + Twin 25mm autocannon', fireSub: 'Surface-to-air missiles / 25mm twin cannon',
        armor: 'Light welded hull', armorSub: 'Air search radar',
        speed: '53 km/h', speedSub: 'Tracked ADA escort chassis',
        hp: '1300 HP', hpSub: 'Readiness 100%'
      }
    },
    blue: {
      tank: {
        name: 'BLUE-MBT-1', sub: 'BLUE-MEDIUM TANK',
        fire: '105mm rifled gun', fireSub: 'PEN 260mm - APFSDS',
        armor: 'Cast RHA', armorSub: 'Glacis 109mm / Turret 254mm',
        speed: '48 km/h', speedSub: '750HP diesel',
        hp: '2000 HP', hpSub: 'Readiness 100%'
      },
      td: {
        name: 'BLUE-MBT-2', sub: 'BLUE-HEAVY MBT',
        fire: '120mm smoothbore gun', fireSub: 'PEN 600mm - APFSDS',
        armor: 'Composite armor', armorSub: 'Frontal >850mm',
        speed: '67 km/h', speedSub: 'Gas turbine engine',
        hp: '3000 HP', hpSub: 'Readiness 100%'
      },
      ah64: {
        name: 'BLUE-HELI', sub: 'BLUE-ATTACK HELI',
        fire: '70mm rockets + Missiles', fireSub: '70mm unguided rockets / Air-to-air missiles',
        armor: 'Armored cockpit', armorSub: 'Vs 23mm direct fire',
        speed: '290 km/h', speedSub: 'Twin turboshaft',
        hp: '1650 HP', hpSub: 'Readiness 100%'
      },
      arty: {
        name: 'BLUE-MLRS', sub: 'BLUE-ROCKET ARTILLERY',
        fire: '6x 227mm rocket salvo', fireSub: '227mm multiple rocket launcher',
        armor: 'Armored cab', armorSub: '6x6 tactical chassis',
        speed: '85 km/h', speedSub: '330HP turbo diesel',
        hp: '1300 HP', hpSub: 'Readiness 100%'
      },
      aa: {
        name: 'BLUE-AA', sub: 'BLUE-AIR DEFENSE',
        fire: '8x SAM missiles', fireSub: 'Surface-to-air missiles - Fire-and-forget',
        armor: 'Light armored 4x4', armorSub: '4x4 tactical chassis',
        speed: '89 km/h', speedSub: 'V8 diesel',
        hp: '1300 HP', hpSub: 'Readiness 100%'
      }
    }
  };

  // 共享材质池
  var lineMatDark, lineMatGold, lineMatSubtle, lineMatRed, lineMatCyan;
  var meshMatFloor, meshMatTurntable, meshMatWall, meshMatDoor, meshMatSteel, meshMatCrane;
  var meshMatHoist, meshMatCrate1, meshMatCrate2, meshMatCrateBand, meshMatDrumGreen;
  var meshMatDrumRed, meshMatDrumRing, meshMatLampStand, meshMatLampHead, meshMatLampLens;
  var meshMatHazardYellow, meshMatHazardBlack, meshMatBackdrop, meshMatTank;
  var meshMatOrange, meshMatWhite, meshMatScreen, meshMatBrass, meshMatCabinetBlue, meshMatGlass;

  function initMaterials() {
    var cDark = 0x141610;
    var cGold = 0xd9a72e;
    var cSubtle = 0x3d4638;
    var cRed = 0xb0442f;
    var cCyan = 0x228866;

    lineMatDark = new THREE.LineBasicMaterial({ color: cDark, linewidth: 1.5, fog: true });
    lineMatGold = new THREE.LineBasicMaterial({ color: cGold, linewidth: 1.5, fog: true });
    lineMatSubtle = new THREE.LineBasicMaterial({ color: cSubtle, linewidth: 1.0, fog: true });
    lineMatRed = new THREE.LineBasicMaterial({ color: cRed, linewidth: 1.5, fog: true });
    lineMatCyan = new THREE.LineBasicMaterial({ color: cCyan, linewidth: 1.5, fog: true });

      meshMatFloor = new THREE.MeshLambertMaterial({ color: 0x384036, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatTurntable = new THREE.MeshLambertMaterial({ color: 0x272e24, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatWall = new THREE.MeshLambertMaterial({ color: 0x2e362c, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatDoor = new THREE.MeshLambertMaterial({ color: 0x344032, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatSteel = new THREE.MeshLambertMaterial({ color: 0x22281e, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatCrane = new THREE.MeshLambertMaterial({ color: 0xd9a72e, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatHoist = new THREE.MeshLambertMaterial({ color: 0x1b1f18, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatCrate1 = new THREE.MeshLambertMaterial({ color: 0x47563d, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatCrate2 = new THREE.MeshLambertMaterial({ color: 0x695b3e, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatCrateBand = new THREE.MeshLambertMaterial({ color: 0x1c2118, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatDrumGreen = new THREE.MeshLambertMaterial({ color: 0x364630, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatDrumRed = new THREE.MeshLambertMaterial({ color: 0xb0442f, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatDrumRing = new THREE.MeshLambertMaterial({ color: 0x1a1e16, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true, side: THREE.DoubleSide });
      meshMatLampStand = new THREE.MeshLambertMaterial({ color: 0xd9a72e, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatLampHead = new THREE.MeshLambertMaterial({ color: 0x20261c, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatLampLens = new THREE.MeshLambertMaterial({ color: 0xffea88, emissive: 0xffcb44, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, fog: true });
      meshMatHazardYellow = new THREE.MeshLambertMaterial({ color: 0xd9a72e, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, fog: true, side: THREE.DoubleSide });
      meshMatHazardBlack = new THREE.MeshLambertMaterial({ color: 0x141610, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, fog: true });
      meshMatOrange = new THREE.MeshLambertMaterial({ color: 0xe06028, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, fog: true });
      meshMatWhite = new THREE.MeshLambertMaterial({ color: 0xeeeeee, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, fog: true });
      meshMatScreen = new THREE.MeshLambertMaterial({ color: 0x33eebb, emissive: 0x118866, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, fog: true });
      meshMatBrass = new THREE.MeshLambertMaterial({ color: 0xc49b38, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatCabinetBlue = new THREE.MeshLambertMaterial({ color: 0x284252, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatGlass = new THREE.MeshLambertMaterial({ color: 0x3b6278, transparent: true, opacity: 0.65, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, fog: true });
      meshMatBackdrop = new THREE.MeshLambertMaterial({ color: 0x232920, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, fog: true });
      meshMatTank = null;
  }

  function addSolidMesh(geo, meshMat, lineMat, angle) {
    var g = new THREE.Group();
    if (meshMat) {
      var m = new THREE.Mesh(geo, meshMat);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    if (lineMat) {
      var edges = new THREE.EdgesGeometry(geo, angle || 24);
      var lines = new THREE.LineSegments(edges, lineMat);
      g.add(lines);
    }
    return g;
  }

  function buildHangarInteriorLineArt(g) {
    var pts = [];

    // 1. 机库大跨度双坡屋面空间管桁架系统 (5 组主承重桁架排架)
    for (var rz of [-9.5, -3.5, 2.5, 8.5, 14.5]) {
      pts.push(
        new THREE.Vector3(-11.5, 6.8, rz), new THREE.Vector3(0, 8.6, rz),
        new THREE.Vector3(0, 8.6, rz), new THREE.Vector3(11.5, 6.8, rz),
        new THREE.Vector3(-11.5, 6.8, rz), new THREE.Vector3(11.5, 6.8, rz)
      );
      for (var rx of [-9.5, -7.5, -5.5, -3.5, -1.5, 1.5, 3.5, 5.5, 7.5, 9.5]) {
        var ry = 6.8 + (1.0 - Math.abs(rx) / 11.5) * 1.8;
        pts.push(
          new THREE.Vector3(rx, 6.8, rz), new THREE.Vector3(rx, ry, rz),
          new THREE.Vector3(rx, 6.8, rz), new THREE.Vector3(rx + (rx > 0 ? -2.0 : 2.0), ry, rz)
        );
      }
    }

    // 纵向擦条线 (贯通机库纵轴全长)
    for (var lrx of [-11.5, -8.5, -5.5, -2.5, 0, 2.5, 5.5, 8.5, 11.5]) {
      var lry = 6.8 + (1.0 - Math.abs(lrx) / 11.5) * 1.8;
      pts.push(new THREE.Vector3(lrx, lry, -9.5), new THREE.Vector3(lrx, lry, 15.2));
    }

    // 屋面开间水平交叉抗风支撑 (X-Bracing)
    for (var b = 0; b < 4; b++) {
      var z1 = [-9.5, -3.5, 2.5, 8.5][b], z2 = [-3.5, 2.5, 8.5, 14.5][b];
      pts.push(
        new THREE.Vector3(-11.5, 6.8, z1), new THREE.Vector3(0, 8.6, z2),
        new THREE.Vector3(0, 8.6, z1), new THREE.Vector3(-11.5, 6.8, z2),
        new THREE.Vector3(0, 8.6, z1), new THREE.Vector3(11.5, 6.8, z2),
        new THREE.Vector3(11.5, 6.8, z1), new THREE.Vector3(0, 8.6, z2)
      );
    }

    // 2. 侧墙纵向抗风墙梁与立柱交叉拉条
    for (var side of [-11.5, 11.5]) {
      for (var gy of [2.0, 4.0, 5.6]) {
        pts.push(new THREE.Vector3(side, gy, -9.5), new THREE.Vector3(side, gy, 15.2));
      }
      for (var b = 0; b < 4; b++) {
        var z1 = [-9.5, -3.5, 2.5, 8.5][b], z2 = [-3.5, 2.5, 8.5, 14.5][b];
        pts.push(
          new THREE.Vector3(side, 0.6, z1), new THREE.Vector3(side, 6.2, z2),
          new THREE.Vector3(side, 6.2, z1), new THREE.Vector3(side, 0.6, z2)
        );
      }
    }

    // 3. 行车轨道三相滑触线管路 (3-Phase Electrification Busbars)
    for (var ph = 0; ph < 3; ph++) {
      var py = 6.95 + ph * 0.08;
      pts.push(
        new THREE.Vector3(-11.22, py, -9.5), new THREE.Vector3(-11.22, py, 14.8),
        new THREE.Vector3(11.22, py, -9.5), new THREE.Vector3(11.22, py, 14.8)
      );
    }

    // 4. 地面维修工位安全通道斑马线与军械隔离区标线艺术
    for (var hxi = -17.5; hxi <= -13.5; hxi += 0.8) {
      pts.push(new THREE.Vector3(hxi, 0.02, -2.0), new THREE.Vector3(hxi + 0.8, 0.02, 4.0));
    }
    pts.push(
      new THREE.Vector3(13.2, 0.02, -5.5), new THREE.Vector3(17.8, 0.02, -5.5),
      new THREE.Vector3(17.8, 0.02, -5.5), new THREE.Vector3(17.8, 0.02, 3.5),
      new THREE.Vector3(17.8, 0.02, 3.5), new THREE.Vector3(13.2, 0.02, 3.5),
      new THREE.Vector3(13.2, 0.02, 3.5), new THREE.Vector3(13.2, 0.02, -5.5)
    );
    for (var oxi = 13.6; oxi <= 17.4; oxi += 1.0) {
      pts.push(new THREE.Vector3(oxi, 0.02, -5.5), new THREE.Vector3(oxi + 0.6, 0.02, -4.5));
    }

    var interiorGeo = new THREE.BufferGeometry().setFromPoints(pts);
    var interiorLines = new THREE.LineSegments(interiorGeo, lineMatSubtle);
    g.add(interiorLines);
  }

  // 重点重构: 机库后部 (Rear Hangar Architecture & Spares Workshop) 实体建模与细节填充
  function buildHangarRearArchitecture(g) {
    var rg = new THREE.Group();

    // 1. 后方主承重山墙与工业波形板护墙立面 (严格无缝纵向分层堆叠，彻底杜绝共面闪烁 Z-Fighting)
    // 底部基座墙: y ∈ [0.0, 1.4m] (高 1.4m, 中心 y = 0.7m, z = 15.2m, 厚 0.45m)
    var rearBaseWall = addSolidMesh(new THREE.BoxGeometry(23.6, 1.4, 0.45), meshMatWall, lineMatDark);
    rearBaseWall.position.set(0, 0.7, 15.2);
    rg.add(rearBaseWall);

    // 中部护墙板: y ∈ [1.4, 6.8m] (高 5.4m, 中心 y = 4.1m, z = 15.2m, 厚 0.35m)
    var rearUpperWall = addSolidMesh(new THREE.BoxGeometry(23.6, 5.4, 0.35), meshMatWall, lineMatDark);
    rearUpperWall.position.set(0, 4.1, 15.2);
    rg.add(rearUpperWall);

    // 顶部山墙过梁/屋檐挑口: y ∈ [6.8, 8.6m] (高 1.8m, 中心 y = 7.7m, z = 15.2m, 厚 0.38m)
    var rearGableRoof = addSolidMesh(new THREE.BoxGeometry(23.6, 1.8, 0.38), meshMatSteel, lineMatDark);
    rearGableRoof.position.set(0, 7.7, 15.2);
    rg.add(rearGableRoof);

    // 后墙 7 根垂直重型 H 型钢抗风承重主立柱
    for (var rx of [-10.5, -7.0, -3.5, 0.0, 3.5, 7.0, 10.5]) {
      var rCol = addSolidMesh(new THREE.BoxGeometry(0.44, 8.2, 0.44), meshMatSteel, lineMatDark);
      rCol.position.set(rx, 4.1, 15.0);
      rg.add(rCol);
    }

    // 后墙横向水平加强腰梁 (Girts)
    for (var rwy of [2.2, 4.6, 6.6]) {
      var rBeam = addSolidMesh(new THREE.BoxGeometry(23.4, 0.22, 0.22), meshMatSteel, lineMatDark);
      rBeam.position.set(0, rwy, 14.88);
      rg.add(rBeam);
    }

    // 2. 二层挑空战术指挥与维修质检控制中心 (2nd-Floor Elevated Mezzanine Catwalk & Command Observation Booth at z = 14.1m)
    var mezFloor = addSolidMesh(new THREE.BoxGeometry(22.8, 0.20, 1.8), meshMatSteel, lineMatGold);
    mezFloor.position.set(0, 3.6, 14.1);
    rg.add(mezFloor);

    // 挑空牛腿承重斜撑托架
    for (var kx of [-10.5, -7.0, -3.5, 3.5, 7.0, 10.5]) {
      var kBracket = addSolidMesh(new THREE.BoxGeometry(0.18, 0.7, 1.4), meshMatSteel, lineMatDark);
      kBracket.position.set(kx, 3.15, 14.3);
      rg.add(kBracket);
    }

    // 挑空连廊安全护栏与踢脚警示板 (开出左侧楼梯出口 x ∈ [-11.0, -9.6])
    var railTL = addSolidMesh(new THREE.BoxGeometry(5.8, 0.06, 0.06), meshMatHazardYellow, lineMatDark);
    railTL.position.set(-6.6, 4.65, 13.25);
    rg.add(railTL);

    var railTR = addSolidMesh(new THREE.BoxGeometry(13.0, 0.06, 0.06), meshMatHazardYellow, lineMatDark);
    railTR.position.set(4.5, 4.65, 13.25);
    rg.add(railTR);

    var railML = addSolidMesh(new THREE.BoxGeometry(5.8, 0.04, 0.04), meshMatSteel, lineMatDark);
    railML.position.set(-6.6, 4.15, 13.25);
    rg.add(railML);

    var railMR = addSolidMesh(new THREE.BoxGeometry(13.0, 0.04, 0.04), meshMatSteel, lineMatDark);
    railMR.position.set(4.5, 4.15, 13.25);
    rg.add(railMR);

    var toeBoardL = addSolidMesh(new THREE.BoxGeometry(5.8, 0.16, 0.04), meshMatHazardYellow, lineMatDark);
    toeBoardL.position.set(-6.6, 3.75, 13.25);
    rg.add(toeBoardL);

    var toeBoardR = addSolidMesh(new THREE.BoxGeometry(13.0, 0.16, 0.04), meshMatHazardYellow, lineMatDark);
    toeBoardR.position.set(4.5, 3.75, 13.25);
    rg.add(toeBoardR);

    for (var rpx = -9.4; rpx <= 11.0; rpx += 1.2) {
      var rPost = addSolidMesh(new THREE.BoxGeometry(0.06, 1.05, 0.06), meshMatSteel, lineMatDark);
      rPost.position.set(rpx, 4.15, 13.25);
      rg.add(rPost);
    }

    // 中央悬挑战术质检与调度指挥舱 (Observation & Telemetry Control Booth, x ∈ [-3.6, +3.6], y ∈ [3.6, 6.2], z = 13.6m)
    var boothBody = addSolidMesh(new THREE.BoxGeometry(7.2, 2.4, 1.6), meshMatCabinetBlue, lineMatGold);
    boothBody.position.set(0, 4.9, 14.2);
    rg.add(boothBody);

    var boothRoof = addSolidMesh(new THREE.BoxGeometry(7.6, 0.22, 1.9), meshMatSteel, lineMatDark);
    boothRoof.position.set(0, 6.15, 14.1);
    rg.add(boothRoof);

    var winFrame = addSolidMesh(new THREE.BoxGeometry(6.6, 1.3, 0.12), meshMatSteel, lineMatGold);
    winFrame.position.set(0, 5.0, 13.35);
    rg.add(winFrame);

    var winGlass = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.15), meshMatGlass);
    winGlass.position.set(0, 5.0, 13.28);
    rg.add(winGlass);

    for (var scx of [-2.2, -0.7, 0.7, 2.2]) {
      var scr = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), meshMatScreen);
      scr.position.set(scx, 5.15, 13.45);
      rg.add(scr);
    }

    for (var bbx of [-3.4, 3.4]) {
      var bBase = addSolidMesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 10), meshMatSteel, lineMatDark);
      bBase.position.set(bbx, 6.25, 13.4);
      rg.add(bBase);
      var bLight = addSolidMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 10), meshMatOrange, lineMatGold);
      bLight.position.set(bbx, 6.4, 13.4);
      rg.add(bLight);
    }

    var bannerPlate = addSolidMesh(new THREE.BoxGeometry(5.4, 0.55, 0.06), meshMatHazardBlack, lineMatGold);
    bannerPlate.position.set(0, 3.6, 13.2);
    rg.add(bannerPlate);
    var bannerIn = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.42, 0.03), meshMatHazardYellow);
    bannerIn.position.set(0, 3.6, 13.16);
    rg.add(bannerIn);

    // 3. 重点修复: 左侧全尺寸工业重型钢梯与平行同步扶手系统 (Staircase from ground y=0, z=9.8m to Mezzanine y=3.6m, z=13.6m at x = -10.3m)
    var stY0 = 0.0, stZ0 = 9.8;
    var stY1 = 3.6, stZ1 = 13.6;
    var stDY = stY1 - stY0; // 3.6m
    var stDZ = stZ1 - stZ0; // 3.8m
    var stAng = Math.atan2(stDY, stDZ); // 43.45° (倾斜角)
    var stLen = Math.sqrt(stDY * stDY + stDZ * stDZ); // 5.235m
    var stMidY = (stY0 + stY1) / 2; // 1.8m
    var stMidZ = (stZ0 + stZ1) / 2; // 11.7m

    // 左右两侧重型斜梁 (Stringers): rx 必须为 -stAng 才能使斜梁自前下向后上倾斜延伸
    for (var stx of [-10.8, -9.8]) {
      var stringer = addSolidMesh(new THREE.BoxGeometry(0.08, 0.22, stLen), meshMatSteel, lineMatDark);
      stringer.position.set(stx, stMidY, stMidZ);
      stringer.rotation.x = -stAng;
      rg.add(stringer);

      // 上部黄色主扶手管 (Top Handrail, 高出斜梁 0.95m，与斜梁完全平行)
      var sHandrailTop = addSolidMesh(new THREE.BoxGeometry(0.05, 0.05, stLen), meshMatHazardYellow, lineMatDark);
      sHandrailTop.position.set(stx, stMidY + 0.95, stMidZ);
      sHandrailTop.rotation.x = -stAng;
      rg.add(sHandrailTop);

      // 中部安全护栏管 (Mid Rail, 高出斜梁 0.48m，与斜梁完全平行)
      var sHandrailMid = addSolidMesh(new THREE.BoxGeometry(0.04, 0.04, stLen), meshMatSteel, lineMatDark);
      sHandrailMid.position.set(stx, stMidY + 0.48, stMidZ);
      sHandrailMid.rotation.x = -stAng;
      rg.add(sHandrailMid);

      // 沿楼梯均匀分布的 5 根立柱 (Stanchion Posts): 自斜梁垂直向上承托扶手
      for (var pi = 0; pi <= 4; pi++) {
        var pt = pi / 4;
        var postY = stY0 + pt * stDY + 0.475;
        var postZ = stZ0 + pt * stDZ;
        var stPost = addSolidMesh(new THREE.BoxGeometry(0.05, 0.95, 0.05), meshMatSteel, lineMatDark);
        stPost.position.set(stx, postY, postZ);
        rg.add(stPost);
      }
    }

    // 14 级水平踏步板 (Treads): 水平布置于两根斜梁之间，间距均匀，完全贴合
    var numSteps = 14;
    for (var stp = 0; stp < numSteps; stp++) {
      var stepT = (stp + 0.5) / numSteps;
      var sy = stY0 + stepT * stDY;
      var sz = stZ0 + stepT * stDZ;
      var tread = addSolidMesh(new THREE.BoxGeometry(0.92, 0.05, 0.28), meshMatSteel, lineMatGold);
      tread.position.set(-10.3, sy, sz);
      rg.add(tread);
    }

    // 4. 右侧通顶行车检修安全爬梯带防护笼 (Safety Cage Ladder at x = 10.8m, z = 14.8m)
    for (var lx of [10.6, 11.0]) {
      var lRail = addSolidMesh(new THREE.CylinderGeometry(0.025, 0.025, 7.2, 8), meshMatSteel, lineMatDark);
      lRail.position.set(lx, 3.6, 14.7);
      rg.add(lRail);
    }
    for (var ly = 0.4; ly <= 7.0; ly += 0.35) {
      var lRung = addSolidMesh(new THREE.CylinderGeometry(0.018, 0.018, 0.40, 8), meshMatSteel, lineMatGold);
      lRung.rotation.z = Math.PI / 2;
      lRung.position.set(10.8, ly, 14.7);
      rg.add(lRung);
    }
    for (var cgy = 2.4; cgy <= 6.8; cgy += 0.8) {
      var cageHoop = addSolidMesh(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 12, 1, true), meshMatHazardYellow, lineMatDark);
      cageHoop.position.set(10.8, cgy, 14.45);
      rg.add(cageHoop);
    }

    // 5. 后部地面备用动力总成与重型检修工作台 (x = -5.8m, z = 11.5m)
    var engGroup = new THREE.Group();
    engGroup.position.set(-5.8, 0, 11.5);
    engGroup.rotation.y = 0.25;

    var engCradle = addSolidMesh(new THREE.BoxGeometry(2.4, 0.35, 3.4), meshMatHazardYellow, lineMatDark);
    engCradle.position.set(0, 0.40, 0);
    engGroup.add(engCradle);

    for (var ecx of [-1.05, 1.05]) {
      for (var ecz of [-1.4, 1.4]) {
        var eWheel = addSolidMesh(new THREE.CylinderGeometry(0.16, 0.16, 0.10, 12), meshMatSteel, lineMatDark);
        eWheel.rotation.z = Math.PI / 2;
        eWheel.position.set(ecx, 0.16, ecz);
        engGroup.add(eWheel);
      }
    }

    var vBlock = addSolidMesh(new THREE.BoxGeometry(1.4, 0.9, 2.5), meshMatSteel, lineMatDark);
    vBlock.position.set(0, 1.0, 0);
    engGroup.add(vBlock);

    for (var side = -1; side <= 1; side += 2) {
      var cylBank = addSolidMesh(new THREE.BoxGeometry(0.55, 0.45, 2.4), meshMatSteel, lineMatGold);
      cylBank.position.set(side * 0.45, 1.45, 0);
      cylBank.rotation.z = side * 0.45;
      engGroup.add(cylBank);

      var turboScroll = addSolidMesh(new THREE.CylinderGeometry(0.26, 0.26, 0.22, 14), meshMatCrane, lineMatDark);
      turboScroll.rotation.x = Math.PI / 2;
      turboScroll.position.set(side * 0.75, 1.35, -1.2);
      engGroup.add(turboScroll);

      var exhPipe = addSolidMesh(new THREE.CylinderGeometry(0.10, 0.10, 0.8, 10), meshMatSteel, lineMatDark);
      exhPipe.rotation.x = 0.3;
      exhPipe.position.set(side * 0.75, 1.75, -1.35);
      engGroup.add(exhPipe);
    }

    var intercooler = addSolidMesh(new THREE.BoxGeometry(1.1, 0.24, 1.8), meshMatSteel, lineMatGold);
    intercooler.position.set(0, 1.78, 0.1);
    engGroup.add(intercooler);

    var flywheel = addSolidMesh(new THREE.CylinderGeometry(0.48, 0.48, 0.18, 16), meshMatSteel, lineMatGold);
    flywheel.rotation.x = Math.PI / 2;
    flywheel.position.set(0, 0.95, 1.32);
    engGroup.add(flywheel);

    rg.add(engGroup);

    // 6. 后部备用滑膛主炮身管储存 A 字型支架 (x = 5.8m, z = 11.8m)
    var gunRack = new THREE.Group();
    gunRack.position.set(5.8, 0, 11.8);

    for (var gx of [-1.8, 1.8]) {
      var aFramePts = [
        new THREE.Vector3(gx, 0, -0.6), new THREE.Vector3(gx, 1.6, 0),
        new THREE.Vector3(gx, 0, 0.6), new THREE.Vector3(gx, 1.6, 0),
        new THREE.Vector3(gx, 0, -0.6), new THREE.Vector3(gx, 0, 0.6)
      ];
      var aGeo = new THREE.BufferGeometry().setFromPoints(aFramePts);
      gunRack.add(new THREE.LineSegments(aGeo, lineMatGold));

      var aMesh = addSolidMesh(new THREE.BoxGeometry(0.12, 1.6, 0.12), meshMatHazardYellow, lineMatDark);
      aMesh.position.set(gx, 0.8, 0);
      gunRack.add(aMesh);
    }

    for (var gyLvl of [0.75, 1.45]) {
      var barrel = addSolidMesh(new THREE.CylinderGeometry(0.10, 0.13, 5.8, 14), meshMatSteel, lineMatDark);
      barrel.rotation.z = Math.PI / 2;
      barrel.position.set(0, gyLvl, 0);
      gunRack.add(barrel);

      var evacuator = addSolidMesh(new THREE.CylinderGeometry(0.16, 0.16, 0.75, 14), meshMatCrane, lineMatDark);
      evacuator.rotation.z = Math.PI / 2;
      evacuator.position.set(-0.8, gyLvl, 0);
      gunRack.add(evacuator);

      var muzzle = addSolidMesh(new THREE.CylinderGeometry(0.14, 0.14, 0.35, 14), meshMatSteel, lineMatGold);
      muzzle.rotation.z = Math.PI / 2;
      muzzle.position.set(-2.8, gyLvl, 0);
      gunRack.add(muzzle);
    }
    rg.add(gunRack);

    // 7. 后部多层重型装甲备件立体仓储货架 (x = 9.2m, z = 12.8m)
    var pRack = new THREE.Group();
    pRack.position.set(9.2, 0, 12.8);
    for (var px of [-1.4, 1.4]) {
      for (var pz of [-0.6, 0.6]) {
        var pCol = addSolidMesh(new THREE.BoxGeometry(0.14, 3.2, 0.14), meshMatOrange, lineMatDark);
        pCol.position.set(px, 1.6, pz);
        pRack.add(pCol);
      }
    }
    for (var ply of [0.45, 1.45, 2.45]) {
      var pBeam = addSolidMesh(new THREE.BoxGeometry(3.1, 0.14, 1.4), meshMatOrange, lineMatDark);
      pBeam.position.set(0, ply, 0);
      pRack.add(pBeam);

      if (ply === 0.45) {
        for (var ri = 0; ri < 3; ri++) {
          var wheelMesh = addSolidMesh(new THREE.CylinderGeometry(0.38, 0.38, 0.22, 16), meshMatSteel, lineMatDark);
          wheelMesh.rotation.x = Math.PI / 2;
          wheelMesh.position.set(-0.8 + ri * 0.75, ply + 0.42, 0);
          pRack.add(wheelMesh);
          var rim = addSolidMesh(new THREE.CylinderGeometry(0.40, 0.40, 0.08, 16), meshMatHazardBlack, lineMatGold);
          rim.rotation.x = Math.PI / 2;
          rim.position.set(-0.8 + ri * 0.75, ply + 0.42, 0);
          pRack.add(rim);
        }
      } else if (ply === 1.45) {
        var trackCrate1 = addSolidMesh(new THREE.BoxGeometry(1.2, 0.55, 0.8), meshMatCrate1, lineMatDark);
        trackCrate1.position.set(-0.65, ply + 0.35, 0);
        pRack.add(trackCrate1);
        var trackCrate2 = addSolidMesh(new THREE.BoxGeometry(1.0, 0.45, 0.75), meshMatCrate2, lineMatDark);
        trackCrate2.position.set(0.65, ply + 0.30, 0);
        pRack.add(trackCrate2);
      } else {
        var transBox = addSolidMesh(new THREE.BoxGeometry(1.8, 0.65, 0.9), meshMatCabinetBlue, lineMatGold);
        transBox.position.set(0, ply + 0.40, 0);
        pRack.add(transBox);
      }
    }
    rg.add(pRack);

    // 8. 顶部横贯全宽的大型镀锌通风旋风管网 (Overhead HVAC Spiral Ducting at y = 7.6m, z = 14.5m)
    var hvacMain = addSolidMesh(new THREE.CylinderGeometry(0.32, 0.32, 22.4, 16), meshMatSteel, lineMatGold);
    hvacMain.rotation.z = Math.PI / 2;
    hvacMain.position.set(0, 7.6, 14.5);
    rg.add(hvacMain);

    for (var fx of [-7.0, -2.5, 2.5, 7.0]) {
      var hvacFlange = addSolidMesh(new THREE.CylinderGeometry(0.36, 0.36, 0.08, 16), meshMatHazardYellow, lineMatDark);
      hvacFlange.rotation.z = Math.PI / 2;
      hvacFlange.position.set(fx, 7.6, 14.5);
      rg.add(hvacFlange);

      var dropDuct = addSolidMesh(new THREE.CylinderGeometry(0.14, 0.14, 1.4, 12), meshMatSteel, lineMatDark);
      dropDuct.position.set(fx, 6.9, 14.5);
      rg.add(dropDuct);

      var hood = addSolidMesh(new THREE.CylinderGeometry(0.14, 0.48, 0.40, 14), meshMatSteel, lineMatGold);
      hood.position.set(fx, 6.0, 14.5);
      rg.add(hood);
    }

    // 行车轨道后部机械阻尼防撞缓冲器 (Crane Runway End Bumpers at z = 14.5m)
    for (var crx of [-11.5, 11.5]) {
      var bStop = addSolidMesh(new THREE.BoxGeometry(0.35, 0.50, 0.60), meshMatHazardYellow, lineMatDark);
      bStop.position.set(crx, 7.0, 14.5);
      rg.add(bStop);
      var bSpring = addSolidMesh(new THREE.CylinderGeometry(0.12, 0.12, 0.35, 12), meshMatSteel, lineMatDark);
      bSpring.rotation.x = Math.PI / 2;
      bSpring.position.set(crx, 7.0, 14.1);
      rg.add(bSpring);
    }

    // 后部高亮工业照明顶灯
    for (var rlx of [-6.0, 0.0, 6.0]) {
      var rHighLight = new THREE.Mesh(new THREE.CircleGeometry(0.42, 14), meshMatLampLens);
      rHighLight.rotation.x = Math.PI / 2;
      rHighLight.position.set(rlx, 7.2, 12.0);
      rg.add(rHighLight);
    }

    // 绘制机库后部精细线条艺术与地坪标线
    buildHangarRearLineArt(rg);

    g.add(rg);
  }
function buildHangarRearLineArt(g) {
    var pts = [];

    // 1. 后墙波形压型板纵向排线艺术 (Wall Corrugation Line Art)
    for (var wx = -11.0; wx <= 11.0; wx += 0.5) {
      pts.push(new THREE.Vector3(wx, 1.4, 15.0), new THREE.Vector3(wx, 7.8, 15.0));
    }

    // 2. 后部地面维修工位警戒区黄色斜纹安全标线 (Maintenance Demarcation Boxes)
    // 左工位: 动力系统维修区 [ENGINE TEST BAY]
    pts.push(
      new THREE.Vector3(-8.5, 0.02, 9.5), new THREE.Vector3(-3.2, 0.02, 9.5),
      new THREE.Vector3(-3.2, 0.02, 9.5), new THREE.Vector3(-3.2, 0.02, 13.5),
      new THREE.Vector3(-3.2, 0.02, 13.5), new THREE.Vector3(-8.5, 0.02, 13.5),
      new THREE.Vector3(-8.5, 0.02, 13.5), new THREE.Vector3(-8.5, 0.02, 9.5)
    );
    for (var exi = -8.2; exi <= -3.5; exi += 0.8) {
      pts.push(new THREE.Vector3(exi, 0.02, 9.5), new THREE.Vector3(exi + 0.6, 0.02, 10.3));
      pts.push(new THREE.Vector3(exi, 0.02, 13.5), new THREE.Vector3(exi + 0.6, 0.02, 12.7));
    }

    // 右工位: 武器火控与身管整备区 [GUN SYSTEM STAGING]
    pts.push(
      new THREE.Vector3(3.2, 0.02, 9.5), new THREE.Vector3(8.5, 0.02, 9.5),
      new THREE.Vector3(8.5, 0.02, 9.5), new THREE.Vector3(8.5, 0.02, 13.5),
      new THREE.Vector3(8.5, 0.02, 13.5), new THREE.Vector3(3.2, 0.02, 13.5),
      new THREE.Vector3(3.2, 0.02, 13.5), new THREE.Vector3(3.2, 0.02, 9.5)
    );
    for (var gxi = 3.5; gxi <= 8.2; gxi += 0.8) {
      pts.push(new THREE.Vector3(gxi, 0.02, 9.5), new THREE.Vector3(gxi + 0.6, 0.02, 10.3));
      pts.push(new THREE.Vector3(gxi, 0.02, 13.5), new THREE.Vector3(gxi + 0.6, 0.02, 12.7));
    }

    // 3. 挑空连廊底部 Pratt 桁架斜撑受力线框
    for (var tx = -10.0; tx <= 10.0; tx += 2.0) {
      pts.push(
        new THREE.Vector3(tx, 3.5, 14.8), new THREE.Vector3(tx + 1.0, 1.4, 15.0),
        new THREE.Vector3(tx, 3.5, 14.8), new THREE.Vector3(tx - 1.0, 1.4, 15.0)
      );
    }

    var rLinesGeo = new THREE.BufferGeometry().setFromPoints(pts);
    var rLines = new THREE.LineSegments(rLinesGeo, lineMatSubtle);
    g.add(rLines);
  }

  function buildHangarArchitecture(g) {
    // 1. 后方主门洞立面与大跨度重型门架 (门洞净宽 10.8m，高 6.25m)
    var wallLeft = addSolidMesh(new THREE.BoxGeometry(5.2, 7.6, 0.42), meshMatWall, lineMatDark);
    wallLeft.position.set(-8.56, 3.8, -8.80);
    g.add(wallLeft);

    var wallRight = addSolidMesh(new THREE.BoxGeometry(5.2, 7.6, 0.42), meshMatWall, lineMatDark);
    wallRight.position.set(8.56, 3.8, -8.80);
    g.add(wallRight);

    var wallHeader = addSolidMesh(new THREE.BoxGeometry(11.8, 1.35, 0.42), meshMatWall, lineMatDark);
    wallHeader.position.set(0, 7.25, -8.80);
    g.add(wallHeader);

    var portalColL = addSolidMesh(new THREE.BoxGeometry(0.56, 6.8, 0.56), meshMatSteel, lineMatDark);
    portalColL.position.set(-5.68, 3.4, -8.80);
    g.add(portalColL);

    var portalColR = addSolidMesh(new THREE.BoxGeometry(0.56, 6.8, 0.56), meshMatSteel, lineMatDark);
    portalColR.position.set(5.68, 3.4, -8.80);
    g.add(portalColR);

    var portalLintel = addSolidMesh(new THREE.BoxGeometry(11.8, 0.55, 0.56), meshMatSteel, lineMatDark);
    portalLintel.position.set(0, 6.525, -8.80);
    g.add(portalLintel);

    // 贯穿全宽 23m 的顶部重型滑动导轨 (位于 y = 6.35m, z = -8.55m)
    var doorTrack = addSolidMesh(new THREE.BoxGeometry(23.0, 0.22, 0.28), meshMatSteel, lineMatDark);
    doorTrack.position.set(0, 6.35, -8.55);
    g.add(doorTrack);

    // 导轨墙体承重钢牛腿支架 (沿门梁每 3m 布置一组)
    for (var tbx of [-10.2, -7.2, -4.2, -1.5, 1.5, 4.2, 7.2, 10.2]) {
      var tBrk = addSolidMesh(new THREE.BoxGeometry(0.16, 0.32, 0.22), meshMatSteel, lineMatDark);
      tBrk.position.set(tbx, 6.45, -8.68);
      g.add(tBrk);
    }

    // 双端工业电动开门驱动减速电机箱
    for (var dmx of [-10.8, 10.8]) {
      var dMotor = addSolidMesh(new THREE.BoxGeometry(0.48, 0.42, 0.35), meshMatSteel, lineMatGold);
      dMotor.position.set(dmx, 6.45, -8.52);
      g.add(dMotor);
      var dPulley = addSolidMesh(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 12), meshMatCrane, lineMatDark);
      dPulley.rotation.z = Math.PI / 2;
      dPulley.position.set(dmx + (dmx > 0 ? -0.26 : 0.26), 6.45, -8.52);
      g.add(dPulley);
    }

    // 地面嵌入式重型滑道 (z = -8.55m, y = 0.02m)
    var floorTrack = addSolidMesh(new THREE.BoxGeometry(23.0, 0.04, 0.18), meshMatSteel, lineMatDark);
    floorTrack.position.set(0, 0.02, -8.55);
    g.add(floorTrack);

    // 门头净空限高警示牌 [CLEARANCE 6.2M]
    var clSign = addSolidMesh(new THREE.BoxGeometry(3.6, 0.45, 0.06), meshMatHazardBlack, lineMatGold);
    clSign.position.set(0, 6.95, -8.50);
    g.add(clSign);
    var clSignInner = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.35, 0.02), meshMatHazardYellow);
    clSignInner.position.set(0, 6.95, -8.465);
    g.add(clSignInner);

    // 重构重型双扇水平滑动装甲大门 (单扇宽 5.8m, 高 6.2m, 真实左右水平滑动对开，双滑车悬挂承重)
    function buildSlidingDoorLeaf(isLeft) {
      var dg = new THREE.Group();
      var w = 5.80, h = 6.20;

      var borderT = addSolidMesh(new THREE.BoxGeometry(w, 0.20, 0.24), meshMatSteel, lineMatDark);
      borderT.position.set(0, h - 0.10, 0);
      dg.add(borderT);

      var borderB = addSolidMesh(new THREE.BoxGeometry(w, 0.18, 0.24), meshMatSteel, lineMatDark);
      borderB.position.set(0, 0.09, 0);
      dg.add(borderB);

      var borderL = addSolidMesh(new THREE.BoxGeometry(0.22, h - 0.38, 0.24), meshMatSteel, lineMatDark);
      borderL.position.set(-w / 2 + 0.11, h / 2, 0);
      dg.add(borderL);

      var borderR = addSolidMesh(new THREE.BoxGeometry(0.22, h - 0.38, 0.24), meshMatSteel, lineMatDark);
      borderR.position.set(w / 2 - 0.11, h / 2, 0);
      dg.add(borderR);

      var panel = addSolidMesh(new THREE.BoxGeometry(w - 0.44, h - 0.38, 0.12), meshMatDoor, lineMatDark);
      panel.position.set(0, h / 2, 0);
      dg.add(panel);

      for (var ry of [1.4, 2.6, 3.8, 5.0]) {
        var ribF = addSolidMesh(new THREE.BoxGeometry(w - 0.46, 0.14, 0.05), meshMatSteel, lineMatDark);
        ribF.position.set(0, ry, 0.085);
        dg.add(ribF);
        var ribB = addSolidMesh(new THREE.BoxGeometry(w - 0.46, 0.14, 0.05), meshMatSteel, lineMatDark);
        ribB.position.set(0, ry, -0.085);
        dg.add(ribB);
      }

      for (var vx of [-1.2, 1.2]) {
        var vRibF = addSolidMesh(new THREE.BoxGeometry(0.12, h - 0.40, 0.045), meshMatSteel, lineMatDark);
        vRibF.position.set(vx, h / 2, 0.085);
        dg.add(vRibF);
        var vRibB = addSolidMesh(new THREE.BoxGeometry(0.12, h - 0.40, 0.045), meshMatSteel, lineMatDark);
        vRibB.position.set(vx, h / 2, -0.085);
        dg.add(vRibB);
      }

      for (var tx of [-1.8, 1.8]) {
        var hangerBracket = addSolidMesh(new THREE.BoxGeometry(0.22, 0.34, 0.26), meshMatSteel, lineMatDark);
        hangerBracket.position.set(tx, h + 0.08, 0);
        dg.add(hangerBracket);

        var carriageBox = addSolidMesh(new THREE.BoxGeometry(0.46, 0.14, 0.32), meshMatSteel, lineMatDark);
        carriageBox.position.set(tx, h + 0.26, 0);
        dg.add(carriageBox);

        for (var wx of [-0.14, 0.14]) {
          var wheel = addSolidMesh(new THREE.CylinderGeometry(0.10, 0.10, 0.08, 14), meshMatCrane, lineMatDark);
          wheel.rotation.x = Math.PI / 2;
          wheel.position.set(tx + wx, h + 0.26, 0);
          dg.add(wheel);
        }
      }

      for (var bx of [-1.8, 1.8]) {
        var guideShoe = addSolidMesh(new THREE.BoxGeometry(0.18, 0.12, 0.12), meshMatSteel, lineMatDark);
        guideShoe.position.set(bx, 0.02, 0);
        dg.add(guideShoe);
      }

      var meetX = isLeft ? w / 2 - 0.05 : -w / 2 + 0.05;
      var sealStrip = addSolidMesh(new THREE.BoxGeometry(0.10, h - 0.2, 0.26), meshMatSteel, lineMatGold);
      sealStrip.position.set(meetX, h / 2, 0);
      dg.add(sealStrip);

      for (var ly of [1.6, 3.1, 4.6]) {
        var lockBox = addSolidMesh(new THREE.BoxGeometry(0.14, 0.26, 0.30), meshMatHazardYellow, lineMatDark);
        lockBox.position.set(meetX + (isLeft ? -0.12 : 0.12), ly, 0);
        dg.add(lockBox);
        var lockLever = addSolidMesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 8), meshMatSteel, lineMatDark);
        lockLever.position.set(meetX + (isLeft ? -0.18 : 0.18), ly + 0.08, 0.14);
        lockLever.rotation.z = isLeft ? 0.45 : -0.45;
        dg.add(lockLever);
      }

      if (!isLeft) {
        var manDoorFrame = addSolidMesh(new THREE.BoxGeometry(1.05, 2.15, 0.18), meshMatSteel, lineMatDark);
        manDoorFrame.position.set(1.4, 1.25, 0);
        dg.add(manDoorFrame);

        var manDoorPanel = addSolidMesh(new THREE.BoxGeometry(0.92, 2.02, 0.14), meshMatWall, lineMatDark);
        manDoorPanel.position.set(1.4, 1.25, 0);
        dg.add(manDoorPanel);

        var visionPort = addSolidMesh(new THREE.BoxGeometry(0.30, 0.40, 0.18), meshMatSteel, lineMatGold);
        visionPort.position.set(1.4, 1.65, 0);
        dg.add(visionPort);

        var pushBar = addSolidMesh(new THREE.BoxGeometry(0.68, 0.06, 0.08), meshMatHazardYellow, lineMatDark);
        pushBar.position.set(1.4, 1.05, 0.10);
        dg.add(pushBar);
      }

      var stripeW = w - 0.44, stripeH = 0.65;
      for (var bz of [0.09, -0.09]) {
        var stripeBase = addSolidMesh(new THREE.BoxGeometry(stripeW, stripeH, 0.02), meshMatHazardBlack, null);
        stripeBase.position.set(0, 0.75, bz);
        dg.add(stripeBase);

        /* 黄黑斜纹警戒带:45°平行四边形裁进黑条矩形,等宽黄/黑相间(参考斜纹胶带,禁止旋转方块/菱形) */
        var hw = stripeW * 0.5, hh = stripeH * 0.5;
        var period = stripeH * 1.70, yW = period * 0.50;
        function clipPolyRect(poly, xmin, xmax, ymin, ymax) {
          function clip(src, inside, hit) {
            var out = [], i, a, b, aIn, bIn;
            for (i = 0; i < src.length; i++) {
              a = src[i]; b = src[(i + 1) % src.length];
              aIn = inside(a); bIn = inside(b);
              if (aIn && bIn) out.push(b);
              else if (aIn && !bIn) out.push(hit(a, b));
              else if (!aIn && bIn) { out.push(hit(a, b)); out.push(b); }
            }
            return out;
          }
          poly = clip(poly, function (p) { return p[0] >= xmin; }, function (a, b) { var u = (xmin - a[0]) / (b[0] - a[0] || 1e-9); return [xmin, a[1] + u * (b[1] - a[1])]; });
          poly = clip(poly, function (p) { return p[0] <= xmax; }, function (a, b) { var u = (xmax - a[0]) / (b[0] - a[0] || 1e-9); return [xmax, a[1] + u * (b[1] - a[1])]; });
          poly = clip(poly, function (p) { return p[1] >= ymin; }, function (a, b) { var u = (ymin - a[1]) / (b[1] - a[1] || 1e-9); return [a[0] + u * (b[0] - a[0]), ymin]; });
          poly = clip(poly, function (p) { return p[1] <= ymax; }, function (a, b) { var u = (ymax - a[1]) / (b[1] - a[1] || 1e-9); return [a[0] + u * (b[0] - a[0]), ymax]; });
          return poly;
        }
        var k0 = Math.floor((-hw - hh - yW) / period) - 1;
        var k1 = Math.ceil((hw + hh + yW) / period) + 1;
        for (var k = k0; k <= k1; k++) {
          var x0 = k * period;
          var para = [
            [x0, -hh], [x0 + yW, -hh],
            [x0 + yW - stripeH, hh], [x0 - stripeH, hh]
          ];
          var clipped = clipPolyRect(para, -hw, hw, -hh, hh);
          if (clipped.length < 3) continue;
          var sh = new THREE.Shape();
          sh.moveTo(clipped[0][0], clipped[0][1]);
          for (var ci = 1; ci < clipped.length; ci++) sh.lineTo(clipped[ci][0], clipped[ci][1]);
          sh.closePath();
          var sMesh = new THREE.Mesh(new THREE.ShapeGeometry(sh), meshMatHazardYellow);
          sMesh.position.set(0, 0.75, bz + (bz > 0 ? 0.012 : -0.012));
          dg.add(sMesh);
        }
      }

      var tagPlate = addSolidMesh(new THREE.BoxGeometry(1.3, 0.35, 0.02), meshMatHazardBlack, lineMatGold);
      tagPlate.position.set(isLeft ? -1.4 : 1.4, 2.8, 0.09);
      dg.add(tagPlate);
      var tagPlateIn = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.25, 0.025), meshMatHazardYellow);
      tagPlateIn.position.set(isLeft ? -1.4 : 1.4, 2.8, 0.092);
      dg.add(tagPlateIn);

      return dg;
    }

    var doorL = buildSlidingDoorLeaf(true);
    doorL.position.set(-6.00, 0.05, -8.55);
    g.add(doorL);

    var doorR = buildSlidingDoorLeaf(false);
    doorR.position.set(6.00, 0.05, -8.55);
    g.add(doorR);

    // 2. 侧翼半开放式钢构立柱与下部防护矮墙
    for (var side = -1; side <= 1; side += 2) {
      var colX = side * 11.5;
      for (var cz of [-9.5, -3.5, 2.5, 8.5, 14.5]) {
        var basePier = addSolidMesh(new THREE.BoxGeometry(0.72, 0.6, 0.72), meshMatWall, lineMatDark);
        basePier.position.set(colX, 0.3, cz);
        g.add(basePier);

        for (var bx of [-0.26, 0.26]) {
          for (var bz of [-0.26, 0.26]) {
            var bolt = addSolidMesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6), meshMatSteel, lineMatDark);
            bolt.position.set(colX + bx, 0.64, cz + bz);
            g.add(bolt);
          }
        }

        var colMesh = addSolidMesh(new THREE.BoxGeometry(0.42, 6.2, 0.42), meshMatSteel, lineMatDark);
        colMesh.position.set(colX, 3.4, cz);
        g.add(colMesh);

        var corbel = addSolidMesh(new THREE.BoxGeometry(0.36, 0.28, 0.48), meshMatSteel, lineMatDark);
        corbel.position.set(colX, 6.34, cz);
        g.add(corbel);

        var gussetPts = [
          new THREE.Vector3(colX, 6.1, cz), new THREE.Vector3(colX - side * 0.6, 6.6, cz),
          new THREE.Vector3(colX - side * 0.6, 6.6, cz), new THREE.Vector3(colX, 6.6, cz)
        ];
        var gussetGeo = new THREE.BufferGeometry().setFromPoints(gussetPts);
        g.add(new THREE.LineSegments(gussetGeo, lineMatDark));
      }

      for (var fcz of [-3.5, 8.5]) {
        var extBack = addSolidMesh(new THREE.BoxGeometry(0.04, 0.95, 0.35), meshMatWhite, lineMatDark);
        extBack.position.set(colX - side * 0.24, 1.8, fcz);
        g.add(extBack);

        var extTank = addSolidMesh(new THREE.CylinderGeometry(0.09, 0.09, 0.62, 12), meshMatDrumRed, lineMatDark);
        extTank.position.set(colX - side * 0.36, 1.8, fcz);
        g.add(extTank);

        var extNozzle = addSolidMesh(new THREE.CylinderGeometry(0.02, 0.02, 0.28, 8), meshMatSteel, lineMatDark);
        extNozzle.position.set(colX - side * 0.44, 1.9, fcz);
        g.add(extNozzle);
      }

      var lowWall = addSolidMesh(new THREE.BoxGeometry(0.35, 1.4, 24.5), meshMatWall, lineMatDark);
      lowWall.position.set(colX, 0.7, 2.5);
      g.add(lowWall);

      var runBeam = addSolidMesh(new THREE.BoxGeometry(0.44, 0.32, 24.5), meshMatSteel, lineMatDark);
      runBeam.position.set(colX, 6.64, 2.5);
      g.add(runBeam);

      var craneRail = addSolidMesh(new THREE.BoxGeometry(0.16, 0.10, 24.5), meshMatSteel, lineMatDark);
      craneRail.position.set(colX, 6.85, 2.5);
      g.add(craneRail);
    }

    var airPipe = addSolidMesh(new THREE.CylinderGeometry(0.04, 0.04, 24.0, 10), meshMatHazardYellow, lineMatDark);
    airPipe.rotation.x = Math.PI / 2;
    airPipe.position.set(-11.25, 4.2, 2.5);
    g.add(airPipe);
    for (var vpz of [-3.5, 2.5, 8.5]) {
      var vBody = addSolidMesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), meshMatBrass, lineMatDark);
      vBody.position.set(-11.25, 4.2, vpz);
      g.add(vBody);
      var vWheel = addSolidMesh(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 14), meshMatDrumRed, lineMatDark);
      vWheel.rotation.z = Math.PI / 2;
      vWheel.position.set(-11.12, 4.2, vpz);
      g.add(vWheel);
    }

    var elBox = addSolidMesh(new THREE.BoxGeometry(0.16, 0.9, 0.7), meshMatCabinetBlue, lineMatDark);
    elBox.position.set(11.26, 2.4, -3.5);
    g.add(elBox);
    var elPanel = addSolidMesh(new THREE.BoxGeometry(0.04, 0.75, 0.55), meshMatSteel, lineMatGold);
    elPanel.position.set(11.16, 2.4, -3.5);
    g.add(elPanel);
    var ledG = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), meshMatScreen);
    ledG.position.set(11.13, 2.65, -3.6);
    g.add(ledG);
    var ledA = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), meshMatHazardYellow);
    ledA.position.set(11.13, 2.65, -3.4);
    g.add(ledA);

    var estopBox = addSolidMesh(new THREE.BoxGeometry(0.12, 0.22, 0.18), meshMatHazardYellow, lineMatDark);
    estopBox.position.set(11.26, 1.6, -3.5);
    g.add(estopBox);
    var estopBtn = addSolidMesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 10), meshMatDrumRed, lineMatDark);
    estopBtn.rotation.z = Math.PI / 2;
    estopBtn.position.set(11.18, 1.6, -3.5);
    g.add(estopBtn);

    // 3. 顶部黄色龙门起重机主梁与端梁总成
    var endL = addSolidMesh(new THREE.BoxGeometry(0.60, 0.46, 2.4), meshMatSteel, lineMatDark);
    endL.position.set(-11.5, 7.10, 0.5);
    g.add(endL);
    var endR = addSolidMesh(new THREE.BoxGeometry(0.60, 0.46, 2.4), meshMatSteel, lineMatDark);
    endR.position.set(11.5, 7.10, 0.5);
    g.add(endR);

    for (var eside = -1; eside <= 1; eside += 2) {
      for (var ewz of [-0.80, 0.80]) {
        var eWheel = addSolidMesh(new THREE.CylinderGeometry(0.14, 0.14, 0.10, 12), meshMatSteel, lineMatDark);
        eWheel.rotation.x = Math.PI / 2;
        eWheel.position.set(eside * 11.5, 6.90, 0.5 + ewz);
        g.add(eWheel);
      }
    }

    var craneBeamF = addSolidMesh(new THREE.BoxGeometry(22.40, 0.46, 0.28), meshMatCrane, lineMatDark);
    craneBeamF.position.set(0, 7.10, 0.68);
    g.add(craneBeamF);
    var craneBeamR = addSolidMesh(new THREE.BoxGeometry(22.40, 0.46, 0.28), meshMatCrane, lineMatDark);
    craneBeamR.position.set(0, 7.10, 0.32);
    g.add(craneBeamR);

    for (var flgX of [-11.19, 11.19]) {
      var flgF = addSolidMesh(new THREE.BoxGeometry(0.04, 0.48, 0.30), meshMatSteel, lineMatDark);
      flgF.position.set(flgX, 7.10, 0.68);
      g.add(flgF);
      var flgR = addSolidMesh(new THREE.BoxGeometry(0.04, 0.48, 0.30), meshMatSteel, lineMatDark);
      flgR.position.set(flgX, 7.10, 0.32);
      g.add(flgR);
    }

    var craneTag = addSolidMesh(new THREE.BoxGeometry(1.6, 0.32, 0.04), meshMatHazardBlack, lineMatGold);
    craneTag.position.set(0, 7.10, 0.84);
    g.add(craneTag);
    var craneTagIn = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.24, 0.02), meshMatHazardYellow);
    craneTagIn.position.set(0, 7.10, 0.865);
    g.add(craneTagIn);

    var hoistGroup = new THREE.Group();
    hoistGroup.position.set(hoistX, 0, 0);

    var hoistTrolley = addSolidMesh(new THREE.BoxGeometry(1.5, 0.42, 1.1), meshMatHoist, lineMatGold);
    hoistTrolley.position.set(0, 7.55, 0.5);
    hoistGroup.add(hoistTrolley);

    var drumMotor = addSolidMesh(new THREE.CylinderGeometry(0.24, 0.24, 0.9, 14), meshMatSteel, lineMatDark);
    drumMotor.rotation.z = Math.PI / 2;
    drumMotor.position.set(0, 7.82, 0.5);
    hoistGroup.add(drumMotor);

    var beacon = addSolidMesh(new THREE.CylinderGeometry(0.08, 0.08, 0.16, 10), meshMatOrange, lineMatGold);
    beacon.position.set(0, 8.05, 0.5);
    hoistGroup.add(beacon);

    var cableL = addSolidMesh(new THREE.BoxGeometry(0.03, 2.6, 0.03), meshMatSteel, lineMatDark);
    cableL.position.set(-0.22, 5.8, 0.5);
    hoistGroup.add(cableL);
    var cableR = addSolidMesh(new THREE.BoxGeometry(0.03, 2.6, 0.03), meshMatSteel, lineMatDark);
    cableR.position.set(0.22, 5.8, 0.5);
    hoistGroup.add(cableR);

    var hookBlock = addSolidMesh(new THREE.BoxGeometry(0.68, 0.52, 0.38), meshMatCrane, lineMatGold);
    hookBlock.position.set(0, 4.3, 0.5);
    hoistGroup.add(hookBlock);

    var hookCurvePts = [
      new THREE.Vector3(0, 4.04, 0.5), new THREE.Vector3(0, 3.55, 0.5),
      new THREE.Vector3(0, 3.55, 0.5), new THREE.Vector3(-0.30, 3.55, 0.5),
      new THREE.Vector3(-0.30, 3.55, 0.5), new THREE.Vector3(-0.30, 3.82, 0.5)
    ];
    var hcGeo = new THREE.BufferGeometry().setFromPoints(hookCurvePts);
    hoistGroup.add(new THREE.LineSegments(hcGeo, lineMatGold));

    g.add(hoistGroup);
    hoistTrolleyGroup = hoistGroup;

    for (var hbx of [-5.5, 5.5]) {
      for (var hbz of [-3.5, 7.5]) {
        var rod = addSolidMesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6), meshMatSteel, lineMatDark);
        rod.position.set(hbx, 6.9, hbz);
        g.add(rod);

        var hood = addSolidMesh(new THREE.CylinderGeometry(0.08, 0.42, 0.32, 14), meshMatSteel, lineMatDark);
        hood.position.set(hbx, 6.2, hbz);
        g.add(hood);

        var glowLens = new THREE.Mesh(new THREE.CircleGeometry(0.38, 14), meshMatLampLens);
        glowLens.rotation.x = Math.PI / 2;
        glowLens.position.set(hbx, 6.04, hbz);
        g.add(glowLens);
      }
    }

    // 4. 左侧维修诊断工位实体建模 (x = -15.5m)
    var liftPlat = addSolidMesh(new THREE.BoxGeometry(4.2, 0.12, 6.8), meshMatSteel, lineMatDark);
    liftPlat.position.set(-15.5, 0.5, 1.0);
    g.add(liftPlat);

    for (var lx of [-17.2, -13.8]) {
      for (var lz of [-1.8, 3.8]) {
        var ramBase = addSolidMesh(new THREE.CylinderGeometry(0.16, 0.18, 0.2, 12), meshMatSteel, lineMatDark);
        ramBase.position.set(lx, 0.1, lz);
        g.add(ramBase);
        var ram = addSolidMesh(new THREE.CylinderGeometry(0.10, 0.10, 0.45, 12), meshMatSteel, lineMatGold);
        ram.position.set(lx, 0.32, lz);
        g.add(ram);
      }
    }

    for (var ckx of [-16.8, -14.2]) {
      for (var ckz of [-0.5, 2.5]) {
        var chock = addSolidMesh(new THREE.BoxGeometry(0.3, 0.14, 0.4), meshMatHazardYellow, lineMatDark);
        chock.position.set(ckx, 0.63, ckz);
        g.add(chock);
      }
    }

    var creeper = addSolidMesh(new THREE.BoxGeometry(0.65, 0.06, 1.2), meshMatDrumRed, lineMatDark);
    creeper.position.set(-13.0, 0.04, 1.5);
    g.add(creeper);
    var headrest = addSolidMesh(new THREE.BoxGeometry(0.45, 0.08, 0.25), meshMatSteel, lineMatDark);
    headrest.position.set(-13.0, 0.09, 1.95);
    g.add(headrest);

    var oilDrainDrum = addSolidMesh(new THREE.CylinderGeometry(0.25, 0.25, 0.65, 12), meshMatSteel, lineMatDark);
    oilDrainDrum.position.set(-13.2, 0.35, -1.8);
    g.add(oilDrainDrum);
    var oilFunnel = addSolidMesh(new THREE.CylinderGeometry(0.32, 0.08, 0.35, 12), meshMatHazardYellow, lineMatDark);
    oilFunnel.position.set(-13.2, 0.95, -1.8);
    g.add(oilFunnel);

    var bBench = addSolidMesh(new THREE.BoxGeometry(3.2, 0.88, 1.0), meshMatWall, lineMatDark);
    bBench.position.set(-15.2, 0.44, -5.5);
    g.add(bBench);
    var bTop = addSolidMesh(new THREE.BoxGeometry(3.4, 0.12, 1.1), meshMatCrate2, lineMatGold);
    bTop.position.set(-15.2, 0.94, -5.5);
    g.add(bTop);

    var viseBase = addSolidMesh(new THREE.BoxGeometry(0.32, 0.16, 0.28), meshMatSteel, lineMatDark);
    viseBase.position.set(-16.4, 1.08, -5.3);
    g.add(viseBase);
    var viseJaw = addSolidMesh(new THREE.BoxGeometry(0.28, 0.18, 0.12), meshMatSteel, lineMatGold);
    viseJaw.position.set(-16.4, 1.22, -5.2);
    g.add(viseJaw);

    var tBox = addSolidMesh(new THREE.BoxGeometry(0.65, 0.28, 0.35), meshMatDrumRed, lineMatDark);
    tBox.position.set(-14.2, 1.14, -5.4);
    g.add(tBox);

    var toolCab = addSolidMesh(new THREE.BoxGeometry(0.95, 1.1, 0.65), meshMatCabinetBlue, lineMatDark);
    toolCab.position.set(-17.2, 0.58, -4.0);
    g.add(toolCab);
    for (var di = 0; di < 5; di++) {
      var dHandle = addSolidMesh(new THREE.BoxGeometry(0.72, 0.04, 0.04), meshMatSteel, lineMatGold);
      dHandle.position.set(-17.2, 0.3 + di * 0.18, -3.66);
      g.add(dHandle);
    }

    var diagCart = addSolidMesh(new THREE.BoxGeometry(0.75, 0.95, 0.6), meshMatSteel, lineMatDark);
    diagCart.position.set(-13.0, 0.48, -4.2);
    g.add(diagCart);
    var laptopBase = addSolidMesh(new THREE.BoxGeometry(0.42, 0.04, 0.32), meshMatSteel, lineMatDark);
    laptopBase.position.set(-13.0, 0.98, -4.2);
    g.add(laptopBase);
    var laptopScreen = addSolidMesh(new THREE.BoxGeometry(0.42, 0.30, 0.03), meshMatSteel, lineMatDark);
    laptopScreen.position.set(-13.0, 1.15, -4.36);
    laptopScreen.rotation.x = -0.22;
    g.add(laptopScreen);
    var hudDisplay = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.26, 0.01), meshMatScreen);
    hudDisplay.position.set(-13.0, 1.15, -4.34);
    hudDisplay.rotation.x = -0.22;
    g.add(hudDisplay);

    var rackFrame = addSolidMesh(new THREE.BoxGeometry(1.4, 1.6, 0.45), meshMatSteel, lineMatDark);
    rackFrame.position.set(-18.0, 0.82, -1.5);
    g.add(rackFrame);
    var tColors = [meshMatCabinetBlue, meshMatSteel, meshMatDrumGreen];
    for (var ti = 0; ti < 3; ti++) {
      var tankMesh = addSolidMesh(new THREE.CylinderGeometry(0.14, 0.14, 1.45, 12), tColors[ti], lineMatDark);
      tankMesh.position.set(-18.0, 0.76, -1.8 + ti * 0.32);
      g.add(tankMesh);
      var regVal = addSolidMesh(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 8), meshMatBrass, lineMatDark);
      regVal.position.set(-18.0, 1.55, -1.8 + ti * 0.32);
      g.add(regVal);
    }

    // 5. 右侧军械弹药转运实体建模 (x = 15.5m)
    var dolly = new THREE.Group();
    dolly.position.set(15.2, 0, 1.0);

    var dollyChassis = addSolidMesh(new THREE.BoxGeometry(2.4, 0.25, 4.8), meshMatSteel, lineMatDark);
    dollyChassis.position.set(0, 0.45, 0);
    dolly.add(dollyChassis);

    var towPts = [
      new THREE.Vector3(-0.6, 0.45, -2.4), new THREE.Vector3(0, 0.45, -3.8),
      new THREE.Vector3(0.6, 0.45, -2.4), new THREE.Vector3(0, 0.45, -3.8)
    ];
    var towGeo = new THREE.BufferGeometry().setFromPoints(towPts);
    dolly.add(new THREE.LineSegments(towGeo, lineMatDark));

    for (var mdx of [-0.65, 0.65]) {
      var mCanister = addSolidMesh(new THREE.CylinderGeometry(0.42, 0.42, 4.4, 16), meshMatCrane, lineMatDark);
      mCanister.rotation.x = Math.PI / 2;
      mCanister.position.set(mdx, 1.05, 0);
      dolly.add(mCanister);

      for (var bndz of [-1.8, -0.6, 0.6, 1.8]) {
        var ribBand = addSolidMesh(new THREE.CylinderGeometry(0.445, 0.445, 0.12, 16), meshMatSteel, lineMatGold);
        ribBand.rotation.x = Math.PI / 2;
        ribBand.position.set(mdx, 1.05, bndz);
        dolly.add(ribBand);
      }

      var hzPlacard = addSolidMesh(new THREE.BoxGeometry(0.24, 0.24, 0.02), meshMatOrange, lineMatDark);
      hzPlacard.rotation.z = Math.PI / 4;
      hzPlacard.position.set(mdx, 1.05, 2.22);
      dolly.add(hzPlacard);
    }

    for (var dwx of [-1.3, 1.3]) {
      for (var dwz of [-1.4, 1.4]) {
        var dWheel = addSolidMesh(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 14), meshMatSteel, lineMatDark);
        dWheel.rotation.z = Math.PI / 2;
        dWheel.position.set(dwx, 0.36, dwz);
        dolly.add(dWheel);
        var hubCap = addSolidMesh(new THREE.CylinderGeometry(0.12, 0.12, 0.25, 10), meshMatHazardYellow, lineMatDark);
        hubCap.rotation.z = Math.PI / 2;
        hubCap.position.set(dwx, 0.36, dwz);
        dolly.add(hubCap);
      }
    }
    g.add(dolly);

    var rackG = new THREE.Group();
    rackG.position.set(15.5, 0, -5.0);
    for (var rux of [-1.6, 1.6]) {
      for (var ruz of [-0.6, 0.6]) {
        var upCol = addSolidMesh(new THREE.BoxGeometry(0.12, 2.8, 0.12), meshMatSteel, lineMatDark);
        upCol.position.set(rux, 1.4, ruz);
        rackG.add(upCol);
      }
    }
    for (var ryLvl of [0.4, 1.3, 2.2]) {
      var rBeam = addSolidMesh(new THREE.BoxGeometry(3.3, 0.14, 1.3), meshMatOrange, lineMatDark);
      rBeam.position.set(0, ryLvl, 0);
      rackG.add(rBeam);
      var case1 = addSolidMesh(new THREE.BoxGeometry(1.2, 0.55, 0.8), meshMatCrate1, lineMatDark);
      case1.position.set(-0.8, ryLvl + 0.35, 0);
      rackG.add(case1);
      var case2 = addSolidMesh(new THREE.BoxGeometry(1.1, 0.45, 0.75), meshMatCrate2, lineMatDark);
      case2.position.set(0.7, ryLvl + 0.30, 0);
      rackG.add(case2);
    }
    g.add(rackG);

    var subst = addSolidMesh(new THREE.BoxGeometry(2.2, 2.2, 1.8), meshMatSteel, lineMatDark);
    subst.position.set(17.8, 1.1, -1.8);
    g.add(subst);
    for (var bi = -0.6; bi <= 0.6; bi += 0.6) {
      var insulator = addSolidMesh(new THREE.CylinderGeometry(0.08, 0.12, 0.45, 10), meshMatHazardYellow, lineMatDark);
      insulator.position.set(17.8, 2.42, -1.8 + bi);
      g.add(insulator);
    }

    for (var bolPos of [[-12.8, 4.5], [-12.8, -4.5], [12.8, 4.5], [12.8, -4.5]]) {
      var bolMesh = addSolidMesh(new THREE.CylinderGeometry(0.12, 0.12, 1.0, 12), meshMatHazardYellow, lineMatDark);
      bolMesh.position.set(bolPos[0], 0.5, bolPos[1]);
      g.add(bolMesh);
    }

    // 绘制机库内部宏大空间与工业线条艺术
    buildHangarInteriorLineArt(g);

    // 绘制机库后部实体结构与工位备件库
    buildHangarRearArchitecture(g);
  }

  function buildHangarDoorExterior(g) {
    var canopy = addSolidMesh(new THREE.BoxGeometry(13.2, 0.32, 2.2), meshMatSteel, lineMatDark);
    canopy.position.set(0, 6.70, -9.90);
    g.add(canopy);

    for (var bx of [-5.6, -1.8, 1.8, 5.6]) {
      var brkPts = [
        new THREE.Vector3(bx, 6.55, -8.80), new THREE.Vector3(bx, 6.55, -11.0),
        new THREE.Vector3(bx, 6.55, -11.0), new THREE.Vector3(bx, 7.45, -8.80)
      ];
      var brkGeo = new THREE.BufferGeometry().setFromPoints(brkPts);
      g.add(new THREE.LineSegments(brkGeo, lineMatDark));
    }

    var signPlate = addSolidMesh(new THREE.BoxGeometry(3.6, 0.65, 0.08), meshMatSteel, lineMatGold);
    signPlate.position.set(0, 7.45, -9.04);
    g.add(signPlate);

    for (var colX of [-5.68, 5.68]) {
      var sigPlate = addSolidMesh(new THREE.BoxGeometry(0.32, 0.68, 0.06), meshMatSteel, lineMatDark);
      sigPlate.position.set(colX, 5.20, -9.11);
      g.add(sigPlate);

      var sigHousing = addSolidMesh(new THREE.BoxGeometry(0.24, 0.58, 0.18), meshMatSteel, lineMatDark);
      sigHousing.position.set(colX, 5.20, -9.23);
      g.add(sigHousing);

      var hoodR = addSolidMesh(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 10), meshMatSteel, lineMatDark);
      hoodR.rotation.x = Math.PI / 2;
      hoodR.position.set(colX, 5.34, -9.32);
      g.add(hoodR);
      var lensRed = new THREE.Mesh(new THREE.CircleGeometry(0.065, 12), new THREE.MeshLambertMaterial({ color: 0xff2222, emissive: 0xaa1111, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      lensRed.rotation.y = Math.PI;
      lensRed.position.set(colX, 5.34, -9.33);
      g.add(lensRed);

      var hoodG = addSolidMesh(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 10), meshMatSteel, lineMatDark);
      hoodG.rotation.x = Math.PI / 2;
      hoodG.position.set(colX, 5.06, -9.32);
      g.add(hoodG);
      var lensGreen = new THREE.Mesh(new THREE.CircleGeometry(0.065, 12), new THREE.MeshLambertMaterial({ color: 0x22ee66, emissive: 0x118833, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      lensGreen.rotation.y = Math.PI;
      lensGreen.position.set(colX, 5.06, -9.33);
      g.add(lensGreen);

      var conduit = addSolidMesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 8), meshMatSteel, lineMatDark);
      conduit.position.set(colX, 6.10, -9.10);
      g.add(conduit);
    }

    var ramp = addSolidMesh(new THREE.BoxGeometry(12.4, 0.10, 2.4), meshMatFloor, lineMatDark);
    ramp.position.set(0, -0.05, -10.2);
    g.add(ramp);

    var apron = addSolidMesh(new THREE.BoxGeometry(36.0, 0.08, 24.0), meshMatFloor, lineMatDark);
    apron.position.set(0, -0.04, -22.0);
    g.add(apron);

    var taxiLine = addSolidMesh(new THREE.BoxGeometry(0.22, 0.02, 22.0), meshMatHazardYellow, lineMatGold);
    taxiLine.position.set(0, 0.01, -22.0);
    g.add(taxiLine);

    for (var lz of [-11.0, -15.0, -19.0, -23.0, -27.0, -31.0]) {
      for (var lxi of [-5.8, 5.8]) {
        var lightBase = addSolidMesh(new THREE.CylinderGeometry(0.15, 0.18, 0.06, 12), meshMatSteel, lineMatDark);
        lightBase.position.set(lxi, 0.03, lz);
        g.add(lightBase);
        var lightLens = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 12), meshMatHazardYellow);
        lightLens.position.set(lxi, 0.07, lz);
        g.add(lightLens);
      }
    }

    for (var bzi of [-13.0, -17.0, -21.0, -25.0, -29.0]) {
      for (var bxi of [-8.8, 8.8]) {
        var barrier = addSolidMesh(new THREE.BoxGeometry(0.50, 0.82, 3.2), meshMatSteel, lineMatDark);
        barrier.position.set(bxi, 0.41, bzi);
        g.add(barrier);
      }
    }

    var gpu = new THREE.Group();
    gpu.position.set(-8.5, 0, -13.0);
    gpu.rotation.y = 0.55;

    var gpuBody = addSolidMesh(new THREE.BoxGeometry(2.0, 1.0, 1.3), meshMatSteel, lineMatDark);
    gpuBody.position.set(0, 0.72, 0);
    gpu.add(gpuBody);

    var gpuTop = addSolidMesh(new THREE.BoxGeometry(1.7, 0.25, 1.1), meshMatCrane, lineMatGold);
    gpuTop.position.set(0, 1.32, 0);
    gpu.add(gpuTop);

    var exhaust = addSolidMesh(new THREE.CylinderGeometry(0.04, 0.04, 0.45, 8), meshMatSteel, lineMatDark);
    exhaust.position.set(0.6, 1.55, -0.3);
    gpu.add(exhaust);

    var gpuPanel = addSolidMesh(new THREE.BoxGeometry(0.6, 0.4, 0.04), meshMatHazardBlack, lineMatGold);
    gpuPanel.position.set(0, 0.8, 0.67);
    gpu.add(gpuPanel);

    var gpuTow = addSolidMesh(new THREE.BoxGeometry(0.09, 0.09, 1.4), meshMatSteel, lineMatDark);
    gpuTow.position.set(0, 0.35, -1.2);
    gpu.add(gpuTow);

    for (var wx of [-0.85, 0.85]) {
      for (var wz of [-0.6, 0.6]) {
        var wheel = addSolidMesh(new THREE.CylinderGeometry(0.26, 0.26, 0.16, 14), meshMatSteel, lineMatDark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx, 0.26, wz);
        gpu.add(wheel);
      }
    }
    g.add(gpu);

    var windG = new THREE.Group();
    windG.position.set(-16.5, 0, -20.0);
    var wPole = addSolidMesh(new THREE.CylinderGeometry(0.06, 0.10, 5.5, 8), meshMatSteel, lineMatDark);
    wPole.position.set(0, 2.75, 0);
    windG.add(wPole);
    var wSwivel = addSolidMesh(new THREE.CylinderGeometry(0.12, 0.12, 0.25, 8), meshMatBrass, lineMatDark);
    wSwivel.position.set(0, 5.4, 0);
    windG.add(wSwivel);
    var wCone1 = addSolidMesh(new THREE.CylinderGeometry(0.24, 0.18, 0.6, 12), meshMatOrange, lineMatDark);
    wCone1.rotation.z = Math.PI / 2.3;
    wCone1.position.set(0.4, 5.3, 0);
    windG.add(wCone1);
    var wCone2 = addSolidMesh(new THREE.CylinderGeometry(0.18, 0.10, 0.6, 12), meshMatWhite, lineMatDark);
    wCone2.rotation.z = Math.PI / 2.3;
    wCone2.position.set(0.95, 5.15, 0);
    windG.add(wCone2);
    g.add(windG);

    var signBox = addSolidMesh(new THREE.BoxGeometry(1.6, 0.80, 0.28), meshMatHazardBlack, lineMatGold);
    signBox.position.set(7.5, 0.55, -13.0);
    signBox.rotation.y = -0.35;
    g.add(signBox);
    var signFace = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.68, 0.02), meshMatHazardYellow);
    signFace.position.set(7.5, 0.55, -12.85);
    signFace.rotation.y = -0.35;
    g.add(signFace);

    for (var mastX of [-9.5, 9.5]) {
      var mastBase = addSolidMesh(new THREE.BoxGeometry(0.8, 0.45, 0.8), meshMatSteel, lineMatDark);
      mastBase.position.set(mastX, 0.22, -10.5);
      g.add(mastBase);
      var mastPole = addSolidMesh(new THREE.CylinderGeometry(0.10, 0.16, 7.2, 8), meshMatSteel, lineMatDark);
      mastPole.position.set(mastX, 3.8, -10.5);
      g.add(mastPole);
      var mastHead = addSolidMesh(new THREE.BoxGeometry(1.3, 0.45, 0.55), meshMatSteel, lineMatDark);
      mastHead.position.set(mastX, 7.4, -10.5);
      g.add(mastHead);
      var mastLens = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.35, 0.05), meshMatHazardYellow);
      mastLens.position.set(mastX, 7.35, -10.22);
      g.add(mastLens);
    }
  }

  // 重点修复: 完美三角锥立式探照大灯 (精准计算偏航角与下俯倾角，绝对朝向转台中心载具照射)
  function makeWorklight(x, z) {
    var tg = new THREE.Group();
    tg.position.set(x, 0, z);

    // 计算面向转台中心载具 (0, 0.95m, 0) 的偏航角与下俯倾角
    var targetX = 0, targetY = 0.95, targetZ = 0;
    var dx = targetX - x, dz = targetZ - z;
    var rotY = Math.atan2(dx, dz); // +z 面向载具
    tg.rotation.y = rotY;

    var horizDist = Math.sqrt(dx * dx + dz * dz);
    var dy = 2.35 - targetY;
    var tilt = Math.atan2(dy, horizDist); // 精准向下俯照

    var mastLower = addSolidMesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 12), meshMatLampStand, lineMatDark);
    mastLower.position.set(0, 0.60, 0);
    tg.add(mastLower);

    var clampRing = addSolidMesh(new THREE.CylinderGeometry(0.065, 0.065, 0.10, 12), meshMatSteel, lineMatDark);
    clampRing.position.set(0, 1.15, 0);
    tg.add(clampRing);

    var clampKnob = addSolidMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 8), meshMatHazardYellow, lineMatDark);
    clampKnob.rotation.z = Math.PI / 2;
    clampKnob.position.set(0.08, 1.15, 0);
    tg.add(clampKnob);

    var mastUpper = addSolidMesh(new THREE.CylinderGeometry(0.032, 0.032, 1.0, 12), meshMatLampStand, lineMatDark);
    mastUpper.position.set(0, 1.65, 0);
    tg.add(mastUpper);

    var hubCollar = addSolidMesh(new THREE.CylinderGeometry(0.065, 0.065, 0.12, 12), meshMatSteel, lineMatDark);
    hubCollar.position.set(0, 0.85, 0);
    tg.add(hubCollar);

    var spreadCollar = addSolidMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.10, 12), meshMatSteel, lineMatDark);
    spreadCollar.position.set(0, 0.35, 0);
    tg.add(spreadCollar);

    var legRTop = 0.05, legRBot = 0.58;
    var legYTop = 0.85, legYBot = 0.03;
    var legLen = Math.sqrt(Math.pow(legRBot - legRTop, 2) + Math.pow(legYTop - legYBot, 2));

    for (var k = 0; k < 3; k++) {
      var ang = (k / 3) * Math.PI * 2;
      var sinA = Math.sin(ang), cosA = Math.cos(ang);

      var topPt = new THREE.Vector3(legRTop * sinA, legYTop, legRTop * cosA);
      var botPt = new THREE.Vector3(legRBot * sinA, legYBot, legRBot * cosA);
      var midPt = new THREE.Vector3().addVectors(topPt, botPt).multiplyScalar(0.5);

      var legMesh = addSolidMesh(new THREE.CylinderGeometry(0.024, 0.024, legLen, 8), meshMatLampStand, lineMatDark);
      legMesh.position.copy(midPt);
      var dir = new THREE.Vector3().subVectors(topPt, botPt).normalize();
      legMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      tg.add(legMesh);

      var foot = addSolidMesh(new THREE.CylinderGeometry(0.045, 0.055, 0.04, 10), meshMatHazardBlack, lineMatDark);
      foot.position.set(botPt.x, 0.02, botPt.z);
      tg.add(foot);

      var sprStart = new THREE.Vector3(0.04 * sinA, 0.35, 0.04 * cosA);
      var sprEnd = midPt.clone();
      var sprLen = sprStart.distanceTo(sprEnd);
      var sprMid = new THREE.Vector3().addVectors(sprStart, sprEnd).multiplyScalar(0.5);
      var sprMesh = addSolidMesh(new THREE.CylinderGeometry(0.014, 0.014, sprLen, 6), meshMatSteel, lineMatDark);
      sprMesh.position.copy(sprMid);
      var sprDir = new THREE.Vector3().subVectors(sprEnd, sprStart).normalize();
      sprMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sprDir);
      tg.add(sprMesh);
    }

    var topCollar = addSolidMesh(new THREE.CylinderGeometry(0.045, 0.045, 0.08, 10), meshMatSteel, lineMatDark);
    topCollar.position.set(0, 2.15, 0);
    tg.add(topCollar);

    var yokeBase = addSolidMesh(new THREE.BoxGeometry(0.48, 0.08, 0.12), meshMatLampHead, lineMatDark);
    yokeBase.position.set(0, 2.22, 0);
    tg.add(yokeBase);

    var yokeSideL = addSolidMesh(new THREE.BoxGeometry(0.06, 0.22, 0.10), meshMatLampHead, lineMatDark);
    yokeSideL.position.set(-0.21, 2.31, 0);
    tg.add(yokeSideL);

    var yokeSideR = addSolidMesh(new THREE.BoxGeometry(0.06, 0.22, 0.10), meshMatLampHead, lineMatDark);
    yokeSideR.position.set(0.21, 2.31, 0);
    tg.add(yokeSideR);

    // 灯头总成 (发光面沿 +z 方向，下倾 tilt 角度直接投射在载具表面)
    var lampHeadG = new THREE.Group();
    lampHeadG.position.set(0, 2.35, 0);
    lampHeadG.rotation.x = tilt;

    var lampBody = addSolidMesh(new THREE.BoxGeometry(0.38, 0.28, 0.22), meshMatLampHead, lineMatDark);
    lampBody.position.set(0, 0, 0.08);
    lampHeadG.add(lampBody);

    var lampBezel = addSolidMesh(new THREE.BoxGeometry(0.40, 0.30, 0.04), meshMatSteel, lineMatGold);
    lampBezel.position.set(0, 0, 0.20);
    lampHeadG.add(lampBezel);

    var lampLens = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.25), meshMatLampLens);
    lampLens.position.set(0, 0, 0.222);
    lampHeadG.add(lampLens);

    var handle = addSolidMesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8), meshMatHazardYellow, lineMatDark);
    handle.rotation.z = Math.PI / 2;
    handle.position.set(0, 0, -0.06);
    lampHeadG.add(handle);

    tg.add(lampHeadG);
    return tg;
  }

  // 工业油桶建模 (桶身 0.90m 实心圆柱体，外部圆环采用 openEnded=true 杜绝顶底盖面共面闪烁)
  function buildOilDrum(matBody, hasHazardBand) {
    var dg = new THREE.Group();

    var drum = addSolidMesh(new THREE.CylinderGeometry(0.34, 0.34, 0.90, 16, 1, false), matBody, lineMatDark);
    dg.add(drum);

    var bung = addSolidMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 8), meshMatBrass, lineMatDark);
    bung.position.set(0.18, 0.46, 0);
    dg.add(bung);

    var rimT = addSolidMesh(new THREE.CylinderGeometry(0.355, 0.355, 0.05, 16, 1, true), meshMatDrumRing, lineMatDark);
    rimT.position.set(0, 0.435, 0);
    dg.add(rimT);

    var rimB = addSolidMesh(new THREE.CylinderGeometry(0.355, 0.355, 0.05, 16, 1, true), meshMatDrumRing, lineMatDark);
    rimB.position.set(0, -0.435, 0);
    dg.add(rimB);

    var hoop1 = addSolidMesh(new THREE.CylinderGeometry(0.352, 0.352, 0.035, 16, 1, true), meshMatDrumRing, null);
    hoop1.position.set(0, 0.16, 0);
    dg.add(hoop1);

    var hoop2 = addSolidMesh(new THREE.CylinderGeometry(0.352, 0.352, 0.035, 16, 1, true), meshMatDrumRing, null);
    hoop2.position.set(0, -0.16, 0);
    dg.add(hoop2);

    if (hasHazardBand) {
      var hBand = new THREE.Mesh(new THREE.CylinderGeometry(0.345, 0.345, 0.18, 16, 1, true), meshMatHazardYellow);
      hBand.position.set(0, 0, 0);
      dg.add(hBand);
    }

    return dg;
  }


  function buildHangarLineVista(g) {
    var pts = [];
    function L(ax, ay, az, bx, by, bz) { pts.push(new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz)); }
    function poly(arr) { var i; for (i = 0; i < arr.length - 1; i++) pts.push(arr[i], arr[i + 1]); }
    function rect(x0, y0, z0, x1, y1, z1) {
      L(x0, y0, z0, x1, y0, z0); L(x1, y0, z0, x1, y1, z0); L(x1, y1, z0, x0, y1, z0); L(x0, y1, z0, x0, y0, z0);
    }
    function boxW(x, y, z, w, h, d) {
      var x0 = x - w * 0.5, x1 = x + w * 0.5, y0 = y, y1 = y + h, z0 = z - d * 0.5, z1 = z + d * 0.5;
      L(x0, y0, z0, x1, y0, z0); L(x1, y0, z0, x1, y0, z1); L(x1, y0, z1, x0, y0, z1); L(x0, y0, z1, x0, y0, z0);
      L(x0, y1, z0, x1, y1, z0); L(x1, y1, z0, x1, y1, z1); L(x1, y1, z1, x0, y1, z1); L(x0, y1, z1, x0, y1, z0);
      L(x0, y0, z0, x0, y1, z0); L(x1, y0, z0, x1, y1, z0); L(x1, y0, z1, x1, y1, z1); L(x0, y0, z1, x0, y1, z1);
    }

    /* ===== 大门外:门边指挥塔 (右门柱外侧,贴门洞) ===== */
    (function () {
      var x = 10.85, z = -11.70;
      boxW(x, 0, z, 2.4, 1.15, 2.4);
      boxW(x, 1.15, z, 1.45, 5.55, 1.45);
      L(x - 0.72, 1.15, z - 0.72, x + 0.72, 6.7, z + 0.72);
      L(x + 0.72, 1.15, z - 0.72, x - 0.72, 6.7, z + 0.72);
      boxW(x, 6.70, z, 2.85, 1.85, 2.85);
      var cabY0 = 6.70, cabY1 = 8.55, hw = 1.42;
      for (var gy = 0; gy < 3; gy++) {
        var yy = cabY0 + 0.28 + gy * 0.52;
        L(x - hw, yy, z - hw, x + hw, yy, z - hw);
        L(x - hw, yy, z + hw, x + hw, yy, z + hw);
        L(x - hw, yy, z - hw, x - hw, yy, z + hw);
        L(x + hw, yy, z - hw, x + hw, yy, z + hw);
      }
      for (var gx = -1; gx <= 1; gx++) {
        var xx = x + gx * 0.85;
        L(xx, cabY0, z - hw, xx, cabY1, z - hw);
        L(xx, cabY0, z + hw, xx, cabY1, z + hw);
      }
      L(x - hw, cabY1, z - hw, x, 9.35, z);
      L(x + hw, cabY1, z - hw, x, 9.35, z);
      L(x - hw, cabY1, z + hw, x, 9.35, z);
      L(x + hw, cabY1, z + hw, x, 9.35, z);
      L(x, 9.35, z, x, 11.1, z);
      L(x - 0.55, 10.7, z, x + 0.55, 10.7, z);
      L(x, 10.5, z - 0.55, x, 10.5, z + 0.55);
      for (var st = 0; st < 8; st++) {
        var sy = 1.2 + st * 0.68;
        L(x - 1.35, sy, z + 0.2, x - 0.72, sy, z + 0.2);
        L(x - 1.35, sy, z + 0.2, x - 1.35, sy + 0.68, z + 0.2);
      }
      L(x - 1.35, 1.15, z + 0.2, x - 1.35, 6.7, z + 0.2);
    })();

    /* ===== 大门外:跑道两侧防护板 (喷射/拦阻立板+斜撑) ===== */
    (function () {
      var z, i, x, face;
      for (face = -1; face <= 1; face += 2) {
        x = face * 7.45;
        for (i = 0; i < 5; i++) {
          z = -12.15 - i * 1.15;
          L(x, 0, z, x, 2.55, z);
          L(x, 0, z - 1.05, x, 2.55, z - 1.05);
          L(x, 0, z, x, 0, z - 1.05);
          L(x, 0.85, z, x, 0.85, z - 1.05);
          L(x, 1.70, z, x, 1.70, z - 1.05);
          L(x, 2.55, z, x, 2.55, z - 1.05);
          L(x, 0, z, x, 2.55, z - 1.05);
          L(x, 2.55, z, x, 0, z - 1.05);
          L(x, 2.55, z, x - face * 0.85, 0, z);
          L(x, 2.55, z - 1.05, x - face * 0.85, 0, z - 1.05);
        }
      }
    })();

    /* ===== 左侧窗外:仓库货架 / 托盘 / 叉车 ===== */
    (function () {
      var bx = -20.4, z, y, r, b;
      for (r = 0; r < 3; r++) {
        var rz = -1.0 + r * 3.4;
        L(bx - 1.6, 0, rz, bx - 1.6, 3.8, rz);
        L(bx + 1.6, 0, rz, bx + 1.6, 3.8, rz);
        L(bx - 1.6, 0, rz + 2.4, bx - 1.6, 3.8, rz + 2.4);
        L(bx + 1.6, 0, rz + 2.4, bx + 1.6, 3.8, rz + 2.4);
        L(bx - 1.6, 3.8, rz, bx + 1.6, 3.8, rz);
        L(bx - 1.6, 3.8, rz + 2.4, bx + 1.6, 3.8, rz + 2.4);
        for (b = 1; b <= 3; b++) {
          y = b * 0.95;
          L(bx - 1.6, y, rz, bx + 1.6, y, rz);
          L(bx - 1.6, y, rz + 2.4, bx + 1.6, y, rz + 2.4);
          L(bx - 1.6, y, rz, bx - 1.6, y, rz + 2.4);
          L(bx + 1.6, y, rz, bx + 1.6, y, rz + 2.4);
        }
      }
      for (var c = 0; c < 4; c++) {
        boxW(-19.6 - (c % 2) * 1.15, 0, 9.2 + Math.floor(c / 2) * 1.2, 1.0, 0.85, 1.0);
      }
      boxW(-19.55, 0, 8.0, 1.05, 0.7, 1.7);
      L(-20.15, 0.7, 7.4, -19.0, 0.7, 7.4);
      L(-20.15, 0.7, 8.6, -19.0, 0.7, 8.6);
      L(-19.0, 0.15, 7.25, -19.0, 1.15, 7.25);
      L(-19.0, 0.15, 8.75, -19.0, 1.15, 8.75);
      L(-20.55, 0.15, 7.4, -20.55, 0.15, 8.6);
      L(-20.55, 0.15, 8.0, -21.15, 1.05, 8.0);
      L(-21.15, 1.05, 8.0, -20.55, 1.35, 8.0);
    })();

    /* ===== 右侧窗外:检修台 / 吊架 / 油桶架 / 悬臂吊 ===== */
    (function () {
      boxW(20.4, 0, -2.2, 2.6, 0.85, 1.15);
      L(19.2, 0.85, -2.2, 21.6, 0.85, -2.2);
      L(19.5, 0.85, -1.75, 19.5, 1.15, -1.75);
      L(19.25, 1.15, -1.75, 19.75, 1.15, -1.75);
      boxW(20.25, 0, 2.0, 1.6, 1.35, 1.6);
      L(19.45, 1.35, 1.3, 21.05, 1.35, 2.7);
      L(19.45, 1.35, 2.7, 21.05, 1.35, 1.3);
      L(20.25, 1.35, 2.0, 20.25, 2.55, 2.0);
      L(19.65, 2.55, 2.0, 20.85, 2.55, 2.0);
      L(19.65, 2.15, 2.0, 19.65, 2.55, 2.0);
      L(20.85, 2.15, 2.0, 20.85, 2.55, 2.0);
      L(21.6, 0, 5.2, 21.6, 4.6, 5.2);
      L(21.6, 4.6, 5.2, 19.6, 4.6, 5.2);
      L(19.6, 4.6, 5.2, 19.6, 3.7, 5.2);
      L(19.35, 3.7, 5.2, 19.85, 3.7, 5.2);
      L(21.6, 0, 4.7, 21.6, 0, 5.7);
      L(21.1, 0, 4.7, 22.1, 0, 5.7);
      for (var bi = 0; bi < 3; bi++) {
        var bz = 7.2 + bi * 1.05;
        L(19.6, 0, bz, 19.6, 1.35, bz);
        L(21.2, 0, bz, 21.2, 1.35, bz);
        L(19.6, 1.35, bz, 21.2, 1.35, bz);
        L(19.6, 0.45, bz, 21.2, 0.45, bz);
        L(19.6, 0.90, bz, 21.2, 0.90, bz);
        L(19.8, 0.15, bz - 0.35, 19.8, 1.2, bz - 0.35);
        L(21.0, 0.15, bz - 0.35, 21.0, 1.2, bz - 0.35);
      }
      boxW(19.85, 0, 10.0, 0.95, 1.55, 0.7);
      L(19.5, 0.35, 9.65, 20.2, 0.35, 9.65);
      L(19.5, 0.70, 9.65, 20.2, 0.70, 9.65);
      L(19.5, 1.05, 9.65, 20.2, 1.05, 9.65);
      L(19.5, 1.40, 9.65, 20.2, 1.40, 9.65);
    })();

    var geo = new THREE.BufferGeometry().setFromPoints(pts);
    g.add(new THREE.LineSegments(geo, lineMatGold));
  }

  function buildHangarEnv() {
    var g = new THREE.Group();
    // 1. 地面平铺尺寸延伸 22% 至 66m x 66m (配合加重边缘雾化，彻底消除地坪可见边缘)
    var floorGeo = new THREE.PlaneGeometry(66, 66);
    var floorMesh = new THREE.Mesh(floorGeo, meshMatFloor);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(0, -0.01, -7.0);
    floorMesh.receiveShadow = true;
    g.add(floorMesh);

    var gridColor1 = 0x141610;
    var gridColor2 = 0x364032;
    var grid = new THREE.GridHelper(66, 66, gridColor1, gridColor2);
    grid.position.set(0, 0, -7.0);
    g.add(grid);

    buildHangarLineVista(g);
    buildHangarArchitecture(g);
    buildHangarDoorExterior(g);

    // 双向进出机库的 3D 实心钢轨
    for (var ri = -1; ri <= 1; ri += 2) {
      var rail = addSolidMesh(new THREE.BoxGeometry(0.12, 0.06, 42), meshMatSteel, lineMatDark);
      rail.position.set(ri * 1.8, 0.03, 0);
      g.add(rail);
    }

    var guideLinePts = [
      new THREE.Vector3(-1.8, 0.035, -22.0), new THREE.Vector3(-1.8, 0.035, 22.0),
      new THREE.Vector3(1.8, 0.035, -22.0), new THREE.Vector3(1.8, 0.035, 22.0)
    ];
    var glGeo = new THREE.BufferGeometry().setFromPoints(guideLinePts);
    g.add(new THREE.LineSegments(glGeo, lineMatDark));

    // 2. 检修转台基座与同心标线
    var ttBaseGeo = new THREE.CylinderGeometry(4.2, 4.5, 0.18, 36);
    var ttBase = addSolidMesh(ttBaseGeo, meshMatTurntable, lineMatDark, 20);
    ttBase.position.set(0, 0.09, 0);
    g.add(ttBase);

    var ttCenterHub = addSolidMesh(new THREE.CylinderGeometry(0.85, 0.9, 0.04, 28), meshMatSteel, lineMatDark);
    ttCenterHub.position.set(0, 0.19, 0);
    g.add(ttCenterHub);

    var ringGeo1 = new THREE.RingGeometry(1.8, 1.85, 36);
    ringGeo1.rotateX(-Math.PI / 2);
    var ring1 = new THREE.Mesh(ringGeo1, meshMatHazardYellow);
    ring1.position.set(0, 0.192, 0);
    ring1.receiveShadow = true;
    g.add(ring1);

    var ringGeo2 = new THREE.RingGeometry(3.4, 3.44, 36);
    ringGeo2.rotateX(-Math.PI / 2);
    var ring2 = new THREE.Mesh(ringGeo2, meshMatHazardYellow);
    ring2.position.set(0, 0.192, 0);
    ring2.receiveShadow = true;
    g.add(ring2);

    var ringGeo3 = new THREE.RingGeometry(4.0, 4.04, 36);
    ringGeo3.rotateX(-Math.PI / 2);
    var ring3 = new THREE.Mesh(ringGeo3, meshMatHazardYellow);
    ring3.position.set(0, 0.192, 0);
    ring3.receiveShadow = true;
    g.add(ring3);

    for (var gi = 0; gi < 4; gi++) {
      var gang = (gi / 4) * Math.PI * 2 + Math.PI / 4;
      var gCup = addSolidMesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 10), meshMatBrass, lineMatDark);
      gCup.position.set(Math.cos(gang) * 3.7, 0.195, Math.sin(gang) * 3.7);
      g.add(gCup);
    }

    var tickPts = [];
    for (var i = 0; i < 36; i++) {
      var ang = (i / 36) * Math.PI * 2;
      var r1 = (i % 6 === 0) ? 2.6 : 3.5;
      var r2 = 4.15;
      tickPts.push(
        new THREE.Vector3(Math.sin(ang) * r1, 0.193, Math.cos(ang) * r1),
        new THREE.Vector3(Math.sin(ang) * r2, 0.193, Math.cos(ang) * r2)
      );
    }
    var tickGeo = new THREE.BufferGeometry().setFromPoints(tickPts);
    g.add(new THREE.LineSegments(tickGeo, lineMatDark));

    // 4 个高可视性防滑路锥
    for (var conePos of [[-3.8, -3.8], [3.8, -3.8], [-3.8, 3.8], [3.8, 3.8]]) {
      var cBase = addSolidMesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), meshMatHazardBlack, lineMatDark);
      cBase.position.set(conePos[0], 0.02, conePos[1]);
      g.add(cBase);
      var cBody = addSolidMesh(new THREE.CylinderGeometry(0.04, 0.16, 0.72, 12), meshMatOrange, lineMatDark);
      cBody.position.set(conePos[0], 0.38, conePos[1]);
      g.add(cBody);
      var cBand = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.18, 12), meshMatWhite);
      cBand.position.set(conePos[0], 0.42, conePos[1]);
      g.add(cBand);
    }

    // 3. 重点修复: 4 个探照大灯全部朝内聚焦照射转台上的载具 (Inward Lighting)
    g.add(makeWorklight(-3.4,  3.2));
    g.add(makeWorklight( 3.4,  3.2));
    g.add(makeWorklight(-3.4, -3.2));
    g.add(makeWorklight( 3.4, -3.2));

    // 4. 军械弹药木箱堆垛
    var crate1 = addSolidMesh(new THREE.BoxGeometry(1.4, 0.75, 0.85), meshMatCrate1, lineMatDark);
    crate1.position.set(-5.6, 0.375, 2.4);
    crate1.rotation.y = 0.15;
    g.add(crate1);

    var crate1Stripe = new THREE.Mesh(new THREE.BoxGeometry(1.41, 0.1, 0.86), meshMatHazardYellow);
    crate1Stripe.position.set(-5.6, 0.375, 2.4);
    crate1Stripe.rotation.y = 0.15;
    g.add(crate1Stripe);

    var crate2 = addSolidMesh(new THREE.BoxGeometry(1.15, 0.62, 0.72), meshMatCrate2, lineMatDark);
    crate2.position.set(-5.4, 0.31, 3.5);
    crate2.rotation.y = -0.25;
    g.add(crate2);

    var crate3 = addSolidMesh(new THREE.BoxGeometry(0.70, 0.48, 0.52), meshMatCrate1, lineMatDark);
    crate3.position.set(-5.5, 0.99, 2.45);
    crate3.rotation.y = 0.08;
    g.add(crate3);

    // 5. 金属燃油桶组 (放置于 y = 0.465m，底圈位于 y = 0.005m，彻底解决底面闪烁)
    var drum1 = buildOilDrum(meshMatDrumGreen, false);
    drum1.position.set(5.5, 0.465, 2.2);
    g.add(drum1);

    var drum2 = buildOilDrum(meshMatDrumRed, true);
    drum2.position.set(5.3, 0.465, 3.1);
    g.add(drum2);

    var drum3 = buildOilDrum(meshMatDrumGreen, false);
    drum3.position.set(6.2, 0.465, 2.7);
    g.add(drum3);

    return g;
  }

  // Apply the fixed tactical garage surface and inspection shell.
  function applyVehicleStyle(tank) {
    if (!tank || !tank.group) return;
    tank.group.traverse(function (child) {
      if (!child.isMesh) return;
      // 关键修复：实例化网格(如多管火箭炮的火箭弹InstancedMesh)绝对不可挂载非实例化的普通EdgesGeometry折边线框，
      // 否则会在局部坐标原点(0,0,0)处残留一根穿模多余火箭线框！
      if (child.isInstancedMesh || (child.userData && child.userData.skipEdges)) return;
      if (child.userData && child.userData.isHl) return;
      if (child.userData && child.userData.isModShell) return;

      if (!child.userData.origMat && child.material) {
        child.userData.origMat = child.material;
      }

      child.castShadow = !inspectMode;
      child.receiveShadow = !inspectMode;

      if (child.material) {
        if (inspectMode) {
          var faded = (child.userData.origMat || child.material).clone();
          if (faded.color) faded.color.setHex(0x384e60);
          faded.transparent = true;
          faded.opacity = 0.15;
          faded.depthWrite = false;
          faded.side = THREE.DoubleSide;
          faded.fog = true;
          child.material = faded;
        } else if (child.userData.origMat) {
          child.material = child.userData.origMat;
          child.material.transparent = false;
          child.material.opacity = 1.0;
          child.material.depthWrite = true;
          child.material.fog = true;
        }
      }

      for (var i = child.children.length - 1; i >= 0; i--) {
        if (child.children[i].isLineSegments && child.children[i].userData && child.children[i].userData.isVehEdge) {
          child.remove(child.children[i]);
        }
      }

      if (child.geometry) {
        /* vcpanel-8：车库与对局共用灰白细分前冻结的旧拓扑 22° 边集；
           回退仅用于没有经过 mergeVisParts 的环境/辅助模型。 */
        var edges = (child.geometry.userData && child.geometry.userData._vehInkPrePanel) ||
                    new THREE.EdgesGeometry(child.geometry, 22);
        var edgeColor = inspectMode ? 0x44bbcc : 0x141610;
        var edgeOpacity = inspectMode ? 0.35 : 1.0;
        var edgeMat = new THREE.LineBasicMaterial({
          color: edgeColor,
          linewidth: inspectMode ? 1.0 : 1.2,
          transparent: inspectMode,
          opacity: edgeOpacity,
          depthTest: true,
          fog: true
        });
        var lines = new THREE.LineSegments(edges, edgeMat);
        lines.userData.isVehEdge = true;
        child.add(lines);
      }
    });
  }

  // 构建统一、美观、全息发光的内部关键战术模块 (直升机与地面载具统一高科技内构体系)
  function buildInspectModules() {
    removeInspectModules();
    if (!curTankObj || !curTankObj.modMeshes) return;

    for (var i = 0; i < curTankObj.modMeshes.length; i++) {
      var mm = curTankObj.modMeshes[i];
      if (!mm || !mm.geometry) continue;

      var key = mm.userData && mm.userData.key;
      if (PV_INTERNAL.indexOf(key) < 0) continue;

      var col = (key && PV_MOD_COLORS[key]) ? PV_MOD_COLORS[key] : 0xf59e0b;

      var mat = new THREE.MeshLambertMaterial({
        color: col,
        emissive: col,
        emissiveIntensity: 0.55,
        transparent: true,
        opacity: 0.72,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        fog: true
      });

      var shell = new THREE.Mesh(mm.geometry.clone(), mat);
      shell.position.copy(mm.position);
      shell.rotation.copy(mm.rotation);
      shell.scale.copy(mm.scale);
      shell.userData.isModShell = true;
      shell.userData.origMod = mm;

      var edges = new THREE.EdgesGeometry(shell.geometry, 15);
      var lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2.0, transparent: true, opacity: 0.9, depthTest: false, fog: true });
      var lines = new THREE.LineSegments(edges, lineMat);
      lines.userData.isModShell = true;
      shell.add(lines);

      if (mm.parent) mm.parent.add(shell);
      else scene.add(shell);

      modShells.push(shell);
    }
  }

  function removeInspectModules() {
    if (modShells.length > 0) {
      for (var i = 0; i < modShells.length; i++) {
        var s = modShells[i];
        if (s.parent) s.parent.remove(s);
        if (s.geometry) s.geometry.dispose();
        if (s.material && s.material.dispose) s.material.dispose();
      }
      modShells = [];
    }
  }

  function toggleInspectMode() {
    inspectMode = !inspectMode;
    var btn = document.getElementById('hangar-btn-inspect');
    if (btn) {
      btn.textContent = inspectMode ? '◫ SOLID' : '◫ INSPECT';
      if (inspectMode) btn.classList.add('active');
      else btn.classList.remove('active');
    }
    if (inspectMode) {
      buildInspectModules();
    } else {
      removeInspectModules();
    }
    if (curTankObj) {
      applyVehicleStyle(curTankObj);
    }
    clearArmorHl();
  }

  function clearArmorHl() {
    if (hlMesh) {
      if (hlMesh.parent) hlMesh.parent.remove(hlMesh);
      var disposed = [], disposedGeometries = [];
      hlMesh.traverse(function (node) {
        if (node.geometry && disposedGeometries.indexOf(node.geometry) < 0) {
          disposedGeometries.push(node.geometry);
          if (node.geometry.dispose) node.geometry.dispose();
        }
        if (node.material && disposed.indexOf(node.material) < 0) {
          disposed.push(node.material);
          if (node.material.dispose) node.material.dispose();
        }
      });
    }
    hlMesh = null;
    hlSrc = null;

    var tip = document.getElementById('hangar-armor-tip');
    if (tip) tip.classList.add('hidden');
  }

  /* Overlay the clicked module itself so the highlight follows the selected part. */
  function highlightArmor(mm, targetHit) {
    clearArmorHl();
    if (!mm || !mm.geometry) return;

    var key = mm.userData && mm.userData.key;
    var mod = mm.userData && mm.userData.mod;
    var face = mm.userData && mm.userData.face;
    var isInternal = (key && PV_INTERNAL.indexOf(key) >= 0);

    var hlCol = isInternal ? (PV_MOD_COLORS[key] || 0xf59e0b) : 0x33eebb;

    var hlGeo = mm.geometry.clone();
    var hlMat = new THREE.MeshBasicMaterial({
      color: hlCol,
      transparent: true,
      opacity: isInternal ? 0.85 : 0.45,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      fog: true
    });

    hlMesh = new THREE.Mesh(hlGeo, hlMat);
    hlMesh.userData.isHl = true;
    hlMesh.position.copy(mm.position);
    hlMesh.rotation.copy(mm.rotation);
    hlMesh.scale.copy(mm.scale);

    var edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2.2, depthTest: false });
    var edges = new THREE.EdgesGeometry(hlGeo, 18);
    var edgeLines = new THREE.LineSegments(edges, edgeMat);
    edgeLines.userData.isHl = true;
    hlMesh.add(edgeLines);

    if (mm.parent) mm.parent.add(hlMesh);
    else scene.add(hlMesh);

    hlSrc = mm;

    var card = document.getElementById('hangar-armor-tip');
    var badgeEl = card ? card.querySelector('.mm-atip-badge') : null;
    var partEl = document.getElementById('atip-part-name');
    var physVal = document.getElementById('atip-phys-val');
    var angleVal = document.getElementById('atip-angle-val');
    var losVal = document.getElementById('atip-los-val');
    var matVal = document.getElementById('atip-mat-val');

    var lbl1 = document.getElementById('atip-lbl-1');
    var lbl2 = document.getElementById('atip-lbl-2');
    var lbl3 = document.getElementById('atip-lbl-3');
    var lbl4 = document.getElementById('atip-lbl-4');
    var unit1 = document.getElementById('atip-unit-1');
    var unit2 = document.getElementById('atip-unit-2');
    var unit3 = document.getElementById('atip-unit-3');

    if (card && partEl) {
      var vehName = (VEH_DATA[curTeam] && VEH_DATA[curTeam][curKind] && VEH_DATA[curTeam][curKind].name) || 'VEHICLE';

      if (inspectMode || isInternal) {
        if (badgeEl) badgeEl.textContent = '● KEY MODULE';
        var modName = (key === 'engine' ? 'POWERPLANT' :
                       key === 'fuel' ? 'MAIN FUEL CELL' :
                       key === 'ammo' ? 'AMMO RACK' :
                       key === 'trans' ? 'TRANSMISSION' :
                       key === 'crew' ? 'CREW COMPARTMENT' : (mod ? mod.label : 'TAC CORE MODULE'));
        partEl.textContent = vehName + ' - ' + modName;

        if (lbl1) lbl1.textContent = 'STATUS';
        if (physVal) physVal.textContent = '100';
        if (unit1) unit1.textContent = '%';

        if (lbl2) lbl2.textContent = 'COOK-OFF RISK';
        if (angleVal) angleVal.textContent = (key === 'ammo' ? 'EXTREME' : (key === 'fuel' ? 'MEDIUM' : 'LOW'));
        if (unit2) unit2.textContent = '';

        if (lbl3) lbl3.textContent = 'IF HIT';
        if (losVal) losVal.textContent = (key === 'ammo' ? 'ONE-SHOT KILL' : (key === 'engine' ? 'IMMOBILIZED' : (key === 'fuel' ? 'FIRE' : 'DEGRADED')));
        if (unit3) unit3.textContent = '';

        if (lbl4) lbl4.textContent = 'PROTECTION';
        if (matVal) matVal.textContent = (key === 'ammo' ? 'BLOWOUT PANEL' : (key === 'fuel' ? 'SELF-SEAL TANK' : 'RHA BOX'));
      } else {
        if (badgeEl) badgeEl.textContent = '● ARMOR SCAN';

        var ln = new THREE.Vector3(0, 0, 1);
        if (targetHit && targetHit.face && targetHit.face.normal) {
          ln.copy(targetHit.face.normal);
        }

        var faceTitle = pvFaceOf(ln, face);
        var partTitle = (mod && mod.label) ? mod.label : (PV_FACE_NAMES[key] || 'ARMOR');
        partEl.textContent = partTitle + ' · ' + faceTitle;

        var thick = 120;
        try {
          if (typeof armorOf === 'function' && mod && mod.armor) {
            var lpt = targetHit ? mm.worldToLocal(targetHit.point.clone()) : new THREE.Vector3();
            thick = armorOf(mod, ln, face, lpt);
          } else if (mm.userData && mm.userData.thick) {
            thick = mm.userData.thick;
          }
        } catch (e) {
          thick = 120;
        }

        var wn = ln.clone().applyMatrix3(_normMat.getNormalMatrix(mm.matrixWorld)).normalize();
        var deg = Math.acos(Math.min(1, Math.max(0, Math.abs(wn.y)))) * 180 / Math.PI;
        if (isNaN(deg)) deg = 0;

        var rad = (deg * Math.PI) / 180;
        // 这是水平来袭的显示近似:实际战斗结算使用炮弹当前段方向与世界法线的 cosI；超过 68° 显示为跳弹。
        var cosIncidence = Math.sin(rad);
        var ricochetCos = (typeof ARMOR_RICOCHET_COS === 'number') ? ARMOR_RICOCHET_COS : Math.cos(68 * Math.PI / 180);
        var los = cosIncidence <= ricochetCos ? 'RICOCHET' : Math.round(thick / cosIncidence);

        if (lbl1) lbl1.textContent = 'PHYS THICKNESS';
        if (physVal) physVal.textContent = Math.round(thick);
        if (unit1) unit1.textContent = 'mm';

        if (lbl2) lbl2.textContent = 'SLOPE ANGLE';
        if (angleVal) angleVal.textContent = deg.toFixed(1);
        if (unit2) unit2.textContent = '°';

        if (lbl3) lbl3.textContent = 'LOS EQUIV';
        if (losVal) losVal.textContent = typeof los === 'number' ? Math.round(los) : los;
        if (unit3) unit3.textContent = typeof los === 'number' ? 'mm' : '';

        if (lbl4) lbl4.textContent = 'MATERIAL';
        var matName = 'RHA STEEL';
        if (curKind === '99') matName = 'HEAVY COMPOSITE + FY-4 ERA';
        else if (curKind === 'm1' || (curKind === 'td' && curTeam === 'blue')) matName = 'DU COMPOSITE';
        else if (curKind === 'ah64') matName = 'KEVLAR/CERAMIC LIGHT';
        else if (curKind === 'wz10') matName = 'ARMORED PLATE + COMPOSITE COCKPIT';
        else if (curKind === 'arty') matName = (curTeam === 'blue') ? 'ARMORED CAB + SPALL LINER' : 'HIGH-STRENGTH SPALL PLATE';
        else if (curKind === 'aa') matName = (curTeam === 'blue') ? 'HMMWV LIGHT PLATE' : 'LIGHT WELDED + BULLETPROOF GLASS';
        if (matVal) matVal.textContent = matName;
      }

      card.classList.remove('hidden');
    }
  }

  function raycastArmor(e) {
    if (!curTankObj || !curTankObj.group) return;
    var rect = canvas.getBoundingClientRect();
    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _ray.setFromCamera(_ndc, camera);

    var targets = [];
    if (inspectMode) {
      for (var si = 0; si < modShells.length; si++) {
        if (modShells[si]) targets.push(modShells[si]);
      }
      if (targets.length === 0 && curTankObj.modMeshes) {
        for (var mi = 0; mi < curTankObj.modMeshes.length; mi++) {
          var k = curTankObj.modMeshes[mi].userData && curTankObj.modMeshes[mi].userData.key;
          if (PV_INTERNAL.indexOf(k) >= 0) targets.push(curTankObj.modMeshes[mi]);
        }
      }
    } else {
      if (curTankObj.modMeshes && curTankObj.modMeshes.length > 0) {
        targets = curTankObj.modMeshes;
      }
      if (targets.length === 0) {
        curTankObj.group.traverse(function (c) {
          if (c.isMesh && !c.userData.isHl && !c.userData.isModShell) targets.push(c);
        });
      }
    }

    var hits = _ray.intersectObjects(targets, false);

    if (hits.length > 0) {
      var hit = hits[0];
      var targetMesh = hit.object;
      if (targetMesh.userData && targetMesh.userData.origMod) {
        targetMesh = targetMesh.userData.origMod;
      }
      highlightArmor(targetMesh, hit);
    } else if (!inspectMode && curTankObj.group) {
      var visTargets = [];
      curTankObj.group.traverse(function (c) {
        if (c.isMesh && !c.userData.isHl && !c.userData.isModShell) visTargets.push(c);
      });
      var visHits = _ray.intersectObjects(visTargets, false);
      if (visHits.length > 0) {
        var vh = visHits[0];
        var bestMod = curTankObj.modMeshes ? curTankObj.modMeshes[0] : null;
        var minD = Infinity;
        if (curTankObj.modMeshes) {
          for (var bj = 0; bj < curTankObj.modMeshes.length; bj++) {
            var tm = curTankObj.modMeshes[bj];
            var d = tm.getWorldPosition(new THREE.Vector3()).distanceTo(vh.point);
            if (d < minD) { minD = d; bestMod = tm; }
          }
        }
        highlightArmor(bestMod || vh.object, vh);
      } else {
        clearArmorHl();
      }
    } else {
      clearArmorHl();
    }
  }

  function onHangarClick(e) {
    if (!curTankObj) return;
    raycastArmor(e);
  }

  var LS_GARAGE_VEH = 'prefGarageVeh';

  function saveGarageSelection(team, kind) {
    var tm = team || 'blue';
    var kd = kind || 'td';
    try {
      localStorage.setItem(LS_GARAGE_VEH, tm + '|' + kd);
    } catch (e) {}
  }

  function loadGarageSelection() {
    // Remove obsolete model-cache keys during garage migration.
    try {
      var legacyKeys = [
        'ws_custom_model', 'prefJoyMode', 'garage_veh_cache', 'hangar_veh',
        'garage_vehicle', 'prefHangarVehicle', 'custom_vehicle', 'tank_save',
        'prefVehicle', 'lastVehicle', 'player_tank'
      ];
      for (var ki = 0; ki < legacyKeys.length; ki++) {
        localStorage.removeItem(legacyKeys[ki]);
      }
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (k && (k.indexOf('custom') !== -1 || k.indexOf('model') !== -1)) {
          if (k !== LS_GARAGE_VEH) localStorage.removeItem(k);
        }
      }
    } catch (e) {}

    var saved = null;
    try {
      saved = localStorage.getItem(LS_GARAGE_VEH);
    } catch (e) {}

    // A missing record (or the legacy bare kind value) gets the default BLUE-MBT-2.
    // Valid team|kind pairs, including RED-MBT-1 and RED-MBT-2, must remain restorable.
    // 默认展示改为 RED-MBT-2(99式);旧版自动写入的默认值 blue|td 一次性迁移为 99式。
    var migrated = null;
    try { migrated = localStorage.getItem('ac_default99'); localStorage.setItem('ac_default99', '1'); } catch (e) {}
    if (!saved || saved === 'tank' || (saved === 'blue|td' && !migrated)) {
      saveGarageSelection('red', '99');
      return { team: 'red', kind: '99' };
    }

    if (typeof saved === 'string') {
      var parts = saved.split('|');
      if (parts.length === 2) {
        var tm = parts[0], kd = parts[1];
        if (VEH_DATA[tm] && VEH_DATA[tm][kd]) {
          return { team: tm, kind: kd };
        }
      }
    }

    saveGarageSelection('blue', 'td');
    return { team: 'blue', kind: 'td' };
  }

  var TECH_ICON_BODY = {
    'fcs': '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    'aux-loader': '<rect x="4" y="5" width="11" height="14" rx="1"/><path d="M8 9h4M8 13h4M17 8l3 4-3 4M20 12h-6"/>',
    'non-skid-track': '<path d="M3 8h18M3 16h18M5 5l3 3-3 3M11 5l3 3-3 3M17 5l3 3-3 3M5 13l3 3-3 3M11 13l3 3-3 3M17 13l3 3-3 3"/>',
    'improved-105': '<path d="M4 12h13M14 7l6 5-6 5z"/><path d="M3 8v8"/>',
    'improved-ap': '<path d="M4 12h15M14 7l6 5-6 5z"/><path d="M4 8v8M7 9v6"/>',
    'improved-engine': '<rect x="5" y="7" width="12" height="10" rx="1"/><path d="M8 4v3M12 4v3M16 4v3M17 10h4v4h-4M8 10h5v4H8z"/>',
    'improved-motor': '<circle cx="12" cy="12" r="7"/><path d="M12 5v4l3 2M5 12H2M19 12h3"/>',
    'improved-optics': '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    'gun-launched-missile': '<path d="M4 15l8-8 4 4-8 8zM15 5l2-2 4 4-2 2M5 19l-2 2"/><path d="M11 9l4 4"/>',
    'battlefield-repair': '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
    'depleted-uranium-armor': '<path d="M12 2l8 3v6c0 5-3 8-8 11-5-3-8-6-8-11V5z"/><path d="M8 12l2 2 5-5"/>',
    'burst-loading': '<path d="M3 8h6l-2-3 5 2-2 3h6l-2-3 5 2-2 3M3 16h6l-2-3 5 2-2 3h6l-2-3 5 2-2 3"/>',
    'depleted-uranium-round': '<path d="M12 3l3 5v8l-3 5-3-5V8z"/><path d="M9 8h6M9 16h6"/>',
    'high-explosive': '<path d="M12 2l2 6 6-3-3 6 5 3-6 2 1 6-5-4-5 4 1-6-6-2 5-3-3-6 6 3z"/>',
    'improved-cooling': '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/><circle cx="12" cy="12" r="3"/>',
    'improved-power-pack': '<rect x="4" y="6" width="16" height="12" rx="1"/><path d="M20 10h2v4h-2M10 9l-2 4h3l-2 4 5-5h-3z"/>',
    'high-power-laser': '<path d="M3 12h13M13 7l7 5-7 5z"/><path d="M4 6l2 2M4 18l2-2"/>',
    'heavy-rocket-warhead': '<path d="M6 17l3-9 3-4 3 4 3 9-6 4z"/><path d="M9 11h6M12 4v14"/>',
    'airburst-round': '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3.5 3.5M14.9 14.9l3.5 3.5M18.4 5.6l-3.5 3.5M9.1 14.9l-3.5 3.5"/><circle cx="12" cy="12" r="3"/>',
    'auto-cannon': '<circle cx="12" cy="12" r="6"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M8 8l8 8M16 8l-8 8"/>',
    'guided-warhead': '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M3 5l5 2M3 5l2 5"/>',
    'anti-tank-missile': '<path d="M4 14l10-5 6 3-6 3zM14 9l2-4 3 1-2 4M7 15l-3 4"/>'
  };
  function techIconSvg(id) {
    var body = TECH_ICON_BODY[id] || TECH_ICON_BODY.fcs;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }
  function refreshVehicleExperienceBadge() {
    var node = document.getElementById('hangar-tech-experience-value');
    if (node && window.VehicleTech && typeof window.VehicleTech.experience === 'function') node.textContent = window.VehicleTech.experience() + ' XP';
  }

  function refreshVehicleLevelDrawer(team, kind) {
    refreshVehicleExperienceBadge();
    var list = document.getElementById('hangar-tech-tree');
    if (!list) return;
    var tm = team || 'red', kd = kind || 'tank';
    var key = tm + '|' + kd;
    var data = (VEH_DATA[tm] && VEH_DATA[tm][kd]) || VEH_DATA.red.tank;
    var displayName = data.name || (tm.toUpperCase() + '-' + kd.toUpperCase());
    list.setAttribute('data-tech-tree-key', key);
    list.setAttribute('data-tech-tree-team', tm);
    list.setAttribute('data-tech-tree-kind', kd);
    list.setAttribute('data-tech-vehicle-name', displayName);
    list.setAttribute('aria-label', displayName + ' vehicle level tree');
    list.innerHTML = '';

    var techTree = window.VehicleTech && window.VehicleTech.treeFor ? window.VehicleTech.treeFor(tm, kd) : null;
    if (techTree) {
      var techState = window.VehicleTech.stateFor(tm, kd);
      for (var ti = 0; ti < techTree.nodes.length; ti++) {
        var tech = techTree.nodes[ti];
        var techItem = document.createElement('div');
        var installed = !!(techState && techState.installed[tech.id]);
        var unlocked = !!(techState && techState.unlocked[tech.id]);
        techItem.className = 'mm-drawer-item mm-tech-item' + (installed ? ' active tech-installed' : ' tech-removed') + (!unlocked ? ' tech-locked' : '');
        techItem.setAttribute('data-tech-vehicle', key);
        techItem.setAttribute('data-tech-id', tech.id);
        techItem.setAttribute('data-tech-unlocked', unlocked ? 'true' : 'false');
        techItem.setAttribute('data-tech-installed', installed ? 'true' : 'false');
        techItem.title = tech.effect;

        var techHead = document.createElement('div');
        techHead.className = 'mm-tech-head';
        var techIcon = document.createElement('span');
        techIcon.className = 'mm-tech-icon';
        techIcon.innerHTML = techIconSvg(tech.id);
        var techName = document.createElement('span');
        techName.className = 'mm-drawer-item-name mm-tech-title';
        techName.textContent = tech.short;
        var techCost = document.createElement('span');
        techCost.className = 'mm-tech-cost';
        techCost.textContent = (window.VehicleTech.unlockCost || 25) + ' XP';
        techHead.appendChild(techIcon);
        techHead.appendChild(techName);
        techHead.appendChild(techCost);

        var techEffect = document.createElement('div');
        techEffect.className = 'mm-tech-effect';
        techEffect.textContent = tech.effect;

        var techAction = document.createElement('button');
        techAction.type = 'button';
        techAction.className = 'mm-tech-action ' + (!unlocked ? 'tech-action-locked' : (installed ? 'tech-action-installed' : 'tech-action-removed'));
        techAction.setAttribute('data-tech-action', 'true');
        techAction.textContent = !unlocked ? 'UNLOCK' : (installed ? 'INSTALLED' : 'INSTALL');
        techAction.title = !unlocked ? 'Spend experience to unlock and install' : (installed ? 'Click to remove installation' : 'Click to install');

        techItem.appendChild(techHead);
        techItem.appendChild(techEffect);
        techItem.appendChild(techAction);
        list.appendChild(techItem);
      }
      return;
    }

    for (var level = 1; level <= 5; level++) {
      var item = document.createElement('div');
      item.className = 'mm-drawer-item';
      item.setAttribute('data-tech-vehicle', key);
      item.setAttribute('data-tech-level', String(level));
      var name = document.createElement('span');
      name.className = 'mm-drawer-item-name';
      name.textContent = 'LEVEL ' + ('0' + level).slice(-2);
      var state = document.createElement('span');
      state.className = 'mm-drawer-item-en';
      state.textContent = 'TECH DATA PENDING';
      item.appendChild(name);
      item.appendChild(state);
      list.appendChild(item);
    }
  }

  // 载具创建与精确定位 (前轮坐落于转台 y=0.19m，机身超长伸出转台的后起落架尾轮精准落地于水泥地坪 y=0.00m)
  function setVehicle(team, kind) {
    curTeam = team || 'red';
    curKind = kind || '99';
    saveGarageSelection(curTeam, curKind);
    window.startSide = curTeam;
    window.startKind = curKind;
    if (typeof startSide !== 'undefined') startSide = curTeam;
    if (typeof startKind !== 'undefined') startKind = curKind;
    if (typeof el !== 'undefined' && el.siderow && el.skrow) {
      if (typeof markSel === 'function') {
        markSel(el.siderow, 'data-side', curTeam);
        markSel(el.skrow, 'data-k', curKind);
      }
      if (typeof refreshVehicleChoiceLabels === 'function') refreshVehicleChoiceLabels();
    }

    if (curTankObj && curTankObj.group) {
      scene.remove(curTankObj.group);
      curTankObj = null;
    }

    removeInspectModules();
    clearArmorHl();

    try {
      if (typeof createPreviewVehicle === 'function') {
        curTankObj = createPreviewVehicle(curKind, curTeam);
      }
    } catch (err) {
      console.warn('createPreviewVehicle build failed:', err);
    }

    if (curTankObj && curTankObj.group) {
      var isHeli = (curKind === 'wz10' || curKind === 'ah64');
      curTankObj.group.rotation.order = 'YXZ';
      curTankObj.group.rotation.y = Math.PI;

      if (curKind === 'ah64') {
        curTankObj.group.rotation.x = -0.1517;
        curTankObj.group.position.set(0, -0.2681, 0);
      } else if (curKind === 'wz10') {
        curTankObj.group.rotation.x = -0.1364;
        curTankObj.group.position.set(0, -0.2205, 0);
      } else {
        curTankObj.group.rotation.x = 0;
        curTankObj.group.position.set(0, 0.19 + ((curKind === 'tank' && curTeam === 'red') ? T59_LIFT : (curKind === '99' ? T99_LIFT : ((curKind === 'td' && curTeam === 'red') ? TD89_LIFT : ((curKind === 'td' && curTeam === 'blue') ? M1_LIFT : ((curKind === 'tank' && curTeam === 'blue') ? M60_LIFT : 0))))), 0);   // RED-MBT-1叠加T59_LIFT(与对局出生点同口径);RED-MBT-2/RED-TD/BLUE-MBT-2同理
      }

      scene.add(curTankObj.group);
      applyVehicleStyle(curTankObj);
      if (inspectMode) buildInspectModules();
    }

    if (hoistTrolleyGroup) {
      var isHeli = (curKind === 'wz10' || curKind === 'ah64');
      hoistXTo = (isHeli || curKind === 'arty' || curKind === 'aa') ? 4.8 : 1.2;   // 长车身载具(直升机/火箭炮)小车左移至 4.8;不瞬移: render 里滑到目标
    }

    var data = (VEH_DATA[curTeam] && VEH_DATA[curTeam][curKind]) || VEH_DATA.red.tank;
    updateUI(data, curTeam, curKind);
    refreshVehicleLevelDrawer(curTeam, curKind);
  }

  function updateUI(data, team, kind) {
    var el = function (id) { return document.getElementById(id); };
    var techData = (typeof vehicleTechHangarData === 'function') ? vehicleTechHangarData(team, kind, data) : data;
    var fireData = (typeof vehicleTechHangarFireData === 'function') ? vehicleTechHangarFireData(team, kind, data) : techData;
    if (el('hangar-veh-name')) el('hangar-veh-name').textContent = data.name || 'RED-MBT-1';
    if (el('hangar-veh-sub')) el('hangar-veh-sub').textContent = data.sub || 'RED-MEDIUM TANK';
    if (el('hangar-stat-fire')) el('hangar-stat-fire').textContent = fireData.fire || '100mm rifled gun';
    if (el('hangar-stat-fire-sub')) el('hangar-stat-fire-sub').textContent = fireData.fireSub || 'PEN 220mm - MV 1480m/s';
    if (el('hangar-stat-armor')) el('hangar-stat-armor').textContent = techData.armor || 'RHA steel';
    if (el('hangar-stat-armor-sub')) el('hangar-stat-armor-sub').textContent = techData.armorSub || 'Glacis 100mm / Turret 200mm';
    if (el('hangar-stat-speed')) el('hangar-stat-speed').textContent = techData.speed || '50 km/h';
    if (el('hangar-stat-speed-sub')) el('hangar-stat-speed-sub').textContent = techData.speedSub || '520HP diesel';
    var opticsStat = el('hangar-stat-optics');
    if (opticsStat && (team === 'red' || team === 'blue') && kind === 'aa' && typeof vehicleTechThermalImagingInstalled === 'function') {
      opticsStat.textContent = vehicleTechThermalImagingInstalled({ isPlayer: true, team: team, kind: kind })
        ? 'THERMAL IMAGING / EO-IR FCR' : (team === 'red' ? 'AIR SEARCH RADAR' : 'SURFACE-TO-AIR SEEKER');
      opticsStat._aaTech = true;
    } else if (opticsStat && opticsStat._aaTech) {
      opticsStat.textContent = 'Thermal / Laser suppressor';
      opticsStat._aaTech = false;
    }
    if (el('hangar-stat-hp')) el('hangar-stat-hp').textContent = data.hp || '1800 HP';
    if (el('hangar-stat-hp-sub')) el('hangar-stat-hp-sub').textContent = data.hpSub || 'Readiness 100%';

    var items = document.querySelectorAll('#hangar-veh-list .mm-drawer-item');
    items.forEach(function (it) {
      var itTeam = it.getAttribute('data-team');
      var itKind = it.getAttribute('data-kind');
      if (itTeam === team && itKind === kind) {
        it.classList.add('active');
      } else {
        it.classList.remove('active');
      }
    });
  }

  function applyHangarPresentation() {
    // Keep the single tactical garage presentation and rebuild its environment once.
    var fogCol = 0x272d24;
    var fogNear = 8.5;
    var fogFar = 28.5;

    if (scene) {
      scene.background = new THREE.Color(fogCol);
      if (!scene.fog) {
        scene.fog = new THREE.Fog(fogCol, fogNear, fogFar);
      } else {
        scene.fog.color.setHex(fogCol);
        scene.fog.near = fogNear;
        scene.fog.far = fogFar;
      }
    }

    if (renderer) renderer.setClearColor(fogCol, 1.0);

    initMaterials();
    if (envGroup) {
      scene.remove(envGroup);
      envGroup.traverse(function (c) { if (c.geometry && c.geometry.dispose) c.geometry.dispose(); });
    }
    envGroup = buildHangarEnv();
    scene.add(envGroup);

    if (lightsGroup) lightsGroup.visible = true;
    if (curTankObj) applyVehicleStyle(curTankObj);
  }

  function resize() {
    if (!canvas || !renderer || !camera) return;
    var w = canvas.parentElement ? canvas.parentElement.clientWidth : window.innerWidth;
    var h = canvas.parentElement ? canvas.parentElement.clientHeight : window.innerHeight;
    if (w < 10) w = window.innerWidth;
    if (h < 10) h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  function updateCamera() {
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    camera.position.set(
      targetCenter.x + dist * cp * sy,
      targetCenter.y + dist * sp,
      targetCenter.z + dist * cp * cy
    );
    camera.lookAt(targetCenter);
  }

  function render() {
    if (!running) return;
    animId = requestAnimationFrame(render);

    if (autoRotate && !isDragging) {
      var now = Date.now();
      if (now - lastUserInteractTime > 3000) {
        yaw += 0.0022;
      }
    }

    var nowH = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var dtH = hoistLastT ? Math.min(0.05, (nowH - hoistLastT) * 0.001) : 0.016;
    hoistLastT = nowH;
    if (hoistTrolleyGroup) {
      var dxH = hoistXTo - hoistX;
      var stepH = 2.85 * dtH;                         // ~1.25s 滑完 3.6m
      if (Math.abs(dxH) <= stepH) hoistX = hoistXTo;
      else hoistX += (dxH > 0 ? 1 : -1) * stepH;
      hoistTrolleyGroup.position.x = hoistX;
    }

    updateCamera();
    renderer.render(scene, camera);
  }

  function bindInput() {
    if (!canvas) return;

    function onDown(x, y) {
      isDragging = true;
      dragMoved = false;
      downX = x;
      downY = y;
      lastMouseX = x;
      lastMouseY = y;
      lastUserInteractTime = Date.now();
      if (typeof playMenuBgm === 'function') playMenuBgm();
    }

    function onMove(x, y) {
      if (!isDragging) return;
      var dx = x - lastMouseX;
      var dy = y - lastMouseY;
      if (Math.abs(x - downX) > 4 || Math.abs(y - downY) > 4) {
        dragMoved = true;
      }
      yaw -= dx * 0.007;
      pitch += dy * 0.006;
      if (pitch < 0.05) pitch = 0.05;
      if (pitch > 1.35) pitch = 1.35;
      lastMouseX = x;
      lastMouseY = y;
      lastUserInteractTime = Date.now();
    }

    function onUp(e) {
      try {
        if (!dragMoved && e) {
          onHangarClick(e);
        }
      } catch (err) {
        console.warn('onHangarClick error:', err);
      } finally {
        isDragging = false;
      }
    }

    /* ★移动端适配:触摸后浏览器会再合成一组 mousedown/mouseup,导致装甲测定射线被触发两次;
       400ms 内的鼠标事件视为幽灵事件丢弃。 */
    var _hgTouchT = 0;
    function _hgGhost() { return Date.now() - _hgTouchT < 400; }
    canvas.addEventListener('mousedown', function (e) {
      if (_hgGhost()) return;
      if (e.button === 0) onDown(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', function (e) {
      if (isDragging) onMove(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', function (e) {
      if (_hgGhost()) return;
      if (isDragging) onUp(e);
    });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      dist += e.deltaY * 0.008;
      if (dist < 4.5) dist = 4.5;
      if (dist > 13.75) dist = 13.75; // 最大远离距离缩减至原值的55% (25.0 * 0.55 = 13.75m)
      lastUserInteractTime = Date.now();
    }, { passive: false });

    /* ★移动端适配:单指拖动旋转 + 双指开合缩放(与滚轮同 clamp 4.5~13.75m);
       双指期间不算点击,抬起后不触发装甲测定。 */
    var _hgPinchD = 0;
    function _hgTouchDist(e) {
      var a = e.touches[0], b = e.touches[1];
      var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
    canvas.addEventListener('touchstart', function (e) {
      _hgTouchT = Date.now();
      if (e.touches.length === 1) {
        onDown(e.touches[0].clientX, e.touches[0].clientY);
      } else if (e.touches.length === 2) {
        _hgPinchD = _hgTouchDist(e);
        dragMoved = true;                       // 双指=缩放手势,抬起不当点击
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', function (e) {
      _hgTouchT = Date.now();
      if (e.touches.length === 2 && _hgPinchD > 0) {
        var d2 = _hgTouchDist(e);
        if (d2 > 0) {
          dist *= _hgPinchD / d2;
          if (dist < 4.5) dist = 4.5;
          if (dist > 13.75) dist = 13.75;
          _hgPinchD = d2;
          lastUserInteractTime = Date.now();
        }
        if (e.cancelable) e.preventDefault();   // 阻止浏览器页面缩放
        return;
      }
      if (e.touches.length === 1 && isDragging) {
        onMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: false });

    canvas.addEventListener('touchend', function (e) {
      _hgTouchT = Date.now();
      if (e.touches.length < 2) _hgPinchD = 0;
      if (e.touches.length > 0) {               // 仍有手指:以剩余手指为新拖动起点,不触发点击
        if (e.touches.length === 1) { onDown(e.touches[0].clientX, e.touches[0].clientY); dragMoved = true; }
        return;
      }
      if (isDragging) {
        onUp(e.changedTouches ? e.changedTouches[0] : null);
      }
    });
    canvas.addEventListener('touchcancel', function () {
      _hgTouchT = Date.now();
      _hgPinchD = 0;
      isDragging = false;
    });

    // 绑定装甲测定情报卡关闭按钮
    var tipCloseBtn = document.getElementById('hangar-atip-close');
    if (tipCloseBtn) {
      tipCloseBtn.onclick = function (e) {
        e.stopPropagation();
        if (typeof playUISound === 'function') playUISound('gear');
        clearArmorHl();
      };
    }

    // 重点修复 2: 绑定载具抽屉与切换事件，切换载具时播放与抽屉按钮完全一致的音效 playUISound('gear')
    var drawer = document.getElementById('hangar-drawer');
    var drawerToggle = document.getElementById('hangar-drawer-toggle');
    var drawerClose = document.getElementById('hangar-drawer-close');

    if (drawerToggle && drawer) {
      drawerToggle.onclick = function (e) {
        e.stopPropagation();
        if (typeof playUISound === 'function') playUISound('gear');
        drawer.classList.toggle('collapsed');
      };
    }
    if (drawerClose && drawer) {
      drawerClose.onclick = function (e) {
        e.stopPropagation();
        if (typeof playUISound === 'function') playUISound('gear');
        drawer.classList.add('collapsed');
      };
    }

    var levelDrawer = document.getElementById('hangar-tech-drawer');
    var levelDrawerToggle = document.getElementById('hangar-tech-drawer-toggle');
    var levelDrawerClose = document.getElementById('hangar-tech-drawer-close');
    var levelTree = document.getElementById('hangar-tech-tree');
    if (levelTree) {
      levelTree.onclick = function (e) {
        var node = e.target;
        while (node && node !== levelTree && !node.getAttribute('data-tech-id')) node = node.parentNode;
        if (!node || node === levelTree) return;
        var tm = levelTree.getAttribute('data-tech-tree-team') || 'red';
        var kd = levelTree.getAttribute('data-tech-tree-kind') || 'tank';
        var techId = node.getAttribute('data-tech-id');
        var action = e.target;
        while (action && action !== node && action.getAttribute && !action.getAttribute('data-tech-action')) action = action.parentNode;
        var result;
        if (action && action !== node && action.getAttribute('data-tech-action') === 'true' && window.VehicleTech && typeof window.VehicleTech.unlockAndInstall === 'function' && node.getAttribute('data-tech-unlocked') !== 'true') {
          result = window.VehicleTech.unlockAndInstall(tm, kd, techId);
          if (!result.ok && typeof aimHint === 'function') aimHint(result.reason === 'INSUFFICIENT_EXPERIENCE' ? 'NEED ' + result.required + ' XP' : 'UNLOCK FAILED');
        } else if (window.VehicleTech && typeof window.VehicleTech.toggle === 'function' && node.getAttribute('data-tech-unlocked') === 'true') {
          result = window.VehicleTech.toggle(tm, kd, techId);
        } else {
          return;
        }
        if (!result || !result.ok) return;
        if (typeof playUISound === 'function') playUISound('gear');
        if (typeof vehicleTechApplyToTank === 'function' && typeof player !== 'undefined' && player) {
          vehicleTechApplyToTank(player);
          if (typeof playerEquipSync === 'function') playerEquipSync();
        }
        if (typeof vehicleTechApplyToTank === 'function' && curTankObj && curTankObj._techPreview && curTeam === tm && curKind === kd) vehicleTechApplyToTank(curTankObj);
        refreshVehicleLevelDrawer(tm, kd);
        if (typeof window.vehicleTechRefreshUI === 'function') window.vehicleTechRefreshUI();
        var techData = (VEH_DATA[tm] && VEH_DATA[tm][kd]) || VEH_DATA.red.tank;
        updateUI(techData, tm, kd);
      };
    }
    if (levelDrawerToggle && levelDrawer) {
      levelDrawerToggle.onclick = function (e) {
        e.stopPropagation();
        if (typeof playUISound === 'function') playUISound('gear');
        levelDrawer.classList.toggle('collapsed');
        levelDrawerToggle.setAttribute('aria-expanded', levelDrawer.classList.contains('collapsed') ? 'false' : 'true');
      };
    }
    if (levelDrawerClose && levelDrawer) {
      levelDrawerClose.onclick = function (e) {
        e.stopPropagation();
        if (typeof playUISound === 'function') playUISound('gear');
        levelDrawer.classList.add('collapsed');
        if (levelDrawerToggle) levelDrawerToggle.setAttribute('aria-expanded', 'false');
      };
    }

    var drawerItems = document.querySelectorAll('#hangar-veh-list .mm-drawer-item');
    drawerItems.forEach(function (it) {
      it.onclick = function (e) {
        e.stopPropagation();
        if (typeof playUISound === 'function') playUISound('gear');
        var tm = it.getAttribute('data-team') || 'red';
        var kd = it.getAttribute('data-kind') || 'tank';
        setVehicle(tm, kd);
        window.startSide = tm;
        window.startKind = kd;
        if (typeof startSide !== 'undefined') startSide = tm;
        if (typeof startKind !== 'undefined') startKind = kd;
      };
    });

    // 绑定顶部工具条
    var btnRotate = document.getElementById('hangar-btn-rotate');
    if (btnRotate) {
      btnRotate.onclick = function () {
        if (typeof playUISound === 'function') playUISound('gear');
        autoRotate = !autoRotate;
        btnRotate.classList.toggle('active', autoRotate);
      };
    }

    var btnReset = document.getElementById('hangar-btn-reset');
    if (btnReset) {
      btnReset.onclick = function () {
        if (typeof playUISound === 'function') playUISound('gear');
        var isHeli = (curKind === 'wz10' || curKind === 'ah64');
        dist = isHeli ? 12.8 : 10.5;
        yaw = 0.65;
        pitch = 0.28;
        targetCenter.set(0, isHeli ? 1.6 : 1.05, 0);
      };
    }

    var btnInspect = document.getElementById('hangar-btn-inspect');
    if (btnInspect) {
      btnInspect.onclick = function () {
        if (typeof playUISound === 'function') playUISound('gear');
        toggleInspectMode();
      };
    }

    window.addEventListener('resize', resize);
  }

  /* ===== 模型质量档适配(T2-2):车库是第三个活跃 GL 上下文,按模型质量档降配;桌面高档逐参数不变 ----
     · antialias:与炮塔 HUD 同一开关(modAA),低/中档关掉 MSAA 4×(全屏小画布,收益直接);
     · 像素比:modPR(高 2 / 中 1.5 / 低 1.0);
     · 阴影:高档 2048²+PCFSoft;中/低档 1024²+PCF。
     ★2026-09-13:由模型质量档驱动(原取 GFX.hudAA/maxPixelRatio,三档行为逐位不变)。
     进对局(pause)时把阴影贴图降到 512 并 dispose 释放显存——rAF 已停,这段时间本来就不渲染;
     回车库(resume)恢复档位尺寸。GL 资源不释放的话,一张 2048² 阴影贴图+整个机库几何/纹理
     会全程占着显存(本项目 MainActivity 已因渲染进程 OOM 做过重建兜底,说明真发生过)。 ==== */
  var _hgLow = modQ('modAA', true) === false;
  var _hgShadowSize = modQ('modShadow', 2048);
  var _hgTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.matchMedia && matchMedia('(pointer:coarse)').matches);
  if (_hgTouch) { _hgShadowSize = Math.min(_hgShadowSize, 1024); }
  var _hgShadowDropped = false;
  function hgShadowApply(size) {
    if (!dirLight || !dirLight.shadow) return;
    dirLight.shadow.mapSize.set(size, size);
    if (dirLight.shadow.map) {          // 已建贴图才需要释放;置 null 后下次渲染按新尺寸自动重建
      dirLight.shadow.map.dispose();
      dirLight.shadow.map = null;
    }
  }

  function init() {
    canvas = document.getElementById('hangar-canvas');
    if (!canvas) return;

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      try { if (!sessionStorage.getItem('acHgLost')) { sessionStorage.setItem('acHgLost', '1'); location.reload(); return; } } catch (_) {}
      if (window.__acDiag) window.__acDiag('车库WebGL上下文丢失(GPU内存不足)');
    }, false);
    var _hgOpt = { canvas: canvas, antialias: !_hgLow && !_hgTouch, alpha: true };
    if (!_hgTouch) _hgOpt.powerPreference = 'high-performance';
    try { renderer = new THREE.WebGLRenderer(_hgOpt); }
    catch (err) { if (window.__acDiag) window.__acDiag('车库WebGL创建失败: ' + (err && err.message)); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, _hgTouch ? 1.5 : modQ('modPR', 2)));
    setTimeout(function () { try { sessionStorage.removeItem('acHgLost'); } catch (_) {} }, 15000);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = modQ('modShadowSoft', true) ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (typeof vehMaskSetMode === 'function') vehMaskSetMode(false);   // 车库直渲:载具材质 alpha 归 1

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 300);

    // 场景灯光组 (各光源强度均精准降低 15%，光影更具战场质感)
    lightsGroup = new THREE.Group();
    var ambLight = new THREE.AmbientLight(0xffffff, 0.58);
    lightsGroup.add(ambLight);

    dirLight = new THREE.DirectionalLight(0xfffaed, 0.98);
    dirLight.position.set(10, 20, 14);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = _hgShadowSize;    // 高档 2048(原值) / 中低档 1024
    dirLight.shadow.mapSize.height = _hgShadowSize;
    dirLight.shadow.camera.near = 1.0;
    dirLight.shadow.camera.far = 60.0;
    var d = 14;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0005;
    dirLight.shadow.normalBias = 0.02;
    dirLight.target.position.set(0, 0.2, 0);
    scene.add(dirLight.target);
    lightsGroup.add(dirLight);

    var fillLight = new THREE.DirectionalLight(0x7ea0c0, 0.34);
    fillLight.position.set(-15, 12, -12);
    lightsGroup.add(fillLight);

    var floorPoint = new THREE.PointLight(0xffcb44, 0.68, 15);
    floorPoint.position.set(0, 0.6, 0);
    lightsGroup.add(floorPoint);

    scene.add(lightsGroup);

    applyHangarPresentation();
    var initialVeh = loadGarageSelection();
    setVehicle(initialVeh.team, initialVeh.kind);

    bindInput();
    resize();

    running = true;
    render();
    if (typeof window._finishBootLoader === 'function') window._finishBootLoader();
  }

  function pause() {
    running = false;
    if (typeof vehMaskSetMode === 'function') vehMaskSetMode(true);   // 离开车库进对局:切回 0.62 掩码
    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }
    // T2-2 温和版:进对局释放 1024² 阴影贴图、改按 512² 预留(仅中/低档;高档零改动)
    if (_hgLow && !_hgShadowDropped) { hgShadowApply(512); _hgShadowDropped = true; }
  }

  function resume() {
    if (!running) {
      running = true;
      if (typeof vehMaskSetMode === 'function') vehMaskSetMode(false);   // 回车库:alpha 归 1
      lastUserInteractTime = Date.now();
      if (_hgShadowDropped) { hgShadowApply(_hgShadowSize); _hgShadowDropped = false; }  // 恢复档位阴影尺寸
      resize();
      render();
    }
  }

  return {
    init: init,
    pause: pause,
    resume: resume,
    setVehicle: setVehicle,
    refreshTechUI: function () { refreshVehicleLevelDrawer(curTeam, curKind); },
    refreshExperienceBadge: refreshVehicleExperienceBadge,
    getSelection: function () { return { team: curTeam, kind: curKind }; },
    toggleInspectMode: toggleInspectMode
  };
})();
window.Hangar3D = Hangar3D;
window.vehicleTechRefreshUI = function () {
  if (window.Hangar3D && typeof window.Hangar3D.refreshTechUI === 'function') window.Hangar3D.refreshTechUI();
};
if (typeof Hangar3D !== 'undefined' && Hangar3D.init) {
  setTimeout(function () { Hangar3D.init(); }, 100);
}
/* The menu clock is registered once. */
})();

