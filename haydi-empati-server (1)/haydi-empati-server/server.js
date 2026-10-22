/**
 * Haydi Empati — Socket.io Sunucu
 * Çalıştırma: npm install && npm start
 * Tarayıcı: http://localhost:3000
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Statik dosyalar (client)
app.use(express.static(path.join(__dirname, 'public')));

// ========== ODA DEPOSU ==========
// rooms[code] = {
//   code, hostId,
//   players: { [socketId]: { id, name, isHost, score, submitted } },
//   currentCard, usedCards, phase, timerEnd, answers, lastRoundScores
// }
const rooms = {};

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getRoomPublicState(room) {
  const players = Object.values(room.players).map(p => ({
    id: p.id,
    name: p.name,
    isHost: p.isHost,
    score: p.score || 0,
    submitted: !!p.submitted,
    ready: !!p.ready
  }));
  const allReady = players.length > 0 && players.every(p => p.ready);
  return {
    code: room.code,
    players,
    allReady,
    currentCard: room.currentCard,
    usedCards: room.usedCards || [],
    phase: room.phase || 'idle',
    timerEnd: room.timerEnd || 0,
    answers: room.answers || {},
    lastRoundScores: room.lastRoundScores || {}
  };
}

function broadcastRoom(code) {
  const room = rooms[code];
  if (!room) return;
  io.to(code).emit('room-state', getRoomPublicState(room));
}

// ========== SOCKET ==========
io.on('connection', (socket) => {
  console.log('[+] Bağlandı:', socket.id);

  // --- Oda oluştur ---
  socket.on('create-room', ({ name }, cb) => {
    name = (name || '').trim().slice(0, 18);
    if (!name) return cb?.({ ok: false, error: 'İsim gerekli' });

    let code;
    do { code = generateCode(); } while (rooms[code]);

    rooms[code] = {
      code,
      hostId: socket.id,
      players: {
        [socket.id]: { id: socket.id, name, isHost: true, score: 0, submitted: false, ready: false }
      },
      currentCard: null,
      usedCards: [],
      phase: 'idle',
      timerEnd: 0,
      answers: {},
      lastRoundScores: {}
    };

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerName = name;

    console.log(`[Oda] Oluşturuldu: ${code} (host: ${name})`);
    cb?.({ ok: true, code, state: getRoomPublicState(rooms[code]) });
  });

  // --- Odaya katıl ---
  socket.on('join-room', ({ code, name }, cb) => {
    code = (code || '').trim().toUpperCase();
    name = (name || '').trim().slice(0, 18);
    if (!name) return cb?.({ ok: false, error: 'İsim gerekli' });
    if (!code || !rooms[code]) return cb?.({ ok: false, error: 'Oda bulunamadı' });

    const room = rooms[code];
    // Aynı isim varsa engelle (basit)
    const nameTaken = Object.values(room.players).some(p => p.name.toLowerCase() === name.toLowerCase());
    if (nameTaken) return cb?.({ ok: false, error: 'Bu isim odada kullanılıyor' });

    room.players[socket.id] = {
      id: socket.id,
      name,
      isHost: false,
      score: 0,
      submitted: false,
      ready: false
    };
    // Yeni oyuncu gelince herkesin hazırını sıfırla
    Object.values(room.players).forEach(p => { p.ready = false; });

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerName = name;

    console.log(`[Oda] ${name} katıldı → ${code}`);
    broadcastRoom(code);
    cb?.({ ok: true, code, state: getRoomPublicState(room) });
  });

  // --- Hazır / hazır değil ---
  socket.on('toggle-ready', (cb) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return cb?.({ ok: false, error: 'Oda yok' });
    const player = room.players[socket.id];
    if (!player) return cb?.({ ok: false, error: 'Oyuncu bulunamadı' });

    player.ready = !player.ready;
    broadcastRoom(code);
    cb?.({ ok: true, ready: player.ready, state: getRoomPublicState(room) });
  });

  // --- Oyunu başlat (sadece host, herkes hazır olmalı) ---
  socket.on('start-game', (cb) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return cb?.({ ok: false, error: 'Oda yok' });
    if (room.hostId !== socket.id) return cb?.({ ok: false, error: 'Sadece host başlatabilir' });

    const players = Object.values(room.players);
    if (players.length < 1) return cb?.({ ok: false, error: 'Oyuncu yok' });
    if (!players.every(p => p.ready)) {
      return cb?.({ ok: false, error: 'Herkes hazır olmalı' });
    }

    room.phase = 'idle';
    room.currentCard = null;
    room.answers = {};
    room.timerEnd = 0;
    Object.values(room.players).forEach(p => {
      p.submitted = false;
      p.ready = false;
    });

    io.to(code).emit('game-started', getRoomPublicState(room));
    cb?.({ ok: true });
  });

  // --- Yeni kart çek (host) ---
  socket.on('draw-card', ({ card, usedCards, timerEnd }, cb) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return cb?.({ ok: false, error: 'Oda yok' });
    if (room.hostId !== socket.id) return cb?.({ ok: false, error: 'Sadece host kart çekebilir' });

    room.currentCard = card;
    room.usedCards = usedCards || room.usedCards;
    room.phase = 'selecting';
    room.timerEnd = timerEnd;
    room.answers = {};
    room.lastRoundScores = {};
    Object.values(room.players).forEach(p => { p.submitted = false; });

    io.to(code).emit('round-start', {
      card: room.currentCard,
      timerEnd: room.timerEnd,
      state: getRoomPublicState(room)
    });
    cb?.({ ok: true });
  });

  // --- Cevap gönder ---
  socket.on('submit-answer', ({ answer }, cb) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return cb?.({ ok: false, error: 'Oda yok' });
    if (room.phase !== 'selecting') return cb?.({ ok: false, error: 'Şu an cevap kabul edilmiyor' });

    const player = room.players[socket.id];
    if (!player) return cb?.({ ok: false, error: 'Oyuncu bulunamadı' });

    room.answers[player.name] = answer;
    player.submitted = true;

    io.to(code).emit('answer-received', {
      name: player.name,
      answer,
      state: getRoomPublicState(room)
    });

    // Herkes gönderdiyse host'a haber ver (istemci de kontrol eder)
    const allDone = Object.values(room.players).every(p => p.submitted);
    if (allDone) {
      io.to(code).emit('all-submitted', { state: getRoomPublicState(room) });
    }

    cb?.({ ok: true });
  });

  // --- Turu aç / puanla (host) ---
  socket.on('reveal-round', ({ players, lastRoundScores, answers }, cb) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return cb?.({ ok: false, error: 'Oda yok' });
    if (room.hostId !== socket.id) return cb?.({ ok: false, error: 'Sadece host açabilir' });

    // Host'tan gelen güncel skorları uygula
    if (players) {
      players.forEach(up => {
        const local = Object.values(room.players).find(p => p.name === up.name);
        if (local) local.score = up.score ?? local.score;
      });
    }
    room.answers = answers || room.answers;
    room.lastRoundScores = lastRoundScores || {};
    room.phase = 'revealed';
    room.timerEnd = 0;

    io.to(code).emit('round-revealed', {
      answers: room.answers,
      lastRoundScores: room.lastRoundScores,
      state: getRoomPublicState(room)
    });
    cb?.({ ok: true });
  });

  // --- Durum iste ---
  socket.on('request-state', (cb) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return cb?.({ ok: false });
    cb?.({ ok: true, state: getRoomPublicState(room) });
  });

  // --- Ayrıl / bağlantı kopması ---
  function leaveRoom() {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    const name = room.players[socket.id]?.name;

    delete room.players[socket.id];
    socket.leave(code);
    socket.data.roomCode = null;

    // Oda boşaldıysa sil
    if (Object.keys(room.players).length === 0) {
      delete rooms[code];
      console.log(`[Oda] Silindi (boş): ${code}`);
      return;
    }

    // Host gittiyse yeni host ata
    if (room.hostId === socket.id) {
      const next = Object.values(room.players)[0];
      room.hostId = next.id;
      next.isHost = true;
      console.log(`[Oda] Yeni host: ${next.name} → ${code}`);
    }

    console.log(`[Oda] ${name || '?'} ayrıldı → ${code}`);
    io.to(code).emit('player-left', {
      name,
      state: getRoomPublicState(room)
    });
  }

  socket.on('leave-room', () => leaveRoom());
  socket.on('disconnect', () => {
    leaveRoom();
    console.log('[-] Ayrıldı:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`\n🎮 Haydi Empati sunucusu çalışıyor`);
  console.log(`   → http://localhost:${PORT}\n`);
});
