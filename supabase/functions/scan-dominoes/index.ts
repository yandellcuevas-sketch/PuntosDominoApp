/* ═══════════════════════════════════════════════════════════════════
   scan-dominoes — Supabase Edge Function
   ─────────────────────────────────────────────────────────────────
   Proxy seguro para Gemini Vision API.
   La API key NUNCA se expone al cliente.
   El cliente solo envía la imagen y recibe fichas detectadas.
   ═══════════════════════════════════════════════════════════════════ */

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const DOMINO_PROMPT = `You are an expert at recognizing dominó (domino) tiles in photographs.

Analyze this image of domino tiles placed face-up on a table.
For each visible tile, identify the two numbers (pips) on each half (0 to 6).
The value of a tile is the SUM of both halves.

Rules:
- A blank half = 0
- Double tiles (same number on both halves) are valid (e.g., 3|3 = 6)
- Only count clearly visible tiles — skip any that are face-down, cut off, or unreadable
- If a tile is partially obscured but you can still read both halves, include it
- Maximum possible value per tile is 12 (double-six: 6|6)

Respond ONLY with valid JSON. No markdown, no explanation, no code fences.
Use this exact format:
{
  "fichas": [
    {"lado1": 3, "lado2": 5, "valor": 8},
    {"lado1": 0, "lado2": 2, "valor": 2}
  ],
  "total": 10,
  "cantidad": 2,
  "confianza": "alta",
  "notas": ""
}

Confidence levels:
- "alta": all tiles clearly visible, good lighting
- "media": some tiles partially obscured or lighting is uneven
- "baja": many tiles hard to read, blurry, or poor conditions

If no domino tiles are found in the image, return:
{"fichas": [], "total": 0, "cantidad": 0, "confianza": "baja", "notas": "No se detectaron fichas de dominó en la imagen"}`;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
    // ── CORS preflight ───────────────────────────────────────────────
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: CORS_HEADERS });
    }

    // ── Validar método ───────────────────────────────────────────────
    if (req.method !== 'POST') {
        return Response.json(
            { error: 'Method not allowed' },
            { status: 405, headers: CORS_HEADERS }
        );
    }

    // ── Obtener API key del entorno (secreto de Supabase) ────────────
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
        console.error('[scan-dominoes] GEMINI_API_KEY not configured in Supabase secrets');
        return Response.json(
            { error: 'Servicio de escaneo no configurado. Contacta al administrador.' },
            { status: 503, headers: CORS_HEADERS }
        );
    }

    try {
        // ── Leer body ────────────────────────────────────────────────
        const body = await req.json();
        const { image, mimeType } = body;

        if (!image || typeof image !== 'string') {
            return Response.json(
                { error: 'No se recibió imagen.' },
                { status: 400, headers: CORS_HEADERS }
            );
        }

        // Validar tamaño aproximado del base64 (max ~10MB raw ≈ ~14MB base64)
        if (image.length > 15_000_000) {
            return Response.json(
                { error: 'Imagen demasiado grande. Intenta con menor resolución.' },
                { status: 413, headers: CORS_HEADERS }
            );
        }

        // ── Llamar a Gemini Vision API ───────────────────────────────
        const geminiResponse = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        {
                            inlineData: {
                                mimeType: mimeType || 'image/jpeg',
                                data: image,
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
        });

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            console.error('[scan-dominoes] Gemini API error:', geminiResponse.status, errText);
            return Response.json(
                { error: 'El servicio de IA no está disponible. Inténtalo de nuevo.' },
                { status: 502, headers: CORS_HEADERS }
            );
        }

        const geminiData = await geminiResponse.json();

        // ── Extraer texto de la respuesta ────────────────────────────
        const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        if (!rawText) {
            console.error('[scan-dominoes] Empty response from Gemini');
            return Response.json(
                { error: 'La IA no pudo analizar la imagen. Intenta con otra foto.' },
                { status: 502, headers: CORS_HEADERS }
            );
        }

        // ── Parsear JSON (robusto contra markdown fences) ────────────
        let jsonStr = rawText;

        // Quitar ```json ... ``` si viene envuelto
        const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) {
            jsonStr = fenceMatch[1];
        }

        // Buscar el primer objeto JSON completo
        const jsonObjMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (!jsonObjMatch) {
            console.error('[scan-dominoes] Could not find JSON in response:', rawText);
            return Response.json(
                { error: 'No se pudieron interpretar los resultados. Intenta con otra foto.' },
                { status: 502, headers: CORS_HEADERS }
            );
        }

        const parsed = JSON.parse(jsonObjMatch[0]);

        // ── Validar y sanear la respuesta ────────────────────────────
        const result = {
            fichas: Array.isArray(parsed.fichas) ? parsed.fichas.map((f: any) => ({
                lado1: _clampPip(f.lado1),
                lado2: _clampPip(f.lado2),
                valor: _clampPip(f.lado1) + _clampPip(f.lado2),
            })) : [],
            total: 0,
            cantidad: 0,
            confianza: ['alta', 'media', 'baja'].includes(parsed.confianza) ? parsed.confianza : 'media',
            notas: typeof parsed.notas === 'string' ? parsed.notas : '',
        };

        // Recalcular total y cantidad (no confiar en el modelo)
        result.cantidad = result.fichas.length;
        result.total = result.fichas.reduce((sum: number, f: any) => sum + f.valor, 0);

        return Response.json(result, {
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });

    } catch (e) {
        console.error('[scan-dominoes] Unhandled error:', e);

        // Distinguir errores de parseo JSON
        if (e instanceof SyntaxError) {
            return Response.json(
                { error: 'No se pudieron interpretar los resultados. Intenta con una foto más clara.' },
                { status: 502, headers: CORS_HEADERS }
            );
        }

        return Response.json(
            { error: 'Error interno del servidor.' },
            { status: 500, headers: CORS_HEADERS }
        );
    }
});

/** Asegura que un valor de pip esté entre 0 y 6 */
function _clampPip(val: any): number {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 0) return 0;
    if (n > 6) return 6;
    return n;
}
