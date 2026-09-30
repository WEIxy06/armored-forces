
/* ===== Module: combat.js ===== */
/* ============================================================
   模块: combat.js — 战斗核心:模块伤害判定/残骸/接管/重部署/昼夜光照
   (加载顺序由 index.html MODULES 表决定,勿单独调整)
   ============================================================ */
'use strict';
/* ============================================================
   模块与伤害判定核心
   ============================================================ */
function armorOf(mod, ln, force, lp) {   // lp=命中点(命中壳局部系,可选):单壳位置分区用(红方重型坦克侧甲前后带);未传按前带兜底
  var a = mod.armor;
  if (a.all !== undefined) return a.all;
  if (force === 'dome') {
    // 59 式铸造穹顶按法线方位角划分前、侧、后 120° 扇区;轴支配法会把椭球上半部误判为顶面。
    var azd = Math.abs(Math.atan2(ln.x, ln.z));
    if (azd < Math.PI / 3) return a.front;
    if (azd > Math.PI * 2 / 3) return a.rear;
    return a.side;
  }
  if (force === 'hullshell') {                                // 59 式车体棱柱壳:命中面按普通前/后/侧/顶/底分区读取
    if (ln.z > 0.35) return a.front;
    if (ln.z < -0.35) return a.rear;
    var axs = Math.abs(ln.x), ays = Math.abs(ln.y);           // 余下:甲板/车底(|y| 主)与两侧(±x)
    if (ays >= axs) return ln.y > 0 ? a.top : (a.bottom || a.top);
    return a.side;
  }
  if (force === 'm1hull') {                                 // 首前半球先判——浅带首上(y≈0.95,复合等效)与 75° 首下(y≈0.26,物理)分槽
    /* DU is a per-player hull-module equivalent-armor bonus.  It is deliberately
       consumed here, before armorImpactSolution applies the real incidence-angle
       calculation, and never reaches turret/side/rear plates or AI modules. */
    var duFront = Number(mod._duFrontBonus) || 0;
    if (ln.z > 0.20) return ln.y > 0.6 ? a.front + duFront : ((a.glacis !== undefined ? a.glacis : a.front) + duFront);
    if (ln.z < -0.20) return a.rear;
    if (Math.abs(ln.y) > 0.86) return ln.y > 0 ? a.top : (a.bottom || a.top);   // 甲板/车底
    return a.side;
  }
  if (force === 'm1turret') {                               // 复合楔颊按前后分量归属;水平顶/底优先
    if (Math.abs(ln.y) > 0.86) return ln.y > 0 ? a.top : (a.bottom || a.top);
    if (ln.z > 0.22) return a.front;
    if (ln.z < -0.22) return a.rear;
    return a.side;
  }
  if (force === 't99hull') {                                // 红方重型坦克车体(唯一真面壳):首上(法线 y0.915/z0.404)/首下鼻板(y-0.428/z0.904)双前甲分槽;
    if (ln.z > 0.35) return ln.y > 0.6 ? a.front : a.glacis;
    if (ln.z < -0.35) return a.rear;
    var ax9 = Math.abs(ln.x), ay9 = Math.abs(ln.y);
    if (ay9 >= ax9) return ln.y > 0 ? a.top : (a.bottom || a.top);
    return lp && lp.z < -0.85 ? a.sideR : a.sideF;          // 侧甲按命中点 z 分区:前段 300/发动机段 150(界 -0.85;无附加面片)
  }
  if (force === 't99turret') {                              // 红方重型坦克炮塔(唯一真面壳):按面归属返回物理厚度
    var azT = Math.abs(ln.z);
    if (Math.abs(ln.y) > 0.97 && azT < 0.2) return ln.y > 0 ? a.top : (a.bottom || a.top);   // 平顶/底
    if (ln.z > 0.2) return a.front;                         // 前楔的物理厚度交给统一入射角公式折算,不再预先乘 |nz|
    if (ln.z < -0.2) return a.rear;
    return lp && lp.z < -0.45 ? a.sideR : a.sideF;          // 侧甲按命中点 z 分区:前带 200/后带 100(界 -0.45)
  }
  /* 命中壳法线走通用分区:装甲=物理厚度,等效=物理/cos入射角,全载具同一算法。 */
  if (force === 'mantlet') return (a.front !== undefined ? a.front : (a.side || 0)) * 0.5; // vehicle.js 炮盾=同平台正面装甲一半
  if (force && a[force] !== undefined) return a[force];      // 斜面薄板:面归属由板件显式声明
  var ax = Math.abs(ln.x), ay = Math.abs(ln.y), az = Math.abs(ln.z);
  if (ay >= ax && ay >= az) return ln.y > 0 ? a.top : (a.bottom || a.top);
  if (az >= ax) return ln.z > 0 ? a.front : a.rear;
  return a.side;
}
/* ===== 模块毁伤→性能连续惩罚(用户四条+弃车规则)——
   ①炮弹初速/穿深 ∝ 炮管血量%(fireShell 内 barrelEff,火箭弹不受影响);
   ②油箱 0%=断油:无法移动(速度/转向双锁 0);
   ③发动机效率=血量%:影响加减速/最大速度/转向速度(0%=无法工作);
   ④炮塔血量%:转速线性衰减(0%=物理卡死);装填另走 reloadDamageMult(人工=炮塔方案/
     自动装弹机=弹药架方案,0% 均降为一半不归零);炮塔归零不再触发 AI 弃车(弃车规则①仅炮管)。
   改连续线性。 ===== */
function engineEff(t) { var m = t.mods.engine; return m.max > 0 ? clamp(m.hp / m.max, 0, 1) : 1; }
function turretEff(t) { var m = t.mods.turret; return m.max > 0 ? clamp(m.hp / m.max, 0, 1) : 1; }
function barrelEff(t) { var m = t.mods.gun; return m && m.max > 0 ? clamp(m.hp / m.max, 0, 1) : 1; }
function fueled(t) { var m = t.mods.fuel; return !m || m.hp > 0; }          // 油箱 0%=断油
/* ===== 装填速度衰减通用函数(按装填体制分流)----
   人工装填(各型号装甲车辆):炮塔(战斗室)受损伤及装填手 → 炮塔血量%线性,
     0% 降为一半(车组乘员接替装填手,不归零);炮塔转速另走 turretMult(0%=物理卡死);
   弹药架方案(自动装弹机/火箭炮):装填链在弹药架内,炮塔(火箭炮=转盘,只管转动)受损
     不降低装填 → 弹药架血量%线性,同 0.5 下限(火箭炮弹药架=发射架/发射舱,火箭弹就装在
     那里,装填作业围绕它进行)。新增自动装弹机型号只需入册 AUTOLOADER_KINDS。 ===== */
var AUTOLOADER_KINDS = { '99': true };
function isAutoloader(t) { return !!AUTOLOADER_KINDS[t.kind]; }
function _calcReloadMult(t) {
  if (isAutoloader(t) || t.kind === 'arty') {   // 火箭炮装填走弹药架(发射架/发射舱)血量方案:转盘(turret)只管转动
    var ma = t.mods.ammo;
    return ma && ma.max > 0 ? Math.max(clamp(ma.hp / ma.max, 0, 1), 0.5) : 1;
  }
  return Math.max(turretEff(t), 0.5);
}
function reloadDamageMult(t) {
  var base = t._eff ? t._eff.reload : _calcReloadMult(t);
  var powerupRate = typeof powerupReloadRate === 'function' ? powerupReloadRate(t) : 1;
  var techRate = typeof vehicleTechBurstLoadingRate === 'function' ? vehicleTechBurstLoadingRate(t) : 1;
  return base * powerupRate * techRate;
}
/* ===== 效率族事件缓存(帧检测→触发器):speedMult/turnMult/turretMult/reloadDamageMult
   均为模块 hp 的纯函数,而模块 hp 仅在受击/world.js 火灾烧蚀与紧急维修完成时变化——
   事件发生时 effSync 一次重算入 t._eff,
   物理/AI 每帧消费只读缓存(公开函数签名不变,无缓存兜底直算=预览车/异常路径安全)。 ===== */
/* 机动效率单一真源:直线速度与转向仅差"单侧断带"的残余系数,其余判定(直升机分支/
   双侧断带归零/断油归零/发动机效率)完全同构。oneTrack = 单侧断带后保留的比例。
   注意:两个系数必须各自独立可调,勿合并为同一常量。 */
function _calcMobilityMult(t, oneTrack) {
  if (!t || !t.mods) return 1;
  var m = t.mods;
  if (isHeliVehicle(t)) {                                    // 直升机:trackL 复用为"起落架/传动"损毁位
    if (m.trackL && m.trackL.hp <= 0) return 0;
    return fueled(t) ? engineEff(t) : 0;
  }
  var lDead = m.trackL ? m.trackL.hp <= 0 : false, rDead = m.trackR ? m.trackR.hp <= 0 : false;
  if (lDead && rDead) return 0;                              // 双侧断带:趴窝
  if (!fueled(t)) return 0;                                  // 断油:趴窝
  return (lDead || rDead ? oneTrack : 1) * engineEff(t);     // 单侧断带:按通道各自的残余系数折算
}
function _calcSpeedMult(t) { return _calcMobilityMult(t, 0.4); }   // 直线速度:单侧断带余 40%
function _calcTurnMult(t)  { return _calcMobilityMult(t, 0.5); }   // 转向速率:单侧断带余 50%
function effSync(t) {
  t._eff = { speed: _calcSpeedMult(t), turn: _calcTurnMult(t), turret: turretEff(t), reload: _calcReloadMult(t) };
}
function speedMult(t) {
  var base = t._eff ? t._eff.speed : _calcSpeedMult(t);
  /* Rocket Boost adds a fixed 10 km/h to the resulting ground speed, rather than
     multiplying the vehicle's native speed. Helicopters are rejected by the accessor. */
  if (typeof powerupSpeedBonusMps === 'function') {
    var v0 = t && t.speed0 ? t.speed0 : 0, bonus = powerupSpeedBonusMps(t);
    if (v0 > 0 && bonus > 0) return (base * v0 + bonus) / v0;
  }
  return base;
}
function turnMult(t) { return t._eff ? t._eff.turn : _calcTurnMult(t); }
function turretMult(t) {
  return t._eff ? t._eff.turret : turretEff(t);                              // ④炮塔转速 ∝ 炮塔血量(0%=物理卡死;装填速率另走 reloadDamageMult)
}
function modWorldPos(t, key) {
  var v = new THREE.Vector3();
  t.mods[key].mesh.getWorldPosition(v);
  return v;
}
/* ===== 炮塔看门狗:每 0.5s 全检存活车——炮塔视觉网格有以下任一类即在控制台留证:
   visual 被关/几何顶点空/包围球 NaN/世界矩阵 NaN。用户若再见"炮塔消失",把 [TURRET-DOG] 日志发回即可定案 ===== */
var turretDogT = 0;
function turretWatchdog(dt) {
  if (!DBG_ON) return;   // 纯诊断(只 console.warn,无副作用):生产环境零开销,验收/回归时照常留证
  turretDogT -= dt; if (turretDogT > 0) return; turretDogT = 0.5;
  for (var i = 0; i < aliveList.length; i++) {
    var t = aliveList[i];
    var legitHide = t.isPlayer && !ownVisualsVisible;   // 玩家开镜自隐合法(非丢塔),豁免 visual-off 误报
    var bad = '', n = 0;
    t.turret.traverse(function (m) {
      if (!(m.userData && m.userData.visual) || !m.geometry) return;
      n++;
      if (!m.visible && !legitHide) bad = 'visual-off';
      if (!m.geometry.attributes.position.count) bad = 'empty-geo';
      var bs = m.geometry.boundingSphere; if (bs && !isFinite(bs.radius)) bad = 'NaN-sphere';
      if (!m.matrixWorld.elements.every(Number.isFinite)) bad = 'NaN-matrix';
    });
    if (bad || !n) console.warn('[TURRET-DOG]', bad || 'no-turret-mesh', 'team=' + t.team, 'kind=' + t.kind,
      'struct=' + t.struct.toFixed(0), 'pos=' + t.group.position.x.toFixed(0) + ',' + t.group.position.z.toFixed(0),
      'turretYaw=' + t.turretYaw, '(if you see this log please send a screenshot)');
  }
}
function setTankVisuals(t, v) {
  t.group.traverse(function (m) {
    if (m.userData && m.userData.visual && !m.userData._instSrc) m.visible = v;
  });
  // 直升机挂载导弹显隐状态补偿:退出炮镜恢复可见时,若导弹尚未装填完毕,严格保持隐藏,禁止错误复现
  if (v && (isHeliVehicle(t) || (typeof isAAVehicle === 'function' && isAAVehicle(t))) && t._heliMslMeshesL) {   // 多联装/防空发射架按筒复现——发射消耗前段筒位,装填中整侧隐藏
    var _mxV = t._heliMslMeshesL.length;
    var _rnd = t._heliMslRounds || [_mxV, _mxV];
    var _visL = (t._heliMissileReloadTL == null || t._heliMissileReloadTL <= 0) ? (_rnd[0] || 0) : 0;
    var _visR = (t._heliMissileReloadTR == null || t._heliMissileReloadTR <= 0) ? (_rnd[1] || 0) : 0;
    for (var _vi = 0; _vi < _mxV; _vi++) {
      t._heliMslMeshesL[_vi].visible = _vi >= (_mxV - _visL);
      if (t._heliMslMeshesR[_vi]) t._heliMslMeshesR[_vi].visible = _vi >= (_mxV - _visR);
    }
  }
}

/* ===== AI 弃车行为(事件驱动,零轮询)——
   规则①:炮管生命值 < ABANDON_HP(20)→ 3s 后弃车(含火箭炮载具);
           (炮塔归零=卡死+装填减半,乘员接替装填手,不触发弃车)
   规则②:油箱生命值 0% → FUEL_ARM_T(60s)观察窗内无射击 → 3s 倒数弃车(任意射击重置窗口,滑窗语义)。
   通用弃车=玩家同款 3s 倒数 + killTank(t,'弃车');玩家座车/被接管车(isPlayer/无 ai)豁免,接管瞬间 abandonCancel。
   性能:平时 abandonWatch 空表(开关全关),1Hz 仅一次长度判断;入表只发生在损伤瞬间(O(1)),
   射击重置 O(1);不检索全体 AI,不进入逐帧流程。 ===== */
var ABANDON_HP = 20;       // 炮管生命值低于此值 → 3s 后弃车
var FUEL_ARM_T = 60;       // 断油后无射击观察窗(s):窗口内无射击 → 3s 倒数弃车
var ABANDON_CD = 3;        // 弃车倒数(s,与玩家通用弃车同款)
var abandonWatch = [];     // 活跃弃车观察表(事件驱动:仅达成条件时入表;平时空表)
function abandonArm(t, key) {
  if (t.isPlayer || !t.ai || !t.alive) return;                  // 仅 AI 车(含火箭炮);玩家/被接管/阵亡豁免
  var mod = t.mods[key];
  var gunBad = key === 'gun' && mod.hp < ABANDON_HP;            // 仅炮管触发弃车
  var fuelDead = key === 'fuel' && mod.hp <= 0;
  if (!gunBad && !fuelDead) return;
  var a = t._abandon;
  if (a) {
    if (a.kind === 'fuel' && gunBad) { a.kind = 'gun'; a.stage = 0; a.due = gameT + ABANDON_CD; }   // 升级:断油观察中炮件又坏 → 立即转 3s 倒数
    return;                                                    // 已在观察(幂等,不重复入表)
  }
  t._abandon = { kind: gunBad ? 'gun' : 'fuel', stage: 0, due: gameT + (gunBad ? ABANDON_CD : FUEL_ARM_T) };
  abandonWatch.push(t);
}
function abandonNoteFire(t) {                                  // 射击事件:断油观察窗滑动重置(规则②)
  var a = t._abandon;
  if (a && a.kind === 'fuel') { a.due = gameT + FUEL_ARM_T; a.stage = 0; }   // 倒数期射击同样退回观察窗
}
function abandonCancel(t) {                                    // 玩家接管:取消观察(防倒数误杀新座车)
  var ix = abandonWatch.indexOf(t);
  if (ix >= 0) abandonWatch.splice(ix, 1);
  t._abandon = null;
}
function abandonTick() {                                       // 1Hz:仅遍历观察表(空表=一次长度判断)
  if (!abandonWatch.length) return;
  for (var i = abandonWatch.length - 1; i >= 0; i--) {
    var t = abandonWatch[i];
    if (!t.alive || t.isPlayer) { abandonWatch.splice(i, 1); t._abandon = null; continue; }   // 阵亡/被接管:顺路清表
    var a = t._abandon;
    if (gameT < a.due) continue;
    if (a.kind === 'fuel' && !a.stage) { a.stage = 1; a.due = gameT + ABANDON_CD; continue; }  // 观察窗耗尽 → 3s 倒数
    abandonWatch.splice(i, 1);
    t._abandon = null;
    killTank(t, 'ABANDONED');
  }
}

/* 结构值扣减系数:仅履带/炮管受损(车体/炮塔/内部模块无损)不降低结构——
   gun/trackL/trackR=0(外部行走/火炮件与车体结构解耦,只伤自身模块 hp);
   穿透链不受影响:弹穿履带后续命中侧甲/内部模块仍按各自系数入账。 */
var structFrac = { hull: 1, turret: 0.35, gun: 0, engine: 0.4, fuel: 0.25, ammo: 0.1, trackL: 0, trackR: 0, tailRotor: 0.15 };
/* 模块伤害统一入口。depth 语义: <2 时 hull 命中追加 35% 破片判定(depth+1 防递归);
   所有直击调用方(坦克 AP/直升机导弹/火箭)统一传 0, 仅破片递归内层传 1 */
function applyModuleDamage(t, key, dmg, attacker, point, depth) {
  if (!t.alive) return;
  // 个人死斗玩家出生保护：三秒内完全忽略弹药、爆炸、碰撞和坠落等模块伤害。
  if (t === player && isFfaMode() && t._ffaSpawnInvulUntil > gameT) return;
  var mod = t.mods[key];
  t.lastHitBy = attacker;
  if (dmg > 0) {
    t.lastDamageT = gameT;   // 真实受伤时间：战场维修和 AI 受击记忆各自消费
    if (t._vehicleTechRepair) {
      t._vehicleTechRepair.stationaryT = 0;
      t._vehicleTechRepair.active = false;
      t._vehicleTechRepair.target = null;
    }
    if (t === player && typeof vehicleTechBattlefieldRepairHudTick === 'function') vehicleTechBattlefieldRepairHudTick();
  }
  // 受击记忆(仅敌方伤害触发,火灾自伤不算)——AI 自保判断用
  if (attacker && attacker !== t && areHostile(attacker, t)) { t.lastHitT = gameT; noteAttacked(t, attacker); }

  var preStruct = t.struct;                                             // 记录跨零前剩余结构(阵亡记账用)
  t.struct -= dmg * (structFrac[key] !== undefined ? structFrac[key] : 0.3);
  if (preStruct > 0 && t.struct <= 0) t._dynRem = preStruct;
  if (attacker === player) damageDealt += dmg;if (typeof vehWeatherHit === 'function') vehWeatherHit(t, key, dmg, point);   // 载具风化⑧: 战损累积(事件驱动, 零每帧成本)
  if (typeof dynNoteDmg === 'function') dynNoteDmg(attacker, t, dmg);   // 动态距离策略记录(打出/承受伤害按距离箱)

  if (!mod.structural) {
    var wasAlive = mod.hp > 0;
    mod.hp = Math.max(0, mod.hp - dmg);
    effSync(t);                               // 效率族事件缓存重算(受击=模块 hp 唯二变化点之一)
    abandonArm(t, key);                       // 弃车观察(事件驱动:炮件<20/断油瞬间入表;平时零开销,见 abandonWatch)

    if (mod.hp <= 0 && wasAlive) onModuleDestroyed(t, key, attacker);
  }

  if (key === 'engine' && Math.random() < 0.35) startFire(t, attacker);
  if (key === 'fuel'   && Math.random() < 0.50) startFire(t, attacker);
  if (key === 'ammo') {
    if (mod.hp <= 0) { detonate(t, attacker); return; }   // 弹药架耐久归零 → 直接殉爆(不再概率)
    var p = 0.2 + (1 - mod.hp / mod.max) * 0.5;           // 未归零:保留既有风险概率(玩家同概率,无殉爆减免)
    if (Math.random() < p) { detonate(t, attacker); return; }
  }
  if (key === 'hull' && depth < 2 && Math.random() < 0.35) {
    var inner = ['engine', 'ammo', 'fuel'][Math.floor(Math.random() * 3)];
    applyModuleDamage(t, inner, dmg * rand(0.25, 0.45), attacker, point, depth + 1);
  }

  if (t === player) {
    if (typeof playerHudDamage === 'function') {
      playerHudDamage(key);                                             // 迷你 HUD 高亮(事件驱动,O(1))
      if (key !== 'hull') playerHudDamage('hull');                      // 模块伤按 structFrac 扣整车结构→hull 红度联动刷新(履带/炮管系数 0=零扣减,1% 量化门拦冗余写)
    }
    dmgFlash();
    camShake = Math.max(camShake, 0.45);

    // 直升机座机部位受损年轻女性语音告警 (19: 触发只播1次,不同部位及导弹告警互不冲突可重叠)
    if (isHeliVehicle(player) && dmg > 0) {
      if (key === 'trackL' || key === 'trackR') {
        if (typeof sfxHeliDamageVoice === 'function') sfxHeliDamageVoice('rotor_main'); // 主旋翼异常
      } else if (key === 'tailRotor') {
        if (typeof sfxHeliDamageVoice === 'function') sfxHeliDamageVoice('rotor_tail'); // 尾旋翼异常
      } else if (key === 'engine') {
        if (typeof sfxHeliDamageVoice === 'function') sfxHeliDamageVoice('engine');     // 发动机异常
      } else if (key === 'ammo' || key === 'turret' || key === 'gun') {
        if (typeof sfxHeliDamageVoice === 'function') sfxHeliDamageVoice('weapon');     // 武器系统异常
      } else if (key === 'fuel') {
        if (typeof sfxHeliDamageVoice === 'function') sfxHeliDamageVoice('fuel');       // 燃油系统异常(仅直升机)
      }
    }
  }
  /* 击杀播报仅载具死亡行;命中反馈走屏心命中链/迷你 HUD,不入文字播报 */
  if (t.struct <= 0 && t.alive) killTank(t, 'STRUCT KILL');
}

