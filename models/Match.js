const mongoose = require('mongoose');

const MatchSchema = new mongoose.Schema({
    roomId: { type: String, required: true, unique: true },
    whitePlayer: { type: String, default: null }, // username
    blackPlayer: { type: String, default: null }, // username
    fen: { type: String, default: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
    status: { type: String, default: 'waiting', enum: ['waiting', 'playing', 'finished'] },
    winner: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Match', MatchSchema);
