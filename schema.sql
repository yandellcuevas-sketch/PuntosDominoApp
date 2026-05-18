-- 1. Crear tabla 'games' para guardar las partidas activas e historiales
CREATE TABLE public.games (
    id text PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    code text,
    data jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Crear tabla 'profiles' para guardar el perfil y estadísticas generales del usuario
CREATE TABLE public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username text,
    avatar text,
    history jsonb DEFAULT '[]'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Configurar Row Level Security (RLS) para que cada usuario solo vea sus datos
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Políticas para 'games'
-- PERMITE A LOS ESPECTADORES VER LA PARTIDA
CREATE POLICY "Cualquiera puede ver las partidas" 
    ON public.games FOR SELECT 
    USING (true);

CREATE POLICY "Los usuarios pueden insertar/actualizar sus propias partidas" 
    ON public.games FOR ALL 
    USING (auth.uid() = user_id);

-- Políticas para 'profiles'
CREATE POLICY "Los usuarios pueden ver su propio perfil" 
    ON public.profiles FOR SELECT 
    USING (auth.uid() = id);

CREATE POLICY "Los usuarios pueden actualizar su propio perfil" 
    ON public.profiles FOR ALL 
    USING (auth.uid() = id);

-- 4. Habilitar el modo tiempo real (Realtime) para la tabla games (útil para el modo espectador)
alter publication supabase_realtime add table public.games;
