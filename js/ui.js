var _heliRadarTopPool = [];
for (var _pi = 0; _pi < 16; _pi++) _heliRadarTopPool.push({ rt: null, key: 0 });
var _heliRadarTopCount = 0;

/* ===== Module: ui.js(桌面版构建)===== */
/* ============================================================
   模块: ui.js — UI:菜单按钮通用生成/HUD/界面
   (加载顺序由 index.html MODULES 表决定,勿单独调整)
   ============================================================ */
'use strict';
/* ============================================================
   HUD / UI
   ============================================================ */
var el = {};
function grabEls() {
  ['hud','fps','winfo','ffa-winfo','ffalive','ffkills','ffreserve','reds','blues','kills','respawns','abandonring','abandontxt','ring','hitm','flash','log','aimdot',
   'startov','pauseov','endov','endtitle','endsub','endstats',
   'lockhint','ch','scope','rangeinfo','lwsring','tlas','scopedial','sigfps','impact','impactRkL','impactRkR','chRkL','chRkR','poolr','poolb','nvd','nvn','artyring','artyringtxt','aimhint','helipitchinfo','helimissileinfol','helimissileinfor','boundwarn','heliweaponbar','heliradarlock','rwr-warning','rwr-tag','maws-edge-flash','maws-hud-layer','lwr-hud-layer',
   'respawnov','rhqrow','rkindrow','rconfirm','skrow','stylerow','siderow','moderow','mode-row','faction-row','vehicle-row','base-row','battle-mode-menu',
   'minimap-panel','minimap-cv','minimap-zone-state','minimap-scale','zone-msg','minimap-posinput','minimap-posval','minimap-sizeinput','minimap-sizeval',
   'timeinput','timeval','leninput','widinput','timeremain','roughinput','roughval','sizeinput','bdinput_tank','bdinput_arty','bdinput_heli',
   'hourinput','hourval',                                        // 时间拖动条(小时 0~24)
   'continuebtn',   // 胜利结算"继续游戏"按钮
   'possessov','posskindrow',   // 接管类型钮排
   'startsub','settingssub',   // 主菜单四视图(主/遭遇战/手册/设置)
   'startbtnrow',                                                 // 遭遇战参数子菜单:开始战斗按钮行
   'setuproot',                                                   // 遭遇战编制配置(红/蓝独立,型号输入动态生成)
    // 载具预览
   'volinput','volval',                                          // 游戏设置:音量滑块
   'bgminput','bgmval',                                          // 游戏设置:背景音乐滑块
   'crtinput','crtval',                                          // 游戏设置:CRT 滤镜强度滑块(comic.js 绑定)
   'warinput','warval'                                           // 游戏设置:战场调色强度滑块(comic.js 绑定)
  ].forEach(function (id) { el[id] = document.getElementById(id); });
}
/* ============================================================
   主菜单视图切换:主菜单 ↔ 遭遇战参数 ↔ 操作手册 ↔ 游戏设置
   Each submenu uses a shared HANGER button to return to the main menu.
   ============================================================ */
var MENU_VIEWS = ['startsub', 'settingssub'];

(function biosHudTick(){
  function pad(n){ return n<10?'0'+n:String(n); }
  var _biosC = null, _biosDb = null, _biosPct = null;   // ★审查C3: 静态启动层元素一次性缓存(原版每秒 3 次 querySelectorAll)
  function tick(){
    var now = new Date();
    if (!_biosC) { _biosC = document.querySelectorAll('.bios-clock'); _biosDb = document.querySelectorAll('.bios-sig-db'); _biosPct = document.querySelectorAll('.bios-batt-pct'); }
    var s = pad(now.getHours())+':'+pad(now.getMinutes())+':'+pad(now.getSeconds());
    for (var i=0;i<_biosC.length;i++) _biosC[i].innerHTML = s.slice(0,2)+'<span class="blink">:</span>'+s.slice(3,5)+'<span class="blink">:</span>'+s.slice(6);   // innerHTML 保留: blink span 每秒重建=现有闪烁语义逐位不变
    var v = -8 - Math.floor(Math.random()*9);
    for (var j=0;j<_biosDb.length;j++) _biosDb[j].textContent = v+'分贝';
    var p = 74 + Math.floor(Math.random()*13);
    for (var k=0;k<_biosPct.length;k++) _biosPct[k].textContent = p+'%';
  }
  tick();
  setInterval(tick, 1000);
})();

function showMenuView(name) {
  for (var i = 0; i < MENU_VIEWS.length; i++) {
    if (el[MENU_VIEWS[i]]) {
      el[MENU_VIEWS[i]].classList.toggle('hidden', MENU_VIEWS[i] !== name);
    }
  }
}
/* 返回主菜单(对局暂停菜单"主菜单"与二级菜单底部按钮共用):
   刷新页面完全清空本局,回到主菜单。切回车库。 */
function returnToMenu() {
  if (window.CrazyGamesAdapter) {
    window.CrazyGamesAdapter.gameplayStop();
  }
  if (window.uifxReturnToMenu) { window.uifxReturnToMenu(); } else { location.reload(); }
}
/* 通用"主菜单"返回按钮(暂停/二级子菜单/结算共用):
   外形=次级按钮 .bigbtn.alt(棕色平底,宽 280px 基准,样式定义见 index.html CSS);
   点击=returnToMenu(刷新回主菜单);
   opts.style 可追加(如子菜单上方间距);暂停按钮不传→间距由 #pauseov CSS 决定 */
/* ============================================================
   通用菜单按钮生成——全部 bigbtn 菜单按钮统一由本函数创建,
   仅文本/点击行为/附加样式不同(消灭 HTML 静态重复 + 分散的 addEventListener)。
   opts: { id: 元素id, cls: 附加class(如 hidden), style: {css属性:值} }
   ============================================================ */
function createMenuButton(container, text, onClick, opts) {
  var b = document.createElement('button');
  b.className = 'bigbtn' + (opts && opts.cls ? ' ' + opts.cls : '');
  b.textContent = text;
  if (opts && opts.id) b.id = opts.id;
  if (opts && opts.style) for (var sk in opts.style) b.style[sk] = opts.style[sk];
  b.addEventListener('click', onClick);
  if (container && container.appendChild) container.appendChild(b);
  return b;
}
/* ============================================================
   通用选项按钮生成——所有"选择类"按钮(阵营/载具/时间/大本营/控制区/接管)
   统一由本函数创建:默认按钮大小为 .optbtn,仅文本/选项值不同。
   attrs: {键:值} → 按钮 data-键 属性;sel: 是否初始选中。
   ============================================================ */
function createOptionButton(container, text, attrs, sel) {
  var b = document.createElement('button');
  b.className = 'optbtn' + (sel ? ' sel' : '');
  b.textContent = text;
  for (var ak in attrs) b.setAttribute('data-' + ak, attrs[ak]);
  if (container && container.appendChild) container.appendChild(b);
  return b;
}
/* 确保容器内选项按钮存在(重复调用不重复生成);defs: [{text, attrs, sel}] */
function ensureOptionButtons(container, defs) {
  if (!container || typeof container.querySelectorAll !== 'function') return null;
  if (container.querySelectorAll('button').length > 0) return null;
  var out = [];
  for (var di = 0; di < defs.length; di++) {
    var d = defs[di];
    out.push(createOptionButton(container, d.text, d.attrs, !!d.sel));
  }
  return out;
}
/* 通用选项行:幂等创建(ensureOptionButtons 守卫)+ 统一绑定点击(样板收敛)。
   defs: [{text, attrs, sel}];onClick(btn) 由调用方自读 data-* 属性。返回按钮数组。 */
function bindOptionRow(container, defs, onClick) {
  if (!container || typeof container.querySelectorAll !== 'function') return null;
  ensureOptionButtons(container, defs);
  var btns = container.querySelectorAll('button');
  for (var i = 0; i < btns.length; i++) (function (b) {
    b.addEventListener('click', function () { onClick(b); });
  })(btns[i]);
  return btns;
}
/* 选项行选中态标记:把容器内 data-attrKey === value 的按钮置 .sel,其余清除。
   一次遍历;兼容无 classList 的无头 DOM 桩(值统一转字符串比较,数字属性安全)。 */
function markSel(container, attrKey, value) {
  if (!container || typeof container.querySelectorAll !== 'function') return;
  var bs = container.querySelectorAll('button');
  for (var j = 0; j < bs.length; j++)
    if (bs[j].classList && bs[j].classList.toggle)
      bs[j].classList.toggle('sel', bs[j].getAttribute(attrKey) === String(value));
}

function bindHeliWeaponBarUI() {
  var w1 = document.getElementById('hwp-1'), w2 = document.getElementById('hwp-2'), w3 = document.getElementById('hwp-3'), w4 = document.getElementById('hwp-4');
  if (w1) w1.addEventListener('click', function() {
    if (typeof isPlayerRedTdHighExplosiveVehicle === 'function' && isPlayerRedTdHighExplosiveVehicle(player)) {
      selectRedTdWeapon(player, 1);
      if (typeof aimHint === 'function') aimHint('WEAPON [1]: AP ROUND');
      return;
    }
    if (typeof isPlayerRedMbtMissileVehicle === 'function' && isPlayerRedMbtMissileVehicle(player)) {
      selectRedMbtWeapon(player, 1);
      if (typeof aimHint === 'function') aimHint('WEAPON [1]: MAIN GUN');
      return;
    }
    if (player && (isHeliVehicle(player) || (typeof isAAVehicle === 'function' && isAAVehicle(player)))) {
      var isAA1 = typeof isAAVehicle === 'function' && isAAVehicle(player);
      var aaAtgm1 = isAA1 && (player._techAaAtgm === true ||
        (typeof vehicleTechAaAtgmInstalled === 'function' && vehicleTechAaAtgmInstalled(player)) ||
        (typeof vehicleTechRedAaAtgmInstalled === 'function' && vehicleTechRedAaAtgmInstalled(player)));
      if (isAA1 && aaAtgm1 && typeof selectAAWeapon === 'function') selectAAWeapon(player, 1);
      else {
        player._heliWeapon = 3;
        if (typeof camAimP !== 'undefined') camAimP = playerAimPitchClamp(player, camAimP);
      }
      if (typeof aimHint === 'function') aimHint(isAA1 ? 'WEAPON [1]: SAM' : 'WEAPON [1]: MISSILE');
    }
  });
  if (w2) w2.addEventListener('click', function() {
    if (typeof isPlayerRedTdHighExplosiveVehicle === 'function' && isPlayerRedTdHighExplosiveVehicle(player)) {
      selectRedTdWeapon(player, 2);
      if (typeof aimHint === 'function') aimHint('WEAPON [2]: HIGH-EXPLOSIVE');
      return;
    }
    if (typeof isPlayerRedMbtMissileVehicle === 'function' && isPlayerRedMbtMissileVehicle(player)) {
      selectRedMbtWeapon(player, 2);
      if (typeof aimHint === 'function') aimHint('WEAPON [2]: GUN-LAUNCHED MISSILE');
      return;
    }
    if (player && typeof isAAVehicle === 'function' && isAAVehicle(player)) {
      var aaAtgm2 = player._techAaAtgm === true ||
        (typeof vehicleTechAaAtgmInstalled === 'function' && vehicleTechAaAtgmInstalled(player)) ||
        (typeof vehicleTechRedAaAtgmInstalled === 'function' && vehicleTechRedAaAtgmInstalled(player));
      if (aaAtgm2 && typeof selectAAWeapon === 'function') {
        selectAAWeapon(player, 2);
        if (typeof aimHint === 'function') aimHint('WEAPON [2]: ATGM');
      } else if (player.team === 'red') {
        player._heliWeapon = 1;
        if (typeof camAimP !== 'undefined') camAimP = playerAimPitchClamp(player, camAimP);
        if (typeof aimHint === 'function') aimHint('WEAPON [2]: TWIN GUN');
      } else if (typeof aimHint === 'function') aimHint('NO GUN EQUIPPED');
      return;
    }
    if (player && isHeliVehicle(player)) {
      player._heliWeapon = 2;
      if (typeof aimHint === 'function') aimHint('WEAPON [2]: ROCKETS');
    }
  });
  if (w3) w3.addEventListener('click', function() {
    if (typeof isPlayerRedTdHighExplosiveVehicle === 'function' && isPlayerRedTdHighExplosiveVehicle(player)) return;
    if (typeof isPlayerRedMbtMissileVehicle === 'function' && isPlayerRedMbtMissileVehicle(player)) return;
    if (player && typeof isAAVehicle === 'function' && isAAVehicle(player)) {
      var aaAtgm3 = player._techAaAtgm === true ||
        (typeof vehicleTechAaAtgmInstalled === 'function' && vehicleTechAaAtgmInstalled(player)) ||
        (typeof vehicleTechRedAaAtgmInstalled === 'function' && vehicleTechRedAaAtgmInstalled(player));
      if (player.team === 'red' && aaAtgm3) {
        player._heliWeapon = 1;
        if (typeof camAimP !== 'undefined') camAimP = playerAimPitchClamp(player, camAimP);
        if (typeof aimHint === 'function') aimHint('WEAPON [3]: TWIN GUN');
      } else if (typeof aimHint === 'function') aimHint('NO GUN EQUIPPED');
      return;
    }
    if (player && isHeliVehicle(player)) {
      player._heliWeapon = 1;
      if (typeof aimHint === 'function') aimHint('WEAPON [3]: GUN');
    }
  });
  if (w4) w4.addEventListener('click', function() {
    if (player && isHeliVehicle(player) && typeof triggerHeliDecoy === 'function') triggerHeliDecoy(player);
  });
}

