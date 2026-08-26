const STORAGE_KEY = "ff_teams_data";
const OVERLAY_TITLE_KEY = "ff_overlay_title";
const MAX_TEAMS = 12;

function loadOverlayTitleData() {
  try {
    return JSON.parse(localStorage.getItem(OVERLAY_TITLE_KEY) || "{}") || {};
  } catch (err) {
    return {};
  }
}

function saveOverlayTitleData(titleData) {
  if (!titleData || (!titleData.main && !titleData.sub)) return;
  localStorage.setItem(OVERLAY_TITLE_KEY, JSON.stringify({
    main: titleData.main || "",
    sub: titleData.sub || ""
  }));
}

function applyStoredTitleToInputs() {
  const stored = loadOverlayTitleData();
  const ui = document.getElementById("userInput");
  const ve = document.querySelector(".title-esports");
  const vp = document.querySelector(".title-phase");

  if (ui && stored.main) {
    ui.value = stored.main;
  }
  if (ve && stored.main) {
    ve.value = stored.main;
  }
  if (vp && stored.sub) {
    vp.value = stored.sub;
  }
}

function attachOverlayTitleListeners() {
  const ui = document.getElementById("userInput");
  const ve = document.querySelector(".title-esports");
  const vp = document.querySelector(".title-phase");

  if (ui) {
    ui.addEventListener("input", () => {
      saveOverlayTitleData({ main: ui.value.trim(), sub: loadOverlayTitleData().sub || "" });
    });
  }

  if (ve || vp) {
    const update = () => {
      saveOverlayTitleData({
        main: ve ? ve.value.trim() : "",
        sub: vp ? vp.value.trim() : ""
      });
    };
    if (ve) ve.addEventListener("input", update);
    if (vp) vp.addEventListener("input", update);
  }

  window.addEventListener("storage", (event) => {
    if (event.key === OVERLAY_TITLE_KEY) {
      applyStoredTitleToInputs();
    }
  });
}

/* ==============================
   UPLOAD PAGE (index.html)
============================== */

/* ==============================
   SIMPLE WEBSITE PASSWORD PROTECTION
============================== */

// const WEBSITE_PASSWORD = "secret123";

// (function () {

//   // Prevent repeated asking during same session
//   const accessGranted = sessionStorage.getItem("ff_access");

//   if (accessGranted === "true") return;

//   const enteredPassword = prompt("Enter Website Password");

//   if (enteredPassword === WEBSITE_PASSWORD) {

//     sessionStorage.setItem("ff_access", "true");

//   } else {

//     document.body.innerHTML = `
//       <div style="
//         height:100vh;
//         display:flex;
//         justify-content:center;
//         align-items:center;
//         background:black;
//         color:white;
//         font-family:Arial;
//         flex-direction:column;
//       ">
//         <h1>ACCESS DENIED</h1>
//         <p>Incorrect Password</p>
//       </div>
//     `;

//     throw new Error("Access Denied");
//   }

// })();


async function proceed() {
  const fileInput = document.getElementById("logFile");

  if (!fileInput.files.length) {
    alert("Please upload a log file");
    return;
  }

  const files = Array.from(fileInput.files);

  const readFileText = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });

  // Process files one by one and save a new Supabase row for each uploaded file
  for (let i = 0; i < files.length; i++) {
    try {
      const text = await readFileText(files[i]);
      processLogAndStore(text);

      if (window.ffRefreshLiveSessionFromCurrentStandings) {
        const refreshResult = window.ffRefreshLiveSessionFromCurrentStandings();
        if (refreshResult && refreshResult._sbPromise) {
          try {
            await refreshResult._sbPromise;
          } catch (e) {}
        }
      }
    } catch (err) {
      console.error("Error reading file:", files[i].name, err);
    }
  }

  const teamsData = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  const teamCount = Object.keys(teamsData).length;

  if (teamCount > MAX_TEAMS) {
    window.location.href = "bg.html";
  } else {
    window.location.href = "b.html";
  }
}

