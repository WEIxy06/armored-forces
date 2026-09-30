
/* ===== Module: weapons.js ===== */
/* ============================================================
   模块: weapons.js — 武器:炮弹/火箭弹视觉与弹道/爆炸溅射
   (加载顺序由 index.html MODULES 表决定,勿单独调整)
   ============================================================ */
'use strict';
/* ============================================================
   炮弹
   ============================================================ */
var ray = new THREE.Raycaster();
var shellGeo = new THREE.SphereGeometry(0.06, 6, 6);
var shellMatP = new THREE.MeshBasicMaterial({ color: 0xffd780 });
var shellMatE = new THREE.MeshBasicMaterial({ color: 0xff8860 });
/* ============================================================
   坦克炮弹全场实例化(学习 Draw Call Batching 指南:同网格同材质动态物→GPU 实例化)——
   逐发一个 Mesh+scene.add 的画法在中间期数百发在飞时=数百 draw call+逐发 scene 增删;
   全场仅 2 个 InstancedMesh(玩家弹金色/AI 弹橙红,各 1 draw call),弹体沿速度方向拉长 5 倍(单 Mesh 版 mesh.scale 同款)。
   ============================================================ */
var SHELL_CAP = 384;                       // 单阵营在飞上限(双方合计 768;超出者本帧不绘——任务24:防空机炮 2发/0.25s×3 车+坦克/火箭炮会战实测可破 256,扩容消除炮弹闪隐)
var shellInstP = null, shellInstE = null;
/* 复用 scratch(热路径,避免每帧 GC;模块私有) */
var _shM = new THREE.Matrix4(), _shQ = new THREE.Quaternion(), _shS = new THREE.Vector3(1, 1, 5),
    _shZ = new THREE.Vector3(0, 0, 1);
var _shMove = new THREE.Vector3(), _shDir = new THREE.Vector3();   // stepShells 逐弹位移/方向暂存(下游 ray.set/resolveHit/hitSpark 均即时消费,不持引用)

/* Helicopter countermeasure salvo: one F press releases four independent flares.
   The magazine stores twenty individual flares and reloads the complete rack in twenty seconds. */
var HELI_DECOY_CAPACITY = 20;
var HELI_DECOY_RELOAD_TIME = 20.0;
var HELI_DECOY_LURE_RANGE = 1000.0;
var HELI_DECOY_BURST_SIZE = 4;
var heliDecoys = [];
function initShellVfx() {
  shellInstP = new THREE.InstancedMesh(shellGeo, shellMatP, SHELL_CAP);
  shellInstE = new THREE.InstancedMesh(shellGeo, shellMatE, SHELL_CAP);
  [shellInstP, shellInstE].forEach(function (im, i2) {
    im.count = 0;
    im.frustumCulled = false;              // 弹体散布全场,数量=实时在飞数,整体包围球剔除会误杀
    im.castShadow = false; im.receiveShadow = false;   // 6cm 弹体无阴影价值
    im.userData.instPart = i2 === 0 ? 'shell-P' : 'shell-E';
    scene.add(im);
  });
}
/* 每帧一次(stepShells 尾部):全部在飞坦克炮弹摆位——位置=弹道当前点,姿态=速度方向,长轴 5×(与旧逐发网格同观感) */
function shellVfxPass() {
  if (!shellInstP) return;                 // init 前(或清场后)安全早退
  var nP = 0, nE = 0, i, s;
  for (i = 0; i < shells.length; i++) {
    s = shells[i];
    if (s.arty || s.isHeliMissile) continue; // 火箭弹走 rocketVfxPass,直升机导弹走 heliMissileVfxPass
    _v1.copy(s.vel).normalize();
    _shQ.setFromUnitVectors(_shZ, _v1);
    _shM.compose(s.pos, _shQ, _shS);
    if (s.owner && s.owner.isPlayer) { if (nP < SHELL_CAP) { shellInstP.setMatrixAt(nP++, _shM); } }
    else if (nE < SHELL_CAP) { shellInstE.setMatrixAt(nE++, _shM); }
  }
  shellInstP.count = nP; shellInstE.count = nE;
  shellInstP.instanceMatrix.needsUpdate = true;
  shellInstE.instanceMatrix.needsUpdate = true;
}
/* ===== 直升机空空导弹视觉与飞行实例化渲染 (AAM & SAM Missiles) ----
   15: 真机口径 1:1 建模(旋翼直径核对: 蓝方直升机 14.63→游戏14.24 / 红方直升机 13.0→游戏12.7, ≈0.975):
   红方空空导弹: 长 1.86m × Φ90mm(四联装); 蓝方防空导弹: 长 1.52m × Φ70mm(二联装)。
   弹体口径与真实弹一致。 ===== */
function buildTy90Geo() {
  var parts = [
    // 弹体主圆筒 Φ90mm (白/浅灰)
    { g: new THREE.CylinderGeometry(0.045, 0.045, 1.42, 12).rotateX(Math.PI / 2), c: [0.97, 0.98, 0.99] },
    // 红外导引头罩 (深灰玻璃)
    { g: new THREE.CylinderGeometry(0.012, 0.045, 0.32, 10).rotateX(Math.PI / 2).translate(0, 0, 0.82), c: [0.16, 0.17, 0.18] },  // (M2)导引头加长0.28→0.32并前移,使其底盖(r0.045)埋入弹体0.06而非与弹体顶盖z=0.71同径共面,消除随距离变化的黑白色移(z-fighting)
    // 尾喷管 (暗黑钢)
    { g: new THREE.CylinderGeometry(0.048, 0.040, 0.16, 10).rotateX(Math.PI / 2).translate(0, 0, -0.85), c: [0.14, 0.15, 0.16] },
    // 弹体中部固定边条翼 (浅灰)
    { g: new THREE.BoxGeometry(0.17, 0.012, 0.26).translate(0, 0, 0.18), c: [0.97, 0.98, 0.99] },
    { g: new THREE.BoxGeometry(0.012, 0.17, 0.26).translate(0, 0, 0.18), c: [0.97, 0.98, 0.99] },
    // 尾部气动控制舵面十字翼 (浅灰)
    { g: new THREE.BoxGeometry(0.24, 0.014, 0.20).translate(0, 0, -0.66), c: [0.97, 0.98, 0.99] },
    { g: new THREE.BoxGeometry(0.014, 0.24, 0.20).translate(0, 0, -0.66), c: [0.97, 0.98, 0.99] }
  ];
  var g = mergeVisParts(parts);
  g.userData = g.userData || {};
  g.userData._shared = true;
  return g;
}

function buildAim92Geo() {
  var parts = [
    // 弹体主圆筒 Φ70mm (橄榄绿)
    { g: new THREE.CylinderGeometry(0.035, 0.035, 1.14, 12).rotateX(Math.PI / 2), c: [0.22, 0.23, 0.21] },
    // 红外导引头罩 (暗色玻璃)
    { g: new THREE.CylinderGeometry(0.010, 0.035, 0.24, 10).rotateX(Math.PI / 2).translate(0, 0, 0.69), c: [0.13, 0.14, 0.15] },
    // 尾喷口 (暗黑钢)
    { g: new THREE.CylinderGeometry(0.038, 0.032, 0.14, 10).rotateX(Math.PI / 2).translate(0, 0, -0.69), c: [0.14, 0.15, 0.16] },
    // 前控制舵面十字鸭翼 (暗灰)
    { g: new THREE.BoxGeometry(0.13, 0.010, 0.14).translate(0, 0, 0.42), c: [0.22, 0.23, 0.21] },
    { g: new THREE.BoxGeometry(0.010, 0.13, 0.14).translate(0, 0, 0.42), c: [0.22, 0.23, 0.21] },
    // 尾部稳定十字翼 (暗灰)
    { g: new THREE.BoxGeometry(0.16, 0.012, 0.16).translate(0, 0, -0.52), c: [0.22, 0.23, 0.21] },
    { g: new THREE.BoxGeometry(0.012, 0.16, 0.16).translate(0, 0, -0.52), c: [0.22, 0.23, 0.21] }
  ];
  var g = mergeVisParts(parts);
  g.userData = g.userData || {};
  g.userData._shared = true;
  return g;
}

var ty90MissileGeo = buildTy90Geo();
var aim92MissileGeo = buildAim92Geo();
/* 每边挂架联装数与弹道参数表(用户口径):
   红方导弹 四联装/边, 2马赫(680m/s), 阻力 K=3.5e-4 /m → 最大射程≈6km; 伤害60
   蓝方导弹 二联装/边, 2.2马赫(748m/s), 阻力 K=2.5e-4 /m → 最大射程≈8km; 伤害55
   射程=助推段+二次阻力滑翔段积分(v(t)=vMax/(1+K·vMax·t)),寿命到即自毁=射程上限 */
/* 直升机机载空空/反装甲导弹规格定义:
   直升机导弹均采用【光电/红外成像制导 (Optoelectronic / IR Dual-Spectrum Seeker)】:
   - 导引头自主扫描视场:开口 30° (半角 15°)、垂直高程搜索范围 ±1000m
   - 双模复合制导:
     1. 母机雷达数据链中继引导:母机正在锁定目标时,导弹动态追踪母机锁定目标;
     2. 自主光电寻的 (射后不管):母机未锁定目标时,导弹惯性飞行并由导引头自主搜索视锥内热源;
     3. 物理抗干扰特性:不受地面微波杂波影响;可被战场剧烈爆炸火球或太阳直射强热源暂时诱偏,火球熄灭后自动寻获下一目标。 */
/* ===== 直升机弹体通用运动/制导规格表 =====
   导弹(HELI_MSL_SPEC)与火箭弹(HELI_RKT_SPEC)共用同一套力矢量积分算法(stepShells 通用制导分支),
   型号差异全部由规格字段驱动 (heliGuidedAcquireTarget / heliGuidedFlightStep 消费):
     guidance  'optoelectronic'=复合制导(数据链+光电自主寻的) | 'datalink'=逐帧数据链 | 无=无制导
     v0/vMax   离架初速/极速; boostT 助推时长(0=离架即全速纯减速); dragK 二次寄生阻力
     gScale    重力缩放(制导型 1.0 全量, 无制导 0.35 弹道系数)
     gMax/kQ/turnK  可用过载 a_max=min(gMax·9.8, kQ·v²) 与诱导阻力 ∝a² (无制导不用)
     gBias/terraFollow  法向重力补偿 / 中段地形跟随 (导弹专属行为开关)
     vFloor    速度地板(60); captureR 终端捕获半径
     domain    火力分配的目标域: 'air'=对空优先(空空导弹) | 'ground'=对地优先(对地制导火箭)
     pen       战斗部直击穿深(mm; warheadPenRoll 闸门消费——机载导弹90/MBT-1炮射导弹500/制导火箭800, 见 warheadPenRoll 注) */
var HELI_MSL_SPEC = {
  ty90:  { name: 'MISSILE (EO/IR)', guidance: 'optoelectronic', domain: 'air', pen: 90, seekerFovDeg: 30, seekerAltMax: 1000, tubes: 4, v0: 680, vMax: 680, boostT: 1.5, gScale: 1, dragK: 0.00035, life: 45, dmg: 60, gMax: 20, kQ: 0.00118, turnK: 0.0025, gBias: true, terraFollow: true, nozzle: 0.88, range: 6000 },
  aim92: { name: 'MISSILE (EO/IR)', guidance: 'optoelectronic', domain: 'air', pen: 90, seekerFovDeg: 30, seekerAltMax: 1000, tubes: 4, v0: 748, vMax: 748, boostT: 1.2, gScale: 1, dragK: 0.00025, life: 45, dmg: 55, gMax: 18, kQ: 0.00088, turnK: 0.0025, gBias: true, terraFollow: true, nozzle: 0.62, range: 8000 },
  /* Player AA conversion: this is a real ground-guided missile spec,
     not a label-only garage upgrade.  The reduced quadratic drag coefficient
     is calibrated against the shared HELI_MSL flight integrator: from a
     680m/s launch it consumes one 45s life at about 5km.  AI AA vehicles
     never select this entry because heliMslTypeOf gates it to isPlayer. */
  redAaAtgm: { name: 'MISSILE (ATGM EO/IR)', guidance: 'optoelectronic', domain: 'ground', pen: 800, seekerFovDeg: 30, seekerAltMax: 1000, tubes: 2, v0: 680, vMax: 680, boostT: 0, gScale: 1, dragK: 0.00068, life: 45, dmg: 180, gMax: 12, kQ: 0.00059, turnK: 0.0025, gBias: true, terraFollow: true, nozzle: 0.88, range: 5000 },
  /* Player MBT-1 gun-launched missile: red-heli TY-90 flight/seeker model,
     with the requested fixed warhead values.  seekerOnly is consumed by the
     target-acquisition gate below, so this projectile never reads a vehicle
     radar track or a radar-assigned target. */
  redMbt1: { name: 'GUN-LAUNCHED MISSILE (EO/IR)', guidance: 'optoelectronic', domain: 'ground', seekerOnly: true, pen: 500, seekerFovDeg: 30, seekerAltMax: 1000, tubes: 1, v0: 680, vMax: 680, boostT: 1.5, gScale: 1, dragK: 0.00035, life: 45, dmg: 60, gMax: 20, kQ: 0.00118, turnK: 0.0025, gBias: true, terraFollow: true, nozzle: 0.88, range: 6000 }
};
/* 力矢量转向参数口径 (与真实导弹动力学/飞行模拟器同源):
   - 可用过载 a_max = min(gMax·9.8, kQ·v²) —— 结构 g 上限只在动压足够时可达 (kQ 标定为 0.6·vMax 处恰好满过载),
     低速段 a∝v², 转弯半径 R=v²/a 在中速段恒为 R_min=(0.6vMax)²/(gMax·9.8) (红方弹≈850m / 蓝方弹≈1.1km);
   - 转向力 ⊥ 速度 (只弯折轨迹不直接改速), 诱导阻力 ∝ a转向² (turnK, 持续大过载快速掏空动能);
   - HELI_MSL_PN_N: 比例导引增益 (真实弹 3~5): a_dem = N·Vc·λ̇ (视线旋转率), 主动收敛至碰撞航向, 闭合速度钳底下限 0.2v 防零接近几何失控 */
var HELI_MSL_PN_N = 4.0;
/* 直升机火箭弹分型规格: 红方武装直升机 = 70mm 雷达制导火箭弹 (数据链跟随母机锁定目标, 无锁定→惯性直飞);
   蓝方武装直升机 = 70mm 无制导火箭弹 (0.35g 弹道飞行)。v0 即最大速度(发射后纯减速), dragK 标定极限射程; 存续时间统一 45s
   制导火箭机动: gMax 10 / kQ 5.9e-4 —— 可用过载 a_max=min(gMax·9.8, kQ·v²),
   最小转弯半径 R=v²/a 约为导弹的 50%; 无制导火箭 无 gMax/kQ, 不可转向。
   pen: 战斗部直击穿深 800mm (70mm火箭弹同口径; warheadPenRoll 闸门消费,
        直击穿深判定生效——坦克正面垂直必穿, 重型主战坦克首上362中到大入射角可弹开)。 */
var HELI_RKT_SPEC = {
  // splashR 现由通用函数 splashRadiusFromDamage(dmg) 派生 (= dmg × 22/60);此处字段值必须与该函数输出一致
  // (AI 火控/CCIP 门读本字段做包线判定,实际爆炸半径亦走同一函数,单一比例真源,永不脱节)。
  wz10: { name: '70mm ROCKET (GUIDED)', guidance: 'datalink', domain: 'ground', pen: 800, dmg: 40, v0: 680, vMax: 680, boostT: 0, gScale: 1, dragK: 0.00030, gMax: 10, kQ: 0.00059, turnK: 0.0025, captureR: 6, rounds: 14, range: 8000, life: 45, splashR: 14.67 },   // 40 × 22/60 ≈ 14.67m
  ah64: { name: '70mm ROCKET (UNGUIDED)', domain: 'ground', pen: 800, dmg: 60, v0: 748, vMax: 748, boostT: 0, gScale: 0.35, dragK: 0.00025, vFloor: 60, captureR: 6, range: 10000, life: 45, splashR: 22, rounds: 14 }   // dmg 60 × 22/60 = 22m
};
function playerRedAaAtgmInstalled(t) {
  /* Backward-compatible helper name: the RED-AA ATGM conversion is now also
     available to BLUE-AA players, while all AI AA vehicles keep their SAM. */
  return !!(t && t.isPlayer === true && (t.team === 'red' || t.team === 'blue') && t.kind === 'aa' &&
    (t._techAaAtgm === true ||
      (typeof vehicleTechRedAaAtgmInstalled === 'function' && vehicleTechRedAaAtgmInstalled(t)) ||
      (typeof vehicleTechAaAtgmInstalled === 'function' && vehicleTechAaAtgmInstalled(t))));
}
function aaMslTypeOf(t, weaponKind) {
  // Weapon kind 1 is the stock SAM; kind 2 is the optional ATGM.  The
  // loaded kind, not merely the installed node, selects the live projectile.
  if (weaponKind === 2 && playerRedAaAtgmInstalled(t)) return 'redAaAtgm';
  return t.team === 'red' ? 'ty90' : 'aim92';
}
function heliMslTypeOf(t) {
  if (t.kind === 'aa') {
    var loadedKind = t._aaReloadKind === 2 ? 2 : 1;
    return loadedKind === 2 && playerRedAaAtgmInstalled(t)
      ? 'redAaAtgm'
      : (t.team === 'red' ? 'ty90' : 'aim92');
  }
  return t.kind === 'wz10' ? 'ty90' : 'aim92';
}
function heliMslTubesOf(t) {
  if (t.kind === 'aa') return t.team === 'red' ? 2 : 4;   // 每侧在筒数:红方防空车左右各2枚(共4)/蓝方防空车左右各4管(共8)
  return HELI_MSL_SPEC[heliMslTypeOf(t)].tubes;
}
/* 通用导弹装填(用户定 2026-09-11):总时长 = 载弹总数 × 5 秒/发,直升机/防空车同一公式,单一真值源。
   红蓝直升机/蓝方防空车:每侧 4 × 2 = 8 发 → 40s;红方防空车:每侧 2 × 2 = 4 发 → 20s(40s→20s)。 */
var MSL_RELOAD_PER_ROUND = 5.0;
function heliMslReloadTimeOf(t) {
  return heliMslTubesOf(t) * 2 * MSL_RELOAD_PER_ROUND;
}
/* The gun loader handles one missile at a time.  It uses the same real loader
   cycle as the selected main-gun round; damage to the loader chain is applied
   by the normal tickReload/reloadDamageMult path. */
function redMbtMissileReloadTimeOf(t) {
  return t && t.reloadTime > 0 ? t.reloadTime : 8.5;
}
/* 任务24: AI 防空齐射纪律(用户报告:加入防空车后极其严重的卡顿+动画播放错误)。
   修复前 AI 以 0.2s 防抖间隔+0.3s 思考节拍在 3 秒内打光全部备弹(headless 探针实测:
   6 辆 AA 3 秒 35 发、峰值 31 枚同时在飞、109 次音频事件/3 秒),叠加 45s 寿命孤弹
   → 制导弹实体风暴 → 固定步长模拟追不上渲染 → 全场慢动作卡顿。
   真实 SPAAG 条令=发射 1~2 发→观察毁伤→再装定,故 AI 限:每车在飞 ≤2 枚 + 间隔 3.0s。
   玩家不受影响(手感 0.2s 防抖保持)。 */
var AA_AI_MSL_INFLIGHT = 2;
var AA_AI_MSL_INTERVAL = 3.0;
/* 火箭弹类装填(大修): 基础=1 秒 × 装弹量,再乘伤害系数=该弹伤害/60(伤害越低系数越小,装填越快)。
   RED_MLRS: 40 联 × 1s × (60/60=1.0) = 40s;BLUE_MLRS: 6 联 × 1s × (120/60=2.0) = 12s;
   红方火箭弹: 14 × (40/60) ≈ 9.33s;蓝方火箭弹: 14 × (60/60) = 14s。导弹不走本函数。 */
