# Arquitectura y Contexto del Proyecto: Gimnasio MVP

## 1. Contexto del Negocio
- **Entorno:** Gimnasio de pueblo. Se prioriza la confianza y la agilidad por sobre la burocracia. No hay pagos parciales y la foto de perfil del socio es opcional.
- **Conectividad:** Sistema 100% OFFLINE (Local-First). No depende de internet para funcionar.
- **Hardware Objetivo:** PC de bajos recursos (i3, 8GB RAM) con DOS pantallas.
  - *Pantalla 1 (HDMI):* Administrador. Gestión de pagos, altas y vista de deudores.
  - *Pantalla 2 (VGA):* Kiosco (Socio). Pantalla completa, slider de publicidad e ingreso de DNI mediante teclado numérico USB.

## 2. Stack Tecnológico
- **Core:** Electron.js (para manejar multi-ventana) + Node.js.
- **Frontend:** Vanilla JS, HTML5 y Tailwind CSS (vía CDN o archivo local para no complicar el build). Minimalista y rápido.
- **Base de Datos:** SQLite3 (archivo local `gym_database.sqlite`).
- **Librerías Extra:** `exceljs` (para reportes) y alguna librería de carrusel simple para la publicidad.

## 3. Modelo de Datos (Esquema estricto)
La base de datos debe inicializarse con estas tablas:
- `socios`: id, dni (UNIQUE), nombre, apellido, telefono, fecha_alta, estado_aviso (BOOLEAN DEFAULT 0).
- `membresias`: id, nombre (Mensual, Semestral), duracion_dias (31, 186), precio.
- `pagos`: id, socio_id, membresia_id, fecha_pago, fecha_vencimiento, monto, metodo_pago (Efectivo/Transferencia).
- `asistencias`: id, socio_id, fecha_entrada (TIMESTAMP).

## 4. Reglas de Negocio Claves
- **Lógica de los 31 días:** Un pago mensual suma 31 días a la fecha actual.
- **Máquina de Estados de Acceso:**
  1. Si `fecha_vencimiento >= hoy` -> Acceso OK (Pantalla Verde). Resetea `estado_aviso` a 0.
  2. Si `fecha_vencimiento < hoy` Y `estado_aviso == 0` -> Acceso OK con Aviso (Pantalla Amarilla). Cambia `estado_aviso` a 1.
  3. Si `fecha_vencimiento < hoy` Y `estado_aviso == 1` -> Acceso Bloqueado (Pantalla Roja).

## 5. Convenciones de Desarrollo
- **Idioma:** Nombres de variables, funciones y commits en Inglés. Comentarios, documentación y UI en Español.
- **Separación de Responsabilidades (IPC):** El Frontend (Renderer) NO debe tocar la base de datos. Todo debe pasar por el `ipcRenderer` hacia el `main.js` (Main Process), quien maneja SQLite y devuelve la respuesta.
- **Cero Sobre-ingeniería:** Evitar React, Vue o Webpack a menos que sea estrictamente necesario. Mantener el proyecto ligero y fácil de debuggear.