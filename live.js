/* ==============================================================
   LIVE OVERLAY LOGIC
   ============================================================== */

let ffOverlayData = null;
let ffPrevRects = null; // for FLIP re-order animation on replay
let ffEntranceTimeline = null;
let ffPrevMaxGames = 0; // track previous max games to detect 6-match completion
let ffPendingShowMVP = false; // when true, show MVP after return to standings
let ffState = "standings"; // 'standings' | 'champion' | 'mvp'
let ffPrevOverlayCount = 0; // track number of stored overlay payloads (files uploaded)
let ffSpecialSixFlow = false; // true when 6-match / 6-files special flow is active
const FF_MVP_STORAGE_KEY = "ff_mvp_players";

/* ---------------- URL parsing ---------------- */
async function ffParseHash() {
  const queryParams = new URLSearchParams(window.location.search);
  const searchD = queryParams.get("d");
  const hash = window.location.hash.replace(/^#/, "");
  const hashParams = new URLSearchParams(hash);
  const hashD = hashParams.get("d");
  const d = searchD || hashD;
  const id = hashParams.get("id") || queryParams.get("id");
  const session = queryParams.get("session");
  const sbid = queryParams.get("sbid") || hashParams.get("sbid");

  // 1. Try Supabase short ID or session first
  if (sbid && typeof sbLoadOverlay === "function") {
    try {
      const sbData = await sbLoadOverlay(sbid);
      if (sbData) {
        console.log("[Live] Loaded from Supabase sbid:", sbid);
        _ffSeedLocalStorage(sbData, session || sbid);
        return sbData;
      }
    } catch (e) {
      console.warn("[Live] Supabase load failed, falling back", e);
    }
  }

  if (session && typeof sbLoadOverlayBySession === "function") {
    try {
      const sbData = await sbLoadOverlayBySession(session);
      if (sbData) {
        console.log("[Live] Loaded from Supabase session:", session);
        _ffSeedLocalStorage(sbData, session);
        return sbData;
      }
    } catch (e) {
      console.warn("[Live] Supabase session load failed, falling back", e);
    }
  }

  // Fallback: Load latest active overlay from Supabase
  if (typeof sbLoadLatestOverlay === "function") {
    try {
      const sbData = await sbLoadLatestOverlay();
      if (sbData) {
        console.log("[Live] Loaded latest active session from Supabase:", sbData.session_id);
        _ffSeedLocalStorage(sbData, session || sbData.session_id);
        return sbData;
      }
    } catch (e) {}
  }

  if (d) {
    try { return ffDecodePayload(d); } catch (e) { console.error("Bad overlay payload", e); }
  }
  const storeKey = typeof FF_OVERLAYS_KEY !== "undefined" ? FF_OVERLAYS_KEY : "ff_overlays_v1";
  if (session) {
    try {
      const store = JSON.parse(localStorage.getItem(storeKey) || "{}");
      if (store[session]) return store[session];
    } catch(e) {}
  }
  if (id) {
    try {
      const store = JSON.parse(localStorage.getItem(storeKey) || "{}");
      if (store[id]) return store[id];
    } catch(e) {}
  }
  if (typeof ffGetLatestOverlayData === "function") {
    const latest = ffGetLatestOverlayData();
    if (latest) return latest;
  }
  return null;
}

/** Seed localStorage from Supabase data so all existing features still work */
function _ffSeedLocalStorage(data, sessionId) {
  try {
    const store = JSON.parse(localStorage.getItem(FF_OVERLAYS_KEY) || "{}");
    store[sessionId] = data;
    localStorage.setItem(FF_OVERLAYS_KEY, JSON.stringify(store));

    if (data.teams && data.teams.length) {
      const teamsData = {};
      data.teams.forEach(team => {
        const name = team.n || "UNKNOWN TEAM";
        teamsData[name] = {
          name,
          booyah: team.b || 0,
          games: team.g || 0,
          kills: team.k || 0,
          pos: team.p || 0,
          total: team.t || 0
        };
      });
      localStorage.setItem("ff_teams_data", JSON.stringify(teamsData));
    }

    if (data.title) {
      const parts = data.title.split(" ");
      localStorage.setItem("ff_overlay_title", JSON.stringify({
        main: parts[0] || data.title,
        sub: parts.slice(1).join(" ") || ""
      }));
    }

    if (sessionId) {
      localStorage.setItem("ff_live_session_v1", JSON.stringify({
        id: sessionId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
      }));
    }
  } catch (e) {
    console.warn("[Live] localStorage seed failed", e);
  }
}

function ffQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function ffGetLatestStoredOverlay() {
  try {
    const store = JSON.parse(localStorage.getItem(FF_OVERLAYS_KEY) || "{}");
    if (!store || typeof store !== "object") return null;
    const entries = Object.values(store).filter(entry => entry && Array.isArray(entry.teams));
    if (!entries.length) return null;
    return entries.sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
  } catch (err) {
    return null;
  }
}

function ffUpdateOverlayFromSession() {
  const session = ffQueryParam("session");
  if (!session) return;

  const store = JSON.parse(localStorage.getItem(FF_OVERLAYS_KEY) || "{}");
  const latest = store[session];
  if (!latest) return;

  ffOverlayData = latest;
  ffRenderRows(ffOverlayData);
  ffApplyLiveTitle();
  // detect match-count progress (simple heuristic: max `g` across teams)
  try {
    const maxG = Math.max(...(ffOverlayData.teams || []).map(t => t.g || 0));
    if (ffPrevMaxGames < 6 && maxG >= 6) {
      // crossed the 6-match threshold
      ffHandleSixMatchesSequence();
    }
    ffPrevMaxGames = maxG;
    // also detect number of overlay payloads (files uploaded)
    const storeAll = JSON.parse(localStorage.getItem(FF_OVERLAYS_KEY) || "{}") || {};
    const storeCount = Object.keys(storeAll).length;
    if (ffPrevOverlayCount < 6 && storeCount >= 6) {
      ffHandleSixMatchesSequence();
    }
    ffPrevOverlayCount = storeCount;
  } catch (e) {
    // ignore
  }
}

/* ---------------- responsive layout ---------------- */
function ffApplyLayoutClass() {
  const w = window.innerWidth, h = window.innerHeight;
  const ratio = w / h;
  document.documentElement.classList.remove("layout-16x9", "layout-4x5", "layout-9x16");
  if (ratio >= 1.3) {
    document.documentElement.classList.add("layout-16x9");
  } else if (ratio >= 0.65) {
    document.documentElement.classList.add("layout-4x5");
  } else {
    document.documentElement.classList.add("layout-9x16");
  }
}

/* ---------------- particles background ---------------- */
function ffInitParticles() {
  const canvas = document.getElementById("particles");
  const ctx = canvas.getContext("2d");
  let particles = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  const count = Math.max(28, Math.round((window.innerWidth * window.innerHeight) / 45000));
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 2 + 0.6,
    vy: Math.random() * 0.35 + 0.08,
    vx: (Math.random() - 0.5) * 0.15,
    a: Math.random() * 0.5 + 0.15,
    hue: Math.random() > 0.5 ? "255,209,102" : "255,106,0"
  }));

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.y -= p.vy;
      p.x += p.vx;
      if (p.y < -10) { p.y = canvas.height + 10; p.x = Math.random() * canvas.width; }
      ctx.beginPath();
      ctx.fillStyle = `rgba(${p.hue},${p.a})`;
      ctx.shadowColor = `rgba(${p.hue},0.8)`;
      ctx.shadowBlur = 6;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    requestAnimationFrame(tick);
  }
  tick();
}

