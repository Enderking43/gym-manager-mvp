const path = require('path');
const fs   = require('fs');

let db;          // instancia sql.js Database
let dbFilePath;  // ruta al archivo .sqlite en disco

// ── Helpers síncronos sobre la API de sql.js ──────────────────────────────

// SELECT → una fila (o null)
function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

// SELECT → array de filas
function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// INSERT / UPDATE / DELETE → { lastInsertRowid, changes }
function dbRun(sql, params = []) {
  db.run(sql, params);
  const lastInsertRowid =
    db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? null;
  const changes = db.getRowsModified();
  return { lastInsertRowid, changes };
}

// Serializa la DB en memoria al archivo en disco (llamar tras cada escritura)
function saveDatabase() {
  const data = db.export();           // Uint8Array
  fs.writeFileSync(dbFilePath, Buffer.from(data));
}

// ── Inicialización (async solo por la carga del WASM) ─────────────────────
async function initializeDatabase(userDataPath) {
  const initSqlJs = require('sql.js');

  // Localiza el .wasm dentro de node_modules para que Electron lo encuentre
  const wasmPath = path.join(
    __dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'
  );
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
  });

  dbFilePath = path.join(userDataPath, 'gym_database.sqlite');

  // Si ya existe un archivo, lo carga; si no, crea una DB nueva vacía
  const fileBuffer = fs.existsSync(dbFilePath)
    ? fs.readFileSync(dbFilePath)
    : null;

  db = new SQL.Database(fileBuffer);
  db.run('PRAGMA foreign_keys = ON');

  createTables();
  seedMemberships();
  saveDatabase(); // primer guardado (crea el archivo si es nuevo)

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
  `);
}

function seedMemberships() {
  const row = dbGet('SELECT COUNT(*) as count FROM membresias');
  if (row && row.count > 0) return;

  db.run('INSERT INTO membresias (nombre, duracion_dias, precio) VALUES (?,?,?)',
    ['Mensual', 31, 10000]);
  db.run('INSERT INTO membresias (nombre, duracion_dias, precio) VALUES (?,?,?)',
    ['Semestral', 186, 50000]);

  console.log('Membresías semilla insertadas.');
}

function getDbFilePath() { return dbFilePath; }

module.exports = { initializeDatabase, saveDatabase, dbGet, dbAll, dbRun, getDbFilePath };
