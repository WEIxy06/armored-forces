
/* ===== Module: main.js ===== */
/* ============================================================
   模块: main.js — 主程序:主循环 + 初始化调用序列(仅调用,无业务逻辑)
   (加载顺序由 index.html MODULES 表决定,勿单独调整)
   ============================================================ */
'use strict';
/* ============================================================
   性能基线:每 2s 窗口统计帧时/分段耗时与场景规模。
   通过 window.__PERF_BASE 可读取最近统计窗口;仅记录计数和耗时,不改变游戏逻辑。
   ============================================================ */
var PERF_BASE = window.__PERF_BASE = window.__PERF_BASE || {
  windowSec: 2, frame: 0, frameMs: 0, frameMax: 0, frameP95: 0,
  stepMs: 0, renderMs: 0, aiMs: 0, aiUnits: 0,
  targetScan: 0, targetPick: 0, threatPick: 0, posture: 0,
  rocketScan: 0, rocketThreats: 0, los: 0, losCands: 0, artyCluster: 0,
  alive: 0, tanks: 0, wreck: 0, shells: 0, samples: new Float64Array(180), _sH: 0, _sN: 0, _acc: 0, _n: 0,   // ★审查A9: 定长环形缓冲(原版 push/shift 满载后每帧 O(n) 移位)
  reset: function () { this.frame = this.frameMs = this.frameMax = this.frameP95 = 0; this.stepMs = this.renderMs = this.aiMs = 0; this.aiUnits = 0; this.targetScan = this.targetPick = this.threatPick = this.posture = 0; this.rocketScan = this.rocketThreats = this.los = this.losCands = this.artyCluster = 0; this._sH = 0; this._sN = 0; this._acc = this._n = 0; }
};
function perfMarkWindow(wallDt, frameMs, stepMs, renderMs) {
  PERF_BASE.frame++; PERF_BASE._acc += wallDt; PERF_BASE._n++;
  if (PERF_BASE._sN < 180) { PERF_BASE.samples[PERF_BASE._sN++] = frameMs; }          // ★审查A9: 环形写(计数器保持原语义: __PERF_BASE 协议只读 .last 汇总值, 不动)
  else { PERF_BASE.samples[PERF_BASE._sH] = frameMs; PERF_BASE._sH = (PERF_BASE._sH + 1) % 180; }
  PERF_BASE.frameMax = Math.max(PERF_BASE.frameMax, frameMs);
  PERF_BASE.frameMs += frameMs; PERF_BASE.stepMs += stepMs; PERF_BASE.renderMs += renderMs;
  if (PERF_BASE._acc >= PERF_BASE.windowSec) {
    var a = PERF_BASE.samples.slice(0, PERF_BASE._sN).sort();   // ★审查A9: 只排有效段(TypedArray.sort 数值序)
    PERF_BASE.frameP95 = a.length ? a[Math.floor(a.length * 0.95)] : 0;
    PERF_BASE.avgFrameMs = PERF_BASE.frameMs / Math.max(1, PERF_BASE.frame);
    PERF_BASE.avgStepMs = PERF_BASE.stepMs / Math.max(1, PERF_BASE.frame);
    PERF_BASE.avgRenderMs = PERF_BASE.renderMs / Math.max(1, PERF_BASE.frame);
    PERF_BASE.alive = aliveList.length; PERF_BASE.tanks = tanks.length; PERF_BASE.wreck = wreckList.length; PERF_BASE.shells = shells.length;
    PERF_BASE.last = { frame: PERF_BASE.frame, avgFrameMs: PERF_BASE.avgFrameMs, p95: PERF_BASE.frameP95, max: PERF_BASE.frameMax, avgStepMs: PERF_BASE.avgStepMs, avgRenderMs: PERF_BASE.avgRenderMs, aiMs: PERF_BASE.aiMs, aiUnits: PERF_BASE.aiUnits, targetScan: PERF_BASE.targetScan, posture: PERF_BASE.posture, rocketScan: PERF_BASE.rocketScan, los: PERF_BASE.los, losCands: PERF_BASE.losCands, alive: PERF_BASE.alive, wreck: PERF_BASE.wreck, shells: PERF_BASE.shells };
    PERF_BASE.frame = PERF_BASE.frameMs = PERF_BASE.frameMax = PERF_BASE.stepMs = PERF_BASE.renderMs = 0; PERF_BASE.aiMs = 0; PERF_BASE.aiUnits = 0; PERF_BASE.targetScan = PERF_BASE.targetPick = PERF_BASE.threatPick = PERF_BASE.posture = 0; PERF_BASE.rocketScan = PERF_BASE.los = PERF_BASE.artyCluster = 0; PERF_BASE.losCands = 0; PERF_BASE._sH = 0; PERF_BASE._sN = 0; PERF_BASE._acc = PERF_BASE._n = 0;
  }
}
var __PERF = null;               // 调试分段计时(仅 _dbgPerfOn 时启用)
function step(dt) {
  gameT += dt;
  _heliLosBudget = HELI_LOS_BUDGET_PER_FRAME;   // 方案1:每帧重置全局直升机 LOS 射线预算(玩家优先消费,AI 竞用余量)
  var __pt = 0;
  var _perfOn = window._dbgPerfOn;   // 调试模式门(游戏设置页按钮):关闭时零计时开销(生产环境默认关)
  if (_perfOn) {
    if (!__PERF) __PERF = window.__PERF = { n: 0, ai: 0, coll: 0, grid: 0, shells: 0, part: 0, resp: 0, pUp: 0, aiCore: 0, aiCom: 0, wck: 0, losT: 0, steerT: 0, aimT: 0, aiEvade: 0, aiThink2: 0, aiMove: 0 };
    __pt = performance.now();
  }
  var __mark = _perfOn ? function (k) { var _pn = performance.now(); __PERF[k] += _pn - __pt; __pt = _pn; } : function () {};

  playerUpdate(dt);
  playerHudTick();                                       // 载具状态 3D 迷你 HUD:换车引用比较+姿态变更门(未变=零渲染;高亮走事件钩子)
  if (typeof vehicleTechBurstLoadingHudTick === 'function') vehicleTechBurstLoadingHudTick();
  if (typeof vehicleTechBattlefieldRepairHudTick === 'function') vehicleTechBattlefieldRepairHudTick();

  // 开镜状态(Shift 点按切换):平滑过渡 + 测距/弹着仿真节流
  var wantScope = scopeMode && player && player.alive;
  scopeT += ((wantScope ? 1 : 0) - scopeT) * Math.min(1, dt * 7);
  scoped = scopeT > 0.5;
  /* 阴影常开;开镜视锥收窄到视圈,1024 贴图全摊在镜内小区域,PCFSoft 软阴影质量高。 */
  applyScopePerf(scoped, scopeZoom);                       // 开镜 DRS 分档(阴影不动)
  if (scoped) {
    scopeTick -= dt;
    if (scopeTick <= 0) { scopeTick = 0.1; updateScopeInfo(); }
  }
  // 深入开镜后进入第一人称:隐藏自身车体视觉(炮管/制退器不挡画面)
  if (player) {
    var wantVis = player.kind === 'arty' ? true : scopeT < 0.55;   // 火箭炮开镜是俯视火控视野,车体不隐身(俯瞰要看到自己)
    if (ownVisualsVisible !== wantVis) {
      ownVisualsVisible = wantVis;
      setTankVisuals(player, wantVis);
    }
  }
  __mark('pUp');                                 // player+scope 段独立成账(ai 段从此=纯 forEach)
  updateAiGrid();
  var _doT = 0, _eT0 = 0;
  // 性能面板关闭时不读取高精度时钟,避免常驻诊断本身进入热路径。
  var _aiPerfStart = _perfOn ? performance.now() : 0;
  aiScheduler.reset();
  var aiReady = gameT - startT >= AI_START_DELAY;
  aliveList.forEach(function (t) {
    if (t.alive && !t.isPlayer) {
      PERF_BASE.aiUnits++;
      // 开局反应窗内 AI 不更新姿态、装填、躲避、移动或火控；1.5 秒后统一开始行动。
      if (aiReady) {
        if (t.ai) {
          t.ai.postT -= dt;
          if (t.ai.postT <= 0 && aiScheduler.allowPosture()) {
            postureUpdate(t, dt);
          }
        }
        if (_perfOn) _doT = performance.now();
        tickReload(t, dt);                                             // AI 装填同口径
        if (_perfOn) _eT0 = performance.now();
        maybeEvadeRocket(t, dt);                          // 火箭弹躲避(注意力机制:警觉者提前 3s 逃,专注者挨炸才惊觉)
        if (_perfOn) __PERF.aiEvade += performance.now() - _eT0;            // aiCore 子段探针:火箭弹规避耗时
        aiUpdate(t, dt);
        if (_perfOn) __PERF.aiCore += performance.now() - _doT;               // AI 决策核心账(含 evade+think+move+aim 全段)
      }
    }
    if (t.alive && !t.isPlayer) {                      // 旋转写入:玩家由后续玩家段写入(避免重复)
      t.turret.rotation.y = t.turretYaw;
      t.gunPivot.rotation.x = -t.gunPitch;
    }
    if (t.alive) {
      if (_perfOn) _doT = performance.now();
      commonUpdate(t, dt);
      if (_perfOn) __PERF.aiCom += performance.now() - _doT;
      if (DBG_ON) shirkTrack(t, dt);
    }
  });
  /* Control-area capture, force-pool income, and player repair run once after
     all player/AI movement for this simulation step, so entry/exit counts use
     the same positions that the renderer and navigation consumed. */
  if (typeof controlZonesTick === 'function') controlZonesTick(dt);
  if (typeof controlZoneRepairHudTick === 'function') controlZoneRepairHudTick();
  if (_perfOn) PERF_BASE.aiMs += performance.now() - _aiPerfStart;
  __mark('ai');
  engineAudioUpdate(dt);                                // 发动机声浪:玩家/AI 同机理,无 AC 静默早退

  // 玩家炮塔:鼠标经累积器平滑跟随(方向键不控炮塔)
  if (player && player.alive && player.isPlayer) {   // 观战/无玩家席:玩家席为 AI,炮塔由 AI 写入
    var isHeliP = isHeliVehicle(player);
    var curHeliWp = isHeliP ? (player._heliWeapon || 3) : 1;
    var pitchMin, pitchMax;
    if (isHeliP) {
      if (curHeliWp === 3) {
        pitchMin = -89.9 * Math.PI / 180;
        pitchMax = 89.9 * Math.PI / 180;
      } else if (curHeliWp === 2) {
        pitchMin = -60 * Math.PI / 180;
        pitchMax = 0.0;
      } else {
        pitchMin = -80 * Math.PI / 180;
        pitchMax = 0.0;
      }
    } else if (typeof isAAVehicle === 'function' && isAAVehicle(player)) {
      // 任务25:玩家防空载具发射架/机炮伺服包线——RED_AA -5°~+90°(用户设定,可对天顶);蓝方防空车 -10°~+70°。
      // (修复前 AA 落入通用地面车 -0.14~0.3 包线=机炮/发射架物理仰角被钳在 ~17° 的隐性 bug)
      if (player.team === 'red') { pitchMin = -5 * Math.PI / 180; pitchMax = 90 * Math.PI / 180; }
      else { pitchMin = -0.1745; pitchMax = 1.2217; }
    } else {
      pitchMin = -0.14;
      pitchMax = (player.kind === 'arty' ? 1.05 : 0.3);
    }
    var pServoRate = isHeliP ? 3.0 : 1.2;                      // 伺服俯仰速率
    var artyScoped = player.kind === 'arty' && scopeT > 0.5;
    /* 齐射锁与视角无关:第三人称发射、炮镜发射、齐射中途退镜都必须冻结同一发射架快照。 */
    var artyFrozen = player.kind === 'arty' && player.salvoLeft > 0;
    if (artyFrozen) playerArtyApplySalvoLock(player, false);
    // —— FPS 式瞄准:黄色圆点光标永远钉死屏幕正中心,鼠标增量直接驱动视野(camAim,零延迟跟手);
    //    真实炮口只按载具实际炮塔速度追踪(二战慢炮塔限速),#ch 真实炮口准星可见地爬回屏心 ——
    // ★炮镜:车体转角拖拽瞄具视野(潜望镜/瞄准镜架在车里——车体一转,视野里的世界必须同转,不能悬空不动)。
    //    帧首快照只含「上帧末以来」的车体转角(行驶转向/碰撞推移等纯外部来源);瞄准路径(方向键微调/TD 战斗室
    //    伺服追瞄)都发生在本段之内、帧末才回填 _scYaw,天然免疫"炮塔追镜、镜被炮塔拖"的胡萝卜木偶跑飞。
    var hullDy = player._scYaw == null ? 0 : normAng(player.yaw - player._scYaw);
    // ★视线几何真相:第三人称是越肩机位(后 8.4m·高 ~19°),屏心黄点=相机真实视轴 getWorldDirection。
    //    瞄准基准必须取真实视轴而非抽象 dir(camAim):越肩机位下两线夹角恒定 3.7°~5.8°(@100m 弹着偏 ≈8m、
    //    @300m 偏 ≈24m 纯高空飞靶);#ch 若挂「炮口前固定 40m 点」,经离轴机位投影恒定差 6~9px 永不重合
    //    (炮镜机位在炮枢轴上同轴,dir(camAim) 与视轴夹角 0.001°/#ch=0px,两口径等效——故炮镜分支沿用 dir(camAim))。
    //    第三人称以「相机真实视轴」为瞄准基准:沿视轴测距得着点 P(≤800m,无着=4000m 依无穷远平行),
    //    炮口伺服改追「炮枢→P」汇瞄角(WoT 式视线/炮口线交于黄点),俯仰再叠弹道装定超越量;
    //    #ch 改挂「炮口线×视线交会点」投影——任何视角停追后准星与黄点重合(实测 ≤2.5px),追踪中可见爬回。
    camera.getWorldDirection(_vComp);                                  // 屏心黄点的真实指向(与投影同帧相机快照)
    var pitchComp = 0, dAimC = Infinity;
    if (player.kind !== 'arty') {
      // ★真实弹道装定(坦克/歼击车主炮):按视轴实际命中距离给炮口加"超越量"(与 AI 的 0.5·g·t² 修正同源,公式冻结)——
      //    使黄点/准星一直就是真实弹着点。v=1650m/s:@100m≈0.02mrad、@300m≈0.53mrad、@600m≈2.13mrad、上限 0.012rad
      if (gameT - (player._lrT || -9) > 0.033) { player._lrT = gameT; player._lrD = laserRange(camera.position, _vComp); }   // 30Hz 采样(每帧 ≤10km 地形步进+目标网格走廊是 coll 段热点, 已按地形命中截断;下游 τ0.12s 低通对 33ms 陈旧度零感知)
      dAimC = player._lrD;
      player.lastAimD = isFinite(dAimC) ? dAimC : 4000;                // 玩家实际瞄准距离入账统一散布公式(与 AI 同源同口径)
      /* ★准星/炮管颤抖根治——病灶链:测距 d 的地形 6m 量化步 +
         车体剪影在 800m raycast 域进出,使 d 帧间跳变(实测:近距 6m 量化步=准星 16~18px 同帧瞬移,行驶越
         起伏实测);d 同喂伺服目标点 P、弹道装定 pitchComp、准星挂深三条下游=炮/星同抖;只滤波显示层=炮抖
         星不抖的撒谎准星,故在源头一阶低通 dSm(τ≈0.12s,dt 归一帧率无关),三下游统一改吃 dSm;合拢稳态
         与 raw 完全一致(A 区同心 0.0px/弹道结算/AI/弹丸全冻结),dbg 探针 lastAimT.d 仍记 raw。 */
      var dRawSm = isFinite(dAimC) ? dAimC : 4000;
      if (player._dSm == null) player._dSm = dRawSm;
      else player._dSm += (dRawSm - player._dSm) * (1 - Math.exp(-dt / 0.12));
      var _pv0 = effectiveShellSpeed(player);     // 装定按实际出膛初速(炮管血量因子与 fireShell/AI tof 同口径)——名义初速在炮管受损时使实际下坠>装定=落点低于指示器
      if (isFinite(dAimC)) pitchComp = Math.min(0.5 * CONF.gravity * player._dSm / (_pv0 * _pv0), 0.012);
    }
    player.gunPivot.getWorldPosition(_v2);
    player.gunPivot.getWorldDirection(_vM);                            // 真实炮口指向(含车体姿态;同帧矩阵快照)
    var tankScoped = player.kind !== 'arty' && scopeT > 0.5;           // 坦克/歼击车炮镜:瞄具=FPS 视野
    // 汇瞄目标角(坦克/歼击车第三人称用):把炮口线压到着点 P 上;炮镜分支沿用 dir(camAim)(与视轴同轴等效,数值冻结)
    var dCap = (player.kind === 'arty' ? (isFinite(dAimC) ? dAimC : 4000) : player._dSm);   // 坦克/歼击车=链级平滑视距 dSm(伺服P/装定/准星同源),火箭炮照旧
    _vAim.copy(camera.position).addScaledVector(_vComp, dCap);      // 手动瞄准着点 P(黄点的世界坐标)
    lastPitchComp = pitchComp;
    var amx = _vAim.x - _v2.x, amy = _vAim.y - _v2.y, amz = _vAim.z - _v2.z,
        amLen = Math.sqrt(amx * amx + amy * amy + amz * amz) || 1,
        gywT = Math.atan2(amx, amz), gptT = Math.asin(clamp(amy / amLen, -1, 1));   // 世界系几何汇瞄角(探针对照)
    // ★车体姿态补偿(走行修正):炮口真实指向=车体姿态R(航向+俯仰+横滚)∘(塔转ty,炮仰gp)——
    //    本地逻辑角不可直接当世界角用:坡上姿态会把炮口带偏数度(俯 -4.6° 坡面,逻辑 -2.67° 实射 -6.71°);
    //    精确逆解 wLoc=Ry(ty*)∘Rx(gp*)=R⁻¹·w:ty*/gp* 即炮塔/身管本地目标角——任何坡度炮口线穿过黄点 P。
    _qAim.copy(player.group.getWorldQuaternion(_qAim2)).invert();
    _vAim.set(amx / amLen, amy / amLen, amz / amLen).applyQuaternion(_qAim); // world aim direction in hull-local space
    var tyS = Math.atan2(_vAim.x, _vAim.z);
    var gptS = Math.asin(clamp(_vAim.y, -1, 1));
    var tySc, gptSc;
    _vAim.set(Math.sin(camAimY) * Math.cos(camAimP), Math.sin(camAimP), Math.cos(camAimY) * Math.cos(camAimP)).applyQuaternion(_qAim);
    tySc = Math.atan2(_vAim.x, _vAim.z);
    gptSc = Math.asin(clamp(_vAim.y, -1, 1)); // 炮镜分支:dir(camAim) 同款逆解
    lastAimT.y = tyS; lastAimT.p = gptS; lastAimT.gy = gywT; lastAimT.gp = gptT; lastAimT.d = dAimC;   // 汇瞄探针转录(验收断言用)
    var blueHeliAutoAim = (isHeliP && player.team === 'blue' && player.kind === 'ah64' &&
      typeof vehicleTechBlueHeliAutoCannonAim === 'function')
      ? vehicleTechBlueHeliAutoCannonAim(player) : null;
    if (blueHeliAutoAim) {
      /* The automatic cannon owns the player AH-64 gun servo while its target
         is valid; rockets and missiles retain their normal selected-weapon aim. */
      player.turretYawDelta = clamp(normAng(blueHeliAutoAim.yaw - player.turretYaw), -0.7, 0.7);
      player.gunPitch = clamp(player.gunPitch + clamp(blueHeliAutoAim.pitch - player.gunPitch, -pServoRate * dt, pServoRate * dt), pitchMin, pitchMax);
      if (blueHeliAutoAim.target && blueHeliAutoAim.target.group) {
        var autoTargetPos = blueHeliAutoAim.target.group.position;
        _v3.set(autoTargetPos.x, autoTargetPos.y + 1.2, autoTargetPos.z);
      }
    } else if (artyScoped) {
      // 俯视火控视野:无炮口线准星——光标即装定点,地面覆盖环即弹着区(world.js artyTop 标记系)
      _v3.set(_v2.x, _v2.y, _v2.z);
    } else if (tankScoped) {
      _v3.set(_v2.x + _vM.x * 40, _v2.y + _vM.y * 40, _v2.z + _vM.z * 40);   // 十字准星=炮口真实指向(不减装定量,见下方伺服注释)
    } else {
      // #ch 投影真实炮口线与视深 dCap 平面的交点;停追后必须与中心黄点重合。
      // ★火箭炮第三人称同走本分支;汇瞄伺服使炮口线穿过 P(视轴 dCap 处),交点锚合拢时 q≡P 代数同心。
      //   发射架枢轴绕塔座画圈只影响追踪过程(轨迹连续),静止恒回屏心。
      var muX = _vM.x, muY = _vM.y, muZ = _vM.z;                // 真实炮口方向(逻辑角缺车体姿态,坡上差数度=根源)
      var wvX = _v2.x - camera.position.x, wvY = _v2.y - camera.position.y, wvZ = _v2.z - camera.position.z;
      var bUV = muX * _vComp.x + muY * _vComp.y + muZ * _vComp.z,
          eVW = _vComp.x * wvX + _vComp.y * wvY + _vComp.z * wvZ;   // Barrel-line alignment with the sight ray.
      /* ★挂点连续性(V 字抖动根治)——实测定性:sGeo=两线最近交会
         参数(分子/分母 denX=sin²θ 同趋零)在斜视交线下数学上无界必抖,任何闸门都只把病态带收窄、闸门边界本
         身就是跳变源(实测:现行码 38 次无 provoke 单帧跳 worst+994.6px,含 sGeo=8.xx 刚跨闸下限被采信
         次帧掉回回退值=s 8↔2000 拍打 114↔184px,与 dotGF<0.2 冻结→回视锥快照横甩单帧 +1167px)。
         根治=挂点定义整体换代:不再求最近交会,改取「炮口线 × 视深 dCap 平面」交点 s=(dCap−e)/max(b,0.2)——
         分母 b=cosθ 有 0.2 地板永不近零、无闸门无分段=轨迹处处连续;合拢时 q≡P 代数精确同心(0.0px 照旧);
         挂点视深恒=dCap 永远在相机前方,dotGF 镜像窗口连根消失。 */
      var sProj = clamp((dCap - eVW) / Math.max(bUV, 0.2), 2, 20000);   // 视深平面交点:连续无闸,分母 cosθ≥0.2
      lastAimT.s = sProj;
      _v3.set(_v2.x + muX * sProj, _v2.y + muY * sProj, _v2.z + muZ * sProj);
    }
    camera.updateMatrixWorld();
    /* ★准星绘制=常画+视深预检:出视锥整帧冻结不画的画法会在重回视锥瞬间产生 DOM 快照单帧大跳
       (实测:横甩 90° 回摆单帧 +1167px);本制常画,前方>0.5m 直接投影,超界沿方位
       驻留屏角外 60px;越入身后 NDC 镜像不可信,按相机系方位同半径驻留——轨迹处处连续,横甩可见滑入不闪现。 */
    var pwX = _v3.x, pwY = _v3.y, pwZ = _v3.z;
    camera.getWorldDirection(_v3);
    var depCh = (pwX - camera.position.x) * _v3.x + (pwY - camera.position.y) * _v3.y + (pwZ - camera.position.z) * _v3.z;   // 挂点视深(前方>0)
    _v3.set(pwX, pwY, pwZ);
    var chOffX = 0, chOffY = 0, parkR = Math.sqrt((innerWidth)*(innerWidth)+(innerHeight)*(innerHeight)) * 0.5 + 60;   // 驻留半径=屏角外 60px
    // 火箭炮炮镜准星与坦克/歼击车同走真实投影:追逐期偏移、到位重合;#ch 常驻使内嵌装填环 #ring 开镜可见不变
    if (isHeliP && curHeliWp === 3) {
      // 导弹模式: 炮口指示器 #ch 严格固定在屏幕正中心圆点光标同一位置 (零偏差零滞后)
      chOffX = 0;
      chOffY = 0;
    } else if (depCh > 0.5) {
      _v3.project(camera);
      chOffX = (_v3.x + 1) * 0.5 * innerWidth - innerWidth * 0.5;
      chOffY = (1 - _v3.y) * 0.5 * innerHeight - innerHeight * 0.5;
      var roCh = Math.sqrt((chOffX)*(chOffX)+(chOffY)*(chOffY));
      if (roCh > parkR) { chOffX *= parkR / roCh; chOffY *= parkR / roCh; }          // 超界沿方位驻留(连续滑入)
    } else {                                                                         // 挂点绕到身后:按相机系方位驻留
      _v3.set(pwX - camera.position.x, pwY - camera.position.y, pwZ - camera.position.z);
      camera.getWorldQuaternion(_qAim2).invert(); _v3.applyQuaternion(_qAim2);       // 相机系:x 右/y 上/−z 前
      var rrCh = Math.sqrt((_v3.x)*(_v3.x)+(_v3.y)*(_v3.y));
      if (rrCh < 1e-4) chOffY = -parkR;                                              // 正后方无方位:驻顶
      else { chOffX = _v3.x / rrCh * parkR; chOffY = -_v3.y / rrCh * parkR; }
    }
    if (blueHeliAutoAim) {
      /* Automatic AH-64 fire-control remains authoritative in both third-person
         and gun-sight views; mouse look still controls the camera only. */
    } else if (tankScoped) {
      if (!player._hullAim) camAimY += hullDy;                  // 车体转多少,瞄具视野跟着转多少(世界贴住不漂);车体瞄准模式跳过——camAimY 须保持鼠标世界方位,车体向它收敛
      // ★FPS 式炮镜:瞄具(camAim=镜心/十字丝)已由 mousemove 增量驱动、零延迟跟手,360° 自由转头;
      //   真实炮口只按载具实际炮塔速度追踪跟随瞄具(伺服残差=炮口滞后,#ch 落点准星可见地爬回镜心)
      player.turretYawDelta = clamp(normAng(tySc - player.turretYaw), -0.7, 0.7);   // 炮塔以真实速度追瞄具(本地系,平地=旧差分逐位相等)
      var rpkP1 = recPitchK(player);                    // 开火炮口真实上抬(→炮镜内世界随炮管上抬,落点准星晃后复位)
      // 炮镜真瞄准:镜轴=管轴,不加自动弹道装定超越量——
      //   重力下坠由红色落点指示器如实呈现(simulateImpact 真弹道仿真,1400m/0.8s≈下坠3.2m 清晰可见),像真实炮术一样物理压枪;
      //   十字准星=炮口真实指向,停追后与镜心重合(炮镜内),转动炮镜时可见追逐。
      // 第三人称保留辅助装定(黄点=着点,语义不变);炮镜路径无装定修正。
      player.gunPitch = clamp(player.gunPitch + clamp(gptSc + rpkP1 - player.gunPitch, -pServoRate * dt, pServoRate * dt), pitchMin, pitchMax + rpkP1);   // 俯仰=瞄具本地角+后坐上抬(无装定)
    } else if (!artyScoped && !blueHeliAutoAim) {
      // ★第三人称汇瞄伺服:炮口追「炮枢→着点 P」真实汇瞄角(而非抽象 dir(camAim))——
      //   停追后炮口线穿过黄点(任何视角);追踪过程 #ch 沿交会点可见地爬回屏心(伺服残差=炮口滞后)
      if (aimChaseOn && !artyFrozen) {                          // 按下方向键暂停追逐(手动微调),移动鼠标恢复
        player.turretYawDelta = clamp(normAng(tyS - player.turretYaw), -0.7, 0.7);   // 炮塔以真实速度汇瞄着点 P(本地系最短弧,背后也无死角)
        var rpkP2 = recPitchK(player);                  // 开火炮口真实上抬(第三人称=炮管抬+准星晃后复位,视角不晃)
        player.gunPitch = clamp(player.gunPitch + clamp(gptS + pitchComp + rpkP2 - player.gunPitch, -pServoRate * dt, pServoRate * dt), pitchMin, pitchMax + rpkP2);   // 俯仰=汇瞄本地角+弹道装定超越量+后坐上抬
      }
    }
    if (artyScoped) {
      // 俯视火控:发射架由 playerUpdate 光标伺服直接积分(1.0rad/s 限速);此处只清追逐余量
      player.turretYawDelta = 0;
    } else {
      var trRate = player.turretRate0 * turretMult(player);
      var trMax = trRate * dt;
      var d0 = player.turretYawDelta || 0;
      var applied = clamp(d0, -trMax, trMax);
      player.turretYaw += applied;
      player.turretYawDelta = clamp(d0 - applied, -0.7, 0.7);
      if (isHeliP && player.turretYaw !== clamp(player.turretYaw, -Math.PI / 2, Math.PI / 2)) {
        player.turretYaw = clamp(player.turretYaw, -Math.PI / 2, Math.PI / 2);   // 机炮射界=前方180°,顶死即停
        player.turretYawDelta = 0;
      }
    }
    if (el.ch && !artyScoped && isFinite(chOffX) && isFinite(chOffY))   // 准星DOM = 炮口/落点真实投影(火箭炮俯视:CSS 隐藏+跳写)
      domTF(el.ch, 'translate(calc(-50% + ' + chOffX.toFixed(1) + 'px), calc(-50% + ' + chOffY.toFixed(1) + 'px))');
    if (el.aimdot && !artyScoped) {                                 // ★黄点永远钉死屏幕正中心(FPS 式;火箭炮俯视用系统光标,黄点隐藏)
      if (!el.aimdot._pin) { el.aimdot._pin = true; domTF(el.aimdot, 'translate(0.0px,0.0px)'); }   // 钉死写一次(常量 transform,鼠标乱动控瞄光标不动)
      var _adOp = aimChaseOn ? '0.9' : '0.3';                      // 亮度=追逐态边沿写(每帧一次字符串比较)
      if (el.aimdot._op !== _adOp) { el.aimdot._op = _adOp; el.aimdot.style.opacity = _adOp; }
    }
    // 炮镜分划美术(#scoperet:镜框+十字丝)FPS 式钉死在屏幕中心,不写 transform(CSS 默认居中)
    if (!isFinite(player.turretYaw)) player.turretYaw = 0;          // NaN 双保险(玩家同免疫"烧塔")
    if (!isFinite(player.gunPitch)) player.gunPitch = 0.2;
    /* 炮镜火箭炮由 playerUpdate 直接积分 turretYaw;必须与其他视角一样在 NaN 兜底后无条件写实体。
       旧代码只在非 artyScoped 分支写 rotation,造成镜头左右移动而发射架停在原位。 */
    player.turret.rotation.y = player.turretYaw;
    player.gunPivot.rotation.x = -player.gunPitch;                  // 三种视角/兵种统一写回
    if (blueHeliAutoAim && typeof vehicleTechBlueHeliAutoCannonFire === 'function') {
      /* fireShell reads the real muzzle world matrix, so commit the automatic
         servo pose before the player-only automatic fire consumer runs. */
      player.group.updateMatrixWorld(true);
      vehicleTechBlueHeliAutoCannonFire(player, blueHeliAutoAim);
    }
    player._scYaw = player.yaw;                                     // 帧末快照回填(段首 hullDy 的基准;本段内瞄准改 yaw 不入拖拽)
  }

  resolveCollisions(dt);
  // 仅在位置、姿态、炮塔姿态或推挤状态变化时重贴地并刷新子树矩阵。
  // 静止车不再每个 50Hz 模拟步递归 updateMatrixWorld(true),逻辑射线仍读取最近一次有效矩阵。
  for (var mi = 0; mi < tanks.length; mi++) {
    var tm2 = tanks[mi];
    if (!tm2.alive && !tm2.gDirty) continue;
    var pp2 = tm2.group.position;
    /* 直升机补充脏位(_mwY/_mwRx/_mwRz/_mwRot):旧判据只看 x/z/yaw/塔/炮——
       地面载具的 y/俯仰/横滚必然伴随 x/z 变化,故对坦克成立;但直升机能在
       x/z/yaw 全不变的情况下改变高度、姿态和旋翼角(悬停/垂直升降),
       会被误判为"干净"而跳过 updateMatrixWorld → 实例流读到陈旧世界矩阵,
       表现为"螺旋桨不转、爬升不动"。非直升机 _heliRotorAngle 恒 undefined,
       比较恒等,静止坦克仍然短路,零性能回归。 */
    var matrixDirty = tm2.gDirty || tm2._mwX !== pp2.x || tm2._mwZ !== pp2.z ||
      tm2._mwYaw !== tm2.yaw || tm2._mwTurret !== tm2.turretYaw || tm2._mwGun !== tm2.gunPitch ||
      tm2._mwY !== pp2.y || tm2._mwRx !== tm2.group.rotation.x ||
      tm2._mwRz !== tm2.group.rotation.z || tm2._mwRot !== tm2._heliRotorAngle ||
      tm2._mwSuspPitch !== (tm2._suspLoad ? tm2._suspLoad.pitch : 0) ||
      tm2._mwSuspRoll !== (tm2._suspLoad ? tm2._suspLoad.roll : 0);
    if (!matrixDirty) continue;
    alignTank(tm2, dt);
    tm2.group.updateMatrixWorld(true);                // 逻辑射线只看车组内部件
    tm2._mwX = tm2.group.position.x; tm2._mwZ = tm2.group.position.z;
    tm2._mwYaw = tm2.yaw; tm2._mwTurret = tm2.turretYaw; tm2._mwGun = tm2.gunPitch;
    tm2._mwY = tm2.group.position.y;
    tm2._mwRx = tm2.group.rotation.x; tm2._mwRz = tm2.group.rotation.z;
    tm2._mwRot = tm2._heliRotorAngle;
    tm2._mwSuspPitch = tm2._suspLoad ? tm2._suspLoad.pitch : 0;
    tm2._mwSuspRoll = tm2._suspLoad ? tm2._suspLoad.roll : 0;
    tm2.gDirty = false;
  }
  turretWatchdog(dt);                                    // 炮塔消失类异常实时留证(见函数注)
  __mark('coll');
  hitGridDynamicTick();            // 活车命中网格逐车换格增量(触发器:未换格零操作;替代旧 0.3s 全量重建)
  __mark('grid');
  if (typeof ffaAirstrikeUpdate === 'function') ffaAirstrikeUpdate(dt); // FFA 缩圈完成后的每秒三发空袭调度
  if (typeof powerupTick === 'function') powerupTick(dt);
  rocketThreatScan(dt);                           // 火箭弹来袭预报(0.22s 节流,落点外推共 AI 躲避消费)
  stepShells(dt);
  __mark('shells');

  if (gameT - craterFlushT > 0.3) { craterFlushT = gameT; flushCraters(); }   // 合批窗口 0.2→0.3s(弹坑/焦土为永久累积,更大批=更少上传事件;爆效遮蔽延迟无感)
  cloudsUpdate(dt);                                      // 云朵缓慢漂移
  if (typeof updateBattlefieldAtmosphere === 'function') updateBattlefieldAtmosphere(dt);
  if (typeof treesRunOverScan === 'function') treesRunOverScan();   // 载具碾树(定步长内;空表零开销)
  if (typeof grassPlayerScan === 'function') grassPlayerScan();     // 玩家碾压/直升机低掠 → 花草抖动(仅 player)
  stepHeliFallingWrecks(dt);                             // 空中直升机残骸自然下落与触地燃爆(空队列零开销)
  _wreckSparkUpdate(dt);                                 // 残骸/履带火星贴图卡(64槽 InstancedMesh;活跃时才遍历)
  if (flash.intensity > 0.001) flash.intensity *= Math.exp(-flashDecay * dt);   // 熄灭休眠:静场零 exp(炮口光衰减到阈值直接归零)
  else if (flash.intensity !== 0) flash.intensity = 0;
  nvSync(); thermalSync(); nvTick(dt);                   // 夜视仪/热成像:边沿生效/复原(状态未变=一次布尔比较) + 像管噪点流

  if (emberMat) emberMat.uniforms.uT.value = gameT;                  // 余烬:每帧 CPU 仅写 1 个 uniform(加法混合免雾色同步)
  __mark('part');

  // 阵亡后的重新部署倒计时期间持续复查玩家队兵力。
  // 兵力在倒计时/复活面板期间归零时，立即切换到友军接管，避免面板按钮被禁用后无路可走。
  var _playerCannotRedeploy = false;
  if (typeof isFfaMode !== 'function' || !isFfaMode()) {
    var _respawnSide = typeof pSide === 'function' ? pSide() : (typeof startSide === 'string' ? startSide : 'red');
    var _respawnPool = typeof teamPool !== 'undefined' && teamPool ? Number(teamPool[_respawnSide]) : 0;
    _playerCannotRedeploy = !isFinite(_respawnPool) || _respawnPool <= 0;
  }
  if (typeof SPECTATE_MATCH !== 'undefined' && SPECTATE_MATCH) { respawnT = 0; }
  else if (_playerCannotRedeploy && player && !player.alive) {
    respawnT = 0;
    if (typeof respawnUiOpen !== 'undefined' && respawnUiOpen && typeof hideRespawnUI === 'function') hideRespawnUI();
    if (typeof possessUiOpen === 'undefined' || !possessUiOpen) {
      if (typeof showPossessOv === 'function') showPossessOv();
    }
  } else if (respawnT > 0) {
    respawnT -= dt;
    if (respawnT <= 0) showRespawnUI();
  }
  // 兵力耗尽阵亡:3 秒倒数 → 随机接管一辆友军载具(战斗不暂停)
  if (possessUiOpen && player && !player.alive) {          // 选车界面在场量 0.25s 节流实时刷新
    possessRefreshT -= dt;
    if (possessRefreshT <= 0) { possessRefreshT = 0.25; updatePossessOv(); }
  }
  // 复活界面打开期间实时刷新剩余兵力/在场兵力
  if (respawnUiOpen && (!player || !player.alive)) {
    respawnUiT -= dt;
    if (respawnUiT <= 0) { respawnUiT = 0.4; updateRespawnUI(); }
  }

  // 大本营军旗顶点飘扬(20Hz 节流:纯视觉顶点写+上传省 4/5)+ 待命环脉动(每帧,材质属性便宜)
  ['red', 'blue'].forEach(function (tm) {
    for (var hi = 0; hi < hqList[tm].length; hi++) {
      var hq = hqList[tm][hi];
      /* 旗面 4.8m 宽,远处只有几个像素 —— 800m 外停更顶点(停在最后姿态,静止不可辨)。
         18 座大本营时这条剔除能免掉绝大多数逐顶点写与缓冲上传。 */
      var _hdx = hq.x - camera.position.x, _hdz = hq.z - camera.position.z;
      if (hq.flagBase && _hdx * _hdx + _hdz * _hdz < 640000) {   // 真飘扬:行波沿旗面传播,摆幅向自由端放大
        hq.flagTick = (hq.flagTick || 0) - dt;
        if (hq.flagTick <= 0) {
          hq.flagTick = 0.05;
          var fa = hq.flag.geometry.attributes.position, fb = hq.flagBase, fw = hq.flagW,
              ft = gameT * 5.4 + hq.phase;
          for (var vi = 0; vi < fa.count; vi++) {
            var bxp = fb[vi * 3], k = (bxp + fw) / (fw * 2);          // 0=杆端 1=自由端
            var wave = Math.sin(bxp * 2.1 - ft) * 0.30 * k + Math.sin(bxp * 4.6 - ft * 1.55 + fb[vi * 3 + 1] * 2.2) * 0.11 * k;
            fa.array[vi * 3 + 2] = fb[vi * 3 + 2] + wave;
            fa.array[vi * 3]     = bxp - Math.abs(wave) * 0.20 * k;   // 波峰略缩,布料守恒感
          }
          fa.needsUpdate = true;
        }
      }
      hq.ring.material.opacity = 0.32 + 0.18 * (0.5 + 0.5 * Math.sin(gameT * 2.2 + (hq.phase || hi)));
    }
  });

  /* ★cameraUpdate/scopeHudUpdate 已移至 animate(定步长改造):相机必须按渲染帧节奏(renderDt)
     跟随"插值后"的玩家位置——若留在本函数,相机 50Hz 步进 vs 车体每渲染帧插值=两者错拍再次拉锯;
     #ch 准星投影依赖相机姿态,随相机同帧(animate 内紧随 cameraUpdate 之后调用)。 */
  hudUpdate(dt);
  processRespawns();              // 大本营重新部署 / 兵力消耗结算
  battleCheck();
  if (gameT - cmdTickT >= 1) { cmdTickT = gameT; cmdTick(); abandonTick(); }   // 指挥官 1Hz(维护/采样/紧急/周期决策)+ 弃车观察 1Hz(事件驱动空表零开销)
  __mark('resp');

  // 调试探针(仅在 window.__TANK_DEBUG 时输出,无头测试用)
  if (typeof window !== 'undefined' && window.__TANK_DEBUG) {
    var dbg = { t: gameT, teams: {}, spd: {}, distT: {}, modes: {}, shells: shells.length };
    dbg.pitchComp = lastPitchComp; dbg.aimT = lastAimT;                  // 主炮弹着装定量(主循环帧级刷新在此转录,瞄具回归断言用)
    var shNow = 0, shWorst = 0, shSum = 0, shN = 0, shTop = null;
    var cpNow = 0, cpWorst = 0, cpSum = 0, cpN = 0;
    var cellMap = {}, tot = 0;                                 // 80m 网格:交火扎培育群审计
    aliveList.forEach(function (t2) {
      if (!t2.alive) return;
      var tm = t2.team;
      dbg.teams[tm] = (dbg.teams[tm] || 0) + 1;
      dbg.spd[tm] = (dbg.spd[tm] || 0) + Math.abs(t2.speed);
      tot++;
      var ck = Math.floor(t2.group.position.x / 80) + ',' + Math.floor(t2.group.position.z / 80);
      var cc = cellMap[ck] || (cellMap[ck] = { a: 0, e: 0, n: 0 });
      cc.n++; if (tm === 'red') cc.a++; else cc.e++;
      if (t2.ai) {
        var m = tm + ':' + (t2.ai.mode || '?');
        dbg.modes[m] = (dbg.modes[m] || 0) + 1;
        if (t2.ai.targetO && t2.ai.targetO.alive) {
          var dx = t2.ai.targetO.group.position.x - t2.group.position.x;
          var dz = t2.ai.targetO.group.position.z - t2.group.position.z;
          dbg.distT[tm] = (dbg.distT[tm] || 0) + Math.sqrt((dx)*(dx)+(dz)*(dz));
        }
        if (t2.kind !== 'arty') {
          shN++; shSum += t2._shirkC || 0;
          if ((t2._shirkC || 0) >= 4) shNow++;
          if ((t2._shirkC || 0) > shWorst) { shWorst = t2._shirkC; shTop = t2; }
          cpN++; cpSum += t2._campC || 0;
          if ((t2._campC || 0) >= 6) cpNow++;
          if ((t2._campC || 0) > cpWorst) cpWorst = t2._campC;
        }
      }
    });
    dbg.shirk = { now: shNow, worstC: +shWorst.toFixed(1), avgC: +(shN ? shSum / shN : 0).toFixed(2),
                  worstEver: +dbgShirk.worstEver.toFixed(1),
                  campNow: cpNow, campWorstC: +cpWorst.toFixed(1), campAvgC: +(cpN ? cpSum / cpN : 0).toFixed(1),
                  campWorstEver: +dbgShirk.campWorstEver.toFixed(1),
                  top: shTop && shWorst > 2 ? {
                    kind: shTop.kind, team: shTop.team, name: shTop.name, mode: shTop.ai.mode,
                    x: +shTop.group.position.x.toFixed(0), z: +shTop.group.position.z.toFixed(0),
                    spd: +shTop.speed.toFixed(2), destT: +shTop.ai.destT.toFixed(1),
                    idleW: +(shTop.ai.idleW || 0).toFixed(1), blockedT: +shTop.blockedT.toFixed(1),
                    dstX: +(shTop.ai.destX || 0).toFixed(0), dstZ: +(shTop.ai.destZ || 0).toFixed(0),
                    role: (shTop._cmdG && shTop._cmdG.role) || 'line', fire: !!shTop.fire,   // 真实角色在指挥官分组 _cmdG.role
                    eng: +(shTop.mods.engine.hp || 0).toFixed(0),
                    tL: +(shTop.mods.trackL.hp || 0).toFixed(0), tR: +(shTop.mods.trackR.hp || 0).toFixed(0)
                  } : null };
    // 交火聚类:80m 格内双方 ≥2 辆 = 一个交火格;前 3 格吞掉的活车占比 = 扎堆度
    var cellsArr = [];
    for (var ck2 in cellMap) { var cv = cellMap[ck2]; if (cv.a >= 2 && cv.e >= 2) cellsArr.push(cv); }
    cellsArr.sort(function (x, y) { return y.n - x.n; });
    var top3 = (cellsArr[0] ? cellsArr[0].n : 0) + (cellsArr[1] ? cellsArr[1].n : 0) + (cellsArr[2] ? cellsArr[2].n : 0);
    dbg.brawl = { cells: cellsArr.length, top3Share: +(tot ? top3 / tot : 0).toFixed(2) };
    // 新系统审计:注意力/躲避/姿态/迂回/拆残骸
    var alA = 0, alE = 0, evN = 0, poASum = 0, poESum = 0, flA = 0, flE = 0, flRun = 0, nA = 0, nE = 0;
    aliveList.forEach(function (t3) {
      if (!t3.alive || !t3.ai) return;
      var tm3 = t3.team;
      if (tm3 === 'red') { nA++; poASum += t3.ai.posture || 0; if (t3.ai.alert) alA++; }
      else { nE++; poESum += t3.ai.posture || 0; if (t3.ai.alert) alE++; }
      if (t3.ai.evadeT > 0) evN++;
      if (t3._cmdG && t3._cmdG.role === 'flank') { if (tm3 === 'red') flA++; else flE++; if (t3.ai.mode === 'flankrun') flRun++; }   // 迂回统计改读指挥官分组
    });
    dbg.attn = { red: +(nA ? alA / nA : 0).toFixed(2), blue: +(nE ? alE / nE : 0).toFixed(2) };   // 警觉占比(其余=专注埋头)
    dbg.evacNow = evN; dbg.evasions = dbgStats.evasions || 0; dbg.threats = rocketThreats.length;
    dbg.evadeLog = evadeLog;
    dbg.posture = { red: +(nA ? poASum / nA : 0).toFixed(2), blue: +(nE ? poESum / nE : 0).toFixed(2) };
    dbg.flank = { red: flA, blue: flE, running: flRun };
    var cA = [];
    for (var ck in commanders) { var cc2 = commanders[ck];
      for (var cg2 = 0; cg2 < cc2.groups.length; cg2++) { var gg = cc2.groups[cg2];
        cA.push({ k: ck, r: gg.role, s: gg.shots || 0, h: gg.hits || 0, m: gg.rangeMul || 1 });
      } }
    dbg.cmdAim = cA;                                     // 组级命中率账(命中率决策审计)
    var abSnap = [];
    for (var abi = 0; abi < abandonWatch.length; abi++) { var abt = abandonWatch[abi];
      abSnap.push({ k: abt._abandon.kind, s: abt._abandon.stage, left: +(abt._abandon.due - gameT).toFixed(1) });   // k=弃车原因(gun/fuel),非战车兵种
    }
    dbg.abandon = abSnap;                                // 弃车观察表快照(事件驱动审计)
    dbg.wreckShots = dbgStats.wreckShots || 0;
    dbg.camera = camera;                                  // 真机视锥审计(harness 相机不入场景图拿不到)
    dbg.pool = { red: teamPool.red, blue: teamPool.blue };
    dbg.queue = respawnQueue.length;
    if (player) {
      dbg.pk = player.kind; dbg.pAlive = player.alive; dbg.pSalvo = player.salvoLeft;
      dbg.pSpd = player.speed; dbg.pReload = player.reload;
      // 火箭炮瞄具读数(无头精度回归):装定点 / 红点(真实弹道仿真)坐标与距离
      if (player._artyAim) {
        dbg.pAimX = player._artyAim.x; dbg.pAimZ = player._artyAim.z;
        dbg.pAimD = player._artyAim.d; dbg.pSet = player._artyAim.settled;
        dbg.pReach = player._artyAim.reach; dbg.pAz = player._artyAz;
      } else { dbg.pAimD = null; dbg.pSet = null; dbg.pReach = null; }
      if (scopeInfo.point) { dbg.pDotX = scopeInfo.point.x; dbg.pDotZ = scopeInfo.point.z; dbg.pDotD = scopeInfo.impDist; }
      dbg.pScopeT = scopeT; dbg.pKv = player._artyKv; dbg.pRV = player.rocketV;
      dbg.pX = player.group.position.x; dbg.pZ = player.group.position.z;
    }
    dbg.rOpen = !!respawnUiOpen; dbg.rKind = respawnSel.kind; dbg.rWing = respawnSel.wing;
    dbg.possessUiOpen = possessUiOpen; dbg.respawnUiOpen = respawnUiOpen; dbg.possesses = dbgStats.possesses || 0;
    dbg.wreckCount = wreckCount;
    if (!window.__DBG_HOOKS) {                       // 无头回归钩子:强制击杀玩家/设定复活兵种/触发重生/清场
      window.__DBG_HOOKS = {
        bakeFireWave: bakeFireWave, bakeHitWave: bakeHitWave, bakeEngineLoop: bakeEngineLoop, bakeExplosionWave: bakeExplosionWave,    // 无头测试直接烤制炮声/着弹声/爆炸声断言
        recPitchK: recPitchK,                                                                                                          // 后坐炮口上抬曲线(纯函数,无头断言)
        fireShell: fireShell,                                                                           // 后坐测试:直接击发
        setKind: function (k) { respawnSel.kind = k; },
        setWing: function (w) { respawnSel.wing = clamp(w | 0, 0, HQ_WINGS.length - 1); },   // 无头回归:指定左/中/右翼
        setPool: function (n) { teamPool.red = n; },
        setPoolSide: function (n) { teamPool[pSide()] = n; },           // 按玩家队装兵力(选边后用)
        killPlayer: function () { if (player && player.alive) { player.struct = 0; killTank(player, 'DEBUG KILL'); } },   // 真链:阵亡→playerDied
        redeploy: function () { redeployPlayer(); },
        player: function () { return player; },
        setTime: function (h) { applyTimeOfDay(h); },   // 连续时间:小时 0~24
        spawnTank: function (kind, team, x, z, yaw) {   // 装甲回归:定点生成任意兵种
          var nt = createTank({ kind: kind, team: team, x: x, z: z, yaw: yaw || 0 });
          rebuildTargets();
          return nt;
        },
        testShell: function (tk, ox, oy, oz, dx, dy, dz, pen, flyD, kdrag) {   // 装甲/存速回归:真实射线+resolveHit 判定一发弹(flyD/kdrag 注入穿深距离衰减)
          var dir = new THREE.Vector3(dx, dy, dz).normalize();
          var rc = new THREE.Raycaster(new THREE.Vector3(ox, oy, oz), dir, 0, 60);
          var hits = rc.intersectObjects(tk.modMeshes, false);
          for (var i = 0; i < hits.length; i++) {
            var ud = hits[i].object.userData;
            if (!ud || !ud.mod) continue;
            var rec = null;
            var sh = { owner: { team: tk.team === 'red' ? 'blue' : 'red' }, pen: pen || 124, dmg: 90,
                       kdrag: kdrag == null ? CONF.red.penKd : kdrag, flyD: flyD || 0,
                       vel: dir.clone().multiplyScalar(CONF.shellSpeedE), pos: hits[i].point.clone(),
                       _rec: function (r2) { rec = r2; } };
            var res = resolveHit(sh, tk, ud.key, hits[i], dir);
            if (!rec) rec = {};
            rec.res = res; rec.key = rec.key || ud.key; rec.face = rec.face || ud.face || null;
            return rec;
          }
          return null;
        },
        clearAI: function () { clearAllAI(); },        // 只留玩家 + 清空增援队列(实现见文件尾 clearAllAI;场景隔离:击毁车辆不于大本营重新部署)
        makeMidgame: function (nAlive, nWreck) { return buildMidgame(nAlive, nWreck); },   // 基准场景一键构造(实现见文件尾 buildMidgame)
        kill: function (tk) { killTank(tk, 'TEST KILL'); },           // AI 行为回归:定点制造残骸
        tanks: function () { return tanks; },                        // 火控回归:全场车辆列举(威胁/视野/射速审计)
        shells: function () { return shells; },                      // 弹道 SPY:在飞弹体列举(弹着点/死法探针用)
        threatScore: threatScore,                                    // 威胁评分公式单测挂钩
        isNoticed: isNoticed,                                        // 双重视野判定单测挂钩
        threats: function () { return rocketThreats; },              // 火箭弹来袭预报(落点/抵达时间)
        bursts: function () { return recentBursts; },                // 最近爆点(惊醒专注 AI 用)
        clearBursts: function () { recentBursts.length = 0; },       // 阶段隔离:清陈旧爆点账(4s 留存会跨阶段惊醒)
        clearShells: function () {                                   // 阶段隔离:清在飞炮弹/火箭+预报账(上一场景的尾波齐射会砸进下一场景)
          for (var cs = shells.length - 1; cs >= 0; cs--) {
            if (shells[cs].mesh) scene.remove(shells[cs].mesh);
          }
          shells.length = 0; airborneMissiles.length = 0; rocketThreats.length = 0; rocketScanT = 0;
          if (typeof clearHeliDecoys === 'function') clearHeliDecoys();
          rocketThreatGrid.clear();                                 // 威胁桶随预报账同清
          rocketBodies.count = 0; rocketFlames.count = 0;            // 实例化弹体/尾焰同步清零(火箭无独立网格)
        }
      };
    }
    dbg.stats = dbgStats;
    dbg.pBursts = dbgPlayerBursts; dbg.artyBursts = dbgArtyBursts;
    dbg.dent = dentGrid; dbg.scorch = scorchGrid; dbg.scorchVtxQ = scorchVtxQ; dbg.terrainH = terrainH; dbg.terrainBase = terrainBase;
    dbg.scorchSampleQ = scorchSampleQ; dbg.scorchF = scorchF; dbg.craterRadiusOf = craterRadiusOf;
    dbg.scorchSplats = function () { return { count: scCount, max: SC_MAX, tiles: scTN, tile: SC_TILE, cell: GRID_CELL }; };
    dbg.groundChunks = groundChunks; dbg.groundBaseCol = groundBaseCol;       // 分块地面回归取样
    dbg.aimInputStep = function (ev, locked, bx, by, vw, vh) { return aimInputStep(ev, locked, bx === undefined ? aimPX : bx, by === undefined ? aimPY : by, vw || innerWidth, vh || innerHeight); };
    dbg.aimBase = function () { return { x: aimPX, y: aimPY, locked: pointerLocked, avail: lockAvailable, tries: _lockTry, hardDenied: _lockHardDenied }; };
    dbg.aimBaselineReset = initAimBaseline; dbg.aimRetry = aimPointerLockWatchdog;      // 转向受限修复的回归钩子
    dbg.ember = function () { return { mesh: emberMesh, mat: emberMat, list: emberList, init: EMBER_INIT, hard: EMBER_HARD, cap: emberCap, free: emberFree, buckets: emberBuckets }; };   // 余烬回归钩子(含空闲槽栈/12m 邻桶账本/容量)
    dbg.shellsRef = shells;                          // 弹道数组(火箭链路回归用)
    dbg.rocketProf = { spec: ROCKET_PROF, phase: rocketPhaseSpeed };   // 火箭速度剖面旋钮+函数(验收口)
    dbg.penSpec = {                                                     // 穿深存速衰减验收口(数值/公式/口径对照)
      red: CONF.red.pen, blue: CONF.blue.pen, td: CONF.td.pen,
      kdTank: CONF.red.penKd, kdTd: CONF.td.penKd,
      at: function (kd, R) { return Math.exp(-kd * R); }                // P(R)=P0·at(kd,R)(真实弹道物理)
    };
    dbg.rocketVfx = function () {                      // 火箭视觉体检口(实例化弹体/尾焰/容量/材质)
      return { bodies: rocketBodies, flames: rocketFlames, max: RK_MAX, nozzle: RK_NOZZLE,
               bodyMat: rocketShellMat, flameMat: rocketFlameMat, geo: rocketShellGeo };
    };
    dbg.flashLight = flash;                            // 全局爆闪光灯(强度采样用)
    dbg.queueCrater = queueCrater;                       // 无头回归:手工注入弹坑验证弹坑/焦土联动
    dbg.hqList = hqList;                                 // 大本营回归:旗杆/帐篷/披布顶点校验
    dbg.MAP = MAP;                                       // 地图参数(种子/崎岖度/边长/材质)验收口
    dbg.sunLight = sunLight; dbg.hemiLight = hemiLight; dbg.sunDisc = sunDisc;
    dbg.nightAimMul = nightAimMul;                     // 黑夜视野模糊公式单测口
    dbg.nightBlur = NIGHT_BLUR;
    dbg.aimAudit = function () { return aimAudit; };   // 火控审计环(AI 直瞄每发 {tm,d,nm})
    dbg.nvSpec = NVD;                                  // 夜视仪旋钮
    dbg.nvInfo = function () {                         // 夜视仪验收口(生效/复原即时改写)
      return { on: nvOn, active: nvWas,
        hemiI: hemiLight ? hemiLight.intensity : null, hemiSky: hemiLight ? hemiLight.color.getHex() : null,
        sunI: sunLight.intensity, sunCol: sunLight.color.getHex(),
        fogC: scene.fog ? scene.fog.color.getHex() : null,
        fogNear: scene.fog ? scene.fog.near : null, fogFar: scene.fog ? scene.fog.far : null,
        glow: vehGlowMat.color.getHex() };
    };
    dbg.timeHour = function () { return timeHour; }; dbg.hourLabel = hourLabel;   // 连续时间验收口(小时/标签)
    dbg.sunOffset = sunOffset;
    dbg.sunSpec = { dist: SUN_DIST, coreDia: SUN_CORE_DIA, texCore: SUN_TEX_CORE };
    dbg.moonDisc = moonDisc; dbg.moonSpec = { dist: MOON_DIST, coreDia: MOON_CORE_DIA, texCore: MOON_TEX_CORE };
    dbg.aimChase = function () { return { x: aimPX, y: aimPY, on: aimChaseOn }; };   // 鼠标追踪瞄准调试
    dbg.camAim = function () { return { y: camAimY, p: camAimP }; };                  // 视野(瞄具)方向:炮镜统一回归断言用
    dbg.fog = scene.fog;
    dbg.cam = camera;                              // 调试:供无头探针做视锥投影
    window.__DBG = dbg;
  }
}

