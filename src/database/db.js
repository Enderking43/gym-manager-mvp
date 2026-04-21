const Database = require('better-sqlite3');
const path = require('path');

let db;

function initializeDatabase(userDataPath) {
  const dbPath = path.join(userDataPath, 'gym_database.sqlite');
  db = new Database(dbPath);

  // Optimizaciones: WAL para escrituras concurrentes, FK activadas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
  seedMemberships();

  console.log(`Base de datos lista en: ${dbPath}`);
  return db;
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS socios (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      dni           TEXT    NOT NULL UNIQUE,
      nombre        TEXT    NOT NULL,
      apellido      TEXT    NOT NULL,
      telefono      TEXT,
      fecha_alta    TEXT    NOT NULL DEFAULT (date('now')),
      estado_aviso  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS membresias (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre         TEXT    NOT NULL,
      duracion_dias  INTEGER NOT NULL,
      precio         REAL    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pagos (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      socio_id          INTEGER NOT NULL,
      membresia_id      INTEGER NOT NULL,
      fecha_pago        TEXT    NOT NULL DEFAULT (date('now')),
      fecha_vencimiento TEXT    NOT NULL,
      monto             REAL    NOT NULL,
      metodo_pago       TEXT    NOT NULL CHECK(metodo_pago IN ('Efectivo', 'Transferencia')),
      FOREIGN KEY (socio_id)     REFERENCES socios(id),
      FOREIGN KEY (membresia_id) REFERENCES membresias(id)
    );

    CREATE TABLE IF NOT EXISTS asistencias (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      socio_id      INTEGER NOT NULL,
      fecha_entrada TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (socio_id) REFERENCES socios(id)
    );
  `);
}

function seedMemberships() {
  const count = db.prepare('SELECT COUNT(*) as count FROM membresias').get();
  if (count.count > 0) return;

  const insert = db.prepare('INSERT INTO membresias (nombre, duracion_dias, precio) VALUES (?, ?, ?)');
  const seedMany = db.transaction((seeds) => {
    for (const seed of seeds) insert.run(...seed);
  });

  seedMany([
    ['Mensual',   31,  10000],
    ['Semestral', 186, 50000],
  ]);

  console.log('Membresías semilla insertadas.');
}

function getDatabase() {
  return db;
}

module.exports = { initializeDatabase, getDatabase };
