/**
 * Haydi Empati — Socket.io Sunucu (Node 12 uyumlu)
 * Çalıştırma: npm install && npm start
 * Tarayıcı: http://localhost:3000
 */

var express = require('express');
var http = require('http');
var socketIo = require('socket.io');
var path = require('path');

var app = express();
var server = http.createServer(app);
var io = socketIo(server, {
  cors: { origin: '*' }
});

var PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ========== ODA DEPOSU ==========
var rooms = {};
var COLORS = ['#E53E3E', '#D69E2E', '#38A169', '#3182CE']; // Kırmızı Sarı Yeşil Mavi

function generateCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function reply(cb, data) {
  if (typeof cb === 'function') cb(data);
}

function assignColor(room) {
  var used = {};
  Object.keys(room.players).forEach(function (id) {
    var c = room.players[id].color;
    if (c) used[c] = true;
  });
  for (var i = 0; i < COLORS.length; i++) {
    if (!used[COLORS[i]]) return COLORS[i];
  }
  return COLORS[0];
}

function getRoomPublicState(room) {
  var players = Object.keys(room.players).map(function (id) {
    var p = room.players[id];
    return {
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      score: p.score || 0,
      submitted: !!p.submitted,
      ready: !!p.ready,
      color: p.color || '#718096',
      position: p.position || 0,
      hasPass: !!p.hasPass
    };
  });
  var allReady = players.length > 0 && players.every(function (p) { return p.ready; });
  return {
    code: room.code,
    players: players,
    allReady: allReady,
    currentCard: room.currentCard,
    usedCards: room.usedCards || [],
    phase: room.phase || 'idle',
    timerEnd: room.timerEnd || 0,
    answers: room.answers || {},
    lastRoundScores: room.lastRoundScores || {},
    videoClosedCount: room.videoClosedCount || 0
  };
}

function broadcastRoom(code) {
  var room = rooms[code];
  if (!room) return;
  io.to(code).emit('room-state', getRoomPublicState(room));
}

function attachPlayer(socket, code, name) {
  code = (code || '').toString().trim().toUpperCase();
  name = (name || '').toString().trim().slice(0, 18);
  if (!code || !rooms[code]) return null;
  var room = rooms[code];

  // Zaten bağlıysa
  if (room.players[socket.id]) {
    socket.data.roomCode = code;
    socket.data.playerName = room.players[socket.id].name;
    return room.players[socket.id];
  }

  // İsimle yeniden bağlanma (cihaz değişimi / yenileme)
  var existingId = null;
  Object.keys(room.players).forEach(function (id) {
    if (room.players[id].name.toLowerCase() === name.toLowerCase()) existingId = id;
  });

  if (existingId) {
    var old = room.players[existingId];
    delete room.players[existingId];
    old.id = socket.id;
    room.players[socket.id] = old;
    if (room.hostId === existingId) room.hostId = socket.id;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerName = old.name;
    return old;
  }

  // Yeni oyuncu
  if (Object.keys(room.players).length >= 4) return null;

  room.players[socket.id] = {
    id: socket.id,
    name: name,
    isHost: false,
    score: 0,
    submitted: false,
    ready: false,
    color: assignColor(room),
    position: 0,
    hasPass: false
  };
  Object.keys(room.players).forEach(function (id) {
    room.players[id].ready = false;
  });

  socket.join(code);
  socket.data.roomCode = code;
  socket.data.playerName = name;
  return room.players[socket.id];
}

