// Kiểm tra quyền admin từ localStorage
(function checkAdminAccess() {
  const STORAGE_KEY = "vn_employee";
  const saved = localStorage.getItem(STORAGE_KEY);
  const logoutAndRedirect = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    location.href = "index.html";
  };

  if (!saved) {
    logoutAndRedirect();
    return;
  }
  try {
    const emp = JSON.parse(saved);
    if (!emp || !emp.isAdmin) {
      logoutAndRedirect();
      return;
    }
  } catch {
    logoutAndRedirect();
  }
})();

// Áp dụng cấu hình tên/slogan
document.addEventListener("DOMContentLoaded", () => applyAppConfig());

const socket = io();

const SHAPES = ["▲", "◆", "●", "■"];
const COLORS = ["#e21b3c", "#1368ce", "#d89e00", "#26890c"];

let questions = [];
let currentPin = null;
let timerInterval = null;
let timeLeft = 0;
let totalTime = 0;

// Lưu kết quả cuối để xuất file
let finalLeaderboardData = [];
let finalDeptLeaderboardData = [];

// ─── QUIZ BUILDER ───────────────────────────────────────────

function renderOptionFields() {
  const container = document.getElementById("options-container");
  container.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const row = document.createElement("div");
    row.className = "option-row";
    row.innerHTML = `
      <span class="option-shape" style="color:${COLORS[i]}">${SHAPES[i]}</span>
      <input type="text" class="input-dark" id="opt-${i}" placeholder="Lua chon ${i + 1}" maxlength="120" style="flex:1" />
      <label class="correct-radio">
        <input type="radio" name="correct" value="${i}" id="correct-${i}" /> Dung
      </label>`;
    container.appendChild(row);
  }
  document.getElementById("correct-0").checked = true;
}

function addQuestion() {
  const text = document.getElementById("q-text").value.trim();
  const options = [0, 1, 2, 3].map((i) =>
    document.getElementById(`opt-${i}`).value.trim(),
  );
  const correctEl = document.querySelector('input[name="correct"]:checked');
  const timeLimit = parseInt(document.getElementById("q-time").value);
  const points = parseInt(document.getElementById("q-points").value);

  if (!text) {
    showBuildError("Vui long nhap cau hoi!");
    return;
  }
  if (options.some((o) => !o)) {
    showBuildError("Vui long dien du 4 lua chon!");
    return;
  }
  if (!correctEl) {
    showBuildError("Vui long chon dap an dung!");
    return;
  }

  document.getElementById("build-error").style.display = "none";
  questions.push({
    question: text,
    options,
    correctAnswer: parseInt(correctEl.value),
    timeLimit,
    points,
  });

  document.getElementById("q-text").value = "";
  [0, 1, 2, 3].forEach((i) => {
    document.getElementById(`opt-${i}`).value = "";
  });
  document.getElementById("correct-0").checked = true;
  document.getElementById("q-text").focus();
  renderQuestionList();
}

function showBuildError(msg) {
  const el = document.getElementById("build-error");
  el.textContent = msg;
  el.style.display = "block";
}

// ─── LOAD TỪ SERVER (CSDL/NHCH.xlsx) ───────────────────────

async function loadFromNHCH() {
  const statusEl = document.getElementById("import-status");
  statusEl.style.display = "block";
  statusEl.style.color = "#555";
  statusEl.textContent = "Đang tải từ NHCH.xlsx...";

  try {
    const res = await fetch("/api/questions");
    const data = await res.json();
    if (!res.ok) {
      statusEl.style.color = "#e21b3c";
      statusEl.textContent = "Lỗi: " + (data.error || "Không tải được!");
      return;
    }
    questions.push(...data.questions);
    statusEl.style.color = "#26890c";
    statusEl.textContent = `Đã tải ${data.count} câu hỏi từ NHCH.xlsx (có thời gian & điểm riêng từng câu)!`;
    renderQuestionList();
  } catch (err) {
    statusEl.style.color = "#e21b3c";
    statusEl.textContent = "Không thể kết nối máy chủ: " + err.message;
  }
}

// ─── IMPORT EXCEL ───────────────────────────────────────────
// Hỗ trợ cột tùy chọn: "thời gian" (giây/câu), "điểm" (điểm/câu)

