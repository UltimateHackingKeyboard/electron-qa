const electron = require('electron')

if (!window.ipcRenderer) {
  window.ipcRenderer = electron.ipcRenderer
}
