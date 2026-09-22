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

  const listaContenedor = document.getElementById('envios-cards');
  const tablaEmpty = document.getElementById('envios-empty');
  const chipsEstado = document.querySelectorAll('#filtro-estado-envios .chip-filtro-estado');
  const selectEmpresaFiltro = document.getElementById('filtro-empresa-envios');
  const inputBusqueda = document.getElementById('buscador-envios');
  const resultadosBusqueda = document.getElementById('resultados-buscador-envios');
  const btnFiltroFletePendiente = document.getElementById('filtro-flete-pendiente');
  const btnFiltroSinCotizacion = document.getElementById('filtro-sin-cotizacion');
  const btnOrdenFecha = document.getElementById('btn-orden-fecha-envios');

  const modalFicha = document.getElementById('modal-ficha-envio');
  const fichaTitulo = document.getElementById('ficha-envio-titulo');
  const fichaSubtitulo = document.getElementById('ficha-envio-subtitulo');
  const fichaEstadoTag = document.getElementById('ficha-envio-estado-tag');
  const fichaContenido = document.getElementById('ficha-envio-contenido');
  const btnCerrarFicha = document.getElementById('btn-cerrar-ficha-envio');
  const btnDespacharEnvio = document.getElementById('btn-despachar-envio');
  const btnCancelarEnvio = document.getElementById('btn-cancelar-envio');
  const btnGuardarEnvio = document.getElementById('btn-guardar-envio');
  const btnDescargarRemesa = document.getElementById('btn-descargar-remesa');
  const btnCompartirRemesaWhatsapp = document.getElementById('btn-compartir-remesa-whatsapp');
  const remesaExportHost = document.getElementById('remesa-export-host');

  // ---------- Simulaciones de envío ----------
  const COLECCION_SIMULACIONES = 'simulaciones';
  const panelSubtabButtons = document.querySelectorAll('#envios-panel-subtabs .subtab-btn');
  const simulacionesContenedor = document.getElementById('simulaciones-cards');
  const simulacionesEmpty = document.getElementById('simulaciones-empty');
  const btnNuevaSimulacion = document.getElementById('btn-nueva-simulacion');

  const modalFichaSimulacion = document.getElementById('modal-ficha-simulacion');
  const inputNombreSimulacion = document.getElementById('simulacion-nombre-input');
  const pesoValorSimulacion = document.getElementById('simulacion-peso-valor');
  const advertenciaPesoSimulacion = document.getElementById('simulacion-advertencia-peso');
  const itemsListaSimulacion = document.getElementById('simulacion-items-lista');
  const itemsEmptySimulacion = document.getElementById('simulacion-items-empty');
  const btnCerrarFichaSimulacion = document.getElementById('btn-cerrar-ficha-simulacion');
  const btnEliminarSimulacion = document.getElementById('btn-eliminar-simulacion');

  const btnAbrirAgregarPedido = document.getElementById('btn-simulacion-agregar-pedido');
  const panelAgregarPedido = document.getElementById('simulacion-panel-agregar-pedido');
  const selectPedidoSimulacion = document.getElementById('simulacion-select-pedido');
  const checklistPedidoSimulacion = document.getElementById('simulacion-pedido-items-checklist');
  const btnCancelarAgregarPedido = document.getElementById('btn-cancelar-simulacion-agregar-pedido');
  const btnConfirmarAgregarPedido = document.getElementById('btn-confirmar-simulacion-agregar-pedido');

  const btnAbrirAgregarSuelto = document.getElementById('btn-simulacion-agregar-suelto');
  const panelAgregarSuelto = document.getElementById('simulacion-panel-agregar-suelto');
  const selectTipoSuelto = document.getElementById('simulacion-suelto-tipo-filtro');
  const selectEquipoSuelto = document.getElementById('simulacion-suelto-equipo');
  const inputCantidadSuelto = document.getElementById('simulacion-suelto-cantidad');
  const btnCancelarAgregarSuelto = document.getElementById('btn-cancelar-simulacion-agregar-suelto');
  const btnConfirmarAgregarSuelto = document.getElementById('btn-confirmar-simulacion-agregar-suelto');

  let simulacionesCache = [];
  let simulacionIdEnFicha = null;

  window.enviosCache = [];
  let envioIdEnFicha = null;
  let volverAPedidoId = null; // si la ficha se abrió desde dentro de un pedido, aquí queda su id
  let filtroEstadoActivo = 'armado'; // '' = todos | 'armado' | 'despachado' — por defecto se abre viendo solo los armados
  let filtroEmpresaActivo = '';  // '' = todos | 'interno' | id de empresa de envío
  let filtroFletePendienteActivo = false; // true = solo empresas que dan recibo y todavía no se confirma el flete
  let filtroSinCotizacionActivo = false; // true = solo envíos (no internos) sin ningún valor de flete/cotización guardado
  let ordenFechaDireccion = 'desc'; // 'desc' = más recientes primero (mayor a menor) | 'asc' = más antiguos primero

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(str) {
    return String(str ?? '').replace(/"/g, '&quot;');
  }

  // Quita tildes y pasa a minúsculas, para que la búsqueda no dependa de
  // mayúsculas ni acentos (ej: "mosquera" encuentra "Mosquera").
  function normalizar(str) {
    return String(str ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  // Cadena se cuenta por metros, no por unidades enteras — mismo criterio
  // que en pedidos.js, para que "retirar cantidad" acepte decimales ahí
  // también.
  const TIPOS_CON_CANTIDAD_DECIMAL = ['cadena'];
  function esTipoCantidadDecimal(equipo) {
    if (!equipo) return false;
    const tipo = buscarTipoEquipo(equipo.tipoId);
    return !!tipo && TIPOS_CON_CANTIDAD_DECIMAL.includes(normalizar(tipo.nombre));
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

  // 'YYYY-MM-DD' -> 'DD/MM/AAAA', para mostrarla en el encabezado de la ficha.
  function formatearFechaCorta(fechaISO) {
    if (!fechaISO) return '';
    const [yyyy, mm, dd] = fechaISO.split('-');
    if (!yyyy || !mm || !dd) return fechaISO;
    return `${dd}/${mm}/${yyyy}`;
  }

  // Formatea un número como pesos colombianos: 350000 -> "$ 350.000".
  function formatearCOP(valor) {
    const n = parseFloat(valor);
    if (isNaN(n)) return '';
    return '$ ' + Math.round(n).toLocaleString('es-CO');
  }

  // Toma cualquier texto (ya formateado con puntos de miles o no) y devuelve
  // el número entero que representa, o null si quedó vacío. Se descartan
  // TODOS los caracteres no numéricos (incluido el punto), porque en
  // formato colombiano el punto es separador de miles, no decimal.
  function parsearCOP(texto) {
    const soloDigitos = String(texto ?? '').replace(/\D/g, '');
    return soloDigitos ? parseInt(soloDigitos, 10) : null;
  }

  // La pestaña Cotización solo tiene sentido para envíos con transportadora
  // (no Interno); y el paso extra de "confirmar recibo" solo aplica si esa
  // transportadora está marcada en Config como que sí da recibo/factura.
  function empresaDaRecibo(envio) {
    if (envio.esInterno) return false;
    const empresa = (window.empresasEnvioCache || []).find(e => e.id === envio.empresaEnvioId);
    return !!empresa?.daRecibo;
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

  // Peso unitario (kg) de un equipo del catálogo. Si es un equipo compuesto
  // (ej. un acople armado de varias piezas), suma peso x cantidad de cada
  // pieza; las piezas sin peso configurado simplemente no suman (no rompen
  // el total, a diferencia de la ficha de equipos que sí exige tenerlo).
  function pesoUnitarioEquipo(equipo) {
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

  // Peso (kg) que aportan las piezas de brazo de reacción/eje sólido/flanche
  // de salida elegidas en un ítem (si marcó alguna casilla y le asoció una
  // pieza real del catálogo). No se multiplica por cantidad acá.
  function pesoExtrasItem(item) {
    let total = 0;
    if (item?.llevaBrazo && item.brazoEquipoId) total += pesoUnitarioEquipo(buscarEquipoCatalogo(item.brazoEquipoId));
    if (item?.llevaEje && item.ejeEquipoId) total += pesoUnitarioEquipo(buscarEquipoCatalogo(item.ejeEquipoId));
    if (item?.llevaFlanche && item.flancheEquipoId) total += pesoUnitarioEquipo(buscarEquipoCatalogo(item.flancheEquipoId));
    return total;
  }

  // Peso (kg) de un solo ítem de una remisión (it.itemIndex / it.cantidad /
  // it.unidades), buscando el equipo real en el pedido para tomar su peso
  // del catálogo. Los ítems sin peso configurado, o huérfanos (el equipo ya
  // no existe en el pedido), simplemente no suman nada.
  function pesoItem(pedido, it) {
    const item = pedido?.equipos?.[it.itemIndex];
    if (!item) return 0;
    const cantidad = (it.unidades && it.unidades.length) ? it.unidades.length : (it.cantidad || 0);

    let pesoUnitario = 0;
    if (item.tipoLinea === 'motoreductor') {
      const equipoMotor = buscarEquipoCatalogo(item.motorEquipoId);
      const equipoReductor = buscarEquipoCatalogo(item.reductorEquipoId);
      pesoUnitario = pesoUnitarioEquipo(equipoMotor) + pesoUnitarioEquipo(equipoReductor);
    } else {
      const equipo = buscarEquipoCatalogo(item.equipoId);
      pesoUnitario = pesoUnitarioEquipo(equipo);
    }
    pesoUnitario += pesoExtrasItem(item);
    return pesoUnitario * cantidad;
  }

  // Peso total (kg) de todo lo que lleva un envío, sumando los ítems de
  // todas sus remisiones/pedidos.
  function pesoTotalEnvio(envio) {
    return (envio.pedidos || []).reduce((total, pInfo) => {
      const pedido = buscarPedido(pInfo.pedidoId);
      const pesoRemision = (pInfo.items || []).reduce((sub, it) => sub + pesoItem(pedido, it), 0);
      return total + pesoRemision;
    }, 0);
  }

  // Texto "N41 - Edisatech Planta Mosquera, N40 - Contegral..." con los
  // pedidos distintos incluidos en el envío (uno por pedidoId, sin repetir
  // aunque tenga varias remisiones dentro del mismo envío).
  function textoPedidosIncluidos(envio) {
    const vistos = new Set();
    const nombres = [];
    (envio.pedidos || []).forEach(pInfo => {
      if (vistos.has(pInfo.pedidoId)) return;
      vistos.add(pInfo.pedidoId);
      const pedido = buscarPedido(pInfo.pedidoId);
      if (!pedido) { nombres.push('Pedido no encontrado'); return; }
      const compania = buscarCompania(pedido.companiaId);
      nombres.push(`N${pedido.numero} - ${escapeHtml(compania ? compania.nombre : 'Compañía no encontrada')}`);
    });
    return nombres.join(', ') || 'Sin pedidos';
  }

  // Números de remisión distintos dentro del envío (una remisión puede
  // agrupar varios pedidos, así que se cuenta/lista una sola vez cada una).
  function remisionesDistintas(envio) {
    const vistas = new Set();
    (envio.pedidos || []).forEach(pInfo => {
      const remision = (pInfo.remision || '').trim();
      if (remision) vistas.add(remision);
    });
    return [...vistas];
  }

  // Concatenación normalizada (sin tildes, minúsculas) de todo lo buscable
  // de un envío: números de pedido, cliente(s), remesa/encargado y
  // remisiones — usada para el filtro en vivo del buscador.
  function textoBusquedaEnvio(envio) {
    const partes = [];
    (envio.pedidos || []).forEach(pInfo => {
      const pedido = buscarPedido(pInfo.pedidoId);
      if (pedido) {
        partes.push(String(pedido.numero));
        const compania = buscarCompania(pedido.companiaId);
        if (compania) partes.push(compania.nombre);
      }
      if (pInfo.remision) partes.push(pInfo.remision);
    });
    if (envio.esInterno) {
      if (envio.personaRecoge) partes.push(envio.personaRecoge);
    } else {
      if (envio.remesa) partes.push(envio.remesa);
      const empresa = (window.empresasEnvioCache || []).find(e => e.id === envio.empresaEnvioId);
      if (empresa) partes.push(empresa.nombre);
    }
    return normalizar(partes.join(' '));
  }

  function coincideBusqueda(envio, termino) {
    if (!termino) return true;
    return textoBusquedaEnvio(envio).includes(normalizar(termino));
  }

  // Sugerencias a NIVEL DE ENVÍO: por cada envío que tenga algún dato
  // (pedido, cliente, remesa o remisión) que coincida con lo escrito, arma
  // una sugerencia con ese dato como texto principal y el envío al que
  // pertenece, para poder abrir su ficha directamente al hacer click.
  function generarSugerencias(termino) {
    const t = normalizar(termino);
    if (!t) return [];
    const sugerencias = [];

    window.enviosCache.forEach(envio => {
      let match = null;

      for (const pInfo of (envio.pedidos || [])) {
        const pedido = buscarPedido(pInfo.pedidoId);
        if (pedido) {
          const compania = buscarCompania(pedido.companiaId);
          const nombrePedido = `N${pedido.numero} - ${compania ? compania.nombre : 'Compañía no encontrada'}`;
          if (!match && normalizar(nombrePedido).includes(t)) match = { tipo: 'Pedido', texto: nombrePedido };
          if (!match && compania && normalizar(compania.nombre).includes(t)) match = { tipo: 'Cliente', texto: compania.nombre };
        }
        if (!match && pInfo.remision && normalizar(pInfo.remision).includes(t)) match = { tipo: 'Remisión', texto: pInfo.remision };
        if (match) break;
      }

      if (!match && !envio.esInterno && envio.remesa && normalizar(envio.remesa).includes(t)) {
        match = { tipo: 'Remesa', texto: envio.remesa };
      }

      if (match) sugerencias.push({ ...match, envioId: envio.id });
    });

    return sugerencias.slice(0, 8);
  }

  function renderSugerencias() {
    const termino = inputBusqueda.value.trim();
    if (!termino) {
      resultadosBusqueda.innerHTML = '';
      resultadosBusqueda.classList.remove('open');
      return;
    }
    const sugerencias = generarSugerencias(termino);
    resultadosBusqueda.innerHTML = sugerencias.length
      ? sugerencias.map(s => {
          const envio = window.enviosCache.find(en => en.id === s.envioId);
          const quienEncarga = envio ? nombreQuienEncarga(envio).replace(/<[^>]+>/g, '') : '';
          const estadoTexto = envio?.estado === 'despachado' ? 'Despachado' : 'Armado';
          return `
            <div class="buscador-item" data-envio-id="${s.envioId}">
              <span class="buscador-item-tipo">${s.tipo}</span>${escapeHtml(s.texto)}
              <span class="buscador-item-sub">${escapeHtml(quienEncarga)} · ${estadoTexto}</span>
            </div>
          `;
        }).join('')
      : '<div class="buscador-item-vacio">Sin coincidencias</div>';

    resultadosBusqueda.querySelectorAll('.buscador-item').forEach(el => {
      el.addEventListener('click', () => {
        const envio = window.enviosCache.find(en => en.id === el.dataset.envioId);
        resultadosBusqueda.classList.remove('open');
        inputBusqueda.value = '';
        renderTabla();
        if (envio) abrirFicha(envio);
      });
    });
    resultadosBusqueda.classList.add('open');
  }

  inputBusqueda.addEventListener('input', () => {
    renderSugerencias();
    renderTabla();
  });
  inputBusqueda.addEventListener('focus', renderSugerencias);
  document.addEventListener('click', (e) => {
    if (!inputBusqueda.contains(e.target) && !resultadosBusqueda.contains(e.target)) {
      resultadosBusqueda.classList.remove('open');
    }
  });

  // ---------- Filtro por estado (chips) ----------

  chipsEstado.forEach(btn => {
    btn.addEventListener('click', () => {
      chipsEstado.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filtroEstadoActivo = btn.dataset.estado;
      renderTabla();
    });
  });

  // ---------- Filtro por quién se encarga (select según empresas de envío) ----------

  function renderOpcionesFiltroEmpresa() {
    const anterior = selectEmpresaFiltro.value;
    const empresas = window.empresasEnvioCache || [];
    selectEmpresaFiltro.innerHTML = '<option value="">Quién se encarga: todos</option>' +
      '<option value="interno">🏠 Interno</option>' +
      empresas.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)}</option>`).join('');
    if ([...selectEmpresaFiltro.options].some(o => o.value === anterior)) {
      selectEmpresaFiltro.value = anterior;
    } else {
      filtroEmpresaActivo = '';
    }
  }

  selectEmpresaFiltro.addEventListener('change', () => {
    filtroEmpresaActivo = selectEmpresaFiltro.value;
    renderTabla();
  });

  btnFiltroFletePendiente.addEventListener('click', () => {
    filtroFletePendienteActivo = !filtroFletePendienteActivo;
    btnFiltroFletePendiente.classList.toggle('active', filtroFletePendienteActivo);
    renderTabla();
  });

  btnFiltroSinCotizacion.addEventListener('click', () => {
    filtroSinCotizacionActivo = !filtroSinCotizacionActivo;
    btnFiltroSinCotizacion.classList.toggle('active', filtroSinCotizacionActivo);
    renderTabla();
  });

  // ---------- Orden por fecha de envío ----------
  btnOrdenFecha.addEventListener('click', () => {
    ordenFechaDireccion = ordenFechaDireccion === 'desc' ? 'asc' : 'desc';
    btnOrdenFecha.textContent = ordenFechaDireccion === 'desc' ? '📅 Recientes primero ↓' : '📅 Antiguos primero ↑';
    renderTabla();
  });

  // ---------- Render de la lista principal (tarjetas) ----------

  function renderTabla() {
    const termino = inputBusqueda.value.trim();
    const lista = window.enviosCache.filter(envio => {
      if (filtroEstadoActivo && envio.estado !== filtroEstadoActivo) return false;
      if (filtroEmpresaActivo === 'interno' && !envio.esInterno) return false;
      if (filtroEmpresaActivo && filtroEmpresaActivo !== 'interno' && (envio.esInterno || envio.empresaEnvioId !== filtroEmpresaActivo)) return false;
      if (filtroFletePendienteActivo && !(empresaDaRecibo(envio) && !envio.fleteConfirmado)) return false;
      // "Sin cotización" = todavía no se ha guardado NINGÚN valor de flete
      // (ni siquiera un estimado) — no aplica a envíos internos, que no
      // tienen sección de Cotización.
      if (filtroSinCotizacionActivo && (envio.esInterno || envio.costoFlete != null)) return false;
      if (!coincideBusqueda(envio, termino)) return false;
      return true;
    });

    if (!lista.length) {
      listaContenedor.innerHTML = '';
      tablaEmpty.style.display = 'block';
      return;
    }
    tablaEmpty.style.display = 'none';

    const ordenados = [...lista].sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === 'armado' ? -1 : 1;
      const fa = a.fechaEnvio || '';
      const fb = b.fechaEnvio || '';
      if (fa === fb) return 0;
      return ordenFechaDireccion === 'desc' ? (fa < fb ? 1 : -1) : (fa < fb ? -1 : 1);
    });

    listaContenedor.innerHTML = ordenados.map(envio => {
      const estadoHtml = envio.estado === 'despachado'
        ? '<span class="envio-card-estado estado-despachado">🚚 Despachado</span>'
        : '<span class="envio-card-estado estado-armado">📦 Armado</span>';

      const icono = envio.esInterno ? '🏠' : '🚛';
      const tagInterno = envio.esInterno ? '<span class="tag-interno">INTERNO</span>' : '';
      const nombre = envio.esInterno ? 'INTERNO' : nombreQuienEncarga(envio);

      const detalleEncargado = envio.esInterno
        ? (envio.personaRecoge ? `· Encargado: ${escapeHtml(envio.personaRecoge)} ·` : '· Sin encargado aún ·')
        : (envio.remesa ? `· Remesa: ${escapeHtml(envio.remesa)} ·` : '· Sin remesa asignada ·');

      const remisiones = remisionesDistintas(envio);
      const cantidadRemisiones = remisiones.length;
      const peso = pesoTotalEnvio(envio);
      const fechaMostrable = formatearFechaCorta(envio.fechaEnvio || fechaHoyISO());

      let fleteTexto = '';
      if (!envio.esInterno && envio.costoFlete != null) {
        const iconoFlete = empresaDaRecibo(envio) ? (envio.fleteConfirmado ? ' ✅' : ' ⏳') : '';
        fleteTexto = ` · 💰 ${formatearCOP(envio.costoFlete)}${iconoFlete}`;
      }

      const resumen = `📅 ${fechaMostrable} · Pedidos: ${textoPedidosIncluidos(envio)} · ${cantidadRemisiones} ${cantidadRemisiones === 1 ? 'remisión' : 'remisiones'} · ⚖️ ${peso.toFixed(2)} kg${fleteTexto}`;

      const chipsHtml = remisiones.length
        ? remisiones.map(r => `<span class="chip-remision">Remisión ${escapeHtml(r)}</span>`).join('')
        : '<span class="chip-remision">Sin remisión asignada</span>';

      return `
        <div class="envio-card" data-id="${envio.id}">
          <div class="envio-card-header">
            <span class="envio-card-icono">${icono}</span>
            <span class="envio-card-nombre">${nombre}</span>
            ${tagInterno}
            <span class="envio-card-detalle-encargado">${detalleEncargado}</span>
            ${estadoHtml}
          </div>
          <div class="envio-card-resumen">${resumen}</div>
          <div class="envio-card-chips">${chipsHtml}</div>
        </div>
      `;
    }).join('');

    listaContenedor.querySelectorAll('.envio-card').forEach(card => {
      card.addEventListener('click', () => {
        const envio = window.enviosCache.find(en => en.id === card.dataset.id);
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
    const subtituloBase = envio.esInterno
      ? (envio.personaRecoge ? `Recoge: ${envio.personaRecoge}` : 'Interno — sin encargado aún')
      : (envio.remesa ? `Remesa ${envio.remesa}` : 'Sin remesa asignada');
    const fechaMostrable = formatearFechaCorta(envio.fechaEnvio || fechaHoyISO());
    fichaSubtitulo.textContent = `${subtituloBase} · Fecha de envío: ${fechaMostrable}`;
    fichaEstadoTag.innerHTML = despachado
      ? '<span class="tag-envio-despachado">Despachado</span>'
      : '<span class="tag-envio-armado">Armado</span>';

    const pedidosIncluidos = envio.pedidos || [];

    // Agrupa las entradas por pedidoId conservando el índice ORIGINAL de
    // cada una dentro de envio.pedidos (idxRemision se sigue usando tal
    // cual para retirar equipos/remisiones sin tocar las demás). Así, un
    // mismo pedido con 2+ remisiones en este envío aparece en una sola
    // tarjeta, con una sub-tarjeta por remisión.
    const grupos = [];
    const grupoPorPedido = new Map();
    pedidosIncluidos.forEach((pInfo, idxRemision) => {
      let grupo = grupoPorPedido.get(pInfo.pedidoId);
      if (!grupo) {
        grupo = { pedidoId: pInfo.pedidoId, entradas: [] };
        grupoPorPedido.set(pInfo.pedidoId, grupo);
        grupos.push(grupo);
      }
      grupo.entradas.push({ pInfo, idxRemision, idxEnGrupo: grupo.entradas.length });
    });

    const filas = grupos.map(grupo => {
      const pedido = buscarPedido(grupo.pedidoId);
      const compania = pedido ? buscarCompania(pedido.companiaId) : null;
      const nombreCompania = compania ? escapeHtml(compania.nombre) : 'Compañía no encontrada';
      const nombrePedido = pedido ? `N${pedido.numero} - ${nombreCompania}` : 'Pedido no encontrado';

      // Datos del pedido (Cliente / Encargado / Tipo) — solo si el pedido
      // todavía existe; si fue borrado, se omite este bloque. Se calculan
      // una sola vez por pedido (ya no por cada remisión).
      const tipoInfo = pedido ? (TIPO_PEDIDO_LABEL[pedido.tipo] || TIPO_PEDIDO_LABEL.normal) : null;
      const contacto = pedido?.contacto ? escapeHtml(pedido.contacto) : '— (sin asignar)';
      const tipoValorHtml = tipoInfo ? `${tipoInfo.icono} ${tipoInfo.texto}` : '';
      const datosHtml = pedido ? `
        <div class="remision-card-datos">
          <div class="remision-dato"><span class="remision-dato-label">Cliente:</span><span class="remision-dato-valor">${nombreCompania}</span></div>
          <div class="remision-dato"><span class="remision-dato-label">Encargado:</span><span class="remision-dato-valor">${contacto}</span></div>
          <div class="remision-dato"><span class="remision-dato-label">Tipo de pedido:</span><span class="${tipoInfo.clase}">${tipoValorHtml}</span></div>
        </div>
      ` : '';

      const btnVerPedido = pedido ? `<button type="button" class="chip-ver-pedido btn-ver-pedido" data-pedido-id="${pedido.id}">📋 Ver ficha del pedido</button>` : '';

      const subCardsHtml = grupo.entradas.map(({ pInfo, idxRemision, idxEnGrupo }) => {
        const itemsHtml = (pInfo.items || []).map((it, idxItem) => {
          const item = pedido?.equipos?.[it.itemIndex];

          if (!item) {
            // Ítem huérfano (ya no existe en el pedido): no hay forma de saber
            // su tipo, así que solo se puede retirar por completo.
            const detalleCantidad = it.unidades ? `unidad(es): ${it.unidades.map(u => u + 1).join(', ')}` : `cant. ${it.cantidad}`;
            const btnRetirarItem = despachado ? '' : `<button type="button" class="btn-retirar-item" data-idx-remision="${idxRemision}" data-idx-item="${idxItem}" title="Retirar este equipo de la remisión">✕</button>`;
            return `<div class="item-linea"><span>⚠️ Ítem no encontrado</span><span style="display:flex; align-items:center; gap:6px;">${detalleCantidad}${btnRetirarItem}</span></div>`;
          }

          // El ícono de cada equipo es el que se configuró en Config para
          // su tipo (mismo catálogo/ícono que se ve en la pestaña Equipos).
          // Los extras (brazo/eje/flanche) van siempre sobre el reductor —
          // igual que se decide en pedidos.js — porque son piezas propias de
          // él, no del motor.
          const extras = [
            item.llevaBrazo ? '+ Brazo de reacción' : '',
            item.llevaEje ? '+ Eje sólido' : '',
            item.llevaFlanche ? '+ Flanche de salida' : ''
          ].filter(Boolean).map(t => ` ${t}`).join('');

          let nombre;
          if (item.tipoLinea === 'motoreductor') {
            const equipoMotor = buscarEquipoCatalogo(item.motorEquipoId);
            const equipoReductor = buscarEquipoCatalogo(item.reductorEquipoId);
            const iconoMotor = buscarTipoEquipo(equipoMotor?.tipoId)?.icono || '';
            const iconoReductor = buscarTipoEquipo(equipoReductor?.tipoId)?.icono || '';
            nombre = `${iconoMotor ? iconoMotor + ' ' : ''}${equipoMotor?.nombre || '?'} + ${iconoReductor ? iconoReductor + ' ' : ''}${equipoReductor?.nombre || '?'}${extras}`;
          } else {
            const equipo = buscarEquipoCatalogo(item.equipoId);
            const icono = buscarTipoEquipo(equipo?.tipoId)?.icono || '';
            nombre = `${icono ? icono + ' ' : ''}${equipo?.nombre || 'Equipo no encontrado'}${extras}`;
          }

          // Equipo CON serial: se sabe exactamente cuál unidad es cuál, así que
          // cada una se lista y se retira por separado.
          if (it.unidades && it.unidades.length) {
            return it.unidades.map(u => {
              const btnRetirarUnidad = despachado ? '' : `<button type="button" class="btn-retirar-unidad" data-idx-remision="${idxRemision}" data-idx-item="${idxItem}" data-unidad="${u}" title="Retirar esta unidad de la remisión">✕</button>`;
              return `<div class="item-linea"><span>${nombre}</span><span style="display:flex; align-items:center; gap:6px;">🆔 ${etiquetaUnidadEnvio(item, u)}${btnRetirarUnidad}</span></div>`;
            }).join('');
          }

          // Equipo SIN serial: las unidades son indistinguibles entre sí, así
          // que se retira por cantidad (puede ser parcial, no solo todo o nada).
          // Cadena se cuenta por metros, así que su cantidad admite decimales.
          const equipoParaDecimal = item.tipoLinea === 'individual' ? buscarEquipoCatalogo(item.equipoId) : null;
          const esDecimal = esTipoCantidadDecimal(equipoParaDecimal);
          const controlCantidad = despachado ? '' : `
                <span class="retirar-cantidad-control">
                  <input type="number" class="input-retirar-cantidad" min="${esDecimal ? '0.01' : '1'}" step="${esDecimal ? '0.01' : '1'}" max="${it.cantidad}" value="${it.cantidad}" title="Cantidad a retirar">
                  <button type="button" class="btn-retirar-cantidad" data-idx-remision="${idxRemision}" data-idx-item="${idxItem}" title="Retirar esta cantidad de la remisión">✕</button>
                </span>`;
          return `<div class="item-linea"><span>${nombre}</span><span style="display:flex; align-items:center; gap:6px;">cant. ${it.cantidad}${controlCantidad}</span></div>`;
        }).join('');

        const btnRetirarRemision = despachado ? '' : `<button type="button" class="btn-retirar-remision" data-idx-remision="${idxRemision}" title="Retirar esta remisión completa, con todos sus equipos">🗑️ Retirar remisión</button>`;

        return `
          <div class="remision-sub-card">
            <div class="remision-sub-card-header">
              <span class="remision-sub-card-titulo">
                Remisión:
                <span class="remision-numero-wrap">
                  <button type="button" class="remision-card-numero" data-pedidoid="${pInfo.pedidoId}" data-grupo-idx="${idxEnGrupo}" ${despachado ? 'disabled' : ''}>${escapeHtml(pInfo.remision || '—')}${despachado ? '' : ' ✏️'}</button>
                  <div class="remision-popover" data-pedidoid="${pInfo.pedidoId}">
                    <label>Número de remisión</label>
                    <input type="text" class="input-remision-envio" data-pedidoid="${pInfo.pedidoId}" data-grupo-idx="${idxEnGrupo}" value="${escapeHtml(pInfo.remision || '')}" ${despachado ? 'disabled' : ''}>
                  </div>
                </span>
              </span>
              <span class="remision-toggle-arrow" title="Colapsar / expandir">▲</span>
            </div>
            <div class="remision-sub-card-body">
              <div class="remision-card-items">${itemsHtml || 'Sin equipos'}</div>
              ${btnRetirarRemision ? `<div class="remision-sub-card-footer">${btnRetirarRemision}</div>` : ''}
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="remision-card">
          <div class="remision-card-header">
            <span class="remision-card-titulo"><span class="remision-card-icono">📄</span>${nombrePedido}</span>
            <span class="remision-toggle-arrow" title="Colapsar / expandir">▲</span>
          </div>
          <div class="remision-card-body">
            ${btnVerPedido}
            ${datosHtml}
            ${subCardsHtml}
          </div>
        </div>
      `;
    }).join('');

    const daRecibo = empresaDaRecibo(envio);
    const flete = envio.costoFlete;
    const fleteConfirmado = !!envio.fleteConfirmado;

    const cotizacionHtml = envio.esInterno ? '' : `
      <div class="form-group">
        <label>${daRecibo ? (fleteConfirmado ? 'Valor del flete (facturado)' : 'Valor cotizado (estimado)') : 'Valor del flete (COP)'}</label>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-weight:600; color:var(--ink-soft);">$</span>
          <input type="text" id="ficha-envio-flete" inputmode="numeric" value="${flete != null ? Number(flete).toLocaleString('es-CO') : ''}" placeholder="Ej: 350.000" style="flex:1;" ${daRecibo && fleteConfirmado ? 'disabled' : ''}>
          ${daRecibo && fleteConfirmado ? '' : '<button type="button" class="btn secondary" id="btn-guardar-flete" style="white-space:nowrap;">💾 Guardar</button>'}
        </div>
        <div class="hint-peso-calculado" id="ficha-envio-flete-hint" style="display:none;">Guardado ✓</div>
      </div>
      ${daRecibo ? `
        <div class="form-group" style="display:flex; align-items:center; gap:10px;">
          ${fleteConfirmado
            ? `<span class="tag-envio-despachado">✅ Facturado</span><button type="button" class="btn secondary" id="btn-corregir-flete">✏️ Corregir</button>`
            : `<span class="tag-envio-armado">⏳ Cotizado, pendiente de recibo</span><button type="button" class="btn secondary" id="btn-confirmar-flete" ${flete == null ? 'disabled' : ''}>✅ Confirmar recibo</button>`
          }
        </div>
        <div class="hint-peso-calculado" style="display:block;">Esta transportadora factura después de despachar: cotiza el estimado ahora y confírmalo cuando llegue el recibo.</div>
      ` : ''}
    `;

    fichaContenido.innerHTML = `
      ${envio.esInterno ? '' : `
        <div class="subtabs">
          <button type="button" class="subtab-btn active" data-subtab="envio-datos">Datos</button>
          <button type="button" class="subtab-btn" data-subtab="envio-cotizacion">💰 Cotización</button>
        </div>
      `}
      <div class="subtab-panel active" id="subtab-envio-datos">
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

        <h4 style="margin-top:18px;">Pedidos incluidos</h4>
        <div class="remisiones-frame">
          ${filas || '<div class="empty-equipos-pedido">Sin pedidos.</div>'}
        </div>
      </div>
      ${envio.esInterno ? '' : `<div class="subtab-panel" id="subtab-envio-cotizacion">${cotizacionHtml}</div>`}
    `;

    const subtabBtnsFicha = fichaContenido.querySelectorAll('.subtab-btn');
    const subtabPanelsFicha = fichaContenido.querySelectorAll('.subtab-panel');
    subtabBtnsFicha.forEach(btn => {
      btn.addEventListener('click', () => {
        subtabBtnsFicha.forEach(b => b.classList.toggle('active', b === btn));
        subtabPanelsFicha.forEach(p => p.classList.toggle('active', p.id === 'subtab-' + btn.dataset.subtab));
      });
    });

    // Vuelve a abrir la misma ficha (para reflejar el nuevo estado del
    // flete) dejando activa la pestaña Cotización, no la de Datos.
    function refrescarFichaEnCotizacion() {
      abrirFicha(envio, opciones);
      const btnCot = fichaContenido.querySelector('.subtab-btn[data-subtab="envio-cotizacion"]');
      if (btnCot) btnCot.click();
    }

    if (!envio.esInterno) {
      const inputFlete = document.getElementById('ficha-envio-flete');
      const hintFlete = document.getElementById('ficha-envio-flete-hint');
      const btnConfirmarFlete = document.getElementById('btn-confirmar-flete');
      const btnCorregirFlete = document.getElementById('btn-corregir-flete');

      if (inputFlete && !inputFlete.disabled) {
        const btnGuardarFlete = document.getElementById('btn-guardar-flete');

        // Reformatea con separador de miles mientras se escribe (más legible
        // que ver puros dígitos corridos), y habilita/deshabilita "Confirmar
        // recibo" según si ya quedó algún valor. Esto es solo visual — no
        // guarda nada todavía, eso pasa únicamente al pulsar "Guardar".
        inputFlete.addEventListener('input', () => {
          const num = parsearCOP(inputFlete.value);
          inputFlete.value = num != null ? num.toLocaleString('es-CO') : '';
          if (btnConfirmarFlete) btnConfirmarFlete.disabled = num == null;
        });

        if (btnGuardarFlete) {
          btnGuardarFlete.addEventListener('click', async () => {
            const valor = parsearCOP(inputFlete.value);
            btnGuardarFlete.disabled = true;
            const textoOriginal = btnGuardarFlete.textContent;
            btnGuardarFlete.textContent = 'Guardando...';
            try {
              await db.collection(COLECCION).doc(envio.id).update({ costoFlete: valor });
              envio.costoFlete = valor; // refleja el cambio en caché local de inmediato
              if (hintFlete) {
                hintFlete.style.display = 'block';
                setTimeout(() => { hintFlete.style.display = 'none'; }, 1500);
              }
            } catch (err) {
              console.error('Error guardando el valor del flete:', err);
              alert('No se pudo guardar el valor del flete. Revisa la consola.');
            } finally {
              btnGuardarFlete.disabled = false;
              btnGuardarFlete.textContent = textoOriginal;
            }
          });
        }
      }

      if (btnConfirmarFlete) {
        btnConfirmarFlete.addEventListener('click', async () => {
          const valor = parsearCOP(inputFlete.value);
          if (valor == null) return;
          btnConfirmarFlete.disabled = true;
          btnConfirmarFlete.textContent = 'Confirmando...';
          try {
            await db.collection(COLECCION).doc(envio.id).update({ costoFlete: valor, fleteConfirmado: true });
            envio.costoFlete = valor;
            envio.fleteConfirmado = true;
            refrescarFichaEnCotizacion();
          } catch (err) {
            console.error('Error confirmando el recibo del flete:', err);
            alert('No se pudo confirmar el recibo. Revisa la consola.');
            btnConfirmarFlete.disabled = false;
            btnConfirmarFlete.textContent = '✅ Confirmar recibo';
          }
        });
      }

      if (btnCorregirFlete) {
        btnCorregirFlete.addEventListener('click', async () => {
          try {
            await db.collection(COLECCION).doc(envio.id).update({ fleteConfirmado: false });
            envio.fleteConfirmado = false;
            refrescarFichaEnCotizacion();
          } catch (err) {
            console.error('Error reabriendo la cotización del flete:', err);
            alert('No se pudo reabrir la cotización. Revisa la consola.');
          }
        });
      }
    }

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
          fichaSubtitulo.textContent = `${subtituloBase} · Fecha de envío: ${formatearFechaCorta(nuevaFecha)}`;
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
      // Clic en el badge "Remisión X" abre un popover con el campo de edición
      // (solo visual: el valor se guarda al presionar "Guardar", como el resto
      // de la ficha). Al escribir, el badge se actualiza en vivo.
      fichaContenido.querySelectorAll('.remision-card-numero').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const wrap = btn.closest('.remision-numero-wrap');
          const popover = wrap.querySelector('.remision-popover');
          const yaAbierto = popover.classList.contains('open');
          cerrarPopoversRemision();
          if (!yaAbierto) {
            popover.classList.add('open');
            const input = popover.querySelector('.input-remision-envio');
            input.focus();
            input.select();
          }
        });
      });
      fichaContenido.querySelectorAll('.remision-popover .input-remision-envio').forEach(input => {
        // Con varias remisiones del mismo pedido, data-pedidoid ya no basta
        // para identificar el badge correspondiente — se combina con la
        // posición dentro del grupo de ese pedido (data-grupo-idx).
        const badge = fichaContenido.querySelector(`.remision-card-numero[data-pedidoid="${input.dataset.pedidoid}"][data-grupo-idx="${input.dataset.grupoIdx}"]`);
        input.addEventListener('input', () => {
          if (badge) badge.textContent = `${input.value.trim() || '—'} ✏️`;
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            cerrarPopoversRemision();
            badge?.focus();
          }
        });
      });

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
          const esDecimal = input?.step === '0.01';
          const max = input ? parseFloat(input.max) : 0;
          const minimo = esDecimal ? 0.01 : 1;
          let cantidad = input ? (esDecimal ? parseFloat(input.value) : parseInt(input.value, 10)) : NaN;
          if (!Number.isFinite(cantidad) || cantidad < minimo) cantidad = minimo;
          if (max && cantidad > max) cantidad = max;
          retirarCantidadDeItem(parseInt(btn.dataset.idxRemision, 10), parseInt(btn.dataset.idxItem, 10), cantidad);
        });
      });
    }

    // "Ver ficha del pedido" está disponible siempre (armado o despachado):
    // navega a la ficha de ese pedido, y al cerrarla vuelve aquí.
    fichaContenido.querySelectorAll('.btn-ver-pedido').forEach(btn => {
      btn.addEventListener('click', () => irAFichaPedido(btn.dataset.pedidoId));
    });

    // Flechitas ▲: colapsan/expanden el cuerpo de la tarjeta del pedido y,
    // dentro de ella, el de cada remisión. Disponible siempre (no depende
    // de si el envío está despachado, es solo para ordenar la vista).
    fichaContenido.querySelectorAll('.remision-card-header').forEach(header => {
      header.addEventListener('click', () => {
        header.closest('.remision-card').classList.toggle('collapsed');
      });
    });
    fichaContenido.querySelectorAll('.remision-sub-card-header').forEach(header => {
      header.addEventListener('click', () => {
        header.closest('.remision-sub-card').classList.toggle('collapsed');
      });
    });

    btnCancelarEnvio.style.display = despachado ? 'none' : 'inline-block';
    btnGuardarEnvio.style.display = (!despachado || !remesaBloqueada) ? 'inline-block' : 'none';
    btnDespacharEnvio.style.display = despachado ? 'none' : 'inline-block';
    btnDescargarRemesa.style.display = envio.esInterno ? 'none' : 'inline-block';
    btnCompartirRemesaWhatsapp.style.display = envio.esInterno ? 'none' : 'inline-block';
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
    if (!cantidadARetirar || cantidadARetirar <= 0) return;
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

  function cerrarPopoversRemision() {
    fichaContenido.querySelectorAll('.remision-popover.open').forEach(p => p.classList.remove('open'));
  }

  // Clic afuera de cualquier popover de remisión lo cierra (registrado una
  // sola vez; fichaContenido persiste entre renders aunque su innerHTML cambie).
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.remision-numero-wrap')) cerrarPopoversRemision();
  });

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

  // ---------- Remesa exportable como imagen ----------

  // Mismo nombre + extras (brazo/eje/flanche) que se usa en la ficha, pero
  // aparte porque aquí no hace falta ninguno de los botones de retirar.
  function nombreItemParaRemesa(item) {
    const extras = [
      item.llevaBrazo ? '+ Brazo de reacción' : '',
      item.llevaEje ? '+ Eje sólido' : '',
      item.llevaFlanche ? '+ Flanche de salida' : ''
    ].filter(Boolean).map(t => ` ${t}`).join('');

    if (item.tipoLinea === 'motoreductor') {
      const equipoMotor = buscarEquipoCatalogo(item.motorEquipoId);
      const equipoReductor = buscarEquipoCatalogo(item.reductorEquipoId);
      const iconoMotor = buscarTipoEquipo(equipoMotor?.tipoId)?.icono || '';
      const iconoReductor = buscarTipoEquipo(equipoReductor?.tipoId)?.icono || '';
      return `${iconoMotor ? iconoMotor + ' ' : ''}${equipoMotor?.nombre || '?'} + ${iconoReductor ? iconoReductor + ' ' : ''}${equipoReductor?.nombre || '?'}${extras}`;
    }
    const equipo = buscarEquipoCatalogo(item.equipoId);
    const icono = buscarTipoEquipo(equipo?.tipoId)?.icono || '';
    return `${icono ? icono + ' ' : ''}${equipo?.nombre || 'Equipo no encontrado'}${extras}`;
  }

  // Arma la ficha completa como HTML — un bloque "Destino" por cada pedido
  // distinto en el envío (varios pedidos = varios destinos, todo dentro de
  // la misma imagen), con sus equipos sumados si venían en más de una
  // remisión.
  function construirHtmlRemesa(envio) {
    const empresa = (window.empresasEnvioCache || []).find(e => e.id === envio.empresaEnvioId);
    const nombreEmpresa = empresa ? empresa.nombre : 'Transportadora';
    const nombreEmpresaNorm = normalizar(nombreEmpresa);
    const claseTransportadora = nombreEmpresaNorm === 'tcc' ? 'transportadora-tcc'
      : nombreEmpresaNorm === 'paquetex' ? 'transportadora-paquetex' : '';

    const grupoPorPedido = new Map();
    const grupos = [];
    (envio.pedidos || []).forEach(pInfo => {
      let grupo = grupoPorPedido.get(pInfo.pedidoId);
      if (!grupo) {
        grupo = { pedidoId: pInfo.pedidoId, entradas: [] };
        grupoPorPedido.set(pInfo.pedidoId, grupo);
        grupos.push(grupo);
      }
      grupo.entradas.push(pInfo);
    });

    const destinosHtml = grupos.map(grupo => {
      const pedido = buscarPedido(grupo.pedidoId);
      const compania = pedido ? buscarCompania(pedido.companiaId) : null;

      // Si el pedido está marcado para enviarse a una subsidiaria, el
      // paquete llega físicamente allá — no a la dirección del cliente —
      // así que esa es la dirección/encargado que debe salir en la remesa.
      // El cliente original se deja como referencia entre paréntesis, para
      // no perder de vista de qué pedido viene.
      let nombreDestino, direccionDestino, encargadoDestino;
      if (pedido?.envioSubsidiaria) {
        const subsidiaria = (window.clientesCache || []).find(c => c.id === pedido.subsidiariaId);
        nombreDestino = subsidiaria
          ? `${subsidiaria.nombre}${compania ? ` (pedido de ${compania.nombre})` : ''}`
          : 'Subsidiaria no encontrada';
        direccionDestino = subsidiaria ? (subsidiaria.direccionRemision || subsidiaria.direccion || 'Sin dirección registrada') : '—';
        encargadoDestino = pedido.subsidiariaContacto || '';
      } else {
        nombreDestino = compania ? compania.nombre : 'Cliente no encontrado';
        direccionDestino = compania ? (compania.direccionRemision || compania.direccion || 'Sin dirección registrada') : '—';
        encargadoDestino = pedido?.contacto || '';
      }
      const encargadoHtml = encargadoDestino ? `<div class="direccion">Recibe: ${escapeHtml(encargadoDestino)}</div>` : '';

      // Suma cantidades del mismo ítem si venía repartido en más de una
      // remisión dentro de este envío.
      const cantidadPorItem = new Map();
      grupo.entradas.forEach(pInfo => {
        (pInfo.items || []).forEach(it => {
          const cantidad = (it.unidades && it.unidades.length) ? it.unidades.length : (it.cantidad || 0);
          cantidadPorItem.set(it.itemIndex, (cantidadPorItem.get(it.itemIndex) || 0) + cantidad);
        });
      });

      const itemsHtml = Array.from(cantidadPorItem.entries()).map(([itemIndex, cantidad]) => {
        const item = pedido?.equipos?.[itemIndex];
        const nombre = item ? nombreItemParaRemesa(item) : '⚠️ Ítem no encontrado';
        return `<div class="remesa-item-fila"><span class="nombre">${nombre}</span><span class="cantidad">${cantidad}</span></div>`;
      }).join('');

      return `
        <div class="remesa-destino">
          <div class="titulo">Destino</div>
          <div class="cliente">${escapeHtml(nombreDestino)}</div>
          <div class="direccion">${escapeHtml(direccionDestino)}</div>
          ${encargadoHtml}
          ${itemsHtml}
        </div>
      `;
    }).join('');

    const numeroRemesa = envio.remesa ? escapeHtml(envio.remesa) : 'Sin asignar';
    const fecha = formatearFechaCorta(envio.fechaEnvio || fechaHoyISO());

    return `
      <div class="remesa-card">
        <div class="remesa-header ${claseTransportadora}">
          <span class="marca">EDISATECH</span>
          <span class="transportadora">🚚 ${escapeHtml(nombreEmpresa)}</span>
        </div>
        <div class="remesa-body">
          <div class="remesa-numero">
            <div class="label">N° de remesa</div>
            <div class="valor">${numeroRemesa}</div>
          </div>
          ${destinosHtml}
        </div>
        <div class="remesa-footer">
          <span>${escapeHtml(textoPedidosIncluidos(envio))}</span>
          <span>Enviado: ${fecha}</span>
        </div>
      </div>
    `;
  }

  // Genera el canvas de la remesa (usado tanto por "Descargar" como por
  // "Compartir por WhatsApp") a partir del HTML armado en el host oculto.
  async function generarCanvasRemesa(envio) {
    remesaExportHost.innerHTML = construirHtmlRemesa(envio);
    // Un frame de margen para que el navegador termine de aplicar el CSS
    // antes de que html2canvas "fotografíe" el nodo.
    await new Promise(resolve => requestAnimationFrame(resolve));
    const nodo = remesaExportHost.querySelector('.remesa-card');
    const canvas = await html2canvas(nodo, { scale: 2, backgroundColor: '#ffffff' });
    remesaExportHost.innerHTML = '';
    return canvas;
  }

  function nombreArchivoRemesa(envio) {
    return `remesa-${(envio.remesa || envio.id).toString().replace(/[^a-zA-Z0-9-_]/g, '')}.png`;
  }

  // "Se envía a {destino} por medio de {transportadora}. A cuenta de
  // nosotros/ellos" — una línea por cada pedido distinto en el envío
  // (varios destinos = varias líneas, una por una). "A cuenta de" se decide
  // por el campo "Contraentrega" del CLIENTE (no de la subsidiaria — la
  // subsidiaria es solo el lugar físico de entrega, quien paga sigue siendo
  // el cliente real).
  function construirMensajeWhatsapp(envio) {
    const empresa = (window.empresasEnvioCache || []).find(e => e.id === envio.empresaEnvioId);
    const nombreEmpresa = empresa ? empresa.nombre : 'la transportadora';

    const vistos = new Set();
    const pedidosUnicos = [];
    (envio.pedidos || []).forEach(pInfo => {
      if (vistos.has(pInfo.pedidoId)) return;
      vistos.add(pInfo.pedidoId);
      pedidosUnicos.push(pInfo.pedidoId);
    });

    const lineas = pedidosUnicos.map(pedidoId => {
      const pedido = buscarPedido(pedidoId);
      const compania = pedido ? buscarCompania(pedido.companiaId) : null;

      let destinoTexto;
      if (pedido?.envioSubsidiaria) {
        const subsidiaria = (window.clientesCache || []).find(c => c.id === pedido.subsidiariaId);
        const nombreSub = subsidiaria ? subsidiaria.nombre : 'Subsidiaria no encontrada';
        destinoTexto = compania ? `${nombreSub} (${compania.nombre})` : nombreSub;
      } else {
        destinoTexto = compania ? compania.nombre : 'Cliente no encontrado';
      }

      const cuenta = compania?.contraentrega ? 'ellos' : 'nosotros';
      return `Se envía a ${destinoTexto} por medio de ${nombreEmpresa}. A cuenta de ${cuenta}.`;
    });

    return lineas.join('\n') || `Envío por medio de ${nombreEmpresa}.`;
  }

  btnDescargarRemesa.addEventListener('click', async () => {
    const envio = window.enviosCache.find(en => en.id === envioIdEnFicha);
    if (!envio) return;

    const textoOriginal = btnDescargarRemesa.textContent;
    btnDescargarRemesa.disabled = true;
    btnDescargarRemesa.textContent = 'Generando...';
    try {
      const canvas = await generarCanvasRemesa(envio);
      const enlace = document.createElement('a');
      enlace.download = nombreArchivoRemesa(envio);
      enlace.href = canvas.toDataURL('image/png');
      enlace.click();
    } catch (err) {
      console.error('Error generando la imagen de la remesa:', err);
      alert('No se pudo generar la imagen. Revisa la consola.');
    } finally {
      btnDescargarRemesa.disabled = false;
      btnDescargarRemesa.textContent = textoOriginal;
    }
  });

  btnCompartirRemesaWhatsapp.addEventListener('click', async () => {
    const envio = window.enviosCache.find(en => en.id === envioIdEnFicha);
    if (!envio) return;

    const textoOriginal = btnCompartirRemesaWhatsapp.textContent;
    btnCompartirRemesaWhatsapp.disabled = true;
    btnCompartirRemesaWhatsapp.textContent = 'Preparando...';
    try {
      const mensaje = construirMensajeWhatsapp(envio);
      const canvas = await generarCanvasRemesa(envio);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const archivo = new File([blob], nombreArchivoRemesa(envio), { type: 'image/png' });

      // En el celular (Android/iOS con Chrome o Safari recientes),
      // navigator.share con "files" manda la imagen y el texto juntos,
      // directo al selector nativo de WhatsApp — no hace falta que la
      // persona adjunte nada a mano.
      if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
        await navigator.share({ files: [archivo], text: mensaje });
        return;
      }

      // En escritorio (o si el navegador no soporta compartir archivos):
      // no existe forma de adjuntar una imagen a un link de WhatsApp, así
      // que se descarga la imagen y se abre WhatsApp Web con el texto ya
      // listo — solo falta arrastrar la imagen descargada al chat.
      const enlaceDescarga = document.createElement('a');
      enlaceDescarga.download = archivo.name;
      enlaceDescarga.href = URL.createObjectURL(blob);
      enlaceDescarga.click();
      window.open(`https://wa.me/?text=${encodeURIComponent(mensaje)}`, '_blank');
    } catch (err) {
      if (err.name !== 'AbortError') { // el usuario cerró el selector de compartir — no es un error real
        console.error('Error compartiendo la remesa por WhatsApp:', err);
        alert('No se pudo preparar el mensaje. Revisa la consola.');
      }
    } finally {
      btnCompartirRemesaWhatsapp.disabled = false;
      btnCompartirRemesaWhatsapp.textContent = textoOriginal;
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

  // ==================== Simulaciones de envío ====================
  // Sirven para calcular el peso total ANTES de armar un envío real — no
  // reservan ni descuentan nada de los pedidos, es solo una cuenta aparte.
  //
  // Cada simulación:
  // {
  //   nombre: string,
  //   pedidosSeleccionados: [ { pedidoId, itemIndex, cantidad } ],
  //   equiposSueltos: [ { equipoId, cantidad } ],
  //   creadoEn: timestamp
  // }

  // Un equipo "tiene peso" solo si TODO lo que compone su peso está
  // registrado — para un compuesto, si falta el peso de alguna pieza, se
  // considera incompleto (aunque pesoUnitarioEquipo sí sume lo que sí hay,
  // para no romper el total).
  function equipoTienePesoRegistrado(equipo) {
    if (!equipo) return false;
    if (equipo.esCompuesto && (equipo.piezasCompuesto || []).length) {
      return equipo.piezasCompuesto.every(p => {
        const pieza = buscarEquipoCatalogo(p.piezaId);
        return pieza && pieza.peso !== undefined && pieza.peso !== null && pieza.peso !== '';
      });
    }
    return equipo.peso !== undefined && equipo.peso !== null && equipo.peso !== '';
  }

  function itemTienePesoCompleto(item) {
    let base;
    if (item.tipoLinea === 'motoreductor') {
      const equipoMotor = buscarEquipoCatalogo(item.motorEquipoId);
      const equipoReductor = buscarEquipoCatalogo(item.reductorEquipoId);
      base = equipoTienePesoRegistrado(equipoMotor) && equipoTienePesoRegistrado(equipoReductor);
    } else {
      const equipo = buscarEquipoCatalogo(item.equipoId);
      base = equipoTienePesoRegistrado(equipo);
    }
    if (!base) return false;
    // Si marcó brazo/eje/flanche, también debe tener una pieza elegida con
    // su peso registrado — si no, el total de la simulación quedaría corto
    // sin que nada lo avise.
    if (item.llevaBrazo && !equipoTienePesoRegistrado(buscarEquipoCatalogo(item.brazoEquipoId))) return false;
    if (item.llevaEje && !equipoTienePesoRegistrado(buscarEquipoCatalogo(item.ejeEquipoId))) return false;
    if (item.llevaFlanche && !equipoTienePesoRegistrado(buscarEquipoCatalogo(item.flancheEquipoId))) return false;
    return true;
  }

  function pesoTotalSimulacion(sim) {
    let total = 0;
    (sim.pedidosSeleccionados || []).forEach(sel => {
      const pedido = buscarPedido(sel.pedidoId);
      if (pedido) total += pesoItem(pedido, sel);
    });
    (sim.equiposSueltos || []).forEach(suelto => {
      const equipo = buscarEquipoCatalogo(suelto.equipoId);
      total += pesoUnitarioEquipo(equipo) * (suelto.cantidad || 0);
    });
    return total;
  }

  // Nombres de los ítems a los que les falta peso, para el aviso.
  function itemsSinPesoSimulacion(sim) {
    const faltantes = [];
    (sim.pedidosSeleccionados || []).forEach(sel => {
      const pedido = buscarPedido(sel.pedidoId);
      const item = pedido?.equipos?.[sel.itemIndex];
      if (item && !itemTienePesoCompleto(item)) faltantes.push(nombreItemParaRemesa(item));
    });
    (sim.equiposSueltos || []).forEach(suelto => {
      const equipo = buscarEquipoCatalogo(suelto.equipoId);
      if (equipo && !equipoTienePesoRegistrado(equipo)) {
        const icono = buscarTipoEquipo(equipo.tipoId)?.icono || '';
        faltantes.push(`${icono ? icono + ' ' : ''}${escapeHtml(equipo.nombre)}`);
      }
    });
    return faltantes;
  }

  function formatearPeso(kg) {
    const redondeado = Math.round(kg * 100) / 100;
    return `${redondeado.toLocaleString('es-CO')} kg`;
  }

  // ---------- Subtabs del panel (Envíos / Simulaciones) ----------

  let suscritoSimulaciones = false;
  panelSubtabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      panelSubtabButtons.forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('#panel-envios > .subtab-panel').forEach(p => {
        p.classList.toggle('active', p.id === 'subtab-' + btn.dataset.subtab);
      });
      if (btn.dataset.subtab === 'simulaciones-lista') iniciarSuscripcionSimulaciones();
    });
  });

  function iniciarSuscripcionSimulaciones() {
    if (suscritoSimulaciones) return;
    suscritoSimulaciones = true;
    db.collection(COLECCION_SIMULACIONES).onSnapshot(
      (snapshot) => {
        simulacionesCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderListaSimulaciones();
        if (simulacionIdEnFicha) {
          const actual = simulacionesCache.find(s => s.id === simulacionIdEnFicha);
          if (actual) renderContenidoFichaSimulacion(actual);
        }
      },
      (err) => console.error('Error escuchando simulaciones:', err)
    );
  }

  // ---------- Lista de simulaciones ----------

  function renderListaSimulaciones() {
    if (!simulacionesCache.length) {
      simulacionesContenedor.innerHTML = '';
      simulacionesEmpty.style.display = 'block';
      return;
    }
    simulacionesEmpty.style.display = 'none';

    simulacionesContenedor.innerHTML = simulacionesCache.map(sim => {
      const totalItems = (sim.pedidosSeleccionados || []).length + (sim.equiposSueltos || []).length;
      const peso = pesoTotalSimulacion(sim);
      const faltantes = itemsSinPesoSimulacion(sim);
      const pesoPillClase = faltantes.length ? 'peso-pill advertencia' : 'peso-pill';
      const pesoPillTexto = faltantes.length ? `⚠️ ${formatearPeso(peso)}` : formatearPeso(peso);
      return `
        <div class="simulacion-card" data-id="${sim.id}">
          <div class="nombre">${escapeHtml(sim.nombre || 'Sin nombre')}</div>
          <div class="resumen">${totalItems} equipo${totalItems === 1 ? '' : 's'}</div>
          <div class="${pesoPillClase}">${pesoPillTexto}</div>
        </div>
      `;
    }).join('');

    simulacionesContenedor.querySelectorAll('.simulacion-card').forEach(card => {
      card.addEventListener('click', () => {
        const sim = simulacionesCache.find(s => s.id === card.dataset.id);
        if (sim) abrirFichaSimulacion(sim);
      });
    });
  }

  btnNuevaSimulacion.addEventListener('click', async () => {
    try {
      const ref = await db.collection(COLECCION_SIMULACIONES).add({
        nombre: '',
        pedidosSeleccionados: [],
        equiposSueltos: [],
        creadoEn: firebase.firestore.FieldValue.serverTimestamp()
      });
      abrirFichaSimulacion({ id: ref.id, nombre: '', pedidosSeleccionados: [], equiposSueltos: [] });
      inputNombreSimulacion.focus();
    } catch (err) {
      console.error('Error creando la simulación:', err);
      alert('No se pudo crear la simulación. Revisa la consola.');
    }
  });

  // ---------- Ficha de una simulación ----------

  function abrirFichaSimulacion(sim) {
    simulacionIdEnFicha = sim.id;
    panelAgregarPedido.style.display = 'none';
    panelAgregarSuelto.style.display = 'none';
    renderContenidoFichaSimulacion(sim);
    modalFichaSimulacion.classList.add('open');
  }

  function cerrarFichaSimulacion() {
    modalFichaSimulacion.classList.remove('open');
    simulacionIdEnFicha = null;
  }
  btnCerrarFichaSimulacion.addEventListener('click', cerrarFichaSimulacion);
  modalFichaSimulacion.addEventListener('click', (e) => {
    if (e.target === modalFichaSimulacion) cerrarFichaSimulacion();
  });

  function renderContenidoFichaSimulacion(sim) {
    // Si el campo de nombre tiene el foco (el usuario está escribiendo ahí),
    // no se pisa con lo que haya en caché — evita que un refresco de fondo
    // (ej. otro cambio cualquiera en simulaciones) borre lo que se estaba
    // tecleando antes de que el 'change' lo alcance a guardar.
    if (document.activeElement !== inputNombreSimulacion) {
      inputNombreSimulacion.value = sim.nombre || '';
    }

    const peso = pesoTotalSimulacion(sim);
    pesoValorSimulacion.textContent = formatearPeso(peso);

    const faltantes = itemsSinPesoSimulacion(sim);
    if (faltantes.length) {
      advertenciaPesoSimulacion.style.display = 'block';
      advertenciaPesoSimulacion.innerHTML = `
        <strong>⚠️ ${faltantes.length} equipo${faltantes.length === 1 ? '' : 's'} sin peso registrado — el total de arriba no los incluye:</strong>
        ${faltantes.join(', ')}
      `;
    } else {
      advertenciaPesoSimulacion.style.display = 'none';
    }

    const filas = [];
    (sim.pedidosSeleccionados || []).forEach((sel, idx) => {
      const pedido = buscarPedido(sel.pedidoId);
      const item = pedido?.equipos?.[sel.itemIndex];
      const compania = pedido ? buscarCompania(pedido.companiaId) : null;
      const nombre = item ? nombreItemParaRemesa(item) : '⚠️ Ítem no encontrado (el pedido pudo haber cambiado)';
      const pesoFila = pedido ? pesoItem(pedido, sel) : 0;
      const sinPeso = item && !itemTienePesoCompleto(item);
      const origen = pedido ? `N${pedido.numero} - ${escapeHtml(compania ? compania.nombre : '?')}` : '';
      filas.push({
        html: `
          <div class="simulacion-item-fila">
            <span class="nombre">${nombre}${sinPeso ? ' <span class="sin-peso">(sin peso)</span>' : ''}<br><span style="font-size:11.5px; color:var(--ink-soft);">${origen}</span></span>
            <span class="cantidad">× ${sel.cantidad}</span>
            <span class="peso">${formatearPeso(pesoFila)}</span>
            <button type="button" class="btn-quitar-item-simulacion" data-tipo="pedido" data-idx="${idx}" title="Quitar">✕</button>
          </div>
        `
      });
    });
    (sim.equiposSueltos || []).forEach((suelto, idx) => {
      const equipo = buscarEquipoCatalogo(suelto.equipoId);
      const icono = equipo ? (buscarTipoEquipo(equipo.tipoId)?.icono || '') : '';
      const nombre = equipo ? `${icono ? icono + ' ' : ''}${escapeHtml(equipo.nombre)}` : '⚠️ Equipo no encontrado';
      const pesoFila = equipo ? pesoUnitarioEquipo(equipo) * (suelto.cantidad || 0) : 0;
      const sinPeso = equipo && !equipoTienePesoRegistrado(equipo);
      filas.push({
        html: `
          <div class="simulacion-item-fila">
            <span class="nombre">${nombre}${sinPeso ? ' <span class="sin-peso">(sin peso)</span>' : ''}<br><span style="font-size:11.5px; color:var(--ink-soft);">Equipo suelto</span></span>
            <span class="cantidad">× ${suelto.cantidad}</span>
            <span class="peso">${formatearPeso(pesoFila)}</span>
            <button type="button" class="btn-quitar-item-simulacion" data-tipo="suelto" data-idx="${idx}" title="Quitar">✕</button>
          </div>
        `
      });
    });

    if (!filas.length) {
      itemsListaSimulacion.innerHTML = '';
      itemsEmptySimulacion.style.display = 'block';
    } else {
      itemsEmptySimulacion.style.display = 'none';
      itemsListaSimulacion.innerHTML = filas.map(f => f.html).join('');
    }

    itemsListaSimulacion.querySelectorAll('.btn-quitar-item-simulacion').forEach(btn => {
      btn.addEventListener('click', () => quitarItemSimulacion(btn.dataset.tipo, parseInt(btn.dataset.idx, 10)));
    });
  }

  async function actualizarSimulacion(campos) {
    if (!simulacionIdEnFicha) return;
    try {
      await db.collection(COLECCION_SIMULACIONES).doc(simulacionIdEnFicha).update(campos);
    } catch (err) {
      console.error('Error guardando la simulación:', err);
      alert('No se pudo guardar. Revisa la consola.');
    }
  }

  async function quitarItemSimulacion(tipo, idx) {
    const sim = simulacionesCache.find(s => s.id === simulacionIdEnFicha);
    if (!sim) return;
    if (tipo === 'pedido') {
      const lista = (sim.pedidosSeleccionados || []).filter((_, i) => i !== idx);
      await actualizarSimulacion({ pedidosSeleccionados: lista });
    } else {
      const lista = (sim.equiposSueltos || []).filter((_, i) => i !== idx);
      await actualizarSimulacion({ equiposSueltos: lista });
    }
  }

  inputNombreSimulacion.addEventListener('change', () => {
    actualizarSimulacion({ nombre: inputNombreSimulacion.value.trim() || 'Simulación sin nombre' });
  });

  btnEliminarSimulacion.addEventListener('click', async () => {
    if (!simulacionIdEnFicha) return;
    const ok = confirm('¿Eliminar esta simulación? Esta acción no se puede deshacer.');
    if (!ok) return;
    try {
      await db.collection(COLECCION_SIMULACIONES).doc(simulacionIdEnFicha).delete();
      cerrarFichaSimulacion();
    } catch (err) {
      console.error('Error eliminando la simulación:', err);
      alert('No se pudo eliminar. Revisa la consola.');
    }
  });

  // ---------- Panel: agregar equipos de un pedido existente ----------

  btnAbrirAgregarPedido.addEventListener('click', () => {
    panelAgregarSuelto.style.display = 'none';
    const abierto = panelAgregarPedido.style.display !== 'none';
    if (abierto) { panelAgregarPedido.style.display = 'none'; return; }

    // Solo pedidos "en proceso" — un pedido ya completamente despachado no
    // tiene sentido incluirlo en una simulación, esto es para planear lo
    // que todavía falta por enviar.
    const pedidosOrdenados = [...(window.pedidosCache || [])]
      .filter(p => !(window.pedidoEstaCompletado && window.pedidoEstaCompletado(p)))
      .sort((a, b) => (b.numero || 0) - (a.numero || 0));
    selectPedidoSimulacion.innerHTML = '<option value="">Selecciona un pedido...</option>' +
      pedidosOrdenados.map(p => {
        const compania = buscarCompania(p.companiaId);
        return `<option value="${p.id}">N${p.numero} - ${escapeHtml(compania ? compania.nombre : 'Compañía no encontrada')}</option>`;
      }).join('');
    checklistPedidoSimulacion.innerHTML = '';
    panelAgregarPedido.style.display = 'block';
  });

  btnCancelarAgregarPedido.addEventListener('click', () => { panelAgregarPedido.style.display = 'none'; });

  selectPedidoSimulacion.addEventListener('change', () => {
    const pedido = buscarPedido(selectPedidoSimulacion.value);
    if (!pedido) { checklistPedidoSimulacion.innerHTML = ''; return; }

    checklistPedidoSimulacion.innerHTML = (pedido.equipos || []).map((item, idx) => {
      const nombre = nombreItemParaRemesa(item);
      const equipoParaDecimal = item.tipoLinea === 'individual' ? buscarEquipoCatalogo(item.equipoId) : null;
      const esDecimal = esTipoCantidadDecimal(equipoParaDecimal);
      return `
        <div class="simulacion-pedido-item-row">
          <span class="nombre">${nombre}</span>
          <input type="number" class="input-simulacion-item-cantidad" data-idx="${idx}"
            min="0" step="${esDecimal ? '0.01' : '1'}" max="${item.cantidad}" value="0" title="Cantidad a incluir (0 = no incluir)">
        </div>
      `;
    }).join('') || '<div style="font-size:13px; color:var(--ink-soft);">Este pedido no tiene equipos.</div>';
  });

  btnConfirmarAgregarPedido.addEventListener('click', async () => {
    const pedidoId = selectPedidoSimulacion.value;
    if (!pedidoId) { alert('Elige un pedido primero.'); return; }

    const sim = simulacionesCache.find(s => s.id === simulacionIdEnFicha);
    if (!sim) return;

    const nuevasSelecciones = [];
    checklistPedidoSimulacion.querySelectorAll('.input-simulacion-item-cantidad').forEach(input => {
      const cantidad = parseFloat(input.value);
      if (cantidad > 0) nuevasSelecciones.push({ itemIndex: parseInt(input.dataset.idx, 10), cantidad });
    });
    if (!nuevasSelecciones.length) { alert('Pon una cantidad mayor a 0 en al menos un equipo.'); return; }

    // Si un ítem de este mismo pedido ya estaba agregado, se reemplaza su
    // cantidad (no se duplica); los demás pedidos/ítems se dejan igual.
    const otrosSinEstePedido = (sim.pedidosSeleccionados || []).filter(sel => sel.pedidoId !== pedidoId);
    const deEstePedido = (sim.pedidosSeleccionados || []).filter(sel => sel.pedidoId === pedidoId);
    nuevasSelecciones.forEach(nueva => {
      const yaExiste = deEstePedido.find(sel => sel.itemIndex === nueva.itemIndex);
      if (yaExiste) yaExiste.cantidad = nueva.cantidad;
      else deEstePedido.push({ pedidoId, ...nueva });
    });

    await actualizarSimulacion({ pedidosSeleccionados: [...otrosSinEstePedido, ...deEstePedido] });
    panelAgregarPedido.style.display = 'none';
  });

  // ---------- Panel: agregar un equipo suelto del catálogo ----------

  function poblarSelectEquipoSuelto() {
    const tipoId = selectTipoSuelto.value || null;
    const equipos = (window.equiposCache || []).filter(eq => !tipoId || eq.tipoId === tipoId);
    selectEquipoSuelto.innerHTML = '<option value="">Selecciona un equipo...</option>' +
      equipos.map(eq => {
        const icono = buscarTipoEquipo(eq.tipoId)?.icono || '';
        return `<option value="${eq.id}">${icono ? icono + ' ' : ''}${escapeHtml(eq.nombre)}</option>`;
      }).join('');
  }

  function actualizarCantidadSueltoSegunEquipo() {
    const equipo = buscarEquipoCatalogo(selectEquipoSuelto.value);
    const decimal = esTipoCantidadDecimal(equipo);
    inputCantidadSuelto.step = decimal ? '0.01' : '1';
    inputCantidadSuelto.min = decimal ? '0.01' : '1';
  }

  btnAbrirAgregarSuelto.addEventListener('click', () => {
    panelAgregarPedido.style.display = 'none';
    const abierto = panelAgregarSuelto.style.display !== 'none';
    if (abierto) { panelAgregarSuelto.style.display = 'none'; return; }

    selectTipoSuelto.innerHTML = '<option value="">Todos los tipos</option>' +
      (window.tiposEquipoCache || []).map(t => `<option value="${t.id}">${t.icono ? t.icono + ' ' : ''}${escapeHtml(t.nombre)}</option>`).join('');
    poblarSelectEquipoSuelto();
    inputCantidadSuelto.value = 1;
    panelAgregarSuelto.style.display = 'block';
  });

  btnCancelarAgregarSuelto.addEventListener('click', () => { panelAgregarSuelto.style.display = 'none'; });
  selectTipoSuelto.addEventListener('change', poblarSelectEquipoSuelto);
  selectEquipoSuelto.addEventListener('change', actualizarCantidadSueltoSegunEquipo);

  btnConfirmarAgregarSuelto.addEventListener('click', async () => {
    const equipoId = selectEquipoSuelto.value;
    if (!equipoId) { alert('Elige un equipo primero.'); return; }
    const cantidad = parseFloat(inputCantidadSuelto.value);
    if (!cantidad || cantidad <= 0) { alert('Pon una cantidad mayor a 0.'); return; }

    const sim = simulacionesCache.find(s => s.id === simulacionIdEnFicha);
    if (!sim) return;

    // Si ya estaba agregado, se reemplaza la cantidad (no se duplica).
    const lista = (sim.equiposSueltos || []).filter(s => s.equipoId !== equipoId);
    lista.push({ equipoId, cantidad });

    await actualizarSimulacion({ equiposSueltos: lista });
    panelAgregarSuelto.style.display = 'none';
  });

  document.addEventListener('equipos-catalogo:cambio', () => { if (simulacionIdEnFicha) renderListaSimulaciones(); });
  document.addEventListener('pedidos:cambio', () => {
    if (simulacionIdEnFicha) {
      const sim = simulacionesCache.find(s => s.id === simulacionIdEnFicha);
      if (sim) renderContenidoFichaSimulacion(sim);
    }
    renderListaSimulaciones();
  });

  // ---------- Suscripción en tiempo real ----------
  // Espera a que haya sesión iniciada — antes de eso, Firestore rechazaría
  // la lectura, y si el intento falla aquí no se vuelve a reintentar solo.

  document.addEventListener('auth:listo', () => {
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
  });

  document.addEventListener('clientes:cambio', renderTabla);
  document.addEventListener('equipos-catalogo:cambio', renderTabla);
  document.addEventListener('empresas-envio:cambio', () => {
    renderOpcionesFiltroEmpresa();
    renderTabla();
  });
  document.addEventListener('pedidos:cambio', renderTabla);

  renderOpcionesFiltroEmpresa();
})();
