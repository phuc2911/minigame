const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Admin MSNV ─────────────────────────────────────────────
// Thêm/xóa mã nhân viên admin tại đây (không phân biệt hoa thường)
// Hoặc tạo file CSDL/admins.txt — mỗi dòng 1 MSNV — để dễ chỉnh sửa

function loadAdminSet() {
  const hardcoded = [
    "472767", // ← Thay bằng mã nhân viên thực tế của admin
    "063686",
  ];
  const adminSet = new Set(hardcoded.map((v) => v.toLowerCase()));

  const txtPath = path.join(__dirname, "CSDL", "admins.txt");
  if (fs.existsSync(txtPath)) {
    fs.readFileSync(txtPath, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean)
      .forEach((v) => adminSet.add(v));
    console.log(`[Admin] Đã load ${adminSet.size} admin từ admins.txt`);
  }
  return adminSet;
}

let adminSet = loadAdminSet();

// ─── Load database nhân viên ────────────────────────────────
// Map: MSNV (lowercase) -> { msnv, hoTen, phongBan, congDoan }
let employeeDB = new Map();

function loadEmployeeDB() {
  const filePath = path.join(__dirname, "CSDL", "database_nhanvien.xlsx");
  if (!fs.existsSync(filePath)) {
    console.warn(
      "[!] Không tìm thấy CSDL/database_nhanvien.xlsx — bỏ qua xác thực nhân viên.",
    );
    return;
  }
  try {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    employeeDB.clear();
    rows.forEach((row) => {
      // Hỗ trợ tên cột linh hoạt (không phân biệt hoa thường, có dấu)
      const msnv = String(row["MSNV"] || row["msnv"] || "").trim();
      const hoTen = String(
        row["HoTen"] || row["hoten"] || row["Họ Tên"] || row["Ho Ten"] || "",
      ).trim();
      const phongBan = String(
        row["PhongBan"] ||
          row["Phòng Ban"] ||
          row["Phong Ban"] ||
          row["phongban"] ||
          "",
      ).trim();
      const congDoan = String(
        row["CongDoan"] ||
          row["Công Đoàn"] ||
          row["Cong Doan"] ||
          row["congdoan"] ||
          "",
      ).trim();

      if (msnv) {
        employeeDB.set(msnv.toLowerCase(), { msnv, hoTen, phongBan, congDoan });
      }
    });
    console.log(
      `[DB] Đã load ${employeeDB.size} nhân viên từ database_nhanvien.xlsx`,
    );
  } catch (err) {
    console.error("[DB] Lỗi đọc database_nhanvien.xlsx:", err.message);
  }
}

loadEmployeeDB();

// ─── API: tra cứu nhân viên ─────────────────────────────────
app.get("/api/employee/:msnv", (req, res) => {
  const key = req.params.msnv.trim().toLowerCase();
  const emp = employeeDB.get(key);
  if (!emp)
    return res.status(404).json({ error: "Không tìm thấy mã số nhân viên!" });
  res.json(emp);
});

// ─── API: reload DB (khi host thay file) ────────────────────
app.post("/api/reload-db", (req, res) => {
  loadEmployeeDB();
  adminSet = loadAdminSet();
  res.json({ count: employeeDB.size });
});

