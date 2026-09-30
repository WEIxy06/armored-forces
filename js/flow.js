/* ============================================================
   模块: flow.js — 流程:会战胜负/兵力/输入处理
   (加载顺序由 index.html MODULES 表决定,勿单独调整)
   ============================================================ */
'use strict';
/* ============================================================
   会战流程
   ============================================================ */
// 出生点空位搜索:大本营周围环形扫描,避开活车 / 残骸(残骸不消除,绝不能叠放)
function findSpawnSpot(hx, hz) {
  var i;
  var gate = (typeof spawnSlopeOK === 'function');   // D2 坡度门(方案 §7.3);ai_nav 未加载时退化为旧行为
  var bx = hx, bz = hz, bs = 1e9, hasBest = false;
  for (var ring = 0; ring < 9; ring++) {
    for (var k = 0; k < 10; k++) {
      var a = k / 10 * TAU, rr = 2 + ring * 3.5;
      if (rr < 16) continue;                 // 出生点避开营盘(半径14.7)及其下坡,部署在坡外
      var nx = hx + Math.sin(a) * rr, nz = hz + Math.cos(a) * rr;
      var B = CONF.bounds - 6;
      if (nx < -B || nx > B || nz < -B || nz > B) continue;
      var ok = true;
      for (i = 0; i < tanks.length && ok; i++) {
        var w = tanks[i];
        if (Math.hypot(nx - w.group.position.x, nz - w.group.position.z) < w.radius + 3.4) ok = false;
      }
      if (!ok) continue;
      if (gate) {                            // D2:超标跳过,同时记录最小坡度候选做兜底
        var sl = (typeof navSlopeAt === 'function') ? navSlopeAt(nx, nz) : 0;
        if (sl < bs) { bs = sl; bx = nx; bz = nz; hasBest = true; }
        if (!spawnSlopeOK(nx, nz)) continue;
      }
      return { x: nx, z: nz };
    }
  }
  if (hasBest) return { x: bx, z: bz };      // 9 环全超标:取坡度最小者(恒优于旧"中心硬落")
  return { x: hx, z: hz };                          // 兜底:中心(会被碰撞系统推开)
}
// 在大本营重新部署一辆相同载具 —— 每次消耗 1 点兵力
// 通用化:车型参数全部来自 VEHICLE_KINDS 注册表条目(spawnName 出厂名/aiAnchor 原地锚定),新增型号零改动自动生效
function redeployVehicle(team, kind) {
  var hq = hqFind(team, kind, hqRandWing());          // 兵种定纵深,翼位随机 —— AI 每次从左/中/右三选一涌出
  if (!hq) return;
  var spot = findSpawnSpot(hq.x, hq.z);
  var yaw = hq.yaw + rand(-0.15, 0.15);
  var vk = vehicleKindEntry(kind) || vehicleKindEntry('tank');   // 未知槽位兜底坦克(与旧 else 分支等价)
  var nt = createTank({ kind: vk.kind, team: team, x: spot.x, z: spot.z, yaw: yaw,
    name: (vk.spawnName && (vk.spawnName[team] || vk.spawnName.red)) || vehicleKindName(team, vk.kind) });
  nt.reload = 0;                                      // 重部署载具初始装填完成(原各分支共有)
  if (vk.aiAnchor) {                                  // 曲射平台(火箭炮):部署后锚定原地,不前压
    nt.ai.anchorX = spot.x; nt.ai.homeZ = spot.z;
    nt.ai.destX = spot.x; nt.ai.destZ = spot.z;
  }
  rebuildTargets();                                   // 新模块网格纳入命中宽相位
  var p = nt.group.position.clone(); p.y += 1.2;
  if (typeof comicGroundDust === 'function') comicGroundDust(p.x, p.y, p.z, false);   // 部署到位的一阵尘土(漫画扬尘卡)
  return nt;
}
// 消耗战结算:处理到期的重新部署;兵力先耗光的一方立即战败
function processRespawns() {
  if (gameState !== 'playing') return;
  for (var i = respawnQueue.length - 1; i >= 0; i--) {
    var rq = respawnQueue[i];
    if (rq.due > gameT) continue;
    respawnQueue.splice(i, 1);
    if (teamPool[rq.team] <= 0) continue;             // 兵力已耗光(败局已定时不再出兵)
    if (countTeamWithinCap(rq.team) >= BATTLE_SETUP[rq.team].cap) continue;   // 战略支援不占用最大在场编制
    teamPool[rq.team]--;
    redeployVehicle(rq.team, rq.kind);
    // 兵力见底不在此判负:需要 兵力=0 且 场上无存活载具(见 battleCheck);顶部兵力计数恒显,不做文字播报
  }
}

function ffaAliveCount() {
  var n = 0;
  for (var i = 0; i < aliveList.length; i++) if (aliveList[i] && aliveList[i].alive) n++;
  return n;
}
function ffaPlayerRank() {
  if (ffaState.finalRank > 0) return ffaState.finalRank;
  var n = ffaAliveCount();
  return player && player.alive ? 1 : n + 1;
}
// 判负条件:兵力耗尽 且 场上无存活载具
function teamDefeated(team) {
  // 无"在途增援等待"——兵力=0 时队列条目永不可能出兵(processRespawns 无兵力不部署),
  //   故存活载具归零即判负(若等条目到期,火箭炮条目 due+24s 会造成归零后久不结算),
  // 由 battleCheck 的 2s 宽限倒计时收尾(归零后 3s 内结算完成)
  return teamPool[team] <= 0 && countTeam(team) === 0;
}
var battleEndT = -1;                                // 败局已定后的结算倒计时
function battleCheck() {
  if (gameState !== 'playing' || freePlay) return;   // 继续游玩(freePlay)期间不判胜负
  if (isFfaMode()) {
    var liveFfa = ffaAliveCount();
    if (typeof SPECTATE_MATCH !== 'undefined' && SPECTATE_MATCH) {   // 观战:仅剩最后一台即结算
      if (liveFfa <= 1) gameOver(true, 'LAST SURVIVOR');
      return;
    }
    if (player && player.alive) {
      if (liveFfa <= 1) gameOver(true, 'LAST SURVIVOR');
    } else if (liveFfa === 0 || (ffaState.playerEliminated && liveFfa <= 1)) {
      gameOver(false, 'ELIMINATED');
    }
    return;
  }
  var pLose = teamDefeated(pSide()), eLose = teamDefeated(oSide());   // 胜/负按玩家队视角
  if (!pLose && !eLose) return;
  if (battleEndT < 0) battleEndT = gameT + 2;        // 条件首次成立 → 2s 宽限(留最后一击爆炸收场,满足 ≤3s 军令)
  if (gameT < battleEndT) return;
  battleEndT = -1;
  if (pLose && eLose) gameOver(true, 'MUTUAL KILL');
  else if (eLose) gameOver(true);
  else gameOver(false, 'OUT OF FORCES');
}

function gameOver(win, cause) {
  gameState = 'over';
  try {
    if (typeof window !== 'undefined' && typeof window.vehicleTechSettleMatch === 'function') window.vehicleTechSettleMatch(!!win, typeof kills === 'number' ? kills : 0);
    if (typeof window !== 'undefined') {
      window._vehicleTechMatchEnded = true;
      window._vehicleTechMatchWin = !!win;
      if (typeof window.vehicleTechRefreshUI === 'function') window.vehicleTechRefreshUI();
    }
  } catch (eVehicleXp) {}
  // 对局统计在结算入口一次性提交；本局内只存在 Achievements 的内存暂存区。
  try {
    if (window.Achievements && typeof window.Achievements.commitMatch === 'function') window.Achievements.commitMatch();
  } catch (eAchEnd) {}
  if (window.CrazyGamesAdapter) {
    window.CrazyGamesAdapter.gameplayStop();
    if (win) window.CrazyGamesAdapter.happytime();
  }
  if (typeof window !== 'undefined' && window._touchUISync) window._touchUISync();   // 触控层即时收起
  document.exitPointerLock && document.exitPointerLock();
  hideRespawnUI();
  hidePossessOv();
  updateLockHint();
  el.endov.classList.remove('hidden');
  if (el.continuebtn) el.continuebtn.classList.toggle('hidden', !win);   // 仅胜利显示"继续游戏"(失败/弹尽粮绝无此按钮)
  if (el.airSupportBtn) el.airSupportBtn.classList.toggle('hidden', isFfaMode() || !!win); // 个人死斗不提供团队空中增援
  el.reds.textContent = countTeam('red');
  el.blues.textContent = countTeam('blue');
  if (typeof lwrMawsReset === 'function') lwrMawsReset();   // 告警层兜底清(修 LWR 胜利卡红)
}

/* 旗杆稳定线(远距细杆抗闪烁;机理与修法同载具天线稳定线,见 comic.js):
   杆半径 0.09~0.13m,几十米外宽度小于 1 纹素,光栅化覆盖逐帧跳变=闪烁,描边放大观感;
   全部旗杆并入 ONE LineSegments(GL 线恒 1px 光栅化,任何距离不消失),随场景进 RT
   自然遮挡/受雾;原几何杆近距被自身像素覆盖。静态件:开局登记 6 段,
   弹坑重锚(redrape)单段更新,零逐帧。 */
var _poleSegs = [], _poleLine = null, _poleMat = null;
function poleLineReg(x, y0, z, y1) {             // 登记一根杆,返回段号(redrape 更新用)
  _poleSegs.push(x, y0, z, x, y1, z);
  poleLineSync();
  return _poleSegs.length / 6 - 1;
}
function poleLineSet(i, y0, y1) {                // 弹坑重锚:仅两端高度变化
  var o = i * 6;
  _poleSegs[o + 1] = y0; _poleSegs[o + 4] = y1;
  poleLineSync();
}
function poleLineSync() {                        // 段数 ≤6,整表重建=事件级一次性,成本可忽略
  if (_poleLine) { scene.remove(_poleLine); _poleLine.geometry.dispose(); }
  var pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(_poleSegs), 3));
  if (!_poleMat) _poleMat = new THREE.LineBasicMaterial({ color: 0x6a6a62 });   // 杆身同色
  _poleLine = new THREE.LineSegments(pg, _poleMat);
  _poleLine.frustumCulled = false;
  _poleLine.matrixAutoUpdate = false;
  scene.add(_poleLine);
}
// 大本营:夷平地面 + 高龄旗杆(顶点飘扬军旗)
// ★防穿模:营盘/标线环逐顶点按世界坐标采样 terrainH「披布」贴地;旗杆中心采样并嵌入少许
/* 大本营静态部件(旗杆/顶球)的几何与材质跨全部基地共享:每座各建一份的话,
   18 座 = 72 个材质对象、几十个重复几何,白占显存又拆批。旗面几何必须逐座独立
   (顶点被逐帧改写),但旗面材质只是纯色,按阵营两份即可。待命环材质逐座独立(脉动相位不同)。 */
