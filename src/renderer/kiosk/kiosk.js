'use strict';

// ── Constantes ────────────────────────────────────────────────────────────
const SPLASH_DURATION_MS = 5000;
const SLIDE_INTERVAL_MS  = 7000;

const DAYS_ES   = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio',
                   'agosto','septiembre','octubre','noviembre','diciembre'];

const SLIDES = [
  { gradient: 'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
    title: 'Fuerza y Constancia',
    sub:   'Cada día que entras, te superas' },
  { gradient: 'linear-gradient(135deg, #1a3a2a 0%, #1d6a40 100%)',
    title: 'Tu Mejor Versión',
    sub:   'El esfuerzo de hoy es el resultado de mañana' },
  { gradient: 'linear-gradient(135deg, #2c1654 0%, #4a1942 100%)',
    title: 'Nunca Te Rindas',
    sub:   'Los campeones se forjan en el entrenamiento diario' },
  { gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    title: 'Bienvenido a Casa',
    sub:   'Tu gimnasio te espera cada dia' },
];

// Configuracion visual de cada estado de acceso
const SPLASH_CONFIG = {
  verde: {
    gradient: 'linear-gradient(135deg, #14532d 0%, #166534 100%)',
    icon:     '✓',
    buildTitle:   (r) => `Bienvenido/a, ${r.socio.nombre}!`,
    buildMessage: ()  => 'Acceso permitido',
    buildSub:     (r) => r.pago
      ? `Membresia vigente hasta el ${formatDate(r.pago.fecha_vencimiento)}`
      : '',
  },
  amarillo: {
    gradient: 'linear-gradient(135deg, #78350f 0%, #92400e 100%)',
    icon:     '!',
    buildTitle:   (r) => `Hola, ${r.socio.nombre}`,
    buildMessage: ()  => 'Tu membresia esta vencida',
    buildSub:     ()  => 'Podes ingresar esta vez. Por favor, renueva en recepcion.',
  },
  rojo: {
    gradient: 'linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%)',
    icon:     '✗',
    buildTitle:   (r) => r.socio ? `${r.socio.nombre} ${r.socio.apellido}` : 'Acceso Bloqueado',
    buildMessage: ()  => 'Acceso denegado',
    buildSub:     (r) => r.mensaje || 'Membresia vencida. Acercate al administrador.',
  },
  no_encontrado: {
    gradient: 'linear-gradient(135deg, #7c2d12 0%, #9a3412 100%)',
    icon:     '?',
    buildTitle:   ()  => 'DNI no registrado',
    buildMessage: ()  => 'Consulta en recepcion para darte de alta',
    buildSub:     ()  => '',
  },
  error: {
    gradient: 'linear-gradient(135deg, #1f2937 0%, #374151 100%)',
    icon:     '!',
    buildTitle:   ()  => 'Error del sistema',
    buildMessage: ()  => 'Intenta nuevamente',
    buildSub:     ()  => '',
  },
};

// ── Referencias al DOM ────────────────────────────────────────────────────
const dniInput      = document.getElementById('dni-input');
const dniDisplay    = document.getElementById('dni-display');
const clockEl       = document.getElementById('clock');
const dateEl        = document.getElementById('date-display');
const sliderBgEl    = document.getElementById('slider-bg');
const slideTitleEl  = document.getElementById('slide-title');
const slideSubEl    = document.getElementById('slide-sub');
const splashEl      = document.getElementById('splash');
const splashBgEl    = document.getElementById('splash-bg');
const splashIconEl  = document.getElementById('splash-icon');
const splashNameEl  = document.getElementById('splash-name');
const splashMsgEl   = document.getElementById('splash-message');
const splashSubEl   = document.getElementById('splash-sub');
const countdownBar  = document.getElementById('countdown-bar');
const countdownText = document.getElementById('splash-countdown');

// ── Reloj ─────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  clockEl.textContent = `${h}:${m}:${s}`;
  dateEl.textContent =
    `${DAYS_ES[now.getDay()]}, ${now.getDate()} de ${MONTHS_ES[now.getMonth()]} de ${now.getFullYear()}`;
}

// ── Slider ────────────────────────────────────────────────────────────────
let currentSlideIdx = 0;

function applySlide(slide) {
  sliderBgEl.style.background = slide.gradient;
  // Fade out y luego cambiar texto
  slideTitleEl.style.opacity = '0';
  slideSubEl.style.opacity   = '0';
  setTimeout(() => {
    slideTitleEl.textContent   = slide.title;
    slideSubEl.textContent     = slide.sub;
    slideTitleEl.style.opacity = '1';
    slideSubEl.style.opacity   = '1';
  }, 600);
}