function refreshGameModeUI() {
  if (el.moderow) {
    // bindOptionRow 将 attrs 转成 data-* 属性；使用 data-mode 才能真正高亮当前模式。
    markSel(el.moderow, 'data-mode', currentGameMode);
  }
  var ffa = isFfaMode();
  if (typeof refreshStartControlZonesUI === 'function') refreshStartControlZonesUI();
  if (el.factionRow) el.factionRow.classList.toggle('hidden', ffa);
  if (el.baseRow) el.baseRow.classList.toggle('hidden', ffa);
  if (el.vehicleRow) {
    var key = el.vehicleRow.querySelector('.bios-key');
    if (key) key.textContent = ffa ? 'Available vehicle' : 'Vehicle';
  }
  var modeMenu = el['battle-mode-menu'];
  if (modeMenu) {
    var items = modeMenu.querySelectorAll('.battle-mode-item');
    for (var i = 0; i < items.length; i++) {
      var selected = items[i].getAttribute('data-mode') === currentGameMode;
      items[i].classList.toggle('sel', selected);
      items[i].setAttribute('aria-checked', selected ? 'true' : 'false');
    }
  }
}
function bindGameModeUI() {
  el.factionRow = el['faction-row'];
  el.baseRow = el['base-row'];
  el.vehicleRow = el['vehicle-row'];
  if (el.moderow && !el.moderow.querySelector('button')) {
    bindOptionRow(el.moderow, [
      { text: 'TEAM DEATHMATCH', attrs: { mode: GAME_MODE_TEAM }, sel: currentGameMode === GAME_MODE_TEAM },
      { text: 'FREE-FOR-ALL', attrs: { mode: GAME_MODE_FFA }, sel: currentGameMode === GAME_MODE_FFA }
    ], function (b) {
      setGameMode(b.getAttribute('data-mode'));
      if (typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
      if (typeof bindStartKindUI === 'function') bindStartKindUI(true);
      if (typeof bindStartSetupUI === 'function') bindStartSetupUI();
      refreshGameModeUI();
    });
  }
  refreshGameModeUI();
}
function prepareHangarSelection(persistCustom) {
  var activeItem = document.querySelector('#hangar-veh-list .mm-drawer-item.active');
  var ht = 'red', hk = '99';
  if (activeItem) {
    ht = activeItem.getAttribute('data-team') || 'red';
    hk = activeItem.getAttribute('data-kind') || '99';
  } else if (typeof window.Hangar3D !== 'undefined' && window.Hangar3D.getSelection) {
    var hs = window.Hangar3D.getSelection();
    if (hs) { ht = hs.team || ht; hk = hs.kind || hk; }
  }
  /* Preserve the selected faction for shared vehicle kinds.  BLUE-MLRS and
     RED-MLRS both use kind='arty'; the registry, not this UI sync point, owns
     the faction whitelist. */
  startSide = ht; startKind = hk;
  window.startSide = ht; window.startKind = hk;
  if (el.siderow && !isFfaMode()) markSel(el.siderow, 'data-side', startSide);
  if (el.skrow) markSel(el.skrow, 'data-k', startKind);
  if (typeof refreshVehicleChoiceLabels === 'function') refreshVehicleChoiceLabels();
  if (persistCustom && typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
}
/* 统一生成主菜单、开始、暂停、结算和重新部署按钮,保持按钮样式一致。 */
function buildMenuButtons() {
  bindHeliWeaponBarUI();
  if (!el.startov || !el.pauseov || !el.endov || !el.respawnov) return;

  var btnBattle = document.getElementById('menubtn-battle');
  var modeMenu = el['battle-mode-menu'];
  function launchQuickBattle(mode) {
    setGameMode(mode);
    prepareHangarSelection(false);
    ffaQuickStart = isFfaMode();  // TO BATTLE 快速入口默认不部署直升机
    startSeed = randomSeed();
    /* Both the main TO BATTLE button and its mode dropdown use this same quick
       path, so every direct default-game launch gets a fresh normal-distributed
       clock/roughness pair.  The custom DEPLOY path remains user-controlled. */
    if (typeof randomizeQuickBattleDefaults === 'function') randomizeQuickBattleDefaults();
    if (typeof SPECTATE_MATCH !== 'undefined') SPECTATE_MATCH = false;   // 快速战斗永不观战
    startGame();
    attemptLock();
  }
  if (modeMenu) {
    var modeItems = modeMenu.querySelectorAll('.battle-mode-item');
    for (var mi = 0; mi < modeItems.length; mi++) (function (item) {
      item.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        launchQuickBattle(item.getAttribute('data-mode'));
        modeMenu.classList.remove('open');
        if (btnBattle) btnBattle.setAttribute('aria-expanded', 'false');
      });
    })(modeItems[mi]);
  }
  if (btnBattle) {
    btnBattle.addEventListener('click', function () {
      launchQuickBattle(currentGameMode);
    });
  }

  var btnTac = document.getElementById('menubtn-tactical');
  if (btnTac) {
    btnTac.addEventListener('click', function () {
      /* Restore the independent custom snapshot first.  Only a brand-new install
         falls back to the historical hangar selection; quick randomization never
         becomes a custom-menu value. */
      var restored = typeof loadCustomBattleSettings === 'function' && loadCustomBattleSettings(true);
      if (!restored) {
        if (typeof resetCustomBattleDefaults === 'function') resetCustomBattleDefaults();
        prepareHangarSelection(true);
      }
      ffaQuickStart = false;  // 自定义游戏允许按面板选择直升机
      if (typeof bindStartKindUI === 'function') bindStartKindUI(true);
      if (typeof bindStartSetupUI === 'function') bindStartSetupUI();
      /* The saved snapshot is loaded before the dynamic vehicle/OOB panels are
         rebuilt.  Run one final, ordered sync after every panel exists so no
         control can retain the previous visit's DOM value. */
      if (typeof refreshCustomBattlePanel === 'function') refreshCustomBattlePanel();
      else if (typeof refreshGameModeUI === 'function') refreshGameModeUI();
      startSeed = randomSeed();
      showMenuView('startsub');
    });
  }

  var btnAchievements = document.getElementById('menubtn-achievements');
  if (btnAchievements) {
    btnAchievements.addEventListener('click', function () {
      if (window.Achievements && typeof window.Achievements.open === 'function') window.Achievements.open();
    });
  }

  var btnSettings = document.getElementById('menubtn-settings');
  if (btnSettings) {
    btnSettings.addEventListener('click', function () {
      showMenuView('settingssub');
    });
  }

  /* ===== 遭遇战参数子菜单:开始战斗(基准 280px;间距见 CSS #startbtn) ===== */
  el.startbtn = createMenuButton(el.startbtnrow || el.startsub, 'DEPLOY', function () {
    ffaQuickStart = false;
    if (typeof saveCustomBattleSettings === 'function') saveCustomBattleSettings();
    if (typeof SPECTATE_MATCH !== 'undefined') SPECTATE_MATCH = !!spectateEnabled;   // 自定义战斗:按“观战模式”选项
    startGame();
    attemptLock();
  }, { id: 'startbtn' });
  var pauseBtns = document.getElementById('pausebtns') || el.pauseov;
  el.resumebtn = createMenuButton(pauseBtns, 'RESUME', function () {
    el.pauseov.classList.add('hidden');
    gameState = 'playing';
    if (window.CrazyGamesAdapter) window.CrazyGamesAdapter.gameplayStart();
    if (typeof sfxUiDi === 'function') sfxUiDi(2);
    updateLockHint();
    attemptLock();
    /* ★修复(暂停返回后触控键全灭,摇杆除外):gameOver/startGame 两处入口都直挂 _touchUISync,
       唯独两个"回到战场"没挂 —— 触屏点按走 touchstart/touchend,click 兜底(120ms)常被
       preventDefault 吞掉而永不触发,按钮就停在结算时的 hidden 里;摇杆是触摸时
       base.classList.remove('hidden') 强制抬起的,所以看起来"只剩摇杆"。此处直接同步。 */
    if (typeof window !== 'undefined' && window._touchUISync) window._touchUISync();
  }, { id: 'resumebtn' });
  el.mainmenubtn = createMenuButton(pauseBtns, 'HANGER', returnToMenu, { id: 'mainmenubtn', cls: 'alt' });
  el.continuebtn = createMenuButton(el.endov, 'RESUME', function () {
    el.endov.classList.add('hidden');
    freePlay = true;
    gameState = 'playing';
    if (window.CrazyGamesAdapter) window.CrazyGamesAdapter.gameplayStart();
    if (player && player.alive) {
      attemptLock();
    } else {
      respawnT = 1.6;
    }
    updateLockHint();
    /* ★修复(对局结束后回到战场,除摇杆外 UI 全灭):同上,结算屏的"回到战场"同样直挂同步。
       (根因见 resumebtn 处注释;摇杆独活是因为 touchstart 感应圈分支强制 remove hidden。) */
    if (typeof window !== 'undefined' && window._touchUISync) window._touchUISync();
  }, { id: 'continuebtn', cls: 'hidden' });
  el.airSupportBtn = createMenuButton(el.endov, '★ AIR REINFORCEMENTS (+50 FORCES)', function () {
    if (typeof window.endAirSupport === 'function') {
      window.endAirSupport();
    } else {
      var mySide = typeof pSide === 'function' ? pSide() : 'red';
      if (typeof teamPool !== 'undefined') teamPool[mySide] = (teamPool[mySide] || 0) + 50;
      if (el.poolr && el.poolb && typeof updatePoolBar === 'function') updatePoolBar();
      el.endov.classList.add('hidden');
      freePlay = true;
      gameState = 'playing';
      if (typeof logMsg === 'function') logMsg('★ AIR REINFORCEMENTS ARRIVED: +50 FORCES', 'sys');
      if (window.CrazyGamesAdapter) window.CrazyGamesAdapter.gameplayStart();
      if (player && !player.alive && typeof redeployPlayer === 'function') {
        redeployPlayer();
      }
    }
  }, {
    id: 'airsupportbtn',
    cls: 'bigbtn',
    style: {
      border: '2px solid #ffd93b',
      color: '#141414',
      background: '#ffd93b',
      fontWeight: 'bold',
      boxShadow: '0 0 14px rgba(255, 217, 59, 0.6)',
      cursor: 'pointer'
    }
  });
  el.restartbtn = createMenuButton(el.endov, 'HANGER', returnToMenu, { id: 'restartbtn', cls: 'alt' });
  el.rconfirm = createMenuButton(el.respawnov, 'REDEPLOY', function () {
    redeployPlayer();
  }, { id: 'rconfirm' });
}
/* ===== 圆点光标上方战斗提示(不可发射/不可移动):纯事件触发+定时熄灭,零逐帧 ----
   触发点=开火尝试(炮管毁)/摇杆按下·WASD 按下沿(不可移动);同文案 1.2s 节流
   (按住摇杆多次触发只亮一次);红色小字+墨四向描边(命中播报同字体语言)。 ===== */
var _ahT = null, _ahLast = -99, _ahTxt = '';
function aimHint(text) {
  if (!el.aimhint) return;
  if (text === _ahTxt && gameT - _ahLast < 1.2) return;
  _ahLast = gameT; _ahTxt = text;
  el.aimhint.textContent = text;
  el.aimhint.style.opacity = '1';
  if (_ahT) clearTimeout(_ahT);
  _ahT = setTimeout(function () { el.aimhint.style.opacity = '0'; _ahTxt = ''; }, 1100);
}
/* ===== 指挥模式屏幕外小队箭头(每队员一枚,钉屏幕边缘指向队员相对方位;距离分档变色) ----
   触发器范式:指挥模式未激活=一次布尔早退+失活跑一帧隐藏收尾(模式外零成本);
   激活期每帧 ≤4 名队员(CMD_GROUP_SIZE=4)各一次相机系变换+条件投影(≈20 次乘加/人),
   DOM 写全部走量化值门(位置 1px/角度 0.02rad/颜色档沿),不变不写——总成本 <0.01ms/帧。
   队员名单每帧由 sqCmd.group.members 派生(alive 过滤):阵亡退队/编入补员自动增减箭头,零事件接线。
   屏幕内判定=透视 NDC 矩形(|x|,|y|≤0.95),画面内隐藏该箭头;出画面沿相机系方向(camX,camY;
   身后点不翻号=直指其方位)推到屏幕边缘矩形(margin 34px)钉位,箭头旋转=方向角。 ===== */
