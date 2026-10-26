'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// A narrow document API; no filesystem paths can grant a root from the page.
const names = ['state', 'choose', 'select', 'list', 'read', 'search', 'propose', 'proposal', 'pending', 'apply', 'history', 'restore', 'saveThread', 'deleteThread', 'removeProject', 'saveNotes', 'notesStatus', 'saveProject', 'appMenu', 'writingProtection', 'startupReady'];
contextBridge.exposeInMainWorld('localWorkspace', Object.freeze(Object.fromEntries(names.map(name => [name, value => ipcRenderer.invoke('workspace:' + name, value)]))));
