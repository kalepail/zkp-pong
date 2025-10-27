# P2P Multiplayer Setup Guide

This guide explains how to set up and run the P2P multiplayer version of pong-a-bing-bong.

## Architecture Overview

The P2P implementation consists of three components:

1. **Frontend (Browser)**: Two players, each running their own game engine
2. **WebSocket Server (Cloudflare)**: Minimal relay server for paddle position sync
3. **Proof Server (Rust)**: ZKP validation (unchanged from single-player)

## Quick Start

### 1. Deploy the WebSocket Server

```bash
cd cloudflare-server
npm install
npm run dev  # Local development
# OR
npm run deploy  # Deploy to Cloudflare
```

The server will be available at:
- Local: `ws://localhost:8787`
- Production: `wss://your-worker.your-subdomain.workers.dev`

### 2. Configure Frontend

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` to set the WebSocket server URL:

```env
VITE_WS_SERVER_URL=ws://localhost:8787
```

For production, use the deployed Cloudflare Worker URL:

```env
VITE_WS_SERVER_URL=wss://pong-p2p-server.your-subdomain.workers.dev
```

### 3. Start the Frontend

```bash
npm run dev
```

Open `http://localhost:5173` in two browser windows.

### 4. Play P2P Multiplayer

**In Browser 1:**
1. Select "P2P Multiplayer" mode
2. Enter a room ID (e.g., "game123")
3. Click "Connect"
4. Wait for opponent...

**In Browser 2:**
1. Select "P2P Multiplayer" mode
2. Enter the **same room ID** (e.g., "game123")
3. Click "Connect"
4. Both players should see "Opponent connected!"

**Start the Game:**
1. Both players click "Start Match"
2. Game engines run independently on each browser
3. AI controls paddle movements locally
4. Paddle positions are synced via WebSocket
5. When game ends, both players receive the merged log
6. Either player can submit the log for ZKP verification

## How P2P Works

### Game Synchronization

1. **Independent Engines**: Each browser runs its own deterministic game engine
2. **Paddle Control**: Left player controls left paddle AI, right player controls right paddle AI
3. **Event Sync**: At each paddle-plane event:
   - Player computes their paddle position
   - Player sends position + commitment to server
   - Player receives opponent's position from server
   - Both positions are logged locally
4. **Determinism**: Same game_id and physics ensure identical game state
5. **Log Merging**: Server combines commitments from both players

### Message Flow

```
Browser 1 (Left)          WebSocket Server          Browser 2 (Right)
      |                          |                          |
      |----Connect (room123)---->|                          |
      |<---game_start (left)-----|                          |
      |                          |<----Connect (room123)----|
      |                          |---game_start (right)---->|
      |<--opponent_connected-----|--opponent_connected----->|
      |                          |                          |
      |-----player_ready-------->|<------player_ready-------|
      |<-----game_ready----------|------game_ready--------->|
      |                          |                          |
   [Game Loop - Each Event]
      |                          |                          |
      |-paddle_position (leftY)->|                          |
      |                          |-paddle_position (rightY)->|
      |                          |                          |
      |                          |<-paddle_position (leftY)-|
      |<-paddle_position (rightY)|                          |
      |                          |                          |
   [Game Ends]
      |                          |                          |
      |----player_log (partial)->|<----player_log (partial)-|
      |<----game_end (merged)----|-----game_end (merged)--->|
      |                          |                          |
```

### Commitment Scheme

- Each player generates a random 32-byte seed at game start
- Player commits to their paddle positions using SHA-256
- Commitments are sent with each paddle position
- Seeds are revealed in the final log
- ZKP verifier validates all commitments during proof generation

### Security

- **No Cheating**: Commitments are cryptographically binding
- **Deterministic Replay**: Game can be replayed from log
- **ZKP Verification**: Proof validates:
  - Paddle reachability (max speed constraints)
  - Hit/miss detection
  - Commitment integrity
  - Final score

## Deployment

### Cloudflare Worker

1. Install Wrangler CLI:
```bash
npm install -g wrangler
```

2. Login to Cloudflare:
```bash
wrangler login
```

3. Deploy:
```bash
cd cloudflare-server
wrangler deploy
```

4. Update frontend `.env` with deployed URL:
```env
VITE_WS_SERVER_URL=wss://pong-p2p-server.your-subdomain.workers.dev
```

### Frontend (Cloudflare Pages / Vercel / Netlify)

1. Build frontend:
```bash
npm run build
```

2. Deploy `dist/` directory to your hosting provider

3. Set environment variables in hosting dashboard:
   - `VITE_WS_SERVER_URL`: Your WebSocket server URL
   - `VITE_RISC0_API_URL`: Your proof server URL

## Troubleshooting

### "Connection error" when connecting

- Check WebSocket server is running (`ws://localhost:8787` for local dev)
- Verify `VITE_WS_SERVER_URL` in `.env` matches server URL
- Check browser console for WebSocket errors

### "Timeout waiting for opponent paddle"

- Network latency too high (increase timeout in `p2p.ts`)
- Opponent's browser closed/crashed
- WebSocket connection dropped

### "Verification failed" on proof submission

- Logs may be corrupted during merge
- Ensure both players have identical game_id
- Check that commitments match paddle positions

### Logs don't match between players

- This should never happen due to deterministic physics
- If it does, it indicates a bug in the sync logic
- Report with both logs for debugging

## Development

### Running Locally

Terminal 1 (WebSocket Server):
```bash
cd cloudflare-server
npm run dev
```

Terminal 2 (Frontend):
```bash
npm run dev
```

Terminal 3 (Proof Server - optional):
```bash
cd prover/api-server
cargo run
```

### Testing

1. Open two browser windows side-by-side
2. Use browser DevTools to monitor:
   - Network tab: WebSocket frames
   - Console tab: P2P event logs
3. Compare game states in both windows

### Debugging

Enable verbose logging in `src/pong/engine-p2p.ts` and `src/pong/p2p.ts`.

Check WebSocket messages:
```javascript
// In browser console
// Shows all WebSocket traffic
```

## Performance

- **Latency**: Paddle sync adds ~RTT to event processing
- **Bandwidth**: ~100 bytes per event (2 paddles + metadata)
- **Events**: Typical game has 40-60 events (~10-15 KB total)
- **Cloudflare**: Durable Objects Hibernation API minimizes costs

## Future Improvements

- [ ] Add spectator mode
- [ ] Implement reconnection logic
- [ ] Add chat between players
- [ ] Support tournament brackets
- [ ] Add leaderboard with verified proofs