function rocketPodCountOf(t) {
  if (!t) return 14;
  var kind = t.kind || t;
  if (kind === 'arty') return artyConfOf(t).salvo;   // 阵营路由:红 RED_MLRS=40 / 蓝 BLUE_MLRS=6
  var spec = (typeof HELI_RKT_SPEC !== 'undefined') ? HELI_RKT_SPEC[kind] : null;
  if (spec && spec.rounds) return spec.rounds;
  if (kind === 'wz10' || kind === 'ah64') return 14;
  return 14;
}
/* 该载具火箭弹的实际单发伤害；重型弹头只在对应玩家直升机上消费，AI 仍读基础规格。 */
function rocketDamageOf(t) {
  if (!t) return 60;
  var kind = t.kind || t;
  if (kind === 'arty') return artyConfOf(t).dmg;
  var spec = (typeof HELI_RKT_SPEC !== 'undefined') ? HELI_RKT_SPEC[kind] : null;
  var base = (spec && spec.dmg) ? spec.dmg : 60;
  if (kind === 'wz10' && t.isPlayer === true && t.team === 'red' &&
      ((typeof vehicleTechHeavyRocketWarheadInstalled === 'function' && vehicleTechHeavyRocketWarheadInstalled(t)) || t._techHeavyRocketWarhead === true)) return 60;
  if (kind === 'ah64' && t.isPlayer === true && t.team === 'blue' &&
      ((typeof vehicleTechBlueHeliHeavyRocketWarheadInstalled === 'function' && vehicleTechBlueHeliHeavyRocketWarheadInstalled(t)) || t._techBlueHeliHeavyRocketWarhead === true)) return 120;
  return base;
}
function rocketReloadTimeOf(t) {
  /* Keep the existing loader timing when the player installs the heavier warhead;
     the upgrade changes damage, not the number of tubes or the established reload rule. */
  var kind = t && (t.kind || t);
  var reloadDmg = 60;
  if (kind === 'arty') reloadDmg = artyConfOf(t).dmg;
  else {
    var reloadSpec = (typeof HELI_RKT_SPEC !== 'undefined') ? HELI_RKT_SPEC[kind] : null;
    reloadDmg = reloadSpec && reloadSpec.dmg ? reloadSpec.dmg : 60;
  }
  return rocketPodCountOf(t) * 1.0 * (reloadDmg / 60);   // 1s/发 × 基础弹型伤害系数(dmg/60)
}
var heliMissileMat = new THREE.MeshLambertMaterial({ vertexColors: true });
var MSL_MAX = 64;   // 任务24:直升机(每队最多 4×8=32)+防空车(PGZ 12/蓝方防空车 24)同场对射可破 32 → 超限导弹隐形(有尾迹无弹体);扩到 64 消除
var missileBodiesTy90 = null, missileBodiesAim92 = null, missileFlames = null;
var decoyFlashGeo = null, decoyFlashMat = null, decoyFlashMesh = null;
var DECOY_FLASH_CAP = 160;

function initHeliMissileVfx() {
  missileBodiesTy90 = new THREE.InstancedMesh(ty90MissileGeo, heliMissileMat, MSL_MAX);
  missileBodiesAim92 = new THREE.InstancedMesh(aim92MissileGeo, heliMissileMat, MSL_MAX);
  missileFlames = new THREE.InstancedMesh(rocketFlameGeo, rocketFlameMat, MSL_MAX);
  decoyFlashGeo = new THREE.SphereGeometry(0.14, 8, 6);
  decoyFlashMat = new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.96 });
  decoyFlashMesh = new THREE.InstancedMesh(decoyFlashGeo, decoyFlashMat, DECOY_FLASH_CAP);
  [missileBodiesTy90, missileBodiesAim92, missileFlames, decoyFlashMesh].forEach(function (im) {
    im.count = 0;
    im.frustumCulled = false;
    im.castShadow = false;
    im.receiveShadow = false;
    scene.add(im);
  });
}

function heliMissileVfxPass() {
  if (!missileBodiesTy90 || !missileBodiesAim92) return;
  var nPl12 = 0, nAim9 = 0, nFlame = 0;
  for (var i = 0; i < airborneMissiles.length; i++) {   // 子列表迭代(免全 shells 扫描)
    var s = airborneMissiles[i];
    if (!s.isHeliMissile) continue;
    _v1.copy(s.vel).normalize();
    _shQ.setFromUnitVectors(_shZ, _v1);
    _shM.compose(s.pos, _shQ, _shS.set(1, 1, 1));
    if (s.missileType === 'ty90' || s.missileType === 'redMbt1') {
      if (nPl12 < MSL_MAX) missileBodiesTy90.setMatrixAt(nPl12++, _shM);
    } else {
      if (nAim9 < MSL_MAX) missileBodiesAim92.setMatrixAt(nAim9++, _shM);
    }
    if (s.flightT < 5.5 && nFlame < MSL_MAX) {
      var nozzleOffset = HELI_MSL_SPEC[s.missileType] ? HELI_MSL_SPEC[s.missileType].nozzle : 0.88;
      _rkP.copy(s.pos).addScaledVector(_v1, -nozzleOffset);
      var pulse = 1.0 + 0.08 * Math.sin(s.flightT * 28);
      var fw = 0.92 * pulse, lf = 1.45 * pulse;
      _rkM.compose(_rkP, _shQ, _rkS.set(fw, fw, lf));
      missileFlames.setMatrixAt(nFlame++, _rkM);
    }
  }
  missileBodiesTy90.count = nPl12;
  missileBodiesAim92.count = nAim9;
  missileFlames.count = nFlame;
  missileBodiesTy90.instanceMatrix.needsUpdate = true;
  missileBodiesAim92.instanceMatrix.needsUpdate = true;
  missileFlames.instanceMatrix.needsUpdate = true;
}

/* Countermeasure flare points are deliberately tiny emissive spheres rather than
   smoke or particles: the four points remain readable while their shared line
   slots show the four release trajectories. */
function heliDecoyVfxPass() {
  if (!decoyFlashMesh) return;
  var n = 0;
  for (var i = 0; i < heliDecoys.length && n < DECOY_FLASH_CAP; i++) {
    var d = heliDecoys[i];
    if (!d || !d.alive) continue;
    var pulse = 1.0 + 0.34 * Math.sin(d.flightT * 22.0);
    _shM.compose(d.pos, _shQ.identity(), _shS.set(pulse, pulse, pulse));
    decoyFlashMesh.setMatrixAt(n++, _shM);
  }
  decoyFlashMesh.count = n;
  decoyFlashMesh.visible = n > 0;
  if (n) decoyFlashMesh.instanceMatrix.needsUpdate = true;
}

/* ===== 火箭弹视觉:真实弹形暗钢弹体 + 实例化自绘尾焰 ----
   弹体按 M-13 比例 132mm×1.41m(×1.15 游戏可读放大),走场景光照且不自亮;尾焰为
   MeshBasic 顶点渐色锥,普通透明混合、无反光/泛光/动态灯;全航程保持暖白尾焰,
   不叠加专属喷射尾焰贴图,comic.js 只生成中央单团烟。
   渲染=全场2个InstancedMesh(弹体/尾焰各1 draw call,容量192),无逐弹scene增删。 ===== */
function buildRocketShellGeo() {   // 合并弹体:主舱+弹头锥+喷管+四片尾翼(顶点色一次烘焙,复用载具合并管线)
  var S = 1.15, parts = [
    { g: new THREE.CylinderGeometry(0.085, 0.085, 0.95, 10).rotateX(Math.PI / 2).translate(0, 0, -0.075),  c: [0.353, 0.376, 0.290] },   // 主舱(橄榄钢)
    { g: new THREE.ConeGeometry(0.085, 0.30, 10).rotateX(Math.PI / 2).translate(0, 0, 0.55),               c: [0.302, 0.314, 0.322] },   // 弹头锥(深钢)
    { g: new THREE.CylinderGeometry(0.062, 0.047, 0.14, 8).rotateX(Math.PI / 2).translate(0, 0, -0.62),    c: [0.153, 0.157, 0.169] }    // 喷管(熏黑)
  ];
  for (var f = 0; f < 4; f++) {
    var fin = new THREE.BoxGeometry(0.02, 0.09, 0.30);
    fin.translate(0, 0.10, -0.42); fin.rotateZ(f * Math.PI / 2);
    parts.push({ g: fin, c: [0.228, 0.243, 0.200] });                   // 十字尾翼(暗绿)
  }
  return mergeVisParts(parts).scale(S, S, S);
}
function buildRocketFlameGeo() {   // 单位尾焰锥:底(z=0 喷口)白炽 → 梢(z=−1)橙红,普通透明混合
  var geo = new THREE.ConeGeometry(0.155, 1.0, 10, 3).rotateX(-Math.PI / 2).translate(0, 0, -0.5), i;
  var pos = geo.attributes.position, n = pos.count, col = new Float32Array(n * 3);
  for (i = 0; i < n; i++) {
    var k = clamp(-pos.getZ(i), 0, 1);                                  // 0=喷口白炽 1=焰梢
    col[i * 3] = 1.0 - 0.25 * k; col[i * 3 + 1] = 0.88 - 0.62 * k; col[i * 3 + 2] = 0.70 - 0.64 * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');                                            // 无贴图,省显存
  return geo.scale(1.15, 1.15, 1.15);
}
var rocketShellGeo = buildRocketShellGeo();
var rocketFlameGeo = buildRocketFlameGeo();
var rocketShellMat = new THREE.MeshLambertMaterial({ vertexColors: true });                     // 受光照弹体(不自亮)
var rocketFlameMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.96,
  blending: THREE.NormalBlending, depthWrite: false, toneMapped: false }); // 自绘亮色尾焰;普通透明混合,无反光/泛光
var RK_MAX = 320;                                // 齐射并发上界:RED_MLRS 40 发×(AI 4+玩家 1) + BLUE_MLRS 6 发×AI 4 + 直升机火箭 ≈ 224(余量 1.4×)
var rocketBodies = null, rocketFlames = null;    // 全场各 1 个 InstancedMesh(initRocketVfx 建,弹体/尾焰各 1 draw call)
function initRocketVfx() {
  rocketBodies = new THREE.InstancedMesh(rocketShellGeo, rocketShellMat, RK_MAX);
  rocketFlames = new THREE.InstancedMesh(rocketFlameGeo, rocketFlameMat, RK_MAX);
  rocketBodies.count = 0; rocketFlames.count = 0;
  rocketBodies.frustumCulled = false; rocketFlames.frustumCulled = false;   // 数量=实时在飞弹数,包围球剔除会误杀
  scene.add(rocketBodies); scene.add(rocketFlames);
}
var RK_NOZZLE = 0.845;                           // 喷口锚点在弹心后的距离(尾焰/烟迹/光晕共用)
/* rocket 弹体/尾焰 scratch(复用,热路径避免每帧 GC) */
var _rkM = new THREE.Matrix4(), _rkQ = new THREE.Quaternion(), _rkP = new THREE.Vector3(), _rkS = new THREE.Vector3(),
    _rkZ = new THREE.Vector3(0, 0, 1);
// 每帧一次:把所有在飞火箭弹的弹体/尾焰/夜晕摆位(2 draw call 收尾全部弹体渲染)
function rocketVfxPass() {
  if (!rocketBodies) return;                   // init 前(或清场后)安全早退
  var n = 0;
  rocketFlameMat.opacity = 1.0;
  rocketFlameMat.color.setHex(0xffffdc);                       // 黑暗中保持暖白炽亮,不受场景光照
  for (var i = 0; i < shells.length && n < RK_MAX; i++) {
    var s = shells[i];
    if (!s.arty && !s.isHeliRocket) continue;
    _v1.copy(s.vel).normalize();                                  // 弹轴 = 弹道切向(stepShells 每帧维护)
    _rkQ.setFromUnitVectors(_rkZ, _v1);
    _rkM.compose(s.pos, _rkQ, _rkS.set(1, 1, 1));
    rocketBodies.setMatrixAt(n, _rkM);
    var fw = 1.0, lf = 1.2;
    if (s.arty && s.rk) {
      var rk = s.rk, burn = rk.tF < ROCKET_PROF.tBurn;
      var pulse = 1 + 0.065 * Math.sin(rk.tF * 23 + (rk.fxPhase || 0));
      if (burn) { fw = 1.03 * pulse; lf = 1.22 * (2 - pulse); }
      else { fw = 0.70 * pulse; lf = 0.76 * (2 - pulse); }
      fw *= 1.48; lf *= 1.82;
    } else if (s.isHeliRocket) {
      var pulse = 1 + 0.08 * Math.sin((s.life || 0) * 28);
      fw = 0.9 * pulse; lf = 1.35 * pulse;
    }
    _rkP.copy(s.pos).addScaledVector(_v1, -RK_NOZZLE);            // 尾焰锚点=喷口
    _rkM.compose(_rkP, _rkQ, _rkS.set(Math.max(fw, 0.001), Math.max(fw, 0.001), Math.max(lf, 0.001)));
    rocketFlames.setMatrixAt(n, _rkM);
    n++;
  }
  rocketBodies.count = n; rocketFlames.count = n;
  rocketBodies.instanceMatrix.needsUpdate = true;
  rocketFlames.instanceMatrix.needsUpdate = true;
}
var _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
var _mslAcc = new THREE.Vector3();   // stepShells 制导武器合力累加器(推力/阻力/重力/转向力, 每步重建, 不持引用)
var _gaDir = new THREE.Vector3();      // 实测炮管世界方向 scratch(AI 火箭炮/火炮伺服共用)
var _vComp = new THREE.Vector3();      // 主炮弹道装定:准星视线方向临时向量
var _vAim = new THREE.Vector3();       // 视轴着点 P(汇瞄目标)临时向量
var _qAim = new THREE.Quaternion(), _qAim2 = new THREE.Quaternion();
var _eulHeli = new THREE.Euler();   // 车体姿态逆(汇瞄走行补偿)临时量
var _vM = new THREE.Vector3();        // 真实炮口指向(含车体姿态/后坐上抬;#ch 投影/后方守卫一律取真值,禁逻辑角代替)
var lastAimT = { y: 0, p: 0, d: 0, s: 0 };   // 汇瞄目标角/着距/投影参数探针(dbg 转录,验收断言用)
var lastPitchComp = 0;                 // 主炮弹道装定超越量(玩家坦克/歼击车,主循环每帧刷新;debug 探针转录)

// 火箭炮出膛原点(弹道解算 + 弹体/焰光出生点共用):贴回车体中轴瞄准线——
// 发射架后置(z−1.5)+俯仰架挂在旋转塔上,真实炮口随发射架转角在中轴线两侧漂移 ≤2.1m,
// 若直接用实测炮口当原点,炮弹视觉(及水平弹道残差)会"从画面角落出发";
// 坦克/歼击车不受影响(塔座居中,原样返回)。红点落点仿真与齐射解算同走此原点 → 首发依然=红点,AI 同法(数值对等)
function artyBoreOrigin(t, dir) {
  var p = new THREE.Vector3();
  t.muzzle.getWorldPosition(p);
  if (t.kind !== 'arty') return p;
  var c = t.group.position;
  var fd = (p.x - c.x) * dir.x + (p.z - c.z) * dir.z;
  p.x = c.x + dir.x * Math.max(fd, 0);
  p.z = c.z + dir.z * Math.max(fd, 0);
  return p;
}

function tryFire(t) {
  if (!t.alive || t.reload > 0 || gameState !== 'playing') return;
  if (t.mods.gun.hp <= 0) {
    if (t.isPlayer && typeof aimHint === 'function') aimHint('CANNOT FIRE');   // 光标上方红字提示(事件触发,节流在 aimHint 内)
    return;
  }
  t.reload = t.reloadTime;
  fireShell(t);
  if (typeof vehicleTechBurstLoadingAfterFire === 'function') vehicleTechBurstLoadingAfterFire(t);
}

/* 16发火箭齐射非重叠散布模板 (爆心间距>=38m,侵入量<=6m < 1/3爆炸半径7.33m,覆盖直径180m杀伤区) */
var ARTY_SALVO_PATTERN = [
  [0, 0],
  [38.00, 0.00], [11.74, 36.14], [-30.74, 22.34], [-30.74, -22.34], [11.74, -36.14],
  [72.28, 23.49], [44.67, 61.49], [0.00, 76.00], [-44.67, 61.49], [-72.28, 23.49],
  [-72.28, -23.49], [-44.67, -61.49], [0.00, -76.00], [44.67, -61.49], [72.28, -23.49]
];
/* 齐射弹数不同 → 图案按弹数取表:首发恒为落区中心(红点=首发铁律),其余黄金角螺旋均布,
   间距随溅射半径等比缩放(锚点:溅射 22m → 间距 38m;BLUE_MLRS 溅射 44m → 间距 76m)。 */
