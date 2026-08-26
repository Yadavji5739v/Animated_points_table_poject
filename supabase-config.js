/* ==============================================================
   SUPABASE CONFIGURATION & HELPERS
   - Initializes the Supabase JS client
   - Provides save/load/subscribe functions for overlay data
   - Falls back to localStorage when Supabase is unavailable
   ============================================================== */

const SB_PROJECT_URL = "https://nxckjhdhzumsdjvmvble.supabase.co";
const SB_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54Y2tqaGRoenVtc2Rqdm12YmxlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3MjE0NTcsImV4cCI6MjEwMzI5NzQ1N30.A95EAGVh2Np3YMmdZljEdZesyMEz-WXNviVquYfiY5M";
const SB_TABLE = "overlays";

let _sbClient = null;
let _sbReady = false;
let _sbInitPromise = null;

/**
 * Lazily load the Supabase JS client from CDN and initialise it.
 * Returns the client instance (or null if offline / CDN unreachable).
 */
function sbGetClient() {
  if (_sbClient) return Promise.resolve(_sbClient);
  if (_sbInitPromise) return _sbInitPromise;

  _sbInitPromise = new Promise((resolve) => {
    // If supabase was already loaded via <script> tag
    if (typeof supabase !== "undefined" && supabase.createClient) {
      _sbClient = supabase.createClient(SB_PROJECT_URL, SB_ANON_KEY);
      _sbReady = true;
      console.log("[Supabase] Client ready (pre-loaded)");
      resolve(_sbClient);
      return;
    }

    // Dynamically load from CDN
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
    script.onload = () => {
      if (typeof supabase !== "undefined" && supabase.createClient) {
        _sbClient = supabase.createClient(SB_PROJECT_URL, SB_ANON_KEY);
        _sbReady = true;
        console.log("[Supabase] Client ready (CDN)");
        resolve(_sbClient);
      } else {
        console.warn("[Supabase] CDN loaded but createClient not found");
        resolve(null);
      }
    };
    script.onerror = () => {
      console.warn("[Supabase] CDN unreachable — falling back to localStorage");
      resolve(null);
    };
    document.head.appendChild(script);
  });

  return _sbInitPromise;
}

/**
 * Generate a short 8-character alphanumeric ID.
 */
function sbGenerateId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Save an overlay payload to Supabase as a new row.
 * @param {Object} payload - The overlay data (title, teams[], mvp[], etc.)
 * @param {string} [sessionId] - Session ID representing the tournament/broadcast
 * @returns {Promise<{id: string}|null>} The newly created record's unique ID
 */
async function sbSaveOverlay(payload, sessionId) {
  try {
    const client = await sbGetClient();
    if (!client) return null;

    const id = sbGenerateId();
    const record = {
      id: id,
      session_id: sessionId || id,
      title: payload.title || "ESPORTS STANDINGS",
      teams: payload.teams || [],
      mvp: payload.mvp || [],
      created_at: new Date().toISOString()
    };

    const { data, error } = await client
      .from(SB_TABLE)
      .insert(record)
      .select("id")
      .single();

    if (error) {
      console.error("[Supabase] Save failed:", error.message);
      return null;
    }

    console.log("[Supabase] Inserted new overlay row:", data.id, "session:", sessionId);
    return { id: data.id };
  } catch (err) {
    console.error("[Supabase] Save error:", err);
    return null;
  }
}

/**
 * Add a new overlay row for the current session (called whenever a new file is uploaded).
 * Always inserts a brand new row with a fresh unique ID.
 * @param {string} sessionId - The current tournament session ID
 * @param {Object} payload - New overlay data
 * @returns {Promise<{id: string}|null>}
 */
