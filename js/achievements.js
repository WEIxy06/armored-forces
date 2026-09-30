/* ===== Module: achievements.js ===== */
/* ============================================================
   本地成就档案系统
   · 具体成就定义暂不接入，catalog 保持空数组。
   · 对局统计先写入 match 暂存区；只有 gameOver 后 commitMatch 才合并到本地档案。
   · 存档只写入玩家本地 localStorage，不依赖 CrazyGames 账号或网络。
   ============================================================ */
(function (window, document) {
  'use strict';

  var STORAGE_KEY = 'armoredCorps.achievements.v1';
  var SCHEMA_VERSION = 3;
  var state = null;
  var storageFallback = false;
  var panelOpen = false;
  var match = null;

  function emptyStats() {
    return {
      destroyedTotal: 0,
      destroyedByVehicle: {},
      sortiesByVehicle: {},
      labels: {},
      bestKillStreak: 0,
      bestKillStreakVehicle: '',
      farthestKillDistance: 0,
      farthestKillDistanceVehicle: ''
    };
  }

  function emptyState() {
    return {
      version: SCHEMA_VERSION,
      catalog: [],
      unlocked: {},
      progress: {},
      stats: emptyStats(),
      updatedAt: 0
    };
  }

  function asCount(v) {
    v = Number(v);
    return isFinite(v) && v > 0 ? Math.floor(v) : 0;
  }

  function asDistance(v) {
    v = Number(v);
    return isFinite(v) && v > 0 ? v : 0;
  }

  function copyMap(raw, numeric) {
    var out = {}, k, v;
    if (!raw || typeof raw !== 'object') return out;
    for (k in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      v = raw[k];
      out[k] = numeric ? asCount(v) : v;
    }
    return out;
  }

  function normalize(raw) {
    var out = emptyState(), k;
    if (!raw || typeof raw !== 'object') return out;

    out.version = SCHEMA_VERSION;
    if (Array.isArray(raw.catalog)) out.catalog = raw.catalog.slice();
    if (raw.unlocked && typeof raw.unlocked === 'object') {
      for (k in raw.unlocked) {
        if (Object.prototype.hasOwnProperty.call(raw.unlocked, k)) out.unlocked[k] = raw.unlocked[k];
      }
    }
    if (raw.progress && typeof raw.progress === 'object') {
      for (k in raw.progress) {
        if (Object.prototype.hasOwnProperty.call(raw.progress, k)) out.progress[k] = raw.progress[k];
      }
    }
    if (raw.stats && typeof raw.stats === 'object') {
      out.stats.destroyedTotal = asCount(raw.stats.destroyedTotal);
      out.stats.destroyedByVehicle = copyMap(raw.stats.destroyedByVehicle, true);
      out.stats.sortiesByVehicle = copyMap(raw.stats.sortiesByVehicle, true);
      out.stats.labels = copyMap(raw.stats.labels, false);
      out.stats.bestKillStreak = asCount(raw.stats.bestKillStreak);
      out.stats.bestKillStreakVehicle = typeof raw.stats.bestKillStreakVehicle === 'string' ? raw.stats.bestKillStreakVehicle : '';
      out.stats.farthestKillDistance = asDistance(raw.stats.farthestKillDistance);
      out.stats.farthestKillDistanceVehicle = typeof raw.stats.farthestKillDistanceVehicle === 'string' ? raw.stats.farthestKillDistanceVehicle : '';
    }
    out.updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : 0;
    return out;
  }

  function persist() {
    if (!state) return false;
    state.updatedAt = Date.now();
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageFallback = false;
      return true;
    } catch (e) {
      // 隐私模式/存储配额不足时保留本会话内存档，界面明确显示降级状态。
      storageFallback = true;
      return false;
    }
  }

  function load() {
    if (state) return state;
    var rawText = null, parsed = null, needsMigration = false;
    try {
      rawText = window.localStorage.getItem(STORAGE_KEY);
      parsed = rawText ? JSON.parse(rawText) : null;
      needsMigration = !parsed || parsed.version !== SCHEMA_VERSION;
    } catch (e) {
      // JSON 损坏时重建容器；如果 localStorage 本身仍可写，下面会覆盖旧值。
      parsed = null;
      needsMigration = true;
    }
    state = normalize(parsed);
    if (needsMigration) persist();
    return state;
  }

  function get(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    var node = get(id);
    if (node) node.textContent = String(value);
  }

  function paddedCount(n) {
    n = asCount(n);
    return n < 10 ? '0' + n : String(n);
  }

  function formatDistance(m) {
    m = asDistance(m);
    return m > 0 ? m.toFixed(1) + 'm' : '0.0m';
  }

  function statVehicleLabel(key) {
    if (!key) return 'NO RECORD';
    return state.stats.labels[key] || key;
  }

  function sumMap(map) {
    var total = 0, k;
    if (!map) return 0;
    for (k in map) if (Object.prototype.hasOwnProperty.call(map, k)) total += asCount(map[k]);
    return total;
  }

  function vehicleStatKey(team, kind) {
    team = team || 'unknown';
    kind = kind || 'unknown';
    return String(team).toLowerCase() + ':' + String(kind).toLowerCase();
  }

  function modelLabel(team, kind, vehicle) {
    var label = '';
    try {
      if (vehicle && typeof vehicleDisplayName === 'function') label = vehicleDisplayName(vehicle);
      else if (typeof vehicleDisplayName === 'function') label = vehicleDisplayName({ team: team, kind: kind });
    } catch (e1) {}
    if (!label) {
      try {
        if (typeof vehicleKindName === 'function') label = vehicleKindName(team, kind);
      } catch (e2) {}
    }
    return label || (String(team || 'UNKNOWN').toUpperCase() + ' // ' + String(kind || 'VEHICLE').toUpperCase());
  }

  function knownVehicleSlots() {
    var slots = [], seen = {}, teams = ['red', 'blue'], registry = window.VEHICLE_KINDS || [];
    var i, j, vk, team, key;
    for (i = 0; i < registry.length; i++) {
      vk = registry[i];
      for (j = 0; j < teams.length; j++) {
        team = teams[j];
        if (vk.sides && !vk.sides[team]) continue;
        key = vehicleStatKey(team, vk.kind);
        if (seen[key]) continue;
        seen[key] = true;
        slots.push({ key: key, team: team, kind: vk.kind, label: modelLabel(team, vk.kind) });
      }
    }
    return slots;
  }

  function allVehicleSlots() {
    load();
    var slots = knownVehicleSlots(), seen = {}, maps = [state.stats.destroyedByVehicle, state.stats.sortiesByVehicle], k;
    for (var i = 0; i < slots.length; i++) seen[slots[i].key] = true;
    for (var m = 0; m < maps.length; m++) {
      for (k in maps[m]) {
        if (!Object.prototype.hasOwnProperty.call(maps[m], k) || seen[k]) continue;
        seen[k] = true;
        slots.push({ key: k, label: state.stats.labels[k] || k });
      }
    }
    return slots;
  }

  function drawLedger(hostId, map) {
    var host = get(hostId);
    if (!host) return;
    host.innerHTML = '';
    var slots = allVehicleSlots(), i, row, label, count;
    if (!slots.length) {
      row = document.createElement('div');
      row.className = 'mm-achievement-ledger-empty';
      row.textContent = 'NO VEHICLE TYPES REGISTERED';
      host.appendChild(row);
      return;
    }
    for (i = 0; i < slots.length; i++) {
      label = slots[i].label || slots[i].key;
      count = map && map[slots[i].key] ? map[slots[i].key] : 0;
      row = document.createElement('div');
      row.className = 'mm-achievement-ledger-row';
      var name = document.createElement('span');
      name.className = 'mm-achievement-ledger-name';
      name.textContent = label;
      var value = document.createElement('strong');
      value.className = 'mm-achievement-ledger-value';
      value.textContent = paddedCount(count);
      row.appendChild(name);
      row.appendChild(value);
      host.appendChild(row);
    }
  }

  function unlockedCount() {
    var n = 0, k;
    load();
    for (k in state.unlocked) {
      if (Object.prototype.hasOwnProperty.call(state.unlocked, k) && state.unlocked[k]) n++;
    }
    return n;
  }

  function render() {
    var panel = get('achievements-panel');
    if (!panel) return;
    load();

    var unlocked = unlockedCount();
    var stats = state.stats || emptyStats();
    var totalSorties = sumMap(stats.sortiesByVehicle);
    var totalDestroyed = asCount(stats.destroyedTotal);
    var totalDefined = state.catalog && state.catalog.length ? state.catalog.length : 0;

    setText('achievement-unlocked-count', paddedCount(unlocked));
    setText('achievement-total-count', paddedCount(totalDefined));
    setText('achievement-total-destroyed', paddedCount(totalDestroyed));
    setText('achievement-total-sorties', paddedCount(totalSorties));
    setText('achievement-schema-version', paddedCount(SCHEMA_VERSION));
    setText('achievement-best-streak-count', paddedCount(stats.bestKillStreak));
    setText('achievement-best-streak-vehicle', statVehicleLabel(stats.bestKillStreakVehicle));
    setText('achievement-farthest-distance', formatDistance(stats.farthestKillDistance));
    setText('achievement-farthest-distance-vehicle', statVehicleLabel(stats.farthestKillDistanceVehicle));
    var statusEl = get('achievement-storage-status');
    if (statusEl) {
      statusEl.textContent = storageFallback ? 'SESSION CACHE // STORAGE LIMITED' : 'LOCAL ARCHIVE // READY';
      statusEl.classList.toggle('warn', storageFallback);
    }
    var stamp = get('achievement-record-stamp');
    if (stamp) stamp.textContent = totalDestroyed || totalSorties ? 'RECORDS UPDATED' : 'DATABASE ONLINE';

    drawLedger('achievement-destroyed-by-model', stats.destroyedByVehicle);
    drawLedger('achievement-sorties-by-model', stats.sortiesByVehicle);

    var list = get('achievements-list');
    if (list) {
      // 没有具体成就定义时不显示“尚未准备好”的占位英文；未来有解锁记录后再显示摘要。
      if (!unlocked) {
        list.innerHTML = '';
        list.classList.add('hidden');
      } else {
        list.classList.remove('hidden');
        list.innerHTML =
          '<div class="mm-achievement-empty-title">LOCAL RECORDS DETECTED</div>' +
          '<div class="mm-achievement-empty-copy">' + unlocked + ' record(s) stored in the local archive.</div>';
      }
    }
  }

  /* ===== 对局暂存与结算提交 ===== */
  function emptyMatch() {
    return {
      destroyedTotal: 0,
      destroyedByVehicle: {},
      sortiesByVehicle: {},
      labels: {},
      bestKillStreak: 0,
      bestKillStreakVehicle: '',
      farthestKillDistance: 0,
      farthestKillDistanceVehicle: '',
      currentLifeKills: 0,
      currentLifeVehicle: '',
      startedAt: Date.now()
    };
  }

  function matchLabel(target, team, kind) {
    var key = vehicleStatKey(team, kind);
    if (!match.labels[key]) match.labels[key] = modelLabel(team, kind, target);
    return key;
  }

  function beginLife(vehicle) {
    if (!match) return false;
    match.currentLifeKills = 0;
    match.currentLifeVehicle = '';
    if (vehicle) {
      var team = vehicle.team || 'unknown', kind = vehicle.kind || 'unknown';
      match.currentLifeVehicle = matchLabel(vehicle, team, kind);
    }
    return true;
  }

  function endLife() {
    if (!match) return false;
    match.currentLifeKills = 0;
    match.currentLifeVehicle = '';
    return true;
  }

  function beginMatch(initialVehicle) {
    load();
    // 新对局开始时只重置内存暂存，不触碰已经录入 localStorage 的历史数据。
    match = emptyMatch();
    // 初始部署也是一次实际出击；后续普通重新部署/友军接管都会开启新的生命段，但只有重新部署计出击次数。
    if (initialVehicle) noteDeployment(initialVehicle);
    return getMatchState();
  }

  function noteDeployment(vehicle) {
    if (!match || !vehicle) return false;
    var team = vehicle.team || 'unknown', kind = vehicle.kind || 'unknown';
    var key = matchLabel(vehicle, team, kind);
    beginLife(vehicle);
    match.sortiesByVehicle[key] = (match.sortiesByVehicle[key] || 0) + 1;
    return true;
  }

  function noteDestroyed(target, cause, attacker, distance) {
    if (!match || !target) return false;
    var team = target.team || 'unknown', kind = target.kind || 'unknown';
    var key = matchLabel(target, team, kind);
    match.destroyedTotal++;
    match.destroyedByVehicle[key] = (match.destroyedByVehicle[key] || 0) + 1;

    // 连杀和最远击毁均使用击毁瞬间的玩家载具，不受之后换车影响。
    if (attacker) {
      var aTeam = attacker.team || 'unknown', aKind = attacker.kind || 'unknown';
      var aKey = matchLabel(attacker, aTeam, aKind);
      match.currentLifeKills++;
      match.currentLifeVehicle = aKey;
      if (match.currentLifeKills > match.bestKillStreak) {
        match.bestKillStreak = match.currentLifeKills;
        match.bestKillStreakVehicle = aKey;
      }
      distance = asDistance(distance);
      if (!distance && attacker.group && attacker.group.position && target.group && target.group.position) {
        var ap = attacker.group.position, tp = target.group.position;
        var dx = ap.x - tp.x, dy = ap.y - tp.y, dz = ap.z - tp.z;
        distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      if (distance > match.farthestKillDistance) {
        match.farthestKillDistance = distance;
        match.farthestKillDistanceVehicle = aKey;
      }
    }
    return true;
  }

  function mergeMatchMap(dst, src, labelSource) {
    var k;
    for (k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      dst[k] = (dst[k] || 0) + asCount(src[k]);
      if (labelSource && labelSource[k] && !state.stats.labels[k]) state.stats.labels[k] = labelSource[k];
    }
  }

  function commitMatch() {
    if (!match) return false;
    load();
    var committed = match;
    match = null;
    state.stats.destroyedTotal += asCount(committed.destroyedTotal);
    mergeMatchMap(state.stats.destroyedByVehicle, committed.destroyedByVehicle, committed.labels);
    mergeMatchMap(state.stats.sortiesByVehicle, committed.sortiesByVehicle, committed.labels);
    if (committed.bestKillStreak > state.stats.bestKillStreak) {
      state.stats.bestKillStreak = asCount(committed.bestKillStreak);
      state.stats.bestKillStreakVehicle = committed.bestKillStreakVehicle || '';
      if (committed.bestKillStreakVehicle && committed.labels[committed.bestKillStreakVehicle]) state.stats.labels[committed.bestKillStreakVehicle] = committed.labels[committed.bestKillStreakVehicle];
    }
    if (committed.farthestKillDistance > state.stats.farthestKillDistance) {
      state.stats.farthestKillDistance = asDistance(committed.farthestKillDistance);
      state.stats.farthestKillDistanceVehicle = committed.farthestKillDistanceVehicle || '';
      if (committed.farthestKillDistanceVehicle && committed.labels[committed.farthestKillDistanceVehicle]) state.stats.labels[committed.farthestKillDistanceVehicle] = committed.labels[committed.farthestKillDistanceVehicle];
    }
    persist();
    render();
    return true;
  }

  function cancelMatch() {
    match = null;
  }

  function cloneStats(src) {
    return {
      destroyedTotal: asCount(src.destroyedTotal),
      destroyedByVehicle: copyMap(src.destroyedByVehicle, true),
      sortiesByVehicle: copyMap(src.sortiesByVehicle, true),
      labels: copyMap(src.labels, false),
      bestKillStreak: asCount(src.bestKillStreak),
      bestKillStreakVehicle: src.bestKillStreakVehicle || '',
      farthestKillDistance: asDistance(src.farthestKillDistance),
      farthestKillDistanceVehicle: src.farthestKillDistanceVehicle || ''
    };
  }

  function getMatchState() {
    if (!match) return null;
    var out = cloneStats(match);
    out.currentLifeKills = asCount(match.currentLifeKills);
    out.currentLifeVehicle = match.currentLifeVehicle || '';
    return out;
  }

  function unlock(id, meta) {
    if (!id) return false;
    load();
    if (state.unlocked[id]) return false;
    state.unlocked[id] = {
      unlockedAt: Date.now(),
      meta: meta || null
    };
    persist();
    render();
    return true;
  }

  function isUnlocked(id) {
    load();
    return !!(id && state.unlocked[id]);
  }

  function getState() {
    load();
    return {
      version: state.version,
      catalog: state.catalog.slice(),
      unlocked: copyMap(state.unlocked, false),
      progress: copyMap(state.progress, false),
      stats: cloneStats(state.stats),
      updatedAt: state.updatedAt
    };
  }

  function open() {
    var panel = get('achievements-panel');
    if (!panel) return;
    load();
    panelOpen = true;
    panel.classList.remove('hidden');
    panel.setAttribute('aria-hidden', 'false');
    render();
    var closeBtn = get('achievements-close');
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    var panel = get('achievements-panel');
    panelOpen = false;
    if (panel) {
      panel.classList.add('hidden');
      panel.setAttribute('aria-hidden', 'true');
    }
  }

  function toggle() {
    if (panelOpen || (get('achievements-panel') && !get('achievements-panel').classList.contains('hidden'))) close();
    else open();
  }

  function init() {
    load();
    render();
    var closeBtn = get('achievements-close');
    if (closeBtn) closeBtn.addEventListener('click', close);
    var panel = get('achievements-panel');
    if (panel) panel.addEventListener('click', function (e) {
      if (e.target === panel) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.code === 'Escape' && panelOpen) {
        e.preventDefault();
        close();
      }
    });
  }

  window.Achievements = {
    storageKey: STORAGE_KEY,
    schemaVersion: SCHEMA_VERSION,
    open: open,
    close: close,
    toggle: toggle,
    unlock: unlock,
    isUnlocked: isUnlocked,
    getState: getState,
    getMatchState: getMatchState,
    beginMatch: beginMatch,
    beginLife: beginLife,
    endLife: endLife,
    noteDeployment: noteDeployment,
    noteDestroyed: noteDestroyed,
    commitMatch: commitMatch,
    cancelMatch: cancelMatch,
    render: render
  };

  init();
})(window, document);
