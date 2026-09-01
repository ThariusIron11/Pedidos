// ================== Pestaña: Pedidos ==================
// CRUD de pedidos sobre Firestore (colección "pedidos").
//
// Cada pedido:
// {
//   numero (entero, se reutiliza el menor número libre si se borra un pedido),
//   companiaId (referencia a "clientes"),
//   contacto (nombre, tomado de contactosPedidos de la compañía),
//   equipos: [{ equipoId, cantidad, ordenCompra }]
// }
//
// Depende de los catálogos globales que exponen clientes.js y equipos.js:
//   window.clientesCache  + evento 'clientes:cambio'
//   window.equiposCache   + evento 'equipos-catalogo:cambio'
//
// Mismo comportamiento de modal que el resto de pestañas: backdrop conserva
// el borrador, Cancelar limpia todo, reabrir retoma el borrador vigente.

(function () {
  const COLECCION = 'pedidos';

  const tablaBody  = document.getElementById('tabla-pedidos-body');
  const tablaEmpty = document.getElementById('pedidos-empty');
  const modal       = document.getElementById('modal-pedido');
  const modalTitulo = document.getElementById('modal-pedido-titulo');
  const form         = document.getElementById('form-pedido');

  const inputId      = document.getElementById('pedido-id');
  const inputNumero  = document.getElementById('pedido-numero');
  const selectCompania = document.getElementById('pedido-compania');
  const selectContacto = document.getElementById('pedido-contacto');
  const equiposPedidoList = document.getElementById('equipos-pedido-list');

  let pedidosCache = [];
  let borradorId = null;

  // ---------- Helpers ----------

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function buscarCompania(id) {
    return (window.clientesCache || []).find(c => c.id === id) || null;
  }

  function buscarEquipoCatalogo(id) {
    return (window.equiposCache || []).find(eq => eq.id === id) || null;
  }

  function siguienteNumeroDisponible() {
    const usados = new Set(pedidosCache.map(p => p.numero));
    let n = 1;
    while (usados.has(n)) n++;
    return n;
  }

  // ---------- Sub-pestañas del modal (Datos / Equipos) ----------

  const subtabButtons = modal.querySelectorAll('.subtab-btn');
  const subtabPanels = modal.querySelectorAll('.subtab-panel');
  subtabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      subtabButtons.forEach(b => b.classList.toggle('active', b === btn));
      subtabPanels.forEach(p => p.classList.toggle('active', p.id === 'subtab-' + btn.dataset.subtab));
    });
  });
  function resetSubtabs() {
    subtabButtons.forEach((b, i) => b.classList.toggle('active', i === 0));
    subtabPanels.forEach((p, i) => p.classList.toggle('active', i === 0));
  }

  // ---------- Select de compañía / contacto ----------

  function poblarSelectCompanias() {
    const companias = window.clientesCache || [];
    const actual = selectCompania.value;
    selectCompania.innerHTML = '<option value="">Selecciona una compañía...</option>' +
      companias.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('');
    if (actual) selectCompania.value = actual;
  }

  function poblarSelectContacto(companiaId, contactoSeleccionado) {
    const compania = buscarCompania(companiaId);
    const contactos = compania?.contactosPedidos || [];
    if (!compania) {
      selectContacto.innerHTML = '<option value="">Selecciona una compañía primero</option>';
      return;
    }
    if (!contactos.length) {
      selectContacto.innerHTML = '<option value="">Esta compañía no tiene contactos de pedidos</option>';
      return;
    }
    selectContacto.innerHTML = '<option value="">Selecciona un contacto...</option>' +
      contactos.map(nombre => `<option value="${escapeHtml(nombre)}">${escapeHtml(nombre)}</option>`).join('');
    if (contactoSeleccionado) selectContacto.value = contactoSeleccionado;
  }

  selectCompania.addEventListener('change', () => {
    poblarSelectContacto(selectCompania.value, '');
  });

  document.addEventListener('clientes:cambio', () => {
    poblarSelectCompanias();
    renderTabla(); // los nombres de compañía en la tabla pueden haber cambiado
  });
  if (window.clientesCache && window.clientesCache.length) poblarSelectCompanias();

  // ---------- Lista de equipos dentro del pedido ----------

  function opcionesEquiposHtml(equipoIdSeleccionado) {
    const equipos = window.equiposCache || [];
    return '<option value="">Selecciona un equipo...</option>' +
      equipos.map(eq => `<option value="${eq.id}" ${eq.id === equipoIdSeleccionado ? 'selected' : ''}>${escapeHtml(eq.nombre)}${eq.variante ? ' (' + escapeHtml(eq.variante) + ')' : ''}</option>`).join('');
  }

  function nuevaFilaEquipoPedido(item) {
    const row = document.createElement('div');
    row.className = 'equipo-pedido-row';
    row.innerHTML = `
      <select class="equipo-pedido-select">${opcionesEquiposHtml(item?.equipoId)}</select>
      <input type="number" class="equipo-pedido-cantidad" min="1" step="1" placeholder="Cant." value="${item?.cantidad ?? 1}">
      <input type="text" class="equipo-pedido-oc" placeholder="Orden de compra (opcional)" value="${item?.ordenCompra ? escapeHtml(item.ordenCompra) : ''}">
      <button type="button" class="remove-equipo-pedido" title="Quitar equipo">✕</button>
    `;
    row.querySelector('.remove-equipo-pedido').addEventListener('click', () => row.remove());
    equiposPedidoList.appendChild(row);
  }

  function leerEquiposDelFormulario() {
    const filas = equiposPedidoList.querySelectorAll('.equipo-pedido-row');
    const items = [];
    filas.forEach(fila => {
      const equipoId = fila.querySelector('.equipo-pedido-select').value;
      if (!equipoId) return; // ignora filas sin equipo elegido
      const cantidad = parseInt(fila.querySelector('.equipo-pedido-cantidad').value, 10) || 1;
      const ordenCompra = fila.querySelector('.equipo-pedido-oc').value.trim();
      items.push({ equipoId, cantidad, ordenCompra });
    });
    return items;
  }

  document.getElementById('btn-add-equipo-pedido').addEventListener('click', () => nuevaFilaEquipoPedido());

  document.addEventListener('equipos-catalogo:cambio', () => {
    // Refresca las opciones de los selects de equipo ya presentes en el formulario,
    // conservando lo que cada uno tenía seleccionado.
    equiposPedidoList.querySelectorAll('.equipo-pedido-select').forEach(sel => {
      const actual = sel.value;
      sel.innerHTML = opcionesEquiposHtml(actual);
      sel.value = actual;
    });
    renderTabla();
  });

  // ---------- Cargar / limpiar formulario ----------

  function cargarFormularioDesdePedido(pedido) {
    form.reset();
    equiposPedidoList.innerHTML = '';
    resetSubtabs();

    inputId.value = pedido ? pedido.id : '';
    inputNumero.value = pedido ? pedido.numero : siguienteNumeroDisponible();

    poblarSelectCompanias();
    selectCompania.value = pedido?.companiaId || '';
    poblarSelectContacto(pedido?.companiaId || '', pedido?.contacto || '');

    const items = pedido?.equipos || [];
    if (items.length) {
      items.forEach(item => nuevaFilaEquipoPedido(item));
    } else {
      nuevaFilaEquipoPedido();
    }
  }

  // ---------- Abrir / cerrar modal ----------

  function abrirModalNuevo() {
    if (borradorId === '') {
      modalTitulo.textContent = `Nuevo pedido (N° ${inputNumero.value})`;
      modal.classList.add('open');
      return;
    }
    cargarFormularioDesdePedido(null);
    modalTitulo.textContent = `Nuevo pedido (N° ${inputNumero.value})`;
    borradorId = '';
    modal.classList.add('open');
  }

  function abrirModalEditar(pedido) {
    if (borradorId === pedido.id) {
      modalTitulo.textContent = `Editar pedido N° ${pedido.numero}`;
      modal.classList.add('open');
      return;
    }
    cargarFormularioDesdePedido(pedido);
    modalTitulo.textContent = `Editar pedido N° ${pedido.numero}`;
    borradorId = pedido.id;
    modal.classList.add('open');
  }

  function cerrarModalConservandoBorrador() {
    modal.classList.remove('open');
  }

  function cancelarYLimpiar() {
    form.reset();
    equiposPedidoList.innerHTML = '';
    resetSubtabs();
    borradorId = null;
    modal.classList.remove('open');
  }

  document.getElementById('btn-nuevo-pedido').addEventListener('click', abrirModalNuevo);
  document.getElementById('btn-cancelar-pedido').addEventListener('click', cancelarYLimpiar);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModalConservandoBorrador();
  });

  // ---------- Guardar (crear/editar) ----------

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const companiaId = selectCompania.value;
    if (!companiaId) {
      subtabButtons[0].click();
      selectCompania.focus();
      return;
    }

    const datos = {
      companiaId,
      contacto: selectContacto.value,
      equipos: leerEquiposDelFormulario()
    };

    const id = inputId.value;
    const btnGuardar = form.querySelector('button[type="submit"]');
    btnGuardar.disabled = true;
    btnGuardar.textContent = 'Guardando...';

    try {
      if (id) {
        await db.collection(COLECCION).doc(id).update(datos);
      } else {
        datos.numero = siguienteNumeroDisponible(); // recalculado justo antes de guardar
        datos.creadoEn = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection(COLECCION).add(datos);
      }
      form.reset();
      equiposPedidoList.innerHTML = '';
      resetSubtabs();
      borradorId = null;
      modal.classList.remove('open');
    } catch (err) {
      console.error('Error guardando pedido:', err);
      alert('No se pudo guardar el pedido. Revisa la consola.');
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = 'Guardar';
    }
  });

  // ---------- Eliminar ----------

  async function eliminarPedido(pedido) {
    const ok = confirm(`¿Eliminar el pedido N° ${pedido.numero}? Esta acción no se puede deshacer. El número quedará libre para un pedido nuevo.`);
    if (!ok) return;
    try {
      await db.collection(COLECCION).doc(pedido.id).delete();
    } catch (err) {
      console.error('Error eliminando pedido:', err);
      alert('No se pudo eliminar el pedido. Revisa la consola.');
    }
  }

  // ---------- Render de la tabla ----------

  function renderTabla() {
    if (!pedidosCache.length) {
      tablaBody.innerHTML = '';
      tablaEmpty.style.display = 'block';
      return;
    }
    tablaEmpty.style.display = 'none';

    const ordenados = [...pedidosCache].sort((a, b) => a.numero - b.numero);

    tablaBody.innerHTML = ordenados.map(pedido => {
      const compania = buscarCompania(pedido.companiaId);
      const nombreCompania = compania ? escapeHtml(compania.nombre) : '<span style="color:var(--danger);">Compañía no encontrada</span>';
      const cantidadEquipos = (pedido.equipos || []).length;

      return `
        <tr data-id="${pedido.id}">
          <td><strong>${pedido.numero}</strong></td>
          <td>${nombreCompania}</td>
          <td>${pedido.contacto ? escapeHtml(pedido.contacto) : '<span style="color:var(--ink-soft);">—</span>'}</td>
          <td>${cantidadEquipos} ${cantidadEquipos === 1 ? 'equipo' : 'equipos'}</td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn-editar" data-id="${pedido.id}">Editar</button>
              <button type="button" class="btn-eliminar danger" data-id="${pedido.id}">Eliminar</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tablaBody.querySelectorAll('.btn-editar').forEach(btn => {
      btn.addEventListener('click', () => {
        const pedido = pedidosCache.find(p => p.id === btn.dataset.id);
        if (pedido) abrirModalEditar(pedido);
      });
    });
    tablaBody.querySelectorAll('.btn-eliminar').forEach(btn => {
      btn.addEventListener('click', () => {
        const pedido = pedidosCache.find(p => p.id === btn.dataset.id);
        if (pedido) eliminarPedido(pedido);
      });
    });
  }

  // ---------- Suscripción en tiempo real ----------

  let suscrito = false;
  function iniciarSuscripcion() {
    if (suscrito) return;
    suscrito = true;
    db.collection(COLECCION).onSnapshot(
      (snapshot) => {
        pedidosCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderTabla();
      },
      (err) => {
        console.error('Error escuchando pedidos:', err);
      }
    );
  }

  iniciarSuscripcion();

  document.addEventListener('tab:activada', (e) => {
    if (e.detail.tab !== 'pedidos') return;
    iniciarSuscripcion();
  });
})();
