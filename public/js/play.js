// Áp dụng cấu hình tên/slogan
document.addEventListener("DOMContentLoaded", () => applyAppConfig());

const socket = io();

const SHAPES = ["▲", "◆", "●", "■"];
const COLORS = ["#e21b3c", "#1368ce", "#d89e00", "#26890c"];

const STORAGE_KEY = "vn_employee";

let myName = "";
let myScore = 0;
let myPhongBan = "";
let myMSNV = "";
let timerInterval = null;
let timeLeft = 0;
let totalTime = 0;
let hasAnswered = false;
let currentData = null;

// ─── KIỂM TRA SESSION & HIỆN THÔNG TIN NHÂN VIÊN ────────────

(function initPlayer() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    // Chưa đăng nhập → hiện cảnh báo, ẩn form
    document.getElementById("no-session-warn").style.display = "block";
    document.getElementById("join-form").style.display = "none";
    document.getElementById("btn-join").style.display = "none";
    return;
  }

  try {
    const emp = JSON.parse(saved);
    if (!emp || !emp.msnv) throw new Error("invalid");

    myMSNV = emp.msnv;
    myName = emp.hoTen || emp.msnv;
    myPhongBan = emp.phongBan || "";

    // Hiện thẻ thông tin nhân viên
    const card = document.getElementById("emp-card");
    document.getElementById("emp-card-name").textContent = myName;
    document.getElementById("emp-card-dept").textContent = [
      emp.phongBan,
      emp.congDoan,
    ]
      .filter(Boolean)
      .join(" — ");
    card.style.display = "block";
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    document.getElementById("no-session-warn").style.display = "block";
    document.getElementById("join-form").style.display = "none";
    document.getElementById("btn-join").style.display = "none";
  }
})();

// Lấy PIN từ URL nếu có
const urlPin = new URLSearchParams(location.search).get("pin");
if (urlPin) {
  const pinEl = document.getElementById("input-pin");
  if (pinEl) pinEl.value = urlPin;
}

document.getElementById("input-pin")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinGame();
});

// ─── JOIN ────────────────────────────────────────────────────

function joinGame() {
  const pin = document.getElementById("input-pin").value.trim();

  if (!pin || pin.length !== 6) {
    showJoinError("Mã PIN phải có 6 chữ số!");
    return;
  }

  if (!myMSNV) {
    showJoinError("Ban chua dang nhap! Vui long quay lai trang chu.");
    return;
  }

  document.getElementById("join-error").style.display = "none";
  socket.emit("join-game", { pin, msnv: myMSNV.toUpperCase(), name: "" });
}

function showJoinError(msg) {
  const el = document.getElementById("join-error");
  el.textContent = msg;
  el.style.display = "block";
}

// ─── SOCKET EVENTS ──────────────────────────────────────────

socket.on("join-success", ({ name, phongBan }) => {
  myName = name;
  myPhongBan = phongBan || "";
  document.getElementById("player-name-display").textContent = name;

  const deptEl = document.getElementById("player-dept-display");
  if (deptEl) {
    deptEl.textContent = phongBan ? phongBan : "";
    deptEl.style.display = phongBan ? "" : "none";
  }
  showScreen("screen-lobby");
});

socket.on("join-error", (msg) => showJoinError(msg));

socket.on("player-joined", ({ players }) => {
  document.getElementById("lobby-count").textContent = players.length;
  const el = document.getElementById("lobby-players-play");
  el.innerHTML = players
    .map(
      (p) =>
        `<div class="player-tag">${escHtml(p.name)}${p.phongBan ? `<span style="font-size:0.75rem;opacity:0.7;margin-left:4px">(${escHtml(p.phongBan)})</span>` : ""}</div>`,
    )
    .join("");
});

socket.on("player-left", ({ players }) => {
  document.getElementById("lobby-count").textContent = players.length;
  const el = document.getElementById("lobby-players-play");
  if (el)
    el.innerHTML = players
      .map((p) => `<div class="player-tag">${escHtml(p.name)}</div>`)
      .join("");
});

socket.on("game-starting", () => {
  showScreen("screen-starting");
  let count = 3;
  const el = document.getElementById("countdown-num");
  el.textContent = count;
  const iv = setInterval(() => {
    count--;
    if (count > 0) el.textContent = count;
    else clearInterval(iv);
  }, 1000);
});

