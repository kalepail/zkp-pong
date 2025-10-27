# Pong P2P WebSocket Server

Cloudflare Durable Objects-based WebSocket server for P2P pong game coordination.

## Features

- **Room-based matchmaking**: Two players per game room
- **Minimal relay**: Only syncs paddle positions between players
- **Log merging**: Combines final logs from both players
- **Cost-efficient**: Uses WebSocket Hibernation API

## Setup

1. Install dependencies:
```bash
cd cloudflare-server
npm install
```

2. Run locally:
```bash
npm run dev
```

3. Deploy to Cloudflare:
```bash
npm run deploy
```

## Usage

Players connect via WebSocket to:
```
wss://your-worker.your-subdomain.workers.dev/game?room=<roomId>&playerId=<playerId>
```

- `room`: Game room identifier (both players must use the same room ID)
- `playerId`: Unique player identifier

## Message Protocol

### Server → Client

**Game Start**
```json
{
  "type": "game_start",
  "gameId": 12345,
  "yourRole": "left",
  "opponentConnected": false
}
```

**Opponent Connected**
```json
{
  "type": "opponent_connected",
  "gameId": 12345
}
```

**Game Ready** (both players ready)
```json
{
  "type": "game_ready",
  "gameId": 12345
}
```

**Opponent Paddle Position**
```json
{
  "type": "opponent_paddle",
  "eventIndex": 0,
  "paddleY": "15728640"
}
```

**Game End** (merged log)
```json
{
  "type": "game_end",
  "log": { /* CompactLog */ }
}
```

### Client → Server

**Player Ready**
```json
{
  "type": "player_ready",
  "gameId": 12345
}
```

**Paddle Position**
```json
{
  "type": "paddle_position",
  "role": "left",
  "eventIndex": 0,
  "paddleY": "15728640",
  "commitment": "abc123..."
}
```

**Player Log** (game complete)
```json
{
  "type": "player_log",
  "log": { /* CompactLog */ }
}
```

## Architecture

- **GameRoom** Durable Object: One instance per game room
- **Player Sessions**: Tracks connected players and their roles (left/right)
- **Event Relay**: Forwards paddle positions between players
- **Log Merging**: Combines commitments and events from both players
