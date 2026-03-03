const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    title: 'טשטושי פלגה',
    show: false,
  });

  mainWindow.setBackgroundColor('#f3f4f6');
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Save single image (base64 data URL)
ipcMain.handle('save-image', async (event, { dataUrl, suggestedName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: suggestedName || 'מטושטש.jpg',
    filters: [
      { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (canceled || !filePath) return { canceled: true };
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return { canceled: false, filePath };
});

// Save ZIP file (buffer from renderer)
ipcMain.handle('save-zip', async (event, { buffer, suggestedName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: suggestedName || 'מטושטש.zip',
    filters: [
      { name: 'ZIP File', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (canceled || !filePath) return { canceled: true };
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  fs.writeFileSync(filePath, buf);
  return { canceled: false, filePath };
});

ipcMain.handle('is-electron', () => true);
