// ================== Pestaña: Envíos / Despachos ==================
// Listado y ficha de todos los envíos sobre Firestore (colección "envios").
// Los envíos se CREAN desde la ficha de un pedido (pedidos.js, sub-pestaña
// Envío/Despacho) — aquí solo se listan, se consultan y se despachan.
//
// Cada envío:
// {
//   esInterno: boolean,
//   empresaEnvioId: string | null,      // solo si !esInterno
//   personaRecoge: string,              // solo si esInterno
//   remesa: string,                     // opcional, solo si !esInterno
//   estado: 'armado' | 'despachado',
//   fechaDespacho: timestamp | null,
//   pedidos: [ { pedidoId, remision, items: [{ itemIndex, cantidad }] } ]
// }
//
// Expone window.enviosCache + evento 'envios:cambio' para que pedidos.js
// pueda saber a qué envíos ya está vinculado un pedido, y ofrecer "usar un
// envío existente" al agregar equipos a un envío.

(function () {
  const COLECCION = 'envios';

  const tablaBody  = document.getElementById('tabla-envios-body');
  const tablaEmpty = document.getElementById('envios-empty');
  const buscadorEnvios = document.getElementById('buscador-envios');
  const resultadosBuscadorEnvios = document.getElementById('resultados-buscador-envios');
  const chipsFiltroEstadoEnvio = document.getElementById('filtro-estado-envios');
  const chipsFiltroTransportadora = document.getElementById('filtro-transportadora-envios');

  const modalFicha = document.getElementById('modal-ficha-envio');
  const fichaTitulo = document.getElementById('ficha-envio-titulo');
  const fichaSubtitulo = document.getElementById('ficha-envio-subtitulo');
  const fichaEstadoTag = document.getElementById('ficha-envio-estado-tag');
  const fichaContenido = document.getElementById('ficha-envio-contenido');
  const btnCerrarFicha = document.getElementById('btn-cerrar-ficha-envio');
  const btnDespacharEnvio = document.getElementById('btn-despachar-envio');
  const btnCancelarEnvio = document.getElementById('btn-cancelar-envio');
  const btnGuardarEnvio = document.getElementById('btn-guardar-envio');

  window.enviosCache = [];
  let envioIdEnFicha = null;
  let volverAPedidoId = null; // si la ficha se abrió desde dentro de un pedido, aquí queda su id
  let filtroEstadoEnvios = 'todos';
  let filtroTransportadoraEnvios = ''; // '' = todas, 'interno', o el id de una empresa
  let filtroTextoEnvios = '';

  function normalizar(str) {
    return String(str ?? '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Fecha de hoy en formato YYYY-MM-DD (hora local, no UTC) para usar como
  // valor por defecto y como valor de un <input type="date">.
  function fechaHoyISO() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function difundirCambio() {
    document.dispatchEvent(new CustomEvent('envios:cambio', { detail: { envios: window.enviosCache } }));
  }

  function nombreQuienEncarga(envio) {
    if (envio.esInterno) return '🏠 Interno' + (envio.personaRecoge ? ` — ${escapeHtml(envio.personaRecoge)}` : '');
    const empresa = (window.empresasEnvioCache || []).find(e => e.id === envio.empresaEnvioId);
    return empresa ? escapeHtml(empresa.nombre) : '<span style="color:var(--danger);">Empresa no encontrada</span>';
  }

  // Para envíos Interno no existe una remesa real de transportadora — se usa
  // el nombre de la persona encargada de recogerlo en su lugar.
  function remesaMostrable(envio) {
    if (envio.esInterno) return envio.personaRecoge ? escapeHtml(envio.personaRecoge) : 'Interno (sin encargado aún)';
    return envio.remesa ? escapeHtml(envio.remesa) : null;
  }

  function buscarPedido(pedidoId) {
    return (window.pedidosCache || []).find(p => p.id === pedidoId) || null;
  }

  function buscarCompania(companiaId) {
    return (window.clientesCache || []).find(c => c.id === companiaId) || null;
  }

  function buscarEquipoCatalogo(equipoId) {
    return (window.equiposCache || []).find(eq => eq.id === equipoId) || null;
  }

  // Icono/color configurados en Config para el tipo de un equipo (mismo
  // catálogo que usa equipos.js — window.tiposEquipoCache).
  function buscarTipoEquipo(tipoId) {
    return (window.tiposEquipoCache || []).find(t => t.id === tipoId) || null;
  }

  // Mismo mapa que usa pedidos.js para el tag de tipo de pedido — se
  // duplica aquí (archivo independiente) para mostrarlo en cada remisión.
  const TIPO_PEDIDO_LABEL = {
    normal: { texto: 'Normal', clase: 'tag-pedido-normal', icono: '📦' },
    reparacion: { texto: 'Reparación', clase: 'tag-pedido-reparacion', icono: '🔧' }
  };

  // Texto a mostrar para una unidad puntual (identificada por su índice)
  // dentro de un ítem que usa serial — su serial si ya está asignado, o un
  // aviso si todavía no se ha registrado.
  function etiquetaUnidadEnvio(item, unidadIdx) {
    if (item.tipoLinea === 'motoreductor') {
      const sm = (item.serialesMotor?.[unidadIdx] || '').trim();
      const sr = (item.serialesReductor?.[unidadIdx] || '').trim();
      return (sm || sr)
        ? `Motor: ${escapeHtml(sm || '—')} / Reductor: ${escapeHtml(sr || '—')}`
        : `Unidad ${unidadIdx + 1} (sin serial asignado)`;
    }
    const serial = (item.seriales?.[unidadIdx] || '').trim();
    return serial ? `Serial: ${escapeHtml(serial)}` : `Unidad ${unidadIdx + 1} (sin serial asignado)`;
  }

  // ---------- Filtros: estado y transportadora (chips) + búsqueda ----------

  chipsFiltroEstadoEnvio.querySelectorAll('.chip-pill').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.estado === filtroEstadoEnvios);
    chip.addEventListener('click', () => {
      filtroEstadoEnvios = chip.dataset.estado;
      chipsFiltroEstadoEnvio.querySelectorAll('.chip-pill').forEach(c => c.classList.toggle('active', c === chip));
      renderTabla();
      mostrarSugerenciasEnvios();
    });
  });

  // Chips de transportadora: se regeneran cada vez que cambia el catálogo de
  // Config (empresas_envio), porque ahí se agregan/editan/eliminan en vivo.
  // Si la empresa que estaba filtrada deja de existir, el filtro vuelve a
  // "Todas" para no quedarse "atascado" en una opción fantasma.
  function renderChipsTransportadora() {
    const empresas = window.empresasEnvioCache || [];
    const seleccionValida = !filtroTransportadoraEnvios
      || filtroTransportadoraEnvios === 'interno'
      || empresas.some(e => e.id === filtroTransportadoraEnvios);
    if (!seleccionValida) filtroTransportadoraEnvios = '';

    chipsFiltroTransportadora.innerHTML = `
      <button type="button" class="chip-pill" data-transportadora="">Todas</button>
      <button type="button" class="chip-pill" data-transportadora="interno">🏠 Interno</button>
      ${empresas.map(e => `<button type="button" class="chip-pill" data-transportadora="${e.id}">${escapeHtml(e.nombre)}</button>`).join('')}
    `;
    chipsFiltroTransportadora.querySelectorAll('.chip-pill').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.transportadora === filtroTransportadoraEnvios);
      chip.addEventListener('click', () => {
        filtroTransportadoraEnvios = chip.dataset.transportadora;
        chipsFiltroTransportadora.querySelectorAll('.chip-pill').forEach(c => c.classList.toggle('active', c === chip));
        renderTabla();
        mostrarSugerenciasEnvios();
      });
    });
  }
  renderChipsTransportadora();
  document.addEventListener('empresas-envio:cambio', renderChipsTransportadora);

  function envioCoincideConEstado(envio) {
    if (filtroEstadoEnvios === 'todos') return true;
    return envio.estado === filtroEstadoEnvios;
  }

  function envioCoincideConTransportadora(envio) {
    if (!filtroTransportadoraEnvios) return true;
    if (filtroTransportadoraEnvios === 'interno') return !!envio.esInterno;
    return !envio.esInterno && envio.empresaEnvioId === filtroTransportadoraEnvios;
  }

  // Pedidos completos (deduplicados) incluidos en un envío — usados tanto
  // por la búsqueda como por las sugerencias del buscador.
  function pedidosDelEnvio(envio) {
    const ids = [...new Set((envio.pedidos || []).map(p => p.pedidoId))];
    return ids.map(id => buscarPedido(id)).filter(Boolean);
  }

  // Busca por: N° de pedido, nombre de cliente (compañía), remesa o número
  // de remisión — de cualquiera de los pedidos incluidos en el envío.
  function envioCoincideConBusquedaTexto(envio, texto) {
    if (!texto) return true;
    if (!envio.esInterno && envio.remesa && normalizar(envio.remesa).includes(texto)) return true;
    return (envio.pedidos || []).some(pInfo => {
      if (pInfo.remision && normalizar(pInfo.remision).includes(texto)) return true;
      const pedido = buscarPedido(pInfo.pedidoId);
      if (!pedido) return false;
      if (normalizar(String(pedido.numero)).includes(texto)) return true;
      const compania = buscarCompania(pedido.companiaId);
      if (compania && normalizar(compania.nombre).includes(texto)) return true;
      return false;
    });
  }

  function envioCoincideConBusqueda(envio) {
    return envioCoincideConBusquedaTexto(envio, filtroTextoEnvios);
  }

  buscadorEnvios.addEventListener('input', () => {
    filtroTextoEnvios = normalizar(buscadorEnvios.value.trim());
    renderTabla();
    mostrarSugerenciasEnvios();
  });
  buscadorEnvios.addEventListener('focus', mostrarSugerenciasEnvios);
  buscadorEnvios.addEventListener('blur', () => setTimeout(ocultarResultadosEnvios, 120));

  function ocultarResultadosEnvios() {
    resultadosBuscadorEnvios.classList.remove('open');
    resultadosBuscadorEnvios.innerHTML = '';
  }

  function etiquetaEnvioSugerencia(envio) {
    return nombreQuienEncarga(envio).replace(/<[^>]+>/g, '');
  }

  function subtextoEnvioSugerencia(envio) {
    const nombresPedidos = pedidosDelEnvio(envio).map(p => {
      const compania = buscarCompania(p.companiaId);
      return `N°${p.numero}${compania ? ' · ' + compania.nombre : ''}`;
    }).join(' · ');
    const remesaTxt = envio.esInterno ? '' : (envio.remesa ? `Remesa ${envio.remesa}` : 'Sin remesa');
    return [remesaTxt, nombresPedidos].filter(Boolean).join(' · ') || 'Sin pedidos';
  }

  // Las sugerencias respetan los chips activos (estado y transportadora),
  // igual que ya hace pedidos.js con su propio buscador.
  function mostrarSugerenciasEnvios() {
    const texto = filtroTextoEnvios;
    if (!texto) return ocultarResultadosEnvios();

    const candidatos = window.enviosCache
      .filter(envioCoincideConEstado)
      .filter(envioCoincideConTransportadora)
      .filter(en => envioCoincideConBusquedaTexto(en, texto))
      .slice(0, 8);

    if (!candidatos.length) {
      resultadosBuscadorEnvios.innerHTML = '<div class="buscador-item-vacio">Sin envíos que coincidan</div>';
      resultadosBuscadorEnvios.classList.add('open');
      return;
    }

    resultadosBuscadorEnvios.innerHTML = candidatos.map(en => `
      <div class="buscador-item" data-id="${en.id}">
        ${escapeHtml(etiquetaEnvioSugerencia(en))}
        <span class="buscador-item-sub">${escapeHtml(subtextoEnvioSugerencia(en))}</span>
      </div>
    `).join('');
    resultadosBuscadorEnvios.classList.add('open');

    resultadosBuscadorEnvios.querySelectorAll('.buscador-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const envio = window.enviosCache.find(en => en.id === el.dataset.id);
        if (!envio) return;
        ocultarResultadosEnvios();
        abrirFicha(envio);
      });
    });
  }

  // ---------- Render de la tabla principal ----------

  function renderTabla() {
    const lista = window.enviosCache
      .filter(envioCoincideConEstado)
      .filter(envioCoincideConTransportadora)
      .filter(envioCoincideConBusqueda);

    if (!lista.length) {
      tablaBody.innerHTML = '';
      tablaEmpty.style.display = 'block';
      return;
    }
    tablaEmpty.style.display = 'none';

    const ordenados = [...lista].sort((a, b) => (a.estado === b.estado ? 0 : a.estado === 'armado' ? -1 : 1));

    tablaBody.innerHTML = ordenados.map(envio => {
      const estadoTag = envio.estado === 'despachado'
        ? '<span class="tag-envio-despachado">Despachado</span>'
        : '<span class="tag-envio-armado">Armado</span>';
      const cantidadPedidos = (envio.pedidos || []).length;

      return `
        <tr data-id="${envio.id}" class="fila-pedido-clicable">
          <td>${nombreQuienEncarga(envio)}</td>
          <td>${remesaMostrable(envio) || '<span style="color:var(--ink-soft);">—</span>'}</td>
          <td>${cantidadPedidos} ${cantidadPedidos === 1 ? 'pedido' : 'pedidos'}</td>
          <td>${estadoTag}</td>
          <td></td>
        </tr>
      `;
    }).join('');

    tablaBody.querySelectorAll('tr.fila-pedido-clicable').forEach(tr => {
      tr.addEventListener('click', () => {
        const envio = window.enviosCache.find(en => en.id === tr.dataset.id);
        if (envio) abrirFicha(envio);
      });
    });
  }

  // ---------- Ficha de envío (editable mientras esté "armado") ----------

  function opcionesQuienEncargaHtml(envio) {
    const empresas = window.empresasEnvioCache || [];
    const opciones = '<option value="interno">🏠 Interno</option>' +
      empresas.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)}</option>`).join('');
    return opciones;
  }

  function abrirFicha(envio, opciones) {
    envioIdEnFicha = envio.id;
    volverAPedidoId = opciones?.volverAPedidoId || null;
    const despachado = envio.estado === 'despachado';
    const remesaBloqueada = despachado && !!envio.remesa; // solo se bloquea si YA tiene remesa

    fichaTitulo.textContent = nombreQuienEncarga(envio).replace(/<[^>]+>/g, '');
    fichaSubtitulo.textContent = envio.esInterno
      ? (envio.personaRecoge ? `Recoge: ${envio.personaRecoge}` : 'Interno — sin encargado aún')
      : (envio.remesa ? `Remesa ${envio.remesa}` : 'Sin remesa asignada');
    fichaEstadoTag.innerHTML = despachado
      ? '<span class="tag-envio-despachado">Despachado</span>'
      : '<span class="tag-envio-armado">Armado</span>';

    const pedidosIncluidos = envio.pedidos || [];

    // idxEnGrupo (posición de esta entrada dentro de las de su MISMO pedido)
    // se sigue calculando igual que antes: es lo que usa "Guardar cambios"
    // para reconciliar los números de remisión escritos con los datos frescos
    // de Firestore sin pisar remisiones que otra sesión haya agregado mientras
    // esta ficha estaba abierta. Ya no se usa para agrupar visualmente.
    const contadorPorPedido = {};
    const entradas = pedidosIncluidos.map((pInfo, idxRemision) => {
      const idxEnGrupo = contadorPorPedido[pInfo.pedidoId] || 0;
      contadorPorPedido[pInfo.pedidoId] = idxEnGrupo + 1;
      return { pInfo, idxRemision, idxEnGrupo };
    });

    // ---------- Resumen: "Pedidos que lo componen" / "Remisiones que lo componen" ----------

    const idsPedidoUnicos = [...new Set(pedidosIncluidos.map(p => p.pedidoId))];
    const pedidosResumenHtml = idsPedidoUnicos.length
      ? idsPedidoUnicos.map(pedidoId => {
          const pedido = buscarPedido(pedidoId);
          if (!pedido) return '<span class="chip-pedido-envio chip-pedido-envio-vacio">⚠️ Pedido no encontrado</span>';
          const compania = buscarCompania(pedido.companiaId);
          const nombreCompania = compania ? escapeHtml(compania.nombre) : 'Compañía no encontrada';
          return `<button type="button" class="chip-pedido-envio" data-pedido-id="${pedido.id}">N${pedido.numero} - ${nombreCompania}</button>`;
        }).join('')
      : '<span class="envio-resumen-vacio">Sin pedidos</span>';

    const remisionesResumenHtml = entradas.length
      ? entradas.map(({ pInfo, idxRemision, idxEnGrupo }) => {
          const btnRetirar = despachado ? '' : `<button type="button" class="btn-retirar-remision" data-idx-remision="${idxRemision}" title="Retirar esta remisión completa, con todos sus equipos">✕</button>`;
          return `
            <span class="chip-remision-envio">
              <input type="text" class="input-remision-envio" data-pedidoid="${pInfo.pedidoId}" data-grupo-idx="${idxEnGrupo}" value="${escapeHtml(pInfo.remision || '')}" placeholder="N° remisión" ${despachado ? 'disabled' : ''}>
              ${btnRetirar}
            </span>
          `;
        }).join('')
      : '<span class="envio-resumen-vacio">Sin remisiones</span>';

    // ---------- Equipos: lista plana con fondo por estado (armado = amarillo, despachado = verde) ----------

    const estadoClaseEquipo = despachado ? 'despachado' : 'armado';
    const lineasEquipos = [];

    entradas.forEach(({ pInfo, idxRemision }) => {
      const pedido = buscarPedido(pInfo.pedidoId);
      const prefijoPedido = pedido ? `N${pedido.numero}` : '⚠️';

      (pInfo.items || []).forEach((it, idxItem) => {
        const item = pedido?.equipos?.[it.itemIndex];

        if (!item) {
          // Ítem huérfano (ya no existe en el pedido): no hay forma de saber
          // su tipo, así que solo se puede retirar por completo.
          const detalleCantidad = it.unidades ? `unidad(es): ${it.unidades.map(u => u + 1).join(', ')}` : `cant. ${it.cantidad}`;
          const btnRetirarItem = despachado ? '' : `<button type="button" class="btn-retirar-item" data-idx-remision="${idxRemision}" data-idx-item="${idxItem}" title="Retirar este equipo de la remisión">✕</button>`;
          lineasEquipos.push(`
            <div class="equipo-envio-linea ${estadoClaseEquipo}">
              <span class="equipo-envio-pedido">${prefijoPedido}</span>
              <span class="equipo-envio-nombre">⚠️ Ítem no encontrado</span>
              <span class="equipo-envio-detalle">${detalleCantidad}${btnRetirarItem}</span>
            </div>
          `);
          return;
        }

        // El ícono de cada equipo es el que se configuró en Config para su
        // tipo (mismo catálogo/ícono que se ve en la pestaña Equipos).
        let nombre;
        if (item.tipoLinea === 'motoreductor') {
          const equipoMotor = buscarEquipoCatalogo(item.motorEquipoId);
          const equipoReductor = buscarEquipoCatalogo(item.reductorEquipoId);
          const iconoMotor = buscarTipoEquipo(equipoMotor?.tipoId)?.icono || '';
          const iconoReductor = buscarTipoEquipo(equipoReductor?.tipoId)?.icono || '';
          nombre = `${iconoMotor ? iconoMotor + ' ' : ''}${equipoMotor?.nombre || '?'} + ${iconoReductor ? iconoReductor + ' ' : ''}${equipoReductor?.nombre || '?'}`;
        } else {
          const equipo = buscarEquipoCatalogo(item.equipoId);
          const icono = buscarTipoEquipo(equipo?.tipoId)?.icono || '';
          nombre = `${icono ? icono + ' ' : ''}${equipo?.nombre || 'Equipo no encontrado'}`;
        }

        // Equipo CON serial: se sabe exactamente cuál unidad es cuál, así que
        // cada una se lista y se retira por separado.
        if (it.unidades && it.unidades.length) {
          it.unidades.forEach(u => {
            const btnRetirarUnidad = despachado ? '' : `<button type="button" class="btn-retirar-unidad" data-idx-remision="${idxRemision}" data-idx-item="${idxItem}" data-unidad="${u}" title="Retirar esta unidad de la remisión">✕</button>`;
            lineasEquipos.push(`
              <div class="equipo-envio-linea ${estadoClaseEquipo}">
                <span class="equipo-envio-pedido">${prefijoPedido}</span>
                <span class="equipo-envio-nombre">${nombre}</span>
                <span class="equipo-envio-detalle">🆔 ${etiquetaUnidadEnvio(item, u)}${btnRetirarUnidad}</span>
              </div>
            `);
          });
          return;
        }

        // Equipo SIN serial: las unidades son indistinguibles entre sí, así
        // que se retira por cantidad (puede ser parcial, no solo todo o nada).
        const controlCantidad = despachado ? '' : `
              <span class="retirar-cantidad-control">
                <input type="number" class="input-retirar-cantidad" min="1" max="${it.cantidad}" value="${it.cantidad}" title="Cantidad a retirar">
                <button type="button" class="btn-retirar-cantidad" data-idx-remision="${idxRemision}" data-idx-item="${idxItem}" title="Retirar esta cantidad de la remisión">✕</button>
              </span>`;
        lineasEquipos.push(`
          <div class="equipo-envio-linea ${estadoClaseEquipo}">
            <span class="equipo-envio-pedido">${prefijoPedido}</span>
            <span class="equipo-envio-nombre">${nombre}</span>
            <span class="equipo-envio-detalle">cant. ${it.cantidad}${controlCantidad}</span>
          </div>
        `);
      });
    });

    fichaContenido.innerHTML = `

      <div class="form-group">
        <label>¿Quién se encarga?</label>
        <select id="ficha-envio-quien-encarga" ${despachado ? 'disabled' : ''}>${opcionesQuienEncargaHtml(envio)}</select>
      </div>
      <div class="form-group" id="ficha-envio-grupo-persona" style="display:none;">
        <label>¿Quién recoge?</label>
        <input type="text" id="ficha-envio-persona-recoge" value="${escapeHtml(envio.personaRecoge || '')}" ${despachado ? 'disabled' : ''}>
      </div>
      <div class="form-group" id="ficha-envio-grupo-remesa" style="display:none;">
        <label>Remesa de envío</label>
        <input type="text" id="ficha-envio-remesa" value="${escapeHtml(envio.remesa || '')}" placeholder="Número de remesa" ${remesaBloqueada ? 'disabled' : ''}>
        ${despachado && !remesaBloqueada ? '<div class="hint-peso-calculado" style="display:block;">Todavía no tiene remesa — la puedes completar cuando la tengas.</div>' : ''}
      </div>
      <div class="form-group">
        <label>Fecha de envío</label>
        <input type="date" id="ficha-envio-fecha" value="${escapeHtml(envio.fechaEnvio || fechaHoyISO())}" ${despachado ? 'disabled' : ''}>
        <div class="hint-peso-calculado" id="ficha-envio-fecha-hint" style="display:none;">Guardado ✓</div>
        ${despachado ? '<div class="hint-peso-calculado" style="display:block;">Congelada al momento del despacho.</div>' : ''}
      </div>

      <div class="envio-resumen">
        <div class="envio-resumen-linea">
          <span class="envio-resumen-label">Pedidos que lo componen:</span>
          <span class="envio-resumen-chips">${pedidosResumenHtml}</span>
        </div>
        <div class="envio-resumen-linea">
          <span class="envio-resumen-label">Remisiones que lo componen:</span>
          <span class="envio-resumen-chips">${remisionesResumenHtml}</span>
        </div>
      </div>

      <h4 style="margin-top:18px;">Equipos en este envío</h4>
      <div class="equipos-envio-lista">
        ${lineasEquipos.join('') || '<div class="empty-equipos-pedido">Sin equipos.</div>'}
      </div>
    `;

    const selectQuien = document.getElementById('ficha-envio-quien-encarga');
    const grupoPersona = document.getElementById('ficha-envio-grupo-persona');
    const grupoRemesaFicha = document.getElementById('ficha-envio-grupo-remesa');

    selectQuien.value = envio.esInterno ? 'interno' : (envio.empresaEnvioId || 'interno');

    function actualizarGruposFicha() {
      const esInterno = selectQuien.value === 'interno';
      grupoPersona.style.display = esInterno ? 'block' : 'none';
      grupoRemesaFicha.style.display = esInterno ? 'none' : 'block';
    }
    actualizarGruposFicha();
    if (!despachado) selectQuien.addEventListener('change', actualizarGruposFicha);

    // Fecha de envío: se guarda sola apenas se selecciona una fecha (no
    // espera al botón "Guardar cambios"). Una vez despachado el envío este
    // campo queda deshabilitado y ya no dispara este listener.
    if (!despachado) {
      const inputFecha = document.getElementById('ficha-envio-fecha');
      const hintFecha = document.getElementById('ficha-envio-fecha-hint');
      inputFecha.addEventListener('change', async () => {
        const nuevaFecha = inputFecha.value || fechaHoyISO();
        inputFecha.value = nuevaFecha;
        inputFecha.disabled = true;
        try {
          await db.collection(COLECCION).doc(envio.id).update({ fechaEnvio: nuevaFecha });
          envio.fechaEnvio = nuevaFecha; // refleja el cambio en caché local de inmediato
          if (hintFecha) {
            hintFecha.style.display = 'block';
            setTimeout(() => { hintFecha.style.display = 'none'; }, 2000);
          }
        } catch (err) {
          console.error('Error guardando fecha de envío:', err);
          alert('No se pudo guardar la fecha de envío. Revisa la consola.');
        } finally {
          inputFecha.disabled = false;
        }
      });
    }

    if (!despachado) {
      fichaContenido.querySelectorAll('.btn-retirar-remision').forEach(btn => {
        btn.addEventListener('click', () => retirarRemision(parseInt(btn.dataset.idxRemision, 10)));
      });
      // Ítems huérfanos (sin equipo asociado): se retiran completos.
      fichaContenido.querySelectorAll('.btn-retirar-item').forEach(btn => {
        btn.addEventListener('click', () => retirarItemDeRemision(parseInt(btn.dataset.idxRemision, 10), parseInt(btn.dataset.idxItem, 10)));
      });
      // Equipos CON serial: se retira una unidad puntual.
      fichaContenido.querySelectorAll('.btn-retirar-unidad').forEach(btn => {
        btn.addEventListener('click', () => retirarUnidadDeItem(
          parseInt(btn.dataset.idxRemision, 10),
          parseInt(btn.dataset.idxItem, 10),
          parseInt(btn.dataset.unidad, 10)
        ));
      });
      // Equipos SIN serial: se retira la cantidad indicada en el input vecino.
      fichaContenido.querySelectorAll('.btn-retirar-cantidad').forEach(btn => {
        btn.addEventListener('click', () => {
          const input = btn.closest('.retirar-cantidad-control')?.querySelector('.input-retirar-cantidad');
          const max = input ? parseInt(input.max, 10) : 0;
          let cantidad = input ? parseInt(input.value, 10) : NaN;
          if (!Number.isFinite(cantidad) || cantidad < 1) cantidad = 1;
          if (max && cantidad > max) cantidad = max;
          retirarCantidadDeItem(parseInt(btn.dataset.idxRemision, 10), parseInt(btn.dataset.idxItem, 10), cantidad);
        });
      });
    }

    // "Ver ficha del pedido": clic en cualquiera de los chips de "Pedidos que
    // lo componen". Disponible siempre (armado o despachado); al cerrar esa
    // ficha, vuelve a abrirse esta misma.
    fichaContenido.querySelectorAll('.chip-pedido-envio[data-pedido-id]').forEach(chip => {
      chip.addEventListener('click', () => irAFichaPedido(chip.dataset.pedidoId));
    });

    btnCancelarEnvio.style.display = despachado ? 'none' : 'inline-block';
    btnGuardarEnvio.style.display = (!despachado || !remesaBloqueada) ? 'inline-block' : 'none';
    btnDespacharEnvio.style.display = despachado ? 'none' : 'inline-block';
    modalFicha.classList.add('open');
  }

  // Navega desde la ficha del envío a la ficha de uno de sus pedidos. No es
  // un "cierre" real de esta ficha (no dispara el retorno a volverAPedidoId,
  // si lo hubiera) — solo se oculta, y se le indica al pedido que, al
  // cerrarse, debe volver a abrir este mismo envío. Se le pasa también el
  // volverAPedidoId actual de este envío (si lo hay) para que, al volver,
  // esta ficha conserve su propia cadena de retorno hacia donde estaba antes.
  function irAFichaPedido(pedidoId) {
    if (!window.abrirFichaPedido) return;
    modalFicha.classList.remove('open');
    window.abrirFichaPedido(pedidoId, null, {
      volverAEnvioId: envioIdEnFicha,
      volverAEnvioOpciones: volverAPedidoId ? { volverAPedidoId } : null
    });
  }

  // Retira una remisión completa (con todos sus equipos) del envío.
  async function retirarRemision(idxRemision) {
    const ok = confirm('¿Retirar esta remisión completa del envío? Todos sus equipos volverán a quedar disponibles.');
    if (!ok) return;
    const idPedidoOrigen = volverAPedidoId;
    try {
      const envioRef = db.collection(COLECCION).doc(envioIdEnFicha);
      const snap = await envioRef.get();
      if (!snap.exists) return;
      const pedidosActuales = snap.data().pedidos || [];
      const nuevosPedidos = pedidosActuales.filter((_, i) => i !== idxRemision);
      await envioRef.update({ pedidos: nuevosPedidos });
      const envioActualizado = { id: envioIdEnFicha, ...snap.data(), pedidos: nuevosPedidos };
      abrirFicha(envioActualizado, { volverAPedidoId: idPedidoOrigen });
    } catch (err) {
      console.error('Error retirando remisión:', err);
      alert('No se pudo retirar la remisión. Revisa la consola.');
    }
  }

  // Retira un equipo específico de una remisión. Si era el último equipo de
  // esa remisión, se retira la remisión completa (ya quedaría vacía).
  async function retirarItemDeRemision(idxRemision, idxItem) {
    const ok = confirm('¿Retirar este equipo de la remisión? Vuelve a quedar disponible para otro envío.');
    if (!ok) return;
    const idPedidoOrigen = volverAPedidoId;
    try {
      const envioRef = db.collection(COLECCION).doc(envioIdEnFicha);
      const snap = await envioRef.get();
      if (!snap.exists) return;
      const pedidosActuales = snap.data().pedidos || [];
      let nuevosPedidos = pedidosActuales.map((p, i) => {
        if (i !== idxRemision) return p;
        const itemsRestantes = (p.items || []).filter((_, j) => j !== idxItem);
        return { ...p, items: itemsRestantes };
      });
      // Si la remisión se quedó sin equipos, se retira por completo.
      nuevosPedidos = nuevosPedidos.filter(p => (p.items || []).length > 0);
      await envioRef.update({ pedidos: nuevosPedidos });
      const envioActualizado = { id: envioIdEnFicha, ...snap.data(), pedidos: nuevosPedidos };
      abrirFicha(envioActualizado, { volverAPedidoId: idPedidoOrigen });
    } catch (err) {
      console.error('Error retirando equipo de la remisión:', err);
      alert('No se pudo retirar el equipo. Revisa la consola.');
    }
  }

  // Retira una sola unidad (por su índice/serial) de un ítem con serial. Si
  // era la última unidad de ese ítem, el ítem se retira por completo; si la
  // remisión se queda sin ítems, ella también se retira.
  async function retirarUnidadDeItem(idxRemision, idxItem, unidad) {
    const ok = confirm('¿Retirar esta unidad de la remisión? Vuelve a quedar disponible para otro envío.');
    if (!ok) return;
    const idPedidoOrigen = volverAPedidoId;
    try {
      const envioRef = db.collection(COLECCION).doc(envioIdEnFicha);
      const snap = await envioRef.get();
      if (!snap.exists) return;
      const pedidosActuales = snap.data().pedidos || [];
      let nuevosPedidos = pedidosActuales.map((p, i) => {
        if (i !== idxRemision) return p;
        const itemsActualizados = (p.items || []).map((it, j) => {
          if (j !== idxItem) return it;
          const unidadesRestantes = (it.unidades || []).filter(u => u !== unidad);
          return { ...it, unidades: unidadesRestantes, cantidad: unidadesRestantes.length };
        }).filter(it => (it.unidades ? it.unidades.length > 0 : (it.cantidad || 0) > 0));
        return { ...p, items: itemsActualizados };
      });
      nuevosPedidos = nuevosPedidos.filter(p => (p.items || []).length > 0);
      await envioRef.update({ pedidos: nuevosPedidos });
      const envioActualizado = { id: envioIdEnFicha, ...snap.data(), pedidos: nuevosPedidos };
      abrirFicha(envioActualizado, { volverAPedidoId: idPedidoOrigen });
    } catch (err) {
      console.error('Error retirando unidad de la remisión:', err);
      alert('No se pudo retirar la unidad. Revisa la consola.');
    }
  }

  // Retira una cantidad puntual de un ítem SIN serial (las unidades son
  // indistinguibles entre sí, así que solo importa el número, no cuál en
  // concreto). Si la cantidad a retirar cubre todo lo que llevaba, el ítem
  // se retira por completo; si la remisión se queda sin ítems, se retira ella.
  async function retirarCantidadDeItem(idxRemision, idxItem, cantidadARetirar) {
    if (!cantidadARetirar || cantidadARetirar < 1) return;
    const plural = cantidadARetirar > 1;
    const ok = confirm(`¿Retirar ${cantidadARetirar} unidad${plural ? 'es' : ''} de este equipo? Volverá${plural ? 'n' : ''} a quedar disponible${plural ? 's' : ''} para otro envío.`);
    if (!ok) return;
    const idPedidoOrigen = volverAPedidoId;
    try {
      const envioRef = db.collection(COLECCION).doc(envioIdEnFicha);
      const snap = await envioRef.get();
      if (!snap.exists) return;
      const pedidosActuales = snap.data().pedidos || [];
      let nuevosPedidos = pedidosActuales.map((p, i) => {
        if (i !== idxRemision) return p;
        const itemsActualizados = (p.items || []).map((it, j) => {
          if (j !== idxItem) return it;
          const nuevaCantidad = Math.max(0, (it.cantidad || 0) - cantidadARetirar);
          return { ...it, cantidad: nuevaCantidad };
        }).filter(it => (it.unidades ? it.unidades.length > 0 : (it.cantidad || 0) > 0));
        return { ...p, items: itemsActualizados };
      });
      nuevosPedidos = nuevosPedidos.filter(p => (p.items || []).length > 0);
      await envioRef.update({ pedidos: nuevosPedidos });
      const envioActualizado = { id: envioIdEnFicha, ...snap.data(), pedidos: nuevosPedidos };
      abrirFicha(envioActualizado, { volverAPedidoId: idPedidoOrigen });
    } catch (err) {
      console.error('Error retirando cantidad de la remisión:', err);
      alert('No se pudo retirar la cantidad. Revisa la consola.');
    }
  }

  window.abrirFichaEnvio = abrirFicha; // permite abrir la ficha de un envío desde pedidos.js

  function cerrarFicha() {
    modalFicha.classList.remove('open');
    envioIdEnFicha = null;
    if (volverAPedidoId && window.abrirFichaPedido) {
      const idPedido = volverAPedidoId;
      volverAPedidoId = null;
      window.abrirFichaPedido(idPedido, 'envio');
    } else {
      volverAPedidoId = null;
    }
  }

  btnCerrarFicha.addEventListener('click', cerrarFicha);
  modalFicha.addEventListener('click', (e) => {
    if (e.target === modalFicha) cerrarFicha();
  });

  btnDespacharEnvio.addEventListener('click', async () => {
    const envio = window.enviosCache.find(en => en.id === envioIdEnFicha);
    if (!envio) return;
    const ok = confirm('¿Marcar este envío como despachado? Los equipos que lleva quedarán marcados como completados y fijos, y ya no se podrán editar.');
    if (!ok) return;

    btnDespacharEnvio.disabled = true;
    try {
      await db.collection(COLECCION).doc(envio.id).update({
        estado: 'despachado',
        fechaDespacho: firebase.firestore.FieldValue.serverTimestamp(),
        // Si nunca se tocó el campo "Fecha de envío", queda congelada con la
        // fecha de hoy (el valor que ya se mostraba por defecto en la ficha).
        fechaEnvio: envio.fechaEnvio || fechaHoyISO()
      });

      // Marca en cada pedido involucrado los equipos/unidades que llevaba este
      // despacho como completados (y "preparado" si no lo estaba). Se trackea
      // por cantidad o por unidad individual, por si el ítem se reparte entre
      // varios envíos/remisiones parciales.
      const pedidoIds = [...new Set((envio.pedidos || []).map(p => p.pedidoId))];
      for (const pedidoId of pedidoIds) {
        const entradas = (envio.pedidos || []).filter(p => p.pedidoId === pedidoId);
        const pedidoRef = db.collection('pedidos').doc(pedidoId);
        const snap = await pedidoRef.get();
        if (!snap.exists) continue;

        const equipos = [...(snap.data().equipos || [])];
        entradas.forEach(entrada => {
          (entrada.items || []).forEach(it => {
            const item = equipos[it.itemIndex];
            if (!item) return;
            if (it.unidades && it.unidades.length) {
              const completadas = new Set(item.unidadesCompletadas || []);
              it.unidades.forEach(u => completadas.add(u));
              item.unidadesCompletadas = Array.from(completadas);
              // Las unidades que salen despachadas quedan también marcadas
              // como preparadas (ya se sabe exactamente cuáles son).
              const preparadas = new Set(item.unidadesPreparadas || []);
              it.unidades.forEach(u => preparadas.add(u));
              item.unidadesPreparadas = Array.from(preparadas);
            } else {
              const nuevoCompletado = Math.min(item.cantidad || 0, (item.cantidadCompletada || 0) + (it.cantidad || 0));
              item.cantidadCompletada = nuevoCompletado;
              // Equipo sin serial: no se sabe cuál unidad concreta salió, así
              // que se marcan como preparadas las unidades libres necesarias
              // (las de índice más bajo disponible) hasta cubrir lo despachado.
              const preparadasSet = new Set(item.unidadesPreparadas || []);
              let necesarias = nuevoCompletado - preparadasSet.size;
              for (let idx = 0; idx < (item.cantidad || 0) && necesarias > 0; idx++) {
                if (!preparadasSet.has(idx)) { preparadasSet.add(idx); necesarias--; }
              }
              item.unidadesPreparadas = Array.from(preparadasSet);
            }
          });
        });
        await pedidoRef.update({ equipos });
      }

      cerrarFicha();
    } catch (err) {
      console.error('Error despachando envío:', err);
      alert('No se pudo marcar como despachado. Revisa la consola.');
    } finally {
      btnDespacharEnvio.disabled = false;
    }
  });

  btnCancelarEnvio.addEventListener('click', async () => {
    const envio = window.enviosCache.find(en => en.id === envioIdEnFicha);
    if (!envio) return;
    const ok = confirm('¿Cancelar este envío? Se eliminará y los equipos que tenía reservados vuelven a quedar disponibles para otros envíos.');
    if (!ok) return;
    try {
      await db.collection(COLECCION).doc(envio.id).delete();
      cerrarFicha();
    } catch (err) {
      console.error('Error cancelando envío:', err);
      alert('No se pudo cancelar el envío. Revisa la consola.');
    }
  });

  btnGuardarEnvio.addEventListener('click', async () => {
    const envio = window.enviosCache.find(en => en.id === envioIdEnFicha);
    if (!envio) return;
    const despachado = envio.estado === 'despachado';

    const cambios = {};

    // Remesa: editable si está armado, o si está despachado pero sin remesa aún.
    const inputRemesa = document.getElementById('ficha-envio-remesa');
    if (inputRemesa && !inputRemesa.disabled) {
      cambios.remesa = inputRemesa.value.trim();
    }

    // El resto de campos solo se tocan si el envío sigue armado.
    if (!despachado) {
      const selectQuien = document.getElementById('ficha-envio-quien-encarga');
      const inputPersona = document.getElementById('ficha-envio-persona-recoge');
      const esInterno = selectQuien.value === 'interno';
      cambios.esInterno = esInterno;
      cambios.empresaEnvioId = esInterno ? null : selectQuien.value;
      cambios.personaRecoge = esInterno ? inputPersona.value.trim() : '';
      if (esInterno) cambios.remesa = ''; // Interno no maneja remesa
    }

    const btnOriginal = btnGuardarEnvio.textContent;
    btnGuardarEnvio.disabled = true;
    btnGuardarEnvio.textContent = 'Guardando...';
    try {
      const envioRef = db.collection(COLECCION).doc(envio.id);

      // Las remisiones se leen frescas de Firestore y se fusionan por pedidoId
      // + posición dentro de ese pedido (no por índice global), para no pisar
      // pedidos que otra sesión haya agregado a este mismo envío mientras esta
      // ficha estaba abierta, y para distinguir correctamente cuando un mismo
      // pedido tiene varias remisiones aquí.
      if (!despachado) {
        const snap = await envioRef.get();
        const pedidosFrescos = snap.exists ? (snap.data().pedidos || []) : [];
        const contadorPorPedido = {};
        cambios.pedidos = pedidosFrescos.map(pInfo => {
          const idxEnGrupo = contadorPorPedido[pInfo.pedidoId] || 0;
          contadorPorPedido[pInfo.pedidoId] = idxEnGrupo + 1;
          const input = fichaContenido.querySelector(`.input-remision-envio[data-pedidoid="${pInfo.pedidoId}"][data-grupo-idx="${idxEnGrupo}"]`);
          return input ? { ...pInfo, remision: input.value.trim() } : pInfo;
        });
      }

      await envioRef.update(cambios);
      cerrarFicha();
    } catch (err) {
      console.error('Error guardando cambios del envío:', err);
      alert('No se pudo guardar. Revisa la consola.');
    } finally {
      btnGuardarEnvio.disabled = false;
      btnGuardarEnvio.textContent = btnOriginal;
    }
  });

  // ---------- Suscripción en tiempo real ----------
  // Arranca de inmediato (no solo al entrar a la pestaña), porque pedidos.js
  // depende de este catálogo para saber a qué envíos ya está vinculado un pedido.

  db.collection(COLECCION).onSnapshot(
    (snapshot) => {
      window.enviosCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      renderTabla();
      difundirCambio();
    },
    (err) => {
      console.error('Error escuchando envíos:', err);
    }
  );

  document.addEventListener('clientes:cambio', renderTabla);
  document.addEventListener('equipos-catalogo:cambio', renderTabla);
  document.addEventListener('empresas-envio:cambio', renderTabla);
  document.addEventListener('pedidos:cambio', renderTabla);
})();