async function importFromExcel(input) {
  const file = input.files[0];
  if (!file) return;

  const statusEl = document.getElementById("import-status");
  statusEl.style.display = "block";
  statusEl.style.color = "#555";
  statusEl.textContent = "Dang doc file...";

  if (typeof XLSX === "undefined") {
    await loadScript(
      "https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js",
    );
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

      if (rows.length === 0) {
        statusEl.style.color = "#e21b3c";
        statusEl.textContent = "File trong hoac khong co du lieu!";
        return;
      }

      const firstRow = rows[0];
      const headers = Object.keys(firstRow);

      const colQ = headers.find((h) => normalize(h).includes("cau hoi"));
      const colCorrect = headers.find((h) =>
        normalize(h).includes("dap an dung"),
      );
      // Cột tùy chọn: thời gian và điểm per-row
      const colTime = headers.find((h) => normalize(h).includes("thoi gian"));
      const colPoints = headers.find(
        (h) => normalize(h) === "diem" || normalize(h).includes("diem"),
      );

      if (!colQ || !colCorrect) {
        statusEl.style.color = "#e21b3c";
        statusEl.textContent =
          'Khong tim thay cot "cau hoi" hoac "dap an dung"!';
        return;
      }

      const colOptions = headers.filter((h) =>
        normalize(h).includes("phuong an"),
      );
      colOptions.sort();

      if (colOptions.length < 2) {
        statusEl.style.color = "#e21b3c";
        statusEl.textContent = 'Can it nhat 2 cot "phuong an"!';
        return;
      }

      // Giá trị mặc định từ UI (dùng khi cột không có trong file)
      const defaultTime =
        parseInt(document.getElementById("q-time").value) || 20;
      const defaultPts =
        parseInt(document.getElementById("q-points").value) || 1000;

      let imported = 0;
      rows.forEach((row) => {
        const questionText = String(row[colQ] || "").trim();
        const correctAnswer = String(row[colCorrect] || "").trim();
        if (!questionText || !correctAnswer) return;

        const allOptions = colOptions
          .map((c) => String(row[c] || "").trim())
          .filter((v) => v !== "");
        if (allOptions.length < 2) return;

        let correctIdx = allOptions.findIndex(
          (o) => o.toLowerCase() === correctAnswer.toLowerCase(),
        );
        if (correctIdx === -1) {
          const num = parseInt(correctAnswer);
          if (!isNaN(num) && num >= 1 && num <= allOptions.length)
            correctIdx = num - 1;
        }
        if (correctIdx === -1) return;

        // Đọc timeLimit và points per-row nếu có cột
        const timeLimit = colTime
          ? parseInt(row[colTime]) || defaultTime
          : defaultTime;
        const pts = colPoints
          ? parseInt(row[colPoints]) || defaultPts
          : defaultPts;

        questions.push({
          question: questionText,
          options: allOptions,
          correctAnswer: correctIdx,
          timeLimit,
          points: pts,
        });
        imported++;
      });

      if (imported === 0) {
        statusEl.style.color = "#e21b3c";
        statusEl.textContent =
          "Không import được. VUi lòng kiểm tra lại định dạng file!";
      } else {
        statusEl.style.color = "#26890c";
        const hasPerRow = colTime || colPoints;
        statusEl.textContent = `Đã import ${imported} câu hỏi thành công!${hasPerRow ? " (co cot thoi gian/diem rieng tung cau)" : ""}`;
        renderQuestionList();
      }
    } catch (err) {
      statusEl.style.color = "#e21b3c";
      statusEl.textContent = "Lỗi đọc file: " + err.message;
    }
    input.value = "";
  };
  reader.readAsArrayBuffer(file);
}

