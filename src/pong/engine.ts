// Deterministic, event-driven Pong engine with compact logging and validation.

type NumberLike = number

export interface GameConfig {
  seed: number
  width: number
  height: number
  paddleHeight: number
  paddleWidth: number
  paddleMargin: number
  ballRadius: number
  paddleMaxSpeed: number
  serveSpeed: number
  speedIncrement: number
  maxBounceAngleDeg: number
  serveMaxAngleDeg: number
  pointsToWin: number
  // New: micro jitter added to bounce angles (deg) to avoid infinite rallies
  microJitterDeg: number
  // New: AI aims off-center by up to this fraction of (paddleHalf + ballRadius)
  aiOffsetMaxFrac: number
}

export interface CompactLog {
  v: 1
  config: GameConfig
  // Each entry is [leftY, rightY] at each paddle-plane event (hit or miss).
  events: NumberLike[][]
}

export interface ValidateResult {
  fair: boolean
  reason?: string
  leftScore: number
  rightScore: number
}

// Simple LCG for deterministic RNG.
class RNG {
  private state: number
  constructor(seed: number) {
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
}

// Reflect a 1D position with hard limits using sawtooth reflection mapping.
function reflect1D(y0: number, vy: number, dt: number, minY: number, maxY: number): number {
  const span = maxY - minY
  if (span <= 0) return y0
  let y = y0 + vy * dt - minY
  const period = 2 * span
  // Proper modulo for negatives
  y = ((y % period) + period) % period
  if (y > span) return maxY - (y - span)
  return minY + y
}

function degToRad(d: number): number {
  return (d * Math.PI) / 180
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

interface UpdateCallbackState {
  leftScore: number
  rightScore: number
  ended: boolean
}

export function runGame(canvas: HTMLCanvasElement, cfg: GameConfig) {
  const ctx = canvas.getContext('2d')!
  // Separate RNGs: physics affects validation; AI does not.
  const rngPhysics = new RNG(cfg.seed)
  const rngAI = new RNG((cfg.seed ^ 0x9e3779b9) >>> 0)

  const yMin = cfg.ballRadius
  const yMax = cfg.height - cfg.ballRadius
  const leftX = cfg.paddleMargin + cfg.paddleWidth
  const rightX = cfg.width - cfg.paddleMargin - cfg.paddleWidth
  const leftFace = leftX
  const rightFace = rightX

  const maxBounceAngle = degToRad(cfg.maxBounceAngleDeg)
  const serveMaxAngle = degToRad(cfg.serveMaxAngleDeg)
  const microJitter = degToRad(cfg.microJitterDeg)

  // Serve towards receiverDir (-1 means serve heading left)
  function serve(receiverDir: -1 | 1, tStart: number): EngineState {
    const angle = rngPhysics.range(-serveMaxAngle, serveMaxAngle)
    const dir = receiverDir
    const vx = cfg.serveSpeed * Math.cos(angle) * dir
    const vy = cfg.serveSpeed * Math.sin(angle)
    return {
      t0: tStart,
      x: cfg.width / 2,
      y: cfg.height / 2,
      vx,
      vy,
      speed: cfg.serveSpeed,
      leftY: cfg.height / 2,
      rightY: cfg.height / 2,
      dir,
      leftScore: 0,
      rightScore: 0,
      ended: false,
    }
  }

  // Paddle motion model: analytic movement toward a target at max speed.
  type PaddleMotion = { y0: number; t0: number; target: number }
  const centerY = cfg.height / 2
  let leftM: PaddleMotion = { y0: centerY, t0: 0, target: centerY }
  let rightM: PaddleMotion = { y0: centerY, t0: 0, target: centerY }

  function paddleYAt(m: PaddleMotion, tAbs: number): number {
    const y0 = m.y0
    const dt = Math.max(0, tAbs - m.t0)
    const dist = Math.abs(m.target - y0)
    const step = Math.min(dist, cfg.paddleMaxSpeed * dt)
    const dir = Math.sign(m.target - y0)
    return clampPaddleY(y0 + dir * step)
  }

  function setPaddleTarget(m: PaddleMotion, newTarget: number, tAbs: number) {
    const yNow = paddleYAt(m, tAbs)
    m.y0 = yNow
    m.t0 = tAbs
    m.target = clampPaddleY(newTarget)
  }

  function planTargetsForNextEvent(s: EngineState) {
    const tChange = s.t0
    const dtToP = timeToPaddle(s)
    const tHit = s.t0 + dtToP
    const yIntercept = ballYat(s, tHit)
    const half = cfg.paddleHeight / 2
    const aimOffsetRatio = rngAI.range(-cfg.aiOffsetMaxFrac, cfg.aiOffsetMaxFrac)
    const aimOffset = aimOffsetRatio * (half + cfg.ballRadius)
    const desired = clampPaddleY(yIntercept + aimOffset)
    const movingLeftNext = s.dir < 0
    if (movingLeftNext) {
      setPaddleTarget(leftM, desired, tChange)
      setPaddleTarget(rightM, centerY, tChange)
    } else {
      setPaddleTarget(rightM, desired, tChange)
      setPaddleTarget(leftM, centerY, tChange)
    }
  }

  // Compute time to reach the next paddle plane along x, ignoring walls for y (we reflect y analytically).
  function timeToPaddle(state: EngineState): number {
    const { x, vx, dir } = state
    const targetX = dir < 0 ? leftFace + cfg.ballRadius : rightFace - cfg.ballRadius
    return (targetX - x) / vx
  }

  // Ball y at time t since state.t0 using reflection.
  function ballYat(state: EngineState, tAbs: number): number {
    const dt = tAbs - state.t0
    return reflect1D(state.y, state.vy, dt, yMin, yMax)
  }

  // Constrain paddle center within board.
  function clampPaddleY(y: number): number {
    const half = cfg.paddleHeight / 2
    return Math.max(half, Math.min(cfg.height - half, y))
  }

  // Determine bounce off paddle: set new vx,vy, speed increased.
  function bounce(state: EngineState, paddleY: number): { vx: number; vy: number; speed: number; dir: -1 | 1; angle: number } {
    const half = cfg.paddleHeight / 2
    const offset = Math.max(-half - cfg.ballRadius, Math.min(half + cfg.ballRadius, state.y - paddleY))
    const norm = offset / (half + cfg.ballRadius)
    let angle = Math.max(-maxBounceAngle, Math.min(maxBounceAngle, norm * maxBounceAngle))
    // Add tiny jitter to avoid degenerate infinite rallies
    const jitter = rngPhysics.range(-microJitter, microJitter)
    angle = Math.max(-maxBounceAngle, Math.min(maxBounceAngle, angle + jitter))
    const newSpeed = state.speed + cfg.speedIncrement
    const newDir: -1 | 1 = state.dir < 0 ? 1 : -1
    const vx = Math.cos(angle) * newSpeed * newDir
    const vy = Math.sin(angle) * newSpeed
    return { vx, vy, speed: newSpeed, dir: newDir, angle }
  }

  // Renderer uses analytical positions; we only change kinematics at event times.
  // Add a rally counter to align GAME vs VALIDATE logs.
  let rallyId = 0
  let state = serve(1, performance.now() / 1000)
  console.log('GAME serve ' + JSON.stringify({
    receiverDir: state.dir,
    t0: state.t0,
    vx: state.vx,
    vy: state.vy,
    speed: state.speed,
    leftScore: state.leftScore,
    rightScore: state.rightScore,
    rally: rallyId,
  }))
  // Initialize paddle motion timelines and plan the first intercept.
  leftM.t0 = state.t0
  rightM.t0 = state.t0
  leftM.y0 = centerY
  rightM.y0 = centerY
  leftM.target = centerY
  rightM.target = centerY
  planTargetsForNextEvent(state)

  const log: CompactLog = { v: 1, config: cfg, events: [] }
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
    // Compute absolute time when ball hits the paddle plane.
    const dtToPaddle = timeToPaddle(state)
    const tHit = state.t0 + dtToPaddle
    // Compute ball y at hit time via reflection.
    const yAtHit = ballYat(state, tHit)

    // Determine positions of both paddles at event time from their motion.
    const movingLeft = state.dir < 0
    const leftYAtHit = paddleYAt(leftM, tHit)
    const rightYAtHit = paddleYAt(rightM, tHit)
    const half = cfg.paddleHeight / 2
    const hit = movingLeft
      ? Math.abs(leftYAtHit - yAtHit) <= half + cfg.ballRadius
      : Math.abs(rightYAtHit - yAtHit) <= half + cfg.ballRadius

    // Log both paddle positions at impact/miss time
    log.events.push([leftYAtHit, rightYAtHit])
    console.log('GAME event ' + JSON.stringify({
      idx: log.events.length - 1,
      dir: state.dir,
      tHit,
      dt: dtToPaddle,
      yAtHit,
      leftYAtHit,
      rightYAtHit,
      hit,
      rally: rallyId,
    }))

    // Advance kinematics to tHit
    state.x = movingLeft ? leftFace + cfg.ballRadius : rightFace - cfg.ballRadius
    state.y = yAtHit
    state.t0 = tHit

    if (hit) {
      // Bounce
      const paddleY = movingLeft ? leftYAtHit : rightYAtHit
      const { vx, vy, speed, dir, angle } = bounce(state, paddleY)
      state.vx = vx
      state.vy = vy
      state.speed = speed
      state.dir = dir
      console.log('GAME bounce ' + JSON.stringify({ angleRad: angle, vx, vy, speed, dir }))
      // Update state paddle positions for bookkeeping
      state.leftY = leftYAtHit
      state.rightY = rightYAtHit
      // Plan next targets: hitter re-centers, opponent aims for intercept
      planTargetsForNextEvent(state)
    } else {
      // Miss: score for the opponent
      if (movingLeft) state.rightScore++
      else state.leftScore++
      console.log('GAME miss ' + JSON.stringify({ by: movingLeft ? 'LEFT' : 'RIGHT', leftScore: state.leftScore, rightScore: state.rightScore, rally: rallyId }))
      // End match?
      if (state.leftScore >= cfg.pointsToWin || state.rightScore >= cfg.pointsToWin) {
        state.ended = true
        notify()
        return
      }
      // Serve toward the player who just received the point (the scorer)
      const receiverDir: -1 | 1 = movingLeft ? 1 : -1
      const next = serve(receiverDir, state.t0)
      // Keep paddle positions at miss time
      next.leftY = leftYAtHit
      next.rightY = rightYAtHit
      next.leftScore = state.leftScore
      next.rightScore = state.rightScore
      state = next
      rallyId++
      console.log('GAME serve ' + JSON.stringify({
        receiverDir: state.dir,
        t0: state.t0,
        vx: state.vx,
        vy: state.vy,
        speed: state.speed,
        leftScore: state.leftScore,
        rightScore: state.rightScore,
        rally: rallyId,
      }))
      // On serve, set receiver target to intercept, other to center
      planTargetsForNextEvent(state)
    }

    notify()
  }

  // Animation: uses analytical positions between events; triggers steps as we reach event times.
  let rafId = 0
  function render() {
    if (state.ended) return
    const now = performance.now() / 1000
    // Next paddle impact time
    const tHit = state.t0 + timeToPaddle(state)
    // If we are past the event time (or very near), perform the step and continue.
    if (now >= tHit - 1e-4) {
      step()
    }
    // Draw current frame at time now
    draw(now)
    rafId = requestAnimationFrame(render)
  }

  function draw(tAbs: number) {
    const { width, height } = cfg
    ctx.clearRect(0, 0, width, height)

    // Midline
    ctx.strokeStyle = '#333'
    ctx.beginPath()
    ctx.setLineDash([6, 6])
    ctx.moveTo(width / 2, 0)
    ctx.lineTo(width / 2, height)
    ctx.stroke()
    ctx.setLineDash([])

    // Paddles
    ctx.fillStyle = '#0f0'
    const half = cfg.paddleHeight / 2
    const leftYNow = paddleYAt(leftM, tAbs)
    const rightYNow = paddleYAt(rightM, tAbs)
    // Left
    ctx.fillRect(
      cfg.paddleMargin,
      leftYNow - half,
      cfg.paddleWidth,
      cfg.paddleHeight
    )
    // Right
    ctx.fillRect(
      cfg.width - cfg.paddleMargin - cfg.paddleWidth,
      rightYNow - half,
      cfg.paddleWidth,
      cfg.paddleHeight
    )

    // Ball position at tAbs using analytical reflection
    const dt = tAbs - state.t0
    const bx = state.x + state.vx * dt
    const by = reflect1D(state.y, state.vy, dt, yMin, yMax)
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(bx, by, cfg.ballRadius, 0, Math.PI * 2)
    ctx.fill()

    // Score
    ctx.fillStyle = '#fff'
    ctx.font = '16px sans-serif'
    ctx.fillText(`${state.leftScore}`, cfg.width * 0.25, 24)
    ctx.fillText(`${state.rightScore}`, cfg.width * 0.75, 24)
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
    const cfg = log.config
    const rngPhysics = new RNG(cfg.seed)

    const yMin = cfg.ballRadius
    const yMax = cfg.height - cfg.ballRadius
    const leftFace = cfg.paddleMargin + cfg.paddleWidth
    const rightFace = cfg.width - cfg.paddleMargin - cfg.paddleWidth
    const maxBounceAngle = degToRad(cfg.maxBounceAngleDeg)
    const serveMaxAngle = degToRad(cfg.serveMaxAngleDeg)
    const microJitter = degToRad(cfg.microJitterDeg)

    function serve(receiverDir: -1 | 1, tStart: number): EngineState {
      const angle = rngPhysics.range(-serveMaxAngle, serveMaxAngle)
      const vx = cfg.serveSpeed * Math.cos(angle) * receiverDir
      const vy = cfg.serveSpeed * Math.sin(angle)
      return {
        t0: tStart,
        x: cfg.width / 2,
        y: cfg.height / 2,
        vx,
        vy,
        speed: cfg.serveSpeed,
        leftY: cfg.height / 2,
        rightY: cfg.height / 2,
        dir: receiverDir,
        leftScore: 0,
        rightScore: 0,
        ended: false,
      }
    }

    function timeToPaddle(state: EngineState): number {
      const targetX = state.dir < 0 ? leftFace + cfg.ballRadius : rightFace - cfg.ballRadius
      return (targetX - state.x) / state.vx
    }

    function ballYat(state: EngineState, tAbs: number): number {
      const dt = tAbs - state.t0
      return reflect1D(state.y, state.vy, dt, yMin, yMax)
    }

    function clampPaddleY(y: number): number {
      const half = cfg.paddleHeight / 2
      return Math.max(half, Math.min(cfg.height - half, y))
    }

    function bounce(state: EngineState, paddleY: number) {
      const half = cfg.paddleHeight / 2
      const offset = Math.max(-half - cfg.ballRadius, Math.min(half + cfg.ballRadius, state.y - paddleY))
      const norm = offset / (half + cfg.ballRadius)
      let angle = Math.max(-maxBounceAngle, Math.min(maxBounceAngle, norm * maxBounceAngle))
      // Apply the same jitter as gameplay to match kinematics
      const jitter = rngPhysics.range(-microJitter, microJitter)
      angle = Math.max(-maxBounceAngle, Math.min(maxBounceAngle, angle + jitter))
      const newSpeed = state.speed + cfg.speedIncrement
      const newDir: -1 | 1 = state.dir < 0 ? 1 : -1
      const vx = Math.cos(angle) * newSpeed * newDir
      const vy = Math.sin(angle) * newSpeed
      return { vx, vy, speed: newSpeed, dir: newDir }
    }

    let state = serve(1, 0)
    let rallyId = 0
    let eventIdx = 0

    while (!state.ended) {
      if (eventIdx >= log.events.length) break
      const dtToPaddle = timeToPaddle(state)
      if (!(dtToPaddle > 0 && isFinite(dtToPaddle))) {
        return { fair: false, reason: 'Invalid kinematics', leftScore: state.leftScore, rightScore: state.rightScore }
      }
      const tHit = state.t0 + dtToPaddle
      const yAtHit = ballYat(state, tHit)
      const [loggedL, loggedR] = log.events[eventIdx]
      if (typeof loggedL !== 'number' || typeof loggedR !== 'number') {
        return { fair: false, reason: 'Malformed event', leftScore: state.leftScore, rightScore: state.rightScore }
      }
      // Reachability check for both paddles since last event
      const movingLeft = state.dir < 0
      const dtMove = tHit - state.t0
      // Allow a small numeric tolerance to absorb FP drift and reflection-branch sensitivity
      const maxDelta = cfg.paddleMaxSpeed * dtMove
      const prevLeft = state.leftY
      const prevRight = state.rightY
      const dL = Math.abs(loggedL - prevLeft)
      const dR = Math.abs(loggedR - prevRight)
      const tol = 1e-6 + 1e-3 * cfg.paddleMaxSpeed + 0.005 * cfg.paddleMaxSpeed * dtMove
      if (dL > maxDelta + tol || dR > maxDelta + tol) {
        const which = dL > maxDelta + tol ? 'LEFT' : 'RIGHT'
        const detail = {
          idx: eventIdx,
          which,
          dt: dtMove,
          maxDelta,
          tol,
          dL,
          dR,
          prevLeft,
          prevRight,
          loggedL,
          loggedR,
        }
        return { fair: false, reason: 'Paddle moved too fast ' + JSON.stringify(detail), leftScore: state.leftScore, rightScore: state.rightScore }
      }
      // Bounds check both
      const clampL = clampPaddleY(loggedL)
      const clampR = clampPaddleY(loggedR)
      if (Math.abs(clampL - loggedL) > 1e-6 || Math.abs(clampR - loggedR) > 1e-6) {
        return { fair: false, reason: 'Paddle out of bounds', leftScore: state.leftScore, rightScore: state.rightScore }
      }

      // Hit vs miss
      const half = cfg.paddleHeight / 2
      const hit = Math.abs((movingLeft ? loggedL : loggedR) - yAtHit) <= half + cfg.ballRadius
      console.log('VALIDATE event ' + JSON.stringify({
        idx: eventIdx,
        dir: state.dir,
        tHit,
        dt: dtToPaddle,
        yAtHit,
        loggedL,
        loggedR,
        hit,
        rally: rallyId,
      }))

      // Advance to tHit
      state.x = movingLeft ? leftFace + cfg.ballRadius : rightFace - cfg.ballRadius
      state.y = yAtHit
      state.t0 = tHit
      state.leftY = loggedL
      state.rightY = loggedR

      if (hit) {
        const contactY = movingLeft ? loggedL : loggedR
        const { vx, vy, speed, dir } = bounce(state, contactY)
        state.vx = vx
        state.vy = vy
        state.speed = speed
        state.dir = dir
      } else {
        if (movingLeft) state.rightScore++
        else state.leftScore++
        console.log('VALIDATE miss ' + JSON.stringify({ by: movingLeft ? 'LEFT' : 'RIGHT', leftScore: state.leftScore, rightScore: state.rightScore, rally: rallyId }))
        if (state.leftScore >= cfg.pointsToWin || state.rightScore >= cfg.pointsToWin) {
          state.ended = true
          break
        }
        const receiverDir: -1 | 1 = movingLeft ? 1 : -1
        const next = serve(receiverDir, state.t0)
        next.leftY = state.leftY
        next.rightY = state.rightY
        next.leftScore = state.leftScore
        next.rightScore = state.rightScore
        state = next
        rallyId++
        console.log('VALIDATE serve ' + JSON.stringify({
          receiverDir: state.dir,
          t0: state.t0,
          vx: state.vx,
          vy: state.vy,
          speed: state.speed,
          leftScore: state.leftScore,
          rightScore: state.rightScore,
          rally: rallyId,
        }))
      }

      eventIdx++
    }

    return { fair: true, leftScore: state.leftScore, rightScore: state.rightScore }
  } catch (e) {
    return { fair: false, reason: 'Validation error', leftScore: 0, rightScore: 0 }
  }
}
