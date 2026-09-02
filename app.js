'use strict';

const AUDIO_EXTS = ['flac', 'wav', 'aiff', 'ogg', 'm4a', 'mp3', 'aac', 'wma', 'opus', 'ape'];
const API_BASE = window.electronAPI.API_BASE_URL
window.electronAPI.getAppleMusicPreloadPath().then(preloadPath => {
  document.getElementById('apple-music-webview').setAttribute('preload', preloadPath)
})

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
const progressContainer = document.getElementById(`progress-container`)
const phaseText = document.getElementById('phase-text')
const summaryEl   = document.getElementById('summary');
const formatSel   = document.getElementById('format');
const bitrateGroup = document.getElementById('bitrate-group');
const dropArea     = document.getElementById('drop-area')
const historyList = document.getElementById('history-list')
const selectionList = document.getElementById('selection-list')
const duplicatesModal = document.getElementById('duplicates-modal-container')
const selectionBtn = document.getElementById('selection-btn')
const histBtn = document.getElementById('history-btn')

// ── Helpers ───────────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2);
}

function formatTimestamp(timestamp){
  const now = new Date();
  const then = new Date(timestamp.replace(' ', 'T'));
  const diffMs = now - then;
  const diffMin = diffMs / 60000;
  const diffH   = diffMs / 3600000;
  const diffD   = diffMs / 86400000;

  if (diffD > 1) {
    // Plus d'un jour → date seulement
    return then.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  } else if (diffH >= 1) {
    // Moins d'un jour → heure seulement
    return then.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  } else {
    // Moins d'une heure → minutes
    const m = Math.max(1, Math.round(diffMin));
    return `il y a ${m} minute${m > 1 ? 's' : ''}`;
  }
}

async function getHistory(apiBase){  
  const res = await fetch(`${apiBase}/history`)    
  const data = await res.json()

  return data.history;  
}

async function verifyDownloadHistory(videoId, history){
  history = Object.values(history).flat()
  let video = history.find(v => v.ytb_id === videoId)
  return video
}

function extractVideoId(url){
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

    return videoId
}

function generateCleanUrl(url, onSuccess = ()=>{}, onError = ()=>{}){
  // Extract video ID
    let videoId = extractVideoId(url)

    if (!videoId) {
      onError()
      return null;
    }
    else{
      onSuccess()
    }

    // Creating clean url
    const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log("videoId:", videoId);
    console.log("cleanUrl:", cleanUrl);

    return cleanUrl
}

// ── Input management ───────────────────────────────────────────────────────────
function clearAll() {
  clearInput()
  clearFile()
  summaryEl.style.display = "none"
  progressContainer.style.display = "none"
}

function clearInput(){
  urlInput.value = ""
  renderEmptyState()
}

function clearFile(){
  document.getElementById('file-result').style.display = 'none';
  document.getElementById('drop-area').style.display = 'block';
}

// Renders
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
    convertBtn.disabled = false
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