/* ---------------- rendering rows ---------------- */
function ffBuildRowHTML(team, rank) {
  const rowClass = rank === 1 ? "ver-row rank-first" : "ver-row";
  return `
    <div class="${rowClass}">
      <div class="ver-rank"><span>${rank}</span></div>
      <div class="ver-bar">
        <div class="ver-team">${team.n}</div>
        <div class="ver-stat">${team.p}</div>
        <div class="ver-stat">${team.k}</div>
        <div class="ver-stat">${team.t}</div>
      </div>
    </div>
  `;
}

function ffRenderRows(data) {
  const leftEl = document.getElementById("verLeftTable");
  const rightEl = document.getElementById("verRightTable");
  if (!leftEl || !rightEl) return;

  const teams = data.teams.slice(0, 12);
  leftEl.innerHTML = teams.slice(0, 6).map((t, i) => ffBuildRowHTML(t, i + 1)).join("");
  rightEl.innerHTML = teams.slice(6, 12).map((t, i) => ffBuildRowHTML(t, i + 7)).join("");

  const titleParts = (data.title || "ESPORTS STANDINGS").split(" ");
  document.getElementById("titleMain").textContent = titleParts.shift() || "ESPORTS";
  document.getElementById("titlePhase").textContent = titleParts.join(" ") || "PHASE";
}

