'use strict';

const MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio',
                   'agosto','septiembre','octubre','noviembre','diciembre'];

// ── Datos en memoria ──────────────────────────────────────────────────────
let membresias = [];       // caché de membresías disponibles
let ccSocioActual = null;  // socio seleccionado en "Cobrar Cuota"

// ── Navegación ────────────────────────────────────────────────────────────
function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const view = document.getElementById(`view-${viewName}`);
  const navBtn = document.querySelector(`[data-view="${viewName}"]`);
  if (view) view.classList.add('active');
  if (navBtn) navBtn.classList.add('active');

  // Acciones al entrar a cada vista
  if (viewName === 'dashboard') loadDashboard();
  if (viewName === 'deudores')  loadDeudores();
  if (viewName === 'cobrar-cuota') resetCobrarCuota();
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ── Helpers de fecha ──────────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(d, 10)} de ${MONTHS_ES[parseInt(m, 10) - 1]} de ${y}`;
}

function formatCurrency(n) {
  return '$' + Number(n || 0).toLocaleString('es-AR');
}

function getDaysDiff(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((today - target) / 86400000);
}

// ── Toast ─────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  const inner = document.getElementById('toast-inner');
  const icon  = document.getElementById('toast-icon');
  const text  = document.getElementById('toast-msg');

  const styles = {
    success: { bg: 'bg-emerald-600', icon: '✓' },
    error:   { bg: 'bg-red-600',     icon: '✗' },
    info:    { bg: 'bg-indigo-600',  icon: 'i' },
  };
  const s = styles[type] || styles.info;
  inner.className = `flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${s.bg}`;
  icon.textContent = s.icon;
  text.textContent = msg;

  toast.classList.remove('hidden');
  toast.style.opacity = '1';

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 3500);
}

// ── Fecha en sidebar y dashboard ──────────────────────────────────────────
function updateDateDisplays() {
  const now  = new Date();
  const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const str  = `${days[now.getDay()]} ${now.getDate()} de ${MONTHS_ES[now.getMonth()]}`;
  const el1  = document.getElementById('sidebar-date');
  const el2  = document.getElementById('dashboard-date');
  if (el1) el1.textContent = str;
  if (el2) el2.textContent = str;
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────
async function loadDashboard() {
  const res = await window.api.invoke('obtener-dashboard');
  if (!res.success) return;

  const { cajaDia, deudores } = res;
  document.getElementById('stat-caja').textContent    = formatCurrency(cajaDia.total);
  document.getElementById('stat-pagos').textContent   =
    `${cajaDia.cantidad_pagos} cobro${cajaDia.cantidad_pagos !== 1 ? 's' : ''} realizados`;
  document.getElementById('stat-deudores').textContent = deudores.length;

  renderDashboardDeudores(deudores.slice(0, 5));
}

function renderDashboardDeudores(deudores) {
  const container = document.getElementById('dashboard-deudores-list');

  if (deudores.length === 0) {
    container.innerHTML = '<p class="text-center text-slate-400 text-sm py-8">Sin deudores</p>';
    return;
  }

  container.innerHTML = deudores.map(d => {
    const dias = d.ultimo_vencimiento ? getDaysDiff(d.ultimo_vencimiento) : null;
    const diasStr = dias !== null ? `Venció hace ${dias} día${dias !== 1 ? 's' : ''}` : 'Sin membresía';
    return `
      <div class="px-6 py-4 flex items-center justify-between hover:bg-slate-50">
        <div>
          <p class="font-medium text-slate-800">${d.nombre} ${d.apellido}</p>
          <p class="text-xs text-red-500 mt-0.5">${diasStr}</p>
        </div>
        <div class="flex items-center gap-2">
          ${buildWhatsAppBtn(d)}
        </div>
      </div>
    `;
  }).join('');
}

// ── DEUDORES ──────────────────────────────────────────────────────────────
async function loadDeudores() {
  const tbody = document.getElementById('deudores-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="text-center text-slate-400 py-12">Cargando...</td></tr>';

  const res = await window.api.invoke('obtener-dashboard');
  if (!res.success) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-red-500 py-12">Error al cargar</td></tr>';
    return;
  }

  const { deudores } = res;
  if (deudores.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-emerald-600 py-12 font-medium">Sin deudores — todos al día</td></tr>';
    return;
  }

  tbody.innerHTML = deudores.map(d => {
    const dias = d.ultimo_vencimiento ? getDaysDiff(d.ultimo_vencimiento) : null;
    const vencStr = d.ultimo_vencimiento
      ? `${formatDate(d.ultimo_vencimiento)} (hace ${dias}d)`
      : 'Sin membresía';
    return `
      <tr class="border-t border-slate-50 hover:bg-slate-50 transition-colors">
        <td class="px-6 py-4">
          <p class="font-medium text-slate-800">${d.nombre} ${d.apellido}</p>
        </td>
        <td class="px-6 py-4 text-slate-500">${d.dni}</td>
        <td class="px-6 py-4 text-red-500 text-xs">${vencStr}</td>
        <td class="px-6 py-4 text-slate-500">${d.telefono || '—'}</td>
        <td class="px-6 py-4">
          <div class="flex gap-2">
            ${buildWhatsAppBtn(d)}
            <button
              class="px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors font-medium"
              onclick="irACobrar('${d.dni}')">
              Cobrar
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function buildWhatsAppBtn(socio) {
  if (!socio.telefono) return '';
  const tel     = String(socio.telefono).replace(/\D/g, '');
  const numero  = `549${tel}`;
  const texto   = encodeURIComponent(
    `Hola ${socio.nombre}! Te recordamos que tu membresía en el gimnasio venció el ${formatDate(socio.ultimo_vencimiento)}. Por favor, acercate a renovarla. ¡Gracias!`
  );
  const url = `https://wa.me/${numero}?text=${texto}`;
  return `
    <a href="${url}" target="_blank"
       class="flex items-center gap-1 px-3 py-1.5 text-xs bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 transition-colors font-medium">
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
      WhatsApp
    </a>
  `;
}

