import { DurableObject } from 'cloudflare:workers';

// Types
type PlayerRole = 'left' | 'right';

interface PlayerSession {
  ws: WebSocket;
  role: PlayerRole;
  playerId: string;
  ready: boolean;
  commitments: string[]; // Player's commitments for their paddle
  seed?: string; // Player's revealed seed at game end
}

interface PaddlePositionMessage {
  type: 'paddle_position';
  role: PlayerRole;
  eventIndex: number;
  paddleY: string; // Q16.16 fixed-point string
  commitment: string;
}

interface GameStartMessage {
  type: 'game_start';
  gameId: number;
  yourRole: PlayerRole;
  opponentConnected: boolean;
}

interface OpponentPaddleMessage {
  type: 'opponent_paddle';
  eventIndex: number;
  paddleY: string;
}

interface GameEndMessage {
  type: 'game_end';
  log: any;
}

interface PlayerReadyMessage {
  type: 'player_ready';
  gameId: number;
}

interface PlayerLogMessage {
  type: 'player_log';
  log: any;
}

// Worker: Handle incoming requests and route to Durable Objects
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers for browser access
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Matchmaking endpoint
    if (url.pathname === '/matchmaking' && request.method === 'POST') {
      // Use a single matchmaker Durable Object for all matchmaking
      const id = env.MATCHMAKER.idFromName('global');
      const stub = env.MATCHMAKER.get(id);
      return stub.fetch(request);
    }

    // WebSocket upgrade endpoint
    if (url.pathname === '/game') {
      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      // Get or create room ID from query param
      const roomId = url.searchParams.get('room') || 'default';
      const playerId = url.searchParams.get('playerId') || crypto.randomUUID();
      const gameIdParam = url.searchParams.get('gameId');

      // Get the Durable Object stub for this room
      const id = env.GAME_ROOM.idFromName(roomId);
      const stub = env.GAME_ROOM.get(id);

      // Forward the request to the Durable Object (gameId will be in URL)
      return stub.fetch(request);
    }

    return new Response('Pong P2P Server\n\nEndpoints:\n  /game?room=<roomId>&playerId=<playerId>', {
      headers: { 'Content-Type': 'text/plain', ...corsHeaders },
    });
  },
};

// Durable Object: Game Room coordination
export class GameRoom extends DurableObject {
  private sessions: Map<WebSocket, PlayerSession> = new Map();
  private gameId: number = 0;
  private gameStarted: boolean = false;
  private events: string[] = []; // Canonical event log: [leftY0, rightY0, leftY1, rightY1, ...]
  private pendingEvent: { left?: string; right?: string; eventIndex: number } | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // WebSocket Hibernation API is automatically enabled
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const playerId = url.searchParams.get('playerId') || crypto.randomUUID();
    const gameIdParam = url.searchParams.get('gameId');

    // Upgrade to WebSocket
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Accept the WebSocket
      this.ctx.acceptWebSocket(server);

      // Determine player role
      const existingPlayers = Array.from(this.sessions.values());
      let role: PlayerRole;

      if (existingPlayers.length === 0) {
        role = 'left';
        // Use provided game ID or generate random one
        if (gameIdParam) {
          this.gameId = parseInt(gameIdParam, 10);
          if (isNaN(this.gameId) || this.gameId < 0 || this.gameId > 0xFFFFFFFF) {
            return new Response('Invalid game ID (must be 0-4294967295)', { status: 400 });
          }
        } else {
          this.gameId = Math.floor(Math.random() * 0xFFFFFFFF);
        }
        this.gameStarted = false;
      } else if (existingPlayers.length === 1) {
        role = 'right';
        // Second player must use the same game ID (already set by first player)
      } else {
        // Room is full
        return new Response('Room is full', { status: 400 });
      }

      // Store player session
      const session: PlayerSession = {
        ws: server,
        role,
        playerId,
        ready: false,
        commitments: [],
      };
      this.sessions.set(server, session);

      // Send game start message to the new player
      const gameStartMsg: GameStartMessage = {
        type: 'game_start',
        gameId: this.gameId,
        yourRole: role,
        opponentConnected: existingPlayers.length === 1,
      };
      server.send(JSON.stringify(gameStartMsg));

