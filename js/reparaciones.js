// ================== Pestaña: Reparaciones ==================
// CRUD de reparaciones sobre Firestore (colección "reparaciones").
//
// Se registra QUÉ COMPAÑÍA trae el equipo a reparar, QUIÉN es el encargado
// de reparaciones de esa compañía (a diferencia de Pedidos, que usa
// "encargado de PEDIDOS", acá se usa el campo "encargado de reparaciones"
// del cliente) y el EQUIPO que ingresa.
//
// Una reparación solo puede traer UN equipo: un motor, un reductor, un
// motor ZD, o un motoreductor (motor + reductor juntos, con el checkbox
// "Es Motoreductor"). El "Tipo" se busca en el mismo catálogo de Equipos
// que usa Pedidos, con autocompletar. Si el equipo elegido en el catálogo
// tiene número de serial habilitado ("usaSerial"), aparece un campo para
// escribirlo. Si el equipo NO existe en el catálogo (porque no es de
// nuestra marca, por ejemplo), al guardar la reparación se crea
// automáticamente en Equipos con la variante "Reparación" — así, si el
// mismo modelo vuelve a llegar más adelante, ya aparece en el buscador.
//
// Cada reparación:
// {
//   numero (entero — se muestra como "R01", "R02"... con el prefijo "R" y
//           2 dígitos; se reutiliza el menor número libre si se borra una
//           reparación, exactamente igual que el N° de Pedidos),
//   companiaId,
//   contacto (encargado de reparaciones; se autocompleta desde el cliente
//             elegido, pero se puede ajustar a mano por si ese día recibe
//             otra persona — no se muestra en la ficha de listado, solo
//             sirve como referencia interna al preparar la entrega),
//   fechaIngreso,
//   evidenciaFotografica,
//   observacionesIniciales (HTML simple — negrilla, cursiva y listas; texto
//                           libre sobre el estado en que llegó el equipo.
//                           Mismo patrón texto/edición que el equipo y la
//                           evidencia),
//   equipo: null, o uno de:
//     { tipoLinea: 'individual', tipoId, equipoId, serial? }
//     { tipoLinea: 'motoreductor', motorEquipoId, motorSerial?,
//       reductorEquipoId, reductorSerial? }
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

  // Sub-pestaña Equipos: un único bloque fijo (no una lista repetible).
  // Igual que la Evidencia fotográfica: una vez guardado, se ve como texto;
  // el botón ✏️ abre la edición y al volver a tocarlo (💾) se guarda y
  // vuelve a mostrarse como texto.
  const btnEditarEquipo = document.getElementById('btn-editar-equipo');
  const equipoTextoEl = document.getElementById('reparacion-equipo-texto');
  const equipoEdicionWrap = document.getElementById('reparacion-equipo-edicion-wrap');

  // Observaciones iniciales: mismo patrón texto/edición que Equipo y que la
  // Evidencia fotográfica. El campo es un editor de texto enriquecido
  // simple (negrilla, cursiva, listas) hecho con contenteditable — se
  // guarda como HTML, pero saneado a una lista corta de etiquetas permitidas
  // para no arrastrar estilos ni scripts pegados desde otro lado.
  const btnEditarObservaciones = document.getElementById('btn-editar-observaciones');
  const observacionesTextoEl = document.getElementById('reparacion-observaciones-texto');
  const observacionesEdicionWrap = document.getElementById('reparacion-observaciones-edicion-wrap');
  const inputObservaciones = document.getElementById('reparacion-observaciones-input');

  const ETIQUETAS_RTE_PERMITIDAS = new Set(['B', 'STRONG', 'I', 'EM', 'UL', 'OL', 'LI', 'BR', 'DIV', 'P']);

  // Deja solo negrilla/cursiva/listas/saltos de línea; cualquier otra
  // etiqueta (spans con estilos pegados, imágenes, links, etc.) se
  // "desenvuelve" dejando su texto, sin el tag. Además borra todos los
  // atributos (style, onclick...) de las etiquetas que sí se conservan.
  function sanearHtmlObservaciones(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html || '';

    function limpiar(nodo) {
      Array.from(nodo.childNodes).forEach(hijo => {
        if (hijo.nodeType === Node.ELEMENT_NODE) {
          limpiar(hijo);
          if (!ETIQUETAS_RTE_PERMITIDAS.has(hijo.tagName)) {
            while (hijo.firstChild) nodo.insertBefore(hijo.firstChild, hijo);
            nodo.removeChild(hijo);
          } else {
            while (hijo.attributes.length) hijo.removeAttribute(hijo.attributes[0].name);
          }
        } else if (hijo.nodeType !== Node.TEXT_NODE) {
          nodo.removeChild(hijo); // comentarios, etc.
        }
      });
    }
    limpiar(temp);
    return temp.innerHTML;
  }

  // Un editor contenteditable "vacío" a veces queda con un <br> suelto
  // adentro (lo agrega el navegador solo), por eso no basta con mirar si
  // el HTML es una cadena vacía.
  function htmlObservacionesEstaVacio(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html || '';
    return temp.textContent.trim() === '';
  }

  function actualizarTextoObservaciones() {
    const html = sanearHtmlObservaciones(inputObservaciones.innerHTML);
    observacionesTextoEl.innerHTML = htmlObservacionesEstaVacio(html)
      ? '<span class="reparacion-card-sin-equipo">Sin observaciones registradas.</span>'
      : html;
  }

  function mostrarEdicionObservaciones() {
    observacionesEdicionWrap.style.display = 'block';
    observacionesTextoEl.style.display = 'none';
    btnEditarObservaciones.textContent = '💾';
    btnEditarObservaciones.title = 'Guardar y volver a la vista de texto';
    inputObservaciones.focus();
  }

  function ocultarEdicionObservaciones() {
    observacionesEdicionWrap.style.display = 'none';
    observacionesTextoEl.style.display = 'block';
    btnEditarObservaciones.textContent = '✏️';
    btnEditarObservaciones.title = 'Agregar o editar las observaciones';
    actualizarTextoObservaciones();
  }

  btnEditarObservaciones.addEventListener('click', () => {
    const estaAbierto = observacionesEdicionWrap.style.display !== 'none';
    if (estaAbierto) {
      ocultarEdicionObservaciones();
    } else {
      mostrarEdicionObservaciones();
    }
  });

  // Barra de herramientas: negrilla, cursiva, lista con viñetas, lista
  // numerada. document.execCommand sigue funcionando bien para este tipo de
  // edición simple dentro de un contenteditable en todos los navegadores
  // de escritorio habituales.
  document.querySelectorAll('#reparacion-observaciones-toolbar .rte-btn').forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // no perder la selección al hacer click
    btn.addEventListener('click', () => {
      document.execCommand(btn.dataset.cmd, false, null);
      inputObservaciones.focus();
    });
  });

  // Carga (o deja en blanco) el campo y decide el modo inicial: si ya
  // había texto guardado, arranca en modo texto; si no, en modo edición.
  function cargarObservacionesReparacion(html) {
    inputObservaciones.innerHTML = sanearHtmlObservaciones(html || '');
    if (!htmlObservacionesEstaVacio(inputObservaciones.innerHTML)) {
      ocultarEdicionObservaciones();
    } else {
      inputObservaciones.innerHTML = '';
      mostrarEdicionObservaciones();
    }
  }

  function limpiarObservacionesReparacion() {
    inputObservaciones.innerHTML = '';
  }

  const chkEsMotoreductor = document.getElementById('reparacion-equipo-es-motoreductor');
  const bloqueIndividual = document.getElementById('reparacion-bloque-individual');
  const bloqueMotoreductor = document.getElementById('reparacion-bloque-motoreductor');
  const selectTipoFiltro = document.getElementById('reparacion-equipo-tipo-filtro');

  const inputEquipoTexto = document.getElementById('reparacion-equipo-buscador-input');
  const inputEquipoId = document.getElementById('reparacion-equipo-select');
  const avisoEquipoNuevo = document.getElementById('reparacion-equipo-aviso-nuevo');
  const serialWrapIndividual = document.getElementById('reparacion-equipo-serial-wrap');
  const inputSerialIndividual = document.getElementById('reparacion-equipo-serial');

  const inputMotorTexto = document.getElementById('reparacion-motor-buscador-input');
  const inputMotorId = document.getElementById('reparacion-motor-select');
  const avisoMotorNuevo = document.getElementById('reparacion-motor-aviso-nuevo');
  const serialWrapMotor = document.getElementById('reparacion-motor-serial-wrap');
  const inputSerialMotor = document.getElementById('reparacion-motor-serial');

  const inputReductorTexto = document.getElementById('reparacion-reductor-buscador-input');
  const inputReductorId = document.getElementById('reparacion-reductor-select');
  const avisoReductorNuevo = document.getElementById('reparacion-reductor-aviso-nuevo');
  const serialWrapReductor = document.getElementById('reparacion-reductor-serial-wrap');
  const inputSerialReductor = document.getElementById('reparacion-reductor-serial');

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
  // Un único equipo por reparación: motor, reductor, motor ZD, o
  // motoreductor (motor + reductor juntos, con el checkbox "Es
  // Motoreductor"). El "Tipo" se busca en el mismo catálogo de Equipos que
  // usa Pedidos, con autocompletar. Si el equipo elegido en el catálogo
  // maneja número de serial ("usaSerial"), se muestra un campo para
  // escribirlo. Si el equipo NO existe en el catálogo (porque no es de
  // nuestra marca, por ejemplo), al guardar la reparación se crea
  // automáticamente en Equipos con la variante "Reparación" — así, si el
  // mismo modelo vuelve a llegar más adelante, ya aparece en el buscador y
  // no hay que escribirlo de nuevo.

  // Tipos que puede ser una pieza individual (Motoreductor no aparece acá:
  // se maneja aparte con el checkbox "Es Motoreductor").
  function opcionesTipoFiltroHtml() {
    const permitidos = ['motor', 'reductor', 'motor zd'];
    const tipos = (window.tiposEquipoCache || []).filter(t => permitidos.includes(normalizar(t.nombre)));
    return '<option value="">Tipo...</option>' +
      tipos.map(t => `<option value="${t.id}">${t.icono ? t.icono + ' ' : ''}${escapeHtml(t.nombre)}</option>`).join('');
  }

  function poblarSelectTipoFiltro() {
    const actual = selectTipoFiltro.value;
    selectTipoFiltro.innerHTML = opcionesTipoFiltroHtml();
    if (actual) selectTipoFiltro.value = actual;
  }

  function actualizarModoEquipo() {
    const esMr = chkEsMotoreductor.checked;
    bloqueIndividual.style.display = esMr ? 'none' : 'block';
    bloqueMotoreductor.style.display = esMr ? 'block' : 'none';
  }
  chkEsMotoreductor.addEventListener('change', actualizarModoEquipo);

  // Muestra/oculta el campo de serial correspondiente. `mostrar` puede ser
  // el equipo del catálogo (se muestra si `usaSerial`) o directamente un
  // booleano.
  function mostrarOcultarSerial(wrapEl, inputEl, eqOMostrar) {
    const mostrar = typeof eqOMostrar === 'boolean' ? eqOMostrar : !!(eqOMostrar && eqOMostrar.usaSerial);
    wrapEl.style.display = mostrar ? 'block' : 'none';
    if (!mostrar) inputEl.value = '';
  }

  // IDs de tipo permitidos (motor, reductor, motor zd) — usado tanto para
  // poblar el select "Tipo..." como para que el buscador de equipo, cuando
  // todavía no se ha elegido un tipo, no muestre TODO el catálogo (acoples,
  // cadenas, etc.) sino solo estos tres.
  function tipoIdsPermitidos() {
    const permitidos = ['motor', 'reductor', 'motor zd'];
    return new Set(
      (window.tiposEquipoCache || [])
        .filter(t => permitidos.includes(normalizar(t.nombre)))
        .map(t => t.id)
    );
  }

  // Posiciona el desplegable de resultados como "position: fixed" en base
  // a la posición real del input en la pantalla, para que no quede
  // recortado por el scroll interno de la ficha (el modal tiene poco alto
  // y el panel de "Equipos" hace scroll propio).
  function posicionarResultados(inputTexto, resultados) {
    const rect = inputTexto.getBoundingClientRect();
    resultados.style.position = 'fixed';
    resultados.style.top = (rect.bottom + 4) + 'px';
    resultados.style.left = rect.left + 'px';
    resultados.style.width = rect.width + 'px';
    resultados.style.right = 'auto';
  }

  // Buscador con autocompletar del catálogo de Equipos (igual que en
  // Pedidos), con el agregado del aviso "se registrará como equipo nuevo"
  // cuando lo escrito no coincide con nada del catálogo, y un callback para
  // mostrar/ocultar el campo de serial según si el equipo elegido lo maneja.
  //
  // `restringirATiposPermitidos`: cuando no hay un tipo elegido todavía
  // (obtenerTipoId() devuelve vacío), en vez de mostrar todo el catálogo
  // solo muestra motor/reductor/motor ZD. Se usa en el buscador individual,
  // que es el único con tipo variable (motor y reductor del motoreductor ya
  // vienen con su tipo fijo).
  function inicializarBuscadorEquipoReparacion({ inputTexto, inputValor, avisoEl, obtenerTipoId, restringirATiposPermitidos, onSeleccion }) {
    const resultados = inputTexto.closest('.buscador-equipo').querySelector('.buscador-resultados');

    function catalogoFiltrado(texto) {
      const equipos = window.equiposCache || [];
      const tid = obtenerTipoId ? obtenerTipoId() : '';
      let porTipo;
      if (tid) {
        porTipo = equipos.filter(eq => eq.tipoId === tid);
      } else if (restringirATiposPermitidos) {
        const idsPermitidos = tipoIdsPermitidos();
        porTipo = equipos.filter(eq => idsPermitidos.has(eq.tipoId));
      } else {
        porTipo = equipos;
      }
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
      posicionarResultados(inputTexto, resultados);
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
      if (onSeleccion) onSeleccion(eq);
    }

    inputTexto.addEventListener('input', () => {
      inputValor.value = ''; // hasta que elija algo de la lista, se trata como "nuevo"
      mostrarResultados();
      actualizarAviso();
      if (onSeleccion) onSeleccion(null); // equipo nuevo: nunca tiene serial en catálogo todavía
    });
    inputTexto.addEventListener('focus', mostrarResultados);
    inputTexto.addEventListener('blur', () => {
      setTimeout(() => resultados.classList.remove('open'), 120);
    });
    // Si se hace scroll (el panel de la ficha tiene su propio scroll
    // interno), el desplegable quedaría desalineado del input — mejor
    // cerrarlo, igual que pasaría al hacer blur.
    window.addEventListener('scroll', () => resultados.classList.remove('open'), true);

    return { refrescar: mostrarResultados };
  }

  const apiEquipoIndividual = inicializarBuscadorEquipoReparacion({
    inputTexto: inputEquipoTexto,
    inputValor: inputEquipoId,
    avisoEl: avisoEquipoNuevo,
    obtenerTipoId: () => selectTipoFiltro.value,
    restringirATiposPermitidos: true,
    onSeleccion: (eq) => {
      mostrarOcultarSerial(serialWrapIndividual, inputSerialIndividual, eq);
      // Autocompleta el "Tipo" según el equipo elegido (ej. al escoger
      // "YE3 L112-4 5HP" del catálogo, se sabe que es un Motor).
      if (eq && eq.tipoId) selectTipoFiltro.value = eq.tipoId;
    }
  });

  // Si cambia el tipo, la búsqueda se re-filtra y cualquier selección
  // previa deja de ser válida (era de otro tipo).
  selectTipoFiltro.addEventListener('change', () => {
    inputEquipoId.value = '';
    inputEquipoTexto.value = '';
    mostrarOcultarSerial(serialWrapIndividual, inputSerialIndividual, false);
    apiEquipoIndividual.refrescar();
  });

  inicializarBuscadorEquipoReparacion({
    inputTexto: inputMotorTexto,
    inputValor: inputMotorId,
    avisoEl: avisoMotorNuevo,
    obtenerTipoId: () => tipoIdPorNombre('motor'),
    onSeleccion: (eq) => mostrarOcultarSerial(serialWrapMotor, inputSerialMotor, eq)
  });

  inicializarBuscadorEquipoReparacion({
    inputTexto: inputReductorTexto,
    inputValor: inputReductorId,
    avisoEl: avisoReductorNuevo,
    obtenerTipoId: () => tipoIdPorNombre('reductor'),
    onSeleccion: (eq) => mostrarOcultarSerial(serialWrapReductor, inputSerialReductor, eq)
  });

  // Icono del tipo de equipo según su tipoId (para la vista de texto, antes
  // de que el equipo exista como objeto del catálogo resuelto).
  function iconoDeTipoId(tipoId) {
    const tipo = (window.tiposEquipoCache || []).find(t => t.id === tipoId);
    return tipo?.icono ? tipo.icono + ' ' : '';
  }

  // Arma el HTML de la vista de solo lectura a partir de lo que hay
  // escrito/elegido en ese momento en el formulario (sin tocar Firestore:
  // si el equipo es nuevo, no se crea en el catálogo hasta guardar la
  // reparación completa — acá solo se marca con la etiqueta "(nuevo)").
  function previewEquipoDesdeFormulario() {
    if (chkEsMotoreductor.checked) {
      const motorTexto = inputMotorTexto.value.trim();
      const reductorTexto = inputReductorTexto.value.trim();
      if (!motorTexto && !reductorTexto) return '';

      const motorHtml = motorTexto
        ? escapeHtml(motorTexto) + (inputMotorId.value ? '' : ' <span class="tag-nuevo-equipo">(nuevo)</span>')
        : '<span style="color:var(--danger);">Falta el motor</span>';
      const reductorHtml = reductorTexto
        ? escapeHtml(reductorTexto) + (inputReductorId.value ? '' : ' <span class="tag-nuevo-equipo">(nuevo)</span>')
        : '<span style="color:var(--danger);">Falta el reductor</span>';
      const serialMotor = inputSerialMotor.value.trim() ? `<span class="reparacion-card-serial">S/N ${escapeHtml(inputSerialMotor.value.trim())}</span>` : '';
      const serialReductor = inputSerialReductor.value.trim() ? `<span class="reparacion-card-serial">S/N ${escapeHtml(inputSerialReductor.value.trim())}</span>` : '';
      return `🔗 Motoreductor — ⚡ ${motorHtml}${serialMotor} + ⚙️ ${reductorHtml}${serialReductor}`;
    }

    const texto = inputEquipoTexto.value.trim();
    if (!texto) return '';
    const nuevoTag = inputEquipoId.value ? '' : ' <span class="tag-nuevo-equipo">(nuevo)</span>';
    const serial = inputSerialIndividual.value.trim() ? `<span class="reparacion-card-serial">S/N ${escapeHtml(inputSerialIndividual.value.trim())}</span>` : '';
    return `${iconoDeTipoId(selectTipoFiltro.value)}${escapeHtml(texto)}${nuevoTag}${serial}`;
  }

  function actualizarTextoEquipo() {
    const html = previewEquipoDesdeFormulario();
    equipoTextoEl.innerHTML = html || '<span class="reparacion-card-sin-equipo">Aún no se ha registrado ningún equipo.</span>';
  }

  function mostrarEdicionEquipo() {
    equipoEdicionWrap.style.display = 'block';
    equipoTextoEl.style.display = 'none';
    btnEditarEquipo.textContent = '💾';
    btnEditarEquipo.title = 'Guardar y volver a la vista de texto';
  }

  function ocultarEdicionEquipo() {
    equipoEdicionWrap.style.display = 'none';
    equipoTextoEl.style.display = 'block';
    btnEditarEquipo.textContent = '✏️';
    btnEditarEquipo.title = 'Agregar o editar el equipo';
    actualizarTextoEquipo();
  }

  btnEditarEquipo.addEventListener('click', () => {
    const estaAbierto = equipoEdicionWrap.style.display !== 'none';
    if (estaAbierto) {
      ocultarEdicionEquipo();
    } else {
      mostrarEdicionEquipo();
    }
  });

  // Deja el bloque de equipo completamente en blanco (equipo nuevo/borrado).
  function limpiarEquipoReparacion() {
    chkEsMotoreductor.checked = false;
    actualizarModoEquipo();

    inputEquipoTexto.value = '';
    inputEquipoId.value = '';
    selectTipoFiltro.value = '';
    avisoEquipoNuevo.style.display = 'none';
    mostrarOcultarSerial(serialWrapIndividual, inputSerialIndividual, false);

    inputMotorTexto.value = '';
    inputMotorId.value = '';
    avisoMotorNuevo.style.display = 'none';
    mostrarOcultarSerial(serialWrapMotor, inputSerialMotor, false);

    inputReductorTexto.value = '';
    inputReductorId.value = '';
    avisoReductorNuevo.style.display = 'none';
    mostrarOcultarSerial(serialWrapReductor, inputSerialReductor, false);
  }

  // Carga en el bloque fijo el equipo ya guardado de una reparación (o lo
  // deja vacío si `equipo` es null/undefined, ej. reparación nueva).
  function cargarEquipoReparacion(equipo) {
    limpiarEquipoReparacion();
    poblarSelectTipoFiltro();
    if (!equipo) {
      // Nada guardado todavía: se muestra directamente el formulario para
      // completarlo (no tiene sentido mostrar una vista de texto vacía).
      mostrarEdicionEquipo();
      return;
    }

    if (equipo.tipoLinea === 'motoreductor') {
      chkEsMotoreductor.checked = true;
      actualizarModoEquipo();

      const motor = buscarEquipoCatalogo(equipo.motorEquipoId);
      if (motor) {
        inputMotorId.value = motor.id;
        inputMotorTexto.value = nombreMostrableEquipo(motor);
      }
      mostrarOcultarSerial(serialWrapMotor, inputSerialMotor, !!(equipo.motorSerial || motor?.usaSerial));
      inputSerialMotor.value = equipo.motorSerial || '';

      const reductor = buscarEquipoCatalogo(equipo.reductorEquipoId);
      if (reductor) {
        inputReductorId.value = reductor.id;
        inputReductorTexto.value = nombreMostrableEquipo(reductor);
      }
      mostrarOcultarSerial(serialWrapReductor, inputSerialReductor, !!(equipo.reductorSerial || reductor?.usaSerial));
      inputSerialReductor.value = equipo.reductorSerial || '';
    } else {
      chkEsMotoreductor.checked = false;
      actualizarModoEquipo();

      const eq = buscarEquipoCatalogo(equipo.equipoId);
      if (eq) {
        selectTipoFiltro.value = eq.tipoId || '';
        inputEquipoId.value = eq.id;
        inputEquipoTexto.value = nombreMostrableEquipo(eq);
      }
      mostrarOcultarSerial(serialWrapIndividual, inputSerialIndividual, !!(equipo.serial || eq?.usaSerial));
      inputSerialIndividual.value = equipo.serial || '';
    }

    // Ya había un equipo guardado: se muestra como texto, listo para
    // tocar el lápiz si hay que corregirlo.
    ocultarEdicionEquipo();
  }

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

  // Resuelve el bloque de equipo del formulario a un objeto listo para
  // guardar en la reparación, creando en el catálogo el equipo que haga
  // falta. Si el bloque está vacío, devuelve equipo: null en silencio.
  async function resolverEquipoDeFormulario() {
    if (chkEsMotoreductor.checked) {
      const motorTexto = inputMotorTexto.value.trim();
      const reductorTexto = inputReductorTexto.value.trim();
      if (!motorTexto && !reductorTexto) return { equipo: null };

      const motorEquipoId = await resolverEquipoId(motorTexto, inputMotorId.value, tipoIdPorNombre('motor'));
      const reductorEquipoId = await resolverEquipoId(reductorTexto, inputReductorId.value, tipoIdPorNombre('reductor'));
      const motorSerial = inputSerialMotor.value.trim();
      const reductorSerial = inputSerialReductor.value.trim();
      return {
        equipo: {
          tipoLinea: 'motoreductor',
          motorEquipoId,
          ...(motorSerial ? { motorSerial } : {}),
          reductorEquipoId,
          ...(reductorSerial ? { reductorSerial } : {})
        }
      };
    }

    const texto = inputEquipoTexto.value.trim();
    const idExistente = inputEquipoId.value;
    const tipoId = selectTipoFiltro.value;
    if (!texto) return { equipo: null };

    if (!idExistente && !tipoId) {
      return { error: 'Falta elegir el "Tipo" del equipo — se necesita para poder registrarlo si es nuevo.' };
    }

    const equipoId = await resolverEquipoId(texto, idExistente, tipoId);
    const tipoIdFinal = tipoId || (buscarEquipoCatalogo(equipoId)?.tipoId || '');
    const serial = inputSerialIndividual.value.trim();
    return {
      equipo: {
        tipoLinea: 'individual',
        tipoId: tipoIdFinal,
        equipoId,
        ...(serial ? { serial } : {})
      }
    };
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
    cargarEquipoReparacion(reparacion?.equipo || null);
    cargarObservacionesReparacion(reparacion?.observacionesIniciales || '');
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
    limpiarEquipoReparacion();
    limpiarObservacionesReparacion();
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
      const resuelto = await resolverEquipoDeFormulario();
      if (resuelto.error) {
        alert(resuelto.error);
        return;
      }

      const observacionesHtml = sanearHtmlObservaciones(inputObservaciones.innerHTML);
      const observacionesIniciales = htmlObservacionesEstaVacio(observacionesHtml) ? '' : observacionesHtml;

      if (id) {
        await db.collection(COLECCION).doc(id).update({
          companiaId,
          contacto: inputContacto.value.trim(),
          fechaIngreso: inputFechaIngreso.value || null,
          evidenciaFotografica: inputEvidencia.value.trim(),
          equipo: resuelto.equipo,
          observacionesIniciales
        });
      } else {
        const numero = siguienteNumeroDisponible(); // recalculado justo antes de guardar
        await db.collection(COLECCION).add({
          numero,
          companiaId,
          contacto: inputContacto.value.trim(),
          fechaIngreso: inputFechaIngreso.value || fechaHoyISO(),
          evidenciaFotografica: inputEvidencia.value.trim(),
          equipo: resuelto.equipo,
          observacionesIniciales,
          creadoEn: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      form.reset();
      resetSubtabs();
      ocultarEdicionEvidencia();
      previewEvidencia.style.display = 'none';
      limpiarEquipoReparacion();
      limpiarObservacionesReparacion();
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

  // Icono del tipo de un equipo del catálogo (config de Tipos de equipo).
  function iconoTipoDe(equipo) {
    if (!equipo) return '';
    const tipo = (window.tiposEquipoCache || []).find(t => t.id === equipo.tipoId);
    return tipo?.icono ? tipo.icono + ' ' : '';
  }

  // Texto plano (para el buscador) con nombre(s) y serial(es) del equipo.
  function textoEquipoBusqueda(reparacion) {
    const item = reparacion.equipo;
    if (!item) return '';
    if (item.tipoLinea === 'motoreductor') {
      const motor = buscarEquipoCatalogo(item.motorEquipoId);
      const reductor = buscarEquipoCatalogo(item.reductorEquipoId);
      return normalizar([
        motor ? nombreMostrableEquipo(motor) : '',
        reductor ? nombreMostrableEquipo(reductor) : '',
        item.motorSerial || '',
        item.reductorSerial || ''
      ].join(' '));
    }
    const eq = buscarEquipoCatalogo(item.equipoId);
    return normalizar([(eq ? nombreMostrableEquipo(eq) : ''), item.serial || ''].join(' '));
  }

  // HTML (para la tarjeta) con el/los equipo(s) y su(s) serial(es), en
  // grande, ya que es el dato más importante de la ficha junto a la
  // compañía.
  function htmlEquipoTarjeta(reparacion) {
    const item = reparacion.equipo;
    if (!item) return '<span class="reparacion-card-sin-equipo">Sin equipo registrado</span>';

    if (item.tipoLinea === 'motoreductor') {
      const motor = buscarEquipoCatalogo(item.motorEquipoId);
      const reductor = buscarEquipoCatalogo(item.reductorEquipoId);
      const motorTxt = motor
        ? escapeHtml(nombreMostrableEquipo(motor))
        : '<span style="color:var(--danger);">Motor no encontrado</span>';
      const reductorTxt = reductor
        ? escapeHtml(nombreMostrableEquipo(reductor))
        : '<span style="color:var(--danger);">Reductor no encontrado</span>';
      const serialMotor = item.motorSerial ? `<span class="reparacion-card-serial">S/N ${escapeHtml(item.motorSerial)}</span>` : '';
      const serialReductor = item.reductorSerial ? `<span class="reparacion-card-serial">S/N ${escapeHtml(item.reductorSerial)}</span>` : '';
      return `🔗 Motoreductor — ⚡ ${motorTxt}${serialMotor} + ⚙️ ${reductorTxt}${serialReductor}`;
    }

    const eq = buscarEquipoCatalogo(item.equipoId);
    const nombreTxt = eq
      ? escapeHtml(nombreMostrableEquipo(eq))
      : '<span style="color:var(--danger);">Equipo no encontrado</span>';
    const serial = item.serial ? `<span class="reparacion-card-serial">S/N ${escapeHtml(item.serial)}</span>` : '';
    return `${iconoTipoDe(eq)}${nombreTxt}${serial}`;
  }

  function reparacionCoincide(reparacion) {
    if (!filtroTexto) return true;
    const compania = buscarCompania(reparacion.companiaId);
    if (compania && normalizar(compania.nombre).includes(filtroTexto)) return true;
    if (normalizar(reparacion.contacto).includes(filtroTexto)) return true;
    if (normalizar(formatearNumero(reparacion.numero)).includes(filtroTexto)) return true;
    if (textoEquipoBusqueda(reparacion).includes(filtroTexto)) return true;
    return false;
  }

  // ---------- Render de la lista (tarjetas) ----------
  // Prioridad visual: 1) equipo a reparar, 2) compañía. La fecha de
  // ingreso y la evidencia fotográfica quedan visibles pero como datos
  // secundarios; el encargado de reparaciones no se muestra acá (solo
  // sirve como referencia interna al preparar la entrega).

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
      const fechaHtml = reparacion.fechaIngreso
        ? `<span class="reparacion-card-fecha">📅 Ingreso: ${formatearFechaCorta(reparacion.fechaIngreso)}</span>`
        : '';
      const evidenciaHtml = reparacion.evidenciaFotografica
        ? `<a class="reparacion-card-evidencia" href="${escapeAttr(reparacion.evidenciaFotografica)}" target="_blank" rel="noopener noreferrer">📷 Evidencia fotográfica ↗</a>`
        : '';
      const footerHtml = (fechaHtml || evidenciaHtml)
        ? `<div class="reparacion-card-footer">${fechaHtml}${evidenciaHtml}</div>`
        : '';

      return `
        <div class="reparacion-card" data-id="${reparacion.id}">
          <div class="reparacion-card-top">
            <span class="reparacion-card-numero">${formatearNumero(reparacion.numero)}</span>
            <div class="reparacion-card-actions">
              <button type="button" class="btn-eliminar" data-id="${reparacion.id}" title="Eliminar">🗑️</button>
            </div>
          </div>
          <div class="reparacion-card-equipo">${htmlEquipoTarjeta(reparacion)}</div>
          <div class="reparacion-card-compania">🏢 ${nombreCompania}</div>
          ${footerHtml}
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
