"use strict";

import { renderUI }     from './renderHtml.js';
import { getLegalMoves } from './movements.js';
import { getBestMove }   from './ai.js';

const socket = io({
    auth: {
        token: sessionStorage.getItem('chess-token')
    }
});
// ─── Online Multiplayer ──────────────────────────────────────────────────────
let currentRoomId = null;
let myPlayerColor = null;
// ─── Constants ────────────────────────────────────────────────────────────────
const BOARD_SIZE       = 8;
const FILE_OFFSET      = 97;          // 'a'.charCodeAt(0)
const CLOCK_START      = 600;         // 10 minutes in seconds
const AI_DELAY_MS      = 350;
const FIFTY_MOVE_LIMIT = 100;         // 50 full moves = 100 half-moves (plies)
const PIECE_ORDER      = ['rook','knight','bishop','queen','king','bishop','knight','rook'];

// ─── Square ───────────────────────────────────────────────────────────────────
class Square {
    constructor(id, color) {
        this.id    = id;
        this.color = color;
        this.piece = null;
    }
}

// ─── ChessGame ────────────────────────────────────────────────────────────────
class ChessGame {
    constructor() {
        // All state lives here; initBoard() sets/resets them
        this.mainMap          = [];
        this.selectedSquareId = null;
        this.activeValidMoves = [];
        this.gameMode         = sessionStorage.getItem('chess-mode') || 'pp';
        this.currentTurn      = 'white';
        this.isAiThinking     = false;
        this.gameOver         = false;
        this.enPassantTarget  = null;
        this.castlingRights   = this._freshCastlingRights();
        this.whiteTime        = CLOCK_START;
        this.blackTime        = CLOCK_START;
        this.clockInterval    = null;
        this.halfMoveClock    = 0;   // for 50-move rule
        this.positionHistory  = [];  // for threefold repetition
        this._pendingSAN      = null;
        this.moveHistory      = [];  // for undo: array of snapshots
        this.boardFlipped     = false;
        this.soundEnabled     = true;

        this.initBoard();
        this.render();
        this.setupClickHandlers();
        this.setupControlButtons();
        this._initSounds();

        this.updatePlayerCardsUI();

        this.gameStarted = false;
        if (this.gameMode === 'online') {
            const box = document.getElementById('turn-indicator');
            if (box) {
                box.innerText = '⏳ WAITING FOR BOTH PLAYERS TO CONNECT...';
                box.style.background = '#312e2b';
                box.style.color = '#e6b060';
            }
        } else if (this.gameMode === 'pp') {
            this.showStartGameOverlay();
        } else {
            this.gameStarted = true;
            this.startClockLoop();
        }
    }

    _freshCastlingRights() {
        return {
            white: { kingSide: true, queenSide: true },
            black: { kingSide: true, queenSide: true }
        };
    }

    updatePlayerCardsUI() {
        const whiteNameEl   = document.getElementById('white-player-name');
        const whitePlayedEl = document.getElementById('white-matches-played');
        const whiteWonEl    = document.getElementById('white-matches-won');

        const blackNameEl   = document.getElementById('black-player-name');
        const blackPlayedEl = document.getElementById('black-matches-played');
        const blackWonEl    = document.getElementById('black-matches-won');

        if (this.gameMode === 'online') {
            const rawWhite = sessionStorage.getItem('white-player');
            const rawBlack = sessionStorage.getItem('black-player');
            const whiteP   = rawWhite ? JSON.parse(rawWhite) : null;
            const blackP   = rawBlack ? JSON.parse(rawBlack) : null;

            if (whiteNameEl && whiteP)   whiteNameEl.textContent   = whiteP.username;
            if (whitePlayedEl && whiteP) whitePlayedEl.textContent = `Played: ${ (whiteP.wins || 0) + (whiteP.losses || 0) }`;
            if (whiteWonEl && whiteP)    whiteWonEl.textContent    = `Won: ${ whiteP.wins || 0 }`;

            if (blackNameEl && blackP)   blackNameEl.textContent   = blackP.username;
            if (blackPlayedEl && blackP) blackPlayedEl.textContent = `Played: ${ (blackP.wins || 0) + (blackP.losses || 0) }`;
            if (blackWonEl && blackP)    blackWonEl.textContent    = `Won: ${ blackP.wins || 0 }`;
        } else {
            // Offline modes
            const currentUsername = sessionStorage.getItem('chess-username') || 'WHITE';
            const userWins   = parseInt(sessionStorage.getItem('chess-wins') || '0', 10);
            const userLosses = parseInt(sessionStorage.getItem('chess-losses') || '0', 10);

            if (whiteNameEl)   whiteNameEl.textContent   = currentUsername;
            if (this.gameMode === 'pp') {
                if (whitePlayedEl) whitePlayedEl.style.display = 'none';
                if (whiteWonEl)    whiteWonEl.style.display = 'none';
                if (blackPlayedEl) blackPlayedEl.style.display = 'none';
                if (blackWonEl)    blackWonEl.style.display = 'none';
            } else {
                if (whitePlayedEl) { whitePlayedEl.style.display = ''; whitePlayedEl.textContent = `Played: ${userWins + userLosses}`; }
                if (whiteWonEl)    { whiteWonEl.style.display = '';    whiteWonEl.textContent    = `Won: ${userWins}`; }
                if (blackPlayedEl) { blackPlayedEl.style.display = ''; blackPlayedEl.textContent = 'Played: 0'; }
                if (blackWonEl)    { blackWonEl.style.display = '';    blackWonEl.textContent    = 'Won: 0'; }
            }

            if (blackNameEl) {
                blackNameEl.textContent = this.gameMode.startsWith('ai') ? 'BOT (AI)' : 'PLAYER 2';
            }
        }
    }

