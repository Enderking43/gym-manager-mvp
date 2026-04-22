const { ipcMain } = require('electron');
const { dbGet, dbAll, dbRun, saveDatabase } = require('../database/db');

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
}

module.exports = { registerHandlers };
