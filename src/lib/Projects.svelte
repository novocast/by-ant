<script lang="ts">
  import { onMount } from 'svelte'

  let scrollY = 0
  let sectionEl: HTMLElement

  function scrollToContact() {
    document.getElementById('contact-section')?.scrollIntoView({ behavior: 'smooth' })
  }

  onMount(() => {
    const onScroll = () => {
      if (!sectionEl) return
      const rect = sectionEl.getBoundingClientRect()
      scrollY = -rect.top
    }
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  })

  const projects = [
    {
      title: 'Pixel8',
      tag: 'Mobile App',
      desc: 'A companion app for a physical pixel-art toy. Create 8×8 or 16×16 grids, scan them in with edge detection and skew correction, and share with friends or order as stickers.',
      color: '#f43f5e',
      accent: '#fb7185',
      layout: 'half',
      stats: ['Edge detection', 'Colour pixel detection', 'Skew correction'],
    },
    {
      title: 'Evanescence',
      tag: 'Laravel Package',
      desc: 'A Laravel package that brings ephemeral, single-use hashed tokens to life — for secure one-time validation, then vanishes without a trace. Powered by Argon2.',
      color: '#8b5cf6',
      accent: '#a78bfa',
      layout: 'half',
      stats: ['Argon2 hashed', 'Cache/Database storage', 'Configurable TTL'],
    },
    {
      title: 'Take a Deeks',
      tag: 'Interactive Learning',
      desc: 'An interactive deep-dive learning resource spanning everything from game engines to astrophysics. Each topic is a self-contained HTML page with quizzes, timelines, and rich visuals.',
      color: '#14b8a6',
      accent: '#2dd4bf',
      layout: 'third',
      stats: ['20+ topics', 'Pure HTML/CSS/JS', 'Interactive quizzes'],
    },
    {
      title: 'Flock',
      tag: 'Game',
      desc: 'A pixel-art shepherd simulator. Guide a fluffy flock across a procedural landscape, dodge wolves, and survive the seasons. Built with TypeScript and Canvas 2D.',
      color: '#eab308',
      accent: '#facc15',
      layout: 'third',
      stats: ['Canvas 2D', 'Procedural world', 'Endless & Dynasty'],
    },
    {
      title: 'Otto',
      tag: 'Local AI',
      desc: 'A local LLM orchestrator in Rust with a tool-first architecture. Run models locally with granular permission controls over every tool call — safety built in from the ground up.',
      color: '#06b6d4',
      accent: '#22d3ee',
      layout: 'third',
      stats: ['Rust', 'Tool permissions', 'Local-first'],
    },
  ]
</script>

