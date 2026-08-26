/* ============================================================
   SHOW CONTROLLER — Cinematic Broadcast Sequence
   Extracted from show.html inline <script> for modularity
   Added: keyboard navigation, 6-match MVP logic, session params
   ============================================================ */

const FF_MVP_KEY = "ff_mvp_players";
/* FF_OVERLAYS_KEY and FF_STORAGE_KEY come from overlay-data.js */

// Stage tracking for keyboard navigation
let ffCurrentStageIndex = -1;
let ffStageQueue = [];
let ffMatchSixMilestone = false; // true if 6-matches completed (multiple of 6)
let ffChampionTeamName = "CHAMPION";
let ffMvpPlayers = [];
let ffShowPayload = null;
let ffAdvanceResolve = null;
let ffPointsTableShown = false;

// Tiny anime-less promise-based animation helpers
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function fadeIn(el, dur = 500) {
  return new Promise(r => {
    el.style.transition = `opacity ${dur}ms ease`;
    el.style.opacity = 1;
    setTimeout(r, dur);
  });
}
function fadeOut(el, dur = 500) {
  return new Promise(r => {
    el.style.transition = `opacity ${dur}ms ease`;
    el.style.opacity = 0;
    setTimeout(r, dur);
  });
}
function animEl(el, props, dur = 400) {
  return new Promise(r => {
    el.style.transition = `all ${dur}ms cubic-bezier(.2,0,.2,1)`;
    Object.assign(el.style, props);
    setTimeout(r, dur);
  });
}

/* ---- Data ---- */
function getMVPData() {
  try {
    if (ffShowPayload && Array.isArray(ffShowPayload.mvp) && ffShowPayload.mvp.length) {
      return ffShowPayload.mvp
        .filter(player => player && player.name)
        .sort((a, b) => (b.kills || 0) - (a.kills || 0) || (a.bestTeamRank || 999) - (b.bestTeamRank || 999))
        .slice(0, 5);
    }

    // 1. Individual player data from ff_mvp_players
    const data = JSON.parse(localStorage.getItem(FF_MVP_KEY) || "{}");
    let players = Object.values(data).filter(p => p && p.name && p.name !== "—");
    if (players.length > 0) {
      players.sort((a, b) =>
        (b.kills || 0) !== (a.kills || 0) ? (b.kills || 0) - (a.kills || 0) : (a.bestTeamRank || 999) - (b.bestTeamRank || 999)
      );
      return players.slice(0, 5);
    }

    // 2. Fallback to team standings data if individual player entries are not in log
    const teamsData = JSON.parse(localStorage.getItem(FF_STORAGE_KEY) || "{}");
    const teams = Object.values(teamsData);
    if (teams.length > 0) {
      teams.sort((a, b) => (b.total || 0) - (a.total || 0) || (b.kills || 0) - (a.kills || 0));
      return teams.slice(0, 5).map((t, idx) => ({
        name: `PLAYER ${idx + 1}`,
        team: t.name || `TEAM ${idx + 1}`,
        kills: t.kills || 0,
        bestTeamRank: idx + 1
      }));
    }

    // 3. Fallback to latest stored overlay
    const store = JSON.parse(localStorage.getItem(FF_OVERLAYS_KEY) || "{}");
    const keys = Object.keys(store);
    if (keys.length > 0) {
      const latest = store[keys[keys.length - 1]];
      if (latest && latest.teams && latest.teams.length) {
        return latest.teams.slice(0, 5).map((t, idx) => ({
          name: `PLAYER ${idx + 1}`,
          team: t.n || `TEAM ${idx + 1}`,
          kills: t.k || 0,
          bestTeamRank: idx + 1
        }));
      }
    }
  } catch (e) { }

  // 4. Default fallback so 5 MVP cards are ALWAYS visible on screen
  return [
    { name: "PLAYER 1", team: "CHAMPION TEAM", kills: 12, bestTeamRank: 1 },
    { name: "PLAYER 2", team: "RUNNER UP", kills: 9, bestTeamRank: 2 },
    { name: "PLAYER 3", team: "THIRD PLACE", kills: 7, bestTeamRank: 3 },
    { name: "PLAYER 4", team: "FOURTH PLACE", kills: 5, bestTeamRank: 4 },
    { name: "PLAYER 5", team: "FIFTH PLACE", kills: 4, bestTeamRank: 5 }
  ];
}

