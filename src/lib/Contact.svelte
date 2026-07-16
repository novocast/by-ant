<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import { missionFlown } from './launchStore'
  import shuttleUrl from '../assets/shuttle.svg'
  import launchpadBgUrl from '../assets/launchpad-background.svg'
  import launchpadFgUrl from '../assets/launchpad-foreground.svg'
  import launchpadArmUrl from '../assets/launchpad-arm.svg'

  let scrollY = 0
  let rocketState: 'idle' | 'filling' | 'launching' | 'flying' = 'idle'
  let rocketY = 0
  let rumbleX = 0
  let rumbleY = 0
  let formSubmitting = false
  let formSuccess = false
  let contactSection: HTMLElement
  let shuttleImg: HTMLImageElement

  let formData: Record<string, string> = {}

  // ─── Twinkling stars (top of the sunset sky) ────────────────────
  //
  // A handful of tiny, barely-there dots in the darkest band of sky at
  // the top of the section. Positions/timings come from a deterministic
  // hash rather than Math.random() per-star so the layout is stable —
  // this is decorative and client-only, so it doesn't matter for SSR,
  // but a stable hash keeps things simple to reason about.
  interface Star {
    x: number // %
    y: number // % — within the star layer only (top 35% of the section)
    size: number // px
    peak: number // brightest opacity reached mid-twinkle
    duration: number // s
    delay: number // s
    glow: boolean // a few stars get a soft glow instead of a bare dot
  }

  function starHash(seed: number): number {
    const v = Math.sin(seed * 12.9898) * 43758.5453
    return v - Math.floor(v)
  }

  const STAR_COUNT = 42
  const stars: Star[] = Array.from({ length: STAR_COUNT }, (_, i) => {
    const r1 = starHash(i * 3.1 + 1)
    const r2 = starHash(i * 7.7 + 2)
    const r3 = starHash(i * 5.3 + 3)
    const r4 = starHash(i * 2.3 + 4)
    const r5 = starHash(i * 9.1 + 5)
    // bias toward the top of the layer — squaring pushes most stars up
    // into the darkest band, thinning out fast toward the bottom
    const y = Math.pow(r2, 1.8) * 100
    return {
      x: r1 * 100,
      y,
      size: 1 + r3 * 1.5,
      // brightest near the top, fading to nothing by the layer's bottom
      peak: Math.max(0, 0.75 - (y / 100) * 0.8) * (0.65 + r4 * 0.35),
      duration: 2 + r4 * 3,
      delay: r5 * 5,
      glow: r3 > 0.85,
    }
  })

  $: formValid =
    !!formData['name']?.trim() &&
    !!formData['email']?.trim() &&
    !!formData['message']?.trim() &&
    formData['message']!.trim().length > 20

  // ─── Mission-milestone status line (desktop form only) ─────────
  //
  // Reflects progress through the form as a small ground-control style
  // status line beneath the section label. Checked most-complete-first
  // so a filled-out message wins over an in-progress email, etc.
  $: missionStatus =
    formData['message']?.trim() && formData['message']!.trim().length > 20
      ? 'Go for launch'
    : formData['email']?.trim()
      ? 'Comms check complete'
    : formData['name']?.trim()
      ? 'Crew confirmed'
      : ''

  // Same progression drives the Mission Control HUD's LOX gauge
  $: loxPercent =
    formData['message']?.trim() && formData['message']!.trim().length > 20 ? 94
    : formData['email']?.trim() ? 62
    : formData['name']?.trim() ? 31
    : 9

  $: padStatus =
    rocketState === 'launching' ? 'IGNITION'
    : rocketState === 'flying' ? 'VEHICLE AWAY'
    : 'NOMINAL'

  function loxBar(pct: number): string {
    const filled = Math.round((pct / 100) * 10)
    return '█'.repeat(filled) + '░'.repeat(10 - filled)
  }

  // ─── T-minus countdown overlay (launch-button hold) ─────────────
  //
  // A tiny state machine driven by setTimeout chains, timed to line up
  // with the existing hold-downs in justLaunch() (1400ms) and the
  // post-success hold in handleSubmit() (700ms). Timer ids are tracked
  // so they can be cleared on unmount or before a fresh countdown.
  let countdownText = ''
  let countdownTimers: ReturnType<typeof setTimeout>[] = []

  function clearCountdownTimers() {
    for (const id of countdownTimers) clearTimeout(id)
    countdownTimers = []
  }

  function runCountdown(steps: { text: string; at: number }[]) {
    clearCountdownTimers()
    for (const { text, at } of steps) {
      countdownTimers.push(
        setTimeout(() => {
          countdownText = text
        }, at),
      )
    }
  }

  // ─── Mission Control HUD (easter egg) ───────────────────────────
  let hudOpen = false
  function toggleHud() {
    hudOpen = !hudOpen
  }

  // ═══ FX engine — one canvas for flames + smoke ═════════════════
  //
  // Everything is drawn on a single section-sized canvas in one rAF
  // loop. SRB nozzle positions are measured from the shuttle <img>'s
  // bounding rect every frame, so the effects stay glued to the
  // boosters at any viewport scale, scroll offset, and during ascent.

  let fxCanvas: HTMLCanvasElement
  let fxCtx: CanvasRenderingContext2D | null = null
  let fxRunning = false
  let fxFrame = 0
  let fxW = 0
  let fxH = 0
  let fxDpr = 1
  // section origin in viewport coords, refreshed every frame — the fx
  // canvas is viewport-fixed but everything is drawn in section coords
  let secLeft = 0
  let secTop = 0
  // viewport-fixed shuttle: distance from viewport bottom to the
  // section bottom, so the shuttle stays glued to the pad while
  // escaping the section's overflow clipping during ascent
  let shuttleBottom = 0
  let rocketGone = false
  let lastTick = 0
  let flameTime = 0
  let intensity = 0 // eased flame throttle: 0 idle → ~0.42 filling → 1 launch
  // Flight time accumulated from clamped frame deltas (not wall clock),
  // so a throttled/backgrounded tab can't teleport the rocket off-screen
  let flyT = 0
  // eased opacity of the "camera tracking the ascent" vignette (0 → 1),
  // driven from tick() exactly like `intensity`
  let flightVignette = 0

  // SRB nozzle centerlines as fractions of the shuttle image box,
  // measured from the booster geometry in shuttle.svg
  // (left SRB x 113–256, right SRB x 593–717, viewBox width 846.6)
  const LEFT_SRB = 0.218
  const RIGHT_SRB = 0.774
  const NOZZLE_Y = 0.975

  interface Puff {
    x: number
    y: number
    vx: number // px/s
    vy: number // px/s
    size: number
    growth: number // px/s
    opacity: number
    decay: number // opacity/s
    dir: number // which way this puff deflects when it slams the pad
    grounded: boolean
    sprite: number
  }

  // Plain (non-reactive) array — puffs live on the canvas only
  let puffs: Puff[] = []
  const MAX_PUFFS = 2000
  let emitCarry = 0
  let trailCarry = 0

  // Live nozzle geometry (follows the rocket) and pad geometry
  // (frozen at liftoff so the ground cloud stays on the pad)
  let noz = { leftX: 0, rightX: 0, y: 0, scale: 220 }
  let pad = { leftX: 0, rightX: 0, y: 0, groundY: 0, scale: 220 }

  // Pre-rendered soft puff sprites — drawImage of a cached sprite is
  // far cheaper than a per-particle radial gradient
  let sprites: HTMLCanvasElement[] = []

  function makePuffSprite(warmth: number): HTMLCanvasElement {
    const r = 64
    const c = document.createElement('canvas')
    c.width = c.height = r * 2
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(r * 0.92, r * 0.86, r * 0.1, r, r, r)
    grad.addColorStop(0, `rgba(255, ${251 - warmth * 12}, ${244 - warmth * 28}, 0.92)`)
    grad.addColorStop(0.4, `rgba(233, ${228 - warmth * 10}, ${226 - warmth * 22}, 0.55)`)
    grad.addColorStop(0.75, 'rgba(196, 199, 208, 0.22)')
    grad.addColorStop(1, 'rgba(176, 181, 192, 0)')
    g.fillStyle = grad
    g.fillRect(0, 0, r * 2, r * 2)
    return c
  }

  function ensureSprites() {
    if (sprites.length === 0) {
      sprites = [makePuffSprite(0), makePuffSprite(0.5), makePuffSprite(1)]
    }
  }

  // ─── Ambient pad mist (always-on, behind the foreground art) ───

  let ambientCanvas: HTMLCanvasElement
  let ambientCtx: CanvasRenderingContext2D | null = null
  let ambientFrame = 0
  let ambientLast = 0
  let ambientRunning = false

  interface AmbPuff {
    x: number
    y: number
    vx: number
    size: number
    age: number
    life: number
    peak: number
    sprite: number
  }
  let ambPuffs: AmbPuff[] = []
  const AMB_MAX = 44

  function resizeAmbient() {
    if (!ambientCanvas) return
    const parent = ambientCanvas.parentElement!
    ambientCanvas.width = parent.clientWidth
    ambientCanvas.height = parent.clientHeight
  }

  function spawnAmbient(w: number, h: number, midLife: boolean) {
    const life = 8 + Math.random() * 8
    ambPuffs.push({
      x: Math.random() * w,
      // hug the pad surface — keep the haze low so it doesn't wash
      // out the background scenery
      y: h * (0.55 + Math.random() * 0.3),
      vx: (Math.random() - 0.5) * w * 0.014,
      size: w * (0.09 + Math.random() * 0.14),
      age: midLife ? Math.random() * life : 0,
      life,
      peak: 0.3 + Math.random() * 0.25,
      sprite: (Math.random() * 3) | 0,
    })
  }

  function ambientTick(now: number) {
    if (!ambientRunning) return
    const dt = Math.min((now - ambientLast) / 1000, 0.05)
    ambientLast = now
    const ctx = ambientCtx!
    const w = ambientCanvas.width
    const h = ambientCanvas.height
    ctx.clearRect(0, 0, w, h)

    if (ambPuffs.length < AMB_MAX && Math.random() < dt * 6) spawnAmbient(w, h, false)

    for (let i = ambPuffs.length - 1; i >= 0; i--) {
      const p = ambPuffs[i]
      p.age += dt
      if (p.age >= p.life) {
        ambPuffs[i] = ambPuffs[ambPuffs.length - 1]
        ambPuffs.pop()
        continue
      }
      p.x += p.vx * dt
      p.y -= p.size * 0.01 * dt
      // fade in, drift, fade out
      ctx.globalAlpha = p.peak * Math.sin(Math.PI * (p.age / p.life))
      const half = p.size / 2
      ctx.drawImage(sprites[p.sprite], p.x - half, p.y - half, p.size, p.size)
    }
    ctx.globalAlpha = 1
    ambientFrame = requestAnimationFrame(ambientTick)
  }

  function seedAmbient() {
    // pre-seed mid-life puffs so the pad isn't bare on first paint
    ambPuffs = []
    for (let i = 0; i < AMB_MAX * 0.6; i++) {
      spawnAmbient(ambientCanvas.width, ambientCanvas.height, true)
    }
  }

  /**
   * (Re)start the ambient mist. Runs on mount and again when the
   * launchpad background image finishes loading — before that load the
   * container has zero height, so the initial seed is degenerate and
   * the mist wouldn't appear until something else resized the canvas.
   */
  function startAmbient() {
    if (!ambientCanvas) return
    ensureSprites()
    if (!ambientCtx) ambientCtx = ambientCanvas.getContext('2d')!
    resizeAmbient()
    seedAmbient()
    if (!ambientRunning) {
      ambientRunning = true
      ambientLast = performance.now()
      ambientFrame = requestAnimationFrame(ambientTick)
    }
  }

  // ─── Ambient birds (sparse silhouettes drifting across the sky) ─
  //
  // A handful of stylized flapping "V" shapes crossing the top of the
  // section at varying depths. They live on their own lightweight
  // canvas (section-local coords) with its own rAF, spawn sparsely
  // while things are calm, and scatter hard when the engines light.

  let birdCanvas: HTMLCanvasElement
  let birdCtx: CanvasRenderingContext2D | null = null
  let birdFrame = 0
  let birdLast = 0
  let birdRunning = false
  let birdW = 0
  let birdH = 0
  let birdDpr = 1
  let birdDrewLast = false
  let birdPrevState: 'idle' | 'filling' | 'launching' | 'flying' = rocketState

  interface Bird {
    x: number
    y: number
    vx: number // px/s
    vy: number // px/s
    size: number // wing half-span, ~8–20px
    flap: number // wing phase
    flapSpeed: number // rad/s
    scattered: boolean
  }
  let birds: Bird[] = []
  const BIRD_MAX = 6

  function resizeBirds() {
    if (!birdCanvas || !contactSection) return
    birdW = contactSection.clientWidth
    birdH = contactSection.clientHeight
    birdDpr = Math.min(window.devicePixelRatio || 1, 1.5)
    birdCanvas.width = birdW * birdDpr
    birdCanvas.height = birdH * birdDpr
    birdCanvas.style.width = birdW + 'px'
    birdCanvas.style.height = birdH + 'px'
  }

  function spawnBird() {
    const fromLeft = Math.random() < 0.5
    const size = 8 + Math.random() * 12 // 8–20px
    // smaller birds read as further away, so drift a touch slower
    const speed = birdW * (0.03 + (size / 20) * 0.05)
    birds.push({
      x: fromLeft ? -size * 3 : birdW + size * 3,
      y: birdH * (0.05 + Math.random() * 0.4), // top ~45%
      vx: fromLeft ? speed : -speed,
      vy: (Math.random() - 0.5) * birdH * 0.01,
      size,
      flap: Math.random() * Math.PI * 2,
      flapSpeed: 6 + Math.random() * 4,
      scattered: false,
    })
  }

  /** Kick every live bird away from the pad on ignition */
  function scatterBirds() {
    const centreX = pad.leftX > 0 ? (pad.leftX + pad.rightX) / 2 : birdW * 0.42
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i]
      const dir = b.x < centreX ? -1 : 1
      b.vx = dir * birdW * (0.5 + Math.random() * 0.3)
      b.vy = -birdH * (0.25 + Math.random() * 0.2)
      b.flapSpeed = 18 + Math.random() * 8
      b.scattered = true
    }
  }

  function drawBird(ctx: CanvasRenderingContext2D, b: Bird) {
    const w = b.size
    const flap = Math.sin(b.flap) // -1 .. 1
    const tipY = b.y - flap * w * 0.55 // wing tips rise & fall
    const midY = b.y + w * 0.12 // slight body dip
    ctx.lineWidth = Math.max(1, w * 0.11)
    ctx.beginPath()
    ctx.moveTo(b.x - w, tipY)
    ctx.quadraticCurveTo(b.x - w * 0.45, midY, b.x, b.y)
    ctx.quadraticCurveTo(b.x + w * 0.45, midY, b.x + w, tipY)
    ctx.stroke()
  }

  function birdTick(now: number) {
    if (!birdRunning) return
    const dt = Math.min((now - birdLast) / 1000, 0.05)
    birdLast = now

    // scatter the instant the engines light
    if (rocketState === 'launching' && birdPrevState !== 'launching') scatterBirds()
    birdPrevState = rocketState

    // birds only appear while calm: idle, filling, or long after the
    // rocket has gone and the fx have wound down
    const canSpawn =
      rocketState === 'idle' ||
      rocketState === 'filling' ||
      (rocketState === 'flying' && rocketGone)
    if (canSpawn && birds.length < BIRD_MAX && Math.random() < dt * 0.22) spawnBird()

    const margin = 80
    for (let i = birds.length - 1; i >= 0; i--) {
      const b = birds[i]
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.flap += b.flapSpeed * dt
      if (b.x < -margin || b.x > birdW + margin || b.y < -margin || b.y > birdH + margin) {
        birds[i] = birds[birds.length - 1]
        birds.pop()
      }
    }

    // skip all canvas work when nothing's alive (clear the trailing frame)
    const alive = birds.length > 0
    if (alive || birdDrewLast) {
      const ctx = birdCtx!
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, birdCanvas.width, birdCanvas.height)
      if (alive) {
        ctx.setTransform(birdDpr, 0, 0, birdDpr, 0, 0)
        ctx.strokeStyle = 'rgba(30, 25, 35, 0.75)'
        ctx.lineCap = 'round'
        for (let i = 0; i < birds.length; i++) drawBird(ctx, birds[i])
      }
    }
    birdDrewLast = alive

    birdFrame = requestAnimationFrame(birdTick)
  }

  function startBirds() {
    if (!birdCanvas || birdRunning) return
    if (!birdCtx) birdCtx = birdCanvas.getContext('2d')!
    resizeBirds()
    birdRunning = true
    birdLast = performance.now()
    birdFrame = requestAnimationFrame(birdTick)
  }

  // ─── Launch steam curtain (in front of the pad foreground) ─────
  //
  // Full-width plume on its own canvas layered above the foreground
  // art. It builds up from the bottom edge on launch — densest and
  // tallest at the screen edges, echoing the ground cloud that gets
  // deflected sideways off the pad — and fades as it climbs.

  let curtainCanvas: HTMLCanvasElement
  let curtainCtx: CanvasRenderingContext2D | null = null

  interface CurtainPuff {
    x: number
    y: number
    vx: number
    vy: number
    size: number
    growth: number
    opacity: number
    decay: number
    sprite: number
  }
  let curtain: CurtainPuff[] = []
  const CURTAIN_MAX = 1500
  let curtainCarry = 0

  function spawnCurtain(burst: boolean) {
    const w = fxW
    const s = w * 0.17

    // ~half the output is heavy base filler: big, dense, slow-rising
    // puffs that wall off the bottom of the page but dissipate fast
    if (Math.random() < 0.48) {
      curtain.push({
        x: w * Math.random(),
        y: fxH + s * (Math.random() * 0.15) - (burst ? Math.random() * s * 0.4 : 0),
        vx: (Math.random() - 0.5) * s * 0.12,
        vy: -s * (0.06 + Math.random() * 0.16),
        size: s * (0.24 + Math.random() * 0.3),
        growth: s * (0.12 + Math.random() * 0.14),
        opacity: 0.55 + Math.random() * 0.35,
        decay: 0.2 + Math.random() * 0.12,
        sprite: (Math.random() * 3) | 0,
      })
      return
    }

    // bias spawns toward the screen edges, hugging them tighter the
    // closer they get, with extra upward kick at the very edge
    const edge = Math.random() < 0.62
    let x: number
    let edgeBoost = 0
    if (edge) {
      const t = Math.pow(Math.random(), 1.6)
      x = Math.random() < 0.5 ? w * 0.16 * t : w - w * 0.16 * t
      edgeBoost = 1 - t
    } else {
      x = w * (0.08 + Math.random() * 0.84)
    }
    curtain.push({
      x,
      y: fxH + s * (0.02 + Math.random() * 0.2) - (burst ? Math.random() * s * 0.5 : 0),
      vx: (x < w / 2 ? -1 : 1) * s * Math.random() * 0.1,
      vy: -s * (0.3 + Math.random() * 0.45) * (1 + edgeBoost),
      size: s * (0.14 + Math.random() * 0.2) * (1 + edgeBoost * 0.5),
      growth: s * (0.08 + Math.random() * 0.1),
      opacity: 0.4 + Math.random() * 0.35,
      decay: 0.11 + Math.random() * 0.08,
      sprite: (Math.random() * 3) | 0,
    })
  }

  function emitCurtain(dt: number) {
    let rate = 0
    if (rocketState === 'launching') rate = 520
    else if (rocketState === 'flying') rate = 520 * Math.max(0, 1 - flyT / 8)
    curtainCarry += rate * dt
    while (curtainCarry >= 1) {
      curtainCarry -= 1
      spawnCurtain(false)
    }
    if (curtain.length > CURTAIN_MAX) curtain.splice(0, curtain.length - CURTAIN_MAX)
  }

  function updateDrawCurtain(dt: number) {
    const ctx = curtainCtx
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, curtainCanvas.width, curtainCanvas.height)
    ctx.setTransform(fxDpr, 0, 0, fxDpr, 0, 0)
    const drag = Math.pow(0.72, dt) // plume decelerates as it climbs
    for (let i = curtain.length - 1; i >= 0; i--) {
      const p = curtain[i]
      p.vy *= drag
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.size += p.growth * dt
      p.opacity -= p.decay * dt
      if (p.opacity <= 0.015 || p.y < -p.size) {
        curtain[i] = curtain[curtain.length - 1]
        curtain.pop()
        continue
      }
      ctx.globalAlpha = Math.min(p.opacity, 1)
      const half = p.size / 2
      ctx.drawImage(sprites[p.sprite], p.x - half, p.y - half, p.size, p.size)
    }
    ctx.globalAlpha = 1
  }

  function resizeFx() {
    resizeAmbient()
    resizeBirds()
    if (!fxCanvas || !contactSection) return
    fxW = contactSection.clientWidth
    fxH = contactSection.clientHeight
    fxDpr = Math.min(window.devicePixelRatio || 1, 1.5)
    // fx canvas covers the viewport (position: fixed) so the rocket and
    // its trail stay visible past the section top; per-frame transforms
    // in tick() map section coords onto it
    fxCanvas.width = window.innerWidth * fxDpr
    fxCanvas.height = window.innerHeight * fxDpr
    fxCanvas.style.width = window.innerWidth + 'px'
    fxCanvas.style.height = window.innerHeight + 'px'
    if (curtainCanvas) {
      curtainCanvas.width = fxW * fxDpr
      curtainCanvas.height = fxH * fxDpr
      curtainCanvas.style.width = fxW + 'px'
      curtainCanvas.style.height = fxH + 'px'
    }
  }

  function startFx() {
    if (fxRunning) return
    if (!fxCtx) {
      fxCtx = fxCanvas.getContext('2d')!
      curtainCtx = curtainCanvas?.getContext('2d') ?? null
      ensureSprites()
    }
    resizeFx()
    fxRunning = true
    lastTick = performance.now()
    fxFrame = requestAnimationFrame(tick)
  }

  /** Measure nozzle positions from the live shuttle rect (section-local px) */
  function measure(): boolean {
    if (!contactSection || !shuttleImg) return false
    const sec = contactSection.getBoundingClientRect()
    secLeft = sec.left
    secTop = sec.top
    shuttleBottom = window.innerHeight - sec.bottom
    const r = shuttleImg.getBoundingClientRect()
    if (r.width < 4) return false // shuttle hidden (mobile)
    const left = r.left - sec.left
    const top = r.top - sec.top
    noz = {
      leftX: left + r.width * LEFT_SRB,
      rightX: left + r.width * RIGHT_SRB,
      y: top + r.height * NOZZLE_Y,
      scale: r.width,
    }
    if (rocketState !== 'flying') {
      pad = { ...noz, groundY: noz.y + r.width * 0.12 }
    }
    return true
  }

  // ─── Smoke ─────────────────────────────────────────────────────

  function pickSource(): { x: number; dir: number } {
    return Math.random() < 0.5
      ? { x: pad.leftX, dir: -1 }
      : { x: pad.rightX, dir: 1 }
  }

  /** Exhaust jet fired down from a nozzle — slams the pad, then spreads */
  function spawnJet(big: boolean) {
    const { x, dir } = pickSource()
    const s = pad.scale
    if (big) {
      puffs.push({
        x: x + (Math.random() - 0.5) * s * 0.08,
        y: pad.y + Math.random() * s * 0.03,
        vx: (Math.random() - 0.5) * s * 0.25,
        vy: s * (1.6 + Math.random() * 1.6),
        size: s * (0.08 + Math.random() * 0.1),
        growth: s * (0.08 + Math.random() * 0.08),
        opacity: 0.5 + Math.random() * 0.35,
        decay: 0.065 + Math.random() * 0.035,
        dir,
        grounded: false,
        sprite: (Math.random() * 3) | 0,
      })
    } else {
      // pre-launch wisps: jetting down hard enough to spread on the pad
      puffs.push({
        x: x + (Math.random() - 0.5) * s * 0.06,
        y: pad.y + Math.random() * s * 0.04,
        vx: (Math.random() - 0.5) * s * 0.22,
        vy: s * (0.3 + Math.random() * 0.4),
        size: s * (0.04 + Math.random() * 0.07),
        growth: s * (0.03 + Math.random() * 0.03),
        opacity: 0.22 + Math.random() * 0.18,
        decay: 0.05 + Math.random() * 0.03,
        dir,
        grounded: false,
        sprite: (Math.random() * 3) | 0,
      })
    }
  }

  /** Ground-cloud puff erupting sideways from the pad (used post-liftoff) */
  function spawnGround() {
    const { x, dir } = pickSource()
    const s = pad.scale
    puffs.push({
      x: x + dir * Math.random() * s * 0.3,
      y: pad.groundY - Math.random() * s * 0.06,
      vx: dir * s * (0.5 + Math.random() * 1.7),
      vy: -s * (0.04 + Math.random() * 0.2),
      size: s * (0.12 + Math.random() * 0.16),
      growth: s * (0.1 + Math.random() * 0.12),
      opacity: 0.45 + Math.random() * 0.3,
      decay: 0.06 + Math.random() * 0.04,
      dir,
      grounded: true,
      sprite: (Math.random() * 3) | 0,
    })
  }

  /** Instant wall of smoke at ignition (T-0) */
  function igniteBurst() {
    measure() // pad geometry may not be set yet (e.g. launch without typing)
    for (let i = 0; i < 240; i++) spawnJet(true)
    for (let i = 0; i < 180; i++) spawnGround()
    for (let i = 0; i < 260; i++) spawnCurtain(true)
  }

  function emit(dt: number) {
    let rate = 0
    if (rocketState === 'filling') rate = 48
    else if (rocketState === 'launching') rate = 240
    else if (rocketState === 'flying') {
      // pad cloud keeps churning long after liftoff
      rate = 240 * Math.max(0, 1 - flyT / 7)
    }
    emitCarry += rate * dt
    while (emitCarry >= 1) {
      emitCarry -= 1
      if (rocketState === 'flying') Math.random() < 0.55 ? spawnGround() : spawnJet(true)
      else spawnJet(rocketState === 'launching')
    }

    // exhaust trail from the climbing rocket — keep emitting while the
    // nozzles are anywhere near the viewport (canvas is viewport-fixed)
    if (rocketState === 'flying' && noz.y + secTop > -noz.scale) {
      trailCarry += 210 * dt
      while (trailCarry >= 1) {
        trailCarry -= 1
        const x = Math.random() < 0.5 ? noz.leftX : noz.rightX
        const s = noz.scale
        puffs.push({
          x: x + (Math.random() - 0.5) * s * 0.06,
          y: noz.y + Math.random() * s * 0.05,
          vx: (Math.random() - 0.5) * s * 0.15,
          vy: s * (0.4 + Math.random() * 0.7),
          size: s * (0.06 + Math.random() * 0.08),
          growth: s * (0.12 + Math.random() * 0.1),
          opacity: 0.45 + Math.random() * 0.3,
          decay: 0.13 + Math.random() * 0.07,
          dir: Math.random() < 0.5 ? -1 : 1,
          grounded: false,
          sprite: (Math.random() * 3) | 0,
        })
      }
    }

    if (puffs.length > MAX_PUFFS) puffs.splice(0, puffs.length - MAX_PUFFS)
  }

  function updatePuffs(dt: number) {
    const s = pad.scale
    const drag = Math.pow(0.5, dt) // grounded vx halves each second
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i]
      if (!p.grounded) {
        p.vy += s * 0.5 * dt
        if (p.y >= pad.groundY && p.vy > 0) {
          // pad slam: vertical momentum deflects outward along the ground
          p.grounded = true
          const kick = Math.abs(p.vy)
          p.vx = p.dir * (kick * (0.7 + Math.random() * 0.7) + s * 0.2)
          p.vy = -kick * (0.05 + Math.random() * 0.1)
        }
      } else {
        p.vx *= drag
        p.vy -= s * 0.28 * dt // buoyancy: cloud slowly billows upward
        if (p.vy < -s * 0.22) p.vy = -s * 0.22
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.size += p.growth * dt * (p.grounded ? 1.5 : 1)
      p.opacity -= p.decay * dt
      if (p.opacity <= 0.012 || p.x < -p.size - fxW * 0.2 || p.x > fxW + p.size + fxW * 0.2) {
        puffs[i] = puffs[puffs.length - 1]
        puffs.pop()
      }
    }
  }

  function drawPuffs(ctx: CanvasRenderingContext2D) {
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i]
      ctx.globalAlpha = Math.min(p.opacity, 1)
      const half = p.size / 2
      ctx.drawImage(sprites[p.sprite], p.x - half, p.y - half, p.size, p.size)
    }
    ctx.globalAlpha = 1
  }

  // ─── Heat shimmer ──────────────────────────────────────────────
  //
  // Subtle refraction over the exhaust: copy thin horizontal slices of
  // the already-drawn canvas region under the nozzles back onto itself,
  // nudged sideways by a smooth sine. The self-copy works in DEVICE
  // pixels, so we drop the section transform for the duration.

  function drawHeatShimmer(ctx: CanvasRenderingContext2D) {
    const s = noz.scale
    // region under the nozzles, in section-local px → device px
    const leftSec = noz.leftX - s * 0.12
    const topSec = noz.y + s * 0.05
    let sx = (secLeft + leftSec) * fxDpr
    let sw = (noz.rightX + s * 0.12 - leftSec) * fxDpr
    const dyTop = (secTop + topSec) * fxDpr
    const regionH = s * 0.9 * fxDpr
    // clamp the source rect inside the canvas
    if (sx < 0) {
      sw += sx
      sx = 0
    }
    if (sx + sw > fxCanvas.width) sw = fxCanvas.width - sx
    if (sw <= 0 || regionH <= 0) return

    const sliceH = Math.max(2, Math.round(4 * fxDpr))
    const amp = s * 0.02 * fxDpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 0.16
    for (let sy = 0; sy < regionH; sy += sliceH) {
      const y = dyTop + sy
      if (y < 0 || y + sliceH > fxCanvas.height) continue
      const shift = Math.sin(flameTime * 6 + sy * 0.03) * amp
      ctx.drawImage(fxCanvas, sx, y, sw, sliceH, sx + shift, y, sw, sliceH)
    }
    ctx.globalAlpha = 1
    // restore the section transform for anything that draws after us
    ctx.setTransform(fxDpr, 0, 0, fxDpr, secLeft * fxDpr, secTop * fxDpr)
  }

  // ─── Flames ────────────────────────────────────────────────────

  function flamePath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    len: number,
    w: number,
    t: number,
    seed: number,
  ) {
    // Tube profile: near-constant width down the column, tapering at the tip
    const N = 14
    const tube = (f: number) => 0.5 * (1 - Math.pow(f, 3.2) * 0.9)
    ctx.beginPath()
    ctx.moveTo(x - w * 0.5, y)
    for (let i = 1; i <= N; i++) {
      const f = i / N
      const hw = w * tube(f) * (1 + Math.sin(t * 30 + seed + f * 14) * 0.1)
      const wob = Math.sin(t * 21 + seed + f * 9) * w * 0.1 * f
      ctx.lineTo(x - hw + wob, y + len * f)
    }
    for (let i = N - 1; i >= 1; i--) {
      const f = i / N
      const hw = w * tube(f) * (1 + Math.sin(t * 27 + seed * 1.7 + f * 11) * 0.1)
      const wob = Math.sin(t * 23 + seed * 2.3 + f * 8) * w * 0.1 * f
      ctx.lineTo(x + hw + wob, y + len * f)
    }
    ctx.closePath()
  }

  function drawFlame(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    power: number,
    seed: number,
  ) {
    const s = noz.scale
    const flick = 0.86 + 0.14 * Math.sin(flameTime * 31 + seed * 7) * Math.sin(flameTime * 12.3 + seed)
    const len = s * (0.14 + 0.62 * power) * flick
    // width grows superlinearly with throttle: slim idle jets,
    // full-thrust columns a touch narrower than the boosters
    const w = s * (0.05 + 0.13 * power * power)

    // outer plume
    flamePath(ctx, x, y - len * 0.02, len, w * 1.35, flameTime, seed)
    let g = ctx.createLinearGradient(x, y, x, y + len)
    g.addColorStop(0, `rgba(255, 150, 40, ${0.85 * power})`)
    g.addColorStop(0.45, `rgba(255, 84, 14, ${0.6 * power})`)
    g.addColorStop(1, 'rgba(180, 30, 4, 0)')
    ctx.fillStyle = g
    ctx.fill()

    // hot core
    flamePath(ctx, x, y, len * 0.62, w * 0.62, flameTime * 1.4, seed + 11)
    g = ctx.createLinearGradient(x, y, x, y + len * 0.62)
    g.addColorStop(0, `rgba(255, 255, 250, ${0.95 * power})`)
    g.addColorStop(0.5, `rgba(255, 226, 120, ${0.8 * power})`)
    g.addColorStop(1, 'rgba(255, 160, 40, 0)')
    ctx.fillStyle = g
    ctx.fill()
  }

  function drawFlamesAll(ctx: CanvasRenderingContext2D) {
    ctx.globalCompositeOperation = 'lighter'

    // warm light spilling over the pad
    const glowFlick = 0.8 + 0.2 * Math.sin(flameTime * 17.7)
    const glowA = 0.16 * intensity * glowFlick
    if (glowA > 0.01) {
      const gx = (pad.leftX + pad.rightX) / 2
      const gr = pad.scale * 1.9
      const gg = ctx.createRadialGradient(gx, pad.groundY, 0, gx, pad.groundY, gr)
      gg.addColorStop(0, `rgba(255, 176, 80, ${glowA})`)
      gg.addColorStop(0.5, `rgba(255, 120, 44, ${glowA * 0.45})`)
      gg.addColorStop(1, 'rgba(255, 90, 30, 0)')
      ctx.fillStyle = gg
      ctx.fillRect(gx - gr, pad.groundY - gr, gr * 2, gr * 2)
    }

    drawFlame(ctx, noz.leftX, noz.y, intensity, 1)
    drawFlame(ctx, noz.rightX, noz.y, intensity, 5)

    ctx.globalCompositeOperation = 'source-over'
  }

  // ─── Main loop ─────────────────────────────────────────────────

  function tick(now: number) {
    if (!fxRunning) return
    const dt = Math.min((now - lastTick) / 1000, 0.05)
    lastTick = now
    flameTime += dt

    const visible = measure()
    const ctx = fxCtx!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, fxCanvas.width, fxCanvas.height)
    // map section-local coordinates onto the viewport-fixed canvas
    ctx.setTransform(fxDpr, 0, 0, fxDpr, secLeft * fxDpr, secTop * fxDpr)

    // throttle eases up on ignition, snaps harder on launch
    const target =
      rocketState === 'launching' || rocketState === 'flying' ? 1
      : rocketState === 'filling' ? 0.42
      : 0
    intensity += (target - intensity) * Math.min(1, dt * (target > intensity ? 2.4 : 4))

    // "camera tracking the ascent": vignette in while the rocket is
    // flying and its nozzles are somewhere in the viewport, out otherwise
    const nozViewY = noz.y + secTop
    const tracking = rocketState === 'flying' && nozViewY > 0 && nozViewY < window.innerHeight
    const vigTarget = tracking ? 1 : 0
    flightVignette +=
      (vigTarget - flightVignette) * Math.min(1, dt * (vigTarget > flightVignette ? 2 : 3))

    // ascent: slow crawl off the pad, accelerating like the real thing
    if (rocketState === 'flying') {
      flyT += dt
      rocketY = window.innerHeight * (0.0012 * flyT * flyT * flyT + 0.005 * flyT * flyT)
    }

    // hold-down rumble, fading out as the stack climbs
    const rumbleAmp =
      rocketState === 'launching' ? 1
      : rocketState === 'flying' ? Math.max(0, 1 - flyT / 4)
      : rocketState === 'filling' ? 0.12
      : 0
    rumbleX = (Math.random() - 0.5) * pad.scale * 0.014 * rumbleAmp
    rumbleY = (Math.random() - 0.5) * pad.scale * 0.009 * rumbleAmp

    if (visible) {
      emit(dt)
      updatePuffs(dt)
      if (intensity > 0.02) drawFlamesAll(ctx)
      drawPuffs(ctx)
      // heat shimmer over the exhaust, only while we're tracking it
      if (tracking) drawHeatShimmer(ctx)
    }

    // foreground steam curtain runs on its own section-sized canvas
    emitCurtain(dt)
    updateDrawCurtain(dt)

    // wind down once the rocket is long gone and the clouds have faded
    if (
      rocketState === 'flying' &&
      rocketY > window.innerHeight * 2.5 &&
      noz.y + secTop < -noz.scale &&
      puffs.length === 0 &&
      curtain.length === 0
    ) {
      fxRunning = false
      rocketGone = true // hide the fixed shuttle so it doesn't park over other sections
      rumbleX = 0
      rumbleY = 0
      flightVignette = 0
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, fxCanvas.width, fxCanvas.height)
      return
    }
    fxFrame = requestAnimationFrame(tick)
  }

  // ─── Form / launch sequence ────────────────────────────────────

  function handleInput() {
    if (rocketState === 'idle') {
      rocketState = 'filling'
      startFx()
    }
  }

  /** Skip the paperwork — light the engines and go */
  function justLaunch() {
    if (rocketState === 'launching' || rocketState === 'flying') return
    rocketState = 'launching'
    startFx()
    igniteBurst()
    // T-minus overlay spread across the 1400ms hold-down
    runCountdown([
      { text: 'T-3', at: 0 },
      { text: 'T-2', at: 460 },
      { text: 'T-1', at: 920 },
      { text: 'LIFTOFF 🚀', at: 1380 },
    ])
    countdownTimers.push(
      setTimeout(() => {
        flyT = 0
        rocketState = 'flying'
        missionFlown.set(true) // cue the orbit fly-by in the hero
        // let "LIFTOFF" linger a beat before the button reverts
        countdownTimers.push(setTimeout(() => (countdownText = ''), 700))
      }, 1400),
    )
  }

  async function handleSubmit(e: Event) {
    e.preventDefault()
    if (formSubmitting) return
    formSubmitting = true

    // If the rocket already left (via the launch-only button), just
    // submit quietly — don't teleport it back to the pad
    const alreadyFlown = rocketState === 'flying'

    // Throttle up: full flames + billowing smoke while the form sends
    if (!alreadyFlown) {
      rocketState = 'launching'
      startFx()
      igniteBurst()
    }

    const form = e.target as HTMLFormElement
    const fd = new FormData(form)
    try {
      const response = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        body: fd,
      })
      const result = await response.json()
      if (!result.success) {
        throw new Error(result.message || 'Submission failed')
      }
    } catch (err) {
      console.error('Form submission error:', err)
      formSubmitting = false
      if (!alreadyFlown) rocketState = 'filling' // throttle back down, engines stay lit
      return
    }

    formSuccess = true
    // brief hold-down at full thrust, then release
    if (!alreadyFlown) {
      // quicker T-minus overlay spread across the 700ms hold-down
      runCountdown([
        { text: 'T-2', at: 0 },
        { text: 'T-1', at: 350 },
        { text: 'LIFTOFF 🚀', at: 690 },
      ])
      countdownTimers.push(
        setTimeout(() => {
          flyT = 0
          rocketState = 'flying'
          missionFlown.set(true) // cue the orbit fly-by in the hero
          countdownTimers.push(setTimeout(() => (countdownText = ''), 700))
        }, 700),
      )
    }
  }

  onMount(() => {
    const onScroll = () => {
      if (!contactSection) return
      const rect = contactSection.getBoundingClientRect()
      scrollY = -rect.top
      shuttleBottom = window.innerHeight - rect.bottom
    }
    onScroll()
    window.addEventListener('scroll', onScroll)
    window.addEventListener('resize', resizeFx)
    startAmbient()
    startBirds()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', resizeFx)
      fxRunning = false
      ambientRunning = false
      birdRunning = false
      cancelAnimationFrame(fxFrame)
      cancelAnimationFrame(ambientFrame)
      cancelAnimationFrame(birdFrame)
      clearCountdownTimers()
    }
  })
