import { writable } from 'svelte/store'

// Set to true when the Contact-section shuttle actually flies. The Hero
// section watches this to play its one-shot "now in orbit" payoff.
export const missionFlown = writable(false)
