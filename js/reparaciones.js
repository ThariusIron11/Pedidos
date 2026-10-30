// ================== Pestaña: Reparaciones ==================
// CRUD de reparaciones sobre Firestore (colección "reparaciones").
//
// Se registra QUÉ COMPAÑÍA trae el equipo a reparar, QUIÉN es el encargado
// de reparaciones de esa compañía (a diferencia de Pedidos, que usa
// "encargado de PEDIDOS", acá se usa el campo "encargado de reparaciones"
// del cliente) y el EQUIPO que ingresa.
//
// Una reparación solo puede traer UN equipo: un motor, un reductor, un
// motor ZD, un reductor ZD, o un motoreductor (motor + reductor juntos, con
// el checkbox "Es Motoreductor"; si además se marca "Es ZD" es un
// motoreductor ZD: motor ZD + reductor ZD). El "Tipo" se busca en el mismo catálogo de Equipos
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
//   pedidoId (se llena cuando esta reparación ya se convirtió en un pedido
//             de salida — ver más abajo "Enlace con Pedidos". Vale siempre
//             lo mismo que el propio ID de la reparación, porque el pedido
//             se crea con ese mismo ID),
//   devuelta (true cuando el equipo se devolvió al cliente en vez de seguir
//             el flujo normal de pedido — se marca a mano con el botón
//             "Marcar como devuelto" en la ficha. No borra ni cambia nada
//             de lo ya cargado, solo agrega esta marca. Una reparación
//             devuelta no puede tener ni generar pedido: si ya tenía uno
//             vinculado, se elimina al marcarla),
//   equipo: null, o uno de:
//     { tipoLinea: 'individual', tipoId, equipoId, serial? }
//     { tipoLinea: 'motoreductor', zd? (true = motoreductor ZD),
//       motorEquipoId, motorSerial?, reductorEquipoId, reductorSerial? }
// }
//
// Fichas de observaciones (pestaña "Observaciones" de la ficha): viven en la
// subcolección  reparaciones/{id}/observaciones , un documento por ficha:
//   { titulo, emoji, color ('gris' libre | 'azul' informe | 'violeta' información |
//             'verde' listo | 'amarillo' pendiente | 'rojo' problema),
//     contenidoHtml (mismo HTML simple de observacionesIniciales),
//     fecha ('YYYY-MM-DD', editable, sin hora), fijada (bool),
//     enlace (opcional, http/https; por ejemplo el link a la imagen o carpeta
//             del reporte. Se muestra como botón "Abrir enlace" que abre en
//             otra pestaña),
//     creadaEn (serverTimestamp, no se muestra: desempata el orden),
//     creadaPor (correo) }
// Solo puede haber UNA ficha azul (tipo Reporte) por reparación.
// Las "observaciones iniciales" de arriba NO se migran: se muestran como la
// primera ficha ("Ingreso") de esa pestaña. Al eliminar una reparación se
// borran también sus fichas (Firestore no borra subcolecciones solo).
//
// Para que la lista de reparaciones muestre de un vistazo "⚠️ Problema" (hay
// una ficha ROJA FIJADA) e "📋 Informe" (hay al menos una ficha AZUL), cada
// reparación guarda dos marcas calculadas a partir de sus fichas:
//   obsProblemaFijada (bool), obsTieneInforme (bool)
// Las mantiene al día la app cada vez que cambian las fichas (ver
// guardarMarcasReparacion); las reparaciones anteriores a este cambio se
// completan una sola vez, la primera vez que un usuario con edición las ve.
//
// Depende también de window.pedidosCache (expuesto por pedidos.js) para
// calcular el siguiente N° de pedido y confirmar que el pedido recién
// creado ya llegó por su propio listener antes de abrir su ficha; y expone
// window.abrirFichaReparacion(reparacionId) para que pedidos.js pueda abrir
// la ficha de la reparación de origen de un pedido.

