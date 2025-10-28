import './style.css'
import { runGame, validateLog, replayLog } from './pong/engine'
import { runP2PGame } from './pong/engine-p2p'
import { createP2PClient, sendPlayerReady, sendPlayerLog, closeConnection, type P2PGameClient } from './pong/p2p'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div style="display:flex; gap:16px; align-items:flex-start;">
    <div>
      <div style="margin-bottom:8px; padding:8px; border:1px solid #555; background:#222;">
        <div style="margin-bottom:8px;">
          <label style="color:#fff; margin-right:16px;">
            <input type="radio" name="mode" value="single" checked /> Single Player
          </label>
          <label style="color:#fff;">
            <input type="radio" name="mode" value="p2p" /> P2P Multiplayer
          </label>
        </div>
        <div id="p2p-controls" style="display:none;">
          <div style="display:flex; gap:8px; margin-bottom:8px;">
            <button id="quick-match" style="flex:1; padding:8px; font-weight:bold;">Find Match</button>
          </div>
          <div id="p2p-status" style="color:#888; font-size:12px;">Click "Find Match" to play</div>
        </div>
      </div>
      <canvas id="canvas" width="800" height="480" style="border:1px solid #ccc; background:#111"></canvas>
      <div style="margin-top:8px; display:flex; gap:8px; align-items:center;">
        <button id="start">Start Match</button>
        <button id="validate" disabled>Validate Log</button>
        <button id="replay" disabled>Replay Match</button>
        <button id="download" disabled>Download Log</button>
        <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
          <span style="padding:4px 8px; border:1px solid #555; color:#fff;">Upload Log</span>
          <input id="upload" type="file" accept="application/json" style="display:none" />
        </label>
        <span id="score" style="color:#fff;">Score: 0 - 0</span>
      </div>
    </div>
    <div style="flex:1;">
      <h3>Match Log</h3>
      <textarea id="log" style="width:100%; min-width:200px; height:420px; white-space:pre; overflow-x:auto;"></textarea>
      <div style="margin-top:8px; display:flex; gap:8px; align-items:center;">
        <button id="zkp-verify" disabled>ZKP Verify</button>
        <span id="zkp-status" style="color:#888; font-size:12px;">Checking server...</span>
      </div>
    </div>
  </div>
