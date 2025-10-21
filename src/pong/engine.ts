// Deterministic, event-driven Pong engine with compact logging and validation.
// Integer (fixed-point) kinematics for perfect determinism.

import type { I } from './fixed'
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
  degMilliToRadFixed,
  fixedFromPermille,
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
  SERVE_MAX_ANGLE_DEG,
  POINTS_TO_WIN,
  MICRO_JITTER_MILLI_DEG,
  AI_OFFSET_MAX_PERMILLE,
  INITIAL_SERVE_DIRECTION,
} from './constants'

type NumberLike = string | number

export interface CompactLog {
  v: 1
  seed: number
  // Flat array of paddle pairs per event: [l0, r0, l1, r1, ...]
  events: NumberLike[]
}

export interface ValidateResult {
  fair: boolean
  reason?: string
  leftScore: number
  rightScore: number
}

// Simple LCG (Linear Congruential Generator) for deterministic RNG
// CRITICAL: This must match the Rust implementation exactly!
// See prover/methods/guest/src/physics.rs LcgRng
// Algorithm: state = (state * 1664525 + 1013904223) mod 2^32
// Parameters from Numerical Recipes (a=1664525, c=1013904223)
class RNG {
  private state: number
  constructor(seed: number) {
    // CRITICAL: seed=0 becomes 1 to match Rust implementation
    this.state = (seed >>> 0) || 1
  }
  next(): number {
    // Parameters from Numerical Recipes
    this.state = (1664525 * this.state + 1013904223) >>> 0
    return this.state / 0x100000000
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }
  nextU32(): number {
    // Advance once to get new state; reuse multiplier/addend
    this.state = (1664525 * this.state + 1013904223) >>> 0
    return this.state >>> 0
  }
}

// Uniform range in fixed-point: returns value in [minI, maxI]
function rangeFixed(rng: RNG, minI: I, maxI: I): I {
  const u = BigInt(rng.nextU32()) // 0..2^32-1
  const span = iSub(maxI, minI)
  // (span * u) / 2^32
  const scaled = (span * u) / (1n << 32n)
  return iAdd(minI, scaled as unknown as I)
}

// (floating-point helpers removed; fixed-point variants are used)

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

