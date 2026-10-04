"use strict";

const isOnBoard = (row, col) => row >= 0 && row < 8 && col >= 0 && col < 8;

/**
 * Returns pseudo-legal moves (does NOT filter moves that leave the king in check).
 * Pass gameState for en-passant and castling awareness.
 *
 * @param {{ id:string, piece:{type:string,color:string}|null }} square
 * @param {Array}  mainMap   - 8×8 grid of square objects
 * @param {object|null} gameState - { enPassantTarget, castlingRights }
 * @returns {string[]} target square ids
 */
export const getLegalMoves = function(square, mainMap, gameState = null) {
    const moves = [];

    // Locate the square on the board
    let row = -1, col = -1;
    outer: for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (mainMap[r][c].id === square.id) { row = r; col = c; break outer; }
        }
    }

    const piece = square.piece;
    if (!piece || row === -1) return moves;

    // ── Pawn ──────────────────────────────────────────────────────────────────
    if (piece.type === 'pawn') {
        const dir      = piece.color === 'white' ? -1 : 1;
        const startRow = piece.color === 'white' ?  6 :  1;
        const nextRow  = row + dir;

        if (isOnBoard(nextRow, col) && !mainMap[nextRow][col].piece) {
            moves.push(mainMap[nextRow][col].id);
            const doubleRow = row + 2 * dir;
            if (row === startRow && isOnBoard(doubleRow, col) && !mainMap[doubleRow][col].piece) {
                moves.push(mainMap[doubleRow][col].id);
            }
        }

        [-1, 1].forEach(dc => {
            const tc = col + dc;
            if (!isOnBoard(nextRow, tc)) return;
            const tSq = mainMap[nextRow][tc];
            if (tSq.piece && tSq.piece.color !== piece.color) moves.push(tSq.id);
            if (gameState?.enPassantTarget === tSq.id)        moves.push(tSq.id);
        });
    }

    // ── Knight ────────────────────────────────────────────────────────────────
    if (piece.type === 'knight') {
        [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dr,dc]) => {
            const tr = row + dr, tc = col + dc;
            if (isOnBoard(tr, tc)) {
                const tSq = mainMap[tr][tc];
                if (!tSq.piece || tSq.piece.color !== piece.color) moves.push(tSq.id);
            }
        });
    }

    // ── Sliding pieces (rook / bishop / queen) ────────────────────────────────
    const dirs = [];
    if (piece.type === 'rook'   || piece.type === 'queen') dirs.push([0,1],[0,-1],[1,0],[-1,0]);
    if (piece.type === 'bishop' || piece.type === 'queen') dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);

    dirs.forEach(([dr, dc]) => {
        let sr = row + dr, sc = col + dc;
        while (isOnBoard(sr, sc)) {
            const tSq = mainMap[sr][sc];
            if (!tSq.piece) {
                moves.push(tSq.id);
            } else {
                if (tSq.piece.color !== piece.color) moves.push(tSq.id);
                break;
            }
            sr += dr; sc += dc;
        }
    });

    // ── King ──────────────────────────────────────────────────────────────────
    if (piece.type === 'king') {
        [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dr,dc]) => {
            const tr = row + dr, tc = col + dc;
            if (isOnBoard(tr, tc)) {
                const tSq = mainMap[tr][tc];
                if (!tSq.piece || tSq.piece.color !== piece.color) moves.push(tSq.id);
            }
        });

        if (gameState) {
            const rights    = gameState.castlingRights[piece.color];
            const backRank  = piece.color === 'white' ? 7 : 0;

            if (rights.kingSide) {
                if (!mainMap[backRank][5].piece && !mainMap[backRank][6].piece)
                    moves.push(mainMap[backRank][6].id);
            }
            if (rights.queenSide) {
                if (!mainMap[backRank][1].piece && !mainMap[backRank][2].piece && !mainMap[backRank][3].piece)
                    moves.push(mainMap[backRank][2].id);
            }
        }
    }

    return moves;
};