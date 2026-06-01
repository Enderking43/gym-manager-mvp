const path     = require('path');
const fs       = require('fs');
const { app }  = require('electron');

let db;
let dbFilePath;

// ── Helpers síncronos sobre la API de sql.js ──────────────────────────────

function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function dbRun(sql, params = []) {
  db.run(sql, params);
  const lastInsertRowid =
    db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? null;
  const changes = db.getRowsModified();
  return { lastInsertRowid, changes };
}

function saveDatabase() {
  const data = db.export();
  fs.writeFileSync(dbFilePath, Buffer.from(data));
}

// ── Inicialización ────────────────────────────────────────────────────────
async function initializeDatabase(userDataPath) {
  const initSqlJs = require('sql.js');

  // En producción el .wasm vive en Resources/ (extraResources de electron-builder).
  // En desarrollo está en node_modules/sql.js/dist/.
  const wasmPath = app.isPackaged
    ? path.join(process.resourcesPath, 'sql-wasm.wasm')
    : path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');

  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  dbFilePath = path.join(userDataPath, 'gym_database.sqlite');

  const fileBuffer = fs.existsSync(dbFilePath) ? fs.readFileSync(dbFilePath) : null;
  db = new SQL.Database(fileBuffer);
  db.run('PRAGMA foreign_keys = ON');

  createTables();
  runMigrations();       // agrega columnas nuevas a tablas existentes de forma segura
  seedMemberships();
  seedConfiguration();
  seedUsuarios();
  saveDatabase();

  console.log(`Base de datos lista en: ${dbFilePath}`);
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
      metodo_pago       TEXT    NOT NULL
                        CHECK(metodo_pago IN ('Efectivo','Transferencia')),
      FOREIGN KEY (socio_id)     REFERENCES socios(id),
      FOREIGN KEY (membresia_id) REFERENCES membresias(id)
    );
    CREATE TABLE IF NOT EXISTS asistencias (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      socio_id      INTEGER NOT NULL,
      fecha_entrada TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (socio_id) REFERENCES socios(id)
    );
    CREATE TABLE IF NOT EXISTS configuracion (
      id             INTEGER PRIMARY KEY CHECK (id = 1),
      nombre_gym     TEXT,
      color_primario TEXT,
      logo_base64    TEXT
    );
    CREATE TABLE IF NOT EXISTS usuarios (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre  TEXT    NOT NULL UNIQUE,
      clave   TEXT    NOT NULL,
      rol     TEXT    NOT NULL CHECK(rol IN ('admin', 'empleado'))
    );
    CREATE TABLE IF NOT EXISTS articulos (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre  TEXT    NOT NULL,
      precio  REAL    NOT NULL,
      stock   INTEGER NOT NULL DEFAULT 0,
      estado  TEXT    DEFAULT 'Activo'
    );
    CREATE TABLE IF NOT EXISTS ventas_articulos (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      articulo_id      INTEGER NOT NULL,
      cantidad         INTEGER NOT NULL,
      precio_unitario  REAL    NOT NULL,
      total            REAL    NOT NULL,
      fecha            TEXT    DEFAULT (datetime('now','localtime')),
      usuario_id       INTEGER,
      FOREIGN KEY (articulo_id) REFERENCES articulos(id),
      FOREIGN KEY (usuario_id)  REFERENCES usuarios(id)
    );
    CREATE TABLE IF NOT EXISTS egresos (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      concepto   TEXT    NOT NULL,
      monto      REAL    NOT NULL,
      fecha      TEXT    NOT NULL DEFAULT (date('now')),
      usuario_id INTEGER,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );
    CREATE TABLE IF NOT EXISTS grupos_familiares (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT    NOT NULL
    );
  `);
}

// Agrega una columna solo si no existe (migración segura con PRAGMA table_info)
function runSafeMigration(table, column, definition) {
  const cols = dbAll(`PRAGMA table_info(${table})`);
  if (!cols.some(c => c.name === column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`Migración: ${table}.${column} agregada`);
  }
}

function runMigrations() {
  // Fase 7: columnas extendidas de socios (CRM)
  runSafeMigration('socios', 'email',           'TEXT');
  runSafeMigration('socios', 'domicilio',        'TEXT');
  runSafeMigration('socios', 'fecha_nacimiento', 'TEXT');
  runSafeMigration('socios', 'genero',           'TEXT');

  // Fase 7: columnas de facturación y auditoría en pagos
  runSafeMigration('pagos', 'usuario_id',  'INTEGER');
  runSafeMigration('pagos', 'tipo_cobro',  "TEXT DEFAULT 'Membresia'");
  runSafeMigration('pagos', 'descripcion', 'TEXT');

  // Fase 10: estado en membresías (soft delete) y grupo familiar en socios
  runSafeMigration('membresias', 'estado',   "TEXT DEFAULT 'Activo'");
  runSafeMigration('socios',     'grupo_id', 'INTEGER');

  // Fase 12: QR de Mercado Pago y registro de pago de soporte mensual
  runSafeMigration('configuracion', 'qr_mercadopago_base64', "TEXT DEFAULT ''");
  runSafeMigration('configuracion', 'soporte_pagado_mes',    "TEXT DEFAULT ''");

  // Fase 13: Fecha de última validación remota de licencia (offline grace period)
  runSafeMigration('configuracion', 'licencia_ultima_validacion', "TEXT DEFAULT ''");

  // Fase 13.1: Toggle de impresión térmica opcional
  runSafeMigration('configuracion', 'impresion_habilitada', 'INTEGER DEFAULT 0');
}

function seedMemberships() {
  // INSERT OR IGNORE con IDs explícitos garantiza idempotencia
  db.run(`INSERT OR IGNORE INTO membresias (id, nombre, duracion_dias, precio) VALUES (1, 'Mensual', 31, 10000)`);
  db.run(`INSERT OR IGNORE INTO membresias (id, nombre, duracion_dias, precio) VALUES (2, 'Semestral', 186, 50000)`);
  db.run(`INSERT OR IGNORE INTO membresias (id, nombre, duracion_dias, precio) VALUES (3, 'Pase Diario', 1, 0)`);
}

function seedConfiguration() {
  db.run(`
    INSERT OR IGNORE INTO configuracion (id, nombre_gym, color_primario, logo_base64)
    VALUES (1, 'Gimnasio Local', '#EAB308', '')
  `);
}

function seedUsuarios() {
  db.run(`INSERT OR IGNORE INTO usuarios (id, nombre, clave, rol) VALUES (1, 'admin', '1234', 'admin')`);
}

function getDbFilePath() { return dbFilePath; }

module.exports = { initializeDatabase, saveDatabase, dbGet, dbAll, dbRun, getDbFilePath };