/* ---------------- entrance timeline (GSAP) ---------------- */
function ffPlayEntrance(onComplete) {
  ffState = "standings";
  const rows = Array.from(document.querySelectorAll(".ver-row"));
  if (!rows.length) return null;

  if (ffEntranceTimeline) {
    ffEntranceTimeline.kill();
    ffEntranceTimeline = null;
  }

  gsap.set([".title-esports", ".title-phase", ".ver-row"], { opacity: 0, x: 60 });

  // Do not auto-repeat entrance; repeat causes confusing restarts when advancing
  ffEntranceTimeline = gsap.timeline({ repeat: 0, onComplete: onComplete });
  ffEntranceTimeline.fromTo(
    ".title-esports",
    { x: -120, opacity: 0 },
    { x: 0, opacity: 1, duration: 0.9 }
  );
  ffEntranceTimeline.fromTo(
    ".title-phase",
    { x: -120, opacity: 0 },
    { x: 0, opacity: 1, duration: 0.7 },
    "-=${0.6}"
  );

  ffEntranceTimeline.fromTo(
    rows,
    { x: 60, opacity: 0 },
    { x: 0, opacity: 1, duration: 0.55, ease: "power2.out", stagger: 0.14 },
    "-=0.4"
  );

  return ffEntranceTimeline;
}

function ffCountUp(el, finalVal, durationMs) {
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(finalVal * eased);
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = finalVal;
  }
  requestAnimationFrame(step);
}

/* ---------------- FLIP-style re-order (Replay button) ---------------- */
function ffReplay() {
  if (ffEntranceTimeline) {
    ffEntranceTimeline.kill();
    ffEntranceTimeline = null;
  }

  gsap.set([".title-esports", ".title-phase", ".ver-row"], { opacity: 0, x: 60 });
  ffPlayEntrance();
}

/* ---------------- Winner reveal ---------------- */
function ffTriggerWinnerReveal() {
  if (!ffOverlayData || !ffOverlayData.teams.length) return;
  const champion = ffOverlayData.teams[0];
  const screen = document.getElementById("championScreen");
  const stage = document.querySelector(".poster");

  ffState = "champion";

  document.getElementById("championTeam").textContent = champion.n;
  screen.classList.add("show");

  const tl = gsap.timeline();
  tl.to(stage, { opacity: 0, duration: 0.4, ease: "power1.in" })
    .fromTo(".champion-trophy",
      { scale: 0, rotate: -25 },
      { scale: 1, rotate: 0, duration: 0.8, ease: "back.out(1.9)" })
    .fromTo(".champion-label",
      { scale: 0.4, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.7, ease: "elastic.out(1,0.6)" }, "-=0.3")
    .fromTo(".champion-team",
      { y: 30, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.5, ease: "power2.out" }, "-=0.2")
    .add(() => ffFireConfetti(), "-=0.4");

  clearTimeout(ffTriggerWinnerReveal._t);
  ffTriggerWinnerReveal._t = setTimeout(ffReturnToStandings, 10000);
}