function getChampionTeam() {
  try {
    const teamsData = JSON.parse(localStorage.getItem(FF_STORAGE_KEY) || "{}");
    const teams = Object.values(teamsData);
    if (teams.length) {
      teams.sort((a, b) => {
        if ((b.total || 0) !== (a.total || 0)) return (b.total || 0) - (a.total || 0);
        if ((b.booyah || 0) !== (a.booyah || 0)) return (b.booyah || 0) - (a.booyah || 0);
        if ((b.kills || 0) !== (a.kills || 0)) return (b.kills || 0) - (a.kills || 0);
        return 0;
      });
      const top = teams[0];
      if (top && top.name) return { n: top.name };
    }

    const store = JSON.parse(localStorage.getItem(FF_OVERLAYS_KEY) || "{}");
    const keys = Object.keys(store);
    if (!keys.length) return null;
    const latest = store[keys[keys.length - 1]];
    return latest && latest.teams && latest.teams[0] ? latest.teams[0] : null;
  } catch (e) { return null; }
}

function getPointsTableUrl() {
  const params = new URLSearchParams(window.location.search);
  const iframeParams = new URLSearchParams({ embed: "1" });
  const session = params.get("session");
  const d = params.get("d");
  const sbid = params.get("sbid");
  
  if (sbid) {
    iframeParams.set("sbid", sbid);
    if (session) iframeParams.set("session", session);
  } else if (session) {
    iframeParams.set("session", session);
  } else if (d) {
    iframeParams.set("d", d);
  }
  return `live.html?${iframeParams.toString()}`;
}

function refreshPointsTableFrame() {
  const frame = document.getElementById("pointsTableFrame");
  if (!frame) return;
  const nextSrc = getPointsTableUrl();
  frame.src = `${nextSrc}&refresh=${Date.now()}`;
}

function setupShowLiveRefresh() {
  const session = new URLSearchParams(window.location.search).get("session");
  const sbid = new URLSearchParams(window.location.search).get("sbid");
  const targetId = session || sbid;
  if (!targetId) return;

  let lastSignal = localStorage.getItem(FF_LIVE_SESSION_SIGNAL_KEY) || "";
  const refresh = () => {
    const signal = localStorage.getItem(FF_LIVE_SESSION_SIGNAL_KEY) || "";
    if (signal === lastSignal) return;
    lastSignal = signal;
    refreshPointsTableFrame();
  };

  window.addEventListener("storage", event => {
    if (event.key === FF_LIVE_SESSION_SIGNAL_KEY || event.key === FF_OVERLAYS_KEY) {
      refresh();
    }
  });
  setInterval(refresh, 1000);

  // Supabase realtime refresh
  if (typeof sbSubscribeToSession === "function") {
    sbSubscribeToSession(targetId, (data) => {
      console.log("[Show] Realtime update from Supabase");
      ffShowPayload = data;
      const champion = getChampionTeam();
      if (champion) ffChampionTeamName = champion.n;
      ffMvpPlayers = getMVPData();
      refreshPointsTableFrame();
    });
  }
}

