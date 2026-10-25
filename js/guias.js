// ================== Guías de remisión ==================
// Una guía es un texto de ejemplo (qué se escribe en la remisión) que se
// asigna a un grupo de equipos. En Pedidos y en la ficha de Reparaciones, los
// equipos que están en una guía muestran un botón "?" que abre ese texto.
//
// Documento en Firestore (colección guias_remision):
// {
//   nombre: 'Acoples de rejilla',
//   texto: 'lo que se escribe en la remisión…',
//   equipos: [ ...claves ],   // id de un equipo del catálogo, o una clave
//                             // especial (ver ESPECIALES) para lo que no
//                             // tiene ficha propia en el catálogo
//   orden: 1730000000000      // para mostrarlas siempre en el mismo orden
// }
// Un equipo (o clave especial) solo puede estar en UNA guía.
//
// Expone:
//   window.guiasRemisionCache      + evento 'guias:cambio'
//   window.guiaRemisionDeItem(item, { reparacion })  → guía o null
// Los botones "?" (clase .btn-guia-equipo con data-guia-id) se manejan acá,
// para que Pedidos y Reparaciones solo tengan que dibujarlos.

(function () {
  const COLECCION = 'guias_remision';

  // Equipos que no existen como ficha del catálogo (o que dependen de la
  // situación del pedido), y por eso se eligen como "opciones especiales".
  const ESPECIALES = [
    { id: 'esp:set-sin', nombre: 'Set de sprockets SIN cadena' },
    { id: 'esp:set-con', nombre: 'Set de sprockets CON cadena' },
    { id: 'esp:mr', nombre: 'Motoreductor (sin reemplazo)' },
    { id: 'esp:mr-rep-red', nombre: 'Motoreductor en reparación · con reemplazo de reductor' },
    { id: 'esp:mr-rep-mot', nombre: 'Motoreductor en reparación · con reemplazo de motor' },
    { id: 'esp:mot-rep', nombre: 'Motor en reparación' },
    { id: 'esp:red-rep', nombre: 'Reductor en reparación' }
  ];

  const listaEl = document.getElementById('guias-lista');
  const vacioEl = document.getElementById('guias-empty');
  const btnNueva = document.getElementById('btn-nueva-guia');

  // Visor (el "?")
  const modalVisor = document.getElementById('modal-guia-remision');
  const visorNombre = document.getElementById('guia-remision-nombre');
  const visorTexto = document.getElementById('guia-remision-texto');
  const btnCerrarVisor = document.getElementById('btn-cerrar-ficha-guia');

  // Selector de equipos
  const modalSel = document.getElementById('modal-guias-equipos');
  const selTitulo = document.getElementById('guias-sel-titulo');
  const selBuscar = document.getElementById('guias-sel-buscar');
  const selTipos = document.getElementById('guias-sel-tipos');
  const selEsp = document.getElementById('guias-sel-esp');
  const selLista = document.getElementById('guias-sel-lista');
  const selCont = document.getElementById('guias-sel-cont');
  const selResumen = document.getElementById('guias-sel-resumen');

  let guiasCache = [];
  window.guiasRemisionCache = guiasCache;
  let suscrito = false;
  let renderPendiente = false;

  // ---------- Utilidades ----------

  function normalizar(str) {
    return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function buscarTipo(tipoId) {
    return (window.tiposEquipoCache || []).find(t => t.id === tipoId) || null;
  }

  function buscarEquipo(equipoId) {
    return (window.equiposCache || []).find(e => e.id === equipoId) || null;
  }

  function textoEquipo(eq) {
    return `${eq.nombre}${eq.variante ? ` (${eq.variante})` : ''}`;
  }

  // Nombre legible de una clave guardada en una guía.
  function nombreDeClave(clave) {
    const especial = ESPECIALES.find(e => e.id === clave);
    if (especial) return { texto: especial.nombre, especial: true };
    const eq = buscarEquipo(clave);
    if (eq) return { texto: textoEquipo(eq), especial: false };
    return { texto: '⚠️ Equipo eliminado del catálogo', especial: false, roto: true };
  }

  // ---------- ¿Qué guía le toca a un equipo? ----------

  // Claves por las que se busca una guía, de la más específica a la más
  // general. `item` es un equipo de pedido o de reparación.
  function clavesDeItem(item, enReparacion) {
    if (!item) return [];

    if (item.tipoLinea === 'set') {
      return [item.cajaEquipoId ? 'esp:set-con' : 'esp:set-sin'];
    }

    if (item.tipoLinea === 'motoreductor') {
      // Reemplazo de motor o de reductor (no existe el de los dos a la vez).
      if (item.reemplazo && item.reemplazo.reductor) return ['esp:mr-rep-red'];
      if (item.reemplazo && item.reemplazo.motor) return ['esp:mr-rep-mot'];
      return ['esp:mr'];
    }

    // Equipo individual del catálogo.
    const claves = [];
    if (item.equipoId) claves.push(item.equipoId);
    if (enReparacion && item.equipoId) {
      const eq = buscarEquipo(item.equipoId);
      const tipo = eq ? buscarTipo(eq.tipoId) : null;
      const nombreTipo = tipo ? normalizar(tipo.nombre) : '';
      if (nombreTipo === 'motor' || nombreTipo === 'motor zd') claves.push('esp:mot-rep');
      if (nombreTipo === 'reductor' || nombreTipo === 'reductor zd') claves.push('esp:red-rep');
    }
    return claves;
  }

  window.guiaRemisionDeItem = function (item, opciones) {
    const enReparacion = !!(opciones && opciones.reparacion);
    const claves = clavesDeItem(item, enReparacion);
    for (const clave of claves) {
      const guia = guiasCache.find(g => (g.equipos || []).includes(clave));
      if (guia) return guia;
    }
    return null;
  };

  // ---------- Visor del "?" ----------

  function mostrarGuia(guiaId) {
    const guia = guiasCache.find(g => g.id === guiaId);
    if (!guia) return;
    visorNombre.textContent = guia.nombre || '';
    visorTexto.textContent = guia.texto || '(Esta guía todavía no tiene texto.)';
    modalVisor.classList.add('open');
  }

  function cerrarVisor() {
    modalVisor.classList.remove('open');
  }

  // En fase de captura para que el clic del "?" no llegue a la tarjeta que lo
  // contiene (que abre otras ventanas al hacer clic).
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-guia-equipo');
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    mostrarGuia(btn.dataset.guiaId);
  }, true);

  btnCerrarVisor.addEventListener('click', cerrarVisor);
  modalVisor.addEventListener('mousedown', (e) => { if (e.target === modalVisor) cerrarVisor(); });

  // ---------- Lista de guías (Config → Guías de remisión) ----------

  function render() {
    const hayFoco = listaEl.contains(document.activeElement) &&
      /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (hayFoco) { renderPendiente = true; return; } // no pisar lo que se está escribiendo
    renderPendiente = false;

    vacioEl.style.display = guiasCache.length ? 'none' : 'block';
    listaEl.innerHTML = guiasCache.map(g => {
      const pastillas = (g.equipos || []).map(clave => {
        const n = nombreDeClave(clave);
        return `<span class="guia-pastilla ${n.especial ? 'especial' : ''} ${n.roto ? 'rota' : ''}">${escapeHtml(n.texto)}<button type="button" data-guia-quitar="${g.id}|${escapeHtml(clave)}" aria-label="Quitar de la guía" title="Quitar de la guía">✕</button></span>`;
      }).join('') || '<span class="guia-sin-equipos">Sin equipos todavía</span>';

      return `
        <div class="guia-card">
          <div class="guia-card-top">
            <input type="text" class="guia-nombre-input" value="${escapeHtml(g.nombre || '')}" data-guia-nombre="${g.id}" aria-label="Nombre de la guía" placeholder="Nombre de la guía">
            <button type="button" class="btn secondary" data-guia-eliminar="${g.id}">Eliminar guía</button>
          </div>
          <label class="guia-etiqueta">Texto de ejemplo (lo que se ve en el ?)</label>
          <textarea class="guia-texto-input" data-guia-texto="${g.id}" aria-label="Texto de la guía" placeholder="Escribe aquí el ejemplo de cómo se escribe en la remisión…">${escapeHtml(g.texto || '')}</textarea>
          <label class="guia-etiqueta">Equipos con esta guía (${(g.equipos || []).length})</label>
          <div class="guia-pastillas">
            ${pastillas}
            <button type="button" class="btn secondary" data-guia-agregar="${g.id}">+ Agregar equipos</button>
          </div>
        </div>`;
    }).join('');
  }

  listaEl.addEventListener('focusout', () => {
    setTimeout(() => {
      if (renderPendiente && !listaEl.contains(document.activeElement)) render();
    }, 0);
  });

  listaEl.addEventListener('change', async (e) => {
    const t = e.target;
    try {
      if (t.dataset.guiaNombre) {
        const nombre = t.value.trim() || 'Guía sin nombre';
        await db.collection(COLECCION).doc(t.dataset.guiaNombre).update({ nombre });
      } else if (t.dataset.guiaTexto) {
        await db.collection(COLECCION).doc(t.dataset.guiaTexto).update({ texto: t.value });
      }
    } catch (err) {
      console.error('Error guardando la guía:', err);
      alert('No se pudo guardar el cambio de la guía. Revisa la consola.');
    }
  });

  listaEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    try {
      if (btn.dataset.guiaQuitar) {
        const [guiaId, clave] = btn.dataset.guiaQuitar.split('|');
        await db.collection(COLECCION).doc(guiaId).update({
          equipos: firebase.firestore.FieldValue.arrayRemove(clave)
        });
      } else if (btn.dataset.guiaEliminar) {
        const guia = guiasCache.find(g => g.id === btn.dataset.guiaEliminar);
        if (!guia) return;
        if (!confirm(`¿Eliminar la guía "${guia.nombre}"? Sus equipos dejarán de mostrar el "?".`)) return;
        await db.collection(COLECCION).doc(guia.id).delete();
      } else if (btn.dataset.guiaAgregar) {
        abrirSelector(btn.dataset.guiaAgregar);
      }
    } catch (err) {
      console.error('Error en la guía:', err);
      alert('No se pudo completar la acción. Revisa la consola.');
    }
  });

  btnNueva.addEventListener('click', async () => {
    try {
      await db.collection(COLECCION).add({ nombre: 'Guía nueva', texto: '', equipos: [], orden: Date.now() });
    } catch (err) {
      console.error('Error creando la guía:', err);
      alert('No se pudo crear la guía. Revisa la consola.');
    }
  });

  // ---------- Ventana: agregar equipos a una guía ----------

  let sel = null; // { guiaId, marcados: [], tipos: [tipoId], texto }

  function abrirSelector(guiaId) {
    const guia = guiasCache.find(g => g.id === guiaId);
    if (!guia) return;
    sel = { guiaId, marcados: (guia.equipos || []).slice(), tipos: [], texto: '' };
    selTitulo.textContent = `Agregar equipos a «${guia.nombre || 'la guía'}»`;
    selBuscar.value = '';
    pintarSelector();
    modalSel.classList.add('open');
    selBuscar.focus();
  }

  function cerrarSelector() {
    modalSel.classList.remove('open');
    sel = null;
  }

  function equiposVisibles() {
    const q = normalizar(sel.texto);
    return (window.equiposCache || []).filter(eq => {
      if (sel.tipos.length && !sel.tipos.includes(eq.tipoId)) return false;
      if (q && !normalizar(`${eq.nombre} ${eq.variante || ''}`).includes(q)) return false;
      return true;
    }).sort((a, b) => textoEquipo(a).localeCompare(textoEquipo(b), 'es'));
  }

  function filaSelector(clave, etiqueta, tipoTexto) {
    const otra = guiasCache.find(g => g.id !== sel.guiaId && (g.equipos || []).includes(clave));
    return `
      <label class="guia-sel-fila">
        <input type="checkbox" data-sel-clave="${escapeHtml(clave)}" ${sel.marcados.includes(clave) ? 'checked' : ''}>
        <span>${escapeHtml(etiqueta)}</span>
        ${tipoTexto ? `<span class="guia-sel-tipo">${escapeHtml(tipoTexto)}</span>` : ''}
        ${otra ? `<span class="guia-sel-en">en: ${escapeHtml(otra.nombre)}</span>` : ''}
      </label>`;
  }

  function pintarSelector() {
    selTipos.innerHTML = (window.tiposEquipoCache || []).map(t => {
      const on = sel.tipos.includes(t.id);
      return `<button type="button" class="guia-sel-chip ${on ? 'on' : ''}" data-sel-tipo="${t.id}">${t.icono ? t.icono + ' ' : ''}${escapeHtml(t.nombre)}${on ? ' ✕' : ''}</button>`;
    }).join('');

    selEsp.innerHTML = '<div class="guia-sel-sub">Equipos variables (no están en el catálogo)</div>' +
      ESPECIALES.map(e => filaSelector(e.id, e.nombre, '')).join('');

    const visibles = equiposVisibles();
    selLista.innerHTML = visibles.map(eq => {
      const tipo = buscarTipo(eq.tipoId);
      return filaSelector(eq.id, textoEquipo(eq), tipo ? `${tipo.icono ? tipo.icono + ' ' : ''}${tipo.nombre}` : '');
    }).join('') || '<div class="guia-sin-equipos" style="padding:10px;">Sin coincidencias</div>';

    selCont.textContent = `${visibles.length} visibles`;
    selResumen.textContent = `${sel.marcados.length} seleccionados`;
  }

  selBuscar.addEventListener('input', () => { sel.texto = selBuscar.value; pintarSelector(); });

  selTipos.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sel-tipo]');
    if (!btn) return;
    const id = btn.dataset.selTipo;
    sel.tipos = sel.tipos.includes(id) ? sel.tipos.filter(t => t !== id) : [...sel.tipos, id];
    pintarSelector();
  });

  modalSel.addEventListener('change', (e) => {
    const clave = e.target.dataset?.selClave;
    if (!clave) return;
    if (e.target.checked && !sel.marcados.includes(clave)) sel.marcados.push(clave);
    if (!e.target.checked) sel.marcados = sel.marcados.filter(c => c !== clave);
    selResumen.textContent = `${sel.marcados.length} seleccionados`;
  });

  document.getElementById('btn-guias-sel-todos').addEventListener('click', () => {
    equiposVisibles().forEach(eq => { if (!sel.marcados.includes(eq.id)) sel.marcados.push(eq.id); });
    pintarSelector();
  });

  document.getElementById('btn-guias-sel-ninguno').addEventListener('click', () => {
    const ids = new Set(equiposVisibles().map(eq => eq.id));
    sel.marcados = sel.marcados.filter(c => !ids.has(c));
    pintarSelector();
  });

  document.getElementById('btn-guias-sel-cancelar').addEventListener('click', cerrarSelector);
  document.getElementById('btn-guias-sel-x').addEventListener('click', cerrarSelector);
  modalSel.addEventListener('mousedown', (e) => { if (e.target === modalSel) cerrarSelector(); });

  document.getElementById('btn-guias-sel-guardar').addEventListener('click', async () => {
    const marcados = sel.marcados.filter((c, i, arr) => arr.indexOf(c) === i);
    // Un equipo solo puede estar en una guía: los que ya estaban en otra se mueven.
    const movidos = marcados.filter(c => guiasCache.some(g => g.id !== sel.guiaId && (g.equipos || []).includes(c)));
    if (movidos.length) {
      const lista = movidos.map(c => `• ${nombreDeClave(c).texto}`).join('\n');
      if (!confirm(`Estos equipos ya están en otra guía y pasarán a esta:\n\n${lista}\n\n¿Continuar?`)) return;
    }
    try {
      const batch = db.batch();
      guiasCache.forEach(g => {
        if (g.id === sel.guiaId) {
          batch.update(db.collection(COLECCION).doc(g.id), { equipos: marcados });
        } else if ((g.equipos || []).some(c => marcados.includes(c))) {
          batch.update(db.collection(COLECCION).doc(g.id), { equipos: g.equipos.filter(c => !marcados.includes(c)) });
        }
      });
      await batch.commit();
      cerrarSelector();
    } catch (err) {
      console.error('Error guardando los equipos de la guía:', err);
      alert('No se pudieron guardar los equipos de la guía. Revisa la consola.');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (modalSel.classList.contains('open')) cerrarSelector();
    else if (modalVisor.classList.contains('open')) cerrarVisor();
  });

  // El catálogo puede cambiar mientras la ventana está abierta.
  document.addEventListener('equipos-catalogo:cambio', () => { if (sel) pintarSelector(); render(); });
  document.addEventListener('tipos-equipo:cambio', () => { if (sel) pintarSelector(); });

  // ---------- Suscripción (solo con sesión iniciada) ----------

  function iniciarSuscripcion() {
    if (suscrito) return;
    suscrito = true;
    db.collection(COLECCION).onSnapshot(
      (snapshot) => {
        guiasCache = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .sort((a, b) => (a.orden || 0) - (b.orden || 0));
        window.guiasRemisionCache = guiasCache;
        render();
        document.dispatchEvent(new CustomEvent('guias:cambio'));
      },
      (err) => {
        console.error('Error escuchando guías de remisión:', err);
      }
    );
  }

  document.addEventListener('auth:listo', iniciarSuscripcion);
})();
