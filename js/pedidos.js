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

  const modalFichaDevolucion = document.getElementById('modal-ficha-devolucion');
  const fichaDevolucionNumero = document.getElementById('ficha-devolucion-numero');
  const fichaDevolucionContenido = document.getElementById('ficha-devolucion-contenido');
  const btnCerrarFichaDevolucion = document.getElementById('btn-cerrar-ficha-devolucion');

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

  function activarFichaSubtab(nombre) {
    fichaSubtabButtons.forEach(b => b.classList.toggle('active', b.dataset.subtab === nombre));
    fichaSubtabPanels.forEach(p => p.classList.toggle('active', p.id === 'subtab-' + nombre));
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

  function opcionesTiposFiltroHtml(tipoIdSeleccionado) {
    const tipos = window.tiposEquipoCache || [];
    return '<option value="">Todos los tipos</option>' +
      tipos.map(t => `<option value="${t.id}" ${t.id === tipoIdSeleccionado ? 'selected' : ''}>${t.icono ? t.icono + ' ' : ''}${escapeHtml(t.nombre)}</option>`).join('');
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
  // opcionalmente por tipo. El filtro puede ser fijo (tipoNombre, usado para
  // Motor/Reductor dentro de Motoreductor) o dinámico (obtenerTipoId, usado
  // cuando hay un <select> de tipo aparte que se puede cambiar en cualquier
  // momento). El contenedor debe tener: input.buscador-input, input[type=hidden]
  // (guarda el id elegido) y div.buscador-resultados. Devuelve { refrescar }
  // para poder re-mostrar resultados desde afuera (ej: al cambiar el filtro).
  function inicializarBuscadorEquipo(contenedor, { tipoNombre, obtenerTipoId, seleccionInicialId, onChange }) {
    const inputTexto = contenedor.querySelector('.buscador-input');
    const inputValor = contenedor.querySelector('input[type="hidden"]');
    const resultados = contenedor.querySelector('.buscador-resultados');

    function catalogoFiltrado(texto) {
      const equipos = window.equiposCache || [];
      let porTipo = equipos;
      if (obtenerTipoId) {
        const tid = obtenerTipoId();
        porTipo = tid ? equipos.filter(eq => eq.tipoId === tid) : equipos;
      } else if (tipoNombre) {
        porTipo = equipos.filter(eq => normalizar(buscarTipoEquipo(eq.tipoId)?.nombre) === tipoNombre);
      }
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

    return { refrescar: mostrarResultados };
  }

  function nuevaFilaEquipoPedido(item, originalIndex) {
    const esMotoreductor = item?.tipoLinea === 'motoreductor';

    const row = document.createElement('div');
    row.className = 'equipo-pedido-row-wrap';
    if (originalIndex !== undefined) row.dataset.originalIndex = String(originalIndex);
    row.innerHTML = `
      <label class="extra-check chk-es-motoreductor" style="margin-bottom:8px;">
        <input type="checkbox" class="equipo-pedido-es-motoreductor" ${esMotoreductor ? 'checked' : ''}>
        🔗 Es Motoreductor (Motor + Reductor)
      </label>

      <div class="equipo-pedido-row bloque-individual tiene-filtro" style="${esMotoreductor ? 'display:none;' : ''}">
        <select class="equipo-pedido-tipo-filtro">${opcionesTiposFiltroHtml()}</select>
        <div class="buscador-equipo">
          <input type="text" class="buscador-input" placeholder="Buscar equipo por nombre..." autocomplete="off">
          <input type="hidden" class="equipo-pedido-select">
          <div class="buscador-resultados"></div>
        </div>
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
          <input type="checkbox" class="equipo-pedido-preparado" ${(item?.unidadesPreparadas || []).length >= (item?.cantidad || 1) ? 'checked' : ''}>
          ✅ Preparado
        </label>
      </div>
    `;
    row.querySelectorAll('.remove-equipo-pedido').forEach(btn => btn.addEventListener('click', () => row.remove()));

    // El estado de "preparado" por unidad se gestiona desde la Ficha del
    // pedido (unidad por unidad). Este checkbox solo sirve para marcar TODAS
    // las unidades de una vez al momento de crear un equipo nuevo; en un
    // equipo que ya existía, se oculta para no pisar por accidente lo que ya
    // se gestionó por unidad en la Ficha.
    if (item) {
      const chkPreparadoLabel = row.querySelector('.chk-preparado');
      chkPreparadoLabel.style.display = 'none';
    }

    // Si el ítem ya tiene algo despachado (parcial o total), no se puede quitar
    // de la lista — no tiene lógica borrar algo que ya salió.
    const yaDespachadoAlgo = item ? conteoCompletadoItem(item).hecho > 0 : false;
    if (yaDespachadoAlgo) {
      row.querySelectorAll('.remove-equipo-pedido').forEach(btn => {
        btn.disabled = true;
        btn.title = 'No se puede quitar: ya se despachó parte de este equipo';
        btn.style.opacity = '0.35';
        btn.style.cursor = 'not-allowed';
      });
      row.querySelectorAll('.equipo-pedido-cantidad, .equipo-pedido-cantidad-mr').forEach(inp => {
        inp.min = String(conteoCompletadoItem(item).hecho);
      });
    }

    const chkEsMotoreductor = row.querySelector('.equipo-pedido-es-motoreductor');
    const bloqueIndividual = row.querySelector('.bloque-individual');
    const bloqueMotoreductor = row.querySelector('.equipo-pedido-motoreductor');
    const selectIndividual = row.querySelector('.equipo-pedido-select'); // ahora es un input[hidden]
    const selectTipoFiltro = row.querySelector('.equipo-pedido-tipo-filtro');
    const selectReductor = row.querySelector('.equipo-pedido-reductor'); // ídem, input[hidden]

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
    actualizarModo(); // aplica el modo inicial y calcula brazo/eje visibles

    const contenedoresBuscador = row.querySelectorAll('.buscador-equipo');
    const contenedorEquipoIndividual = contenedoresBuscador[0];
    const contenedorMotor = contenedoresBuscador[1];
    const contenedorReductor = contenedoresBuscador[2];

    // Equipo individual: buscador por nombre, filtrable en vivo por el <select>
    // de tipo de al lado (ambos a la vez, como se pidió).
    const buscadorIndividualAPI = inicializarBuscadorEquipo(contenedorEquipoIndividual, {
      obtenerTipoId: () => selectTipoFiltro.value || null,
      seleccionInicialId: !esMotoreductor ? item?.equipoId : null,
      onChange: actualizarExtrasVisibles
    });
    selectTipoFiltro.addEventListener('change', () => buscadorIndividualAPI.refrescar());

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
    const pedidoOriginal = pedidosCache.find(p => p.id === inputId.value);
    const equiposOriginales = pedidoOriginal?.equipos || [];

    const filas = equiposPedidoList.querySelectorAll('.equipo-pedido-row-wrap');
    const items = [];
    filas.forEach(fila => {
      const llevaBrazo = fila.querySelector('.equipo-pedido-brazo').checked;
      const llevaEje = fila.querySelector('.equipo-pedido-eje').checked;
      const marcarTodasPreparadas = fila.querySelector('.equipo-pedido-preparado').checked;
      const esMotoreductor = fila.querySelector('.equipo-pedido-es-motoreductor').checked;

      let item;
      if (esMotoreductor) {
        const motorEquipoId = fila.querySelector('.equipo-pedido-motor').value;
        const reductorEquipoId = fila.querySelector('.equipo-pedido-reductor').value;
        if (!motorEquipoId || !reductorEquipoId) return; // ignora filas incompletas
        const cantidad = parseInt(fila.querySelector('.equipo-pedido-cantidad-mr').value, 10) || 1;
        const ordenCompra = fila.querySelector('.equipo-pedido-oc-mr').value.trim();
        // Al crear un equipo nuevo, el checkbox "Preparado" marca todas sus
        // unidades de una vez; en uno que ya existía, se preserva más abajo
        // lo que ya se gestionó por unidad desde la Ficha.
        const unidadesPreparadas = marcarTodasPreparadas ? Array.from({ length: cantidad }, (_, i) => i) : [];
        item = { tipoLinea: 'motoreductor', motorEquipoId, reductorEquipoId, cantidad, ordenCompra, llevaBrazo, llevaEje, unidadesPreparadas };
      } else {
        const equipoId = fila.querySelector('.equipo-pedido-select').value;
        if (!equipoId) return; // ignora filas sin equipo elegido
        const cantidad = parseInt(fila.querySelector('.equipo-pedido-cantidad').value, 10) || 1;
        const ordenCompra = fila.querySelector('.equipo-pedido-oc').value.trim();
        const unidadesPreparadas = marcarTodasPreparadas ? Array.from({ length: cantidad }, (_, i) => i) : [];
        item = { tipoLinea: 'individual', equipoId, cantidad, ordenCompra, llevaBrazo, llevaEje, unidadesPreparadas };
      }

      // CRÍTICO: este formulario no tiene campos para los números de serial ni
      // para el rastreo de completado/devuelto — si no se preservan aquí desde
      // el pedido original, se perderían cada vez que se guarda el pedido
      // (por ejemplo, al agregar un equipo nuevo se sobrescribiría TODO el
      // arreglo de equipos, borrando los seriales de los demás).
      const origIdxRaw = fila.dataset.originalIndex;
      if (origIdxRaw !== undefined && origIdxRaw !== '') {
        const original = equiposOriginales[parseInt(origIdxRaw, 10)];
        if (original) {
          if (original.seriales) item.seriales = original.seriales;
          if (original.serialesMotor) item.serialesMotor = original.serialesMotor;
          if (original.serialesReductor) item.serialesReductor = original.serialesReductor;
          if (original.unidadesCompletadas) item.unidadesCompletadas = original.unidadesCompletadas;
          if (original.unidadesDevueltas) item.unidadesDevueltas = original.unidadesDevueltas;
          if (original.cantidadCompletada !== undefined) item.cantidadCompletada = original.cantidadCompletada;
          if (original.cantidadDevuelta !== undefined) item.cantidadDevuelta = original.cantidadDevuelta;
          // El "preparado" por unidad se gestiona desde la Ficha, no desde
          // este formulario — siempre se preserva tal cual estaba.
          item.unidadesPreparadas = original.unidadesPreparadas || [];
        }
      }

      items.push(item);
    });
    return items;
  }


  document.getElementById('btn-add-equipo-pedido').addEventListener('click', () => nuevaFilaEquipoPedido());

  document.addEventListener('equipos-catalogo:cambio', () => {
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
      items.forEach((item, idx) => nuevaFilaEquipoPedido(item, idx));
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

    // Si estamos editando un pedido que YA tenía equipos pendientes, y el
    // resultado de esta edición (ej: se quitó el equipo que faltaba, y lo
    // que queda ya salió despachado) deja el pedido completo, se lo
    // confirmamos al usuario antes de guardar: puede que no se haya dado
    // cuenta de que esta edición equivale a completar el pedido.
    if (id) {
      const pedidoOriginal = pedidosCache.find(p => p.id === id);
      const yaEstabaCompletado = pedidoOriginal ? pedidoEstaCompletado(pedidoOriginal) : false;
      const quedaraCompletado = pedidoEstaCompletado({ equipos: datos.equipos });

      if (!yaEstabaCompletado && quedaraCompletado) {
        const confirmar = confirm(
          `Con estos cambios, todos los equipos que quedan en el pedido N° ${pedidoOriginal?.numero ?? ''} ya están despachados.\n\n` +
          `¿Desea completar este pedido?\n\n` +
          `Aceptar = el pedido queda marcado como COMPLETADO.\n` +
          `Cancelar = no se guarda ningún cambio.`
        );
        if (!confirmar) return; // No se guarda nada, el usuario sigue editando
      }
    }

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
    if (pedidoTieneAlgoDespachado(pedido)) {
      alert(`El pedido N° ${pedido.numero} ya tiene equipos despachados en un envío y no se puede eliminar.`);
      return;
    }
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
  let volverAEnvioId = null; // si la ficha se abrió desde dentro de un envío (envios.js), aquí queda su id
  let volverAEnvioOpciones = null; // cadena de retorno propia de ese envío (ej. su propio volverAPedidoId), para no perderla al volver

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

  // Para un Motoreductor: combina el serial del motor y del reductor de cada
  // unidad en una sola línea "motor / reductor". Con cantidad > 1 se enumera
  // por unidad, para saber cuál motor va emparejado con cuál reductor.
  function resumenSerialesMotoreductor(item, cantidad) {
    const filas = Array.from({ length: cantidad }).map((_, i) => {
      const sm = (item.serialesMotor?.[i] || '').trim();
      const sr = (item.serialesReductor?.[i] || '').trim();
      const completa = sm && sr;
      const vacia = !sm && !sr;
      const icono = completa ? '🔢' : (vacia ? '🔴' : '🟡');
      const clase = completa ? 'completo' : 'pendiente';
      const prefijo = cantidad > 1 ? `Unidad ${i + 1}: ` : '';
      return `<div class="equipo-card-serial ${clase}" style="display:block;">${icono} ${prefijo}${escapeHtml(sm || '—')} / ${escapeHtml(sr || '—')}</div>`;
    }).join('');
    return `<div class="serial-par-lista">${filas}</div>`;
  }

  const COLOR_PREPARADO = '#2f8f5b'; // mismo verde que --ok
  const COLOR_COMPLETADO = '#1c2128'; // graphite — para distinguirlo claramente de "preparado"
  const COLOR_DEVUELTO = '#1f5c8a'; // azul — mismo tono que el tag-variante, para consistencia

  // ---------- Preparado / devolución por unidad ----------
  // "Preparado" ahora se guarda por unidad (item.unidadesPreparadas: [0,1,...])
  // en vez de un solo booleano — así, si el ítem tiene más de una unidad, cada
  // una se prepara por separado. Aplica igual a equipos con o sin serial.
  //
  // Las devoluciones, en cambio, se registran distinto según el equipo use
  // serial o no:
  //  - Con serial (itemUsaSerialPorUnidad): se sabe EXACTAMENTE cuál unidad se
  //    devuelve -> item.unidadesDevueltas: [index, index, ...]
  //  - Sin serial: no hay forma de saber cuál es cuál, así que solo se cuentan
  //    cuántas se devolvieron -> item.cantidadDevuelta: number

  // Índices de unidad que quedan bloqueados para "preparado" porque ya fueron
  // devueltos. Para equipos sin serial (anónimos) se bloquean las últimas N
  // unidades, donde N = cantidadDevuelta (no importa cuál en concreto, ya que
  // son indistinguibles entre sí).
  function indicesDevueltosItem(item) {
    if (itemUsaSerialPorUnidad(item)) {
      return new Set(item.unidadesDevueltas || []);
    }
    const total = item.cantidad || 0;
    const devueltas = item.cantidadDevuelta || 0;
    const set = new Set();
    for (let i = Math.max(0, total - devueltas); i < total; i++) set.add(i);
    return set;
  }

  // Cuántas unidades de este ítem tienen registrada una devolución (sirve
  // tanto para equipos con serial como sin serial).
  function devueltasCountItem(item) {
    if (itemUsaSerialPorUnidad(item)) return (item.unidadesDevueltas || []).length;
    return item.cantidadDevuelta || 0;
  }

  // Cuántas unidades están marcadas como preparadas, sin contar las que ya
  // fueron devueltas (una unidad devuelta no debe seguir contando como lista).
  function cantidadPreparadaItem(item) {
    const devueltos = indicesDevueltosItem(item);
    return (item.unidadesPreparadas || []).filter(u => !devueltos.has(u)).length;
  }

  // Determina el color/ícono/tag "principal" de una tarjeta de equipo cuando
  // hay que resumir varios estados posibles en uno solo (puede tener varias
  // unidades con estados distintos). Prioridad: Devuelto > Completado > Preparado > normal.
  function estadoPrincipalItem(item, colorTipoDefault, iconoTipoDefault) {
    const tieneDevueltas = devueltasCountItem(item) > 0;
    const completado = estaItemCompletado(item);
    const totalPreparable = (item.cantidad || 0) - devueltasCountItem(item);
    const preparado = totalPreparable > 0 && cantidadPreparadaItem(item) >= totalPreparable;

    if (tieneDevueltas) return { tag: 'Devuelto', color: COLOR_DEVUELTO, icono: '🔵' };
    if (completado) return { tag: 'Completado', color: COLOR_COMPLETADO, icono: '🔒' };
    if (preparado) return { tag: 'Preparado', color: COLOR_PREPARADO, icono: '✅' };
    return { tag: null, color: colorTipoDefault, icono: iconoTipoDefault };
  }

  // Un ítem queda "completado" cuando TODA su cantidad (o todas sus unidades,
  // si usa serial) ya salió en algún envío despachado. Se guarda en Firestore
  // al momento de despachar (ver envios.js), acá solo se lee/calcula.
  function estaItemCompletado(item) {
    const total = item.cantidad || 0;
    if (!total) return false;
    if (item.unidadesCompletadas) return item.unidadesCompletadas.length >= total;
    return (item.cantidadCompletada || 0) >= total;
  }

  // Cuántas unidades de este ítem ya salieron despachadas (puede ser parcial:
  // ej. 1 de 2). Se usa para lockear SOLO esa porción, no el ítem completo.
  function conteoCompletadoItem(item) {
    const total = item.cantidad || 0;
    const hecho = item.unidadesCompletadas ? item.unidadesCompletadas.length : (item.cantidadCompletada || 0);
    return { hecho: Math.min(hecho, total), total };
  }

  function pedidoEstaCompletado(pedido) {
    const equipos = pedido.equipos || [];
    return equipos.length > 0 && equipos.every(estaItemCompletado);
  }

  function pedidoTieneDevolucion(pedido) {
    return (pedido.equipos || []).some(item => devueltasCountItem(item) > 0);
  }

  // Un pedido ya no se puede eliminar si AL MENOS uno de sus equipos ya salió
  // (parcial o totalmente) en algún envío despachado. No hace falta que el
  // pedido esté completo del todo: basta con que ya haya algo despachado.
  function pedidoTieneAlgoDespachado(pedido) {
    return (pedido.equipos || []).some(item => conteoCompletadoItem(item).hecho > 0);
  }

  // ---------- Ficha de Devolución (vista reducida: solo lo devuelto) ----------
  // Se abre desde la tabla cuando el filtro activo es "Devolución": en vez de
  // la ficha completa del pedido, muestra solamente el/los equipo(s) a los
  // que se les hizo devolución, con su serial si el equipo lo maneja.

  function serialesDeUnidadDevuelta(item, unidad) {
    if (item.tipoLinea === 'motoreductor') {
      const motor = buscarEquipoCatalogo(item.motorEquipoId);
      const reductor = buscarEquipoCatalogo(item.reductorEquipoId);
      const partes = [];
      if (motor?.usaSerial) partes.push(`Motor: <span class="serial-valor">${escapeHtml(item.serialesMotor?.[unidad] || '—')}</span>`);
      if (reductor?.usaSerial) partes.push(`Reductor: <span class="serial-valor">${escapeHtml(item.serialesReductor?.[unidad] || '—')}</span>`);
      return partes.join(' · ');
    }
    const equipo = buscarEquipoCatalogo(item.equipoId);
    if (equipo?.usaSerial) return `Serial: <span class="serial-valor">${escapeHtml(item.seriales?.[unidad] || '—')}</span>`;
    return '';
  }

  function nombreLineaDevolucion(item) {
    if (item.tipoLinea === 'motoreductor') {
      const motor = buscarEquipoCatalogo(item.motorEquipoId);
      const reductor = buscarEquipoCatalogo(item.reductorEquipoId);
      const nombreMotor = motor ? escapeHtml(motor.nombre) : 'Motor no encontrado';
      const nombreReductor = reductor ? escapeHtml(reductor.nombre) : 'Reductor no encontrado';
      return `🔧 Motoreductor — ${nombreMotor} / ${nombreReductor}`;
    }
    const equipo = buscarEquipoCatalogo(item.equipoId);
    return equipo ? `📦 ${escapeHtml(nombreMostrableEquipo(equipo))}` : '<span style="color:var(--danger);">Equipo no encontrado</span>';
  }

  function renderDevolucionItem(item) {
    const conSerial = itemUsaSerialPorUnidad(item);
    let filasHtml;
    if (conSerial) {
      const devueltos = Array.from(indicesDevueltosItem(item)).sort((a, b) => a - b);
      filasHtml = devueltos.map(u => {
        const seriales = serialesDeUnidadDevuelta(item, u);
        return `<div class="devolucion-item-unidad">Unidad ${u + 1}${seriales ? ' — ' + seriales : ''}</div>`;
      }).join('');
    } else {
      const cant = item.cantidadDevuelta || 0;
      filasHtml = `<div class="devolucion-item-unidad">${cant} unidad${cant > 1 ? 'es' : ''} devuelta${cant > 1 ? 's' : ''} (equipo sin serial)</div>`;
    }
    return `
      <div class="devolucion-item">
        <div class="devolucion-item-nombre">${nombreLineaDevolucion(item)}</div>
        ${filasHtml}
      </div>
    `;
  }

  function abrirFichaDevolucion(pedido) {
    const compania = buscarCompania(pedido.companiaId);
    const nombreCompania = compania ? compania.nombre : 'Compañía no encontrada';
    fichaDevolucionNumero.textContent = `N${pedido.numero} - ${nombreCompania}`;

    const itemsConDevolucion = (pedido.equipos || []).filter(item => devueltasCountItem(item) > 0);
    fichaDevolucionContenido.innerHTML = itemsConDevolucion.length
      ? itemsConDevolucion.map(renderDevolucionItem).join('')
      : '<div class="empty-equipos-pedido">Este pedido no tiene devoluciones registradas.</div>';

    modalFichaDevolucion.classList.add('open');
  }

  function cerrarFichaDevolucion() {
    modalFichaDevolucion.classList.remove('open');
  }

  btnCerrarFichaDevolucion.addEventListener('click', cerrarFichaDevolucion);
  modalFichaDevolucion.addEventListener('click', (e) => {
    if (e.target === modalFichaDevolucion) cerrarFichaDevolucion();
  });

  // Texto corto que resume el estado de "preparado" de un ítem, ya sea de
  // una sola unidad o de varias (se prepara por unidad cuando cantidad > 1).
  function textoResumenPreparado(item) {
    const totalPreparable = (item.cantidad || 0) - devueltasCountItem(item);
    if (totalPreparable <= 0) return 'Sin unidades disponibles para preparar (todas devueltas)';
    const cantPreparadas = cantidadPreparadaItem(item);
    if ((item.cantidad || 1) > 1) {
      return `${cantPreparadas >= totalPreparable ? '✅' : '⬜'} Preparado ${cantPreparadas}/${totalPreparable}`;
    }
    return cantPreparadas > 0 ? '✅ Preparado' : '⬜ Sin preparar';
  }

  function itemEstaFullyPreparado(item) {
    const totalPreparable = (item.cantidad || 0) - devueltasCountItem(item);
    return totalPreparable > 0 && cantidadPreparadaItem(item) >= totalPreparable;
  }

  function renderTarjetaIndividual(item, index) {
    const equipo = buscarEquipoCatalogo(item.equipoId);
    const tipo = equipo ? buscarTipoEquipo(equipo.tipoId) : null;
    const preparado = itemEstaFullyPreparado(item);
    const completado = estaItemCompletado(item);
    const estadoPrincipal = estadoPrincipalItem(item, tipo?.color || '#5b6472', tipo?.icono || '📦');
    const color = estadoPrincipal.color;
    const icono = estadoPrincipal.icono;
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
    const { hecho, total } = conteoCompletadoItem(item);
    const chipParcial = (hecho > 0 && hecho < total) ? `<span class="meta-chip" title="Ya se despachó parte de este ítem">🔒 ${hecho}/${total} despachado</span>` : '';
    const cantDevueltas = devueltasCountItem(item);
    const chipDevuelto = cantDevueltas ? `<span class="meta-chip chip-devuelto" title="Unidad(es) devuelta(s)">🔵 ${cantDevueltas} devuelta${cantDevueltas > 1 ? 's' : ''}</span>` : '';
    const metaChips = `<span class="meta-chip">${formatearPesoFicha(calcularPesoEquipo(equipo))}</span>${chipParcial}${chipDevuelto}`;

    return `
      <div class="equipo-card clicable ${preparado ? 'preparado' : ''} ${completado ? 'completado' : ''} ${cantDevueltas ? 'devuelto' : ''}" data-index="${index}" style="border-color:${color};">
        <div class="equipo-card-header" style="background:${color};">
          <span>${icono}</span><span>${escapeHtml(nombreTipo)} x ${item.cantidad}</span>
          ${estadoPrincipal.tag ? `<span class="equipo-card-preparado-tag">${estadoPrincipal.tag}</span>` : ''}
        </div>
        <div class="equipo-card-body" style="background:${color}15;">
          <div>
            <div class="equipo-card-nombre">${nombreEquipo}</div>
            ${ocHtml}
            <div class="equipo-card-meta">${metaChips}</div>
          </div>
          ${usaSerial ? resumenSeriales(item, item.cantidad) : ''}
        </div>
        <div class="equipo-card-preparado-toggle">
          ${textoResumenPreparado(item)} <span style="opacity:.6;">(clic para gestionar)</span>
        </div>
      </div>
    `;
  }

  function renderTarjetaMotoreductor(item, index) {
    const motor = buscarEquipoCatalogo(item.motorEquipoId);
    const reductor = buscarEquipoCatalogo(item.reductorEquipoId);
    const tipoMotoreductor = (window.tiposEquipoCache || []).find(t => normalizar(t.nombre) === 'motoreductor');
    const preparado = itemEstaFullyPreparado(item);
    const completado = estaItemCompletado(item);
    const estadoPrincipal = estadoPrincipalItem(item, tipoMotoreductor?.color || '#2e7d32', tipoMotoreductor?.icono || '🔧');
    const color = estadoPrincipal.color;
    const icono = estadoPrincipal.icono;

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

    const ocHtml = item.ordenCompra
      ? `<div class="equipo-card-oc">📄 OC: ${escapeHtml(item.ordenCompra)}</div>`
      : '';
    const { hecho, total } = conteoCompletadoItem(item);
    const chipParcial = (hecho > 0 && hecho < total) ? `<span class="meta-chip" title="Ya se despachó parte de este ítem">🔒 ${hecho}/${total} despachado</span>` : '';
    const cantDevueltas = devueltasCountItem(item);
    const chipDevuelto = cantDevueltas ? `<span class="meta-chip chip-devuelto" title="Unidad(es) devuelta(s)">🔵 ${cantDevueltas} devuelta${cantDevueltas > 1 ? 's' : ''}</span>` : '';

    return `
      <div class="equipo-card clicable ${preparado ? 'preparado' : ''} ${completado ? 'completado' : ''} ${cantDevueltas ? 'devuelto' : ''}" data-index="${index}" style="border-color:${color};">
        <div class="equipo-card-header" style="background:${color};">
          <span>${icono}</span><span>Motoreductor x ${item.cantidad}</span>
          ${estadoPrincipal.tag ? `<span class="equipo-card-preparado-tag">${estadoPrincipal.tag}</span>` : ''}
          ${chipParcial}${chipDevuelto}
        </div>
        <div class="equipo-card-body" style="background:${color}15; flex-direction:column; align-items:stretch;">
          ${ocHtml}
          <div class="motoreductor-subitem">
            <div class="equipo-card-nombre">⚡ ${nombreMotor}</div>
            <div class="equipo-card-meta">
              <span class="meta-chip">${formatearPesoFicha(motor?.peso)}</span>
            </div>
          </div>
          <div class="motoreductor-subitem">
            <div class="equipo-card-nombre">⚙️ ${nombreReductor}</div>
            <div class="equipo-card-meta">
              <span class="meta-chip">${formatearPesoFicha(reductor?.peso)}</span>
            </div>
          </div>
          ${(usaSerialMotor || usaSerialReductor) ? `
            <div class="motoreductor-subitem" style="border-bottom:none;">
              <div class="equipo-card-nombre" style="font-size:12px; color:var(--ink-soft); margin-bottom:4px;">Serial motor / Serial reductor</div>
              ${resumenSerialesMotoreductor(item, item.cantidad)}
            </div>
          ` : ''}
        </div>
        <div class="equipo-card-preparado-toggle">
          ${textoResumenPreparado(item)} <span style="opacity:.6;">(clic para gestionar)</span>
        </div>
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
      card.addEventListener('click', () => {
        abrirModalSeriales(parseInt(card.dataset.index, 10));
      });
    });
  }

  function buscarTipoEquipo(tipoId) {
    return (window.tiposEquipoCache || []).find(t => t.id === tipoId) || null;
  }

  // Marca/desmarca UNA unidad concreta como preparada (index de la unidad
  // dentro del ítem, no del ítem en sí). Aplica igual con o sin serial.
  async function toggleUnidadPreparada(indexItem, unidad, marcado) {
    const pedido = pedidosCache.find(p => p.id === pedidoIdEnFicha);
    if (!pedido) return;
    const item = (pedido.equipos || [])[indexItem];
    if (!item) return;

    const set = new Set(item.unidadesPreparadas || []);
    if (marcado) set.add(unidad); else set.delete(unidad);
    const itemActualizado = { ...item, unidadesPreparadas: Array.from(set) };
    const equiposActualizados = (pedido.equipos || []).map((it, i) => i === indexItem ? itemActualizado : it);

    try {
      await db.collection(COLECCION).doc(pedido.id).update({ equipos: equiposActualizados });
      renderSeccionEquipos({ ...pedido, equipos: equiposActualizados });
      if (indexEquipoEnSeriales === indexItem) abrirModalSeriales(indexItem); // refresca el modal abierto
    } catch (err) {
      console.error('Error actualizando estado preparado:', err);
      alert('No se pudo actualizar. Revisa la consola.');
    }
  }

  function abrirFicha(pedido, subtabInicial) {
    pedidoIdEnFicha = pedido.id;
    const tipoInfo = TIPO_PEDIDO_LABEL[pedido.tipo] || TIPO_PEDIDO_LABEL.normal;
    const compania = buscarCompania(pedido.companiaId);
    const nombreCompania = compania ? compania.nombre : 'Compañía no encontrada';

    fichaHeaderNumero.textContent = `N${pedido.numero} - ${nombreCompania}`;
    fichaHeaderTags.innerHTML = `<span class="${tipoInfo.clase}">${tipoInfo.texto}</span>` +
      (pedidoEstaCompletado(pedido) ? '<span class="tag-pedido-completado">COMPLETADO</span>' : '') +
      (pedidoTieneDevolucion(pedido) ? '<span class="tag-pedido-devolucion">DEVOLUCIÓN</span>' : '');

    renderSeccionCliente(pedido);
    renderSeccionEquipos(pedido);
    renderEnviosVinculados();
    if (subtabInicial) activarFichaSubtab(subtabInicial);
    else resetFichaSubtabs();

    btnEditarDesdeFicha.dataset.id = pedido.id;
    const completado = pedidoEstaCompletado(pedido);
    btnEditarDesdeFicha.disabled = completado;
    btnEditarDesdeFicha.title = completado ? 'Pedido completado: no editable, solo se pueden registrar devoluciones' : '';
    modalFicha.classList.add('open');
  }

  // Permite reabrir la ficha de un pedido desde otro archivo (envios.js), por
  // ejemplo al cerrar/guardar/cancelar un envío que se abrió desde aquí, o al
  // navegar desde la ficha de un envío a uno de sus pedidos (opciones.volverAEnvioId).
  window.abrirFichaPedido = function (pedidoId, subtabInicial, opciones) {
    volverAEnvioId = opciones?.volverAEnvioId || null;
    volverAEnvioOpciones = opciones?.volverAEnvioOpciones || null;
    const pedido = pedidosCache.find(p => p.id === pedidoId);
    if (pedido) abrirFicha(pedido, subtabInicial);
  };

  // Cierre "real" de la ficha (botón Cerrar o clic en el backdrop): si se
  // llegó aquí desde la ficha de un envío, vuelve a abrirla. El parámetro
  // mantenerVolver evita este retorno automático cuando cerrarFicha() se usa
  // solo como paso intermedio de una navegación explícita (editar el pedido,
  // o saltar a un envío distinto) — en esos casos el volverAEnvioId debe
  // seguir intacto para cuando la ficha se cierre de verdad más adelante.
  function cerrarFicha(opciones) {
    modalFicha.classList.remove('open');
    pedidoIdEnFicha = null;
    if (opciones?.mantenerVolver) return;
    if (volverAEnvioId && window.abrirFichaEnvio) {
      const idEnvio = volverAEnvioId;
      const opcionesEnvio = volverAEnvioOpciones;
      volverAEnvioId = null;
      volverAEnvioOpciones = null;
      const envio = (window.enviosCache || []).find(en => en.id === idEnvio);
      if (envio) window.abrirFichaEnvio(envio, opcionesEnvio || undefined);
    } else {
      volverAEnvioId = null;
      volverAEnvioOpciones = null;
    }
  }

  btnCerrarFicha.addEventListener('click', () => cerrarFicha());
  modalFicha.addEventListener('click', (e) => {
    if (e.target === modalFicha) cerrarFicha();
  });
  btnEditarDesdeFicha.addEventListener('click', () => {
    const pedido = pedidosCache.find(p => p.id === btnEditarDesdeFicha.dataset.id);
    origenEdicion = 'ficha';
    cerrarFicha({ mantenerVolver: true });
    if (pedido) abrirModalEditar(pedido);
  });

  // ---------- Sub-modal: números de serial de un equipo del pedido ----------

  let indexEquipoEnSeriales = null;

  function camposSerialesHtml(prefijoClase, campoNombre, cantidad, serialesActuales, etiqueta, unidadesCompletadas, unidadesDevueltas) {
    return `
      <div class="seriales-grupo-titulo">${etiqueta}</div>
      <div class="seriales-campos-list">${
        Array.from({ length: cantidad }).map((_, i) => {
          const devuelta = (unidadesDevueltas || []).includes(i);
          const completada = (unidadesCompletadas || []).includes(i);
          const bloqueada = devuelta || completada;
          const etiquetaUnidad = devuelta ? ' 🔵 (devuelto)' : (completada ? ' 🔒 (ya despachada)' : '');
          return `
            <div class="serial-campo ${devuelta ? 'devuelto' : ''}">
              <label>Unidad ${i + 1}${etiquetaUnidad}</label>
              <input type="text" class="serial-input-campo ${prefijoClase}" data-campo="${campoNombre}" data-unidad="${i}" value="${serialesActuales[i] ? escapeHtml(serialesActuales[i]) : ''}" placeholder="Número de serial" ${bloqueada ? 'disabled' : ''}>
              <div class="serial-duplicado-aviso" style="display:none;"></div>
            </div>
          `;
        }).join('')
      }</div>
    `;
  }

  // Sección unificada de "Unidades": un checkbox de Preparado por cada
  // unidad del ítem (aplica con o sin serial), más el control de devolución.
  // - Equipos CON serial (identidad conocida por unidad): botón de devolución
  //   por unidad concreta.
  // - Equipos SIN serial (unidades indistinguibles entre sí): un solo botón
  //   de devolución que resta 1 de la cantidad completada, sin decir cuál.
  function unidadesEstadoHtml(item) {
    const cantidad = item.cantidad || 1;
    const conSerial = itemUsaSerialPorUnidad(item);
    const preparadas = new Set(item.unidadesPreparadas || []);
    const devueltosSet = indicesDevueltosItem(item);
    const completadasSet = new Set(item.unidadesCompletadas || []);

    const filas = Array.from({ length: cantidad }).map((_, i) => {
      const devuelta = devueltosSet.has(i);
      const completada = conSerial ? completadasSet.has(i) : (i < (item.cantidadCompletada || 0));
      const bloqueada = devuelta || completada;
      const estadoTexto = devuelta ? '🔵 Devuelta' : (completada ? '🔒 Despachada' : '');
      return `
        <div class="unidad-preparado-fila">
          <label class="chk-unidad-preparado">
            <input type="checkbox" class="chk-preparado-unidad" data-unidad="${i}" ${preparadas.has(i) ? 'checked' : ''} ${bloqueada ? 'disabled' : ''}>
            Unidad ${i + 1}
          </label>
          ${estadoTexto ? `<span class="unidad-estado-tag">${estadoTexto}</span>` : ''}
          ${(conSerial && completada && !devuelta) ? `<button type="button" class="btn-devolucion btn-devolucion-unidad" data-unidad="${i}" title="Registrar devolución de esta unidad">↩️ Devolución</button>` : ''}
        </div>
      `;
    }).join('');

    let botonCantidad = '';
    if (!conSerial) {
      const totalCompletadas = item.cantidadCompletada || 0;
      const totalDevueltas = item.cantidadDevuelta || 0;
      const disponibles = totalCompletadas - totalDevueltas;
      if (disponibles > 0) {
        botonCantidad = `
          <button type="button" id="btn-devolucion-cantidad" class="btn-devolucion" style="margin-top:10px;">
            ↩️ Registrar devolución (${disponibles} despachada${disponibles > 1 ? 's' : ''} disponible${disponibles > 1 ? 's' : ''})
          </button>
        `;
      }
    }

    return `
      <div class="seriales-grupo-titulo">Unidades</div>
      <div class="seriales-campos-list">${filas}</div>
      ${botonCantidad}
    `;
  }

  // Busca en TODOS los pedidos (en progreso o despachados) dónde más se usa
  // este número de serial, para que no se repita por error.
  // "Categoría" de un uso de serial = el tipo de equipo real detrás de ese
  // campo (Motor, Reductor, Sprocket, etc.). Dos seriales solo se consideran
  // en conflicto si son de la MISMA categoría — un Motor y un Reductor pueden
  // coincidir en el mismo número sin problema, pero dos Reductores no.
  function categoriaDeUso(item, campo) {
    let equipo;
    if (campo === 'motor') equipo = buscarEquipoCatalogo(item.motorEquipoId);
    else if (campo === 'reductor') equipo = buscarEquipoCatalogo(item.reductorEquipoId);
    else equipo = buscarEquipoCatalogo(item.equipoId);
    const tipo = equipo ? buscarTipoEquipo(equipo.tipoId) : null;
    return tipo ? normalizar(tipo.nombre) : null;
  }

  function buscarUsosDeSerial(serial, excluir, categoriaActual) {
    serial = (serial || '').trim();
    if (!serial || !categoriaActual) return [];
    const usos = [];

    function revisarLista(pedido, item, indexItem, lista, campo) {
      if (categoriaDeUso(item, campo) !== categoriaActual) return; // categoría distinta: no es conflicto
      (lista || []).forEach((s, u) => {
        if (!s || s.trim() !== serial) return;
        if ((item.unidadesDevueltas || []).includes(u)) return; // devuelto: el serial queda libre otra vez
        if (excluir && pedido.id === excluir.pedidoId && indexItem === excluir.indexItem && campo === excluir.campo && u === excluir.unidad) return;
        usos.push({ pedido, item, campo, unidad: u });
      });
    }

    pedidosCache.forEach(pedido => {
      (pedido.equipos || []).forEach((item, indexItem) => {
        if (item.tipoLinea === 'motoreductor') {
          revisarLista(pedido, item, indexItem, item.serialesMotor, 'motor');
          revisarLista(pedido, item, indexItem, item.serialesReductor, 'reductor');
        } else {
          revisarLista(pedido, item, indexItem, item.seriales, 'individual');
        }
      });
    });
    return usos;
  }

  function describirUsoSerial(uso) {
    const compania = buscarCompania(uso.pedido.companiaId);
    const nombreCompania = compania ? compania.nombre : 'Compañía no encontrada';
    const yaDespachado = (uso.item.unidadesCompletadas || []).includes(uso.unidad);
    const campoTexto = uso.campo === 'motor' ? ' (Motor)' : uso.campo === 'reductor' ? ' (Reductor)' : '';
    return `N${uso.pedido.numero} - ${nombreCompania}${campoTexto} — ${yaDespachado ? 'Despachado' : 'En progreso'}`;
  }

  function conectarValidacionSerialesDuplicados() {
    const pedidoActual = pedidosCache.find(p => p.id === pedidoIdEnFicha);
    const itemActual = pedidoActual ? (pedidoActual.equipos || [])[indexEquipoEnSeriales] : null;
    if (!itemActual) return;

    serialesCampos.querySelectorAll('.serial-input-campo').forEach(input => {
      input.addEventListener('input', () => {
        const aviso = input.closest('.serial-campo').querySelector('.serial-duplicado-aviso');
        const campo = input.dataset.campo;
        const excluir = {
          pedidoId: pedidoIdEnFicha,
          indexItem: indexEquipoEnSeriales,
          campo,
          unidad: parseInt(input.dataset.unidad, 10)
        };
        const categoriaActual = categoriaDeUso(itemActual, campo);
        const usos = buscarUsosDeSerial(input.value, excluir, categoriaActual);
        if (usos.length) {
          aviso.style.display = 'block';
          aviso.textContent = `⚠️ Este serial ya está en: ${usos.map(describirUsoSerial).join(' · ')}`;
          input.classList.add('serial-duplicado');
        } else {
          aviso.style.display = 'none';
          aviso.textContent = '';
          input.classList.remove('serial-duplicado');
        }
      });
    });
  }

  // Devolución de una unidad ya despachada (equipo CON serial, identidad
  // conocida): libera su serial (queda vacío, ya no cuenta como "en uso" en
  // ningún otro lado) y la unidad vuelve a quedar editable/no completada. En
  // un motoreductor, la devolución de la unidad libera motor Y reductor
  // juntos (van emparejados como una unidad). La devolución también quita
  // esa unidad de "preparado": una unidad devuelta no puede quedar marcada
  // como lista para despacho.
  async function registrarDevolucionUnidad(pedidoId, indexItem, unidad) {
    const ok = confirm(`¿Registrar devolución de la Unidad ${unidad + 1}? Queda marcada como devuelta y bloqueada para reenvío, pero el serial se conserva (para poder rastrearla) y deja de contar como "en uso".`);
    if (!ok) return;

    const pedido = pedidosCache.find(p => p.id === pedidoId);
    if (!pedido) return;
    const item = (pedido.equipos || [])[indexItem];
    if (!item) return;

    const itemActualizado = { ...item };
    // Sale de "completado" (ya no cuenta como entregado) pero entra a
    // "devuelto" (sigue lockeada, no se puede volver a enviar esa unidad).
    // El serial NO se borra — se conserva para poder rastrear de qué pedido
    // se hizo la devolución si alguien pregunta más adelante.
    itemActualizado.unidadesCompletadas = (item.unidadesCompletadas || []).filter(u => u !== unidad);
    itemActualizado.unidadesDevueltas = Array.from(new Set([...(item.unidadesDevueltas || []), unidad]));
    // No se puede quedar "preparada" una unidad ya devuelta.
    itemActualizado.unidadesPreparadas = (item.unidadesPreparadas || []).filter(u => u !== unidad);

    const equiposActualizados = (pedido.equipos || []).map((it, i) => i === indexItem ? itemActualizado : it);

    try {
      await db.collection(COLECCION).doc(pedidoId).update({ equipos: equiposActualizados });
      abrirModalSeriales(indexItem); // refresca el modal mostrando la unidad como devuelta
      renderSeccionEquipos({ ...pedido, equipos: equiposActualizados }); // refresca la tarjeta detrás
    } catch (err) {
      console.error('Error registrando devolución:', err);
      alert('No se pudo registrar la devolución. Revisa la consola.');
    }
  }

  // Devolución para equipos SIN serial: no hay forma de identificar cuál
  // unidad física es cuál, así que solo se dice CUÁNTAS se devuelven (resta
  // 1 de "completada" y suma 1 a "devuelta"). También libera una unidad de
  // "preparado" (la que ya no debe seguir contando como lista).
  async function registrarDevolucionCantidad(pedidoId, indexItem) {
    const pedido = pedidosCache.find(p => p.id === pedidoId);
    if (!pedido) return;
    const item = (pedido.equipos || [])[indexItem];
    if (!item) return;

    const completadas = item.cantidadCompletada || 0;
    const devueltasActuales = item.cantidadDevuelta || 0;
    if (completadas - devueltasActuales <= 0) return;

    const ok = confirm('¿Registrar la devolución de una unidad de este equipo? Deja de contar como completada, pero se conserva el registro. Como este equipo no maneja serial, no se distingue cuál unidad física es.');
    if (!ok) return;

    const itemActualizado = { ...item };
    itemActualizado.cantidadCompletada = Math.max(0, completadas - 1);
    itemActualizado.cantidadDevuelta = devueltasActuales + 1;
    // Libera una unidad "preparada" (la de índice más alto disponible), ya
    // que la que se devolvió deja de estar lista para despacho.
    const preparadas = [...(item.unidadesPreparadas || [])].sort((a, b) => a - b);
    if (preparadas.length) preparadas.pop();
    itemActualizado.unidadesPreparadas = preparadas;

    const equiposActualizados = (pedido.equipos || []).map((it, i) => i === indexItem ? itemActualizado : it);

    try {
      await db.collection(COLECCION).doc(pedidoId).update({ equipos: equiposActualizados });
      abrirModalSeriales(indexItem);
      renderSeccionEquipos({ ...pedido, equipos: equiposActualizados });
    } catch (err) {
      console.error('Error registrando devolución:', err);
      alert('No se pudo registrar la devolución. Revisa la consola.');
    }
  }

  function abrirModalSeriales(index) {
    const pedido = pedidosCache.find(p => p.id === pedidoIdEnFicha);
    if (!pedido) return;
    const item = (pedido.equipos || [])[index];
    if (!item) return;

    indexEquipoEnSeriales = index;
    const cantidad = item.cantidad || 1;
    const unidadesCompletadas = item.unidadesCompletadas || [];
    const unidadesDevueltas = item.unidadesDevueltas || [];

    let htmlSeriales = '';
    if (item.tipoLinea === 'motoreductor') {
      const motor = buscarEquipoCatalogo(item.motorEquipoId);
      const reductor = buscarEquipoCatalogo(item.reductorEquipoId);
      modalSerialesTitulo.textContent = 'Unidades — Motoreductor';

      if (motor?.usaSerial) htmlSeriales += camposSerialesHtml('serial-input-motor', 'motor', cantidad, item.serialesMotor || [], `⚡ Motor — ${escapeHtml(motor.nombre)}`, unidadesCompletadas, unidadesDevueltas);
      if (reductor?.usaSerial) htmlSeriales += camposSerialesHtml('serial-input-reductor', 'reductor', cantidad, item.serialesReductor || [], `⚙️ Reductor — ${escapeHtml(reductor.nombre)}`, unidadesCompletadas, unidadesDevueltas);
    } else {
      const equipo = buscarEquipoCatalogo(item.equipoId);
      modalSerialesTitulo.textContent = `Unidades — ${equipo ? equipo.nombre : 'Equipo'}`;
      if (equipo?.usaSerial) htmlSeriales += camposSerialesHtml('serial-input', 'individual', cantidad, item.seriales || [], '', unidadesCompletadas, unidadesDevueltas);
    }

    serialesCampos.innerHTML = htmlSeriales + unidadesEstadoHtml(item);
    conectarValidacionSerialesDuplicados();

    serialesCampos.querySelectorAll('.chk-preparado-unidad').forEach(chk => {
      chk.addEventListener('change', () => toggleUnidadPreparada(index, parseInt(chk.dataset.unidad, 10), chk.checked));
    });
    serialesCampos.querySelectorAll('.btn-devolucion-unidad').forEach(btn => {
      btn.addEventListener('click', () => registrarDevolucionUnidad(pedido.id, index, parseInt(btn.dataset.unidad, 10)));
    });
    const btnDevCantidad = serialesCampos.querySelector('#btn-devolucion-cantidad');
    if (btnDevCantidad) btnDevCantidad.addEventListener('click', () => registrarDevolucionCantidad(pedido.id, index));

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

    if (serialesCampos.querySelector('.serial-duplicado')) {
      const seguir = confirm('Hay al menos un serial repetido con otro pedido (ver aviso en rojo). ¿Guardar de todas formas?');
      if (!seguir) return;
    }

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
  const grupoEnvioNuevo = document.getElementById('grupo-envio-nuevo');
  const selectQuienEncarga = document.getElementById('envio-quien-encarga');
  const grupoPersonaRecoge = document.getElementById('grupo-persona-recoge');
  const inputPersonaRecoge = document.getElementById('envio-persona-recoge');
  const radiosModoEnvio = formAgregarEnvio.querySelectorAll('input[name="modo-envio"]');
  const grupoEnvioExistente = document.getElementById('grupo-envio-existente');
  const selectEnvioExistente = document.getElementById('envio-existente-select');
  const grupoRemisionExistente = document.getElementById('grupo-remision-existente');
  const radiosModoRemision = formAgregarEnvio.querySelectorAll('input[name="modo-remision"]');
  const selectRemisionExistente = document.getElementById('remision-existente-select');
  const grupoRemisionNueva = document.getElementById('grupo-remision-nueva');
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

  // Un ítem se selecciona por UNIDAD individual (checkbox por unidad) cuando
  // usa número serial — así se sabe exactamente cuál unidad va en cuál remisión,
  // porque puede que no todas quepan en una sola.
  function itemUsaSerialPorUnidad(item) {
    if (item.tipoLinea === 'motoreductor') {
      const motor = buscarEquipoCatalogo(item.motorEquipoId);
      const reductor = buscarEquipoCatalogo(item.reductorEquipoId);
      return !!(motor?.usaSerial || reductor?.usaSerial);
    }
    const equipo = buscarEquipoCatalogo(item.equipoId);
    return !!equipo?.usaSerial;
  }

  function unidadesReservadasEnEnvios(pedidoId, itemIndex, excluirEnvioId) {
    const set = new Set();
    (window.enviosCache || []).forEach(envio => {
      if (excluirEnvioId && envio.id === excluirEnvioId) return;
      (envio.pedidos || []).forEach(pInfo => {
        if (pInfo.pedidoId !== pedidoId) return;
        (pInfo.items || []).forEach(it => {
          if (it.itemIndex !== itemIndex) return;
          (it.unidades || []).forEach(u => set.add(u));
        });
      });
    });
    return set;
  }

  function etiquetaUnidad(item, unidadIdx) {
    if (item.tipoLinea === 'motoreductor') {
      const sm = item.serialesMotor?.[unidadIdx];
      const sr = item.serialesReductor?.[unidadIdx];
      return `Unidad ${unidadIdx + 1}` + ((sm || sr) ? ` — Motor: ${escapeHtml(sm || '—')} / Reductor: ${escapeHtml(sr || '—')}` : ' — sin serial asignado');
    }
    const serial = item.seriales?.[unidadIdx];
    return `Unidad ${unidadIdx + 1}` + (serial ? ` — Serial: ${escapeHtml(serial)}` : ' — sin serial asignado');
  }

  function nombreQuienEncargaEnvio(envio) {
    if (envio.esInterno) return '🏠 Interno' + (envio.personaRecoge ? ` — ${escapeHtml(envio.personaRecoge)}` : '');
    const empresa = (window.empresasEnvioCache || []).find(e => e.id === envio.empresaEnvioId);
    return empresa ? escapeHtml(empresa.nombre) : '<span style="color:var(--danger);">Empresa no encontrada</span>';
  }

  // Para envíos Interno no hay remesa real de transportadora — se muestra el
  // nombre de la persona encargada de recogerlo en su lugar.
  function remesaMostrable(envio) {
    if (envio.esInterno) return envio.personaRecoge ? escapeHtml(envio.personaRecoge) : 'Interno (sin encargado aún)';
    return envio.remesa ? escapeHtml(envio.remesa) : null;
  }

  // Lista legible de qué pedidos (con su compañía) ya están metidos en un
  // envío armado — para poder distinguir, por ejemplo, entre dos envíos con
  // la misma transportadora (dos "TCC") a la hora de elegir a cuál sumar el
  // pedido actual. Sin HTML, porque va dentro de un <option> de <select>.
  function resumenPedidosVinculadosEnvio(envio, maxNombres = 3) {
    const ids = [...new Set((envio.pedidos || []).map(p => p.pedidoId))];
    if (!ids.length) return 'Sin pedidos todavía';
    const nombres = ids.map(id => {
      const pedido = pedidosCache.find(p => p.id === id);
      if (!pedido) return 'Pedido no encontrado';
      const compania = buscarCompania(pedido.companiaId);
      return `N${pedido.numero}${compania ? ' - ' + compania.nombre : ''}`;
    });
    if (nombres.length <= maxNombres) return nombres.join(', ');
    return `${nombres.slice(0, maxNombres).join(', ')} y ${nombres.length - maxNombres} más`;
  }

  // Peso unitario (kg) de un equipo del catálogo. Si es un equipo compuesto
  // (ej. un acople armado de varias piezas), suma peso x cantidad de cada
  // pieza — igual criterio que usa envios.js para el total de un envío.
  function pesoUnitarioEquipoEnvio(equipo) {
    if (!equipo?.esCompuesto || !(equipo.piezasCompuesto || []).length) {
      return parseFloat(equipo?.peso) || 0;
    }
    let total = 0;
    for (const p of equipo.piezasCompuesto) {
      const pieza = buscarEquipoCatalogo(p.piezaId);
      if (!pieza || pieza.peso === undefined || pieza.peso === null) continue;
      total += (parseFloat(pieza.peso) || 0) * (p.cantidad || 1);
    }
    return total;
  }

  // Peso (kg) de un ítem puntual de una remisión, buscando el equipo real
  // en SU pedido de origen (puede ser distinto al pedido cuya ficha se está
  // mostrando, si el envío agrupa varios pedidos).
  function pesoItemEnvio(pedidoDeOrigen, it) {
    const item = pedidoDeOrigen?.equipos?.[it.itemIndex];
    if (!item) return 0;
    const cantidad = (it.unidades && it.unidades.length) ? it.unidades.length : (it.cantidad || 0);

    let pesoUnitario = 0;
    if (item.tipoLinea === 'motoreductor') {
      const equipoMotor = buscarEquipoCatalogo(item.motorEquipoId);
      const equipoReductor = buscarEquipoCatalogo(item.reductorEquipoId);
      pesoUnitario = pesoUnitarioEquipoEnvio(equipoMotor) + pesoUnitarioEquipoEnvio(equipoReductor);
    } else {
      const equipo = buscarEquipoCatalogo(item.equipoId);
      pesoUnitario = pesoUnitarioEquipoEnvio(equipo);
    }
    return pesoUnitario * cantidad;
  }

  // Peso TOTAL (kg) de todo lo que lleva un envío — igual que se ve en la
  // pestaña Envíos — sumando los ítems de TODOS los pedidos que agrupa ese
  // envío, no solo el pedido cuya ficha se está mirando.
  function pesoTotalEnvioVinculado(envio) {
    return (envio.pedidos || []).reduce((total, pInfo) => {
      const pedidoDeOrigen = pedidosCache.find(p => p.id === pInfo.pedidoId);
      const pesoRemision = (pInfo.items || []).reduce((sub, it) => sub + pesoItemEnvio(pedidoDeOrigen, it), 0);
      return total + pesoRemision;
    }, 0);
  }

  // Pedidos distintos que están enlazados a un envío (puede ser más de uno,
  // ej. cuando varios pedidos comparten una misma remesa/remisión).
  function pedidosEnlazadosEnvio(envio) {
    const vistos = new Set();
    const nombres = [];
    (envio.pedidos || []).forEach(pInfo => {
      if (vistos.has(pInfo.pedidoId)) return;
      vistos.add(pInfo.pedidoId);
      const p = pedidosCache.find(x => x.id === pInfo.pedidoId);
      if (!p) { nombres.push('Pedido no encontrado'); return; }
      const compania = buscarCompania(p.companiaId);
      nombres.push(`N${p.numero} - ${escapeHtml(compania ? compania.nombre : 'Compañía no encontrada')}`);
    });
    return nombres;
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
      const entradas = (envio.pedidos || []).filter(p => p.pedidoId === pedido.id);
      const estadoTag = envio.estado === 'despachado'
        ? '<span class="tag-envio-despachado">Despachado</span>'
        : '<span class="tag-envio-armado">Armado</span>';

      const remisionesHtml = entradas.map(pInfo => {
        const itemsHtml = (pInfo.items || []).map(it => {
          const item = pedido.equipos?.[it.itemIndex];
          return item ? `<div class="item-linea"><span>${escapeHtml(nombreItemPedido(item))}</span><span>${it.unidades ? `unidad(es): ${it.unidades.map(u => u + 1).join(', ')}` : `cant. ${it.cantidad}`}</span></div>` : '';
        }).join('');
        return `
          <div class="remision-card">
            <div class="remision-card-header">
              <span class="remision-card-pedido">${envio.esInterno ? '🏠 ' + remesaMostrable(envio) : (envio.remesa ? 'Remesa ' + escapeHtml(envio.remesa) : 'Sin remesa')}</span>
              <span class="remision-card-numero">Remisión ${escapeHtml(pInfo.remision || '—')}</span>
            </div>
            <div class="remision-card-items">${itemsHtml || 'Sin equipos'}</div>
          </div>
        `;
      }).join('');

      const peso = pesoTotalEnvioVinculado(envio);
      const enlazadosHtml = pedidosEnlazadosEnvio(envio)
        .map(nombre => `<span class="chip-remision">${nombre} Enlazado</span>`)
        .join('');

      return `
        <div class="envio-vinculado-card" data-envio-id="${envio.id}">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong style="font-size:13.5px;">${nombreQuienEncargaEnvio(envio)}</strong>
            ${estadoTag}
          </div>
          <div class="envio-vinculado-resumen">⚖️ ${peso.toFixed(2)} kg en total en este envío</div>
          <div class="envio-vinculado-chips">${enlazadosHtml}</div>
          ${remisionesHtml}
        </div>
      `;
    }).join('');

    enviosVinculadosContenido.querySelectorAll('.envio-vinculado-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.envioId;
        const envio = (window.enviosCache || []).find(en => en.id === id);
        const idPedidoOrigen = pedidoIdEnFicha; // cerrarFicha() lo pone en null, así que se guarda antes
        cerrarFicha({ mantenerVolver: true });
        if (envio && window.abrirFichaEnvio) window.abrirFichaEnvio(envio, { volverAPedidoId: idPedidoOrigen });
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
    const candidatos = (window.enviosCache || []).filter(envio => envio.estado === 'armado');
    if (!candidatos.length) {
      selectEnvioExistente.innerHTML = '<option value="">No hay envíos armados todavía</option>';
      return;
    }
    selectEnvioExistente.innerHTML = '<option value="">Selecciona...</option>' + candidatos.map(envio => {
      const cant = (envio.pedidos || []).length;
      const quien = nombreQuienEncargaEnvio(envio).replace(/<[^>]+>/g, '');
      const remesaTxt = envio.remesa ? ' — Remesa ' + envio.remesa : '';
      const pedidosTxt = resumenPedidosVinculadosEnvio(envio);
      const label = `${quien}${remesaTxt} (${cant} ${cant === 1 ? 'pedido' : 'pedidos'}): ${pedidosTxt}`;
      return `<option value="${envio.id}">${escapeHtml(label)}</option>`;
    }).join('');
  }

  // Si el pedido actual ya tiene una o más remisiones dentro del envío elegido,
  // ofrece sumar equipos a una de ellas en vez de crear una remisión separada.
  async function actualizarGrupoRemisionExistente() {
    const envioId = selectEnvioExistente.value;
    if (!envioId || !pedidoIdEnFicha) {
      grupoRemisionExistente.style.display = 'none';
      grupoRemisionNueva.style.display = 'block';
      inputRemisionEnvio.required = true;
      return;
    }

    let pedidosFrescos = [];
    try {
      const snap = await db.collection(COLECCION_ENVIOS).doc(envioId).get();
      if (snap.exists) pedidosFrescos = snap.data().pedidos || [];
    } catch (err) {
      console.error('Error consultando remisiones existentes del envío:', err);
    }

    const entradas = pedidosFrescos.filter(p => p.pedidoId === pedidoIdEnFicha);

    if (!entradas.length) {
      grupoRemisionExistente.style.display = 'none';
      grupoRemisionNueva.style.display = 'block';
      inputRemisionEnvio.required = true;
      return;
    }

    grupoRemisionExistente.style.display = 'block';
    selectRemisionExistente.innerHTML = entradas.map(p => {
      const idxReal = pedidosFrescos.indexOf(p);
      return `<option value="${idxReal}">Remisión ${escapeHtml(p.remision || '—')}</option>`;
    }).join('');

    const modoRemision = Array.from(radiosModoRemision).find(r => r.checked)?.value || 'existente';
    grupoRemisionNueva.style.display = modoRemision === 'nueva' ? 'block' : 'none';
    inputRemisionEnvio.required = modoRemision === 'nueva';
  }

  radiosModoRemision.forEach(r => r.addEventListener('change', actualizarGrupoRemisionExistente));

  function actualizarVisibilidadCamposEnvio() {
    const modo = Array.from(radiosModoEnvio).find(r => r.checked)?.value || 'nuevo';

    grupoEnvioNuevo.style.display = modo === 'nuevo' ? 'block' : 'none';
    grupoEnvioExistente.style.display = modo === 'existente' ? 'block' : 'none';

    if (modo === 'nuevo') {
      const esInterno = selectQuienEncarga.value === 'interno';
      grupoPersonaRecoge.style.display = esInterno ? 'block' : 'none';
      grupoRemesa.style.display = esInterno ? 'none' : 'block';
      grupoRemisionExistente.style.display = 'none';
      grupoRemisionNueva.style.display = 'block';
      inputRemisionEnvio.required = true;
    } else {
      poblarSelectEnvioExistente(); // ahora lista TODOS los armados, sin filtrar por quién se encarga
      actualizarGrupoRemisionExistente();
    }
  }

  selectEnvioExistente.addEventListener('change', actualizarGrupoRemisionExistente);


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

      if (itemUsaSerialPorUnidad(item)) {
        const reservadas = unidadesReservadasEnEnvios(pedido.id, index);
        const unidadesHtml = Array.from({ length: total }).map((_, u) => {
          const reservada = reservadas.has(u);
          return `
            <label class="unidad-envio-row ${reservada ? 'sin-disponible' : ''}">
              <input type="checkbox" class="equipo-envio-unidad" data-index="${index}" data-unidad="${u}" ${reservada ? 'disabled' : ''}>
              ${etiquetaUnidad(item, u)}${reservada ? ' (ya asignada a otro envío)' : ''}
            </label>
          `;
        }).join('');
        return `
          <div class="equipo-envio-group">
            <div class="equipo-envio-group-titulo">${escapeHtml(nombreItemPedido(item))} — elige unidades</div>
            ${unidadesHtml}
          </div>
        `;
      }

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
    const modoRemision = Array.from(radiosModoRemision).find(r => r.checked)?.value || 'existente';
    const usaRemisionExistente = modo === 'existente' && grupoRemisionExistente.style.display !== 'none' && modoRemision === 'existente';
    const remision = inputRemisionEnvio.value.trim();

    if (!usaRemisionExistente && !remision) {
      inputRemisionEnvio.focus();
      return;
    }
    if (modo === 'existente' && !selectEnvioExistente.value) {
      selectEnvioExistente.focus();
      return;
    }
    if (usaRemisionExistente && !selectRemisionExistente.value) {
      selectRemisionExistente.focus();
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

    // Ítems con serial: se agrupan las unidades marcadas por índice de ítem.
    const unidadesPorIndice = {};
    equiposEnvioList.querySelectorAll('.equipo-envio-unidad:checked').forEach(chk => {
      const idx = parseInt(chk.dataset.index, 10);
      const unidad = parseInt(chk.dataset.unidad, 10);
      if (!unidadesPorIndice[idx]) unidadesPorIndice[idx] = [];
      unidadesPorIndice[idx].push(unidad);
    });
    Object.entries(unidadesPorIndice).forEach(([idx, unidades]) => {
      items.push({ itemIndex: parseInt(idx, 10), unidades, cantidad: unidades.length });
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
        if (!snap.exists) throw new Error('Envío existente no encontrado'); // para no pisar remisiones de otros pedidos agregados justo antes
        const pedidosActuales = snap.data().pedidos || [];

        let nuevosPedidos;
        if (usaRemisionExistente) {
          // Suma los equipos elegidos a la MISMA remisión ya existente de este
          // pedido (no crea una entrada separada).
          const idxRemision = parseInt(selectRemisionExistente.value, 10);
          nuevosPedidos = pedidosActuales.map((p, i) => {
            if (i !== idxRemision) return p;
            const itemsCombinados = [...(p.items || [])];
            items.forEach(nuevo => {
              const existente = itemsCombinados.find(it => it.itemIndex === nuevo.itemIndex && !!it.unidades === !!nuevo.unidades);
              if (existente) {
                if (nuevo.unidades) {
                  existente.unidades = Array.from(new Set([...(existente.unidades || []), ...nuevo.unidades]));
                  existente.cantidad = existente.unidades.length;
                } else {
                  existente.cantidad = (existente.cantidad || 0) + nuevo.cantidad;
                }
              } else {
                itemsCombinados.push(nuevo);
              }
            });
            return { ...p, items: itemsCombinados };
          });
        } else {
          // Remisión NUEVA y separada — un mismo pedido puede tener varias
          // remisiones distintas dentro de un mismo envío (ej: por espacio
          // físico limitado en la remisión física).
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

  const buscadorPedidos = document.getElementById('buscador-pedidos');
  const buscadorSerialPedidos = document.getElementById('buscador-serial-pedidos');
  const chipsFiltroEstado = document.querySelectorAll('.chip-filtro-estado');
  let filtroEstadoPedidos = 'en_proceso'; // predeterminado
  let filtroTextoPedidos = '';
  let filtroSerialPedidos = '';

  chipsFiltroEstado.forEach(chip => {
    chip.classList.toggle('active', chip.dataset.estado === filtroEstadoPedidos);
    chip.addEventListener('click', () => {
      filtroEstadoPedidos = chip.dataset.estado;
      chipsFiltroEstado.forEach(c => c.classList.toggle('active', c === chip));
      renderTabla();
    });
  });

  // Aplica el filtro de estado activo (chip: en proceso / completado /
  // devolución / todos) a una lista de pedidos. La usan tanto la tabla como
  // las sugerencias de autocompletar de los dos buscadores, para que las
  // sugerencias siempre queden "atadas" al filtro visible en pantalla.
  function pedidosPorFiltroEstado(lista) {
    return lista.filter(pedido => {
      if (filtroEstadoPedidos === 'completado') return pedidoEstaCompletado(pedido);
      if (filtroEstadoPedidos === 'en_proceso') return !pedidoEstaCompletado(pedido);
      if (filtroEstadoPedidos === 'devolucion') return pedidoTieneDevolucion(pedido);
      return true; // todos
    });
  }

  buscadorPedidos.addEventListener('input', () => {
    filtroTextoPedidos = normalizar(buscadorPedidos.value.trim());
    renderTabla();
    mostrarSugerenciasPedidos();
  });

  // Buscador aparte, exclusivamente por número de serial (motor, reductor o
  // individual) — independiente del buscador general de arriba.
  function serialesDelItem(item) {
    return [
      ...(item.seriales || []),
      ...(item.serialesMotor || []),
      ...(item.serialesReductor || [])
    ].filter(Boolean);
  }

  function pedidoCoincideConSerialTexto(pedido, texto) {
    if (!texto) return true;
    return (pedido.equipos || []).some(item =>
      serialesDelItem(item).some(s => normalizar(s).includes(texto))
    );
  }

  function pedidoCoincideConSerial(pedido) {
    return pedidoCoincideConSerialTexto(pedido, filtroSerialPedidos);
  }

  buscadorSerialPedidos.addEventListener('input', () => {
    filtroSerialPedidos = normalizar(buscadorSerialPedidos.value.trim());
    renderTabla();
    mostrarSugerenciasSerial();
  });

  function pedidoCoincideConBusquedaTexto(pedido, texto) {
    if (!texto) return true;
    if (normalizar(String(pedido.numero)).includes(texto)) return true;
    const compania = buscarCompania(pedido.companiaId);
    if (compania && normalizar(compania.nombre).includes(texto)) return true;
    if (pedido.contacto && normalizar(pedido.contacto).includes(texto)) return true;
    return (pedido.equipos || []).some(item => normalizar(nombreItemPedido(item)).includes(texto));
  }

  function pedidoCoincideConBusqueda(pedido) {
    return pedidoCoincideConBusquedaTexto(pedido, filtroTextoPedidos);
  }

  // ---------- Sugerencias de autocompletar (dropdown bajo cada buscador) ----------
  // Ambos buscadores respetan el chip de estado activo: si está en "Todos"
  // sugieren sobre todos los pedidos, pero si está en "Completado" o "En
  // proceso" (o "Devolución"), solo sugieren dentro de ese subconjunto — el
  // mismo criterio que ya aplica la tabla.

  const resultadosBuscadorPedidos = document.getElementById('resultados-buscador-pedidos');
  const resultadosBuscadorSerial = document.getElementById('resultados-buscador-serial-pedidos');

  function etiquetaPedidoSugerencia(pedido) {
    const compania = buscarCompania(pedido.companiaId);
    const nombreCompania = compania ? compania.nombre : 'Compañía no encontrada';
    const contacto = pedido.contacto ? ` · ${pedido.contacto}` : '';
    return `N° ${pedido.numero} — ${nombreCompania}${contacto}`;
  }

  function irAPedidoDesdeSugerencia(pedido) {
    if (filtroEstadoPedidos === 'devolucion') abrirFichaDevolucion(pedido);
    else abrirFicha(pedido);
  }

  function ocultarResultados(el) {
    el.classList.remove('open');
    el.innerHTML = '';
  }

  function mostrarSugerenciasPedidos() {
    const texto = filtroTextoPedidos;
    if (!texto) return ocultarResultados(resultadosBuscadorPedidos);

    const candidatos = pedidosPorFiltroEstado(pedidosCache)
      .filter(p => pedidoCoincideConBusquedaTexto(p, texto))
      .sort((a, b) => a.numero - b.numero)
      .slice(0, 8);

    if (!candidatos.length) {
      resultadosBuscadorPedidos.innerHTML = `<div class="buscador-item-vacio">Sin pedidos que coincidan${filtroEstadoPedidos !== 'todos' ? ' con este filtro' : ''}</div>`;
      resultadosBuscadorPedidos.classList.add('open');
      return;
    }

    resultadosBuscadorPedidos.innerHTML = candidatos.map(p => `
      <div class="buscador-item" data-id="${p.id}">
        ${escapeHtml(etiquetaPedidoSugerencia(p))}
        <span class="buscador-item-sub">${(p.equipos || []).length} ${(p.equipos || []).length === 1 ? 'equipo' : 'equipos'}${pedidoEstaCompletado(p) ? ' · Completado' : ''}</span>
      </div>
    `).join('');
    resultadosBuscadorPedidos.classList.add('open');

    resultadosBuscadorPedidos.querySelectorAll('.buscador-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const pedido = pedidosCache.find(p => p.id === el.dataset.id);
        if (!pedido) return;
        buscadorPedidos.value = String(pedido.numero);
        filtroTextoPedidos = normalizar(String(pedido.numero));
        ocultarResultados(resultadosBuscadorPedidos);
        renderTabla();
        irAPedidoDesdeSugerencia(pedido);
      });
    });
  }

  function mostrarSugerenciasSerial() {
    const texto = filtroSerialPedidos;
    if (!texto) return ocultarResultados(resultadosBuscadorSerial);

    const candidatos = [];
    pedidosPorFiltroEstado(pedidosCache).forEach(pedido => {
      (pedido.equipos || []).forEach(item => {
        serialesDelItem(item).forEach(serial => {
          if (normalizar(serial).includes(texto)) {
            candidatos.push({ serial, pedido, nombreItem: nombreItemPedido(item) });
          }
        });
      });
    });
    candidatos.sort((a, b) => a.pedido.numero - b.pedido.numero);
    const limitados = candidatos.slice(0, 8);

    if (!limitados.length) {
      resultadosBuscadorSerial.innerHTML = `<div class="buscador-item-vacio">Sin seriales que coincidan${filtroEstadoPedidos !== 'todos' ? ' con este filtro' : ''}</div>`;
      resultadosBuscadorSerial.classList.add('open');
      return;
    }

    resultadosBuscadorSerial.innerHTML = limitados.map((c, i) => `
      <div class="buscador-item" data-idx="${i}">
        ${escapeHtml(c.serial)}
        <span class="buscador-item-sub">N° ${c.pedido.numero} · ${escapeHtml(c.nombreItem)}</span>
      </div>
    `).join('');
    resultadosBuscadorSerial.classList.add('open');

    resultadosBuscadorSerial.querySelectorAll('.buscador-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const candidato = limitados[Number(el.dataset.idx)];
        if (!candidato) return;
        buscadorSerialPedidos.value = candidato.serial; // autocompleta con el serial exacto
        filtroSerialPedidos = normalizar(candidato.serial);
        ocultarResultados(resultadosBuscadorSerial);
        renderTabla();
        irAPedidoDesdeSugerencia(candidato.pedido);
      });
    });
  }

  buscadorPedidos.addEventListener('focus', mostrarSugerenciasPedidos);
  buscadorPedidos.addEventListener('blur', () => setTimeout(() => ocultarResultados(resultadosBuscadorPedidos), 120));
  buscadorSerialPedidos.addEventListener('focus', mostrarSugerenciasSerial);
  buscadorSerialPedidos.addEventListener('blur', () => setTimeout(() => ocultarResultados(resultadosBuscadorSerial), 120));

  // Si el usuario cambia el chip de estado con una búsqueda ya escrita, las
  // sugerencias deben recalcularse también (no solo la tabla).
  chipsFiltroEstado.forEach(chip => {
    chip.addEventListener('click', () => {
      mostrarSugerenciasPedidos();
      mostrarSugerenciasSerial();
    });
  });

  function renderTabla() {
    if (!pedidosCache.length) {
      tablaBody.innerHTML = '';
      tablaEmpty.style.display = 'block';
      return;
    }

    const filtrados = pedidosPorFiltroEstado(pedidosCache)
      .filter(pedidoCoincideConBusqueda)
      .filter(pedidoCoincideConSerial);

    if (!filtrados.length) {
      tablaBody.innerHTML = '';
      tablaEmpty.style.display = 'block';
      tablaEmpty.textContent = pedidosCache.length
        ? (filtroEstadoPedidos === 'devolucion'
            ? 'Ningún pedido tiene devoluciones registradas (con este filtro/búsqueda).'
            : 'Ningún pedido coincide con el filtro/búsqueda.')
        : 'Todavía no hay pedidos registrados.';
      return;
    }
    tablaEmpty.style.display = 'none';

    const ordenados = [...filtrados].sort((a, b) => a.numero - b.numero);

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
          <td>
            <span class="${tipoInfo.clase}">${tipoInfo.texto}</span>
            ${pedidoEstaCompletado(pedido) ? '<span class="tag-pedido-completado">COMPLETADO</span>' : ''}
            ${pedidoTieneDevolucion(pedido) ? '<span class="tag-pedido-devolucion">DEVOLUCIÓN</span>' : ''}
          </td>
          <td>${cantidadEquipos} ${cantidadEquipos === 1 ? 'equipo' : 'equipos'}</td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn-icon btn-editar" data-id="${pedido.id}" title="${pedidoEstaCompletado(pedido) ? 'Pedido completado: no editable, solo se pueden registrar devoluciones desde la ficha' : 'Editar'}" ${pedidoEstaCompletado(pedido) ? 'disabled' : ''}>✏️</button>
              ${pedidoTieneAlgoDespachado(pedido) ? '' : `<button type="button" class="btn-icon btn-eliminar danger" data-id="${pedido.id}" title="Eliminar">🗑️</button>`}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Clic en cualquier parte de la fila (fuera de los botones) abre la
    // Ficha. Con el filtro "Devolución" activo, abre en su lugar la Ficha de
    // Devolución (vista reducida: solo el/los equipo(s) devuelto(s)).
    tablaBody.querySelectorAll('tr.fila-pedido-clicable').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button')) return; // los botones tienen su propio comportamiento
        const pedido = pedidosCache.find(p => p.id === tr.dataset.id);
        if (!pedido) return;
        if (filtroEstadoPedidos === 'devolucion') abrirFichaDevolucion(pedido);
        else abrirFicha(pedido);
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