function onModuleDestroyed(t, key, attacker) {
  var mod = t.mods[key];
  /* 触发器:玩家座车炮塔损毁 → 置车体瞄准旗标(鼠标左右驱动车体转向,见 player.js 驾驶段)。
     事件置位后不再做任何状态检测;炮塔归零不可逆(模块均不可修复),无需恢复清旗;
     重新部署=全新载具对象,旗标天然不存在(取消逻辑零代码零成本)。 */
  if (t === player && key === 'turret') player._hullAim = true;
  /* 直升机弹药架损毁 → 事件清空导弹锁定链(锁定能量/锁定量/目标指针),
     下帧起 wantWeapon 分流自然离开导弹模式 —— 修掉"弹药架没了仍全链解算"的空转 */
  if ((isHeliVehicle(t) || (typeof isAAVehicle === 'function' && isAAVehicle(t))) && key === 'ammo') {   // 防空载具发射架=弹药架模块,同规
    t._aiLockEnergy = 0; t._aiIsLocked = false;
    t._heliMissileTarget = null; t._aiLockedTarget2 = null;
  }
  var wp = modWorldPos(t, key);
  /* 不在此处出火花:modWorldPos 在车体内部(且溅射/火灾摧毁也走本钩子,与炮弹无关);
     命中火花统一由 resolveHit 在本弹首个外表面交点发出。 */
  sfxCrack(volAt(wp, 0.8));
}
function startFire(t, attacker) {
  if (!t.alive || t.fire) return;
  // 灭火器无限次使用: 载具每次起火自动触发单次灭火程序,在1~4秒内完成灭火
  t.fire = { dotT: 0, extinguishAt: gameT + rand(1, 4) };
  if (attacker === player && t !== player) hitMarkerAppend('IGNITED!', 'pen');   // 起火反馈只走屏心命中链(击杀播报仅载具死亡行)
}

/* ===== 残骸不可摧毁——残骸=永久物理实体:保留碰撞(可被推动)/挡弹/挡视线/掩体资格 ===== */
/* ===== 残骸网格合并(帧数暴跌治理·零视觉变化)——
   击毁后全部 visual 网格(已统一换 wreckMat)烘焙合并为 1 个网格:draw call ~6→1,
   消耗战后期同屏百辆残骸的 draw call 累积削 ~85%;几何逐顶点烘焙(子级矩阵→车组本地系),
   外观逐像素不变;命中壳(modMeshes,隐藏)不受影响(挡弹/溅射判定照旧);旧网格几何即场销毁回收显存。 ===== */
/* 复用 scratch(热路径,避免每帧 GC;模块私有) */
var _wmM4 = new THREE.Matrix4(), _wmGInv = new THREE.Matrix4();
/* 通用顶点烘焙统一走 core.mergeGeometries(残骸个体/区合批/阴影模板三处共用内核,见 core.js) */
function mergeWreckMeshes(t) {
  if (t._wreckMerged || !t.group) return;
  t._wreckMerged = true;
  if (typeof vehInkRemove === 'function') vehInkRemove(t);           // P1: 残骸合并前摘折边(共享几何不销毁)
  var list = [];
  t.group.traverse(function (m) { if (m.isMesh && m.userData && m.userData.visual) list.push(m); });
  if (list.length < 2) return;
  var i, jobs = [];
  t.group.updateMatrixWorld(true);
  _wmGInv.copy(t.group.matrixWorld).invert();
  for (i = 0; i < list.length; i++) {
    /* 残骸低模换表(减面 L1+L2):高模共享模板几何 → 残骸低模;映射为 null(发光镜片等)则不进残骸合并。
       未命中映射(非模板几何)按原样——行为兜底等于现状。 */
    var wg = (typeof WRECK_GEO_LOD !== 'undefined') ? WRECK_GEO_LOD.get(list[i].geometry) : undefined;
    if (wg === null) continue;
    _wmM4.copy(_wmGInv).multiply(list[i].matrixWorld);   // 子网格世界矩阵 → 车组本地系烘焙矩阵(合并后随车组整体运动)
    jobs.push({ geo: wg || list[i].geometry, m4: _wmM4.clone() });
  }
  var geo = mergeGeometries(jobs, true, false, false);
  var merged = new THREE.Mesh(geo, wreckMat);
  merged.userData.visual = true; merged.userData.wreck = true;   // wreck 标记(DC 归因审计桶)
  merged.castShadow = false;                         // 残骸合并网格不投影(同上)
  merged.receiveShadow = true;
  t.group.add(merged);
  t._wreckMesh = merged;                                 // 合并网格挂引用(接管/实例流切换用)
  for (i = 0; i < list.length; i++) {               // 旧网格退场:摘节点+销毁几何(材质 wreckMat 共享不销毁)
    var om = list[i];
    if (om.parent) om.parent.remove(om);
    if (om.geometry && om.geometry.dispose && !(om.geometry.userData && om.geometry.userData._shared)) om.geometry.dispose();   // 实例化共享模板几何禁销毁(毁掉会连带毁掉全场同型号车的实例流)
  }
  t.gDirty = true;
}
/* ===== 残骸区域合批(治帧数暴跌;残骸任何距离全细节)——
   残骸永久累积使 draw call 与场景节点线性增长(实测 397 残骸=397dc)。现:
   ① 合批:40m 格分区,每区全细节残骸烘焙为 1 个网格(1dc/区);新亡残骸先走既有
      个体合并网格(视觉零空窗),区"成熟"后并入。任何距离都是全细节外形,无 LOD 降级。
   ② 重建全异步(三期根治帧率抖动):碰撞段绝不同步烘焙——被推残骸转个体独行并打标,
      区网格标脏;wckFlush 按帧耗时自适应给预算(重帧停建/常帧 1 区/轻帧 2 区),
      force 区优先;被推 <1s 的残骸不入烘焙(防推挤鬼影),静止后由下次重建收回;
      烘焙集无变化则跳过重建(零开销过帧)。
   命中壳、碰撞和掩体判定不经过本系统;材质仍共享 wreckMat。 ===== */
var WCK_CELL = 40, WCK_BUDGET = 2;
/* 3B 死亡烘焙延迟队列:killTank 当帧只入队,
   mergeWreckMeshes 推迟到 wckFlush 帧预算内(≤2 具/帧)——连环殉爆的同步烘焙单帧尖峰减半。
   不换形不换源(死亡当帧仍显示换好 wreckMat 的原 part 网格,数帧空窗后合并,与 cz 改造前状态相同);
   wckFlush 在 step 之后调用,矩阵必然定稿,零 D 类(矩阵/烘焙)风险。 */
var WCK_BAKEQ_ON = true, _wckBakeQ = [];
var wckChunks = new Map(), _wckDirty = [];
function _wckKey(x, z) { return Math.floor(x / WCK_CELL) * 4096 + Math.floor(z / WCK_CELL); }
function _wckChunkOf(x, z) {
  var k = _wckKey(x, z), ch = wckChunks.get(k);
  if (!ch) {
    ch = { key: k, items: [], full: null, dirty: false, force: false,
           cx: (Math.floor(x / WCK_CELL) + 0.5) * WCK_CELL, cz: (Math.floor(z / WCK_CELL) + 0.5) * WCK_CELL };
    wckChunks.set(k, ch);
  }
  return ch;
}
function _wckMarkDirty(ch) {
  if (!ch.dirty) { ch.dirty = true; _wckDirty.push(ch); }
}
/* 把若干"本地几何×车组世界矩阵"拼接为单一世界系几何(position/normal/uv)——复用 core.mergeGeometries */
function _wckBake(jobs) {
  return mergeGeometries(jobs, false, false, false);
}
/* 重建区网格。被推 <1s 的残骸保持个体独行不入烘焙(防推挤鬼影);
   烘焙集与现状一致则整体跳过(零开销过帧)。 */
function _wckRebuild(ch) {
  ch.dirty = false; ch.force = false;
  var i;
  var jobsF = [], changed = !!ch.stale;              // stale=成员表变动(跨格迁册):旧烘焙必重绘剔除,否则残留旧位幽灵
  ch.stale = false;
  for (i = 0; i < ch.items.length; i++) {
    var rec = ch.items[i];
    var eligible = gameT - (rec.soloT || -99) >= 1.0;    // 静止满 1s 才入烘焙
    if (eligible !== rec.inBake) changed = true;
    if (!eligible) continue;
    if (rec.mesh && rec.mesh.geometry) jobsF.push({ geo: rec.mesh.geometry, m4: rec.t.group.matrixWorld });
  }
  if (!changed) return;                                  // 烘焙集未变:不重建
  if (ch.full) { scene.remove(ch.full); if (ch.full.geometry) ch.full.geometry.dispose(); ch.full = null; }
  for (i = 0; i < ch.items.length; i++) {
    var rc = ch.items[i];
    var eli = gameT - (rc.soloT || -99) >= 1.0;
    rc.inBake = eli;
    if (rc.mesh) rc.mesh.visible = !eli;                 // 入烘焙=隐藏个体;独行=显示个体
    rc.t.group.visible = !eli;                           // 车组其余子件=隐藏命中壳:整组剔除,渲染遍历跳过 ~25 节点/残骸
    if (eli) rc.t.group.updateMatrixWorld(true);
  }
  var gf = _wckBake(jobsF);
  if (gf) {
    ch.full = new THREE.Mesh(gf, wreckMat);
    ch.full.userData.wreck = true;                       // DC 归因审计桶:残骸合并
    ch.full.castShadow = false; ch.full.receiveShadow = true;
    scene.add(ch.full);
  }
}
/* 击毁入册(mergeWreckMeshes 之后调用):个体合并网格先顶着渲染,区成熟后再并入 */
function wckAdd(t) {
  if (t._wckRec || !t._wreckMesh) return;                           // 未合并(件数<2)的残骸保持原样
  var p = t.group.position;
  var rec = { t: t, mesh: t._wreckMesh,
              chunkKey: _wckKey(p.x, p.z), bornT: gameT, soloT: -99, inBake: false };
  t._wckRec = rec;
  var ch = _wckChunkOf(p.x, p.z);
  ch.items.push(rec);
  _wckMarkDirty(ch);
}
/* 残骸被推动(或跨格):全异步——被推残骸转个体独行(位置永远正确),所在区标脏待重建;
   绝不在碰撞段同步烘焙(二期帧率抖动根因:推动高峰每帧数次整区烘焙)。 */
function wckNoteMoved(t) {
  var rec = t._wckRec;
  if (!rec) return;
  if (typeof comicAntennaWreckDirty === 'function') comicAntennaWreckDirty();   // 被推动的残骸:天线稳定线随姿态重建
  rec.soloT = gameT;                                   // 独行窗口:1s 内不入烘焙,静止后收回
  if (rec.mesh) rec.mesh.visible = true;
  rec.t.group.visible = true;
  var p = t.group.position, nk = _wckKey(p.x, p.z);
  if (nk !== rec.chunkKey) {                           // 跨格:迁册
    var old = wckChunks.get(rec.chunkKey);
    if (old) {
      var oi = old.items.indexOf(rec);
      if (oi >= 0) old.items.splice(oi, 1);
      old.stale = true;                                // 成员表变动:旧烘焙须重绘剔除本残骸(防旧位幽灵)
      old.force = true;
      _wckMarkDirty(old);
    }
    rec.chunkKey = nk;
    var nch = _wckChunkOf(p.x, p.z);
    nch.items.push(rec);
    nch.force = true;
    _wckMarkDirty(nch);
  } else {
    var ch = wckChunks.get(nk);
    if (ch) { ch.force = true; _wckMarkDirty(ch); }
  }
  // 注:rec.inBake 不在此处改动——统一由 _wckRebuild 按独行窗口(eligible)结算;
  // 提前清 false 会使"eligible≠inBake"变化检测失明,旧烘焙残留为无碰撞幽灵(已修 BUG)
}
/* 每帧排空脏区——自适应预算(三期):
   重帧(JS EMA>26ms)停建攒批,常帧 1 区,轻帧(<16ms)2 区;force 区优先。
   成熟度门:个体网格=逐位同款几何顶渲染(零视觉差),区内待并≥3 或最老待并>4s 才动手。
   _wckRebuild 内部再判烘焙集无变化则零开销跳过。
   0.5s 回收扫描:被推残骸静止后不再有事件标脏,独行窗口(1s)过期须由扫描重新标脏回烘。 */
var _wckSweepT = -99;
function wckFlush() {
  wreckSweep();                        // ★P2-⑨(移动端恢复):残骸生命周期回收(内部 1Hz 自节流;桌面直接返回)
  if (gameT - _wckSweepT >= 0.5) {
    _wckSweepT = gameT;
    wckChunks.forEach(function (ch) {
      if (ch.dirty) return;
      for (var si = 0; si < ch.items.length; si++) {
        var rc0 = ch.items[si];
        if (!rc0.inBake && gameT - (rc0.soloT || -99) >= 1.0) { ch.force = true; _wckMarkDirty(ch); break; }
      }
    });
  }
  var heavy = typeof _frameMsEMA === 'number' && _frameMsEMA > 26;
  var budget = heavy ? 0 : ((typeof _frameMsEMA === 'number' && _frameMsEMA < 16) ? WCK_BUDGET : 1);
  var fb = 1;                                          // force 区恒许 1 次/帧:被推残骸防鬼影(40m 小区烘焙成本可控)
  var n = 0, pass, i, w, ch;
  /* 3B 延迟队列消费(两趟重建之前;与重建共享预算计数 n——烘焙吃满则本帧重建相应让路):
     每帧 ≤2 具 mergeWreckMeshes;烘焙完成即 wckAdd 入册(空窗数帧)。
     mergeWreckMeshes 不可合并件(件数<2)同样置 _wreckMerged → 下帧出队,不滞留。 */
  if (_wckBakeQ.length) {
    var qn = 0, qi;
    for (qi = 0; qi < _wckBakeQ.length; qi++) {
      var qt = _wckBakeQ[qi];
      if (!qt._occMesh && !qt._occBaked && qt._staticHitRegistered) {   // 代理烘焙随队列消费(killTank 卸载来的;失败置 _occBaked=永久 8 壳兜底)
        qt._occBaked = true;
        if (bakeOccProxy(qt)) occProxySwap(qt);
      }
      if (qt._wreckMerged) { if (!qt._wckRec) wckAdd(qt); }   // 已合并(历史队目/开关切换遗留):入册即出队,册内则丢弃
      else if (n < 2) { mergeWreckMeshes(qt); wckAdd(qt); n++; }
      else _wckBakeQ[qn++] = qt;                      // 预算尽:留队
    }
    _wckBakeQ.length = qn;
  }
  for (pass = 0; pass < 2; pass++) {                   // pass0=force 区,pass1=成熟度区
    w = 0;
    var cap = pass === 0 ? fb : budget;
    for (i = 0; i < _wckDirty.length; i++) {
      ch = _wckDirty[i];
      if (!ch || !ch.dirty) continue;                  // 已被重建/失效:出队
      if ((pass === 0) !== !!ch.force) { _wckDirty[w++] = ch; continue; }   // 非本趟类别:留队
      var ready = ch.force;
      if (!ready) {
        var soloN = 0, oldest = gameT;
        for (var j = 0; j < ch.items.length; j++) {
          var rc = ch.items[j];
          if (!rc.inBake && rc.mesh && rc.mesh.visible) { soloN++; if (rc.bornT < oldest) oldest = rc.bornT; }
        }
        ready = soloN >= 3 || gameT - oldest > 4;
      }
      if (ready && n < cap) { _wckRebuild(ch); n++; continue; }   // 重建完成:出队
      _wckDirty[w++] = ch;                             // 未成熟/预算尽:留队
    }
    _wckDirty.length = w;
  }
}
/* 调试清场(clearAI)配套:区网格几何全销毁,个体残骸随车组已被移除 */
function wckClear() {
  wckChunks.forEach(function (ch) {
    if (ch.full) { scene.remove(ch.full); if (ch.full.geometry) ch.full.geometry.dispose(); }
    for (var i = 0; i < ch.items.length; i++) {
      if (ch.items[i].t) ch.items[i].t._wckRec = null;
    }
  });
  wckChunks.clear(); _wckDirty.length = 0;
  _wckBakeQ.length = 0;             // 延迟队列随清场同清(防消费端把已移除车辆烘焙成幽灵残骸)
}

/* P2-WRECK-START ★P2-⑨ 残骸生命周期(性能优化报告:“TTL 或总量硬顶,超限回收最远/最旧”,
   与 fxSmokeR 距离裁剪同一哲学)——残骸原为永久实体,消耗战后期数百具持续累积
   (节点数/碰撞对/LOS 候选/烟柱随场次单调上涨=“越打越卡”的结构性成分)。
   策略:总量硬顶 + 寿命双闸,从最旧开始回收;玩家 400m 豁免圈内的残骸不回收
   (视野内凭空消失=穿帮),圈外无声移除(雾/远处,玩家不可感知);
   被推中/下落中的残骸跳过(物理一致性)。每 1s 一拍、每拍 ≤2 具,成本摊平无尖峰。 */
/* ★移动端适配恢复:仅触屏设备启用(桌面 WRECK_CAP/TTL=∞,逐位保持新版行为) */
var WRECK_MOBILE = (typeof GFX_TOUCH !== 'undefined' && !!GFX_TOUCH);
var WRECK_CAP = WRECK_MOBILE ? 48 : Infinity;   // 在场残骸硬顶(超出即从最旧开始回收)
var WRECK_TTL = WRECK_MOBILE ? 240 : Infinity;                   // 残骸寿命(秒):超龄且位于豁免圈外即回收
var WRECK_SAFE_R2 = 400 * 400;         // 玩家豁免半径²(圈内残骸不回收,防视野内消失穿帮)
var _wreckSweepT = -99;
function retireWreck(t) {              // 残骸全量退场:九大登记面逐一摘除,幂等
  if (!t || t._wreckRetired || t.alive || t._heliFalling) return false;
  t._wreckRetired = true;
  var i, k, arr;
  /* ① 残骸总表(追加序=死亡序;AI 密度/烟柱/配对扫描共读) */
  var wi = wreckList.indexOf(t); if (wi >= 0) wreckList.splice(wi, 1);
  /* ② 碰撞网格(wreckGrid 20m:avoidSteer/车-残骸碰撞/叠堆配对/地形重锚共用) */
  if (t._wreckGridRegistered && t._wgKey != null) {
    arr = wreckGrid.get(t._wgKey);
    if (arr) { k = arr.indexOf(t); if (k >= 0) arr.splice(k, 1); if (!arr.length) wreckGrid.delete(t._wgKey); }
    t._wreckGridRegistered = false; t._wgKey = null;
  }
  /* ③ 静态遮挡(LOS/挡弹/掩体):代理与 8 壳都尝试剔除——hitGridStaticRemoveTankMesh 幂等,
     按 _sHg* 记账格精确出表并 bump hitGridStaticVersion(AI LOS 缓存即时失效) */
  if (t._occMesh) hitGridStaticRemoveTankMesh(t, t._occMesh);
  if (t.modMeshes) for (i = 0; i < t.modMeshes.length; i++) hitGridStaticRemoveTankMesh(t, t.modMeshes[i]);
  /* ④ 残骸区合批:摘册+旧区标脏重绘(烘焙集少一本,防旧位幽灵) */
  if (t._wckRec) {
    var rec = t._wckRec, ch = wckChunks.get(rec.chunkKey);
    if (ch) {
      var ci = ch.items.indexOf(rec); if (ci >= 0) ch.items.splice(ci, 1);
      ch.stale = true; ch.force = true; _wckMarkDirty(ch);
    }
    t._wckRec = null;
  }
  /* ⑤ 瞬态队列:烘焙延迟队/障碍复查队 */
  k = _wckBakeQ.indexOf(t); if (k >= 0) _wckBakeQ.splice(k, 1);
  t._wMove = false;
  for (i = _wreckMoveQueue.length - 1; i >= 0; i--) if (_wreckMoveQueue[i] === t) _wreckMoveQueue.splice(i, 1);
  /* ⑥ 长驻烟柱(与注册同表逆向) */
  if (typeof wreckSmokeUnregister === 'function') wreckSmokeUnregister(t);
  /* ⑦ 命中候选表(与预览车逆向摘除同口径):防离场景网格滞留 targetsList */
  if (t.modMeshes) for (i = 0; i < t.modMeshes.length; i++) {
    var ti = targetsList.indexOf(t.modMeshes[i]); if (ti >= 0) targetsList.splice(ti, 1);
  }
  /* ⑧ 场景退场+显存回收(仅销毁独占几何:合并网格/遮挡代理;模板共享几何禁动,同 mergeWreckMeshes 口径) */
  if (t._wreckMesh && t._wreckMesh.geometry && t._wreckMesh.geometry.dispose) t._wreckMesh.geometry.dispose();
  if (t._occMesh) { if (t._occMesh.geometry && t._occMesh.geometry.dispose) t._occMesh.geometry.dispose(); t._occMesh = null; }
  if (t.group) scene.remove(t.group);
  t._battleCleared = true;             // 与 flow.rmGroup 同旗:后续清场幂等跳过
  t.gDirty = false;
  /* ⑨ 世界缓存失效:残骸簇 + 漫画天线稳定线(事件驱动重建) */
  if (typeof wclBump === 'function') wclBump();
  if (typeof comicAntennaWreckDirty === 'function') comicAntennaWreckDirty();
  return true;
}
function wreckSweep() {                // 1Hz:超顶/超龄回收(最旧优先,豁免圈/被推/下落跳过)
  if (!WRECK_MOBILE) return;
  if (gameT - _wreckSweepT < 1.0) return;
  _wreckSweepT = gameT;
  var n = wreckList.length;
  if (!n) return;
  var overCap = n - WRECK_CAP, ttlBreach = false, oi, w0;
  for (oi = 0; oi < n; oi++) {         // 表头=最旧;找到首个超龄即存在寿命违约
    w0 = wreckList[oi];
    if (w0 && gameT - (w0._wreckBornT || 0) > WRECK_TTL) { ttlBreach = true; break; }
  }
  if (overCap <= 0 && !ttlBreach) return;
  var px = (player && player.group) ? player.group.position.x : 0;
  var pz = (player && player.group) ? player.group.position.z : 0;
  var budget = overCap > 8 ? 2 : 1;    // 大幅超顶(连环殉爆)每拍收 2 具追赶
  var retired = 0;
  for (oi = 0; oi < wreckList.length && retired < budget; oi++) {
    var w = wreckList[oi];
    if (!w || w._wreckRetired) continue;
    var age = gameT - (w._wreckBornT || 0);
    if (overCap <= 0 && age <= WRECK_TTL) break;        // 追加序:表头未违约 → 后面更新,整拍无事
    if (w._heliFalling || w._wMove) continue;           // 下落中/正被推:物理一致优先
    if (gameT - (w._wMovedT || -99) < 5) continue;      // 5s 内被推醒过:可能仍在玩家互动域
    var dxw = w.group.position.x - px, dzw = w.group.position.z - pz;
    if (dxw * dxw + dzw * dzw < WRECK_SAFE_R2) continue;   // 豁免圈:宁超顶不穿帮(下拍再议)
    if (retireWreck(w)) retired++;
  }
}
/* P2-WRECK-END */

