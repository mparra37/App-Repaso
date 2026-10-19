// Configuración del repaso.
// workerUrl: dirección del Cloudflare Worker que guarda la API key de Claude,
// por ejemplo "https://repaso-tc1037.tu-cuenta.workers.dev" (sin diagonal final).
// Si se deja vacío, la app funciona sin IA: los alumnos escriben su código en el
// editor y las pruebas automáticas y las pistas siguen funcionando.
window.REPASO_CONFIG = {
  workerUrl: "https://repaso-tc1037.repaso-tc1037-worker.workers.dev",
};
