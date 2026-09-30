/* ===== Module: player.js ===== */
/* ============================================================
   模块: player.js — 玩家操控:驾驶/炮塔伺服/座车标记
   (加载顺序由 index.html MODULES 表决定,勿单独调整)
   ============================================================ */
'use strict';
/* ============================================================
   玩家操控
   ============================================================ */
/* 玩家瞄准俯仰边界:火箭炮第三人称开放完整发射架仰角(1.05rad);
   火箭炮炮镜为俯视火控视野,不再使用视角俯仰通道。 */
function playerAimPitchClamp(t, pitch) {
  if (isHeliVehicle(t)) {
    var wp = t._heliWeapon || 3;
    if (wp === 3) {
      // 武器3(导弹): 俯仰角无任何限制 (开放自由全向视界,全向360度不受限制)
      return clamp(pitch, -89.9 * Math.PI / 180, 89.9 * Math.PI / 180);
    } else if (wp === 2) {
      // 武器2(火箭弹): 前方左右45°,上0°,下60° (俯角60°)
      return clamp(pitch, -60 * Math.PI / 180, 0.0);
    } else {
      // 武器1(机炮): 俯角80°,仰角0°
      return clamp(pitch, -80 * Math.PI / 180, 0.0);
    }
  }
  if (isAAVehicle(t)) {
    // 防空载具射界(任务25 用户设定):RED_AA 机炮 -5°~+90°(可对天顶射击);蓝方防空车保持 -10°~+70°
    if (t.team === 'red') return clamp(pitch, -5 * Math.PI / 180, 90 * Math.PI / 180);
    return clamp(pitch, -0.1745, 1.2217);
  }
  var hi = t && t.kind === 'arty' ? 1.05 : 0.3;
  return clamp(pitch, -0.14, hi);
}

/* 将逻辑炮架角写入 Three 层级。火箭炮炮镜的 yaw 由 playerUpdate 世界反馈伺服直接积分,
   不能只改 turretYaw 数值而漏写 turret.rotation(两者需同帧同步写,否则镜头转了发射架实体不跟)。 */
function playerArtySyncMount(t, syncWorld) {
  if (!t) return;
  if (t.turret) t.turret.rotation.y = t.turretYaw || 0;
  if (t.gunPivot) t.gunPivot.rotation.x = -(t.gunPitch || 0);
  if (syncWorld) {
    if (t.turret && t.turret.updateWorldMatrix) t.turret.updateWorldMatrix(true, true); // 只刷炮塔子树,免重算整车 hull
    else if (t.group) t.group.updateMatrixWorld(true);
  }
}
/* 玩家齐射硬锁:首发前冻结发射架本地方位、俯仰和基础初速,直到最后一发离轨。
   视角可在第三人称自由观察,也可中途退出炮镜,但这些输入绝不能再改正在齐射的炮架。 */
function playerArtyApplySalvoLock(t, syncWorld) {
  if (!t || t.kind !== 'arty' || t.salvoLeft <= 0) return false;
  if (t._salvoLockYaw == null) t._salvoLockYaw = t.turretYaw || 0;
  if (t._salvoLockPitch == null) t._salvoLockPitch = t.gunPitch || 0;
  if (t._salvoLockV == null) t._salvoLockV = t.rocketV || artyConfOf(t).rocketSpeed;
  t.turretYaw = t._salvoLockYaw;
  t.gunPitch = t._salvoLockPitch;
  t.rocketV = t._salvoLockV;
  t.turretYawDelta = 0;
  playerArtySyncMount(t, syncWorld);
  return true;
}
function playerArtyStartSalvo(t) {
  if (!t || t.kind !== 'arty' || t.salvoLeft > 0) return false;
  t._salvoLockYaw = t.turretYaw || 0;
  t._salvoLockPitch = t.gunPitch || 0;
  t._salvoLockV = t.rocketV || artyConfOf(t).rocketSpeed;
  if (t._artyAim && isFinite(t._artyAim.x)) {
    t._salvoAimX = t._artyAim.x;
    t._salvoAimZ = t._artyAim.z;
  } else {
    var dR = t.artyRange || 300;
    var ppA = t.group.position;
    var bAz = t._salvoLockYaw + t.yaw;
    t._salvoAimX = ppA.x + Math.sin(bAz) * dR;
    t._salvoAimZ = ppA.z + Math.cos(bAz) * dR;
  }
  t.salvoLeft = artyConfOf(t).salvo;   // 红 RED_MLRS=40 发 / 蓝 BLUE_MLRS=6 发
  t.salvoT = 0.05;
  t._servoHoldT = 0;
  t._topFireWish = false; t._artyCreepFwd = 0;   // 射击任务已发起:解除点选与蠕行(覆盖环随齐射装定点)
  playerArtyApplySalvoLock(t, true);
  sfxFire(0.45, 0, true);
  return true;
}
function playerArtyEndSalvoLock(t) {
  if (!t) return;
  t._salvoLockYaw = null;
  t._salvoLockPitch = null;
  t._salvoLockV = null;
  t._salvoAimX = null;
  t._salvoAimZ = null;
  t.turretYawDelta = 0;
}
/* ===== 直升机载具级火控雷达系统 (FCR / 毫米波雷达 - 载具完全独立隔离) =====
   1. 视场几何:机身正前方固定 60° 圆锥视场 (半角 30°),与机体严格固联,不随相机视线变形;
   2. 航电时序互锁与自动开机:发动机点火耗时 3s,发动机运转后通电 15s 默认第一时间自动开机;
   3. 容量与自动补位:每架直升机独立追踪上限 8 个目标,同时锁定上限 4 个目标;超出上限不显示;目标离开/战损自动补位;
   4. 多目标火力分配:多目标锁定时自动均摊引导火力,避免重叠;就近原则防横跳;阵营与各机火力完全隔离;
   5. 探测范围与动态比例尺:最大 10KM 探测视距,根据最远目标自适应动态切换比例尺;
   6. 炮镜视角穿透:在炮镜/观瞄视角下雷达扫描框、多锁定框与 MFD 均持续稳定呈现。 */
var _vRadarNoseDir = new THREE.Vector3();                   // 机身正前方绝对矢量
var _vRadarAim = new THREE.Vector3();                       // 准星视线方向复用 scratch
/* 雷达候选池复用(零 GC):AI 直升机雷达常亮后本循环 8 架×50Hz 高频运行,
   原先每次 new candidatePool/untrackedCands 数组会周期性触发移动端 GC 卡顿——
   改为持久池 + 计数(_radarCandN)复用对象,untracked 用引用型 scratch(每次 length=0 复位)。 */
var _radarCandPool = [];      // 复用的候选对象数组 {tgt,dist,dotNose,dotCursor}
var _radarCandN = 0;          // 本帧有效候选数
var _radarUntracked = [];     // 未跟踪候选引用 scratch(引用 _radarCandPool 元素)
var _mfdSweepAngle = 0;                                     // MFD 扫描线往复摆动角
/* ============================================================
   直升机雷达索敌 · 调度层性能优化(方案 1/2/3,行为完全等价)
   —— 参照 Crytek TTPS / GameDev VisibilityManager / War Thunder 扫描线 / LOS 缓存论文:
      · 方案1 全局 LOS 射线预算 + 位移门控缓存(两端位移 <8m 则复用上次遮挡结论,不重投射线);
      · 方案2 消灭 updateHeliRadar/allocateGuidedFireTarget 每拍 new(数组 length=0 复用、
              map→整型标记戳、择优改线性扫描替代 sort,零 GC);
      · 方案3 AI 扫描线时间片(AI 每拍最多刷新 AI_LOS_SLICE 条航迹 LOS,轮转;玩家逐帧全刷)。
   锁定速度/丢失延迟/命中判定与原实现一致——仅改射线调度与内存分配。
   ============================================================ */
var HELI_LOS_BUDGET_PER_FRAME = 8;   // 全局每帧 LOS 射线预算(削 8 架同时进锥的瞬时尖峰;玩家优先不受限)
var _heliLosBudget = 0;              // 本帧剩余 LOS 预算(step 开头重置为上值)
var AI_LOS_SLICE = 2;               // AI 直升机每拍最多刷新的航迹 LOS 数(扫描线时间片,轮转覆盖全部航迹)
var HELI_LOS_DISP2 = 64.0;          // 位移门控阈值平方(8m):自机与目标两端位移均小于此则复用上次 LOS 结论
var _radarActiveStamp = 0;          // 阶段3/4 活动航迹标记戳(替代每拍 activeTrackMap{} 分配)
// updateHeliRadar 阶段 6/7 复用 scratch(每次 length=0 后 push,长度精确 → sort 安全)
var _rdValidDes = [];               // 有效已选定航迹
var _rdUndes = [];                  // 未选定候选航迹(按最快锁定排序)
var _rdAllLocked = [];             // 已完成锁定航迹(仲裁回退用)
var _rdLocking = [];               // 锁定进行中航迹(仲裁回退用)
// 玩家锁定事件配音去重(替代每拍 _curLocked{} + p._prevLockedKeys 对象分配,改整型戳 + 复用数组)
var _plrLockOwner = null;          // 上帧 prev 缓冲所属玩家载具引用(换车/接管→缓冲清零,与原 _prevLockedKeys={} 重置等价)
var _plrCurLocked = [];            // 复用:本帧玩家已锁定目标 tank 列表
var _plrPrevLocked = [];           // 复用:上帧玩家已锁定目标 tank 列表
var _plrPrevLockedN = 0;           // 上帧已锁定目标数
// allocateGuidedFireTarget 复用 scratch(该函数每帧多处高频调用,原每次 new lockedTracks[]/mslCounts[])
var _agLocked = [];                // 复用:自身已锁定航迹
var _agCounts = [];                // 复用对象池 {track,count,same}(按 _agLocked 长度取用,择优改线性扫描免 sort)

/* 检测直升机火控雷达是否通电完成就绪 (发动机工作后通电15秒) */
function isHeliRadarReady(t) {
  if (!t || !t.alive) return false;
  if (isAAVehicle(t)) return t.team === 'red' && (t._heliRadarWarmup != null && t._heliRadarWarmup >= HELI_RADAR_WARMUP_TIME);   // 任务23:RED_AA 雷达需启动(部署后通电预热 15s,时长=直升机雷达);蓝方防空车无车载雷达(搜索=导弹导引头自理)
  if (!isHeliVehicle(t)) return false;
  return t._heliEngineState === 'running' && (t._heliRadarWarmup != null && t._heliRadarWarmup >= HELI_RADAR_WARMUP_TIME);
}

/* 起动/预热剩余秒数 (四舍五入, 最低显示 1s) */
function heliRemainSec(cur, total) {
  return Math.max(1, Math.round(total - (cur || 0)));
}

/* 三维地形/山体障碍物距离探测 (综合垂直高度与周边山壁极小值) */
function calcTerrain3DProximity(x, y, z) {
  var groundH = terrainH(x, z);
  var vertD = Math.max(0, y - groundH);
  var minD = vertD;

  var ox1 = 45, oz1 = 45;
  var hx1 = terrainH(x + ox1, z), hx2 = terrainH(x - ox1, z);
  var hz1 = terrainH(x, z + oz1), hz2 = terrainH(x, z - oz1);

  var dHx1 = Math.max(0, hx1 - y), dHx2 = Math.max(0, hx2 - y);
  var dHz1 = Math.max(0, hz1 - y), dHz2 = Math.max(0, hz2 - y);

  minD = Math.min(minD, Math.sqrt(ox1 * ox1 + dHx1 * dHx1), Math.sqrt(ox1 * ox1 + dHx2 * dHx2),
                        Math.sqrt(oz1 * oz1 + dHz1 * dHz1), Math.sqrt(oz1 * oz1 + dHz2 * dHz2));
  return minD;
}

/* 动态雷达理论锁定时间解算 (基于雷达方程 R^4 衰减与地杂波信噪比模型, 标定至10KM) */
function calcRadarLockTime(dist, dTerrain) {
  var R = Math.max(0, dist);
  var r_norm = R / 6000.0;
  var baseDist = 0.08 + 0.92 * Math.pow(r_norm, 2.4);
  var surge = 0.0;
  if (R > 8000.0) {
    var over = (R - 8000.0) / 2000.0;
    surge = 5.0 * Math.pow(over, 3.0);
  }
  var tDist = baseDist + surge;

  var dT = Math.max(0.0, dTerrain);
  var fClutter = 1.0 + 3.5 * Math.exp(-dT / 25.0);

  return tDist * fClutter;
}

/* 地形视线遮挡检测 */
function isRadarLineOccludedByTerrain(fromX, fromY, fromZ, toX, toY, toZ, dist) {
  // 方案4:地形最大高度包络粗筛。射线 Y 沿段线性 → 段内最低点必在两端点之一;
  // 若较低端点仍高于沿途包络上界(含安全余量与 0.2 贴地阈值),则全段必无地形遮挡,免 60 次精采样。
  if (typeof teVLat !== 'undefined' && teVLat) {
    var loY = fromY < toY ? fromY : toY;
    if (loY > terrainEnvelopeMaxAlong(fromX, fromZ, toX, toZ) + TERR_ENV_MARGIN + 0.2) return false;
  }
  var steps = Math.min(60, Math.max(6, Math.floor(dist / 40.0)));
  var dx = (toX - fromX) / steps;
  var dy = (toY - fromY) / steps;
  var dz = (toZ - fromZ) / steps;

  var curX = fromX + dx;
  var curY = fromY + dy;
  var curZ = fromZ + dz;

  // i < steps (原 i < steps-1 会跳过末段两采样点 —— 恰好漏检目标近旁的遮蔽山脊, 放行注定撞山的发射;
  // 末点 i=steps 即目标本身, 仍排除不检)
  for (var i = 1; i < steps; i++) {
    var gh = terrainH(curX, curZ);
    if (curY < gh + 0.2) return true;
    curX += dx;
    curY += dy;
    curZ += dz;
  }
  return false;
}

/* 玩家右键手动选定目标/取消锁定交互处理 (上限最多同时锁定4个目标,严格隔离每架直升机自身航迹与火力) */
/* —— 目标指定状态机的两段共用实现(桌面右键 / 安卓触屏点击共用)——
   两条入口的命中测试规则不同(右键=屏幕中心 36px;触屏=触点 34px 且取最近),
   但"取消锁定"与"新增锁定"的下游语义必须逐字一致,故在此收口为单一真源。 */

/* 取消一条已指定航迹:清锁 → 进手动待机 → 把本机在飞的制导弹改投新目标。
   弹体自述弹型各守本域(导弹→对空规格,制导火箭→对地规格);
   <450m 的弹已进末制导,改投大概率脱靶,故一律不动。 */
function _heliCancelDesignation(p, trk, announce) {
  var cancelledTank = trk.tank;
  trk.isDesignated = false;
  trk.isLocked = false;
  trk.lockEnergy = 0.0;
  p._heliRadarManualInhibit = true;
  if (typeof shells !== 'undefined' && shells && typeof allocateGuidedFireTarget === 'function') {
    for (var si = 0; si < shells.length; si++) {
      var sh = shells[si];
      var shGuided = sh && (sh.isHeliMissile || (sh.isHeliRocket && sh.guided));
      if (!shGuided || sh.owner !== p || sh.life <= 0) continue;
      if (sh.target !== cancelledTank &&
          !(cancelledTank && cancelledTank.id && sh.target && sh.target.id === cancelledTank.id)) continue;
      var dCur = sh.target && sh.target.group ? sh.pos.distanceTo(sh.target.group.position) : Infinity;
      if (dCur < 450.0) continue;
      var nextTgt = allocateGuidedFireTarget(p, heliGuidedSpecOf(sh));   // 弹体自述弹型(与母机派生等价)
      if (nextTgt) sh.target = nextTgt;
    }
  }
  // 下发攻击目标仲裁按本机导弹弹型(对空)口径,与发射时同源
  p._heliMissileTarget = (typeof allocateGuidedFireTarget === 'function')
    ? allocateGuidedFireTarget(p, HELI_MSL_SPEC[heliMslTypeOf(p)]) : null;
  if (announce && typeof aimHint === 'function')
    aimHint('LOCK CANCELLED: ' + (cancelledTank ? cancelledTank.name : '') + ' [FIRE REDISTRIBUTED]');
}

/* 新增一条指定航迹:达 4 锁上限时 FIFO 顶掉最早指定的那条。 */
function _heliAddDesignation(p, trk, tracks, announce) {
  var designatedList = [];
  for (var k = 0; k < tracks.length; k++) {
    if (tracks[k].isDesignated && tracks[k].tank && tracks[k].tank.alive) designatedList.push(tracks[k]);
  }
  if (designatedList.length >= HELI_RADAR_MAX_LOCKS) {
    designatedList.sort(function (a, b) { return (a.designatedSeq || 0) - (b.designatedSeq || 0); });
    var oldest = designatedList[0];
    oldest.isDesignated = false;
    oldest.isLocked = false;
    oldest.lockEnergy = 0.0;
  }
  p._heliRadarManualInhibit = false;
  p._heliRadarDesignateSeq = (p._heliRadarDesignateSeq || 0) + 1;
  trk.isDesignated = true;
  trk.designatedSeq = p._heliRadarDesignateSeq;
  trk.lockEnergy = 0.0;
  trk.isLocked = false;
  if (announce && typeof aimHint === 'function') aimHint('DESIGNATED: ' + trk.tank.name + ' [LOCKING]');
}

function heliRadarRightClickDesignate(p) {
  if (!p || !p.alive || !p._heliRadarActive || !p._heliRadarTracks || p._heliRadarTracks.length === 0) return;
  var tracks = p._heliRadarTracks;
  var cx = innerWidth * 0.5, cy = innerHeight * 0.5;

  // 1. 检查光标是否悬停在已锁定/选定框内 (取消该目标锁定 -> 重新分配本直升机在飞火力并进入手动待机模式)
  for (var i = 0; i < tracks.length; i++) {
    var trk = tracks[i];
    if (trk.isDesignated && trk.screenX != null && trk.screenY != null) {
      var dX = trk.screenX - cx;
      var dY = trk.screenY - cy;
      var distSq = dX * dX + dY * dY;
      if (distSq <= 1296) { _heliCancelDesignation(p, trk, p.isPlayer); return; }   // 命中半径 36px
    }
  }

  // 2. 光标未在已有锁定框内:手动选定最靠近光标的目标
  var unselectedTracks = [];
  for (var j = 0; j < tracks.length; j++) {
    var trk2 = tracks[j];
    if (!trk2.isDesignated && trk2.inCone && trk2.tank && trk2.tank.alive) {
      unselectedTracks.push(trk2);
    }
  }

  if (unselectedTracks.length === 0) return;

  unselectedTracks.sort(function(a, b) {
    return (b.dotWithCursor || -999) - (a.dotWithCursor || -999);
  });

  _heliAddDesignation(p, unselectedTracks[0], tracks, p.isPlayer);
}

function startHeliRadarScan(p) {
  if (!p || !p.alive || !(isHeliVehicle(p) || (typeof isAAVehicle === 'function' && isAAVehicle(p) && p.team === 'red'))) return;   // 任务23:RED_AA 车载雷达与直升机同套扫描状态机
  if (!isHeliRadarReady(p)) return;
  p._heliRadarActive = true;
  if (!p._heliRadarTracks) p._heliRadarTracks = [];
  p._heliRadarTracks.length = 0;
  p._heliRadarDesignateSeq = 0;
  p._heliMissileTarget = null;
  p._prevLockedKeys = {};
  p._heliRadarManualInhibit = false;

  if (p.isPlayer && typeof sfxRadarScanStart === 'function') sfxRadarScanStart();
}

function stopHeliRadarScan(p) {
  if (!p) return;
  p._heliRadarActive = false;
  if (p._heliRadarTracks) p._heliRadarTracks.length = 0;
  p._heliRadarDesignateSeq = 0;
  p._heliMissileTarget = null;
  p._prevLockedKeys = {};
  p._heliRadarManualInhibit = false;
  if (p.isPlayer && typeof sfxRadarScanStop === 'function') sfxRadarScanStop();
}

/* 直升机雷达更新循环 (每架直升机独立维护其私有雷达状态) */
/* ===== 雷达视线遮挡测量——单一真源 (穿地形根治, 2026-09-11) =====
   历史根因: _occ 结论只存在于航迹对象的缓存字段上, 且刷新被五重门串联节流
   (mslAny 弹药态 → 0.066s 节流 → 8m 位移门 → 玩家/AI 授权 → 全局预算);
   新建航迹又恒以 _occ:false 起步(fail-open), 被遮蔽航迹每 1.5s 删除→重建一次,
   每个重建窗口都是"无遮挡"默认值 → 任何一环改名/换语义(如多联装重构把弹药计数
   从 _heliMissileLeft 挪走)或 AI 时间片没排到, 地形穿透就复发。
   修复: ①创建航迹前先实测 LOS, 被遮蔽目标根本不建航迹(消灭 fail-open 窗口);
        ②维护期测量与弹药态解耦(MFD 显示/锁定晋升/数据链都消费 _occ, 正确性优先);
        ③测量原点=雷达天线位置(_radarEyeH: 直升机 1.2m / RED_AA 桅顶 4.12m);
        ④同文件函数直连调用, 不再 typeof 静默降级。 ===== */
function radarOccMeasure(p, cand, tPos2) {
  var pPos = p.group.position;
  var eyeH = (p._radarEyeH != null) ? p._radarEyeH : 1.2;
  var occ = false;
  var hits = worldRaycast(pPos.x, pPos.y + eyeH, pPos.z, tPos2.x, tPos2.y + 1.2, tPos2.z, true);
  if (hits && hits.length > 0 && pPos.distanceTo(hits[0].point) < cand.dist - 2.0) occ = true;
  if (!occ) occ = isRadarLineOccludedByTerrain(pPos.x, pPos.y + eyeH, pPos.z, tPos2.x, tPos2.y + 1.2, tPos2.z, cand.dist);
  return occ;
}

