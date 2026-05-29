const { app, BrowserWindow } = require('electron')
const { spawn } = require('child_process')
const path = require('path')

let mainWindow
let pythonProcess

// Starts python server used for ytb conversion
// Callback is called after success and error
function startPython(callback) {
    let callbackCalled = false

    // So the callback doesnt get called two times
    function safeCallback() {
        if (!callbackCalled) {
            callbackCalled = true
            callback()
        }
    }

    pythonProcess = spawn('python', ['server.py'], {
        cwd: __dirname
    })

    pythonProcess.stdout.on('data', (data) => {
        console.log(`Python: ${data}`)
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

    // Fallback — opens after 3 seconds no matter what
    setTimeout(safeCallback, 3000)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.loadFile("./views/index.html")
}

app.whenReady().then(() => {
  startPython(createWindow)
})

app.on('window-all-closed', () => {
  if (pythonProcess) pythonProcess.kill()
  app.quit()
})