function _artySpiralPattern(n, spacing) {
  var p = [[0, 0]];
  for (var i = 1; i < n; i++) {
    var r = spacing * 0.62 * Math.sqrt(i), a = i * 2.39996323;
    p.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return p;
}
var ARTY_SALVO_PATTERNS = { 16: ARTY_SALVO_PATTERN, 40: _artySpiralPattern(40, 38), 6: _artySpiralPattern(6, 76) };
function artySalvoPattern(total) { return ARTY_SALVO_PATTERNS[total] || ARTY_SALVO_PATTERN; }

function fireShell(t, disp) {  // disp(仅火箭炮齐射第 2 发起):真物理散布=初速向量/初速扰动,发射架不动
  if (typeof minimapNoteFire === 'function') minimapNoteFire(t);
  if (typeof aaNoteFlash === 'function') aaNoteFlash(t);   // 任务22:直升机机炮开火=闪光暴露(蓝方光学补盲情报源;非直升机为 no-op)
  var dir = new THREE.Vector3();
  t.gunPivot.getWorldDirection(dir);
  var muzzlePos = artyBoreOrigin(t, dir);   // 出膛原点:中轴瞄准线(火箭炮,见函数注释)
  var isArty = t.kind === 'arty';
  var speed = isArty ? (t.rocketV || artyConfOf(t).rocketSpeed) : (t.shellSpeed0 || CONF.shellSpeedE) * barrelEff(t);   // 初速 ∝ 炮管血量%;火箭炮走阵营规格(RED_MLRS/BLUE_MLRS)
  var acc = t.isPlayer
    ? aiBaseDispersion(t, isFinite(t.lastAimD) ? t.lastAimD : 260)   // 玩家与 AI 完全同源——选什么载具用什么散布(车组系数+距离公式)
    : t.ai.acc;
  // 黑夜视野模糊:AI 直瞄(坦克/歼击车)出膛散布 × nightAimMul(目标距离) ——夜间远距越瞄越虚;
  //   玩家肉眼不受影响;火箭炮齐射物理散布不动(±(22+22)m 等效玩家/AI 同款=长期铁律,微光对无控火箭无意义)
  var nmAI = 1;
  if (!t.isPlayer && !isArty) {
    nmAI = nightAimMul(t.ai.lastAimD || 260);
    if (DBG_ON) {                                                   // 火控审计环仅验收用:生产零分配(数据只被 dbg.aimAudit 钩子读)
      aimAudit.push({ tm: t.team, d: t.ai.lastAimD || 0, nm: nmAI });   // (验收:双方 AI 夜间远距 nm>1)
      if (aimAudit.length > 600) aimAudit.splice(0, aimAudit.length - 600);
    }
  }
  acc *= nmAI;
  var accAz = acc, accEl = acc;

  if (isArty) {
    // 齐射弹道分配: 全部火箭弹在落区形成无缝且不重叠的覆盖(间距随溅射半径等比:22m→38m 锚点;RED_MLRS 40 发/BLUE_MLRS 6 发各自成表)
    var salvoTotal = artyConfOf(t).salvo || 16;
    var shotIdx = (t.salvoLeft != null && t.salvoLeft >= 0) ? (salvoTotal - 1 - t.salvoLeft) : 0;
    var _pat = artySalvoPattern(salvoTotal);
    if (shotIdx < 0 || shotIdx >= _pat.length) shotIdx = 0;

    var _rkMz = t._rktMuzzle;                          // ★逐发发射位置=本发弹头建模中心(RED_MLRS:与视觉消耗同索引,发射谁谁消失;BLUE_MLRS:六管口圆心)
    if (_rkMz && _rkMz.pos && _rkMz.pos.length) {
      var _rkO = _rkMz.pos[shotIdx % _rkMz.pos.length];
      _rkMz.obj.position.set(_rkO[0], _rkO[1], _rkO[2]);
      _rkMz.obj.updateWorldMatrix(true, false);
      muzzlePos.setFromMatrixPosition(_rkMz.obj.matrixWorld);
    }

    var aimX = t._salvoAimX, aimZ = t._salvoAimZ;
    if (aimX == null || aimZ == null) {
      if (t.isPlayer && t._artyAim && isFinite(t._artyAim.x)) {
        aimX = t._salvoAimX = t._artyAim.x;
        aimZ = t._salvoAimZ = t._artyAim.z;
      } else {
        var baseR = t.artyRange || (t.ai && t.ai.lastAimD) || 300;
        aimX = t._salvoAimX = muzzlePos.x + dir.x * baseR;
        aimZ = t._salvoAimZ = muzzlePos.z + dir.z * baseR;
      }
    }

    if (t._rktPack) {                                    // RED_MLRS 火箭弹视觉消耗:每发离轨按发射顺序隐藏一枚(updatePHL11Rockets 逐帧同步 count)
      if (t._rktLeft == null) t._rktLeft = salvoTotal;
      if (t._rktLeft > 0) t._rktLeft--;
    }
    var patOffset = _pat[shotIdx];
    var targetX = aimX + patOffset[0];
    var targetZ = aimZ + patOffset[1];
    var targetY = terrainH(targetX, targetZ);

    var dX = targetX - muzzlePos.x, dZ = targetZ - muzzlePos.z;
    var R_k = Math.sqrt(dX * dX + dZ * dZ);
    var psi_k = Math.atan2(dX, dZ);
    var H_k = muzzlePos.y - targetY;

    var sol_k = rocketSolve(R_k, H_k);
    var baseSpeed = sol_k.v;
    var theta_k = sol_k.theta;
    var cpK = Math.cos(theta_k), spK = Math.sin(theta_k);
    dir.set(Math.sin(psi_k) * cpK, spK, Math.cos(psi_k) * cpK);
    speed = baseSpeed;

    if (disp) {
      accAz = ARTY_SALVO_AZ; accEl = ARTY_SALVO_EL;
      speed *= 1 + (rand(-1, 1) + rand(-1, 1)) * ARTY_SALVO_VJIT;
    } else {
      accAz = 0; accEl = 0;
    }
  }

  var upv = Math.abs(dir.y) > 0.99 ? _v1.set(1, 0, 0) : _v1.set(0, 1, 0);
  var p1 = _v2.crossVectors(dir, upv).normalize();   // p1=方位轴(水平),p2=纵轴(弹道面内)
  var p2 = _v3.crossVectors(dir, p1).normalize();
  if (accAz > 0 || accEl > 0) {
    dir.addScaledVector(p1, rand(-1, 1) * accAz).addScaledVector(p2, rand(-1, 1) * accEl).normalize();
  }

  if (isArty) {
    // 火箭发射瞬间贴脸/零距离命中判定(检查发射口极近距离内是否有障碍物或敌车)
    ray.set(muzzlePos, dir);
    ray.far = 0.6;
    var initHits = losIntersect(muzzlePos.x, muzzlePos.z, muzzlePos.x + dir.x * 0.6, muzzlePos.z + dir.z * 0.6, ray);
    for (var ihi = 0; ihi < initHits.length; ihi++) {
      var ih = initHits[ihi];
      var iud = ih.object.userData;
      if (iud.obstacle) {
        artilleryBurst(ih.point, t);
        return;
      }
      var itk = iud.tank;
      if (itk && itk !== t) {
        if (!itk.alive) {
          artilleryBurst(ih.point, t);
          return;
        }
        // 贴脸直击同走战斗部穿深闸门(弹体未生成, 用发射方穿深口径组最小弹体描述; 未击穿→伤害归零, 起爆照常)
        if (warheadPenRoll({ pen: t.pen, dmg: t.dmg, owner: t }, itk, iud.key, ih, dir)) {
          applyModuleDamage(itk, iud.key, t.dmg, t, ih.point, 0);
        }
        artilleryBurst(ih.point, t);
        return;
      }
    }
  }

  // 坦克炮弹不再建逐发网格——弹体走全场实例化(shellVfxPass,2 draw call);火箭弹体/尾焰沿用 rocketVfxPass
  /* 火箭弹寿命=真实飞行时间+20s 余量(40km 高抛 tof≈99s,旧固定 30s 会在半途蒸发);坦克炮弹照旧 4s */
  var _shLife = isArty ? Math.max(30, 2 * speed * Math.max(0.08, dir.y) / CONF.gravity + 20) : 4;
  var shN = {
    pos: muzzlePos.clone(),
    vel: dir.clone().multiplyScalar(speed),
    owner: t, pen: t.pen * (isArty ? 1 : barrelEff(t)), dmg: t.dmg, life: _shLife, trailT: 0, _comicLineT: 0, _comicLineSlot: -1, _comicLineDone: false, _lineU: 0,   // 穿深同因子
    kdrag: isArty ? 0 : (t.penKd || 0), flyD: 0,     // 穿深存速衰减:口径阻力系数(1/m)·真实飞行里程(命中结算用,见 resolveHit)
    arty: isArty,
    /* RED-MLRS and BLUE-MLRS share the same player upgrade tree and guided
       rocket behavior; faction-specific ballistics still come from artyConfOf(t). */
    _artyGuided: isArty && t.isPlayer === true &&
      ((typeof vehicleTechGuidedWarheadInstalled === 'function' && vehicleTechGuidedWarheadInstalled(t)) || t._techGuidedWarhead === true),
    _artyGuidanceActive: false,
    _artyGuideTarget: null,
    _artyCoverageX: isArty ? t._salvoAimX : null,
    _artyCoverageZ: isArty ? t._salvoAimZ : null,
    _artyCoverageR: 0
  };
  if (shN._artyGuided) {
    shN._artyCoverageR = (typeof artyCoverageRadius === 'function') ? artyCoverageRadius(t) : ((artyConfOf(t).splashR || 22));
  }
  shN._lineP0x=shN.pos.x;shN._lineP0y=shN.pos.y;shN._lineP0z=shN.pos.z;
  shN._lineV0x=shN.vel.x;shN._lineV0y=shN.vel.y;shN._lineV0z=shN.vel.z;
  if (!isArty && t._cmdG && !t._cmdG._detached) { t._cmdG.shots++; shN.g = t._cmdG; }   // 组级命中率账:开火计射击,组引用定格到弹体(命中在 stepShells 计;火箭炮/玩家/接管组不计)
  abandonNoteFire(t);   // 断油弃车观察:射击重置 60s 窗口(规则②;O(1) 空判)
  if (isArty) {
    // 真实速度剖面参数入账:P0(出膛点)/V0(旧解弹道初速)→ 解析弧;u/tF 由 rocketUStep 推进(见 stepShells)
    shN.rk = { p0x: shN.pos.x, p0y: shN.pos.y, p0z: shN.pos.z,
               v0x: shN.vel.x, v0y: shN.vel.y, v0z: shN.vel.z,
               u: 0, tF: 0, tof0: shellTof0(dir.y, speed), fxPhase: Math.random() * TAU }; // 视觉相位仅发射事件取样一次
  }
  shells.push(shN);

  /* 只有主炮事件需要600m/炮镜门;火箭全航程视觉不做逐发视域检测。
     主炮不使用 PointLight/粒子照明,亮度由事件捕获的车体/地面高亮贴图接管。 */
  var comicGunVisible = !isArty && typeof comicMuzzleBurst === 'function' &&
    (typeof fxEventVisible !== 'function' || fxEventVisible(muzzlePos));
  if (typeof comicRocketLineStart === 'function') comicRocketLineStart(shN); // 主炮弹/火箭共用150m解析尾迹槽
  if (!isArty) {
    /* 主炮:一次事件生成整张火光、烟和高亮 halo。 */
    if (comicGunVisible) comicMuzzleBurst(muzzlePos, dir, t.kind === 'td' ? 3.6 : 3.2, t.muzzle, t); // 小爆烟在0.5s边沿只采样一次实时炮口(连射超发仅末发)
  } else {
    /* 火箭发射:只登记发射架根部中央单团烟及解析弹道线。 */
    if (typeof comicRocketLaunchBurst === 'function') comicRocketLaunchBurst(t, dir, null, t.dmg);
  }
  var vFire = t.isPlayer ? (isArty ? 0.45 : FIRE_VOL) : volAt(muzzlePos, isArty ? 1.2 : 0.8 * FIRE_VOL);   // 火箭发射收敛:单发≈坦克炮峰值 1/3、16 齐射峰值≈0.55× 单炮(烘焙 RMS 实测审计);坦克炮 1/0.8×FIRE_VOL(=5.0,2026-09-09 炮声×2);AI 火箭 base 0.28→1.2(2026-09-09):原值远场剩 0.011,187m 外即被 playShot 门丢光致中距齐射无声,1.2 远场保底 0.048 全程可闻,近场峰值由压缩主链兜底
  var dFire = (!t.isPlayer && player && player.group) ? muzzlePos.distanceTo(player.group.position) : 0;
  sfxFire(vFire, dFire, isArty);
  if (isArty && typeof sfxRocketWhoosh === 'function') sfxRocketWhoosh(muzzlePos, speed);
  if (DBG_ON) { dbgStats[t.team].fire++; if (isArty) dbgStats[t.team].artyFire++; }
  /* 通用方向后坐——开火当帧按炮口-车体中轴夹角 θ 分解后坐力,方向锁定不随再回转变化:
     轴向力 ∝ cosθ:锐角=向前开火→车体后坐;钝角=朝后开火→车体前冲;侧向≈0 无轴向窜动;
     水平力 ∝ sinθ:朝右/朝左开火→对应方向摇摆,幅度∝|sinθ|。 */
  var ty0 = t.turretYaw || 0;
  t.recAx = Math.cos(ty0); t.recLat = Math.sin(ty0);
  var isHeli = isHeliVehicle(t) || (typeof isAAVehicle === 'function' && isAAVehicle(t));   // AA 机炮=直升机机炮性能口径 → 后坐同档(25mm 双联对 22.5t 车体近乎无感)
  t.speed -= (isArty ? 0.25 : (isHeli ? 0.03 : (t.isPlayer ? 2.2 : 1.2))) * t.recAx;   // 轴向冲量:向后/向前/无,直升机机炮后坐轻微
  t.recT = 0;                                                     // 后坐动画起跑:身管急退(炮塔本地系,任意朝向)+车体纵摇/横摇(见 alignTank)
  if (t.isPlayer) camPK = isHeli ? 0.08 : 1;   // camPK 仅在开镜时顶起炮镜;后坐体现=炮口真实上抬+准星晃后复位(recPitchK 挂在伺服目标)
}

/* ===== 直升机多种机载武器发射系统 (火箭巢 / 导弹) ===== */
function heliRocketPodOrigin(t, side) {
  var p = new THREE.Vector3();
  var isWz = t.kind === 'wz10';
  var lx = side === 0 ? (isWz ? -1.35 : -2.28) : (isWz ? 1.35 : 2.28);   // BLUE_HELI 火箭巢移外侧挂点
  var ly = isWz ? 1.42 : 1.47;
  var lz = isWz ? 0.77 : 1.10; // 火箭巢前端口盖7管真实出膛基准
  p.set(lx, ly, lz);
  t.group.localToWorld(p);
  return p;
}

/* 多联装挂架筒位出膛原点(tube=0..tubes-1,与 spawn 筒位网格同序):
   红方机载导弹: 2×2 网格,弹体中心 (±2.05, 1.52, -0.20),半长 0.93 → 弹头出口 z=+0.73
   蓝方机载导弹: 横排双筒,弹体中心 (±1.52, 1.44, 0.22),半长 0.76 → 弹头出口 z=+0.98 */
function heliMissileTubeLocal(t, side, tube) {
  var isWz = t.kind === 'wz10';
  var mslMax = heliMslTubesOf(t);
  var ti = Math.min(Math.max(tube | 0, 0), mslMax - 1);
  var sx = side === 0 ? -1 : 1;                       // side 0=左翼(-x), 1=右翼(+x)
  if (isWz) {   // 2×2 矩阵: 筒序 0/1=下排内外, 2/3=上排内外
    return [sx * (2.05 + ((ti % 2) * 0.12 - 0.06)), 1.46 + (Math.floor(ti / 2) * 0.12 - 0.06), 0.73];
  }
  // BLUE_HELI 2×2 四联装矩阵: 筒序 0/1=下排内外, 2/3=上排内外
  return [sx * (1.52 + ((ti % 2) * 0.12 - 0.06)), 1.44 + (Math.floor(ti / 2) * 0.12 - 0.06), 0.98];
}

function heliMissilePylonOrigin(t, side, tube) {
  var p = new THREE.Vector3();
  var loc = heliMissileTubeLocal(t, side, tube || 0);
  p.set(loc[0], loc[1], loc[2]);
  t.group.localToWorld(p);
  return p;
}

/* 机身长轴世界方向 (group 本地 +Z): 含偏航与俯仰, 天然不受横滚影响(横滚=绕本轴自转)
   —— 固定式挂架/火箭巢的唯一发射基准, 与 heliMissilePylonOrigin/heliRocketPodOrigin 的出膛点同一姿态源 */
var _heliAxisDir = new THREE.Vector3();
function heliBodyAxisDir(t, out) {
  var v = out || _heliAxisDir;
  t.group.getWorldDirection(v);
  return v.normalize();
}

/* ===== 直升机诱饵弹 =====
   Four countermeasures leave the belly in a left-front, left-rear, right-front,
   right-rear fan. They have no collision damage; their real positions are still
   simulated so both the visible point and the lure seeker use the same object. */
var _decoyRight = new THREE.Vector3(), _decoyFront = new THREE.Vector3(), _decoyBase = new THREE.Vector3(),
    _decoyLocal = new THREE.Vector3(), _decoyLaunch = new THREE.Vector3(), _decoyVel = new THREE.Vector3();
function fireHeliDecoyBurst(t) {
  if (!t || !t.alive || !isHeliVehicle(t) || !t.group) return false;
  var q = new THREE.Quaternion();
  t.group.getWorldQuaternion(q);
  _decoyFront.copy(heliBodyAxisDir(t, _decoyFront));
  _decoyRight.set(1, 0, 0).applyQuaternion(q).normalize();
  var vx = t._heliVx || 0, vy = t._heliVy || 0, vz = t._heliVz || 0;
  var order = [[-1, 1], [-1, -1], [1, 1], [1, -1]];
  for (var i = 0; i < HELI_DECOY_BURST_SIZE; i++) {
    var side = order[i][0], fore = order[i][1];
    _decoyLocal.set(side * 0.36, 0.70, fore * 0.28);
    _decoyBase.copy(_decoyLocal);
    t.group.localToWorld(_decoyBase);
    _decoyLaunch.copy(_decoyFront).multiplyScalar(fore * 0.72).addScaledVector(_decoyRight, side * 0.84).normalize();
    _decoyVel.set(vx, vy, vz).addScaledVector(_decoyLaunch, 42.0);
    _decoyVel.y -= 6.0;
    var d = {
      pos: _decoyBase.clone(), vel: _decoyVel.clone(), owner: t, alive: true,
      life: 6.0, flightT: 0, _trailT: 0,
      _comicLineT: 0, _comicLineSlot: -1, _comicLineDone: false, _lineU: 0,
      _traj: [_decoyBase.x, _decoyBase.y, _decoyBase.z],
      isDecoy: true, isHeliRocket: true
    };
    heliDecoys.push(d);
    if (typeof comicRocketLineStart === 'function') comicRocketLineStart(d);
  }
  return true;
}
function _removeHeliDecoy(i) {
  var d = heliDecoys[i];
  if (!d) return;
  d.alive = false;
  if (d._comicLineSlot >= 0 && typeof comicRocketLineEnd === 'function') comicRocketLineEnd(d);
  heliDecoys.splice(i, 1);
}
function updateHeliDecoys(dt) {
  for (var i = heliDecoys.length - 1; i >= 0; i--) {
    var d = heliDecoys[i];
    if (!d || !d.alive) { _removeHeliDecoy(i); continue; }
    d.life -= dt; d.flightT += dt;
    if (d.life <= 0) { _removeHeliDecoy(i); continue; }
    d.pos.x += d.vel.x * dt; d.pos.y += d.vel.y * dt; d.pos.z += d.vel.z * dt;
    d.vel.y -= 5.5 * dt;
    var drag = Math.max(0, 1.0 - 0.22 * dt);
    d.vel.x *= drag; d.vel.z *= drag;
    var gy = terrainH(d.pos.x, d.pos.z);
    if (d.pos.y <= gy + 0.12) {
      d.pos.y = gy + 0.12;
      _removeHeliDecoy(i);
      continue;
    }
    d._trailT -= dt;
    if (d._trailT <= 0) {
      d._trailT = 0.025;
      if (typeof comicRocketLineUpdate === 'function') comicRocketLineUpdate(d);
    }
  }
}
function clearHeliDecoys() {
  for (var i = heliDecoys.length - 1; i >= 0; i--) _removeHeliDecoy(i);
  if (decoyFlashMesh) { decoyFlashMesh.count = 0; decoyFlashMesh.visible = false; }
}

/* ===== 战场边界接触事件触发器 (适配任意尺寸地图,纯事件状态门控,零逐帧轮询) ===== */
var _boundWarnState = false;
function onPlayerBoundaryContact(atBoundary) {
  if (_boundWarnState === atBoundary) return;
  _boundWarnState = atBoundary;
  var bwEl = (typeof el !== 'undefined' && el.boundwarn) ? el.boundwarn : (typeof document !== 'undefined' ? document.getElementById('boundwarn') : null);
  if (bwEl) {
    bwEl._on = atBoundary;
    bwEl.classList.toggle('hidden', !atBoundary);
  }
}

/* 航空火箭弹真实物理弹道落点仿真 (规格初速 + 重力 + 二次阻力, 与 stepShells 弹道同口径) */
function simulateHeliRocketImpact(from, v0, g, dragK) {
  var px = from.x, py = from.y, pz = from.z;
  var vx = v0.x, vy = v0.y, vz = v0.z;
  var dt = 0.025;
  var maxT = 8.0;
  for (var t = 0; t < maxT; t += dt) {
    var npx = px + vx * dt;
    var npy = py + vy * dt - 0.5 * g * dt * dt;
    var npz = pz + vz * dt;
    var spd = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    var drF = Math.max(0, (spd - (dragK || 0) * spd * spd * dt) / spd);   // 二次阻力沿速度反向
    vx *= drF; vy = vy * drF - g * dt; vz *= drF;
    var th = terrainH(npx, npz);
    if (npy <= th) {
      return {
        point: new THREE.Vector3(npx, th + 0.1, npz),
        dist: from.distanceTo(new THREE.Vector3(npx, th, npz)),
        tof: t + dt
      };
    }
    px = npx; py = npy; pz = npz;
  }
  return null;
}

function fireHeliRocket(t, side) {
  if (typeof minimapNoteFire === 'function') minimapNoteFire(t);
  if (typeof aaNoteFlash === 'function') aaNoteFlash(t);   // 任务22:火箭开火=闪光暴露
  var rk = HELI_RKT_SPEC[t.kind] || HELI_RKT_SPEC.ah64;
  var guided = rk.guidance === 'datalink';   // 制导模式: 'datalink'=制导数据链; 无=无制导弹道飞行
  var rocketDmg = rocketDamageOf(t);
  var airburst = t.kind === 'wz10' && t.isPlayer === true && t.team === 'red' &&
    ((typeof vehicleTechAirburstRocketInstalled === 'function' && vehicleTechAirburstRocketInstalled(t)) || t._techAirburstRound === true);
  // 固定式火箭巢: 两型统一沿机身长轴离架(含俯仰) —— 与出膛点同一姿态源, 转向由制导段承担
  var dir = heliBodyAxisDir(t, new THREE.Vector3());
  var muzzlePos = heliRocketPodOrigin(t, side || 0);

  // 物理散布与火箭炮一致
  var accAz = ARTY_SALVO_AZ, accEl = ARTY_SALVO_EL;
  var upv = Math.abs(dir.y) > 0.99 ? _v1.set(1, 0, 0) : _v1.set(0, 1, 0);
  var p1 = _v2.crossVectors(dir, upv).normalize();
  var p2 = _v3.crossVectors(dir, p1).normalize();
  dir.addScaledVector(p1, rand(-1, 1) * accAz).addScaledVector(p2, rand(-1, 1) * accEl).normalize();

  var vHeliX = t._heliVx || 0, vHeliY = t._heliVy || 0, vHeliZ = t._heliVz || 0;
  var rSpd = rk.v0; // 火箭弹 Mach2 / Mach2.2 —— 发射后无助推纯减速(阻力), v0 即最大速度
  var rVel = new THREE.Vector3(vHeliX + dir.x * rSpd, vHeliY + dir.y * rSpd, vHeliZ + dir.z * rSpd);
  var sh = {
    pos: muzzlePos.clone(),
    vel: rVel,
    owner: t,
    target: guided ? ((typeof allocateGuidedFireTarget === 'function') ? allocateGuidedFireTarget(t, rk) : null) : null,   // 70mm火箭弹: 按本弹型(对地)规格分配目标(数据链逐帧刷新)
    pen: rk.pen != null ? rk.pen : 800,     // 战斗部直击穿深由弹型规格驱动
    guided: guided,                        // 制导标志(无制导火箭不入火力分配子列表)
    dmg: rocketDmg,
    _airburst: airburst,
    life: rk.life,
    rktType: t.kind,
    trailT: 0,
    _comicLineT: 0,
    _comicLineSlot: -1,
    _comicLineDone: false,
    _lineU: 0,                                          // 尾迹准入标志(_rklGetK 判空用);直升机弹尾迹走 _traj 折线
    _traj: [muzzlePos.x, muzzlePos.y, muzzlePos.z],   // 真实航迹记录锚点(发射点)
    isHeliRocket: true
  };
  shells.push(sh);
  if (guided) airborneGuidedRockets.push(sh);   // 在空制导火箭子列表登记(供火力分配计数, removeShell 收割)
  if (typeof comicRocketLineStart === 'function') comicRocketLineStart(sh);
  if (typeof comicRocketLaunchBurst === 'function') comicRocketLaunchBurst(t, dir, muzzlePos, rocketDmg);
  sfxFire(t.isPlayer ? 0.38 : 0.22, 0, true);
  if (typeof sfxRocketWhoosh === 'function') sfxRocketWhoosh(muzzlePos, rSpd);
}

/* 弹体 → 弹型规格反查 (通用制导分配/重分配按弹各自的规格取参数, 免调用方各自拼表)
   唯一三消费点: stepShells 制导主循环 / 雷达取消锁定后的在飞弹重分配; 缺失型号回落本阵营缺省弹型。
   missileType 在离架时由 heliMslTypeOf(载具) 写入且载具 kind 不变 ⇒ 弹体自述与母机派生等价。 */
function heliGuidedSpecOf(sh) {
  if (!sh) return null;
  if (sh.isHeliMissile) return HELI_MSL_SPEC[sh.missileType] || HELI_MSL_SPEC.ty90;
  if (sh.isHeliRocket) return HELI_RKT_SPEC[sh.rktType] || HELI_RKT_SPEC.ah64;
  return null;
}

/* ===== 通用制导武器火力动态分配函数 (导弹/制导火箭共用; 型号差异全部由规格字段驱动) =====
   载具完全独立隔离: 只看射手 p 自身的锁定航迹与 p 自身在飞的弹。
   p     射手直升机
   spec  弹型规格 (HELI_MSL_SPEC.x / HELI_RKT_SPEC.x), 本函数消费字段:
           domain  'air'=对空优先 (空空导弹类)
                   'ground'=对地优先 (火蛇-70A 一类对地制导火箭)
                   缺省按 'air' 处理(与旧 getHeliNextFireTarget 同口径)
   分配判据(三级, 依次比较):
     ① 目标域优先: 与弹型同域的目标绝对优先(对空弹不浪费在地面目标上, 反之亦然);
        域内无同域目标时自然降级到另一域 —— 是"优先"不是"只打";
     ② 在飞弹数最少优先: 均摊引导火力, 避免多弹重叠追同一目标;
   ★在飞弹计数必须同时覆盖【导弹子列表 airborneMissiles】与【制导火箭子列表】:
     火蛇-70A 存于 shells 并标记 isHeliRocket,漏数会让全部火箭都被算成"0 枚在飞"
     而堆到同一目标上 = 不分配火力。
   ★excludeShell (可选): 重分配时把"发起本次重分配的弹自己"排除在计数外。
     否则该弹自身占用的名额会算进它当前目标的 count, 使本弹总是被判定为"该目标已满"
     而每帧改投别的目标 —— 逐帧重分配下会持续横跳、永不收敛(等效于不分配火力)。 */
function allocateGuidedFireTarget(p, spec, excludeShell) {
  if (!p || !p.alive) return null;
  var domain = (spec && spec.domain === 'ground') ? 'ground' : 'air';
  if (!p._heliRadarActive || !p._heliRadarTracks || p._heliRadarTracks.length === 0) {
    return p._heliMissileTarget || (p.ai ? p.ai.targetO : null);
  }

  // 1. 收集该直升机自身处于有效锁定状态的目标 (最多4个) —— 方案2:复用 _agLocked scratch(每次 length=0)
  _agLocked.length = 0;
  for (var i = 0; i < p._heliRadarTracks.length; i++) {
    var trk = p._heliRadarTracks[i];
    if (trk.isLocked && trk.tank && trk.tank.alive && trk.tank.group) {
      _agLocked.push(trk);
    }
  }

  if (_agLocked.length === 0) {
    // 无已完成锁定目标 → 不分配制导目标 (锁定中/蓝框目标不参与制导;
    // 导弹降级为光电自主寻的, 70mm火箭弹 惯性直飞 —— AI 走函数开头的无雷达回退,不受影响)
    return null;
  }

  // 2. 统计各锁定目标当前已被这架直升机 p 分配的在飞制导弹数量 (严格按对象引用或唯一 id 比对,且 sh.owner === p)
  //    两个子列表同口径扫描: 导弹(airborneMissiles) + 制导火箭(airborneGuidedRockets)
  //    方案2:复用 _agCounts 对象池(按需扩容,不释放),count/same 每次归零重算,零 GC。
  for (var k = 0; k < _agLocked.length; k++) {
    var slot = _agCounts[k];
    if (!slot) { slot = { track: null, count: 0, same: 0 }; _agCounts[k] = slot; }
    slot.track = _agLocked[k]; slot.count = 0; slot.same = 0;
  }
  var _agN = _agLocked.length;

  for (var li = 0; li < 2; li++) {
    var list = li === 0 ? airborneMissiles : airborneGuidedRockets;
    if (!list || list.length === 0) continue;
    for (var sIdx = 0; sIdx < list.length; sIdx++) {
      var sh = list[sIdx];
      if (sh && sh !== excludeShell && sh.owner === p && sh.target && sh.life > 0) {
        for (var lk = 0; lk < _agN; lk++) {
          var lt = _agCounts[lk].track.tank;
          if (lt === sh.target || (lt.id && sh.target.id && lt.id === sh.target.id)) {
            _agCounts[lk].count++;
            break;
          }
        }
      }
    }
  }

  // 3. 对空/对地分域标记: 目标为直升机(ah64/wz10)即算空中目标
  for (var di = 0; di < _agN; di++) {
    var isAirTgt = isHeliVehicle(_agCounts[di].track.tank);
    _agCounts[di].same = ((domain === 'air') === isAirTgt) ? 1 : 0;
  }

  // 4. 择优(方案2:线性单遍取最优,替代 sort,免比较器闭包分配):
  //    同域优先 → 在飞弹数少的优先 → 准星偏角小的优先(与原比较器严格同序)
  var best = _agCounts[0];
  for (var ci = 1; ci < _agN; ci++) {
    var c = _agCounts[ci];
    var better = false;
    if (c.same !== best.same) better = (c.same > best.same);                 // ① 对空/对地同域优先
    else if (c.count !== best.count) better = (c.count < best.count);        // ② 在飞弹少的优先
    else better = ((c.track.dotWithCursor || -999) > (best.track.dotWithCursor || -999)); // ③ 准星偏角小的优先
    if (better) best = c;
  }

  return best.track.tank;
}
function fireHeliMissile(t, side, target) {
  if (typeof minimapNoteFire === 'function') minimapNoteFire(t);
  if (typeof aaNoteFlash === 'function') aaNoteFlash(t);   // 任务22:导弹开火=闪光暴露
  var sIdx = side || 0;
  // 隐藏本次发射的筒位弹体(多联装:按 _heliMslTube 计数取筒)
  var tubeIdx = (t._heliMslTube && t._heliMslTube[sIdx] != null) ? (t._heliMslTube[sIdx] | 0) : 0;
  var sideMeshes = sIdx === 0 ? t._heliMslMeshesL : t._heliMslMeshesR;
  if (sideMeshes && sideMeshes[tubeIdx]) sideMeshes[tubeIdx].visible = false;

  // 沿机身长轴离架(含俯仰) —— 与挂架出膛点同一姿态源, 转向由离轨后的制导段承担
  var dir = heliBodyAxisDir(t, new THREE.Vector3());
  var muzzlePos = heliMissilePylonOrigin(t, sIdx, tubeIdx);

  var vHeliX = t._heliVx || 0, vHeliY = t._heliVy || 0, vHeliZ = t._heliVz || 0;
  // 弹型口径规格: 红方导弹 2马赫/6km/伤60, 蓝方导弹 2.2马赫/8km/伤55
  var spec = HELI_MSL_SPEC[heliMslTypeOf(t)];
  var mType = heliMslTypeOf(t);
  var vMax = spec.vMax;

  // 导弹离架初速 (与火箭弹同款: 母机三轴惯性速度 + 顺机身长轴×规格极速)
  // 离轨冲量=vMax(680/748): 远超母机 60-90m/s 全向速度 → 离架方向≈弹轴方向(横移小角度/垂直爬升近垂直发射)
  var initialVel = new THREE.Vector3(vHeliX + dir.x * vMax, vHeliY + dir.y * vMax, vHeliZ + dir.z * vMax);
  var v0 = initialVel.length();

  var sh = {
    pos: muzzlePos.clone(),
    vel: initialVel,
    owner: t,
    pen: spec.pen != null ? spec.pen : 90,   // 战斗部直击穿深由弹型规格驱动 (机载导弹统一 90mm)
    dmg: spec.dmg,
    life: spec.life,
    flightT: 0,
    v0: vMax,                                          // 离架即全速: 助推段 aFwd=(vMax-v0)/boostT 自然为0(机制不变), 之后纯阻力+制导(火箭同款)
    vMax: vMax,
    missileType: mType,
    target: target,
    _abgLoan: !!t._abgLoanFire,                            // A射B导借出弹:制导保持改看玩家是否仍锁定(见 heliABGLoanHold)
    trailT: 0,
    _comicLineT: 0,
    _comicLineSlot: -1,
    _comicLineDone: false,
    _lineU: 0,                                          // 尾迹准入标志(_rklGetK 判空用);直升机弹尾迹走 _traj 折线
    _traj: [muzzlePos.x, muzzlePos.y, muzzlePos.z],   // 真实航迹记录锚点(发射点)
    isHeliMissile: true
  };
  shells.push(sh);
  airborneMissiles.push(sh);                          // 空中导弹子列表登记
  if (typeof comicRocketLineStart === 'function') comicRocketLineStart(sh);
  if (typeof comicRocketLaunchBurst === 'function') comicRocketLaunchBurst(t, dir, muzzlePos, spec.dmg);
  if (typeof sfxMissileLaunch === 'function') sfxMissileLaunch(muzzlePos, t.isPlayer ? 0.95 : 0.65);
  if (t.isPlayer && typeof sfxEventVoice === 'function') sfxEventVoice('missile_launch');
  sfxFire(t.isPlayer ? 0.45 : 0.28, 0, false);
  if (typeof sfxRocketWhoosh === 'function') sfxRocketWhoosh(muzzlePos, vMax);
}

/* ===== MBT-1 炮射导弹 =====
   The projectile leaves the real main-gun muzzle and captures its own EO/IR
   seeker state at launch.  It deliberately does not call radar allocation and
   carries fixed 60 damage / 500mm warhead values in its immutable spec. */
function fireRedMbtMissile(t) {
  if (!t || !t.alive || !t.gunPivot || !t.muzzle) return false;
  if (!t._techGunLaunchedMissile || !t.isPlayer || t.team !== 'red' || t.kind !== 'tank') return false;
  if (t.mods && t.mods.ammo && t.mods.ammo.hp <= 0) {
    if (t.isPlayer && typeof aimHint === 'function') aimHint('MISSILE RACK DAMAGED - HOLD FIRE');
    return false;
  }
  if (typeof minimapNoteFire === 'function') minimapNoteFire(t);
  if (typeof aaNoteFlash === 'function') aaNoteFlash(t);

  var spec = HELI_MSL_SPEC.redMbt1;
  var dir = new THREE.Vector3();
  t.gunPivot.getWorldDirection(dir).normalize();
  var muzzlePos = new THREE.Vector3();
  t.muzzle.getWorldPosition(muzzlePos);
  var initialVel = new THREE.Vector3(
    (t.velX || 0) + dir.x * spec.vMax,
    dir.y * spec.vMax,
    (t.velZ || 0) + dir.z * spec.vMax
  );
  var sh = {
    pos: muzzlePos.clone(),
    vel: initialVel,
    owner: t,
    pen: spec.pen,
    dmg: 60,
    life: spec.life,
    flightT: 0,
    v0: spec.vMax,
    vMax: spec.vMax,
    missileType: 'redMbt1',
    target: null,
    seekerOnly: true,
    _seekerOnly: true,
    _mbtGunLaunched: true,
    trailT: 0,
    _comicLineT: 0,
    _comicLineSlot: -1,
    _comicLineDone: false,
    _lineU: 0,
    _traj: [muzzlePos.x, muzzlePos.y, muzzlePos.z],
    isHeliMissile: true
  };
  shells.push(sh);
  airborneMissiles.push(sh);
  if (typeof comicRocketLineStart === 'function') comicRocketLineStart(sh);
  if (typeof comicMuzzleBurst === 'function') comicMuzzleBurst(muzzlePos, dir, 3.2, t.muzzle, t);
  if (typeof comicRocketLaunchBurst === 'function') comicRocketLaunchBurst(t, dir, muzzlePos, spec.dmg);
  if (typeof sfxMissileLaunch === 'function') sfxMissileLaunch(muzzlePos, 0.95);
  if (typeof sfxEventVoice === 'function') sfxEventVoice('missile_launch');
  sfxFire(0.45, 0, false);
  if (typeof sfxRocketWhoosh === 'function') sfxRocketWhoosh(muzzlePos, spec.vMax);
  abandonNoteFire(t);
  t.recAx = Math.cos(t.turretYaw || 0);
  t.recLat = Math.sin(t.turretYaw || 0);
  t.speed -= 2.2 * t.recAx;
  t.recT = 0;
  if (t.isPlayer) camPK = 1;
  return true;
}

/* ===== RED-TD 榴弹 =====
   Weapon 2 is a player-only high-explosive round. It uses the existing rocket
   explosion/splash code at impact (heliRocketBurst), while the projectile itself
   remains a real 1400m/s gravity ballistic shell in the normal shells pipeline. */
function fireRedTdHighExplosive(t) {
  if (!t || !t.alive || !t.gunPivot || !t.muzzle || !t._techHighExplosive ||
      !t.isPlayer || t.team !== 'red' || t.kind !== 'td') return false;
  if (t.mods && t.mods.ammo && t.mods.ammo.hp <= 0) {
    if (typeof aimHint === 'function') aimHint('AMMO RACK DAMAGED - HOLD FIRE');
    return false;
  }
  if (typeof minimapNoteFire === 'function') minimapNoteFire(t);
  var dir = new THREE.Vector3();
  t.gunPivot.getWorldDirection(dir).normalize();
  var muzzlePos = new THREE.Vector3();
  t.muzzle.getWorldPosition(muzzlePos);
  var speed = 1400 * barrelEff(t);
  var initialVel = dir.clone().multiplyScalar(speed);
  var dmg = 180;
  var pen = 500;
  var sh = {
    pos: muzzlePos.clone(), vel: initialVel, owner: t,
    pen: pen, dmg: dmg, life: 4, trailT: 0, flyD: 0, kdrag: 0,
    _he: true, _heBlastRadius: splashRadiusFromDamage(dmg),
    _comicLineT: 0, _comicLineSlot: -1, _comicLineDone: false, _lineU: 0
  };
  shells.push(sh);
  if (typeof comicRocketLineStart === 'function') comicRocketLineStart(sh);
  if (typeof comicMuzzleBurst === 'function') comicMuzzleBurst(muzzlePos, dir, 3.6, t.muzzle, t);
  if (typeof sfxFire === 'function') sfxFire(t.isPlayer ? 0.45 : 0.28, 0, false);
  if (typeof abandonNoteFire === 'function') abandonNoteFire(t);
  var ty0 = t.turretYaw || 0;
  t.recAx = Math.cos(ty0); t.recLat = Math.sin(ty0);
  t.speed -= 2.2 * t.recAx;
  t.recT = 0;
  if (t.isPlayer) camPK = 1;
  return true;
}

/* ===== 防空载具武器 (TASK 18) =====
   发射点=发射架各筒位「导弹弹头建模中心」(_aaMslMuzzle 与火箭炮 _rktMuzzle 同款标记机制);
   发射方向=发射架轴线(炮塔回转 turret × 俯仰 gunPivot 的世界姿态,+Z 轴);
   发射后不管:光电导引头自搜索(findMissileAutonomousOpticalTarget),载具无额外雷达引导。
   红方RED-AA=导弹(680m/s/6km/伤60)/蓝方BLUE-AA=导弹(748m/s/8km/伤55),装填均 40s。 */
function fireAAMissile(t, side, target) {
  if (typeof minimapNoteFire === 'function') minimapNoteFire(t);
  var sIdx = side || 0;
  // 隐藏本次发射的筒位弹体(与直升机多联装同款:按 _heliMslTube 计数取筒,打空开侧装填)
  var tubeIdx = (t._heliMslTube && t._heliMslTube[sIdx] != null) ? (t._heliMslTube[sIdx] | 0) : 0;
  var sideMeshes = sIdx === 0 ? t._heliMslMeshesL : t._heliMslMeshesR;
  if (sideMeshes && sideMeshes[tubeIdx]) sideMeshes[tubeIdx].visible = false;

  // 出膛原点+轴向:发射架轴线 = gunPivot 世界姿态旋转 +Z(炮塔回转+俯仰全继承)
  var dir = new THREE.Vector3(0, 0, 1);
  var muzzlePos = new THREE.Vector3();
  if (t.gunPivot) dir.applyQuaternion(t.gunPivot.getWorldQuaternion(new THREE.Quaternion())).normalize();
  var mz = t._aaMslMuzzle;
  if (mz && mz.pos && mz.pos.length) {
    var slot = sIdx * (mz.perSide || 4) + (tubeIdx % (mz.perSide || 4));   // 左箱(左炮组)在前,右箱在后;筒序=装填消耗序
    var o = mz.pos[slot % mz.pos.length];
    mz.obj.position.set(o[0], o[1], o[2]);
    mz.obj.updateWorldMatrix(true, false);
    muzzlePos.setFromMatrixPosition(mz.obj.matrixWorld);
  } else if (t.muzzle) {
    t.muzzle.getWorldPosition(muzzlePos);
  }

  var spec = HELI_MSL_SPEC[heliMslTypeOf(t)];
  var mType = heliMslTypeOf(t);
  var vMax = spec.vMax;
  // 离架初速:母车三轴惯性速度(地面载具 velX/velZ) + 顺发射架轴线×规格极速(与直升机同款离轨冲量口径)
  var initialVel = new THREE.Vector3((t.velX || 0) + dir.x * vMax, dir.y * vMax, (t.velZ || 0) + dir.z * vMax);

  var sh = {
    pos: muzzlePos.clone(),
    vel: initialVel,
    owner: t,
    pen: spec.pen != null ? spec.pen : 90,
    dmg: spec.dmg,
    life: spec.life,
    flightT: 0,
    v0: vMax,
    vMax: vMax,
    missileType: mType,
    target: target,                                       // RED_AA=雷达/地面目标分配;蓝方无雷达时可由 AI 地面目标引用辅助首帧寻的
    _aaGroundTarget: !!(t.kind === 'aa' && target && typeof isHeliVehicle === 'function' && !isHeliVehicle(target)),
    trailT: 0,
    _comicLineT: 0,
    _comicLineSlot: -1,
    _comicLineDone: false,
    _lineU: 0,
    _traj: [muzzlePos.x, muzzlePos.y, muzzlePos.z],
    isHeliMissile: true                                   // 复用直升机导弹全套飞行/导引头/命中/VFX 管线
  };
  shells.push(sh);
  airborneMissiles.push(sh);
  if (typeof comicRocketLineStart === 'function') comicRocketLineStart(sh);
  if (typeof comicRocketLaunchBurst === 'function') comicRocketLaunchBurst(t, dir, muzzlePos, spec.dmg);
  if (typeof sfxMissileLaunch === 'function') sfxMissileLaunch(muzzlePos, t.isPlayer ? 0.95 : 0.65);
  if (t.isPlayer && typeof sfxEventVoice === 'function') sfxEventVoice('missile_launch');
  sfxFire(t.isPlayer ? 0.45 : 0.28, 0, false);
  if (typeof sfxRocketWhoosh === 'function') sfxRocketWhoosh(muzzlePos, vMax);
}

/* RED_AA 二号武器:两把双联装机炮,每把性能=直升机机炮(fireShell 同款管线:伤40/穿35/装填0.25s/初速920/散布同源)。
   单次触发两侧炮架同时各出膛 1 发(共 2 发);出膛点在左右耳轴标记(_aaGunDX)间切换,炮口世界矩阵随 gunPivot 俯仰。 */
function fireAAGun(t) {
  if (!t || !t.muzzle || typeof fireShell !== 'function') return;
  var mx = t.muzzle.position.x, dx = t._aaGunDX || 1.02;
  for (var s = -1; s <= 1; s += 2) {
    t.muzzle.position.x = mx + s * dx;
    fireShell(t, false);
  }
  t.muzzle.position.x = mx;
  t.reload = t.reloadTime;   // 一次触发=左右双联一个点射周期(0.125s,任务25 射速×2);调用方只管 gate
}

/* ★通用比例真源: 火箭/面杀伤弹爆炸波及半径 ∝ 伤害。锚点: 60 伤 → 22m (与火箭炮 CONF.arty 一致)。
   之前 heliRocketBurst 用的是 (dmg>=60?22:16) 二档阈值 → 伤害与半径根本不成正比 (这就是"比例没生效"的根因:
   从来没有真正的比例函数, 只有一个写死的开关)。现所有爆炸半径统一走本函数, spec.splashR 字段亦按此标定,
   单一真源, 改伤害即等比改半径。夹在 [8, 44]m 防极端弹型把半径推到离谱。 */
var SPLASH_R_PER_DMG = 22.0 / 60.0;   // ≈ 0.3667 m/伤 (60伤→22m 锚点)
function splashRadiusFromDamage(dmg) {
  return clamp((dmg || 0) * SPLASH_R_PER_DMG, 8.0, 44.0);
}

function heliRocketBurst(p, owner, dmg) {
  var bp = p.clone ? p.clone() : new THREE.Vector3(p.x, p.y, p.z);
  var splashR = splashRadiusFromDamage(dmg || 60);   // 爆炸半径随伤害等比(全弹种同口径,无分档阈值)
  applySplash(bp, splashR, dmg || 60, owner);
  if (typeof comicArtyBurst === 'function') comicArtyBurst(bp, splashR); // 贴图大小与爆炸半径自动关联缩放
  _addBattlefieldHeatSource(bp.x, bp.y, bp.z, 1600.0, 2.0);
  if (bp.y - terrainH(bp.x, bp.z) < 1.5) queueCrater(bp.x, bp.z, splashR); // 弹坑范围等比放大
  if (typeof comicGroundDust === 'function') comicGroundDust(bp.x, bp.y, bp.z, false);
  if (typeof sfxExplodeByDamage === 'function') sfxExplodeByDamage(bp, dmg || 60);
  else sfxExplode(bp, 1.05);
}

/* ===== 导弹通用命中、模块损毁与目标摧毁结算函数 (同普通炮弹标准结算管线) =====
   penOk (可选): warheadPenRoll 战斗部穿深闸门结果。undefined=未判定(兜底放行);
   false=未击穿 → 直击模块伤害归零(导弹在装甲面起爆), 溅射/爆炸视效照常。 */
function resolveMissileHit(s, tk, hitKey, hitPoint, hitNormal, penOk) {
  if (!tk || !tk.alive) return;
  var key = hitKey || 'hull';
  var mod = tk.mods && tk.mods[key] ? tk.mods[key] : (tk.mods && tk.mods.hull ? tk.mods.hull : null);
  var modLabel = mod && mod.label ? mod.label : (key === 'hull' ? 'HULL' : key);
  var bounced = penOk === false;

  // 1. 命中播报链起始 (同普通穿甲炮弹首命中行,先出命中行,后续致死摧毁行自动接在链尾)
  //    未击穿: '未击穿'行由 warheadPenRoll 闸门先行播报, 此处不重复出'导弹命中'行
  if (!bounced && s.owner === player && typeof hitMarkerChain === 'function') {
    hitMarkerChain(s, 'MISSILE HIT ' + modLabel, 'pen');
  }
  if (s.owner === player && typeof sfxEventVoice === 'function') sfxEventVoice('missile_hit');

  // 2. 命中火花、音效与漫画爆炸/地面弹坑
  //    未击穿: 白闪已由闸门发出, 此处跳过'pen'火花; 起爆视效(战斗部碰甲仍炸)照常
  //    ★E1-4(附录 B §B.1.3): 命中载具 = 只出殉爆蘑菇云(explosion→comicBurstFX, 6 层),
  //      不再叠一张爆点卡(comicArtyBurst, 3 层)——两者位置重合、层层混合, 是导弹爆炸卡顿的直接来源。
  //      触屏档(fxBurstDedup)生效; 桌面高档保持原双卡行为, 零回归。
  var _fxDedup = gfxFx('fxBurstDedup', false);
  var norm = hitNormal || _v1.copy(s.vel).normalize().multiplyScalar(-1);
  if (!bounced && typeof hitSpark === 'function') hitSpark(hitPoint, norm, _v1.copy(s.vel).normalize(), 'pen');
  if (typeof explosion === 'function') explosion(hitPoint, 1.8, { noSfx: true });
  if (typeof sfxExplodeByDamage === 'function') sfxExplodeByDamage(hitPoint, s.dmg || 60);
  else if (typeof sfxExplode === 'function') sfxExplode(hitPoint, 1.3);
  if (!_fxDedup && typeof comicArtyBurst === 'function') comicArtyBurst(hitPoint, 20.0);
  if (typeof comicGroundDust === 'function') comicGroundDust(hitPoint.x, hitPoint.y, hitPoint.z, true);
  if (typeof queueCrater === 'function' && typeof terrainH === 'function' && hitPoint.y - terrainH(hitPoint.x, hitPoint.z) < 2.0) {
    queueCrater(hitPoint.x, hitPoint.z, 20.0);
  }

  // 3. 模块伤害与目标摧毁判定流程 (直接复用通用核心管线: 自动触发 onModuleDestroyed, killTank, hitMarkerAppend('目标摧毁!'), addLog 击毁播报)
  //    未击穿: 直击伤害归零; 溅射照常(HE 战斗部破片)
  if (!bounced) applyModuleDamage(tk, key, s.dmg, s.owner, hitPoint, 0);   // depth=0: 与坦克 AP 同口径, hull 破片判定生效
  if (typeof applySplash === 'function') applySplash(hitPoint, 16.0, s.dmg * 0.5, s.owner);
}

/* ===== 光电/红外导引头自主目标与热源搜索算法 ===== */
var _vMslDir = new THREE.Vector3();
var _vSunDir = new THREE.Vector3();

/* 光电导引头视锥门限(热源诱偏与真目标共用同一口径):
   ① 垂直高程窗(altMax,来自导引头规格 seekerAltMax)→ ② 距离窗(8km 外 / 2m 内不予考虑)
   → ③ 半锥角视锥(cosHalfFov)。
   通过则返回距离平方(供对比度解算 heat/(dSq+25) 直接复用),不通过返回 -1。 */
function _seekerGate(dx, dy, dz, mDir, cosHalfFov, altMax) {
  if (Math.abs(dy) > altMax) return -1;
  var dSq = dx * dx + dy * dy + dz * dz;
  if (dSq > 64000000 || dSq < 4) return -1;
  var d = Math.sqrt(dSq);
  return ((dx / d) * mDir.x + (dy / d) * mDir.y + (dz / d) * mDir.z) >= cosHalfFov ? dSq : -1;
}
function findMissileAutonomousOpticalTarget(s) {
  var roster = hostileRosterOf(s.owner);
  var mPos = s.pos;
  var mDir = _vMslDir.copy(s.vel).normalize();
  var _msSp = HELI_MSL_SPEC[s.missileType] || HELI_MSL_SPEC.ty90;                 // 导引头规格驱动(视场/高程窗口)
  var cosHalfFov = Math.cos(_msSp.seekerFovDeg * 0.5 * Math.PI / 180);            // 30° 视场(半角 15°)
  var bestTgt = null;
  var maxThermalContrast = -1;

  // 1. 太阳强红外辐射直射导引头判定 (太阳诱偏/饱和盲区)
  if (typeof startHour !== 'undefined') {
    var hAng = (startHour - 6) / 12 * Math.PI;
    var elAng = Math.sin(hAng) * 0.92;
    if (elAng > 0.05) {
      _vSunDir.set(Math.cos(hAng) * 0.8, Math.sin(elAng), Math.sin(hAng) * 0.8).normalize();
      var dotSun = mDir.dot(_vSunDir);
      if (dotSun >= cosHalfFov) {
        var sunContrast = 0.60;
        if (sunContrast > maxThermalContrast) {
          maxThermalContrast = sunContrast;
          bestTgt = {
            isHeatSource: true,
            heatObj: { life: 999 },
            pos: new THREE.Vector3(mPos.x + _vSunDir.x * 4000, mPos.y + _vSunDir.y * 4000, mPos.z + _vSunDir.z * 4000),
            alive: true
          };
        }
      }
    }
  }

  // 2. 探测 30° 视锥内的战场剧烈爆炸火球 (爆炸高温诱偏)
  if (_battlefieldHeatSources && _battlefieldHeatSources.length > 0) {
    for (var bi = 0; bi < _battlefieldHeatSources.length; bi++) {
      var hs = _battlefieldHeatSources[bi];
      if (hs.life <= 0) continue;
      var dSq = _seekerGate(hs.x - mPos.x, hs.y - mPos.y, hs.z - mPos.z, mDir, cosHalfFov, _msSp.seekerAltMax);
      if (dSq < 0) continue;
      var contrast = hs.heat / (dSq + 25.0);
      if (contrast > maxThermalContrast) {
        maxThermalContrast = contrast;
        bestTgt = { isHeatSource: true, heatObj: hs, pos: new THREE.Vector3(hs.x, hs.y, hs.z), alive: true };
      }
    }
  }

  // 3. 探测 30° 视锥内的敌军真实热源目标 (坦克/歼击车/直升机,光电制导不受地面杂波影响)
  for (var i = 0; i < roster.length; i++) {
    var tgt = roster[i];
    if (!tgt || !tgt.alive || !tgt.group || !areHostile(s.owner, tgt)) continue;
    // The AA ATGM must not reacquire an airborne target when an assigned
    // ground vehicle is lost; legacy ground-domain seeker behavior remains
    // untouched.
    if (s.missileType === 'redAaAtgm' && typeof isHeliVehicle === 'function' && isHeliVehicle(tgt)) continue;
    var tp = tgt.group.position;                                 // 瞄点抬高 1m = 车体热心
    var dSq2 = _seekerGate(tp.x - mPos.x, (tp.y + 1.0) - mPos.y, tp.z - mPos.z, mDir, cosHalfFov, _msSp.seekerAltMax);
    if (dSq2 >= 0) {
      var baseHeat = isHeliVehicle(tgt) ? 260.0 : 160.0;         // 直升机排气热特征显著高于地面车辆
      var contrast = baseHeat / (dSq2 + 25.0);
      if (contrast > maxThermalContrast) {
        maxThermalContrast = contrast;
        bestTgt = tgt;
      }
    }
  }

  return bestTgt;
}

/* 直升机导弹哑爆/脱靶公用包: 爆燃视觉+音效+漫画爆尘+玩家脱靶语音 (stepShells 五处触发点共用)
   ★E1-4(附录 B §B.1.3): 命中地面/障碍/热源诱偏 = 只出爆点卡(comicArtyBurst, 3 层),
   殉爆蘑菇云(6 层)由 noCard 关掉 —— 爆闪/震屏/热源/战况雾仍由 explosion 照常给出。 */
function heliMissileMissBurst(s, pos) {
  var _fxDedup = gfxFx('fxBurstDedup', false);
  explosion(pos, 1.8, { noSfx: true, noCard: _fxDedup });
  if (typeof sfxExplodeByDamage === 'function') sfxExplodeByDamage(pos, s.dmg || 60);
  else sfxExplode(pos, 1.3);
  if (typeof comicArtyBurst === 'function') comicArtyBurst(pos, 20.0);
  if (typeof comicGroundDust === 'function') comicGroundDust(pos.x, pos.y, pos.z, true);
  _notifyMissileMiss(s);
}
/* 直升机导弹落地溅射: 弹坑(近地<2m) + 面杀伤(规格与直击溅射同源: 直伤×0.5, r16) */
function heliMissileGroundSplash(s, pos) {
  if (pos.y - terrainH(pos.x, pos.z) < 2.0) queueCrater(pos.x, pos.z, 20.0);
  applySplash(pos, 16.0, (s.dmg || 0) * 0.5, s.owner);
}
/* 比例导引 (PN, 真实空空导弹导引律) 转向力: a_dem = N·Vc·λ̇ (视线旋转率 λ̇ 由前后帧单位视线差分),
   方向 = λ̇矢量 × 速度方向 (⊥速度, 指向视线漂移侧), 幅值钳至可用过载 aMax; 闭合速度钳底下限 0.2v 防零接近几何(正侧方)失控。
   返回实际执行的侧向加速度 (首帧无视线历史/视线静止时为 0), 并滚动弹上视线历史 (_losP*)。
   纯追踪(瞄准当前位置)在有限转弯半径下近距必然终端螺旋绕飞, PN 主动压制视线旋转、收敛到碰撞航向予以消除。 */
function heliPnSteer(s, losX, losY, losZ, distToTgt, aMax, vInv, dt, acc) {
  var aSteer = 0;
  if (s._losPx != null && dt > 0) {
    var vX = s.vel.x * vInv, vY = s.vel.y * vInv, vZ = s.vel.z * vInv;
    var cx = s._losPy * losZ - s._losPz * losY,
        cy = s._losPz * losX - s._losPx * losZ,
        cz = s._losPx * losY - s._losPy * losX;      // losPrev×los (|·|≈sinΔθ; 旧×新 = 视线旋转轴正方向)
    var dX = cy * vZ - cz * vY,
        dY = cz * vX - cx * vZ,
        dZ = cx * vY - cy * vX;                      // (los×losPrev)×v̂ : ⊥速度的有效转向分量
    var dM = Math.sqrt(dX * dX + dY * dY + dZ * dZ) / dt;   // 有效视线旋转率 |λ̇⊥| rad/s
    if (dM > 1e-6) {
      var vClose = Math.max(s.vel.length() * 0.2, -(distToTgt - (s._losDist != null ? s._losDist : distToTgt)) / dt);
      aSteer = Math.min(aMax, HELI_MSL_PN_N * vClose * dM);
      var aN = aSteer / (dM * dt);
      acc.x += dX * aN; acc.y += dY * aN; acc.z += dZ * aN;
    }
  }
  s._losPx = losX; s._losPy = losY; s._losPz = losZ; s._losDist = distToTgt;
  return aSteer;
}

/* ============================================================
   直升机弹体通用运动/制导库 —— 导弹与火箭弹共用, 型号差异全部由规格字段驱动
   (规格表 HELI_MSL_SPEC / HELI_RKT_SPEC 字段说明见定义处注释)。
   ============================================================ */

/* A missile has radar guidance only while an AA vehicle or helicopter has an
   active locked track for that projectile. Autonomous EO/IR missiles,
   fire-and-forget gun-launched missiles, and manually assigned non-radar shots
   therefore receive the guaranteed flare diversion rule. */
function missileHasRadarGuidance(s) {
  if (!s || !s.owner) return false;
  var o = s.owner;
  var radarCarrier = o.kind === 'aa' || (typeof isHeliVehicle === 'function' && isHeliVehicle(o));
  if (!radarCarrier || !o._heliRadarActive || !o._heliRadarTracks || !s.target) return false;
  for (var i = 0; i < o._heliRadarTracks.length; i++) {
    var tr = o._heliRadarTracks[i];
    if (tr && tr.isLocked && tr.tank && (tr.tank === s.target || (tr.tank.id && s.target.id && tr.tank.id === s.target.id))) return true;
  }
  /* A射B导 loans a wingman missile to the player's locked helicopter track. */
  if (s._abgLoan && typeof player !== 'undefined' && player && player._heliRadarActive && player._heliRadarTracks) {
    for (var j = 0; j < player._heliRadarTracks.length; j++) {
      var ptr = player._heliRadarTracks[j];
      if (ptr && ptr.isLocked && ptr.tank && (ptr.tank === s.target || (ptr.tank.id && s.target.id && ptr.tank.id === s.target.id))) return true;
    }
  }
  return false;
}
function missileDecoyTarget(s) {
  if (!s || !s.isHeliMissile || !heliDecoys.length) return null;
  if (s._decoyTarget && s._decoyTarget.alive) return s._decoyTarget;
  if (s._decoyTarget && !s._decoyTarget.alive) s._decoyTarget = null;
  var radarGuided = missileHasRadarGuidance(s);
  var tried = s._decoyTried || (s._decoyTried = []);
  var best = null, bestD2 = Infinity, range2 = HELI_DECOY_LURE_RANGE * HELI_DECOY_LURE_RANGE;
  for (var i = 0; i < heliDecoys.length; i++) {
    var d = heliDecoys[i];
    if (!d || !d.alive || !d.pos) continue;
    if (d.owner && s.owner && typeof areHostile === 'function' && !areHostile(s.owner, d.owner)) continue;
    var dx = d.pos.x - s.pos.x, dy = d.pos.y - s.pos.y, dz = d.pos.z - s.pos.z;
    var d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > range2 || tried.indexOf(d) >= 0) continue;
    tried.push(d);
    /* Each flare gets one independent 1/4 roll when radar guidance exists. */
    if (!radarGuided || Math.random() < 0.25) {
      if (d2 < bestD2) { bestD2 = d2; best = d; }
    }
  }
  if (best) s._decoyTarget = best;
  return best;
}

