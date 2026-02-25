import React, { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Users, User, ArrowRight, RefreshCw, Copy, Check, LayoutGrid, Bot, Play, LogOut, Smile, MessageSquare, Send } from 'lucide-react';
import confetti from 'canvas-confetti';

// --- Types ---
type PlayerRole = 'player1' | 'player2';

interface Line {
  r: number;
  c: number;
  owner: PlayerRole;
}

interface Box {
  r: number;
  c: number;
  owner: PlayerRole;
}

interface Room {
  id: string;
  players: { id: string; name: string; role: PlayerRole }[];
  board: {
    rows: number;
    cols: number;
    horizontalLines: Line[];
    verticalLines: Line[];
    boxes: Box[];
  };
  scores: { player1: number; player2: number };
  turn: PlayerRole;
  status: 'waiting' | 'playing' | 'finished';
  isAI?: boolean;
}

// --- Components ---

const Dot = () => (
  <div className="w-2 h-2 bg-slate-400 rounded-full z-10" />
);

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [myRole, setMyRole] = useState<PlayerRole | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [boardRows, setBoardRows] = useState(5);
  const [boardCols, setBoardCols] = useState(5);
  const [isJoining, setIsJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nameError, setNameError] = useState(false);
  const [cellSize, setCellSize] = useState(60);
  const [activeReactions, setActiveReactions] = useState<{ id: string; reaction: string; role: PlayerRole }[]>([]);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showChatInput, setShowChatInput] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [totalMatches, setTotalMatches] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);

  const REACTIONS = [
    { emoji: '🔥', label: 'Hot!' },
    { emoji: '😎', label: 'Cool' },
    { emoji: '😲', label: 'Wow' },
    { emoji: '😠', label: 'Angry' },
    { emoji: '😡', label: 'Mad' },
    { emoji: '😢', label: 'Sad' },
    { emoji: '😭', label: 'Cry' },
    { emoji: '👏', label: 'Bravo' },
    { emoji: '🤔', label: 'Hmm' },
    { emoji: '😂', label: 'Haha' },
  ];

  // Sound Effects
  const soundsRef = useRef<{ [key: string]: HTMLAudioElement }>({});

  useEffect(() => {
    const updateSize = () => {
      if (boardRef.current && room) {
        const containerWidth = boardRef.current.parentElement?.clientWidth || 0;
        const containerHeight = boardRef.current.parentElement?.clientHeight || 0;
        const padding = 64; 
        const availableWidth = containerWidth - padding;
        const availableHeight = containerHeight - padding;
        
        const { rows, cols } = room.board;
        const sizeW = Math.floor(availableWidth / (cols - 0.5));
        const sizeH = Math.floor(availableHeight / (rows - 0.5));
        
        const newSize = Math.min(60, sizeW, sizeH);
        setCellSize(Math.max(25, newSize));
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [room?.board.rows, room?.board.cols, room?.status]);

  useEffect(() => {
    soundsRef.current = {
      move: new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3'), // Different move sound
      box: new Audio('https://assets.mixkit.co/active_storage/sfx/2013/2013-preview.mp3'),
      win: new Audio('https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3')
    };
    Object.values(soundsRef.current).forEach((audio: HTMLAudioElement) => {
      audio.volume = 0.5;
      audio.preload = 'auto';
    });
  }, []);

  const playSound = (type: 'move' | 'box' | 'win') => {
    const audio = soundsRef.current[type];
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  };

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('room-update', (updatedRoom: Room) => {
      setRoom((prev) => {
        if (prev) {
          // Play sounds based on changes
          if (updatedRoom.board.boxes.length > prev.board.boxes.length) {
            playSound('box');
          } else if (
            updatedRoom.board.horizontalLines.length > prev.board.horizontalLines.length ||
            updatedRoom.board.verticalLines.length > prev.board.verticalLines.length
          ) {
            playSound('move');
          }
          if (updatedRoom.status === 'finished' && prev.status !== 'finished') {
            playSound('win');
          }
        }
        return updatedRoom;
      });

      if (updatedRoom.status === 'finished') {
        const winner = updatedRoom.scores.player1 > updatedRoom.scores.player2 ? 'Player 1' : 
                       updatedRoom.scores.player2 > updatedRoom.scores.player1 ? 'Player 2' : 'Draw';
        if (winner !== 'Draw') {
           confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 }
          });
        }
      }
    });

    newSocket.on('new-reaction', (data: { reaction: string; role: PlayerRole; id: string }) => {
      setActiveReactions((prev) => [...prev, data]);
      setTimeout(() => {
        setActiveReactions((prev) => prev.filter((r) => r.id !== data.id));
      }, 5000);
    });

    newSocket.on('stats-update', (data: { totalMatches: number }) => {
      setTotalMatches(data.totalMatches);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const createRoom = (isAI = false) => {
    if (!playerName.trim()) {
      setNameError(true);
      return;
    }
    setNameError(false);
    socket?.emit('create-room', { isAI }, (id: string) => {
      joinRoom(id);
    });
  };

  const startGame = () => {
    if (!room) return;
    socket?.emit('start-game', { roomId: room.id, rows: boardRows, cols: boardCols });
  };

  const joinRoom = (id: string) => {
    const name = playerName.trim();
    if (!name) {
      setNameError(true);
      return;
    }
    setNameError(false);
    socket?.emit('join-room', { roomId: id, playerName: name }, (response: any) => {
      if (response.error) {
        alert(response.error);
      } else {
        setRoom(response.room);
        setMyRole(response.playerRole);
        setIsJoining(false);
      }
    });
  };

  const makeMove = (type: 'horizontal' | 'vertical', r: number, c: number) => {
    if (!room || room.status !== 'playing' || room.turn !== myRole) return;
    socket?.emit('make-move', { roomId: room.id, type, r, c });
  };

  const copyRoomId = () => {
    if (!room) return;
    navigator.clipboard.writeText(room.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRematch = () => {
    if (!room) return;
    socket?.emit('rematch', { roomId: room.id });
  };

  const sendReaction = (reaction: string) => {
    if (!room || !myRole) return;
    socket?.emit('send-reaction', { roomId: room.id, reaction, role: myRole });
    setShowReactionPicker(false);
  };

  const handleSendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!room || !myRole || !chatInput.trim()) return;
    socket?.emit('send-reaction', { roomId: room.id, reaction: chatInput.trim(), role: myRole });
    setChatInput('');
    setShowChatInput(false);
  };

  if (!room) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col p-4 font-sans">
        <div className="flex-1 flex items-center justify-center">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-500/10 rounded-2xl">
                  <LayoutGrid className="w-8 h-8 text-emerald-500" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight">JOIN THE DOTS</h1>
              </div>
              {totalMatches >= 0 && (
                <div className="text-right bg-slate-800/50 px-3 py-1.5 rounded-2xl border border-slate-700/50">
                  <div className="text-[9px] font-black uppercase tracking-tighter text-slate-500 leading-none mb-1">Total Played Match</div>
                  <div className="text-lg font-black text-emerald-500 leading-none">{totalMatches}</div>
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Your Name</label>
                <input 
                  type="text" 
                  value={playerName}
                  onChange={(e) => {
                    setPlayerName(e.target.value);
                    if (e.target.value.trim()) setNameError(false);
                  }}
                  placeholder="Enter your name..."
                  className={`w-full bg-slate-800 border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 transition-all ${
                    nameError ? 'border-red-500 focus:ring-red-500/50' : 'border-slate-700 focus:ring-emerald-500/50'
                  }`}
                />
                {nameError && (
                  <motion.p 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="text-xs text-red-500 mt-2 font-semibold"
                  >
                    ⚠️ Please enter your name to continue
                  </motion.p>
                )}
              </div>

              {!isJoining ? (
                <div className="grid grid-cols-1 gap-4">
                  <button 
                    onClick={() => createRoom(false)}
                    className="group flex items-center justify-between w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-4 px-6 rounded-xl transition-all active:scale-95"
                  >
                    <div className="flex items-center gap-3">
                      <Users className="w-5 h-5" />
                      <span>Multiplayer Room</span>
                    </div>
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </button>
                  <button 
                    onClick={() => createRoom(true)}
                    className="group flex items-center justify-between w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-4 px-6 rounded-xl transition-all active:scale-95"
                  >
                    <div className="flex items-center gap-3">
                      <Bot className="w-5 h-5" />
                      <span>Play vs AI</span>
                    </div>
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </button>
                  <button 
                    onClick={() => setIsJoining(true)}
                    className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-4 px-6 rounded-xl transition-all"
                  >
                    Join Existing Room
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Room ID</label>
                    <input 
                      type="text" 
                      value={roomIdInput}
                      onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
                      placeholder="E.g. XJ82LK"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button 
                      onClick={() => joinRoom(roomIdInput)}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 rounded-xl transition-all"
                    >
                      Join Room
                    </button>
                    <button 
                      onClick={() => setIsJoining(false)}
                      className="px-6 bg-slate-800 hover:bg-slate-700 text-slate-400 font-semibold py-3 rounded-xl transition-all"
                    >
                      Back
                    </button>
                  </div>
                </div>
              )}
            </div>

            <p className="mt-8 text-center text-sm text-slate-500">
              Connect dots to form boxes. Complete a box to get an extra turn!
            </p>
          </motion.div>
        </div>
        
        <footer className="py-6 text-center text-slate-600 text-xs font-medium">
          Made ❤️ with RonyCCR
        </footer>
      </div>
    );
  }

  const { rows, cols } = room.board;
  const isMyTurn = room.turn === myRole;
  const otherPlayer = room.players.find(p => p.role !== myRole);
  const isHost = myRole === 'player1';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans flex flex-col">
      <div className="max-w-5xl mx-auto w-full flex-1 flex flex-col gap-6">
        
        {/* Top Header - Player Info */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-[2rem] p-3 sm:p-4 shadow-xl relative overflow-visible">
            <div className="flex items-center gap-3 relative overflow-visible">
              <div className={`relative flex items-center gap-3 p-1.5 pr-4 rounded-full transition-all duration-500 ${
                room.turn === 'player1' ? 'bg-emerald-500/10 ring-1 ring-emerald-500/50' : 'bg-transparent'
              }`}>
                <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
                  room.turn === 'player1' ? 'border-emerald-500 bg-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'border-slate-700 bg-slate-800'
                }`}>
                  <User className={`w-5 h-5 sm:w-6 sm:h-6 ${room.turn === 'player1' ? 'text-emerald-500' : 'text-slate-500'}`} />
                </div>
                <div className="text-left">
                  <div className={`text-[10px] font-bold uppercase tracking-widest ${room.turn === 'player1' ? 'text-emerald-500' : 'text-slate-500'}`}>
                    {room.players.find(p => p.role === 'player1')?.name || 'P1'}
                  </div>
                  <div className="text-sm sm:text-lg font-black leading-none">{room.scores.player1}</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center gap-1">
              <div className="px-3 py-1 bg-slate-800 rounded-full text-[10px] font-mono text-slate-400 flex items-center gap-2">
                <span className="hidden xs:inline">Room:</span> {room.id}
                <button onClick={copyRoomId} className="hover:text-emerald-400 transition-colors">
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
              <div className={`text-[10px] font-bold uppercase tracking-tighter ${isMyTurn ? 'text-emerald-400' : 'text-slate-500'}`}>
                {isMyTurn ? 'Your Turn' : 'Waiting...'}
              </div>
            </div>

            <div className="flex items-center gap-3 relative overflow-visible">
              <div className={`relative flex items-center gap-3 p-1.5 pl-4 rounded-full transition-all duration-500 ${
                room.turn === 'player2' ? 'bg-indigo-500/10 ring-1 ring-indigo-500/50' : 'bg-transparent'
              }`}>
                <div className="text-right">
                  <div className={`text-[10px] font-bold uppercase tracking-widest ${room.turn === 'player2' ? 'text-indigo-500' : 'text-slate-500'}`}>
                    {room.players.find(p => p.role === 'player2')?.name || (room.isAI ? 'AI Bot' : 'P2')}
                  </div>
                  <div className="text-sm sm:text-lg font-black leading-none">{room.scores.player2}</div>
                </div>
                <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
                  room.turn === 'player2' ? 'border-indigo-500 bg-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.3)]' : 'border-slate-700 bg-slate-800'
                }`}>
                  {room.isAI ? <Bot className={`w-5 h-5 sm:w-6 sm:h-6 ${room.turn === 'player2' ? 'text-indigo-500' : 'text-slate-500'}`} /> : <User className={`w-5 h-5 sm:w-6 sm:h-6 ${room.turn === 'player2' ? 'text-indigo-500' : 'text-slate-500'}`} />}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col items-center justify-center min-h-0">
          {room.status === 'waiting' ? (
            <div className="text-center p-8 sm:p-12 bg-slate-900/50 border border-slate-800 border-dashed rounded-[2.5rem] w-full max-w-md">
              <LayoutGrid className="w-16 h-16 text-slate-700 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-slate-300 mb-2">Ready to play?</h2>
              <p className="text-slate-500 mb-8">
                {isHost 
                  ? (room.isAI || room.players.length === 2 ? "Select board size and start the match!" : "Share the room ID with a friend to begin.")
                  : "Waiting for host to start the game..."}
              </p>
              
              {isHost && (
                <div className="space-y-6 bg-slate-900 p-6 rounded-3xl border border-slate-800">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2 flex justify-between">
                        Rows <span>{boardRows}</span>
                      </label>
                      <input 
                        type="range" 
                        min="3" 
                        max="12" 
                        step="1"
                        value={boardRows}
                        onChange={(e) => setBoardRows(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2 flex justify-between">
                        Cols <span>{boardCols}</span>
                      </label>
                      <input 
                        type="range" 
                        min="3" 
                        max="12" 
                        step="1"
                        value={boardCols}
                        onChange={(e) => setBoardCols(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                      />
                    </div>
                  </div>
                  <button 
                    onClick={startGame}
                    disabled={!room.isAI && room.players.length < 2}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-bold py-4 rounded-2xl transition-all active:scale-95 shadow-lg shadow-emerald-900/20"
                  >
                    <Play className="w-5 h-5" />
                    Start Match
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="relative w-full flex justify-center overflow-hidden py-4 touch-none">
              <div 
                ref={boardRef}
                className="relative p-6 sm:p-8 bg-slate-900 border border-slate-800 rounded-[2rem] sm:rounded-[2.5rem] shadow-2xl"
              >
                {/* Background pattern */}
                <div className="absolute inset-0 opacity-5 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
                
                <div 
                  className="relative grid gap-0"
                  style={{ 
                    gridTemplateColumns: `repeat(${cols - 1}, ${cellSize}px)`,
                    gridTemplateRows: `repeat(${rows - 1}, ${cellSize}px)`,
                  }}
                >
                  {/* Dots */}
                  {Array.from({ length: rows * cols }).map((_, i) => {
                    const r = Math.floor(i / cols);
                    const c = i % cols;
                    return (
                      <div 
                        key={`dot-${r}-${c}`}
                        className="absolute"
                        style={{ 
                          top: r * cellSize, 
                          left: c * cellSize, 
                          transform: 'translate(-50%, -50%)' 
                        }}
                      >
                        <Dot />
                      </div>
                    );
                  })}

                  {/* Horizontal Lines */}
                  {Array.from({ length: rows * (cols - 1) }).map((_, i) => {
                    const r = Math.floor(i / (cols - 1));
                    const c = i % (cols - 1);
                    const line = room.board.horizontalLines.find(l => l.r === r && l.c === c);
                    const isClickable = room.status === 'playing' && isMyTurn && !line;

                    return (
                      <div 
                        key={`h-${r}-${c}`}
                        className="absolute h-2 -translate-y-1/2 cursor-pointer group"
                        style={{ 
                          top: r * cellSize, 
                          left: c * cellSize + 4, 
                          width: cellSize - 8 
                        }}
                        onClick={() => isClickable && makeMove('horizontal', r, c)}
                      >
                        <div className={`w-full h-full rounded-full transition-all duration-300 ${
                          line ? (line.owner === 'player1' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]') : 
                          (isClickable ? 'bg-slate-800 group-hover:bg-slate-700' : 'bg-transparent')
                        }`} />
                      </div>
                    );
                  })}

                  {/* Vertical Lines */}
                  {Array.from({ length: (rows - 1) * cols }).map((_, i) => {
                    const r = Math.floor(i / cols);
                    const c = i % cols;
                    const line = room.board.verticalLines.find(l => l.r === r && l.c === c);
                    const isClickable = room.status === 'playing' && isMyTurn && !line;

                    return (
                      <div 
                        key={`v-${r}-${c}`}
                        className="absolute w-2 -translate-x-1/2 cursor-pointer group"
                        style={{ 
                          top: r * cellSize + 4, 
                          left: c * cellSize, 
                          height: cellSize - 8 
                        }}
                        onClick={() => isClickable && makeMove('vertical', r, c)}
                      >
                        <div className={`w-full h-full rounded-full transition-all duration-300 ${
                          line ? (line.owner === 'player1' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]') : 
                          (isClickable ? 'bg-slate-800 group-hover:bg-slate-700' : 'bg-transparent')
                        }`} />
                      </div>
                    );
                  })}

                  {/* Boxes */}
                  {Array.from({ length: (rows - 1) * (cols - 1) }).map((_, i) => {
                    const r = Math.floor(i / (cols - 1));
                    const c = i % (cols - 1);
                    const box = room.board.boxes.find(b => b.r === r && b.c === c);

                    return (
                      <div 
                        key={`box-${r}-${c}`}
                        className="flex items-center justify-center overflow-hidden"
                        style={{ width: cellSize, height: cellSize }}
                      >
                        <AnimatePresence>
                          {box && (
                            <motion.div 
                              initial={{ scale: 0, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              className={`rounded-lg flex items-center justify-center font-bold transition-all ${
                                box.owner === 'player1' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-indigo-500/20 text-indigo-500'
                              }`}
                              style={{ 
                                width: cellSize - 8, 
                                height: cellSize - 8,
                                fontSize: cellSize > 40 ? '1.25rem' : '0.875rem'
                              }}
                            >
                              {box.owner === 'player1' ? 'P1' : 'P2'}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Controls */}
        <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3">
          {/* Floating Reactions near the button */}
          <div className="absolute bottom-12 right-0 flex flex-col-reverse gap-2 pointer-events-none items-end">
            <AnimatePresence>
              {activeReactions.map((r) => (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, x: 20, scale: 0.8 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 20, scale: 0.8 }}
                  className={`px-3 py-1.5 rounded-2xl shadow-lg text-xs font-bold flex items-center gap-2 whitespace-nowrap border backdrop-blur-md ${
                    r.role === 'player1' 
                      ? 'bg-emerald-500/90 border-emerald-400 text-white' 
                      : 'bg-indigo-500/90 border-indigo-400 text-white'
                  }`}
                >
                  <span className="text-[10px] opacity-80 uppercase tracking-tighter">
                    {(room.players.find(p => p.role === r.role)?.name || (r.role === 'player2' && room.isAI ? 'AI' : r.role)).substring(0, 3)}:
                  </span>
                  {r.reaction}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {showReactionPicker && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 10 }}
                className="bg-slate-900 border border-slate-800 p-3 rounded-2xl shadow-2xl grid grid-cols-5 gap-2 mb-2"
              >
                {REACTIONS.map((r) => (
                  <button
                    key={r.emoji}
                    onClick={() => sendReaction(r.emoji)}
                    className="w-10 h-10 flex items-center justify-center bg-slate-800 hover:bg-slate-700 rounded-xl transition-all active:scale-90 text-lg"
                  >
                    {r.emoji}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showChatInput && (
              <motion.form
                onSubmit={handleSendMessage}
                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 10 }}
                className="bg-slate-900 border border-slate-800 p-2 rounded-2xl shadow-2xl mb-2 flex gap-2 w-64"
              >
                <input
                  autoFocus
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white p-2 rounded-xl transition-all active:scale-90"
                >
                  <Send className="w-4 h-4" />
                </button>
              </motion.form>
            )}
          </AnimatePresence>
          
          <div className="flex gap-3">
            <button 
              onClick={() => {
                setShowReactionPicker(!showReactionPicker);
                setShowChatInput(false);
              }}
              className={`flex items-center justify-center w-10 h-10 rounded-full transition-all active:scale-95 shadow-lg backdrop-blur-sm border ${
                showReactionPicker ? 'bg-emerald-500 border-emerald-400 text-white' : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <Smile className="w-5 h-5" />
            </button>
            <button 
              onClick={() => {
                setShowChatInput(!showChatInput);
                setShowReactionPicker(false);
              }}
              className={`flex items-center justify-center w-10 h-10 rounded-full transition-all active:scale-95 shadow-lg backdrop-blur-sm border ${
                showChatInput ? 'bg-indigo-500 border-indigo-400 text-white' : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <MessageSquare className="w-5 h-5" />
            </button>
            <button 
              onClick={() => window.location.reload()}
              title="Leave Game"
              className="flex items-center justify-center w-10 h-10 bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-red-400 rounded-full transition-all active:scale-95 shadow-lg backdrop-blur-sm"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Win Modal */}
      <AnimatePresence>
        {room.status === 'finished' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-slate-900 border border-slate-800 p-8 rounded-[2.5rem] max-w-sm w-full text-center shadow-2xl"
            >
              <div className="inline-flex p-4 bg-amber-500/10 rounded-3xl mb-6">
                <Trophy className="w-12 h-12 text-amber-500" />
              </div>
              <h2 className="text-3xl font-bold mb-2">
                {room.scores.player1 === room.scores.player2 ? "It's a Draw!" : 
                 room.scores.player1 > room.scores.player2 
                   ? `${room.players.find(p => p.role === 'player1')?.name || 'Player 1'} Wins!` 
                   : `${room.players.find(p => p.role === 'player2')?.name || (room.isAI ? 'AI Bot' : 'Player 2')} Wins!`}
              </h2>
              <p className="text-slate-400 mb-8">
                Final Score: {room.scores.player1} - {room.scores.player2}
              </p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={handleRematch}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-2xl transition-all active:scale-95"
                >
                  Play Again
                </button>
                <button 
                  onClick={() => window.location.reload()}
                  className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Leave Match
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PlayerCard({ name, score, isActive, role, isMe }: { name: string, score: number, isActive: boolean, role: PlayerRole, isMe: boolean }) {
  return (
    <div className={`relative p-4 rounded-2xl border transition-all duration-300 ${
      isActive 
        ? (role === 'player1' ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-indigo-500/10 border-indigo-500/50') 
        : 'bg-slate-800/50 border-transparent'
    }`}>
      {isActive && (
        <motion.div 
          layoutId="active-indicator"
          className={`absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-8 rounded-full ${role === 'player1' ? 'bg-emerald-500' : 'bg-indigo-500'}`}
        />
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl ${role === 'player1' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-indigo-500/20 text-indigo-500'}`}>
            <User className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold flex items-center gap-2">
              {name}
              {isMe && <span className="text-[10px] bg-slate-700 px-1.5 py-0.5 rounded uppercase tracking-tighter">You</span>}
            </div>
            <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">{role === 'player1' ? 'Player 1' : 'Player 2'}</div>
          </div>
        </div>
        <div className="text-2xl font-black font-mono">{score}</div>
      </div>
    </div>
  );
}
