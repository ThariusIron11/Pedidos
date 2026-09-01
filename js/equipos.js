// ================== Pestaña: Equipos ==================
// Catálogo de tipos/referencias de equipos sobre Firestore (colección "equipos").
// Sin manejo de stock por ahora (posible futuro).
//
// Cada equipo:
// {
//   nombre, tipo, variante, peso (número), usaSerial (boolean)
// }
//
// Nota de negocio: nombre + tipo + variante identifican una ficha DISTINTA.
// Ej: "Motor 10HP" tipo Motor variante "D3" y "Motor 10HP" tipo Motor
// variante "D4" son dos entidades separadas del catálogo.
//
// Mismo comportamiento de modal que Clientes: backdrop conserva el borrador,
// Cancelar limpia todo, y reabrir retoma el borrador si sigue vigente.

(function () {
  const COLECCION = 'equipos';

  const tablaBody  = document.getElementById('tabla-equipos-body');
  const tablaEmpty = document.getElementById('equipos-empty');
  const modal       = document.getElementById('modal-equipo');
  const modalTitulo = document.getElementById('modal-equipo-titulo');
  const form         = document.getElementById('form-equipo');
  const buscador      = document.getElementById('buscador-equipos');

  const inputId       = document.getElementById('equipo-id');
  const inputNombre   = document.getElementById('equipo-nombre');
  const inputTipo     = document.getElementById('equipo-tipo');
  const inputVariante = document.getElementById('equipo-variante');
  const inputPeso     = document.getElementById('equipo-peso');
  const inputUsaSerial = document.getElementById('equipo-usa-serial');

  let equiposCache = []; // [{id, ...datos}]
  let filtroTexto = '';
  let borradorId = null; // '' = equipo nuevo en curso, id = editando ese id, null = sin borrador

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
    if (peso === undefined || peso === null || peso === '') return '—';
    return `${peso} kg`;
  }

  // ---------- Cargar / limpiar formulario ----------

  function cargarFormularioDesdeEquipo(equipo) {
    form.reset();
    inputId.value = equipo ? equipo.id : '';
    inputNombre.value = equipo?.nombre || '';
    inputTipo.value = equipo?.tipo || 'Motor';
    inputVariante.value = equipo?.variante || '';
    inputPeso.value = (equipo?.peso ?? '') === '' ? '' : String(equipo.peso);
    inputUsaSerial.checked = !!equipo?.usaSerial;
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
      tipo: inputTipo.value,
      variante: inputVariante.value.trim(),
      peso: (peso === null || isNaN(peso)) ? null : peso,
      usaSerial: inputUsaSerial.checked
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

  // ---------- Buscador ----------

  buscador.addEventListener('input', () => {
    filtroTexto = normalizar(buscador.value.trim());
    renderTabla();
  });

  function equipoCoincideConFiltro(equipo) {
    if (!filtroTexto) return true;
    return normalizar(equipo.nombre).includes(filtroTexto)
      || normalizar(equipo.tipo).includes(filtroTexto)
      || normalizar(equipo.variante).includes(filtroTexto);
  }

  // ---------- Render de la tabla ----------

  function renderTabla() {
    const listaFiltrada = equiposCache.filter(equipoCoincideConFiltro);

    if (!listaFiltrada.length) {
      tablaBody.innerHTML = '';
      tablaEmpty.style.display = 'block';
      tablaEmpty.textContent = equiposCache.length
        ? 'Ningún equipo coincide con la búsqueda.'
        : 'Todavía no hay equipos registrados.';
      return;
    }
    tablaEmpty.style.display = 'none';

    tablaBody.innerHTML = listaFiltrada.map(equipo => `
      <tr data-id="${equipo.id}">
        <td>${escapeHtml(equipo.nombre)}</td>
        <td>${escapeHtml(equipo.tipo)}</td>
        <td>${escapeHtml(equipo.variante || '—')}</td>
        <td>${formatearPeso(equipo.peso)}</td>
        <td>${equipo.usaSerial ? '✅' : '—'}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn-editar" data-id="${equipo.id}">Editar</button>
            <button type="button" class="btn-eliminar danger" data-id="${equipo.id}">Eliminar</button>
          </div>
        </td>
      </tr>
    `).join('');

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
        renderTabla();
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
