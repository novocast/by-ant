<script lang="ts">
  import { onMount } from 'svelte'
  import shuttleUrl from '../assets/shuttle.svg'
  import launchpadBgUrl from '../assets/launchpad-background.svg'
  import launchpadFgUrl from '../assets/launchpad-foreground.svg'

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

  $: formValid =
    !!formData['name']?.trim() &&
    !!formData['email']?.trim() &&
    !!formData['message']?.trim() &&
    formData['message']!.trim().length > 20

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
  let lastTick = 0
  let flameTime = 0
  let intensity = 0 // eased flame throttle: 0 idle → ~0.42 filling → 1 launch
  // Flight time accumulated from clamped frame deltas (not wall clock),
  // so a throttled/backgrounded tab can't teleport the rocket off-screen
  let flyT = 0

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
      y: h - Math.random() * h * 0.4,
      vx: (Math.random() - 0.5) * w * 0.014,
      size: w * (0.07 + Math.random() * 0.12),
      age: midLife ? Math.random() * life : 0,
      life,
      peak: 0.16 + Math.random() * 0.18,
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

  function startAmbient() {
    if (ambientRunning || !ambientCanvas) return
    ensureSprites()
    ambientCtx = ambientCanvas.getContext('2d')!
    resizeAmbient()
    // pre-seed mid-life puffs so the pad isn't bare on first paint
    for (let i = 0; i < AMB_MAX * 0.6; i++) {
      spawnAmbient(ambientCanvas.width, ambientCanvas.height, true)
    }
    ambientRunning = true
    ambientLast = performance.now()
    ambientFrame = requestAnimationFrame(ambientTick)
  }

  function resizeFx() {
    resizeAmbient()
    if (!fxCanvas || !contactSection) return
    fxW = contactSection.clientWidth
    fxH = contactSection.clientHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    fxCanvas.width = fxW * dpr
    fxCanvas.height = fxH * dpr
    fxCanvas.style.width = fxW + 'px'
    fxCanvas.style.height = fxH + 'px'
    fxCtx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function startFx() {
    if (fxRunning) return
    if (!fxCtx) {
      fxCtx = fxCanvas.getContext('2d')!
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

    // exhaust trail from the climbing rocket
    if (rocketState === 'flying' && noz.y > -noz.scale) {
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
    ctx.clearRect(0, 0, fxW, fxH)

    // throttle eases up on ignition, snaps harder on launch
    const target =
      rocketState === 'launching' || rocketState === 'flying' ? 1
      : rocketState === 'filling' ? 0.42
      : 0
    intensity += (target - intensity) * Math.min(1, dt * (target > intensity ? 2.4 : 4))

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
    }

    // wind down once the rocket is long gone and the cloud has faded
    if (rocketState === 'flying' && rocketY > window.innerHeight * 2.5 && puffs.length === 0) {
      fxRunning = false
      rumbleX = 0
      rumbleY = 0
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
    setTimeout(() => {
      flyT = 0
      rocketState = 'flying'
    }, 1400)
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
      setTimeout(() => {
        flyT = 0
        rocketState = 'flying'
      }, 700)
    }
  }

  onMount(() => {
    const onScroll = () => {
      if (!contactSection) return
      const rect = contactSection.getBoundingClientRect()
      scrollY = -rect.top
    }
    window.addEventListener('scroll', onScroll)
    window.addEventListener('resize', resizeFx)
    startAmbient()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', resizeFx)
      fxRunning = false
      ambientRunning = false
      cancelAnimationFrame(fxFrame)
      cancelAnimationFrame(ambientFrame)
    }
  })
</script>

<section class="contact" bind:this={contactSection}>
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

  <!-- Launchpad background scenery (full-width, behind everything) -->
  <div class="launchpad-bg">
    <img src={launchpadBgUrl} class="launchpad-background" alt="" aria-hidden="true" />

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

    <img src={launchpadFgUrl} class="launchpad-foreground" alt="" aria-hidden="true" />
  </div>

  <!-- Flame & smoke overlay (single canvas, scrolls with the section) -->
  <div class="flame-overlay" aria-hidden="true">
    <canvas
      bind:this={fxCanvas}
      class="flame-overlay-canvas"
      aria-hidden="true"
    ></canvas>
  </div>

  <!-- Shuttle — positioned independently to align with the launchpad -->
  <div
    class="shuttle-container"
    style="transform: translate3d({rumbleX}px, {rumbleY - rocketY}px, 0)"
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
        <h2 class="form-title">Get in <span class="highlight">touch</span></h2>
        <p class="form-subtitle">Fill in your details and we'll prepare for liftoff.</p>

        {#if formSuccess}
          <div class="success-message">
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
              I just want to launch the Rocket 🚀
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

  /* ── Flame & smoke overlay (section-local, above the pad art) ── */
  .flame-overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    overflow: hidden;
  }
  .flame-overlay-canvas {
    position: absolute;
    top: 0;
    left: 0;
    display: block;
  }

  .ground-mist {
    position: absolute;
    bottom: 5%;
    left: 0;
    right: 0;
    width: 100%;
    height: auto;
    z-index: 2;
    pointer-events: none;
    line-height: 0;
  }
  .mist-layer {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: auto;
  }
  .mist-1 {
    filter: blur(20px);
    animation: mist-drift-1 20s ease-in-out infinite;
    transform-origin: center;
  }
  .mist-2 {
    filter: blur(30px);
    animation: mist-drift-2 25s ease-in-out infinite;
    transform-origin: center;
  }
  .mist-3 {
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
  }

  /* ── Shuttle Container (positioned from center to align with launchpad) ── */
  .shuttle-container {
    position: absolute;
    width: 100%;
    height: 30vw;
    bottom: 0;
    z-index: 5;
    pointer-events: none;
    will-change: transform;
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

  .form-title {
    font-size: clamp(1.8rem, 3vw, 2.5rem);
    font-weight: 800;
    color: #1a1a2e;
    margin-bottom: 0.5rem;
  }
  .highlight {
    background: linear-gradient(135deg, #7c5cfc, #6366f1);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .form-subtitle {
    color: rgba(26,26,46,0.6);
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
    color: #1a1a2e;
  }
  .field input,
  .field textarea {
    padding: 0.8rem 1rem;
    border-radius: 12px;
    border: 2px solid rgba(26,26,46,0.1);
    background: rgba(255,255,255,0.6);
    font-size: 0.95rem;
    font-family: var(--font-sans);
    color: #1a1a2e;
    transition: border-color 0.2s, box-shadow 0.2s;
    outline: none;
  }
  .field input:focus,
  .field textarea:focus {
    border-color: #7c5cfc;
    box-shadow: 0 0 0 3px rgba(124, 92, 252, 0.15);
    background: rgba(255,255,255,0.9);
  }
  .field input::placeholder,
  .field textarea::placeholder {
    color: rgba(26,26,46,0.3);
  }

  .launch-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.95rem 1.75rem;
    border-radius: 0;
    border: none;
    background: #1a1040;
    color: #ffffff;
    font-size: 1rem;
    font-weight: 700;
    text-transform: uppercase;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
    box-shadow: 4px 6px 0 rgb(234 179 8), 0 12px 18px rgba(0, 0, 0, 0.12);
    margin-top: 0.5rem;
  }
  .launch-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 4px 8px 0 rgb(234 179 8), 0 14px 20px rgba(0, 0, 0, 0.14);
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
    color: rgba(26, 26, 46, 0.55);
    font-size: 0.85rem;
    font-weight: 600;
    text-decoration: underline dotted rgba(26, 26, 46, 0.35);
    text-underline-offset: 3px;
    cursor: pointer;
    transition: color 0.2s ease;
    box-shadow: none;
  }
  .just-launch-btn:hover:not(:disabled) {
    color: #7c5cfc;
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
    color: #1a1a2e;
    margin-bottom: 0.5rem;
  }
  .success-message p {
    color: rgba(26,26,46,0.6);
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
    border-color: #f59e0b;
    box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.15);
    background: rgba(255, 255, 255, 0.1);
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
    background: linear-gradient(135deg, #f59e0b, #f97316);
    color: #0a0a1e;
    font-size: 0.95rem;
    font-weight: 700;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    margin-top: 0.25rem;
  }
  .send-btn-mob:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(245, 158, 11, 0.3);
  }
  .send-btn-mob:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @media (max-width: 700px) {
    .contact-layout {
      flex-direction: column;
    }
    .shuttle-container {
      display: none;
    }
    .form-side {
      max-width: 100%;
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
