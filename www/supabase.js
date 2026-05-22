/* ═══════════════════════════════════════════════════════════════════
   supabase.js — Capa OPCIONAL de modo espectador (solo realtime)
   ─────────────────────────────────────────────────────────────────
   REGLAS DE ORO:
   • Nunca bloquea el splash, la partida, el historial ni la config.
   • Nunca lanza excepciones al caller (todo va en try/catch interno).
   • Nunca muestra alert() ni errores técnicos al usuario.
   • Si Supabase está down, el modo espectador simplemente no funciona.
   • El flujo principal (local) sigue 100% operativo siempre.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    var SUPABASE_URL = 'https://zfrthbupraufxhgbmgmh.supabase.co';
    var SUPABASE_KEY = 'sb_publishable_VcuOeLUk127F4UvAchf1Xw_s_xVA-VR';

    // ── Estado interno del módulo ─────────────────────────────────────
    var _client          = null;   // instancia de supabase-js, o null si no disponible
    var _anonUserId      = null;   // user_id anónimo para publicar en BD
    var _authInitialized = false;  // para no intentar auth múltiples veces
    var _authPending     = false;  // evita inicios paralelos
    var _currentChannel  = null;   // canal realtime activo
    var _currentRoomCode = null;   // código de sala activo

    // Timeout en ms para llamadas de red (Aumentado a 15s para conexiones lentas iniciales)
    var NETWORK_TIMEOUT_MS = 15000;

    // ── Inicialización lazy del cliente ──────────────────────────────
    function _getClient() {
        if (_client) return _client;
        try {
            if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
                // SDK no disponible (CDN no cargó, modo offline, etc.)
                return null;
            }
            _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: false,
                }
            });
            return _client;
        } catch (e) {
            console.warn('[spectator] No se pudo inicializar cliente Supabase:', e.message);
            return null;
        }
    }

    // ── Autenticación anónima lazy (solo para espectador) ────────────
    // Se llama en background cuando se activa el modo espectador.
    // NUNCA bloquea la UI ni el splash.
    var _authPendingPromise = null;

    async function _ensureAnonAuth() {
        if (_authInitialized) return _anonUserId;
        if (_authPendingPromise) return await _authPendingPromise;

        var client = _getClient();
        if (!client) return null;

        _authPendingPromise = (async () => {
            try {
                // Intentar sesión existente primero (rápido, local)
                var sessionResult = await Promise.race([
                    client.auth.getSession(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS))
                ]);

                if (sessionResult && sessionResult.data && sessionResult.data.session) {
                    _anonUserId = sessionResult.data.session.user.id;
                    _authInitialized = true;
                    return _anonUserId;
                }

                // No hay sesión — iniciar anónimamente
                var signInResult = await Promise.race([
                    client.auth.signInAnonymously(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS))
                ]);

                if (signInResult && signInResult.data && signInResult.data.user) {
                    _anonUserId = signInResult.data.user.id;
                    _authInitialized = true;
                    return _anonUserId;
                }
            } catch (e) {
                // Auth falló — modo espectador no disponible, pero la app continúa
                console.warn('[spectator] Auth anónima falló (modo espectador no disponible):', e.message);
            }
            return null;
        })();

        var result = await _authPendingPromise;
        _authPendingPromise = null;
        return result;
    }

    // ════════════════════════════════════════════════════════════════
    //  API PÚBLICA — ESPECTADOR
    // ════════════════════════════════════════════════════════════════

    /**
     * Indica si el modo espectador está disponible en este momento.
     * Verificación rápida, sincrónica.
     * @returns {boolean}
     */
    function spectatorIsAvailable() {
        return _getClient() !== null && navigator.onLine;
    }

    /**
     * Publica el estado mínimo de la partida para los espectadores.
     * Fire-and-forget — no lanza excepciones, no bloquea.
     * Solo publica si hay espectador activo (room_code configurado).
     *
     * @param {Object} minimalState — datos mínimos de la partida
     */
    async function spectatorPublishState(minimalState) {
        if (!minimalState) return;

        var code = minimalState.room_code || minimalState.code || _currentRoomCode;
        if (!code) return;

        _currentRoomCode = decodeURIComponent(String(code)).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

        var client = _getClient();
        if (!client) return;

        // Asegurar auth en background (no bloqueante para el caller)
        var userId = null;
        try {
            userId = await _ensureAnonAuth();
        } catch (e) {
            console.warn('[spectator] Auth error during publish:', e.message);
        }

        var payload = {
            room_code    : _currentRoomCode,
            user_id      : userId || null,
            team_a_name  : minimalState.team_a_name  || '',
            team_b_name  : minimalState.team_b_name  || '',
            team_a_score : minimalState.team_a_score || 0,
            team_b_score : minimalState.team_b_score || 0,
            target_score : minimalState.target_score || 0,
            current_round: minimalState.current_round || 0,
            game_status  : minimalState.game_status  || 'active',
            hands        : minimalState.hands        || [],
            updated_at   : new Date().toISOString(),
        };

        try {
            var result = await Promise.race([
                client.from('spectator_rooms').upsert(payload, { onConflict: 'room_code' }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)
                )
            ]);

            if (result && result.error) {
                console.warn('[spectator] Error de base de datos al publicar estado:', result.error.message, result.error.details);
                
                var errStr = String(result.error.message || '').toLowerCase();
                var errDetail = String(result.error.details || '').toLowerCase();
                if (errStr.includes('foreign key') || errStr.includes('violates') || errStr.includes('policy') || errStr.includes('security') ||
                    errDetail.includes('foreign key') || errDetail.includes('violates') || errDetail.includes('policy')) {
                    
                    console.log('[spectator] Detectado error de autenticación/clave foránea en DB. Intentando re-autenticar...');
                    _authInitialized = false;
                    _anonUserId = null;
                    try {
                        await client.auth.signOut();
                    } catch (signOutErr) {
                        console.warn('[spectator] Error al hacer signOut:', signOutErr.message);
                    }
                    
                    var newUserId = await _ensureAnonAuth();
                    payload.user_id = newUserId || null;
                    console.log('[spectator] Re-intentando upsert con nueva sesión...');
                    var retryResult = await client.from('spectator_rooms').upsert(payload, { onConflict: 'room_code' });
                    if (retryResult && retryResult.error) {
                        console.error('[spectator] Re-intento de upsert falló también:', retryResult.error.message);
                    } else {
                        console.log('[spectator] Re-intento de upsert exitoso ✓');
                    }
                }
            }
        } catch (e) {
            console.warn('[spectator] Publicación falló (la partida local continúa):', e.message);
        }
    }

    /**
     * Crea una sala de espectador y empieza a publicar el estado.
     * @param {Object} gameState  Estado completo de la partida local.
     * @returns {Promise<string|null>}  room_code si se pudo crear, null si falló.
     */
    async function spectatorCreateRoom(gameState) {
        if (!gameState || !gameState.code) return null;

        var client = _getClient();
        if (!client || !navigator.onLine) return null;

        _currentRoomCode = decodeURIComponent(String(gameState.code)).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

        try {
            await _ensureAnonAuth();
        } catch (e) {
            console.warn('[spectator] Auth error during room creation:', e.message);
        }

        var minimal = _gameToMinimal(gameState);
        await spectatorPublishState(minimal);
        return _currentRoomCode;
    }

    /**
     * Se suscribe a una sala de espectador para recibir actualizaciones en tiempo real.
     * @param {string}   code      Código de la sala.
     * @param {Function} onUpdate  Callback(minimalState) llamado con cada actualización.
     *                             Se llama con null si no se encontró la sala.
     * @returns {Promise<boolean>}  true si se suscribió, false si falló.
     */
    async function spectatorSubscribeRoom(code, onUpdate) {
        if (!code || typeof onUpdate !== 'function') return false;

        var client = _getClient();
        if (!client || !navigator.onLine) {
            // Llamar callback con error para que la UI muestre el estado de error de conexión
            _safeCallback(onUpdate, null, new Error('offline'));
            return false;
        }

        // Cerrar canal anterior si existe
        spectatorCloseRoom();

        try {
            await _ensureAnonAuth();
        } catch (e) {
            console.warn('[spectator] Auth error during subscription:', e.message);
        }

        _currentRoomCode = decodeURIComponent(String(code)).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

        // 1. Obtener estado actual (snapshot inicial)
        try {
            var snapshotResult = await Promise.race([
                client.from('spectator_rooms')
                    .select('*')
                    .eq('room_code', _currentRoomCode)
                    .maybeSingle(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)
                )
            ]);

            if (snapshotResult && snapshotResult.error) {
                console.warn('[spectator] Error consultando sala:', snapshotResult.error.message);
                _safeCallback(onUpdate, null, snapshotResult.error);
            } else if (snapshotResult && snapshotResult.data) {
                _safeCallback(onUpdate, snapshotResult.data, null);
            } else {
                // La sala no existe aún o no se encontró
                _safeCallback(onUpdate, null, null);
            }
        } catch (e) {
            console.warn('[spectator] No se pudo obtener snapshot inicial:', e.message);
            _safeCallback(onUpdate, null, e);
            return false;
        }

        // 2. Suscribirse a cambios en tiempo real
        try {
            _currentChannel = client
                .channel('spectator-' + _currentRoomCode)
                .on(
                    'postgres_changes',
                    {
                        event  : '*',
                        schema : 'public',
                        table  : 'spectator_rooms',
                        filter : 'room_code=eq.' + _currentRoomCode,
                    },
                    function (payload) {
                        if (payload && payload.new) {
                            _safeCallback(onUpdate, payload.new, null);
                        }
                    }
                )
                .subscribe(function (status) {
                    if (status === 'CHANNEL_ERROR') {
                        console.warn('[spectator] Error en canal realtime.');
                        _safeCallback(onUpdate, null, new Error('channel_error'));
                    }
                });
        } catch (e) {
            console.warn('[spectator] No se pudo crear canal realtime:', e.message);
            return false;
        }

        return true;
    }

    /**
     * Cierra la sala de espectador actual y limpia el canal realtime.
     */
    function spectatorCloseRoom() {
        if (_currentChannel) {
            try {
                var client = _getClient();
                if (client) client.removeChannel(_currentChannel);
            } catch (e) {
                console.warn('[spectator] Error cerrando canal:', e.message);
            }
            _currentChannel  = null;
        }
        _currentRoomCode = null;
    }

    // ════════════════════════════════════════════════════════════════
    //  HELPERS INTERNOS
    // ════════════════════════════════════════════════════════════════

    /**
     * Convierte el estado completo de la partida al formato mínimo del espectador.
     * No incluye datos personales, identificadores privados ni passwords.
     */
    function _gameToMinimal(g) {
        if (!g || !g.teams) return null;
        var t1 = g.teams[0], t2 = g.teams[1];
        return {
            room_code    : g.code,
            team_a_name  : (t1.players || []).join(' & '),
            team_b_name  : (t2.players || []).join(' & '),
            team_a_score : t1.score || 0,
            team_b_score : t2.score || 0,
            target_score : g.limit || 100,
            current_round: (g.hands || []).length,
            game_status  : g.status || 'active',
            hands        : g.hands || [],
        };
    }

    /**
     * Llama un callback de forma segura — nunca lanza excepción.
     */
    function _safeCallback(fn, arg1, arg2) {
        try {
            fn(arg1, arg2);
        } catch (e) {
            console.warn('[spectator] Error en callback de espectador:', e.message);
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  MANTENER COMPATIBILIDAD con llamadas legacy de app.js
    //  (para que referencias residuales no rompan nada)
    // ════════════════════════════════════════════════════════════════

    /** Legacy adapter for older native hosts: publishes state to spectator_rooms */
    async function fb_saveGame(gameData) {
        if (!gameData || !gameData.code) return;
        
        var t1 = gameData.teams && gameData.teams[0];
        var t2 = gameData.teams && gameData.teams[1];
        
        var minimal = {
            room_code    : gameData.code,
            team_a_name  : t1 ? (t1.players || []).join(' & ') : '',
            team_b_name  : t2 ? (t2.players || []).join(' & ') : '',
            team_a_score : (t1 ? t1.score : 0) || 0,
            team_b_score : (t2 ? t2.score : 0) || 0,
            target_score : gameData.limit || 100,
            current_round: (gameData.hands || []).length,
            game_status  : gameData.status || 'active',
            hands        : gameData.hands || [],
        };
        
        _currentRoomCode = gameData.code.toUpperCase();
        await spectatorPublishState(minimal);
    }

    /** @deprecated — ya no hace nada. Historial se guarda localmente. */
    function fb_saveHistory() { /* no-op intencional */ }

    /** @deprecated — ya no hace nada. Perfil se guarda localmente. */
    function fb_saveProfile() { /* no-op intencional */ }

    /** @deprecated — retorna null siempre. Perfil se lee localmente. */
    async function fb_getProfile() { return null; }

    /** Legacy adapter for older native spectators: subscribes to spectator_rooms */
    function fb_setRoomCode(code) {
        if (!code) return;
        
        spectatorSubscribeRoom(code, function(minimalState) {
            if (typeof window.fb_onGameChangeCallback === 'function') {
                if (!minimalState) {
                    window.fb_onGameChangeCallback(null);
                    return;
                }
                
                var legacyGameData = {
                    id           : minimalState.room_code,
                    code         : minimalState.room_code,
                    limit        : minimalState.target_score || 100,
                    status       : minimalState.game_status  || 'active',
                    teams        : [
                        { id: 1, players: (minimalState.team_a_name || 'Equipo 1').split(' & '), score: minimalState.team_a_score || 0 },
                        { id: 2, players: (minimalState.team_b_name || 'Equipo 2').split(' & '), score: minimalState.team_b_score || 0 },
                    ],
                    hands        : minimalState.hands || [],
                    capiValue    : 25,
                    startTime    : minimalState.updated_at || new Date().toISOString(),
                    winner       : minimalState.game_status === 'finished' ? 1 : null,
                    isLisa       : false,
                    savedToHistory: false
                };
                window.fb_onGameChangeCallback(legacyGameData);
            }
        });
    }

    /** Legacy adapter for older native spectators: sets callback */
    function fb_onGameChange(callback) {
        window.fb_onGameChangeCallback = callback;
    }

    // ════════════════════════════════════════════════════════════════
    //  EXPORTACIÓN GLOBAL
    // ════════════════════════════════════════════════════════════════
    window.spectatorIsAvailable    = spectatorIsAvailable;
    window.spectatorCreateRoom     = spectatorCreateRoom;
    window.spectatorPublishState   = spectatorPublishState;
    window.spectatorSubscribeRoom  = spectatorSubscribeRoom;
    window.spectatorCloseRoom      = spectatorCloseRoom;

    // Compatibilidad legacy (no-ops seguros)
    window.fb_saveGame    = fb_saveGame;
    window.fb_saveHistory = fb_saveHistory;
    window.fb_saveProfile = fb_saveProfile;
    window.fb_getProfile  = fb_getProfile;
    window.fb_setRoomCode = fb_setRoomCode;
    window.fb_onGameChange = fb_onGameChange;

    console.log('[spectator] Módulo de espectador inicializado ✓ (Supabase disponible: ' + (window.supabase ? 'sí' : 'no') + ')');
})();
