// Deterministic, event-driven Pong engine with compact logging and validation.
// Integer (fixed-point) kinematics for perfect determinism.

import type { I } from './fixed'
import {
  generateCommitmentSeed,
  computeCommitment,
  bytesToHex,
  hexToBytes,
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

type NumberLike = string | number

export interface CompactLog {
  v: 1
  // Flat array of paddle pairs per event: [l0, r0, l1, r1, ...]
  events: NumberLike[]
  // Unique game identifier (u32 integer) - used for serve angle entropy and replay protection
  game_id: number
  // SHA-256 commitments for each event (hex-encoded, 32 bytes each)
  commitments: string[]
  // Revealed seed for left player (hex-encoded, 32 bytes)
  player_left_seed: string
  // Revealed seed for right player (hex-encoded, 32 bytes)
  player_right_seed: string
}

export interface ValidateResult {
  fair: boolean
  reason?: string
  leftScore: number
  rightScore: number
}

interface EngineState {
  t0: number
  x: number
  y: number
  vx: number
  vy: number
  speed: number
  leftY: number
  rightY: number
  // Which side the ball is moving toward: -1 left, +1 right
  dir: -1 | 1
  leftScore: number
  rightScore: number
  ended: boolean
}

// Fixed-point mirror of the kinematic state used for all physics.
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

interface UpdateCallbackState {
  leftScore: number
  rightScore: number
  ended: boolean
}

export async function runGame(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!

  // Generate random commitment seeds for both players
  const playerLeftCommitment = generateCommitmentSeed()
  const playerRightCommitment = generateCommitmentSeed()

  // Fixed constants
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

  // Generate unique game ID for this game session (random u32)
  // This provides per-game entropy for serve angles, preventing predictability
  function generateGameId(): number {
    return Math.floor(Math.random() * 0xFFFFFFFF)
  }

  const gameId = generateGameId()

  // Serve towards receiverDir (-1 means serve heading left, 1 means serve heading right)
  // Angle determined by volley count + game_id for deterministic but unpredictable variation
  function serveFixed(receiverDir: -1 | 1, tStart: number, volleyCount: number): FixState {
    // Mix game_id with volley count for serve angle
    const entropyMix = (volleyCount + gameId) | 0
    // Use proper modulo to ensure positive remainder (JavaScript % can return negative values)
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

  // Paddle motion model: analytic movement toward a target at max speed.
  type PaddleMotion = { y0: I; t0: I; target: I }
  const centerYI = iDiv(heightI, toFixed(2))
  let leftM: PaddleMotion = { y0: centerYI, t0: 0n as I, target: centerYI }
  let rightM: PaddleMotion = { y0: centerYI, t0: 0n as I, target: centerYI }

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
      // advance paddles to tChangeI and set targets
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

  // Compute time to reach the next paddle plane along x, ignoring walls for y (we reflect y analytically).
  function timeToPaddleFixed(fs: FixState): I {
    // Guard against division by zero (should never happen with valid physics)
    if (fs.vx === 0n) {
      throw new Error('Invalid velocity: vx is zero')
    }
    const targetX = fs.dir < 0 ? iAdd(leftFaceI, ballRadiusI) : iSub(rightFaceI, ballRadiusI)
    return iDiv(iSub(targetX, fs.x), fs.vx)
  }

  // Ball y at time t since state.t0 using reflection.
  function ballYatFixed(fs: FixState, tAbsI: I): I {
    const dtI = iSub(tAbsI, fs.t0)
    return reflect1D_fixed(fs.y, fs.vy, dtI, yMinI, yMaxI)
  }

  // Constrain paddle center within board.
  // (unused float clamp removed; using fixed clamp only)

  // Determine bounce off paddle: set new vx,vy, speed increased.
  // Bounce reflection - angle determined purely by paddle position (no jitter)
  function bounceFixed(fs: FixState, paddleYI: I): { vx: I; vy: I; speed: I; dir: -1 | 1; angleI: I } {
    const halfI = iDiv(paddleHeightI, toFixed(2))
    const limit = iAdd(halfI, ballRadiusI)

    // Guard against division by zero (should be prevented by config validation)
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

  // Renderer uses analytical positions; we only change kinematics at event times.
  // Add a rally counter to align GAME vs VALIDATE logs.
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
  // Initialize paddle motion timelines and plan the first intercept.
  leftM.t0 = fState.t0
  rightM.t0 = fState.t0
  leftM.y0 = fState.leftY
  rightM.y0 = fState.rightY
  leftM.target = fState.leftY
  rightM.target = fState.rightY
  planTargetsForNextEventFix(fState, 0) // Initial event

  const log: CompactLog = {
    v: 1,
    events: [],
    game_id: gameId,
    commitments: [],
    player_left_seed: bytesToHex(playerLeftCommitment.seed),
    player_right_seed: bytesToHex(playerRightCommitment.seed),
  }
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

  // Advance simulation to next paddle-plane event.
  async function step(): Promise<void> {
    if (state.ended) return

    // Enforce event limit to match prover's MAX_EVENTS constraint
    if (log.events.length >= MAX_EVENTS) {
      console.warn(`Event limit reached (${MAX_EVENTS} events). Ending game to prevent prover rejection.`)
      state.ended = true
      notify()
      return
    }

    // Compute absolute time when ball hits the paddle plane.
    const dtToPaddleI = timeToPaddleFixed(fState)
    const tHitI = iAdd(fState.t0, dtToPaddleI)
    // Compute ball y at hit time via reflection.
    const yAtHitI = ballYatFixed(fState, tHitI)
    const yAtHit = fromFixed(yAtHitI)

    // Determine positions of both paddles at event time from their motion.
    const movingLeft = fState.dir < 0
    const leftYAtHitI = paddleYAtFixed(leftM, tHitI)
    const rightYAtHitI = paddleYAtFixed(rightM, tHitI)
    const leftYAtHit = fromFixed(leftYAtHitI)
    const rightYAtHit = fromFixed(rightYAtHitI)
    const half = PADDLE_HEIGHT / 2
    const hit = movingLeft
      ? Math.abs(leftYAtHit - yAtHit) <= half + BALL_RADIUS
      : Math.abs(rightYAtHit - yAtHit) <= half + BALL_RADIUS

    // Compute commitments and log both paddle positions at impact/miss time
    // Left player commits their position (even index)
    const leftEventIndex = log.events.length
    const leftCommitment = await computeCommitment(
      playerLeftCommitment.seed,
      leftEventIndex,
      leftYAtHitI.toString()
    )
    log.events.push(leftYAtHitI.toString())
    log.commitments.push(leftCommitment)

    // Right player commits their position (odd index)
    const rightEventIndex = log.events.length
    const rightCommitment = await computeCommitment(
      playerRightCommitment.seed,
      rightEventIndex,
      rightYAtHitI.toString()
    )
    log.events.push(rightYAtHitI.toString())
    log.commitments.push(rightCommitment)

    // Advance kinematics to tHit
    fState.x = movingLeft ? iAdd(leftFaceI, ballRadiusI) : iSub(rightFaceI, ballRadiusI)
    fState.y = yAtHitI
    fState.t0 = tHitI
    state.x = fromFixed(fState.x)
    state.y = fromFixed(fState.y)
    state.t0 = fromFixed(fState.t0)

    if (hit) {
      // Bounce
      const paddleYI = toFixed(movingLeft ? leftYAtHit : rightYAtHit)
      const { vx, vy, speed, dir } = bounceFixed(fState, paddleYI)
      fState.vx = vx
      fState.vy = vy
      fState.speed = speed
      fState.dir = dir
      state.vx = fromFixed(fState.vx)
      state.vy = fromFixed(fState.vy)
      state.speed = fromFixed(fState.speed)
      state.dir = fState.dir
      // Update state paddle positions for bookkeeping
      fState.leftY = toFixed(leftYAtHit)
      fState.rightY = toFixed(rightYAtHit)
      state.leftY = leftYAtHit
      state.rightY = rightYAtHit
      // Plan next targets: hitter re-centers, opponent aims for intercept
      planTargetsForNextEventFix(fState, log.events.length)
    } else {
      // Miss: score for the opponent
      if (movingLeft) state.rightScore++
      else state.leftScore++
      // End match?
      if (state.leftScore >= POINTS_TO_WIN || state.rightScore >= POINTS_TO_WIN) {
        state.ended = true
        notify()
        // Draw final frame with updated score
        draw(performance.now() / 1000)
        return
      }
      // Serve toward the player who just received the point (the scorer)
      const receiverDir: -1 | 1 = movingLeft ? 1 : -1
      fState = serveFixed(receiverDir, state.t0, log.events.length)
      fState.leftY = toFixed(leftYAtHit)
      fState.rightY = toFixed(rightYAtHit)
      state = {
        t0: fromFixed(fState.t0),
        x: fromFixed(fState.x),
        y: fromFixed(fState.y),
        vx: fromFixed(fState.vx),
        vy: fromFixed(fState.vy),
        speed: fromFixed(fState.speed),
        leftY: leftYAtHit,
        rightY: rightYAtHit,
        dir: fState.dir,
        leftScore: state.leftScore,
        rightScore: state.rightScore,
        ended: false,
      }
      rallyId++
      // On serve, set receiver target to intercept, other to center
      planTargetsForNextEventFix(fState, log.events.length)
    }

    notify()
  }

  // Animation: uses analytical positions between events; triggers steps as we reach event times.
  // CRITICAL: This uses performance.now() which is NOT deterministic
  // However, this only affects WHEN step() is called, not WHAT step() does
  // The step() function itself is purely deterministic (fixed-point math with deterministic serve angles)
  // Rendering converts fixed-point to float for display only - never logged
  let rafId = 0
  let stepping = false
  async function render() {
    if (state.ended) return
    const now = performance.now() / 1000 // ← Non-deterministic timing (OK - not logged)
    // Next paddle impact time
    const tHit = fromFixed(iAdd(fState.t0, timeToPaddleFixed(fState)))
    // If we are past the event time (or very near), perform the step and continue.
    if (now >= tHit - 1e-4 && !stepping) {
      stepping = true
      await step() // ← Deterministic update (fixed-point math) + signing
      stepping = false
    }
    // Draw current frame at time now
    draw(now) // ← Non-deterministic rendering (OK - not logged)
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

    // Paddles
    ctx.fillStyle = '#0f0'
    const half = PADDLE_HEIGHT / 2
    const tAbsI2 = toFixed(tAbs)
    const leftYNow = fromFixed(paddleYAtFixed(leftM, tAbsI2))
    const rightYNow = fromFixed(paddleYAtFixed(rightM, tAbsI2))
    // Left
    ctx.fillRect(
      PADDLE_MARGIN,
      leftYNow - half,
      PADDLE_WIDTH,
      PADDLE_HEIGHT
    )
    // Right
    ctx.fillRect(
      WIDTH - PADDLE_MARGIN - PADDLE_WIDTH,
      rightYNow - half,
      PADDLE_WIDTH,
      PADDLE_HEIGHT
    )

    // Ball position at tAbs using analytical reflection
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
  }

  function cancel() {
    if (rafId) cancelAnimationFrame(rafId)
  }

  // Kickoff
  draw(performance.now() / 1000)
  rafId = requestAnimationFrame(render)

  function getLog(): CompactLog {
    return log
  }

  function onUpdateWrapper(cb: (s: UpdateCallbackState) => void) {
    onUpdate(cb)
  }

  return { cancel, getLog, onUpdate: onUpdateWrapper }
}

// ================= Replay =================

export function replayLog(canvas: HTMLCanvasElement, log: CompactLog) {
  const ctx = canvas.getContext('2d')!

  // Fixed constants (same as runGame)
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

  const gameId = log.game_id

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

  function timeToPaddleFixed(fs: FixState): I {
    if (fs.vx === 0n) {
      throw new Error('Invalid velocity: vx is zero')
    }
    const targetX = fs.dir < 0 ? iAdd(leftFaceI, ballRadiusI) : iSub(rightFaceI, ballRadiusI)
    return iDiv(iSub(targetX, fs.x), fs.vx)
  }

  // Paddle motion model
  type PaddleMotion = { y0: I; t0: I; target: I }
  const centerYI = iDiv(heightI, toFixed(2))
  let leftM: PaddleMotion = { y0: centerYI, t0: 0n as I, target: centerYI }
  let rightM: PaddleMotion = { y0: centerYI, t0: 0n as I, target: centerYI }

  function paddleYAtFixed(m: PaddleMotion, tAbsI: I): I {
    const dtI = iMax(0n as I, iSub(tAbsI, m.t0))
    const dist = iAbs(iSub(m.target, m.y0))
    const step = iMin(dist, iMul(paddleMaxSpeedI, dtI))
    const dir = iSub(m.target, m.y0) >= 0n ? 1n as I : -1n as I
    const halfI = iDiv(paddleHeightI, toFixed(2))
    return clampPaddleY_fixed(iAdd(m.y0, (step * (dir as unknown as bigint)) as unknown as I), halfI, heightI)
  }

  // Initialize state
  const replayStartTime = performance.now() / 1000
  let fState: FixState = serveFixed(INITIAL_SERVE_DIRECTION, replayStartTime, 0)
  let leftScore = 0
  let rightScore = 0
  let eventIdx = 0
  let ended = false

  const eventsLen = Array.isArray(log.events) ? log.events.length : 0
  const eventCount = eventsLen / 2

  // Initialize paddle motion
  leftM.t0 = fState.t0
  rightM.t0 = fState.t0
  leftM.y0 = fState.leftY
  rightM.y0 = fState.rightY
  leftM.target = fState.leftY
  rightM.target = fState.rightY

  // Helper to set paddle targets for the next event
  function setPaddleTargetsForNextEvent() {
    if (eventIdx >= eventCount) return

    const rawL = log.events[eventIdx * 2]
    const rawR = log.events[eventIdx * 2 + 1]
    const loggedLI: I = typeof rawL === 'string' ? (BigInt(rawL) as unknown as I) : toFixed(rawL)
    const loggedRI: I = typeof rawR === 'string' ? (BigInt(rawR) as unknown as I) : toFixed(rawR)

    // Update paddle motion to start moving toward logged positions NOW
    const leftCurrentY = paddleYAtFixed(leftM, fState.t0)
    const rightCurrentY = paddleYAtFixed(rightM, fState.t0)
    leftM = { y0: leftCurrentY, t0: fState.t0, target: loggedLI }
    rightM = { y0: rightCurrentY, t0: fState.t0, target: loggedRI }
  }

  // Set initial paddle targets for first event
  setPaddleTargetsForNextEvent()

  const listeners: Array<(s: UpdateCallbackState) => void> = []
  function notify() {
    const payload: UpdateCallbackState = {
      leftScore,
      rightScore,
      ended,
    }
    listeners.forEach((cb) => cb(payload))
  }

  function onUpdate(cb: (s: UpdateCallbackState) => void) {
    listeners.push(cb)
  }

  let rafId = 0
  let cancelled = false

  // Process next event using actual physics timing
  function step(): void {
    if (ended || eventIdx >= eventCount) return

    // Compute time to next paddle-plane event
    const dtToPaddleI = timeToPaddleFixed(fState)
    const tHitI = iAdd(fState.t0, dtToPaddleI)
    const yAtHitI = reflect1D_fixed(fState.y, fState.vy, dtToPaddleI, yMinI, yMaxI)

    // By the time we reach here, paddles should have been animating toward logged positions
    // Get their positions at the event time (tHitI)
    const leftYAtHitI = paddleYAtFixed(leftM, tHitI)
    const rightYAtHitI = paddleYAtFixed(rightM, tHitI)

    // Determine hit/miss
    const movingLeft = fState.dir < 0
    const half = PADDLE_HEIGHT / 2
    const yAtHit = fromFixed(yAtHitI)
    const leftYAtHit = fromFixed(leftYAtHitI)
    const rightYAtHit = fromFixed(rightYAtHitI)
    const hit = movingLeft
      ? Math.abs(leftYAtHit - yAtHit) <= half + BALL_RADIUS
      : Math.abs(rightYAtHit - yAtHit) <= half + BALL_RADIUS

    // Advance kinematics to tHit
    fState.x = movingLeft ? iAdd(leftFaceI, ballRadiusI) : iSub(rightFaceI, ballRadiusI)
    fState.y = yAtHitI
    fState.t0 = tHitI
    fState.leftY = leftYAtHitI
    fState.rightY = rightYAtHitI

    if (hit) {
      // Bounce - use the actual paddle position where the ball hit
      const paddleYI = movingLeft ? leftYAtHitI : rightYAtHitI
      const halfI = iDiv(paddleHeightI, toFixed(2))
      const limit = iAdd(halfI, ballRadiusI)
      const offsetI = iMax(iSub(0n as I, limit), iMin(limit, iSub(fState.y, paddleYI)))
      const normI = iDiv(offsetI, limit)
      const angleI = iMax(iSub(0n as I, maxBounceAngleI), iMin(maxBounceAngleI, iMul(normI, maxBounceAngleI)))
      const newSpeed = iAdd(fState.speed, speedIncrementI)
      const newDir: -1 | 1 = fState.dir < 0 ? 1 : -1
      const { sin, cos } = cordicSinCos(angleI)
      fState.vx = iMul(newSpeed, iMul(cos, toFixed(newDir)))
      fState.vy = iMul(newSpeed, sin)
      fState.speed = newSpeed
      fState.dir = newDir
    } else {
      // Miss
      if (movingLeft) rightScore++
      else leftScore++

      notify()

      if (leftScore >= POINTS_TO_WIN || rightScore >= POINTS_TO_WIN) {
        ended = true
        notify()
        return
      }

      // Serve toward scorer
      const receiverDir: -1 | 1 = movingLeft ? 1 : -1
      const processedEvents = (eventIdx + 1) * 2
      fState = serveFixed(receiverDir, fromFixed(fState.t0), processedEvents)
      fState.leftY = leftYAtHitI
      fState.rightY = rightYAtHitI

      // Reset paddle motion to current positions
      leftM = { y0: leftYAtHitI, t0: fState.t0, target: leftYAtHitI }
      rightM = { y0: rightYAtHitI, t0: fState.t0, target: rightYAtHitI }
    }

    eventIdx++
    notify()

    // Now that we've processed this event, set paddle targets for the NEXT event
    // This gives paddles time to animate toward their next positions
    setPaddleTargetsForNextEvent()
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

    // Paddles
    ctx.fillStyle = '#0f0'
    const half = PADDLE_HEIGHT / 2
    const tAbsI = toFixed(tAbs)
    const leftYNow = fromFixed(paddleYAtFixed(leftM, tAbsI))
    const rightYNow = fromFixed(paddleYAtFixed(rightM, tAbsI))
    ctx.fillRect(PADDLE_MARGIN, leftYNow - half, PADDLE_WIDTH, PADDLE_HEIGHT)
    ctx.fillRect(WIDTH - PADDLE_MARGIN - PADDLE_WIDTH, rightYNow - half, PADDLE_WIDTH, PADDLE_HEIGHT)

    // Ball position using analytical reflection
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
    ctx.fillText(`${leftScore}`, WIDTH * 0.25, 24)
    ctx.fillText(`${rightScore}`, WIDTH * 0.75, 24)
  }

  // Animation loop - exactly like runGame
  function render() {
    if (cancelled || ended) return
    const now = performance.now() / 1000

    // Next paddle impact time
    const tHit = fromFixed(iAdd(fState.t0, timeToPaddleFixed(fState)))

    // If we've reached the event time, process it
    if (now >= tHit - 1e-4) {
      step()
    }

    // Draw current frame
    draw(now)

    if (!ended) {
      rafId = requestAnimationFrame(render)
    }
  }

  function cancel() {
    cancelled = true
    if (rafId) cancelAnimationFrame(rafId)
  }

  // Start replay
  draw(replayStartTime)
  rafId = requestAnimationFrame(render)

  return { cancel, onUpdate }
}

// ================= Validation =================

export async function validateLog(log: CompactLog): Promise<ValidateResult> {
  try {
    if (!log || log.v !== 1) return { fair: false, reason: 'Invalid log format', leftScore: 0, rightScore: 0 }
    if (typeof log.game_id !== 'number' || log.game_id < 0 || log.game_id > 0xFFFFFFFF) {
      return { fair: false, reason: 'Invalid game_id format (must be u32)', leftScore: 0, rightScore: 0 }
    }

    // Validate commitment data exists
    if (!log.commitments || !log.player_left_seed || !log.player_right_seed) {
      return { fair: false, reason: 'Missing commitment data (commitments, player_left_seed, or player_right_seed)', leftScore: 0, rightScore: 0 }
    }

    // Validate commitment count matches event count
    const eventsLen = Array.isArray(log.events) ? log.events.length : 0
    if (log.commitments.length !== eventsLen) {
      return { fair: false, reason: 'Commitment count must match event count', leftScore: 0, rightScore: 0 }
    }

    // Parse seeds from hex
    const playerLeftSeed = hexToBytes(log.player_left_seed)
    const playerRightSeed = hexToBytes(log.player_right_seed)

    // Validate seed length (must be 32 bytes)
    if (playerLeftSeed.length !== 32 || playerRightSeed.length !== 32) {
      return { fair: false, reason: 'Invalid seed length (must be 32 bytes)', leftScore: 0, rightScore: 0 }
    }

    // SECURITY: Ensure players use unique seeds to maintain commitment hiding property
    const seedsEqual = playerLeftSeed.every((byte, i) => byte === playerRightSeed[i])
    if (seedsEqual) {
      return { fair: false, reason: 'Players must use unique commitment seeds', leftScore: 0, rightScore: 0 }
    }

    // SECURITY: Validate seed entropy - reject obviously weak seeds (e.g., all zeros)
    const leftZeroCount = playerLeftSeed.filter(b => b === 0).length
    const rightZeroCount = playerRightSeed.filter(b => b === 0).length
    if (leftZeroCount > 28 || rightZeroCount > 28) {
      return { fair: false, reason: 'Commitment seed has insufficient entropy', leftScore: 0, rightScore: 0 }
    }

    // Verify all commitments before processing game logic
    for (let idx = 0; idx < log.events.length; idx++) {
      const paddleY = log.events[idx]
      const paddleYStr = typeof paddleY === 'string' ? paddleY : toFixed(paddleY).toString()

      // Determine which player's seed to use (even = left, odd = right)
      const isLeft = idx % 2 === 0
      const seed = isLeft ? playerLeftSeed : playerRightSeed

      // Compute expected commitment: SHA256(seed || event_index || paddle_y)
      const expectedCommitment = await computeCommitment(seed, idx, paddleYStr)

      // Verify commitment matches
      if (log.commitments[idx] !== expectedCommitment) {
        return { fair: false, reason: `Commitment verification failed at index ${idx}`, leftScore: 0, rightScore: 0 }
      }
    }

    const gameId = log.game_id

    // Fixed constants
    const widthI = toFixed(WIDTH)
    const heightI = toFixed(HEIGHT)
    const ballRadiusI = toFixed(BALL_RADIUS)
    const paddleHeightI = toFixed(PADDLE_HEIGHT)
    const paddleWidthI = toFixed(PADDLE_WIDTH)
    const paddleMarginI = toFixed(PADDLE_MARGIN)
    const serveSpeedI = toFixed(SERVE_SPEED)
    const speedIncrementI = toFixed(SPEED_INCREMENT)
    const maxBounceAngleI = degToRadFixed(MAX_BOUNCE_ANGLE_DEG)

    const yMinI = ballRadiusI
    const yMaxI = iSub(heightI, ballRadiusI)
    const leftFaceI = iAdd(paddleMarginI, paddleWidthI)
    const rightFaceI = iSub(widthI, iAdd(paddleMarginI, paddleWidthI))

    function serve(receiverDir: -1 | 1, tStart: number, volleyCount: number): FixState {
      // Calculate deterministic serve angle mixing volley count + game_id
      const entropyMix = (volleyCount + gameId) | 0
      // Use proper modulo to ensure positive remainder (JavaScript % can return negative values)
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

    function timeToPaddle(state: FixState): I {
      const targetX = state.dir < 0 ? iAdd(leftFaceI, ballRadiusI) : iSub(rightFaceI, ballRadiusI)
      return iDiv(iSub(targetX, state.x), state.vx)
    }

    function ballYat(state: FixState, tAbs: number): number {
      const dtI = iSub(toFixed(tAbs), state.t0)
      return fromFixed(reflect1D_fixed(state.y, state.vy, dtI, yMinI, yMaxI))
    }

    // (unused float helpers removed)

    let state = serve(INITIAL_SERVE_DIRECTION, 0, 0)
    let leftScore = 0
    let rightScore = 0
    let ended = false
    let rallyId = 0
    let eventIdx = 0
    let processedEvents = 0 // Track total events processed to match log.events.length

    // Empty games are invalid - no gameplay occurred (already validated eventsLen above)
    if (eventsLen === 0) {
      return { fair: false, reason: 'No events provided - game never started', leftScore: 0, rightScore: 0 }
    }

    while (!ended) {
      // Each event is two entries (L, R)
      if (eventsLen % 2 !== 0) {
        return { fair: false, reason: 'Malformed events length', leftScore, rightScore }
      }
      const eventCount = eventsLen / 2
      if (eventIdx >= eventCount) break
      processedEvents += 2 // Process two events (L, R) per iteration
      const dtToPaddle = timeToPaddle(state)
      // dt must be positive; BigInt ensures finiteness
      if (!(dtToPaddle > 0n)) {
        return { fair: false, reason: 'Invalid kinematics', leftScore, rightScore }
      }
      const tHit = iAdd(state.t0, dtToPaddle)
      // Note: Time overflow check is omitted in TypeScript
      // BigInt automatically handles arbitrarily large values without overflow
      // Rust version has explicit check: if (tHit < state.t0) { panic!("overflow") }
      // This is unnecessary in JS/TS due to BigInt's arbitrary precision
      // The 10K event limit (enforced in Rust) prevents practical overflow anyway
      const yAtHit = ballYat(state, fromFixed(tHit))
      const rawL = log.events[eventIdx * 2]
      const rawR = log.events[eventIdx * 2 + 1]
      const loggedLI: I = typeof rawL === 'string' ? (BigInt(rawL) as unknown as I) : toFixed(rawL)
      const loggedRI: I = typeof rawR === 'string' ? (BigInt(rawR) as unknown as I) : toFixed(rawR)
      if ((typeof rawL !== 'number' && typeof rawL !== 'string') || (typeof rawR !== 'number' && typeof rawR !== 'string')) {
        return { fair: false, reason: 'Malformed event', leftScore, rightScore }
      }
      // Reachability check for both paddles since last event
      const movingLeft = state.dir < 0
      const dtI = iSub(tHit, state.t0)
      const maxDeltaI = iMul(toFixed(PADDLE_MAX_SPEED), dtI)
      const dLI = iAbs(iSub(loggedLI, state.leftY))
      const dRI = iAbs(iSub(loggedRI, state.rightY))
      if (dLI > maxDeltaI || dRI > maxDeltaI) {
        const which = dLI > maxDeltaI ? 'LEFT' : 'RIGHT'
        const detail = {
          idx: eventIdx,
          which,
          dt: dtI.toString(),
          maxDelta: maxDeltaI.toString(),
          dL: dLI.toString(),
          dR: dRI.toString(),
          prevLeft: state.leftY.toString(),
          prevRight: state.rightY.toString(),
          loggedL: loggedLI.toString(),
          loggedR: loggedRI.toString(),
        }
        return { fair: false, reason: 'Paddle moved too fast ' + JSON.stringify(detail), leftScore, rightScore }
      }
      // Bounds check both
      const halfI2 = iDiv(paddleHeightI, toFixed(2))
      const clampL = clampPaddleY_fixed(loggedLI, halfI2, toFixed(HEIGHT))
      const clampR = clampPaddleY_fixed(loggedRI, halfI2, toFixed(HEIGHT))
      if (clampL !== loggedLI || clampR !== loggedRI) {
        return { fair: false, reason: 'Paddle out of bounds', leftScore, rightScore }
      }

      // Hit vs miss
      const half = PADDLE_HEIGHT / 2
      const hit = Math.abs((movingLeft ? fromFixed(loggedLI) : fromFixed(loggedRI)) - yAtHit) <= half + BALL_RADIUS

      // Advance to tHit
      state.x = movingLeft ? iAdd(leftFaceI, ballRadiusI) : iSub(rightFaceI, ballRadiusI)
      state.y = reflect1D_fixed(state.y, state.vy, dtToPaddle, yMinI, yMaxI)
      state.t0 = tHit
      state.leftY = loggedLI
      state.rightY = loggedRI

      if (hit) {
        const contactYI = movingLeft ? loggedLI : loggedRI
        const halfI3 = iDiv(paddleHeightI, toFixed(2))
        const offsetI = iMax(iSub(0n as I, iAdd(halfI3, ballRadiusI)), iMin(iAdd(halfI3, ballRadiusI), iSub(state.y, contactYI)))
        const normI = iDiv(offsetI, iAdd(halfI3, ballRadiusI))
        const angleI = iMax(iSub(0n as I, maxBounceAngleI), iMin(maxBounceAngleI, iMul(normI, maxBounceAngleI)))
        const newSpeed = iAdd(state.speed, speedIncrementI)
        const newDir: -1 | 1 = state.dir < 0 ? 1 : -1
        const { sin, cos } = cordicSinCos(angleI)
        state.vx = iMul(newSpeed, iMul(cos, toFixed(newDir)))
        state.vy = iMul(newSpeed, sin)
        state.speed = newSpeed
        state.dir = newDir
      } else {
        if (movingLeft) rightScore++
        else leftScore++
        if (leftScore >= POINTS_TO_WIN || rightScore >= POINTS_TO_WIN) {
          ended = true
          break
        }
        const receiverDir: -1 | 1 = movingLeft ? 1 : -1
        const next = serve(receiverDir, fromFixed(state.t0), processedEvents)
        next.leftY = state.leftY
        next.rightY = state.rightY
        state = next
        rallyId++
      }

      eventIdx++
    }

    // Validate final score - one player must have exactly POINTS_TO_WIN
    if (leftScore !== POINTS_TO_WIN && rightScore !== POINTS_TO_WIN) {
      return { fair: false, reason: 'Invalid final score - neither player reached POINTS_TO_WIN', leftScore, rightScore }
    }

    // Reject scores beyond POINTS_TO_WIN
    if (leftScore > POINTS_TO_WIN || rightScore > POINTS_TO_WIN) {
      return { fair: false, reason: 'Invalid final score - game continued beyond POINTS_TO_WIN', leftScore, rightScore }
    }

    // Reject ties - games must have a winner
    if (leftScore === rightScore) {
      return { fair: false, reason: 'Game ended in a tie - invalid game', leftScore, rightScore }
    }

    return { fair: true, leftScore, rightScore }
  } catch (e) {
    return { fair: false, reason: 'Validation error', leftScore: 0, rightScore: 0 }
  }
}