    // ── Board initialisation ──────────────────────────────────────────────────
    initBoard() {
        this.mainMap          = [];
        this.currentTurn      = 'white';
        this.isAiThinking     = false;
        this.gameOver         = false;
        this.selectedSquareId = null;
        this.activeValidMoves = [];
        this.enPassantTarget  = null;
        this.castlingRights   = this._freshCastlingRights();
        this.whiteTime        = CLOCK_START;
        this.blackTime        = CLOCK_START;
        this.halfMoveClock    = 0;
        this.positionHistory  = [];
        this.moveHistory      = [];
        this._pendingSAN      = null;

        const logContainer = document.getElementById('move-list');
        if (logContainer) logContainer.innerHTML = '';
        this.updateClockUI();

        for (let rank = BOARD_SIZE; rank > 0; rank--) {
            const row = [];
            for (let fi = 0; fi < BOARD_SIZE; fi++) {
                const file  = String.fromCharCode(FILE_OFFSET + fi);
                const id    = file + rank;
                const color = (rank + fi) % 2 === 0 ? 'dark' : 'light';
                const sq    = new Square(id, color);

                if      (rank === 8) sq.piece = { type: PIECE_ORDER[fi], color: 'black' };
                else if (rank === 7) sq.piece = { type: 'pawn',          color: 'black' };
                else if (rank === 2) sq.piece = { type: 'pawn',          color: 'white' };
                else if (rank === 1) sq.piece = { type: PIECE_ORDER[fi], color: 'white' };

                row.push(sq);
            }
            this.mainMap.push(row);
        }
    }

    // ── UI Overlays ───────────────────────────────────────────────────────────
    showStartGameOverlay() {
        this.gameStarted = false;
        clearInterval(this.clockInterval);
        
        const overlay = document.createElement('div');
        overlay.id = 'start-game-overlay';
        overlay.style.cssText = `
            position:absolute;inset:0;background:rgba(0,0,0,0.6);
            display:flex;align-items:center;justify-content:center;z-index:100;
            border-radius:6px;
        `;
        
        const btn = document.createElement('button');
        btn.textContent = '▶ Begin Game';
        btn.style.cssText = `
            background:#769656;color:#fff;border:none;border-radius:8px;
            padding:16px 32px;font-size:1.2rem;cursor:pointer;font-weight:bold;
            box-shadow:0 4px 15px rgba(0,0,0,0.5);transition:background 0.2s;
        `;
        btn.onmouseenter = () => btn.style.background = '#86a863';
        btn.onmouseleave = () => btn.style.background = '#769656';
        
        btn.addEventListener('click', () => {
            overlay.remove();
            this.gameStarted = true;
            this.startClockLoop();
        });
        
        overlay.appendChild(btn);
        
        const container = document.querySelector('.main-container');
        if (container) {
            container.style.position = 'relative';
            container.appendChild(overlay);
        }
    }

