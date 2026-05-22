/* ══════════════════════════════════════════════
   DominóScore — app.js
   Lógica completa del marcador de dominó
   ══════════════════════════════════════════════ */

// ─── Estado global ────────────────────────────────────────────────
let state = {
    game: null,        // partida activa
    history: [],       // historial de partidas terminadas
    soundEnabled: true,
    historyFilter: 'all',
    historySearch: '',
    profile: { username: '', avatar: '👤' } // Perfil de usuario
};

// ─── Keys de localStorage ─────────────────────────────────────────
const LS_GAME = 'domino_active_game';
const LS_HISTORY = 'domino_history';
const LS_SOUND = 'domino_sound';
const LS_PROFILE = 'domino_profile';

// ─── AudioContext (Web Audio API) ────────────────────────────────
let audioCtx = null;
function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
}

async function vibrate(type = 'Light') {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) {
        try {
            await window.Capacitor.Plugins.Haptics.impact({ style: type });
        } catch (e) {}
    } else if (navigator.vibrate) {
        navigator.vibrate(type === 'Light' ? 50 : 100);
    }
}

function playTone(freq = 440, type = 'sine', duration = 0.15, vol = 0.15) {
    if (!state.soundEnabled) return;
    try {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(vol, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
    } catch (e) { }
}

function soundScore() {
    vibrate('Light');
    playTone(660, 'sine', 0.12, 0.12);
    setTimeout(() => playTone(880, 'sine', 0.1, 0.08), 80);
}
function soundCapicua() {
    vibrate('Medium');
    [440, 550, 660, 880].forEach((f, i) => setTimeout(() => playTone(f, 'triangle', 0.15, 0.15), i * 80));
}
function soundWin() {
    vibrate('Heavy');
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 'sine', 0.3, 0.18), i * 120));
}
function soundLisa() {
    vibrate('Heavy');
    [220, 330, 440, 660, 880, 1100].forEach((f, i) => setTimeout(() => playTone(f, 'sawtooth', 0.18, 0.12), i * 70));
}
function soundError() {
    vibrate('Light');
    playTone(180, 'square', 0.2, 0.1);
}

// ─── Utilidades ───────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function now() { return new Date().toISOString(); }
function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function uid() {
    return Math.random().toString(36).substr(2, 9);
}
function showScreen(id) {
    ['screen-login', 'screen-setup', 'screen-game', 'screen-history'].forEach(s => {
        const el = $(s);
        if (!el) return;
        el.classList.add('hidden');
        el.classList.remove('active');
    });
    const target = $(id);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('active');
    }
}

// ─── Persistencia ─────────────────────────────────────────────────
// ARQUITECTURA LOCAL-FIRST:
// 1. Siempre guarda/carga localmente primero (local.js — nunca falla).
// 2. Si el modo espectador está activo, publica en Supabase como fire-and-forget.
//    Nunca bloquea, nunca muestra errores técnicos al usuario.

function saveGame() {
    if (state.game) {
        // Paso 1: guardar localmente (siempre, nunca falla)
        localSaveGame(state.game);
        // Paso 2: publicar para espectadores si hay sala activa (fire-and-forget)
        if (!state.isSpectator && typeof spectatorPublishState === 'function') {
            const minimal = _gameToSpectatorMinimal(state.game);
            if (minimal) spectatorPublishState(minimal); // async, ignoramos el resultado
        }
    } else {
        localClearGame();
        if (typeof spectatorCloseRoom === 'function') spectatorCloseRoom();
    }
}

function saveHistory() {
    // Solo local — historial nunca necesita red
    localSaveHistory(state.history);
}

function loadStorage() {
    // Cargar partida activa
    state.game = localLoadGame(); // retorna null si no hay
    // Cargar historial
    state.history = localLoadHistory(); // retorna [] si no hay
    // Cargar configuración (sonido + perfil)
    const settings = localLoadSettings();
    state.soundEnabled = settings.soundEnabled;
    state.profile = settings.profile;
}

/** Construye el objeto mínimo de la partida para el modo espectador. */
function _gameToSpectatorMinimal(g) {
    if (!g || !g.teams || g.teams.length < 2) return null;
    return {
        team_a_name  : (g.teams[0].players || []).join(' & '),
        team_b_name  : (g.teams[1].players || []).join(' & '),
        team_a_score : g.teams[0].score || 0,
        team_b_score : g.teams[1].score || 0,
        target_score : g.limit || 100,
        current_round: (g.hands || []).length,
        game_status  : g.status || 'active',
    };
}

function generateShortCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// ─── Crear partida ────────────────────────────────────────────────
function buildGame(cfg) {
    const gameCode = generateShortCode();
    // El código se genera localmente siempre.
    // Si el espectador se activa después, se publicará el estado en ese momento.
    state.isSpectator = false; // El creador nunca es espectador
    
    return {
        id: uid(),
        code: gameCode,
        name: cfg.name,
        startTime: now(),
        endTime: null,
        limit: cfg.limit,
        capiValue: cfg.capiValue,
        teams: [
            { id: 1, players: [cfg.t1p1, cfg.t1p2], score: 0 },
            { id: 2, players: [cfg.t2p1, cfg.t2p2], score: 0 },
        ],
        hands: [],
        status: 'active',   // active | finished
        winner: null,       // 1 | 2
        isLisa: false,
        savedToHistory: false,
    };
}

// ─── Recalcular scores desde historial ───────────────────────────
function recalcScores() {
    if (!state.game) return;
    state.game.teams[0].score = 0;
    state.game.teams[1].score = 0;
    state.game.hands.forEach(h => {
        const ti = h.team - 1;
        state.game.teams[ti].score += h.points;
    });
    checkWinner();
}