/** Seed localStorage from URL params so OBS (isolated profile) can read overlay data. */
async function seedOverlayFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const d = params.get("d");
    const session = params.get("session");
    const sbid = params.get("sbid");

    let payload = null;

    // 1. Try loading latest session data from Supabase
    if (session && typeof sbLoadOverlayBySession === "function") {
      try {
        payload = await sbLoadOverlayBySession(session);
        if (payload) {
          console.log("[Show] Loaded from Supabase session:", session);
        }
      } catch (e) {}
    }

    // 2. Try loading by sbid from Supabase
    if (!payload && sbid && typeof sbLoadOverlay === "function") {
      try {
        payload = await sbLoadOverlay(sbid);
        if (payload) {
          console.log("[Show] Loaded from Supabase sbid:", sbid);
        }
      } catch (e) {}
    }

    // 3. Fallback: Load latest active session from Supabase
    if (!payload && typeof sbLoadLatestOverlay === "function") {
      try {
        payload = await sbLoadLatestOverlay();
        if (payload) {
          console.log("[Show] Loaded latest active session from Supabase:", payload.session_id);
        }
      } catch (e) {}
    }

    // 4. Try loading from localStorage by session
    if (!payload && session) {
      try {
        const store = JSON.parse(localStorage.getItem(FF_OVERLAYS_KEY) || "{}");
        if (store[session]) {
          payload = store[session];
        }
      } catch(e) {}
    }

    // 5. Legacy d= param
    if (!payload && d) {
      payload = typeof ffDecodePayload === "function"
        ? ffDecodePayload(d)
        : JSON.parse(decodeURIComponent(atob(d)));
    }

    if (!payload) return null;

    ffShowPayload = payload;

    const store = JSON.parse(localStorage.getItem(FF_OVERLAYS_KEY) || "{}");
    const id = session || payload.id || "obs";
    store[id] = payload;
    localStorage.setItem(FF_OVERLAYS_KEY, JSON.stringify(store));

    // Mirror teams into ff_teams_data
    if (payload.teams && payload.teams.length) {
      const teamsData = {};
      payload.teams.forEach(team => {
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
      localStorage.setItem(FF_STORAGE_KEY, JSON.stringify(teamsData));
    }

    // Mirror MVP players into ff_mvp_players
    if (payload.mvp && Array.isArray(payload.mvp) && payload.mvp.length) {
      const mvpData = {};
      payload.mvp.forEach(player => {
        if (player.name) {
          mvpData[player.name] = {
            name: player.name,
            team: player.team || "",
            kills: player.kills || 0,
            bestTeamRank: player.bestTeamRank || 999
          };
        }
      });
      localStorage.setItem(FF_MVP_KEY, JSON.stringify(mvpData));
    }

    if (session) {
      localStorage.setItem("ff_live_session_v1", JSON.stringify({
        id: session,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
      }));
    }

    if (payload.title) {
      const parts = payload.title.split(" ");
      localStorage.setItem("ff_overlay_title", JSON.stringify({
        main: parts[0] || payload.title,
        sub: parts.slice(1).join(" ") || ""
      }));
    }

    return payload;
  } catch (e) {
    console.error("Failed to seed overlay from URL:", e);
    return null;
  }
}

/** Check if total matches processed is a multiple of 6 (6, 12, 18...) */
function isMultipleOfSixMatches() {
  try {
    if (ffShowPayload && Array.isArray(ffShowPayload.teams) && ffShowPayload.teams.length) {
      const maxG = Math.max(...ffShowPayload.teams.map(t => t.g || 0));
      if (maxG >= 6 && maxG % 6 === 0) return true;
    }

    const teamsData = JSON.parse(localStorage.getItem(FF_STORAGE_KEY) || "{}");
    const teams = Object.values(teamsData);
    if (teams.length) {
      const maxGames = Math.max(...teams.map(t => t.games || 0));
      if (maxGames >= 6 && maxGames % 6 === 0) return true;
    }

    return false;
  } catch (e) {
    return false;
  }
}

/** Load overlay data from session/query param (like live.html does) */
async function loadShowFromSession() {
  try {
    const queryParams = new URLSearchParams(window.location.search);
    const session = queryParams.get("session");
    const sbid = queryParams.get("sbid");

    if (session && typeof sbLoadOverlayBySession === "function") {
      try {
        const sbData = await sbLoadOverlayBySession(session);
        if (sbData) {
          ffShowPayload = sbData;
          if (sbData.teams && sbData.teams.length) {
            ffChampionTeamName = sbData.teams[0].n || "CHAMPION";
          }
          return sbData;
        }
      } catch (e) {}
    }

    if (sbid && typeof sbLoadOverlay === "function") {
      try {
        const sbData = await sbLoadOverlay(sbid);
        if (sbData) {
          ffShowPayload = sbData;
          if (sbData.teams && sbData.teams.length) {
            ffChampionTeamName = sbData.teams[0].n || "CHAMPION";
          }
          return sbData;
        }
      } catch (e) {}
    }

    if (session) {
      const store = JSON.parse(localStorage.getItem(FF_OVERLAYS_KEY) || "{}");
      if (store[session]) {
        const data = store[session];
        ffShowPayload = data;
        if (data.teams && data.teams.length) {
          ffChampionTeamName = data.teams[0].n || "CHAMPION";
        }
        return data;
      }
    }
  } catch (e) { }
  return null;
}