// ─── API: load câu hỏi từ CSDL/NHCH.xlsx ───────────────────
app.get("/api/questions", (_req, res) => {
  const filePath = path.join(__dirname, "CSDL", "NHCH.xlsx");
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Không tìm thấy file CSDL/NHCH.xlsx!" });
  }

  try {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    if (rows.length === 0) {
      return res.status(400).json({ error: "File NHCH.xlsx không có dữ liệu!" });
    }

    const headers = Object.keys(rows[0]);

    function normVi(str) {
      return String(str)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .trim();
    }

    const colQ       = headers.find((h) => normVi(h).includes("cau hoi"));
    const colCorrect = headers.find((h) => normVi(h).includes("dap an dung"));
    const colTime    = headers.find((h) => normVi(h).includes("thoi gian"));
    const colPoints  = headers.find((h) => normVi(h) === "diem" || normVi(h).includes("diem"));
    const colOptions = headers.filter((h) => normVi(h).includes("phuong an")).sort();

    if (!colQ || !colCorrect || colOptions.length < 2) {
      return res.status(400).json({
        error: 'File thiếu cột bắt buộc: "câu hỏi", "đáp án đúng", và ít nhất 2 cột "phương án"!',
      });
    }

    const questions = [];
    rows.forEach((row) => {
      const questionText  = String(row[colQ]       || "").trim();
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

      const timeLimit = colTime   ? parseInt(row[colTime])   || 20 : 20;
      const points    = colPoints ? parseInt(row[colPoints]) || 1000 : 1000;

      questions.push({ question: questionText, options: allOptions, correctAnswer: correctIdx, timeLimit, points });
    });

    if (questions.length === 0) {
      return res.status(400).json({ error: "Không parse được câu hỏi nào từ NHCH.xlsx!" });
    }

    console.log(`[NHCH] Đã load ${questions.length} câu hỏi từ NHCH.xlsx`);
    res.json({ questions, count: questions.length });
  } catch (err) {
    console.error("[NHCH] Lỗi đọc NHCH.xlsx:", err.message);
    res.status(500).json({ error: "Lỗi đọc file: " + err.message });
  }
});

// ─── API: kiểm tra quyền (dùng cho index.html login) ────────
app.get("/api/check-role/:msnv", (req, res) => {
  const key = req.params.msnv.trim().toLowerCase();
  const emp = employeeDB.get(key);
  if (!emp)
    return res.status(404).json({ error: "Không tìm thấy mã số nhân viên!" });
  res.json({ ...emp, isAdmin: adminSet.has(key) });
});

// ─── Games state ─────────────────────────────────────────────
// games: pin -> game state
const games = new Map();

function generatePin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