var _sqArEls = null, _sqArOn = false;
var _sqArV = null;
var SQAR_COLORS = ['#9dff6e', '#ffd21f', '#ff2d20'];   // ≤50m 绿(HUD 磷光绿)/≤100m 黄(漫画黄)/>100m 红(警示红)
function _sqArEnsure() {                                // 池惰性创建(首次进入指挥模式当帧)
  if (_sqArEls) return;
  _sqArEls = [];
  var host = document.getElementById('sqarrows');
  if (!host) return;
  _sqArV = new THREE.Vector3();
  var PATH = 'M31 17 L9 6 L14.5 17 L9 28 Z';           // 箭头体(朝 +x 的镖形;rotate 出方向)
  for (var i = 0; i < 4; i++) {                        // 池容量=CMD_GROUP_SIZE
    var d = document.createElement('div');
    d.className = 'sqarrow';
    d.innerHTML = '<svg viewBox="0 0 34 34">' +
      '<path d="' + PATH + '" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round" opacity=".8"/>' +
      '<path d="' + PATH + '" fill="#9dff6e" stroke="#141414" stroke-width="2.5" stroke-linejoin="round"/></svg>';
    host.appendChild(d);
    _sqArEls.push({ d: d, p: d.lastChild, x: -1, y: -1, a: 0, band: -1, show: false });
  }
}
function sqArrowsTick() {
  var on = typeof sqCmd !== 'undefined' && sqCmd && sqCmd.active && sqCmd.group &&
           gameState === 'playing' && player && player.alive && typeof camera !== 'undefined';
  if (!on) {                                            // 休眠闭环:失活帧统一隐藏一次,此后单布尔早退
    if (_sqArOn && _sqArEls)
      for (var q = 0; q < _sqArEls.length; q++) { _sqArEls[q].d.style.display = 'none'; _sqArEls[q].show = false; }
    _sqArOn = false;
    return;
  }
  if (!_sqArOn) { _sqArEnsure(); _sqArOn = true; }
  if (!_sqArEls) return;
  camera.updateMatrixWorld();                           // 相机矩阵本帧定稿(渲染前手动投影标准前置)
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  var W = innerWidth, H = innerHeight, m = 34;          // 边缘内收(屏边留白+箭头半径)
  var hx = W * 0.5 - m, hy = H * 0.5 - m;
  var mem = sqCmd.group.members, n = Math.min(mem.length, 4), k, i;
  var pp = player.group.position;
  for (k = 0; k < 4; k++) {
    var S = _sqArEls[k];
    if (k >= n) {                                       // 名单变短:余池箭头隐藏
      if (S.show) { S.d.style.display = 'none'; S.show = false; }
      continue;
    }
    var t = mem[k];
    if (!t || !t.alive || !t.group) {                   // 名单瞬时空洞(阵亡当帧):隐藏待名单收敛
      if (S.show) { S.d.style.display = 'none'; S.show = false; }
      continue;
    }
    var p = t.group.position;
    _sqArV.set(p.x, p.y + 1.6, p.z).applyMatrix4(camera.matrixWorldInverse);   // 相机系(取车体中心高)
    var cx = _sqArV.x, cy = _sqArV.y, vis = false;
    if (_sqArV.z < 0) {                                 // 视锥前方才有上屏可能;applyMatrix4 含透视除法
      _sqArV.applyMatrix4(camera.projectionMatrix);     // → NDC
      if (_sqArV.x >= -0.95 && _sqArV.x <= 0.95 && _sqArV.y >= -0.95 && _sqArV.y <= 0.95) vis = true;
    }
    if (vis) {                                          // 画面内:隐藏(值门)
      if (S.show) { S.d.style.display = 'none'; S.show = false; }
      continue;
    }
    var dx = cx, dy = -cy;                              // 屏幕系方向(y 向下;身后点同号=直指方位)
    var dl = Math.sqrt(dx * dx + dy * dy);
    if (dl < 1e-4) { dx = 1; dy = 0; dl = 1; }          // 正后方轴线上方向退化:任取一向(右)
    var il = 1 / dl;
    dx *= il; dy *= il;
    var tE = Math.min(hx / (Math.abs(dx) + 1e-6), hy / (Math.abs(dy) + 1e-6));   // 推到边缘矩形
    var x = W * 0.5 + dx * tE, y = H * 0.5 + dy * tE;
    var ddx = p.x - pp.x, ddz = p.z - pp.z, d2 = ddx * ddx + ddz * ddz;          // 平面距离(与战斗距离同口径)
    var band = d2 <= 2500 ? 0 : (d2 <= 10000 ? 1 : 2);  // 50m/100m 分档(平方比较免开方)
    var qi = x | 0, qj = y | 0, qa = Math.round(Math.atan2(dy, dx) * 50);        // 1px/0.02rad 量化
    if (!S.show || qi !== S.x || qj !== S.y || qa !== S.a) {
      S.x = qi; S.y = qj; S.a = qa; S.show = true;
      S.d.style.display = 'block';
      S.d.style.transform = 'translate(' + qi + 'px,' + qj + 'px) rotate(' + (qa / 50) + 'rad)';
    }
    if (band !== S.band) { S.band = band; S.p.setAttribute('fill', SQAR_COLORS[band]); }
  }
}
function addLog(html, cls) {
  var d = document.createElement('div');
  d.className = cls || '';
  d.innerHTML = html;
  el.log.prepend(d);
  while (el.log.children.length > 7) el.log.removeChild(el.log.lastChild);
  setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 6200);
}
var hitmT = null, _hitmChainKey = null;
/* 命中链播报:同一发炮弹(key=弹对象)连续命中多模块=逐行追加,命中顺序即行序(先中在上);
   换弹自动重置。纯命中事件驱动,零逐帧检测;颜色由子行 class 控制。 */
function hitMarkerChain(key, text, cls) {
  if (_hitmChainKey !== key) { el.hitm.textContent = ''; el.hitm.className = ''; _hitmChainKey = key; }
  var d = document.createElement('div');
  d.textContent = text; if (cls) d.className = cls;
  el.hitm.appendChild(d);
  el.hitm.style.opacity = 1;
  if (hitmT) clearTimeout(hitmT);
  hitmT = setTimeout(function () { el.hitm.style.opacity = 0; _hitmChainKey = null; }, 1100);
}
/* 事件行(点燃!/目标摧毁!):有活跃链=按时序接在链尾(结算在弹对象命中行之后同步触发,行序即事件序);
   无活跃链(溅射点燃/火灾焚毁等无弹上下文)=独立起块(新 key 强制重置)。 */
function hitMarkerAppend(text, cls) {
  hitMarkerChain(_hitmChainKey !== null ? _hitmChainKey : {}, text, cls);
}
function dmgFlash(strength) {
  el.flash.style.transition = 'none';
  el.flash.style.opacity = strength || 0.7;
  requestAnimationFrame(function () {
    el.flash.style.transition = 'opacity .6s';
    el.flash.style.opacity = 0;
  });
}
/* 进度环通用写入(装填/齐射/弃车三消费点单点化):conic 进度段+墨环底(漫画口径) */
function ringConic(elm, col, frac, rest) {
  var deg = (frac * 360) | 0;                                   // 整度量化:60px 环上 1° 步进亚像素,肉眼无级差
  if (elm._rcC === col && elm._rcD === deg && elm._rcR === rest) return;   // 值门:满环驻留/装填静止期零字符串构建零 DOM 写
  elm._rcC = col; elm._rcD = deg; elm._rcR = rest; elm._rcKey = null;
  elm.style.background = 'conic-gradient(' + col + ' ' + deg + 'deg, ' + (rest || 'rgba(20,20,20,.55)') + ' 0deg)';
}

/* 直升机左右翼导弹独立装填对称双半环渲染 (右半环从顶部 0° 顺时针至 180°,左半环从顶部 360° 逆时针至 180° 对称填充) */
function ringConicDualHeliMissile(elm, colR, degR, colL, degL, rest) {
  var restCol = rest || 'rgba(20,20,20,.55)';
  var key = colR + '|' + degR + '|' + colL + '|' + degL;
  if (elm._rcKey === key) return;
  elm._rcKey = key;
  elm._rcC = null; elm._rcD = null;
  // 右半环: 0°~180° (右翼导弹由顶部向底部推进); 左半环: 180°~360° (左翼导弹由顶部向底部对称推进)
  var bg = 'conic-gradient(' +
    colR + ' 0deg, ' + colR + ' ' + degR + 'deg, ' +
    restCol + ' ' + degR + 'deg, ' + restCol + ' 180deg, ' +
    restCol + ' 180deg, ' + restCol + ' ' + degL + 'deg, ' +
    colL + ' ' + degL + 'deg, ' + colL + ' 360deg)';
  elm.style.background = bg;
}

/* ===== 雷达预警与导弹告警系统 (RWR & MAWS) 威胁仲裁引擎 =====
   威胁度优先级: 敌导弹(最高) > 敌锁定 > 敌跟踪 */
var _rwrLastState = 'none';
/* 直升机危险姿态与过低高度物理撞地告警 (高度过低,循环播报直到解除危险姿态) */
function updateHeliDangerousAttitude(dt) {
  if (!player || !player.alive || !isHeliVehicle(player) || gameState !== 'playing') {
    if (typeof sfxHeliPullupStop === 'function') sfxHeliPullupStop();
    return;
  }

  // 1. 若载具停留在地面、已接地静止或正在正常缓降停放,不触发高度过低告警
  var curAlt = player._heliAlt != null ? player._heliAlt : (player.group.position.y - (player._lastGroundY != null ? player._lastGroundY : terrainH(player.group.position.x, player.group.position.z)));
  var vy = player._heliVy || 0;
  var isGrounded = !!player._heliGrounded || (curAlt <= 0.8 && Math.abs(vy) <= 1.2);
  if (isGrounded) {
    if (typeof sfxHeliPullupLoop === 'function') sfxHeliPullupLoop(false);
    return;
  }

  // 2. 物理危险姿态与撞地冲击速度评估 (与 updateHeli 触地受损判定 effV > HELI_SAFE_TOUCH 完全对齐)
  var prm = HELI_PARAMS[player.kind] || HELI_PARAMS.wz10;
  var groundRestPitch = prm.restPitch || 0.1255;
  var groundRollSlope = 0;

  var vyImp = -vy; // 正值表示向下靠近地面
  var isDangerous = false;

  if (vyImp > 1.2) {
    var attFactor = 1.0 + 1.2 * Math.max(0, Math.abs((player._heliPitch || 0) - groundRestPitch) - 0.45)
                        + 1.2 * Math.max(0, Math.abs((player._heliRoll || 0) - groundRollSlope) - 0.45);
    var effV = vyImp * attFactor;

    // 当下坠合成速度/姿态折算速度接近或超过安全着陆门限(HELI_SAFE_TOUCH = 10.0m/s),且高度过低(未来 3.0s 内会撞地或高度低于危险线)
    var timeToImpact = curAlt / Math.max(0.1, vyImp);
    var isLowAlt = (curAlt < 45.0 && effV >= 7.5) || (timeToImpact < 2.8 && effV >= 8.5) || (curAlt < 65.0 && vyImp >= 12.0);

    if (isLowAlt) {
      isDangerous = true;
    }
  }

  if (typeof sfxHeliPullupLoop === 'function') {
    sfxHeliPullupLoop(isDangerous);
  }
}

