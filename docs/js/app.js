import { preparar, evaluar } from "./ejecutor.js";

const CONFIG = window.REPASO_CONFIG || {};
const WORKER_URL = (CONFIG.workerUrl || "").replace(/\/+$/, "");
const CLAVE = "repaso-tc1037";
const vista = document.getElementById("vista");

let datos = null;
const intentos = {};

// ---------- utilidades ----------

function el(etiqueta, atributos = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [nombre, valor] of Object.entries(atributos)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (nombre === "class") nodo.className = valor;
    else if (nombre.startsWith("on")) nodo.addEventListener(nombre.slice(2), valor);
    else if (valor === true) nodo.setAttribute(nombre, "");
    else nodo.setAttribute(nombre, valor);
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    nodo.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return nodo;
}

function reemplazar(nodo, ...hijos) {
  nodo.replaceChildren(...hijos.flat().filter((hijo) => hijo !== null && hijo !== undefined && hijo !== false));
}

const almacen = {
  leer(clave, defecto) {
    try {
      const texto = localStorage.getItem(`${CLAVE}:${clave}`);
      return texto === null ? defecto : JSON.parse(texto);
    } catch {
      return defecto;
    }
  },
  guardar(clave, valor) {
    try {
      localStorage.setItem(`${CLAVE}:${clave}`, JSON.stringify(valor));
    } catch {
      /* sin almacenamiento: la app sigue funcionando */
    }
  },
  borrar(clave) {
    try {
      localStorage.removeItem(`${CLAVE}:${clave}`);
    } catch {
      /* nada */
    }
  },
};

function progreso() {
  return almacen.leer("progreso", {});
}

function marcarResuelto(id) {
  const actual = progreso();
  if (actual[id]) return;
  actual[id] = true;
  almacen.guardar("progreso", actual);
  pintarProgresoGlobal();
}

function clienteId() {
  let id = almacen.leer("cliente", null);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
    almacen.guardar("cliente", id);
  }
  return id;
}

function pintarProgresoGlobal() {
  if (!datos) return;
  const hecho = progreso();
  const total = datos.calentamiento.length + datos.problemas.length;
  const resueltos = [...datos.calentamiento, ...datos.problemas].filter((p) => hecho[p.id]).length;
  document.getElementById("progreso-global").textContent = `${resueltos} / ${total} resueltos`;
}

function normalizaSalida(texto) {
  return texto
    .replace(/\r/g, "")
    .split("\n")
    .map((linea) => linea.trim().replace(/\s+/g, " "))
    .filter((linea, i, lineas) => linea !== "" || lineas.slice(i).some((l) => l.trim() !== ""))
    .join("\n")
    .trim();
}

function bloqueCodigo(codigo) {
  return el("pre", { class: "codigo" }, el("code", {}, codigo));
}

// ---------- servidor (Cloudflare Worker) ----------

const dialogoCodigo = document.getElementById("dialogo-codigo");

function pedirCodigoClase() {
  return new Promise((resolver) => {
    const entrada = document.getElementById("entrada-codigo");
    entrada.value = "";
    dialogoCodigo.returnValue = "";
    dialogoCodigo.addEventListener(
      "close",
      () => {
        const valor = entrada.value.trim();
        if (dialogoCodigo.returnValue === "aceptar" && valor) {
          almacen.guardar("codigo-clase", valor);
          resolver(valor);
        } else resolver(null);
      },
      { once: true },
    );
    dialogoCodigo.showModal();
  });
}

