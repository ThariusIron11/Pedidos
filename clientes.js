// ================== Pestaña: Clientes / Compañías ==================
// CRUD de compañías sobre Firestore (colección "clientes").
// Cada compañía: { nombre, direccion, contactos: [{nombre, telefono, recibeReparaciones}] }

(function () {
  const COLECCION = 'clientes';

  const tablaBody   = document.getElementById('tabla-clientes-body');
  const tablaEmpty  = document.getElementById('clientes-empty');
  const modal       = document.getElementById('modal-cliente');
  const modalTitulo = document.getElementById('modal-cliente-titulo');
  const form        = document.getElementById('form-cliente');
  const inputId     = document.getElementById('cliente-id');
  const inputNombre = document.getElementById('cliente-nombre');
  const inputDireccion = document.getElementById('cliente-direccion');
  const contactosList  = document.getElementById('contactos-list');

  let clientesCache = []; // [{id, nombre, direccion, contactos}]
  let contactoUid = 0;    // id incremental solo para las filas del formulario (no se guarda)

  // ---------- Utilidades del formulario de contactos ----------

  function nuevaFilaContacto(contacto) {
    contactoUid++;
    const uid = 'c' + contactoUid;

    const row = document.createElement('div');
    row.className = 'contacto-row';
    row.dataset.uid = uid;
    row.innerHTML = `
      <input type="text" class="contacto-nombre" placeholder="Nombre" value="${escapeAttr(contacto?.nombre || '')}">
      <input type="tel" class="contacto-telefono" placeholder="Teléfono">
      <label class="radio-rep">
        <input type="radio" name="recibeReparaciones" value="${uid}" ${contacto?.recibeReparaciones ? 'checked' : ''}>
        Recibe reparaciones
      </label>
      <button type="button" class="remove-contacto" title="Quitar contacto">✕</button>
    `;
    row.querySelector('.contacto-telefono').value = contacto?.telefono || '';
    row.querySelector('.remove-contacto').addEventListener('click', () => row.remove());
    contactosList.appendChild(row);
  }

  function leerContactosDelFormulario() {
    const filas = contactosList.querySelectorAll('.contacto-row');
    const contactos = [];
    filas.forEach(fila => {
      const nombre = fila.querySelector('.contacto-nombre').value.trim();
      if (!nombre) return; // ignora filas vacías
      const telefono = fila.querySelector('.contacto-telefono').value.trim();
      const radio = fila.querySelector('input[type="radio"]');
      contactos.push({
        nombre,
        telefono,
        recibeReparaciones: radio.checked
      });
    });
    return contactos;
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;');
  }
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ---------- Modal ----------

  function abrirModalNuevo() {
    modalTitulo.textContent = 'Nueva compañía';
    form.reset();
    inputId.value = '';
    contactosList.innerHTML = '';
    nuevaFilaContacto(); // arranca con un contacto vacío
    modal.classList.add('open');
    inputNombre.focus();
  }

  function abrirModalEditar(cliente) {
    modalTitulo.textContent = 'Editar compañía';
    form.reset();
    inputId.value = cliente.id;
    inputNombre.value = cliente.nombre || '';
    inputDireccion.value = cliente.direccion || '';
    contactosList.innerHTML = '';
    if (cliente.contactos && cliente.contactos.length) {
      cliente.contactos.forEach(c => nuevaFilaContacto(c));
    } else {
      nuevaFilaContacto();
    }
    modal.classList.add('open');
    inputNombre.focus();
  }

  function cerrarModal() {
    modal.classList.remove('open');
  }

  document.getElementById('btn-nuevo-cliente').addEventListener('click', abrirModalNuevo);
  document.getElementById('btn-cancelar-cliente').addEventListener('click', cerrarModal);
  document.getElementById('btn-add-contacto').addEventListener('click', () => nuevaFilaContacto());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModal(); // click en el backdrop cierra
  });

  // ---------- Guardar (crear/editar) ----------

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const datos = {
      nombre: inputNombre.value.trim(),
      direccion: inputDireccion.value.trim(),
      contactos: leerContactosDelFormulario()
    };

    if (!datos.nombre) {
      inputNombre.focus();
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
        datos.creadoEn = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection(COLECCION).add(datos);
      }
      cerrarModal();
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

  // ---------- Render de la tabla ----------

  function renderTabla() {
    if (!clientesCache.length) {
      tablaBody.innerHTML = '';
      tablaEmpty.style.display = 'block';
      return;
    }
    tablaEmpty.style.display = 'none';

    tablaBody.innerHTML = clientesCache.map(cliente => {
      const contactos = cliente.contactos || [];
      const contactosHtml = contactos.length
        ? contactos.map(c => {
            const tag = c.recibeReparaciones ? '<span class="tag-reparaciones">Reparaciones</span>' : '';
            return `${escapeHtml(c.nombre)}${c.telefono ? ' · ' + escapeHtml(c.telefono) : ''}${tag}`;
          }).join('<br>')
        : '<span style="color:var(--ink-soft);">Sin contactos</span>';

      return `
        <tr data-id="${cliente.id}">
          <td>${escapeHtml(cliente.nombre)}</td>
          <td>${escapeHtml(cliente.direccion || '—')}</td>
          <td>${contactosHtml}</td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn-editar" data-id="${cliente.id}">Editar</button>
              <button type="button" class="btn-eliminar danger" data-id="${cliente.id}">Eliminar</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tablaBody.querySelectorAll('.btn-editar').forEach(btn => {
      btn.addEventListener('click', () => {
        const cliente = clientesCache.find(c => c.id === btn.dataset.id);
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
        renderTabla();
      },
      (err) => {
        console.error('Error escuchando clientes:', err);
      }
    );
  }

  // Carga apenas el script entra en memoria (la pestaña Clientes es
  // barata de mantener sincronizada aunque el usuario no esté mirándola).
  iniciarSuscripcion();

  document.addEventListener('tab:activada', (e) => {
    if (e.detail.tab !== 'clientes') return;
    iniciarSuscripcion();
  });
})();
