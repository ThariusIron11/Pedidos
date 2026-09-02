// ================== Pestaña: Equipos ==================
// Catálogo de tipos/referencias de equipos sobre Firestore (colección "equipos").
// Sin manejo de stock por ahora (posible futuro).
//
// Cada equipo:
// {
//   nombre, tipoId (referencia a un doc de "tipos_equipo", ver config.js),
//   variante, peso (número o null), usaSerial (boolean)
// }
//
// El catálogo de tipos vive en config.js (window.tiposEquipoCache) y se
// escucha vía el evento 'tipos-equipo:cambio' para mantenerse sincronizado.
//
// Mismo comportamiento de modal que Clientes/Equipos: backdrop conserva el
// borrador, Cancelar limpia todo, y reabrir retoma el borrador si sigue vigente.

(function () {
  const COLECCION = 'equipos';
  const TIPOS_CON_ALERTA_PESO = ['motor', 'reductor']; // comparación en minúsculas

  const tablaBody  = document.getElementById('tabla-equipos-body');
  const tablaEmpty = document.getElementById('equipos-empty');
  const modal       = document.getElementById('modal-equipo');
  const modalTitulo = document.getElementById('modal-equipo-titulo');
  const form         = document.getElementById('form-equipo');
  const buscador      = document.getElementById('buscador-equipos');
  const filtroTipoSelect = document.getElementById('filtro-tipo-equipos');

  const inputId       = document.getElementById('equipo-id');
  const inputNombre   = document.getElementById('equipo-nombre');
  const inputTipo     = document.getElementById('equipo-tipo');
  const inputVariante = document.getElementById('equipo-variante');
  const inputPeso     = document.getElementById('equipo-peso');
  const inputUsaSerial = document.getElementById('equipo-usa-serial');
  const grupoBrazoEje = document.getElementById('grupo-brazo-eje');
  const inputLlevaBrazo = document.getElementById('equipo-lleva-brazo');
  const inputLlevaEje = document.getElementById('equipo-lleva-eje');

  const TIPOS_CON_BRAZO_EJE = ['reductor', 'motoreductor'];

  let equiposCache = []; // [{id, ...datos}] — también expuesto en window.equiposCache
  let filtroTexto = '';
  let filtroTipoId = '';
  let borradorId = null;

  // ---------- Helpers ----------

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function normalizar(str) {
    return String(str ?? '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function formatearPeso(peso) {
    if (peso === undefined || peso === null || peso === '') return 'Sin peso';
    return `${peso} kg`;
  }

  function buscarTipo(tipoId) {
    return (window.tiposEquipoCache || []).find(t => t.id === tipoId) || null;
  }

  // ---------- Sincronizar selects (modal y filtro) con el catálogo de tipos ----------

  function poblarSelectsDeTipo() {
    const tipos = window.tiposEquipoCache || [];

    const tipoActualModal = inputTipo.value;
    inputTipo.innerHTML = '<option value="">Selecciona un tipo...</option>' +
      tipos.map(t => `<option value="${t.id}">${t.icono ? t.icono + ' ' : ''}${escapeHtml(t.nombre)}</option>`).join('');
    if (tipoActualModal) inputTipo.value = tipoActualModal;

    const tipoActualFiltro = filtroTipoSelect.value;
    filtroTipoSelect.innerHTML = '<option value="">Todos los tipos</option>' +
      tipos.map(t => `<option value="${t.id}">${t.icono ? t.icono + ' ' : ''}${escapeHtml(t.nombre)}</option>`).join('');
    filtroTipoSelect.value = tipoActualFiltro;
  }

  document.addEventListener('tipos-equipo:cambio', () => {
    poblarSelectsDeTipo();
    renderTabla(); // los badges de tipo pueden haber cambiado de nombre/color
  });
  // Por si config.js ya recibió datos antes de que este script termine de cargar.
  if (window.tiposEquipoCache && window.tiposEquipoCache.length) {
    poblarSelectsDeTipo();
  }

  const TIPOS_CON_SERIAL_POR_DEFECTO = ['motor', 'reductor', 'motovibrador'];

  function actualizarVisibilidadBrazoEje() {
    const tipo = buscarTipo(inputTipo.value);
    const aplica = tipo && TIPOS_CON_BRAZO_EJE.includes(normalizar(tipo.nombre));
    grupoBrazoEje.style.display = aplica ? 'block' : 'none';
    if (!aplica) {
      inputLlevaBrazo.checked = false;
      inputLlevaEje.checked = false;
    }
  }

  inputTipo.addEventListener('change', () => {
    // Solo sugiere el valor por defecto al CREAR un equipo nuevo; al editar uno
    // existente se respeta lo que ya tenía guardado.
    if (!inputId.value) {
      const tipo = buscarTipo(inputTipo.value);
      if (tipo) inputUsaSerial.checked = TIPOS_CON_SERIAL_POR_DEFECTO.includes(normalizar(tipo.nombre));
    }
    actualizarVisibilidadBrazoEje();
  });

  // ---------- Cargar / limpiar formulario ----------

  function cargarFormularioDesdeEquipo(equipo) {
    form.reset();
    inputId.value = equipo ? equipo.id : '';
    inputNombre.value = equipo?.nombre || '';
    inputTipo.value = equipo?.tipoId || '';
    inputVariante.value = equipo?.variante || '';
    inputPeso.value = (equipo?.peso ?? '') === '' ? '' : String(equipo.peso);
    inputUsaSerial.checked = !!equipo?.usaSerial;
    inputLlevaBrazo.checked = !!equipo?.puedeLlevarBrazo;
    inputLlevaEje.checked = !!equipo?.puedeLlevarEjeSolido;
    actualizarVisibilidadBrazoEje();
  }

  // ---------- Abrir / cerrar modal ----------

  function abrirModalNuevo() {
    if (borradorId === '') {
      modalTitulo.textContent = 'Nuevo equipo';
      modal.classList.add('open');
      inputNombre.focus();
      return;
    }
    modalTitulo.textContent = 'Nuevo equipo';
    cargarFormularioDesdeEquipo(null);
    borradorId = '';
    modal.classList.add('open');
    inputNombre.focus();
  }

  function abrirModalEditar(equipo) {
    if (borradorId === equipo.id) {
      modalTitulo.textContent = 'Editar equipo';
      modal.classList.add('open');
      inputNombre.focus();
      return;
    }
    modalTitulo.textContent = 'Editar equipo';
    cargarFormularioDesdeEquipo(equipo);
    borradorId = equipo.id;
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

  document.getElementById('btn-nuevo-equipo').addEventListener('click', abrirModalNuevo);
  document.getElementById('btn-cancelar-equipo').addEventListener('click', cancelarYLimpiar);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModalConservandoBorrador();
  });

  // ---------- Guardar (crear/editar) ----------

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const pesoTexto = inputPeso.value.trim().replace(',', '.');
    const peso = pesoTexto === '' ? null : parseFloat(pesoTexto);

    const datos = {
      nombre: inputNombre.value.trim(),
      tipoId: inputTipo.value,
      variante: inputVariante.value.trim(),
      peso: (peso === null || isNaN(peso)) ? null : peso,
      usaSerial: inputUsaSerial.checked,
      puedeLlevarBrazo: inputLlevaBrazo.checked,
      puedeLlevarEjeSolido: inputLlevaEje.checked
    };

    if (!datos.nombre) {
      inputNombre.focus();
      return;
    }
    if (!datos.tipoId) {
      inputTipo.focus();
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
        datos.creadoEn = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection(COLECCION).add(datos);
      }
      form.reset();
      borradorId = null;
      modal.classList.remove('open');
    } catch (err) {
      console.error('Error guardando equipo:', err);
      alert('No se pudo guardar el equipo. Revisa la consola.');
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = 'Guardar';
    }
  });

  // ---------- Eliminar ----------

  async function eliminarEquipo(equipo) {
    const ok = confirm(`¿Eliminar "${equipo.nombre}"? Esta acción no se puede deshacer.`);
    if (!ok) return;
    try {
      await db.collection(COLECCION).doc(equipo.id).delete();
    } catch (err) {
      console.error('Error eliminando equipo:', err);
      alert('No se pudo eliminar el equipo. Revisa la consola.');
    }
  }

  // ---------- Buscador + filtro por tipo ----------

  buscador.addEventListener('input', () => {
    filtroTexto = normalizar(buscador.value.trim());
    renderTabla();
  });

  filtroTipoSelect.addEventListener('change', () => {
    filtroTipoId = filtroTipoSelect.value;
    renderTabla();
  });

  function equipoCoincideConFiltros(equipo) {
    if (filtroTipoId && equipo.tipoId !== filtroTipoId) return false;
    if (filtroTexto && !normalizar(equipo.nombre).includes(filtroTexto)) return false;
    return true;
  }

  // ---------- Render de la tabla ----------

  function renderTabla() {
    const listaFiltrada = equiposCache.filter(equipoCoincideConFiltros);

    if (!listaFiltrada.length) {
      tablaBody.innerHTML = '';
      tablaEmpty.style.display = 'block';
      tablaEmpty.textContent = equiposCache.length
        ? 'Ningún equipo coincide con la búsqueda/filtro.'
        : 'Todavía no hay equipos registrados.';
      return;
    }
    tablaEmpty.style.display = 'none';

    tablaBody.innerHTML = listaFiltrada.map(equipo => {
      const tipo = buscarTipo(equipo.tipoId);
      const tipoBadge = tipo
        ? `<span class="tipo-badge" style="border-color:${tipo.color}; color:${tipo.color}; background:${tipo.color}22;">${tipo.icono ? tipo.icono + ' ' : ''}${escapeHtml(tipo.nombre)}</span>`
        : '<span style="color:var(--danger); font-size:12px;">Tipo no encontrado</span>';

      const varianteHtml = equipo.variante
        ? `<span class="tag-variante">${escapeHtml(equipo.variante)}</span>`
        : '<span style="color:var(--ink-soft);">—</span>';

      const nombreEsAlertaPeso = tipo && TIPOS_CON_ALERTA_PESO.includes(normalizar(tipo.nombre));
      const faltaPeso = nombreEsAlertaPeso && (equipo.peso === null || equipo.peso === undefined);
      const faltaPesoTag = faltaPeso ? ' <span class="tag-falta-peso">⚖️ Falta peso</span>' : '';

      const extrasHtml = [
        equipo.puedeLlevarBrazo ? '<span class="meta-chip" title="Puede llevar brazo de reacción">🦾 Brazo</span>' : '',
        equipo.puedeLlevarEjeSolido ? '<span class="meta-chip" title="Puede llevar eje sólido">🔩 Eje</span>' : ''
      ].filter(Boolean).join(' ');

      return `
        <tr data-id="${equipo.id}">
          <td>${escapeHtml(equipo.nombre)} ${extrasHtml}</td>
          <td>${tipoBadge}</td>
          <td>${varianteHtml}</td>
          <td>${formatearPeso(equipo.peso)}${faltaPesoTag}</td>
          <td>${equipo.usaSerial ? '✅' : '—'}</td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn-editar" data-id="${equipo.id}">Editar</button>
              <button type="button" class="btn-eliminar danger" data-id="${equipo.id}">Eliminar</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tablaBody.querySelectorAll('.btn-editar').forEach(btn => {
      btn.addEventListener('click', () => {
        const equipo = equiposCache.find(eq => eq.id === btn.dataset.id);
        if (equipo) abrirModalEditar(equipo);
      });
    });
    tablaBody.querySelectorAll('.btn-eliminar').forEach(btn => {
      btn.addEventListener('click', () => {
        const equipo = equiposCache.find(eq => eq.id === btn.dataset.id);
        if (equipo) eliminarEquipo(equipo);
      });
    });
  }

  // ---------- Suscripción en tiempo real ----------

  let suscrito = false;
  function iniciarSuscripcion() {
    if (suscrito) return;
    suscrito = true;
    db.collection(COLECCION).orderBy('nombre').onSnapshot(
      (snapshot) => {
        equiposCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        window.equiposCache = equiposCache;
        renderTabla();
        document.dispatchEvent(new CustomEvent('equipos-catalogo:cambio', { detail: { equipos: equiposCache } }));
      },
      (err) => {
        console.error('Error escuchando equipos:', err);
      }
    );
  }

  iniciarSuscripcion();

  document.addEventListener('tab:activada', (e) => {
    if (e.detail.tab !== 'equipos') return;
    iniciarSuscripcion();
  });
})();