/* ===== 静态遮挡代理:每残骸烘焙 1 个世界系合并代理,
   替代 8 个命中壳注册进 hitGridStatic——LOS/掩体/弹道/测距宽相位候选 ÷8。
   只产 raycast 数据:不入场景、不渲染、不碰任何视觉几何(规避 D1/D2);
   矩阵一律 clone 快照(D3 禁活引用),烘焙前 updateMatrixWorld 定稿。
   消费端语义与 8 壳严格等价:并集命中=任一壳命中(遮挡布尔同值);
   代理 userData.tank 已设(非活)→ worldRaycast 静态早退/stepShells 拦截/laserRange 照常工作。 ===== */
var OCC_PROXY_ON = true;
function bakeOccProxy(t) {
  if (!OCC_PROXY_ON) return null;
  t.group.updateMatrixWorld(true);                       // 姿态已冻结(killTank 定姿后),一次定格再取快照
  var jobs = [], i;
  for (i = 0; i < t.modMeshes.length; i++) {
    var m = t.modMeshes[i];
    if (!m || !m.geometry || !m.geometry.attributes.position) continue;
    jobs.push({ geo: m.geometry, m4: m.matrixWorld.clone() });   // 世界系烘焙(矩阵 clone 快照,D3:禁传活 matrixWorld 引用)
  }
  var geo = mergeGeometries(jobs, false, false, false);      // 复用通用烘焙器(core.js)
  if (!geo) return null;                                 // 烘焙失败:消费端自动回退 8 壳注册
  var mesh = new THREE.Mesh(geo, shadowProxyMat);        // 材质仅占位(不入场景,不渲染)
  mesh.matrixAutoUpdate = false;                         // 单位矩阵,几何已是世界系
  mesh.userData.tank = t;                                // 消费端 ud.tank 语义与命中壳一致
  t._occMesh = mesh;
  return mesh;
}
/* 被推残骸:世界系代理几何随位置漂移而失效 → 剔除代理+原 8 壳按新位重注册
   (被推残骸是少数,永久回退粗注册零风险——方案 1B 生命周期配套的最简做法) */
function occProxyDrop(w) {
  if (!w._occMesh) return;
  hitGridStaticRemoveTankMesh(w, w._occMesh);            // 按注册时记录的覆盖格精确剔除
  w._occMesh.geometry.dispose();
  w._occMesh = null;
  w._staticHitRegistered = false;                        // 允许 hitGridStaticInsert 重注册(新位置 8 壳)
  hitGridStaticInsert(w);
}
function occProxySwap(w) {          // 代理上线换装:8 壳精确剔除 → 1 代理注册(wckFlush 消费段调用,非击毁帧)
  if (!w._occMesh || !w._staticHitRegistered) return;
  for (var j = 0; j < w.modMeshes.length; j++)
    hitGridStaticRemoveTankMesh(w, w.modMeshes[j]);      // 击毁时兜底注册的 8 壳按记账格精确剔除(被推过的残骸同此 heals 旧位)
  w._staticHitRegistered = false;
  hitGridStaticInsert(w);           // 此时 _occMesh 已就位 → 走 1 代理路径(现位重记 _sHg*/圆预筛)
}

function detonate(t, attacker) {
  if (!t.alive) return;
  t.lastHitBy = attacker;
  var p = t.group.position.clone(); p.y += 1.8;
  explosion(p, 2.1, { darkN: 26, dustN: 12 });   // 弹药殉爆:最大烟火(文字播报归死亡行"型号+殉爆")
  killTank(t, 'AMMO DETONATION');
}

var teamCounts = { red: 0, blue: 0 };   // 全部在场活车计数(包含战略支援,用于顶部 ACTIVE/战败判定)
var teamRegularCounts = { red: 0, blue: 0 }; // 不含战略支援的在场计数(最大在场编制门槛)
function countTeam(team) {
  return teamCounts[team] || 0;
}
function countTeamWithinCap(team) {
  return teamRegularCounts[team] || 0;
}

/* 死法四类(击杀播报口径):殉爆/燃爆/结构毁坏/弃车——killTank cause 字串归并 */
function deathWord(cause) {
  if (!cause) return ' 结构击毁';
  if (cause.indexOf('DETONATION') >= 0) return ' 弹药殉爆';
  if (cause.indexOf('AIRSTRIKE') >= 0) return ' 遭空袭摧毁';
  if (cause.indexOf('FIRE') >= 0 || cause.indexOf('BURN') >= 0 || cause.indexOf('CRASH') >= 0) return ' 起火焚毁';
  if (cause.indexOf('ABANDON') >= 0 || cause.indexOf('BAIL') >= 0) return ' 已弃车';
  return ' 结构击毁';
}

/* ===== 空中直升机残骸下落系统(低频/事件驱动,触地自动变回普通地面残骸) ----
   仅在存在空中坠落直升机时推进下落轨迹,平时空队列单布尔早退零开销。
   触地时触发固定燃爆特效,并完成地形贴合并入普通载具残骸系统。 ===== */
var heliFallingWrecks = [];
function stepHeliFallingWrecks(dt) {
  if (!heliFallingWrecks.length) return;
  for (var i = heliFallingWrecks.length - 1; i >= 0; i--) {
    var t = heliFallingWrecks[i];
    if (!t || !t.group) { heliFallingWrecks.splice(i, 1); continue; }
    var prm = HELI_PARAMS[t.kind] || HELI_PARAMS.wz10;
    var p = t.group.position;

    // 重力下坠与空气阻力积分
    t._heliFallVy = (t._heliFallVy || 0) - 14.0 * dt;
    t._heliFallVx = (t._heliFallVx || 0) * Math.max(0, 1 - dt * 0.5);
    t._heliFallVz = (t._heliFallVz || 0) * Math.max(0, 1 - dt * 0.5);

    p.x += t._heliFallVx * dt;
    p.z += t._heliFallVz * dt;
    p.y += t._heliFallVy * dt;

    // 空中翻滚与失控姿态
    t.group.rotation.order = 'YXZ';
    t.group.rotation.x += (t._fallRotX || 0.6) * dt;
    t.group.rotation.z += (t._fallRotZ || -0.8) * dt;
    t.group.rotation.y += (t._fallRotY || 1.0) * dt;
    t._heliRotorRPM = Math.max(0, (t._heliRotorRPM || 0) - dt * 35.0);
    t._heliRotorAngle = ((t._heliRotorAngle || 0) + t._heliRotorRPM * dt) % TAU;
    if (t.mainRotorGroup) t.mainRotorGroup.rotation.y = t._heliRotorAngle;

    // 强制每帧刷新下落残骸的世界矩阵
    t.group.updateMatrixWorld(true);
    t.gDirty = true;

    var groundY = terrainH(p.x, p.z) - prm.groundOffset;
    if (p.y <= groundY) {
      // 触地坠机
      p.y = groundY;
      t._heliFalling = false;
      heliFallingWrecks.splice(i, 1);

      // 1. 坠机效果固定为燃爆
      var pG = _v1.set(p.x, p.y + 0.8, p.z);
      explosion(pG, 1.75, { darkN: 24, dustN: 14 });
      if (typeof comicGroundDust === 'function') comicGroundDust(p.x, p.y + 0.8, p.z, true);
      wreckSparks(pG);
      if (typeof sfxArmorStop === 'function') sfxArmorStop(pG, 1.0);

      // 2. 成功落地后变回普通地面载具残骸
      t._heliAlt = 0;
      t._heliVy = 0;
      t._heliVx = 0;
      t._heliVz = 0;
      alignHeli(t, 0);
      t.gDirty = true;
      if (t.group && typeof t.group.updateMatrixWorld === 'function') t.group.updateMatrixWorld(true);

      if (typeof WCK_BAKEQ_ON !== 'undefined' && WCK_BAKEQ_ON && typeof _wckBakeQ !== 'undefined') _wckBakeQ.push(t);
      else {
        if (typeof mergeWreckMeshes === 'function') mergeWreckMeshes(t);
        if (typeof bakeOccProxy === 'function' && typeof occProxySwap === 'function' && bakeOccProxy(t)) occProxySwap(t);
      }
      if (typeof wckAdd === 'function') wckAdd(t);
      if (typeof hitGridStaticInsert === 'function') hitGridStaticInsert(t);
      if (typeof wreckGridInsert === 'function') wreckGridInsert(t);
      if (typeof wclBump === 'function') wclBump();
      if (typeof _wreckMoveQueue !== 'undefined') _wreckMoveQueue.push(t);
    } else {
      t.gDirty = true;
    }
  }
}
function killTank(t, cause) {
  if (!t.alive || t.unitState !== UNIT_ALIVE) return;
  if (t.lastHitBy && (t.lastHitBy.source === 'airstrike' || t.lastHitBy.source === 'strategic-airstrike') && cause === 'STRUCT KILL') cause = 'AIRSTRIKE KILL';
  if (typeof minimapNoteDeath === 'function') minimapNoteDeath(t);
  if (t._lws && t._lws.sup) { var _sup = t._lws.sup; if (_sup._lwsSupBy === t) { _sup._laserSuppressed = false; _sup._lwsSupBy = null; } t._lws.sup = null; }   // 压制者死亡=解除压制(所有权校验,防误解除他车叠加照射)
  t._laserSuppressed = false; t._lwsSupBy = null;
  if (t.lastHitBy === player && typeof sfxEventVoice === 'function') sfxEventVoice('target_destroyed');
  var isHeli = isHeliVehicle(t);
  // 击毁判定刚成立时先锁定玩家与目标的三维世界位置；后续残骸姿态/直升机坠落处理不得改变记录口径。
  var _killDist3D = 0;
  if (t.lastHitBy === player && t !== player && areHostile(player, t)) {
    try {
      var _ap0 = player && player.group && player.group.position;
      var _tp0 = t && t.group && t.group.position;
      if (_ap0 && _tp0) {
        var _dx0 = _ap0.x - _tp0.x, _dy0 = _ap0.y - _tp0.y, _dz0 = _ap0.z - _tp0.z;
        _killDist3D = Math.sqrt(_dx0 * _dx0 + _dy0 * _dy0 + _dz0 * _dz0);
      }
    } catch (eKillDist0) {}
  }
  if (isHeli) cause = 'FIRE KILL';
  else if (t._heliCrashCause) cause = t._heliCrashCause;
  t.unitState = UNIT_DYING;
  t.alive = false;
  var _ali = aliveList.indexOf(t);       // 活车紧凑表摘除(顺序与 tanks 一致,扫描端语义不变)
  if (_ali >= 0) aliveList.splice(_ali, 1);
  teamCounts[t.team]--;                  // 在场活车增量计数(触发器:阵亡即减)
  if (!t._strategicSupport) teamRegularCounts[t.team]--;
  hitGridDynamicRemove(t);               // 活车动态命中网格即时剔除(触发器:阵亡即出表,免 0.3s 陈旧幽灵)
  cmdLeave(t);                       // 死亡离组;空组注销
  if (typeof sqCmdNotifyDeath === 'function') sqCmdNotifyDeath(t);   // 指挥模式钩子:玩家阵亡/接管小队全灭→自动退出(事件驱动)
  wreckCount++;
  t._wreckBornT = gameT;               // ★P2-⑨:残骸诞生时刻(寿命闸;追加序表头=最旧)
  wreckList.push(t);if(typeof wreckSmokeRegister==='function')wreckSmokeRegister(t);   // B2:残骸长驻黑烟柱(事件级注册,上限999柱最旧优先熄灭)
  if (typeof wclBump === 'function') wclBump();   // 新残骸入世=簇缓存失效
  if (typeof comicAntennaWreckDirty === 'function') comicAntennaWreckDirty();   // 残骸天线稳定线重建(事件驱动)
  if (typeof dynNoteDeath === 'function') dynNoteDeath(t, t.lastHitBy,   // 阵亡=死前剩余结构伤害
      t._dynRem != null ? t._dynRem : Math.max(0, t.struct));
  t.recT = -1; t.recoilZ = 0;                                       // 阵亡:后坐液压失效,身管回位
  if (typeof _trkSlotRelease === 'function') _trkSlotRelease(t);     // 归还定长路径槽位(残骸走静态路径)
  if (t.gunMesh) t.gunMesh.position.z = 0;
  if (t.muzzle) t.muzzle.position.z = t.muzzZ0;
  t.speed = 0;
  t.gDirty = true;                 // 阵亡帧姿态/炮管下垂需要重算一次矩阵
  t._wMove = true;                 // 新残骸首轮障碍/栅栏复查入场券(此后静止即免查,被推再置位)

  // 消耗战:普通 AI 载具被毁 → 按兵种延时在同阵营大本营重新部署;玩家不走队列,
  // 改为自选翼位+兵种重新部署(玩家那次部署才消耗 1 点兵力,避免双计费)。
  // 战略支援载具是一次性增援,被摧毁后不重新部署;战略运输则只缩短普通 AI 队列。
  if (!isFfaMode() && !t.isPlayer && !t._strategicSupport) {
    var _respawnDelay = respawnDelayOf(t.kind, t.team);
    if (typeof strategicSupportTransportActive === 'function' && strategicSupportTransportActive(t.team)) _respawnDelay *= 0.5;
    respawnQueue.push({ team: t.team, kind: t.kind, due: gameT + _respawnDelay });
  }

  var p = _v1.set(t.group.position.x, t.group.position.y + (isHeli ? 0.8 : 1.4), t.group.position.z);
  /* FFA player kill: one random pickup beside the wreck, with the shared 30s/10s blink lifecycle. */
  if (isFfaMode() && t !== player && t.lastHitBy === player && areHostile(player, t) &&
      typeof powerupDropAtKill === 'function') powerupDropAtKill(t);
  wreckSparks(p);
  // 直升机坠机/被击毁效果固定为燃爆特效
  if (isHeli || cause === 'FIRE KILL') explosion(p, isHeli ? 1.6 : 1.5, { darkN: 20, dustN: 12 });
  t.group.traverse(function (m) {
    if (m.userData && m.userData.visual) {
      m.material = wreckMat;
      m.castShadow = false;
      m.visible = true; // 阵亡后个体网格立即可见,确保空中坠落残骸清晰可见!
    }
  });
  if (typeof _instSrcsShow === 'function') _instSrcsShow(t, true);
  t.gunPivot.rotation.x = 0.28;

  // 判定是否为空中悬空直升机残骸
  var isAirborneHeli = isHeli && ((t._heliAlt != null ? t._heliAlt : (t.group.position.y - terrainH(t.group.position.x, t.group.position.z))) > 0.35);

  if (isAirborneHeli) {
    // 空中直升机残骸:进入下落队列,下落过程中保持动态并自然翻滚,触地后固定燃爆并转为普通地面残骸
    t._heliFalling = true;
    t._heliFallVy = (t._heliVy != null && t._heliVy < 0) ? t._heliVy : -1.0;
    t._heliFallVx = (t._heliVx || 0) * 0.75;
    t._heliFallVz = (t._heliVz || 0) * 0.75;
    t._fallRotX = (Math.random() - 0.5) * 1.5;
    t._fallRotZ = (Math.random() - 0.5) * 1.8 + (Math.random() < 0.5 ? 0.8 : -0.8);
    t._fallRotY = (Math.random() - 0.5) * 2.2;
    heliFallingWrecks.push(t);
  } else {
    // 地面载具或已着陆直升机残骸:当帧完成烘焙入册与静态碰撞注册
    if (isHeli) alignHeli(t, 0);
    if (typeof _wreckMoveQueue !== 'undefined') _wreckMoveQueue.push(t);
    if (WCK_BAKEQ_ON) _wckBakeQ.push(t);
    else { mergeWreckMeshes(t);
           if (bakeOccProxy(t)) occProxySwap(t); }
    wckAdd(t);
    hitGridStaticInsert(t);
    wreckGridInsert(t);
  }

  var att = t.lastHitBy;
  // 玩家当前座车造成的敌方击毁才进入本局成就暂存；AI 击杀、友军击杀和接管不计入。
  if (att === player && t !== player && areHostile(player, t) &&
      window.Achievements && typeof window.Achievements.noteDestroyed === 'function') {
    // 使用 killTank 开始处锁定的三维距离；此时目标尚未进入残骸/坠毁姿态处理。
    window.Achievements.noteDestroyed(t, cause, att, _killDist3D);
  }
  if (DBG_ON) {
    if (dbgStats[t.team]) dbgStats[t.team].dead++;
    if (att && areHostile(att, t)) {
      var _attDbgKey = (att.source === 'airstrike' || att.source === 'strategic-airstrike') ? 'airstrike' : att.team;
      var kk = _attDbgKey + ':' + cause;
      dbgStats.kills[kk] = (dbgStats.kills[kk] || 0) + 1;
      if (dbgStats[_attDbgKey]) dbgStats[_attDbgKey].killCredit++;
    }
  }
  if (t === player && !(typeof SPECTATE_MATCH !== 'undefined' && SPECTATE_MATCH)) {
    if (killMsgOn && cause === 'ABANDONED') addLog('<b>已弃车</b>', 'fire');   // 玩家主动弃车:击杀播报固定四字
    playerDied(cause);
    return;
  }
  if (player && areHostile(player, t)) {                 // 团队模式为敌队；个人死斗为所有其他载具
    if (att === player) {
      kills++;
      hitMarkerAppend('TARGET DESTROYED!', 'kill');                           // 接在命中链尾(致死模块命中行之后)
    }
    if (killMsgOn) addLog('<b>' + vehicleDisplayName(t) + deathWord(cause) + '</b>', att === player ? 'kill' : 'good');   // 击杀播报:型号+死法(玩家击杀=黄标 kill 类)
  } else {
    if (killMsgOn) addLog('<b>' + vehicleDisplayName(t) + deathWord(cause) + '</b>', 'fire');
  }
  // 爆炸声:殉爆(2.1)/烧死(1.5)走 explosion 分级响度;普通击毁无爆炸音(见 killTank 头注)
}

function playerDied(cause) {
  // 当前生命段结束；最高纪录已在每次击毁时写入本局暂存，下一次部署/接管会开启新生命段。
  try {
    if (window.Achievements && typeof window.Achievements.endLife === 'function') window.Achievements.endLife();
  } catch (eAchLifeEnd) {}
  if (typeof sfxRwrAlarmStop === 'function') sfxRwrAlarmStop();
  if (typeof sfxRwrToneStop === 'function') sfxRwrToneStop();
  if (typeof sfxEventVoiceStop === 'function') sfxEventVoiceStop();
  if (typeof sfxLwrToneStop === 'function') sfxLwrToneStop();
  if (typeof sfxReloadCueStop === 'function') sfxReloadCueStop();
  if (player) {
    player._prevLockedKeys = {};
    player._heliMissileTarget = null;
  }
  if (player && (isHeliVehicle(player) || (typeof isAAVehicle === 'function' && isAAVehicle(player)))) {
    stopHeliRadarScan(player);   // RED_AA 车载雷达与直升机火控雷达同套扫描状态机
  }
  if (typeof sfxHeliDamageVoiceStop === 'function') sfxHeliDamageVoiceStop();
  if (typeof sfxHeliPullupStop === 'function') sfxHeliPullupStop();
  if (typeof sfxRadarScanStop === 'function') sfxRadarScanStop();
  onPlayerBoundaryContact(false);
  if (el && el.abandonring) el.abandonring.style.opacity = '0';
  if (el && el.abandontxt) el.abandontxt.style.opacity = '0';
  setTankVisuals(player, true);          // 残骸必须可见(即使死于开镜状态)
  ownVisualsVisible = true;

  scopeMode = false;
  if (isFfaMode()) {
    // 个人死斗没有接管：有备用载具就延迟后打开同一套重新部署选择菜单；没有则记录淘汰名次。
    var survivorsAfterDeath = typeof ffaAliveCount === 'function' ? ffaAliveCount() : aliveList.length;
    if (ffaState.reserves > 0 && survivorsAfterDeath > 0) {
      respawnT = 3.5;
    } else {
      ffaState.playerEliminated = true;
      ffaState.finalRank = survivorsAfterDeath + 1;
      if (typeof battleCheck === 'function' && survivorsAfterDeath <= 1) battleCheck();
    }
    return;
  }
  if (teamPool[pSide()] <= 0) {           // 兵力已空:无法重新部署 → 自选一类友军载具接管(实时在场类型)
    showPossessOv();
    return;                               // 若已无可接管者,胜负交由 battleCheck:兵力0+全灭判负
  }
  respawnT = 3.5;                         // 等闭眼+血褪完成后再弹战术面板(动画约 3.34s)
}