var _fpsAcc = 0, _fpsN = 0, _fpsT = 0, _lastFrameT = 0;   // 基于真实墙钟时间的帧率统计
var SIM_DT = 0.02, SIM_MAX_STEPS = 3;   // ★定步长模拟(Rigidbody 插值):50Hz 恒定步长;单帧最多 3 步(60ms)——超限丢弃=短暂慢动作,防死亡螺旋且永不瞬移
/* ★移动端适配恢复(直升机专项 B1):触屏设备步数上限 3→5——手机中端机帧时在 60~100ms 间抖动,
   3 步封顶会频繁丢时间(直升机高速时表现为“向后拽”);桌面保持 3。 */
if (typeof GFX_TOUCH !== 'undefined' && GFX_TOUCH) SIM_MAX_STEPS = 5;
/* P2-DRS-START ★P2-⑧ 全局自适应质量控制器(运行时 DRS,性能优化报告)——
   信号=墙钟帧时 EMA(_wallMsEMA,由 animate 喂;不用 _frameMsEMA 的理由:报告 §一 自己写了
   “JS ms≪帧时→GPU 瓶颈”,GPU 瓶颈帧的 JS 耗时很低,只看 JS EMA 会对第一嫌疑(填充率)失明)。
   执行器=全局像素比系数 drsScale∈[0.6,1.0] 步进 0.1:
   · 下钻:帧时 EMA>22ms 持续 1.5s → 降一档(报告阈值);
   · 回升:帧时 EMA<14ms 持续 3s(慢升防抖振)→ 升一档,上限=画质档像素比(永不越过用户所选档);
   · 触底仍>28ms 持续 3s → 二级旋钮收紧残骸烟密度(特效密度档,报告顺序“像素比→RT→特效”);
   · 漫画合成 RT 按 drawingBufferSize 逐帧跟随(既有兼容点),像素比一动场景+合成两个全屏 pass 同缩;
   · 与开镜 DRS 相乘叠加:effective = base × drsScale × (开镜档),统一经 drsApply 落笔,
     applyScopePerf/resize 不再各自直写像素比(单一落笔点,杜绝互相覆盖);
   · 标签页切走/大停顿(墙钟>120ms)不入 EMA 不计驻留,防误降;开局 4s 热身不决策(着色器编译尖峰);
   · ?drs=0 关闭(桌面 A/B 对照);调试面板与 window.__DRS 可读。 */
