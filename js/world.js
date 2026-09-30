
/* ===== Module: world.js ===== */
/* ============================================================
   模块: world.js — 世界更新:每帧通用更新/相机/炮镜开镜激光测距
   (加载顺序由 index.html MODULES 表决定,勿单独调整)
   ============================================================ */
'use strict';
/* 阴影纹素对齐暂存(抗移动抖动) */
/* ★P0-③(移动端恢复):开镜阴影视圈半径上限按画质档收缩(仅触屏设备;桌面 420/2400 逐位不变)——
   中档(触屏默认)第三人称 ≤160m / 火箭炮俯视 ≤260m;低档 120/200。 */
var _shCap3rd = 420, _shCapArtyTop = 2400;
if (typeof GFX_TOUCH !== 'undefined' && GFX_TOUCH && typeof GFX_PROFILE !== 'undefined') {
  if (GFX_PROFILE === 'low') { _shCap3rd = 120; _shCapArtyTop = 200; }
  else if (GFX_PROFILE === 'mid') { _shCap3rd = 160; _shCapArtyTop = 260; }
}
var _sunLook = new THREE.Vector3(), _sunRight = new THREE.Vector3(), _sunUpAx = new THREE.Vector3(),
    _sunUpV = new THREE.Vector3(0, 1, 0), _sunCorr = new THREE.Vector3(), _shAim = new THREE.Vector3();
/* ============================================================
   每帧通用更新(模块修复 / 火灾 / 烟雾)
   ============================================================ */
function commonUpdate(t, dt) {
  /* ===== 开火后坐动画(玩家/AI 同机理;纯确定性曲线,零 RNG、零每帧分配)——
     身管:85ms 急退到峰(坦克 0.48m / 歼击车 0.58m / 火箭炮导轨仅 0.10m 微挫)+ 复进机弹簧回位(带一次过冲),~2.1s 收敛;
     膛口基准随管同步后滑(下一发的出膛原点自然从真实管口起算)。 ===== */
  if (t.recT >= 0) {
    t.recT += dt;
    var isH = isHeliVehicle(t);
    var ru = t.recT, rAmp = isTD89Vehicle(t) ? 0.58 : (t.kind === 'arty' ? 0.10 : (isH ? 0.04 : 0.48));
    var rz;
    if (isH) {
      if (ru < 0.015) rz = rAmp * (ru / 0.015);
      else rz = rAmp * Math.exp(-(ru - 0.015) / 0.04);
      if (ru > 0.15) { rz = 0; t.recT = -1; }
    } else {
      if (ru < 0.085) rz = rAmp * (ru / 0.085);
      else rz = rAmp * Math.exp(-(ru - 0.085) / 0.40) * (0.74 + 0.26 * Math.cos((ru - 0.085) * 8.4));
      if (ru > 2.1) { rz = 0; t.recT = -1; }
    }
    t.recoilZ = rz;
    if (t.gunMesh) t.gunMesh.position.z = -rz;
    if (t.muzzle) t.muzzle.position.z = t.muzzZ0 - rz;
  }
  // 出生保护期间不保留/处理玩家旧火灾状态(新车通常没有火灾，保留此闸防调试或边界事件绕过保护)。
  if (t.fire && t.alive && t === player && isFfaMode() && t._ffaSpawnInvulUntil > gameT) t.fire = null;
  if (t.fire && t.alive) {
    t.fire.dotT += dt;
    t.struct -= CONF.fireDOT * dt;
    if (CONF.fireDOT * dt > 0) t.lastDamageT = gameT;   // 火灾持续伤害也会立即打断战场维修
    if (t.fire.dotT > 0.8) {
      t.fire.dotT = 0;
      var keys2 = ['engine', 'fuel', 'ammo', 'turret'];
      var rk = keys2[Math.floor(Math.random() * keys2.length)];
      var rm = t.mods[rk];
      rm.hp = Math.max(0, rm.hp - rand(5, 10));
      if (typeof vehWeatherHit === 'function') vehWeatherHit(t, 'engine', CONF.fireDOT * 0.8, null);   // Q2:火灾0.8s节拍留痕(_wxDmg熏黑累积+epoch续命;point=null只熏黑不打坑)
      if (typeof effSync === 'function') effSync(t);   // 效率族事件缓存重算(火灾烧蚀=模块 hp 唯二变化点之二,0.8s 事件节拍)
      if (t === player && typeof playerHudDamage === 'function') playerHudDamage(rk);   // 火灾烧蚀绕过 applyModuleDamage,迷你 HUD 需自钩(0.8s 事件节拍)
    }
    var c = t.group.position;
    /* 持续火焰与黑烟走 comic.js 的两只全局 InstancedMesh,零燃烧粒子。 */
    if (typeof comicBurnVehicle === 'function') comicBurnVehicle(t);
    if (t.fire.extinguishAt != null && gameT >= t.fire.extinguishAt) {
      t.fire = null;
    }
    if (t.struct <= 0) killTank(t, 'FIRE KILL');
  }
  /* 发动机排烟、飘散烟和双履带后尘由 comic.js 的手绘 atlas 面片接管;
     贴图片段使用固定世界尺寸,不读相机距离。 */
  if (t.alive && typeof comicVehicleMotionSmoke === 'function') comicVehicleMotionSmoke(t, dt);
  if (t.alive && typeof comicTrackDig === 'function') comicTrackDig(t, dt);   // P3 履带刨土(与行进尘同帧同车)
  if (t.alive && Math.abs(t.speed) > 2 && (t.mods.trackL.hp <= 0 || t.mods.trackR.hp <= 0)) {
    if (Math.random() < dt * 12) {
      var side = t.mods.trackL.hp <= 0 ? -1.13 : 1.13;
      _v1.set(side, 0.4, rand(-1.5, 1.5));
      t.group.localToWorld(_v1);
      if (typeof wreckSparkCard === 'function') wreckSparkCard(_v1, 1.6);   // 小尺寸火星贴图卡(与残骸飞溅同池)
    }
  }
  /* BLUE-MBT-1 battlefield repair is consumed here, in the real per-vehicle
     update path after fire damage has been applied.  It is not a HUD-only timer. */
  if (typeof vehicleTechBattlefieldRepairTick === 'function') vehicleTechBattlefieldRepairTick(t, dt);
}

/* ============================================================
   相机
   ============================================================ */
var camPos = new THREE.Vector3(), camTgt = new THREE.Vector3();
var camAimY = 0, camAimP = 0;                       // 相机/视野瞄向(FPS 式,黄点=屏心):吃鼠标增量零延迟跟手;真实炮塔按物理转速随后爬,追平即重合
/* 炮镜视角性能优化——动态分辨率缩放 DRS:
   开镜时渲染分辨率按倍率分档降至基准的 0.55/0.50/0.45/0.40(像素量降至 ~16%~30%),
   地面贴图采样/阴影采样全部等比减少——FPS 瞄准镜标配做法,关镜恢复。
   开镜阴影常开——由 cameraUpdate 动态视锥接管:视锥中心=瞄准着点、
   半径=视圈世界半径,视圈内载具不管距离都有阴影,且投影几何=命中壳代理(粗壳),阴影 pass 成本低。 */
