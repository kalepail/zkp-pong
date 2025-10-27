# Server-Authoritative Event Log Architecture

## Overview

The P2P multiplayer system now uses a **server-authoritative** approach where the WebSocket server progressively builds the canonical event log during gameplay. This is more robust than having clients build their own logs and trying to merge them at the end.

## Architecture

### Before (Client-Authoritative)

```
Player A                    Server                    Player B
   |                          |                          |
   |--paddle_position-------->|                          |
   |                          |----paddle_position------>|
   |                          |                          |
   |<---paddle_position-------|<--paddle_position--------|
   |                          |                          |
[builds full events locally]  [just relays]  [builds full events locally]
   |                          |                          |
   |--player_log (full)------>|                          |
   |                          |<--player_log (full)------|
   |                          |                          |
   |                      [merge logs]                   |
   |<-----game_end (merged log)----------------------->|
```

**Problems:**
- Both clients build complete logs independently
- Desyncs possible if one client drops packets
- Merge logic complex (what if logs differ?)
- No single source of truth

### After (Server-Authoritative)

```
Player A                    Server                    Player B
   |                          |                          |
   |--paddle_position-------->|                          |
   |   + commitment           |----paddle_position------>|
   |                          |                          |
   |<---paddle_position-------|<--paddle_position--------|
   |                          |   + commitment           |
   |                      [records event]                |
   |                  [left: X, right: Y]                |
   |                          |                          |
   |--paddle_position-------->|                          |
   |   + commitment           |----paddle_position------>|
   |                          |                          |
   |<---paddle_position-------|<--paddle_position--------|
   |                          |   + commitment           |
   |                      [records event]                |
   |                  [left: X2, right: Y2]              |
   |                          |                          |
          ... game continues ...
   |                          |                          |
   |--player_log (just seed)->|                          |
   |                          |<--player_log (just seed)-|
   |                          |                          |
   |                   [builds final log]                |
   |                [events from server]                 |
   |                [commitments from players]           |
   |                [seeds from players]                 |
   |                          |                          |
   |<-----game_end (authoritative log)------------------>|
```

**Benefits:**
- ✅ Server has **single source of truth** for events
- ✅ Events recorded **progressively** as they happen
- ✅ Desyncs detected **immediately** (if event indices don't match)
- ✅ Clients only send **their own commitments + seed**
- ✅ Merge logic **simple** (just interleave commitments)
- ✅ Robust against **client disconnections**

## Implementation Details

### Server State (GameRoom Durable Object)

```typescript
private sessions: Map<WebSocket, PlayerSession>
private gameId: number
private events: string[]  // [leftY0, rightY0, leftY1, rightY1, ...]
private pendingEvent: {
  left?: string
  right?: string
  eventIndex: number
} | null
```

### PlayerSession

```typescript
interface PlayerSession {
  ws: WebSocket
  role: 'left' | 'right'
  commitments: string[]  // Player's commitments for their paddle only
  seed?: string          // Revealed at game end
}
```

### Event Recording Flow

1. **Player A sends paddle position**:
   ```json
   {
     "type": "paddle_position",
     "role": "left",
     "eventIndex": 0,
     "paddleY": "15728640",
     "commitment": "abc123..."
   }
   ```

2. **Server stores commitment**:
   ```typescript
   session.commitments.push(msg.commitment)
   ```

3. **Server adds to pending event**:
   ```typescript
   pendingEvent = {
     left: "15728640",
     eventIndex: 0
   }
   ```

4. **Player B sends paddle position**:
   ```json
   {
     "type": "paddle_position",
     "role": "right",
     "eventIndex": 0,
     "paddleY": "31457280",
     "commitment": "def456..."
   }
   ```

5. **Server completes event**:
   ```typescript
   pendingEvent.right = "31457280"

   // Event complete!
   events.push(pendingEvent.left)   // "15728640"
   events.push(pendingEvent.right)  // "31457280"

   console.log("Event 0 complete: left=15728640, right=31457280")
   ```

### Game End Flow

1. **Both players send final log** (just seed):
   ```json
   {
     "type": "player_log",
     "log": {
       "player_left_seed": "abc123...",  // or player_right_seed
       "player_right_seed": ""
     }
   }
   ```

2. **Server extracts seeds**:
   ```typescript
   leftPlayer.seed = log.player_left_seed
   rightPlayer.seed = log.player_right_seed
   ```

3. **Server builds final log**:
   ```typescript
   return {
     v: 1,
     game_id: this.gameId,
     events: this.events,  // Server's canonical log
     commitments: [
       leftPlayer.commitments[0],
       rightPlayer.commitments[0],
       leftPlayer.commitments[1],
       rightPlayer.commitments[1],
       ...
     ],
     player_left_seed: leftPlayer.seed,
     player_right_seed: rightPlayer.seed
   }
   ```

4. **Server sends to both players**:
   ```json
   {
     "type": "game_end",
     "log": { /* final authoritative log */ }
   }
   ```

## Advantages

### Robustness
- **Single source of truth**: Server's event log is authoritative
- **Progressive validation**: Events recorded as they happen
- **Fault tolerance**: If one client disconnects, server still has the events

### Simplicity
- **No complex merge logic**: Server already has complete events
- **Clients simpler**: Don't need to track opponent's events
- **Clear ownership**: Server owns events, players own commitments

### Debugging
- **Server logs**: Can see exactly what events were recorded
- **Event-by-event**: Know immediately if something goes wrong
- **Audit trail**: Server has complete history of the game

## Desync Detection

If players send mismatched event indices, server can detect:

```typescript
if (pendingEvent.eventIndex !== msg.eventIndex) {
  console.error(`[Server] Event index mismatch!`, {
    pending: pendingEvent.eventIndex,
    received: msg.eventIndex,
    from: session.role
  })
  // Could notify clients, end game, etc.
}
```

## Client Changes Required

Clients still need to:
- ✅ Run deterministic game engine
- ✅ Send paddle positions at each event
- ✅ Generate commitments for their paddle **using correct global indices**
  - Left player: use indices 0, 2, 4, 6... (even)
  - Right player: use indices 1, 3, 5, 7... (odd)
- ✅ Wait for opponent paddle positions
- ✅ Build full event log locally (for game logic synchronization)
- ✅ Send seed at game end

### Critical: Commitment Indices

In the final merged log, events are interleaved:
```
events: [leftY0, rightY0, leftY1, rightY1, leftY2, rightY2, ...]
indices: [0,     1,       2,       3,       4,       5,     ...]
```

Each player must compute commitments using their **global interleaved index**, not their local event count:

```typescript
// WRONG - uses local index (0, 1, 2, 3...)
const myEventIndex = myEvents.length

// CORRECT - uses global interleaved index
const myEventIndex = role === 'left'
  ? fullEvents.length       // 0, 2, 4, 6...
  : fullEvents.length + 1   // 1, 3, 5, 7...
```

This ensures commitments can be verified against the correct positions in the merged log.

## Migration Notes

The client code currently builds `fullEvents` locally for game synchronization. This is still useful for:
- Local replay/validation
- Detecting if opponent missed an event (timeout)
- Verifying determinism

But the **authoritative log comes from the server**, not the client.

## Future Enhancements

- [ ] Event validation (paddle reachability, physics)
- [ ] Timeout detection (if one player stops sending events)
- [ ] Reconnection support (resume from last recorded event)
- [ ] Spectator mode (stream events from server)
- [ ] Replays (server stores complete game logs)