function irACobrar(dni) {
  switchView('cobrar-cuota');
  document.getElementById('cc-dni').value = dni;
  buscarSocioParaCobro();
}

// ── NUEVO SOCIO ───────────────────────────────────────────────────────────
document.getElementById('form-nuevo-socio').addEventListener('submit', async (e) => {
  e.preventDefault();

  const nombre   = document.getElementById('ns-nombre').value.trim();
  const apellido = document.getElementById('ns-apellido').value.trim();
  const dni      = document.getElementById('ns-dni').value.trim();
  const telefono = document.getElementById('ns-telefono').value.trim();
  const errEl    = document.getElementById('ns-error');
  const btn      = document.getElementById('ns-submit');

  errEl.classList.add('hidden');

  if (!/^\d{6,8}$/.test(dni)) {
    errEl.textContent = 'El DNI debe tener entre 6 y 8 dígitos numéricos.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Registrando...';

  const res = await window.api.invoke('crear-socio', { dni, nombre, apellido, telefono: telefono || null });

  btn.disabled = false;
  btn.textContent = 'Registrar Socio';

  if (res.success) {
    showToast(`Socio ${nombre} ${apellido} registrado correctamente`, 'success');
    resetNuevoSocio();
  } else {
    errEl.textContent = res.error || 'Error al registrar el socio.';
    errEl.classList.remove('hidden');
  }
});

function resetNuevoSocio() {
  document.getElementById('form-nuevo-socio').reset();
  document.getElementById('ns-error').classList.add('hidden');
}

// ── COBRAR CUOTA ──────────────────────────────────────────────────────────
async function buscarSocioParaCobro() {
  const dni   = document.getElementById('cc-dni').value.trim();
  const errEl = document.getElementById('cc-error');
  const card  = document.getElementById('cc-socio-card');
  const form  = document.getElementById('cc-form-pago');

  errEl.classList.add('hidden');
  card.classList.add('hidden');
  form.classList.add('hidden');
  ccSocioActual = null;

  if (!dni) return;

  const res = await window.api.invoke('buscar-socio-admin', dni);

  if (!res.success) {
    errEl.textContent = res.error || 'Socio no encontrado.';
    errEl.classList.remove('hidden');
    return;
  }

  ccSocioActual = res.socio;

  // Llenar tarjeta de socio
  document.getElementById('cc-socio-nombre').textContent =
    `${res.socio.nombre} ${res.socio.apellido}`;
  document.getElementById('cc-socio-dni').textContent = res.socio.dni;

  const badge = document.getElementById('cc-socio-badge');
  const vencEl = document.getElementById('cc-socio-venc');
  if (res.estadoMembresia === 'vigente') {
    badge.innerHTML = '<span class="badge-vigente">Vigente</span>';
    vencEl.textContent = `Vence el ${formatDate(res.lastPago.fecha_vencimiento)}`;
  } else if (res.estadoMembresia === 'vencida') {
    badge.innerHTML = '<span class="badge-vencida">Vencida</span>';
    vencEl.textContent = `Venció el ${formatDate(res.lastPago.fecha_vencimiento)}`;
  } else {
    badge.innerHTML = '<span class="badge-sin">Sin membresía</span>';
    vencEl.textContent = '';
  }

  card.classList.remove('hidden');

  // Mostrar formulario de pago
  document.getElementById('cc-socio-id').value = res.socio.id;
  populateMembresias();
  form.classList.remove('hidden');
}

async function populateMembresias() {
  if (membresias.length === 0) {
    const res = await window.api.invoke('obtener-membresias');
    if (res.success) membresias = res.membresias;
  }

  const select = document.getElementById('cc-membresia');
  select.innerHTML = '<option value="">Seleccionar...</option>' +
    membresias.map(m =>
      `<option value="${m.id}" data-precio="${m.precio}">
        ${m.nombre} — ${m.duracion_dias} días (${formatCurrency(m.precio)})
      </option>`
    ).join('');

  document.getElementById('cc-monto').value = '';
}

function onMembresiaChange() {
  const select = document.getElementById('cc-membresia');
  const opt    = select.options[select.selectedIndex];
  const precio = opt?.dataset?.precio;
  document.getElementById('cc-monto').value = precio ? Number(precio) : '';
}

document.getElementById('form-cobrar-cuota').addEventListener('submit', async (e) => {
  e.preventDefault();

  const socio_id    = Number(document.getElementById('cc-socio-id').value);
  const membresia_id = Number(document.getElementById('cc-membresia').value);
  const monto       = Number(document.getElementById('cc-monto').value);
  const metodo_pago = document.querySelector('input[name="cc-metodo"]:checked')?.value;
  const errEl       = document.getElementById('cc-pago-error');
  const btn         = document.getElementById('cc-submit');

  errEl.classList.add('hidden');

  if (!membresia_id) {
    errEl.textContent = 'Seleccioná una membresía.';
    errEl.classList.remove('hidden');
    return;
  }
  if (!monto || monto <= 0) {
    errEl.textContent = 'El monto debe ser mayor a $0.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Registrando...';

  const res = await window.api.invoke('registrar-pago', {
    socio_id, membresia_id, monto, metodo_pago,
  });

  btn.disabled = false;
  btn.textContent = 'Registrar Pago';

  if (res.success) {
    const nombre = ccSocioActual ? `${ccSocioActual.nombre} ${ccSocioActual.apellido}` : 'Socio';
    showToast(`Pago de ${nombre} registrado. Vence: ${formatDate(res.fecha_vencimiento)}`, 'success');
    resetCobrarCuota();
  } else {
    errEl.textContent = res.error || 'Error al registrar el pago.';
    errEl.classList.remove('hidden');
  }
});

function resetCobrarCuota() {
  document.getElementById('cc-dni').value = '';
  document.getElementById('cc-socio-card').classList.add('hidden');
  document.getElementById('cc-form-pago').classList.add('hidden');
  document.getElementById('cc-error').classList.add('hidden');
  document.getElementById('cc-pago-error').classList.add('hidden');
  document.getElementById('form-cobrar-cuota').reset();
  ccSocioActual = null;
}

// ── Enter en el campo DNI de cobrar cuota ─────────────────────────────────
document.getElementById('cc-dni').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') buscarSocioParaCobro();
});