<section class="projects" bind:this={sectionEl}>
  <!-- Parallax cloud layers -->
  <div class="cloud-layer cloud-1" style="transform: translateY({scrollY * 0.08}px)">
    <svg viewBox="0 0 1440 240" preserveAspectRatio="none" width="1440" height="240">
      <path d="M0,160 C240,80 480,160 720,100 C960,40 1200,120 1440,80 C1440,160 1080,180 720,175 C360,170 0,190 0,200 Z"
        fill="rgba(255,255,255,0.04)" />
    </svg>
  </div>
  <div class="cloud-layer cloud-2" style="transform: translateY({scrollY * 0.15}px)">
    <svg viewBox="0 0 1440 240" preserveAspectRatio="none" width="1440" height="240">
      <path d="M0,120 C320,180 640,60 960,130 C1280,200 1440,80 1440,80 C1440,170 1080,190 720,180 C360,170 0,195 0,200 Z"
        fill="rgba(255,255,255,0.06)" />
    </svg>
  </div>
  <div class="cloud-layer cloud-3" style="transform: translateY({scrollY * 0.22}px)">
    <svg viewBox="0 0 1440 240" preserveAspectRatio="none" width="1440" height="240">
      <path d="M0,80 C180,160 360,40 540,120 C720,200 900,60 1080,110 C1260,160 1440,80 1440,80 C1440,180 1080,195 720,190 C360,185 0,195 0,200 Z"
        fill="rgba(255,255,255,0.08)" />
    </svg>
  </div>

  <!-- Transition clouds between projects and contact -->
  <div class="cloud-layer cloud-4" style="transform: translateY({scrollY * 0.05}px)">
    <svg viewBox="0 0 1440 240" preserveAspectRatio="none" width="1440" height="240">
      <path d="M0,180 C180,120 360,180 540,150 C720,120 900,170 1080,140 C1260,110 1440,150 1440,180 L1440,240 L0,240 Z"
        fill="rgba(255,255,255,0.03)" />
    </svg>
  </div>
  <div class="cloud-layer cloud-5" style="transform: translateY({scrollY * 0.10}px)">
    <svg viewBox="0 0 1440 240" preserveAspectRatio="none" width="1440" height="240">
      <path d="M0,190 C200,150 400,200 600,170 C800,140 1000,185 1200,160 C1320,145 1440,165 1440,190 L1440,240 L0,240 Z"
        fill="rgba(255,255,255,0.05)" />
    </svg>
  </div>

  <div class="projects-content">
    <div class="section-label">✦ Projects</div>
    <h2 class="section-title">What We've <span class="highlight">Engineered</span></h2>
    <p class="section-desc">Every single project is unique: designed with intention, engineered to specification, and built for impact.</p>

    <div class="projects-grid">
      {#each projects as project, i}
        <article
          class="project-card card-{project.layout}"
          style="--card-color: {project.color}; --card-accent: {project.accent}"
        >
          <div class="card-bg">
            <div class="card-orbit">
              {#each Array(6) as _, ci}
                <div
                  class="orbit-ring"
                  style="--i: {ci}; --delay: {ci * 0.4}s"
                ></div>
              {/each}
            </div>
          </div>
          <div class="card-content">
            <span class="card-tag">{project.tag}</span>
            <h3 class="card-title">{project.title}</h3>
            <p class="card-desc">{project.desc}</p>
            <div class="card-stats">
              {#each project.stats as stat}
                <span class="stat-pill">{stat}</span>
              {/each}
            </div>
          </div>
          <div class="card-number">{"0" + (i + 1)}</div>
        </article>
      {/each}
    </div>

    <div class="get-in-touch">
      <button class="contact-btn" onclick={scrollToContact}>
        Get in Touch
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </button>
    </div>
  </div>
</section>

<style>
  .projects {
    position: relative;
    min-height: 100vh;
    padding: 6rem 2rem 8rem;
    background: linear-gradient(
      180deg,
      #1a1a3e 0%,
      #2d1b69 20%,
      #8b3a8f 45%,
      #e2716d 100%
    );
    overflow: hidden;
  }

  .cloud-layer {
    position: absolute;
    left: 0;
    width: 100%;
    pointer-events: none;
    z-index: 1;
  }
  .cloud-1 { top: 5%; }
  .cloud-2 { top: 15%; }
  .cloud-3 { top: 25%; }
  .cloud-4 {
    bottom: 0;
    z-index: 2;
    opacity: 0.7;
  }
  .cloud-5 {
    bottom: -4%;
    z-index: 3;
    opacity: 0.5;
  }
  .cloud-layer svg { width: 100%; height: auto; }

  .projects-content {
    position: relative;
    z-index: 5;
    max-width: var(--max-width);
    margin: 0 auto;
  }

  .section-label {
    display: inline-block;
    font-size: 0.85rem;
    font-weight: 600;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.6);
    margin-bottom: 0.75rem;
  }

  .section-title {
    font-size: clamp(2rem, 5vw, 3.5rem);
    font-weight: 800;
    color: white;
    margin-bottom: 1rem;
  }
  .highlight {
    background: linear-gradient(135deg, #f5c571, #e8756a);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .section-desc {
    font-size: 1.05rem;
    color: rgba(255,255,255,0.7);
    max-width: 500px;
    margin-bottom: 3rem;
    line-height: 1.7;
  }

  .projects-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 1.5rem;
  }

  .project-card {
    position: relative;
    border-radius: 20px;
    overflow: hidden;
    background: rgba(255,255,255,0.06);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.1);
    transition: transform 0.3s, box-shadow 0.3s;
    cursor: default;
    height: 100%;
  }

  .project-card .card-content {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 2rem 2rem 2.8rem;
  }

  .project-card:hover {
    transform: translateY(-6px);
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  }

  .card-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
  }
  .card-orbit {
    position: absolute;
    top: -40%;
    right: -30%;
    width: 200%;
    height: 200%;
  }
  .orbit-ring {
    position: absolute;
    top: 50%;
    left: 50%;
    width: calc(60px * (var(--i) + 3));
    height: calc(60px * (var(--i) + 3));
    margin: calc(-30px * (var(--i) + 3));
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.06);
    animation: orbit-spin 20s linear infinite;
    animation-delay: var(--delay);
  }
  @keyframes orbit-spin {
    to { transform: rotate(360deg); }
  }

  .card-tag {
    align-self: flex-start;
    padding: 0.25rem 0.75rem;
    border-radius: 100px;
    background: var(--card-color);
    color: white;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin-bottom: 1rem;
  }

  .card-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: white;
    margin-bottom: 0.6rem;
  }

  .card-desc {
    flex: 1;
    font-size: 0.85rem;
    color: rgba(255,255,255,0.7);
    line-height: 1.6;
    margin-bottom: 1.2rem;
  }

  .card-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .stat-pill {
    padding: 0.2rem 0.6rem;
    border-radius: 100px;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.08);
    font-size: 0.7rem;
    color: rgba(255,255,255,0.7);
  }

  .card-number {
    position: absolute;
    bottom: 1rem;
    right: 1.5rem;
    font-size: 3rem;
    font-weight: 900;
    color: rgba(255,255,255,0.04);
    line-height: 1;
    z-index: 1;
  }

  /* Layout variants */
  .card-half {
    grid-column: span 3;
  }
  .card-third {
    grid-column: span 2;
  }

  @media (max-width: 900px) {
    .projects-grid {
      grid-template-columns: repeat(2, 1fr);
    }
    .card-half {
      grid-column: span 1;
    }
    .card-third {
      grid-column: span 1;
    }
  }

  .get-in-touch {
    display: flex;
    justify-content: center;
    margin-top: 12rem;
  }

  .contact-btn {
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
  }
  .contact-btn:hover {
    transform: translateY(-1px);
    box-shadow: 4px 8px 0 rgb(234 179 8), 0 14px 20px rgba(0, 0, 0, 0.14);
  }

  @media (max-width: 500px) {
    .projects-grid {
      grid-template-columns: 1fr;
    }
    .projects { padding: 4rem 1rem 5rem; }
  }
</style>
