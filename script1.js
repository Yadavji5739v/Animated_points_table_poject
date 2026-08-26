const MVP_KEY = "ff_mvp_players";

/* ==========================
   SCALE POSTER TO FIT SCREEN — always perfect 16:9, no stretching
========================== */
function scalePoster() {
  const poster = document.querySelector(".poster");
  if (!poster) return;
  const scale = Math.min(
    window.innerWidth  / 1920,
    window.innerHeight / 1080
  );
  poster.style.transform = `scale(${scale})`;
}
window.addEventListener("resize", scalePoster);
document.addEventListener("DOMContentLoaded", scalePoster);

/* ==========================
   FILE UPLOAD
========================== */
document.addEventListener("DOMContentLoaded", () => {
  const input  = document.getElementById("logFile");
  const status = document.getElementById("statusText");
  if (!input) return;

  input.addEventListener("change", function () {
    if (!this.files || this.files.length === 0) return;
    const file = this.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      processMVP(e.target.result);
      if (status) status.textContent = "File uploaded successfully ✓";
      this.value = "";
    };
    reader.onerror = () => console.error("❌ File read failed");
    reader.readAsText(file);
  });
});

/* =====================================================
   PROCESS MVP DATA
===================================================== */
function processMVP(text) {
  const lines = text.split("\n");
  let players = JSON.parse(localStorage.getItem(MVP_KEY)) || {};
  let currentTeamRank = 999;
  let currentTeamName = "UNKNOWN TEAM";

  lines.forEach(rawLine => {
    const line = rawLine.trim();

    if (line.startsWith("TeamName:")) {
      const teamMatch = line.match(/TeamName:\s(.+?)\s+Rank:/);
      const rankMatch = line.match(/Rank:\s+(\d+)/);
      if (teamMatch) currentTeamName = teamMatch[1].trim();
      if (rankMatch) currentTeamRank = parseInt(rankMatch[1]);
      return;
    }

    if (line.startsWith("NAME:")) {
      const nameMatch = line.match(/NAME:\s(.+?)\s+ID:/);
      const killMatch = line.match(/KILL:\s+(\d+)/);
      if (!nameMatch || !killMatch) return;

      const playerName = nameMatch[1].trim();
      const kills      = parseInt(killMatch[1]);

      if (!players[playerName]) {
        players[playerName] = { name: playerName, team: currentTeamName, kills: 0, bestTeamRank: currentTeamRank };
      }
      players[playerName].kills += kills;
      players[playerName].team   = currentTeamName;
      players[playerName].bestTeamRank = Math.min(players[playerName].bestTeamRank, currentTeamRank);
    }
  });

  localStorage.setItem(MVP_KEY, JSON.stringify(players));
}

/* =====================================================
   LOAD MVP PAGE
===================================================== */
function loadMVP() {
  scalePoster();

  const data = JSON.parse(localStorage.getItem(MVP_KEY));
  if (!data || Object.keys(data).length === 0) return;

  const players = Object.values(data);
  players.sort((a, b) => b.kills !== a.kills ? b.kills - a.kills : a.bestTeamRank - b.bestTeamRank);

  const [first, second, third] = players;
  if (first)  fillCard("mvp1", first);
  if (second) fillCard("mvp2", second);
  if (third)  fillCard("mvp3", third);
}

/* =====================================================
   FILL CARD
===================================================== */
function fillCard(id, player) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `
    <div class="card-info">
      <div class="kills-line">KILLS: <span class="kills-val">${player.kills}</span></div>
      <div class="ign-line">IGN: <span class="ign-val">${player.name}</span></div>
      <div class="team-line">TEAM NAME: <span class="team-val">${player.team}</span></div>
    </div>
  `;
}

/* =====================================================
   DOWNLOAD — captures the real 1920x1080 poster directly
   by temporarily removing the scale transform
===================================================== */
function downloadMVP() {
  const poster       = document.querySelector(".poster");
  const hideElements = document.querySelectorAll(".no-export");
  if (!poster) return;

  // Step 1: remove scale so html2canvas sees real 1920x1080 pixels
  poster.style.transform = "none";
  hideElements.forEach(el => el.style.visibility = "hidden");

  // Step 2: capture at exactly 1920x1080 (scale:1 = 1px per px)
  html2canvas(poster, {
    scale: 1,
    useCORS: true,
    allowTaint: true,
    backgroundColor: null,
    width: 1920,
    height: 1080,
    x: 0,
    y: 0
  }).then(canvas => {
    const link    = document.createElement("a");
    link.href     = canvas.toDataURL("image/png");
    link.download = "match-mvp.png";
    link.click();
  }).finally(() => {
    // Step 3: restore scale
    scalePoster();
    hideElements.forEach(el => el.style.visibility = "");
  });
}

/* =====================================================
   NAVIGATION & RESET
===================================================== */
function goBack() {
  window.location.href = "index.html";
}

function resetMVP() {
  if (!confirm("Reset MVP data?")) return;
  localStorage.removeItem(MVP_KEY);
  location.reload();
}

function goToMVP() {
  const data = localStorage.getItem("ff_mvp_players");
  if (!data || data === "{}") {
    alert("Please upload a log file first");
    return;
  }
  window.location.href = "mvp.html";
}