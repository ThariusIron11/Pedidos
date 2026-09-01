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
  const radiosTipoPedido = form.querySelectorAll('input[name="tipo-pedido"]');

  const modalFicha = document.getElementById('modal-ficha-pedido');
  const fichaHeaderNumero = document.getElementById('ficha-header-numero');
  const fichaHeaderResumen = document.getElementById('ficha-header-resumen');
  const fichaHeaderTags = document.getElementById('ficha-header-tags');
  const fichaSeccionCliente = document.getElementById('ficha-seccion-cliente');
  const fichaEquiposContenido = document.getElementById('ficha-equipos-contenido');
  const btnCerrarFicha = document.getElementById('btn-cerrar-ficha-pedido');
  const btnEditarDesdeFicha = document.getElementById('btn-editar-desde-ficha');

  const modalSeriales = document.getElementById('modal-seriales');
  const modalSerialesTitulo = document.getElementById('modal-seriales-titulo');
  const serialesCampos = document.getElementById('seriales-campos');
  const btnCancelarSeriales = document.getElementById('btn-cancelar-seriales');
  const btnGuardarSeriales = document.getElementById('btn-guardar-seriales');

  const TIPO_PEDIDO_LABEL = {
    normal: { texto: 'Normal', clase: 'tag-pedido-normal' },
    reparacion: { texto: 'Reparación', clase: 'tag-pedido-reparacion' }
  };

  let pedidosCache = [];
  let borradorId = null;
  let origenEdicion = null; // 'ficha' cuando se edita desde dentro de la Ficha, null si es desde la tabla

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

  // Sub-pestañas dentro de la Ficha (Datos / Equipos / Envío) — mismo patrón,
  // pero escuchando dentro de modalFicha para no chocar con las de arriba.
  const fichaSubtabButtons = modalFicha.querySelectorAll('.subtab-btn');
  const fichaSubtabPanels = modalFicha.querySelectorAll('.subtab-panel');
  fichaSubtabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      fichaSubtabButtons.forEach(b => b.classList.toggle('active', b === btn));
      fichaSubtabPanels.forEach(p => p.classList.toggle('active', p.id === 'subtab-' + btn.dataset.subtab));
    });
  });
  function resetFichaSubtabs() {
    fichaSubtabButtons.forEach((b, i) => b.classList.toggle('active', i === 0));
    fichaSubtabPanels.forEach((p, i) => p.classList.toggle('active', i === 0));
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

    const tipoActual = pedido?.tipo || 'normal';
    radiosTipoPedido.forEach(r => { r.checked = (r.value === tipoActual); });
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

  document.getElementById('btn-nuevo-pedido').addEventListener('click', () => {
    origenEdicion = null;
    abrirModalNuevo();
  });
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
      tipo: Array.from(radiosTipoPedido).find(r => r.checked)?.value || 'normal',
      equipos: leerEquiposDelFormulario()
    };

    const id = inputId.value;
    const btnGuardar = form.querySelector('button[type="submit"]');
    btnGuardar.disabled = true;
    btnGuardar.textContent = 'Guardando...';

    try {
      let numeroFinal = id ? parseInt(inputNumero.value, 10) : null;
      if (id) {
        await db.collection(COLECCION).doc(id).update(datos);
      } else {
        numeroFinal = siguienteNumeroDisponible(); // recalculado justo antes de guardar
        datos.numero = numeroFinal;
        datos.creadoEn = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection(COLECCION).add(datos);
      }
      form.reset();
      equiposPedidoList.innerHTML = '';
      resetSubtabs();
      borradorId = null;
      modal.classList.remove('open');

      if (id && origenEdicion === 'ficha') {
        // Volvemos a abrir la ficha del mismo pedido con los datos recién guardados
        // (sin esperar al próximo snapshot, para que se sienta instantáneo).
        abrirFicha({ id, numero: numeroFinal, ...datos });
      }
      origenEdicion = null;
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

  // ---------- Ficha de pedido (solo lectura, distinta al modal de crear/editar) ----------

  function campoFicha(label, valor) {
    return `
      <div class="ficha-campo">
        <div class="campo-label">${escapeHtml(label)}</div>
        <div class="campo-valor">${valor}</div>
      </div>
    `;
  }

  let pedidoIdEnFicha = null; // qué pedido está abierto en la ficha (para poder guardar seriales)

  function renderSeccionCliente(pedido) {
    const compania = buscarCompania(pedido.companiaId);
    const nit = compania?.nit ? escapeHtml(compania.nit) : '—';
    const direccion = compania?.direccion ? escapeHtml(compania.direccion) : '—';
    const direccionRemision = compania?.direccionRemision ? escapeHtml(compania.direccionRemision) : '—';
    const contraentrega = compania?.contraentrega ? 'Sí' : 'No';
    const persona = pedido.contacto ? escapeHtml(pedido.contacto) : '— (sin asignar)';
    const nombreCliente = compania ? escapeHtml(compania.nombre) : '<span style="color:var(--danger);">Compañía no encontrada</span>';

    fichaSeccionCliente.innerHTML = `
      <h4>Cliente</h4>
      <div class="ficha-campos">
        ${campoFicha('Cliente', nombreCliente)}
        ${campoFicha('Nombre de quien recibe', persona)}
        ${campoFicha('NIT', nit)}
        ${campoFicha('Dirección', direccion)}
        ${campoFicha('Dirección de remisión', direccionRemision)}
        ${campoFicha('¿Contraentrega?', contraentrega)}
      </div>
    `;
  }

  function formatearPesoFicha(peso) {
    if (peso === undefined || peso === null || peso === '') return 'Sin peso';
    return `${peso} kg`;
  }

  function resumenSeriales(item, cantidad) {
    const seriales = (item.seriales || []).filter(s => s && s.trim());
    if (!seriales.length) {
      return `<span class="equipo-card-serial pendiente">🔴 Sin serial (0/${cantidad})</span>`;
    }
    if (seriales.length >= cantidad) {
      return `<span class="equipo-card-serial completo">🔢 ${seriales.map(escapeHtml).join(', ')}</span>`;
    }
    return `<span class="equipo-card-serial pendiente">🟡 ${seriales.map(escapeHtml).join(', ')} (${seriales.length}/${cantidad})</span>`;
  }

  function resumenEquiposPorTipo(pedido) {
    const equipos = pedido.equipos || [];
    if (!equipos.length) return 'Sin equipos agregados';
    const conteos = {};
    const orden = [];
    equipos.forEach(item => {
      const equipo = buscarEquipoCatalogo(item.equipoId);
      const tipo = equipo ? buscarTipoEquipo(equipo.tipoId) : null;
      const nombreTipo = tipo?.nombre || 'Sin tipo';
      if (!(nombreTipo in conteos)) orden.push(nombreTipo);
      conteos[nombreTipo] = (conteos[nombreTipo] || 0) + (item.cantidad || 0);
    });
    return orden.map(nombre => `${nombre} x ${conteos[nombre]} und`).join(', ');
  }

  function renderSeccionEquipos(pedido) {
    const equipos = pedido.equipos || [];
    if (!equipos.length) {
      fichaEquiposContenido.innerHTML = '<div class="empty-equipos-pedido">Este pedido no tiene equipos agregados.</div>';
      return;
    }

    fichaEquiposContenido.innerHTML = `<div class="equipos-cards-list">${equipos.map((item, index) => {
      const equipo = buscarEquipoCatalogo(item.equipoId);
      const tipo = equipo ? buscarTipoEquipo(equipo.tipoId) : null;
      const color = tipo?.color || '#5b6472';
      const icono = tipo?.icono || '📦';
      const nombreTipo = tipo?.nombre || 'Tipo desconocido';

      const nombreEquipo = equipo
        ? escapeHtml(equipo.nombre) + (equipo.variante ? ` <span class="tag-variante">${escapeHtml(equipo.variante)}</span>` : '')
        : '<span style="color:var(--danger);">Equipo no encontrado</span>';

      const usaSerial = !!equipo?.usaSerial;
      const ocHtml = item.ordenCompra
        ? `<div class="equipo-card-oc">📄 OC: ${escapeHtml(item.ordenCompra)}</div>`
        : '';
      const metaChips = `
        <span class="meta-chip">Cant: ${item.cantidad}</span>
        <span class="meta-chip">${formatearPesoFicha(equipo?.peso)}</span>
      `;

      return `
        <div class="equipo-card ${usaSerial ? 'clicable' : ''}" data-index="${index}" style="border-color:${color};">
          <div class="equipo-card-header" style="background:${color};">
            <span>${icono}</span><span>${escapeHtml(nombreTipo)}</span>
          </div>
          <div class="equipo-card-body" style="background:${color}15;">
            <div>
              <div class="equipo-card-nombre">${nombreEquipo}</div>
              ${ocHtml}
              <div class="equipo-card-meta">${metaChips}</div>
            </div>
            ${usaSerial ? resumenSeriales(item, item.cantidad) : ''}
          </div>
        </div>
      `;
    }).join('')}</div>`;

    fichaEquiposContenido.querySelectorAll('.equipo-card.clicable').forEach(card => {
      card.addEventListener('click', () => abrirModalSeriales(parseInt(card.dataset.index, 10)));
    });
  }

  function buscarTipoEquipo(tipoId) {
    return (window.tiposEquipoCache || []).find(t => t.id === tipoId) || null;
  }

  function abrirFicha(pedido) {
    pedidoIdEnFicha = pedido.id;
    const tipoInfo = TIPO_PEDIDO_LABEL[pedido.tipo] || TIPO_PEDIDO_LABEL.normal;
    const compania = buscarCompania(pedido.companiaId);
    const nombreCompania = compania ? compania.nombre : 'Compañía no encontrada';

    fichaHeaderNumero.textContent = `N${pedido.numero} - ${nombreCompania}`;
    fichaHeaderResumen.textContent = resumenEquiposPorTipo(pedido);
    fichaHeaderTags.innerHTML = `<span class="${tipoInfo.clase}">${tipoInfo.texto}</span>`;

    renderSeccionCliente(pedido);
    renderSeccionEquipos(pedido);
    resetFichaSubtabs();

    btnEditarDesdeFicha.dataset.id = pedido.id;
    modalFicha.classList.add('open');
  }

  function cerrarFicha() {
    modalFicha.classList.remove('open');
    pedidoIdEnFicha = null;
  }

  btnCerrarFicha.addEventListener('click', cerrarFicha);
  modalFicha.addEventListener('click', (e) => {
    if (e.target === modalFicha) cerrarFicha();
  });
  btnEditarDesdeFicha.addEventListener('click', () => {
    const pedido = pedidosCache.find(p => p.id === btnEditarDesdeFicha.dataset.id);
    origenEdicion = 'ficha';
    cerrarFicha();
    if (pedido) abrirModalEditar(pedido);
  });

  // ---------- Sub-modal: números de serial de un equipo del pedido ----------

  let indexEquipoEnSeriales = null;

  function abrirModalSeriales(index) {
    const pedido = pedidosCache.find(p => p.id === pedidoIdEnFicha);
    if (!pedido) return;
    const item = (pedido.equipos || [])[index];
    if (!item) return;
    const equipo = buscarEquipoCatalogo(item.equipoId);

    indexEquipoEnSeriales = index;
    modalSerialesTitulo.textContent = `Seriales — ${equipo ? equipo.nombre : 'Equipo'}`;

    const cantidad = item.cantidad || 1;
    const serialesActuales = item.seriales || [];
    serialesCampos.innerHTML = `<div class="seriales-campos-list">${
      Array.from({ length: cantidad }).map((_, i) => `
        <div class="serial-campo">
          <label>Unidad ${i + 1}</label>
          <input type="text" class="serial-input" value="${serialesActuales[i] ? escapeHtml(serialesActuales[i]) : ''}" placeholder="Número de serial">
        </div>
      `).join('')
    }</div>`;

    modalSeriales.classList.add('open');
  }

  function cerrarModalSeriales() {
    modalSeriales.classList.remove('open');
    indexEquipoEnSeriales = null;
  }

  btnCancelarSeriales.addEventListener('click', cerrarModalSeriales);
  modalSeriales.addEventListener('click', (e) => {
    if (e.target === modalSeriales) cerrarModalSeriales();
  });

  btnGuardarSeriales.addEventListener('click', async () => {
    const pedido = pedidosCache.find(p => p.id === pedidoIdEnFicha);
    if (!pedido || indexEquipoEnSeriales === null) return;

    const nuevosSeriales = Array.from(serialesCampos.querySelectorAll('.serial-input')).map(inp => inp.value.trim());
    const equiposActualizados = (pedido.equipos || []).map((item, i) =>
      i === indexEquipoEnSeriales ? { ...item, seriales: nuevosSeriales } : item
    );

    btnGuardarSeriales.disabled = true;
    btnGuardarSeriales.textContent = 'Guardando...';
    try {
      await db.collection(COLECCION).doc(pedido.id).update({ equipos: equiposActualizados });
      cerrarModalSeriales();
      // La ficha se refresca sola con el próximo snapshot; refrescamos ya
      // mismo con los datos locales para que se sienta instantáneo.
      renderSeccionEquipos({ ...pedido, equipos: equiposActualizados });
    } catch (err) {
      console.error('Error guardando seriales:', err);
      alert('No se pudieron guardar los seriales. Revisa la consola.');
    } finally {
      btnGuardarSeriales.disabled = false;
      btnGuardarSeriales.textContent = 'Guardar';
    }
  });

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
      const tipoInfo = TIPO_PEDIDO_LABEL[pedido.tipo] || TIPO_PEDIDO_LABEL.normal;

      return `
        <tr data-id="${pedido.id}" class="fila-pedido-clicable">
          <td><strong>${pedido.numero}</strong></td>
          <td>${nombreCompania}</td>
          <td>${pedido.contacto ? escapeHtml(pedido.contacto) : '<span style="color:var(--ink-soft);">—</span>'}</td>
          <td><span class="${tipoInfo.clase}">${tipoInfo.texto}</span></td>
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

    // Clic en cualquier parte de la fila (fuera de los botones) abre la Ficha de solo lectura.
    tablaBody.querySelectorAll('tr.fila-pedido-clicable').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button')) return; // los botones tienen su propio comportamiento
        const pedido = pedidosCache.find(p => p.id === tr.dataset.id);
        if (pedido) abrirFicha(pedido);
      });
    });

    tablaBody.querySelectorAll('.btn-editar').forEach(btn => {
      btn.addEventListener('click', () => {
        const pedido = pedidosCache.find(p => p.id === btn.dataset.id);
        if (pedido) {
          origenEdicion = null;
          abrirModalEditar(pedido);
        }
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
