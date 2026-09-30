
/* ===== Module: audio_common.js ===== */
/* ============================================================
   模块: audio_common.js — audio 通用工具(独立 RNG/噪声播放/DSP 基元)
   (本模块通用部分,须先于 audio.js 加载;加载顺序由 index.html MODULES 表决定)
   ============================================================ */
'use strict';
var sfxRnd = mulberry32(0x51F02);            // 音频独立种子:每发射速微扰/噪声烘焙不占战斗 RNG 流

function playNoise(dur, freq, gain, type, sweepTo, dest) {
  if (!AC) return;
  var t = AC.currentTime;
  var src = AC.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  var f = AC.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.setValueAtTime(freq, t); f.Q.value = 0.8;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
  var g = AC.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(dest || masterGain);
  src.start(t); src.stop(t + dur + 0.05);
}

/* 烘焙收尾统一闸(炮/箭/着弹/爆/发动机 5 类烘焙共用本单一实现,逐样本逐位语义不变):
   ① 全缓冲 tanh(sat·x) 软削并记峰值 ② 归一增益 outPeak/peak ③ fadeS>0 时末 fadeS 秒线性压到零(杜绝缓冲边界咔哒);
   发动机循环 fadeS=0(无缝循环严禁收尾,否则循环缝咔哒)。 */
function satNormTail(d, sr, sat, outPeak, fadeS) {
  var n = d.length, peak = 0, i, y, a;
  for (i = 0; i < n; i++) { y = Math.tanh(sat * d[i]); d[i] = y; a = y < 0 ? -y : y; if (a > peak) peak = a; }
  var g = outPeak / (peak || 1), fN = fadeS > 0 ? (sr * fadeS) | 0 : 0;
  for (i = 0; i < n; i++) d[i] *= g * (fN && i > n - fN ? (n - i) / fN : 1);
}

/* 一阶低通步进(系数 = 1-exp(-2πfc/sr),fc<20 钉 20 防零系数;着弹/爆炸烘焙共用本实现) */
function lpStep(sr, state, w, fc) { return state + (1 - Math.exp(-6.283185307179586 * Math.max(20, fc) / sr)) * (w - state); }

/* 地形反射抽头回灌:干声首 dryLen 样本一阶低通 → 按 taps[[dt,g,fc]...] 延时叠回(主炮×3/爆炸×2 共用本实现;逐位语义不变) */
function echoTaps(d, sr, taps, dryLen) {
  var n = d.length;
  for (var q = 0; q < taps.length; q++) {
    var st = (taps[q][0] * sr) | 0, gq = taps[q][1], aE = 1 - Math.exp(-6.283185307179586 * taps[q][2] / sr), lpE = 0;
    var lim = Math.min(dryLen, n - st);
    for (var k = 0; k < lim; k++) { lpE += aE * (d[k] - lpE); d[st + k] += lpE * gq; }
  }
}

