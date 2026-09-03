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

  function normalizar(str) {
    return String(str ?? '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function nombreMostrableEquipo(eq) {
    return eq.nombre + (eq.variante ? ` (${eq.variante})` : '');
  }

  // Buscador con autocompletar para elegir un equipo del catálogo, filtrado
  // opcionalmente por tipo (usado para Motor/Reductor dentro de Motoreductor).
  // El contenedor debe tener: input.buscador-input, input[type=hidden] (guarda
  // el id elegido) y div.buscador-resultados.
  function inicializarBuscadorEquipo(contenedor, { tipoNombre, seleccionInicialId, onChange }) {
    const inputTexto = contenedor.querySelector('.buscador-input');
    const inputValor = contenedor.querySelector('input[type="hidden"]');
    const resultados = contenedor.querySelector('.buscador-resultados');

    function catalogoFiltrado(texto) {
      const equipos = window.equiposCache || [];
      const porTipo = tipoNombre
        ? equipos.filter(eq => normalizar(buscarTipoEquipo(eq.tipoId)?.nombre) === tipoNombre)
        : equipos;
      const t = normalizar(texto);
      const coincidencias = t
        ? porTipo.filter(eq => normalizar(eq.nombre + ' ' + (eq.variante || '')).includes(t))
        : porTipo;
      return coincidencias.slice(0, 8);
    }

    function mostrarResultados() {
      const lista = catalogoFiltrado(inputTexto.value);
      resultados.innerHTML = lista.length
        ? lista.map(eq => `<div class="buscador-item" data-id="${eq.id}">${escapeHtml(nombreMostrableEquipo(eq))}</div>`).join('')
        : `<div class="buscador-item-vacio">Sin coincidencias en el catálogo</div>`;
      resultados.classList.add('open');
      resultados.querySelectorAll('.buscador-item').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault(); // evita que el blur del input cierre la lista antes del click
          const eq = (window.equiposCache || []).find(x => x.id === el.dataset.id);
          if (eq) seleccionar(eq);
        });
      });
    }

    function seleccionar(eq) {
      inputValor.value = eq.id;
      inputTexto.value = nombreMostrableEquipo(eq);
      resultados.classList.remove('open');
      if (onChange) onChange(eq.id);
    }

    inputTexto.addEventListener('input', () => {
      inputValor.value = ''; // hasta que elija algo de la lista, no hay selección válida
      mostrarResultados();
      if (onChange) onChange('');
    });
    inputTexto.addEventListener('focus', mostrarResultados);
    inputTexto.addEventListener('blur', () => {
      setTimeout(() => resultados.classList.remove('open'), 120);
    });

    if (seleccionInicialId) {
      const eq = (window.equiposCache || []).find(x => x.id === seleccionInicialId);
      if (eq) {
        inputValor.value = eq.id;
        inputTexto.value = nombreMostrableEquipo(eq);
      }
    }
  }

  function nuevaFilaEquipoPedido(item) {
    const esMotoreductor = item?.tipoLinea === 'motoreductor';

    const row = document.createElement('div');
    row.className = 'equipo-pedido-row-wrap';
    row.innerHTML = `
      <label class="extra-check chk-es-motoreductor" style="margin-bottom:8px;">
        <input type="checkbox" class="equipo-pedido-es-motoreductor" ${esMotoreductor ? 'checked' : ''}>
        🔗 Es Motoreductor (Motor + Reductor)
      </label>

      <div class="equipo-pedido-row bloque-individual" style="${esMotoreductor ? 'display:none;' : ''}">
        <select class="equipo-pedido-select">${opcionesEquiposHtml(!esMotoreductor ? item?.equipoId : null)}</select>
        <input type="number" class="equipo-pedido-cantidad" min="1" step="1" placeholder="Cant." value="${item?.cantidad ?? 1}">
        <input type="text" class="equipo-pedido-oc" placeholder="Orden de compra (opcional)" value="${item?.ordenCompra ? escapeHtml(item.ordenCompra) : ''}">
        <button type="button" class="remove-equipo-pedido" title="Quitar equipo">✕</button>
      </div>

      <div class="equipo-pedido-motoreductor" style="${esMotoreductor ? '' : 'display:none;'}">
        <div class="motoreductor-selects">
          <div>
            <label class="mini-label">⚡ Motor</label>
            <div class="buscador-equipo">
              <input type="text" class="buscador-input" placeholder="Escribe para buscar motor..." autocomplete="off">
              <input type="hidden" class="equipo-pedido-motor">
              <div class="buscador-resultados"></div>
            </div>
          </div>
          <div>
            <label class="mini-label">⚙️ Reductor</label>
            <div class="buscador-equipo">
              <input type="text" class="buscador-input" placeholder="Escribe para buscar reductor..." autocomplete="off">
              <input type="hidden" class="equipo-pedido-reductor">
              <div class="buscador-resultados"></div>
            </div>
          </div>
        </div>
        <div class="equipo-pedido-row" style="grid-template-columns: 80px 1fr auto; margin-top:8px;">
          <input type="number" class="equipo-pedido-cantidad-mr" min="1" step="1" placeholder="Cant." value="${item?.cantidad ?? 1}">
          <input type="text" class="equipo-pedido-oc-mr" placeholder="Orden de compra (opcional)" value="${item?.ordenCompra ? escapeHtml(item.ordenCompra) : ''}">
          <button type="button" class="remove-equipo-pedido" title="Quitar equipo">✕</button>
        </div>
      </div>

      <div class="equipo-pedido-extra">
        <label class="extra-check chk-brazo" style="display:none;">
          <input type="checkbox" class="equipo-pedido-brazo" ${item?.llevaBrazo ? 'checked' : ''}>
          🦾 Lleva brazo de reacción
        </label>
        <label class="extra-check chk-eje" style="display:none;">
          <input type="checkbox" class="equipo-pedido-eje" ${item?.llevaEje ? 'checked' : ''}>
          🔩 Lleva eje sólido
        </label>
        <label class="extra-check chk-preparado">
          <input type="checkbox" class="equipo-pedido-preparado" ${item?.preparado ? 'checked' : ''}>
          ✅ Preparado
        </label>
      </div>
    `;
    row.querySelectorAll('.remove-equipo-pedido').forEach(btn => btn.addEventListener('click', () => row.remove()));

    const chkEsMotoreductor = row.querySelector('.equipo-pedido-es-motoreductor');
    const bloqueIndividual = row.querySelector('.bloque-individual');
    const bloqueMotoreductor = row.querySelector('.equipo-pedido-motoreductor');
    const selectIndividual = row.querySelector('.equipo-pedido-select');
    const selectReductor = row.querySelector('.equipo-pedido-reductor');

    function actualizarModo() {
      const activo = chkEsMotoreductor.checked;
      bloqueIndividual.style.display = activo ? 'none' : 'grid';
      bloqueMotoreductor.style.display = activo ? 'block' : 'none';
      actualizarExtrasVisibles();
    }

    function actualizarExtrasVisibles() {
      // El brazo/eje siempre depende del REDUCTOR: en modo individual, si lo que
      // eligieron ES un reductor; en modo motoreductor, del reductor seleccionado.
      const equipoRelevante = chkEsMotoreductor.checked
        ? buscarEquipoCatalogo(selectReductor.value)
        : buscarEquipoCatalogo(selectIndividual.value);
      const chkBrazo = row.querySelector('.chk-brazo');
      const chkEje = row.querySelector('.chk-eje');
      const mostrarBrazo = !!equipoRelevante?.puedeLlevarBrazo;
      const mostrarEje = !!equipoRelevante?.puedeLlevarEjeSolido;
      chkBrazo.style.display = mostrarBrazo ? 'flex' : 'none';
      chkEje.style.display = mostrarEje ? 'flex' : 'none';
      if (!mostrarBrazo) chkBrazo.querySelector('input').checked = false;
      if (!mostrarEje) chkEje.querySelector('input').checked = false;
    }

    chkEsMotoreductor.addEventListener('change', actualizarModo);
    selectIndividual.addEventListener('change', actualizarExtrasVisibles);
    actualizarModo(); // aplica el modo inicial y calcula brazo/eje visibles

    const contenedoresBuscador = row.querySelectorAll('.buscador-equipo');
    const contenedorMotor = contenedoresBuscador[0];
    const contenedorReductor = contenedoresBuscador[1];

    inicializarBuscadorEquipo(contenedorMotor, {
      tipoNombre: 'motor',
      seleccionInicialId: esMotoreductor ? item?.motorEquipoId : null
    });
    inicializarBuscadorEquipo(contenedorReductor, {
      tipoNombre: 'reductor',
      seleccionInicialId: esMotoreductor ? item?.reductorEquipoId : null,
      onChange: actualizarExtrasVisibles
    });
    actualizarExtrasVisibles(); // por si ya venía un reductor precargado (editar pedido)

    equiposPedidoList.appendChild(row);
  }

  function leerEquiposDelFormulario() {
    const filas = equiposPedidoList.querySelectorAll('.equipo-pedido-row-wrap');
    const items = [];
    filas.forEach(fila => {
      const llevaBrazo = fila.querySelector('.equipo-pedido-brazo').checked;
      const llevaEje = fila.querySelector('.equipo-pedido-eje').checked;
      const preparado = fila.querySelector('.equipo-pedido-preparado').checked;
      const esMotoreductor = fila.querySelector('.equipo-pedido-es-motoreductor').checked;

      if (esMotoreductor) {
        const motorEquipoId = fila.querySelector('.equipo-pedido-motor').value;
        const reductorEquipoId = fila.querySelector('.equipo-pedido-reductor').value;
        if (!motorEquipoId || !reductorEquipoId) return; // ignora filas incompletas
        const cantidad = parseInt(fila.querySelector('.equipo-pedido-cantidad-mr').value, 10) || 1;
        const ordenCompra = fila.querySelector('.equipo-pedido-oc-mr').value.trim();
        items.push({ tipoLinea: 'motoreductor', motorEquipoId, reductorEquipoId, cantidad, ordenCompra, llevaBrazo, llevaEje, preparado });
      } else {
        const equipoId = fila.querySelector('.equipo-pedido-select').value;
        if (!equipoId) return; // ignora filas sin equipo elegido
        const cantidad = parseInt(fila.querySelector('.equipo-pedido-cantidad').value, 10) || 1;
        const ordenCompra = fila.querySelector('.equipo-pedido-oc').value.trim();
        items.push({ tipoLinea: 'individual', equipoId, cantidad, ordenCompra, llevaBrazo, llevaEje, preparado });
      }
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

  // Igual que en equipos.js: para un Acople compuesto, el peso real es la suma
  // de (peso de cada pieza x su cantidad) — se recalcula aquí también porque
  // esta pestaña usa su propio window.equiposCache.
  function calcularPesoEquipo(equipo) {
    if (!equipo?.esCompuesto || !(equipo.piezasCompuesto || []).length) {
      return equipo?.peso ?? null;
    }
    let total = 0;
    for (const p of equipo.piezasCompuesto) {
      const pieza = buscarEquipoCatalogo(p.piezaId);
      if (!pieza || pieza.peso === undefined || pieza.peso === null) return null;
      total += pieza.peso * (p.cantidad || 1);
    }
    return Math.round(total * 100) / 100;
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

  const COLOR_PREPARADO = '#2f8f5b'; // mismo verde que --ok

  function renderTarjetaIndividual(item, index) {
    const equipo = buscarEquipoCatalogo(item.equipoId);
    const tipo = equipo ? buscarTipoEquipo(equipo.tipoId) : null;
    const preparado = !!item.preparado;
    const color = preparado ? COLOR_PREPARADO : (tipo?.color || '#5b6472');
    const icono = preparado ? '✅' : (tipo?.icono || '📦');
    const nombreTipo = tipo?.nombre || 'Tipo desconocido';

    const extrasNombre = [
      item.llevaBrazo ? '+ Brazo de reacción' : '',
      item.llevaEje ? '+ Eje sólido' : ''
    ].filter(Boolean).map(t => ` ${escapeHtml(t)}`).join('');

    const nombreEquipo = equipo
      ? escapeHtml(equipo.nombre) + (equipo.variante ? ` <span class="tag-variante">${escapeHtml(equipo.variante)}</span>` : '') + extrasNombre
      : '<span style="color:var(--danger);">Equipo no encontrado</span>';

    const usaSerial = !!equipo?.usaSerial;
    const ocHtml = item.ordenCompra
      ? `<div class="equipo-card-oc">📄 OC: ${escapeHtml(item.ordenCompra)}</div>`
      : '';
    const metaChips = `<span class="meta-chip">${formatearPesoFicha(calcularPesoEquipo(equipo))}</span>`;

    return `
      <div class="equipo-card ${usaSerial ? 'clicable' : ''} ${preparado ? 'preparado' : ''}" data-index="${index}" style="border-color:${color};">
        <div class="equipo-card-header" style="background:${color};">
          <span>${icono}</span><span>${escapeHtml(nombreTipo)} x ${item.cantidad}</span>
          ${preparado ? '<span class="equipo-card-preparado-tag">Preparado</span>' : ''}
        </div>
        <div class="equipo-card-body" style="background:${color}15;">
          <div>
            <div class="equipo-card-nombre">${nombreEquipo}</div>
            ${ocHtml}
            <div class="equipo-card-meta">${metaChips}</div>
          </div>
          ${usaSerial ? resumenSeriales(item, item.cantidad) : ''}
        </div>
        <label class="equipo-card-preparado-toggle">
          <input type="checkbox" class="chk-preparado-card" data-index="${index}" ${preparado ? 'checked' : ''}>
          Marcar como preparado
        </label>
      </div>
    `;
  }

  function renderTarjetaMotoreductor(item, index) {
    const motor = buscarEquipoCatalogo(item.motorEquipoId);
    const reductor = buscarEquipoCatalogo(item.reductorEquipoId);
    const tipoMotoreductor = (window.tiposEquipoCache || []).find(t => normalizar(t.nombre) === 'motoreductor');
    const preparado = !!item.preparado;
    const color = preparado ? COLOR_PREPARADO : (tipoMotoreductor?.color || '#2e7d32');
    const icono = preparado ? '✅' : (tipoMotoreductor?.icono || '🔧');

    const extrasReductor = [
      item.llevaBrazo ? '+ Brazo de reacción' : '',
      item.llevaEje ? '+ Eje sólido' : ''
    ].filter(Boolean).map(t => ` ${escapeHtml(t)}`).join('');

    const nombreMotor = motor
      ? escapeHtml(motor.nombre) + (motor.variante ? ` <span class="tag-variante">${escapeHtml(motor.variante)}</span>` : '')
      : '<span style="color:var(--danger);">Motor no encontrado</span>';
    const nombreReductor = reductor
      ? escapeHtml(reductor.nombre) + (reductor.variante ? ` <span class="tag-variante">${escapeHtml(reductor.variante)}</span>` : '') + extrasReductor
      : '<span style="color:var(--danger);">Reductor no encontrado</span>';

    const usaSerialMotor = !!motor?.usaSerial;
    const usaSerialReductor = !!reductor?.usaSerial;
    const esClicable = usaSerialMotor || usaSerialReductor;

    const ocHtml = item.ordenCompra
      ? `<div class="equipo-card-oc">📄 OC: ${escapeHtml(item.ordenCompra)}</div>`
      : '';

    return `
      <div class="equipo-card ${esClicable ? 'clicable' : ''} ${preparado ? 'preparado' : ''}" data-index="${index}" style="border-color:${color};">
        <div class="equipo-card-header" style="background:${color};">
          <span>${icono}</span><span>Motoreductor x ${item.cantidad}</span>
          ${preparado ? '<span class="equipo-card-preparado-tag">Preparado</span>' : ''}
        </div>
        <div class="equipo-card-body" style="background:${color}15; flex-direction:column; align-items:stretch;">
          ${ocHtml}
          <div class="motoreductor-subitem">
            <div class="equipo-card-nombre">⚡ ${nombreMotor}</div>
            <div class="equipo-card-meta">
              <span class="meta-chip">${formatearPesoFicha(motor?.peso)}</span>
            </div>
            ${usaSerialMotor ? resumenSeriales({ seriales: item.serialesMotor }, item.cantidad) : ''}
          </div>
          <div class="motoreductor-subitem">
            <div class="equipo-card-nombre">⚙️ ${nombreReductor}</div>
            <div class="equipo-card-meta">
              <span class="meta-chip">${formatearPesoFicha(reductor?.peso)}</span>
            </div>
            ${usaSerialReductor ? resumenSeriales({ seriales: item.serialesReductor }, item.cantidad) : ''}
          </div>
        </div>
        <label class="equipo-card-preparado-toggle">
          <input type="checkbox" class="chk-preparado-card" data-index="${index}" ${preparado ? 'checked' : ''}>
          Marcar como preparado
        </label>
      </div>
    `;
  }

  function renderSeccionEquipos(pedido) {
    const equipos = pedido.equipos || [];
    if (!equipos.length) {
      fichaEquiposContenido.innerHTML = '<div class="empty-equipos-pedido">Este pedido no tiene equipos agregados.</div>';
      return;
    }

    fichaEquiposContenido.innerHTML = `<div class="equipos-cards-list">${equipos.map((item, index) =>
      item.tipoLinea === 'motoreductor' ? renderTarjetaMotoreductor(item, index) : renderTarjetaIndividual(item, index)
    ).join('')}</div>`;

    fichaEquiposContenido.querySelectorAll('.equipo-card.clicable').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.equipo-card-preparado-toggle')) return; // el checkbox tiene su propia acción
        abrirModalSeriales(parseInt(card.dataset.index, 10));
      });
    });

    fichaEquiposContenido.querySelectorAll('.chk-preparado-card').forEach(chk => {
      chk.addEventListener('click', (e) => e.stopPropagation());
      chk.addEventListener('change', () => togglePreparado(parseInt(chk.dataset.index, 10), chk.checked));
    });
  }

  function buscarTipoEquipo(tipoId) {
    return (window.tiposEquipoCache || []).find(t => t.id === tipoId) || null;
  }

  async function togglePreparado(index, preparado) {
    const pedido = pedidosCache.find(p => p.id === pedidoIdEnFicha);
    if (!pedido) return;
    const equiposActualizados = (pedido.equipos || []).map((item, i) =>
      i === index ? { ...item, preparado } : item
    );
    try {
      await db.collection(COLECCION).doc(pedido.id).update({ equipos: equiposActualizados });
      renderSeccionEquipos({ ...pedido, equipos: equiposActualizados });
    } catch (err) {
      console.error('Error actualizando estado preparado:', err);
      alert('No se pudo actualizar. Revisa la consola.');
    }
  }

  function abrirFicha(pedido) {
    pedidoIdEnFicha = pedido.id;
    const tipoInfo = TIPO_PEDIDO_LABEL[pedido.tipo] || TIPO_PEDIDO_LABEL.normal;
    const compania = buscarCompania(pedido.companiaId);
    const nombreCompania = compania ? compania.nombre : 'Compañía no encontrada';

    fichaHeaderNumero.textContent = `N${pedido.numero} - ${nombreCompania}`;
    fichaHeaderTags.innerHTML = `<span class="${tipoInfo.clase}">${tipoInfo.texto}</span>`;

    renderSeccionCliente(pedido);
    renderSeccionEquipos(pedido);
    renderEnviosVinculados();
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

  function camposSerialesHtml(prefijoClase, cantidad, serialesActuales, etiqueta) {
    return `
      <div class="seriales-grupo-titulo">${etiqueta}</div>
      <div class="seriales-campos-list">${
        Array.from({ length: cantidad }).map((_, i) => `
          <div class="serial-campo">
            <label>Unidad ${i + 1}</label>
            <input type="text" class="${prefijoClase}" value="${serialesActuales[i] ? escapeHtml(serialesActuales[i]) : ''}" placeholder="Número de serial">
          </div>
        `).join('')
      }</div>
    `;
  }

  function abrirModalSeriales(index) {
    const pedido = pedidosCache.find(p => p.id === pedidoIdEnFicha);
    if (!pedido) return;
    const item = (pedido.equipos || [])[index];
    if (!item) return;

    indexEquipoEnSeriales = index;
    const cantidad = item.cantidad || 1;

    if (item.tipoLinea === 'motoreductor') {
      const motor = buscarEquipoCatalogo(item.motorEquipoId);
      const reductor = buscarEquipoCatalogo(item.reductorEquipoId);
      modalSerialesTitulo.textContent = 'Seriales — Motoreductor';

      let html = '';
      if (motor?.usaSerial) html += camposSerialesHtml('serial-input-motor', cantidad, item.serialesMotor || [], `⚡ Motor — ${escapeHtml(motor.nombre)}`);
      if (reductor?.usaSerial) html += camposSerialesHtml('serial-input-reductor', cantidad, item.serialesReductor || [], `⚙️ Reductor — ${escapeHtml(reductor.nombre)}`);
      serialesCampos.innerHTML = html || '<div class="empty-equipos-pedido">Ninguna de las dos piezas usa número serial.</div>';
    } else {
      const equipo = buscarEquipoCatalogo(item.equipoId);
      modalSerialesTitulo.textContent = `Seriales — ${equipo ? equipo.nombre : 'Equipo'}`;
      serialesCampos.innerHTML = camposSerialesHtml('serial-input', cantidad, item.seriales || [], '');
    }

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
    const itemActual = (pedido.equipos || [])[indexEquipoEnSeriales];
    if (!itemActual) return;

    let cambios;
    if (itemActual.tipoLinea === 'motoreductor') {
      const serialesMotor = Array.from(serialesCampos.querySelectorAll('.serial-input-motor')).map(inp => inp.value.trim());
      const serialesReductor = Array.from(serialesCampos.querySelectorAll('.serial-input-reductor')).map(inp => inp.value.trim());
      cambios = {
        ...(serialesMotor.length ? { serialesMotor } : {}),
        ...(serialesReductor.length ? { serialesReductor } : {})
      };
    } else {
      const seriales = Array.from(serialesCampos.querySelectorAll('.serial-input')).map(inp => inp.value.trim());
      cambios = { seriales };
    }

    const equiposActualizados = (pedido.equipos || []).map((item, i) =>
      i === indexEquipoEnSeriales ? { ...item, ...cambios } : item
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

  // ---------- Envío / Despacho (sub-pestaña de la Ficha) ----------
  // Los envíos son documentos independientes (colección "envios", ver envios.js)
  // porque VARIOS pedidos pueden compartir el mismo envío/remesa. Aquí solo se
  // vinculan/consultan desde la ficha del pedido.

  const COLECCION_ENVIOS = 'envios';
  const btnAgregarAEnvio = document.getElementById('btn-agregar-a-envio');
  const enviosVinculadosContenido = document.getElementById('envios-vinculados-contenido');

  const modalAgregarEnvio = document.getElementById('modal-agregar-envio');
  const formAgregarEnvio = document.getElementById('form-agregar-envio');
  const selectQuienEncarga = document.getElementById('envio-quien-encarga');
  const grupoPersonaRecoge = document.getElementById('grupo-persona-recoge');
  const inputPersonaRecoge = document.getElementById('envio-persona-recoge');
  const radiosModoEnvio = formAgregarEnvio.querySelectorAll('input[name="modo-envio"]');
  const grupoEnvioExistente = document.getElementById('grupo-envio-existente');
  const selectEnvioExistente = document.getElementById('envio-existente-select');
  const grupoRemesa = document.getElementById('grupo-remesa');
  const inputRemesaEnvio = document.getElementById('envio-remesa');
  const inputRemisionEnvio = document.getElementById('envio-remision');
  const equiposEnvioList = document.getElementById('equipos-envio-list');
  const btnCancelarAgregarEnvio = document.getElementById('btn-cancelar-agregar-envio');

  function nombreItemPedido(item) {
    if (item.tipoLinea === 'motoreductor') {
      const motor = buscarEquipoCatalogo(item.motorEquipoId);
      const reductor = buscarEquipoCatalogo(item.reductorEquipoId);
      return `Motoreductor (${motor ? motor.nombre : '?'} + ${reductor ? reductor.nombre : '?'})`;
    }
    const equipo = buscarEquipoCatalogo(item.equipoId);
    return equipo ? equipo.nombre + (equipo.variante ? ` (${equipo.variante})` : '') : 'Equipo no encontrado';
  }

  function cantidadReservadaEnEnvios(pedidoId, itemIndex, excluirEnvioId) {
    let total = 0;
    (window.enviosCache || []).forEach(envio => {
      if (excluirEnvioId && envio.id === excluirEnvioId) return;
      (envio.pedidos || []).forEach(pInfo => {
        if (pInfo.pedidoId !== pedidoId) return;
        (pInfo.items || []).forEach(it => {
          if (it.itemIndex === itemIndex) total += it.cantidad || 0;
        });
      });
    });
    return total;
  }

  function nombreQuienEncargaEnvio(envio) {
    if (envio.esInterno) return '🏠 Interno' + (envio.personaRecoge ? ` — ${escapeHtml(envio.personaRecoge)}` : '');
    const empresa = (window.empresasEnvioCache || []).find(e => e.id === envio.empresaEnvioId);
    return empresa ? escapeHtml(empresa.nombre) : '<span style="color:var(--danger);">Empresa no encontrada</span>';
  }

  function renderEnviosVinculados() {
    const pedido = pedidosCache.find(p => p.id === pedidoIdEnFicha);
    if (!pedido) return;

    const vinculados = (window.enviosCache || []).filter(envio =>
      (envio.pedidos || []).some(pInfo => pInfo.pedidoId === pedido.id)
    );

    if (!vinculados.length) {
      enviosVinculadosContenido.innerHTML = '<div class="empty-equipos-pedido">Este pedido todavía no está en ningún envío.</div>';
      return;
    }

    enviosVinculadosContenido.innerHTML = vinculados.map(envio => {
      const pInfo = (envio.pedidos || []).find(p => p.pedidoId === pedido.id);
      const estadoTag = envio.estado === 'despachado'
        ? '<span class="tag-envio-despachado">Despachado</span>'
        : '<span class="tag-envio-armado">Armado</span>';
      const itemsHtml = (pInfo?.items || []).map(it => {
        const item = pedido.equipos?.[it.itemIndex];
        return item ? `<div class="item-linea"><span>${escapeHtml(nombreItemPedido(item))}</span><span>cant. ${it.cantidad}</span></div>` : '';
      }).join('');

      return `
        <div class="envio-vinculado-card" data-envio-id="${envio.id}">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong style="font-size:13.5px;">${nombreQuienEncargaEnvio(envio)}</strong>
            ${estadoTag}
          </div>
          <div class="remision-card" style="margin-bottom:0;">
            <div class="remision-card-header">
              <span class="remision-card-pedido">${envio.remesa ? 'Remesa ' + escapeHtml(envio.remesa) : 'Sin remesa'}</span>
              <span class="remision-card-numero">Remisión ${escapeHtml(pInfo?.remision || '—')}</span>
            </div>
            <div class="remision-card-items">${itemsHtml || 'Sin equipos'}</div>
          </div>
        </div>
      `;
    }).join('');

    enviosVinculadosContenido.querySelectorAll('.envio-vinculado-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.envioId;
        cerrarFicha();
        if (window.abrirFichaEnvio) window.abrirFichaEnvio(id);
      });
    });
  }

  document.addEventListener('envios:cambio', () => {
    if (pedidoIdEnFicha) renderEnviosVinculados();
  });
  document.addEventListener('empresas-envio:cambio', () => {
    if (pedidoIdEnFicha) renderEnviosVinculados();
  });

  // ---------- Modal: agregar el pedido actual a un envío ----------

  function poblarSelectQuienEncarga() {
    const empresas = window.empresasEnvioCache || [];
    const actual = selectQuienEncarga.value;
    selectQuienEncarga.innerHTML = '<option value="interno">🏠 Interno</option>' +
      empresas.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)}</option>`).join('');
    selectQuienEncarga.value = actual || 'interno';
  }

  function poblarSelectEnvioExistente() {
    const pedido = pedidosCache.find(p => p.id === pedidoIdEnFicha);
    const quien = selectQuienEncarga.value;
    const candidatos = (window.enviosCache || []).filter(envio => {
      if (envio.estado !== 'armado') return false;
      if (quien === 'interno') return envio.esInterno;
      return !envio.esInterno && envio.empresaEnvioId === quien;
    });
    if (!candidatos.length) {
      selectEnvioExistente.innerHTML = '<option value="">No hay envíos armados con este criterio</option>';
      return;
    }
    selectEnvioExistente.innerHTML = '<option value="">Selecciona...</option>' + candidatos.map(envio => {
      const cant = (envio.pedidos || []).length;
      const label = `${envio.remesa ? 'Remesa ' + envio.remesa : (envio.personaRecoge || 'Interno')} (${cant} ${cant === 1 ? 'pedido' : 'pedidos'})`;
      return `<option value="${envio.id}">${escapeHtml(label)}</option>`;
    }).join('');
  }

  function actualizarVisibilidadCamposEnvio() {
    const esInterno = selectQuienEncarga.value === 'interno';
    grupoPersonaRecoge.style.display = esInterno ? 'block' : 'none';

    const modo = Array.from(radiosModoEnvio).find(r => r.checked)?.value || 'nuevo';
    grupoEnvioExistente.style.display = modo === 'existente' ? 'block' : 'none';
    grupoRemesa.style.display = (modo === 'nuevo' && !esInterno) ? 'block' : 'none';

    if (modo === 'existente') poblarSelectEnvioExistente();
  }

  selectQuienEncarga.addEventListener('change', actualizarVisibilidadCamposEnvio);
  radiosModoEnvio.forEach(r => r.addEventListener('change', actualizarVisibilidadCamposEnvio));

  function poblarChecklistEquipos() {
    const pedido = pedidosCache.find(p => p.id === pedidoIdEnFicha);
    if (!pedido) { equiposEnvioList.innerHTML = ''; return; }

    const items = pedido.equipos || [];
    if (!items.length) {
      equiposEnvioList.innerHTML = '<div class="empty-equipos-pedido">Este pedido no tiene equipos.</div>';
      return;
    }

    equiposEnvioList.innerHTML = items.map((item, index) => {
      const total = item.cantidad || 0;
      const reservado = cantidadReservadaEnEnvios(pedido.id, index);
      const disponible = Math.max(0, total - reservado);
      return `
        <div class="equipo-envio-row ${disponible <= 0 ? 'sin-disponible' : ''}" data-index="${index}">
          <input type="checkbox" class="equipo-envio-check" ${disponible <= 0 ? 'disabled' : ''}>
          <label>
            ${escapeHtml(nombreItemPedido(item))}
            <span class="disponible-nota">Disponible: ${disponible} de ${total}</span>
          </label>
          <input type="number" class="equipo-envio-cantidad" min="1" max="${disponible}" value="${disponible}" ${disponible <= 0 ? 'disabled' : ''}>
        </div>
      `;
    }).join('');
  }

  function abrirModalAgregarEnvio() {
    formAgregarEnvio.reset();
    poblarSelectQuienEncarga();
    poblarChecklistEquipos();
    actualizarVisibilidadCamposEnvio();
    modalAgregarEnvio.classList.add('open');
  }

  function cerrarModalAgregarEnvio() {
    modalAgregarEnvio.classList.remove('open');
  }

  btnAgregarAEnvio.addEventListener('click', abrirModalAgregarEnvio);
  btnCancelarAgregarEnvio.addEventListener('click', cerrarModalAgregarEnvio);
  modalAgregarEnvio.addEventListener('click', (e) => {
    if (e.target === modalAgregarEnvio) cerrarModalAgregarEnvio();
  });

  formAgregarEnvio.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pedido = pedidosCache.find(p => p.id === pedidoIdEnFicha);
    if (!pedido) return;

    const quien = selectQuienEncarga.value;
    const esInterno = quien === 'interno';
    const modo = Array.from(radiosModoEnvio).find(r => r.checked)?.value || 'nuevo';
    const remision = inputRemisionEnvio.value.trim();

    if (!remision) {
      inputRemisionEnvio.focus();
      return;
    }
    if (modo === 'existente' && !selectEnvioExistente.value) {
      selectEnvioExistente.focus();
      return;
    }

    const filas = equiposEnvioList.querySelectorAll('.equipo-envio-row');
    const items = [];
    filas.forEach(fila => {
      const chk = fila.querySelector('.equipo-envio-check');
      if (!chk.checked) return;
      const cantidad = parseInt(fila.querySelector('.equipo-envio-cantidad').value, 10) || 0;
      if (cantidad <= 0) return;
      items.push({ itemIndex: parseInt(fila.dataset.index, 10), cantidad });
    });

    if (!items.length) {
      alert('Selecciona al menos un equipo para agregar al envío.');
      return;
    }

    const btnGuardar = formAgregarEnvio.querySelector('button[type="submit"]');
    btnGuardar.disabled = true;
    btnGuardar.textContent = 'Guardando...';

    try {
      if (modo === 'existente') {
        const envioRef = db.collection(COLECCION_ENVIOS).doc(selectEnvioExistente.value);
        const snap = await envioRef.get(); // se lee fresco de Firestore, no del caché local,
        if (!snap.exists) throw new Error('Envío existente no encontrado');       // para no pisar remisiones de otros pedidos agregados justo antes
        const envioFresco = snap.data();
        const pedidosActuales = envioFresco.pedidos || [];
        const yaExiste = pedidosActuales.find(p => p.pedidoId === pedido.id);
        let nuevosPedidos;
        if (yaExiste) {
          nuevosPedidos = pedidosActuales.map(p => {
            if (p.pedidoId !== pedido.id) return p;
            const itemsCombinados = [...(p.items || [])];
            items.forEach(nuevo => {
              const existente = itemsCombinados.find(it => it.itemIndex === nuevo.itemIndex);
              if (existente) existente.cantidad += nuevo.cantidad;
              else itemsCombinados.push(nuevo);
            });
            return { ...p, remision, items: itemsCombinados };
          });
        } else {
          nuevosPedidos = [...pedidosActuales, { pedidoId: pedido.id, remision, items }];
        }
        await envioRef.update({ pedidos: nuevosPedidos });
      } else {
        const nuevoEnvio = {
          esInterno,
          empresaEnvioId: esInterno ? null : quien,
          personaRecoge: esInterno ? inputPersonaRecoge.value.trim() : '',
          remesa: (!esInterno && inputRemesaEnvio.value.trim()) ? inputRemesaEnvio.value.trim() : '',
          estado: 'armado',
          fechaDespacho: null,
          pedidos: [{ pedidoId: pedido.id, remision, items }],
          creadoEn: firebase.firestore.FieldValue.serverTimestamp()
        };
        await db.collection(COLECCION_ENVIOS).add(nuevoEnvio);
      }
      formAgregarEnvio.reset();
      cerrarModalAgregarEnvio();
    } catch (err) {
      console.error('Error agregando el pedido al envío:', err);
      alert('No se pudo guardar. Revisa la consola.');
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = 'Guardar';
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
        window.pedidosCache = pedidosCache;
        renderTabla();
        document.dispatchEvent(new CustomEvent('pedidos:cambio', { detail: { pedidos: pedidosCache } }));
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
