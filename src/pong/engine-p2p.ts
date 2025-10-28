// P2P multiplayer version of the pong engine
// Each player runs their own engine and syncs paddle positions via WebSocket

import type { I } from './fixed'
import type { P2PGameClient, PlayerRole } from './p2p'
import { sendPaddlePosition, waitForOpponentPaddle, sendPlayerLog } from './p2p'
import {
  generateCommitmentSeed,
  computeCommitment,
  bytesToHex,
} from './commitment'
import {
  toFixed,
  fromFixed,
  iAdd,
  iSub,
  iMul,
  iDiv,
  iAbs,
  iMin,
  iMax,
  reflect1D as reflect1D_fixed,
  clampPaddleY as clampPaddleY_fixed,
  cordicSinCos,
  degToRadFixed,
  toFixedInt,
  FRAC_BITS,
} from './fixed'
import {
  MAX_EVENTS,
  WIDTH,
  HEIGHT,
  BALL_RADIUS,
  PADDLE_HEIGHT,
  PADDLE_WIDTH,
  PADDLE_MARGIN,
  PADDLE_MAX_SPEED,
  SERVE_SPEED,
  SPEED_INCREMENT,
  MAX_BOUNCE_ANGLE_DEG,
  POINTS_TO_WIN,
  INITIAL_SERVE_DIRECTION,
  ANGLE_RANGE,
  SERVE_ANGLE_MULTIPLIER,
} from './constants'

// Re-export types from engine.ts
export interface CompactLog {
  v: 1
  events: (string | number)[]
  game_id: number
  commitments: string[]
  player_left_seed: string
  player_right_seed: string
}

export interface UpdateCallbackState {
  leftScore: number
  rightScore: number
  ended: boolean
}

// Internal types
interface FixState {
  t0: I
  x: I
  y: I
  vx: I
  vy: I
  speed: I
  leftY: I
  rightY: I
  dir: -1 | 1
}

type PaddleMotion = { y0: I; t0: I; target: I }

interface EngineState {
  t0: number
  x: number
  y: number
  vx: number
  vy: number
  speed: number
  leftY: number
  rightY: number
  dir: -1 | 1
  leftScore: number
  rightScore: number
  ended: boolean
}

export interface P2PGameResult {
  cancel: () => void
  getLog: () => CompactLog
  onUpdate: (cb: (s: UpdateCallbackState) => void) => void
}

