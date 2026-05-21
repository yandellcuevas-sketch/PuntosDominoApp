/* ═══════════════════════════════════════════════════════════════════
   local.js — Capa de persistencia 100% local (localStorage)
   ─────────────────────────────────────────────────────────────────
   REGLAS DE ORO:
   • Nunca hace llamadas de red.
   • Nunca es async / nunca lanza excepciones al caller.
   • Siempre retorna un valor válido (nunca null inesperado).
   • Compatible con las keys que ya existen en dispositivos activos.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ── Keys de localStorage (mismo nombre que usaba app.js) ──────────
    var _KEYS = {
        GAME    : 'domino_active_game',
        HISTORY : 'domino_history',
        SOUND   : 'domino_sound',
        PROFILE : 'domino_profile',
    };

    // ── Helper seguro de lectura ──────────────────────────────────────
    function _read(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            if (raw === null || raw === undefined) return fallback;
            return JSON.parse(raw);
        } catch (e) {
            console.warn('[local] read error for key "' + key + '":', e.message);
            return fallback;
        }
    }

    // ── Helper seguro de escritura ────────────────────────────────────
    function _write(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            // Puede fallar si el storage está lleno (cuota excedida)
            console.warn('[local] write error for key "' + key + '":', e.message);
            return false;
        }
    }

    // ── Helper seguro de borrado ──────────────────────────────────────
    function _remove(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            console.warn('[local] remove error for key "' + key + '":', e.message);
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  PARTIDA ACTIVA
    // ════════════════════════════════════════════════════════════════

    /**
     * Guarda la partida activa en localStorage.
     * @param {Object} gameObj  Objeto completo de la partida.
     * @returns {boolean}       true si se guardó correctamente.
     */
    function localSaveGame(gameObj) {
        if (!gameObj || typeof gameObj !== 'object') {
            console.warn('[local] localSaveGame: gameObj inválido, se ignora.');
            return false;
        }
        return _write(_KEYS.GAME, gameObj);
    }

    /**
     * Carga la partida activa desde localStorage.
     * @returns {Object|null}   Objeto de la partida, o null si no hay ninguna.
     */
    function localLoadGame() {
        return _read(_KEYS.GAME, null);
    }

    /**
     * Elimina la partida activa del localStorage (al iniciar nueva partida).
     */
    function localClearGame() {
        _remove(_KEYS.GAME);
    }

    // ════════════════════════════════════════════════════════════════
    //  HISTORIAL
    // ════════════════════════════════════════════════════════════════

    /**
     * Guarda el array completo del historial.
     * @param {Array} historyArr  Array de partidas terminadas.
     * @returns {boolean}
     */
    function localSaveHistory(historyArr) {
        if (!Array.isArray(historyArr)) {
            console.warn('[local] localSaveHistory: se esperaba un array.');
            return false;
        }
        return _write(_KEYS.HISTORY, historyArr);
    }

    /**
     * Carga el historial de partidas.
     * @returns {Array}  Array de partidas (nunca null, mínimo []).
     */
    function localLoadHistory() {
        var h = _read(_KEYS.HISTORY, []);
        return Array.isArray(h) ? h : [];
    }

    // ════════════════════════════════════════════════════════════════
    //  CONFIGURACIÓN (sonido + perfil)
    // ════════════════════════════════════════════════════════════════

    var _DEFAULT_SETTINGS = {
        soundEnabled : true,
        profile      : { username: '', avatar: '👤' },
    };

    /**
     * Guarda la configuración del usuario.
     * @param {Object} settingsObj  { soundEnabled, profile }
     * @returns {boolean}
     */
    function localSaveSettings(settingsObj) {
        if (!settingsObj || typeof settingsObj !== 'object') return false;
        // Guardar sonido y perfil por separado para compatibilidad con datos anteriores
        if (settingsObj.hasOwnProperty('soundEnabled')) {
            _write(_KEYS.SOUND, settingsObj.soundEnabled);
        }
        if (settingsObj.profile && typeof settingsObj.profile === 'object') {
            _write(_KEYS.PROFILE, settingsObj.profile);
        }
        return true;
    }

    /**
     * Carga la configuración del usuario.
     * @returns {{ soundEnabled: boolean, profile: { username: string, avatar: string } }}
     */
    function localLoadSettings() {
        // Sonido: la key antigua guardaba el string 'true'/'false'
        var rawSound = localStorage.getItem(_KEYS.SOUND);
        var soundEnabled = (rawSound === null) ? true : (rawSound === 'true' || rawSound === true);

        // Perfil
        var profile = _read(_KEYS.PROFILE, _DEFAULT_SETTINGS.profile);
        if (!profile || typeof profile !== 'object') profile = _DEFAULT_SETTINGS.profile;
        if (!profile.avatar) profile.avatar = '👤';

        return {
            soundEnabled : soundEnabled,
            profile      : profile,
        };
    }

    /**
     * Guarda solo el perfil del usuario.
     * @param {Object} profileObj  { username, avatar }
     */
    function localSaveProfile(profileObj) {
        if (!profileObj || typeof profileObj !== 'object') return false;
        return _write(_KEYS.PROFILE, profileObj);
    }

    /**
     * Carga solo el perfil del usuario.
     * @returns {{ username: string, avatar: string }}
     */
    function localLoadProfile() {
        var p = _read(_KEYS.PROFILE, _DEFAULT_SETTINGS.profile);
        if (!p || typeof p !== 'object') return _DEFAULT_SETTINGS.profile;
        return p;
    }

    // ════════════════════════════════════════════════════════════════
    //  EXPORTACIÓN GLOBAL
    // ════════════════════════════════════════════════════════════════
    window.localSaveGame     = localSaveGame;
    window.localLoadGame     = localLoadGame;
    window.localClearGame    = localClearGame;
    window.localSaveHistory  = localSaveHistory;
    window.localLoadHistory  = localLoadHistory;
    window.localSaveSettings = localSaveSettings;
    window.localLoadSettings = localLoadSettings;
    window.localSaveProfile  = localSaveProfile;
    window.localLoadProfile  = localLoadProfile;

    console.log('[local] Capa de persistencia local inicializada ✓');
})();