    showResignModal() {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position:fixed;inset:0;background:rgba(0,0,0,0.75);
            display:flex;align-items:center;justify-content:center;z-index:999;
        `;
        
        const box = document.createElement('div');
        box.style.cssText = `
            background:#262522;border-radius:12px;padding:28px 32px;
            display:flex;gap:16px;flex-direction:column;align-items:center;
            border:1px solid rgba(255,255,255,0.1);
            box-shadow:0 20px 50px rgba(0,0,0,0.7);
        `;
        
        const title = document.createElement('p');
        title.innerText = `${this.currentTurn.toUpperCase()} resigns. Continue?`;
        title.style.cssText = 'margin:0 0 16px;color:#bababa;font-weight:600;font-size:1.1rem;';
        box.appendChild(title);
        
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:16px;';
        
        const btnResign = document.createElement('button');
        btnResign.innerText = 'Resign';
        btnResign.style.cssText = `
            background:#b53737;color:#fff;border:none;border-radius:6px;
            padding:10px 20px;font-size:1rem;cursor:pointer;font-weight:bold;
        `;
        btnResign.onmouseenter = () => btnResign.style.background = '#c93f3f';
        btnResign.onmouseleave = () => btnResign.style.background = '#b53737';
        
        const btnCancel = document.createElement('button');
        btnCancel.innerText = 'Cancel';
        btnCancel.style.cssText = `
            background:#444;color:#fff;border:none;border-radius:6px;
            padding:10px 20px;font-size:1rem;cursor:pointer;font-weight:bold;
        `;
        btnCancel.onmouseenter = () => btnCancel.style.background = '#555';
        btnCancel.onmouseleave = () => btnCancel.style.background = '#444';
        
        btnResign.addEventListener('click', () => {
            overlay.remove();
            const winner = this.currentTurn === 'white' ? 'BLACK' : 'WHITE';
            this._endGame(`🏳️ ${this.currentTurn.toUpperCase()} RESIGNED — ${winner} WINS!`, '#555');
            if (this.gameMode === 'online' && typeof socket !== 'undefined' && typeof currentRoomId !== 'undefined') {
                socket.emit('game-over', { roomId: currentRoomId, winner: winner.toLowerCase() });
            }
        });
        
        btnCancel.addEventListener('click', () => {
            overlay.remove();
        });
        
        row.appendChild(btnCancel);
        row.appendChild(btnResign);
        box.appendChild(row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    // ── Rendering ─────────────────────────────────────────────────────────────
    render() {
        renderUI(this.mainMap);
        this.updateStatusDisplay();
    }

    // ── King safety ───────────────────────────────────────────────────────────
    findKingSquare(color, map) {
        for (const row of map)
            for (const sq of row)
                if (sq.piece?.type === 'king' && sq.piece.color === color) return sq.id;
        return null;
    }

    isKingUnderAttack(color, map) {
        const kingId = this.findKingSquare(color, map);
        if (!kingId) return false;
        const enemy = color === 'white' ? 'black' : 'white';
        for (const row of map)
            for (const sq of row)
                if (sq.piece?.color === enemy && getLegalMoves(sq, map, this.getGameState()).includes(kingId))
                    return true;
        return false;
    }

    // ── Strict legal moves (filters moves that leave own king in check) ────────
    getStrictLegalMoves(square, map) {
        if (!square?.piece) return [];
        return getLegalMoves(square, map, this.getGameState()).filter(toId => {
            const sandbox = this.cloneMap(map);
            this.applyMoveToMap(sandbox, square.id, toId);
            return !this.isKingUnderAttack(square.piece.color, sandbox);
        });
    }

    // Extends strict legal moves: castling also requires king not in check
    // and not passing through an attacked square
    getStrictLegalMovesWithCastleCheck(square, map) {
        const base = this.getStrictLegalMoves(square, map);
        if (square.piece?.type !== 'king') return base;

        return base.filter(toId => {
            const srcCol = square.id.charCodeAt(0) - FILE_OFFSET;
            const dstCol = toId.charCodeAt(0)      - FILE_OFFSET;
            if (Math.abs(dstCol - srcCol) !== 2) return true; // not a castle move

            // King must not currently be in check
            if (this.isKingUnderAttack(square.piece.color, map)) return false;

            // King must not pass through an attacked square
            const rankRow = square.piece.color === 'white' ? 7 : 0;
            const passCol = srcCol + Math.sign(dstCol - srcCol);
            const sandbox = this.cloneMap(map);
            sandbox[rankRow][srcCol].piece  = null;
            sandbox[rankRow][passCol].piece = { type: 'king', color: square.piece.color };
            return !this.isKingUnderAttack(square.piece.color, sandbox);
        });
    }

    // ── Game-state snapshot (passed to move generators) ───────────────────────
    getGameState() {
        return { enPassantTarget: this.enPassantTarget, castlingRights: this.castlingRights };
    }

    // ── Board clone & move application (used for look-ahead / validation) ─────
    cloneMap(map) {
        return map.map(row => row.map(sq => ({ ...sq, piece: sq.piece ? { ...sq.piece } : null })));
    }

    applyMoveToMap(map, fromId, toId) {
        let src = null, dst = null;
        let srcRow = -1, srcCol = -1, dstRow = -1, dstCol = -1;

        for (let r = 0; r < BOARD_SIZE; r++)
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (map[r][c].id === fromId) { src = map[r][c]; srcRow = r; srcCol = c; }
                if (map[r][c].id === toId)   { dst = map[r][c]; dstRow = r; dstCol = c; }
            }

        if (!src?.piece || !dst) return;
        const isCapture = !!dst.piece;
        dst.piece = { ...src.piece };
        src.piece = null;

        // En-passant: pawn moved diagonally onto an empty square → remove captured pawn
        if (dst.piece.type === 'pawn' && srcCol !== dstCol && !isCapture) {
            map[srcRow][dstCol].piece = null;
        }
        // Promotion preview → queen (validation purposes only)
        if (dst.piece.type === 'pawn' && (dstRow === 0 || dstRow === BOARD_SIZE - 1)) {
            dst.piece.type = 'queen';
        }
        // Castling: relocate rook alongside king
        if (dst.piece.type === 'king' && Math.abs(dstCol - srcCol) === 2) {
            const color = dst.piece.color;
            if (dstCol === 6) { map[dstRow][5].piece = { type: 'rook', color }; map[dstRow][7].piece = null; }
            if (dstCol === 2) { map[dstRow][3].piece = { type: 'rook', color }; map[dstRow][0].piece = null; }
        }
    }

    // ── Position key for repetition detection ─────────────────────────────────
    _positionKey() {
        let key = this.currentTurn[0];
        for (const row of this.mainMap)
            for (const sq of row)
                key += sq.piece ? `${sq.id}${sq.piece.color[0]}${sq.piece.type[0]}` : '-';
        const cr = this.castlingRights;
        key += `${+cr.white.kingSide}${+cr.white.queenSide}${+cr.black.kingSide}${+cr.black.queenSide}`;
        key += this.enPassantTarget ?? '-';
        return key;
    }

    // ── Draw condition checks ──────────────────────────────────────────────────
    _checkDrawConditions() {
        // 50-move rule (100 half-moves)
        if (this.halfMoveClock >= FIFTY_MOVE_LIMIT) return '50-move rule';

        // Threefold repetition
        const key   = this._positionKey();
        const count = this.positionHistory.filter(k => k === key).length;
        if (count >= 3) return 'Threefold repetition';

        // Insufficient material: K vs K, K+B vs K, K+N vs K
        const pieces = [];
        for (const row of this.mainMap)
            for (const sq of row)
                if (sq.piece) pieces.push(sq.piece);

        if (pieces.length === 2) return 'Insufficient material'; // K vs K
        if (pieces.length === 3) {
            const minor = pieces.find(p => p.type === 'bishop' || p.type === 'knight');
            if (minor) return 'Insufficient material';
        }

        return null;
    }

    // ── Game-over check (called after each move) ───────────────────────────────
    evaluateGameState() {
        // Check draw conditions first
        const drawReason = this._checkDrawConditions();
        if (drawReason) {
            this._endGame(`🤝 DRAW! (${drawReason})`, '#444');
            return true;
        }

        // Count all legal moves for the side to move
        let legalCount = 0;
        for (const row of this.mainMap)
            for (const sq of row)
                if (sq.piece?.color === this.currentTurn)
                    legalCount += this.getStrictLegalMovesWithCastleCheck(sq, this.mainMap).length;

        if (legalCount > 0) return false;

        // No legal moves → checkmate or stalemate
        if (this.isKingUnderAttack(this.currentTurn, this.mainMap)) {
            const victor = this.currentTurn === 'white' ? 'BLACK' : 'WHITE';
            this._endGame(`💥 CHECKMATE! ${victor} WINS!`, '#800000');
        } else {
            this._endGame('🤝 STALEMATE – DRAW!', '#444');
        }
        return true;
    }

    _endGame(message, bgColor) {
        clearInterval(this.clockInterval);
        this.isAiThinking = true;
        this.gameOver     = true;
        const box = document.getElementById('turn-indicator');
        if (!box) return;
        box.innerText        = message;
        box.style.background = bgColor;
        box.style.color      = '#fff';
        this.showNewGameButton();

        // Let the server know the game ended (for DB stats)
        if (this.gameMode === 'online' && typeof socket !== 'undefined' && typeof currentRoomId !== 'undefined') {
            let winner = null;
            if (message.includes('WHITE WINS')) winner = 'white';
            else if (message.includes('BLACK WINS')) winner = 'black';
            else if (message.includes('DRAW')) winner = 'draw';
            
            if (winner) {
                socket.emit('game-over', { roomId: currentRoomId, winner });
            }
        }
    }

    showNewGameButton() {
        if (document.getElementById('new-game-btn')) return;
        const btn         = document.createElement('button');
        btn.id            = 'new-game-btn';
        btn.className     = 'mode-btn active';
        btn.style.cssText = 'margin-top:10px;width:100%;padding:14px;font-size:1rem;';
        btn.innerText     = '🔄 New Game';
        btn.addEventListener('click', () => {
            btn.remove();
            this.initBoard();
            this.render();
            this.startClockLoop();
        });
        document.querySelector('.dashboard-panel')?.appendChild(btn);
    }

    updateStatusDisplay() {
        const box = document.getElementById('turn-indicator');
        if (!box || this.gameOver) return;

        if (this.isKingUnderAttack(this.currentTurn, this.mainMap)) {
            box.style.background = '#b53737';
            box.style.color      = '#fff';
            box.innerText        = `⚠️ ${this.currentTurn.toUpperCase()} IS IN CHECK!`;
        } else {
            box.style.background = '#312e2b';
            box.style.color      = '#bababa';
            const modeLabel      = this.gameMode === 'pp' ? '' : ` [${this.gameMode.toUpperCase()}]`;
            box.innerText        = `TURN: ${this.currentTurn.toUpperCase()}${modeLabel}`;
        }
    }

    // ── Clocks ────────────────────────────────────────────────────────────────
    startClockLoop() {
        clearInterval(this.clockInterval);
        this.clockInterval = setInterval(() => {
            if (this.gameOver) return;
            if (this.currentTurn === 'white') {
                if (--this.whiteTime <= 0) this.handleTimeoutWin('black');
            } else {
                if (--this.blackTime <= 0) this.handleTimeoutWin('white');
            }
            this.updateClockUI();
        }, 1000);
    }

    updateClockUI() {
        const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        const wEl = document.getElementById('white-clock');
        const bEl = document.getElementById('black-clock');
        if (wEl) wEl.innerText = fmt(this.whiteTime);
        if (bEl) bEl.innerText = fmt(this.blackTime);
    }

    handleTimeoutWin(winner) {
        this._endGame(`⏳ ${winner.toUpperCase()} WINS ON TIME!`, '#769656');
    }

    // ── SAN (Standard Algebraic Notation) ────────────────────────────────────
    toSAN(fromId, toId, piece, promotedTo, wasCapture, wasCastle, epCapture, boardBeforeMove) {
        const toCol = toId.charCodeAt(0) - FILE_OFFSET;
        if (wasCastle) return toCol === 6 ? 'O-O' : 'O-O-O';

        const LETTER = { pawn: '', knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K' };
        let disambiguation = '';

        // Check if another identical piece can reach the same square (disambiguation)
        if (piece.type !== 'pawn' && piece.type !== 'king') {
            const rivals = [];
            for (const row of boardBeforeMove)
                for (const sq of row)
                    if (sq.id !== fromId && sq.piece?.type === piece.type && sq.piece.color === piece.color)
                        if (this.getStrictLegalMoves(sq, boardBeforeMove).includes(toId))
                            rivals.push(sq.id);

            if (rivals.length > 0) {
                const fromFile = fromId[0], fromRank = fromId[1];
                const sameFile = rivals.some(r => r[0] === fromFile);
                const sameRank = rivals.some(r => r[1] === fromRank);
                disambiguation = !sameFile ? fromFile : !sameRank ? fromRank : fromId;
            }
        }

        let captureStr = '';
        if (wasCapture || epCapture) {
            captureStr = 'x';
            if (piece.type === 'pawn') disambiguation = fromId[0];
        }

        const PROMO    = { queen: 'Q', rook: 'R', bishop: 'B', knight: 'N' };
        const promoStr = promotedTo ? `=${PROMO[promotedTo]}` : '';
        let san        = `${LETTER[piece.type]}${disambiguation}${captureStr}${toId}${promoStr}`;

        // Append + (check) or # (checkmate)
        const opponent = piece.color === 'white' ? 'black' : 'white';
        if (this.isKingUnderAttack(opponent, this.mainMap)) {
            let opMoves = 0;
            for (const row of this.mainMap)
                for (const sq of row)
                    if (sq.piece?.color === opponent)
                        opMoves += this.getStrictLegalMovesWithCastleCheck(sq, this.mainMap).length;
            san += opMoves === 0 ? '#' : '+';
        }
        return san;
    }

    // ── Move log ──────────────────────────────────────────────────────────────
    appendMoveLog(fromId, toId, pieceInfo, promotedTo, wasCapture, wasCastle, epCapture, boardBeforeMove) {
        const list = document.getElementById('move-list');
        if (!list) return;

        const san     = this.toSAN(fromId, toId, pieceInfo, promotedTo, wasCapture, wasCastle, epCapture, boardBeforeMove);
        const isWhite = pieceInfo.color === 'white';

        if (isWhite) {
            const moveNumber  = list.children.length + 1;
            const div         = document.createElement('div');
            div.className     = 'move-line';
            div.innerHTML     =
                `<span class="move-num">${moveNumber}.</span>` +
                `<span class="move-white san-token">${san}</span>` +
                `<span class="move-black san-token"></span>`;
            list.appendChild(div);
        } else {
            const last = list.lastElementChild;
            if (last) {
                const blackSpan = last.querySelector('.move-black');
                if (blackSpan) blackSpan.textContent = san;
            }
        }
        list.scrollTop = list.scrollHeight;
    }

    // ── Mode selector (no-op – mode is chosen on /mode.html) ─────────────────
    // Kept as a named method so any future call is safe.
    setupModeSelector() {
        // Mode is pre-selected via sessionStorage by mode.html.
        // The #mode-select dropdown is not present in game.html.
    }

    // ── Click handler ─────────────────────────────────────────────────────────
    setupClickHandlers() {
        document.querySelector('.main-container')?.addEventListener('click', e => {
            if (this.isAiThinking || this.gameOver || !this.gameStarted) return;
            const el = e.target.closest('.square-common');
            if (el) this.handleSquareClick(el.id);
        });
    }

    handleSquareClick(squareId) {
        if (this.gameMode.startsWith('ai') && this.currentTurn === 'black') return;
        if (this.gameMode === 'online' && this.currentTurn !== myPlayerColor) return;

        const clicked = this.getSquareById(squareId);
        if (!clicked) return;

        // If a valid destination is clicked, execute the move
        if (this.activeValidMoves.includes(squareId) && this.selectedSquareId) {
            this.executeMoveData(this.selectedSquareId, squareId);
            return;
        }

        this.clearVisualIndicators();

        // Select a piece belonging to the current player
        if (clicked.piece?.color === this.currentTurn) {
            this.selectedSquareId = squareId;
            document.getElementById(squareId)?.classList.add('highlight');

            this.activeValidMoves = this.getStrictLegalMovesWithCastleCheck(clicked, this.mainMap);
            const srcCol = squareId.charCodeAt(0) - FILE_OFFSET;

            this.activeValidMoves.forEach(moveId => {
                const tData  = this.getSquareById(moveId);
                const tEl    = document.getElementById(moveId);
                if (!tData || !tEl) return;

                const dstCol   = moveId.charCodeAt(0) - FILE_OFFSET;
                const isCastle = clicked.piece.type === 'king' && Math.abs(dstCol - srcCol) === 2;
                const isEP     = clicked.piece.type === 'pawn' && moveId === this.enPassantTarget && !tData.piece;

                if (tData.piece || isEP) {
                    const ring = document.createElement('div');
                    ring.classList.add('capture-ring');
                    tEl.appendChild(ring);
                } else if (isCastle) {
                    const indicator = document.createElement('div');
                    indicator.classList.add('castle-indicator');
                    tEl.appendChild(indicator);
                } else {
                    const dot = document.createElement('div');
                    dot.classList.add('circle');
                    tEl.appendChild(dot);
                }
            });
        } else {
            this.selectedSquareId = null;
            this.activeValidMoves = [];
        }
    }

    // ── Execute move ──────────────────────────────────────────────────────────
    executeMoveData(fromId, toId, promotionPiece = null) {
        const srcSq  = this.getSquareById(fromId);
        const destSq = this.getSquareById(toId);
        if (!srcSq?.piece || !destSq) return;

        const piece = { ...srcSq.piece };

        let srcRow = -1, srcCol = -1, dstRow = -1, dstCol = -1;
        for (let r = 0; r < BOARD_SIZE; r++)
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (this.mainMap[r][c].id === fromId) { srcRow = r; srcCol = c; }
                if (this.mainMap[r][c].id === toId)   { dstRow = r; dstCol = c; }
            }

        const boardBeforeMove    = this.cloneMap(this.mainMap);
        const wasCapture         = !!destSq.piece;
        const isCastle           = piece.type === 'king' && Math.abs(dstCol - srcCol) === 2;
        const isEnPassant        = piece.type === 'pawn' && toId === this.enPassantTarget && srcCol !== dstCol;
        const epCaptureId        = isEnPassant ? this.mainMap[srcRow][dstCol].id : null;

        // Save full snapshot for undo before any mutation
        this.moveHistory.push({
            mainMap:         this.cloneMap(this.mainMap),
            currentTurn:     this.currentTurn,
            enPassantTarget: this.enPassantTarget,
            castlingRights:  JSON.parse(JSON.stringify(this.castlingRights)),
            halfMoveClock:   this.halfMoveClock,
            positionHistory: [...this.positionHistory],
            whiteTime:       this.whiteTime,
            blackTime:       this.blackTime,
            moveLogHTML:     document.getElementById('move-list')?.innerHTML ?? '',
        });

        // Remove captured pawn for en passant
        if (isEnPassant) this.mainMap[srcRow][dstCol].piece = null;

        // Update 50-move clock (resets on pawn move or capture)
        if (piece.type === 'pawn' || wasCapture || isEnPassant) {
            this.halfMoveClock = 0;
        } else {
            this.halfMoveClock++;
        }

        // Update en-passant target square for next turn
        this.enPassantTarget = (piece.type === 'pawn' && Math.abs(dstRow - srcRow) === 2)
            ? this.mainMap[(srcRow + dstRow) / 2][dstCol].id
            : null;

        // Update castling rights when king or rook moves, or rook is captured
        if (piece.type === 'king') {
            this.castlingRights[piece.color].kingSide  = false;
            this.castlingRights[piece.color].queenSide = false;
        }
        if (piece.type === 'rook') {
            if (srcCol === 7 && srcRow === 7) this.castlingRights.white.kingSide  = false;
            if (srcCol === 0 && srcRow === 7) this.castlingRights.white.queenSide = false;
            if (srcCol === 7 && srcRow === 0) this.castlingRights.black.kingSide  = false;
            if (srcCol === 0 && srcRow === 0) this.castlingRights.black.queenSide = false;
        }
        // If a rook is captured, revoke castling rights
        if (wasCapture) {
            if (dstCol === 7 && dstRow === 7) this.castlingRights.white.kingSide  = false;
            if (dstCol === 0 && dstRow === 7) this.castlingRights.white.queenSide = false;
            if (dstCol === 7 && dstRow === 0) this.castlingRights.black.kingSide  = false;
            if (dstCol === 0 && dstRow === 0) this.castlingRights.black.queenSide = false;
        }

        // Castling: move rook to the other side of the king
        if (isCastle) {
            const color = piece.color;
            if (dstCol === 6) { this.mainMap[dstRow][5].piece = { type: 'rook', color }; this.mainMap[dstRow][7].piece = null; }
            else              { this.mainMap[dstRow][3].piece = { type: 'rook', color }; this.mainMap[dstRow][0].piece = null; }
        }

        // Commit the move
        destSq.piece = piece;
        srcSq.piece  = null;

        // Record position for repetition detection
        this.positionHistory.push(this._positionKey());

        // Pawn promotion
        const isPromotion = piece.type === 'pawn' && (dstRow === 0 || dstRow === BOARD_SIZE - 1);
        if (isPromotion) {
            if (promotionPiece) {
                destSq.piece.type = promotionPiece;
                this._finalizeMove(fromId, toId, piece, promotionPiece, wasCapture || isEnPassant, isCastle, epCaptureId, boardBeforeMove);
            } else if (this.gameMode === 'pp' || this.gameMode === 'online' || piece.color === 'white') {
                // Human player — show piece picker
                this.clearVisualIndicators();
                this.render();
                this._pendingSAN = { fromId, toId, piece: { ...piece }, wasCapture: wasCapture || isEnPassant, isCastle, epCaptureId, boardBeforeMove };
                this.showPromotionModal(piece.color, fromId, toId);
            } else {
                // AI always promotes to queen
                destSq.piece.type = 'queen';
                this._finalizeMove(fromId, toId, piece, 'queen', wasCapture || isEnPassant, isCastle, epCaptureId, boardBeforeMove);
            }
            return;
        }

        this._finalizeMove(fromId, toId, piece, null, wasCapture || isEnPassant, isCastle, epCaptureId, boardBeforeMove);
    }

    _finalizeMove(fromId, toId, piece, promotedTo, wasCapture, wasCastle, epCaptureId, boardBeforeMove) {
        if (this.gameMode === 'online' && !this.isRemoteMove) {
            socket.emit('make-move', { roomId: currentRoomId, moveData: { fromId, toId, promotionPiece: promotedTo } });
        }
        this.appendMoveLog(fromId, toId, piece, promotedTo, wasCapture, wasCastle, epCaptureId, boardBeforeMove);
        this.clearVisualIndicators();
        this.selectedSquareId = null;
        this.activeValidMoves = [];
        this.currentTurn      = this.currentTurn === 'white' ? 'black' : 'white';
        this.render();
        // Play move/capture sound
        if (wasCapture || epCaptureId) this._playSound('capture');
        else if (wasCastle)            this._playSound('castle');
        else                           this._playSound('move');
        // Check sound (after render so board state is updated)
        if (this.isKingUnderAttack(this.currentTurn, this.mainMap)) this._playSound('check');
        if (this.evaluateGameState()) return;
        this.triggerAiIfNeeded();
    }

    // ── Promotion modal ───────────────────────────────────────────────────────
    showPromotionModal(color, fromId, toId) {
        const overlay    = document.createElement('div');
        overlay.id       = 'promo-overlay';
        overlay.style.cssText = `
            position:fixed;inset:0;background:rgba(0,0,0,0.75);
            display:flex;align-items:center;justify-content:center;z-index:999;
        `;

        const box = document.createElement('div');
        box.style.cssText = `
            background:#262522;border-radius:12px;padding:28px 32px;
            display:flex;gap:16px;flex-direction:column;align-items:center;
            border:1px solid rgba(255,255,255,0.1);
            box-shadow:0 20px 50px rgba(0,0,0,0.7);
        `;

        const title       = document.createElement('p');
        title.innerText   = 'Choose promotion piece';
        title.style.cssText = 'margin:0 0 8px;color:#bababa;font-weight:600;font-size:0.95rem;letter-spacing:0.5px;';
        box.appendChild(title);

        const row         = document.createElement('div');
        row.style.cssText = 'display:flex;gap:12px;';

        ['queen','rook','bishop','knight'].forEach(type => {
            const btn = document.createElement('button');
            btn.style.cssText = `
                background:#1e1d1a;border:2px solid #383734;border-radius:8px;
                cursor:pointer;padding:10px;width:72px;height:72px;
                display:flex;align-items:center;justify-content:center;
                transition:border-color 0.2s,background 0.2s;
            `;
            btn.onmouseenter = () => { btn.style.borderColor = '#769656'; btn.style.background = '#2a2927'; };
            btn.onmouseleave = () => { btn.style.borderColor = '#383734'; btn.style.background = '#1e1d1a'; };

            const img         = document.createElement('img');
            img.src           = `./images/pieces/${color}/${type}.png`;
            img.style.cssText = 'width:42px;height:42px;pointer-events:none;';
            btn.appendChild(img);

            btn.addEventListener('click', () => {
                overlay.remove();
                const destSq = this.getSquareById(toId);
                if (destSq?.piece) destSq.piece.type = type;
                const ctx = this._pendingSAN ?? {};
                this._finalizeMove(
                    fromId, toId, destSq?.piece ?? { type, color },
                    type,
                    ctx.wasCapture      ?? false,
                    ctx.isCastle        ?? false,
                    ctx.epCaptureId     ?? null,
                    ctx.boardBeforeMove ?? this.cloneMap(this.mainMap)
                );
                this._pendingSAN = null;
            });
            row.appendChild(btn);
        });

        box.appendChild(row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    }

    // ── AI trigger ────────────────────────────────────────────────────────────
    triggerAiIfNeeded() {
        if (!this.gameMode.startsWith('ai') || this.currentTurn !== 'black' || this.gameOver) return;

        this.isAiThinking = true;
        const level       = parseInt(this.gameMode.replace('ai', ''), 10);
        const box         = document.getElementById('turn-indicator');
        if (box) { box.innerText = level === 4 ? '🤖 AI thinking hard… (Lvl 4)' : '🤖 AI is thinking…'; box.classList.add('ai-thinking'); }

        // Use setTimeout(0) so the browser can paint the board/clock before AI blocks the thread.
        // For level 4 the computation takes a moment — the clock keeps ticking via the interval.
        setTimeout(() => {
            const worker = new Worker('./aiWorker.js', { type: 'module' });
            worker.postMessage({
                mainMap: this.mainMap,
                color: 'black',
                level: level,
                gameState: this.getGameState()
            });

            worker.onmessage = (e) => {
                const aiMove = e.data;
                if (aiMove) this.executeMoveData(aiMove.from, aiMove.to);
                document.getElementById('turn-indicator')?.classList.remove('ai-thinking');
                this.isAiThinking = false;
                worker.terminate();
            };

            worker.onerror = (err) => {
                console.error("AI Worker Error:", err);
                this.isAiThinking = false;
                worker.terminate();
            };
        }, AI_DELAY_MS);
    }

    // ── Utilities ─────────────────────────────────────────────────────────────
    getSquareById(id) {
        for (const row of this.mainMap)
            for (const sq of row)
                if (sq.id === id) return sq;
        return null;
    }

    // ── Control buttons ───────────────────────────────────────────────────────
    setupControlButtons() {
        // New Game
        document.getElementById('btn-new')?.addEventListener('click', () => {
            if (this.gameOver || confirm('Start a new game?')) {
                document.getElementById('new-game-btn')?.remove();
                document.getElementById('start-game-overlay')?.remove();
                this.initBoard();
                this.render();
                if (this.gameMode === 'pp') {
                    this.showStartGameOverlay();
                } else {
                    this.gameStarted = true;
                    this.startClockLoop();
                }
            }
        });

        // Undo
        document.getElementById('btn-undo')?.addEventListener('click', () => this.undoMove());

        // Flip board
        document.getElementById('btn-flip')?.addEventListener('click', () => {
            this.boardFlipped = !this.boardFlipped;
            const board = document.querySelector('.main-container');
            if (board) board.classList.toggle('flipped', this.boardFlipped);
        });

        // Sound toggle
        const soundBtn = document.getElementById('btn-sound');
        soundBtn?.addEventListener('click', () => {
            this.soundEnabled = !this.soundEnabled;
            soundBtn.classList.toggle('sound-off', !this.soundEnabled);
            soundBtn.title = this.soundEnabled ? 'Toggle Sound' : 'Sound Off';
        });

        // Resign
        document.getElementById('btn-resign')?.addEventListener('click', () => {
            if (this.gameOver || !this.gameStarted) return;
            this.showResignModal();
        });
    }

    // ── Undo move ─────────────────────────────────────────────────────────────
    undoMove() {
        if (!this.moveHistory.length) return;
        // In AI mode, pop two plies (AI + human) so it's always the human's turn
        const pops = (this.gameMode.startsWith('ai') && this.moveHistory.length >= 2) ? 2 : 1;
        let snap;
        for (let i = 0; i < pops; i++) snap = this.moveHistory.pop();
        if (!snap) return;

        this.mainMap         = snap.mainMap;
        this.currentTurn     = snap.currentTurn;
        this.enPassantTarget = snap.enPassantTarget;
        this.castlingRights  = snap.castlingRights;
        this.halfMoveClock   = snap.halfMoveClock;
        this.positionHistory = snap.positionHistory;
        this.whiteTime       = snap.whiteTime;
        this.blackTime       = snap.blackTime;

        const list = document.getElementById('move-list');
        if (list) list.innerHTML = snap.moveLogHTML;

        this.gameOver         = false;
        this.isAiThinking     = false;
        this.selectedSquareId = null;
        this.activeValidMoves = [];
        document.getElementById('new-game-btn')?.remove();

        this.clearVisualIndicators();
        this.render();
        this.updateClockUI();
        this._playSound('move');
    }

    // ── Sound engine (Web Audio API — no files needed) ────────────────────────
    _initSounds() {
        try { this._audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch { this._audioCtx = null; }
    }

    _playSound(type) {
        if (!this.soundEnabled || !this._audioCtx) return;
        const ctx = this._audioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;
        if (type === 'move') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.exponentialRampToValueAtTime(520, now + 0.08);
            gain.gain.setValueAtTime(0.18, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
            osc.start(now); osc.stop(now + 0.18);
        } else if (type === 'capture') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(120, now + 0.15);
            gain.gain.setValueAtTime(0.22, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
            osc.start(now); osc.stop(now + 0.22);
        } else if (type === 'castle') {
            // Two-tone castle sound
            osc.type = 'sine';
            osc.frequency.setValueAtTime(392, now);
            osc.frequency.setValueAtTime(523, now + 0.1);
            gain.gain.setValueAtTime(0.18, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
            osc.start(now); osc.stop(now + 0.28);
        } else if (type === 'check') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(660, now + 0.05);
            gain.gain.setValueAtTime(0.12, now + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            osc.start(now + 0.05); osc.stop(now + 0.3);
        }
    }

    clearVisualIndicators() {
        document.querySelectorAll('.square-common').forEach(el => {
            el.classList.remove('highlight');
            el.querySelector('.circle')?.remove();
            el.querySelector('.capture-ring')?.remove();
            el.querySelector('.castle-indicator')?.remove();
        });
    }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
// Auth guard: redirect to login page if no token found
if (!sessionStorage.getItem('chess-token')) {
    location.href = '/';
}

// Populate game page header BEFORE initializing game
(function initGameHeader() {
    const username = sessionStorage.getItem('chess-username') || '?';
    const elo      = sessionStorage.getItem('chess-elo')      || '—';
    const mode     = sessionStorage.getItem('chess-mode')   || 'pp';

    const avatarEl   = document.getElementById('game-avatar');
    const usernameEl = document.getElementById('game-username');
    const eloEl      = document.getElementById('game-elo');
    const modeLabelEl= document.getElementById('mode-label');

    if (avatarEl)    avatarEl.textContent    = username.charAt(0).toUpperCase();
    if (usernameEl)  usernameEl.textContent  = username;
    if (eloEl)       eloEl.textContent       = `ELO: ${elo}`;

    const modeNames = {
        pp:     '🤝 Pass & Play',
        ai1:    '🤖 AI — Level 1',
        ai2:    '🤖 AI — Level 2',
        ai3:    '🧠 AI — Level 3',
        ai4:    '👾 AI — Level 4',
        online: '🌐 Online Multiplayer'
    };
    if (modeLabelEl) modeLabelEl.textContent = modeNames[mode] || mode;

    // Logout
    document.getElementById('game-logout-btn')?.addEventListener('click', () => {
        sessionStorage.removeItem('chess-token');
        sessionStorage.removeItem('chess-username');
        sessionStorage.removeItem('chess-elo');
        sessionStorage.removeItem('chess-mode');
        location.href = '/';
    });
})();

const game = new ChessGame();

// ── Socket Events ─────────────────────────────────────────────────────────────
const gameMode = sessionStorage.getItem('chess-mode') || 'pp';
const onlineRoomId = sessionStorage.getItem('online-room-id');
const username = sessionStorage.getItem('chess-username') || 'Player';

if (gameMode === 'online') {
    if (onlineRoomId) {
        currentRoomId = onlineRoomId;
        socket.emit('rejoin-game', { roomId: onlineRoomId, username });
    } else {
        // Direct nav to online mode without room code
        setTimeout(() => { location.href = '/online.html'; }, 1000);
    }
}

socket.on('player-color', (color) => {
    myPlayerColor = color;
    if (color === 'black') {
        game.boardFlipped = true;
        const board = document.querySelector('.main-container');
        if (board) board.classList.add('flipped');
    }
});

socket.on('room-details', (details) => {
    if (details.whitePlayer) sessionStorage.setItem('white-player', JSON.stringify(details.whitePlayer));
    if (details.blackPlayer) sessionStorage.setItem('black-player', JSON.stringify(details.blackPlayer));
    game.updatePlayerCardsUI();
});

socket.on('player-waiting', (msg) => {
    const box = document.getElementById('turn-indicator');
    if (box) {
        box.innerText = '⏳ WAITING FOR OPPONENT TO ENTER BOARD...';
        box.style.background = '#312e2b';
        box.style.color = '#e6b060';
    }
});

socket.on('room-not-found', (msg) => {
    const box = document.getElementById('turn-indicator');
    if (box) {
        box.innerText = `❌ ${msg} Redirecting to room lobby...`;
        box.style.background = '#b53737';
        box.style.color = '#fff';
    }
    setTimeout(() => {
        location.href = '/online.html';
    }, 2000);
});

socket.on('sync-board', (moves) => {
    game.initBoard();
    game.isRemoteMove = true;
    for (const m of moves) {
        let promo = null;
        if (m.promotionPiece) promo = m.promotionPiece === 'q' ? 'queen' : m.promotionPiece === 'r' ? 'rook' : m.promotionPiece === 'b' ? 'bishop' : 'knight';
        game.executeMoveData(m.fromId, m.toId, promo);
    }
    game.isRemoteMove = false;
    game.render();
});

socket.on('game-start', (msg) => {
    const box = document.getElementById('turn-indicator');
    if (box && !game.gameOver) {
        box.innerText = `TURN: ${game.currentTurn.toUpperCase()} [ONLINE]`;
        box.style.background = '#312e2b';
        box.style.color = '#bababa';
    }
    game.updatePlayerCardsUI();
    game.gameStarted = true; // <-- THE FIX
    // Start timer NOW that both players are ready and connected!
    game.startClockLoop();
});

socket.on('receive-move', (moveData) => {
    game.isRemoteMove = true;
    game.executeMoveData(moveData.fromId, moveData.toId, moveData.promotionPiece);
    game.isRemoteMove = false;
});

socket.on('opponent-disconnected', () => {
    game._endGame('Opponent disconnected! You win.', '#769656');
});

socket.on('game-ended', ({ winner }) => {
    if (!game.gameOver) {
        game._endGame(`${winner.toUpperCase()} WINS! (Opponent Resigned/Timeout)`, '#555');
    }
});