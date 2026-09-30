
/* 调试/自动基线引导:?debug=1 或 ?autotest=midgame → __TANK_DEBUG
   (core.js 的 DBG_ON 在加载期快照,必须在其加载前置位) */
if (/[?&](debug=1|autotest=midgame)/.test(location.search)) window.__TANK_DEBUG = true;

