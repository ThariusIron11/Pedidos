// ================== Pestaña: Config ==================
// Lógica de configuración general de la app.

document.addEventListener('tab:activada', (e) => {
  if (e.detail.tab !== 'config') return;
  // TODO: inicializar/refrescar la pestaña Config al entrar
});