function updateHeliRadar(p, dt) {
  if (!p || !p.alive || (!isHeliVehicle(p) && !isAAVehicle(p)) || !p._heliRadarActive || !isHeliRadarReady(p) || typeof camera === 'undefined' || !camera) {
    if (p && p.isPlayer && typeof sfxRadarScanStop === 'function') sfxRadarScanStop();
    if (p && p._heliRadarTracks && p._heliRadarTracks.length) p._heliRadarTracks.length = 0;
    if (p) {
      p._heliRadarDesignateSeq = 0;
      p._heliMissileTarget = null;
    }
    return;
  }

  if (!p._heliRadarTracks) p._heliRadarTracks = [];
  var tracks = p._heliRadarTracks;

  var pPos = p.group.position;
  var roster = hostileRosterOf(p);

  // 1. 机身正前方固定圆锥视场 (严密固联机身坐标系,不随相机与准星移动变形)
  //    RED_AA:锥轴=炮塔朝向(玩家用光标瞄准控制搜索方向,无需转车体);蓝方防空车无雷达不进本函数
  if (isAAVehicle(p)) {
    _vRadarNoseDir.set(0, 0, 1);
    if (p.turret) _vRadarNoseDir.applyQuaternion(p.turret.getWorldQuaternion(new THREE.Quaternion()));
    else _vRadarNoseDir.applyQuaternion(p.group.quaternion);
    _vRadarNoseDir.normalize();
  } else {
    _vRadarNoseDir.set(0, 0, 1).applyQuaternion(p.group.quaternion).normalize();
  }

  var newlyLocked = false;
  var curAimDir = _vRadarAim;
  if (p.isPlayer) {
    camera.getWorldDirection(curAimDir);
    if (isAAVehicle(p)) _vRadarNoseDir.copy(curAimDir);   // 玩家防空:搜索锥轴=光标瞄准方向(用户设定:移动光标而非车体)
  } else {
    curAimDir.copy(_vRadarNoseDir);
  }

  // 2. 收集视场内所有符合条件的敌方目标 (10KM 探测极限) —— 复用 _radarCandPool 零分配
  _radarCandN = 0;
  for (var i = 0; i < roster.length; i++) {
    var tgt = roster[i];
    if (!tgt || !tgt.alive || !tgt.group || !areHostile(p, tgt)) continue;
    var tPos = tgt.group.position;

    var pdx = tPos.x - pPos.x, pdy = (tPos.y + 1.2) - (pPos.y + 1.2), pdz = tPos.z - pPos.z;
    var distSq = pdx * pdx + pdy * pdy + pdz * pdz;
    if (distSq > 100000000 || distSq < 16) continue;
    var dist = Math.sqrt(distSq);

    var dirX = pdx / dist, dirY = pdy / dist, dirZ = pdz / dist;
    var dotNose = dirX * _vRadarNoseDir.x + dirY * _vRadarNoseDir.y + dirZ * _vRadarNoseDir.z;

    // 60° 圆锥视场 (半角 30° -> cos(30°) ≈ 0.8660254)
    if (dotNose >= 0.8660254) {
      var _slot = _radarCandPool[_radarCandN];
      if (!_slot) { _slot = { tgt: null, dist: 0, dotNose: 0, dotCursor: 0 }; _radarCandPool[_radarCandN] = _slot; }
      _slot.tgt = tgt;
      _slot.dist = dist;
      _slot.dotNose = dotNose;
      _slot.dotCursor = dirX * curAimDir.x + dirY * curAimDir.y + dirZ * curAimDir.z;
      _radarCandN++;
    }
  }

  // 3. 维护与更新现有航迹 (最多保持 8 个追踪航迹)
  _radarActiveStamp++;                         // 本拍活动航迹标记戳(替代 activeTrackMap{} 分配,方案2)
  // 制导弹药可用性: 导弹 或 制导火箭(70mm火箭弹) 任一有弹即需要锁定质量。
  // ★不能只看导弹: 70mm火箭弹 也靠雷达锁定做火力分配, 只带火箭时若降级为纯跟踪,
  //   航迹永远晋升不到 isLocked → allocateGuidedFireTarget 拿不到锁定航迹 → 火箭不分配火力。
  var _rktGuided = (HELI_RKT_SPEC[p.kind] || {}).guidance === 'datalink';
  var mslAny = (p._heliMissileLeft || 0) > 0 || (_rktGuided && (p._heliRocketLeft == null || p._heliRocketLeft > 0));
  // 方案3 扫描线时间片(仅 AI):本拍最多授予 AI_LOS_SLICE 次实测 LOS,以 p._losCursor 轮转覆盖全部航迹。
  // 方案1 全局预算:实测 LOS 消耗 _heliLosBudget,耗尽则本条留用缓存(玩家优先,不受时间片/预算阻塞)。
  var _aiGranted = 0, _aiLastG = -1;
  var _aiCursor = p.isPlayer ? 0 : (p._losCursor || 0);
  for (var ti = 0; ti < tracks.length; ti++) {
    var trk = tracks[ti];
    if (!trk.tank || !trk.tank.alive || !trk.tank.group) continue;
    var cand = null;
    for (var ci = 0; ci < _radarCandN; ci++) {
      if (_radarCandPool[ci].tgt === trk.tank) { cand = _radarCandPool[ci]; break; }
    }

    if (cand) {
      trk.dist = cand.dist;
      trk.dotWithCone = cand.dotNose;
      trk.dotWithCursor = cand.dotCursor;

      // 视线遮挡检测 (与弹药态解耦: _occ 同时是 MFD 显示/锁定晋升/数据链的正确性依据)
      {
        var tPos2 = trk.tank.group.position;
        var throttleOK = gameT - (trk._occT || -99) > 0.066;
        // 方案1 位移门控:相对上次实测 LOS,自机与目标两端位移都 < 8m(HELI_LOS_DISP2=64)则几何等价 → 复用缓存
        var everMeasured = (trk._losSX != null);
        var _needRefresh = throttleOK;
        if (_needRefresh && everMeasured) {
          var _dsx = pPos.x - trk._losSX, _dsy = pPos.y - trk._losSY, _dsz = pPos.z - trk._losSZ;
          var _dtx = tPos2.x - trk._losTX, _dty = tPos2.y - trk._losTY, _dtz = tPos2.z - trk._losTZ;
          if ((_dsx * _dsx + _dsy * _dsy + _dsz * _dsz) < HELI_LOS_DISP2 &&
              (_dtx * _dtx + _dty * _dty + _dtz * _dtz) < HELI_LOS_DISP2) _needRefresh = false;
        }
        if (_needRefresh) {
          // 授权判定:玩家逐帧全刷(手感优先);AI 受时间片(轮转窗)+全局预算约束,否则本条留用缓存
          var _allow;
          if (p.isPlayer) {
            _allow = true;
          } else {
            _allow = (ti >= _aiCursor) && (_aiGranted < AI_LOS_SLICE) && (_heliLosBudget > 0);
          }
          if (_allow) {
            trk._occT = gameT;
            trk._losSX = pPos.x; trk._losSY = pPos.y; trk._losSZ = pPos.z;   // 记录本次实测两端位置(位移门控基准)
            trk._losTX = tPos2.x; trk._losTY = tPos2.y; trk._losTZ = tPos2.z;
            _heliLosBudget--;                                                 // 计入全局预算(玩家亦计,自然让出余量给 AI)
            if (!p.isPlayer) { _aiGranted++; _aiLastG = ti; }
            trk._occ = radarOccMeasure(p, cand, tPos2);   // 单一真源(创建/维护同一实现)
            if (!trk._occ) {
              var dTerr = calcTerrain3DProximity(tPos2.x, tPos2.y, tPos2.z);
              trk.tLockRequired = calcRadarLockTime(cand.dist, dTerr);
            }
          }
        }
      }

      if (!trk._occ) {
        trk.inCone = true;
        trk.lostTime = 0.0;
        trk._activeStamp = _radarActiveStamp;
      }
    }
  }
  // 方案3:推进 AI 轮转游标(下一拍从本拍最后授权之后继续;授权不足或到表尾则回绕到 0,保证全覆盖)
  if (!p.isPlayer) {
    if (_aiGranted > 0) p._losCursor = _aiLastG + 1;
    if ((p._losCursor || 0) >= tracks.length || _aiGranted < AI_LOS_SLICE) p._losCursor = 0;
  }

  // 4. 清理离开视锥/被遮蔽/战损的航迹
  for (var k = tracks.length - 1; k >= 0; k--) {
    var tr = tracks[k];
    if (!tr.tank || !tr.tank.alive || !tr.tank.group) {
      tracks.splice(k, 1);
      continue;
    }
    if (tr._activeStamp !== _radarActiveStamp) {
      tr.inCone = false;
      tr.lostTime = (tr.lostTime || 0) + dt;
      tr.lockEnergy = Math.max(0.0, tr.lockEnergy - (dt / 1.5));
      if (tr.lockEnergy < 1.0) tr.isLocked = false;
      if (tr.lockEnergy <= 0.0 && tr.lostTime > 1.5) {
        tracks.splice(k, 1);
      }
    }
  }

  // 5. 自动补位新目标到 8 个追踪航迹容量 (HELI_RADAR_MAX_TRACKS = 8)
  if (tracks.length < HELI_RADAR_MAX_TRACKS && _radarCandN > 0) {
    _radarUntracked.length = 0;
    for (var cj = 0; cj < _radarCandN; cj++) {
      var cp = _radarCandPool[cj];
      var already = false;
      for (var tk = 0; tk < tracks.length; tk++) {
        if (tracks[tk].tank === cp.tgt) { already = true; break; }
      }
      if (!already) _radarUntracked.push(cp);
    }

    if (_radarUntracked.length > 0) {
      // 优先补位准星偏角小、距离近的目标
      _radarUntracked.sort(function(a, b) {
        return (b.dotCursor * 2.0 - a.dist / 5000.0) - (a.dotCursor * 2.0 - b.dist / 5000.0);
      });

      var slotsFree = HELI_RADAR_MAX_TRACKS - tracks.length;
      var toAdd = Math.min(slotsFree, _radarUntracked.length);
      for (var ai = 0; ai < toAdd; ai++) {
        var addCand = _radarUntracked[ai];
        /* Measure LOS before creating a track; an occluded target never enters the radar list. */
        if (radarOccMeasure(p, addCand, addCand.tgt.group.position)) continue;
        var dTerr2 = calcTerrain3DProximity(addCand.tgt.group.position.x, addCand.tgt.group.position.y, addCand.tgt.group.position.z);
        tracks.push({
          tank: addCand.tgt,
          dist: addCand.dist,
          dTerrain: dTerr2,
          dotWithCone: addCand.dotNose,
          dotWithCursor: addCand.dotCursor,
          tLockRequired: calcRadarLockTime(addCand.dist, dTerr2),
          lockEnergy: 0.0,
          isDesignated: false,
          designatedSeq: 0,
          isLocked: false,
          inCone: true,
          lostTime: 0.0,
          _occT: gameT,
          _occ: false,
          screenX: null,
          screenY: null,
          screenScale: 1
        });
      }
    }
  }

  // 6. 自动补位锁定目标至 4 个锁定上限 (HELI_RADAR_MAX_LOCKS = 4) (无导弹时跳过晋升)
  _rdValidDes.length = 0;                       // 复用 scratch(方案2:替代 validDesignated=[])
  for (var di = 0; di < tracks.length; di++) {
    var dTrk = tracks[di];
    if (dTrk.isDesignated && dTrk.inCone && !dTrk._occ && dTrk.tank && dTrk.tank.alive) {
      _rdValidDes.push(dTrk);
    }
  }

  if (mslAny && !p._heliRadarManualInhibit && _rdValidDes.length < HELI_RADAR_MAX_LOCKS && tracks.length > 0) {
    _rdUndes.length = 0;                        // 复用 scratch(方案2:替代 undesignatedTracks=[])
    for (var ui = 0; ui < tracks.length; ui++) {
      var uTrk = tracks[ui];
      if (!uTrk.isDesignated && uTrk.inCone && !uTrk._occ && uTrk.tank && uTrk.tank.alive) {
        _rdUndes.push(uTrk);
      }
    }

    if (_rdUndes.length > 0) {
      // 优先选定能够最快完成锁定的目标
      _rdUndes.sort(function(a, b) {
        return (a.tLockRequired || 999) - (b.tLockRequired || 999);
      });

      var needed = HELI_RADAR_MAX_LOCKS - _rdValidDes.length;
      var promoteCount = Math.min(needed, _rdUndes.length);
      for (var pi = 0; pi < promoteCount; pi++) {
        var autoTgt = _rdUndes[pi];
        p._heliRadarDesignateSeq = (p._heliRadarDesignateSeq || 0) + 1;
        autoTgt.isDesignated = true;
        autoTgt.designatedSeq = p._heliRadarDesignateSeq;
        autoTgt.lockEnergy = 0.0;
        autoTgt.isLocked = false;
      }
    }
  }

  // 7. 积分锁定能量 (同时锁定上限 4 个)
  _rdAllLocked.length = 0;                      // 复用 scratch(方案2)
  _rdLocking.length = 0;
  for (var li = 0; li < tracks.length; li++) {
    var trkL = tracks[li];
    if (trkL.isDesignated && trkL.inCone && !trkL._occ && trkL.tank && trkL.tank.alive) {
      var tReq = trkL.tLockRequired || 1.0;
      var prevLocked = trkL.isLocked;
      trkL.lockEnergy = Math.min(1.0, trkL.lockEnergy + (dt / Math.max(0.05, tReq)));
      trkL.isLocked = (trkL.lockEnergy >= 1.0);
      if (!prevLocked && trkL.isLocked) {
        newlyLocked = true;
      }
      if (trkL.isLocked) _rdAllLocked.push(trkL);
      else _rdLocking.push(trkL);
    } else if (!trkL.isDesignated) {
      trkL.lockEnergy = 0.0;
      trkL.isLocked = false;
    }
  }

  // 8. 多目标火力分配与下发攻击目标仲裁 (载具独立隔离)
  //    _heliMissileTarget 是"导弹"下发目标, 故按本机导弹弹型(对空)规格分配;
  //    制导火箭(对地)不读此字段, 它在 fireHeliRocket/heliGuidedAcquireTarget 里按火箭规格独立分配。
  p._heliMissileTarget = (typeof allocateGuidedFireTarget === 'function') ? allocateGuidedFireTarget(p, HELI_MSL_SPEC[heliMslTypeOf(p)]) : (_rdAllLocked.length > 0 ? _rdAllLocked[0].tank : (_rdLocking.length > 0 ? _rdLocking[0].tank : null));

  // 9. 事件配音与锁定音效 (仅对玩家直升机) —— 方案2:整型比对 + 复用数组代替 _curLocked{}/_prevLockedKeys{}
  if (p.isPlayer) {
    if (_plrLockOwner !== p) { _plrPrevLockedN = 0; _plrPrevLocked.length = 0; _plrLockOwner = p; }  // 换车/接管:清上帧缓冲(等价旧 _prevLockedKeys={})
    _plrCurLocked.length = 0;                   // 复用:收集本帧已锁定目标 tank 引用
    for (var lki = 0; lki < tracks.length; lki++) {
      var ltr = tracks[lki];
      if (ltr.isLocked && ltr.tank && ltr.tank.alive) _plrCurLocked.push(ltr.tank);
    }
    if (typeof sfxEventVoice === 'function') {
      // 新锁定(cur 有 prev 无)→ lock_acq;丢失锁定(prev 有 cur 无)→ sig_lost。O(cur×prev),规模≤4×4。
      for (var ci9 = 0; ci9 < _plrCurLocked.length; ci9++) {
        var ct = _plrCurLocked[ci9], seen = false;
        for (var pj9 = 0; pj9 < _plrPrevLockedN; pj9++) { if (_plrPrevLocked[pj9] === ct) { seen = true; break; } }
        if (!seen) sfxEventVoice('lock_acq');
      }
      for (var pi9 = 0; pi9 < _plrPrevLockedN; pi9++) {
        var pt9 = _plrPrevLocked[pi9], still = false;
        for (var cj9 = 0; cj9 < _plrCurLocked.length; cj9++) { if (_plrCurLocked[cj9] === pt9) { still = true; break; } }
        if (!still) sfxEventVoice('sig_lost');
      }
    }
    // 交换缓冲(零 GC):本帧 cur → 下帧 prev
    var _swap9 = _plrPrevLocked; _plrPrevLocked = _plrCurLocked; _plrCurLocked = _swap9;
    _plrPrevLockedN = _plrPrevLocked.length;

    if (newlyLocked && typeof sfxRadarLockAcquired === 'function') {
      sfxRadarLockAcquired();
    }
  }
}

