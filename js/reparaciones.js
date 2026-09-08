// ================== Pestaña: Reparaciones ==================
// Todavía SIN funcionalidad real. Este archivo por ahora solo existe para
// que la pestaña "Reparaciones" del menú tenga su script asociado, listo
// para construir encima cuando definamos cómo va a funcionar el historial
// de equipos que entran a reparación: qué datos se guardan por cada uno
// (equipo, cliente, fecha de ingreso, diagnóstico, estado, fecha de
// entrega...), en qué colección de Firestore queda, y qué se ve en la
// lista/ficha.
//
// Mientras tanto, el panel en index.html (#panel-reparaciones) solo
// muestra un mensaje de "próximamente".

(function () {

  // Se deja el enganche al evento de cambio de pestaña ya listo, para
  // cuando haya que inicializar/refrescar algo real al entrar aquí (por
  // ejemplo, arrancar una suscripción a Firestore la primera vez que se
  // visita esta pestaña, igual que hacen clientes.js/historial.js).
  document.addEventListener('tab:activada', (e) => {
    if (e.detail.tab !== 'reparaciones') return;
    // Placeholder: todavía no hay nada que inicializar.
  });

})();
