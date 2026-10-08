"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clipnote", {
  search: (query) => ipcRenderer.invoke("note:search", query),
  copy: (payload) => ipcRenderer.invoke("note:copy", payload),
  refreshIndex: () => ipcRenderer.invoke("note:refresh-index"),
});