io.on("connection", (socket) => {
  socket.data = {};

  // ─── HOST EVENTS ──────────────────────────────────────────

  socket.on("create-game", ({ questions }) => {
    let pin = generatePin();
    while (games.has(pin)) pin = generatePin();

    const game = {
      pin,
      hostSocketId: socket.id,
      questions,
      // socketId -> { name, hoTen, msnv, phongBan, congDoan, score, streak }
      players: new Map(),
      currentQuestion: -1,
      status: "lobby",
      questionTimer: null,
      currentAnswers: new Map(), // socketId -> { answerIndex, timeLeft }
    };

    games.set(pin, game);
    socket.join(pin);
    socket.join(`${pin}-host`);
    socket.data = { pin, isHost: true };

    socket.emit("game-created", { pin });
    console.log(`[+] Game created: ${pin}`);
  });

  socket.on("start-game", () => {
    const game = getHostGame(socket);
    if (!game) return;

    game.status = "starting";
    io.to(game.pin).emit("game-starting", {
      questionCount: game.questions.length,
    });
    setTimeout(() => sendQuestion(game.pin), 3000);
  });

  socket.on("show-question-results", () => {
    const game = getHostGame(socket);
    if (!game) return;
    clearTimeout(game.questionTimer);
    showQuestionResults(game.pin);
  });

  socket.on("next-question", () => {
    const game = getHostGame(socket);
    if (!game) return;
    sendQuestion(game.pin);
  });

  socket.on("end-game", () => {
    const game = getHostGame(socket);
    if (!game) return;
    clearTimeout(game.questionTimer);
    endGame(game.pin);
  });

  // ─── PLAYER EVENTS ────────────────────────────────────────

  socket.on("join-game", ({ pin, msnv, name }) => {
    const game = games.get(pin);
    if (!game) {
      socket.emit("join-error", "Không tìm thấy game!");
      return;
    }
    if (game.status !== "lobby") {
      socket.emit("join-error", "Game đã bắt đầu!");
      return;
    }

    let displayName = "";
    let hoTen = "",
      phongBan = "",
      congDoan = "";

    if (msnv && msnv.trim()) {
      // Chế độ đăng nhập bằng MSNV
      const emp = employeeDB.get(msnv.trim().toLowerCase());
      if (!emp) {
        socket.emit("join-error", "Mã số nhân viên không hợp lệ!");
        return;
      }
      hoTen = emp.hoTen;
      phongBan = emp.phongBan;
      congDoan = emp.congDoan;
      displayName = emp.hoTen || msnv.trim().toUpperCase();

      // Kiểm tra MSNV đã vào chưa
      const alreadyIn = Array.from(game.players.values()).some(
        (p) => p.msnv && p.msnv.toLowerCase() === msnv.trim().toLowerCase(),
      );
      if (alreadyIn) {
        socket.emit("join-error", "Mã số nhân viên này đã tham gia!");
        return;
      }
    } else {
      // Chế độ nhập tên tự do (fallback khi không có DB)
      displayName = (name || "").trim();
      if (!displayName) {
        socket.emit("join-error", "Vui lòng nhập tên hoặc MSNV!");
        return;
      }
      if (displayName.length > 30) {
        socket.emit("join-error", "Tên quá dài!");
        return;
      }

      const taken = Array.from(game.players.values()).some(
        (p) => p.name.toLowerCase() === displayName.toLowerCase(),
      );
      if (taken) {
        socket.emit("join-error", "Tên đã được dùng!");
        return;
      }
    }

    game.players.set(socket.id, {
      name: displayName,
      msnv: msnv ? msnv.trim().toUpperCase() : "",
      hoTen,
      phongBan,
      congDoan,
      score: 0,
      streak: 0,
    });
    socket.join(pin);
    socket.data = { pin, isHost: false, name: displayName };

    socket.emit("join-success", { pin, name: displayName, phongBan, congDoan });

    const playerList = Array.from(game.players.values()).map((p) => ({
      name: p.name,
      phongBan: p.phongBan,
    }));
    io.to(pin).emit("player-joined", {
      name: displayName,
      players: playerList,
    });
  });

  socket.on("submit-answer", ({ answerIndex, timeLeft }) => {
    const { pin } = socket.data;
    const game = games.get(pin);
    if (!game || game.status !== "question") return;
    if (game.currentAnswers.has(socket.id)) return;

    game.currentAnswers.set(socket.id, {
      answerIndex,
      timeLeft: Math.max(0, timeLeft),
    });
    socket.emit("answer-received", { answerIndex });

    io.to(`${pin}-host`).emit("answer-count", {
      count: game.currentAnswers.size,
      total: game.players.size,
    });

    if (game.currentAnswers.size >= game.players.size) {
      clearTimeout(game.questionTimer);
      showQuestionResults(pin);
    }
  });

  socket.on("disconnect", () => {
    const { pin, isHost } = socket.data;
    if (!pin) return;
    const game = games.get(pin);
    if (!game) return;

    if (isHost) {
      io.to(pin).emit("host-left");
      clearTimeout(game.questionTimer);
      games.delete(pin);
      console.log(`[-] Game ended (host left): ${pin}`);
    } else {
      game.players.delete(socket.id);
      const playerList = Array.from(game.players.values()).map((p) => ({
        name: p.name,
        phongBan: p.phongBan,
      }));
      io.to(pin).emit("player-left", { players: playerList });
    }
  });
});

// ─── HELPERS ─────────────────────────────────────────────────

function getHostGame(socket) {
  const { pin, isHost } = socket.data;
  if (!isHost) return null;
  const game = games.get(pin);
  if (!game || game.hostSocketId !== socket.id) return null;
  return game;
}

function sendQuestion(pin) {
  const game = games.get(pin);
  if (!game) return;

  game.currentQuestion++;
  if (game.currentQuestion >= game.questions.length) {
    endGame(pin);
    return;
  }

  const q = game.questions[game.currentQuestion];
  const timeLimit = q.timeLimit || 10;

  game.status = "question";
  game.currentAnswers.clear();

  io.to(pin).emit("new-question", {
    index: game.currentQuestion,
    total: game.questions.length,
    question: q.question,
    options: q.options,
    timeLimit,
    points: q.points || 500,
    sentAt: Date.now(),
  });

  game.questionTimer = setTimeout(
    () => showQuestionResults(pin),
    timeLimit * 1000,
  );
}