/* ★移动端适配恢复:DRS 默认仅在触屏设备开启(桌面保持新版口径,不做运行时降分辨率);
   ?drs=1 强制开启(桌面 A/B),?drs=0 强制关闭。 */
var DRS_ON = (function () {
  var qs = (typeof location !== 'undefined' && location.search) || '';
  if (/[?&]drs=0(?:&|$)/.test(qs)) return false;
  if (/[?&]drs=1(?:&|$)/.test(qs)) return true;
  return typeof GFX_TOUCH !== 'undefined' && !!GFX_TOUCH;
})();
var drsScale = 1.0, _drsHotT = 0, _drsCoolT = 0, _drsDeepT = 0, _drsFxDeep = false, _drsWarmT = -1, _drsSettleT = 0;
var DRS_HOT = 22, DRS_COOL = 14, DRS_DEEP = 28, DRS_FLOOR = 0.6, DRS_STEP = 0.1;
var DRS_HOT_DWELL = 1.5, DRS_COOL_DWELL = 5.0, DRS_DEEP_DWELL = 3.0, DRS_WARMUP = 4.0;
var DRS_SETTLE = 3.0;                  // ★直升机专项 C1(报告 §六):档位变化后的稳定窗——窗口内冻结决策、驻留清零重计,
                                       // 打断"降档→变轻→升档→变重"的分辨率泵动环(业界滞回设计:持续富余才升档);
                                       // ★C2:升档驻留 3s→5s,回升更保守,减少切换次数(每次切换=setSize+漫画RT重建=移动端一次顿挫)
