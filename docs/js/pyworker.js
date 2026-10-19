// Web Worker que carga Python (Pyodide) y evalúa el código del alumno.
// Corre aparte de la página para poder detenerlo si el programa se cuelga.
importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");

const listo = (async () => {
  const pyodide = await loadPyodide();
  const respuesta = await fetch(new URL("../py/evaluador.py", self.location.href));
  if (!respuesta.ok) throw new Error("No se encontró evaluador.py");
  pyodide.runPython(await respuesta.text());
  return pyodide;
})();

listo.then(
  () => postMessage({ tipo: "listo" }),
  (error) => postMessage({ tipo: "falla", mensaje: String(error) }),
);

self.onmessage = async (evento) => {
  const { id, codigo, problema } = evento.data;
  try {
    const pyodide = await listo;
    pyodide.globals.set("_entrada", JSON.stringify({ codigo, problema }));
    const texto = pyodide.runPython("evaluar_json(_entrada)");
    postMessage({ tipo: "resultado", id, reporte: JSON.parse(texto) });
  } catch (error) {
    postMessage({ tipo: "resultado", id, falla: String(error) });
  }
};
