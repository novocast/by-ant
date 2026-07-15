<script lang="ts">
  import { onMount } from 'svelte'
  import moonUrl from '../assets/moon.svg'

  let canvas: HTMLCanvasElement
  let stars: { x: number; y: number; r: number; a: number; s: number }[] = []
  let animationId: number
  let moonOffsetX = 0
  let moonOffsetY = 0
  let scrollY = 0

  onMount(() => {
    const ctx = canvas.getContext('2d')!
    const resize = () => {
      canvas.width = canvas.parentElement!.offsetWidth
      canvas.height = canvas.parentElement!.offsetHeight
      initStars()
    }
    const initStars = () => {
      stars = Array.from({ length: 200 }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 2 + 0.5,
        a: Math.random() * 0.8 + 0.2,
        s: Math.random() * 0.3 + 0.05,
      }))
    }
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const t = Date.now() / 1000
      for (const star of stars) {
        const twinkle = Math.sin(t * 2 + star.x * 0.01 + star.y * 0.01) * 0.3 + 0.7
        ctx.beginPath()
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 255, 255, ${star.a * twinkle})`
        ctx.fill()
      }
      // Shooting star occasional
      if (Math.sin(t * 0.3) > 0.97) {
        const sx = Math.random() * canvas.width * 0.8
        const sy = Math.random() * canvas.height * 0.4
        const len = 60 + Math.random() * 80
        const angle = Math.PI / 4 + Math.random() * 0.5
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(sx - Math.cos(angle) * len, sy + Math.sin(angle) * len)
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + Math.random() * 0.4})`
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      animationId = requestAnimationFrame(draw)
    }
    resize()
    draw()
    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', (e) => {
      const centerX = window.innerWidth / 2
      const centerY = window.innerHeight / 2
      moonOffsetX = (e.clientX - centerX) * 0.03
      moonOffsetY = (e.clientY - centerY) * 0.03
    })
    const handleScroll = () => {
      scrollY = window.scrollY
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', resize)
      window.removeEventListener('scroll', handleScroll)
    }
  })

  function scrollToProjects() {
    document.getElementById('projects-section')?.scrollIntoView({ behavior: 'smooth' })
  }
</script>

<section class="hero">
  <canvas bind:this={canvas} class="starfield"></canvas>

  <!-- Moon -->
  <div class="moon" style="--moon-offset-x: {moonOffsetX}px; --moon-offset-y: {moonOffsetY}px; --parallax-y: {scrollY * 0.60}px;">
    <img src={moonUrl} alt="" aria-hidden="true" />
  </div>

  <!-- Content -->
  <div class="hero-content">
    <div class="penrose-graphic" aria-hidden="true">
      <svg class="penrose-icon" viewBox="0 0 2322.98 2009.32" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="penrose-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#b794f4" />
            <stop offset="55%" stop-color="#7dd3fc" />
            <stop offset="100%" stop-color="#c084fc" />
          </linearGradient>
        </defs>
        <path fill="url(#penrose-grad)" d="M2321.9,1759.37L1305.88,7.2c-.17-.8-.45-1.58-.87-2.31-1.42-2.47-4.05-4-6.91-4.01l-275.34-.88h-.03c-2.85,0-5.49,1.52-6.92,3.99L1.31,1757.17s-.04.05-.05.08c-.02.03-.03.06-.04.08l-.14.24c-1.43,2.47-1.43,5.52,0,8,.38.66.85,1.25,1.38,1.76l135.73,236.43c1.43,2.48,4.07,4.01,6.93,4.02l2029.25,1.55h0c2.2,0,4.27-.91,5.76-2.46.53-.5,1-1.08,1.39-1.73l140.36-237.68c1.47-2.49,1.48-5.58.03-8.08ZM1027.34,16.01l256.79.82L418.93,1518.91c-.36.62-.62,1.28-.8,1.95-.66,2.11-.43,4.42.7,6.37,1.43,2.47,4.06,4,6.92,4l111.29.12,163.32.66h.03c.93,0,1.84-.18,2.69-.48l913.95.96,124.8,218.14-1719.76,2.61L1027.34,16.01ZM714.52,1515.54l448.34-776.91,445.02,777.84-893.36-.93ZM149.75,1991.78l-127.55-222.19,1743.14.99h0c2.88,0,5.54-1.55,6.96-4.05,1.42-2.5,1.39-5.58-.09-8.05l-142.23-238.09c-.76-1.27-1.85-2.27-3.11-2.95l-454.32-794.09,126.26-217.56,297.64,513.59,564.03,973.94-2010.73-1.53ZM2174.69,1985.22l-565.12-975.12-303.73-524.45c-.29-.5-.64-.95-1.03-1.37-1.45-2.37-4.03-3.83-6.82-3.83h0c-2.86,0-5.49,1.53-6.92,4l-595.02,1031.08-158.94-.17-97.37-.39L1297.86,25.27l1007.85,1738.08-131.02,221.88Z"/>
      </svg>
    </div>

    <h1 class="tagline">
      Building Digital Worlds <span class="gradient-text">With Code</span>
    </h1>
    <button class="scroll-btn" onclick={scrollToProjects}>
      See Our Work
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>
    </button>
  </div>

  <!-- Dawn sky blend -->
  <div class="sky-blend"></div>

  <!-- Scroll indicator -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="scroll-indicator" onclick={scrollToProjects} onkeydown={(e) => e.key === 'Enter' && scrollToProjects()} role="button" tabindex="0">
    <div class="scroll-dot"></div>
  </div>