`

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const startBtn = document.getElementById('start') as HTMLButtonElement
const validateBtn = document.getElementById('validate') as HTMLButtonElement
const replayBtn = document.getElementById('replay') as HTMLButtonElement
const downloadBtn = document.getElementById('download') as HTMLButtonElement
const uploadInput = document.getElementById('upload') as HTMLInputElement
const scoreSpan = document.getElementById('score') as HTMLSpanElement
const logArea = document.getElementById('log') as HTMLTextAreaElement
const zkpVerifyBtn = document.getElementById('zkp-verify') as HTMLButtonElement
const zkpStatusSpan = document.getElementById('zkp-status') as HTMLSpanElement

// P2P controls
const modeRadios = document.querySelectorAll('input[name="mode"]') as NodeListOf<HTMLInputElement>
const p2pControlsDiv = document.getElementById('p2p-controls') as HTMLDivElement
const quickMatchBtn = document.getElementById('quick-match') as HTMLButtonElement
const p2pStatusSpan = document.getElementById('p2p-status') as HTMLSpanElement

let currentCancel: (() => void) | null = null
let currentLog: any = null
let serverHealthy = false
let gameMode: 'single' | 'p2p' = 'single'
let p2pClient: P2PGameClient | null = null
let p2pReady = false

// Get API URL from environment variable
const API_URL = import.meta.env.VITE_RISC0_API_URL
// Get WebSocket server URL (default to local dev server)
const WS_URL = import.meta.env.VITE_WS_SERVER_URL || 'ws://localhost:8787'

// Check server health on page load
async function checkServerHealth() {
  try {
    const response = await fetch(`${API_URL}/health`)
    if (response.ok) {
      const data = await response.json()
      if (data.status === 'healthy') {
        serverHealthy = true
        zkpStatusSpan.textContent = 'Server ready'
        zkpStatusSpan.style.color = '#0a0'
        updateZkpButtonState()
        return
      }
    }
  } catch (e) {
    // Fall through to error state
  }
  zkpStatusSpan.textContent = 'Server unavailable'
  zkpStatusSpan.style.color = '#a00'
}

// Update ZKP button state based on server health and log availability
function updateZkpButtonState() {
  zkpVerifyBtn.disabled = !(serverHealthy && currentLog)
}

// Call health check on load
checkServerHealth()

// Helper to pretty-print log with proper field order
function formatLog(log: any): string {
  const ordered = {
    v: log.v,
    game_id: log.game_id,
    events: log.events,
    commitments: log.commitments,
    player_left_seed: log.player_left_seed,
    player_right_seed: log.player_right_seed
  }
  return JSON.stringify(ordered, null, 2)
}

// Mode switching
modeRadios.forEach(radio => {
  radio.onchange = () => {
    gameMode = (radio as HTMLInputElement).value as 'single' | 'p2p'
    p2pControlsDiv.style.display = gameMode === 'p2p' ? 'block' : 'none'
    startBtn.disabled = gameMode === 'p2p' && !p2pReady
  }
})

// P2P Quick Match
quickMatchBtn.onclick = async () => {
  p2pStatusSpan.textContent = 'Finding match...'
  p2pStatusSpan.style.color = '#fa0'
  quickMatchBtn.disabled = true

  try {
    // Request matchmaking from server
    const response = await fetch(`${WS_URL}/matchmaking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`Matchmaking failed: ${response.statusText}`)
    }

    const { roomId, gameId } = await response.json()

    p2pStatusSpan.textContent = 'Match found! Connecting...'

    // Connect to assigned room
    p2pClient = createP2PClient({
      serverUrl: WS_URL,
      roomId,
      playerId: `player-${Date.now()}`,
      gameId,
    })

    p2pClient.onGameStart = (_gameId, role, opponentConnected) => {
      p2pStatusSpan.textContent = `Playing as ${role.toUpperCase()} player${opponentConnected ? ' - Ready!' : ' - Waiting for opponent...'}`
      p2pStatusSpan.style.color = opponentConnected ? '#0a0' : '#fa0'
      p2pReady = opponentConnected
      startBtn.disabled = !p2pReady
    }

    p2pClient.onOpponentConnected = () => {
      p2pStatusSpan.textContent = 'Opponent ready! Starting soon...'
      p2pStatusSpan.style.color = '#0a0'
      p2pReady = true
      startBtn.disabled = false
    }

    p2pClient.onGameEnd = (log) => {
      currentLog = log
      logArea.value = formatLog(log)
      validateBtn.disabled = false
      replayBtn.disabled = false
      downloadBtn.disabled = false
      updateZkpButtonState()
      quickMatchBtn.disabled = false

      // Update status to show success
      p2pStatusSpan.textContent = 'Game complete! Ready for new match'
      p2pStatusSpan.style.color = '#0a0'

      // Close websocket connection - new game will create new connection
      if (p2pClient) {
        closeConnection(p2pClient)
      }
    }

    p2pClient.onOpponentDisconnected = () => {
      p2pStatusSpan.textContent = 'Opponent disconnected'
      p2pStatusSpan.style.color = '#a00'
      p2pReady = false
      startBtn.disabled = true
      quickMatchBtn.disabled = false
    }

    p2pClient.onConnectionError = (error) => {
      p2pStatusSpan.textContent = `Connection error: ${error.message}`
      p2pStatusSpan.style.color = '#a00'
      p2pReady = false
      startBtn.disabled = true
      quickMatchBtn.disabled = false
    }
  } catch (error) {
    p2pStatusSpan.textContent = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    p2pStatusSpan.style.color = '#a00'
    quickMatchBtn.disabled = false
  }
}

startBtn.onclick = async () => {
  if (currentCancel) {
    currentCancel()
    currentCancel = null
  }

  // Clear the log area when starting a new match
  logArea.value = ''
  currentLog = null

  if (gameMode === 'single') {
    // Single player mode
    const { cancel, onUpdate, getLog } = await runGame(canvas)

    currentCancel = cancel
    validateBtn.disabled = true
    replayBtn.disabled = true
    downloadBtn.disabled = true
    updateZkpButtonState()
    scoreSpan.textContent = 'Score: 0 - 0'

    onUpdate((state) => {
      scoreSpan.textContent = `Score: ${state.leftScore} - ${state.rightScore}`
      if (state.ended) {
        currentLog = getLog()
        logArea.value = formatLog(currentLog)
        validateBtn.disabled = false
        replayBtn.disabled = false
        downloadBtn.disabled = false
        updateZkpButtonState()
        currentCancel = null
      }
    })
  } else if (gameMode === 'p2p' && p2pClient && p2pReady) {
    // P2P multiplayer mode
    if (!p2pClient.gameId || !p2pClient.role) {
      alert('Not ready for P2P game')
      return
    }

    // Send ready signal
    sendPlayerReady(p2pClient)
    p2pStatusSpan.textContent = 'Waiting for opponent to be ready...'

    // Wait for game_ready message
    const gameReadyPromise = new Promise<void>((resolve) => {
      p2pClient!.onGameReady = () => {
        p2pStatusSpan.textContent = 'Game starting!'
        p2pStatusSpan.style.color = '#0a0'
        resolve()
      }
    })

    await gameReadyPromise

    const { cancel, onUpdate, getLog } = await runP2PGame(
      canvas,
      p2pClient,
      p2pClient.gameId,
      p2pClient.role
    )

    currentCancel = cancel
    validateBtn.disabled = true
    replayBtn.disabled = true
    downloadBtn.disabled = true
    updateZkpButtonState()
    scoreSpan.textContent = 'Score: 0 - 0'

    onUpdate((state) => {
      scoreSpan.textContent = `Score: ${state.leftScore} - ${state.rightScore}`
      if (state.ended) {
        // Send partial log to server for merging
        const partialLog = getLog()
        sendPlayerLog(p2pClient!, partialLog)
        p2pStatusSpan.textContent = 'Game ended - waiting for merged log...'
        p2pStatusSpan.style.color = '#fa0'
        currentCancel = null
      }
    })
  }
}