/* 画面右侧方形战术雷达 MFD (FCR) 渲染器 (炮镜视角稳定穿透显示 - 读取自机私有雷达数据) */
function renderHeliRadarMFD(p) {
  var mfdCvs = document.getElementById('mfd-radar-cvs');
  var mfdEl = document.getElementById('heliradarmfd');
  if (!mfdCvs || !mfdEl) return;

  /* 触控自定义布局编辑中:MFD 的显隐与几何由 flow.js 的编辑器全权接管
     (编辑器会让它在非直升机、甚至不在对局中时也显示出来,以便调整位置/大小)。
     同时把 _on 缓存作废,这样退出编辑后的第一帧必定重新同步 class,
     不会因为"缓存值恰好等于目标值"而漏掉一次 hidden 切换、导致 MFD 残留。 */
  if (window._touchLayoutEditing) { mfdEl._on = null; return; }

  var isHeli = p && p.alive && (isHeliVehicle(p) || (isAAVehicle(p) && p.team === 'red')) && gameState === 'playing';   // RED_AA 车载搜索雷达 MFD 与直升机火控雷达同套呈现(蓝方防空车无雷达)
  if (!isHeli) {
    if (mfdEl._on !== false) { mfdEl._on = false; mfdEl.classList.add('hidden'); }
    return;
  }
  if (mfdEl._on !== true) { mfdEl._on = true; mfdEl.classList.remove('hidden'); }

  var ctx = mfdCvs.getContext('2d');
  var w = mfdCvs.width, h = mfdCvs.height;
  ctx.clearRect(0, 0, w, h);

  var statusLbl = document.getElementById('mfd-status-lbl');
  var rngLbl = document.getElementById('mfd-rng-lbl');
  var tgtLine = document.getElementById('mfd-tgt-text');
  var teleLine = document.getElementById('mfd-tele-text');

  var isCutoff = p._heliEngineState === 'cutoff';
  var isStarting = p._heliEngineState === 'starting';
  var isWarming = (p._heliEngineState === 'running' || (typeof isAAVehicle === 'function' && isAAVehicle(p) && p.team === 'red' && !p._heliRadarActive)) && ((p._heliRadarWarmup || 0) < HELI_RADAR_WARMUP_TIME);   // 任务23:PGZ 雷达启动期同显预热倒计时

  var cx = w * 0.5;
  var cy = h - 20;
  var maxR = 135;

  ctx.save();
  ctx.fillStyle = '#06100a';
  ctx.fillRect(0, 0, w, h);

  var angL = -Math.PI * 0.5 - Math.PI / 6;
  var angR = -Math.PI * 0.5 + Math.PI / 6;

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, maxR, angL, angR);
  ctx.closePath();
  ctx.fillStyle = p._heliRadarActive ? 'rgba(46, 204, 113, 0.08)' : 'rgba(30, 40, 35, 0.3)';
  ctx.fill();
  ctx.strokeStyle = p._heliRadarActive ? 'rgba(46, 204, 113, 0.45)' : 'rgba(100, 110, 105, 0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.strokeStyle = p._heliRadarActive ? 'rgba(46, 204, 113, 0.22)' : 'rgba(80, 90, 85, 0.18)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  [0.333, 0.666, 1.0].forEach(function(rFrac) {
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * rFrac, angL, angR);
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx, cy - maxR);
  ctx.stroke();
  ctx.setLineDash([]);

  // 自机位置图标
  ctx.fillStyle = '#2ecc71';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx - 5, cy + 4);
  ctx.lineTo(cx, cy + 1);
  ctx.lineTo(cx + 5, cy + 4);
  ctx.closePath();
  ctx.fill();

  if (isCutoff) {
    if (statusLbl) { statusLbl.textContent = 'FCR: OFF [POWER OFF]'; statusLbl.style.color = '#7f8c8d'; }
    if (rngLbl) rngLbl.textContent = '10km';
    if (tgtLine) tgtLine.textContent = 'RADAR POWER OFF';
    if (teleLine) teleLine.textContent = 'ENGINE SHUTDOWN (POWER OFF)';

    ctx.fillStyle = 'rgba(127, 140, 141, 0.6)';
    ctx.font = 'bold 12px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('POWER OFF', cx, cy - 65);
    ctx.restore();
    return;
  }

  if (isStarting) {
    var remainStart = heliRemainSec(p._heliStartPhaseT, HELI_ENGINE_START_TIME);
    if (statusLbl) { statusLbl.textContent = 'FCR: OFF [STARTING]'; statusLbl.style.color = '#e67e22'; }
    if (rngLbl) rngLbl.textContent = '10km';
    if (tgtLine) tgtLine.textContent = 'ENGINE STARTING (' + remainStart + 's)';
    if (teleLine) teleLine.textContent = 'POWER OFF';

    ctx.fillStyle = '#e67e22';
    ctx.font = 'bold 11px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('STARTING ' + remainStart + 's', cx, cy - 65);
    ctx.restore();
    return;
  }

  if (isWarming) {
    var remainWarm = heliRemainSec(p._heliRadarWarmup, HELI_RADAR_WARMUP_TIME);
    if (statusLbl) { statusLbl.textContent = 'FCR: WARMING UP'; statusLbl.style.color = '#f1c40f'; }
    if (rngLbl) rngLbl.textContent = '10km';
    if (tgtLine) tgtLine.textContent = 'RADAR WARMING UP (' + remainWarm + 's)';
    if (teleLine) teleLine.textContent = 'POWERING UP';

    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 11px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('WARMUP ' + remainWarm + 's', cx, cy - 65);
    ctx.restore();
    return;
  }

  if (!p._heliRadarActive) {
    if (statusLbl) { statusLbl.textContent = 'FCR: POWERING'; statusLbl.style.color = '#95a5a6'; }
    if (rngLbl) rngLbl.textContent = '10km';
    if (tgtLine) tgtLine.textContent = 'TGT: SELF-TEST...';
    if (teleLine) teleLine.textContent = 'RADAR PWR: NOMINAL [AUTO-START]';

    ctx.fillStyle = 'rgba(149, 165, 166, 0.7)';
    ctx.font = 'bold 12px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ACTIVATING…', cx, cy - 65);
    ctx.restore();
    return;
  }

  _mfdSweepAngle += 0.045;
  var sweepDeg = Math.sin(_mfdSweepAngle) * (Math.PI / 6);
  var sweepAngAbs = -Math.PI * 0.5 + sweepDeg;

  ctx.strokeStyle = 'rgba(46, 204, 113, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(sweepAngAbs) * maxR, cy + Math.sin(sweepAngAbs) * maxR);
  ctx.stroke();

  var grad = ctx.createRadialGradient(cx, cy, 5, cx, cy, maxR);
  grad.addColorStop(0, 'rgba(46, 204, 113, 0.25)');
  grad.addColorStop(1, 'rgba(46, 204, 113, 0.0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, maxR, sweepAngAbs - 0.15, sweepAngAbs);
  ctx.closePath();
  ctx.fill();

  var pPos = p.group.position;
  var fwd = _vComp;
  p.group.getWorldDirection(fwd);
  var fwdX = fwd.x, fwdZ = fwd.z;
  var fwdLen = Math.sqrt(fwdX * fwdX + fwdZ * fwdZ);
  if (fwdLen > 0.001) { fwdX /= fwdLen; fwdZ /= fwdLen; }

  // 1. 搜集本直升机最多 8 个追踪航迹与视场内导弹 (敌我),解算最远距离用于动态自适应比例尺
  var maxDistFound = 0;
  var validTracks = [];
  var tracks = p._heliRadarTracks;
  if (tracks && tracks.length > 0) {
    for (var i = 0; i < Math.min(HELI_RADAR_MAX_TRACKS, tracks.length); i++) {
      var rt = tracks[i];
      if (!rt.tank || !rt.tank.alive || !rt.tank.group) continue;
      if (rt.dist > 10000) continue;
      validTracks.push(rt);
      if (rt.dist > maxDistFound) maxDistFound = rt.dist;
    }
  }

  // 1b. 数据链共享接触: 友军直升机上报的敌人(其 FCR 航迹 + AI 感知接触), 只画在玩家 FCR 扫描视场内。
  //     (AI 直升机按设计不开 FCR —— 见 updateHeli 通电段"AI 无数据链消费方, 不空转雷达",
  //      故其"扫描"=AI 感知 targetO/known; 玩家 FCR 开机且有友机 → 本机视场内叠加 DL 接触符号)
  var seenOwn = {};
  for (var oi = 0; oi < validTracks.length; oi++) { var ov = validTracks[oi]; if (ov.tank) seenOwn[ov.tank.id || ov.tank.name] = true; }
  var sharedTracks = [];
  var sharedSeen = {};
  function addShared(tk, srcHeli) {
    if (!tk || !tk.alive || !tk.group || !areHostile(p, tk)) return;
    var key = tk.id || tk.name;
    if (seenOwn[key] || sharedSeen[key]) return;            // 本机已探测/已上报过 → 不重复绘制
    var sq = tk.group.position;
    var sdx = sq.x - pPos.x, sdz = sq.z - pPos.z;
    var sd = Math.sqrt(sdx * sdx + sdz * sdz);
    if (sd < 1 || sd > 10000) return;
    var sBear = Math.atan2(sdx * fwdZ - sdz * fwdX, sdx * fwdX + sdz * fwdZ);
    if (Math.abs(sBear) > Math.PI / 6 + 0.05) return;        // 仅在玩家 FCR 扫描视场内
    sharedSeen[key] = true;
    sharedTracks.push({ tank: tk, dist: sd, bearing: sBear, src: srcHeli });
    if (sd > maxDistFound) maxDistFound = sd;
  }
  if (aliveList && aliveList.length) {
    for (var fi = 0; fi < aliveList.length; fi++) {
      var fh = aliveList[fi];
      if (isFfaMode() || fh === p || !fh.alive || !isHeliVehicle(fh) || !areFriendly(p, fh)) continue;
      var ftracks = (fh._heliRadarActive && fh._heliRadarTracks) ? fh._heliRadarTracks : null;   // 源1: 友机 FCR 航迹
      if (ftracks) for (var ft = 0; ft < ftracks.length; ft++) { var ftr = ftracks[ft]; if (ftr && ftr.tank) addShared(ftr.tank, fh); }
      if (fh.ai) {                                                                              // 源2: 友机 AI 感知接触
        addShared(fh.ai.targetO, fh);
        var kn = fh.ai.known;
        if (kn) for (var kk = 0; kk < kn.length; kk++) if (kn[kk]) addShared(kn[kk].o, fh);
      }
    }
  }

  var missilesInFov = [];
  if (airborneMissiles.length > 0) {   // 子列表迭代 + 字段修正(s.pos/s.vel)
    for (var si = 0; si < airborneMissiles.length; si++) {
      var s = airborneMissiles[si];
      if (!s || s.life <= 0) continue;
      if (!s.isHeliMissile && !s.isMissile && s.kind !== 'missile') continue;

      var mdx = s.pos.x - pPos.x, mdy = s.pos.y - (pPos.y + 1.2), mdz = s.pos.z - pPos.z;
      var mdSq = mdx * mdx + mdy * mdy + mdz * mdz;
      if (mdSq > 100000000 || mdSq < 1.0) continue;
      var md = Math.sqrt(mdSq);

      var mDirX = mdx / md, mDirY = mdy / md, mDirZ = mdz / md;
      var mDotNose = mDirX * _vRadarNoseDir.x + mDirY * _vRadarNoseDir.y + mDirZ * _vRadarNoseDir.z;
      if (mDotNose >= 0.8660254) {
        var isFriend = s.owner && areFriendly(p, s.owner);
        missilesInFov.push({
          x: s.pos.x, y: s.pos.y, z: s.pos.z,
          vx: s.vel.x || 0, vy: s.vel.y || 0, vz: s.vel.z || 0,
          dx: mdx, dy: mdy, dz: mdz,
          dist: md,
          isFriendly: isFriend
        });
        if (md > maxDistFound) maxDistFound = md;
      }
    }
  }

  // 2. 根据扫描到的最远目标动态调整比例尺 (1km, 2km, 5km, 8km, 10km)
  var dispMaxRange = 10000.0;
  if (maxDistFound > 0) {
    if (maxDistFound <= 800) dispMaxRange = 1000.0;
    else if (maxDistFound <= 1800) dispMaxRange = 2000.0;
    else if (maxDistFound <= 4500) dispMaxRange = 5000.0;
    else if (maxDistFound <= 7500) dispMaxRange = 8000.0;
    else dispMaxRange = 10000.0;
  }
  if (rngLbl) {
    rngLbl.textContent = dispMaxRange >= 1000 ? (dispMaxRange / 1000).toFixed(0) + 'km' : Math.round(dispMaxRange) + 'm';
  }

  // 3. 绘制目标航迹 (红菱形已锁定/蓝方框锁定中/绿圆点跟踪中)
  var lockedCount = 0;
  var lockingCount = 0;
  var primaryTrack = null;

  for (var vi = 0; vi < validTracks.length; vi++) {
    var rt2 = validTracks[vi];
    var tPos = rt2.tank.group.position;
    var tdx = tPos.x - pPos.x, tdz = tPos.z - pPos.z;
    var relBearing = Math.atan2(tdx * fwdZ - tdz * fwdX, tdx * fwdX + tdz * fwdZ);
    if (Math.abs(relBearing) > Math.PI / 6 + 0.05) continue;

    var rPx = Math.min(maxR, (rt2.dist / dispMaxRange) * maxR);
    var plotX = cx + Math.sin(relBearing) * rPx;
    var plotY = cy - Math.cos(relBearing) * rPx;

    if (rt2.isLocked) {
      lockedCount++;
      if (rt2.tank === p._heliMissileTarget) primaryTrack = rt2;

      ctx.fillStyle = '#ff2d20';
      ctx.strokeStyle = '#ff2d20';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(plotX, plotY - 6);
      ctx.lineTo(plotX + 6, plotY);
      ctx.lineTo(plotX, plotY + 6);
      ctx.lineTo(plotX - 6, plotY);
      ctx.closePath();
      ctx.fill();

      ctx.strokeRect(plotX - 8, plotY - 8, 16, 16);
      ctx.font = 'bold 9px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(rt2.tank.name, plotX, plotY - 10);
    } else if (rt2.isDesignated) {
      lockingCount++;
      var pct = Math.round((rt2.lockEnergy || 0) * 100);
      ctx.fillStyle = '#3498db';
      ctx.strokeStyle = '#3498db';
      ctx.lineWidth = 1.5;
      ctx.fillRect(plotX - 3.5, plotY - 3.5, 7, 7);
      ctx.strokeRect(plotX - 6, plotY - 6, 12, 12);
      ctx.font = 'bold 9px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(pct + '%', plotX, plotY - 8);
    } else {
      ctx.fillStyle = '#2ecc71';
      ctx.beginPath();
      ctx.arc(plotX, plotY, 2.5, 0, TAU);
      ctx.fill();
    }
  }

  // 3b. 绘制数据链共享接触 (青色实心小菱形 + DL 标注): 友军直升机上报、本机 FCR 未直接探测
  //     ★只画位置标记, 不画锁定框——锁定框(红方框=已锁定/蓝方框=锁定中)是本机 FCR 自探测航迹专属,
  //       数据链共享接触无本机锁定状态, 绝不绘制方框描边(与 validTracks 的 isLocked/isDesignated 严格区分)
  for (var shi = 0; shi < sharedTracks.length; shi++) {
    var st = sharedTracks[shi];
    var sPx = Math.min(maxR, (st.dist / dispMaxRange) * maxR);
    var sX = cx + Math.sin(st.bearing) * sPx;
    var sY = cy - Math.cos(st.bearing) * sPx;
    ctx.fillStyle = 'rgba(127, 210, 255, 0.85)';
    ctx.beginPath();
    ctx.moveTo(sX, sY - 4);
    ctx.lineTo(sX + 4, sY);
    ctx.lineTo(sX, sY + 4);
    ctx.lineTo(sX - 4, sY);
    ctx.closePath();
    ctx.fill();                        // 实心填充, 无 stroke 描边=不构成"框"
    ctx.font = 'bold 8px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(127, 210, 255, 0.9)';
    ctx.fillText('DL', sX, sY - 7);
  }

  // 4. 绘制视场内所有导弹图标 (敌我分色与航向指示)
  for (var mi = 0; mi < missilesInFov.length; mi++) {
    var mInfo = missilesInFov[mi];
    var mRelBearing = Math.atan2(mInfo.dx * fwdZ - mInfo.dz * fwdX, mInfo.dx * fwdX + mInfo.dz * fwdZ);
    if (Math.abs(mRelBearing) > Math.PI / 6 + 0.05) continue;

    var mRPx = Math.min(maxR, (mInfo.dist / dispMaxRange) * maxR);
    var mPlotX = cx + Math.sin(mRelBearing) * mRPx;
    var mPlotY = cy - Math.cos(mRelBearing) * mRPx;

    var mvLen = Math.sqrt(mInfo.vx * mInfo.vx + mInfo.vz * mInfo.vz);
    var mHeading = (mvLen > 1.0) ? Math.atan2(mInfo.vx * fwdZ - mInfo.vz * fwdX, mInfo.vx * fwdX + mInfo.vz * fwdZ) : mRelBearing;

    ctx.save();
    ctx.translate(mPlotX, mPlotY);
    ctx.rotate(mHeading);

    if (mInfo.isFriendly) {
      // 友军导弹:青色三角箭头
      ctx.fillStyle = '#00e5ff';
      ctx.strokeStyle = '#003344';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(-4, 4);
      ctx.lineTo(0, 2);
      ctx.lineTo(4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      // 敌军导弹:高亮橙红告警三角
      ctx.fillStyle = '#ff3d00';
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(-5, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    ctx.font = 'bold 8px Consolas, monospace';
    ctx.fillStyle = mInfo.isFriendly ? '#00e5ff' : '#ff3d00';
    ctx.textAlign = 'center';
    ctx.fillText(mInfo.isFriendly ? 'MSL' : 'MSL ⚠', mPlotX, mPlotY - 7);
  }

  // 5. 底部文字栏状态 (只显示电源与多目标战术火控状态,不显示旋翼状态)
  var dlStr = sharedTracks.length > 0 ? (' [DL ' + sharedTracks.length + ' DATALINK]') : '';
  if (lockedCount > 0) {
    if (statusLbl) { statusLbl.textContent = 'FCR: LCK [' + lockedCount + '/4 LOCKED]'; statusLbl.style.color = '#ff2d20'; }
    if (primaryTrack && primaryTrack.tank) {
      var dTxt = primaryTrack.dist >= 1000 ? (primaryTrack.dist / 1000).toFixed(1) + 'km' : Math.round(primaryTrack.dist) + 'm';
      if (tgtLine) tgtLine.textContent = 'PRI: ★ ' + primaryTrack.tank.name + ' (' + dTxt + ')' + dlStr;

      var tp = primaryTrack.tank.group.position;
      var dx = tp.x - pPos.x, dy = (tp.y + 1.0) - (pPos.y + 1.2), dz = tp.z - pPos.z;
      var azRad = Math.atan2(dx * fwdZ - dz * fwdX, dx * fwdX + dz * fwdZ);
      var azDeg = azRad * 180 / Math.PI;
      var elDeg = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) * 180 / Math.PI;
      if (teleLine) teleLine.textContent = 'AZ: ' + (azDeg >= 0 ? '+' : '') + azDeg.toFixed(0) + '°  EL: ' + (elDeg >= 0 ? '+' : '') + elDeg.toFixed(0) + '°';
    } else {
      if (tgtLine) tgtLine.textContent = 'LOCKED ' + lockedCount + ' TGTS [MULTI-CH]' + dlStr;
      if (teleLine) teleLine.textContent = 'RADAR NOMINAL [TWS MULTI-LOCK]';
    }
  } else if (lockingCount > 0) {
    if (statusLbl) { statusLbl.textContent = 'FCR: TRK [' + lockingCount + '/4 TRACKING]'; statusLbl.style.color = '#3498db'; }
    if (tgtLine) tgtLine.textContent = 'ACQUIRING ' + lockingCount + ' TARGETS...' + dlStr;
    if (teleLine) teleLine.textContent = 'MULTI-TGT TRACKING + ENERGY BUILD-UP';
  } else {
    var cnt = validTracks.length;
    var mslCnt = missilesInFov.length;
    var mslStr = mslCnt > 0 ? (' | MSL: ' + mslCnt + ' RDS') : '';
    if (statusLbl) { statusLbl.textContent = 'FCR: TWS [SCANNING]'; statusLbl.style.color = '#2ecc71'; }
    if (tgtLine) tgtLine.textContent = 'CONTACTS: ' + cnt + '/8 TGTS' + mslStr + dlStr;
    if (teleLine) teleLine.textContent = p._heliRadarManualInhibit ? 'RADAR NOMINAL [MAN STBY]' : 'RADAR NOMINAL [TWS AUTO]';
  }

  ctx.restore();
}

function updateHeliWeapons(p, dt) {
  var _puReloadRate = typeof powerupReloadRate === 'function' ? powerupReloadRate(p) : 1;
  if (p._heliWeapon == null) p._heliWeapon = 3;   // 默认1号位=导弹
  if (p.kind === 'aa') {
    if (p._aaWeapon !== 1 && p._aaWeapon !== 2) p._aaWeapon = 1;
    if (p._aaReloadKind !== 1 && p._aaReloadKind !== 2) p._aaReloadKind = 1;
    /* AI and non-upgraded AA never inherit a player ATGM state. */
    if (!isPlayerAaAtgmVehicle(p)) {
      p._aaWeapon = 1;
      p._aaReloadKind = 1;
      if (p._heliWeapon === 2) p._heliWeapon = 3;
    }
  }
  if (p._heliRocketLeft == null) p._heliRocketLeft = rocketPodCountOf(p);
  if (p._heliMissileNextSide == null) p._heliMissileNextSide = 0;
  if (p._heliDecoyLeft == null) p._heliDecoyLeft = HELI_DECOY_CAPACITY;
  if (p._heliDecoyReloadT == null) p._heliDecoyReloadT = 0;
  if (p._heliDecoyCooldown == null) p._heliDecoyCooldown = 0;
  if (p._heliDecoyThreatT == null) p._heliDecoyThreatT = -Infinity;

  if (p._heliDecoyCooldown > 0) p._heliDecoyCooldown = Math.max(0, p._heliDecoyCooldown - dt);
  if (p._heliDecoyReloadT > 0) {
    p._heliDecoyReloadT = Math.max(0, p._heliDecoyReloadT - dt);
    if (p._heliDecoyReloadT <= 0) {
      p._heliDecoyLeft = HELI_DECOY_CAPACITY;
      if (p.isPlayer && typeof aimHint === 'function') aimHint('DECOY FLARES RELOADED (20/20)');
    }
  }

  // 火箭弹装填=rocketReloadTimeOf(1s×装弹量) 与 0.2s 发射间隔
  if (p._heliRocketReloadT > 0) {
    p._heliRocketReloadT = Math.max(0, p._heliRocketReloadT - dt * _puReloadRate);
    if (p._heliRocketReloadT <= 0) {
      p._heliRocketLeft = rocketPodCountOf(p);
      if (p.isPlayer && typeof sfxReloadCue === 'function') sfxReloadCue('heli_rocket');   // 装填完成提示音
      if (p.isPlayer && typeof aimHint === 'function' && p._heliWeapon === 2) aimHint('ROCKETS RELOADED (' + p._heliRocketLeft + '/' + rocketPodCountOf(p) + ')');
    }
  }
  if (p._heliRocketCooldown > 0) {
    p._heliRocketCooldown = Math.max(0, p._heliRocketCooldown - dt);
  }

  // 多联装挂架——每侧挂架独立计算装填(打空一侧才开始该侧 40s 装填,另一侧可继续发射)
  if (p._heliMslRounds == null) { var _mx = heliMslTubesOf(p); p._heliMslRounds = [_mx, _mx]; p._heliMslTube = [0, 0]; }
  if (p._heliMissileReloadTL > 0) {
    p._heliMissileReloadTL = Math.max(0, p._heliMissileReloadTL - dt * _puReloadRate);
    if (p._heliMissileReloadTL <= 0) {
      p._heliMslRounds[0] = heliMslTubesOf(p); p._heliMslTube[0] = 0;
      if (p._heliMslMeshesL) for (var _mi = 0; _mi < p._heliMslMeshesL.length; _mi++) p._heliMslMeshesL[_mi].visible = true;
      if (p.isPlayer && typeof sfxReloadCue === 'function') sfxReloadCue('heli_missile');   // 装填完成提示音
      if (p.isPlayer && typeof aimHint === 'function' &&
          (p._heliWeapon === 3 || (p.kind === 'aa' && p._heliWeapon === 2))) {
        aimHint(p.kind === 'aa' ? ('LEFT ' + (p._aaReloadKind === 2 ? 'ATGM' : 'SAM') + ' RACK RELOADED') : 'LEFT PYLON RELOADED');
      }
    }
  }
  if (p._heliMissileReloadTR > 0) {
    p._heliMissileReloadTR = Math.max(0, p._heliMissileReloadTR - dt * _puReloadRate);
    if (p._heliMissileReloadTR <= 0) {
      p._heliMslRounds[1] = heliMslTubesOf(p); p._heliMslTube[1] = 0;
      if (p._heliMslMeshesR) for (var _mi = 0; _mi < p._heliMslMeshesR.length; _mi++) p._heliMslMeshesR[_mi].visible = true;
      if (p.isPlayer && typeof sfxReloadCue === 'function') sfxReloadCue('heli_missile');   // 装填完成提示音
      if (p.isPlayer && typeof aimHint === 'function' &&
          (p._heliWeapon === 3 || (p.kind === 'aa' && p._heliWeapon === 2))) {
        aimHint(p.kind === 'aa' ? ('RIGHT ' + (p._aaReloadKind === 2 ? 'ATGM' : 'SAM') + ' RACK RELOADED') : 'RIGHT PYLON RELOADED');
      }
    }
  }
  if (p._heliMissileCooldown > 0) {
    p._heliMissileCooldown = Math.max(0, p._heliMissileCooldown - dt);
  }

  // 维护剩余可用导弹数量(两侧在筒之和)
  p._heliMissileLeft = (p._heliMslRounds[0] || 0) + (p._heliMslRounds[1] || 0);

  // 任务23:RED_AA 车载雷达启动序列——每次部署需启动一次,时长=直升机雷达预热(HELI_RADAR_WARMUP_TIME 15s);
  // 就绪即开(startHeliRadarScan),开机后无关断路径(地面载具无发动机熄火态);击毁/重新部署由 createTank 重新冷启动。
  if (typeof isAAVehicle === 'function' && isAAVehicle(p) && p.team === 'red' && p.alive && !p._heliRadarActive) {
    if (p._heliRadarWarmup == null) p._heliRadarWarmup = 0;
    if (p._heliRadarWarmup < HELI_RADAR_WARMUP_TIME) p._heliRadarWarmup = Math.min(HELI_RADAR_WARMUP_TIME, p._heliRadarWarmup + dt);
    if (p._heliRadarWarmup >= HELI_RADAR_WARMUP_TIME) startHeliRadarScan(p);
  }

  // 雷达锁定循环:AI 直升机雷达常亮——航迹表持续维护,供数据链共享/制导火力分配消费;
  // 仅在雷达开启态运行,发动机熄火关雷达后自然停跑。
  // ★AI 降频:玩家逐帧跑(锁定/瞄准手感零延迟);AI 用 per-heli 累加器降到 ~0.15s 一拍,
  //   并把累积 dt 传进去,使 lockEnergy 累减 / lostTime 累加 / occ 射线节流等时间量保持正确。
  //   8 架 AI × 50Hz 的 loop 调用量由此降到约 1/7,配合零 GC 候选池,移动端开销可忽略。
  if (p._heliRadarActive) {
    if (p.isPlayer) {
      updateHeliRadar(p, dt);
    } else {
      p._heliRadarAccT = (p._heliRadarAccT || 0) + dt;
      if (p._heliRadarAccT >= 0.15) {
        updateHeliRadar(p, p._heliRadarAccT);
        p._heliRadarAccT = 0;
      }
    }
  }

  /* BLUE-HELI automatic cannon target selection is a player-tech effect.
     AI helicopters never enter this consumer and keep their existing fire-control path. */
  if (p.isPlayer && p.team === 'blue' && p.kind === 'ah64' &&
      typeof vehicleTechBlueHeliAutoCannonTick === 'function') {
    vehicleTechBlueHeliAutoCannonTick(p, dt);
  }
}

/* ============================================================
   A射B导(A 机发射 / B 机制导)—— 玩家驾驶直升机时的机载武器协同交战
   · 触发: 玩家在直升机座舱时按 Backspace 开/关(地面载具座舱仍走原小队指挥,见 initInput 分支);
   · 选取: **随机抽取**距离玩家最近的最多 HELI_ABG_MAX(4) 架友军 AI 直升机(不含玩家自己)——
           三维距离按 40m 壳层分桶, 同壳层内真随机抽取(编队僚机互距几十米=同壳层, 重按换批),
           壳层间严格就近; **不自动补充**——僚机阵亡/离场只减员不递补,
           想换一批只能再按一次 Backspace 重新选取(heliABGValidate 每帧只做减员,不补员);
   · 效果: 被选中僚机此后发射的**导弹**在离架瞬间改投玩家当前锁定目标,分配机制与玩家自己的
           导弹完全同源(allocateGuidedFireTarget(player, 玩家弹型规格):同域优先→在飞弹最少
           →准星偏角最小)。**只作用于导弹(武器位 3),火箭弹/制导火箭弹不参与**——挂钩点就在
           triggerHeliFire 的 wp===3 分支,火箭走 wp===2 分支天然不受影响;
   · 回落: 玩家无锁定目标 → 退回该僚机自身分配(其 _heliMissileTarget / ai.targetO);
   · 制导保持: 借出弹离架时打 _abgLoan 标记(经 p._abgLoanFire 传递),heliGuidedAcquireTarget
           据此把"玩家仍锁定该目标"视为与母机雷达锁定同权——否则借用弹一出膛就会在 >450m 段
           被母机雷达重分配逻辑抢回母机目标,功能形同无效;玩家丢锁 → 回落母机自身重分配;
   · 清理: 玩家阵亡/离开直升机/换场重置/手动关闭一律清空(heliABGClear)。
   ============================================================ */
var HELI_ABG_MAX = 4;
var heliABG = { on: false, wings: [] };

function heliABGClear() {
  heliABG.on = false;
  heliABG.wings.length = 0;
}
/* 每帧校验(标识线程调用): 玩家已不在直升机座舱 → 自动关闭; 僚机阵亡 → 减员(不递补) */
function heliABGValidate() {
  if (!heliABG.on) return false;
  if (typeof player === 'undefined' || !player || !player.alive || !isHeliVehicle(player)) { heliABGClear(); return false; }
  var w = heliABG.wings, out = null, i;
  for (i = 0; i < w.length; i++) {
    var t = w[i];
    if (!t || !t.alive || t === player || t.isPlayer || !isHeliVehicle(t)) { if (!out) out = w.slice(0, i); continue; }
    if (out) out.push(t);
  }
  if (out) heliABG.wings = out;
  return true;
}
function heliABGHas(p) {
  var w = heliABG.wings;
  for (var i = 0; i < w.length; i++) if (w[i] === p) return true;
  return false;
}
/* 玩家当前锁定目标(与玩家自己按下发射键时的分配同源,保证"分配机制和玩家自己的导弹一样") */
function heliABGPlayerTarget() {
  if (typeof player === 'undefined' || !player || !player.alive || !isHeliVehicle(player)) return null;
  if (typeof heliMslTypeOf !== 'function' || typeof HELI_MSL_SPEC === 'undefined') return null;
  var pt = (typeof allocateGuidedFireTarget === 'function')
    ? allocateGuidedFireTarget(player, HELI_MSL_SPEC[heliMslTypeOf(player)]) : null;
  return (pt && pt.alive && pt.group) ? pt : null;
}
/* 僚机发射导弹时的目标解算: 借用中且玩家有锁定 → 玩家目标(并置借用标记); 否则 → 僚机自身分配 */
function heliABGTargetFor(p, mSpec) {
  var own = (typeof allocateGuidedFireTarget === 'function') ? allocateGuidedFireTarget(p, mSpec)
          : (p._heliMissileTarget || (p.ai ? p.ai.targetO : null));
  p._abgLoanFire = false;
  if (!heliABG.on || !heliABGHas(p)) return own;
  if (typeof player === 'undefined' || !player || !player.alive || player === p || !isHeliVehicle(player)) return own;
  var pt = heliABGPlayerTarget();
  if (!pt) return own;                    // 玩家没有锁定目标 → 引导向友军直升机自己锁定的目标
  p._abgLoanFire = true;                  // 借用弹: 由 fireHeliMissile 转成弹体 _abgLoan 标记
  return pt;
}
/* 借出弹的制导保持: 目标仍是玩家当前锁定目标 = 与母机雷达锁定同权 */
function heliABGLoanHold(s) {
  if (!heliABG.on || !s || !s._abgLoan) return false;
  if (typeof player === 'undefined' || !player || !player.alive || player === s.owner || !isHeliVehicle(player)) return false;
  var tgt = s.target;
  if (!tgt || !tgt.alive || !tgt.group) return false;
  return heliABGPlayerTarget() === tgt;
}
/* 借出弹的重分配: 优先玩家当前锁定目标; 玩家无锁定 → 退回母机自身分配 */
function heliABGLoanRealloc(s, spec) {
  var pt = heliABGPlayerTarget();
  if (pt) return pt;
  return (typeof allocateGuidedFireTarget === 'function') ? allocateGuidedFireTarget(s.owner, spec) : null;
}
/* Backspace 开/关(仅直升机座舱生效); 返回是否已进入 */
function heliABGToggle() {
  if (heliABG.on) {
    var n0 = heliABG.wings.length;
    heliABGClear();
    if (typeof aimHint === 'function') aimHint('RELEASED ' + n0 + ' WINGMEN');
    return false;
  }
  if (typeof player === 'undefined' || !player || !player.alive || !isHeliVehicle(player)) return false;
  if (typeof aliveList === 'undefined' || !aliveList.length) {
    if (typeof aimHint === 'function') aimHint('NO VEHICLES IN PLAY');
    return false;
  }
  var pp = player.group.position, cands = [], i, t;
  for (i = 0; i < aliveList.length; i++) {
    t = aliveList[i];
    if (t === player || !t.alive || t.isPlayer || !isHeliVehicle(t)) continue;
    if (isFfaMode() || !areFriendly(player, t) || !t.ai) continue;   // 个人死斗不启用僚机借出
    var dx = t.group.position.x - pp.x, dy = t.group.position.y - pp.y, dz = t.group.position.z - pp.z;
    var d2 = dx * dx + dy * dy + dz * dz;
    cands.push({ t: t, d2: d2, b: Math.floor(Math.sqrt(d2) / 40), j: Math.random() });   // b=40m 距离壳层, j=壳层内随机抽序
  }
  if (!cands.length) {
    if (typeof aimHint === 'function') aimHint('NO SAME-SIDE HELI IN RANGE');
    return false;
  }
  /* 随机抽取: 同一 40m 距离壳层内的候选真随机抽取(编队僚机互距几十米=同壳层,每次按 Backspace 换不同批),
     壳层之间仍严格就近——明显更近的僚机绝不会被更远者顶掉(满足"随机抽取"+"距离玩家最近"双约束) */
  cands.sort(function (a, b) { return (a.b - b.b) || (a.j - b.j); });
  var n = Math.min(HELI_ABG_MAX, cands.length);
  for (i = 0; i < n; i++) heliABG.wings.push(cands[i].t);
  heliABG.on = true;
  if (typeof aimHint === 'function') aimHint('BORROWED ' + n + ' WINGMEN');
  return true;
}

function isPlayerMbtMissileVehicle(p) {
  /* BLUE-MBT-1 no longer has the gun-launched missile node.  Keep this shared
     compatibility gate, but make the real weapon/HUD/input path RED-MBT-1 only. */
  return !!(p && p.isPlayer === true && p.team === 'red' && p.kind === 'tank' && p._techGunLaunchedMissile === true);
}
function isPlayerRedMbtMissileVehicle(p) {
  /* Keep this predicate self-contained because the loader/input regression and
     the live HUD both use it as their red-side capability boundary. */
  return !!(p && p.isPlayer === true && p.team === 'red' && p.kind === 'tank' && p._techGunLaunchedMissile === true);
}

/* AA launchers use the same two-state loader model as RED-MBT-1.
   _aaWeapon is the player's selection for the next loading cycle; _aaReloadKind
   is the SAM/ATGM kind currently in the launcher (or currently being loaded).
   A ready rack is never rewritten by a selection change. */
function isPlayerAaAtgmVehicle(p) {
  return !!(p && p.isPlayer === true && p.kind === 'aa' &&
    (p._techAaAtgm === true ||
      (typeof vehicleTechAaAtgmInstalled === 'function' && vehicleTechAaAtgmInstalled(p)) ||
      (typeof vehicleTechRedAaAtgmInstalled === 'function' && vehicleTechRedAaAtgmInstalled(p))));
}
function aaWeaponLabel(kind) {
  return kind === 2 ? 'ATGM' : 'SAM';
}
function selectAAWeapon(p, weapon) {
  if (!isPlayerAaAtgmVehicle(p)) return false;
  weapon = weapon === 2 ? 2 : 1;
  if (p._aaWeapon !== 1 && p._aaWeapon !== 2) p._aaWeapon = 1;
  if (p._aaReloadKind !== 1 && p._aaReloadKind !== 2) p._aaReloadKind = p._aaWeapon;
  if (p._aaWeapon === weapon) {
    p._heliWeapon = weapon === 2 ? 2 : 3;
    return true;
  }

  p._aaWeapon = weapon;
  /* Any active rack reload is the AA equivalent of MBT's breech loading.  A
     switch interrupts both sides, clears their old rounds, and starts one new
     synchronized cycle so a single cycle can never contain mixed types. */
  var loading = (p._heliMissileReloadTL || 0) > 0 || (p._heliMissileReloadTR || 0) > 0;
  if (loading) {
    var aaReloadTime = typeof heliMslReloadTimeOf === 'function' ? heliMslReloadTimeOf(p) : 20;
    if (!p._heliMslRounds) p._heliMslRounds = [0, 0];
    if (!p._heliMslTube) p._heliMslTube = [0, 0];
    p._heliMslRounds[0] = 0;
    p._heliMslRounds[1] = 0;
    p._heliMslTube[0] = 0;
    p._heliMslTube[1] = 0;
    p._heliMissileReloadTL = aaReloadTime;
    p._heliMissileReloadTR = aaReloadTime;
    p._aaReloadKind = weapon;
    p._heliMissileLeft = 0;
    if (typeof aimHint === 'function') aimHint(aaWeaponLabel(weapon) + ' LOADING RESET');
  }
  p._heliWeapon = weapon === 2 ? 2 : 3;
  if (typeof camAimP !== 'undefined') camAimP = playerAimPitchClamp(p, camAimP);
  return true;
}

/* Player MBT-1 has one physical breech/loader.  _mbtWeapon is the player's
   selection for the next loading cycle; _mbtReloadKind is the round currently
   in the breech (or the weapon currently being loaded).  Keeping those states
   separate is essential: changing selection after READY cannot rewrite a round
   that has already been loaded. */
function selectRedMbtWeapon(p, weapon) {
  if (!isPlayerRedMbtMissileVehicle(p)) return false;
  weapon = weapon === 2 ? 2 : 1;
  if (p._mbtWeapon == null) p._mbtWeapon = 1;
  if (p._mbtReloadKind !== 1 && p._mbtReloadKind !== 2) p._mbtReloadKind = p._mbtWeapon;
  if (p._mbtWeapon === weapon) return true;
  p._mbtWeapon = weapon;
  /* During loading, a weapon switch interrupts the old cycle and starts a fresh
     cycle for the newly selected weapon.  Once reload reaches zero, do not touch
     _mbtReloadKind: that already-loaded round owns the next trigger pull. */
  if (p.reload > 0) {
    p.reload = typeof redMbtMissileReloadTimeOf === 'function' ? redMbtMissileReloadTimeOf(p) : p.reloadTime;
    p._mbtReloadKind = weapon;
    if (typeof aimHint === 'function') aimHint(weapon === 2 ? 'MISSILE LOADING RESET' : 'MAIN GUN LOADING RESET');
  }
  if (typeof camAimP !== 'undefined') camAimP = playerAimPitchClamp(p, camAimP);
  return true;
}

function triggerRedMbtFire(p) {
  if (!isPlayerRedMbtMissileVehicle(p) || !p.alive || gameState !== 'playing') return false;
  if (p._mbtWeapon !== 1 && p._mbtWeapon !== 2) p._mbtWeapon = 1;
  if (p._mbtReloadKind !== 1 && p._mbtReloadKind !== 2) p._mbtReloadKind = p._mbtWeapon;
  var loadedWeapon = p._mbtReloadKind;
  var nextWeapon = p._mbtWeapon;
  if (p.reload > 0) {
    if (typeof aimHint === 'function') aimHint(loadedWeapon === 2 ? 'MISSILE LOADING (' + p.reload.toFixed(1) + 's)' : 'MAIN GUN LOADING (' + p.reload.toFixed(1) + 's)');
    return false;
  }
  if (loadedWeapon === 2) {
    if (typeof fireRedMbtMissile !== 'function' || !fireRedMbtMissile(p)) return false;
    p.reload = typeof redMbtMissileReloadTimeOf === 'function' ? redMbtMissileReloadTimeOf(p) : p.reloadTime;
    /* The shot just fired was the loaded missile.  The selected weapon now
       becomes the weapon loaded by the new post-shot cycle. */
    p._mbtReloadKind = nextWeapon;
    return true;
  }
  var oldReload = p.reload;
  tryFire(p);
  if (p.reload > oldReload) {
    /* The shot just fired was the loaded main-gun round, regardless of a READY-
       state selection change.  The next cycle follows the current selection. */
    p._mbtReloadKind = nextWeapon;
    return true;
  }
  return false;
}

function isPlayerRedTdHighExplosiveVehicle(p) {
  return !!(p && p.isPlayer === true && p.team === 'red' && p.kind === 'td' && p._techHighExplosive === true);
}

/* RED-TD has one physical breech: _tdWeapon is the next loading selection and
   _tdReloadKind is the round currently loaded/being loaded. */
function selectRedTdWeapon(p, weapon) {
  if (!isPlayerRedTdHighExplosiveVehicle(p)) return false;
  weapon = weapon === 2 ? 2 : 1;
  if (p._tdWeapon !== 1 && p._tdWeapon !== 2) p._tdWeapon = 1;
  if (p._tdReloadKind !== 1 && p._tdReloadKind !== 2) p._tdReloadKind = p._tdWeapon;
  if (p._tdWeapon === weapon) return true;
  p._tdWeapon = weapon;
  if (p.reload > 0) {
    p.reload = p.reloadTime;
    p._tdReloadKind = weapon;
    if (typeof aimHint === 'function') aimHint(weapon === 2 ? 'HE LOADING RESET' : 'AP LOADING RESET');
  }
  if (typeof camAimP !== 'undefined') camAimP = playerAimPitchClamp(p, camAimP);
  return true;
}

function triggerRedTdFire(p) {
  if (!isPlayerRedTdHighExplosiveVehicle(p) || !p.alive || gameState !== 'playing') return false;
  if (p._tdWeapon !== 1 && p._tdWeapon !== 2) p._tdWeapon = 1;
  if (p._tdReloadKind !== 1 && p._tdReloadKind !== 2) p._tdReloadKind = p._tdWeapon;
  var loadedWeapon = p._tdReloadKind, nextWeapon = p._tdWeapon;
  if (p.reload > 0) {
    if (typeof aimHint === 'function') aimHint(loadedWeapon === 2 ? 'HE LOADING (' + p.reload.toFixed(1) + 's)' : 'AP LOADING (' + p.reload.toFixed(1) + 's)');
    return false;
  }
  if (loadedWeapon === 2) {
    if (typeof fireRedTdHighExplosive !== 'function' || !fireRedTdHighExplosive(p)) return false;
    p.reload = p.reloadTime;
    p._tdReloadKind = nextWeapon;
    return true;
  }
  var oldReload = p.reload;
  tryFire(p);
  if (p.reload > oldReload) {
    p._tdReloadKind = nextWeapon;
    return true;
  }
  return false;
}

function triggerHeliDecoy(p) {
  if (!p || !p.alive || !isHeliVehicle(p) || gameState !== 'playing') return false;
  if (p._heliDecoyLeft == null) p._heliDecoyLeft = HELI_DECOY_CAPACITY;
  if (p._heliDecoyReloadT > 0 || p._heliDecoyCooldown > 0) {
    if (p.isPlayer && p._heliDecoyReloadT > 0 && typeof aimHint === 'function') aimHint('DECOY FLARES LOADING (' + p._heliDecoyReloadT.toFixed(1) + 's)');
    return false;
  }
  if (p._heliDecoyLeft < HELI_DECOY_BURST_SIZE) {
    p._heliDecoyReloadT = HELI_DECOY_RELOAD_TIME;
    if (p.isPlayer && typeof aimHint === 'function') aimHint('DECOY FLARES EMPTY - LOADING (20s)');
    return false;
  }
  if (typeof fireHeliDecoyBurst !== 'function' || !fireHeliDecoyBurst(p)) return false;
  p._heliDecoyLeft = Math.max(0, p._heliDecoyLeft - HELI_DECOY_BURST_SIZE);
  p._heliDecoyCooldown = 0.75;
  if (p._heliDecoyLeft < HELI_DECOY_BURST_SIZE) {
    p._heliDecoyReloadT = HELI_DECOY_RELOAD_TIME;
    if (p.isPlayer && typeof aimHint === 'function') aimHint('DECOY FLARES DEPLOYED - LOADING (20s)');
  } else if (p.isPlayer && typeof aimHint === 'function') {
    aimHint('DECOY FLARES DEPLOYED (' + p._heliDecoyLeft + '/20)');
  }
  return true;
}

function triggerHeliFire(p) {
  var wp = p._heliWeapon || 3;
  if (wp === 1) {
    /* AUTO CANNON owns BLUE-HELI weapon-1 firing while a tech target exists;
       main.js fires after the automatic servo has updated the real cannon pose. */
    if (p.isPlayer && p.team === 'blue' && p.kind === 'ah64' && p._techAutoCannonTarget &&
        typeof vehicleTechBlueHeliAutoCannonInstalled === 'function' &&
        vehicleTechBlueHeliAutoCannonInstalled(p)) return;
    tryFire(p);
  } else if (wp === 2) {
    if (p.mods.ammo && p.mods.ammo.hp <= 0) {
      if (p.isPlayer && typeof aimHint === 'function') aimHint('RACK DAMAGED - ROCKETS DOWN');
      return;
    }
    if (p._heliRocketReloadT > 0) {
      if (p.isPlayer && typeof aimHint === 'function') aimHint('ROCKETS LOADING (' + p._heliRocketReloadT.toFixed(1) + 's)');
      return;
    }
    if (p._heliRocketLeft <= 0) {
      p._heliRocketReloadT = rocketReloadTimeOf(p);
      if (p.isPlayer && typeof aimHint === 'function') aimHint('ROCKETS EMPTY - LOADING (' + p._heliRocketReloadT.toFixed(0) + 's)');
      return;
    }
    if (p._heliRocketCooldown <= 0) {
      p._heliRocketCooldown = 0.20; // 5发/秒 (双发齐射)
      // 火箭弹左右两边同时发射 (各消耗1发,单次齐射共消耗2发)
      fireHeliRocket(p, 0); // 左侧火箭巢发射
      fireHeliRocket(p, 1); // 右侧火箭巢发射
      p._heliRocketLeft = Math.max(0, p._heliRocketLeft - 2);
      if (p._heliRocketLeft <= 0) {
        p._heliRocketLeft = 0;
        p._heliRocketReloadT = rocketReloadTimeOf(p);
        if (p.isPlayer && typeof aimHint === 'function') aimHint('ROCKETS FIRED - LOADING (' + p._heliRocketReloadT.toFixed(0) + 's)');
      }
    }
  } else if (wp === 3) {
    if (p.mods.ammo && p.mods.ammo.hp <= 0) {
      if (p.isPlayer && typeof aimHint === 'function') aimHint('RACK DAMAGED - MISSILES DOWN');
      return;
    }
    // 就绪=该侧不在装填且在筒弹药>0(多联装:单发消耗,打空才开该侧 40s 装填)
    if (p._heliMslRounds == null) { var _mx2 = heliMslTubesOf(p); p._heliMslRounds = [_mx2, _mx2]; p._heliMslTube = [0, 0]; }
    var leftReady = (p._heliMissileReloadTL == null || p._heliMissileReloadTL <= 0) && p._heliMslRounds[0] > 0;
    var rightReady = (p._heliMissileReloadTR == null || p._heliMissileReloadTR <= 0) && p._heliMslRounds[1] > 0;

    if (!leftReady && !rightReady) {
      var rlT = p._heliMissileReloadTL || 0, rrT = p._heliMissileReloadTR || 0;
      var defRTime = heliMslReloadTimeOf(p);
      var minT = Math.min(rlT > 0 ? rlT : defRTime, rrT > 0 ? rrT : defRTime);
      if (p.isPlayer && typeof aimHint === 'function') aimHint('MISSILES LOADING (' + minT.toFixed(1) + 's)');
      return;
    }

    if (!p._heliMissileCooldown || p._heliMissileCooldown <= 0) {
      p._heliMissileCooldown = 0.20; // 轻微防抖发射间隔

      // 选择当前发射侧: 若双侧均就绪则交替发射(默认优先左翼0),若单侧就绪则发射就绪侧
      var fireSide = 0;
      if (leftReady && rightReady) {
        fireSide = (p._heliMissileNextSide != null) ? p._heliMissileNextSide : 0;
        p._heliMissileNextSide = 1 - fireSide;
      } else if (leftReady) {
        fireSide = 0;
        p._heliMissileNextSide = 1;
      } else {
        fireSide = 1;
        p._heliMissileNextSide = 0;
      }

      // 按本机型挂载的弹型规格分配(空空导弹 domain='air': 对空优先, 均摊在飞弹)
      // A射B导: 被借用的僚机,其导弹改投玩家当前锁定目标(玩家无锁定→退回其自身分配)。
      //   注: 本分支仅武器位 3=导弹; 火箭弹/制导火箭弹走上方 wp===2 分支, 不受 A射B导影响。
      var mSpec = HELI_MSL_SPEC[heliMslTypeOf(p)];
      var target = heliABGTargetFor(p, mSpec);   // 借用命中时顺带置 p._abgLoanFire
      fireHeliMissile(p, fireSide, target);      // 弹体内转写为 sh._abgLoan(见 fireHeliMissile)
      p._abgLoanFire = false;

      // 消耗该挂架一发;打空才开启该挂架独立装填 (BLUE_HELI 10s, 红方武装直升机 40s)
      var tubeFired = p._heliMslTube[fireSide] | 0;
      p._heliMslTube[fireSide] = tubeFired + 1;
      p._heliMslRounds[fireSide] = Math.max(0, p._heliMslRounds[fireSide] - 1);
      if (p._heliMslRounds[fireSide] <= 0) {
        var rTime = heliMslReloadTimeOf(p);
        if (fireSide === 0) p._heliMissileReloadTL = rTime; else p._heliMissileReloadTR = rTime;
        if (p.isPlayer && typeof aimHint === 'function') aimHint((fireSide === 0 ? 'L' : 'R') + ' PYLON EMPTY - LOADING (' + rTime.toFixed(0) + 's)');
      }
      p._heliMissileLeft = p._heliMslRounds[0] + p._heliMslRounds[1];
    }
  }
}

/* 防空载具触发消费:
   _heliWeapon=3/2 selects SAM/ATGM for the next loading cycle, while
   _aaReloadKind decides the projectile that is actually in the launcher now.
   _heliWeapon=1 remains RED-AA's twin cannon. */
function triggerAAFire(p) {
  var wp = p._heliWeapon || 3;
  if (wp === 1) {
    if (p.team !== 'red') return;   // BLUE-AA has no cannon
    if (!p.alive || p.reload > 0 || gameState !== 'playing') return;
    if (p.mods.gun.hp <= 0) { if (typeof aimHint === 'function') aimHint('CANNOT FIRE'); return; }
    fireAAGun(p);                    // Twin salvo; fireAAGun owns the short cannon reload.
    return;
  }
  if (wp !== 2 && wp !== 3) return;

  var aaAtgmReady = isPlayerAaAtgmVehicle(p);
  if (!aaAtgmReady) {
    p._aaWeapon = 1;
    p._aaReloadKind = 1;
    p._heliWeapon = 3;
  }
  if (p._aaWeapon !== 1 && p._aaWeapon !== 2) p._aaWeapon = (wp === 2 && aaAtgmReady) ? 2 : 1;
  if (p._aaReloadKind !== 1 && p._aaReloadKind !== 2) p._aaReloadKind = 1;
  if (!aaAtgmReady) { p._aaWeapon = 1; p._aaReloadKind = 1; }
  var nextKind = (aaAtgmReady && p._aaWeapon === 2) ? 2 : 1;
  /* The live projectile type comes from the current rack cycle, never from the
     selected HUD slot.  This preserves a ready SAM when ATGM is selected. */
  var loadedKind = (aaAtgmReady && p._aaReloadKind === 2) ? 2 : 1;
  p._aaReloadKind = loadedKind;

  if (p.mods.ammo && p.mods.ammo.hp <= 0) {
    if (p.isPlayer && typeof aimHint === 'function') aimHint('LAUNCHER DAMAGED - HOLD FIRE');
    return;
  }
  // Ready = that side is not loading and still has a round in its rack.
  if (p._heliMslRounds == null) { var _mx = heliMslTubesOf(p); p._heliMslRounds = [_mx, _mx]; p._heliMslTube = [0, 0]; }
  if (p._heliMslTube == null) p._heliMslTube = [0, 0];
  var leftReady = (p._heliMissileReloadTL == null || p._heliMissileReloadTL <= 0) && p._heliMslRounds[0] > 0;
  var rightReady = (p._heliMissileReloadTR == null || p._heliMissileReloadTR <= 0) && p._heliMslRounds[1] > 0;
  if (!leftReady && !rightReady) {
    var rlT = p._heliMissileReloadTL || 0, rrT = p._heliMissileReloadTR || 0;
    var defRTime = heliMslReloadTimeOf(p);
    var minT = Math.min(rlT > 0 ? rlT : defRTime, rrT > 0 ? rrT : defRTime);
    if (p.isPlayer && typeof aimHint === 'function') aimHint(aaWeaponLabel(loadedKind) + ' LOADING (' + minT.toFixed(1) + 's)');
    return;
  }
  /* AI still uses only its stock SAM and keeps the existing in-flight cap. */
  if (!p.isPlayer) {
    var _aaInFlight = 0;
    for (var _fi = 0; _fi < airborneMissiles.length; _fi++) if (airborneMissiles[_fi].owner === p) _aaInFlight++;
    if (_aaInFlight >= AA_AI_MSL_INFLIGHT) return;
  }
  if (!p._heliMissileCooldown || p._heliMissileCooldown <= 0) {
    p._heliMissileCooldown = p.isPlayer ? 0.20 : AA_AI_MSL_INTERVAL;
    var fireSide = 0;
    if (leftReady && rightReady) {
      fireSide = (p._heliMissileNextSide != null) ? p._heliMissileNextSide : 0;
      p._heliMissileNextSide = 1 - fireSide;
    } else if (leftReady) { fireSide = 0; p._heliMissileNextSide = 1; }
    else { fireSide = 1; p._heliMissileNextSide = 0; }

    // Guidance/target allocation remains unchanged; only the loaded projectile
    // spec now follows _aaReloadKind through heliMslTypeOf().
    var mSpec = HELI_MSL_SPEC[heliMslTypeOf(p)];
    var target = null;
    var aaTgt = p.ai && p.ai.aaTgt && p.ai.aaTgt.alive ? p.ai.aaTgt : null;
    if (aaTgt && typeof isHeliVehicle === 'function' && !isHeliVehicle(aaTgt)) target = aaTgt;
    else if (p.team === 'red' && typeof allocateGuidedFireTarget === 'function') target = allocateGuidedFireTarget(p, mSpec);
    fireAAMissile(p, fireSide, target);

    var tubeFired = p._heliMslTube[fireSide] | 0;
    p._heliMslTube[fireSide] = tubeFired + 1;
    p._heliMslRounds[fireSide] = Math.max(0, p._heliMslRounds[fireSide] - 1);
    var rTime = heliMslReloadTimeOf(p);
    if (p._heliMslRounds[fireSide] <= 0) {
      if (fireSide === 0) p._heliMissileReloadTL = rTime; else p._heliMissileReloadTR = rTime;
      if (p.isPlayer && typeof aimHint === 'function') aimHint((fireSide === 0 ? 'L' : 'R') + ' ' + aaWeaponLabel(loadedKind) + ' RACK EMPTY - LOADING (' + rTime.toFixed(0) + 's)');
    }

    /* Once both sides are empty, the current cycle is over and the selected
       kind becomes the kind loaded by the next synchronized cycle. */
    if (p._heliMslRounds[0] <= 0 && p._heliMslRounds[1] <= 0) {
      p._aaReloadKind = nextKind;
      if (!(p._heliMissileReloadTL > 0)) p._heliMissileReloadTL = rTime;
      if (!(p._heliMissileReloadTR > 0)) p._heliMissileReloadTR = rTime;
    }
    p._heliMissileLeft = p._heliMslRounds[0] + p._heliMslRounds[1];
  }
}

/* 玩家载具不可移动态(触发器消费:摇杆按下/WASD 按下沿查一次,非逐帧):
   发动机毁=停机 / 油箱毁=断油 / 双履带断=瘫痪 */
function playerImmobile() {
  if (isHeliVehicle(player)) {
    return player.mods.engine.hp <= 0 || player.mods.fuel.hp <= 0 ||
           (player.mods.trackL && player.mods.trackL.hp <= 0);
  }
  return player.mods.engine.hp <= 0 || player.mods.fuel.hp <= 0 ||
         (player.mods.trackL.hp <= 0 && player.mods.trackR.hp <= 0);
}
function playerUpdate(dt) {
  if (!player.alive || !player.isPlayer) return;   // NOPLAYER 观察席是普通 AI(玩家=AI 同数值),不吃人手油门
  if (keys.KeyJ) {
    player._abandonT = (player._abandonT || 0) + dt;
    if (player._abandonT >= ABANDON_CD) {        // 3s 倒数与 AI 弃车同常量(combat.js)
      player._abandonT = 0;
      killTank(player, 'ABANDONED');
      return;
    }
  } else {
    player._abandonT = 0;
  }
  var abandonOn = keys.KeyJ && player.alive;
  if (el && el.abandonring && el.abandontxt) {
    el.abandonring.style.opacity = abandonOn ? '0.95' : '0';
    el.abandontxt.style.opacity = abandonOn ? '1' : '0';
    if (abandonOn) {
      var abandonFrac = Math.min(1, player._abandonT / ABANDON_CD);
      ringConic(el.abandonring, '#ff2d20', abandonFrac, 'rgba(20,20,20,.6)');   // 漫画风:红进度+墨环底(通用进度环写入)
      el.abandontxt.textContent = Math.max(0, ABANDON_CD - player._abandonT).toFixed(1) + 's';
    }
  }
  // 直升机操作模式: WS控制主桨俯仰(±15°)、AD控制主桨横滚(±15°)、QE控制偏航转向、鼠标滚轮控制升力与发动机启停
  if (isHeliVehicle(player)) {
    var fwdIn = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);   // W 前倾(+15°), S 后倾(-15°)
    var latIn = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);   // A 左倾(+桨盘角→机身左倾), D 右倾(桨盘动画/推力/机身滚转同向)
    var turnIn = (keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0);  // Q 左转, E 右转
    if (touchJoyOn) {
      fwdIn = touchJoyY;
      latIn = -touchJoyX;   // 摇杆右推=右倾(与坦克 turnIn=-touchJoyX 同口径;x 右+)
    }
    updateHeli(player, dt, fwdIn, latIn, turnIn, false);

    // 直升机多武器计时与雷达锁定循环
    updateHeliWeapons(player, dt);

    if (mouseDown && player.isPlayer) {
      triggerHeliFire(player);
    }
    tickReload(player, dt);
    reloadCueTick();
    return;
  }

  var fwdIn = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 0.6 : 0);
  var turnIn = (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
  if (touchJoyOn) {                              // 触屏摇杆:模拟量直驱(倒车系数 0.6 与 S 键同源;左推=左转与 A 键同号)
    fwdIn = touchJoyY > 0 ? touchJoyY : touchJoyY * 0.6;
    turnIn = -touchJoyX;
  }
  /* 火箭炮俯视火控视野:WSAD/摇杆 = 平移镜头,不再驾驶载具(车辆原地驻定=发射平台)——
     平移速度 ∝ 相机高度(RTS 同手感),偏移钳在战场边界;镜头中心=车体+偏移(cameraUpdate 取用)。
     屏幕方位:上=北(−Z)、右=东(+X),故 W→−Z、D→+X;摇杆推上=北、推右=东。 */
  if (player.kind === 'arty' && scopeT > 0.5) {
    var panX = touchJoyOn ? touchJoyX : ((keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0));
    var panZ = touchJoyOn ? -touchJoyY : ((keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0));
    var panL = Math.sqrt(panX * panX + panZ * panZ);
    if (panL > 1) { panX /= panL; panZ /= panL; }   // 斜向不加速
    var panRate = Math.min(artyTopCamHeight() * 1.10, 760);   // 平移速度∝高度(用户设定×2:0.55→1.10),封顶 760m/s(2000m 高空防一瞬扫过全图)
    /* Keep the pan offset within a wide numeric guard; cameraUpdate applies the map-bound clamp. */
    var offLim = CONF.bounds * 2;
    player._topCamX = clamp((player._topCamX || 0) + panX * panRate * dt, -offLim, offLim);
    player._topCamZ = clamp((player._topCamZ || 0) + panZ * panRate * dt, -offLim, offLim);
    fwdIn = 0; turnIn = 0;                          // 俯视视野:移动键不驾驶载具
  }
  /* 火箭炮俯视火控蠕行:点选装定后,若预测首发弹着偏离装定点,以低速(≤2.5m/s)接管油门微调车位——
     与驾驶完全同一条「输入→油门→加减速→applyMotion」物理链路(坡度/附着/碰撞全真实),零坐标改写;
     玩家触碰任一镜头平移键 = 蠕行立即让位;齐射中 salvoLock 已切断油门。 */
  if (player.kind === 'arty' && player._artyCreepFwd && !keys.KeyW && !keys.KeyS && !keys.KeyA && !keys.KeyD && !touchJoyOn) {
    fwdIn = clamp(player._artyCreepFwd, -1, 1);
  }

  // 防空载具:多武器计时与雷达锁定循环(与直升机 updateHeliWeapons 同套;RED_AA 雷达常亮,蓝方防空车雷达空转不扫描)
  if (isAAVehicle(player)) updateHeliWeapons(player, dt);

  var sm = speedMult(player), tm = turnMult(player) * slopeTurnMul(player);
  // 火箭炮齐射中车辆锁死(与 AI 同规则:射击时不能移动)
  var salvoLock = player.kind === 'arty' && player.salvoLeft > 0;
  if (salvoLock) { fwdIn = 0; turnIn = 0; }
  var driveInput = (typeof SIM_K === 'undefined' || SIM_K <= 0) ? groundThrottleInertia(player, fwdIn, dt) : fwdIn;
  var target = driveInput * player.speed0 * sm;
  // 加/减速 ∝ 发动机效率(旧 Math.max(sm,0.35) 地板="打不坏的动力",违真实);
  // decel 留 30% 机械刹车地板:发动机/油箱全毁当帧若 decel=0,载具将带余速匀速滑行永不停车(applyMotion 无摩擦项)
  var eEffP = engineEff(player);
  player._throttle = salvoLock ? 0 : fwdIn;
  player._throttleLock = salvoLock ? 1 : 0;
  if (typeof SIM_K === 'undefined' || SIM_K <= 0) player.speed = approachSpeed(player.speed, target, salvoLock ? 0 : player.accel0 * eEffP, player.decel0 * Math.max(eEffP, 0.3), dt);
  /* 车体瞄准(炮塔损毁,旗标由 combat.js 触发器置位——损毁事件/接管瞬间,此处零状态检测):
     鼠标左右(camAimY 世界方位)驱动车体伺服,车头目标=瞄准方位−固定炮塔偏角(炮管指向鼠标;
     与 ai.js 炮塔卡死车体瞄准同机理同钳制 turn0×turnMult×dt);A/D 键输入优先(倒车调头不被抢)。 */
  if (player._hullAim && !turnIn && !salvoLock) {
    var hDiff = normAng(camAimY - (player.turretYaw || 0) - player.yaw);
    var _hyD = clamp(hDiff, -player.turn0 * tm * dt, player.turn0 * tm * dt);
    groundYawInertia(player, dt > 0 ? _hyD / dt : 0, player.turn0 * tm, dt);   // 履带指令带速:带惯性的车体瞄准伺服
  } else {
    groundYawInertia(player, turnIn * player.turn0 * tm, player.turn0 * tm, dt);   // 履带指令带速:带惯性的转向输入
  }

  // 红方歼击车本版已进入常规旋塔伺服;驾驶转向只改车体,炮塔由瞄准循环独立360°跟随。
  applyMotion(player, dt);

  if (mouseDown && player.isPlayer) {
    if (player.kind === 'arty') {
      /* 火箭炮第三人称:停稳 + 装填完毕 → 按住即齐射(齐射中锁死移动);
         俯视火控视野的开火由「点选闩锁 + 挂起窗」在下文 scope 块接管,此处不走按住开火。 */
      if (scopeT <= 0.5) {
        if (player.reload <= 0 && player.salvoLeft <= 0 && player.mods.gun.hp > 0 && Math.abs(player.speed) < 0.8) {
          playerArtyStartSalvo(player);
        } else if (player.mods.gun.hp <= 0) {
          if (typeof aimHint === 'function') aimHint('CANNOT FIRE');   // Launch tube destroyed
        }
        /* 移动中点火静默不响应(齐射须停稳;击杀播报仅载具死亡行,不设文字提示) */
      }
    } else if (isPlayerRedMbtMissileVehicle(player)) {
      triggerRedMbtFire(player);   // MBT-1:当前膛内弹种决定本次发射,选择只决定下一次装填
    } else if (isPlayerRedTdHighExplosiveVehicle(player)) {
      triggerRedTdFire(player);    // RED-TD:当前膛内弹种决定本次发射,1=AP,2=HE
    } else if (isAAVehicle(player)) {
      triggerAAFire(player);   // 防空多武器:1=导弹(多联装交替/独立装填) 2=双联机炮(仅RED_AA)
    } else {
      tryFire(player);
    }
  }

  // —— 玩家火箭炮:火箭弹初速解算(两种模式,均为真实重力弹道,"火雨"式高抛) ——
  if (player.kind === 'arty') {
    if (player.salvoLeft > 0) {
      /* 齐射状态优先级高于视角模式:即使本帧退出炮镜,也只允许相机切换,炮架/俯仰/初速保持首发快照。 */
      playerArtyApplySalvoLock(player, false);
      player._servoHoldT = 0;
    } else if (scopeT > 0.5) {
      // —— 俯视火控视野(Shift 开镜):俯瞰战场,自由光标装定地面点,点哪打哪 ——
      //   发射架伺服:目标方位/仰角(rocketSolve 弹道解)按 1.0/0.9 rad/s 限速实时追踪;
      //   点击闩锁射击任务 → 蠕行微调(真实油门物理)把预测首发弹着压到装定点 → 到位自动齐射。
      var ppA = player.group.position;
      // 点击=炮击那里:按下沿闩锁光标地面点(桌面左键与触屏 #tfire 同走 mouseDown)
      if (mouseDown && !player._topFireWish) {
        if (player.salvoLeft > 0) {
          /* 齐射进行中不接新任务(防误排队) */
        } else if (player.mods.gun.hp <= 0) {
          if (typeof aimHint === 'function') aimHint('CANNOT FIRE');   // Launch tube destroyed
        } else if (player._topHover && isFinite(player._topHover.x)) {
          var dxH = player._topHover.x - ppA.x, dzH = player._topHover.z - ppA.z;
          if (dxH * dxH + dzH * dzH < 35 * 35) {
            if (typeof aimHint === 'function') aimHint('AIM TOO CLOSE, MIN RANGE 35M');   // 防误点自车贴脸齐射
          } else {
          player._topTgt = { x: player._topHover.x, y: player._topHover.y, z: player._topHover.z };
          player._topFireWish = true;
          player._topCreepDist = 0;
          // 边沿装定——闩锁时装一次挂起计时,按住期间不每帧重置(0.7s 宽限 + 0.8s 强制,原纪律不变)
          if (player._servoHoldT == null || player._servoHoldT === 0 || player._servoHoldT <= -0.8) player._servoHoldT = 0.7;
           if (player.reload > 0) { if (typeof aimHint === 'function') aimHint('LOADING - POINT MARKED'); }
          }
        }
      }
      var tgtT = (player._topFireWish && player._topTgt) ? player._topTgt : player._topHover;
      player._artyCreepFwd = 0;                       // 每帧归零:仅蠕行条件成立才写(防残余油门)
      if (tgtT && isFinite(tgtT.x)) {
        var dxT = tgtT.x - ppA.x, dzT = tgtT.z - ppA.z;
        var dR = Math.sqrt(dxT * dxT + dzT * dzT);
        var ly = terrainH(tgtT.x, tgtT.z);
        var solP = rocketSolve(dR, (ppA.y + 2.4) - ly);   // 带高差的精确变速解(与 AI/实弹同一函数)
        // 初速闭环校准系数(updateScopeInfo 的弹道仿真用实测落点微调):吸收炮口前伸/姿态残差
        var aKey = Math.round(dR / 6) * 2048 + (Math.round(Math.atan2(dxT, dzT) * 18) & 1023);
        if (player._artyKey !== aKey) { player._artyKey = aKey; player._artyKv = 1; }
        player._artySol = solP;
        player.rocketV = clamp(solP.v * (player._artyKv || 1), 34, solP.vmax);
        player.artyRange = dR;
        player._artyAz = Math.atan2(dxT, dzT);            // 目标世界方位(调试探针)
        var tyT = normAng(player._artyAz - player.yaw);   // 发射架本地目标方位
        var azErr = normAng(tyT - (player.turretYaw || 0));
        var elErr = solP.theta - (player.gunPitch || 0);
        player.turretYaw += clamp(azErr, -1.0 * dt, 1.0 * dt);
        player.gunPitch = clamp((player.gunPitch || 0) + clamp(elErr, -0.9 * dt, 0.9 * dt), -0.1, 1.05);
        playerArtySyncMount(player, true);                // 同帧写实体+世界矩阵(光标移动,发射架实时跟随)
        player._artyAim = { x: tgtT.x, y: ly, z: tgtT.z, d: dR,
          tof: 2 * player.rocketV * Math.sin(solP.theta) / CONF.gravity,
          thetaT: solP.theta, reach: solP.reach,
          settled: Math.abs(azErr) < 0.02 && Math.abs(elErr) < 0.03,
          loose: Math.abs(azErr) < 0.06 && Math.abs(elErr) < 0.08 };   // 放行用宽阈
        if (player._topFireWish && !solP.reach) { if (typeof aimHint === 'function') aimHint('OUT OF RANGE'); }
        /* —— 蠕行微调(仅点击装定后):预测首发弹着(10Hz 弹道仿真 scopeInfo.point)与装定点的
           纵向误差折算低速油门(≤2.5m/s ≈ 极速 1/3),累计行程 ≤40m(小范围约束);
           伺服未收敛(settled 未达)时不蠕行——仿真弹着此时不代表装定解,先等发射架锁到位。 */
        if (player._topFireWish && player.salvoLeft <= 0 && player._artyAim.settled && scopeInfo.point &&
            player._topCreepDist < 40 && Math.abs(player.speed) < 3.2 &&
            player.reload <= 0 && player.mods.gun.hp > 0) {
          var cxErr = scopeInfo.point.x - tgtT.x, czErr = scopeInfo.point.z - tgtT.z;
          var errLen = Math.sqrt(cxErr * cxErr + czErr * czErr);
          var fxU = Math.sin(player.yaw), fzU = Math.cos(player.yaw);
          var errAlong = cxErr * fxU + czErr * fzU;       // >0 = 预测弹着越过装定点(车头方向)
          if (errLen > 6 && Math.abs(errAlong) > 4) {
            var vC = clamp(-errAlong * 0.8, -2.5, 2.5);
            player._artyCreepFwd = vC / Math.max(0.5, player.speed0 * speedMult(player));
            player._topCreepDist += Math.abs(vC) * dt;
          }
        }
      } else {
        player._artyAim = null;
      }
      // 扳机挂起:瞄准到位瞬间自动发起齐射(与 AI"SALVO/COUNTER"门控完全同一条纪律)
      if (player._servoHoldT > 0) {
        // 挂起窗 0.7s:到位(settled/loose)+停稳即射;走完未射 → 置 -0.001 进强制窗
        player._servoHoldT -= dt;
        if (player.reload <= 0 && player.salvoLeft <= 0 && player.mods.gun.hp > 0 && Math.abs(player.speed) < 0.8 &&
            player._artyAim && (player._artyAim.settled || player._artyAim.loose)) {
          playerArtyStartSalvo(player);
        } else if (player._servoHoldT <= 0) player._servoHoldT = -0.001;
      } else if (player._servoHoldT < 0 && player._servoHoldT > -0.8) {
        // 强制窗 0.8s:车况满足即放行;窗尽未射——任务仍挂着(装填中/蠕行未停)则重挂等待,否则归零
        player._servoHoldT -= dt;
        if (player.reload <= 0 && player.salvoLeft <= 0 && player.mods.gun.hp > 0 && Math.abs(player.speed) < 0.8) {
          playerArtyStartSalvo(player);
        } else if (player._servoHoldT <= -0.8) player._servoHoldT = player._topFireWish ? 0.7 : 0;
      }
    } else {
      // 第三人称:准星=炮管朝向;按实测炮管世界仰角 + 精确高差解算初速,
      // 弹着正好落在炮管视线与地形/目标的交点(坡地车身姿态已含在实测方向里)
      player._artyAz = null;
      player._artyAim = null;
      player._topFireWish = false; player._topTgt = null; player._artyCreepFwd = 0;   // 退镜:撤销点选射击任务与蠕行油门
      player._artyT = (player._artyT || 0) - dt;
      if (player._artyT <= 0) {
        player._artyT = 0.15;
        var dP2 = new THREE.Vector3(); player.gunPivot.getWorldDirection(dP2);
        var mP = artyBoreOrigin(player, dP2);                            // 第三人称瞄准原点=真实出膛原点(中轴线)
        var dd2 = laserRange(mP, dP2);
        var bElT = Math.asin(clamp(dP2.y, -1, 1));
        // 第三人称标定上限扩展至 maxRange(40000),初速上限支持 660m/s
        if (!isFinite(dd2) || dd2 > artyConfOf(player).maxRange || bElT < 0.035) { player.rocketV = artyConfOf(player).rocketSpeed; }
        else {
          var hx2 = mP.x + dP2.x * dd2, hz2 = mP.z + dP2.z * dd2, hy2 = mP.y + dP2.y * dd2;
          var vT = rocketVExact(Math.sqrt((hx2 - mP.x)*(hx2 - mP.x)+(hz2 - mP.z)*(hz2 - mP.z)), mP.y - hy2, bElT);
          player.rocketV = clamp(isFinite(vT) ? vT : artyConfOf(player).rocketSpeed, 34, 660);
        }
      }
    }
  }

  // 玩家火箭炮:齐射推进(与 AI 同节奏——锁车停稳后按间隔放完全部火箭(RED_MLRS 40 发/BLUE_MLRS 6 发),随后长装填(40s/12s);
  // salvoLeft 必须在此清零,否则打不出弹且锁死移动)
  if (player.kind === 'arty' && player.salvoLeft > 0) {
    playerArtyApplySalvoLock(player, false);
    if (player.mods.gun.hp <= 0) {                         // 齐射中定向管被毁:立即解锁,避免永久卡在 salvoLeft>0
      player.salvoLeft = 0;
      playerArtyEndSalvoLock(player);
    } else {
      player.salvoT -= dt;
    }
    if (player.salvoLeft > 0 && player.salvoT <= 0 && Math.abs(player.speed) < 0.8) {
      player.salvoT = artyConfOf(player).salvoGap;
      player.salvoLeft--;
      /* 发射前强制同步锁定姿态的世界矩阵;所有发次只允许 fireShell 内部初速向量散布,炮架绝不逐发重瞄。 */
      playerArtySyncMount(player, true);
      // 第 1 发零扰动(disp=false)——红点=首发实际落点(铁律);
      // 第 2 发起与 AI 同款真物理散布:初速向量方位±2°/纵向±2.9° + 初速 ±1.2% 扰动,发射架全程不动
      fireShell(player, player.salvoLeft < artyConfOf(player).salvo - 1);
      if (player.salvoLeft <= 0) {
        player.reload = player.reloadTime;
        playerArtyEndSalvoLock(player);
      }
    }
  }

  tickReload(player, dt);
  reloadCueTick();
}

