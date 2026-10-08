"use strict";

const { app, BrowserWindow, ipcMain, clipboard } = require("electron");
const path = require("node:path");
const { registerSearchIpc } = require("./src/ipc/search-ipc");
const { buildSearchIndex } = require("./src/search/index-builder");
const { formatSnippet } = require("./src/search/snippet");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  return mainWindow;
}

function registerIpc() {
  ipcMain.handle("note:search", async (_event, query) => {
    if (typeof query !== "string" || query.length === 0) {
      throw new TypeError("note:search requires a non-empty string query");
    }
    const index = buildSearchIndex(app.getPath("userData"));
    return { query, results: formatSnippet(index.search(query), 160) };
  });

  ipcMain.handle("note:copy", async (_event, payload) => {
    clipboard.writeText(String(payload));
    return { copied: true, length: String(payload).length };
  });

  registerSearchIpc(ipcMain);
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});