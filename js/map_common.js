
/* ===== Module: map_common.js ===== */
/* ============================================================
   模块: map_common.js — map 通用工具(DOM transform 去抖/确定性值噪声/粒子系统构造)
   (本模块通用部分,须先于 map.js 加载;加载顺序由 index.html MODULES 表决定)
   ============================================================ */
'use strict';
function domTF(el, s) {                                     // 逐帧 transform 去抖:toFixed 串没变就不写 style
  if (el._lastTF !== s) { el._lastTF = s; el.style.transform = s; }
}

function hillHash(i, j) {                                  // 确定性格点哈希(独立于战斗随机流)
  var s = Math.sin(i * 127.1 + j * 311.7 + 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function hillNoise(x, z, cs) {                             // 双线性平滑值噪声,格距 cs m
  var fx = x / cs, fz = z / cs, ix = Math.floor(fx), iz = Math.floor(fz);
  var tx = fx - ix, tz = fz - iz;
  tx = tx * tx * (3 - 2 * tx); tz = tz * (3 - 2 * tz);
  var a = hillHash(ix, iz), b = hillHash(ix + 1, iz), c2 = hillHash(ix, iz + 1), d2 = hillHash(ix + 1, iz + 1);
  return a + (b - a) * tx + (c2 - a) * tz + (a - b - c2 + d2) * tx * tz;
}

function hillSstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