io.on('connection', function (socket) {
  console.log('[+] Baglandi:', socket.id);

  // --- Oda olustur ---
  socket.on('create-room', function (payload, cb) {
    if (typeof payload === 'function') { cb = payload; payload = {}; }
    var name = ((payload && payload.name) || '').trim().slice(0, 18);
    if (!name) return reply(cb, { ok: false, error: 'Isim gerekli' });

    var code;
    do { code = generateCode(); } while (rooms[code]);

    rooms[code] = {
      code: code,
      hostId: socket.id,
      players: {},
      currentCard: null,
      usedCards: [],
      phase: 'idle',
      timerEnd: 0,
      answers: {},
      lastRoundScores: {},
      videoClosedCount: 0
    };
    rooms[code].players[socket.id] = {
      id: socket.id,
      name: name,
      isHost: true,
      score: 0,
      submitted: false,
      ready: false,
      color: COLORS[0],
      position: 0,
      hasPass: false
    };

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerName = name;

    console.log('[Oda] Olusturuldu: ' + code + ' (host: ' + name + ')');
    reply(cb, { ok: true, code: code, state: getRoomPublicState(rooms[code]) });
  });

  // --- Odaya katil ---
  socket.on('join-room', function (payload, cb) {
    if (typeof payload === 'function') { cb = payload; payload = {}; }
    var code = ((payload && payload.code) || '').trim().toUpperCase();
    var name = ((payload && payload.name) || '').trim().slice(0, 18);
    if (!name) return reply(cb, { ok: false, error: 'Isim gerekli' });
    if (!code || !rooms[code]) return reply(cb, { ok: false, error: 'Oda bulunamadi' });

    var room = rooms[code];
    var nameTaken = Object.keys(room.players).some(function (id) {
      return room.players[id].name.toLowerCase() === name.toLowerCase();
    });
    if (nameTaken) return reply(cb, { ok: false, error: 'Bu isim odada kullaniliyor' });

    if (Object.keys(room.players).length >= 4) {
      return reply(cb, { ok: false, error: 'Oda dolu (maks 4 kisi)' });
    }

    room.players[socket.id] = {
      id: socket.id,
      name: name,
      isHost: false,
      score: 0,
      submitted: false,
      ready: false,
      color: assignColor(room),
      position: 0,
      hasPass: false
    };
    Object.keys(room.players).forEach(function (id) {
      room.players[id].ready = false;
    });

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerName = name;

    console.log('[Oda] ' + name + ' katildi -> ' + code);
    broadcastRoom(code);
    reply(cb, { ok: true, code: code, state: getRoomPublicState(room) });
  });

  // --- Yeniden baglan ---
  socket.on('rejoin-room', function (payload, cb) {
    if (typeof payload === 'function') { cb = payload; payload = {}; }
    var code = (payload && payload.code) || '';
    var name = (payload && payload.name) || '';
    var player = attachPlayer(socket, code, name);
    if (!player) return reply(cb, { ok: false, error: 'Oda yok' });
    var room = rooms[socket.data.roomCode];
    broadcastRoom(room.code);
    reply(cb, { ok: true, code: room.code, state: getRoomPublicState(room) });
  });

  // --- Hazir / hazir degil ---
  socket.on('toggle-ready', function (payload, cb) {
    if (typeof payload === 'function') {
      cb = payload;
      payload = {};
    }
    var code = (payload && payload.code) || (socket.data && socket.data.roomCode);
    var name = (payload && payload.name) || (socket.data && socket.data.playerName);
    var player = attachPlayer(socket, code, name);
    if (!player) return reply(cb, { ok: false, error: 'Oda yok' });
    var room = rooms[socket.data.roomCode];

    player.ready = !player.ready;
    broadcastRoom(room.code);
    reply(cb, { ok: true, ready: player.ready, state: getRoomPublicState(room) });
  });

  // --- Oyunu baslat ---
  socket.on('start-game', function (payload, cb) {
    if (typeof payload === 'function') { cb = payload; payload = {}; }
    var code = (payload && payload.code) || (socket.data && socket.data.roomCode);
    var room = rooms[code];
    if (!room) return reply(cb, { ok: false, error: 'Oda yok' });
    if (room.hostId !== socket.id) return reply(cb, { ok: false, error: 'Sadece host baslatabilir' });

    var players = Object.keys(room.players).map(function (id) { return room.players[id]; });
    if (players.length < 1) return reply(cb, { ok: false, error: 'Oyuncu yok' });
    if (!players.every(function (p) { return p.ready; })) {
      return reply(cb, { ok: false, error: 'Herkes hazir olmali' });
    }

    room.phase = 'idle';
    room.currentCard = null;
    room.answers = {};
    room.timerEnd = 0;
    room.videoClosedCount = 0;
    Object.keys(room.players).forEach(function (id) {
      room.players[id].submitted = false;
      room.players[id].ready = false;
    });

    io.to(code).emit('game-started', getRoomPublicState(room));
    reply(cb, { ok: true });
  });

  // --- Yeni kart cek ---
  socket.on('draw-card', function (payload, cb) {
    if (typeof payload === 'function') { cb = payload; payload = {}; }
    var code = (payload && payload.code) || (socket.data && socket.data.roomCode);
    var room = rooms[code];
    if (!room) return reply(cb, { ok: false, error: 'Oda yok' });
    if (room.hostId !== socket.id) return reply(cb, { ok: false, error: 'Sadece host kart cekebilir' });

    room.currentCard = payload.card || null;
    room.usedCards = payload.usedCards || room.usedCards;
    room.phase = 'selecting';
    room.timerEnd = payload.timerEnd || 0;
    room.answers = {};
    room.lastRoundScores = {};
    room.videoClosedCount = 0;
    Object.keys(room.players).forEach(function (id) {
      room.players[id].submitted = false;
    });

    io.to(code).emit('round-start', {
      card: room.currentCard,
      timerEnd: room.timerEnd,
      state: getRoomPublicState(room)
    });
    reply(cb, { ok: true });
  });

  // --- Cevap gonder ---
  socket.on('submit-answer', function (payload, cb) {
    if (typeof payload === 'function') { cb = payload; payload = {}; }
    var code = (payload && payload.roomCode) || (socket.data && socket.data.roomCode);
    var room = rooms[code];
    if (!room) return reply(cb, { ok: false, error: 'Oda yok' });
    if (room.phase !== 'selecting') return reply(cb, { ok: false, error: 'Su an cevap kabul edilmiyor' });

    var player = room.players[socket.id];
    if (!player) return reply(cb, { ok: false, error: 'Oyuncu bulunamadi' });

    room.answers[player.name] = payload.answer;
    player.submitted = true;

    io.to(code).emit('answer-received', {
      name: player.name,
      answer: payload.answer,
      state: getRoomPublicState(room)
    });

    var allDone = Object.keys(room.players).every(function (id) {
      return room.players[id].submitted;
    });
    if (allDone) {
      io.to(code).emit('all-submitted', { state: getRoomPublicState(room) });
    }

    reply(cb, { ok: true });
  });

  // --- Turu ac / puanla ---
  socket.on('reveal-round', function (payload, cb) {
    if (typeof payload === 'function') { cb = payload; payload = {}; }
    var code = (payload && payload.code) || (socket.data && socket.data.roomCode);
    var room = rooms[code];
    if (!room) return reply(cb, { ok: false, error: 'Oda yok' });
    if (room.hostId !== socket.id) return reply(cb, { ok: false, error: 'Sadece host acabilir' });

    if (payload.players) {
      payload.players.forEach(function (up) {
        var local = null;
        Object.keys(room.players).forEach(function (id) {
          if (room.players[id].name === up.name) local = room.players[id];
        });
        if (local) {
          local.score = (up.score != null) ? up.score : local.score;
          if (up.position != null) local.position = up.position;
          if (up.hasPass != null) local.hasPass = up.hasPass;
        }
      });
    }
    room.answers = payload.answers || room.answers;
    room.lastRoundScores = payload.lastRoundScores || {};
    room.phase = 'revealed';
    room.timerEnd = 0;

    io.to(code).emit('round-revealed', {
      answers: room.answers,
      lastRoundScores: room.lastRoundScores,
      state: getRoomPublicState(room)
    });
    reply(cb, { ok: true });
  });

  // --- Video kapandi (senkron) ---
  socket.on('video-closed', function (payload, cb) {
    if (typeof payload === 'function') { cb = payload; payload = {}; }
    var code = (payload && payload.code) || (socket.data && socket.data.roomCode);
    var room = rooms[code];
    if (!room) return reply(cb, { ok: false, error: 'Oda yok' });

    room.videoClosedCount = (room.videoClosedCount || 0) + 1;
    var total = Object.keys(room.players).length;

    io.to(code).emit('video-closed-update', {
      count: room.videoClosedCount,
      total: total,
      state: getRoomPublicState(room)
    });

    if (room.videoClosedCount >= total) {
      io.to(code).emit('all-videos-closed', { state: getRoomPublicState(room) });
    }
    reply(cb, { ok: true });
  });

  // --- Durum iste ---
  socket.on('request-state', function (payload, cb) {
    if (typeof payload === 'function') { cb = payload; payload = {}; }
    var code = (payload && payload.code) || (socket.data && socket.data.roomCode);
    var room = rooms[code];
    if (!room) return reply(cb, { ok: false });
    reply(cb, { ok: true, state: getRoomPublicState(room) });
  });

  // --- Ayril / baglanti kopmasi ---
  function leaveRoom() {
    var code = socket.data && socket.data.roomCode;
    if (!code || !rooms[code]) return;
    var room = rooms[code];
    var name = room.players[socket.id] ? room.players[socket.id].name : null;

    delete room.players[socket.id];
    socket.leave(code);
    socket.data.roomCode = null;

    if (Object.keys(room.players).length === 0) {
      delete rooms[code];
      console.log('[Oda] Silindi (bos): ' + code);
      return;
    }

    if (room.hostId === socket.id) {
      var nextId = Object.keys(room.players)[0];
      var next = room.players[nextId];
      room.hostId = next.id;
      next.isHost = true;
      console.log('[Oda] Yeni host: ' + next.name + ' -> ' + code);
    }

    console.log('[Oda] ' + (name || '?') + ' ayrildi -> ' + code);
    io.to(code).emit('player-left', {
      name: name,
      state: getRoomPublicState(room)
    });
  }

  socket.on('leave-room', function () { leaveRoom(); });
  socket.on('disconnect', function () {
    leaveRoom();
    console.log('[-] Ayrildi:', socket.id);
  });
});

server.listen(PORT, function () {
  console.log('\nHaydi Empati sunucusu calisiyor');
  console.log('   -> http://localhost:' + PORT + '\n');
});
