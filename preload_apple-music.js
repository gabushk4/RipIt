const { ipcRenderer } = require('electron')

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (e) => {
    const row = e.target.closest('[data-testid="track-list-item"]')
    if (!row) return

    e.preventDefault()
    e.stopPropagation()

    const title = row.querySelector('[data-testid="track-title"]')?.textContent.trim()
    const artist = row.querySelector('[data-testid="track-title-by-line"]')?.textContent.trim()
    const duration = row.querySelector('[data-testid="track-duration"]')?.textContent.trim()

    if (title) {
      ipcRenderer.sendToHost('song-selected', { title, artist, duration, source: 'apple-music' })
    }
  }, true)
})