async function llamarServidor(ruta, cuerpo) {
  let codigoClase = almacen.leer("codigo-clase", null) || (await pedirCodigoClase());
  if (!codigoClase) throw new Error("Necesitas el código de clase para usar esta función.");
  let respuesta;
  try {
    respuesta = await fetch(`${WORKER_URL}${ruta}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...cuerpo, codigoClase, clienteId: clienteId() }),
    });
  } catch {
    throw new Error("No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.");
  }
  const datosRespuesta = await respuesta.json().catch(() => ({}));
  if (respuesta.status === 401) {
    almacen.borrar("codigo-clase");
    throw new Error("El código de clase no es correcto. Vuelve a intentarlo para escribirlo otra vez.");
  }
  if (!respuesta.ok) throw new Error(datosRespuesta.error || "El servidor no pudo responder. Inténtalo en un momento.");
  return datosRespuesta;
}

async function prepararImagen(archivo) {
  const url = URL.createObjectURL(archivo);
  try {
    const imagen = new Image();
    await new Promise((resolver, rechazar) => {
      imagen.onload = resolver;
      imagen.onerror = rechazar;
      imagen.src = url;
    });
    const lado = 1600;
    const escala = Math.min(1, lado / Math.max(imagen.naturalWidth, imagen.naturalHeight));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(imagen.naturalWidth * escala);
    lienzo.height = Math.round(imagen.naturalHeight * escala);
    const contexto = lienzo.getContext("2d");
    contexto.fillStyle = "#fff";
    contexto.fillRect(0, 0, lienzo.width, lienzo.height);
    contexto.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
    return lienzo.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- editor de código ----------

function crearEditor(valorInicial, alCambiar) {
  const numeros = el("pre", { class: "editor__numeros", "aria-hidden": "true" });
  const area = el("textarea", {
    class: "editor__texto",
    spellcheck: "false",
    autocapitalize: "off",
    autocomplete: "off",
    wrap: "off",
    "aria-label": "Tu código en Python",
    placeholder: "Aquí aparecerá tu código.\nTambién puedes escribirlo.",
  });
  area.value = valorInicial;
  let lineaError = null;

  function pintarNumeros() {
    const total = Math.max(1, area.value.split("\n").length);
    numeros.replaceChildren(
      ...Array.from({ length: total }, (_, i) =>
        el("span", { class: i + 1 === lineaError ? "error" : null }, `${i + 1}\n`),
      ),
    );
  }

  area.addEventListener("input", () => {
    lineaError = null;
    pintarNumeros();
    alCambiar(area.value);
  });
  area.addEventListener("scroll", () => {
    numeros.scrollTop = area.scrollTop;
  });
  area.addEventListener("keydown", (evento) => {
    if (evento.key === "Tab" && !evento.shiftKey) {
      evento.preventDefault();
      area.setRangeText("    ", area.selectionStart, area.selectionEnd, "end");
      area.dispatchEvent(new Event("input"));
    } else if (evento.key === "Enter") {
      const inicio = area.value.lastIndexOf("\n", area.selectionStart - 1) + 1;
      const linea = area.value.slice(inicio, area.selectionStart);
      let sangria = linea.match(/^ */)[0];
      if (linea.trimEnd().endsWith(":")) sangria += "    ";
      if (sangria) {
        evento.preventDefault();
        area.setRangeText(`\n${sangria}`, area.selectionStart, area.selectionEnd, "end");
        area.dispatchEvent(new Event("input"));
      }
    }
  });
  pintarNumeros();

  return {
    nodo: el("div", { class: "editor" }, numeros, area),
    get valor() {
      return area.value;
    },
    set valor(texto) {
      area.value = texto;
      lineaError = null;
      pintarNumeros();
      alCambiar(texto);
    },
    marcarLinea(numero) {
      lineaError = numero;
      pintarNumeros();
    },
  };
}

// ---------- explicaciones de errores ----------

const ERRORES_SINTAXIS = [
  [/expected ':'/, "falta poner dos puntos ( : ) al final de la línea."],
  [/was never closed/, "un paréntesis, corchete o llave se abrió y nunca se cerró."],
  [/unterminated string/, "un texto entre comillas no se cerró."],
  [/unmatched/, "hay un paréntesis de cierre que no corresponde a ninguno de apertura."],
  [/expected an indented block/, "después de una línea que termina en : la siguiente debe llevar sangría (4 espacios)."],
  [/unexpected indent/, "esta línea tiene sangría de más."],
  [/unindent does not match/, "la sangría de esta línea no coincide con la de las líneas anteriores."],
  [/cannot assign to|Maybe you meant '=='/, "parece que usaste = (asignar) donde debía ir == (comparar)."],
  [/invalid syntax/, "Python no entiende esta línea. Revisa los dos puntos, los paréntesis, las comillas y si usaste = en lugar de ==."],
];

const ERRORES_EJECUCION = {
  NameError: "usas un nombre que Python no conoce. Revisa cómo lo escribiste, si lo declaraste antes de usarlo o si te falta import math.",
  TypeError: "una operación recibió un tipo de dato que no esperaba: ¿olvidaste convertir el input() con int() o float()? ¿Llamaste a una función con más o menos argumentos?",
  ValueError: "un valor no se pudo convertir: por ejemplo int() de un texto con decimales.",
  ZeroDivisionError: "se intentó dividir entre cero.",
  AttributeError: "usas una función que no existe en ese módulo; revisa el nombre (por ejemplo math.sqrt).",
};

function explicarError(error) {
  const donde = error.linea ? `Línea ${error.linea}: ` : "";
  if (["SyntaxError", "IndentationError", "TabError"].includes(error.tipo)) {
    const regla = ERRORES_SINTAXIS.find(([patron]) => patron.test(error.mensaje));
    return {
      titulo: "Tu código tiene un error de sintaxis",
      texto: donde + (regla ? regla[1] : "Python no puede leer esta parte del código."),
      original: `${error.tipo}: ${error.mensaje}`,
    };
  }
  return {
    titulo: "Tu programa se detuvo con un error",
    texto: donde + (ERRORES_EJECUCION[error.tipo] || "ocurrió un error al ejecutar el programa."),
    original: `${error.tipo}: ${error.mensaje}`,
  };
}

// ---------- vistas ----------

function vistaInicio() {
  const hecho = progreso();
  const calentamientoHecho = datos.calentamiento.filter((p) => hecho[p.id]).length;

  const pasos = [
    ["Resuelve en papel", "Escribe el programa completo a mano, como en el examen."],
    ["Toma una foto", "Con buena luz, la hoja derecha y letra clara."],
    ["Revisa la lectura", "Corrige solo lo que la app leyó mal, no tu lógica."],
    ["Recibe retroalimentación", "Pruebas automáticas y comentarios sin darte la respuesta."],
  ];

  return el(
    "div",
    { class: "inicio" },
    el(
      "section",
      { class: "portada" },
      el("h1", {}, "Funciones, math y condicionales"),
      el("p", { class: "portada__texto" }, "Practica como en el examen: resuelve a mano, toma una foto de tu hoja y recibe retroalimentación para corregir tú mismo. Si te atoras, pide una pista."),
      el(
        "ol",
        { class: "pasos" },
        pasos.map(([titulo, texto], i) =>
          el("li", { class: "paso" }, el("span", { class: "paso__numero" }, i + 1), el("strong", {}, titulo), el("span", {}, texto)),
        ),
      ),
    ),
    el(
      "a",
      { class: "tarjeta tarjeta--enlace calentamiento-enlace", href: "#/calentamiento" },
      el("div", {}, el("span", { class: "etiqueta" }, "Para empezar"), el("h2", {}, "Calentamiento: ¿qué imprime?"), el("p", {}, "Opción múltiple y evaluación de expresiones, como las secciones I y II del examen. Se responde en la pantalla.")),
      el("span", { class: "contador" }, `${calentamientoHecho} / ${datos.calentamiento.length}`),
    ),
    datos.niveles.map((nivel) => {
      const lista = datos.problemas.filter((p) => p.nivel === nivel.id);
      return el(
        "section",
        { class: "nivel" },
        el("div", { class: "nivel__encabezado" }, el("h2", {}, nivel.nombre), el("p", {}, nivel.descripcion)),
        el(
          "div",
          { class: "rejilla" },
          lista.map((p) =>
            el(
              "a",
              { class: `tarjeta tarjeta--enlace problema-tarjeta${hecho[p.id] ? " resuelto" : ""}`, href: `#/problema/${p.id}` },
              el("span", { class: `chip chip--${nivel.id}` }, nivel.nombre.replace(/s$/, "")),
              el("h3", {}, p.titulo),
              el("p", {}, p.descripcion.length > 120 ? `${p.descripcion.slice(0, 117).trimEnd()}…` : p.descripcion),
              hecho[p.id] ? el("span", { class: "estado estado--ok" }, "✓ Resuelto") : null,
            ),
          ),
        ),
      );
    }),
  );
}

