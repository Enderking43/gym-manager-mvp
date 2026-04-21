const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app } = require('electron');

// Guardar la base de datos en la carpeta de datos del usuario para evitar problemas de permisos
const DB_PATH = path.join(app.getPath('userData'), 'gym_database.sqlite');

let db;

function initializeDatabase() {
  db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('Error al conectar con la base de datos:', err.message);
      return;
    }
    console.log(`Base de datos conectada en: ${DB_PATH}`);
  });

  // Activar foreign keys y WAL mode para mejor rendimiento
  db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON');
    db.run('PRAGMA journal_mode = WAL');
    createTables();
  });

  return db;
}

function createTables() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS socios (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        dni           TEXT    NOT NULL UNIQUE,
        nombre        TEXT    NOT NULL,
        apellido      TEXT    NOT NULL,
        telefono      TEXT,
        fecha_alta    TEXT    NOT NULL DEFAULT (date('now')),
        estado_aviso  INTEGER NOT NULL DEFAULT 0
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS membresias (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre         TEXT    NOT NULL,
        duracion_dias  INTEGER NOT NULL,
        precio         REAL    NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS pagos (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        socio_id         INTEGER NOT NULL,
        membresia_id     INTEGER NOT NULL,
        fecha_pago       TEXT    NOT NULL DEFAULT (date('now')),
        fecha_vencimiento TEXT   NOT NULL,
        monto            REAL    NOT NULL,
        metodo_pago      TEXT    NOT NULL CHECK(metodo_pago IN ('Efectivo', 'Transferencia')),
        FOREIGN KEY (socio_id)     REFERENCES socios(id),
        FOREIGN KEY (membresia_id) REFERENCES membresias(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS asistencias (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        socio_id      INTEGER NOT NULL,
        fecha_entrada TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (socio_id) REFERENCES socios(id)
      )
    `, () => {
      seedMemberships();
    });
  });
}

function seedMemberships() {
  db.get('SELECT COUNT(*) as count FROM membresias', (err, row) => {
    if (err || row.count > 0) return;

    const seeds = [
      ['Mensual',   31,  10000],
      ['Semestral', 186, 50000],
    ];

    const stmt = db.prepare('INSERT INTO membresias (nombre, duracion_dias, precio) VALUES (?, ?, ?)');
    seeds.forEach(([nombre, dias, precio]) => stmt.run(nombre, dias, precio));
    stmt.finalize();

    console.log('Membresías semilla insertadas correctamente.');
  });
}

function getDatabase() {
  return db;
}

module.exports = { initializeDatabase, getDatabase };