function applyScopePerf(on, zoom) {
  if (!renderer) return;
  // ① 动态分辨率缩放(按倍率分档:倍率越高画面细节越少,低分辨率越不可感知)
  var z = on ? (zoom || 1) : 0;
  var ratio = !on ? 1 : (z <= 1 ? 0.55 : (z <= 2 ? 0.5 : (z <= 3 ? 0.45 : 0.4)));
  /* ★P2-⑧(移动端恢复):像素比落笔统一走 drsApply(=基准×全局DRS×开镜档);drsScale 恒 1 时与原直写等价 */
  var _apply = (typeof drsApply === 'function') ? drsApply : function () {
    renderer.setPixelRatio(Math.max(0.35, _basePixelRatio * _scopeResRatio));
    renderer.setSize(innerWidth, innerHeight, false);
  };
  if (on && !_scopeResHi) {
    _scopeResHi = true; _scopeResRatio = ratio;
    _apply();                                              // 保持 CSS 尺寸,仅缩渲染缓冲
  } else if (on && Math.abs(ratio - _scopeResRatio) > 0.001) {   // 倍率档位变化时更新
    _scopeResRatio = ratio;
    _apply();
  } else if (!on && _scopeResHi) {
    _scopeResHi = false; _scopeResRatio = 1;
    _apply();
  }
  /* 阴影常开,视锥由 cameraUpdate 动态接管 */
}
/* ★camShake 平滑摇晃状态(交火卡顿根治):逐帧三轴独立白噪 rand 直加相机位置的画法,
   100fps 下=每秒 100 次互不相关世界振动,交火中 camShake 被周围爆炸持续刷高时移动视流被彻底摧毁
   ——体感"网络延迟式卡顿+镜头突变位"(fps 100+ 仍卡/车体相对位置不变/纯镜头抖)。
   AI 无相机故完全免疫。本制为连续多频正弦摇晃+幅值自身平滑(挨打是 ~70ms 涌起,非阶跃跳变)。 */
var _shkAmp = 0, _shkPh = 0;
/* 火箭炮俯视火控相机高度(变焦映射单一真源):scopeZoom 1~20 → 2000~60m(滚轮/双指捏合同源;player.js 平移速度亦取此)。
   拉远上限 2000m:2km 图一屏尽收,大图配合镜头平移覆盖全图(fog far 6200/远平面 60km 均在量程内)。 */