/* 兵力耗尽后的友军载具接管:按类型选择,再随机接管同类存活载具。 */
var possessUiOpen = false, possessRefreshT = 0;
function vehicleKindName(team, kind) {
  // 通用化:型号名查 VEHICLE_KINDS 注册表(新增型号自动生效;火箭炮保持类名)
  for (var vi = 0; vi < VEHICLE_KINDS.length; vi++)
    if (VEHICLE_KINDS[vi].kind === kind) return VEHICLE_KINDS[vi].names[team] || VEHICLE_KINDS[vi].names.red;
  return 'VEHICLE';
}
function refreshVehicleChoiceLabels() {                    // 开局/重部署按钮随阵营显示真实平台名,data-k 兼容键不变;
  var rows = [el.skrow, el.rkindrow];                      // 阵营白名单型号(99=红方专属)在蓝方隐藏按钮; FFA 重部署行由 ffaVehicleOptions 自己过滤
  for (var r = 0; r < rows.length; r++) {
    if (!rows[r] || typeof rows[r].querySelectorAll !== 'function') continue;
    var bs = rows[r].querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) {
      var k = bs[i].getAttribute('data-k');
      if (!k) continue;
      var rowFfa = isFfaMode() && (rows[r] === el.skrow || rows[r] === el.rkindrow);
      var bTeam = bs[i].getAttribute('data-side') || pSide();
      var allowed = rowFfa ? true : vehicleKindAllowed(pSide(), k);
      bs[i].style.display = allowed ? '' : 'none';
      if (!allowed && startKind === k && rows[r] === el.skrow) { startKind = 'tank'; markSel(el.skrow, 'data-k', startKind); }
      if (!allowed && respawnSel.kind === k) { respawnSel.kind = 'tank'; markSel(el.rkindrow, 'data-k', respawnSel.kind); }   // 仅回退兵种,翼位是玩家的独立选择
      bs[i].textContent = vehicleKindName(bTeam, k);
    }
  }
}
function possessCandidates(kind) {
  var out = [];
  for (var i = 0; i < aliveList.length; i++) {
    var t = aliveList[i];
    /* aliveList is normally pruned by killTank, but keep the live/unit-state
       checks here as the final gate: a death-frame click must never select a
       stale wreck or the old player shell. */
    if (!t || !t.alive || (typeof UNIT_ALIVE !== 'undefined' && t.unitState !== UNIT_ALIVE)) continue;
    if (t === player || t.team !== pSide() || t.isPlayer || (kind && t.kind !== kind)) continue;
    out.push(t);
  }
  return out;
}
function showPossessOv() {
  if (el.possessov) el.possessov.classList.remove('hidden');
  possessUiOpen = true;
  /* Re-ensure the row on every death path.  The wrapper UI can move the row
     into its BIOS window after startup, so the native handler must remain
     available at the actual open boundary as well. */
  if (el.posskindrow && !el.posskindrow._possessBound && typeof bindPossessUI === 'function') bindPossessUI();
  // 选车界面立刻放光标直接可点(倒数期光标不锁);复活界面同款
  document.exitPointerLock && document.exitPointerLock();
  updatePossessOv();
}
function hidePossessOv() {
  possessUiOpen = false;
  if (el.possessov) el.possessov.classList.add('hidden');
}
function updatePossessOv() {                 // 实时在场量:tanks 列表为唯一真值源
  if (!el.posskindrow) return;
  if (!el.posskindrow.querySelectorAll('button').length && typeof bindPossessUI === 'function') bindPossessUI();
  var c = {}, i;
  var all = possessCandidates();
  for (i = 0; i < all.length; i++) c[all[i].kind] = (c[all[i].kind] || 0) + 1;
  var btns = el.posskindrow.querySelectorAll('button');
  for (i = 0; i < btns.length; i++) {
    var k = btns[i].getAttribute('data-k'), n = c[k] || 0;
    btns[i].style.display = vehicleKindAllowed(pSide(), k) ? '' : 'none';     // 阵营白名单(蓝方无 红方重型坦克行;开界面/0.25s 节流刷新=事件级)
    btns[i].textContent = vehicleKindName(pSide(), k) + ' ×' + n;             // 显示型号名(红方主战坦克/红方重型坦克/BLUE_MBT_1/RED_TD/BLUE_MBT_2/火箭炮)+在场数
    btns[i].disabled = n === 0;
    if (btns[i].classList && btns[i].classList.toggle) btns[i].classList.toggle('dim', n === 0);
  }
}

function bindPossessUI() {
  if (!el.posskindrow || typeof el.posskindrow.querySelectorAll !== 'function') return;
  if (el.posskindrow._possessBound) return;
  var rows = [], ri;                // 接管类型行=VEHICLE_KINDS 注册表全量生成(新增型号自动生效;阵营过滤/在场量刷新见 updatePossessOv)
  for (ri = 0; ri < VEHICLE_KINDS.length; ri++)
    rows.push({ text: vehicleKindName('red', VEHICLE_KINDS[ri].kind), attrs: { k: VEHICLE_KINDS[ri].kind } });
  bindOptionRow(el.posskindrow, rows, function (b) {
    possessByKind(b.getAttribute('data-k'));
  });
  el.posskindrow._possessBound = true;
}
function possessByKind(kind) {
  /* The cinematic BIOS wrapper may briefly defer its own open flag while the
     native button is already clickable.  Trust the death/player state and the
     live candidate list instead of making the click depend on that animation
     bookkeeping flag. */
  var panelVisible = el.possessov && el.possessov.classList && !el.possessov.classList.contains('hidden');
  if ((!possessUiOpen && !panelVisible) || gameState !== 'playing' || (player && player.alive)) return;
  var cands = possessCandidates(kind);
  if (!cands.length) { updatePossessOv(); return; }        // 该类刚被打光→重刷,不放行空气接管
  if (DBG_ON) dbgStats.possesses = (dbgStats.possesses || 0) + 1;
  var t2 = cands[Math.floor(Math.random() * cands.length)];
  if (!t2 || !t2.alive || (typeof UNIT_ALIVE !== 'undefined' && t2.unitState !== UNIT_ALIVE)) { updatePossessOv(); return; }
  if (player) {
    player.isPlayer = false;
    if (typeof vehicleTechApplyToTank === 'function') vehicleTechApplyToTank(player);  // 立刻还原基础字段，避免旧玩家科技泄漏给 AI
    if (typeof vehInkMarkPlayer === 'function') vehInkMarkPlayer(player, false);
  }   // 旧座车残骸留在战场上
  player = t2;
  cmdLeave(t2);                      // 被接管车脱离 AI 指挥编组
  t2.isPlayer = true;
  if (typeof vehicleTechApplyToTank === 'function') vehicleTechApplyToTank(t2);
  // 接管开启新的生命段，但不计入出击次数。
  if (window.Achievements && typeof window.Achievements.beginLife === 'function') window.Achievements.beginLife(t2);
  if (typeof vehInkMarkPlayer === 'function') vehInkMarkPlayer(t2, true);
  t2._hullAim = turretMult(t2) <= 0.001;   // 接管瞬间一次性检测炮塔状态(车体瞄准旗标;此后不再检测)
  abandonCancel(t2);                 // 被接管:取消弃车观察(防倒数误杀新座车)
  playerEquipSync();                 // 接管边沿:座车设备缓存+越权关断+触控键显隐
  t2.name = 'YOU';
  /* 接管实例化——AI 车视觉网格是 _instSrc 隐藏源(实例流代显);
     接管后实例流跳过玩家,个体网格必须还原为常规可见网格,否则=隐形车(命中壳/阴影仍在而车身不可见)。
     还原后 setTankVisuals(开镜自隐)旧显隐链原样接管。 */
  if (t2._instSrcs) for (var isi = 0; isi < t2._instSrcs.length; isi++) {
    var im2 = t2._instSrcs[isi];
    if (im2) { im2.userData._instSrc = false; im2.visible = true; }
  }
  t2._instOut = false;
  /* 接管履带动画——AI 车 hull 个体网格材质是 vehBodyMat(无履带 shader),_hullMat 未挂;
     接管后 trackAnimUpdate 走玩家 uniform 链(需 _hullMat.userData.hullUniforms),须换 vehHullMatPlayer 并挂 _hullMat,
     与 redeployPlayer 新车链路(isP=true → vehHullMatPlayer+_hullMat)对齐;否则玩家/AI 双履带链全断=履带静止。
     仅坦克/td:arty 模板 hull 无 aTrack/aTrackSide 属性，换材质会导致 shader attribute 缺失异常。 */
  if (t2.kind !== 'arty' && t2._instSrcs && t2._instSrcs[0]) {
    t2._instSrcs[0].material = vehHullMatPlayer;
    t2._hullMat = vehHullMatPlayer;
    /* P1-1 接管战损交接:炮塔/炮管/炮盾/旋翼换 uniform 链材质(arty 车体亦换 Body 系,不挂 _hullMat);
       全部 _wxParts 挂逐 draw 钩子(与 spawn 同口径),否则战损冻结/错乱。 */
    if (t2._instSrcs && typeof vehBodyMatPlayer !== 'undefined') {
      var _pidx = t2.kind === 'arty' ? [0, 2, 4, 5, 6, 7] : [2, 4, 5, 6, 7];
      for (var _pi = 0; _pi < _pidx.length; _pi++) {
        var _pm = t2._instSrcs[_pidx[_pi]];
        if (_pm) _pm.material = vehBodyMatPlayer;
      }
    }
    if (t2._wxParts && typeof _wxPlayerDrawHook === 'function') {
      for (var _wkk in t2._wxParts) if (t2._wxParts[_wkk]) t2._wxParts[_wkk].onBeforeRender = _wxPlayerDrawHook;
    }
  }

  t2.turretYawDelta = 0; aimPX = innerWidth * 0.5; aimPY = innerHeight * 0.5; aimChaseOn = true; camAimY = t2.yaw + t2.turretYaw; camAimP = t2.gunPitch;       // 接管:鼠标位回中,相机瞄向=炮口向
  if (t2.ai) { t2.ai.targetO = null; }       // 清掉 AI 残余索敌状态
  if (t2.kind === 'arty') {                  // 火箭炮火控状态复位(上一轮的伺服/校准/俯视装定作废)
    t2._artyAz = null; t2._artyAim = null; t2._artySol = null;
    t2._artyKv = 1; t2._servoHoldT = 0; t2.artyRange = 300;
    t2._topFireWish = false; t2._topTgt = null; t2._topHover = null;
    t2._artyCreepFwd = 0; t2._topCreepDist = 0; t2._covR = null;
    t2._topCamX = 0; t2._topCamZ = 0;
  }
  // 直升机火控下发状态隔离(清空上一轮锁定下发/锁定音状态,不强制关雷达——雷达唯一关闭情形=发动机熄火)
  t2._heliMissileTarget = null;
  t2._prevLockedKeys = {};
  t2._heliRadarManualInhibit = false;
  if (typeof isAAVehicle === 'function' && isAAVehicle(t2) && t2._heliWeapon == null) t2._heliWeapon = 3;   // 防空载具接管默认 1 号位=防空导弹
  if (isHeliVehicle(t2)) {
    if (t2._heliWeapon == null) t2._heliWeapon = 3;
    if (t2._heliEngineState == null || t2._heliEngineState === 'running') {
      t2._heliEngineState = 'running';
      t2._heliCollCap = t2._heliCollCap != null ? t2._heliCollCap : 1.0;
      // 热态接管: 空中载具旋翼须在额定转速 (升速曲线重构后转速为真实物理态, 防止空中接管从零转30秒升速坠落)
      var hPrmTk = HELI_PARAMS[t2.kind] || HELI_PARAMS.wz10;
      var altTk = t2._heliAlt != null ? t2._heliAlt : Math.max(0, t2.group.position.y - terrainH(t2.group.position.x, t2.group.position.z));
      if (altTk > 1.0 && !(t2._heliRotorRPM > hPrmTk.rotorOmega0 * 0.5)) {
        t2._heliRotorRPM = hPrmTk.rotorOmega0;
        t2._heliTailRotorRPM = hPrmTk.rotorOmega0 * hPrmTk.tailRatio;
        t2._heliGovRunT = HELI_GOV_RAMP_TIME;
        t2._heliStartPhaseT = HELI_ENGINE_START_TIME;
      }
      t2._heliRadarWarmup = t2._heliRadarWarmup != null ? t2._heliRadarWarmup : HELI_RADAR_WARMUP_TIME;
    }
  }
  if (typeof sfxRadarScanStop === 'function') sfxRadarScanStop();
  if (typeof sfxRwrAlarmStop === 'function') sfxRwrAlarmStop();
  if (typeof sfxRwrToneStop === 'function') sfxRwrToneStop();
  if (typeof sfxEventVoiceStop === 'function') sfxEventVoiceStop();
  /* ★接管瞬间一次性检测:预热已完成(isHeliRadarReady)且雷达当前未开启 → 自动开启。
     放在上方音效清理之后,使自动开启的"嘟嘟"提示音不被 sfxRadarScanStop 立即掐断。
     修复"接管一架预热已满但雷达关闭的 AI 直升机时雷达保持关闭"的问题;
     若雷达已在开启态(AI 常亮)则保持不动,不重复启动;雷达唯一关闭情形=发动机熄火。 */
  if ((isHeliVehicle(t2) || (typeof isAAVehicle === 'function' && isAAVehicle(t2))) && isHeliRadarReady(t2) && !t2._heliRadarActive) {
    startHeliRadarScan(t2);
  }
  rebuildTargets();
  scopeMode = false; scopeT = 0;
  ownVisualsVisible = true;
  snapCamera();
  hidePossessOv();
  attemptLock();                             // 接管成功自动收回光标(点击手势内必成)
  if (killMsgOn) addLog('<b>接管' + (pSide() === 'red' ? '红方' : '蓝方') + '</b>', 'good');   // 状态播报仅走击杀信息行,按玩家阵营显色名
  hudTick = 0;
}

function snapCamera() {
  var aimYaw = player.yaw + player.turretYaw;
  var back = 8.4, pitch = 0.33;
  camera.position.set(
    player.group.position.x - Math.sin(aimYaw) * Math.cos(pitch) * back,
    player.group.position.y + 2.0 + Math.sin(pitch) * back,
    player.group.position.z - Math.cos(aimYaw) * Math.cos(pitch) * back
  );
}
/* ===== 玩家重新部署:自选载具 + 自选翼位 ----
   载具型号经 hqTypeOfKind() 自动对应到该兵种的大本营(定纵深),玩家只需在左翼/中央/右翼中选一个(定横向)。
   与 AI redeploy 等效:部署时消耗 1 点同阵营兵力;兵力为 0 则无法复活 ===== */
var respawnSel = { wing: HQ_WING_CENTER, kind: 'td', team: startSide };
var respawnUiOpen = false, respawnUiT = 0;
var startKind = 'td';                                 // 开局选择的载具(默认 BLUE-MBT-2)
/* ===== 主菜单选边:红方=red(59 式涂装美术)/蓝方=blue(BLUE_MBT_2 楔塔美术) ===== */
var startSide = 'blue';                                // 玩家阵营(遭遇战参数二选一,默认蓝方)
function pSide() { return startSide; }                   // 玩家队(team 字符串)
function oSide() { return startSide === 'red' ? 'blue' : 'red'; }   // 玩家敌队
var spawnFlip = 1;                                       // 本局半场翻转(spawnTeams 落位时写入;AI 回防方向等读取)
function redeployFreeForAll() {
  if (gameState !== 'playing' || !isFfaMode() || ffaState.reserves <= 0) return;
  if (player && player.alive) return;
  var opts = typeof ffaCurrentVehicleOptions === 'function' ? ffaCurrentVehicleOptions() : [];
  var chosen = null;
  for (var oi = 0; oi < opts.length; oi++) {
    if (opts[oi].kind === respawnSel.kind && opts[oi].team === respawnSel.team) { chosen = opts[oi]; break; }
  }
  if (!chosen) chosen = opts.length ? opts[0] : { team: 'red', kind: 'tank' };
  var team = chosen.team;
  var kind = chosen.kind;
  respawnSel.kind = kind;
  respawnSel.team = team;
  var spot = typeof ffaSpawnSpot === 'function' ? ffaSpawnSpot(true) : { x: 0, z: 0 };
  ffaState.reserves--;
  playerRespawns++;
  if (player) {
    player.isPlayer = false;
    if (typeof vehicleTechApplyToTank === 'function') vehicleTechApplyToTank(player);
  }
  var opt = { isPlayer: true, team: team, x: spot.x, z: spot.z, yaw: rand(-Math.PI, Math.PI), name: 'YOU' };
  if (kind !== 'tank') opt.kind = kind;
  var nt = createTank(opt);
  player = nt;
  startSide = team; startKind = kind;
  if (nt) {
    nt.reload = 0; nt._heliMissileTarget = null; nt._prevLockedKeys = {};
    nt._ffaSpawnInvulUntil = gameT + 3;
    if ((isHeliVehicle(nt) || (typeof isAAVehicle === 'function' && isAAVehicle(nt))) && nt._heliWeapon == null) nt._heliWeapon = 3;
    if (window.Achievements && typeof window.Achievements.noteDeployment === 'function') window.Achievements.noteDeployment(nt);
    playerEquipSync();
    player.turretYawDelta = 0; aimPX = innerWidth * 0.5; aimPY = innerHeight * 0.5; aimChaseOn = true;
    camAimY = nt.yaw + nt.turretYaw; camAimP = nt.gunPitch;
  }
  rebuildTargets();
  scopeMode = false; scopeT = 0; ownVisualsVisible = true;
  snapCamera(); hideRespawnUI(); attemptLock();
  if (killMsgOn) addLog('<b>重新部署</b>', 'good');
  hudTick = 0;
}
function redeployPlayer() {
  if (isFfaMode()) { redeployFreeForAll(); return; }
  if (gameState !== 'playing' || teamPool[pSide()] <= 0) return;      // 兵力/大本营/载具全按玩家队
  if (player && player.alive) return;              // 防双击重复部署/双扣兵力
  var hq = hqFind(pSide(), respawnSel.kind, respawnSel.wing);   // 载具型号定兵种基地,玩家所选翼位定左/中/右
  if (!hq) return;
  var spot = findSpawnSpot(hq.x, hq.z);
  teamPool[pSide()]--;                                 // 玩家这次重新部署消耗 1 点兵力
  playerRespawns++;
  var yaw = hq.yaw + rand(-0.1, 0.1);
  if (player) {
    player.isPlayer = false;
    if (typeof vehicleTechApplyToTank === 'function') vehicleTechApplyToTank(player);
  }             // 旧座车残骸留在战场上(不参与移除)
  var opt = { isPlayer: true, team: pSide(), x: spot.x, z: spot.z, yaw: yaw, name: 'YOU' };
  var nt;
  if (respawnSel.kind !== 'tank') opt.kind = respawnSel.kind; nt=createTank(opt);
  player = nt;
  // 仅正常重新部署计入出击；接管友军走 possessByKind，不调用此记账入口。
  if (nt && window.Achievements && typeof window.Achievements.noteDeployment === 'function') {
    window.Achievements.noteDeployment(nt);
  }
  if (nt) {
    nt._heliMissileTarget = null;
    nt._prevLockedKeys = {};
    if ((isHeliVehicle(nt) || (typeof isAAVehicle === 'function' && isAAVehicle(nt))) && nt._heliWeapon == null) nt._heliWeapon = 3;
  }
  if (player && (isHeliVehicle(player) || (typeof isAAVehicle === 'function' && isAAVehicle(player)))) {
    stopHeliRadarScan(player);
  }
  if (typeof sfxRadarScanStop === 'function') sfxRadarScanStop();
  playerEquipSync();                                   // 部署边沿:座车设备缓存+越权关断+触控键显隐

  player.turretYawDelta = 0; aimPX = innerWidth * 0.5; aimPY = innerHeight * 0.5; aimChaseOn = true; camAimY = yaw + player.turretYaw; camAimP = player.gunPitch;   // 重生:鼠标位回中,相机瞄向=炮口向
  rebuildTargets();
  scopeMode = false; scopeT = 0;
  ownVisualsVisible = true;
  snapCamera();
  hideRespawnUI();
  attemptLock();                                 // 重新部署后立刻收回鼠标
  if (killMsgOn) addLog('<b>重新部署</b>', 'good');   // 状态播报仅走击杀信息行,固定四字
  hudTick = 0;
}
/* ============================================================
   昼夜时间系统(连续小时 0~24,遭遇战参数拖动条):
   · 天空挂真实比例太阳:硬核视直径 0.53°(与真实太阳一致)+ 径向微晕,
     Sprite 布告板逐帧钉在镜头前 1900m、光照方位上(方位随小时旋转,
     低角度放大 ≤30% + 渐橙红);月亮 = 太阳对跖点(恒满月,地平线上即可见)
   · applyTimeOfDay(小时) 连续插值光照参数(平行光/半球光/雾/背景/云色),
     正午暖白 ↔ 低角度橙红 ↔ 深夜月光冷蓝,无档位跳变;几何零改动
   ============================================================ */
var SUN_DIST = 1900;
var SUN_CORE_DIA = 2 * SUN_DIST * Math.tan(0.53 / 2 * Math.PI / 180);   // 硬核直径 ≈17.58m@1900m = 视直径 0.53°
var SUN_TEX_CORE = 0.219;                                  // 硬核占贴图宽比例 → 整板宽=硬核/0.219(≈80m,晕延 ~2.4°)
var MOON_DIST = 1900;
var MOON_CORE_DIA = 2 * MOON_DIST * Math.tan(0.518 / 2 * Math.PI / 180); // 月盘直径 ≈17.17m@1900m = 视直径 0.518°(真实满月)
var MOON_TEX_CORE = 0.70;                                // 月盘占贴图宽比例 → 整板(含微晕)≈24.5m
/* 连续时间模型:
   小时 h∈[0,24)——太阳高度 = sin((h-6)/12·π)×0.92(6 点地平/12 点最高/18 点落),
   方位随小时旋转(6 点东 +x → 12 点南 +z → 18 点西 -x);月亮 = 太阳对跖点(+12h,恒满月)。
   亮度/色调/雾色/日盘大小随高度角连续插值(正午白 ↔ 低角度橙红 ↔ 深夜月光蓝),无档位跳变。 */