</script>

<section class="contact" bind:this={contactSection}>
  <!-- Twinkling stars in the darkest band of sky, top of the section.
       Sits under the cloud layers (same z-index, earlier in the DOM)
       so clouds drift over them. -->
  <div class="star-layer" aria-hidden="true">
    {#each stars as star}
      <span
        class="star"
        class:star--glow={star.glow}
        style="left: {star.x}%; top: {star.y}%; width: {star.size}px; height: {star.size}px; --peak: {star.peak}; animation-duration: {star.duration}s; animation-delay: {star.delay}s;"
      ></span>
    {/each}
  </div>

  <!-- Parallax cloud layers (top 1/3) -->
  <div class="cloud-layer cloud-1" style="transform: translateY({scrollY * 0.08}px)">
    <svg viewBox="0 0 1440 240" preserveAspectRatio="none" width="1440" height="240">
      <path d="M0,160 C240,80 480,160 720,100 C960,40 1200,120 1440,80 C1440,160 1080,180 720,175 C360,170 0,190 0,200 Z"
        fill="rgba(255,255,255,0.035)" />
    </svg>
  </div>
  <div class="cloud-layer cloud-2" style="transform: translateY({scrollY * 0.15}px)">
    <svg viewBox="0 0 1440 240" preserveAspectRatio="none" width="1440" height="240">
      <path d="M0,120 C320,180 640,60 960,130 C1280,200 1440,80 1440,80 C1440,170 1080,190 720,180 C360,170 0,195 0,200 Z"
        fill="rgba(255,255,255,0.05)" />
    </svg>
  </div>
  <div class="cloud-layer cloud-3" style="transform: translateY({scrollY * 0.22}px)">
    <svg viewBox="0 0 1440 240" preserveAspectRatio="none" width="1440" height="240">
      <path d="M0,80 C180,160 360,40 540,120 C720,200 900,60 1080,110 C1260,160 1440,80 1440,80 C1440,180 1080,195 720,190 C360,185 0,195 0,200 Z"
        fill="rgba(255,255,255,0.065)" />
    </svg>
  </div>

  <!-- Background scenery -->
  <div class="sky-bg"></div>
  <div class="ground-bg"></div>
  <div class="scenery">
    <svg viewBox="0 0 1440 400" preserveAspectRatio="none" class="horizon">
      <path d="M0,300 Q200,250 400,280 Q600,310 800,260 Q1000,210 1200,270 Q1300,290 1440,250 L1440,400 L0,400 Z"
        fill="rgba(60,80,50,0.3)" />
      <path d="M0,340 Q300,300 600,330 Q900,360 1200,320 L1440,340 L1440,400 L0,400 Z"
        fill="rgba(40,55,35,0.4)" />
    </svg>
  </div>

  <!-- Ambient birds drifting across the sky (own lightweight canvas) -->
  <canvas bind:this={birdCanvas} class="bird-canvas" aria-hidden="true"></canvas>

  <!-- Launchpad background scenery (full-width, behind everything) -->
  <div class="launchpad-bg">
    <img src={launchpadBgUrl} class="launchpad-background" alt="" aria-hidden="true" onload={startAmbient} />

    <!-- Ground mist between background and foreground -->
    <div class="ground-mist" aria-hidden="true">
      <svg viewBox="0 0 1440 200" preserveAspectRatio="none" class="mist-layer mist-1">
        <path d="M0,140 Q120,100 240,130 Q360,160 480,120 Q600,80 720,110 Q840,140 960,100 Q1080,60 1200,90 Q1320,120 1440,80 L1440,200 L0,200 Z"
          fill="rgba(200,210,220,0.25)" />
      </svg>
      <svg viewBox="0 0 1440 160" preserveAspectRatio="none" class="mist-layer mist-2">
        <path d="M0,120 Q180,80 360,110 Q540,140 720,90 Q900,40 1080,80 Q1260,120 1440,70 L1440,160 L0,160 Z"
          fill="rgba(180,200,210,0.20)" />
      </svg>
      <svg viewBox="0 0 1440 180" preserveAspectRatio="none" class="mist-layer mist-3">
        <path d="M0,160 Q240,120 480,150 Q720,180 960,130 Q1200,80 1440,140 L1440,180 L0,180 Z"
          fill="rgba(220,230,240,0.12)" />
      </svg>
    </div>

    <!-- Ambient idle smoke drifting across the pad, behind the foreground -->
    <canvas bind:this={ambientCanvas} class="ambient-canvas" aria-hidden="true"></canvas>

    <!-- Access arm — retracts from the shuttle the instant the engines light -->
    <img
      src={launchpadArmUrl}
      class="launchpad-arm"
      class:retracted={rocketState === 'launching' || rocketState === 'flying'}
      alt=""
      aria-hidden="true"
    />

    <img src={launchpadFgUrl} class="launchpad-foreground" alt="" aria-hidden="true" />
  </div>

  <!-- Blinking pad beacons, pinned to the foreground artwork geometry.
       Sits above the form glass so the antenna light isn't washed out
       by the card's backdrop blur -->
  <div class="beacon-layer" aria-hidden="true">
      <!-- antenna tip -->
      <span class="beacon beacon--red" style="left: 64.16%; top: 0.4%;"></span>
      <!-- comms ping — two concentric rings pulse outward from the
           antenna tip every ~10s, staggered 0.4s apart -->
      <span class="ping-source" style="left: 64.16%; top: 0.4%;">
        <span class="ping-ring ping-ring--1"></span>
        <span class="ping-ring ping-ring--2"></span>
      </span>
      <!-- tower roofline corners -->
      <span class="beacon beacon--green" style="left: 57.1%; top: 19.1%; animation-delay: 0.9s;"></span>
      <span class="beacon beacon--green" style="left: 71.4%; top: 19.1%; animation-delay: 1.7s;"></span>
      <!-- low platform posts -->
      <span class="beacon beacon--green" style="left: 31.1%; top: 87.6%; animation-delay: 0.4s;"></span>
      <span class="beacon beacon--red" style="left: 48.85%; top: 87.6%; animation-delay: 1.3s;"></span>
  </div>

  <!-- Mission Control easter egg — invisible click target over the
       water-tower silhouette in the background art -->
  <button
    type="button"
    class="mission-control-trigger"
    aria-label="Mission control"
    onclick={toggleHud}
  ></button>

  {#if hudOpen}
    <div class="mission-hud" role="status">
      <div class="hud-header">
        <span>MISSION CONTROL</span>
        <button type="button" class="hud-close" aria-label="Close mission control" onclick={toggleHud}>✕</button>
      </div>
      <div class="hud-line">LOX&nbsp; {loxBar(loxPercent)} {loxPercent}%</div>
      <div class="hud-line">WIND 4KT NE</div>
      <div class="hud-line">PAD&nbsp; STATUS: {padStatus}<span class="hud-cursor">_</span></div>
    </div>
  {/if}

  <!-- Flame & smoke overlay (single canvas, scrolls with the section) -->
  <div class="flame-overlay" aria-hidden="true">
    <canvas
      bind:this={fxCanvas}
      class="flame-overlay-canvas"
      aria-hidden="true"
    ></canvas>
  </div>

  <!-- Launch steam curtain — in front of the pad foreground -->
  <div class="curtain-overlay" aria-hidden="true">
    <canvas bind:this={curtainCanvas} class="curtain-canvas"></canvas>
  </div>

  <!-- "Camera tracking the ascent" vignette — viewport-fixed, opacity
       eased from tick() while the rocket is flying through the viewport -->
  <div class="flight-vignette" aria-hidden="true" style="opacity: {flightVignette}"></div>

  <!-- Shuttle — viewport-fixed but glued to the section bottom, so the
       ascent isn't clipped by the section's overflow: hidden -->
  <div
    class="shuttle-container"
    class:gone={rocketGone}
    style="bottom: {shuttleBottom}px; transform: translate3d({rumbleX}px, {rumbleY - rocketY}px, 0)"
  >
    <div class="rocket-wrapper">
      <img bind:this={shuttleImg} src={shuttleUrl} class="shuttle" alt="Space Shuttle" />
    </div>
  </div>

  <div class="contact-layout">
    <!-- Form side -->
    <div class="form-side">
      <!-- ── Desktop form ── -->
      <div class="form-card form-card--desktop">
        <span class="section-label">✦ First Contact</span>
        {#if missionStatus}
          {#key missionStatus}
            <p class="mission-status" transition:fade={{ duration: 200 }}>✦ {missionStatus}</p>
          {/key}
        {/if}
        <h2 class="form-title">Get in <span class="highlight">touch</span></h2>
        <p class="form-subtitle">Fill in your details and we'll prepare for liftoff.</p>

        {#if formSuccess}
          <div class="success-message">
            {#if rocketState === 'launching' && countdownText}
              <p class="countdown-line">{countdownText}</p>
            {/if}
            <svg viewBox="0 0 80 80" class="success-icon">
              <circle cx="40" cy="40" r="36" fill="none" stroke="#a78bfa" stroke-width="3" />
              <path d="M24,42 L34,52 L56,30" fill="none" stroke="#a78bfa" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <h3>Mission Launched! 🚀</h3>
            <p>Your message is en route. We'll be in touch soon — watch the skies!</p>
          </div>
        {:else}
          <form action="https://api.web3forms.com/submit" method="POST" onsubmit={handleSubmit} class="contact-form">
            <input type="hidden" name="access_key" value="50babc27-e709-4cc3-86ec-0d8c6ba7e6e6">

            <div class="field">
              <label for="name">Your Name</label>
              <input
                id="name"
                type="text"
                name="name"
                placeholder="Cosmonaut..."
                bind:value={formData['name']}
                oninput={() => handleInput()}
                required
              />
            </div>

            <div class="field">
              <label for="email">Email</label>
              <input
                id="email"
                type="email"
                name="email"
                placeholder="mission@control.space"
                bind:value={formData['email']}
                oninput={() => handleInput()}
                required
              />
            </div>

            <div class="field">
              <label for="message">Message</label>
              <textarea
                id="message"
                name="message"
                placeholder="Tell us about your mission..."
                bind:value={formData['message']}
                oninput={() => handleInput()}
                rows={4}
                required
              ></textarea>
            </div>

            <button
              type="submit"
              class="launch-btn"
              disabled={!formValid || formSubmitting}
            >
              {formSubmitting ? 'Sending...' : 'Send Message'}
            </button>

            <button
              type="button"
              class="just-launch-btn"
              onclick={justLaunch}
              disabled={rocketState === 'launching' || rocketState === 'flying'}
            >
              {countdownText || 'I just want to launch the Rocket 🚀'}
            </button>
          </form>
        {/if}
      </div>

      <!-- ── Mobile form ── -->
      <div class="form-card form-card--mobile">
        <span class="section-label">✦ Connect</span>
        <h2 class="form-title-mob">Say <span class="highlight-mob">hello</span></h2>
        <p class="form-subtitle-mob">Drop us a line and we'll get back to you.</p>

        {#if formSuccess}
          <div class="success-message">
            <svg viewBox="0 0 80 80" class="success-icon">
              <circle cx="40" cy="40" r="36" fill="none" stroke="#f59e0b" stroke-width="3" />
              <path d="M24,42 L34,52 L56,30" fill="none" stroke="#f59e0b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <h3>Message Sent! ✨</h3>
            <p>Thanks for reaching out — we'll be in touch soon!</p>
          </div>
        {:else}
          <form action="https://api.web3forms.com/submit" method="POST" onsubmit={handleSubmit} class="contact-form-mob">
            <input type="hidden" name="access_key" value="50babc27-e709-4cc3-86ec-0d8c6ba7e6e6">

            <div class="field-mob">
              <input
                id="name-mob"
                type="text"
                name="name"
                placeholder="Cosmonaut..."
                bind:value={formData['name']}
                oninput={() => handleInput()}
                required
              />
            </div>

            <div class="field-mob">
              <input
                id="email-mob"
                type="email"
                name="email"
                placeholder="mission@control.space"
                bind:value={formData['email']}
                oninput={() => handleInput()}
                required
              />
            </div>

            <div class="field-mob">
              <textarea
                id="message-mob"
                name="message"
                placeholder="Tell us about your mission..."
                bind:value={formData['message']}
                oninput={() => handleInput()}
                rows={3}
                required
              ></textarea>
            </div>

            <button
              type="submit"
              class="send-btn-mob"
              disabled={!formValid || formSubmitting}
            >
              {formSubmitting ? 'Sending...' : 'Send Message'}
            </button>

            <button
              type="button"
              class="just-launch-btn"
              onclick={justLaunch}
              disabled={rocketState === 'launching' || rocketState === 'flying'}
            >
              {countdownText || 'I just want to launch the Rocket 🚀'}
            </button>
          </form>
        {/if}
      </div>
    </div>
  </div>
</section>

<style>
  .contact {
    position: relative;
    min-height: 100vh;
    display: flex;
    align-items: center;
    overflow: hidden;
    background: linear-gradient(180deg, #e2716d 0%, #f5c571 75%, #d4a878 95%);
    padding: 4rem 2rem;
  }

  /* ── Twinkling stars (darkest band of the sunset sky) ── */
  .star-layer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 35%;
    z-index: 1;
    pointer-events: none;
    overflow: hidden;
  }
  .star {
    position: absolute;
    border-radius: 50%;
    background: #fff8ec;
    opacity: 0;
    transform: translate(-50%, -50%);
    animation-name: star-twinkle;
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
  }
  .star--glow {
    box-shadow: 0 0 3px 1px rgba(255, 248, 236, 0.5);
  }
  @keyframes star-twinkle {
    0%, 100% { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
    50% { opacity: var(--peak); transform: translate(-50%, -50%) scale(1); }
  }

  .cloud-layer {
    position: absolute;
    left: 0;
    width: 100%;
    pointer-events: none;
    z-index: 1;
  }
  .cloud-1 { top: 3%; }
  .cloud-2 { top: 12%; }
  .cloud-3 { top: 22%; }
  .cloud-layer svg { width: 100%; height: auto; }

  .sky-bg {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg,
      rgba(232, 117, 106, 0.25) 0%,
      rgba(245, 197, 113, 0.15) 30%,
      transparent 60%
    );
    filter: blur(8px);
    z-index: 0;
  }

  .ground-bg {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 35%;
    z-index: 0;
  }

  .launchpad-bg {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    height: auto;
    z-index: 1;
    pointer-events: none;
    line-height: 0;
  }
  .launchpad-bg img {
    display: block;
    width: 100%;
    height: auto;
  }
  .launchpad-background {
    position: relative;
    filter: blur(2px) brightness(0.7);
  }
  .launchpad-foreground {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: auto;
    z-index: 3;
    filter: brightness(0.55);
  }
  /* Access arm — same box & brightness as the foreground, layered just
     beneath it so the tower body overlaps the arm root where they meet.
     Pivots at the arm's tower-end attachment (56.4% across, 37.8% down)
     and swings up & back the moment the engines light, like the real
     thing releasing during hold-down before liftoff. */
  .launchpad-arm {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: auto;
    z-index: 3;
    filter: brightness(0.55);
    transform-origin: 56.4% 37.8%;
    transition: transform 1.1s cubic-bezier(0.4, 0, 0.7, 1);
  }
  .launchpad-arm.retracted {
    transform: rotate(-22deg);
  }

  /* ── Flame & smoke overlay (viewport-fixed so the rocket and its
        trail aren't clipped at the section top; drawn in section
        coords each frame) ── */
  .flame-overlay {
    position: fixed;
    inset: 0;
    z-index: 2;
    pointer-events: none;
  }
  .flame-overlay-canvas {
    position: absolute;
    top: 0;
    left: 0;
    display: block;
  }

  /* ── Launch steam curtain (in front of the pad foreground & form) ── */
  .curtain-overlay {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    overflow: hidden;
  }
  .curtain-canvas {
    position: absolute;
    top: 0;
    left: 0;
    display: block;
    filter: blur(6px);
  }

  .ground-mist {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    height: auto;
    z-index: 2;
    pointer-events: none;
    line-height: 0;
  }
  /* squashed heights (preserveAspectRatio="none") keep the mist as a
     low ground haze instead of a bank covering the background */
  .mist-layer {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: auto;
  }
  .mist-1 {
    height: 6vw;
    filter: blur(20px);
    animation: mist-drift-1 20s ease-in-out infinite;
    transform-origin: center;
  }
  .mist-2 {
    height: 5vw;
    filter: blur(30px);
    animation: mist-drift-2 25s ease-in-out infinite;
    transform-origin: center;
  }
  .mist-3 {
    height: 7vw;
    filter: blur(40px);
    animation: mist-drift-3 30s ease-in-out infinite;
    transform-origin: center;
  }

  @keyframes mist-drift-1 {
    0%, 100% { transform: translateX(0) scaleX(1); }
    50% { transform: translateX(10px) scaleX(1.02); }
  }
  @keyframes mist-drift-2 {
    0%, 100% { transform: translateX(0) scaleX(1); }
    50% { transform: translateX(-8px) scaleX(1.03); }
  }
  @keyframes mist-drift-3 {
    0%, 100% { transform: translateX(0) scaleX(1); }
    50% { transform: translateX(6px) scaleX(1.01); }
  }

  .ambient-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 2;
    pointer-events: none;
    filter: blur(10px);
  }

  /* ── Ambient birds (sky silhouettes, behind the form) ── */
  .bird-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 2;
    pointer-events: none;
  }

  /* ── Flight vignette (viewport-fixed, transparent centre) ── */
  .flight-vignette {
    position: fixed;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    background: radial-gradient(
      ellipse at 50% 42%,
      transparent 38%,
      rgba(30, 10, 20, 0.28) 78%,
      rgba(30, 10, 20, 0.45) 100%
    );
    will-change: opacity;
  }

  .scenery {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 1;
    filter: blur(6px);
    opacity: 0.4;
  }
  .scenery svg { width: 100%; height: auto; }

  .contact-layout {
    position: relative;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    max-width: var(--max-width);
    margin: 0 auto;
    width: 100%;
    /* the wrapper spans the full section — let clicks pass through to
       the mission-control trigger; the form side re-enables them */
    pointer-events: none;
  }
  .form-side {
    pointer-events: auto;
  }

  /* ── Shuttle Container ──
     Viewport-fixed with `bottom` bound to the section's live position,
     so it behaves like it's absolutely positioned in the section but
     escapes the section's overflow clipping during ascent. */
  .shuttle-container {
    position: fixed;
    left: 0;
    width: 100%;
    height: 30vw;
    /* matches the flame overlay so the ascending shuttle passes behind
       the projects UI just like its exhaust trail */
    z-index: 2;
    pointer-events: none;
    will-change: transform;
  }
  .shuttle-container.gone {
    display: none;
  }

  /* ── Pad beacons ── */
  .beacon-layer {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    /* matches launchpad-foreground.svg's viewBox so % positions map
       straight onto the artwork (same box as .launchpad-foreground) */
    aspect-ratio: 3783.9 / 1885.25;
    z-index: 4;
    pointer-events: none;
    line-height: 0;
  }
  .beacon {
    position: absolute;
    width: clamp(4px, 0.4vw, 8px);
    height: clamp(4px, 0.4vw, 8px);
    border-radius: 50%;
    transform: translate(-50%, -50%);
  }
  .beacon--red {
    background: #ff4438;
    box-shadow:
      0 0 4px 1px rgba(255, 68, 56, 0.9),
      0 0 14px 4px rgba(255, 68, 56, 0.35);
    animation: beacon-blink 2.2s infinite;
  }
  .beacon--green {
    background: #37f56e;
    box-shadow:
      0 0 4px 1px rgba(55, 245, 110, 0.9),
      0 0 14px 4px rgba(55, 245, 110, 0.3);
    animation: beacon-blink 1.6s infinite;
  }
  @keyframes beacon-blink {
    0%, 12% { opacity: 1; }
    22%, 88% { opacity: 0.15; }
    100% { opacity: 1; }
  }

  /* ── Comms ping — expanding rings from the antenna beacon ──
     A 10s cycle, ring only visible during the first ~2s (held
     invisible the rest of the way), staggered per-ring by delay. */
  .ping-source {
    position: absolute;
    width: 0;
    height: 0;
    pointer-events: none;
  }
  .ping-ring {
    position: absolute;
    left: 0;
    top: 0;
    width: 6px;
    height: 6px;
    border: 1.5px solid #ff4438;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    opacity: 0;
    pointer-events: none;
    animation: ping-pulse 10s ease-out infinite;
  }
  .ping-ring--2 {
    animation-delay: 0.4s;
  }
  @keyframes ping-pulse {
    0% { width: 6px; height: 6px; opacity: 0.5; }
    20% { width: 70px; height: 70px; opacity: 0; }
    100% { width: 70px; height: 70px; opacity: 0; }
  }

  /* ── Mission Control easter egg ──
     Invisible click target over the water-tower silhouette in the
     background art (roughly 24% from the left, lower third of the
     section) — sits above the scenery but below the form card. */
  .mission-control-trigger {
    position: absolute;
    left: 22.5%;
    bottom: 18%;
    width: 4vw;
    height: 6vw;
    z-index: 3;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    /* fully override the global button chrome — this must be invisible */
    box-shadow: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .mission-control-trigger:hover:not(:disabled) {
    transform: none;
    box-shadow: none;
  }

  .mission-hud {
    position: absolute;
    left: 3%;
    bottom: 26%;
    z-index: 3;
    width: clamp(200px, 20vw, 260px);
    padding: 0.75rem 0.9rem;
    background: rgba(4, 14, 6, 0.86);
    border: 1px solid rgba(61, 255, 110, 0.35);
    border-radius: 6px;
    box-shadow: 0 0 18px rgba(61, 255, 110, 0.12), inset 0 0 12px rgba(0, 0, 0, 0.5);
    font-family: 'Courier New', ui-monospace, monospace;
    color: #3dff6e;
    font-size: 0.72rem;
    line-height: 1.6;
    letter-spacing: 0.03em;
    pointer-events: auto;
    overflow: hidden;
  }
  /* faint scanline sweep — cheap CRT touch */
  .mission-hud::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: repeating-linear-gradient(
      0deg,
      rgba(61, 255, 110, 0.06) 0px,
      rgba(61, 255, 110, 0.06) 1px,
      transparent 1px,
      transparent 3px
    );
    mix-blend-mode: overlay;
  }

  .hud-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 700;
    letter-spacing: 0.1em;
    margin-bottom: 0.4rem;
    color: #8dffb0;
  }
  .hud-close {
    background: none;
    border: none;
    color: #8dffb0;
    font-size: 0.75rem;
    line-height: 1;
    cursor: pointer;
    padding: 0.1rem 0.3rem;
  }
  .hud-close:hover {
    color: #ffffff;
  }
  .hud-line {
    white-space: pre;
  }
  .hud-cursor {
    animation: hud-blink 1s steps(1) infinite;
  }
  @keyframes hud-blink {
    0%, 49% { opacity: 1; }
    50%, 100% { opacity: 0; }
  }

  .rocket-wrapper {
    /*
     * Align shuttle center with the launch mount in the SVGs.
     * Both launchpad SVGs are centered and scale with viewport width.
     * The launch mount is offset ~10vw left of viewport center.
     * Adjust the 10vw value to fine-tune horizontal alignment.
     */
    left: calc(38vw);
    position: absolute;
    display: block;
  }

  .shuttle {
    /*
     * Size relative to viewport width to scale with the launchpad SVGs.
     * Shuttle SVG is 846.6w / launchpad SVG 3783.9w ≈ 22.4vw
     */
    width: 17vw;
    bottom: 14vw;
    margin-left: -8.5vw;
    height: auto;
    filter: drop-shadow(2px 4px 12px rgba(0,0,0,0.3));
    position: relative;
    z-index: 3;
  }

  /* Form side */
  .form-side {
    flex: 1;
    max-width: 520px;
    margin-right: 2rem;
  }

  .form-card {
    background: rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 24px;
    padding: 2.5rem;
  }

  .section-label {
    display: inline-block;
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.7);
    margin-bottom: 0.75rem;
  }

  /* ── Mission-milestone status line ── */
  .mission-status {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.55);
    margin: -0.4rem 0 0.75rem;
  }

  /* ── T-minus countdown, shown while the success message holds at
        full thrust between submit and the fly-away ── */
  .countdown-line {
    font-size: 0.9rem;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: #a78bfa;
    margin-bottom: 0.5rem;
  }

  .form-title {
    font-size: clamp(1.8rem, 3vw, 2.5rem);
    font-weight: 800;
    color: #ffffff;
    margin-bottom: 0.5rem;
  }
  .highlight {
    background: linear-gradient(135deg, #e8756a, #e2716d);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .form-subtitle {
    color: rgba(255,255,255,0.65);
    margin-bottom: 2rem;
    font-size: 0.95rem;
  }

  .contact-form {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .field label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #ffffff;
  }
  .field input,
  .field textarea {
    padding: 0.8rem 1rem;
    border-radius: 12px;
    border: 1.5px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.08);
    backdrop-filter: blur(8px);
    font-size: 0.95rem;
    font-family: var(--font-sans);
    color: #ffffff;
    transition: border-color 0.2s, box-shadow 0.2s;
    outline: none;
  }
  .field input:focus,
  .field textarea:focus {
    border-color: #e8756a;
    box-shadow: 0 0 0 3px rgba(232, 117, 106, 0.2);
    background: rgba(255,255,255,0.12);
  }
  .field input::placeholder,
  .field textarea::placeholder {
    color: rgba(255,255,255,0.35);
  }

  .launch-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.95rem 1.75rem;
    border-radius: 0;
    border: none;
    background: #e8756a;
    color: #ffffff;
    font-size: 1rem;
    font-weight: 700;
    text-transform: uppercase;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
    box-shadow: 4px 6px 0 rgb(180 70 60), 0 12px 18px rgba(0, 0, 0, 0.12);
    margin-top: 0.5rem;
  }
  .launch-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 4px 8px 0 rgb(180 70 60), 0 14px 20px rgba(0, 0, 0, 0.14);
  }
  .launch-btn:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .just-launch-btn {
    align-self: center;
    padding: 0.4rem 0.75rem;
    border: none;
    background: none;
    color: rgba(255, 255, 255, 0.55);
    font-size: 0.85rem;
    font-weight: 600;
    text-decoration: underline dotted rgba(255, 255, 255, 0.35);
    text-underline-offset: 3px;
    cursor: pointer;
    transition: color 0.2s ease;
    box-shadow: none;
  }
  .just-launch-btn:hover:not(:disabled) {
    color: #e8756a;
    box-shadow: none;
  }
  .just-launch-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .success-message {
    text-align: center;
    padding: 1.5rem 0;
  }
  .success-icon {
    width: 64px;
    height: 64px;
    margin: 0 auto 1rem;
  }
  .success-message h3 {
    font-size: 1.5rem;
    color: #ffffff;
    margin-bottom: 0.5rem;
  }
  .success-message p {
    color: rgba(255,255,255,0.6);
    font-size: 0.95rem;
  }

  /* ── Mobile form styles ── */
  .form-card--mobile {
    display: none;
    background: rgba(10, 10, 30, 0.5);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 1.5rem 1.25rem;
  }

  .form-title-mob {
    font-size: clamp(1.4rem, 5vw, 1.8rem);
    font-weight: 800;
    color: #f5f5ff;
    margin-bottom: 0.35rem;
  }
  .highlight-mob {
    background: linear-gradient(135deg, #f59e0b, #f97316);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .form-subtitle-mob {
    color: rgba(245, 245, 255, 0.5);
    margin-bottom: 1.5rem;
    font-size: 0.85rem;
  }

  .contact-form-mob {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .field-mob input,
  .field-mob textarea {
    width: 100%;
    padding: 0.7rem 0.9rem;
    border-radius: 10px;
    border: 1.5px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.06);
    font-size: 0.95rem;
    font-family: var(--font-sans);
    color: #f5f5ff;
    transition: border-color 0.2s, box-shadow 0.2s;
    outline: none;
    box-sizing: border-box;
  }
  .field-mob input:focus,
  .field-mob textarea:focus {
    border-color: #e8756a;
    box-shadow: 0 0 0 3px rgba(232, 117, 106, 0.2);
    background: rgba(255, 255, 255, 0.12);
  }
  .field-mob input::placeholder,
  .field-mob textarea::placeholder {
    color: rgba(245, 245, 255, 0.3);
  }

  .send-btn-mob {
    width: 100%;
    padding: 0.8rem 1.25rem;
    border-radius: 10px;
    border: none;
    background: linear-gradient(135deg, #e8756a, #e2716d);
    color: #ffffff;
    font-size: 0.95rem;
    font-weight: 700;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    margin-top: 0.25rem;
  }
  .send-btn-mob:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(232, 117, 106, 0.3);
  }
  .send-btn-mob:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @media (max-width: 700px) {
    /* Trim the side gutters right down — the card was cramped against
       them — and pin the layout to the top so the form floats above the
       pad rather than sitting vertically centred over the shuttle. */
    .contact {
      padding: 2rem 0.85rem;
      align-items: flex-start;
    }
    .contact-layout {
      flex-direction: column;
      justify-content: flex-start;
      align-items: center;
    }

    /* Scale up the whole pad scene to fill the taller portrait frame.
       The shuttle, the launchpad art (background / foreground / arm /
       ambient mist all ride on .launchpad-bg) and the pad beacons are
       each scaled around the *same* launch-mount point — 38% across,
       and the mount's height within each layer's own box — so they grow
       together and the shuttle stays seated on the pad. The flame,
       smoke and curtain canvases measure the shuttle's live rect every
       frame, so they follow the larger shuttle automatically. */
    .launchpad-bg {
      transform-origin: 38% 62.5%;
      transform: scale(1.95);
    }
    .beacon-layer {
      transform-origin: 38% 85.2%;
      transform: scale(1.95);
    }
    .shuttle {
      transform-origin: center bottom;
      transform: scale(1.95);
    }

    .form-side {
      max-width: 420px;
      width: 100%;
      margin-right: 0;
      /* keep the card clear of the enlarged pad scene below it */
      margin-bottom: 4rem;
    }
    .form-card--mobile {
      padding: 1.25rem 1rem;
    }

    /* Swap forms */
    .form-card--desktop {
      display: none;
    }
    .form-card--mobile {
      display: block;
    }
  }
</style>