function artyTopCamHeight() { return 2000 * Math.pow(clamp(scopeZoom, 1, 20), -1.17); }
function cameraUpdate(dt) {
  if (!player) return;
  var pp = player.group.position;
  // 开镜视角限速——高倍率 zoomF 补偿下,直接吃鼠标增量的视角单帧跳变 ~0.4°(20× 时≈半屏),
  //   鼠标一动视野即丢失目标(高倍率下体感灵敏度极低;坦克炮镜无此感因炮塔追随天然限速)。
  //   故取炮塔追随同机理:鼠标驱动目标向 camAimY,视角按 1.2rad/s 硬限速转向目标(残余帧间保留=天然累积器);
  //   低倍率增量恒小于限速=手感逐帧不变,高倍率由"一动即丢"变"稳定跟住";第三人称保持瞬时。
  var aimYaw;
  if (scopeT > 0.001) {
    var vMax = 1.2 * dt;
    var dVy = clamp(normAng(camAimY - (player._camYaw == null ? camAimY : player._camYaw)), -vMax, vMax);
    player._camYaw = (player._camYaw == null ? camAimY : player._camYaw) + dVy;
    aimYaw = player._camYaw;
  } else {
    player._camYaw = camAimY;                          // 第三人称瞬时同步(开镜切入无跳变)
    aimYaw = camAimY;
  }
  var isHeli = isHeliVehicle(player);
  var curWp = isHeli ? (player._heliWeapon || 3) : 1;
  var gp;
  if (isHeli) {
    if (curWp === 3) {
      // 武器3(导弹): 俯仰角任意角度、方向全向360度不受任何限制
      gp = camAimP;
    } else if (curWp === 2) {
      // 武器2(火箭弹): 上0°,下60° (俯角60°)
      gp = clamp(camAimP, -60 * Math.PI / 180, 0.0);
    } else {
      // 武器1(机炮): 俯角80°,仰角0°
      gp = clamp(camAimP, -80 * Math.PI / 180, 0.0);
    }
  } else {
    gp = scopeT > 0.001
      ? clamp(camAimP, -0.14, player.kind === 'arty' ? 1.05 : 0.3)
      : camAimP;
  }
  var dxF = Math.sin(aimYaw) * Math.cos(gp),
      dyF = Math.sin(gp),
      dzF = Math.cos(aimYaw) * Math.cos(gp);

  // 常规机位(第三人称越肩/直升机大视距)
  var followDist = isHeli ? 16.0 : 8.4;
  var tpY = isHeli ? 2.5 : 2.0;
  var tp = _v1.set(pp.x, pp.y + tpY, pp.z);
  var pitchU = (isHeli ? 0.28 : 0.33) - gp * 0.55;
  var cpU = Math.cos(pitchU), spU = Math.sin(pitchU);
  var ux = tp.x - Math.sin(aimYaw) * cpU * followDist,
      uy = tp.y + spU * followDist,
      uz = tp.z - Math.cos(aimYaw) * cpU * followDist;

  // 开镜机位(坦克/歼击车:第一人称炮位沿炮轴;火箭炮:俯视火控,正上方俯瞰战场)
  player.gunPivot.getWorldPosition(_v2);
  var sx = _v2.x, sy = _v2.y, sz = _v2.z;
  var tx2 = _v2.x + dxF * 40, ty2 = _v2.y + dyF * 40, tz2 = _v2.z + dzF * 40;   // 默认注视:炮轴 40m
  if (player.kind === 'arty') {
    /* 俯视火控相机:装定中心上空俯瞰战场(战术地图北向朝上,屏幕顶=世界 −Z);
       中心=车体+WSAD/摇杆平移偏移(playerUpdate 写入,钳战场边界),高度=变焦(artyTopCamHeight)。
       机位自 +Z(南)侧留 10° 倾角(0.176h 水平偏置):纯正俯视时视轴∥up 矢量,lookAt 退化;
       南偏下过渡期 roll 由「视轴水平分量」连续收敛到北向上,与 scopeT>0.55 的 up 切换无缝衔接。 */
    var hTop = artyTopCamHeight();
    /* Clamp the camera center to the active map bounds for the current viewport. */
    var bX = CONF.boundsX != null ? CONF.boundsX : CONF.bounds;
    var bZ = CONF.boundsZ != null ? CONF.boundsZ : CONF.bounds;
    var cX = clamp(pp.x + (player._topCamX || 0), -bX, bX);
    var cZ = clamp(pp.z + (player._topCamZ || 0), -bZ, bZ);
    var cY = terrainH(cX, cZ);
    sx = cX; sy = cY + hTop * 0.985; sz = cZ + hTop * 0.176;
    tx2 = cX; ty2 = cY; tz2 = cZ;
  }

  camPos.set(
    ux + (sx - ux) * scopeT,
    uy + (sy - uy) * scopeT,
    uz + (sz - uz) * scopeT
  );
  var gyC = terrainH(camPos.x, camPos.z) + 0.55;      // 相机不入地
  if (camPos.y < gyC) camPos.y = gyC;
  var k = 1 - Math.pow(0.0005, dt);
  camera.position.lerp(camPos, k);
  // 动态 near 切换已撤除:对数深度缓冲使精度与 near 解耦,统一 0.1 既安全又精确

  /* ★白噪→平滑摇晃(见函数上方注释):正弦相位连续(4.1/6.7/5.2Hz 三频叠加=爆炸闷响感),
     幅值 lerp τ≈70ms 无阶跃跳变;衰减 1.8→3.2(挨打 0.45 约 0.14s 退净,爆炸间隔快速归零) */
  camShake = Math.max(0, camShake - dt * 3.2);
  camPK = Math.max(0, camPK - dt * (camPK > 0.55 ? 2.6 : 0.85));   // 快抬慢落:炮响瞬间炮镜被顶起,随后缓缓回稳
  _shkAmp += (camShake - _shkAmp) * Math.min(1, dt * 14);
  _shkPh += dt * 26;
  var sh = _shkAmp * (1 - 0.65 * scopeT);             // 开镜时减弱震动(挨打/爆炸来源)
  camera.position.x += Math.sin(_shkPh) * sh * 0.22;
  camera.position.y += Math.sin(_shkPh * 1.62 + 1.7) * sh * 0.17;
  camera.position.z += Math.sin(_shkPh * 1.27 + 3.9) * sh * 0.22;

  // 注视点:越肩 26m(直升机 50m) 延长线 ↔ 开镜注视点(坦克/歼击车=炮轴 40m;火箭炮=炮弹落点)
  var lookDist = isHeli ? 50.0 : 26.0;
  camTgt.set(
    tp.x + dxF * lookDist + (tx2 - (tp.x + dxF * lookDist)) * scopeT,
    tp.y + dyF * lookDist + (ty2 - (tp.y + dyF * lookDist)) * scopeT,
    tp.z + dzF * lookDist + (tz2 - (tp.z + dzF * lookDist)) * scopeT
  );
  /* 火箭炮俯视切北向朝上:up=世界 −Z → 屏幕顶=−Z、屏幕右=+X。
     scopeT>0.55 后视轴已陡俯(南偏机位保证 up 永不∥视轴);之前保持常规 up,roll 连续无跳变。 */
  if (player.kind === 'arty' && scopeT > 0.55) camera.up.set(0, 0, -1);
  else camera.up.set(0, 1, 0);
  camera.lookAt(camTgt);
  if (camPK > 0) camera.rotateX(camPK * 0.016 * scopeT);   // 炮镜专属"开炮把镜子顶起来"(×scopeT:第三人称视角零晃动,炮口上抬/准星晃动由 recPitchK 走伺服)

  // 开镜变焦(62° → 28°);火箭炮俯视火控 FOV 恒定 52°,变焦由相机高度承担
  var fov = (player.kind === 'arty') ? (62 - 10 * scopeT) : scopeFov(scopeZoom, scopeT);   // 炮镜倍率(默认1×=28°fov,5×=5.6°fov)
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }

  /* ===== 火箭炮俯视火控:光标地面点反解(每帧)+ 地面战术标记 =====
     自由光标 NDC → 反投影射线 × laserRange(车体/目标网格+地形,点到车=装定到车);
     无交(极端贴边)保持上一次值;装定点钳在战场边界内。
     ★修复(火箭炮黄框跨局残留): 关闭动作必须走到 else 里无条件执行,不能把它锁在
     「当前开的是火箭炮」这个条件内部。旧写法是
         if (kind==='arty' && alive) { if (scopeT>0.5) show(); else hide(); }
     ——一旦玩家在炮镜里退出对局/换了别的车(此后 kind 不再是 arty,或 player 置空),
     整个 if 块被跳过,就没有任何人负责关闭 _artyTopGrp.visible,它会永久停在上一局的
     true,于是黄色火力覆盖框(连同装定点红环与射击线)留在新对局的战场地面上。
     场景对象只在启动时建一次(initScene 只被调用一次),对局之间复用同一个 scene,
     所以这个 visible 残留不会被任何"重建场景"顺带清掉,必须自己关。 */
  if (player && player.alive && player.kind === 'arty' && scopeT > 0.5) {
    camera.updateMatrixWorld();
    _topRV.set(artTopNX, artTopNY, 0.5).unproject(camera).sub(camera.position).normalize();
    var dCast = laserRange(camera.position, _topRV);
    if (isFinite(dCast) && dCast > 1 && dCast < 12000) {
      var hbX = CONF.boundsX != null ? CONF.boundsX : CONF.bounds, hbZ = CONF.boundsZ != null ? CONF.boundsZ : CONF.bounds;
      var hxT = clamp(camera.position.x + _topRV.x * dCast, -hbX, hbX);
      var hzT = clamp(camera.position.z + _topRV.z * dCast, -hbZ, hbZ);
      if (!player._topHover) player._topHover = { x: hxT, y: 0, z: hzT };
      else { player._topHover.x = hxT; player._topHover.z = hzT; }
      player._topHover.y = terrainH(hxT, hzT);
    }
    artyTopMarkersUpdate();
  } else artyTopMarkersHide();

  /* ===== 阴影视锥动态跟随(阴影常开,不再有开镜关阴影路径)——
     第三人称:视锥中心=玩家 ±70m(近场清晰);
     开镜:视锥中心=炮镜瞄准着点,半径=全屏画面对角世界半径+余量 → 炮镜整个屏幕画面内的载具不管距离都有阴影
     (与 map.js scopeScreenVisible 同"全屏矩形"口径;若只按垂直半 FOV 取圆半径,16:9 下横向可见域
     是垂直的 ~1.78 倍,载具靠近画面/镜圈左右边缘即超出阴影正交框=影子被裁)。
     投影几何=命中壳代理流(vehicles.js instShadow),装饰物不投影。 ===== */
  var shCX = pp.x, shCY = pp.y, shCZ = pp.z, shR = 70;
  if (scopeT > 0.5 && player.alive) {
    /* ★闪烁根治(炮镜掠地平线全屏明暗 10Hz 交替):raw 着距的 6m 地形量化步+目标在射线域进出,
       使视线掠地平线时 laserRange 在近地/远山/4000 兜底间逐采样跳 → shD/shR 档/far/纹素对齐连锁跳
       → 阴影贴图内容突变=全屏明暗闪(俯视与高仰角测距稳定,故只在该角度带发作)。
       着距改吃 main.js 已有的 τ=0.12s 低通值 _dSm(炮管伺服/装定同源,平滑连续无逐帧跳);arty 无 _dSm 回落 raw。 */
    var isArtyTop = player.kind === 'arty';
    /* 火箭炮俯视:着距=相机离地高——旧 200m 兜底在俯视高空会把阴影视锥中心悬在半空,
       地面落在 far(=400+2·shR)之外 → 拉远后全图载具阴影消失;半径上限同步放宽到全屏对角。 */
    var shDRaw = isArtyTop ? (camera.position.y - terrainH(camera.position.x, camera.position.z))
                           : ((lastAimT && lastAimT.d > 10) ? (player._dSm || lastAimT.d) : 200);   // 着距(火控同源);无解时 200m 兜底
    var shD = clamp(shDRaw, 40, isArtyTop ? 2600 : 900);
    camera.getWorldDirection(_shAim);                                             // 相机前向=镜心视线
    _shAim.multiplyScalar(shD).add(camera.position);
    shCX = _shAim.x; shCY = _shAim.y; shCZ = _shAim.z;
    var shFov = camera.fov * Math.PI / 180;                  // 与相机实际 fov 同源(火箭炮俯视恒 52°,不走 scopeFov)
    var shAsp = camera.aspect || (innerWidth / innerHeight);
    shR = clamp(shD * Math.tan(shFov * 0.5) * Math.sqrt(1 + shAsp * shAsp) + 25, 40, isArtyTop ? _shCapArtyTop : _shCap3rd);   // 全屏对角世界半径+25m 余量(上限随对角扩)
    shR = Math.ceil(shR / 10) * 10;                       // 10m 量化档:测距连续变化不逐帧重投影(纹素尺寸稳定不抖)
  }
  var shCam = sunLight.shadow.camera;
  if (shCam.right !== shR) {                         // 仅在半径变档时重投影(第三人称↔开镜/倍率档切换)
    shCam.left = -shR; shCam.right = shR; shCam.top = shR; shCam.bottom = -shR;
    shCam.far = 400 + shR * 2;                       // 大视圈需更远距离范围兜住
    shCam.updateProjectionMatrix();
  }
  /* ★光源位置=「瞄准点 + 太阳方向×150m」:y 若漏加 shCY 且偏移仅单位向量 1m 量级,光向 y 分量
     =0.38−shCY 会随瞄准点地形高度漂移(崎岖图/弹坑区可达数十米,光向歪斜甚至朝天),阴影相机更几乎贴地:
     正交盒掠过起伏地形的 near/盒缘临界 + 上述着距跳变 = 明暗闪烁的放大器。
     本制光向恒= sunOffset(连续时间系统,随所选小时旋转,语义不变),相机稳居场上空 57m+,盒缘远离地面;
     默认平坦图 shCY≈0 时与单位向量偏移逐位一致(视觉零变化),崎岖图为修正。 */
  sunLight.position.set(shCX + sunOffset.x * 150, shCY + sunOffset.y * 150, shCZ + sunOffset.z * 150);
  sunLight.target.position.set(shCX, shCY, shCZ);
  // 阴影纹素对齐(抗移动抖动)——阴影视锥跟随时,shadow map 纹素格相对世界滑动使边缘逐帧闪烁;
  //   把视锥中心沿光空间截面两轴(right/up)对齐到纹素整数倍,纹素格锁定世界,阴影稳定。
  var _texel = (shCam.right - shCam.left) / sunLight.shadow.mapSize.x;
  _sunLook.set(-sunOffset.x, -sunOffset.y, -sunOffset.z).normalize();      // 光照射方向(目标→光源取反)
  _sunRight.crossVectors(_sunUpV, _sunLook).normalize();                   // 光空间横轴
  _sunUpAx.crossVectors(_sunLook, _sunRight).normalize();                  // 光空间纵轴
  var _pr = _shAim.set(shCX, shCY, shCZ).dot(_sunRight), _pu = _shAim.dot(_sunUpAx);
  var _dr = Math.round(_pr / _texel) * _texel - _pr;
  var _du = Math.round(_pu / _texel) * _texel - _pu;
  _sunCorr.copy(_sunRight).multiplyScalar(_dr).addScaledVector(_sunUpAx, _du);
  sunLight.position.add(_sunCorr);
  sunLight.target.position.add(_sunCorr);
  sunLight.target.updateMatrixWorld();
}