export async function runP2PGame(
  canvas: HTMLCanvasElement,
  p2pClient: P2PGameClient,
  gameId: number,
  role: PlayerRole
): Promise<P2PGameResult> {
  const ctx = canvas.getContext('2d')!

  // Generate commitment seed only for this player's paddle
  const mySeedObj = generateCommitmentSeed()
  const mySeed = mySeedObj.seed

  // Fixed-point constants
  const widthI = toFixed(WIDTH)
  const heightI = toFixed(HEIGHT)
  const ballRadiusI = toFixed(BALL_RADIUS)
  const paddleHeightI = toFixed(PADDLE_HEIGHT)
  const paddleWidthI = toFixed(PADDLE_WIDTH)
  const paddleMarginI = toFixed(PADDLE_MARGIN)
  const paddleMaxSpeedI = toFixed(PADDLE_MAX_SPEED)
  const serveSpeedI = toFixed(SERVE_SPEED)
  const speedIncrementI = toFixed(SPEED_INCREMENT)
  const maxBounceAngleI = degToRadFixed(MAX_BOUNCE_ANGLE_DEG)

  const yMinI = ballRadiusI
  const yMaxI = iSub(heightI, ballRadiusI)
  const leftFaceI = iAdd(paddleMarginI, paddleWidthI)
  const rightFaceI = iSub(widthI, iAdd(paddleMarginI, paddleWidthI))
  const centerYI = iDiv(heightI, toFixed(2))

  // Internal helper functions (copied from engine.ts)
  function serveFixed(receiverDir: -1 | 1, tStart: number, volleyCount: number): FixState {
    const entropyMix = (volleyCount + gameId) | 0
    const angleRaw = ((((entropyMix * SERVE_ANGLE_MULTIPLIER) | 0) % ANGLE_RANGE) + ANGLE_RANGE) % ANGLE_RANGE - MAX_BOUNCE_ANGLE_DEG
    const angleI = degToRadFixed(angleRaw)
    const { sin, cos } = cordicSinCos(angleI)
    const vx = iMul(serveSpeedI, iMul(cos, toFixed(receiverDir)))
    const vy = iMul(serveSpeedI, sin)
    return {
      t0: toFixed(tStart),
      x: iDiv(widthI, toFixed(2)),
      y: iDiv(heightI, toFixed(2)),
      vx,
      vy,
      speed: serveSpeedI,
      leftY: iDiv(heightI, toFixed(2)),
      rightY: iDiv(heightI, toFixed(2)),
      dir: receiverDir,
    }
  }

  function paddleYAtFixed(m: PaddleMotion, tAbsI: I): I {
    const dtI = iMax(0n as I, iSub(tAbsI, m.t0))
    const dist = iAbs(iSub(m.target, m.y0))
    const step = iMin(dist, iMul(paddleMaxSpeedI, dtI))
    const dir = iSub(m.target, m.y0) >= 0n ? 1n as I : -1n as I
    const halfI = iDiv(paddleHeightI, toFixed(2))
    return clampPaddleY_fixed(iAdd(m.y0, (step * (dir as unknown as bigint)) as unknown as I), halfI, heightI)
  }

  function planTargetsForNextEventFix(fs: FixState, eventIndex: number) {
    const tChangeI = fs.t0
    const dtToP = timeToPaddleFixed(fs)
    const tHitI = iAdd(fs.t0, dtToP)
    const yInterceptI = reflect1D_fixed(fs.y, fs.vy, iSub(tHitI, fs.t0), yMinI, yMaxI)
    const halfI = iDiv(paddleHeightI, toFixed(2))
    const paddleHeightPixels = Number(paddleHeightI >> FRAC_BITS)

    // Use deterministic seeded RNG with better entropy mixing
    // Simple hash function to mix event index and game_id thoroughly
    let hash = ((eventIndex * 1664525 + gameId * 1013904223) | 0) >>> 0
    hash = hash ^ (hash >>> 16)
    hash = (hash * 0x85ebca6b) | 0
    hash = hash ^ (hash >>> 13)

    const offsetRange = paddleHeightPixels // 80 pixels
    const offsetRaw = ((hash >>> 0) % offsetRange) | 0
    const randomOffset = offsetRaw - (paddleHeightPixels / 2) // Convert to range [-40, +40]

    const aimOffsetI = toFixedInt(Math.floor(randomOffset))
    const desiredI = clampPaddleY_fixed(iAdd(yInterceptI, aimOffsetI), halfI, heightI)
    const movingLeftNext = fs.dir < 0
    if (movingLeftNext) {
      const leftNow = paddleYAtFixed(leftM, tChangeI)
      leftM = { y0: leftNow, t0: tChangeI, target: desiredI }
      const rightNow = paddleYAtFixed(rightM, tChangeI)
      rightM = { y0: rightNow, t0: tChangeI, target: centerYI }
    } else {
      const rightNow = paddleYAtFixed(rightM, tChangeI)
      rightM = { y0: rightNow, t0: tChangeI, target: desiredI }
      const leftNow = paddleYAtFixed(leftM, tChangeI)
      leftM = { y0: leftNow, t0: tChangeI, target: centerYI }
    }
  }

  function timeToPaddleFixed(fs: FixState): I {
    if (fs.vx === 0n) {
      throw new Error('Invalid velocity: vx is zero')
    }
    const targetX = fs.dir < 0 ? iAdd(leftFaceI, ballRadiusI) : iSub(rightFaceI, ballRadiusI)
    return iDiv(iSub(targetX, fs.x), fs.vx)
  }

  function ballYatFixed(fs: FixState, tAbsI: I): I {
    const dtI = iSub(tAbsI, fs.t0)
    return reflect1D_fixed(fs.y, fs.vy, dtI, yMinI, yMaxI)
  }

  function bounceFixed(fs: FixState, paddleYI: I): { vx: I; vy: I; speed: I; dir: -1 | 1; angleI: I } {
    const halfI = iDiv(paddleHeightI, toFixed(2))
    const limit = iAdd(halfI, ballRadiusI)
    if (limit <= 0n) {
      throw new Error('Invalid paddle/ball dimensions: limit is zero or negative')
    }
    const offsetI = iMax(iSub(0n as I, limit), iMin(limit, iSub(fs.y, paddleYI)))
    const normI = iDiv(offsetI, limit)
    const angleI = iMax(iSub(0n as I, maxBounceAngleI), iMin(maxBounceAngleI, iMul(normI, maxBounceAngleI)))
    const newSpeed = iAdd(fs.speed, speedIncrementI)
    const newDir: -1 | 1 = fs.dir < 0 ? 1 : -1
    const { sin, cos } = cordicSinCos(angleI)
    const vx = iMul(newSpeed, iMul(cos, toFixed(newDir)))
    const vy = iMul(newSpeed, sin)
    return { vx, vy, speed: newSpeed, dir: newDir, angleI }
  }

  // Paddle motion timelines
  let leftM: PaddleMotion = { y0: toFixed(0), t0: toFixed(0), target: toFixed(0) }
  let rightM: PaddleMotion = { y0: toFixed(0), t0: toFixed(0), target: toFixed(0) }

  // Initialize game state with deterministic serve
  let rallyId = 0
  let fState: FixState = serveFixed(INITIAL_SERVE_DIRECTION, performance.now() / 1000, 0)
  let state: EngineState = {
    t0: fromFixed(fState.t0),
    x: fromFixed(fState.x),
    y: fromFixed(fState.y),
    vx: fromFixed(fState.vx),
    vy: fromFixed(fState.vy),
    speed: fromFixed(fState.speed),
    leftY: fromFixed(fState.leftY),
    rightY: fromFixed(fState.rightY),
    dir: fState.dir,
    leftScore: 0,
    rightScore: 0,
    ended: false,
  }

  // Initialize paddle motion
  leftM.t0 = fState.t0
  rightM.t0 = fState.t0
  leftM.y0 = fState.leftY
  rightM.y0 = fState.rightY
  leftM.target = fState.leftY
  rightM.target = fState.rightY
  planTargetsForNextEventFix(fState, 0) // Initial event

  // Partial log (only this player's paddle positions)
  const myEvents: string[] = []
  const myCommitments: string[] = []

  // Full log for replay (includes opponent positions)
  const fullEvents: string[] = []

  const listeners: Array<(s: UpdateCallbackState) => void> = []

  function notify() {
    const payload: UpdateCallbackState = {
      leftScore: state.leftScore,
      rightScore: state.rightScore,
      ended: state.ended,
    }
    listeners.forEach((cb) => cb(payload))
  }

  function onUpdate(cb: (s: UpdateCallbackState) => void) {
    listeners.push(cb)
  }

  // Advance simulation to next paddle-plane event
  async function step(): Promise<void> {
    if (state.ended) return

    // Enforce event limit
    if (fullEvents.length >= MAX_EVENTS) {
      console.warn(`[P2P] Event limit reached (${MAX_EVENTS} events). Ending game.`)
      state.ended = true
      notify()
      return
    }

    // Compute time to paddle plane
    const dtToPaddleI = timeToPaddleFixed(fState)
    const tHitI = iAdd(fState.t0, dtToPaddleI)
    const yAtHitI = ballYatFixed(fState, tHitI)
    const yAtHit = fromFixed(yAtHitI)

    // Determine paddle positions at event time (local predictions using deterministic AI)
    const movingLeft = fState.dir < 0
    const leftYAtHitI = paddleYAtFixed(leftM, tHitI)
    const rightYAtHitI = paddleYAtFixed(rightM, tHitI)

    // Compute commitment for MY paddle only
    const myPaddleY = role === 'left' ? leftYAtHitI : rightYAtHitI
    const myEventIndex = role === 'left' ? fullEvents.length : fullEvents.length + 1

    const myCommitmentStr = await computeCommitment(
      mySeed,
      myEventIndex,
      myPaddleY.toString()
    )
    myEvents.push(myPaddleY.toString())
    myCommitments.push(myCommitmentStr)

    // Send my paddle position to opponent (non-blocking)
    sendPaddlePosition(
      p2pClient,
      fullEvents.length / 2,
      myPaddleY.toString(),
      myCommitmentStr
    )

    // OPTIMISTIC PREDICTION: Use locally computed opponent paddle position
    // Both clients run identical deterministic AI, so predictions should match
    const predictedOpponentPaddleY = role === 'left' ? rightYAtHitI : leftYAtHitI

    // Use predicted paddle positions for immediate processing
    const finalLeftYI = role === 'left' ? myPaddleY : predictedOpponentPaddleY
    const finalRightYI = role === 'right' ? myPaddleY : predictedOpponentPaddleY

    // Log both paddle positions in correct order (left, right)
    fullEvents.push(finalLeftYI.toString())
    fullEvents.push(finalRightYI.toString())

    // Convert from fixed-point to float for hit detection
    const finalLeftYNum = fromFixed(finalLeftYI)
    const finalRightYNum = fromFixed(finalRightYI)

    // Use the predicted positions for hit detection
    const half = PADDLE_HEIGHT / 2
    const finalHit = movingLeft
      ? Math.abs(finalLeftYNum - yAtHit) <= half + BALL_RADIUS
      : Math.abs(finalRightYNum - yAtHit) <= half + BALL_RADIUS

    // Advance kinematics to tHit
    fState.x = movingLeft ? iAdd(leftFaceI, ballRadiusI) : iSub(rightFaceI, ballRadiusI)
    fState.y = yAtHitI
    fState.t0 = tHitI
    state.x = fromFixed(fState.x)
    state.y = fromFixed(fState.y)
    state.t0 = fromFixed(fState.t0)

    if (finalHit) {
      // Bounce - use the predicted paddle positions
      const paddleYI = movingLeft ? finalLeftYI : finalRightYI
      const { vx, vy, speed, dir } = bounceFixed(fState, paddleYI)
      fState.vx = vx
      fState.vy = vy
      fState.speed = speed
      fState.dir = dir
      state.vx = fromFixed(fState.vx)
      state.vy = fromFixed(fState.vy)
      state.speed = fromFixed(fState.speed)
      state.dir = fState.dir

      // Update paddle positions
      fState.leftY = finalLeftYI
      fState.rightY = finalRightYI
      state.leftY = finalLeftYNum
      state.rightY = finalRightYNum

      // Update paddle motion timelines
      leftM.y0 = finalLeftYI
      leftM.t0 = tHitI
      leftM.target = finalLeftYI
      rightM.y0 = finalRightYI
      rightM.t0 = tHitI
      rightM.target = finalRightYI

      // Plan next targets
      planTargetsForNextEventFix(fState, fullEvents.length)
    } else {
      // Miss: score for the opponent
      if (movingLeft) state.rightScore++
      else state.leftScore++

      // Check if game ended
      if (state.leftScore >= POINTS_TO_WIN || state.rightScore >= POINTS_TO_WIN) {
        console.log('[P2P] Game ended! Final score:', {
          leftScore: state.leftScore,
          rightScore: state.rightScore,
          totalEvents: fullEvents.length / 2,
        })
        state.ended = true
        notify()

        // Send partial log to server for merging
        const partialLog = getLog()
        sendPlayerLog(p2pClient, partialLog)

        return
      }

      // Game continues - start new serve
      const receiverDir: -1 | 1 = movingLeft ? 1 : -1
      fState = serveFixed(receiverDir, state.t0, fullEvents.length)
      fState.leftY = finalLeftYI
      fState.rightY = finalRightYI
      state = {
        t0: fromFixed(fState.t0),
        x: fromFixed(fState.x),
        y: fromFixed(fState.y),
        vx: fromFixed(fState.vx),
        vy: fromFixed(fState.vy),
        speed: fromFixed(fState.speed),
        leftY: finalLeftYNum,
        rightY: finalRightYNum,
        dir: fState.dir,
        leftScore: state.leftScore,
        rightScore: state.rightScore,
        ended: false,
      }
      rallyId++

      // Update paddle motion timelines
      leftM.y0 = finalLeftYI
      leftM.t0 = fState.t0
      leftM.target = finalLeftYI
      rightM.y0 = finalRightYI
      rightM.t0 = fState.t0
      rightM.target = finalRightYI

      // Plan targets for next serve
      planTargetsForNextEventFix(fState, fullEvents.length)
    }

    // Background verification: wait for opponent paddle and verify it matches prediction
    const eventIndex = (fullEvents.length / 2) - 1
    waitForOpponentPaddle(p2pClient, eventIndex, 15000)
      .then((opponentPaddleY) => {
        const predictedStr = predictedOpponentPaddleY.toString()
        if (opponentPaddleY !== predictedStr) {
          console.warn('[P2P] DESYNC WARNING: Opponent paddle mismatch!', {
            eventIndex,
            predicted: predictedStr,
            received: opponentPaddleY,
          })
        }
      })
      .catch(() => {
        // Timeout - opponent may have finished game
      })

    notify()
  }

  // Animation loop
  let rafId = 0
  let eventInProgress = false

  async function render() {
    if (state.ended) return
    const now = performance.now() / 1000
    const tHit = fromFixed(iAdd(fState.t0, timeToPaddleFixed(fState)))

    if (now >= tHit - 1e-4 && !eventInProgress) {
      eventInProgress = true
      // Fire step() asynchronously without blocking render loop
      step().then(() => {
        eventInProgress = false
      }).catch((err) => {
        console.error('[P2P] Error in step():', err)
        eventInProgress = false
      })
    }

    draw(now)
    rafId = requestAnimationFrame(render)
  }

  function draw(tAbs: number) {
    ctx.clearRect(0, 0, WIDTH, HEIGHT)

    // Midline
    ctx.strokeStyle = '#333'
    ctx.beginPath()
    ctx.setLineDash([6, 6])
    ctx.moveTo(WIDTH / 2, 0)
    ctx.lineTo(WIDTH / 2, HEIGHT)
    ctx.stroke()
    ctx.setLineDash([])

    // Paddles (highlight player's paddle)
    const tAbsI2 = toFixed(tAbs)
    const leftYNow = fromFixed(paddleYAtFixed(leftM, tAbsI2))
    const rightYNow = fromFixed(paddleYAtFixed(rightM, tAbsI2))
    const half = PADDLE_HEIGHT / 2

    // Left paddle
    ctx.fillStyle = role === 'left' ? '#0f0' : '#0a0'
    ctx.fillRect(PADDLE_MARGIN, leftYNow - half, PADDLE_WIDTH, PADDLE_HEIGHT)

    // Right paddle
    ctx.fillStyle = role === 'right' ? '#0f0' : '#0a0'
    ctx.fillRect(WIDTH - PADDLE_MARGIN - PADDLE_WIDTH, rightYNow - half, PADDLE_WIDTH, PADDLE_HEIGHT)

    // Ball
    const tAbsI = toFixed(tAbs)
    const dtI = iSub(tAbsI, fState.t0)
    const bx = fromFixed(iAdd(fState.x, iMul(fState.vx, dtI)))
    const by = fromFixed(reflect1D_fixed(fState.y, fState.vy, dtI, yMinI, yMaxI))
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(bx, by, BALL_RADIUS, 0, Math.PI * 2)
    ctx.fill()

    // Score
    ctx.fillStyle = '#fff'
    ctx.font = '16px sans-serif'
    ctx.fillText(`${state.leftScore}`, WIDTH * 0.25, 24)
    ctx.fillText(`${state.rightScore}`, WIDTH * 0.75, 24)

    // Role indicator
    ctx.font = '12px sans-serif'
    ctx.fillStyle = '#888'
    ctx.fillText(`You: ${role.toUpperCase()}`, WIDTH / 2 - 30, HEIGHT - 10)
  }

  function cancel() {
    if (rafId) cancelAnimationFrame(rafId)
  }

  // Start rendering
  draw(performance.now() / 1000)
  rafId = requestAnimationFrame(render)

  function getLog(): CompactLog {
    // Return log with complete events (both players) but only our commitments
    // The server will merge commitments from both players
    const log: any = {
      v: 1,
      game_id: gameId,
      events: fullEvents, // Full interleaved events [leftY0, rightY0, leftY1, rightY1, ...]
      commitments: myCommitments, // Only our commitments
      role, // Tell server which role we are
    }

    // Set the appropriate seed field
    if (role === 'left') {
      log.player_left_seed = bytesToHex(mySeed)
      log.player_right_seed = ''
    } else {
      log.player_left_seed = ''
      log.player_right_seed = bytesToHex(mySeed)
    }

    return log
  }

  function onUpdateWrapper(cb: (s: UpdateCallbackState) => void) {
    onUpdate(cb)
  }

  return { cancel, getLog, onUpdate: onUpdateWrapper }
}