function drsApply() {                    // 像素比单一落笔点(基准×全局DRS×开镜档)
  if (typeof renderer === 'undefined' || !renderer) return;
  var base = (typeof _basePixelRatio !== 'undefined' && _basePixelRatio > 0) ? _basePixelRatio : 1;
  var scope = (typeof _scopeResHi !== 'undefined' && _scopeResHi && typeof _scopeResRatio !== 'undefined') ? _scopeResRatio : 1;
  renderer.setPixelRatio(Math.max(0.35, base * drsScale * scope));
  if (typeof innerWidth !== 'undefined') renderer.setSize(innerWidth, innerHeight, false);
}
function drsTick(wallMs, dtSec) {        // 每帧调用(墙钟帧时 + 渲染间隔);返回是否发生档位变化
  if (!DRS_ON) return false;
  if (typeof gameState !== 'undefined' && gameState !== 'playing' && gameState !== 'paused') {   // 菜单/结算:回满不降
    if (drsScale !== 1.0) { drsScale = 1.0; _drsHotT = _drsCoolT = _drsDeepT = _drsSettleT = 0; if (_drsFxDeep) { _drsFxDeep = false; if (typeof WRSMOKE_AMT !== 'undefined') WRSMOKE_AMT = 1.0; } drsApply(); return true; }
    _drsHotT = _drsCoolT = _drsDeepT = 0;
    return false;
  }
  if (wallMs > 120) { _drsHotT = _drsCoolT = _drsDeepT = 0; return false; }   // 大停顿/切页:不计驻留(EMA 端由调用方钳制)
  if (_drsWarmT < 0) _drsWarmT = 0;
  _drsWarmT += dtSec;
  if (_drsWarmT < DRS_WARMUP) return false;
  var ema = (typeof _wallMsEMA === 'number') ? _wallMsEMA : wallMs;
  var changed = false;
  if (_drsSettleT > 0) {                          // ★C1 稳定窗:档位刚变过 → 冻结升降决策,驻留清零重计(打断泵动环)
    _drsSettleT -= dtSec;
    _drsHotT = 0; _drsCoolT = 0;
  } else {
    if (ema > DRS_HOT) { _drsHotT += dtSec; _drsCoolT = 0; }
    else if (ema < DRS_COOL) { _drsCoolT += dtSec; _drsHotT = 0; _drsDeepT = 0; }
    else { _drsHotT = 0; _drsCoolT = 0; _drsDeepT = 0; }
    if (_drsHotT >= DRS_HOT_DWELL && drsScale > DRS_FLOOR + 1e-6) {
      drsScale = Math.max(DRS_FLOOR, Math.round((drsScale - DRS_STEP) * 10) / 10);
      _drsHotT = 0; _drsCoolT = 0; _drsSettleT = DRS_SETTLE; changed = true;
    } else if (_drsCoolT >= DRS_COOL_DWELL && drsScale < 1.0 - 1e-6) {
      drsScale = Math.min(1.0, Math.round((drsScale + DRS_STEP) * 10) / 10);
      _drsCoolT = 0; _drsHotT = 0; _drsSettleT = DRS_SETTLE; changed = true;
    }
  }
  /* 二级旋钮:像素比已触底仍持续重载 → 收紧残骸烟密度(特效密度档) */
  if (drsScale <= DRS_FLOOR + 1e-6 && ema > DRS_DEEP) _drsDeepT += dtSec; else _drsDeepT = 0;
  if (_drsDeepT >= DRS_DEEP_DWELL && !_drsFxDeep) { _drsFxDeep = true; if (typeof WRSMOKE_AMT !== 'undefined') WRSMOKE_AMT = 0.45; }
  if (_drsFxDeep && ema < DRS_COOL && drsScale >= 1.0 - 1e-6) { _drsFxDeep = false; if (typeof WRSMOKE_AMT !== 'undefined') WRSMOKE_AMT = 1.0; }
  if (typeof window !== 'undefined') window.__DRS = { scale: drsScale, ema: ema, hot: _drsHotT, cool: _drsCoolT, settle: _drsSettleT, fxDeep: _drsFxDeep };
  if (changed) drsApply();
  return changed;
}
/* P2-DRS-END */
var _wallMsEMA = 0;                      // ★P2-⑧:墙钟帧时 EMA(喂 drsTick;GPU 瓶颈帧也计入,与 _frameMsEMA 的 JS 口径互补)
var _simAcc = 0;                        // 定步长累积器(渲染帧间隔入账,模拟按 20ms 整步消费)
var _spikeN = 0, _spikeWorst = 0;   // 诊断账:停顿帧次数/最差原始帧时(控制台读 window.__SPIKE;零开销,仅真停顿帧才写)
var _perfAcc = 0.5;                      // 细分面板独立 0.5s 窗口(与 dcAudit 2s 解耦——面板读数恢复真实 0.5s 口径)
var _stepMsEMA = 0, _frameMsEMA = 0;     // CPU 拆分计时——step(模拟)ms 与整帧 JS ms(EMA);JS 低而 fps 低=GPU 瓶颈
var _dcaAcc = 2;                         // DC 归因审计节流(2s 一拍:scene.traverse 开销随残骸累积的节点数线性增长,诊断读数无需 2Hz)
var cmdTickT = 0;                        // 指挥官 1Hz 节流
function animate() {
  requestAnimationFrame(animate);
  if (typeof audioPauseSync === 'function') audioPauseSync();   // 暂停即静音看门狗
  var _t0 = performance.now();
  var _wallDt = _lastFrameT ? Math.min((_t0 - _lastFrameT) / 1000, 0.25) : 0;
  _lastFrameT = _t0;
  /* ★定步长模拟 + 渲染插值(Rigidbody interpolation, 行驶卡顿结构性根治):
     若按"每渲染帧恰好一次变步长 step(dt)"推进——模拟粒度=渲染帧粒度,帧间隔抖动(GC/GPU 同步/合成器,
     哪怕 5~15ms 正常波动)会被原样注入单步位移;相机 lerp(τ≈0.13s)与物理推进是两个不同步的平滑器,
     帧间隔波动时互相追赶 = rubber-banding,钳 dt 只能治标。
     故模拟永远以 SIM_DT=20ms 恒定推进(与渲染帧率完全解耦),渲染把活车 group 写成
     lerp(上一步末, 本步末, alpha),alpha=累积器余量/步长——任意 fps 下车体屏幕运动匀速平滑;
     偶发大停顿→累积器多走几步(封顶 3),超限时间丢弃=短暂慢动作,永不瞬移。
     每步三段式:① group 恢复模拟态并记 prev=上一步末(渲染写过插值态,物理必须从真态积分)
               ② step(SIM_DT) 恒定步长推进(内部 AI/碰撞/贴地/粒子全部吃固定 dt=确定性)
               ③ 存本步末模拟态(_ipP/_ipQ,渲染插值的两端点) */
  var dtRaw = clock.getDelta();
  var renderDt = Math.min(dtRaw, 0.0667);           // 渲染帧节奏量(相机/DOM/履带纹/UI 节流用);仅防爆炸
  _simAcc += renderDt;
  var _steps = 0, _dropped = 0;
  if (gameState === 'playing') {
    while (_simAcc >= SIM_DT) {
      if (_steps >= SIM_MAX_STEPS) {
        _dropped += _simAcc;
        _simAcc = 0;
        for (si = 0; si < aliveList.length; si++) {
          st = aliveList[si];
          if (st && st._ipP) {
            st._ipPv.copy(st._ipP);
            st._ipQv.copy(st._ipQ);
            if (st.mainRotorGroup && st._ipRA != null) st._ipRAv = st._ipRA;
            if (st.tailRotorGroup && st._ipTA != null) st._ipTAv = st._ipTA;
          }
        }
        break;
      }
      _simAcc -= SIM_DT;
      var si, st;
      for (si = 0; si < aliveList.length; si++) {
        st = aliveList[si];
        if (!st._ipP) { st._ipP = st.group.position.clone(); st._ipPv = st._ipP.clone();   // 惰性初始化(新生车/开局)
                        st._ipQ = st.group.quaternion.clone(); st._ipQv = st._ipQ.clone();
                        st._ipRA = st._heliRotorAngle || 0; st._ipRAv = st._ipRA;          // ★旋翼角插值端点(非直升机恒 0,不写)
                        st._ipTA = st._heliTailRotorAngle || 0; st._ipTAv = st._ipTA; }
        st._ipPv.copy(st._ipP); st._ipQv.copy(st._ipQ);                 // prev = 上一步末
        st._ipRAv = st._ipRA; st._ipTAv = st._ipTA;                     // ★旋翼角 prev(标量直赋,不能 copy)
        st.group.position.copy(st._ipP); st.group.quaternion.copy(st._ipQ);   // group ← 模拟态(剥离渲染插值)
      }
      step(SIM_DT);
      for (si = 0; si < aliveList.length; si++) {
        st = aliveList[si];
        if (!st._ipP) continue;                                          // 本步中途新生车:留待下步入轨
        st._ipP.copy(st.group.position); st._ipQ.copy(st.group.quaternion);
        st._ipRA = st._heliRotorAngle; st._ipTA = st._heliTailRotorAngle;   // ★旋翼角本步末(非直升机 undefined)
      }
      _steps++;
    }
    /* 渲染插值回写:group ← lerp(prev, curr, alpha);玩家/AI 活车统一。
       炮塔/炮管是限速慢变量(≤0.7rad/s→每步 0.014rad,亚视觉)不插值;残骸仅被推时慢动(≤0.14m/步)不插值。
       ★主旋翼/尾桨角必须插值(唯一例外,2026-09-13):旋翼 34rad/s = 每步 0.68rad(39°),比上述"慢变量"
       阈值快约 50 倍 —— 只写定步长=50Hz 台阶,与渲染帧率错拍成"顿一下跳一下";更糟的是 5 叶对称 72° 下
       39°>36°(半对称角)会走样成每步 −33° 的**倒转**,与"一卡一卡"的观感完全吻合。
       按 alpha 在两端点间插值后,每渲染帧前进 (renderDt/SIM_DT)×39°(60fps≈32.6°<36°)= 平滑正转、不走样。
       环绕处理:差值先折到 ±π 再插值(每步 0.68rad ≪ π,折叠无歧义)。 */
    var _alpha = _simAcc / SIM_DT, sk, sr, _rotD;
    for (sk = 0; sk < aliveList.length; sk++) {
      sr = aliveList[sk];
      if (!sr._ipP) continue;
      sr.group.position.lerpVectors(sr._ipPv, sr._ipP, _alpha);
      sr.group.quaternion.copy(sr._ipQv).slerp(sr._ipQ, _alpha);
      if (sr.mainRotorGroup && sr._ipRA != null) {
        _rotD = sr._ipRA - sr._ipRAv;
        if (_rotD > Math.PI) _rotD -= TAU; else if (_rotD < -Math.PI) _rotD += TAU;
        sr.mainRotorGroup.rotation.y = sr._ipRAv + _rotD * _alpha;
      }
      if (sr.tailRotorGroup && sr._ipTA != null) {
        _rotD = sr._ipTA - sr._ipTAv;
        if (_rotD > Math.PI) _rotD -= TAU; else if (_rotD < -Math.PI) _rotD += TAU;
        sr.tailRotorGroup.rotation.x = sr._ipTAv + _rotD * _alpha;
      }
      sr.group.updateMatrixWorld(true);    // _instMatFor 读 matrixWorld(hull 实例矩阵)——回写后必须刷新
    }
    if (window._dbgPerfOn) window.__SIM = { steps: _steps, droppedMs: +(_dropped * 1000).toFixed(1), alpha: +_alpha.toFixed(3) };   // 诊断(调试模式开时)
  }
  if (dtRaw > 0.05) {                               // 诊断:真停顿帧才计账(>50ms;正常帧时波动远低于此)
    _spikeN++;
    if (dtRaw > _spikeWorst) _spikeWorst = dtRaw;
    window.__SPIKE = { n: _spikeN, worstMs: _spikeWorst * 1000 };
  }
  if (gameState === 'playing') {
    cameraUpdate(renderDt);
    scopeHudUpdate();
  }   // ★相机按渲染帧节奏跟随插值后的玩家
  sqArrowsTick();                                     // 指挥模式屏幕外小队箭头(未激活=单布尔早退;相机矩阵在函数内定稿)
  sqFlagTick();                                       // 占领旗面向相机(隐藏态单布尔早退;单对象一次 atan2)
  var _t1 = performance.now();
  instUpdateAll();                                 // 实例流每帧重排(非 playing 也跑——收尾帧清死亡车实例;空表零成本)
  if (typeof vehInkLodTick === 'function') vehInkLodTick();   // P1: 近车折边 LOD(矩阵已随插值定稿)
  trackAnimUpdate(renderDt);                       // 履带纹路滚动动态(玩家+LOD 候选 AI 车:常规 100m 内且画面内/炮镜画面内不限距;按渲染帧节奏;非 playing 时 player 为空自动跳过)
  trackDynCommit();                                // 定长路径纹理统一上传(每帧一次;无脏数据零成本)
  if (window._dbgPerfOn) { var _tWck = performance.now(); wckFlush(); if (window.__PERF) window.__PERF.wck += performance.now() - _tWck; }   // wck 探针:细分面板显示 wckFlush 实际 ms(仅调试开时计时,生产零开销)
  else wckFlush();                                 // 残骸合批:排空脏区(全异步自适应;新亡/被推残骸的区网格更新)
  if (typeof _sprStream === 'function' && camera) _sprStream(camera.position.x, camera.position.z);   // R22-T1:场景精灵区块流式(跨区块才增量加载/卸载;未跨零成本)
  if (typeof treesUpdate === 'function') treesUpdate(renderDt);   // 纸板树:相机定稿后 billboard 合成 + 倒地推进(渲染帧节奏)
  if (typeof stumpsUpdate === 'function') stumpsUpdate(renderDt); // 纸板树桩:碾/炮弹倒树后原地留桩(初生闪烁)
  if (typeof grassUpdate === 'function') grassUpdate(renderDt);   // 纸板花草丛:抖动/爆炸倒没推进 + billboard 合成
  if (typeof bsFlush === 'function') bsFlush();                   // 烘焙式地物阴影:仅重烘焙「脏」provider(状态变更事件级;非脏零成本)
  /* 漫画渲染单点钩子(唯一渲染模式):场景渲进离屏 RT 经 comic.js 全屏合成;
     模块未载/着色器异常时 comicRender 内部直渲兜底 */
  if (typeof comicRender === 'function') comicRender(scene, camera);
  else renderer.render(scene, camera);
  var _t2 = performance.now();
  PERF_BASE.renderMs += _t2 - _t1;
  perfMarkWindow(_wallDt, _t2 - _t0, _t1 - _t0, _t2 - _t1);
  _stepMsEMA += ((_t1 - _t0) - _stepMsEMA) * 0.08;
  _frameMsEMA += ((_t2 - _t0) - _frameMsEMA) * 0.08;
  var _wallMsNow = _wallDt * 1000;
  _wallMsEMA += (Math.min(_wallMsNow, 120) - _wallMsEMA) * 0.06;   // ★P2-⑧(移动端恢复):墙钟帧时 EMA(>120ms 尖峰钳制)
  drsTick(_wallMsNow, _wallDt);
  _fpsAcc += _wallDt; _fpsN++;
  if (_fpsAcc >= 0.5) {
    _fpsT = Math.round(_fpsN / _fpsAcc);
    _fpsN = 0; _fpsAcc = 0;
    // 仪表先行——renderer.info 实时 draw call / 三角形数(定位真实瓶颈:draw call 高=CPU 提交瓶颈,
    //   二者低而 fps 仍低=GPU 填充/着色瓶颈;之前盲猜多轮收效微弱,从此用数据定位)
    var ri = renderer.info.render;
    /* fps 行拆分:帧率显示关=不写(整行已隐);调试模式开=附加 dc/tri/JS/step 拆分,关=纯帧数 */
    if (el.fps && window._fpsShow) el.fps.textContent = window._dbgPerfOn
      ? _fpsT + ' fps · ' + ri.calls + ' dc · ' + (ri.triangles > 999999 ? (ri.triangles / 1000000).toFixed(1) + 'M' : Math.round(ri.triangles / 1000) + 'k') + ' tri · JS' + _frameMsEMA.toFixed(1) + '/step' + _stepMsEMA.toFixed(1) + 'ms'   // di:JS 耗时拆分(帧时=1000/fps;JS≪帧时→GPU 瓶颈)
      : _fpsT + ' fps';
    if (el.sigfps && window._fpsShow) el.sigfps.textContent = _fpsT;   // 信号组FPS段(联动帧率显示开关)
  }
  _dcaAcc += renderDt;            // UI 节流按渲染帧节奏(墙钟口径,不受模拟步进影响)
  if (_dcaAcc >= 2) {
    _dcaAcc = 0;
    if (window._dbgPerfOn || (typeof window !== 'undefined' && window.__TANK_DEBUG)) dcAuditShow();   // DC 归因——主通道可见网格分桶;仅调试模式/无头调试执行 scene.traverse(节点数随残骸累积线性增长),生产零开销
  }
  _perfAcc += renderDt;
  if (_perfAcc >= 0.5) { _perfAcc = 0; perfPanelUpdate(); }   // 细分面板 0.5s 独立窗口(关闭时内部早退,零开销)
}

