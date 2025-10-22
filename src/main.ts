import './style.css'
import { runGame, validateLog } from './pong/engine'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div style="display:flex; gap:16px; align-items:flex-start;">
    <div>
      <canvas id="canvas" width="800" height="480" style="border:1px solid #ccc; background:#111"></canvas>
      <div style="margin-top:8px; display:flex; gap:8px; align-items:center;">
        <button id="start">Start Match</button>
        <button id="validate" disabled>Validate Log</button>
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
      <textarea id="log" style="width:100%; height:420px;"></textarea>
    </div>
  </div>
`

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const startBtn = document.getElementById('start') as HTMLButtonElement
const validateBtn = document.getElementById('validate') as HTMLButtonElement
const downloadBtn = document.getElementById('download') as HTMLButtonElement
const uploadInput = document.getElementById('upload') as HTMLInputElement
const scoreSpan = document.getElementById('score') as HTMLSpanElement
const logArea = document.getElementById('log') as HTMLTextAreaElement

let currentCancel: (() => void) | null = null
let currentLog: any = null

startBtn.onclick = () => {
  if (currentCancel) {
    currentCancel()
    currentCancel = null
  }
  const { cancel, onUpdate, getLog } = runGame(canvas)

  currentCancel = cancel
  validateBtn.disabled = true
  downloadBtn.disabled = true
  scoreSpan.textContent = 'Score: 0 - 0'

  onUpdate((state) => {
    scoreSpan.textContent = `Score: ${state.leftScore} - ${state.rightScore}`
    if (state.ended) {
      currentLog = getLog()
      logArea.value = JSON.stringify(currentLog)
      validateBtn.disabled = false
      downloadBtn.disabled = false
      currentCancel = null
    }
  })
}

validateBtn.onclick = () => {
  try {
    const parsed = JSON.parse(logArea.value)
    const result = validateLog(parsed)
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
    const blob = new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' })
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

uploadInput.onchange = async () => {
  const file = uploadInput.files && uploadInput.files[0]
  if (!file) return
  try {
    const text = await file.text()
    const parsed = JSON.parse(text)
    currentLog = parsed
    logArea.value = JSON.stringify(parsed)
    validateBtn.disabled = false
    downloadBtn.disabled = false
    // Optionally show score from the uploaded log
    const res = validateLog(parsed)
    scoreSpan.textContent = `Score: ${res.leftScore} - ${res.rightScore}`
  } catch (e) {
    alert('Failed to read/parse uploaded log')
  } finally {
    uploadInput.value = ''
  }
}