validateBtn.onclick = async () => {
  try {
    const parsed = JSON.parse(logArea.value)
    const result = await validateLog(parsed)
    alert(`Fair: ${result.fair}\nReason: ${result.reason ?? '(none)'}\nFinal Score: ${result.leftScore} - ${result.rightScore}`)
  } catch (e) {
    alert('Invalid log JSON')
  }
}

downloadBtn.onclick = () => {
  try {
    const text = logArea.value.trim()
    if (!text) {
      alert('No log to download')
      return
    }
    const parsed = JSON.parse(text)
    const eventCount = Array.isArray(parsed?.events) ? Math.floor(parsed.events.length / 2) : 'n'
    const fname = `pong-log_events${eventCount}_${Date.now()}.json`
    // Use formatLog to ensure consistent field order in downloaded file
    const blob = new Blob([formatLog(parsed)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fname
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    alert('Invalid log JSON — cannot download')
  }
}

replayBtn.onclick = () => {
  try {
    const parsed = JSON.parse(logArea.value)

    // Cancel any current game or replay
    if (currentCancel) {
      currentCancel()
      currentCancel = null
    }

    // Start replay
    const { cancel, onUpdate } = replayLog(canvas, parsed)
    currentCancel = cancel
    scoreSpan.textContent = 'Score: 0 - 0'

    onUpdate((state) => {
      scoreSpan.textContent = `Score: ${state.leftScore} - ${state.rightScore}`
      if (state.ended) {
        currentCancel = null
      }
    })
  } catch (e) {
    alert('Invalid log JSON')
  }
}

uploadInput.onchange = async () => {
  const file = uploadInput.files && uploadInput.files[0]
  if (!file) return
  try {
    const text = await file.text()
    const parsed = JSON.parse(text)
    currentLog = parsed
    logArea.value = formatLog(parsed)
    validateBtn.disabled = false
    replayBtn.disabled = false
    downloadBtn.disabled = false
    updateZkpButtonState()
    // Optionally show score from the uploaded log
    const res = await validateLog(parsed)
    scoreSpan.textContent = `Score: ${res.leftScore} - ${res.rightScore}`
  } catch (e) {
    alert('Failed to read/parse uploaded log')
  } finally {
    uploadInput.value = ''
  }
}

zkpVerifyBtn.onclick = async () => {
  if (!currentLog) {
    alert('No log available')
    return
  }

  try {
    zkpVerifyBtn.disabled = true
    zkpStatusSpan.textContent = 'Generating proof...'
    zkpStatusSpan.style.color = '#fa0'

    // Call /api/prove with groth16 format
    const proveResponse = await fetch(`${API_URL}/api/prove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        log: currentLog,
        receipt_kind: 'groth16'
      })
    })

    const proveData = await proveResponse.json()

    if (!proveData.success || !proveData.proof) {
      throw new Error(proveData.error || 'Failed to generate proof')
    }

    zkpStatusSpan.textContent = 'Verifying proof...'

    // Call /api/verify
    const verifyResponse = await fetch(`${API_URL}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proof: proveData.proof
      })
    })

    const verifyData = await verifyResponse.json()

    if (!verifyData.success || !verifyData.is_valid) {
      throw new Error(verifyData.error || 'Verification failed')
    }

    zkpStatusSpan.textContent = 'Server ready'
    zkpStatusSpan.style.color = '#0a0'

    alert(
      `ZKP Verification Successful!\n\n` +
      `Fair: ${verifyData.fair}\n` +
      `Game ID: ${verifyData.game_id}\n` +
      `Final Score: ${verifyData.left_score} - ${verifyData.right_score}`
    )
  } catch (e) {
    zkpStatusSpan.textContent = 'Verification error'
    zkpStatusSpan.style.color = '#a00'
    alert(`ZKP Verification Failed:\n${e instanceof Error ? e.message : String(e)}`)
  } finally {
    updateZkpButtonState()
  }
}
