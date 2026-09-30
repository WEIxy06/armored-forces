/* ============================================================
   BATTLEFIELD ATMOSPHERE ENHANCEMENT SUITE (V2)
   - Scheme A: Pre-seeded Historical Bombardment Craters & Scorched Earth
   - Scheme B: Billboard Anti-tank Fortifications (Czech Hedgehogs & Dragon's Teeth)
     * 纸板贴图风格 (与树木花草统一美术规范)
     * 免疫载具碾压，但会被火箭弹/重炮爆炸摧毁
   - Scheme C: Horizon Battle Smoke Plumes & Battlefield Haze
   ============================================================ */

(function () {
  'use strict';

  var _hedgehogMesh = null;
  var _dragonTeethMesh = null;
  var _hedgehogTex = null;
  var _dragonTeethTex = null;

  var _fortList = []; // [{ type: 'h'|'d', x, y, z, w, h, state: 0(存活)/1(破坏中)/2(已毁), crumbleT: 0, sink: 0 }]
  var HEDGEHOG_MAX = 72;
  var DRAGON_TEETH_MAX = 100;

  var _smokeMesh = null;
  var _smokeBaseMesh = null;
  var _smokePositions = [];
  var _smokeTime = 0;

  var SMOKE_COLUMNS_COUNT = 7;
  var PUFFS_PER_COLUMN = 8;
  var TOTAL_SMOKE_PUFFS = SMOKE_COLUMNS_COUNT * PUFFS_PER_COLUMN;

  /* ============================================================
     方案 A：开局预种交火带历史战痕 (Pre-seeded Historical Craters)
     ============================================================ */
  function seedBattlefieldScars(seed) {
    if (typeof queueCrater !== 'function' || typeof flushCraters !== 'function') return;
    if (typeof groundChunks === 'undefined' || !groundChunks.length) return;

    var seedNum = (typeof hashSeed === 'function') ? hashSeed(String(seed || '0')) : 12345;
    var rng = (typeof mulberry32 === 'function') ? mulberry32(seedNum + 1944) : Math.random;

    var numCraters = 38;
    var halfW = ((typeof MAP !== 'undefined' && MAP.halfW) ? MAP.halfW : 1000) * 0.68;
    var zoneZ = 240; // 聚焦在双方前线中轴带 [-240, 240]

    for (var i = 0; i < numCraters; i++) {
      var cx = (rng() * 2 - 1) * halfW;
      var cz = (rng() * 2 - 1) * zoneZ;

      // 避开大本营中央与出生点核心区
      if (Math.abs(cz) > 170 && Math.abs(cx) < 160) continue;

      // 散布弹坑半径: 14m ~ 32m 不等
      var rSp = 14.0 + rng() * 18.0;
      queueCrater(cx, cz, rSp);
    }

    // 同步冲压完所有开局预设弹坑
    var safety = 0;
    while ((craterQueue.length > 0 || (typeof _cfPart !== 'undefined' && _cfPart)) && safety++ < 300) {
      flushCraters();
    }

    // 确保所有脏块全部上传到 GPU
    if (typeof chunkDirty !== 'undefined' && typeof groundChunks !== 'undefined') {
      for (var cD = 0; cD < chunkDirty.length; cD++) {
        if (chunkDirty[cD]) {
          chunkDirty[cD] = 0;
          var gc = groundChunks[cD];
          if (gc) {
            gc.pos.needsUpdate = true;
            gc.col.needsUpdate = true;
            gc.nrm.needsUpdate = true;
            if (gc.rock) gc.rock.needsUpdate = true;
            if (gc.geo.computeBoundingSphere) gc.geo.computeBoundingSphere();
          }
        }
      }
    }
  }

  /* ============================================================
     方案 B：贴图化反坦克防御工事 (纸板卡通风格，参考树木/花草实现)
     - 免疫载具碾压 (坦克穿行不阻碍、不压坏)
     - 被火箭弹/炮击爆炸彻底摧毁
     ============================================================ */

  // 1. 捷克拒马手绘纸板贴图 (256x256)
  function _createHedgehogBillboardTex() {
    if (_hedgehogTex) return _hedgehogTex;
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    var g = cv.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.lineJoin = 'round'; g.lineCap = 'round';

    var INK = '#141210';

    // 底部阴影
    g.fillStyle = 'rgba(12, 10, 8, 0.45)';
    g.beginPath();
    g.ellipse(128, 238, 70, 14, 0, 0, Math.PI * 2);
    g.fill();

    // 辅助画粗工字钢梁
    function drawBeam(x1, y1, x2, y2, w, colSteel, colHighlight) {
      var dx = x2 - x1, dy = y2 - y1;
      var len = Math.sqrt(dx * dx + dy * dy);
      var nx = -dy / len * (w * 0.5), ny = dx / len * (w * 0.5);

      // 墨线边框
      g.strokeStyle = INK;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(x1 - nx, y1 - ny);
      g.lineTo(x2 - nx, y2 - ny);
      g.lineTo(x2 + nx, y2 + ny);
      g.lineTo(x1 + nx, y1 + ny);
      g.closePath();
      g.stroke();

      // 钢梁主体填充
      g.fillStyle = colSteel;
      g.fill();

      // 侧翼受光条带
      g.strokeStyle = colHighlight;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x1 - nx * 0.5, y1 - ny * 0.5);
      g.lineTo(x2 - nx * 0.5, y2 - ny * 0.5);
      g.stroke();
    }

    // 后景倾斜钢梁 (深灰)
    drawBeam(64, 50, 192, 230, 22, '#2e3338', '#454c54');
    // 前景交叉钢梁 (主受光面)
    drawBeam(192, 50, 64, 230, 22, '#3a4148', '#58616b');
    // 水平横贯加固钢梁
    drawBeam(38, 145, 218, 145, 20, '#343a40', '#505862');

    // 中心加固三角垫板与重型铆钉
    g.fillStyle = INK;
    g.beginPath();
    g.arc(128, 145, 22, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = '#4e555e';
    g.beginPath();
    g.arc(128, 145, 18, 0, Math.PI * 2);
    g.fill();

    // 铆钉圆点
    g.fillStyle = '#1c1e22';
    var rivets = [[120, 137], [136, 137], [128, 153], [128, 145]];
    for (var r = 0; r < rivets.length; r++) {
      g.beginPath();
      g.arc(rivets[r][0], rivets[r][1], 3.2, 0, Math.PI * 2);
      g.fill();
    }

    // 铁锈斑驳细节
    g.fillStyle = '#7a4220';
    g.beginPath(); g.arc(88, 145, 4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(162, 148, 4.5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(120, 190, 5, 0, Math.PI * 2); g.fill();

    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    _hedgehogTex = tex;
    return tex;
  }

  // 2. 反坦克龙齿手绘纸板贴图 (256x256)
  function _createDragonTeethBillboardTex() {
    if (_dragonTeethTex) return _dragonTeethTex;
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    var g = cv.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.lineJoin = 'round'; g.lineCap = 'round';

    var INK = '#141210';

    // 底部接触阴影
    g.fillStyle = 'rgba(12, 10, 8, 0.45)';
    g.beginPath();
    g.ellipse(128, 236, 68, 14, 0, 0, Math.PI * 2);
    g.fill();

    // 整体金字塔形轮廓外边框
    g.strokeStyle = INK;
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(56, 232);
    g.lineTo(108, 48);
    g.lineTo(148, 48);
    g.lineTo(200, 232);
    g.closePath();
    g.stroke();

    // 左侧受光面 (浅水泥灰)
    g.fillStyle = '#969c94';
    g.beginPath();
    g.moveTo(56, 232);
    g.lineTo(108, 48);
    g.lineTo(128, 48);
    g.lineTo(128, 232);
    g.closePath();
    g.fill();
    g.stroke();

    // 右侧背光阴影面 (深水泥灰)
    g.fillStyle = '#5c625a';
    g.beginPath();
    g.moveTo(128, 48);
    g.lineTo(148, 48);
    g.lineTo(200, 232);
    g.lineTo(128, 232);
    g.closePath();
    g.fill();
    g.stroke();

    // 顶端平整截面 (中度灰)
    g.fillStyle = '#7a8078';
    g.beginPath();
    g.moveTo(108, 48);
    g.lineTo(148, 48);
    g.lineTo(144, 58);
    g.lineTo(112, 58);
    g.closePath();
    g.fill();
    g.stroke();

    // 水泥崩裂磨损纹路
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(96, 120); g.lineTo(105, 134); g.lineTo(98, 148);
    g.moveTo(150, 160); g.lineTo(162, 172);
    g.stroke();

    // 底部苔藓与泥土污渍
    g.fillStyle = 'rgba(70, 72, 52, 0.65)';
    g.beginPath();
    g.moveTo(56, 232);
    g.quadraticCurveTo(128, 206, 200, 232);
    g.lineTo(56, 232);
    g.fill();

    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    _dragonTeethTex = tex;
    return tex;
  }

  function buildFortifications(seed) {
    if (typeof scene === 'undefined' || !scene) return;
    disposeFortifications();

    var seedNum = (typeof hashSeed === 'function') ? hashSeed(String(seed || '0')) : 54321;
    var rng = (typeof mulberry32 === 'function') ? mulberry32(seedNum + 888) : Math.random;

    _fortList = [];

    // 基础轴心贴地的 1x1 平面片 (y in [0, 1])
    var pGeo = new THREE.PlaneGeometry(1, 1);
    pGeo.translate(0, 0.5, 0);

    var hTex = _createHedgehogBillboardTex();
    var hMat = new THREE.MeshBasicMaterial({
      map: hTex,
      transparent: true,
      alphaTest: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true
    });
    _hedgehogMesh = new THREE.InstancedMesh(pGeo, hMat, HEDGEHOG_MAX);
    _hedgehogMesh.frustumCulled = false;
    _hedgehogMesh.renderOrder = 4;

    var dTex = _createDragonTeethBillboardTex();
    var dMat = new THREE.MeshBasicMaterial({
      map: dTex,
      transparent: true,
      alphaTest: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true
    });
    _dragonTeethMesh = new THREE.InstancedMesh(pGeo, dMat, DRAGON_TEETH_MAX);
    _dragonTeethMesh.frustumCulled = false;
    _dragonTeethMesh.renderOrder = 4;

    var halfW = ((typeof MAP !== 'undefined' && MAP.halfW) ? MAP.halfW : 1000) * 0.72;

    // 1. 布设捷克拒马贴图
    var hIdx = 0;
    var beltsZ = [-140, -60, 60, 140];
    for (var b = 0; b < beltsZ.length; b++) {
      var baseZ = beltsZ[b];
      var countInBelt = Math.floor(HEDGEHOG_MAX / beltsZ.length);
      for (var ci = 0; ci < countInBelt && hIdx < HEDGEHOG_MAX; ci++) {
        var x = (rng() * 2 - 1) * halfW;
        var z = baseZ + (rng() * 2 - 1) * 35;
        // 留出中央主通行干道
        if (Math.abs(x) < 38) continue;

        var y = (typeof terrainH === 'function') ? terrainH(x, z) : 0;
        var s = 0.9 + rng() * 0.35;
        var w = 2.2 * s, h = 1.85 * s;

        _fortList.push({
          type: 'h',
          slot: hIdx++,
          x: x, y: y, z: z,
          w: w, h: h,
          state: 0, // 0=正常, 1=摧毁倒塌中, 2=已消失
          crumbleT: 0
        });
      }
    }
    _hedgehogMesh.count = hIdx;

    // 2. 布设反坦克龙齿贴图
    var dIdx = 0;
    var dBelts = [-160, 160];
    for (var db = 0; db < dBelts.length; db++) {
      var dzBase = dBelts[db];
      var dCount = Math.floor(DRAGON_TEETH_MAX / dBelts.length);
      for (var di = 0; di < dCount && dIdx < DRAGON_TEETH_MAX; di++) {
        var dx = (rng() * 2 - 1) * halfW;
        var dz = dzBase + (rng() * 2 - 1) * 25;
        if (Math.abs(dx) < 40) continue;

        var dy = (typeof terrainH === 'function') ? terrainH(dx, dz) : 0;
        var ds = 0.92 + rng() * 0.32;
        var dw = 1.65 * ds, dh = 1.45 * ds;

        _fortList.push({
          type: 'd',
          slot: dIdx++,
          x: dx, y: dy, z: dz,
          w: dw, h: dh,
          state: 0,
          crumbleT: 0
        });
      }
    }
    _dragonTeethMesh.count = dIdx;

    scene.add(_hedgehogMesh);
    scene.add(_dragonTeethMesh);
  }

  // ★ 核心规则：仅被火箭弹/重炮爆炸摧毁，车辆碾压不触发
  function destroyFortificationsInRadius(x, z, r) {
    if (!_fortList || !_fortList.length) return;
    var r2 = r * r;
    var hitAny = false;

    for (var i = 0; i < _fortList.length; i++) {
      var fort = _fortList[i];
      if (fort.state !== 0) continue;

      var dx = fort.x - x;
      var dz = fort.z - z;
      if (dx * dx + dz * dz <= r2) {
        fort.state = 1; // 触发坍塌/炸毁收缩
        fort.crumbleT = 0;
        hitAny = true;
        // 碎屑飞溅烟尘
        if (typeof comicGroundDust === 'function') {
          comicGroundDust(fort.x, fort.y + 0.3, fort.z, false);
        }
      }
    }
    return hitAny;
  }

  function updateFortifications(dt) {
    if (!_hedgehogMesh || !_dragonTeethMesh || !_fortList.length) return;

    var cam = (typeof camera !== 'undefined') ? camera : null;
    var camX = cam ? cam.position.x : 0;
    var camZ = cam ? cam.position.z : 0;

    var m4 = new THREE.Matrix4();
    var pos = new THREE.Vector3();
    var euler = new THREE.Euler();
    var quat = new THREE.Quaternion();
    var sc = new THREE.Vector3();

    var hCount = 0;
    var dCount = 0;

    for (var i = 0; i < _fortList.length; i++) {
      var fort = _fortList[i];
      if (fort.state === 2) continue; // 已彻底炸没

      var scaleFactor = 1.0;
      var yOffset = 0.0;

      // 处于被火箭弹炸毁倒塌动画中 (0.32s 缩没下陷)
      if (fort.state === 1) {
        fort.crumbleT += (dt || 0.016) / 0.32;
        if (fort.crumbleT >= 1.0) {
          fort.state = 2;
          continue;
        }
        scaleFactor = Math.max(0.01, 1.0 - fort.crumbleT);
        yOffset = -fort.crumbleT * 0.35;
      }

      // Billboard 面向相机 (同树木/花草的视觉朝向模式)
      var yaw = Math.atan2(camX - fort.x, camZ - fort.z);
      euler.set(0, yaw, 0, 'YXZ');
      quat.setFromEuler(euler);

      pos.set(fort.x, fort.y + yOffset, fort.z);
      sc.set(fort.w * scaleFactor, fort.h * scaleFactor, 1);
      m4.compose(pos, quat, sc);

      if (fort.type === 'h') {
        _hedgehogMesh.setMatrixAt(hCount++, m4);
      } else {
        _dragonTeethMesh.setMatrixAt(dCount++, m4);
      }
    }

    _hedgehogMesh.count = hCount;
    _dragonTeethMesh.count = dCount;

    if (hCount > 0) _hedgehogMesh.instanceMatrix.needsUpdate = true;
    if (dCount > 0) _dragonTeethMesh.instanceMatrix.needsUpdate = true;
  }

  function disposeFortifications() {
    if (_hedgehogMesh) {
      if (_hedgehogMesh.parent) _hedgehogMesh.parent.remove(_hedgehogMesh);
      if (_hedgehogMesh.geometry) _hedgehogMesh.geometry.dispose();
      if (_hedgehogMesh.material) _hedgehogMesh.material.dispose();
      _hedgehogMesh = null;
    }
    if (_dragonTeethMesh) {
      if (_dragonTeethMesh.parent) _dragonTeethMesh.parent.remove(_dragonTeethMesh);
      if (_dragonTeethMesh.geometry) _dragonTeethMesh.geometry.dispose();
      if (_dragonTeethMesh.material) _dragonTeethMesh.material.dispose();
      _dragonTeethMesh = null;
    }
    _fortList = [];
  }

  /* ============================================================
     方案 C：远景战火黑烟柱 (Horizon War Smoke Plumes)
     ============================================================ */

  // 程序化绘制浓密水墨/战地黑色浓烟贴图
  function createSmokePuffTexture() {
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);

    var grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
    grad.addColorStop(0, 'rgba(28, 26, 24, 0.92)');
    grad.addColorStop(0.45, 'rgba(42, 38, 35, 0.72)');
    grad.addColorStop(0.75, 'rgba(60, 56, 52, 0.35)');
    grad.addColorStop(1, 'rgba(30, 28, 26, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(20, 18, 16, 0.45)';
    ctx.beginPath();
    ctx.arc(52, 54, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(74, 68, 26, 0, Math.PI * 2);
    ctx.fill();

    var tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  // 烟柱底部灼烧焦黑与火星余烬贴图
  function createSmokeBaseTexture() {
    var cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);

    var grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
    grad.addColorStop(0, 'rgba(255, 110, 24, 0.88)'); // 核心余烬微光
    grad.addColorStop(0.3, 'rgba(180, 50, 10, 0.55)');
    grad.addColorStop(0.65, 'rgba(24, 22, 20, 0.75)'); // 焦黑
    grad.addColorStop(1, 'rgba(15, 14, 12, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();

    var tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  function buildHorizonSmoke(seed) {
    if (typeof scene === 'undefined' || !scene) return;
    disposeHorizonSmoke();

    var seedNum = (typeof hashSeed === 'function') ? hashSeed(String(seed || '0')) : 99887;
    var rng = (typeof mulberry32 === 'function') ? mulberry32(seedNum + 333) : Math.random;

    _smokePositions = [];
    var halfW = ((typeof MAP !== 'undefined' && MAP.halfW) ? MAP.halfW : 1000) * 0.82;
    var halfL = ((typeof MAP !== 'undefined' && MAP.halfL) ? MAP.halfL : 1000) * 0.82;

    var candidateCols = [
      [-halfW * 0.75, -halfL * 0.65],
      [halfW * 0.70, -halfL * 0.72],
      [-halfW * 0.82, halfL * 0.25],
      [halfW * 0.85, halfL * 0.35],
      [-halfW * 0.45, halfL * 0.75],
      [halfW * 0.55, halfL * 0.68],
      [halfW * 0.15, -halfL * 0.82]
    ];

    for (var i = 0; i < SMOKE_COLUMNS_COUNT; i++) {
      var c = candidateCols[i % candidateCols.length];
      var sx = c[0] + (rng() * 2 - 1) * 80;
      var sz = c[1] + (rng() * 2 - 1) * 80;
      var sy = (typeof terrainH === 'function') ? terrainH(sx, sz) : 0;
      _smokePositions.push({
        x: sx, y: sy, z: sz,
        windSpeed: 0.6 + rng() * 0.4,
        maxHeight: 65 + rng() * 35,
        scaleBase: 14 + rng() * 8,
        swayPhase: rng() * Math.PI * 2
      });
    }

    var pGeo = new THREE.PlaneGeometry(1, 1);
    var pMat = new THREE.MeshBasicMaterial({
      map: createSmokePuffTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.85
    });
    _smokeMesh = new THREE.InstancedMesh(pGeo, pMat, TOTAL_SMOKE_PUFFS);
    _smokeMesh.frustumCulled = false;
    _smokeMesh.renderOrder = 8;
    scene.add(_smokeMesh);

    var bGeo = new THREE.PlaneGeometry(18, 18);
    bGeo.rotateX(-Math.PI * 0.5);
    var bMat = new THREE.MeshBasicMaterial({
      map: createSmokeBaseTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.95
    });
    _smokeBaseMesh = new THREE.InstancedMesh(bGeo, bMat, SMOKE_COLUMNS_COUNT);
    _smokeBaseMesh.frustumCulled = false;
    _smokeBaseMesh.renderOrder = 5;

    var m4 = new THREE.Matrix4();
    var pos = new THREE.Vector3();
    var quat = new THREE.Quaternion();
    var sc = new THREE.Vector3(1, 1, 1);

    for (var j = 0; j < _smokePositions.length; j++) {
      var sp = _smokePositions[j];
      pos.set(sp.x, sp.y + 0.12, sp.z);
      m4.compose(pos, quat, sc);
      _smokeBaseMesh.setMatrixAt(j, m4);
    }
    _smokeBaseMesh.instanceMatrix.needsUpdate = true;
    scene.add(_smokeBaseMesh);
  }

  function updateHorizonSmoke(dt) {
    if (!_smokeMesh || !_smokePositions.length) return;
    _smokeTime += (dt || 0.016);

    var cam = (typeof camera !== 'undefined') ? camera : null;
    var camPos = cam ? cam.position : new THREE.Vector3();

    var m4 = new THREE.Matrix4();
    var pos = new THREE.Vector3();
    var quat = new THREE.Quaternion();
    var sc = new THREE.Vector3();

    var instanceIdx = 0;
    for (var c = 0; c < _smokePositions.length; c++) {
      var sp = _smokePositions[c];

      for (var p = 0; p < PUFFS_PER_COLUMN; p++) {
        var progress = ((_smokeTime * sp.windSpeed * 0.18 + (p / PUFFS_PER_COLUMN)) % 1.0);
        var curY = sp.y + progress * sp.maxHeight;

        var sway = Math.sin(_smokeTime * 0.8 + sp.swayPhase + progress * 3.14) * (progress * 16.0);
        var curX = sp.x + sway + progress * 8.0;
        var curZ = sp.z + progress * 4.0;

        var curScale = sp.scaleBase * (0.6 + progress * 2.2);

        pos.set(curX, curY, curZ);
        sc.set(curScale, curScale, 1);

        if (cam) {
          quat.setFromRotationMatrix(m4.lookAt(pos, camPos, THREE.Object3D.DefaultUp));
        }

        m4.compose(pos, quat, sc);
        _smokeMesh.setMatrixAt(instanceIdx++, m4);
      }
    }

    _smokeMesh.instanceMatrix.needsUpdate = true;
  }

  function disposeHorizonSmoke() {
    if (_smokeMesh) {
      if (_smokeMesh.parent) _smokeMesh.parent.remove(_smokeMesh);
      if (_smokeMesh.geometry) _smokeMesh.geometry.dispose();
      if (_smokeMesh.material) {
        if (_smokeMesh.material.map) _smokeMesh.material.map.dispose();
        _smokeMesh.material.dispose();
      }
      _smokeMesh = null;
    }
    if (_smokeBaseMesh) {
      if (_smokeBaseMesh.parent) _smokeBaseMesh.parent.remove(_smokeBaseMesh);
      if (_smokeBaseMesh.geometry) _smokeBaseMesh.geometry.dispose();
      if (_smokeBaseMesh.material) {
        if (_smokeBaseMesh.material.map) _smokeBaseMesh.material.map.dispose();
        _smokeBaseMesh.material.dispose();
      }
      _smokeBaseMesh = null;
    }
    _smokePositions.length = 0;
  }

  /* ============================================================
     全局生命周期接口与调度
     ============================================================ */
  function initBattlefieldAtmosphere() {
    var curSeed = (typeof MAP !== 'undefined' && MAP.seed) ? MAP.seed : '0';
    seedBattlefieldScars(curSeed);
    buildFortifications(curSeed);
    buildHorizonSmoke(curSeed);
  }

  function updateBattlefieldAtmosphere(dt) {
    updateFortifications(dt);
    updateHorizonSmoke(dt);
  }

  function clearBattlefieldAtmosphere() {
    disposeFortifications();
    disposeHorizonSmoke();
  }

  window.initBattlefieldAtmosphere = initBattlefieldAtmosphere;
  window.updateBattlefieldAtmosphere = updateBattlefieldAtmosphere;
  window.clearBattlefieldAtmosphere = clearBattlefieldAtmosphere;
  window.destroyFortificationsInRadius = destroyFortificationsInRadius;

})();
