import { getBestMove } from './ai.js';

self.onmessage = function(e) {
    const { mainMap, color, level, gameState } = e.data;
    const aiMove = getBestMove(mainMap, color, level, gameState);
    self.postMessage(aiMove);
};
