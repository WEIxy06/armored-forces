(function () {
  if (window.CrazyGamesAdapter) window.CrazyGamesAdapter.loadingStart();
  var pct = 0;
  var targetPct = 20;
  var fillEl = null, pctEl = null, statEl = null, loaderEl = null;
  var isDone = false;
  var containerEl = null;
  var loaderHidden = false;

  /* ===== 加载完成后直接进入车库/主界面 =====
     不再拦截用户手势等待按键，进度达到 100% 后平滑淡出并直接展现车库。
     同时触发 playMenuBgm()；若浏览器安全策略拦截自动播放，
     audio.js 的全局交互监听器会在玩家点击/触摸车库任意按键时瞬间无缝唤醒 BGM。 */
  function _hideBootLoader(cb) {
    if (loaderHidden) {
      if (cb) cb();
      return;
    }
    loaderHidden = true;
    getEls();
    if (loaderEl) {
      loaderEl.classList.add('hidden-loader');
      loaderEl.style.pointerEvents = 'none';
      setTimeout(function () {
        if (loaderEl) {
          loaderEl.style.display = 'none';
        }
      }, 380);
    }
    if (window.CrazyGamesAdapter) window.CrazyGamesAdapter.loadingStop();
    if (typeof playMenuBgm === 'function') {
      try { playMenuBgm(); } catch (eBgm) {}
    }
    if (cb) cb();
  }

  function getEls() {
    if (!fillEl) fillEl = document.getElementById('loader-fill');
    if (!pctEl) pctEl = document.getElementById('loader-pct');
    if (!statEl) statEl = document.getElementById('loader-status');
    if (!loaderEl) loaderEl = document.getElementById('game-boot-loader');
    if (!containerEl && loaderEl) containerEl = loaderEl.querySelector('.loader-container');
  }

  window._setBootProgress = function (p, statusText) {
    targetPct = Math.max(targetPct, Math.min(100, Math.round(p)));
    getEls();
    if (statEl && statusText) statEl.textContent = statusText;
  };

  window._finishBootLoader = function () {
    window._setBootProgress(100, 'SYSTEM READY // LAUNCHING...');
    isDone = true;
  };

  window.showBootLoading = function (statusText, onDone) {
    getEls();
    loaderHidden = false;
    if (!loaderEl) {
      loaderEl = document.createElement('div');
      loaderEl.id = 'game-boot-loader';
      loaderEl.innerHTML = '<div class="loader-container">' +
        '<div class="loader-header">' +
          '<span class="loader-title">TACTICAL SYSTEM // INITIALIZING</span>' +
          '<span id="loader-pct" class="loader-pct">0%</span>' +
        '</div>' +
        '<div class="loader-track">' +
          '<div id="loader-fill" class="loader-fill"></div>' +
          '<div class="loader-grid-overlay"></div>' +
        '</div>' +
        '<div class="loader-footer">' +
          '<span id="loader-status" class="loader-status">LOADING ASSETS &amp; COMPILED SHADERS...</span>' +
          '<span class="loader-cursor blink">_</span>' +
        '</div>' +
      '</div>';
      document.body.appendChild(loaderEl);
      fillEl = pctEl = statEl = null;
      getEls();
    }
    if (containerEl) containerEl.style.display = 'flex';
    loaderEl.classList.remove('hidden-loader');
    loaderEl.style.display = 'flex';
    loaderEl.style.opacity = '1';
    loaderEl.style.pointerEvents = 'auto';
    if (statEl && statusText) statEl.textContent = statusText;
    if (fillEl) fillEl.style.width = '0%';
    if (pctEl) pctEl.textContent = '0%';

    var cur = 0;
    var startT = (window.performance && performance.now) ? performance.now() : Date.now();
    var dur = 460;
    function anim(now) {
      var t = Math.min(1, (now - startT) / dur);
      cur = t * 100;
      if (fillEl) fillEl.style.width = cur.toFixed(1) + '%';
      if (pctEl) pctEl.textContent = Math.floor(cur) + '%';
      if (t < 1) {
        requestAnimationFrame(anim);
      } else {
        if (pctEl) pctEl.textContent = '100%';
        if (statEl) statEl.textContent = 'SYSTEM READY // LAUNCHING...';
        _hideBootLoader(onDone);
      }
    }
    requestAnimationFrame(anim);
  };

  function tick() {
    getEls();
    if (pct < targetPct) {
      pct += Math.max(0.6, (targetPct - pct) * 0.22);
      if (pct > targetPct) pct = targetPct;
    }
    var intP = Math.floor(pct);
    if (fillEl) fillEl.style.width = pct + '%';
    if (pctEl) pctEl.textContent = intP + '%';

    if (isDone && pct >= 99.5) {
      if (fillEl) fillEl.style.width = '100%';
      if (pctEl) pctEl.textContent = '100%';
      _hideBootLoader(null);
      return;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
