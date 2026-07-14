<script lang="ts">
  import { onMount } from 'svelte'
  import shuttleUrl from '../assets/shuttle.svg'
  import launchpadBgUrl from '../assets/launchpad-background.svg'
  import launchpadFgUrl from '../assets/launchpad-foreground.svg'

  let scrollY = 0
  let rocketState: 'idle' | 'filling' | 'launching' | 'flying' = 'idle'
  let smokeParticles: SmokeParticle[] = []
  let rocketY = 0
  let launchProgress = 0
  let formSubmitting = false
  let formSuccess = false
  let contactSection: HTMLElement
  let animFrame: number

  // Full-screen flame overlay canvas for two SRB flames
  let flameCanvas: HTMLCanvasElement
  let flameCtx: CanvasRenderingContext2D | null = null
  let flameTime = 0
  let flameAnimFrame: number

  // Shuttle geometry (for calculating SRB positions)
  const SHUTTLE_CENTER_VW = 31       // ~31% of browser width
  const SHUTTLE_WIDTH_VW = 17
  const SHUTTLE_BOTTOM_VW = 14       // shuttle bottom inset from page bottom
  const LEFT_SRB_PCT = 0.131         // 13.1% from shuttle left edge
  const RIGHT_SRB_PCT = 0.698        // 69.8% from shuttle left edge

  interface SmokeParticle {
    id: number
    x: number
    y: number
    size: number
    opacity: number
    vx: number
    vy: number
    rot: number
    rotSpeed: number
    groundLevel: number  // y at which ground spread kicks in
  }

  /** Convert vw to pixels */
  function vw(percent: number): number {
    return (percent / 100) * window.innerWidth
  }

  /** Calculate SRB nozzle positions in viewport coordinates */
  function getSrbPositions(): { leftX: number; rightX: number; engineY: number } {
    const shuttleLeft = vw(SHUTTLE_CENTER_VW) - vw(SHUTTLE_WIDTH_VW) / 2
    const shuttleWidth = vw(SHUTTLE_WIDTH_VW)
    const leftX = shuttleLeft + shuttleWidth * LEFT_SRB_PCT
    const rightX = shuttleLeft + shuttleWidth * RIGHT_SRB_PCT
    const engineY = window.innerHeight - vw(SHUTTLE_BOTTOM_VW)
    return { leftX, rightX, engineY }
  }

  const formFields = [
    { id: 'name', label: 'Your Name', type: 'text', placeholder: 'Cosmonaut...' },
    { id: 'email', label: 'Email', type: 'email', placeholder: 'mission@control.space' },
    { id: 'message', label: 'Message', type: 'textarea', placeholder: 'Tell us about your mission...' },
  ]

  let formData: Record<string, string> = {}

  $: formValid =
    !!formData['name']?.trim() &&
    !!formData['email']?.trim() &&
    !!formData['message']?.trim() &&
    formData['message']!.trim().length > 20

  function handleInput(fieldId: string) {
    if (rocketState === 'idle') {
      rocketState = 'filling'
      startSmoke()
      initFlameCanvas()
    }
  }

  let smokeInterval: ReturnType<typeof setInterval>
  let particleId = 0

  // ─── Full-screen Flame Canvas (two SRB flames) ─────────────────

  function initFlameCanvas() {
    if (flameCtx || !flameCanvas) return
    flameCtx = flameCanvas.getContext('2d')!
    resizeFlameCanvas()
    drawFlames()
  }

  function resizeFlameCanvas() {
    if (!flameCanvas) return
    flameCanvas.width = window.innerWidth
    flameCanvas.height = window.innerHeight
  }

  /** Draw a single rocket flame at a given position */
  function drawSingleFlame(
    ctx: CanvasRenderingContext2D,
    cx: number,
    engineY: number,
    intensity: number,
    time: number,
  ) {
    const isLaunching = rocketState === 'launching'
    const flameHeight = vw(12) * (0.7 + Math.sin(time * 3) * 0.12) * intensity
    const baseWidth = vw(3.5) * (1 + Math.sin(time * 1.7) * 0.06)

    // Multi-frequency noise for organic turbulence
    const noise = (t: number) =>
      Math.sin(t) * 0.5 + Math.sin(t * 2.3) * 0.3 + Math.sin(t * 5.7) * 0.15 + Math.sin(t * 11.3) * 0.08

    // ── Outer flame (deep red/orange) ──
    ctx.beginPath()
    for (let i = 0; i <= 24; i++) {
      const t = i / 24
      const angle = t * Math.PI - Math.PI / 2
      const xOff = Math.sin(angle) * baseWidth * 0.5
      const turb = noise(time * 2.5 + t * 5) * baseWidth * 0.12
      const x = cx + xOff + turb * (1 - t * 0.7)
      const y = engineY + flameHeight * (0.1 + t * 0.9) + Math.sin(time * 2 + i * 2.5) * 2
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    const og = ctx.createRadialGradient(cx, engineY + flameHeight * 0.3, 0, cx, engineY + flameHeight * 0.3, baseWidth)
    og.addColorStop(0, 'rgba(255, 130, 20, 0.85)')
    og.addColorStop(0.3, 'rgba(255, 70, 8, 0.7)')
    og.addColorStop(0.6, 'rgba(200, 35, 5, 0.4)')
    og.addColorStop(1, 'rgba(120, 10, 0, 0)')
    ctx.fillStyle = og
    ctx.globalAlpha = 0.75 * intensity
    ctx.fill()

    // ── Mid flame (yellow/orange) ──
    ctx.beginPath()
    for (let i = 0; i <= 20; i++) {
      const t = i / 20
      const angle = t * Math.PI - Math.PI / 2
      const xOff = Math.sin(angle) * baseWidth * 0.4
      const turb = noise(time * 3.5 + t * 6 + 1) * baseWidth * 0.08
      const x = cx + xOff + turb * (1 - t * 0.6)
      const y = engineY + flameHeight * (0.18 + t * 0.82) + Math.sin(time * 2.5 + i * 2) * 2
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    const mg = ctx.createRadialGradient(cx, engineY + flameHeight * 0.25, 0, cx, engineY + flameHeight * 0.25, baseWidth * 0.5)
    mg.addColorStop(0, 'rgba(255, 230, 50, 0.95)')
    mg.addColorStop(0.4, 'rgba(255, 160, 25, 0.8)')
    mg.addColorStop(0.7, 'rgba(255, 90, 12, 0.4)')
    mg.addColorStop(1, 'rgba(255, 50, 5, 0)')
    ctx.fillStyle = mg
    ctx.globalAlpha = 0.85 * intensity
    ctx.fill()

    // ── Inner core (white-hot) ──
    ctx.beginPath()
    for (let i = 0; i <= 14; i++) {
      const t = i / 14
      const angle = t * Math.PI - Math.PI / 2
      const xOff = Math.sin(angle) * baseWidth * 0.2
      const turb = noise(time * 5 + t * 7 + 2) * baseWidth * 0.05
      const x = cx + xOff + turb * (1 - t * 0.5)
      const y = engineY + flameHeight * (0.3 + t * 0.7) + Math.sin(time * 3.5 + i * 3) * 1.5
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    const ig = ctx.createRadialGradient(cx, engineY + flameHeight * 0.2, 0, cx, engineY + flameHeight * 0.2, baseWidth * 0.25)
    ig.addColorStop(0, 'rgba(255, 255, 255, 1)')
    ig.addColorStop(0.4, 'rgba(255, 255, 230, 0.9)')
    ig.addColorStop(0.7, 'rgba(255, 230, 120, 0.5)')
    ig.addColorStop(1, 'rgba(255, 200, 80, 0)')
    ctx.fillStyle = ig
    ctx.globalAlpha = 0.9 * intensity
    ctx.fill()

    // ── Engine glow ──
    const glowR = baseWidth * 0.8
    const gg = ctx.createRadialGradient(cx, engineY + 10, 0, cx, engineY + 10, glowR)
    gg.addColorStop(0, `rgba(255, 200, 60, ${0.35 * intensity})`)
    gg.addColorStop(0.3, `rgba(255, 120, 30, ${0.2 * intensity})`)
    gg.addColorStop(0.6, `rgba(255, 60, 15, ${0.1 * intensity})`)
    gg.addColorStop(1, 'rgba(255, 30, 5, 0)')
    ctx.fillStyle = gg
    ctx.globalAlpha = 0.5 * intensity
    ctx.fillRect(cx - glowR, engineY + 5, glowR * 2, glowR * 1.2)

    // ── Sparks during launch ──
    if (isLaunching) {
      for (let i = 0; i < 8; i++) {
        const sparkT = (time * 4 + i * 1.3 + Math.random() * 0.5) % 1
        const sx = cx + (Math.random() - 0.5) * baseWidth
        const sy = engineY + sparkT * flameHeight * 0.8 + Math.sin(time * 6 + i) * 4
        ctx.beginPath()
        ctx.arc(sx, sy, 1 + Math.random() * 3, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, ${180 + Math.random() * 75}, ${30 + Math.random() * 80}, ${(1 - sparkT) * 0.9})`
        ctx.fill()
      }
    }
  }

  /** Draw two SRB flames on the full-screen canvas */
  function drawFlames() {
    if (!flameCtx || !flameCanvas) return
    const ctx = flameCtx
    const w = flameCanvas.width
    const h = flameCanvas.height

    ctx.clearRect(0, 0, w, h)

    const intensity = rocketState === 'launching' ? 1 : rocketState === 'filling' ? 0.5 : 0.3
    flameTime += 0.06

    const { leftX, rightX, engineY } = getSrbPositions()

    // Left SRB flame
    drawSingleFlame(ctx, leftX, engineY, intensity, flameTime)
    // Right SRB flame
    drawSingleFlame(ctx, rightX, engineY, intensity, flameTime + 0.3)
    // Slightly dim central SSME flame (between the SRBs)
    if (intensity > 0.3) {
      const centerX = (leftX + rightX) / 2
      drawSingleFlame(ctx, centerX, engineY + 4, intensity * 0.4, flameTime + 0.15)
    }

    flameAnimFrame = requestAnimationFrame(drawFlames)
  }

  // ─── Smoke System ──────────────────────────────────────────────

  function spawnSmokeAtEngine(side: 'left' | 'right', count: number, isLaunch: boolean) {
    const { leftX, rightX, engineY } = getSrbPositions()
    const cx = side === 'left' ? leftX : rightX
    const groundY = window.innerHeight - 20

    for (let i = 0; i < count; i++) {
      const spreadDir = side === 'left' ? -1 : 1
      const speed = isLaunch
        ? 1.5 + Math.random() * 4
        : 0.3 + Math.random() * 1.2
      const downSpeed = isLaunch
        ? 1.0 + Math.random() * 2.5
        : 0.3 + Math.random() * 0.8

      smokeParticles = [
        ...smokeParticles,
        {
          id: particleId++,
          x: cx + (Math.random() - 0.5) * vw(1.5),
          y: engineY + (Math.random() - 0.5) * 10,
          size: isLaunch
            ? 12 + Math.random() * 40
            : 6 + Math.random() * 18,
          opacity: 0.4 + Math.random() * 0.4,
          vx: spreadDir * speed + (Math.random() - 0.5) * 0.5,
          vy: downSpeed + (Math.random() - 0.5) * 0.3,
          rot: Math.random() * 360,
          rotSpeed: (Math.random() - 0.5) * 2,
          groundLevel: groundY - Math.random() * 40,
        },
      ]
    }
  }

  function startSmoke() {
    smokeInterval = setInterval(() => {
      if (rocketState === 'launching' || rocketState === 'flying') return
      spawnSmokeAtEngine('left', 2, false)
      spawnSmokeAtEngine('right', 2, false)
      if (smokeParticles.length > 200) {
        smokeParticles = smokeParticles.slice(-200)
      }
    }, 100)
  }

  function animateSmoke() {
    const centerX = window.innerWidth * (SHUTTLE_CENTER_VW / 100)

    smokeParticles = smokeParticles
      .map((p) => {
        const newSize = p.size + 0.15 + Math.random() * 0.1
        const newOpacity = p.opacity - 0.002 - Math.random() * 0.0015

        let newVy = p.vy + 0.015
        let newVx = p.vx

        // Ground effect: once near ground, spread outward
        if (p.y >= p.groundLevel) {
          newVy *= 0.92
          const dir = p.x > centerX ? 1 : -1
          newVx += dir * (0.03 + Math.random() * 0.02)
          newVx *= 1.002
        } else {
          newVx *= 0.995
        }

        newVy = Math.min(newVy, 4)

        return {
          ...p,
          x: p.x + newVx + Math.sin(p.y * 0.01) * 0.2,
          y: p.y + newVy,
          size: newSize,
          opacity: newOpacity,
          vx: newVx,
          vy: newVy,
          rot: p.rot + p.rotSpeed,
        }
      })
      .filter((p) =>
        p.opacity > 0.005 &&
        p.y < window.innerHeight + 100 &&
        p.x > -200 &&
        p.x < window.innerWidth + 200
      )
  }

  // ─── Launch Sequence ───────────────────────────────────────────

  async function handleSubmit(e: Event) {
    e.preventDefault()
    if (formSubmitting) return
    formSubmitting = true
    rocketState = 'launching'
    clearInterval(smokeInterval)

    // Submit to web3forms.com
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
      rocketState = 'idle'
      return
    }

    // Massive launch smoke burst — billows down and spreads wide
    spawnSmokeAtEngine('left', 80, true)
    spawnSmokeAtEngine('right', 80, true)

    // Extra ground-level smoke that spreads wide
    const { leftX, rightX, engineY } = getSrbPositions()
    const groundY = window.innerHeight - 20
    for (let i = 0; i < 40; i++) {
      const side = i < 20 ? -1 : 1
      smokeParticles = [
        ...smokeParticles,
        {
          id: particleId++,
          x: (i < 20 ? leftX : rightX) + (Math.random() - 0.5) * 30,
          y: engineY + 20 + Math.random() * 20,
          size: 20 + Math.random() * 50,
          opacity: 0.5 + Math.random() * 0.4,
          vx: side * (1.5 + Math.random() * 4),
          vy: 1.0 + Math.random() * 2,
          rot: Math.random() * 360,
          rotSpeed: (Math.random() - 0.5) * 2.5,
          groundLevel: groundY - 30 + Math.random() * 30,
        },
      ]
    }

    // Launch sequence
    let startTime = Date.now()
    const launchDuration = 3000

    // Continuous smoke during launch
    const launchSmokeInterval = setInterval(() => {
      if (rocketState === 'flying') {
        clearInterval(launchSmokeInterval)
        return
      }
      spawnSmokeAtEngine('left', 3, true)
      spawnSmokeAtEngine('right', 3, true)
    }, 80)

    function animateLaunch() {
      const elapsed = Date.now() - startTime
      launchProgress = Math.min(elapsed / launchDuration, 1)

      const eased = 1 - Math.pow(1 - launchProgress, 3)
      rocketY = eased * window.innerHeight * 1.2

      animateSmoke()

      if (launchProgress >= 1) {
        rocketState = 'flying'
        formSuccess = true
        clearInterval(launchSmokeInterval)
        const flyUp = () => {
          rocketY += 4
          animateSmoke()
          if (rocketY < window.innerHeight * 2) {
            animFrame = requestAnimationFrame(flyUp)
          }
        }
        animFrame = requestAnimationFrame(flyUp)
        return
      }

      animFrame = requestAnimationFrame(animateLaunch)
    }
    animFrame = requestAnimationFrame(animateLaunch)
  }

  function handleResize() {
    resizeFlameCanvas()
  }

  onMount(() => {
    const onScroll = () => {
      if (!contactSection) return
      const rect = contactSection.getBoundingClientRect()
      scrollY = -rect.top
    }
    window.addEventListener('scroll', onScroll)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', handleResize)
      clearInterval(smokeInterval)
      cancelAnimationFrame(animFrame)
      cancelAnimationFrame(flameAnimFrame)
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

    <img src={launchpadFgUrl} class="launchpad-foreground" alt="" aria-hidden="true" />
  </div>

  <!-- Full-screen flame & smoke overlay (behind launchpad foreground) -->
  <div class="flame-overlay" aria-hidden="true">
    <canvas
      bind:this={flameCanvas}
      class="flame-overlay-canvas"
      aria-hidden="true"
    ></canvas>

    {#each smokeParticles as particle (particle.id)}
      <div
        class="smoke-particle smoke-particle--overlay"
        style="left: {particle.x}px; top: {particle.y}px; width: {particle.size}px; height: {particle.size}px; opacity: {particle.opacity}; transform: rotate({particle.rot}deg)"
      ></div>
    {/each}
  </div>

  <!-- Shuttle — positioned independently to align with the launchpad -->
  <div
    class="shuttle-container"
    style="transform: translateY({-rocketY}px)"
  >
    <div class="rocket-wrapper">
      <img src={shuttleUrl} class="shuttle" alt="Space Shuttle" />
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
                oninput={() => handleInput('name')}
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
                oninput={() => handleInput('email')}
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
                oninput={() => handleInput('message')}
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
                oninput={() => handleInput('name')}
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
                oninput={() => handleInput('email')}
                required
              />
            </div>

            <div class="field-mob">
              <textarea
                id="message-mob"
                name="message"
                placeholder="Tell us about your mission..."
                bind:value={formData['message']}
                oninput={() => handleInput('message')}
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

  /* ── Full-screen flame & smoke overlay (behind foreground) ── */
  .flame-overlay {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    z-index: 2;
    pointer-events: none;
    overflow: hidden;
  }
  .flame-overlay-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
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
    transition: transform 0.05s linear;
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

  .smoke-particle--overlay {
    position: fixed;
    border-radius: 50%;
    pointer-events: none;
    z-index: 2;
    background: radial-gradient(
      circle at 40% 40%,
      rgba(250, 248, 245, 0.85),
      rgba(220, 225, 230, 0.45) 30%,
      rgba(180, 190, 200, 0.2) 55%,
      rgba(140, 155, 170, 0.06) 80%
    );
    box-shadow:
      0 0 40px rgba(255, 255, 255, 0.06),
      inset 0 -6px 16px rgba(160, 175, 190, 0.12);
    will-change: transform, opacity;
    mix-blend-mode: screen;
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
