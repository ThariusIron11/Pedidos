// ================== Pestaña: Clientes / Compañías ==================
// CRUD de compañías sobre Firestore (colección "clientes").
//
// Cada compañía:
// {
//   nombre, tipo: 'normal' | 'subsidiaria' | 'subsidiaria_edisatech',
//   nit, direccion, direccionRemision, contraentrega: boolean,
//   contactosPedidos: ['nombre1', 'nombre2', ...],
//   contactoReparaciones: 'nombre'
// }
//
// Comportamiento del modal (igual al de Pedidos/Reparación en App Repuestos):
// - Clic por fuera (backdrop) cierra PERO conserva lo digitado (borrador).
// - Botón "Cancelar" cierra y SÍ limpia todo.
// - Si hay un borrador de una compañía nueva sin guardar y se vuelve a abrir
//   "+ Nueva compañía", se retoma ese borrador en vez de empezar en blanco.
// - Si hay un borrador de edición sin guardar y se vuelve a editar la MISMA
//   compañía, se retoma; si es otra compañía, se descarta y se carga la nueva.

(function () {
  const COLECCION = 'clientes';

  const TIPO_INFO = {
    normal: { label: null, icono: '🏢' },
    subsidiaria: { label: 'Subsidiaria', icono: '🔗' },
    subsidiaria_edisatech: { label: 'Subsidiaria de Edisatech', icono: '🏭' }
  };

  const tablaBody  = document.getElementById('tabla-clientes-body');
  const tablaEmpty = document.getElementById('clientes-empty');
  const modal       = document.getElementById('modal-cliente');
  const modalTitulo = document.getElementById('modal-cliente-titulo');
  const form         = document.getElementById('form-cliente');
  const buscador      = document.getElementById('buscador-clientes');

  const inputId               = document.getElementById('cliente-id');
  const inputNombre           = document.getElementById('cliente-nombre');
  const inputTipo             = document.getElementById('cliente-tipo');
  const inputNit               = document.getElementById('cliente-nit');
  const inputDireccion         = document.getElementById('cliente-direccion');
  const inputDireccionRemision = document.getElementById('cliente-direccion-remision');
  const inputContraentrega     = document.getElementById('cliente-contraentrega');
  const contactosPedidosList   = document.getElementById('contactos-pedidos-list');
  const inputContactoRepNombre = document.getElementById('cliente-contacto-reparaciones-nombre');

  let clientesCache = []; // [{id, ...datos}] — también expuesto en window.clientesCache
  let filtroTexto = '';

  // Estado del borrador: 'id' del registro en edición ('' = compañía nueva),
  // o null si no hay ningún borrador activo (el modal fue cancelado/guardado).
  let borradorId = null;

  // ---------- Helpers ----------

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(str) {
    return String(str ?? '').replace(/"/g, '&quot;');
  }

  function normalizar(str) {
    return String(str ?? '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // quita tildes
  }

  // ---------- Lista dinámica de contactos de pedidos ----------

  function nuevaFilaContactoPedido(nombre) {
    const row = document.createElement('div');
    row.className = 'contacto-simple-row';
    row.innerHTML = `
      <input type="text" class="contacto-pedido-nombre" placeholder="Nombre" value="${escapeAttr(nombre || '')}">
      <button type="button" class="remove-contacto" title="Quitar contacto">✕</button>
    `;
    row.querySelector('.remove-contacto').addEventListener('click', () => row.remove());
    contactosPedidosList.appendChild(row);
  }

  function leerContactosPedidosDelFormulario() {
    const filas = contactosPedidosList.querySelectorAll('.contacto-pedido-nombre');
    const contactos = [];
    filas.forEach(input => {
      const nombre = input.value.trim();
      if (nombre) contactos.push(nombre);
    });
    return contactos;
  }

  document.getElementById('btn-add-contacto-pedidos').addEventListener('click', () => nuevaFilaContactoPedido());

  // ---------- Cargar datos limpios de un cliente en el formulario ----------

  function cargarFormularioDesdeCliente(cliente) {
    form.reset();
    inputId.value = cliente ? cliente.id : '';
    inputNombre.value = cliente?.nombre || '';
    inputTipo.value = cliente?.tipo || 'normal';
    inputNit.value = cliente?.nit || '';
    inputDireccion.value = cliente?.direccion || '';
    inputDireccionRemision.value = cliente?.direccionRemision || '';
    inputContraentrega.checked = !!cliente?.contraentrega;
    inputContactoRepNombre.value = cliente?.contactoReparaciones || '';

    contactosPedidosList.innerHTML = '';
    const contactos = cliente?.contactosPedidos || [];
    if (contactos.length) {
      contactos.forEach(nombre => nuevaFilaContactoPedido(nombre));
    } else {
      nuevaFilaContactoPedido();
    }
  }

  // ---------- Abrir / cerrar modal ----------

  function abrirModalNuevo() {
    if (borradorId === '') {
      // Ya había un borrador de compañía nueva en curso: se retoma tal cual.
      modalTitulo.textContent = 'Nueva compañía';
      modal.classList.add('open');
      inputNombre.focus();
      return;
    }
    modalTitulo.textContent = 'Nueva compañía';
    cargarFormularioDesdeCliente(null);
    borradorId = '';
    modal.classList.add('open');
    inputNombre.focus();
  }

  function abrirModalEditar(cliente) {
    if (borradorId === cliente.id) {
      // Ya había un borrador de edición de ESTA MISMA compañía: se retoma.
      modalTitulo.textContent = 'Editar compañía';
      modal.classList.add('open');
      inputNombre.focus();
      return;
    }
    modalTitulo.textContent = 'Editar compañía';
    cargarFormularioDesdeCliente(cliente);
    borradorId = cliente.id;
    modal.classList.add('open');
    inputNombre.focus();
  }

  function cerrarModalConservandoBorrador() {
    // Clic por fuera: solo oculta, no toca los datos digitados.
    modal.classList.remove('open');
  }

  function cancelarYLimpiar() {
    form.reset();
    contactosPedidosList.innerHTML = '';
    borradorId = null;
    modal.classList.remove('open');
  }

  document.getElementById('btn-nuevo-cliente').addEventListener('click', abrirModalNuevo);
  document.getElementById('btn-cancelar-cliente').addEventListener('click', cancelarYLimpiar);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModalConservandoBorrador();
  });

  // ---------- Guardar (crear/editar) ----------

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const datos = {
      nombre: inputNombre.value.trim(),
      tipo: inputTipo.value,
      nit: inputNit.value.trim(),
      direccion: inputDireccion.value.trim(),
      direccionRemision: inputDireccionRemision.value.trim(),
      contraentrega: inputContraentrega.checked,
      contactosPedidos: leerContactosPedidosDelFormulario(),
      contactoReparaciones: inputContactoRepNombre.value.trim()
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
      // Guardado con éxito: ya no queda borrador pendiente.
      form.reset();
      contactosPedidosList.innerHTML = '';
      borradorId = null;
      modal.classList.remove('open');
    } catch (err) {
      console.error('Error guardando cliente:', err);
      alert('No se pudo guardar la compañía. Revisa la consola.');
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = 'Guardar';
    }
  });

  // ---------- Eliminar ----------

  async function eliminarCliente(cliente) {
    const ok = confirm(`¿Eliminar "${cliente.nombre}"? Esta acción no se puede deshacer.`);
    if (!ok) return;
    try {
      await db.collection(COLECCION).doc(cliente.id).delete();
    } catch (err) {
      console.error('Error eliminando cliente:', err);
      alert('No se pudo eliminar la compañía. Revisa la consola.');
    }
  }

  // ---------- Buscador ----------

  buscador.addEventListener('input', () => {
    filtroTexto = normalizar(buscador.value.trim());
    renderTabla();
  });

  function clienteCoincideConFiltro(cliente) {
    if (!filtroTexto) return true;
    if (normalizar(cliente.nombre).includes(filtroTexto)) return true;
    const contactos = cliente.contactosPedidos || [];
    return contactos.some(nombre => normalizar(nombre).includes(filtroTexto));
  }

  // ---------- Render de la tabla ----------

  function renderTabla() {
    const listaFiltrada = clientesCache.filter(clienteCoincideConFiltro);

    if (!listaFiltrada.length) {
      tablaBody.innerHTML = '';
      tablaEmpty.style.display = 'block';
      tablaEmpty.textContent = clientesCache.length
        ? 'Ninguna compañía coincide con la búsqueda.'
        : 'Todavía no hay compañías registradas.';
      return;
    }
    tablaEmpty.style.display = 'none';

    tablaBody.innerHTML = listaFiltrada.map(cliente => {
      const tipoInfo = TIPO_INFO[cliente.tipo] || TIPO_INFO.normal;
      const tipoTag = tipoInfo.label
        ? `<span class="tag-tipo ${cliente.tipo}">${tipoInfo.icono} ${tipoInfo.label}</span>`
        : '';
      const contraentregaTag = cliente.contraentrega
        ? '<span class="tag-contraentrega">Contraentrega</span>'
        : '';

      const direccionHtml = cliente.direccionRemision && cliente.direccionRemision !== cliente.direccion
        ? `${escapeHtml(cliente.direccion || '—')}<br><span style="color:var(--ink-soft); font-size:12px;">Remisión: ${escapeHtml(cliente.direccionRemision)}</span>`
        : escapeHtml(cliente.direccion || '—');

      const contactosPedidos = cliente.contactosPedidos || [];
      const contactosPedidosHtml = contactosPedidos.length
        ? contactosPedidos.map(escapeHtml).join(', ')
        : '<span style="color:var(--ink-soft);">—</span>';
      const contactoRepHtml = cliente.contactoReparaciones
        ? escapeHtml(cliente.contactoReparaciones)
        : '<span style="color:var(--ink-soft);">—</span>';

      const contactosHtml = `
        <div>Pedidos: ${contactosPedidosHtml}</div>
        <div>Reparaciones: ${contactoRepHtml}</div>
      `;

      return `
        <tr data-id="${cliente.id}">
          <td>${tipoInfo.icono} ${escapeHtml(cliente.nombre)}${tipoTag}${contraentregaTag}</td>
          <td>${escapeHtml(cliente.nit || '—')}</td>
          <td>${direccionHtml}</td>
          <td>${contactosHtml}</td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn-editar" data-id="${cliente.id}">Editar</button>
              <button type="button" class="btn-eliminar danger" data-id="${cliente.id}">Eliminar</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tablaBody.querySelectorAll('.btn-editar').forEach(btn => {
      btn.addEventListener('click', () => {
        const cliente = clientesCache.find(c => c.id === btn.dataset.id);
        if (cliente) abrirModalEditar(cliente);
      });
    });
    tablaBody.querySelectorAll('.btn-eliminar').forEach(btn => {
      btn.addEventListener('click', () => {
        const cliente = clientesCache.find(c => c.id === btn.dataset.id);
        if (cliente) eliminarCliente(cliente);
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
        clientesCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        window.clientesCache = clientesCache;
        renderTabla();
        document.dispatchEvent(new CustomEvent('clientes:cambio', { detail: { clientes: clientesCache } }));
      },
      (err) => {
        console.error('Error escuchando clientes:', err);
      }
    );
  }

  iniciarSuscripcion();

  document.addEventListener('tab:activada', (e) => {
    if (e.detail.tab !== 'clientes') return;
    iniciarSuscripcion();
  });
})();