function checkWinner() {
    if (!state.game) return false;
    const g = state.game;
    const s1 = g.teams[0].score;
    const s2 = g.teams[1].score;

    if (s1 >= g.limit || s2 >= g.limit) {
        const winTeam = s1 >= g.limit ? 1 : 2;
        const loseTeam = winTeam === 1 ? 2 : 1;
        const loserScore = g.teams[loseTeam - 1].score;

        g.status = 'finished';
        g.winner = winTeam;
        g.isLisa = loserScore === 0;
        if (!g.endTime) g.endTime = now();
        return true;
    } else {
        // Si estaba terminada pero ya no aplica, reabrir
        g.status = 'active';
        g.winner = null;
        g.isLisa = false;
        g.endTime = null;
        return false;
    }
}

// ─── Guardar en historial ─────────────────────────────────────────
function saveToHistory() {
    if (!state.game || state.game.savedToHistory) return;
    const g = state.game;
    const winner = g.teams[g.winner - 1];
    const loser = g.teams[g.winner === 1 ? 1 : 0];
    const entry = {
        id: g.id,
        name: g.name,
        startTime: g.startTime,
        endTime: g.endTime || now(),
        limit: g.limit,
        capiValue: g.capiValue,
        winnerTeam: { id: g.winner, players: winner.players, score: winner.score },
        loserTeam: { id: g.winner === 1 ? 2 : 1, players: loser.players, score: loser.score },
        hands: g.hands.length,
        capicuas: g.hands.filter(h => h.capi).length,
        isLisa: g.isLisa,
    };
    state.history.unshift(entry);
    saveHistory();
    state.game.savedToHistory = true;
    saveGame();
}

// ─── UI: Setup ────────────────────────────────────────────────────
function initSetupScreen() {
    // Chips límite
    $('limit-chips').querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            $('limit-chips').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const val = chip.dataset.val;
            if (val === 'custom') {
                $('limit-custom').classList.remove('hidden');
                $('limit-custom').focus();
            } else {
                $('limit-custom').classList.add('hidden');
            }
        });
    });

    // Chips capicúa
    $('capi-chips').querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            $('capi-chips').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const val = chip.dataset.val;
            if (val === 'custom') {
                $('capi-custom').classList.remove('hidden');
                $('capi-custom').focus();
            } else {
                $('capi-custom').classList.add('hidden');
            }
        });
    });

    $('btn-start').addEventListener('click', startGame);
    $('btn-view-history').addEventListener('click', () => {
        renderHistory();
        showScreen('screen-history');
    });
    $('btn-import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', handleImport);

    const btnLogout = $('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            confirmAction('¿Cerrar Sesión?', 'Volverás a la pantalla de inicio y saldrás de tu cuenta. Se borrará la partida actual no guardada.', async () => {
                localStorage.removeItem(LS_GAME);
                try {
                    if (typeof doLogout === 'function') await doLogout();
                } catch (e) {
                    console.warn("Supabase logout falló, forzando cierre local:", e);
                }
                window.location.reload(); // Recargar siempre
            });
        });
    }

    // Sound toggle setup
    $('btn-sound-toggle').addEventListener('click', toggleSound);
    updateSoundIcons();
}

function getSetupValues() {
    const name = $('game-name').value.trim() || 'Partida';
    const t1p1 = $('t1p1').value.trim();
    const t1p2 = $('t1p2').value.trim();
    const t2p1 = $('t2p1').value.trim();
    const t2p2 = $('t2p2').value.trim();

    const activeLimit = $('limit-chips').querySelector('.chip.active');
    let limit = 100;
    if (activeLimit) {
        const v = activeLimit.dataset.val;
        if (v === 'custom') {
            limit = parseInt($('limit-custom').value) || 0;
        } else {
            limit = parseInt(v);
        }
    }

    const activeCapi = $('capi-chips').querySelector('.chip.active');
    let capiValue = 25;
    if (activeCapi) {
        const v = activeCapi.dataset.val;
        if (v === 'custom') {
            capiValue = parseInt($('capi-custom').value) || 0;
        } else {
            capiValue = parseInt(v);
        }
    }

    return { name, t1p1, t1p2, t2p1, t2p2, limit, capiValue };
}