// ── REPORTES Y BACKUP ─────────────────────────────────────────────────────
async function generarExcel() {
  const btn = document.getElementById('btn-excel');
  btn.disabled = true;
  btn.textContent = 'Generando...';

  const res = await window.api.invoke('generar-reporte-excel');

  btn.disabled = false;
  btn.textContent = 'Generar Reporte Excel';

  if (res.canceled) return;
  if (res.success) {
    showToast('Reporte Excel guardado correctamente', 'success');
  } else {
    showToast(`Error al generar el reporte: ${res.error}`, 'error');
  }
}

async function crearBackup() {
  const btn = document.getElementById('btn-backup');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const res = await window.api.invoke('crear-backup');

  btn.disabled = false;
  btn.textContent = 'Crear Backup de Seguridad';

  if (res.canceled) return;
  if (res.success) {
    showToast('Backup guardado correctamente', 'success');
  } else {
    showToast(`Error al crear el backup: ${res.error}`, 'error');
  }
}

async function restaurarBD() {
  const confirmar = window.confirm(
    '¿Seguro que querés restaurar la base de datos?\n\nEsta acción reemplazará todos los datos actuales y reiniciará la aplicación.'
  );
  if (!confirmar) return;

  const btn = document.getElementById('btn-restaurar');
  btn.disabled = true;
  btn.textContent = 'Procesando...';

  const res = await window.api.invoke('restaurar-base-datos');

  // Si llegamos acá, el usuario canceló el diálogo de archivo
  btn.disabled = false;
  btn.textContent = 'Restaurar Base de Datos';

  if (!res.canceled && !res.success) {
    showToast(`Error al restaurar: ${res.error}`, 'error');
  }
}

// ── Inicialización ────────────────────────────────────────────────────────
(async function init() {
  updateDateDisplays();
  await loadDashboard();
  // Pre-cargar membresías en segundo plano
  const res = await window.api.invoke('obtener-membresias');
  if (res.success) membresias = res.membresias;
})();
