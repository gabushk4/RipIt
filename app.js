'use strict';

const AUDIO_EXTS = ['flac', 'wav', 'aiff', 'ogg', 'm4a', 'mp3', 'aac', 'wma', 'opus', 'ape'];
const API_BASE = 'http://localhost:5000';

let links = [];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const urlInput    = document.getElementById('url-input'); 
const clearUrlBtn = document.getElementById('clear-input');
const actions     = document.getElementById('actions');
const convertBtn  = document.getElementById('convert-btn');
const clearBtn    = document.getElementById('clear-btn');
const progressWrap = document.getElementById('progress-wrap');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const summaryEl   = document.getElementById('summary');
const formatSel   = document.getElementById('format');
const bitrateGroup = document.getElementById('bitrate-group');
const dropArea     = document.getElementById('drop-area')
const historyList = document.getElementById('history-list')

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function uid() {
  return Math.random().toString(36).slice(2);
}

async function getHistory(){
  // Loading state
  historyList.innerHTML = `
    <div style="display: flex; justify-content: center; align-items: center; height:100%; ">
      <div class="spinner"></div>
    </div>
  `
  const res = await fetch(`${API_BASE}/history`)    
  const data = await res.json()

  console.log("history:", data.history)

  if(data.history.length > 0)
    historyList.innerHTML = `
      ${data.history.map(video =>`
        <div class="history-line">
          <span class="line-title">${video.title}</span>
          <span class="line-timestamp">${video.downloaded_at}</span>
        </div>
      `).join('')}
    `
  else
    historyList.innerHTML = `
      <div>
        <p>Commencez à télécharger!</p>
      </div>
    `
}

// ── Input management ───────────────────────────────────────────────────────────
function clearAll() {
  clearInput()
  clearFile()
  summaryEl.style.display = "none"
}

function clearInput(){
  urlInput.value = ""
  renderEmptyState()
}

function clearFile(){
  document.getElementById('file-result').style.display = 'none';
  document.getElementById('drop-area').style.display = 'block';
}

// ── Render ────────────────────────────────────────────────────────────────────
async function renderThumbnail(url) {
  //returns the infos of the video
  const container = document.getElementById('video-infos');
  
  //Afficher les actions
  actions.style.display = 'flex';

  // État: chargement
  container.innerHTML = `
    <div class="empty-state">
      <div class="spinner"></div>
      Chargement des informations...
    </div>
  `;

  try {
    const formData = new FormData();
    formData.append('url', url);

    const res = await fetch(`${API_BASE}/info`, { method: 'POST', body: formData });
    if (!res.ok){
      const data = await res.json()
      console.log("erreur:", data)
      let message = "Vidéo introuvable"

      container.innerHTML = `
      <div class="error-state">
        ${message}
      </div>`

      convertBtn.disabled = true

      return;
    }
    const data = await res.json();

    // Formatage durée en mm:ss
    const duration = data.duration
      ? `${Math.floor(data.duration / 60)}:${String(data.duration % 60).padStart(2, '0')}`
      : '--:--';

    // État: succès
    container.innerHTML = `
      <div id="video-thumbnail-container">
        <img id="video-thumbnail" src="${data.thumbnail}" alt="Miniature" />
      </div>
      <div id="video-meta">
        <p id="video-title">${data.title}</p>
        <p id="video-uploader">mise en ligne par <span style="font-weight: bold;">${data.uploader || ''}</span></p>
        <div id="video-footer">
          <p id="video-duration">durée <span style="font-weight: bold;">${duration}</span> minutes</p>
        </div>
      </div>
    `;
    return {
      title: data.title
    }
  } catch (err) {
    // État: erreur
    console.log("erreur RenderThumbnail", err)
    container.innerHTML = `
      <div class="empty-state error-state">
        Impossible de récupérer les informations.<br>Vérifie l'URL.
      </div>
    `;
  }
}
function renderEmptyState(){
  // Remet l'état vide si le champ est effacé
  document.getElementById('video-infos').innerHTML = `
    <div class="empty-state">
      Les informations de la vidéo s'afficheront ici
    </div>
  `;

  //Cacher les actions
  actions.style.display = 'none';
}

