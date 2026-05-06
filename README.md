# 🏋️‍♂️ Gimnasio Manager MVP

Sistema de gestión "Local-First" diseñado específicamente para gimnasios de barrio. Construido con arquitectura de doble pantalla (Kiosco para clientes + Panel de Administración) y un enfoque estricto en la velocidad, la estabilidad offline y la portabilidad de los datos.

## 📌 Características Principales
- **100% Offline:** Funciona sin conexión a internet utilizando una base de datos local embebida.
- **Arquitectura de Doble Pantalla:** - *Pantalla 1 (Admin):* Gestión de caja, alta de socios, visualización de deudores y generación de reportes.
  - *Pantalla 2 (Kiosco):* Interfaz a pantalla completa "a prueba de balas" con captura de DNI mediante teclado numérico USB y alertas visuales de estado (Verde/Amarillo/Rojo).
- **Reportes Inteligentes:** Exportación de caja y asistencias a formato `.xlsx`.
- **Backup Simplificado:** Copia de seguridad directa del archivo de base de datos a pendrives externos.
- **Integración con WhatsApp:** Generación de enlaces `wa.me` prearmados para reclamar cuotas vencidas a un solo clic.

## 🚀 Stack Tecnológico
- **Entorno:** [Node.js](https://nodejs.org/) & [Electron.js](https://www.electronjs.org/)
- **Base de Datos:** `sql.js` (SQLite compilado en WebAssembly, cero dependencias nativas en Windows).
- **Frontend:** Vanilla JS, HTML5 y [Tailwind CSS](https://tailwindcss.com/) (vía CDN para máxima ligereza).
- **Reportes:** `exceljs`.

---

## 🛠️ Requisitos Previos

Para ejecutar o compilar este proyecto, necesitas tener instalado:
- **Node.js** (Versión 18 o superior recomendada).
- **Git** para el control de versiones.

---

## 💻 Instalación y Ejecución (Modo Desarrollo)

1. **Clonar el repositorio:**
   ```bash
   git clone [https://github.com/Enderking43/gym-manager-mvp.git](https://github.com/Enderking43/gym-manager-mvp.git)
