// ================== Pestaña: Reparaciones ==================
// CRUD de reparaciones sobre Firestore (colección "reparaciones").
//
// PASO 1 (este archivo, por ahora): solo se registra QUÉ COMPAÑÍA trae
// equipos a reparar y QUIÉN es el encargado de reparaciones de esa
// compañía (a diferencia de Pedidos, que usa "encargado de PEDIDOS", acá
// se usa el campo "encargado de reparaciones" del cliente).
//
// El detalle de los equipos que ingresan (reductores, motores, motor ZD,
// motoreductor) se agrega en un paso siguiente, sobre esta misma base.
//
// Cada reparación:
// {
//   numero (entero — se muestra como "R01", "R02"... con el prefijo "R" y
//           2 dígitos; se reutiliza el menor número libre si se borra una
//           reparación, exactamente igual que el N° de Pedidos),
//   companiaId,
//   contacto (encargado de reparaciones; se autocompleta desde el cliente
//             elegido, pero se puede ajustar a mano por si ese día recibe
//             otra persona)
// }

(function () {
  const COLECCION = 'reparaciones';

  const listaContenedor = document.getElementById('reparaciones-cards');
  const tablaEmpty = document.getElementById('reparaciones-empty');
  const buscador = document.getElementById('buscador-reparaciones');

  const modal = document.getElementById('modal-reparacion');
  const modalTitulo = document.getElementById('modal-reparacion-titulo');
  const form = document.getElementById('form-reparacion');

  const inputId = document.getElementById('reparacion-id');
  const inputNumero = document.getElementById('reparacion-numero');
  const selectCompania = document.getElementById('reparacion-compania');
  const inputContacto = document.getElementById('reparacion-contacto');
  const inputFechaIngreso = document.getElementById('reparacion-fecha-ingreso');
  const inputEvidencia = document.getElementById('reparacion-evidencia');
  const previewEvidencia = document.getElementById('reparacion-evidencia-preview');
  const linkEvidencia = document.getElementById('reparacion-evidencia-link');

  const subtabButtons = modal.querySelectorAll('.subtab-btn');
  const subtabPanels = modal.querySelectorAll('.subtab-panel');

  let reparacionesCache = []; // también expuesto en window.reparacionesCache
  let borradorId = null;
  let filtroTexto = '';

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
      .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // quita tildes
  }

  function escapeAttr(str) {
    return String(str ?? '').replace(/"/g, '&quot;');
  }

  // Fecha de hoy en formato YYYY-MM-DD (hora local), valor por defecto del
  // campo "Día de ingreso" al registrar una reparación nueva.
  function fechaHoyISO() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // 'YYYY-MM-DD' -> 'DD/MM/AAAA', para mostrarla en la tarjeta de la lista.
  function formatearFechaCorta(fechaISO) {
    if (!fechaISO) return '';
    const [yyyy, mm, dd] = fechaISO.split('-');
    if (!yyyy || !mm || !dd) return fechaISO;
    return `${dd}/${mm}/${yyyy}`;
  }

  function buscarCompania(id) {
    return (window.clientesCache || []).find(c => c.id === id);
  }

  // ---------- Sub-pestañas del modal (Datos generales / Equipos) ----------

  function resetSubtabs() {
    subtabButtons.forEach(b => b.classList.toggle('active', b.dataset.subtab === 'reparacion-datos'));
    subtabPanels.forEach(p => p.classList.toggle('active', p.id === 'subtab-reparacion-datos'));
  }

  subtabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      subtabButtons.forEach(b => b.classList.toggle('active', b === btn));
      subtabPanels.forEach(p => p.classList.toggle('active', p.id === 'subtab-' + btn.dataset.subtab));
    });
  });

  // ---------- Evidencia fotográfica: link a carpeta compartida ----------
  // Mientras se escribe/pega el link, se ve en vivo debajo del campo como
  // texto clickeable (abre en pestaña nueva), para poder confirmar que
  // quedó bien antes de guardar.

  function actualizarPreviewEvidencia() {
    const url = inputEvidencia.value.trim();
    if (url) {
      linkEvidencia.href = escapeAttr(url);
      previewEvidencia.style.display = 'block';
    } else {
      previewEvidencia.style.display = 'none';
    }
  }

  inputEvidencia.addEventListener('input', actualizarPreviewEvidencia);

  // 3 -> "R03". El número real que se guarda es el entero (3); esto es
  // solo cómo se muestra.
  function formatearNumero(numero) {
    return 'R' + String(numero).padStart(2, '0');
  }

  // Mismo criterio que usa Pedidos con su N°: el menor entero que no esté
  // en uso ahora mismo, para que al borrar una reparación su número quede
  // libre para la siguiente.
  function siguienteNumeroDisponible() {
    const usados = new Set(reparacionesCache.map(r => r.numero));
    let n = 1;
    while (usados.has(n)) n++;
    return n;
  }

  // ---------- Select de compañía + autocompletar encargado ----------

  function poblarSelectCompanias() {
    const actual = selectCompania.value;
    const clientes = window.clientesCache || [];
    selectCompania.innerHTML = '<option value="">Selecciona una compañía...</option>' +
      clientes.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('');
    if (actual) selectCompania.value = actual;
  }

  selectCompania.addEventListener('change', () => {
    const compania = buscarCompania(selectCompania.value);
    inputContacto.value = compania?.contactoReparaciones || '';
  });

  document.addEventListener('clientes:cambio', () => {
    poblarSelectCompanias();
    renderLista(); // los nombres de compañía en las tarjetas pueden haber cambiado
  });
  if (window.clientesCache && window.clientesCache.length) poblarSelectCompanias();

  // ---------- Modal ----------

  function cargarFormularioDesdeReparacion(reparacion) {
    form.reset();
    inputId.value = reparacion ? reparacion.id : '';
    inputNumero.value = reparacion ? reparacion.numero : '';
    poblarSelectCompanias();
    selectCompania.value = reparacion?.companiaId || '';
    inputContacto.value = reparacion
      ? (reparacion.contacto || '')
      : ''; // en una reparación nueva se llena solo al elegir la compañía
    inputFechaIngreso.value = reparacion?.fechaIngreso || fechaHoyISO();
    inputEvidencia.value = reparacion?.evidenciaFotografica || '';
    actualizarPreviewEvidencia();
    resetSubtabs();
  }

  function abrirModalNuevo() {
    if (borradorId === '') {
      // Ya había un borrador de reparación nueva en curso: se retoma tal cual.
      modalTitulo.textContent = 'Nueva reparación';
      modal.classList.add('open');
      selectCompania.focus();
      return;
    }
    modalTitulo.textContent = 'Nueva reparación';
    cargarFormularioDesdeReparacion(null);
    borradorId = '';
    modal.classList.add('open');
    selectCompania.focus();
  }

  function abrirModalEditar(reparacion) {
    if (borradorId === reparacion.id) {
      modalTitulo.textContent = `Editar reparación ${formatearNumero(reparacion.numero)}`;
      modal.classList.add('open');
      return;
    }
    modalTitulo.textContent = `Editar reparación ${formatearNumero(reparacion.numero)}`;
    cargarFormularioDesdeReparacion(reparacion);
    borradorId = reparacion.id;
    modal.classList.add('open');
  }

  function cerrarModalConservandoBorrador() {
    // Clic por fuera: solo oculta, no toca los datos digitados.
    modal.classList.remove('open');
  }

  function cancelarYLimpiar() {
    form.reset();
    resetSubtabs();
    previewEvidencia.style.display = 'none';
    borradorId = null;
    modal.classList.remove('open');
  }

  document.getElementById('btn-nueva-reparacion').addEventListener('click', abrirModalNuevo);
  document.getElementById('btn-cancelar-reparacion').addEventListener('click', cancelarYLimpiar);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModalConservandoBorrador();
  });

  // ---------- Guardar (crear/editar) ----------

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const companiaId = selectCompania.value;
    if (!companiaId) {
      selectCompania.focus();
      return;
    }

    const id = inputId.value;
    const btnGuardar = form.querySelector('button[type="submit"]');
    btnGuardar.disabled = true;
    btnGuardar.textContent = 'Guardando...';

    try {
      if (id) {
        await db.collection(COLECCION).doc(id).update({
          companiaId,
          contacto: inputContacto.value.trim(),
          fechaIngreso: inputFechaIngreso.value || null,
          evidenciaFotografica: inputEvidencia.value.trim()
        });
      } else {
        const numero = siguienteNumeroDisponible(); // recalculado justo antes de guardar
        await db.collection(COLECCION).add({
          numero,
          companiaId,
          contacto: inputContacto.value.trim(),
          fechaIngreso: inputFechaIngreso.value || fechaHoyISO(),
          evidenciaFotografica: inputEvidencia.value.trim(),
          creadoEn: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      form.reset();
      resetSubtabs();
      previewEvidencia.style.display = 'none';
      borradorId = null;
      modal.classList.remove('open');
    } catch (err) {
      console.error('Error guardando reparación:', err);
      alert('No se pudo guardar la reparación. Revisa la consola.');
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = 'Guardar';
    }
  });

  // ---------- Eliminar ----------

  async function eliminarReparacion(reparacion) {
    const ok = confirm(`¿Eliminar la reparación ${formatearNumero(reparacion.numero)}? Esta acción no se puede deshacer. El número quedará libre para una reparación nueva.`);
    if (!ok) return;
    try {
      await db.collection(COLECCION).doc(reparacion.id).delete();
    } catch (err) {
      console.error('Error eliminando reparación:', err);
      alert('No se pudo eliminar la reparación. Revisa la consola.');
    }
  }

  // ---------- Buscador ----------

  buscador.addEventListener('input', () => {
    filtroTexto = normalizar(buscador.value.trim());
    renderLista();
  });

  function reparacionCoincide(reparacion) {
    if (!filtroTexto) return true;
    const compania = buscarCompania(reparacion.companiaId);
    if (compania && normalizar(compania.nombre).includes(filtroTexto)) return true;
    if (normalizar(reparacion.contacto).includes(filtroTexto)) return true;
    if (normalizar(formatearNumero(reparacion.numero)).includes(filtroTexto)) return true;
    return false;
  }

  // ---------- Render de la lista (tarjetas) ----------

  function renderLista() {
    const filtradas = reparacionesCache.filter(reparacionCoincide);

    if (!filtradas.length) {
      listaContenedor.innerHTML = '';
      tablaEmpty.style.display = 'block';
      tablaEmpty.textContent = reparacionesCache.length
        ? 'Ninguna reparación coincide con la búsqueda.'
        : 'Todavía no hay reparaciones registradas.';
      return;
    }
    tablaEmpty.style.display = 'none';

    const ordenadas = [...filtradas].sort((a, b) => a.numero - b.numero);

    listaContenedor.innerHTML = ordenadas.map(reparacion => {
      const compania = buscarCompania(reparacion.companiaId);
      const nombreCompania = compania ? escapeHtml(compania.nombre) : '<span style="color:var(--danger);">Compañía no encontrada</span>';
      const contactoTexto = reparacion.contacto
        ? escapeHtml(reparacion.contacto)
        : 'Sin encargado de reparaciones asignado';
      const fechaTexto = reparacion.fechaIngreso ? ` · Ingreso: ${formatearFechaCorta(reparacion.fechaIngreso)}` : '';
      const evidenciaHtml = reparacion.evidenciaFotografica
        ? ` · <a href="${escapeAttr(reparacion.evidenciaFotografica)}" target="_blank" rel="noopener noreferrer">📷 Evidencia fotográfica ↗</a>`
        : '';

      return `
        <div class="reparacion-card" data-id="${reparacion.id}">
          <div class="reparacion-card-header">
            <span class="reparacion-card-icono">🔧</span>
            <span class="reparacion-card-numero">${formatearNumero(reparacion.numero)}</span>
            <span class="reparacion-card-compania">${nombreCompania}</span>
            <div class="reparacion-card-actions">
              <button type="button" class="btn-eliminar" data-id="${reparacion.id}" title="Eliminar">🗑️</button>
            </div>
          </div>
          <div class="reparacion-card-resumen">Encargado: ${contactoTexto}${fechaTexto}${evidenciaHtml}</div>
        </div>
      `;
    }).join('');

    // Clic en cualquier parte de la tarjeta (fuera del botón eliminar o del
    // link de evidencia) abre directamente la edición, igual que Clientes.
    listaContenedor.querySelectorAll('.reparacion-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        const reparacion = reparacionesCache.find(r => r.id === card.dataset.id);
        if (reparacion) abrirModalEditar(reparacion);
      });
    });
    listaContenedor.querySelectorAll('.btn-eliminar').forEach(btn => {
      btn.addEventListener('click', () => {
        const reparacion = reparacionesCache.find(r => r.id === btn.dataset.id);
        if (reparacion) eliminarReparacion(reparacion);
      });
    });
  }

  // ---------- Suscripción en tiempo real ----------
  // Perezosa (solo arranca la primera vez que se entra a la pestaña), para
  // no cargar esta colección si nunca se visita.

  let suscrito = false;
  function iniciarSuscripcion() {
    if (suscrito) return;
    suscrito = true;
    db.collection(COLECCION).orderBy('numero').onSnapshot(
      (snapshot) => {
        reparacionesCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        window.reparacionesCache = reparacionesCache;
        renderLista();
        document.dispatchEvent(new CustomEvent('reparaciones:cambio', { detail: { reparaciones: reparacionesCache } }));
      },
      (err) => {
        console.error('Error escuchando reparaciones:', err);
      }
    );
  }

  document.addEventListener('tab:activada', (e) => {
    if (e.detail.tab !== 'reparaciones') return;
    iniciarSuscripcion();
  });
})();