/* ============================================================
   初始化
   ============================================================ */
console.log('[BOOT] ARMORED CORPS');
/* ############################################################
   以下至文件尾均为调试/自检设施(细分面板/DC 审计/基线构造/自动基线协议);
   全部由 __TANK_DEBUG / _dbgPerfOn / ?autotest= 门控,生产路径零开销。
   ############################################################ */
/* ============================================================
   DC 归因审计——每 2s 把场景可见网格分桶,回答"draw call 到底花在哪"(节流:节点数随残骸累积,traverse 成本随之增长)。
   renderer.info.render.calls=总账(含阴影深度 pass);本表=主通道可见网格数,两表对照即得阴影 pass 占比。
   桶序:在飞弹>火箭实例>残骸>LOD>实例源(应为0!漏点亮=双渲染事故)>个体视觉(玩家车=1)>实例流>points/sprite>杂项
   ============================================================ */
var _dcaEl = null;
function dcAudit() {
  var buckets = {}, total = 0, casters = 0;
  scene.traverse(function (m) {
    if (!m.visible) return;
    if (!(m.isMesh || m.isPoints || m.isSprite)) return;
    total++;
    if (m.castShadow) casters++;
    var k;
    if (typeof rocketBodies !== 'undefined' && (m === rocketBodies || m === rocketFlames)) k = 'ROCKET INST';
    else if (m.isInstancedMesh) k = 'INST:' + (m.userData.instPart || '?');
    else if (m.isMesh && typeof shellGeo !== 'undefined' && m.geometry === shellGeo) k = 'SHELL MESH LEAK';
    else if (m.userData.wreck) k = 'WRECK MERGED';
    else if (m.userData._instSrc) k = 'INST SRC LEAK';
    else if (m.userData.lod) k = 'VEH LOD';
    else if (m.userData.visual) k = 'VEH SINGLE';
    else if (m.isPoints) k = 'points:' + (m.name || '?');
    else if (m.isSprite) k = 'sprite';
    else k = 'MISC:' + (m.name || (m.material && m.material.name) || '?');
    buckets[k] = (buckets[k] || 0) + 1;
  });
  return { buckets: buckets, total: total, casters: casters };
}
function dcAuditShow() {
  try {
    var dc = dcAudit(), arr = [], bk;
    for (bk in dc.buckets) arr.push([bk, dc.buckets[bk]]);
    arr.sort(function (a, b) { return b[1] - a[1]; });
    var s = 'DC:' + dc.total + ' VIS/' + dc.casters + ' SHADOW ' +
      arr.slice(0, 7).map(function (e) { return e[0] + '=' + e[1]; }).join(' ');
    if (arr.length > 7) s += ' +' + (arr.length - 7) + ' TYPES';
    if (!_dcaEl) {
      _dcaEl = document.createElement('div');
      _dcaEl.style.cssText = 'position:absolute;top:38px;right:22px;color:#9dffa8;font-family:VT323,\'Courier New\',monospace;font-size:14px;letter-spacing:1px;text-align:right;background:rgba(6,12,5,.92);padding:3px 10px;border:1px solid #3d4a2e;box-shadow:0 0 10px rgba(157,255,168,.12), 2px 2px 0 #040704;text-shadow:0 0 6px rgba(140,255,158,.35);z-index:60;pointer-events:none;white-space:pre';
      var hudEl = document.getElementById('hud');
      (hudEl || document.body).appendChild(_dcaEl);
    }
    _dcaEl.textContent = s;
    if (window.__dca) console.table(dc.buckets);
  } catch (e) { /* 审计故障不挡游戏 */ }
}