(function () {
  const COLECCION = 'reparaciones';

  const listaContenedor = document.getElementById('reparaciones-cards');
  const tablaEmpty = document.getElementById('reparaciones-empty');
  const buscador = document.getElementById('buscador-reparaciones');

  const modal = document.getElementById('modal-reparacion');
  const headerNumero = document.getElementById('reparacion-header-numero');
  const form = document.getElementById('form-reparacion');

  // ---------- Ficha de reparación (solo lectura, distinta al modal de crear/editar) ----------
  // Mismo patrón visual y de flujo que la ficha de Pedidos: se abre al hacer
  // clic en una reparación existente; solo desde su botón "Editar" se pasa
  // al formulario editable de siempre (que no cambia en nada). Crear una
  // reparación nueva sigue yendo directo al formulario, sin pasar por acá.
  const modalFicha = document.getElementById('modal-ficha-reparacion');
  const fichaHeaderNumero = document.getElementById('ficha-reparacion-header-numero');
  const fichaHeaderTags = document.getElementById('ficha-reparacion-header-tags');
  const fichaSeccionDatos = document.getElementById('ficha-reparacion-seccion-datos');
  const fichaEquipoTexto = document.getElementById('ficha-reparacion-equipo-texto');
  const btnCerrarFicha = document.getElementById('btn-cerrar-ficha-reparacion');
  const btnEditarDesdeFicha = document.getElementById('btn-editar-desde-ficha-reparacion');

  // Subpestañas propias de la ficha (Datos generales / Equipos), separadas
  // de las del formulario de edición (`subtabButtons`/`subtabPanels` más
  // abajo), ya que viven en modales distintos.
  const fichaSubtabButtons = modalFicha.querySelectorAll('.subtab-btn');
  const fichaSubtabPanels = modalFicha.querySelectorAll('.subtab-panel');

  fichaSubtabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      fichaSubtabButtons.forEach(b => b.classList.toggle('active', b === btn));
      fichaSubtabPanels.forEach(p => p.classList.toggle('active', p.id === 'subtab-' + btn.dataset.subtab));
    });
  });

  function resetFichaSubtabs() {
    fichaSubtabButtons.forEach(b => b.classList.toggle('active', b.dataset.subtab === 'ficha-reparacion-datos'));
    fichaSubtabPanels.forEach(p => p.classList.toggle('active', p.id === 'subtab-ficha-reparacion-datos'));
  }

  function activarFichaSubtab(nombre) {
    fichaSubtabButtons.forEach(b => b.classList.toggle('active', b.dataset.subtab === nombre));
    fichaSubtabPanels.forEach(p => p.classList.toggle('active', p.id === 'subtab-' + nombre));
  }

  // Nombre del subtab activo de la ficha ahora mismo, para poder refrescarla
  // sin que el usuario "salte" de vuelta al primer subtab.
  function subtabFichaActiva() {
    const activo = Array.from(fichaSubtabButtons).find(b => b.classList.contains('active'));
    return activo ? activo.dataset.subtab : null;
  }

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
  const chkMotoreductorZD = document.getElementById('reparacion-motoreductor-es-zd');
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
  let filtroEstadoReparaciones = 'en_proceso'; // predeterminado, igual que en Pedidos
  let filtroTienePedido = false; // chip adicional "Con pedido", independiente del de estado
  let ordenReparaciones = ''; // '' (por número) | 'nombre_asc' | 'nombre_desc'

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

  // Tipos de catálogo que puede ser una pieza individual. Un motoreductor
  // puede entrar de DOS formas: como una sola pieza del catálogo (tipo
  // "Motoreductor" / "Motoreductor ZD", un solo serial) o armado con sus dos
  // piezas (checkbox "Es Motoreductor": motor + reductor, cada uno con su
  // serial; con "Es ZD" usa Motor ZD + Reductor ZD).
  const TIPOS_INDIVIDUALES_PERMITIDOS = ['motor', 'reductor', 'motor zd', 'reductor zd', 'motoreductor', 'motoreductor zd'];

  // Nombres (normalizados) de los tipos de catálogo que usa un motoreductor:
  // el normal usa Motor + Reductor; el ZD usa Motor ZD + Reductor ZD.
  function nombresTipoMotoreductor(zd) {
    return zd
      ? { linea: 'motoreductor zd', motor: 'motor zd', reductor: 'reductor zd' }
      : { linea: 'motoreductor', motor: 'motor', reductor: 'reductor' };
  }

  // Icono de la línea: si existe el tipo "Motoreductor ZD" en Config se usa
  // ese; si no, el de "Motoreductor".
  function tipoIdLineaMotoreductor(zd) {
    return (zd && tipoIdPorNombre('motoreductor zd')) || tipoIdPorNombre('motoreductor');
  }

  function etiquetaMotoreductor(zd) {
    return zd ? 'Motoreductor ZD' : 'Motoreductor';
  }

  function esMotoreductorZDEnFormulario() {
    return chkEsMotoreductor.checked && chkMotoreductorZD.checked;
  }

  // ---------- Sub-pestañas del modal (Datos generales / Equipos) ----------

  function resetSubtabs() {
    subtabButtons.forEach(b => b.classList.toggle('active', b.dataset.subtab === 'reparacion-datos'));
    subtabPanels.forEach(p => p.classList.toggle('active', p.id === 'subtab-reparacion-datos'));
  }
  function activarSubtab(nombre) {
    subtabButtons.forEach(b => b.classList.toggle('active', b.dataset.subtab === nombre));
    subtabPanels.forEach(p => p.classList.toggle('active', p.id === 'subtab-' + nombre));
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
    // Reparación nueva (todavía sin guardar): se muestra el número que le
    // tocaría en este momento, para que se sepa de una vez qué ID va a
    // quedar — puede cambiar si alguien más guarda una reparación primero.
    const numeroQueOcupara = formatearNumero(siguienteNumeroDisponible());
    return `${numeroQueOcupara} (nueva)${compania ? ' - ' + compania.nombre : ''}`;
  }

  // Igual que textoHeader, pero para la ficha (no depende del <select> del
  // formulario, sino directamente de los datos guardados de la reparación).
  function fichaTextoHeader(reparacion) {
    const compania = buscarCompania(reparacion.companiaId);
    return `${formatearNumero(reparacion.numero)}${compania ? ' - ' + compania.nombre : ''}`;
  }

  function campoFicha(label, valor) {
    return `
      <div class="ficha-campo">
        <div class="campo-label">${escapeHtml(label)}</div>
        <div class="campo-valor">${valor}</div>
      </div>
    `;
  }

  function renderFichaDatos(reparacion) {
    const compania = buscarCompania(reparacion.companiaId);
    const nombreCompania = compania
      ? escapeHtml(compania.nombre)
      : '<span style="color:var(--danger);">Compañía no encontrada</span>';
    const contacto = reparacion.contacto ? escapeHtml(reparacion.contacto) : '— (sin asignar)';
    const fecha = reparacion.fechaIngreso ? formatearFechaCorta(reparacion.fechaIngreso) : '—';
    const evidencia = reparacion.evidenciaFotografica
      ? `<a href="${escapeAttr(reparacion.evidenciaFotografica)}" target="_blank" rel="noopener noreferrer">📷 Ver evidencia ↗</a><button type="button" class="btn-copiar-link" data-link="${encodeURIComponent(reparacion.evidenciaFotografica)}" title="Copiar el link de la evidencia">🔗 Copiar link</button>`
      : '— (sin evidencia)';

    fichaSeccionDatos.innerHTML = `
      <h4>Datos generales</h4>
      <div class="ficha-campos">
        ${campoFicha('Compañía', nombreCompania)}
        ${campoFicha('Encargado de reparaciones', contacto)}
        ${campoFicha('Día de ingreso', fecha)}
        ${campoFicha('Evidencia fotográfica', evidencia)}
      </div>
    `;
  }

  // Pestaña "Equipos" de la ficha: mismo contenido que se ve en la tarjeta
  // (equipo + serial, vía htmlEquipoTarjeta) y las observaciones iniciales
  // ya guardadas, ambos en solo lectura — nada de esto es editable acá,
  // solo desde el botón "Editar" que lleva al formulario de siempre.
  // Si el pedido vinculado a esta reparación tiene alguna parte reemplazada
  // (ver "Reemplazar equipo" en pedidos.js), se refleja acá tal cual se ve
  // allá — mismo estilo "original → nuevo" — pero de solo lectura, ya que
  // el reemplazo se gestiona únicamente desde el pedido.
  function htmlReemplazoFichaReparacion(reparacion) {
    if (!reparacion.pedidoId) return '';
    const pedido = (window.pedidosCache || []).find(p => p.id === reparacion.pedidoId);
    const item = pedido ? (pedido.equipos || [])[0] : null;
    if (!item || !item.reemplazo) return '';

    const filaHtml = (parte, tipoNombreFijo, activoId, activoSerial) => {
      const original = item.reemplazo[parte];
      if (!original) return '';
      const viejo = buscarEquipoCatalogo(original.equipoId);
      const nuevo = buscarEquipoCatalogo(activoId);
      // Motor/Reductor siempre usan el logo de SU tipo fijo; en el caso
      // "individual" no hay un tipo fijo, así que se usa el del equipo real
      // (el nuevo si ya se eligió, si no el viejo) — ambos deberían ser del
      // mismo tipo por tratarse de un reemplazo.
      const tipoParaIcono = tipoNombreFijo
        ? (window.tiposEquipoCache || []).find(t => normalizar(t.nombre) === tipoNombreFijo)
        : (window.tiposEquipoCache || []).find(t => t.id === (nuevo || viejo)?.tipoId);
      const icono = window.iconoTipoHtml(tipoParaIcono, '📦');
      const nombreViejo = viejo ? escapeHtml(nombreMostrableEquipo(viejo)) : '<span style="color:var(--danger);">Equipo no encontrado</span>';
      const nombreNuevo = nuevo ? escapeHtml(nombreMostrableEquipo(nuevo)) : '<span style="color:var(--danger);">Equipo no encontrado</span>';
      return `
        <div class="reemplazo-fila">
          <div class="equipo-mini-card viejo">
            <div class="equipo-mini-card-header">${icono} Original</div>
            <div class="equipo-mini-card-body">
              <div class="equipo-mini-nombre">${nombreViejo}</div>
              ${original.serial ? `<div class="equipo-mini-serial">S/N ${escapeHtml(original.serial)}</div>` : ''}
            </div>
          </div>
          <div class="flecha-reemplazo">
            <svg width="30" height="16" viewBox="0 0 30 16" fill="none"><path d="M0 8H24" stroke="#6b3fa0" stroke-width="2"/><path d="M19 2L25 8L19 14" stroke="#6b3fa0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="equipo-mini-card nuevo">
            <div class="equipo-mini-card-header">${icono} Nuevo<span class="tag-reemplazado">REEMPLAZO</span></div>
            <div class="equipo-mini-card-body">
              <div class="equipo-mini-nombre">${nombreNuevo}</div>
              ${activoSerial ? `<div class="equipo-mini-serial">S/N ${escapeHtml(activoSerial)}</div>` : ''}
            </div>
          </div>
        </div>
      `;
    };

    const ntFicha = nombresTipoMotoreductor(!!reparacion.equipo?.zd);
    const filas = item.tipoLinea === 'motoreductor'
      ? filaHtml('motor', ntFicha.motor, item.motorEquipoId, (item.serialesMotor || [])[0]) + filaHtml('reductor', ntFicha.reductor, item.reductorEquipoId, (item.serialesReductor || [])[0])
      : filaHtml('individual', null, item.equipoId, (item.seriales || [])[0]);

    return filas ? `<div style="margin-top:14px;">${filas}</div>` : '';
  }

  // Botón "?" de la sugerencia de remisión. Si la reparación ya tiene pedido,
  // se usa el equipo de ese pedido, porque ahí vive el reemplazo de motor o
  // de reductor (que cambia qué guía corresponde).
  function botonGuiaReparacionHtml(reparacion) {
    if (!window.guiaRemisionDeItem || !reparacion.equipo) return '';
    const pedido = reparacion.pedidoId ? (window.pedidosCache || []).find(p => p.id === reparacion.pedidoId) : null;
    const item = (pedido && (pedido.equipos || [])[0]) || reparacion.equipo;
    const guia = window.guiaRemisionDeItem(item, { reparacion: true });
    if (!guia) return '';
    return `<button type="button" class="btn-guia-equipo" data-guia-id="${guia.id}" title="Sugerencia de remisión" aria-label="Sugerencia de remisión">?</button>`;
  }

  function renderFichaEquipos(reparacion) {
    fichaEquipoTexto.innerHTML = htmlEquipoTarjeta(reparacion) + botonGuiaReparacionHtml(reparacion) + htmlReemplazoFichaReparacion(reparacion);
  }

  function abrirFicha(reparacion, subtabInicial) {
    fichaHeaderNumero.textContent = fichaTextoHeader(reparacion);
    actualizarHeaderAcciones(reparacion);
    renderFichaDatos(reparacion);
    renderFichaEquipos(reparacion);
    if (subtabInicial) activarFichaSubtab(subtabInicial); else resetFichaSubtabs();
    btnEditarDesdeFicha.dataset.id = reparacion.id;
    suscribirObservaciones(reparacion.id);
    renderObservaciones();
    btnEditarDesdeFicha.disabled = !!reparacion.devuelta;
    btnEditarDesdeFicha.title = reparacion.devuelta ? 'Reparación devuelta: la ficha queda de solo lectura' : '';
    modalFicha.classList.add('open');
  }

  function cerrarFicha() {
    modalFicha.classList.remove('open');
    if (!modalObsRapido.classList.contains('open')) desuscribirObservaciones();
  }

  btnCerrarFicha.addEventListener('click', () => cerrarFicha());
  modalFicha.addEventListener('click', (e) => {
    if (e.target === modalFicha) cerrarFicha();
  });
  btnEditarDesdeFicha.addEventListener('click', () => {
    const reparacion = reparacionesCache.find(r => r.id === btnEditarDesdeFicha.dataset.id);
    // Mismo criterio que en Pedidos: si estaba viendo Equipos en la ficha,
    // el formulario de edición abre directo en Equipos; si estaba en Datos
    // generales, abre en Datos — igual que siempre.
    // (Las observaciones iniciales se editan también en Equipos del formulario.)
    const subtabEnFicha = subtabFichaActiva();
    const subtabDestino = (subtabEnFicha === 'ficha-reparacion-equipos' || subtabEnFicha === 'ficha-reparacion-observaciones')
      ? 'reparacion-equipos' : 'reparacion-datos';
    cerrarFicha();
    if (reparacion) abrirModalEditar(reparacion, subtabDestino);
  });


  // ---------- Fichas de observaciones ----------
  // Pestaña "Observaciones" de la ficha: tarjetas con título, fecha (solo el
  // día, editable), emoji y color. Cada una es un documento de la
  // subcolección reparaciones/{id}/observaciones, que se escucha en vivo
  // solo mientras la ficha está abierta. Una ficha larga se muestra plegada
  // (unas 3 líneas) con "Ver más"; abierta, ocupa todo el ancho.

  const SUB_OBSERVACIONES = 'observaciones';

  // Cada color significa algo: azul = informe y rojo (fijada) = problema son
  // los que se destacan en la lista de reparaciones.
  const OBS_COLORES = [
    { id: 'gris',     nombre: 'Libre' },
    { id: 'azul',     nombre: 'Informe' },
    { id: 'violeta',  nombre: 'Información' },
    { id: 'verde',    nombre: 'Listo' },
    { id: 'amarillo', nombre: 'Pendiente' },
    { id: 'rojo',     nombre: 'Problema' }
  ];
  const OBS_EMOJIS = ['🔍', '🔧', '🛠️', '⚠️', '❗', '⏳', '💰', '📞', '📦', '🔩', '⚙️', '✅', '📝'];
  // Cada plantilla trae título, emoji, color y (opcional) si nace fijada.
  // Todas salen con el contenido vacío.
  const OBS_PLANTILLAS = [
    { id: 'reporte',     nombre: 'Reporte',     titulo: 'Reporte',     emoji: '🔍', color: 'azul',     html: '' },
    { id: 'informacion', nombre: 'Información', titulo: 'Información', emoji: '❗', color: 'violeta',  html: '' },
    { id: 'pendiente',   nombre: 'Pendiente',   titulo: 'Pendiente',   emoji: '⏳', color: 'amarillo', html: '' },
    { id: 'listo',       nombre: 'Listo',       titulo: 'Listo',       emoji: '✅', color: 'verde',    html: '' },
    { id: 'problema',    nombre: 'Problema',    titulo: 'Problema',    emoji: '⚠️', color: 'rojo',     html: '', fijada: true },
    { id: 'blanco',      nombre: 'En blanco',   titulo: '',            emoji: '📝', color: 'gris',     html: '' }
  ];

  const obsContenedor = document.getElementById('ficha-reparacion-observaciones');
  const obsContador = document.getElementById('ficha-obs-contador');
  // Ventana exclusiva de observaciones (acceso rápido desde la lista): usa
  // las mismas fichas, filtros y acciones que la pestaña de la ficha.
  const modalObsRapido = document.getElementById('modal-obs-rapido');
  const obsRapidoHeader = document.getElementById('obs-rapido-header');
  const obsContenedorRapido = document.getElementById('obs-rapido-contenedor');
  const obsTabBtn = modalFicha.querySelector('[data-subtab="ficha-reparacion-observaciones"]');

  let obsReparacionId = null;   // reparación cuyas fichas se están escuchando
  let obsUnsub = null;
  let obsCache = [];
  let obsCargadas = false;
  let obsFiltro = 'todas';
  const obsAbiertas = new Set(); // fichas desplegadas con "Ver más"

  const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  // 'YYYY-MM-DD' -> '20 oct 2026'
  function formatearFechaFicha(fechaISO) {
    if (!fechaISO) return '';
    const [yyyy, mm, dd] = fechaISO.split('-');
    const mes = MESES_CORTOS[parseInt(mm, 10) - 1];
    if (!yyyy || !mes || !dd) return fechaISO;
    return `${parseInt(dd, 10)} ${mes} ${yyyy}`;
  }

  function obsColor(id) {
    return OBS_COLORES.find(c => c.id === id) || OBS_COLORES[0];
  }

  // Solo se aceptan enlaces http/https (nada de javascript: u otros esquemas).
  function enlaceSeguro(texto) {
    const t = (texto || '').trim();
    if (!t) return '';
    try {
      const u = new URL(t);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
    } catch (e) {
      return '';
    }
  }

  function suscribirObservaciones(reparacionId) {
    if (obsUnsub && obsReparacionId === reparacionId) return; // ya escuchando esta
    desuscribirObservaciones();
    obsReparacionId = reparacionId;
    obsCache = [];
    obsCargadas = false;
    obsFiltro = 'todas';
    obsAbiertas.clear();
    obsUnsub = db.collection(COLECCION).doc(reparacionId).collection(SUB_OBSERVACIONES).onSnapshot(
      (snapshot) => {
        obsCache = snapshot.docs.map(doc => {
          const datos = doc.data();
          // Mientras el servidor no confirma la hora, la ficha cuenta como la más nueva.
          const creadaMs = datos.creadaEn && datos.creadaEn.toMillis ? datos.creadaEn.toMillis() : Date.now();
          return { id: doc.id, ...datos, creadaMs };
        });
        obsCargadas = true;
        renderObservaciones();
        guardarMarcasReparacion(reparacionId, marcasDeFichas(obsCache), reparacionesCache.find(r => r.id === reparacionId));
      },
      (err) => {
        console.error('Error escuchando las fichas de observaciones:', err);
        obsCargadas = true;
        renderObservaciones();
      }
    );
  }

  // ---------- Marcas para la lista (⚠️ Problema / 📋 Informe) ----------

  function marcasDeFichas(fichas) {
    return {
      obsProblemaFijada: fichas.some(f => f.color === 'rojo' && f.fijada),
      obsTieneInforme: fichas.some(f => f.color === 'azul')
    };
  }

  const marcasEnviadas = new Map(); // id -> última combinación enviada (evita escrituras repetidas)

  // Solo escribe quien puede editar: lectura y parcial ven las marcas, no las cambian.
  async function guardarMarcasReparacion(id, marcas, reparacion) {
    if (!(window.puedeEditar && window.puedeEditar())) return;
    if (reparacion
        && reparacion.obsProblemaFijada === marcas.obsProblemaFijada
        && reparacion.obsTieneInforme === marcas.obsTieneInforme) return; // ya están al día
    const clave = `${marcas.obsProblemaFijada}|${marcas.obsTieneInforme}`;
    if (marcasEnviadas.get(id) === clave) return;
    marcasEnviadas.set(id, clave);
    try {
      await db.collection(COLECCION).doc(id).update(marcas);
    } catch (err) {
      marcasEnviadas.delete(id);
      console.error('Error actualizando las marcas de observaciones:', err);
    }
  }

  // Reparaciones de antes de este cambio no tienen las marcas: se leen sus
  // fichas una vez (una lectura por reparación) y se dejan guardadas.
  let completandoMarcas = false;
  async function completarMarcasPendientes() {
    if (completandoMarcas || !(window.puedeEditar && window.puedeEditar())) return;
    const pendientes = reparacionesCache.filter(r =>
      (typeof r.obsProblemaFijada !== 'boolean' || typeof r.obsTieneInforme !== 'boolean') && !marcasEnviadas.has(r.id));
    if (!pendientes.length) return;
    completandoMarcas = true;
    try {
      for (const r of pendientes) {
        try {
          const fichas = await db.collection(COLECCION).doc(r.id).collection(SUB_OBSERVACIONES).get();
          await guardarMarcasReparacion(r.id, marcasDeFichas(fichas.docs.map(d => d.data())), r);
        } catch (err) {
          console.error('Error revisando las fichas de una reparación:', err);
        }
      }
    } finally {
      completandoMarcas = false;
    }
  }

  function desuscribirObservaciones() {
    if (obsUnsub) obsUnsub();
    obsUnsub = null;
    obsReparacionId = null;
    obsCache = [];
    obsCargadas = false;
  }

  // La ficha "Ingreso" (observaciones iniciales) va siempre primera; luego las
  // fijadas, y dentro de cada grupo la más reciente arriba (fecha, y a igual
  // fecha, la creada después).
  function obsTarjetas(reparacion) {
    const inicial = reparacion.observacionesIniciales;
    const ingreso = {
      id: 'ingreso', esIngreso: true, titulo: 'Ingreso', emoji: '📥', color: 'gris',
      fecha: reparacion.fechaIngreso || '',
      contenidoHtml: htmlObservacionesEstaVacio(inicial) ? '' : sanearHtmlObservaciones(inicial),
      fijada: false
    };
    const resto = [...obsCache].sort((a, b) => {
      if (!!a.fijada !== !!b.fijada) return a.fijada ? -1 : 1;
      const fa = a.fecha || '', fb = b.fecha || '';
      if (fa !== fb) return fa < fb ? 1 : -1;
      return (b.creadaMs || 0) - (a.creadaMs || 0);
    });
    return [ingreso, ...resto];
  }

  function htmlTarjetaObservacion(ficha, reparacion) {
    const color = obsColor(ficha.color);
    const abierta = obsAbiertas.has(ficha.id);
    const cuerpo = ficha.contenidoHtml
      ? sanearHtmlObservaciones(ficha.contenidoHtml)
      : `<span class="obs-sin">${ficha.esIngreso ? 'Sin observaciones registradas al ingreso.' : 'Sin contenido.'}</span>`;
    const fecha = ficha.fecha ? formatearFechaFicha(ficha.fecha) : '';
    const subtitulo = ficha.esIngreso ? `${fecha ? fecha + ' · ' : ''}Observaciones iniciales` : fecha;

    let acciones;
    if (ficha.esIngreso) {
      acciones = reparacion.devuelta ? '' : '<button type="button" class="obs-accion" data-obs-accion="editar-ingreso" title="Editar las observaciones iniciales" aria-label="Editar las observaciones iniciales">✏️</button>';
    } else {
      acciones = `
        <button type="button" class="obs-accion ${ficha.fijada ? 'on' : ''}" data-obs-accion="fijar" title="${ficha.fijada ? 'Quitar de las fijadas' : 'Fijar arriba'}" aria-label="${ficha.fijada ? 'Quitar de las fijadas' : 'Fijar arriba'}">📌</button>
        <button type="button" class="obs-accion" data-obs-accion="editar" title="Editar" aria-label="Editar">✏️</button>
        <button type="button" class="obs-accion" data-obs-accion="eliminar" title="Eliminar" aria-label="Eliminar">🗑️</button>`;
    }

    return `
      <div class="obs-card obs-${color.id}${abierta ? ' abierta' : ''}" data-id="${escapeAttr(ficha.id)}">
        <div class="obs-top">
          <span class="obs-ico">${escapeHtml(ficha.emoji || '📝')}</span>
          <span class="obs-titulo">${ficha.fijada ? '<span class="obs-pin-estatico">📌 </span>' : ''}${escapeHtml(ficha.titulo || 'Sin título')}</span>
          <span class="obs-acciones">${acciones}</span>
        </div>
        <div class="obs-fecha">${subtitulo}</div>
        <div class="obs-cuerpo">${cuerpo}</div>
        ${enlaceSeguro(ficha.enlace) ? `<a class="obs-enlace" href="${escapeAttr(enlaceSeguro(ficha.enlace))}" target="_blank" rel="noopener noreferrer" data-lectura-ok title="Abrir el enlace en otra pestaña">🔗 Abrir enlace ↗</a>` : ''}
        <button type="button" class="obs-ver-mas" data-obs-accion="mas" data-lectura-ok hidden>Ver más</button>
      </div>`;
  }

  function renderObservaciones() {
    const reparacion = reparacionesCache.find(r => r.id === obsReparacionId);
    if (!reparacion) return;

    const todas = obsTarjetas(reparacion);
    const hayIngreso = !!todas[0].contenidoHtml;
    obsContador.textContent = obsCache.length + (hayIngreso ? 1 : 0);

    // Chips de color: solo los colores que realmente se usan.
    const usados = OBS_COLORES.filter(c => todas.some(f => f.color === c.id));
    if (obsFiltro !== 'todas' && !usados.some(c => c.id === obsFiltro)) obsFiltro = 'todas';
    const chips = usados.length > 1
      ? `<button type="button" class="obs-chip ${obsFiltro === 'todas' ? 'active' : ''}" data-obs-filtro="todas" data-lectura-ok>Todas</button>` +
        usados.map(c => `<button type="button" class="obs-chip obs-${c.id} ${obsFiltro === c.id ? 'active' : ''}" data-obs-filtro="${c.id}" data-lectura-ok><span class="obs-punto"></span>${c.nombre}</button>`).join('')
      : '';

    const visibles = obsFiltro === 'todas' ? todas : todas.filter(f => f.color === obsFiltro);
    let tarjetasHtml = visibles.map(f => htmlTarjetaObservacion(f, reparacion)).join('');
    if (!obsCargadas) {
      tarjetasHtml += '<div class="obs-vacio">Cargando fichas…</div>';
    } else if (!obsCache.length && obsFiltro === 'todas') {
      tarjetasHtml += '<div class="obs-vacio">Todavía no hay fichas. Crea la primera con «Nueva ficha».</div>';
    }

    const htmlObs = `
      <div class="obs-barra">
        ${chips}
        <span class="obs-espacio"></span>
        <button type="button" class="btn" data-obs-accion="nueva">+ Nueva ficha</button>
      </div>
      <div class="obs-grid">${tarjetasHtml}</div>`;
    obsContenedor.innerHTML = htmlObs;
    obsContenedorRapido.innerHTML = htmlObs;

    requestAnimationFrame(ajustarPlegadoObservaciones);
  }

  // Muestra "Ver más" solo en las fichas cuyo texto no cabe en las 3 líneas.
  // Hay que medir con la pestaña visible; por eso también se llama al abrirla.
  function ajustarPlegadoObservaciones() {
    [obsContenedor, obsContenedorRapido].forEach(c => c.querySelectorAll('.obs-card').forEach(card => {
      const cuerpo = card.querySelector('.obs-cuerpo');
      const boton = card.querySelector('.obs-ver-mas');
      if (!cuerpo || !boton) return;
      if (card.classList.contains('abierta')) {
        boton.hidden = false;
        boton.textContent = 'Ver menos';
        return;
      }
      boton.hidden = !(cuerpo.scrollHeight > cuerpo.clientHeight + 2);
      boton.textContent = 'Ver más';
    }));
  }

  obsTabBtn.addEventListener('click', () => requestAnimationFrame(ajustarPlegadoObservaciones));

  async function manejarClickObservaciones(e) {
    const chip = e.target.closest('[data-obs-filtro]');
    if (chip) {
      obsFiltro = chip.dataset.obsFiltro;
      renderObservaciones();
      return;
    }
    const boton = e.target.closest('[data-obs-accion]');
    if (!boton) return;
    const card = boton.closest('.obs-card');
    const id = card ? card.dataset.id : null;
    const ficha = id ? obsCache.find(f => f.id === id) : null;
    const coleccionObs = () => db.collection(COLECCION).doc(obsReparacionId).collection(SUB_OBSERVACIONES);

    switch (boton.dataset.obsAccion) {
      case 'nueva':
        abrirModalObservacion(null);
        break;
      case 'editar':
        if (ficha) abrirModalObservacion(ficha);
        break;
      case 'editar-ingreso': {
        // Desde la ventana rápida no hay ficha abierta: se pasa directo al
        // formulario de edición (Equipos, donde viven las observaciones iniciales).
        if (modalObsRapido.classList.contains('open')) {
          const rep = reparacionesCache.find(r => r.id === obsReparacionId);
          cerrarObsRapido();
          // Si la ventana se abrió desde la ficha de un pedido, esa ficha se
          // cierra para que el formulario de edición no quede detrás.
          const fichaPedido = document.getElementById('modal-ficha-pedido');
          if (fichaPedido && fichaPedido.classList.contains('open')) {
            const cerrarPedido = document.getElementById('btn-cerrar-ficha-pedido');
            if (cerrarPedido) cerrarPedido.click();
          }
          if (rep) abrirModalEditar(rep, 'reparacion-equipos');
        } else {
          btnEditarDesdeFicha.click();
        }
        break;
      }
      case 'mas': {
        const abre = !card.classList.contains('abierta');
        card.classList.toggle('abierta', abre);
        if (abre) obsAbiertas.add(id); else obsAbiertas.delete(id);
        ajustarPlegadoObservaciones();
        break;
      }
      case 'fijar':
        if (!ficha) break;
        try {
          await coleccionObs().doc(id).update({ fijada: !ficha.fijada });
        } catch (err) {
          console.error('Error fijando la ficha:', err);
          alert('No se pudo fijar la ficha. Revisa la consola.');
        }
        break;
      case 'eliminar':
        if (!ficha) break;
        if (!confirm(`¿Eliminar la ficha "${ficha.titulo || 'Sin título'}"? Esta acción no se puede deshacer.`)) break;
        try {
          await coleccionObs().doc(id).delete();
          obsAbiertas.delete(id);
        } catch (err) {
          console.error('Error eliminando la ficha:', err);
          alert('No se pudo eliminar la ficha. Revisa la consola.');
        }
        break;
    }
  }
  obsContenedor.addEventListener('click', manejarClickObservaciones);
  obsContenedorRapido.addEventListener('click', manejarClickObservaciones);

  // ---------- Ventana exclusiva de observaciones (acceso rápido) ----------

  function abrirObsRapido(reparacion) {
    suscribirObservaciones(reparacion.id);
    obsRapidoHeader.textContent = '📝 Observaciones · ' + fichaTextoHeader(reparacion);
    renderObservaciones();
    modalObsRapido.classList.add('open');
    requestAnimationFrame(ajustarPlegadoObservaciones);
  }

  function cerrarObsRapido() {
    modalObsRapido.classList.remove('open');
    if (!modalFicha.classList.contains('open')) desuscribirObservaciones();
  }

  // Permite abrir esta ventana desde otro archivo — ej. el 📄 de un equipo
  // de reparación en pedidos.js. Si la lista de reparaciones aún no se ha
  // cargado (no se ha entrado a esa pestaña), se inicia la escucha y se abre
  // en cuanto llega la reparación.
  window.abrirObservacionesReparacion = function (reparacionId) {
    const buscar = () => reparacionesCache.find(r => r.id === reparacionId);
    const ya = buscar();
    if (ya) { abrirObsRapido(ya); return; }
    iniciarSuscripcion();
    const alLlegar = () => {
      const r = buscar();
      if (!r) return;
      document.removeEventListener('reparaciones:cambio', alLlegar);
      clearTimeout(temporizador);
      abrirObsRapido(r);
    };
    const temporizador = setTimeout(() => document.removeEventListener('reparaciones:cambio', alLlegar), 8000);
    document.addEventListener('reparaciones:cambio', alLlegar);
  };

  document.getElementById('btn-cerrar-obs-rapido').addEventListener('click', cerrarObsRapido);
  modalObsRapido.addEventListener('click', (e) => {
    if (e.target === modalObsRapido) cerrarObsRapido();
  });

  // ---------- Modal: crear / editar una ficha ----------

  const modalObs = document.getElementById('modal-obs-ficha');
  const modalObsTitulo = document.getElementById('modal-obs-ficha-titulo');
  const formObs = document.getElementById('form-obs-ficha');
  const obsInputId = document.getElementById('obs-ficha-id');
  const obsInputTitulo = document.getElementById('obs-ficha-titulo');
  const obsInputFecha = document.getElementById('obs-ficha-fecha');
  const obsInputEnlace = document.getElementById('obs-ficha-enlace');
  const obsInputEmojiOtro = document.getElementById('obs-ficha-emoji-otro');
  const obsEditor = document.getElementById('obs-ficha-contenido');
  const obsPlantillasGrupo = document.getElementById('obs-ficha-plantillas-grupo');
  const obsPlantillasEl = document.getElementById('obs-ficha-plantillas');
  const obsEmojisEl = document.getElementById('obs-ficha-emojis');
  const obsColoresEl = document.getElementById('obs-ficha-colores');
  const btnGuardarObs = document.getElementById('btn-guardar-obs-ficha');

  let obsEmojiSel = '📝';
  let obsColorSel = 'gris';
  let obsPlantillaSel = 'blanco';
  let obsFijadaSel = false;       // solo se usa al crear (las plantillas como Problema nacen fijadas)
  let obsColorOriginal = '';      // color de la ficha que se está editando ('' si es nueva)

  // Solo una ficha azul (Reporte) por reparación. Se bloquea si ya hay otra
  // azul, salvo que la que se edita ya era azul (así se puede seguir editando).
  function azulBloqueado() {
    const otraAzul = obsCache.some(f => f.color === 'azul' && f.id !== obsInputId.value);
    return otraAzul && obsColorOriginal !== 'azul';
  }

  function renderOpcionesObservacion() {
    const bloqueaAzul = azulBloqueado();
    obsPlantillasEl.innerHTML = OBS_PLANTILLAS.map(p => {
      const bloqueada = bloqueaAzul && p.color === 'azul';
      return `<button type="button" class="obs-op ${obsPlantillaSel === p.id ? 'on' : ''}" data-plantilla="${p.id}"${bloqueada ? ' disabled title="Ya existe un reporte en esta reparación"' : ''}>${p.emoji} ${p.nombre}</button>`;
    }).join('');
    obsEmojisEl.innerHTML = OBS_EMOJIS.map(em =>
      `<button type="button" class="obs-op emoji ${obsEmojiSel === em ? 'on' : ''}" data-emoji="${em}">${em}</button>`).join('');
    obsColoresEl.innerHTML = OBS_COLORES.map(c => {
      const bloqueado = bloqueaAzul && c.id === 'azul';
      return `<button type="button" class="obs-color-btn obs-${c.id} ${obsColorSel === c.id ? 'on' : ''}" data-color="${c.id}" title="${bloqueado ? 'Ya existe un reporte en esta reparación' : c.nombre}" aria-label="${c.nombre}"${bloqueado ? ' disabled' : ''}></button>`;
    }).join('');
  }

  // Primer emoji de lo que se escriba o pegue en "Otro" (ignora letras).
  function primerEmoji(texto) {
    const limpio = (texto || '').trim();
    if (!limpio) return '';
    const trozos = (window.Intl && Intl.Segmenter)
      ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(limpio), x => x.segment)
      : Array.from(limpio);
    return trozos.find(t => /\p{Extended_Pictographic}/u.test(t)) || '';
  }

  obsInputEmojiOtro.addEventListener('input', () => {
    const emoji = primerEmoji(obsInputEmojiOtro.value);
    obsInputEmojiOtro.value = emoji;
    if (emoji) {
      obsEmojiSel = emoji;
      renderOpcionesObservacion();
    }
  });

  function aplicarPlantillaObservacion(id) {
    const nueva = OBS_PLANTILLAS.find(p => p.id === id);
    if (!nueva) return;
    if (azulBloqueado() && nueva.color === 'azul') return;
    const previa = OBS_PLANTILLAS.find(p => p.id === obsPlantillaSel);
    const tituloActual = obsInputTitulo.value.trim();
    const htmlActual = sanearHtmlObservaciones(obsEditor.innerHTML);

    // No se pisa lo que la persona ya escribió: solo se reemplaza si está
    // vacío o si sigue siendo exactamente lo que puso la plantilla anterior.
    if (!tituloActual || (previa && tituloActual === previa.titulo)) obsInputTitulo.value = nueva.titulo;
    if (htmlObservacionesEstaVacio(htmlActual) || (previa && htmlActual === sanearHtmlObservaciones(previa.html))) {
      obsEditor.innerHTML = nueva.html;
    }
    obsPlantillaSel = id;
    obsEmojiSel = nueva.emoji;
    obsColorSel = nueva.color;
    obsFijadaSel = !!nueva.fijada;
    obsInputEmojiOtro.value = '';
    renderOpcionesObservacion();
    obsInputTitulo.focus();
  }

  modalObs.addEventListener('click', (e) => {
    if (e.target === modalObs) { cerrarModalObservacion(); return; }
    const plantilla = e.target.closest('[data-plantilla]');
    if (plantilla) { aplicarPlantillaObservacion(plantilla.dataset.plantilla); return; }
    const emoji = e.target.closest('[data-emoji]');
    if (emoji) { obsEmojiSel = emoji.dataset.emoji; obsInputEmojiOtro.value = ''; renderOpcionesObservacion(); return; }
    const color = e.target.closest('[data-color]');
    if (color) { obsColorSel = color.dataset.color; renderOpcionesObservacion(); }
  });

  document.querySelectorAll('#obs-ficha-toolbar .rte-btn').forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      document.execCommand(btn.dataset.cmd, false, null);
      obsEditor.focus();
    });
  });

  function abrirModalObservacion(ficha) {
    formObs.reset();
    obsInputEmojiOtro.value = '';
    if (ficha) {
      modalObsTitulo.textContent = 'Editar ficha';
      obsInputId.value = ficha.id;
      obsInputTitulo.value = ficha.titulo || '';
      obsInputFecha.value = ficha.fecha || fechaHoyISO();
      obsEmojiSel = ficha.emoji || '📝';
      obsColorSel = obsColor(ficha.color).id;
      obsColorOriginal = obsColorSel;
      obsFijadaSel = false;
      obsInputEnlace.value = ficha.enlace || '';
      obsPlantillaSel = '';
      obsEditor.innerHTML = sanearHtmlObservaciones(ficha.contenidoHtml || '');
      obsPlantillasGrupo.style.display = 'none'; // las plantillas son solo para fichas nuevas
    } else {
      modalObsTitulo.textContent = 'Nueva ficha';
      obsInputId.value = '';
      obsInputFecha.value = fechaHoyISO();
      obsPlantillaSel = 'blanco';
      obsEmojiSel = '📝';
      obsColorSel = 'gris';
      obsColorOriginal = '';
      obsFijadaSel = false;
      obsInputEnlace.value = '';
      obsEditor.innerHTML = '';
      obsPlantillasGrupo.style.display = '';
    }
    renderOpcionesObservacion();
    modalObs.classList.add('open');
    obsInputTitulo.focus();
  }

  function cerrarModalObservacion() {
    modalObs.classList.remove('open');
  }

  document.getElementById('btn-cancelar-obs-ficha').addEventListener('click', cerrarModalObservacion);

  formObs.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!obsReparacionId) return;
    const html = sanearHtmlObservaciones(obsEditor.innerHTML);
    const datos = {
      titulo: obsInputTitulo.value.trim(),
      emoji: obsEmojiSel || '📝',
      color: obsColorSel,
      contenidoHtml: htmlObservacionesEstaVacio(html) ? '' : html,
      fecha: obsInputFecha.value || fechaHoyISO()
    };
    if (!datos.titulo) { obsInputTitulo.focus(); return; }

    const enlaceTexto = obsInputEnlace.value.trim();
    if (enlaceTexto) {
      const enlaceOk = enlaceSeguro(enlaceTexto) || enlaceSeguro('https://' + enlaceTexto);
      if (!enlaceOk) {
        alert('El enlace no es válido. Debe empezar por http:// o https://');
        obsInputEnlace.focus();
        return;
      }
      datos.enlace = enlaceOk;
    } else {
      datos.enlace = '';
    }

    if (datos.color === 'azul' && azulBloqueado()) {
      alert('Esta reparación ya tiene un reporte. Solo puede haber uno.');
      return;
    }

    btnGuardarObs.disabled = true;
    try {
      const coleccionObs = db.collection(COLECCION).doc(obsReparacionId).collection(SUB_OBSERVACIONES);
      if (obsInputId.value) {
        await coleccionObs.doc(obsInputId.value).update(datos);
      } else {
        const usuario = firebase.auth().currentUser;
        await coleccionObs.add({
          ...datos,
          fijada: obsFijadaSel,
          creadaEn: firebase.firestore.FieldValue.serverTimestamp(),
          creadaPor: usuario ? usuario.email : null
        });
      }
      cerrarModalObservacion();
    } catch (err) {
      console.error('Error guardando la ficha:', err);
      alert('No se pudo guardar la ficha. Revisa la consola.');
    } finally {
      btnGuardarObs.disabled = false;
    }
  });

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

  // ---------- Buscador de compañía (texto + sugerencias) ----------
  // selectCompania sigue siendo el input[hidden] que guarda el id elegido
  // (así el resto del archivo, que ya lee/escribe selectCompania.value, no
  // necesita tocarse) — inputCompaniaTexto es el campo visible donde se
  // escribe y aparecen las sugerencias.

  const inputCompaniaTexto = document.getElementById('reparacion-compania-input');
  const resultadosCompania = document.getElementById('reparacion-compania-resultados');

  // Encargados de reparaciones de una compañía (las antiguas solo tenían un
  // nombre en contactoReparaciones).
  function contactosReparacionesDeCliente(compania) {
    if (Array.isArray(compania?.contactosReparaciones)) return compania.contactosReparaciones.filter(Boolean);
    return compania?.contactoReparaciones ? [compania.contactoReparaciones] : [];
  }

  // Llena la lista desplegable del encargado con los de la compañía. Si la
  // reparación ya tenía uno que ya no está en la lista (o es un texto libre
  // de antes), se conserva como opción para no perderlo. Con un solo
  // encargado en la lista, se elige solo.
  function poblarContactosReparacion(compania, valorActual) {
    const lista = contactosReparacionesDeCliente(compania);
    const actual = (valorActual || '').trim();
    const opciones = lista.slice();
    if (actual && !opciones.some(n => normalizar(n) === normalizar(actual))) opciones.push(actual);
    const textoVacio = !compania
      ? 'Primero elige la compañía...'
      : (opciones.length ? 'Selecciona un encargado...' : 'Sin encargados registrados para esta compañía');
    inputContacto.innerHTML = `<option value="">${escapeHtml(textoVacio)}</option>` +
      opciones.map(n => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join('');
    if (actual) inputContacto.value = opciones.find(n => normalizar(n) === normalizar(actual));
    else if (lista.length === 1) inputContacto.value = lista[0];
    else inputContacto.value = '';
  }

  function alCambiarCompania() {
    const compania = buscarCompania(selectCompania.value);
    poblarContactosReparacion(compania, '');
    headerNumero.textContent = textoHeader(inputId.value ? { numero: inputNumero.value } : null);
  }

  function mostrarResultadosCompania() {
    const t = normalizar(inputCompaniaTexto.value);
    const clientes = window.clientesCache || [];
    const coincidencias = (t ? clientes.filter(c => normalizar(c.nombre).includes(t)) : clientes).slice(0, 8);
    resultadosCompania.innerHTML = coincidencias.length
      ? coincidencias.map(c => `<div class="buscador-item" data-id="${c.id}">${escapeHtml(c.nombre)}</div>`).join('')
      : `<div class="buscador-item-vacio">Sin coincidencias</div>`;
    resultadosCompania.classList.add('open');
    resultadosCompania.querySelectorAll('.buscador-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault(); // evita que el blur del input cierre la lista antes del click
        const c = (window.clientesCache || []).find(x => x.id === el.dataset.id);
        if (c) seleccionarCompania(c);
      });
    });
  }

  function seleccionarCompania(c) {
    selectCompania.value = c.id;
    inputCompaniaTexto.value = c.nombre;
    resultadosCompania.classList.remove('open');
    alCambiarCompania();
  }

  // Pone en el campo visible el nombre que corresponde al id ya guardado en
  // selectCompania.value — se usa al cargar una reparación existente, o si
  // cambia el nombre de la compañía desde la pestaña Clientes.
  function sincronizarTextoCompaniaDesdeId() {
    const compania = buscarCompania(selectCompania.value);
    inputCompaniaTexto.value = compania ? compania.nombre : '';
  }

  inputCompaniaTexto.addEventListener('input', () => {
    selectCompania.value = ''; // hasta que elija algo de la lista, no hay selección válida
    mostrarResultadosCompania();
    alCambiarCompania();
  });
  // 'click' (no 'focus'): si fuera 'focus', el enfoque automático que hace
  // abrirModalNuevo() al abrir el formulario también dispararía esto, y la
  // lista se abriría sola sin que el usuario haya hecho nada todavía.
  inputCompaniaTexto.addEventListener('click', mostrarResultadosCompania);
  inputCompaniaTexto.addEventListener('blur', () => {
    setTimeout(() => resultadosCompania.classList.remove('open'), 120);
  });

  document.addEventListener('clientes:cambio', () => {
    sincronizarTextoCompaniaDesdeId();
    renderLista(); // los nombres de compañía en las tarjetas pueden haber cambiado
  });

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
    const tipos = (window.tiposEquipoCache || []).filter(t => TIPOS_INDIVIDUALES_PERMITIDOS.includes(normalizar(t.nombre)));
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

  // IDs de tipo permitidos (motor, reductor, motor zd, reductor zd, motoreductor, motoreductor zd) — usado tanto para
  // poblar el select "Tipo..." como para que el buscador de equipo, cuando
  // todavía no se ha elegido un tipo, no muestre TODO el catálogo (acoples,
  // cadenas, etc.) sino solo estos seis.
  function tipoIdsPermitidos() {
    return new Set(
      (window.tiposEquipoCache || [])
        .filter(t => TIPOS_INDIVIDUALES_PERMITIDOS.includes(normalizar(t.nombre)))
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
  // solo muestra motor/reductor/motoreductor y sus versiones ZD. Se usa en el buscador individual,
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
    obtenerTipoId: () => tipoIdPorNombre(nombresTipoMotoreductor(esMotoreductorZDEnFormulario()).motor),
    onSeleccion: (eq) => mostrarOcultarSerial(serialWrapMotor, inputSerialMotor, eq)
  });

  inicializarBuscadorEquipoReparacion({
    inputTexto: inputReductorTexto,
    inputValor: inputReductorId,
    avisoEl: avisoReductorNuevo,
    obtenerTipoId: () => tipoIdPorNombre(nombresTipoMotoreductor(esMotoreductorZDEnFormulario()).reductor),
    onSeleccion: (eq) => mostrarOcultarSerial(serialWrapReductor, inputSerialReductor, eq)
  });

  // Al alternar "Es ZD", motor y reductor cambian de tipo de catálogo: lo ya
  // elegido era del otro tipo, así que se limpia y los buscadores se refiltran
  // solos al escribir (mismo criterio que al cambiar el "Tipo" en el equipo individual).
  chkMotoreductorZD.addEventListener('change', () => {
    inputMotorId.value = '';
    inputMotorTexto.value = '';
    avisoMotorNuevo.style.display = 'none';
    mostrarOcultarSerial(serialWrapMotor, inputSerialMotor, false);
    inputReductorId.value = '';
    inputReductorTexto.value = '';
    avisoReductorNuevo.style.display = 'none';
    mostrarOcultarSerial(serialWrapReductor, inputSerialReductor, false);
    actualizarTextoEquipo();
  });

  // Icono del tipo de equipo según su tipoId (para la vista de texto, antes
  // de que el equipo exista como objeto del catálogo resuelto).
  function iconoDeTipoId(tipoId) {
    const tipo = (window.tiposEquipoCache || []).find(t => t.id === tipoId);
    return window.iconoTipoHtml(tipo);
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
      const zd = esMotoreductorZDEnFormulario();
      const nt = nombresTipoMotoreductor(zd);
      return `${iconoDeTipoId(tipoIdLineaMotoreductor(zd))} ${etiquetaMotoreductor(zd)} — ${iconoDeTipoId(tipoIdPorNombre(nt.motor))} ${motorHtml}${serialMotor} + ${iconoDeTipoId(tipoIdPorNombre(nt.reductor))} ${reductorHtml}${serialReductor}`;
    }

    const texto = inputEquipoTexto.value.trim();
    if (!texto) return '';
    const nuevoTag = inputEquipoId.value ? '' : ' <span class="tag-nuevo-equipo">(nuevo)</span>';
    const serial = inputSerialIndividual.value.trim() ? `<span class="reparacion-card-serial">S/N ${escapeHtml(inputSerialIndividual.value.trim())}</span>` : '';
    const icono = iconoDeTipoId(selectTipoFiltro.value);
    return `${icono ? icono + ' ' : ''}${escapeHtml(texto)}${nuevoTag}${serial}`;
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
    chkMotoreductorZD.checked = false;
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
      chkMotoreductorZD.checked = !!equipo.zd;
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

    // La mayoría de motores y reductores sí traen serial de fábrica, así que
    // un equipo nuevo de esos dos tipos se crea con esa opción ya activada
    // (se puede desactivar después en la pestaña Equipos si ese modelo en
    // particular no aplica). Excepción: los motores ZD casi nunca tienen
    // serial — para esos se deja desactivada por defecto, pero la opción
    // sigue disponible por si alguno sí llega a tenerlo.
    const tipo = (window.tiposEquipoCache || []).find(t => t.id === tipoId);
    const nombreTipoNorm = tipo ? normalizar(tipo.nombre) : '';
    const esMotorOReductor = nombreTipoNorm === 'motor' || nombreTipoNorm === 'reductor' || nombreTipoNorm === 'motoreductor';
    const esMotorZD = nombreTipoNorm === 'motor' && normalizar(texto).includes('zd');
    const usaSerialPorDefecto = esMotorOReductor && !esMotorZD;

    const nuevo = await db.collection('equipos').add({
      nombre: texto,
      tipoId: tipoId || '',
      variante: 'Reparación',
      peso: null,
      usaSerial: usaSerialPorDefecto,
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

      const zd = esMotoreductorZDEnFormulario();
      const nt = nombresTipoMotoreductor(zd);
      const motorEquipoId = await resolverEquipoId(motorTexto, inputMotorId.value, tipoIdPorNombre(nt.motor));
      const reductorEquipoId = await resolverEquipoId(reductorTexto, inputReductorId.value, tipoIdPorNombre(nt.reductor));
      const motorSerial = inputSerialMotor.value.trim();
      const reductorSerial = inputSerialReductor.value.trim();
      return {
        equipo: {
          tipoLinea: 'motoreductor',
          ...(zd ? { zd: true } : {}),
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
    selectCompania.value = reparacion?.companiaId || '';
    sincronizarTextoCompaniaDesdeId();
    // En una reparación nueva la lista se llena al elegir la compañía.
    poblarContactosReparacion(reparacion ? buscarCompania(reparacion.companiaId) : null, reparacion?.contacto || '');
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
      inputCompaniaTexto.focus();
      return;
    }
    cargarFormularioDesdeReparacion(null);
    borradorId = '';
    modal.classList.add('open');
    inputCompaniaTexto.focus();
  }

  function abrirModalEditar(reparacion, subtabInicial) {
    if (borradorId === reparacion.id) {
      headerNumero.textContent = textoHeader(reparacion);
      if (subtabInicial) activarSubtab(subtabInicial);
      modal.classList.add('open');
      return;
    }
    cargarFormularioDesdeReparacion(reparacion);
    if (subtabInicial) activarSubtab(subtabInicial);
    borradorId = reparacion.id;
    modal.classList.add('open');
  }

  function cerrarModalConservandoBorrador() {
    // Clic por fuera: solo oculta, no toca los datos digitados.
    modal.classList.remove('open');
  }

  // ---------- Enlace con Pedidos: "Crear pedido" / "Ver pedido" ----------
  // Cuando una reparación ya está encaminada, se convierte en un pedido de
  // salida con el MISMO ID que la reparación (así quedan enlazados 1 a 1
  // sin tener que mantener referencias cruzadas para poder encontrarlos:
  // basta con buscar ese mismo ID en la otra colección). Se copia el
  // cliente, el encargado de recibirlo y el equipo ya cargado; lo demás
  // (cantidad, orden de compra, etc.) se termina de ajustar en Pedidos.
  // Vive en el header de la FICHA (solo lectura), no en el del formulario
  // de edición.
  const headerAcciones = fichaHeaderTags;

  // Una reparación queda "completada" cuando el pedido que generó (mismo ID)
  // ya está totalmente despachado — se consulta window.pedidosCache /
  // window.pedidoEstaCompletado, expuestos por pedidos.js. Se ve reflejado
  // acá, en la tarjeta del listado (fondo naranja bajo + etiqueta) y en el
  // header de la propia ficha.
  function reparacionEstaCompletada(reparacion) {
    if (!reparacion.pedidoId || !window.pedidoEstaCompletado) return false;
    const pedido = (window.pedidosCache || []).find(p => p.id === reparacion.pedidoId);
    return pedido ? window.pedidoEstaCompletado(pedido) : false;
  }

  function actualizarHeaderAcciones(reparacion) {
    if (!reparacion) {
      headerAcciones.innerHTML = ''; // reparación nueva, todavía sin guardar
      return;
    }
    const tagCompletado = reparacionEstaCompletada(reparacion) ? '<span class="tag-pedido-completado">COMPLETADO</span>' : '';

    // Una reparación devuelta ya no puede tener ni generar pedido — no se
    // ofrece "Crear pedido" ni "Ver pedido" acá, solo la etiqueta.
    if (reparacion.devuelta) {
      headerAcciones.innerHTML = '<span class="tag-pedido-devolucion">DEVOLUCIÓN</span>';
      return;
    }

    const btnDevolucion = '<button type="button" class="btn-pill-header" id="btn-marcar-devuelto-reparacion">↩️ Marcar como devuelto</button>';
    if (reparacion.pedidoId) {
      headerAcciones.innerHTML = tagCompletado + `<button type="button" class="btn-pill-header" id="btn-ver-pedido-desde-reparacion">🧾 Ver pedido ↗</button>` + btnDevolucion;
      document.getElementById('btn-ver-pedido-desde-reparacion').addEventListener('click', () => {
        if (!window.abrirFichaPedido) {
          alert('No se pudo abrir el pedido: la pestaña de Pedidos no está cargada en esta página.');
          return;
        }
        cerrarFicha();
        window.abrirFichaPedido(reparacion.pedidoId);
      });
    } else {
      headerAcciones.innerHTML = `<button type="button" class="btn-pill-header" id="btn-crear-pedido-desde-reparacion">🧾 Crear pedido</button>` + btnDevolucion;
      document.getElementById('btn-crear-pedido-desde-reparacion').addEventListener('click', () => crearPedidoDesdeReparacion(reparacion));
    }
    document.getElementById('btn-marcar-devuelto-reparacion').addEventListener('click', () => marcarComoDevuelto(reparacion));
  }

  // Marca la reparación como devuelta al cliente: se conservan todos sus
  // datos (diagnóstico, evidencia, equipo, etc.) tal cual están, solo se
  // agrega la marca "devuelta". Por ahora una reparación devuelta no puede
  // tener pedido — si ya tenía uno vinculado, se elimina (respetando la
  // misma regla de "no borrar si ya hay algo despachado" que usa Eliminar).
  async function marcarComoDevuelto(reparacion) {
    if (reparacion.pedidoId && window.pedidoTieneAlgoDespachado) {
      const pedidoVinculado = (window.pedidosCache || []).find(p => p.id === reparacion.pedidoId);
      if (pedidoVinculado && window.pedidoTieneAlgoDespachado(pedidoVinculado)) {
        alert('No se puede marcar como devuelta: el pedido vinculado ya tiene equipos despachados en un envío.');
        return;
      }
    }

    const mensaje = reparacion.pedidoId
      ? '¿Marcar esta reparación como devuelta al cliente? Se conservan todos sus datos. Ya no podrá generar un pedido — el pedido vinculado (mismo N°) se eliminará.'
      : '¿Marcar esta reparación como devuelta al cliente? Se conservan todos sus datos, pero ya no podrá generar un pedido.';
    const ok = confirm(mensaje);
    if (!ok) return;

    try {
      const datos = { devuelta: true };
      if (reparacion.pedidoId) {
        const resultado = window.eliminarPedidoDesdeReparacion
          ? await window.eliminarPedidoDesdeReparacion(reparacion.pedidoId)
          : await db.collection('pedidos').doc(reparacion.pedidoId).delete().then(() => ({ ok: true }));
        if (!resultado.ok) {
          alert('No se pudo eliminar el pedido vinculado. La reparación no se marcó como devuelta.');
          return;
        }
        datos.pedidoId = firebase.firestore.FieldValue.delete();
      }
      await db.collection(COLECCION).doc(reparacion.id).update(datos);
    } catch (err) {
      console.error('Error marcando la reparación como devuelta:', err);
      alert('No se pudo marcar la reparación como devuelta. Revisa la consola.');
    }
  }

  // Traduce el equipo cargado en esta reparación al formato que espera el
  // arreglo `equipos` de un pedido (un solo ítem, cantidad 1). Si el equipo
  // tenía serial capturado al ingresar, se precarga también.
  function equipoReparacionAItemPedido(equipo) {
    if (!equipo) return null;
    if (equipo.tipoLinea === 'motoreductor') {
      if (!equipo.motorEquipoId || !equipo.reductorEquipoId) return null;
      const item = {
        tipoLinea: 'motoreductor',
        motorEquipoId: equipo.motorEquipoId,
        reductorEquipoId: equipo.reductorEquipoId,
        cantidad: 1,
        ordenCompra: '',
        llevaBrazo: false,
        llevaEje: false,
        llevaFlanche: false,
        unidadesPreparadas: []
      };
      if (equipo.motorSerial) item.serialesMotor = [equipo.motorSerial];
      if (equipo.reductorSerial) item.serialesReductor = [equipo.reductorSerial];
      return item;
    }
    if (!equipo.equipoId) return null;
    const item = {
      tipoLinea: 'individual',
      equipoId: equipo.equipoId,
      cantidad: 1,
      ordenCompra: '',
      llevaBrazo: false,
      llevaEje: false,
      llevaFlanche: false,
      unidadesPreparadas: []
    };
    if (equipo.serial) item.seriales = [equipo.serial];
    return item;
  }

  // El "encargado" de la reparación es texto libre, mientras que Pedidos
  // elige el contacto de una lista fija (contactosPedidos de la compañía).
  // Si el texto coincide con alguno de esa lista (sin importar mayúsculas),
  // se usa tal cual está ahí para que el select de Pedidos lo reconozca; si
  // no coincide con ninguno, igual se guarda el texto escrito.
  function contactoParaPedido(companiaId, contactoReparacion) {
    if (!contactoReparacion) return '';
    const compania = buscarCompania(companiaId);
    const opciones = compania?.contactosPedidos || [];
    const match = opciones.find(nombre => normalizar(nombre) === normalizar(contactoReparacion));
    return match || contactoReparacion;
  }

  // Si esta reparación ya tiene un pedido vinculado (mismo ID en ambas
  // colecciones), sus datos de "de dónde viene" (compañía, contacto, qué
  // equipo es, y el serial con el que ingresó) no se editan desde Pedidos —
  // vienen de acá. Cada vez que se guarda la reparación, se empujan esos
  // mismos datos al pedido. Solo se toca la identidad del equipo (tipoLinea
  // + equipoId, o motor/reductor) y el serial de la UNIDAD 0 (la única que
  // trae la reparación); si desde Pedidos se subió la cantidad a más de 1,
  // las unidades adicionales y el resto del ítem (orden de compra, brazo/eje,
  // unidades preparadas) se dejan tal cual estaban.
  async function sincronizarPedidoDesdeReparacion(reparacionId, companiaId, contacto, equipo, evidenciaFotografica) {
    const refPedido = db.collection('pedidos').doc(reparacionId);
    const snap = await refPedido.get();
    if (!snap.exists) return;

    const pedido = snap.data();
    const datos = {
      companiaId,
      contacto: contactoParaPedido(companiaId, contacto),
      evidenciaFotografica: evidenciaFotografica || ''
    };

    const itemEquipo = equipoReparacionAItemPedido(equipo);
    if (itemEquipo) {
      const itemActual = { ...((pedido.equipos && pedido.equipos[0]) || {}) };
      // Si alguna parte ya se reemplazó desde Pedidos (ver "Reemplazar
      // equipo" en pedidos.js), su identidad + serial activos NO se pisan
      // acá — mientras el reemplazo siga activo, lo que sale en el pedido es
      // el equipo nuevo, no el de esta reparación. Solo se refresca la
      // copia "original" guardada dentro de item.reemplazo, para que
      // "Volver al original" siempre use el dato más reciente de acá. Si
      // cambió el tipo de línea (raro: pasar de individual a motoreductor o
      // viceversa), cualquier reemplazo anterior deja de tener sentido y se
      // descarta.
      const mismoTipo = !itemActual.tipoLinea || itemActual.tipoLinea === itemEquipo.tipoLinea;
      const reemplazoPrevio = mismoTipo ? (itemActual.reemplazo || {}) : {};
      const activo = {
        motorEquipoId: itemActual.motorEquipoId,
        reductorEquipoId: itemActual.reductorEquipoId,
        equipoId: itemActual.equipoId,
        serialesMotor: itemActual.serialesMotor || [],
        serialesReductor: itemActual.serialesReductor || [],
        seriales: itemActual.seriales || []
      };

      // Se reemplaza la identidad completa del equipo (tipoLinea + sus ids);
      // el resto del ítem (cantidad, orden de compra, brazo/eje, unidades
      // preparadas) se deja tal cual estaba. FieldValue.delete() no es
      // válido dentro de un array, así que las claves viejas de la
      // identidad se quitan a mano antes de armar el ítem nuevo.
      delete itemActual.equipoId;
      delete itemActual.motorEquipoId;
      delete itemActual.reductorEquipoId;
      delete itemActual.reemplazo;
      const itemActualizado = { ...itemActual, tipoLinea: itemEquipo.tipoLinea };
      const nuevoReemplazo = {};

      if (itemEquipo.tipoLinea === 'motoreductor') {
        if (reemplazoPrevio.motor) {
          itemActualizado.motorEquipoId = activo.motorEquipoId;
          itemActualizado.serialesMotor = [...activo.serialesMotor];
          nuevoReemplazo.motor = { equipoId: itemEquipo.motorEquipoId, serial: equipo.motorSerial || '' };
        } else {
          itemActualizado.motorEquipoId = itemEquipo.motorEquipoId;
          const serialesMotor = [...activo.serialesMotor];
          serialesMotor[0] = equipo.motorSerial || '';
          itemActualizado.serialesMotor = serialesMotor;
        }

        if (reemplazoPrevio.reductor) {
          itemActualizado.reductorEquipoId = activo.reductorEquipoId;
          itemActualizado.serialesReductor = [...activo.serialesReductor];
          nuevoReemplazo.reductor = { equipoId: itemEquipo.reductorEquipoId, serial: equipo.reductorSerial || '' };
        } else {
          itemActualizado.reductorEquipoId = itemEquipo.reductorEquipoId;
          const serialesReductor = [...activo.serialesReductor];
          serialesReductor[0] = equipo.reductorSerial || '';
          itemActualizado.serialesReductor = serialesReductor;
        }
      } else {
        if (reemplazoPrevio.individual) {
          itemActualizado.equipoId = activo.equipoId;
          itemActualizado.seriales = [...activo.seriales];
          nuevoReemplazo.individual = { equipoId: itemEquipo.equipoId, serial: equipo.serial || '' };
        } else {
          itemActualizado.equipoId = itemEquipo.equipoId;
          const seriales = [...activo.seriales];
          seriales[0] = equipo.serial || '';
          itemActualizado.seriales = seriales;
        }
      }

      if (Object.keys(nuevoReemplazo).length) itemActualizado.reemplazo = nuevoReemplazo;

      datos.equipos = [itemActualizado, ...(pedido.equipos || []).slice(1)];
    }

    await refPedido.update(datos);
  }

  // Tras crear el pedido, pedidos.js lo recibe por su propio listener en
  // tiempo real (window.pedidosCache) — normalmente casi al instante, pero
  // por si acaso se espera un poco antes de intentar abrir su ficha.
  async function esperarPedidoEnCache(id, intentos = 12) {
    for (let i = 0; i < intentos; i++) {
      if ((window.pedidosCache || []).some(p => p.id === id)) return true;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    return false;
  }

  async function crearPedidoDesdeReparacion(reparacion) {
    if (reparacion.devuelta) {
      alert('Esta reparación está marcada como devuelta al cliente: no puede generar un pedido.');
      return;
    }
    if (!reparacion.companiaId) {
      alert('Antes de crear el pedido, elige la compañía en "Datos generales".');
      cerrarFicha();
      abrirModalEditar(reparacion);
      subtabButtons[0].click();
      return;
    }
    const itemEquipo = equipoReparacionAItemPedido(reparacion.equipo);
    if (!itemEquipo) {
      alert('Antes de crear el pedido, completa el equipo en la sub-pestaña "Equipos".');
      cerrarFicha();
      abrirModalEditar(reparacion);
      subtabButtons[1].click();
      return;
    }

    const compania = buscarCompania(reparacion.companiaId);
    const confirmar = confirm(
      `¿Crear un pedido a partir de esta reparación?\n\n` +
      `Se copiará el cliente (${compania ? compania.nombre : 'compañía'}), el encargado de recibirlo y el equipo ya cargado. ` +
      `Lo demás (cantidad, orden de compra, etc.) se completa después en Pedidos.`
    );
    if (!confirmar) return;

    const btn = document.getElementById('btn-crear-pedido-desde-reparacion');
    if (btn) { btn.disabled = true; btn.textContent = 'Creando...'; }

    try {
      // El N° del pedido es SIEMPRE el mismo que el de esta reparación (ej.
      // reparación R03 -> pedido también se muestra como R03), no un N°
      // aparte tomado de Pedidos — así queda claro de un vistazo que es el
      // mismo caso en las dos pestañas. Ver textoNumeroPedido() en pedidos.js.
      const numero = reparacion.numero;
      const datosPedido = {
        numero,
        companiaId: reparacion.companiaId,
        contacto: contactoParaPedido(reparacion.companiaId, reparacion.contacto),
        tipo: 'reparacion',
        equipos: [itemEquipo],
        envioSubsidiaria: false,
        subsidiariaId: null,
        subsidiariaContacto: null,
        reparacionId: reparacion.id,
        evidenciaFotografica: reparacion.evidenciaFotografica || '',
        creadoEn: firebase.firestore.FieldValue.serverTimestamp()
      };

      // Mismo ID que la reparación: quedan enlazados 1 a 1 automáticamente.
      await db.collection('pedidos').doc(reparacion.id).set(datosPedido);
      await db.collection(COLECCION).doc(reparacion.id).update({ pedidoId: reparacion.id });

      cerrarFicha();
      const llego = await esperarPedidoEnCache(reparacion.id);
      if (llego && window.abrirFichaPedido) {
        window.abrirFichaPedido(reparacion.id);
      } else {
        alert(`Pedido creado (${formatearNumero(numero)}). Ábrelo desde la pestaña Pedidos.`);
      }
    } catch (err) {
      console.error('Error creando el pedido desde la reparación:', err);
      alert('No se pudo crear el pedido. Revisa la consola.');
      if (btn) { btn.disabled = false; btn.textContent = '🧾 Crear pedido'; }
    }
  }

  // Permite abrir la ficha (solo lectura) de una reparación desde otro
  // archivo — ej. pedidos.js, desde el pedido creado a partir de ella.
  window.abrirFichaReparacion = function (reparacionId) {
    const reparacion = reparacionesCache.find(r => r.id === reparacionId);
    if (reparacion) abrirFicha(reparacion);
  };

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
      inputCompaniaTexto.focus();
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

      // Se guardan estos valores ANTES del form.reset() de más abajo, para
      // poder reabrir la ficha con los datos recién guardados (igual que
      // hace Pedidos al editar desde su ficha).
      let datosGuardados = null;

      if (id) {
        const datosActualizados = {
          companiaId,
          contacto: inputContacto.value.trim(),
          fechaIngreso: inputFechaIngreso.value || null,
          evidenciaFotografica: inputEvidencia.value.trim(),
          equipo: resuelto.equipo,
          observacionesIniciales
        };
        await db.collection(COLECCION).doc(id).update(datosActualizados);
        // Se parte del documento original en caché (no solo de los campos del
        // formulario) para no perder al reabrir la ficha campos que el form
        // no edita, como pedidoId — si no, el botón "Ver ficha de pedido" y
        // demás lógica ligada al pedido vinculado desaparecen hasta refrescar.
        const original = reparacionesCache.find(r => r.id === id);
        datosGuardados = { ...original, id, numero: Number(inputNumero.value), ...datosActualizados };

        // Si esta reparación ya tiene un pedido vinculado, se le empujan los
        // mismos cambios de compañía, contacto y equipo (ver comentario en
        // sincronizarPedidoDesdeReparacion).
        if (original?.pedidoId) {
          await sincronizarPedidoDesdeReparacion(original.pedidoId, companiaId, datosActualizados.contacto, resuelto.equipo, datosActualizados.evidenciaFotografica);
        }
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
          obsProblemaFijada: false,
          obsTieneInforme: false,
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
      if (datosGuardados) abrirFicha(datosGuardados);
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
    // Si esta reparación ya tiene un pedido vinculado (mismo ID en ambas
    // colecciones), se elimina también ese pedido — no puede quedar un
    // pedido "huérfano" apuntando a una reparación que ya no existe.
    // Se respeta la misma regla que "Eliminar" tiene en Pedidos: si el
    // pedido vinculado ya tiene algo despachado en un envío, no se puede
    // borrar nada (ver window.pedidoTieneAlgoDespachado, expuesto por
    // pedidos.js).
    if (reparacion.pedidoId && window.pedidoTieneAlgoDespachado) {
      const pedidoVinculado = (window.pedidosCache || []).find(p => p.id === reparacion.pedidoId);
      if (pedidoVinculado && window.pedidoTieneAlgoDespachado(pedidoVinculado)) {
        alert('No se puede eliminar: el pedido vinculado a esta reparación ya tiene equipos despachados en un envío.');
        return;
      }
    }

    const mensaje = reparacion.pedidoId
      ? `¿Eliminar la reparación ${formatearNumero(reparacion.numero)}? También se eliminará el pedido vinculado (mismo N°). Esta acción no se puede deshacer. El número quedará libre para una reparación nueva.`
      : `¿Eliminar la reparación ${formatearNumero(reparacion.numero)}? Esta acción no se puede deshacer. El número quedará libre para una reparación nueva.`;
    const ok = confirm(mensaje);
    if (!ok) return;
    try {
      if (reparacion.pedidoId) {
        // Se borra primero el pedido vinculado (mismo ID) — usando la
        // función expuesta por pedidos.js, que ya sabe respetar la regla de
        // "no eliminar si algo quedó despachado en un envío" — y solo si
        // eso sale bien se borra la reparación.
        const resultado = window.eliminarPedidoDesdeReparacion
          ? await window.eliminarPedidoDesdeReparacion(reparacion.pedidoId)
          : await db.collection('pedidos').doc(reparacion.pedidoId).delete().then(() => ({ ok: true }));
        if (!resultado.ok) {
          alert('No se pudo eliminar el pedido vinculado. La reparación no se eliminó.');
          return;
        }
      }
      // Las fichas de observaciones son una subcolección: Firestore no la
      // borra al borrar el documento padre, así que se borran aparte (en
      // tandas, porque un lote admite como máximo 500 operaciones).
      const fichasObs = await db.collection(COLECCION).doc(reparacion.id).collection(SUB_OBSERVACIONES).get();
      for (let i = 0; i < fichasObs.docs.length; i += 400) {
        const lote = db.batch();
        fichasObs.docs.slice(i, i + 400).forEach(d => lote.delete(d.ref));
        await lote.commit();
      }
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

  // ---------- Orden de la lista (por número / por nombre) ----------
  document.getElementById('orden-reparaciones').addEventListener('change', (e) => {
    ordenReparaciones = e.target.value;
    renderLista();
  });

  // ---------- Filtro de estado (En proceso / Completado / Devolución / Todos) ----------
  // "Devolución" queda con la etiqueta lista pero sin lógica propia todavía
  // — por ahora no filtra nada especial (se comporta como "Todos") hasta
  // que se defina la dinámica de devoluciones en Reparaciones.
  const chipsFiltroEstadoReparaciones = document.querySelectorAll('#filtro-estado-reparaciones .chip-filtro-estado');
  chipsFiltroEstadoReparaciones.forEach(chip => {
    chip.classList.toggle('active', chip.dataset.estado === filtroEstadoReparaciones);
    chip.addEventListener('click', () => {
      filtroEstadoReparaciones = chip.dataset.estado;
      chipsFiltroEstadoReparaciones.forEach(c => c.classList.toggle('active', c === chip));
      renderLista();
    });
  });

  // ---------- Filtro adicional "Con pedido" ----------
  // Chip independiente del de estado: cuando está activo, solo muestra
  // reparaciones que ya generaron un pedido (pedidoId presente).
  const chipTienePedido = document.getElementById('chip-tiene-pedido-reparaciones');
  chipTienePedido.addEventListener('click', () => {
    filtroTienePedido = !filtroTienePedido;
    chipTienePedido.classList.toggle('active', filtroTienePedido);
    renderLista();
  });

  // Icono del tipo de un equipo del catálogo (config de Tipos de equipo).
  function iconoTipoDe(equipo) {
    if (!equipo) return '';
    const tipo = (window.tiposEquipoCache || []).find(t => t.id === equipo.tipoId);
    return window.iconoTipoHtml(tipo);
  }

  // Texto plano (para el buscador) con nombre(s) y serial(es) del equipo.
  function textoEquipoBusqueda(reparacion) {
    const item = reparacion.equipo;
    if (!item) return '';
    if (item.tipoLinea === 'motoreductor') {
      const motor = buscarEquipoCatalogo(item.motorEquipoId);
      const reductor = buscarEquipoCatalogo(item.reductorEquipoId);
      return normalizar([
        item.zd ? 'motoreductor zd' : '',
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
      const nt = nombresTipoMotoreductor(!!item.zd);
      return `${iconoDeTipoId(tipoIdLineaMotoreductor(!!item.zd))} ${etiquetaMotoreductor(!!item.zd)} — ${iconoDeTipoId(tipoIdPorNombre(nt.motor))} ${motorTxt}${serialMotor} + ${iconoDeTipoId(tipoIdPorNombre(nt.reductor))} ${reductorTxt}${serialReductor}`;
    }

    const eq = buscarEquipoCatalogo(item.equipoId);
    const nombreTxt = eq
      ? escapeHtml(nombreMostrableEquipo(eq))
      : '<span style="color:var(--danger);">Equipo no encontrado</span>';
    const serial = item.serial ? `<span class="reparacion-card-serial">S/N ${escapeHtml(item.serial)}</span>` : '';
    const icono = iconoTipoDe(eq);
    return `${icono ? icono + ' ' : ''}${nombreTxt}${serial}`;
  }

  function reparacionCoincideTexto(reparacion) {
    if (!filtroTexto) return true;
    const compania = buscarCompania(reparacion.companiaId);
    if (compania && normalizar(compania.nombre).includes(filtroTexto)) return true;
    if (normalizar(reparacion.contacto).includes(filtroTexto)) return true;
    if (normalizar(formatearNumero(reparacion.numero)).includes(filtroTexto)) return true;
    if (textoEquipoBusqueda(reparacion).includes(filtroTexto)) return true;
    return false;
  }

  // Chip de estado (En proceso / Completado / Devolución / Todos). Igual que
  // en Pedidos: "en proceso" es todo lo que no está completado ni devuelto.
  function reparacionCoincideEstado(reparacion) {
    if (filtroEstadoReparaciones === 'completado') return reparacionEstaCompletada(reparacion);
    if (filtroEstadoReparaciones === 'devolucion') return !!reparacion.devuelta;
    if (filtroEstadoReparaciones === 'en_proceso') return !reparacionEstaCompletada(reparacion) && !reparacion.devuelta;
    return true; // todos
  }

  function reparacionCoincide(reparacion) {
    if (filtroTienePedido && !reparacion.pedidoId) return false;
    if (!reparacionCoincideEstado(reparacion)) return false;
    return reparacionCoincideTexto(reparacion);
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
        ? 'Ninguna reparación coincide con la búsqueda y los filtros activos.'
        : 'Todavía no hay reparaciones registradas.';
      return;
    }
    tablaEmpty.style.display = 'none';

    // Por número (como siempre) o por nombre de la compañía; a igual nombre,
    // por número. Compañías no encontradas, al final.
    const ordenadas = [...filtradas].sort((a, b) => {
      if (ordenReparaciones) {
        const nombreA = buscarCompania(a.companiaId)?.nombre;
        const nombreB = buscarCompania(b.companiaId)?.nombre;
        if (nombreA || nombreB) {
          if (!nombreA) return 1;
          if (!nombreB) return -1;
          const r = String(nombreA).localeCompare(String(nombreB), 'es', { sensitivity: 'base', numeric: true });
          if (r) return ordenReparaciones === 'nombre_desc' ? -r : r;
        }
      }
      return a.numero - b.numero;
    });

    listaContenedor.innerHTML = ordenadas.map(reparacion => {
      const compania = buscarCompania(reparacion.companiaId);
      const nombreCompania = compania ? escapeHtml(compania.nombre) : '<span style="color:var(--danger);">Compañía no encontrada</span>';
      const completada = reparacionEstaCompletada(reparacion);
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
        <div class="reparacion-card ${completada ? 'completado' : ''}" data-id="${reparacion.id}">
          <div class="reparacion-card-top">
            <span class="reparacion-card-numero">${formatearNumero(reparacion.numero)}</span>
            ${reparacion.pedidoId ? '<span class="reparacion-card-tiene-pedido">🧾 Tiene pedido</span>' : ''}
            ${reparacion.obsProblemaFijada ? '<span class="tag-reparacion-problema" title="Tiene una ficha de problema fijada">⚠️ Problema</span>' : ''}
            ${reparacion.obsTieneInforme ? '<span class="tag-reparacion-informe" title="Ya se le hizo informe">📋 Informe</span>' : ''}
            ${completada ? '<span class="tag-pedido-completado">COMPLETADO</span>' : ''}
            ${reparacion.devuelta ? '<span class="tag-pedido-devolucion">DEVOLUCIÓN</span>' : ''}
            <div class="reparacion-card-actions">
              <button type="button" class="btn-obs-rapido" data-lectura-ok data-id="${reparacion.id}" title="Ver observaciones" aria-label="Ver observaciones">📝</button>
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
    // link de evidencia) abre la ficha de solo lectura, igual que Pedidos.
    // Solo desde el botón "Editar" de esa ficha se llega al formulario editable.
    listaContenedor.querySelectorAll('.reparacion-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('a')) return;
        const reparacion = reparacionesCache.find(r => r.id === card.dataset.id);
        if (reparacion) abrirFicha(reparacion);
      });
    });
    listaContenedor.querySelectorAll('.btn-obs-rapido').forEach(btn => {
      btn.addEventListener('click', () => {
        const reparacion = reparacionesCache.find(r => r.id === btn.dataset.id);
        if (reparacion) abrirObsRapido(reparacion);
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
  let sesionLista = false;   // true cuando auth.js confirma la sesión
  let tabVisitada = false;   // true si ya se entró a esta pestaña
  function iniciarSuscripcion() {
    // Sin sesión Firestore rechazaría la lectura y la suscripción moriría.
    if (!sesionLista || suscrito) return;
    suscrito = true;
    db.collection(COLECCION).orderBy('numero').onSnapshot(
      (snapshot) => {
        reparacionesCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        window.reparacionesCache = reparacionesCache;
        renderLista();
        completarMarcasPendientes();
        // Si la ficha de esta reparación está abierta, se refresca en vivo
        // (ej. al eliminar desde Pedidos el pedido asociado: pedidos.js le
        // borra el pedidoId a este documento, y sin esto el botón "Ver
        // pedido ↗" se quedaría ahí hasta cerrar y reabrir la ficha).
        if (modalFicha.classList.contains('open')) {
          const reparacionAbierta = reparacionesCache.find(r => r.id === btnEditarDesdeFicha.dataset.id);
          if (reparacionAbierta) {
            actualizarHeaderAcciones(reparacionAbierta);
            renderFichaDatos(reparacionAbierta);
            renderFichaEquipos(reparacionAbierta);
            btnEditarDesdeFicha.disabled = !!reparacionAbierta.devuelta;
            btnEditarDesdeFicha.title = reparacionAbierta.devuelta ? 'Reparación devuelta: la ficha queda de solo lectura' : '';
          }
        }
        document.dispatchEvent(new CustomEvent('reparaciones:cambio', { detail: { reparaciones: reparacionesCache } }));
      },
      (err) => {
        console.error('Error escuchando reparaciones:', err);
      }
    );
  }

  // El estado "completado" de una reparación depende del pedido vinculado
  // (mismo ID), así que cuando ese pedido cambia (ej. se despachó un envío)
  // hay que refrescar la tarjeta y, si está abierta, la ficha — aunque el
  // documento de la reparación en sí no haya cambiado.
  document.addEventListener('pedidos:cambio', () => {
    renderLista();
    if (modalFicha.classList.contains('open')) {
      const reparacionAbierta = reparacionesCache.find(r => r.id === btnEditarDesdeFicha.dataset.id);
      if (reparacionAbierta) {
        actualizarHeaderAcciones(reparacionAbierta);
        renderFichaEquipos(reparacionAbierta); // el reemplazo de equipo vive en el pedido, no acá
      }
    }
  });

  // Si cambian las guías de remisión, la ficha abierta muestra/oculta su "?".
  document.addEventListener('guias:cambio', () => {
    if (!modalFicha.classList.contains('open')) return;
    const reparacionAbierta = reparacionesCache.find(r => r.id === btnEditarDesdeFicha.dataset.id);
    if (reparacionAbierta) renderFichaEquipos(reparacionAbierta);
  });

  // Acciones como marcar devuelta actualizan Firestore directamente (sin
  // volver a llamar abrirFicha), así que sin esto la ficha se queda
  // mostrando datos viejos hasta cerrarla y reabrirla. Al llegar el
  // snapshot con los datos frescos, si esa ficha sigue abierta, se refresca
  // conservando el subtab en el que estaba.
  document.addEventListener('reparaciones:cambio', () => {
    if (modalObsRapido.classList.contains('open')) renderObservaciones(); // la ficha "Ingreso" sale de la reparación
    if (!modalFicha.classList.contains('open')) return;
    const reparacionActual = reparacionesCache.find(r => r.id === btnEditarDesdeFicha.dataset.id);
    if (reparacionActual) abrirFicha(reparacionActual, subtabFichaActiva());
  });

  // El rol llega un instante después de la sesión: si es de edición, se completan
  // las marcas que falten.
  document.addEventListener('roles:listo', completarMarcasPendientes);

  document.addEventListener('auth:listo', () => {
    sesionLista = true;
    if (tabVisitada) iniciarSuscripcion();
  });

  document.addEventListener('tab:activada', (e) => {
    if (e.detail.tab !== 'reparaciones') return;
    tabVisitada = true;
    iniciarSuscripcion();
  });
})();