/* 通用目标获取: 按规格 guidance 模式分派, 返回本帧有效制导目标 (null=惯性段)。
   'datalink' (火蛇-70A): 逐帧跟随母机雷达锁定目标, 无锁定→惯性直飞;
   'optoelectronic' (导弹): 复合制导体系 ——
     1. 已分配目标且存活: <450m 末制导锁定惯性段绝不横跳; >=450m 查母机雷达仍锁定则持续引导;
     2. 原目标被取消锁定/战损: 数据链重分配至母机剩余锁定且在飞弹最少目标;
     3. 无雷达锁定目标: 降级光电自主寻的(射后不管, 30° 视场热源对比度优选, _autoOptTarget 状态机)。 */
function heliGuidedAcquireTarget(s, spec) {
  /* Countermeasures are evaluated before every seeker mode. A successful flare
     diversion becomes the missile's stable target until that flare expires. */
  var flareTarget = missileDecoyTarget(s);
  if (flareTarget) { s._autoOptTarget = null; return flareTarget; }
  /* Gun-launched MBT-1 missiles are fire-and-forget.  Do not inspect
     _heliRadarActive, _heliRadarTracks, or allocateGuidedFireTarget here. */
  if (spec.seekerOnly || s._seekerOnly) {
    if (s._autoOptTarget) {
      if (s._autoOptTarget.isHeatSource) {
        if (s._autoOptTarget.heatObj.life <= 0) s._autoOptTarget = null;
      } else if (!s._autoOptTarget.alive) {
        s._autoOptTarget = null;
      }
    }
    if (!s._autoOptTarget || (s._autoOptScanT == null || gameT - s._autoOptScanT > 0.08)) {
      s._autoOptScanT = gameT;
      s._autoOptTarget = findMissileAutonomousOpticalTarget(s);
    }
    return s._autoOptTarget;
  }
  if (spec.guidance === 'datalink') {
    // 数据链弹(70mm火箭弹): 目标一经分配即"粘住", 只在目标失效时才重分配。
    // ★不可每帧无条件重分配: 那样每枚弹每帧都会被"在飞弹数最少"判据推向另一个目标,
    //   6 枚弹在 3 个目标间逐帧循环横跳, 制导指令自相抵消 → 表现为完全不分配火力/乱飞。
    var cur = s.target;
    var curOk = cur && cur.alive && cur.group;
    if (curOk && s.owner && s.owner.alive && s.owner._heliRadarActive && s.owner._heliRadarTracks) {
      // 母机雷达仍锁定该目标 → 保持引导(不横跳)
      for (var ti2 = 0; ti2 < s.owner._heliRadarTracks.length; ti2++) {
        var tr2 = s.owner._heliRadarTracks[ti2];
        if (tr2.isLocked && tr2.tank && (tr2.tank === cur || (cur.id && tr2.tank.id === cur.id))) return cur;
      }
    }
    // 末端(<450m)已进入捕获走廊: 即便母机丢锁也保持惯性追击, 与导弹同口径
    if (curOk && s.pos.distanceTo(cur.group.position) < 450.0) return cur;
    // 目标战损/被取消锁定 → 重分配(排除自身占位, 防止把自己算进目标名额)
    var lk = (typeof allocateGuidedFireTarget === 'function') ? allocateGuidedFireTarget(s.owner, spec, s) : null;
    s.target = (lk && lk.alive && lk.group) ? lk : null;
    return s.target;
  }
  var effectiveTarget = null;
  var hasValidTarget = s.target && s.target.alive && s.target.group;
  var distToTarget = hasValidTarget ? s.pos.distanceTo(s.target.group.position) : Infinity;

  // 检查 s.target 是否仍在其发射母机 s.owner 的雷达锁定列表中 (完全按载具独立隔离)
  var isTargetStillLocked = false;
  if (hasValidTarget && s.owner && s.owner.alive && s.owner._heliRadarActive && s.owner._heliRadarTracks) {
    for (var ti = 0; ti < s.owner._heliRadarTracks.length; ti++) {
      var tr = s.owner._heliRadarTracks[ti];
      if (tr.isLocked && (tr.tank === s.target || (s.target.id && tr.tank.id === s.target.id))) {
        isTargetStillLocked = true;
        break;
      }
    }
  }

  if (s._abgLoan && typeof heliABGLoanHold === 'function' && heliABGLoanHold(s)) {
    // A射B导借出弹: "玩家仍锁定该目标" = 与母机雷达锁定同权, 持续引导。
    //   ★必须前置: 借出弹的目标是玩家锁定的, 母机雷达里多半根本没有该航迹 →
    //     若不吃这条, >450m 段首帧就会命中下方"母机无锁定→重分配"分支被抢回母机目标, 功能形同无效。
    effectiveTarget = s.target;
    s._autoOptTarget = null;
  } else if (hasValidTarget && (distToTarget < 450.0 || isTargetStillLocked || s._aaGroundTarget)) {
    // 末端锁定惯性、母机持续雷达锁定，或 AA 已明确交给本弹的地面目标:稳固追踪
    effectiveTarget = s.target;
    s._autoOptTarget = null;
  } else if (s.owner && s.owner.alive && s.owner._heliRadarActive && s.owner._heliRadarTracks && s.owner._heliRadarTracks.length > 0) {
    // 原目标被母机主动取消锁定或战损,重新分配火力至该母机自身的剩余有效锁定目标 (按本弹规格取域)
    // (借出弹的"母机"= 被借用的僚机: 玩家丢锁后回落其自身分配, 与"玩家无锁定→友机自身目标"同义)
    var reallocTgt = (s._abgLoan && typeof heliABGLoanRealloc === 'function')
      ? heliABGLoanRealloc(s, spec)
      : ((typeof allocateGuidedFireTarget === 'function') ? allocateGuidedFireTarget(s.owner, spec) : null);
    if (reallocTgt && reallocTgt.alive && reallocTgt.group) {
      s.target = reallocTgt;
      effectiveTarget = reallocTgt;
      s._autoOptTarget = null;
    }
  }

  if (!effectiveTarget) {
    // 若无母机雷达锁定目标,降级为光电自主寻的 (射后不管)
    if (s._autoOptTarget) {
      if (s._autoOptTarget.isHeatSource) {
        if (s._autoOptTarget.heatObj.life <= 0) s._autoOptTarget = null;
      } else if (!s._autoOptTarget.alive) {
        s._autoOptTarget = null;
      }
    }
    if (!s._autoOptTarget || (s._autoOptScanT == null || gameT - s._autoOptScanT > 0.08)) {
      s._autoOptScanT = gameT;
      s._autoOptTarget = findMissileAutonomousOpticalTarget(s);
    }
    effectiveTarget = s._autoOptTarget;
  }
  return effectiveTarget;
}