/* ===== 移动 / 地形贴合 / 碰撞 ===== */
/* Integrate the ground vehicle's world velocity separately from its target
   heading.  This is the missing layer between a desired track speed and actual
   motion: when the hull turns, the velocity vector cannot rotate in one frame. */
var _groundMotionV = { x: 0, z: 0 };
function groundMotionVelocity(t, desiredX, desiredZ, dt) {
  var cx = isFinite(t._motionVx) ? t._motionVx : 0;
  var cz = isFinite(t._motionVz) ? t._motionVz : 0;
  var priorCx = cx, priorCz = cz;
  var dx = desiredX - cx, dz = desiredZ - cz;
  var d = Math.sqrt(dx * dx + dz * dz);
  if (d > 1e-7 && dt > 0) {
    var same = cx * desiredX + cz * desiredZ >= 0;
    var rate = same ? Math.max(3.5, (t.accel0 || 2.5) * 2.0) : Math.max(6.0, (t.decel0 || 5) * 1.25);
    var step = Math.min(d, rate * dt);
    cx += dx / d * step;
    cz += dz / d * step;
    if (!same && priorCx * cx + priorCz * cz < 0) { cx = 0; cz = 0; }   // reverse through neutral, never through a velocity snap
  } else if (d <= 1e-7) {
    cx = desiredX; cz = desiredZ;
  }
  t._motionVx = cx; t._motionVz = cz;
  t._motionAx = dt > 1e-6 ? (cx - priorCx) / dt : 0;
  t._motionAz = dt > 1e-6 ? (cz - priorCz) / dt : 0;
  _groundMotionV.x = cx; _groundMotionV.z = cz;
  return _groundMotionV;
}
function applyMotion(t, dt) {
  if (!isFinite(t.speed) || !isFinite(t.yaw)) { t.speed = 0; return; }
  var fx = Math.sin(t.yaw), fz = Math.cos(t.yaw);
  var p = t.group.position;
  var yawPrev = (t._yawPrev == null) ? t.yaw : t._yawPrev;
  t._yawRate = dt > 1e-6 ? (t.yaw - yawPrev) / dt : 0;
  t._yawPrev = t.yaw;
  if (typeof SIM_K !== 'undefined' && SIM_K <= 0) {
    // —— 街机分支:逐位旧代码(SIM_K=0 回归用,含 M6 vel 口径)——
    var arcVel = groundMotionVelocity(t, fx * t.speed, fz * t.speed, dt);
    var SUB_DT = 0.016, n = Math.max(1, Math.ceil(dt / SUB_DT)), stepDt = dt / n;
    for (var s = 0; s < n; s++) {
      var forwardMove = (arcVel.x * fx + arcVel.z * fz) * stepDt;
      if (Math.abs(arcVel.x) > 1e-5 || Math.abs(arcVel.z) > 1e-5) {
        var grad = terrainH(p.x + fx, p.z + fz) - terrainH(p.x, p.z);
        var slopeF = clamp(1 - grad * Math.sign(forwardMove) * 0.7, 0.50, 1.05);
        var dx = arcVel.x * stepDt * slopeF, dz = arcVel.z * stepDt * slopeF;
        if (isFinite(dx) && isFinite(dz)) { p.x += dx; p.z += dz; }
      }
    }
    p.x = clamp(p.x, -CONF.bounds, CONF.bounds);
    p.z = clamp(p.z, -CONF.bounds, CONF.bounds);
    if (t === player) {
      var atEdge = (Math.abs(p.x) >= CONF.bounds - 0.05 || Math.abs(p.z) >= CONF.bounds - 0.05);
      onPlayerBoundaryContact(atEdge);
    }
    t.velX = arcVel.x; t.velZ = arcVel.z;
    if (typeof suspDriveLoad === 'function') suspDriveLoad(t, dt);
    return;
  }
  // —— 物理分支:油门已由调用方写入 t._throttle,此处统一裁决 ——
  slopeArbitrate(t, dt);
  var rx = fz, rz = -fx;   // 车体右轴(侧滑分量沿此轴)
  var sv = t._slideV || 0;
  var motionVel = groundMotionVelocity(t, fx * t.speed + rx * sv, fz * t.speed + rz * sv, dt);
  // 子步进运动:拆分为 60Hz(16ms)小步,使帧率波动不影响每帧总移动量
  var SUB_DT2 = 0.016, n2 = Math.max(1, Math.ceil(dt / SUB_DT2)), stepDt2 = dt / n2;
  var ox = p.x, oz = p.z;
  for (var s2 = 0; s2 < n2; s2++) {
    var mvx = motionVel.x * stepDt2, mvz = motionVel.z * stepDt2;
    if (Math.abs(mvx) > 1e-6 || Math.abs(mvz) > 1e-6) {
      var nx2 = p.x + mvx, nz2 = p.z + mvz;
      if (isFinite(nx2) && isFinite(nz2)) { p.x = nx2; p.z = nz2; }
    }
  }
  p.x = clamp(p.x, -CONF.bounds, CONF.bounds);
  p.z = clamp(p.z, -CONF.bounds, CONF.bounds);
  if (t === player) {
    var atEdge2 = (Math.abs(p.x) >= CONF.bounds - 0.05 || Math.abs(p.z) >= CONF.bounds - 0.05);
    onPlayerBoundaryContact(atEdge2);
  }
  var idt = dt > 1e-6 ? 1 / dt : 0;
  t.velX = (p.x - ox) * idt; t.velZ = (p.z - oz) * idt;   // M6 修复:大脑速度=实际位移/时间(含坡度/侧滑)
  if (typeof suspDriveLoad === 'function') suspDriveLoad(t, dt);
}

