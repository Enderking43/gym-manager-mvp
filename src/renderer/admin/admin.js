'use strict';

const MONTHS_ES     = ['enero','febrero','marzo','abril','mayo','junio','julio',
                       'agosto','septiembre','octubre','noviembre','diciembre'];
const MONTHS_LABELS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// ── Estado en memoria ─────────────────────────────────────────────────────
let membresias        = [];
let ccSocioActual     = null;
let gymConfig         = { nombre_gym: 'Gimnasio Local', color_primario: '#EAB308', logo_base64: '' };
let currentLogoBase64 = '';
let revenueChart      = null;
let currentUser       = null;   // { id, nombre, rol }
let movimientosCache  = [];
let articulosCache      = [];
let posArticuloActual   = null;
let membresiasCfgCache  = [];
let gruposCache         = [];
let grupoSeleccionado   = null;

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

function calcAge(fechaNacStr) {
  if (!fechaNacStr) return null;
  const nac = new Date(fechaNacStr + 'T00:00:00');
  if (isNaN(nac.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - nac.getFullYear();
  const m = today.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < nac.getDate())) age--;
  return age;
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
    info:    { bg: 'bg-slate-700',   icon: 'i' },
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

// ── Tema visual ───────────────────────────────────────────────────────────
function applyTheme(config) {
  const color = config.color_primario || '#EAB308';
  document.documentElement.style.setProperty('--color-primario', color);

  // Login overlay
  const loginGymName = document.getElementById('login-gym-name');
  if (loginGymName) loginGymName.textContent = config.nombre_gym || 'Gimnasio Local';

  const loginLogoWrap   = document.getElementById('login-logo-wrap');
  const loginLogoImg    = document.getElementById('login-logo-img');
  const loginLogoPlaceh = document.getElementById('login-logo-placeholder');

  if (config.logo_base64 && loginLogoImg && loginLogoWrap) {
    loginLogoImg.src = config.logo_base64;
    loginLogoWrap.classList.remove('hidden');
    if (loginLogoPlaceh) loginLogoPlaceh.classList.add('hidden');
  } else {
    if (loginLogoWrap)   loginLogoWrap.classList.add('hidden');
    if (loginLogoPlaceh) loginLogoPlaceh.classList.remove('hidden');
  }

  // Sidebar
  const nameEl = document.getElementById('sidebar-gym-name');
  if (nameEl) nameEl.textContent = config.nombre_gym || 'Gimnasio';

  const logoImg        = document.getElementById('sidebar-logo');
  const logoContainer  = document.getElementById('sidebar-logo-img');
  const logoPlaceholder = document.getElementById('sidebar-logo-placeholder');

  if (config.logo_base64 && logoImg && logoContainer) {
    logoImg.src = config.logo_base64;
    logoContainer.classList.remove('hidden');
    if (logoPlaceholder) logoPlaceholder.classList.add('hidden');
  } else {
    if (logoContainer)  logoContainer.classList.add('hidden');
    if (logoPlaceholder) logoPlaceholder.classList.remove('hidden');
  }

  if (revenueChart) {
    revenueChart.data.datasets[0].backgroundColor = color + 'BB';
    revenueChart.data.datasets[0].borderColor      = color;
    revenueChart.update();
  }
}

// ── Configuración ─────────────────────────────────────────────────────────
async function loadConfig() {
  const res = await window.api.invoke('obtener-configuracion');
  if (res.success && res.config) {
    gymConfig = res.config;
    applyTheme(gymConfig);
  }
}

function populateConfigForm() {
  document.getElementById('cfg-nombre').value = gymConfig.nombre_gym || '';
  document.getElementById('cfg-color').value  = gymConfig.color_primario || '#EAB308';
  currentLogoBase64 = gymConfig.logo_base64 || '';

  const preview     = document.getElementById('cfg-logo-preview');
  const previewWrap = document.getElementById('cfg-logo-preview-wrap');
  if (currentLogoBase64 && preview && previewWrap) {
    preview.src = currentLogoBase64;
    previewWrap.classList.remove('hidden');
  } else if (previewWrap) {
    previewWrap.classList.add('hidden');
  }
}

document.getElementById('cfg-logo').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    currentLogoBase64 = ev.target.result;
    const preview     = document.getElementById('cfg-logo-preview');
    const previewWrap = document.getElementById('cfg-logo-preview-wrap');
    if (preview && previewWrap) {
      preview.src = currentLogoBase64;
      previewWrap.classList.remove('hidden');
    }
  };
  reader.readAsDataURL(file);
});

function clearLogo() {
  currentLogoBase64 = '';
  document.getElementById('cfg-logo').value = '';
  const previewWrap = document.getElementById('cfg-logo-preview-wrap');
  if (previewWrap) previewWrap.classList.add('hidden');
}