/* ---- Boot Animation ---- */
async function runBoot() {
  const boot = document.getElementById("bootScreen");
  const scan = document.getElementById("bootScan");
  const bar = document.getElementById("bootBarFill");
  const lines = ["bl1", "bl2", "bl3", "bl4"].map(id => document.getElementById(id));

  boot.style.opacity = 1;
  boot.style.pointerEvents = "none";

  // scan line
  scan.style.opacity = 1;
  scan.style.transition = "top 1s linear";
  scan.style.top = "0%";
  await wait(50);
  scan.style.top = "100%";

  // boot lines appear
  for (let i = 0; i < lines.length; i++) {
    await wait(180);
    lines[i].style.transition = "opacity 0.3s";
    lines[i].style.opacity = 1;
  }

  // progress bar
  let prog = 0;
  const barInterval = setInterval(() => {
    prog = Math.min(100, prog + Math.random() * 12 + 3);
    bar.style.width = prog + "%";
    if (prog >= 100) clearInterval(barInterval);
  }, 60);
  await wait(800);

  await fadeOut(boot, 400);
  boot.style.display = "none";
}

/* ---- HUD Corners ---- */
function showHUD() {
  ["hc1", "hc2", "hc3", "hc4"].forEach(id => {
    document.getElementById(id).style.opacity = 1;
  });
}
function hideHUD() {
  ["hc1", "hc2", "hc3", "hc4"].forEach(id => {
    document.getElementById(id).style.opacity = 0;
  });
}

/* ---- Doors ---- */
async function openDoors() {
  const left = document.getElementById("doorLeft");
  const right = document.getElementById("doorRight");
  const seam = document.getElementById("doorSeam");

  seam.style.transition = "opacity 0.2s";
  seam.style.opacity = 1;
  await wait(300);
  left.style.transform = "translateX(-100%)";
  right.style.transform = "translateX(100%)";
  seam.style.opacity = 0;
  await wait(1600);
}

async function closeDoors() {
  const left = document.getElementById("doorLeft");
  const right = document.getElementById("doorRight");
  const seam = document.getElementById("doorSeam");

  left.style.transform = "translateX(0)";
  right.style.transform = "translateX(0)";
  await wait(900);
  seam.style.opacity = 1;
  await wait(700);
}

/* ---- Energy Sweep ---- */
async function runEnergySweep() {
  const wrap = document.getElementById("energySweep");
  const beam = document.getElementById("sweepBeam");

  wrap.style.opacity = 1;
  beam.style.transition = "transform 0.8s linear";
  beam.style.transform = "rotate(30deg) translateX(-100%)";
  await wait(50);
  beam.style.transform = "rotate(30deg) translateX(200%)";

  // spawn particles
  for (let i = 0; i < 20; i++) {
    const p = document.createElement("div");
    p.className = "sweep-particle";
    p.style.left = Math.random() * 100 + "%";
    p.style.top = Math.random() * 100 + "%";
    p.style.animationDelay = (Math.random() * 0.5) + "s";
    wrap.appendChild(p);
  }

  await wait(900);
  wrap.style.opacity = 0;
}

