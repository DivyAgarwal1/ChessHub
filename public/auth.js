"use strict";

// ── Auth guard: if already logged in, skip to mode selection ─────────────────
if (sessionStorage.getItem('chess-token')) {
    location.href = '/mode.html';
}

// ── Tab switching ─────────────────────────────────────────────────────────────
const tabs  = document.querySelectorAll('.auth-tab');
const forms = document.querySelectorAll('.auth-form');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        tabs.forEach(t  => t.classList.toggle('active', t.dataset.tab === target));
        forms.forEach(f => f.classList.toggle('active', f.id === `${target}-form`));
        // Clear old messages
        ['login-msg', 'signup-msg'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.className = 'auth-message';
        });
    });
});

// ── Message helper ────────────────────────────────────────────────────────────
function showMsg(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className   = `auth-message ${type}`;
}

function setLoading(btnId, loading, defaultText) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled    = loading;
    btn.textContent = loading ? 'Please wait…' : defaultText;
    btn.style.opacity = loading ? '0.7' : '1';
}

// ── Login ─────────────────────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();

    if (!username || !password) {
        return showMsg('login-msg', 'Please fill in both fields.', 'error');
    }

    setLoading('login-submit', true, 'Login →');
    try {
        const res  = await fetch('/api/login', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            sessionStorage.setItem('chess-token',    data.token);
            sessionStorage.setItem('chess-username', data.username);
            sessionStorage.setItem('chess-elo',      data.elo);
            sessionStorage.setItem('chess-wins',     data.wins || 0);
            sessionStorage.setItem('chess-losses',   data.losses || 0);
            showMsg('login-msg', '✓ Login successful! Redirecting…', 'success');
            setTimeout(() => location.href = '/mode.html', 700);
        } else {
            showMsg('login-msg', data.message || 'Invalid credentials.', 'error');
            setLoading('login-submit', false, 'Login →');
        }
    } catch {
        showMsg('login-msg', 'Server error — is the server running?', 'error');
        setLoading('login-submit', false, 'Login →');
    }
});

// ── Sign Up ───────────────────────────────────────────────────────────────────
document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('signup-username').value.trim();
    const password = document.getElementById('signup-password').value.trim();

    if (!username || !password) {
        return showMsg('signup-msg', 'Please fill in both fields.', 'error');
    }
    if (password.length < 4) {
        return showMsg('signup-msg', 'Password must be at least 4 characters.', 'error');
    }

    setLoading('signup-submit', true, 'Create Account →');
    try {
        const res  = await fetch('/api/signup', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            showMsg('signup-msg', '✓ Account created! Switching to login…', 'success');
            document.getElementById('signup-username').value = '';
            document.getElementById('signup-password').value = '';
            // Pre-fill login fields
            document.getElementById('login-username').value = username;
            // Auto-switch to login tab after 1.2s
            setTimeout(() => {
                document.querySelector('[data-tab="login"]').click();
            }, 1200);
        } else {
            showMsg('signup-msg', data.message || 'Signup failed.', 'error');
        }
    } catch {
        showMsg('signup-msg', 'Server error — is the server running?', 'error');
    } finally {
        setLoading('signup-submit', false, 'Create Account →');
    }
});
