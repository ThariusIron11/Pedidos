// ================== Pestaña: Config ==================
// Catálogo editable de "Tipos de equipo" sobre Firestore (colección "tipos_equipo").
// Otras pestañas (Equipos) leen este catálogo desde window.tiposEquipoCache
// y se suscriben al evento 'tipos-equipo:cambio' para reaccionar en vivo.
//
// Cada tipo: { nombre, icono (emoji), logoUrl (imagen en base64, opcional), color (hex '#rrggbb') }

// Helper compartido: dado un tipo de equipo, devuelve el HTML de su
// ícono/logo para usar en CUALQUIER contexto HTML (tarjetas, badges,
// tablas) — si el tipo tiene logoUrl se pinta como <img>, si no cae al
// emoji de siempre. NO usar en contextos de solo texto (input.value,
// <option>, texto de un buscador armado a mano): ahí una <img> no sirve,
// así que esos sitios siguen usando tipo.icono directo como hasta ahora.
window.iconoTipoHtml = function (tipo, iconoRespaldo) {
  if (tipo?.logoUrl) {
    return `<img src="${tipo.logoUrl}" class="tipo-logo-img" alt="">`;
  }
  const icono = tipo?.icono || iconoRespaldo || '';
  return icono ? String(icono).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) : '';
};