/* 复用 scratch(热路径,避免每帧 GC;模块私有) */
var _m1 = new THREE.Matrix4();
var _n = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();

/* ===== 滚轮总距操纵 (0%~100% 完整物理行程) =====
   滚轮 1%/格(CTRL 10%/格)调节总距; 熄火时上滚=点火(总距归零平桨, 平桨阻力矩由升速前馈调度携带);
   地面且总距 0% 时下滚=停车; 空中全行程自由调节 (0% 平桨急速下沉/自转下滑, 100% 满总距跃升)。
   本函数只写总距与启停状态, 油门/档位由 updateHeli 每帧反解 */
function heliHandleWheel(deltaY, isCtrl) {
  if (!player || !player.alive || !isHeliVehicle(player)) return;
  var curAlt = player._heliAlt != null ? player._heliAlt : 0;
  var isGround = (curAlt <= 0.12 && Math.abs(player._heliVy || 0) <= 0.40) || !!player._heliGrounded;
  var scrollUp = deltaY < 0;   // 向上滚
  var scrollDown = deltaY > 0; // 向下滚
  var stepBase = isCtrl ? 0.10 : 0.01; // 按住 CTRL 一次调整 10% 桨距,默认 1% (0.01)
  var step = stepBase * Math.max(1, Math.min(3, Math.round(Math.abs(deltaY) / 100)));

  if (player._heliEngineState === 'cutoff') {
    if (scrollUp) {
      // 熄火状态下向上滚动: 发动机点火启动, 总距置于 0% (油门/档位由物理帧统一裁决)
      heliEngineStart(player);
    }
    return;
  }

  var curColl = player._heliCollective != null ? player._heliCollective : 0.0;

  if (scrollUp) {
    // 向上滚动: 增加总距 (0% ~ 100%)
    player._heliCollective = clamp(curColl + step, 0.0, 1.0);
  } else if (scrollDown) {
    // 向下滚动: 降低总距
    if (curColl > 0.005) {
      player._heliCollective = clamp(curColl - step, 0.0, 1.0);
    } else if (isGround) {
      // 在地面且总距已在 0% 时继续向下滚动: 发动机熄火 (复位由物理层统一执行)
      player._heliEngineState = 'cutoff';
      player._heliCollective = 0.0;
    } else {
      player._heliCollective = 0.0;
    }
  }
}