function nextSlide() {
  currentSlideIdx = (currentSlideIdx + 1) % SLIDES.length;
  applySlide(SLIDES[currentSlideIdx]);
}

// ── Input — foco infinito ─────────────────────────────────────────────────
function forceFocus() {
  if (!dniInput.disabled) dniInput.focus();
}

// Si por alguna razon pierde el foco, lo recupera de inmediato
dniInput.addEventListener('blur', () => setTimeout(forceFocus, 30));

// Cualquier clic en la pantalla devuelve el foco
document.addEventListener('click', forceFocus);

// Cualquier tecla no capturada por el input lo refocusea
document.addEventListener('keydown', (e) => {
  if (document.activeElement !== dniInput) forceFocus();
});

// Filtrar solo dígitos y actualizar el display visual
dniInput.addEventListener('input', () => {
  const digits = dniInput.value.replace(/\D/g, '').slice(0, 8);
  dniInput.value = digits;
  dniDisplay.textContent = digits.length > 0
    ? digits.split('').join(' ')
    : '​'; // zero-width space para mantener la altura del div
});

// ── Lógica principal: Enter → IPC → splash ────────────────────────────────
dniInput.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;

  const dni = dniInput.value.trim();
  if (dni.length < 6) return; // DNI argentino mínimo 6 dígitos

  // Bloquear input para prevenir doble escaneo
  dniInput.disabled = true;

  let result;
  try {
    result = await window.api.invoke('buscar-socio-por-dni', dni);

    // Registrar asistencia solo si el acceso es verde o amarillo
    if (result.status === 'verde' || result.status === 'amarillo') {
      await window.api.invoke('registrar-asistencia', result.socio.id);
    }
  } catch (err) {
    console.error('[kiosk] Error en IPC:', err);
    result = { status: 'error' };
  }

  showSplash(result);
});

// ── Splash screen ─────────────────────────────────────────────────────────
let splashTimer = null;

function showSplash(result) {
  const cfg = SPLASH_CONFIG[result.status] || SPLASH_CONFIG.error;

  splashBgEl.style.background = cfg.gradient;
  splashIconEl.textContent    = cfg.icon;
  splashNameEl.textContent    = cfg.buildTitle(result);
  splashMsgEl.textContent     = cfg.buildMessage(result);
  splashSubEl.textContent     = cfg.buildSub(result);

  // Mostrar splash
  splashEl.classList.remove('hidden');
  splashEl.classList.add('flex', 'visible');

  // Barra de progreso: resetear sin transición y luego animar
  countdownBar.style.transition = 'none';
  countdownBar.style.width      = '100%';
  // Forzar reflow antes de iniciar la animación
  void countdownBar.offsetWidth;
  countdownBar.style.transition = `width ${SPLASH_DURATION_MS}ms linear`;
  countdownBar.style.width      = '0%';

  // Countdown textual
  let remaining = Math.round(SPLASH_DURATION_MS / 1000);
  countdownText.textContent = `Cerrando en ${remaining}s`;
  const tickInterval = setInterval(() => {
    remaining -= 1;
    countdownText.textContent = remaining > 0 ? `Cerrando en ${remaining}s` : '';
    if (remaining <= 0) clearInterval(tickInterval);
  }, 1000);

  // Cerrar automáticamente al cumplirse el tiempo
  if (splashTimer) clearTimeout(splashTimer);
  splashTimer = setTimeout(() => {
    clearInterval(tickInterval);
    closeSplash();
  }, SPLASH_DURATION_MS);
}

function closeSplash() {
  splashEl.classList.add('hidden');
  splashEl.classList.remove('flex', 'visible');

  // Limpiar input y display
  dniInput.disabled  = false;
  dniInput.value     = '';
  dniDisplay.textContent = '​';

  // Devolver foco al input
  setTimeout(forceFocus, 30);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(d, 10)} de ${MONTHS_ES[parseInt(m, 10) - 1]} de ${y}`;
}

// ── Inicialización ────────────────────────────────────────────────────────
(function init() {
  // Primer slide inmediato
  applySlide(SLIDES[0]);
  setInterval(nextSlide, SLIDE_INTERVAL_MS);

  // Reloj
  updateClock();
  setInterval(updateClock, 1000);

  // Foco inicial
  forceFocus();
})();