var _rwrIdle = false;                    // ★审查A4: 非直升机早退边沿门(off 态是本函数不动点, 原版每模拟步 4 次 DOM 突变 ×50Hz)
var _mawsHtmlPrev = '\u0000';             // ★审查B5: maws 层上帧 HTML(值门用)
var _mawsFlashWant = false, _lwrFlashWant = false, _edgeFlashPrev = false;   // 边缘红闪统一所有权:MAWS/LWR 只写 want,apply 单点裁决(修 LWR 胜利卡红,2026-09-09)
function applyEdgeFlash() {
  var want = _mawsFlashWant || _lwrFlashWant;
  if (want === _edgeFlashPrev) return;
  _edgeFlashPrev = want;
  var f = (typeof el !== 'undefined' && el['maws-edge-flash']) || (typeof document !== 'undefined' && document.getElementById('maws-edge-flash'));
  if (f) f.classList.toggle('hidden', !want);
}
function lwrMawsReset() {   // 结算兜底:两路 want+音+层全清(纵深防御,修 LWR 胜利卡红)
  _mawsFlashWant = false; _lwrFlashWant = false;
  _lwrAimT = {}; _lwrAimTank = {}; _lwrOnPrev = false; _lwrHtmlPrev = '';
  _rwrLastState = 'none';
  sfxLwrToneStop();
  if (typeof sfxRwrAlarmStop === 'function') sfxRwrAlarmStop();
  if (typeof sfxRwrToneStop === 'function') sfxRwrToneStop();
  var l1 = (typeof el !== 'undefined' && el['lwr-hud-layer']) || (typeof document !== 'undefined' && document.getElementById('lwr-hud-layer'));
  if (l1 && l1.innerHTML !== '') l1.innerHTML = '';
  var l2 = (typeof el !== 'undefined' && el['maws-hud-layer']) || (typeof document !== 'undefined' && document.getElementById('maws-hud-layer'));
  if (l2 && l2.innerHTML !== '') { l2.innerHTML = ''; _mawsHtmlPrev = ''; }
  _edgeFlashPrev = true; applyEdgeFlash();   // 强制藏一次(绕值门)
}
function updateRwrMaws(dt) {
  var rwrEl = el['rwr-warning'] || document.getElementById('rwr-warning');
  var rwrTag = el['rwr-tag'] || document.getElementById('rwr-tag');
  var flashEl = el['maws-edge-flash'] || document.getElementById('maws-edge-flash');
  var layerEl = el['maws-hud-layer'] || document.getElementById('maws-hud-layer');

  // 开局 0.5s 内处于出生线初始位置稳定过渡期,不误触发告警
  if (!player || !player.alive || gameState !== 'playing' || (gameT - startT < 0.5) || typeof camera === 'undefined' || !camera || !isHeliVehicle(player)) {
    // 导弹告警系统(警告条/边缘闪烁/来袭导弹标注)仅直升机; 陆地载具完全隔离
    if (_rwrIdle) return;                             // ★审查A4: 边沿门——hidden/空串/停音均为幂等不动点, 只在进入时做一次
    _rwrIdle = true;
    if (rwrEl) rwrEl.classList.add('hidden');         // (删 className='hidden' 整串覆盖: 该元素仅 toggling hidden 一个类, classList.add 到达同一终态)
    _mawsFlashWant = false;   // 闲置路只写 want(统一所有权,apply 单点裁决)
    if (layerEl && layerEl.innerHTML !== '') { layerEl.innerHTML = ''; _mawsHtmlPrev = ''; }
    _rwrLastState = 'none';
    if (typeof sfxRwrAlarmStop === 'function') sfxRwrAlarmStop();
    if (typeof sfxRwrToneStop === 'function') sfxRwrToneStop();
    return;
  }

  _rwrIdle = false;                                   // ★审查A4: 活跃路径复位边沿门
  var pPos = player.group.position;
  var opponents = hostileRosterOf(player);

  var incomingMissiles = [];
  var isLockedByOpponent = false;
  var isTrackedByOpponent = false;

  // 1. 扫描检测: 敌导弹来袭 (MAWS 紫外/红外及多普勒逼近告警系统 - 严密过滤友军受击与脱靶假警报) (子列表迭代)
  for (var si = 0; si < airborneMissiles.length; si++) {
    var s = airborneMissiles[si];
    if (s.isHeliMissile && s.owner && areHostile(s.owner, player) && s.life > 0) {
      // 判定导弹当前真正制导/追踪的有效目标
      var curTarget = null;
      if (s._autoOptTarget) {
        if (s._autoOptTarget.isHeatSource) {
          curTarget = null; // 已被诱饵/爆炸/太阳假目标引偏,不再追踪任何真实载具
        } else {
          curTarget = s._autoOptTarget; // 光电导引头自主锁定的真实载具
        }
      } else if (s.target && s.target.alive) {
        curTarget = s.target; // 母机雷达数据链/末制导锁定的目标
      }

      var isTargetedAtPlayer = (curTarget === player);

      var mPos = s.pos;
      var dx = pPos.x - mPos.x, dy = (pPos.y + 1.0) - mPos.y, dz = pPos.z - mPos.z;
      var distSq = dx * dx + dy * dy + dz * dz;

      // MAWS 威胁探测包线 (6.0KM 导弹探测视距)
      if (distSq <= 36000000 && distSq >= 1.0) {
        var dist = Math.sqrt(distSq);
        var vMag = s.vel.length();

        if (vMag > 10.0) {
          // 导弹前进方向单位矢量
          var uvX = s.vel.x / vMag, uvY = s.vel.y / vMag, uvZ = s.vel.z / vMag;
          // 玩家相对于导弹的矢量在导弹航向上的投影距离 (前向投影 L)
          var forwardProj = dx * uvX + dy * uvY + dz * uvZ;

          // 多普勒逼近速度: V_closure = V_msl · (P_player - P_msl) / dist
          var vClosure = forwardProj * vMag / dist;

          // 1. 导弹必须处于朝向玩家前向半球 (forwardProj > 0) 且多普勒逼近速度 > 15m/s (未脱靶飞越)
          if (forwardProj > 0 && vClosure > 15.0) {
            if (isTargetedAtPlayer) {
              // 确系锁定玩家本机的导弹,且正在高速逼近:立即触发最高等级导弹告警
              incomingMissiles.push(s);
            } else if (!curTarget) {
              // 射后不管/脱锁无目标导弹:仅当其航向正对玩家航道、最近会聚距离 (CPA) 处于危险碰撞包线 (< 30m) 时才告警
              var cpaSq = Math.max(0, distSq - forwardProj * forwardProj);
              if (cpaSq < 900.0 && dist < 1200.0) { // CPA < 30m 且 1.2km 内直冲玩家
                incomingMissiles.push(s);
              }
            }
            // 若 curTarget 存在且为友军载具 (curTarget !== player):
            // 导弹明确正在追杀友军,绝对不误报为玩家导弹告警!
          }
        }
      }
    }
  }

  // 2. 扫描检测: 敌直升机雷达锁定与扫描跟踪 (支持全量 10KM 视距感知)
  for (var ei = 0; ei < opponents.length; ei++) {
    var eh = opponents[ei];
    if (!eh || !eh.alive || !isHeliVehicle(eh) || !eh.group) continue;

    // 判据:敌机雷达必须已通电就绪且处于开启发射状态,否则不产生电磁辐射扫描或锁定信号。
    if (!isHeliRadarReady(eh)) continue;

    var ehPos = eh.group.position;
    var dx = pPos.x - ehPos.x, dy = pPos.y - ehPos.y, dz = pPos.z - ehPos.z;
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > 10000 || dist < 5) continue; // 10KM 极限雷达探测与告警视距

    // 检查玩家是否处于敌直升机 60° 前方视场锥内
    var ehFwd = _v1; eh.group.getWorldDirection(ehFwd);
    var toP = _v2.set(dx / dist, dy / dist, dz / dist);
    var dot = ehFwd.x * toP.x + ehFwd.y * toP.y + ehFwd.z * toP.z;

    if (dot >= 0.8660254) { // 60° 视场 (cos 30°)
      // 视线遮挡检测 (建筑物/残骸 + 山体地貌) (每敌机 0.15s 遮挡缓存, 免 50Hz 射线+地形行进)
      var occluded;
      if (eh._rwrOccT != null && gameT - eh._rwrOccT < 0.15) {
        occluded = eh._rwrOcc;
      } else {
        occluded = false;
        if (typeof worldRaycast === 'function') {
          var hits = worldRaycast(ehPos.x, ehPos.y + 1.2, ehPos.z, pPos.x, pPos.y + 1.2, pPos.z, true);
          if (hits && hits.length > 0 && hits[0].point.distanceTo(ehPos) < dist - 2.0) {
            occluded = true;
          }
        }
        if (!occluded && typeof isRadarLineOccludedByTerrain === 'function') {
          occluded = isRadarLineOccludedByTerrain(ehPos.x, ehPos.y + 1.2, ehPos.z, pPos.x, pPos.y + 1.2, pPos.z, dist);
        }
        eh._rwrOccT = gameT; eh._rwrOcc = occluded;
      }

      if (!occluded) {
        var isEhLocking = (eh._aiIsLocked && (eh._heliMissileTarget === player || eh._aiLockedTarget2 === player)) ||
                          (eh._heliMissileTarget === player && eh._aiIsLocked);
        if (isEhLocking) {
          isLockedByOpponent = true;
        } else {
          isTrackedByOpponent = true;
        }
      }
    }
  }

  // 3. 威胁度仲裁 (敌导弹 > 敌锁定 > 敌跟踪)
  var curState = 'none';
  if (incomingMissiles.length > 0) {
    curState = 'missile';
  } else if (isLockedByOpponent) {
    curState = 'lock';
  } else if (isTrackedByOpponent) {
    curState = 'track';
  }

  // 4. 音频告警循环与威胁度仲裁驱动 (导弹逼近 > 敌锁定 > 敌跟踪,年轻女性语音循环播报)
  if (typeof sfxRwrAlarmLoop === 'function') {
    sfxRwrAlarmLoop(curState);
  }
  if (typeof sfxRwrToneLoop === 'function') {
    sfxRwrToneLoop(curState);   // 电子告警音: 被扫描/被锁定/被导弹攻击 三段式
  }

  // 5. 更新顶部告警条 UI
  if (rwrEl && rwrTag) {
    if (curState === 'none') {
      rwrEl.classList.add('hidden');
      rwrEl.className = 'hidden';
    } else {
      rwrEl.classList.remove('hidden');
      if (_rwrLastState !== curState) {
        rwrEl.className = curState;
        var _usV = (typeof player !== 'undefined' && isUSVoiceVehicle(player));
        if (curState === 'missile') rwrTag.textContent = _usV ? 'MISSILE' : 'INCOMING MISSILE';
        else if (curState === 'lock') rwrTag.textContent = _usV ? 'LOCK ON' : 'LOCK-ON';
        else if (curState === 'track') rwrTag.textContent = _usV ? 'WARNING' : 'TRACKED';
      }
    }
  }
  _rwrLastState = curState;

  // 5. 边缘红闪改写 want(统一所有权,apply 单点裁决)
  _mawsFlashWant = (curState === 'missile');

  // 6. 渲染来袭导弹视野内红方框 / 视野外边缘红箭头
  if (layerEl) {
    if (incomingMissiles.length > 0) {
      camera.updateMatrixWorld();
      _wmGInv.copy(camera.matrixWorld).invert();
      var W = innerWidth, H = innerHeight, m = 38;
      var hx = W * 0.5 - m, hy = H * 0.5 - m;
      var htmlStr = '';

      for (var mi = 0; mi < incomingMissiles.length; mi++) {
        var msl = incomingMissiles[mi];
        var mPos = msl.pos;
        var mDist = Math.round(mPos.distanceTo(pPos));

        // 相机空间坐标
        var camPos = _v3.copy(mPos).applyMatrix4(_wmGInv);
        var inFront = camPos.z < -0.2;

        // 投影到屏幕 NDC
        var scr = _v1.copy(mPos).project(camera);
        var inScreen = inFront && scr.z < 1.0 && Math.abs(scr.x) < 0.90 && Math.abs(scr.y) < 0.90;

        if (inScreen) {
          // 视野内: 红色方框标注
          var sx = (scr.x * 0.5 + 0.5) * W;
          var sy = (-scr.y * 0.5 + 0.5) * H;
          htmlStr += '<div class="tgtmk msl" style="left:' + sx.toFixed(1) + 'px;top:' + sy.toFixed(1) + 'px;">' +
                     '<svg viewBox="0 0 44 44"><polygon class="tri-ink" points="3,7 41,7 22,41"/><polygon class="tri-mk" points="7,10 37,10 22,36"/></svg>' +
                     '<span class="tgtmk-tag">[!] MISSILE ' + mDist + 'm</span></div>';
        } else {
          // 视野外: 画面边缘统一标记箭头(随威胁类型变色)
          var dx = camPos.x, dy = camPos.y;
          if (!inFront) { dx = -dx; dy = -dy; }
          var len = Math.sqrt(dx * dx + dy * dy) || 1;
          var kx = hx / (Math.abs(dx / len) || 1e-4);
          var ky = hy / (Math.abs(dy / len) || 1e-4);
          var k = Math.min(kx, ky);
          var edgeX = W * 0.5 + (dx / len) * k;
          var edgeY = H * 0.5 - (dy / len) * k;
          var ang = Math.atan2(-dy, dx);

          htmlStr += '<div class="tgtmk-arrow msl" style="left:' + edgeX.toFixed(1) + 'px;top:' + edgeY.toFixed(1) + 'px;transform:translate(-50%,-50%) rotate(' + ang.toFixed(3) + 'rad);">' +
                     '<svg viewBox="0 0 34 34"><path d="M31 17 L9 6 L14.5 17 L9 28 Z" stroke="#141414" stroke-width="2.5" stroke-linejoin="round"/></svg>' +
                     '</div>';
        }
      }
      if (htmlStr !== _mawsHtmlPrev) { layerEl.innerHTML = htmlStr; _mawsHtmlPrev = htmlStr; }   // ★审查B5: 值门——同串零 DOM 突变(位置冻结的 66ms 不可感期不写)
    } else {
      if (layerEl.innerHTML !== '') { layerEl.innerHTML = ''; _mawsHtmlPrev = ''; }
    }
  }
}