var _hqGeoCache = null, _hqFlagMat = {};
function hqSharedGeo() {
  if (!_hqGeoCache) _hqGeoCache = {
    pole: new THREE.CylinderGeometry(0.09, 0.13, 14, 8),
    finial: new THREE.SphereGeometry(0.16, 8, 6),
    poleMat: new THREE.MeshStandardMaterial({ color: 0x6a6a62, roughness: 0.55, metalness: 0.35 }),
    finialMat: new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: 0.4, metalness: 0.6 })
  };
  return _hqGeoCache;
}
function buildHQ(team, x, z, yaw, type, wing) {
  var g = new THREE.Group();
  var SG = hqSharedGeo();
  var gy = terrainH(x, z);                             // 夷平后的基准高
  var fc = team === 'red' ? 0xff6a5a : 0x7ab0ff;                // 旗面/顶球:红蓝对抗标识
  var cyw = Math.cos(yaw), syw = Math.sin(yaw);
  function drape(posA, off) {                          // 顶点:组局部 → 世界采样 → 贴地(+抬升)回写局部 y
    for (var i = 0; i < posA.count; i++) {
      var lx = posA.getX(i), lz = posA.getZ(i);
      var wx = x + lx * cyw + lz * syw, wz = z - lx * syw + lz * cyw;
      posA.setY(i, terrainH(wx, wz) - gy + off);
    }
  }
  /* ===== 14m 高龄旗杆(嵌入 0.4m 锚固) ===== */
  var pole = new THREE.Mesh(SG.pole, SG.poleMat);
  pole.position.set(0, 14 / 2 - 0.4, 0); pole.castShadow = true; g.add(pole);
  var poleIdx = poleLineReg(x, gy - 0.4, z, gy + 13.6);   // 稳定线登记(世界系;redrape 时单段更新)
  var finial = new THREE.Mesh(SG.finial, SG.finialMat);
  finial.position.set(0, 13.68, 0); g.add(finial);
  /* ===== 军旗:顶点波动阔旗(旗杆端静止 → 自由端大摆) ===== */
  var flagW = 2.4;
  var flagGeo = new THREE.PlaneGeometry(flagW * 2, 1.9, 10, 4);
  if (!_hqFlagMat[team]) _hqFlagMat[team] = new THREE.MeshBasicMaterial({
    color: fc, side: THREE.DoubleSide, depthTest: true, depthWrite: false, fog: true
  });
  var flag = new THREE.Mesh(flagGeo, _hqFlagMat[team]);   // 几何逐座独立(顶点动画),材质按阵营两份
  flag.position.set(flagW + 0.12, 12.55, 0);             // 旗根贴着杆顶
  flag.frustumCulled = false;
  flag.renderOrder = 20;
  flag.castShadow = true; g.add(flag);
  /* 营盘/旗杆/待命环保留 */
  /* ===== 待命区标线(直接悬于夷平地面上方 6cm;脉动提示 redeploy 点;随夷平区放大 r7.6~8.5) ===== */
  var ringGeo = new THREE.RingGeometry(7.6, 8.5, 36, 1);
  ringGeo.rotateX(-Math.PI / 2);
  drape(ringGeo.attributes.position, 0.15);
  var ringMat = new THREE.MeshBasicMaterial({ color: fc, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
  var ringM = new THREE.Mesh(ringGeo, ringMat);
  g.add(ringM);
  g.position.set(x, gy, z);
  g.rotation.y = yaw;
  scene.add(g);
  /* ===== 再锚固闭包:弹坑改变地形后全部件跟随新地面 —— 永久零穿模承诺 ===== */
  function redrape() {
    drape(ringGeo.attributes.position, 0.15);
    ringGeo.attributes.position.needsUpdate = true;
    var pb = terrainH(x, z) - gy - 0.4;                  // 杆脚随地形重嵌入 0.4m,顶球/军旗同步
    pole.position.y = pb + 7;
    finial.position.y = pb + 14.08;
    flag.position.y = pb + 12.95;
    poleLineSet(poleIdx, gy + pb, gy + pb + 14);         // 稳定线同步重锚
  }
  hqBoundsAdd(x, z);                                   // 地形保护包围盒扩张(getHQZoneDeformFactor 早退用)
  hqList[team].push({ type: type || 'tank', wing: wing | 0, x: x, z: z, yaw: yaw, flag: flag, ring: ringM, redrape: redrape,
    grp: g, flagGeo: flagGeo, ringGeo: ringGeo, ringMat: ringMat,
    flagBase: Float32Array.from(flagGeo.attributes.position.array), flagW: flagW, phase: ((x * 0.37 + z * 0.11) % TAU + TAU) % TAU });
}

/* 兵种 → 大本营类型映射: 火箭炮=炮兵大本营, ah64/wz10=直升机大本营, 其余(坦克/歼击车/99/自定义蓝图)归坦克大本营 */
function hqTypeOfKind(kind) {
  if (kind === 'arty') return 'arty';
  if (kind === 'aa') return 'tank';   // 防空载具随战车大本营纵深部署(要点防空,靠前)
  if (kind === 'ah64' || kind === 'wz10') return 'heli';
  return 'tank';
}

/* 个人死斗可用载具：外观阵营只决定型号/涂装，不参与敌我判定。
   直升机由快速入口/自定义设置显式控制，默认关闭。 */
function ffaAllowHelicopters() {
  /* TO BATTLE and custom FFA use the same gate everywhere: the menu, initial
     roster, respawn choices, and the actual redeploy validator must not drift. */
  return !ffaQuickStart && !!FFA_SETUP.heliEnabled;
}
function ffaVehicleOptions(allowHeli) {
  var out = [];
  for (var i = 0; i < VEHICLE_KINDS.length; i++) {
    var vk = VEHICLE_KINDS[i];
    for (var ti = 0; ti < 2; ti++) {
      var tm = ti ? 'blue' : 'red';
      if (!vehicleKindAllowed(tm, vk.kind)) continue;
      if (!allowHeli && (vk.kind === 'ah64' || vk.kind === 'wz10')) continue;
      out.push({ team: tm, kind: vk.kind });
    }
  }
  return out;
}
function ffaCurrentVehicleOptions() {
  return ffaVehicleOptions(ffaAllowHelicopters());
}

/* FFA AI/非玩家载具的随机编成权重：
   防空车 15%，火箭炮 10%，直升机 10%；其余登记的地面型号平分剩余权重。
   直升机关闭时从活动选项中重新归一化，保证仍能生成满额总载具数。 */
var FFA_KIND_WEIGHTS = {
  aa: 15,
  arty: 10,
  ah64: 5,
  wz10: 5,
  tank: 65 / 3,
  '99': 65 / 3,
  td: 65 / 3
};
function ffaRandomVehicleOption(allowHeli) {
  var weighted = [], totalW = 0, i, ti, tm, vk, w;
  for (i = 0; i < VEHICLE_KINDS.length; i++) {
    vk = VEHICLE_KINDS[i];
    if (!allowHeli && (vk.kind === 'ah64' || vk.kind === 'wz10')) continue;
    w = FFA_KIND_WEIGHTS[vk.kind];
    if (!(w > 0)) w = 1;  // 新登记地面型号仍可生成，避免扩展注册表后被随机编成遗漏
    var sideCount = 0;
    for (ti = 0; ti < 2; ti++) {
      tm = ti ? 'blue' : 'red';
      if (!vk.sides || vk.sides[tm]) sideCount++;
    }
    if (!sideCount) continue;
    for (ti = 0; ti < 2; ti++) {
      tm = ti ? 'blue' : 'red';
      if (vk.sides && !vk.sides[tm]) continue;
      weighted.push({ team: tm, kind: vk.kind, weight: w / sideCount });
      totalW += w / sideCount;
    }
  }
  if (!weighted.length) return { team: 'red', kind: 'tank' };
  var pick = Math.random() * totalW;
  for (i = 0; i < weighted.length; i++) {
    pick -= weighted[i].weight;
    if (pick < 0) return { team: weighted[i].team, kind: weighted[i].kind };
  }
  return { team: weighted[weighted.length - 1].team, kind: weighted[weighted.length - 1].kind };
}
function ffaSpawnSpot(safeOnly) {
  var bx = Math.max(24, CONF.boundsX - 24), bz = Math.max(24, CONF.boundsZ - 24);
  var safe = safeOnly && typeof ffaSafeZoneSpawnInfo === 'function' ? ffaSafeZoneSpawnInfo({}) : null;
  var safeR = safe ? Math.max(24, safe.r - 28) : 0;
  var best = null, bestScore = -1;
  for (var tr = 0; tr < 90; tr++) {
    var x, z;
    if (safe) {
      var sa = rand(0, Math.PI * 2), sr = Math.sqrt(rand(0, 1)) * safeR;
      x = safe.cx + Math.sin(sa) * sr;
      z = safe.cz + Math.cos(sa) * sr;
      if (Math.abs(x) > bx || Math.abs(z) > bz) continue;
    } else {
      x = rand(-bx, bx); z = rand(-bz, bz);
    }
    var ok = true, minD = 1e9;
    if (typeof spawnSlopeOK === 'function' && !spawnSlopeOK(x, z)) continue;
    for (var i = 0; i < tanks.length; i++) {
      var w = tanks[i]; if (!w || !w.group) continue;
      var dx = x - w.group.position.x, dz = z - w.group.position.z;
      var d = Math.sqrt(dx * dx + dz * dz), need = (w.radius || 8) + 10;
      if (d < need) { ok = false; break; }
      if (d < minD) minD = d;
    }
    if (ok) return { x: x, z: z };
    if (minD > bestScore) { bestScore = minD; best = { x: x, z: z }; }
  }
  if (best) return best;
  if (safe) return { x: clamp(safe.cx, -bx, bx), z: clamp(safe.cz, -bz, bz) };
  return { x: 0, z: 0 };
}
function spawnFreeForAll() {
  var noPlayer = (typeof window !== 'undefined' && window.__TANK_DEBUG && window.__DBG_NO_PLAYER) || (typeof SPECTATE_MATCH !== 'undefined' && SPECTATE_MATCH);   // 观战模式=玩家席交 AI
  _poleSegs = [];
  if (_poleLine) { scene.remove(_poleLine); _poleLine.geometry.dispose(); _poleLine = null; }
  hqList.red.length = 0; hqList.blue.length = 0; MAP.hqFlat = null;
  if (typeof aaIntelReset === 'function') aaIntelReset();
  if (typeof tacBattleReset === 'function') tacBattleReset();
  if (typeof heliABGClear === 'function') heliABGClear();
  if (typeof tacGridBuild === 'function') tacGridBuild();
  if (typeof navGridBuild === 'function') navGridBuild();
  var ffaCfg = ffaQuickStart ? FFA_QUICK_DEFAULTS : FFA_SETUP;
  var allowHeli = ffaAllowHelicopters();
  var options = ffaCurrentVehicleOptions();
  if (!options.length) options = [{ team: 'red', kind: 'tank' }];
  var pTeam = startSide === 'blue' ? 'blue' : 'red';
  var pKind = startKind || 'tank';
  if (!allowHeli && (pKind === 'ah64' || pKind === 'wz10')) pKind = 'tank';
  var pOpt = null;
  for (var oi = 0; oi < options.length; oi++) if (options[oi].team === pTeam && options[oi].kind === pKind) { pOpt = options[oi]; break; }
  if (!pOpt) {
    pTeam = options[0].team; pKind = options[0].kind;
  }
  startSide = pTeam; startKind = pKind;
  window.startSide = startSide; window.startKind = startKind;
  var pSpot = ffaSpawnSpot(true);
  player = createTank({ isPlayer: !noPlayer, team: pTeam, x: pSpot.x, z: pSpot.z,
    yaw: rand(-Math.PI, Math.PI), kind: pKind === 'tank' ? undefined : pKind, name: noPlayer ? vehicleKindName(pTeam, pKind) : 'YOU' });
  respawnSel.kind = pKind; respawnSel.team = pTeam; respawnSel.wing = HQ_WING_CENTER;
  if (player) {
    player.reload = 0;
    // 个人死斗玩家每次出场都获得 3 秒出生保护(不赋予 AI；TDM 不走本分支)。
    if (!noPlayer) player._ffaSpawnInvulUntil = gameT + 3;
    if (!noPlayer) {
      playerEquipSync();
      camAimY = player.yaw + player.turretYaw; camAimP = player.gunPitch;
    }
  }
  var total = clamp(Math.round(ffaCfg.vehicleCount || 100), 2, 200);
  // player 也占用总载具数；无玩家调试模式下首辆观察席载具同样计入总数，
  // 防止 __DBG_NO_PLAYER 意外多生成一台。
  var aiN = Math.max(0, total - 1);
  for (var aiI = 0; aiI < aiN; aiI++) {
    var op = ffaRandomVehicleOption(allowHeli);
    var sp = ffaSpawnSpot();
    var at = createTank({ isPlayer: false, team: op.team, x: sp.x, z: sp.z,
      yaw: rand(-Math.PI, Math.PI), kind: op.kind === 'tank' ? undefined : op.kind,
      name: vehicleKindName(op.team, op.kind) });
    if (at) {
      at.reload = 0;
      var vkA = vehicleKindEntry(op.kind);
      if (vkA && vkA.aiAnchor) {
        at.ai.anchorX = sp.x; at.ai.homeZ = sp.z; at.ai.destX = sp.x; at.ai.destZ = sp.z;
      }
    }
  }
  teamPool.red = 0; teamPool.blue = 0; respawnQueue.length = 0;
  ffaState.reserves = noPlayer ? 0 : clamp(Math.round(ffaCfg.playerReserves || 0), 0, 50);
  ffaState.playerEliminated = false; ffaState.finalRank = 0;
  ffaState.activeAtStart = aliveList.length;
  rebuildTargets();
}
function spawnTeams() {
  if (isFfaMode()) { spawnFreeForAll(); return; }
  var i, x, z, r, c;
  _poleSegs = [];                                        // 旗杆稳定线换场重建(旧线撤除,buildHQ 逐根重登记)
  if (_poleLine) { scene.remove(_poleLine); _poleLine.geometry.dispose(); _poleLine = null; }
  // 横向与纵向布局按战场尺寸适配
  var kW = (MAP.wid || MAP.side) / 2000;
  var kL = (MAP.len || MAP.side) / 2000;
  var boundsX = (CONF.boundsX != null ? CONF.boundsX : CONF.bounds);
  var boundsZ = (CONF.boundsZ != null ? CONF.boundsZ : CONF.bounds);
  // 半场翻转(两个独立来源叠乘):__TEAM_FLIP(调试/公平随机)× startSide(菜单选边=蓝方时双方互换半场,玩家恒在南侧大本营)
  var flip = ((typeof window !== 'undefined' && window.__TEAM_FLIP) ? -1 : 1) * (startSide === 'blue' ? -1 : 1);
  spawnFlip = flip;                                    // 登记:AI 回防/集结默认 homeZ 等读取
  if (typeof aaIntelReset === 'function') aaIntelReset();   // 任务22:换局清零直升机情报层(陈旧航迹/模式不跨局)
  if (typeof tacBattleReset === 'function') tacBattleReset();   // 战术标识:换场关独立开关+收标记/描边
  if (typeof heliABGClear === 'function') heliABGClear();       // A射B导:换场清空僚机名单(旧载具即将销毁,不跨局残留)
  if (typeof tacGridBuild === 'function') tacGridBuild();
  if (typeof navGridBuild === 'function') navGridBuild();   // 寻路坡度网格:建场一次(~10ms),A* 消费       // 战术射界网格:建场一次评分(~20ms),指挥官决策期消费
  var noPlayer = (typeof window !== 'undefined' && window.__TANK_DEBUG && window.__DBG_NO_PLAYER) || (typeof SPECTATE_MATCH !== 'undefined' && SPECTATE_MATCH);   // 观战模式=玩家席交 AI // 无头纯净 AI 对局
  var aYaw = flip > 0 ? Math.PI : 0, eYaw = flip > 0 ? 0 : Math.PI;
  // 三兵种纵深与 HQ 布局:吃 MAP.hqFlat 同源布局(applyMapConfig 前移计算,与地形夷平圆心逐位一致;
  //   含 heli 坡墙上限 halfL-210,旧 baseZOf 在大图上把 heli 送上坡墙)。wonder.js 缺失时退化为零纵深(仅旧无头桩)。
  var _hqL = MAP.hqFlat || (typeof hqLayoutCompute === 'function' ? hqLayoutCompute(hqParamsFromGlobals()) : null);
  if (_hqL) MAP.hqFlat = _hqL;
  var baseZ = _hqL ? _hqL.baseZ : { tank: 0, arty: 0, heli: 0 };
  /* 行纵深助手: 基地贴边时(纵深偏移越出活动边界)向战场内侧镜像, 防止多行被边界钳制塌缩到同一 z */
  function rowZOut(zBase, hs, off) {
    var z = zBase + hs * off;
    return (Math.abs(z) > boundsZ - 16) ? (zBase - hs * off) : z;
  }
  // 玩家出生 = 所选兵种对应的大本营中心
  var pKind = vehicleKindAllowed(startSide, startKind) ? startKind : (startSide === 'red' ? '99' : 'td');
  var pZ0 = (startSide === 'red' ? baseZ[hqTypeOfKind(pKind)] : -baseZ[hqTypeOfKind(pKind)]), pYaw0 = startSide === 'red' ? aYaw : eYaw;
  player = createTank({ isPlayer: !noPlayer, team: startSide, x: 0, z: pZ0, yaw: pYaw0,
    kind: pKind === 'tank' ? undefined : pKind,
    name: noPlayer ? (startSide === 'red' ? 'RED-MBT-1' : 'BLUE-MBT-1') : 'YOU' });
  respawnSel.kind = pKind;                               // 阵亡重生默认沿用开局兵种
  respawnSel.wing = HQ_WING_CENTER;                      // 翼位复位到中央(开局落位即中轴;防跨局/上一条命的旧索引残留)
  playerEquipSync();                                     // 部署边沿:座车夜战设备缓存+触控键显隐(禁逐帧检测)
  player.reload = 0;

  camAimY = player.yaw + player.turretYaw; camAimP = player.gunPitch;   // 首刷:相机瞄向=炮口向
  // 遭遇战编制(红/蓝独立;通用化:型号数量遍历 VEHICLE_KINDS 注册表)
  var SU = BATTLE_SETUP, aR = SU.red.roster, eR = SU.blue.roster;
  // 战线编队:2 排均布,列数随坦克数量自适应(槽不足自动扩展;±330*kW 铺满战场宽度)
  function lineSlots(zBase, nTank) {
    var hs = Math.sign(zBase) || 1, slots = [], cols = Math.max(1, Math.ceil(nTank / 2));
    var gate = (typeof spawnSlopeOK === 'function');
    for (var r = 0; r < 2; r++) for (var c = 0; c < cols; c++) {
      var sx = -330 * kW + (cols > 1 ? c * (660 * kW / (cols - 1)) : 0), sz = zBase + hs * r * 20;
      if (gate) {                            // D2:槽位超标则向战场中心步进 20m 重试(≤5 次,至多让位 100m)
        for (var att = 0; att < 5 && !spawnSlopeOK(sx, sz); att++) sz -= hs * 20;
      }
      slots.push([sx, sz]);
    }
    return slots;
  }
  var grid = lineSlots(baseZ.tank, aR.tank + (aR['99'] || 0));   // 坦克大本营战线
  // 锋线最中央一格空给玩家(只剔离 (0,baseZ.tank) 最近的那一格,其余 = 我方坦克数-1 辆 AI)
  var ci = 0;
  for (i = 1; i < grid.length; i++)
    if (Math.abs(grid[i][0]) + Math.abs(grid[i][1] - baseZ.tank) <
        Math.abs(grid[ci][0]) + Math.abs(grid[ci][1] - baseZ.tank)) ci = i;
  grid.splice(ci, 1);
  var a59N = aR.tank - (pKind === '99' ? 0 : 1);
  var a99N = (aR['99'] || 0) - (pKind === '99' ? 1 : 0);
  for (i = 0; i < grid.length && (a59N > 0 || a99N > 0); i++) {
    var use99 = a59N <= 0 || (a99N > 0 && i % 2 === 1);
    if (use99) a99N--; else a59N--;
    x = clamp(grid[i][0] + rand(-4, 4), -boundsX + 16, boundsX - 16);
    z = clamp(grid[i][1] + rand(-2, 2), -boundsZ + 16, boundsZ - 16);
    var at = createTank({ isPlayer: false, team: 'red', x: x, z: z, yaw: aYaw + rand(-0.12, 0.12),
      kind: use99 ? '99' : undefined,
      struct: CONF.red.struct, name: use99 ? 'RED-MBT-2' : 'RED-MBT-1' });
    at.reload = 0;
  }
  var egrid = lineSlots(-baseZ.tank, eR.tank + (eR['99'] || 0));   // 敌方坦克大本营(镜像)
  var e59N = eR.tank, e99N = eR['99'] || 0;
  for (i = 0; i < egrid.length && (e59N > 0 || e99N > 0); i++) {
    var euse99 = e59N <= 0 || (e99N > 0 && i % 2 === 1);
    if (euse99) e99N--; else e59N--;
    x = clamp(egrid[i][0] + rand(-4, 4), -boundsX + 16, boundsX - 16);
    z = clamp(egrid[i][1] + rand(-2, 2), -boundsZ + 16, boundsZ - 16);
    var et = createTank({ isPlayer: false, team: 'blue', x: x, z: z, yaw: eYaw + rand(-0.12, 0.12),
      kind: euse99 ? '99' : undefined,
      struct: CONF.blue.struct, name: euse99 ? 'RED-MBT-2' : 'BLUE-MBT-1' });
    et.reload = 0;
  }
  // 特殊装甲编制:红方=RED-TD / 蓝方=BLUE-MBT-2
  ['red', 'blue'].forEach(function (tm) {
    var R = tm === 'red' ? aR : eR;
    var zB2 = tm === 'red' ? baseZ.tank : -baseZ.tank;
    var hs2 = Math.sign(zB2) || 1;
    var yaw2 = tm === 'red' ? aYaw : eYaw;
    for (var i3 = 0; i3 < R.td; i3++) {
      var tx = clamp(-330 * kW + (R.td > 1 ? i3 * (660 * kW / (R.td - 1)) : 0) + rand(-3, 3), -boundsX + 16, boundsX - 16);
      var tz = clamp(rowZOut(zB2, hs2, 44) + rand(-2, 2), -boundsZ + 16, boundsZ - 16);
      var td = createTank({ kind: 'td', team: tm, x: tx, z: tz, yaw: yaw2 + rand(-0.1, 0.1),
        name: tm === 'red' ? 'RED-TD' : 'BLUE-MBT-2' });
      td.reload = 0;
    }
  });
  // 防空载具(2026-09-11 修复:AI 防空车从不刷新——spawnTeams 缺 aa 编成块;用户指定部署在战车基地:
  //   坦克编队行后一排(纵深 +70m),aiAnchor 锚定防守同火箭炮范式;名称走 createTank 分阵营缺省 红方RED-AA/蓝方BLUE-AA)
  ['red', 'blue'].forEach(function (tm) {
    var R = tm === 'red' ? aR : eR;
    var nAA = Math.max(0, R.aa || 0) - (startSide === tm && pKind === 'aa' ? 1 : 0);   // 编制含玩家占位(同直升机编成块口径)
    if (nAA <= 0) return;
    var zB3 = tm === 'red' ? baseZ.tank : -baseZ.tank;
    var hs3 = Math.sign(zB3) || 1, yaw3 = tm === 'red' ? aYaw : eYaw;
    for (var i4 = 0; i4 < nAA; i4++) {
      var aax = clamp((nAA > 1 ? (i4 - (nAA - 1) / 2) * 90 * kW : 0) + rand(-6, 6), -boundsX + 16, boundsX - 16);
      var aaz = clamp(rowZOut(zB3, hs3, 70) + rand(-4, 4), -boundsZ + 16, boundsZ - 16);
      var aat = createTank({ kind: 'aa', team: tm, x: aax, z: aaz, yaw: yaw3 + rand(-0.1, 0.1) });
      aat.reload = 0;
      aat.ai.anchorX = aax; aat.ai.homeZ = aaz;      // 锚定防守:原地警戒不前压(火箭炮同款;击毁后 redeployVehicle 按注册表 aiAnchor 自动重建锚点)
      aat.ai.destX = aax; aat.ai.destZ = aaz;
    }
  });
  // 火箭炮载具
  ['red', 'blue'].forEach(function (tm) {
    var R = tm === 'red' ? aR : eR;
    var zBase = tm === 'red' ? baseZ.arty : -baseZ.arty;
    var hs = Math.sign(zBase) || 1;
    for (var i2 = 0; i2 < R.arty; i2++) {
      var ax = clamp((i2 - (R.arty - 1) / 2) * 70 * kW + rand(-6, 6), -boundsX + 16, boundsX - 16);
      var az = clamp(rowZOut(zBase, hs, 47) + rand(-7, 7), -boundsZ + 16, boundsZ - 16);
      var art = createTank({ kind: 'arty', team: tm, x: ax, z: az, yaw: tm === 'red' ? aYaw : eYaw });   // 名称走 createTank 分阵营缺省: 红方RED-MLRS / 蓝方BLUE-MLRS
      art.reload = 0;
      art.ai.anchorX = ax; art.ai.homeZ = az;
      art.ai.destX = ax; art.ai.destZ = az;
    }
  });
  // 双方直升机编制
  ['red', 'blue'].forEach(function (tm) {
    var R = tm === 'red' ? aR : eR, hk = tm === 'red' ? 'wz10' : 'ah64';
    var zBase = tm === 'red' ? baseZ.heli : -baseZ.heli, hs = Math.sign(zBase) || 1, yawH = tm === 'red' ? aYaw : eYaw;
    var isPlayerKind = (startSide === tm && pKind === hk);
    var nFull = Math.max(0, R[hk] || 0);
    if (nFull <= 0) return;
    var slots = [];
    for (var ih = 0; ih < nFull; ih++) {
      slots.push([clamp((nFull > 1 ? (ih - (nFull - 1) / 2) * 60 * kW : 0) + rand(-4, 4), -boundsX + 16, boundsX - 16),
                  clamp(rowZOut(zBase, -hs, 60 + Math.floor(ih / 6) * 16) + rand(-2, 2), -boundsZ + 16, boundsZ - 16)]);
    }
    if (isPlayerKind) {
      var pci = 0;
      for (var pi = 1; pi < slots.length; pi++)
        if (Math.abs(slots[pi][0]) + Math.abs(slots[pi][1] - pZ0) < Math.abs(slots[pci][0]) + Math.abs(slots[pci][1] - pZ0)) pci = pi;
      slots.splice(pci, 1);
    }
    for (var si2 = 0; si2 < slots.length; si2++) {
      var heli = createTank({ kind: hk, team: tm, x: slots[si2][0], z: slots[si2][1], yaw: yawH + rand(-.1, .1) });
      heli.reload = 0;
    }
  });
  // 兵力池与重生队列复位
  var spA = (typeof window !== 'undefined' && window.__START_POOL) || SU.red.pool;
  var spE = (typeof window !== 'undefined' && window.__START_POOL) || SU.blue.pool;
  teamPool.red = spA; teamPool.blue = spE;
  respawnQueue.length = 0;
  // 双方大本营: 左/中/右 翼位横向均布(同源布局 _hqL.list,直接消费 x/z/yaw)
  var _hqList = (_hqL && _hqL.list) || [];
  for (var _hi = 0; _hi < _hqList.length; _hi++) {
    var _hq = _hqList[_hi];
    buildHQ(_hq.team, _hq.x, _hq.z, _hq.yaw, _hq.type, _hq.wing);
  }
  rebuildTargets();
}

function clearBattleEntities() {
  try { document.exitPointerLock && document.exitPointerLock(); } catch (e0) {}
  try { if (typeof gameState !== 'undefined') gameState = 'menu'; } catch (e1) {}
  // 未正常结束而直接返回车库时，丢弃本局暂存，避免半局数据写入长期档案。
  try {
    if (window.Achievements && typeof window.Achievements.cancelMatch === 'function') window.Achievements.cancelMatch();
  } catch (eAchCancel) {}
  try { freePlay = false; } catch (e2) {}
  try { respawnT = 0; } catch (e3) {}
  try { respawnUiOpen = false; } catch (e4) {}
  try { possessUiOpen = false; } catch (e5) {}
  try { battleEndT = -1; } catch (eBE) {}
  /* 载具/残骸拆场:先置死再摘除。★置死是根治「幽灵车」的关键——大量按帧过滤
     (弃车观察 abandonTick / 发动机烟 _csmRefreshVisible / 燃烧车 _comicBurnSync /
      接管补员 cmdAssign 等)都以 t.alive 为闸;只 scene.remove 不置死,旧车会继续
     开火/冒烟/弃车/入格,把上一局整场带进下一局。 */
  function rmGroup(tk) {
    if (!tk) return;
    try { tk.alive = false; tk._abandon = null; tk._cmdG = null; tk._csmRegistered = false; } catch (eF) {}
    if (!tk.group || tk._battleCleared) return;
    tk._battleCleared = true;
    try { if (tk._occMesh) { if (tk._occMesh.geometry && tk._occMesh.geometry.dispose) tk._occMesh.geometry.dispose(); tk._occMesh = null; } } catch (eO) {}
    try { if (typeof scene !== 'undefined' && scene) scene.remove(tk.group); } catch (eR) {}
  }
  try {
    if (typeof tanks !== 'undefined' && tanks) {
      for (var i = 0; i < tanks.length; i++) rmGroup(tanks[i]);
      tanks.length = 0;
    }
  } catch (eT) {}
  try {
    if (typeof wreckList !== 'undefined' && wreckList) {
      for (var w = 0; w < wreckList.length; w++) rmGroup(wreckList[w]);
      wreckList.length = 0;
    }
  } catch (eW) {}
  /* Clear all match-owned registries before returning to the garage or starting a new round. */
  try { if (typeof aliveList !== 'undefined' && aliveList) aliveList.length = 0; } catch (eA) {}
  try {
    if (typeof teamCounts !== 'undefined' && teamCounts) { teamCounts.red = 0; teamCounts.blue = 0; }
    if (typeof teamRegularCounts !== 'undefined' && teamRegularCounts) { teamRegularCounts.red = 0; teamRegularCounts.blue = 0; }
  } catch (eC) {}
  try { if (typeof clearTargets === 'function') clearTargets(); } catch (eT2) {}
  try {
    if (typeof hqList !== 'undefined' && hqList) {
      ['red', 'blue'].forEach(function (tm) {
        var hArr = hqList[tm]; if (!hArr) return;
        for (var h = 0; h < hArr.length; h++) {
          var hq = hArr[h];
          if (hq.grp && typeof scene !== 'undefined' && scene) scene.remove(hq.grp);
          if (hq.flagGeo && hq.flagGeo.dispose) hq.flagGeo.dispose();
          if (hq.ringGeo && hq.ringGeo.dispose) hq.ringGeo.dispose();
          if (hq.ringMat && hq.ringMat.dispose) hq.ringMat.dispose();
        }
        hArr.length = 0;
      });
    }
  } catch (eH2) {}
  try { if (typeof _poleSegs !== 'undefined') _poleSegs.length = 0; } catch (eP0) {}
  try {
    if (typeof _poleLine !== 'undefined' && _poleLine) {
      if (typeof scene !== 'undefined' && scene) scene.remove(_poleLine);
      if (_poleLine.geometry && _poleLine.geometry.dispose) _poleLine.geometry.dispose();
      _poleLine = null;
    }
  } catch (eP1) {}
  try { if (typeof hitGridStatic !== 'undefined' && hitGridStatic) hitGridStatic.clear(); } catch (eHS) {}
  try { if (typeof hitGridStaticVersion !== 'undefined') hitGridStaticVersion++; } catch (eHV) {}
  try { if (typeof hitGridDynamic !== 'undefined' && hitGridDynamic) hitGridDynamic.clear(); } catch (eHD) {}
  try { if (typeof rebuildHitGrid === 'function') rebuildHitGrid(); } catch (eG2) {}
  try { if (typeof wckClear === 'function') wckClear(); } catch (eWK) {}
  try { if (typeof wreckGrid !== 'undefined' && wreckGrid) wreckGrid.clear(); } catch (eWG) {}
  try { if (typeof collGridReset === 'function') collGridReset(); } catch (eCG) {}
  try { if (typeof _wreckMoveQueue !== 'undefined' && _wreckMoveQueue) _wreckMoveQueue.length = 0; } catch (eWM) {}
  try { if (typeof sqCmdReset === 'function') sqCmdReset(); } catch (eS2) {}
  try { if (typeof controlZonesReset === 'function') controlZonesReset(); } catch (eCZ) {}
  try { if (typeof heliABGClear === 'function') heliABGClear(); } catch (eB2) {}
  /* ★修复(火箭炮黄框跨局残留): 世界层那处 hide 只在渲染帧里跑,而它在退出对局后
     会因为 player 置空/换车而整个被跳过;这里作为对局级清理再显式关一次,
     保证「在火箭炮炮镜里直接退出对局」也不会把黄色火力覆盖框带进下一局。
     startGame 开头也会走本函数,所以新对局开始必然经过这道关。 */
  try { if (typeof artyTopMarkersHide === 'function') artyTopMarkersHide(); } catch (eAT) {}
  try { player = null; } catch (eP) {}
  try {
    if (typeof shells !== 'undefined' && shells) {
      for (var s = shells.length - 1; s >= 0; s--) {
        if (shells[s] && shells[s].mesh && typeof scene !== 'undefined') scene.remove(shells[s].mesh);
      }
      shells.length = 0;
    }
  } catch (eS) {}
  try { if (typeof airborneMissiles !== 'undefined') airborneMissiles.length = 0; } catch (eM) {}
  try { if (typeof airborneGuidedRockets !== 'undefined') airborneGuidedRockets.length = 0; } catch (eG) {}
  try { if (typeof clearHeliDecoys === 'function') clearHeliDecoys(); } catch (eD) {}
  try { if (typeof respawnQueue !== 'undefined') respawnQueue.length = 0; } catch (eQ) {}
  /* 跨局残留状态全清:待生效弹坑 / 空中坠机残骸 / 弃车观察 / 火箭落点预报 / AI 指挥官账本 */
  try { if (typeof craterQueue !== 'undefined' && craterQueue) craterQueue.length = 0; } catch (eCQ) {}
  try { if (typeof _cfPart !== 'undefined') _cfPart = null; } catch (eCP) {}   // ★任务27⑤:坑内断点游标随跨局残留一并清空
  try { if (typeof heliFallingWrecks !== 'undefined' && heliFallingWrecks) heliFallingWrecks.length = 0; } catch (eHF) {}
  try { if (typeof abandonWatch !== 'undefined' && abandonWatch) abandonWatch.length = 0; } catch (eAW) {}
  try { if (typeof rocketThreats !== 'undefined' && rocketThreats) rocketThreats.length = 0; } catch (eRT) {}
  try { if (typeof rocketThreatGrid !== 'undefined' && rocketThreatGrid) rocketThreatGrid.clear(); } catch (eRG) {}
  try { if (typeof recentBursts !== 'undefined' && recentBursts) recentBursts.length = 0; } catch (eRB) {}
  try { if (typeof evadeLog !== 'undefined' && evadeLog) evadeLog.length = 0; } catch (eEL) {}
  try { if (typeof aimAudit !== 'undefined' && aimAudit) aimAudit.length = 0; } catch (eAA) {}
  try { if (typeof commanders !== 'undefined' && commanders) { for (var ck in commanders) delete commanders[ck]; } } catch (eCM) {}
  try { kills = 0; playerRespawns = 0; wreckCount = 0; } catch (eK) {}
  /* 漫画/余烬等模块级对局特效登记表全清(黑烟柱/燃烧车/火箭弹道线/发动机烟/余烬火星) */
  try { if (typeof wreckSmokeClear === 'function') wreckSmokeClear(); } catch (eWS) {}
  try { if (typeof comicBattleClear === 'function') comicBattleClear(); } catch (eCB) {}
  try { if (typeof fxBattleClear === 'function') fxBattleClear(); } catch (eEC) {}
  try { if (typeof wxBattleClear === 'function') wxBattleClear(); } catch (eWX) {}   // M1:战损模板清零(防车库/下局污染)
  try { if (typeof clearBattlefieldAtmosphere === 'function') clearBattlefieldAtmosphere(); } catch (eBA) {}
  try { if (typeof aiBattleClear === 'function') aiBattleClear(); } catch (eAI) {}   // ★任务27⑧:AI 跨局 TTL 缓存清扫(敌群聚类/薄弱区/集群质心——gameT 菜单期冻结致缓存跨局存活,新局火箭炮按旧战场坐标齐射)
  try { camShake = 0; camPK = 0; } catch (eCS) {}   // ★任务27⑧:相机震动/炮镜顶起残值(衰减在 cameraUpdate=退局冻结,不清则新局开局无来源晃动)
  try {
    if (typeof el !== 'undefined' && el) {
      if (el.hud) el.hud.classList.add('hidden');
      if (el.pauseov) el.pauseov.classList.add('hidden');
      if (el.endov) el.endov.classList.add('hidden');
      if (el.respawnov) el.respawnov.classList.add('hidden');
      if (el.possessov) el.possessov.classList.add('hidden');
    }
  } catch (eU) {}
  try { if (typeof RSP !== 'undefined') RSP.phase = 'idle'; } catch (ePh) {}
}
window.clearBattleEntities = clearBattleEntities;

/* M2 观瞄模式复位:热像/夜视写共享材质,退局与开局强制复位(防车库灰车+下局带热像开局)。 */
function resetBattleViewModes() {
  try { if (typeof thermalOn !== 'undefined' && thermalOn) { thermalOn = false; if (typeof thermalSync === 'function') thermalSync(); } } catch (eT) {}
  try { if (typeof nvOn !== 'undefined' && nvOn) { nvOn = false; if (typeof nvSync === 'function') nvSync(); } } catch (eN) {}
  try {
    var _th = document.getElementById('tth'); if (_th) _th.classList.remove('lit');
    var _nv = document.getElementById('tnv'); if (_nv) _nv.classList.remove('lit');
  } catch (eL) {}
}

function startGame() {
  if (typeof stopMenuBgm === 'function') stopMenuBgm();
  if (typeof Hangar3D !== 'undefined' && Hangar3D.pause) Hangar3D.pause();
  initAudio();
  if (typeof validateVehicleRegistry === 'function') validateVehicleRegistry();   // 载具注册表启动自检(缺失项告警+已兜底,不中断)
  if (typeof sqCmdReset === 'function') sqCmdReset();               // 小队指挥状态重置(跨局防残留引用)
  if (typeof initBallisticsDB === 'function') initBallisticsDB();
  try { if (typeof resetBattleViewModes === 'function') resetBattleViewModes(); } catch (eRVM) {}   // M2:开局观瞄复位   // 弹道数据库开局预计算一次(代表散布圈 + 交火底线缓存全组合预热)
  if (typeof window.clearBattleEntities === 'function') window.clearBattleEntities();
  if (typeof vehicleTechBeginMatch === 'function') vehicleTechBeginMatch();
  // startSide/startKind are authoritative: quick battle syncs them from the
  // hangar before startGame(), while the custom panel updates them directly.
  // Do not reread the hangar active item here, or a deliberate custom
  // MBT-1 selection is overwritten by the inspected vehicle.
  if (typeof window !== 'undefined') {
    window.startSide = startSide;
    window.startKind = startKind;
  }
  setupMapWorld(startSeed, startRough, startMapLen, startMat, startMapWid);
  spawnTeams();
  applyTimeOfDay(startHour);   // 每局重建世界,禁止沿用上一局 player
  // 初始出击计入当前载具；后续普通重新部署在 redeployPlayer 中追加，友军接管不经过此处。
  try {
    if (window.Achievements && typeof window.Achievements.beginMatch === 'function') window.Achievements.beginMatch(player);
  } catch (eAchStart) {}
  gameState = 'playing';
  /* ★P2-⑧(移动端恢复) 开局 DRS 回满+重热身:新一局场景/着色器重建,上一局的降采样档位与驻留计时全部失效 */
  if (typeof drsScale !== 'undefined') {
    drsScale = 1.0; _drsHotT = _drsCoolT = _drsDeepT = 0; _drsWarmT = -1; _drsSettleT = 0;
    if (_drsFxDeep && typeof WRSMOKE_AMT !== 'undefined') WRSMOKE_AMT = 1.0;
    _drsFxDeep = false;
    if (typeof drsApply === 'function') drsApply();
  }
  if (window.CrazyGamesAdapter) window.CrazyGamesAdapter.gameplayStart();
  window._pointerPauseArmed = false;
  startT = gameT;
  try {
    if (typeof minimapReset === 'function') minimapReset();
    if (typeof minimapAutoOrient === 'function') minimapAutoOrient();
  } catch (eMM1) {}
  el.hud.classList.remove('hidden');
  if (typeof window !== 'undefined' && window._touchUISync) window._touchUISync();   // 触控层第一时间显示(事件直挂)
  el.startov.classList.add('hidden');
  el.pauseov.classList.add('hidden');
  updateLockHint();
  initAimBaseline();                                  // ★进局即把兼容模式差分基准回中(旧值可能来自上一局,会造成首帧甩头)
  lockAvailable = true;                                // ★新对局重置锁定可用性(上一局的拒绝不该影响本局)
  if (!pointerLocked) attemptLock();                   // 手势内(出击/继续按钮)重取指针锁定
  snapCamera();
}

/* ============================================================
   输入处理
   ============================================================ */
var aimPX = 640, aimPY = 360;               // 兼容模式差分基准(锁定时按 movement 增量估计;不再作为瞄准目标——黄点已钉死屏心)
var aimChaseOn = true;                        // 炮口追视野开关:按下任一方向键暂停,移动任一鼠标恢复
var aimSensMul = 1;                           // 瞄准灵敏度乘数(设置页滑条 0~10 → ×1~×10;鼠标/触屏同吃)
/* 炮镜开关(Shift 键/触屏双指缩放跨越 1× 共用单一实现)。
   退出炮镜时先把第三人称的瞄准基准对齐到当前相机方位:
   若直接切换 scopeMode,下一次瞄准增量会立即修改 camAimY,而 cameraUpdate 仍处于
   scopeT 的过渡阶段,导致 _camYaw 与 camAimY 不一致,出现一次明显的视角跳变。 */
function scopeToggle() {
  if (scopeMode && player && player._camYaw != null) {
    camAimY = player._camYaw;
  }
  scopeMode = !scopeMode;
  if (scopeMode && player && player.kind === 'arty') {
    /* 火箭炮炮镜=俯视火控视野:解除指针锁定,恢复系统光标(点哪打哪)。
       必须先清 _pointerPauseArmed,否则丢锁事件会被误判为玩家 ESC 而弹出暂停。 */
    window._pointerPauseArmed = false;
    try { document.exitPointerLock && document.exitPointerLock(); } catch (e) {}
    artTopNX = 0; artTopNY = 0;                        // 光标回屏幕中心
    player._topHover = null;
    player._topFireWish = false; player._topTgt = null;
    player._artyCreepFwd = 0; player._topCreepDist = 0;
    player._topCamX = 0; player._topCamZ = 0;          // 镜头回车体中心
  }
  if (!scopeMode && player) {
    /* 退出时立即结束炮镜插值状态。继续让 scopeT 在约一秒内衰减,
       会使相机位置和 lookAt 目标同时依赖新瞄准方向,造成输入相关的
       非线性跳变。相机位置本身仍通过 cameraUpdate 的阻尼平滑回到
       第三人称,因此不会产生硬切镜头。 */
    player._camYaw = camAimY;
    scopeT = 0;
    scoped = false;
    scopeTick = 0;
    if (player.kind === 'arty') {                      // 退镜:撤销点选射击任务与蠕行(锁定 watchdog 300ms 内自动回锁)
      player._topFireWish = false; player._topTgt = null; player._artyCreepFwd = 0;
    }
  }
  if (typeof comicMotionSmokeInvalidate === 'function') comicMotionSmokeInvalidate(); // 开/关镜触发烟尘可见表立即重建
}
/* 瞄准增量入口(鼠标 movement/触屏滑动共用单一实现):灵敏度/倍率手感补偿/火箭炮装定分支。 */
/* ★★BUGFIX(进局后转向角度受限,须点一次左键才解锁)★★
   原因:本作的视野是 FPS 式「吃无限增量」(camAimY 不钳位),只有指针锁定才拿得到无限增量;
        requestPointerLock 又只能在「用户手势」里成功 —— 而全工程只有左键 mousedown 与
        暂停/结算/接管/重生 这几处会 attemptLock()。出击后若那一次锁定请求被拒/被吞
        (沙箱 iframe 无 allow-pointer-lock、或同一手势里先 exitPointerLock 再重锁被拒),
        就停在「兼容模式」:dxC = clientX − 上一帧 aimPX,而 aimPX 被 clamp(0, innerWidth)
        → 一次划屏最多转 innerWidth×0.0025 rad(1920px≈275°、1000px 窗口≈143°),
        光标顶到窗口边缘后 mousemove 直接不再派发 → 该方向彻底转不动。
        点左键 = 第一次带手势的 attemptLock() → 锁上后无限增量,角度「解锁」。
   修法:①增量统一走 aimInputStep(),锁定态不再被屏宽钳位;
        ②进局/重生/接管/锁定态切换时把差分基准回中(initAimBaseline),消除首帧甩动;
        ③watchdog 在「对局中且未锁定」时按冷却自动重试锁定(不依赖玩家先点左键)。 */
function initAimBaseline() {                                            // 差分基准回屏心(与 combat.js 重生/接管处同一写法)
  aimPX = innerWidth * 0.5; aimPY = innerHeight * 0.5;
}
/* 把一次鼠标事件换算成 (dx, dy, 新基准)。纯函数、无副作用 → 可被回归测试直接调用。
   locked=true : 用 movementX/Y 无限增量,基准仅用于显示(钳在屏内),不限制累计量
   locked=false: 用 clientX/Y 差分;基准钳在屏内,但「增量」取自未被钳的累计位 →
                 光标顶到边缘时不会把反向第一帧变成巨大跳变(仍受浏览器不派发越界事件的物理限制,
                 故必须配合 watchdog 重试锁定) */
function aimInputStep(ev, locked, baseX, baseY, vw, vh) {
  var dxC, dyC;
  if (locked && typeof ev.movementX === 'number') {
    dxC = ev.movementX; dyC = ev.movementY || 0;
    return { dx: dxC, dy: dyC, bx: clamp(baseX + dxC, 0, vw), by: clamp(baseY + dyC, 0, vh) };
  }
  if (typeof ev.clientX === 'number' && typeof ev.clientY === 'number') {
    var nx = clamp(baseX + (ev.clientX - baseX), 0, vw);                 // 基准=屏内光标位
    dxC = ev.clientX - baseX; dyC = (ev.clientY - baseY);
    return { dx: dxC, dy: dyC, bx: nx, by: clamp(baseY + dyC, 0, vh) };
  }
  dxC = ev.movementX || 0; dyC = ev.movementY || 0;
  return { dx: dxC, dy: dyC, bx: clamp(baseX + dxC, 0, vw), by: clamp(baseY + dyC, 0, vh) };
}
var _lockTry = 0, _lockTryAt = -9e9, _lockHardDenied = false;             // watchdog 自限流状态
function aimPointerLockWatchdog(nowSec) {                                 // 由 interval 调用;常态=1 个时间比较
  nowSec = (typeof nowSec === 'number') ? nowSec : (typeof gameT === 'number' ? gameT : Date.now() / 1000);
  if (nowSec - _lockTryAt < 2.0) return;                                  // 自限流:至少隔 2s 才可能再发一次
  if (typeof gameState === 'undefined' || gameState !== 'playing') return;
  if (typeof player === 'undefined' || !player || !player.alive) return;
  if (typeof artyTopActive === 'function' && artyTopActive()) return;   // 火箭炮俯视火控:自由光标模式不回锁
  if (typeof respawnUiOpen !== 'undefined' && respawnUiOpen) return;
  if (typeof possessUiOpen !== 'undefined' && possessUiOpen) return;
  if (typeof pointerLocked !== 'undefined' && pointerLocked) { _lockTry = 0; _lockHardDenied = false; return; }
  if (typeof lockAvailable !== 'undefined' && !lockAvailable) return;    // 浏览器冷却期交给下一次 tick
  if (_lockHardDenied && _lockTry >= 8) return;                           // 从未锁上过 + 连拒 8 次=环境真不支持 → 停手,左键手势仍可重试
  _lockTry++; _lockTryAt = nowSec;
  if (!window._pointerPauseArmed) _lockHardDenied = true;                 // 一次都没成功过 → 按「硬性拒绝」保守计次
  attemptLock();
}
function aimApplyDelta(dxC, dyC) {
  aimChaseOn = true;                                            // 有瞄准输入 = 恢复准星追逐
  dxC *= aimSensMul; dyC *= aimSensMul;                         // 灵敏度乘数(设置页滑条;默认 ×1)
  var sf = 1 - 0.65 * scopeT;
  // 炮镜倍率手感补偿——准星屏幕移动量在不同倍率下与默认(1×)完全一致。
  //   原理:准星屏幕位移 ∝ 视角转动角度 × (屏幕高度/2tan(fov/2));倍率放大→fov 收窄→
  //   同角度在屏幕上位移更大,故灵敏度须乘 tan(fov/2)/tan(14°)(1×=1,20×≈0.049),
  //   使 输入像素→准星像素 的映射与倍率无关(=默认倍率手感)。
  var zoomF = 1;
  if (scopeT > 0.001) {
    var fovCur = scopeFov(scopeZoom, scopeT);   // 与 cameraUpdate 同公式(平滑过渡)
    zoomF = Math.tan(fovCur * Math.PI / 360) / Math.tan(14 * Math.PI / 180);
  }
  // 坦克/歼击车炮镜 = FPS 式视野:瞄具(镜框+十字丝)钉屏幕中心,视野直接吃输入增量(不反向);
  // 主循环里真炮口按载具实际炮塔速度追踪跟随这个瞄具方向。
  camAimY -= dxC * 0.0025 * sf * zoomF;                        // 视野随输入增量(原 FPS 手感,不反向)
  camAimP = playerAimPitchClamp(player, camAimP - dyC * 0.002 * sf * zoomF);
}
/* ===== 指挥模式指令落点解算与入口(Z/X 键与触控占领/跟随键共用) ----
   占领点=屏心黄点视轴的地面/车体落点(laserRange 宽相位射线,事件级一次解算,零逐帧);
   无落点(朝天/超 2000m)发战斗提示不落令。非指挥态=空操作(键位无冲突面)。 ===== */
var _sqOrdV = null;
function sqCmdOrderOccupyAtCursor() {
  if (typeof sqCmd === 'undefined' || !sqCmd.active || !camera || !player || !player.alive) return;
  if (!_sqOrdV) _sqOrdV = new THREE.Vector3();
  camera.getWorldDirection(_sqOrdV);
  var d = laserRange(camera.position, _sqOrdV);
  if (!isFinite(d) || d < 8 || d > 1990) { if (typeof aimHint === 'function') aimHint('NO VALID AIMPOINT'); return; }
  sqCmdOrderSet('occupy', camera.position.x + _sqOrdV.x * d, camera.position.z + _sqOrdV.z * d);
}
/* ===== 触屏"幽灵鼠标"过滤 =====
   安卓等触屏环境里,浏览器会为触摸手势额外合成一整套兼容鼠标事件
   (mousedown → mousemove → mouseup),前提是那次 touchstart 没有被 preventDefault。
   本作恰好就是这种情况:点触 HUD 里的"点击型控件"(武器切换栏 #heliweaponbar 及其选项)
   时 uiTarget() 放行、**故意不 preventDefault**(否则浏览器合成的 click 会被一起吞掉、
   控件就点不动了),于是浏览器紧接着合成鼠标事件 ——
   · mousemove 落到下面未门控的瞄准监听上,而它按 clientX 差分算增量:
     基准 aimPX 还停在上一处位置,一次点击立刻变成几十度的视角跳转
     —— 这就是"点武器栏切换武器会把视角转走"的根因;
   · mousedown 还会置 mouseDown = true(误开火)并尝试申请指针锁定。
   过滤方式:优先用 Chrome 的 e.sourceCapabilities.firesTouchEvents(合成事件的精确标记),
   退化为"刚刚有触摸事件"的时间窗 —— 合成的鼠标事件紧跟在 touchend 之后同批次派发,
   400ms 窗口远大于其间隔,又不至于误伤触摸屏笔记本上"点一下再立刻动鼠标"的真实操作。
   真鼠标/触控板不受影响(firesTouchEvents 为 false,且不会触发 markTouchInput)。 ===== */
var _lastTouchAt = -1e9;
function markTouchInput() {
  _lastTouchAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}
function isGhostMouse(e) {
  if (e && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return true;   // Chrome:合成事件自带标记
  var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  return (now - _lastTouchAt) < 400;                                                     // 兜底:刚有触摸=必是合成
}
/* The weapon bar is a real HUD control layered over the battlefield.  A
   desktop mousedown bubbles to this global handler before the bar's click
   listener selects weapon 2; treating it as a trigger can fire the currently
   loaded round or request pointer lock.  Keep the click selection path, but
   do not turn that HUD press into a battlefield fire input. */
function isWeaponBarMouseTarget(target) {
  var n = target;
  while (n && n !== document.body) {
    if (n.id === 'heliweaponbar' || n.id === 'hwp-1' || n.id === 'hwp-2' || n.id === 'hwp-3' || n.id === 'hwp-4') return true;
    n = n.parentNode;
  }
  return false;
}
function initInput() {

  addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (e.code === 'ArrowUp') keys.KeyW = true;
    if (e.code === 'ArrowDown') keys.KeyS = true;
    if (e.code === 'ArrowLeft') keys.KeyA = true;
    if (e.code === 'ArrowRight') keys.KeyD = true;
    if (e.code === 'KeyM' && !e.repeat && gameState === 'playing' &&
        !(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA'))) {
      e.preventDefault();
      if (typeof minimapCycleSize === 'function') minimapCycleSize();
    }
    if (e.code === 'Backspace' && !e.repeat && !(e.target && e.target.tagName === 'INPUT')) {   // 指挥模式键(输入框退格不劫持):战术标识/指挥星与指挥模式联动开关
      e.preventDefault();                                 // 阻止浏览器后退等默认行为
      if (gameState === 'playing' && player && player.alive) {
        // 直升机座舱: Backspace = A射B导(借用最近友机导弹,僚机头顶星); 地面载具: 小队指挥(组员头顶星+战术标识同步开)
        if (isHeliVehicle(player) && typeof heliABGToggle === 'function') heliABGToggle();
        else if (typeof sqCmdToggle === 'function') sqCmdToggle();
      }
    }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].indexOf(e.code) >= 0) {   // 方向键不再控炮塔,仅 WASD 用于车体移动
      if (!e.repeat) {                                    // 仅“新按下”暂停:浏览器对按住键 ~30Hz 自动连发 keydown,
        aimChaseOn = false;                               // 若连发也算,鼠标一停追逐就被永久关闭(开镜细调/挪车必死)
        if (player && player.alive) player.turretYawDelta = 0;   // 并冲掉追逐尾量,炮塔立即停稳
        if (gameState === 'playing' && player && player.alive && !artyTopActive() && (e.code === 'KeyW' || e.code === 'KeyS') &&
            typeof playerImmobile === 'function' && playerImmobile() &&
            typeof aimHint === 'function') aimHint('IMMOBILE');   // 键盘按下沿同款提示(俯视火控=WSAD 平移镜头,不涉驾驶,不提示)
      }
    }
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) scopeToggle();   // 按一次开镜,再按一次关镜(实现见 scopeToggle,触屏缩放共用)
    if (e.code === 'KeyN' && !e.repeat && playerHasNV && player && player.alive) {  // 任意小时任意视角开/关;设备门=座车装备缓存(59式无)
      nvOn = !nvOn; nvSync();                                 // 开/关夜视仪(生效态=nvActive;阵亡/换装自动复原)
    }
    if (e.code === 'KeyH' && !e.repeat && playerHasTH && player && player.alive) {  // 任意视角开/关热成像(与夜视互斥;设备门=高阶主战坦克)
      thermalOn = !thermalOn; thermalSync();
    }
    if (e.code === 'KeyT' && !e.repeat && !(e.target && e.target.tagName === 'INPUT')) {  // 战术标识(T 独立开关,只开标识+描边,不进指挥模式)
      if (gameState === 'playing') { e.preventDefault(); if (typeof tacToggle === 'function') tacToggle(); }
    }
    if (e.code === 'KeyF' && !e.repeat && !(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA'))) {
      if (gameState === 'playing' && player && player.alive && isHeliVehicle(player)) {
        e.preventDefault();
        if (typeof triggerHeliDecoy === 'function') triggerHeliDecoy(player);
      }
    }
    if (e.code === 'KeyZ' && !e.repeat && typeof sqCmdOrderOccupyAtCursor === 'function') sqCmdOrderOccupyAtCursor();   // 指挥模式:占领 (Z键)
    if (e.code === 'KeyX' && !e.repeat && typeof sqCmdOrderSet === 'function' && sqCmd.active) sqCmdOrderSet('follow', 0, 0);   // 指挥模式:跟随 (X键)
    // MBT-1 炮射导弹科技 1 / 2 切换(1=主炮, 2=炮射导弹);只写入当前玩家载具实例
    if (gameState === 'playing' && player && player.alive && typeof isPlayerRedMbtMissileVehicle === 'function' && isPlayerRedMbtMissileVehicle(player)) {
      if ((e.code === 'Digit1' || e.code === 'Numpad1') && !e.repeat) {
        selectRedMbtWeapon(player, 1);
        if (typeof aimHint === 'function') aimHint('WEAPON [1]: MAIN GUN');
      } else if ((e.code === 'Digit2' || e.code === 'Numpad2') && !e.repeat) {
        selectRedMbtWeapon(player, 2);
        if (typeof aimHint === 'function') aimHint('WEAPON [2]: GUN-LAUNCHED MISSILE');
      }
    }
    // RED-TD 1 / 2 切换武器(1=穿甲弹, 2=榴弹;只在高爆弹科技已安装时显示)
    if (gameState === 'playing' && player && player.alive && typeof isPlayerRedTdHighExplosiveVehicle === 'function' && isPlayerRedTdHighExplosiveVehicle(player)) {
      if ((e.code === 'Digit1' || e.code === 'Numpad1') && !e.repeat) {
        selectRedTdWeapon(player, 1);
        if (typeof aimHint === 'function') aimHint('WEAPON [1]: AP ROUND');
      } else if ((e.code === 'Digit2' || e.code === 'Numpad2') && !e.repeat) {
        selectRedTdWeapon(player, 2);
        if (typeof aimHint === 'function') aimHint('WEAPON [2]: HIGH-EXPLOSIVE');
      }
    }
    // AA weapon selection: [1]=SAM, [2]=ATGM when installed, and RED-AA's
    // twin gun is [2] without ATGM or [3] with ATGM.  SAM/ATGM selection is
    // stored separately from the kind currently loaded in the launcher.
    if (gameState === 'playing' && player && player.alive && typeof isAAVehicle === 'function' && isAAVehicle(player)) {
      var aaAtgm = player._techAaAtgm === true ||
        (typeof vehicleTechAaAtgmInstalled === 'function' && vehicleTechAaAtgmInstalled(player)) ||
        (typeof vehicleTechRedAaAtgmInstalled === 'function' && vehicleTechRedAaAtgmInstalled(player));
      if ((e.code === 'Digit1' || e.code === 'Numpad1') && !e.repeat) {
        if (aaAtgm && typeof selectAAWeapon === 'function') selectAAWeapon(player, 1);
        else {
          player._heliWeapon = 3;
          if (typeof camAimP !== 'undefined') camAimP = playerAimPitchClamp(player, camAimP);
        }
        if (typeof aimHint === 'function') aimHint('WEAPON [1]: SAM');
      } else if ((e.code === 'Digit2' || e.code === 'Numpad2') && !e.repeat) {
        if (aaAtgm && typeof selectAAWeapon === 'function') {
          selectAAWeapon(player, 2);
          if (typeof aimHint === 'function') aimHint('WEAPON [2]: ATGM');
        } else if (player.team === 'red') {
          player._heliWeapon = 1;
          if (typeof camAimP !== 'undefined') camAimP = playerAimPitchClamp(player, camAimP);
          if (typeof aimHint === 'function') aimHint('WEAPON [2]: TWIN GUN');
        } else if (typeof aimHint === 'function') aimHint('NO GUN EQUIPPED');
      } else if ((e.code === 'Digit3' || e.code === 'Numpad3') && !e.repeat) {
        if (aaAtgm && player.team === 'red') {
          player._heliWeapon = 1;
          if (typeof camAimP !== 'undefined') camAimP = playerAimPitchClamp(player, camAimP);
          if (typeof aimHint === 'function') aimHint('WEAPON [3]: TWIN GUN');
        }
      }
    }
    // 直升机 1 / 2 / 3 切换武器(1=导弹[默认], 2=火箭弹, 3=机炮);火控雷达自动常亮,无手动开关键
    if (gameState === 'playing' && player && player.alive && isHeliVehicle(player)) {
      if ((e.code === 'Digit1' || e.code === 'Numpad1') && !e.repeat) {   // 1号位=导弹(内部3)
        player._heliWeapon = 3;
        if (typeof camAimP !== 'undefined') camAimP = playerAimPitchClamp(player, camAimP);
        if (typeof aimHint === 'function') aimHint('WEAPON [1]: MISSILE');
      } else if ((e.code === 'Digit2' || e.code === 'Numpad2') && !e.repeat) {
        player._heliWeapon = 2;
        if (typeof camAimP !== 'undefined') camAimP = playerAimPitchClamp(player, camAimP);
        if (typeof aimHint === 'function') aimHint('WEAPON [2]: ROCKETS');
      } else if ((e.code === 'Digit3' || e.code === 'Numpad3') && !e.repeat) {   // 3号位=机炮(内部1)
        player._heliWeapon = 1;
        if (typeof camAimP !== 'undefined') camAimP = playerAimPitchClamp(player, camAimP);
        if (typeof aimHint === 'function') aimHint('WEAPON [3]: GUN');
      }
    }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].indexOf(e.code) >= 0) e.preventDefault();
    if (e.code === 'Space' && player && isHeliVehicle(player)) {   // 直升机总距上行;CTRL 交还浏览器,不拦截
      e.preventDefault();
    }
  });
  addEventListener('keyup', function (e) {
    keys[e.code] = false;
    if (e.code === 'ArrowUp') keys.KeyW = false;
    if (e.code === 'ArrowDown') keys.KeyS = false;
    if (e.code === 'ArrowLeft') keys.KeyA = false;
    if (e.code === 'ArrowRight') keys.KeyD = false;
    if (e.code.indexOf('Control') >= 0) keys.Control = false;
  });
  // 失焦(ALT+TAB/系统弹窗/切换窗口)会吞掉 keyup 造成 Ctrl/Shift 等卡键——
  // 表现为回来后滚轮一直按 isCtrl=10 倍步进走。失焦统一清零键位与鼠标按住状态。
  addEventListener('blur', function () {
    for (var k in keys) keys[k] = false;
    mouseDown = false;
    _rmbHeld = false;
  });
  addEventListener('mousedown', function (e) {
    if (isGhostMouse(e)) return;   // 触屏合成的兼容鼠标事件:否则点一次 HUD 控件就会误开火 + 误申请指针锁定
    if (isWeaponBarMouseTarget(e.target)) return;   // 武器栏点击只换武器,绝不误触发当前武器或指针锁
    // 复活/接管界面开着时点按钮绝不再锁指针(防光标被吃掉,选钮无需先按 ESC)
    if (gameState === 'playing' && !respawnUiOpen && !possessUiOpen) {
      if (e.button === 0) {
        mouseDown = true;
        if (!pointerLocked && lockAvailable && !artyTopActive()) attemptLock();   // 火箭炮俯视火控需要自由光标,不回锁
      } else if (e.button === 2) {
        // 右键:在直升机雷达开启时选定/取消选定锁定目标; 07: RED-MBT-2按住=激光压制照射
        _rmbHeld = true;
        e.preventDefault();
        if (player && player.alive && (isHeliVehicle(player) || (typeof isAAVehicle === 'function' && isAAVehicle(player))) && player._heliRadarActive) {
          heliRadarRightClickDesignate(player);
        }
      }
    }
  });
  addEventListener('mouseup', function (e) {
    if (e.button === 0) mouseDown = false;
    if (e.button === 2) _rmbHeld = false;   // 激光压制照射松开
  });
  addEventListener('contextmenu', function (e) { e.preventDefault(); });
  // ★转向角度受限修复:进入对局后不依赖「玩家先点一次左键」才拿到指针锁定 ——
  //   ①在「出击/继续」按钮的手势里已 attemptLock;若那一发被拒(沙箱 iframe 无
  //   allow-pointer-lock、或同手势内先 exit 再 request 被吞),旧代码会把「无限增量瞄准」
  //   一路降级成「屏宽差分」,于是转向被钳在一屏之内、光标顶到窗口边就转不动。
  //   ②这里补一个 300ms 的轻量 watchdog:只要「对局中 + 未锁定 + 不在冷却」就再要一次,
  //   任何真实用户手势(点击/键鼠/focus)之后浏览器即会放行。空转成本可忽略(4 个布尔判断)。
  if (typeof setInterval === 'function') {
    setInterval(aimPointerLockWatchdog, 300);
    addEventListener('focus', function () {            // 切回窗口=天然用户手势,立刻重试
      lockAvailable = true;
      aimPointerLockWatchdog();
    });
  }
  // 鼠标滚轮操作——开镜模式下统一缩放倍率(1~20×);直升机非开镜视角下调节升力/总距与发动机启停
  addEventListener('wheel', function (e) {
    // 浏览器默认把 Ctrl/Cmd+滚轮(含触控板捏合)当作页面缩放手势:指针锁定期间触发缩放会使
    // 光标隐匿与锁定状态错乱(对局表现=鼠标"消失"+自动暂停+瞄准/命中坐标全错)。
    // 本页即全屏战场,一律拦下;确需缩放页面请走浏览器菜单或 Ctrl+加/减号。
    if (e.ctrlKey || e.metaKey) e.preventDefault();
    if (gameState !== 'playing' || !player || !player.alive) return;
    var isCtrl = !!(e.ctrlKey || (keys && (keys.ControlLeft || keys.ControlRight || keys.Control)));
    if (scopeMode) {
      // 炮镜模式下: 统一使用鼠标滚轮缩放倍率(向上放大、向下缩小, 1~20×; 按住 CTRL 一次调整 10 倍倍率)
      e.preventDefault();
      var step = isCtrl ? 10 : (5 / 3);
      if (e.deltaY < 0) scopeZoom = Math.min(20, scopeZoom + step);
      else scopeZoom = Math.max(1, scopeZoom - step);       // 向下滚 = 缩小(最小=默认1×)
      return;
    }
    if (isHeliVehicle(player)) {
      // 直升机非开镜视角下: 滚轮控制升力与发动机启停 (按住 CTRL 一次调整 10% 桨距)
      e.preventDefault();
      heliHandleWheel(e.deltaY, isCtrl);
      return;
    }
  }, { passive: false });

  // 鼠标瞄准——视野(FPS 式,黄点钉死屏心)先吃增量,真实炮塔在主循环里按炮塔转速限幅追踪。
  // 指针锁定吃 movementX/Y 无限增量;兼容模式(沙箱拒锁)按 clientX 差分(屏幕边缘会顶死,属已知退化)。
  addEventListener('mousemove', function (e) {
    if (isGhostMouse(e)) return;    // 触屏合成事件不是鼠标:放行会让"点一下"变成大幅转视角(见上面的根因注释)
    if (gameState !== 'playing' || !player || !player.alive) return;
    if (artyTopActive()) {                             // 火箭炮俯视火控:自由光标装定,不吃视角增量
      artTopNX = e.clientX / innerWidth * 2 - 1;
      artTopNY = -(e.clientY / innerHeight * 2 - 1);
      return;
    }
    // ★指针锁定时 clientX 冻结,必须吃 movement 增量(否则一锁定=瞄死);未锁定时有 client 源按真实位置差分
    var _st = aimInputStep(e, pointerLocked && typeof e.movementX === 'number', aimPX, aimPY, innerWidth, innerHeight);
    var dxC = _st.dx, dyC = _st.dy;
    aimPX = _st.bx; aimPY = _st.by;
    aimApplyDelta(dxC, dyC);                  // 灵敏度/倍率补偿/火箭炮装定分支单一实现(触屏滑动共用)
  });

  document.addEventListener('pointerlockchange', function () {
    var nowLocked = (document.pointerLockElement === renderer.domElement);
    if (nowLocked) window._pointerPauseArmed = true;
    // 仅「已经锁上过、现在丢掉」才暂停。进局 exitPointerLock / 从未锁成功 不得误开暂停。
    if (window._pointerPauseArmed && !nowLocked && gameState === 'playing' && lockAvailable && !respawnUiOpen && !possessUiOpen) {
      window._pointerPauseArmed = false;
      gameState = 'paused';
      if (window.CrazyGamesAdapter) window.CrazyGamesAdapter.gameplayStop();
      el.pauseov.classList.remove('hidden');
      if (typeof sfxUiDi === 'function') sfxUiDi(2);
    }
    pointerLocked = nowLocked;
    updateLockHint();
  });
  document.addEventListener('pointerlockerror', function () {
    lockAvailable = false;
    pointerLocked = false;
    setTimeout(function () { lockAvailable = true; }, 1600);   // ESC 后短暂冷却(~1.25s)内重锁也会触发 error:冷却后允许再锁;硬性沙箱拒绝=每次点击重试一次,无害
    updateLockHint();
  });

}
function lockPointer() {

  // 起恢复指针锁定:第三人称也全面 FPS 化(黄点钉死屏心、视野吃鼠标增量),
  // 必须有指针锁定提供不受屏幕边缘限制的无限增量;锁定被拒绝(iframe 沙箱等)自动退兼容模式(自由光标差分)
  if (!lockAvailable) return;
  var c = renderer.domElement;
  function requestFallback() {
    try {
      var fb = c.requestPointerLock();
      // requestPointerLock() may return a rejected Promise in sandboxed/headless
      // previews; consume it so a denied lock cannot become an unhandled rejection.
      if (fb && typeof fb.catch === 'function') fb.catch(function () {});
    } catch (e) {}
  }
  try {
    var r = c.requestPointerLock({ unadjustedMovement: true });
    if (r && typeof r.catch === 'function') r.catch(requestFallback);
  } catch (err) {
    requestFallback();
  }

}
function attemptLock() {

  lockPointer();
  // 不设"超时未锁即永久禁用":ESC 解锁后的浏览器冷却期(~1.25s)内重锁必然失败,
  // 永久禁用会让整局退化为兼容模式;失败统一交给 pointerlockerror 的冷却重开处理

}
function updateLockHint() {

  // 锁定/兼容模式文字提示不显示,只保持元素隐藏
  if (!el.lockhint) return;
  el.lockhint.classList.add('hidden');

}

