// ================== Pestaña: Historial ==================
// Registro de partes/piezas mandadas a fabricar (ej. rebobinado de un
// estator) a alguna subsidiaria de Edisatech.
//
// Cada pieza:
// {
//   subsidiariaId,          // id de un cliente con tipo 'subsidiaria_edisatech'
//   descripcion,            // qué se mandó a hacer (texto libre)
//   fechaInicio,             // 'YYYY-MM-DD' — cuándo se envió
//   recogido: boolean,      // false = todavía en fabricación, true = ya se recogió
//   fechaRecogido,           // 'YYYY-MM-DD' o null si sigue pendiente
//   queSeRealizo             // texto libre, solo se llena al marcar como recogido
// }
//
// Mientras no se recoge: aparece agrupada bajo su subsidiaria en "En
// fabricación", y se puede editar (subsidiaria/descripción/fecha) haciendo
// clic en la fila. Una vez marcada como recogida, pasa a "Completados" como
// fila de una tabla de solo lectura — ya no se puede editar ni deshacer.

(function () {
  const COLECCION = 'fabricacion';

  const panel = document.getElementById('panel-historial');
  const btnNuevaPieza = document.getElementById('btn-nueva-pieza-fabricacion');

  const chipsFiltro = document.querySelectorAll('#filtro-estado-fabricacion .chip-filtro-estado');
  const seccionPendientes = document.getElementById('seccion-fabricacion-pendientes');
  const seccionCompletados = document.getElementById('seccion-fabricacion-completados');
  const contenedorPendientes = document.getElementById('fabricacion-pendientes');
  const pendientesVacio = document.getElementById('fabricacion-pendientes-empty');
  const completadosVacio = document.getElementById('fabricacion-completados-empty');
  const tablaCompletadosBody = document.getElementById('tabla-fabricacion-completados-body');

  // ---------- Modal: nueva pieza / editar pieza pendiente ----------
  const modal = document.getElementById('modal-fabricacion');
  const modalTitulo = document.getElementById('modal-fabricacion-titulo');
  const form = document.getElementById('form-fabricacion');
  const inputId = document.getElementById('fabricacion-id');
  const selectSubsidiaria = document.getElementById('fabricacion-subsidiaria');
  const grupoContacto = document.getElementById('fabricacion-grupo-contacto');
  const selectContacto = document.getElementById('fabricacion-contacto');
  const inputDescripcion = document.getElementById('fabricacion-descripcion');
  const inputFechaInicio = document.getElementById('fabricacion-fecha-inicio');
  const inputCosto = document.getElementById('fabricacion-costo');

  // ---------- Modal: marcar como recogido ----------
  const modalRecoger = document.getElementById('modal-fabricacion-recoger');
  const formRecoger = document.getElementById('form-fabricacion-recoger');
  const inputRecogerId = document.getElementById('fabricacion-recoger-id');
  const recogerResumenSubsidiaria = document.getElementById('fabricacion-recoger-resumen-subsidiaria');
  const recogerResumenDescripcion = document.getElementById('fabricacion-recoger-resumen-descripcion');
  const inputFechaRecogido = document.getElementById('fabricacion-fecha-recogido');
  const inputQueSeRealizo = document.getElementById('fabricacion-que-se-realizo');
  const inputCostoRecoger = document.getElementById('fabricacion-recoger-costo');

  // ---------- Modal: editar el costo de una pieza ya completada ----------
  const modalCosto = document.getElementById('modal-fabricacion-costo');
  const formCosto = document.getElementById('form-fabricacion-costo');
  const inputCostoId = document.getElementById('fabricacion-costo-id');
  const costoResumenSubsidiaria = document.getElementById('fabricacion-costo-resumen-subsidiaria');
  const costoResumenDescripcion = document.getElementById('fabricacion-costo-resumen-descripcion');
  const inputCostoValor = document.getElementById('fabricacion-costo-valor');

  let historialCache = []; // [{id, ...datos}]
  let filtroEstado = 'pendiente'; // 'pendiente' | 'completado'

  // Borrador: 'id' del registro en edición ('' = pieza nueva), o null si no
  // hay ningún borrador activo (mismo patrón usado en Clientes/Pedidos).
  let borradorId = null;

  // ---------- Helpers ----------

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function fechaHoyISO() {
    const hoy = new Date();
    const mes = String(hoy.getMonth() + 1).padStart(2, '0');
    const dia = String(hoy.getDate()).padStart(2, '0');
    return `${hoy.getFullYear()}-${mes}-${dia}`;
  }

  function formatearFecha(fechaISO) {
    if (!fechaISO) return '—';
    const [anio, mes, dia] = fechaISO.split('-');
    const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${parseInt(dia, 10)} ${meses[parseInt(mes, 10) - 1]} ${anio}`;
  }

  function formatearCosto(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const numero = Number(valor);
    if (Number.isNaN(numero)) return null;
    return '$ ' + Math.round(numero).toLocaleString('es-CO');
  }

  // Toma cualquier texto (ya formateado con puntos de miles o no) y devuelve
  // el número entero que representa, o null si quedó vacío. Se descartan
  // todos los caracteres no numéricos (incluido el punto), porque en
  // formato colombiano el punto es separador de miles, no decimal.
  function parsearCosto(texto) {
    const soloDigitos = String(texto ?? '').replace(/\D/g, '');
    return soloDigitos ? parseInt(soloDigitos, 10) : null;
  }

  // Autoformatea un input de costo mientras se escribe: "250000" -> "250.000".
  function activarAutoformatoCosto(input) {
    input.addEventListener('input', () => {
      const numero = parsearCosto(input.value);
      input.value = numero != null ? numero.toLocaleString('es-CO') : '';
    });
  }
  activarAutoformatoCosto(inputCosto);
  activarAutoformatoCosto(inputCostoRecoger);
  activarAutoformatoCosto(inputCostoValor);

  // Días corridos desde fechaInicio hasta hoy (para que se note lo que
  // lleva más tiempo esperando en cada subsidiaria).
  function diasTranscurridos(fechaISO) {
    if (!fechaISO) return null;
    const inicio = new Date(fechaISO + 'T00:00:00');
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return Math.round((hoy - inicio) / 86400000);
  }

  function subsidiariasEdisatech() {
    return (window.clientesCache || []).filter(c => c.tipo === 'subsidiaria_edisatech');
  }

  function nombreSubsidiaria(subsidiariaId) {
    const subsidiaria = (window.clientesCache || []).find(c => c.id === subsidiariaId);
    return subsidiaria ? subsidiaria.nombre : null;
  }

  // ---------- Select de subsidiaria (modal nueva/editar) ----------

  function poblarSelectSubsidiarias() {
    const seleccionActual = selectSubsidiaria.value;
    const subsidiarias = subsidiariasEdisatech();
    selectSubsidiaria.innerHTML =
      '<option value="">Selecciona una subsidiaria...</option>' +
      subsidiarias.map(s => `<option value="${s.id}">${escapeHtml(s.nombre)}</option>`).join('');
    if (subsidiarias.some(s => s.id === seleccionActual)) selectSubsidiaria.value = seleccionActual;
  }

  document.addEventListener('clientes:cambio', () => {
    poblarSelectSubsidiarias();
    // Si el modal está abierto y la subsidiaria elegida sigue siendo válida,
    // sus contactos también pueden haber cambiado (se agregó/renombró uno).
    if (modal.classList.contains('open')) poblarSelectContacto(selectSubsidiaria.value, selectContacto.value);
    renderTodo(); // los nombres de subsidiaria mostrados en las tarjetas/tabla pueden haber cambiado
  });

  // ---------- Select de contacto de recibir pedidos (depende de la subsidiaria elegida) ----------
  // Por defecto se usa el PRIMER contacto registrado en esa compañía, pero
  // se deja el select abierto por si en el futuro una compañía llega a
  // tener más de uno y hace falta elegir cuál recibió esta pieza.
  function poblarSelectContacto(subsidiariaId, contactoPreferido) {
    const cliente = (window.clientesCache || []).find(c => c.id === subsidiariaId);
    const contactos = (cliente?.contactosPedidos || []).filter(Boolean);

    if (!contactos.length) {
      grupoContacto.style.display = 'none';
      selectContacto.innerHTML = '';
      return;
    }
    grupoContacto.style.display = '';
    selectContacto.innerHTML = contactos.map(nombre => `<option value="${escapeHtml(nombre)}">${escapeHtml(nombre)}</option>`).join('');
    // Si el contacto que ya traía la pieza (editando) sigue en la lista, se
    // respeta; si no (pieza nueva, o ese contacto ya no existe), se cae al
    // primero de la compañía — el comportamiento "por defecto" pedido.
    selectContacto.value = contactos.includes(contactoPreferido) ? contactoPreferido : contactos[0];
  }

  selectSubsidiaria.addEventListener('change', () => {
    // Cambiar de subsidiaria es una compañía distinta — no tiene sentido
    // conservar el contacto anterior, así que siempre vuelve al primero.
    poblarSelectContacto(selectSubsidiaria.value, null);
  });

  // ---------- Cargar datos limpios en el formulario ----------

  function cargarFormularioDesdePieza(pieza) {
    form.reset();
    poblarSelectSubsidiarias();
    inputId.value = pieza ? pieza.id : '';
    selectSubsidiaria.value = pieza?.subsidiariaId || '';
    poblarSelectContacto(selectSubsidiaria.value, pieza?.contacto || null);
    inputDescripcion.value = pieza?.descripcion || '';
    inputFechaInicio.value = pieza?.fechaInicio || fechaHoyISO();
    inputCosto.value = pieza?.costo != null ? Number(pieza.costo).toLocaleString('es-CO') : '';
  }

  // ---------- Abrir / cerrar modal nueva/editar ----------

  function abrirModalNuevo() {
    if (borradorId === '') {
      modalTitulo.textContent = 'Nueva pieza en fabricación';
      modal.classList.add('open');
      selectSubsidiaria.focus();
      return;
    }
    modalTitulo.textContent = 'Nueva pieza en fabricación';
    cargarFormularioDesdePieza(null);
    borradorId = '';
    modal.classList.add('open');
    selectSubsidiaria.focus();
  }

  function abrirModalEditar(pieza) {
    if (borradorId === pieza.id) {
      modalTitulo.textContent = 'Editar pieza en fabricación';
      modal.classList.add('open');
      selectSubsidiaria.focus();
      return;
    }
    modalTitulo.textContent = 'Editar pieza en fabricación';
    cargarFormularioDesdePieza(pieza);
    borradorId = pieza.id;
    modal.classList.add('open');
    selectSubsidiaria.focus();
  }

  function cerrarModalConservandoBorrador() {
    modal.classList.remove('open');
  }

  function cancelarYLimpiar() {
    form.reset();
    borradorId = null;
    modal.classList.remove('open');
  }

  btnNuevaPieza.addEventListener('click', abrirModalNuevo);
  document.getElementById('btn-cancelar-fabricacion').addEventListener('click', cancelarYLimpiar);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModalConservandoBorrador();
  });

  // ---------- Guardar (crear/editar) — solo aplica a piezas pendientes ----------

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const datos = {
      subsidiariaId: selectSubsidiaria.value,
      contacto: grupoContacto.style.display !== 'none' ? (selectContacto.value || null) : null,
      descripcion: inputDescripcion.value.trim(),
      fechaInicio: inputFechaInicio.value || fechaHoyISO(),
      costo: parsearCosto(inputCosto.value)
    };

    if (!datos.subsidiariaId) {
      selectSubsidiaria.focus();
      return;
    }
    if (!datos.descripcion) {
      inputDescripcion.focus();
      return;
    }

    const id = inputId.value;
    const btnGuardar = form.querySelector('button[type="submit"]');
    btnGuardar.disabled = true;
    btnGuardar.textContent = 'Guardando...';

    try {
      if (id) {
        await db.collection(COLECCION).doc(id).update(datos);
      } else {
        datos.recogido = false;
        datos.fechaRecogido = null;
        datos.queSeRealizo = '';
        datos.creadoEn = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection(COLECCION).add(datos);
      }
      form.reset();
      borradorId = null;
      modal.classList.remove('open');
    } catch (err) {
      console.error('Error guardando pieza en fabricación:', err);
      alert('No se pudo guardar. Revisa la consola.');
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = 'Guardar';
    }
  });

  // ---------- Marcar como recogido ----------
  // A partir de aquí la pieza queda fija: no se vuelve a poder editar ni a
  // devolver a "En fabricación".

  function abrirModalRecoger(pieza) {
    inputRecogerId.value = pieza.id;
    recogerResumenSubsidiaria.textContent = nombreSubsidiaria(pieza.subsidiariaId) || 'Subsidiaria no encontrada';
    recogerResumenDescripcion.textContent = pieza.descripcion;
    inputFechaRecogido.value = fechaHoyISO();
    inputQueSeRealizo.value = '';
    inputCostoRecoger.value = pieza.costo != null ? Number(pieza.costo).toLocaleString('es-CO') : '';
    modalRecoger.classList.add('open');
    inputQueSeRealizo.focus();
  }

  function cerrarModalRecoger() {
    modalRecoger.classList.remove('open');
    formRecoger.reset();
  }

  // ---------- Editar el costo de una pieza YA completada ----------
  // Es la única cosa que se puede seguir ajustando después de recogida —
  // todo lo demás (subsidiaria, descripción, qué se realizó, etc.) queda
  // fijo para siempre, como corresponde a un registro histórico.

  function abrirModalCosto(pieza) {
    inputCostoId.value = pieza.id;
    costoResumenSubsidiaria.textContent = nombreSubsidiaria(pieza.subsidiariaId) || 'Subsidiaria no encontrada';
    costoResumenDescripcion.textContent = pieza.descripcion;
    inputCostoValor.value = pieza.costo != null ? Number(pieza.costo).toLocaleString('es-CO') : '';
    modalCosto.classList.add('open');
    inputCostoValor.focus();
  }

  function cerrarModalCosto() {
    modalCosto.classList.remove('open');
    formCosto.reset();
  }

  document.getElementById('btn-cancelar-fabricacion-costo').addEventListener('click', cerrarModalCosto);
  modalCosto.addEventListener('click', (e) => {
    if (e.target === modalCosto) cerrarModalCosto();
  });

  formCosto.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = inputCostoId.value;
    const btnGuardarCosto = formCosto.querySelector('button[type="submit"]');
    btnGuardarCosto.disabled = true;
    btnGuardarCosto.textContent = 'Guardando...';
    try {
      await db.collection(COLECCION).doc(id).update({
        costo: parsearCosto(inputCostoValor.value)
      });
      cerrarModalCosto();
    } catch (err) {
      console.error('Error guardando el costo:', err);
      alert('No se pudo guardar. Revisa la consola.');
    } finally {
      btnGuardarCosto.disabled = false;
      btnGuardarCosto.textContent = 'Guardar';
    }
  });

  document.getElementById('btn-cancelar-fabricacion-recoger').addEventListener('click', cerrarModalRecoger);
  modalRecoger.addEventListener('click', (e) => {
    if (e.target === modalRecoger) cerrarModalRecoger();
  });

  formRecoger.addEventListener('submit', async (e) => {
    e.preventDefault();

    const queSeRealizo = inputQueSeRealizo.value.trim();
    if (!queSeRealizo) {
      inputQueSeRealizo.focus();
      return;
    }

    const ok = confirm('Al confirmar, esta ficha pasa a "Completados" y ya no se podrá editar. ¿Continuar?');
    if (!ok) return;

    const id = inputRecogerId.value;
    const btnConfirmar = formRecoger.querySelector('button[type="submit"]');
    btnConfirmar.disabled = true;
    btnConfirmar.textContent = 'Guardando...';

    try {
      await db.collection(COLECCION).doc(id).update({
        recogido: true,
        fechaRecogido: inputFechaRecogido.value || fechaHoyISO(),
        queSeRealizo,
        costo: parsearCosto(inputCostoRecoger.value)
      });
      cerrarModalRecoger();
    } catch (err) {
      console.error('Error marcando la pieza como recogida:', err);
      alert('No se pudo guardar. Revisa la consola.');
    } finally {
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = 'Confirmar recogida';
    }
  });

  // ---------- Filtro Pendientes / Completados ----------

  chipsFiltro.forEach(chip => {
    chip.classList.toggle('active', chip.dataset.estado === filtroEstado);
    chip.addEventListener('click', () => {
      filtroEstado = chip.dataset.estado;
      chipsFiltro.forEach(c => c.classList.toggle('active', c === chip));
      renderTodo();
    });
  });

  // ---------- Render: "En fabricación" agrupado por subsidiaria ----------

  function renderPendientes() {
    const pendientes = historialCache.filter(h => !h.recogido);

    if (!pendientes.length) {
      contenedorPendientes.innerHTML = '';
      pendientesVacio.style.display = 'block';
      return;
    }
    pendientesVacio.style.display = 'none';

    // Se agrupa por subsidiaria y se ordena cada grupo por fecha de inicio
    // (lo más antiguo primero, así lo que lleva más tiempo queda arriba).
    const grupos = new Map();
    pendientes.forEach(pieza => {
      const clave = pieza.subsidiariaId || '';
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(pieza);
    });
    grupos.forEach(lista => lista.sort((a, b) => (a.fechaInicio || '').localeCompare(b.fechaInicio || '')));

    // Los grupos se ordenan alfabéticamente por nombre de subsidiaria.
    const gruposOrdenados = Array.from(grupos.entries()).sort((a, b) => {
      const nombreA = nombreSubsidiaria(a[0]) || '';
      const nombreB = nombreSubsidiaria(b[0]) || '';
      return nombreA.localeCompare(nombreB);
    });

    contenedorPendientes.innerHTML = gruposOrdenados.map(([subsidiariaId, piezas]) => {
      const nombre = nombreSubsidiaria(subsidiariaId);
      const nombreHtml = nombre
        ? escapeHtml(nombre)
        : '<span style="color:var(--danger);">Subsidiaria no encontrada</span>';

      const piezasHtml = piezas.map(pieza => {
        const dias = diasTranscurridos(pieza.fechaInicio);
        const claseDias = dias !== null && dias >= 10 ? 'atrasado' : '';
        const diasHtml = dias !== null
          ? `<span class="dias ${claseDias}">${dias} día${dias === 1 ? '' : 's'}</span>`
          : '';
        const costoTexto = formatearCosto(pieza.costo);
        const costoHtml = costoTexto ? ` · ${costoTexto}` : '';
        const contactoHtml = pieza.contacto ? ` · 👤 ${escapeHtml(pieza.contacto)}` : '';
        return `
          <div class="pieza-row" data-id="${pieza.id}">
            <div class="pieza-info">
              <div class="pieza-descripcion">${escapeHtml(pieza.descripcion)}</div>
              <div class="pieza-fecha">Enviado: ${formatearFecha(pieza.fechaInicio)} ${diasHtml}${costoHtml}${contactoHtml}</div>
            </div>
            <button type="button" class="btn-recoger" data-id="${pieza.id}">✔ Marcar recogido</button>
            <button type="button" class="btn-icon-inline btn-eliminar-pieza" data-id="${pieza.id}" title="Eliminar">🗑️</button>
          </div>
        `;
      }).join('');

      return `
        <div class="grupo-subsidiaria">
          <div class="grupo-subsidiaria-titulo">
            <span class="icono">🏭</span> ${nombreHtml}
            <span class="contador">${piezas.length} pieza${piezas.length === 1 ? '' : 's'}</span>
          </div>
          ${piezasHtml}
        </div>
      `;
    }).join('');

    // Clic en la fila (fuera del botón) abre la edición; clic en el botón
    // abre el modal de "marcar como recogido".
    contenedorPendientes.querySelectorAll('.pieza-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const pieza = historialCache.find(h => h.id === row.dataset.id);
        if (pieza) abrirModalEditar(pieza);
      });
    });
    contenedorPendientes.querySelectorAll('.btn-recoger').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pieza = historialCache.find(h => h.id === btn.dataset.id);
        if (pieza) abrirModalRecoger(pieza);
      });
    });
    contenedorPendientes.querySelectorAll('.btn-eliminar-pieza').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const pieza = historialCache.find(h => h.id === btn.dataset.id);
        if (!pieza) return;
        const ok = confirm(`¿Eliminar "${pieza.descripcion}"? Esta acción no se puede deshacer.`);
        if (!ok) return;
        try {
          await db.collection(COLECCION).doc(pieza.id).delete();
        } catch (err) {
          console.error('Error eliminando la pieza:', err);
          alert('No se pudo eliminar. Revisa la consola.');
        }
      });
    });
  }

  // ---------- Render: "Completados" — tabla plana, de solo lectura ----------

  function renderCompletados() {
    const completados = historialCache
      .filter(h => h.recogido)
      .sort((a, b) => (b.fechaRecogido || '').localeCompare(a.fechaRecogido || '')); // más reciente primero

    if (!completados.length) {
      tablaCompletadosBody.innerHTML = '';
      completadosVacio.style.display = 'block';
      return;
    }
    completadosVacio.style.display = 'none';

    tablaCompletadosBody.innerHTML = completados.map(pieza => {
      const nombre = nombreSubsidiaria(pieza.subsidiariaId);
      const nombreHtml = nombre
        ? `<span class="tag-subsidiaria">${escapeHtml(nombre)}</span>`
        : '<span style="color:var(--danger);">Subsidiaria no encontrada</span>';
      const costoTexto = formatearCosto(pieza.costo) || '<span style="color:var(--ink-soft);">Sin registrar</span>';
      return `
        <tr>
          <td>${nombreHtml}</td>
          <td>${pieza.contacto ? escapeHtml(pieza.contacto) : '<span style="color:var(--ink-soft);">—</span>'}</td>
          <td>${escapeHtml(pieza.descripcion)}</td>
          <td>${formatearFecha(pieza.fechaInicio)}</td>
          <td>${formatearFecha(pieza.fechaRecogido)}</td>
          <td>${escapeHtml(pieza.queSeRealizo || '—')}</td>
          <td>
            <div style="display:flex; align-items:center; gap:6px;">
              <span>${costoTexto}</span>
              <button type="button" class="btn-icon-inline btn-editar-costo" data-id="${pieza.id}" title="Editar costo">✏️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tablaCompletadosBody.querySelectorAll('.btn-editar-costo').forEach(btn => {
      btn.addEventListener('click', () => {
        const pieza = historialCache.find(h => h.id === btn.dataset.id);
        if (pieza) abrirModalCosto(pieza);
      });
    });
  }

  function renderTodo() {
    seccionPendientes.style.display = filtroEstado === 'pendiente' ? '' : 'none';
    seccionCompletados.style.display = filtroEstado === 'completado' ? '' : 'none';
    renderPendientes();
    renderCompletados();
  }

  // ---------- Suscripción en tiempo real ----------
  // Esta pestaña no la necesita ningún otro módulo, así que solo se
  // suscribe cuando se entra a la pestaña Historial (ahorra lecturas de
  // Firestore mientras nadie la está viendo).

  let suscrito = false;
  function iniciarSuscripcion() {
    if (suscrito) return;
    suscrito = true;
    db.collection(COLECCION).onSnapshot(
      (snapshot) => {
        historialCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        window.historialCache = historialCache;
        renderTodo();
      },
      (err) => {
        console.error('Error escuchando fabricación:', err);
      }
    );
  }

  document.addEventListener('tab:activada', (e) => {
    if (e.detail.tab !== 'historial') return;
    poblarSelectSubsidiarias();
    iniciarSuscripcion();
  });
})();