/* ============================================================
   调试模式/帧率显示(游戏设置页两按钮):
   · 调试模式=window._dbgPerfOn:step 细分计时面板(#perfPanel)+DC 归因行+fps 行附加信息
     (dc/tri/JS/step 耗时拆分)全并入此门;关=生产零计时开销(既有门沿用)。
   · 帧率显示=window._fpsShow:信号组#sigfps段显隐;可单独开。
   · 联动:开调试→自动开帧率;关帧率→自动关调试。
   localStorage 持久化;全部按钮事件驱动,无逐帧读取。
   ============================================================ */
(function () {
  if (typeof document === 'undefined') return;
  try {
    var st = document.createElement('style');
    st.textContent = '#perfPanel{position:absolute;top:72px;right:22px;z-index:62;color:#9dffa8;font-family:VT323,\'Courier New\',monospace;font-size:14px;letter-spacing:1px;line-height:1.4;' +
      'text-align:right;background:rgba(6,12,5,.92);padding:4px 10px;border:1px solid #3d4a2e;border-radius:0;box-shadow:0 0 10px rgba(157,255,168,.12), 2px 2px 0 #040704;white-space:pre;display:none;' +
      'pointer-events:none;text-shadow:0 0 6px rgba(140,255,158,.35)}';
    document.head.appendChild(st);
    var panel = document.createElement('div'); panel.id = 'perfPanel';
    document.body.appendChild(panel);
    window._dbgPerfPanel = panel;
    var bD = document.getElementById('dbgmodebtn'), bF = document.getElementById('fpsshowbtn');
    var LS_D = 'prefDebugMode', LS_F = 'prefFpsShow';
    var _dOn = false, _fOn = true;
    try {
      _dOn = localStorage.getItem(LS_D) === '1';
      var f = localStorage.getItem(LS_F); _fOn = f === null ? true : f === '1';
    } catch (e) { /* 无存储环境安静跳过 */ }
    if (_dOn && !_fOn) _fOn = true;                      // 持久化态自洽:调试开则帧率必开
    function apply() {
      window._dbgPerfOn = _dOn; window._fpsShow = _fOn;
      if (bD) { bD.textContent = 'Debug: ' + (_dOn ? 'On' : 'Off'); bD.classList.toggle('sel', _dOn); }
      if (bF) { bF.textContent = 'FPS: ' + (_fOn ? 'On' : 'Off'); bF.classList.toggle('sel', _fOn); }
      panel.style.display = _dOn ? 'block' : 'none';
      if (_dcaEl) _dcaEl.style.display = _dOn ? '' : 'none';   // DC 归因行随调试模式显隐(关闭时收走残留文本)
      var fpsEl = document.getElementById('fps');
      if (fpsEl) fpsEl.style.display = _fOn ? '' : 'none';
      var sigFps = document.getElementById('sigfps');   // 关帧率=信号组FPS段消失(Flex框自动缩短)
      if (sigFps) sigFps.style.display = _fOn ? '' : 'none';
      try { localStorage.setItem(LS_D, _dOn ? '1' : '0'); localStorage.setItem(LS_F, _fOn ? '1' : '0'); } catch (e) { /* 同上 */ }
    }
    if (bD) bD.onclick = function () { _dOn = !_dOn; if (_dOn) _fOn = true; apply(); };    // 开调试→帧率联动开
    if (bF) bF.onclick = function () { _fOn = !_fOn; if (!_fOn) _dOn = false; apply(); };  // 关帧率→调试联动关
    apply();
  } catch (e) { /* 按钮故障不挡游戏 */ }
})();
/* ===== 画质档(T2-3):高/中/低三档,落 localStorage.prefGfxProfile,重启生效 ----
   渲染器/阴影贴图/副渲染器全部是启动期按 GFX 一次性分配的;运行中切档要重建整条 GL 链
   (与开镜 DRS 的 setPixelRatio/RT 重建是同一类操作),不值得为此做热切换,所以这里只写偏好,
   并明确提示"重启生效"——宁可让用户多按一次启动,也不给一个切了没反应的假开关。
   ?gfx= 查询串优先级高于本设置(桌面 A/B 与回归验证用),按钮态仍如实反映 localStorage。 ===== */
