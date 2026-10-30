// =====================================================================
// Roles de usuario: "edicion" (como siempre), "lectura" (solo observar),
// "parcial" (solo lectura, salvo Simulaciones) y "tecnico" (solo lectura,
// salvo las fichas de observación de las Reparaciones).
//
// El rol sale del documento  usuarios/{uid}  (el mismo que ya usa auth.js
// para dar acceso), campo  rol :
//     'normal'  → edición (como siempre)
//     'lectura' → solo lectura
//     'parcial' → solo lectura en todo, MENOS las simulaciones de Envíos:
//                 ahí puede crear, editar y eliminar (ver reglas abajo)
//     'tecnico' → solo lectura en todo, MENOS las fichas de observación de
//                 las reparaciones: puede crearlas, editarlas, fijarlas y
//                 eliminarlas (reparaciones/{id}/observaciones)
// auth.js lo lee al iniciar sesión y lo entrega en el evento 'auth:listo'.
//
// Un usuario de lectura puede: abrir fichas, moverse entre pestañas, buscar
// y filtrar, abrir/copiar links de evidencia y descargar/compartir la remesa.
// No puede crear, editar, eliminar, despachar ni guardar nada.
//
// ¡OJO!: esto bloquea la interfaz y las escrituras desde la app, pero la
// protección REAL contra escrituras la dan las reglas de seguridad de
// Firestore (ver las instrucciones que acompañan a este archivo).
// =====================================================================
(function () {
  'use strict';

  let rol = null;            // null = sin resolver | 'edicion' | 'lectura' | 'parcial' | 'tecnico'
  let motivo = '';

  window.rolUsuario = () => rol;
  window.puedeEditar = () => rol === 'edicion';
  window.puedeEditarSimulaciones = () => rol === 'edicion' || rol === 'parcial';
  window.puedeEditarObservaciones = () => rol === 'edicion' || rol === 'tecnico';

  // El rol "parcial" solo puede escribir en esta colección de Firestore, y
  // solo puede tocar controles dentro de estas zonas de la pantalla.
  const COLECCION_PARCIAL = 'simulaciones';
  const SELECTOR_ZONA_PARCIAL = '#subtab-simulaciones-lista, #modal-ficha-simulacion';
  // El rol "tecnico" solo puede escribir en la subcolección de observaciones
  // de las reparaciones, y solo puede tocar controles de las fichas de
  // observación (pestaña de la ficha, ventana rápida y formulario). La ficha
  // "Ingreso" no se edita desde aquí: modifica la reparación misma.
  const COLECCION_TECNICO = 'reparaciones/observaciones';
  const SELECTOR_ZONA_TECNICO = '#ficha-reparacion-observaciones, #obs-rapido-contenedor, #modal-obs-ficha';
  const SELECTOR_EXCLUIDOS_TECNICO = '[data-obs-accion="editar-ingreso"]';
  const esRestringido = () => rol === 'lectura' || rol === 'parcial' || rol === 'tecnico';

  // ---------- Qué SÍ puede usar un usuario de solo lectura ----------
  // Todo botón/campo que no coincida con esta lista se oculta o se bloquea
  // (así, cualquier botón nuevo que se agregue queda bloqueado por defecto).
  // Para permitir uno a propósito, ponle el atributo data-lectura-ok.
  const SELECTOR_PERMITIDOS = [
    '.tab-btn', '.subtab-btn', '#btn-cerrar-sesion',
    // Filtros y búsqueda
    '.chip-filtro-estado', '.filtro-menu-item', '.filtro-chip-quitar', '.filtro-limpiar',
    '[id^="buscador-"]', 'input[placeholder^="Buscar"]', 'select[id^="filtro-"]',
    // Abrir fichas / navegar entre ellas
    '.chip-ver-pedido', '.btn-ver-pedido', '.btn-expandir-equipos',
    '#btn-ver-ficha-reparacion-header', '#btn-ver-pedido-desde-reparacion',
    '#btn-ver-reparacion-desde-pedido',
    '[id^="btn-cerrar-ficha"]',
    // "Cancelar" de cualquier ventana solo la cierra (excepto cancelar un envío, que sí borra)
    '[id^="btn-cancelar-"]:not(#btn-cancelar-envio)',
    // Evidencia y remesa
    '.btn-copiar-link', '.btn-ojo-equipo', '.btn-ojo-tamano', '.btn-guia-equipo', '.btn-obs-equipo', '#btn-descargar-remesa', '#btn-compartir-remesa-whatsapp',
    '[data-lectura-ok]'
  ].join(',');

  const SELECTOR_CONTROLES = 'button, input, select, textarea, [contenteditable="true"]';

  function esPermitido(el) {
    if (el.type === 'hidden') return true;
    if (el.closest('.login-overlay')) return true;
    // Parcial: dentro de Simulaciones (lista y ficha) todo queda habilitado.
    if (rol === 'parcial' && el.closest(SELECTOR_ZONA_PARCIAL)) return true;
    // Técnico: dentro de las fichas de observación de reparaciones todo queda
    // habilitado (menos editar la ficha "Ingreso").
    if (rol === 'tecnico' && el.closest(SELECTOR_ZONA_TECNICO) && !el.matches(SELECTOR_EXCLUIDOS_TECNICO)) return true;
    return el.matches(SELECTOR_PERMITIDOS);
  }

  function bloquearElemento(el) {
    if (esPermitido(el)) return;
    if (el.tagName === 'BUTTON') {
      el.classList.add('lectura-oculto');
    } else if (el.getAttribute('contenteditable') === 'true') {
      el.setAttribute('contenteditable', 'false');
      el.dataset.lecturaCe = '1';
    } else if (!el.disabled) {
      el.disabled = true;
      el.dataset.lecturaDeshabilitado = '1';
    }
  }

  function barrer(raiz) {
    if (!esRestringido() || !raiz || raiz.nodeType !== 1) return;
    if (raiz.matches(SELECTOR_CONTROLES)) bloquearElemento(raiz);
    raiz.querySelectorAll(SELECTOR_CONTROLES).forEach(bloquearElemento);
  }

  function restaurarTodo() {
    document.querySelectorAll('.lectura-oculto').forEach(el => el.classList.remove('lectura-oculto'));
    document.querySelectorAll('[data-lectura-deshabilitado]').forEach(el => {
      el.disabled = false;
      delete el.dataset.lecturaDeshabilitado;
    });
    document.querySelectorAll('[data-lectura-ce]').forEach(el => {
      el.setAttribute('contenteditable', 'true');
      delete el.dataset.lecturaCe;
    });
  }

  // Las fichas y listas se dibujan con innerHTML: se bloquea lo que aparezca.
  const observador = new MutationObserver(mutaciones => {
    if (!esRestringido()) return;
    mutaciones.forEach(m => m.addedNodes.forEach(barrer));
  });

  // ---------- Aviso al intentar escribir ----------
  let timerAviso = null;
  function avisarSoloLectura() {
    let aviso = document.getElementById('aviso-solo-lectura');
    if (!aviso) {
      aviso = document.createElement('div');
      aviso.id = 'aviso-solo-lectura';
      document.body.appendChild(aviso);
    }
    aviso.textContent = rol === 'parcial'
      ? '🧮 Tu usuario solo puede crear y modificar simulaciones.'
      : rol === 'tecnico'
        ? '🛠️ Tu usuario técnico solo puede crear y modificar observaciones de reparaciones.'
        : '👁️ Tu usuario es de solo lectura: no puede crear ni modificar datos.';
    aviso.classList.add('visible');
    clearTimeout(timerAviso);
    timerAviso = setTimeout(() => aviso.classList.remove('visible'), 3500);
  }

  // ---------- Guarda de escrituras en Firestore (red de seguridad) ----------
  // Si algo de la app intentara escribir con un usuario de lectura, se frena
  // aquí. (La barrera definitiva son las reglas de seguridad de Firestore.)
  function instalarGuardaEscrituras() {
    const fs = window.firebase && window.firebase.firestore;
    if (!fs) return;
    const bloqueado = () => {
      avisarSoloLectura();
      return new Error(rol === 'parcial'
        ? 'Tu usuario solo puede escribir en simulaciones.'
        : rol === 'tecnico'
          ? 'Tu usuario solo puede escribir en las observaciones de reparaciones.'
          : 'Tu usuario es de solo lectura.');
    };
    // Colección a la que apunta cada escritura (para los roles "parcial" y
    // "tecnico"). Una colección de primer nivel se identifica por su id
    // ('simulaciones'); una subcolección, por 'colección/subcolección'
    // ('reparaciones/observaciones').
    const claveColeccion = (col) => {
      if (!col) return null;
      return col.parent && col.parent.parent ? col.parent.parent.id + '/' + col.id : col.id;
    };
    const colDeDocumento = (self) => self && claveColeccion(self.parent);          // doc.set/update/delete
    const colDeColeccion = (self) => claveColeccion(self);                          // collection.add
    const colDeArg0 = (self, args) => args[0] && claveColeccion(args[0].parent);    // batch/transaction.set(ref, …)

    // soloLectura = true → los roles "parcial" y "tecnico" no se frenan en ese método (p. ej.
    // batch.commit: sus operaciones ya se revisaron una por una).
    const envolver = (proto, metodo, asincrono, colDe, soloLectura) => {
      if (!proto || typeof proto[metodo] !== 'function' || proto[metodo].__guardaRoles) return;
      const original = proto[metodo];
      const envuelto = function (...args) {
        const col = colDe ? colDe(this, args) : null;
        const frenar = rol === 'lectura' ||
          (rol === 'parcial' && !soloLectura && col !== COLECCION_PARCIAL) ||
          (rol === 'tecnico' && !soloLectura && col !== COLECCION_TECNICO);
        if (frenar) {
          const error = bloqueado();
          if (asincrono) return Promise.reject(error);
          throw error;
        }
        return original.apply(this, args);
      };
      envuelto.__guardaRoles = true;
      proto[metodo] = envuelto;
    };
    ['set', 'update', 'delete'].forEach(m => envolver(fs.DocumentReference && fs.DocumentReference.prototype, m, true, colDeDocumento));
    envolver(fs.CollectionReference && fs.CollectionReference.prototype, 'add', true, colDeColeccion);
    envolver(fs.WriteBatch && fs.WriteBatch.prototype, 'commit', true, null, true);
    ['set', 'update', 'delete'].forEach(m => envolver(fs.WriteBatch && fs.WriteBatch.prototype, m, false, colDeArg0));
    ['set', 'update', 'delete'].forEach(m => envolver(fs.Transaction && fs.Transaction.prototype, m, false, colDeArg0));
  }

  // ---------- Insignia en el encabezado ----------
  function actualizarInsignia() {
    let badge = document.getElementById('badge-rol');
    if (!esRestringido()) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'badge-rol';
      badge.className = 'badge-rol';
      const topbar = document.getElementById('topbar');
      if (!topbar) return;
      topbar.insertBefore(badge, topbar.querySelector('.status')); // junto al título
    }
    if (rol === 'parcial') {
      badge.textContent = '🧮 Parcial: solo Simulaciones';
      badge.title = motivo || 'Puedes ver todo; solo puedes crear, editar y eliminar simulaciones de envío.';
    } else if (rol === 'tecnico') {
      badge.textContent = '🛠️ Técnico: observaciones';
      badge.title = motivo || 'Puedes ver todo; solo puedes crear, editar y eliminar fichas de observación de las reparaciones.';
    } else {
      badge.textContent = '👁️ Solo lectura';
      badge.title = motivo || 'Puedes ver todo, pero no crear ni modificar datos.';
    }
  }

  function fijarRol(nuevoRol, nuevoMotivo) {
    const cambio = rol !== nuevoRol;
    rol = nuevoRol;
    motivo = nuevoMotivo || '';
    document.body.classList.remove('rol-pendiente');
    document.body.classList.toggle('rol-lectura', rol === 'lectura');
    document.body.classList.toggle('rol-parcial', rol === 'parcial');
    document.body.classList.toggle('rol-tecnico', rol === 'tecnico');
    if (esRestringido()) barrer(document.body);
    else restaurarTodo();
    actualizarInsignia();
    if (cambio) document.dispatchEvent(new CustomEvent('roles:listo', { detail: { rol } }));
  }

  // ---------- Resolver el rol del usuario con sesión ----------
  async function resolverRol(evento) {
    rol = null;
    document.body.classList.add('rol-pendiente'); // oculta los paneles un instante
    restaurarTodo();

    let rolAcceso = evento && evento.detail && evento.detail.rol;
    if (!rolAcceso) {
      // Respaldo (por si auth.js no entrega el rol): se lee el mismo documento.
      try {
        const usuario = window.firebase.auth().currentUser;
        const doc = await window.firebase.firestore().collection('usuarios').doc(usuario.uid).get();
        rolAcceso = doc.exists ? doc.data().rol : null;
      } catch (error) {
        console.error('[roles] No se pudo leer el rol del usuario:', error);
      }
    }

    if (rolAcceso === 'normal') {
      fijarRol('edicion', '');
    } else if (rolAcceso === 'lectura') {
      fijarRol('lectura', '');
    } else if (rolAcceso === 'parcial') {
      fijarRol('parcial', '');
    } else if (rolAcceso === 'tecnico') {
      fijarRol('tecnico', '');
    } else {
      // Rol desconocido: por seguridad, solo lectura.
      fijarRol('lectura', 'No se pudo determinar el rol de este usuario; por seguridad queda en solo lectura.');
    }
  }

  // Hasta que se sepa el rol, los paneles quedan ocultos (evita que se vean
  // por un instante botones de edición a un usuario de lectura).
  document.body.classList.add('rol-pendiente');
  instalarGuardaEscrituras();
  observador.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('auth:listo', resolverRol);
})();
