import './config/env'
import { app, shell, BrowserWindow, protocol, net, session } from 'electron'
import { cropLayoutTemplateService } from './templates/cropLayoutTemplateService'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc/registerIpcHandlers'
import * as logger from './logging/logger'
import {
  isOfflineUatMode,
  installOfflineUatFetchGuard,
  isAllowedLocalUrlInOfflineUat
} from './config/offlineUatGuard'

const OFFLINE_UAT_WINDOW_TITLE = 'Wifran Offers Extractor [OFFLINE UAT - SIMULATED]'

if (process.argv.includes('--offline-uat') || process.env.WIFRAN_OFFLINE_UAT === '1') {
  process.env.WIFRAN_OFFLINE_UAT = '1';
  installOfflineUatFetchGuard();
  logger.info('[Main] WIFRAN_OFFLINE_UAT mode active: network providers, remote databases, and external HTTP requests strictly isolated.');
}

function createWindow(): void {
  const isUat = isOfflineUatMode();
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    title: isUat ? OFFLINE_UAT_WINDOW_TITLE : 'Wifran Offers Extractor',
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('page-title-updated', (event) => {
    if (isOfflineUatMode()) {
      event.preventDefault()
      if (mainWindow.getTitle() !== OFFLINE_UAT_WINDOW_TITLE) {
        mainWindow.setTitle(OFFLINE_UAT_WINDOW_TITLE)
      }
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.maximize()
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isOfflineUatMode()) {
      logger.warn(`[OFFLINE_UAT_GUARD] Blocked window.open / shell.openExternal for URL: ${details.url}`)
      return { action: 'deny' }
    }
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true
    }
  }
])

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.wifran.offersextractor')

  if (isOfflineUatMode()) {
    installOfflineUatFetchGuard()
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      if (isAllowedLocalUrlInOfflineUat(details.url)) {
        callback({ cancel: false })
      } else {
        logger.warn(`[OFFLINE_UAT_GUARD] Blocked external browser session request: ${details.url}`)
        callback({ cancel: true })
      }
    })
  }

  protocol.handle('local-file', (request) => {
    try {
      const urlObj = new URL(request.url)
      let pathPart = urlObj.searchParams.get('path')
      
      // Fallback for older format if it somehow arrives
      if (!pathPart) {
        pathPart = request.url.replace(/^local-file:\/*/, '')
        pathPart = decodeURIComponent(pathPart)
        if (pathPart.match(/^[a-zA-Z]\//)) {
          pathPart = pathPart[0] + ':' + pathPart.slice(1)
        } else if (!pathPart.match(/^[a-zA-Z]:/)) {
          pathPart = '/' + pathPart
        }
      }
      
      const fs = require('fs')
      const { pathToFileURL } = require('url')
      const normalizedPath = require('path').normalize(pathPart)
      const exists = fs.existsSync(normalizedPath)
      
      console.log(`[local-file] Request URL: ${request.url}`)
      console.log(`[local-file] Resolved Path: ${normalizedPath} (Exists: ${exists})`)
      
      const fileUrl = pathToFileURL(normalizedPath).toString()
      return net.fetch(fileUrl)
    } catch (e) {
      console.error('[local-file] Error handling request:', e)
      return new Response('Error', { status: 500 })
    }
  })

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  logger.info('App initialized successfully')
  
  cropLayoutTemplateService.archiveLegacyTemplates().then((record: any) => {
    logger.info(`Legacy templates migration: ${record.archived_template_count} archived.`)
  }).catch((err: any) => {
    logger.error(`Legacy templates migration failed: ${err.message}`)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