/* ===== 开镜:激光测距 + 弹道仿真落点 ===== */
var laserRay = new THREE.Raycaster();
var simRay = new THREE.Raycaster();
var scopeV = new THREE.Vector3();
var _siD = new THREE.Vector3(), _siP = new THREE.Vector3(), _siD2 = new THREE.Vector3(),
    _siV = new THREE.Vector3(), _siV2 = new THREE.Vector3(), _siQ = new THREE.Quaternion();   // 落点刚体追踪暂存
var _siPos = new THREE.Vector3(), _siVel = new THREE.Vector3(), _siMove = new THREE.Vector3();   // simulateImpact 积分暂存(返回值另分配,暂存不逃逸)
var _fcsOkVal = true;                 // ★审查C7: 上帧火控解算门(scopeHudUpdate 每帧写入; updateScopeInfo 先于它执行, 用上帧值=至多 1 帧滞后)
var _rgD = new THREE.Vector3(), _rgR = new THREE.Vector3(), _rgA = new THREE.Vector3(), _rgB = new THREE.Vector3();   // 散布环投影暂存
var _lrCands = [];                    // 激光测距候选暂存(宽相位输出,独立于 losIntersect 的 _candList)
var LASER_MAX = 10000;                // ★审查C6: 测距量程单一真源(原版为函数内字面量; 与 CONF.arty/artyE.maxRange 语义无关——后者是火箭炮最大射程配置,红 RED_MLRS/蓝 BLUE_MLRS 均为 40000)
// 直线测距(模块/残骸/障碍物/地形,取最近)
function laserRange(from, dir) {
  /* ★审查A1(等价换序): 返回值 = min(物体命中, 地形命中)。原版先沿全 10km 走廊取物体候选
     (≈742 采样点 × 9 桶 Map.get + 全候选 raycast),后做地形步进(该步进已被物体命中截断)。
     换序:先解地形命中 dT,物体走廊截到 far=min(dT, 量程)——
     物体更近 ⇒ 原地形步进本会在物体命中处收尾,截断走廊取到的最近物体不变;
     地形更近 ⇒ 更远的物体命中本就会被 min 丢弃。逐位等价,而常见情形(平射/俯射,近距地面或遮挡)
     物体候选数随命中距离大幅收缩。天向(dir.y≥0 且起点高于全图地形上界+包络余量)地形必不命中,直接短路。 */
  var dT = Infinity;
  if (!(dir.y >= 0 && from.y >= TB_MAXH + TERR_ENV_MARGIN)) {
    for (var d = 6; d < LASER_MAX; d += (d < 2000 ? 6 : 18)) {
      var px = from.x + dir.x * d, py = from.y + dir.y * d, pz = from.z + dir.z * d;
      if (py < terrainH(px, pz) + 0.1) {
        // 越界区间三分细化(6m/18m→0.75m)
        var stepD = d < 2000 ? 6 : 18;
        var lo = d - stepD, hi = d;
        for (var rb = 0; rb < 4; rb++) {
          var md = (lo + hi) * 0.5;
          if (from.y + dir.y * md < terrainH(from.x + dir.x * md, from.z + dir.z * md) + 0.1) hi = md; else lo = md;
        }
        dT = hi; break;
      }
    }
  }
  var far = dT < LASER_MAX ? dT : LASER_MAX;          // 物体走廊截断至地形命中处(等价性见上)
  laserRay.set(from, dir);
  laserRay.far = far;
  // 宽相位候选(hitGrid 静态+动态两表)替代全表 targetsList——残骸命中壳随消耗战累积,
  //   全表 intersectObjects 每次 O(累计车辆×模块数);沿线段取格候选集合同款,结果同序
  collectCands(from.x, from.z, from.x + dir.x * far, from.z + dir.z * far, _lrCands);
  var hits = laserRay.intersectObjects(_lrCands, false);
  var best = Infinity, i;
  for (i = 0; i < hits.length; i++) {
    var ud = hits[i].object.userData;
    if (ud.tank === player) continue;
    best = from.distanceTo(hits[i].point);
    break;
  }
  return dT < best ? dT : best;
}
// 按真实弹道(初速+重力)逐步仿真,求弹着点
function simulateImpact(from, dir, speed) {
  var pos = _siPos.copy(from);
  var vel = _siVel.copy(dir).multiplyScalar(speed);
  var st = 0.02;
  for (var i = 0; i < 140; i++) {                     // 最长约 2.8s 飞行
    vel.y -= CONF.gravity * st;
    var move = _siMove.copy(vel).multiplyScalar(st);
    var L = move.length();
    simRay.set(pos, _v3.copy(move).normalize());
    simRay.far = L;
    var hits = losIntersect(pos.x, pos.z, pos.x + move.x, pos.z + move.z, simRay);   // 宽相位(hitGrid)候选求交——替代全表 targetsList(残骸命中壳累积 800+ 时逐步全交线性恶化)
    for (var j = 0; j < hits.length; j++) {
      var ud = hits[j].object.userData;
      if (ud.tank === player) continue;
      return { point: hits[j].point.clone(), dist: from.distanceTo(hits[j].point), tof: st * (i + 1) };
    }
    var mpx = pos.x + move.x * 0.5, mpy = pos.y + move.y * 0.5, mpz = pos.z + move.z * 0.5;
    var gym = terrainH(mpx, mpz);
    if (mpy < gym + 0.05) {
      return { point: new THREE.Vector3(mpx, gym + 0.05, mpz),
               dist: Math.sqrt((mpx - from.x)*(mpx - from.x)+(mpy - from.y)*(mpy - from.y)+(mpz - from.z)*(mpz - from.z)), tof: st * (i + 0.5) };
    }
    var nx = pos.x + move.x, ny = pos.y + move.y, nz = pos.z + move.z;
    var gy = terrainH(nx, nz);
    if (ny < gy + 0.05) {
      return { point: new THREE.Vector3(nx, gy + 0.05, nz),
               dist: Math.sqrt((nx - from.x)*(nx - from.x)+(ny - from.y)*(ny - from.y)+(nz - from.z)*(nz - from.z)), tof: st * (i + 1) };
    }
    pos.add(move);
  }
  return null;
}
// —— 火箭弹真实弹道仿真:与 stepShells 同一套重力/地形终止规则(仅地形终止)。
//    开镜红点显示的就是这条仿真的终点 —— 指示器=真弹道落点,不再是几何装定点。
function simRocketImpact(from, dir, v) {
  // 与实弹同一口径——ROCKET_PROF 剖面沿解析弧推进(几何与旧重力弧逐点重合,红点=首发落点铁律不变);
  // 步长 1/60s(≈实弹帧),355m/s 下 5.9m/步,tof=真实飞行时间(旧 11s 上限 → 新 ~0.5~3s,340 步预算绰绰有余)
  var st = 1 / 60;
  _rkSim.p0x = from.x; _rkSim.p0y = from.y; _rkSim.p0z = from.z;
  _rkSim.v0x = dir.x * v; _rkSim.v0y = dir.y * v; _rkSim.v0z = dir.z * v;
  _rkSim.u = 0; _rkSim.tF = 0; _rkSim.tof0 = shellTof0(dir.y, v);
  var px = from.x, py = from.y, pz = from.z, i;
  // 步数预算随 tof 扩展(10000m 约 45s,支持长航程积分)
  var steps = Math.min(8000, Math.max(340, Math.ceil((_rkSim.tof0 + 5) / st)));   // 40km 高抛 tof≈99s → 6240 步,预算抬到 8000
  for (i = 0; i < steps; i++) {
    rocketUStep(_rkSim, st);
    var nx = _rkSim.p0x + _rkSim.v0x * _rkSim.u,
        ny = _rkSim.p0y + _rkSim.v0y * _rkSim.u - 0.5 * CONF.gravity * _rkSim.u * _rkSim.u,
        nz = _rkSim.p0z + _rkSim.v0z * _rkSim.u;
    var mx = (px + nx) * 0.5, my = (py + ny) * 0.5, mz = (pz + nz) * 0.5;   // 防地形隧穿:中点采样
    var gym = terrainH(mx, mz);
    if (my < gym + 0.05) return { point: new THREE.Vector3(mx, gym + 0.05, mz), tof: _rkSim.tF - st * 0.5 };
    var gy = terrainH(nx, nz);
    if (ny < gy + 0.05) return { point: new THREE.Vector3(nx, gy + 0.05, nz), tof: _rkSim.tF };
    px = nx; py = ny; pz = nz;
  }
  return { point: new THREE.Vector3(px, py, pz), tof: _rkSim.tF };
}
/* ===== 火箭炮俯视火控 · 地面战术标记:火力覆盖范围环 + 装定点红环 + 车→装定点射击线 =====
   覆盖半径 = 齐射散布图案最大半径 + 溅射半径(按实弹图案表 artySalvoPattern 逐车型计算:
   RED_MLRS 40 发黄金角螺旋 ≈147m + 22m;BLUE_MLRS 6 发 ≈105m + 44m);环贴地形上浮 0.8m,
   depthTest 关闭 = 战术叠加恒可见(俯瞰下不被山体/建筑遮挡)。 */