function showSetupError(msg) {
    const el = $('setup-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    soundError();
    setTimeout(() => el.classList.add('hidden'), 4000);
}

function startGame() {
    const v = getSetupValues();
    if (!v.t1p1) return showSetupError('Ingresa el nombre del Jugador 1 del Equipo 1.');
    if (!v.t1p2) return showSetupError('Ingresa el nombre del Jugador 2 del Equipo 1.');
    if (!v.t2p1) return showSetupError('Ingresa el nombre del Jugador 1 del Equipo 2.');
    if (!v.t2p2) return showSetupError('Ingresa el nombre del Jugador 2 del Equipo 2.');
    if (v.limit < 1) return showSetupError('El límite debe ser mayor a 0.');
    if (v.capiValue < 1) return showSetupError('El valor de capicúa debe ser mayor a 0.');

    // Crear partida 100% local
    state.game = buildGame(v);
    saveGame(); // Guarda localmente primero; también publica a espectadores si hay sala

    try {
        if (typeof renderGameScreen === 'function') renderGameScreen();
        if ($('lbl-game-code')) $('lbl-game-code').textContent = state.game.code || '----';
        showScreen('screen-game');
    } catch (e) {
        console.error('[app] Error al renderizar pantalla de juego:', e);
        // No mostrar alert al usuario — la app continua
    }
    playTone(440, 'sine', 0.2, 0.15);
}

// ─── UI: Game Screen ──────────────────────────────────────────────
let selectedTeam = null;

function renderGameScreen() {
    if (!state.game) return;
    const g = state.game;
    if (!g.hands) g.hands = []; // Firebase RTDB no guarda arrays vacíos

    // Topbar
    $('game-title-bar').textContent = g.name;
    updateStatusBadge();
    updateDatetime();

    // Scoreboard
    const t1 = g.teams[0], t2 = g.teams[1];
    $('sb-t1p1').textContent = t1.players[0];
    $('sb-t1p2').textContent = t1.players[1];
    $('sb-t2p1').textContent = t2.players[0];
    $('sb-t2p2').textContent = t2.players[1];
    $('sel-t1-label').textContent = `${t1.players[0]} & ${t1.players[1]}`;
    $('sel-t2-label').textContent = `${t2.players[0]} & ${t2.players[1]}`;

    // Apply class for styling selectors
    $('sel-t1').classList.add('sel-t1');
    $('sel-t2').classList.add('sel-t2');

    updateScoreboard();
    renderHands();

    // Lock or hide based on status and spectator mode
    const panel = $('input-panel');
    if (panel) {
        if (state.isSpectator) {
            panel.style.display = 'none';
        } else {
            panel.style.display = ''; // Revertir a CSS (flex)
            if (g.status === 'finished') {
                panel.classList.add('locked');
            } else {
                panel.classList.remove('locked');
            }
        }
    }

    // Show winner modal if finished and not yet dismissed
    if (g.status === 'finished' && !g._modalShown) {
        showWinnerModal();
        g._modalShown = true;
        saveGame();
    }
}

function updateStatusBadge() {
    const badge = $('game-status-badge');
    if (!state.game) return;
    if (state.game.status === 'finished') {
        badge.textContent = 'Terminada';
        badge.className = 'status-badge finished';
    } else {
        badge.textContent = 'Activa';
        badge.className = 'status-badge active';
    }
}

function updateDatetime() {
    if (!state.game) return;
    const d = new Date(state.game.startTime);
    $('game-datetime').textContent = d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' }) + ' ' +
        d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
}

function updateScoreboard() {
    if (!state.game) return;
    const g = state.game;
    const s1 = g.teams[0].score, s2 = g.teams[1].score;

    $('score-t1').textContent = s1;
    $('score-t2').textContent = s2;

    const pct1 = Math.min(100, Math.round(s1 / g.limit * 100));
    const pct2 = Math.min(100, Math.round(s2 / g.limit * 100));
    $('progress-t1').style.width = pct1 + '%';
    $('progress-t2').style.width = pct2 + '%';
    $('progress-t1-pct').textContent = pct1 + '%';
    $('progress-t2-pct').textContent = pct2 + '%';

    // Leading badge
    const lb = $('leading-badge');
    if (s1 > s2) {
        lb.textContent = `${g.teams[0].players[0].split(' ')[0]} lidera`;
        lb.classList.remove('hidden');
        $('score-card-1').classList.add('leading');
        $('score-card-2').classList.remove('leading');
    } else if (s2 > s1) {
        lb.textContent = `${g.teams[1].players[0].split(' ')[0]} lidera`;
        lb.classList.remove('hidden');
        $('score-card-2').classList.add('leading');
        $('score-card-1').classList.remove('leading');
    } else {
        lb.classList.add('hidden');
        $('score-card-1').classList.remove('leading');
        $('score-card-2').classList.remove('leading');
    }
}

function bumpScore(teamId) {
    const el = $(`score-t${teamId}`);
    el.classList.remove('bump');
    void el.offsetWidth; // reflow
    el.classList.add('bump');
    setTimeout(() => el.classList.remove('bump'), 300);
}

function renderHands() {
    const container = $('hands-list');
    const g = state.game;
    if (!g || g.hands.length === 0) {
        container.innerHTML = '<p class="empty-state">Aún no hay manos registradas.</p>';
        return;
    }
    let html = '';
    // Show newest first
    [...g.hands].reverse().forEach((h, ri) => {
        const idx = g.hands.length - ri;
        const teamObj = g.teams[h.team - 1];
        const teamName = `${teamObj.players[0]} & ${teamObj.players[1]}`;
        const colorClass = h.team === 1 ? 'team1' : 'team2';
        const capiTag = h.capi ? '<span class="capi-tag">CAPI</span>' : '';
        const time = new Date(h.time);
        const timeStr = time.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
        const actionsHtml = state.isSpectator ? '' : `
      <div class="hand-actions">
        <button class="btn-hand edit" onclick="openEditModal('${h.id}')">Editar</button>
        <button class="btn-hand delete" onclick="confirmDeleteHand('${h.id}')">✕</button>
      </div>`;

        html += `
    <div class="hand-row ${colorClass}" data-id="${h.id}">
      <div class="hand-num">#${idx}</div>
      <div class="hand-info">
        <span class="hand-team-label">${teamName} ${capiTag}</span>
        <span class="hand-meta">${timeStr} · Acum: ${getAccumAt(g.hands.length - 1 - ri)}</span>
      </div>
      <div class="hand-pts">+${h.points}</div>
      ${actionsHtml}
    </div>`;
    });
    container.innerHTML = html;
}

// Acumulado hasta índice i (del array original)
function getAccumAt(i) {
    if (!state.game) return 0;
    const g = state.game;
    const scores = [0, 0];
    for (let j = 0; j <= i; j++) {
        scores[g.hands[j].team - 1] += g.hands[j].points;
    }
    return `E1:${scores[0]} E2:${scores[1]}`;
}

// ─── Selección de equipo ──────────────────────────────────────────
function initGameControls() {
    // Team selector
    document.querySelectorAll('.team-sel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const team = parseInt(btn.dataset.team);
            if (btn.closest('#modal-edit')) return; // handled separately
            selectedTeam = team;
            $('sel-t1').classList.toggle('selected', team === 1);
            $('sel-t2').classList.toggle('selected', team === 2);
        });
    });

    // Quick buttons (solo numéricos)
    document.querySelectorAll('.qbtn').forEach(btn => {
        btn.addEventListener('click', () => {
            const pts = parseInt(btn.dataset.pts);
            registerPoints(pts, false);
        });
    });

    $('btn-register-pts').addEventListener('click', () => {
        const pts = parseInt($('manual-pts').value);
        const capi = $('chk-capi').checked;
        if (isNaN(pts) || $('manual-pts').value === '') return showGameError('Ingresa una cantidad de puntos.');
        registerPoints(pts, capi);
        $('manual-pts').value = '';
        $('chk-capi').checked = false;
    });

    $('btn-undo').addEventListener('click', undoLastHand);
    $('btn-reset').addEventListener('click', () => confirmAction(
        '¿Reiniciar partida?',
        'Se borrarán todos los puntos y manos de esta partida. Los jugadores se mantienen.',
        resetGame
    ));
    $('btn-open-history').addEventListener('click', () => {
        renderHistory();
        showScreen('screen-history');
    });
    $('btn-back-to-setup').addEventListener('click', () => {
        if (state.game && state.game.status === 'active') {
            confirmAction(
                '¿Ir al inicio?',
                'La partida activa se guardará y podrás continuar después.',
                () => showScreen('screen-setup')
            );
        } else {
            showScreen('screen-setup');
        }
    });
    $('btn-sound-game').addEventListener('click', toggleSound);
    $('btn-new-game').addEventListener('click', newGame);

    const btnShare = $('btn-share-whatsapp');
    if (btnShare) {
        btnShare.addEventListener('click', () => {
            if (!state.game || !state.game.code) return;
            let shareUrl = window.location.href;
            if (shareUrl.includes('capacitor://') || shareUrl.includes('localhost') || shareUrl.includes('127.0.0.1')) {
                shareUrl = 'https://yandellcuevas-sketch.github.io/PuntosDominoApp/';
            }
            const baseShareUrl = shareUrl.split('?')[0];
            const finalShareUrl = `${baseShareUrl}?code=${state.game.code}`;
            const text = `¡Únete a mi partida de dominó! Código de sala: ${state.game.code}. Entra aquí: ${finalShareUrl}`;
            const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
            window.open(url, '_blank');
        });
    }
}

