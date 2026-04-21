# Hoja de Ruta de Desarrollo - Gimnasio MVP

El desarrollo debe seguir estrictamente estas fases. No avanzar a la siguiente fase sin completar y probar la anterior.

## Fase 1: Setup y Base de Datos ✅
- [x] Instalar dependencias esenciales: `npm install electron better-sqlite3` (sqlite3 reemplazado por better-sqlite3 por velocidad y API síncrona). `electron-builder` como devDependency.
- [x] Crear la estructura de carpetas: `src/main/`, `src/renderer/admin/`, `src/renderer/kiosk/`, `src/database/`.
- [x] Configurar `main.js` para levantar Electron con dos ventanas ocultas inicialmente.
- [x] Crear `src/database/db.js` que inicialice SQLite y cree las 4 tablas principales si no existen.
- [x] Insertar datos semilla (seeds) básicos para `membresias` (Mensual 31 días y Semestral 186 días).

## Fase 2: Backend Lógico (IPC) ✅
- [x] Crear los handlers en `src/main/handlers.js` (`ipcMain.handle`) para: 
  - `buscar-socio-por-dni(dni)` (Incluye máquina de estados verde/amarillo/rojo).
  - `registrar-asistencia(socio_id)`.
  - `crear-socio(datos)`.
  - `registrar-pago(datos)`.
  - `obtener-dashboard()` (Caja del día y lista de deudores).
  - `obtener-membresias()` (Listado para selects del admin).

## Fase 3: Interfaz del Kiosco (Pantalla 2)
- [ ] Crear `src/renderer/kiosk/index.html`.
- [ ] Estilizar para que sea Fullscreen, sin menú superior.
- [ ] Implementar un slider de imágenes en bucle.
- [ ] Crear un `input` oculto (o fuera de pantalla) que siempre tenga el `focus` capturando el teclado numérico.
- [ ] Al detectar "Enter", enviar el DNI por IPC al Main.
- [ ] Manejar la respuesta mostrando un div superpuesto por 5 segundos (Verde, Amarillo, o Rojo con sus respectivos textos) y luego volver al slider.

## Fase 4: Interfaz del Administrador (Pantalla 1)
- [ ] Crear `src/renderer/admin/index.html`.
- [ ] Armar el Layout (Sidebar a la izquierda, contenido a la derecha).
- [ ] Crear la vista "Dashboard" (Monto total del día actual).
- [ ] Crear la vista "Nuevo Socio" y "Cobrar Cuota".
- [ ] Crear la vista "Deudores" que liste socios vencidos.
- [ ] Implementar botón de WhatsApp en la vista de deudores para generar el link `wa.me/...`.

## Fase 5: Reportes y Backup
- [ ] Instalar `exceljs`.
- [ ] Crear proceso en `main.js` que genere un Excel consolidado con pestañas (Caja, Asistencias, Deudores) en una carpeta local `Reportes`.
- [ ] Crear lógica de exportación rápida para el USB (Dump de base de datos a CSV).