(function () {
  const COLECCION = 'tipos_equipo';

  // Un logo se guarda como dataURL dentro del documento del tipo (no hay
  // Firebase Storage configurado en este proyecto), así que se redimensiona
  // agresivo a 96x96 antes de guardar — de sobra para un ícono, y liviano
  // para Firestore (límite de 1 MiB por documento).
  const LOGO_MAX_PX = 96;

  function archivoALogoDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('No se pudo leer la imagen'));
        img.onload = () => {
          // Redimensiona manteniendo proporción dentro de un cuadro de
          // LOGO_MAX_PX x LOGO_MAX_PX, sin recortar ni deformar.
          const escala = Math.min(LOGO_MAX_PX / img.width, LOGO_MAX_PX / img.height, 1);
          const w = Math.max(1, Math.round(img.width * escala));
          const h = Math.max(1, Math.round(img.height * escala));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          // PNG conserva transparencia (típico en logos); si el archivo
          // original era JPG no hay problema, igual se recodifica a PNG.
          resolve(canvas.toDataURL('image/png'));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  const DEFAULTS = [
    { nombre: 'Motor',                icono: '⚡', color: '#c1662f' },
    { nombre: 'Reductor',             icono: '⚙️', color: '#2f6f8a' },
    { nombre: 'Motoreductor',         icono: '🔧', color: '#2e7d32' },
    { nombre: 'Piezas de Acople',     icono: '🔗', color: '#6a1b9a' },
    { nombre: 'Motovibrador',         icono: '📳', color: '#ad1457' },
    { nombre: 'Brazo de reacción',    icono: '🦾', color: '#5d4037' },
    { nombre: 'Eje sólido',           icono: '🔩', color: '#455a64' },
    { nombre: 'Motor ZD',             icono: '⚡', color: '#e65100' },
    { nombre: 'Reductor ZD',          icono: '⚙️', color: '#00695c' },
    { nombre: 'Motoreductor ZD',      icono: '🔧', color: '#33691e' },
    { nombre: 'Sprocket',             icono: '⭕', color: '#00838f' },
    { nombre: 'Caja de cadena',       icono: '📦', color: '#7b5e00' }
  ];

  const tablaBody  = document.getElementById('tabla-tipos-body');
  const tablaEmpty = document.getElementById('tipos-empty');
  const modal       = document.getElementById('modal-tipo');
  const modalTitulo = document.getElementById('modal-tipo-titulo');
  const form         = document.getElementById('form-tipo');

  const inputId     = document.getElementById('tipo-id');
  const inputNombre = document.getElementById('tipo-nombre');
  const inputIcono  = document.getElementById('tipo-icono');
  const inputColor  = document.getElementById('tipo-color');

  const inputLogoFile   = document.getElementById('tipo-logo-input');
  const inputLogoUrl    = document.getElementById('tipo-logo-url'); // hidden: guarda el dataURL vigente (o vacío)
  const logoPreview      = document.getElementById('tipo-logo-preview');
  const logoVacioTexto   = document.getElementById('tipo-logo-vacio');
  const btnQuitarLogo    = document.getElementById('btn-quitar-logo-tipo');

  window.tiposEquipoCache = []; // expuesto globalmente para otras pestañas
  let borradorId = null;
  let seedIntentado = false;

  // ---------- Helpers ----------

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function difundirCambio() {
    document.dispatchEvent(new CustomEvent('tipos-equipo:cambio', {
      detail: { tipos: window.tiposEquipoCache }
    }));
  }

  // Refleja el valor actual de inputLogoUrl (dataURL o vacío) en la vista
  // previa del formulario: imagen + botón "Quitar", o el texto "Sin logo".
  function refrescarPreviewLogo() {
    const url = inputLogoUrl.value;
    logoPreview.src = url || '';
    logoPreview.style.display = url ? '' : 'none';
    logoVacioTexto.style.display = url ? 'none' : '';
    btnQuitarLogo.style.display = url ? '' : 'none';
  }

  inputLogoFile.addEventListener('change', async () => {
    const file = inputLogoFile.files?.[0];
    if (!file) return;
    try {
      inputLogoUrl.value = await archivoALogoDataUrl(file);
      refrescarPreviewLogo();
    } catch (err) {
      console.error('Error procesando el logo:', err);
      alert('No se pudo procesar esa imagen. Intenta con otro archivo.');
    } finally {
      inputLogoFile.value = '';
    }
  });

  btnQuitarLogo.addEventListener('click', () => {
    inputLogoUrl.value = '';
    refrescarPreviewLogo();
  });

  // ---------- Semilla inicial (solo si la colección está vacía) ----------

  async function sembrarTiposPorDefecto() {
    if (seedIntentado) return;
    seedIntentado = true;
    try {
      const snap = await db.collection(COLECCION).limit(1).get();
      if (!snap.empty) return; // ya hay datos, no se siembra
      const batch = db.batch();
      DEFAULTS.forEach(tipo => {
        const ref = db.collection(COLECCION).doc();
        batch.set(ref, tipo);
      });
      await batch.commit();
    } catch (err) {
      console.error('Error sembrando tipos de equipo por defecto:', err);
    }
  }

  // ---------- Modal ----------

  function cargarFormularioDesdeTipo(tipo) {
    form.reset();
    inputId.value = tipo ? tipo.id : '';
    inputNombre.value = tipo?.nombre || '';
    inputIcono.value = tipo?.icono || '';
    inputColor.value = tipo?.color || '#c1662f';
    inputLogoUrl.value = tipo?.logoUrl || '';
    refrescarPreviewLogo();
  }

  function abrirModalNuevo() {
    if (borradorId === '') {
      modalTitulo.textContent = 'Nuevo tipo de equipo';
      modal.classList.add('open');
      inputNombre.focus();
      return;
    }
    modalTitulo.textContent = 'Nuevo tipo de equipo';
    cargarFormularioDesdeTipo(null);
    borradorId = '';
    modal.classList.add('open');
    inputNombre.focus();
  }

  function abrirModalEditar(tipo) {
    if (borradorId === tipo.id) {
      modalTitulo.textContent = 'Editar tipo de equipo';
      modal.classList.add('open');
      inputNombre.focus();
      return;
    }
    modalTitulo.textContent = 'Editar tipo de equipo';
    cargarFormularioDesdeTipo(tipo);
    borradorId = tipo.id;
    modal.classList.add('open');
    inputNombre.focus();
  }

  function cerrarModalConservandoBorrador() {
    modal.classList.remove('open');
  }

  function cancelarYLimpiar() {
    form.reset();
    inputLogoUrl.value = '';
    refrescarPreviewLogo();
    borradorId = null;
    modal.classList.remove('open');
  }

  document.getElementById('btn-nuevo-tipo').addEventListener('click', abrirModalNuevo);
  document.getElementById('btn-cancelar-tipo').addEventListener('click', cancelarYLimpiar);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModalConservandoBorrador();
  });

  // ---------- Guardar (crear/editar) ----------

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const datos = {
      nombre: inputNombre.value.trim(),
      icono: inputIcono.value.trim(),
      logoUrl: inputLogoUrl.value || null,
      color: inputColor.value
    };

    if (!datos.nombre) {
      inputNombre.focus();
      return;
    }

    const id = inputId.value;
    const btnGuardar = form.querySelector('button[type="submit"]');
    btnGuardar.disabled = true;
    btnGuardar.textContent = 'Guardando...';

    try {
      if (id) {
        await db.collection(COLECCION).doc(id).update(datos);
      } else {
        await db.collection(COLECCION).add(datos);
      }
      form.reset();
      inputLogoUrl.value = '';
      refrescarPreviewLogo();
      borradorId = null;
      modal.classList.remove('open');
    } catch (err) {
      console.error('Error guardando tipo de equipo:', err);
      alert('No se pudo guardar el tipo de equipo. Revisa la consola.');
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = 'Guardar';
    }
  });

  // ---------- Eliminar ----------

  async function eliminarTipo(tipo) {
    const ok = confirm(`¿Eliminar el tipo "${tipo.nombre}"? Los equipos que ya lo usan quedarán con un tipo inválido.`);
    if (!ok) return;
    try {
      await db.collection(COLECCION).doc(tipo.id).delete();
    } catch (err) {
      console.error('Error eliminando tipo de equipo:', err);
      alert('No se pudo eliminar el tipo de equipo. Revisa la consola.');
    }
  }

  // ---------- Render de la tabla ----------

  function renderTabla() {
    if (!window.tiposEquipoCache.length) {
      tablaBody.innerHTML = '';
      tablaEmpty.style.display = 'block';
      return;
    }
    tablaEmpty.style.display = 'none';

    tablaBody.innerHTML = window.tiposEquipoCache.map(tipo => `
      <tr data-id="${tipo.id}">
        <td>
          <span class="tipo-badge" style="border-color:${tipo.color}; color:${tipo.color}; background:${tipo.color}22;">
            ${window.iconoTipoHtml(tipo)}
          </span>
        </td>
        <td>${escapeHtml(tipo.nombre)}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn-editar" data-id="${tipo.id}">Editar</button>
            <button type="button" class="btn-eliminar danger" data-id="${tipo.id}">Eliminar</button>
          </div>
        </td>
      </tr>
    `).join('');

    tablaBody.querySelectorAll('.btn-editar').forEach(btn => {
      btn.addEventListener('click', () => {
        const tipo = window.tiposEquipoCache.find(t => t.id === btn.dataset.id);
        if (tipo) abrirModalEditar(tipo);
      });
    });
    tablaBody.querySelectorAll('.btn-eliminar').forEach(btn => {
      btn.addEventListener('click', () => {
        const tipo = window.tiposEquipoCache.find(t => t.id === btn.dataset.id);
        if (tipo) eliminarTipo(tipo);
      });
    });
  }

  // ---------- Suscripción en tiempo real ----------
  // Arranca de inmediato (no solo al entrar a la pestaña Config), porque
  // Equipos depende de este catálogo para su selector y su filtro.

  db.collection(COLECCION).orderBy('nombre').onSnapshot(
    (snapshot) => {
      window.tiposEquipoCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderTabla();
      difundirCambio();
    },
    (err) => {
      console.error('Error escuchando tipos de equipo:', err);
    }
  );

  sembrarTiposPorDefecto();
})();

