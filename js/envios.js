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

  window.enviosCache = [];
  let envioIdEnFicha = null;

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

  // ---------- Ficha de envío ----------

  function abrirFicha(envio) {
    envioIdEnFicha = envio.id;
    fichaTitulo.textContent = nombreQuienEncarga(envio).replace(/<[^>]+>/g, '');
    fichaEstadoTag.innerHTML = envio.estado === 'despachado'
      ? '<span class="tag-envio-despachado">Despachado</span>'
      : '<span class="tag-envio-armado">Armado</span>';

    const pedidosIncluidos = envio.pedidos || [];
    const filas = pedidosIncluidos.map(pInfo => {
      const pedido = buscarPedido(pInfo.pedidoId);
      const compania = pedido ? buscarCompania(pedido.companiaId) : null;
      const nombrePedido = pedido ? `N${pedido.numero} - ${compania ? escapeHtml(compania.nombre) : 'Compañía no encontrada'}` : 'Pedido no encontrado';

      const itemsHtml = (pInfo.items || []).map(it => {
        const item = pedido?.equipos?.[it.itemIndex];
        if (!item) return `<div>Ítem no encontrado (cant. ${it.cantidad})</div>`;
        let nombre;
        if (item.tipoLinea === 'motoreductor') {
          const motor = buscarEquipoCatalogo(item.motorEquipoId);
          const reductor = buscarEquipoCatalogo(item.reductorEquipoId);
          nombre = `Motoreductor (${motor ? escapeHtml(motor.nombre) : '?'} + ${reductor ? escapeHtml(reductor.nombre) : '?'})`;
        } else {
          const equipo = buscarEquipoCatalogo(item.equipoId);
          nombre = equipo ? escapeHtml(equipo.nombre) : 'Equipo no encontrado';
        }
        return `<div>${nombre} — cant. en este envío: ${it.cantidad}</div>`;
      }).join('');

      return `
        <div class="ficha-campo" style="margin-bottom:10px;">
          <div class="campo-label">${nombrePedido} — Remisión: ${escapeHtml(pInfo.remision || '—')}</div>
          <div class="campo-valor" style="font-weight:400; font-size:13px;">${itemsHtml || 'Sin equipos'}</div>
        </div>
      `;
    }).join('');

    fichaContenido.innerHTML = `
      <div class="ficha-campos" style="margin-bottom:16px;">
        ${envio.remesa ? `<div class="ficha-campo"><div class="campo-label">Remesa</div><div class="campo-valor">${escapeHtml(envio.remesa)}</div></div>` : ''}
        ${envio.esInterno && envio.personaRecoge ? `<div class="ficha-campo"><div class="campo-label">Quién recoge</div><div class="campo-valor">${escapeHtml(envio.personaRecoge)}</div></div>` : ''}
      </div>
      <h4>Pedidos incluidos</h4>
      ${filas || '<div class="empty-equipos-pedido">Sin pedidos.</div>'}
    `;

    btnDespacharEnvio.style.display = envio.estado === 'despachado' ? 'none' : 'inline-block';
    modalFicha.classList.add('open');
  }

  window.abrirFichaEnvio = abrirFicha; // permite abrir la ficha de un envío desde pedidos.js

  function cerrarFicha() {
    modalFicha.classList.remove('open');
    envioIdEnFicha = null;
  }

  btnCerrarFicha.addEventListener('click', cerrarFicha);
  modalFicha.addEventListener('click', (e) => {
    if (e.target === modalFicha) cerrarFicha();
  });

  btnDespacharEnvio.addEventListener('click', async () => {
    const envio = window.enviosCache.find(en => en.id === envioIdEnFicha);
    if (!envio) return;
    const ok = confirm('¿Marcar este envío como despachado? Después de esto queda fijo y ya no se podrá editar.');
    if (!ok) return;
    try {
      await db.collection(COLECCION).doc(envio.id).update({
        estado: 'despachado',
        fechaDespacho: firebase.firestore.FieldValue.serverTimestamp()
      });
      cerrarFicha();
    } catch (err) {
      console.error('Error despachando envío:', err);
      alert('No se pudo marcar como despachado. Revisa la consola.');
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