/* ============================================================
   触屏操控层——纯事件驱动,零逐帧:
   · 左半屏摇杆驱动车体(touchJoy* 模拟量,playerUpdate 消费;摇杆=左下角常驻,位置/大小进自定义编辑器);
   · 右半屏单指滑动=瞄准(与鼠标共用 aimApplyDelta 单一实现);
   · 右半屏双指缩放=炮镜倍率:张开跨越 1.15× 自动开镜(scopeToggle 共用),
     捏合回 1× 自动关镜;镜内连续变焦 1~20×(与滚轮同 clamp);
   · 漫画风开火键(#tfire)=mouseDown 同位;炮镜键(#tscope)=scopeToggle;弃车键(#tquit)=KeyJ 同位;
     返回菜单键(#tmenu)=呼出暂停菜单;指挥模式键(#tsqb)=单击进出指挥模式(组员头顶星)+战术标识同步开关;
     全键漫画基类 .tbtn 统一(纸白+墨描边+硬投影),位置/大小可进自定义编辑器;
   · 仅粗指针设备挂载(桌面零监听器);菜单/按钮触摸不拦截(交还浏览器合成 click)。
   ============================================================ */
(function () {
  /* Touch controls are a supported production input path. Detect coarse/touch
     capable browsers at boot so #tfire and the touch weapon path are mounted
     on phones, tablets, and touch laptops while desktop listeners stay off. */
  var TOUCH_ON = !!((typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    (typeof window !== 'undefined' && 'ontouchstart' in window) ||
    (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
  window._touchUISync = function () {};
  /* 瞄准灵敏度滑条:倍数=滑条值直读(≤1 归 1;默认 3×,最高 10×);鼠标/触屏同吃,桌面同样生效故绑定在 TOUCH_ON 门前。
     旧映射 1+0.9v 已废(默认改 3 倍时同步简化);旧存档值按新口径直读,偏差 ≤10% 一次性可接受。 */
  var si = document.getElementById('sensinput'), sv = document.getElementById('sensval');
  function sensApply(v) {
    aimSensMul = v > 1 ? v : 1;
    if (sv) sv.textContent = '×' + aimSensMul.toFixed(1);
  }
  if (si) {
    var sv0 = 3;
    try { var _sp = parseFloat(localStorage.getItem('prefAimSens')); if (!isNaN(_sp)) sv0 = _sp; } catch (e) {}
    si.value = sv0; sensApply(sv0);
    si.addEventListener('input', function () {
      var v = parseFloat(si.value) || 0;
      sensApply(v);
      try { localStorage.setItem('prefAimSens', String(v)); } catch (e) {}
    });
  }
  /* 击杀信息开关(默认开;桌面同吃故绑定在 TOUCH_ON 门前) */
  var kb = document.getElementById('killmsgbtn');
  try { if (localStorage.getItem('prefKillMsg') === '0') killMsgOn = false; } catch (e) {}
  function kbRender() {
    if (!kb) return;
    kb.textContent = 'Kill feed: ' + (killMsgOn ? 'On' : 'Off');
    kb.classList.toggle('sel', killMsgOn);       // 开启态变色(与帧率显示按钮同款 .sel 琥珀选中态)
  }
  if (kb) {
    kbRender();
    kb.addEventListener('click', function () {
      killMsgOn = !killMsgOn;
      try { localStorage.setItem('prefKillMsg', killMsgOn ? '1' : '0'); } catch (e) {}
      kbRender();
    });
  }
  var cb = document.getElementById('custbtn');   // 自定义按钮入口(手势操作,桌面隐藏)
  if (!TOUCH_ON) { if (cb) cb.classList.add('hidden'); return; }   // 桌面(精确指针):零监听器零 DOM 显示

  var base = document.getElementById('tjoy'), knob = document.getElementById('tjoyknob');
  var fire = document.getElementById('tfire');
  var scpBtn = document.getElementById('tscope'), quitBtn = document.getElementById('tquit');
  var menuB = document.getElementById('tmenu'), cmdB = document.getElementById('tsqb');
  var capB = document.getElementById('tcap'), folB = document.getElementById('tfol');   // 指挥指令键(占领/跟随,仅指挥模式显示)
  var nvB = document.getElementById('tnv'), sense = document.getElementById('tsense');
  var thB = document.getElementById('tth');
  var lasB = document.getElementById('tlas');   // 激光压制键(仅RED-MBT-2;PC 右键长按 _rmbHeld 同源)
  var heliU = document.getElementById('theliu'), heliD = document.getElementById('thelid');   // H1:直升机双十字键容器
  /* 战术雷达 MFD(直升机 / 红方 RED-AA 车载搜索雷达)与它的宿主 #hud:
     MFD 本身由 player.js 的 renderHeliRadarMFD 每帧驱动显隐,这里只负责它在编辑器里的位置/大小。 */
  var mfdB = document.getElementById('heliradarmfd'), hudRoot = document.getElementById('hud');
  var JOY_R0 = 62;                               // 摇杆行程半径基准 px(=底盘半径,knob 顶到缘=满舵;×自定义缩放)
  /* ===== 自定义布局:{id:{fx,fy,s}}=视口分数中心坐标+缩放;无条目=CSS 默认位(零回归) ===== */
  var tlay = {};
  try { tlay = JSON.parse(localStorage.getItem('prefTouchLayout') || '{}') || {}; } catch (e) { tlay = {}; }
  var custOn = false, custWork = null;           // 编辑模式开关/工作副本(保存并退出才落 tlay)
  function curLay() { return custOn ? custWork : tlay; }
  function joyS() { var L = curLay().tjoy; return L && L.s ? L.s : 1; }
  function JOY_R() { return JOY_R0 * joyS(); }
  /* 摇杆感应圈:圆形,恒比摇杆大(下限=杆半径+24px 硬保证),独立缩放(tsense.s),
     圆心恒=摇杆心(相对位置固定,拖杆同拖圈);运行期隐形纯逻辑判定,自定义界面可视 */
  var SENSE_R0 = 110;
  function senseS() { var L = curLay().tsense; return L && L.s ? L.s : 1; }
  function senseR() { return Math.max(JOY_R() + 24, SENSE_R0 * senseS()); }
  function inSense(x, y) { var dx = x - fixedCX(), dy = y - fixedCY(); return dx * dx + dy * dy <= senseR() * senseR(); }
  var CTL_W = { tfire: { w: 84, h: 84 }, tscope: { w: 64, h: 64 }, tquit: { w: 64, h: 64 },
                tmenu: { w: 52, h: 52 }, tsqb: { w: 64, h: 64 }, tnv: { w: 64, h: 64 },
                tth: { w: 64, h: 64 }, tcap: { w: 64, h: 64 }, tfol: { w: 64, h: 64 },
                tlas: { w: 52, h: 52 },
                theliu: { w: 146, h: 146 }, thelid: { w: 146, h: 146 }, heliradarmfd: { w: 200, h: 251 } };
  /* CSS 基准宽高(transform scale 不改布局盒,居中定位用;弃车/热成像与其余同 64,仅开火 84)。
     heliradarmfd 高 251 是 CSS 推算值(2 边框 + 6 内边距)×2 + 顶栏 17.2 + 显示区 180 + 底栏 30 + 2×4 间距;
     它只作"元素隐藏时"的兜底,可见时一律用下面的 ctlBox 实测,所以不受字体渲染差异影响。 */
  function ctlBox(id, el2) {                     // 元素布局盒尺寸:offsetWidth/Height 不含 transform:scale,缩放后仍是基准盒
    var w = el2.offsetWidth, h = el2.offsetHeight, c = CTL_W[id];
    if (!w || !h) { w = c ? c.w : 0; h = c ? c.h : 0; }   // display:none(offset 全 0)时回落 CSS 基准表
    return { w: w, h: h };
  }
  function layApply() {                          // 布局落地(事件级:进出编辑/拖动/缩放/转屏时调)
    var L = curLay(), m = { tfire: fire, tscope: scpBtn, tquit: quitBtn, tmenu: menuB, tsqb: cmdB, tnv: nvB, tth: thB, tcap: capB, tfol: folB, tlas: lasB, theliu: heliU, thelid: heliD, heliradarmfd: mfdB }, id, el2, e3, bx;
    for (id in m) {
      el2 = m[id]; if (!el2) continue;
      e3 = L[id];
      if (e3) {
        bx = ctlBox(id, el2);                    // 用实测盒尺寸居中:MFD 高度由内容撑开(非固定值),硬编码会偏
        el2.style.left = (e3.fx * innerWidth - bx.w / 2) + 'px';
        el2.style.top = (e3.fy * innerHeight - bx.h / 2) + 'px';
        el2.style.right = 'auto'; el2.style.bottom = 'auto'; el2.style.marginTop = '0';
        el2.style.setProperty('--ts', e3.s || 1);
      } else {
        el2.style.left = el2.style.top = el2.style.right = el2.style.bottom = el2.style.marginTop = '';
        el2.style.removeProperty('--ts');
      }
    }
    var s = joyS();
    base.style.width = 124 * s + 'px'; base.style.height = 124 * s + 'px';
    knob.style.width = 54 * s + 'px'; knob.style.height = 54 * s + 'px';
    if (sense) {                                 // 感应圈:圆心=摇杆心,直径=2×senseR(含比杆大下限)
      var sr = senseR();
      sense.style.width = sense.style.height = sr * 2 + 'px';
      sense.style.left = fixedCX() + 'px'; sense.style.top = fixedCY() + 'px';
    }
    if (joyId == null) baseTo(fixedCX(), fixedCY(), 0, 0);
  }
  addEventListener('resize', layApply);          // 事件级:转屏/窗口变化重排(坐标为视口分数)
  var joyId = null, joyCX = 0, joyCY = 0;        // 摇杆触点 id 与杆心
  var aimId = null, aimLX = 0, aimLY = 0;        // 瞄准触点 id 与上次坐标
  var p2Id = null, p2X = 0, p2Y = 0;             // 缩放第二指
  var pinchD0 = 0, pinchZ0 = 1;                  // 捏合基准距离/基准倍率(虚拟倍率:未开镜=1)
  var fireId = null, quitId = null, lasId = null;   // 开火/弃车/激光触点 id(松手复位)
  /* ===== 开火键兼任瞄准摇杆(H2:边开火边瞄准)=====
     按住 #tfire 期间手指在屏幕上滑动即转动视角(与右半屏滑动共用 aimApplyDelta 单一实现),
     于是开火与瞄准可以同时进行,不必把手指从开火键上挪开 —— 这就是"开火键当摇杆用"。
     手感三条:
     · 死区 FIRE_AIM_DZ:按下后前 8px 视为手抖,不转视角 —— 纯点按开火不会带偏准星;
     · 越过死区的那一帧只"起算"(把基准重置到当前位置),不把死区内的位移补成增量,
       否则会重演"一点就大幅转视角"的老问题;
     · 起算之后按增量累加,灵敏度/倍率补偿/俯视火控分支全部与屏幕滑动同源。
     仅触屏层挂载(桌面无监听器);开火语义(mouseDown)完全不变。 */
  var FIRE_AIM_DZ = 8;                          // 开火键瞄准死区(px)
  var fireAimX = 0, fireAimY = 0, fireAimOn = false;   // 瞄准基准点/是否已越过死区

  function playing() { return gameState === 'playing' && player && player.alive && !respawnUiOpen && !possessUiOpen; }
  function uiSync() {                            // 事件驱动显隐(开战/结算/切模式时调;无逐帧检查)
    if (custOn) return;                          // 编辑模式:显隐由 custShow 全权接管
    var on = TOUCH_ON && gameState === 'playing';
    if (fire) fire.classList.toggle('hidden', !on);
    if (scpBtn) scpBtn.classList.toggle('hidden', !on);
    if (quitBtn) quitBtn.classList.toggle('hidden', !on);
    if (menuB) menuB.classList.toggle('hidden', !on);
    if (nvB) {
      nvB.classList.toggle('hidden', !on || (typeof playerHasNV !== 'undefined' && !playerHasNV));   // 座车无夜视仪(基础坦克)=隐藏;编辑器内由 custShow 全量显示
      if (on) nvB.classList.toggle('lit', typeof nvOn !== 'undefined' && !!nvOn);   // 点亮态跟随夜视开关记忆(任意视角)
    }
    if (thB) {
      thB.classList.toggle('hidden', !on || (typeof playerHasTH !== 'undefined' && !playerHasTH));   // 座车无热成像(高阶主战坦克 外)=隐藏;编辑器内由 custShow 全量显示
      if (on) thB.classList.toggle('lit', typeof thermalOn !== 'undefined' && !!thermalOn);   // 点亮态跟随热像开关记忆(任意视角)
    }
    if (lasB) {   // 激光压制键:仅RED-MBT-2座车显示(与 PC 右键长按 _rmbHeld 同源;炮镜门在 updateLws,不在此)
      var lasOn = on && player && player.alive && player.kind === '99';
      lasB.classList.toggle('hidden', !lasOn);
      if (!lasOn) {   // 藏键=照射必停:防换车/结算瞬间手指还按着导致 _rmbHeld 幽灵常真
        lasB.classList.remove('pressed', 'firing', 'cooling');
        if (lasId != null) { lasId = null; _rmbHeld = false; }
      }
    }
    if (sense && !custOn) sense.classList.add('hidden');   // 感应圈:运行期恒隐形(纯逻辑判定,仅编辑器可视)
    if (cmdB) {
      cmdB.classList.toggle('hidden', !on || isFfaMode());
      if (on && !isFfaMode() && player) {        // 个人死斗不显示/启用指挥官小队入口
        // 指挥键图标随玩家阵营着色(红方红/蓝方蓝)+点亮态跟随指挥模式开关
        var sf2 = document.getElementById('tsqbfill');
        if (sf2) sf2.setAttribute('fill', player.team === 'red' ? '#c81e12' : '#2f6fd0');
        cmdB.classList.toggle('lit', typeof sqCmd !== 'undefined' && !!sqCmd.active);
      }
    }
    /* 指挥指令键(占领/跟随):仅指挥模式显示(Z/X 同入口);点亮态=当前指令(进模式默认跟随) */
    var cmdOn = on && !isFfaMode() && typeof sqCmd !== 'undefined' && !!sqCmd.active;
    if (capB) { capB.classList.toggle('hidden', !cmdOn); capB.classList.toggle('lit', cmdOn && sqCmd.order === 'occupy'); }
    if (folB) { folB.classList.toggle('hidden', !cmdOn); folB.classList.toggle('lit', cmdOn && sqCmd.order !== 'occupy'); }
    var isH = on && isHeliMode();                                    // H4:直升机=双十字键,地面车=摇杆(互斥)
    if (heliU) heliU.classList.toggle('hidden', !isH);
    if (heliD) heliD.classList.toggle('hidden', !isH);
    if (base) {
      base.classList.toggle('hidden', !on || isH);                       // 摇杆=地面车常驻;直升机让位双十字键
      if (on && !isH && joyId == null) baseTo(fixedCX(), fixedCY(), 0, 0);
    }
    if (isH && joyId != null) joyDrop();                             // 切入直升机:摇杆输入清零防幽灵
    if (!isH) heliReleaseAll();                                      // 离开直升机/离局:十字键全松防卡键
  }
  function fixedCX() { var L = curLay().tjoy; return L ? L.fx * innerWidth : 24 + JOY_R() + 8; }
  function fixedCY() { var L = curLay().tjoy; return L ? L.fy * innerHeight : innerHeight - 24 - JOY_R() - 8; }
  function baseTo(cx, cy, kx, ky) {
    base.style.left = cx + 'px'; base.style.top = cy + 'px';
    knob.style.transform = 'translate(-50%,-50%) translate(' + kx + 'px,' + ky + 'px)';
  }
  function joyDrop() {
    joyId = null; touchJoyOn = false; touchJoyX = 0; touchJoyY = 0;
    baseTo(fixedCX(), fixedCY(), 0, 0);
  }
  function pinchDrop(tid) {                      // 双指其一抬起:余指顺位转瞄准指
    if (tid === p2Id) { p2Id = null; return; }
    if (tid === aimId) { aimId = p2Id; aimLX = p2X; aimLY = p2Y; p2Id = null; }
  }
  /* ===== 直升机双十字键(H3/H4):上=总距/偏航,下=姿态;与摇杆互斥(isHeliMode 门) ----
     上-上/下:heliHandleWheel 点按=1% 微调,长按 180ms 连发=10% 快调;点火/熄火守卫由桌面函数内建(D3);
     上-左/右:虚拟 KeyQ/KeyE(偏航);下四向:虚拟 KeyW/S/A/D(姿态);player.js 零改动。 ===== */
  function isHeliMode() { return typeof isHeliVehicle === 'function' && typeof player !== 'undefined' && player && isHeliVehicle(player); }
  var HELI_KEY = { ul: 'KeyQ', ur: 'KeyE', du: 'KeyW', dd: 'KeyS', dl: 'KeyA', dr: 'KeyD' };
  var heliTouch = {};   // dir -> { tid, el }:已按下的十字键方向(多指并发)
  var heliRep = {};     // uu/ud -> setInterval id(总距长按连发)
  function heliStep(dir, coarse) {
    if (typeof heliHandleWheel !== 'function') return;
    heliHandleWheel(dir === 'uu' ? -100 : 100, !!coarse);
  }
  /* 子键方向解析:从触点目标逐级向上找最近的 [data-hd](按钮本体或其内部 SVG/路径)。
     禁用"按类名 closest 反查"那套旧写法——旧按钮是纯文字(target 恒为 button 本体),
     新线稿按钮内部是 svg/path;部分 Android WebView 的 SVG 元素没有 closest,
     届时守卫直接判空=双垫按键全灭/错乱。parentNode 链在任何 DOM 实现里都可用,
     与旧写法一致处行为逐位相同(探针见 Temp/opencode/closestprobe.html,已清理)。
     (2026-09-13 双垫按键错乱事故根因;回归见 verify_heli_dpad.js E 组) */
  function heliDirFromTarget(tgt) {
    var n = tgt;
    while (n) {
      if (n.getAttribute) {
        var d = n.getAttribute('data-hd');
        if (d) return d;
      }
      n = n.parentNode;
    }
    return null;
  }
  /* 十字键方向解析·坐标制(2026-09-13 双垫"按哪都是下"事故后升为主路径):
     触点坐标相对垫容器矩形按 3×3 九宫格归位,与 DOM 目标/closest/svg 实现全脱钩——
      * 老 WebView 的 SVG 无 closest;
     * 任何"目标错位"(错垫/串键/落点漂移)都不可能发生:坐标即真理。
     布局保证:垫容器恒为 3×3 等分网格(行列 46px+4px 间隙,见 CSS #theliu/#thelid),
     自定义编辑器只整体移动/缩放容器,格占比恒为三分之一;变换后的 rect 与
     clientX/Y 同为视口坐标,直接可比。核心格与垫外一律 null(不误触)。
     DOM 步查 heliDirFromTarget 降为回落(矩形不可用时)。 */
  function heliDirFromPoint(hostId, cx, cy) {
    var host = hostId === 'theliu' ? heliU : heliD;
    if (!host || !host.getBoundingClientRect) return null;
    var r = host.getBoundingClientRect();
    if (!r || !(r.right > r.left) || !(r.bottom > r.top)) return null;
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
    var cw = (r.right - r.left) / 3, ch = (r.bottom - r.top) / 3;
    var col = ((cx - r.left) / cw) | 0, row = ((cy - r.top) / ch) | 0;
    if (col < 0) col = 0; else if (col > 2) col = 2;
    if (row < 0) row = 0; else if (row > 2) row = 2;
    var idx = row * 3 + col;
    if (hostId === 'theliu') return idx === 1 ? 'uu' : idx === 3 ? 'ul' : idx === 5 ? 'ur' : idx === 7 ? 'ud' : null;
    return idx === 1 ? 'du' : idx === 3 ? 'dl' : idx === 5 ? 'dr' : idx === 7 ? 'dd' : null;
  }
  function heliSubEl(dir) {
    var host = (dir === 'uu' || dir === 'ud' || dir === 'ul' || dir === 'ur') ? heliU : heliD;
    if (!host || !host.querySelector) return null;
    return host.querySelector('[data-hd="' + dir + '"]');
  }
  function heliPress(dir, tid) {
    if (!dir || heliTouch[dir]) return;
    var sub = heliSubEl(dir);
    heliTouch[dir] = { tid: tid, el: sub };
    if (sub) sub.classList.add('pressed');
    if (dir === 'uu' || dir === 'ud') {
      if (heliRep[dir]) { clearInterval(heliRep[dir]); heliRep[dir] = null; }   // 防御:同向旧 interval 残留即泄漏为"一直在下压/上提";正常路径到不了这里
      heliStep(dir, false);
      (function (d) { heliRep[d] = setInterval(function () { heliStep(d, true); }, 180); })(dir);
    } else {
      keys[HELI_KEY[dir]] = true;
      if ((dir === 'du' || dir === 'dd' || dir === 'dl' || dir === 'dr') &&   // 姿态键:不可移动提示(与摇杆按下沿同口径)
          player && player.alive && typeof playerImmobile === 'function' && playerImmobile() &&
          typeof aimHint === 'function') aimHint('IMMOBILE');
    }
  }
  function heliRelease(dir) {
    var h = heliTouch[dir]; if (!h) return;
    if (heliRep[dir]) { clearInterval(heliRep[dir]); heliRep[dir] = null; }
    if (HELI_KEY[dir]) keys[HELI_KEY[dir]] = false;
    if (h.el) h.el.classList.remove('pressed');
    delete heliTouch[dir];
  }
  function heliReleaseByTid(tid) { for (var dir in heliTouch) if (heliTouch[dir].tid === tid) heliRelease(dir); }
  function heliHasTid(tid) { for (var dir in heliTouch) if (heliTouch[dir].tid === tid) return true; return false; }
  function heliReleaseAll() { for (var dir in heliTouch) heliRelease(dir); }
  var TCTL_IDS = ['tfire', 'tscope', 'tquit', 'tmenu', 'tsqb', 'tnv', 'tth', 'tcap', 'tfol', 'tlas', 'theliu', 'thelid'];   // 触控层自有键 ID 表(uiTarget/ctrlOf 共用单一出处;tlas=99式激光压制)
  /* ===== 触屏上靠"浏览器合成 click"驱动的 HUD 控件(div 结构,非 <button>) =====
     武器切换栏 #heliweaponbar 及其三个选项。这些控件不是触控层操控键(不参与按压语义),
     但同样必须放行合成 click —— 否则会掉进本段末尾那句 e.preventDefault(),
     合成 click 被一起吞掉,表现就是「安卓端点它毫无反应、桌面鼠标却一切正常」。
     注意:hwp 选项是 div,不会命中下面的 BUTTON/INPUT/A/SELECT 标签放行规则,
     所以必须在这里按 id 显式登记。新增同类 HUD 控件时记得一并加进来。 */
  var TAP_UI_IDS = ['heliweaponbar', 'hwp-1', 'hwp-2', 'hwp-3', 'hwp-4', 'minimap-panel', 'minimap-cv'];   // ★移动端:小地图点按切换大小
  function uiTarget(t) {                         // 菜单/按钮/滑杆触摸不拦截(浏览器合成 click 接管);触控层自有键除外
    var n = t; while (n && n !== document.body) {
      if (TCTL_IDS.indexOf(n.id) >= 0) return false;   // 触控层自有键走触摸处理(button 标签不得被菜单放行规则吞掉)
      /* 十字键子键(.theli-sub)无 id,单靠上面的 id 表认不出:它在同一层就撞上下面的 BUTTON 分支,
         被误判成"菜单按钮"放行给浏览器合成 click,触摸永远到不了 heliPress —— 这就是十字键整体失效的根因。
         触控层自有按钮统一带 .tbtn 基类(class 判定与 id 判定同层,顺序必须在标签名判定之前),
         故此处按类归位为触控层元素;其余菜单按钮用 .optbtn/.bigbtn/.mm-*,不受影响。 */
      if (n.classList && n.classList.contains('tbtn')) return false;
      if (TAP_UI_IDS.indexOf(n.id) >= 0) return true;  // 点击型 HUD 控件:放行合成 click(div 结构,标签规则认不出)
      if (n.tagName === 'BUTTON' || n.tagName === 'INPUT' || n.tagName === 'A' || n.tagName === 'SELECT') return true;
      n = n.parentNode;
    }
    return false;
  }
  function ctrlOf(t) {                           // 触点所属触控键(SVG 子节点向上归并)
    var n = t; while (n && n !== document.body) {
      if (TCTL_IDS.indexOf(n.id) >= 0) return n.id;
      n = n.parentNode;
    }
    return null;
  }

  document.addEventListener('touchstart', function (e) {
    markTouchInput();                                        // 幽灵鼠标过滤基准:本次触摸之后 400ms 内合成的鼠标事件一律丢弃
    if (custOn) { edStart(e); return; }                      // 自定义布局编辑模式:触摸全交编辑器
    if (uiSyncQ) { uiSyncQ = false; uiSync(); }              // 状态迁移后的惰性同步点
    if (gameState === 'playing' && ctrlOf(e.target) === 'tmenu') {   // 返回菜单键置 playing() 门前:复活/接管界面开着同样可用
      gameState = 'paused'; el.pauseov.classList.remove('hidden');   // 呼出暂停菜单(明确暂停意图,复活/接管界面开着同样放行)
      if (typeof sfxUiDi === 'function') sfxUiDi(2);
      uiSync(); e.preventDefault(); return;
    }
    if (!playing() || uiTarget(e.target)) return;
    var i, t, cid;
    for (i = 0; i < e.changedTouches.length; i++) {
      t = e.changedTouches[i];
      cid = ctrlOf(t.target);
      if (cid === 'tfire') {                                   // 开火键:按下=持续开火(mouseDown 同位)
        fireId = t.identifier; mouseDown = true; fire.classList.add('pressed');
        fireAimX = t.clientX; fireAimY = t.clientY; fireAimOn = false;   // 同时就位为瞄准摇杆(越过死区才真正生效)
      } else if (cid === 'tscope') {                           // 炮镜键:点按开关(Shift 同一实现)
        scopeToggle(); scpBtn.classList.toggle('lit', scopeMode);
      } else if (cid === 'tquit') {                            // 弃车键:长按 3s(KeyJ 同位,倒数/红环/松手复位全链复用)
        quitId = t.identifier; keys.KeyJ = true; quitBtn.classList.add('pressed');
      } else if (cid === 'tsqb') {                             // 指挥模式键:战术标识/指挥星与指挥模式同步开关(Backspace 同入口)
        if (gameState === 'playing' && player && player.alive) {
          if (isHeliVehicle(player) && typeof heliABGToggle === 'function') heliABGToggle();   // 直升机座舱= A射B导
          else if (typeof sqCmdToggle === 'function') sqCmdToggle();
        }
        if (cmdB) cmdB.classList.toggle('lit', typeof sqCmd !== 'undefined' && !!sqCmd.active);
      } else if (cid === 'tcap') {                             // 占领键:指挥模式内把小队派往屏心落点(插旗);Z 同入口
        sqCmdOrderOccupyAtCursor();
      } else if (cid === 'tfol') {                             // 跟随键:撤销占领收旗回跟随(进模式默认);X 同入口
        if (typeof sqCmd !== 'undefined' && sqCmd.active) sqCmdOrderSet('follow', 0, 0);
      } else if (cid === 'theliu' || cid === 'thelid') {           // H3:直升机十字键(容器命中,方向由触点坐标九宫格判定)
        var hdir = heliDirFromPoint(cid, t.clientX, t.clientY);   // 主路径:坐标制(与 DOM/closest 无关)
        if (hdir == null) hdir = heliDirFromTarget(t.target);     // 回落:矩形不可用时 DOM 步查
        heliPress(hdir, t.identifier);
      } else if (cid === 'tnv') {                              // 夜视仪键:任意视角开关(KeyN 同语义;设备门=座车装备缓存;阵亡/换装自动失效由 nvActive 兜底)
        if ((typeof playerHasNV === 'undefined' || playerHasNV) && player && player.alive && typeof nvSync === 'function') {
          nvOn = !nvOn; nvSync(); nvB.classList.toggle('lit', nvOn);
          if (thB) thB.classList.toggle('lit', typeof thermalOn !== 'undefined' && !!thermalOn);   // 互斥后热像灯随动
        }
      } else if (cid === 'tth') {                              // 热成像键:任意视角开关(KeyH 同语义;与夜视互斥;设备门=高阶主战坦克;阵亡/换装自动失效由 thermalActive 兜底)
        if ((typeof playerHasTH === 'undefined' || playerHasTH) && player && player.alive && typeof thermalSync === 'function') {
          thermalOn = !thermalOn; thermalSync(); thB.classList.toggle('lit', thermalOn);
          if (nvB) nvB.classList.toggle('lit', typeof nvOn !== 'undefined' && !!nvOn);             // 互斥后夜视灯随动
        }
      } else if (cid === 'tlas') {                           // 激光压制键(仅RED-MBT-2):按住=照射,松手=停(PC 右键长按 _rmbHeld 同源;炮镜/距离/冷却门全在 updateLws)
        if (player && player.alive && player.kind === '99') {
          lasId = t.identifier; _rmbHeld = true; if (lasB) lasB.classList.add('pressed');
        }
      } else if (!isHeliMode() && joyId == null && inSense(t.clientX, t.clientY)) {
        /* 摇杆:感应圈内按下(圈外左半屏落瞄准分支) */
        joyId = t.identifier;
        joyCX = fixedCX();
        joyCY = fixedCY();
        base.classList.remove('hidden');
        joyVec(t.clientX, t.clientY);
        if (player && player.alive && !artyTopActive() && typeof playerImmobile === 'function' && playerImmobile() &&
            typeof aimHint === 'function') aimHint('IMMOBILE');   // 摇杆按下沿提示(俯视火控=摇杆平移镜头,不涉驾驶,不提示)
      } else {                                                 // 其余区域(右半屏+感应圈外的左半屏):瞄准/双指缩放
        if (artyTopActive()) {                                 // 火箭炮俯视火控:单指按下=装定光标跳到触点
          artTopNX = t.clientX / innerWidth * 2 - 1;
          artTopNY = -(t.clientY / innerHeight * 2 - 1);
        }
        if (aimId == null) { aimId = t.identifier; aimLX = t.clientX; aimLY = t.clientY; }
        else if (p2Id == null) {
          p2Id = t.identifier; p2X = t.clientX; p2Y = t.clientY;
          pinchD0 = Math.max(20, Math.hypot(p2X - aimLX, p2Y - aimLY));
          pinchZ0 = scopeMode ? scopeZoom : 1;
        }
      }
    }
    e.preventDefault();                                      // 战斗中触摸不产生滚动/合成鼠标事件
  }, { passive: false });

  function joyVec(x, y) {
    var R = JOY_R();
    var dx = x - joyCX, dy = y - joyCY, l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    touchJoyOn = true; touchJoyX = dx / R; touchJoyY = -dy / R;   // 屏幕 y 下正 → 前进为正
    baseTo(joyCX, joyCY, dx, dy);
  }

  /* 开火键滑动=瞄准(死区外生效)。返回前不改变开火语义:mouseDown 恒为按下状态。
     起算帧的"重置基准而不补位移"是防瞬转的关键 —— 与幽灵鼠标那次修的其实是同一类错误:
     把"两处无关坐标之差"当成输入增量。 */
  function fireAimMove(t) {
    var adx = t.clientX - fireAimX, ady = t.clientY - fireAimY;
    if (!fireAimOn) {
      if (Math.hypot(adx, ady) < FIRE_AIM_DZ) return;      // 死区内:只开火,不动准星
      fireAimOn = true; fireAimX = t.clientX; fireAimY = t.clientY;   // 越过死区:只起算,不把死区位移补成增量
      return;
    }
    fireAimX = t.clientX; fireAimY = t.clientY;
    if (!playing()) return;
    if (p2Id != null) return;                              // 另一指已进入捏合缩放:让位给缩放,避免双输入打架
    if (artyTopActive()) {                                 // 火箭炮俯视火控:与单指滑动同口径=移动装定光标
      artTopNX = t.clientX / innerWidth * 2 - 1;
      artTopNY = -(t.clientY / innerHeight * 2 - 1);
    } else aimApplyDelta(adx, ady);                        // 余下与屏幕滑动共用同一实现(灵敏度/倍率补偿)
  }

  document.addEventListener('touchmove', function (e) {
    markTouchInput();                                        // 触摸期间持续刷新窗口:滑动中合成的鼠标事件同样要丢
    if (custOn) { edMove(e); return; }
    if (joyId == null && aimId == null && fireId == null) return;
    var i, t;
    for (i = 0; i < e.changedTouches.length; i++) {
      t = e.changedTouches[i];
      if (t.identifier === joyId) joyVec(t.clientX, t.clientY);
      else if (t.identifier === fireId) fireAimMove(t);       // 开火键按住期间滑动=转视角(边打边瞄)
      else if (t.identifier === aimId || t.identifier === p2Id) {
        if (t.identifier === aimId) { var adx = t.clientX - aimLX, ady = t.clientY - aimLY; aimLX = t.clientX; aimLY = t.clientY; }
        else { p2X = t.clientX; p2Y = t.clientY; }
        if (p2Id != null) {                                  // 双指=纯缩放(瞄准增量抑制)
          var d = Math.max(20, Math.hypot(p2X - aimLX, p2Y - aimLY));
          var z = clamp(pinchZ0 * d / pinchD0, 1, 20);       // 与滚轮同 clamp(1~20×)
          if (!scopeMode && z > 1.15) { scopeToggle(); scopeZoom = z; if (scpBtn) scpBtn.classList.add('lit'); }         // 张开跨阈=开镜
          else if (scopeMode && z <= 1.02) { scopeZoom = 1; scopeToggle(); if (scpBtn) scpBtn.classList.remove('lit'); }   // 捏回 1×=关镜(开 1.15/关 1.02 迟滞防抖,同手势可开可关)
          else if (scopeMode) scopeZoom = z;
        } else if (t.identifier === aimId && playing()) {
          if (artyTopActive()) {                               // 火箭炮俯视火控:单指拖动=移动装定光标(绝对位置)
            artTopNX = t.clientX / innerWidth * 2 - 1;
            artTopNY = -(t.clientY / innerHeight * 2 - 1);
          } else aimApplyDelta(adx, ady);                      // 单指=瞄准(鼠标同一入口)
        }
      }
    }
    e.preventDefault();
  }, { passive: false });

  function touchDone(e) {
    markTouchInput();                                        // 合成鼠标事件紧跟 touchend 派发,这里刷新窗口正是最关键的时机
    if (custOn) { edEnd(e); return; }
    var i, t;
    for (i = 0; i < e.changedTouches.length; i++) {
      t = e.changedTouches[i];
      if (t.identifier === joyId) joyDrop();
      else if (t.identifier === fireId) { fireId = null; mouseDown = false; fireAimOn = false; if (fire) fire.classList.remove('pressed'); }
      else if (t.identifier === quitId) { quitId = null; keys.KeyJ = false; if (quitBtn) quitBtn.classList.remove('pressed'); }
      else if (t.identifier === lasId) { lasId = null; _rmbHeld = false; if (lasB) lasB.classList.remove('pressed'); }
      else if (heliHasTid(t.identifier)) heliReleaseByTid(t.identifier);
      else if (t.identifier === aimId || t.identifier === p2Id) pinchDrop(t.identifier);
    }
  }
  document.addEventListener('touchend', touchDone);
  document.addEventListener('touchcancel', touchDone);

  /* ===== 自定义按钮布局编辑器:拖动=移动,按住+双指开合=缩放;重置/保存并退出 ----
     入口=设置页 #custbtn(仅触屏显示);工作副本 custWork,保存才落 tlay+localStorage;
     tjoy 条目=摇杆杆位/大小。全事件驱动。 ===== */
  var custOv = document.getElementById('tcustomov');
  var edId = null, edCtl = null, edX = 0, edY = 0, edP2 = null, edD0 = 1, edS0 = 1;
  function custCtls() { return { tjoy: base, tfire: fire, tscope: scpBtn, tquit: quitBtn, tmenu: menuB, tsqb: cmdB, tnv: nvB, tth: thB, tcap: capB, tfol: folB, tlas: lasB, theliu: heliU, thelid: heliD, heliradarmfd: mfdB, tsense: sense }; }
  function custShow(on) {
    custOn = on;
    /* 跨 IIFE 通知:player.js 的 renderHeliRadarMFD 每帧驱动 MFD 显隐,编辑期间必须让路——
       否则"不在直升机上 / 已回菜单"时它会把 MFD 重新 hidden,编辑器里根本看不见、也就调不了。 */
    window._touchLayoutEditing = !!on;
    if (custOv) custOv.classList.toggle('hidden', !on);
    /* ★雷达 MFD 的层叠问题:#hud 是 position:fixed + z-index:10,自成层叠上下文,
       MFD 自身 z-index 无论多高都盖不过编辑器遮罩(149),更够不到触控键(150)——会被压暗且叠在底层。
       编辑期间临时把它挂到 body 下(与其它触控键同层),退出时放回 #hud。
       CSS 对 #heliradarmfd 用 id 选择器、不依赖父级,JS 侧一律 getElementById,故搬动 DOM 安全。 */
    if (mfdB && hudRoot) {
      var wantHost = on ? document.body : hudRoot;
      if (mfdB.parentNode !== wantHost) wantHost.appendChild(mfdB);
    }
    var m = custCtls(), id;
    for (id in m) if (m[id]) m[id].classList.toggle('hidden', on ? false : (id === 'tsense' ? true : gameState !== 'playing'));   // 感应圈:仅编辑器可视
    if (!on) { edId = edCtl = edP2 = null; }
    layApply();
    if (!on) uiSync();
  }
  if (cb) cb.addEventListener('click', function () { custWork = JSON.parse(JSON.stringify(tlay)); custShow(true); });
  var rstB = document.getElementById('tcreset'), savB = document.getElementById('tcsave');
  if (rstB) rstB.addEventListener('click', function () { custWork = {}; layApply(); });   // 重置=清工作副本回 CSS 默认(不退出,保存才生效)
  if (savB) savB.addEventListener('click', function () {
    tlay = custWork || {};
    try { localStorage.setItem('prefTouchLayout', JSON.stringify(tlay)); } catch (e) {}
    custShow(false);
  });
  function hitCtl(x, y) {                        // 手动命中检测(tjoy pointer-events:none 收不到 target;事件时一次矩形查询)
    var m = custCtls(), order = ['tmenu', 'tquit', 'tlas', 'tsqb', 'tcap', 'tfol', 'tscope', 'tnv', 'tth', 'tfire', 'heliradarmfd', 'theliu', 'thelid', 'tjoy', 'tsense'], i, el2, r;   // tsense 最大置末(内圈优先命中);heliradarmfd 右上角,与右下键区不重叠,顺序仅影响重叠时的归属;tlas 在弃车正上方,与键区无重叠
    for (i = 0; i < order.length; i++) {
      el2 = m[order[i]]; if (!el2) continue;
      r = el2.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return order[i];
    }
    return null;
  }
  function edEnsure(id) {                        // 首次触碰:按当前渲染位建条目
    if (!custWork[id]) {
      var el2 = custCtls()[id], r = el2.getBoundingClientRect();
      custWork[id] = { fx: (r.left + r.width / 2) / innerWidth, fy: (r.top + r.height / 2) / innerHeight,
                       s: id === 'tjoy' ? joyS() : id === 'tsense' ? senseS()
                        : (parseFloat(el2.style.getPropertyValue('--ts')) || 1) };
    }
    return custWork[id];
  }
  function edStart(e) {
    if (uiTarget(e.target)) return;              // 重置/保存按钮走浏览器合成 click
    var i, t2, c2;
    for (i = 0; i < e.changedTouches.length; i++) {
      t2 = e.changedTouches[i];
      if (edId == null) {
        c2 = hitCtl(t2.clientX, t2.clientY);
        if (c2) { edId = t2.identifier; edCtl = c2; edX = t2.clientX; edY = t2.clientY; edEnsure(c2); }
      } else if (edP2 == null) {                 // 按住目标后第二指=缩放基准
        edP2 = t2.identifier;
        edD0 = Math.max(24, Math.hypot(t2.clientX - edX, t2.clientY - edY));
        edS0 = edEnsure(edCtl).s || 1;
      }
    }
    e.preventDefault();
  }
  function edMove(e) {
    var i, t2, L2;
    for (i = 0; i < e.changedTouches.length; i++) {
      t2 = e.changedTouches[i];
      if (t2.identifier === edId) {
        edX = t2.clientX; edY = t2.clientY;
        if (edP2 == null && edCtl) {             // 单指=拖动(中心跟随指尖,视口 4%~96% 夹取防拖丢)
          L2 = edEnsure(edCtl === 'tsense' ? 'tjoy' : edCtl);   // 拖感应圈=拖摇杆(圆心恒同,相对位置固定)
          L2.fx = clamp(edX / innerWidth, 0.04, 0.96);
          L2.fy = clamp(edY / innerHeight, 0.06, 0.94);
          layApply();
        }
      } else if (t2.identifier === edP2 && edCtl) {   // 双指开合=缩放 0.55~2.2(感应圈独立缩放,另有比杆大硬下限)
        L2 = edEnsure(edCtl);
        L2.s = clamp(edS0 * Math.hypot(t2.clientX - edX, t2.clientY - edY) / edD0, 0.55, 2.2);
        layApply();
      }
    }
    e.preventDefault();
  }
  function edEnd(e) {
    var i, t2;
    for (i = 0; i < e.changedTouches.length; i++) {
      t2 = e.changedTouches[i];
      if (t2.identifier === edId) { edId = null; edCtl = null; edP2 = null; }
      else if (t2.identifier === edP2) edP2 = null;
    }
  }

  /* 状态迁移同步:全部入口都是用户点击(开战/继续/复活按钮)——click 冒泡后置位,
     下一次触摸开场惰性刷新;外加立即刷新一次(本次点击本身)。零轮询零逐帧。 */
  var uiSyncQ = false;
  /* 状态迁移同步三通道:①开战/结算入口直挂 _touchUISync(第一时间,治"开局要点一下才显示"——
     菜单按钮动作延迟 48ms,旧 0ms 兜底跑在 gameState 置位之前扑空);②click 兜底延时 120ms
     盖过动作延迟;③下一次触摸惰性刷新。全事件驱动零轮询。 */
  window._touchUISync = uiSync;
  document.addEventListener('click', function () { uiSyncQ = true; setTimeout(uiSync, 120); });
  layApply();                                    // 开机套用已保存布局(无存档=CSS 默认零回归)
  uiSync();
})();