/* ===== 旋翼升速拟真模型 (叶素理论 T∝Ω²; X-Plane/DCS 式扭矩调度 + 调速器) =====
   目标转速曲线 wTgt(tRun)=min(1,(tRun/30)^κ) — 幂函数, 转速本身 5s达60%(=可支撑总距上限)/30s达100%。
   前馈加速度调度 aFF 为曲线的逆解析解 (dw/dt=(κ/30)·w^(1-1/κ)), 起步 w→0 奇点由 AMAX 恒扭矩份额抹平,
   曲线全程平滑 (恒扭矩起步段与幂函数尾段 C¹ 衔接)。 */
function heliSpoolTarget(tRun) {
  if (!(tRun > 0)) return 0;
  if (tRun >= HELI_GOV_RAMP_TIME) return 1.0;
  return Math.pow(tRun / HELI_GOV_RAMP_TIME, HELI_SPOOL_KAPPA);
}
function heliSpoolAccFF(w) {   // w: 归一化转速 (0~1), 返回目标角加速度 (×Ω₀/s)
  if (!(w > 0)) return HELI_SPOOL_AMAX;
  return Math.min(HELI_SPOOL_AMAX, (HELI_SPOOL_KAPPA / HELI_GOV_RAMP_TIME) * Math.pow(w, 1.0 - 1.0 / HELI_SPOOL_KAPPA));
}
function heliCollCap(w) {      // 当前转速能支撑的总距上限 = 转速(恒等刻度: 转速表读数即上限)
  return clamp(w, 0.0, 1.0);
}
/* 发动机点火(总距归零平桨): 玩家轮盘启动与 AI 自启动共用; 油门/档位由 updateHeli 物理帧统一裁决 */
function heliEngineStart(t) {
  t._heliEngineState = 'running';
  t._heliCollective = 0.0;
}
/* 旋翼转速归一化 (Nr 分数, 不钳制): 全链路统一守卫除法, 各消费点按需自行 clamp */
function heliRotorFrac(t, prm) {
  return (t._heliRotorRPM || 0) / prm.rotorOmega0;
}
/* 低转速报警谓词 (阈值单一来源): 总距超上限(拉总距过猛) 或 满可用总距仍托不住机体且已用满可用总距(旋翼真实偏低) ——
   升速期容限内总距操作(总距≤上限)静默: cap 包络本身即"当前转速可支撑的总距", 容限内拉总距是合法操作;
   thrustDeficient 须由调用方预限定为"已用满可用总距 且 满总距仍不足悬停推力" (总距<悬停总距的缓降是合法状态, 非转速故障) */
function heliLowRpmAlarm(collVal, cap, rpmFrac, thrustDeficient) {
  if (collVal > cap + HELI_WARN_GRACE) return true;
  if (thrustDeficient && rpmFrac > 0.05 && rpmFrac < 0.92) return true;
  return false;
}

/* ===== 直升机动力系统: 主桨周期变距(±10°, HELI_CYCLIC_RAD) + 全自由度刚体力矩动力学 ===== */
function updateHeli(t, dt, fwdCmd, latCmd, turnCmd, isAI) {
  if (!t || !t.alive) return;
  if (!(dt > 0)) return;
  var prm = HELI_PARAMS[t.kind] || HELI_PARAMS.wz10;
  var p = t.group.position;
  var fx = Math.sin(t.yaw), fz = Math.cos(t.yaw);

  // ---- 1. 多点地形采样与地面接触面姿态 ----
  var pxF = p.x + fx * prm.zFront, pzF = p.z + fz * prm.zFront;
  var pxR = p.x + fx * prm.zRear,  pzR = p.z + fz * prm.zRear;
  var hF = terrainH(pxF, pzF);
  var hR = terrainH(pxR, pzR);

  var dz = prm.zFront - prm.zRear;
  var groundRestPitch = Math.atan2(hF - hR, dz);
  var groundY = ((hF * (-prm.zRear) + hR * prm.zFront) / dz) - prm.groundOffset;

  var rx = fz, rz = -fx;
  var hL = terrainH(p.x - rx, p.z - rz);
  var hRt = terrainH(p.x + rx, p.z + rz);
  var groundRollSlope = Math.atan2(hL - hRt, 2.0);

  var curAlt = Math.max(0, p.y - groundY);
  t._heliAlt = curAlt;

  var engDead = t.mods && t.mods.engine && t.mods.engine.hp <= 0;
  var fuelDead = t.mods && t.mods.fuel && t.mods.fuel.hp <= 0;
  var tailDead = t.mods && t.mods.trackR && t.mods.trackR.hp <= 0;

  // ---- 2. 真实发动机时序、旋翼升速与雷达通电互锁 ----
  if (t._heliEngineState == null) t._heliEngineState = 'cutoff';
  if (t._heliStartPhaseT == null) t._heliStartPhaseT = 0;
  if (t._heliGovRunT == null) t._heliGovRunT = 0;
  if (t._heliCollCap == null) t._heliCollCap = 0;
  if (t._heliRadarWarmup == null) t._heliRadarWarmup = 0;

  if (isAI && t._heliEngineState === 'cutoff') {
    t._heliStartDelay = (t._heliStartDelay || 0) + dt;
    if (t._heliStartDelay > 0.8) heliEngineStart(t);
  }

  if (engDead || fuelDead || t._heliEngineState === 'cutoff') {
    // 熄火统一复位: 发动机损毁/燃油耗尽强制切断与主动熄火共用同一路径
    t._heliEngineState = 'cutoff';
    t._heliThrottle = 0;
    t._heliPower = 0;
    t._heliStartPhaseT = 0;
    t._heliGovRunT = 0;
    t._heliCollCap = 0;
    t._heliRadarWarmup = Math.max(0, t._heliRadarWarmup - dt * 2.0);
    if (t._heliRadarActive) stopHeliRadarScan(t);
    t._heliGear = 'cutoff';
    t._heliCollective = 0;
  } else if (t._heliEngineState === 'running') {
    if (t._heliStartPhaseT < HELI_ENGINE_START_TIME) {
      t._heliStartPhaseT += dt;
      t._heliThrottle = 0.15;
      t._heliPower = 0.05;
      t._heliGovRunT = 0;
      t._heliCollCap = 0;
      t._heliGear = 'starting';
      t._heliCollective = 0;
    } else {
      if (t._heliRadarWarmup < HELI_RADAR_WARMUP_TIME) {
        t._heliRadarWarmup = Math.min(HELI_RADAR_WARMUP_TIME, t._heliRadarWarmup + dt);
      }
      /* 火控雷达常亮:发动机运转且预热完成后自动开启并保持——玩家与 AI 同规则(AI 直升机雷达常亮)。
         判据改为"就绪即开",不再依赖"跨越阈值那一帧"的边沿,故接管一架预热已满的 AI 直升机时也能正确开启。
         唯一关闭情形=发动机熄火(上方 cutoff 分支已 stopHeliRadarScan);无手动开关。 */
      if (t._heliRadarWarmup >= HELI_RADAR_WARMUP_TIME && !t._heliRadarActive) {
        startHeliRadarScan(t);
      }

      if (t._heliGovRunT < HELI_GOV_RAMP_TIME) {
        t._heliGovRunT = Math.min(HELI_GOV_RAMP_TIME, t._heliGovRunT + dt);
      }
      // 总距上限(_heliCollCap)改由旋翼 ODE 段按实际转速回写 (cap=转速), 此处不再按时间脚本赋值

      var collVal = t._heliCollective != null ? t._heliCollective : 0.0;
      var reqThr = prm.govP + (collVal - prm.collHover) * 0.9;
      t._heliThrottle = Math.max(0.15, Math.min(1.20, reqThr));

      var collN = clamp(collVal, 0, 1);
      var ramp = (t._heliCollCap != null ? t._heliCollCap : 0);
      var limitPwr = Math.max(0.1, ramp * (1.15 - 0.40 * collN * (1.0 - ramp)));
      t._heliPower = Math.min(limitPwr, t._heliThrottle);
    }
  }

  var cap = 0;   // 当前转速能支撑的总距上限 (cap=转速, 旋翼ODE段按实际转速刷新)

  // ---- 3. 旋翼转速动力学 ODE (前馈扭矩调度+调速器反馈 vs 气动阻力矩) ----
  var w0 = prm.rotorOmega0;
  if (t._heliRotorRPM == null) t._heliRotorRPM = 0;

  if (t._heliEngineState === 'cutoff') {
    var wNormC = t._heliRotorRPM / w0;
    var aeroDrag = HELI_AERO_Q0 * 0.75 * wNormC * wNormC * prm.driveTorqueMax;   // 风车阻力 = 75% 平桨份额
    var fricDrag = HELI_FRIC_FRAC * prm.driveTorqueMax;
    var dw = -((aeroDrag + fricDrag) / prm.rotorInertia) * dt;
    t._heliRotorRPM = Math.max(0, t._heliRotorRPM + dw);
    t._heliGear = 'cutoff';
  } else if (t._heliStartPhaseT < HELI_ENGINE_START_TIME) {
    t._heliRotorRPM = 0;
    t._heliGear = 'starting';
  } else {
    var wNorm = t._heliRotorRPM / w0;
    var collFrac = clamp(t._heliCollective != null ? t._heliCollective : 0.0, 0, 1);
    cap = heliCollCap(wNorm);
    var wTgt = heliSpoolTarget(t._heliGovRunT);

    // 超额总距大迎角气动阻力激增 (FAA-H-8083-21B 过度拉总距 / Leishman BEMT):
    // 超出当前转速上限 ⇒ 阻力矩陡增 → 转速真实下垂 → cap(=转速)随之回落 (过度拉总距负反馈)
    var excessColl = Math.max(0, collFrac - cap - HELI_CAP_EPS);
    var dragMult = 1.0 + 3.5 * excessColl + 8.0 * excessColl * excessColl;
    var aeroT = (HELI_AERO_Q0 + HELI_AERO_Q1 * collFrac) * dragMult * wNorm * wNorm * prm.driveTorqueMax;
    var fricT = HELI_FRIC_FRAC * prm.driveTorqueMax;

    var driveT;
    if (wTgt < 1.0 || wNorm < 0.999) {
      // 升速期: 前馈(幂函数曲线逆解析加速度 + 携带上限载荷裕度) + 调速器反馈, 不受油门功率限制
      var loadColl = Math.min(collFrac, cap);
      var qFF = prm.rotorInertia * w0 * heliSpoolAccFF(Math.max(wNorm, 1e-4))
              + (HELI_AERO_Q0 + HELI_AERO_Q1 * loadColl) * wNorm * wNorm * prm.driveTorqueMax + fricT;
      var qGov = HELI_GOV_KP * (wTgt - wNorm) * prm.driveTorqueMax;   // 双向调速: 低于目标补扭追赶, 超出目标收油贴线(超拉恢复后精确回曲线)
      driveT = clamp(qFF + qGov, 0, prm.driveTorqueMax);
    } else {
      // 带速期: 定速调速器(FADEC)恒 Nr, 受油门功率限制 (满功率爬升允许轻微下垂)
      var qHold = (HELI_AERO_Q0 + HELI_AERO_Q1 * collFrac) * wNorm * wNorm * prm.driveTorqueMax + fricT
                + HELI_GOV_KP * (1.0 - wNorm) * prm.driveTorqueMax;
      driveT = clamp(qHold, 0, Math.max(0, t._heliPower || 0) * prm.driveTorqueMax);
    }

    var dw2 = ((driveT - aeroT - fricT) / prm.rotorInertia) * dt;
    t._heliRotorRPM = Math.max(0, Math.min(w0 * 1.15, t._heliRotorRPM + dw2));
    if (t === player && window.__HELI_FIX_RPM) { t._heliRotorRPM = w0; t._heliCollCap = 1.0; }

    // 回写"总距上限"(=转速): 上限随实际转速提高, 超拉下垂时同步回落 (HUD 消费)
    t._heliCollCap = cap;

    if (wNorm < 0.85 || wTgt < 1.0) {
      t._heliGear = 'starting';
    } else {
      t._heliGear = 'normal';
    }
  }

  t._heliTailRotorRPM = t._heliRotorRPM * prm.tailRatio;

  // ---- 4. 旋翼气动升力计算 (cap 包络语义: 上限内总距全额有效, 超上限重度惩罚) ----
  var rpmFrac = t._heliRotorRPM / w0;
  var rotorEff = (t.mods && t.mods.trackL && t.mods.trackL.max > 0) ? clamp(t.mods.trackL.hp / t.mods.trackL.max, 0, 1) : 1;

  // 1. 升力包络: 总距 ≤ cap(=转速, 随升速曲线 60%@5s→100%@30s) 时全额交付 ——
  //    5 秒即可 60% 总距正常起飞(用户规格锚点); 低转速的升力衰减由 cap 包络自身+超限惩罚+转速下垂承担,
  //    不叠加叶片失速曲线(升力衰减由 cap 包络自身+超限惩罚+转速下垂承担)。
  //    自转段保留 Nr²(升力依赖旋翼转速物理)。

  // 2. 超额总距重度气动惩罚 (总距超出当前转速上限 cap=转速; 超出的数额越大惩罚系数呈二次方/高阶急剧恶化;
  //    HELI_CAP_EPS 容差吸收满功率爬升的轻微转速下垂, 与 ODE 段超额阻力矩同口径):
  var collVal = (t._heliCollective != null ? t._heliCollective : 0.0);
  var excessLiftColl = Math.max(0, collVal - cap - HELI_CAP_EPS);
  var overloadPenalty = 1.0 / (1.0 + 12.0 * excessLiftColl + 45.0 * excessLiftColl * excessLiftColl);

  var liftCoef = 0;
  if (t._heliEngineState !== 'cutoff') {
    liftCoef = (collVal / prm.collHover) * rotorEff * overloadPenalty;
  } else {
    liftCoef = (curAlt > 0.2 && (t._heliVy || 0) < -2.0) ? (prm.collAuto / prm.collHover) * 0.6 * rotorEff : 0;
  }

  var ige = 1.0 + 0.08 * Math.max(0, 1.0 - curAlt / 8.0);
  var gWeight = prm.mass * 9.8;
  // 自转(熄火)段保留 Nr²: 升力依赖旋翼转速物理; 动力段升力由 cap 包络承担(见上)
  var thrust = (prm.mass * (9.8 / prm.collHover)) * liftCoef * prm.collHover * (t._heliEngineState === 'cutoff' ? (rpmFrac * rpmFrac) : 1) * ige;

  // 3. 低转速告警 (超上限拉总距 或 满可用总距仍托不住机体; 容限内总距操作静默) (阈值单一来源 heliLowRpmAlarm)
  //    推力不足臂重新定界: 仅当 (a) 飞行员已用满可用总距(coll≥cap−容差) 且 (b) 满可用总距也产生不了悬停推力
  //    (cap·ige<悬停总距 —— 转速真的偏低) 时触发。低于悬停总距(58%)的空中缓降/地效悬停是合法飞行状态:
  //    旧判定 thrust<gWeight 即报警, 把"总距55% < 悬停总距58%"的正常飞行(缓缓起飞爬出地效后)误报为
  //    "转速不足"且长期不消(悬停在地效平衡高度上推力恒差5%), 提到60%即消失、拉回55%又复现。
  var collAtMax = collVal >= cap - HELI_WARN_GRACE;      // 已用满可用总距 ( deficiencies 不再是飞行员选择)
  var maxHoldOk = cap * ige >= prm.collHover;            // 满可用总距能否产生悬停推力 (转速健康度判据)
  var lowRpmWarn = false;
  if (t === player && t._heliEngineState !== 'cutoff') {
    lowRpmWarn = heliLowRpmAlarm(collVal, cap, rpmFrac,
      curAlt > 0.10 && thrust < gWeight && collAtMax && !maxHoldOk);
    if (lowRpmWarn && typeof sfxRpmWarn === 'function') sfxRpmWarn();
  }
  t._heliLowRpmWarn = lowRpmWarn;

  var isGrounded = curAlt <= 0.08 && Math.abs(t._heliVy || 0) <= 0.35 && thrust < gWeight;
  t._heliGrounded = isGrounded;

  // ---- 5. 主桨周期变距倾角响应 (A 键左倾, D 键右倾) ----
  var cyclicAuth = clamp(rpmFrac, 0, 1);
  var tgtRotorPitch = fwdCmd * HELI_CYCLIC_RAD;
  var tgtRotorRoll  = (latCmd || 0) * HELI_CYCLIC_RAD;

  t._heliRotorTiltPitch = (t._heliRotorTiltPitch || 0) + (tgtRotorPitch - (t._heliRotorTiltPitch || 0)) * Math.min(1.0, dt * HELI_TILT_RESP);
  t._heliRotorTiltRoll  = (t._heliRotorTiltRoll  || 0) + (tgtRotorRoll  - (t._heliRotorTiltRoll  || 0)) * Math.min(1.0, dt * HELI_TILT_RESP);

  // ---- 6. 刚体力矩动力学 ----
  var torquePitch = -t._heliRotorTiltPitch * HELI_TORQUE_P * cyclicAuth;
  var torqueRoll  = -t._heliRotorTiltRoll  * HELI_TORQUE_R * cyclicAuth;

  var dampPitch = (t._heliPitchRate || 0) * HELI_RATE_DAMP;
  var dampRoll  = (t._heliRollRate  || 0) * HELI_RATE_DAMP;

  // ---- 7. 偏航控制 ----
  var torqueYaw = -prm.torqueYawK * (prm.rotorDir || 1) * rpmFrac * rpmFrac * (liftCoef || 0.1);
  var tailFrac = tailDead ? 0 : clamp(t._heliTailRotorRPM / prm.tailOmega0, 0, 1.15);
  var LWS_AUTO_TRIM = 1.0;
  var tailYaw = tailFrac * (-torqueYaw * LWS_AUTO_TRIM + turnCmd * prm.tailAuthK * 6.0);
  var yawAccel = torqueYaw + tailYaw - (t._heliYawRate || 0) * HELI_YAW_DAMP;

  if (isGrounded) {
    t._heliPitch = groundRestPitch;
    t._heliRoll = groundRollSlope;
    t._heliPitchRate = 0; t._heliRollRate = 0;
    t._heliYawRate = turnCmd * prm.turnRate * tailFrac * 0.55;
    t.yaw = normAng(t.yaw + t._heliYawRate * dt);
    _eulHeli.set(-t._heliPitch, t.yaw, t._heliRoll, 'YXZ');
    t.group.quaternion.setFromEuler(_eulHeli);
  } else {
    t._heliPitchRate += (torquePitch - dampPitch) * dt;
    t._heliRollRate  += (torqueRoll  - dampRoll)  * dt;
    t._heliYawRate   += yawAccel * dt;
    t._heliYawRate   = clamp(t._heliYawRate, -prm.turnRate * 2.0, prm.turnRate * 2.0);

    var dRotX = t._heliPitchRate * dt;
    var dRotY = t._heliYawRate * dt;
    var dRotZ = t._heliRollRate * dt;
    _eulHeli.set(-dRotX, dRotY, dRotZ, 'YXZ');
    _qAim.setFromEuler(_eulHeli);
    t.group.quaternion.multiply(_qAim).normalize();

    _f.set(0, 0, 1).applyQuaternion(t.group.quaternion);
    _n.set(0, 1, 0).applyQuaternion(t.group.quaternion);
    _r.set(1, 0, 0).applyQuaternion(t.group.quaternion);

    if (_f.x * _f.x + _f.z * _f.z > 1e-4) {
      t.yaw = Math.atan2(_f.x, _f.z);
    } else {
      t.yaw = Math.atan2(-_n.x, -_n.z);
    }
    t._heliPitch = Math.asin(clamp(_f.y, -1, 1));
    t._heliRoll = Math.atan2(_r.y, _n.y);
  }

  // ---- 8. 三维推力矢量变换 ----
  // 横滚推力取 +sin(倾角):正值桨盘角=机身左倾(本函数力矩段),推力须同向指向机体左侧——
  // 与俯仰通道同构(W 前倾 + 推力向前)。★符号写反会出现"左倾机身却向右漂移",
  // 且与 AI 制导/改出模拟的"推力随机体滚转倾斜"假设(evaluateHeliRecoveryEnv tWorldX)反向。
  var tLocX =  thrust * Math.sin(t._heliRotorTiltRoll);
  var tLocY =  thrust * Math.cos(t._heliRotorTiltPitch) * Math.cos(t._heliRotorTiltRoll);
  var tLocZ =  thrust * Math.sin(t._heliRotorTiltPitch);

  var T_world = _vAim.set(tLocX, tLocY, tLocZ).applyQuaternion(t.group.quaternion);
  var T_worldX = T_world.x, T_worldY = T_world.y, T_worldZ = T_world.z;

  var vx = t._heliVx || 0, vy = t._heliVy || 0, vz = t._heliVz || 0;
  var F_dragX = -prm.dragKH * vx * Math.abs(vx);
  var F_dragZ = -prm.dragKH * vz * Math.abs(vz);
  var F_dragY = -prm.dragKV * vy * Math.abs(vy);

  var F_netX = T_worldX + F_dragX;
  var F_netY = T_worldY + F_dragY - gWeight;
  var F_netZ = T_worldZ + F_dragZ;

  var invMassEff = 2.0 / prm.mass;

  if (isGrounded) {
    p.y = groundY;
    t._heliVy = 0;
    t._heliVx = vx * Math.max(0, 1 - dt * 12.0);
    t._heliVz = vz * Math.max(0, 1 - dt * 12.0);
  } else {
    t._heliVx = vx + F_netX * invMassEff * dt;
    t._heliVz = vz + F_netZ * invMassEff * dt;
    t._heliVy = vy + F_netY * invMassEff * dt;
    p.x += t._heliVx * dt;
    p.z += t._heliVz * dt;
    p.y += t._heliVy * dt;
    var bLim = CONF.bounds - 5;
    p.x = clamp(p.x, -bLim, bLim);
    p.z = clamp(p.z, -bLim, bLim);
    if (t === player) {
      var atEdgeH = (Math.abs(p.x) >= bLim - 0.05 || Math.abs(p.z) >= bLim - 0.05);
      onPlayerBoundaryContact(atEdgeH);
    }
  }

  // ---- 9. 触地冲击 ----
  if (p.y <= groundY) {
    p.y = groundY;
    var vyImp = Math.abs(t._heliVy || 0);
    terrainNormal(p.x, p.z, _n);
    var vDotN = -((t._heliVx || 0) * _n.x + (t._heliVy || 0) * _n.y + (t._heliVz || 0) * _n.z);
    var impactV = Math.max(vyImp, vDotN > 0 ? vDotN : 0);
    var attFactor = 1.0 + 1.2 * Math.max(0, Math.abs(t._heliPitch - groundRestPitch) - 0.45)
                      + 1.2 * Math.max(0, Math.abs(t._heliRoll - groundRollSlope) - 0.45);
    var effV = impactV * attFactor;
    if (effV > HELI_SAFE_TOUCH && vyImp > 1.0) {
      var over2 = (effV - HELI_SAFE_TOUCH) / HELI_DMG_SCALE;
      var fallDmg = over2 * over2 * HELI_DMG_PEAK;
      applyModuleDamage(t, 'hull', fallDmg * 0.70, null, p, 0);
      if (Math.abs(t._heliPitch) > 1.1 || Math.abs(t._heliRoll) > 1.1) {
        applyModuleDamage(t, 'trackL', fallDmg * 0.60, null, p, 0);
      }
      if (typeof hitSpark === 'function') {
        _v1.set(p.x, p.y + 0.5, p.z); _v2.set(0, 1, 0);
        hitSpark(_v1, _v2, _v2, 'stop');
      }
      if (typeof sfxArmorStop === 'function') sfxArmorStop(p, 0.9);
      if (!t.alive) return;
    } else if (effV > 2.5) {
      if (typeof sfxArmorStop === 'function') sfxArmorStop(p, 0.3);
    }
    t._heliVy = 0;
    t._heliVx = (t._heliVx || 0) * 0.55;
    t._heliVz = (t._heliVz || 0) * 0.55;
    t._heliPitchRate = 0;
    t._heliRollRate = 0;
    t._heliAlt = 0;
  }

  t.speed = (t._heliVx || 0) * fx + (t._heliVz || 0) * fz;
  t.velX = t._heliVx;
  t.velZ = t._heliVz;

  if (t._heliRotorHitMesh && (t._heliRotorRPM < 6.0 || t._heliEngineState !== 'running' || !t._heliRotorHitMesh._spinning)) {
    var isSpin = (t._heliRotorRPM || 0) > 3.0;
    if (t._heliRotorHitMesh._spinning !== isSpin) {
      t._heliRotorHitMesh._spinning = isSpin;
      var newGeo = isSpin ? (t._heliRotorHitMesh._rotorDiskGeo || t._heliRotorHitMesh.userData._rotorDiskGeo) : (t._heliRotorHitMesh._rotorBladesGeo || t._heliRotorHitMesh.userData._rotorBladesGeo);
      if (newGeo && t._heliRotorHitMesh.geometry !== newGeo) t._heliRotorHitMesh.geometry = newGeo;
    }
  }

  // 旋翼动画
  t._heliRotorAngle = ((t._heliRotorAngle || 0) + t._heliRotorRPM * dt) % TAU;
  t._heliTailRotorAngle = ((t._heliTailRotorAngle || 0) + t._heliTailRotorRPM * dt) % TAU;
  if (t.mainRotorGroup) {
    t.mainRotorGroup.rotation.order = 'XZY';
    t.mainRotorGroup.rotation.x = t._heliRotorTiltPitch;
    // 横滚取负号:正值桨盘角对应机身左倾(力矩 torqueRoll=-tilt×K),桨盘动画须与机身滚转同向
    // (★写成正值会得到"按 A 机身左倾、桨盘却右倾"的反向动画)
    t.mainRotorGroup.rotation.z = -t._heliRotorTiltRoll;
    t.mainRotorGroup.rotation.y = t._heliRotorAngle;
  }
  if (t.tailRotorGroup) t.tailRotorGroup.rotation.x = t._heliTailRotorAngle;

  // 下洗流扬尘 FX3:有效高度 50m;尘量=距离拉伸(50/22,近密远稀)×转速百分比(只用转速不用总距,100%钳顶)
  var _dwRpm = t._heliRotorRPM || 0;
  if (curAlt > 0.05 && curAlt < 50 && t._heliEngineState !== 'cutoff' && _dwRpm > 0.5) {
    t._downwashT = (t._downwashT || 0) - dt;
    if (t._downwashT <= 0) {
      var _hdS = 50 / 22;
      var _dwFrac = Math.min(1, _dwRpm / prm.rotorOmega0);   // 转速百分比 0~1(超速钳1;与总距无关)
      var dwInterval = curAlt < 6.0 * _hdS ? 0.015 : (curAlt < 12.0 * _hdS ? 0.027 : 0.053);
      t._downwashT = dwInterval * (1.15 - 0.85 * _dwFrac) / Math.max(0.3, _dwFrac);
      var rA = Math.random() * Math.PI * 2, rD = (1.0 + Math.random() * (3.5 + curAlt * 0.45 / _hdS)) * (0.6 + 0.4 * _dwFrac);
      var dX = p.x + Math.cos(rA) * rD, dZ = p.z + Math.sin(rA) * rD;
      var dY = terrainH(dX, dZ);
      if (typeof comicGroundDust === 'function') {
        comicGroundDust(dX, dY, dZ, curAlt < 4.5 * _hdS && Math.random() < 0.35 * _dwFrac);
      }
    }
  }
}