/* 通用运动积分: 助推/寄生阻力/重力合力 + PN 转向 + 诱导阻力 + 可选 g-bias/地形跟随 + 速度积分。
   tX==null → 惯性段(无制导项); distTgt 无目标时传 Infinity(地形跟随末段解除判定恒 false, 与旧 typeof!==number 分支等价)。
   无制导火箭同样走本函数退化路径 (boostT=0 + gScale 0.35 + vFloor 60)。 */
function heliGuidedFlightStep(s, spec, dt, tX, tY, tZ, distTgt) {
  // ===== 力矢量积分 (真实弹动力学): 推力/阻力/重力/转向力矢量合成后积分决定运动 =====
  // 两段动力: boostT 秒匀加速助推至 vMax(极速), 之后二次寄生阻力减速滑航 a=−K·v²; 重力按 gScale 缩放取矢量
  var vMag = s.vel.length();
  var vInv = 1 / (vMag || 1);
  var aFwd = (spec.boostT > 0 && s.flightT < spec.boostT) ? (spec.vMax - s.v0) / spec.boostT : -spec.dragK * vMag * vMag;
  var g = CONF.gravity * (spec.gScale != null ? spec.gScale : 1);
  _mslAcc.set(s.vel.x * vInv * aFwd, s.vel.y * vInv * aFwd - g, s.vel.z * vInv * aFwd);
  // 可用过载每步无条件解算 + 本步制导过载记账 —— PN 用掉的预算, 重力补偿/地形越障从余额扣除
  var aMax = (spec.gMax && spec.kQ) ? Math.min(spec.gMax * 9.8, spec.kQ * vMag * vMag) : 0, aSteer = 0;

  if (tX != null && distTgt > 2) {
    // 比例导引 (PN): a = N·Vc·λ̇ ⊥速度 —— 压制视线旋转率, 收敛至碰撞航向 (见 heliPnSteer)
    aSteer = heliPnSteer(s, tX, tY, tZ, distTgt, aMax, vInv, dt, _mslAcc);
    if (aSteer > 0) {
      // 诱导阻力 ∝ aSteer² (转向的能量代价): 持续大过载快速掏空动能
      var indDrag = spec.turnK * aSteer * aSteer;
      _mslAcc.x -= s.vel.x * vInv * indDrag; _mslAcc.y -= s.vel.y * vInv * indDrag; _mslAcc.z -= s.vel.z * vInv * indDrag;
    }
  }

  var gUsed = 0;
  if (spec.gBias) {
    // ===== 法向重力补偿 (g-bias, 真实弹自驾仪标准项) =====
    // PN 律只压制视线旋转率, 对常值重力扰动无积分项 —— 抵消垂直于速度方向的重力分量 g⊥=g−(g·v̂)v̂
    var gvxu = s.vel.x * vInv, gvyu = s.vel.y * vInv, gvzu = s.vel.z * vInv;
    var gDotV = -g * gvyu;                               // g·v̂ (g=(0,-g,0))
    var gpx = -gDotV * gvxu, gpy = -g - gDotV * gvyu, gpz = -gDotV * gvzu;
    var gpMag = Math.sqrt(gpx * gpx + gpy * gpy + gpz * gpz);
    if (gpMag > 1e-6 && aMax > aSteer) {
      var gUse = Math.min(gpMag, aMax - aSteer);
      var gScl = gUse / gpMag;
      _mslAcc.x -= gpx * gScl; _mslAcc.y -= gpy * gScl; _mslAcc.z -= gpz * gScl;
      gUsed = gUse;
    }
  }

  if (spec.terraFollow) {
    // ===== 中段地形跟随越障 (净空 100m / 前瞻 3s): 前瞻 9 点最高地形+净空构成高度下限, 低于下限施加向上避撞加速度 =====
    // 末段(距目标 < max(220m, 0.7s 航程))解除下限转俯冲; 无目标惯性段下限恒生效。避障力与 PN 完全解耦。
    var tfLook = vMag * 3.0;
    var tfMaxTerr = -1e9;
    var tfVxu = s.vel.x * vInv, tfVzu = s.vel.z * vInv;
    for (var tfi = 0; tfi < 9; tfi++) {
      var tfFrac = 0.12 + tfi * 0.11;
      var tfh = terrainH(s.pos.x + tfVxu * tfLook * tfFrac, s.pos.z + tfVzu * tfLook * tfFrac);
      if (tfh > tfMaxTerr) tfMaxTerr = tfh;
    }
    var tfFloor = tfMaxTerr + 100;
    var tfNearTgt = distTgt < Math.max(220, vMag * 0.7);
    if (!tfNearTgt && s.pos.y < tfFloor) {
      var tfDeficit = Math.min(2, (tfFloor - s.pos.y) / 100);
      var tfBudget = Math.max(0, aMax - aSteer - gUsed);
      _mslAcc.y += Math.min(tfBudget, g * (1 + 5 * tfDeficit));
    }
  }

  s.vel.addScaledVector(_mslAcc, dt);   // 合力→加速度→速度矢量积分 (方向与大小均由力决定)
  if (spec.vFloor) {                    // 速度地板 (防阻力耗尽倒飞)
    var vNow = s.vel.length();
    if (vNow < spec.vFloor && vNow > 1e-6) s.vel.multiplyScalar(spec.vFloor / vNow);
  }
}

