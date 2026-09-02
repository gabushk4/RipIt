const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const net = require('net')
const fs = require('fs')

let mainWindow
let pythonProcess
let keepAlive;
let APIPort;

const isDev = !app.isPackaged

const serverBin = process.platform === 'win32' ? 'server.exe' : 'server'
const serverPath = isDev
    ? path.join(__dirname, 'server.py')
    : path.join(process.resourcesPath, serverBin)

function findFreePort(){
    return new Promise((resolve, reject) => {
        const server = net.createServer()
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port
            APIPort = port
            server.close(() => resolve(port))
        })
        server.on('error', reject)
    })
}

// Starts python server used for ytb conversion
// Callback is called after success and error
async function startPython(port, callback) {
    let callbackCalled = false
    function safeCallback() {
        if (!callbackCalled) {
            callbackCalled = true
            callback()
        }
    }

    const env = {
        ...process.env, PYTHONUNBUFFERED: '1', PORT: port 
    }

    if (isDev) {
        pythonProcess = spawn('python', [serverPath], {
            cwd: __dirname,
            env
        })
    } else {
        pythonProcess = spawn(serverPath, [], {
            cwd: process.resourcesPath,
            env
        })
    }

    console.log("server in ", serverPath)

    pythonProcess.stdout.on('data', (data) => {
        console.log(`Python: ${data}`)
        if (mainWindow) mainWindow.webContents.executeJavaScript(
            `console.log(${JSON.stringify("Python: " + data.toString())})`
        )
        if (data.toString().includes('Running on') || 
            data.toString().includes('Uvicorn running')) {
            safeCallback()
        }
    })
    pythonProcess.stderr.on('data', (data) => {
        console.error(`Python error: ${data}`)
        if (data.toString().includes('Running on')) {
            safeCallback()
        }
    })
    setTimeout(safeCallback, 3000)
}
// Keeps the py server alive
// Sometimes it just stops listening to requests??
async function ensureServer(){
    fetch(`http://localhost:${APIPort}/health`, {signal: AbortSignal.timeout(2000)})
        .then(res => res.json())
        .then(data => {
            console.log("server ensured:", data.server_status)
        })
        .catch(async err => {
            console.log("server ensured with error:", err.status)
            //if server is running we kill it
            if(pythonProcess) pythonProcess.kill(); 
            // We then start a new instance
            await new Promise(resolve => startPython(APIPort, resolve))
        })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth:480,
    minHeight:480,
    title:'RipIt',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  mainWindow.loadFile("./views/index.html")
  if(isDev)
    mainWindow.webContents.openDevTools()
}

ipcMain.handle('choose-folder', async () =>{
    const defaultPath = app.getPath('downloads')

    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        defaultPath
    })
    return result.filePaths[0] ?? defaultPath
})

ipcMain.handle('get-apple-music-preload-path', () => {
  return `file:///${path.join(__dirname, 'preload_apple-music.js').replace(/\\/g, '/')}`
})

const selectionPath = path.join(app.getPath('userData'), 'selection.json')

function readSelection() {
  try {
    console.log("selectionpath", selectionPath)
    return JSON.parse(fs.readFileSync(selectionPath, 'utf-8'))
  } catch (_) {
    return []
  }
}

function writeSelection(selection) {
  fs.writeFileSync(selectionPath, JSON.stringify(selection, null, 2))
}

ipcMain.handle('get-selection', () => {
  return readSelection()
})

ipcMain.handle('add-song', (event, song) => {
  const selection = readSelection()
  const id = `${song.title}-${song.artist}`.toLowerCase().replace(/\s+/g, '-')

  // Évite les doublons si on clique deux fois sur la même chanson
  if (selection.some(s => s.id === id)) return selection

  selection.push({ ...song, id, addedAt: new Date().toISOString() })
  writeSelection(selection)
  return selection
})

ipcMain.handle('remove-song', (event, id) => {
  const selection = readSelection().filter(s => s.id !== id)
  writeSelection(selection)
  return selection
})

app.whenReady().then(async () => {
    APIPort = await findFreePort()
    process.env.API_PORT = APIPort
    startPython(APIPort, createWindow)
    keepAlive = setInterval(ensureServer, 60000) //ensures the server responds every minute
})

app.on('window-all-closed', () => {
    clearInterval(keepAlive)
    if (pythonProcess) pythonProcess.kill()
    app.quit()
})