function tarjetaPregunta(pregunta, numero) {
  const hecho = progreso();
  const retro = el("div", { class: "retro-breve", "aria-live": "polite" });
  const explicacion = el("p", { class: "explicacion", hidden: true }, pregunta.explicacion);
  const botonVer = el("button", { class: "boton boton--texto", hidden: true, type: "button" }, "Ver respuesta y explicación");
  intentos[pregunta.id] = intentos[pregunta.id] || 0;
  let control;
  let leerRespuesta;

  if (pregunta.tipo === "opcion") {
    const nombre = `opcion-${pregunta.id}`;
    control = el(
      "div",
      { class: "opciones", role: "radiogroup" },
      pregunta.opciones.map((texto, i) =>
        el("label", { class: "opcion" }, el("input", { type: "radio", name: nombre, value: i }), el("span", { class: "opcion__letra" }, "abcd"[i] + ")"), el("code", {}, texto)),
      ),
    );
    leerRespuesta = () => {
      const marcada = control.querySelector("input:checked");
      return marcada ? Number(marcada.value) : null;
    };
  } else {
    const area = el("textarea", { class: "respuesta", rows: pregunta.respuesta.includes("\n") ? 2 : 1, spellcheck: "false", autocapitalize: "off", placeholder: "Escribe exactamente lo que se muestra en pantalla" });
    control = area;
    leerRespuesta = () => area.value;
  }

  function comprobar() {
    const respuesta = leerRespuesta();
    if (respuesta === null || (typeof respuesta === "string" && !respuesta.trim())) {
      retro.className = "retro-breve retro-breve--aviso";
      retro.textContent = "Primero escribe o selecciona una respuesta.";
      return;
    }
    let correcto;
    let mensaje = "";
    if (pregunta.tipo === "opcion") correcto = respuesta === pregunta.correcta;
    else {
      const dada = normalizaSalida(respuesta);
      const esperada = normalizaSalida(pregunta.respuesta);
      correcto = dada === esperada;
      if (!correcto && dada.toLowerCase() === esperada.toLowerCase()) mensaje = "Casi: revisa mayúsculas y minúsculas. Python escribe True, False y None con mayúscula inicial.";
      else if (!correcto && dada.replace(/["']/g, "") === esperada) mensaje = "Casi: print() no muestra las comillas de los textos.";
      else if (!correcto && !Number.isNaN(Number(dada)) && Number(dada) === Number(esperada)) mensaje = "El valor es correcto, pero cuida el tipo de dato: ¿el resultado es int o float?";
    }
    if (correcto) {
      retro.className = "retro-breve retro-breve--ok";
      retro.textContent = "¡Correcto!";
      explicacion.hidden = false;
      botonVer.hidden = true;
      marcarResuelto(pregunta.id);
      tarjeta.classList.add("resuelto");
    } else {
      intentos[pregunta.id] += 1;
      retro.className = "retro-breve retro-breve--error";
      retro.replaceChildren(el("strong", {}, "Todavía no. "), mensaje || `Pista: ${pregunta.pista}`);
      if (intentos[pregunta.id] >= 3) botonVer.hidden = false;
    }
  }

  botonVer.addEventListener("click", () => {
    const respuesta = pregunta.tipo === "opcion" ? `${"abcd"[pregunta.correcta]}) ${pregunta.opciones[pregunta.correcta]}` : pregunta.respuesta;
    explicacion.replaceChildren(el("strong", {}, "Respuesta: "), el("code", { class: "respuesta-correcta" }, respuesta), el("br"), pregunta.explicacion);
    explicacion.hidden = false;
    botonVer.hidden = true;
  });

  const tarjeta = el(
    "article",
    { class: `tarjeta pregunta${hecho[pregunta.id] ? " resuelto" : ""}` },
    el("div", { class: "pregunta__encabezado" }, el("span", { class: "pregunta__numero" }, numero), el("h3", {}, pregunta.pregunta)),
    pregunta.codigo ? bloqueCodigo(pregunta.codigo) : null,
    control,
    el("div", { class: "pregunta__acciones" }, el("button", { class: "boton", type: "button", onclick: comprobar }, "Comprobar"), botonVer),
    retro,
    explicacion,
  );
  return tarjeta;
}

function vistaCalentamiento() {
  return el(
    "div",
    { class: "pagina" },
    el("a", { class: "volver", href: "#/" }, "← Todos los ejercicios"),
    el("h1", {}, "Calentamiento"),
    el("p", { class: "subtitulo" }, "Resuélvelo primero en tu cuaderno, sin ejecutar nada. Escribe el valor exacto que imprime Python y cuida el tipo de dato: 4 no es lo mismo que 4.0."),
    el("div", { class: "lista-preguntas" }, datos.calentamiento.map((p, i) => tarjetaPregunta(p, i + 1))),
  );
}

function vistaProblema(problema) {
  const nivel = datos.niveles.find((n) => n.id === problema.nivel);
  const claveCodigo = `codigo:${problema.id}`;
  const funciones = [...new Set(problema.pruebas.filter((p) => p.tipo === "funcion").map((p) => p.funcion))];
  const conIA = Boolean(WORKER_URL);

  // --- enunciado ---
  const enunciado = el(
    "section",
    { class: "tarjeta enunciado" },
    el("h2", { class: "seccion-titulo" }, "Descripción"),
    el("p", {}, problema.descripcion),
    el("h3", {}, "Requisitos"),
    el("ul", {}, problema.requisitos.map((r) => el("li", {}, r))),
    el("div", { class: "entrada-salida" }, el("div", {}, el("h3", {}, "Entrada"), el("p", {}, problema.entrada)), el("div", {}, el("h3", {}, "Salida"), el("p", {}, problema.salida))),
    el("h3", {}, "Ejemplo de ejecución"),
    bloqueCodigo(problema.ejemplo.texto),
  );

  // --- pistas ---
  const pistasVistas = almacen.leer(`pistas:${problema.id}`, 0);
  const listaPistas = el("ol", { class: "pistas__lista" });
  const botonPista = el("button", { class: "boton boton--secundario", type: "button" });
  let mostradas = 0;
  function mostrarPista() {
    if (mostradas >= problema.pistas.length) return;
    listaPistas.append(el("li", {}, problema.pistas[mostradas]));
    mostradas += 1;
    almacen.guardar(`pistas:${problema.id}`, mostradas);
    actualizarBotonPista();
  }
  function actualizarBotonPista() {
    botonPista.hidden = mostradas >= problema.pistas.length;
    botonPista.textContent = mostradas === 0 ? "Necesito una pista" : `Otra pista (${mostradas + 1} de ${problema.pistas.length})`;
  }
  botonPista.addEventListener("click", mostrarPista);
  for (let i = 0; i < pistasVistas; i++) mostrarPista();
  actualizarBotonPista();
  const pistas = el(
    "section",
    { class: "tarjeta pistas" },
    el("h2", { class: "seccion-titulo" }, "Pistas"),
    el("p", { class: "nota" }, "Intenta primero sin ayuda. Cada pista te acerca un poco más, sin darte la respuesta."),
    listaPistas,
    botonPista,
  );

  // --- solución ---
  const editor = crearEditor(almacen.leer(claveCodigo, ""), (texto) => almacen.guardar(claveCodigo, texto));
  const estadoPython = el("span", { class: "estado-python" }, "Preparando Python…");
  preparar().then(
    () => {
      estadoPython.textContent = "Python listo";
      estadoPython.classList.add("listo");
    },
    () => {
      estadoPython.textContent = "No se pudo cargar Python; revisa tu conexión y recarga la página.";
      estadoPython.classList.add("falla");
    },
  );

  const resultados = el("div", { class: "resultados", "aria-live": "polite" });
  const avisoLectura = el("div", { class: "aviso-lectura", hidden: true });
  const miniatura = el("img", { class: "miniatura", alt: "Foto de tu solución", hidden: true });
  const estadoFoto = el("p", { class: "estado-foto", "aria-live": "polite" });
  let imagenLista = null;

  const entradaFoto = el("input", { type: "file", accept: "image/*", class: "oculto", id: `foto-${problema.id}` });
  const botonLeer = el("button", { class: "boton", type: "button", disabled: true }, "Leer mi código");

  entradaFoto.addEventListener("change", async () => {
    const archivo = entradaFoto.files[0];
    if (!archivo) return;
    estadoFoto.textContent = "Preparando la foto…";
    try {
      imagenLista = await prepararImagen(archivo);
      miniatura.src = imagenLista;
      miniatura.hidden = false;
      botonLeer.disabled = false;
      estadoFoto.textContent = "Foto lista. Ahora pulsa «Leer mi código».";
    } catch {
      imagenLista = null;
      botonLeer.disabled = true;
      estadoFoto.textContent = "No pude abrir esa imagen. Intenta con otra foto (JPG o PNG).";
    }
  });

  miniatura.addEventListener("click", () => {
    document.getElementById("foto-grande").src = miniatura.src;
    document.getElementById("dialogo-foto").showModal();
  });

  botonLeer.addEventListener("click", async () => {
    if (!imagenLista) return;
    if (editor.valor.trim() && !confirm("Se reemplazará el código que está en el editor. ¿Continuar?")) return;
    botonLeer.disabled = true;
    estadoFoto.textContent = "Leyendo tu letra… (tarda unos segundos)";
    try {
      const lectura = await llamarServidor("/transcribir", { imagen: imagenLista, funciones });
      editor.valor = lectura.codigo || "";
      avisoLectura.hidden = false;
      avisoLectura.className = `aviso-lectura aviso-lectura--${lectura.legibilidad || "buena"}`;
      const textos = {
        buena: "La foto se leyó bien.",
        regular: "Algunas partes costó leerlas; revisa con cuidado.",
        mala: "La foto fue difícil de leer. Si hay muchos errores, toma otra con mejor luz y letra más clara.",
      };
      reemplazar(
        avisoLectura,
        el("strong", {}, textos[lectura.legibilidad] || textos.buena),
        " Compara el editor con tu hoja y corrige solo lo que se leyó mal (las líneas marcadas con ",
        el("code", { class: "sin-corte" }, "# (?)"),
        " son dudosas). No corrijas tu lógica aquí: para eso está la revisión.",
        lectura.nota ? el("span", { class: "aviso-lectura__nota" }, ` ${lectura.nota}`) : null,
      );
      estadoFoto.textContent = "";
    } catch (error) {
      estadoFoto.textContent = error.message;
    } finally {
      botonLeer.disabled = false;
    }
  });

  const botonRevisar = el("button", { class: "boton boton--principal", type: "button" }, "Revisar mi solución");
  botonRevisar.addEventListener("click", () => revisar());

  async function revisar() {
    const codigo = editor.valor;
    if (!codigo.trim()) {
      resultados.replaceChildren(el("p", { class: "retro-breve retro-breve--aviso" }, "El editor está vacío: lee tu foto o escribe tu código primero."));
      return;
    }
    botonRevisar.disabled = true;
    resultados.replaceChildren(el("p", { class: "cargando" }, "Probando tu programa…"));
    let reporte;
    try {
      reporte = await evaluar(codigo, problema);
    } catch (error) {
      const mensaje =
        error.message === "TIEMPO"
          ? "Tu programa tardó demasiado y se detuvo. Revisa que no se quede esperando algo."
          : "No se pudo ejecutar Python. Revisa tu conexión y recarga la página.";
      resultados.replaceChildren(el("p", { class: "retro-breve retro-breve--error" }, mensaje));
      botonRevisar.disabled = false;
      return;
    }
    pintarReporte(reporte, codigo);
    botonRevisar.disabled = false;
  }

  function pintarReporte(reporte, codigo) {
    const pruebas = reporte.pruebas;
    const bien = pruebas.filter((p) => p.ok).length;
    const todoBien = !reporte.error && pruebas.length > 0 && bien === pruebas.length && reporte.avisos.length === 0;
    if (todoBien) marcarResuelto(problema.id);

    const partes = [];
    if (reporte.error) {
      const info = explicarError(reporte.error);
      if (reporte.error.linea) editor.marcarLinea(reporte.error.linea);
      partes.push(el("div", { class: "resumen resumen--error" }, el("strong", {}, info.titulo), el("p", {}, info.texto), el("code", { class: "error-original" }, info.original)));
    } else {
      partes.push(
        el(
          "div",
          { class: `resumen ${todoBien ? "resumen--ok" : "resumen--parcial"}` },
          el("strong", {}, todoBien ? "¡Tu programa pasó todas las pruebas!" : `Pasaste ${bien} de ${pruebas.length} pruebas`),
          el("p", {}, todoBien ? "Lee la retroalimentación: en el examen también cuentan la claridad y la sintaxis." : "Revisa las pruebas marcadas con ✗ y vuelve a intentarlo en tu hoja."),
        ),
      );
    }
    for (const aviso of reporte.avisos) partes.push(el("p", { class: "retro-breve retro-breve--aviso" }, aviso));
    if (pruebas.length) {
      partes.push(
        el(
          "details",
          { class: "pruebas", open: !todoBien },
          el("summary", {}, "Pruebas automáticas"),
          el(
            "ul",
            {},
            pruebas.map((p) =>
              el("li", { class: p.ok ? "ok" : "falla" }, el("span", { class: "icono", "aria-label": p.ok ? "correcta" : "incorrecta" }, p.ok ? "✓" : "✗"), el("span", {}, el("code", {}, p.descripcion), p.detalle ? el("span", { class: "detalle" }, ` — ${p.detalle}`) : null)),
            ),
          ),
        ),
      );
    }
    if (reporte.consola) {
      partes.push(el("h3", { class: "consola-titulo" }, "Así se ve tu programa con los datos del ejemplo"), el("pre", { class: "codigo consola" }, reporte.consola));
    }
    const cajaIA = el("section", { class: "retro-ia" });
    partes.push(cajaIA);
    resultados.replaceChildren(...partes);

    if (conIA) pedirRetro(cajaIA, codigo, reporte);
    else cajaIA.remove();
  }

  async function pedirRetro(caja, codigo, reporte) {
    caja.replaceChildren(el("h3", {}, "Retroalimentación"), el("p", { class: "cargando" }, "Analizando tu solución…"));
    try {
      const retro = await llamarServidor("/retro", {
        problema: { titulo: problema.titulo, descripcion: problema.descripcion, requisitos: problema.requisitos },
        codigo,
        resultados: {
          error: reporte.error,
          avisos: reporte.avisos,
          pruebas: reporte.pruebas.map(({ descripcion, ok, detalle }) => ({ descripcion, ok, detalle })),
          consola: reporte.consola,
        },
      });
      const etiquetas = { correcto: "Correcto", casi: "Casi", incorrecto: "Hay que corregir" };
      reemplazar(
        caja,
        el("h3", {}, "Retroalimentación", retro.estado ? el("span", { class: `chip chip--estado-${retro.estado}` }, etiquetas[retro.estado] || retro.estado) : null),
        retro.resumen ? el("p", {}, retro.resumen) : null,
        Array.isArray(retro.observaciones) && retro.observaciones.length ? el("ul", {}, retro.observaciones.map((o) => el("li", {}, o))) : null,
        retro.pregunta_guia ? el("p", { class: "pregunta-guia" }, el("strong", {}, "Piensa: "), retro.pregunta_guia) : null,
      );
    } catch (error) {
      caja.replaceChildren(el("h3", {}, "Retroalimentación"), el("p", { class: "nota" }, error.message), el("button", { class: "boton boton--secundario", type: "button", onclick: () => pedirRetro(caja, codigo, reporte) }, "Reintentar"));
    }
  }

  const pasoFoto = conIA
    ? el(
        "div",
        { class: "paso-foto" },
        el("div", { class: "paso-foto__botones" }, el("label", { class: "boton boton--secundario", for: entradaFoto.id }, "📷 Tomar o elegir foto"), botonLeer),
        entradaFoto,
        estadoFoto,
        miniatura,
      )
    : el("p", { class: "nota" }, "La lectura de fotos no está activada. Escribe en el editor el código tal como lo hiciste en papel.");

  const solucion = el(
    "section",
    { class: "tarjeta solucion" },
    el("h2", { class: "seccion-titulo" }, "Tu solución"),
    el(
      "ol",
      { class: "pasos-solucion" },
      el("li", {}, el("strong", {}, "Resuelve en papel. "), "Escribe el programa completo, con letra clara y respetando la sangría."),
      el("li", {}, el("strong", {}, "Toma una foto "), "de tu hoja, de frente y con buena luz.", pasoFoto),
      el("li", {}, el("strong", {}, "Revisa la lectura. "), "Debe decir lo mismo que tu hoja.", avisoLectura, editor.nodo),
      el("li", {}, el("strong", {}, "Revisa tu solución. "), el("div", { class: "acciones" }, botonRevisar, estadoPython)),
    ),
    resultados,
  );

  return el(
    "div",
    { class: "pagina" },
    el("a", { class: "volver", href: "#/" }, "← Todos los ejercicios"),
    el("div", { class: "titulo-problema" }, el("span", { class: `chip chip--${nivel.id}` }, nivel.nombre.replace(/s$/, "")), el("h1", {}, problema.titulo), progreso()[problema.id] ? el("span", { class: "estado estado--ok" }, "✓ Resuelto") : null),
    el("div", { class: "problema" }, el("div", { class: "problema__izquierda" }, enunciado, pistas), solucion),
  );
}

// ---------- navegación ----------

function mostrar() {
  if (!datos) return;
  const ruta = location.hash.replace(/^#\/?/, "");
  let contenido;
  let titulo = "Repaso TC1037";
  if (ruta === "calentamiento") {
    contenido = vistaCalentamiento();
    titulo = "Calentamiento · Repaso TC1037";
  } else if (ruta.startsWith("problema/")) {
    const problema = datos.problemas.find((p) => p.id === ruta.slice("problema/".length));
    if (problema) {
      contenido = vistaProblema(problema);
      titulo = `${problema.titulo} · Repaso TC1037`;
    }
  }
  if (!contenido) contenido = vistaInicio();
  document.title = titulo;
  vista.replaceChildren(contenido);
  window.scrollTo(0, 0);
  vista.focus({ preventScroll: true });
}

async function iniciar() {
  try {
    const respuesta = await fetch("data/problemas.json", { cache: "no-cache" });
    datos = await respuesta.json();
  } catch {
    vista.replaceChildren(el("p", { class: "retro-breve retro-breve--error" }, "No se pudieron cargar los ejercicios. Recarga la página."));
    return;
  }
  pintarProgresoGlobal();
  window.addEventListener("hashchange", mostrar);
  mostrar();
}

iniciar();
