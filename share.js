/* ═══════════════════════════════════════════════════════════════════
   share.js — Módulo de Compartir Resultado  v3 (FINAL)
   ─────────────────────────────────────────────────────────────────
   Fase 3: Canvas Historia 1080×1920 + Selector de Formato +
           Permisos nativos iOS/Android + Texto enriquecido
   REGLAS DE ORO:
   • 100% aislado — no modifica state, no toca localStorage.
   • Solo usa datos del objeto `gameData` que recibe.
   • Canvas API puro — sin html2canvas ni dependencias.
   • Cadena nativa: Capacitor.Share → Web Share API → descarga web.
   • Cadena guardar: Capacitor.Filesystem (PHOTOS) → DOCUMENTS → descarga.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ── Paleta (alineada con style.css) ─────────────────────────────
    var C = {
        bg1:        '#07080d',
        bg2:        '#0d1020',
        bg3:        '#141826',
        neon:       '#2af0ff',
        neon2:      '#0095ff',
        gold:       '#f0b429',
        red:        '#ff5a5a',
        white:      '#eef0f6',
        dim:        '#9ba3b4',
        muted:      '#5c6475',
        winBg1:     'rgba(30,240,255,0.11)',
        winBg2:     'rgba(0,148,255,0.04)',
        winBorder:  'rgba(42,240,255,0.50)',
        loseBg1:    'rgba(255,90,90,0.07)',
        loseBg2:    'rgba(255,90,90,0.01)',
        loseBorder: 'rgba(255,90,90,0.28)',
        statBg:     'rgba(255,255,255,0.04)',
        statBorder: 'rgba(255,255,255,0.09)',
    };

    // ── Fuentes ──────────────────────────────────────────────────────
    var F = {
        display: "'Bebas Neue', Impact, sans-serif",
        body:    "'DM Sans', 'Segoe UI', sans-serif",
        mono:    "'JetBrains Mono', 'Courier New', monospace",
    };

    var LOGO_PATH = 'logodomino.png';

    // ── Estado interno ───────────────────────────────────────────────
    var _modal          = null;
    var _previewImg     = null;
    var _btnShare       = null;
    var _btnSave        = null;
    var _btnClose       = null;
    var _shareStatus    = null;
    var _radioFeed      = null;
    var _radioStory     = null;
    var _currentFormat  = 'feed';   // 'feed' | 'story'
    var _currentBlob    = null;
    var _currentDataURL = null;
    var _currentGameData = null;
    var _isRendering    = false;

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
        _radioFeed   = document.getElementById('share-fmt-feed');
        _radioStory  = document.getElementById('share-fmt-story');

        if (_btnClose) _btnClose.addEventListener('click', close);
        if (_btnShare) _btnShare.addEventListener('click', _share);
        if (_btnSave)  _btnSave.addEventListener('click',  _download);

        // Selector de formato
        if (_radioFeed) {
            _radioFeed.addEventListener('change', function () {
                if (_radioFeed.checked && _currentFormat !== 'feed') {
                    _currentFormat = 'feed';
                    _rerender();
                }
            });
        }
        if (_radioStory) {
            _radioStory.addEventListener('change', function () {
                if (_radioStory.checked && _currentFormat !== 'story') {
                    _currentFormat = 'story';
                    _rerender();
                }
            });
        }

        // Cerrar al hacer click en overlay
        if (_modal) {
            _modal.addEventListener('click', function (e) {
                if (e.target === _modal) close();
            });
        }

        console.log('[share] DominoShare v3 FINAL listo ✓');
    }

    // ═════════════════════════════════════════════════════════════════
    //  API PÚBLICA
    // ═════════════════════════════════════════════════════════════════

    function open(gameData) {
        if (!_modal) return;
        _currentGameData = gameData;
        _currentBlob     = null;
        _currentDataURL  = null;
        _currentFormat   = 'feed';

        // Resetear selector visual
        if (_radioFeed)  _radioFeed.checked  = true;
        if (_radioStory) _radioStory.checked = false;

        _showLoading(true);
        _modal.classList.remove('hidden');

        document.fonts.ready.then(function () {
            _renderFormat(_currentFormat, gameData);
        });
    }

    function close() {
        if (_modal) _modal.classList.add('hidden');
        if (_previewImg) _previewImg.classList.remove('share-img-visible');
        _currentBlob     = null;
        _currentDataURL  = null;
        _currentGameData = null;
        _isRendering     = false;
    }

    // ─────────────────────────────────────────────────────────────────
    //  Re-render al cambiar formato
    // ─────────────────────────────────────────────────────────────────

    function _rerender() {
        if (!_currentGameData || _isRendering) return;
        _currentBlob    = null;
        _currentDataURL = null;
        _showLoading(true);
        if (_previewImg) _previewImg.classList.remove('share-img-visible');
        document.fonts.ready.then(function () {
            _renderFormat(_currentFormat, _currentGameData);
        });
    }

    function _renderFormat(fmt, gd) {
        _isRendering = true;
        _loadLogo(function (logo) {
            try {
                var canvas;
                if (fmt === 'story') {
                    canvas = _drawStoryCard(gd, logo);
                } else {
                    canvas = _drawFeedCard(gd, logo);
                }
                canvas.toBlob(function (blob) {
                    _currentBlob    = blob;
                    _currentDataURL = canvas.toDataURL('image/png');
                    _isRendering = false;
                    if (_previewImg) {
                        _previewImg.classList.remove('share-img-visible');
                        _previewImg.src = _currentDataURL;
                        _previewImg.onload = function () {
                            _showLoading(false);
                            requestAnimationFrame(function () {
                                _previewImg.classList.add('share-img-visible');
                            });
                        };
                    } else {
                        _showLoading(false);
                    }
                }, 'image/png');
            } catch (err) {
                _isRendering = false;
                console.error('[share] Error al renderizar:', err);
                _setStatus('No se pudo generar la imagen.', true);
                _showLoading(false);
            }
        });
    }

    function _loadLogo(cb) {
        var logo = new Image();
        logo.crossOrigin = 'anonymous';
        logo.onload  = function () { cb(logo); };
        logo.onerror = function () { cb(null); };
        logo.src = LOGO_PATH;
    }

    // ═════════════════════════════════════════════════════════════════
    //  CANVAS A — FEED 1080×1080
    // ═════════════════════════════════════════════════════════════════

    function _drawFeedCard(gd, logo) {
        var W = 1080, H = 1080;
        var canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        var ctx = canvas.getContext('2d');

        _bg(ctx, W, H, 'rgba(42,240,255,0.08)', 'rgba(0,148,255,0.05)');
        _border(ctx, W, H, 28, 'rgba(42,240,255,0.28)', 3);
        _feedHeader(ctx, gd, logo, W);
        _dividerH(ctx, W, 96);
        _feedHeroScore(ctx, gd, W);
        _feedStats(ctx, gd, W);
        _footer(ctx, W, H);

        return canvas;
    }

    // ─── Feed Header ────────────────────────────────────────────────

    function _feedHeader(ctx, gd, logo, W) {
        var PAD = 44, LOGO_D = 48, cy = 48;
        var lx = PAD + LOGO_D / 2, ly = cy;

        ctx.save();
        // Halo logo
        var halo = ctx.createRadialGradient(lx, ly, 0, lx, ly, LOGO_D);
        halo.addColorStop(0, 'rgba(42,240,255,0.20)');
        halo.addColorStop(1, 'transparent');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(lx, ly, LOGO_D, 0, Math.PI * 2);
        ctx.fill();

        if (logo) {
            ctx.beginPath();
            ctx.arc(lx, ly, LOGO_D / 2, 0, Math.PI * 2);
            ctx.save(); ctx.clip();
            ctx.drawImage(logo, lx - LOGO_D / 2, ly - LOGO_D / 2, LOGO_D, LOGO_D);
            ctx.restore();
        }
        // Anillo
        ctx.beginPath();
        ctx.arc(lx, ly, LOGO_D / 2 + 1, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(42,240,255,0.55)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // App name
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = C.white;
        ctx.font = '700 27px ' + F.body;
        ctx.fillText('DOMINOSCORE PRO', W / 2, cy - 5);
        ctx.fillStyle = C.muted;
        ctx.font = '400 15px ' + F.body;
        ctx.fillText('Resultado Oficial de Partida', W / 2, cy + 16);

        // Fecha
        ctx.textAlign = 'right';
        ctx.fillStyle = C.dim;
        ctx.font = '500 16px ' + F.mono;
        ctx.fillText(_fmtShortDate(gd.endTime), W - PAD, cy + 5);

        ctx.restore();
    }

    // ─── Feed Hero Score ─────────────────────────────────────────────

    function _feedHeroScore(ctx, gd, W) {
        var dat = _extractTeams(gd);
        if (!dat) return;

        var topY  = 112;
        var totalH = 500;
        var GAP   = 16, PAD = 32;
        var winW  = Math.round((W - PAD * 2 - GAP) * 0.62);
        var loseW = W - PAD * 2 - GAP - winW;
        var winX  = PAD, loseX = PAD + winW + GAP;
        var R     = 22;

        // ─ Bloque GANADOR ──────────────────────────────────────────
        ctx.save();
        ctx.shadowColor = 'rgba(42,240,255,0.22)';
        ctx.shadowBlur  = 44;
        _rr(ctx, winX, topY, winW, totalH, R);
        var wg = ctx.createLinearGradient(winX, topY, winX, topY + totalH);
        wg.addColorStop(0, C.winBg1); wg.addColorStop(1, C.winBg2);
        ctx.fillStyle = wg; ctx.fill();
        ctx.shadowBlur = 0;

        _rr(ctx, winX, topY, winW, totalH, R);
        ctx.strokeStyle = C.winBorder; ctx.lineWidth = 1.5; ctx.stroke();

        // Acento top
        var ag = ctx.createLinearGradient(winX, 0, winX + winW, 0);
        ag.addColorStop(0, C.neon2); ag.addColorStop(1, C.neon);
        ctx.beginPath();
        ctx.moveTo(winX + R, topY + 2); ctx.lineTo(winX + winW - R, topY + 2);
        ctx.strokeStyle = ag; ctx.lineWidth = 3; ctx.stroke();

        // Corona
        _crown(ctx, winX + winW / 2, topY + 56, 20, C.gold);

        // Etiqueta GANADOR
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = C.neon;
        ctx.font = '700 17px ' + F.body;
        ctx.fillText('GANADOR', winX + winW / 2, topY + 98);

        // Nombres
        var wn = _fmtNames(dat.winner.players);
        ctx.fillStyle = C.white; ctx.font = '600 30px ' + F.body;
        ctx.fillText(_trunc(wn[0], 16), winX + winW / 2, topY + 148);
        if (wn[1]) {
            ctx.fillStyle = C.dim; ctx.font = '400 22px ' + F.body;
            ctx.fillText(_trunc(wn[1], 16), winX + winW / 2, topY + 180);
        }

        // Score grande
        ctx.save();
        ctx.shadowColor = C.neon; ctx.shadowBlur = 36;
        ctx.fillStyle = C.neon;
        ctx.font = '250px ' + F.display;
        ctx.fillText(String(dat.winner.score), winX + winW / 2, topY + 430);
        ctx.restore();
        ctx.fillStyle = 'rgba(42,240,255,0.42)';
        ctx.font = '700 20px ' + F.body;
        ctx.fillText('PTS', winX + winW / 2, topY + 460);
        ctx.restore();

        // ─ Bloque PERDEDOR ─────────────────────────────────────────
        ctx.save();
        _rr(ctx, loseX, topY, loseW, totalH, R);
        var rg = ctx.createLinearGradient(loseX, topY, loseX, topY + totalH);
        rg.addColorStop(0, C.loseBg1); rg.addColorStop(1, C.loseBg2);
        ctx.fillStyle = rg; ctx.fill();
        _rr(ctx, loseX, topY, loseW, totalH, R);
        ctx.strokeStyle = C.loseBorder; ctx.lineWidth = 1.5; ctx.stroke();

        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = C.muted;
        ctx.font = '400 18px ' + F.body;
        ctx.fillText('2.\u00b0', loseX + loseW / 2, topY + 58);

        ctx.fillStyle = C.red;
        ctx.font = '700 15px ' + F.body;
        ctx.fillText('SEGUNDO', loseX + loseW / 2, topY + 86);

        var ln = _fmtNames(dat.loser.players);
        ctx.fillStyle = C.dim; ctx.font = '500 22px ' + F.body;
        ctx.fillText(_trunc(ln[0], 13), loseX + loseW / 2, topY + 126);
        if (ln[1]) {
            ctx.fillStyle = C.muted; ctx.font = '400 17px ' + F.body;
            ctx.fillText(_trunc(ln[1], 13), loseX + loseW / 2, topY + 152);
        }

        ctx.save();
        ctx.fillStyle = C.red;
        ctx.font = '148px ' + F.display;
        ctx.fillText(String(dat.loser.score), loseX + loseW / 2, topY + 400);
        ctx.restore();
        ctx.fillStyle = 'rgba(255,90,90,0.38)';
        ctx.font = '600 15px ' + F.body;
        ctx.fillText('PTS', loseX + loseW / 2, topY + 426);

        if (gd.isLisa) _lisaBadge(ctx, loseX + loseW / 2, topY + totalH - 36, loseW - 24);

        ctx.restore();

        _dividerH(ctx, W, topY + totalH + 26);
    }

    // ─── Feed Stats ──────────────────────────────────────────────────

    function _feedStats(ctx, gd, W) {
        var topY = 660, PAD = 32, COLS = 4, GAP = 14;
        var bW = Math.floor((W - PAD * 2 - GAP * (COLS - 1)) / COLS);
        var bH = 124, R = 16;
        var sv = _statsValues(gd);
        var badges = [
            { label: 'DURACI\u00d3N', value: sv.dur,  accent: C.neon2 },
            { label: 'MANOS',     value: sv.hands, accent: C.neon  },
            { label: 'CAPIC\u00daAS', value: sv.capi, accent: C.gold  },
            { label: 'L\u00cdMITE',   value: sv.limit,accent: C.dim   },
        ];

        badges.forEach(function (b, i) {
            var bx = PAD + i * (bW + GAP), by = topY;
            ctx.save();
            _rr(ctx, bx, by, bW, bH, R);
            ctx.fillStyle = C.statBg; ctx.fill();
            _rr(ctx, bx, by, bW, bH, R);
            ctx.strokeStyle = C.statBorder; ctx.lineWidth = 1; ctx.stroke();

            // Línea de acento
            ctx.beginPath();
            ctx.moveTo(bx + R, by + 2); ctx.lineTo(bx + bW - R, by + 2);
            ctx.strokeStyle = b.accent; ctx.globalAlpha = 0.65;
            ctx.lineWidth = 2.5; ctx.stroke();
            ctx.globalAlpha = 1;

            ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = C.white;
            ctx.font = '700 38px ' + F.mono;
            ctx.fillText(String(b.value), bx + bW / 2, by + 72);

            ctx.fillStyle = C.muted;
            ctx.font = '500 13px ' + F.body;
            ctx.fillText(b.label, bx + bW / 2, by + 100);
            ctx.restore();
        });
    }

    // ═════════════════════════════════════════════════════════════════
    //  CANVAS B — HISTORIA 1080×1920
    // ═════════════════════════════════════════════════════════════════

    function _drawStoryCard(gd, logo) {
        var W = 1080, H = 1920;
        var canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        var ctx = canvas.getContext('2d');

        _storyBg(ctx, W, H);
        _border(ctx, W, H, 32, 'rgba(42,240,255,0.22)', 3);
        _storyHeader(ctx, gd, logo, W);
        _storyHeroScore(ctx, gd, W);
        _storyStats(ctx, gd, W);
        _storyCTA(ctx, W, H);

        return canvas;
    }

    // ─── Story Background ───────────────────────────────────────────

    function _storyBg(ctx, W, H) {
        // Fondo base
        var bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0,   '#07080d');
        bg.addColorStop(0.4, '#0b0f1e');
        bg.addColorStop(0.8, '#0d1020');
        bg.addColorStop(1,   '#050609');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

        // Halo superior cyan (logo/header area)
        var h1 = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.85);
        h1.addColorStop(0, 'rgba(42,240,255,0.10)');
        h1.addColorStop(1, 'transparent');
        ctx.fillStyle = h1; ctx.fillRect(0, 0, W, H);

        // Halo central izquierdo (marcador area)
        var h2 = ctx.createRadialGradient(0, H * 0.5, 0, 0, H * 0.5, W * 0.8);
        h2.addColorStop(0, 'rgba(0,148,255,0.07)');
        h2.addColorStop(1, 'transparent');
        ctx.fillStyle = h2; ctx.fillRect(0, 0, W, H);

        // Halo inferior (CTA area)
        var h3 = ctx.createRadialGradient(W / 2, H, 0, W / 2, H, W * 0.6);
        h3.addColorStop(0, 'rgba(42,240,255,0.06)');
        h3.addColorStop(1, 'transparent');
        ctx.fillStyle = h3; ctx.fillRect(0, 0, W, H);
    }

    // ─── Story Header ───────────────────────────────────────────────

    function _storyHeader(ctx, gd, logo, W) {
        var cy = 180, LOGO_D = 100;
        var lx = W / 2, ly = cy;

        ctx.save();
        // Halo detrás del logo
        var halo = ctx.createRadialGradient(lx, ly, 0, lx, ly, LOGO_D * 1.2);
        halo.addColorStop(0, 'rgba(42,240,255,0.18)');
        halo.addColorStop(1, 'transparent');
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(lx, ly, LOGO_D * 1.2, 0, Math.PI * 2); ctx.fill();

        if (logo) {
            ctx.beginPath(); ctx.arc(lx, ly, LOGO_D / 2, 0, Math.PI * 2);
            ctx.save(); ctx.clip();
            ctx.drawImage(logo, lx - LOGO_D / 2, ly - LOGO_D / 2, LOGO_D, LOGO_D);
            ctx.restore();
        }
        // Anillo
        ctx.beginPath(); ctx.arc(lx, ly, LOGO_D / 2 + 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(42,240,255,0.60)'; ctx.lineWidth = 2.5; ctx.stroke();

        // App name
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = C.white; ctx.font = '700 48px ' + F.body;
        ctx.fillText('DOMINOSCORE PRO', W / 2, cy + LOGO_D / 2 + 58);
        ctx.fillStyle = C.dim; ctx.font = '400 28px ' + F.body;
        ctx.fillText('Resultado Oficial de Partida', W / 2, cy + LOGO_D / 2 + 100);

        _dividerH(ctx, W, cy + LOGO_D / 2 + 128);
        ctx.restore();
    }

    // ─── Story Hero Score ───────────────────────────────────────────

    function _storyHeroScore(ctx, gd, W) {
        var dat = _extractTeams(gd);
        if (!dat) return;

        var PAD  = 60;
        var topY = 430;

        // ── Label "PARTIDA TERMINADA" ────────────────────────────────
        ctx.save();
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        var tg = ctx.createLinearGradient(W / 2 - 300, 0, W / 2 + 300, 0);
        tg.addColorStop(0, C.neon2); tg.addColorStop(1, C.neon);
        ctx.fillStyle = tg;
        ctx.font = '120px ' + F.display;
        ctx.fillText('PARTIDA', W / 2, topY);
        ctx.fillText('TERMINADA', W / 2, topY + 116);
        ctx.restore();

        if (gd.isLisa) {
            _lisaBadge(ctx, W / 2, topY + 166, 460);
        }

        var scoreTopY = gd.isLisa ? topY + 220 : topY + 166;

        // ── Bloque GANADOR (panel ancho) ────────────────────────────
        var bH = 480, R = 28;
        ctx.save();
        ctx.shadowColor = 'rgba(42,240,255,0.25)'; ctx.shadowBlur = 56;
        _rr(ctx, PAD, scoreTopY, W - PAD * 2, bH, R);
        var wg = ctx.createLinearGradient(PAD, scoreTopY, W - PAD, scoreTopY + bH);
        wg.addColorStop(0, C.winBg1); wg.addColorStop(1, C.winBg2);
        ctx.fillStyle = wg; ctx.fill(); ctx.shadowBlur = 0;
        _rr(ctx, PAD, scoreTopY, W - PAD * 2, bH, R);
        ctx.strokeStyle = C.winBorder; ctx.lineWidth = 2; ctx.stroke();

        // Acento top
        var ag = ctx.createLinearGradient(PAD, 0, W - PAD, 0);
        ag.addColorStop(0, C.neon2); ag.addColorStop(1, C.neon);
        ctx.beginPath();
        ctx.moveTo(PAD + R, scoreTopY + 2); ctx.lineTo(W - PAD - R, scoreTopY + 2);
        ctx.strokeStyle = ag; ctx.lineWidth = 4; ctx.stroke();

        // Corona
        _crown(ctx, W / 2, scoreTopY + 62, 28, C.gold);

        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = C.neon; ctx.font = '700 26px ' + F.body;
        ctx.fillText('GANADOR', W / 2, scoreTopY + 116);

        var wn = _fmtNames(dat.winner.players);
        ctx.fillStyle = C.white; ctx.font = '600 48px ' + F.body;
        ctx.fillText(_trunc(wn[0], 20), W / 2, scoreTopY + 178);
        if (wn[1]) {
            ctx.fillStyle = C.dim; ctx.font = '400 36px ' + F.body;
            ctx.fillText(_trunc(wn[1], 20), W / 2, scoreTopY + 224);
        }

        // Score masivo
        ctx.save();
        ctx.shadowColor = C.neon; ctx.shadowBlur = 48;
        ctx.fillStyle = C.neon; ctx.font = '340px ' + F.display;
        ctx.fillText(String(dat.winner.score), W / 2, scoreTopY + bH - 42);
        ctx.restore();
        ctx.restore();

        // ── Bloque PERDEDOR (panel secundario, debajo) ───────────────
        var lTopY = scoreTopY + bH + 24;
        var lH = 230;
        ctx.save();
        _rr(ctx, PAD, lTopY, W - PAD * 2, lH, R);
        var rg = ctx.createLinearGradient(PAD, lTopY, W - PAD, lTopY + lH);
        rg.addColorStop(0, C.loseBg1); rg.addColorStop(1, C.loseBg2);
        ctx.fillStyle = rg; ctx.fill();
        _rr(ctx, PAD, lTopY, W - PAD * 2, lH, R);
        ctx.strokeStyle = C.loseBorder; ctx.lineWidth = 1.5; ctx.stroke();

        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = C.red; ctx.font = '700 22px ' + F.body;
        ctx.fillText('SEGUNDO LUGAR', W / 2, lTopY + 46);

        var ln = _fmtNames(dat.loser.players);
        ctx.fillStyle = C.dim; ctx.font = '500 36px ' + F.body;
        ctx.fillText(_trunc(ln[0], 22) + (ln[1] ? '  &  ' + _trunc(ln[1], 14) : ''), W / 2, lTopY + 96);

        ctx.save();
        ctx.fillStyle = C.red; ctx.font = '120px ' + F.display;
        ctx.fillText(String(dat.loser.score), W / 2 - 70, lTopY + 196);
        ctx.fillStyle = 'rgba(255,90,90,0.40)'; ctx.font = '600 28px ' + F.body;
        ctx.fillText('PTS', W / 2 + 80, lTopY + 186);
        ctx.restore();

        ctx.restore();

        _dividerH(ctx, W, lTopY + lH + 36);
    }

    // ─── Story Stats ────────────────────────────────────────────────

    function _storyStats(ctx, gd, W) {
        var sv = _statsValues(gd);
        var PAD = 60, GAP = 20;
        var COLS = 2;
        var bW = Math.floor((W - PAD * 2 - GAP) / COLS);
        var bH = 180, R = 20;

        // Calcular topY dinámicamente basado en la historia
        var dat = _extractTeams(gd);
        var baseTopY = 430 + 166 + 480 + 24 + 230 + 36 + 32;
        if (dat && gd.isLisa) baseTopY += 54;
        var topY = baseTopY;

        var badges = [
            { label: 'DURACI\u00d3N',  value: sv.dur,   accent: C.neon2 },
            { label: 'MANOS',      value: sv.hands,  accent: C.neon  },
            { label: 'CAPIC\u00daAS',  value: sv.capi,  accent: C.gold  },
            { label: 'L\u00cdMITE',    value: sv.limit, accent: C.dim   },
        ];

        // 2 columnas × 2 filas
        badges.forEach(function (b, i) {
            var col = i % COLS, row = Math.floor(i / COLS);
            var bx = PAD + col * (bW + GAP);
            var by = topY + row * (bH + GAP);
            ctx.save();
            _rr(ctx, bx, by, bW, bH, R);
            ctx.fillStyle = C.statBg; ctx.fill();
            _rr(ctx, bx, by, bW, bH, R);
            ctx.strokeStyle = C.statBorder; ctx.lineWidth = 1; ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(bx + R, by + 3); ctx.lineTo(bx + bW - R, by + 3);
            ctx.strokeStyle = b.accent; ctx.globalAlpha = 0.70;
            ctx.lineWidth = 3.5; ctx.stroke();
            ctx.globalAlpha = 1;

            ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = C.white; ctx.font = '700 68px ' + F.mono;
            ctx.fillText(String(b.value), bx + bW / 2, by + 110);

            ctx.fillStyle = C.muted; ctx.font = '500 22px ' + F.body;
            ctx.fillText(b.label, bx + bW / 2, by + 150);
            ctx.restore();
        });
    }

    // ─── Story CTA (Call To Action) ─────────────────────────────────

    function _storyCTA(ctx, W, H) {
        var y = H - 100;
        _dividerH(ctx, W, y - 32);

        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = C.dim; ctx.font = '400 28px ' + F.body;
        ctx.fillText('dominoscore.app  ·  iOS & Android', W / 2, y - 4);

        ctx.fillStyle = C.muted; ctx.font = '400 22px ' + F.body;
        ctx.fillText('Registra tus partidas de domino', W / 2, y + 30);
    }

    // ═════════════════════════════════════════════════════════════════
    //  PRIMITIVAS COMPARTIDAS
    // ═════════════════════════════════════════════════════════════════

    function _bg(ctx, W, H, halo1, halo2) {
        var bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, C.bg1); bg.addColorStop(0.6, C.bg2); bg.addColorStop(1, C.bg3);
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        var h1 = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.75);
        h1.addColorStop(0, halo1); h1.addColorStop(1, 'transparent');
        ctx.fillStyle = h1; ctx.fillRect(0, 0, W, H);
        var h2 = ctx.createRadialGradient(W * 0.15, H, 0, W * 0.15, H, W * 0.6);
        h2.addColorStop(0, halo2); h2.addColorStop(1, 'transparent');
        ctx.fillStyle = h2; ctx.fillRect(0, 0, W, H);
    }

    function _border(ctx, W, H, r, color, lw) {
        _rr(ctx, 3, 3, W - 6, H - 6, r);
        ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
    }

    function _dividerH(ctx, W, y) {
        var grad = ctx.createLinearGradient(60, 0, W - 60, 0);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(0.3, 'rgba(42,240,255,0.22)');
        grad.addColorStop(0.7, 'rgba(0,148,255,0.18)');
        grad.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.moveTo(60, y); ctx.lineTo(W - 60, y);
        ctx.strokeStyle = grad; ctx.lineWidth = 1; ctx.stroke();
    }

    function _footer(ctx, W, H) {
        var y = H - 30;
        _dividerH(ctx, W, y - 22);
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = C.muted; ctx.font = '400 17px ' + F.body;
        ctx.fillText('DominoScorePro  \u00b7  dominoscore.app  \u00b7  iOS & Android', W / 2, y);
    }

    function _rr(ctx, x, y, w, h, r) {
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

    function _crown(ctx, cx, cy, s, color) {
        ctx.save(); ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(cx - s, cy + s * 0.4);
        ctx.lineTo(cx + s, cy + s * 0.4);
        ctx.lineTo(cx + s * 0.85, cy + s);
        ctx.lineTo(cx - s * 0.85, cy + s);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - s, cy + s * 0.4);
        ctx.lineTo(cx - s * 0.95, cy - s * 0.5);
        ctx.lineTo(cx - s * 0.4, cy);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.3, cy + s * 0.1);
        ctx.lineTo(cx, cy - s * 0.85);
        ctx.lineTo(cx + s * 0.3, cy + s * 0.1);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx + s, cy + s * 0.4);
        ctx.lineTo(cx + s * 0.95, cy - s * 0.5);
        ctx.lineTo(cx + s * 0.4, cy);
        ctx.closePath(); ctx.fill();
        ctx.restore();
    }

    function _lisaBadge(ctx, cx, cy, maxW) {
        var bw = Math.min(maxW, 380), bh = 50;
        ctx.save();
        _rr(ctx, cx - bw / 2, cy - bh / 2, bw, bh, 25);
        var g = ctx.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
        g.addColorStop(0, '#f0b429'); g.addColorStop(1, '#e08000');
        ctx.fillStyle = g; ctx.fill();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#07080d'; ctx.font = '700 21px ' + F.body;
        ctx.fillText('LISAAA  \u00b7  RIVAL EN 0', cx, cy);
        ctx.restore();
    }

    // ─── Utilidades de datos ────────────────────────────────────────

    function _extractTeams(gd) {
        if (!gd) return null;
        if (gd.winnerTeam) return { winner: gd.winnerTeam, loser: gd.loserTeam };
        if (gd.winner && gd.teams) {
            var wi = gd.winner - 1, li = gd.winner === 1 ? 1 : 0;
            return {
                winner: { players: gd.teams[wi].players, score: gd.teams[wi].score },
                loser:  { players: gd.teams[li].players, score: gd.teams[li].score },
            };
        }
        return null;
    }

    function _statsValues(gd) {
        var hands, capi;
        if (gd.hands && Array.isArray(gd.hands)) {
            hands = gd.hands.length;
            capi  = gd.hands.filter(function (h) { return h.capi; }).length;
        } else {
            hands = gd.hands;
            capi  = gd.capicuas;
        }
        return {
            dur:   _calcDur(gd.startTime, gd.endTime),
            hands: hands !== undefined ? hands : '\u2014',
            capi:  capi  !== undefined ? capi  : '\u2014',
            limit: gd.limit || '\u2014',
        };
    }

    function _fmtNames(players) {
        if (!players) return ['Equipo', null];
        return [players[0] || 'Jugador 1', players[1] || null];
    }

    function _trunc(str, max) {
        if (!str) return '';
        return str.length > max ? str.substring(0, max - 1) + '\u2026' : str;
    }

    function _calcDur(start, end) {
        if (!start || !end) return '\u2014';
        var ms = new Date(end) - new Date(start);
        if (isNaN(ms) || ms < 0) return '\u2014';
        var mins = Math.round(ms / 60000);
        if (mins < 1) return '< 1m';
        if (mins < 60) return mins + ' min';
        var h = Math.floor(mins / 60), m = mins % 60;
        return h + 'h' + (m ? ' ' + m + 'm' : '');
    }

    function _fmtShortDate(iso) {
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

    function _winnerName(gd) {
        if (!gd) return 'El equipo';
        var dat = _extractTeams(gd);
        if (!dat || !dat.winner || !dat.winner.players) return 'El equipo';
        var p = dat.winner.players;
        return p[0] + (p[1] ? ' y ' + p[1] : '');
    }

    // ─── Texto enriquecido para compartir ───────────────────────────

    function _shareText(gd) {
        if (!gd) return '\u00a1Partida de domin\u00f3 registrada con DominoScorePro!';
        var dat = _extractTeams(gd);
        if (!dat) return '\u00a1Partida de domin\u00f3 registrada con DominoScorePro!';
        var wName = _winnerName(gd);
        var wScore = dat.winner.score;
        var lScore = dat.loser.score;
        var sv = _statsValues(gd);
        var lisa = gd.isLisa ? ' \u00a1LISAAA!' : '';
        return '\u00a1' + wName + ' gan\u00f3 ' + wScore + '\u2013' + lScore + ' en ' + sv.hands + ' manos!' + lisa +
            '\nRegistrado con DominoScorePro \u2013 Disponible en iOS & Android.';
    }

    // ═════════════════════════════════════════════════════════════════
    //  COMPARTIR — Capacitor.Share → Web Share API → descarga web
    // ═════════════════════════════════════════════════════════════════

    function _share() {
        if (!_currentBlob && !_currentDataURL) {
            _setStatus('La imagen a\u00fan no est\u00e1 lista.', true);
            return;
        }
        var fmt      = _currentFormat;
        var filename = 'DominoScorePro_' + (fmt === 'story' ? 'Historia' : 'Feed') + '_' + _fileDate() + '.png';
        var text     = _shareText(_currentGameData);
        var b64      = _currentDataURL ? _currentDataURL.split(',')[1] : null;
        var Cap      = window.Capacitor;

        // 1. Capacitor nativo
        if (Cap && Cap.isNativePlatform && Cap.isNativePlatform()
            && Cap.Plugins && Cap.Plugins.Share) {
            Cap.Plugins.Share.share({
                title:       'DominoScorePro \u2014 Resultado',
                text:        text,
                dialogTitle: 'Compartir resultado',
                files:       b64 ? ['data:image/png;base64,' + b64] : undefined,
            }).then(function () {
                _setStatus('Compartido exitosamente.', false);
            }).catch(function (err) {
                if (!err || err.message !== 'Share canceled') {
                    _shareWebFallback(filename, text);
                }
            });
            return;
        }

        // 2. Web Share API
        _shareWebFallback(filename, text);
    }

    function _shareWebFallback(filename, text) {
        var blob = _currentBlob;
        if (navigator.share && navigator.canShare && blob) {
            var file = new File([blob], filename, { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
                navigator.share({ title: 'DominoScorePro', text: text, files: [file] })
                    .then(function () { _setStatus('Compartido.', false); })
                    .catch(function (err) {
                        if (err && err.name !== 'AbortError') _download();
                    });
                return;
            }
        }
        if (navigator.share) {
            navigator.share({ title: 'DominoScorePro', text: text })
                .catch(function () { _download(); });
            return;
        }
        _download();
    }

    // ═════════════════════════════════════════════════════════════════
    //  GUARDAR — Capacitor.Filesystem → descarga web
    // ═════════════════════════════════════════════════════════════════

    function _download() {
        if (!_currentDataURL) { _setStatus('La imagen a\u00fan no est\u00e1 lista.', true); return; }
        var fmt      = _currentFormat;
        var filename = 'DominoScorePro_' + (fmt === 'story' ? 'Historia' : 'Feed') + '_' + _fileDate() + '.png';
        var b64      = _currentDataURL.split(',')[1];
        var Cap      = window.Capacitor;

        if (Cap && Cap.isNativePlatform && Cap.isNativePlatform()
            && Cap.Plugins && Cap.Plugins.Filesystem) {
            var FS = Cap.Plugins.Filesystem;
            FS.writeFile({ path: filename, data: b64, directory: 'PHOTOS' })
                .then(function () { _setStatus('Imagen guardada en la galer\u00eda.', false); })
                .catch(function () {
                    FS.writeFile({ path: filename, data: b64, directory: 'DOCUMENTS' })
                        .then(function () { _setStatus('Imagen guardada en Documentos.', false); })
                        .catch(function () { _dlWeb(filename); });
                });
            return;
        }
        _dlWeb(filename);
    }

    function _dlWeb(filename) {
        var a = document.createElement('a');
        a.href = _currentDataURL; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        _setStatus('Imagen descargada.', false);
    }

    // ═════════════════════════════════════════════════════════════════
    //  UI helpers
    // ═════════════════════════════════════════════════════════════════

    function _showLoading(isLoading) {
        var loader  = document.getElementById('share-loader');
        var preview = document.getElementById('share-preview-wrap');
        if (loader)  loader.classList.toggle('hidden', !isLoading);
        if (preview) preview.classList.toggle('hidden', isLoading);
        if (_btnShare) _btnShare.disabled = isLoading;
        if (_btnSave)  _btnSave.disabled  = isLoading;
        // Ajustar ratio de preview según formato
        if (!isLoading && _previewImg) {
            _previewImg.classList.toggle('story-ratio', _currentFormat === 'story');
        }
    }

    function _setStatus(msg, isError) {
        if (!_shareStatus) return;
        _shareStatus.textContent = msg;
        _shareStatus.style.color = isError ? '#ff5a5a' : '#2af0ff';
        _shareStatus.classList.remove('hidden');
        setTimeout(function () { _shareStatus.classList.add('hidden'); }, 3800);
    }

    // ═════════════════════════════════════════════════════════════════
    //  EXPORTACIÓN
    // ═════════════════════════════════════════════════════════════════

    window.DominoShare = { init: init, open: open, close: close };
    console.log('[share] DominoShare v3 FINAL listo \u2713');

})();
