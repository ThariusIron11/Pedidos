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
