"use strict";

const { refresh } = require("../index/refresh");

function registerSearchIpc(ipcMain) {
  ipcMain.handle("note:refresh-index", async () => {
    const refreshed = await refresh();
    return { refreshed, documents: refreshed.documents };
  });
}

module.exports = { registerSearchIpc };