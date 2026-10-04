"use strict";

import { getLegalMoves } from './movements.js';
// ─── Constants ────────────────────────────────────────────────────────────────
const PIECE_VALUE = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 20000 };

// Piece-square tables: bonus scores for piece placement (from white's perspective).
// Each array is 64 values, rank 8→1, file a→h.
const PST = {
    pawn: [
         0,  0,  0,  0,  0,  0,  0,  0,
        50, 50, 50, 50, 50, 50, 50, 50,
        10, 10, 20, 30, 30, 20, 10, 10,
         5,  5, 10, 25, 25, 10,  5,  5,
         0,  0,  0, 20, 20,  0,  0,  0,
         5, -5,-10,  0,  0,-10, -5,  5,
         5, 10, 10,-20,-20, 10, 10,  5,
         0,  0,  0,  0,  0,  0,  0,  0,
    ],
    knight: [
        -50,-40,-30,-30,-30,-30,-40,-50,
        -40,-20,  0,  0,  0,  0,-20,-40,
        -30,  0, 10, 15, 15, 10,  0,-30,
        -30,  5, 15, 20, 20, 15,  5,-30,
        -30,  0, 15, 20, 20, 15,  0,-30,
        -30,  5, 10, 15, 15, 10,  5,-30,
        -40,-20,  0,  5,  5,  0,-20,-40,
        -50,-40,-30,-30,-30,-30,-40,-50,
    ],
    bishop: [
        -20,-10,-10,-10,-10,-10,-10,-20,
        -10,  0,  0,  0,  0,  0,  0,-10,
        -10,  0,  5, 10, 10,  5,  0,-10,
        -10,  5,  5, 10, 10,  5,  5,-10,
        -10,  0, 10, 10, 10, 10,  0,-10,
        -10, 10, 10, 10, 10, 10, 10,-10,
        -10,  5,  0,  0,  0,  0,  5,-10,
        -20,-10,-10,-10,-10,-10,-10,-20,
    ],
    rook: [
         0,  0,  0,  0,  0,  0,  0,  0,
         5, 10, 10, 10, 10, 10, 10,  5,
        -5,  0,  0,  0,  0,  0,  0, -5,
        -5,  0,  0,  0,  0,  0,  0, -5,
        -5,  0,  0,  0,  0,  0,  0, -5,
        -5,  0,  0,  0,  0,  0,  0, -5,
        -5,  0,  0,  0,  0,  0,  0, -5,
         0,  0,  0,  5,  5,  0,  0,  0,
    ],
    queen: [
        -20,-10,-10, -5, -5,-10,-10,-20,
        -10,  0,  0,  0,  0,  0,  0,-10,
        -10,  0,  5,  5,  5,  5,  0,-10,
         -5,  0,  5,  5,  5,  5,  0, -5,
          0,  0,  5,  5,  5,  5,  0, -5,
        -10,  5,  5,  5,  5,  5,  0,-10,
        -10,  0,  5,  0,  0,  0,  0,-10,
        -20,-10,-10, -5, -5,-10,-10,-20,
    ],
    king: [
        -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30,
        -20,-30,-30,-40,-40,-30,-30,-20,
        -10,-20,-20,-20,-20,-20,-20,-10,
         20, 20,  0,  0,  0,  0, 20, 20,
         20, 30, 10,  0,  0, 10, 30, 20,
    ],
};

// ─── Board helpers ────────────────────────────────────────────────────────────

function cloneMap(map) {
    return map.map(row => row.map(sq => ({ ...sq, piece: sq.piece ? { ...sq.piece } : null })));
}

function applyMove(map, fromId, toId) {
    let src = null, dst = null;
    let srcRow = -1, srcCol = -1, dstRow = -1, dstCol = -1;

    for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++) {
            if (map[r][c].id === fromId) { src = map[r][c]; srcRow = r; srcCol = c; }
            if (map[r][c].id === toId)   { dst = map[r][c]; dstRow = r; dstCol = c; }
        }

    if (!src?.piece || !dst) return;
    const isCapture = !!dst.piece;
    dst.piece = { ...src.piece };
    src.piece = null;

    // En-passant: diagonal pawn move onto empty square → remove captured pawn
    if (dst.piece.type === 'pawn' && srcCol !== dstCol && !isCapture) {
        map[srcRow][dstCol].piece = null;
    }
    // Promotion → queen for evaluation purposes
    if (dst.piece.type === 'pawn' && (dstRow === 0 || dstRow === 7)) {
        dst.piece.type = 'queen';
    }
    // Castling: move rook
    if (dst.piece.type === 'king' && Math.abs(dstCol - srcCol) === 2) {
        const color = dst.piece.color;
        if (dstCol === 6) { map[dstRow][5].piece = { type: 'rook', color }; map[dstRow][7].piece = null; }
        if (dstCol === 2) { map[dstRow][3].piece = { type: 'rook', color }; map[dstRow][0].piece = null; }
    }
}