async function renderHistory(){
  // Loading state
  historyList.innerHTML = `
    <div style="display: flex; justify-content: center; align-items: center; height:100%; ">
      <div class="spinner"></div>
    </div>
  `

  const history = await getHistory(API_BASE)
  console.log(`cover: ${history.cover}`)

  if(history.length > 0)
    historyList.innerHTML = `
      ${history.map(video =>`
        <div class="list-line">
          <img
            src=${video.cover}
            class="line-cover"
          />
          <div class="line-container">            
            <span class="line-title">${video.title}</span>
            <span class="line-timestamp">${formatTimestamp(video.downloaded_at)}</span>
          </div>
          
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

async function renderSelection() {
  //loading
  selectionList.innerHTML = `
    <div style="display: flex; justify-content: center; align-items: center; height:100%; ">
      <div class="spinner"></div>
    </div>
  `
  const selection = await window.electronAPI.getSelection()
  console.log('Sélection actuelle:', selection)
  if(selection.length > 0)
    selectionList.innerHTML = `
    ${
      selection.map(song =>`
        <div class="list-line">
          <img
            src=${song.cover}
            class="line-cover"
          />
          <div class="line-container">            
            <span class="line-title">${song.title}</span>
            <span class="line-artist">${song.artist}</span>
            <span class="line-timestamp">${song.duration}</span>
          </div>          
        </div>
      `)
    }
    `
  else{
    selectionList.innerHTML = `
      <div>
        <p>Commencez à sélectionner dans votre plateforme de streaming!</p>
      </div>
    `
  }
    
}

function openSelection(){
  renderSelection()
  const selectPanel = document.getElementById('selection-panel')
  selectPanel.classList.toggle('visible')
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

    const onGenerateSuccess = ()=>{
      hideInputError()
    }

    const onGenerateError = () =>{
      renderInputError("Lien invalide")
      return
    }

    let cleanUrl = generateCleanUrl(url, onGenerateSuccess, onGenerateError)

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
  const result = await fetch(`${API_BASE}/download`, { method: 'POST', body: formData })
    .then(r => r.json())
    .catch(err => {
        console.log("erreur a l'initialisation du telechargement", err)
        return null
    })

  if (!result || !result.job_id) {
      throw new Error('Impossible de contacter le serveur')
  }

  const { job_id } = result
  
  return job_id  
}

async function startDownload() {
  // Where should we put the video?
  const folder = await window.electronAPI.chooseFolder();

  console.log("output folder:", folder, typeof folder)

  convertBtn.disabled = true;
  summaryEl.style.display = 'none';
  progressContainer.style.display = 'block';

  const format     = formatSel.value;
  const bitrate    = document.getElementById('bitrate').value;
  const samplerate = document.getElementById('samplerate').value;
  const channels   = document.getElementById('channels').value;

  // Construit la queue : soit le txt, soit l'input URL unique
  const queue = links.length > 0
    ? links.map(url => ({ url, title: '' }))
    : [{ url: generateCleanUrl(urlInput.value.trim()), title: document.getElementById('video-title').textContent.trim() }];

  const total = queue.length;
  let done = 0;
  let errors = 0;

  for (const item of queue) {
    try {
      progressText.textContent = `${done} / ${total}`;
      
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
      await new Promise( (resolve, reject) => {
        const eventSource = new EventSource(`${API_BASE}/progress/${job_id}`)

        eventSource.onopen = () => console.log("SSE connecte", job_id)

        eventSource.onmessage = async (e) => {
          const data = JSON.parse(e.data)
          console.log("SSE data", data)
          if (data.phase === 'downloading') {
            phaseText.textContent = `Téléchargement — ${data.eta}`
            progressFill.style.width = data.percent;
          } else if (data.phase === 'converting') {
            progressFill.style.background = "orange"
            phaseText.textContent = `Conversion en cours...`
            phaseText.style.color = "orange"
          } else if (data.done) {
            console.log("dl done data: ", data)
            let message = "Complété"
            phaseText.style.color = "#888"
            if(data.error){
              message = "Incomplété" 
              phaseText.style.color = "red"
            }
            
            progressFill.style.background = "#378ADD"
            progressFill.style.width = "0%";
            phaseText.textContent = message
            eventSource.close()
            fetch(`${API_BASE}/result/${job_id}`) // cleanup serveur
              .then(res => res.json())
              .then(data => {
                console.log("resultat de la job", data)
                if(data.status == `done`){
                  done++
                  resolve()                                    
                }
                else{
                  reject( Error("Erreur au telechargement de", item.title))
                }           
              })
              .catch(err=>{
                console.log("Erreur au cleanup de la job", err)
                throw Error("Erreur au cleanup de la job : ", err.toString())
              })
            
          }
        }
        eventSource.onerror = (e) => {
          eventSource.close()
          reject(new Error('Connexion SSE perdue : ', e))
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
document.querySelectorAll('.action-tray i').forEach(btn => {
  btn.addEventListener('click', () => {
    const panel = document.getElementById(btn.dataset.target)
    console.log('open panel', panel.id)
    if (!panel) return

    panel.classList.toggle('visible')

    if (panel.classList.contains('visible') && btn.dataset.onopen) {
      const fn = window[btn.dataset.onopen]
      if (typeof fn === 'function') fn()
    }
  })
})
document.querySelectorAll('.panel-close-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.closest('.side-panel').classList.remove('visible')
  })
})

// Dropzone
function askDuplicate(title) {
  const MAX_TITLE_LGT = 24
  if(title.length > MAX_TITLE_LGT){
    title = title.substring(0, MAX_TITLE_LGT)
    title += '...'
  }
  return new Promise(resolve => {
    document.getElementById('duplicates-modal-msg').textContent =
      `"${title}" a déjà été téléchargé. Que voulez-vous faire?`;
    duplicatesModal.style.display = 'flex';

    const cleanup = (download) => {
      const rememberCb = document.getElementById('duplicates-modal-remember')
      const remember = rememberCb.checked;
      duplicatesModal.style.display = 'none';
      rememberCb.checked = false;
      resolve({ download, remember });
    };

    document.getElementById('duplicates-modal-download').onclick = () => cleanup(true);
    document.getElementById('duplicates-modal-skip').onclick    = () => cleanup(false);
  });
}

async function handleFile(file) {
  if (!file || !file.name.endsWith('.txt')) return;

  const history = await getHistory(API_BASE)

  const reader = new FileReader();
  reader.onload = async (e) => {

    let bulkAction = null; // null = pas encore décidé

    const urls = [];
    for (const l of e.target.result.split('\n')) {
      const videoId = extractVideoId(l);
      const video = await verifyDownloadHistory(videoId, history);
      
      if (video) {
        console.log(`video found:`, video)
        let download;

        if (bulkAction !== null) {
          // User checked remember then we do the same for this link
          download = bulkAction;
        } else {
          const { download: d, remember } = await askDuplicate(video.title);
          download = d;
          if (remember) bulkAction = d;
        }

        if (!download) continue; // ignore this link
      }

      const cleanUrl = generateCleanUrl(l.trim());
      if (cleanUrl != null) urls.push(cleanUrl);
    }

    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-count').textContent =
      `${urls.length} lien${urls.length > 1 ? 's' : ''} détecté${urls.length > 1 ? 's' : ''}`;
    document.getElementById('drop-area').style.display = 'none';
    document.getElementById('file-result').style.display = 'flex';

    if(urls.length > 0){
      links = urls
      // Display actions
      actions.style.display = 'flex';
      convertBtn.textContent = "Télécharger les vidéos"
    }
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

// Reset
document.getElementById('clear-files-btn').addEventListener('click', clearFile);