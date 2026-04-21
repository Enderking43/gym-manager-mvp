const { ipcMain } = require('electron');
const { getDatabase } = require('../database/db');

// Devuelve la fecha local de hoy como YYYY-MM-DD (evita desfases UTC en Windows)
function getToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Suma N días a una fecha YYYY-MM-DD y devuelve el resultado en el mismo formato
function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T12:00:00`); // mediodía para evitar problemas con DST
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

function registerHandlers() {
  const db = getDatabase();

  // ─── BUSCAR SOCIO POR DNI ────────────────────────────────────────────────
  // Aplica la máquina de estados: verde / amarillo / rojo.
  ipcMain.handle('buscar-socio-por-dni', (_event, dni) => {
    try {
      const today = getToday();

      const socio = db.prepare('SELECT * FROM socios WHERE dni = ?').get(String(dni).trim());
      if (!socio) return { status: 'no_encontrado' };

      const lastPago = db.prepare(`
        SELECT p.*, m.nombre AS membresia_nombre
        FROM pagos p
        JOIN membresias m ON m.id = p.membresia_id
        WHERE p.socio_id = ?
        ORDER BY p.fecha_vencimiento DESC
        LIMIT 1
      `).get(socio.id);

      // Sin ningún pago registrado → rojo directo
      if (!lastPago) {
        return { status: 'rojo', socio, mensaje: 'Sin membresía registrada' };
      }

      if (lastPago.fecha_vencimiento >= today) {
        // ── VERDE: membresía vigente ─────────────────────────────────────
        db.prepare('UPDATE socios SET estado_aviso = 0 WHERE id = ?').run(socio.id);
        return {
          status: 'verde',
          socio: { ...socio, estado_aviso: 0 },
          pago: lastPago,
        };
      } else if (socio.estado_aviso === 0) {
        // ── AMARILLO: primer vencimiento, se le da paso con aviso ────────
        db.prepare('UPDATE socios SET estado_aviso = 1 WHERE id = ?').run(socio.id);
        return {
          status: 'amarillo',
          socio: { ...socio, estado_aviso: 1 },
          pago: lastPago,
        };
      } else {
        // ── ROJO: ya fue avisado, acceso bloqueado ────────────────────────
        return { status: 'rojo', socio, pago: lastPago };
      }
    } catch (err) {
      console.error('[buscar-socio-por-dni]', err);
      return { status: 'error', mensaje: err.message };
    }
  });

  // ─── REGISTRAR ASISTENCIA ────────────────────────────────────────────────
  // Solo se llama si el resultado fue verde o amarillo.
  ipcMain.handle('registrar-asistencia', (_event, socio_id) => {
    try {
      const result = db.prepare(
        'INSERT INTO asistencias (socio_id) VALUES (?)'
      ).run(socio_id);
      return { success: true, id: result.lastInsertRowid };
    } catch (err) {
      console.error('[registrar-asistencia]', err);
      return { success: false, error: err.message };
    }
  });

  // ─── CREAR SOCIO ─────────────────────────────────────────────────────────
  ipcMain.handle('crear-socio', (_event, datos) => {
    try {
      const { dni, nombre, apellido, telefono } = datos;
      const result = db.prepare(`
        INSERT INTO socios (dni, nombre, apellido, telefono)
        VALUES (?, ?, ?, ?)
      `).run(
        String(dni).trim(),
        nombre.trim(),
        apellido.trim(),
        telefono ? String(telefono).trim() : null
      );
      return { success: true, id: result.lastInsertRowid };
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        return { success: false, error: 'El DNI ya está registrado' };
      }
      console.error('[crear-socio]', err);
      return { success: false, error: err.message };
    }
  });

  // ─── REGISTRAR PAGO ──────────────────────────────────────────────────────
  // Calcula fecha_vencimiento sumando duracion_dias de la membresía elegida.
  ipcMain.handle('registrar-pago', (_event, datos) => {
    try {
      const { socio_id, membresia_id, monto, metodo_pago } = datos;

      const membresia = db.prepare('SELECT * FROM membresias WHERE id = ?').get(membresia_id);
      if (!membresia) return { success: false, error: 'Membresía no encontrada' };

      const today = getToday();
      const fechaVencimiento = addDays(today, membresia.duracion_dias);

      const pagarYResetear = db.transaction(() => {
        const result = db.prepare(`
          INSERT INTO pagos (socio_id, membresia_id, fecha_pago, fecha_vencimiento, monto, metodo_pago)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(socio_id, membresia_id, today, fechaVencimiento, monto, metodo_pago);

        // Al registrar un pago, el socio recupera el estado limpio
        db.prepare('UPDATE socios SET estado_aviso = 0 WHERE id = ?').run(socio_id);

        return result.lastInsertRowid;
      });

      const pagoId = pagarYResetear();
      return { success: true, id: pagoId, fecha_vencimiento: fechaVencimiento };
    } catch (err) {
      console.error('[registrar-pago]', err);
      return { success: false, error: err.message };
    }
  });

  // ─── OBTENER DASHBOARD ───────────────────────────────────────────────────
  // Retorna la caja del día y la lista de deudores.
  ipcMain.handle('obtener-dashboard', () => {
    try {
      const today = getToday();

      const cajaDia = db.prepare(`
        SELECT
          COALESCE(SUM(monto), 0) AS total,
          COUNT(*)                AS cantidad_pagos
        FROM pagos
        WHERE fecha_pago = ?
      `).get(today);

      const deudores = db.prepare(`
        SELECT
          s.id,
          s.dni,
          s.nombre,
          s.apellido,
          s.telefono,
          MAX(p.fecha_vencimiento) AS ultimo_vencimiento
        FROM socios s
        LEFT JOIN pagos p ON p.socio_id = s.id
        GROUP BY s.id
        HAVING ultimo_vencimiento < ? OR ultimo_vencimiento IS NULL
        ORDER BY ultimo_vencimiento ASC
      `).all(today);

      return { success: true, cajaDia, deudores };
    } catch (err) {
      console.error('[obtener-dashboard]', err);
      return { success: false, error: err.message };
    }
  });

  // ─── OBTENER MEMBRESÍAS ──────────────────────────────────────────────────
  // Listado para poblar los selects del admin.
  ipcMain.handle('obtener-membresias', () => {
    try {
      const membresias = db.prepare('SELECT * FROM membresias ORDER BY duracion_dias ASC').all();
      return { success: true, membresias };
    } catch (err) {
      console.error('[obtener-membresias]', err);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerHandlers };
