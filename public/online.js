"use strict";

if (!sessionStorage.getItem('chess-token')) {
    location.href = '/';
}

const socket = io({
    auth: {
        token: sessionStorage.getItem('chess-token')
    }
});

// User info
const username = sessionStorage.getItem('chess-username') || 'Player';
const elo      = parseInt(sessionStorage.getItem('chess-elo') || '1200', 10);
const wins     = parseInt(sessionStorage.getItem('chess-wins') || '0', 10);
const losses   = parseInt(sessionStorage.getItem('chess-losses') || '0', 10);

const avatarEl   = document.getElementById('user-avatar');
const usernameEl = document.getElementById('display-username');
const eloEl      = document.getElementById('display-elo');

if (avatarEl)   avatarEl.textContent   = username.charAt(0).toUpperCase();
if (usernameEl) usernameEl.textContent = username;
if (eloEl)      eloEl.textContent      = `ELO: ${elo}`;

// DOM Elements
const btnCreateRoom     = document.getElementById('btn-create-room');
const codeBox           = document.getElementById('code-box');
const roomCodeDisplay   = document.getElementById('room-code-display');
const btnCopyCode       = document.getElementById('btn-copy-code');
const createStatus      = document.getElementById('create-status');
const createStatusText  = document.getElementById('create-status-text');

const joinCodeInput     = document.getElementById('join-code-input');
const btnJoinRoom       = document.getElementById('btn-join-room');
const joinStatus        = document.getElementById('join-status');
const joinStatusText    = document.getElementById('join-status-text');

let currentRoomId = null;

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── Create Room ─────────────────────────────────────────────────────────────
btnCreateRoom.addEventListener('click', () => {
    currentRoomId = generateRoomCode();
    
    socket.emit('create-room', {
        roomId: currentRoomId,
        playerInfo: { username, elo, wins, losses }
    });
});

socket.on('room-created', (roomId) => {
    btnCreateRoom.style.display = 'none';
    codeBox.style.display       = 'flex';
    createStatus.style.display  = 'flex';
    roomCodeDisplay.textContent = roomId;
    createStatusText.textContent = 'Waiting for the other player to join...';
});

// Copy button
btnCopyCode.addEventListener('click', () => {
    if (!currentRoomId) return;
    navigator.clipboard.writeText(currentRoomId);
    btnCopyCode.textContent = '✓ Copied!';
    setTimeout(() => { btnCopyCode.textContent = '📋 Copy'; }, 2000);
});

// ── Join Room ─────────────────────────────────────────────────────────────
btnJoinRoom.addEventListener('click', () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (!code || code.length !== 6) {
        joinStatus.style.display = 'flex';
        joinStatusText.textContent = 'Please enter a valid 6-character room code.';
        return;
    }

    joinStatus.style.display = 'none';
    socket.emit('join-room', {
        roomId: code,
        playerInfo: { username, elo, wins, losses }
    });
});

socket.on('join-error', (msg) => {
    joinStatus.style.display = 'flex';
    joinStatusText.textContent = msg;
});

socket.on('room-joined', (roomId) => {
    currentRoomId = roomId;
    joinStatus.style.display = 'flex';
    joinStatus.className = 'status-box waiting';
    joinStatusText.textContent = 'Connected! Waiting for board setup...';
});

// ── Match Matched (Both Players Connected) ──────────────────────────────
socket.on('game-matched', (data) => {
    sessionStorage.setItem('chess-mode', 'online');
    sessionStorage.setItem('online-room-id', data.roomId);
    sessionStorage.setItem('white-player', JSON.stringify(data.whitePlayer));
    sessionStorage.setItem('black-player', JSON.stringify(data.blackPlayer));

    if (createStatus) {
        createStatus.className = 'status-box waiting';
        createStatusText.textContent = '✅ Player joined! Redirecting to ChessHub...';
    }
    if (joinStatus) {
        joinStatus.className = 'status-box waiting';
        joinStatusText.textContent = '✅ Connected! Redirecting to ChessHub...';
    }

    setTimeout(() => {
        location.href = '/game.html';
    }, 1200);
});