function ffReturnToStandings() {
  const screen = document.getElementById("championScreen");
  const stage = document.querySelector(".poster");
  gsap.timeline()
    .to(screen, {
      opacity: 0, duration: 0.5, ease: "power1.in",
      onComplete: () => {
        screen.classList.remove("show");
        screen.style.opacity = "";
        gsap.set(".champion-trophy", { scale: 0 });
        gsap.set(".champion-label", { scale: 0.4, opacity: 0 });
        gsap.set(".champion-team", { y: 30, opacity: 0 });
      }
    })
    .to(stage, { opacity: 1, duration: 0.5 }, "-=0.2")
    .add(() => {
      // ensure stage is visible and rows are up-to-date before replay
      try {
        if (stage) stage.style.display = "block";
        if (ffOverlayData) ffRenderRows(ffOverlayData);
      } catch (e) {}
      ffState = "standings";
      ffReplay();
      // special six flow ends when we return to the standings
      ffSpecialSixFlow = false;
      if (ffPendingShowMVP) {
        clearTimeout(ffReturnToStandings._t);
        ffReturnToStandings._t = setTimeout(() => {
          ffPendingShowMVP = false;
          ffShowMVP();
        }, 3200);
      }
    });
}

function ffGetTopMVP() {
  try {
    const data = JSON.parse(localStorage.getItem(FF_MVP_STORAGE_KEY) || "{}" );
    if (!data || !Object.keys(data).length) return null;
    const players = Object.values(data).sort((a, b) =>
      b.kills !== a.kills ? b.kills - a.kills : a.bestTeamRank - b.bestTeamRank
    );
    return players[0] || null;
  } catch (e) {
    return null;
  }
}

/* ---------------- MVP screen ---------------- */
function ffShowMVP(onHide, holdMs = 3500) {
  const stage = document.querySelector(".poster");
  if (!stage) return;

  ffState = "mvp";
  stage.style.display = "none";

  const mvpUrl = "mvp.html";
  window.location.href = mvpUrl;

  clearTimeout(ffShowMVP._t);
  ffShowMVP._t = setTimeout(() => {
    if (typeof onHide === "function") onHide();
  }, holdMs);
}

function ffHideMVP() {
  const mvp = document.getElementById("mvpScreen");
  if (!mvp) return;
  mvp.classList.remove("show");
  ffState = "standings";
}

/* Play points table entrance then after a pause show MVP */
function ffSequencePointsThenMVP() {
  // play entrance and when fully complete show MVP after a short hold
  ffPlayEntrance(() => {
    clearTimeout(ffSequencePointsThenMVP._t);
    ffSequencePointsThenMVP._t = setTimeout(() => {
      ffShowMVP();
    }, 2200);
  });
}

/* Show MVP first, then the winner reveal, and only after that return to the points table */
function ffHandleSixMatchesSequence() {
  const controls = document.getElementById("controls");
  if (controls) controls.classList.remove("hidden");
  ffPendingShowMVP = false;
  ffSpecialSixFlow = true;
  ffShowMVP(() => {
    ffTriggerWinnerReveal();
  }, 3500);
}

/* ----------------- next / previous controls (keyboard) ----------------- */
function ffNext() {
  if (ffState === "standings") {
    if (ffSpecialSixFlow) {
      // in special flow, next from standings should show MVP first
      ffShowMVP(() => {
        ffTriggerWinnerReveal();
      });
    } else {
      ffTriggerWinnerReveal();
    }
  } else if (ffState === "champion") {
    // skip champion and go back to standings immediately
    clearTimeout(ffTriggerWinnerReveal._t);
    ffReturnToStandings();
  } else if (ffState === "mvp") {
    // advance from MVP straight to winner reveal
    clearTimeout(ffShowMVP._t);
    ffHideMVP();
    ffTriggerWinnerReveal();
  }
}

function ffPrevious() {
  if (ffState === "standings") {
    // show MVP as previous of standings (cycle backwards)
    ffShowMVP();
  } else if (ffState === "mvp") {
    // go back to champion from mvp
    clearTimeout(ffShowMVP._t);
    ffHideMVP();
    ffTriggerWinnerReveal();
  } else if (ffState === "champion") {
    ffReturnToStandings();
  }
}

function ffLoadTitleFromStorage() {
  try {
    return JSON.parse(localStorage.getItem("ff_overlay_title") || "{}") || {};
  } catch (err) {
    return {};
  }
}