/* 直升机贴地对齐: 仅在完全停机(无升力/无垂速)时贴合坡面, 只写 _heliPitch/_heliRoll 状态量,
   姿态写入权由 updateHeli 独占(rotation 每帧由物理解算统一写,两处并行强写会互打架)。
   注意: 本处 groundRestPitch 含 prm.restPitch 停放仰角, 与 updateHeli 的接地姿态算法存在差异(历史行为)。 */
function alignHeli(t, dt) {
  if (t._heliFalling) return;                                          // 空中坠落残骸:由 stepHeliFallingWrecks 完全接管物理下落与翻滚,绝不提前贴地!
  if (t._heliAlt != null && t._heliAlt > 0.06) return;                 // 已离地:完全不干预
  if (Math.abs(t._heliVy || 0) > 0.05) return;                         // 有垂直速度:物理接管
  var prm = HELI_PARAMS[t.kind] || HELI_PARAMS.wz10;
  var p = t.group.position;
  var fx = Math.sin(t.yaw), fz = Math.cos(t.yaw);
  var rx = fz, rz = -fx;
  var hF = terrainH(p.x + fx * prm.zFront, p.z + fz * prm.zFront);
  var hR = terrainH(p.x + fx * prm.zRear, p.z + fz * prm.zRear);
  var hL = terrainH(p.x - rx, p.z - rz), hRt = terrainH(p.x + rx, p.z + rz);
  var dz = prm.zFront - prm.zRear;
  var groundRestPitch = prm.restPitch + Math.atan2(hF - hR, dz);
  var groundRollSlope = Math.atan2(hL - hRt, 2.0);
  var groundY = (hF * (-prm.zRear) + hR * prm.zFront) / dz - prm.groundOffset;
  p.y = groundY;
  // 写状态量(不直接写 group.rotation):updateHeli 下一帧据此收敛并写入矩阵
  t._heliPitch = groundRestPitch;
  t._heliRoll = groundRollSlope;
  t._heliPitchRate = 0;
  t._heliRollRate = 0;
  t._heliAlt = 0;
  t.group.rotation.order = 'YXZ';
  t.group.rotation.y = t.yaw;
  t.group.rotation.x = -groundRestPitch;
  t.group.rotation.z = groundRollSlope;                                // 保留坡面滚转
}
// 车体高度与姿态贴合地形(所有坦克每帧执行)
function alignTank(t, dt) {
  if (isHeliVehicle(t)) { alignHeli(t, dt); return; }
  var p = t.group.position;
  /* 地形姿态目标 15Hz 重采样(5 次高度场采样是 coll 段主体);
     目标位/目标四元数缓存,每帧仍走同时间常数(dt*9)的 lerp/slerp 逼近,连续性零感知(RTS 式 sim 降频)。
     静止触发器:位置逐位相等+朝向未变+弹坑纪元未变 ⇒ 贴地目标必然不变(严格恒等,非近似),
     跳过全部采样——判据用位置而非速度,天然涵盖碰撞推挤/残骸挤压等一切位移来源。 */
  t._alT = (t._alT || 0) - dt;
  if (t._alT <= 0) {
    t._alT = (t.isPlayer || t === player) ? 0 : 0.066;
    if (!(p.x === t._alX && p.z === t._alZ && t.yaw === t._alYw && t._alEp === dentEpoch)) {
      t._alX = p.x; t._alZ = p.z; t._alYw = t.yaw; t._alEp = dentEpoch;
      /* 前馈:采样点沿速度前移 v×vk(低通 τ=1/9≈0.111s + 采样期一半 0.033s),
         抵消滞后——车到达时姿态恰好收敛到该处目标(26° 坡实测平均插入 0.25→0.02m)。
         玩家车物理定步长全频刷新,前馈缩短至 0.04s,彻底消除坑缘/坡脊采样跳跃引起的姿态相机卡顿。
         残骸无速度语义(velX 为阵亡瞬间残值),前馈仅活车启用。 */
      var vk = t.alive ? ((t.isPlayer || t === player) ? 0.04 : 0.144) : 0;
      var sx = p.x + (t.velX || 0) * vk, sz = p.z + (t.velZ || 0) * vk;
      var fxv = Math.sin(t.yaw), fzv = Math.cos(t.yaw);
      /* 双端支撑(5 采样,与旧口径 terrainH+terrainNormal 净零):
         前后 ±2.6m 弦定俯仰、左右 ±1.3m 弦定横滚——弦长≈履带触地尺度,
         天然滤掉格距级小起伏,又能感知 7m 刚体真实骑跨;
         高度=max(纵弦中点,中心)——跨凸脊时弦中点高于中心,车体被脊线托住不再下沉。 */
      var hf = terrainH(sx + fxv * 2.6, sz + fzv * 2.6);
      var hb = terrainH(sx - fxv * 2.6, sz - fzv * 2.6);
      var hr = terrainH(sx + fzv * 1.3, sz - fxv * 1.3);
      var hl = terrainH(sx - fzv * 1.3, sz + fxv * 1.3);
      var hc = terrainH(sx, sz);
      var sF = (hf - hb) / 5.2, sR = (hr - hl) / 2.6;   // 纵/横弦坡度(dh/dm);姿态与轮位去趋势同源
      /* Suspension load transfer is produced by the real ground-motion
         acceleration/yaw path in suspUpdate.  Apply it to chassis pose only;
         keep the terrain residual used by the wheel-contact height solver pure,
         otherwise acceleration would fake a terrain slope and alter ride height. */
      var _drivePoseF = 0, _drivePoseR = 0;
      if (t._suspLoad) {
        _drivePoseF = Math.tan(Math.max(-0.16, Math.min(0.16, Number(t._suspLoad.pitch) || 0)));
        _drivePoseR = Math.tan(Math.max(-0.18, Math.min(0.18, Number(t._suspLoad.roll) || 0)));
      }
      var _poseF = sF + _drivePoseF, _poseR = sR + _drivePoseR;
      /* 【贴地高度:履带线包络取 max】(2026-09-09)
         旧式 max((hf+hb)/2, hc) 只采【车体中线】3 点(前/中/后 ±2.6m),弦长 5.2m 远小于
         弹坑尺度(2km 图爆半径 22m 的弹坑口径达 28m):
           · 整车落坑内 → 3 点全在坑底,读感"开上去和平地一样";
           · 坑壁是凹曲面 → (hf+hb)/2 落在弦下方,履带埋进坑壁(实测单坑 458mm、5 发叠加 1546mm);
           · 高度完全不采左右履带线(±trkX) → 横向骑跨坑缘时车沉在中线低处。
         改为沿【左右两条履带接地线】各取前/中/后共 6 点求 max —— 履带压在哪就以哪为准,
         与业界"多点支撑 + 按履带线布点"的通行做法一致(Bullet 论坛 tracked-vehicle 讨论:
         应映射轮-地接触边界的凸区域,而非车体中线)。
         ★实测:弹坑区平均下陷 255.7→4.9mm(-98%),边缘坡环 307.5→0.0mm;
           而平地与自然起伏的高度变化恒为 0.0mm(不会把车架高),仅在真正需托举处生效。
         ★姿态(sF/sR/_n)沿用中线弦,不动 —— 实测俯仰误差仅 ±1°,本就正确。 */
      var _gk = suspKeyOf(t.team, t.kind);
      if (_gk) {
        /* ★车体高度取【各负重轮去趋势地面高的均值】,而不是包络最高点。
           这一条极其关键:车体 y 是悬挂物理的【输入基准】—— suspUpdate 用
           pen = 地面 − 轮底 判断每个轮是被压缩还是悬空。
           若这里取 max(包络最高点),车体被抬到最高轮的高度,其余所有轮
           pen 全为负 ⇒ 全部判定悬空 ⇒ 扭杆无罚力 ⇒ 摆角一齐落到下限位,
           履带变成"一块毫无反应的铁板"(实测弹坑区 10 轮 0压/10空)。
           取均值后各轮 pen 有正有负(实测弹坑区恒为 5压/5空),悬挂真正吞吐起伏;
           而履带最高处的穿模由【悬挂压缩行程】吸收(可缩 307mm,远大于弹坑起伏),
           这也正是真车的工作方式:车体高度是悬挂受力的结果,不是几何包络的结果。
           ★平地上 10 轮地面等高,均值 = 该高度,pen 恒为 0 —— 与旧口径逐位一致。 */
        var _gsp = SUSP_SPEC[_gk];
        var _gw = _gsp.physicsTrkX || _gsp.trkX, _gn = _gsp.n;
        var _grx = fzv, _grz = -fxv;                     // 车体右向量(水平正交单位系)
        /* 【托底钳制:必须在俯仰系/去趋势后求值】悬挂总行程有限(t59 仅 363mm),
           而弹坑在一辆车范围内的落差可达 1~2m。行程用尽后,真车会「托底」
           (bellying out)——车体被地面直接顶起来,而非继续下陷。
           旧式用轮位【世界高度】直接比较车体局部行程:平面陡坡的上坡轮天然更高,
           会被误判成深坑而把整车顶起(纵坡 30° 实测顶升约 0.66m)。
           这里先用与姿态同源的 sF/sR 减去含中心高的局部平面:平面坡的残差全为零,
           钳制恒不啮合;真凹坑/坑缘的相对起伏保留,行程外保护仍在。
           单次轮位采样同时累加均值与钳制,采样量减半。 */
        var _gwbMax = _gsp.pivY - SUSP_ARM_L * Math.cos(Math.PI / 2) - _gsp.rc;   // 压到底轮底(车体局部)
        var _planeC = (hf + hb) * 0.5;               // 与姿态弦同源的采样中心平面高
        var _gsum = 0, _gfloor = -1e9, _gi, _gj, _gwz, _gsw, _gh, _gh2;
        for (_gj = 0; _gj < 2; _gj++) {
          _gsw = _gj ? _gw : -_gw;
          for (_gi = 0; _gi < _gn; _gi++) {
            _gwz = _gsp.wz[_gi];
            _gh = terrainH(sx + fxv * _gwz + _grx * _gsw, sz + fzv * _gwz + _grz * _gsw) - (_planeC + sF * _gwz + sR * _gsw);
            _gsum += _gh;
            _gh2 = _gh - _gwbMax - _gsp.lift;
            if (_gh2 > _gfloor) _gfloor = _gh2;      // 该轮要求的车体最低高度(平面系残差)
          }
        }
        var _gavg = _gsum / (_gn * 2);
        t._ty = _planeC + (_gavg > _gfloor ? _gavg : _gfloor);
      } else {
        t._ty = Math.max((hf + hb) * 0.5, hc);           // 非履带车(arty/heli)沿用旧口径
      }
      // sF/sR 已在上方采样后求值,与履带高度去趋势同源。
      _n.set(-_poseF * fxv - _poseR * fzv, 1, -_poseF * fzv + _poseR * fxv).normalize();   // 地形法线 + 加速俯仰/转向横滚姿态
      _f.set(fxv, 0, fzv);
      _r.crossVectors(_n, _f).normalize();
      _f.crossVectors(_r, _n).normalize();
      _m1.makeBasis(_r, _n, _f);
      if (!t._qTgt) t._qTgt = new THREE.Quaternion();
      t._qTgt.setFromRotationMatrix(_m1);
    }
  }
  /* 履带车贴地目标补各自 LIFT(与出生点/车库同口径):轮系局部下沉 → 车组抬升后履带外底恰触地;
     亦是悬挂静止角口径 —— φ0 时轮底局部 y = −LIFT,车组抬升后 pen=0。缺此补偿会被 alignTank
     拉回裸地形面 = 整车下沉/履带埋地。 */
  var _tyr = t._ty != null ? t._ty : terrainH(p.x, p.z);
  var _lk = suspKeyOf(t.team, t.kind);
  if (_lk) _tyr += SUSP_SPEC[_lk].lift;
  p.y += (_tyr - p.y) * Math.min(1, dt * 9);
  if (t._qTgt) t.group.quaternion.slerp(t._qTgt, Math.min(1, dt * 9));
  // —— 后坐纵摇:后坐力矩掀车头,正弦半波掀起+阻尼回落;附加在贴地姿态之上(slerp 吸收滞后下实测峰≈3.5° 坦克/4.3° 歼击车,SPY 量测),一次开火一浪 ——
  if (t.recoilZ > 0 && t.alive && t.recT >= 0) {
    var rkAmp = isTD89Vehicle(t) ? 0.026 : (t.kind === 'arty' ? 0.010 : (isHeliVehicle(t) ? 0.002 : 0.021));
    var rkU = Math.min(t.recT, 1.4);
    var rkEnv = (t.recT < 0.085 ? t.recT / 0.085 : Math.exp(-(t.recT - 0.085) / 0.55)) * Math.sin(rkU / 1.4 * Math.PI);
    /* 通用方向后坐——取开火当帧锁定的力分解(recAx=cosθ/recLat=sinθ):
       轴向:cosθ>0 向前开火=掀头后坐+阻尼回弹(旧朝前动画),cosθ<0 朝后开火=反相前冲;
       水平:sinθ 定左右,横滚摇摆方向与力度∝sinθ(右开火右侧抬起/左开火左侧抬起)。 */
    var ax = t.recAx == null ? 1 : t.recAx, lat = t.recLat == null ? 0 : t.recLat;
    t.group.rotateX(-rkAmp * rkEnv * ax);
    t.group.rotateZ(rkAmp * rkEnv * lat * 0.85);
  }
}

/* ===== 碰撞宽相位:20m 网格,O(n) 配对(消耗战后期残骸数百,全对两重循环会拖垮帧率) ===== */
var CG_CELL = 20, collGrid = new Map();
// 活车碰撞格采用跨格增量维护;只有真正越过 20m 格边界才修改桶。
var _collPruneAt = 0;
function collGridRemove(t) {
  if (t._cgKey == null) return;
  var arr=collGrid.get(t._cgKey);
  if (arr) { var i=arr.indexOf(t); if(i>=0) arr.splice(i,1); if(!arr.length) collGrid.delete(t._cgKey); }
  t._cgKey=null;
}
function collGridUpdate(t) {
  var p=t.group.position, key=Math.floor(p.x/CG_CELL)*4096+Math.floor(p.z/CG_CELL);
  if (t._cgKey===key) return;
  collGridRemove(t);
  var arr=collGrid.get(key); if(!arr){arr=[];collGrid.set(key,arr);} arr.push(t); t._cgKey=key;
}
function collGridReset() { collGrid.clear(); _collPruneAt=0; }
function collGridPrune() {
  if(gameT<_collPruneAt) return; _collPruneAt=gameT+1;
  collGrid.forEach(function(arr,key){ for(var i=arr.length-1;i>=0;i--) if(!arr[i].alive) arr.splice(i,1); if(!arr.length) collGrid.delete(key); });
}
var _collObs = [];                    // resolveCollisions 障碍邻域查询 scratch(零分配复用)
var _wreckMoveQueue = [];             // 持久:需障碍/栅栏复查的残骸(被推时入队,复查后离队;跨帧)
/* 统一碰撞解析(残骸之间同样具有碰撞体积)——活车-活车/活车-残骸/残骸-残骸
   三对全部走本函数,同一 split-push 算法:平分重叠、双方各推一半;
   任一为残骸 → 残骸侧统一记账(wreckPushSide);双方均活车且异队 → 互相警觉(bumpFoe)。
   ★A1 活车被推限幅(rubber-banding 根治):玩家冲入敌群时一帧内与 N 辆车配对,
     N 个方向推力无上限直接 += 位置 = "突然位移";每对只推一半 → 下帧仍重叠再推 = 持续抖动。
     治法:每车每帧累计被推量封顶(≈LIVE_PUSH_VMAX m/s),重叠分多帧自然收敛,推挤手感保留。
     残骸侧不设限(被推是物理表现);cap 由活车路径传入,残骸-残骸路径不传(不限)。 */
var LIVE_PUSH_VMAX = 7, LIVE_PUSH_CAP = 0.3;   // 被推速度上限(m/s)与单帧硬顶(m),观感嫌软/嫌硬调此
function collResolvePair(a, b, dx, dz, d, min, cap) {
  var push = (min - d) / 2;
  if (cap > 0) {
    var remA = a.alive ? cap - Math.sqrt((a._pAX || 0)*(a._pAX || 0)+(a._pAZ || 0)*(a._pAZ || 0)) : Infinity;
    var remB = b.alive ? cap - Math.sqrt((b._pAX || 0)*(b._pAX || 0)+(b._pAZ || 0)*(b._pAZ || 0)) : Infinity;
    push = Math.min(push, remA, remB);
    if (push <= 0) return;                        // 双方额度耗尽:本帧不再推,下一帧继续收敛
    if (a.alive) { a._pAX = (a._pAX || 0) + dx / d * push; a._pAZ = (a._pAZ || 0) + dz / d * push; }
    if (b.alive) { b._pAX = (b._pAX || 0) - dx / d * push; b._pAZ = (b._pAZ || 0) - dz / d * push; }
  }
  a.group.position.x += dx / d * push; a.group.position.z += dz / d * push;
  b.group.position.x -= dx / d * push; b.group.position.z -= dz / d * push;
  if (!a.alive) wreckPushSide(a);
  if (!b.alive) wreckPushSide(b);
  if (a.alive && b.alive && areHostile(a, b)) {   // 双方均活车 → 互相警觉
    if (a.ai) { a.ai.bumpFoe = b; a.ai.bumpT = gameT; }
    if (b.ai) { b.ai.bumpFoe = a; b.ai.bumpT = gameT; }
  }
}
function wreckPushSide(w) {          // 残骸被推统一记账(重算矩阵/区标脏/跨格重注册/入队复查)
  w.gDirty = true;
  w._wMovedT = gameT;                // 3A:最后被推时刻(0.5s 叠堆扫描的休眠判据:静止≥5s 免配对)
  wckNoteMoved(w);
  if (w._occMesh) occProxyDrop(w);   // 世界系代理随推动失效——当帧剔除+8 壳新位重注册(无陈旧遮挡窗口)
  if (typeof wclBump === 'function') wclBump();   // 残骸被推=簇世界变动,缓存全失效(跨格重注册在 wreckGridUpdate 内另有 bump)
  wreckGridUpdate(w);
  if (!w._wMove) { w._wMove = true; _wreckMoveQueue.push(w); }
}
var WRECK_EPS = 0.05;                // 残骸-残骸重叠迟滞(m):<5cm 不推,防三体团簇微抖+烘焙抖动
var LIVE_EPS = 0.03;                 // A2 活车配对迟滞(m):<3cm 不推,消"每帧推一半→再重叠→再推"贴身高频微抖(车体半径 2~3m,3cm 不可见)
var _wreckPairT = -99;               // 残骸静态叠堆收敛扫描节流(0.125s×4 片轮转,单具仍 0.5s 一扫)
var _wreckSlice = 0;                 // C2 分帧轮转片索引
function resolveCollisions(dt) {
  var i, j, t, p, dx, dz, min, d;
  var pushCap = Math.min(LIVE_PUSH_CAP, LIVE_PUSH_VMAX * (dt || 0.016));   // 本帧每车被推总量额度
  // 活车碰撞网格跨格增量维护:静止或未跨 20m 格的车辆零桶操作。
  for (i = 0; i < aliveList.length; i++) {
    t = aliveList[i];
    t._ci = i;
    t._pAX = 0; t._pAZ = 0;               // 本帧被推累计账本清零
    collGridUpdate(t);
  }
  collGridPrune();
  // —— 活车碰撞(主循环只遍历 aliveList;残骸彻底隔离,不再进 tanks 主循环)——
  for (i = 0; i < aliveList.length; i++) {
    t = aliveList[i];
    p = t.group.position;
    // 活车 vs 障碍物(空间网格邻域查询,替代全表扫 obstacles)
    var nObs = obstaclesNear(p.x, p.z, t.radius + obstacleMaxR + 2, _collObs);
    for (j = 0; j < nObs; j++) {
      var o = _collObs[j];
      dx = p.x - o.x; dz = p.z - o.z;
      min = t.radius + o.r;
      if (dx > min || dx < -min || dz > min || dz < -min) continue;   // 快速拒绝
      d = Math.sqrt((dx)*(dx)+(dz)*(dz));
      if (d < min && d > 0.01) {
        p.x += dx / d * (min - d); p.z += dz / d * (min - d);
        t.blockedT += 0.1;
      }
    }
    // 活车 vs 活车(动态网格 3×3 邻域)+ 活车 vs 残骸(静态 wreckGrid 3×3 邻域)
    var cx = Math.floor(p.x / CG_CELL), cz = Math.floor(p.z / CG_CELL);
    for (var ix = cx - 1; ix <= cx + 1; ix++) for (var iz = cz - 1; iz <= cz + 1; iz++) {
      var cgKey = ix * 4096 + iz;
      var cell = collGrid.get(cgKey);                 // 活车(动态网格,每帧重建)
      if (cell) for (j = 0; j < cell.length; j++) {
        var t2 = cell[j];
        if (!t2.alive || t2._ci <= t._ci) continue;  // 死亡条目待 1s 清理前不参与活车碰撞
        var p2 = t2.group.position;
        /* 高度门:碰撞是纯 2D 圆盘推挤,升空的直升机会被地面单位横向推开。
           高度差超过接触尺度即视为"空中错身",跳过配对(零型号分支,通用几何判据)。 */
        if (p.y - p2.y > HELI_COLL_VGATE || p2.y - p.y > HELI_COLL_VGATE) continue;
        dx = p.x - p2.x; dz = p.z - p2.z;
        min = t.radius + t2.radius;
        if (dx > min || dx < -min || dz > min || dz < -min) continue;
        var d2 = Math.sqrt((dx)*(dx)+(dz)*(dz));
        if (d2 < min - LIVE_EPS && d2 > 0.01) collResolvePair(t, t2, dx, dz, d2, min, pushCap);   // 统一 split-push(含异队互警;迟滞+限幅)
      }
      var wcell = wreckGrid.get(cgKey);               // 残骸(静态网格,事件驱动;替代每帧入格)
      if (wcell) for (j = 0; j < wcell.length; j++) {
        var tw = wcell[j];
        var pw = tw.group.position;
        if (p.y - pw.y > HELI_COLL_VGATE || pw.y - p.y > HELI_COLL_VGATE) continue;   // 同高度门:飞过残骸上方不被拉扯
        dx = p.x - pw.x; dz = p.z - pw.z;
        min = t.radius + tw.radius;
        if (dx > min || dx < -min || dz > min || dz < -min) continue;
        var dw = Math.sqrt((dx)*(dx)+(dz)*(dz));
        if (dw < min - LIVE_EPS && dw > 0.01) collResolvePair(t, tw, dx, dz, dw, min, pushCap);   // 统一 split-push(残骸侧记账走 wreckPushSide;迟滞+限幅)
      }
    }
  }
  // —— 被推残骸障碍/栅栏复查(隔离自 tanks 主循环;残骸不发起配对,只复查障碍)——
  var wqN = 0;                                        // 原地压缩索引
  for (i = 0; i < _wreckMoveQueue.length; i++) {
    t = _wreckMoveQueue[i];
    t._wMove = false;                                 // 复查前复位;若下面再被障碍推出则重新置位,留在队列
    p = t.group.position;
    var nObsW = obstaclesNear(p.x, p.z, t.radius + obstacleMaxR + 2, _collObs);
    for (j = 0; j < nObsW; j++) {
      var ow = _collObs[j];
      dx = p.x - ow.x; dz = p.z - ow.z;
      min = t.radius + ow.r;
      if (dx > min || dx < -min || dz > min || dz < -min) continue;
      d = Math.sqrt((dx)*(dx)+(dz)*(dz));
      if (d < min && d > 0.01) {
        p.x += dx / d * (min - d); p.z += dz / d * (min - d);
        t.gDirty = true; t._wMove = true; wckNoteMoved(t); wreckGridUpdate(t);
      }
    }
    /* —— 残骸 vs 残骸:被推残骸对邻域残骸配对,同一 split-push 算法;
       触发器语义:只有动过的残骸才可能产生新重叠,平时零配对零检索 —— */
    var cxm = Math.floor(p.x / CG_CELL), czm = Math.floor(p.z / CG_CELL);
    for (var ixm = cxm - 1; ixm <= cxm + 1; ixm++) for (var izm = czm - 1; izm <= czm + 1; izm++) {
      var wkm = ixm * 4096 + izm, wcm = wreckGrid.get(wkm);
      if (!wcm) continue;
      for (j = 0; j < wcm.length; j++) {
        var wm = wcm[j];
        if (wm === t) continue;
        var pwm = wm.group.position;
        dx = p.x - pwm.x; dz = p.z - pwm.z;
        min = t.radius + wm.radius;
        if (dx > min || dx < -min || dz > min || dz < -min) continue;
        var dwm = Math.sqrt((dx)*(dx)+(dz)*(dz));
        if (dwm < min - WRECK_EPS && dwm > 0.01) collResolvePair(t, wm, dx, dz, dwm, min);   // 双侧均走 wreckPushSide(连锁入队,同帧级联收敛)
      }
    }
    if (t._wMove) _wreckMoveQueue[wqN++] = t;          // 仍被推 → 留在队列下帧复查
  }
  _wreckMoveQueue.length = wqN;                       // 压缩
  /* Resolve overlapping wreck piles in four slices; sleeping wrecks are skipped until pushed. */
  if (gameT - _wreckPairT >= 0.125) {
    _wreckPairT = gameT;
    _wreckSlice = (_wreckSlice + 1) & 3;
    for (i = _wreckSlice; i < wreckList.length; i += 4) {
      var ws = wreckList[i];
      if (!ws._wMove && gameT - (ws._wMovedT || -99) > 5) continue;   // 3A:休眠残骸零配对
      p = ws.group.position;
      var cxs = Math.floor(p.x / CG_CELL), czs = Math.floor(p.z / CG_CELL);
      for (var ixs = cxs - 1; ixs <= cxs + 1; ixs++) for (var izs = czs - 1; izs <= czs + 1; izs++) {
        var wks = ixs * 4096 + izs, wcs = wreckGrid.get(wks);
        if (!wcs) continue;
        for (j = 0; j < wcs.length; j++) {
          var w2s = wcs[j];
          if (w2s === ws) continue;
          var pw2s = w2s.group.position;
          dx = p.x - pw2s.x; dz = p.z - pw2s.z;
          min = ws.radius + w2s.radius;
          if (dx > min || dx < -min || dz > min || dz < -min) continue;
          var dws = Math.sqrt((dx)*(dx)+(dz)*(dz));
          if (dws < min - WRECK_EPS && dws > 0.01) collResolvePair(ws, w2s, dx, dz, dws, min);   // 同对二次相遇已分离,迟滞防抖
        }
      }
    }
  }
}