/* ===== RED-MLRS 制导弹头 =====
   This is deliberately separate from the helicopter data-link path.  A player red
   MLRS rocket is allowed to acquire only during its descending segment and only
   inside the fire-coverage circle captured when the salvo was fired.  Once a rocket
   has acquired, losing that target does not make it disappear: it retargets another
   hostile in the same circle, or continues as an unguided physical flight. */
function artyGuidedTargetOf(s) {
  if (!s || !s.owner || !s._artyGuided) return null;
  var cx = s._artyCoverageX, cz = s._artyCoverageZ, r = s._artyCoverageR;
  if (!isFinite(cx) || !isFinite(cz) || !(r > 0)) return null;
  var r2 = r * r, owner = s.owner;
  var cur = s._artyGuideTarget;
  if (cur && cur.alive && cur.group && areHostile(owner, cur)) {
    var cp = cur.group.position, cdx = cp.x - cx, cdz = cp.z - cz;
    if (cdx * cdx + cdz * cdz <= r2) return cur;
  }
  var pool = (typeof aliveList !== 'undefined' && aliveList) ? aliveList : tanks;
  var best = null, bestD2 = Infinity;
  for (var i = 0; i < pool.length; i++) {
    var o = pool[i];
    if (!o || !o.alive || !o.group || o === owner || !areHostile(owner, o)) continue;
    var p = o.group.position, dx = p.x - cx, dz = p.z - cz;
    if (dx * dx + dz * dz > r2) continue;
    var sx = p.x - s.pos.x, sy = (p.y + 1.0) - s.pos.y, sz = p.z - s.pos.z;
    var d2 = sx * sx + sy * sy + sz * sz;
    if (d2 < bestD2) { bestD2 = d2; best = o; }
  }
  s._artyGuideTarget = best;
  return best;
}

