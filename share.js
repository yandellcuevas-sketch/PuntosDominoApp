/* ═══════════════════════════════════════════════════════════════════
   share.js — Módulo de Compartir Resultado
   ─────────────────────────────────────────────────────────────────
   REGLAS DE ORO:
   • Módulo 100% aislado — no modifica state, no toca localStorage.
   • Solo usa datos del objeto `gameData` que recibe como parámetro.
   • Canvas API puro — sin html2canvas ni dependencias externas.
   • Web Share API con fallback automático a descarga de archivo PNG.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ── Configuración de Canvas ──────────────────────────────────────
    var CARD_SIZE    = 1080;   // cuadrado 1080x1080
    var LOGO_PATH    = 'logodomino.png';

    // ── Paleta de Colores (alineada con style.css) ───────────────────
    var C = {
        bg1:         '#0a0b0f',
        bg2:         '#10121a',
        bg3:         '#181c28',
        neon:        '#2af0ff',
        neon2:       '#0099ff',
        gold:        '#f0b429',
        red:         '#ff6b6b',
        white:       '#e8eaf0',
        muted:       '#6b7280',
        glass:       'rgba(255,255,255,0.05)',
        glassBorder: 'rgba(255,255,255,0.10)',
        neonGlow:    'rgba(42,240,255,0.20)',
        goldGlow:    'rgba(240,180,41,0.25)',
    };

    // ── Tipografías (las mismas que carga index.html) ────────────────
    var F = {
        display:  "'Bebas Neue', sans-serif",
        body:     "'DM Sans', sans-serif",
        mono:     "'JetBrains Mono', monospace",
    };

    // ── Referencias DOM ──────────────────────────────────────────────
    var _modal         = null;
    var _previewImg    = null;
    var _btnShare      = null;
    var _btnSave       = null;
    var _btnClose      = null;
    var _shareStatus   = null;
    var _currentBlob   = null;
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

        // Cerrar al hacer click en el overlay (fondo)
        if (_modal) {
            _modal.addEventListener('click', function (e) {
                if (e.target === _modal) close();
            });
        }

        console.log('[share] Módulo de compartir cargado ✓');
    }

    // ═════════════════════════════════════════════════════════════════
    //  API PÚBLICA — open(gameData)
    //  gameData puede provenir de state.game (partida activa)
    //  o de una entrada del historial (entry de state.history).
    // ═════════════════════════════════════════════════════════════════

    function open(gameData) {
        if (!_modal) return;
        _currentGameData = gameData;
        _currentBlob     = null;
        _currentDataURL  = null;

        // Mostrar modal con estado de carga
        _showLoading(true);
        _modal.classList.remove('hidden');

        // Esperar fuentes y luego renderizar
        document.fonts.ready.then(function () {
            _render(gameData).then(function (result) {
                _currentDataURL = result.dataURL;
                _currentBlob    = result.blob;
                if (_previewImg) _previewImg.src = result.dataURL;
                _showLoading(false);
            }).catch(function (err) {
                console.error('[share] Error al generar imagen:', err);
                _setStatus('No se pudo generar la imagen. Inténtalo de nuevo.', true);
                _showLoading(false);
            });
        });
    }

    function close() {
        if (_modal) _modal.classList.add('hidden');
        _currentBlob     = null;
        _currentDataURL  = null;
        _currentGameData = null;
    }

    // ═════════════════════════════════════════════════════════════════
    //  RENDERIZADO CANVAS — 1080x1080
    // ═════════════════════════════════════════════════════════════════

    function _render(gd) {
        return new Promise(function (resolve, reject) {
            // Cargar el logo antes de dibujar
            var logo = new Image();
            logo.crossOrigin = 'anonymous';

            logo.onload = function () {
                try {
                    var canvas = document.createElement('canvas');
                    canvas.width  = CARD_SIZE;
                    canvas.height = CARD_SIZE;
                    var ctx = canvas.getContext('2d');

                    _drawCard(ctx, gd, logo);

                    canvas.toBlob(function (blob) {
                        var dataURL = canvas.toDataURL('image/png');
                        resolve({ dataURL: dataURL, blob: blob });
                    }, 'image/png');

                } catch (err) {
                    reject(err);
                }
            };

            logo.onerror = function () {
                // Si el logo no carga, dibujamos la tarjeta sin él
                try {
                    var canvas = document.createElement('canvas');
                    canvas.width  = CARD_SIZE;
                    canvas.height = CARD_SIZE;
                    var ctx = canvas.getContext('2d');

                    _drawCard(ctx, gd, null);

                    canvas.toBlob(function (blob) {
                        var dataURL = canvas.toDataURL('image/png');
                        resolve({ dataURL: dataURL, blob: blob });
                    }, 'image/png');
                } catch (err) {
                    reject(err);
                }
            };

            logo.src = LOGO_PATH;
        });
    }

    // ─────────────────────────────────────────────────────────────────
    //  _drawCard: orquesta todas las capas del canvas
    // ─────────────────────────────────────────────────────────────────

    function _drawCard(ctx, gd, logo) {
        var S = CARD_SIZE;

        // ── 1. Fondo degradado ────────────────────────────────────────
        var bgGrad = ctx.createLinearGradient(0, 0, S, S);
        bgGrad.addColorStop(0, C.bg1);
        bgGrad.addColorStop(0.5, C.bg2);
        bgGrad.addColorStop(1, C.bg3);
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, S, S);

        // ── 2. Brillo radial de fondo (atmosphérico) ─────────────────
        var glow = ctx.createRadialGradient(S / 2, S * 0.25, 0, S / 2, S * 0.25, S * 0.5);
        glow.addColorStop(0, 'rgba(42,240,255,0.07)');
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, S, S);

        // ── 3. Borde neón exterior de la tarjeta ─────────────────────
        _drawRoundedRect(ctx, 4, 4, S - 8, S - 8, 32);
        ctx.strokeStyle = 'rgba(42,240,255,0.35)';
        ctx.lineWidth = 3;
        ctx.stroke();

        // ── 4. Línea decorativa superior ─────────────────────────────
        var lineGrad = ctx.createLinearGradient(80, 0, S - 80, 0);
        lineGrad.addColorStop(0, 'transparent');
        lineGrad.addColorStop(0.3, C.neon);
        lineGrad.addColorStop(0.7, C.neon2);
        lineGrad.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.moveTo(80, 52);
        ctx.lineTo(S - 80, 52);
        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // ── 5. Header — Logo + Nombre de la app ──────────────────────
        _drawHeader(ctx, gd, logo, S);

        // ── 6. Título "PARTIDA TERMINADA" ─────────────────────────────
        _drawTitle(ctx, gd, S);

        // ── 7. Bloque central de marcador ─────────────────────────────
        _drawScoreBlock(ctx, gd, S);

        // ── 8. Badges de estadísticas ─────────────────────────────────
        _drawStatsBadges(ctx, gd, S);

        // ── 9. Footer ─────────────────────────────────────────────────
        _drawFooter(ctx, S);
    }

    // ─────────────────────────────────────────────────────────────────
    //  Header: Logo + "DOMINÓSCORE PRO"
    // ─────────────────────────────────────────────────────────────────

    function _drawHeader(ctx, gd, logo, S) {
        var centerX = S / 2;
        var logoY = 80;
        var logoSize = 90;

        // Anillo de brillo detrás del logo
        ctx.save();
        var logoGlow = ctx.createRadialGradient(centerX, logoY + logoSize / 2, 0, centerX, logoY + logoSize / 2, 70);
        logoGlow.addColorStop(0, 'rgba(42,240,255,0.18)');
        logoGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = logoGlow;
        ctx.beginPath();
        ctx.arc(centerX, logoY + logoSize / 2, 70, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Círculo de fondo del logo
        ctx.save();
        ctx.beginPath();
        ctx.arc(centerX, logoY + logoSize / 2, logoSize / 2 + 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(42,240,255,0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(42,240,255,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // Logo (si cargó)
        if (logo) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(centerX, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(logo, centerX - logoSize / 2, logoY, logoSize, logoSize);
            ctx.restore();
        } else {
            // Placeholder si no hay logo
            ctx.save();
            ctx.fillStyle = C.neon;
            ctx.font = '72px ' + F.display;
            ctx.textAlign = 'center';
            ctx.fillText('D', centerX, logoY + logoSize * 0.75);
            ctx.restore();
        }

        // "DOMINÓSCORE PRO"
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = C.white;
        ctx.font = '600 30px ' + F.body;
        ctx.letterSpacing = '4px';
        ctx.fillText('DOMINÓSCORE PRO', centerX, logoY + logoSize + 44);
        ctx.restore();
    }

    // ─────────────────────────────────────────────────────────────────
    //  Título — "PARTIDA TERMINADA" y badge de LISA si aplica
    // ─────────────────────────────────────────────────────────────────

    function _drawTitle(ctx, gd, S) {
        var centerX = S / 2;
        var y = 285;

        // Separador
        var sepGrad = ctx.createLinearGradient(140, 0, S - 140, 0);
        sepGrad.addColorStop(0, 'transparent');
        sepGrad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
        sepGrad.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.moveTo(140, y - 14);
        ctx.lineTo(S - 140, y - 14);
        ctx.strokeStyle = sepGrad;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Título
        ctx.save();
        ctx.textAlign = 'center';

        // Degradado de texto
        var titleGrad = ctx.createLinearGradient(centerX - 250, 0, centerX + 250, 0);
        titleGrad.addColorStop(0, C.neon);
        titleGrad.addColorStop(1, C.neon2);
        ctx.fillStyle = titleGrad;
        ctx.font = '86px ' + F.display;
        ctx.fillText('PARTIDA TERMINADA', centerX, y);
        ctx.restore();

        // Badge LISA si aplica
        if (gd.isLisa) {
            ctx.save();
            var badgeX = centerX;
            var badgeY = y + 26;
            var bw = 260;
            var bh = 38;

            // Fondo del badge
            _drawRoundedRect(ctx, badgeX - bw / 2, badgeY, bw, bh, 19);
            var badgeGrad = ctx.createLinearGradient(badgeX - bw / 2, 0, badgeX + bw / 2, 0);
            badgeGrad.addColorStop(0, C.gold);
            badgeGrad.addColorStop(1, '#e68900');
            ctx.fillStyle = badgeGrad;
            ctx.fill();

            ctx.textAlign = 'center';
            ctx.fillStyle = '#0a0b0f';
            ctx.font = 'bold 20px ' + F.body;
            ctx.fillText('LISAAA — RIVAL EN 0', badgeX, badgeY + 25);
            ctx.restore();
        }
    }

    // ─────────────────────────────────────────────────────────────────
    //  Bloque de Marcador Central
    // ─────────────────────────────────────────────────────────────────

    function _drawScoreBlock(ctx, gd, S) {
        var topY  = gd.isLisa ? 380 : 338;
        var blockW = 440;
        var blockH = 240;
        var gap    = 20;
        var leftX  = S / 2 - blockW - gap / 2;
        var rightX = S / 2 + gap / 2;
        var radius = 20;

        // Extraer datos del ganador/perdedor
        // Soporta tanto el formato de state.game como el formato de historial
        var winner, loser;
        if (gd.winnerTeam) {
            // Formato historial: { winnerTeam: { players, score }, loserTeam: { players, score } }
            winner = gd.winnerTeam;
            loser  = gd.loserTeam;
        } else if (gd.winner && gd.teams) {
            // Formato state.game
            winner = { players: gd.teams[gd.winner - 1].players, score: gd.teams[gd.winner - 1].score };
            var loseIdx = gd.winner === 1 ? 1 : 0;
            loser  = { players: gd.teams[loseIdx].players, score: gd.teams[loseIdx].score };
        } else {
            return; // Sin datos, no dibujar
        }

        var winnerName = winner.players ? winner.players[0] + (winner.players[1] ? ' & ' + winner.players[1] : '') : 'Ganador';
        var loserName  = loser.players  ? loser.players[0]  + (loser.players[1]  ? ' & ' + loser.players[1]  : '') : 'Perdedor';

        // ─ Bloque GANADOR (izquierda) ───────────────────────────────
        ctx.save();

        // Fondo con brillo cian
        _drawRoundedRect(ctx, leftX, topY, blockW, blockH, radius);
        var winGrad = ctx.createLinearGradient(leftX, topY, leftX, topY + blockH);
        winGrad.addColorStop(0, 'rgba(42,240,255,0.12)');
        winGrad.addColorStop(1, 'rgba(42,240,255,0.04)');
        ctx.fillStyle = winGrad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(42,240,255,0.45)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Icono corona (SVG-like en canvas)
        ctx.textAlign = 'center';
        ctx.font = '28px serif';
        ctx.fillText('★', leftX + blockW / 2, topY + 36);

        // Label "GANADOR"
        ctx.fillStyle = C.neon;
        ctx.font = 'bold 16px ' + F.body;
        ctx.letterSpacing = '3px';
        ctx.fillText('GANADOR', leftX + blockW / 2, topY + 58);

        // Nombres
        ctx.fillStyle = C.white;
        ctx.font = '500 26px ' + F.body;
        ctx.letterSpacing = '0px';
        ctx.fillText(_truncate(winnerName, 22), leftX + blockW / 2, topY + 96);

        // Puntos (gran número con sombra neón)
        ctx.shadowColor = C.neon;
        ctx.shadowBlur = 22;
        ctx.fillStyle = C.neon;
        ctx.font = '148px ' + F.display;
        ctx.fillText(winner.score, leftX + blockW / 2, topY + 222);
        ctx.shadowBlur = 0;

        ctx.restore();

        // ─ Bloque PERDEDOR (derecha) ─────────────────────────────────
        ctx.save();

        _drawRoundedRect(ctx, rightX, topY, blockW, blockH, radius);
        var loseGrad = ctx.createLinearGradient(rightX, topY, rightX, topY + blockH);
        loseGrad.addColorStop(0, 'rgba(255,107,107,0.08)');
        loseGrad.addColorStop(1, 'rgba(255,107,107,0.02)');
        ctx.fillStyle = loseGrad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,107,107,0.30)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Guión
        ctx.textAlign = 'center';
        ctx.fillStyle = C.muted;
        ctx.font = '28px ' + F.body;
        ctx.fillText('—', rightX + blockW / 2, topY + 36);

        // Label "SEGUNDO"
        ctx.fillStyle = C.red;
        ctx.font = 'bold 16px ' + F.body;
        ctx.letterSpacing = '3px';
        ctx.fillText('SEGUNDO', rightX + blockW / 2, topY + 58);

        // Nombres
        ctx.fillStyle = C.muted;
        ctx.font = '500 26px ' + F.body;
        ctx.letterSpacing = '0px';
        ctx.fillText(_truncate(loserName, 22), rightX + blockW / 2, topY + 96);

        // Puntos
        ctx.fillStyle = C.red;
        ctx.font = '130px ' + F.display;
        ctx.fillText(loser.score, rightX + blockW / 2, topY + 222);

        ctx.restore();
    }

    // ─────────────────────────────────────────────────────────────────
    //  Badges de Estadísticas
    // ─────────────────────────────────────────────────────────────────

    function _drawStatsBadges(ctx, gd, S) {
        var topY = 648;

        // Calcular estadísticas
        var duration   = _calcDuration(gd.startTime, gd.endTime);
        var handsCount = gd.hands;  // En historial es un número directo
        var capicuas   = gd.capicuas; // En historial es un número directo
        var limit      = gd.limit || '—';
        var dateStr    = _formatShortDate(gd.endTime);

        // Si viene de state.game (tiene arrays):
        if (gd.hands && Array.isArray(gd.hands)) {
            handsCount = gd.hands.length;
            capicuas   = gd.hands.filter(function (h) { return h.capi; }).length;
        }

        var badges = [
            { label: 'DURACIÓN',  value: duration },
            { label: 'MANOS',     value: handsCount || '—' },
            { label: 'CAPICÚAS',  value: capicuas !== undefined ? capicuas : '—' },
            { label: 'LÍMITE',    value: limit },
            { label: 'FECHA',     value: dateStr },
        ];

        var badgeW  = 174;
        var badgeH  = 84;
        var cols    = 5;
        var totalW  = cols * badgeW + (cols - 1) * 14;
        var startX  = (S - totalW) / 2;
        var radius  = 14;

        badges.forEach(function (b, i) {
            var bx = startX + i * (badgeW + 14);
            var by = topY;

            ctx.save();

            // Fondo del badge
            _drawRoundedRect(ctx, bx, by, badgeW, badgeH, radius);
            ctx.fillStyle = 'rgba(255,255,255,0.05)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.10)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Valor
            ctx.textAlign = 'center';
            ctx.fillStyle = C.white;
            ctx.font = '700 28px ' + F.mono;
            ctx.fillText(String(b.value), bx + badgeW / 2, by + 46);

            // Label
            ctx.fillStyle = C.muted;
            ctx.font = '500 13px ' + F.body;
            ctx.letterSpacing = '1px';
            ctx.fillText(b.label, bx + badgeW / 2, by + 70);

            ctx.restore();
        });
    }

    // ─────────────────────────────────────────────────────────────────
    //  Footer
    // ─────────────────────────────────────────────────────────────────

    function _drawFooter(ctx, S) {
        var y = S - 36;

        // Línea separadora
        var lineGrad = ctx.createLinearGradient(80, 0, S - 80, 0);
        lineGrad.addColorStop(0, 'transparent');
        lineGrad.addColorStop(0.5, 'rgba(255,255,255,0.10)');
        lineGrad.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.moveTo(80, y - 18);
        ctx.lineTo(S - 80, y - 18);
        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.fillStyle = C.muted;
        ctx.font = '18px ' + F.body;
        ctx.fillText('Registrado con DominoScorePro · Disponible en iOS & Android', S / 2, y);
    }

    // ═════════════════════════════════════════════════════════════════
    //  COMPARTIR / DESCARGAR
    // ═════════════════════════════════════════════════════════════════

    function _share() {
        if (!_currentBlob && !_currentDataURL) {
            _setStatus('La imagen aún no está lista. Espera un momento.', true);
            return;
        }

        var blob = _currentBlob;
        var winnerName = _getWinnerName(_currentGameData);
        var filename = 'DominoScorePro_' + _fileDate() + '.png';

        // Intentar Web Share API (con archivo)
        if (navigator.share && navigator.canShare) {
            var file = new File([blob], filename, { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
                navigator.share({
                    title: 'DominoScorePro — Resultado de Partida',
                    text: winnerName + ' gan\u00f3 la partida. \u00a1Mira el resultado!',
                    files: [file],
                }).then(function () {
                    _setStatus('Compartido exitosamente.', false);
                }).catch(function (err) {
                    if (err.name !== 'AbortError') {
                        // Fallback si el usuario canceló
                        _download();
                    }
                });
                return;
            }
        }

        // Fallback: navigator.share sin archivos (solo texto+URL)
        if (navigator.share) {
            navigator.share({
                title: 'DominoScorePro — Resultado de Partida',
                text: winnerName + ' gan\u00f3 la partida. \u00a1Descarga DominoScorePro!',
            }).catch(function () {
                _download();
            });
            return;
        }

        // Fallback final: descarga directa
        _download();
    }

    function _download() {
        if (!_currentDataURL) {
            _setStatus('La imagen aún no está lista.', true);
            return;
        }

        var filename = 'DominoScorePro_' + _fileDate() + '.png';

        // Intentar Capacitor Filesystem (nativo iOS/Android)
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
            var Filesystem = window.Capacitor.Plugins.Filesystem;
            var base64Data = _currentDataURL.split(',')[1];
            Filesystem.writeFile({
                path: filename,
                data: base64Data,
                directory: 'DOCUMENTS',
            }).then(function () {
                _setStatus('Imagen guardada en tus documentos.', false);
            }).catch(function () {
                _downloadWeb(filename);
            });
            return;
        }

        // Descarga web estándar
        _downloadWeb(filename);
    }

    function _downloadWeb(filename) {
        var a = document.createElement('a');
        a.href = _currentDataURL;
        a.download = filename || 'resultado_domino.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        _setStatus('Imagen descargada.', false);
    }

    // ═════════════════════════════════════════════════════════════════
    //  UTILIDADES INTERNAS
    // ═════════════════════════════════════════════════════════════════

    function _drawRoundedRect(ctx, x, y, w, h, r) {
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

    function _truncate(str, maxLen) {
        if (!str) return '';
        return str.length > maxLen ? str.substring(0, maxLen - 1) + '…' : str;
    }

    function _calcDuration(start, end) {
        if (!start || !end) return '—';
        var ms = new Date(end) - new Date(start);
        if (isNaN(ms) || ms < 0) return '—';
        var mins = Math.round(ms / 60000);
        if (mins < 60) return mins + ' min';
        var h = Math.floor(mins / 60);
        var m = mins % 60;
        return h + 'h ' + m + 'm';
    }

    function _formatShortDate(iso) {
        if (!iso) return '—';
        var d = new Date(iso);
        return d.toLocaleDateString('es-DO', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function _fileDate() {
        var d = new Date();
        return d.getFullYear() + '' +
            String(d.getMonth() + 1).padStart(2, '0') +
            String(d.getDate()).padStart(2, '0') + '_' +
            String(d.getHours()).padStart(2, '0') +
            String(d.getMinutes()).padStart(2, '0');
    }

    function _getWinnerName(gd) {
        if (!gd) return 'El equipo';
        var players;
        if (gd.winnerTeam && gd.winnerTeam.players) {
            players = gd.winnerTeam.players;
        } else if (gd.winner && gd.teams) {
            players = gd.teams[gd.winner - 1].players;
        }
        if (!players) return 'El equipo';
        return players[0] + (players[1] ? ' y ' + players[1] : '');
    }

    function _showLoading(isLoading) {
        var loader = document.getElementById('share-loader');
        var content = document.getElementById('share-preview-wrap');
        if (loader)  loader.classList.toggle('hidden', !isLoading);
        if (content) content.classList.toggle('hidden', isLoading);
        if (_btnShare) _btnShare.disabled = isLoading;
        if (_btnSave)  _btnSave.disabled  = isLoading;
    }

    function _setStatus(msg, isError) {
        if (_shareStatus) {
            _shareStatus.textContent = msg;
            _shareStatus.style.color = isError ? '#ff6b6b' : '#2af0ff';
            _shareStatus.classList.remove('hidden');
            setTimeout(function () {
                _shareStatus.classList.add('hidden');
            }, 3500);
        }
    }

    // ═════════════════════════════════════════════════════════════════
    //  EXPORTACIÓN GLOBAL
    // ═════════════════════════════════════════════════════════════════

    window.DominoShare = {
        init: init,
        open: open,
        close: close,
    };

    console.log('[share] Módulo DominoShare listo ✓');

})();