var _sunOfHour = { x: 0, y: 0, z: 0, sy: 0, dayL: 0, duskF: 0, nightF: 0 };   // 小时→太阳参数复用 scratch
function sunElev(h) { return Math.sin((h - 6) / 12 * Math.PI) * 0.92; }        // 太阳高度角统一公式(夜判/插值同口径)
function sunOfHour(h) {
  var t = (h - 6) / 12 * Math.PI;
  var sy = sunElev(h);
  var o = _sunOfHour;
  o.sy = sy;
  o.x = Math.cos(t); o.z = Math.sin(t); o.y = sy;
  var d0 = clamp(sy / 0.4, 0, 1); o.dayL = d0 * d0 * (3 - 2 * d0);  // 日出后 smoothstep 渐亮(sy=0.4≈8.5 点满亮,非日出瞬间跳亮)
  o.nightF = clamp(-sy * 2.5, 0, 1);                     // 夜晚因子(太阳明显地平线下)
  o.duskF = clamp((1 - sy) * 1.2, 0, 1) * (1 - o.nightF); // 黄昏因子(低角度白天;夜晚归零)
  return o;
}
function isNightOf(h) { return sunElev(h) < -0.08; }   // 星空/月亮初始判定(与 sunOfHour 共用高度公式)
var nightCombatOn = false;                             // 夜战全局量(applyTimeOfDay 边沿写;ai 夜战瞄准效率消费,无逐帧检测)
function hourLabel(h) {                                  // "8.5" → "08:30 (白昼)"(菜单时间显示)
  var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  var timeStr = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  var tag = ' (白天)';
  if (h >= 5 && h < 7) tag = ' (黎明)';
  else if (h >= 7 && h < 17) tag = ' (白天)';
  else if (h >= 17 && h < 19.5) tag = ' (黄昏)';
  else tag = ' (夜晚)';
  return timeStr + tag;
}
var _sunV = new THREE.Vector3();
sunOffset = new THREE.Vector3(0.73, 0.38, 0.5);           // 默认清晨(8 点)日照方向;开局按所选小时重算+阵营半场翻转水平分量
/* ===== R25-T5 渐变天空穹顶(替换纯色 scene.background)——天顶↔地平线竖直渐变 + 朝日方位的地平线辉光 ==========
   业界成熟做法(Pinwheel Jupiter 三色渐变大气 / TerraTech ramp 控天空 / MinionsArt stylized skybox):
     · 大穹顶 BackSide,跟随相机平移(无视差),不写/不测深度、renderOrder 极低=永远最先画作背景;
     · 片元:h=视线方向.y,pow(h,0.55) 偏斜 → mix(地平线色,天顶色);近地平线朝太阳方位叠暖辉光;
     · 时刻联动:applyTimeOfDay 依 dayL/duskF/nightF 三段插值天顶/地平线/辉光色+强度(与光照/雾同口径);
       uHorizon 贴雾色 → 远景雾无缝接到地平线渐变(「地平线无缝」)。
   夜视/热成像:整屏改用像管/热度平色,穹顶 visible=false 让 scene.background 平色透出(退出时 applyTimeOfDay 复显)。
   漫画后处理:穹顶不写深度=纯天区 skyM 命中→亮度描边熄灭(与日月同策略);低频渐变不触发 Roberts 边检。 */
var skyDome = null, _skZ = new THREE.Color(0.28, 0.50, 0.82), _skH = new THREE.Color(0.72, 0.84, 0.92),
    _skG = new THREE.Color(1, 0.98, 0.92), _skGStr = 0.28, _skSunDir = new THREE.Vector3(0, 1, 0),
    _skcA = new THREE.Color(), _skcB = new THREE.Color();
function buildSkyDome() {
  if (skyDome) { scene.remove(skyDome); skyDome.geometry.dispose(); skyDome.material.dispose(); skyDome = null; }
  var geo = new THREE.SphereGeometry(9000, 32, 16);     // 半径 9km:包住日月(1.9km)/星空(3.6km),内于相机远平面(60km)
  var vs = [
    'varying vec3 vDir;',
    'void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
  ].join('\n');
  var fs = [
    'precision mediump float;',
    'uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGlowCol; uniform float uGlowStr; uniform vec3 uSunDir;',
    'varying vec3 vDir;',
    'void main(){',
    '  vec3 d = normalize(vDir);',
    '  float h = clamp(d.y, -1.0, 1.0);',
    '  float t = pow(max(h, 0.0), 0.55);',                 // 偏斜:大片天空色在上,渐变收束向地平线
    '  vec3 col = mix(uHorizon, uZenith, t);',
    '  float horizonF = 1.0 - smoothstep(0.0, 0.32, abs(h));',   // 越贴地平线越强
    '  vec2 dxz = normalize(vec2(d.x, d.z) + 1e-5);',
    '  vec2 sxz = normalize(vec2(uSunDir.x, uSunDir.z) + 1e-5);',
    '  float azi = max(dot(dxz, sxz), 0.0);',              // 朝太阳水平方位的辉光集中
    '  float glow = uGlowStr * horizonF * pow(azi, 2.0);',
    '  col = mix(col, uGlowCol, clamp(glow, 0.0, 1.0));',
    '  col = mix(col, uHorizon, smoothstep(0.0, -0.15, h));',    // 地平线以下(地图边缘露出处)落到地平线色
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');
  var mat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: _skZ }, uHorizon: { value: _skH }, uGlowCol: { value: _skG },
      uGlowStr: { value: _skGStr }, uSunDir: { value: _skSunDir }
    },
    vertexShader: vs, fragmentShader: fs,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false
  });
  skyDome = new THREE.Mesh(geo, mat);
  skyDome.renderOrder = -1000;                            // 永远最先绘制=背景
  skyDome.frustumCulled = false;
  scene.add(skyDome);
  skyDomeTrack();
}
function skyDomeTrack() { if (skyDome && camera) skyDome.position.copy(camera.position); }
/* 依 sunOfHour 因子写天空穹顶天顶/地平线/辉光色与强度(applyTimeOfDay 内调用;事件级,非逐帧)。
   注:太阳方位 uSunDir=sunOffset(位置不动,仅决定辉光朝向),严格不改日月运动。 */
function updateSkyDome(S) {
  if (!skyDome) return;
  // 天顶:白天饱和蓝 → 黄昏紫罗兰 → 夜晚墨蓝
  _skZ.copy(_skcA.setRGB(0.28, 0.50, 0.82).lerp(_skcB.setRGB(0.29, 0.27, 0.50), S.duskF)
    .lerp(_skcB.setRGB(0.03, 0.05, 0.13), S.nightF));
  // 地平线:白天浅蓝白 → 黄昏炽橙 → 夜晚深蓝(贴雾色,远景无缝)
  _skH.copy(_skcA.setRGB(0.72, 0.84, 0.92).lerp(_skcB.setRGB(0.94, 0.50, 0.27), S.duskF)
    .lerp(_skcB.setRGB(0.10, 0.13, 0.24), S.nightF));
  // 辉光色:白天暖白弱 → 黄昏橙强 → 夜晚冷蓝弱
  _skG.copy(_skcA.setRGB(1.0, 0.98, 0.92).lerp(_skcB.setRGB(1.0, 0.59, 0.27), S.duskF)
    .lerp(_skcB.setRGB(0.27, 0.35, 0.59), S.nightF));
  _skGStr = 0.28 + 0.62 * S.duskF + 0.10 * S.nightF;      // 黄昏辉光最强
  skyDome.material.uniforms.uGlowStr.value = _skGStr;
  if (sunOffset) _skSunDir.copy(sunOffset).normalize();
  skyDome.visible = true;                                 // 非 NV/热像时恒显(NV/热像在各自 sync 里置 false)
}
function buildSunTexture() {                               // 径向硬核+收晕贴图(外层晕只是辉光,硬核才是 0.53° 真日盘)
  try {
    var _c = make2DCanvas(256); if (!_c) return null;
    var cv = _c.cv, g = _c.g;
    var rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    rg.addColorStop(0.00, 'rgba(255,255,255,1)');
    rg.addColorStop(0.22, 'rgba(255,252,238,1)');          // 硬核边缘(直径 0.219×贴图宽)
    rg.addColorStop(0.30, 'rgba(255,240,208,0.55)');
    rg.addColorStop(0.60, 'rgba(255,228,185,0.12)');
    rg.addColorStop(1.00, 'rgba(255,224,178,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
    var t = new THREE.CanvasTexture(cv);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
    return t;
  } catch (e) { return null; }
}
function buildSunDisc() {
  var tex = null;
  try { tex = buildSunTexture(); } catch (e) { tex = null; }
  sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: 0xfff8e6, transparent: true, opacity: 1, depthTest: true, depthWrite: false, fog: false }));
  var w = SUN_CORE_DIA / SUN_TEX_CORE;                     // 整板(含晕)~80m;硬核严格保持真实 0.53°
  sunDisc.scale.set(w, w, 1);
  sunDisc.frustumCulled = false;             // 炮镜窄视锥(28°~5.6°)边缘 pop 根治(与云同策略;视锥外仅 4 顶点零片元)
  scene.add(sunDisc);
  sunTrack();
}
function buildMoonTexture() {                              // 月盘贴图:银白盘体+临边昏暗+手绘月海斑驳(坐标人工选定=确定性,零 RNG)
  try {
    var _c = make2DCanvas(256); if (!_c) return null;
    var cv = _c.cv, g = _c.g;
    var halo = g.createRadialGradient(128, 128, 0, 128, 128, 128);   // 外层微晕(只是辉光,月盘本体仍是 0.518°)
    halo.addColorStop(0.00, 'rgba(206,220,250,0.40)');
    halo.addColorStop(0.36, 'rgba(206,220,250,0.20)');
    halo.addColorStop(0.56, 'rgba(192,206,240,0.05)');
    halo.addColorStop(1.00, 'rgba(192,206,240,0)');
    g.fillStyle = halo; g.fillRect(0, 0, 256, 256);
    var R = 89.6;                                          // 月盘半径 → 直径 179.2px = 贴图宽 0.70
    var body = g.createRadialGradient(118, 116, 8, 128, 128, R);     // 微偏心渐变 = 临边昏暗
    body.addColorStop(0.00, '#fcfdff');
    body.addColorStop(0.72, '#dfe6f5');
    body.addColorStop(1.00, '#aab6d2');
    g.fillStyle = body;
    g.beginPath(); g.arc(128, 128, R, 0, Math.PI * 2); g.fill();
    var maria = [                                          // 月海暗斑(盘面坐标,人工选定模仿月面版图)
      [-26, -34, 26], [12, -26, 19], [34, -44, 13], [4, 12, 23], [-32, 14, 17],
      [38, 8, 12], [-6, 44, 15], [22, 54, 9], [-14, 66, 8]
    ];
    g.fillStyle = 'rgba(118,130,166,0.55)';
    for (var mi = 0; mi < maria.length; mi++) {
      g.beginPath(); g.arc(128 + maria[mi][0], 128 + maria[mi][1], maria[mi][2], 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.55)';                // 亮坑点
    var dots = [[-42, -52, 5], [36, -12, 4], [12, 60, 4]];
    for (var di = 0; di < dots.length; di++) {
      g.beginPath(); g.arc(128 + dots[di][0], 128 + dots[di][1], dots[di][2], 0, Math.PI * 2); g.fill();
    }
    var t = new THREE.CanvasTexture(cv);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
    return t;
  } catch (e) { return null; }
}
var moonGlow = null;
function buildMoonGlowTexture() {                           // 月晕贴图——多段径向渐变柔和衰减(加法混合=真实大气辉光)
  try {
    var _c = make2DCanvas(256); if (!_c) return null;
    var cv = _c.cv, g = _c.g;
    var gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0.00, 'rgba(216,229,255,0.52)');
    gr.addColorStop(0.16, 'rgba(208,222,252,0.30)');
    gr.addColorStop(0.34, 'rgba(192,209,245,0.14)');
    gr.addColorStop(0.58, 'rgba(178,197,239,0.06)');
    gr.addColorStop(0.82, 'rgba(170,190,235,0.02)');
    gr.addColorStop(1.00, 'rgba(170,190,235,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    var t = new THREE.CanvasTexture(cv);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
    return t;
  } catch (e) { return null; }
}
function buildMoonDisc() {
  var tex = null;
  try { tex = buildMoonTexture(); } catch (e) { tex = null; }
  moonDisc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, color: 0xffffff, transparent: true, opacity: 1, depthTest: true, depthWrite: false, fog: false }));
  var w = MOON_CORE_DIA / MOON_TEX_CORE * 3.6;             // 放大 3.6×(≈2.6° 视径,醒目);月盘纹理不变
  moonDisc.scale.set(w, w, 1);
  // Keep the moon above the transparent cloud pass, but retain the depth test:
  // terrain writes the depth buffer and can now occlude the disc without changing
  // the existing cloud/sky ordering.
  moonDisc.renderOrder = 10;
  moonDisc.material.depthTest = true;
  moonDisc.frustumCulled = false;            // 炮镜窄视锥边缘 pop 根治(与云/日同策略)
  moonDisc.visible = isNightOf(8);       // 初始按默认 8 点(白天);applyTimeOfDay 开局按所选小时重设
  scene.add(moonDisc);
  // 真实柔和辉光——加法混合大光晕层,renderOrder 9(月盘之下云幕之上)
  if (moonGlow) { scene.remove(moonGlow); if (moonGlow.material.map) moonGlow.material.map.dispose(); moonGlow.material.dispose(); moonGlow = null; }
  var gt = null; try { gt = buildMoonGlowTexture(); } catch (e) { gt = null; }
  moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: gt, color: 0xbfd2f5, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, fog: false }));
  moonGlow.scale.set(w * 5.5, w * 5.5, 1);              // 软晕≈月盘 5.5 倍(约 14° 视径)
  moonGlow.renderOrder = 9;
  moonGlow.frustumCulled = false;            // 炮镜窄视锥边缘 pop 根治(与云/日同策略)
  moonGlow.visible = isNightOf(8);
  scene.add(moonGlow);
  moonTrack();
  buildStars();                                          // 黑夜星空
}
/* 真实星图——内嵌 ~70 颗 J2000 亮星表([RA时, Dec°, 星等, 色类]),星座形态自然成形
   (猎户/北斗/仙后/天蝎/天鹅/南十字/天琴/天鹰/狮子/牧夫/双子/金牛…);另加 240 颗种子暗星衬底。
   按星等分三档像素尺寸;赤道系 y=sin(Dec) 为天顶,仅铺 Dec>−3° 星;天球随相机平移、fog/depthWrite 关。 */
var starField = [];
var STAR_CAT = [
[2.53,89.26,1.98,0],[11.06,61.75,1.79,1],[11.03,56.38,2.37,0],[11.90,53.69,2.44,0],[12.25,57.03,3.31,0],[12.90,55.96,1.77,0],[13.40,54.93,2.04,0],[13.79,49.31,1.86,2],
[5.92,7.41,0.50,1],[5.24,-8.20,0.13,2],[5.42,6.35,1.64,2],[5.68,-1.94,1.77,2],[5.60,-1.20,1.69,2],[5.53,-0.30,2.23,2],[5.80,-9.67,2.09,2],
[6.75,-16.72,-1.46,0],[7.65,5.22,0.34,0],[7.58,31.89,1.58,0],[7.76,28.03,1.14,1],
[5.28,45.99,0.08,1],[4.60,16.51,0.85,1],[5.44,28.61,1.65,2],
[18.62,38.78,0.03,0],[20.69,45.28,1.25,2],[19.85,8.87,0.77,0],[20.37,40.26,2.23,0],[20.77,33.97,2.46,0],[19.51,27.96,3.18,1],
[0.15,59.15,2.27,0],[0.67,56.54,2.24,1],[0.95,60.72,2.47,2],[1.43,60.24,2.68,0],[1.90,63.67,3.38,2],
[16.49,-26.43,1.09,1],[17.56,-37.10,1.63,2],[16.01,-22.62,2.32,2],[17.71,-43.00,1.87,0],
[10.14,11.97,1.35,2],[11.82,14.57,2.11,0],[10.33,19.84,2.61,1],
[14.26,19.18,-0.05,1],[6.38,-17.96,1.98,2],[3.41,49.86,1.79,0],[2.12,23.46,2.00,1],[22.96,-29.62,1.16,0],
[13.42,-11.16,0.97,2],[14.85,74.16,2.08,1],[15.58,26.71,2.23,0],[17.35,12.56,2.07,0],[18.40,-34.38,1.85,2],[18.92,-26.30,2.05,0],
[21.74,9.87,2.40,1],[23.08,15.21,2.49,0],[23.06,28.08,2.42,1],[0.19,15.18,2.83,2],[0.14,29.09,2.06,2],[0.73,-17.99,2.02,1],
[3.79,24.11,2.87,2],[7.14,-26.39,1.83,0],[6.98,-28.97,1.50,2],[9.46,-8.66,1.98,2],
[12.44,-63.10,0.76,2],[12.52,-57.11,1.64,1],[12.79,-59.69,1.25,2],
[16.83,-69.03,1.92,1],[20.39,-59.79,1.94,2],[22.14,-46.96,1.74,2],
[1.63,-57.25,0.46,2],[6.40,-52.70,-0.74,0],[14.66,-60.83,-0.27,1]
];
function buildStars() {
  for (var si2 = 0; si2 < starField.length; si2++) { scene.remove(starField[si2]); starField[si2].geometry.dispose(); }
  starField = [];
  var bins = [[], [], []];                       // 亮/中/暗 三档尺寸
  function pushStar(raH, decD, mag, cc, dim) {
    var ra = raH / 24 * TAU, dec = decD * Math.PI / 180, yv = Math.sin(dec);
    if (yv < -0.05) return;                      // 地平线以下不铺
    var cr = Math.cos(dec);
    var px = cr * Math.cos(ra) * 3600, py = yv * 3600, pz = cr * Math.sin(ra) * 3600;
    var b = dim ? 0.35 : Math.max(0.3, Math.min(1, 1 - mag / 4));
    var r = b, g = b, bl = b;
    if (cc === 1) { g = b * 0.82; bl = b * 0.62; }          // 暖(红橙)
    if (cc === 2) { r = b * 0.78; g = b * 0.88; }          // 蓝白
    var bi = dim ? 2 : (mag < 1.0 ? 0 : (mag < 2.2 ? 1 : 2));
    bins[bi].push(px, py, pz, r, g, bl);
  }
  for (var i = 0; i < STAR_CAT.length; i++) pushStar(STAR_CAT[i][0], STAR_CAT[i][1], STAR_CAT[i][2], STAR_CAT[i][3], false);
  var fr = mulberry32(0x51AB);
  for (var k = 0; k < 240; k++) {              // 暗星衬底
    var az = fr() * TAU, el = Math.asin(0.08 + 0.92 * fr());
    pushStar(az / TAU * 24, el * 180 / Math.PI, 2.6 + fr() * 1.5, fr() < 0.2 ? 1 : 0, true);
  }
  var sizes = [3.2, 2.0, 1.1];
  for (var bI = 0; bI < 3; bI++) {
    var arr = bins[bI]; if (!arr.length) continue;
    var pp = [], cc2 = [];
    for (var q = 0; q < arr.length; q += 6) { pp.push(arr[q], arr[q + 1], arr[q + 2]); cc2.push(arr[q + 3], arr[q + 4], arr[q + 5]); }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pp), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cc2), 3));
    var pts = new THREE.Points(g, new THREE.PointsMaterial({ size: sizes[bI], vertexColors: true,
      transparent: true, opacity: 0.95, sizeAttenuation: false, depthWrite: false, fog: false }));
    pts.visible = isNightOf(8);
    scene.add(pts); starField.push(pts);
  }
  starTrack();
}
function starTrack() { for (var i = 0; i < starField.length; i++) if (camera) starField[i].position.copy(camera.position); }
var _moonV = new THREE.Vector3();
var _celestialEye = new THREE.Vector3(), _celestialObj = new THREE.Vector3();
function celestialTerrainClear(obj) {
  if (!camera || !obj || typeof terrainH !== 'function') return true;
  _celestialEye.copy(camera.position);
  _celestialObj.copy(obj);
  var dx = _celestialObj.x - _celestialEye.x, dy = _celestialObj.y - _celestialEye.y, dz = _celestialObj.z - _celestialEye.z;
  var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(len > 1)) return true;
  /* A center-ray fallback complements the GPU depth test.  It is important at low
     elevation: a camera-facing sprite can otherwise remain visible when a narrow
     ridge is the only depth sample in front of its center. */
  for (var i = 1; i < 18; i++) {
    var f = i / 18;
    var x = _celestialEye.x + dx * f, z = _celestialEye.z + dz * f;
    var y = _celestialEye.y + dy * f;
    var th = terrainH(x, z);
    if (isFinite(th) && th > y - 0.35) return false;
  }
  return true;
}
function sunTrack() {                                      // 逐帧:太阳钉在「镜头位置 + 光照方位 × 1900m」(远山脊线可天然遮挡落日)
  if (!sunDisc || !camera) return;
  _sunV.copy(sunOffset).multiplyScalar(SUN_DIST).add(camera.position);   // 光照方向唯一来源=sunOffset(不再经 position 反推)
  sunDisc.position.copy(_sunV);
  sunDisc.visible = sunElev(timeHour) > 0 && celestialTerrainClear(_sunV);
}
function moonTrack() {                                     // 月亮钉在「镜头位置 + 太阳对跖方向 × 1900m」(随小时旋转;与 sunTrack 同机理)
  if (!moonDisc || !camera) return;
  _moonV.copy(sunOffset).multiplyScalar(-1).normalize().multiplyScalar(MOON_DIST).add(camera.position);
  moonDisc.position.copy(_moonV);
  var moonVisible = -sunElev(timeHour) > 0.02 && celestialTerrainClear(_moonV);
  moonDisc.visible = moonVisible;
  if (moonGlow) { moonGlow.position.copy(_moonV); moonGlow.visible = moonVisible; }
  starTrack();                                             // 星空随相机平移(天球无透视视差)
}
/* ===== 夜视仪(NVD)——车灯只保留零光源 MeshBasic 灯罩,不提供照地/反射/泛光;NVD仍负责黑夜远距离观察 ——
   开启 = 按 N(任意视角任意小时可用,连续时间系统无需适配);再按 N / 阵亡 / 换装无设备 → 立即复原;
   无后处理近似(r128 无 EffectComposer):
   ① 场景增亮拉绿——hemi/月光强度倍增调荧光绿,雾/背景暗绿,雾距 900/4300 → 620/3400(收窄雾带,突出像管观察);
   ② 无光照远郊(丘陵环/云)乘绿 tint;③ HUD 叠层:#nvd 绿色渐晕 + #nvn 8fps 动态噪点流
     (index.html,#hud 直属=第三人称与炮镜同显;炮镜内镜缘暗角在其上层压住);④ vehGlowMat 临时改为暗绿像管色。
   状态机:nvOn=N 键记忆;nvActive()=nvOn&&装备&&存活(视角无关);nvSync() 只在边沿改写场景,
   复原 = 重放 applyTimeOfDay(任意时态全量值一次性还原) + 雾距手动回填(它只管雾色) —— 零新增灯、零后处理 pass。 ===== */