var _topRV = new THREE.Vector3();                        // 光标反投影射线 scratch
var _artyTopGrp = null, _artyTopRing = null, _artyTopDot = null, _artyTopLine = null, _artyTopLinePos = null;
function artyCoverageRadius(t) {
  if (t._covR != null) return t._covR;
  var c = artyConfOf(t), p = artySalvoPattern(c.salvo || 16), m = 0;
  for (var i = 0; i < p.length; i++) {
    var rr = Math.sqrt(p[i][0] * p[i][0] + p[i][1] * p[i][1]);
    if (rr > m) m = rr;
  }
  t._covR = m + (c.splashR || 22);
  return t._covR;
}
function artyTopMarkersEnsure() {
  if (_artyTopGrp) return;
  _artyTopGrp = new THREE.Group();
  var ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  _artyTopRing = new THREE.Mesh(new THREE.RingGeometry(0.982, 1.0, 128), ringMat);   // 单位环,按覆盖半径整体缩放
  _artyTopRing.rotation.x = -Math.PI / 2;
  _artyTopRing.renderOrder = 60;
  var dotMat = new THREE.MeshBasicMaterial({ color: 0xff4b3e, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
  _artyTopDot = new THREE.Mesh(new THREE.RingGeometry(2.0, 3.0, 48), dotMat);        // 装定点红环(固定 ~3m)
  _artyTopDot.rotation.x = -Math.PI / 2;
  _artyTopDot.renderOrder = 61;
  _artyTopLinePos = new Float32Array(6);
  var lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(_artyTopLinePos, 3));
  _artyTopLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.5, depthTest: false }));
  _artyTopLine.renderOrder = 59;
  _artyTopLine.frustumCulled = false;
  _artyTopGrp.add(_artyTopRing); _artyTopGrp.add(_artyTopDot); _artyTopGrp.add(_artyTopLine);
  _artyTopGrp.visible = false;
  scene.add(_artyTopGrp);
}
function artyTopMarkersUpdate() {
  artyTopMarkersEnsure();
  var tgt = ((player._topFireWish || player.salvoLeft > 0) && player._topTgt) ? player._topTgt : player._topHover;
  if (!tgt || !isFinite(tgt.x)) { _artyTopGrp.visible = false; return; }
  _artyTopGrp.visible = true;
  var R = artyCoverageRadius(player);
  _artyTopRing.scale.set(R, R, 1);
  var gy = terrainH(tgt.x, tgt.z) + 0.8;
  _artyTopRing.position.set(tgt.x, gy, tgt.z);
  _artyTopDot.position.set(tgt.x, gy + 0.1, tgt.z);
  var ppM = player.group.position;
  _artyTopLinePos[0] = ppM.x; _artyTopLinePos[1] = ppM.y + 1.2; _artyTopLinePos[2] = ppM.z;
  _artyTopLinePos[3] = tgt.x; _artyTopLinePos[4] = gy; _artyTopLinePos[5] = tgt.z;
  _artyTopLine.geometry.attributes.position.needsUpdate = true;
  _artyTopLine.geometry.computeBoundingSphere();
}
function artyTopMarkersHide() {
  if (_artyTopGrp) _artyTopGrp.visible = false;
}
var _rkSim = { p0x: 0, p0y: 0, p0z: 0, v0x: 0, v0y: 0, v0z: 0, u: 0, tF: 0, tof0: 1 };   // 红点仿真复用暂存(每帧调用,零分配)
function updateScopeInfo() {
  if (player.kind === 'arty') {
    var aim = player._artyAim;
    if (aim) {
      var dS = _v2; player.gunPivot.getWorldDirection(dS);
      var mS = artyBoreOrigin(player, dS);
      var simS = simRocketImpact(mS, dS, player.rocketV || artyConfOf(player).rocketSpeed);
      var solA = player._artySol;
      if (aim.settled && aim.reach && solA && player.rocketV > 34.5 && player.rocketV < solA.vmax - 0.5) {
        var Rdes = Math.sqrt((aim.x - mS.x)*(aim.x - mS.x)+(aim.z - mS.z)*(aim.z - mS.z));
        var Rsim = Math.sqrt((simS.point.x - mS.x)*(simS.point.x - mS.x)+(simS.point.z - mS.z)*(simS.point.z - mS.z));
        if (Rsim > 30 && Math.abs(Rdes - Rsim) > 1.0)
          player._artyKv = clamp((player._artyKv || 1) * clamp(Math.sqrt(Rdes / Rsim), 0.94, 1.065), 0.5, 2);
      }
      scopeInfo.laser = aim.d;
      scopeInfo.point = simS.point;
      scopeInfo._mDir = _siD.copy(dS);
      scopeInfo._mPos = _siP.copy(mS);
      scopeInfo.impDist = Math.sqrt((simS.point.x - player.group.position.x)*(simS.point.x - player.group.position.x)+(simS.point.z - player.group.position.z)*(simS.point.z - player.group.position.z));
      scopeInfo.tof = simS.tof;
      scopeInfo.reach = aim.reach !== false;
    } else { scopeInfo.laser = Infinity; scopeInfo.point = null; }
    return;
  }

  /* RED-TD weapon 2: the HE round has its own 1400m/s gravity solution in the
     same scope camera/impact pipeline. Switching back to AP immediately restores
     the normal effective shell speed, so the sight never reuses the wrong TOF. */
  if (typeof isPlayerRedTdHighExplosiveVehicle === 'function' && isPlayerRedTdHighExplosiveVehicle(player) && player._tdReloadKind === 2) {
    var heFrom = new THREE.Vector3();
    player.muzzle.getWorldPosition(heFrom);
    var heDir = new THREE.Vector3();
    player.gunPivot.getWorldDirection(heDir);
    scopeInfo.laser = laserRange(heFrom, heDir);
    var heImp = _fcsOkVal ? simulateImpact(heFrom, heDir, 1400) : null;
    scopeInfo.point = heImp ? heImp.point : null;
    scopeInfo.rkPointL = null;
    scopeInfo.rkPointR = null;
    scopeInfo._mDir = _siD.copy(heDir);
    scopeInfo._mPos = _siP.copy(heFrom);
    scopeInfo.impDist = heImp ? heImp.dist : 0;
    scopeInfo.tof = heImp ? heImp.tof : 0;
    return;
  }

  // 直升机多武器独立炮口与落点分流
  if (isHeliVehicle(player)) {
    var curWp = player._heliWeapon || 3;
    if (curWp === 3) {
      // Weapon 3 is missile mode; it has no gun impact marker or impact simulation.
      var camDir3 = new THREE.Vector3();
      camera.getWorldDirection(camDir3);
      scopeInfo.laser = laserRange(player.group.position, camDir3);
      scopeInfo.point = null;
      scopeInfo.rkPointL = null;
      scopeInfo.rkPointR = null;
      scopeInfo.impDist = 0;
      scopeInfo.tof = 0;
      return;
    } else if (curWp === 2) {
      // 武器2: 火箭弹模式 - 左右双火箭巢各自独立的真实物理弹道落点仿真 (沿机身长轴, 按弹型口径)
      var fromL = heliRocketPodOrigin(player, 0);
      var fromR = heliRocketPodOrigin(player, 1);
      var camDirR = new THREE.Vector3();
      camera.getWorldDirection(camDirR);
      var fireDir = heliBodyAxisDir(player, new THREE.Vector3());   // 火箭巢固定式: 炮口=机身长轴
      scopeInfo.laser = laserRange(fromL, camDirR);                 // 激光测距沿视线(与发射方向无关)

      var vHeliX = player._heliVx || 0, vHeliY = player._heliVy || 0, vHeliZ = player._heliVz || 0;
      var rkSpecHud = HELI_RKT_SPEC[player.kind] || HELI_RKT_SPEC.ah64;
      var rkV0Hud = rkSpecHud.v0;                                   // 两型统一规格初速(与 fireHeliRocket 同源)
      var rkGHud = (rkSpecHud.guidance === 'datalink') ? CONF.gravity : CONF.gravity * 0.35;   // 制导型全重力 / 70mm火箭弹 0.35g
      var rVel = new THREE.Vector3(vHeliX + fireDir.x * rkV0Hud, vHeliY + fireDir.y * rkV0Hud, vHeliZ + fireDir.z * rkV0Hud);
      var impL = simulateHeliRocketImpact(fromL, rVel, rkGHud, rkSpecHud.dragK);
      var impR = simulateHeliRocketImpact(fromR, rVel, rkGHud, rkSpecHud.dragK);

      scopeInfo.point = impL ? impL.point : null;
      scopeInfo.rkPointL = impL ? impL.point : null;
      scopeInfo.rkPointR = impR ? impR.point : null;
      scopeInfo._mDir = _siD.copy(fireDir);
      scopeInfo._mPos = _siP.copy(fromL);
      scopeInfo.impDist = impL ? impL.dist : 0;
      scopeInfo.tof = impL ? impL.tof : 0;
      return;
    }
  }

  // 常规直射主炮/直升机机炮
  var from = new THREE.Vector3();
  player.muzzle.getWorldPosition(from);
  var dir = new THREE.Vector3();
  player.gunPivot.getWorldDirection(dir);
  scopeInfo.laser = laserRange(from, dir);
  /* ★审查C7: 落点显示本就受火控门(基础主战坦克 行进间≥3s 无落点、高阶装甲载具 状态保持 0.5s)——
     隐藏期照跑全额 simulateImpact(≤140 步弹道积分)纯浪费; 99 例外保留(其 LWS 落点解算以 point 为瞄准源)。 */
  var imp = (player.kind === '99' || _fcsOkVal) ? simulateImpact(from, dir, effectiveShellSpeed(player)) : null;
  scopeInfo.point = imp ? imp.point : null;
  scopeInfo.rkPointL = null;
  scopeInfo.rkPointR = null;
  scopeInfo._mDir = _siD.copy(dir);
  scopeInfo._mPos = _siP.copy(from);
  scopeInfo.impDist = imp ? imp.dist : 0;
  scopeInfo.tof = imp ? imp.tof : 0;
}

