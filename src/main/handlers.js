const { ipcMain, dialog, app, BrowserWindow } = require('electron');
const path = require('path');
const fs   = require('fs');
const { dbGet, dbAll, dbRun, saveDatabase, getDbFilePath } = require('../database/db');

// ── Log de errores con timestamp en userData/error.log ────────────────────
function logError(channel, err) {
  const ts  = new Date().toISOString();
  const msg = `[${ts}] [${channel}] ${err.message || err}\n${err.stack ? err.stack + '\n' : ''}`;
  console.error(`[${channel}]`, err);
  try {
    const logPath = path.join(app.getPath('userData'), 'error.log');
    fs.appendFileSync(logPath, msg, 'utf8');
  } catch (_) { /* no interrumpir si no se puede escribir el log */ }
}

// ── Ticket térmico HTML (58mm/80mm) ──────────────────────────────────────
function buildTicketHtml(datos) {
  const now   = new Date();
  const fecha = now.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora  = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const monto = '$' + Number(datos.monto || 0).toLocaleString('es-AR');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page { size: 80mm auto; margin: 3mm 4mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', Courier, monospace; font-size: 11px; color: #000; width: 72mm; }
  .center { text-align: center; }
  .bold   { font-weight: bold; }
  .big    { font-size: 14px; }
  .small  { font-size: 9px; }
  .sep    { border-top: 1px dashed #555; margin: 5px 0; }
  .row    { display: flex; justify-content: space-between; margin: 2px 0; }
  .total  { font-size: 13px; font-weight: bold; }
</style>
</head>
<body>
  <p class="center bold big">BALI HERA FITNESS</p>
  <p class="center small" style="margin-bottom:4px">Sistema de Gestión Deportiva</p>
  <div class="sep"></div>
  <div class="row small"><span>Fecha:</span><span>${fecha}</span></div>
  <div class="row small"><span>Hora:</span><span>${hora}</span></div>
  <div class="sep"></div>
  <div class="row"><span>Socio:</span><span>${String(datos.socio_nombre || '—').substring(0, 22)}</span></div>
  <div class="row"><span>Tipo:</span><span>${datos.tipo_cobro || '—'}</span></div>
  <div class="row"><span>Plan:</span><span>${String(datos.membresia_nombre || '—').substring(0, 18)}</span></div>
  <div class="row"><span>Vence:</span><span>${datos.fecha_vencimiento || '—'}</span></div>
  <div class="sep"></div>
  <div class="row total"><span>TOTAL:</span><span>${monto}</span></div>
  <div class="row"><span>Método:</span><span>${datos.metodo_pago || '—'}</span></div>
  <div class="sep"></div>
  <div class="row small"><span>Cobrado por:</span><span>${datos.cobrado_por || '—'}</span></div>
  <div class="sep" style="margin-top:8px"></div>
  <p class="center small" style="margin-top:4px">¡Gracias por elegirnos!</p>
</body>
</html>`;
}

function getToday() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function registerHandlers() {

  // ── BUSCAR SOCIO POR DNI ────────────────────────────────────────────────
  ipcMain.handle('buscar-socio-por-dni', (_event, dni) => {
    try {
      const today = getToday();
      const socio = dbGet('SELECT * FROM socios WHERE dni = ?', [String(dni).trim()]);
      if (!socio) return { status: 'no_encontrado' };

      // Herencia familiar: si el socio pertenece a un grupo, buscar el vencimiento
      // máximo de CUALQUIER miembro del grupo para permitir acceso compartido.
      if (socio.grupo_id) {
        const groupMax = dbGet(`
          SELECT MAX(p.fecha_vencimiento) AS max_venc
          FROM   pagos p
          JOIN   socios s ON s.id = p.socio_id
          WHERE  s.grupo_id = ?
        `, [socio.grupo_id]);

        if (groupMax?.max_venc && groupMax.max_venc >= today) {
          if (socio.estado_aviso !== 0) {
            dbRun('UPDATE socios SET estado_aviso = 0 WHERE id = ?', [socio.id]);
            saveDatabase();
          }
          return {
            status: 'verde',
            socio:  { ...socio, estado_aviso: 0 },
            pago:   { fecha_vencimiento: groupMax.max_venc },
          };
        }
      }

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
        if (socio.estado_aviso !== 0) {
          dbRun('UPDATE socios SET estado_aviso = 0 WHERE id = ?', [socio.id]);
          saveDatabase();
        }
        return { status: 'verde', socio: { ...socio, estado_aviso: 0 }, pago: lastPago };

      } else if (socio.estado_aviso === 0) {
        dbRun('UPDATE socios SET estado_aviso = 1 WHERE id = ?', [socio.id]);
        saveDatabase();
        return { status: 'amarillo', socio: { ...socio, estado_aviso: 1 }, pago: lastPago };

      } else {
        return { status: 'rojo', socio, pago: lastPago };
      }
    } catch (err) {
      logError('buscar-socio-por-dni', err);
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
      logError('registrar-asistencia', err);
      return { success: false, error: err.message };
    }
  });

  // ── CREAR SOCIO ─────────────────────────────────────────────────────────
  ipcMain.handle('crear-socio', (_event, datos) => {
    try {
      const { dni, nombre, apellido, telefono, email, domicilio, fecha_nacimiento, genero } = datos;
      const { lastInsertRowid } = dbRun(`
        INSERT INTO socios (dni, nombre, apellido, telefono, email, domicilio, fecha_nacimiento, genero)
        VALUES (?,?,?,?,?,?,?,?)
      `, [
        String(dni).trim(),
        nombre.trim(),
        apellido.trim(),
        telefono?.trim()        || null,
        email?.trim()           || null,
        domicilio?.trim()       || null,
        fecha_nacimiento        || null,
        genero                  || null,
      ]);
      saveDatabase();
      return { success: true, id: lastInsertRowid };
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE'))
        return { success: false, error: 'El DNI ya está registrado' };
      logError('crear-socio', err);
      return { success: false, error: err.message };
    }
  });

  // ── EDITAR SOCIO ────────────────────────────────────────────────────────
  ipcMain.handle('editar-socio', (_event, datos) => {
    try {
      const { id, nombre, apellido, telefono, email, domicilio, fecha_nacimiento, genero } = datos;
      dbRun(`
        UPDATE socios
        SET nombre=?, apellido=?, telefono=?, email=?, domicilio=?, fecha_nacimiento=?, genero=?
        WHERE id=?
      `, [
        nombre.trim(),
        apellido.trim(),
        telefono?.trim()  || null,
        email?.trim()     || null,
        domicilio?.trim() || null,
        fecha_nacimiento  || null,
        genero            || null,
        id,
      ]);
      saveDatabase();
      return { success: true };
    } catch (err) {
      logError('editar-socio', err);
      return { success: false, error: err.message };
    }
  });

  // ── REGISTRAR PAGO ──────────────────────────────────────────────────────
  ipcMain.handle('registrar-pago', (_event, datos) => {
    try {
      const {
        socio_id, membresia_id, monto, metodo_pago,
        usuario_id, tipo_cobro, descripcion, duracion_dias_override,
      } = datos;

      const membresia = dbGet('SELECT * FROM membresias WHERE id = ?', [membresia_id]);
      if (!membresia) return { success: false, error: 'Membresía no encontrada' };

      const today    = getToday();
      const dias     = (duracion_dias_override && Number(duracion_dias_override) > 0)
        ? Number(duracion_dias_override)
        : membresia.duracion_dias;
      const fechaVenc = addDays(today, dias);

      dbRun('BEGIN');
      try {
        const { lastInsertRowid } = dbRun(`
          INSERT INTO pagos
            (socio_id, membresia_id, fecha_pago, fecha_vencimiento, monto, metodo_pago,
             usuario_id, tipo_cobro, descripcion)
          VALUES (?,?,?,?,?,?,?,?,?)
        `, [
          socio_id, membresia_id, today, fechaVenc, monto, metodo_pago,
          usuario_id || null,
          tipo_cobro || 'Membresia',
          descripcion || null,
        ]);

        dbRun('UPDATE socios SET estado_aviso = 0 WHERE id = ?', [socio_id]);
        dbRun('COMMIT');
        saveDatabase();

        return { success: true, id: lastInsertRowid, fecha_vencimiento: fechaVenc };
      } catch (inner) {
        dbRun('ROLLBACK');
        throw inner;
      }
    } catch (err) {
      logError('registrar-pago', err);
      return { success: false, error: err.message };
    }
  });

  // ── EDITAR PAGO ─────────────────────────────────────────────────────────
  ipcMain.handle('editar-pago', (_event, datos) => {
    try {
      const { id, monto, metodo_pago, descripcion } = datos;
      dbRun(
        'UPDATE pagos SET monto=?, metodo_pago=?, descripcion=? WHERE id=?',
        [monto, metodo_pago, descripcion || null, id]
      );
      saveDatabase();
      return { success: true };
    } catch (err) {
      logError('editar-pago', err);
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
      logError('obtener-dashboard', err);
      return { success: false, error: err.message };
    }
  });

  // ── OBTENER MOVIMIENTOS (Caja y Movimientos) ────────────────────────────
  ipcMain.handle('obtener-movimientos', () => {
    try {
      const movimientos = dbAll(`
        SELECT p.id, p.fecha_pago, p.monto, p.metodo_pago,
               COALESCE(p.tipo_cobro, 'Membresia') AS tipo_cobro,
               p.descripcion,
               CASE
                 WHEN p.descripcion IS NOT NULL AND p.descripcion != ''
                   THEN p.descripcion
                 ELSE COALESCE(m.nombre, 'Membresia')
               END AS descripcion_display,
               s.nombre || ' ' || s.apellido AS socio_nombre,
               s.dni,
               m.nombre AS membresia_nombre,
               COALESCE(u.nombre, '—') AS cobrado_por
        FROM pagos p
        JOIN socios s ON s.id = p.socio_id
        LEFT JOIN membresias m ON m.id = p.membresia_id
        LEFT JOIN usuarios u ON u.id = p.usuario_id
        ORDER BY p.id DESC
        LIMIT 200
      `);
      return { success: true, movimientos };
    } catch (err) {
      logError('obtener-movimientos', err);
      return { success: false, error: err.message };
    }
  });

  // ── BUSCAR SOCIO (ADMIN) ────────────────────────────────────────────────
  ipcMain.handle('buscar-socio-admin', (_event, dni) => {
    try {
      const socio = dbGet(`
        SELECT s.*, g.nombre AS grupo_nombre
        FROM   socios s
        LEFT JOIN grupos_familiares g ON g.id = s.grupo_id
        WHERE  s.dni = ?
      `, [String(dni).trim()]);
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
      logError('buscar-socio-admin', err);
      return { success: false, error: err.message };
    }
  });

  // ── OBTENER MEMBRESÍAS ──────────────────────────────────────────────────
  ipcMain.handle('obtener-membresias', () => {
    try {
      const membresias = dbAll(`
        SELECT * FROM membresias
        WHERE  id != 3 AND (estado IS NULL OR estado = 'Activo')
        ORDER  BY duracion_dias ASC
      `);
      return { success: true, membresias };
    } catch (err) {
      logError('obtener-membresias', err);
      return { success: false, error: err.message };
    }
  });

  // ── ABM MEMBRESÍAS ───────────────────────────────────────────────────────
  ipcMain.handle('crear-membresia', (_event, datos) => {
    try {
      const { nombre, duracion_dias, precio } = datos;
      if (!nombre?.trim()) return { success: false, error: 'El nombre es obligatorio' };
      if (!duracion_dias || Number(duracion_dias) <= 0)
        return { success: false, error: 'La duración debe ser mayor a 0 días' };
      if (precio == null || Number(precio) < 0)
        return { success: false, error: 'Precio inválido' };
      const { lastInsertRowid } = dbRun(
        "INSERT INTO membresias (nombre, duracion_dias, precio, estado) VALUES (?,?,?,'Activo')",
        [nombre.trim(), Number(duracion_dias), Number(precio)]
      );
      saveDatabase();
      return { success: true, id: lastInsertRowid };
    } catch (err) {
      logError('crear-membresia', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('actualizar-membresia', (_event, datos) => {
    try {
      const { id, nombre, duracion_dias, precio } = datos;
      if (!nombre?.trim()) return { success: false, error: 'El nombre es obligatorio' };
      if (!duracion_dias || Number(duracion_dias) <= 0)
        return { success: false, error: 'La duración debe ser mayor a 0 días' };
      if (precio == null || Number(precio) < 0)
        return { success: false, error: 'Precio inválido' };
      dbRun(
        'UPDATE membresias SET nombre=?, duracion_dias=?, precio=? WHERE id=?',
        [nombre.trim(), Number(duracion_dias), Number(precio), id]
      );
      saveDatabase();
      return { success: true };
    } catch (err) {
      logError('actualizar-membresia', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('eliminar-membresia', (_event, id) => {
    try {
      dbRun("UPDATE membresias SET estado='Inactivo' WHERE id=?", [id]);
      saveDatabase();
      return { success: true };
    } catch (err) {
      logError('eliminar-membresia', err);
      return { success: false, error: err.message };
    }
  });

  // ── ABM GRUPOS FAMILIARES ────────────────────────────────────────────────
  ipcMain.handle('crear-grupo', (_event, datos) => {
    try {
      const { nombre } = datos;
      if (!nombre?.trim()) return { success: false, error: 'El nombre del grupo es obligatorio' };
      const { lastInsertRowid } = dbRun(
        'INSERT INTO grupos_familiares (nombre) VALUES (?)',
        [nombre.trim()]
      );
      saveDatabase();
      return { success: true, id: lastInsertRowid };
    } catch (err) {
      logError('crear-grupo', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('obtener-grupos', () => {
    try {
      const grupos = dbAll(
        'SELECT id, nombre FROM grupos_familiares ORDER BY nombre ASC'
      );
      return {
        success: true,
        grupos: grupos.map(g => ({
          ...g,
          miembros: dbAll(
            'SELECT id, nombre, apellido, dni FROM socios WHERE grupo_id = ?',
            [g.id]
          ),
        })),
      };
    } catch (err) {
      logError('obtener-grupos', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('actualizar-grupo-socio', (_event, datos) => {
    try {
      const { socio_id, grupo_id } = datos;
      dbRun('UPDATE socios SET grupo_id=? WHERE id=?', [grupo_id || null, socio_id]);
      saveDatabase();
      return { success: true };
    } catch (err) {
      logError('actualizar-grupo-socio', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('eliminar-grupo', (_event, id) => {
    try {
      dbRun('BEGIN');
      try {
        dbRun('UPDATE socios SET grupo_id = NULL WHERE grupo_id = ?', [id]);
        dbRun('DELETE FROM grupos_familiares WHERE id = ?', [id]);
        dbRun('COMMIT');
        saveDatabase();
        return { success: true };
      } catch (inner) {
        dbRun('ROLLBACK');
        throw inner;
      }
    } catch (err) {
      logError('eliminar-grupo', err);
      return { success: false, error: err.message };
    }
  });

  // ── VALIDAR LOGIN ───────────────────────────────────────────────────────
  ipcMain.handle('validar-login', (_event, datos) => {
    try {
      const { nombre, clave } = datos;
      const user = dbGet(
        'SELECT id, nombre, rol FROM usuarios WHERE nombre = ? AND clave = ?',
        [nombre?.trim(), clave]
      );
      if (!user) return { success: false, error: 'Usuario o clave incorrectos' };
      return { success: true, usuario: user };
    } catch (err) {
      logError('validar-login', err);
      return { success: false, error: err.message };
    }
  });

  // ── OBTENER USUARIOS ────────────────────────────────────────────────────
  ipcMain.handle('obtener-usuarios', () => {
    try {
      const usuarios = dbAll('SELECT id, nombre, rol FROM usuarios ORDER BY id ASC');
      return { success: true, usuarios };
    } catch (err) {
      logError('obtener-usuarios', err);
      return { success: false, error: err.message };
    }
  });

  // ── CREAR USUARIO ───────────────────────────────────────────────────────
  ipcMain.handle('crear-usuario', (_event, datos) => {
    try {
      const { nombre, clave } = datos;
      if (!nombre?.trim() || !clave) return { success: false, error: 'Nombre y clave son obligatorios' };
      dbRun(
        `INSERT INTO usuarios (nombre, clave, rol) VALUES (?, ?, 'empleado')`,
        [nombre.trim(), clave]
      );
      saveDatabase();
      return { success: true };
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE'))
        return { success: false, error: 'Ya existe un usuario con ese nombre' };
      logError('crear-usuario', err);
      return { success: false, error: err.message };
    }
  });

  // ── ELIMINAR USUARIO ────────────────────────────────────────────────────
  ipcMain.handle('eliminar-usuario', (_event, id) => {
    try {
      const user = dbGet('SELECT * FROM usuarios WHERE id = ?', [id]);
      if (!user) return { success: false, error: 'Usuario no encontrado' };
      if (user.rol === 'admin')
        return { success: false, error: 'No se puede eliminar una cuenta de administrador' };
      dbRun('DELETE FROM usuarios WHERE id = ?', [id]);
      saveDatabase();
      return { success: true };
    } catch (err) {
      logError('eliminar-usuario', err);
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
        { header: 'Socio',        key: 'socio',       width: 24 },
        { header: 'DNI',          key: 'dni',         width: 12 },
        { header: 'Membresía',    key: 'membresia',   width: 16 },
        { header: 'Monto ($)',    key: 'monto',       width: 14 },
        { header: 'Método',       key: 'metodo',      width: 16 },
        { header: 'Vencimiento',  key: 'venc',        width: 16 },
        { header: 'Cobrado por',  key: 'cobrado_por', width: 16 },
        { header: 'Tipo',         key: 'tipo',        width: 14 },
        { header: 'Descripción',  key: 'descripcion', width: 24 },
      ];
      styleHeader(wsCaja);

      const pagosHoy = dbAll(`
        SELECT s.nombre || ' ' || s.apellido AS socio,
               s.dni,
               COALESCE(m.nombre, 'Pase') AS membresia,
               p.monto, p.metodo_pago, p.fecha_vencimiento,
               COALESCE(u.nombre, '—') AS cobrado_por,
               COALESCE(p.tipo_cobro, 'Membresia') AS tipo_cobro,
               COALESCE(p.descripcion, '') AS descripcion
        FROM   pagos p
        JOIN   socios     s ON s.id = p.socio_id
        LEFT JOIN membresias m ON m.id = p.membresia_id
        LEFT JOIN usuarios   u ON u.id = p.usuario_id
        WHERE  p.fecha_pago = ?
        ORDER  BY p.id DESC
      `, [today]);

      pagosHoy.forEach(r => wsCaja.addRow({
        socio: r.socio, dni: r.dni, membresia: r.membresia,
        monto: r.monto, metodo: r.metodo_pago, venc: r.fecha_vencimiento,
        cobrado_por: r.cobrado_por, tipo: r.tipo_cobro, descripcion: r.descripcion,
      }));

      const totalRow = wsCaja.addRow({
        socio: 'TOTAL',
        monto: pagosHoy.reduce((s, r) => s + r.monto, 0),
      });
      totalRow.font = { bold: true };

      // ── Pestaña 2: Asistencias de Hoy ──────────────────────────────────
      const wsAsist = wb.addWorksheet('Asistencias de Hoy');
      wsAsist.columns = [
        { header: 'Socio',        key: 'socio', width: 24 },
        { header: 'DNI',          key: 'dni',   width: 12 },
        { header: 'Hora Entrada', key: 'hora',  width: 20 },
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
        { header: 'Nombre',       key: 'nombre',   width: 18 },
        { header: 'Apellido',     key: 'apellido', width: 18 },
        { header: 'DNI',          key: 'dni',      width: 12 },
        { header: 'Teléfono',     key: 'telefono', width: 16 },
        { header: 'Último Venc.', key: 'venc',     width: 16 },
        { header: 'Días Vencido', key: 'dias',     width: 14 },
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

      // ── Pestaña 4: Ventas Buffet de Hoy ────────────────────────────────
      const wsBuffet = wb.addWorksheet('Ventas Buffet de Hoy');
      wsBuffet.columns = [
        { header: 'Artículo',       key: 'articulo',  width: 22 },
        { header: 'Cantidad',       key: 'cantidad',  width: 12 },
        { header: 'Precio Unit.',   key: 'precio',    width: 16 },
        { header: 'Total ($)',      key: 'total',     width: 14 },
        { header: 'Cobrado por',    key: 'empleado',  width: 16 },
        { header: 'Hora',           key: 'hora',      width: 20 },
      ];
      styleHeader(wsBuffet);

      const ventasHoy = dbAll(`
        SELECT a.nombre AS articulo, v.cantidad, v.precio_unitario,
               v.total, v.fecha, COALESCE(u.nombre, '—') AS empleado
        FROM ventas_articulos v
        JOIN articulos a ON a.id = v.articulo_id
        LEFT JOIN usuarios u ON u.id = v.usuario_id
        WHERE date(v.fecha) = ?
        ORDER BY v.id ASC
      `, [today]);

      ventasHoy.forEach(r => wsBuffet.addRow({
        articulo: r.articulo, cantidad: r.cantidad,
        precio: r.precio_unitario, total: r.total,
        empleado: r.empleado, hora: r.fecha,
      }));

      const totalVentasRow = wsBuffet.addRow({
        articulo: 'TOTAL', total: ventasHoy.reduce((s, r) => s + r.total, 0),
      });
      totalVentasRow.font = { bold: true };

      // ── Pestaña 5: Gastos de Hoy ────────────────────────────────────────
      const wsGastos = wb.addWorksheet('Gastos de Hoy');
      wsGastos.columns = [
        { header: 'Concepto',    key: 'concepto', width: 28 },
        { header: 'Monto ($)',   key: 'monto',    width: 14 },
        { header: 'Registró',   key: 'empleado', width: 16 },
      ];
      styleHeader(wsGastos);

      const gastosHoy = dbAll(`
        SELECT e.concepto, e.monto, COALESCE(u.nombre, '—') AS empleado
        FROM egresos e
        LEFT JOIN usuarios u ON u.id = e.usuario_id
        WHERE e.fecha = ?
        ORDER BY e.id ASC
      `, [today]);

      gastosHoy.forEach(r => wsGastos.addRow({
        concepto: r.concepto, monto: r.monto, empleado: r.empleado,
      }));

      if (gastosHoy.length > 0) {
        const totalGastosRow = wsGastos.addRow({
          concepto: 'TOTAL', monto: gastosHoy.reduce((s, r) => s + r.monto, 0),
        });
        totalGastosRow.font = { bold: true };
      }

      await wb.xlsx.writeFile(filePath);
      return { success: true, filePath };

    } catch (err) {
      logError('generar-reporte-excel', err);
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

      const today    = getToday();
      const destFile = path.join(filePaths[0], `backup_gimnasio_${today}.sqlite`);
      saveDatabase();
      fs.copyFileSync(getDbFilePath(), destFile);
      return { success: true, destFile };
    } catch (err) {
      logError('crear-backup', err);
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
      app.relaunch();
      app.exit(0);
      return { success: true };
    } catch (err) {
      logError('restaurar-base-datos', err);
      return { success: false, error: err.message };
    }
  });

  // ── OBTENER CONFIGURACIÓN ────────────────────────────────────────────────
  ipcMain.handle('obtener-configuracion', () => {
    try {
      const config = dbGet('SELECT * FROM configuracion WHERE id = 1');
      return { success: true, config };
    } catch (err) {
      logError('obtener-configuracion', err);
      return { success: false, error: err.message };
    }
  });

  // ── GUARDAR CONFIGURACIÓN ────────────────────────────────────────────────
  ipcMain.handle('guardar-configuracion', (_event, datos) => {
    try {
      const { nombre_gym, color_primario, logo_base64, qr_mercadopago_base64, impresion_habilitada } = datos;
      dbRun(
        'UPDATE configuracion SET nombre_gym = ?, color_primario = ?, logo_base64 = ?, qr_mercadopago_base64 = ?, impresion_habilitada = ? WHERE id = 1',
        [nombre_gym ?? 'Gimnasio Local', color_primario ?? '#EAB308', logo_base64 ?? '', qr_mercadopago_base64 ?? '', impresion_habilitada ? 1 : 0]
      );
      saveDatabase();
      return { success: true };
    } catch (err) {
      logError('guardar-configuracion', err);
      return { success: false, error: err.message };
    }
  });

  // ── ESTADO DE SOPORTE (cálculo de liquidación mensual) ───────────────────
  ipcMain.handle('obtener-estado-soporte', () => {
    try {
      const today = getToday();
      const activosRow = dbGet(`
        SELECT COUNT(*) as count FROM (
          SELECT s.id FROM socios s
          INNER JOIN pagos p ON p.socio_id = s.id
          GROUP BY s.id
          HAVING MAX(p.fecha_vencimiento) >= ?
        )
      `, [today]);
      const sociosActivos = activosRow ? activosRow.count : 0;
      const montoBase = 50000;
      const porSocio  = 1000;
      const config = dbGet('SELECT soporte_pagado_mes FROM configuracion WHERE id = 1');
      return {
        success:        true,
        socios_activos: sociosActivos,
        monto_base:     montoBase,
        por_socio:      porSocio,
        monto_total:    montoBase + (sociosActivos * porSocio),
        pagado_mes:     config?.soporte_pagado_mes || '',
      };
    } catch (err) {
      logError('obtener-estado-soporte', err);
      return { success: false, error: err.message };
    }
  });

  // ── INFORMAR PAGO DE SOPORTE ─────────────────────────────────────────────
  ipcMain.handle('informar-pago-soporte', () => {
    try {
      const mesActual = getToday().substring(0, 7); // YYYY-MM
      dbRun('UPDATE configuracion SET soporte_pagado_mes = ? WHERE id = 1', [mesActual]);
      saveDatabase();
      return { success: true };
    } catch (err) {
      logError('informar-pago-soporte', err);
      return { success: false, error: err.message };
    }
  });

  // ── GUARDAR FECHA DE VALIDACIÓN DE LICENCIA ──────────────────────────────
  ipcMain.handle('guardar-validacion-licencia', (_event, datos) => {
    try {
      const { fecha } = datos;
      dbRun(
        'UPDATE configuracion SET licencia_ultima_validacion = ? WHERE id = 1',
        [fecha || '']
      );
      saveDatabase();
      return { success: true };
    } catch (err) {
      logError('guardar-validacion-licencia', err);
      return { success: false, error: err.message };
    }
  });

  // ── IMPRIMIR TICKET TÉRMICO ──────────────────────────────────────────────
  ipcMain.handle('imprimir-ticket', async (_event, datos) => {
    const tmpPath = path.join(app.getPath('temp'), 'gym_ticket.html');
    let   win     = null;
    try {
      fs.writeFileSync(tmpPath, buildTicketHtml(datos), 'utf8');

      win = new BrowserWindow({
        show: false,
        width: 400,
        height: 600,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });

      await win.loadFile(tmpPath);

      const result = await new Promise((resolve) => {
        win.webContents.print(
          { silent: false, printBackground: true },
          (success, failureReason) => resolve({ success, failureReason })
        );
      });

      return result;
    } catch (err) {
      logError('imprimir-ticket', err);
      return { success: false, error: err.message };
    } finally {
      try { win?.close(); }    catch (_) {}
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  });

  // ── ESTADÍSTICAS PARA DASHBOARD BI ──────────────────────────────────────
  ipcMain.handle('obtener-estadisticas-dashboard', () => {
    try {
      const today = getToday();
      const year  = today.substring(0, 4);
      const month = today.substring(0, 7);

      const totalSocios = dbGet('SELECT COUNT(*) as count FROM socios');

      const activosRow = dbGet(`
        SELECT COUNT(*) as count FROM (
          SELECT s.id FROM socios s
          INNER JOIN pagos p ON p.socio_id = s.id
          GROUP BY s.id
          HAVING MAX(p.fecha_vencimiento) >= ?
        )
      `, [today]);

      const deudoresRow = dbGet(`
        SELECT COUNT(*) as count FROM (
          SELECT s.id, MAX(p.fecha_vencimiento) as ultimo_venc
          FROM socios s
          LEFT JOIN pagos p ON p.socio_id = s.id
          GROUP BY s.id
          HAVING ultimo_venc < ? OR ultimo_venc IS NULL
        )
      `, [today]);

      const cajaCuotas = dbGet(`
        SELECT COALESCE(SUM(monto), 0) AS total, COUNT(*) AS cantidad
        FROM pagos WHERE fecha_pago = ?
      `, [today]);

      const cajaBuffet = dbGet(`
        SELECT COALESCE(SUM(total), 0) AS total
        FROM ventas_articulos WHERE date(fecha) = ?
      `, [today]);

      const egresosDia = dbGet(`
        SELECT COALESCE(SUM(monto), 0) AS total
        FROM egresos WHERE fecha = ?
      `, [today]);

      const mensualRows = dbAll(`
        SELECT strftime('%m', fecha_pago) as mes, COALESCE(SUM(monto), 0) as total
        FROM pagos
        WHERE substr(fecha_pago, 1, 4) = ?
        GROUP BY mes
      `, [year]);

      const ingresosMensuales = Array(12).fill(0);
      mensualRows.forEach(r => {
        ingresosMensuales[parseInt(r.mes, 10) - 1] = r.total;
      });

      const productosMasVendidos = dbAll(`
        SELECT a.nombre, SUM(v.cantidad) AS total_cantidad, SUM(v.total) AS total_monto
        FROM ventas_articulos v
        JOIN articulos a ON a.id = v.articulo_id
        WHERE strftime('%Y-%m', v.fecha) = ?
        GROUP BY v.articulo_id
        ORDER BY total_cantidad DESC
        LIMIT 5
      `, [month]);

      const cuotas  = cajaCuotas.total;
      const buffet  = cajaBuffet.total;
      const egresos = egresosDia.total;

      return {
        success: true,
        total_socios:             totalSocios.count,
        membresias_activas:       activosRow.count,
        deudores_activos:         deudoresRow.count,
        caja_diaria_total:        cuotas,
        caja_diaria_cantidad:     cajaCuotas.cantidad,
        caja_cuotas_diaria:       cuotas,
        caja_buffet_diaria:       buffet,
        egresos_diarios:          egresos,
        rentabilidad_neta_diaria: (cuotas + buffet) - egresos,
        ingresos_mensuales:       ingresosMensuales,
        productos_mas_vendidos:   productosMasVendidos,
      };
    } catch (err) {
      logError('obtener-estadisticas-dashboard', err);
      return { success: false, error: err.message };
    }
  });

  // ── INVENTARIO: ARTÍCULOS (ABM) ──────────────────────────────────────────
  ipcMain.handle('obtener-articulos', () => {
    try {
      const articulos = dbAll(
        "SELECT * FROM articulos WHERE estado = 'Activo' ORDER BY nombre ASC"
      );
      return { success: true, articulos };
    } catch (err) {
      logError('obtener-articulos', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('crear-articulo', (_event, datos) => {
    try {
      const { nombre, precio, stock } = datos;
      if (!nombre?.trim()) return { success: false, error: 'El nombre es obligatorio' };
      if (precio == null || Number(precio) < 0) return { success: false, error: 'Precio inválido' };
      const { lastInsertRowid } = dbRun(
        'INSERT INTO articulos (nombre, precio, stock) VALUES (?,?,?)',
        [nombre.trim(), Number(precio), Number(stock) || 0]
      );
      saveDatabase();
      return { success: true, id: lastInsertRowid };
    } catch (err) {
      logError('crear-articulo', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('actualizar-articulo', (_event, datos) => {
    try {
      const { id, nombre, precio, stock_adicional } = datos;
      if (!nombre?.trim()) return { success: false, error: 'El nombre es obligatorio' };
      if (precio == null || Number(precio) < 0) return { success: false, error: 'Precio inválido' };
      if (stock_adicional != null && Number(stock_adicional) > 0) {
        dbRun(
          'UPDATE articulos SET nombre=?, precio=?, stock=stock+? WHERE id=?',
          [nombre.trim(), Number(precio), Number(stock_adicional), id]
        );
      } else {
        dbRun(
          'UPDATE articulos SET nombre=?, precio=? WHERE id=?',
          [nombre.trim(), Number(precio), id]
        );
      }
      saveDatabase();
      return { success: true };
    } catch (err) {
      logError('actualizar-articulo', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('eliminar-articulo', (_event, id) => {
    try {
      dbRun("UPDATE articulos SET estado='Inactivo' WHERE id=?", [id]);
      saveDatabase();
      return { success: true };
    } catch (err) {
      logError('eliminar-articulo', err);
      return { success: false, error: err.message };
    }
  });

  // ── PUNTO DE VENTA: REGISTRAR VENTA (con transacción) ───────────────────
  ipcMain.handle('registrar-venta-articulo', (_event, datos) => {
    try {
      const { articulo_id, cantidad, usuario_id } = datos;
      const cant = Number(cantidad);
      if (!articulo_id || !cant || cant <= 0)
        return { success: false, error: 'Datos de venta inválidos' };

      dbRun('BEGIN');
      try {
        const art = dbGet(
          "SELECT * FROM articulos WHERE id=? AND estado='Activo'", [articulo_id]
        );
        if (!art) {
          dbRun('ROLLBACK');
          return { success: false, error: 'Artículo no encontrado' };
        }
        if (art.stock < cant) {
          dbRun('ROLLBACK');
          return { success: false, error: `Stock insuficiente (disponible: ${art.stock})` };
        }
        const total = art.precio * cant;
        dbRun(
          'INSERT INTO ventas_articulos (articulo_id, cantidad, precio_unitario, total, usuario_id) VALUES (?,?,?,?,?)',
          [articulo_id, cant, art.precio, total, usuario_id || null]
        );
        dbRun('UPDATE articulos SET stock=stock-? WHERE id=?', [cant, articulo_id]);
        dbRun('COMMIT');
        saveDatabase();
        return { success: true, total, precio_unitario: art.precio };
      } catch (inner) {
        dbRun('ROLLBACK');
        throw inner;
      }
    } catch (err) {
      logError('registrar-venta-articulo', err);
      return { success: false, error: err.message };
    }
  });

  // ── GASTOS / EGRESOS ─────────────────────────────────────────────────────
  ipcMain.handle('registrar-egreso', (_event, datos) => {
    try {
      const { concepto, monto, usuario_id } = datos;
      if (!concepto?.trim()) return { success: false, error: 'El concepto es obligatorio' };
      if (!monto || Number(monto) <= 0) return { success: false, error: 'El monto debe ser mayor a $0' };
      dbRun(
        'INSERT INTO egresos (concepto, monto, fecha, usuario_id) VALUES (?,?,?,?)',
        [concepto.trim(), Number(monto), getToday(), usuario_id || null]
      );
      saveDatabase();
      return { success: true };
    } catch (err) {
      logError('registrar-egreso', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('obtener-egresos-hoy', () => {
    try {
      const egresos = dbAll(`
        SELECT e.id, e.concepto, e.monto, e.fecha,
               COALESCE(u.nombre, '—') AS usuario_nombre
        FROM egresos e
        LEFT JOIN usuarios u ON u.id = e.usuario_id
        WHERE e.fecha = ?
        ORDER BY e.id DESC
      `, [getToday()]);
      return { success: true, egresos };
    } catch (err) {
      logError('obtener-egresos-hoy', err);
      return { success: false, error: err.message };
    }
  });

  // ── SIMULACIÓN DE DATOS MASIVOS (stress test) ────────────────────────────
  ipcMain.handle('simular-datos-masivos', () => {
    try {
      const today    = getToday();
      const membresia = dbGet("SELECT id FROM membresias WHERE nombre = 'Mensual' LIMIT 1");
      if (!membresia) return { success: false, error: 'No existe la membresía Mensual' };
      const membId = membresia.id;

      let insertados = 0;
      let omitidos   = 0;

      dbRun('BEGIN');
      try {
        // ── 100 socios: 50 activos + 50 deudores ───────────────────────────
        for (let i = 1; i <= 100; i++) {
          const dni   = `9${String(i).padStart(7, '0')}`; // 90000001..90000100
          const exist = dbGet('SELECT id FROM socios WHERE dni = ?', [dni]);
          if (exist) { omitidos++; continue; }

          const nombre = i <= 50 ? `Activo${i}` : `Deudor${i - 50}`;
          const { lastInsertRowid: socioId } = dbRun(
            'INSERT INTO socios (dni, nombre, apellido) VALUES (?,?,?)',
            [dni, nombre, 'Simulado']
          );

          // Activos: pagaron hace 5 días, vencen en 26 días
          // Deudores: pagaron hace 60 días, vencieron hace 29 días
          const diasAtras = i <= 50 ? -5 : -60;
          const fechaPago = addDays(today, diasAtras);
          const fechaVenc = addDays(fechaPago, 31);

          dbRun(
            `INSERT INTO pagos
               (socio_id, membresia_id, fecha_pago, fecha_vencimiento, monto, metodo_pago)
             VALUES (?,?,?,?,?,?)`,
            [socioId, membId, fechaPago, fechaVenc, 15000, 'Efectivo']
          );

          insertados++;
        }

        // ── 200 ventas de buffet ────────────────────────────────────────────
        let articuloId  = null;
        let precioArt   = 500;
        const artExist  = dbGet("SELECT id, precio FROM articulos WHERE estado = 'Activo' LIMIT 1");

        if (artExist) {
          articuloId = artExist.id;
          precioArt  = artExist.precio || 500;
          // Agregar stock suficiente para las ventas simuladas
          dbRun('UPDATE articulos SET stock = stock + 600 WHERE id = ?', [articuloId]);
        } else {
          const { lastInsertRowid } = dbRun(
            "INSERT INTO articulos (nombre, precio, stock) VALUES ('Bebida (Simulación)', 500, 600)"
          );
          articuloId = lastInsertRowid;
        }

        for (let i = 0; i < 200; i++) {
          const cant  = (i % 3) + 1; // ciclo 1, 2, 3 unidades
          const total = precioArt * cant;
          dbRun(
            `INSERT INTO ventas_articulos (articulo_id, cantidad, precio_unitario, total)
             VALUES (?,?,?,?)`,
            [articuloId, cant, precioArt, total]
          );
          dbRun('UPDATE articulos SET stock = stock - ? WHERE id = ?', [cant, articuloId]);
        }

        dbRun('COMMIT');
        saveDatabase();

        return {
          success:           true,
          socios_insertados: insertados,
          socios_omitidos:   omitidos,
          ventas_insertadas: 200,
        };
      } catch (inner) {
        dbRun('ROLLBACK');
        throw inner;
      }
    } catch (err) {
      logError('simular-datos-masivos', err);
      return { success: false, error: err.message };
    }
  });

}

function styleHeader(worksheet) {
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  headerRow.commit();
}

module.exports = { registerHandlers };
