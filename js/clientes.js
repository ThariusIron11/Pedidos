// ================== Pestaña: Clientes / Compañías ==================
// CRUD de compañías sobre Firestore (colección "clientes").
//
// Cada compañía:
// {
//   nombre, tipo: 'normal' | 'subsidiaria' | 'subsidiaria_edisatech',
//   nit, direccion, direccionRemision, contraentrega: boolean,
//   contactosPedidos: ['nombre1', 'nombre2', ...],
//   contactosReparaciones: ['nombre1', 'nombre2', ...],
//   contactoReparaciones: 'nombre'   // (compatibilidad) = el primero de la lista
// }
// Las compañías antiguas solo tienen contactoReparaciones (un nombre); se
// leen como una lista de uno hasta que se vuelvan a guardar.
//
// Comportamiento del modal (igual al de Pedidos/Reparación en App Repuestos):
// - Clic por fuera (backdrop) cierra PERO conserva lo digitado (borrador).
// - Botón "Cancelar" cierra y SÍ limpia todo.
// - Si hay un borrador de una compañía nueva sin guardar y se vuelve a abrir
//   "+ Nueva compañía", se retoma ese borrador en vez de empezar en blanco.
// - Si hay un borrador de edición sin guardar y se vuelve a editar la MISMA
//   compañía, se retoma; si es otra compañía, se descarta y se carga la nueva.

