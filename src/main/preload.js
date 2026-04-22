const { contextBridge, ipcRenderer } = require('electron');

// Canales IPC permitidos — lista blanca explícita por seguridad
const ALLOWED_CHANNELS = [
  'buscar-socio-por-dni',
  'registrar-asistencia',
  'crear-socio',
  'registrar-pago',
  'obtener-dashboard',
  'obtener-membresias',
  'buscar-socio-admin',
  'generar-reporte-excel',
  'crear-backup',
  'restaurar-base-datos',
];

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, data) => {
    if (!ALLOWED_CHANNELS.includes(channel)) {
      return Promise.reject(new Error(`Canal no permitido: ${channel}`));
    }
    return ipcRenderer.invoke(channel, data);
  },
  on: (channel, callback) => {
    if (!ALLOWED_CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
});