var _fcsState = null, _fcsT = 0, _fcsPrevT = -1;   // 火控计算机状态机(移动/静止保持时长)
var _scopeArtyTop = false;                         // 火箭炮俯视火控 class 边沿写状态
function scopeHudUpdate() {
  var on = scopeT > 0.06;
  if (on !== el.scope._on) {
    el.scope._on = on;
    if (on) el.scope.classList.remove('hidden');
    else {
      el.scope.classList.add('hidden');
      if (el.impact) el.impact.style.display = 'none';
      if (el.impactRkL) el.impactRkL.style.display = 'none';
      if (el.impactRkR) el.impactRkR.style.display = 'none';
    }
  }
  /* 火箭炮俯视火控:FPS 镜框美术(圈/暗角/十字丝/倍率盘)整体隐藏,系统光标恢复(CSS #scope.artytop / body.artytop 联动) */
  var artyTop = !!(player && player.alive && player.kind === 'arty' && scopeT > 0.5);
  if (artyTop !== _scopeArtyTop) {
    _scopeArtyTop = artyTop;
    if (el.scope) el.scope.classList.toggle('artytop', artyTop);
    if (document && document.body) document.body.classList.toggle('artytop', artyTop);
  }

  var isHeli = player && player.alive && isHeliVehicle(player);
  var curWp = isHeli ? (player._heliWeapon || 3) : 1;

  // 火控状态:未安装科技的 RED-MBT-1 仍是人工装表(静止3s);安装火控计算机后沿用已有计算机链路(0.5s)。
  // 99/89/M1 与直升机的原有计算机规则不变；压制只关断原本属于计算机的载具。
  var _fcsDt = (_fcsPrevT < 0) ? 0 : Math.min(0.1, Math.max(0, gameT - _fcsPrevT)); _fcsPrevT = gameT;
  var _fcsOk = true;
  if (player && player.alive && !isHeli && player.kind !== 'arty') {
    var _mv = Math.abs(player.speed || 0) > 0.5;
    var _playerTankFcs = player.kind === 'tank' && typeof vehicleTechInstalled === 'function' && vehicleTechInstalled(player, 'fcs');
    if (_fcsState === null || _fcsState !== _mv) { _fcsState = _mv; _fcsT = 0; }
    _fcsT += _fcsDt;
    _fcsOk = (player.kind === 'tank' && !_playerTankFcs) ? (!_mv && _fcsT >= 3.0) : (_fcsT >= 0.5);
    if (player._laserSuppressed && (player.kind !== 'tank' || _playerTankFcs)) _fcsOk = false;
  }
  _fcsOkVal = _fcsOk;                  // ★审查C7: 供 updateScopeInfo(先于本函数)读的上帧门

  // 1. 直升机火箭弹专属: 左右双火箭巢独立炮口指示器 (#chRkL, #chRkR)
  if (isHeli && curWp === 2 && player.kind !== 'wz10') {
    if (el.chRkL && el.chRkR) {
      camera.updateMatrixWorld();
      var fromL = heliRocketPodOrigin(player, 0);
      var fromR = heliRocketPodOrigin(player, 1);
      var fireDir = heliBodyAxisDir(player, new THREE.Vector3());   // 炮口真实指向=机身长轴(固定式火箭巢)

      var boreL = fromL.clone().addScaledVector(fireDir, 60).project(camera);
      if (boreL.z < 1 && Math.abs(boreL.x) < 1.15 && Math.abs(boreL.y) < 1.15) {
        var bxL = (boreL.x * 0.5 + 0.5) * innerWidth, byL = (-boreL.y * 0.5 + 0.5) * innerHeight;
        var _sLX = bxL.toFixed(1) + 'px', _sLY = byL.toFixed(1) + 'px';   // ★审查C4: 全部样式写值门(同值零突变; 原版 off 分支每帧无条件 display='none')
        if (el.chRkL.style.left !== _sLX) el.chRkL.style.left = _sLX;
        if (el.chRkL.style.top !== _sLY) el.chRkL.style.top = _sLY;
        if (el.chRkL.style.display !== 'block') el.chRkL.style.display = 'block';
      } else {
        if (el.chRkL.style.display !== 'none') el.chRkL.style.display = 'none';
      }

      var boreR = fromR.clone().addScaledVector(fireDir, 60).project(camera);
      if (boreR.z < 1 && Math.abs(boreR.x) < 1.15 && Math.abs(boreR.y) < 1.15) {
        var bxR = (boreR.x * 0.5 + 0.5) * innerWidth, byR = (-boreR.y * 0.5 + 0.5) * innerHeight;
        var _sRX = bxR.toFixed(1) + 'px', _sRY = byR.toFixed(1) + 'px';   // ★审查C4: 同上
        if (el.chRkR.style.left !== _sRX) el.chRkR.style.left = _sRX;
        if (el.chRkR.style.top !== _sRY) el.chRkR.style.top = _sRY;
        if (el.chRkR.style.display !== 'block') el.chRkR.style.display = 'block';
      } else {
        if (el.chRkR.style.display !== 'none') el.chRkR.style.display = 'none';
      }
    }
  } else {
    if (el.chRkL && el.chRkL.style.display !== 'none') el.chRkL.style.display = 'none';   // ★审查C4: 值门(对齐 impact 系既有写法)
    if (el.chRkR && el.chRkR.style.display !== 'none') el.chRkR.style.display = 'none';
  }

  if (!scoped) return;

  var L = scopeInfo.laser;
  var _rt = '';
  if (player && player.kind === 'arty') {
    _rt = scopeInfo.point
      ? ('LAID ' + scopeInfo.laser.toFixed(0) + ' m - 1ST IMPACT ' + scopeInfo.impDist.toFixed(0) +
         ' m - TOF ' + scopeInfo.tof.toFixed(1) + ' s - BLAST R ' + artyCoverageRadius(player).toFixed(0) + ' m' +
         (!scopeInfo.reach ? ' [!] OUT OF RANGE, SHOWING 1ST IMPACT' : ''))
      : 'LAYING...';
    if (el.rangeinfo._last !== _rt) { el.rangeinfo._last = _rt; el.rangeinfo.textContent = _rt; }
  } else if (isHeli && curWp === 3) {
    // 导弹模式: 仅显示激光测距,无任何炮弹落点
    _rt = (L === Infinity || L > 20000) ? 'RANGE --- m' : ('RANGE ' + L.toFixed(0) + ' m');   // 直升机=计算机解算(标注按需求仅留注释, 不显示)
    if (el.rangeinfo._last !== _rt) { el.rangeinfo._last = _rt; el.rangeinfo.textContent = _rt; }
  } else if (isHeli && curWp === 2) {
    // 火箭弹模式: 呈现测距与航空火箭双落点弹道信息
    var txtR = (L === Infinity || L > 2000) ? 'RANGE --- m' : ('RANGE ' + L.toFixed(0) + ' m');
    if (scopeInfo.point) txtR += ' - RKT IMPACT ' + scopeInfo.impDist.toFixed(0) + ' m - TOF ' + scopeInfo.tof.toFixed(1) + ' s';
    // 火箭弹模式=计算机解算(标注按需求仅留注释, 不显示)
    if (el.rangeinfo._last !== txtR) { el.rangeinfo._last = txtR; el.rangeinfo.textContent = txtR; }
  } else {
    var _fcsLabel = (typeof vehicleTechScopeBallisticText === 'function')
      ? vehicleTechScopeBallisticText(player, scopeInfo.impDist || L)
      : '';
    var _tankFcsInstalled = player && player.kind === 'tank' && typeof vehicleTechInstalled === 'function' && vehicleTechInstalled(player, 'fcs');
    if (!isHeli && player._laserSuppressed && (player.kind !== 'tank' || _tankFcsInstalled)) {
      var _supTxt = '-- LASER SUPPRESSED --';
      if (el.rangeinfo._last !== _supTxt) { el.rangeinfo._last = _supTxt; el.rangeinfo.textContent = _supTxt; }
    } else if (!isHeli && !_fcsOk) {
      if (el.rangeinfo._last !== '') { el.rangeinfo._last = ''; el.rangeinfo.textContent = ''; }   // 解算未完成: 无测距信息
    } else {
      var txt = (L === Infinity || L > 2000) ? 'RANGE --- m' : ('RANGE ' + L.toFixed(0) + ' m');
      if (scopeInfo.point) txt += ' - IMPACT ' + scopeInfo.impDist.toFixed(0) + ' m - TOF ' + scopeInfo.tof.toFixed(1) + ' s';
      if (_fcsLabel) txt += ' - ' + _fcsLabel;
      if (el.rangeinfo._last !== txt) { el.rangeinfo._last = txt; el.rangeinfo.textContent = txt; }
    }
  }

// 炮镜倍率表盘建盘(一次):20刻度300°张角(-150°..+150°),12主刻度配×N数字;span随盘转(指针读数=顶部)
function buildScopeDial(d) {
  for (var z = 1; z <= 20; z++) {
    var a = -150 + (z - 1) / 19 * 300;
    var maj = (z <= 6 || z === 8 || z === 10 || z === 12 || z === 14 || z === 16 || z === 20);
    var tk = document.createElement('div');
    tk.className = 'dtick' + (maj ? ' maj' : '');
    tk.style.transform = 'rotate(' + a + 'deg)';
    d.appendChild(tk);
    if (maj) {
      var lb = document.createElement('div');
      lb.className = 'dlab'; lb.style.transform = 'rotate(' + a + 'deg)';
      var sp = document.createElement('span'); sp.textContent = '×' + z;
      lb.appendChild(sp); d.appendChild(lb);
    }
  }
}
  if (el.scopedial && el.scopedial._lastZ !== scopeZoom) {   // 表盘随倍率旋转(去抖):当前倍率刻度转至顶部指针
    el.scopedial._lastZ = scopeZoom;
    if (!el.scopedial._built) { el.scopedial._built = true; buildScopeDial(el.scopedial); }
    el.scopedial.style.transform = 'rotate(' + (150 - (scopeZoom - 1) / 19 * 300) + 'deg)';
  }

  // 2. 炮镜落点指示器显隐控制 (每种武器独立)
  if ((player && player.kind === 'arty') || (isHeli && (curWp === 3 || (curWp === 2 && player.kind === 'wz10')))) {
    // 火箭炮与直升机导弹模式:彻底隐藏全部落点指示器
    if (el.impact && el.impact.style.display !== 'none') el.impact.style.display = 'none';
    if (el.impactRkL && el.impactRkL.style.display !== 'none') el.impactRkL.style.display = 'none';
    if (el.impactRkR && el.impactRkR.style.display !== 'none') el.impactRkR.style.display = 'none';
  } else if (isHeli && curWp === 2) {
    // 火箭弹模式: 隐藏单管机炮 impact,呈现左右两个独立的火箭弹落点指示器
    if (el.impact && el.impact.style.display !== 'none') el.impact.style.display = 'none';
    camera.updateMatrixWorld();

    if (el.impactRkL && scopeInfo.rkPointL) {
      var scrL = scopeInfo.rkPointL.clone().project(camera);
      if (scrL.z < 1 && Math.abs(scrL.x) < 1 && Math.abs(scrL.y) < 1) {
        el.impactRkL.style.left = ((scrL.x * 0.5 + 0.5) * innerWidth).toFixed(1) + 'px';
        el.impactRkL.style.top = ((-scrL.y * 0.5 + 0.5) * innerHeight).toFixed(1) + 'px';
        el.impactRkL.style.display = 'block';
      } else {
        el.impactRkL.style.display = 'none';
      }
    } else if (el.impactRkL) {
      el.impactRkL.style.display = 'none';
    }

    if (el.impactRkR && scopeInfo.rkPointR) {
      var scrR = scopeInfo.rkPointR.clone().project(camera);
      if (scrR.z < 1 && Math.abs(scrR.x) < 1 && Math.abs(scrR.y) < 1) {
        el.impactRkR.style.left = ((scrR.x * 0.5 + 0.5) * innerWidth).toFixed(1) + 'px';
        el.impactRkR.style.top = ((-scrR.y * 0.5 + 0.5) * innerHeight).toFixed(1) + 'px';
        el.impactRkR.style.display = 'block';
      } else {
        el.impactRkR.style.display = 'none';
      }
    } else if (el.impactRkR) {
      el.impactRkR.style.display = 'none';
    }
  } else if (scopeInfo.point && (isHeli || _fcsOk)) {
    // 常规机炮/主炮模式: 隐藏火箭双落点,呈现机炮单落点 (05: 地面载具须火控解算完成)
    if (el.impactRkL) el.impactRkL.style.display = 'none';
    if (el.impactRkR) el.impactRkR.style.display = 'none';

    camera.updateMatrixWorld();
    var impW = scopeInfo.point;
    if (scopeInfo._mDir && player) {
      player.gunPivot.getWorldDirection(_siD2);
      _siQ.setFromUnitVectors(scopeInfo._mDir, _siD2);
      player.gunPivot.getWorldPosition(_siV);
      impW = _siV2.copy(scopeInfo.point).sub(scopeInfo._mPos).applyQuaternion(_siQ).add(_siV);
    }
    var ringRW = (scopeInfo.impDist || 0) * aiBaseDispersion(player, scopeInfo.impDist || 100);
    if (ringRW > 0.01) {
      camera.getWorldDirection(_rgD);
      _rgR.set(_rgD.z, 0, -_rgD.x);
      var rgl = _rgR.length();
      if (rgl > 0.05) {
        _rgR.divideScalar(rgl);
        _rgA.copy(impW).addScaledVector(_rgR, ringRW).project(camera);
        _rgB.copy(impW).addScaledVector(_rgR, -ringRW).project(camera);
        var dpxR = Math.sqrt(((_rgA.x - _rgB.x) * innerWidth * 0.5)*((_rgA.x - _rgB.x) * innerWidth * 0.5)+((_rgA.y - _rgB.y) * innerHeight * 0.5)*((_rgA.y - _rgB.y) * innerHeight * 0.5));
        var isz = clamp(dpxR * 2, 16, Math.sqrt((innerWidth)*(innerWidth)+(innerHeight)*(innerHeight)) * 0.9);
        if (Math.abs((el.impact._sz || 16) - isz) > 0.5) {
          el.impact._sz = isz;
          el.impact.style.width = isz + 'px';
          el.impact.style.height = isz + 'px';
          el.impact.style.margin = (-isz * 0.5) + 'px 0 0 ' + (-isz * 0.5) + 'px';
        }
      }
    }
    scopeV.copy(impW).project(camera);
    if (scopeV.z < 1 && Math.abs(scopeV.x) < 1 && Math.abs(scopeV.y) < 1) {
      var _ix = ((scopeV.x * 0.5 + 0.5) * innerWidth) + 'px', _iy = ((-scopeV.y * 0.5 + 0.5) * innerHeight) + 'px';
      if (el.impact._l !== _ix) { el.impact._l = _ix; el.impact.style.left = _ix; }
      if (el.impact._t !== _iy) { el.impact._t = _iy; el.impact.style.top = _iy; }
      if (el.impact.style.display !== 'block') el.impact.style.display = 'block';
    } else if (el.impact.style.display !== 'none') {
      el.impact.style.display = 'none';
    }
  } else {
    if (el.impact && el.impact.style.display !== 'none') el.impact.style.display = 'none';
    if (el.impactRkL && el.impactRkL.style.display !== 'none') el.impactRkL.style.display = 'none';
    if (el.impactRkR && el.impactRkR.style.display !== 'none') el.impactRkR.style.display = 'none';
  }
}

