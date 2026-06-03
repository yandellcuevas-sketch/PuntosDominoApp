/* ═══════════════════════════════════════════════════════════════════
   scanner.js — Módulo de escaneo de fichas por IA
   ─────────────────────────────────────────────────────────────────
   REGLAS DE ORO:
   • Módulo 100% aislado — no modifica state, no toca localStorage.
   • Solo interactúa con el DOM del modal y el campo manual-pts.
   • La API key ahora se usa directamente en este archivo.
   • Si el escaneo falla, el usuario siempre puede continuar manualmente.
   • Compatible con Capacitor Camera (nativo) y <input file> (PWA).
   ═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ── Configuración ──────
    var GEMINI_API_KEY = 'AIzaSyAZlKA5aP_OtVRhKnarDSzrT_3GnCXQ4X8';
    var GEMINI_MODEL = 'gemini-1.5-flash-latest';
    var GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent';
    var MAX_IMAGE_SIZE = 1024; // px — máximo del lado más largo antes de enviar

    var DOMINO_PROMPT = "You are an expert at recognizing dominó (domino) tiles in photographs.\n\n" +
        "Analyze this image of domino tiles placed face-up on a table.\n" +
        "For each visible tile, identify the two numbers (pips) on each half (0 to 6).\n" +
        "The value of a tile is the SUM of both halves.\n\n" +
        "Rules:\n" +
        "- A blank half = 0\n" +
        "- Double tiles (same number on both halves) are valid (e.g., 3|3 = 6)\n" +
        "- Only count clearly visible tiles — skip any that are face-down, cut off, or unreadable\n" +
        "- If a tile is partially obscured but you can still read both halves, include it\n" +
        "- Maximum possible value per tile is 12 (double-six: 6|6)\n\n" +
        "Respond ONLY with valid JSON. No markdown, no explanation, no code fences.\n" +
        "Use this exact format:\n" +
        "{\n" +
        '  "fichas": [\n' +
        '    {"lado1": 3, "lado2": 5, "valor": 8},\n' +
        '    {"lado1": 0, "lado2": 2, "valor": 2}\n' +
        "  ],\n" +
        '  "total": 10,\n' +
        '  "cantidad": 2,\n' +
        '  "confianza": "alta",\n' +
        '  "notas": ""\n' +
        "}\n\n" +
        "Confidence levels:\n" +
        '- "alta": all tiles clearly visible, good lighting\n' +
        '- "media": some tiles partially obscured or lighting is uneven\n' +
        '- "baja": many tiles hard to read, blurry, or poor conditions\n\n' +
        "If no domino tiles are found in the image, return:\n" +
        '{"fichas": [], "total": 0, "cantidad": 0, "confianza": "baja", "notas": "No se detectaron fichas de dominó en la imagen"}';

    // ── Referencias DOM (cacheadas en init) ──────────────────────────
    var _modal = null;
    var _states = {};       // { idle, analyzing, result, error }
    var _previewImg = null;
    var _previewResult = null;
    var _fichasCount = null;
    var _fichasList = null;
    var _totalInput = null;
    var _confidence = null;
    var _errorMsg = null;
    var _scanNotes = null;

    // ── Estado interno ───────────────────────────────────────────────
    var _lastResult = null;
    var _lastImageSrc = null;

    // ═════════════════════════════════════════════════════════════════
    //  INICIALIZACIÓN
    // ═════════════════════════════════════════════════════════════════

    function init() {
        _cacheDOM();
        _bindEvents();
        console.log('[scanner] Módulo de escaneo inicializado ✓');
    }

    function _cacheDOM() {
        _modal         = document.getElementById('modal-scan');
        _states.idle      = document.getElementById('scan-state-idle');
        _states.analyzing = document.getElementById('scan-state-analyzing');
        _states.result    = document.getElementById('scan-state-result');
        _states.error     = document.getElementById('scan-state-error');
        _previewImg    = document.getElementById('scan-preview');
        _previewResult = document.getElementById('scan-preview-result');
        _fichasCount   = document.getElementById('scan-fichas-count');
        _fichasList    = document.getElementById('scan-fichas-list');
        _totalInput    = document.getElementById('scan-total-pts');
        _confidence    = document.getElementById('scan-confidence');
        _errorMsg      = document.getElementById('scan-error-msg');
        _scanNotes     = document.getElementById('scan-notes');
    }

    function _bindEvents() {
        var btnCamera  = document.getElementById('scan-btn-camera');
        var btnGallery = document.getElementById('scan-btn-gallery');
        var btnRetake  = document.getElementById('scan-btn-retake');
        var btnConfirm = document.getElementById('scan-btn-confirm');
        var btnClose   = document.getElementById('scan-btn-close');
        var btnManual  = document.getElementById('scan-btn-manual');
        var btnRetry   = document.getElementById('scan-btn-retry');
        var btnErrManual = document.getElementById('scan-btn-error-manual');

        if (btnCamera)   btnCamera.addEventListener('click', function () { _capture('CAMERA'); });
        if (btnGallery)  btnGallery.addEventListener('click', function () { _capture('PHOTOS'); });
        if (btnRetake)   btnRetake.addEventListener('click', function () { _showState('idle'); });
        if (btnConfirm)  btnConfirm.addEventListener('click', _confirm);
        if (btnClose)    btnClose.addEventListener('click', close);
        if (btnManual)   btnManual.addEventListener('click', _closeAndFocusManual);
        if (btnRetry)    btnRetry.addEventListener('click', function () { _showState('idle'); });
        if (btnErrManual) btnErrManual.addEventListener('click', _closeAndFocusManual);

        // Cerrar modal al hacer click fuera de la card
        if (_modal) {
            _modal.addEventListener('click', function (e) {
                if (e.target === _modal) close();
            });
        }
    }

    // ═════════════════════════════════════════════════════════════════
    //  ABRIR / CERRAR MODAL
    // ═════════════════════════════════════════════════════════════════

    function open() {
        if (!_modal) return;
        _lastResult = null;
        _lastImageSrc = null;
        _showState('idle');
        _modal.classList.remove('hidden');
    }

    function close() {
        if (!_modal) return;
        _modal.classList.add('hidden');
    }

    // ═════════════════════════════════════════════════════════════════
    //  CAPTURA DE FOTO
    // ═════════════════════════════════════════════════════════════════

    async function _capture(source) {
        try {
            var imageData = null;

            // Ruta 1: Capacitor Camera (nativo Android/iOS)
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera) {
                var Camera = window.Capacitor.Plugins.Camera;
                try {
                    var photo = await Camera.getPhoto({
                        quality: 85,
                        allowEditing: false,
                        resultType: 'base64',
                        source: source, // 'CAMERA' o 'PHOTOS'
                        width: MAX_IMAGE_SIZE,
                        height: MAX_IMAGE_SIZE,
                        correctOrientation: true,
                    });
                    imageData = {
                        base64: photo.base64String,
                        mimeType: 'image/' + (photo.format || 'jpeg'),
                    };
                } catch (camErr) {
                    // El usuario canceló o denegó permisos
                    if (camErr.message && camErr.message.includes('cancel')) return;
                    if (camErr.message && camErr.message.includes('denied')) {
                        _showError('Se necesitan permisos de cámara. Actívalos en Configuración.');
                        return;
                    }
                    throw camErr;
                }
            } else {
                // Ruta 2: PWA / Web — <input type="file">
                imageData = await _captureWeb(source);
            }

            if (!imageData || !imageData.base64) return;

            // Mostrar preview
            _lastImageSrc = 'data:' + imageData.mimeType + ';base64,' + imageData.base64;
            if (_previewImg) _previewImg.src = _lastImageSrc;
            if (_previewResult) _previewResult.src = _lastImageSrc;

            // Redimensionar antes de enviar (reduce ancho de banda)
            var resized = await _resizeImage(imageData.base64, imageData.mimeType, MAX_IMAGE_SIZE);

            // Analizar con IA
            _showState('analyzing');
            var result = await _analyze(resized.base64, resized.mimeType);

            _lastResult = result;
            _renderResult(result);
            _showState('result');

        } catch (e) {
            console.error('[scanner] Error en captura/análisis:', e);
            _showError(e.message || 'Error al procesar la imagen. Intenta de nuevo.');
        }
    }

    /**
     * Fallback web: abre un <input type="file"> que en móvil
     * abre la cámara o la galería.
     */
    function _captureWeb(source) {
        return new Promise(function (resolve) {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            // Si quiere cámara, usar capture="environment" (cámara trasera)
            if (source === 'CAMERA') {
                input.setAttribute('capture', 'environment');
            }
            input.style.display = 'none';
            document.body.appendChild(input);

            input.onchange = function (e) {
                var file = e.target.files && e.target.files[0];
                document.body.removeChild(input);
                if (!file) { resolve(null); return; }

                var reader = new FileReader();
                reader.onload = function (ev) {
                    var dataUrl = ev.target.result;
                    var base64 = dataUrl.split(',')[1];
                    resolve({ base64: base64, mimeType: file.type || 'image/jpeg' });
                };
                reader.onerror = function () { resolve(null); };
                reader.readAsDataURL(file);
            };

            // Si el usuario cierra sin seleccionar archivo
            input.addEventListener('cancel', function () {
                document.body.removeChild(input);
                resolve(null);
            });

            input.click();
        });
    }

    // ═════════════════════════════════════════════════════════════════
    //  REDIMENSIONAR IMAGEN (client-side, reduce bandwidth)
    // ═════════════════════════════════════════════════════════════════

    function _resizeImage(base64, mimeType, maxSize) {
        return new Promise(function (resolve) {
            var img = new Image();
            img.onload = function () {
                var w = img.width, h = img.height;
                // Si ya es pequeña, no redimensionar
                if (w <= maxSize && h <= maxSize) {
                    resolve({ base64: base64, mimeType: mimeType });
                    return;
                }
                var scale = maxSize / Math.max(w, h);
                var nw = Math.round(w * scale);
                var nh = Math.round(h * scale);
                var canvas = document.createElement('canvas');
                canvas.width = nw;
                canvas.height = nh;
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, nw, nh);
                var resizedDataUrl = canvas.toDataURL(mimeType || 'image/jpeg', 0.85);
                var resizedBase64 = resizedDataUrl.split(',')[1];
                resolve({ base64: resizedBase64, mimeType: mimeType || 'image/jpeg' });
            };
            img.onerror = function () {
                // Si falla la carga, enviar tal cual
                resolve({ base64: base64, mimeType: mimeType });
            };
            img.src = 'data:' + (mimeType || 'image/jpeg') + ';base64,' + base64;
        });
    }

    // ═════════════════════════════════════════════════════════════════
    //  LLAMADA A GEMINI VISION API (Directa)
    // ═════════════════════════════════════════════════════════════════

    async function _analyze(base64, mimeType) {
        // Verificar conexión
        if (!navigator.onLine) {
            throw new Error('Sin conexión a internet. El escaneo requiere conexión.');
        }

        var response = await Promise.race([
            fetch(GEMINI_URL + '?key=' + GEMINI_API_KEY, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            {
                                inlineData: {
                                    mimeType: mimeType || 'image/jpeg',
                                    data: base64,
                                },
                            },
                            { text: DOMINO_PROMPT },
                        ],
                    }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 2048,
                    },
                }),
            }),
            new Promise(function (_, reject) {
                setTimeout(function () {
                    reject(new Error('Tiempo de espera agotado. Intenta de nuevo.'));
                }, 30000); // 30s timeout
            }),
        ]);

        if (!response.ok) {
            var errBody = null;
            try { errBody = await response.json(); } catch (e) { /* ignore */ }
            var errMsg = (errBody && errBody.error && errBody.error.message) || 'Error del servidor (' + response.status + ')';
            throw new Error(errMsg);
        }

        var geminiData = await response.json();

        var rawText = geminiData && geminiData.candidates && geminiData.candidates[0] && geminiData.candidates[0].content && geminiData.candidates[0].content.parts && geminiData.candidates[0].content.parts[0] && geminiData.candidates[0].content.parts[0].text;
        
        if (!rawText) {
            throw new Error('La IA no pudo analizar la imagen. Intenta con otra foto.');
        }
        
        var jsonStr = rawText;
        var fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) {
            jsonStr = fenceMatch[1];
        }

        var jsonObjMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (!jsonObjMatch) {
            throw new Error('No se pudieron interpretar los resultados. Intenta con otra foto.');
        }

        var data;
        try {
            data = JSON.parse(jsonObjMatch[0]);
        } catch(e) {
            throw new Error('No se pudieron interpretar los resultados. Intenta con una foto más clara.');
        }

        // Validar estructura mínima
        if (!data || !Array.isArray(data.fichas)) {
            throw new Error('Respuesta inesperada del servidor.');
        }

        // Recalcular total y cantidad por seguridad
        data.cantidad = data.fichas.length;
        data.total = data.fichas.reduce(function(sum, f) { return sum + (f.valor || 0); }, 0);

        return data;
    }

    // ═════════════════════════════════════════════════════════════════
    //  RENDERIZAR RESULTADO
    // ═════════════════════════════════════════════════════════════════

    function _renderResult(data) {
        if (!data) return;

        // Cantidad de fichas
        if (_fichasCount) {
            _fichasCount.textContent = data.cantidad + ' ficha' + (data.cantidad !== 1 ? 's' : '') + ' detectada' + (data.cantidad !== 1 ? 's' : '');
        }

        // Confianza
        if (_confidence) {
            _confidence.textContent = data.confianza || 'media';
            _confidence.className = 'scan-confidence conf-' + (data.confianza || 'media');
        }

        // Lista de fichas
        if (_fichasList) {
            if (data.fichas.length === 0) {
                _fichasList.innerHTML = '<p class="scan-empty">No se detectaron fichas en la imagen.</p>';
            } else {
                var html = '';
                data.fichas.forEach(function (f, i) {
                    html += '<div class="scan-ficha-item">' +
                        '<span class="scan-ficha-dots">' + _renderDots(f.lado1) + '|' + _renderDots(f.lado2) + '</span>' +
                        '<span class="scan-ficha-val">= ' + f.valor + '</span>' +
                        '</div>';
                });
                _fichasList.innerHTML = html;
            }
        }

        // Total (editable)
        if (_totalInput) {
            _totalInput.value = data.total || 0;
        }

        // Notas
        if (_scanNotes) {
            if (data.notas) {
                _scanNotes.textContent = data.notas;
                _scanNotes.style.display = 'block';
            } else {
                _scanNotes.style.display = 'none';
            }
        }
    }

    /**
     * Convierte un número 0-6 en representación visual para la ficha.
     */
    function _renderDots(n) {
        if (n === 0) return '⬜';
        return String(n);
    }

    // ═════════════════════════════════════════════════════════════════
    //  CONFIRMAR RESULTADO → RELLENAR FORMULARIO
    // ═════════════════════════════════════════════════════════════════

    function _confirm() {
        var pts = 0;

        // Tomar el valor del input (pudo haber sido editado por el usuario)
        if (_totalInput) {
            pts = parseInt(_totalInput.value, 10);
            if (isNaN(pts) || pts < 0) pts = 0;
        }

        // Rellenar el campo manual-pts del formulario principal
        var manualInput = document.getElementById('manual-pts');
        if (manualInput) {
            manualInput.value = pts;
            // Trigger visual feedback
            manualInput.classList.add('scan-filled');
            setTimeout(function () { manualInput.classList.remove('scan-filled'); }, 1500);
        }

        // Cerrar modal
        close();

        // Vibrar si está disponible
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) {
            try { window.Capacitor.Plugins.Haptics.impact({ style: 'Light' }); } catch (e) { }
        }
    }

    function _closeAndFocusManual() {
        close();
        var manualInput = document.getElementById('manual-pts');
        if (manualInput) {
            manualInput.focus();
        }
    }

    // ═════════════════════════════════════════════════════════════════
    //  GESTIÓN DE ESTADOS DEL MODAL
    // ═════════════════════════════════════════════════════════════════

    function _showState(stateName) {
        Object.keys(_states).forEach(function (key) {
            if (_states[key]) {
                _states[key].classList.toggle('hidden', key !== stateName);
            }
        });
    }

    function _showError(msg) {
        if (_errorMsg) _errorMsg.textContent = msg || 'Error desconocido.';
        _showState('error');
    }

    // ═════════════════════════════════════════════════════════════════
    //  EXPORTACIÓN GLOBAL
    // ═════════════════════════════════════════════════════════════════
    window.DominoScanner = {
        init: init,
        open: open,
        close: close,
    };

    console.log('[scanner] Módulo de escaneo cargado ✓');
})();