/* ---- Tournament Intro ---- */
async function runTournamentIntro() {
  const wrap = document.getElementById("tournamentIntro");
  const leftPanel = document.querySelector(".ti-left-panel");
  const rightPanel = document.querySelector(".ti-right-panel");
  const centerContent = document.querySelector(".ti-center");
  const badge = document.getElementById("tiBadge");
  const title = document.getElementById("tiTitle");
  const sub = document.getElementById("tiSub");
  const topLogo = document.querySelector(".ti-top-logo-wrap");
  const bottomLogo = document.querySelector(".ti-bottom-logo-wrap");
  const socialIcons = document.querySelector(".ti-social-icons");

  wrap.style.opacity = 1;
  wrap.style.pointerEvents = "none";

  // Animate side panels
  leftPanel.style.transition = "opacity 0.8s, transform 0.8s";
  leftPanel.style.opacity = 1;
  leftPanel.style.transform = "translateX(0)";
  
  rightPanel.style.transition = "opacity 0.8s, transform 0.8s";
  rightPanel.style.opacity = 1;
  rightPanel.style.transform = "translateX(0)";
  await wait(800);

  // Animate center content
  centerContent.style.transition = "opacity 0.8s, transform 0.8s";
  centerContent.style.opacity = 1;
  centerContent.style.transform = "scale(1)";
  await wait(600);

  // Animate top logo
  topLogo.style.transition = "opacity 0.8s, transform 0.8s";
  topLogo.style.opacity = 1;
  topLogo.style.transform = "scale(1)";
  await wait(700);

  // Animate badge
  badge.style.transition = "opacity 0.8s, transform 0.8s";
  badge.style.opacity = 1;
  badge.style.transform = "translateY(0)";
  await wait(700);

  // Animate title
  title.style.transition = "opacity 1s, transform 1s";
  title.style.opacity = 1;
  title.style.transform = "scale(1)";
  await wait(900);

  // Animate subtitle
  sub.style.transition = "opacity 0.8s, transform 0.8s";
  sub.style.opacity = 1;
  sub.style.transform = "translateY(0)";
  await wait(700);

  // Animate bottom logo
  bottomLogo.style.transition = "opacity 0.8s, transform 0.8s";
  bottomLogo.style.opacity = 1;
  bottomLogo.style.transform = "scale(1)";
  await wait(700);

  // Animate social icons
  socialIcons.style.transition = "opacity 0.8s, transform 0.8s";
  socialIcons.style.opacity = 1;
  socialIcons.style.transform = "translateY(0)";
  await wait(4900);

  await fadeOut(wrap, 500);
}

/* ---- MVP Reveal ---- */
function buildMVPCards(players) {
  const container = document.getElementById("mvpCardsContainer");
  if (!container) return;
  container.innerHTML = "";

  const rankLabels = ["#1", "#2", "#3", "#4", "#5"];
  const rankClasses = ["rank-1", "rank-2", "rank-3", "rank-4", "rank-5"];
  const playerImgs = [
    "..assets\1.png",
    "..\assets\2.png",
    "..\assets\3.png",
    "..\assets\4.png",
    "../Points_Table_Project\assets\5.png"
  ];
  const localImgs = ["assets/1.png", "assets/2.png", "assets/3.png", "assets/4.png", "assets/5.png"];

  let list = Array.isArray(players) && players.length ? players : getMVPData();
  if (!list || !list.length) {
    list = getMVPData();
  }

  // Sort strictly by highest number of kills of individual player (descending)
  list.sort((a, b) => (b.kills || 0) - (a.kills || 0) || (a.bestTeamRank || 999) - (b.bestTeamRank || 999));

  const data = list.slice(0, 5);

  data.forEach((p, i) => {
    const wrap = document.createElement("div");
    wrap.className = `mvp-card-wrap ${rankClasses[i] || "rank-5"}`;
    wrap.id = `showMvpCard${i}`;
    wrap.innerHTML = `
      <div class="rank-badge">${rankLabels[i]}</div>
      <div class="player-img-wrap">
        <img class="player-img" src="${playerImgs[i]}"
          onerror="this.src='${localImgs[i]}'" alt="player">
      </div>
      <div class="mvp-card">
        <div class="card-info">
          <div class="kills-line">KILLS: <span class="kills-val">${p.kills || 0}</span></div>
          <div class="ign-line">IGN: <span class="ign-val">${(p.name || "—").toUpperCase()}</span></div>
          <div class="team-line">TEAM NAME: <span class="team-val">${(p.team || "—").toUpperCase()}</span></div>
        </div>
      </div>`;
    container.appendChild(wrap);
  });
}

