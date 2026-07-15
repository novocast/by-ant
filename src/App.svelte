<script lang="ts">
  import Hero from './lib/Hero.svelte'
  import Projects from './lib/Projects.svelte'
  import Contact from './lib/Contact.svelte'
</script>

<div class="app">
  <div id="hero-section"><Hero /></div>
  <div id="projects-section" class="section-transition"><Projects /></div>
  <div id="contact-section" class="section-transition-alt"><Contact /></div>
</div>

<footer class="site-footer">
  &copy; byant.co.uk 2026
</footer>

<style>
  .app {
    width: 100%;
  }
  .section-transition {
    position: relative;
    margin-top: -2px;
  }
  .section-transition-alt {
    position: relative;
    margin-top: -2px;
  }

  .site-footer {
    position: fixed;
    bottom: 0.6rem;
    right: 0.6rem;
    z-index: 100;
    font-family: var(--font-sans);
    font-size: 0.8rem;
    font-weight: 500;
    color: rgba(10,10, 10, 0.7);
    letter-spacing: 0.02em;
    pointer-events: none;
    user-select: none;
  }
</style>