var _treesSegBrush = (typeof treesSegBrush === 'function') ? treesSegBrush : null;   // ★审查A8: 加载期一次绑定(原版每弹每步 2 次 typeof 全局查找; map.js 先于本文件加载, 函数声明已就位)
var _grassSegShake = (typeof grassSegShake === 'function') ? grassSegShake : null;
var _gfxTrailAdapt = gfxFx('fxTrailAdapt', false);   // ★E2-2 档位快照(weapons.js 在 scene.js 之后加载,GFX 已就位)
function stepShells(dt) {
  updateHeliDecoys(dt);
  _updateBattlefieldHeatSources(dt);
  /* ★E2-2(附录 B):齐射期尾迹自适应降频。尾迹卡按模拟时间定距登记(见下方 s.trailT),
     40 发齐射时 40×60Hz = 2400 卡/s 灌进 CRT_CAP=1200 的池子,池压到顶后新卡被丢、
     旧卡仍在渲染 —— 既没省下填充,又让尾迹忽疏忽密。按在飞火箭数分三档拉大间距:
     ≤8 发保持 60Hz(单机点射观感不变)、>8 发 30Hz、>16 发 20Hz。
     只改视觉登记频率,弹道/命中/落点预报全在 rocketUStep 与 move 段,零影响。
     高档 fxTrailAdapt=false ⇒ 恒 0.017,与改动前逐位一致(桌面零回归)。 */
  var _rkTrailDt = 0.017;
  if (_gfxTrailAdapt) {
    var _nRk = 0;
    for (var _ri = 0; _ri < shells.length; _ri++) if (shells[_ri].arty) _nRk++;
    _rkTrailDt = _nRk > 16 ? 0.05 : (_nRk > 8 ? 0.033 : 0.017);
  }
  for (var si = shells.length - 1; si >= 0; si--) {
    var s = shells[si];
    s.life -= dt;
    if (s.life <= 0) { _notifyMissileMiss(s); removeShell(si); continue; }
    if (!s._whoosh && (s.isHeliRocket || s.isHeliMissile || s.arty) && typeof sfxRocketWhoosh === 'function' && player && player.group) {
      var _wd2 = s.pos.distanceToSquared(player.group.position);   // ★审查A8: 平方距离先过 160m² 门(远弹 0 次 sqrt; 从未入圈时 _whooshD 悬空与原版远弹同义——本就不发声)
      if (_wd2 < 25600 || s._whooshD != null) {
        var _wd = Math.sqrt(_wd2);
        var _wclose = (s._whooshD == null) || (_wd < s._whooshD - 0.8);
        s._whooshD = _wd;
        if (_wclose && _wd < 160) {
          sfxRocketWhoosh(s.pos, s.vel ? s.vel.length() : 500);
          s._whoosh = true;
        }
      }
    }

    var move = _shMove, dist, dir = _shDir;
    if (s.isHeliMissile || (s.isHeliRocket && (HELI_RKT_SPEC[s.rktType] || HELI_RKT_SPEC.ah64).guidance === 'datalink')) {
      // ===== 通用制导弹体: 导弹与雷达制导火箭共用, 型号差异全部由规格字段驱动 =====
      s.flightT = (s.flightT || 0) + dt;
      var gSpec = heliGuidedSpecOf(s);   // 弹型规格统一入口(消内联重复)
      var stepDist = s.vel.length() * dt;   // 本步位移预估(终端捕获判定用; 实际位移由积分后的速度决定)

      // 目标获取 (guidance 模式分派): 导弹复合制导体系 / 火箭弹数据链逐帧跟随 —— 见 heliGuidedAcquireTarget
      var effectiveTarget = heliGuidedAcquireTarget(s, gSpec);
      // 任务24: 孤弹安全自毁(真实导弹安全引信同则)——离架 >5s 后连续 4s 无任何有效制导目标
      //   (母车被毁/目标全灭/导引头搜不到)→ 空中自毁。修复前孤弹飞满 45s 寿命,长期占用
      //   实体/尾迹槽/实例容量,是卡顿与"导弹隐形/尾迹残留"渲染错误的主因之一。
      if (s.isHeliMissile) {
        if (effectiveTarget) s._orphanT = 0;
        else s._orphanT = (s._orphanT || 0) + dt;
        if (s._orphanT > 4.0 && (s.flightT || 0) > 5.0) { heliMissileMissBurst(s, s.pos); removeShell(si); continue; }
      }
      if (effectiveTarget) {
        var tPos = effectiveTarget.isHeatSource || effectiveTarget.isDecoy ? effectiveTarget.pos : (effectiveTarget.group ? effectiveTarget.group.position : null);
        if (tPos) {
          // Ground-target ATGMs aim through the live collision hull rather than
          // the model origin's lower one-metre marker, so the terminal ray can
          // consume the real armor face/penetration gate.
          var targetAimY = effectiveTarget.isHeatSource ? tPos.y : (tPos.y + (s.missileType === 'redAaAtgm' ? 3.0 : 1.0));
          var toTgt = _v1.set(tPos.x - s.pos.x, targetAimY - s.pos.y, tPos.z - s.pos.z);
          var distToTgt = toTgt.length();
          // 终端捕获 (结算行为=弹种差异): 导弹穿甲结算/热源诱偏爆 vs 火箭溅射爆 —— 防止过目标后徘徊绕飞
          if (s.isHeliMissile) {
            if (effectiveTarget.isDecoy && distToTgt <= Math.max(10.0, stepDist + 2.0)) {
              heliMissileMissBurst(s, s.pos);
              removeShell(si);
              continue;
            } else if (!effectiveTarget.isHeatSource && distToTgt <= Math.max(8.0, stepDist + 2.0)) {
              toTgt.normalize();
              var capDist = Math.min(distToTgt, stepDist);
              var capDX = toTgt.x, capDY = toTgt.y, capDZ = toTgt.z;   // 方向快照(闸门反馈链可能复用 scratch, 先存本地)
              // 近炸捕获点无射线命中信息 → 补一条短射线取目标真实命中面, 供战斗部穿深闸门判定
              var capPen = null;
              ray.set(s.pos, toTgt); ray.far = distToTgt;
              var capHits = losIntersect(s.pos.x, s.pos.z, tPos.x, tPos.z, ray);
              for (var chi = 0; chi < capHits.length; chi++) {
                if (capHits[chi].object.userData.tank === effectiveTarget) {
                  capPen = warheadPenRoll(s, effectiveTarget, 'hull', capHits[chi], toTgt);
                  break;
                }
              }
              var hitPos = _v2.copy(s.pos);
              hitPos.x += capDX * capDist; hitPos.y += capDY * capDist; hitPos.z += capDZ * capDist;
              resolveMissileHit(s, effectiveTarget, 'hull', hitPos, null, capPen);
              removeShell(si);
              continue;
            } else if (effectiveTarget.isHeatSource && distToTgt <= Math.max(10.0, stepDist + 2.0)) {
              heliMissileMissBurst(s, s.pos);
              removeShell(si);
              continue;
            }
          } else if (s._airburst && distToTgt <= stepDist + 0.5) {
            /* Airburst is a proximity fuse, not a larger capture radius: place the
               detonation point 0.5m before the tracked enemy along the current LOS.
               This prevents the normal step-size safety margin from exploding early. */
            var airburstDir = toTgt.clone().normalize();
            var airburstPoint = new THREE.Vector3(
              tPos.x - airburstDir.x * 0.5,
              (tPos.y + 1.0) - airburstDir.y * 0.5,
              tPos.z - airburstDir.z * 0.5);
            heliRocketBurst(airburstPoint, s.owner, s.dmg);
            removeShell(si);
            continue;
          } else if (distToTgt <= Math.max(gSpec.captureR, stepDist + 1.5)) {
            heliRocketBurst(s.pos, s.owner, s.dmg);
            removeShell(si);
            continue;
          }
          if (distToTgt > 2) {
            toTgt.normalize();
            heliGuidedFlightStep(s, gSpec, dt, toTgt.x, toTgt.y, toTgt.z, distToTgt);
          } else {
            heliGuidedFlightStep(s, gSpec, dt, null, 0, 0, Infinity);
          }
        } else {
          heliGuidedFlightStep(s, gSpec, dt, null, 0, 0, Infinity);
        }
      } else {
        heliGuidedFlightStep(s, gSpec, dt, null, 0, 0, Infinity);
      }
      move.copy(s.vel).multiplyScalar(dt);
      dist = move.length();
      dir.copy(s.vel).normalize();
    } else if (s.arty && s._artyGuided && s.rk &&
               (s._artyGuidanceActive || (s.rk.v0y - CONF.gravity * s.rk.u <= 0 && artyGuidedTargetOf(s)))) {
      /* The RED-HELI wz10 guidance constants are the single maneuver model for
         both guided weapons.  Artillery starts consuming it only after apogee. */
      s._artyGuidanceActive = true;
      s.flightT = (s.flightT || 0) + dt;
      s._lineU += dt;
      var artyGSpec = HELI_RKT_SPEC.wz10;
      var artyTarget = artyGuidedTargetOf(s);
      var artyStepDist = s.vel.length() * dt;
      if (artyTarget && artyTarget.group) {
        var artyTP = artyTarget.group.position;
        var artyTo = _v1.set(artyTP.x - s.pos.x, artyTP.y + 1.0 - s.pos.y, artyTP.z - s.pos.z);
        var artyD = artyTo.length();
        if (artyD <= Math.max(artyGSpec.captureR, artyStepDist + 1.5)) {
          s.pos.y = artyTP.y + 0.8;
          artilleryBurst(s.pos, s.owner);
          removeShell(si);
          continue;
        }
        if (artyD > 2) {
          artyTo.multiplyScalar(1 / artyD);
          heliGuidedFlightStep(s, artyGSpec, dt, artyTo.x, artyTo.y, artyTo.z, artyD);
        } else {
          heliGuidedFlightStep(s, artyGSpec, dt, null, 0, 0, Infinity);
        }
      } else {
        /* No enemy remains in the circle: keep the rocket's current momentum and
           gravity, which is the normal post-apogee bombardment fallback. */
        heliGuidedFlightStep(s, artyGSpec, dt, null, 0, 0, Infinity);
      }
      s.rk.tF += dt;
      move.copy(s.vel).multiplyScalar(dt);
      dist = move.length();
      dir.copy(s.vel).normalize();
    } else if (s.arty) {                                         // 火箭:真实火箭速度剖面沿同一解析高抛弧推进(ROCKET_PROF——几何/落点不变)
      var rkS = s.rk, spd = rocketUStep(rkS, dt), u2 = rkS.u;
      move.set(
        rkS.p0x + rkS.v0x * u2 - s.pos.x,
        rkS.p0y + rkS.v0y * u2 - 0.5 * CONF.gravity * u2 * u2 - s.pos.y,
        rkS.p0z + rkS.v0z * u2 - s.pos.z);
      dist = move.length();
      dir.copy(move).normalize();
      // 显示速度=剖面速度×弧切向(弹体朝向/尾迹喷口/来袭预报共用;碰撞走 move 段,与剖面无关)
      s.vel.set(rkS.v0x, rkS.v0y - CONF.gravity * rkS.u, rkS.v0z).normalize().multiplyScalar(spd);
    } else {
      s._lineU += dt;
      if (s.isHeliRocket) {
        // 无制导火箭: 通用积分退化路径 (boostT=0 + 阻力 + 0.35g 下坠 + 速度地板 60),
        // 与尾迹/HUD 落点预测(simulateHeliRocketImpact) 0.35g 同口径
        heliGuidedFlightStep(s, HELI_RKT_SPEC[s.rktType] || HELI_RKT_SPEC.ah64, dt, null, 0, 0, Infinity);
      } else {
        s.vel.y -= CONF.gravity * dt;
      }
      move.copy(s.vel).multiplyScalar(dt);
      dist = move.length();
      dir.copy(move).normalize();
    }

    s.flyD += dist;                                   // 真实飞行里程入账(穿深存速衰减 P=P0·e^(−k·flyD) 用;火箭弹不消费)

    ray.set(s.pos, dir);
    ray.far = dist;
    var hits = losIntersect(s.pos.x, s.pos.z, s.pos.x + move.x, s.pos.z + move.z, ray);

    var terminated = false;
    for (var hi = 0; hi < hits.length; hi++) {
      var h = hits[hi];
      var ud = h.object.userData;
      if (ud.obstacle) {
        s.pos.copy(h.point);
        if (s.isHeliMissile) {
          heliMissileMissBurst(s, s.pos);
        }
        else if (s.isHeliRocket || s._he) { heliRocketBurst(s.pos, s.owner, s.dmg); }
        else if (s.arty) { artilleryBurst(s.pos, s.owner); }
        else {
          hitSpark(h.point, _v1.copy(dir).multiplyScalar(-1), dir, 'env');
          sfxArmorStop(h.point, 0.5);
        }
        terminated = true;
        break;
      }
      var tk = ud.tank;
      if (!tk || tk === s.owner) continue;
      if (!tk.alive) {                                // 残骸=永久物理掩体——炮弹被拦下,残骸本体不再受伤
        s.pos.copy(h.point);
        if (s.isHeliMissile) {
          heliMissileMissBurst(s, s.pos);
        }
        else if (s.isHeliRocket || s._he) { heliRocketBurst(s.pos, s.owner, s.dmg); }
        else if (s.arty) { artilleryBurst(s.pos, s.owner); }
        else {
          // 残骸仍属于载具目标且拦停炮弹:所有模式统一按“命中但未击穿(stop)”。
          var wreckN = _v1.copy(h.face.normal).transformDirection(h.object.matrixWorld); // 事件 scratch,免 clone 分配
          hitSpark(h.point, wreckN, dir, 'stop');              // 残骸拦停炮弹,一律按“命中但未击穿”
          sfxArmorStop(h.point, 0.35);
        }
        terminated = true; break;
      }
      var sg = s.g;                                     // 组级命中率账:命中敌方活车即计(击穿/未击穿、有无伤害同分;火箭炮/无组不计)
      if (sg && areHostile(s.owner, tk)) {
        if (!s._htk) s._htk = [];
        if (s._htk.indexOf(tk) < 0) { s._htk.push(tk); sg.hits++; }   // 贯穿链同车多板面/跨帧多次结算只计 1 次
      }
      if (s._he) {
        /* HE keeps the rocket/warhead penetration gate for the direct module hit,
           then always detonates and applies the existing rocket splash code. */
        if (warheadPenRoll(s, tk, ud.key, h, dir)) applyModuleDamage(tk, ud.key, s.dmg, s.owner, h.point, 0);
        heliRocketBurst(h.point, s.owner, s.dmg);
        terminated = true; break;
      }
      if (s.isHeliMissile) {
        var penOkM = warheadPenRoll(s, tk, ud.key, h, dir);   // 战斗部穿深闸门(未击穿自带 stop 反馈; norm 在闸门后取, 防 scratch 串味)
        var norm = _v1.copy(dir).multiplyScalar(-1);
        resolveMissileHit(s, tk, ud.key, h.point, norm, penOkM);
        terminated = true; break;
      }
      if (s.isHeliRocket) {
        // 战斗部穿深闸门: 未击穿 → 直击模块伤害归零, 起爆/溅射照常(HE碰甲仍炸)
        if (warheadPenRoll(s, tk, ud.key, h, dir)) applyModuleDamage(tk, ud.key, s.dmg, s.owner, h.point, 0);   // depth=0: 与坦克 AP 同口径, hull 破片判定生效
        heliRocketBurst(h.point, s.owner, s.dmg);

        terminated = true; break;
      }
      if (s.arty) {                                   // 火箭弹直击:战斗部穿深闸门(未击穿→模块伤害归零) + 爆炸溅射照常
        var _airstrikeHitOK = !s.airstrike || airstrikeTargetAllowed(tk, s.owner);
        if (_airstrikeHitOK && warheadPenRoll(s, tk, ud.key, h, dir)) applyModuleDamage(tk, ud.key, s.dmg, s.owner, h.point, 0);
        s.pos.copy(h.point); artilleryBurst(s.pos, s.owner);

        terminated = true; break;
      }
      if (s._skip) {                                    // 已在本车本模块结算过(穿透链)→ 跳过其其它板面
        var sk2 = false;
        for (var skI = 0; skI < s._skip.length; skI += 2) if (s._skip[skI] === tk && s._skip[skI + 1] === ud.key) { sk2 = true; break; }
        if (sk2) continue;
      }
      var res = resolveHit(s, tk, ud.key, h, dir);
      if (res === 'stop') { s.pos.copy(h.point); terminated = true; break; }
    }

    if (terminated) { removeShell(si); continue; }
    // 高速炮弹防地形隧穿:中点采样 + 终点采样
    var mpx = s.pos.x + move.x * 0.5, mpy = s.pos.y + move.y * 0.5, mpz = s.pos.z + move.z * 0.5;
    var gym = terrainH(mpx, mpz);
    if (mpy < gym + 0.05) {
      s.pos.set(mpx, gym + 0.05, mpz);
      if (s.isHeliMissile) {
        heliMissileMissBurst(s, s.pos);
        heliMissileGroundSplash(s, s.pos);
      }
      else if (s.isHeliRocket || s._he) heliRocketBurst(s.pos, s.owner, s.dmg);
      else if (s.arty) artilleryBurst(s.pos, s.owner);
      else shellGroundImpact(s.pos);
      removeShell(si); continue;
    }
    var _txp = s.pos.x, _tzp = s.pos.z;                 // 擦树:飞行段起点(倒树用,不阻挡弹道)
    s.pos.add(move);
    var gy = terrainH(s.pos.x, s.pos.z);                // ★审查A8: 三处同参 terrainH 合一(树擦/草抖/落点判定共用, 判定逐位不变)
    if (_treesSegBrush && (s.pos.y - gy) < 12.0)
      _treesSegBrush(_txp, _tzp, s.pos.x, s.pos.z);      // 低空掠过 → 沿段擦倒(树高 ≲10m)
    if (s.owner === player && _grassSegShake && (s.pos.y - gy) < 3.5)
      _grassSegShake(_txp, _tzp, s.pos.x, s.pos.z, 2.6, 0.85);   // 仅玩家炮弹低掠 → 花草抖动(不摧毁)
    if (s.pos.y < gy + 0.05) {
      s.pos.y = gy + 0.05;
      if (s.isHeliMissile) {
        heliMissileMissBurst(s, s.pos);
        heliMissileGroundSplash(s, s.pos);
      }
      else if (s.isHeliRocket || s._he) heliRocketBurst(s.pos, s.owner, s.dmg);
      else if (s.arty) artilleryBurst(s.pos, s.owner);
      else shellGroundImpact(s.pos);
      removeShell(si); continue;
    }

    /* 共用解析尾迹:火箭约11Hz;高速主炮弹40Hz,避免150m线段与弹体明显脱节。均为计时事件,无相机检测。 */
    if (!s._comicLineDone && typeof comicRocketLineUpdate === 'function') {
      s._comicLineT -= dt;
      if (s._comicLineT <= 0) { s._comicLineT = (s.isHeliRocket || s.isHeliMissile) ? 0.025 : (s.arty ? 0.09 : 0.025); comicRocketLineUpdate(s); }
    }

    s.trailT -= dt;
    /* 主炮弹不再发点粒子曳光:弹道可读性由 150m 解析弹道线(comicRocketLine*)承担 */
    if (s.arty && s.trailT <= 0) {
      {
        var burn2 = s.rk.tF < ROCKET_PROF.tBurn;
        _v3.copy(s.vel).normalize();
        var tx = s.pos.x - _v3.x * RK_NOZZLE, ty = s.pos.y - _v3.y * RK_NOZZLE, tz = s.pos.z - _v3.z * RK_NOZZLE;
        /* 全航程尾迹:由模拟时间定距登记整张烟卡;不做相机/距离/炮镜逐次检测,不调用粒子。 */
        /* 全程烟链:助推/惯性段统一 60Hz。惯性段 355m/s 巡航下旧 30Hz 会拉出 ~12m 空洞(烟卡仅 ~4m),
           视觉上"只有发射段有烟"——定频 0.017s 后间距 ≤6m,配合膨胀/湍流即全程连续烟柱。 */
        s.trailT = _rkTrailDt;
        if (typeof comicRocketTrailSpawn === 'function') comicRocketTrailSpawn(tx, ty, tz, _v3, burn2);
      }
    }
  }
  rocketVfxPass();                    // 全收:火箭弹体/尾焰实例矩阵一次写好(≤2 draw call)
  heliMissileVfxPass();               // 直升机机载导弹与尾焰实例矩阵
  heliDecoyVfxPass();                 // 诱饵弹闪光点实例矩阵
  shellVfxPass();                     // 坦克炮弹实例矩阵一次写好(≤2 draw call)
}
function removeShell(i) {
  var shRm = shells[i];
  if (shRm) {
    if (shRm._comicLineSlot >= 0 && typeof comicRocketLineEnd === 'function') comicRocketLineEnd(shRm); // 命中后保留槽供尾端缩短
    var mi = airborneMissiles.indexOf(shRm);
    if (mi >= 0) airborneMissiles.splice(mi, 1);      // 空中导弹子列表同步收割
    if (shRm.guided) {                                // 在空制导火箭子列表同步收割(仅制导弹登记过)
      var ri = airborneGuidedRockets.indexOf(shRm);
      if (ri >= 0) airborneGuidedRockets.splice(ri, 1);
    }
  }
  shells.splice(i, 1);                    // 弹体无独立子节点可摘(无光晕/挂件链)
}
function shellGroundImpact(p, noDust) {
  hitSpark(p, _v1.set(0, 1, 0), _v2.set(0, -1, 0), 'env');
  if (!noDust && typeof comicGroundDust === 'function') comicGroundDust(p.x, p.y, p.z, false);   // 炮弹啃地:漫画扬尘卡(外抛泥环 + 小尘柱)
  sfxDirt(p, 0.5);
}

/* ===== FFA 空袭弹体 =====
   空袭是一个无阵营的 airstrike source，而不是伪造某辆 MLRS 发射。弹体仍带 arty/rk
   标记，因而穿过普通 stepShells、artilleryBurst、warheadPenRoll 和 rocketThreatScan；
   仅发射几何改成从高空竖直下落，伤害固定 60。释放点散布与下落速度抖动沿用普通
   火箭齐射的 ARTY_SALVO_AZ/EL/VJIT 常数，不另造一套散布口径。 */
var FFA_AIRSTRIKE_OWNER = {
  id: 'airstrike', team: 'airstrike', kind: 'airstrike', source: 'airstrike',
  isAirstrike: true, isPlayer: false, alive: true
};
var _ffaAirstrikeSeq = 0;
function airstrikeTargetAllowed(target, owner) {
  if (!target || !target.alive || !target.group || !target.group.position) return false;
  if (owner && owner.source === 'strategic-airstrike') {
    return typeof strategicSupportAirstrikeTargetAllowed === 'function' &&
      strategicSupportAirstrikeTargetAllowed(target, owner);
  }
  return typeof ffaAirstrikeTargetAllowed === 'function' && ffaAirstrikeTargetAllowed(target);
}
function fireAirstrikeBomb(target, shotIndex, owner) {
  var strategic = owner && owner.source === 'strategic-airstrike';
  if (!target || !target.alive || !target.group || !target.group.position || gameState !== 'playing' ||
      (!isFfaMode() && !strategic)) return null;
  var airOwner = owner || FFA_AIRSTRIKE_OWNER;
  if (!airstrikeTargetAllowed(target, airOwner)) return null;
  var tp = target.group.position;
  var tx = tp.x, tz = tp.z;
  var spec = (typeof CONF !== 'undefined' && CONF.arty) ? CONF.arty : { dmg: 60, pen: 1200, rocketSpeed: 640 };
  var dmg = 60, pen = spec.pen || 1200;
  /* The ordinary rocket speed profile tops out at vMax; use that profile's physical speed
     for a downward release so rk.u, displayed velocity, and threat prediction stay unified. */
  var fallSpeed = (typeof ROCKET_PROF !== 'undefined' && ROCKET_PROF.vMax) ? ROCKET_PROF.vMax : 355;
  var azJit = typeof ARTY_SALVO_AZ === 'number' ? ARTY_SALVO_AZ : 0.007;
  var elJit = typeof ARTY_SALVO_EL === 'number' ? ARTY_SALVO_EL : 0.010;
  var vJit = typeof ARTY_SALVO_VJIT === 'number' ? ARTY_SALVO_VJIT : 0.0012;
  var speedJ = 1 + (rand(-1, 1) + rand(-1, 1)) * vJit;
  var downSpeed = fallSpeed * speedJ;
  var a = Math.random() * TAU;
  /* Preserve a strictly vertical fall: ordinary rocket angular dispersion is converted
     into a small random release-point offset, not a horizontal flight vector. */
  var releaseSpread = 900 * (azJit * rand(-1, 1) + elJit * 0.35 * rand(-1, 1));
  var p0x = tx + Math.cos(a) * releaseSpread, p0z = tz + Math.sin(a) * releaseSpread;
  var startY = terrainH(p0x, p0z) + 900;
  var p0 = new THREE.Vector3(p0x, startY, p0z);
  var v0x = 0, v0z = 0, v0y = -downSpeed;
  var grav = (typeof CONF !== 'undefined' && CONF.gravity) || 9.81;
  var tofU = (-v0y + Math.sqrt(v0y * v0y + 2 * grav * 900)) / grav;
  var s = {
    pos: p0.clone(),
    vel: new THREE.Vector3(v0x, v0y, v0z),
    owner: airOwner, pen: pen, dmg: dmg,
    life: 12, trailT: 0, _comicLineT: 0, _comicLineSlot: -1, _comicLineDone: false,
    flyD: 0, kdrag: 0, arty: true, rk: null, airstrike: true, source: airOwner.source,
    _airstrikeSeq: ++_ffaAirstrikeSeq, _airstrikeTarget: target, _airstrikeShot: shotIndex | 0
  };
  s.rk = { p0x: p0.x, p0y: p0.y, p0z: p0.z, v0x: v0x, v0y: v0y, v0z: v0z,
    u: 0, tF: 0, tof0: Math.max(0.5, tofU), fxPhase: Math.random() * TAU };
  shells.push(s);
  var down = new THREE.Vector3(v0x, v0y, v0z).normalize();
  if (typeof comicRocketLineStart === 'function') comicRocketLineStart(s);
  if (typeof comicRocketLaunchBurst === 'function') comicRocketLaunchBurst(airOwner, down, p0, dmg);
  if (typeof sfxRocketWhoosh === 'function') sfxRocketWhoosh(p0, fallSpeed);
  return s;
}
function fireFfaAirstrikeBomb(target, shotIndex) {
  if (!isFfaMode()) return null;
  return fireAirstrikeBomb(target, shotIndex, FFA_AIRSTRIKE_OWNER);
}

/* ===== 火箭炮:爆炸 + 范围溅射(对双方均有杀伤,火/殉爆走常规模块钩子) ===== */
function artilleryBurst(p, owner) {
  var bp = p.clone ? p.clone() : new THREE.Vector3(p.x, p.y, p.z);
  /* 漫画风爆点(花瓣云+墨线芒+墨滴,comic.js):爆闪灯/震屏/爆炸声/弹坑/溅射/入账等玩法层不受视觉实现影响 */
  if (typeof comicArtyBurst === 'function') comicArtyBurst(bp);    // 火光/蘑菇烟/四周高亮贴图,无PointLight或发光粒子
  _addBattlefieldHeatSource(bp.x, bp.y, bp.z, 2200.0, 2.5);
  var dCB = player ? bp.distanceTo(player.group.position) : 999;
  var svCB = clamp(36 / Math.max(6, dCB), 0, 0.85);
  camShake = Math.max(camShake, svCB * svCB * 1.35);              // 平方衰减震屏(36/max(6,d)上限0.85 ×1.35 — 较大爆炸的 26/max(6,d)上限0.7 强约两成)
  var _isAirstrikeOwner = owner && (owner.source === 'airstrike' || owner.source === 'strategic-airstrike');
  var _abSpec = _isAirstrikeOwner
    ? { dmg: 60, splashR: splashRadiusFromDamage(60), pen: 1200 }
    : artyConfOf(owner);   // 普通火箭按发射方规格;个人/战略空袭固定 60 伤/普通 60 伤爆炸口径
  if (typeof sfxExplodeByDamage === 'function') sfxExplodeByDamage(bp, _abSpec.dmg);
  else sfxExplode(bp, 1.3);                                            // 爆炸声∝伤害
  recentBursts.push({ x: bp.x, z: bp.z, t: gameT });               // 爆点入账:惊醒附近"专注"状态的 AI(见 awarenessUpdate)
  if (typeof burstGridMark === 'function') burstGridMark(bp.x, bp.z, gameT);   // 12m 桶位图同步登记(awarenessUpdate 邻桶查询用)
  if (recentBursts.length > 48) recentBursts.shift();
  if (bp.y - terrainH(bp.x, bp.z) < 2.0) queueCrater(bp.x, bp.z);   // 贴地爆炸 → 犁出真实弹坑(凹坑+凸缘+焦土)
  var _airstrikeDamage = !_isAirstrikeOwner || owner.source === 'strategic-airstrike' ||
    typeof ffaAirstrikeDamageAllowedAt !== 'function' || ffaAirstrikeDamageAllowedAt(bp.x, bp.z);
  if (_airstrikeDamage) applySplash(bp, splashRadiusFromDamage(_abSpec.dmg), _abSpec.dmg, owner);
  if (typeof comicGroundDust === 'function') comicGroundDust(bp.x, bp.y + 0.4, bp.z, true); // 伴随大范围地面泥尘外抛
  if (DBG_ON && owner === player) {                 // 无头回归:记录玩家火箭弹真实爆点(对指示器精度断言)
    if (dbgPlayerBursts.length >= 128) dbgPlayerBursts.shift();
    dbgPlayerBursts.push({ x: bp.x, z: bp.z, t: gameT });
  }
  if (DBG_ON) {                                     // 全量爆点(AI 齐射弹量/节奏审计)
    if (dbgArtyBursts.length >= 4000) dbgArtyBursts.shift();
    dbgArtyBursts.push({ x: bp.x, z: bp.z, t: gameT, o: owner });
  }
}
var _SPLASH_KEYS = ['hull', 'trackL', 'trackR', 'engine', 'fuel', 'ammo', 'turret'];   // 模块常量(逐爆点提升,语义不变)
var _splashScratch = [];                         // 溅射邻域查询复用 scratch(零分配)
/* P1-6 溅射弹痕落点:爆心朝向车体表面点(原 t.group.position 在车体中心/底部,弹痕基本不可见)。
   高度按件区分(炮塔/炮管取上部),半径按件区分(炮塔内收);返回普通 {x,y,z}(vehWeatherHit 兼容)。 */
