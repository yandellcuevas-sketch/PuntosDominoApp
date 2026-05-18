const SUPABASE_URL = 'https://zfrthbupraufxhgbmgmh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_VcuOeLUk127F4UvAchf1Xw_s_xVA-VR';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let currentUser = null;

// ─── Autenticación Visual ─────────────────────
async function doLogin(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user;
    return data.user;
}

async function doRegister(email, password) {
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) throw error;
    currentUser = data.user;
    return data.user;
}

async function doGuestLogin() {
    const { data, error } = await supabaseClient.auth.signInAnonymously();
    if (error) throw error;
    currentUser = data.user;
    return data.user;
}

async function doLogout() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    currentUser = null;
}

// ─── Splash Screen ───────────────────────────
function hideSplash() {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.add('hide');
        setTimeout(() => splash.remove(), 700);
    }
}

// Chequear sesión al cargar
async function initSupabaseAuth() {
    const startTime = Date.now();
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        currentUser = session.user;
        if (typeof window.onSessionRestored === 'function') {
            window.onSessionRestored();
        }
    }
    // Esperar al menos 2.2s para que se vea la animación completa
    const elapsed = Date.now() - startTime;
    const minDelay = 2200;
    const remaining = Math.max(0, minDelay - elapsed);
    setTimeout(hideSplash, remaining);
}
initSupabaseAuth();

// ─── Funciones de Persistencia Online (Supabase) ───────────────────
async function fb_saveGame(gameData) {
    if (!gameData || !gameData.id) return;
    
    let { data: { session } } = await supabaseClient.auth.getSession();
    let user = session?.user;
    
    if (!user) { 
        // Login de emergencia si el navegador lo borró por error
        console.warn("Sesión perdida. Intentando login de emergencia...");
        const res = await supabaseClient.auth.signInAnonymously();
        if (res.data && res.data.user) {
            user = res.data.user;
        } else {
            alert("Error fatal: Supabase rechazó la conexión anónima. ¿Están activados los invitados en el panel?"); 
            return; 
        }
    }
    
    try {
        const { error } = await supabaseClient
            .from('games')
            .upsert({ 
                id: gameData.id, 
                user_id: user.id,
                code: gameData.code,
                data: gameData,
                updated_at: new Date().toISOString()
            });
            
        if (error) {
            console.error('Error saving game to Supabase:', error);
            alert("Error al guardar la partida en la nube: " + error.message);
        }
    } catch (e) {
        console.error('Network error saving game:', e);
        alert("Error de red al guardar la partida en la nube: " + e.message);
    }
}

async function fb_saveHistory(historyData) {
    if (!historyData) return;
    
    const { data: { session } } = await supabaseClient.auth.getSession();
    const user = session?.user;
    if (!user) return;
    
    try {
        const { error } = await supabaseClient
            .from('profiles')
            .upsert({ 
                id: user.id,
                history: historyData,
                updated_at: new Date().toISOString()
            });
            
        if (error) console.error('Error saving history to Supabase:', error);
    } catch (e) {
        console.error('Network error saving history:', e);
    }
}

let currentGameSubscription = null;

function fb_setRoomCode(code) {
    if (currentGameSubscription) {
        supabaseClient.removeChannel(currentGameSubscription);
    }
    
    // Obtener estado actual primero (para espectadores que acaban de entrar)
    supabaseClient
        .from('games')
        .select('data')
        .eq('code', code)
        .maybeSingle()
        .then(({ data, error }) => {
            if (error) {
                console.warn("No se pudo cargar la partida inicial:", error.message);
            }
            if (!error && data && data.data && typeof window.fb_onGameChangeCallback === 'function') {
                window.fb_onGameChangeCallback(data.data);
            } else if (typeof window.fb_onGameChangeCallback === 'function') {
                // Notificar a la UI que no se encontró para que muestre el mensaje rojo
                window.fb_onGameChangeCallback(null);
            }
        });
    
    currentGameSubscription = supabaseClient.channel('custom-all-channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'games', filter: `code=eq.${code}` },
        (payload) => {
          if (payload.new && payload.new.data && typeof window.fb_onGameChangeCallback === 'function') {
              window.fb_onGameChangeCallback(payload.new.data);
          }
        }
      )
      .subscribe();
}

function fb_onGameChange(callback) {
    window.fb_onGameChangeCallback = callback;
}

// ─── Guardar Perfil en Supabase ─────────────────
async function fb_saveProfile(username, avatar) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const user = session?.user;
    if (!user) return;
    
    try {
        const { error } = await supabaseClient
            .from('profiles')
            .upsert({ 
                id: user.id,
                username: username,
                avatar: avatar,
                updated_at: new Date().toISOString()
            });
            
        if (error) console.error('Error saving profile to Supabase:', error);
    } catch (e) {
        console.error('Network error saving profile:', e);
    }
}

// ─── Obtener Perfil de Supabase ─────────────────
async function fb_getProfile() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const user = session?.user;
    if (!user) return null;
    
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('username, avatar, history')
            .eq('id', user.id)
            .maybeSingle();
            
        if (error) {
            console.error('Error fetching profile from Supabase:', error);
            return null;
        }
        return data;
    } catch (e) {
        console.error('Network error fetching profile:', e);
        return null;
    }
}

