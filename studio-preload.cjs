const { contextBridge, webUtils } = require('electron');

contextBridge.exposeInMainWorld('moddockDesktop', {
 gamePath: file => webUtils.getPathForFile(file),
});
