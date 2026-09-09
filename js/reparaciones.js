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
  const headerNumero = document.getElementById('reparacion-header-numero');
  const form = document.getElementById('form-reparacion');

  const inputId = document.getElementById('reparacion-id');
  const inputNumero = document.getElementById('reparacion-numero');
  const selectCompania = document.getElementById('reparacion-compania');
  const inputContacto = document.getElementById('reparacion-contacto');
  const inputFechaIngreso = document.getElementById('reparacion-fecha-ingreso');
  const inputEvidencia = document.getElementById('reparacion-evidencia');
  const evidenciaInputWrap = document.getElementById('reparacion-evidencia-input-wrap');
  const btnEditarEvidencia = document.getElementById('btn-editar-evidencia');
  const previewEvidencia = document.getElementById('reparacion-evidencia-preview');
  const linkEvidencia = document.getElementById('reparacion-evidencia-link');

  const subtabButtons = modal.querySelectorAll('.subtab-btn');
  const subtabPanels = modal.querySelectorAll('.subtab-panel');

  const reparacionEquiposList = document.getElementById('reparacion-equipos-list');
  const reparacionEquiposEmpty = document.getElementById('reparacion-equipos-empty');
  const btnAgregarReparacionEquipo = document.getElementById('btn-agregar-reparacion-equipo');

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

  function buscarEquipoCatalogo(id) {
    return (window.equiposCache || []).find(eq => eq.id === id);
  }

  function nombreMostrableEquipo(eq) {
    return eq.nombre + (eq.variante ? ` (${eq.variante})` : '');
  }

  function tipoIdPorNombre(nombreNormalizado) {
    const tipo = (window.tiposEquipoCache || []).find(t => normalizar(t.nombre) === nombreNormalizado);
    return tipo ? tipo.id : '';
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

  // "R01 - Contegral Cartago" si ya existe (número + compañía elegida), o
  // "Nueva reparación" mientras se está creando y todavía no hay compañía.
  function textoHeader(reparacion) {
    const compania = buscarCompania(selectCompania.value);
    if (reparacion) {
      return `${formatearNumero(reparacion.numero)}${compania ? ' - ' + compania.nombre : ''}`;
    }
    return compania ? `Nueva reparación - ${compania.nombre}` : 'Nueva reparación';
  }

  // ---------- Evidencia fotográfica: link a carpeta compartida ----------
  // El campo de edición (el input) está oculto por defecto y solo aparece
  // al tocar el lápiz — así la ficha no se ve con un input vacío o con un
  // link larguísimo ocupando espacio todo el tiempo. Al guardar (o cancelar)
  // vuelve a esconderse, dejando ver solo el link ya guardado (si lo hay).

  function mostrarEdicionEvidencia() {
    evidenciaInputWrap.style.display = 'block';
    btnEditarEvidencia.textContent = '💾';
    btnEditarEvidencia.title = 'Guardar este link y cerrar el campo';
    inputEvidencia.focus();
    inputEvidencia.select();
  }

  function ocultarEdicionEvidencia() {
    evidenciaInputWrap.style.display = 'none';
    btnEditarEvidencia.textContent = '✏️';
    btnEditarEvidencia.title = 'Agregar o editar el link';
    actualizarPreviewEvidencia();
  }

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

  // El botón alterna entre lápiz (abre el campo) y disket (guarda el valor
  // escrito y vuelve a esconder el campo) — un solo botón para las dos
  // acciones, según si el campo está abierto o cerrado en ese momento.
  btnEditarEvidencia.addEventListener('click', () => {
    const estaAbierto = evidenciaInputWrap.style.display !== 'none';
    if (estaAbierto) {
      ocultarEdicionEvidencia();
    } else {
      mostrarEdicionEvidencia();
    }
  });

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
    headerNumero.textContent = textoHeader(inputId.value ? { numero: inputNumero.value } : null);
  });

  document.addEventListener('clientes:cambio', () => {
    poblarSelectCompanias();
    renderLista(); // los nombres de compañía en las tarjetas pueden haber cambiado
  });
  if (window.clientesCache && window.clientesCache.length) poblarSelectCompanias();

  // ---------- Sub-pestaña Equipos: qué entra a la reparación ----------
  // Cada fila es un equipo (reductor, motor, motor ZD, o motoreductor =
  // motor + reductor juntos). El "Tipo" se busca en el mismo catálogo de
  // Equipos que usa Pedidos, con autocompletar. La particularidad acá: si el
  // equipo NO existe en el catálogo (porque no es de nuestra marca, por
  // ejemplo), al guardar la reparación se crea automáticamente en Equipos
  // con la variante "Reparación" — así, si el mismo modelo vuelve a llegar
  // más adelante, ya aparece en el buscador y no hay que escribirlo de nuevo.

  // Tipos que puede ser una pieza individual (Motoreductor no aparece acá:
  // se maneja aparte con el checkbox "Es Motoreductor").
  function opcionesTipoFiltroHtml() {
    const permitidos = ['motor', 'reductor', 'motor zd'];
    const tipos = (window.tiposEquipoCache || []).filter(t => permitidos.includes(normalizar(t.nombre)));
    return '<option value="">Tipo...</option>' +
      tipos.map(t => `<option value="${t.id}">${t.icono ? t.icono + ' ' : ''}${escapeHtml(t.nombre)}</option>`).join('');
  }

  function actualizarEmptyEquipos() {
    reparacionEquiposEmpty.style.display = reparacionEquiposList.children.length ? 'none' : 'block';
  }

  // Buscador con autocompletar del catálogo de Equipos (igual que en
  // Pedidos), con el agregado del aviso "se registrará como equipo nuevo"
  // cuando lo escrito no coincide con nada del catálogo.
  function inicializarBuscadorEquipoReparacion(contenedor, { idSelector, obtenerTipoId, avisoEl, seleccionInicialId }) {
    const inputTexto = contenedor.querySelector('.buscador-input');
    const inputValor = contenedor.querySelector(idSelector);
    const resultados = contenedor.querySelector('.buscador-resultados');

    function catalogoFiltrado(texto) {
      const equipos = window.equiposCache || [];
      const tid = obtenerTipoId ? obtenerTipoId() : '';
      const porTipo = tid ? equipos.filter(eq => eq.tipoId === tid) : equipos;
      const t = normalizar(texto);
      return (t ? porTipo.filter(eq => normalizar(eq.nombre + ' ' + (eq.variante || '')).includes(t)) : porTipo).slice(0, 8);
    }

    function actualizarAviso() {
      if (!avisoEl) return;
      const texto = inputTexto.value.trim();
      avisoEl.style.display = (texto && !inputValor.value) ? 'block' : 'none';
    }

    function mostrarResultados() {
      const lista = catalogoFiltrado(inputTexto.value);
      resultados.innerHTML = lista.length
        ? lista.map(eq => `<div class="buscador-item" data-id="${eq.id}">${escapeHtml(nombreMostrableEquipo(eq))}</div>`).join('')
        : `<div class="buscador-item-vacio">Sin coincidencias — se registrará como equipo nuevo</div>`;
      resultados.classList.add('open');
      resultados.querySelectorAll('.buscador-item').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault(); // evita que el blur cierre la lista antes del click
          const eq = (window.equiposCache || []).find(x => x.id === el.dataset.id);
          if (eq) seleccionar(eq);
        });
      });
    }

    function seleccionar(eq) {
      inputValor.value = eq.id;
      inputTexto.value = nombreMostrableEquipo(eq);
      resultados.classList.remove('open');
      actualizarAviso();
    }

    inputTexto.addEventListener('input', () => {
      inputValor.value = ''; // hasta que elija algo de la lista, se trata como "nuevo"
      mostrarResultados();
      actualizarAviso();
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

  function nuevaFilaReparacionEquipo(item) {
    const esMotoreductor = item?.tipoLinea === 'motoreductor';

    const row = document.createElement('div');
    row.className = 'equipo-pedido-row-wrap';
    row.innerHTML = `
      <label class="extra-check chk-es-motoreductor" style="margin-bottom:8px;">
        <input type="checkbox" class="reparacion-equipo-es-motoreductor" ${esMotoreductor ? 'checked' : ''}>
        🔗 Es Motoreductor (Motor + Reductor)
      </label>

      <div class="bloque-individual" style="${esMotoreductor ? 'display:none;' : ''}">
        <div class="equipo-pedido-row tiene-filtro" style="grid-template-columns: 130px 2fr auto;">
          <select class="reparacion-equipo-tipo-filtro">${opcionesTipoFiltroHtml()}</select>
          <div class="buscador-equipo">
            <input type="text" class="buscador-input" placeholder="Escribe el nombre/modelo del equipo..." autocomplete="off">
            <input type="hidden" class="reparacion-equipo-select">
            <div class="buscador-resultados"></div>
          </div>
          <button type="button" class="remove-reparacion-equipo" title="Quitar equipo">✕</button>
        </div>
        <div class="aviso-equipo-nuevo" style="display:none;">🆕 No está en el catálogo — al guardar se registrará como equipo nuevo (variante "Reparación") para poder reutilizarlo si vuelve a llegar.</div>
      </div>

      <div class="reparacion-equipo-motoreductor" style="${esMotoreductor ? '' : 'display:none;'}">
        <div class="motoreductor-selects">
          <div>
            <label class="mini-label">⚡ Motor</label>
            <div class="buscador-equipo">
              <input type="text" class="buscador-input" placeholder="Escribe el motor..." autocomplete="off">
              <input type="hidden" class="reparacion-equipo-motor">
              <div class="buscador-resultados"></div>
            </div>
            <div class="aviso-equipo-nuevo" style="display:none;">🆕 Motor nuevo — se registrará en el catálogo (variante "Reparación").</div>
          </div>
          <div>
            <label class="mini-label">⚙️ Reductor</label>
            <div class="buscador-equipo">
              <input type="text" class="buscador-input" placeholder="Escribe el reductor..." autocomplete="off">
              <input type="hidden" class="reparacion-equipo-reductor">
              <div class="buscador-resultados"></div>
            </div>
            <div class="aviso-equipo-nuevo" style="display:none;">🆕 Reductor nuevo — se registrará en el catálogo (variante "Reparación").</div>
          </div>
        </div>
        <div style="display:flex; justify-content:flex-end; margin-top:8px;">
          <button type="button" class="remove-reparacion-equipo" title="Quitar equipo">✕</button>
        </div>
      </div>
    `;

    row.querySelectorAll('.remove-reparacion-equipo').forEach(btn => {
      btn.addEventListener('click', () => {
        row.remove();
        actualizarEmptyEquipos();
      });
    });

    const chkEsMotoreductor = row.querySelector('.reparacion-equipo-es-motoreductor');
    const bloqueIndividual = row.querySelector('.bloque-individual');
    const bloqueMotoreductor = row.querySelector('.reparacion-equipo-motoreductor');
    const selectTipoFiltro = row.querySelector('.reparacion-equipo-tipo-filtro');

    function actualizarModo() {
      const esMr = chkEsMotoreductor.checked;
      bloqueIndividual.style.display = esMr ? 'none' : 'block';
      bloqueMotoreductor.style.display = esMr ? 'block' : 'none';
    }
    chkEsMotoreductor.addEventListener('change', actualizarModo);

    const contenedorIndividual = bloqueIndividual.querySelector('.buscador-equipo');
    const apiIndividual = inicializarBuscadorEquipoReparacion(contenedorIndividual, {
      idSelector: '.reparacion-equipo-select',
      obtenerTipoId: () => selectTipoFiltro.value,
      avisoEl: bloqueIndividual.querySelector('.aviso-equipo-nuevo'),
      seleccionInicialId: !esMotoreductor ? item?.equipoId : null
    });

    // Si cambia el tipo, la búsqueda se re-filtra y cualquier selección
    // previa deja de ser válida (era de otro tipo).
    selectTipoFiltro.addEventListener('change', () => {
      contenedorIndividual.querySelector('.reparacion-equipo-select').value = '';
      apiIndividual.refrescar();
    });

    // Precarga del tipo, en modo edición, a partir del equipo ya guardado.
    if (!esMotoreductor && item?.equipoId) {
      const equipo = buscarEquipoCatalogo(item.equipoId);
      if (equipo) selectTipoFiltro.value = equipo.tipoId || '';
    }

    const contenedoresMR = bloqueMotoreductor.querySelectorAll('.buscador-equipo');
    const avisosMR = bloqueMotoreductor.querySelectorAll('.aviso-equipo-nuevo');
    inicializarBuscadorEquipoReparacion(contenedoresMR[0], {
      idSelector: '.reparacion-equipo-motor',
      obtenerTipoId: () => tipoIdPorNombre('motor'),
      avisoEl: avisosMR[0],
      seleccionInicialId: esMotoreductor ? item?.motorEquipoId : null
    });
    inicializarBuscadorEquipoReparacion(contenedoresMR[1], {
      idSelector: '.reparacion-equipo-reductor',
      obtenerTipoId: () => tipoIdPorNombre('reductor'),
      avisoEl: avisosMR[1],
      seleccionInicialId: esMotoreductor ? item?.reductorEquipoId : null
    });

    reparacionEquiposList.appendChild(row);
  }

  btnAgregarReparacionEquipo.addEventListener('click', () => {
    nuevaFilaReparacionEquipo(null);
    actualizarEmptyEquipos();
  });

  // Si ya hay un equipo elegido del catálogo, se usa tal cual. Si no, pero
  // hay texto escrito, se crea un equipo NUEVO en el catálogo con la
  // variante "Reparación" — para poder reutilizarlo si el mismo modelo
  // vuelve a llegar en una reparación futura.
  async function resolverEquipoId(texto, idExistente, tipoId) {
    if (idExistente) return idExistente;
    if (!texto) return '';
    const nuevo = await db.collection('equipos').add({
      nombre: texto,
      tipoId: tipoId || '',
      variante: 'Reparación',
      peso: null,
      usaSerial: false,
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    return nuevo.id;
  }

  // Recorre las filas del formulario y resuelve cada una a un objeto listo
  // para guardar en la reparación, creando en el catálogo los equipos que
  // hagan falta. Filas vacías (sin nada escrito) se ignoran en silencio.
  async function resolverEquiposDeFormulario() {
    const resultado = [];
    for (const fila of Array.from(reparacionEquiposList.children)) {
      const esMr = fila.querySelector('.reparacion-equipo-es-motoreductor').checked;

      if (esMr) {
        const mrBlock = fila.querySelector('.reparacion-equipo-motoreductor');
        const buscadores = mrBlock.querySelectorAll('.buscador-input');
        const idsOcultos = mrBlock.querySelectorAll('input[type="hidden"]');
        const motorTexto = buscadores[0].value.trim();
        const reductorTexto = buscadores[1].value.trim();
        if (!motorTexto && !reductorTexto) continue; // fila vacía

        const motorEquipoId = await resolverEquipoId(motorTexto, idsOcultos[0].value, tipoIdPorNombre('motor'));
        const reductorEquipoId = await resolverEquipoId(reductorTexto, idsOcultos[1].value, tipoIdPorNombre('reductor'));
        resultado.push({ tipoLinea: 'motoreductor', motorEquipoId, reductorEquipoId });
      } else {
        const bloque = fila.querySelector('.bloque-individual');
        const texto = bloque.querySelector('.buscador-input').value.trim();
        const idExistente = bloque.querySelector('.reparacion-equipo-select').value;
        const tipoId = bloque.querySelector('.reparacion-equipo-tipo-filtro').value;
        if (!texto) continue; // fila vacía

        if (!idExistente && !tipoId) {
          return { error: 'Falta elegir el "Tipo" de uno de los equipos — se necesita para poder registrarlo si es nuevo.' };
        }

        const equipoId = await resolverEquipoId(texto, idExistente, tipoId);
        const tipoIdFinal = tipoId || (buscarEquipoCatalogo(equipoId)?.tipoId || '');
        resultado.push({ tipoLinea: 'individual', tipoId: tipoIdFinal, equipoId });
      }
    }
    return { equipos: resultado };
  }

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
    ocultarEdicionEvidencia();
    headerNumero.textContent = textoHeader(reparacion);
    reparacionEquiposList.innerHTML = '';
    (reparacion?.equipos || []).forEach(item => nuevaFilaReparacionEquipo(item));
    actualizarEmptyEquipos();
    resetSubtabs();
  }

  function abrirModalNuevo() {
    if (borradorId === '') {
      // Ya había un borrador de reparación nueva en curso: se retoma tal cual
      // (incluye lo que ya tenía escrito, así que se recalcula el header).
      headerNumero.textContent = textoHeader(null);
      modal.classList.add('open');
      selectCompania.focus();
      return;
    }
    cargarFormularioDesdeReparacion(null);
    borradorId = '';
    modal.classList.add('open');
    selectCompania.focus();
  }

  function abrirModalEditar(reparacion) {
    if (borradorId === reparacion.id) {
      headerNumero.textContent = textoHeader(reparacion);
      modal.classList.add('open');
      return;
    }
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
    ocultarEdicionEvidencia();
    previewEvidencia.style.display = 'none';
    reparacionEquiposList.innerHTML = '';
    actualizarEmptyEquipos();
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
      const resuelto = await resolverEquiposDeFormulario();
      if (resuelto.error) {
        alert(resuelto.error);
        return;
      }

      if (id) {
        await db.collection(COLECCION).doc(id).update({
          companiaId,
          contacto: inputContacto.value.trim(),
          fechaIngreso: inputFechaIngreso.value || null,
          evidenciaFotografica: inputEvidencia.value.trim(),
          equipos: resuelto.equipos
        });
      } else {
        const numero = siguienteNumeroDisponible(); // recalculado justo antes de guardar
        await db.collection(COLECCION).add({
          numero,
          companiaId,
          contacto: inputContacto.value.trim(),
          fechaIngreso: inputFechaIngreso.value || fechaHoyISO(),
          evidenciaFotografica: inputEvidencia.value.trim(),
          equipos: resuelto.equipos,
          creadoEn: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      form.reset();
      resetSubtabs();
      ocultarEdicionEvidencia();
      previewEvidencia.style.display = 'none';
      reparacionEquiposList.innerHTML = '';
      actualizarEmptyEquipos();
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