function ffBuildCurrentStandingsOverlay() {
  try {
    const stored = JSON.parse(localStorage.getItem("ff_teams_data") || "{}") || {};
    const teams = Object.values(stored);
    if (!teams.length) return null;

    const sorted = teams.slice().sort((a, b) => {
      if ((b.total || 0) !== (a.total || 0)) return (b.total || 0) - (a.total || 0);
      if ((b.booyah || 0) !== (a.booyah || 0)) return (b.booyah || 0) - (a.booyah || 0);
      if ((b.kills || 0) !== (a.kills || 0)) return (b.kills || 0) - (a.kills || 0);
      return 0;
    });

    const title = ffLoadTitleFromStorage();
    const titleText = [title.main || "ESPORTS", title.sub || "STANDINGS"].filter(Boolean).join(" ").toUpperCase();

    return {
      id: "live-current-standings",
      title: titleText || "ESPORTS STANDINGS",
      teams: sorted.slice(0, 12).map(t => ({
        n: t.name || "TEAM",
        g: t.games || 0,
        b: t.booyah || 0,
        p: t.pos || 0,
        k: t.kills || 0,
        t: t.total || 0
      })),
      ts: Date.now()
    };
  } catch (e) {
    return null;
  }
}

function ffApplyLiveTitle() {
  const stored = ffLoadTitleFromStorage();
  const titleMain = document.getElementById("titleMain");
  const titlePhase = document.getElementById("titlePhase");
  if (!titleMain || !titlePhase) return;

  if (stored.main) {
    titleMain.textContent = stored.main.toUpperCase();
    titlePhase.textContent = stored.sub ? stored.sub.toUpperCase() : "PHASE";
  }
}