function splashMarkPoint(t, p, key) {
  var c = t.group.position;
  var part = (typeof WX_PART_OF !== 'undefined' && WX_PART_OF[key]) || 'hull';
  var up = (part === 'turret' || part === 'gun') ? 1.8 : 1.0;
  var R = (t.radius || 3) * (part === 'hull' ? 0.7 : 0.45);
  var dx = c.x - p.x, dz = c.z - p.z;
  var len = Math.sqrt(dx * dx + dz * dz);
  if (!(len > 0.001)) return { x: c.x + R, y: c.y + up, z: c.z };
  return { x: c.x - dx / len * R, y: c.y + up, z: c.z - dz / len * R };
}
function applySplash(p, radius, dmg, owner) {
  var nearby = collectAiNearby(p.x, p.z, radius + 3.1, _splashScratch);   // 空间邻域预筛(~14m<100m 格宽必落 3×3;XZ 命中是 3D 命中的必要条件,无漏报)
  for (var i = 0; i < nearby.length; i++) {         // 残骸不可摧毁——不在活车表,溅射天然不及(直击弹体仍被残骸拦下)
    var t = nearby[i];
    if (!t.alive) continue;                        // aiGrid 0.25s 陈旧,活车守卫保与 aliveList 即时口径一致
    if (owner && (owner.source === 'airstrike' || owner.source === 'strategic-airstrike') && !airstrikeTargetAllowed(t, owner)) continue;
    /* FFA 只有其他载具是敌人；战略空袭只伤害支援方指定区域内的敌方地面载具。
       普通团队死斗火箭仍保留原有溅射口径，避免改动既有友军伤害规则。 */
    if (isFfaMode() && (t === owner || !areHostile(owner, t))) continue;
    var dx = t.group.position.x - p.x, dz = t.group.position.z - p.z;
    var dy = t.group.position.y + 1.2 - p.y;
    var rr = radius + t.radius * 0.7;
    var d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > rr * rr) continue;
    var frac = clamp(1 - Math.sqrt(d2) / rr, 0, 1);
    var dT = dmg * (0.2 + 0.8 * frac);
    var _sk1 = _SPLASH_KEYS[Math.floor(Math.random() * _SPLASH_KEYS.length)];
    applyModuleDamage(t, _sk1, dT, owner, splashMarkPoint(t, p, _sk1), 0);
    if (frac > 0.45) {      // 爆心附近二次破片
      var _sk2 = _SPLASH_KEYS[Math.floor(Math.random() * _SPLASH_KEYS.length)];
      applyModuleDamage(t, _sk2, dT * 0.5, owner, splashMarkPoint(t, p, _sk2), 0);
    }
    if (t.isPlayer) { dmgFlash(0.3); camShake = Math.max(camShake, 0.45); }
  }
  if (typeof destroyFortificationsInRadius === 'function') destroyFortificationsInRadius(p.x, p.z, radius);
}

/* ===== 命中火花外观遮挡板(侧裙甲/翼子板) ----
   这些纯视觉件无命中判定,但建模会在画面上盖住装甲面上的火花。
   解析矩形表(车体局部系,与 createTank 视觉建模同源,改建模需同步):
   火花发射前把本帧弹道射线变换进车体局部系,与遮挡板求交;
   若在装甲命中点之前先穿过某块遮挡板,火花改钉到该板外表面。
   纯事件时机计算(每次首板命中 ≤3 次平面求交+1 次矩阵求逆),零逐帧开销。
   td89 翼板贴带顶(遮挡量极小)/arty 无裙板,未入表。 ===== */
var SPARK_SHIELDS = {
  t59:  { skirtX: 1.625, skirtY: [0.40, 1.045], skirtZ: [-2.39, 2.47],
           fenderY: 1.115, fenderX: [0.972, 1.552], fenderZ: [-2.45, 2.47] },
  m60:  { skirtX: 1.60,  skirtY: [0.45, 1.20],   skirtZ: [-2.77, 2.08],
          fenderY: 1.32,  fenderX: [0.90, 1.50],  fenderZ: [-2.80, 2.10] },   // 后半段拉长 4/3 随动
  t99:  { skirtX: 1.55, skirtY: [0.74, 1.105],  skirtZ: [-3.03, 2.43],
           fenderY: 1.14, fenderX: [0.968, 1.548], fenderZ: [-3.15, 2.45] },  // 红方重型坦克:锯齿深裙板体(齿不计)+翼子板(随翼板降/内缘埋车侧同步)
  m1a1: { skirtX: 1.65,  skirtY: [0.455, 1.065], skirtZ: [-2.535, 2.535] }   // M1 裙板通顶,无独立水平翼板
};
var _sspO = new THREE.Vector3(), _sspD = new THREE.Vector3(), _sspH = new THREE.Vector3(),
    _sspP = new THREE.Vector3(), _sspN = new THREE.Vector3(), _sspM = new THREE.Matrix4();
function sparkShieldAdjust(t, rayOrigin, rayDir, hitPoint) {   // true=_sspP/_sspN 已写入遮挡板面点/外法线
  var sh = SPARK_SHIELDS[dynModelKey(t)];
  if (!sh || !t.group) return false;
  _sspM.copy(t.group.matrixWorld).invert();
  var o = _sspO.copy(rayOrigin).applyMatrix4(_sspM);
  var d = _sspD.copy(rayDir).transformDirection(_sspM);        // 刚体变换:射线参数 t 与世界系等距
  var tHit = _sspH.copy(hitPoint).applyMatrix4(_sspM).sub(o).dot(d);
  var best = tHit - 0.02, bx = 0, by = 0, bz = 0, bn = 0;      // bn:1=+x 裙 2=-x 裙 3=翼板顶
  if (sh.skirtX) for (var sgn = -1; sgn <= 1; sgn += 2) {
    if (d.x * sgn >= -1e-6) continue;                          // 必须由该侧外向内穿板
    var tt = (sgn * sh.skirtX - o.x) / d.x;
    if (tt <= 0.01 || tt >= best) continue;
    var yy = o.y + d.y * tt, zz = o.z + d.z * tt;
    if (yy < sh.skirtY[0] || yy > sh.skirtY[1] || zz < sh.skirtZ[0] || zz > sh.skirtZ[1]) continue;
    best = tt; bx = sgn * sh.skirtX; by = yy; bz = zz; bn = sgn > 0 ? 1 : 2;
  }
  if (sh.fenderY && d.y < -1e-6) {                             // 翼板只挡自上而下的弹道
    var tf = (sh.fenderY - o.y) / d.y;
    if (tf > 0.01 && tf < best) {
      var xx = o.x + d.x * tf, zf = o.z + d.z * tf, ax = Math.abs(xx);
      if (ax >= sh.fenderX[0] && ax <= sh.fenderX[1] && zf >= sh.fenderZ[0] && zf <= sh.fenderZ[1]) {
        best = tf; bx = xx; by = sh.fenderY; bz = zf; bn = 3;
      }
    }
  }
  if (!bn) return false;
  _sspP.set(bx, by, bz).applyMatrix4(t.group.matrixWorld);
  _sspN.set(bn === 1 ? 1 : bn === 2 ? -1 : 0, bn === 3 ? 1 : 0, 0).transformDirection(t.group.matrixWorld);
  return true;
}
/* ===== 统一装甲入射解算 =====
   物理口径:
     1) hit.face.normal 经 world normal matrix 转为世界法线,因此目标车体的坡面姿态/炮塔姿态会进入计算;
     2) rayDir 使用本段真实弹道位移方向,包含主炮/火箭/导弹当前的下坠、制导转向和车体相对速度;
     3) cosI = -normalize(rayDir)·nWorld,物理厚度 d 的等效厚度为 d/cosI;
     4) 与 core.js 的既有规则一致,入射角超过 68° 视为跳弹/非有效正向命中,不再用任意 0.342 兜底把它当成有限厚度。
   这组 scratch 由同步调用者立即消费,不跨帧保存,避免每发命中产生临时 Vector3/Matrix3。 */
var ARMOR_RICOCHET_ANGLE_DEG = 68;
var ARMOR_RICOCHET_COS = Math.cos(ARMOR_RICOCHET_ANGLE_DEG * Math.PI / 180);
var _armorNormalMat = new THREE.Matrix3();
var _armorNWorld = new THREE.Vector3();
var _armorRayDir = new THREE.Vector3();
var _armorLocalPoint = new THREE.Vector3();
var _armorImpact = { nWorld: _armorNWorld, rayDir: _armorRayDir, cosI: 0, angleDeg: 180, armor: 0, effective: Infinity, armorBonus: 0, ricochet: true };
function armorImpactSolution(mod, hit, rayDir, armorCarrier) {
  var len = rayDir && rayDir.length ? rayDir.length() : 0;
  if (!hit || !hit.face || !hit.face.normal || !hit.object || len < 1e-7) {
    _armorImpact.cosI = -1; _armorImpact.angleDeg = 180; _armorImpact.armor = 0;
    _armorImpact.effective = Infinity; _armorImpact.armorBonus = 0; _armorImpact.ricochet = true;
    return _armorImpact;
  }
  _armorRayDir.copy(rayDir).multiplyScalar(1 / len);
  _armorNormalMat.getNormalMatrix(hit.object.matrixWorld);
  _armorNWorld.copy(hit.face.normal).applyMatrix3(_armorNormalMat).normalize();
  var cosI = -_armorRayDir.dot(_armorNWorld);
  var ud = hit.object.userData || {};
  var localPoint = hit.object.worldToLocal(_armorLocalPoint.copy(hit.point));
  var armor = armorOf(mod, hit.face.normal, ud.face, localPoint);
  var angleDeg = Math.acos(clamp(cosI, -1, 1)) * 57.295779513;
  _armorImpact.cosI = cosI;
  _armorImpact.angleDeg = angleDeg;
  _armorImpact.armor = armor;
  /* Add Super Armor after the real physical thickness/angle solution, directly to
     equivalent armor. This is intentionally not a pre-angle plate-thickness bonus. */
  var armorBonus = (typeof powerupArmorBonus === 'function') ? powerupArmorBonus(armorCarrier) : 0;
  _armorImpact.armorBonus = armorBonus;
  _armorImpact.effective = cosI > 1e-7 ? armor / cosI + armorBonus : Infinity;
  _armorImpact.ricochet = cosI <= ARMOR_RICOCHET_COS;
  return _armorImpact;
}

/* ===== 战斗部直击穿深闸门 (导弹/直升机火箭弹/制导火箭弹/火箭炮火箭弹共用) =====
   与 resolveHit(坦克AP弹) 共用 armorImpactSolution:物理厚度→真实入射角等效厚度→穿深比对。
   返回 true=击穿(直击模块伤害放行) / false=未击穿(直击伤害归零; 起爆/溅射照常——HE战斗部碰甲仍炸)。
   与 AP 弹的三点差异(有意设计):
     · 不吃 kdrag·flyD 存速衰减 —— 战斗部穿深是化学能定型值, 不随飞行里程衰减;
     · 不进 ×0.62 穿透链 —— 单次起爆结算, 无贯穿多层概念(穿深字段即本发全值);
     · 未击穿不出弹体反弹 —— 战斗部就地起爆自灭, 只出装甲面白闪+钝响(反馈同AP的 stop 态)。
   接入点: resolveMissileHit(导弹) / stepShells 直击分支(直升机火箭弹·火箭炮) / fire 贴脸分支(火箭炮零距离)。 */
function warheadPenRoll(s, t, key, hit, rayDir) {
  var mod = t.mods && t.mods[key] ? t.mods[key] : (t.mods && t.mods.hull ? t.mods.hull : null);
  var dbgShooter = s && s.owner && typeof dbgStats !== 'undefined' ? dbgStats[s.owner.team] : null;
  if (!mod || !mod.armor) return true;                          // 无装甲数据(异常兜底) → 放行不拦伤害
  var calc = armorImpactSolution(mod, hit, rayDir, t);
  var nWorld = calc.nWorld, cosA = calc.cosI, armor = calc.armor, eff = calc.effective;
  var roll = calc.ricochet ? -Infinity : s.pen * rand(0.92, 1.08);
  var faceL = (hit.object.userData && hit.object.userData.face) || dbgFace(t, nWorld);
  /* Super AP is applied at the actual warhead penetration roll, so rockets and
     missiles receive the same fixed 150 mm bonus as shells and cannon rounds. */
  var penBonus = (s && s.owner && typeof powerupPenetrationBonus === 'function') ? powerupPenetrationBonus(s.owner) : 0;
  var rollPen = s.pen * rand(0.92, 1.08) + penBonus;
  roll = calc.ricochet ? -Infinity : rollPen;

  if (!calc.ricochet && roll >= eff) {                         // 击穿
    if (DBG_ON && s.owner && areHostile(s.owner, t) && dbgShooter) {
      dbgShooter.pen++;                             // 与 AP 同账本: 战斗部穿深命中率可审计
      dbgStats[t.team].face[faceL]++;
      dbgStats[t.team].facePen[faceL]++;
      dbgShooter.penDmg += s.dmg;
    }
    return true;
  }

  // 未击穿: 战斗部在装甲面起爆 —— 直击伤害归零, 起爆/溅射由调用方照常执行
  if (DBG_ON && s.owner && areHostile(s.owner, t) && dbgShooter) {
    dbgShooter.bounce++;
    dbgStats[t.team].face[faceL]++;
  }
  hitSpark(hit.point, nWorld, rayDir, 'stop');                  // 装甲面白闪(与AP未击穿同反馈)
  sfxArmorStop(hit.point, (t === player || s.owner === player) ? 0.9 : 0.45);
  if (s.owner === player && typeof hitMarkerChain === 'function') hitMarkerChain(s, 'NO PEN', 'bounce');
  if (t === player) { dmgFlash(0.25); camShake = Math.max(camShake, 0.3); }
  noteAttacked(t, s.owner);                                     // 挨了打(未击穿也算) → 后方之敌进入警觉
  return false;
}
function resolveHit(s, t, key, hit, rayDir) {
  var mod = t.mods[key];
  (s._skip = s._skip || []).push(t, key);                       // 穿透后车体内部不再结算本模块其它板面(首甲链不叠甲)
  /* 命中火花只发一次:本弹对本车的首个射线交点=最外层装甲面(交点按距离升序),
     穿甲链后续内层板(如穿外甲后命中油箱)只结算伤害不再出花——火花永远钉在载具外表面。 */
  var firstHit = !s._spk || s._spk.indexOf(t) < 0;
  if (firstHit) (s._spk = s._spk || []).push(t);
  var spkP = hit.point, spkN = null;                            // 火花点位/法线(默认=装甲命中面)
  if (firstHit && sparkShieldAdjust(t, s.pos, rayDir, hit.point)) { spkP = _sspP; spkN = _sspN; }
  var calc = armorImpactSolution(mod, hit, rayDir, t);
  var nWorld = calc.nWorld, cosA = calc.cosI;
  var ang = calc.angleDeg;
  var faceL = (hit.object.userData && hit.object.userData.face) || dbgFace(t, nWorld);
  if (DBG_ON && s.owner && areHostile(s.owner, t)) dbgStats[t.team].face[faceL]++;

  /* 大入射角按 core.js 规则跳弹;其余命中严格采用 物理厚度/cos(真实入射角)。
     不再把 cosI 强行抬到 0.342,也不再让炮弹从装甲背面以有限厚度“击穿”。 */

  var armor = calc.armor, eff = calc.effective;
  // 穿深存速衰减:P(R)=P·e^(−k·flyD)(真实弹道物理,推导见 CONF 注记);
  //   叠乘在穿透链×0.62 之后的"本发剩余穿深"上,原子数值=出膛穿深
  var penR = (s.kdrag && s.flyD > 0) ? s.pen * Math.exp(-s.kdrag * s.flyD) : s.pen;
  /* Fixed Super AP bonus is added after shell velocity-loss calculation, at the
     real penetration stage; subsequent penetration layers still consume the normal
     0.62 residual of the round and re-add the fixed bonus on their own roll. */
  var penBonusAP = typeof powerupPenetrationBonus === 'function' ? powerupPenetrationBonus(s.owner) : 0;
  var roll = calc.ricochet ? -Infinity : penR * rand(0.92, 1.08) + penBonusAP;
  if (DBG_ON && s._rec) s._rec({ key: key, face: faceL, ang: ang, armor: armor, eff: eff, roll: roll, penR: penR, flyD: s.flyD || 0, ricochet: calc.ricochet });

  if (!calc.ricochet && roll >= eff) {                    // 击穿
    if (DBG_ON && areHostile(s.owner, t)) {
      dbgStats[s.owner.team].pen++;
      dbgStats[t.team].facePen[faceL]++;
      dbgStats[s.owner.team].penDmg += s.dmg;        // 累计击穿前理论伤害
    }
    s.pen *= 0.62;
    s._chain = (s._chain || 0) + 1;                      // 贯穿链记账:每击穿一层板,本发剩余穿深×0.62(日志溯源用)
    var dmg = s.dmg * rand(0.85, 1.15);
    s.dmg *= 0.7;
    // 命中火花按穿深余量分两态——ratio=穿深/等效 ≥2.0 为过度穿透(×0.62后仍可再穿同层),
    // 1.0~2.0 为恰好击穿(穿孔即止);未击穿走 'stop' 装甲面溅射。仅首板(外表面)出花。
    var ratio = roll / eff;
    if (firstHit) hitSpark(spkP, spkN || nWorld, rayDir, ratio >= 2.0 ? 'over' : 'pen');
    sfxArmorStop(hit.point, (t === player || s.owner === player) ? 0.9 : 0.45);   // 击穿/未击穿同用钝实铛着弹声(AI 互殴也有声)
    if (s.owner === player) hitMarkerChain(s, 'HIT ' + mod.label, 'pen');        // 命中链播报:按穿甲链顺序逐行(先中在上)
    applyModuleDamage(t, key, dmg, s.owner, hit.point, 0);
    return 'through';
  }

  // 未击穿
  if (DBG_ON && areHostile(s.owner, t)) dbgStats[s.owner.team].bounce++;
  if (firstHit) hitSpark(spkP, spkN || nWorld, rayDir, 'stop');     // 未击穿白闪(仅首板;内层拦停不在车内出花)
  sfxArmorStop(hit.point, (t === player || s.owner === player) ? 0.9 : 0.45);
  if (s.owner === player) {
    hitMarkerChain(s, 'NO PEN', 'bounce');
    // 播报的是"本发此刻的剩余穿深"×±8% 公差:若同一发弹此前击穿过板面(×0.62/层),
    // 还含按真实飞行里程的存速衰减 e^(−k·flyD),穿深已衰减——注明来源

  }
  if (t === player) {
    dmgFlash(0.25);
    camShake = Math.max(camShake, 0.3);
  }
  noteAttacked(t, s.owner);                               // 挨了打(未击穿也算)→ 后方之敌进入警觉
  return 'stop';
}

