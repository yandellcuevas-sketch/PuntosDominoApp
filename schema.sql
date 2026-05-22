-- ═══════════════════════════════════════════════════════════════════
--  schema.sql — DominóScore
--  Arquitectura Local-First: Supabase solo para modo espectador
-- ═══════════════════════════════════════════════════════════════════
-- NOTA: Las tablas 'games' y 'profiles' se mantienen por compatibilidad
-- pero ya NO son parte del flujo principal de la app.
-- La app guarda todo localmente. Supabase solo se usa para spectator_rooms.

-- ─── TABLA PRINCIPAL: spectator_rooms (nueva) ───────────────────────
-- Solo contiene datos mínimos públicos del marcador.
-- No contiene datos personales, emails, passwords ni identificadores privados.

CREATE TABLE IF NOT EXISTS public.spectator_rooms (
    room_code    text PRIMARY KEY,
    user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    team_a_name  text NOT NULL DEFAULT '',
    team_b_name  text NOT NULL DEFAULT '',
    team_a_score integer NOT NULL DEFAULT 0,
    team_b_score integer NOT NULL DEFAULT 0,
    target_score integer NOT NULL DEFAULT 100,
    current_round integer NOT NULL DEFAULT 0,
    game_status  text NOT NULL DEFAULT 'active',
    updated_at   timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS para spectator_rooms
ALTER TABLE public.spectator_rooms ENABLE ROW LEVEL SECURITY;

-- Cualquiera puede VER una sala de espectador (datos públicos del marcador)
CREATE POLICY "Espectadores pueden ver cualquier sala"
    ON public.spectator_rooms FOR SELECT
    USING (true);

-- Cualquiera puede crear, actualizar o eliminar salas de espectador (necesario para evitar bloqueos por expiración de sesión o colisión de códigos)
CREATE POLICY "Cualquiera puede publicar salas"
    ON public.spectator_rooms FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Cualquiera puede actualizar salas"
    ON public.spectator_rooms FOR UPDATE
    USING (true);

CREATE POLICY "Cualquiera puede eliminar salas"
    ON public.spectator_rooms FOR DELETE
    USING (true);

-- Habilitar Realtime para spectator_rooms (espectadores en vivo)
ALTER PUBLICATION supabase_realtime ADD TABLE public.spectator_rooms;


-- ─── TABLAS LEGACY (mantenidas por compatibilidad, no usadas por la app) ─
-- La app ya no escribe en estas tablas.
-- Se dejan para no romper datos históricos.

CREATE TABLE IF NOT EXISTS public.games (
    id text PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    code text,
    data jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username text,
    avatar text,
    history jsonb DEFAULT '[]'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cualquiera puede ver las partidas"
    ON public.games FOR SELECT USING (true);
CREATE POLICY "Los usuarios pueden insertar/actualizar sus propias partidas"
    ON public.games FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Los usuarios pueden ver su propio perfil"
    ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Los usuarios pueden actualizar su propio perfil"
    ON public.profiles FOR ALL USING (auth.uid() = id);