function runMVPReveal(players) {
  return new Promise(async resolve => {
    buildMVPCards(players);

    const wrap = document.getElementById("mvpReveal");
    const title = document.getElementById("mvpRevealTitle");
    const btn = document.getElementById("mvpNextBtn");

    if (!wrap || !title) {
      resolve();
      return;
    }

    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      wrap.style.pointerEvents = "none";
      fadeOut(wrap, 500).then(resolve);
    };

    wrap.style.opacity = 1;
    wrap.style.pointerEvents = "all";

    title.style.transition = "opacity 0.8s, transform 0.8s";
    title.style.opacity = 1; title.style.transform = "translateY(0)";
    await wait(1000);

    const cards = document.querySelectorAll(".mvp-card-wrap");
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      c.style.transition = "opacity 0.8s, transform 0.8s";
      c.style.opacity = 1; c.style.transform = "translateY(0) scale(1)";
      await wait(600);
    }

    if (btn) {
      btn.onclick = finish;
    }

    wrap.onclick = finish;
    setTimeout(finish, 10000);
  });
}

/* ---- Winner Reveal ---- */
function spawnWinnerParticles() {
  const container = document.getElementById("winnerParticles");
  container.innerHTML = "";
  for (let i = 0; i < 30; i++) {
    const p = document.createElement("div");
    p.className = "w-particle";
    p.style.left = Math.random() * 100 + "%";
    p.style.top = (50 + Math.random() * 50) + "%";
    p.style.width = p.style.height = (2 + Math.random() * 4) + "px";
    p.style.animationDelay = (Math.random() * 2) + "s";
    p.style.animationDuration = (1.5 + Math.random() * 1.5) + "s";
    container.appendChild(p);
  }
}

function runCameraShake() {
  const el = document.getElementById("winnerReveal");
  const keyframes = [
    { transform: "translate(0,0)" }, { transform: "translate(-5px,3px)" },
    { transform: "translate(5px,-3px)" }, { transform: "translate(-4px,-4px)" },
    { transform: "translate(4px,4px)" }, { transform: "translate(0,0)" }
  ];
  el.animate(keyframes, { duration: 400, iterations: 3 });
}

function runWinnerReveal(teamName) {
  return new Promise(async resolve => {
    const wrap = document.getElementById("winnerReveal");
    const trophy = document.getElementById("winnerTrophy");
    const label = document.getElementById("winnerLabel");
    const team = document.getElementById("winnerTeamName");
    const fire1 = document.getElementById("wFire1");
    const fire2 = document.getElementById("wFire2");

    const winnerName = teamName || ffChampionTeamName || "CHAMPION";
    if (label) label.textContent = "TABLE TOPPERS";
    team.textContent = winnerName;
    wrap.style.opacity = 1;
    wrap.style.pointerEvents = "none";

    spawnWinnerParticles();

    await wait(200);
    trophy.style.transition = "opacity 0.5s, transform 0.8s cubic-bezier(.2,0,.2,1.6)";
    trophy.style.opacity = 1; trophy.style.transform = "scale(1) rotate(0)";
    await wait(700);

    runCameraShake();

    fire1.style.transition = fire2.style.transition = "opacity 0.3s";
    fire1.style.opacity = 1; fire2.style.opacity = 1;
    await wait(300);

    label.style.transition = "opacity 0.5s";
    label.style.opacity = 1;
    await wait(400);

    team.style.transition = "opacity 0.5s, transform 0.5s";
    team.style.opacity = 1; team.style.transform = "translateY(0)";

    const fireCanvas = document.getElementById("winnerCanvas");
    runFireworks(fireCanvas);

    wrap.style.pointerEvents = "all";

    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      clearTimeout(autoTimer);
      wrap.style.pointerEvents = "none";
      await fadeOut(wrap, 400);
      if (!ffPointsTableShown) {
        await runPointsTable();
      }
      resolve();
    };

    let autoTimer = setTimeout(finish, 5000);
    wrap.onclick = finish;
  });
}