function showGameError(msg) {
    const el = $('game-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    soundError();
    setTimeout(() => el.classList.add('hidden'), 3500);
}

function registerPoints(pts, isCapi) {
    if (!state.game || state.game.status === 'finished') return;
    if (selectedTeam === null) return showGameError('Selecciona primero el equipo ganador de la mano.');

    const g = state.game;
    const capiValue = g.capiValue;
    let finalPts = 0;

    if (isNaN(pts) || pts === null) return showGameError('Puntos inválidos.');
    if (pts < 0) return showGameError('No se aceptan puntos negativos.');
    finalPts = pts + (isCapi ? capiValue : 0);

    const hand = {
        id: uid(),
        team: selectedTeam,
        points: finalPts,
        capi: isCapi,
        time: now(),
    };

    g.hands.push(hand);
    g.teams[selectedTeam - 1].score += finalPts;

    // Guardar equipo antes de limpiar selección
    const scoredTeam = selectedTeam;

    // Deseleccionar equipo para evitar anotaciones accidentales
    selectedTeam = null;
    $('sel-t1').classList.remove('selected');
    $('sel-t2').classList.remove('selected');

    // Check winner
    const won = checkWinner();
    saveGame();
    updateScoreboard();
    bumpScore(scoredTeam);
    renderHands();
    updateStatusBadge();

    if (isCapi) soundCapicua(); else soundScore();

    if (won) {
        saveToHistory();
        $('input-panel').classList.add('locked');
        if (g.isLisa) showLisaToast();
        setTimeout(() => {
            showWinnerModal();
            soundWin();
        }, g.isLisa ? 600 : 0);
        g._modalShown = true;
        saveGame();
    }
}

// ─── Undo ─────────────────────────────────────────────────────────
function undoLastHand() {
    if (!state.game) return;
    const g = state.game;
    if (g.hands.length === 0) return showGameError('No hay manos para deshacer.');
    const last = g.hands.pop();
    g.teams[last.team - 1].score -= last.points;
    if (g.teams[last.team - 1].score < 0) g.teams[last.team - 1].score = 0;

    // Re-check if game can be reopened
    const s1 = g.teams[0].score, s2 = g.teams[1].score;
    if (s1 < g.limit && s2 < g.limit) {
        g.status = 'active';
        g.winner = null;
        g.isLisa = false;
        g.endTime = null;
        g._modalShown = false;
        g.savedToHistory = false;
        $('input-panel').classList.remove('locked');
        updateStatusBadge();
    }
    saveGame();
    updateScoreboard();
    renderHands();
    playTone(300, 'sine', 0.2, 0.1);
}

// ─── Delete Hand ──────────────────────────────────────────────────
function confirmDeleteHand(handId) {
    confirmAction(
        '¿Eliminar esta mano?',
        'Los puntos se restarán y el marcador se recalculará.',
        () => deleteHand(handId)
    );
}
function deleteHand(handId) {
    if (!state.game) return;
    state.game.hands = state.game.hands.filter(h => h.id !== handId);
    recalcScores();
    // Reopen if needed
    const g = state.game;
    const s1 = g.teams[0].score, s2 = g.teams[1].score;
    if (s1 < g.limit && s2 < g.limit) {
        g.status = 'active';
        g.winner = null;
        g.isLisa = false;
        g.endTime = null;
        g._modalShown = false;
        g.savedToHistory = false;
        $('input-panel').classList.remove('locked');
    }
    updateStatusBadge();
    saveGame();
    updateScoreboard();
    renderHands();
    playTone(250, 'sine', 0.2, 0.1);
}

// ─── Edit Hand ────────────────────────────────────────────────────
let editSelectedTeam = null;

function openEditModal(handId) {
    if (!state.game) return;
    const hand = state.game.hands.find(h => h.id === handId);
    if (!hand) return;

    $('edit-hand-id').value = handId;
    
    // Mostramos los puntos base (restando el valor de capicúa si la tenía)
    const basePts = hand.points - (hand.capi ? (state.game.capiValue || 0) : 0);
    $('edit-pts').value = basePts;
    $('edit-capi').checked = hand.capi;

    editSelectedTeam = hand.team;
    $('edit-sel-t1').classList.toggle('selected', hand.team === 1);
    $('edit-sel-t2').classList.toggle('selected', hand.team === 2);
    $('edit-sel-t1').classList.add('sel-t1');
    $('edit-sel-t2').classList.add('sel-t2');

    const t1 = state.game.teams[0], t2 = state.game.teams[1];
    $('edit-sel-t1').textContent = `${t1.players[0]} & ${t1.players[1]}`;
    $('edit-sel-t2').textContent = `${t2.players[0]} & ${t2.players[1]}`;

    $('edit-error').classList.add('hidden');
    $('modal-edit').classList.remove('hidden');
}

function closeEditModal() {
    $('modal-edit').classList.add('hidden');
    editSelectedTeam = null;
}

function saveEditHand() {
    const handId = $('edit-hand-id').value;
    const pts = parseInt($('edit-pts').value);
    const capi = $('edit-capi').checked;

    if (!editSelectedTeam) {
        $('edit-error').textContent = 'Selecciona el equipo ganador.';
        $('edit-error').classList.remove('hidden');
        return;
    }
    if (isNaN(pts) || pts < 0) {
        $('edit-error').textContent = 'Puntos inválidos (deben ser ≥ 0).';
        $('edit-error').classList.remove('hidden');
        return;
    }

    const hand = state.game.hands.find(h => h.id === handId);
    if (!hand) return;

    // Calculamos el puntaje total sumando el valor de capicúa si está activo
    const finalPts = pts + (capi ? (state.game.capiValue || 0) : 0);

    hand.team = editSelectedTeam;
    hand.points = finalPts;
    hand.capi = capi;

    // Recalc everything from scratch
    recalcScores();

    const g = state.game;
    const s1 = g.teams[0].score, s2 = g.teams[1].score;
    if (s1 < g.limit && s2 < g.limit) {
        g.status = 'active';
        g.winner = null;
        g.isLisa = false;
        g.endTime = null;
        g._modalShown = false;
        g.savedToHistory = false;
        $('input-panel').classList.remove('locked');
    } else {
        g._modalShown = true;
    }

    updateStatusBadge();
    saveGame();
    updateScoreboard();
    renderHands();
    closeEditModal();
    playTone(500, 'sine', 0.15, 0.12);
}

// ─── Reset game ───────────────────────────────────────────────────
function resetGame() {
    if (!state.game) return;
    const g = state.game;
    g.hands = [];
    g.teams[0].score = 0;
    g.teams[1].score = 0;
    g.status = 'active';
    g.winner = null;
    g.isLisa = false;
    g.endTime = null;
    g._modalShown = false;
    g.savedToHistory = false;
    g.startTime = now();
    saveGame();
    $('input-panel').classList.remove('locked');
    updateStatusBadge();
    updateScoreboard();
    renderHands();
    updateDatetime();
}

// ─── New Game ─────────────────────────────────────────────────────
function newGame() {
    closeWinnerModal();
    // Pre-fill setup with same players
    if (state.game) {
        const g = state.game;
        $('game-name').value = g.name;
        $('t1p1').value = g.teams[0].players[0];
        $('t1p2').value = g.teams[0].players[1];
        $('t2p1').value = g.teams[1].players[0];
        $('t2p2').value = g.teams[1].players[1];
    }
    state.game = null;
    saveGame();
    selectedTeam = null;
    showScreen('screen-setup');
}

// ─── Winner Modal ─────────────────────────────────────────────────
function showWinnerModal() {
    if (!state.game) return;
    const g = state.game;
    const winner = g.teams[g.winner - 1];
    const loser = g.teams[g.winner === 1 ? 1 : 0];

    $('modal-winner-team').textContent =
        `Ganó el equipo de ${winner.players[0]} y ${winner.players[1]}`;

    if (g.isLisa) {
        $('modal-lisa-msg').classList.remove('hidden');
    } else {
        $('modal-lisa-msg').classList.add('hidden');
    }

    const t1 = g.teams[0], t2 = g.teams[1];
    $('fs-t1-label').textContent = `${t1.players[0]}`;
    $('fs-t1-val').textContent = t1.score;
    $('fs-t2-label').textContent = `${t2.players[0]}`;
    $('fs-t2-val').textContent = t2.score;
    $('modal-end-time').textContent = fmtDate(g.endTime);

    $('modal-winner').classList.remove('hidden');
    launchConfetti();
}
function closeWinnerModal() {
    $('modal-winner').classList.add('hidden');
    $('confetti-container').innerHTML = '';
}

// ─── Confetti ─────────────────────────────────────────────────────
function launchConfetti() {
    const container = $('confetti-container');
    container.innerHTML = '';
    const colors = ['#2af0ff', '#0099ff', '#f0b429', '#ffffff', '#00ccff'];
    for (let i = 0; i < 50; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + '%';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDuration = (0.8 + Math.random() * 1.5) + 's';
        piece.style.animationDelay = (Math.random() * 1.2) + 's';
        piece.style.width = piece.style.height = (5 + Math.random() * 8) + 'px';
        container.appendChild(piece);
    }
}

// ─── Lisa Toast ───────────────────────────────────────────────────
function showLisaToast() {
    const toast = $('lisa-toast');
    toast.classList.remove('hidden');
    toast.classList.add('show');
    soundLisa();
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => {
            toast.classList.add('hidden');
            toast.classList.remove('hide');
        }, 500);
    }, 5000);
}