function normalize(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .trim();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ─── QUESTION LIST ──────────────────────────────────────────

function renderQuestionList() {
  const list = document.getElementById("question-list");
  const badge = document.getElementById("q-count-badge");
  const btnHost = document.getElementById("btn-host-game");

  badge.textContent = `${questions.length} câu`;
  btnHost.disabled = questions.length === 0;

  if (questions.length === 0) {
    list.innerHTML =
      '<div style="text-align:center;opacity:0.5;padding:24px"Chưa có câu hỏi nào</div>';
    return;
  }
  list.innerHTML = questions
    .map(
      (q, i) => `
    <div class="question-item">
      <div class="question-item-num">${i + 1}</div>
      <div class="question-item-text" title="${escHtml(q.question)}">${escHtml(q.question)}</div>
      <span style="font-size:0.8rem;opacity:0.6;margin-right:6px">${q.timeLimit}s | ${q.points}pt | ${q.options.length} pa</span>
      <button class="question-item-del" onclick="deleteQuestion(${i})" title="Xóa">✕</button>
    </div>`,
    )
    .join("");
}

function deleteQuestion(idx) {
  questions.splice(idx, 1);
  renderQuestionList();
}

function clearQuestions() {
  if (questions.length === 0) return;
  if (confirm("Bạn có chắc chắn xóa tất cả ngân hàng câu hỏi?")) {
    questions = [];
    renderQuestionList();
  }
}

function loadSampleQuiz() {
  questions = [
    {
      question: "Thu do cua Viet Nam la gi?",
      options: ["TP. Ho Chi Minh", "Ha Noi", "Da Nang", "Hue"],
      correctAnswer: 1,
      timeLimit: 20,
      points: 1000,
    },
    {
      question: "1 + 1 = ?",
      options: ["1", "2", "3", "4"],
      correctAnswer: 1,
      timeLimit: 10,
      points: 500,
    },
    {
      question: "Mau cua bau troi ban ngay la?",
      options: ["Do", "Vang", "Xanh lam", "Tim"],
      correctAnswer: 2,
      timeLimit: 15,
      points: 1000,
    },
    {
      question: "Viettel duoc thanh lap nam nao?",
      options: ["1987", "1989", "1995", "2000"],
      correctAnswer: 1,
      timeLimit: 20,
      points: 1000,
    },
    {
      question: "Trai dat quay quanh mat troi mat bao lau?",
      options: ["24 gio", "7 ngay", "365 ngay", "100 ngay"],
      correctAnswer: 2,
      timeLimit: 20,
      points: 1000,
    },
  ];
  renderQuestionList();
}

function hostGame() {
  if (questions.length === 0) return;
  socket.emit("create-game", { questions });
}

// ─── SOCKET EVENTS — HOST ───────────────────────────────────

socket.on("game-created", ({ pin }) => {
  currentPin = pin;
  document.getElementById("pin-display").textContent = pin;
  document.getElementById("lobby-q-info").textContent =
    `${questions.length} cau hoi`;
  showScreen("screen-lobby");
});

socket.on("player-joined", ({ name, players }) => {
  document.getElementById("lobby-count").textContent = players.length;
  const btn = document.getElementById("btn-start");
  btn.disabled = players.length === 0;
  document.getElementById("start-hint").style.display =
    players.length > 0 ? "none" : "";
  renderLobbyPlayers(players);
  flashMessage(`${name} da vao! 🎉`);
});

socket.on("player-left", ({ players }) => {
  document.getElementById("lobby-count").textContent = players.length;
  document.getElementById("btn-start").disabled = players.length === 0;
  renderLobbyPlayers(players);
});

socket.on("new-question", (data) => {
  showScreen("screen-game");
  renderHostQuestion(data);
});

socket.on("answer-count", ({ count, total }) => {
  document.getElementById("answers-in").textContent = count;
  document.getElementById("answers-total").textContent = total;
});

socket.on(
  "question-results",
  ({
    correctAnswer,
    answerCounts,
    leaderboard,
    deptLeaderboard,
    isLastQuestion,
  }) => {
    stopTimer();
    renderQuestionResults(
      correctAnswer,
      answerCounts,
      leaderboard,
      deptLeaderboard,
      isLastQuestion,
    );
    showScreen("screen-results");
  },
);

socket.on("game-over", ({ leaderboard, deptLeaderboard }) => {
  stopTimer();
  finalLeaderboardData = leaderboard;
  finalDeptLeaderboardData = deptLeaderboard;
  renderFinalLeaderboard(leaderboard, deptLeaderboard);
  showScreen("screen-gameover");
  launchConfetti();
});

// ─── LOBBY ──────────────────────────────────────────────────

function renderLobbyPlayers(players) {
  const el = document.getElementById("lobby-players");
  el.innerHTML = players
    .map(
      (p) =>
        `<div class="player-tag">${escHtml(p.name)}${p.phongBan ? `<span style="font-size:0.72rem;opacity:0.65;margin-left:4px">(${escHtml(p.phongBan)})</span>` : ""}</div>`,
    )
    .join("");
}

function startGame() {
  socket.emit("start-game");
}

// ─── GAME CONTROL ───────────────────────────────────────────

function renderHostQuestion(data) {
  document.getElementById("host-q-meta").textContent =
    `Cau ${data.index + 1}/${data.total}`;
  document.getElementById("host-question-text").textContent = data.question;
  document.getElementById("host-points-badge").textContent =
    `⭐ ${data.points}`;
  document.getElementById("answers-in").textContent = "0";
  document.getElementById("answers-total").textContent = "?";

  const preview = document.getElementById("host-answer-preview");
  preview.innerHTML = data.options
    .map(
      (opt, i) => `
    <div class="answer-btn a${i}" style="opacity:0.85;cursor:default;pointer-events:none;min-height:56px;font-size:0.9rem">
      <span class="shape">${SHAPES[i]}</span>
      <span class="answer-text">${escHtml(opt)}</span>
    </div>`,
    )
    .join("");

  totalTime = data.timeLimit;
  timeLeft = data.timeLimit;
  startTimer();
}

function startTimer() {
  stopTimer();
  const timerEl = document.getElementById("host-timer");
  const barEl = document.getElementById("host-timer-bar");
  timerEl.textContent = timeLeft;
  barEl.style.width = "100%";
  barEl.classList.remove("urgent");

  timerInterval = setInterval(() => {
    timeLeft--;
    const pct = (timeLeft / totalTime) * 100;
    timerEl.textContent = timeLeft;
    barEl.style.width = `${pct}%`;
    if (timeLeft <= 5) {
      timerEl.classList.add("urgent");
      barEl.classList.add("urgent");
    }
    if (timeLeft <= 0) stopTimer();
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}
function showResults() {
  socket.emit("show-question-results");
}
function nextQuestion() {
  socket.emit("next-question");
}
function endGame() {
  if (confirm("Ket thuc game ngay bay gio?")) socket.emit("end-game");
}

// ─── RESULTS ────────────────────────────────────────────────

function renderQuestionResults(
  correctAnswer,
  answerCounts,
  leaderboard,
  deptLeaderboard,
  isLastQuestion,
) {
  const maxCount = Math.max(...answerCounts, 1);
  const barsEl = document.getElementById("answer-bars");
  const opts = questions[getCurrentQIdx()]?.options || [];

  barsEl.innerHTML = answerCounts
    .map((count, i) => {
      const widthPct = Math.round((count / maxCount) * 100);
      const isCorrect = i === correctAnswer;
      return `
    <div class="answer-bar-row">
      <div class="answer-bar-label" style="color:${COLORS[i % COLORS.length]}">${SHAPES[i % SHAPES.length]}</div>
      <div class="answer-bar-bg">
        <div class="answer-bar-fill a${i % 4} ${isCorrect ? "correct-bar" : ""}" style="width:${widthPct}%">
          ${count > 0 ? count : ""}
        </div>
      </div>
      <div style="font-size:0.8rem;opacity:0.7;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(opts[i] || "")}</div>
      ${isCorrect ? '<span style="color:#26890c;font-size:1.1rem">✓</span>' : '<span style="color:transparent">✓</span>'}
    </div>`;
    })
    .join("");

  document.getElementById("host-leaderboard").innerHTML =
    renderLeaderboardItems(leaderboard);
  renderDeptLeaderboard(deptLeaderboard, "host-dept-leaderboard");
  document.getElementById("btn-next-q").style.display = isLastQuestion
    ? "none"
    : "";
}

function getCurrentQIdx() {
  const meta = document.getElementById("host-q-meta").textContent;
  const match = meta.match(/(\d+)\//);
  return match ? parseInt(match[1]) - 1 : 0;
}

function renderFinalLeaderboard(leaderboard, deptLeaderboard) {
  const winner = leaderboard[0];
  if (winner) {
    document.getElementById("winner-banner").innerHTML =
      `<div style="font-size:2rem">🥇</div><h2>${escHtml(winner.name)}</h2><div style="color:#EE0000;font-size:1.3rem;font-weight:700">${winner.score.toLocaleString()} diem</div>`;
  }
  document.getElementById("final-leaderboard").innerHTML =
    renderLeaderboardItems(leaderboard);
  renderDeptLeaderboard(deptLeaderboard, "final-dept-leaderboard");
}

// ─── XUẤT KẾT QUẢ EXCEL ─────────────────────────────────────

async function exportResults() {
  if (finalLeaderboardData.length === 0) {
    alert("Chua co ket qua de xuat!");
    return;
  }

  if (typeof XLSX === "undefined") {
    await loadScript(
      "https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js",
    );
  }

  const wb = XLSX.utils.book_new();

  // Sheet 1: Cá nhân
  const indivRows = [
    ["Hang", "MSNV", "Ho va Ten", "Phong Ban", "Cong Doan", "Diem"],
  ];
  finalLeaderboardData.forEach((p) => {
    indivRows.push([
      p.rank,
      p.msnv || "",
      p.name,
      p.phongBan || "",
      p.congDoan || "",
      p.score,
    ]);
  });
  const ws1 = XLSX.utils.aoa_to_sheet(indivRows);
  ws1["!cols"] = [
    { wch: 6 },
    { wch: 12 },
    { wch: 28 },
    { wch: 20 },
    { wch: 18 },
    { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, "Ca nhan");

  // Sheet 2: Theo đơn vị
  const deptRows = [["Hang", "Don vi", "So nguoi", "Tong diem", "Diem TB"]];
  finalDeptLeaderboardData.forEach((d) => {
    deptRows.push([d.rank, d.name, d.count, d.totalScore, d.avgScore]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(deptRows);
  ws2["!cols"] = [
    { wch: 6 },
    { wch: 24 },
    { wch: 10 },
    { wch: 12 },
    { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, "Theo don vi");

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  XLSX.writeFile(wb, `ketqua_minigame_${stamp}.xlsx`);
}

// ─── SHARED RENDER ──────────────────────────────────────────

function renderLeaderboardItems(leaderboard) {
  const medals = ["🥇", "🥈", "🥉"];
  return leaderboard
    .map((item) => {
      const cls = item.rank <= 3 ? `top${item.rank}` : "";
      const icon = medals[item.rank - 1] || `#${item.rank}`;
      return `
    <div class="lb-item ${cls}">
      <div class="lb-rank">${icon}</div>
      <div class="lb-name">
        ${escHtml(item.name)}
        ${item.phongBan ? `<div style="font-size:0.75rem;opacity:0.6">${escHtml(item.phongBan)}</div>` : ""}
      </div>
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
      '<div style="opacity:0.5;font-size:0.85rem;padding:12px">Chua co du lieu don vi (can dang nhap bang MSNV)</div>';
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
        <div style="font-size:0.75rem;opacity:0.6">${d.count} người · TB ${d.avgScore.toLocaleString()} điểm</div>
      </div>
      <div class="lb-score">${d.totalScore.toLocaleString()}</div>
    </div>`;
    })
    .join("");
}

// ─── HELPERS ────────────────────────────────────────────────

function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.add("hidden"));
  document.getElementById(id)?.classList.remove("hidden");
}

function flashMessage(msg) {
  const toast = document.createElement("div");
  toast.textContent = msg;
  toast.style.cssText = `
    position:fixed;bottom:24px;right:24px;
    background:#EE0000;color:#fff;
    padding:10px 20px;border-radius:999px;
    font-weight:700;font-size:0.9rem;
    animation:popIn 0.3s ease;z-index:9999;
    box-shadow:0 4px 12px rgba(238,0,0,0.3);
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function launchConfetti() {
  const wrap = document.getElementById("confetti-wrap");
  const colors = [
    "#EE0000",
    "#ff6b6b",
    "#74b9ff",
    "#55efc4",
    "#fd79a8",
    "#ffd700",
  ];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.cssText = `
      left:${Math.random() * 100}%;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      animation-duration:${1.5 + Math.random() * 2}s;
      animation-delay:${Math.random() * 1.5}s;
      transform:rotate(${Math.random() * 360}deg);
      width:${6 + Math.random() * 10}px;
      height:${10 + Math.random() * 14}px;
    `;
    wrap.appendChild(piece);
  }
  setTimeout(() => {
    wrap.innerHTML = "";
  }, 5000);
}

// ─── INIT ───────────────────────────────────────────────────
renderOptionFields();
renderQuestionList();
