import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import { nanoid } from "nanoid";
import fs from "fs";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;
  const STATS_FILE = path.join(process.cwd(), "stats.json");

  // Load stats
  let stats = { totalMatches: 0 };
  if (fs.existsSync(STATS_FILE)) {
    try {
      stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf-8"));
    } catch (e) {
      console.error("Error loading stats:", e);
    }
  }

  function saveStats() {
    try {
      fs.writeFileSync(STATS_FILE, JSON.stringify(stats), "utf-8");
    } catch (e) {
      console.error("Error saving stats:", e);
    }
  }

  // In-memory store for rooms
  // In a production app, this would be in Redis or a DB
  const rooms: Record<string, any> = {};

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);
    
    // Send initial stats
    socket.emit("stats-update", stats);

    socket.on("create-room", ({ isAI = false }, callback) => {
      const roomId = nanoid(6).toUpperCase();
      rooms[roomId] = {
        id: roomId,
        players: [],
        board: {
          rows: 5,
          cols: 5,
          horizontalLines: [],
          verticalLines: [],
          boxes: [],
        },
        scores: { player1: 0, player2: 0 },
        turn: "player1",
        status: "waiting",
        isAI: isAI,
      };
      callback(roomId);
    });

    socket.on("join-room", ({ roomId, playerName }, callback) => {
      const room = rooms[roomId];
      if (!room) {
        return callback({ error: "Room not found" });
      }
      if (room.players.length >= 2) {
        return callback({ error: "Room is full" });
      }

      const playerRole = room.players.length === 0 ? "player1" : "player2";
      const player = { id: socket.id, name: playerName, role: playerRole };
      room.players.push(player);
      socket.join(roomId);

      // If it's an AI room and the first player joined, add the AI bot as player2
      if (room.isAI && room.players.length === 1) {
        room.players.push({ id: "ai-bot", name: "AI Bot", role: "player2" });
      }

      callback({ room, playerRole });
      io.to(roomId).emit("room-update", room);
    });

    socket.on("start-game", ({ roomId, rows, cols }) => {
      const room = rooms[roomId];
      if (!room || room.status !== "waiting") return;
      
      // Only host (player1) can start
      const player = room.players.find((p: any) => p.id === socket.id);
      if (!player || player.role !== "player1") return;

      room.board.rows = rows || 5;
      room.board.cols = cols || 5;
      room.status = "playing";
      
      // Randomize first turn
      room.turn = Math.random() < 0.5 ? "player1" : "player2";
      
      io.to(roomId).emit("room-update", room);

      // AI Turn trigger if AI starts
      if (room.isAI && room.turn === "player2" && room.status === "playing") {
        triggerAI(roomId);
      }
    });

    socket.on("make-move", ({ roomId, type, r, c }) => {
      const room = rooms[roomId];
      if (!room || room.status !== "playing") return;

      const player = room.players.find((p: any) => p.id === socket.id);
      if (!player || player.role !== room.turn) return;

      const moved = processMove(room, type, r, c);
      if (!moved) return;
      
      io.to(roomId).emit("room-update", room);

      // AI Turn trigger
      if (room.isAI && room.turn === "player2" && room.status === "playing") {
        triggerAI(roomId);
      }
    });

    function triggerAI(roomId: string) {
      setTimeout(() => {
        const room = rooms[roomId];
        if (!room || room.turn !== "player2" || room.status !== "playing") return;
        
        const moved = makeAIMove(room);
        if (moved) {
          io.to(roomId).emit("room-update", room);
          // If it's still AI's turn (bonus turn), trigger again
          if (room.turn === "player2" && room.status === "playing") {
            triggerAI(roomId);
          }
        }
      }, 800);
    }

    function processMove(room: any, type: string, r: number, c: number) {
      const lines = type === "horizontal" ? room.board.horizontalLines : room.board.verticalLines;
      if (lines.some((l: any) => l.r === r && l.c === c)) return false;

      const currentTurn = room.turn;
      lines.push({ r, c, owner: currentTurn });

      let boxesCompleted = 0;
      const { rows, cols } = room.board;

      if (type === "horizontal") {
        if (r > 0 && checkSquare(room, r - 1, c)) {
          room.board.boxes.push({ r: r - 1, c, owner: currentTurn });
          boxesCompleted++;
        }
        if (r < rows - 1 && checkSquare(room, r, c)) {
          room.board.boxes.push({ r, c, owner: currentTurn });
          boxesCompleted++;
        }
      } else {
        if (c > 0 && checkSquare(room, r, c - 1)) {
          room.board.boxes.push({ r, c: c - 1, owner: currentTurn });
          boxesCompleted++;
        }
        if (c < cols - 1 && checkSquare(room, r, c)) {
          room.board.boxes.push({ r, c, owner: currentTurn });
          boxesCompleted++;
        }
      }

      if (boxesCompleted > 0) {
        room.scores[currentTurn] += boxesCompleted;
      } else {
        room.turn = room.turn === "player1" ? "player2" : "player1";
      }

      if (room.board.boxes.length === (rows - 1) * (cols - 1)) {
        room.status = "finished";
        stats.totalMatches++;
        saveStats();
        io.emit("stats-update", stats);
      }
      return true;
    }

    function makeAIMove(room: any) {
      const { rows, cols } = room.board;
      const hLines = room.board.horizontalLines;
      const vLines = room.board.verticalLines;

      // 1. Try to complete a box
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const top = hLines.find((l: any) => l.r === r && l.c === c);
          const bottom = hLines.find((l: any) => l.r === r + 1 && l.c === c);
          const left = vLines.find((l: any) => l.r === r && l.c === c);
          const right = vLines.find((l: any) => l.r === r && l.c === c + 1);

          const missing = [!top, !bottom, !left, !right].filter(Boolean).length;
          if (missing === 1) {
            if (!top) return processMove(room, "horizontal", r, c);
            if (!bottom) return processMove(room, "horizontal", r + 1, c);
            if (!left) return processMove(room, "vertical", r, c);
            if (!right) return processMove(room, "vertical", r, c + 1);
          }
        }
      }

      // 2. Pick a random move
      const available = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols - 1; c++) {
          if (!hLines.some((l: any) => l.r === r && l.c === c)) available.push({ type: "horizontal", r, c });
        }
      }
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols; c++) {
          if (!vLines.some((l: any) => l.r === r && l.c === c)) available.push({ type: "vertical", r, c });
        }
      }

      if (available.length > 0) {
        const move = available[Math.floor(Math.random() * available.length)];
        return processMove(room, move.type, move.r, move.c);
      }
      return false;
    }

    socket.on("rematch", ({ roomId }) => {
      const room = rooms[roomId];
      if (!room || room.status !== "finished") return;

      // Reset board and scores
      room.board.horizontalLines = [];
      room.board.verticalLines = [];
      room.board.boxes = [];
      room.scores = { player1: 0, player2: 0 };
      room.status = "waiting"; // Go back to setup phase

      io.to(roomId).emit("room-update", room);
    });

    socket.on("send-reaction", ({ roomId, reaction, role }) => {
      io.to(roomId).emit("new-reaction", { reaction, role, id: nanoid(4) });
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      // Handle player leaving room
      for (const roomId in rooms) {
        const room = rooms[roomId];
        const playerIndex = room.players.findIndex((p: any) => p.id === socket.id);
        if (playerIndex !== -1) {
          room.players.splice(playerIndex, 1);
          if (room.players.length === 0) {
            delete rooms[roomId];
          } else {
            room.status = "waiting";
            io.to(roomId).emit("room-update", room);
          }
          break;
        }
      }
    });
  });

  function checkSquare(room: any, r: number, c: number) {
    const hLines = room.board.horizontalLines;
    const vLines = room.board.verticalLines;

    const hasTop = hLines.some((l: any) => l.r === r && l.c === c);
    const hasBottom = hLines.some((l: any) => l.r === r + 1 && l.c === c);
    const hasLeft = vLines.some((l: any) => l.r === r && l.c === c);
    const hasRight = vLines.some((l: any) => l.r === r && l.c === c + 1);

    return hasTop && hasBottom && hasLeft && hasRight;
  }

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