// ─── Confirm modal ────────────────────────────────────────────────
let confirmCallback = null;
function confirmAction(title, msg, cb) {
    $('confirm-title').textContent = title;
    $('confirm-msg').textContent = msg;
    confirmCallback = cb;
    $('modal-confirm').classList.remove('hidden');
}
function closeConfirm() {
    $('modal-confirm').classList.add('hidden');
    confirmCallback = null;
}

// ─── Sound toggle ─────────────────────────────────────────────────
function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem(LS_SOUND, state.soundEnabled);
    updateSoundIcons();
}
function updateSoundIcons() {
    const on = state.soundEnabled;
    $('icon-sound-on').classList.toggle('hidden', !on);
    $('icon-sound-off').classList.toggle('hidden', on);
    if ($('icon-sound-on-g')) $('icon-sound-on-g').classList.toggle('hidden', !on);
    if ($('icon-sound-off-g')) $('icon-sound-off-g').classList.toggle('hidden', on);
}

// ─── History Screen ───────────────────────────────────────────────
function renderHistory() {
    renderStats();
    applyHistoryFilters();
}

function renderStats() {
    const h = state.history;
    $('stat-total').textContent = h.length;
    $('stat-capis').textContent = h.reduce((a, p) => a + p.capicuas, 0);
    $('stat-lisas').textContent = h.filter(p => p.isLisa).length;

    // MVP: player with most wins
    const wins = {};
    h.forEach(p => {
        p.winnerTeam.players.forEach(pl => {
            wins[pl] = (wins[pl] || 0) + 1;
        });
    });
    let mvp = '—', mvpW = 0;
    Object.entries(wins).forEach(([pl, w]) => { if (w > mvpW) { mvp = pl.split(' ')[0]; mvpW = w; } });
    $('stat-mvp').textContent = mvp;
}