var NVD = { hemiI: 1.0, hemiSky: 0x59ff90, hemiGnd: 0x1e4028, sunI: 0.34, sunCol: 0x7dffa8,
            fog: 0x06200e, bg: 0x04170a, fogNear: 620, fogFar: 5400,
            tint: 0x1d4a2a, cloudTint: 0x2f6a3a, glowCol: 0x2a5a34, sprite: 0x63e08a };   // sprite=像管下场景精灵荧光绿(R25-T3;unlit 精灵不受增亮拉绿的光照,单独给荧光绿 tint 与像管场景一致)
var nvOn = false, nvWas = false, nvNoiseT = 0, nvSaved = null;   // nvSaved=ON 边沿场景雾距快照(复原主路径=快照回填;fallback=当前基础雾距 900/4300)
function nvActive() { return nvOn && playerHasNV && player && player.alive; }   // 任意视角生效(不看镜不看钟点);设备门=座车装备缓存
function nvSync() {
  var a = nvActive();
  if (a === nvWas) return;
  nvWas = a;
  if (a) {
    if (typeof thermalOn !== 'undefined' && thermalOn) { thermalOn = false; thermalSync(); }   // 与热成像互斥(先复原热像再入像管)
    nvSaved = scene.fog ? { near: scene.fog.near, far: scene.fog.far } : null;   // 快照当前雾距(任意地图/时段的真实值)
    sunLight.color.setHex(NVD.sunCol); sunLight.intensity = NVD.sunI;
    if (hemiLight) { hemiLight.color.setHex(NVD.hemiSky); hemiLight.groundColor.setHex(NVD.hemiGnd); hemiLight.intensity = NVD.hemiI; }
    if (scene.fog) { scene.fog.color.setHex(NVD.fog); scene.fog.near = NVD.fogNear; scene.fog.far = NVD.fogFar; }
    if (scene.background && scene.background.setHex) scene.background.setHex(NVD.bg);
    if (typeof skyDome !== 'undefined' && skyDome) skyDome.visible = false;   // R25-T5:像管下隐渐变穹顶,露出平色暗绿背景(退出时 applyTimeOfDay 复显)
    var mref;
    mref = hillMesh && hillMesh.material;       if (mref) mref.color.setHex(NVD.tint);   // 无光照远郊三件套
    vehGlowMat.color.setHex(NVD.glowCol);        // 像管下车灯/窗罩/潜望镜统一呈暗绿
    if (typeof SCENE_SPRITE_TINT !== 'undefined') SCENE_SPRITE_TINT.setHex(NVD.sprite);   // R25-T3:像管下场景精灵荧光绿(退出像管时 applyTimeOfDay 自动复原时态色调)
    var ct = new THREE.Color(NVD.cloudTint);
    for (var ci = 0; ci < clouds.length; ci++) {
      clouds[ci].sp.material.color.setHex(clouds[ci].baseCol); clouds[ci].sp.material.color.multiply(ct);
    }
  } else {
    applyTimeOfDay(timeHour);                    // 一次性整体还原(任意时态安全;含 glowMat 夜删色)
    if (scene.fog) {                             // 雾距=ON 边沿快照回填(主路径;快照缺失时回退当前基础雾距 900/6200,大地图远丘不被雾切)
      scene.fog.near = nvSaved ? nvSaved.near : 900;
      scene.fog.far = nvSaved ? nvSaved.far : 6200;
    }
  }
  nvHud();
}
function nvHud() {
  if (el.nvd) el.nvd.classList[nvWas ? 'remove' : 'add']('hidden');    // 叠层显隐(无状态字样)
}
function nvTick(dt) {                            // 像管噪点流:8fps 小画布,CSS 拉伸满炮镜视场(无头/禁用画笔:静默早退)
  if (!nvWas) return;
  nvNoiseT -= dt;
  if (nvNoiseT > 0) return;
  nvNoiseT = 0.12;
  var cv = el.nvn; if (!cv || !cv.getContext) return;
  if (!cv.width) { cv.width = 192; cv.height = 108; }
  var g2 = cv._g2;
  if (g2 === undefined) {
    try { g2 = cv.getContext('2d'); } catch (e) { g2 = null; }
    if (!g2 || !g2.createImageData) g2 = null;
    cv._g2 = g2;
  }
  if (!g2) return;
  try {
    var id = g2.createImageData(cv.width, cv.height), dd = id.data;
    for (var i = 0; i < dd.length; i += 4) { var v = (Math.random() * 110) | 0; dd[i] = v * 0.4; dd[i + 1] = v; dd[i + 2] = v * 0.5; dd[i + 3] = 255; }
    g2.putImageData(id, 0, 0);
  } catch (e) { /* 静默 */ }
}

/* ===== 热成像(H 键/触控 tth,任意视角;夜视仪同架构=边沿场景重打光,零新增 pass)----
   显示端:comic 后处理 uThermal 灰度化+轻对比(uniform 分支);场景端 thermalSync 边沿按材质族写热度灰阶。
   热度排行落位:太阳(唯一保白,天然最热)>开火/爆炸火光·命中火花·各类烟焰(特效贴图亮度序天然近似:
   火光>火花>烟>焰)>弹体(0.72 灰)>活载具(材质 1.32×提亮)>残骸=地面=行进烟(同档,截图标定)>天空(背景 0.04)。
   行进烟(含发动机排烟)=comic.js CSM 热像分支:地面档平灰+MAX 混合——比烟热的物体一律透出,烟只对更冷背景显影。
   状态机:thermalOn=开关记忆;thermalActive()=开&&装备&&存活(视角无关);边沿写/复原=applyTimeOfDay+快照回填。 ===== */
var THERM = { hemiI: 1.25, sunI: 0.10, bg: 0x0a0a0a, fog: 0x121212,
              ground: 0x9c9c9c, hill: 0x303030, veh: 1.32, wreck: 0x3d3d3d, glow: 0x8f8f8f,
              cloud: 0x161616, moon: 0x1f1f1f, shell: 0xb8b8b8 };
var thermalOn = false, thermalWas = false, thermalSaved = null;
function thermalActive() { return thermalOn && playerHasTH && player && player.alive; }   // 任意视角生效;设备门=座车装备缓存(红方重型坦克/BLUE_MBT_2)
function thermalSync() {
  var a = thermalActive();
  if (a === thermalWas) return;
  thermalWas = a;
  if (typeof powerupThermalSync === 'function') powerupThermalSync(a, THERM.ground);
  var ci;
  if (a) {
    if (nvOn) { nvOn = false; nvSync(); }                              // 与夜视仪互斥(先复原像管再入热像)
    thermalSaved = { fogN: scene.fog ? scene.fog.near : 900, fogF: scene.fog ? scene.fog.far : 6200,
      gnd: (typeof groundMatSea !== 'undefined' && groundMatSea) ? groundMatSea.color.getHex() : null,
      shP: shellMatP.color.getHex(), shE: shellMatE.color.getHex() };
    sunLight.color.setHex(0xffffff); sunLight.intensity = THERM.sunI;  // 平光:方向光弱化,半球白光主导=灰阶由材质族决定
    if (hemiLight) { hemiLight.color.setHex(0xffffff); hemiLight.groundColor.setHex(0xffffff); hemiLight.intensity = THERM.hemiI; }
    if (scene.fog) scene.fog.color.setHex(THERM.fog);
    if (scene.background && scene.background.setHex) scene.background.setHex(THERM.bg);   // 天空=最低热度档
    if (typeof skyDome !== 'undefined' && skyDome) skyDome.visible = false;   // R25-T5:热像下隐渐变穹顶,露出平色最低热度背景(退出时 applyTimeOfDay 复显)
    var mh = hillMesh && hillMesh.material; if (mh) mh.color.setHex(THERM.hill);
    if (typeof groundMatSea !== 'undefined' && groundMatSea) groundMatSea.color.setHex(THERM.ground);   // 地面≈残骸档
    vehGlowMat.color.setHex(THERM.glow);
    vehBodyMat.color.setRGB(THERM.veh, THERM.veh, THERM.veh);          // 活载具提亮一档(>地面;深色格栅/行走件相对更暗=金属件层次)
    vehHullMat.color.setRGB(THERM.veh, THERM.veh, THERM.veh);
    vehHullMatPlayer.color.setRGB(THERM.veh, THERM.veh, THERM.veh);
    if (typeof vehBodyMatPlayer !== 'undefined') vehBodyMatPlayer.color.setRGB(THERM.veh, THERM.veh, THERM.veh);   // P0-2 companion:玩家炮塔系同调
    if (typeof vehInkMat !== 'undefined' && vehInkMat) vehInkMat.color.setHex(0x2a2a2a);
    wreckMat.color.setHex(THERM.wreck); wreckMat.emissive.setHex(0x000000);   // 残骸=地面档(0x3d3d3d,截图标定:与草肤地面实测终值同灰)
    shellMatP.color.setHex(THERM.shell); shellMatE.color.setHex(THERM.shell); // 飞行弹体档
    if (moonDisc) moonDisc.material.color.setHex(THERM.moon);
    if (moonGlow) moonGlow.material.opacity = 0.05;
    for (ci = 0; ci < starField.length; ci++) starField[ci].material.opacity = 0.10;
    if (sunDisc) sunDisc.material.color.setHex(0xffffff);              // 太阳=唯一保白(最高热度档)
    var ctm = new THREE.Color(THERM.cloud);
    for (ci = 0; ci < clouds.length; ci++) {
      clouds[ci].sp.material.color.setHex(clouds[ci].baseCol); clouds[ci].sp.material.color.multiply(ctm);
    }
  } else {
    applyTimeOfDay(timeHour);                                          // 灯光/雾色/背景/云/远郊/灯罩一次性还原
    if (scene.fog) { scene.fog.near = thermalSaved ? thermalSaved.fogN : 900; scene.fog.far = thermalSaved ? thermalSaved.fogF : 6200; }
    vehBodyMat.color.setRGB(1, 1, 1); vehHullMat.color.setRGB(1, 1, 1); vehHullMatPlayer.color.setRGB(1, 1, 1);
    if (typeof vehBodyMatPlayer !== 'undefined') vehBodyMatPlayer.color.setRGB(1, 1, 1);   // P0-2 companion:同上复原
    if (typeof vehInkMat !== 'undefined' && vehInkMat) vehInkMat.color.setHex(0x141610);
    wreckMat.color.setHex(0x2a2a2a); wreckMat.emissive.setHex(0x101010);   // vehicles_common 出厂值回填
    if (thermalSaved) {
      if (thermalSaved.gnd != null && typeof groundMatSea !== 'undefined' && groundMatSea) groundMatSea.color.setHex(thermalSaved.gnd);
      shellMatP.color.setHex(thermalSaved.shP); shellMatE.color.setHex(thermalSaved.shE);
    }
    if (moonDisc) moonDisc.material.color.setHex(0xffffff);
    if (moonGlow) moonGlow.material.opacity = 0.9;
    for (ci = 0; ci < starField.length; ci++) starField[ci].material.opacity = 0.95;
    if (sunDisc) sunDisc.material.color.setHex(0xfff8e6);              // buildSunDisc 出厂值
  }
  if (typeof comicSetThermal === 'function') comicSetThermal(thermalWas ? 1 : 0);
}
/* ===== 座车夜战设备缓存(部署/接管边沿一次,禁逐帧检测):
   夜视仪=基础坦克外全员;热成像=高阶主战坦克(vehicleHasNV/TH 设备表,core.js)。
   换乘无设备车时越权状态即时关断;触控键显隐同步(自定义编辑器内 custShow 全权接管,始终全量显示)。 ===== */
var playerHasNV = true, playerHasTH = true;
function playerEquipSync() {
  playerHasNV = !!(player && vehicleHasNV(player.kind, player.team));
  playerHasTH = !!(player && vehicleHasTH(player.kind, player.team));
  if (player && typeof vehicleTechThermalImagingInstalled === 'function') playerHasTH = playerHasTH || vehicleTechThermalImagingInstalled(player);
  if (!playerHasNV && nvOn) { nvOn = false; nvSync(); }
  if (!playerHasTH && thermalOn) { thermalOn = false; thermalSync(); }
  if (typeof window !== 'undefined' && window._touchUISync) window._touchUISync();   // 观瞄设备可用性变化 → 触控键即时随动
}
/* 连续时间应用:小时 h∈[0,24] → 太阳/月亮位置与外形大小 + 环境亮度/色调/光照方向。
   全部参数由 sunOfHour 连续插值(正午白 ↔ 低角度橙红 ↔ 深夜月光蓝),无档位跳变。 */
var _cA = new THREE.Color(), _cB = new THREE.Color();   // 色插值 scratch
function applyTimeOfDay(h) {
  timeHour = clamp(+h || 0, 0, 24);
  nightCombatOn = isNightOf(timeHour);                 // 夜战量随时刻同步(事件级:开局/像管复原时重算)
  var S = sunOfHour(timeHour);
  // 光照方向(太阳方位随小时旋转;玩家选蓝方时双方半场翻转,太阳水平向量同步旋转 180°)
  // ★position 唯一 owner=阴影视锥系统(world.js cameraUpdate 每帧写);本函数只写方向向量 sunOffset 与亮度/色调
  var dl = Math.sqrt(S.x * S.x + S.y * S.y + S.z * S.z);
  var skyFlip = spawnFlip < 0 ? -1 : 1;
  sunOffset.set(S.x / dl * skyFlip, S.y / dl, S.z / dl * skyFlip);
  // 太阳光色/强度:正午暖白 → 黄昏橙红 → 深夜月光冷蓝
  sunLight.color.copy(_cA.setRGB(1.00, 0.96, 0.85).lerp(_cB.setRGB(1.00, 0.55, 0.28), S.duskF)
    .lerp(_cB.setRGB(0.56, 0.66, 0.85), S.nightF));
  sunLight.intensity = (0.09 + S.dayL * (1.25 - 0.09)) * 0.8; // 对局光照降低20%亮度
  // 环境光:白天天蓝地绿 ↔ 黄昏紫 ↔ 深夜深蓝
  if (hemiLight) {
    hemiLight.color.copy(_cA.setRGB(0.81, 0.89, 1.00).lerp(_cB.setRGB(0.60, 0.52, 0.72), S.duskF)
      .lerp(_cB.setRGB(0.21, 0.28, 0.42), S.nightF));
    hemiLight.groundColor.copy(_cA.setRGB(0.33, 0.38, 0.25).lerp(_cB.setRGB(0.29, 0.25, 0.19), S.duskF)
      .lerp(_cB.setRGB(0.10, 0.13, 0.09), S.nightF));
    hemiLight.intensity = (0.30 + S.dayL * (0.85 - 0.30) + S.duskF * 0.10) * 0.8; // 环境光降低20%亮度
  }
  // 雾/背景:白天蓝灰 ↔ 黄昏橙褐 ↔ 深夜深蓝黑(背景=雾同一色,地平线无缝)
  if (scene.fog) scene.fog.color.copy(_cA.setRGB(0.56, 0.64, 0.72).lerp(_cB.setRGB(0.79, 0.57, 0.44), S.duskF)
    .lerp(_cB.setRGB(0.07, 0.10, 0.17), S.nightF));
  if (scene.background && scene.background.copy) scene.background.copy(_cA.setRGB(0.56, 0.64, 0.72).lerp(_cB.setRGB(0.79, 0.57, 0.44), S.duskF)
    .lerp(_cB.setRGB(0.04, 0.07, 0.13), S.nightF));   // 背景平色作兜底(NV/热像穹顶隐时透出;正常局中被渐变穹顶遮住)
  if (typeof updateSkyDome === 'function') updateSkyDome(S);   // R25-T5 渐变天空穹顶随时刻调色(天顶/地平线/辉光;日月位置不变)
  // 太阳盘:地平线上可见;低角度更橙红 + 放大(大气折射观感)
  if (sunDisc) {
    sunDisc.visible = S.sy > 0;
    sunDisc.material.opacity = 1;
    sunDisc.material.color.copy(_cA.setRGB(1.00, 0.97, 0.90).lerp(_cB.setRGB(1.00, 0.76, 0.48), S.duskF));
    var sc = 1 + (1 - S.dayL) * 0.3;                     // 低角度放大 ≤30%(正午原大)
    var w = SUN_CORE_DIA / SUN_TEX_CORE * sc;
    sunDisc.scale.set(w, w, 1);
    sunTrack();
  }
  // 月亮:太阳对跖点(恒满月);月盘大小恒定
  if (moonDisc) {
    moonDisc.visible = -S.sy > 0.02;
    moonTrack();
    if (moonGlow) moonGlow.visible = moonDisc.visible;   // 光晕随月亮同显隐
  }
  var isNight = isNightOf(timeHour);                        // 夜判统一口径(与 AI 黑夜模糊/星图同阈值)
  for (var stI = 0; stI < starField.length; stI++) starField[stI].visible = isNight;   // 星图仅夜间可见
  var tintC = _cA.setRGB(1, 1, 1).lerp(_cB.setRGB(0.87, 0.63, 0.45), S.duskF)
    .lerp(_cB.setRGB(0.17, 0.24, 0.35), S.nightF);
  for (var ci = 0; ci < clouds.length; ci++) {              // 云色 = 云基色 × 时态乘色
    clouds[ci].sp.material.color.setHex(clouds[ci].baseCol);
    clouds[ci].sp.material.color.multiply(tintC);
  }
  /* R25-T3 场景精灵(树/桩/花草丛及未来精灵)昼夜色调×亮度:unlit billboard 随时态与受光地面同步明暗。
     亮度 b:正午≈1 → 夜≈0.36(下限保剪影可读),黄昏再压一档;色相:白天中性→黄昏微暖→夜晚冷蓝(月光)。
     dayL/duskF/nightF 与 sunLight/hemiLight 同源=精灵与场景一起暗下去,不再夜间过亮。_billboardFogSync 每帧搬运。*/
  if (typeof SCENE_SPRITE_TINT !== 'undefined') {
    var _sb = (0.36 + 0.64 * S.dayL) * (1 - 0.10 * S.duskF) * 0.8; // 场景精灵同步降低20%亮度
    SCENE_SPRITE_TINT.copy(_cA.setRGB(1, 1, 1).lerp(_cB.setRGB(1.02, 0.92, 0.80), S.duskF)
      .lerp(_cB.setRGB(0.62, 0.72, 0.95), S.nightF)).multiplyScalar(_sb);
  }
  // 车灯仅使用现有 MeshBasic 顶点色自发亮:不创建 PointLight/SpotLight,不反射、不投射光锥、无后处理泛光,夜间开销仍为0新增draw call。
  vehGlowMat.color.setHex(0xffffff);                                   // 黑夜恢复灯罩本色发光;NVD开启时 nvSync 临时覆为暗绿
  // 战斗时刻(太阳方位/高度)变化 → 全量重烘焙地物阴影(方向/长度/浓淡随日重置;非动态,事件级一次)
  if (typeof bsRebakeAll === 'function') bsRebakeAll();
}
/* 时间拖动条(遭遇战参数):小时 0~24,默认 8 点(清晨);拖动实时重放光照(菜单背景即时预览) */
var startHour = 8;