(function () {
  try {
    var row = document.getElementById('gfxrow'), val = document.getElementById('gfxval');
    if (!row) return;
    var btns = row.querySelectorAll('button[data-gfx]');
    if (!btns.length) return;
    var LS = 'prefGfxProfile';
    var NAMES = { high: 'HIGH', mid: 'MED', low: 'LOW' };
    function stored() {
      try { var s = localStorage.getItem(LS); return (s === 'high' || s === 'mid' || s === 'low') ? s : ''; }
      catch (e) { return ''; }
    }
    function apply() {
      var st = stored();
      var eff = /[?&]gfx=(high|mid|low)\b/.exec(window.location.search || '');
      var cur = eff ? eff[1] : (st || (typeof GFX_PROFILE !== 'undefined' ? GFX_PROFILE : ''));
      /* 高亮"当前生效档"而非"已存储档":未选择时也要让玩家看到自己正处在哪一档,
         否则整个按钮组看起来像没初始化;是否属于设备默认由文案说明。 */
      for (var i = 0; i < btns.length; i++)
        if (btns[i].classList && btns[i].classList.toggle)
          btns[i].classList.toggle('sel', btns[i].getAttribute('data-gfx') === cur);
      if (val) val.textContent = eff
        ? ('CUR: ' + (NAMES[cur] || cur) + ' (OVERRIDDEN BY URL PARAM)')
        : (st ? ('CUR: ' + (NAMES[cur] || cur)) : ('CUR: ' + (NAMES[cur] || cur) + ' (DEFAULT)'));
    }
    for (var i = 0; i < btns.length; i++) (function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-gfx');
        if (v !== 'high' && v !== 'mid' && v !== 'low') return;
        try { localStorage.setItem(LS, v); } catch (e) { /* 无存储环境:本次会话内仍按原档 */ }
        apply();
        if (val) val.textContent = 'SEL: ' + NAMES[v] + ' (RESTART TO APPLY)';
      });
    })(btns[i]);
    apply();
  } catch (e) { /* 按钮故障不挡游戏 */ }
})();
/* ===== 爆炸效果档:高/低两档,落 localStorage.prefFxQuality,重启生效 ----
   与画质档完全解耦:高 = 原画质"中"的爆炸质量,低 = 原画质"低"的爆炸质量
   (数值见 core_util.js FXQ_PRESETS)。重启生效的理由与画质档相同:
   爆炸贴图在加载期一次烘焙、池并发上限在模块加载期快照,热切要重建全部特效池。
   ?fxq= 查询串优先级高于本设置(桌面 A/B 与回归验证用)。 ===== */
(function () {
  try {
    var row = document.getElementById('fxqrow'), val = document.getElementById('fxqval');
    if (!row) return;
    var btns = row.querySelectorAll('button[data-fxq]');
    if (!btns.length) return;
    var LS = 'prefFxQuality';
    var NAMES = { high: 'HIGH', mid: 'MED', low: 'LOW' };
    function stored() {
      try { var s = localStorage.getItem(LS); return (s === 'high' || s === 'mid' || s === 'low') ? s : ''; }
      catch (e) { return ''; }
    }
    function apply() {
      var st = stored();
      var eff = /[?&]fxq=(high|mid|low)\b/.exec(window.location.search || '');
      var cur = eff ? eff[1] : (st || (typeof FXQ_PROFILE !== 'undefined' ? FXQ_PROFILE : ''));
      for (var i = 0; i < btns.length; i++)
        if (btns[i].classList && btns[i].classList.toggle)
          btns[i].classList.toggle('sel', btns[i].getAttribute('data-fxq') === cur);
      if (val) val.textContent = eff
        ? ('CUR: ' + (NAMES[cur] || cur) + ' (OVERRIDDEN BY ?fxq=)')
        : (st ? ('CUR: ' + (NAMES[cur] || cur)) : ('CUR: ' + (NAMES[cur] || cur) + ' (DEFAULT)'));
    }
    for (var i = 0; i < btns.length; i++) (function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-fxq');
        if (v !== 'high' && v !== 'mid' && v !== 'low') return;
        try { localStorage.setItem(LS, v); } catch (e) { /* 无存储环境:本次会话内仍按原档 */ }
        apply();
        if (val) val.textContent = 'SEL: ' + NAMES[v] + ' (RESTART TO APPLY)';
      });
    })(btns[i]);
    apply();
  } catch (e) { /* 按钮故障不挡游戏 */ }
})();
/* ===== 模型质量档:高/中/低三档,落 localStorage.prefModQuality,重启生效 ----
   管辖机库 3D 展示 + 炮塔 HUD 迷你窗(MSAA/像素比/阴影/后处理),与画质档完全解耦,
   三档取值 = 原画质三档的模型精度(数值见 core_util.js MODQ_PRESETS)。
   重启生效:机库/PHUD 渲染器都是一次性创建的(创建期读档),与画质档同理不做热切换。
   ?modq= 查询串优先级高于本设置(桌面 A/B 与回归验证用)。 ===== */
(function () {
  try {
    var row = document.getElementById('modqrow'), val = document.getElementById('modqval');
    if (!row) return;
    var btns = row.querySelectorAll('button[data-modq]');
    if (!btns.length) return;
    var LS = 'prefModQuality';
    var NAMES = { high: 'HIGH', mid: 'MED', low: 'LOW' };
    function stored() {
      try { var s = localStorage.getItem(LS); return (s === 'high' || s === 'mid' || s === 'low') ? s : ''; }
      catch (e) { return ''; }
    }
    function apply() {
      var st = stored();
      var eff = /[?&]modq=(high|mid|low)\b/.exec(window.location.search || '');
      var cur = eff ? eff[1] : (st || (typeof MODQ_PROFILE !== 'undefined' ? MODQ_PROFILE : ''));
      for (var i = 0; i < btns.length; i++)
        if (btns[i].classList && btns[i].classList.toggle)
          btns[i].classList.toggle('sel', btns[i].getAttribute('data-modq') === cur);
      if (val) val.textContent = eff
        ? ('CUR: ' + (NAMES[cur] || cur) + ' (OVERRIDDEN BY ?modq=)')
        : (st ? ('CUR: ' + (NAMES[cur] || cur)) : ('CUR: ' + (NAMES[cur] || cur) + ' (DEFAULT)'));
    }
    for (var i = 0; i < btns.length; i++) (function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-modq');
        if (v !== 'high' && v !== 'mid' && v !== 'low') return;
        try { localStorage.setItem(LS, v); } catch (e) { /* 无存储环境:本次会话内仍按原档 */ }
        apply();
        if (val) val.textContent = 'SEL: ' + NAMES[v] + ' (RESTART TO APPLY)';
      });
    })(btns[i]);
    apply();
  } catch (e) { /* 按钮故障不挡游戏 */ }
})();
/* 细分面板刷新(dcAuditShow 每 0.5s 调用):__PERF 累计量取窗口差分 */
var _perfPrev = null;
function perfPanelUpdate() {
  var panel = window._dbgPerfPanel, p = window.__PERF;
  if (!panel || !window._dbgPerfOn || !p) return;
  if (!_perfPrev) _perfPrev = {};
  var lines = [], tot = 0, k, d;
  for (k in p) {
    if (k === 'n') continue;
    d = (p[k] || 0) - (_perfPrev[k] || 0); _perfPrev[k] = p[k] || 0;
    if (d >= 0.5) lines.push([k, d]);
    tot += d;
  }
  lines.sort(function (a, b) { return b[1] - a[1]; });
  panel.textContent = 'STEP ms/0.5s: ' + (lines.length
    ? lines.map(function (e) { return e[0] + ':' + e[1].toFixed(1); }).join(' ')
    : '—') + '\nTOTAL:' + tot.toFixed(1);
}
/* Migrate obsolete settings keys once. */
try { localStorage.removeItem('ws_custom_model'); localStorage.removeItem('prefJoyMode'); } catch (e) { /* 无存储环境安静跳过 */ }
grabEls();
if (typeof window._setBootProgress === 'function') window._setBootProgress(90, 'CALIBRATING BALLISTICS & AUDIO DSP...');
  buildMenuButtons();
initScene();
initRocketVfx();
initHeliMissileVfx();
initShellVfx();                                    // 坦克炮弹全场实例化(2 draw call 收全部在飞弹)
initClouds();
initFlash();
initEmberFx();
/* ★任务27③:特效池启动预热 + 着色器预编译(加载期一次性成本,根治「一播放爆炸特效就卡一下」):
   ① comic/fx 全部惰性池(蘑菇云/火球/枪口焰/扬尘/命中火花/硝烟/弹道线/残骸火星…)预先构建;
   ② renderer.compile 预链接全场景材质着色器——池网格恒 visible=false 而 compile 只遍历可见物,
     故临时置可见、编译后复原(纯遍历,不渲染不动画)。预热失败绝不阻断启动(falls back to lazy initialization)。 */
if (typeof window._setBootProgress === 'function') window._setBootProgress(95, 'PREWARMING FX SHADERS...');
/* ★★ 预热的调用时机(修正一个长期失效的接线)——
   index.html MODULES 序是 … main.js(621) → comic_common.js(622) → comic.js(623)。
   也就是说 main.js 执行时 comic.js **尚未解析**,`typeof comicPrewarm === 'function'` 恒为 false,
   于是任务27③ 写下的那句守卫调用**一直在静默跳过**:全部漫画特效池(爆点卡/殉爆卡/枪口焰/
   扬尘/命中火花/硝烟/弹道线)始终是"首次事件才惰性构建",而 renderer.compile 当时也还没有
   这些池网格可编译 —— 预热注释描述的症状(「一播放爆炸特效就卡一下,单次爆炸也卡」)因此从未被治好。
   现改为:此处只**定义**,由 comic.js 末尾(最后一个玩法模块)回调。
   仍属"加载期同步执行"——animate() 的首个 rAF 回调只能在文档内全部同步脚本跑完后才触发,
   所以预热依旧发生在第一帧之前,boot 进度条语义不变。 */
function gamePrewarm() {
  try {
    if (typeof comicPrewarm === 'function') comicPrewarm();
    if (typeof fxPrewarm === 'function') fxPrewarm();
    if (typeof renderer !== 'undefined' && renderer && renderer.compile && typeof scene !== 'undefined' && scene && typeof camera !== 'undefined' && camera) {
      var _pwHidden = [];
      scene.traverse(function (o) { if (o.visible === false) { _pwHidden.push(o); o.visible = true; } });
      renderer.compile(scene, camera);
      for (var _pwI = 0; _pwI < _pwHidden.length; _pwI++) _pwHidden[_pwI].visible = false;
    }
    /* ★E1-6(附录 B §B.2):renderer.compile 只链接着色器、不上传纹理 —— 实测本工程内置 three 的
       compile 只调 initMaterial/getProgram。爆点(1024²火光+3×1024²烟)与殉爆(512²云冠等)两套
       共约 24MB 贴图,原本要到「第一次爆炸被渲染的那一帧」才 texImage2D + 生成 mipmap,
       在 Android WebView 上是单帧数百 ms 的停顿(=用户说的「只炸一次也卡一下」)。
       这里用 three 现成的 renderer.initTexture 在加载期一次付清。逐张 try:某张贴图异常不阻断启动。 */
    if (typeof renderer !== 'undefined' && renderer && renderer.initTexture) {
      var _pwTex = [];
      if (typeof comicFxTextures === 'function') _pwTex = _pwTex.concat(comicFxTextures());
      if (typeof fxTextures === 'function') _pwTex = _pwTex.concat(fxTextures());
      for (var _tI = 0; _tI < _pwTex.length; _tI++) {
        if (!_pwTex[_tI]) continue;
        try { renderer.initTexture(_pwTex[_tI]); } catch (eTex) { /* 单张失败跳过 */ }
      }
    }
  } catch (ePrewarm) { /* 预热失败不阻断启动 */ }
}
window.gamePrewarm = gamePrewarm;
/* Load only the saved custom snapshot here; TO BATTLE can still use its own
   current mode/random defaults until the custom menu is opened. */
if (typeof loadCustomBattleSettings === 'function') loadCustomBattleSettings(false);
initInput();
bindStartSideUI();
bindStartKindUI();
bindStartControlZonesUI();
bindStartMapUI();
bindStartSetupUI();                   // 遭遇战编制配置(红/蓝独立,型号输入遍历 VEHICLE_KINDS 自动生成)
if (typeof bindGameModeUI === 'function') bindGameModeUI();
bindStartHourUI();
bindVolumeUI();                       // 游戏设置:音量滑块(偏好落地见 audio.js)
bindBgmUI();                          // 游戏设置:背景音乐滑块
playMenuBgm();                        // 启动主菜单背景音乐(3秒间隔循环)
bindRespawnUI();
bindPossessUI();
refreshVehicleChoiceLabels();                    // 初始红方显示红方歼击车;切到蓝方即时改为BLUE_MBT_2

animate();

/* ============================================================
   基准场景构造 —— __DBG_HOOKS.makeMidgame 与
   ?autotest=midgame 自动协议共用的全局实现:
   · clearAllAI:只留玩家 + 清空增援队列(场景隔离,原 clearAI 钩子体上移)
   · buildMidgame:双方各半活车(默认共 160,64:16:8 编制比)散布中线
     ±400m×±300m 交战带 + 残骸(默认 250)散布 ±250m×±150m 堆积带;
     固定种子(mulberry32(0x51DE221))布局逐次一致(A/B 可比);
     清空增援队列冻结种群(采样窗内 alive/wreck 漂移只来自真实交战,不消耗兵力)。
   ============================================================ */