      // If this is the second player, notify the first player
      if (existingPlayers.length === 1) {
        const firstPlayer = existingPlayers[0];
        firstPlayer.ws.send(
          JSON.stringify({
            type: 'opponent_connected',
            gameId: this.gameId,
          })
        );
      }

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response('Expected WebSocket', { status: 400 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const msg = typeof message === 'string' ? JSON.parse(message) : null;
      if (!msg) return;

      const session = this.sessions.get(ws);
      if (!session) return;

      // Handle different message types
      switch (msg.type) {
        case 'player_ready':
          this.handlePlayerReady(session, msg as PlayerReadyMessage);
          break;

        case 'paddle_position':
          this.handlePaddlePosition(session, msg as PaddlePositionMessage);
          break;

        case 'player_log':
          this.handlePlayerLog(session, msg as PlayerLogMessage);
          break;

        default:
          console.log('Unknown message type:', msg.type);
      }
    } catch (err) {
      console.error('Error handling message:', err);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    const session = this.sessions.get(ws);
    if (session) {
      // Notify the other player
      this.sessions.forEach((otherSession, otherWs) => {
        if (otherWs !== ws) {
          otherWs.send(
            JSON.stringify({
              type: 'opponent_disconnected',
              role: session.role,
            })
          );
        }
      });
    }

    this.sessions.delete(ws);
    ws.close(1000, 'Player disconnected');

    // Reset game if all players leave
    if (this.sessions.size === 0) {
      this.gameStarted = false;
      this.gameId = 0;
    }
  }

  private handlePlayerReady(session: PlayerSession, msg: PlayerReadyMessage) {
    session.ready = true;

    // Check if both players are ready
    const players = Array.from(this.sessions.values());
    if (players.length === 2 && players.every((p) => p.ready)) {
      // Start the game
      this.gameStarted = true;
      players.forEach((p) => {
        p.ws.send(
          JSON.stringify({
            type: 'game_ready',
            gameId: this.gameId,
          })
        );
      });
    }
  }

  private handlePaddlePosition(session: PlayerSession, msg: PaddlePositionMessage) {
    // Store the commitment
    session.commitments.push(msg.commitment);

    // Add to pending event
    if (!this.pendingEvent || this.pendingEvent.eventIndex !== msg.eventIndex) {
      this.pendingEvent = { eventIndex: msg.eventIndex, [msg.role]: msg.paddleY };
    } else {
      this.pendingEvent[msg.role] = msg.paddleY;
    }

    // Check if we have both paddle positions for this event
    if (this.pendingEvent.left && this.pendingEvent.right) {
      // Event complete! Record it in canonical log
      this.events.push(this.pendingEvent.left);
      this.events.push(this.pendingEvent.right);

      console.log(`[Server] Event ${msg.eventIndex} complete:`, {
        left: this.pendingEvent.left,
        right: this.pendingEvent.right,
        totalEvents: this.events.length / 2,
      });

      this.pendingEvent = null;
    }

    // Relay paddle position to the opponent
    this.sessions.forEach((otherSession, otherWs) => {
      if (otherWs !== session.ws) {
        const relayMsg: OpponentPaddleMessage = {
          type: 'opponent_paddle',
          eventIndex: msg.eventIndex,
          paddleY: msg.paddleY,
        };
        otherWs.send(JSON.stringify(relayMsg));
      }
    });
  }

  private handlePlayerLog(session: PlayerSession, msg: PlayerLogMessage) {
    // Extract the seed from the player's log
    if (session.role === 'left') {
      session.seed = msg.log.player_left_seed;
    } else {
      session.seed = msg.log.player_right_seed;
    }

    console.log(`[Server] Received log from ${session.role} player:`, {
      seed: session.seed?.slice(0, 16) + '...',
      commitments: session.commitments.length,
    });

    // Check if both players have submitted their seeds
    const players = Array.from(this.sessions.values());
    if (players.length === 2 && players.every((p) => p.seed)) {
      // Build final log using server's canonical events and players' commitments
      const finalLog = this.buildFinalLog(players);

      console.log('[Server] Sending final log to both players:', {
        events: finalLog.events.length,
        commitments: finalLog.commitments.length,
      });

      // Send final log to both players
      players.forEach((p) => {
        const endMsg: GameEndMessage = {
          type: 'game_end',
          log: finalLog,
        };
        p.ws.send(JSON.stringify(endMsg));
      });
    }
  }

  private buildFinalLog(players: PlayerSession[]): any {
    // Build final log using:
    // - Server's canonical events (built progressively during game)
    // - Players' commitments (sent with each paddle position)
    // - Players' seeds (revealed at game end)

    const leftPlayer = players.find((p) => p.role === 'left')!;
    const rightPlayer = players.find((p) => p.role === 'right')!;

    // Interleave commitments: [leftY0_commit, rightY0_commit, leftY1_commit, rightY1_commit, ...]
    const allCommitments: string[] = [];
    const maxCommitments = Math.max(leftPlayer.commitments.length, rightPlayer.commitments.length);

    for (let i = 0; i < maxCommitments; i++) {
      if (i < leftPlayer.commitments.length) {
        allCommitments.push(leftPlayer.commitments[i]);
      }
      if (i < rightPlayer.commitments.length) {
        allCommitments.push(rightPlayer.commitments[i]);
      }
    }

    return {
      v: 1,
      game_id: this.gameId,
      events: this.events, // Use server's canonical event log
      commitments: allCommitments,
      player_left_seed: leftPlayer.seed || '',
      player_right_seed: rightPlayer.seed || '',
    };
  }
}

// Matchmaker Durable Object: Manages matchmaking queue
export class Matchmaker extends DurableObject {
  private waitingPlayer: { roomId: string; gameId: number } | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (this.waitingPlayer) {
      // We have a waiting player! Match with them
      const match = this.waitingPlayer;
      this.waitingPlayer = null;

      return new Response(
        JSON.stringify({
          roomId: match.roomId,
          gameId: match.gameId,
        }),
        {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    } else {
      // No one waiting, create a new room and wait
      const roomId = `room-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const gameId = Math.floor(Math.random() * 0xFFFFFFFF);

      this.waitingPlayer = { roomId, gameId };

      return new Response(
        JSON.stringify({
          roomId,
          gameId,
        }),
        {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }
  }
}

// Environment type
export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  MATCHMAKER: DurableObjectNamespace;
}
