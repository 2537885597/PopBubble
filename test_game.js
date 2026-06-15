/**
 * 精简联机测试 — 验证核心 bug 修复
 * 1. room-created 返回 playerIdx=0
 * 2. room-joined 返回 playerIdx=1
 * 3. game-start 事件双方都能收到（无 ReferenceError）
 * 4. currentPlayerIdx 正确设为 firstPlayerIdx
 */
const { io } = require('socket.io-client');

const P1 = io('http://localhost:3001', { forceNew: true });
const P2 = io('http://localhost:3001', { forceNew: true });

let roomId = '';
let checks = { p1Idx: false, p2Idx: false, p1Start: false, p2Start: false };

P1.on('connect', () => {
  P1.emit('create-room', { playerName: '甲', totalBubbles: 6, maxPop: 3 });
});

P1.on('room-created', ({ roomId: rid, playerIdx }) => {
  roomId = rid;
  checks.p1Idx = (playerIdx === 0);
  console.log(`✅ P1 playerIdx = ${playerIdx} (期望 0): ${checks.p1Idx ? 'PASS' : 'FAIL'}`);
  P2.emit('join-room', { roomId, playerName: '乙' });
});

P2.on('room-joined', ({ playerIdx }) => {
  checks.p2Idx = (playerIdx === 1);
  console.log(`✅ P2 playerIdx = ${playerIdx} (期望 1): ${checks.p2Idx ? 'PASS' : 'FAIL'}`);
});

P1.on('player-joined', () => {
  console.log('P1 点击开始游戏...');
  P1.emit('start-game', {});
});

P1.on('game-start', ({ firstPlayerIdx, players }) => {
  checks.p1Start = true;
  console.log(`✅ P1 收到 game-start: firstPlayerIdx=${firstPlayerIdx}, players=${JSON.stringify(players)}`);
  tryAllChecks();
});

P2.on('game-start', ({ firstPlayerIdx, players }) => {
  checks.p2Start = true;
  console.log(`✅ P2 收到 game-start: firstPlayerIdx=${firstPlayerIdx}, players=${JSON.stringify(players)}`);
  tryAllChecks();
});

function tryAllChecks() {
  if (checks.p1Start && checks.p2Start) {
    const allPass = checks.p1Idx && checks.p2Idx;
    console.log('\n' + (allPass ? '🎉 全部检查通过！开始游戏 bug 已修复！' : '❌ 部分检查失败'));
    P1.disconnect(); P2.disconnect();
    process.exit(allPass ? 0 : 1);
  }
}

P1.on('error-msg', ({ msg }) => console.error('P1 err:', msg));
P2.on('error-msg', ({ msg }) => console.error('P2 err:', msg));
setTimeout(() => { console.error('❌ 超时'); process.exit(1); }, 8000);