/* ---- Celebration ---- */
function runFireworks(canvas) {
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const colors = ["#39ff14", "#ffd700", "#fff", "#00ff88", "#ff6a00", "#ff0088"];
  let particles = [];

  function burst(x, y) {
    for (let i = 0; i < 80; i++) {
      const angle = (Math.PI * 2 / 60) * i;
      const speed = 2 + Math.random() * 5;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1, decay: 0.015 + Math.random() * 0.01,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 1 + Math.random() * 3
      });
    }
  }

  let bursting = true;
  const burstInterval = setInterval(() => {
    if (!bursting) { clearInterval(burstInterval); return; }
    burst(Math.random() * canvas.width, Math.random() * canvas.height * 0.7);
  }, 600);

  function tick() {
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.08; p.life -= p.decay;
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    if (bursting || particles.length) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  tick();
  return () => { bursting = false; };
}

function runCelebration(teamName, mvpPlayer) {
  return new Promise(async resolve => {
    const wrap = document.getElementById("celebration");
    const teamEl = document.getElementById("celebTeamName");
    const mvpEl = document.getElementById("celebMvpBadge");
    const canvas = document.getElementById("celebCanvas");
    const btn = document.getElementById("celebNextBtn");

    if (!wrap || !teamEl || !mvpEl || !canvas) {
      resolve();
      return;
    }

    let completed = false;
    const finish = async () => {
      if (completed) return;
      completed = true;
      const stopFire = runFireworks(canvas);
      stopFire();
      wrap.style.pointerEvents = "none";
      await fadeOut(wrap, 500);
      resolve();
      runPointsTable();
    };

    teamEl.textContent = (teamName || "CHAMPION").toUpperCase();
    if (mvpPlayer) mvpEl.textContent = `⭐ MVP: ${mvpPlayer.name || "—"} (${mvpPlayer.kills || 0} KILLS)`;

    wrap.style.opacity = 1;
    wrap.style.pointerEvents = "none";

    const stopFire = runFireworks(canvas);
    await wait(1000);
    wrap.style.pointerEvents = "all";

    if (btn) btn.onclick = finish;
    wrap.onclick = finish;
    setTimeout(finish, 5000);
  });
}

/* ---- Transition Wipe ---- */
async function runTransitionWipe() {
  const wrap = document.getElementById("transWipe");
  const beam = document.getElementById("wipeBeam");
  wrap.style.opacity = 1;
  beam.style.transition = "transform 0.8s linear";
  beam.style.transform = "rotate(15deg) translateX(200%)";
  await wait(900);
  wrap.style.opacity = 0;
  beam.style.transform = "rotate(15deg) translateX(-120%)";
}

/* ---- Points Table ---- */
async function runPointsTable() {
  if (ffPointsTableShown) return;
  ffPointsTableShown = true;

  const wrap = document.getElementById("pointsTableWrap");
  const header = document.getElementById("ptHeader");
  const footer = document.getElementById("ptFooter");

  if (!wrap) return;

  // iframe src is set on page load (see DOMContentLoaded) with ?d= payload for OBS

  wrap.style.opacity = 0;
  wrap.style.pointerEvents = "all";
  wrap.style.display = "flex";

  await runTransitionWipe();

  await fadeIn(wrap, 800);
  await wait(1500); // Give iframe time to load and render
  if (header) header.style.opacity = 1;
  await wait(300);
  if (footer) footer.style.opacity = 1;
  
  // Display points table for 60 seconds then stay on screen
  await wait(60000);
}

/* ============================================================
   KEYBOARD & NAVIGATION CONTROLS
   Click handlers for visible stage buttons by simulating click
   on whichever "next" button is currently visible.
   ============================================================ */

function handleNextStage() {
  const pointsWrap = document.getElementById("pointsTableWrap");
  const celebration = document.getElementById("celebration");
  const winner = document.getElementById("winnerReveal");
  const mvp = document.getElementById("mvpReveal");
  const celebNext = document.getElementById("celebNextBtn");
  const tableBtn = document.getElementById("wTableBtn");
  const mvpBtn = document.getElementById("mvpNextBtn");

  if (celebNext && parseFloat(getComputedStyle(celebration).opacity || "0") > 0) {
    celebNext.click();
  } else if (tableBtn && parseFloat(getComputedStyle(winner).opacity || "0") > 0) {
    tableBtn.click();
  } else if (mvpBtn && parseFloat(getComputedStyle(mvp).opacity || "0") > 0) {
    mvpBtn.click();
  }
}

