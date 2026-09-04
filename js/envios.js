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

  function difundirCambio() {
    document.dispatchEvent(new CustomEvent('envios:cambio', { detail: { envios: window.enviosCache } }));
  }

  function nombreQuienEncarga(envio) {
    if (envio.esInterno) return '🏠 Interno' + (envio.personaRecoge ? ` — ${escapeHtml(envio.personaRecoge)}` : '');
    const empresa = (window.empresasEnvioCache || []).find(e => e.id === envio.empresaEnvioId);
    return empresa ? escapeHtml(empresa.nombre) : '<span style="color:var(--danger);">Empresa no encontrada</span>';
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
          <td>${envio.remesa ? escapeHtml(envio.remesa) : '<span style="color:var(--ink-soft);">—</span>'}</td>
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
    fichaEstadoTag.innerHTML = despachado
      ? '<span class="tag-envio-despachado">Despachado</span>'
      : '<span class="tag-envio-armado">Armado</span>';

    const pedidosIncluidos = envio.pedidos || [];
    const filas = pedidosIncluidos.map((pInfo) => {
      const pedido = buscarPedido(pInfo.pedidoId);
      const compania = pedido ? buscarCompania(pedido.companiaId) : null;
      const nombrePedido = pedido ? `N${pedido.numero} - ${compania ? escapeHtml(compania.nombre) : 'Compañía no encontrada'}` : 'Pedido no encontrado';

      const itemsHtml = (pInfo.items || []).map(it => {
        const item = pedido?.equipos?.[it.itemIndex];
        const detalleCantidad = it.unidades ? `unidad(es): ${it.unidades.map(u => u + 1).join(', ')}` : `cant. ${it.cantidad}`;
        if (!item) return `<div class="item-linea"><span>Ítem no encontrado</span><span>${detalleCantidad}</span></div>`;
        let nombre;
        if (item.tipoLinea === 'motoreductor') {
          const motor = buscarEquipoCatalogo(item.motorEquipoId);
          const reductor = buscarEquipoCatalogo(item.reductorEquipoId);
          nombre = `Motoreductor (${motor ? escapeHtml(motor.nombre) : '?'} + ${reductor ? escapeHtml(reductor.nombre) : '?'})`;
        } else {
          const equipo = buscarEquipoCatalogo(item.equipoId);
          nombre = equipo ? escapeHtml(equipo.nombre) : 'Equipo no encontrado';
        }
        return `<div class="item-linea"><span>${nombre}</span><span>${detalleCantidad}</span></div>`;
      }).join('');

      return `
        <div class="remision-card">
          <div class="remision-card-header">
            <span class="remision-card-pedido">${nombrePedido}</span>
            <span class="remision-card-numero">Remisión ${escapeHtml(pInfo.remision || '—')}</span>
          </div>
          <div class="form-group" style="margin:0 0 8px 0;">
            <label style="font-size:11px;">Editar remisión</label>
            <input type="text" class="input-remision-envio" data-pedidoid="${pInfo.pedidoId}" value="${escapeHtml(pInfo.remision || '')}" ${despachado ? 'disabled' : ''}>
          </div>
          <div class="remision-card-items">${itemsHtml || 'Sin equipos'}</div>
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

    btnCancelarEnvio.style.display = despachado ? 'none' : 'inline-block';
    btnGuardarEnvio.style.display = (!despachado || !remesaBloqueada) ? 'inline-block' : 'none';
    btnDespacharEnvio.style.display = despachado ? 'none' : 'inline-block';
    modalFicha.classList.add('open');
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
        fechaDespacho: firebase.firestore.FieldValue.serverTimestamp()
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
            } else {
              item.cantidadCompletada = Math.min(item.cantidad || 0, (item.cantidadCompletada || 0) + (it.cantidad || 0));
            }
            item.preparado = true;
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
      // (no por índice), para no pisar pedidos que otra sesión haya agregado
      // a este mismo envío mientras esta ficha estaba abierta.
      if (!despachado) {
        const snap = await envioRef.get();
        const pedidosFrescos = snap.exists ? (snap.data().pedidos || []) : [];
        cambios.pedidos = pedidosFrescos.map(pInfo => {
          const input = fichaContenido.querySelector(`.input-remision-envio[data-pedidoid="${pInfo.pedidoId}"]`);
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