function applyHistoryFilters() {
    let items = [...state.history];
    const search = state.historySearch.toLowerCase().trim();
    const filter = state.historyFilter;

    if (search) {
        items = items.filter(p => {
            const all = [...p.winnerTeam.players, ...p.loserTeam.players].map(s => s.toLowerCase());
            return all.some(n => n.includes(search));
        });

        if (filter === 'won') {
            items = items.filter(p => p.winnerTeam.players.some(n => n.toLowerCase().includes(search)));
        } else if (filter === 'lost') {
            items = items.filter(p => p.loserTeam.players.some(n => n.toLowerCase().includes(search)));
        }
    }

    if (filter === 'newest') items.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    if (filter === 'oldest') items.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    renderHistoryList(items);
}

function renderHistoryList(items) {
    const container = $('history-list');
    if (items.length === 0) {
        container.innerHTML = '<p class="empty-state">Sin partidas para mostrar.</p>';
        return;
    }
    let html = '';
    items.forEach(p => {
        const lisaTag = p.isLisa ? '<span class="history-tag gold">🔥 Lisaaa</span>' : '';
        html += `
    <div class="history-card${p.isLisa ? ' lisa-card' : ''}">
      <div class="history-card-header">
        <div>
          <div class="history-name">${p.name}</div>
          <div class="history-meta">${fmtDate(p.startTime)}</div>
        </div>
        <div class="history-score">${p.winnerTeam.score} – ${p.loserTeam.score}</div>
      </div>
      <div class="history-teams">
        <div class="history-team winner">
          <div class="team-badge t1">🏆</div>
          <div>
            <div class="history-team-names">${p.winnerTeam.players.join(' & ')}</div>
          </div>
          <div class="history-team-pts">${p.winnerTeam.score}</div>
        </div>
        <div class="history-team loser">
          <div class="team-badge t2">—</div>
          <div>
            <div class="history-team-names">${p.loserTeam.players.join(' & ')}</div>
          </div>
          <div class="history-team-pts">${p.loserTeam.score}</div>
        </div>
      </div>
      <div class="history-footer">
        <span class="history-tag">Límite: ${p.limit}</span>
        <span class="history-tag">${p.hands} manos</span>
        <span class="history-tag">${p.capicuas} capicúas</span>
        ${lisaTag}
        <span class="history-tag">${fmtDate(p.endTime)}</span>
      </div>
    </div>`;
    });
    container.innerHTML = html;
}

