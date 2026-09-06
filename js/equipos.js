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

  const grupoAcopleCompuesto = document.getElementById('grupo-acople-compuesto');
  const inputEsCompuesto = document.getElementById('equipo-es-compuesto');
  const piezasCompuestoWrap = document.getElementById('piezas-compuesto-wrap');
  const piezasCompuestoList = document.getElementById('piezas-compuesto-list');
  const hintPesoCalculado = document.getElementById('hint-peso-calculado');

  const TIPOS_CON_BRAZO_EJE = ['reductor', 'motoreductor'];
  const TIPO_ACOPLE_COMPUESTO = ['acople']; // solo este tag puede marcarse como compuesto
  const TIPO_PIEZAS_ACOPLE = ['piezas de acople']; // de aquí se buscan las piezas que lo componen

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

  // Para un Acople compuesto, el peso real es la suma de (peso de cada pieza x su
  // cantidad). Si a alguna pieza le falta el peso, no se puede calcular (null).
  function calcularPesoEquipo(equipo) {
    if (!equipo?.esCompuesto || !(equipo.piezasCompuesto || []).length) {
      return equipo?.peso ?? null;
    }
    let total = 0;
    for (const p of equipo.piezasCompuesto) {
      const pieza = equiposCache.find(eq => eq.id === p.piezaId);
      if (!pieza || pieza.peso === undefined || pieza.peso === null) return null;
      total += pieza.peso * (p.cantidad || 1);
    }
    return Math.round(total * 100) / 100;
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

  function actualizarVisibilidadAcopleCompuesto() {
    const tipo = buscarTipo(inputTipo.value);
    const aplica = tipo && TIPO_ACOPLE_COMPUESTO.includes(normalizar(tipo.nombre));
    grupoAcopleCompuesto.style.display = aplica ? 'block' : 'none';
    if (!aplica) {
      inputEsCompuesto.checked = false;
      piezasCompuestoWrap.style.display = 'none';
      piezasCompuestoList.innerHTML = '';
    }
  }

  function actualizarPesoCompuesto() {
    if (!inputEsCompuesto.checked) {
      inputPeso.readOnly = false;
      hintPesoCalculado.style.display = 'none';
      return;
    }
    inputPeso.readOnly = true;
    const filas = piezasCompuestoList.querySelectorAll('.pieza-compuesto-row');
    let total = 0;
    let completo = true;
    let hayPiezas = false;
    filas.forEach(fila => {
      const piezaId = fila.querySelector('.pieza-compuesto-id').value;
      if (!piezaId) return;
      hayPiezas = true;
      const cantidad = parseInt(fila.querySelector('.pieza-compuesto-cantidad').value, 10) || 1;
      const pieza = equiposCache.find(eq => eq.id === piezaId);
      if (!pieza || pieza.peso === undefined || pieza.peso === null) {
        completo = false;
      } else {
        total += pieza.peso * cantidad;
      }
    });

    if (!hayPiezas) {
      inputPeso.value = '';
      hintPesoCalculado.style.display = 'block';
      hintPesoCalculado.className = 'hint-peso-calculado incompleto';
      hintPesoCalculado.textContent = 'Agrega piezas para calcular el peso.';
      return;
    }
    if (!completo) {
      hintPesoCalculado.style.display = 'block';
      hintPesoCalculado.className = 'hint-peso-calculado incompleto';
      hintPesoCalculado.textContent = '⚠️ Falta el peso de alguna pieza — el total no se puede calcular todavía.';
      inputPeso.value = '';
      return;
    }
    const totalRedondeado = Math.round(total * 100) / 100;
    inputPeso.value = String(totalRedondeado);
    hintPesoCalculado.style.display = 'block';
    hintPesoCalculado.className = 'hint-peso-calculado';
    hintPesoCalculado.textContent = `✅ Calculado automáticamente: suma de sus ${filas.length} pieza(s).`;
  }

  inputEsCompuesto.addEventListener('change', () => {
    piezasCompuestoWrap.style.display = inputEsCompuesto.checked ? 'block' : 'none';
    if (inputEsCompuesto.checked && !piezasCompuestoList.children.length) {
      nuevaFilaPiezaCompuesto();
    }
    if (!inputEsCompuesto.checked) {
      piezasCompuestoList.innerHTML = '';
    }
    actualizarPesoCompuesto();
  });

  function nombreMostrableEquipo(eq) {
    return eq.nombre + (eq.variante ? ` (${eq.variante})` : '');
  }

  // Buscador con autocompletar para elegir una pieza de acople del catálogo,
  // excluyendo el propio equipo que se está editando (evita auto-referencia).
  function inicializarBuscadorPieza(contenedor, seleccionInicialId) {
    const inputTexto = contenedor.querySelector('.buscador-input');
    const inputValor = contenedor.querySelector('input[type="hidden"]');
    const resultados = contenedor.querySelector('.buscador-resultados');

    function catalogoFiltrado(texto) {
      const propioId = inputId.value;
      const porTipo = equiposCache.filter(eq => {
        if (eq.id === propioId) return false; // no puede componerse de sí mismo
        const tipo = buscarTipo(eq.tipoId);
        return tipo && TIPO_PIEZAS_ACOPLE.includes(normalizar(tipo.nombre));
      });
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
        : '<div class="buscador-item-vacio">Sin coincidencias en el catálogo</div>';
      resultados.classList.add('open');
      resultados.querySelectorAll('.buscador-item').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const eq = equiposCache.find(x => x.id === el.dataset.id);
          if (eq) seleccionar(eq);
        });
      });
    }

    function seleccionar(eq) {
      inputValor.value = eq.id;
      inputTexto.value = nombreMostrableEquipo(eq);
      resultados.classList.remove('open');
      actualizarPesoCompuesto();
    }

    inputTexto.addEventListener('input', () => {
      inputValor.value = '';
      mostrarResultados();
    });
    inputTexto.addEventListener('focus', mostrarResultados);
    inputTexto.addEventListener('blur', () => {
      setTimeout(() => resultados.classList.remove('open'), 120);
    });

    if (seleccionInicialId) {
      const eq = equiposCache.find(x => x.id === seleccionInicialId);
      if (eq) {
        inputValor.value = eq.id;
        inputTexto.value = nombreMostrableEquipo(eq);
      }
    }
  }

  function nuevaFilaPiezaCompuesto(pieza) {
    const row = document.createElement('div');
    row.className = 'pieza-compuesto-row';
    row.innerHTML = `
      <div class="buscador-equipo">
        <input type="text" class="buscador-input" placeholder="Buscar pieza de acople..." autocomplete="off">
        <input type="hidden" class="pieza-compuesto-id">
        <div class="buscador-resultados"></div>
      </div>
      <input type="number" class="pieza-compuesto-cantidad" min="1" step="1" placeholder="Cant." value="${pieza?.cantidad ?? 1}">
      <button type="button" class="remove-contacto" title="Quitar pieza">✕</button>
    `;
    row.querySelector('.remove-contacto').addEventListener('click', () => {
      row.remove();
      actualizarPesoCompuesto();
    });
    row.querySelector('.pieza-compuesto-cantidad').addEventListener('input', actualizarPesoCompuesto);
    piezasCompuestoList.appendChild(row);
    inicializarBuscadorPieza(row.querySelector('.buscador-equipo'), pieza?.piezaId);
  }

  document.getElementById('btn-add-pieza-compuesto').addEventListener('click', () => nuevaFilaPiezaCompuesto());

  function leerPiezasCompuestoDelFormulario() {
    const filas = piezasCompuestoList.querySelectorAll('.pieza-compuesto-row');
    const piezas = [];
    filas.forEach(fila => {
      const piezaId = fila.querySelector('.pieza-compuesto-id').value;
      if (!piezaId) return;
      const cantidad = parseInt(fila.querySelector('.pieza-compuesto-cantidad').value, 10) || 1;
      piezas.push({ piezaId, cantidad });
    });
    return piezas;
  }

  inputTipo.addEventListener('change', () => {
    // Solo sugiere el valor por defecto al CREAR un equipo nuevo; al editar uno
    // existente se respeta lo que ya tenía guardado.
    if (!inputId.value) {
      const tipo = buscarTipo(inputTipo.value);
      if (tipo) inputUsaSerial.checked = TIPOS_CON_SERIAL_POR_DEFECTO.includes(normalizar(tipo.nombre));
    }
    actualizarVisibilidadBrazoEje();
    actualizarVisibilidadAcopleCompuesto();
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

    inputEsCompuesto.checked = !!equipo?.esCompuesto;
    piezasCompuestoList.innerHTML = '';
    actualizarVisibilidadAcopleCompuesto(); // muestra/oculta el grupo según el tipo
    piezasCompuestoWrap.style.display = inputEsCompuesto.checked ? 'block' : 'none';
    const piezas = equipo?.piezasCompuesto || [];
    if (inputEsCompuesto.checked) {
      if (piezas.length) {
        piezas.forEach(p => nuevaFilaPiezaCompuesto(p));
      } else {
        nuevaFilaPiezaCompuesto();
      }
    }
    actualizarPesoCompuesto();
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
      puedeLlevarEjeSolido: inputLlevaEje.checked,
      esCompuesto: inputEsCompuesto.checked,
      piezasCompuesto: inputEsCompuesto.checked ? leerPiezasCompuestoDelFormulario() : []
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
    mostrarSugerenciasPedidosDesdeEquipo();
  });

  filtroTipoSelect.addEventListener('change', () => {
    filtroTipoId = filtroTipoSelect.value;
    renderTabla();
    mostrarSugerenciasPedidosDesdeEquipo();
  });

  function equipoCoincideConFiltros(equipo) {
    if (filtroTipoId && equipo.tipoId !== filtroTipoId) return false;
    if (filtroTexto && !normalizar(equipo.nombre).includes(filtroTexto)) return false;
    return true;
  }

  // ---------- Sugerencias: pedidos que usan un equipo que coincide ----------
  // Debajo del buscador del catálogo, se listan los pedidos que incluyen un
  // equipo coincidente. Queda atado al filtro de tipo activo: si hay un tipo
  // seleccionado, solo sugiere entre pedidos con un equipo de ese tipo; si el
  // filtro está en "Todos los tipos", busca en todo el catálogo.

  const resultadosBuscadorEquipos = document.getElementById('resultados-buscador-equipos');

  // Igual que equipoCoincideConFiltros, pero exige que haya texto escrito
  // (sin texto no tiene sentido mostrar sugerencias de pedidos).
  function equipoCoincideParaSugerencia(equipo) {
    if (!equipo || !filtroTexto) return false;
    if (filtroTipoId && equipo.tipoId !== filtroTipoId) return false;
    return normalizar(equipo.nombre).includes(filtroTexto);
  }

  // Igual que nombreItemPedido() en pedidos.js, pero usando el equiposCache
  // local de esta pestaña (evita depender del closure de pedidos.js).
  function nombreItemPedidoLocal(item) {
    if (item.tipoLinea === 'motoreductor') {
      const motor = equiposCache.find(eq => eq.id === item.motorEquipoId);
      const reductor = equiposCache.find(eq => eq.id === item.reductorEquipoId);
      return `Motoreductor (${motor ? motor.nombre : '?'} + ${reductor ? reductor.nombre : '?'})`;
    }
    const equipo = equiposCache.find(eq => eq.id === item.equipoId);
    return equipo ? equipo.nombre + (equipo.variante ? ` (${equipo.variante})` : '') : 'Equipo no encontrado';
  }

  function nombreCompaniaPedido(pedido) {
    const compania = (window.clientesCache || []).find(c => c.id === pedido.companiaId);
    return compania ? compania.nombre : 'Compañía no encontrada';
  }

  function pedidosQueUsanBusqueda() {
    const pedidos = window.pedidosCache || [];
    const encontrados = [];
    const vistos = new Set();

    pedidos.forEach(pedido => {
      (pedido.equipos || []).forEach(item => {
        let coincide;
        if (item.tipoLinea === 'motoreductor') {
          const motor = equiposCache.find(eq => eq.id === item.motorEquipoId);
          const reductor = equiposCache.find(eq => eq.id === item.reductorEquipoId);
          coincide = equipoCoincideParaSugerencia(motor) || equipoCoincideParaSugerencia(reductor);
        } else {
          const equipo = equiposCache.find(eq => eq.id === item.equipoId);
          coincide = equipoCoincideParaSugerencia(equipo);
        }
        if (coincide && !vistos.has(pedido.id)) {
          vistos.add(pedido.id);
          encontrados.push({ pedido, itemNombre: nombreItemPedidoLocal(item) });
        }
      });
    });

    return encontrados.sort((a, b) => a.pedido.numero - b.pedido.numero);
  }

  function ocultarResultadosEquipos() {
    if (!resultadosBuscadorEquipos) return;
    resultadosBuscadorEquipos.classList.remove('open');
    resultadosBuscadorEquipos.innerHTML = '';
  }

  function mostrarSugerenciasPedidosDesdeEquipo() {
    if (!resultadosBuscadorEquipos) return;
    if (!filtroTexto) return ocultarResultadosEquipos();

    const candidatos = pedidosQueUsanBusqueda().slice(0, 8);

    if (!candidatos.length) {
      resultadosBuscadorEquipos.innerHTML = `<div class="buscador-item-vacio">Ningún pedido usa un equipo que coincida${filtroTipoId ? ' con este tipo' : ''}</div>`;
      resultadosBuscadorEquipos.classList.add('open');
      return;
    }

    resultadosBuscadorEquipos.innerHTML = candidatos.map(c => `
      <div class="buscador-item" data-id="${c.pedido.id}">
        N° ${c.pedido.numero} — ${escapeHtml(nombreCompaniaPedido(c.pedido))}
        <span class="buscador-item-sub">${escapeHtml(c.itemNombre)}</span>
      </div>
    `).join('');
    resultadosBuscadorEquipos.classList.add('open');

    resultadosBuscadorEquipos.querySelectorAll('.buscador-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault(); // evita que el blur cierre la lista antes del click
        const pedidoId = el.dataset.id;
        ocultarResultadosEquipos();
        if (typeof activarTab === 'function') activarTab('pedidos'); // cambia a la pestaña Pedidos
        if (window.abrirFichaPedido) window.abrirFichaPedido(pedidoId); // abre la ficha (expuesto por pedidos.js)
      });
    });
  }

  buscador.addEventListener('focus', mostrarSugerenciasPedidosDesdeEquipo);
  buscador.addEventListener('blur', () => setTimeout(ocultarResultadosEquipos, 120));

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
        equipo.puedeLlevarEjeSolido ? '<span class="meta-chip" title="Puede llevar eje sólido">🔩 Eje</span>' : '',
        equipo.esCompuesto ? `<span class="meta-chip" title="Compuesto por ${((equipo.piezasCompuesto||[]).length)} pieza(s)">🧩 Compuesto</span>` : ''
      ].filter(Boolean).join(' ');

      return `
        <tr data-id="${equipo.id}" class="fila-equipo-clicable">
          <td>${escapeHtml(equipo.nombre)} ${extrasHtml}</td>
          <td>${tipoBadge}</td>
          <td>${varianteHtml}</td>
          <td>${formatearPeso(calcularPesoEquipo(equipo))}${faltaPesoTag}</td>
          <td>${equipo.usaSerial ? '✅' : '—'}</td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn-eliminar danger" data-id="${equipo.id}">Eliminar</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tablaBody.querySelectorAll('tr.fila-equipo-clicable').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button')) return; // los botones tienen su propio comportamiento
        const equipo = equiposCache.find(eq => eq.id === tr.dataset.id);
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
