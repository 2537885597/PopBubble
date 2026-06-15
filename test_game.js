// 端到端联机测试 - 简化版
const { io } = require('socket.io-client');
const SERVER = 'http://localhost:3001';

console.log('🧪 开始联机对战测试...');

const p1 = io(SERVER, { autoConnect: false });
const p2 = io(SERVER, { autoConnect: false });

let roomId = '';
let gameStarted = false;
let gameOver = false;
let currentIdx = -1;
let totalBubbles = 0;
let poppedCount = 0;

p1.connect();

p1.on('connect', () => {
  console.log('[P1] ✅ 已连接');
  p1.emit('create-room', { playerName: '甲', totalBubbles: 8, maxPop: 3 });
});

p1.on('room-created', ({ roomId: rid }) => {
  roomId = rid;
  console.log('[P1] 房间已创建：' + rid);
  p2.connect();
});

p1.on('player-joined', ({ players }) => {
  console.log('[P1] 对手已加入：' + players.join(' vs '));
  setTimeout(() => {
    console.log('[P1] 开始游戏！');
    p1.emit('start-game', { roomId });
  }, 500);
});

p2.on('connect', () => {
  console.log('[P2] ✅ 已连接');
  if (roomId) p2.emit('join-room', { roomId, playerName: '乙' });
});

// 只让 P1 处理 game-start 并驱动回合
p1.on('game-start', ({ firstPlayerIdx, players, totalBubbles: tb }) => {
  if (gameStarted) return;
  gameStarted = true;
  totalBubbles = tb;
  currentIdx = firstPlayerIdx;
  console.log('🎮 游戏开始！先手：' + players[firstPlayerIdx] + '，泡泡数：' + tb);
  doMove();
});

p1.on('turn-change', ({ currentPlayerIdx, remaining }) => {
  if (gameOver) return;
  currentIdx = currentPlayerIdx;
  console.log('🔄 换人 → ' + (currentPlayerIdx === 0 ? '甲' : '乙') + '（剩余 ' + remaining + '）');
  setTimeout(doMove, 300);
});

p1.on('game-over', ({ winnerIdx, winnerName }) => {
  if (gameOver) return;
  gameOver = true;
  console.log('🏆 胜者：' + winnerName + '  ✅ 联机测试通过！');
  p1.disconnect(); p2.disconnect();
  process.exit(0);
});

function doMove() {
  if (gameOver) return;
  const s = currentIdx === 0 ? p1 : p2;
  const remaining = totalBubbles - poppedCount;
  const cnt = Math.min(1 + Math.floor(Math.random() * 2), remaining);
  console.log('[' + (currentIdx === 0 ? '甲' : '乙') + '] 按 ' + cnt + ' 个泡泡');
  for (let i = 0; i < cnt; i++) {
    s.emit('toggle-bubble', { index: poppedCount + i, roomId });
  }
  poppedCount += cnt;
  setTimeout(() => s.emit('confirm-pop', { roomId }), 400);
}

setTimeout(() => {
  if (!gameOver) { console.error('⏰ 超时'); process.exit(1); }
}, 15000);