socket.on("new-question", (data) => {
  currentData = data;
  hasAnswered = false;
  renderQuestion(data);
  showScreen("screen-question");
});

socket.on("answer-received", ({ answerIndex }) => {
  document.querySelectorAll(".answer-btn").forEach((btn, i) => {
    btn.disabled = true;
    if (i === answerIndex) btn.classList.add("selected");
  });
  showScreen("screen-waiting");
});

socket.on(
  "your-result",
  ({ isCorrect, pointsEarned, totalScore, rank, streak }) => {
    myScore = totalScore;
    renderResult(isCorrect, pointsEarned, totalScore, rank, streak);
    showScreen("screen-result");
  },
);

socket.on("leaderboard-update", ({ leaderboard }) => {
  setTimeout(() => {
    renderPlayLeaderboard(leaderboard);
    showScreen("screen-leaderboard");
  }, 3000);
});

socket.on("game-over", ({ leaderboard, deptLeaderboard }) => {
  stopTimer();
  renderPlayGameOver(leaderboard, deptLeaderboard);
  showScreen("screen-gameover");
  const myEntry = leaderboard.find((e) => e.name === myName);
  if (myEntry && myEntry.rank <= 3) launchConfetti();
});

socket.on("host-left", () => {
  stopTimer();
  showScreen("screen-host-left");
});

// ─── QUESTION ───────────────────────────────────────────────

function renderQuestion(data) {
  document.getElementById("q-meta").textContent =
    `Cau ${data.index + 1}/${data.total}`;
  document.getElementById("q-question-text").textContent = data.question;
  document.getElementById("q-my-score").textContent = myScore.toLocaleString();

  const grid = document.getElementById("q-answers");
  grid.innerHTML = data.options
    .map(
      (opt, i) => `
    <button class="answer-btn a${i}" onclick="submitAnswer(${i})">
      <span class="shape">${SHAPES[i]}</span>
      <span class="answer-text">${escHtml(opt)}</span>
    </button>
  `,
    )
    .join("");

  const elapsed = (Date.now() - data.sentAt) / 1000;
  totalTime = data.timeLimit;
  timeLeft = Math.max(0, data.timeLimit - elapsed);
  startCountdown();
}

function submitAnswer(answerIndex) {
  if (hasAnswered) return;
  hasAnswered = true;
  stopTimer();
  socket.emit("submit-answer", { answerIndex, timeLeft: Math.round(timeLeft) });
}

