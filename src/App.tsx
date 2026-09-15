import React, { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Users, User, ArrowRight, RefreshCw, Copy, Check, LayoutGrid, Bot, Play, LogOut, Smile, MessageSquare, Send, Zap, Search, Clock, X, Sparkles, SlidersHorizontal, Plus, Minus, Radio } from 'lucide-react';
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
  isQuickMatch?: boolean;
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
  const [reactionTab, setReactionTab] = useState<'emoji' | 'radio'>('emoji');
  const [showChatInput, setShowChatInput] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [totalMatches, setTotalMatches] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTimer, setSearchTimer] = useState(15);
  const [useCustomRandomSize, setUseCustomRandomSize] = useState<boolean>(false);
  const [randomRows, setRandomRows] = useState<number>(5);
  const [randomCols, setRandomCols] = useState<number>(5);
  const boardRef = useRef<HTMLDivElement>(null);

  const REACTIONS = [
    { emoji: '🔥', label: 'Hot!' },
    { emoji: '😎', label: 'Cool' },
    { emoji: '😍', label: 'Heart Eyes' },
    { emoji: '❤️', label: 'Love' },
    { emoji: '👏', label: 'Bravo' },
    { emoji: '😂', label: 'Haha' },
    { emoji: '😲', label: 'Wow' },
    { emoji: '🤔', label: 'Hmm' },
    { emoji: '😢', label: 'Sad' },
    { emoji: '😭', label: 'Cry' },
    { emoji: '😠', label: 'Angry' },
    { emoji: '😡', label: 'Mad' },
  ];

  const RADIO_MESSAGES = [
    { text: 'Well played! 👏', label: 'Well played' },
    { text: 'Good luck! 🍀', label: 'Good luck' },
    { text: 'Nice move! 🎯', label: 'Nice move' },
    { text: 'Good game! 🤝', label: 'Good game' },
    { text: 'Hurry up! ⏳', label: 'Hurry up' },
    { text: 'Your turn! 👉', label: 'Your turn' },
    { text: 'Oops! 😅', label: 'Oops' },
    { text: 'Close one! ⚡', label: 'Close one' },
    { text: 'Thinking... 🧠', label: 'Thinking' },
    { text: 'Thank you! 🙏', label: 'Thank you' },
    { text: 'Watch this! 😎', label: 'Watch this' },
    { text: 'Rematch? 🔄', label: 'Rematch' },
    { text: 'One more game! 🔥', label: 'One more' },
    { text: "Don't trap me! 🛑", label: 'No trap' },
  ];

  // Sound Effects
  const soundsRef = useRef<{ [key: string]: HTMLAudioElement }>({});

  useEffect(() => {
    const updateSize = () => {
      if (!room) return;
      const { rows, cols } = room.board;

      const screenWidth = window.innerWidth;
      const screenHeight = window.innerHeight;

      // Available width: screen minus container padding & board card padding
      const horizontalMargin = screenWidth < 640 ? 32 : 64;
      const boardCardPadding = screenWidth < 640 ? 32 : 48;
      const availableWidth = Math.max(180, screenWidth - horizontalMargin - boardCardPadding);

      // Available height: screen minus top header (~100px), bottom action spacing (~110px)
      const topBarHeight = screenWidth < 640 ? 80 : 100;
      const bottomSpacing = screenWidth < 640 ? 90 : 110;
      const availableHeight = Math.max(180, screenHeight - topBarHeight - bottomSpacing - boardCardPadding);

      const maxCellW = Math.floor(availableWidth / Math.max(1, cols - 1));
      const maxCellH = Math.floor(availableHeight / Math.max(1, rows - 1));

      const optimal = Math.min(maxCellW, maxCellH);
      // Clamp between 28px (so even 10x10 fits easily on a 360px screen) and 64px
      setCellSize(Math.max(28, Math.min(64, optimal)));
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    const frameId = requestAnimationFrame(updateSize);
    return () => {
      window.removeEventListener('resize', updateSize);
      cancelAnimationFrame(frameId);
    };
  }, [room?.board.rows, room?.board.cols, room?.status]);

  useEffect(() => {
    soundsRef.current = {
      move: new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3'),
      box: new Audio('https://assets.mixkit.co/active_storage/sfx/2013/2013-preview.mp3'),
      win: new Audio('https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3'),
      chat: new Audio('https://assets.mixkit.co/active_storage/sfx/2354/2354-preview.mp3'),
    };
    Object.values(soundsRef.current).forEach((audio: HTMLAudioElement) => {
      audio.volume = 0.45;
      audio.preload = 'auto';
    });
  }, []);

  const playSound = (type: 'move' | 'box' | 'win' | 'chat') => {
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
      playSound('chat');
      // Extended message pop-out duration so it stays on screen significantly longer
      setTimeout(() => {
        setActiveReactions((prev) => prev.filter((r) => r.id !== data.id));
      }, 9500);
    });

    newSocket.on('stats-update', (data: { totalMatches: number }) => {
      setTotalMatches(data.totalMatches);
    });

    newSocket.on('search-started', ({ timeoutSeconds }: { timeoutSeconds: number }) => {
      setIsSearching(true);
      setSearchTimer(timeoutSeconds || 15);
    });

    newSocket.on('match-found', (data: { room: Room; playerRole: PlayerRole }) => {
      setIsSearching(false);
      setRoom(data.room);
      setMyRole(data.playerRole);
      setIsJoining(false);
    });

    newSocket.on('search-cancelled', () => {
      setIsSearching(false);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isSearching) return;
    const timer = setInterval(() => {
      setSearchTimer((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [isSearching]);

  const startSearchMatch = () => {
    const name = playerName.trim();
    if (!name) {
      setNameError(true);
      return;
    }
    setNameError(false);
    setIsSearching(true);
    setSearchTimer(15);
    socket?.emit('search-match', { 
      playerName: name, 
      useCustomSize: useCustomRandomSize,
      customRows: randomRows,
      customCols: randomCols 
    });
  };

  const cancelSearch = () => {
    socket?.emit('cancel-search');
    setIsSearching(false);
  };

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

  const sendRadioMessage = (msg: string) => {
    if (!room || !myRole) return;
    socket?.emit('send-reaction', { roomId: room.id, reaction: msg, role: myRole });
    setShowChatInput(false);
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
      <div className="h-screen max-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-2 sm:p-4 md:p-5 font-sans overflow-y-auto select-none">
        <div className="flex-1 flex items-center justify-center my-auto py-1">
          <motion.div 
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md bg-slate-900/95 border border-slate-800 rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-2xl mx-auto"
          >
            {/* Header: Title & Total Matches */}
            <div className="flex items-center justify-between gap-3 mb-3 sm:mb-4">
              <div className="flex items-center gap-2 sm:gap-2.5">
                <div className="p-2 bg-emerald-500/10 rounded-xl shrink-0">
                  <LayoutGrid className="w-5 h-5 text-emerald-500" />
                </div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight whitespace-nowrap">JOIN THE DOTS</h1>
              </div>
              {totalMatches >= 0 && (
                <div className="text-right bg-slate-800/60 px-2.5 py-1 rounded-xl border border-slate-700/50 flex flex-col items-end shrink-0">
                  <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-none mb-0.5">Matches</div>
                  <div className="text-sm sm:text-base font-black text-emerald-400 leading-none">{totalMatches}</div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {/* Player Name Input */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Your Name</label>
                <input 
                  type="text" 
                  value={playerName}
                  onChange={(e) => {
                    setPlayerName(e.target.value);
                    if (e.target.value.trim()) setNameError(false);
                  }}
                  placeholder="Enter your name..."
                  className={`w-full bg-slate-800/90 border rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 transition-all ${
                    nameError ? 'border-red-500 focus:ring-red-500/50' : 'border-slate-700 focus:ring-emerald-500/50'
                  }`}
                />
                {nameError && (
                  <motion.p 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="text-xs text-red-500 mt-1 font-semibold"
                  >
                    ⚠️ Please enter your name to continue
                  </motion.p>
                )}
              </div>

              {!isJoining ? (
                <div className="space-y-2.5">
                  {/* Minimal & Sleek Random Match Box */}
                  <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-2.5 sm:p-3 shadow-lg flex flex-col gap-2">
                    <button 
                      onClick={startSearchMatch}
                      className="group relative overflow-hidden flex items-center justify-between w-full bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold py-2.5 px-3.5 rounded-xl transition-all shadow-md shadow-emerald-950/40 active:scale-95 border border-emerald-400/30 text-left"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-1.5 bg-white/10 backdrop-blur-sm rounded-lg border border-white/10 shrink-0">
                          <Zap className="w-4 h-4 text-amber-300 fill-amber-300" />
                        </div>
                        <div className="text-left min-w-0">
                          <div className="text-sm font-bold leading-tight flex items-center gap-1.5 flex-wrap">
                            <span>Search Random Match</span>
                            <span className="text-[10px] font-semibold bg-emerald-400/20 text-emerald-300 px-1.5 py-0.5 rounded-full border border-emerald-400/30 shrink-0">
                              {useCustomRandomSize ? `${randomRows}×${randomCols}` : 'Auto'}
                            </span>
                          </div>
                          <div className="text-[10px] text-emerald-100/75 font-normal truncate">
                            {useCustomRandomSize ? `Custom Grid (${(randomRows - 1) * (randomCols - 1)} Boxes)` : 'Online matchmaking • 15s wait'}
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform text-white shrink-0 ml-2" />
                    </button>

                    {/* Minimal Board Size Toggle Row */}
                    <div className="pt-1.5 border-t border-slate-800/80 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-xs px-0.5">
                        <div className="flex items-center gap-1.5 text-slate-300">
                          <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="text-[11px] font-medium text-slate-400">Board Size:</span>
                          <span className="text-[11px] font-bold text-emerald-400">
                            {useCustomRandomSize ? `${randomRows}×${randomCols} (${(randomRows - 1) * (randomCols - 1)} Boxes)` : 'Auto (5×5)'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setUseCustomRandomSize(!useCustomRandomSize)}
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md border transition-all ${
                            useCustomRandomSize 
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30' 
                              : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                          }`}
                        >
                          {useCustomRandomSize ? 'Custom: ON' : 'Customize'}
                        </button>
                      </div>

                      {/* Custom Size Expanded Tray */}
                      <AnimatePresence>
                        {useCustomRandomSize && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden space-y-2 pt-0.5"
                          >
                            {/* Fast preset pills */}
                            <div className="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar">
                              {[
                                { r: 3, c: 3, label: '3×3' },
                                { r: 4, c: 4, label: '4×4' },
                                { r: 5, c: 5, label: '5×5' },
                                { r: 6, c: 6, label: '6×6' },
                                { r: 7, c: 7, label: '7×7' },
                                { r: 8, c: 8, label: '8×8' },
                              ].map((p) => {
                                const isSelected = randomRows === p.r && randomCols === p.c;
                                return (
                                  <button
                                    key={p.label}
                                    type="button"
                                    onClick={() => {
                                      setRandomRows(p.r);
                                      setRandomCols(p.c);
                                    }}
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all shrink-0 ${
                                      isSelected
                                        ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
                                        : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-700/80'
                                    }`}
                                  >
                                    {p.label}
                                  </button>
                                );
                              })}
                            </div>

                            {/* Dual Stepper Control Row on Single Line */}
                            <div className="bg-slate-950/60 rounded-lg p-1.5 px-2 border border-slate-800/80 flex items-center justify-between text-xs">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-slate-400">Rows:</span>
                                <button
                                  type="button"
                                  onClick={() => setRandomRows(prev => Math.max(3, prev - 1))}
                                  className="w-4 h-4 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center text-xs active:scale-90"
                                >
                                  <Minus className="w-2.5 h-2.5" />
                                </button>
                                <span className="font-mono font-bold text-emerald-400 w-4 text-center text-xs">{randomRows}</span>
                                <button
                                  type="button"
                                  onClick={() => setRandomRows(prev => Math.min(10, prev + 1))}
                                  className="w-4 h-4 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center text-xs active:scale-90"
                                >
                                  <Plus className="w-2.5 h-2.5" />
                                </button>
                              </div>

                              <div className="h-3 w-px bg-slate-800" />

                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-slate-400">Cols:</span>
                                <button
                                  type="button"
                                  onClick={() => setRandomCols(prev => Math.max(3, prev - 1))}
                                  className="w-4 h-4 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center text-xs active:scale-90"
                                >
                                  <Minus className="w-2.5 h-2.5" />
                                </button>
                                <span className="font-mono font-bold text-emerald-400 w-4 text-center text-xs">{randomCols}</span>
                                <button
                                  type="button"
                                  onClick={() => setRandomCols(prev => Math.min(10, prev + 1))}
                                  className="w-4 h-4 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center text-xs active:scale-90"
                                >
                                  <Plus className="w-2.5 h-2.5" />
                                </button>
                              </div>

                              <div className="h-3 w-px bg-slate-800" />

                              <span className="text-[10px] text-slate-400 font-medium">
                                <strong className="text-slate-200">{(randomRows - 1) * (randomCols - 1)}</strong> Boxes
                              </span>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* 2-Column Grid for Custom Room & Play vs AI */}
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => createRoom(false)}
                      className="group flex items-center justify-center gap-2 bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/60 text-white font-medium py-2.5 px-3 rounded-xl transition-all active:scale-95 text-xs sm:text-sm text-center"
                    >
                      <Users className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="truncate">Custom Room</span>
                    </button>
                    <button 
                      onClick={() => createRoom(true)}
                      className="group flex items-center justify-center gap-2 bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700/60 text-white font-medium py-2.5 px-3 rounded-xl transition-all active:scale-95 text-xs sm:text-sm text-center"
                    >
                      <Bot className="w-4 h-4 text-indigo-400 shrink-0" />
                      <span className="truncate">Play vs AI</span>
                    </button>
                  </div>

                  {/* Join with Room Code */}
                  <button 
                    onClick={() => setIsJoining(true)}
                    className="w-full bg-slate-900/80 hover:bg-slate-800/90 text-slate-400 hover:text-slate-200 font-medium py-2 px-4 rounded-xl transition-all border border-slate-800/80 text-xs text-center"
                  >
                    Join with Room Code
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Room ID</label>
                    <input 
                      type="text" 
                      value={roomIdInput}
                      onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
                      placeholder="E.g. XJ82LK"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all font-mono"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => joinRoom(roomIdInput)}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 rounded-xl transition-all text-sm active:scale-95 shadow-md shadow-emerald-900/30"
                    >
                      Join Room
                    </button>
                    <button 
                      onClick={() => setIsJoining(false)}
                      className="px-4 bg-slate-800 hover:bg-slate-700 text-slate-400 font-semibold py-2 rounded-xl transition-all text-sm active:scale-95 border border-slate-700"
                    >
                      Back
                    </button>
                  </div>
                </div>
              )}
            </div>

            <p className="mt-3 sm:mt-4 text-center text-[11px] text-slate-500 max-w-xs mx-auto">
              Connect dots to form boxes. Complete a box to get an extra turn!
            </p>
          </motion.div>
        </div>

        {/* Matchmaking Searching Overlay */}
        <AnimatePresence>
          {isSearching && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 15 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 15 }}
                className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-[2.5rem] p-5 sm:p-8 max-w-sm w-full text-center shadow-2xl relative overflow-hidden mx-2"
              >
                {/* Radar Pulse Effect */}
                <div className="relative w-20 h-20 sm:w-28 sm:h-28 mx-auto mb-4 sm:mb-6 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-emerald-500/10 animate-ping" />
                  <div className="absolute inset-2 sm:inset-3 rounded-full bg-emerald-500/15 animate-pulse" />
                  <div className="relative w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                    <Search className="w-6 h-6 sm:w-8 sm:h-8 text-white animate-pulse" />
                  </div>
                </div>

                <h3 className="text-lg sm:text-xl font-bold tracking-tight text-white mb-1.5">
                  Searching for Match...
                </h3>
                <p className="text-xs text-slate-400 mb-5 sm:mb-6 px-1 break-words">
                  Looking for an active online opponent. If none joins within 15s, a player will be assigned!
                </p>

                {/* Live Countdown & Board Info Badges */}
                <div className="flex flex-col items-center gap-2 mb-5 sm:mb-6">
                  <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-slate-800/90 rounded-full border border-slate-700/60">
                    <Clock className="w-3.5 h-3.5 text-emerald-400 animate-spin" style={{ animationDuration: '3s' }} />
                    <span className="text-xs font-mono font-bold text-slate-200">
                      Time remaining: <span className="text-emerald-400 font-black">{searchTimer}s</span>
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-800/50 rounded-full border border-slate-800 text-[10px] sm:text-[11px] text-slate-400 max-w-full">
                    <LayoutGrid className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span className="truncate">
                      Board:{' '}
                      {useCustomRandomSize ? (
                        <>
                          <strong className="text-emerald-400">{randomRows}×{randomCols}</strong> ({(randomRows - 1) * (randomCols - 1)} Boxes)
                        </>
                      ) : (
                        <>
                          <strong className="text-slate-200">Auto (5×5)</strong>
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {/* Cancel Search Button */}
                <button 
                  onClick={cancelSearch}
                  className="w-full py-3 sm:py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-semibold rounded-xl text-xs sm:text-sm transition-all border border-slate-700/50 flex items-center justify-center gap-2 active:scale-95"
                >
                  <X className="w-4 h-4" />
                  Cancel Search
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        
        <footer className="py-2 sm:py-2.5 text-center text-slate-500 text-xs font-medium shrink-0">
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
    <div className="min-h-screen bg-slate-950 text-slate-100 p-2 sm:p-4 md:p-8 font-sans flex flex-col">
      <div className="max-w-5xl mx-auto w-full flex-1 flex flex-col gap-4 sm:gap-6">
        
        {/* Top Header - Player Info */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-[2rem] p-2 sm:p-4 shadow-xl relative overflow-visible gap-1.5 sm:gap-3">
            {/* Player 1 Badge */}
            <div className="flex items-center gap-1 sm:gap-3 relative overflow-visible min-w-0">
              <div className={`relative flex items-center gap-2 sm:gap-3 p-1 sm:p-1.5 pr-2.5 sm:pr-4 rounded-full transition-all duration-500 min-w-0 ${
                room.turn === 'player1' ? 'bg-emerald-500/10 ring-1 ring-emerald-500/50' : 'bg-transparent'
              }`}>
                <div className={`w-8 h-8 sm:w-12 sm:h-12 rounded-full border-2 flex items-center justify-center transition-all duration-300 shrink-0 ${
                  room.turn === 'player1' ? 'border-emerald-500 bg-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.3)]' : 'border-slate-700 bg-slate-800'
                }`}>
                  <User className={`w-4 h-4 sm:w-6 sm:h-6 ${room.turn === 'player1' ? 'text-emerald-500' : 'text-slate-500'}`} />
                </div>
                <div className="text-left min-w-0">
                  <div className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-wider truncate max-w-[65px] xs:max-w-[90px] sm:max-w-[140px] ${room.turn === 'player1' ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {room.players.find(p => p.role === 'player1')?.name || 'P1'}
                  </div>
                  <div className="text-sm sm:text-lg font-black leading-none">{room.scores.player1}</div>
                </div>
              </div>
            </div>

            {/* Room ID & Turn Indicator */}
            <div className="flex flex-col items-center gap-0.5 sm:gap-1 shrink-0 px-1">
              <div className="px-2 sm:px-3 py-0.5 sm:py-1 bg-slate-800/90 rounded-full text-[9px] sm:text-[10px] font-mono text-slate-400 flex items-center gap-1.5 border border-slate-700/40">
                <span className="hidden sm:inline">Room:</span>
                <span className="font-semibold text-slate-200">{room.id}</span>
                <button onClick={copyRoomId} className="hover:text-emerald-400 transition-colors p-0.5" title="Copy Room ID">
                  {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
              <div className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-tight whitespace-nowrap ${isMyTurn ? 'text-emerald-400 animate-pulse' : 'text-slate-500'}`}>
                {isMyTurn ? 'Your Turn' : 'Waiting...'}
              </div>
            </div>

            {/* Player 2 Badge */}
            <div className="flex items-center gap-1 sm:gap-3 relative overflow-visible min-w-0 justify-end">
              <div className={`relative flex items-center gap-2 sm:gap-3 p-1 sm:p-1.5 pl-2.5 sm:pl-4 rounded-full transition-all duration-500 min-w-0 ${
                room.turn === 'player2' ? 'bg-indigo-500/10 ring-1 ring-indigo-500/50' : 'bg-transparent'
              }`}>
                <div className="text-right min-w-0">
                  <div className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-wider truncate max-w-[65px] xs:max-w-[90px] sm:max-w-[140px] ${room.turn === 'player2' ? 'text-indigo-400' : 'text-slate-400'}`}>
                    {room.players.find(p => p.role === 'player2')?.name || (room.isAI && !room.isQuickMatch ? 'AI Bot' : 'Player 2')}
                  </div>
                  <div className="text-sm sm:text-lg font-black leading-none">{room.scores.player2}</div>
                </div>
                <div className={`w-8 h-8 sm:w-12 sm:h-12 rounded-full border-2 flex items-center justify-center transition-all duration-300 shrink-0 ${
                  room.turn === 'player2' ? 'border-indigo-500 bg-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.3)]' : 'border-slate-700 bg-slate-800'
                }`}>
                  {room.isAI && !room.isQuickMatch ? <Bot className={`w-4 h-4 sm:w-6 sm:h-6 ${room.turn === 'player2' ? 'text-indigo-400' : 'text-slate-500'}`} /> : <User className={`w-4 h-4 sm:w-6 sm:h-6 ${room.turn === 'player2' ? 'text-indigo-400' : 'text-slate-500'}`} />}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col items-center justify-center min-h-0">
          {room.status === 'waiting' ? (
            <div className="text-center p-5 sm:p-8 md:p-12 bg-slate-900/60 border border-slate-800 border-dashed rounded-2xl sm:rounded-[2.5rem] w-full max-w-md mx-auto">
              <LayoutGrid className="w-12 h-12 sm:w-16 sm:h-16 text-slate-700 mx-auto mb-3 sm:mb-4" />
              <h2 className="text-xl sm:text-2xl font-bold text-slate-200 mb-2">Ready to play?</h2>
              <p className="text-xs sm:text-sm text-slate-400 mb-6 sm:mb-8 px-2">
                {isHost 
                  ? (room.isAI || room.players.length === 2 ? "Select board size and start the match!" : "Share the room ID with a friend to begin.")
                  : "Waiting for host to start the game..."}
              </p>
              
              {isHost && (
                <div className="space-y-4 sm:space-y-6 bg-slate-900 p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-800">
                  <div className="grid grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2 flex justify-between">
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
                      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2 flex justify-between">
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
                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-bold py-3.5 sm:py-4 rounded-xl sm:rounded-2xl transition-all active:scale-95 shadow-lg shadow-emerald-900/20 text-sm sm:text-base"
                  >
                    <Play className="w-5 h-5" />
                    Start Match
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="relative w-full flex-1 flex items-center justify-center overflow-hidden py-2 sm:py-4 touch-none min-h-[300px]">
              <div 
                ref={boardRef}
                className="relative p-4 sm:p-6 md:p-8 bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-[2.5rem] shadow-2xl max-w-full max-h-full overflow-hidden"
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
                        className="absolute h-5 sm:h-4 -translate-y-1/2 cursor-pointer group flex items-center z-10"
                        style={{ 
                          top: r * cellSize, 
                          left: c * cellSize + 4, 
                          width: Math.max(8, cellSize - 8)
                        }}
                        onClick={() => isClickable && makeMove('horizontal', r, c)}
                      >
                        <div className={`w-full h-1.5 sm:h-2 rounded-full transition-all duration-300 ${
                          line ? (line.owner === 'player1' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]') : 
                          (isClickable ? 'bg-slate-800/80 group-hover:bg-slate-600' : 'bg-transparent')
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
                        className="absolute w-5 sm:w-4 -translate-x-1/2 cursor-pointer group flex justify-center z-10"
                        style={{ 
                          top: r * cellSize + 4, 
                          left: c * cellSize, 
                          height: Math.max(8, cellSize - 8)
                        }}
                        onClick={() => isClickable && makeMove('vertical', r, c)}
                      >
                        <div className={`w-1.5 sm:w-2 h-full rounded-full transition-all duration-300 ${
                          line ? (line.owner === 'player1' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]') : 
                          (isClickable ? 'bg-slate-800/80 group-hover:bg-slate-600' : 'bg-transparent')
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
                                box.owner === 'player1' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-indigo-500/20 text-indigo-400'
                              }`}
                              style={{ 
                                width: Math.max(12, cellSize - 8), 
                                height: Math.max(12, cellSize - 8),
                                fontSize: cellSize > 44 ? '1.25rem' : cellSize > 32 ? '0.875rem' : '0.65rem'
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

        {/* Bottom Floating Controls */}
        <div className="fixed bottom-3 right-3 sm:bottom-4 sm:right-4 z-40 flex flex-col items-end gap-2.5 sm:gap-3 max-w-[calc(100vw-24px)]">
          {/* Floating Reactions and Chat Messages */}
          <div className="absolute bottom-14 right-0 flex flex-col-reverse gap-2 pointer-events-none items-end max-w-[85vw] sm:max-w-sm z-50">
            <AnimatePresence>
              {activeReactions.map((r) => {
                const isP1 = r.role === 'player1';
                const senderName = room.players.find(p => p.role === r.role)?.name || (r.role === 'player2' && room.isAI ? 'AI Bot' : r.role === 'player1' ? 'P1' : 'P2');
                return (
                  <motion.div
                    key={r.id}
                    initial={{ opacity: 0, x: 25, scale: 0.85, y: 8 }}
                    animate={{ opacity: 1, x: 0, scale: 1, y: 0 }}
                    exit={{ opacity: 0, x: 20, scale: 0.85, transition: { duration: 0.25 } }}
                    className={`px-3 py-1.5 rounded-2xl shadow-xl text-xs flex items-center gap-2 border backdrop-blur-md max-w-full ${
                      isP1 
                        ? 'bg-emerald-600/95 border-emerald-400 text-white shadow-emerald-950/40' 
                        : 'bg-indigo-600/95 border-indigo-400 text-white shadow-indigo-950/40'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 shrink-0 opacity-90">
                      <span className={`w-1.5 h-1.5 rounded-full ${isP1 ? 'bg-emerald-300' : 'bg-indigo-300'} animate-ping`} />
                      <span className="text-[10px] font-black uppercase tracking-wider truncate max-w-[80px]">
                        {senderName}:
                      </span>
                    </div>
                    <span className="font-semibold break-words leading-tight">{r.reaction}</span>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {/* Reaction Picker (Emojis & Radio Messages) */}
          <AnimatePresence>
            {showReactionPicker && (
              <motion.div
                initial={{ opacity: 0, scale: 0.92, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: 10 }}
                className="bg-slate-900 border border-slate-800 p-2.5 sm:p-3 rounded-2xl shadow-2xl mb-1 w-[calc(100vw-28px)] max-w-xs sm:max-w-sm flex flex-col gap-2.5"
              >
                {/* Mode Tabs */}
                <div className="flex items-center justify-between pb-1 border-b border-slate-800/80">
                  <div className="flex gap-1 bg-slate-950/80 p-1 rounded-xl border border-slate-800/70 w-full">
                    <button
                      type="button"
                      onClick={() => setReactionTab('emoji')}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                        reactionTab === 'emoji' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Smile className="w-3.5 h-3.5" />
                      <span>Emojis</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setReactionTab('radio')}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                        reactionTab === 'radio' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Radio className="w-3.5 h-3.5" />
                      <span>Quick Radio</span>
                    </button>
                  </div>
                </div>

                {reactionTab === 'emoji' ? (
                  <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
                    {REACTIONS.map((r) => (
                      <button
                        key={r.emoji}
                        onClick={() => sendReaction(r.emoji)}
                        className="w-10 h-10 flex items-center justify-center bg-slate-800/90 hover:bg-slate-700 rounded-xl transition-all active:scale-90 text-lg shrink-0 border border-slate-700/50 hover:border-emerald-500/50"
                        title={r.label}
                      >
                        {r.emoji}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-0.5 no-scrollbar">
                    {RADIO_MESSAGES.map((msg) => (
                      <button
                        key={msg.text}
                        type="button"
                        onClick={() => sendRadioMessage(msg.text)}
                        className="text-left px-2.5 py-2 bg-slate-800/90 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700/60 transition-all truncate hover:border-emerald-500/50 hover:text-white"
                        title={msg.text}
                      >
                        {msg.text}
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Chat & Quick Radio Panel */}
          <AnimatePresence>
            {showChatInput && (
              <motion.div
                initial={{ opacity: 0, scale: 0.92, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92, y: 10 }}
                className="bg-slate-900 border border-slate-800 p-3 rounded-2xl shadow-2xl mb-1 flex flex-col gap-2.5 w-[calc(100vw-28px)] max-w-xs sm:max-w-sm"
              >
                {/* Quick Radio Header */}
                <div className="flex items-center justify-between pb-1 border-b border-slate-800/80">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
                    <Radio className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Quick Radio Messages</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-medium">Tap to send</span>
                </div>

                {/* Quick Radio Pills Grid */}
                <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto pr-0.5 no-scrollbar">
                  {RADIO_MESSAGES.map((msg) => (
                    <button
                      key={msg.text}
                      type="button"
                      onClick={() => sendRadioMessage(msg.text)}
                      className="text-left px-2.5 py-1.5 bg-slate-800/90 hover:bg-slate-700 active:scale-95 text-slate-200 text-xs font-medium rounded-xl border border-slate-700/60 transition-all truncate hover:border-indigo-500/50 hover:text-white"
                      title={msg.text}
                    >
                      {msg.text}
                    </button>
                  ))}
                </div>

                {/* Divider / Custom Chat Header */}
                <div className="pt-1 border-t border-slate-800 flex items-center justify-between text-[10px] uppercase font-bold text-slate-500">
                  <span>Custom Chat Message</span>
                </div>

                {/* Custom message input form */}
                <form
                  onSubmit={handleSendMessage}
                  className="flex gap-2"
                >
                  <input
                    autoFocus
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded-xl transition-all active:scale-90 shrink-0 flex items-center gap-1 text-xs font-bold shadow-md shadow-indigo-950/40"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
          
          <div className="flex gap-2 sm:gap-3">
            <button 
              onClick={() => {
                setShowReactionPicker(!showReactionPicker);
                setShowChatInput(false);
              }}
              aria-label="Send Reaction or Radio"
              title="Emojis & Radio"
              className={`flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full transition-all active:scale-95 shadow-lg backdrop-blur-sm border ${
                showReactionPicker ? 'bg-emerald-500 border-emerald-400 text-white' : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <Smile className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button 
              onClick={() => {
                setShowChatInput(!showChatInput);
                setShowReactionPicker(false);
              }}
              aria-label="Chat & Radio Messages"
              title="Quick Radio & Custom Chat"
              className={`flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-full transition-all active:scale-95 shadow-lg backdrop-blur-sm border ${
                showChatInput ? 'bg-indigo-500 border-indigo-400 text-white' : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:bg-slate-800'
              }`}
            >
              <MessageSquare className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            <button 
              onClick={() => window.location.reload()}
              title="Leave Game"
              aria-label="Leave Game"
              className="flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-red-400 rounded-full transition-all active:scale-95 shadow-lg backdrop-blur-sm"
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
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-slate-900 border border-slate-800 p-5 sm:p-8 rounded-2xl sm:rounded-[2.5rem] max-w-xs sm:max-w-sm w-full text-center shadow-2xl mx-2"
            >
              <div className="inline-flex p-3 sm:p-4 bg-amber-500/10 rounded-2xl sm:rounded-3xl mb-4 sm:mb-6">
                <Trophy className="w-10 h-10 sm:w-12 sm:h-12 text-amber-500" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold mb-2 break-words">
                {room.scores.player1 === room.scores.player2 ? "It's a Draw!" : 
                 room.scores.player1 > room.scores.player2 
                   ? `${room.players.find(p => p.role === 'player1')?.name || 'Player 1'} Wins!` 
                   : `${room.players.find(p => p.role === 'player2')?.name || (room.isAI && !room.isQuickMatch ? 'AI Bot' : 'Player 2')} Wins!`}
              </h2>
              <p className="text-slate-400 mb-6 sm:mb-8 text-sm sm:text-base">
                Final Score: <span className="font-bold text-slate-200">{room.scores.player1}</span> - <span className="font-bold text-slate-200">{room.scores.player2}</span>
              </p>
              <div className="flex flex-col gap-2.5 sm:gap-3">
                <button 
                  onClick={handleRematch}
                  className="w-full py-3.5 sm:py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl sm:rounded-2xl transition-all active:scale-95 text-sm sm:text-base shadow-lg shadow-emerald-900/20"
                >
                  Play Again
                </button>
                <button 
                  onClick={() => window.location.reload()}
                  className="w-full py-3.5 sm:py-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl sm:rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2 text-sm sm:text-base border border-slate-700/50"
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
          <div className="min-w-0">
            <div className="text-sm font-bold flex items-center gap-2">
              <span className="truncate max-w-[120px] sm:max-w-[180px]">{name}</span>
              {isMe && <span className="text-[10px] bg-slate-700 px-1.5 py-0.5 rounded uppercase tracking-tighter shrink-0">You</span>}
            </div>
            <div className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">{role === 'player1' ? 'Player 1' : 'Player 2'}</div>
          </div>
        </div>
        <div className="text-2xl font-black font-mono">{score}</div>
      </div>
    </div>
  );
}
