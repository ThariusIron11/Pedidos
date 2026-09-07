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
  const filtroEstado = document.getElementById('filtro-estado-envios');

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

  // ---------- Filtro ----------

  filtroEstado.addEventListener('change', renderTabla);

  // ---------- Render de la tabla principal ----------

  function renderTabla() {
    const filtro = filtroEstado.value;
    const lista = window.enviosCache.filter(en => !filtro || en.estado === filtro);

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
            return it.unidades.map(u => {
              const btnRetirarUnidad = despachado ? '' : `<button type="button" class="btn-retirar-unidad" data-idx-remision="${idxRemision}" data-idx-item="${idxItem}" data-unidad="${u}" title="Retirar esta unidad de la remisión">✕</button>`;
              return `<div class="item-linea"><span>${nombre}</span><span style="display:flex; align-items:center; gap:6px;">🆔 ${etiquetaUnidadEnvio(item, u)}${btnRetirarUnidad}</span></div>`;
            }).join('');
          }

          // Equipo SIN serial: las unidades son indistinguibles entre sí, así
          // que se retira por cantidad (puede ser parcial, no solo todo o nada).
          const controlCantidad = despachado ? '' : `
                <span class="retirar-cantidad-control">
                  <input type="number" class="input-retirar-cantidad" min="1" max="${it.cantidad}" value="${it.cantidad}" title="Cantidad a retirar">
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

      <h4 style="margin-top:18px;">Pedidos incluidos</h4>
      <div class="remisiones-frame">
        ${filas || '<div class="empty-equipos-pedido">Sin pedidos.</div>'}
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
          const max = input ? parseInt(input.max, 10) : 0;
          let cantidad = input ? parseInt(input.value, 10) : NaN;
          if (!Number.isFinite(cantidad) || cantidad < 1) cantidad = 1;
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