function processMVP(text) {
  const MVP_KEY = "ff_mvp_players";
  if (!text || typeof text !== "string") return {};

  const lines = text.split("\n");
  let players = {};
  try {
    players = JSON.parse(localStorage.getItem(MVP_KEY) || "{}") || {};
  } catch (e) {
    players = {};
  }

  let currentTeamRank = 999;
  let currentTeamName = "UNKNOWN TEAM";

  lines.forEach(rawLine => {
    const line = rawLine.trim();

    if (line.startsWith("TeamName:")) {
      const teamMatch = line.match(/TeamName:\s(.+?)\s+Rank:/i) || line.match(/TeamName:\s(.+?)\s/i);
      const rankMatch = line.match(/Rank:\s+(\d+)/i) || line.match(/RankScore:\s*(\d+)/i);
      if (teamMatch) currentTeamName = teamMatch[1].trim();
      if (rankMatch) currentTeamRank = parseInt(rankMatch[1], 10);
      return;
    }

    if (line.startsWith("NAME:")) {
      const nameMatch = line.match(/NAME:\s(.+?)\s+ID:/i) || line.match(/NAME:\s(.+?)$/i);
      const killMatch = line.match(/KILL:\s+(\d+)/i) || line.match(/KILLS:\s*(\d+)/i);
      if (!nameMatch || !killMatch) return;

      const playerName = nameMatch[1].trim();
      const kills = parseInt(killMatch[1], 10);

      if (!players[playerName]) {
        players[playerName] = { name: playerName, team: currentTeamName, kills: 0, bestTeamRank: currentTeamRank };
      }
      players[playerName].kills += kills;
      players[playerName].team = currentTeamName;
      players[playerName].bestTeamRank = Math.min(players[playerName].bestTeamRank || 999, currentTeamRank);
    }
  });

  localStorage.setItem(MVP_KEY, JSON.stringify(players));
  return players;
}
window.processMVP = processMVP;

/* ==============================
   PROCESS LOG + MERGE DATA
   + AUTO BOOYAH
============================== */
function processLogAndStore(text) {
  const lines = text.split("\n");
  let teamsData = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};

  let booyahGiven = false;

  // also build MVP ranking data from the same uploaded log
  try {
    processMVP(text);
  } catch (err) {
    console.warn("MVP parse failed", err);
  }

  lines.forEach(line => {
    if (!line.startsWith("TeamName:")) return;

    const nameMatch = line.match(/TeamName:\s(.+?)\sRank/i);
    const killMatch = line.match(/KillScore:\s(\d+)/i);
    const rankMatch = line.match(/RankScore:\s(\d+)/i);
    const totalMatch = line.match(/TotalScore:\s(\d+)/i);

    if (!nameMatch || !killMatch || !rankMatch || !totalMatch) return;

    const name = nameMatch[1].trim().toUpperCase();
    

    if (!teamsData[name]) {
      teamsData[name] = {
        name,
        booyah: 0,
        games: 0,
        kills: 0,
        pos: 0,
        total: 0
      };
    }

    const kills = +killMatch[1];
    const pos = +rankMatch[1];
    const total = +totalMatch[1];

    teamsData[name].games += 1;
    teamsData[name].kills += kills;
    teamsData[name].pos += pos;
    teamsData[name].total += total;

    if (pos === 12 && !booyahGiven) {
      teamsData[name].booyah += 1;
      booyahGiven = true;
    }
  });

  localStorage.setItem(STORAGE_KEY, JSON.stringify(teamsData));
}