function showQuestionResults(pin) {
  const game = games.get(pin);
  if (!game || game.status === "results" || game.status === "finished") return;

  clearTimeout(game.questionTimer);
  game.status = "results";

  const q = game.questions[game.currentQuestion];
  const { correctAnswer, timeLimit = 10, points = 500 } = q;

  const answerCounts = new Array(q.options.length).fill(0);
  game.currentAnswers.forEach(({ answerIndex }) => {
    if (answerIndex >= 0 && answerIndex < q.options.length)
      answerCounts[answerIndex]++;
  });

  game.players.forEach((player, socketId) => {
    const answer = game.currentAnswers.get(socketId);
    let isCorrect = false;
    let pointsEarned = 0;

    if (answer !== undefined) {
      isCorrect = answer.answerIndex === correctAnswer;
      if (isCorrect) {
        const ratio = Math.max(0, answer.timeLeft) / timeLimit;
        pointsEarned = Math.round(points * (0.5 + 0.5 * ratio));
        player.score += pointsEarned;
        player.streak++;
      } else {
        player.streak = 0;
      }
    } else {
      player.streak = 0;
    }

    const sorted = Array.from(game.players.values()).sort(
      (a, b) => b.score - a.score,
    );
    const rank = sorted.indexOf(player) + 1;

    io.to(socketId).emit("your-result", {
      isCorrect,
      pointsEarned,
      totalScore: player.score,
      correctAnswer,
      rank,
      streak: player.streak,
    });
  });

  const leaderboard = buildLeaderboard(game, 10);
  const deptLeaderboard = buildDeptLeaderboard(game);
  const isLastQuestion = game.currentQuestion >= game.questions.length - 1;

  io.to(`${pin}-host`).emit("question-results", {
    correctAnswer,
    answerCounts,
    leaderboard,
    deptLeaderboard,
    isLastQuestion,
  });

  io.to(pin).emit("leaderboard-update", { leaderboard, deptLeaderboard });
}

function endGame(pin) {
  const game = games.get(pin);
  if (!game) return;

  game.status = "finished";
  clearTimeout(game.questionTimer);

  const leaderboard = buildLeaderboard(game);
  const deptLeaderboard = buildDeptLeaderboard(game);

  io.to(pin).emit("game-over", { leaderboard, deptLeaderboard });

  console.log(`[=] Game over: ${pin}`);
  setTimeout(() => games.delete(pin), 120_000);
}

function buildLeaderboard(game, limit = Infinity) {
  return Array.from(game.players.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((p, i) => ({
      rank: i + 1,
      name: p.name,
      msnv: p.msnv,
      phongBan: p.phongBan,
      congDoan: p.congDoan,
      score: p.score,
    }));
}

function buildDeptLeaderboard(game) {
  // Gộp điểm theo phòng ban
  const deptMap = new Map();
  game.players.forEach((player) => {
    const dept = player.phongBan || "Chưa xác định";
    if (!deptMap.has(dept))
      deptMap.set(dept, { name: dept, totalScore: 0, count: 0 });
    const d = deptMap.get(dept);
    d.totalScore += player.score;
    d.count++;
  });

  return Array.from(deptMap.values())
    .map((d) => ({ ...d, avgScore: Math.round(d.totalScore / d.count) }))
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((d, i) => ({ rank: i + 1, ...d }));
}

// ─── Server listen ───────────────────────────────────────────

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Game server running → http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    const next = Number(PORT) + 1;
    console.warn(`Port ${PORT} is busy, trying ${next}...`);
    server.listen(next, () => {
      console.log(`Game server running → http://localhost:${next}`);
    });
  } else {
    throw err;
  }
});
