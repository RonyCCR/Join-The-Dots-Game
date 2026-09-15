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

  const PORT = Number(process.env.PORT) || 3000;
  const STATS_FILE = path.join(process.cwd(), "stats.json");
  const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "https://joint-locust-87010.upstash.io";
  const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "gQAAAAAAAVPiAAIgcDI4MTlmNjhhNzdhN2E0NjE5YmE3NzdkMmI0MTE5MzJjOQ";

  // Load stats from local file as fallback
  let stats = { totalMatches: 0 };
  if (fs.existsSync(STATS_FILE)) {
    try {
      stats = JSON.parse(fs.readFileSync(STATS_FILE, "utf-8"));
    } catch (e) {
      console.error("Error loading stats:", e);
    }
  }

  // If cloud Upstash Redis is configured, load persistent stats on server startup
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    fetch(`${UPSTASH_URL}/get/totalMatches`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data && data.result !== null && !isNaN(Number(data.result))) {
          stats.totalMatches = Number(data.result);
          console.log("Loaded persistent match count from Upstash Redis:", stats.totalMatches);
          io.emit("stats-update", stats);
        } else if (data && data.result === null) {
          // Initialize key in Upstash if not set
          fetch(`${UPSTASH_URL}/set/totalMatches/${stats.totalMatches || 0}`, {
            headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
          }).catch(() => {});
        }
      })
      .catch((err) => console.error("Error fetching stats from Upstash:", err));
  }

  async function saveStats() {
    // 1. Save locally
    try {
      fs.writeFileSync(STATS_FILE, JSON.stringify(stats), "utf-8");
    } catch (e) {
      console.error("Error saving stats:", e);
    }

    // 2. Save to cloud Upstash Redis if configured
    if (UPSTASH_URL && UPSTASH_TOKEN) {
      try {
        const res = await fetch(`${UPSTASH_URL}/incr/totalMatches`, {
          headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
        });
        const data = await res.json();
        if (data && data.result !== null && !isNaN(Number(data.result))) {
          stats.totalMatches = Number(data.result);
          io.emit("stats-update", stats);
        }
      } catch (err) {
        console.error("Error incrementing stats on Upstash:", err);
      }
    }
  }

  // In-memory store for rooms
  // In a production app, this would be in Redis or a DB
  const rooms: Record<string, any> = {};

  const REALISTIC_BOT_NAMES = [
    "Alex Morgan", "Sarah Chen", "Liam Vance", "Emma Watson",
    "Rafi Ahmed", "Tanvir Hasan", "Daniel Craig", "Aria Stark",
    "Lucas Silva", "Nabil Khan", "Elena Rostova", "Sophia Miller",
    "Leo Brooks", "Ayan Roy", "Chloe Martin", "David Kim",
    "Zubair Rahman", "Maya Patel", "Oliver Queen", "Noah Taylor",
    "Samir Hossain", "Marcus Bell", "Priya Sharma", "Ethan Hunt"
  ];

  function getRandomBotName(excludeName?: string): string {
    const pool = REALISTIC_BOT_NAMES.filter(
      (n) => n.toLowerCase() !== (excludeName || "").toLowerCase()
    );
    return pool[Math.floor(Math.random() * pool.length)];
  }

  interface QueuedPlayer {
    socketId: string;
    playerName: string;
    useCustomSize: boolean;
    rows: number;
    cols: number;
    timeoutId: NodeJS.Timeout;
    searchStartTime: number;
  }

  const matchmakingQueue: QueuedPlayer[] = [];

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);
    
    // Send initial stats
    socket.emit("stats-update", stats);

    // Random Matchmaking System
    socket.on("search-match", ({ playerName, useCustomSize = false, customRows = 5, customCols = 5 }) => {
      const cleanName = (playerName || "Player").trim();
      const sanitizedRows = Math.max(3, Math.min(10, Math.floor(Number(customRows) || 5)));
      const sanitizedCols = Math.max(3, Math.min(10, Math.floor(Number(customCols) || 5)));

      // Remove existing queued search for this socket if any
      const existingIdx = matchmakingQueue.findIndex((q) => q.socketId === socket.id);
      if (existingIdx !== -1) {
        clearTimeout(matchmakingQueue[existingIdx].timeoutId);
        matchmakingQueue.splice(existingIdx, 1);
      }

      // Check if another player is already waiting in queue
      while (matchmakingQueue.length > 0) {
        const candidate = matchmakingQueue.shift()!;
        clearTimeout(candidate.timeoutId);

        const opponentSocket = io.sockets.sockets.get(candidate.socketId);
        if (opponentSocket && opponentSocket.connected) {
          // Real human match made!
          const roomId = nanoid(6).toUpperCase();
          const firstTurn = Math.random() < 0.5 ? "player1" : "player2";

          // Determine board dimensions: candidate's custom size if set, else current player's custom size, else standard 5x5
          let matchRows = 5;
          let matchCols = 5;
          if (candidate.useCustomSize) {
            matchRows = candidate.rows;
            matchCols = candidate.cols;
          } else if (useCustomSize) {
            matchRows = sanitizedRows;
            matchCols = sanitizedCols;
          }

          const newRoom = {
            id: roomId,
            players: [
              { id: candidate.socketId, name: candidate.playerName, role: "player1" },
              { id: socket.id, name: cleanName, role: "player2" },
            ],
            board: {
              rows: matchRows,
              cols: matchCols,
              horizontalLines: [],
              verticalLines: [],
              boxes: [],
            },
            scores: { player1: 0, player2: 0 },
            turn: firstTurn,
            status: "playing",
            isAI: false,
            isQuickMatch: true,
          };

          rooms[roomId] = newRoom;
          opponentSocket.join(roomId);
          socket.join(roomId);

          opponentSocket.emit("match-found", { room: newRoom, playerRole: "player1" });
          socket.emit("match-found", { room: newRoom, playerRole: "player2" });
          io.to(roomId).emit("room-update", newRoom);
          return;
        }
      }

      // If no human player available, start 15s countdown for realistic bot
      const WAITING_TIME_MS = 15000;
      const timeoutId = setTimeout(() => {
        const queueIdx = matchmakingQueue.findIndex((q) => q.socketId === socket.id);
        if (queueIdx === -1) return;
        matchmakingQueue.splice(queueIdx, 1);

        if (!socket.connected) return;

        // Pair with realistic bot
        const roomId = nanoid(6).toUpperCase();
        const botName = getRandomBotName(cleanName);
        const firstTurn = Math.random() < 0.5 ? "player1" : "player2";
        const botRows = useCustomSize ? sanitizedRows : 5;
        const botCols = useCustomSize ? sanitizedCols : 5;

        const newRoom = {
          id: roomId,
          players: [
            { id: socket.id, name: cleanName, role: "player1" },
            { id: "ai-bot", name: botName, role: "player2" },
          ],
          board: {
            rows: botRows,
            cols: botCols,
            horizontalLines: [],
            verticalLines: [],
            boxes: [],
          },
          scores: { player1: 0, player2: 0 },
          turn: firstTurn,
          status: "playing",
          isAI: true,
          isQuickMatch: true,
        };

        rooms[roomId] = newRoom;
        socket.join(roomId);

        socket.emit("match-found", { room: newRoom, playerRole: "player1" });
        io.to(roomId).emit("room-update", newRoom);

        // If AI starts first, trigger move after natural delay
        if (firstTurn === "player2") {
          setTimeout(() => {
            triggerAI(roomId);
          }, 650);
        }
      }, WAITING_TIME_MS);

      matchmakingQueue.push({
        socketId: socket.id,
        playerName: cleanName,
        useCustomSize: !!useCustomSize,
        rows: sanitizedRows,
        cols: sanitizedCols,
        timeoutId,
        searchStartTime: Date.now(),
      });

      socket.emit("search-started", { 
        timeoutSeconds: 15, 
        useCustomSize: !!useCustomSize,
        rows: useCustomSize ? sanitizedRows : 5, 
        cols: useCustomSize ? sanitizedCols : 5 
      });
    });

    socket.on("cancel-search", () => {
      const idx = matchmakingQueue.findIndex((q) => q.socketId === socket.id);
      if (idx !== -1) {
        clearTimeout(matchmakingQueue[idx].timeoutId);
        matchmakingQueue.splice(idx, 1);
        socket.emit("search-cancelled");
      }
    });

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

          // If it's a realistic quick match bot, occasionally send an authentic reaction
          if (room.isQuickMatch && Math.random() < 0.22) {
            const aiReactions = ["🔥", "😎", "😍", "❤️", "👏", "Nice!", "GG", "🤔", "Well played!"];
            const chosen = aiReactions[Math.floor(Math.random() * aiReactions.length)];
            io.to(roomId).emit("new-reaction", {
              reaction: chosen,
              role: "player2",
              id: nanoid(4),
            });
          }

          // If it's still AI's turn (bonus turn), trigger again
          if (room.turn === "player2" && room.status === "playing") {
            triggerAI(roomId);
          }
        }
      }, 750);
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
      
      // If quick match, instantly jump into playing with randomized turn
      if (room.isQuickMatch) {
        room.status = "playing";
        room.turn = Math.random() < 0.5 ? "player1" : "player2";
        io.to(roomId).emit("room-update", room);
        if (room.isAI && room.turn === "player2") {
          setTimeout(() => triggerAI(roomId), 650);
        }
      } else {
        room.status = "waiting"; // Go back to setup phase
        io.to(roomId).emit("room-update", room);
      }
    });

    socket.on("send-reaction", ({ roomId, reaction, role }) => {
      io.to(roomId).emit("new-reaction", { reaction, role, id: nanoid(4) });
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);

      // Remove from matchmaking queue if waiting
      const qIdx = matchmakingQueue.findIndex((q) => q.socketId === socket.id);
      if (qIdx !== -1) {
        clearTimeout(matchmakingQueue[qIdx].timeoutId);
        matchmakingQueue.splice(qIdx, 1);
      }

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
