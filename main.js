const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { spawn } = require('child_process')
const path = require('path')

let mainWindow
let pythonProcess
let keepAlive;

const isDev = !app.isPackaged

const serverBin = process.platform === 'win32' ? 'server.exe' : 'server'

const serverPath = isDev
    ? path.join(__dirname, 'server.py')
    : path.join(process.resourcesPath, serverBin)



// Starts python server used for ytb conversion
// Callback is called after success and error
function startPython(callback) {
    let callbackCalled = false
    function safeCallback() {
        if (!callbackCalled) {
            callbackCalled = true
            callback()
        }
    }

    if (isDev) {
        pythonProcess = spawn('python', [serverPath], {
            cwd: __dirname,
            env: { ...process.env, PYTHONUNBUFFERED: '1' }
        })
    } else {
        pythonProcess = spawn(serverPath, [], {
            cwd: process.resourcesPath,
            env: { ...process.env, PYTHONUNBUFFERED: '1' }
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
    setTimeout(safeCallback, 5000)
}
// Keeps the py server alive
// Sometimes it just stops listening to requests??
async function ensureServer(){
    try {
        await fetch('http://localhost:5000/health', {signal: AbortSignal.timeout(2000)})
        return // All good
    } catch (error) {
        //if server is running we kill it
        if(pythonProcess) pythonProcess.kill(); 
        // We then start a new instance
        await new Promise(resolve => startPython(resolve))
    }
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
      nodeIntegration: false
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

app.whenReady().then(() => {
  startPython(createWindow)
  keepAlive = setInterval(ensureServer, 60000) //ensure the server responds every minute
})

app.on('window-all-closed', () => {
    clearInterval(keepAlive)
    if (pythonProcess) pythonProcess.kill()
    app.quit()
})