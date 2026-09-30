/**
 * crazygames-adapter.js
 * CrazyGames HTML5 SDK v3 Telemetry & Integration Layer for "Armored Corps"
 * Fully adheres to CrazyGames Developer Guidelines (Basic Launch):
 * - Safe asynchronous SDK init()
 * - Loading start/stop telemetry
 * - Gameplay start/stop lifecycle tracking
 * - Happytime celebration on victory
 * - Desktop WebAudio auto-resume on user interaction
 * - Background tab / minimized browser auto-mute
 */
(function (window) {
  'use strict';

  var CG = {
    isAvailable: false,
    isInitialized: false,
    isInGameplay: false,
    _initPromise: null,
    _savedGain: null,
    _bgmWasPlaying: false
  };

  /**
   * Initialize CrazyGames SDK v3 asynchronously and cache Promise
   */
  CG.init = function () {
    if (CG._initPromise) return CG._initPromise;

    // Desktop WebAudio context auto-resume on user click/interaction
    CG.setupAudioResume();

    // Background tab / minimized browser auto-mute
    CG.setupVisibilityListener();

    if (window.CrazyGames && window.CrazyGames.SDK) {
      console.log('[CrazyGames SDK v3] Initializing SDK...');
      CG._initPromise = window.CrazyGames.SDK.init()
        .then(function () {
          CG.isInitialized = true;
          CG.isAvailable = true;
          console.log('[CrazyGames SDK v3] Initialized successfully. Environment:', window.CrazyGames.SDK.environment);
          return window.CrazyGames.SDK;
        })
        .catch(function (err) {
          console.warn('[CrazyGames SDK v3] Init warning/error:', err);
          CG.isInitialized = true;
          CG.isAvailable = true;
          return window.CrazyGames.SDK;
        });
    } else {
      console.log('[CrazyGames] SDK script not detected; running in standalone / fallback mode.');
      CG._initPromise = Promise.resolve(null);
    }

    return CG._initPromise;
  };

  /**
   * Telemetry: loading start
   */
  CG.loadingStart = function () {
    try {
      var sdk = window.CrazyGames && window.CrazyGames.SDK;
      if (sdk && sdk.game) {
        if (typeof sdk.game.loadingStart === 'function') {
          sdk.game.loadingStart();
        } else if (typeof sdk.game.sdkGameLoadingStart === 'function') {
          sdk.game.sdkGameLoadingStart();
        }
        console.log('[CrazyGames] loadingStart signaled.');
      }
    } catch (e) {}
  };

  /**
   * Telemetry: loading stop
   */
  CG.loadingStop = function () {
    try {
      var sdk = window.CrazyGames && window.CrazyGames.SDK;
      if (sdk && sdk.game) {
        if (typeof sdk.game.loadingStop === 'function') {
          sdk.game.loadingStop();
        } else if (typeof sdk.game.sdkGameLoadingStop === 'function') {
          sdk.game.sdkGameLoadingStop();
        }
        console.log('[CrazyGames] loadingStop signaled.');
      }
    } catch (e) {}
  };

  /**
   * Lifecycle: gameplay start (called when player enters active battle or unpauses)
   */
  CG.gameplayStart = function () {
    if (CG.isInGameplay) return;
    CG.isInGameplay = true;
    try {
      var sdk = window.CrazyGames && window.CrazyGames.SDK;
      if (sdk && sdk.game && typeof sdk.game.gameplayStart === 'function') {
        sdk.game.gameplayStart();
        console.log('[CrazyGames] gameplayStart fired.');
      }
    } catch (e) {}
  };

  /**
   * Lifecycle: gameplay stop (called on pause, game over, or returning to hangar)
   */
  CG.gameplayStop = function () {
    if (!CG.isInGameplay) return;
    CG.isInGameplay = false;
    try {
      var sdk = window.CrazyGames && window.CrazyGames.SDK;
      if (sdk && sdk.game && typeof sdk.game.gameplayStop === 'function') {
        sdk.game.gameplayStop();
        console.log('[CrazyGames] gameplayStop fired.');
      }
    } catch (e) {}
  };

  /**
   * Celebration: happytime (called on Victory, major tactical achievements)
   */
  CG.happytime = function () {
    try {
      var sdk = window.CrazyGames && window.CrazyGames.SDK;
      if (sdk && sdk.game && typeof sdk.game.happytime === 'function') {
        sdk.game.happytime();
        console.log('[CrazyGames] happytime celebrated!');
      }
    } catch (e) {}
  };

  /**
   * Safe Audio muting during app unfocus / background tab
   */
  CG.muteAudio = function () {
    try {
      if (typeof masterGain !== 'undefined' && masterGain && masterGain.gain) {
        CG._savedGain = masterGain.gain.value;
        masterGain.gain.setValueAtTime(0, (typeof AC !== 'undefined' && AC ? AC.currentTime : 0) || 0);
      }
      if (typeof _bgmAudio !== 'undefined' && _bgmAudio && !_bgmAudio.paused) {
        CG._bgmWasPlaying = true;
        _bgmAudio.pause();
      }
    } catch (e) {}
  };

  /**
   * Safe Audio restore when app focused / active tab
   */
  CG.unmuteAudio = function () {
    try {
      if (typeof masterGain !== 'undefined' && masterGain && masterGain.gain) {
        var vol = (typeof CG._savedGain === 'number' && CG._savedGain > 0) ?
          CG._savedGain : (typeof prefVolume !== 'undefined' ? prefVolume : 0.55);
        masterGain.gain.setValueAtTime(vol, (typeof AC !== 'undefined' && AC ? AC.currentTime : 0) || 0);
      }
      if (CG._bgmWasPlaying && typeof _bgmAudio !== 'undefined' && _bgmAudio) {
        CG._bgmWasPlaying = false;
        if (typeof gameState === 'undefined' || gameState === 'menu') {
          _bgmAudio.play().catch(function () {});
        }
      }
    } catch (e) {}
  };

  /**
   * Browser audio context auto-recovery on user interaction (Click / Keydown / Pointer)
   */
  CG.setupAudioResume = function () {
    var resumeContext = function () {
      try {
        if (typeof AC !== 'undefined' && AC && AC.state === 'suspended') {
          AC.resume().then(function () {
            console.log('[Audio] AudioContext resumed successfully on user interaction.');
          }).catch(function () {});
        }
      } catch (e) {}
    };

    window.addEventListener('pointerup', resumeContext, { passive: true });
    window.addEventListener('click', resumeContext, { passive: true });
    window.addEventListener('keydown', resumeContext, { passive: true });
  };

  /**
   * Tab switch / background visibility change auto-mute requirement
   */
  CG.setupVisibilityListener = function () {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        CG.muteAudio();
      } else {
        CG.unmuteAudio();
        if (typeof AC !== 'undefined' && AC && AC.state === 'suspended') {
          AC.resume().catch(function () {});
        }
      }
    });
  };

  // The adapter is loaded from <head>.  CrazyGames SDK v3 creates its
  // overlay container during init(), so calling it before <body> exists can
  // throw inside the SDK (especially in standalone/local smoke tests).
  // Expose the adapter immediately, but initialize after DOM construction.
  window.CrazyGamesAdapter = CG;
  function initWhenDomReady() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { CG.init(); }, { once: true });
    } else {
      CG.init();
    }
  }
  initWhenDomReady();
})(window);