async function sbUpdateOverlay(sessionId, payload) {
  try {
    const client = await sbGetClient();
    if (!client) return null;

    const id = sbGenerateId();
    const record = {
      id: id,
      session_id: sessionId,
      title: payload.title || "ESPORTS STANDINGS",
      teams: payload.teams || [],
      mvp: payload.mvp || [],
      created_at: new Date().toISOString()
    };

    const { data, error } = await client
      .from(SB_TABLE)
      .insert(record)
      .select("id")
      .single();

    if (error) {
      console.error("[Supabase] Insert new match row failed:", error.message);
      return null;
    }

    console.log("[Supabase] Added new row for session:", sessionId, "new row id:", data.id);
    return { id: data.id };
  } catch (err) {
    console.error("[Supabase] Insert error:", err);
    return null;
  }
}

/**
 * Load an overlay payload from Supabase by its short ID.
 * @param {string} id - The overlay's short ID
 * @returns {Promise<Object|null>} The overlay data or null
 */
async function sbLoadOverlay(id) {
  try {
    const client = await sbGetClient();
    if (!client) return null;

    const res = await client
      .from(SB_TABLE)
      .select("*")
      .eq("id", id)
      .limit(1);

    const data = res.data && res.data.length ? res.data[0] : null;

    if (res.error || !data) {
      console.warn("[Supabase] Load failed for id:", id, res.error?.message);
      return null;
    }

    return {
      id: data.id,
      title: data.title || "ESPORTS STANDINGS",
      teams: (data.teams || []).map(t => ({
        n: t.n || t.name || "",
        g: t.g || t.games || 0,
        b: t.b || t.booyah || 0,
        p: t.p || t.pos || 0,
        k: t.k || t.kills || 0,
        t: t.t || t.total || 0
      })),
      mvp: (data.mvp || []).map(m => ({
        name: m.name || "",
        team: m.team || "",
        kills: m.kills || 0,
        bestTeamRank: m.bestTeamRank || 999
      })),
      ts: data.created_at ? new Date(data.created_at).getTime() : Date.now()
    };
  } catch (err) {
    console.error("[Supabase] Load error:", err);
    return null;
  }
}

/**
 * Load an overlay payload from Supabase by its session ID.
 * Safely fetches the latest row for that session without failing on .single()
 * @param {string} sessionId - The session ID
 * @returns {Promise<Object|null>}
 */
async function sbLoadOverlayBySession(sessionId) {
  try {
    const client = await sbGetClient();
    if (!client) return null;

    // Try with order by created_at first
    let res = await client
      .from(SB_TABLE)
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (res.error) {
      // Fallback in case created_at column ordering fails
      res = await client
        .from(SB_TABLE)
        .select("*")
        .eq("session_id", sessionId)
        .limit(1);
    }

    const data = res.data && res.data.length ? res.data[0] : null;

    if (!data) {
      console.warn("[Supabase] Session load: no rows found for session:", sessionId);
      return null;
    }

    console.log("[Supabase] Successfully loaded session row:", data.id, "session:", sessionId);

    return {
      id: data.id,
      session_id: data.session_id,
      title: data.title || "ESPORTS STANDINGS",

      teams: (data.teams || []).map(t => ({
        n: t.n || t.name || "",
        g: t.g || t.games || 0,
        b: t.b || t.booyah || 0,
        p: t.p || t.pos || 0,
        k: t.k || t.kills || 0,
        t: t.t || t.total || 0
      })),

      mvp: (data.mvp || []).map(m => ({
        name: m.name || "",
        team: m.team || "",
        kills: m.kills || 0,
        bestTeamRank: m.bestTeamRank || 999
      })),

      ts: data.created_at
        ? new Date(data.created_at).getTime()
        : Date.now()
    };

  } catch (err) {
    console.error("[Supabase] Session load error:", err);
    return null;
  }
}

/**
 * Load the latest active overlay from Supabase across all sessions.
 * @returns {Promise<Object|null>}
 */