// ─── History controls ─────────────────────────────────────────────
function initHistoryControls() {
    $('btn-back-from-history').addEventListener('click', () => {
        if (state.game) showScreen('screen-game');
        else showScreen('screen-setup');
    });

    $('history-search').addEventListener('input', e => {
        state.historySearch = e.target.value;
        applyHistoryFilters();
    });

    document.querySelectorAll('#screen-history .chip[data-filter]').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#screen-history .chip[data-filter]')
                .forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            state.historyFilter = chip.dataset.filter;
            applyHistoryFilters();
        });
    });

    $('btn-export').addEventListener('click', exportHistory);
    $('btn-clear-history').addEventListener('click', () => confirmAction(
        '¿Borrar todo el historial?',
        'Esta acción es irreversible. Se eliminarán todas las partidas guardadas.',
        clearHistory
    ));
}

function exportHistory() {
    const data = { history: state.history, exportedAt: now() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `domino-historial-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            const data = JSON.parse(ev.target.result);
            if (Array.isArray(data.history)) {
                state.history = [...data.history, ...state.history];
                // Dedup by id
                const seen = new Set();
                state.history = state.history.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
                saveHistory();
                alert(`Importadas ${data.history.length} partidas correctamente.`);
            } else {
                alert('Formato incorrecto.');
            }
        } catch {
            alert('Error al leer el archivo JSON.');
        }
    };
    reader.readAsText(file);
    e.target.value = '';
}

function clearHistory() {
    state.history = [];
    saveHistory();
    renderHistory();
}

// ─── Confirm modal handlers ───────────────────────────────────────
function initConfirmModal() {
    $('btn-confirm-yes').addEventListener('click', () => {
        if (confirmCallback) confirmCallback();
        closeConfirm();
    });
    $('btn-confirm-no').addEventListener('click', closeConfirm);
    $('modal-confirm').addEventListener('click', e => {
        if (e.target === $('modal-confirm')) closeConfirm();
    });
}

// ─── Edit modal handlers ──────────────────────────────────────────
function initEditModal() {
    $('btn-edit-cancel').addEventListener('click', closeEditModal);
    $('btn-edit-save').addEventListener('click', saveEditHand);
    $('modal-edit').addEventListener('click', e => {
        if (e.target === $('modal-edit')) closeEditModal();
    });
    $('edit-sel-t1').addEventListener('click', () => {
        editSelectedTeam = 1;
        $('edit-sel-t1').classList.add('selected');
        $('edit-sel-t2').classList.remove('selected');
    });
    $('edit-sel-t2').addEventListener('click', () => {
        editSelectedTeam = 2;
        $('edit-sel-t2').classList.add('selected');
        $('edit-sel-t1').classList.remove('selected');
    });
    $('modal-winner').addEventListener('click', e => {
        if (e.target === $('modal-winner')) closeWinnerModal();
    });
}

function initJoinControls() {
    const btnJoin = $('btn-join');
    if (!btnJoin) return;

    btnJoin.addEventListener('click', async () => {
        const codeInput = $('join-code');
        const code = codeInput.value.trim().toUpperCase();

        if (!code) {
            showJoinError('Introduce un código de sala.');
            return;
        }

        showJoinError('');
        showJoinStatus('Buscando la sala…');

        // Intentar suscripción al espectador (requiere Supabase + internet)
        let subscribed = false;
        try {
            if (typeof spectatorSubscribeRoom === 'function') {
                subscribed = await spectatorSubscribeRoom(code, (minimalState) => {
                    if (!minimalState) {
                        showJoinError('No se encontró la sala o no está disponible.');
                        showJoinStatus('');
                        state.isSpectator = false;
                        return;
                    }
                    // Construir objeto de partida de solo lectura para mostrar el marcador
                    state.isSpectator = true;
                    state.game = {
                        code         : code,
                        name         : code,
                        limit        : minimalState.target_score || 100,
                        status       : minimalState.game_status  || 'active',
                        teams        : [
                            { id: 1, players: (minimalState.team_a_name || 'Equipo 1').split(' & '), score: minimalState.team_a_score || 0 },
                            { id: 2, players: (minimalState.team_b_name || 'Equipo 2').split(' & '), score: minimalState.team_b_score || 0 },
                        ],
                        hands        : [],
                        capiValue    : 25,
                        startTime    : new Date().toISOString(),
                        winner       : null,
                        isLisa       : false,
                        savedToHistory: false,
                    };
                    if ($('lbl-game-code')) $('lbl-game-code').textContent = code;
                    if (typeof renderGameScreen === 'function') renderGameScreen();
                    showScreen('screen-game');
                    applySpectatorMode();
                    showJoinStatus('');
                });
            }
        } catch (e) {
            console.warn('[app] Error en modo espectador:', e.message);
            subscribed = false;
        }

        if (!subscribed) {
            showJoinStatus('');
            showJoinError('Modo espectador no disponible temporalmente. Verifica tu conexión.');
        }
    });
}

function showJoinError(msg) {
    const el = $('join-error');
    if (!el) return;
    if (msg) {
        el.textContent = msg;
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

/** Muestra un mensaje de estado amigable debajo del campo de código. */
function showJoinStatus(msg) {
    let el = $('join-status');
    if (!el) {
        el = document.createElement('div');
        el.id = 'join-status';
        el.className = 'join-status-msg';
        const joinCard = $('join-error');
        if (joinCard && joinCard.parentNode) {
            joinCard.parentNode.insertBefore(el, joinCard);
        }
    }
    if (msg) {
        el.textContent = msg;
        el.style.display = 'block';
    } else {
        el.style.display = 'none';
    }
}

function applySpectatorMode() {
    if (state.isSpectator) {
        const panel = document.querySelector('.input-panel');
        if (panel) {
            panel.style.display = 'none';
        }
        const btnBack = $('btn-back-to-setup');
        if (btnBack) btnBack.title = 'Salir de la sala';
    }
}

// ─── Splash Screen ───────────────────────────
function hideSplash(startTime) {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, 2000 - elapsed); // 2000ms = tiempo de la animación CSS splashBarLoad
    
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.classList.add('hide');
            // Remove DOM element after transition completes (0.6s)
            setTimeout(() => {
                if (splash.parentNode) splash.remove();
            }, 700);
        }
    }, remaining);
}

// ─── Init ─────────────────────────────────────────────────────────
function init() {
    const initStartTime = Date.now();

    // 1. Cargar todo desde localStorage — instantáneo, nunca falla
    loadStorage();

    // 2. Inicializar controles de UI (no dependen de red)
    initLoginScreen();
    initJoinControls();
    initSetupScreen();
    initGameControls();
    initHistoryControls();
    initConfirmModal();
    initEditModal();
    initProfileModal();
    updateSoundIcons();
    updateProfileUI();

    // 3. Mostrar pantalla correcta según estado local
    if (state.game) {
        if (typeof renderGameScreen === 'function') renderGameScreen();
        if ($('lbl-game-code')) $('lbl-game-code').textContent = state.game.code || '----';
        showScreen('screen-game');
        // Si la partida terminó y no había mostrado el modal, mostrarlo (sin música)
        if (state.game.status === 'finished' && !state.game._modalShown) {
            showWinnerModal();
            state.game._modalShown = true;
            saveGame();
        }
    } else {
        showScreen('screen-setup');
    }

    // 4. Auto-unirse si viene el código en la URL (?code=XXXX)
    //    Usa el modo espectador (Supabase opcional) con fallback visible
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('code');
    if (roomCode) {
        const cleanCode = roomCode.trim().toUpperCase();
        if (cleanCode && cleanCode.length === 4) {
            const joinCodeInput = $('join-code');
            if (joinCodeInput) {
                joinCodeInput.value = cleanCode;
                // Leve delay para que la UI esté lista
                setTimeout(() => {
                    const btnJoin = $('btn-join');
                    if (btnJoin) btnJoin.click();
                }, 500);
            }
        }
    }

    // 5. Ocultar el splash (mínimo 2 segundos después de iniciar)
    hideSplash(initStartTime);
}


function initLoginScreen() {
    // La app ya no usa login/register/guest a través de Supabase.
    // Toda la sesión es local. Esta función se mantiene como stub
    // para que no rompa nada si hay referencias residuales en otros lugares.
    window.onSessionRestored = null; // Eliminar el hook anterior de Supabase

    // Los botones btn-login, btn-register, btn-guest no existen en el HTML actual.
    // Si existieran por alguna versión futura, los dejamos como no-op seguros.
    const btnLogin    = $('btn-login');
    const btnRegister = $('btn-register');
    const btnGuest    = $('btn-guest');

    if (btnLogin)    btnLogin.addEventListener('click',    () => showScreen('screen-setup'));
    if (btnRegister) btnRegister.addEventListener('click', () => showScreen('screen-setup'));
    if (btnGuest)    btnGuest.addEventListener('click',    () => showScreen('screen-setup'));
}

document.addEventListener('DOMContentLoaded', init);

// --- Capacitor App Back Button ------------------------------------
if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener('backButton', () => {
        const currentScreen = document.querySelector('.screen.active');
        if (currentScreen && currentScreen.id === 'screen-game') {
            const btn = $('btn-back-to-setup');
            if (btn) btn.click();
        } else if (currentScreen && currentScreen.id === 'screen-history') {
            const btn = $('btn-back-from-history');
            if (btn) btn.click();
        } else {
            window.Capacitor.Plugins.App.exitApp();
        }
    });
}

// ─── Profile Modal Handlers ─────────────────────────────────────────
function initProfileModal() {
    const trigger = $('btn-profile-trigger');
    if (!trigger) return;
    
    trigger.addEventListener('click', () => {
        $('profile-username').value = state.profile.username || '';
        const currentAvatar = state.profile.avatar || '👤';
        
        // Highlight active avatar
        document.querySelectorAll('.avatar-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.emoji === currentAvatar);
        });
        
        $('modal-profile').classList.remove('hidden');
    });
    
    $('btn-profile-cancel').addEventListener('click', () => {
        $('modal-profile').classList.add('hidden');
    });
    
    // Avatar selection
    document.querySelectorAll('.avatar-option').forEach(opt => {
        opt.addEventListener('click', () => {
            document.querySelectorAll('.avatar-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
        });
    });
    
    $('btn-profile-save').addEventListener('click', () => {
        const username = $('profile-username').value.trim();
        const selectedOpt = document.querySelector('.avatar-option.selected');
        const avatar = selectedOpt ? selectedOpt.dataset.emoji : '👤';

        state.profile.username = username;
        state.profile.avatar = avatar;

        // Guardar localmente primero (siempre funciona)
        localSaveProfile(state.profile);
        updateProfileUI();

        $('modal-profile').classList.add('hidden');
        // No llamamos a fb_saveProfile() — el perfil es 100% local
    });
}

function updateProfileUI() {
    const el = $('profile-avatar-emoji');
    if (el) el.textContent = state.profile.avatar || '👤';
    
    // Si el usuario tiene nombre, auto-llenar Jugador 1 de Equipo 1
    if (state.profile.username) {
        const t1p1 = $('t1p1');
        if (t1p1 && !t1p1.value) {
            t1p1.value = state.profile.username;
        }
    }
}