/* ===== 05 激光告警接收器 LWR (99/M1/直升机 共有): 被计算机解算载具瞄准 / 被直升机机炮瞄准 → 边缘闪烁+嘟嘟音; 持续3s → 红框/红箭头标注瞄准者 ===== */
var _lwrAimT = {}, _lwrToneState = false, _lwrToneTimer = null;
var _lwrAligned = [], _lwrAimTank = {}, _lwrStampV = 0, _lwrOnPrev = false, _lwrHtmlPrev = '\u0000';   // ★审查A3: 复用表/版本戳/边沿门(原版每步 3 次堆分配 + for-in delete 字典抖动)
var _lwD = new THREE.Vector3(), _lwP = new THREE.Vector3(), _lwS = new THREE.Vector3();
function sfxLwrTone(active) {
  if (active === _lwrToneState) return;
  _lwrToneState = active;
  if (_lwrToneTimer) { clearTimeout(_lwrToneTimer); _lwrToneTimer = null; }
  if (!active || !AC) return;
  function cycle() {
    if (!_lwrToneState || !AC || gameState !== 'playing') return;
    var now = AC.currentTime + 0.02;
    _rwrToneBeep(now, 800, 0.16, 0.10);   // 与直升机被扫描同款低频告警声(慢速小声滴——)
    _lwrToneTimer = setTimeout(cycle, 1000);
  }
  cycle();
}
function sfxLwrToneStop() { _lwrToneState = false; if (_lwrToneTimer) { clearTimeout(_lwrToneTimer); _lwrToneTimer = null; } }
function updateLwr(dt) {
  var layerEl = el['lwr-hud-layer'] || document.getElementById('lwr-hud-layer');
  var flashEl = el['maws-edge-flash'] || document.getElementById('maws-edge-flash');
  // 装备门: 重型主战坦克同款 LWR, 直升机同样加装(武装直升机 机身告警接收机; 与玩家共用同一 updateLwr 实现)
  var on = player && player.alive && gameState === 'playing' && (player.kind === '99' || isM1Vehicle(player) || isHeliVehicle(player));
  if (!on) {
    if (_lwrOnPrev) {                    // ★审查A3: 边沿门——off 态是不动点(空表/无音/层已清), 只在 on→off 沿做一次
      _lwrOnPrev = false;
      _lwrAimT = {}; _lwrAimTank = {};
      sfxLwrToneStop();
      _lwrFlashWant = false;   // 结算/死亡/换车灭闪(修胜利卡红)
      if (layerEl && layerEl.innerHTML !== '') { layerEl.innerHTML = ''; _lwrHtmlPrev = ''; }
    }
    return;
  }
  _lwrOnPrev = true;
  var aligned = _lwrAligned; aligned.length = 0;   // ★审查A3: 模块级复用(原版每步 new [])
  for (var i = 0; i < aliveList.length; i++) {
    var t = aliveList[i];
    if (t === player || !t.alive || !areHostile(player, t)) continue;
    var trig = (t.kind === 'td' || t.kind === '99') || ((isHeliVehicle(t) || (typeof isAAVehicle === 'function' && isAAVehicle(t))) && (t._heliWeapon || 3) === 1);   // 计算机解算载具 / 直升机与防空机炮
    if (!trig) continue;
    var gp = t.gunPivot || t.turret;
    gp.getWorldDirection(_lwD);
    _lwP.copy(player.group.position).sub(t.group.position);
    var dist = _lwP.length();
    if (dist < 1 || dist > 2500) continue;
    _lwP.divideScalar(dist);
    var dh = Math.sqrt(_lwD.x * _lwD.x + _lwD.z * _lwD.z) || 1e-4;
    var ph2 = Math.sqrt(_lwP.x * _lwP.x + _lwP.z * _lwP.z) || 1e-4;
    var cos = (_lwD.x * _lwP.x + _lwD.z * _lwP.z) / (dh * ph2);
    if (cos > 0.995 && t.ai && losClearCached(t, player, dist)) aligned.push(t);   // 遮挡治理:隔着遮挡瞄准不触发激光告警
  }
  _lwrFlashWant = aligned.length > 0;   // 统一所有权:只写 want(修胜利卡红:空表必须灭)
  if (aligned.length > 0) {
    sfxLwrTone(true);
  } else {
    sfxLwrToneStop();
  }
  _lwrStampV++;
  var marked = null;
  for (var a2 = 0; a2 < aligned.length; a2++) {
    var tt = aligned[a2], key = tt.id || tt.name;
    _lwrAimT[key] = (_lwrAimT[key] || 0) + dt;
    _lwrAimTank[key] = tt; tt._lwrStamp = _lwrStampV;      // ★审查A3: 版本戳替代 seen 字典(零分配, 对齐 _candStamp 范式)
    if (_lwrAimT[key] >= 3 && !marked) marked = tt;
  }
  for (var k2 in _lwrAimT) {
    var _lt2 = _lwrAimTank[k2];
    if (!_lt2 || _lt2._lwrStamp !== _lwrStampV) { delete _lwrAimT[k2]; delete _lwrAimTank[k2]; }
  }
  if (layerEl) {
    if (marked) {
      camera.updateMatrixWorld();
      var W = innerWidth, H = innerHeight;
      var wp = _lwS.copy(marked.group.position); wp.y += 1.5;
      var cp = _lwP.copy(wp).applyMatrix4(camera.matrixWorldInverse);
      var inFront = cp.z < -0.2;
      var scr = _lwD.copy(wp).project(camera);
      var htmlStr = '';
      if (inFront && scr.z < 1 && Math.abs(scr.x) < 0.9 && Math.abs(scr.y) < 0.9) {
        var sx = (scr.x * 0.5 + 0.5) * W, sy = (-scr.y * 0.5 + 0.5) * H;
        htmlStr = '<div class="tgtmk lwr" style="left:' + sx.toFixed(1) + 'px;top:' + sy.toFixed(1) + 'px;"><svg viewBox="0 0 44 44"><polygon class="tri-ink" points="3,7 41,7 22,41"/><polygon class="tri-mk" points="7,10 37,10 22,36"/></svg><span class="tgtmk-tag">[!] LOCK-ON</span></div>';
      } else {
        var dx = cp.x, dy = cp.y; if (!inFront) { dx = -dx; dy = -dy; }
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var hx2 = W * 0.5 - 40, hy2 = H * 0.5 - 40;
        var k = Math.min(hx2 / (Math.abs(dx / len) || 1e-4), hy2 / (Math.abs(dy / len) || 1e-4));
        var ex = W * 0.5 + (dx / len) * k, ey = H * 0.5 - (dy / len) * k;
        var ang = Math.atan2(-dy, dx);
        htmlStr = '<div class="tgtmk-arrow lwr" style="left:' + ex.toFixed(1) + 'px;top:' + ey.toFixed(1) + 'px;transform:translate(-50%,-50%) rotate(' + ang.toFixed(3) + 'rad);"><svg viewBox="0 0 34 34"><path d="M31 17 L9 6 L14.5 17 L9 28 Z" stroke="#141414" stroke-width="2.5" stroke-linejoin="round"/></svg></div>';
      }
      if (htmlStr !== _lwrHtmlPrev) { layerEl.innerHTML = htmlStr; _lwrHtmlPrev = htmlStr; }   // ★审查B5: 值门(同上)
    } else if (layerEl.innerHTML !== '') { layerEl.innerHTML = ''; _lwrHtmlPrev = ''; }
  }
}
/* ===== 07 激光压制系统: 2KM 可见目标, 持续照射1s生效, 发射/冷却时长由玩家 RED-MBT-2 科技消费点动态提供 ===== */
var _rmbHeld = false;
var _tlasFire = false, _tlasCool = false;   // 触屏激光键 firing/cooling 类边沿缓存(免每帧写 class)
var LWS_EMIT = 4.0, LWS_CD = 30.0, LWS_LOCK = 1.0, LWS_RANGE = 2000.0;
function lwsEmitTimeOf(t) { return (t && t.isPlayer && typeof vehicleTechLwsEmitTime === 'function') ? vehicleTechLwsEmitTime(t) : LWS_EMIT; }
function lwsCooldownTimeOf(t) { return (t && t.isPlayer && typeof vehicleTechLwsCooldownTime === 'function') ? vehicleTechLwsCooldownTime(t) : LWS_CD; }
function clearLwsSuppression(st, source) {
  if (!st || !st.sup) return;
  if (st.sup._lwsSupBy === source) { st.sup._laserSuppressed = false; st.sup._lwsSupBy = null; }
  st.sup = null;
}
var _lwP2 = new THREE.Vector3(), _lwE = new THREE.Vector3(), _lwO = new THREE.Vector3();
function lwsOf(t) { return t._lws || (t._lws = { phase: 'ready', t: 0, illum: 0, illumTgt: null, sup: null }); }
function _lwsAimTarget99(t) {   // AI: 当前炮口对齐的计算机解算型敌方(同 LWR 判据)
  var gp = t.gunPivot || t.turret; gp.getWorldDirection(_lwD);   // ★审查A2: 循环不变量外提(原版每候选一次矩阵分解, 27 目标×108 步全白做)
  var _lwR2 = LWS_RANGE * LWS_RANGE;
  for (var i = 0; i < aliveList.length; i++) {
    var o = aliveList[i];
    if (o === t || !o.alive || !areHostile(t, o)) continue;
    if (!(o.kind === 'td' || o.kind === '99')) continue;
    _lwP.copy(o.group.position).sub(t.group.position);
    var d2 = _lwP.lengthSq(); if (d2 < 1 || d2 > _lwR2) continue;   // ★审查A2: 平方预筛(过门再开方, 判定集合与原版逐位一致)
    var d = Math.sqrt(d2);
    _lwP.divideScalar(d);
    var dh = Math.sqrt(_lwD.x * _lwD.x + _lwD.z * _lwD.z) || 1e-4, ph2 = Math.sqrt(_lwP.x * _lwP.x + _lwP.z * _lwP.z) || 1e-4;
    if ((_lwD.x * _lwP.x + _lwD.z * _lwP.z) / (dh * ph2) > 0.995) { if (t.ai && losClearCached(t, o, d)) return o; }   // 遮挡治理:不照射被地形/残骸/载具挡的目标
  }
  return null;
}
function _lwsPickTargetAt(aim, t) {   // 玩家: 射线(镜片→镜心指向点)穿过的敌方载具(垂距<2.2m, 2KM内)
  var o = _lwE.copy(aim).sub(_lwO); var olen = o.length(); if (olen < 1) return null; o.divideScalar(olen);
  var best = null, bestD = 1e9;
  for (var i = 0; i < aliveList.length; i++) {
    var e = aliveList[i];
    if (e === t || !e.alive || !areHostile(t, e)) continue;
    _lwP.copy(e.group.position).sub(_lwO);
    var along = _lwP.x * o.x + _lwP.y * o.y + _lwP.z * o.z;
    if (along < 0 || along > LWS_RANGE) continue;
    var perp = Math.sqrt(Math.max(0, _lwP.lengthSq() - along * along));
    if (perp < 2.2 && along < bestD) { bestD = along; best = e; }
  }
  return best;
}
function _lwsBlocked(target, dist) {   // 地形/残骸/其他载具阻挡(目标自身不算)
  var hits = worldRaycast(_lwO.x, _lwO.y, _lwO.z, _lwP2.x, _lwP2.y, _lwP2.z, false);
  if (!hits || !hits.length) return false;
  for (var i = 0; i < hits.length; i++) {
    var h = hits[i], ud = h.object && h.object.userData;
    if (ud && ud.tank === target) continue;
    var hd = h.distance != null ? h.distance : (_lwP2.distanceTo(_lwO));
    if (hd < dist - 1.5) return true;
  }
  return false;
}
function sfxLwsCue(kind) {   // 激光压制系统提示音: 压制结束=滴 / 冷却结束=滴滴
  if (!AC || typeof gameState === 'undefined' || gameState !== 'playing') return;
  var now = AC.currentTime + 0.02;
  if (kind === 'end') { _rwrToneBeep(now, 1200, 0.09, 0.22); }
  else { _rwrToneBeep(now, 1200, 0.07, 0.22); _rwrToneBeep(now + 0.14, 1200, 0.07, 0.22); }
}
function updateLws(dt) {
  for (var i = 0; i < aliveList.length; i++) {
    var t = aliveList[i];
    if (!t.alive || t.kind !== '99') continue;
    var st = lwsOf(t);
    if (st.phase === 'ready') {
      var want = t.isPlayer ? (_rmbHeld && scoped && gameState === 'playing') : (!!t.ai && !!_lwsAimTarget99(t));
      if (want) { st.phase = 'emit'; st.t = 0; st.illum = 0; st.illumTgt = null; st.sup = null;
        if (t.isPlayer && typeof sfxLwsCue === 'function') sfxLwsCue('end'); }   // 压制开始: 滴(与结束同款)
      continue;
    }
    if (st.phase === 'emit') {
      st.t += dt;
      if (t._lwsLens) t._lwsLens.getWorldPosition(_lwO); else _lwO.copy(t.group.position);
      var tgt = null;
      if (t.isPlayer) {
        var aim = scopeInfo.point;
        if (!aim && isFinite(scopeInfo.laser)) { aim = _lwP2.copy(camera.getWorldDirection(_lwD)).multiplyScalar(Math.min(scopeInfo.laser, 2000)).add(camera.position); }
        if (aim) { _lwP2.copy(aim); tgt = _lwsPickTargetAt(aim, t); }
      } else {
        tgt = _lwsAimTarget99(t);
        if (tgt) _lwP2.copy(tgt.group.position);
      }
      if (tgt) {
        if (t.isPlayer) _lwP2.copy(tgt.group.position);   // 遮挡检测终点=目标本体(炮镜落点打短时防漏判中间遮挡;与AI路径同口径)
        /* Suppression belongs to the continuously illuminated target. Leaving the
           beam, changing target, or gaining an occluder releases it immediately. */
        if (st.sup && st.sup !== tgt) clearLwsSuppression(st, t);
        if (tgt !== st.illumTgt) { st.illumTgt = tgt; st.illum = 0; }   // 换目标=照射进度清零(持续照射"一个"目标1s)
        var dist = tgt.group.position.distanceTo(_lwO);
        if (dist <= LWS_RANGE && !_lwsBlocked(tgt, dist)) {
          st.illum += dt;
          if (st.illum >= LWS_LOCK && !st.sup) { st.sup = tgt; tgt._laserSuppressed = true; tgt._lwsSupBy = t; }   // 满1s生效(记录压制者=叠加照射所有权)
        } else {
          clearLwsSuppression(st, t);
          st.illum = 0; st.illumTgt = null;   // 生效前/生效后中断=立即解除
        }
      } else {
        clearLwsSuppression(st, t);
        st.illum = 0; st.illumTgt = null;
      }
      var emitTime = lwsEmitTimeOf(t);
      if (st.t >= emitTime) {   // 基础激光4s;大功率激光2s → 自动冷却
        clearLwsSuppression(st, t);
        st.phase = 'cool'; st.t = 0;
        if (t.isPlayer && typeof sfxLwsCue === 'function') sfxLwsCue('end');   // 压制结束: 滴
      }
      continue;
    }
    var coolTime = lwsCooldownTimeOf(t);
    st.t += dt; if (st.t >= coolTime) { st.phase = 'ready'; st.t = 0; if (t.isPlayer && typeof sfxLwsCue === 'function') sfxLwsCue('ready'); }   // cool → 冷却结束: 滴滴
  }
}
/* ===== 07 武器装填完成提示音 (模仿真实坦克装填/机械嗒/棘轮咔嗒; 见 装填提示音演示.html 拆解) ===== */
var RELOAD_CUES = {
  "cannon_main": "data:audio/mp3;base64,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qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+5LEOQPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//uSxDkDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/7ksQ5A8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+5LEOQPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//uSxDkDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqg==",
  "arty": "data:audio/mp3;base64,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VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7ksQ5A8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+5LEOQPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//uSxDkDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==",
  "heli_gun": "data:audio/mp3;base64,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qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//uSxDkDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/7ksQ5A8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+5LEOQPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//uSxDkDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/7ksQ5A8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+5LEOQPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//uSxDkDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqg==",
  "heli_rocket": "data:audio/mp3;base64,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qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//uSxDkDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/7ksQ5A8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+5LEOQPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//uSxDkDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqkxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/7ksQ5A8AAAaQAAAAgAAA0gAAABKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpMQU1FMy4xMDCqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/+5LEOQPAAAGkAAAAIAAANIAAAASqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//uSxDkDwAABpAAAACAAADSAAAAEqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqg==",
  "heli_missile": "data:audio/mp3;base64,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wGkbzJRWN80i6ZmZ//uSxFsAJNIvUdmHgAMdv6aTnpABWl91RldssLCdgWsf8ImkSZbYR6WdPUioxzWmWGf0I/qqBLl9YLqZiktAhwVM3yJ5EuGoNKvWmeM9JauzR6IREp++Coj7vs6f///+nISkq8griCxKF65KBZjqeWrr////sDyDO2yKZxqm2bTlLp+w3kMrRIAHq9ep0tpbRbS4vzlJydLixIcaRpCnFkSIiFQJAkyWCwJCpq0KGXjlSREQqZpE1KUpIox9LEQWBIEmSIEg0TWFQCgBJpqx/tChlaqFDGlkUYxjkiIAwAiVIVCpFKVSj6WRIkUpXH1JEiRIslLbj1kWLNbFDHJRjH0siIiZnJSRIkSJFkkSJFLfGUpSltxjKUpSlKW1JZqW///+pIhUKmVhUKhUi1VC1v/pYVCplYVAkKmlQqAUm2Of2qhalUt8VUK0jgUVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7ksQqg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+5LEOQPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//uSxDkDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7ksQ5A8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+5LEOQPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//uSxDkDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7ksQ5A8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+5LEOQPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//uSxDkDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ=="
};
var VOICE_ZH_RPMLOW = "data:audio/mp3;base64,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";   // 14: 重制"转速过低"(Xiaoyi -10%, 0.86s 四音节清晰; 旧0.53s吐字模糊)   // 12: 转速低
var VOICE_EN_RPMLOW = "data:audio/mp3;base64,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/1bq3/3sLrnVIEszmwknZiXmQDJ3isqYvSRWW01j9DCGA0PAZw6tuuDsoqv3allBMrTM3IoeniRqtuUQDoawdFWZmHfWxtSgykG7oekpLC0VcrsLE7XolJqu6lX/82TExBwMMrm+eYqfVTPd0Rqp////////+Z/Upf/arZnT/0///f/4URzoBSQAmwpwD5qYCwtNTxgiUi7QUJzNwYMhgMtahOUueZkzZXKCoBlQCKX2FhqcCwnwTlEhls0KngbskE8j7hpAdnTnoROChCKxGaQTRgm9ciDajC4rLIE5T2oQv/779wzySehhrNL/82TE1hy8Mph+wwpb6uVXXvaYTOswx7wkORQ8DsaxWxX////////9xKoJcEvqIVOZaaJyATmCCKYeJIoMjCQUAyaMMhoBA5QZ3FBi4ZOE1kNaQfURoR+MQiw81pd0AidVqzSSUi8AUJZDU4LdlwZXBR+ZIBYWMOxq6OmbIioYcij6EHDBdBy/YHrfFM0772n/82TE5h/Rjlxc5hJUyO18xlczAcLY+2rvB4Fxih5kVvwa94VHKkxBAKk/QUDQw6NNBnRYTWBQtewXFAUSFxXz+JDdoCMIAQ4lJ8BKyxF2JevKJ4k1MqWGSRmZqykiYWcU3MdolDSjnNFki6Wmv1/pI1V4y6k85VS9DQhKdlFEkfJAJaf9cW76v/tZP/+v8Cr/82TE6R+xikAI5hh2iv///lMM1UxBTUUzLjEwMFVVVWyatpLLVomJoKq3Zo7ECzSUwKM7bi/KbPyRW1kr7RsAUDqIlE5atYMrs9ZKJSqcqqOASNb/zcOzzJGCWucS3trmkSVPOeZmqqt8+sq5bZhIjrGiKVEUYBf8kwbJcsBXK61hqe2yKf9cNM5Utw7I37v/82TE6xuJnkwc09BYrO1hVwlIqmGFQ4kuYhWqxizJV1JilzUOyaa6G/hyC3odMLoF1EZ4NBURDQ2QE4sJgqCwOg6MCMgJzD2Zfc+SismmlMh2dv//+7GKYGCQ7OxihgoMEGJQmiIsE01Dlv5pammpZKVoiLP7UOf/++mmpZKVoiLJaahyxWi6zdNSyxWiIsv/82TE8x2JjjwUwwzIU1aWK0RFktNWlu0XWS01TLdqTEFNRTMuMTAwqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/82TE/yNRlZACwkS1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=";   // rotor RPM low
var _rpmWarnAudio = null, _rpmWarnLastT = -99;
/* ===== 低转速语音告警 (转速过低; 2.0s 冷却, 中/英语音按阵营) ===== */
function sfxRpmWarn() {
  if (!player || !player.alive || gameState !== 'playing') return;
  if (gameT - _rpmWarnLastT < 2.0) return;
  _rpmWarnLastT = gameT;
  var u = isUSVoiceVehicle(player) ? VOICE_EN_RPMLOW : VOICE_ZH_RPMLOW;
  try {
    if (_rpmWarnAudio) { try { _rpmWarnAudio.pause(); } catch (e) {} }
    var a = new Audio(u);
    a.volume = Math.min(1.0, (typeof prefVolume !== 'undefined' ? prefVolume : 0.55) * 1.6);
    _rpmWarnAudio = a;
    a.onended = function () { if (_rpmWarnAudio === a) _rpmWarnAudio = null; };
    var p = a.play(); if (p && p.catch) p.catch(function () {});
  } catch (e) {}
}
var _reloadCueAudio = null;
function sfxReloadCue(kind) {
  if (!player || !player.alive || gameState !== 'playing') return;
  var u = RELOAD_CUES[kind]; if (!u) return;
  try {
    if (_reloadCueAudio) { try { _reloadCueAudio.pause(); } catch (e) {} }
    var a = new Audio(u);
    a.volume = Math.min(1.0, (typeof prefVolume !== 'undefined' ? prefVolume : 0.55) * 1.4);
    _reloadCueAudio = a;
    a.onended = function () { if (_reloadCueAudio === a) _reloadCueAudio = null; };
    var p = a.play(); if (p && p.catch) p.catch(function () {});
  } catch (e) {}
}
function sfxReloadCueStop() { if (_reloadCueAudio) { try { _reloadCueAudio.pause(); } catch (e) {} _reloadCueAudio = null; } }
var _rlPrev = 0;
function reloadCueTick() {   // 地面载具(坦克/火箭炮)主装填完成边沿检测; 直升机走各自装填钩子
  if (!player || !player.alive || isHeliVehicle(player)) { _rlPrev = player ? (player.reload || 0) : 0; return; }
  var r = player.reload || 0;
  if (_rlPrev > 0 && r <= 0 && gameState === 'playing') sfxReloadCue(player.kind === 'arty' ? 'arty' : 'cannon_main');
  _rlPrev = r;
}
var hudTick = 0;
function hudUpdate(dt) {
  var isHeli = !!(player && player.alive && isHeliVehicle(player));
  /* 直升机圆点光标左侧实时总距百分比与熄火/低转速指示 (量化值门: 仅百分比整数变化或状态切换时写 DOM) */
  var hpInfoEl = el.helipitchinfo;
  if (hpInfoEl) {
    if (player && player.alive && isHeliVehicle(player) && !scoped) {
      var isCutoff = player._heliEngineState === 'cutoff';
      var hPrm = HELI_PARAMS[player.kind] || HELI_PARAMS.wz10;
      var rpmFrac = heliRotorFrac(player, hPrm);
      var pitchVal = isCutoff ? -1 : Math.round((player._heliCollective || 0) * 100);
      var rpmPct = Math.round(rpmFrac * 100);
      var isLowRpm = !isCutoff && !!player._heliLowRpmWarn;   // 谓词由物理层统一裁决(heliLowRpmAlarm)

      var stateKey = pitchVal + '_' + isLowRpm + '_' + (isLowRpm ? rpmPct : 0);
      if (hpInfoEl._lastVal !== stateKey) {
        hpInfoEl._lastVal = stateKey;
        var pitchTxt = isCutoff ? 'ENGINE OUT' : ('COLL ' + pitchVal + '%');
        var pitchCol = isCutoff ? '#ff2d20' : '#9dff6e';
        if (isLowRpm) {
          pitchTxt = 'COLL ' + pitchVal + '% [LOW RPM ' + rpmPct + '%]';
          pitchCol = rpmPct < 70 ? '#ff2d20' : '#e67e22';
        }
        hpInfoEl.textContent = pitchTxt;
        hpInfoEl.style.color = pitchCol;
      }
      if (hpInfoEl._on !== true) {
        hpInfoEl._on = true;
        hpInfoEl.style.display = 'block';
        hpInfoEl.style.opacity = '1';
      }
    } else {
      if (hpInfoEl._on !== false) {
        hpInfoEl._on = false;
        hpInfoEl.style.display = 'none';
        hpInfoEl._lastVal = null;
      }
    }
  }

  /* 直升机多武器状态与环形射击计数/装填指示 */
  var hmlEl = el.helimissileinfol, hmrEl = el.helimissileinfor;
  var _mbtTechHud = player && player.alive && typeof isPlayerRedMbtMissileVehicle === 'function' && isPlayerRedMbtMissileVehicle(player);
  var _tdTechHud = player && player.alive && typeof isPlayerRedTdHighExplosiveVehicle === 'function' && isPlayerRedTdHighExplosiveVehicle(player);
  if (player && player.alive && (isHeliVehicle(player) || (typeof isAAVehicle === 'function' && isAAVehicle(player)) || _mbtTechHud || _tdTechHud)) {
    var curWp = _mbtTechHud ? (player._mbtWeapon || 1) : (_tdTechHud ? (player._tdWeapon || 1) : (player._heliWeapon || 3));
    if (_mbtTechHud) {
      if (hmlEl) hmlEl.style.display = 'none';
      if (hmrEl) hmrEl.style.display = 'none';
      var mbtRingFull = typeof redMbtMissileReloadTimeOf === 'function' ? redMbtMissileReloadTimeOf(player) : player.reloadTime;
      var mbtRingFrac = player.reload > 0 ? clamp(1 - player.reload / Math.max(0.1, mbtRingFull), 0, 1) : 1;
      ringConic(el.ring, player.reload > 0 ? '#ffd76e' : '#9dff6e', mbtRingFrac);
    } else if (_tdTechHud) {
      if (hmlEl) hmlEl.style.display = 'none';
      if (hmrEl) hmrEl.style.display = 'none';
      var tdRingFull = player.reloadTime || 1;
      var tdRingFrac = player.reload > 0 ? clamp(1 - player.reload / Math.max(0.1, tdRingFull), 0, 1) : 1;
      ringConic(el.ring, player.reload > 0 ? '#ffd76e' : '#9dff6e', tdRingFrac);
    } else if (curWp === 2 && !_isAABar) {
      // HELI weapon 2: rockets.  AA weapon 2 is ATGM and uses the missile ring below.
      if (hmlEl) hmlEl.style.display = 'none';
      if (hmrEl) hmrEl.style.display = 'none';
      var rFrac = player._heliRocketReloadT > 0
        ? (1 - player._heliRocketReloadT / rocketReloadTimeOf(player))
        : ((player._heliRocketLeft != null ? player._heliRocketLeft : rocketPodCountOf(player)) / rocketPodCountOf(player));
      var rCol = player._heliRocketReloadT > 0 ? '#ffd76e' : (rFrac >= 1 ? '#9dff6e' : '#ff9c4a');
      ringConic(el.ring, rCol, rFrac);
    } else if (curWp === 3 || (_isAABar && curWp === 2)) {
      // 武器3: 导弹 (15: 每侧半环=该挂架在筒弹药计数比例; 装填中=装填进度黄环; 数字=弹药计数,装填时=倒计时)
      var tL = player._heliMissileReloadTL || 0;
      var tR = player._heliMissileReloadTR || 0;
      var mMax = heliMslTubesOf(player);
      var rndL = player._heliMslRounds ? player._heliMslRounds[0] : mMax;
      var rndR = player._heliMslRounds ? player._heliMslRounds[1] : mMax;
      var rFull = heliMslReloadTimeOf(player);
      var fL = tL > 0 ? clamp(1 - tL / rFull, 0, 1) : (rndL / mMax);
      var fR = tR > 0 ? clamp(1 - tR / rFull, 0, 1) : (rndR / mMax);

      var degR = Math.round(fR * 180);
      var degL = 360 - Math.round(fL * 180);
      var colR = tR > 0 ? '#ffd76e' : '#9dff6e';
      var colL = tL > 0 ? '#ffd76e' : '#9dff6e';
      ringConicDualHeliMissile(el.ring, colR, degR, colL, degL, 'rgba(20,20,20,.55)');

      // 左挂架: 数字放在左边——在筒弹药计数 n/max,装填中显示倒计时
      if (hmlEl) {
        if (!scoped) {
          hmlEl.textContent = tL > 0 ? (tL.toFixed(0) + 's') : (rndL + '/' + mMax);
          hmlEl.style.display = 'block';
        } else {
          hmlEl.style.display = 'none';
        }
      }

      // 右挂架: 数字放在右边——同上
      if (hmrEl) {
        if (!scoped) {
          hmrEl.textContent = tR > 0 ? (tR.toFixed(0) + 's') : (rndR + '/' + mMax);
          hmrEl.style.display = 'block';
        } else {
          hmrEl.style.display = 'none';
        }
      }
    } else {
      // 武器1: 机炮 (4发/秒, 0.25s装填)
      if (hmlEl) hmlEl.style.display = 'none';
      if (hmrEl) hmrEl.style.display = 'none';
      var frac = player && player.reloadTime > 0 ? 1 - player.reload / player.reloadTime : 1;   // ★审查C5: 先判空再解引用(原版先解引用后判空, 坦克/直升机两处同病)
      var ringCol = frac >= 1 ? '#9dff6e' : '#ffd76e';
      ringConic(el.ring, ringCol, frac);
    }
  } else {
    if (hmlEl) hmlEl.style.display = 'none';
    if (hmrEl) hmrEl.style.display = 'none';
    var frac = player && player.reloadTime > 0 ? 1 - player.reload / player.reloadTime : 1;   // ★审查C5: 先判空再解引用(原版先解引用后判空, 坦克/直升机两处同病)
    var ringCol = frac >= 1 ? '#9dff6e' : '#ffd76e';
    if (player && player.kind === 'arty' && player.salvoLeft > 0) {
      frac = 1 - player.salvoLeft / artyConfOf(player).salvo;
      ringCol = '#ff9c4a';
    }
    ringConic(el.ring, ringCol, frac);
  }

  if (el.lwsring) {                                  // 激光压制环(专属高阶坦克): 空=就绪 / 蓝增长=4s发射 / 黄退去=30s冷却
    var _lwsOn = !!(player && player.alive && player.kind === '99' && gameState === 'playing');
    if (_lwsOn !== el.lwsring._on) { el.lwsring._on = _lwsOn; if (_lwsOn) el.lwsring.classList.remove('hidden'); else el.lwsring.classList.add('hidden'); }
    if (_lwsOn) {
      var _st9 = lwsOf(player);
      if (_st9.phase === 'emit') ringConic(el.lwsring, '#7fd2ff', clamp(_st9.t / lwsEmitTimeOf(player), 0, 1));
      else if (_st9.phase === 'cool') ringConic(el.lwsring, '#ffd76e', clamp(1 - _st9.t / lwsCooldownTimeOf(player), 0, 1));
      else ringConic(el.lwsring, '#7fd2ff', 0);
    }
  }
  /* 激光压制键进度环(专属高阶坦克触屏键 #tlas):与 HUD #lwsring 同语义,同源 lwsOf 状态 ——
     发射期蓝弧 4s 充满 / 冷却期琥珀弧 30s 退去 / 就绪空环;显隐门在 flow.js uiSync,
     这里只驱动 firing/cooling 类与环进度(边沿写,不变不写 DOM)。 */
  if (el.tlas) {
    if (!el.tlasPrfg && el.tlas.querySelector) el.tlasPrfg = el.tlas.querySelector('.prfg');   // 进度弧首帧惰性缓存
    var _lasShow = !!(player && player.alive && player.kind === '99' && gameState === 'playing');
    if (_lasShow) {
      var _stL = lwsOf(player), _C = 2 * Math.PI * 47;
      if (_stL.phase === 'emit') {
        if (!_tlasFire) { _tlasFire = true; _tlasCool = false; el.tlas.classList.add('firing'); el.tlas.classList.remove('cooling'); }
        if (el.tlasPrfg) { el.tlasPrfg.style.stroke = '#5f97e8'; el.tlasPrfg.style.strokeDasharray = _C; el.tlasPrfg.style.strokeDashoffset = _C * (1 - clamp(_stL.t / lwsEmitTimeOf(player), 0, 1)); }
      } else if (_stL.phase === 'cool') {
        if (!_tlasCool) { _tlasCool = true; _tlasFire = false; el.tlas.classList.remove('firing'); el.tlas.classList.add('cooling'); }
        if (el.tlasPrfg) { el.tlasPrfg.style.stroke = '#ffc857'; el.tlasPrfg.style.strokeDasharray = _C; el.tlasPrfg.style.strokeDashoffset = _C * clamp(_stL.t / lwsCooldownTimeOf(player), 0, 1); }
      } else if (_tlasFire || _tlasCool) {
        _tlasFire = false; _tlasCool = false; el.tlas.classList.remove('firing'); el.tlas.classList.remove('cooling');
        if (el.tlasPrfg) el.tlasPrfg.style.strokeDashoffset = _C;
      }
    } else if (_tlasFire || _tlasCool) {
      _tlasFire = false; _tlasCool = false; el.tlas.classList.remove('firing'); el.tlas.classList.remove('cooling');
    }
  }
  if (el.artyring) {                                   // 火箭炮炮镜镜心环 = 第三人称 #ring 同款(同一 ringCol/frac:就绪绿满环/装填黄倒计时/齐射橙计数;射击计数走圆环)
    var _arOn = player && player.kind === 'arty' && scoped;
    if (_arOn !== el.artyring._on) {                   // 显隐边沿写(旧 classList.contains 每帧查询)
      el.artyring._on = _arOn;
      el.artyring.classList.toggle('hidden', !_arOn);
    }
    if (_arOn) ringConic(el.artyring, ringCol, frac);
    if (el.artyringtxt) {                              // 环内读数仅装填倒计时数字(与直升机挂架倒计时同族);射击计数/就绪全由圆环表达(同第三人称)
      var _arTxtOn = _arOn && !(player.salvoLeft > 0) && player.reload > 0;
      if (_arTxtOn !== el.artyringtxt._on) { el.artyringtxt._on = _arTxtOn; el.artyringtxt.classList.toggle('hidden', !_arTxtOn); }
      if (_arTxtOn) {
        var _arTxt = player.reload.toFixed(1) + 's';
        if (el.artyringtxt._t !== _arTxt) { el.artyringtxt._t = _arTxt; el.artyringtxt.textContent = _arTxt; }
      }
    }
  }

  /* 雷达预警与导弹来袭告警驱动 */
  updateRwrMaws(dt);
  updateHeliDangerousAttitude(dt);
  updateLwr(dt);                                // 激光告警(99/M1/直升机)
  updateLws(dt);                                // 激光压制系统
  applyEdgeFlash();   // 边缘红闪单点裁决(MAWS/LWR 两路 want)

  /* 直升机/防空/MBT-1 科技武器栏与雷达锁定 UI 呈现 */
  var hwbEl = el.heliweaponbar;
  var hrlEl = el.heliradarlock;
  var _isAABar = player && player.alive && typeof isAAVehicle === 'function' && isAAVehicle(player);
  var _isRedAARadar = _isAABar && player.team === 'red';
  var _isMbtBar = player && player.alive && typeof isPlayerRedMbtMissileVehicle === 'function' && isPlayerRedMbtMissileVehicle(player);
  var _isTdBar = player && player.alive && typeof isPlayerRedTdHighExplosiveVehicle === 'function' && isPlayerRedTdHighExplosiveVehicle(player);
  var isWeaponBar = player && player.alive && (isHeliVehicle(player) || _isAABar || _isMbtBar || _isTdBar) && gameState === 'playing';
  if (hwbEl) {
    if (isWeaponBar && !scoped) {
      if (hwbEl._on !== true) { hwbEl._on = true; hwbEl.classList.remove('hidden'); }
      var w1 = document.getElementById('hwp-1'), w2 = document.getElementById('hwp-2'), w3 = document.getElementById('hwp-3'), w4 = document.getElementById('hwp-4');
      if (_isTdBar) {
        var tdWp = player._tdWeapon || 1;
        if (w1) w1.classList.toggle('active', tdWp === 1);
        if (w2) w2.classList.toggle('active', tdWp === 2);
        if (w3) { w3.classList.remove('active'); w3.style.display = 'none'; }
        if (w4) { w4.classList.remove('active'); w4.style.display = 'none'; }
        if (w1) w1.style.display = '';
        if (w2) w2.style.display = '';
        var tdName1 = w1 ? w1.querySelector('.hwp-name') : null;
        var tdName2 = w2 ? w2.querySelector('.hwp-name') : null;
        var tdKey1 = w1 ? w1.querySelector('.hwp-key') : null;
        var tdKey2 = w2 ? w2.querySelector('.hwp-key') : null;
        if (tdName1) tdName1.textContent = 'AP ROUND';
        if (tdName2) tdName2.textContent = 'HIGH-EXPLOSIVE';
        if (tdKey1) tdKey1.textContent = '1';
        if (tdKey2) tdKey2.textContent = '2';
        var tdA1 = document.getElementById('hwp-ammo-1'), tdA2 = document.getElementById('hwp-ammo-2');
        var tdLoading = player.reload > 0;
        var tdR = tdLoading ? player.reload.toFixed(1) + 's' : 'READY';
        if (tdA1) tdA1.textContent = tdLoading && (player._tdReloadKind || tdWp) === 1 ? 'LOADING ' + tdR : 'READY';
        if (tdA2) tdA2.textContent = tdLoading && (player._tdReloadKind || tdWp) === 2 ? 'LOADING ' + tdR : 'READY';
      } else if (_isMbtBar) {
        var mbtWp = player._mbtWeapon || 1;
        if (w1) w1.classList.toggle('active', mbtWp === 1);
        if (w2) w2.classList.toggle('active', mbtWp === 2);
        if (w3) { w3.classList.remove('active'); w3.style.display = 'none'; }
        if (w4) { w4.classList.remove('active'); w4.style.display = 'none'; }
        if (w1) w1.style.display = '';
        if (w2) w2.style.display = '';
        var mbtName1 = w1 ? w1.querySelector('.hwp-name') : null;
        var mbtName2 = w2 ? w2.querySelector('.hwp-name') : null;
        var mbtKey1 = w1 ? w1.querySelector('.hwp-key') : null;
        var mbtKey2 = w2 ? w2.querySelector('.hwp-key') : null;
        if (mbtName1) mbtName1.textContent = 'MAIN GUN';
        if (mbtName2) mbtName2.textContent = 'GUN-LAUNCHED MISSILE';
        if (mbtKey1) mbtKey1.textContent = '1';
        if (mbtKey2) mbtKey2.textContent = '2';
        var mbtA1 = document.getElementById('hwp-ammo-1'), mbtA2 = document.getElementById('hwp-ammo-2');
        var mbtLoading = player.reload > 0;
        var mbtR = mbtLoading ? player.reload.toFixed(1) + 's' : 'READY';
        /* One physical breech is unavailable during every reload cycle.  Keep
           both weapon rows honest: the unselected option is loading too, not
           falsely READY while the shared loader is busy. */
        if (mbtA1) mbtA1.textContent = mbtLoading ? 'LOADING ' + mbtR : 'READY';
        if (mbtA2) mbtA2.textContent = mbtLoading ? 'LOADING ' + mbtR : 'READY';
      } else if (_isAABar) {
        var aaWp = player._heliWeapon || 3;
        var aaAtgmInstalled = player._techAaAtgm === true ||
          (typeof vehicleTechAaAtgmInstalled === 'function' && vehicleTechAaAtgmInstalled(player)) ||
          (typeof vehicleTechRedAaAtgmInstalled === 'function' && vehicleTechRedAaAtgmInstalled(player));
        if (w1) { w1.style.display = ''; w1.classList.toggle('active', aaWp === 3); }
        if (w2) { w2.style.display = aaAtgmInstalled ? '' : 'none'; w2.classList.toggle('active', aaWp === 2); }
        if (w3) { w3.style.display = player.team === 'red' ? '' : 'none'; w3.classList.toggle('active', aaWp === 1); }
        if (w4) { w4.style.display = 'none'; w4.classList.remove('active'); }
        var aaName1 = w1 ? w1.querySelector('.hwp-name') : null;
        var aaName2 = w2 ? w2.querySelector('.hwp-name') : null;
        var aaName3 = w3 ? w3.querySelector('.hwp-name') : null;
        var aaKey3 = w3 ? w3.querySelector('.hwp-key') : null;
        if (aaName1) aaName1.textContent = 'SAM';
        if (aaName2) aaName2.textContent = 'ATGM';
        if (aaName3) aaName3.textContent = 'TWIN CANNON';
        if (aaKey3) aaKey3.textContent = aaAtgmInstalled ? '3' : '2';

        var aaA1 = document.getElementById('hwp-ammo-1'), aaA2 = document.getElementById('hwp-ammo-2'), aaA3 = document.getElementById('hwp-ammo-3'), aaA4 = document.getElementById('hwp-ammo-4');
        var aaTot = player._heliMslRounds ? (player._heliMslRounds[0] + player._heliMslRounds[1]) : 0;
        var aaMax = heliMslTubesOf(player) * 2;
        var aaTL = player._heliMissileReloadTL || 0, aaTR = player._heliMissileReloadTR || 0;
        var aaMinT = Math.min(aaTL > 0 ? aaTL : 99, aaTR > 0 ? aaTR : 99);
        var aaLoading = aaTL > 0 || aaTR > 0;
        var aaRoundTxt = aaTot + '/' + aaMax;
        /* SAM and ATGM share the same physical launcher inventory.  Show that
           inventory count on both selectable missile rows; while either rack is
           loading, both rows report the shared loading state instead of READY. */
        var aaDisplayTxt = aaLoading
          ? 'LOADING ' + (aaMinT < 99 ? aaMinT : heliMslReloadTimeOf(player)).toFixed(1) + 's'
          : aaRoundTxt;
        if (aaA1) aaA1.textContent = aaDisplayTxt;
        if (aaA2) aaA2.textContent = aaAtgmInstalled ? aaDisplayTxt : '—';
        if (aaA3) aaA3.textContent = player.reload > 0 ? (player.reload.toFixed(1) + 's') : '∞';
        if (aaA4) aaA4.textContent = '—';
      } else {
        if (w3) w3.style.display = '';
        if (w4) w4.style.display = '';
        var curWp = player._heliWeapon || 3;
        if (w1) w1.classList.toggle('active', curWp === 3);
        if (w2) w2.classList.toggle('active', curWp === 2);
        if (w3) w3.classList.toggle('active', curWp === 1);
        var _e1 = w1 ? w1.querySelector('.hwp-name') : null, _e2 = w2 ? w2.querySelector('.hwp-name') : null;
        if (_e1 && _e1.textContent !== 'MISSILE') _e1.textContent = 'MISSILE';
        if (_e2 && _e2.textContent !== '70mm ROCKET') _e2.textContent = '70mm ROCKET';
        var _e3n = w3 ? w3.querySelector('.hwp-name') : null;
        if (_e3n && _e3n.textContent !== 'CANNON') _e3n.textContent = 'CANNON';
        var _e3k = w3 ? w3.querySelector('.hwp-key') : null;
        if (_e3k && _e3k.textContent !== '3') _e3k.textContent = '3';

        var a1 = document.getElementById('hwp-ammo-1'), a2 = document.getElementById('hwp-ammo-2'), a3 = document.getElementById('hwp-ammo-3'), a4 = document.getElementById('hwp-ammo-4');
        if (a1) {
          var mTot = player._heliMslRounds ? (player._heliMslRounds[0] + player._heliMslRounds[1]) : 0;
          var mMaxT = heliMslTubesOf(player) * 2;
          var tL1 = player._heliMissileReloadTL || 0, tR1 = player._heliMissileReloadTR || 0;
          var mMinT = Math.min(tL1 > 0 ? tL1 : 99, tR1 > 0 ? tR1 : 99);
          var txt1 = mTot + '/' + mMaxT + (mMinT < 99 ? ' (' + mMinT.toFixed(0) + 's)' : '');
          if (a1.textContent !== txt1) a1.textContent = txt1;
        }
        var _rkN = rocketPodCountOf(player);
        var txt2 = player._heliRocketReloadT > 0 ? ('RELOADING ' + player._heliRocketReloadT.toFixed(0) + 's') : ((player._heliRocketLeft != null ? player._heliRocketLeft : _rkN) + '/' + _rkN);
        if (a2 && a2.textContent !== txt2) a2.textContent = txt2;
        var txt3 = player.reload > 0 ? (player.reload.toFixed(1) + 's') : '∞';
        if (a3 && a3.textContent !== txt3) a3.textContent = txt3;
        var decoyLeft = player._heliDecoyLeft != null ? player._heliDecoyLeft : HELI_DECOY_CAPACITY;
        var txt4 = player._heliDecoyReloadT > 0 ? ('RELOADING ' + player._heliDecoyReloadT.toFixed(0) + 's') : (decoyLeft + '/' + HELI_DECOY_CAPACITY);
        if (a4 && a4.textContent !== txt4) a4.textContent = txt4;
      }
    } else {
      if (hwbEl._on !== false) { hwbEl._on = false; hwbEl.classList.add('hidden'); }
    }
  }

  // 画面右侧方形战术雷达 MFD (10Hz 节流, 雷达镜刷新无需 50Hz)
  if (gameT - (player._mfdT || 0) >= 0.10) { player._mfdT = gameT; renderHeliRadarMFD(player); }

  if (hrlEl) {
    /* RED-AA uses the same private radar track state machine as the helicopter.
       Keep the render gate tied to the real radar state, but do not gate it on
       isHeli: that old gate hid RED-AA ATGM tracking/lock boxes entirely. */
    if ((isHeli || _isRedAARadar) && player._heliRadarActive) {
      if (hrlEl._on !== true) { hrlEl._on = true; hrlEl.classList.remove('hidden'); }
      var boxesContainer = document.getElementById('heliradarboxes');
      if (boxesContainer && gameT - (player._boxT || 0) >= 0.066) { player._boxT = gameT;   // 目标框 15Hz 节流(位置冻结 66ms 内不可感)
        var htmlStr = '';

        var camDir = _vComp;
        camera.getWorldDirection(camDir);

        var tracks = player._heliRadarTracks;
        if (tracks && tracks.length > 0) {
          var hasLockedTgt = player._heliMissileTarget != null;
          htmlStr += '<div class="radar-scan-reticle ' + (hasLockedTgt ? 'locked' : 'scanning') + '"></div>';

          // 零内存分配 Top-8 锥心优先呈现:复用静态对象池 _heliRadarTopPool (严格遵守最多追踪8目标上限)
          _heliRadarTopCount = 0;
          for (var ri = 0; ri < tracks.length; ri++) {
            var rt = tracks[ri];
            if (!rt.tank || !rt.tank.alive || !rt.tank.group) continue;
            var key = (rt.tank === player._heliMissileTarget) ? 3.0 : (rt.isLocked ? 2.5 : (rt.isDesignated ? 2.0 : (rt.dotWithCone || 0)));
            var insertPos = _heliRadarTopCount;
            while (insertPos > 0 && _heliRadarTopPool[insertPos - 1].key < key) insertPos--;
            if (insertPos >= HELI_RADAR_MAX_TRACKS) continue;
            var moveCount = Math.min(_heliRadarTopCount, HELI_RADAR_MAX_TRACKS - 1);
            for (var m = moveCount; m > insertPos; m--) {
              _heliRadarTopPool[m].rt = _heliRadarTopPool[m - 1].rt;
              _heliRadarTopPool[m].key = _heliRadarTopPool[m - 1].key;
            }
            _heliRadarTopPool[insertPos].rt = rt;
            _heliRadarTopPool[insertPos].key = key;
            if (_heliRadarTopCount < HELI_RADAR_MAX_TRACKS) _heliRadarTopCount++;
          }

          for (var ri = 0; ri < _heliRadarTopCount; ri++) {
            var rt = _heliRadarTopPool[ri].rt;
            var tPos = rt.tank.group.position;
            var camZ = (tPos.x - camera.position.x) * camDir.x + (tPos.y + 1.2 - camera.position.y) * camDir.y + (tPos.z - camera.position.z) * camDir.z;
            if (camZ <= 0.5) continue; // 严格在相机前方
            _v1.set(tPos.x, tPos.y + 1.2, tPos.z).project(camera);
            if (Math.abs(_v1.x) < 1.05 && Math.abs(_v1.y) < 1.05) {
              var sx = (_v1.x * 0.5 + 0.5) * innerWidth;
              var sy = (-_v1.y * 0.5 + 0.5) * innerHeight;
              rt.screenX = sx;
              rt.screenY = sy;
              var distTxt = (rt.dist >= 1000 ? (rt.dist / 1000).toFixed(1) + 'km' : Math.round(rt.dist) + 'm');
              var cls = '';
              var tagTxt = '';
              if (rt.isLocked) {
                var mCount = 0;
                for (var si = 0; si < airborneMissiles.length; si++) {
                  var sh = airborneMissiles[si];
                  if (sh && sh.isHeliMissile && sh.owner === player && sh.life > 0) {
                    if (sh.target === rt.tank || (rt.tank.id && sh.target.id && rt.tank.id === sh.target.id)) {
                      mCount++;
                    }
                  }
                }
                cls = 'tgtmk locked active-tgt';
                tagTxt = mCount > 0 ? ('[*] LOCK [ENGAGING ' + mCount + ' RDS]') : '[*] LOCK [FIRE ASSIGNED]';
              } else if (rt.isDesignated) {
                cls = 'tgtmk locking';
                var pct = Math.min(99, Math.round(rt.lockEnergy * 100));
                var tRemain = Math.max(0.1, (1.0 - rt.lockEnergy) * rt.tLockRequired).toFixed(1);
                tagTxt = 'LOCKING ' + pct + '% (' + tRemain + 's)';
              } else {
                cls = 'tgtmk scanned';
                tagTxt = 'TRACKING';
              }
              htmlStr += '<div class="' + cls + '" style="left:' + sx.toFixed(1) + 'px;top:' + sy.toFixed(1) + 'px;">' +
                         '<svg viewBox="0 0 44 44"><g class="ink"><path d="M4 15 V4 H15"/><path d="M29 4 H40 V15"/><path d="M40 29 V40 H29"/><path d="M15 40 H4 V29"/></g><g class="mk"><path d="M4 15 V4 H15"/><path d="M29 4 H40 V15"/><path d="M40 29 V40 H29"/><path d="M15 40 H4 V29"/></g></svg>' +
                         '<span class="tgtmk-tag">' + tagTxt + '</span>' +
                         '<span class="tgtmk-dist">' + rt.tank.name + ' ' + distTxt + '</span></div>';
            }
          }
        } else {
          htmlStr += '<div class="radar-scan-reticle scanning"></div>';
        }
        boxesContainer.innerHTML = htmlStr;
      }
    } else {
      if (hrlEl._on !== false) {
        hrlEl._on = false;
        hrlEl.classList.add('hidden');
        var boxesContainer2 = document.getElementById('heliradarboxes');
        if (boxesContainer2) boxesContainer2.innerHTML = '';
      }
    }
  }

  hudTick -= dt;
  if (hudTick <= 0) {
    hudTick = 0.10; // 10Hz 低频节流刷新

    /* 边界警示已重构为物理碰触事件触发器 (onPlayerBoundaryContact),此处彻底移除轮询检测 */

    /* 直升机仪表信息(低频节流格式化,避免每帧产生字符串 GC) */
    if (player && isHeliVehicle(player) && !scoped && el.rangeinfo) {
      var gearMap = { normal: 'NOMINAL', cutoff: 'ENGINE OUT', starting: 'STARTING' };
      var hPrm = HELI_PARAMS[player.kind] || HELI_PARAMS.wz10;
      var gName = gearMap[player._heliGear] || (player._heliEngineState === 'cutoff' ? 'ENGINE OUT' : 'NOMINAL');
      var pwrPct = Math.round((player._heliPower || 0) * 100);
      var rpmPct = Math.round(heliRotorFrac(player, hPrm) * 100);
      var capPct = Math.round(clamp(player._heliCollCap || 0, 0, 1) * 100);
      var collTxt = Math.round((player._heliCollective || 0) * 100) + '%';
      var altM = (player._heliAlt || 0).toFixed(1);
      var spdKmh = (Math.abs(player.speed || 0) * 3.6).toFixed(0);
      var heliInfo = '[' + gName + '] PWR ' + pwrPct + '% - ROTOR ' + rpmPct + '% - COLL ' + collTxt +
                     ' - LIMIT ' + capPct + '% - ALT ' + altM + 'm - SPD ' + spdKmh + 'km/h';
      if (el.rangeinfo._last !== heliInfo) { el.rangeinfo._last = heliInfo; el.rangeinfo.textContent = heliInfo; }
    }

    /* 模块状态改由 3D 迷你 HUD 呈现(player.js playerHudTick/playerHudDamage);此处仅余文字行 */
    if (isFfaMode()) {
      var ffaLiveHud = typeof ffaAliveCount === 'function' ? ffaAliveCount() : aliveList.length;
      if (el.winfo) el.winfo.classList.add('hidden');
      if (el['ffa-winfo']) el['ffa-winfo'].classList.remove('hidden');
      if (el.ffalive) el.ffalive.textContent = ffaLiveHud;
      if (el.ffkills) el.ffkills.textContent = kills;
      if (el.ffreserve) el.ffreserve.textContent = ffaState.reserves;
    } else {
      if (el.winfo) el.winfo.classList.remove('hidden');
      if (el['ffa-winfo']) el['ffa-winfo'].classList.add('hidden');
      el.reds.textContent = countTeam('red');
      el.blues.textContent = countTeam('blue');
      el.kills.textContent = kills;
      el.respawns.textContent = playerRespawns;
      el.poolr.textContent = teamPool.red;
      el.poolb.textContent = teamPool.blue;
    }

    if (typeof minimapTick === 'function') minimapTick(dt);
  }
}

