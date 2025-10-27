// P2P multiplayer Pong client using WebSocket for coordination

export type PlayerRole = 'left' | 'right'

export interface P2PConfig {
  serverUrl: string
  roomId: string
  playerId: string
  gameId?: number // Optional: specify game ID for deterministic serve angles
}

export interface GameStartMessage {
  type: 'game_start'
  gameId: number
  yourRole: PlayerRole
  opponentConnected: boolean
}

export interface OpponentConnectedMessage {
  type: 'opponent_connected'
  gameId: number
}

export interface GameReadyMessage {
  type: 'game_ready'
  gameId: number
}

export interface OpponentPaddleMessage {
  type: 'opponent_paddle'
  eventIndex: number
  paddleY: string
}

export interface GameEndMessage {
  type: 'game_end'
  log: any
}

export interface OpponentDisconnectedMessage {
  type: 'opponent_disconnected'
  role: PlayerRole
}

export type ServerMessage =
  | GameStartMessage
  | OpponentConnectedMessage
  | GameReadyMessage
  | OpponentPaddleMessage
  | GameEndMessage
  | OpponentDisconnectedMessage

export interface P2PGameClient {
  ws: WebSocket
  role: PlayerRole | null
  gameId: number | null
  opponentConnected: boolean
  gameReady: boolean
  pendingOpponentPaddles: Map<number, string> // eventIndex -> paddleY
  onGameStart: ((gameId: number, role: PlayerRole, opponentConnected: boolean) => void) | null
  onOpponentConnected: (() => void) | null
  onGameReady: (() => void) | null
  onOpponentPaddle: ((eventIndex: number, paddleY: string) => void) | null
  onGameEnd: ((log: any) => void) | null
  onOpponentDisconnected: (() => void) | null
  onConnectionError: ((error: Error) => void) | null
}

export function createP2PClient(config: P2PConfig): P2PGameClient {
  let wsUrl = `${config.serverUrl}/game?room=${encodeURIComponent(config.roomId)}&playerId=${encodeURIComponent(config.playerId)}`
  if (config.gameId !== undefined) {
    wsUrl += `&gameId=${config.gameId}`
  }
  const ws = new WebSocket(wsUrl)

  const client: P2PGameClient = {
    ws,
    role: null,
    gameId: null,
    opponentConnected: false,
    gameReady: false,
    pendingOpponentPaddles: new Map(),
    onGameStart: null,
    onOpponentConnected: null,
    onGameReady: null,
    onOpponentPaddle: null,
    onGameEnd: null,
    onOpponentDisconnected: null,
    onConnectionError: null,
  }

  ws.onopen = () => {
    console.log('[P2P] Connected to server')
  }

  ws.onmessage = (event) => {
    try {
      const msg: ServerMessage = JSON.parse(event.data)
      console.log('[P2P] Received:', msg.type, msg)

      switch (msg.type) {
        case 'game_start':
          client.role = msg.yourRole
          client.gameId = msg.gameId
          client.opponentConnected = msg.opponentConnected
          if (client.onGameStart) {
            client.onGameStart(msg.gameId, msg.yourRole, msg.opponentConnected)
          }
          break

        case 'opponent_connected':
          client.opponentConnected = true
          client.gameId = msg.gameId
          if (client.onOpponentConnected) {
            client.onOpponentConnected()
          }
          break

        case 'game_ready':
          client.gameReady = true
          if (client.onGameReady) {
            client.onGameReady()
          }
          break

        case 'opponent_paddle':
          // Store opponent paddle position
          client.pendingOpponentPaddles.set(msg.eventIndex, msg.paddleY)
          if (client.onOpponentPaddle) {
            client.onOpponentPaddle(msg.eventIndex, msg.paddleY)
          }
          break

        case 'game_end':
          if (client.onGameEnd) {
            client.onGameEnd(msg.log)
          }
          break

        case 'opponent_disconnected':
          client.opponentConnected = false
          if (client.onOpponentDisconnected) {
            client.onOpponentDisconnected()
          }
          break

        default:
          console.warn('[P2P] Unknown message type:', (msg as any).type)
      }
    } catch (err) {
      console.error('[P2P] Error handling message:', err)
    }
  }

  ws.onerror = (event) => {
    console.error('[P2P] WebSocket error:', event)
    if (client.onConnectionError) {
      client.onConnectionError(new Error('WebSocket connection error'))
    }
  }

  ws.onclose = () => {
    console.log('[P2P] Disconnected from server')
  }

  return client
}

export function sendPlayerReady(client: P2PGameClient) {
  if (!client.gameId) {
    console.error('[P2P] Cannot send ready: no game ID')
    return
  }
  client.ws.send(JSON.stringify({
    type: 'player_ready',
    gameId: client.gameId,
  }))
}

export function sendPaddlePosition(
  client: P2PGameClient,
  eventIndex: number,
  paddleY: string,
  commitment: string
) {
  if (!client.role) {
    console.error('[P2P] Cannot send paddle position: no role assigned')
    return
  }
  client.ws.send(JSON.stringify({
    type: 'paddle_position',
    role: client.role,
    eventIndex,
    paddleY,
    commitment,
  }))
}

export function sendPlayerLog(client: P2PGameClient, log: any) {
  client.ws.send(JSON.stringify({
    type: 'player_log',
    log,
  }))
}

export function waitForOpponentPaddle(
  client: P2PGameClient,
  eventIndex: number,
  timeoutMs: number = 15000
): Promise<string> {
  // Check if we already have it
  const cached = client.pendingOpponentPaddles.get(eventIndex)
  if (cached) {
    client.pendingOpponentPaddles.delete(eventIndex)
    return Promise.resolve(cached)
  }

  // Wait for it to arrive
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Timeout waiting for opponent paddle at event ${eventIndex}`))
    }, timeoutMs)

    const handler = (idx: number, paddleY: string) => {
      if (idx === eventIndex) {
        cleanup()
        resolve(paddleY)
      }
    }

    const cleanup = () => {
      clearTimeout(timeout)
      if (client.onOpponentPaddle === handler) {
        client.onOpponentPaddle = null
      }
    }

    client.onOpponentPaddle = handler
  })
}

export function closeConnection(client: P2PGameClient) {
  client.ws.close()
}
