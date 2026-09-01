// ================== Pestaña: Config ==================
// Catálogo editable de "Tipos de equipo" sobre Firestore (colección "tipos_equipo").
// Otras pestañas (Equipos) leen este catálogo desde window.tiposEquipoCache
// y se suscriben al evento 'tipos-equipo:cambio' para reaccionar en vivo.
//
// Cada tipo: { nombre, icono (emoji), color (hex '#rrggbb') }

(function () {
  const COLECCION = 'tipos_equipo';

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
            ${tipo.icono || ''}
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