/* ==============================
   STANDINGS PAGE
============================== */
document.addEventListener("DOMContentLoaded", () => {

  const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (!data || Object.keys(data).length === 0) {
  alert("No data found. Please upload a file first.");
  return;
}


  const teams = Object.values(data).sort((a, b) => {

  // 1️⃣ TOTAL POINTS (highest first)
  if (b.total !== a.total) {
    return b.total - a.total;
  }

  // 2️⃣ BOOYAH COUNT (official FF tiebreaker)
  if ((b.booyah || 0) !== (a.booyah || 0)) {
    return (b.booyah || 0) - (a.booyah || 0);
  }

  // 3️⃣ ELIMINATIONS (kills)
  if (b.kills !== a.kills) {
    return b.kills - a.kills;
  }

  return 0;
});


  /* =====================
     NORMAL (standings.html)
  ===================== */
  const table = document.getElementById("tableBody");
  if (table) {
    table.innerHTML = "";
    teams.slice(0, MAX_TEAMS).forEach((t, i) => {
      table.innerHTML += `
        <div class="row">
          <div class="cell-rank">${i + 1}</div>
          <div class="cell-team">${t.name}</div>
          <div class="cell-stat">${t.games}</div>
          <div class="cell-stat">${t.booyah || 0}</div>
          <div class="cell-stat">${t.pos}</div>
          <div class="cell-stat">${t.kills}</div>
          <div class="cell-stat">${t.total}</div>
        </div>
      `;
    });
  }

  /* =====================
     VER VIEW (ver.html)
  ===================== */
  const verLeft = document.getElementById("verLeftTable");
  const verRight = document.getElementById("verRightTable");

  if (verLeft && verRight) {
    verLeft.innerHTML = "";
    verRight.innerHTML = "";

    const verTeams = teams.slice(0, MAX_TEAMS);
    const verLeftTeams = verTeams.slice(0, 6);
    const verRightTeams = verTeams.slice(6, 12);

    const renderVerRow = (t, rank, container) => {
      const rowClass = rank === 1 ? "ver-row rank-first" : "ver-row";
      container.innerHTML += `
        <div class="${rowClass}">
          <div class="ver-rank"><span>${rank}</span></div>
          <div class="ver-bar">
            <div class="ver-team">${t.name}</div>
            <div class="ver-stat">${t.pos}</div>
            <div class="ver-stat">${t.kills}</div>
            <div class="ver-stat">${t.total}</div>
          </div>
        </div>
      `;
    };

    verLeftTeams.forEach((t, i) => renderVerRow(t, i + 1, verLeft));
    verRightTeams.forEach((t, i) => renderVerRow(t, i + 7, verRight));
  }

  /* =====================
     HORIZONTAL (bg.html)
  ===================== */
  const left = document.getElementById("leftTable");
  const right = document.getElementById("rightTable");

  if (left && right) {
    left.innerHTML = "";
    right.innerHTML = "";

    const safeTeams = teams.slice(0, 18);

const leftCount = Math.ceil(safeTeams.length / 2);
const leftTeams = safeTeams.slice(0, leftCount);
const rightTeams = safeTeams.slice(leftCount);

    const render = (list, container, offset) => {
      list.forEach((t, i) => {
        container.innerHTML += `
          <div class="row">
            <div class="rank">${offset + i + 1}</div>
            <div class="team">${t.name}</div>
            <div class="cell">${t.booyah || 0}</div>
            <div class="cell">${t.games}</div>
            <div class="cell">${t.pos}</div>
            <div class="cell">${t.kills}</div>
            <div class="cell">${t.total}</div>
          </div>
        `;
      });
    };

    render(leftTeams, left, 0);
    render(rightTeams, right, leftTeams.length);
  }


  /* DOWNLOAD BUTTON */
  const downloadBtn = document.getElementById("downloadBtn");
  if (downloadBtn) {
    downloadBtn.onclick = downloadImage;
  }

  /* UPLOAD MORE BUTTON */
  const uploadMoreBtn = document.getElementById("uploadMoreBtn");
  if (uploadMoreBtn) {
    uploadMoreBtn.onclick = () => {
      window.location.href = "index.html";
    };
  }

  /* RESET BUTTON */
  const resetBtn = document.getElementById("resetBtn");
  if (resetBtn) {
    resetBtn.onclick = resetStandings;
  }

  applyStoredTitleToInputs();
  attachOverlayTitleListeners();
});

/* ==============================
   DOWNLOAD IMAGE
============================== */
function downloadImage() {
  const poster = document.querySelector(".poster");
  const elementsToHide = document.querySelectorAll(".no-export");

  // Hide buttons
  elementsToHide.forEach(el => el.style.display = "none");

  // 🔥 STEP 1: Replace inputs with text
  const inputs = poster.querySelectorAll("input");
  const inputReplacements = [];

  inputs.forEach(input => {
    const span = document.createElement("span");

    span.innerText = (input.value || "").toUpperCase(); // FORCE UPPERCASE
    span.className = input.className;

    // copy font styles (important)
    const style = window.getComputedStyle(input);
    span.style.fontSize = style.fontSize;
    span.style.fontWeight = style.fontWeight;
    span.style.textAlign = style.textAlign;
    span.style.width = style.width;
    span.style.display = "inline-block";

    inputReplacements.push({
      parent: input.parentNode,
      input: input,
      span: span
    });

    input.parentNode.replaceChild(span, input);
  });

  // 🔥 STEP 2: Capture image
  html2canvas(poster, { scale: 2 }).then(canvas => {
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = "ff-standings.png";
    link.click();

    // 🔁 STEP 3: Restore inputs back
    inputReplacements.forEach(item => {
      item.parent.replaceChild(item.input, item.span);
    });

    // Show buttons again
    elementsToHide.forEach(el => el.style.display = "flex");
  });
}



/* ==============================
   RESET STANDINGS
============================== */
function clearBroadcastState() {
  [
    STORAGE_KEY,
    "ff_mvp_players",
    "ff_overlays_v1",
    "ff_live_session_v1",
    "ff_live_session_signal",
    "ff_overlay_title"
  ].forEach(key => localStorage.removeItem(key));
}

async function resetStandings() {
  const confirmReset = confirm("Are you sure you want to reset all standings?");
  if (!confirmReset) return;

  // Retrieve current session ID before clearing
  let sessionId = null;
  try {
    const sessionObj = JSON.parse(localStorage.getItem("ff_live_session_v1") || "null");
    if (sessionObj && sessionObj.id) sessionId = sessionObj.id;
  } catch(e) {}

  clearBroadcastState();

  // Delete from Supabase cloud database
  if (typeof sbDeleteOverlays === "function") {
    try {
      await sbDeleteOverlays(sessionId);
    } catch(e) {}
  }

  window.location.href = "index.html";
}