function renderInputError(message){
  const messageComponent = document.getElementById("message")
  document.getElementById("message-container").style.display = "flex";
  
  messageComponent.textContent = message
}

function hideInputError(){
  document.getElementById("message-container").style.display = "none";
}

// Url input 
let debounceTimer;

['input', 'keydown'].forEach(eType => {
  urlInput.addEventListener(eType, (e) => {
    clearTimeout(debounceTimer);
    let url = e.target.value.trim();

    if (url.length < 1) {
      hideInputError()
      renderEmptyState();
      return;
    }

    // Extract video ID
    let videoId = null;

    if (url.includes("v=")) {
      // Search bar format : youtube.com/watch?v=ID&list=...
      const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
      videoId = match ? match[1] : null;
    }
    else if (url.includes("youtu.be/")) {
      // Share format : youtu.be/ID?si=...
      const match = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
      videoId = match ? match[1] : null;
    }
    else if (url.includes("/shorts/")) {
      // Shorts format : youtube.com/shorts/ID
      const match = url.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      videoId = match ? match[1] : null;
    }
    else if (url.includes("/embed/")) {
      // Embed format : youtube.com/embed/ID
      const match = url.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
      videoId = match ? match[1] : null;
    }

    if (!videoId) {
      renderInputError("Lien invalide");
      return;
    }
    else{
      hideInputError()
    }

    // URL propre et canonique
    const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log("videoId:", videoId);
    console.log("cleanUrl:", cleanUrl);

    e.target.value = cleanUrl 

    debounceTimer = setTimeout(() => renderThumbnail(cleanUrl), 800);
  });
})

// Format selector
formatSel.addEventListener('change', () => {
  bitrateGroup.style.display = formatSel.value === 'flac' ? 'none' : 'flex';
});

// Download
async function downloadSingle(url, format, bitrate, samplerate, channels, title, outputDir) {
  const formData = new FormData();
  formData.append('url', url);
  formData.append('format', format);
  formData.append('bitrate', bitrate);
  formData.append('samplerate', samplerate);
  formData.append('channels', channels);
  formData.append('output_dir', outputDir);
  if (title) formData.append('title', title);

  // Executes the download
  const { job_id } = await fetch(`${API_BASE}/download`, { method: 'POST', body: formData })
    .then(r => r.json())
    .catch(err =>{
      console.log("erreur a l'initialisation du telechargement", err)
    })
  console.log("Job id: ", job_id)
  
  return job_id
  
}