function clearAllAI() {
  var ci, ri, rj;
  for (ci = tanks.length - 1; ci >= 0; ci--) {
    var ct = tanks[ci];
    if (ct._occMesh) { ct._occMesh.geometry.dispose(); ct._occMesh = null; }   // 遮挡代理几何随车销毁(含玩家残骸情形;网格引用由下方 clear 统一清)
    if (ct.isPlayer) continue;
    scene.remove(ct.group);
    tanks.splice(ci, 1);
  }
  respawnQueue.length = 0;
  aliveList.length = 0;                      // 活车紧凑表随场景隔离重建
  teamCounts.red = 0; teamCounts.blue = 0;  // 全部活车计数随重建归零
  teamRegularCounts.red = 0; teamRegularCounts.blue = 0; // 最大在场编制计数同步归零
  wreckList.length = 0;if(typeof wreckSmokeClear==='function')wreckSmokeClear();                      // 残骸表随场景隔离重建
  wckClear();                                // 残骸合批区网格随场景移除
  clearTargets();                            // 增量模式下移除车辆后需手动重建 targetsList
  hitGridStatic.clear(); hitGridStaticVersion++; // 清空静态遮挡并使所有 LOS 缓存立即失效
  hitGridDynamic.clear();                    // 清空活车动态命中网格(旧车残网格防幽灵;下方 rebuildTargets 全量重注册)
  if (typeof collGridReset === 'function') collGridReset();
  wreckGrid.clear();                         // 清空残骸空间网格(avoidSteer/resolveCollisions 共用)
  for (ri = 0; ri < tanks.length; ri++) {
    for (rj = 0; rj < tanks[ri].modMeshes.length; rj++)
      addTarget(tanks[ri].modMeshes[rj]);
    if (tanks[ri].alive) {
      aliveList.push(tanks[ri]); teamCounts[tanks[ri].team]++;
      if (!tanks[ri]._strategicSupport) teamRegularCounts[tanks[ri].team]++;
    }   // 重推活车 + 全部/编制计数重累加
  }
  rebuildTargets();
}
function buildMidgame(nAlive, nWreck) {
  nAlive = nAlive || 160; nWreck = nWreck || 250;
  clearAllAI();
  var MIX = ['tank', 'tank', 'tank', 'tank', 'tank', 'tank', 'tank', 'tank', 'td', 'td', 'arty'];
  var rnd = mulberry32(0x51DE221), i, t, liveN = 0, wreckN = 0;
  for (i = 0; i < nAlive; i++) {
    t = createTank({ kind: MIX[(i >> 1) % MIX.length], team: i % 2 ? 'red' : 'blue',
                     x: rnd() * 800 - 400, z: rnd() * 600 - 300, yaw: rnd() * 6.2832 });
    if (t) liveN++;
  }
  for (i = 0; i < nWreck; i++) {
    t = createTank({ kind: MIX[i % MIX.length], team: i % 2 ? 'red' : 'blue',
                     x: rnd() * 500 - 250, z: rnd() * 300 - 150, yaw: rnd() * 6.2832 });
    if (t) { killTank(t, 'BASELINE BUILD'); wreckN++; }
  }
  rebuildTargets();                          // 批量直建绕过 spawnTank 逐辆重注册,末尾一次全量入格
  respawnQueue.length = 0;                   // 构造残骸不入增援循环(冻结种群,兵力 200/200 不动)
  PERF_BASE.reset();
  return { alive: liveN, wreck: wreckN, pool: { red: teamPool.red, blue: teamPool.blue } };
}
/* ============================================================
   自动基线协议 —— index.html?autotest=midgame[&alive=160&wreck=250]
   无人工介入的基线采集管线(免控制台/免 evaluate):
     自动开始战斗(默认参数)→ 3s 部署 → 构造中期态势 → 60s 挂机稳定
     → 采样 PERF_BASE 7×2s 窗口 + fps 行读数 → 装甲 testShell 矩阵 + AI 审计
     → 结果 JSON 写入 #autotest-out(标题置 BASE_DONE,失败 BASE_FAIL)。
   采样期间 window.__TANK_DEBUG 关闭(逐帧 dbg 块/dcAudit 零开销);
   DBG_ON(加载期快照)由 index.html 引导脚本按 URL 置真 → testShell 记录
   与 shirk 累计全程有效。M1 复测必须用同参数 URL 跑同管线保证可比。
   ============================================================ */
(function () {
  if (typeof window === 'undefined' || !/[?&]autotest=midgame/.test(location.search)) return;
  function qn(k, d) {
    var mm = new RegExp('[?&]' + k + '=(\\d+)').exec(location.search);
    return mm ? parseInt(mm[1], 10) : d;
  }
  var out = document.createElement('pre');
  out.id = 'autotest-out';
  out.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:99;max-width:60vw;max-height:30vh;overflow:auto;' +
    'font:10px monospace;white-space:pre-wrap;background:rgba(0,0,0,.7);color:#8dfc9a;pointer-events:none';
  document.body.appendChild(out);
  function phase(s) { document.title = 'BASE_' + s; out.textContent = '[PHASE] ' + s; }
  function fail(e) { document.title = 'BASE_FAIL'; out.textContent = 'FAIL: ' + (e && (e.stack || e.message || e)); }
  try {
    phase('BOOT');
    startGame();
    if (typeof attemptLock === 'function') attemptLock();
    var B = window.__BASE = {
      meta: { ua: navigator.userAgent, dpr: devicePixelRatio || 1, vw: innerWidth, vh: innerHeight, t0: Date.now() },
      sum: null, perf: [], fps: [], armor: null, audit: null
    };
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl2') || c.getContext('webgl');
      var ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      B.meta.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl ? 'masked' : 'none');
    } catch (e2) { B.meta.gpu = 'err'; }
    setTimeout(function () {                          // 开局 3s:部署尘埃落定
      try {
        phase('BUILD');
        B.sum = buildMidgame(qn('alive', 160), qn('wreck', 250));
        window.__TANK_DEBUG = false;                  // 采样期关闭逐帧 dbg 块/dcAudit(DBG_ON 计数不受影响)
        setTimeout(function () {                      // 60s 挂机:战场稳定 + wckFlush 收敛
          try {
            phase('SAMPLE');
            var tick = setInterval(function () {
              try {
                if (B.perf.length >= 7) { clearInterval(tick); finish(); return; }
                var L = window.__PERF_BASE && window.__PERF_BASE.last;
                if (L) B.perf.push(JSON.parse(JSON.stringify(L)));
                var f = document.getElementById('sigfps') || document.getElementById('fps');   // Read FPS from the signal-group field.
                B.fps.push(f ? f.textContent : '');
              } catch (e3) { clearInterval(tick); fail(e3); }
            }, 2100);
          } catch (e4) { fail(e4); }
        }, 60000);
      } catch (e5) { fail(e5); }
    }, 3000);
    function finish() {
      try {
        phase('AUDIT');
        window.__TANK_DEBUG = true;                   // 唤醒 __DBG_HOOKS/__DBG 快照
        setTimeout(function () {
          try {
            var H = window.__DBG_HOOKS, D = window.__DBG;
            var cases = [                             // [kind, team, ox,oy,oz, dx,dy,dz, pen, flyD](v2:y0.9 落 hull 壳带,v1 y1.5 掠过首上斜面 3/5 空探针)
              ['tank', 'red', 0, 0.9, 8, 0, 0, -1, 446, 0],
              ['tank', 'red', 7, 0.9, 0, -1, 0, 0, 446, 500],
              ['tank', 'red', 0, 7, 0, 0, -1, 0, 446, 1000],
              ['td', 'blue', 0, 0.9, 8, 0, 0, -1, 514, 0],
              ['arty', 'red', 0, 1.5, 8, 0, 0, -1, 100, 0]
            ];
            B.armor = cases.map(function (cs) {
              var t = H.spawnTank(cs[0], cs[1], 0, 0);
              var rec = H.testShell(t, cs[2], cs[3], cs[4], cs[5], cs[6], cs[7], cs[8], cs[9]);
              H.kill(t);
              return rec && { kind: cs[0], case: cs[2] + ',' + cs[3] + ',' + cs[4], key: rec.key, face: rec.face, res: rec.res,
                              ang: +(rec.ang || 0).toFixed(2), armor: +(rec.armor || 0).toFixed(1),
                              eff: +(rec.eff || 0).toFixed(1) };
            });
            B.audit = D && { shirk: D.shirk, brawl: D.brawl, posture: D.posture, attn: D.attn,
                             evacNow: D.evacNow, flank: D.flank, teams: D.teams, modes: D.modes };
            window.__TANK_DEBUG = false;
            B.meta.tEnd = Date.now();
            B.meta.durS = +((B.meta.tEnd - B.meta.t0) / 1000).toFixed(1);
            out.textContent = JSON.stringify(B);
            document.title = 'BASE_DONE';
            console.log('[BASE] CAPTURE DONE');
          } catch (e6) { fail(e6); }
        }, 300);
      } catch (e7) { fail(e7); }
    }
  } catch (e8) { fail(e8); }
})();
/* ============================================================
   ★★★ TEMPORARY FLIGHT RECORDER (?helirec=1) — 2026-09-13 直升机顿挫调查专用,
   结论一出即删(删后全仓 grep helirec 必须零命中,含本文注释)。
   用法:index.html?gfx=low&helirec=1 → 自动开局(玩家红方武装直升机)→清场→满转速→爬升→W前飞15s
   → JSON 写入 #helirec-out,标题置 HELI_DONE。
   每 50ms 记录:[gameT, renderXYZ, simXYZ(_ipP), prevXYZ(_ipPv), alt, camXYZ, steps, droppedMs, spikes]
   ============================================================ */
(function () {
  if (typeof window === 'undefined' || !/[?&]helirec=1/.test(location.search)) return;
  var out = document.createElement('pre');
  out.id = 'helirec-out';
  out.style.cssText = 'position:fixed;left:4px;top:4px;z-index:99;max-width:90vw;max-height:90vh;overflow:auto;' +
    'font:10px monospace;white-space:pre-wrap;background:rgba(0,0,0,.8);color:#8dfc9a;';
  document.body.appendChild(out);
  function phase(s) { document.title = 'HELI_' + s; out.textContent = '[PHASE] ' + s; try { console.log('[HELIREC] ' + s); } catch (e9) {} }
  try {
    phase('BOOT');
    startKind = 'wz10'; startSide = 'red';   // 玩家开局即红方武装直升机(红方专属,与 sides 一致)
    startGame();
    window._dbgPerfOn = true;                  // 开启 __SIM 步数/alpha 探针
    window.__TANK_DEBUG = false;
    setTimeout(function () {
      try {
        if (typeof clearAllAI === 'function') clearAllAI();   // 单机洁净空域
        respawnQueue.length = 0;
        var prm = (typeof HELI_PARAMS !== 'undefined' && HELI_PARAMS.wz10) || {};
        if (typeof heliEngineStart === 'function') heliEngineStart(player);
        player._heliRotorRPM = prm.rotorOmega0 || 30;
        player._heliTailRotorRPM = (prm.rotorOmega0 || 30) * (prm.tailRatio || 0.2);
        player._heliGovRunT = (typeof HELI_GOV_RAMP_TIME !== 'undefined') ? HELI_GOV_RAMP_TIME : 30;
        player._heliStartPhaseT = 99;
        player._heliCollective = 1.0;
        keys.KeyW = true;                       // 前倾平飞
        var t0 = gameT, rec = [], evts = [], tW0 = Date.now();
        var y0 = player.yaw || 0, fx0 = Math.sin(y0), fz0 = Math.cos(y0);   // 起飞朝向前轴
        var lastF = null, lastS = null, lastC = null, lastT = gameT, backN = 0, worstBack = 0;
        try { console.log('[HELIREC] yaw0=' + y0.toFixed(2)); } catch (e9b) {}
        phase('FLY');
        var iv = setInterval(function () {
          try {
            if (!player || !player.alive || !player.group) { return; }
            var rp = player.group.position, sp = player._ipP, pv = player._ipPv, cp = camera.position;
            var fR = rp.x * fx0 + rp.z * fz0;                 // 渲染位置沿起飞前轴投影
            var fS = sp ? sp.x * fx0 + sp.z * fz0 : null;     // 模拟位置同口径
            var cM = Math.sqrt(cp.x * cp.x + cp.z * cp.z);
            if (lastF != null) {
              var dR = fR - lastF;                            // 本采样渲染位移(前+ / 退-)
              if (dR < -0.15) {                               // ★倒退事件:用户症状的机器定义
                backN++;
                if (dR < worstBack) worstBack = dR;
                var dS = (fS != null && lastS != null) ? fS - lastS : null;   // 模拟跟退否?
                var dC = (lastC != null) ? cM - lastC : null;                 // 相机跳否?
                evts.push([+gameT.toFixed(2), +dR.toFixed(2), dS == null ? null : +dS.toFixed(2),
                  dC == null ? null : +dC.toFixed(2),
                  player._heliAlt != null ? +player._heliAlt.toFixed(1) : null]);
                try { console.log('[HELIREC-EVT] t=' + gameT.toFixed(1) + ' back=' + dR.toFixed(2) +
                  ' simBack=' + (dS == null ? '?' : dS.toFixed(2)) + ' camD=' + (dC == null ? '?' : dC.toFixed(2)) +
                  ' alt=' + (player._heliAlt != null ? player._heliAlt.toFixed(1) : '?')); } catch (e9c) {}
              }
            }
            lastF = fR; lastS = fS; lastC = cM; lastT = gameT;
            if (rec.length < 400) {
              rec.push([+gameT.toFixed(3),
                +rp.x.toFixed(3), +rp.y.toFixed(3), +rp.z.toFixed(3),
                sp ? +sp.x.toFixed(3) : null, sp ? +sp.y.toFixed(3) : null, sp ? +sp.z.toFixed(3) : null,
                pv ? +pv.x.toFixed(3) : null, pv ? +pv.y.toFixed(3) : null, pv ? +pv.z.toFixed(3) : null,
                player._heliAlt != null ? +player._heliAlt.toFixed(2) : null,
                +cp.x.toFixed(2), +cp.y.toFixed(2), +cp.z.toFixed(2),
                window.__SIM ? window.__SIM.steps : null,
                window.__SIM ? window.__SIM.droppedMs : null,
                window.__SPIKE ? window.__SPIKE.n : 0]);
            }
            if (((gameT - t0) | 0) % 3 === 0 && gameT - t0 > 0.5 && (gameT * 10 | 0) % 30 === 0) {
              try { console.log('[HELIREC] t=' + gameT.toFixed(1) + ' kind=' + player.kind +
                ' eng=' + player._heliEngineState + ' phT=' + player._heliStartPhaseT +
                ' rpm=' + (player._heliRotorRPM || 0).toFixed(1) + ' coll=' + (player._heliCollective || 0).toFixed(2) +
                ' cap=' + (player._heliCollCap || 0).toFixed(2) + ' pwr=' + (player._heliPower || 0).toFixed(2) +
                ' gov=' + (player._heliGovRunT || 0).toFixed(0) +
                ' alt=' + (player._heliAlt != null ? player._heliAlt.toFixed(1) : '?') +
                ' vx=' + (player._heliVx || 0).toFixed(1) + ' vz=' + (player._heliVz || 0).toFixed(1) +
                ' f=' + fR.toFixed(1) + ' backN=' + backN); } catch (e9d) {}
            }
            if (gameT - t0 > 15 || Date.now() - tW0 > 45000) {
              clearInterval(iv);
              keys.KeyW = false;
              out.textContent = JSON.stringify({ backN: backN, worstBack: +worstBack.toFixed(2), evts: evts, rec: rec });
              document.title = 'HELI_DONE';
              try { console.log('[HELIREC] DONE backN=' + backN + ' worst=' + worstBack.toFixed(2)); } catch (e9e) {}
            }
          } catch (e2) { clearInterval(iv); phase('FAIL'); out.textContent = 'FAIL: ' + (e2 && e2.stack || e2); }
        }, 50);
      } catch (e) { phase('FAIL'); out.textContent = 'FAIL: ' + (e && e.stack || e); }
    }, 3000);
  } catch (e0) { phase('FAIL'); out.textContent = 'FAIL: ' + (e0 && e0.stack || e0); }
})();

