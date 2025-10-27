# Automated Matchmaking

## Quick Start

1. Select "P2P Multiplayer" mode
2. Click "Find Match"
3. Wait for opponent...
4. Both players click "Start Match"
5. Play!

## How It Works

### Simple Matchmaking Flow

```
Player 1 clicks "Find Match"
  → Server creates new room with unique ID
  → Server generates random game ID
  → Player 1 waits in queue...

Player 2 clicks "Find Match"
  → Server matches with Player 1
  → Both assigned to same room
  → Both use same game ID
  → Connection established!

Both players click "Start Match"
  → Game begins simultaneously
```

### Architecture

**Matchmaker Durable Object**
- Single global instance manages all matchmaking
- Tracks one waiting player at a time
- Auto-generates unique room IDs: `room-{timestamp}-{random}`
- Auto-generates game IDs: random 32-bit unsigned integer

**Matching Logic**
1. First player creates a room and waits
2. Second player joins that room
3. Both receive the same roomId and gameId
4. They connect via WebSocket to the same game room

### Status Messages

- `"Click 'Find Match' to play"` - Ready to search
- `"Finding match..."` - Searching for opponent
- `"Match found! Connecting..."` - Opponent found, connecting
- `"Playing as LEFT/RIGHT player - Waiting for opponent..."` - Connected, waiting
- `"Opponent ready! Starting soon..."` - Both connected, ready to start
- `"Opponent disconnected"` - Connection lost

### Benefits

✅ **Zero Configuration**: No room codes to share
✅ **Instant Matching**: First available opponent
✅ **Fair Pairing**: First-come, first-served
✅ **Auto-Generated IDs**: No collisions or duplicates
✅ **Simple UX**: One button to play

### Testing with Two Browsers

**Browser 1:**
1. Select "P2P Multiplayer"
2. Click "Find Match"
3. Status: "Waiting for opponent..."

**Browser 2:**
1. Select "P2P Multiplayer"
2. Click "Find Match"
3. Both should connect instantly!

### Technical Details

**Endpoint**: `POST /matchmaking`

**Response:**
```json
{
  "roomId": "room-1234567890-abc123",
  "gameId": 2085347750
}
```

**Matchmaker State:**
- If no one waiting: Create new room, store details, return to player 1
- If someone waiting: Return stored room details to player 2, clear queue

**Scalability:**
- Current implementation: Single global matchmaker (simple, works for moderate traffic)
- Future: Multiple regional matchmakers for lower latency
- Future: Skill-based matching, ELO ratings

### Limitations

- No matchmaking cancellation (refresh page to cancel)
- No skill-based matching (random pairing)
- No regional matching (global queue)
- Maximum 2 players per game (no spectators)

### Future Enhancements

- [ ] Matchmaking timeout (cancel after 30s)
- [ ] Skill-based matchmaking (ELO)
- [ ] Regional queues (US, EU, APAC)
- [ ] Party system (invite friends)
- [ ] Ranked mode with leaderboard
- [ ] Practice mode (play vs AI while waiting)
