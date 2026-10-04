"use strict";

// ── Auth guard ────────────────────────────────────────────────────────────────
if (!sessionStorage.getItem('chess-token')) {
    location.href = '/';
}

// ── Populate user info ────────────────────────────────────────────────────────
const username = sessionStorage.getItem('chess-username') || '?';
const elo      = sessionStorage.getItem('chess-elo')      || '—';

const avatarEl   = document.getElementById('user-avatar');
const usernameEl = document.getElementById('display-username');
const eloEl      = document.getElementById('display-elo');

if (avatarEl)   avatarEl.textContent   = username.charAt(0).toUpperCase();
if (usernameEl) usernameEl.textContent = username;
if (eloEl)      eloEl.textContent      = `ELO: ${elo}`;

// ── Logout ────────────────────────────────────────────────────────────────────
document.getElementById('logout-btn')?.addEventListener('click', () => {
    sessionStorage.removeItem('chess-token');
    sessionStorage.removeItem('chess-username');
    sessionStorage.removeItem('chess-elo');
    sessionStorage.removeItem('chess-mode');
    location.href = '/';
});

// ── Mode card selection ───────────────────────────────────────────────────────
document.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
        const mode = card.dataset.mode;
        sessionStorage.setItem('chess-mode', mode);
        if (mode === 'online') {
            location.href = '/online.html';
        } else {
            location.href = '/game.html';
        }
    });
});