// ================== Sección: Empresas de envío ==================
// CRUD de empresas de envío sobre Firestore (colección "empresas_envio").
// La opción "Interno" NO vive aquí — es una bandera especial que maneja
// directamente pedidos.js/envios.js, sin necesidad de configurarla.
//
// Cada empresa: { nombre, daRecibo (boolean) }

(function () {
  const COLECCION = 'empresas_envio';

  const tablaBody  = document.getElementById('tabla-empresas-envio-body');
  const tablaEmpty = document.getElementById('empresas-envio-empty');
  const modal       = document.getElementById('modal-empresa-envio');
  const modalTitulo = document.getElementById('modal-empresa-envio-titulo');
  const form         = document.getElementById('form-empresa-envio');

  const inputId       = document.getElementById('empresa-envio-id');
  const inputNombre   = document.getElementById('empresa-envio-nombre');
  const inputDaRecibo = document.getElementById('empresa-envio-da-recibo');

  window.empresasEnvioCache = []; // expuesto globalmente para Pedidos/Envíos
  let borradorId = null;

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function difundirCambio() {
    document.dispatchEvent(new CustomEvent('empresas-envio:cambio', {
      detail: { empresas: window.empresasEnvioCache }
    }));
  }

  function cargarFormularioDesdeEmpresa(empresa) {
    form.reset();
    inputId.value = empresa ? empresa.id : '';
    inputNombre.value = empresa?.nombre || '';
    inputDaRecibo.checked = !!empresa?.daRecibo;
  }

  function abrirModalNuevo() {
    if (borradorId === '') {
      modalTitulo.textContent = 'Nueva empresa de envío';
      modal.classList.add('open');
      inputNombre.focus();
      return;
    }
    modalTitulo.textContent = 'Nueva empresa de envío';
    cargarFormularioDesdeEmpresa(null);
    borradorId = '';
    modal.classList.add('open');
    inputNombre.focus();
  }

  function abrirModalEditar(empresa) {
    if (borradorId === empresa.id) {
      modalTitulo.textContent = 'Editar empresa de envío';
      modal.classList.add('open');
      inputNombre.focus();
      return;
    }
    modalTitulo.textContent = 'Editar empresa de envío';
    cargarFormularioDesdeEmpresa(empresa);
    borradorId = empresa.id;
    modal.classList.add('open');
    inputNombre.focus();
  }

  function cerrarModalConservandoBorrador() {
    modal.classList.remove('open');
  }

  function cancelarYLimpiar() {
    form.reset();
    borradorId = null;
    modal.classList.remove('open');
  }

  document.getElementById('btn-nueva-empresa-envio').addEventListener('click', abrirModalNuevo);
  document.getElementById('btn-cancelar-empresa-envio').addEventListener('click', cancelarYLimpiar);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModalConservandoBorrador();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const datos = {
      nombre: inputNombre.value.trim(),
      daRecibo: inputDaRecibo.checked
    };

    if (!datos.nombre) {
      inputNombre.focus();
      return;
    }

    const id = inputId.value;
    const btnGuardar = form.querySelector('button[type="submit"]');
    btnGuardar.disabled = true;
    btnGuardar.textContent = 'Guardando...';

    try {
      if (id) {
        await db.collection(COLECCION).doc(id).update(datos);
      } else {
        await db.collection(COLECCION).add(datos);
      }
      form.reset();
      borradorId = null;
      modal.classList.remove('open');
    } catch (err) {
      console.error('Error guardando empresa de envío:', err);
      alert('No se pudo guardar la empresa de envío. Revisa la consola.');
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = 'Guardar';
    }
  });

  async function eliminarEmpresa(empresa) {
    const ok = confirm(`¿Eliminar "${empresa.nombre}"? Los envíos ya registrados con ella conservan su nombre guardado.`);
    if (!ok) return;
    try {
      await db.collection(COLECCION).doc(empresa.id).delete();
    } catch (err) {
      console.error('Error eliminando empresa de envío:', err);
      alert('No se pudo eliminar la empresa de envío. Revisa la consola.');
    }
  }

  function renderTabla() {
    if (!window.empresasEnvioCache.length) {
      tablaBody.innerHTML = '';
      tablaEmpty.style.display = 'block';
      return;
    }
    tablaEmpty.style.display = 'none';

    tablaBody.innerHTML = window.empresasEnvioCache.map(empresa => `
      <tr data-id="${empresa.id}">
        <td>${escapeHtml(empresa.nombre)}</td>
        <td>${empresa.daRecibo ? '✅ Sí' : '— No'}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn-editar" data-id="${empresa.id}">Editar</button>
            <button type="button" class="btn-eliminar danger" data-id="${empresa.id}">Eliminar</button>
          </div>
        </td>
      </tr>
    `).join('');

    tablaBody.querySelectorAll('.btn-editar').forEach(btn => {
      btn.addEventListener('click', () => {
        const empresa = window.empresasEnvioCache.find(e => e.id === btn.dataset.id);
        if (empresa) abrirModalEditar(empresa);
      });
    });
    tablaBody.querySelectorAll('.btn-eliminar').forEach(btn => {
      btn.addEventListener('click', () => {
        const empresa = window.empresasEnvioCache.find(e => e.id === btn.dataset.id);
        if (empresa) eliminarEmpresa(empresa);
      });
    });
  }

  // Arranca de inmediato (no solo al entrar a Config), porque Pedidos/Envíos
  // dependen de este catálogo para elegir quién se encarga del envío.
  db.collection(COLECCION).orderBy('nombre').onSnapshot(
    (snapshot) => {
      window.empresasEnvioCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderTabla();
      difundirCambio();
    },
    (err) => {
      console.error('Error escuchando empresas de envío:', err);
    }
  );
})();