async function sbLoadLatestOverlay() {
  try {
    const client = await sbGetClient();
    if (!client) return null;

    let res = await client
      .from(SB_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);

    const data = res.data && res.data.length ? res.data[0] : null;
    if (!data) return null;

    console.log("[Supabase] Loaded latest active overlay:", data.id, "session:", data.session_id);

    return {
      id: data.id,
      session_id: data.session_id,
      title: data.title || "ESPORTS STANDINGS",
      teams: (data.teams || []).map(t => ({
        n: t.n || t.name || "",
        g: t.g || t.games || 0,
        b: t.b || t.booyah || 0,
        p: t.p || t.pos || 0,
        k: t.k || t.kills || 0,
        t: t.t || t.total || 0
      })),
      mvp: (data.mvp || []).map(m => ({
        name: m.name || "",
        team: m.team || "",
        kills: m.kills || 0,
        bestTeamRank: m.bestTeamRank || 999
      })),
      ts: data.created_at ? new Date(data.created_at).getTime() : Date.now()
    };
  } catch (err) {
    console.error("[Supabase] Load latest error:", err);
    return null;
  }
}

/**
 * Subscribe to realtime changes on a specific session_id.
 * When new data is inserted/updated, the callback fires with the payload.
 * @param {string} sessionId - Session ID to watch
 * @param {Function} callback - Called with the updated overlay data
 * @returns {Promise<Function|null>} Unsubscribe function, or null
 */
async function sbSubscribeToSession(sessionId, callback) {
  try {
    const client = await sbGetClient();
    if (!client) return null;

    const channel = client
      .channel(`overlay-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: SB_TABLE,
          filter: `session_id=eq.${sessionId}`
        },
        (payload) => {
          console.log("[Supabase] Realtime update:", payload.eventType);
          const data = payload.new;
          if (data && callback) {
            callback({
              id: data.id,
              title: data.title || "ESPORTS STANDINGS",
              teams: (data.teams || []).map(t => ({
                n: t.n || t.name || "",
                g: t.g || t.games || 0,
                b: t.b || t.booyah || 0,
                p: t.p || t.pos || 0,
                k: t.k || t.kills || 0,
                t: t.t || t.total || 0
              })),
              mvp: (data.mvp || []).map(m => ({
                name: m.name || "",
                team: m.team || "",
                kills: m.kills || 0,
                bestTeamRank: m.bestTeamRank || 999
              })),
              ts: new Date(data.created_at).getTime() || Date.now()
            });
          }
        }
      )
      .subscribe();

    console.log("[Supabase] Subscribed to session:", sessionId);

    // Return unsubscribe function
    return () => {
      client.removeChannel(channel);
    };
  } catch (err) {
    console.error("[Supabase] Subscribe error:", err);
    return null;
  }
}

/**
 * Delete overlay rows from Supabase (for a specific session or all).
 * @param {string} [sessionId] - Optional session ID to delete
 * @returns {Promise<boolean>}
 */
async function sbDeleteOverlays(sessionId) {
  try {
    const client = await sbGetClient();
    if (!client) return false;

    let query = client.from(SB_TABLE).delete();
    if (sessionId) {
      query = query.eq("session_id", sessionId);
    } else {
      query = query.neq("id", "___dummy___");
    }

    const { error } = await query;
    if (error) {
      console.error("[Supabase] Delete failed:", error.message);
      return false;
    }
    console.log("[Supabase] Deleted overlays from cloud for session:", sessionId || "all");
    return true;
  } catch (err) {
    console.error("[Supabase] Delete error:", err);
    return false;
  }
}

// Expose globally
window.sbGetClient = sbGetClient;
window.sbSaveOverlay = sbSaveOverlay;
window.sbUpdateOverlay = sbUpdateOverlay;
window.sbLoadOverlay = sbLoadOverlay;
window.sbLoadOverlayBySession = sbLoadOverlayBySession;
window.sbLoadLatestOverlay = sbLoadLatestOverlay;
window.sbSubscribeToSession = sbSubscribeToSession;
window.sbDeleteOverlays = sbDeleteOverlays;
window.sbGenerateId = sbGenerateId;