(function () {
  const COLECCION = 'clientes';

  const TIPO_INFO = {
    normal: { label: null, icono: '🏢' },
    subsidiaria: { label: 'Subsidiaria', icono: '🔗' },
    subsidiaria_edisatech: { label: 'Subsidiaria de Edisatech', icono: '🏭' }
  };

  const tablaBody  = document.getElementById('tabla-clientes-body');
  const tablaEmpty = document.getElementById('clientes-empty');
  const modal       = document.getElementById('modal-cliente');
  const modalTitulo = document.getElementById('modal-cliente-titulo');
  const form         = document.getElementById('form-cliente');
  const buscador      = document.getElementById('buscador-clientes');
  const filtroTipo     = document.getElementById('filtro-tipo-clientes');

  const inputId               = document.getElementById('cliente-id');
  const inputNombre           = document.getElementById('cliente-nombre');
  const inputTipo             = document.getElementById('cliente-tipo');
  const inputNit               = document.getElementById('cliente-nit');
  const inputDireccion         = document.getElementById('cliente-direccion');
  const inputDireccionRemision = document.getElementById('cliente-direccion-remision');
  const inputContraentrega     = document.getElementById('cliente-contraentrega');
  const contactosPedidosList   = document.getElementById('contactos-pedidos-list');
  const grupoContactoReparaciones = document.getElementById('cliente-grupo-contacto-reparaciones');
  const contactosReparacionesList = document.getElementById('contactos-reparaciones-list');

  let clientesCache = []; // [{id, ...datos}] — también expuesto en window.clientesCache
  let filtroTexto = '';
  let filtroTipoValor = '';

  // Estado del borrador: 'id' del registro en edición ('' = compañía nueva),
  // o null si no hay ningún borrador activo (el modal fue cancelado/guardado).
  let borradorId = null;

  // ---------- Helpers ----------

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(str) {
    return String(str ?? '').replace(/"/g, '&quot;');
  }

  function normalizar(str) {
    return String(str ?? '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // quita tildes
  }

  // Palabras muy genéricas que no cuentan para decidir si dos nombres son
  // "parecidos" (si no, cualquier par de "S.A.S" terminaría marcado).
  const PALABRAS_IGNORADAS = new Set(['sa', 'ltda', 'sas', 'cia', 'compania', 'de', 'del', 'la', 'el', 'los', 'las', 'y']);

  function palabrasClave(nombre) {
    return normalizar(nombre)
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(p => p.length > 2 && !PALABRAS_IGNORADAS.has(p));
  }

  // Distancia de edición (cuántas letras hay que cambiar, agregar o quitar
  // para convertir un texto en el otro).
  function distanciaEdicion(a, b) {
    const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let anterior = fila[0];
      fila[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const temp = fila[j];
        fila[j] = Math.min(
          fila[j] + 1,
          fila[j - 1] + 1,
          anterior + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
        anterior = temp;
      }
    }
    return fila[b.length];
  }

  // Dos nombres son "parecidos" (posible duplicado por error) solo si:
  //  - tienen las mismas palabras clave, sin importar el orden, los S.A.S,
  //    Ltda., tildes ni signos ("Contegral S.A.S Envigado" = "Envigado Contegral"), o
  //  - son casi iguales letra por letra (un error de digitación:
  //    "Contegral Envigado" vs "Contegral Envigad").
  // Compartir solo UNA palabra NO basta: "Contegral Envigado" y "Contegral
  // Cartagena" son sedes distintas de la misma empresa, no un duplicado.
  function nombresSimilares(a, b) {
    const palabrasA = palabrasClave(a);
    const palabrasB = palabrasClave(b);
    if (!palabrasA.length || !palabrasB.length) return false;

    const mismasPalabras = palabrasA.length === palabrasB.length &&
      palabrasA.every(p => palabrasB.includes(p)) &&
      palabrasB.every(p => palabrasA.includes(p));
    if (mismasPalabras) return true;

    const textoA = palabrasA.join(' ');
    const textoB = palabrasB.join(' ');
    const largo = Math.max(textoA.length, textoB.length);
    const umbral = Math.max(1, Math.floor(largo / 8)); // ~1 error cada 8 letras
    return distanciaEdicion(textoA, textoB) <= umbral;
  }

  // Coincidencia EXACTA de nombre (ignorando mayúsculas/tildes) — esto sí es
  // casi siempre un registro duplicado por error, así que bloquea guardar.
  // El NIT ya NO se compara: una misma empresa puede tener varias sedes
  // registradas por separado con el mismo NIT, y eso es válido.
  function buscarClienteExacto(datos, idActual) {
    const nombreNorm = normalizar(datos.nombre);
    return clientesCache.find(c => c.id !== idActual && normalizar(c.nombre) === nombreNorm);
  }

  // Nombres casi idénticos pero NO exactos (posible duplicado por error de
  // digitación) — esto es solo un aviso para que confirmes que en verdad es
  // una empresa distinta, nunca bloquea el guardado.
  function buscarClientesParecidos(datos, idActual) {
    const nombreNorm = normalizar(datos.nombre);
    return clientesCache.filter(c =>
      c.id !== idActual &&
      normalizar(c.nombre) !== nombreNorm &&
      nombresSimilares(c.nombre, datos.nombre)
    );
  }

  // ---------- Lista dinámica de contactos de pedidos ----------

  function nuevaFilaContactoPedido(nombre) {
    const row = document.createElement('div');
    row.className = 'contacto-simple-row';
    row.innerHTML = `
      <input type="text" class="contacto-pedido-nombre" placeholder="Nombre" value="${escapeAttr(nombre || '')}">
      <button type="button" class="remove-contacto" title="Quitar contacto">✕</button>
    `;
    row.querySelector('.remove-contacto').addEventListener('click', () => row.remove());
    contactosPedidosList.appendChild(row);
  }

  function leerContactosPedidosDelFormulario() {
    const filas = contactosPedidosList.querySelectorAll('.contacto-pedido-nombre');
    const contactos = [];
    filas.forEach(input => {
      const nombre = input.value.trim();
      if (nombre) contactos.push(nombre);
    });
    return contactos;
  }

  document.getElementById('btn-add-contacto-pedidos').addEventListener('click', () => nuevaFilaContactoPedido());

  // ---------- Lista dinámica de contactos de reparaciones ----------

  // Lista de encargados de reparaciones de una compañía (las antiguas solo
  // tenían un nombre en contactoReparaciones).
  function contactosReparacionesDeCliente(cliente) {
    if (Array.isArray(cliente?.contactosReparaciones)) return cliente.contactosReparaciones.filter(Boolean);
    return cliente?.contactoReparaciones ? [cliente.contactoReparaciones] : [];
  }

  function nuevaFilaContactoRep(nombre) {
    const row = document.createElement('div');
    row.className = 'contacto-simple-row';
    row.innerHTML = `
      <input type="text" class="contacto-rep-nombre" placeholder="Nombre" value="${escapeAttr(nombre || '')}">
      <button type="button" class="remove-contacto" title="Quitar contacto">✕</button>
    `;
    row.querySelector('.remove-contacto').addEventListener('click', () => row.remove());
    contactosReparacionesList.appendChild(row);
  }

  function leerContactosRepDelFormulario() {
    const contactos = [];
    contactosReparacionesList.querySelectorAll('.contacto-rep-nombre').forEach(input => {
      const nombre = input.value.trim();
      if (nombre && !contactos.some(n => normalizar(n) === normalizar(nombre))) contactos.push(nombre);
    });
    return contactos;
  }

  document.getElementById('btn-add-contacto-reparaciones').addEventListener('click', () => nuevaFilaContactoRep());

  // ---------- Contacto de reparaciones: no aplica a subsidiarias ----------
  // (ni "Subsidiaria" ni "Subsidiaria de Edisatech" reciben pedidos de
  // reparaciones directamente, así que ese campo no tiene sentido para ellas).

  function esTipoSubsidiaria(tipo) {
    return tipo === 'subsidiaria' || tipo === 'subsidiaria_edisatech';
  }

  function actualizarVisibilidadContactoReparaciones() {
    const oculto = esTipoSubsidiaria(inputTipo.value);
    grupoContactoReparaciones.style.display = oculto ? 'none' : 'block';
    if (oculto) contactosReparacionesList.innerHTML = '';
    else if (!contactosReparacionesList.children.length) nuevaFilaContactoRep();
  }

  inputTipo.addEventListener('change', actualizarVisibilidadContactoReparaciones);

  // ---------- Cargar datos limpios de un cliente en el formulario ----------

  function cargarFormularioDesdeCliente(cliente) {
    form.reset();
    inputId.value = cliente ? cliente.id : '';
    inputNombre.value = cliente?.nombre || '';
    inputTipo.value = cliente?.tipo || 'normal';
    inputNit.value = cliente?.nit || '';
    inputDireccion.value = cliente?.direccion || '';
    inputDireccionRemision.value = cliente?.direccionRemision || '';
    inputContraentrega.checked = !!cliente?.contraentrega;
    contactosReparacionesList.innerHTML = '';
    contactosReparacionesDeCliente(cliente).forEach(nombre => nuevaFilaContactoRep(nombre));
    actualizarVisibilidadContactoReparaciones();

    contactosPedidosList.innerHTML = '';
    const contactos = cliente?.contactosPedidos || [];
    if (contactos.length) {
      contactos.forEach(nombre => nuevaFilaContactoPedido(nombre));
    } else {
      nuevaFilaContactoPedido();
    }
  }

  // ---------- Abrir / cerrar modal ----------

  function abrirModalNuevo() {
    if (borradorId === '') {
      // Ya había un borrador de compañía nueva en curso: se retoma tal cual.
      modalTitulo.textContent = 'Nueva compañía';
      modal.classList.add('open');
      inputNombre.focus();
      return;
    }
    modalTitulo.textContent = 'Nueva compañía';
    cargarFormularioDesdeCliente(null);
    borradorId = '';
    modal.classList.add('open');
    inputNombre.focus();
  }

  function abrirModalEditar(cliente) {
    if (borradorId === cliente.id) {
      // Ya había un borrador de edición de ESTA MISMA compañía: se retoma.
      modalTitulo.textContent = 'Editar compañía';
      modal.classList.add('open');
      inputNombre.focus();
      return;
    }
    modalTitulo.textContent = 'Editar compañía';
    cargarFormularioDesdeCliente(cliente);
    borradorId = cliente.id;
    modal.classList.add('open');
    inputNombre.focus();
  }

  function cerrarModalConservandoBorrador() {
    // Clic por fuera: solo oculta, no toca los datos digitados.
    modal.classList.remove('open');
  }

  function cancelarYLimpiar() {
    form.reset();
    contactosPedidosList.innerHTML = '';
    contactosReparacionesList.innerHTML = '';
    borradorId = null;
    modal.classList.remove('open');
  }

  document.getElementById('btn-nuevo-cliente').addEventListener('click', abrirModalNuevo);
  document.getElementById('btn-cancelar-cliente').addEventListener('click', cancelarYLimpiar);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModalConservandoBorrador();
  });

  // ---------- Guardar (crear/editar) ----------

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const datos = {
      nombre: inputNombre.value.trim(),
      tipo: inputTipo.value,
      nit: inputNit.value.trim(),
      direccion: inputDireccion.value.trim(),
      direccionRemision: inputDireccionRemision.value.trim(),
      contraentrega: inputContraentrega.checked,
      contactosPedidos: leerContactosPedidosDelFormulario(),
      contactosReparaciones: esTipoSubsidiaria(inputTipo.value) ? [] : leerContactosRepDelFormulario()
    };
    datos.contactoReparaciones = datos.contactosReparaciones[0] || ''; // compatibilidad

    if (!datos.nombre) {
      inputNombre.focus();
      return;
    }

    const id = inputId.value;

    const exacto = buscarClienteExacto(datos, id);
    if (exacto) {
      alert(`Ya existe una compañía con exactamente ese nombre: "${exacto.nombre}".`);
      inputNombre.focus();
      return;
    }

    // El aviso de nombres parecidos es solo para compañías nuevas o cuando se
    // le CAMBIA el nombre a una existente. Si ya estaba guardada y el nombre
    // no cambió, no tiene sentido volver a preguntar cada vez que se edita.
    const original = id ? clientesCache.find(c => c.id === id) : null;
    const nombreCambio = !original || normalizar(original.nombre) !== normalizar(datos.nombre);
    const parecidos = nombreCambio ? buscarClientesParecidos(datos, id) : [];
    if (parecidos.length) {
      const lista = parecidos.map(c => `• ${c.nombre}`).join('\n');
      const continuar = confirm(
        `Ya existen compañías con nombres parecidos:\n${lista}\n\n` +
        `¿"${datos.nombre}" es una compañía distinta (ej. otra sede)? Aceptar para guardarla igual.`
      );
      if (!continuar) {
        inputNombre.focus();
        return;
      }
    }

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
      // Guardado con éxito: ya no queda borrador pendiente.
      form.reset();
      contactosPedidosList.innerHTML = '';
      contactosReparacionesList.innerHTML = '';
      borradorId = null;
      modal.classList.remove('open');
    } catch (err) {
      console.error('Error guardando cliente:', err);
      alert('No se pudo guardar la compañía. Revisa la consola.');
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = 'Guardar';
    }
  });

  // ---------- Eliminar ----------

  async function eliminarCliente(cliente) {
    const ok = confirm(`¿Eliminar "${cliente.nombre}"? Esta acción no se puede deshacer.`);
    if (!ok) return;
    try {
      await db.collection(COLECCION).doc(cliente.id).delete();
    } catch (err) {
      console.error('Error eliminando cliente:', err);
      alert('No se pudo eliminar la compañía. Revisa la consola.');
    }
  }

  // ---------- Buscador ----------

  buscador.addEventListener('input', () => {
    filtroTexto = normalizar(buscador.value.trim());
    renderTabla();
  });

  filtroTipo.addEventListener('change', () => {
    filtroTipoValor = filtroTipo.value;
    renderTabla();
  });

  function clienteCoincideConFiltro(cliente) {
    if (filtroTipoValor && (cliente.tipo || 'normal') !== filtroTipoValor) return false;
    if (!filtroTexto) return true;
    if (normalizar(cliente.nombre).includes(filtroTexto)) return true;
    const contactos = [...(cliente.contactosPedidos || []), ...contactosReparacionesDeCliente(cliente)];
    return contactos.some(nombre => normalizar(nombre).includes(filtroTexto));
  }

  // ---------- Render de la tabla ----------

  function renderTabla() {
    const listaFiltrada = clientesCache.filter(clienteCoincideConFiltro);

    if (!listaFiltrada.length) {
      tablaBody.innerHTML = '';
      tablaEmpty.style.display = 'block';
      tablaEmpty.textContent = clientesCache.length
        ? 'Ninguna compañía coincide con la búsqueda.'
        : 'Todavía no hay compañías registradas.';
      return;
    }
    tablaEmpty.style.display = 'none';

    tablaBody.innerHTML = listaFiltrada.map(cliente => {
      const tipoInfo = TIPO_INFO[cliente.tipo] || TIPO_INFO.normal;
      const tipoTag = tipoInfo.label
        ? `<span class="tag-tipo ${cliente.tipo}">${tipoInfo.icono} ${tipoInfo.label}</span>`
        : '';
      const contraentregaTag = cliente.contraentrega
        ? '<span class="tag-contraentrega">Contraentrega</span>'
        : '';

      const direccionHtml = cliente.direccionRemision && cliente.direccionRemision !== cliente.direccion
        ? `${escapeHtml(cliente.direccion || '—')}<br><span style="color:var(--ink-soft); font-size:12px;">Remisión: ${escapeHtml(cliente.direccionRemision)}</span>`
        : escapeHtml(cliente.direccion || '—');

      const contactosPedidos = cliente.contactosPedidos || [];
      const contactosPedidosHtml = contactosPedidos.length
        ? contactosPedidos.map(escapeHtml).join(', ')
        : '<span style="color:var(--ink-soft);">—</span>';
      const contactosRep = contactosReparacionesDeCliente(cliente);
      const contactoRepHtml = contactosRep.length
        ? contactosRep.map(escapeHtml).join(', ')
        : '<span style="color:var(--ink-soft);">—</span>';

      // Las subsidiarias no reciben pedidos de reparaciones, así que esa
      // línea directamente no se muestra para ellas.
      const contactosHtml = `
        <div>Pedidos: ${contactosPedidosHtml}</div>
        ${esTipoSubsidiaria(cliente.tipo) ? '' : `<div>Reparaciones: ${contactoRepHtml}</div>`}
      `;

      return `
        <tr data-id="${cliente.id}" class="fila-cliente-clicable">
          <td>${tipoInfo.icono} ${escapeHtml(cliente.nombre)}${tipoTag}${contraentregaTag}</td>
          <td>${escapeHtml(cliente.nit || '—')}</td>
          <td>${direccionHtml}</td>
          <td>${contactosHtml}</td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn-icon btn-eliminar danger" data-id="${cliente.id}" title="Eliminar">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Clic en cualquier parte de la fila (fuera del botón eliminar) abre
    // directamente la edición de esa compañía.
    tablaBody.querySelectorAll('tr.fila-cliente-clicable').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const cliente = clientesCache.find(c => c.id === tr.dataset.id);
        if (cliente) abrirModalEditar(cliente);
      });
    });

    tablaBody.querySelectorAll('.btn-eliminar').forEach(btn => {
      btn.addEventListener('click', () => {
        const cliente = clientesCache.find(c => c.id === btn.dataset.id);
        if (cliente) eliminarCliente(cliente);
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
        clientesCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        window.clientesCache = clientesCache;
        renderTabla();
        document.dispatchEvent(new CustomEvent('clientes:cambio', { detail: { clientes: clientesCache } }));
      },
      (err) => {
        console.error('Error escuchando clientes:', err);
      }
    );
  }

  // Se necesita en cuanto arranca la app (otros módulos leen
  // window.clientesCache desde el principio), pero solo después de que
  // haya sesión iniciada — antes de eso, Firestore rechazaría la lectura.
  document.addEventListener('auth:listo', () => iniciarSuscripcion());

  document.addEventListener('tab:activada', (e) => {
    if (e.detail.tab !== 'clientes') return;
    iniciarSuscripcion();
  });
})();
