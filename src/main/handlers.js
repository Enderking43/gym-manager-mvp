const { ipcMain, dialog, app } = require('electron');
const path = require('path');
const fs   = require('fs');
const { dbGet, dbAll, dbRun, saveDatabase, getDbFilePath } = require('../database/db');

// Fecha local hoy → YYYY-MM-DD
function getToday() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

// Suma N días a una fecha YYYY-MM-DD y devuelve YYYY-MM-DD
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function registerHandlers() {

  // ── BUSCAR SOCIO POR DNI ────────────────────────────────────────────────
  // Máquina de estados: verde / amarillo / rojo.
  // Solo escribe en DB (y persiste) cuando cambia estado_aviso.
  ipcMain.handle('buscar-socio-por-dni', (_event, dni) => {
    try {
      const today = getToday();
      const socio = dbGet('SELECT * FROM socios WHERE dni = ?', [String(dni).trim()]);
      if (!socio) return { status: 'no_encontrado' };

      const lastPago = dbGet(`
        SELECT p.*, m.nombre AS membresia_nombre
        FROM   pagos p
        JOIN   membresias m ON m.id = p.membresia_id
        WHERE  p.socio_id = ?
        ORDER  BY p.fecha_vencimiento DESC
        LIMIT  1
      `, [socio.id]);

      if (!lastPago) return { status: 'rojo', socio, mensaje: 'Sin membresía registrada' };

      if (lastPago.fecha_vencimiento >= today) {
        // ── VERDE ──────────────────────────────────────────────────────────
        if (socio.estado_aviso !== 0) {
          dbRun('UPDATE socios SET estado_aviso = 0 WHERE id = ?', [socio.id]);
          saveDatabase();
        }
        return { status: 'verde', socio: { ...socio, estado_aviso: 0 }, pago: lastPago };

      } else if (socio.estado_aviso === 0) {
        // ── AMARILLO ───────────────────────────────────────────────────────
        dbRun('UPDATE socios SET estado_aviso = 1 WHERE id = ?', [socio.id]);
        saveDatabase();
        return { status: 'amarillo', socio: { ...socio, estado_aviso: 1 }, pago: lastPago };

      } else {
        // ── ROJO ───────────────────────────────────────────────────────────
        return { status: 'rojo', socio, pago: lastPago };
      }
    } catch (err) {
      console.error('[buscar-socio-por-dni]', err);
      return { status: 'error', mensaje: err.message };
    }
  });

  // ── REGISTRAR ASISTENCIA ────────────────────────────────────────────────
  ipcMain.handle('registrar-asistencia', (_event, socio_id) => {
    try {
      const { lastInsertRowid } = dbRun(
        'INSERT INTO asistencias (socio_id) VALUES (?)', [socio_id]
      );
      saveDatabase();
      return { success: true, id: lastInsertRowid };
    } catch (err) {
      console.error('[registrar-asistencia]', err);
      return { success: false, error: err.message };
    }
  });

  // ── CREAR SOCIO ─────────────────────────────────────────────────────────
  ipcMain.handle('crear-socio', (_event, datos) => {
    try {
      const { dni, nombre, apellido, telefono } = datos;
      const { lastInsertRowid } = dbRun(
        'INSERT INTO socios (dni, nombre, apellido, telefono) VALUES (?,?,?,?)',
        [String(dni).trim(), nombre.trim(), apellido.trim(), telefono?.trim() || null]
      );
      saveDatabase();
      return { success: true, id: lastInsertRowid };
    } catch (err) {
      const isDuplicate = err.message && err.message.includes('UNIQUE');
      if (isDuplicate) return { success: false, error: 'El DNI ya está registrado' };
      console.error('[crear-socio]', err);
      return { success: false, error: err.message };
    }
  });

  // ── REGISTRAR PAGO ──────────────────────────────────────────────────────
  // Usa BEGIN/COMMIT para atomicidad: INSERT en pagos + UPDATE estado_aviso.
  ipcMain.handle('registrar-pago', (_event, datos) => {
    try {
      const { socio_id, membresia_id, monto, metodo_pago } = datos;

      const membresia = dbGet('SELECT * FROM membresias WHERE id = ?', [membresia_id]);
      if (!membresia) return { success: false, error: 'Membresía no encontrada' };

      const today          = getToday();
      const fechaVenc      = addDays(today, membresia.duracion_dias);

      // Transacción manual
      dbRun('BEGIN');
      try {
        const { lastInsertRowid } = dbRun(`
          INSERT INTO pagos
            (socio_id, membresia_id, fecha_pago, fecha_vencimiento, monto, metodo_pago)
          VALUES (?,?,?,?,?,?)
        `, [socio_id, membresia_id, today, fechaVenc, monto, metodo_pago]);

        dbRun('UPDATE socios SET estado_aviso = 0 WHERE id = ?', [socio_id]);
        dbRun('COMMIT');
        saveDatabase();

        return { success: true, id: lastInsertRowid, fecha_vencimiento: fechaVenc };
      } catch (inner) {
        dbRun('ROLLBACK');
        throw inner;
      }
    } catch (err) {
      console.error('[registrar-pago]', err);
      return { success: false, error: err.message };
    }
  });

  // ── OBTENER DASHBOARD ───────────────────────────────────────────────────
  ipcMain.handle('obtener-dashboard', () => {
    try {
      const today = getToday();

      const cajaDia = dbGet(`
        SELECT COALESCE(SUM(monto),0) AS total,
               COUNT(*)               AS cantidad_pagos
        FROM   pagos
        WHERE  fecha_pago = ?
      `, [today]);

      const deudores = dbAll(`
        SELECT s.id, s.dni, s.nombre, s.apellido, s.telefono,
               MAX(p.fecha_vencimiento) AS ultimo_vencimiento
        FROM   socios s
        LEFT JOIN pagos p ON p.socio_id = s.id
        GROUP  BY s.id
        HAVING ultimo_vencimiento < ? OR ultimo_vencimiento IS NULL
        ORDER  BY ultimo_vencimiento ASC
      `, [today]);

      return { success: true, cajaDia, deudores };
    } catch (err) {
      console.error('[obtener-dashboard]', err);
      return { success: false, error: err.message };
    }
  });

  // ── BUSCAR SOCIO (ADMIN) ────────────────────────────────────────────────
  // Sin efectos secundarios: no modifica estado_aviso. Solo para el panel admin.
  ipcMain.handle('buscar-socio-admin', (_event, dni) => {
    try {
      const socio = dbGet('SELECT * FROM socios WHERE dni = ?', [String(dni).trim()]);
      if (!socio) return { success: false, error: 'Socio no encontrado' };

      const lastPago = dbGet(`
        SELECT p.*, m.nombre AS membresia_nombre
        FROM   pagos p
        JOIN   membresias m ON m.id = p.membresia_id
        WHERE  p.socio_id = ?
        ORDER  BY p.fecha_vencimiento DESC
        LIMIT  1
      `, [socio.id]);

      const today = getToday();
      let estadoMembresia = 'sin_membresia';
      if (lastPago) {
        estadoMembresia = lastPago.fecha_vencimiento >= today ? 'vigente' : 'vencida';
      }

      return { success: true, socio, lastPago, estadoMembresia };
    } catch (err) {
      console.error('[buscar-socio-admin]', err);
      return { success: false, error: err.message };
    }
  });

  // ── OBTENER MEMBRESÍAS ──────────────────────────────────────────────────
  ipcMain.handle('obtener-membresias', () => {
    try {
      const membresias = dbAll('SELECT * FROM membresias ORDER BY duracion_dias ASC');
      return { success: true, membresias };
    } catch (err) {
      console.error('[obtener-membresias]', err);
      return { success: false, error: err.message };
    }
  });

  // ── GENERAR REPORTE EXCEL ───────────────────────────────────────────────
  ipcMain.handle('generar-reporte-excel', async () => {
    try {
      const today = getToday();

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Guardar Reporte Excel',
        defaultPath: `Reporte_Gimnasio_${today}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (canceled || !filePath) return { success: false, canceled: true };

      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Gimnasio MVP';
      wb.created = new Date();

      // ── Pestaña 1: Caja de Hoy ──────────────────────────────────────────
      const wsCaja = wb.addWorksheet('Caja de Hoy');
      wsCaja.columns = [
        { header: 'Socio',          key: 'socio',     width: 24 },
        { header: 'DNI',            key: 'dni',       width: 12 },
        { header: 'Membresía',      key: 'membresia', width: 16 },
        { header: 'Monto ($)',      key: 'monto',     width: 14 },
        { header: 'Método',         key: 'metodo',    width: 16 },
        { header: 'Vencimiento',    key: 'venc',      width: 16 },
      ];
      styleHeader(wsCaja);

      const pagosHoy = dbAll(`
        SELECT s.nombre || ' ' || s.apellido AS socio,
               s.dni, m.nombre AS membresia,
               p.monto, p.metodo_pago, p.fecha_vencimiento
        FROM   pagos p
        JOIN   socios     s ON s.id = p.socio_id
        JOIN   membresias m ON m.id = p.membresia_id
        WHERE  p.fecha_pago = ?
        ORDER  BY p.id DESC
      `, [today]);

      pagosHoy.forEach(r => wsCaja.addRow({
        socio: r.socio, dni: r.dni, membresia: r.membresia,
        monto: r.monto, metodo: r.metodo_pago, venc: r.fecha_vencimiento,
      }));

      const totalRow = wsCaja.addRow({ socio: 'TOTAL', monto: pagosHoy.reduce((s, r) => s + r.monto, 0) });
      totalRow.font = { bold: true };

      // ── Pestaña 2: Asistencias de Hoy ──────────────────────────────────
      const wsAsist = wb.addWorksheet('Asistencias de Hoy');
      wsAsist.columns = [
        { header: 'Socio',         key: 'socio',  width: 24 },
        { header: 'DNI',           key: 'dni',    width: 12 },
        { header: 'Hora Entrada',  key: 'hora',   width: 20 },
      ];
      styleHeader(wsAsist);

      const asistHoy = dbAll(`
        SELECT s.nombre || ' ' || s.apellido AS socio,
               s.dni, a.fecha_entrada
        FROM   asistencias a
        JOIN   socios s ON s.id = a.socio_id
        WHERE  date(a.fecha_entrada) = ?
        ORDER  BY a.id ASC
      `, [today]);

      asistHoy.forEach(r => wsAsist.addRow({
        socio: r.socio, dni: r.dni, hora: r.fecha_entrada,
      }));

      // ── Pestaña 3: Lista de Deudores ────────────────────────────────────
      const wsDeud = wb.addWorksheet('Lista de Deudores');
      wsDeud.columns = [
        { header: 'Nombre',          key: 'nombre',   width: 18 },
        { header: 'Apellido',        key: 'apellido', width: 18 },
        { header: 'DNI',             key: 'dni',      width: 12 },
        { header: 'Teléfono',        key: 'telefono', width: 16 },
        { header: 'Último Venc.',    key: 'venc',     width: 16 },
        { header: 'Días Vencido',    key: 'dias',     width: 14 },
      ];
      styleHeader(wsDeud);

      const deudores = dbAll(`
        SELECT s.nombre, s.apellido, s.dni, s.telefono,
               MAX(p.fecha_vencimiento) AS ultimo_vencimiento
        FROM   socios s
        LEFT JOIN pagos p ON p.socio_id = s.id
        GROUP  BY s.id
        HAVING ultimo_vencimiento < ? OR ultimo_vencimiento IS NULL
        ORDER  BY ultimo_vencimiento ASC
      `, [today]);

      deudores.forEach(r => {
        const dias = r.ultimo_vencimiento
          ? Math.round((new Date(today) - new Date(r.ultimo_vencimiento)) / 86400000)
          : null;
        wsDeud.addRow({
          nombre: r.nombre, apellido: r.apellido, dni: r.dni,
          telefono: r.telefono || '', venc: r.ultimo_vencimiento || 'Sin membresía',
          dias: dias !== null ? dias : '—',
        });
      });

      await wb.xlsx.writeFile(filePath);
      return { success: true, filePath };

    } catch (err) {
      console.error('[generar-reporte-excel]', err);
      return { success: false, error: err.message };
    }
  });

  // ── CREAR BACKUP ────────────────────────────────────────────────────────
  ipcMain.handle('crear-backup', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Seleccionar carpeta de destino (pendrive)',
        properties: ['openDirectory'],
      });
      if (canceled || !filePaths.length) return { success: false, canceled: true };

      const today   = getToday();
      const destDir = filePaths[0];
      const destFile = path.join(destDir, `backup_gimnasio_${today}.sqlite`);

      // Guardar estado actual antes de copiar (por si hay datos no persistidos)
      saveDatabase();
      fs.copyFileSync(getDbFilePath(), destFile);

      return { success: true, destFile };
    } catch (err) {
      console.error('[crear-backup]', err);
      return { success: false, error: err.message };
    }
  });

  // ── RESTAURAR BASE DE DATOS ─────────────────────────────────────────────
  ipcMain.handle('restaurar-base-datos', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Seleccionar archivo de backup (.sqlite)',
        filters: [{ name: 'Base de datos SQLite', extensions: ['sqlite'] }],
        properties: ['openFile'],
      });
      if (canceled || !filePaths.length) return { success: false, canceled: true };

      fs.copyFileSync(filePaths[0], getDbFilePath());

      // Reiniciar la app para que cargue la DB restaurada
      app.relaunch();
      app.exit(0);
      return { success: true };

    } catch (err) {
      console.error('[restaurar-base-datos]', err);
      return { success: false, error: err.message };
    }
  });

}

// Aplica estilo de encabezado bold + fondo gris a la primera fila de una hoja
function styleHeader(worksheet) {
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  headerRow.commit();
}

module.exports = { registerHandlers };