</section>

<style>
  .hero {
    position: sticky;
    top: 0;
    z-index: 1;
    width: 100%;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    clip-path: inset(0);
    background: linear-gradient(135deg, #0a0a1a 0%, #0d0a2e 30%, #120840 60%, #1a1a3e 100%);
  }

  .starfield {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
    pointer-events: none;
  }

  .moon {
    position: absolute;
    top: -15%;
    right: -2%;
    width: 40rem;
    height: 40rem;
    z-index: 2;
    filter: drop-shadow(0 0 80px rgba(245, 240, 232, 0.22));
    transform: translate3d(var(--moon-offset-x, 0), calc(var(--moon-offset-y, 0) + var(--parallax-y, 0px)), 0);
    animation: moon-float 18s ease-in-out infinite;
    will-change: transform;
  }
  .moon img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
  }

  @keyframes moon-float {
    0%, 100% { transform: translate3d(var(--moon-offset-x, 0), calc(var(--moon-offset-y, 0) + var(--parallax-y, 0px)), 0); }
    50% { transform: translate3d(var(--moon-offset-x, 0), calc(var(--moon-offset-y, 0) - 6px + var(--parallax-y, 0px)), 0); }
  }

  .hero-content {
    position: relative;
    z-index: 3;
    text-align: center;
    max-width: 920px;
    padding: 2rem;
  }

  .penrose-graphic {
    margin: 0 auto 1.5rem;
    width: min(180px, 18vw);
  }

  .penrose-icon {
    width: 100%;
    height: auto;
    filter: drop-shadow(0 0 20px rgba(124, 92, 252, 0.65)) drop-shadow(0 0 12px rgba(96, 165, 250, 0.45));
  }

  .tagline {
    font-size: clamp(3rem, 7vw, 6.5rem);
    font-weight: 800;
    line-height: 1.2;
    color: white;
    padding-top: 1rem;
    margin-bottom: 6.2rem;
    letter-spacing: -0.02em;
    text-shadow: 0 2px 30px rgba(255, 255, 255, 0.07);
  }

  .gradient-text {
    background: linear-gradient(135deg, #eb4f0f, #dc8a4c, #fc4f09);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .subtitle {
    font-size: clamp(1rem, 2vw, 1.2rem);
    color: var(--text-muted);
    max-width: 540px;
    margin: 0 auto 2rem;
    line-height: 1.7;
  }

  .scroll-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.95rem 1.75rem;
    border-radius: 0;
    border: none;
    background: rgb(174 91 57);
    color: #1a1040;
    font-size: 1rem;
    font-weight: 700;
    text-transform: uppercase;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
    box-shadow: 4px 6px 0 rgb(81 123 122), 0 12px 18px rgba(0, 0, 0, 0.12);
  }
  .scroll-btn:hover {
    transform: translateY(-1px);
    box-shadow: 4px 8px 0 rgb(81 123 122), 0 14px 20px rgba(0, 0, 0, 0.14);
  }

  /* Dawn sky blend overlay - bridges space section to projects section */
  .sky-blend {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 200px;
    background: linear-gradient(to bottom, transparent 0%, #1a1a3e 100%);
    z-index: 2;
    pointer-events: none;
  }

  .scroll-indicator {
    position: absolute;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 3;
    width: 28px;
    height: 44px;
    border: 2px solid rgba(255,255,255,0.25);
    border-radius: 14px;
    cursor: pointer;
    display: flex;
    justify-content: center;
    padding-top: 8px;
  }
  .scroll-dot {
    width: 4px;
    height: 8px;
    background: white;
    border-radius: 2px;
    animation: scroll-bounce 2s ease-in-out infinite;
  }
  @keyframes scroll-bounce {
    0%, 100% { transform: translateY(0); opacity: 1; }
    50% { transform: translateY(8px); opacity: 0.3; }
  }
</style>
