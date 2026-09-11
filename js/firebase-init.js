// ================== Inicialización de Firebase ==================
// Proyecto: pedidos-2de09 (separado del proyecto de App Repuestos)

const firebaseConfig = {
  apiKey: "AIzaSyDW2ZP5kiIDM9fnOP_-Sgy8_GTq6tPiwFs",
  authDomain: "pedidos-2de09.firebaseapp.com",
  projectId: "pedidos-2de09",
  storageBucket: "pedidos-2de09.firebasestorage.app",
  messagingSenderId: "407501254342",
  appId: "1:407501254342:web:43d2456c9657a0fe6df1c7"
};

firebase.initializeApp(firebaseConfig);

// db queda disponible como variable global para que cada archivo
// de pestaña (pedidos.js, clientes.js, etc.) la use directamente.
const db = firebase.firestore();

// ---------- Persistencia offline (reduce lecturas de Firestore) ----------
// Guarda los documentos en IndexedDB. Al recargar la página o abrir una
// pestaña nueva, Firestore muestra primero lo que ya tiene en caché local
// (sin costo de lectura) y solo pide al servidor los cambios ocurridos
// desde la última vez, en lugar de volver a descargar toda la colección.
//
// synchronizeTabs: true permite que varias pestañas del MISMO navegador
// compartan una sola caché en vez de competir por ella (evita el error
// "failed-precondition" y evita lecturas duplicadas entre pestañas).
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
  if (err.code === 'failed-precondition') {
    // No debería ocurrir con synchronizeTabs activo, pero por si acaso
    // (ej. navegador viejo que no soporta la coordinación entre pestañas).
    console.warn('Firestore: no se pudo activar persistencia (failed-precondition).', err);
  } else if (err.code === 'unimplemented') {
    // Navegador sin soporte para IndexedDB (modo incógnito restringido, etc.)
    console.warn('Firestore: este navegador no soporta persistencia offline.', err);
  } else {
    console.warn('Firestore: error activando persistencia.', err);
  }
});