/* ============================================================
   载具状态 3D 迷你 HUD(右下角面板内专属小画布)——检视模式全套建模
   · 渲染=面板内 #phudcv 小画布(正交头正视图)+独立微型场景;
     use the inspection-mode vehicle model directly for the HUD:
     ① 外部视觉结构: 完整克隆真车全部视觉部件(车体/炮塔/身管/轮组/履带/旋翼/机身),
        应用检视模式半透蓝图装甲材质(0x384e60, 半透) + 战术青色结构边缘描线(0x44bbcc);
     ② 内部战术模块: 调用全载具高科技全息内构模块(engine/fuel/ammo/turret/gun/trackL/trackR等),
        应用专属高饱和战术全息色板(PV_MOD_COLORS)与发光白边描线;
     ③ 战损联动: 模块受创/损毁时由专属全息色实时渐变至高亮战损红(0xff2222),
        同时环绕 3D 窗的 7 个模块文字(炮管/炮塔/履带/发动机/油箱/弹药架)红色高亮渐显;
     ④ 姿态同步: 车体在主相机系下实时镜像呈现(屏上朝向=真车)+炮塔回转角+火炮俯仰角。
   ============================================================ */
var PV_MOD_COLORS = {
  engine: 0xf59e0b, // 动力系统 / 涡轴发动机 / 柴油机: 琥珀金 (Cyber Amber)
  fuel:   0xef4444, // 主副燃油箱 / 自封油箱: 炽红 (Fuel Crimson)
  ammo:   0xd946ef, // 弹药架 / 备弹舱 / 航炮供弹: 战术品红 (HE Magenta)
  trans:  0x06b6d4, // 传动系统 / 旋翼减速器: 电光青 (Electric Cyan)
  crew:   0x10b981, // 乘员室 / 座舱火控: 翡翠绿 (Tactical Green)
  gun:    0x38bdf8, // 武器火控 / 主炮身管: 钛青银 (Titanium Silver)
  trackL: 0x84cc16, // 行动机构(-X 侧=物理右侧,盒名沿用): 战术青绿 (Tactical Lime)
  trackR: 0x84cc16, // 行动机构(+X 侧=物理左侧,盒名沿用): 战术青绿
  turret: 0x3b82f6  // 炮塔回转机构: 钴蓝 (Cobalt Blue)
};

var _phud = {
  veh: null, rnd: null, scn: null, cam: null, att: null, tur: null, gun: null,
  rt: null, post: null, bg: null, bgTex: null,
  mats: {}, dirty: true, pq: new THREE.Quaternion(1, 1, 1, 1), pty: 0, pgp: 0
};
var _phQ = new THREE.Quaternion(), _phV1 = new THREE.Vector3();
var PHUD_W = 208;                                         // 框最长边(px)=面板内容宽,恒定;框高按车型比例生成
var PHUD_MIDY = 1.05;                                     // 模型中高(m):姿态组下沉居中画面
var PHUD_KIND = {};                                       // 型号规格记忆:队伍:平台 → { ppm, h, midY }
var PHUD_HI = {
  hull: 0xff2020, turret: 0xff2020, gun: 0xff2020,
  trackL: 0xff2020, trackR: 0xff2020, engine: 0xffcc33, fuel: 0xff6644, ammo: 0xff44aa
};

function _phudClear() {
  if (_phud.att) {
    _phud.scn.remove(_phud.att);
    _phud.att.traverse(function (m) {
      if (m.isMesh || m.isLineSegments) {
        if (m.userData && m.userData._phudOwnGeo && m.geometry) m.geometry.dispose();
        if (m.material && m.material.dispose) m.material.dispose();
      }
    });
    if (_phud.rnd) _phud.rnd.clear(true, true, false);
  }
  _phud.att = null; _phud.tur = null; _phud.gun = null; _phud.mats = {}; _phud.veh = null;
  _phudLabReset();
}

var _phudLab = null;                                      // 模块状态文字元素表(#phud3d 内 7 标签,懒取一次)
/* 几何可用判定: 空占位命中体是 new THREE.BufferGeometry() 空壳(无 position 属性),
   直接喂给 EdgesGeometry 会在 three 内部读 .count 爆炸 → 整个 _phudBuild 中断、面板空白 */
function _phudHasGeo(g) {
  return !!(g && g.attributes && g.attributes.position && g.attributes.position.count > 0);
}
function _phudLabEls() {
  if (!_phudLab || !_phudLab.gun) {
    _phudLab = {};
    var keys = ['gun', 'turret', 'trackL', 'trackR', 'engine', 'fuel', 'ammo'];
    for (var i = 0; i < keys.length; i++) _phudLab[keys[i]] = document.getElementById('ph-' + keys[i]);
  }
  return _phudLab;
}
function _phudLabReset() {                                // 全部标签归隐(换车/清场;健康=完全不可见)
  var L = _phudLabEls();
  for (var k in L) if (L[k]) L[k].style.opacity = '0';
}

function _phudBgSync(sp) {                                // 战术屏背景板:烘进 RT 与模型同过漫画滤镜(每型号一次,静态)
  var pr = Math.min(window.devicePixelRatio || 1, 2);
  var w = Math.round(PHUD_W * pr), h = Math.round(sp.h * pr);
  var c = document.createElement('canvas'); c.width = w; c.height = h;
  var g = c.getContext('2d');
  var rg = g.createRadialGradient(w / 2, h * 0.42, 4, w / 2, h * 0.42, w * 0.62);
  rg.addColorStop(0, '#16324a'); rg.addColorStop(0.6, '#0a1626'); rg.addColorStop(1, '#05090f');
  g.fillStyle = rg; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(90,255,160,0.08)'; g.lineWidth = 1;
  var st = 18 * pr, x, y;
  for (x = 0.5; x < w; x += st) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (y = 0.5; y < h; y += st) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  if (_phud.bgTex) _phud.bgTex.dispose();
  _phud.bgTex = new THREE.CanvasTexture(c);
  if (!_phud.bg) {
    _phud.bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
    _phud.bg.position.z = -9; _phud.bg.frustumCulled = false;
    _phud.scn.add(_phud.bg);
  }
  _phud.bg.material.map = _phud.bgTex; _phud.bg.material.needsUpdate = true;
  _phud.bg.scale.set(PHUD_W / sp.ppm, sp.h / sp.ppm, 1);
}

function _phudSpec() {                                    // 型号规格(整场记忆):炮口距 R/像素比/框高
  var kk = player.team + ':' + (player.platform || player.kind);
  var sp = PHUD_KIND[kk];
  if (sp) return sp;
  player.group.updateMatrixWorld(true);
  var R = 0, v = _phV1;
  if (player.muzzle) {
    player.muzzle.getWorldPosition(v);
    player.group.worldToLocal(v);
    R = Math.sqrt(v.x * v.x + v.z * v.z);
  }
  var mnX = 1e9, mxX = -1e9, mnZ = 1e9, mxZ = -1e9, mnY = 1e9, mxY = -1e9;
  player.group.traverse(function (c) {
    if (!c.isMesh || !c.geometry) return;
    if (c.userData && (c.userData.face === 'hidden' || c.userData.isHl)) return;
    var g = c.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    var bb = g.boundingBox;
    if (!bb) return;
    for (var i = 0; i < 8; i++) {
      v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
      v.applyMatrix4(c.matrixWorld);
      player.group.worldToLocal(v);
      if (v.x < mnX) mnX = v.x; if (v.x > mxX) mxX = v.x;
      if (v.y < mnY) mnY = v.y; if (v.y > mxY) mxY = v.y;
      if (v.z < mnZ) mnZ = v.z; if (v.z > mxZ) mxZ = v.z;
      var hl = Math.sqrt(v.x * v.x + v.z * v.z);
      if (hl > R) R = hl;
    }
  });

  var vehL = Math.max(mxZ - mnZ, 0.1), vehW = Math.max(mxX - mnX, 0.1);
  if (!(R > 0.1)) R = 5;
  var ratio = vehW / vehL;
  if (!(ratio > 0)) ratio = 0.5;
  var midY = (mnY + mxY) * 0.5;
  if (!isFinite(midY) || midY <= 0) midY = 1.05;

  sp = {
    ppm: 0.94 * (PHUD_W / 2) / R,                         // 缩放规约:R×ppm ≡ 框最长边一半×94%
    h: Math.max(64, Math.min(160, Math.round(PHUD_W * ratio))), // 框高=最长边×(车宽/车长)
    midY: midY
  };
  PHUD_KIND[kk] = sp;
  return sp;
}

function _phudBuild() {
  _phudClear();
  if (!player || !player.alive || !player.group || !camera) return;
  _phud.veh = player;
  /* 模型质量档(非高):战术屏小渲染器关 MSAA、不上漫画后处理。
     它自成一个 WebGL 上下文并自备一张 RT,手机上多一个上下文+一遍全屏着色不划算;
     画布只有 PHUD_W × 64~160 像素,MSAA 与后处理的观感收益本就很有限。
     跳过 _phud.post 后,playerHudTick 会自动走 else 分支直渲(_phudBuild 之后的判断无需改动)。
     ★2026-09-13:改由模型质量档驱动(原取 GFX.hudAA,中/低两档本来就同为关,行为逐位不变)。 */
  var _phudLow = modQ('modAA', true) === false;
  if (!_phud.rnd) {
    var cv = document.getElementById('phudcv');
    if (!cv) return;
    _phud.rnd = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: !_phudLow });
    _phud.rnd.setClearColor(0x000000, 0);
    _phud.scn = new THREE.Scene();
    _phud.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
    _phud.cam.position.z = 12;
  }
  if (!_phud.post && modQ('modPost', true) && typeof _COMIC_FRAG !== 'undefined' && typeof _comicBrush !== 'undefined' && _comicBrush) {
    var pm = new THREE.ShaderMaterial({ uniforms: {
        tDiffuse: { value: null }, tEdge: { value: null }, tDepth: { value: null }, uHasDepth: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) }, uThick: { value: 1.35 }, uScale: { value: 1 },
        uVehInkMode: { value: 0 }, uThermal: { value: 0 },
        uVehFx: { value: 1 }, uFxaa: { value: 0 },
        tBrush: { value: _comicBrush }, uGlow: { value: 0 }, uCrt: { value: 0 },
        uWGrade: { value: 0 },
        uWLift:  { value: new THREE.Vector3( 0, 0, 0) },
        uWGamma: { value: new THREE.Vector3( 0, 0, 0) },
        uWGain:  { value: new THREE.Vector3( 1, 1, 1) },
        uWNear:  { value: new THREE.Vector3( 0, 0, 0) },
        uWFar:   { value: new THREE.Vector3( 0, 0, 0) },
        uWDepth: { value: new THREE.Vector2( 0.34, 0.92) } },
      vertexShader: _COMIC_VERT, fragmentShader: _COMIC_FRAG, depthTest: false, depthWrite: false });
    var pscn = new THREE.Scene();
    pscn.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), pm));
    _phud.post = { scn: pscn, cam: new THREE.Camera(), mat: pm };
  }
  var sp = _phudSpec();
  var box = document.getElementById('mods');
  if (box) box.style.height = (sp.h + 2) + 'px';
  var pr = Math.min(window.devicePixelRatio || 1, 2);
  _phud.rnd.setPixelRatio(pr);
  _phud.rnd.setSize(PHUD_W, sp.h, false);
  if (_phud.post) {
    if (_phud.rt) _phud.rt.dispose();
    _phud.rt = new THREE.WebGLRenderTarget(Math.round(PHUD_W * pr), Math.round(sp.h * pr),
      { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
    _phud.post.mat.uniforms.tDiffuse.value = _phud.rt.texture;
    _phud.post.mat.uniforms.tEdge.value = _phud.rt.texture;
    _phud.post.mat.uniforms.tDepth.value = _phud.rt.texture;
    _phud.post.mat.uniforms.uRes.value.set(_phud.rt.width, _phud.rt.height);
  }
  var hw = PHUD_W / (2 * sp.ppm), hh = sp.h / (2 * sp.ppm);
  _phud.cam.left = -hw; _phud.cam.right = hw; _phud.cam.top = hh; _phud.cam.bottom = -hh;
  _phud.cam.updateProjectionMatrix();
  _phudBgSync(sp);

  var isH = isHeliVehicle(player);
  var att = new THREE.Group(), tur = new THREE.Group(), gun = new THREE.Group();
  att.position.y = -(sp.midY || PHUD_MIDY);
  att.add(tur); tur.add(gun);
  if (player.turret) tur.position.copy(player.turret.position);
  if (player.gunPivot) gun.position.copy(player.gunPivot.position);

  // 1. 检视模式载具外壳材质 (半透明白墨/蓝图装甲外壳 + 柔和结构边缘描线 - 初始不染色)
  var shellMat = new THREE.MeshBasicMaterial({
    color: 0x3a4856,
    transparent: true,
    opacity: 0.18,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false
  });
  var shellEdgeMat = new THREE.LineBasicMaterial({
    color: 0x6e8a9e,
    linewidth: 1.0,
    transparent: true,
    opacity: 0.45,
    depthTest: false,
    fog: false
  });

  function isAncestor(node, target) {
    var cur = node;
    while (cur) {
      if (cur === target) return true;
      cur = cur.parent;
    }
    return false;
  }

  function attachRelMesh(srcNode, ancestorTarget, destGroup, newMesh) {
    if (srcNode.parent === ancestorTarget) {
      newMesh.position.copy(srcNode.position);
      newMesh.quaternion.copy(srcNode.quaternion);
      newMesh.scale.copy(srcNode.scale);
    } else {
      srcNode.updateWorldMatrix(true, false);
      ancestorTarget.updateWorldMatrix(true, false);
      var mRel = new THREE.Matrix4().copy(ancestorTarget.matrixWorld).invert().multiply(srcNode.matrixWorld);
      mRel.decompose(newMesh.position, newMesh.quaternion, newMesh.scale);
    }
    destGroup.add(newMesh);
  }

  // 遍历真车全部视觉部件，克隆检视模式外壳
  player.group.traverse(function (child) {
    if (!child.isMesh || !_phudHasGeo(child.geometry)) return;
    if (child.userData && (child.userData.face || child.userData.mod || child.userData.isHitMesh || child.userData.isHitBox || child.userData.isHl)) return;
    if (child.name === 'hitMesh' || child.name === 'shadowProxy') return;

    var geo = child.geometry;
    var vm = new THREE.Mesh(geo, shellMat);
    vm.renderOrder = 20;

    var eg = new THREE.EdgesGeometry(geo, 22);
    var elines = new THREE.LineSegments(eg, shellEdgeMat);
    elines.userData._phudOwnGeo = true;
    elines.renderOrder = 22;
    vm.add(elines);

    if (player.gunPivot && isAncestor(child, player.gunPivot)) {
      attachRelMesh(child, player.gunPivot, gun, vm);
    } else if (player.turret && isAncestor(child, player.turret)) {
      attachRelMesh(child, player.turret, tur, vm);
    } else {
      attachRelMesh(child, player.group, att, vm);
    }
  });

  // 2. 检视模式全息内构战术模块 (调用 PV_MOD_COLORS 战术全息色 + 白色发光轮廓描边)
  var list = player.modMeshes || [];
  for (var i = 0; i < list.length; i++) {
    var mm = list[i];
    if (!mm || !_phudHasGeo(mm.geometry)) continue;   // 空占位命中体(如 59 式车体/炮塔空壳)无顶点, EdgesGeometry 会炸, 跳过(同 key 真实壳仍会被克隆)
    var key = mm.userData && mm.userData.key;
    if (!key) continue;

    var baseCol = 0x708090; // 初始不染色: 纯净半透明中性灰蓝基底
    var modMat = new THREE.MeshBasicMaterial({
      color: baseCol,
      transparent: true,
      opacity: 0.15,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false
    });

    _phud.mats[key] = {
      mat: modMat,
      base: new THREE.Color(baseCol),
      hi: new THREE.Color(PHUD_HI[key] || 0xff2020),
      op0: 0.15,
      opGain: 0.80,
      q: -1
    };

    var modMesh = new THREE.Mesh(mm.geometry, modMat);
    modMesh.renderOrder = 35;

    var modEdges = new THREE.EdgesGeometry(mm.geometry, 15);
    var modLines = new THREE.LineSegments(modEdges, new THREE.LineBasicMaterial({
      color: 0x8fa0b0,
      linewidth: 1.2,
      transparent: true,
      opacity: 0.45,
      depthTest: false,
      fog: false
    }));
    modLines.userData._phudOwnGeo = true;
    modLines.renderOrder = 36;
    modMesh.add(modLines);

    if (player.gunPivot && isAncestor(mm, player.gunPivot)) {
      attachRelMesh(mm, player.gunPivot, gun, modMesh);
    } else if (player.turret && isAncestor(mm, player.turret)) {
      attachRelMesh(mm, player.turret, tur, modMesh);
    } else {
      attachRelMesh(mm, player.group, att, modMesh);
    }
  }

  _phud.att = att; _phud.tur = tur; _phud.gun = gun;
  _phud.scn.add(att);
  _phud.dirty = true;

  var labs = _phudLabEls();
  if (isH) {
    if (labs.trackL) {
      labs.trackL.textContent = 'ROTOR';
      labs.trackL.style.writingMode = 'horizontal-tb';
      labs.trackL.style.left = '50%';
      labs.trackL.style.top = '10px';
      labs.trackL.style.transform = 'translateX(-50%)';
    }
    if (labs.trackR) labs.trackR.style.display = 'none';
  } else {
    if (labs.trackL) {
      labs.trackL.textContent = 'TRACK';
      labs.trackL.style.writingMode = 'vertical-rl';
      labs.trackL.style.left = '3px';
      labs.trackL.style.top = '50%';
      labs.trackL.style.transform = 'translateY(-50%)';
    }
    if (labs.trackR) {
      labs.trackR.style.display = '';
      labs.trackR.textContent = 'TRACK';
    }
  }

  for (var k in _phud.mats) playerHudDamage(k);
}

function playerHudDamage(key) {                           // 事件钩子:模块受伤/火灾烧蚀时调(combat.js/world.js)
  var e = _phud.mats[key];
  if (!e || !player || !player.mods || !player.mods[key]) return;
  var md = player.mods[key], frac;
  if (md.max > 0) frac = 1 - Math.max(0, md.hp) / md.max;               // 0=满血无高亮 → 1=损毁全亮
  else frac = 1 - Math.max(0, player.struct) / Math.max(1, player.structMax || 0);
  var q = Math.round(frac * 100);
  if (q === e.q) return;
  e.q = q; frac = q / 100;
  if (frac <= 0) {
    e.mat.color.copy(e.base);
    e.mat.opacity = e.op0;
  } else {
    e.mat.color.copy(e.base).lerp(e.hi, frac);
    e.mat.opacity = e.op0 + e.opGain * frac;
  }
  _phud.dirty = true;                                     // 材质变更→下帧重渲一次
  var lbKey = key;   // 地面载具 trackL/trackR 盒名与物理左右装反(trackL 在 -X=物理右侧):人话层标签按物理侧取,与 3D 模块真位置对齐;直升机 trackL 复用为旋翼单标签,不换
  if (player && !isHeliVehicle(player) && (key === 'trackL' || key === 'trackR')) lbKey = (key === 'trackL') ? 'trackR' : 'trackL';
  var lb = _phudLabEls()[lbKey];                            // 模块状态文字同源联动:opacity=损伤比(健康 0=不可见)
  if (lb) lb.style.opacity = q > 0 ? String(frac) : '0';
}

function playerHudTick() {                                // 每帧:换车引用比较+姿态变更门(未变=零渲染)
  if (_phud.veh !== player || (player && !player.alive && _phud.att)) {
    if (player && player.alive) _phudBuild(); else _phudClear();
  }
  if (!_phud.att) return;
  _phQ.copy(camera.quaternion).invert().multiply(player.group.quaternion);
  var ty = player.turretYaw || 0, gp = player.gunPivot ? player.gunPivot.rotation.x : 0;
  if (!_phud.dirty && ty === _phud.pty && gp === _phud.pgp &&
      _phQ.x === _phud.pq.x && _phQ.y === _phud.pq.y && _phQ.z === _phud.pq.z && _phQ.w === _phud.pq.w) return;
  _phud.dirty = false; _phud.pty = ty; _phud.pgp = gp; _phud.pq.copy(_phQ);
  _phud.att.quaternion.copy(_phQ);                        // 真车世界姿态在主相机系下呈现(屏上朝向=真车)
  _phud.tur.rotation.y = ty;
  _phud.gun.rotation.x = gp;
  if (_phud.post) {
    _phud.rnd.setRenderTarget(_phud.rt);
    _phud.rnd.render(_phud.scn, _phud.cam);
    _phud.rnd.setRenderTarget(null);
    _phud.rnd.render(_phud.post.scn, _phud.post.cam);
  } else _phud.rnd.render(_phud.scn, _phud.cam);
}
