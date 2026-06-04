/* ═══════════════════════════════════════════════════════════════════
   share.js — Módulo de Compartir Resultado  v2
   ─────────────────────────────────────────────────────────────────
   Fase 2: Capacitor Share nativo + Capacitor Filesystem + Canvas rediseñado
   REGLAS DE ORO:
   • Módulo 100% aislado — no modifica state, no toca localStorage.
   • Solo usa datos del objeto `gameData` que recibe como parámetro.
   • Canvas API puro — sin html2canvas ni dependencias externas.
   • Cadena de compartir: Capacitor.Share → Web Share API → descarga web.
   • Cadena de guardar: Capacitor.Filesystem (Photos) → descarga web.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ── Configuración de Canvas ──────────────────────────────────────
    var CARD_W = 1080;
    var CARD_H = 1080;
    var LOGO_PATH = 'logodomino.png';

    // ── Paleta (alineada con style.css variables) ────────────────────
    var C = {
        bg1:         '#07080d',
        bg2:         '#0d1020',
        bg3:         '#141826',
        neon:        '#2af0ff',
        neon2:       '#0095ff',
        gold:        '#f0b429',
        red:         '#ff5a5a',
        white:       '#eef0f6',
        dim:         '#9ba3b4',
        muted:       '#5c6475',
        winBg1:      'rgba(30,240,255,0.11)',
        winBg2:      'rgba(0,148,255,0.04)',
        winBorder:   'rgba(42,240,255,0.50)',
        loseBg1:     'rgba(255,90,90,0.07)',
        loseBg2:     'rgba(255,90,90,0.01)',
        loseBorder:  'rgba(255,90,90,0.28)',
        statBg:      'rgba(255,255,255,0.04)',
        statBorder:  'rgba(255,255,255,0.09)',
    };

    // ── Fuentes (cargadas por index.html) ────────────────────────────
    var F = {
        display: "'Bebas Neue', Impact, sans-serif",
        body:    "'DM Sans', 'Segoe UI', sans-serif",
        mono:    "'JetBrains Mono', 'Courier New', monospace",
    };

    // ── Estado interno ───────────────────────────────────────────────
    var _modal          = null;
    var _previewImg     = null;
    var _btnShare       = null;
    var _btnSave        = null;
    var _btnClose       = null;
    var _shareStatus    = null;
    var _currentBlob    = null;
    var _currentDataURL = null;
    var _currentGameData = null;

    // ═════════════════════════════════════════════════════════════════
    //  INICIALIZACIÓN
    // ═════════════════════════════════════════════════════════════════

    function init() {
        _modal       = document.getElementById('modal-share');
        _previewImg  = document.getElementById('share-preview-img');
        _btnShare    = document.getElementById('share-btn-share');
        _btnSave     = document.getElementById('share-btn-save');
        _btnClose    = document.getElementById('share-btn-close');
        _shareStatus = document.getElementById('share-status-msg');

        if (_btnClose)  _btnClose.addEventListener('click', close);
        if (_btnShare)  _btnShare.addEventListener('click', _share);
        if (_btnSave)   _btnSave.addEventListener('click', _download);

        if (_modal) {
            _modal.addEventListener('click', function (e) {
                if (e.target === _modal) close();
            });
        }

        console.log('[share] DominoShare v2 listo ✓');
    }

    // ═════════════════════════════════════════════════════════════════
    //  API PÚBLICA
    // ═════════════════════════════════════════════════════════════════

    function open(gameData) {
        if (!_modal) return;
        _currentGameData = gameData;
        _currentBlob     = null;
        _currentDataURL  = null;

        _showLoading(true);
        _modal.classList.remove('hidden');

        document.fonts.ready.then(function () {
            _render(gameData).then(function (result) {
                _currentDataURL = result.dataURL;
                _currentBlob    = result.blob;
                if (_previewImg) {
                    _previewImg.classList.remove('share-img-visible');
                    _previewImg.src = result.dataURL;
                    _previewImg.onload = function () {
                        _showLoading(false);
                        // Trigger fade-in
                        requestAnimationFrame(function () {
                            _previewImg.classList.add('share-img-visible');
                        });
                    };
                } else {
                    _showLoading(false);
                }
            }).catch(function (err) {
                console.error('[share] Error al generar imagen:', err);
                _setStatus('No se pudo generar la imagen.', true);
                _showLoading(false);
            });
        });
    }

    function close() {
        if (_modal) _modal.classList.add('hidden');
        if (_previewImg) _previewImg.classList.remove('share-img-visible');
        _currentBlob     = null;
        _currentDataURL  = null;
        _currentGameData = null;
    }

    // ═════════════════════════════════════════════════════════════════
    //  RENDERIZADO CANVAS
    // ═════════════════════════════════════════════════════════════════

    function _render(gd) {
        return new Promise(function (resolve, reject) {
            var logo = new Image();
            logo.crossOrigin = 'anonymous';

            function draw(img) {
                try {
                    var canvas = document.createElement('canvas');
                    canvas.width  = CARD_W;
                    canvas.height = CARD_H;
                    var ctx = canvas.getContext('2d');
                    _drawCard(ctx, gd, img);
                    canvas.toBlob(function (blob) {
                        resolve({ dataURL: canvas.toDataURL('image/png'), blob: blob });
                    }, 'image/png');
                } catch (err) {
                    reject(err);
                }
            }

            logo.onload  = function () { draw(logo); };
            logo.onerror = function () { draw(null); };
            logo.src = LOGO_PATH;
        });
    }

    // ─────────────────────────────────────────────────────────────────
    //  CAPAS DEL CANVAS (orquestador)
    // ─────────────────────────────────────────────────────────────────

    function _drawCard(ctx, gd, logo) {
        var W = CARD_W, H = CARD_H;

        _drawBackground(ctx, W, H);
        _drawHeader(ctx, gd, logo, W);
        _drawDivider(ctx, W, 95);
        _drawHeroScore(ctx, gd, W);
        _drawStatsBadges(ctx, gd, W);
        _drawFooter(ctx, W, H);
    }

    // ─────────────────────────────────────────────────────────────────
    //  1. FONDO
    // ─────────────────────────────────────────────────────────────────

    function _drawBackground(ctx, W, H) {
        // Base oscura
        var bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0,   C.bg1);
        bg.addColorStop(0.6, C.bg2);
        bg.addColorStop(1,   C.bg3);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // Halo radial superior (neón)
        var haloTop = ctx.createRadialGradient(W * 0.5, 0, 0, W * 0.5, 0, W * 0.75);
        haloTop.addColorStop(0, 'rgba(42,240,255,0.08)');
        haloTop.addColorStop(1, 'transparent');
        ctx.fillStyle = haloTop;
        ctx.fillRect(0, 0, W, H);

        // Halo radial inferior izquierdo (acento)
        var haloBot = ctx.createRadialGradient(W * 0.2, H, 0, W * 0.2, H, W * 0.6);
        haloBot.addColorStop(0, 'rgba(0,148,255,0.05)');
        haloBot.addColorStop(1, 'transparent');
        ctx.fillStyle = haloBot;
        ctx.fillRect(0, 0, W, H);

        // Borde exterior con brillo neón
        _roundRect(ctx, 3, 3, W - 6, H - 6, 28);
        ctx.strokeStyle = 'rgba(42,240,255,0.30)';
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    // ─────────────────────────────────────────────────────────────────
    //  2. HEADER — logo izquierda, app name centrado, fecha derecha
    // ─────────────────────────────────────────────────────────────────

    function _drawHeader(ctx, gd, logo, W) {
        var H_ROW = 74;  // altura total del header
        var PAD   = 44;  // padding lateral
        var LOGO_D = 48; // diámetro logo
        var cy    = H_ROW / 2 + 2; // centro vertical

        // ── Logo (pequeño, circular) ──────────────────────────────────
        var lx = PAD + LOGO_D / 2;
        var ly = cy;

        ctx.save();
        // Glow detrás del logo
        var lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, LOGO_D);
        lg.addColorStop(0, 'rgba(42,240,255,0.18)');
        lg.addColorStop(1, 'transparent');
        ctx.fillStyle = lg;
        ctx.beginPath();
        ctx.arc(lx, ly, LOGO_D, 0, Math.PI * 2);
        ctx.fill();

        // Clip circular
        ctx.beginPath();
        ctx.arc(lx, ly, LOGO_D / 2, 0, Math.PI * 2);
        if (logo) {
            ctx.save();
            ctx.clip();
            ctx.drawImage(logo, lx - LOGO_D / 2, ly - LOGO_D / 2, LOGO_D, LOGO_D);
            ctx.restore();
        }

        // Anillo neón sobre el logo
        ctx.beginPath();
        ctx.arc(lx, ly, LOGO_D / 2 + 1, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(42,240,255,0.55)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // ── App name centrado ──────────────────────────────────────────
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = C.white;
        ctx.font = '700 26px ' + F.body;
        ctx.fillText('DOMINOSCORE PRO', W / 2, cy - 7);

        // Subtítulo "by Yandell Cuevas"
        ctx.fillStyle = C.muted;
        ctx.font = '400 15px ' + F.body;
        ctx.fillText('Resultado Oficial de Partida', W / 2, cy + 14);
        ctx.restore();

        // ── Fecha a la derecha ──────────────────────────────────────────
        var dateStr = _formatShortDate(gd.endTime);
        ctx.save();
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = C.dim;
        ctx.font = '500 17px ' + F.mono;
        ctx.fillText(dateStr, W - PAD, cy);
        ctx.restore();
    }

    // ─────────────────────────────────────────────────────────────────
    //  Línea divisora con degradado
    // ─────────────────────────────────────────────────────────────────

    function _drawDivider(ctx, W, y) {
        var grad = ctx.createLinearGradient(60, 0, W - 60, 0);
        grad.addColorStop(0,   'transparent');
        grad.addColorStop(0.25, 'rgba(42,240,255,0.25)');
        grad.addColorStop(0.75, 'rgba(0,148,255,0.20)');
        grad.addColorStop(1,   'transparent');
        ctx.beginPath();
        ctx.moveTo(60, y);
        ctx.lineTo(W - 60, y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    // ─────────────────────────────────────────────────────────────────
    //  3. HERO SCORE — bloque principal de resultado
    // ─────────────────────────────────────────────────────────────────

    function _drawHeroScore(ctx, gd, W) {
        // Extraer datos compatibles con ambos formatos
        var winner, loser;
        if (gd.winnerTeam) {
            winner = gd.winnerTeam;
            loser  = gd.loserTeam;
        } else if (gd.winner && gd.teams) {
            winner = { players: gd.teams[gd.winner - 1].players, score: gd.teams[gd.winner - 1].score };
            var li = gd.winner === 1 ? 1 : 0;
            loser  = { players: gd.teams[li].players, score: gd.teams[li].score };
        } else {
            return;
        }

        var topY  = 112;
        var totalH = 490;
        var GAP   = 16;
        var PAD   = 32;

        // ─ Dimensiones: ganador 62% del ancho, perdedor 38% - gap ─────
        var winW  = Math.round((W - PAD * 2 - GAP) * 0.62);
        var loseW = W - PAD * 2 - GAP - winW;
        var winX  = PAD;
        var loseX = PAD + winW + GAP;
        var R     = 22;

        // ─ Bloque GANADOR ────────────────────────────────────────────
        ctx.save();

        // Sombra exterior del bloque ganador
        ctx.shadowColor = 'rgba(42,240,255,0.25)';
        ctx.shadowBlur  = 40;
        _roundRect(ctx, winX, topY, winW, totalH, R);
        var wg = ctx.createLinearGradient(winX, topY, winX, topY + totalH);
        wg.addColorStop(0, C.winBg1);
        wg.addColorStop(1, C.winBg2);
        ctx.fillStyle = wg;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = C.winBorder;
        ctx.lineWidth = 1.5;
        _roundRect(ctx, winX, topY, winW, totalH, R);
        ctx.stroke();

        // Línea de acento superior (neón full-width del bloque)
        var accentGrad = ctx.createLinearGradient(winX, 0, winX + winW, 0);
        accentGrad.addColorStop(0, C.neon2);
        accentGrad.addColorStop(1, C.neon);
        ctx.beginPath();
        ctx.moveTo(winX + R, topY + 1.5);
        ctx.lineTo(winX + winW - R, topY + 1.5);
        ctx.strokeStyle = accentGrad;
        ctx.lineWidth = 3;
        ctx.stroke();

        // Icono corona (dibujado con paths, no unicode)
        _drawCrown(ctx, winX + winW / 2, topY + 54, 22, C.gold);

        // Label "GANADOR"
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = C.neon;
        ctx.font = '700 18px ' + F.body;
        ctx.fillText('GANADOR', winX + winW / 2, topY + 98);

        // Nombres del equipo ganador
        var winNames = _formatTeamName(winner.players);
        ctx.fillStyle = C.white;
        ctx.font = '600 32px ' + F.body;
        ctx.fillText(_truncate(winNames[0], 18), winX + winW / 2, topY + 148);
        if (winNames[1]) {
            ctx.fillStyle = C.dim;
            ctx.font = '400 24px ' + F.body;
            ctx.fillText(_truncate(winNames[1], 18), winX + winW / 2, topY + 182);
        }

        // Score GRANDE con glow neón
        var scoreY = topY + 400;
        ctx.save();
        ctx.shadowColor = C.neon;
        ctx.shadowBlur  = 32;
        ctx.fillStyle   = C.neon;
        ctx.font        = '260px ' + F.display;
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(String(winner.score), winX + winW / 2, scoreY);
        ctx.restore();

        // Label "PTS" debajo del score
        ctx.fillStyle = 'rgba(42,240,255,0.45)';
        ctx.font = '700 22px ' + F.body;
        ctx.fillText('PTS', winX + winW / 2, scoreY + 26);

        ctx.restore();

        // ─ Bloque PERDEDOR ───────────────────────────────────────────
        ctx.save();

        _roundRect(ctx, loseX, topY, loseW, totalH, R);
        var rg = ctx.createLinearGradient(loseX, topY, loseX, topY + totalH);
        rg.addColorStop(0, C.loseBg1);
        rg.addColorStop(1, C.loseBg2);
        ctx.fillStyle = rg;
        ctx.fill();
        ctx.strokeStyle = C.loseBorder;
        ctx.lineWidth = 1.5;
        _roundRect(ctx, loseX, topY, loseW, totalH, R);
        ctx.stroke();

        // Guión decorativo en lugar de corona
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = C.muted;
        ctx.font = '400 20px ' + F.body;
        ctx.fillText('2.°', loseX + loseW / 2, topY + 58);

        // Label "SEGUNDO"
        ctx.fillStyle = C.red;
        ctx.font = '700 16px ' + F.body;
        ctx.fillText('SEGUNDO', loseX + loseW / 2, topY + 88);

        // Nombre(s) equipo perdedor
        var loseNames = _formatTeamName(loser.players);
        ctx.fillStyle = C.dim;
        ctx.font = '500 24px ' + F.body;
        ctx.fillText(_truncate(loseNames[0], 14), loseX + loseW / 2, topY + 130);
        if (loseNames[1]) {
            ctx.fillStyle = C.muted;
            ctx.font = '400 18px ' + F.body;
            ctx.fillText(_truncate(loseNames[1], 14), loseX + loseW / 2, topY + 158);
        }

        // Score del perdedor
        ctx.save();
        ctx.fillStyle = C.red;
        ctx.font = '160px ' + F.display;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(String(loser.score), loseX + loseW / 2, topY + 390);
        ctx.restore();

        ctx.fillStyle = 'rgba(255,90,90,0.40)';
        ctx.font = '600 16px ' + F.body;
        ctx.fillText('PTS', loseX + loseW / 2, topY + 418);

        // Badge LISA
        if (gd.isLisa) {
            _drawLisaBadge(ctx, loseX + loseW / 2, topY + totalH - 46, loseW - 24);
        }

        ctx.restore();

        // ─ Divisor inferior del hero ─────────────────────────────────
        _drawDivider(ctx, W, topY + totalH + 22);
    }

    // ─────────────────────────────────────────────────────────────────
    //  4. ESTADÍSTICAS — 4 badges en una fila
    // ─────────────────────────────────────────────────────────────────

    function _drawStatsBadges(ctx, gd, W) {
        var topY = 636;
        var PAD  = 32;
        var COLS = 4;
        var GAP  = 14;
        var bW   = Math.floor((W - PAD * 2 - GAP * (COLS - 1)) / COLS);
        var bH   = 128;
        var R    = 18;

        // Calcular valores
        var duration   = _calcDuration(gd.startTime, gd.endTime);
        var handsCount, capicuas;
        if (gd.hands && Array.isArray(gd.hands)) {
            handsCount = gd.hands.length;
            capicuas   = gd.hands.filter(function (h) { return h.capi; }).length;
        } else {
            handsCount = gd.hands;
            capicuas   = gd.capicuas;
        }
        var limit = gd.limit || '—';

        var badges = [
            { icon: 'clock',   label: 'DURACIÓN',  value: duration,             accent: C.neon2 },
            { icon: 'hand',    label: 'MANOS',     value: handsCount || '—',    accent: C.neon  },
            { icon: 'diamond', label: 'CAPICÚAS',  value: capicuas !== undefined ? capicuas : '—', accent: C.gold },
            { icon: 'target',  label: 'LÍMITE',    value: limit,                accent: C.dim   },
        ];

        badges.forEach(function (b, i) {
            var bx = PAD + i * (bW + GAP);
            var by = topY;
            var cx = bx + bW / 2;

            ctx.save();

            // Fondo
            _roundRect(ctx, bx, by, bW, bH, R);
            ctx.fillStyle = C.statBg;
            ctx.fill();
            ctx.strokeStyle = C.statBorder;
            ctx.lineWidth = 1;
            _roundRect(ctx, bx, by, bW, bH, R);
            ctx.stroke();

            // Línea de acento superior
            var accG = ctx.createLinearGradient(bx, 0, bx + bW, 0);
            accG.addColorStop(0, 'transparent');
            accG.addColorStop(0.5, b.accent);
            accG.addColorStop(1, 'transparent');
            ctx.beginPath();
            ctx.moveTo(bx + R, by + 1.5);
            ctx.lineTo(bx + bW - R, by + 1.5);
            ctx.strokeStyle = b.accent;
            ctx.globalAlpha = 0.6;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.globalAlpha = 1;

            // Valor grande
            ctx.textAlign   = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle   = C.white;
            ctx.font        = '700 40px ' + F.mono;
            ctx.fillText(String(b.value), cx, by + 72);

            // Label
            ctx.fillStyle = C.muted;
            ctx.font = '500 14px ' + F.body;
            ctx.fillText(b.label, cx, by + 100);

            ctx.restore();
        });
    }

    // ─────────────────────────────────────────────────────────────────
    //  5. FOOTER
    // ─────────────────────────────────────────────────────────────────

    function _drawFooter(ctx, W, H) {
        var y = H - 30;

        _drawDivider(ctx, W, y - 20);

        ctx.textAlign   = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle   = C.muted;
        ctx.font        = '400 17px ' + F.body;
        ctx.fillText('DominoScorePro · dominoscore.app · iOS & Android', W / 2, y);
    }

    // ─────────────────────────────────────────────────────────────────
    //  CORONA dibujada con canvas paths (sin unicode)
    // ─────────────────────────────────────────────────────────────────

    function _drawCrown(ctx, cx, cy, size, color) {
        ctx.save();
        ctx.fillStyle = color;
        var s = size;

        // Corona simple: base + 3 puntas
        ctx.beginPath();
        // Base rectangular de la corona
        ctx.moveTo(cx - s, cy + s * 0.4);
        ctx.lineTo(cx + s, cy + s * 0.4);
        ctx.lineTo(cx + s * 0.85, cy + s);
        ctx.lineTo(cx - s * 0.85, cy + s);
        ctx.closePath();
        ctx.fill();

        // Punta izquierda
        ctx.beginPath();
        ctx.moveTo(cx - s, cy + s * 0.4);
        ctx.lineTo(cx - s * 0.95, cy - s * 0.5);
        ctx.lineTo(cx - s * 0.4, cy);
        ctx.closePath();
        ctx.fill();

        // Punta central
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.3, cy + s * 0.1);
        ctx.lineTo(cx, cy - s * 0.85);
        ctx.lineTo(cx + s * 0.3, cy + s * 0.1);
        ctx.closePath();
        ctx.fill();

        // Punta derecha
        ctx.beginPath();
        ctx.moveTo(cx + s, cy + s * 0.4);
        ctx.lineTo(cx + s * 0.95, cy - s * 0.5);
        ctx.lineTo(cx + s * 0.4, cy);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    // ─────────────────────────────────────────────────────────────────
    //  Badge LISA
    // ─────────────────────────────────────────────────────────────────

    function _drawLisaBadge(ctx, cx, cy, maxW) {
        var bw  = Math.min(maxW, 220);
        var bh  = 34;
        var bx  = cx - bw / 2;
        var by  = cy - bh / 2;

        ctx.save();
        _roundRect(ctx, bx, by, bw, bh, 17);
        var grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        grad.addColorStop(0, '#f0b429');
        grad.addColorStop(1, '#e08000');
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle   = '#07080d';
        ctx.font        = '700 15px ' + F.body;
        ctx.fillText('LISAAA  ·  RIVAL EN 0', cx, cy);
        ctx.restore();
    }

    // ═════════════════════════════════════════════════════════════════
    //  COMPARTIR — cadena: Capacitor.Share → Web Share API → descarga
    // ═════════════════════════════════════════════════════════════════

    function _share() {
        if (!_currentBlob && !_currentDataURL) {
            _setStatus('La imagen aún no está lista.', true);
            return;
        }

        var winnerName = _getWinnerName(_currentGameData);
        var filename   = 'DominoScorePro_' + _fileDate() + '.png';
        var shareText  = '\u00a1' + winnerName + ' gan\u00f3 la partida! Registrado con DominoScorePro.';
        var base64Data = _currentDataURL ? _currentDataURL.split(',')[1] : null;

        // ── 1. Capacitor Share (nativo iOS / Android) ──────────────────
        var Cap = window.Capacitor;
        if (Cap && Cap.isNativePlatform && Cap.isNativePlatform()
            && Cap.Plugins && Cap.Plugins.Share) {

            Cap.Plugins.Share.share({
                title:         'DominoScorePro — Resultado',
                text:          shareText,
                url:           'https://dominoscore.app',
                dialogTitle:   'Compartir resultado',
                // files solo está disponible en Capacitor Share v6+ — opcional
                files: base64Data ? ['data:image/png;base64,' + base64Data] : undefined,
            }).then(function () {
                _setStatus('Compartido exitosamente.', false);
            }).catch(function (err) {
                if (err && err.message !== 'Share canceled') {
                    _shareWebFallback(filename, shareText);
                }
            });
            return;
        }

        // ── 2. Web Share API (PWA / Safari iOS / Android Chrome) ──────
        _shareWebFallback(filename, shareText);
    }

    function _shareWebFallback(filename, shareText) {
        var blob = _currentBlob;
        if (navigator.share && navigator.canShare && blob) {
            var file = new File([blob], filename, { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
                navigator.share({
                    title: 'DominoScorePro — Resultado',
                    text:  shareText,
                    files: [file],
                }).then(function () {
                    _setStatus('Compartido exitosamente.', false);
                }).catch(function (err) {
                    if (err && err.name !== 'AbortError') {
                        _download();
                    }
                });
                return;
            }
        }

        if (navigator.share) {
            navigator.share({ title: 'DominoScorePro', text: shareText })
                .catch(function () { _download(); });
            return;
        }

        // ── 3. Fallback final: descarga directa ────────────────────────
        _download();
    }

    // ═════════════════════════════════════════════════════════════════
    //  GUARDAR — cadena: Capacitor.Filesystem (Photos) → descarga web
    // ═════════════════════════════════════════════════════════════════

    function _download() {
        if (!_currentDataURL) {
            _setStatus('La imagen aún no está lista.', true);
            return;
        }

        var filename   = 'DominoScorePro_' + _fileDate() + '.png';
        var base64Data = _currentDataURL.split(',')[1];
        var Cap = window.Capacitor;

        // ── 1. Capacitor Filesystem → directorio PHOTOS (galería) ──────
        if (Cap && Cap.isNativePlatform && Cap.isNativePlatform()
            && Cap.Plugins && Cap.Plugins.Filesystem) {

            var FS = Cap.Plugins.Filesystem;
            FS.writeFile({
                path:      filename,
                data:      base64Data,
                directory: 'PHOTOS',   // Requiere permiso WRITE_EXTERNAL_STORAGE en Android < 10
            }).then(function (result) {
                _setStatus('Imagen guardada en la galería.', false);
                // En Android también intentamos agregar al media store
                if (Cap.Plugins.Filesystem.stat) {
                    // Notificar al sistema para que aparezca en galería (Android)
                }
            }).catch(function (err) {
                console.warn('[share] Filesystem falló, intentando DOCUMENTS:', err);
                // Segunda oportunidad: DOCUMENTS en lugar de PHOTOS
                FS.writeFile({
                    path:      filename,
                    data:      base64Data,
                    directory: 'DOCUMENTS',
                }).then(function () {
                    _setStatus('Imagen guardada en Documentos.', false);
                }).catch(function () {
                    _downloadWeb(filename);
                });
            });
            return;
        }

        // ── 2. Descarga web estándar ───────────────────────────────────
        _downloadWeb(filename);
    }

    function _downloadWeb(filename) {
        var a = document.createElement('a');
        a.href     = _currentDataURL;
        a.download = filename || 'resultado_domino.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        _setStatus('Imagen descargada.', false);
    }

    // ═════════════════════════════════════════════════════════════════
    //  UTILIDADES
    // ═════════════════════════════════════════════════════════════════

    function _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function _formatTeamName(players) {
        // Devuelve array [nombre1, nombre2_o_null]
        if (!players) return ['Equipo', null];
        var result = [players[0] || 'Jugador'];
        result.push(players[1] || null);
        return result;
    }

    function _truncate(str, max) {
        if (!str) return '';
        return str.length > max ? str.substring(0, max - 1) + '\u2026' : str;
    }

    function _calcDuration(start, end) {
        if (!start || !end) return '\u2014';
        var ms = new Date(end) - new Date(start);
        if (isNaN(ms) || ms < 0) return '\u2014';
        var mins = Math.round(ms / 60000);
        if (mins < 1) return '< 1 min';
        if (mins < 60) return mins + ' min';
        var h = Math.floor(mins / 60), m = mins % 60;
        return h + 'h ' + (m ? m + 'm' : '');
    }

    function _formatShortDate(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function _fileDate() {
        var d = new Date();
        return d.getFullYear() +
            String(d.getMonth() + 1).padStart(2, '0') +
            String(d.getDate()).padStart(2, '0') + '_' +
            String(d.getHours()).padStart(2, '0') +
            String(d.getMinutes()).padStart(2, '0');
    }

    function _getWinnerName(gd) {
        if (!gd) return 'El equipo';
        var players;
        if (gd.winnerTeam && gd.winnerTeam.players)  players = gd.winnerTeam.players;
        else if (gd.winner && gd.teams)               players = gd.teams[gd.winner - 1].players;
        if (!players || !players[0]) return 'El equipo';
        return players[0] + (players[1] ? ' y ' + players[1] : '');
    }

    function _showLoading(isLoading) {
        var loader  = document.getElementById('share-loader');
        var preview = document.getElementById('share-preview-wrap');
        if (loader)  loader.classList.toggle('hidden', !isLoading);
        if (preview) preview.classList.toggle('hidden', isLoading);
        if (_btnShare) _btnShare.disabled = isLoading;
        if (_btnSave)  _btnSave.disabled  = isLoading;
    }

    function _setStatus(msg, isError) {
        if (!_shareStatus) return;
        _shareStatus.textContent = msg;
        _shareStatus.style.color = isError ? '#ff5a5a' : '#2af0ff';
        _shareStatus.classList.remove('hidden');
        setTimeout(function () {
            _shareStatus.classList.add('hidden');
        }, 3800);
    }

    // ═════════════════════════════════════════════════════════════════
    //  EXPORTACIÓN GLOBAL
    // ═════════════════════════════════════════════════════════════════

    window.DominoShare = { init: init, open: open, close: close };
    console.log('[share] DominoShare v2 listo ✓');

})();