async function saveConfig() {
  const nombre_gym     = document.getElementById('cfg-nombre').value.trim();
  const color_primario = document.getElementById('cfg-color').value;
  const btn            = document.getElementById('cfg-save');

  if (!nombre_gym) {
    showToast('El nombre del gimnasio no puede estar vacío', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const res = await window.api.invoke('guardar-configuracion', {
    nombre_gym, color_primario, logo_base64: currentLogoBase64,
  });

  btn.disabled = false;
  btn.textContent = 'Guardar Cambios';

  if (res.success) {
    gymConfig = { nombre_gym, color_primario, logo_base64: currentLogoBase64 };
    applyTheme(gymConfig);
    showToast('Configuración guardada correctamente', 'success');
  } else {
    showToast(`Error al guardar: ${res.error}`, 'error');
  }
}

// ── Gestión de usuarios (solo admin) ─────────────────────────────────────
async function loadAndRenderUsuarios() {
  const list = document.getElementById('usuarios-list');
  if (!list) return;

  const res = await window.api.invoke('obtener-usuarios');
  if (!res.success) return;

  list.innerHTML = res.usuarios.map(u => `
    <div class="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
      <div>
        <p class="text-sm font-medium text-slate-800">${u.nombre}</p>
        <p class="text-xs text-slate-500">${u.rol === 'admin' ? 'Administrador' : 'Empleado'}</p>
      </div>
      ${u.rol !== 'admin' ? `
        <button onclick="eliminarUsuario(${u.id})"
                class="text-xs text-red-500 hover:text-red-700 transition-colors font-medium">
          Eliminar
        </button>
      ` : `<span class="text-xs text-slate-300">Protegido</span>`}
    </div>
  `).join('') || '<p class="text-sm text-slate-400">No hay usuarios registrados.</p>';
}

async function eliminarUsuario(id) {
  if (!window.confirm('¿Eliminar este usuario? Esta acción no se puede deshacer.')) return;
  const res = await window.api.invoke('eliminar-usuario', id);
  if (res.success) {
    showToast('Usuario eliminado', 'success');
    loadAndRenderUsuarios();
  } else {
    showToast(res.error || 'Error al eliminar', 'error');
  }
}

document.getElementById('form-crear-usuario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = document.getElementById('nu-nombre').value.trim();
  const clave  = document.getElementById('nu-clave').value;
  const errEl  = document.getElementById('nu-error');

  errEl.classList.add('hidden');

  if (!nombre || !clave) {
    errEl.textContent = 'Nombre y clave son obligatorios.';
    errEl.classList.remove('hidden');
    return;
  }

  const res = await window.api.invoke('crear-usuario', { nombre, clave });

  if (res.success) {
    showToast(`Usuario "${nombre}" creado correctamente`, 'success');
    document.getElementById('form-crear-usuario').reset();
    loadAndRenderUsuarios();
  } else {
    errEl.textContent = res.error || 'Error al crear el usuario.';
    errEl.classList.remove('hidden');
  }
});

// ── Autenticación ─────────────────────────────────────────────────────────
function showLoginScreen() {
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('main-layout').style.display = 'none';
}

function applySession(usuario) {
  currentUser = usuario;
  document.getElementById('login-overlay').classList.add('hidden');
  document.getElementById('main-layout').style.display = 'block';

  document.getElementById('sidebar-user-name').textContent = usuario.nombre;
  document.getElementById('sidebar-user-rol').textContent  =
    usuario.rol === 'admin' ? 'Administrador' : 'Empleado';

  // Ocultar nav items y secciones restringidas para empleados
  document.querySelectorAll('[data-admin-only]').forEach(el => {
    el.style.display = usuario.rol === 'admin' ? '' : 'none';
  });

  // Si el empleado tiene activa una vista admin-only, llevarlo al dashboard
  const activeView = document.querySelector('.view.active');
  const adminViews = ['view-reportes', 'view-configuracion', 'view-inventario', 'view-gastos', 'view-grupos'];
  if (activeView && adminViews.includes(activeView.id) && usuario.rol !== 'admin') {
    switchView('dashboard');
  }
}

function handleLogout() {
  if (!window.confirm('¿Cerrar sesión?')) return;
  currentUser = null;
  document.getElementById('login-usuario').value = '';
  document.getElementById('login-clave').value   = '';
  document.getElementById('login-error').classList.add('hidden');
  showLoginScreen();
}

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = document.getElementById('login-usuario').value.trim();
  const clave  = document.getElementById('login-clave').value;
  const errEl  = document.getElementById('login-error');
  const btn    = document.getElementById('login-submit');

  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Ingresando...';

  const res = await window.api.invoke('validar-login', { nombre, clave });

  btn.disabled = false;
  btn.textContent = 'Ingresar';

  if (res.success) {
    applySession(res.usuario);
    await postLoginInit();
  } else {
    errEl.textContent = res.error || 'Usuario o clave incorrectos';
    errEl.classList.remove('hidden');
    document.getElementById('login-clave').value = '';
    document.getElementById('login-clave').focus();
  }
});

// Inicialización post-login (carga datos del sistema)
async function postLoginInit() {
  updateDateDisplays();
  const yearEl = document.getElementById('chart-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
  await loadDashboard();
  const mRes = await window.api.invoke('obtener-membresias');
  if (mRes.success) membresias = mRes.membresias;
}

// ── Navegación ────────────────────────────────────────────────────────────
function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const view   = document.getElementById(`view-${viewName}`);
  const navBtn = document.querySelector(`[data-view="${viewName}"]`);
  if (view)   view.classList.add('active');
  if (navBtn) navBtn.classList.add('active');

  if (viewName === 'dashboard')       loadDashboard();
  if (viewName === 'deudores')        loadDeudores();
  if (viewName === 'cobrar-cuota')    resetCobrarCuota();
  if (viewName === 'caja')            loadMovimientos();
  if (viewName === 'punto-de-venta')  loadPuntoDeVenta();
  if (viewName === 'inventario')      loadInventario();
  if (viewName === 'gastos')          loadGastos();
  if (viewName === 'grupos')          loadGrupos();
  if (viewName === 'configuracion') {
    populateConfigForm();
    if (currentUser?.rol === 'admin') {
      loadAndRenderUsuarios();
      loadAndRenderMembresiasCfg();
    }
  }
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

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

// ── Gráfico de ingresos ───────────────────────────────────────────────────
function renderChart(data) {
  const ctx = document.getElementById('revenue-chart');
  if (!ctx || typeof Chart === 'undefined') return;

  const color = gymConfig.color_primario || '#EAB308';

  if (revenueChart) {
    revenueChart.data.datasets[0].data            = data;
    revenueChart.data.datasets[0].backgroundColor = color + 'BB';
    revenueChart.data.datasets[0].borderColor      = color;
    revenueChart.update();
    return;
  }

  revenueChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: MONTHS_LABELS,
      datasets: [{
        label: 'Ingresos ($)',
        data: data,
        backgroundColor: color + 'BB',
        borderColor: color,
        borderWidth: 2,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ' ' + formatCurrency(ctx.parsed.y) } },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: { callback: (v) => formatCurrency(v), font: { size: 11 } },
        },
        x: { grid: { display: false }, ticks: { font: { size: 12 } } },
      },
    },
  });
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────
async function loadDashboard() {
  const res = await window.api.invoke('obtener-estadisticas-dashboard');
  if (!res.success) return;

  document.getElementById('stat-total').textContent    = res.total_socios;
  document.getElementById('stat-activos').textContent  = res.membresias_activas;
  document.getElementById('stat-deudores').textContent = res.deudores_activos;
  document.getElementById('stat-caja').textContent     = formatCurrency(res.caja_cuotas_diaria);

  const cant = res.caja_diaria_cantidad;
  document.getElementById('stat-pagos').textContent =
    cant > 0 ? `${cant} cobro${cant !== 1 ? 's' : ''} hoy` : 'Sin cobros hoy';

  document.getElementById('stat-buffet').textContent = formatCurrency(res.caja_buffet_diaria);
  document.getElementById('stat-gastos').textContent = formatCurrency(res.egresos_diarios);

  const neta   = res.rentabilidad_neta_diaria;
  const netaEl = document.getElementById('stat-neta');
  netaEl.textContent = formatCurrency(neta);
  netaEl.className   = `text-2xl font-bold mt-2 ${neta >= 0 ? 'text-emerald-600' : 'text-red-500'}`;

  renderTopProductos(res.productos_mas_vendidos);
  renderChart(res.ingresos_mensuales);
}

