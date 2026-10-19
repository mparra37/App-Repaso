// Ejecuta el código del alumno en un Web Worker con Pyodide.
// Si un programa tarda más de TIEMPO_LIMITE, se detiene el worker y se crea otro.

const TIEMPO_LIMITE = 8000;

let trabajador = null;
let listo = null;
let siguienteId = 1;
const pendientes = new Map();

function reiniciar(motivo) {
  if (trabajador) trabajador.terminate();
  trabajador = null;
  listo = null;
  for (const pendiente of pendientes.values()) {
    clearTimeout(pendiente.reloj);
    pendiente.rechazar(new Error(motivo));
  }
  pendientes.clear();
}

export function preparar() {
  if (listo) return listo;
  trabajador = new Worker("js/pyworker.js");
  listo = new Promise((resolver, rechazar) => {
    trabajador.onmessage = (evento) => {
      const mensaje = evento.data;
      if (mensaje.tipo === "listo") resolver();
      else if (mensaje.tipo === "falla") rechazar(new Error(mensaje.mensaje));
      else if (mensaje.tipo === "resultado") {
        const pendiente = pendientes.get(mensaje.id);
        if (!pendiente) return;
        pendientes.delete(mensaje.id);
        clearTimeout(pendiente.reloj);
        if (mensaje.falla) pendiente.rechazar(new Error(mensaje.falla));
        else pendiente.resolver(mensaje.reporte);
      }
    };
    trabajador.onerror = (evento) => rechazar(new Error(evento.message || "No se pudo cargar Python."));
  });
  const actual = listo;
  actual.catch(() => {
    if (listo === actual) reiniciar("No se pudo cargar Python.");
  });
  return listo;
}

export async function evaluar(codigo, problema) {
  await preparar();
  return new Promise((resolver, rechazar) => {
    const id = siguienteId++;
    const reloj = setTimeout(() => {
      pendientes.delete(id);
      rechazar(new Error("TIEMPO"));
      reiniciar("TIEMPO");
    }, TIEMPO_LIMITE);
    pendientes.set(id, { resolver, rechazar, reloj });
    trabajador.postMessage({ id, codigo, problema });
  });
}
