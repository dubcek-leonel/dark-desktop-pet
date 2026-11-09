import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

function createPetWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 256,
    height: 256,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  createPetWindow()
})

app.on('window-all-closed', () => app.quit())