function handlePrevStage() {
  const pointsWrap = document.getElementById("pointsTableWrap");
  const celebration = document.getElementById("celebration");
  const winner = document.getElementById("winnerReveal");
  const mvp = document.getElementById("mvpReveal");

  if (pointsWrap && parseFloat(getComputedStyle(pointsWrap).opacity || "0") > 0) {
    fadeOut(pointsWrap, 400).then(() => runWinnerReveal(ffChampionTeamName));
    return;
  }

  if (celebration && parseFloat(getComputedStyle(celebration).opacity || "0") > 0) {
    fadeOut(celebration, 400).then(() => runWinnerReveal(ffChampionTeamName));
    return;
  }

  if (winner && parseFloat(getComputedStyle(winner).opacity || "0") > 0) {
    if (ffMatchSixMilestone) {
      fadeOut(winner, 400).then(() => runMVPReveal(ffMvpPlayers));
    }
    return;
  }

  if (mvp && parseFloat(getComputedStyle(mvp).opacity || "0") > 0) {
    fadeOut(mvp, 400);
    return;
  }
}

function setupKeyboardNavigation() {
  const nextNavBtn = document.getElementById("showNextNavBtn");
  const prevNavBtn = document.getElementById("showPrevNavBtn");
  const ffNextBtn = document.getElementById("ffShowNextBtn");
  const ffPrevBtn = document.getElementById("ffShowPrevBtn");

  if (nextNavBtn) nextNavBtn.onclick = handleNextStage;
  if (prevNavBtn) prevNavBtn.onclick = handlePrevStage;
  if (ffNextBtn) ffNextBtn.onclick = handleNextStage;
  if (ffPrevBtn) ffPrevBtn.onclick = handlePrevStage;

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowRight" || ev.key === "Enter") {
      ev.preventDefault();
      handleNextStage();
    } else if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      handlePrevStage();
    }
  });
}

/* ============================================================
   MAIN SEQUENCE
   ============================================================ */

async function runShow() {
  ffPointsTableShown = false;

  // Required flow: intro -> MVP (only on 6-match milestone) -> champion -> points table
  ffMatchSixMilestone = isMultipleOfSixMatches();
  ffMvpPlayers = getMVPData();

  const champion = getChampionTeam();
  if (champion) ffChampionTeamName = champion.n;

  // Stage 1: Black screen (0.5s)
  await wait(500);

  // Stage 2: System Boot (1s)
  document.getElementById("fadeOverlay").style.opacity = 0;
  await runBoot();

  // Animated background fades in
  const bg = document.getElementById("animBg");
  bg.style.transition = "opacity 0.8s";
  bg.style.opacity = 1;
  showHUD();

  await openDoors();
  await runEnergySweep();

  // Stage 5: Tournament Intro (must stay first)
  await runTournamentIntro();

  // Stage 6: MVP Reveal — only when total match count is a multiple of 6
  if (ffMatchSixMilestone) {
    await runMVPReveal(ffMvpPlayers);
  }

  // Stage 7: Champion reveal
  await runWinnerReveal(ffChampionTeamName);

  // Stage 8: Points table
  await runPointsTable();
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Seed overlay data from URL before anything reads localStorage (OBS fix)
    await seedOverlayFromUrl();
    await loadShowFromSession();

    // Preload points table iframe with encoded data params
    const frame = document.getElementById("pointsTableFrame");
    if (frame) frame.src = getPointsTableUrl();
    setupShowLiveRefresh();

    setupKeyboardNavigation();
    runShow();
  } catch (err) {
    console.error("Show failed to start:", err);
    const fade = document.getElementById("fadeOverlay");
    if (fade) fade.style.opacity = 0;
  }
});