/*
   Quick TO BATTLE defaults use finite, truncated normal distributions rather than
   a flat random draw.  Sigma is solved numerically against the existing UI step
   bins so the requested output bands contain the configured probability: roughness
   [-25,+25] within [-100,+100] keeps 1/2, while clock [07:00,14:00] within
   [00:00,24:00] uses 3/4.  The displayed intervals do not change.
   Rejection keeps every generated value inside the control range, while the normal
   density still favors the center of each range.
*/
function _quickErf(x) {
  var sign = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  var y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-a * a);
  return sign * y;
}
function _quickNormalCdf(x, mean, sigma) {
  return 0.5 * (1 + _quickErf((x - mean) / (Math.SQRT2 * sigma)));
}
function _quickTruncMass(min, max, innerMin, innerMax, mean, sigma) {
  var den = _quickNormalCdf(max, mean, sigma) - _quickNormalCdf(min, mean, sigma);
  var num = _quickNormalCdf(innerMax, mean, sigma) - _quickNormalCdf(innerMin, mean, sigma);
  return den > 0 ? num / den : 0;
}
function _quickSolveSigma(min, max, innerMin, innerMax, mean, targetMass) {
  targetMass = targetMass == null ? 0.5 : targetMass;
  var lo = 0.001, hi = Math.max(1, max - min);
  /* At a broad sigma the band mass is below targetMass; widen hi if needed. */
  while (_quickTruncMass(min, max, innerMin, innerMax, mean, hi) > targetMass && hi < 1e6) hi *= 2;
  for (var i = 0; i < 64; i++) {
    var mid = (lo + hi) * 0.5;
    if (_quickTruncMass(min, max, innerMin, innerMax, mean, mid) > targetMass) lo = mid;
    else hi = mid;
  }
  return (lo + hi) * 0.5;
}
function _quickGaussian() {
  var u = Math.max(1e-12, Math.random()), v = Math.max(1e-12, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}
function _quickTruncatedNormal(min, max, mean, sigma) {
  for (var i = 0; i < 256; i++) {
    var x = mean + sigma * _quickGaussian();
    if (x >= min && x <= max) return x;
  }
  return Math.max(min, Math.min(max, mean));
}
/* Half-step bin edges make the probability guarantees apply to the values actually
   sent to the range controls (roughness step=1, clock step=0.5 hour). */
var QUICK_ROUGH_SIGMA = _quickSolveSigma(-100, 100, -25.5, 25.5, 0, 0.5);
var QUICK_HOUR_SIGMA = _quickSolveSigma(0, 24, 6.75, 14.25, 10.5, 0.75);
function randomizeQuickBattleDefaults() {
  startRough = clamp(Math.round(_quickTruncatedNormal(-100, 100, 0, QUICK_ROUGH_SIGMA)), -100, 100);
  startHour = clamp(Math.round(_quickTruncatedNormal(0, 24, 10.5, QUICK_HOUR_SIGMA) * 2) / 2, 0, 24);
  if (typeof el !== 'undefined' && el) {
    if (el.roughinput) el.roughinput.value = startRough;
    if (el.roughval) el.roughval.textContent = startRough > 0 ? '+' + startRough : String(startRough);
    if (el.hourinput) el.hourinput.value = startHour;
    if (el.hourval) el.hourval.textContent = hourLabel(startHour);
  }
  return { rough: startRough, hour: startHour };
}
function bindStartHourUI() {
  if (!el.hourinput) return;
  el.hourinput.value = startHour;
  function syncHour(persist) {
    var hv = +el.hourinput.value;
    startHour = clamp(isFinite(hv) ? Math.round(hv * 2) / 2 : 8, 0, 24);
    el.hourinput.value = startHour;
    if (el.hourval) el.hourval.textContent = hourLabel(startHour);
    if (typeof applyTimeOfDay === 'function') applyTimeOfDay(startHour);   // 实时预览太阳/月亮/光照与阴影
    if (persist && typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
  }
  el.hourinput.addEventListener('input', function () { syncHour(true); });
  el.hourinput.addEventListener('change', function () { syncHour(true); });
  syncHour(false);
}

/* 地图参数(遭遇战参数):
   材质保留 grass 默认值供旧存档和地形接口兼容，菜单不再暴露材质切换;
   种子=6 位随机(不再手输:点开"遭遇战"按钮时重新随机,见 buildMenuButtons;
   同种子+同参数 → 地形逐位可复现);
   崎岖度 -100~+100(0=平坦;+100=连绵山地≈+26m;-100=盆地≈-26m);
   团队死斗默认边长 6000m，个人死斗默认边长 3500m(均可在团队参数面板自定义)。地形=种子+崎岖度+边长。
   三兵种大本营(坦克/炮兵/直升机)距地图中心默认 1000/3000/6000m,上限=边长一半(落位再贴进活动边界 15m);
   此处配的是纵深 z,同兵种的左/中/右三座基地共用该纵深,横向按战线三等分铺开(见 spawnTeams)。 */
var startMat = 'grass';
function randomSeed() { return String(100000 + Math.floor(Math.random() * 900000)); }   // 遭遇战地图种子:6 位随机
var startSeed = randomSeed();   // 初始随机;点开"遭遇战"按钮时重新随机
var startRough = 25;
var startMatchTime = 15;        // 对局时间(分钟;默认15分钟)
var startMapLen = isFfaMode() ? FFA_DEFAULT_MAP_SIZE : 6000;  // 团队死斗默认6000m；个人死斗默认3500m
var startMapWid = isFfaMode() ? FFA_DEFAULT_MAP_SIZE : 6000;
var startMapSize = isFfaMode() ? FFA_DEFAULT_MAP_SIZE : 6000;   // 兼容旧口径
var startBaseDist = { tank: 500, arty: 1500, heli: 3000, aa: 900 };

/* ===== 自定义战斗配置持久化 =====
   The quick TO BATTLE path deliberately does not write this snapshot.  Its random
   clock/roughness and hangar selection are temporary match inputs; DEPLOY restores
   this independent record before rebuilding the custom menu. */
/* Do not include the word "custom" in this key: the legacy garage-cache
   cleanup intentionally removes old keys containing that substring. */
var CUSTOM_BATTLE_STORAGE_KEY = 'armoredCorps.battleSettings.v1';
function _customBattleOwn(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
function _customBattleNumber(v, fallback, min, max, integer) {
  var n = +v;
  if (!isFinite(n)) n = fallback;
  if (integer) n = Math.round(n);
  if (min != null) n = Math.max(min, n);
  if (max != null) n = Math.min(max, n);
  return n;
}
function _customBattleVehicleKindValid(k) {
  if (typeof VEHICLE_KINDS === 'undefined' || !VEHICLE_KINDS) return false;
  for (var i = 0; i < VEHICLE_KINDS.length; i++) if (VEHICLE_KINDS[i].kind === k) return true;
  return false;
}
function _customBattleRosterSnapshot(S) {
  var out = {}, src = S && S.roster ? S.roster : {};
  if (typeof VEHICLE_KINDS !== 'undefined' && VEHICLE_KINDS) {
    for (var i = 0; i < VEHICLE_KINDS.length; i++) {
      var k = VEHICLE_KINDS[i].kind;
      out[k] = _customBattleNumber(src[k], 0, 0, 2000, true);
    }
  } else {
    for (var key in src) if (_customBattleOwn(src, key)) out[key] = _customBattleNumber(src[key], 0, 0, 2000, true);
  }
  return out;
}
function _customBattleRestoreRoster(S, saved) {
  if (!S || !saved || typeof saved !== 'object') return;
  if (_customBattleOwn(saved, 'pool')) S.pool = _customBattleNumber(saved.pool, S.pool || 0, 0, 2000, true);
  if (_customBattleOwn(saved, 'cap')) S.cap = _customBattleNumber(saved.cap, S.cap || 0, 0, 2000, true);
  if (saved.roster && typeof saved.roster === 'object') {
    for (var i = 0; i < VEHICLE_KINDS.length; i++) {
      var k = VEHICLE_KINDS[i].kind;
      if (_customBattleOwn(saved.roster, k)) S.roster[k] = _customBattleNumber(saved.roster[k], S.roster[k] || 0, 0, 2000, true);
    }
  }
  /* bindStartSetupUI creates a fresh baseline from this restored roster. */
  S.rosterBase = {};
}
function saveCustomBattleSettings() {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  var data = {
    version: 2,
    mode: currentGameMode === GAME_MODE_FFA ? GAME_MODE_FFA : GAME_MODE_TEAM,
    side: startSide === 'red' ? 'red' : 'blue',
    kind: startKind,
    material: startMat === 'soil' ? 'soil' : 'grass',
    spectate: !!(typeof spectateEnabled !== 'undefined' && spectateEnabled),
    roughness: _customBattleNumber(startRough, 25, -100, 100, true),
    hour: _customBattleNumber(startHour, 8, 0, 24, false),
    matchTime: _customBattleNumber(startMatchTime, 15, 1, 60, true),
    map: {
      length: _customBattleNumber(startMapLen, isFfaMode() ? FFA_DEFAULT_MAP_SIZE : 6000, 100, 100000, true),
      width: _customBattleNumber(startMapWid, isFfaMode() ? FFA_DEFAULT_MAP_SIZE : 6000, 100, 100000, true)
    },
    baseDistance: {
      tank: _customBattleNumber(startBaseDist.tank, 500, 0, 100000, true),
      arty: _customBattleNumber(startBaseDist.arty, 1500, 0, 100000, true),
      heli: _customBattleNumber(startBaseDist.heli, 3000, 0, 100000, true),
      aa: _customBattleNumber(startBaseDist.aa, 900, 0, 100000, true)
    },
    ffa: {
      vehicleCount: _customBattleNumber(FFA_SETUP.vehicleCount, 100, 2, 200, true),
      playerReserves: _customBattleNumber(FFA_SETUP.playerReserves, 3, 0, 50, true),
      heliEnabled: !!FFA_SETUP.heliEnabled,
      powerupMultiplier: _customBattleNumber(FFA_SETUP.powerupMultiplier, FFA_DEFAULT_POWERUP_MULTIPLIER, 0, 4, false)
    },
    tdm: {
      controlZones: tdmControlZonesEnabled !== false,
      red: { pool: _customBattleNumber(BATTLE_SETUP.red.pool, CONF.startPool, 0, 2000, true),
        cap: _customBattleNumber(BATTLE_SETUP.red.cap, defaultCap('red'), 0, 2000, true), roster: _customBattleRosterSnapshot(BATTLE_SETUP.red) },
      blue: { pool: _customBattleNumber(BATTLE_SETUP.blue.pool, CONF.startPool, 0, 2000, true),
        cap: _customBattleNumber(BATTLE_SETUP.blue.cap, defaultCap('blue'), 0, 2000, true), roster: _customBattleRosterSnapshot(BATTLE_SETUP.blue) }
    }
  };
  try {
    window.localStorage.setItem(CUSTOM_BATTLE_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e) { return false; }
}
function refreshCustomBattleControls() {
  if (typeof el === 'undefined' || !el) return;
  if (el.timeinput) { el.timeinput.value = startMatchTime; if (el.timeval) el.timeval.textContent = startMatchTime + ' 分钟'; }
  if (el.roughinput) { el.roughinput.value = startRough; if (el.roughval) el.roughval.textContent = startRough > 0 ? '+' + startRough : String(startRough); }
  if (el.hourinput) { el.hourinput.value = startHour; if (el.hourval) el.hourval.textContent = hourLabel(startHour); }
  if (typeof applyTimeOfDay === 'function') applyTimeOfDay(startHour);
  if (el.leninput) el.leninput.value = startMapLen;
  if (el.widinput) el.widinput.value = startMapWid;
  if (el.sizeinput) el.sizeinput.value = startMapLen;
  if (el.bdinput_tank) el.bdinput_tank.value = startBaseDist.tank;
  if (el.bdinput_arty) el.bdinput_arty.value = startBaseDist.arty;
  if (el.bdinput_heli) el.bdinput_heli.value = startBaseDist.heli;
  if (el.siderow) markSel(el.siderow, 'data-side', startSide);
  if (el.skrow) markSel(el.skrow, 'data-k', startKind);
  refreshStartControlZonesUI();
  if (typeof refreshSpectateUI === 'function') refreshSpectateUI();
}
function refreshCustomBattlePanel() {
  /* This is the single post-restore sync point for the custom battle panel.
     Keep it after all dynamic rows are rebuilt; the static sliders are updated
     here, while bindStartSetupUI creates the roster controls from BATTLE_SETUP. */
  refreshCustomBattleControls();
  if (typeof refreshVehicleChoiceLabels === 'function') refreshVehicleChoiceLabels();
  if (el && el.siderow) markSel(el.siderow, 'data-side', startSide);
  if (el && el.skrow) {
    markSel(el.skrow, 'data-k', startKind);
    if (isFfaMode()) {
      var _customKindButtons = el.skrow.querySelectorAll('button');
      for (var _customKindI = 0; _customKindI < _customKindButtons.length; _customKindI++) {
        _customKindButtons[_customKindI].classList.toggle('sel',
          _customKindButtons[_customKindI].getAttribute('data-k') === startKind &&
          _customKindButtons[_customKindI].getAttribute('data-side') === startSide);
      }
    }
  }
  if (typeof refreshGameModeUI === 'function') refreshGameModeUI();
  if (typeof refreshStartControlZonesUI === 'function') refreshStartControlZonesUI();
}
function loadCustomBattleSettings(applyMode) {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  var raw = null, data = null;
  try { raw = window.localStorage.getItem(CUSTOM_BATTLE_STORAGE_KEY); data = raw ? JSON.parse(raw) : null; } catch (e) { data = null; }
  if (!data || typeof data !== 'object') return false;

  if (data.mode === GAME_MODE_FFA || data.mode === GAME_MODE_TEAM) {
    if (applyMode) currentGameMode = data.mode;
  }
  if (data.side === 'red' || data.side === 'blue') startSide = data.side;
  if (_customBattleVehicleKindValid(data.kind)) startKind = data.kind;
  if (data.material === 'grass' || data.material === 'soil') startMat = data.material;
  if (_customBattleOwn(data, 'spectate') && typeof spectateEnabled !== 'undefined') spectateEnabled = !!data.spectate;
  startRough = _customBattleNumber(data.roughness, startRough, -100, 100, true);
  startHour = Math.round(_customBattleNumber(data.hour, startHour, 0, 24, false) * 2) / 2;
  startMatchTime = _customBattleNumber(data.matchTime, startMatchTime, 1, 60, true);
  if (data.map && typeof data.map === 'object') {
    startMapLen = _customBattleNumber(data.map.length, startMapLen, 100, 100000, true);
    startMapWid = _customBattleNumber(data.map.width, startMapWid, 100, 100000, true);
    startMapSize = Math.max(startMapLen, startMapWid);
  }
  if (data.baseDistance && typeof data.baseDistance === 'object') {
    startBaseDist.tank = _customBattleNumber(data.baseDistance.tank, startBaseDist.tank, 0, 100000, true);
    startBaseDist.arty = _customBattleNumber(data.baseDistance.arty, startBaseDist.arty, 0, 100000, true);
    startBaseDist.heli = _customBattleNumber(data.baseDistance.heli, startBaseDist.heli, 0, 100000, true);
    startBaseDist.aa = _customBattleNumber(data.baseDistance.aa, startBaseDist.aa, 0, 100000, true);
  }
  if (data.ffa && typeof data.ffa === 'object') {
    FFA_SETUP.vehicleCount = _customBattleNumber(data.ffa.vehicleCount, FFA_SETUP.vehicleCount || 100, 2, 200, true);
    FFA_SETUP.playerReserves = _customBattleNumber(data.ffa.playerReserves, FFA_SETUP.playerReserves || 3, 0, 50, true);
    if (_customBattleOwn(data.ffa, 'heliEnabled')) FFA_SETUP.heliEnabled = !!data.ffa.heliEnabled;
    /* A record written before the slider existed has no multiplier: retain the
       historical aliveN × 2 compatibility rule instead of silently changing it. */
    var savedPowerupMultiplier = data.ffa.powerupMultiplier;
    var savedBattleVersion = isFinite(+data.version) ? +data.version : 1;
    /* v1 used 2.5 as the menu default. Migrate that old implicit default to the
       corrected 2× default; explicit values other than 2.5 remain untouched. */
    if (savedBattleVersion < 2 && +savedPowerupMultiplier === 2.5) savedPowerupMultiplier = 2;
    FFA_SETUP.powerupMultiplier = _customBattleNumber(
      savedPowerupMultiplier, FFA_DEFAULT_POWERUP_MULTIPLIER, 0, 4, false);
  } else {
    /* A legacy custom snapshot without an FFA block has no explicit multiplier. */
    FFA_SETUP.powerupMultiplier = 2;
  }
  if (data.tdm && typeof data.tdm === 'object') {
    if (_customBattleOwn(data.tdm, 'controlZones')) tdmControlZonesEnabled = data.tdm.controlZones !== false;
    _customBattleRestoreRoster(BATTLE_SETUP.red, data.tdm.red);
    _customBattleRestoreRoster(BATTLE_SETUP.blue, data.tdm.blue);
  }
  refreshCustomBattleControls();
  return true;
}
function resetCustomBattleDefaults() {
  startRough = 25;
  startHour = 8;
  startMatchTime = 15;
  startMat = 'grass';
  startMapLen = isFfaMode() ? FFA_DEFAULT_MAP_SIZE : 6000;
  startMapWid = startMapLen;
  startMapSize = startMapLen;
  startBaseDist = { tank: 500, arty: 1500, heli: 3000, aa: 900 };
  FFA_SETUP.vehicleCount = 100;
  FFA_SETUP.playerReserves = 3;
  FFA_SETUP.heliEnabled = false;
  FFA_SETUP.powerupMultiplier = FFA_DEFAULT_POWERUP_MULTIPLIER;
  tdmControlZonesEnabled = true;
  if (typeof spectateEnabled !== 'undefined') spectateEnabled = false;
  refreshCustomBattleControls();
}
function syncModeMapDefault(mode) {
  var size = mode === GAME_MODE_FFA ? FFA_DEFAULT_MAP_SIZE : 6000;
  startMapLen = size; startMapWid = size; startMapSize = size;
  if (typeof el !== 'undefined' && el) {
    if (el.leninput) el.leninput.value = size;
    if (el.widinput) el.widinput.value = size;
    if (el.sizeinput) el.sizeinput.value = size;
    // 个人死斗不消费大本营距离；仅同步输入上限，避免 FFA↔TDM 切换污染 TDM 自定义值。
    var baseMax = Math.floor(size / 2);
    [['tank', el.bdinput_tank], ['arty', el.bdinput_arty], ['heli', el.bdinput_heli]].forEach(function (b) {
      if (b[1]) b[1].max = baseMax;
    });
  }
}
/* 三兵种大本营纵深(同兵种三翼共用;遭遇战地图卡可改,spawnTeams 落位消费)
   团队死斗默认边长 6000m 时上限=长/2=3000；个人死斗不消费这些参数。 */
function refreshStartControlZonesUI() {
  if (!el || !el.stylerow || typeof el.stylerow.querySelectorAll !== 'function') return;
  var value = tdmControlZonesEnabled === false ? 'off' : 'on';
  markSel(el.stylerow, 'data-control-zones', value);
  var disabled = typeof isFfaMode === 'function' && isFfaMode();
  var controlRow = el.stylerow.parentElement;
  if (controlRow && controlRow.classList) {
    controlRow.classList.toggle('hidden', disabled);
    controlRow.setAttribute('aria-hidden', disabled ? 'true' : 'false');
  }
  var buttons = el.stylerow.querySelectorAll('button[data-control-zones]');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].disabled = disabled;
    buttons[i].classList.toggle('dim', disabled);
    buttons[i].setAttribute('aria-disabled', disabled ? 'true' : 'false');
  }
}
function bindStartControlZonesUI() {
  if (!el.stylerow || typeof el.stylerow.querySelectorAll !== 'function') return;
  bindOptionRow(el.stylerow, [
    { text: '开', attrs: { 'control-zones': 'on' }, sel: tdmControlZonesEnabled !== false },
    { text: '关', attrs: { 'control-zones': 'off' }, sel: tdmControlZonesEnabled === false }
  ], function (b) {
    if (typeof isFfaMode === 'function' && isFfaMode()) return;
    tdmControlZonesEnabled = b.getAttribute('data-control-zones') !== 'off';
    refreshStartControlZonesUI();
    if (typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
  });
  refreshStartControlZonesUI();
}
function bindStartMapUI() {
  if (el.timeinput) {
    el.timeinput.value = startMatchTime;
    function syncTime(persist) {
      startMatchTime = Math.max(1, Math.min(60, Math.round(+el.timeinput.value) || 15));
      el.timeinput.value = startMatchTime;
      if (el.timeval) el.timeval.textContent = startMatchTime + ' 分钟';
      if (persist && typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
    }
    el.timeinput.addEventListener('input', function () { syncTime(true); });
    el.timeinput.addEventListener('change', function () { syncTime(true); });
    syncTime(false);
  }

  if (el.roughinput) {
    function syncRough(persist) {
      startRough = clamp(Math.round(+el.roughinput.value || 0), -100, 100);
      el.roughinput.value = startRough;
      if (el.roughval) el.roughval.textContent = startRough > 0 ? '+' + startRough : String(startRough);
      if (persist && typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
    }
    el.roughinput.addEventListener('input', function () { syncRough(true); });
    el.roughinput.addEventListener('blur', function () { syncRough(true); });
    el.roughinput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { syncRough(true); el.roughinput.blur(); } });
    syncRough(false);
  }

  // 三型大本营距离: 上限 = 战场长度一半(纵深规则), 边长变化后自动重新钳制
  var bdInputs = [['tank', el.bdinput_tank], ['arty', el.bdinput_arty], ['heli', el.bdinput_heli]];
  function syncBaseDist(persist) {
    var halfCap = Math.floor(startMapLen / 2);
    bdInputs.forEach(function (b) {
      var key = b[0], inp = b[1];
      if (!inp) return;
      inp.max = halfCap;
      if (isFfaMode()) return; // FFA 不创建/显示/使用大本营距离，也不改写 TDM 的自定义值。
      var v = clamp(Math.round(+inp.value || 0), 0, halfCap);
      startBaseDist[key] = v;
      inp.value = v;
    });
    if (persist && typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
  }
  bdInputs.forEach(function (b) {
    if (!b[1]) return;
    b[1].addEventListener('blur', function () { syncBaseDist(true); });
    b[1].addEventListener('keydown', function (e) { if (e.key === 'Enter') { syncBaseDist(true); b[1].blur(); } });
  });

  var lenInp = el.leninput || el.sizeinput;
  var widInp = el.widinput;

  function syncLen(persist) {
    var prev = startMapLen;
    startMapLen = Math.max(100, Math.round(+(lenInp ? lenInp.value : 6000)) || 6000);
    startMapSize = Math.max(startMapLen, startMapWid);
    if (lenInp) lenInp.value = startMapLen;
    if (el.sizeinput && el.sizeinput !== lenInp) el.sizeinput.value = startMapLen;
    if (startMapLen !== prev) {
      var ratio = prev > 0 ? startMapLen / prev : 1;
      bdInputs.forEach(function (b) {
        if (!b[1]) return;
        b[1].value = Math.round((+b[1].value || 0) * ratio);
      });
    }
    syncBaseDist(false);
    if (persist && typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
  }

  function syncWid(persist) {
    startMapWid = Math.max(100, Math.round(+(widInp ? widInp.value : 6000)) || 6000);
    startMapSize = Math.max(startMapLen, startMapWid);
    if (widInp) widInp.value = startMapWid;
    if (persist && typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
  }

  if (lenInp) {
    lenInp.value = startMapLen;
    lenInp.addEventListener('blur', function () { syncLen(true); });
    lenInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { syncLen(true); lenInp.blur(); } });
  }
  if (widInp) {
    widInp.value = startMapWid;
    widInp.addEventListener('blur', function () { syncWid(true); });
    widInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { syncWid(true); widInp.blur(); } });
  }
  syncLen(false);
  syncWid(false);
}
/* 遭遇战编制配置(通用化):红/蓝独立——参战兵力/最大在场/各型号数量;
   型号数量输入遍历 VEHICLE_KINDS 自动生成(新增型号自动出现);
   默认=BATTLE_SETUP(当前方案:50 兵力/54 在场;红 18+18+10+4+4,蓝 18+28+4+4);值直接写入 BATTLE_SETUP(开局 spawnTeams 消费) */
/* 通用载具编制自适应分配算法:
   支持任意载具种类/直升机/未来新增载具自动适配;
   算法数学保证:细分出场载具的上限之和严格恒等于最大在场载具数量 (sum(roster) === S.cap) */

function getAllowedTeamVehicleKinds(tm) {
  var kinds = [];
  for (var i = 0; i < VEHICLE_KINDS.length; i++) {
    var k = VEHICLE_KINDS[i].kind;
    if (vehicleKindAllowed(tm, k)) kinds.push(k);
  }
  return kinds;
}

/* 当最大在场载具数改变时,按比例自适应缩放所有细分载具数量 */
function scaleRosterToCap(S, tm) {
  if (!S || !S.roster) return;
  var allowed = getAllowedTeamVehicleKinds(tm || 'red');
  if (allowed.length === 0) return;

  // 严格清除非本阵营载具配额,杜绝幽灵配额
  for (var vi = 0; vi < VEHICLE_KINDS.length; vi++) {
    var vk = VEHICLE_KINDS[vi].kind;
    if (allowed.indexOf(vk) < 0) S.roster[vk] = 0;
  }

  var targetCap = Math.max(0, Math.round(S.cap || 0));
  S.cap = targetCap;

  var base = S.rosterBase || S.roster;
  var baseTotal = 0;
  for (var j = 0; j < allowed.length; j++) {
    baseTotal += Math.max(0, base[allowed[j]] || 0);
  }

  if (baseTotal <= 0) {
    var each = Math.floor(targetCap / allowed.length);
    var rem0 = targetCap - each * allowed.length;
    for (var a = 0; a < allowed.length; a++) {
      S.roster[allowed[a]] = each + (a < rem0 ? 1 : 0);
    }
  } else {
    // 最大余数法 (Largest Remainder Method) 自适应分配
    var rem = targetCap;
    var fr = [];
    for (var b = 0; b < allowed.length; b++) {
      var kind = allowed[b];
      var raw = ((Math.max(0, base[kind] || 0)) * targetCap) / baseTotal;
      var v = Math.floor(raw);
      S.roster[kind] = v;
      rem -= v;
      fr.push({ kind: kind, frac: raw - v });
    }
    fr.sort(function (x, y) { return y.frac - x.frac; });
    for (var c = 0; c < fr.length && rem > 0; c++) {
      S.roster[fr[c].kind]++;
      rem--;
    }
  }

  // 闭环约束:细分载具之和严格等于最大在场载具数量
  var curSum = 0;
  for (var d = 0; d < allowed.length; d++) curSum += S.roster[allowed[d]] || 0;
  if (curSum !== targetCap && allowed.length > 0) {
    S.roster[allowed[0]] = Math.max(0, (S.roster[allowed[0]] || 0) + (targetCap - curSum));
  }

  // 更新快照基线并同步 UI
  syncRosterBaseline(S, allowed);
}

/* 当用户直接修改某一载具数量时,自适应调整其余细分载具,保证总和恒等于最大在场载具数 */
/* 编成基线回写:把当前 roster 快照为基线,并刷新对应输入框。
   基线用于判定"用户最近直接改的是哪一项" —— 自适应分配只动非基线项。 */
function syncRosterBaseline(S, allowed) {
if (!S.rosterBase) S.rosterBase = {};
  for (var u = 0; u < allowed.length; u++) {
    var uk = allowed[u];
    S.rosterBase[uk] = S.roster[uk];
    if (S.ins && S.ins[uk]) S.ins[uk].value = S.roster[uk];
  }
}

function adjustOtherVehiclesToFit(S, tm, editedKind, newVal) {
  var allowed = getAllowedTeamVehicleKinds(tm || 'red');
  if (allowed.length === 0) return;

  var targetCap = Math.max(0, Math.round(S.cap || 0));
  var clampedVal = Math.max(0, Math.min(targetCap, Math.round(newVal || 0)));
  S.roster[editedKind] = clampedVal;

  var otherAllowed = [];
  for (var i = 0; i < allowed.length; i++) {
    if (allowed[i] !== editedKind) otherAllowed.push(allowed[i]);
  }

  var otherTarget = targetCap - clampedVal;
  if (otherAllowed.length > 0) {
    var otherBase = S.rosterBase || S.roster;
    var otherTotal = 0;
    for (var j = 0; j < otherAllowed.length; j++) {
      otherTotal += Math.max(0, otherBase[otherAllowed[j]] || 0);
    }

    if (otherTotal <= 0) {
      var each = Math.floor(otherTarget / otherAllowed.length);
      var rem0 = otherTarget - each * otherAllowed.length;
      for (var a = 0; a < otherAllowed.length; a++) {
        S.roster[otherAllowed[a]] = each + (a < rem0 ? 1 : 0);
      }
    } else {
      var rem = otherTarget;
      var fr = [];
      for (var b = 0; b < otherAllowed.length; b++) {
        var k = otherAllowed[b];
        var raw = ((Math.max(0, otherBase[k] || 0)) * otherTarget) / otherTotal;
        var v = Math.floor(raw);
        S.roster[k] = v;
        rem -= v;
        fr.push({ kind: k, frac: raw - v });
      }
      fr.sort(function (x, y) { return y.frac - x.frac; });
      for (var c = 0; c < fr.length && rem > 0; c++) {
        S.roster[fr[c].kind]++;
        rem--;
      }
    }

    var checkSum = clampedVal;
    for (var d = 0; d < otherAllowed.length; d++) checkSum += S.roster[otherAllowed[d]] || 0;
    if (checkSum !== targetCap) {
      S.roster[otherAllowed[0]] = Math.max(0, (S.roster[otherAllowed[0]] || 0) + (targetCap - checkSum));
    }
  }

  // 同步基线与所有输入框
  syncRosterBaseline(S, allowed);
}

function bindStartSetupUI() {
  if (!el.setuproot || typeof document === 'undefined') return;
  el.setuproot.innerHTML = '';
  if (isFfaMode()) {
    var fbox = document.createElement('div');
    fbox.className = 'setupcard ffa-setupcard';
    var ft = document.createElement('div'); ft.className = 'setupcard-t'; ft.textContent = '自由混战编制'; fbox.appendChild(ft);
    function ffaRow(label, input, note, output) {
      var rr = document.createElement('div'); rr.className = 'srow';
      var ll = document.createElement('span'); ll.textContent = label; rr.appendChild(ll); rr.appendChild(input);
      if (output) rr.appendChild(output);
      if (note) { var nn = document.createElement('small'); nn.textContent = note; rr.appendChild(nn); }
      fbox.appendChild(rr);
    }
    var activeIn = document.createElement('input');
    activeIn.type = 'number'; activeIn.min = 2; activeIn.max = 200; activeIn.value = FFA_SETUP.vehicleCount;
    var reserveIn = document.createElement('input');
    reserveIn.type = 'number'; reserveIn.min = 0; reserveIn.max = 50; reserveIn.value = FFA_SETUP.playerReserves;
    var heliIn = document.createElement('select');
    heliIn.className = 'ffa-heli-select';
    [['0', '禁用'], ['1', '启用']].forEach(function (opt) {
      var o = document.createElement('option'); o.value = opt[0]; o.textContent = opt[1]; heliIn.appendChild(o);
    });
    heliIn.value = FFA_SETUP.heliEnabled ? '1' : '0';
    var powerIn = document.createElement('input');
    powerIn.type = 'range'; powerIn.min = 0; powerIn.max = 4; powerIn.step = 0.1;
    powerIn.className = 'ffa-powerup-slider';
    powerIn.value = isFinite(+FFA_SETUP.powerupMultiplier) ? Math.max(0, Math.min(4, +FFA_SETUP.powerupMultiplier)) : FFA_DEFAULT_POWERUP_MULTIPLIER;
    var powerOut = document.createElement('output');
    powerOut.className = 'ffa-powerup-value';
    function powerupMultiplierLabel(v) {
      var n = Math.round(v * 10) / 10;
      return (n % 1 === 0 ? String(n.toFixed(0)) : n.toFixed(1)) + '×';
    }
    powerOut.textContent = powerupMultiplierLabel(+powerIn.value);
    // 只保留数值/开关控件本身，不再在人数与备用载具后附加说明文字。
    ffaRow('在场载具数', activeIn);
    ffaRow('玩家备用载具', reserveIn);
    ffaRow('直升机', heliIn);
    ffaRow('补给道具密度', powerIn, '每名幸存者', powerOut);
    function syncFfaSetup(refreshKinds) {
      FFA_SETUP.vehicleCount = clamp(Math.round(+activeIn.value || 100), 2, 200);
      FFA_SETUP.playerReserves = clamp(Math.round(+reserveIn.value || 0), 0, 50);
      FFA_SETUP.heliEnabled = heliIn.value === '1';
      var pm = +powerIn.value;
      FFA_SETUP.powerupMultiplier = isFinite(pm) ? Math.round(clamp(pm, 0, 4) * 10) / 10 : FFA_DEFAULT_POWERUP_MULTIPLIER;
      activeIn.value = FFA_SETUP.vehicleCount; reserveIn.value = FFA_SETUP.playerReserves;
      powerIn.value = FFA_SETUP.powerupMultiplier;
      powerOut.textContent = powerupMultiplierLabel(FFA_SETUP.powerupMultiplier);
      // 关闭直升机时从开局载具选择行移除直升机；开启后恢复全部登记型号。
      if (refreshKinds && typeof bindStartKindUI === 'function' && isFfaMode()) bindStartKindUI(true);
      if (typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
    }
    activeIn.addEventListener('input', function () { syncFfaSetup(true); });
    activeIn.addEventListener('change', function () { syncFfaSetup(true); });
    reserveIn.addEventListener('input', function () { syncFfaSetup(true); });
    reserveIn.addEventListener('change', function () { syncFfaSetup(true); });
    heliIn.addEventListener('change', function () { syncFfaSetup(true); });
    powerIn.addEventListener('input', function () { syncFfaSetup(false); });
    powerIn.addEventListener('change', function () { syncFfaSetup(false); });
    el.setuproot.appendChild(fbox);
    return;
  }

  ['red', 'blue'].forEach(function (tm) {
    var S = BATTLE_SETUP[tm];
    S.ins = {};
    S.rosterBase = {}; // 基线快照:用户最近直接输入的配置
    var allowed = getAllowedTeamVehicleKinds(tm);
    for (var bi = 0; bi < allowed.length; bi++) S.rosterBase[allowed[bi]] = S.roster[allowed[bi]];

    var box = document.createElement('div');
    box.className = 'setupcard';
    var title = document.createElement('div');
    title.className = 'setupcard-t';
    title.textContent = tm === 'red' ? '红方编制' : '蓝方编制';
    box.appendChild(title);

    function row(label, inp) {
      var r2 = document.createElement('div');
      r2.className = 'srow';
      var lb = document.createElement('span');
      lb.textContent = label;
      r2.appendChild(lb);
      r2.appendChild(inp);
      box.appendChild(r2);
    }

    var pIn = document.createElement('input'); pIn.type = 'number'; pIn.min = 0; pIn.max = 2000; pIn.value = S.pool;
    row('参战兵力', pIn);
    var cIn = document.createElement('input'); cIn.type = 'number'; cIn.min = 0; cIn.max = 2000; cIn.value = S.cap;
    S.ins.cap = cIn;
    row('最大在场载具数', cIn);

    VEHICLE_KINDS.forEach(function (vk) {
      if (!vehicleKindAllowed(tm, vk.kind)) return;
      var kIn = document.createElement('input');
      kIn.type = 'number'; kIn.min = 0; kIn.max = 2000; kIn.value = S.roster[vk.kind];
      row(vehicleKindName(tm, vk.kind), kIn);
      S.ins[vk.kind] = kIn;
      kIn.addEventListener('input', function () {
        adjustOtherVehiclesToFit(S, tm, vk.kind, +kIn.value || 0);
        if (typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
      });
    });

    pIn.addEventListener('input', function () {
      S.pool = clamp(Math.round(+pIn.value || 0), 0, 2000);
      if (typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
    });
    cIn.addEventListener('input', function () {
      S.cap = clamp(Math.round(+cIn.value || 0), 0, 2000);
      scaleRosterToCap(S, tm);
      if (typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
    });
    el.setuproot.appendChild(box);
  });
}
/* 开局阵营二选一:特殊装甲槽按阵营显示真实平台名——红方红方歼击车、蓝方BLUE_MBT_2;data-k='td'仅作内部兼容键。 */
function bindStartSideUI() {
  if (!el.siderow || typeof el.siderow.querySelectorAll !== 'function') return;
  bindOptionRow(el.siderow, [   // 阵营二选一(红方红方歼击车/蓝方BLUE_MBT_2 文本由 refreshVehicleChoiceLabels 刷新)
    { text: 'RED', attrs: { side: 'red' }, sel: startSide === 'red' },
    { text: 'BLUE', attrs: { side: 'blue' }, sel: startSide === 'blue' }
  ], function (b) {
    startSide = b.getAttribute('data-side') || 'red';
    markSel(el.siderow, 'data-side', startSide);
    refreshVehicleChoiceLabels();                    // 红方显示红方歼击车,蓝方显示BLUE_MBT_2
    if (typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
  });
}
/* 开局载具:团队死斗按当前阵营；个人死斗把注册表中的红/蓝平台平铺为可选项。 */
function bindStartKindUI(force) {
  if (!el.skrow || typeof el.skrow.querySelectorAll !== 'function') return;
  if (force) el.skrow.innerHTML = '';
  var rows = [], ri;
  if (isFfaMode()) {
    for (ri = 0; ri < VEHICLE_KINDS.length; ri++) {
      var vkF = VEHICLE_KINDS[ri];
      if (!FFA_SETUP.heliEnabled && (vkF.kind === 'ah64' || vkF.kind === 'wz10')) continue;
      for (var ti = 0; ti < 2; ti++) {
        var tmF = ti ? 'blue' : 'red';
        if (vkF.sides && !vkF.sides[tmF]) continue;
        rows.push({ text: vehicleKindName(tmF, vkF.kind), attrs: { k: vkF.kind, side: tmF },
                    sel: startKind === vkF.kind && startSide === tmF });
      }
    }
  } else {
    for (ri = 0; ri < VEHICLE_KINDS.length; ri++)
      rows.push({ text: vehicleKindName('red', VEHICLE_KINDS[ri].kind), attrs: { k: VEHICLE_KINDS[ri].kind },
                  sel: startKind === VEHICLE_KINDS[ri].kind });
  }
  bindOptionRow(el.skrow, rows, function (b) {
    startKind = b.getAttribute('data-k');
    if (isFfaMode()) startSide = b.getAttribute('data-side') || startSide;
    markSel(el.skrow, 'data-k', startKind);
    if (isFfaMode()) {
      var bs = el.skrow.querySelectorAll('button');
      for (var bi = 0; bi < bs.length; bi++)
        bs[bi].classList.toggle('sel', bs[bi].getAttribute('data-k') === startKind && bs[bi].getAttribute('data-side') === startSide);
    }
    if (typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
  });
}

// 重新部署界面(死亡后弹出;战斗照常进行,不暂停)
function bindFfaRespawnChoices() {
  if (!el.rkindrow || typeof ffaCurrentVehicleOptions !== 'function') return;
  var opts = ffaCurrentVehicleOptions(), sig = '';
  for (var si = 0; si < opts.length; si++) sig += opts[si].team + ':' + opts[si].kind + '|';

  /* Rebuild when the active FFA setup changes (not only on the first death).
     The option source is also the spawn source, so every visible button is a
     real, currently allowed {team, kind} pair. */
  if (!el.rkindrow._ffaBound || el.rkindrow._ffaSig !== sig) {
    el.rkindrow.innerHTML = '';
    var defs = [];
    for (var i = 0; i < opts.length; i++) {
      defs.push({ text: vehicleKindName(opts[i].team, opts[i].kind), attrs: { k: opts[i].kind, side: opts[i].team },
        sel: respawnSel.kind === opts[i].kind && respawnSel.team === opts[i].team });
    }
    bindOptionRow(el.rkindrow, defs, function (b) {
      respawnSel.kind = b.getAttribute('data-k') || 'tank';
      respawnSel.team = b.getAttribute('data-side') || 'red';
      markSel(el.rkindrow, 'data-k', respawnSel.kind);
      var bs = el.rkindrow.querySelectorAll('button');
      for (var j = 0; j < bs.length; j++) bs[j].classList.toggle('sel', bs[j].getAttribute('data-k') === respawnSel.kind && bs[j].getAttribute('data-side') === respawnSel.team);
    });
    el.rkindrow._ffaBound = true;
    el.rkindrow._ffaSig = sig;
  }

  /* A stale selection can survive a mode/config change.  Keep the highlighted
     choice and the eventual spawn on one of the buttons actually rendered. */
  var valid = false;
  for (var oi = 0; oi < opts.length; oi++) {
    if (opts[oi].kind === respawnSel.kind && opts[oi].team === respawnSel.team) { valid = true; break; }
  }
  if (!valid && opts.length) {
    respawnSel.kind = opts[0].kind;
    respawnSel.team = opts[0].team;
  }
}
function showRespawnUI() {
  if (!el.respawnov) return;
  respawnUiOpen = true;
  document.exitPointerLock && document.exitPointerLock();   // 放出鼠标以便点选(不会暂停,见 pointerlockchange)
  el.respawnov.classList.remove('hidden');
  updateRespawnUI();
}
function hideRespawnUI() {
  respawnUiOpen = false;
  if (el.respawnov) el.respawnov.classList.add('hidden');
}
function updateRespawnUI() {
  if (!el.respawnov) return;
  if (isFfaMode()) {
    bindFfaRespawnChoices();
    if (el.rhqrow) el.rhqrow.style.display = 'none';
    if (el.rkindrow) el.rkindrow.style.display = '';
    markSel(el.rkindrow, 'data-k', respawnSel.kind);
    var ffaBtns = el.rkindrow.querySelectorAll('button');
    for (var fb = 0; fb < ffaBtns.length; fb++) ffaBtns[fb].classList.toggle('sel', ffaBtns[fb].getAttribute('data-k') === respawnSel.kind && ffaBtns[fb].getAttribute('data-side') === respawnSel.team);
    var noFfaReserve = ffaState.reserves <= 0;
    el.rconfirm.disabled = noFfaReserve;
    el.rconfirm.textContent = noFfaReserve ? 'NO RESERVE VEHICLES' : 'REDEPLOY (' + ffaState.reserves + ' LEFT)';
    return;
  }
  if (el.rhqrow) el.rhqrow.style.display = '';
  refreshVehicleChoiceLabels();
  // 每次打开时按 respawnSel.kind 重新同步按钮选中态
  // (ensureOptionButtons 仅在首次创建时应用 sel,此后按钮已存在即跳过——旧高亮停留在页面加载时的 'tank',
  //  而 respawnSel.kind 已被 spawnTeams 同步为 startKind(玩家开局所选载具),导致菜单高亮与实际部署不一致)
  markSel(el.rkindrow, 'data-k', respawnSel.kind);
  markSel(el.rhqrow, 'data-wing', respawnSel.wing);   // 翼位高亮同步(防旧会话残留索引)
  var noPts = teamPool[pSide()] <= 0;                // 判禁用按玩家队(旧笔误恒 red)
  el.rconfirm.disabled = noPts;
  el.rconfirm.textContent = noPts ? 'NO STRENGTH - NO DEPLOY' : 'REDEPLOY';
}
function bindRespawnUI() {
  if (!el.respawnov) return;
  // rconfirm 点击绑定在 buildMenuButtons(通用按钮生成)内
  if (!el.rhqrow || typeof el.rhqrow.querySelectorAll !== 'function') return;   // 无头 DOM 桩无此 API,其余跳过
  /* 翼位三选一(data-wing=翼位索引)。不再按兵种分行 —— 兵种已由下方载具行隐式决定,
     此处只问「部署到战线的哪一侧」。按 HQ_WING_LABEL 生成,增删翼位无需改此处。 */
  var wrows = [], wi;
  for (wi = 0; wi < HQ_WING_LABEL.length; wi++)
    wrows.push({ text: HQ_WING_LABEL[wi], attrs: { wing: wi }, sel: respawnSel.wing === wi });
  bindOptionRow(el.rhqrow, wrows, function (b) {
    respawnSel.wing = +b.getAttribute('data-wing');
    markSel(el.rhqrow, 'data-wing', respawnSel.wing);
  });
  var krows = [], kri;               // 载具行=VEHICLE_KINDS 注册表全量生成(新增型号自动生效;文本按当前阵营,刷新见 refreshVehicleChoiceLabels)
  for (kri = 0; kri < VEHICLE_KINDS.length; kri++)
    krows.push({ text: vehicleKindName('red', VEHICLE_KINDS[kri].kind), attrs: { k: VEHICLE_KINDS[kri].kind },
                 sel: respawnSel.kind === VEHICLE_KINDS[kri].kind });
  bindOptionRow(el.rkindrow, krows, function (b) {
    respawnSel.kind = b.getAttribute('data-k');   // 兵种基地由型号自动对应(hqFind),翼位保持玩家上次的选择
    markSel(el.rkindrow, 'data-k', respawnSel.kind);
  });
}