function startCountdown() {
  stopTimer();
  const timerEl = document.getElementById("q-timer");
  const barEl = document.getElementById("q-timer-bar");

  const update = () => {
    const pct = (timeLeft / totalTime) * 100;
    timerEl.textContent = Math.ceil(timeLeft);
    barEl.style.width = `${pct}%`;
    if (timeLeft <= 5) {
      timerEl.classList.add("urgent");
      barEl.classList.add("urgent");
    } else {
      timerEl.classList.remove("urgent");
      barEl.classList.remove("urgent");
    }
  };

  update();
  timerInterval = setInterval(() => {
    timeLeft -= 0.1;
    if (timeLeft <= 0) {
      timeLeft = 0;
      update();
      stopTimer();
      if (!hasAnswered) {
        hasAnswered = true;
        showScreen("screen-waiting");
        document.getElementById("waiting-icon").textContent = "⏰";
        document.getElementById("waiting-text").textContent = "Het gio!";
      }
      return;
    }
    update();
  }, 100);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// ─── RESULT ─────────────────────────────────────────────────

function renderResult(isCorrect, pointsEarned, totalScore, rank, streak) {
  document.getElementById("result-icon").textContent = isCorrect ? "🎯" : "😢";
  document.getElementById("result-title").textContent = isCorrect
    ? "Chính xác!"
    : "Sai mất rồi!";
  document.getElementById("result-title").style.color = isCorrect
    ? "#26890c"
    : "#e21b3c";
  document.getElementById("result-points").textContent = isCorrect
    ? `+${pointsEarned}`
    : "+0";
  document.getElementById("result-points").style.color = isCorrect
    ? "#EE0000"
    : "rgba(0,0,0,0.3)";
  document.getElementById("result-total-score").textContent =
    totalScore.toLocaleString();
  document.getElementById("result-rank").textContent = `Hang #${rank}`;

  let streakText = "";
  if (streak >= 3) streakText = `🔥 ${streak} câu đúng liên tiếp!`;
  else if (streak === 2) streakText = "⚡ 2 câu đúng liên tiếp!";
  document.getElementById("result-streak").textContent = streakText;
}

// ─── LEADERBOARD ────────────────────────────────────────────

function renderPlayLeaderboard(leaderboard) {
  const el = document.getElementById("play-leaderboard");
  el.innerHTML = renderLeaderboardItems(leaderboard, true);
}

function renderLeaderboardItems(leaderboard, showMe = false) {
  const medals = ["🥇", "🥈", "🥉"];
  return leaderboard
    .map((item) => {
      const cls = item.rank <= 3 ? `top${item.rank}` : "";
      const icon = medals[item.rank - 1] || `#${item.rank}`;
      const isMe = showMe && item.name === myName;
      const meBorder = isMe ? "border:2px solid #EE0000;" : "";
      const meTag = isMe
        ? ' <span style="color:#EE0000;font-size:0.75rem">(bạn)</span>'
        : "";
      return `
    <div class="lb-item ${cls}" style="${meBorder}">
      <div class="lb-rank">${icon}</div>
      <div class="lb-name">${escHtml(item.name)}${meTag}${item.phongBan ? `<div style="font-size:0.75rem;opacity:0.6">${escHtml(item.phongBan)}</div>` : ""}</div>
      <div class="lb-score">${item.score.toLocaleString()}</div>
    </div>`;
    })
    .join("");
}

function renderDeptLeaderboard(deptLeaderboard, elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!deptLeaderboard || deptLeaderboard.length === 0) {
    el.innerHTML =
      '<div style="opacity:0.5;font-size:0.85rem;padding:12px">Chưa có dữ liệu đơn vị</div>';
    return;
  }
  const medals = ["🥇", "🥈", "🥉"];
  el.innerHTML = deptLeaderboard
    .map((d) => {
      const cls = d.rank <= 3 ? `top${d.rank}` : "";
      const icon = medals[d.rank - 1] || `#${d.rank}`;
      return `
    <div class="lb-item ${cls}">
      <div class="lb-rank">${icon}</div>
      <div class="lb-name">
        <strong>${escHtml(d.name)}</strong>
        <div style="font-size:0.75rem;opacity:0.6">${d.count} người | TB ${d.avgScore.toLocaleString()} điểm</div>
      </div>
      <div class="lb-score">${d.totalScore.toLocaleString()}</div>
    </div>`;
    })
    .join("");
}

// ─── GAME OVER ────────────────────────────────────────────────

function renderPlayGameOver(leaderboard, deptLeaderboard) {
  const myEntry = leaderboard.find((e) => e.name === myName);
  const banner = document.getElementById("play-result-banner");

  if (myEntry) {
    const medals = ["🥇", "🥈", "🥉"];
    const icon = medals[myEntry.rank - 1] || `#${myEntry.rank}`;
    banner.innerHTML = `Bạn đạt hạng <strong>${icon}</strong> với <strong style="color:#EE0000">${myEntry.score.toLocaleString()} điểm</strong>!`;
  }

  document.getElementById("play-final-leaderboard").innerHTML =
    renderLeaderboardItems(leaderboard, true);
  renderDeptLeaderboard(deptLeaderboard, "play-dept-leaderboard");
}

// ─── HELPERS ────────────────────────────────────────────────

function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.add("hidden"));
  document.getElementById(id)?.classList.remove("hidden");
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function launchConfetti() {
  const wrap = document.getElementById("confetti-wrap-play");
  const colors = [
    "#EE0000",
    "#ff6b6b",
    "#74b9ff",
    "#55efc4",
    "#fd79a8",
    "#ffd700",
  ];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.cssText = `
      left:${Math.random() * 100}%;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      animation-duration:${1.5 + Math.random() * 2}s;
      animation-delay:${Math.random() * 1.5}s;
      transform:rotate(${Math.random() * 360}deg);
      width:${6 + Math.random() * 8}px;
      height:${10 + Math.random() * 12}px;
    `;
    wrap.appendChild(piece);
  }
  setTimeout(() => {
    wrap.innerHTML = "";
  }, 5000);
}
