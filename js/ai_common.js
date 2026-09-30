
/* ===== Module: ai_common.js ===== */
/* ============================================================
   模块: ai_common.js — ai 通用工具(空间桶网格/邻域收集)
   (本模块通用部分,须先于 ai.js 加载;加载顺序由 index.html MODULES 表决定)
   ============================================================ */
'use strict';

var AI_GRID_CELL = 100;

var aiGrid = new Map(), aiGridT = -99;

var aiTeamRoster = { red: [], blue: [] };

var _aiGridScratch = [];

var _crowdScratch = [], _proxScratch = [];   // 局部邻域查询复用 scratch(collectAiNearby 就地清空,零分配)

function aiGridKey(x, z) { return Math.floor(x / AI_GRID_CELL) * 4096 + Math.floor(z / AI_GRID_CELL); }

function updateAiGrid() {
  if (gameT - aiGridT < 0.25) return;
  aiGridT = gameT; aiGrid.clear();
  aiTeamRoster.red.length = 0; aiTeamRoster.blue.length = 0;
  for (var i = 0; i < aliveList.length; i++) {
    var t = aliveList[i], k = aiGridKey(t.group.position.x, t.group.position.z);
    if (isFfaMode()) {
      // 保留两个数组作为旧 AI 接口的兼容视图；个人死斗的敌我判定由 areHostile 统一完成。
      aiTeamRoster.red.push(t); aiTeamRoster.blue.push(t);
    } else {
      aiTeamRoster[t.team].push(t);
    }
    t._aiCellKey = k;
    var a = aiGrid.get(k); if (!a) { a = []; aiGrid.set(k, a); } a.push(t);
  }
}

function collectAiNearby(x, z, radius, out) {
  out.length = 0;
  var n = Math.ceil(radius / AI_GRID_CELL), cx = Math.floor(x / AI_GRID_CELL), cz = Math.floor(z / AI_GRID_CELL);
  for (var ix = cx - n; ix <= cx + n; ix++) for (var iz = cz - n; iz <= cz + n; iz++) {
    var a = aiGrid.get(ix * 4096 + iz);
    if (!a) continue;
    for (var j = 0; j < a.length; j++) out.push(a[j]);
  }
  return out;
}

