const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// 托管前端静态文件（本地测试用）
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------- 房间管理 ----------
// rooms: { [roomId]: { players: [{id, name, ready}], totalBubbles, maxPop, bubbles, currentPlayerIdx, ... } }
const rooms = {};

function genRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function getRoomList() {
  return Object.entries(rooms)
    .filter(([, r]) => r.players.length < 2)
    .map(([id, r]) => ({ id, host: r.players[0]?.name || '???', players: r.players.length }));
}

// ---------- Socket.io ----------
io.on('connection', (socket) => {
  console.log(`[连接] ${socket.id}`);

  // 创建房间
  socket.on('create-room', ({ playerName, totalBubbles, maxPop }) => {
    const roomId = genRoomId();
    rooms[roomId] = {
      players: [{ id: socket.id, name: playerName }],
      totalBubbles,
      maxPop,
      bubbles: [],
      currentPlayerIdx: 0,
      started: false,
    };
    socket.join(roomId);
    socket.roomId = roomId;
    socket.playerIdx = 0;
    console.log(`[创建房间] ${roomId} by ${playerName}`);
    socket.emit('room-created', { roomId });
    io.emit('room-list', getRoomList());
  });

  // 加入房间
  socket.on('join-room', ({ roomId, playerName }) => {
    const room = rooms[roomId];
    if (!room) { socket.emit('error-msg', { msg: '房间不存在' }); return; }
    if (room.players.length >= 2) { socket.emit('error-msg', { msg: '房间已满' }); return; }
    if (room.started) { socket.emit('error-msg', { msg: '游戏已开始' }); return; }
    room.players.push({ id: socket.id, name: playerName });
    socket.join(roomId);
    socket.roomId = roomId;
    socket.playerIdx = 1;
    console.log(`[加入房间] ${roomId} ${playerName}`);
    // 通知双方
    io.to(roomId).emit('player-joined', {
      players: room.players.map(p => p.name),
      host: room.players[0].name,
      totalBubbles: room.totalBubbles,
      maxPop: room.maxPop,
    });
    io.emit('room-list', getRoomList());
  });

  // 获取房间列表
  socket.on('get-room-list', () => {
    socket.emit('room-list', getRoomList());
  });

  // 开始游戏（房主触发，抽签先手）
  socket.on('start-game', () => {
    const room = rooms[socket.roomId];
    if (!room || room.players.length < 2) return;
    // 投币决定先手
    const firstIdx = Math.random() < 0.5 ? 0 : 1;
    room.currentPlayerIdx = firstIdx;
    room.bubbles = Array(room.totalBubbles).fill(false);
    room.started = true;
    room.selectedBubbles = [];
    room.roundCount = 1;
    console.log(`[开始游戏] ${socket.roomId} 先手: ${room.players[firstIdx].name}`);
    io.to(socket.roomId).emit('game-start', {
      firstPlayerIdx: firstIdx,
      players: room.players.map(p => p.name),
      totalBubbles: room.totalBubbles,
      maxPop: room.maxPop,
    });
  });

  // 选择/取消泡泡
  socket.on('toggle-bubble', ({ index }) => {
    const room = rooms[socket.roomId];
    if (!room || !room.started) return;
    // 验证是否是当前玩家
    if (room.players[room.currentPlayerIdx]?.id !== socket.id) return;
    if (room.bubbles[index]) return; // 已按破
    if (!room._selected) room._selected = new Set();
    if (room._selected.has(index)) {
      room._selected.delete(index);
    } else {
      if (room._selected.size >= room.maxPop) return;
      room._selected.add(index);
    }
    // 广播选择状态
    io.to(socket.roomId).emit('selection-update', {
      selected: [...room._selected],
      currentPlayerIdx: room.currentPlayerIdx,
    });
  });

  // 确认按泡泡
  socket.on('confirm-pop', () => {
    const room = rooms[socket.roomId];
    if (!room || !room.started) return;
    if (room.players[room.currentPlayerIdx]?.id !== socket.id) return;
    if (!room._selected || room._selected.size === 0) return;

    const toPop = [...room._selected];
    room._selected = new Set();

    // 按破泡泡
    toPop.forEach(idx => { room.bubbles[idx] = true; });

    const remaining = room.bubbles.filter(b => !b).length;

    if (remaining === 0) {
      // 游戏结束，当前玩家获胜
      const winnerIdx = room.currentPlayerIdx;
      const loserIdx = winnerIdx === 0 ? 1 : 0;
      io.to(socket.roomId).emit('game-over', {
        winnerIdx,
        winnerName: room.players[winnerIdx].name,
        loserName: room.players[loserIdx].name,
        loserIdx,
      });
      room.started = false;
    } else {
      // 换人
      room.currentPlayerIdx = room.currentPlayerIdx === 0 ? 1 : 0;
      io.to(socket.roomId).emit('turn-change', {
        currentPlayerIdx: room.currentPlayerIdx,
        currentPlayerName: room.players[room.currentPlayerIdx].name,
        remaining,
        lastPopped: toPop,
      });
    }
  });

  // 重选
  socket.on('reset-selection', () => {
    const room = rooms[socket.roomId];
    if (!room || !room.started) return;
    if (room.players[room.currentPlayerIdx]?.id !== socket.id) return;
    room._selected = new Set();
    io.to(socket.roomId).emit('selection-update', {
      selected: [],
      currentPlayerIdx: room.currentPlayerIdx,
    });
  });

  // 再来一轮
  socket.on('play-again', () => {
    const room = rooms[socket.roomId];
    if (!room) return;
    // 重置
    room.bubbles = Array(room.totalBubbles).fill(false);
    room.currentPlayerIdx = room.currentPlayerIdx === 0 ? 1 : 0; // 输家先手（上一局赢家是先手，这局换人）
    room.started = true;
    room._selected = new Set();
    room.roundCount = (room.roundCount || 0) + 1;
    io.to(socket.roomId).emit('game-start', {
      firstPlayerIdx: room.currentPlayerIdx,
      players: room.players.map(p => p.name),
      totalBubbles: room.totalBubbles,
      maxPop: room.maxPop,
      isRematch: true,
    });
  });

  // 断开连接
  socket.on('disconnect', () => {
    console.log(`[断开] ${socket.id}`);
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[roomId];
        console.log(`[房间销毁] ${roomId}`);
      } else {
        io.to(roomId).emit('opponent-left');
      }
      io.emit('room-list', getRoomList());
    }
  });
});

// ---------- 启动 ----------
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🫧 按泡泡板服务器运行在 http://localhost:${PORT}`);
});
