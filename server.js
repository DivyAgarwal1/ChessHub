require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { Chess } = require('chess.js');
const User = require('./models/User');
const Match = require('./models/Match');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// DB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chessdb')
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log(err));

// Auth Routes
app.post('/api/signup', async (req, res) => {
    try {
        const { username, password } = req.body;
        const userExists = await User.findOne({ username });
        if (userExists) return res.status(400).json({ message: 'User already exists' });
        await User.create({ username, password });
        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (user && (await user.matchPassword(password))) {
            const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
            res.json({ token, username: user.username, elo: user.elo, wins: user.wins, losses: user.losses });
        } else {
            res.status(401).json({ message: 'Invalid credentials' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Socket.IO for Multiplayer
const rooms = {};

// JWT Socket Authentication Middleware
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, decoded) => {
        if (err) return next(new Error('Authentication error'));
        socket.user = decoded;
        next();
    });
});

io.on('connection', (socket) => {
    console.log('A player connected:', socket.user.username);

    socket.on('create-room', async ({ roomId }) => {
        const user = await User.findOne({ username: socket.user.username });
        if (!user) return;

        await Match.deleteOne({ roomId }); // Clean up any old match with same id
        await Match.create({ roomId, whitePlayer: user.username, status: 'waiting' });

        rooms[roomId] = {
            game: new Chess(),
            players: [{
                id: socket.id,
                color: 'white',
                username: user.username,
                elo: user.elo,
                wins: user.wins,
                losses: user.losses,
                ready: false
            }],
            status: 'waiting'
        };
        socket.join(roomId);
        console.log('Room created:', roomId, user.username);
        socket.emit('room-created', roomId);
        socket.emit('player-color', 'white');
    });

    socket.on('join-room', async ({ roomId }) => {
        let room = rooms[roomId];
        const user = await User.findOne({ username: socket.user.username });
        if (!user) return;

        if (!room) {
            // Check if room is in DB (recovering state)
            const match = await Match.findOne({ roomId, status: 'waiting' });
            if (!match) return socket.emit('join-error', 'Room code does not exist.');
            // Initialize room from DB
            room = rooms[roomId] = {
                game: new Chess(match.fen),
                players: [],
                status: 'waiting'
            };
            const w = await User.findOne({ username: match.whitePlayer });
            if (w) room.players.push({ id: null, color: 'white', username: w.username, elo: w.elo, wins: w.wins, losses: w.losses, ready: false });
        }

        const isAlreadyInRoom = room.players.some(p => p.username === user.username);
        
        if (isAlreadyInRoom) {
            if (room.status === 'waiting') {
                return socket.emit('join-error', 'You cannot join your own room. Wait for an opponent.');
            }
            // If they are already in a started room, just emit the matched event so they can reconnect
            socket.join(roomId);
            const w = room.players.find(p => p.color === 'white');
            const b = room.players.find(p => p.color === 'black');
            socket.emit('room-joined', roomId);
            socket.emit('player-color', room.players.find(p => p.username === user.username).color);
            return io.to(roomId).emit('game-matched', {
                roomId,
                whitePlayer: w ? { username: w.username, elo: w.elo, wins: w.wins, losses: w.losses } : null,
                blackPlayer: b ? { username: b.username, elo: b.elo, wins: b.wins, losses: b.losses } : null
            });
        }

        if (room.players.length >= 2) {
            return socket.emit('join-error', 'Room is full.');
        }

        await Match.updateOne({ roomId }, { blackPlayer: user.username, status: 'playing' });

        const blackPlayer = {
            id: socket.id,
            color: 'black',
            username: user.username,
            elo: user.elo,
            wins: user.wins,
            losses: user.losses,
            ready: false
        };

        const existingBlack = room.players.findIndex(p => p.color === 'black');
        if (existingBlack !== -1) {
            room.players[existingBlack] = blackPlayer;
        } else {
            room.players.push(blackPlayer);
        }

        room.status = 'matched';
        socket.join(roomId);
        console.log('Player joined room:', roomId, user.username);

        socket.emit('room-joined', roomId);
        socket.emit('player-color', 'black');

        const whitePlayer = room.players.find(p => p.color === 'white');

        io.to(roomId).emit('game-matched', {
            roomId,
            whitePlayer: whitePlayer ? { username: whitePlayer.username, elo: whitePlayer.elo, wins: whitePlayer.wins, losses: whitePlayer.losses } : null,
            blackPlayer: { username: blackPlayer.username, elo: blackPlayer.elo, wins: blackPlayer.wins, losses: blackPlayer.losses }
        });
    });

    socket.on('rejoin-game', async ({ roomId }) => {
        let room = rooms[roomId];
        const match = await Match.findOne({ roomId });
        const username = socket.user.username;

        if (!room && !match) {
            return socket.emit('room-not-found', 'Room expired or does not exist.');
        }

        if (!room && match) {
            room = rooms[roomId] = {
                game: new Chess(match.fen),
                players: [],
                status: match.status
            };
            if (match.whitePlayer) {
                const w = await User.findOne({ username: match.whitePlayer });
                if (w) room.players.push({ id: null, color: 'white', username: w.username, elo: w.elo, wins: w.wins, losses: w.losses, ready: false });
            }
            if (match.blackPlayer) {
                const b = await User.findOne({ username: match.blackPlayer });
                if (b) room.players.push({ id: null, color: 'black', username: b.username, elo: b.elo, wins: b.wins, losses: b.losses, ready: false });
            }
        }

        socket.join(roomId);
        let player = room.players.find(p => p.username === username);
        if (player) {
            player.id = socket.id;
            player.ready = true;
            socket.emit('player-color', player.color);
        }

        const whitePlayer = room.players.find(p => p.color === 'white');
        const blackPlayer = room.players.find(p => p.color === 'black');

        socket.emit('room-details', {
            roomId,
            whitePlayer: whitePlayer ? { username: whitePlayer.username, elo: whitePlayer.elo, wins: whitePlayer.wins, losses: whitePlayer.losses } : null,
            blackPlayer: blackPlayer ? { username: blackPlayer.username, elo: blackPlayer.elo, wins: blackPlayer.wins, losses: blackPlayer.losses } : null
        });

        // Sync board state
        const history = room.game.history({ verbose: true }).map(m => ({
            fromId: m.from,
            toId: m.to,
            promotionPiece: m.promotion
        }));
        socket.emit('sync-board', history);

        const activeCount = room.players.filter(p => p.ready).length;
        if (room.players.length === 2 && activeCount >= 2) {
            room.status = 'playing';
            io.to(roomId).emit('game-start', 'Both players ready! Game started.');
        } else {
            io.to(roomId).emit('player-waiting', 'Waiting for opponent to enter board...');
        }
    });

    socket.on('player-ready', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (player) player.ready = true;

        if (room.players.length === 2 && room.players.every(p => p.ready)) {
            room.status = 'playing';
            io.to(roomId).emit('game-start', 'Both players ready! Game started.');
        }
    });

    socket.on('make-move', async ({ roomId, moveData }) => {
        const room = rooms[roomId];
        if (!room || room.status !== 'playing') return;

        const chess = room.game;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        // Ensure it's the player's turn
        if ((chess.turn() === 'w' && player.color !== 'white') ||
            (chess.turn() === 'b' && player.color !== 'black')) {
            return;
        }

        try {
            let promo = undefined;
            if (moveData.promotionPiece) {
                promo = moveData.promotionPiece === 'knight' ? 'n' : moveData.promotionPiece[0];
            }
            const move = chess.move({
                from: moveData.fromId,
                to: moveData.toId,
                promotion: promo
            });

            // If successful, save state
            await Match.updateOne({ roomId }, { fen: chess.fen() });

            // Broadcast move
            socket.to(roomId).emit('receive-move', moveData);

            // Check game over
            if (chess.isGameOver()) {
                let winner = 'draw';
                if (chess.isCheckmate()) {
                    winner = chess.turn() === 'w' ? 'black' : 'white';
                }
                await handleGameOver(roomId, winner);
            }
        } catch (e) {
            // Illegal move
            console.error('Illegal move attempted:', moveData);
            // Optionally emit an error to the client to resync
            socket.emit('sync-board', chess.history({ verbose: true }).map(m => ({
                fromId: m.from,
                toId: m.to,
                promotionPiece: m.promotion
            })));
        }
    });

    socket.on('game-over', async ({ roomId, winner }) => {
        // Client resigns or timeouts. We trust client for resignation and timeout.
        const room = rooms[roomId];
        const player = room?.players.find(p => p.id === socket.id);
        
        // A player can only resign for themselves (winner must be the opponent)
        if (player && winner === (player.color === 'white' ? 'black' : 'white')) {
            await handleGameOver(roomId, winner);
        } else if (winner === 'draw' || winner === 'white' || winner === 'black') {
            // Could be a timeout, allow it
            await handleGameOver(roomId, winner);
        }
    });

    async function handleGameOver(roomId, winner) {
        io.to(roomId).emit('game-ended', { winner });
        
        const room = rooms[roomId];
        if (room && room.status === 'playing') {
            room.status = 'finished';
            await Match.updateOne({ roomId }, { status: 'finished', winner });

            try {
                const whiteP = room.players.find(p => p.color === 'white');
                const blackP = room.players.find(p => p.color === 'black');
                if (whiteP && blackP) {
                    const K = 32;
                    const expectedWhite = 1 / (1 + Math.pow(10, (blackP.elo - whiteP.elo) / 400));
                    const expectedBlack = 1 / (1 + Math.pow(10, (whiteP.elo - blackP.elo) / 400));
                    
                    if (winner.toLowerCase() === 'white') {
                        const eloDiff = Math.round(K * (1 - expectedWhite));
                        await User.updateOne({ username: whiteP.username }, { $inc: { wins: 1, elo: eloDiff } });
                        await User.updateOne({ username: blackP.username }, { $inc: { losses: 1, elo: -eloDiff } });
                    } else if (winner.toLowerCase() === 'black') {
                        const eloDiff = Math.round(K * (1 - expectedBlack));
                        await User.updateOne({ username: blackP.username }, { $inc: { wins: 1, elo: eloDiff } });
                        await User.updateOne({ username: whiteP.username }, { $inc: { losses: 1, elo: -eloDiff } });
                    } else if (winner.toLowerCase() === 'draw') {
                        const whiteDiff = Math.round(K * (0.5 - expectedWhite));
                        const blackDiff = Math.round(K * (0.5 - expectedBlack));
                        await User.updateOne({ username: whiteP.username }, { $inc: { elo: whiteDiff } });
                        await User.updateOne({ username: blackP.username }, { $inc: { elo: blackDiff } });
                    }
                }
            } catch (e) {
                console.error('Error updating game stats:', e);
            }
        }
    }

    socket.on('disconnect', () => {
        console.log('A player disconnected:', socket.id);
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                room.players[playerIndex].ready = false;
                
                if (room.status === 'waiting') {
                    // Option to remove the room if empty, but we might want them to reconnect
                    // Wait 5 minutes to clean up? For now, let it persist in memory/DB.
                } else if (room.status === 'playing') {
                    socket.to(roomId).emit('opponent-disconnected');
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Port ${PORT} is already in use. Please stop the other process or change PORT in .env\n`);
        process.exit(1);
    } else {
        throw err;
    }
});