/* ---------------- confetti (lightweight, no deps) ---------------- */
function ffFireConfetti() {
  const canvas = document.getElementById("confetti");
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  const ctx = canvas.getContext("2d");
  const colors = ["#ffd166", "#ff6a00", "#ffffff", "#ff9d00"];

  const pieces = Array.from({ length: 140 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.5,
    w: 6 + Math.random() * 6,
    h: 10 + Math.random() * 8,
    vy: 2 + Math.random() * 3,
    vx: (Math.random() - 0.5) * 2,
    rot: Math.random() * 360,
    vr: (Math.random() - 0.5) * 10,
    color: colors[Math.floor(Math.random() * colors.length)]
  }));

  let frame = 0;
  function tick() {
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let anyVisible = false;
    pieces.forEach(p => {
      p.y += p.vy; p.x += p.vx; p.rot += p.vr;
      if (p.y < canvas.height + 20) anyVisible = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (anyVisible && frame < 420) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  tick();
}

/* ---------------- Export Animated Video (canvas + MediaRecorder) ---------------- */
function ffExportVideo() {
  if (!ffOverlayData) { alert("No overlay data loaded."); return; }
  const exportBtn = document.getElementById("exportBtn");
  exportBtn.disabled = true;
  exportBtn.textContent = "🎥 Rendering...";

  const canvas = document.getElementById("videoCanvas");
  canvas.style.display = "block";
  canvas.style.position = "fixed";
  canvas.style.left = "-99999px";
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  const teams = ffOverlayData.teams.slice(0, 8);
  const title = ffOverlayData.title || "ESPORTS STANDINGS";
  const DURATION = 9000; // ms
  const rowStart = 1600, rowStagger = 260, rowDur = 500;
  const countDur = 700;
  const winnerStart = DURATION - 2400;

  let mimeType = "video/mp4";
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = "video/webm;codecs=vp9";
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "video/webm";
  }

  const stream = canvas.captureStream(60);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const ext = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
    const a = document.createElement("a");
    a.href = url;
    a.download = `champion-reveal.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    canvas.style.display = "none";
    exportBtn.disabled = false;
    exportBtn.textContent = "🎥 Export Animated Video";
    if (ext === "webm") {
      alert("Your browser doesn't support direct MP4 recording, so the video was saved as .webm (works great on Telegram/WhatsApp/Discord; convert to .mp4 with any free online converter if a platform requires it).");
    }
  };

  const ease = t => 1 - Math.pow(1 - t, 3);
  const particles = Array.from({ length: 50 }, () => ({
    x: Math.random() * W, y: Math.random() * H, r: Math.random() * 2 + 0.5,
    vy: Math.random() * 0.6 + 0.2, hue: Math.random() > 0.5 ? "255,209,102" : "255,106,0"
  }));

  const start = performance.now();
  recorder.start();

  function drawBackground(t) {
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, "#05070d");
    grd.addColorStop(0.6, "#0b0e17");
    grd.addColorStop(1, "#05070d");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    particles.forEach(p => {
      p.y -= p.vy;
      if (p.y < 0) p.y = H;
      ctx.beginPath();
      ctx.fillStyle = `rgba(${p.hue},0.5)`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawTitle(elapsed) {
    const t = Math.min(1, elapsed / 900);
    const y = 110 - 90 * ease(t);
    ctx.save();
    ctx.globalAlpha = ease(t);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd166";
    ctx.font = "900 46px Arial";
    ctx.shadowColor = "rgba(255,209,102,0.6)";
    ctx.shadowBlur = 20;
    ctx.fillText(title, W / 2, y + 90);
    ctx.font = "700 18px Arial";
    ctx.fillStyle = "#ff9d00";
    ctx.shadowBlur = 0;
    ctx.fillText("POWERED BY 16 ARENA", W / 2, y + 122);
    ctx.restore();
  }

  function drawRows(elapsed) {
    const rowH = 132, gap = 14, top = 260;
    teams.forEach((team, i) => {
      const localStart = rowStart + i * rowStagger;
      const t = Math.max(0, Math.min(1, (elapsed - localStart) / rowDur));
      if (t <= 0) return;
      const x = 60 * (1 - ease(t));
      const alpha = ease(t);
      const y = top + i * (rowH + gap);
      const isTop3 = i < 3;
      const isFirst = i === 0;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, 0);

      ctx.fillStyle = isFirst ? "rgba(255,209,102,0.14)" : "rgba(255,255,255,0.05)";
      ctx.strokeStyle = isFirst ? "rgba(255,209,102,0.55)" : isTop3 ? "rgba(255,106,0,0.4)" : "rgba(255,255,255,0.1)";
      ctx.lineWidth = 2;
      roundRect(ctx, 50, y, W - 100, rowH, 20);
      ctx.fill(); ctx.stroke();

      const countT = Math.max(0, Math.min(1, (elapsed - (localStart + 120)) / countDur));
      const pos = Math.round(team.p * ease(countT));
      const kills = Math.round(team.k * ease(countT));
      const total = Math.round(team.t * ease(countT));

      ctx.textAlign = "left";
      ctx.fillStyle = isFirst ? "#ffd166" : "#fff";
      ctx.font = "900 44px Arial";
      ctx.fillText(String(i + 1), 84, y + rowH / 2 + 16);

      ctx.font = "800 34px Arial";
      ctx.fillStyle = "#fff";
      ctx.fillText(team.n, 160, y + rowH / 2 + 12);

      ctx.textAlign = "right";
      ctx.font = "700 26px Arial";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(`POS ${pos}`, W - 420, y + rowH / 2 + 10);
      ctx.fillText(`ELIM ${kills}`, W - 230, y + rowH / 2 + 10);
      ctx.fillStyle = "#ffd166";
      ctx.font = "900 30px Arial";
      ctx.fillText(`${total} PTS`, W - 70, y + rowH / 2 + 10);

      ctx.restore();
    });
  }

  function drawWinner(elapsed) {
    if (elapsed < winnerStart) return;
    const t = Math.min(1, (elapsed - winnerStart) / 500);
    ctx.save();
    ctx.globalAlpha = 0.55 * ease(t);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = ease(t);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffd166";
    ctx.shadowColor = "rgba(255,209,102,0.8)";
    ctx.shadowBlur = 30;
    ctx.font = "900 60px Arial";
    ctx.fillText("🏆 CHAMPION 🏆", W / 2, H / 2 - 20);
    ctx.font = "900 46px Arial";
    ctx.fillStyle = "#fff";
    ctx.fillText(teams[0] ? teams[0].n : "", W / 2, H / 2 + 50);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function frame(now) {
    const elapsed = now - start;
    drawBackground(elapsed);
    drawTitle(elapsed);
    drawRows(elapsed);
    drawWinner(elapsed);

    if (elapsed < DURATION) {
      requestAnimationFrame(frame);
    } else {
      recorder.stop();
    }
  }
  requestAnimationFrame(frame);
}

/* ---------------- controls & transparent bg ---------------- */
function ffSetupControls() {
  const controls = document.getElementById("controls");
  const showControls = ffQueryParam("controls") !== "0";
  if (controls) controls.classList.toggle("hidden", !showControls);

  const replayBtnEl = document.getElementById("replayBtn");
  const winnerBtnEl = document.getElementById("winnerBtn");
  if (replayBtnEl) replayBtnEl.onclick = ffReplay;
  if (winnerBtnEl) winnerBtnEl.onclick = ffTriggerWinnerReveal;

  // wire hidden prev/next buttons (always attach these)
  const prevBtn = document.getElementById("ffPrevBtn");
  const nextBtn = document.getElementById("ffNextBtn");
  if (prevBtn) prevBtn.onclick = ffPrevious;
  if (nextBtn) nextBtn.onclick = ffNext;

  // keyboard shortcuts (Enter / Right = next, Left = previous)
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === "ArrowRight") {
      ev.preventDefault();
      // trigger next action
      if (nextBtn) nextBtn.click();
      else ffNext();
    } else if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      if (prevBtn) prevBtn.click();
      else ffPrevious();
    }
  });

  if (ffQueryParam("reveal") === "1") {
    setTimeout(ffTriggerWinnerReveal, 1500);
  }
}

/* ---------------- init ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  ffApplyLayoutClass();
  window.addEventListener("resize", ffApplyLayoutClass);
  ffInitParticles();
  ffApplyLiveTitle();

  window.addEventListener("storage", (event) => {
    if (event.key === "ff_overlay_title") {
      ffApplyLiveTitle();
    }
    if (event.key === FF_OVERLAYS_KEY || event.key === "ff_live_session_v1" || event.key === "ff_live_session_signal") {
      ffUpdateOverlayFromSession();
    }
  });

  // Parse overlay data (now async to support Supabase)
  ffOverlayData = await ffParseHash();
  if (!ffOverlayData) {
    const session = ffQueryParam("session");
    if (session) {
      ffUpdateOverlayFromSession();
    }
  }

  if (!ffOverlayData) {
    ffOverlayData = ffGetLatestStoredOverlay();
  }
  if (!ffOverlayData && typeof ffGetLatestOverlayData === "function") {
    ffOverlayData = ffGetLatestOverlayData();
  }

  if (!ffOverlayData) {
    ffOverlayData = ffBuildCurrentStandingsOverlay();
  }

  if (!ffOverlayData) {
    const titleMain = document.getElementById("titleMain");
    const titleSub = document.querySelector(".title-sub");
    if (titleMain) titleMain.textContent = "NO OVERLAY DATA";
    if (titleSub) titleSub.textContent = "Generate an overlay from the standings page first";
    return;
  }

  ffRenderRows(ffOverlayData);
  ffSetupControls();

  // Set up Supabase realtime subscription for auto-refresh
  const sbid = ffQueryParam("sbid");
  const sessionParam = ffQueryParam("session");
  if (sbid && typeof sbSubscribeToSession === "function") {
    sbSubscribeToSession(sessionParam || sbid, (updatedData) => {
      console.log("[Live] Realtime update received");
      ffOverlayData = updatedData;
      ffRenderRows(ffOverlayData);
      ffApplyLiveTitle();
    });
  }

  const explicitReveal = ffQueryParam("reveal") === "1" || ffQueryParam("show") === "1";
  if (!explicitReveal) {
    ffState = "standings";
    ffPlayEntrance();
    return;
  }

  try {
    const maxG = Math.max(...(ffOverlayData.teams || []).map(t => t.g || 0));
    const storeAll = JSON.parse(localStorage.getItem(FF_OVERLAYS_KEY) || "{}") || {};
    const storeCount = Object.keys(storeAll).length;
    ffPrevMaxGames = maxG;
    ffPrevOverlayCount = storeCount;
    ffHandleSixMatchesSequence();
  } catch (e) {
    ffHandleSixMatchesSequence();
  }
});