async function startDownload() {
  // Where should we put the video?
  const folder = await window.electronAPI.chooseFolder();

  console.log("output folder:", folder, typeof folder)

  convertBtn.disabled = true;
  summaryEl.style.display = 'none';
  progressWrap.style.display = 'block';

  const format     = formatSel.value;
  const bitrate    = document.getElementById('bitrate').value;
  const samplerate = document.getElementById('samplerate').value;
  const channels   = document.getElementById('channels').value;

  // Construit la queue : soit le txt, soit l'input URL unique
  const queue = links.length > 0
    ? links.map(url => ({ url, title: '' }))
    : [{ url: urlInput.value.trim(), title: document.getElementById('video-title').textContent.trim() }];

  const total = queue.length;
  let done = 0;
  let errors = 0;

  for (const item of queue) {
    try {
      progressText.textContent = `${done} / ${total}`;
      progressFill.style.width = `${((done) / total) * 100}%`;
      let videoDatas;
      // Fetch les infos et met à jour la card
      try {
        videoDatas = await renderThumbnail(item.url);
        item.title = videoDatas.title
      } catch (_) {
        // Si /info échoue, on continue quand même le téléchargement
      }

      console.log("downloading item: ", item.url, item.title, format, bitrate, samplerate, channels, folder)

      const job_id = await downloadSingle(item.url, format, bitrate, samplerate, channels, item.title, folder);
      // Listens to the progress
      await new Promise((resolve, reject) => {
        const eventSource = new EventSource(`${API_BASE}/progress/${job_id}`)

        eventSource.onopen = () => console.log("SSE connecte", job_id)
        eventSource.onerror = (e) => console.log("SSE erreur", e)

        eventSource.onmessage = (e) => {
          const data = JSON.parse(e.data)
          if (data.phase === 'downloading') {
            progressText.textContent = `Téléchargement ${data.percent} — ${data.eta}`
          } else if (data.phase === 'converting') {
            progressText.textContent = `Conversion en cours...`
          } else if (data.done) {
            eventSource.close()
            window.location.href = `${API_BASE}/result/${job_id}`
            resolve()
          }
        }
        eventSource.onerror = () => {
          eventSource.close()
          reject(new Error('Connexion SSE perdue'))
        }
      })
    } catch (err) {
      console.error(`Erreur pour ${item.url}:`, err);
      errors++;
    }
  }

  progressFill.style.width = '100%';
  progressText.textContent = `${total} / ${total}`;
  summaryEl.style.display = 'block';

  if (errors === 0) {
    summaryEl.className = 'success';
    summaryEl.textContent = `${done} fichier${done > 1 ? 's' : ''} converti${done > 1 ? 's' : ''} avec succès en ${format.toUpperCase()}${format !== 'flac' ? ' ' + bitrate : ' lossless'}.`;
  } else {
    summaryEl.className = 'error';
    summaryEl.textContent = `${done} réussi${done > 1 ? 's' : ''}, ${errors} erreur${errors > 1 ? 's' : ''}. Vérifie les URLs et que FFmpeg est installé.`;
  }

  convertBtn.disabled = false;
}

//Event listeners
convertBtn.addEventListener('click', startDownload);
clearBtn.addEventListener('click', clearAll);
clearUrlBtn.addEventListener('click', clearInput)
clearUrlBtn.addEventListener('mouseenter', function(e) {
  this.classList.replace('ph', 'ph-fill')
})
clearUrlBtn.addEventListener('mouseleave', function(e) {
  this.classList.replace('ph-fill', 'ph')
})

// Dropzone
function handleFile(file) {
  if (!file || !file.name.endsWith('.txt')) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const urls = e.target.result
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('http'));

    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-count').textContent =
      `${urls.length} lien${urls.length > 1 ? 's' : ''} détecté${urls.length > 1 ? 's' : ''}`;
    document.getElementById('drop-area').style.display = 'none';
    document.getElementById('file-result').style.display = 'flex';

    if(urls.length > 1){
      links = urls
      //Afficher les actions
      actions.style.display = 'flex';
      convertBtn.textContent = "Télécharger les vidéos"
    }
    // urls est prêt pour downloadMany(urls, options)
  };
  reader.readAsText(file);
}

// Drag & drop
dropArea.addEventListener('dragover', (e) => e.preventDefault());
dropArea.addEventListener('drop', (e) => {
  e.preventDefault();
  handleFile(e.dataTransfer.files[0]);
});

// Clicks
document.getElementById('txt-input').addEventListener('change', (e) => handleFile(e.target.files[0]));

// Manages the history component being slid in and out
const histBtn = document.getElementById('history-btn')
histBtn.addEventListener('click', ()=>{
  // Lets fetch the users history
  getHistory()

  const historyMenu = document.getElementById("history")
  historyMenu.classList.toggle('visible')
  histBtn.classList.contains('ph-clock')
    ? histBtn.classList.replace('ph-clock', 'ph-x')
    : histBtn.classList.replace('ph-x', 'ph-clock') 
  
})

// Reset
document.getElementById('clear-files-btn').addEventListener('click', clearFile);