export function runGame(canvas: HTMLCanvasElement, seed: number) {
  const ctx = canvas.getContext('2d')!
  // Separate RNGs: physics affects validation; AI does not.
  // CRITICAL: Two-RNG design pattern explained:
  // 1. rngPhysics: Used for serve angles, bounce jitter → affects logged paddle positions
  // 2. rngAI: Used for AI targeting decisions → does NOT affect validation
  // Why? Validator checks paddle positions are REACHABLE, not that they're OPTIMAL
  // This allows AI imperfection without breaking deterministic validation
  const rngPhysics = new RNG(seed)
  const rngAI = new RNG((seed ^ 0x9e3779b9) >>> 0) // XOR for decorrelation

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
  const serveMaxAngleI = degToRadFixed(SERVE_MAX_ANGLE_DEG)
  const microJitterI = degMilliToRadFixed(MICRO_JITTER_MILLI_DEG)

  const yMinI = ballRadiusI
  const yMaxI = iSub(heightI, ballRadiusI)
  const leftFaceI = iAdd(paddleMarginI, paddleWidthI)
  const rightFaceI = iSub(widthI, iAdd(paddleMarginI, paddleWidthI))

  // Serve towards receiverDir (-1 means serve heading left, 1 means serve heading right)
  function serveFixed(receiverDir: -1 | 1, tStart: number): FixState {
    const angleI = rangeFixed(rngPhysics, -serveMaxAngleI, serveMaxAngleI)
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

  function planTargetsForNextEventFix(fs: FixState) {
    const tChangeI = fs.t0
    const dtToP = timeToPaddleFixed(fs)
    const tHitI = iAdd(fs.t0, dtToP)
    const yInterceptI = reflect1D_fixed(fs.y, fs.vy, iSub(tHitI, fs.t0), yMinI, yMaxI)
    const halfI = iDiv(paddleHeightI, toFixed(2))
    const aimOffsetRatioI = rangeFixed(
      rngAI,
      -fixedFromPermille(AI_OFFSET_MAX_PERMILLE),
      fixedFromPermille(AI_OFFSET_MAX_PERMILLE)
    )
    const aimOffsetI = iMul(aimOffsetRatioI, iAdd(halfI, ballRadiusI))
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
  function bounceFixed(fs: FixState, paddleYI: I): { vx: I; vy: I; speed: I; dir: -1 | 1; angleI: I } {
    const halfI = iDiv(paddleHeightI, toFixed(2))
    const limit = iAdd(halfI, ballRadiusI)

    // Guard against division by zero (should be prevented by config validation)
    if (limit <= 0n) {
      throw new Error('Invalid paddle/ball dimensions: limit is zero or negative')
    }

    const offsetI = iMax(iSub(0n as I, limit), iMin(limit, iSub(fs.y, paddleYI)))
    const normI = iDiv(offsetI, limit)
    let angleI = iMax(iSub(0n as I, maxBounceAngleI), iMin(maxBounceAngleI, iMul(normI, maxBounceAngleI)))
    const jitterI = rangeFixed(rngPhysics, -microJitterI, microJitterI)
    angleI = iMax(iSub(0n as I, maxBounceAngleI), iMin(maxBounceAngleI, iAdd(angleI, jitterI)))
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
  let fState: FixState = serveFixed(INITIAL_SERVE_DIRECTION, performance.now() / 1000)
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
  // Debug log: use integer fixed-point string values (no floats)
  console.log('GAME serve ' + JSON.stringify({
    receiverDir: fState.dir,
    t0: fState.t0.toString(),
    vx: fState.vx.toString(),
    vy: fState.vy.toString(),
    speed: fState.speed.toString(),
    leftScore: state.leftScore,
    rightScore: state.rightScore,
    rally: rallyId,
  }))
  // Initialize paddle motion timelines and plan the first intercept.
  leftM.t0 = fState.t0
  rightM.t0 = fState.t0
  leftM.y0 = fState.leftY
  rightM.y0 = fState.rightY
  leftM.target = fState.leftY
  rightM.target = fState.rightY
  planTargetsForNextEventFix(fState)

  const log: CompactLog = { v: 1, seed, events: [] }
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
  function step(): void {
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

    // Log both paddle positions at impact/miss time
    // Persist fixed-point integers as strings for exactness
    log.events.push(leftYAtHitI.toString(), rightYAtHitI.toString())
    console.log('GAME event ' + JSON.stringify({
      idx: Math.floor(log.events.length / 2) - 1,
      dir: fState.dir,
      tHit: tHitI.toString(),
      dt: dtToPaddleI.toString(),
      yAtHit: yAtHitI.toString(),
      leftYAtHit: leftYAtHitI.toString(),
      rightYAtHit: rightYAtHitI.toString(),
      hit,
      rally: rallyId,
    }))

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
      const { vx, vy, speed, dir, angleI } = bounceFixed(fState, paddleYI)
      fState.vx = vx
      fState.vy = vy
      fState.speed = speed
      fState.dir = dir
      state.vx = fromFixed(fState.vx)
      state.vy = fromFixed(fState.vy)
      state.speed = fromFixed(fState.speed)
      state.dir = fState.dir
      console.log('GAME bounce ' + JSON.stringify({
        angleRad: angleI.toString(),
        vx: fState.vx.toString(),
        vy: fState.vy.toString(),
        speed: fState.speed.toString(),
        dir: fState.dir,
      }))
      // Update state paddle positions for bookkeeping
      fState.leftY = toFixed(leftYAtHit)
      fState.rightY = toFixed(rightYAtHit)
      state.leftY = leftYAtHit
      state.rightY = rightYAtHit
      // Plan next targets: hitter re-centers, opponent aims for intercept
      planTargetsForNextEventFix(fState)
    } else {
      // Miss: score for the opponent
      if (movingLeft) state.rightScore++
      else state.leftScore++
      console.log('GAME miss ' + JSON.stringify({ by: movingLeft ? 'LEFT' : 'RIGHT', leftScore: state.leftScore, rightScore: state.rightScore, rally: rallyId }))
      // End match?
      if (state.leftScore >= POINTS_TO_WIN || state.rightScore >= POINTS_TO_WIN) {
        state.ended = true
        notify()
        return
      }
      // Serve toward the player who just received the point (the scorer)
      const receiverDir: -1 | 1 = movingLeft ? 1 : -1
      fState = serveFixed(receiverDir, state.t0)
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
      console.log('GAME serve ' + JSON.stringify({
        receiverDir: fState.dir,
        t0: fState.t0.toString(),
        vx: fState.vx.toString(),
        vy: fState.vy.toString(),
        speed: fState.speed.toString(),
        leftScore: state.leftScore,
        rightScore: state.rightScore,
        rally: rallyId,
      }))
      // On serve, set receiver target to intercept, other to center
      planTargetsForNextEventFix(fState)
    }

    notify()
  }

  // Animation: uses analytical positions between events; triggers steps as we reach event times.
  // CRITICAL: This uses performance.now() which is NOT deterministic
  // However, this only affects WHEN step() is called, not WHAT step() does
  // The step() function itself is purely deterministic (fixed-point math + seeded RNG)
  // Rendering converts fixed-point to float for display only - never logged
  let rafId = 0
  function render() {
    if (state.ended) return
    const now = performance.now() / 1000 // ← Non-deterministic timing (OK - not logged)
    // Next paddle impact time
    const tHit = fromFixed(iAdd(fState.t0, timeToPaddleFixed(fState)))
    // If we are past the event time (or very near), perform the step and continue.
    if (now >= tHit - 1e-4) {
      step() // ← Deterministic update (fixed-point + RNG)
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

// ================= Validation =================

export function validateLog(log: CompactLog): ValidateResult {
  try {
    if (!log || log.v !== 1) return { fair: false, reason: 'Invalid log format', leftScore: 0, rightScore: 0 }
    const rngPhysics = new RNG(log.seed)

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
    const serveMaxAngleI = degToRadFixed(SERVE_MAX_ANGLE_DEG)
    const microJitterI = degMilliToRadFixed(MICRO_JITTER_MILLI_DEG)

    const yMinI = ballRadiusI
    const yMaxI = iSub(heightI, ballRadiusI)
    const leftFaceI = iAdd(paddleMarginI, paddleWidthI)
    const rightFaceI = iSub(widthI, iAdd(paddleMarginI, paddleWidthI))

    function serve(receiverDir: -1 | 1, tStart: number): FixState {
      const angleI = rangeFixed(rngPhysics, -serveMaxAngleI, serveMaxAngleI)
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

    let state = serve(INITIAL_SERVE_DIRECTION, 0)
    let leftScore = 0
    let rightScore = 0
    let ended = false
    let rallyId = 0
    let eventIdx = 0

    while (!ended) {
      // Each event is two entries (L, R)
      const eventsLen = Array.isArray(log.events) ? log.events.length : 0
      if (eventsLen % 2 !== 0) {
        return { fair: false, reason: 'Malformed events length', leftScore, rightScore }
      }
      const eventCount = eventsLen / 2
      if (eventIdx >= eventCount) break
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
      const yAtHitI = reflect1D_fixed(state.y, state.vy, dtToPaddle, yMinI, yMaxI)
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
      console.log('VALIDATE event ' + JSON.stringify({
        idx: eventIdx,
        dir: state.dir,
        tHit: tHit.toString(),
        dt: dtToPaddle.toString(),
        yAtHit: yAtHitI.toString(),
        loggedL: loggedLI.toString(),
        loggedR: loggedRI.toString(),
        hit,
        rally: rallyId,
      }))

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
        let angleI = iMax(iSub(0n as I, maxBounceAngleI), iMin(maxBounceAngleI, iMul(normI, maxBounceAngleI)))
        const jitterI = rangeFixed(rngPhysics, -microJitterI, microJitterI)
        angleI = iMax(iSub(0n as I, maxBounceAngleI), iMin(maxBounceAngleI, iAdd(angleI, jitterI)))
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
        console.log('VALIDATE miss ' + JSON.stringify({ by: movingLeft ? 'LEFT' : 'RIGHT', leftScore, rightScore, rally: rallyId }))
        if (leftScore >= POINTS_TO_WIN || rightScore >= POINTS_TO_WIN) {
          ended = true
          break
        }
        const receiverDir: -1 | 1 = movingLeft ? 1 : -1
        const next = serve(receiverDir, fromFixed(state.t0))
        next.leftY = state.leftY
        next.rightY = state.rightY
        state = next
        rallyId++
        console.log('VALIDATE serve ' + JSON.stringify({
          receiverDir: state.dir,
          t0: state.t0.toString(),
          vx: state.vx.toString(),
          vy: state.vy.toString(),
          speed: state.speed.toString(),
          leftScore,
          rightScore,
          rally: rallyId,
        }))
      }

      eventIdx++
    }

    return { fair: true, leftScore, rightScore }
  } catch (e) {
    return { fair: false, reason: 'Validation error', leftScore: 0, rightScore: 0 }
  }
}
