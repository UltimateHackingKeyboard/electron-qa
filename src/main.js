const { app, BrowserWindow, ipcMain } = require('electron')
const isDev = require('electron-is-dev')
const { autoUpdater } = require('electron-updater')
const electronSettings = require('electron-settings')
const path = require('path')

// The electron window
let win

app.allowRendererProcessReuse = true

app
  .whenReady()
  .then(createWindow)
  .then(sendAppSettings)
  .catch(console.error)

function createWindow() {
  win = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  return win
    .loadFile(path.join(__dirname, 'index.html'))
}

function sendAppSettings() {
  const settings = {
    autoUpdate: electronSettings.get('autoUpdate') || {
      checkForUpdateAtStartup: false,
      preReleaseAllowed: false,
    },
    version: app.getVersion(),
  }

  win.webContents.send('app-settings', settings)
}

ipcMain.on('check-for-update', function saveSettings(event, preReleaseAllowed) {
  if (isDev)
    return win.webContents.send('auto-update-status', {
      message: 'Application update is not working in development mode.',
      type: 'info'
    })

  autoUpdater.allowPrerelease = preReleaseAllowed
  autoUpdater.checkForUpdatesAndNotify()
})

ipcMain.on('save-settings', function saveSettings(event, settings) {
  electronSettings.set('autoUpdate', settings)
})

autoUpdater.on('checking-for-update', () => {
  win.webContents.send('auto-update-status', { message: 'Checking for update', type: 'info' })
})

autoUpdater.on('update-available', (event, info) => {
  console.log('update-available', info)
  win.webContents.send('auto-update-status', { message: `Update available. New version ${info.version}`, type: 'info' })
})

autoUpdater.on('update-not-available', (event, info) => {
  console.log('update-not-available', info)
  win.webContents.send('auto-update-status', { message: 'Update not available', type: 'info' })
})

autoUpdater.on('error', (event, error) => {
  console.error(error)
  win.webContents.send('auto-update-status', { message: `Error on update: ${error.message}`, type: 'error' })
})

autoUpdater.on('download-progress', (progress) => {
  console.log('update-download-progress', progress)
  win.webContents.send('auto-update-status', { message: `Downloading update ${progress.percent}`, type: 'info' })
})

autoUpdater.on('update-downloaded', (event, info) => {
  win.webContents.send('auto-update-status', {
    event: 'update-downloaded',
    message: `${info.version} version downloaded`,
    type: 'info'
  })
})