function isKingAttacked(color, map, gameState) {
    let kingId = null;
    for (const row of map)
        for (const sq of row)
            if (sq.piece?.type === 'king' && sq.piece.color === color) { kingId = sq.id; break; }
    if (!kingId) return false;

    const enemy = color === 'white' ? 'black' : 'white';
    for (const row of map)
        for (const sq of row)
            if (sq.piece?.color === enemy && getLegalMoves(sq, map, gameState).includes(kingId))
                return true;
    return false;
}

// Returns strictly legal moves for one square (no self-check)
function strictMovesForSquare(square, map, gameState) {
    if (!square?.piece) return [];
    return getLegalMoves(square, map, gameState).filter(toId => {
        const sandbox = cloneMap(map);
        applyMove(sandbox, square.id, toId);
        return !isKingAttacked(square.piece.color, sandbox, null);
    });
}

// Returns all strictly legal moves for a color as { from, to } pairs
export function getStrictMovesForColor(map, color, gameState) {
    const moves = [];
    for (const row of map)
        for (const sq of row)
            if (sq.piece?.color === color)
                for (const toId of strictMovesForSquare(sq, map, gameState))
                    moves.push({ from: sq.id, to: toId });
    return moves;
}

// ─── Static evaluation ────────────────────────────────────────────────────────
// Positive = good for white, negative = good for black

function pstIndex(row, col, color) {
    return color === 'white' ? row * 8 + col : (7 - row) * 8 + col;
}

function evaluate(map) {
    let score = 0;
    for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++) {
            const p = map[r][c].piece;
            if (!p) continue;
            const val = PIECE_VALUE[p.type] + (PST[p.type]?.[pstIndex(r, c, p.color)] ?? 0);
            score += p.color === 'white' ? val : -val;
        }
    return score;
}

// ─── Minimax with alpha-beta pruning ─────────────────────────────────────────
// Time complexity: O(b^(d/2)) with good move ordering, where b≈35 (branching factor), d=depth

function minimax(map, depth, alpha, beta, maximising, gameState) {
    if (depth === 0) return evaluate(map);

    const color = maximising ? 'white' : 'black';
    const moves = getStrictMovesForColor(map, color, gameState);

    if (moves.length === 0) {
        // No moves: checkmate or stalemate
        return isKingAttacked(color, map, gameState)
            ? (maximising ? -99999 : 99999)   // checkmate
            : 0;                               // stalemate
    }

    if (maximising) {
        let best = -Infinity;
        for (const mv of moves) {
            const child = cloneMap(map);
            applyMove(child, mv.from, mv.to);
            best  = Math.max(best, minimax(child, depth - 1, alpha, beta, false, null));
            alpha = Math.max(alpha, best);
            if (beta <= alpha) break; // beta cut-off
        }
        return best;
    } else {
        let best = Infinity;
        for (const mv of moves) {
            const child = cloneMap(map);
            applyMove(child, mv.from, mv.to);
            best = Math.min(best, minimax(child, depth - 1, alpha, beta, true, null));
            beta = Math.min(beta, best);
            if (beta <= alpha) break; // alpha cut-off
        }
        return best;
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the best move for the AI player.
 *
 * @param {Array}  map       - Current board state (8×8 square grid)
 * @param {string} color     - AI color ('black' in this game)
 * @param {number} level     - Difficulty: 1 = random, 2 = greedy (depth 1), 3 = minimax (depth 3)
 * @param {object} gameState - { enPassantTarget, castlingRights }
 * @returns {{ from: string, to: string } | null}
 */
export function getBestMove(map, color, level, gameState) {
    const moves = getStrictMovesForColor(map, color, gameState);
    if (!moves.length) return null;

    // Level 1 — random move (good for beginners)
    if (level === 1) return moves[Math.floor(Math.random() * moves.length)];

    // Level 2 — greedy: picks the best move one ply deep
    // Level 3 — minimax: looks 3 plies ahead with alpha-beta pruning
    // Level 4 — minimax: looks 4 plies ahead with alpha-beta pruning (strongest)
    const depth      = level === 2 ? 1 : level === 3 ? 3 : 4;
    const maximising = color === 'white';

    // Shuffle for variety when multiple moves have equal scores
    moves.sort(() => Math.random() - 0.5);

    let bestScore = maximising ? -Infinity : Infinity;
    let bestMove  = moves[0];

    for (const mv of moves) {
        const child = cloneMap(map);
        applyMove(child, mv.from, mv.to);
        const score = minimax(child, depth - 1, -Infinity, Infinity, !maximising, null);

        if (maximising ? score > bestScore : score < bestScore) {
            bestScore = score;
            bestMove  = mv;
        }
    }

    return bestMove;
}