function renderTopProductos(productos) {
  const listEl = document.getElementById('top-productos-list');
  if (!listEl) return;
  if (!productos || productos.length === 0) {
    listEl.innerHTML = '<p class="text-sm text-slate-400">Sin ventas de buffet este mes.</p>';
    return;
  }
  listEl.innerHTML = productos.map((p, i) => `
    <div class="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
      <div class="flex items-center gap-3">
        <span class="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center flex-shrink-0">${i + 1}</span>
        <span class="text-sm font-medium text-slate-800">${p.nombre}</span>
      </div>
      <div class="text-right">
        <p class="text-sm font-semibold text-slate-700">${p.total_cantidad} unid.</p>
        <p class="text-xs text-slate-400">${formatCurrency(p.total_monto)}</p>
      </div>
    </div>
  `).join('');
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
        <td class="px-6 py-4"><p class="font-medium text-slate-800">${d.nombre} ${d.apellido}</p></td>
        <td class="px-6 py-4 text-slate-500">${d.dni}</td>
        <td class="px-6 py-4 text-red-500 text-xs">${vencStr}</td>
        <td class="px-6 py-4 text-slate-500">${d.telefono || '—'}</td>
        <td class="px-6 py-4">
          <div class="flex gap-2 flex-wrap">
            ${buildWhatsAppBtn(d)}
            <button class="px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors font-medium"
                    onclick="irACobrar('${d.dni}')">Cobrar</button>
            <button class="px-3 py-1.5 text-xs bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100 transition-colors font-medium"
                    onclick="abrirEditarSocioPorDni('${d.dni}')">Editar</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function buildWhatsAppBtn(socio) {
  if (!socio.telefono) return '';
  const tel    = String(socio.telefono).replace(/\D/g, '');
  const numero = `549${tel}`;
  const texto  = encodeURIComponent(
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

// ── CAJA Y MOVIMIENTOS ────────────────────────────────────────────────────
async function loadMovimientos() {
  const tbody = document.getElementById('movimientos-tbody');
  tbody.innerHTML = '<tr><td colspan="8" class="text-center text-slate-400 py-12">Cargando...</td></tr>';

  // Mostrar columna de acción solo si es admin
  const cajaHeader = document.getElementById('caja-accion-header');
  const isAdmin    = currentUser?.rol === 'admin';
  if (cajaHeader) cajaHeader.textContent = isAdmin ? 'Acción' : '';

  const res = await window.api.invoke('obtener-movimientos');
  if (!res.success) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-red-500 py-12">Error al cargar</td></tr>';
    return;
  }

  movimientosCache = res.movimientos;

  if (movimientosCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-slate-400 py-12">Sin movimientos registrados</td></tr>';
    return;
  }

  tbody.innerHTML = movimientosCache.map(m => `
    <tr class="border-t border-slate-50 hover:bg-slate-50 transition-colors">
      <td class="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">${m.fecha_pago}</td>
      <td class="px-4 py-3">
        <p class="font-medium text-slate-800 text-sm">${m.socio_nombre}</p>
        <p class="text-xs text-slate-400">DNI ${m.dni}</p>
      </td>
      <td class="px-4 py-3">
        <span class="inline-block px-2 py-0.5 text-xs rounded-full font-medium ${
          m.tipo_cobro === 'Pase'
            ? 'bg-purple-100 text-purple-800'
            : 'bg-blue-100 text-blue-800'
        }">${m.tipo_cobro || 'Membresia'}</span>
      </td>
      <td class="px-4 py-3 text-slate-600 text-sm max-w-[140px] truncate" title="${m.descripcion_display || ''}">${m.descripcion_display || '—'}</td>
      <td class="px-4 py-3 font-semibold text-emerald-700 text-sm whitespace-nowrap">${formatCurrency(m.monto)}</td>
      <td class="px-4 py-3 text-slate-500 text-sm">${m.metodo_pago}</td>
      <td class="px-4 py-3 text-slate-400 text-xs">${m.cobrado_por || '—'}</td>
      <td class="px-4 py-3">
        ${isAdmin ? `
          <button onclick="openEditarPagoModal(${m.id})"
                  class="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors">
            Editar
          </button>
        ` : ''}
      </td>
    </tr>
  `).join('');
}

// ── Modal: Editar Pago ────────────────────────────────────────────────────
function openEditarPagoModal(id) {
  const m = movimientosCache.find(mv => mv.id === id);
  if (!m) return;

  document.getElementById('ep-id').value          = m.id;
  document.getElementById('ep-monto').value        = m.monto;
  document.getElementById('ep-metodo').value       = m.metodo_pago;
  document.getElementById('ep-descripcion').value  = m.descripcion || '';

  document.getElementById('modal-editar-pago').classList.remove('hidden');
}

function closeEditarPagoModal() {
  document.getElementById('modal-editar-pago').classList.add('hidden');
}

document.getElementById('form-editar-pago').addEventListener('submit', async (e) => {
  e.preventDefault();

  const id          = Number(document.getElementById('ep-id').value);
  const monto       = Number(document.getElementById('ep-monto').value);
  const metodo_pago = document.getElementById('ep-metodo').value;
  const descripcion = document.getElementById('ep-descripcion').value.trim();
  const btn         = document.getElementById('ep-submit');

  if (!monto || monto <= 0) {
    showToast('El monto debe ser mayor a $0', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const res = await window.api.invoke('editar-pago', { id, monto, metodo_pago, descripcion: descripcion || null });

  btn.disabled = false;
  btn.textContent = 'Guardar';

  if (res.success) {
    showToast('Pago actualizado correctamente', 'success');
    closeEditarPagoModal();
    loadMovimientos();
  } else {
    showToast(res.error || 'Error al actualizar el pago', 'error');
  }
});

// ── Modal: Editar Socio ───────────────────────────────────────────────────
function openEditarSocioModal(socio) {
  document.getElementById('es-id').value        = socio.id;
  document.getElementById('es-nombre').value    = socio.nombre || '';
  document.getElementById('es-apellido').value  = socio.apellido || '';
  document.getElementById('es-telefono').value  = socio.telefono || '';
  document.getElementById('es-email').value     = socio.email || '';
  document.getElementById('es-domicilio').value = socio.domicilio || '';
  document.getElementById('es-fechanac').value  = socio.fecha_nacimiento || '';
  document.getElementById('es-genero').value    = socio.genero || '';
  document.getElementById('es-error').classList.add('hidden');

  const edadEl = document.getElementById('es-edad-display');
  if (edadEl) {
    const age = calcAge(socio.fecha_nacimiento);
    edadEl.textContent = age !== null ? `${age} años` : '';
  }

  document.getElementById('modal-editar-socio').classList.remove('hidden');
}

function closeEditarSocioModal() {
  document.getElementById('modal-editar-socio').classList.add('hidden');
}

async function abrirEditarSocioPorDni(dni) {
  const res = await window.api.invoke('buscar-socio-admin', String(dni));
  if (!res.success) { showToast('No se pudo cargar el socio', 'error'); return; }
  openEditarSocioModal(res.socio);
}

function abrirEditarSocioDesdeCC() {
  if (ccSocioActual) openEditarSocioModal(ccSocioActual);
}

document.getElementById('form-editar-socio').addEventListener('submit', async (e) => {
  e.preventDefault();

  const id            = Number(document.getElementById('es-id').value);
  const nombre        = document.getElementById('es-nombre').value.trim();
  const apellido      = document.getElementById('es-apellido').value.trim();
  const telefono      = document.getElementById('es-telefono').value.trim();
  const email         = document.getElementById('es-email').value.trim();
  const domicilio     = document.getElementById('es-domicilio').value.trim();
  const fechanac      = document.getElementById('es-fechanac').value;
  const genero        = document.getElementById('es-genero').value;
  const btn           = document.getElementById('es-submit');
  const errEl         = document.getElementById('es-error');

  errEl.classList.add('hidden');

  if (!nombre || !apellido) {
    errEl.textContent = 'Nombre y apellido son obligatorios.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const res = await window.api.invoke('editar-socio', {
    id, nombre, apellido,
    telefono:        telefono  || null,
    email:           email     || null,
    domicilio:       domicilio || null,
    fecha_nacimiento: fechanac || null,
    genero:          genero    || null,
  });

  btn.disabled = false;
  btn.textContent = 'Guardar Cambios';

  if (res.success) {
    showToast(`Datos de ${nombre} ${apellido} actualizados`, 'success');
    closeEditarSocioModal();
    // Actualizar tarjeta en cobrar-cuota si es el mismo socio
    if (ccSocioActual && ccSocioActual.id === id) {
      ccSocioActual = { ...ccSocioActual, nombre, apellido, telefono, email, domicilio, fecha_nacimiento: fechanac, genero };
      document.getElementById('cc-socio-nombre').textContent = `${nombre} ${apellido}`;
      const edadEl = document.getElementById('cc-socio-edad');
      if (edadEl) {
        const age = calcAge(fechanac);
        edadEl.textContent = age !== null ? `• ${age} años` : '';
      }
    }
  } else {
    errEl.textContent = res.error || 'Error al guardar los cambios.';
    errEl.classList.remove('hidden');
  }
});

// ── NUEVO SOCIO ───────────────────────────────────────────────────────────
document.getElementById('form-nuevo-socio').addEventListener('submit', async (e) => {
  e.preventDefault();

  const nombre      = document.getElementById('ns-nombre').value.trim();
  const apellido    = document.getElementById('ns-apellido').value.trim();
  const dni         = document.getElementById('ns-dni').value.trim();
  const telefono    = document.getElementById('ns-telefono').value.trim();
  const email       = document.getElementById('ns-email').value.trim();
  const domicilio   = document.getElementById('ns-domicilio').value.trim();
  const fechanac    = document.getElementById('ns-fechanac').value;
  const genero      = document.getElementById('ns-genero').value;
  const errEl       = document.getElementById('ns-error');
  const btn         = document.getElementById('ns-submit');

  errEl.classList.add('hidden');

  if (!/^\d{6,8}$/.test(dni)) {
    errEl.textContent = 'El DNI debe tener entre 6 y 8 dígitos numéricos.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Registrando...';

  const res = await window.api.invoke('crear-socio', {
    dni, nombre, apellido,
    telefono:         telefono  || null,
    email:            email     || null,
    domicilio:        domicilio || null,
    fecha_nacimiento: fechanac  || null,
    genero:           genero    || null,
  });

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
function onCcTipoChange() {
  const tipo = document.querySelector('input[name="cc-tipo"]:checked')?.value;
  document.getElementById('cc-section-membresia').classList.toggle('hidden', tipo === 'pase');
  document.getElementById('cc-section-pase').classList.toggle('hidden',      tipo !== 'pase');
}

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

  const grupoBadge   = document.getElementById('cc-grupo-badge');
  const grupoNombreEl = document.getElementById('cc-grupo-nombre');
  if (res.socio.grupo_id && res.socio.grupo_nombre && grupoBadge && grupoNombreEl) {
    grupoNombreEl.textContent = `Miembro de: ${res.socio.grupo_nombre}`;
    grupoBadge.classList.remove('hidden');
  } else if (grupoBadge) {
    grupoBadge.classList.add('hidden');
  }

  const edad = calcAge(res.socio.fecha_nacimiento);
  document.getElementById('cc-socio-nombre').textContent = `${res.socio.nombre} ${res.socio.apellido}`;
  document.getElementById('cc-socio-edad').textContent   = edad !== null ? `• ${edad} años` : '';
  document.getElementById('cc-socio-dni').textContent    = res.socio.dni;

  const badge  = document.getElementById('cc-socio-badge');
  const vencEl = document.getElementById('cc-socio-venc');
  if (res.estadoMembresia === 'vigente') {
    badge.innerHTML  = '<span class="badge-vigente">Vigente</span>';
    vencEl.textContent = `Vence el ${formatDate(res.lastPago.fecha_vencimiento)}`;
  } else if (res.estadoMembresia === 'vencida') {
    badge.innerHTML  = '<span class="badge-vencida">Vencida</span>';
    vencEl.textContent = `Venció el ${formatDate(res.lastPago.fecha_vencimiento)}`;
  } else {
    badge.innerHTML  = '<span class="badge-sin">Sin membresía</span>';
    vencEl.textContent = '';
  }

  card.classList.remove('hidden');
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

  const tipo       = document.querySelector('input[name="cc-tipo"]:checked')?.value || 'membresia';
  const socio_id   = Number(document.getElementById('cc-socio-id').value);
  const metodo_pago = document.querySelector('input[name="cc-metodo"]:checked')?.value;
  const errEl      = document.getElementById('cc-pago-error');
  const btn        = document.getElementById('cc-submit');

  errEl.classList.add('hidden');

  let payload;

  if (tipo === 'membresia') {
    const membresia_id = Number(document.getElementById('cc-membresia').value);
    const monto        = Number(document.getElementById('cc-monto').value);

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

    payload = {
      socio_id, membresia_id, monto, metodo_pago,
      usuario_id: currentUser?.id || null,
      tipo_cobro: 'Membresia',
      descripcion: null,
    };

  } else {
    const monto = Number(document.getElementById('cc-pase-monto').value);
    const dias  = Number(document.getElementById('cc-pase-dias').value) || 1;
    const desc  = document.getElementById('cc-pase-desc').value.trim();

    if (!monto || monto <= 0) {
      errEl.textContent = 'El monto debe ser mayor a $0.';
      errEl.classList.remove('hidden');
      return;
    }

    payload = {
      socio_id,
      membresia_id: 3,   // "Pase Diario" seed (id=3)
      monto, metodo_pago,
      usuario_id:           currentUser?.id || null,
      tipo_cobro:           'Pase',
      descripcion:          desc || null,
      duracion_dias_override: dias,
    };
  }

  btn.disabled = true;
  btn.textContent = 'Registrando...';

  const res = await window.api.invoke('registrar-pago', payload);

  btn.disabled = false;
  btn.textContent = 'Registrar Pago';

  if (res.success) {
    const nombre = ccSocioActual ? `${ccSocioActual.nombre} ${ccSocioActual.apellido}` : 'Socio';
    const msg = tipo === 'pase'
      ? `Pase de ${nombre} registrado. Válido hasta el ${formatDate(res.fecha_vencimiento)}`
      : `Pago de ${nombre} registrado. Vence el ${formatDate(res.fecha_vencimiento)}`;
    showToast(msg, 'success');
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
  document.getElementById('cc-section-membresia').classList.remove('hidden');
  document.getElementById('cc-section-pase').classList.add('hidden');
  ccSocioActual = null;
}

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
  if (res.success) showToast('Reporte Excel guardado correctamente', 'success');
  else showToast(`Error al generar el reporte: ${res.error}`, 'error');
}

async function crearBackup() {
  const btn = document.getElementById('btn-backup');
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  const res = await window.api.invoke('crear-backup');
  btn.disabled = false;
  btn.textContent = 'Crear Backup';
  if (res.canceled) return;
  if (res.success) showToast('Backup guardado correctamente', 'success');
  else showToast(`Error al crear el backup: ${res.error}`, 'error');
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
  btn.disabled = false;
  btn.textContent = 'Restaurar Base de Datos';
  if (!res.canceled && !res.success) showToast(`Error al restaurar: ${res.error}`, 'error');
}

// ── INVENTARIO ────────────────────────────────────────────────────────────
async function loadInventario() {
  const tbody = document.getElementById('inventario-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="text-center text-slate-400 py-12">Cargando...</td></tr>';

  const res = await window.api.invoke('obtener-articulos');
  if (!res.success) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="text-center text-red-500 py-12">Error al cargar</td></tr>';
    return;
  }

  articulosCache = res.articulos;
  if (!tbody) return;

  if (articulosCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-slate-400 py-12">Sin productos cargados</td></tr>';
    return;
  }

  tbody.innerHTML = articulosCache.map(a => `
    <tr class="border-t border-slate-50 hover:bg-slate-50 transition-colors">
      <td class="px-6 py-4 font-medium text-slate-800">${a.nombre}</td>
      <td class="px-6 py-4 text-slate-600">${formatCurrency(a.precio)}</td>
      <td class="px-6 py-4">
        <span class="px-2 py-0.5 text-xs rounded-full font-medium ${a.stock <= 5 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}">
          ${a.stock} u.
        </span>
      </td>
      <td class="px-6 py-4">
        <div class="flex gap-3">
          <button onclick="openArticuloModal(${a.id})"
                  class="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors">
            Editar
          </button>
          <button onclick="eliminarArticulo(${a.id}, '${a.nombre.replace(/'/g, "\\'")}')"
                  class="text-xs text-red-500 hover:text-red-700 font-medium transition-colors">
            Eliminar
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

document.getElementById('form-nuevo-articulo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = document.getElementById('art-nombre').value.trim();
  const precio = Number(document.getElementById('art-precio').value);
  const stock  = Number(document.getElementById('art-stock').value) || 0;
  const errEl  = document.getElementById('art-error');

  errEl.classList.add('hidden');

  if (!nombre) {
    errEl.textContent = 'El nombre es obligatorio.';
    errEl.classList.remove('hidden');
    return;
  }
  if (isNaN(precio) || precio < 0) {
    errEl.textContent = 'Ingresá un precio válido.';
    errEl.classList.remove('hidden');
    return;
  }

  const res = await window.api.invoke('crear-articulo', { nombre, precio, stock });
  if (res.success) {
    showToast(`Producto "${nombre}" agregado`, 'success');
    document.getElementById('form-nuevo-articulo').reset();
    document.getElementById('art-stock').value = '0';
    loadInventario();
  } else {
    errEl.textContent = res.error || 'Error al crear el producto.';
    errEl.classList.remove('hidden');
  }
});

function openArticuloModal(id) {
  const art = articulosCache.find(a => a.id === id);
  if (!art) return;

  document.getElementById('ea-id').value               = art.id;
  document.getElementById('ea-nombre').value           = art.nombre;
  document.getElementById('ea-precio').value           = art.precio;
  document.getElementById('ea-stock-add').value        = '';
  document.getElementById('ea-stock-actual').textContent = art.stock;
  document.getElementById('ea-error').classList.add('hidden');
  document.getElementById('modal-articulo').classList.remove('hidden');
}

function closeArticuloModal() {
  document.getElementById('modal-articulo').classList.add('hidden');
}

document.getElementById('form-editar-articulo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id       = Number(document.getElementById('ea-id').value);
  const nombre   = document.getElementById('ea-nombre').value.trim();
  const precio   = Number(document.getElementById('ea-precio').value);
  const stockAdd = Number(document.getElementById('ea-stock-add').value) || 0;
  const errEl    = document.getElementById('ea-error');

  errEl.classList.add('hidden');

  if (!nombre) {
    errEl.textContent = 'El nombre es obligatorio.';
    errEl.classList.remove('hidden');
    return;
  }
  if (isNaN(precio) || precio < 0) {
    errEl.textContent = 'Ingresá un precio válido.';
    errEl.classList.remove('hidden');
    return;
  }

  const res = await window.api.invoke('actualizar-articulo', {
    id, nombre, precio, stock_adicional: stockAdd > 0 ? stockAdd : null,
  });

  if (res.success) {
    showToast(`"${nombre}" actualizado`, 'success');
    closeArticuloModal();
    loadInventario();
  } else {
    errEl.textContent = res.error || 'Error al actualizar.';
    errEl.classList.remove('hidden');
  }
});

async function eliminarArticulo(id, nombre) {
  if (!window.confirm(`¿Dar de baja el producto "${nombre}"?\nNo se podrá vender más.`)) return;
  const res = await window.api.invoke('eliminar-articulo', id);
  if (res.success) {
    showToast(`"${nombre}" dado de baja`, 'info');
    loadInventario();
  } else {
    showToast(res.error || 'Error al eliminar', 'error');
  }
}

// ── PUNTO DE VENTA ────────────────────────────────────────────────────────
async function loadPuntoDeVenta() {
  const grid = document.getElementById('pos-grid');
  grid.innerHTML = '<p class="col-span-4 text-center text-slate-400 py-12">Cargando productos...</p>';

  const res = await window.api.invoke('obtener-articulos');
  if (!res.success) {
    grid.innerHTML = '<p class="col-span-4 text-center text-red-500 py-12">Error al cargar</p>';
    return;
  }

  articulosCache = res.articulos;
  const conStock = articulosCache.filter(a => a.stock > 0);

  if (conStock.length === 0) {
    grid.innerHTML = '<p class="col-span-4 text-center text-slate-400 py-16 text-sm">Sin productos con stock disponible</p>';
    return;
  }

  grid.innerHTML = conStock.map(a => `
    <button onclick="openPosModal(${a.id})"
            class="bg-white rounded-xl shadow-sm border border-slate-100 p-5 text-left hover:shadow-md hover:border-slate-200 active:scale-95 transition-all">
      <div class="w-10 h-10 rounded-lg mb-3 flex items-center justify-center"
           style="background-color: color-mix(in srgb, var(--color-primario) 15%, white)">
        <svg class="w-5 h-5" style="color: var(--color-primario)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>
        </svg>
      </div>
      <p class="font-semibold text-slate-800 leading-tight">${a.nombre}</p>
      <p class="text-lg font-bold mt-1" style="color: var(--color-primario)">${formatCurrency(a.precio)}</p>
      <p class="text-xs text-slate-400 mt-1">Stock: ${a.stock} u.</p>
    </button>
  `).join('');
}

function openPosModal(id) {
  const art = articulosCache.find(a => a.id === id);
  if (!art) return;
  posArticuloActual = art;

  document.getElementById('pos-modal-nombre').textContent = art.nombre;
  document.getElementById('pos-modal-precio').textContent = formatCurrency(art.precio);
  document.getElementById('pos-modal-stock').textContent  = `${art.stock} unidades`;
  document.getElementById('pos-cantidad').value = '1';
  document.getElementById('pos-cantidad').max   = String(art.stock);
  document.getElementById('pos-cobrar-btn').disabled = false;
  document.getElementById('pos-cobrar-btn').textContent = 'Cobrar';
  updatePosTotal();
  document.getElementById('modal-venta-pos').classList.remove('hidden');
}

function closePosModal() {
  document.getElementById('modal-venta-pos').classList.add('hidden');
  posArticuloActual = null;
}

function updatePosTotal() {
  if (!posArticuloActual) return;
  const cant  = Number(document.getElementById('pos-cantidad').value) || 0;
  document.getElementById('pos-total').textContent = formatCurrency(posArticuloActual.precio * cant);
}

async function confirmarVentaPos() {
  if (!posArticuloActual) return;
  const cantidad = Number(document.getElementById('pos-cantidad').value);
  const btn      = document.getElementById('pos-cobrar-btn');

  if (!cantidad || cantidad <= 0) { showToast('Ingresá una cantidad válida', 'error'); return; }
  if (cantidad > posArticuloActual.stock) { showToast('Cantidad supera el stock disponible', 'error'); return; }

  btn.disabled    = true;
  btn.textContent = 'Procesando...';

  const res = await window.api.invoke('registrar-venta-articulo', {
    articulo_id: posArticuloActual.id,
    cantidad,
    usuario_id: currentUser?.id || null,
  });

  btn.disabled    = false;
  btn.textContent = 'Cobrar';

  if (res.success) {
    showToast(
      `${cantidad} x ${posArticuloActual.nombre} — ${formatCurrency(res.total)}`,
      'success'
    );
    closePosModal();
    loadPuntoDeVenta();
  } else {
    showToast(res.error || 'Error al registrar la venta', 'error');
  }
}

// ── GASTOS ────────────────────────────────────────────────────────────────
async function loadGastos() {
  const tbody   = document.getElementById('gastos-tbody');
  const totalEl = document.getElementById('gastos-total-hoy');
  if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="text-center text-slate-400 py-12">Cargando...</td></tr>';

  const res = await window.api.invoke('obtener-egresos-hoy');
  if (!res.success) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="text-center text-red-500 py-12">Error al cargar</td></tr>';
    return;
  }

  const { egresos } = res;
  const total = egresos.reduce((s, g) => s + g.monto, 0);
  if (totalEl) totalEl.textContent = formatCurrency(total);

  if (!tbody) return;
  if (egresos.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-emerald-600 py-12 font-medium">Sin gastos registrados hoy</td></tr>';
    return;
  }

  tbody.innerHTML = egresos.map(g => `
    <tr class="border-t border-slate-50 hover:bg-slate-50 transition-colors">
      <td class="px-6 py-4 font-medium text-slate-800">${g.concepto}</td>
      <td class="px-6 py-4 font-semibold text-red-600">${formatCurrency(g.monto)}</td>
      <td class="px-6 py-4 text-slate-400 text-xs">${g.usuario_nombre}</td>
    </tr>
  `).join('');
}

document.getElementById('form-egreso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const concepto = document.getElementById('egr-concepto').value.trim();
  const monto    = Number(document.getElementById('egr-monto').value);
  const errEl    = document.getElementById('egr-error');

  errEl.classList.add('hidden');

  if (!concepto) {
    errEl.textContent = 'El concepto es obligatorio.';
    errEl.classList.remove('hidden');
    return;
  }
  if (!monto || monto <= 0) {
    errEl.textContent = 'El monto debe ser mayor a $0.';
    errEl.classList.remove('hidden');
    return;
  }

  const res = await window.api.invoke('registrar-egreso', {
    concepto, monto, usuario_id: currentUser?.id || null,
  });

  if (res.success) {
    showToast(`Gasto "${concepto}" registrado: ${formatCurrency(monto)}`, 'success');
    document.getElementById('form-egreso').reset();
    loadGastos();
  } else {
    errEl.textContent = res.error || 'Error al registrar el gasto.';
    errEl.classList.remove('hidden');
  }
});

// ── GESTIÓN DE MEMBRESÍAS (Configuración, solo admin) ─────────────────────
async function loadAndRenderMembresiasCfg() {
  const list = document.getElementById('membresias-cfg-list');
  if (!list) return;

  const res = await window.api.invoke('obtener-membresias');
  if (!res.success) return;

  membresiasCfgCache = res.membresias;

  if (membresiasCfgCache.length === 0) {
    list.innerHTML = '<p class="text-sm text-slate-400">No hay membresías activas.</p>';
    return;
  }

  list.innerHTML = membresiasCfgCache.map(m => `
    <div class="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
      <div>
        <p class="text-sm font-medium text-slate-800">${m.nombre}</p>
        <p class="text-xs text-slate-500">${m.duracion_dias} días · ${formatCurrency(m.precio)}</p>
      </div>
      <div class="flex gap-3">
        <button onclick="openMembresiaModal(${m.id})"
                class="text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors">
          Editar
        </button>
        <button onclick="eliminarMembresia(${m.id}, '${m.nombre.replace(/'/g, "\\'")}')"
                class="text-xs text-red-500 hover:text-red-700 font-medium transition-colors">
          Eliminar
        </button>
      </div>
    </div>
  `).join('');
}

function openMembresiaModal(id) {
  const m = membresiasCfgCache.find(x => x.id === id);
  if (!m) return;
  document.getElementById('em-id').value     = m.id;
  document.getElementById('em-nombre').value = m.nombre;
  document.getElementById('em-dias').value   = m.duracion_dias;
  document.getElementById('em-precio').value = m.precio;
  document.getElementById('em-error').classList.add('hidden');
  document.getElementById('modal-membresia').classList.remove('hidden');
}

function closeMembresiaModal() {
  document.getElementById('modal-membresia').classList.add('hidden');
}

document.getElementById('form-crear-membresia').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre       = document.getElementById('nm-nombre').value.trim();
  const duracion_dias = Number(document.getElementById('nm-dias').value);
  const precio       = Number(document.getElementById('nm-precio').value);
  const errEl        = document.getElementById('nm-error');

  errEl.classList.add('hidden');
  if (!nombre) { errEl.textContent = 'El nombre es obligatorio.'; errEl.classList.remove('hidden'); return; }
  if (!duracion_dias || duracion_dias <= 0) { errEl.textContent = 'Los días deben ser mayor a 0.'; errEl.classList.remove('hidden'); return; }
  if (isNaN(precio) || precio < 0) { errEl.textContent = 'Precio inválido.'; errEl.classList.remove('hidden'); return; }

  const res = await window.api.invoke('crear-membresia', { nombre, duracion_dias, precio });
  if (res.success) {
    showToast(`Membresía "${nombre}" creada`, 'success');
    document.getElementById('form-crear-membresia').reset();
    membresias = [];
    loadAndRenderMembresiasCfg();
  } else {
    errEl.textContent = res.error || 'Error al crear la membresía.';
    errEl.classList.remove('hidden');
  }
});

document.getElementById('form-editar-membresia').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id           = Number(document.getElementById('em-id').value);
  const nombre       = document.getElementById('em-nombre').value.trim();
  const duracion_dias = Number(document.getElementById('em-dias').value);
  const precio       = Number(document.getElementById('em-precio').value);
  const btn          = document.getElementById('em-submit');
  const errEl        = document.getElementById('em-error');

  errEl.classList.add('hidden');
  if (!nombre) { errEl.textContent = 'El nombre es obligatorio.'; errEl.classList.remove('hidden'); return; }
  if (!duracion_dias || duracion_dias <= 0) { errEl.textContent = 'Los días deben ser mayor a 0.'; errEl.classList.remove('hidden'); return; }
  if (isNaN(precio) || precio < 0) { errEl.textContent = 'Precio inválido.'; errEl.classList.remove('hidden'); return; }

  btn.disabled = true;
  btn.textContent = 'Guardando...';
  const res = await window.api.invoke('actualizar-membresia', { id, nombre, duracion_dias, precio });
  btn.disabled = false;
  btn.textContent = 'Guardar';

  if (res.success) {
    showToast(`Membresía "${nombre}" actualizada`, 'success');
    closeMembresiaModal();
    membresias = [];
    loadAndRenderMembresiasCfg();
  } else {
    errEl.textContent = res.error || 'Error al actualizar.';
    errEl.classList.remove('hidden');
  }
});

async function eliminarMembresia(id, nombre) {
  if (!window.confirm(`¿Dar de baja la membresía "${nombre}"?\nNo aparecerá más en el cobrador; el historial se preserva.`)) return;
  const res = await window.api.invoke('eliminar-membresia', id);
  if (res.success) {
    showToast(`Membresía "${nombre}" dada de baja`, 'info');
    membresias = [];
    loadAndRenderMembresiasCfg();
  } else {
    showToast(res.error || 'Error al eliminar', 'error');
  }
}

// ── GRUPOS FAMILIARES ─────────────────────────────────────────────────────
async function loadGrupos() {
  const listEl = document.getElementById('grupos-list');
  if (listEl) listEl.innerHTML = '<p class="text-sm text-slate-400 p-5">Cargando...</p>';

  const res = await window.api.invoke('obtener-grupos');
  if (!res.success) {
    if (listEl) listEl.innerHTML = '<p class="text-sm text-red-500 p-5">Error al cargar</p>';
    return;
  }

  gruposCache = res.grupos;
  renderGruposList();
}

function renderGruposList() {
  const listEl = document.getElementById('grupos-list');
  if (!listEl) return;

  if (gruposCache.length === 0) {
    listEl.innerHTML = '<p class="text-sm text-slate-400 p-5">No hay grupos creados aún.</p>';
    return;
  }

  listEl.innerHTML = gruposCache.map(g => `
    <button onclick="seleccionarGrupo(${g.id})"
            class="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors text-left ${grupoSeleccionado === g.id ? 'bg-violet-50' : ''}">
      <div>
        <p class="text-sm font-medium text-slate-800">${g.nombre}</p>
        <p class="text-xs text-slate-400">${g.miembros.length} miembro${g.miembros.length !== 1 ? 's' : ''}</p>
      </div>
      <svg class="w-4 h-4 text-slate-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
      </svg>
    </button>
  `).join('');
}

function seleccionarGrupo(id) {
  grupoSeleccionado = id;
  renderGruposList();
  renderGrupoDetail(id);
}

function renderGrupoDetail(id) {
  const grupo  = gruposCache.find(g => g.id === id);
  const panel  = document.getElementById('grupo-detail-panel');
  if (!grupo || !panel) return;

  const miembrosHtml = grupo.miembros.length > 0
    ? grupo.miembros.map(m => `
        <div class="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
          <div>
            <p class="text-sm font-medium text-slate-800">${m.nombre} ${m.apellido}</p>
            <p class="text-xs text-slate-500">DNI: ${m.dni}</p>
          </div>
          <button onclick="quitarSocioDeGrupo(${m.id}, '${(m.nombre + ' ' + m.apellido).replace(/'/g, "\\'")}')"
                  class="text-xs text-red-500 hover:text-red-700 font-medium transition-colors">
            Quitar
          </button>
        </div>
      `).join('')
    : '<p class="text-sm text-slate-400 py-4 text-center">Sin miembros en este grupo.</p>';

  panel.innerHTML = `
    <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-lg font-semibold text-slate-800">${grupo.nombre}</h2>
        <button onclick="eliminarGrupo(${grupo.id})"
                class="text-xs text-red-500 hover:text-red-700 font-medium transition-colors">
          Eliminar grupo
        </button>
      </div>

      <div class="space-y-2 mb-5">
        <p class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Miembros</p>
        ${miembrosHtml}
      </div>

      <div class="border-t border-slate-100 pt-4">
        <p class="text-sm font-medium text-slate-700 mb-3">Agregar socio al grupo</p>
        <div class="flex gap-2">
          <input type="text" id="grp-dni-buscar" class="form-input flex-1" placeholder="DNI del socio"
                 maxlength="8" onkeydown="if(event.key==='Enter') buscarSocioParaGrupo()" />
          <button onclick="buscarSocioParaGrupo()" class="btn-primary">Buscar</button>
        </div>
        <div id="grp-buscar-resultado" class="mt-3"></div>
      </div>
    </div>
  `;
}

async function buscarSocioParaGrupo() {
  const dni     = document.getElementById('grp-dni-buscar')?.value?.trim();
  const resultEl = document.getElementById('grp-buscar-resultado');
  if (!dni || !resultEl) return;

  resultEl.innerHTML = '<p class="text-xs text-slate-400">Buscando...</p>';

  const res = await window.api.invoke('buscar-socio-admin', dni);
  if (!res.success) {
    resultEl.innerHTML = `<p class="text-xs text-red-500">${res.error || 'Socio no encontrado'}</p>`;
    return;
  }

  const s = res.socio;
  const yaEnEsteGrupo   = s.grupo_id === grupoSeleccionado;
  const tieneOtroGrupo  = s.grupo_id && s.grupo_id !== grupoSeleccionado;

  resultEl.innerHTML = `
    <div class="p-3 bg-slate-50 rounded-lg border border-slate-200">
      <p class="text-sm font-medium text-slate-800">${s.nombre} ${s.apellido}</p>
      <p class="text-xs text-slate-500 mt-0.5">DNI: ${s.dni}${tieneOtroGrupo ? ` · Ya en grupo: ${s.grupo_nombre}` : ''}</p>
      ${!yaEnEsteGrupo ? `
        <button onclick="agregarSocioAlGrupo(${s.id}, '${(s.nombre + ' ' + s.apellido).replace(/'/g, "\\'")}')"
                class="mt-3 btn-primary text-xs px-3 py-1.5">
          Agregar al grupo
        </button>
      ` : '<p class="text-xs text-emerald-600 mt-2 font-medium">Ya es miembro de este grupo</p>'}
    </div>
  `;
}

async function agregarSocioAlGrupo(socio_id, nombre) {
  const res = await window.api.invoke('actualizar-grupo-socio', { socio_id, grupo_id: grupoSeleccionado });
  if (res.success) {
    showToast(`${nombre} agregado al grupo`, 'success');
    await loadGrupos();
    if (grupoSeleccionado) renderGrupoDetail(grupoSeleccionado);
    const resultEl = document.getElementById('grp-buscar-resultado');
    if (resultEl) resultEl.innerHTML = '';
    const dniEl = document.getElementById('grp-dni-buscar');
    if (dniEl) dniEl.value = '';
  } else {
    showToast(res.error || 'Error al agregar', 'error');
  }
}

async function quitarSocioDeGrupo(socio_id, nombre) {
  if (!window.confirm(`¿Quitar a "${nombre}" del grupo?`)) return;
  const res = await window.api.invoke('actualizar-grupo-socio', { socio_id, grupo_id: null });
  if (res.success) {
    showToast(`${nombre} quitado del grupo`, 'info');
    await loadGrupos();
    if (grupoSeleccionado) renderGrupoDetail(grupoSeleccionado);
  } else {
    showToast(res.error || 'Error al quitar', 'error');
  }
}

async function eliminarGrupo(id) {
  const grupo  = gruposCache.find(g => g.id === id);
  const nombre = grupo?.nombre || 'este grupo';
  if (!window.confirm(`¿Eliminar el grupo "${nombre}"?\nLos miembros quedarán sin grupo asignado.`)) return;

  const res = await window.api.invoke('eliminar-grupo', id);
  if (res.success) {
    showToast(`Grupo "${nombre}" eliminado`, 'info');
    grupoSeleccionado = null;
    const panel = document.getElementById('grupo-detail-panel');
    if (panel) panel.innerHTML = `
      <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
        <p class="text-slate-400 text-sm text-center py-8">Seleccioná un grupo para ver sus miembros</p>
      </div>
    `;
    loadGrupos();
  } else {
    showToast(res.error || 'Error al eliminar el grupo', 'error');
  }
}

document.getElementById('form-crear-grupo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = document.getElementById('grp-nombre').value.trim();
  const errEl  = document.getElementById('grp-error');

  errEl.classList.add('hidden');
  if (!nombre) {
    errEl.textContent = 'El nombre del grupo es obligatorio.';
    errEl.classList.remove('hidden');
    return;
  }

  const res = await window.api.invoke('crear-grupo', { nombre });
  if (res.success) {
    showToast(`Grupo "${nombre}" creado`, 'success');
    document.getElementById('form-crear-grupo').reset();
    loadGrupos();
  } else {
    errEl.textContent = res.error || 'Error al crear el grupo.';
    errEl.classList.remove('hidden');
  }
});

// ── Inicialización (pre-login) ────────────────────────────────────────────
(async function preInit() {
  // Cargar config para aplicar el tema al login screen y al sidebar
  await loadConfig();
  // La pantalla de login ya está visible desde el HTML; el main-layout está oculto.
})();
