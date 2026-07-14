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
</style>
